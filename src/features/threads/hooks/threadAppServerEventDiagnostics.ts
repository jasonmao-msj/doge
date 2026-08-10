import type { AppServerEvent, DebugEntry } from "../../../types";
import { classifyClientStderr } from "../../debug/utils/clientErrorLog";
import { captureClaudeMcpRuntimeSnapshotFromRaw } from "../utils/claudeMcpRuntimeSnapshot";
import { stripBackendErrorPrefix } from "../utils/networkErrors";
import { buildThreadStreamCorrelationDimensions } from "../utils/streamLatencyDiagnostics";
import {
  asString,
  isThreadSessionMirrorEnabled,
  shouldEmitServerDebugEntry,
  type ThreadLifecycleSnapshot,
} from "./threadEventDiagnostics";
import {
  FOREGROUND_TERMINAL_EVENT_METHODS,
  extractTerminalEventResultTextLength,
  extractTerminalEventThreadId,
  extractTerminalEventTurnId,
  normalizeRuntimeEndedCount,
} from "./threadTerminalEventHelpers";

type ThreadAppServerEventDiagnosticsInput = {
  event: AppServerEvent;
  onDebug?: (entry: DebugEntry) => void;
  getThreadLifecycleSnapshot: (threadId: string) => ThreadLifecycleSnapshot;
  getExpectedTurnId: (threadId: string) => string | null;
  emitForegroundSettlementDiagnostic: (
    label: string,
    payload: Record<string, unknown>,
  ) => void;
  noteCodexTurnProgressEvidence: (workspaceId: string | null, threadId: string, source: string) => void;
};

export function isReasoningRawDebugEnabled() {
  if (import.meta.env?.DEV) {
    try {
      const value = window.localStorage.getItem("doge.debug.reasoning.raw");
      if (!value) {
        return true;
      }
      const normalized = value.trim().toLowerCase();
      return !(normalized === "0" || normalized === "false" || normalized === "off");
    } catch {
      return true;
    }
  }
  if (typeof window === "undefined") {
    return false;
  }
  try {
    const value = window.localStorage.getItem("doge.debug.reasoning.raw");
    if (!value) {
      return false;
    }
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "on";
  } catch {
    return false;
  }
}

export function handleThreadAppServerEventDiagnostics({
  event,
  onDebug,
  getThreadLifecycleSnapshot,
  getExpectedTurnId,
  emitForegroundSettlementDiagnostic,
  noteCodexTurnProgressEvidence,
}: ThreadAppServerEventDiagnosticsInput) {
  const method = String(event.message?.method ?? "");
  const params = (event.message?.params as Record<string, unknown> | undefined) ?? {};
  const inferredSource = method === "codex/stderr" ? "stderr" : "event";
  const rawStderrMessage =
    method === "codex/stderr"
      ? stripBackendErrorPrefix(String(params.message ?? "").trim())
      : "";
  const stderrClassification =
    method === "codex/stderr" ? classifyClientStderr(rawStderrMessage) : null;
  const mirrorEnabled = isThreadSessionMirrorEnabled();
  if (onDebug && (mirrorEnabled || shouldEmitServerDebugEntry(method))) {
    onDebug({
      id: `${Date.now()}-server-event`,
      timestamp: Date.now(),
      source: inferredSource,
      label: method || "event",
      payload: stderrClassification
        ? {
            workspaceId: event.workspace_id,
            method: method || "event",
            threadId: String(params.threadId ?? params.thread_id ?? ""),
            turnId: String(params.turnId ?? params.turn_id ?? ""),
            ...stderrClassification,
          }
        : mirrorEnabled
          ? event
          : {
              workspaceId: event.workspace_id,
              method: method || "event",
              threadId: String(params.threadId ?? params.thread_id ?? ""),
              turnId: String(params.turnId ?? params.turn_id ?? ""),
            },
    });
  }

  if (FOREGROUND_TERMINAL_EVENT_METHODS.has(method)) {
    const threadId = extractTerminalEventThreadId(params);
    const turnId = extractTerminalEventTurnId(params);
    const lifecycle = threadId ? getThreadLifecycleSnapshot(threadId) : null;
    emitForegroundSettlementDiagnostic("terminal-event-received", {
      workspaceId: event.workspace_id,
      threadId: threadId || null,
      turnId: turnId || null,
      eventType: method,
      resultTextLength:
        method === "turn/completed"
          ? extractTerminalEventResultTextLength(params)
          : null,
      affectedThreadCount:
        method === "runtime/ended"
          ? normalizeRuntimeEndedCount(params.affectedThreadIds ?? params.affected_thread_ids)
          : null,
      affectedTurnCount:
        method === "runtime/ended"
          ? normalizeRuntimeEndedCount(params.affectedTurnIds ?? params.affected_turn_ids)
          : null,
      pendingRequestCount:
        method === "runtime/ended"
          ? Number(params.pendingRequestCount ?? params.pending_request_count ?? 0)
          : null,
      hadActiveLease:
        method === "runtime/ended"
          ? Boolean(params.hadActiveLease ?? params.had_active_lease ?? false)
          : null,
      isProcessing: lifecycle?.isProcessing ?? null,
      activeTurnId: lifecycle?.activeTurnId ?? null,
      reason: "terminal-event-reached-frontend-handler",
      ...(threadId ? buildThreadStreamCorrelationDimensions(threadId) : {}),
    });
  }

  if (method === "codex/stderr") {
    if (onDebug && isReasoningRawDebugEnabled() && rawStderrMessage) {
      onDebug({
        id: `${Date.now()}-stderr-raw`,
        timestamp: Date.now(),
        source: "event",
        label: "stderr/raw",
        payload: rawStderrMessage,
      });
    }
  }

  if (
    method === "thread/status/changed" ||
    method === "runtime/status/changed" ||
    method === "thread/status"
  ) {
    const threadId = asString(params.threadId ?? params.thread_id).trim();
    const eventTurnId = asString(params.turnId ?? params.turn_id).trim();
    const status = asString(params.status ?? params.state ?? params.phase).trim().toLowerCase();
    const expectedTurnId = getExpectedTurnId(threadId);
    if (
      threadId &&
      eventTurnId &&
      expectedTurnId === eventTurnId &&
      (status === "active" ||
        status === "running" ||
        status === "processing" ||
        status === "alive")
    ) {
      noteCodexTurnProgressEvidence(event.workspace_id ?? null, threadId, `status:${status}`);
    }
  }

  if (method === "claude/raw") {
    const snapshot = captureClaudeMcpRuntimeSnapshotFromRaw(event.workspace_id, params);
    if (snapshot && onDebug) {
      onDebug({
        id: `${Date.now()}-claude-mcp-snapshot`,
        timestamp: Date.now(),
        source: "event",
        label: "claude/mcp-runtime-snapshot",
        payload: {
          workspaceId: snapshot.workspaceId,
          sessionId: snapshot.sessionId,
          capturedAt: snapshot.capturedAt,
          toolsCount: snapshot.tools.length,
          servers: snapshot.mcpServers,
        },
      });
    }
  }

  if (!onDebug || !isReasoningRawDebugEnabled()) {
    return;
  }

  if (
    method !== "item/started" &&
    method !== "item/updated" &&
    method !== "item/completed" &&
    method !== "item/reasoning/summaryTextDelta" &&
    method !== "item/reasoning/summaryPartAdded" &&
    method !== "item/reasoning/textDelta" &&
    method !== "item/reasoning/delta" &&
    method !== "response.reasoning_summary_text.delta" &&
    method !== "response.reasoning_summary_text.done" &&
    method !== "response.reasoning_summary.delta" &&
    method !== "response.reasoning_summary.done" &&
    method !== "response.reasoning_summary_part.added" &&
    method !== "response.reasoning_summary_part.done" &&
    method !== "response.reasoning_text.delta" &&
    method !== "response.reasoning_text.done"
  ) {
    return;
  }

  if (
    method === "item/reasoning/summaryTextDelta" ||
    method === "item/reasoning/summaryPartAdded" ||
    method === "item/reasoning/textDelta" ||
    method === "item/reasoning/delta" ||
    method === "response.reasoning_summary_text.delta" ||
    method === "response.reasoning_summary_text.done" ||
    method === "response.reasoning_summary.delta" ||
    method === "response.reasoning_summary.done" ||
    method === "response.reasoning_summary_part.added" ||
    method === "response.reasoning_summary_part.done" ||
    method === "response.reasoning_text.delta" ||
    method === "response.reasoning_text.done"
  ) {
    onDebug({
      id: `${Date.now()}-reasoning-raw`,
      timestamp: Date.now(),
      source: "event",
      label: `reasoning/raw:${method}`,
      payload: {
        workspaceId: event.workspace_id,
        threadId: String(params.threadId ?? params.thread_id ?? ""),
        itemId: String(params.itemId ?? params.item_id ?? ""),
        delta: params.delta ?? null,
        summaryIndex: params.summaryIndex ?? params.summary_index ?? null,
        params,
      },
    });
    return;
  }
  const item = (params.item as Record<string, unknown> | undefined) ?? {};
  if (String(item.type ?? "") !== "reasoning") {
    return;
  }

  onDebug({
    id: `${Date.now()}-reasoning-raw`,
    timestamp: Date.now(),
    source: "event",
    label: `reasoning/raw:${method}`,
    payload: {
      workspaceId: event.workspace_id,
      threadId: String(params.threadId ?? params.thread_id ?? ""),
      itemId: String(item.id ?? ""),
      summary: item.summary ?? null,
      content: item.content ?? null,
      text: item.text ?? null,
      rawItem: item,
    },
  });
}
