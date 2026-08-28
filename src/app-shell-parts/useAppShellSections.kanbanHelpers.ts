import type { ComposerSessionSelection } from "./selectedComposerSession";
import type { EngineType, SetActiveEngineOptions } from "../types";
import type { ExecutionTarget } from "../features/shared-session/target/types";
import type {
  KanbanTask,
  KanbanTaskSchedule,
} from "../features/kanban/types";

const KANBAN_TAG_REGEX = /&@[^\s]+/g;

export function stripComposerKanbanTagsPreserveFormatting(text: string): string {
  if (!text || !text.includes("&@")) {
    return text;
  }
  const stripped = text.replace(KANBAN_TAG_REGEX, "");
  return stripped
    .replace(/[ \t]+(\r?\n)/g, "$1")
    .replace(/(\r?\n)[ \t]+/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function resolveTaskThreadId(
  threadId: string | null | undefined,
  resolveCanonicalThreadId?: ((threadId: string) => string) | null,
): string | null {
  if (!threadId) {
    return null;
  }
  if (!resolveCanonicalThreadId) {
    return threadId;
  }
  const canonical = resolveCanonicalThreadId(threadId);
  return canonical || threadId;
}

export function resolvePendingSessionThreadCandidate(params: {
  pendingThreadId: string;
  workspaceThreadIds: string[];
  occupiedThreadIds: Set<string>;
}): string | null {
  const isClaudePending = params.pendingThreadId.startsWith("claude-pending-");
  const isOpenCodePending = params.pendingThreadId.startsWith("opencode-pending-");
  if (!isClaudePending && !isOpenCodePending) {
    return null;
  }
  const sessionPrefix = isClaudePending ? "claude:" : "opencode:";
  const candidates = params.workspaceThreadIds.filter(
    (threadId) =>
      threadId.startsWith(sessionPrefix) &&
      !params.occupiedThreadIds.has(threadId),
  );
  return candidates.length === 1 ? candidates[0] : null;
}

export function shouldSyncComposerEngineForKanbanExecution(params: {
  activate?: boolean;
}): boolean {
  return params.activate !== false;
}

export async function syncKanbanExecutionEngineAndModel(params: {
  activate?: boolean;
  target: ExecutionTarget;
  setActiveEngine: (
    engine: EngineType,
    options?: SetActiveEngineOptions,
  ) => Promise<unknown> | unknown;
}): Promise<{
  shouldSyncComposerSelection: boolean;
  outboundModel?: string;
  composerSelection: ComposerSessionSelection | null;
}> {
  const shouldSyncComposerSelection = shouldSyncComposerEngineForKanbanExecution({
    activate: params.activate,
  });
  if (shouldSyncComposerSelection) {
    const providerProfileId = params.target.providerProfileId?.trim() || null;
    if (providerProfileId) {
      await params.setActiveEngine(params.target.engine, { providerProfileId });
    } else {
      await params.setActiveEngine(params.target.engine);
    }
  }
  const catalogEntryId = params.target.modelCatalogEntryId?.trim() || null;
  const runtimeModel = params.target.model?.trim() || null;
  if (!catalogEntryId && !runtimeModel) {
    return {
      shouldSyncComposerSelection,
      outboundModel: undefined,
      composerSelection: null,
    };
  }
  if (!shouldSyncComposerSelection) {
    return {
      shouldSyncComposerSelection,
      outboundModel: runtimeModel ?? undefined,
      composerSelection: null,
    };
  }
  return {
    shouldSyncComposerSelection,
    outboundModel: runtimeModel ?? undefined,
    composerSelection: {
      modelId: catalogEntryId ?? runtimeModel,
      effort: null,
    },
  };
}

export function isRewindSupportedThreadId(threadId: string): boolean {
  const normalized = threadId.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (normalized.startsWith("claude:") || normalized.startsWith("codex:")) {
    return true;
  }
  if (
    normalized.startsWith("claude-pending-") ||
    normalized.startsWith("codex-pending-") ||
    normalized.startsWith("gemini:") ||
    normalized.startsWith("gemini-pending-") ||
    normalized.startsWith("grok:") ||
    normalized.startsWith("grok-pending-") ||
    normalized.startsWith("kimi:") ||
    normalized.startsWith("kimi-pending-") ||
    normalized.startsWith("opencode:") ||
    normalized.startsWith("opencode-pending-")
  ) {
    return false;
  }
  if (normalized.includes(":")) {
    return false;
  }
  return true;
}

export function buildRecurringKanbanTaskCloneInput(
  task: KanbanTask,
  schedule: KanbanTaskSchedule,
) {
  return {
    workspaceId: task.workspaceId,
    panelId: task.panelId,
    title: task.title,
    description: task.description,
    engineType: task.engineType,
    modelId: task.modelId,
    executionTarget: task.executionTarget,
    branchName: task.branchName,
    images: task.images ?? [],
    autoStart: false,
    schedule,
    chain: task.chain
      ? {
          ...task.chain,
          blockedReason: null,
        }
      : undefined,
  };
}
