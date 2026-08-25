import type { ConversationItem } from "../../../types";
import type { HistoryLoader } from "../contracts/conversationCurtainContracts";
import { normalizeHistorySnapshot } from "../contracts/conversationCurtainContracts";
import { normalizeSharedSessionEngine } from "../../shared-session/utils/sharedSessionEngines";
import {
  isSharedProjectionDataSourceEnabled,
  resolveSharedConversationItems,
} from "@/features/shared-session/presentation/sharedProjection/dataSource";
import type { SharedProjectionItem } from "@/features/shared-session/presentation/sharedProjection/types";
import {
  findCanonicalAgentRunId,
  registerAgentConversationEvidence,
} from "../../multi-agent/store/agentStore";
import {
  hydrateSharedTargetState,
  getSharedTargetState,
  getPersistGeneration,
  isSharedTargetPersistInFlight,
} from "../../shared-session/target/targetStore";
import {
  isResolvedExecutionTarget,
  normalizePersistedExecutionTarget,
} from "../../shared-session/target/types";
import { mergeHistoryProjectionItems } from "../assembly/conversationAssembler";
import {
  buildSharedHistoryFinalizeProgress,
  buildSharedHistoryMergeProgress,
  buildSharedHistoryPrepareProgress,
  buildSharedHistoryProjectionProgress,
  buildSharedHistorySessionProgress,
  normalizeHistoryLoadingProgress,
  type HistoryLoadingProgressListener,
} from "@/conversation-presentation/historyLoadingProgress";

type SharedHistoryLoaderOptions = {
  workspaceId: string;
  loadSharedSession: (
    workspaceId: string,
    threadId: string,
  ) => Promise<Record<string, unknown> | null>;
  loadSharedProjection: (
    workspaceId: string,
    threadId: string,
  ) => Promise<SharedProjectionItem[]>;
  onProgress?: HistoryLoadingProgressListener;
};

function asString(value: unknown) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

export function createSharedHistoryLoader({
  workspaceId,
  loadSharedSession,
  loadSharedProjection,
  onProgress,
}: SharedHistoryLoaderOptions): HistoryLoader {
  const report: HistoryLoadingProgressListener = (progress) => {
    onProgress?.(normalizeHistoryLoadingProgress(progress));
  };

  return {
    engine: "codex",
    async load(threadId: string) {
      report(buildSharedHistoryPrepareProgress());
      report(buildSharedHistorySessionProgress("start"));
      // 记录加载前代次，用于检测加载期间是否有 in-flight persist 写入。
      const generationBeforeLoad = getPersistGeneration(
        workspaceId,
        threadId,
      );
      const response = await loadSharedSession(workspaceId, threadId);
      const persistedTarget = normalizePersistedExecutionTarget(
        response?.selectedTarget,
      );
      const resolvedPersistedTarget = isResolvedExecutionTarget(persistedTarget)
        ? persistedTarget
        : null;
      // 写序保护（fix-shared-session-target-race-and-merge T4）：
      // 1) 加载期间 generation 前进 → 跳过
      // 2) persist 仍 in-flight → 跳过（堵住代次未再递增窗口）
      // 3) persisted 不完整且 store 已有完整 target → 不降级
      const generationAfterLoad = getPersistGeneration(
        workspaceId,
        threadId,
      );
      const skipStaleHydrate =
        generationAfterLoad > generationBeforeLoad ||
        isSharedTargetPersistInFlight(workspaceId, threadId);
      if (skipStaleHydrate) {
        // 保留 store 中的乐观/最新值。
      } else if (resolvedPersistedTarget) {
        hydrateSharedTargetState(
          workspaceId,
          threadId,
          resolvedPersistedTarget,
        );
      } else {
        const existingState = getSharedTargetState(workspaceId, threadId);
        if (
          !existingState.selectedNextTarget ||
          !isResolvedExecutionTarget(existingState.selectedNextTarget)
        ) {
          hydrateSharedTargetState(workspaceId, threadId, null);
        }
      }
      const selectedEngine = asString(response?.selectedEngine).trim().toLowerCase();
      const normalizedSelectedEngine =
        resolvedPersistedTarget?.engine ??
        normalizeSharedSessionEngine(
          selectedEngine === "codex" || selectedEngine === "claude"
            ? selectedEngine
            : undefined,
        );
      const legacyItems = Array.isArray(response?.items)
        ? (response?.items as ConversationItem[])
        : [];
      report(buildSharedHistorySessionProgress("done", legacyItems.length));
      let items = legacyItems;
      if (isSharedProjectionDataSourceEnabled()) {
        report(buildSharedHistoryProjectionProgress("start"));
        try {
          const sharedProjection = await loadSharedProjection(
            workspaceId,
            threadId,
          );
          const agentRunId = findCanonicalAgentRunId(sharedProjection);
          if (agentRunId) {
            registerAgentConversationEvidence(
              workspaceId,
              threadId,
              agentRunId,
            );
          }
          const projectedItems =
            resolveSharedConversationItems(sharedProjection) ?? [];
          report(
            buildSharedHistoryProjectionProgress("done", projectedItems.length),
          );
          report(buildSharedHistoryMergeProgress("start"));
          items =
            legacyItems.length > 0
              ? mergeHistoryProjectionItems(legacyItems, projectedItems, {
                  workspaceId,
                  threadId,
                  engine: normalizedSelectedEngine,
                })
              : projectedItems;
          report(buildSharedHistoryMergeProgress("done", items.length));
        } catch (error) {
          console.warn(
            legacyItems.length > 0
              ? `[shared-projection] load failed; using V0 snapshot for ${threadId}`
              : `[shared-projection] load failed; no V0 snapshot available for ${threadId}`,
            error,
          );
          if (legacyItems.length === 0) {
            throw error;
          }
          report(buildSharedHistoryMergeProgress("done", legacyItems.length));
        }
      } else {
        report(buildSharedHistoryProjectionProgress("skip"));
        report(buildSharedHistoryMergeProgress("done", items.length));
      }
      report(buildSharedHistoryFinalizeProgress());
      return normalizeHistorySnapshot({
        engine: normalizedSelectedEngine,
        workspaceId,
        threadId,
        items,
        meta: {
          workspaceId,
          threadId,
          engine: normalizedSelectedEngine,
          activeTurnId: null,
          isThinking: false,
          heartbeatPulse: null,
          historyRestoredAtMs: Date.now(),
        },
      });
    },
  };
}
