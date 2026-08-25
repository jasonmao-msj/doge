import { useCallback, useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type {
  AppServerEvent,
  ApprovalRequest,
  CollaborationModeBlockedRequest,
  CollaborationModeResolvedRequest,
  RequestUserInputRequest,
} from "../../../types";
import {
  getAppServerEventBackpressureForTests,
  resetAppServerEventBackpressureForTests,
  subscribeRawAppServerEvents,
} from "../../../services/events";
import type {
  ConversationEngine,
  NormalizedThreadEvent,
} from "../../threads/contracts/conversationCurtainContracts";
import {
  getRealtimeAdapterByEngine,
  inferRealtimeAdapterEngine,
} from "../../threads/adapters/realtimeAdapterRegistry";
import { resolveConversationAssemblyMigrationGate } from "../../threads/assembly/conversationMigrationGates";
import { hydrateToolSnapshotWithEventParams } from "../../threads/adapters/toolSnapshotHydration";
import { isGeneratedImageToolName } from "../../../utils/generatedImageArtifacts";
import {
  rebindSharedSessionNativeThread,
  resolvePendingSharedSessionBindingForEngine,
  resolveSharedSessionBindingByNativeThread,
  resolveSharedSessionBindingFromRuntimeOwner,
  resolveSharedRuntimeControlOwner,
} from "../../shared-session/runtime/sharedSessionBridge";
import { isSharedV2SendEnabled } from "../../shared-session/runtime/sharedV2SendFlag";
import type { SharedSessionNativeBinding } from "../../shared-session/runtime/sharedSessionBridge";
import { getActiveTurnTargetForAttempt } from "../../shared-session/target/targetStore";
import { updateSharedSessionNativeBinding as updateSharedSessionNativeBindingService } from "../../shared-session/services/sharedSessions";
import { noteThreadAppServerEventReceived } from "../../threads/utils/streamLatencyDiagnostics";
import {
  isAppServerEventBatchConsumerEnabled,
  readStreamingScheduleTier,
} from "@/conversation-presentation/realtimePerfFlags";
import { useRenderScheduler } from "../../../hooks/useRenderScheduler";
import { resolveDispatchSchedule } from "@/conversation-presentation/renderSchedulingPolicy";
import {
  classifyCodexEventRisk,
  resolveCodexEventOwnership,
} from "./codexEventOwnership";
import { migrateThreadAgentEventTracking } from "./appServerEventAgentTracking";
import { useAppServerEventBatchDispatch } from "./useAppServerEventBatchDispatch";
import {
  isAgentAttempt,
  resolveAgentAttemptOwner,
} from "../../multi-agent/store/agentStore";
import {
  buildAgentCanvasThreadId,
  isAgentCanvasThreadId,
  parseAgentCanvasThreadId,
} from "../../multi-agent/runtime/agentCanvasThread";
import { rememberCollabWorkerNativeThreadId } from "../../multi-agent/runtime/collabNativeHideRegistry";

export {
  getAppServerEventBackpressureForTests,
  resetAppServerEventBackpressureForTests,
};

type AgentDelta = {
  workspaceId: string;
  threadId: string;
  itemId: string;
  delta: string;
  turnId?: string | null;
};

type TurnErrorPayload = {
  message: string;
  willRetry: boolean;
  suppressMessage?: boolean;
  engine?: ConversationEngine | null;
  executionTargetSnapshot?: SharedSessionNativeBinding["executionTargetSnapshot"];
};

type TurnStalledPayload = {
  message: string;
  reasonCode: string;
  stage: string;
  source: string;
  startedAtMs: number | null;
  timeoutMs: number | null;
  engine?: ConversationEngine | null;
};

type AgentCompleted = {
  workspaceId: string;
  threadId: string;
  itemId: string;
  text: string;
  turnId?: string | null;
};

export type AppServerEventHandlers = {
  onNormalizedRealtimeEvent?: (event: NormalizedThreadEvent) => void;
  onWorkspaceConnected?: (workspaceId: string) => void;
  onThreadStarted?: (
    workspaceId: string,
    thread: Record<string, unknown>,
  ) => void;
  onThreadSessionIdUpdated?: (
    workspaceId: string,
    threadId: string,
    sessionId: string,
    engine?: "claude" | "opencode" | "codex" | "gemini" | "grok" | "kimi" | null,
    turnId?: string | null,
  ) => void;
  onBackgroundThreadAction?: (
    workspaceId: string,
    threadId: string,
    action: string,
  ) => void;
  onApprovalRequest?: (request: ApprovalRequest) => void;
  onRequestUserInput?: (request: RequestUserInputRequest) => void;
  onModeBlocked?: (event: CollaborationModeBlockedRequest) => void;
  onModeResolved?: (event: CollaborationModeResolvedRequest) => void;
  onAgentMessageDelta?: (event: AgentDelta) => void;
  onAgentMessageCompleted?: (event: AgentCompleted) => void;
  onAppServerEvent?: (event: AppServerEvent) => void;
  onTurnStarted?: (
    workspaceId: string,
    threadId: string,
    turnId: string,
  ) => void;
  onSharedRuntimeTurnStarted?: (
    threadId: string,
    runtimeTurnId: string,
  ) => void;
  onTurnCompleted?: (
    workspaceId: string,
    threadId: string,
    turnId: string,
  ) => void;
  onProcessingHeartbeat?: (
    workspaceId: string,
    threadId: string,
    pulse: number,
  ) => void;
  onContextCompacting?: (
    workspaceId: string,
    threadId: string,
    payload: {
      usagePercent: number | null;
      thresholdPercent: number | null;
      targetPercent: number | null;
      auto?: boolean | null;
      manual?: boolean | null;
    },
  ) => void;
  onContextCompacted?: (
    workspaceId: string,
    threadId: string,
    turnId: string,
    payload?: {
      auto?: boolean | null;
      manual?: boolean | null;
    },
  ) => void;
  onContextCompactionFailed?: (
    workspaceId: string,
    threadId: string,
    reason: string,
  ) => void;
  onRuntimeEnded?: (
    workspaceId: string,
    payload: {
      reasonCode: string;
      message: string;
      affectedThreadIds: string[];
      affectedTurnIds: string[];
      pendingRequestCount: number;
      hadActiveLease: boolean;
      runtimeGeneration?: string;
      runtimeProcessId?: number;
      runtimeStartedAtMs?: number;
    },
  ) => void;
  onTurnError?: (
    workspaceId: string,
    threadId: string,
    turnId: string,
    payload: TurnErrorPayload,
  ) => void;
  onTurnStalled?: (
    workspaceId: string,
    threadId: string,
    turnId: string,
    payload: TurnStalledPayload,
  ) => void;
  onTurnPlanUpdated?: (
    workspaceId: string,
    threadId: string,
    turnId: string,
    payload: { explanation: unknown; plan: unknown },
  ) => void;
  onItemStarted?: (
    workspaceId: string,
    threadId: string,
    item: Record<string, unknown>,
  ) => void;
  onItemUpdated?: (
    workspaceId: string,
    threadId: string,
    item: Record<string, unknown>,
  ) => void;
  onItemCompleted?: (
    workspaceId: string,
    threadId: string,
    item: Record<string, unknown>,
  ) => void;
  onReasoningSummaryDelta?: (
    workspaceId: string,
    threadId: string,
    itemId: string,
    delta: string,
    engineHint?: "gemini" | "grok" | "kimi" | null,
    turnId?: string | null,
  ) => void;
  onReasoningSummaryBoundary?: (
    workspaceId: string,
    threadId: string,
    itemId: string,
    engineHint?: "gemini" | "grok" | "kimi" | null,
    turnId?: string | null,
  ) => void;
  onReasoningTextDelta?: (
    workspaceId: string,
    threadId: string,
    itemId: string,
    delta: string,
    engineHint?: "gemini" | "grok" | "kimi" | null,
    turnId?: string | null,
  ) => void;
  onCommandOutputDelta?: (
    workspaceId: string,
    threadId: string,
    itemId: string,
    delta: string,
    turnId?: string | null,
  ) => void;
  onTerminalInteraction?: (
    workspaceId: string,
    threadId: string,
    itemId: string,
    stdin: string,
    turnId?: string | null,
  ) => void;
  onFileChangeOutputDelta?: (
    workspaceId: string,
    threadId: string,
    itemId: string,
    delta: string,
    turnId?: string | null,
  ) => void;
  onTurnDiffUpdated?: (
    workspaceId: string,
    threadId: string,
    diff: string,
  ) => void;
  onThreadTokenUsageUpdated?: (
    workspaceId: string,
    threadId: string,
    tokenUsage: Record<string, unknown>,
  ) => void;
  onAccountRateLimitsUpdated?: (
    workspaceId: string,
    rateLimits: Record<string, unknown>,
  ) => void;
  /**
   * 获取指定 workspace 当前活动的 Codex thread ID
   * 仅用于低风险兼容展示路径，不能作为 lifecycle mutation owner。
   */
  getActiveCodexThreadId?: (workspaceId: string) => string | null;
  /**
   * Returns a thread only when the workspace has exactly one processing
   * Codex conversation. This is the bounded fallback for owner-gated
   * lifecycle events that lack explicit thread context.
   */
  getSingleProcessingCodexThreadId?: (workspaceId: string) => string | null;
};

type UseAppServerEventsOptions = {
  useNormalizedRealtimeAdapters?: boolean;
};

export type DispatchAppServerEventOptions = {
  useNormalizedRealtimeAdapters: boolean;
  threadAgentDeltaSeenRef: MutableRefObject<Record<string, true>>;
  threadAgentCompletedSeenRef: MutableRefObject<ThreadAgentCompletedItemTracker>;
  threadAgentSnapshotSeenRef: MutableRefObject<ThreadAgentSnapshotItemTracker>;
};

type DispatchAppServerEventBatchOptions = DispatchAppServerEventOptions & {
  chunkSize?: number;
  onComplete?: () => void;
};

const DEFAULT_APP_SERVER_EVENT_BATCH_CHUNK_SIZE = 64;

function asString(value: unknown): string {
  return typeof value === "string" ? value : value ? String(value) : "";
}

function parseOptionalBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  return null;
}

function extractCompactionSourceFlags(params: Record<string, unknown>) {
  const auto = parseOptionalBoolean(params.auto ?? params.automatic);
  const manual = parseOptionalBoolean(params.manual);
  if (auto === null && manual === null) {
    return null;
  }
  return { auto, manual };
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => asString(entry).trim())
    .filter((entry) => entry.length > 0);
}

function extractRuntimeEndedTurnMap(value: unknown): Map<string, string> {
  const turnMap = new Map<string, string>();
  if (!Array.isArray(value)) {
    return turnMap;
  }
  value.forEach((entry) => {
    const objectEntry =
      entry && typeof entry === "object"
        ? (entry as Record<string, unknown>)
        : null;
    if (!objectEntry) {
      return;
    }
    const threadId = asString(
      objectEntry.threadId ?? objectEntry.thread_id,
    ).trim();
    const turnId = asString(objectEntry.turnId ?? objectEntry.turn_id).trim();
    if (!threadId || !turnId) {
      return;
    }
    turnMap.set(threadId, turnId);
  });
  return turnMap;
}

function extractThreadIdFromParams(params: Record<string, unknown>): string {
  const turn = (params.turn as Record<string, unknown> | undefined) ?? {};
  const threadObj =
    (params.thread as Record<string, unknown> | undefined) ?? {};
  return asString(
    params.threadId ??
      params.thread_id ??
      turn.threadId ??
      turn.thread_id ??
      threadObj.threadId ??
      threadObj.thread_id ??
      threadObj.id ??
      "",
  ).trim();
}

function resolveCodexOwnerThreadId(
  handlers: AppServerEventHandlers,
  workspaceId: string,
  method: string,
  params: Record<string, unknown>,
): string {
  const explicitThreadId = extractThreadIdFromParams(params);
  const fallbackThreadId = explicitThreadId
    ? null
    : (handlers.getSingleProcessingCodexThreadId?.(workspaceId) ?? null);
  const ownership = resolveCodexEventOwnership({
    workspaceId,
    risk: classifyCodexEventRisk(method),
    explicitThreadId,
    explicitTurnId: extractTurnIdFromParams(params),
    ...(explicitThreadId ? { explicitSource: "payload" as const } : {}),
    boundedFallbackThreadIds: fallbackThreadId ? [fallbackThreadId] : [],
  });
  return ownership.kind === "explicit" || ownership.kind === "boundedFallback"
    ? ownership.threadId
    : "";
}

function getAppServerEventMethod(payload: AppServerEvent): string {
  return String(payload.message.method ?? "");
}

function getAppServerEventParams(
  payload: AppServerEvent,
): Record<string, unknown> {
  return (payload.message.params as Record<string, unknown> | undefined) ?? {};
}

export function buildCoalescibleAppServerEventKey(
  payload: AppServerEvent,
): string | null {
  const method = getAppServerEventMethod(payload);
  const params = getAppServerEventParams(payload);
  switch (method) {
    case "processing/heartbeat":
    case "thread/tokenUsage/updated":
    case "thread/compacting":
    case "turn/diff/updated": {
      const threadId = extractThreadIdFromParams(params);
      return threadId
        ? `${payload.workspace_id}\0${method}\0${threadId}`
        : null;
    }
    case "account/rateLimits/updated":
      return `${payload.workspace_id}\0${method}`;
    default:
      return null;
  }
}

export function coalesceAppServerEventBatch(
  batch: readonly AppServerEvent[],
): AppServerEvent[] {
  const coalesced: AppServerEvent[] = [];
  let previousCoalesceKey: string | null = null;
  for (const payload of batch) {
    const coalesceKey = buildCoalescibleAppServerEventKey(payload);
    if (
      coalesceKey &&
      previousCoalesceKey === coalesceKey &&
      coalesced.length > 0
    ) {
      coalesced[coalesced.length - 1] = payload;
    } else {
      coalesced.push(payload);
    }
    previousCoalesceKey = coalesceKey;
  }
  return coalesced;
}

function extractTurnIdFromParams(params: Record<string, unknown>): string {
  const turn = (params.turn as Record<string, unknown> | undefined) ?? {};
  return asString(
    params.turnId ??
      params.turn_id ??
      turn.id ??
      turn.turnId ??
      turn.turn_id ??
      "",
  ).trim();
}

const PROVIDER_CONTINUATION_BOOTSTRAP_TURN_PREFIX =
  "provider-continuation-";

export function isProviderContinuationBootstrapEvent(
  payload: AppServerEvent,
): boolean {
  const params = getAppServerEventParams(payload);
  return extractTurnIdFromParams(params).startsWith(
    PROVIDER_CONTINUATION_BOOTSTRAP_TURN_PREFIX,
  );
}

function extractItemIdFromParams(params: Record<string, unknown>): string {
  const turn = (params.turn as Record<string, unknown> | undefined) ?? {};
  const itemObj = (params.item as Record<string, unknown> | undefined) ?? {};
  const messageObj =
    (params.message as Record<string, unknown> | undefined) ?? {};
  const partObj = (params.part as Record<string, unknown> | undefined) ?? {};
  const contentObj =
    (params.content as Record<string, unknown> | undefined) ?? {};
  return asString(
    params.itemId ??
      params.item_id ??
      partObj.itemId ??
      partObj.item_id ??
      itemObj.id ??
      itemObj.itemId ??
      itemObj.item_id ??
      messageObj.id ??
      contentObj.itemId ??
      contentObj.item_id ??
      turn.itemId ??
      turn.item_id ??
      "",
  ).trim();
}

function extractReasoningDeltaFromParams(
  params: Record<string, unknown>,
): string {
  const partObj = (params.part as Record<string, unknown> | undefined) ?? {};
  const itemObj = (params.item as Record<string, unknown> | undefined) ?? {};
  const contentObj =
    (params.content as Record<string, unknown> | undefined) ?? {};
  return asString(
    params.delta ??
      params.text ??
      params.summary ??
      partObj.delta ??
      partObj.text ??
      partObj.summary ??
      itemObj.delta ??
      itemObj.text ??
      itemObj.summary ??
      contentObj.delta ??
      contentObj.text ??
      contentObj.summary ??
      "",
  ).trim();
}

function extractAgentMessageDeltaPayload(
  method: string,
  params: Record<string, unknown>,
): {
  threadId: string;
  itemId: string;
  delta: string;
  turnId: string | null;
} | null {
  const isTextAliasMethod = method === "text:delta" || method === "text/delta";
  const isAgentDeltaMethod =
    method === "item/agentMessage/delta" ||
    method === "item/agentMessage/textDelta" ||
    method === "item/agentMessage/text/delta" ||
    isTextAliasMethod;
  if (!isAgentDeltaMethod) {
    return null;
  }

  const turn = (params.turn as Record<string, unknown> | undefined) ?? {};
  const itemObj = (params.item as Record<string, unknown> | undefined) ?? {};
  const messageObj =
    (params.message as Record<string, unknown> | undefined) ?? {};
  const partObj = (params.part as Record<string, unknown> | undefined) ?? {};
  const threadId = extractThreadIdFromParams(params);
  const turnId = extractTurnIdFromParams(params);
  if (
    isTextAliasMethod &&
    !isClaudeThreadId(threadId) &&
    !isGeminiThreadId(threadId) &&
    !isGrokThreadId(threadId) &&
    !isKimiThreadId(threadId)
  ) {
    return null;
  }
  const rawItemId = asString(
    params.itemId ??
      params.item_id ??
      itemObj.id ??
      messageObj.id ??
      partObj.itemId ??
      partObj.item_id ??
      turn.itemId ??
      turn.item_id ??
      (!isTextAliasMethod ? turn.id : "") ??
      "",
  ).trim();
  const itemId =
    rawItemId || (isTextAliasMethod ? `${threadId}:text-delta` : "");
  const delta = asString(
    params.delta ??
      params.text ??
      params.output_text ??
      params.outputText ??
      params.content ??
      partObj.delta ??
      partObj.text ??
      partObj.content ??
      itemObj.delta ??
      itemObj.text ??
      itemObj.content ??
      messageObj.delta ??
      messageObj.text ??
      messageObj.content ??
      "",
  );

  if (!threadId || !itemId || !delta) {
    return null;
  }
  return { threadId, itemId, delta, turnId: turnId || null };
}

function withRealtimeItemEventContext(
  item: Record<string, unknown>,
  params: Record<string, unknown>,
  engineSource?: ConversationEngine,
): Record<string, unknown> {
  const turnId = extractTurnIdFromParams(params);
  const existingTurnId = asString(item.turnId ?? item.turn_id).trim();
  return {
    ...item,
    ...(turnId && !existingTurnId ? { turnId } : {}),
    ...(engineSource ? { engineSource } : {}),
  };
}

function resolveEventEngine(
  threadId: string,
  engineHint?: ConversationEngine | null,
): ConversationEngine {
  return engineHint ?? inferRealtimeAdapterEngine(threadId);
}

function cloneMessageWithThreadId(
  message: Record<string, unknown>,
  threadId: string,
): Record<string, unknown> {
  const params = (message.params as Record<string, unknown> | undefined) ?? {};
  const nextParams: Record<string, unknown> = {
    ...params,
    threadId,
    thread_id: threadId,
  };
  const turn = (params.turn as Record<string, unknown> | undefined) ?? null;
  if (turn) {
    nextParams.turn = {
      ...turn,
      threadId,
      thread_id: threadId,
    };
  }
  const thread = (params.thread as Record<string, unknown> | undefined) ?? null;
  if (thread) {
    nextParams.thread = {
      ...thread,
      id: threadId,
    };
  }
  return {
    ...message,
    params: nextParams,
  };
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function toOptionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isClaudeThreadId(threadId: string): boolean {
  return (
    threadId.startsWith("claude:") || threadId.startsWith("claude-pending-")
  );
}

function resolveLegacyModelContextWindow(
  threadId: string,
  value: unknown,
): number | null {
  const parsed = toOptionalNumber(value);
  if (parsed !== null && parsed > 0) {
    return parsed;
  }
  return isClaudeThreadId(threadId) ? null : 200000;
}

function isGeminiThreadId(threadId: string): boolean {
  return (
    threadId.startsWith("gemini:") || threadId.startsWith("gemini-pending-")
  );
}

function isKimiThreadId(threadId: string): boolean {
  return (
    threadId.startsWith("kimi:") || threadId.startsWith("kimi-pending-")
  );
}

function isGrokThreadId(threadId: string): boolean {
  return (
    threadId.startsWith("grok:") || threadId.startsWith("grok-pending-")
  );
}

function inferGeminiReasoningHintFromThreadId(
  threadId: string,
): "gemini" | "grok" | "kimi" | null {
  if (!threadId) {
    return null;
  }
  if (isGrokThreadId(threadId)) {
    return "grok";
  }
  if (isKimiThreadId(threadId)) {
    return "kimi";
  }
  return isGeminiThreadId(threadId) ? "gemini" : null;
}

function inferRawMethodEngine(
  method: string,
): "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode" | undefined {
  switch (method) {
    case "claude/raw":
      return "claude";
    case "codex/raw":
      return "codex";
    case "gemini/raw":
      return "gemini";
    case "grok/raw":
      return "grok";
    case "kimi/raw":
      return "kimi";
    case "opencode/raw":
      return "opencode";
    default:
      return undefined;
  }
}

function isCodexRawGeneratedImageEvent(
  method: string,
  params: Record<string, unknown>,
): boolean {
  if (method !== "codex/raw") {
    return false;
  }
  const rawEntryType = asString(params.type ?? "")
    .trim()
    .toLowerCase();
  if (rawEntryType !== "event_msg" && rawEntryType !== "response_item") {
    return false;
  }
  const payload =
    params.payload && typeof params.payload === "object"
      ? (params.payload as Record<string, unknown>)
      : null;
  if (!payload) {
    return false;
  }
  const payloadType = asString(payload.type ?? "")
    .trim()
    .toLowerCase();
  if (payloadType === "function_call") {
    return isGeneratedImageToolName(
      asString(payload.name ?? payload.tool ?? ""),
    );
  }
  return (
    payloadType === "image_generation_call" ||
    payloadType === "image_generation_end" ||
    payloadType === "function_call_output"
  );
}

function shouldRebindSharedNativeThreadOnStartedEvent(
  engine: "claude" | "opencode" | "codex" | "gemini" | "grok" | "kimi",
): boolean {
  // Claude 与 local CLIs 在 thread/started 上可能从 pending 占位收敛到
  // `engine:{sessionId}`；Codex 使用 raw thread id，不在此路径做前缀 rebind。
  return (
    engine === "claude" ||
    engine === "kimi" ||
    engine === "grok" ||
    engine === "opencode"
  );
}

function isAgentMessageSnapshotMethod(method: string): boolean {
  return method === "item/started" || method === "item/updated";
}

function shouldIgnoreAgentMessageSnapshot(params: {
  threadId: string;
  itemType: string;
  method: string;
  threadAgentDeltaSeenRef: MutableRefObject<Record<string, true>>;
}): boolean {
  const { threadId, itemType, method, threadAgentDeltaSeenRef } = params;
  if (itemType !== "agentMessage" || !isAgentMessageSnapshotMethod(method)) {
    return false;
  }
  if (isClaudeThreadId(threadId)) {
    return method !== "item/updated";
  }
  return Boolean(threadAgentDeltaSeenRef.current[threadId]);
}

function hasAgentMessageSnapshotText(item: Record<string, unknown>): boolean {
  const text = asString(
    item.text ?? item.content ?? item.output_text ?? item.outputText ?? "",
  ).trim();
  return text.length > 0;
}

function extractTokenUsageFromNormalizedEvent(
  event: NormalizedThreadEvent,
): Record<string, unknown> | null {
  const usageFromItem =
    event.rawItem &&
    typeof event.rawItem.usage === "object" &&
    event.rawItem.usage
      ? (event.rawItem.usage as Record<string, unknown>)
      : null;
  const usage = event.rawUsage ?? usageFromItem;
  if (!usage) {
    return null;
  }

  const inputTokens = toNumber(usage.input_tokens ?? usage.inputTokens);
  const outputTokens = toNumber(usage.output_tokens ?? usage.outputTokens);
  const cachedInputTokens = toNumber(
    usage.cached_input_tokens ??
      usage.cache_read_input_tokens ??
      usage.cachedInputTokens ??
      usage.cacheReadInputTokens,
  );
  const modelContextWindow = toNumber(
    usage.model_context_window ?? usage.modelContextWindow,
  );
  if (inputTokens <= 0 && outputTokens <= 0 && cachedInputTokens <= 0) {
    return null;
  }
  const contextUsedPercent = toOptionalNumber(
    usage.context_used_percent ?? usage.contextUsedPercent,
  );
  const contextRemainingPercent = toOptionalNumber(
    usage.context_remaining_percent ?? usage.contextRemainingPercent,
  );
  const contextUsedTokens = toOptionalNumber(
    usage.context_used_tokens ?? usage.contextUsedTokens,
  );
  const contextUsageSource =
    typeof (usage.context_usage_source ?? usage.contextUsageSource) === "string"
      ? String(usage.context_usage_source ?? usage.contextUsageSource)
      : null;
  const contextUsageFreshness =
    typeof (usage.context_usage_freshness ?? usage.contextUsageFreshness) ===
    "string"
      ? String(usage.context_usage_freshness ?? usage.contextUsageFreshness)
      : null;
  return {
    total: {
      inputTokens,
      outputTokens,
      cachedInputTokens,
      totalTokens: inputTokens + outputTokens,
    },
    last: {
      inputTokens,
      outputTokens,
      cachedInputTokens,
      totalTokens: inputTokens + outputTokens,
    },
    modelContextWindow: modelContextWindow > 0 ? modelContextWindow : null,
    contextUsageSource,
    contextUsageFreshness,
    contextUsedTokens:
      contextUsedTokens !== null && contextUsedTokens >= 0
        ? contextUsedTokens
        : null,
    contextUsedPercent:
      contextUsedPercent !== null && contextUsedPercent >= 0
        ? contextUsedPercent
        : null,
    contextRemainingPercent:
      contextRemainingPercent !== null && contextRemainingPercent >= 0
        ? contextRemainingPercent
        : null,
  };
}

type ThreadAgentCompletedItemTracker = Record<string, Record<string, true>>;
type ThreadAgentSnapshotItemTracker = Record<string, Record<string, true>>;

function resolveAgentCompletionKey(itemId: string, text: string): string {
  const normalizedItemId = itemId.trim();
  if (normalizedItemId) {
    return `item:${normalizedItemId}`;
  }
  const normalizedText = text.trim();
  if (normalizedText) {
    return `text:${normalizedText}`;
  }
  return "";
}

function hasThreadAgentCompletion(
  trackerRef: MutableRefObject<ThreadAgentCompletedItemTracker>,
  threadId: string,
): boolean {
  const threadTracker = trackerRef.current[threadId];
  return Boolean(threadTracker && Object.keys(threadTracker).length > 0);
}

function markThreadAgentCompletionSeen(
  trackerRef: MutableRefObject<ThreadAgentCompletedItemTracker>,
  threadId: string,
  itemId: string,
  text: string,
): boolean {
  const completionKey = resolveAgentCompletionKey(itemId, text);
  if (!completionKey) {
    return true;
  }
  const threadTracker = trackerRef.current[threadId] ?? {};
  if (threadTracker[completionKey]) {
    return false;
  }
  threadTracker[completionKey] = true;
  trackerRef.current[threadId] = threadTracker;
  return true;
}

function markThreadAgentSnapshotSeen(
  trackerRef: MutableRefObject<ThreadAgentSnapshotItemTracker>,
  threadId: string,
  itemId: string,
): void {
  if (!threadId || !itemId) {
    return;
  }
  const threadTracker = trackerRef.current[threadId] ?? {};
  threadTracker[itemId] = true;
  trackerRef.current[threadId] = threadTracker;
}

function hasThreadAgentSnapshotSeen(
  trackerRef: MutableRefObject<ThreadAgentSnapshotItemTracker>,
  threadId: string,
  itemId: string,
): boolean {
  if (!threadId || !itemId) {
    return false;
  }
  return Boolean(trackerRef.current[threadId]?.[itemId]);
}

function resolveLatestThreadAgentSnapshotItemId(
  trackerRef: MutableRefObject<ThreadAgentSnapshotItemTracker>,
  threadId: string,
): string | null {
  const itemIds = Object.keys(trackerRef.current[threadId] ?? {});
  return itemIds[itemIds.length - 1] ?? null;
}

function emitReasoningSummaryDelta(
  handlers: AppServerEventHandlers,
  workspaceId: string,
  threadId: string,
  itemId: string,
  delta: string,
  engineHint: "gemini" | "grok" | "kimi" | null,
  turnId: string | null,
): void {
  if (turnId) {
    handlers.onReasoningSummaryDelta?.(
      workspaceId,
      threadId,
      itemId,
      delta,
      engineHint,
      turnId,
    );
    return;
  }
  if (engineHint) {
    handlers.onReasoningSummaryDelta?.(
      workspaceId,
      threadId,
      itemId,
      delta,
      engineHint,
    );
    return;
  }
  handlers.onReasoningSummaryDelta?.(workspaceId, threadId, itemId, delta);
}

function emitReasoningSummaryBoundary(
  handlers: AppServerEventHandlers,
  workspaceId: string,
  threadId: string,
  itemId: string,
  engineHint: "gemini" | "grok" | "kimi" | null,
  turnId: string | null,
): void {
  if (turnId) {
    handlers.onReasoningSummaryBoundary?.(
      workspaceId,
      threadId,
      itemId,
      engineHint,
      turnId,
    );
    return;
  }
  if (engineHint) {
    handlers.onReasoningSummaryBoundary?.(
      workspaceId,
      threadId,
      itemId,
      engineHint,
    );
    return;
  }
  handlers.onReasoningSummaryBoundary?.(workspaceId, threadId, itemId);
}

function emitReasoningTextDelta(
  handlers: AppServerEventHandlers,
  workspaceId: string,
  threadId: string,
  itemId: string,
  delta: string,
  engineHint: "gemini" | "grok" | "kimi" | null,
  turnId: string | null,
): void {
  if (turnId) {
    handlers.onReasoningTextDelta?.(
      workspaceId,
      threadId,
      itemId,
      delta,
      engineHint,
      turnId,
    );
    return;
  }
  if (engineHint) {
    handlers.onReasoningTextDelta?.(
      workspaceId,
      threadId,
      itemId,
      delta,
      engineHint,
    );
    return;
  }
  handlers.onReasoningTextDelta?.(workspaceId, threadId, itemId, delta);
}

function emitCommandOutputDelta(
  handlers: AppServerEventHandlers,
  workspaceId: string,
  threadId: string,
  itemId: string,
  delta: string,
  turnId: string | null,
): void {
  if (turnId) {
    handlers.onCommandOutputDelta?.(
      workspaceId,
      threadId,
      itemId,
      delta,
      turnId,
    );
    return;
  }
  handlers.onCommandOutputDelta?.(workspaceId, threadId, itemId, delta);
}

function emitFileChangeOutputDelta(
  handlers: AppServerEventHandlers,
  workspaceId: string,
  threadId: string,
  itemId: string,
  delta: string,
  turnId: string | null,
): void {
  if (turnId) {
    handlers.onFileChangeOutputDelta?.(
      workspaceId,
      threadId,
      itemId,
      delta,
      turnId,
    );
    return;
  }
  handlers.onFileChangeOutputDelta?.(workspaceId, threadId, itemId, delta);
}

function emitTerminalInteraction(
  handlers: AppServerEventHandlers,
  workspaceId: string,
  threadId: string,
  itemId: string,
  stdin: string,
  turnId: string | null,
): void {
  if (turnId) {
    handlers.onTerminalInteraction?.(
      workspaceId,
      threadId,
      itemId,
      stdin,
      turnId,
    );
    return;
  }
  handlers.onTerminalInteraction?.(workspaceId, threadId, itemId, stdin);
}

function routeNormalizedRealtimeEvent({
  handlers,
  workspaceId,
  event,
  threadAgentDeltaSeenRef,
  threadAgentCompletedSeenRef,
  threadAgentSnapshotSeenRef,
}: {
  handlers: AppServerEventHandlers;
  workspaceId: string;
  event: NormalizedThreadEvent;
  threadAgentDeltaSeenRef: MutableRefObject<Record<string, true>>;
  threadAgentCompletedSeenRef: MutableRefObject<ThreadAgentCompletedItemTracker>;
  threadAgentSnapshotSeenRef: MutableRefObject<ThreadAgentSnapshotItemTracker>;
}): boolean {
  const threadId = event.threadId;
  const itemId = event.item.id;
  const turnId = event.turnId ?? null;
  const shouldRouteDirectly =
    Boolean(handlers.onNormalizedRealtimeEvent) &&
    (event.engine === "codex" ||
      event.threadId.startsWith("shared:") ||
      // 协作节点 Inspector 幕布：与 shared 同源 normalized 路由
      event.threadId.startsWith("agent-canvas:"));
  switch (event.operation) {
    case "itemStarted":
      if (
        event.engine === "codex" &&
        event.item.kind === "message" &&
        event.item.role === "assistant"
      ) {
        markThreadAgentSnapshotSeen(
          threadAgentSnapshotSeenRef,
          threadId,
          itemId,
        );
      }
      if (shouldRouteDirectly) {
        handlers.onNormalizedRealtimeEvent?.(event);
        return true;
      }
      if (event.rawItem) {
        handlers.onItemStarted?.(workspaceId, threadId, event.rawItem);
        return true;
      }
      return false;
    case "itemUpdated":
      if (
        event.engine === "codex" &&
        event.item.kind === "message" &&
        event.item.role === "assistant"
      ) {
        markThreadAgentSnapshotSeen(
          threadAgentSnapshotSeenRef,
          threadId,
          itemId,
        );
      }
      if (shouldRouteDirectly) {
        handlers.onNormalizedRealtimeEvent?.(event);
        return true;
      }
      if (event.rawItem) {
        handlers.onItemUpdated?.(workspaceId, threadId, event.rawItem);
        return true;
      }
      return false;
    case "itemCompleted":
      if (shouldRouteDirectly) {
        handlers.onNormalizedRealtimeEvent?.(event);
        const tokenUsage = extractTokenUsageFromNormalizedEvent(event);
        if (tokenUsage) {
          handlers.onThreadTokenUsageUpdated?.(
            workspaceId,
            threadId,
            tokenUsage,
          );
        }
        return true;
      }
      if (event.rawItem) {
        handlers.onItemCompleted?.(workspaceId, threadId, event.rawItem);
        const tokenUsage = extractTokenUsageFromNormalizedEvent(event);
        if (tokenUsage) {
          handlers.onThreadTokenUsageUpdated?.(
            workspaceId,
            threadId,
            tokenUsage,
          );
        }
        return true;
      }
      return false;
    case "appendAgentMessageDelta": {
      if (
        shouldIgnoreAgentMessageSnapshot({
          threadId,
          itemType: "agentMessage",
          method: event.sourceMethod,
          threadAgentDeltaSeenRef,
        })
      ) {
        // Claude should accept growing item/updated snapshots so the curtain can
        // reveal long Markdown before completion, but item/started snapshots are
        // still treated as setup noise. Other engines only ignore snapshot aliases
        // after a real streaming delta has already arrived.
        return true;
      }
      const delta =
        event.delta ?? (event.item.kind === "message" ? event.item.text : "");
      if (!delta) {
        return false;
      }
      if (
        event.engine === "codex" &&
        hasThreadAgentSnapshotSeen(threadAgentSnapshotSeenRef, threadId, itemId)
      ) {
        return true;
      }
      markThreadAgentSnapshotSeen(
        threadAgentSnapshotSeenRef,
        threadId,
        itemId,
      );
      threadAgentDeltaSeenRef.current[threadId] = true;
      if (shouldRouteDirectly) {
        handlers.onNormalizedRealtimeEvent?.({
          ...event,
          delta,
          item:
            event.item.kind === "message"
              ? { ...event.item, text: delta }
              : event.item,
        });
        return true;
      }
      handlers.onAgentMessageDelta?.({
        workspaceId,
        threadId,
        itemId,
        delta,
        ...(turnId ? { turnId } : {}),
      });
      return true;
    }
    case "completeAgentMessage": {
      const text = event.item.kind === "message" ? event.item.text : "";
      const tokenUsage = extractTokenUsageFromNormalizedEvent(event);
      if (tokenUsage) {
        handlers.onThreadTokenUsageUpdated?.(workspaceId, threadId, tokenUsage);
      }
      if (
        !markThreadAgentCompletionSeen(
          threadAgentCompletedSeenRef,
          threadId,
          itemId,
          text,
        )
      ) {
        return true;
      }
      if (shouldRouteDirectly) {
        handlers.onNormalizedRealtimeEvent?.(event);
        return true;
      }
      if (event.rawItem) {
        handlers.onItemCompleted?.(workspaceId, threadId, event.rawItem);
      }
      handlers.onAgentMessageCompleted?.({
        workspaceId,
        threadId,
        itemId,
        text,
        ...(turnId ? { turnId } : {}),
      });
      return true;
    }
    case "appendReasoningSummaryDelta": {
      const delta = event.delta ?? "";
      if (!delta) {
        return false;
      }
      if (shouldRouteDirectly) {
        handlers.onNormalizedRealtimeEvent?.({
          ...event,
          delta,
          item:
            event.item.kind === "reasoning"
              ? {
                  ...event.item,
                  summary: delta,
                }
              : event.item,
        });
        return true;
      }
      emitReasoningSummaryDelta(
        handlers,
        workspaceId,
        threadId,
        itemId,
        delta,
        event.engine === "gemini" || event.engine === "grok" || event.engine === "kimi" ? event.engine : null,
        turnId,
      );
      return true;
    }
    case "appendReasoningSummaryBoundary":
      if (shouldRouteDirectly) {
        handlers.onNormalizedRealtimeEvent?.(event);
        return true;
      }
      emitReasoningSummaryBoundary(
        handlers,
        workspaceId,
        threadId,
        itemId,
        event.engine === "gemini" || event.engine === "grok" || event.engine === "kimi" ? event.engine : null,
        turnId,
      );
      return true;
    case "appendReasoningContentDelta": {
      const delta = event.delta ?? "";
      if (!delta) {
        return false;
      }
      if (shouldRouteDirectly) {
        handlers.onNormalizedRealtimeEvent?.({
          ...event,
          delta,
          item:
            event.item.kind === "reasoning"
              ? {
                  ...event.item,
                  content: delta,
                }
              : event.item,
        });
        return true;
      }
      emitReasoningTextDelta(
        handlers,
        workspaceId,
        threadId,
        itemId,
        delta,
        event.engine === "gemini" || event.engine === "grok" || event.engine === "kimi" ? event.engine : null,
        turnId,
      );
      return true;
    }
    case "appendToolOutputDelta": {
      const delta = event.delta ?? "";
      if (!delta || event.item.kind !== "tool") {
        return false;
      }
      if (shouldRouteDirectly) {
        handlers.onNormalizedRealtimeEvent?.({
          ...event,
          delta,
          item: {
            ...event.item,
            output: delta,
          },
        });
        return true;
      }
      if (event.item.toolType === "fileChange") {
        emitFileChangeOutputDelta(
          handlers,
          workspaceId,
          threadId,
          itemId,
          delta,
          turnId,
        );
      } else {
        emitCommandOutputDelta(
          handlers,
          workspaceId,
          threadId,
          itemId,
          delta,
          turnId,
        );
      }
      return true;
    }
    default:
      return false;
  }
}

function tryRouteNormalizedRealtimeEvent({
  handlers,
  workspaceId,
  message,
  engineOverride,
  threadIdOverride,
  sharedBinding,
  threadAgentDeltaSeenRef,
  threadAgentCompletedSeenRef,
  threadAgentSnapshotSeenRef,
}: {
  handlers: AppServerEventHandlers;
  workspaceId: string;
  message: Record<string, unknown>;
  engineOverride?: "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode";
  threadIdOverride?: string;
  sharedBinding?: SharedSessionNativeBinding | null;
  threadAgentDeltaSeenRef: MutableRefObject<Record<string, true>>;
  threadAgentCompletedSeenRef: MutableRefObject<ThreadAgentCompletedItemTracker>;
  threadAgentSnapshotSeenRef: MutableRefObject<ThreadAgentSnapshotItemTracker>;
}): boolean {
  const params = (message.params as Record<string, unknown> | undefined) ?? {};
  const turn = (params.turn as Record<string, unknown> | undefined) ?? {};
  const rawThreadId = asString(
    params.threadId ??
      params.thread_id ??
      turn.threadId ??
      turn.thread_id ??
      "",
  );
  const effectiveThreadId = threadIdOverride || rawThreadId;
  if (!effectiveThreadId) {
    return false;
  }
  const engine =
    engineOverride ?? inferRealtimeAdapterEngine(effectiveThreadId);
  const migrationGate = resolveConversationAssemblyMigrationGate(engine);
  if (migrationGate && !migrationGate.assemblerEnabled) {
    return false;
  }
  const adapter = getRealtimeAdapterByEngine(engine);
  const shouldInjectThreadId = Boolean(threadIdOverride);
  const normalized = adapter.mapEvent({
    workspaceId,
    message: shouldInjectThreadId
      ? cloneMessageWithThreadId(message, effectiveThreadId)
      : message,
  });
  if (!normalized) {
    return false;
  }
  const isSharedOwnerProjection = effectiveThreadId.startsWith("shared:");
  if (shouldInjectThreadId || isSharedOwnerProjection) {
    // agent-canvas: 事件写到隔离 thread，但 activeTurn 挂在 shared: 上
    const activeTurnThreadId = isAgentCanvasThreadId(effectiveThreadId)
      ? parseAgentCanvasThreadId(effectiveThreadId)?.sharedThreadId ??
        effectiveThreadId
      : effectiveThreadId;
    const executionTargetSnapshot =
      sharedBinding?.executionTargetSnapshot ??
      (sharedBinding?.attemptId
        ? getActiveTurnTargetForAttempt(
            workspaceId,
            activeTurnThreadId,
            sharedBinding.attemptId,
          )
        : null);
    normalized.threadId = effectiveThreadId;
    normalized.item = {
      ...normalized.item,
      engineSource: engine,
      ...(executionTargetSnapshot &&
      normalized.item.kind === "message" &&
      normalized.item.role === "assistant"
        ? { executionTargetSnapshot }
        : {}),
    };
    if (normalized.rawItem) {
      normalized.rawItem = {
        ...normalized.rawItem,
        engineSource: engine,
      };
    }
  }
  return routeNormalizedRealtimeEvent({
    handlers,
    workspaceId,
    event: normalized,
    threadAgentDeltaSeenRef,
    threadAgentCompletedSeenRef,
    threadAgentSnapshotSeenRef,
  });
}

/**
 * Module-level dispatcher for a single `AppServerEvent`.
 *
 * Extracted from the `useAppServerEvents` `useEffect` callback so both the
 * fallback raw subscription and the v2 scheduled consumer share one routing
 * path. Sharing matters: a per-event closure copy would double-register
 * handlers and cause duplicate reducer dispatches when multiple channels are
 * active.
 *
 * All closure-captured state (handlers, refs, runtime options) is
 * passed explicitly so the dispatcher has no hidden dependencies and is
 * unit-testable in isolation.
 */
export function dispatchAppServerEvent(
  handlers: AppServerEventHandlers,
  payload: AppServerEvent,
  options: DispatchAppServerEventOptions,
): void {
  const {
    useNormalizedRealtimeAdapters,
    threadAgentDeltaSeenRef,
    threadAgentCompletedSeenRef,
    threadAgentSnapshotSeenRef,
  } = options;
  // Provider continuation bootstrap 是 control plane，不是用户 Turn。
  // 在统一入口隔离，避免它进入 processing/reasoning/message/title 链路。
  if (isProviderContinuationBootstrapEvent(payload)) {
    return;
  }
  handlers.onAppServerEvent?.(payload);

  const { workspace_id, message } = payload;
  const method = String(message.method ?? "");

  if (method === "codex/connected") {
    handlers.onWorkspaceConnected?.(workspace_id);
    return;
  }

  const params = (message.params as Record<string, unknown>) ?? {};
  noteThreadAppServerEventReceived({
    workspaceId: workspace_id,
    method,
    params,
  });
  const rawThreadId = extractThreadIdFromParams(params);
  const rawMethodEngine = inferRawMethodEngine(method);
  const shouldForceNormalizedRealtimeRoute = isCodexRawGeneratedImageEvent(
    method,
    params,
  );
  const fallbackGeneratedImageThreadId =
    !rawThreadId &&
    shouldForceNormalizedRealtimeRoute &&
    rawMethodEngine === "codex"
      ? resolveCodexOwnerThreadId(handlers, workspace_id, method, params)
      : "";
  const realtimeThreadId = rawThreadId || fallbackGeneratedImageThreadId;
  let sharedBridge =
    resolveSharedSessionBindingFromRuntimeOwner(workspace_id, params) ??
    (realtimeThreadId
      ? resolveSharedSessionBindingByNativeThread(workspace_id, realtimeThreadId)
      : null);
  // Multi-Agent worker realtime：不进主幕 shared: 时间线，但必须复用主幕同源
  // adapter + liveAssistantTextChannel（agent-canvas: 作用域）。禁止旁路抠字。
  if (
    isAgentAttempt(sharedBridge?.attemptId) ||
    sharedBridge?.bindingKey?.startsWith("squad:")
  ) {
    // 侧栏 hide：立刻登记 native id（含改名 Agent N 后的 catalog id）
    if (realtimeThreadId) {
      rememberCollabWorkerNativeThreadId(realtimeThreadId);
    }
    const nativeFromBridge =
      typeof (sharedBridge as { nativeThreadId?: string } | null)
        ?.nativeThreadId === "string"
        ? (sharedBridge as { nativeThreadId?: string }).nativeThreadId
        : null;
    if (nativeFromBridge) {
      rememberCollabWorkerNativeThreadId(nativeFromBridge);
    }
    const owner = resolveAgentAttemptOwner({
      attemptId: sharedBridge?.attemptId,
      bindingKey: sharedBridge?.bindingKey,
    });
    if (!owner) {
      return;
    }
    const canvasThreadId = buildAgentCanvasThreadId(
      owner.threadId,
      owner.attemptId,
    );
    if (!canvasThreadId) {
      return;
    }
    const engineOverride =
      sharedBridge?.engine ??
      (rawMethodEngine as
        | "claude"
        | "codex"
        | "gemini"
        | "grok"
        | "kimi"
        | "opencode"
        | undefined);
    if (
      tryRouteNormalizedRealtimeEvent({
        handlers,
        workspaceId: workspace_id,
        message,
        sharedBinding: sharedBridge,
        ...(engineOverride ? { engineOverride } : {}),
        threadIdOverride: canvasThreadId,
        threadAgentDeltaSeenRef,
        threadAgentCompletedSeenRef,
        threadAgentSnapshotSeenRef,
      })
    ) {
      return;
    }
    const agentDeltaPayload = extractAgentMessageDeltaPayload(method, params);
    if (agentDeltaPayload) {
      threadAgentDeltaSeenRef.current[canvasThreadId] = true;
      handlers.onAgentMessageDelta?.({
        workspaceId: workspace_id,
        threadId: canvasThreadId,
        itemId: agentDeltaPayload.itemId,
        delta: agentDeltaPayload.delta,
        ...(agentDeltaPayload.turnId
          ? { turnId: agentDeltaPayload.turnId }
          : {}),
      });
      return;
    }
    // 未识别的 worker 事件不落入主幕 shared 时间线
    return;
  }
  const requestIdValue = message.id ?? params.requestId ?? params.request_id;
  const requestId =
    typeof requestIdValue === "number" || typeof requestIdValue === "string"
      ? requestIdValue
      : null;
  const hasRequestId = requestId !== null;

  if (
    (method.includes("requestApproval") || method === "approval/request") &&
    hasRequestId
  ) {
    const sharedControlOwner = resolveSharedRuntimeControlOwner(
      workspace_id,
      params,
    );
    const hasSharedControlClaim =
      params.sharedOwner !== undefined ||
      rawThreadId.startsWith("shared:") ||
      Boolean(sharedBridge);
    if (hasSharedControlClaim && !sharedControlOwner) {
      return;
    }
    handlers.onApprovalRequest?.({
      workspace_id,
      request_id: requestId,
      method,
      params,
      ...(sharedControlOwner
        ? { shared_runtime_owner: sharedControlOwner }
        : {}),
    });
    return;
  }

  if (method === "collaboration/modeBlocked") {
    const sharedControlOwner = resolveSharedRuntimeControlOwner(
      workspace_id,
      params,
    );
    const hasSharedControlClaim =
      params.sharedOwner !== undefined ||
      rawThreadId.startsWith("shared:") ||
      Boolean(sharedBridge);
    if (hasSharedControlClaim && !sharedControlOwner) {
      return;
    }
    const requestIdValue = params.requestId ?? params.request_id;
    const requestId =
      typeof requestIdValue === "number" || typeof requestIdValue === "string"
        ? requestIdValue
        : null;
    const reasonCodeValue = params.reasonCode ?? params.reason_code;
    const parsedReasonCode =
      reasonCodeValue === undefined || reasonCodeValue === null
        ? undefined
        : String(reasonCodeValue);
    handlers.onModeBlocked?.({
      workspace_id,
      ...(sharedControlOwner
        ? { shared_runtime_owner: sharedControlOwner }
        : {}),
      params: {
        thread_id: String(params.threadId ?? params.thread_id ?? ""),
        blocked_method: String(
          params.blockedMethod ?? params.blocked_method ?? "",
        ),
        effective_mode: String(
          params.effectiveMode ?? params.effective_mode ?? "",
        ),
        ...(parsedReasonCode ? { reason_code: parsedReasonCode } : {}),
        reason: String(params.reason ?? ""),
        suggestion:
          params.suggestion === undefined || params.suggestion === null
            ? undefined
            : String(params.suggestion),
        request_id: requestId,
      },
    });
    return;
  }

  if (method === "collaboration/modeResolved") {
    const params = (message.params as Record<string, unknown>) ?? {};
    const selectedUiModeRaw = String(
      params.selectedUiMode ?? params.selected_ui_mode ?? "",
    )
      .trim()
      .toLowerCase();
    const effectiveRuntimeModeRaw = String(
      params.effectiveRuntimeMode ?? params.effective_runtime_mode ?? "",
    )
      .trim()
      .toLowerCase();
    const effectiveUiModeRaw = String(
      params.effectiveUiMode ?? params.effective_ui_mode ?? "",
    )
      .trim()
      .toLowerCase();
    const fallbackReasonRaw = params.fallbackReason ?? params.fallback_reason;
    const selectedUiMode = selectedUiModeRaw === "plan" ? "plan" : "default";
    const effectiveRuntimeMode =
      effectiveRuntimeModeRaw === "plan" ? "plan" : "code";
    const effectiveUiMode = effectiveUiModeRaw === "plan" ? "plan" : "default";
    handlers.onModeResolved?.({
      workspace_id,
      params: {
        thread_id: String(params.threadId ?? params.thread_id ?? ""),
        selected_ui_mode: selectedUiMode,
        effective_runtime_mode: effectiveRuntimeMode,
        effective_ui_mode: effectiveUiMode,
        fallback_reason:
          fallbackReasonRaw === undefined || fallbackReasonRaw === null
            ? null
            : String(fallbackReasonRaw),
      },
    });
    return;
  }

  if (method === "item/tool/requestUserInput") {
    const params = (message.params as Record<string, unknown>) ?? {};
    // Prefer explicit requestId fields for requestUserInput events.
    // Some runtimes may use top-level message.id for transport-level ids.
    const requestIdValue = params.requestId ?? params.request_id ?? message.id;
    const requestId =
      typeof requestIdValue === "number" || typeof requestIdValue === "string"
        ? requestIdValue
        : null;
    if (requestId === null) {
      return;
    }
    const sharedControlOwner = resolveSharedRuntimeControlOwner(
      workspace_id,
      params,
    );
    const hasSharedControlClaim =
      params.sharedOwner !== undefined ||
      rawThreadId.startsWith("shared:") ||
      Boolean(sharedBridge);
    if (hasSharedControlClaim && !sharedControlOwner) {
      return;
    }
    const resolvedThreadId = resolveCodexOwnerThreadId(
      handlers,
      workspace_id,
      method,
      params,
    );
    const effectiveThreadId =
      sharedControlOwner?.sharedThreadId ?? resolvedThreadId;
    const completed = Boolean(params.completed);
    const turn = (params.turn as Record<string, unknown> | undefined) ?? {};
    const questionsRaw = Array.isArray(params.questions)
      ? params.questions
      : [];
    const questions = questionsRaw
      .map((entry) => {
        const question = entry as Record<string, unknown>;
        const optionsRaw = Array.isArray(question.options)
          ? question.options
          : [];
        const options = optionsRaw
          .map((option) => {
            const record = option as Record<string, unknown>;
            const label = String(record.label ?? "").trim();
            const description = String(record.description ?? "").trim();
            if (!label && !description) {
              return null;
            }
            return { label, description };
          })
          .filter((option): option is { label: string; description: string } =>
            Boolean(option),
          );
        return {
          id: String(question.id ?? "").trim(),
          header: String(question.header ?? ""),
          question: String(question.question ?? ""),
          isOther: Boolean(question.isOther ?? question.is_other),
          isSecret: Boolean(question.isSecret ?? question.is_secret),
          ...((question.multiSelect ?? question.multi_select)
            ? { multiSelect: true }
            : {}),
          options: options.length ? options : undefined,
        };
      })
      .filter((question) => question.id);
    handlers.onRequestUserInput?.({
      workspace_id,
      request_id: requestId,
      ...(sharedControlOwner
        ? { shared_runtime_owner: sharedControlOwner }
        : {}),
      params: {
        thread_id: effectiveThreadId,
        turn_id: String(params.turnId ?? params.turn_id ?? turn.id ?? ""),
        item_id: String(
          params.itemId ?? params.item_id ?? turn.itemId ?? turn.item_id ?? "",
        ),
        questions,
        ...(completed ? { completed: true } : {}),
      },
    });
    return;
  }

  if (
    (useNormalizedRealtimeAdapters ||
      shouldForceNormalizedRealtimeRoute ||
      Boolean(sharedBridge?.executionTargetSnapshot)) &&
    tryRouteNormalizedRealtimeEvent({
      handlers,
      workspaceId: workspace_id,
      message,
      sharedBinding: sharedBridge,
      ...(sharedBridge
        ? {
            engineOverride: sharedBridge.engine,
            threadIdOverride: sharedBridge.sharedThreadId,
          }
        : rawMethodEngine
          ? {
              engineOverride: rawMethodEngine,
              ...(fallbackGeneratedImageThreadId
                ? { threadIdOverride: fallbackGeneratedImageThreadId }
                : {}),
            }
          : {}),
      threadAgentDeltaSeenRef,
      threadAgentCompletedSeenRef,
      threadAgentSnapshotSeenRef,
    })
  ) {
    return;
  }

  const agentDeltaPayload = extractAgentMessageDeltaPayload(method, params);
  if (agentDeltaPayload) {
    const effectiveThreadId =
      sharedBridge?.sharedThreadId ?? agentDeltaPayload.threadId;
    threadAgentDeltaSeenRef.current[effectiveThreadId] = true;
    handlers.onAgentMessageDelta?.({
      workspaceId: workspace_id,
      threadId: effectiveThreadId,
      itemId: agentDeltaPayload.itemId,
      delta: agentDeltaPayload.delta,
      ...(agentDeltaPayload.turnId ? { turnId: agentDeltaPayload.turnId } : {}),
    });
    return;
  }

  if (method === "turn/started") {
    const params = message.params as Record<string, unknown>;
    const turn = params.turn as Record<string, unknown> | undefined;
    const rawTurnThreadId = String(
      params.threadId ??
        params.thread_id ??
        turn?.threadId ??
        turn?.thread_id ??
        "",
    );
    const threadId = sharedBridge?.sharedThreadId ?? rawTurnThreadId;
    const turnId = asString(
      params.turnId ?? params.turn_id ?? turn?.id ?? "",
    ).trim();
    if (threadId) {
      delete threadAgentDeltaSeenRef.current[threadId];
      delete threadAgentCompletedSeenRef.current[threadId];
      delete threadAgentSnapshotSeenRef.current[threadId];
      // Shared V2 caller 已在 attempt admission 时建立 processing lifecycle。
      // Rust 投影的 delayed turn/started 只提供 Runtime evidence；若再进入通用
      // Native handler，会在 canonical commit 后复活 activeTurnId / Stop。
      const isOwnedSharedV2Projection =
        Boolean(sharedBridge) && params.sharedOwner !== undefined;
      if (isOwnedSharedV2Projection) {
        // Shared projection 不进入 generic Native lifecycle，但 exact Runtime identity
        // 仍需更新 realtime ledger，解除上一 Turn 的 thread-level terminal fallback。
        handlers.onSharedRuntimeTurnStarted?.(threadId, turnId);
      } else {
        handlers.onTurnStarted?.(workspace_id, threadId, turnId);
      }
    }
    return;
  }

  if (method === "thread/started") {
    const params = message.params as Record<string, unknown>;
    const thread =
      (params.thread as Record<string, unknown> | undefined) ?? null;
    const threadId = String(
      thread?.id ?? params.threadId ?? params.thread_id ?? "",
    );
    const sessionId = String(params.sessionId ?? params.session_id ?? "");
    const turnId = String(params.turnId ?? params.turn_id ?? "").trim();
    const rawEngine = String(params.engine ?? "").toLowerCase();
    const eventEngine =
      rawEngine === "claude" ||
      rawEngine === "opencode" ||
      rawEngine === "codex" ||
      rawEngine === "grok" ||
      rawEngine === "kimi" ||
      rawEngine === "gemini"
        ? rawEngine
        : null;

    if (
      !sharedBridge &&
      threadId &&
      eventEngine &&
      (eventEngine === "codex" ||
        eventEngine === "claude" ||
        eventEngine === "kimi" ||
        eventEngine === "grok" ||
        eventEngine === "opencode")
    ) {
      const pendingBinding = resolvePendingSharedSessionBindingForEngine(
        workspace_id,
        eventEngine,
      );
      if (pendingBinding) {
        if (pendingBinding.nativeThreadId !== threadId) {
          const rebound = rebindSharedSessionNativeThread({
            workspaceId: workspace_id,
            oldNativeThreadId: pendingBinding.nativeThreadId,
            newNativeThreadId: threadId,
          });
          if (rebound) {
            sharedBridge = rebound;
            // V2 Binding 的唯一 durable authority 是 Rust SQLite。这里的
            // frontend bridge 只负责 event projection；仅显式回滚 V0 时写
            // legacy Shared meta binding。
            if (!isSharedV2SendEnabled()) {
              void updateSharedSessionNativeBindingService(
                workspace_id,
                rebound.sharedThreadId,
                rebound.engine,
                pendingBinding.nativeThreadId,
                threadId,
                rebound.providerProfileId ?? null,
              ).catch(() => {});
            }
          }
        } else {
          sharedBridge = pendingBinding;
        }
      }
    }

    if (sharedBridge) {
      if (
        threadId &&
        sessionId &&
        sessionId !== "pending" &&
        eventEngine &&
        shouldRebindSharedNativeThreadOnStartedEvent(eventEngine)
      ) {
        const finalizedNativeThreadId = `${eventEngine}:${sessionId}`;
        if (threadId !== finalizedNativeThreadId) {
          const rebound = rebindSharedSessionNativeThread({
            workspaceId: workspace_id,
            oldNativeThreadId: threadId,
            newNativeThreadId: finalizedNativeThreadId,
          });
          if (rebound) {
            if (!isSharedV2SendEnabled()) {
              void updateSharedSessionNativeBindingService(
                workspace_id,
                rebound.sharedThreadId,
                rebound.engine,
                threadId,
                finalizedNativeThreadId,
                rebound.providerProfileId ?? null,
              ).catch(() => {});
            }
          }
        }
      }
      return;
    }

    if (
      threadId &&
      sessionId &&
      sessionId !== "pending" &&
      eventEngine &&
      threadId.startsWith(`${eventEngine}-pending-`)
    ) {
      migrateThreadAgentEventTracking({
        sourceThreadId: threadId,
        targetThreadId: `${eventEngine}:${sessionId}`,
        threadAgentDeltaSeenRef,
        nestedTrackerRefs: [
          threadAgentCompletedSeenRef,
          threadAgentSnapshotSeenRef,
        ],
      });
    }

    // If we have a real sessionId (not "pending"), notify for thread ID update
    if (threadId && sessionId && sessionId !== "pending") {
      handlers.onThreadSessionIdUpdated?.(
        workspace_id,
        threadId,
        sessionId,
        eventEngine,
        turnId || null,
      );
    }

    if (thread && threadId) {
      handlers.onThreadStarted?.(workspace_id, thread);
    }
    return;
  }

  if (method === "codex/parseError") {
    const params = (message.params as Record<string, unknown>) ?? {};
    const resolvedThreadId = resolveCodexOwnerThreadId(
      handlers,
      workspace_id,
      method,
      params,
    );
    const threadId = sharedBridge?.sharedThreadId ?? resolvedThreadId;
    if (!threadId) {
      return;
    }
    const parseErrorText = String(params.error ?? "").trim();
    const rawText = String(params.raw ?? "").trim();
    const detail = rawText ? `\n${rawText}` : "";
    const messageText = parseErrorText
      ? `Codex stream parse error: ${parseErrorText}${detail}`
      : `Codex stream parse error${detail}`;
    handlers.onTurnError?.(workspace_id, threadId, "", {
      message: messageText,
      willRetry: false,
      engine: "codex",
      ...(sharedBridge?.executionTargetSnapshot
        ? { executionTargetSnapshot: sharedBridge.executionTargetSnapshot }
        : {}),
    });
    return;
  }

  if (method === "runtime/ended") {
    const params = (message.params as Record<string, unknown>) ?? {};
    const reasonCode = asString(params.reasonCode ?? params.reason_code).trim();
    const rawMessage = asString(params.message).trim();
    const affectedThreadIds = asStringArray(
      params.affectedThreadIds ?? params.affected_thread_ids,
    );
    const affectedTurnIds = asStringArray(
      params.affectedTurnIds ?? params.affected_turn_ids,
    );
    const affectedActiveTurns = extractRuntimeEndedTurnMap(
      params.affectedActiveTurns ?? params.affected_active_turns,
    );
    const pendingRequestCount = Number(
      params.pendingRequestCount ?? params.pending_request_count ?? 0,
    );
    const hadActiveLease = Boolean(
      params.hadActiveLease ?? params.had_active_lease ?? false,
    );
    const normalizedPendingRequestCount =
      Number.isFinite(pendingRequestCount) && pendingRequestCount > 0
        ? Math.trunc(pendingRequestCount)
        : 0;
    const runtimeGeneration = asString(
      params.runtimeGeneration ?? params.runtime_generation,
    ).trim();
    const shutdownSource = asString(
      params.shutdownSource ?? params.shutdown_source,
    ).trim();
    const rawRuntimeProcessId = Number(
      params.runtimeProcessId ?? params.runtime_process_id ?? 0,
    );
    const rawRuntimeStartedAtMs = Number(
      params.runtimeStartedAtMs ?? params.runtime_started_at_ms ?? 0,
    );
    const runtimeIdentityPayload = {
      ...(runtimeGeneration ? { runtimeGeneration } : {}),
      ...(Number.isFinite(rawRuntimeProcessId) && rawRuntimeProcessId > 0
        ? { runtimeProcessId: Math.trunc(rawRuntimeProcessId) }
        : {}),
      ...(Number.isFinite(rawRuntimeStartedAtMs) && rawRuntimeStartedAtMs > 0
        ? { runtimeStartedAtMs: Math.trunc(rawRuntimeStartedAtMs) }
        : {}),
    };

    handlers.onRuntimeEnded?.(workspace_id, {
      reasonCode,
      message: rawMessage,
      affectedThreadIds,
      affectedTurnIds,
      pendingRequestCount: normalizedPendingRequestCount,
      hadActiveLease,
      ...runtimeIdentityPayload,
    });

    const isRecoverableRuntimeShutdownSource =
      shutdownSource === "stale_reuse_cleanup" ||
      shutdownSource === "internal_replacement";
    const isBenignManualShutdown =
      reasonCode === "manual_shutdown" &&
      !isRecoverableRuntimeShutdownSource &&
      !hadActiveLease &&
      normalizedPendingRequestCount === 0 &&
      affectedThreadIds.length === 0 &&
      affectedTurnIds.length === 0 &&
      affectedActiveTurns.size === 0;
    if (isBenignManualShutdown) {
      return;
    }

    const explicitRuntimeThreadId = extractThreadIdFromParams(params);
    const explicitRuntimeTurnId = extractTurnIdFromParams(params);
    const hasExplicitRuntimeOwner =
      Boolean(explicitRuntimeThreadId) ||
      affectedThreadIds.length > 0 ||
      affectedActiveTurns.size > 0;
    const singleProcessingFallbackThreadId =
      hasExplicitRuntimeOwner
        ? null
        : (handlers.getSingleProcessingCodexThreadId?.(workspace_id) ?? null);
    const fallbackOwnership = resolveCodexEventOwnership({
      workspaceId: workspace_id,
      risk: classifyCodexEventRisk(method),
      explicitThreadId: explicitRuntimeThreadId,
      explicitTurnId: explicitRuntimeTurnId,
      ...(explicitRuntimeThreadId ? { explicitSource: "payload" as const } : {}),
      runtimeGeneration,
      boundedFallbackThreadIds: singleProcessingFallbackThreadId
        ? [singleProcessingFallbackThreadId]
        : [],
    });
    const normalizedMessage = rawMessage.startsWith("[RUNTIME_ENDED]")
      ? rawMessage
      : rawMessage
        ? `[RUNTIME_ENDED] ${rawMessage}`
        : "[RUNTIME_ENDED] Managed runtime ended unexpectedly before the turn settled.";
    const targetThreadIds = affectedThreadIds.length
      ? affectedThreadIds
      : affectedActiveTurns.size
        ? Array.from(affectedActiveTurns.keys())
        : fallbackOwnership.kind === "explicit" ||
            fallbackOwnership.kind === "boundedFallback"
          ? [fallbackOwnership.threadId]
          : [];
    const uniqueTargetThreadIds = Array.from(new Set(targetThreadIds));
    const shouldUseSingleAffectedTurnId =
      uniqueTargetThreadIds.length === 1 && affectedTurnIds.length === 1;
    uniqueTargetThreadIds.forEach((targetThreadId) => {
      const reboundBinding = resolveSharedSessionBindingByNativeThread(
        workspace_id,
        targetThreadId,
      );
      const reboundThreadId = reboundBinding?.sharedThreadId ?? targetThreadId;
      if (!reboundThreadId) {
        return;
      }
      const targetTurnId =
        affectedActiveTurns.get(targetThreadId) ??
        (shouldUseSingleAffectedTurnId
          ? (affectedTurnIds[0] ?? "")
          : fallbackOwnership.kind === "explicit" &&
              fallbackOwnership.threadId === targetThreadId
            ? (fallbackOwnership.turnId ?? "")
            : "");
      handlers.onTurnError?.(workspace_id, reboundThreadId, targetTurnId, {
        message: normalizedMessage,
        willRetry: false,
        engine: resolveEventEngine(reboundThreadId, reboundBinding?.engine),
        ...(reboundBinding?.executionTargetSnapshot
          ? { executionTargetSnapshot: reboundBinding.executionTargetSnapshot }
          : {}),
      });
    });
    return;
  }

  if (method === "turn/error") {
    const params = message.params as Record<string, unknown>;
    const threadId =
      sharedBridge?.sharedThreadId ??
      String(params.threadId ?? params.thread_id ?? "");
    const turnId = String(params.turnId ?? params.turn_id ?? "");
    const willRetry = Boolean(params.willRetry ?? params.will_retry);
    const errorValue = params.error;
    const messageText =
      typeof errorValue === "string"
        ? errorValue
        : typeof errorValue === "object" && errorValue
          ? String((errorValue as Record<string, unknown>).message ?? "")
          : "";
    const suppressMessage =
      Boolean(sharedBridge) &&
      String(
        params.sharedRecoveryReason ?? params.shared_recovery_reason ?? "",
      ) === "native-session-not-found";
    if (threadId) {
      handlers.onTurnError?.(workspace_id, threadId, turnId, {
        message: messageText,
        willRetry,
        ...(suppressMessage ? { suppressMessage: true } : {}),
        engine: resolveEventEngine(threadId, sharedBridge?.engine),
        ...(sharedBridge?.executionTargetSnapshot
          ? { executionTargetSnapshot: sharedBridge.executionTargetSnapshot }
          : {}),
      });
    }
    return;
  }

  if (method === "turn/stalled") {
    const params = message.params as Record<string, unknown>;
    const threadId =
      sharedBridge?.sharedThreadId ??
      String(params.threadId ?? params.thread_id ?? "");
    const turnId = String(params.turnId ?? params.turn_id ?? "");
    const rawStartedAtMs = Number(
      params.startedAtMs ?? params.started_at_ms ?? 0,
    );
    const rawTimeoutMs = Number(params.timeoutMs ?? params.timeout_ms ?? 0);
    const runtimeGeneration = asString(
      params.runtimeGeneration ?? params.runtime_generation,
    ).trim();
    const rawRuntimeProcessId = Number(
      params.runtimeProcessId ?? params.runtime_process_id ?? 0,
    );
    const rawRuntimeStartedAtMs = Number(
      params.runtimeStartedAtMs ?? params.runtime_started_at_ms ?? 0,
    );
    if (threadId) {
      handlers.onTurnStalled?.(workspace_id, threadId, turnId, {
        message: String(params.message ?? ""),
        reasonCode: String(params.reasonCode ?? params.reason_code ?? ""),
        stage: String(params.stage ?? ""),
        source: String(params.source ?? ""),
        ...(runtimeGeneration ? { runtimeGeneration } : {}),
        ...(Number.isFinite(rawRuntimeProcessId) && rawRuntimeProcessId > 0
          ? { runtimeProcessId: Math.trunc(rawRuntimeProcessId) }
          : {}),
        ...(Number.isFinite(rawRuntimeStartedAtMs) && rawRuntimeStartedAtMs > 0
          ? { runtimeStartedAtMs: Math.trunc(rawRuntimeStartedAtMs) }
          : {}),
        startedAtMs:
          Number.isFinite(rawStartedAtMs) && rawStartedAtMs > 0
            ? Math.trunc(rawStartedAtMs)
            : null,
        timeoutMs:
          Number.isFinite(rawTimeoutMs) && rawTimeoutMs > 0
            ? Math.trunc(rawTimeoutMs)
            : null,
        engine: resolveEventEngine(threadId, sharedBridge?.engine),
      });
    }
    return;
  }

  if (method === "codex/backgroundThread") {
    if (sharedBridge) {
      return;
    }
    const params = message.params as Record<string, unknown>;
    const threadId = String(params.threadId ?? params.thread_id ?? "");
    const action = String(params.action ?? "hide");
    if (threadId) {
      handlers.onBackgroundThreadAction?.(workspace_id, threadId, action);
    }
    return;
  }

  if (method === "error") {
    const params = message.params as Record<string, unknown>;
    const threadId =
      sharedBridge?.sharedThreadId ??
      String(params.threadId ?? params.thread_id ?? "");
    const turnId = String(params.turnId ?? params.turn_id ?? "");
    const error = (params.error as Record<string, unknown> | undefined) ?? {};
    const messageText = String(error.message ?? "");
    const willRetry = Boolean(params.willRetry ?? params.will_retry);
    const suppressMessage =
      Boolean(sharedBridge) &&
      String(
        params.sharedRecoveryReason ?? params.shared_recovery_reason ?? "",
      ) === "native-session-not-found";
    if (threadId) {
      handlers.onTurnError?.(workspace_id, threadId, turnId, {
        message: messageText,
        willRetry,
        ...(suppressMessage ? { suppressMessage: true } : {}),
        engine: resolveEventEngine(threadId, sharedBridge?.engine),
        ...(sharedBridge?.executionTargetSnapshot
          ? { executionTargetSnapshot: sharedBridge.executionTargetSnapshot }
          : {}),
      });
    }
    return;
  }

  if (method === "turn/completed") {
    const params = message.params as Record<string, unknown>;
    const turn = params.turn as Record<string, unknown> | undefined;
    const rawCompletedThreadId = String(
      params.threadId ??
        params.thread_id ??
        turn?.threadId ??
        turn?.thread_id ??
        "",
    );
    const threadId = sharedBridge?.sharedThreadId ?? rawCompletedThreadId;
    const turnId = asString(
      params.turnId ?? params.turn_id ?? turn?.id ?? "",
    ).trim();
    if (threadId) {
      const seenDelta = Boolean(threadAgentDeltaSeenRef.current[threadId]);
      const seenCompleted = hasThreadAgentCompletion(
        threadAgentCompletedSeenRef,
        threadId,
      );
      const result =
        (params.result as Record<string, unknown> | undefined) ?? undefined;
      const textFromResult = [
        typeof params.text === "string" ? params.text : "",
        typeof result?.text === "string" ? String(result.text) : "",
        typeof result?.output_text === "string"
          ? String(result.output_text)
          : "",
        typeof result?.outputText === "string" ? String(result.outputText) : "",
        typeof result?.content === "string" ? String(result.content) : "",
      ]
        .map((item) => item.trim())
        .find((item) => item.length > 0);
      const shouldSettleTerminalFinal =
        Boolean(textFromResult) &&
        !seenCompleted &&
        (!seenDelta || Boolean(sharedBridge));
      const emitSharedTerminalProjection = (
        itemId: string,
        text: string,
      ): boolean => {
        if (
          !sharedBridge?.executionTargetSnapshot ||
          !handlers.onNormalizedRealtimeEvent
        ) {
          return false;
        }
        handlers.onNormalizedRealtimeEvent({
          engine: sharedBridge.engine,
          workspaceId: workspace_id,
          threadId,
          eventId: `shared-terminal:${turnId || itemId}`,
          itemKind: "message",
          timestampMs: Date.now(),
          item: {
            id: itemId,
            kind: "message",
            role: "assistant",
            text,
            isFinal: true,
            engineSource: sharedBridge.engine,
            executionTargetSnapshot: sharedBridge.executionTargetSnapshot,
          },
          operation: "completeAgentMessage",
          sourceMethod: method,
          turnId: turnId || null,
        });
        return true;
      };
      if (shouldSettleTerminalFinal && textFromResult) {
        const fallbackItemId =
          (sharedBridge
            ? resolveLatestThreadAgentSnapshotItemId(
                threadAgentSnapshotSeenRef,
                threadId,
              )
            : null) ||
          turnId ||
          `assistant-final-${Date.now()}`;
        if (
          markThreadAgentCompletionSeen(
            threadAgentCompletedSeenRef,
            threadId,
            fallbackItemId,
            textFromResult,
          )
        ) {
          // Shared canvas projection is best-effort; project-memory fusion always
          // needs onAgentMessageCompleted even when projection already succeeded.
          emitSharedTerminalProjection(fallbackItemId, textFromResult);
          handlers.onAgentMessageCompleted?.({
            workspaceId: workspace_id,
            threadId,
            itemId: fallbackItemId,
            text: textFromResult,
            ...(turnId ? { turnId } : {}),
          });
        }
      }
      if (
        !textFromResult &&
        !seenCompleted &&
        !seenDelta &&
        sharedBridge?.executionTargetSnapshot
      ) {
        const provenanceAnchorId =
          resolveLatestThreadAgentSnapshotItemId(
            threadAgentSnapshotSeenRef,
            threadId,
          ) ||
          turnId ||
          `assistant-provenance-${Date.now()}`;
        if (
          markThreadAgentCompletionSeen(
            threadAgentCompletedSeenRef,
            threadId,
            provenanceAnchorId,
            "",
          )
        ) {
          emitSharedTerminalProjection(provenanceAnchorId, "");
        }
      }
      delete threadAgentDeltaSeenRef.current[threadId];
      delete threadAgentCompletedSeenRef.current[threadId];
      delete threadAgentSnapshotSeenRef.current[threadId];
      handlers.onTurnCompleted?.(workspace_id, threadId, turnId);

      // Try to extract usage data from turn/completed (Codex may include it here)
      const usage =
        (params.usage as Record<string, unknown> | undefined) ??
        ((params.result as Record<string, unknown> | undefined)?.usage as
          | Record<string, unknown>
          | undefined);

      if (usage) {
        const inputTokens = Number(
          usage.input_tokens ?? usage.inputTokens ?? 0,
        );
        const outputTokens = Number(
          usage.output_tokens ?? usage.outputTokens ?? 0,
        );
        const cachedInputTokens = Number(
          usage.cached_input_tokens ??
            usage.cache_read_input_tokens ??
            usage.cachedInputTokens ??
            usage.cacheReadInputTokens ??
            0,
        );
        const modelContextWindow = resolveLegacyModelContextWindow(
          threadId,
          usage.model_context_window ?? usage.modelContextWindow,
        );

        if (inputTokens > 0 || outputTokens > 0) {
          const tokenUsage = {
            total: {
              inputTokens,
              outputTokens,
              cachedInputTokens,
              totalTokens: inputTokens + outputTokens,
            },
            last: {
              inputTokens,
              outputTokens,
              cachedInputTokens,
              totalTokens: inputTokens + outputTokens,
            },
            modelContextWindow,
            contextUsageSource: "turn_completed_usage",
            contextUsageFreshness: "estimated",
          };
          handlers.onThreadTokenUsageUpdated?.(
            workspace_id,
            threadId,
            tokenUsage,
          );
        }
      }
    }
    return;
  }

  if (method === "processing/heartbeat") {
    const params = message.params as Record<string, unknown>;
    const threadId =
      sharedBridge?.sharedThreadId ??
      String(params.threadId ?? params.thread_id ?? "");
    const pulse = Number(params.pulse ?? 0);
    if (threadId && Number.isFinite(pulse) && pulse > 0) {
      handlers.onProcessingHeartbeat?.(workspace_id, threadId, pulse);
    }
    return;
  }

  if (method === "thread/compacted") {
    const params = message.params as Record<string, unknown>;
    const threadId =
      sharedBridge?.sharedThreadId ?? extractThreadIdFromParams(params);
    const turnId = extractTurnIdFromParams(params);
    if (threadId) {
      const sourceFlags = extractCompactionSourceFlags(params);
      if (sourceFlags) {
        handlers.onContextCompacted?.(
          workspace_id,
          threadId,
          turnId,
          sourceFlags,
        );
      } else {
        handlers.onContextCompacted?.(workspace_id, threadId, turnId);
      }
    }
    return;
  }

  if (method === "thread/compacting") {
    const params = message.params as Record<string, unknown>;
    const threadId =
      sharedBridge?.sharedThreadId ?? extractThreadIdFromParams(params);
    if (threadId) {
      const usagePercentRaw = Number(
        params.usagePercent ?? params.usage_percent,
      );
      const thresholdPercentRaw = Number(
        params.thresholdPercent ?? params.threshold_percent,
      );
      const targetPercentRaw = Number(
        params.targetPercent ?? params.target_percent,
      );
      const sourceFlags = extractCompactionSourceFlags(params);
      const compactionPayload: {
        usagePercent: number | null;
        thresholdPercent: number | null;
        targetPercent: number | null;
        auto?: boolean | null;
        manual?: boolean | null;
      } = {
        usagePercent: Number.isFinite(usagePercentRaw) ? usagePercentRaw : null,
        thresholdPercent: Number.isFinite(thresholdPercentRaw)
          ? thresholdPercentRaw
          : null,
        targetPercent: Number.isFinite(targetPercentRaw)
          ? targetPercentRaw
          : null,
      };
      if (sourceFlags?.auto !== null && sourceFlags?.auto !== undefined) {
        compactionPayload.auto = sourceFlags.auto;
      }
      if (sourceFlags?.manual !== null && sourceFlags?.manual !== undefined) {
        compactionPayload.manual = sourceFlags.manual;
      }
      handlers.onContextCompacting?.(workspace_id, threadId, compactionPayload);
    }
    return;
  }

  if (method === "thread/compactionFailed") {
    const params = message.params as Record<string, unknown>;
    const threadId =
      sharedBridge?.sharedThreadId ?? extractThreadIdFromParams(params);
    if (threadId) {
      const reason = String(params.reason ?? "").trim();
      handlers.onContextCompactionFailed?.(workspace_id, threadId, reason);
    }
    return;
  }

  if (method === "turn/plan/updated") {
    const params = message.params as Record<string, unknown>;
    const threadId =
      sharedBridge?.sharedThreadId ??
      String(params.threadId ?? params.thread_id ?? "");
    const turnId = String(params.turnId ?? params.turn_id ?? "");
    if (threadId) {
      handlers.onTurnPlanUpdated?.(workspace_id, threadId, turnId, {
        explanation: params.explanation,
        plan: params.plan,
      });
    }
    return;
  }

  if (method === "turn/diff/updated") {
    const params = message.params as Record<string, unknown>;
    const threadId =
      sharedBridge?.sharedThreadId ??
      String(params.threadId ?? params.thread_id ?? "");
    const diff = String(params.diff ?? "");
    if (threadId && diff) {
      handlers.onTurnDiffUpdated?.(workspace_id, threadId, diff);
    }
    return;
  }

  if (method === "thread/tokenUsage/updated") {
    const params = message.params as Record<string, unknown>;
    const threadId =
      sharedBridge?.sharedThreadId ??
      String(params.threadId ?? params.thread_id ?? "");
    const tokenUsage =
      (params.tokenUsage as Record<string, unknown> | undefined) ??
      (params.token_usage as Record<string, unknown> | undefined);
    if (threadId && tokenUsage) {
      handlers.onThreadTokenUsageUpdated?.(workspace_id, threadId, tokenUsage);
    }
    return;
  }

  // Handle Codex token_count events (Codex sends usage data this way)
  // Format: {"method":"token_count","params":{"info":{"total_token_usage":{...}}}}
  if (method === "token_count") {
    const params = message.params as Record<string, unknown>;
    const info = params.info as Record<string, unknown> | undefined;
    let threadId = String(params.threadId ?? params.thread_id ?? "");
    if (sharedBridge?.sharedThreadId) {
      threadId = sharedBridge.sharedThreadId;
    }

    if (!threadId) {
      threadId = resolveCodexOwnerThreadId(
        handlers,
        workspace_id,
        method,
        params,
      );
    }

    // Skip this event if threadId is still unavailable
    if (!threadId) {
      return;
    }

    if (info) {
      const totalUsageData =
        (info.total_token_usage as Record<string, unknown> | undefined) ??
        (info.totalTokenUsage as Record<string, unknown> | undefined);
      const lastUsageData =
        (info.last_token_usage as Record<string, unknown> | undefined) ??
        (info.lastTokenUsage as Record<string, unknown> | undefined);
      // Prefer last/current snapshot, fallback to total when unavailable.
      const fallbackUsageData = lastUsageData ?? totalUsageData;

      if (fallbackUsageData) {
        const normalizeUsage = (usageData: Record<string, unknown>) => {
          const inputTokens = Number(
            usageData.input_tokens ?? usageData.inputTokens ?? 0,
          );
          const outputTokens = Number(
            usageData.output_tokens ?? usageData.outputTokens ?? 0,
          );
          const cachedInputTokens = Number(
            usageData.cached_input_tokens ??
              usageData.cache_read_input_tokens ??
              usageData.cachedInputTokens ??
              usageData.cacheReadInputTokens ??
              0,
          );
          return {
            inputTokens,
            outputTokens,
            cachedInputTokens,
            totalTokens: inputTokens + outputTokens,
          };
        };

        const totalUsage = normalizeUsage(totalUsageData ?? fallbackUsageData);
        const lastUsage = lastUsageData
          ? normalizeUsage(lastUsageData)
          : {
              inputTokens: 0,
              outputTokens: 0,
              cachedInputTokens: 0,
              totalTokens: 0,
            };
        const modelContextWindow = resolveLegacyModelContextWindow(
          threadId,
          lastUsageData?.model_context_window ??
            lastUsageData?.modelContextWindow ??
            totalUsageData?.model_context_window ??
            totalUsageData?.modelContextWindow ??
            info.model_context_window ??
            info.modelContextWindow,
        );

        const tokenUsage = {
          total: totalUsage,
          last: lastUsage,
          modelContextWindow,
          contextUsageSource: "token_count",
          contextUsageFreshness: "live",
        };

        handlers.onThreadTokenUsageUpdated?.(
          workspace_id,
          threadId,
          tokenUsage,
        );
      }
    }
    return;
  }

  if (method === "account/rateLimits/updated") {
    const params = message.params as Record<string, unknown>;
    const rateLimits =
      (params.rateLimits as Record<string, unknown> | undefined) ??
      (params.rate_limits as Record<string, unknown> | undefined);
    if (rateLimits) {
      handlers.onAccountRateLimitsUpdated?.(workspace_id, rateLimits);
    }
    return;
  }

  if (method === "item/completed") {
    const params = message.params as Record<string, unknown>;
    const rawItemThreadId = extractThreadIdFromParams(params);
    const itemBridge = rawItemThreadId
      ? resolveSharedSessionBindingByNativeThread(workspace_id, rawItemThreadId)
      : null;
    const threadId = itemBridge?.sharedThreadId ?? rawItemThreadId;
    const item =
      params.item && typeof params.item === "object"
        ? hydrateToolSnapshotWithEventParams(
            params.item as Record<string, unknown>,
            params,
          )
        : undefined;
    if (threadId && item) {
      const contextualItem = withRealtimeItemEventContext(
        item,
        params,
        itemBridge?.engine,
      );
      handlers.onItemCompleted?.(workspace_id, threadId, contextualItem);

      // Try to extract usage data from item/completed (Codex may include it here)
      const usage =
        (contextualItem.usage as Record<string, unknown> | undefined) ??
        (params.usage as Record<string, unknown> | undefined);

      if (usage) {
        const inputTokens = Number(
          usage.input_tokens ?? usage.inputTokens ?? 0,
        );
        const outputTokens = Number(
          usage.output_tokens ?? usage.outputTokens ?? 0,
        );
        const cachedInputTokens = Number(
          usage.cached_input_tokens ??
            usage.cache_read_input_tokens ??
            usage.cachedInputTokens ??
            usage.cacheReadInputTokens ??
            0,
        );
        const modelContextWindow = resolveLegacyModelContextWindow(
          threadId,
          usage.model_context_window ?? usage.modelContextWindow,
        );

        if (inputTokens > 0 || outputTokens > 0 || cachedInputTokens > 0) {
          const tokenUsage = {
            total: {
              inputTokens,
              outputTokens,
              cachedInputTokens,
              totalTokens: inputTokens + outputTokens,
            },
            last: {
              inputTokens,
              outputTokens,
              cachedInputTokens,
              totalTokens: inputTokens + outputTokens,
            },
            modelContextWindow,
            contextUsageSource: "item_completed_usage",
            contextUsageFreshness: "estimated",
          };
          handlers.onThreadTokenUsageUpdated?.(
            workspace_id,
            threadId,
            tokenUsage,
          );
        }
      }
    }
    if (threadId && item?.type === "agentMessage") {
      const contextualItem = withRealtimeItemEventContext(
        item,
        params,
        itemBridge?.engine,
      );
      const itemId = String(contextualItem.id ?? "");
      const text = String(contextualItem.text ?? "");
      const turnId = asString(
        contextualItem.turnId ?? contextualItem.turn_id,
      ).trim();
      if (
        itemId &&
        markThreadAgentCompletionSeen(
          threadAgentCompletedSeenRef,
          threadId,
          itemId,
          text,
        )
      ) {
        handlers.onAgentMessageCompleted?.({
          workspaceId: workspace_id,
          threadId,
          itemId,
          text,
          ...(turnId ? { turnId } : {}),
        });
      }
    }
    return;
  }

  if (method === "item/started") {
    const params = message.params as Record<string, unknown>;
    const rawItemThreadId = extractThreadIdFromParams(params);
    const itemBridge = rawItemThreadId
      ? resolveSharedSessionBindingByNativeThread(workspace_id, rawItemThreadId)
      : null;
    const threadId = itemBridge?.sharedThreadId ?? rawItemThreadId;
    const item =
      params.item && typeof params.item === "object"
        ? hydrateToolSnapshotWithEventParams(
            params.item as Record<string, unknown>,
            params,
          )
        : undefined;
    if (threadId && item) {
      const contextualItem = withRealtimeItemEventContext(
        item,
        params,
        itemBridge?.engine,
      );
      if (
        shouldIgnoreAgentMessageSnapshot({
          threadId,
          itemType: String(contextualItem.type ?? ""),
          method,
          threadAgentDeltaSeenRef,
        })
      ) {
        return;
      }
      if (
        String(contextualItem.type ?? "") === "agentMessage" &&
        hasAgentMessageSnapshotText(contextualItem)
      ) {
        threadAgentDeltaSeenRef.current[threadId] = true;
        markThreadAgentSnapshotSeen(
          threadAgentSnapshotSeenRef,
          threadId,
          String(contextualItem.id ?? ""),
        );
      }
      handlers.onItemStarted?.(workspace_id, threadId, contextualItem);
    }
    return;
  }

  if (method === "item/updated") {
    const params = message.params as Record<string, unknown>;
    const rawItemThreadId = extractThreadIdFromParams(params);
    const itemBridge = rawItemThreadId
      ? resolveSharedSessionBindingByNativeThread(workspace_id, rawItemThreadId)
      : null;
    const threadId = itemBridge?.sharedThreadId ?? rawItemThreadId;
    const item =
      params.item && typeof params.item === "object"
        ? hydrateToolSnapshotWithEventParams(
            params.item as Record<string, unknown>,
            params,
          )
        : undefined;
    if (threadId && item) {
      const contextualItem = withRealtimeItemEventContext(
        item,
        params,
        itemBridge?.engine,
      );
      if (
        shouldIgnoreAgentMessageSnapshot({
          threadId,
          itemType: String(contextualItem.type ?? ""),
          method,
          threadAgentDeltaSeenRef,
        })
      ) {
        return;
      }
      if (
        String(contextualItem.type ?? "") === "agentMessage" &&
        hasAgentMessageSnapshotText(contextualItem)
      ) {
        threadAgentDeltaSeenRef.current[threadId] = true;
        markThreadAgentSnapshotSeen(
          threadAgentSnapshotSeenRef,
          threadId,
          String(contextualItem.id ?? ""),
        );
      }
      handlers.onItemUpdated?.(workspace_id, threadId, contextualItem);
    }
    return;
  }

  if (
    method === "item/reasoning/summaryTextDelta" ||
    method === "response.reasoning_summary_text.delta" ||
    method === "response.reasoning_summary_text.done" ||
    method === "response.reasoning_summary.delta" ||
    method === "response.reasoning_summary.done" ||
    method === "response.reasoning_summary_part.done"
  ) {
    const params = message.params as Record<string, unknown>;
    const resolvedThreadId = resolveCodexOwnerThreadId(
      handlers,
      workspace_id,
      method,
      params,
    );
    const sharedBridge = resolveSharedSessionBindingByNativeThread(
      workspace_id,
      resolvedThreadId,
    );
    const threadId = sharedBridge?.sharedThreadId ?? resolvedThreadId;
    const itemId = extractItemIdFromParams(params);
    const delta = extractReasoningDeltaFromParams(params);
    const turnId = extractTurnIdFromParams(params) || null;
    if (threadId && itemId && delta) {
      const engineHint = inferGeminiReasoningHintFromThreadId(resolvedThreadId);
      emitReasoningSummaryDelta(
        handlers,
        workspace_id,
        threadId,
        itemId,
        delta,
        engineHint,
        turnId,
      );
    }
    return;
  }

  if (
    method === "item/reasoning/summaryPartAdded" ||
    method === "response.reasoning_summary_part.added"
  ) {
    const params = message.params as Record<string, unknown>;
    const resolvedThreadId = resolveCodexOwnerThreadId(
      handlers,
      workspace_id,
      method,
      params,
    );
    const sharedBridge = resolveSharedSessionBindingByNativeThread(
      workspace_id,
      resolvedThreadId,
    );
    const threadId = sharedBridge?.sharedThreadId ?? resolvedThreadId;
    const itemId = extractItemIdFromParams(params);
    const turnId = extractTurnIdFromParams(params) || null;
    if (threadId && itemId) {
      const engineHint = inferGeminiReasoningHintFromThreadId(resolvedThreadId);
      emitReasoningSummaryBoundary(
        handlers,
        workspace_id,
        threadId,
        itemId,
        engineHint,
        turnId,
      );
    }
    return;
  }

  if (
    method === "item/reasoning/textDelta" ||
    method === "response.reasoning_text.delta" ||
    method === "response.reasoning_text.done"
  ) {
    const params = message.params as Record<string, unknown>;
    const resolvedThreadId = resolveCodexOwnerThreadId(
      handlers,
      workspace_id,
      method,
      params,
    );
    const sharedBridge = resolveSharedSessionBindingByNativeThread(
      workspace_id,
      resolvedThreadId,
    );
    const threadId = sharedBridge?.sharedThreadId ?? resolvedThreadId;
    const itemId = extractItemIdFromParams(params);
    const delta = extractReasoningDeltaFromParams(params);
    const turnId = extractTurnIdFromParams(params) || null;
    if (threadId && itemId && delta) {
      const engineHint = inferGeminiReasoningHintFromThreadId(resolvedThreadId);
      emitReasoningTextDelta(
        handlers,
        workspace_id,
        threadId,
        itemId,
        delta,
        engineHint,
        turnId,
      );
    }
    return;
  }

  // Compatibility for Codex app-server variants that emit reasoning deltas
  // without the "textDelta" suffix.
  if (method === "item/reasoning/delta") {
    const params = message.params as Record<string, unknown>;
    const resolvedThreadId = resolveCodexOwnerThreadId(
      handlers,
      workspace_id,
      method,
      params,
    );
    const sharedBridge = resolveSharedSessionBindingByNativeThread(
      workspace_id,
      resolvedThreadId,
    );
    const threadId = sharedBridge?.sharedThreadId ?? resolvedThreadId;
    const itemId = extractItemIdFromParams(params);
    const delta = extractReasoningDeltaFromParams(params);
    const turnId = extractTurnIdFromParams(params) || null;
    if (threadId && itemId && delta) {
      const engineHint = inferGeminiReasoningHintFromThreadId(resolvedThreadId);
      emitReasoningTextDelta(
        handlers,
        workspace_id,
        threadId,
        itemId,
        delta,
        engineHint,
        turnId,
      );
    }
    return;
  }

  if (method === "item/commandExecution/outputDelta") {
    const params = message.params as Record<string, unknown>;
    const resolvedThreadId = extractThreadIdFromParams(params);
    const threadId =
      resolveSharedSessionBindingByNativeThread(workspace_id, resolvedThreadId)
        ?.sharedThreadId ?? resolvedThreadId;
    const itemId = extractItemIdFromParams(params);
    const delta = String(params.delta ?? "");
    const turnId = extractTurnIdFromParams(params) || null;
    if (threadId && itemId && delta) {
      emitCommandOutputDelta(
        handlers,
        workspace_id,
        threadId,
        itemId,
        delta,
        turnId,
      );
    }
    return;
  }

  if (method === "item/commandExecution/terminalInteraction") {
    const params = message.params as Record<string, unknown>;
    const resolvedThreadId = extractThreadIdFromParams(params);
    const threadId =
      resolveSharedSessionBindingByNativeThread(workspace_id, resolvedThreadId)
        ?.sharedThreadId ?? resolvedThreadId;
    const itemId = extractItemIdFromParams(params);
    const stdin = String(params.stdin ?? "");
    const turnId = extractTurnIdFromParams(params) || null;
    if (threadId && itemId) {
      emitTerminalInteraction(
        handlers,
        workspace_id,
        threadId,
        itemId,
        stdin,
        turnId,
      );
    }
    return;
  }

  if (method === "item/fileChange/outputDelta") {
    const params = message.params as Record<string, unknown>;
    const threadId = extractThreadIdFromParams(params);
    const itemId = extractItemIdFromParams(params);
    const delta = String(params.delta ?? "");
    const turnId = extractTurnIdFromParams(params) || null;
    if (threadId && itemId && delta) {
      emitFileChangeOutputDelta(
        handlers,
        workspace_id,
        threadId,
        itemId,
        delta,
        turnId,
      );
    }
    return;
  }
}

export function dispatchAppServerEventBatch(
  handlers: AppServerEventHandlers,
  batch: readonly AppServerEvent[],
  options: DispatchAppServerEventBatchOptions,
): () => void {
  const events = coalesceAppServerEventBatch(batch);
  const chunkSize = Math.max(
    1,
    Math.trunc(options.chunkSize ?? DEFAULT_APP_SERVER_EVENT_BATCH_CHUNK_SIZE),
  );
  let cursor = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;
  let completed = false;

  const completeOnce = () => {
    if (completed) {
      return;
    }
    completed = true;
    options.onComplete?.();
  };

  const processNextChunk = () => {
    timeoutId = null;
    if (cancelled) {
      completeOnce();
      return;
    }
    const end = Math.min(cursor + chunkSize, events.length);
    while (cursor < end) {
      dispatchAppServerEvent(handlers, events[cursor], options);
      cursor += 1;
    }
    if (cursor >= events.length) {
      completeOnce();
      return;
    }
    timeoutId = setTimeout(processNextChunk, 0);
  };

  processNextChunk();

  return () => {
    cancelled = true;
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    completeOnce();
  };
}

export function useAppServerEvents(
  handlers: AppServerEventHandlers,
  options: UseAppServerEventsOptions = {},
) {
  const threadAgentDeltaSeenRef = useRef<Record<string, true>>({});
  const threadAgentCompletedSeenRef = useRef<ThreadAgentCompletedItemTracker>(
    {},
  );
  const threadAgentSnapshotSeenRef = useRef<ThreadAgentSnapshotItemTracker>({});
  // Per design §1.1: handlers and dispatcher options must be reached via
  // refs so the effect can keep a stable subscription identity while still
  // seeing the latest closure values on every event.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const dispatcherOptionsRef = useRef({
    useNormalizedRealtimeAdapters:
      options.useNormalizedRealtimeAdapters === true,
    threadAgentDeltaSeenRef,
    threadAgentCompletedSeenRef,
    threadAgentSnapshotSeenRef,
  });
  dispatcherOptionsRef.current = {
    useNormalizedRealtimeAdapters:
      options.useNormalizedRealtimeAdapters === true,
    threadAgentDeltaSeenRef,
    threadAgentCompletedSeenRef,
    threadAgentSnapshotSeenRef,
  };
  const batchConsumerEnabled = isAppServerEventBatchConsumerEnabled();
  const rawFallbackQueueRef = useRef<AppServerEvent[]>([]);
  const rawFallbackSchedule = resolveDispatchSchedule({
    tier: readStreamingScheduleTier(),
    isLiveRow: false,
    isHeavy: false,
    isCritical: false,
  });
  const rawFallbackScheduleRef = useRef(rawFallbackSchedule);
  rawFallbackScheduleRef.current = rawFallbackSchedule;
  const rawFallbackScheduler = useRenderScheduler({
    budgetMs: rawFallbackSchedule.budgetMs,
    idleTimeoutMs: rawFallbackSchedule.idleTimeoutMs,
  });
  const dispatchRawFallbackQueue = useCallback((): boolean => {
    const startedAt =
      typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();
    let dispatchedInChunk = 0;
    while (
      rawFallbackQueueRef.current.length > 0 &&
      dispatchedInChunk < DEFAULT_APP_SERVER_EVENT_BATCH_CHUNK_SIZE
    ) {
      const elapsed =
        (typeof performance !== "undefined" &&
        typeof performance.now === "function"
          ? performance.now()
          : Date.now()) - startedAt;
      if (
        dispatchedInChunk > 0 &&
        rawFallbackScheduleRef.current.budgetMs > 0 &&
        elapsed >= rawFallbackScheduleRef.current.budgetMs
      ) {
        break;
      }
      const next = rawFallbackQueueRef.current.shift()!;
      dispatchedInChunk += 1;
      try {
        dispatchAppServerEvent(
          handlersRef.current,
          next,
          dispatcherOptionsRef.current,
        );
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("[useAppServerEvents] raw fallback dispatch failed", error);
      }
    }
    return rawFallbackQueueRef.current.length > 0;
  }, []);
  useAppServerEventBatchDispatch(handlers, {
    ...dispatcherOptionsRef.current,
    enableInternalBatchSubscription: batchConsumerEnabled,
  });

  useEffect(() => {
    if (batchConsumerEnabled) {
      return undefined;
    }
    const rawFallbackQueue = rawFallbackQueueRef.current;
    const unsubscribe = subscribeRawAppServerEvents((payload) => {
      rawFallbackQueue.push(payload);
      rawFallbackScheduler.scheduleChunk(dispatchRawFallbackQueue);
    });
    return () => {
      unsubscribe();
      rawFallbackQueue.length = 0;
      rawFallbackScheduler.cancel();
    };
  }, [batchConsumerEnabled, dispatchRawFallbackQueue, rawFallbackScheduler]);
}
