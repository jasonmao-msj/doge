import { invoke } from "@tauri-apps/api/core";
import type { EngineType } from "../../../types";
import type {
  SharedProjectionItem,
  SharedProjectionMismatchReport,
} from "@/features/shared-session/presentation/sharedProjection/types";
import type {
  CanonicalProviderProfileSource,
  ExecutionTarget,
  TurnExecutionSnapshot,
} from "../target/types";
import { isResolvedExecutionTarget } from "../target/types";
import { normalizeSharedSessionEngine } from "../utils/sharedSessionEngines";

export async function startSharedSession(
  workspaceId: string,
  initialTarget: ExecutionTarget,
) {
  if (!isResolvedExecutionTarget(initialTarget)) {
    throw new Error(
      "Shared Session 初始 Execution Target 不完整，请重新选择 Provider 和 Model。",
    );
  }
  return invoke<Record<string, unknown> | null | undefined>("start_shared_session", {
    workspaceId,
    initialTarget,
  });
}

export async function sendSharedSessionMessage(
  workspaceId: string,
  threadId: string,
  engine: EngineType,
  text: string,
  options?: {
    model?: string | null;
    effort?: string | null;
    disableThinking?: boolean | null;
    accessMode?: "default" | "read-only" | "current" | "full-access";
    images?: string[];
    collaborationMode?: Record<string, unknown> | null;
    preferredLanguage?: string | null;
    customSpecRoot?: string | null;
    /** Wave 4 / Change B：Provider Profile 归属；缺省为 null（旧 V0 行为，default/local 语义）。 */
    providerProfileId?: string | null;
    contextDelivery?: {
      packageId: string;
      sourceChecksum: string;
      operation: "context-import" | "prompt-prefix";
      importItems: Record<string, unknown>[];
      ackFidelity: "strong" | "weak" | "unsupported";
    } | null;
  },
) {
  return invoke<SharedSessionRuntimeDelivery | null | undefined>("send_shared_session_message", {
    workspaceId,
    threadId,
    engine,
    text,
    model: options?.model ?? null,
    effort: options?.effort ?? null,
    disableThinking: options?.disableThinking ?? false,
    accessMode: options?.accessMode ?? null,
    images: options?.images ?? null,
    preferredLanguage: options?.preferredLanguage ?? null,
    collaborationMode: options?.collaborationMode ?? null,
    customSpecRoot: options?.customSpecRoot ?? null,
    providerProfileId: options?.providerProfileId ?? null,
    contextDelivery: options?.contextDelivery ?? null,
  });
}

export type SharedSessionRuntimeDelivery = Record<string, unknown> & {
  nativeThreadId?: string;
  assistantText?: string;
  delivery?: {
    promptAcceptance?: "accepted" | "rejected";
    contextAcceptance?: {
      status: "accepted" | "rejected" | "pending";
      packageId?: string;
      sourceChecksum?: string;
      ackFidelity?: "strong" | "weak" | "unsupported";
      evidence?: string;
    };
    terminal?: {
      type: "run.settled";
      outcome: "completed" | "failed" | "cancelled";
      recoveryReason?: "native-session-not-found" | null;
    };
  };
};

export type SharedContextArtifactRecord = {
  artifactId: string;
  workspaceId: string;
  sessionId: string;
  checksum: string;
  referenceOnly: boolean;
  package: SharedV2ContextPackage;
};

export type SharedContextOrphanReport = {
  status: "report-only";
  paths: string[];
};

export async function listSharedSessions(workspaceId: string) {
  return invoke<Record<string, unknown>[]>("list_shared_sessions", {
    workspaceId,
  });
}

export async function loadSharedSession(workspaceId: string, threadId: string) {
  return invoke<Record<string, unknown> | null>("load_shared_session", {
    workspaceId,
    threadId,
  });
}

export async function loadSharedProjection(workspaceId: string, threadId: string) {
  return invoke<SharedProjectionItem[]>("load_shared_projection", {
    workspaceId,
    threadId,
  });
}

export async function rebuildSharedProjection(workspaceId: string, threadId: string) {
  return invoke<SharedProjectionItem[]>("rebuild_shared_projection", {
    workspaceId,
    threadId,
  });
}

export async function compareSharedProjection(workspaceId: string, threadId: string) {
  return invoke<SharedProjectionMismatchReport>("compare_shared_projection", {
    workspaceId,
    threadId,
  });
}

export async function setSharedSessionSelectedEngine(
  workspaceId: string,
  threadId: string,
  selectedEngine: EngineType,
  providerProfileId?: string | null,
  target?: ExecutionTarget | null,
) {
  return invoke<Record<string, unknown> | null>("set_shared_session_selected_engine", {
    workspaceId,
    threadId,
    selectedEngine: normalizeSharedSessionEngine(selectedEngine),
    providerProfileId: providerProfileId ?? null,
    modelCatalogEntryId: target?.modelCatalogEntryId ?? null,
    model: target?.model ?? null,
    reasoningEffort: target?.reasoning?.effort ?? null,
    providerProfileNameSnapshot: target?.providerProfileNameSnapshot ?? null,
    providerProfileSource: target?.providerProfileSource ?? null,
  });
}

/**
 * Shared V2 selection-only persistence boundary.
 *
 * 这里只保存“下一 Turn 的完整 Target”，不创建/恢复 Native Session，
 * 也不写 Binding。Binding 只能由 attempt-owned Rust dispatcher 物化。
 */
export async function persistSharedSessionSelectedTarget(
  workspaceId: string,
  threadId: string,
  target: ExecutionTarget,
) {
  if (!isResolvedExecutionTarget(target)) {
    throw new Error(
      "Shared Session Execution Target 不完整，请重新选择 Provider 和 Model。",
    );
  }
  return setSharedSessionSelectedEngine(
    workspaceId,
    threadId,
    target.engine,
    target.providerProfileId,
    target,
  );
}

export async function updateSharedSessionNativeBinding(
  workspaceId: string,
  threadId: string,
  engine: EngineType,
  oldNativeThreadId: string | null,
  newNativeThreadId: string,
  /** Wave 4 / B.5：managed Provider 时透传，缺省为 null（旧 V0 行为，写 engine 级 binding）。 */
  providerProfileId?: string | null,
) {
  return invoke<Record<string, unknown> | null>("update_shared_session_native_binding", {
    workspaceId,
    threadId,
    engine,
    oldNativeThreadId,
    newNativeThreadId,
    providerProfileId: providerProfileId ?? null,
  });
}

export async function syncSharedSessionSnapshot(
  workspaceId: string,
  threadId: string,
  items: unknown[],
  selectedEngine: EngineType,
  legacySnapshotEnabled: boolean,
) {
  return invoke<Record<string, unknown> | null>("sync_shared_session_snapshot", {
    workspaceId,
    threadId,
    items,
    selectedEngine: normalizeSharedSessionEngine(selectedEngine),
    legacySnapshotEnabled,
  });
}

export async function deleteSharedSession(
  workspaceId: string,
  threadId: string,
) {
  return invoke<Record<string, unknown> | null>("delete_shared_session", {
    workspaceId,
    threadId,
  });
}

// ---------------------------------------------------------------------------
// Wave 4 / Change B：Shared V2 发送链路（durable-first begin/commit/recovery）。
// 与 Rust `shared_session_v2.rs` 的 Tauri command 一一对应；参数全部 camelCase。
// ---------------------------------------------------------------------------

/** `shared_session_v2_begin_turn` / `commit_turn` 的 target 入参（对齐 `ExecutionTargetInput`）。 */
export type SharedV2ExecutionTargetPayload = {
  engine: EngineType;
  providerProfileId?: string | null;
  modelCatalogEntryId?: string | null;
  model?: string | null;
  reasoningEffort?: string | null;
  providerProfileNameSnapshot?: string | null;
  providerProfileSource?: CanonicalProviderProfileSource | null;
  runtimeCapabilityFingerprint?: string | null;
};

export type SharedV2BeginTurnResult = {
  status: "creating" | "recovery-required" | "target-unavailable";
  attemptId?: string;
  logicalTurnId?: string;
  bindingKey?: string;
  snapshot?: Record<string, unknown>;
  reason?: string;
};

export type SharedV2PrepareContextResult = {
  status: "ready" | "degraded";
  mode: string;
  omissions: string[];
  manifest?: SharedContextManifest;
  compression?: SharedContextCompression;
};

export type SharedContextManifest = {
  mode: string;
  omitted: SharedContextOmission[];
  fromSequenceExclusive?: number | null;
  throughSequenceInclusive: number;
  sourceChecksum: string;
};

export type SharedContextOmission = {
  entryId: string;
  category: string;
  reason: string;
  disposition: "retrievable-on-demand" | "not-retrievable";
  retrievableRef?: string | null;
};

export type SharedContextCompression = {
  estimator: string;
  sourceEstimatedTokens: number;
  packageEstimatedTokens: number;
  perCategory: {
    category: string;
    strategy: string;
    sourceEstimatedTokens: number;
    packageEstimatedTokens: number;
  }[];
};

export type SharedV2ContextPackage = {
  schemaVersion: number;
  packageId: string;
  sessionId: string;
  bindingKey: string;
  destination: Record<string, unknown>;
  stablePrefix: string;
  delta: {
    entryId: string;
    sequence: number;
    role: string;
    blocks: unknown[];
    outcome?: string;
  }[];
  promptPrefix: string;
  manifest: SharedContextManifest;
  compression: SharedContextCompression;
};

export type SharedV2PrepareDeliveryResult = {
  status: "ready" | "degraded";
  packageId: string;
  artifactId: string;
  artifactChecksum: string;
  sourceChecksum: string;
  throughSequenceInclusive: number;
  mode: string;
  operation: "context-import" | "prompt-prefix";
  promptPrefix: string;
  importItems: Record<string, unknown>[];
  manifest: SharedContextManifest;
  compression: SharedContextCompression;
  ackFidelity: "strong" | "weak" | "unsupported";
};

export type SharedV2DispatchTurnResult = SharedSessionRuntimeDelivery & {
  status: "accepted";
  attemptId: string;
  logicalTurnId: string;
  engine: EngineType;
  providerProfileId?: string | null;
  model?: string | null;
  reasoningEffort?: string | null;
  bindingKey: string;
  nativeThreadId: string;
  runtimeTurnId?: string | null;
  /** Runtime terminal 在 exact runtime identity bind 前已被 coordinator 缓存并提交。 */
  alreadySettled?: boolean;
};

export type SharedV2CommitTurnResult =
  | {
      status: "committed";
      duplicate: boolean;
      sequence?: number | null;
      bindingKey: string;
    }
  | {
      status: "pending";
      attemptId: string;
      bindingKey: string;
    };

export type SharedV2AwaitTurnTerminalResult = {
  status: "committed";
  duplicate: boolean;
  sequence: number;
  bindingKey: string;
  terminal: {
    type: "run.settled";
    outcome: "completed" | "failed" | "cancelled";
    recoveryReason?: "native-session-not-found" | null;
  };
};

export type SharedV2ActiveAttemptRecovery = {
  status: "active";
  attemptId: string;
  bindingKey: string;
  nativeThreadId: string;
  runtimeTurnId: string;
  executionTargetSnapshot: TurnExecutionSnapshot;
};

export type SharedV2MarkRecoveryResult =
  | SharedV2ActiveAttemptRecovery
  | {
      status: "recovery-required" | "terminal-committed";
      attemptId: string;
      bindingKey: string;
      sequence?: number | null;
    };

export type SharedV2CancelAttemptResult = {
  status: "cancelled" | "terminal-committed";
  attemptId: string;
};

export type SharedV2RebuildBindingResult = {
  status: "prepared";
  bindingKey: string;
  nativeThreadId: string | null;
  archivedNativeSessionId?: string | null;
  replacedAttemptIds?: string[];
  bindingOperationId?: string | null;
};

export type SharedV2InFlightAttempt = {
  attemptId: string;
  logicalTurnId?: string | null;
  bindingKey?: string | null;
  bindingOperationId?: string | null;
  /** durable `conversation.turnAccepted` evidence；缺省按 false 处理。 */
  accepted?: boolean;
  deliveryPrepared?: boolean;
  pendingPhase?: string | null;
  recoveryDisposition?: "active" | "terminal" | "not-accepted" | "unknown";
  /** 当前 Rust runtime lifecycle owner 是否仍持有该 attempt。 */
  runtimeObserverOwned?: boolean;
};

export type SharedV2RecoverAttemptResult =
  | SharedV2ActiveAttemptRecovery
  | {
      status:
        | "terminal-committed"
        | "not-accepted-committed"
        | "unknown";
      attemptId: string;
      bindingKey?: string | null;
      sequence?: number | null;
      pendingPhase?: string | null;
    };

export type SharedV2ProbeBindingResult = {
  status: "ok";
  provisioningState?: string | null;
  nativeSessionId?: string | null;
  committedThroughSequence?: number | null;
  nativeProbe: {
    status:
      | "matched"
      | "mismatch"
      | "runtime-missing"
      | "runtime-unhealthy"
      | "binding-missing"
      | "unsupported-engine";
    detail?: string | null;
  };
  inFlightAttempts: (SharedV2InFlightAttempt & { accepted: boolean })[];
};

export type SharedV2TurnStateResult = {
  status: "ok";
  inFlightAttempts: SharedV2InFlightAttempt[];
  bindings: {
    bindingKey: string;
    provisioningState: string;
    availability: string;
  }[];
};

export async function sharedSessionV2BeginTurn(
  workspaceId: string,
  threadId: string,
  target: SharedV2ExecutionTargetPayload,
  text: string,
  images?: string[] | null,
) {
  return invoke<SharedV2BeginTurnResult>("shared_session_v2_begin_turn", {
    workspaceId,
    threadId,
    target,
    text,
    images: images ?? null,
  });
}

export async function sharedSessionV2PrepareContext(
  workspaceId: string,
  threadId: string,
  target: SharedV2ExecutionTargetPayload,
) {
  return invoke<SharedV2PrepareContextResult>(
    "shared_session_v2_prepare_context",
    { workspaceId, threadId, target },
  );
}

export async function sharedSessionV2PrepareDelivery(
  workspaceId: string,
  threadId: string,
  attemptId: string,
) {
  return invoke<SharedV2PrepareDeliveryResult>(
    "shared_session_v2_prepare_delivery",
    {
      workspaceId,
      threadId,
      attemptId,
    },
  );
}

export async function sharedSessionV2DispatchTurn(
  workspaceId: string,
  threadId: string,
  params: {
    attemptId: string;
    artifactId: string;
    artifactChecksum: string;
    disableThinking?: boolean | null;
    accessMode?: string | null;
    images?: string[] | null;
    collaborationMode?: Record<string, unknown> | null;
    preferredLanguage?: string | null;
    customSpecRoot?: string | null;
  },
) {
  return invoke<SharedV2DispatchTurnResult>("shared_session_v2_dispatch_turn", {
    workspaceId,
    threadId,
    attemptId: params.attemptId,
    artifactId: params.artifactId,
    artifactChecksum: params.artifactChecksum,
    disableThinking: params.disableThinking ?? null,
    accessMode: params.accessMode ?? null,
    images: params.images ?? null,
    collaborationMode: params.collaborationMode ?? null,
    preferredLanguage: params.preferredLanguage ?? null,
    customSpecRoot: params.customSpecRoot ?? null,
  });
}

export async function sharedContextRetrieveArtifact(
  workspaceId: string,
  threadId: string,
  artifactId: string,
  checksum: string,
) {
  return invoke<SharedContextArtifactRecord>("shared_context_retrieve_artifact", {
    workspaceId,
    threadId,
    artifactId,
    checksum,
  });
}

export async function sharedContextScanOrphans() {
  return invoke<SharedContextOrphanReport>("shared_context_scan_orphans");
}

export async function sharedSessionV2AwaitTurnTerminal(
  workspaceId: string,
  threadId: string,
  attemptId: string,
) {
  return invoke<SharedV2AwaitTurnTerminalResult>(
    "shared_session_v2_await_turn_terminal",
    {
      workspaceId,
      threadId,
      attemptId,
    },
  );
}

export async function sharedSessionV2CommitTurn(
  workspaceId: string,
  threadId: string,
  attemptId: string,
) {
  return invoke<SharedV2CommitTurnResult>("shared_session_v2_commit_turn", {
    workspaceId,
    threadId,
    attemptId,
  });
}

export async function sharedSessionV2MarkRecovery(
  workspaceId: string,
  threadId: string,
  attemptId: string,
  reason?: string | null,
) {
  return invoke<SharedV2MarkRecoveryResult>("shared_session_v2_mark_recovery", {
    workspaceId,
    threadId,
    attemptId,
    reason: reason ?? null,
  });
}

export async function sharedSessionV2CancelAttempt(
  workspaceId: string,
  threadId: string,
  attemptId: string,
  reason: string,
) {
  return invoke<SharedV2CancelAttemptResult>(
    "shared_session_v2_cancel_attempt",
    {
      workspaceId,
      threadId,
      attemptId,
      reason,
    },
  );
}

export async function sharedSessionV2InterruptTurn(
  workspaceId: string,
  threadId: string,
  attemptId: string,
) {
  return invoke<
    | {
        status: "interrupted";
        attemptId: string;
        engine: EngineType;
        bindingKey: string;
        nativeThreadId: string;
        runtimeTurnId: string;
      }
    | {
        status: "terminal-committed";
        attemptId: string;
        sequence: number;
      }
  >("shared_session_v2_interrupt_turn", {
    workspaceId,
    threadId,
    attemptId,
  });
}

export async function sharedSessionV2RecoverAttempt(
  workspaceId: string,
  threadId: string,
  attemptId: string,
) {
  return invoke<SharedV2RecoverAttemptResult>(
    "shared_session_v2_recover_attempt",
    { workspaceId, threadId, attemptId },
  );
}

export async function sharedSessionV2RebuildBinding(
  workspaceId: string,
  threadId: string,
  bindingKey: string,
) {
  return invoke<SharedV2RebuildBindingResult>("shared_session_v2_rebuild_binding", {
    workspaceId,
    threadId,
    bindingKey,
  });
}

export type SharedV2AbandonUnresolvedAttemptResult =
  | {
      status: "cancelled-committed";
      attemptId: string;
      bindingKey: string;
      sequence?: number | null;
      duplicate?: boolean;
    }
  | {
      status: "terminal-committed";
      attemptId: string;
      bindingKey?: string;
      sequence?: number | null;
    }
  | {
      status: "clear";
      reason?: string;
    };

/**
 * 用户显式「放弃本轮」：durable cancel 未决 attempt。
 * `forceStop=true`：Runtime 仍 own 时 best-effort interrupt，失败也必须 durable cancel 解锁。
 */
export async function sharedSessionV2AbandonUnresolvedAttempt(
  workspaceId: string,
  threadId: string,
  options?: { attemptId?: string | null; forceStop?: boolean },
) {
  return invoke<SharedV2AbandonUnresolvedAttemptResult>(
    "shared_session_v2_abandon_unresolved_attempt",
    {
      workspaceId,
      threadId,
      attemptId: options?.attemptId ?? null,
      forceStop: options?.forceStop ?? false,
    },
  );
}

export async function sharedSessionV2ProbeBinding(
  workspaceId: string,
  threadId: string,
  bindingKey: string,
) {
  return invoke<SharedV2ProbeBindingResult>("shared_session_v2_probe_binding", {
    workspaceId,
    threadId,
    bindingKey,
  });
}

export async function sharedSessionV2TurnState(workspaceId: string, threadId: string) {
  return invoke<SharedV2TurnStateResult>("shared_session_v2_turn_state", {
    workspaceId,
    threadId,
  });
}
