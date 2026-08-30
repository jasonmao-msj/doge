import { getComposerEnginePrefForEngine } from "../features/composer/hooks/composerEnginePrefsStore";
import type { EngineType } from "../types";

export type ComposerSessionSelection = {
  modelId: string | null;
  effort: string | null;
  /** Runtime CLI value for managed catalog entries (e.g. Doubao aliases). */
  runtimeModel?: string | null;
};

const THREAD_COMPOSER_SELECTION_STORAGE_KEY_PREFIX = "selectedModelByThread.";
const CLAUDE_FORK_THREAD_PREFIX = "claude-fork:";
const CLAUDE_REASONING_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
/** Keep aligned with `GROK_REASONING_OPTIONS` / grok.rs allowlist. */
const GROK_REASONING_EFFORTS = new Set(["low", "medium", "high"]);

export function resolveThreadEngine(
  threadId: string,
): "claude" | "gemini" | "grok" | "kimi" | "opencode" | "codex" | null {
  if (
    threadId.startsWith("claude:") ||
    threadId.startsWith("claude-pending-") ||
    threadId.startsWith(CLAUDE_FORK_THREAD_PREFIX)
  ) {
    return "claude";
  }
  if (threadId.startsWith("gemini:") || threadId.startsWith("gemini-pending-")) {
    return "gemini";
  }
  if (threadId.startsWith("grok:") || threadId.startsWith("grok-pending-")) {
    return "grok";
  }
  if (threadId.startsWith("kimi:") || threadId.startsWith("kimi-pending-")) {
    return "kimi";
  }
  if (threadId.startsWith("opencode:") || threadId.startsWith("opencode-pending-")) {
    return "opencode";
  }
  if (threadId.startsWith("codex:") || threadId.startsWith("codex-pending-")) {
    return "codex";
  }
  return null;
}

export function resolveActiveThreadEngine(input: {
  threadId: string | null;
  threadEngine?: EngineType | null;
  selectedEngine?: EngineType | null;
  fallbackEngine: EngineType;
}): EngineType {
  return (
    input.threadEngine ??
    input.selectedEngine ??
    (input.threadId ? resolveThreadEngine(input.threadId) : null) ??
    input.fallbackEngine
  );
}

export function shouldSyncActiveThreadEngine(input: {
  threadId: string | null;
  activeEngine: EngineType;
  activeThreadEngine: EngineType;
}): boolean {
  return Boolean(
    input.threadId && input.activeEngine !== input.activeThreadEngine,
  );
}

export function extractClaudeForkParentThreadId(threadId: string): string | null {
  if (!threadId.startsWith(CLAUDE_FORK_THREAD_PREFIX)) {
    return null;
  }
  const payload = threadId.slice(CLAUDE_FORK_THREAD_PREFIX.length);
  const separatorIndex = payload.lastIndexOf(":");
  const parentSessionId = separatorIndex >= 0 ? payload.slice(0, separatorIndex) : payload;
  const trimmed = parentSessionId.trim();
  return trimmed.length > 0 ? `claude:${trimmed}` : null;
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeComposerSessionSelection(
  value: unknown,
): ComposerSessionSelection | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const modelId = normalizeNullableString(record.modelId);
  const effort = normalizeNullableString(record.effort);
  const runtimeModel = normalizeNullableString(record.runtimeModel);
  if (modelId === null && effort === null && runtimeModel === null) {
    return null;
  }
  return { modelId, effort, ...(runtimeModel ? { runtimeModel } : {}) };
}

export function normalizeComposerSessionSelectionForThread(
  threadId: string | null,
  value: unknown,
): ComposerSessionSelection | null {
  const normalized = normalizeComposerSessionSelection(value);
  if (!normalized) {
    return null;
  }

  const engine = threadId ? resolveThreadEngine(threadId) : null;
  let effort = normalized.effort;
  if (engine === "claude") {
    effort = effort && CLAUDE_REASONING_EFFORTS.has(effort) ? effort : null;
  } else if (engine === "grok") {
    effort = effort && GROK_REASONING_EFFORTS.has(effort) ? effort : null;
  } else if (engine === "gemini" || engine === "kimi" || engine === "opencode") {
    effort = null;
  }

  if (normalized.modelId === null && effort === null) {
    return null;
  }
  return {
    modelId: normalized.modelId,
    effort,
    ...(normalized.runtimeModel ? { runtimeModel: normalized.runtimeModel } : {}),
  };
}

export function getThreadComposerSelectionStorageKey(
  workspaceId: string | null,
  threadId: string,
): string {
  const workspaceKey =
    typeof workspaceId === "string" && workspaceId.trim().length > 0
      ? workspaceId.trim()
      : "__workspace__unknown__";
  return `${THREAD_COMPOSER_SELECTION_STORAGE_KEY_PREFIX}${workspaceKey}:${threadId}`;
}

export function shouldApplyDraftComposerSelectionToThread(input: {
  candidate: ComposerSessionSelection | null;
  shouldApplyDraftToNextThread: boolean;
  draftComposerSelection: ComposerSessionSelection | null;
  activeThreadId: string | null;
}): boolean {
  return Boolean(
    !input.candidate &&
      input.shouldApplyDraftToNextThread &&
      input.draftComposerSelection &&
      input.activeThreadId &&
      input.activeThreadId.includes("-pending-"),
  );
}

export function shouldMigrateComposerSelectionBetweenThreadIds(input: {
  previousThreadId: string | null;
  activeThreadId: string | null;
  previousSessionKey: string | null;
  activeSessionKey: string | null;
  hasSourceSelection: boolean;
  hasTargetSelection: boolean;
  resolveCanonicalThreadId: (threadId: string) => string;
}): boolean {
  const {
    previousThreadId,
    activeThreadId,
    previousSessionKey,
    activeSessionKey,
    hasSourceSelection,
    hasTargetSelection,
    resolveCanonicalThreadId,
  } = input;

  const previousEngine = previousThreadId ? resolveThreadEngine(previousThreadId) : null;
  const activeEngine = activeThreadId ? resolveThreadEngine(activeThreadId) : null;
  const hasEngineMismatch =
    previousEngine !== null && activeEngine !== null && previousEngine !== activeEngine;
  const hasForwardFinalizeTransition = Boolean(
    previousThreadId &&
      activeThreadId &&
      previousThreadId.includes("-pending-") &&
      !activeThreadId.includes("-pending-"),
  );
  const hasCanonicalMatch = Boolean(
    previousThreadId &&
      activeThreadId &&
      resolveCanonicalThreadId(previousThreadId) === resolveCanonicalThreadId(activeThreadId),
  );

  return Boolean(
    previousThreadId &&
      activeThreadId &&
      previousThreadId !== activeThreadId &&
      previousSessionKey &&
      activeSessionKey &&
      hasSourceSelection &&
      !hasTargetSelection &&
      !hasEngineMismatch &&
      (hasForwardFinalizeTransition || hasCanonicalMatch),
  );
}

export function shouldInheritComposerSelectionFromClaudeForkParent(input: {
  activeThreadId: string | null;
  hasCandidate: boolean;
  hasParentSelection: boolean;
}): boolean {
  return Boolean(
    input.activeThreadId &&
      input.activeThreadId.startsWith(CLAUDE_FORK_THREAD_PREFIX) &&
      !input.hasCandidate &&
      input.hasParentSelection,
  );
}

// Seed a brand-new conversation with the model/effort the user last chose for its
// engine. Codex keeps its own global-selection path, so it opts out here.
export function resolveEngineDefaultComposerSelection(
  threadId: string,
): ComposerSessionSelection | null {
  const engine = resolveThreadEngine(threadId);
  if (!engine || engine === "codex") {
    return null;
  }
  const pref = getComposerEnginePrefForEngine(engine);
  if (pref.modelId === null && pref.effort === null) {
    return null;
  }
  return { modelId: pref.modelId, effort: pref.effort };
}
