use std::collections::HashMap;
use std::fmt;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::events::EngineEvent;
use super::EngineType;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct EngineId(String);

impl EngineId {
    pub fn builtin(engine: EngineType) -> Self {
        Self(engine_id(engine).to_string())
    }

    pub fn external(value: &str) -> Result<Self, EngineRegistrationError> {
        let normalized = value.trim().to_ascii_lowercase();
        let valid = (2..=64).contains(&normalized.len())
            && normalized.chars().enumerate().all(|(index, character)| {
                if index == 0 {
                    character.is_ascii_lowercase()
                } else {
                    character.is_ascii_lowercase()
                        || character.is_ascii_digit()
                        || matches!(character, '.' | '-')
                }
            });
        if !valid {
            return Err(EngineRegistrationError::InvalidEngineId(value.to_string()));
        }
        Ok(Self(normalized))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EngineProtocolFamily {
    StreamJsonCli,
    AppServerJsonRpc,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EngineExecutionModel {
    OneShot,
    Persistent,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum EngineSourceInfo {
    Builtin {
        registration_id: String,
        version: String,
        trust_origin: String,
    },
    Plugin {
        registration_id: String,
        version: String,
        trust_origin: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineRegistryEntry {
    pub id: EngineId,
    pub display_name: String,
    pub adapter_id: String,
    pub protocol_family: EngineProtocolFamily,
    pub execution_model: EngineExecutionModel,
    pub capability_profile: String,
    pub source: EngineSourceInfo,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EngineRegistrationError {
    InvalidEngineId(String),
    DuplicateEngineId(String),
    IncompleteSource,
}

impl fmt::Display for EngineRegistrationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidEngineId(id) => write!(formatter, "invalid engine id: {id}"),
            Self::DuplicateEngineId(id) => write!(formatter, "duplicate engine id: {id}"),
            Self::IncompleteSource => formatter.write_str("engine source is incomplete"),
        }
    }
}

pub trait EngineProtocol: Send + Sync {
    fn family(&self) -> EngineProtocolFamily;
    fn execution_model(&self) -> EngineExecutionModel;
    fn executable_name(&self) -> &str;
    fn parse_wire_event(&self, payload: &Value) -> Result<Value, String>;
}

pub trait EngineAdapter: Send + Sync {
    fn engine_id(&self) -> &EngineId;
    fn declared_capability_profile(&self) -> &str;
    fn map_wire_event(&self, payload: Value) -> Result<EngineEvent, String>;
}

#[derive(Debug, Clone)]
pub struct BuiltinEngineAdapter {
    engine: EngineType,
    id: EngineId,
}

impl BuiltinEngineAdapter {
    pub fn new(engine: EngineType) -> Self {
        Self {
            engine,
            id: EngineId::builtin(engine),
        }
    }
}

impl EngineAdapter for BuiltinEngineAdapter {
    fn engine_id(&self) -> &EngineId {
        &self.id
    }

    fn declared_capability_profile(&self) -> &str {
        self.id.as_str()
    }

    fn map_wire_event(&self, payload: Value) -> Result<EngineEvent, String> {
        let workspace_id = payload
            .get("workspaceId")
            .or_else(|| payload.get("workspace_id"))
            .and_then(Value::as_str)
            .ok_or_else(|| "wire event missing workspaceId".to_string())?;
        Ok(EngineEvent::Raw {
            workspace_id: workspace_id.to_string(),
            engine: self.engine,
            data: payload,
        })
    }
}

#[derive(Debug, Clone)]
pub struct BuiltinEngineProtocol {
    engine: EngineType,
}

impl BuiltinEngineProtocol {
    pub fn new(engine: EngineType) -> Self {
        Self { engine }
    }
}

impl EngineProtocol for BuiltinEngineProtocol {
    fn family(&self) -> EngineProtocolFamily {
        if self.engine == EngineType::Codex {
            EngineProtocolFamily::AppServerJsonRpc
        } else {
            EngineProtocolFamily::StreamJsonCli
        }
    }

    fn execution_model(&self) -> EngineExecutionModel {
        if self.engine == EngineType::Codex {
            EngineExecutionModel::Persistent
        } else {
            EngineExecutionModel::OneShot
        }
    }

    fn executable_name(&self) -> &str {
        engine_id(self.engine)
    }

    fn parse_wire_event(&self, payload: &Value) -> Result<Value, String> {
        if payload.is_object() {
            Ok(payload.clone())
        } else {
            Err("wire event must be an object".to_string())
        }
    }
}

#[derive(Default)]
pub struct EngineAdapterRegistry {
    entries: HashMap<EngineId, EngineRegistryEntry>,
    adapters: HashMap<EngineId, Arc<dyn EngineAdapter>>,
    protocols: HashMap<EngineId, Arc<dyn EngineProtocol>>,
}

impl EngineAdapterRegistry {
    pub fn with_builtins() -> Self {
        let mut registry = Self::default();
        for engine in [
            EngineType::Claude,
            EngineType::Codex,
            EngineType::Gemini,
            EngineType::Grok,
            EngineType::Kimi,
            EngineType::OpenCode,
        ] {
            let protocol = BuiltinEngineProtocol::new(engine);
            let adapter = BuiltinEngineAdapter::new(engine);
            let id = EngineId::builtin(engine);
            registry.entries.insert(
                id.clone(),
                EngineRegistryEntry {
                    id: id.clone(),
                    display_name: engine.display_name().to_string(),
                    adapter_id: format!("builtin.{}", engine_id(engine)),
                    protocol_family: protocol.family(),
                    execution_model: protocol.execution_model(),
                    capability_profile: engine_id(engine).to_string(),
                    source: EngineSourceInfo::Builtin {
                        registration_id: format!("builtin.{}", engine_id(engine)),
                        version: "host".to_string(),
                        trust_origin: "doge-host".to_string(),
                    },
                },
            );
            registry.adapters.insert(id.clone(), Arc::new(adapter));
            registry.protocols.insert(id, Arc::new(protocol));
        }
        registry
    }

    pub fn register_external(
        &mut self,
        entry: EngineRegistryEntry,
    ) -> Result<(), EngineRegistrationError> {
        if self.entries.contains_key(&entry.id) {
            return Err(EngineRegistrationError::DuplicateEngineId(
                entry.id.as_str().to_string(),
            ));
        }
        match &entry.source {
            EngineSourceInfo::Plugin {
                registration_id,
                version,
                trust_origin,
            } if !registration_id.trim().is_empty()
                && !version.trim().is_empty()
                && !trust_origin.trim().is_empty() => {}
            _ => return Err(EngineRegistrationError::IncompleteSource),
        }
        self.entries.insert(entry.id.clone(), entry);
        Ok(())
    }

    pub fn get(&self, id: &EngineId) -> Option<&EngineRegistryEntry> {
        self.entries.get(id)
    }

    pub fn adapter(&self, id: &EngineId) -> Option<&dyn EngineAdapter> {
        self.adapters.get(id).map(AsRef::as_ref)
    }

    pub fn protocol(&self, id: &EngineId) -> Option<&dyn EngineProtocol> {
        self.protocols.get(id).map(AsRef::as_ref)
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }
}

pub fn engine_id(engine: EngineType) -> &'static str {
    match engine {
        EngineType::Claude => "claude",
        EngineType::Codex => "codex",
        EngineType::Gemini => "gemini",
        EngineType::Grok => "grok",
        EngineType::Kimi => "kimi",
        EngineType::OpenCode => "opencode",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtins_cover_one_shot_and_persistent_protocol_models() {
        let registry = EngineAdapterRegistry::with_builtins();
        assert_eq!(registry.len(), 6);
        assert_eq!(
            registry
                .get(&EngineId::builtin(EngineType::Kimi))
                .expect("kimi")
                .execution_model,
            EngineExecutionModel::OneShot
        );
        assert_eq!(
            registry
                .get(&EngineId::builtin(EngineType::Grok))
                .expect("grok")
                .execution_model,
            EngineExecutionModel::OneShot
        );
        assert_eq!(
            registry
                .get(&EngineId::builtin(EngineType::Codex))
                .expect("codex")
                .execution_model,
            EngineExecutionModel::Persistent
        );
    }

    #[test]
    fn protocol_parser_has_no_session_or_ui_mutation_surface() {
        let protocol = BuiltinEngineProtocol::new(EngineType::Kimi);
        assert_eq!(protocol.executable_name(), "kimi");
        assert_eq!(
            protocol.parse_wire_event(&serde_json::json!({ "type": "content" })),
            Ok(serde_json::json!({ "type": "content" }))
        );
        assert!(protocol.parse_wire_event(&Value::Null).is_err());
    }

    #[test]
    fn builtin_adapter_maps_protocol_output_without_frontend_state_access() {
        let adapter = BuiltinEngineAdapter::new(EngineType::Claude);
        assert_eq!(adapter.engine_id().as_str(), "claude");
        assert_eq!(adapter.declared_capability_profile(), "claude");
        assert!(matches!(
            adapter
                .map_wire_event(serde_json::json!({
                    "workspaceId": "workspace-1",
                    "type": "assistant"
                }))
                .expect("mapped"),
            EngineEvent::Raw {
                engine: EngineType::Claude,
                ..
            }
        ));
    }

    #[test]
    fn external_registration_validates_identity_source_and_duplicates() {
        let mut registry = EngineAdapterRegistry::with_builtins();
        let id = EngineId::external("acme.agent").expect("external id");
        let entry = EngineRegistryEntry {
            id: id.clone(),
            display_name: "Acme Agent".to_string(),
            adapter_id: "plugin.acme.agent".to_string(),
            protocol_family: EngineProtocolFamily::StreamJsonCli,
            execution_model: EngineExecutionModel::OneShot,
            capability_profile: "acme.agent".to_string(),
            source: EngineSourceInfo::Plugin {
                registration_id: "plugin.acme.agent".to_string(),
                version: "1.0.0".to_string(),
                trust_origin: "signed-marketplace".to_string(),
            },
        };
        assert!(registry.register_external(entry.clone()).is_ok());
        assert_eq!(
            registry.register_external(entry),
            Err(EngineRegistrationError::DuplicateEngineId(
                "acme.agent".to_string()
            ))
        );
        assert!(EngineId::external("INVALID ID").is_err());
    }
}
