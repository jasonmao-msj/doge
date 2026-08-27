use std::collections::HashSet;

use serde_json::{json, Value};

use crate::account::authority::ProductModelWire;

const PRODUCT_MODEL_API_PROTOCOLS: &[&str] = &[
    "openai-responses",
    "openai-chat-completions",
    "anthropic-messages",
];

pub(super) fn safe_product_models(values: Vec<ProductModelWire>) -> Result<Vec<Value>, ()> {
    let mut seen = HashSet::new();
    let mut models = Vec::new();
    for value in values {
        let id = value.id.trim();
        if !safe_product_model_id(id) || !is_conversation_product_model(&value) {
            continue;
        }
        if !seen.insert(id.to_lowercase()) {
            continue;
        }
        let display_name = value
            .display_name
            .as_deref()
            .map(str::trim)
            .filter(|name| safe_product_model_display_name(name))
            .unwrap_or(id);
        let runtime_model = value
            .model
            .as_deref()
            .map(str::trim)
            .filter(|model| safe_product_model_id(model))
            .unwrap_or(id);
        let api_protocols = compatible_product_api_protocols(&value);
        if api_protocols.is_empty() {
            continue;
        }
        let capabilities = value
            .capabilities
            .unwrap_or_default()
            .into_iter()
            .map(|capability| capability.trim().to_ascii_lowercase())
            .filter(|capability| !capability.is_empty() && capability.len() <= 64)
            .collect::<Vec<_>>();
        models.push(json!({
            "id": id,
            "display_name": display_name,
            "model": runtime_model,
            "api_protocols": api_protocols,
            "capabilities": capabilities,
        }));
    }
    if models.is_empty() || models.len() > 500 {
        return Err(());
    }
    Ok(models)
}

pub(super) fn safe_product_model_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && !id.chars().any(char::is_control)
        && id
            .chars()
            .all(|ch| ch.is_alphanumeric() || matches!(ch, '-' | '_' | '.' | ':' | '/'))
}

fn safe_product_model_display_name(value: &str) -> bool {
    !value.is_empty() && value.len() <= 256 && !value.chars().any(char::is_control)
}

fn compatible_product_api_protocols(value: &ProductModelWire) -> Vec<&'static str> {
    if let Some(values) = value.api_protocols.as_deref() {
        let requested = values
            .iter()
            .filter_map(|value| normalize_product_api_protocol(value))
            .collect::<HashSet<_>>();
        return PRODUCT_MODEL_API_PROTOCOLS
            .iter()
            .copied()
            .filter(|protocol| requested.contains(protocol))
            .collect();
    }

    if let Some(values) = value.compatible_engines.as_deref() {
        let requested = values
            .iter()
            .map(|value| value.trim().to_ascii_lowercase())
            .collect::<HashSet<_>>();
        return PRODUCT_MODEL_API_PROTOCOLS
            .iter()
            .copied()
            .filter(|protocol| {
                (*protocol == "openai-responses" && requested.contains("codex"))
                    || (*protocol == "openai-chat-completions" && requested.contains("kimi"))
                    || (*protocol == "anthropic-messages"
                        && (requested.contains("claude") || requested.contains("claude-code")))
            })
            .collect();
    }

    let identity = format!(
        "{} {} {}",
        value.id.trim(),
        value.display_name.as_deref().unwrap_or("").trim(),
        value.model.as_deref().unwrap_or("").trim(),
    )
    .to_ascii_lowercase();
    if identity.contains("豆包") || identity.contains("doubao") || identity.contains("ark-code") {
        return PRODUCT_MODEL_API_PROTOCOLS.to_vec();
    }
    if identity.contains("claude") || identity.contains("anthropic") {
        return vec!["anthropic-messages"];
    }
    if identity.contains("kimi")
        || identity.contains("moonshot")
        || identity
            .split_whitespace()
            .any(|part| part == "k3" || part.starts_with("k3-"))
    {
        return vec!["openai-responses", "openai-chat-completions"];
    }
    if identity.contains("gpt")
        || identity.contains("openai")
        || identity.split_whitespace().any(|part| {
            matches!(part, "o1" | "o3" | "o4")
                || part.starts_with("o1-")
                || part.starts_with("o3-")
                || part.starts_with("o4-")
        })
    {
        return vec!["openai-responses", "openai-chat-completions"];
    }
    Vec::new()
}

fn normalize_product_api_protocol(value: &str) -> Option<&'static str> {
    match value.trim().to_ascii_lowercase().as_str() {
        "responses" | "openai-responses" | "openai_responses" => Some("openai-responses"),
        "openai" | "openai-compatible" | "openai_compatible" | "chat-completions"
        | "chat_completions" => Some("openai-chat-completions"),
        "anthropic" | "anthropic-messages" | "anthropic_messages" | "messages" | "claude"
        | "claude-code" => Some("anthropic-messages"),
        _ => None,
    }
}

fn is_conversation_product_model(value: &ProductModelWire) -> bool {
    if let Some(capabilities) = value.capabilities.as_deref() {
        let normalized = capabilities
            .iter()
            .map(|capability| capability.trim().to_ascii_lowercase())
            .collect::<Vec<_>>();
        if normalized.iter().any(|capability| {
            matches!(
                capability.as_str(),
                "chat" | "text" | "messages" | "responses" | "coding" | "agent"
            )
        }) {
            return true;
        }
        if normalized.iter().any(|capability| {
            matches!(
                capability.as_str(),
                "image" | "image_generation" | "audio" | "realtime" | "embedding" | "embeddings"
            )
        }) {
            return false;
        }
    }
    let identity = format!(
        "{} {}",
        value.id.trim(),
        value.display_name.as_deref().unwrap_or("").trim()
    )
    .to_ascii_lowercase();
    ![
        "gpt-image",
        "image-generation",
        "audio-preview",
        "realtime-preview",
        "embedding",
        "text-to-speech",
        "transcribe",
        "whisper",
        "codex-auto-review",
    ]
    .iter()
    .any(|marker| identity.contains(marker))
}
