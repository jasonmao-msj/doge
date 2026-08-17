use super::*;

/// Claude session manager for all workspaces
pub struct ClaudeSessionManager {
    sessions: Mutex<HashMap<String, Arc<ClaudeSession>>>,
    default_config: RwLock<EngineConfig>,
    provider_configs: RwLock<HashMap<String, EngineConfig>>,
    ask_user_question_resume_diagnostic_sink:
        StdMutex<Option<ClaudeAskUserQuestionResumeDiagnosticSink>>,
}

impl ClaudeSessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            default_config: RwLock::new(EngineConfig::default()),
            provider_configs: RwLock::new(HashMap::new()),
            ask_user_question_resume_diagnostic_sink: StdMutex::new(None),
        }
    }

    pub fn set_ask_user_question_resume_diagnostic_sink(
        &self,
        sink: Option<ClaudeAskUserQuestionResumeDiagnosticSink>,
    ) {
        if let Ok(mut current) = self.ask_user_question_resume_diagnostic_sink.lock() {
            *current = sink;
        }
    }

    /// Set default configuration
    pub async fn set_config(&self, config: EngineConfig) {
        *self.default_config.write().await = config;
    }

    /// Set a provider-scoped binary/config without changing the user's local Claude runtime.
    pub(crate) async fn set_provider_config(
        &self,
        provider_profile_id: &str,
        config: EngineConfig,
    ) {
        self.provider_configs
            .write()
            .await
            .insert(provider_profile_id.to_string(), config);
    }

    pub(crate) async fn remove_sessions_for_provider_profile(&self, provider_profile_id: &str) {
        let suffix = format!("::{provider_profile_id}");
        let removed = {
            let mut sessions = self.sessions.lock().await;
            let keys = sessions
                .keys()
                .filter(|key| key.ends_with(&suffix))
                .cloned()
                .collect::<Vec<_>>();
            keys.into_iter()
                .filter_map(|key| sessions.remove(&key))
                .collect::<Vec<_>>()
        };
        for session in removed {
            let _ = session.interrupt().await;
        }
    }

    /// Get or create a session for a workspace
    pub async fn get_or_create_session(
        &self,
        workspace_id: &str,
        workspace_path: &Path,
    ) -> Arc<ClaudeSession> {
        self.get_or_create_session_for_provider(workspace_id, workspace_path, None)
            .await
    }

    /// Get or create a provider-scoped session for a workspace.
    pub async fn get_or_create_session_for_provider(
        &self,
        workspace_id: &str,
        workspace_path: &Path,
        provider_profile_id: Option<&str>,
    ) -> Arc<ClaudeSession> {
        let runtime_key = provider_profile::claude_runtime_key(workspace_id, provider_profile_id);
        let mut sessions = self.sessions.lock().await;

        if let Some(session) = sessions.get(&runtime_key) {
            return session.clone();
        }

        let provider_config = match provider_profile_id
            .map(str::trim)
            .filter(|profile_id| !profile_id.is_empty())
        {
            Some(profile_id) => self.provider_configs.read().await.get(profile_id).cloned(),
            None => None,
        };
        let config = match provider_config {
            Some(config) => config,
            None => self.default_config.read().await.clone(),
        };
        let session = Arc::new(ClaudeSession::new_with_runtime(
            workspace_id.to_string(),
            workspace_path.to_path_buf(),
            Some(config),
        ));
        let diagnostic_sink = self
            .ask_user_question_resume_diagnostic_sink
            .lock()
            .ok()
            .and_then(|current| current.clone());
        session.set_ask_user_question_resume_diagnostic_sink(diagnostic_sink);

        sessions.insert(runtime_key, session.clone());
        session
    }

    /// Get the local/default compatibility session if it exists.
    pub async fn get_session(&self, workspace_id: &str) -> Option<Arc<ClaudeSession>> {
        self.get_session_for_provider(workspace_id, None).await
    }

    pub async fn get_session_for_provider(
        &self,
        workspace_id: &str,
        provider_profile_id: Option<&str>,
    ) -> Option<Arc<ClaudeSession>> {
        let runtime_key = provider_profile::claude_runtime_key(workspace_id, provider_profile_id);
        let sessions = self.sessions.lock().await;
        sessions.get(&runtime_key).cloned()
    }

    pub async fn get_session_by_locator(
        &self,
        workspace_id: &str,
        runtime_locator: &str,
    ) -> Option<Arc<ClaudeSession>> {
        let sessions = self.sessions.lock().await;
        sessions
            .values()
            .find(|session| {
                session.workspace_id == workspace_id && session.runtime_locator() == runtime_locator
            })
            .cloned()
    }

    pub async fn sessions_for_workspace(&self, workspace_id: &str) -> Vec<Arc<ClaudeSession>> {
        let sessions = self.sessions.lock().await;
        sessions
            .values()
            .filter(|session| session.workspace_id == workspace_id)
            .cloned()
            .collect()
    }

    pub async fn interrupt_workspace_sessions(&self, workspace_id: &str) -> Result<(), String> {
        let sessions = self.runtime_sessions_for_workspace(workspace_id).await;
        let mut failures = Vec::new();
        for (runtime_key, session) in sessions {
            if let Err(error) = session.interrupt().await {
                failures.push(format!("{runtime_key}: {error}"));
            }
        }
        if failures.is_empty() {
            return Ok(());
        }
        Err(format!(
            "Failed to interrupt {} Claude runtime(s) for workspace {}: {}",
            failures.len(),
            workspace_id,
            failures.join("; ")
        ))
    }

    pub async fn session_for_turn(
        &self,
        workspace_id: &str,
        turn_id: &str,
    ) -> Option<Arc<ClaudeSession>> {
        let sessions = self.sessions_for_workspace(workspace_id).await;
        for session in sessions {
            if session.has_active_turn(turn_id).await {
                return Some(session);
            }
        }
        None
    }

    pub async fn remove_runtime_session(&self, runtime_key: &str) -> Option<Arc<ClaudeSession>> {
        self.sessions.lock().await.remove(runtime_key)
    }

    pub async fn runtime_sessions_for_workspace(
        &self,
        workspace_id: &str,
    ) -> Vec<(String, Arc<ClaudeSession>)> {
        let sessions = self.sessions.lock().await;
        sessions
            .iter()
            .filter(|(_, session)| session.workspace_id == workspace_id)
            .map(|(runtime_key, session)| (runtime_key.clone(), session.clone()))
            .collect()
    }

    /// Snapshot all tracked sessions.
    pub async fn list_sessions(&self) -> Vec<(String, Arc<ClaudeSession>)> {
        let sessions = self.sessions.lock().await;
        sessions
            .values()
            .map(|session| (session.workspace_id.clone(), session.clone()))
            .collect()
    }

    /// Interrupt all active sessions (used during app shutdown)
    pub async fn interrupt_all(&self) {
        let sessions = self.sessions.lock().await;
        for session in sessions.values() {
            let _ = session.interrupt().await;
        }
    }
}

impl Default for ClaudeSessionManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod provider_config_tests {
    use super::*;

    #[tokio::test]
    async fn provider_binary_override_does_not_replace_local_claude_config() {
        let manager = ClaudeSessionManager::new();
        manager
            .set_config(EngineConfig {
                bin_path: Some("user-claude".to_string()),
                ..Default::default()
            })
            .await;
        manager
            .set_provider_config(
                provider_profile::CLAUDE_ACCOUNT_MANAGED_PROVIDER_PROFILE_ID,
                EngineConfig {
                    bin_path: Some("bundled-claude".to_string()),
                    ..Default::default()
                },
            )
            .await;

        let workspace = std::env::temp_dir();
        let local = manager
            .get_or_create_session_for_provider("workspace", &workspace, None)
            .await;
        let managed = manager
            .get_or_create_session_for_provider(
                "workspace",
                &workspace,
                Some(provider_profile::CLAUDE_ACCOUNT_MANAGED_PROVIDER_PROFILE_ID),
            )
            .await;

        assert_eq!(local.resolve_cli_binary(), "user-claude");
        assert_eq!(managed.resolve_cli_binary(), "bundled-claude");
    }
}
