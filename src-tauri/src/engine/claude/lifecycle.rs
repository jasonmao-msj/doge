use super::*;

impl ClaudeSession {
    pub(crate) fn is_prompt_too_long_error(error: &str) -> bool {
        let lower = error.to_ascii_lowercase();
        lower.contains("prompt is too long")
            || lower.contains("prompt too long")
            || lower.contains("maximum context length")
            || lower.contains("max context length")
            || lower.contains("context length exceeded")
            || lower.contains("token limit exceeded")
    }

    pub(crate) fn mark_retryable_prompt_too_long_error(error: &str) -> String {
        if error.starts_with(RETRYABLE_PROMPT_TOO_LONG_PREFIX) {
            return error.to_string();
        }
        format!("{RETRYABLE_PROMPT_TOO_LONG_PREFIX}{error}")
    }

    pub(crate) fn extract_retryable_prompt_too_long_error(error: &str) -> Option<String> {
        error
            .strip_prefix(RETRYABLE_PROMPT_TOO_LONG_PREFIX)
            .map(|value| value.to_string())
    }

    pub(crate) fn clear_retryable_prompt_too_long_marker(error: String) -> String {
        Self::extract_retryable_prompt_too_long_error(&error).unwrap_or(error)
    }

    fn normalize_compaction_signal_from_text(value: &str) -> Option<&'static str> {
        let normalized = value.trim().to_ascii_lowercase().replace(['-', ' '], "_");
        if normalized.is_empty() {
            return None;
        }
        if normalized.contains("compaction_failed")
            || normalized.contains("compact_failed")
            || normalized.contains("compactfailure")
        {
            return Some("compaction_failed");
        }
        if normalized.contains("compact_boundary") || normalized.contains("compacted") {
            return Some("compact_boundary");
        }
        if normalized.contains("compacting") {
            return Some("compacting");
        }
        None
    }

    pub(super) fn has_compaction_system_signal(event: &Value) -> bool {
        for key in [
            "subtype",
            "subType",
            "event",
            "event_type",
            "eventType",
            "name",
            "kind",
            "status",
            "phase",
            "state",
            "type",
        ] {
            if let Some(raw) = event.get(key).and_then(|value| value.as_str()) {
                if Self::normalize_compaction_signal_from_text(raw).is_some() {
                    return true;
                }
            }
        }
        false
    }

    fn emit_compaction_signal(
        &self,
        turn_id: &str,
        subtype: &str,
        extra_fields: Option<serde_json::Map<String, Value>>,
    ) {
        let mut payload = serde_json::Map::new();
        payload.insert("type".to_string(), Value::String("system".to_string()));
        payload.insert("subtype".to_string(), Value::String(subtype.to_string()));
        payload.insert(
            "source".to_string(),
            Value::String(AUTO_COMPACT_SIGNAL_SOURCE.to_string()),
        );
        if let Some(extra) = extra_fields {
            for (key, value) in extra {
                payload.insert(key, value);
            }
        }
        self.emit_turn_event(
            turn_id,
            EngineEvent::Raw {
                workspace_id: self.workspace_id.clone(),
                engine: EngineType::Claude,
                data: Value::Object(payload),
            },
        );
    }

    pub async fn send_message_with_auto_compact_retry(
        &self,
        params: SendMessageParams,
        turn_id: &str,
    ) -> Result<String, String> {
        let first_attempt = self.send_message(params.clone(), turn_id).await;
        let first_error = match first_attempt {
            Ok(response) => return Ok(response),
            Err(error) => error,
        };

        let trigger_error = match Self::extract_retryable_prompt_too_long_error(&first_error) {
            Some(error) => error,
            None => return Err(Self::clear_retryable_prompt_too_long_marker(first_error)),
        };

        log::warn!(
            "[claude] turn={} hit prompt-too-long boundary, triggering one-time /compact recovery",
            turn_id
        );

        self.emit_compaction_signal(turn_id, "compacting", None);

        let mut compact_params = params.clone();
        compact_params.text = "/compact".to_string();
        compact_params.images = None;
        compact_params.continue_session = true;
        if compact_params.session_id.is_none() {
            compact_params.session_id = self.get_session_id().await;
        }
        let compact_turn_id = format!("{turn_id}::auto-compact");
        if let Err(compact_error) = self.send_message(compact_params, &compact_turn_id).await {
            let compact_error = Self::clear_retryable_prompt_too_long_marker(compact_error);
            let failure_message = format!(
                "Prompt is too long and automatic /compact failed: {}",
                compact_error
            );
            let mut failure_payload = serde_json::Map::new();
            failure_payload.insert("reason".to_string(), Value::String(failure_message.clone()));
            self.emit_compaction_signal(turn_id, "compaction_failed", Some(failure_payload));
            self.emit_error(turn_id, failure_message.clone());
            return Err(failure_message);
        }

        let mut retry_params = params;
        retry_params.continue_session = true;
        if retry_params.session_id.is_none() {
            retry_params.session_id = self.get_session_id().await;
        }
        match self.send_message(retry_params, turn_id).await {
            Ok(response) => Ok(response),
            Err(retry_error) => {
                let retry_error = Self::clear_retryable_prompt_too_long_marker(retry_error);
                let final_message = format!(
                    "Prompt is too long. Retried once after /compact but still failed: {}",
                    retry_error
                );
                log::error!(
                    "[claude] auto /compact retry failed (turn={}): trigger={}, final={}",
                    turn_id,
                    trigger_error,
                    final_message
                );
                self.emit_error(turn_id, final_message.clone());
                Err(final_message)
            }
        }
    }

    /// Variant of `send_message_with_auto_compact_retry` that threads a
    /// caller-owned `AppSettings` snapshot through every internal
    /// `send_message` call. The snapshot reaches `build_command`, which
    /// is the only place that reads `enabled_curated_skill_ids` to build
    /// the `--append-system-prompt` body. Without this variant the auto
    /// compact retry path silently drops the snapshot, so a curated
    /// skill that was enabled after the first attempt's settings clone
    /// would not be injected on retry.
    #[allow(dead_code)] // callers live in the daemon source tree; the lib
                        // build cannot see those references and the
                        // method is otherwise correct.
    pub async fn send_message_with_auto_compact_retry_with_app_settings(
        &self,
        params: SendMessageParams,
        turn_id: &str,
        app_settings: Option<&crate::types::AppSettings>,
    ) -> Result<String, String> {
        self.send_message_with_auto_compact_retry_with_launch_context(
            params,
            turn_id,
            app_settings,
            None,
        )
        .await
    }

    pub async fn send_message_with_auto_compact_retry_with_launch_context(
        &self,
        params: SendMessageParams,
        turn_id: &str,
        app_settings: Option<&crate::types::AppSettings>,
        provider_env: Option<&BTreeMap<String, String>>,
    ) -> Result<String, String> {
        let first_attempt = self
            .send_message_with_app_settings_and_provider_env(
                params.clone(),
                turn_id,
                app_settings,
                provider_env,
            )
            .await;
        let first_error = match first_attempt {
            Ok(response) => return Ok(response),
            Err(error) => error,
        };

        let trigger_error = match Self::extract_retryable_prompt_too_long_error(&first_error) {
            Some(error) => error,
            None => return Err(Self::clear_retryable_prompt_too_long_marker(first_error)),
        };

        log::warn!(
            "[claude] turn={} hit prompt-too-long boundary, triggering one-time /compact recovery",
            turn_id
        );

        self.emit_compaction_signal(turn_id, "compacting", None);

        let mut compact_params = params.clone();
        compact_params.text = "/compact".to_string();
        compact_params.images = None;
        compact_params.continue_session = true;
        if compact_params.session_id.is_none() {
            compact_params.session_id = self.get_session_id().await;
        }
        let compact_turn_id = format!("{turn_id}::auto-compact");
        if let Err(compact_error) = self
            .send_message_with_app_settings_and_provider_env(
                compact_params,
                &compact_turn_id,
                app_settings,
                provider_env,
            )
            .await
        {
            let compact_error = Self::clear_retryable_prompt_too_long_marker(compact_error);
            let failure_message = format!(
                "Prompt is too long and automatic /compact failed: {}",
                compact_error
            );
            let mut failure_payload = serde_json::Map::new();
            failure_payload.insert("reason".to_string(), Value::String(failure_message.clone()));
            self.emit_compaction_signal(turn_id, "compaction_failed", Some(failure_payload));
            self.emit_error(turn_id, failure_message.clone());
            return Err(failure_message);
        }

        let mut retry_params = params;
        retry_params.continue_session = true;
        if retry_params.session_id.is_none() {
            retry_params.session_id = self.get_session_id().await;
        }
        match self
            .send_message_with_app_settings_and_provider_env(
                retry_params,
                turn_id,
                app_settings,
                provider_env,
            )
            .await
        {
            Ok(response) => Ok(response),
            Err(retry_error) => {
                let retry_error = Self::clear_retryable_prompt_too_long_marker(retry_error);
                let final_message = format!(
                    "Prompt is too long. Retried once after /compact but still failed: {}",
                    retry_error
                );
                log::error!(
                    "[claude] auto /compact retry failed (turn={}): trigger={}, final={}",
                    turn_id,
                    trigger_error,
                    final_message
                );
                self.emit_error(turn_id, final_message.clone());
                Err(final_message)
            }
        }
    }

    /// Try to extract context window usage from any event
    /// Claude CLI may provide usage data in multiple locations:
    /// 1. context_window.current_usage (statusline/hooks - most accurate)
    /// 2. message.usage (assistant events)
    /// 3. usage (top-level usage field)
    pub(super) fn try_extract_context_window_usage(&self, turn_id: &str, event: &Value) {
        let usage_snapshot = self.find_usage_data(event);

        if usage_snapshot.context_used_tokens.is_some()
            || usage_snapshot.model_context_window.is_some()
            || usage_snapshot.input_tokens.is_some()
            || usage_snapshot.output_tokens.is_some()
            || usage_snapshot.cached_tokens.is_some()
            || usage_snapshot.used_percent.is_some()
            || usage_snapshot.remaining_percent.is_some()
        {
            log::debug!(
                "[claude] Emitting UsageUpdate: input={:?}, output={:?}, cached={:?}, window={:?}, context_used={:?}, source={}",
                usage_snapshot.input_tokens,
                usage_snapshot.output_tokens,
                usage_snapshot.cached_tokens,
                usage_snapshot.model_context_window,
                usage_snapshot.context_used_tokens,
                usage_snapshot.source
            );
            self.emit_turn_event(
                turn_id,
                EngineEvent::UsageUpdate {
                    workspace_id: self.workspace_id.clone(),
                    input_tokens: usage_snapshot.input_tokens,
                    output_tokens: usage_snapshot.output_tokens,
                    cached_tokens: usage_snapshot.cached_tokens,
                    model_context_window: usage_snapshot.model_context_window,
                    context_used_tokens: usage_snapshot.context_used_tokens,
                    context_usage_source: Some(usage_snapshot.source.to_string()),
                    context_usage_freshness: Some(usage_snapshot.freshness.to_string()),
                    context_used_percent: usage_snapshot.used_percent,
                    context_remaining_percent: usage_snapshot.remaining_percent,
                    context_tool_usages: None,
                    context_tool_usages_truncated: None,
                    context_category_usages: None,
                },
            );
        }
    }

    /// Find usage data from various locations in the event
    fn find_usage_data(&self, event: &Value) -> ClaudeUsageSnapshot {
        // 回合结束的 result 事件顶层 usage 是整轮累计统计（每次 API 调用的
        // input/cache_read 相加，远超上下文窗口），不代表当前上下文占用；
        // 对 result 事件跳过顶层 usage 兜底，只信任 context_window 快照。
        let is_result_event = event
            .get("type")
            .and_then(Value::as_str)
            .map(|value| value.eq_ignore_ascii_case("result"))
            .unwrap_or(false);
        let top_level_usage = if is_result_event {
            None
        } else {
            find_usage(event)
        };
        if let Some(context_window) = find_context_window(event) {
            log::debug!(
                "[claude] Found context_window field: {}",
                serde_json::to_string_pretty(context_window)
                    .unwrap_or_else(|_| context_window.to_string())
            );

            let model_context_window = context_window
                .get("context_window_size")
                .or_else(|| context_window.get("contextWindowSize"))
                .and_then(as_i64)
                .filter(|value| *value > 0);
            let used_percent = context_window
                .get("used_percentage")
                .or_else(|| context_window.get("usedPercentage"))
                .and_then(as_f64);
            let remaining_percent = context_window
                .get("remaining_percentage")
                .or_else(|| context_window.get("remainingPercentage"))
                .and_then(as_f64);

            let current_usage = context_window
                .get("current_usage")
                .or_else(|| context_window.get("currentUsage"));

            if let Some(current_usage) = current_usage {
                let usage = if current_usage.is_object() {
                    Some(current_usage)
                } else {
                    None
                };
                let usage_totals = usage
                    .or_else(|| message_usage(event))
                    .or(top_level_usage)
                    .map(read_usage_totals)
                    .unwrap_or_default();
                let context_used_tokens = as_i64(current_usage).or_else(|| {
                    if current_usage.is_object() {
                        usage_totals.context_used_tokens()
                    } else {
                        None
                    }
                });
                return ClaudeUsageSnapshot {
                    input_tokens: usage_totals.input_tokens,
                    output_tokens: usage_totals.output_tokens,
                    cached_tokens: usage_totals.cached_tokens,
                    context_used_tokens,
                    model_context_window,
                    source: "context_window",
                    freshness: "live",
                    used_percent,
                    remaining_percent,
                };
            }

            if model_context_window.is_some()
                || used_percent.is_some()
                || remaining_percent.is_some()
            {
                let usage_totals = message_usage(event)
                    .or(top_level_usage)
                    .map(read_usage_totals)
                    .unwrap_or_default();
                return ClaudeUsageSnapshot {
                    input_tokens: usage_totals.input_tokens,
                    output_tokens: usage_totals.output_tokens,
                    cached_tokens: usage_totals.cached_tokens,
                    context_used_tokens: None,
                    model_context_window,
                    source: "context_window",
                    freshness: "live",
                    used_percent,
                    remaining_percent,
                };
            }
        }

        if let Some(usage) = message_usage(event) {
            log::debug!(
                "[claude] Found message.usage field: {}",
                serde_json::to_string_pretty(usage).unwrap_or_else(|_| usage.to_string())
            );
            let usage_totals = read_usage_totals(usage);
            return ClaudeUsageSnapshot {
                input_tokens: usage_totals.input_tokens,
                output_tokens: usage_totals.output_tokens,
                cached_tokens: usage_totals.cached_tokens,
                context_used_tokens: usage_totals.context_used_tokens(),
                model_context_window: None,
                source: "message_usage",
                freshness: "estimated",
                used_percent: None,
                remaining_percent: None,
            };
        }

        if let Some(usage) = top_level_usage {
            log::debug!(
                "[claude] Found top-level usage field: {}",
                serde_json::to_string_pretty(usage).unwrap_or_else(|_| usage.to_string())
            );
            let usage_totals = read_usage_totals(usage);
            return ClaudeUsageSnapshot {
                input_tokens: usage_totals.input_tokens,
                output_tokens: usage_totals.output_tokens,
                cached_tokens: usage_totals.cached_tokens,
                context_used_tokens: usage_totals.context_used_tokens(),
                model_context_window: None,
                source: "top_level_usage",
                freshness: "estimated",
                used_percent: None,
                remaining_percent: None,
            };
        }

        log::debug!(
            "[claude] No usage data found in event type: {:?}",
            event.get("type").and_then(|v| v.as_str())
        );
        ClaudeUsageSnapshot {
            input_tokens: None,
            output_tokens: None,
            cached_tokens: None,
            context_used_tokens: None,
            model_context_window: None,
            source: "none",
            freshness: "pending",
            used_percent: None,
            remaining_percent: None,
        }
    }
}

struct ClaudeUsageSnapshot {
    input_tokens: Option<i64>,
    output_tokens: Option<i64>,
    cached_tokens: Option<i64>,
    context_used_tokens: Option<i64>,
    model_context_window: Option<i64>,
    source: &'static str,
    freshness: &'static str,
    used_percent: Option<f64>,
    remaining_percent: Option<f64>,
}

#[derive(Default)]
struct ClaudeUsageTotals {
    input_tokens: Option<i64>,
    output_tokens: Option<i64>,
    cached_tokens: Option<i64>,
}

impl ClaudeUsageTotals {
    fn context_used_tokens(&self) -> Option<i64> {
        match (self.input_tokens, self.cached_tokens) {
            (Some(input), Some(cached)) => input.checked_add(cached),
            (Some(input), None) => Some(input),
            (None, Some(cached)) => Some(cached),
            (None, None) => None,
        }
    }
}

fn message_usage(event: &Value) -> Option<&Value> {
    event
        .get("message")
        .and_then(|message| {
            message
                .get("usage")
                .or_else(|| message.get("usage_delta"))
                .or_else(|| message.get("usageDelta"))
        })
        .or_else(|| {
            event
                .get("payload")
                .and_then(|payload| message_usage(payload))
        })
        .or_else(|| event.get("data").and_then(|data| message_usage(data)))
}

fn find_context_window(event: &Value) -> Option<&Value> {
    event
        .get("context_window")
        .or_else(|| event.get("contextWindow"))
        .or_else(|| {
            event
                .get("payload")
                .and_then(|payload| find_context_window(payload))
        })
        .or_else(|| event.get("data").and_then(|data| find_context_window(data)))
        .or_else(|| event.get("hook").and_then(|hook| find_context_window(hook)))
}

fn find_usage(event: &Value) -> Option<&Value> {
    event
        .get("usage")
        .or_else(|| event.get("usage_delta"))
        .or_else(|| event.get("usageDelta"))
        .or_else(|| event.get("payload").and_then(|payload| find_usage(payload)))
        .or_else(|| event.get("data").and_then(|data| find_usage(data)))
}

fn read_usage_totals(usage: &Value) -> ClaudeUsageTotals {
    let input_tokens = usage
        .get("input_tokens")
        .or_else(|| usage.get("inputTokens"))
        .and_then(as_i64);

    let output_tokens = usage
        .get("output_tokens")
        .or_else(|| usage.get("outputTokens"))
        .and_then(as_i64);

    let cache_creation = usage
        .get("cache_creation_input_tokens")
        .or_else(|| usage.get("cacheCreationInputTokens"))
        .or_else(|| usage.get("cache_creation_tokens"))
        .and_then(as_i64)
        .unwrap_or(0);

    let cache_read = usage
        .get("cache_read_input_tokens")
        .or_else(|| usage.get("cacheReadInputTokens"))
        .or_else(|| usage.get("cache_read_tokens"))
        .and_then(as_i64)
        .unwrap_or(0);

    let cached_tokens = if cache_creation > 0 || cache_read > 0 {
        cache_creation.checked_add(cache_read)
    } else {
        None
    };

    ClaudeUsageTotals {
        input_tokens,
        output_tokens,
        cached_tokens,
    }
}

fn as_i64(value: &Value) -> Option<i64> {
    if let Some(number) = value.as_i64() {
        return (number >= 0).then_some(number);
    }
    value
        .as_str()
        .and_then(|text| text.parse::<i64>().ok())
        .filter(|number| *number >= 0)
}

fn as_f64(value: &Value) -> Option<f64> {
    if let Some(number) = value.as_f64() {
        return (number.is_finite() && number >= 0.0).then_some(number);
    }
    value
        .as_str()
        .and_then(|text| text.parse::<f64>().ok())
        .filter(|number| number.is_finite() && *number >= 0.0)
}
