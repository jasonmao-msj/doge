//! In-process HTTP MCP server exposing a single `AskUserQuestion` tool.
//!
//! # Why this exists
//! The `claude` CLI only offers the native `AskUserQuestion` tool to the model in
//! **plan mode**. To restore mid-turn structured asks in default/acceptEdits, we
//! register an MCP tool — MCP tools are not plan-gated — and route its call into
//! the existing `RequestUserInput` dialog machinery.
//!
//! # Transport
//! Streamable-HTTP: provider-aware sessions use
//! `POST /mcp/:workspace_id/:runtime_locator`; the workspace-only endpoint remains
//! for local compatibility. Both speak JSON-RPC (`initialize`, `tools/list`,
//! `tools/call`) and respond `application/json`. No SSE stream is needed for
//! request/response. Verified against CLI v2.1.201.
//!
//! # Answer path (B2)
//! On `tools/call`, resolve the runtime's `ClaudeSession` and call
//! `ask_via_mcp`, which emits `RequestUserInput` to the live turn's subscriber
//! and blocks until the user answers. The answer text is returned as the MCP
//! tool_result — the CLI turn continues natively, no kill/`--resume`.

use std::net::SocketAddr;
use std::sync::{Arc, OnceLock};

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::post;
use axum::{Json, Router};
use serde_json::{json, Value};
use tokio::net::TcpListener;

use super::ClaudeSessionManager;

/// The tool name the model sees (prefixed by the CLI as `mcp__doge__AskUserQuestion`).
pub const MCP_SERVER_NAME: &str = "doge";
pub const ASK_TOOL_NAME: &str = "AskUserQuestion";

/// Process-global handle to the running server, set once at app startup.
/// The CLI spawn wiring reads this to build the per-workspace `--mcp-config`.
static ASKUSER_MCP_SERVER: OnceLock<AskUserMcpServer> = OnceLock::new();

/// Start the server (idempotent) and store it in the process-global slot.
/// Call once during app setup. No-op if already started.
pub async fn init_global(claude_manager: Arc<ClaudeSessionManager>) -> Result<(), String> {
    if ASKUSER_MCP_SERVER.get().is_some() {
        return Ok(());
    }
    let server = AskUserMcpServer::start(claude_manager).await?;
    // Ignore the race where another caller set it first; either is valid.
    let _ = ASKUSER_MCP_SERVER.set(server);
    Ok(())
}

/// The running server, if it has been started.
pub fn global() -> Option<&'static AskUserMcpServer> {
    ASKUSER_MCP_SERVER.get()
}

#[derive(Clone)]
struct McpServerState {
    claude_manager: Arc<ClaudeSessionManager>,
    /// Random per-process bearer token; every request must present it (set in `start`).
    token: Arc<str>,
}

/// A running in-process AskUserQuestion MCP server. Holds the bound port so the
/// CLI spawn wiring can build the per-workspace `--mcp-config` URL, plus the bearer
/// token injected into that config's headers and required on every request.
pub struct AskUserMcpServer {
    port: u16,
    token: Arc<str>,
}

impl AskUserMcpServer {
    /// Bind an ephemeral localhost port and start serving. Returns once the
    /// listener is bound (so `port()` is immediately usable); the accept loop
    /// runs on a detached task for the process lifetime.
    pub async fn start(claude_manager: Arc<ClaudeSessionManager>) -> Result<Self, String> {
        let listener = TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
            .await
            .map_err(|err| format!("failed to bind AskUserQuestion MCP server: {err}"))?;
        let port = listener
            .local_addr()
            .map_err(|err| format!("failed to read MCP server addr: {err}"))?
            .port();

        // Unguessable per-process token: our CLI spawn carries it via the injected
        // `--mcp-config` Authorization header; any other local process that finds the
        // loopback port cannot forge it.
        let token: Arc<str> = Arc::from(uuid::Uuid::new_v4().simple().to_string());
        let state = McpServerState {
            claude_manager,
            token: Arc::clone(&token),
        };
        let router = Router::new()
            .route(
                "/mcp/:workspace_id/:runtime_locator",
                post(handle_runtime_mcp),
            )
            .route("/mcp/:workspace_id", post(handle_legacy_mcp))
            .with_state(state);

        tokio::spawn(async move {
            if let Err(err) = axum::serve(listener, router).await {
                log::error!("AskUserQuestion MCP server stopped: {err}");
            }
        });

        log::info!("AskUserQuestion MCP server listening on 127.0.0.1:{port}");
        Ok(Self { port, token })
    }

    /// The `--mcp-config` inline JSON registering this server for a given
    /// workspace. Uses http transport so no subprocess is spawned.
    pub fn mcp_config_json(&self, workspace_id: &str, runtime_locator: &str) -> String {
        json!({
            "mcpServers": {
                MCP_SERVER_NAME: {
                    "type": "http",
                    "url": format!(
                        "http://127.0.0.1:{}/mcp/{}/{}",
                        self.port,
                        workspace_id,
                        runtime_locator
                    ),
                    "headers": { "Authorization": format!("Bearer {}", self.token) },
                }
            }
        })
        .to_string()
    }

    /// The fully-qualified tool name the CLI exposes, for `--allowedTools`.
    pub fn allowed_tool_name() -> String {
        format!("mcp__{MCP_SERVER_NAME}__{ASK_TOOL_NAME}")
    }
}

fn tool_definition() -> Value {
    json!({
        "name": ASK_TOOL_NAME,
        "description": "Ask the user a structured multiple-choice question and get their selection back. \
            Use mid-turn when you need the user to pick between options before continuing. \
            Provide 2-4 options per question; put the recommended default first.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "questions": {
                    "type": "array",
                    "description": "One or more questions to ask the user.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "question": { "type": "string", "description": "The question text." },
                            "header": { "type": "string", "description": "A short label for the question." },
                            "multiSelect": { "type": "boolean", "description": "Allow selecting multiple options." },
                            "options": {
                                "type": "array",
                                "description": "The options to choose from. First option is the recommended default.",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "label": { "type": "string" },
                                        "description": { "type": "string" }
                                    },
                                    "required": ["label"]
                                }
                            }
                        },
                        "required": ["question", "options"]
                    }
                }
            },
            "required": ["questions"]
        }
    })
}

fn rpc_result(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn rpc_error(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// A JSON-RPC response, or 202-with-no-body for notifications.
enum McpResponse {
    Json(Value),
    Accepted,
    Unauthorized,
}

impl IntoResponse for McpResponse {
    fn into_response(self) -> axum::response::Response {
        match self {
            McpResponse::Json(value) => (StatusCode::OK, Json(value)).into_response(),
            McpResponse::Accepted => StatusCode::ACCEPTED.into_response(),
            McpResponse::Unauthorized => StatusCode::UNAUTHORIZED.into_response(),
        }
    }
}

/// Whether the request carries the injected `Authorization: Bearer <token>`.
fn authorized(headers: &HeaderMap, token: &str) -> bool {
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(|presented| presented == token)
        .unwrap_or(false)
}

async fn handle_runtime_mcp(
    Path((workspace_id, runtime_locator)): Path<(String, String)>,
    State(state): State<McpServerState>,
    headers: HeaderMap,
    Json(msg): Json<Value>,
) -> McpResponse {
    handle_mcp_request(workspace_id, Some(runtime_locator), state, headers, msg).await
}

async fn handle_legacy_mcp(
    Path(workspace_id): Path<String>,
    State(state): State<McpServerState>,
    headers: HeaderMap,
    Json(msg): Json<Value>,
) -> McpResponse {
    handle_mcp_request(workspace_id, None, state, headers, msg).await
}

async fn handle_mcp_request(
    workspace_id: String,
    runtime_locator: Option<String>,
    state: McpServerState,
    headers: HeaderMap,
    msg: Value,
) -> McpResponse {
    // The loopback port is reachable by any local process; only our CLI spawn carries
    // the injected bearer token, so reject everything else before touching a session.
    if !authorized(&headers, &state.token) {
        return McpResponse::Unauthorized;
    }
    let id = msg.get("id").cloned().unwrap_or(Value::Null);
    let method = msg.get("method").and_then(Value::as_str).unwrap_or("");

    match method {
        "initialize" => {
            let protocol_version = msg
                .get("params")
                .and_then(|p| p.get("protocolVersion"))
                .and_then(Value::as_str)
                .unwrap_or("2024-11-05")
                .to_string();
            McpResponse::Json(rpc_result(
                id,
                json!({
                    "protocolVersion": protocol_version,
                    "capabilities": { "tools": {} },
                    "serverInfo": { "name": MCP_SERVER_NAME, "version": env!("CARGO_PKG_VERSION") }
                }),
            ))
        }
        // Notifications (no `id`) get no response body.
        "notifications/initialized" | "notifications/cancelled" => McpResponse::Accepted,
        "tools/list" => McpResponse::Json(rpc_result(id, json!({ "tools": [tool_definition()] }))),
        "tools/call" => {
            let tool_name = msg
                .get("params")
                .and_then(|p| p.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("");
            if tool_name != ASK_TOOL_NAME {
                return McpResponse::Json(rpc_error(
                    id,
                    -32602,
                    &format!("unknown tool: {tool_name}"),
                ));
            }
            let arguments = msg
                .get("params")
                .and_then(|p| p.get("arguments"))
                .cloned()
                .unwrap_or_else(|| json!({}));

            let session = match runtime_locator.as_deref() {
                Some(locator) => {
                    state
                        .claude_manager
                        .get_session_by_locator(&workspace_id, locator)
                        .await
                }
                None => state.claude_manager.get_session(&workspace_id).await,
            };
            let Some(session) = session else {
                return McpResponse::Json(rpc_error(
                    id,
                    -32000,
                    "no active Claude session for this workspace",
                ));
            };

            match session.ask_via_mcp(&arguments).await {
                Ok(answer_text) => McpResponse::Json(rpc_result(
                    id,
                    json!({ "content": [{ "type": "text", "text": answer_text }] }),
                )),
                // Return a tool_result error (isError) rather than a JSON-RPC
                // error so the CLI recovers and the model can continue.
                Err(err) => McpResponse::Json(rpc_result(
                    id,
                    json!({
                        "content": [{ "type": "text", "text": format!("AskUserQuestion failed: {err}") }],
                        "isError": true
                    }),
                )),
            }
        }
        other => McpResponse::Json(rpc_error(id, -32601, &format!("method not found: {other}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn server_at(port: u16) -> AskUserMcpServer {
        AskUserMcpServer {
            port,
            token: Arc::from("test-token"),
        }
    }

    #[test]
    fn mcp_config_json_uses_http_transport_and_workspace_url() {
        let config: Value =
            serde_json::from_str(&server_at(4899).mcp_config_json("ws-42", "runtime-a")).unwrap();
        let server = &config["mcpServers"][MCP_SERVER_NAME];
        assert_eq!(server["type"], "http");
        assert_eq!(server["url"], "http://127.0.0.1:4899/mcp/ws-42/runtime-a");
        assert_eq!(server["headers"]["Authorization"], "Bearer test-token");
        // Must NOT request strict mode — that would drop the user's own servers.
        assert!(config.get("strict").is_none());
    }

    #[test]
    fn allowed_tool_name_matches_cli_mcp_prefix() {
        assert_eq!(
            AskUserMcpServer::allowed_tool_name(),
            "mcp__doge__AskUserQuestion"
        );
    }

    #[test]
    fn tool_definition_schema_matches_native_questions_shape() {
        let def = tool_definition();
        assert_eq!(def["name"], ASK_TOOL_NAME);
        // The engine's convert_ask_user_question_to_request parses these exact keys.
        let props = &def["inputSchema"]["properties"]["questions"]["items"]["properties"];
        assert!(props.get("question").is_some());
        assert!(props.get("header").is_some());
        assert!(props.get("options").is_some());
        assert!(props.get("multiSelect").is_some());
        let opt = &props["options"]["items"]["properties"];
        assert!(opt.get("label").is_some());
        assert!(opt.get("description").is_some());
    }
}
