import { useCallback, useState } from "react";
import type { HistoryLoadingProgress } from "@/conversation-presentation/historyLoadingProgress";
import { normalizeHistoryLoadingProgress } from "@/conversation-presentation/historyLoadingProgress";

export type ThreadHistoryLoadState = true | "failed";

export function useThreadHistoryLoadingState() {
  const [historyLoadingByThreadId, setHistoryLoadingByThreadId] = useState<
    Record<string, ThreadHistoryLoadState>
  >({});
  const [historyLoadingProgressByThreadId, setHistoryLoadingProgressByThreadId] =
    useState<Record<string, HistoryLoadingProgress>>({});

  const clearThreadHistoryProgress = useCallback((threadId: string) => {
    setHistoryLoadingProgressByThreadId((current) => {
      if (!(threadId in current)) {
        return current;
      }
      const { [threadId]: _removed, ...rest } = current;
      return rest;
    });
  }, []);

  const setThreadHistoryLoading = useCallback(
    (threadId: string, isLoading: boolean) => {
      if (!threadId) {
        return;
      }
      setHistoryLoadingByThreadId((current) => {
        const alreadyLoading = current[threadId] === true;
        if (isLoading) {
          if (alreadyLoading) {
            return current;
          }
          return { ...current, [threadId]: true };
        }
        if (!alreadyLoading) {
          return current;
        }
        const { [threadId]: _removed, ...rest } = current;
        return rest;
      });
      if (!isLoading) {
        clearThreadHistoryProgress(threadId);
      }
    },
    [clearThreadHistoryProgress],
  );

  const setThreadHistoryLoadingProgress = useCallback(
    (threadId: string, progress: HistoryLoadingProgress | null) => {
      if (!threadId) {
        return;
      }
      if (!progress) {
        clearThreadHistoryProgress(threadId);
        return;
      }
      const next = normalizeHistoryLoadingProgress(progress);
      setHistoryLoadingProgressByThreadId((current) => {
        const previous = current[threadId];
        if (
          previous &&
          previous.phase === next.phase &&
          previous.percent === next.percent &&
          previous.titleKey === next.titleKey &&
          previous.detailKey === next.detailKey
        ) {
          return current;
        }
        return { ...current, [threadId]: next };
      });
    },
    [clearThreadHistoryProgress],
  );

  const setThreadHistoryRecoveryFailed = useCallback(
    (threadId: string, failed: boolean) => {
      if (!threadId) {
        return;
      }
      setHistoryLoadingByThreadId((current) => {
        if (failed) {
          if (current[threadId] === "failed") {
            return current;
          }
          return { ...current, [threadId]: "failed" };
        }
        if (current[threadId] !== "failed") {
          return current;
        }
        const { [threadId]: _removed, ...rest } = current;
        return rest;
      });
      if (failed) {
        clearThreadHistoryProgress(threadId);
      }
    },
    [clearThreadHistoryProgress],
  );

  return {
    historyLoadingByThreadId,
    historyLoadingProgressByThreadId,
    setThreadHistoryLoading,
    setThreadHistoryLoadingProgress,
    setThreadHistoryRecoveryFailed,
  };
}
