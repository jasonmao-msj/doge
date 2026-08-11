//! Canonical Fact 字段级校验。
//!
//! 规则来源：Wave 0 `shared-canonical-entry.schema.json` 的必填字段、枚举值与互斥条件。
//! 非法 payload 返回 typed `FactValidationError`，不进入 SQLite。

use std::fmt;

use super::types::{
    ArtifactRef, AtomicToolExchange, CanonicalAssistantBlocks, CanonicalBlock, CanonicalFact,
    CanonicalOmission, CanonicalUserInput, ControlFact, DeliveryAcceptedFact, DeliveryPreparedFact,
    Outcome, OutcomeStatus, ProviderPrivateRef, SquadBranchBlockedFact, SquadCancelRequestedFact,
    SquadMutationLeaseChangedFact, SquadNodeAttemptLinkedFact, SquadNodeDispatchPreparedFact,
    SquadNodeOutcomeRecordedFact, SquadPlanApprovedFact, SquadPlanProposedFact,
    SquadPlanRevisedFact, SquadRunRequestedFact, SquadRunSettledFact,
    SquadVerificationRecordedFact, ToolResult, TurnAcceptedFact, TurnCommittedFact,
    TurnExecutionSnapshot, TurnRequestedFact, UsageRecordedFact,
};

/// 校验错误。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FactValidationError {
    pub context: String,
    pub detail: String,
}

impl FactValidationError {
    pub fn new(context: impl Into<String>, detail: impl Into<String>) -> Self {
        Self {
            context: context.into(),
            detail: detail.into(),
        }
    }
}

impl fmt::Display for FactValidationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.context, self.detail)
    }
}

impl std::error::Error for FactValidationError {}

/// 校验任意 canonical fact。
pub fn validate_fact(fact: &CanonicalFact) -> Result<(), FactValidationError> {
    match fact {
        CanonicalFact::TurnRequested(f) => validate_turn_requested(f),
        CanonicalFact::DeliveryPrepared(f) => validate_delivery_prepared(f),
        CanonicalFact::DeliveryAccepted(f) => validate_delivery_accepted(f),
        CanonicalFact::TurnAccepted(f) => validate_turn_accepted(f),
        CanonicalFact::TurnCommitted(f) => validate_turn_committed(f),
        CanonicalFact::UsageRecorded(f) => validate_usage_recorded(f),
        CanonicalFact::Control(f) => validate_control(f),
        CanonicalFact::SquadRunRequested(f) => validate_squad_run_requested(f),
        CanonicalFact::SquadPlanProposed(f) => validate_squad_plan_proposed(f),
        CanonicalFact::SquadPlanApproved(f) => validate_squad_plan_approved(f),
        CanonicalFact::SquadPlanRevised(f) => validate_squad_plan_revised(f),
        CanonicalFact::SquadNodeDispatchPrepared(f) => validate_squad_dispatch_prepared(f),
        CanonicalFact::SquadNodeAttemptLinked(f) => validate_squad_attempt_linked(f),
        CanonicalFact::SquadNodeOutcomeRecorded(f) => validate_squad_outcome_recorded(f),
        CanonicalFact::SquadVerificationRecorded(f) => validate_squad_verification_recorded(f),
        CanonicalFact::SquadMutationLeaseChanged(f) => validate_squad_lease_changed(f),
        CanonicalFact::SquadBranchBlocked(f) => validate_squad_branch_blocked(f),
        CanonicalFact::SquadCancelRequested(f) => validate_squad_cancel_requested(f),
        CanonicalFact::SquadRunSettled(f) => validate_squad_run_settled(f),
    }
}

fn require_non_empty(value: &str, name: &str, context: &str) -> Result<(), FactValidationError> {
    if value.is_empty() {
        return Err(FactValidationError::new(
            context,
            format!("{name} must be non-empty"),
        ));
    }
    Ok(())
}

fn validate_turn_requested(f: &TurnRequestedFact) -> Result<(), FactValidationError> {
    let ctx = "conversation.turnRequested";
    require_non_empty(&f.logical_turn_id, "logicalTurnId", ctx)?;
    require_non_empty(&f.attempt_id, "attemptId", ctx)?;
    validate_optional_non_empty(&f.retry_of_attempt_id, "retryOfAttemptId", ctx)?;
    validate_user_input(&f.input, ctx)?;
    validate_turn_execution_snapshot(&f.target, ctx)?;
    validate_timestamp(f.requested_at, "requestedAt", ctx)?;
    Ok(())
}

fn validate_delivery_prepared(f: &DeliveryPreparedFact) -> Result<(), FactValidationError> {
    let ctx = "context.deliveryPrepared";
    require_non_empty(&f.logical_turn_id, "logicalTurnId", ctx)?;
    require_non_empty(&f.attempt_id, "attemptId", ctx)?;
    require_non_empty(&f.binding_key, "bindingKey", ctx)?;
    require_non_empty(&f.package_id, "packageId", ctx)?;
    validate_payload_checksum(&f.source_checksum, "sourceChecksum", ctx)?;
    if let Some(from_sequence) = f.from_sequence_exclusive {
        validate_timestamp(from_sequence, "fromSequenceExclusive", ctx)?;
    }
    validate_timestamp(
        f.through_sequence_inclusive,
        "throughSequenceInclusive",
        ctx,
    )?;
    Ok(())
}

fn validate_delivery_accepted(f: &DeliveryAcceptedFact) -> Result<(), FactValidationError> {
    let ctx = "context.deliveryAccepted";
    require_non_empty(&f.logical_turn_id, "logicalTurnId", ctx)?;
    require_non_empty(&f.attempt_id, "attemptId", ctx)?;
    require_non_empty(&f.binding_key, "bindingKey", ctx)?;
    require_non_empty(&f.package_id, "packageId", ctx)?;
    validate_optional_non_empty(&f.native_request_id, "nativeRequestId", ctx)?;
    validate_timestamp(f.accepted_at, "acceptedAt", ctx)?;
    Ok(())
}

fn validate_turn_accepted(f: &TurnAcceptedFact) -> Result<(), FactValidationError> {
    let ctx = "conversation.turnAccepted";
    require_non_empty(&f.logical_turn_id, "logicalTurnId", ctx)?;
    require_non_empty(&f.attempt_id, "attemptId", ctx)?;
    require_non_empty(&f.client_turn_id, "clientTurnId", ctx)?;
    require_non_empty(&f.binding_key, "bindingKey", ctx)?;
    require_non_empty(&f.native_session_id, "nativeSessionId", ctx)?;
    validate_optional_non_empty(&f.native_turn_id, "nativeTurnId", ctx)?;
    validate_timestamp(f.accepted_at, "acceptedAt", ctx)?;
    Ok(())
}

fn validate_turn_committed(f: &TurnCommittedFact) -> Result<(), FactValidationError> {
    let ctx = "conversation.turnCommitted";
    require_non_empty(&f.logical_turn_id, "logicalTurnId", ctx)?;
    require_non_empty(&f.attempt_id, "attemptId", ctx)?;
    require_non_empty(&f.input_entry_id, "inputEntryId", ctx)?;
    validate_assistant_blocks(&f.assistant, ctx)?;
    validate_outcome(&f.outcome, ctx)?;
    validate_turn_execution_snapshot(&f.target, ctx)?;
    validate_timestamp(f.committed_at, "committedAt", ctx)?;
    for (index, exchange) in f.atomic_tool_exchanges.iter().enumerate() {
        validate_atomic_tool_exchange(exchange, &format!("{ctx}.atomicToolExchanges[{index}]"))?;
    }
    for (index, artifact) in f.artifact_refs.iter().enumerate() {
        validate_artifact_ref(artifact, &format!("{ctx}.artifactRefs[{index}]"))?;
    }
    for (index, omission) in f.omissions.iter().enumerate() {
        validate_omission(omission, &format!("{ctx}.omissions[{index}]"))?;
    }
    for (index, pref) in f.provider_private_refs.iter().enumerate() {
        validate_provider_private_ref(pref, &format!("{ctx}.providerPrivateRefs[{index}]"))?;
    }
    Ok(())
}

fn validate_usage_recorded(f: &UsageRecordedFact) -> Result<(), FactValidationError> {
    let ctx = "conversation.usageRecorded";
    require_non_empty(&f.usage_record_id, "usageRecordId", ctx)?;
    require_non_empty(&f.report_subject_id, "reportSubjectId", ctx)?;
    require_non_empty(&f.logical_turn_id, "logicalTurnId", ctx)?;
    require_non_empty(&f.attempt_id, "attemptId", ctx)?;
    require_non_empty(&f.binding_key, "bindingKey", ctx)?;
    require_non_empty(&f.native_session_id, "nativeSessionId", ctx)?;
    validate_optional_non_empty(
        &f.supersedes_usage_record_id,
        "supersedesUsageRecordId",
        ctx,
    )?;
    validate_optional_non_empty(&f.native_turn_id, "nativeTurnId", ctx)?;
    validate_turn_execution_snapshot(&f.target, ctx)?;
    validate_usage_shape(&f.usage, ctx)?;
    validate_timestamp(f.observed_at, "observedAt", ctx)?;
    if f.revision < 1 {
        return Err(FactValidationError::new(ctx, "revision must be >= 1"));
    }
    Ok(())
}

fn validate_control(f: &ControlFact) -> Result<(), FactValidationError> {
    let ctx = "conversation.controlFact";
    validate_control_kind(&f.control_kind, ctx)?;
    validate_optional_non_empty(&f.logical_turn_id, "logicalTurnId", ctx)?;
    validate_optional_non_empty(&f.attempt_id, "attemptId", ctx)?;
    validate_optional_non_empty(&f.binding_key, "bindingKey", ctx)?;
    if let Some(details) = &f.details {
        if !details.is_object() {
            return Err(FactValidationError::new(ctx, "details must be an object"));
        }
    }
    Ok(())
}

fn validate_squad_identity(
    fact_id: &str,
    run_id: &str,
    ctx: &str,
) -> Result<(), FactValidationError> {
    require_non_empty(fact_id, "factId", ctx)?;
    require_non_empty(run_id, "runId", ctx)
}

fn validate_squad_plan_value(
    plan: &serde_json::Value,
    ctx: &str,
) -> Result<(), FactValidationError> {
    // Multi-Agent V1：plan 以 markdown/summary 为主；兼容历史 DAG plan object。
    if !plan.is_object() {
        return Err(FactValidationError::new(ctx, "plan must be an object"));
    }
    let summary = plan
        .get("summary")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .unwrap_or("");
    if summary.is_empty() {
        return Err(FactValidationError::new(
            ctx,
            "plan.summary must be non-empty",
        ));
    }
    let has_markdown = plan
        .get("markdown")
        .and_then(|value| value.as_str())
        .is_some_and(|value| !value.trim().is_empty());
    let has_nodes = plan
        .get("nodes")
        .and_then(|value| value.as_array())
        .is_some_and(|nodes| !nodes.is_empty());
    if !has_markdown && !has_nodes {
        return Err(FactValidationError::new(
            ctx,
            "plan must include markdown or nodes",
        ));
    }
    Ok(())
}

fn validate_squad_run_requested(f: &SquadRunRequestedFact) -> Result<(), FactValidationError> {
    let ctx = "squad.runRequested";
    validate_squad_identity(&f.fact_id, &f.run_id, ctx)?;
    require_non_empty(&f.workspace_id, "workspaceId", ctx)?;
    require_non_empty(&f.request_text, "requestText", ctx)?;
    validate_turn_execution_snapshot(&f.lead_target, ctx)?;
    validate_timestamp(f.requested_at, "requestedAt", ctx)
}

fn validate_squad_plan_proposed(f: &SquadPlanProposedFact) -> Result<(), FactValidationError> {
    let ctx = "squad.planProposed";
    validate_squad_identity(&f.fact_id, &f.run_id, ctx)?;
    if f.revision != 1 {
        return Err(FactValidationError::new(ctx, "revision must be 1"));
    }
    validate_squad_plan_value(&f.plan, ctx)?;
    validate_timestamp(f.proposed_at, "proposedAt", ctx)
}

fn validate_squad_plan_approved(f: &SquadPlanApprovedFact) -> Result<(), FactValidationError> {
    let ctx = "squad.planApproved";
    validate_squad_identity(&f.fact_id, &f.run_id, ctx)?;
    if f.revision == 0 {
        return Err(FactValidationError::new(ctx, "revision must be >= 1"));
    }
    validate_timestamp(f.approved_at, "approvedAt", ctx)
}

fn validate_squad_plan_revised(f: &SquadPlanRevisedFact) -> Result<(), FactValidationError> {
    let ctx = "squad.planRevised";
    validate_squad_identity(&f.fact_id, &f.run_id, ctx)?;
    if f.revision < 2 {
        return Err(FactValidationError::new(ctx, "revision must be >= 2"));
    }
    validate_squad_plan_value(&f.plan, ctx)?;
    validate_timestamp(f.revised_at, "revisedAt", ctx)
}

fn validate_squad_dispatch_prepared(
    f: &SquadNodeDispatchPreparedFact,
) -> Result<(), FactValidationError> {
    let ctx = "squad.nodeDispatchPrepared";
    validate_squad_identity(&f.fact_id, &f.run_id, ctx)?;
    require_non_empty(&f.node_id, "nodeId", ctx)?;
    require_non_empty(&f.attempt_id, "attemptId", ctx)?;
    require_non_empty(&f.worker_binding_key, "workerBindingKey", ctx)?;
    if !matches!(
        f.permission_class.as_str(),
        "read-only" | "current-workspace"
    ) {
        return Err(FactValidationError::new(
            ctx,
            "permissionClass must be read-only or current-workspace",
        ));
    }
    validate_turn_execution_snapshot(&f.target, ctx)?;
    validate_timestamp(f.prepared_at, "preparedAt", ctx)
}

fn validate_squad_attempt_linked(
    f: &SquadNodeAttemptLinkedFact,
) -> Result<(), FactValidationError> {
    let ctx = "squad.nodeAttemptLinked";
    validate_squad_identity(&f.fact_id, &f.run_id, ctx)?;
    require_non_empty(&f.node_id, "nodeId", ctx)?;
    require_non_empty(&f.attempt_id, "attemptId", ctx)?;
    require_non_empty(&f.logical_turn_id, "logicalTurnId", ctx)?;
    require_non_empty(&f.worker_binding_key, "workerBindingKey", ctx)?;
    validate_timestamp(f.linked_at, "linkedAt", ctx)
}

fn validate_squad_outcome_recorded(
    f: &SquadNodeOutcomeRecordedFact,
) -> Result<(), FactValidationError> {
    let ctx = "squad.nodeOutcomeRecorded";
    validate_squad_identity(&f.fact_id, &f.run_id, ctx)?;
    require_non_empty(&f.node_id, "nodeId", ctx)?;
    require_non_empty(&f.attempt_id, "attemptId", ctx)?;
    if !f.outcome.is_object() {
        return Err(FactValidationError::new(ctx, "outcome must be an object"));
    }
    let summary = f
        .outcome
        .get("summary")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .unwrap_or("");
    if summary.is_empty() {
        return Err(FactValidationError::new(
            ctx,
            "outcome.summary must be non-empty",
        ));
    }
    validate_timestamp(f.recorded_at, "recordedAt", ctx)
}

fn validate_squad_verification_recorded(
    f: &SquadVerificationRecordedFact,
) -> Result<(), FactValidationError> {
    let ctx = "squad.verificationRecorded";
    validate_squad_identity(&f.fact_id, &f.run_id, ctx)?;
    require_non_empty(&f.node_id, "nodeId", ctx)?;
    require_non_empty(&f.attempt_id, "attemptId", ctx)?;
    if !f.verification.is_object() {
        return Err(FactValidationError::new(
            ctx,
            "verification must be an object",
        ));
    }
    validate_timestamp(f.recorded_at, "recordedAt", ctx)
}

fn validate_squad_lease_changed(
    f: &SquadMutationLeaseChangedFact,
) -> Result<(), FactValidationError> {
    let ctx = "squad.mutationLeaseChanged";
    validate_squad_identity(&f.fact_id, &f.run_id, ctx)?;
    require_non_empty(&f.workspace_id, "workspaceId", ctx)?;
    require_non_empty(&f.node_id, "nodeId", ctx)?;
    require_non_empty(&f.attempt_id, "attemptId", ctx)?;
    if f.lease_epoch == 0 {
        return Err(FactValidationError::new(ctx, "leaseEpoch must be >= 1"));
    }
    if !matches!(f.change.as_str(), "acquired" | "released" | "blocked") {
        return Err(FactValidationError::new(
            ctx,
            "change must be acquired, released, or blocked",
        ));
    }
    validate_timestamp(f.changed_at, "changedAt", ctx)
}

fn validate_squad_branch_blocked(f: &SquadBranchBlockedFact) -> Result<(), FactValidationError> {
    let ctx = "squad.branchBlocked";
    validate_squad_identity(&f.fact_id, &f.run_id, ctx)?;
    validate_optional_non_empty(&f.node_id, "nodeId", ctx)?;
    require_non_empty(&f.reason, "reason", ctx)?;
    if f.details
        .as_ref()
        .is_some_and(|details| !details.is_object())
    {
        return Err(FactValidationError::new(ctx, "details must be an object"));
    }
    validate_timestamp(f.blocked_at, "blockedAt", ctx)
}

fn validate_squad_cancel_requested(
    f: &SquadCancelRequestedFact,
) -> Result<(), FactValidationError> {
    let ctx = "squad.cancelRequested";
    validate_squad_identity(&f.fact_id, &f.run_id, ctx)?;
    require_non_empty(&f.reason, "reason", ctx)?;
    validate_timestamp(f.requested_at, "requestedAt", ctx)
}

fn validate_squad_run_settled(f: &SquadRunSettledFact) -> Result<(), FactValidationError> {
    let ctx = "squad.runSettled";
    validate_squad_identity(&f.fact_id, &f.run_id, ctx)?;
    if !matches!(
        f.status.as_str(),
        "succeeded" | "failed" | "blocked" | "cancelled"
    ) {
        return Err(FactValidationError::new(
            ctx,
            "status must be a terminal Squad status",
        ));
    }
    validate_optional_non_empty(&f.summary, "summary", ctx)?;
    validate_timestamp(f.settled_at, "settledAt", ctx)
}

fn validate_user_input(input: &CanonicalUserInput, ctx: &str) -> Result<(), FactValidationError> {
    let has_text = input.text.is_some();
    let has_images = input.image_refs.is_some();
    let has_attachments = input.attachment_refs.is_some();
    if !has_text && !has_images && !has_attachments {
        return Err(FactValidationError::new(
            ctx,
            "input must contain at least one of text/imageRefs/attachmentRefs",
        ));
    }
    if let Some(refs) = &input.image_refs {
        for (index, artifact) in refs.iter().enumerate() {
            validate_artifact_ref(artifact, &format!("{ctx}.input.imageRefs[{index}]"))?;
        }
    }
    if let Some(refs) = &input.attachment_refs {
        for (index, artifact) in refs.iter().enumerate() {
            validate_artifact_ref(artifact, &format!("{ctx}.input.attachmentRefs[{index}]"))?;
        }
    }
    Ok(())
}

fn validate_turn_execution_snapshot(
    snapshot: &TurnExecutionSnapshot,
    ctx: &str,
) -> Result<(), FactValidationError> {
    if !matches!(
        snapshot.engine.as_str(),
        "claude" | "codex" | "gemini" | "kimi" | "grok" | "opencode"
    ) {
        return Err(FactValidationError::new(
            ctx,
            format!("unknown engine enum value: {}", snapshot.engine),
        ));
    }
    validate_optional_non_empty(&snapshot.provider_profile_id, "providerProfileId", ctx)?;
    validate_optional_non_empty(&snapshot.model_catalog_entry_id, "modelCatalogEntryId", ctx)?;
    validate_optional_non_empty(&snapshot.model, "model", ctx)?;
    validate_optional_non_empty(
        &snapshot.provider_profile_name_snapshot,
        "providerProfileNameSnapshot",
        ctx,
    )?;
    validate_optional_non_empty(
        &snapshot.runtime_capability_fingerprint,
        "runtimeCapabilityFingerprint",
        ctx,
    )?;
    if let Some(reasoning) = &snapshot.reasoning {
        require_non_empty(&reasoning.effort, "reasoning.effort", ctx)?;
    }
    Ok(())
}

fn validate_assistant_blocks(
    blocks: &CanonicalAssistantBlocks,
    ctx: &str,
) -> Result<(), FactValidationError> {
    for (index, block) in blocks.blocks.iter().enumerate() {
        validate_block(block, &format!("{ctx}.assistant.blocks[{index}]"))?;
    }
    Ok(())
}

fn validate_block(block: &CanonicalBlock, ctx: &str) -> Result<(), FactValidationError> {
    match block {
        CanonicalBlock::Text { text } => {
            // text 允许为空字符串（如占位），不强制非空。
            let _ = text;
        }
        CanonicalBlock::Reasoning { text } => {
            let _ = text;
        }
        CanonicalBlock::RedactedReasoning { artifact_ref } => {
            if let Some(artifact_ref) = artifact_ref {
                validate_artifact_ref(artifact_ref, ctx)?;
            }
        }
        CanonicalBlock::ArtifactRef { artifact_ref } => {
            validate_artifact_ref(artifact_ref, ctx)?;
        }
    }
    Ok(())
}

fn validate_atomic_tool_exchange(
    exchange: &AtomicToolExchange,
    ctx: &str,
) -> Result<(), FactValidationError> {
    require_non_empty(&exchange.tool_call_id, "toolCallId", ctx)?;
    require_non_empty(&exchange.tool_name, "toolName", ctx)?;
    if let Some(artifact) = &exchange.call.arguments_artifact_ref {
        validate_artifact_ref(artifact, &format!("{ctx}.call.argumentsArtifactRef"))?;
    }
    validate_tool_result(&exchange.result, &format!("{ctx}.result"))?;
    Ok(())
}

fn validate_tool_result(result: &ToolResult, ctx: &str) -> Result<(), FactValidationError> {
    if let Some(artifact) = &result.output_artifact_ref {
        validate_artifact_ref(artifact, &format!("{ctx}.outputArtifactRef"))?;
    }
    if matches!(result.status, super::types::ToolResultStatus::Error) {
        if result.error_message.as_ref().map_or(true, |s| s.is_empty()) {
            return Err(FactValidationError::new(
                ctx,
                "error result must include errorMessage",
            ));
        }
    }
    Ok(())
}

fn validate_omission(omission: &CanonicalOmission, ctx: &str) -> Result<(), FactValidationError> {
    require_non_empty(&omission.category, "category", ctx)?;
    if let Some(retrievable_ref) = &omission.retrievable_ref {
        require_non_empty(retrievable_ref, "retrievableRef", ctx)?;
    }
    Ok(())
}

fn validate_provider_private_ref(
    pref: &ProviderPrivateRef,
    ctx: &str,
) -> Result<(), FactValidationError> {
    require_non_empty(&pref.ref_id, "refId", ctx)?;
    if !matches!(
        pref.engine.as_str(),
        "claude" | "codex" | "gemini" | "kimi" | "grok" | "opencode"
    ) {
        return Err(FactValidationError::new(
            ctx,
            format!("unknown engine enum value: {}", pref.engine),
        ));
    }
    validate_optional_non_empty(&pref.provider_profile_id, "providerProfileId", ctx)?;
    validate_optional_non_empty(&pref.model, "model", ctx)?;
    validate_optional_non_empty(&pref.opaque_ref, "opaqueRef", ctx)?;
    if let Some(artifact) = &pref.artifact_ref {
        validate_artifact_ref(artifact, &format!("{ctx}.artifactRef"))?;
    }
    Ok(())
}

fn validate_outcome(outcome: &Outcome, ctx: &str) -> Result<(), FactValidationError> {
    if matches!(outcome.status, OutcomeStatus::Failed) {
        if outcome.error_code.as_ref().map_or(true, |s| s.is_empty()) {
            return Err(FactValidationError::new(
                ctx,
                "failed outcome must include errorCode",
            ));
        }
    }
    Ok(())
}

fn validate_artifact_ref(artifact: &ArtifactRef, ctx: &str) -> Result<(), FactValidationError> {
    require_non_empty(&artifact.artifact_id, "artifactId", ctx)?;
    require_non_empty(&artifact.media_type, "mediaType", ctx)?;
    require_non_empty(&artifact.sha256, "sha256", ctx)?;
    require_non_empty(&artifact.locator, "locator", ctx)?;
    if artifact.sha256.len() != 64
        || !artifact
            .sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(FactValidationError::new(
            ctx,
            "sha256 must contain exactly 64 lowercase hex characters",
        ));
    }
    if artifact.size_bytes.is_some_and(|size| size < 0) {
        return Err(FactValidationError::new(
            ctx,
            "sizeBytes must be non-negative",
        ));
    }
    if let Some(redaction) = &artifact.redaction {
        let policy = redaction
            .get("policy")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| FactValidationError::new(ctx, "redaction.policy is required"))?;
        require_non_empty(policy, "redaction.policy", ctx)?;
        if let Some(applied_at) = redaction.get("appliedAt") {
            let applied_at = applied_at.as_i64().ok_or_else(|| {
                FactValidationError::new(ctx, "redaction.appliedAt must be an integer")
            })?;
            validate_timestamp(applied_at, "redaction.appliedAt", ctx)?;
        }
    }
    Ok(())
}

fn validate_payload_checksum(
    value: &str,
    name: &str,
    ctx: &str,
) -> Result<(), FactValidationError> {
    let Some(hex) = value.strip_prefix("sha256:") else {
        return Err(FactValidationError::new(
            ctx,
            format!("{name} must use sha256:<64 lowercase hex>"),
        ));
    };
    if hex.len() != 64
        || !hex
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(FactValidationError::new(
            ctx,
            format!("{name} must use sha256:<64 lowercase hex>"),
        ));
    }
    Ok(())
}

fn validate_usage_shape(
    usage: &super::types::UsageShape,
    ctx: &str,
) -> Result<(), FactValidationError> {
    for (name, value) in [
        ("inputTokens", usage.input_tokens),
        ("cachedInputTokens", usage.cached_input_tokens),
        ("outputTokens", usage.output_tokens),
        ("totalTokens", usage.total_tokens),
    ] {
        if value.is_some_and(|tokens| tokens < 0) {
            return Err(FactValidationError::new(
                ctx,
                format!("{name} must be non-negative"),
            ));
        }
    }
    if let Some(cost) = &usage.provider_reported_cost {
        require_non_empty(&cost.amount, "providerReportedCost.amount", ctx)?;
        require_non_empty(&cost.currency, "providerReportedCost.currency", ctx)?;
    }
    Ok(())
}

fn validate_optional_non_empty(
    value: &Option<String>,
    name: &str,
    ctx: &str,
) -> Result<(), FactValidationError> {
    if let Some(value) = value {
        require_non_empty(value, name, ctx)?;
    }
    Ok(())
}

fn validate_control_kind(value: &str, ctx: &str) -> Result<(), FactValidationError> {
    let segments: Vec<&str> = value.split('.').collect();
    let is_valid = segments.len() >= 2
        && segments.iter().all(|segment| {
            let mut chars = segment.chars();
            matches!(chars.next(), Some(first) if first.is_ascii_lowercase())
                && chars.all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
        });
    if !is_valid {
        return Err(FactValidationError::new(
            ctx,
            "controlKind must match ^[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*)+$",
        ));
    }
    Ok(())
}

fn validate_timestamp(value: i64, name: &str, ctx: &str) -> Result<(), FactValidationError> {
    if value < 0 {
        return Err(FactValidationError::new(
            ctx,
            format!("{name} must be non-negative"),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::types::{
        CanonicalBlock, CanonicalProviderProfileSource, CanonicalUserInput, Outcome, OutcomeStatus,
        TurnExecutionSnapshot, TurnRequestedFact, UsageRecordedFact, UsageShape,
    };
    use super::*;

    fn valid_snapshot() -> TurnExecutionSnapshot {
        TurnExecutionSnapshot {
            engine: "claude".to_string(),
            provider_profile_id: Some("profile-1".to_string()),
            model_catalog_entry_id: None,
            model: Some("claude-opus".to_string()),
            reasoning: None,
            provider_profile_name_snapshot: None,
            provider_profile_source: None,
            runtime_capability_fingerprint: None,
            extra: serde_json::Value::Object(Default::default()),
        }
    }

    fn valid_turn_requested() -> TurnRequestedFact {
        TurnRequestedFact {
            logical_turn_id: "turn-1".to_string(),
            attempt_id: "attempt-1".to_string(),
            retry_of_attempt_id: None,
            input: CanonicalUserInput {
                text: Some("hello".to_string()),
                image_refs: None,
                attachment_refs: None,
                extra: serde_json::Value::Object(Default::default()),
            },
            target: valid_snapshot(),
            requested_at: 1_700_000_000_000,
            extra: serde_json::Value::Object(Default::default()),
        }
    }

    #[test]
    fn valid_turn_requested_passes() {
        let fact = CanonicalFact::TurnRequested(valid_turn_requested());
        assert!(validate_fact(&fact).is_ok());
    }

    #[test]
    fn canonical_provider_source_accepts_local_and_rejects_selection_disk() {
        let local = serde_json::from_value::<TurnExecutionSnapshot>(serde_json::json!({
            "engine": "codex",
            "providerProfileSource": "local"
        }))
        .expect("canonical local source");
        assert_eq!(
            local.provider_profile_source,
            Some(CanonicalProviderProfileSource::Local)
        );

        let error = serde_json::from_value::<TurnExecutionSnapshot>(serde_json::json!({
            "engine": "codex",
            "providerProfileSource": "disk"
        }))
        .expect_err("selection-domain disk must not enter canonical snapshot");
        assert!(error.to_string().contains("unknown variant"));
    }

    #[test]
    fn missing_logical_turn_id_rejected() {
        let mut f = valid_turn_requested();
        f.logical_turn_id = String::new();
        let fact = CanonicalFact::TurnRequested(f);
        let err = validate_fact(&fact).expect_err("must reject empty logicalTurnId");
        assert!(err.context.contains("conversation.turnRequested"));
    }

    #[test]
    fn empty_input_rejected() {
        let mut f = valid_turn_requested();
        f.input.text = None;
        let fact = CanonicalFact::TurnRequested(f);
        let err = validate_fact(&fact).expect_err("must reject empty input");
        assert!(err.detail.contains("input must contain"));
    }

    #[test]
    fn failed_outcome_requires_error_code() {
        let f = TurnCommittedFact {
            logical_turn_id: "turn-1".to_string(),
            attempt_id: "attempt-1".to_string(),
            input_entry_id: "entry-1".to_string(),
            assistant: CanonicalAssistantBlocks {
                blocks: vec![CanonicalBlock::Text {
                    text: "sorry".to_string(),
                }],
            },
            atomic_tool_exchanges: vec![],
            artifact_refs: vec![],
            target: valid_snapshot(),
            provider_private_refs: vec![],
            omissions: vec![],
            outcome: Outcome {
                status: OutcomeStatus::Failed,
                error_code: None,
                error_message: None,
                stop_reason: None,
                extra: serde_json::Value::Object(Default::default()),
            },
            committed_at: 1_700_000_000_000,
            extra: serde_json::Value::Object(Default::default()),
        };
        let fact = CanonicalFact::TurnCommitted(f);
        let err = validate_fact(&fact).expect_err("must require errorCode on failed");
        assert!(err.detail.contains("errorCode"));
    }

    #[test]
    fn usage_revision_must_be_positive() {
        let f = UsageRecordedFact {
            usage_record_id: "usage-1".to_string(),
            report_subject_id: "subject-1".to_string(),
            revision: 0,
            supersedes_usage_record_id: None,
            logical_turn_id: "turn-1".to_string(),
            attempt_id: "attempt-1".to_string(),
            binding_key: "binding-1".to_string(),
            native_session_id: "native-1".to_string(),
            native_turn_id: None,
            target: valid_snapshot(),
            usage: UsageShape {
                input_tokens: Some(10),
                cached_input_tokens: None,
                output_tokens: Some(5),
                total_tokens: Some(15),
                provider_reported_cost: None,
                extra: serde_json::Value::Object(Default::default()),
            },
            source: super::super::types::UsageSource::RuntimeFinal,
            verification: super::super::types::UsageVerification::Verified,
            observed_at: 1_700_000_000_000,
            extra: serde_json::Value::Object(Default::default()),
        };
        let fact = CanonicalFact::UsageRecorded(f);
        let err = validate_fact(&fact).expect_err("must reject revision 0");
        assert!(err.detail.contains("revision"));
    }
}
