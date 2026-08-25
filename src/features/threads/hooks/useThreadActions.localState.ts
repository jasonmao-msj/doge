import { useCallback } from "react";
import type { Dispatch, MutableRefObject } from "react";
import type { DebugEntry, ThreadSummary } from "../../../types";
import { isPendingThreadId } from "./useThreadActions.helpers";
import { clearLiveAssistantText } from "@/conversation-presentation/liveAssistantTextChannel";
import type { ArchivedSessionMapResult } from "./useThreadActionsSessionCatalog";
import type { ThreadAction, ThreadState } from "./useThreadsReducer";

export function applySessionArchiveState(
  summaries: ThreadSummary[],
  archivedEvidence: ArchivedSessionMapResult | null,
): ThreadSummary[] {
  const isVisibleSessionSummary = (summary: ThreadSummary) =>
    !isPendingThreadId(summary.id) &&
    (!summary.archivedAt || summary.archivedAt <= 0);
  if (!archivedEvidence) {
    return summaries.filter(isVisibleSessionSummary);
  }
  const { archivedAtBySessionId, isComplete } = archivedEvidence;
  const nextSummaries = summaries.map((summary) => {
    const archivedAt = archivedAtBySessionId.get(summary.id) ?? 0;
    if (archivedAt > 0) {
      return { ...summary, archivedAt };
    }
    if ((summary.archivedAt ?? 0) > 0) {
      return summary;
    }
    return isComplete ? { ...summary, archivedAt: undefined } : summary;
  });
  return nextSummaries.filter(isVisibleSessionSummary);
}

export function useReconcileMissingClaudeThread({
  activeThreadIdByWorkspace,
  dispatch,
  itemsByThread,
  loadedThreadsRef,
  onDebug,
  removeThreadFromCachedSummaries,
}: {
  activeThreadIdByWorkspace: ThreadState["activeThreadIdByWorkspace"];
  dispatch: Dispatch<ThreadAction>;
  itemsByThread: ThreadState["itemsByThread"];
  loadedThreadsRef: MutableRefObject<Record<string, boolean>>;
  onDebug?: (entry: DebugEntry) => void;
  removeThreadFromCachedSummaries: (workspaceId: string, threadId: string) => void;
}) {
  return useCallback(
    (workspaceId: string, threadId: string) => {
      loadedThreadsRef.current[threadId] = false;
      dispatch({
        type: "clearUserInputRequestsForThread",
        workspaceId,
        threadId,
      });
      const isSelectedThread =
        activeThreadIdByWorkspace[workspaceId] === threadId;
      const hasReadableItems = (itemsByThread[threadId]?.length ?? 0) > 0;
      if (isSelectedThread && hasReadableItems) {
        onDebug?.({
          id: `${Date.now()}-claude-history-preserve-readable-surface`,
          timestamp: Date.now(),
          source: "client",
          label: "thread/claude history preserve readable surface",
          payload: {
            workspaceId,
            threadId,
            reason: "selected-readable-surface",
          },
        });
        return true;
      }
      removeThreadFromCachedSummaries(workspaceId, threadId);
      clearLiveAssistantText(threadId);
      dispatch({ type: "removeThread", workspaceId, threadId });
      return false;
    },
    [
      activeThreadIdByWorkspace,
      dispatch,
      itemsByThread,
      loadedThreadsRef,
      onDebug,
      removeThreadFromCachedSummaries,
    ],
  );
}
