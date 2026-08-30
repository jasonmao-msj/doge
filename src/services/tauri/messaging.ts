import { invoke } from "@tauri-apps/api/core";
import { appendRendererDiagnostic } from "../rendererDiagnostics";
import type { EngineType, ReviewTarget } from "../../types";

type CodexTurnStartAckDiagnosticPayload = {
  workspaceId: string;
  threadId: string;
  model: string | null;
  requestStartedAtMs: number;
  respondedAtMs: number;
  durationMs: number;
  outcome: "ok" | "error";
  errorName?: string;
};

function appendCodexTurnStartAckDiagnostic(payload: CodexTurnStartAckDiagnosticPayload) {
  try {
    appendRendererDiagnostic("stream-latency/codex-turn-start-ack", payload);
  } catch {
    // Diagnostics must not change send_user_message invoke behavior.
  }
}

export async function sendUserMessage(
  workspaceId: string,
  threadId: string,
  text: string,
  options?: {
    model?: string | null;
    modelCatalogEntryId?: string | null;
    effort?: string | null;
    disableThinking?: boolean | null;
    accessMode?: "default" | "read-only" | "current" | "full-access";
    images?: string[];
    collaborationMode?: Record<string, unknown> | null;
    preferredLanguage?: string | null;
    customSpecRoot?: string | null;
    resumeSource?: "queue-fusion-cutover" | null;
    resumeTurnId?: string | null;
  },
) {
  const requestStartedAtMs = Date.now();
  const payload: Record<string, unknown> = {
    workspaceId,
    threadId,
    text,
    model: options?.model ?? null,
    modelCatalogEntryId: options?.modelCatalogEntryId ?? null,
    effort: options?.effort ?? null,
    disableThinking: options?.disableThinking ?? false,
    accessMode: options?.accessMode ?? null,
    images: options?.images ?? null,
    preferredLanguage: options?.preferredLanguage ?? null,
    resumeSource: options?.resumeSource ?? null,
    resumeTurnId: options?.resumeTurnId ?? null,
  };
  if (options?.customSpecRoot !== undefined) {
    payload.customSpecRoot = options.customSpecRoot;
  }
  if (options?.collaborationMode) {
    payload.collaborationMode = options.collaborationMode;
  }
  try {
    const response = await invoke("send_user_message", payload);
    const respondedAtMs = Date.now();
    appendCodexTurnStartAckDiagnostic({
      workspaceId,
      threadId,
      model: options?.model ?? null,
      requestStartedAtMs,
      respondedAtMs,
      durationMs: Math.max(0, respondedAtMs - requestStartedAtMs),
      outcome: "ok",
    });
    return response;
  } catch (error) {
    const respondedAtMs = Date.now();
    appendCodexTurnStartAckDiagnostic({
      workspaceId,
      threadId,
      model: options?.model ?? null,
      requestStartedAtMs,
      respondedAtMs,
      durationMs: Math.max(0, respondedAtMs - requestStartedAtMs),
      outcome: "error",
      errorName: error instanceof Error ? error.name : typeof error,
    });
    throw error;
  }
}

export async function interruptTurn(
  workspaceId: string,
  threadId: string,
  turnId: string,
  /** Wave 4 / B.5：Shared Thread 的 Execution Target provider；缺省为 null（旧解析行为）。 */
  providerProfileId?: string | null,
) {
  return invoke("turn_interrupt", {
    workspaceId,
    threadId,
    turnId,
    providerProfileId: providerProfileId ?? null,
  });
}

export async function engineInterruptTurn(
  workspaceId: string,
  turnId: string,
  engine?: EngineType | null,
  providerProfileId?: string | null,
): Promise<void> {
  return invoke("engine_interrupt_turn", {
    workspaceId,
    turnId,
    engine: engine ?? null,
    providerProfileId: providerProfileId ?? null,
  });
}

export async function compactThreadContext(workspaceId: string, threadId: string) {
  return invoke("thread_compact", { workspaceId, threadId });
}

export async function startReview(workspaceId: string, threadId: string, target: ReviewTarget, delivery?: "inline" | "detached") {
  const payload: Record<string, unknown> = { workspaceId, threadId, target };
  if (delivery) {
    payload.delivery = delivery;
  }
  return invoke("start_review", payload);
}
