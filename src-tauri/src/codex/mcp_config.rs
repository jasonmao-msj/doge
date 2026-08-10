use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::HashSet;
use std::path::PathBuf;

use crate::app_paths;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GlobalMcpServerEntry {
    name: String,
    enabled: bool,
    transport: Option<String>,
    command: Option<String>,
    url: Option<String>,
    args_count: usize,
    source: String,
}

fn parse_disabled_mcp_set(root: &Map<String, Value>) -> HashSet<String> {
    root.get("disabledMcpServers")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str())
                .map(|item| item.trim().to_string())
                .filter(|item| !item.is_empty())
                .collect::<HashSet<_>>()
        })
        .unwrap_or_default()
}

fn parse_mcp_entries_from_object(
    mcp_servers: &Map<String, Value>,
    disabled_servers: &HashSet<String>,
    source: &str,
) -> Vec<GlobalMcpServerEntry> {
    let mut entries = Vec::new();
    for (name, raw_spec) in mcp_servers {
        let server_name = name.trim();
        if server_name.is_empty() {
            continue;
        }
        let spec = match raw_spec.as_object() {
            Some(value) => value,
            None => continue,
        };
        let transport = spec
            .get("type")
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let command = spec
            .get("command")
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let url = spec
            .get("url")
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let args_count = spec
            .get("args")
            .and_then(|value| value.as_array())
            .map(|items| items.len())
            .unwrap_or(0);
        entries.push(GlobalMcpServerEntry {
            name: server_name.to_string(),
            enabled: !disabled_servers.contains(server_name),
            transport,
            command,
            url,
            args_count,
            source: source.to_string(),
        });
    }
    entries.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    entries
}

fn parse_mcp_entries_from_array(mcp_servers: &[Value], source: &str) -> Vec<GlobalMcpServerEntry> {
    let mut entries = Vec::new();
    for raw_item in mcp_servers {
        let item = match raw_item.as_object() {
            Some(value) => value,
            None => continue,
        };
        let name = item
            .get("id")
            .or_else(|| item.get("name"))
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let Some(name) = name else {
            continue;
        };
        let enabled = item
            .get("enabled")
            .and_then(|value| value.as_bool())
            .unwrap_or(true);
        let spec = item
            .get("server")
            .and_then(|value| value.as_object())
            .unwrap_or(item);
        let transport = spec
            .get("type")
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let command = spec
            .get("command")
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let url = spec
            .get("url")
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let args_count = spec
            .get("args")
            .and_then(|value| value.as_array())
            .map(|items| items.len())
            .unwrap_or(0);
        entries.push(GlobalMcpServerEntry {
            name,
            enabled,
            transport,
            command,
            url,
            args_count,
            source: source.to_string(),
        });
    }
    entries.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    entries
}

fn parse_mcp_entries_from_json_value(
    root: &Value,
    source: &str,
) -> Result<Vec<GlobalMcpServerEntry>, String> {
    let object = root
        .as_object()
        .ok_or_else(|| "MCP config root is not a JSON object".to_string())?;
    let disabled_servers = parse_disabled_mcp_set(object);
    match object.get("mcpServers") {
        Some(Value::Object(mcp_servers)) => Ok(parse_mcp_entries_from_object(
            mcp_servers,
            &disabled_servers,
            source,
        )),
        Some(Value::Array(mcp_servers)) => Ok(parse_mcp_entries_from_array(mcp_servers, source)),
        Some(_) => Ok(Vec::new()),
        None => Ok(Vec::new()),
    }
}

fn read_json_file(path: &PathBuf) -> Result<Value, String> {
    let raw = std::fs::read_to_string(path)
        .map_err(|error| format!("Failed to read {}: {}", path.display(), error))?;
    serde_json::from_str::<Value>(&raw)
        .map_err(|error| format!("Failed to parse {}: {}", path.display(), error))
}

pub(crate) async fn list_global_mcp_servers() -> Result<Vec<GlobalMcpServerEntry>, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string())?;
    let mut entries = Vec::new();

    let claude_json_path = home.join(".claude.json");
    if claude_json_path.exists() {
        match read_json_file(&claude_json_path)
            .and_then(|root| parse_mcp_entries_from_json_value(&root, "claude_json"))
        {
            Ok(mut claude_entries) => entries.append(&mut claude_entries),
            Err(error) => {
                log::warn!(
                    "[list_global_mcp_servers] Failed to parse {}: {}",
                    claude_json_path.display(),
                    error
                );
            }
        }
    }

    let doge_config_path = app_paths::config_file_path()?;
    if doge_config_path.exists() {
        match read_json_file(&doge_config_path)
            .and_then(|root| parse_mcp_entries_from_json_value(&root, "doge_config"))
        {
            Ok(mut doge_entries) => entries.append(&mut doge_entries),
            Err(error) => {
                log::warn!(
                    "[list_global_mcp_servers] Failed to parse {}: {}",
                    doge_config_path.display(),
                    error
                );
            }
        }
    }

    Ok(entries)
}

/// 切换单个 MCP 服务的启用状态，写回对应配置文件：
/// - object 形式 mcpServers → 维护顶层 disabledMcpServers（启用=移除，停用=加入；
///   空数组直接删字段，保持文件干净）
/// - array 形式 mcpServers → 直接改写匹配项的 enabled 字段
/// 其余字段原样保留。
fn set_enabled_in_file(path: &PathBuf, name: &str, enabled: bool) -> Result<(), String> {
    let target_name = name.trim();
    if target_name.is_empty() {
        return Err("MCP 服务名不能为空。".to_string());
    }
    let mut root = read_json_file(path)?;
    let object = root
        .as_object_mut()
        .ok_or_else(|| "MCP config root is not a JSON object".to_string())?;

    enum ServersForm {
        Object,
        Array,
        Unsupported,
        Missing,
    }
    let form = match object.get("mcpServers") {
        Some(Value::Object(_)) => ServersForm::Object,
        Some(Value::Array(_)) => ServersForm::Array,
        Some(_) => ServersForm::Unsupported,
        None => ServersForm::Missing,
    };

    match form {
        ServersForm::Object => {
            let exists = object
                .get("mcpServers")
                .and_then(|value| value.as_object())
                .map(|servers| servers.contains_key(target_name))
                .unwrap_or(false);
            if !exists {
                return Err(format!("配置文件中不存在 MCP 服务「{}」。", target_name));
            }

            let mut disabled_items = match object.get("disabledMcpServers") {
                None => Vec::new(),
                Some(Value::Array(items)) => items.clone(),
                Some(_) => {
                    return Err("disabledMcpServers 不是数组，未做修改。".to_string());
                }
            };
            if enabled {
                disabled_items.retain(|item| item.as_str() != Some(target_name));
            } else if !disabled_items
                .iter()
                .any(|item| item.as_str() == Some(target_name))
            {
                disabled_items.push(Value::String(target_name.to_string()));
            }
            if disabled_items.is_empty() {
                object.remove("disabledMcpServers");
            } else {
                object.insert(
                    "disabledMcpServers".to_string(),
                    Value::Array(disabled_items),
                );
            }
        }
        ServersForm::Array => {
            let servers = object
                .get_mut("mcpServers")
                .and_then(|value| value.as_array_mut())
                .expect("mcpServers form checked above");
            let mut found = false;
            for item in servers.iter_mut() {
                let Some(item_object) = item.as_object_mut() else {
                    continue;
                };
                let matches = item_object
                    .get("id")
                    .or_else(|| item_object.get("name"))
                    .and_then(|value| value.as_str())
                    .map(|value| value.trim() == target_name)
                    .unwrap_or(false);
                if matches {
                    item_object.insert("enabled".to_string(), Value::Bool(enabled));
                    found = true;
                }
            }
            if !found {
                return Err(format!("配置文件中不存在 MCP 服务「{}」。", target_name));
            }
        }
        ServersForm::Unsupported => {
            return Err("mcpServers 字段格式不支持，未做修改。".to_string());
        }
        ServersForm::Missing => {
            return Err("配置文件中没有 mcpServers 字段。".to_string());
        }
    }

    let serialized = serde_json::to_string_pretty(&root)
        .map_err(|error| format!("Failed to serialize {}: {}", path.display(), error))?;
    std::fs::write(path, format!("{}\n", serialized))
        .map_err(|error| format!("Failed to write {}: {}", path.display(), error))?;
    Ok(())
}

pub(crate) async fn set_global_mcp_server_enabled(
    name: String,
    source: String,
    enabled: bool,
) -> Result<(), String> {
    let path = match source.as_str() {
        "claude_json" => {
            let home =
                dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string())?;
            home.join(".claude.json")
        }
        "doge_config" | "ccgui_config" => app_paths::config_file_path()?,
        other => return Err(format!("未知的 MCP 配置来源：{}", other)),
    };
    if !path.exists() {
        return Err(format!("配置文件不存在：{}", path.display()));
    }
    set_enabled_in_file(&path, &name, enabled)
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn temp_config_file(content: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mcp-config-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let path = dir.join("config.json");
        std::fs::write(&path, content).expect("write temp config");
        path
    }

    fn read_back(path: &PathBuf) -> Value {
        let raw = std::fs::read_to_string(path).expect("read temp config");
        serde_json::from_str(&raw).expect("parse temp config")
    }

    #[test]
    fn object_form_disable_then_enable_roundtrip() {
        let path = temp_config_file(
            r#"{"mcpServers":{"alpha":{"command":"npx","args":["-y","pkg"]}},"unrelated":1}"#,
        );

        set_enabled_in_file(&path, "alpha", false).expect("disable");
        let disabled_state = read_back(&path);
        assert_eq!(
            disabled_state["disabledMcpServers"],
            Value::Array(vec![Value::String("alpha".to_string())])
        );
        // 服务定义与无关字段保留
        assert!(disabled_state["mcpServers"]["alpha"].is_object());
        assert_eq!(disabled_state["unrelated"], Value::from(1));

        set_enabled_in_file(&path, "alpha", true).expect("enable");
        let enabled_state = read_back(&path);
        // 空数组时删除 disabledMcpServers 字段
        assert!(enabled_state.get("disabledMcpServers").is_none());
        assert!(enabled_state["mcpServers"]["alpha"].is_object());
    }

    #[test]
    fn object_form_disable_is_idempotent_and_keeps_other_entries() {
        let path = temp_config_file(
            r#"{"mcpServers":{"alpha":{"command":"npx"},"beta":{"url":"https://x"}},"disabledMcpServers":["beta"]}"#,
        );

        set_enabled_in_file(&path, "alpha", false).expect("disable alpha");
        set_enabled_in_file(&path, "alpha", false).expect("disable alpha again");
        let state = read_back(&path);
        let disabled = state["disabledMcpServers"].as_array().expect("array");
        assert_eq!(disabled.len(), 2);
        assert!(disabled.iter().any(|item| item.as_str() == Some("alpha")));
        assert!(disabled.iter().any(|item| item.as_str() == Some("beta")));
    }

    #[test]
    fn array_form_toggles_enabled_flag() {
        let path = temp_config_file(
            r#"{"mcpServers":[{"id":"alpha","enabled":true,"server":{"command":"npx"}}],"unrelated":1}"#,
        );

        set_enabled_in_file(&path, "alpha", false).expect("disable");
        let state = read_back(&path);
        assert_eq!(state["mcpServers"][0]["enabled"], Value::Bool(false));
        assert_eq!(state["unrelated"], Value::from(1));

        set_enabled_in_file(&path, "alpha", true).expect("enable");
        let state = read_back(&path);
        assert_eq!(state["mcpServers"][0]["enabled"], Value::Bool(true));
    }

    #[test]
    fn missing_server_returns_error() {
        let path = temp_config_file(r#"{"mcpServers":{"alpha":{"command":"npx"}}}"#);
        let error = set_enabled_in_file(&path, "ghost", false).expect_err("should fail");
        assert!(error.contains("ghost"));
    }

    #[test]
    fn missing_mcp_servers_field_returns_error() {
        let path = temp_config_file(r#"{"other":1}"#);
        let error = set_enabled_in_file(&path, "alpha", false).expect_err("should fail");
        assert!(error.contains("mcpServers"));
    }

    #[test]
    fn aggregated_parse_covers_both_sources() {
        // list_global_mcp_servers 走真实 HOME 不便单测，这里锁定它依赖的
        // parse 行为：两个来源都能解析出 entries（聚合逻辑不再提前返回）。
        let claude_root: Value = serde_json::from_str(
            r#"{"mcpServers":{"alpha":{"command":"npx"}},"disabledMcpServers":["alpha"]}"#,
        )
        .expect("parse claude root");
        let ccgui_root: Value =
            serde_json::from_str(r#"{"mcpServers":{"beta":{"url":"https://x","type":"http"}}}"#)
                .expect("parse ccgui root");

        let claude_entries =
            parse_mcp_entries_from_json_value(&claude_root, "claude_json").expect("claude entries");
        let ccgui_entries =
            parse_mcp_entries_from_json_value(&ccgui_root, "ccgui_config").expect("ccgui entries");

        assert_eq!(claude_entries.len(), 1);
        assert!(!claude_entries[0].enabled);
        assert_eq!(claude_entries[0].source, "claude_json");
        assert_eq!(ccgui_entries.len(), 1);
        assert!(ccgui_entries[0].enabled);
        assert_eq!(ccgui_entries[0].source, "ccgui_config");
    }
}
