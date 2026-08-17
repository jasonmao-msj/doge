//! Engine manager
//!
//! Unified management of multiple engine types, handling engine switching,
//! session management, and configuration.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};

use super::adapter_registry::{EngineAdapterRegistry, EngineId};
use super::agent_event_bus::AgentEventBus;
use super::claude::{ClaudeSession, ClaudeSessionManager};
use super::gemini::GeminiSession;
use super::grok::GrokSession;
use super::kimi::KimiSession;
use super::opencode::OpenCodeSession;
use super::status::{
    detect_all_engines, detect_claude_status, detect_codex_status, detect_grok_status,
    detect_kimi_status, detect_opencode_status,
};
use super::{disabled_engine_status, EngineConfig, EngineStatus, EngineType};

/// Unified engine manager
pub struct EngineManager {
    /// Private domain-event fan-out. Producers publish without waiting for sinks.
    pub(crate) agent_event_bus: AgentEventBus,
    adapter_registry: EngineAdapterRegistry,
    /// Currently active engine type (global default)
    active_engine: RwLock<EngineType>,

    /// Cached engine statuses
    engine_statuses: RwLock<HashMap<EngineType, EngineStatus>>,

    /// Claude session manager. Wrapped in `Arc` so the in-process AskUserQuestion
    /// MCP server can hold a shared handle for session lookup (see `askuser_mcp`).
    pub claude_manager: Arc<ClaudeSessionManager>,

    /// OpenCode sessions per workspace/provider runtime.
    opencode_sessions: Mutex<HashMap<String, OpenCodeSessionEntry>>,

    /// Gemini sessions per workspace
    gemini_sessions: Mutex<GeminiSessionRegistry>,

    /// Kimi sessions per workspace/provider runtime.
    kimi_sessions: Mutex<HashMap<String, KimiSessionEntry>>,

    /// Grok sessions per workspace/provider runtime.
    grok_sessions: Mutex<HashMap<String, GrokSessionEntry>>,

    /// Engine configurations
    engine_configs: RwLock<HashMap<EngineType, EngineConfig>>,
}

#[derive(Default)]
struct GeminiSessionRegistry {
    sessions: HashMap<String, Arc<GeminiSession>>,
    // Workspace ID 是非复用 UUID；持久 tombstone 阻止旧请求在删除后重新取得 process owner。
    removed_workspaces: HashSet<String>,
    shutting_down: bool,
}

struct KimiSessionEntry {
    workspace_id: String,
    session: Arc<KimiSession>,
}

struct GrokSessionEntry {
    workspace_id: String,
    session: Arc<GrokSession>,
}

struct OpenCodeSessionEntry {
    workspace_id: String,
    session: Arc<OpenCodeSession>,
}

fn kimi_engine_config_with_home(
    mut config: Option<EngineConfig>,
    home_dir: Option<&Path>,
) -> Option<EngineConfig> {
    if let Some(home_dir) = home_dir {
        config.get_or_insert_with(EngineConfig::default).home_dir =
            Some(home_dir.to_string_lossy().to_string());
    }
    config
}

fn grok_engine_config_with_home(
    mut config: Option<EngineConfig>,
    home_dir: Option<&Path>,
) -> Option<EngineConfig> {
    if let Some(home_dir) = home_dir {
        config.get_or_insert_with(EngineConfig::default).home_dir =
            Some(home_dir.to_string_lossy().to_string());
    }
    config
}

impl EngineManager {
    /// Create a new engine manager
    pub fn new() -> Self {
        Self {
            agent_event_bus: AgentEventBus::new(),
            adapter_registry: EngineAdapterRegistry::with_builtins(),
            active_engine: RwLock::new(EngineType::default()),
            engine_statuses: RwLock::new(HashMap::new()),
            claude_manager: Arc::new(ClaudeSessionManager::new()),
            opencode_sessions: Mutex::new(HashMap::new()),
            gemini_sessions: Mutex::new(GeminiSessionRegistry::default()),
            kimi_sessions: Mutex::new(HashMap::new()),
            grok_sessions: Mutex::new(HashMap::new()),
            engine_configs: RwLock::new(HashMap::new()),
        }
    }

    pub(crate) fn agent_event_bus(&self) -> AgentEventBus {
        self.agent_event_bus.clone()
    }

    /// Get the currently active engine type
    pub async fn get_active_engine(&self) -> EngineType {
        *self.active_engine.read().await
    }

    /// Set the active engine type
    pub async fn set_active_engine(&self, engine_type: EngineType) -> Result<(), String> {
        // Verify engine is installed
        let statuses = self.engine_statuses.read().await;
        if let Some(status) = statuses.get(&engine_type) {
            if !status.installed {
                return Err(format!(
                    "{} is not installed. Please install it first.",
                    engine_type.display_name()
                ));
            }
        } else {
            // Status not cached, check now
            drop(statuses);
            let status = self.detect_single_engine(engine_type).await;
            if !status.installed {
                return Err(format!(
                    "{} is not installed. Please install it first.",
                    engine_type.display_name()
                ));
            }
        }

        *self.active_engine.write().await = engine_type;
        Ok(())
    }

    /// Detect a single engine's status
    async fn detect_single_engine(&self, engine_type: EngineType) -> EngineStatus {
        self.detect_single_engine_with_gates(engine_type, true)
            .await
    }

    async fn detect_single_engine_with_gates(
        &self,
        engine_type: EngineType,
        _gemini_enabled: bool,
    ) -> EngineStatus {
        let engine_id = EngineId::builtin(engine_type);
        let registry_entry = self
            .adapter_registry
            .get(&engine_id)
            .expect("built-in engine must be registered before detection");
        let adapter = self
            .adapter_registry
            .adapter(&engine_id)
            .expect("built-in engine adapter must be registered");
        let protocol = self
            .adapter_registry
            .protocol(&engine_id)
            .expect("built-in engine protocol must be registered");
        debug_assert_eq!(adapter.engine_id(), &engine_id);
        debug_assert_eq!(
            adapter.declared_capability_profile(),
            registry_entry.capability_profile
        );
        debug_assert_eq!(protocol.family(), registry_entry.protocol_family);
        debug_assert_eq!(protocol.execution_model(), registry_entry.execution_model);
        let configs = self.engine_configs.read().await;
        let config = configs.get(&engine_type);
        let bin = config.and_then(|c| c.bin_path.as_deref());

        let status = match engine_type {
            EngineType::Claude => detect_claude_status(bin).await,
            EngineType::Codex => detect_codex_status(bin).await,
            EngineType::Gemini => disabled_engine_status(engine_type),
            EngineType::OpenCode => detect_opencode_status(bin).await,
            EngineType::Kimi => detect_kimi_status(bin).await,
            EngineType::Grok => detect_grok_status(bin).await,
        };

        // Cache the result
        let mut statuses = self.engine_statuses.write().await;
        statuses.insert(engine_type, status.clone());

        status
    }

    /// Force-refresh a single engine status while honoring CLI validation gates.
    pub async fn refresh_engine_status_with_gates(
        &self,
        engine_type: EngineType,
        gemini_enabled: bool,
    ) -> EngineStatus {
        self.detect_single_engine_with_gates(engine_type, gemini_enabled)
            .await
    }

    /// Verify/cache a provider-scoped binary without mutating the user's global engine config.
    pub(crate) async fn refresh_engine_status_for_binary(
        &self,
        engine_type: EngineType,
        binary: &str,
    ) -> EngineStatus {
        let mut status = match engine_type {
            EngineType::Claude => detect_claude_status(Some(binary)).await,
            EngineType::Codex => detect_codex_status(Some(binary)).await,
            _ => disabled_engine_status(engine_type),
        };
        // The account toolchain owns this path. Existing renderer-facing engine status
        // projections must not disclose an absolute packaged executable location.
        status.bin_path = None;
        self.engine_statuses
            .write()
            .await
            .insert(engine_type, status.clone());
        status
    }

    pub(crate) async fn set_claude_provider_config(
        &self,
        provider_profile_id: &str,
        config: EngineConfig,
    ) {
        self.claude_manager
            .set_provider_config(provider_profile_id, config)
            .await;
    }

    pub(crate) async fn remove_claude_sessions_for_provider(&self, provider_profile_id: &str) {
        self.claude_manager
            .remove_sessions_for_provider_profile(provider_profile_id)
            .await;
    }

    pub async fn detect_engines_with_gates(&self, gemini_enabled: bool) -> Vec<EngineStatus> {
        let gemini_enabled = gemini_enabled && crate::engine_policy::GEMINI_RUNTIME_ENABLED;
        let (claude_bin, codex_bin, gemini_bin, opencode_bin, kimi_bin, grok_bin) = {
            let configs = self.engine_configs.read().await;
            (
                configs
                    .get(&EngineType::Claude)
                    .and_then(|c| c.bin_path.clone()),
                configs
                    .get(&EngineType::Codex)
                    .and_then(|c| c.bin_path.clone()),
                configs
                    .get(&EngineType::Gemini)
                    .and_then(|c| c.bin_path.clone()),
                configs
                    .get(&EngineType::OpenCode)
                    .and_then(|c| c.bin_path.clone()),
                configs
                    .get(&EngineType::Kimi)
                    .and_then(|c| c.bin_path.clone()),
                configs
                    .get(&EngineType::Grok)
                    .and_then(|c| c.bin_path.clone()),
            )
        };

        let statuses = detect_all_engines(
            claude_bin.as_deref(),
            codex_bin.as_deref(),
            gemini_bin.as_deref(),
            opencode_bin.as_deref(),
            kimi_bin.as_deref(),
            grok_bin.as_deref(),
            gemini_enabled,
        )
        .await;

        let statuses = statuses
            .into_iter()
            .map(|status| match status.engine_type {
                EngineType::Gemini if !gemini_enabled => disabled_engine_status(EngineType::Gemini),
                _ => status,
            })
            .collect::<Vec<_>>();

        // Cache results
        let mut cached = self.engine_statuses.write().await;
        for status in &statuses {
            cached.insert(status.engine_type, status.clone());
        }

        statuses
    }

    /// Get cached engine status
    pub async fn get_engine_status(&self, engine_type: EngineType) -> Option<EngineStatus> {
        let statuses = self.engine_statuses.read().await;
        statuses.get(&engine_type).cloned()
    }

    /// Get all cached engine statuses
    pub async fn get_all_statuses(&self) -> Vec<EngineStatus> {
        let statuses = self.engine_statuses.read().await;
        statuses.values().cloned().collect()
    }

    /// Set engine configuration
    pub async fn set_engine_config(&self, engine_type: EngineType, config: EngineConfig) {
        let mut configs = self.engine_configs.write().await;
        configs.insert(engine_type, config.clone());
        drop(configs);
        self.engine_statuses.write().await.remove(&engine_type);

        // Update Claude manager if it's Claude config
        if engine_type == EngineType::Claude {
            self.claude_manager.set_config(config).await;
        }
    }

    /// Get engine configuration
    pub async fn get_engine_config(&self, engine_type: EngineType) -> Option<EngineConfig> {
        let configs = self.engine_configs.read().await;
        configs.get(&engine_type).cloned()
    }

    // ==================== Claude Session Management ====================

    /// Get or create a Claude session for a workspace
    pub async fn get_claude_session(
        &self,
        workspace_id: &str,
        workspace_path: &Path,
    ) -> Arc<ClaudeSession> {
        self.claude_manager
            .get_or_create_session(workspace_id, workspace_path)
            .await
    }

    pub async fn get_claude_session_for_provider(
        &self,
        workspace_id: &str,
        workspace_path: &Path,
        provider_profile_id: Option<&str>,
    ) -> Arc<ClaudeSession> {
        self.claude_manager
            .get_or_create_session_for_provider(workspace_id, workspace_path, provider_profile_id)
            .await
    }

    /// Remove a Claude session
    pub async fn remove_claude_session(&self, workspace_id: &str) {
        for (runtime_key, session) in self
            .claude_manager
            .runtime_sessions_for_workspace(workspace_id)
            .await
        {
            if let Err(error) = session.interrupt().await {
                log::warn!(
                    "[engine_manager] failed to interrupt claude session during remove (workspace={}): {}",
                    workspace_id,
                    error
                );
                continue;
            }
            session.mark_disposed();
            self.claude_manager
                .remove_runtime_session(&runtime_key)
                .await;
        }
    }

    /// The GUI runtime no longer tracks Codex adapters locally. Keep cleanup callers stable.
    pub async fn remove_codex_adapter(&self, _workspace_id: &str) {}

    // ==================== OpenCode Session Management ====================

    /// Get or create an OpenCode session for a workspace
    pub async fn get_or_create_opencode_session(
        &self,
        workspace_id: &str,
        workspace_path: &Path,
    ) -> Arc<OpenCodeSession> {
        self.get_or_create_opencode_session_for_runtime(
            workspace_id,
            workspace_path,
            workspace_id,
            None,
        )
        .await
    }

    /// Get or create an OpenCode session isolated by provider runtime key.
    pub async fn get_or_create_opencode_session_for_runtime(
        &self,
        workspace_id: &str,
        workspace_path: &Path,
        runtime_key: &str,
        provider_config_content: Option<String>,
    ) -> Arc<OpenCodeSession> {
        {
            let sessions = self.opencode_sessions.lock().await;
            if let Some(entry) = sessions.get(runtime_key) {
                return entry.session.clone();
            }
        }

        let config = self.get_engine_config(EngineType::OpenCode).await;
        let session = Arc::new(OpenCodeSession::new(
            workspace_id.to_string(),
            workspace_path.to_path_buf(),
            config,
            provider_config_content,
        ));
        let mut sessions = self.opencode_sessions.lock().await;
        if let Some(entry) = sessions.get(runtime_key) {
            return entry.session.clone();
        }
        sessions.insert(
            runtime_key.to_string(),
            OpenCodeSessionEntry {
                workspace_id: workspace_id.to_string(),
                session: session.clone(),
            },
        );
        session
    }

    /// Get OpenCode session by workspace
    pub async fn get_opencode_session(&self, workspace_id: &str) -> Option<Arc<OpenCodeSession>> {
        let sessions = self.opencode_sessions.lock().await;
        sessions
            .values()
            .find(|entry| entry.workspace_id == workspace_id)
            .map(|entry| entry.session.clone())
    }

    pub async fn get_opencode_session_for_runtime(
        &self,
        runtime_key: &str,
    ) -> Option<Arc<OpenCodeSession>> {
        self.opencode_sessions
            .lock()
            .await
            .get(runtime_key)
            .map(|entry| entry.session.clone())
    }

    /// Snapshot all OpenCode sessions owned by a workspace.
    pub async fn get_opencode_sessions(&self, workspace_id: &str) -> Vec<Arc<OpenCodeSession>> {
        let sessions = self.opencode_sessions.lock().await;
        sessions
            .values()
            .filter(|entry| entry.workspace_id == workspace_id)
            .map(|entry| entry.session.clone())
            .collect()
    }

    /// Interrupt all provider-scoped OpenCode runtimes owned by a workspace.
    pub async fn interrupt_opencode_sessions(
        &self,
        workspace_id: &str,
        turn_id: Option<&str>,
    ) -> Result<(), String> {
        let sessions = self.get_opencode_sessions(workspace_id).await;
        let mut errors = Vec::new();
        for session in sessions {
            let result = match turn_id {
                Some(turn_id) => session.interrupt_turn(turn_id).await,
                None => session.interrupt().await,
            };
            if let Err(error) = result {
                errors.push(error);
            }
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(format!(
                "failed to interrupt {} OpenCode runtime(s): {}",
                errors.len(),
                errors.join("; ")
            ))
        }
    }

    /// Stop and remove all OpenCode runtimes for a workspace (best effort).
    pub async fn remove_opencode_session(&self, workspace_id: &str) {
        let candidates = {
            let sessions = self.opencode_sessions.lock().await;
            sessions
                .iter()
                .filter(|(_, entry)| entry.workspace_id == workspace_id)
                .map(|(runtime_key, entry)| (runtime_key.clone(), entry.session.clone()))
                .collect::<Vec<_>>()
        };
        let mut completed = Vec::new();
        for (runtime_key, session) in candidates {
            match session.interrupt().await {
                Ok(()) => completed.push(runtime_key),
                Err(error) => {
                    log::warn!(
                        "[engine_manager] failed to stop OpenCode runtime {} for workspace {}: {}",
                        runtime_key,
                        workspace_id,
                        error
                    );
                }
            }
        }
        let mut sessions = self.opencode_sessions.lock().await;
        for runtime_key in completed {
            sessions.remove(&runtime_key);
        }
    }

    // ==================== Gemini Session Management ====================

    /// Get or create a Gemini session for a workspace
    pub async fn get_or_create_gemini_session(
        &self,
        workspace_id: &str,
        workspace_path: &Path,
    ) -> Result<Arc<GeminiSession>, String> {
        {
            let registry = self.gemini_sessions.lock().await;
            if registry.shutting_down {
                return Err("Gemini session manager is shutting down".to_string());
            }
            if registry.removed_workspaces.contains(workspace_id) {
                return Err(format!(
                    "Gemini session owner is unavailable for removed workspace: {workspace_id}"
                ));
            }
            if let Some(session) = registry.sessions.get(workspace_id) {
                return Ok(session.clone());
            }
        }

        let config = self.get_engine_config(EngineType::Gemini).await;
        let mut registry = self.gemini_sessions.lock().await;
        if registry.shutting_down {
            return Err("Gemini session manager is shutting down".to_string());
        }
        if registry.removed_workspaces.contains(workspace_id) {
            return Err(format!(
                "Gemini session owner is unavailable for removed workspace: {workspace_id}"
            ));
        }
        if let Some(session) = registry.sessions.get(workspace_id) {
            return Ok(session.clone());
        }
        let session = Arc::new(GeminiSession::new(
            workspace_id.to_string(),
            workspace_path.to_path_buf(),
            config,
        ));
        registry
            .sessions
            .insert(workspace_id.to_string(), session.clone());
        Ok(session)
    }

    /// Get Gemini session by workspace
    pub async fn get_gemini_session(&self, workspace_id: &str) -> Option<Arc<GeminiSession>> {
        let registry = self.gemini_sessions.lock().await;
        registry.sessions.get(workspace_id).cloned()
    }

    /// Snapshot all tracked OpenCode sessions.
    pub async fn list_opencode_sessions(&self) -> Vec<(String, Arc<OpenCodeSession>)> {
        let sessions = self.opencode_sessions.lock().await;
        sessions
            .values()
            .map(|entry| (entry.workspace_id.clone(), entry.session.clone()))
            .collect()
    }

    /// Snapshot all tracked Gemini sessions.
    pub async fn list_gemini_sessions(&self) -> Vec<(String, Arc<GeminiSession>)> {
        let registry = self.gemini_sessions.lock().await;
        registry
            .sessions
            .iter()
            .map(|(workspace_id, session)| (workspace_id.clone(), session.clone()))
            .collect()
    }
    /// Remove a Gemini session
    pub async fn remove_gemini_session(&self, workspace_id: &str) -> Result<(), String> {
        let session = {
            let mut registry = self.gemini_sessions.lock().await;
            if registry.shutting_down {
                return Err("Gemini session manager is shutting down".to_string());
            }
            registry.removed_workspaces.insert(workspace_id.into());
            registry.sessions.get(workspace_id).cloned()
        };
        let Some(session) = session else {
            return Ok(());
        };
        session.close().await.map_err(|error| {
            format!("failed to close Gemini session for workspace {workspace_id}: {error}")
        })?;

        let mut registry = self.gemini_sessions.lock().await;
        let should_remove = registry
            .sessions
            .get(workspace_id)
            .is_some_and(|current| Arc::ptr_eq(current, &session));
        if should_remove {
            registry.sessions.remove(workspace_id);
        }
        Ok(())
    }

    /// Drain and terminate all Gemini sessions during host shutdown.
    pub async fn shutdown_gemini_sessions(&self) -> Result<(), String> {
        let sessions = {
            let mut registry = self.gemini_sessions.lock().await;
            registry.shutting_down = true;
            registry
                .sessions
                .iter()
                .map(|(workspace_id, session)| (workspace_id.clone(), Arc::clone(session)))
                .collect::<Vec<_>>()
        };
        let mut cleanup_errors = Vec::new();
        for (workspace_id, session) in sessions {
            if let Err(error) = session.close().await {
                cleanup_errors.push(format!("{workspace_id}: {error}"));
                continue;
            }
            let mut registry = self.gemini_sessions.lock().await;
            let should_remove = registry
                .sessions
                .get(&workspace_id)
                .is_some_and(|current| Arc::ptr_eq(current, &session));
            if should_remove {
                registry.sessions.remove(&workspace_id);
            }
        }
        if cleanup_errors.is_empty() {
            Ok(())
        } else {
            Err(format!(
                "failed to close {} Gemini session(s): {}",
                cleanup_errors.len(),
                cleanup_errors.join("; ")
            ))
        }
    }

    // ==================== Kimi Session Management ====================

    /// Get or create a Kimi session for a workspace
    pub async fn get_or_create_kimi_session(
        &self,
        workspace_id: &str,
        workspace_path: &Path,
    ) -> Arc<KimiSession> {
        self.get_or_create_kimi_session_for_runtime(
            workspace_id,
            workspace_path,
            workspace_id,
            None,
        )
        .await
    }

    /// Get or create a Kimi session isolated by provider runtime key.
    pub async fn get_or_create_kimi_session_for_runtime(
        &self,
        workspace_id: &str,
        workspace_path: &Path,
        runtime_key: &str,
        home_dir: Option<&Path>,
    ) -> Arc<KimiSession> {
        {
            let sessions = self.kimi_sessions.lock().await;
            if let Some(entry) = sessions.get(runtime_key) {
                return entry.session.clone();
            }
        }

        let config =
            kimi_engine_config_with_home(self.get_engine_config(EngineType::Kimi).await, home_dir);
        let session = Arc::new(KimiSession::new(
            workspace_id.to_string(),
            workspace_path.to_path_buf(),
            config,
        ));
        let mut sessions = self.kimi_sessions.lock().await;
        if let Some(entry) = sessions.get(runtime_key) {
            return entry.session.clone();
        }
        sessions.insert(
            runtime_key.to_string(),
            KimiSessionEntry {
                workspace_id: workspace_id.to_string(),
                session: session.clone(),
            },
        );
        session
    }

    /// Get Kimi session by workspace
    pub async fn get_kimi_session(&self, workspace_id: &str) -> Option<Arc<KimiSession>> {
        let sessions = self.kimi_sessions.lock().await;
        sessions
            .values()
            .find(|entry| entry.workspace_id == workspace_id)
            .map(|entry| entry.session.clone())
    }

    pub async fn get_kimi_session_for_runtime(
        &self,
        runtime_key: &str,
    ) -> Option<Arc<KimiSession>> {
        self.kimi_sessions
            .lock()
            .await
            .get(runtime_key)
            .map(|entry| entry.session.clone())
    }

    /// Snapshot all Kimi sessions owned by a workspace.
    pub async fn get_kimi_sessions(&self, workspace_id: &str) -> Vec<Arc<KimiSession>> {
        let sessions = self.kimi_sessions.lock().await;
        sessions
            .values()
            .filter(|entry| entry.workspace_id == workspace_id)
            .map(|entry| entry.session.clone())
            .collect()
    }

    /// Interrupt all provider-scoped Kimi runtimes owned by a workspace.
    pub async fn interrupt_kimi_sessions(
        &self,
        workspace_id: &str,
        turn_id: Option<&str>,
    ) -> Result<(), String> {
        let sessions = self.get_kimi_sessions(workspace_id).await;
        let mut errors = Vec::new();
        for session in sessions {
            let result = match turn_id {
                Some(turn_id) => session.interrupt_turn(turn_id).await,
                None => session.interrupt().await,
            };
            if let Err(error) = result {
                errors.push(error);
            }
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(format!(
                "failed to interrupt {} Kimi runtime(s): {}",
                errors.len(),
                errors.join("; ")
            ))
        }
    }

    /// Snapshot all tracked Kimi sessions.
    pub async fn list_kimi_sessions(&self) -> Vec<(String, Arc<KimiSession>)> {
        let sessions = self.kimi_sessions.lock().await;
        sessions
            .values()
            .map(|entry| (entry.workspace_id.clone(), entry.session.clone()))
            .collect()
    }

    /// Stop and remove all Kimi runtimes for a workspace. Failed owners stay tracked.
    pub async fn remove_kimi_session(&self, workspace_id: &str) -> Result<(), String> {
        let candidates = {
            let sessions = self.kimi_sessions.lock().await;
            sessions
                .iter()
                .filter(|(_, entry)| entry.workspace_id == workspace_id)
                .map(|(runtime_key, entry)| (runtime_key.clone(), entry.session.clone()))
                .collect::<Vec<_>>()
        };
        let mut completed = Vec::new();
        let mut errors = Vec::new();
        for (runtime_key, session) in candidates {
            match session.interrupt().await {
                Ok(()) => completed.push(runtime_key),
                Err(error) => errors.push(error),
            }
        }
        let mut sessions = self.kimi_sessions.lock().await;
        for runtime_key in completed {
            sessions.remove(&runtime_key);
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(format!(
                "failed to close {} Kimi runtime(s): {}",
                errors.len(),
                errors.join("; ")
            ))
        }
    }

    /// Stop all provider-scoped Kimi runtimes during host shutdown.
    pub async fn shutdown_kimi_sessions(&self) -> Result<(), String> {
        let workspace_ids = {
            let sessions = self.kimi_sessions.lock().await;
            sessions
                .values()
                .map(|entry| entry.workspace_id.clone())
                .collect::<HashSet<_>>()
        };
        let mut errors = Vec::new();
        for workspace_id in workspace_ids {
            if let Err(error) = self.remove_kimi_session(&workspace_id).await {
                errors.push(error);
            }
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors.join("; "))
        }
    }

    // ==================== Grok Session Management ====================

    /// Get or create a Grok session for a workspace
    pub async fn get_or_create_grok_session(
        &self,
        workspace_id: &str,
        workspace_path: &Path,
    ) -> Arc<GrokSession> {
        self.get_or_create_grok_session_for_runtime(
            workspace_id,
            workspace_path,
            workspace_id,
            None,
        )
        .await
    }

    /// Get or create a Grok session isolated by provider runtime key.
    pub async fn get_or_create_grok_session_for_runtime(
        &self,
        workspace_id: &str,
        workspace_path: &Path,
        runtime_key: &str,
        home_dir: Option<&Path>,
    ) -> Arc<GrokSession> {
        {
            let sessions = self.grok_sessions.lock().await;
            if let Some(entry) = sessions.get(runtime_key) {
                return entry.session.clone();
            }
        }

        let config =
            grok_engine_config_with_home(self.get_engine_config(EngineType::Grok).await, home_dir);
        let session = Arc::new(GrokSession::new(
            workspace_id.to_string(),
            workspace_path.to_path_buf(),
            config,
        ));
        let mut sessions = self.grok_sessions.lock().await;
        if let Some(entry) = sessions.get(runtime_key) {
            return entry.session.clone();
        }
        sessions.insert(
            runtime_key.to_string(),
            GrokSessionEntry {
                workspace_id: workspace_id.to_string(),
                session: session.clone(),
            },
        );
        session
    }

    /// Get Grok session by workspace
    pub async fn get_grok_session(&self, workspace_id: &str) -> Option<Arc<GrokSession>> {
        let sessions = self.grok_sessions.lock().await;
        sessions
            .values()
            .find(|entry| entry.workspace_id == workspace_id)
            .map(|entry| entry.session.clone())
    }

    pub async fn get_grok_session_for_runtime(
        &self,
        runtime_key: &str,
    ) -> Option<Arc<GrokSession>> {
        self.grok_sessions
            .lock()
            .await
            .get(runtime_key)
            .map(|entry| entry.session.clone())
    }

    /// Snapshot all Grok sessions owned by a workspace.
    pub async fn get_grok_sessions(&self, workspace_id: &str) -> Vec<Arc<GrokSession>> {
        let sessions = self.grok_sessions.lock().await;
        sessions
            .values()
            .filter(|entry| entry.workspace_id == workspace_id)
            .map(|entry| entry.session.clone())
            .collect()
    }

    /// Interrupt all provider-scoped Grok runtimes owned by a workspace.
    pub async fn interrupt_grok_sessions(
        &self,
        workspace_id: &str,
        turn_id: Option<&str>,
    ) -> Result<(), String> {
        let sessions = self.get_grok_sessions(workspace_id).await;
        let mut errors = Vec::new();
        for session in sessions {
            let result = match turn_id {
                Some(turn_id) => session.interrupt_turn(turn_id).await,
                None => session.interrupt().await,
            };
            if let Err(error) = result {
                errors.push(error);
            }
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(format!(
                "failed to interrupt {} Grok runtime(s): {}",
                errors.len(),
                errors.join("; ")
            ))
        }
    }

    /// Snapshot all tracked Grok sessions.
    pub async fn list_grok_sessions(&self) -> Vec<(String, Arc<GrokSession>)> {
        let sessions = self.grok_sessions.lock().await;
        sessions
            .values()
            .map(|entry| (entry.workspace_id.clone(), entry.session.clone()))
            .collect()
    }

    /// Stop and remove all Grok runtimes for a workspace. Failed owners stay tracked.
    pub async fn remove_grok_session(&self, workspace_id: &str) -> Result<(), String> {
        let candidates = {
            let sessions = self.grok_sessions.lock().await;
            sessions
                .iter()
                .filter(|(_, entry)| entry.workspace_id == workspace_id)
                .map(|(runtime_key, entry)| (runtime_key.clone(), entry.session.clone()))
                .collect::<Vec<_>>()
        };
        let mut completed = Vec::new();
        let mut errors = Vec::new();
        for (runtime_key, session) in candidates {
            match session.interrupt().await {
                Ok(()) => completed.push(runtime_key),
                Err(error) => errors.push(error),
            }
        }
        let mut sessions = self.grok_sessions.lock().await;
        for runtime_key in completed {
            sessions.remove(&runtime_key);
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(format!(
                "failed to close {} Grok runtime(s): {}",
                errors.len(),
                errors.join("; ")
            ))
        }
    }

    /// Stop all provider-scoped Grok runtimes during host shutdown.
    pub async fn shutdown_grok_sessions(&self) -> Result<(), String> {
        let workspace_ids = {
            let sessions = self.grok_sessions.lock().await;
            sessions
                .values()
                .map(|entry| entry.workspace_id.clone())
                .collect::<HashSet<_>>()
        };
        let mut errors = Vec::new();
        for workspace_id in workspace_ids {
            if let Err(error) = self.remove_grok_session(&workspace_id).await {
                errors.push(error);
            }
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors.join("; "))
        }
    }

    // ==================== Utility Methods ====================

    /// Check if an engine is available (installed and ready)
    pub async fn is_engine_available(&self, engine_type: EngineType) -> bool {
        if let Some(status) = self.get_engine_status(engine_type).await {
            status.installed
        } else {
            let status = self.detect_single_engine(engine_type).await;
            status.installed
        }
    }

    /// Get list of available (installed) engines
    pub async fn get_available_engines(&self) -> Vec<EngineType> {
        let statuses = self.engine_statuses.read().await;
        statuses
            .iter()
            .filter(|(_, status)| status.installed)
            .map(|(engine_type, _)| *engine_type)
            .collect()
    }
}

impl Default for EngineManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn default_engine_is_claude() {
        let manager = EngineManager::new();
        assert_eq!(manager.get_active_engine().await, EngineType::Claude);
    }

    #[tokio::test]
    async fn engine_config_storage() {
        let manager = EngineManager::new();

        let config = EngineConfig {
            bin_path: Some("/custom/claude".to_string()),
            ..Default::default()
        };

        manager
            .set_engine_config(EngineType::Claude, config.clone())
            .await;

        let retrieved = manager.get_engine_config(EngineType::Claude).await;
        assert!(retrieved.is_some());
        assert_eq!(
            retrieved.unwrap().bin_path,
            Some("/custom/claude".to_string())
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn concurrent_gemini_creation_returns_single_owned_session() {
        const CALLER_COUNT: usize = 32;

        let manager = Arc::new(EngineManager::new());
        let workspace_path = Arc::new(std::env::temp_dir().join(format!(
            "ccgui-concurrent-gemini-session-{}",
            std::process::id()
        )));
        let start = Arc::new(tokio::sync::Barrier::new(CALLER_COUNT + 1));
        let config_guard = manager.engine_configs.write().await;
        let mut callers = Vec::with_capacity(CALLER_COUNT);

        for _ in 0..CALLER_COUNT {
            let manager = Arc::clone(&manager);
            let workspace_path = Arc::clone(&workspace_path);
            let start = Arc::clone(&start);
            callers.push(tokio::spawn(async move {
                start.wait().await;
                manager
                    .get_or_create_gemini_session("shared-workspace", workspace_path.as_path())
                    .await
                    .expect("concurrent Gemini creation should stay available")
            }));
        }

        start.wait().await;
        for _ in 0..CALLER_COUNT {
            tokio::task::yield_now().await;
        }
        drop(config_guard);

        let mut returned_sessions = Vec::with_capacity(CALLER_COUNT);
        for caller in callers {
            returned_sessions.push(caller.await.expect("Gemini session caller should join"));
        }
        let first = returned_sessions
            .first()
            .expect("at least one Gemini session");
        assert!(returned_sessions
            .iter()
            .all(|session| Arc::ptr_eq(first, session)));

        let tracked = manager
            .get_gemini_session("shared-workspace")
            .await
            .expect("manager should track the shared Gemini session");
        assert!(Arc::ptr_eq(first, &tracked));
        assert_eq!(manager.list_gemini_sessions().await.len(), 1);
    }

    #[tokio::test]
    async fn repeated_remove_retries_session_retained_behind_tombstone() {
        let manager = EngineManager::new();
        let workspace_path =
            std::env::temp_dir().join(format!("ccgui-gemini-remove-retry-{}", std::process::id()));
        manager
            .get_or_create_gemini_session("remove-retry", &workspace_path)
            .await
            .expect("create initial Gemini session");
        manager
            .remove_gemini_session("remove-retry")
            .await
            .expect("remove initial Gemini session");

        let retained_session = Arc::new(GeminiSession::new(
            "remove-retry".to_string(),
            workspace_path.clone(),
            None,
        ));
        manager
            .gemini_sessions
            .lock()
            .await
            .sessions
            .insert("remove-retry".to_string(), retained_session);

        manager
            .remove_gemini_session("remove-retry")
            .await
            .expect("retry retained Gemini session removal");

        assert!(manager.get_gemini_session("remove-retry").await.is_none());
        assert!(manager
            .get_or_create_gemini_session("remove-retry", &workspace_path)
            .await
            .is_err());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn legacy_enabled_bulk_detection_does_not_spawn_configured_gemini_cli() {
        use std::os::unix::fs::PermissionsExt;

        let manager = EngineManager::new();
        let test_dir = std::env::temp_dir().join(format!(
            "ccgui-gemini-detection-policy-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|duration| duration.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&test_dir).expect("create detection policy test directory");
        let script_path = test_dir.join("fake-gemini");
        let marker_path = test_dir.join("spawned");
        std::fs::write(
            &script_path,
            format!("#!/bin/sh\nprintf spawned > '{}'\n", marker_path.display()),
        )
        .expect("write fake Gemini CLI");
        let mut permissions = std::fs::metadata(&script_path)
            .expect("read fake Gemini CLI metadata")
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&script_path, permissions)
            .expect("make fake Gemini CLI executable");
        manager
            .set_engine_config(
                EngineType::Gemini,
                EngineConfig {
                    bin_path: Some(script_path.to_string_lossy().to_string()),
                    ..Default::default()
                },
            )
            .await;

        let statuses = manager.detect_engines_with_gates(true).await;
        let status = statuses
            .iter()
            .find(|status| status.engine_type == EngineType::Gemini)
            .expect("bulk detection should include disabled Gemini status");

        assert!(!status.installed);
        assert_eq!(
            status.error.as_deref(),
            Some(crate::engine_policy::GEMINI_DISABLED_DIAGNOSTIC)
        );
        assert!(
            !marker_path.exists(),
            "disabled Gemini detection must not spawn"
        );
        let _ = std::fs::remove_dir_all(test_dir);
    }

    #[tokio::test]
    async fn gated_refresh_returns_disabled_status_for_disabled_optional_engine() {
        let manager = EngineManager::new();

        let status = manager
            .refresh_engine_status_with_gates(EngineType::Gemini, false)
            .await;

        assert_eq!(status.engine_type, EngineType::Gemini);
        assert!(!status.installed);
        assert_eq!(
            status.error.as_deref(),
            Some(crate::engine_policy::GEMINI_DISABLED_DIAGNOSTIC)
        );

        let cached = manager
            .get_engine_status(EngineType::Gemini)
            .await
            .expect("status should be cached");
        assert_eq!(
            cached.error.as_deref(),
            Some(crate::engine_policy::GEMINI_DISABLED_DIAGNOSTIC)
        );
    }

    #[tokio::test]
    async fn kimi_sessions_are_reused_per_runtime_and_isolated_between_providers() {
        let manager = EngineManager::new();
        let workspace_path = std::env::temp_dir().join("mossx-kimi-runtime-isolation");
        let first = manager
            .get_or_create_kimi_session_for_runtime(
                "workspace-1",
                &workspace_path,
                "kimi::workspace-1::provider-a",
                Some(&workspace_path.join("provider-a")),
            )
            .await;
        let reused = manager
            .get_or_create_kimi_session_for_runtime(
                "workspace-1",
                &workspace_path,
                "kimi::workspace-1::provider-a",
                Some(&workspace_path.join("provider-a")),
            )
            .await;
        let isolated = manager
            .get_or_create_kimi_session_for_runtime(
                "workspace-1",
                &workspace_path,
                "kimi::workspace-1::provider-b",
                Some(&workspace_path.join("provider-b")),
            )
            .await;

        assert!(Arc::ptr_eq(&first, &reused));
        assert!(!Arc::ptr_eq(&first, &isolated));
        assert_eq!(manager.get_kimi_sessions("workspace-1").await.len(), 2);
        manager
            .remove_kimi_session("workspace-1")
            .await
            .expect("remove Kimi runtimes");
        assert!(manager.get_kimi_sessions("workspace-1").await.is_empty());
    }

    #[test]
    fn kimi_provider_home_flows_into_engine_config() {
        let home = Path::new("/tmp/mossx-kimi-provider-a");
        let config = kimi_engine_config_with_home(None, Some(home)).expect("Kimi config");
        assert_eq!(
            config.home_dir.as_deref(),
            Some(home.to_string_lossy().as_ref())
        );
    }

    #[tokio::test]
    async fn grok_sessions_are_reused_per_runtime_and_isolated_between_providers() {
        let manager = EngineManager::new();
        let workspace_path = std::env::temp_dir().join("ccgui-grok-runtime-isolation");
        let first = manager
            .get_or_create_grok_session_for_runtime(
                "workspace-1",
                &workspace_path,
                "grok::workspace-1::provider-a",
                Some(&workspace_path.join("provider-a")),
            )
            .await;
        let reused = manager
            .get_or_create_grok_session_for_runtime(
                "workspace-1",
                &workspace_path,
                "grok::workspace-1::provider-a",
                Some(&workspace_path.join("provider-a")),
            )
            .await;
        let isolated = manager
            .get_or_create_grok_session_for_runtime(
                "workspace-1",
                &workspace_path,
                "grok::workspace-1::provider-b",
                Some(&workspace_path.join("provider-b")),
            )
            .await;

        assert!(Arc::ptr_eq(&first, &reused));
        assert!(!Arc::ptr_eq(&first, &isolated));
        assert_eq!(manager.get_grok_sessions("workspace-1").await.len(), 2);
        manager
            .remove_grok_session("workspace-1")
            .await
            .expect("remove Grok runtimes");
        assert!(manager.get_grok_sessions("workspace-1").await.is_empty());
    }

    #[test]
    fn grok_provider_home_flows_into_engine_config() {
        let home = Path::new("/tmp/ccgui-grok-provider-a");
        let config = grok_engine_config_with_home(None, Some(home)).expect("Grok config");
        assert_eq!(
            config.home_dir.as_deref(),
            Some(home.to_string_lossy().as_ref())
        );
    }
}
