/**
 * Canvas history restore progress for Shared (and reusable by other loaders).
 * percent is 0–100; UI may show determinate bar when present.
 */
export type HistoryLoadingPhaseId =
  | "prepare"
  | "session"
  | "projection"
  | "merge"
  | "finalize";

export type HistoryLoadingProgress = {
  phase: HistoryLoadingPhaseId;
  percent: number;
  /** i18n key under messages.* */
  titleKey: string;
  /** i18n key under messages.* */
  detailKey: string;
  detailParams?: Record<string, string | number>;
};

export type HistoryLoadingProgressListener = (
  progress: HistoryLoadingProgress,
) => void;

const clampPercent = (value: number) =>
  Math.max(0, Math.min(100, Math.round(value)));

export function buildSharedHistoryPrepareProgress(): HistoryLoadingProgress {
  return {
    phase: "prepare",
    percent: 8,
    titleKey: "restoringSharedHistory",
    detailKey: "restoringSharedHistoryPrepare",
  };
}

export function buildSharedHistorySessionProgress(
  step: "start" | "done",
  itemCount?: number,
): HistoryLoadingProgress {
  if (step === "start") {
    return {
      phase: "session",
      percent: 22,
      titleKey: "restoringSharedHistory",
      detailKey: "restoringSharedHistorySession",
    };
  }
  return {
    phase: "session",
    percent: 48,
    titleKey: "restoringSharedHistory",
    detailKey: "restoringSharedHistorySessionDone",
    detailParams: {
      count: typeof itemCount === "number" ? itemCount : 0,
    },
  };
}

export function buildSharedHistoryProjectionProgress(
  step: "start" | "skip" | "done",
  itemCount?: number,
): HistoryLoadingProgress {
  if (step === "start") {
    return {
      phase: "projection",
      percent: 58,
      titleKey: "restoringSharedHistory",
      detailKey: "restoringSharedHistoryProjection",
    };
  }
  if (step === "skip") {
    return {
      phase: "projection",
      percent: 72,
      titleKey: "restoringSharedHistory",
      detailKey: "restoringSharedHistoryProjectionSkip",
    };
  }
  return {
    phase: "projection",
    percent: 82,
    titleKey: "restoringSharedHistory",
    detailKey: "restoringSharedHistoryProjectionDone",
    detailParams: {
      count: typeof itemCount === "number" ? itemCount : 0,
    },
  };
}

export function buildSharedHistoryMergeProgress(
  step: "start" | "done",
  totalItems?: number,
): HistoryLoadingProgress {
  if (step === "start") {
    return {
      phase: "merge",
      percent: 90,
      titleKey: "restoringSharedHistory",
      detailKey: "restoringSharedHistoryMerge",
    };
  }
  return {
    phase: "merge",
    percent: 96,
    titleKey: "restoringSharedHistory",
    detailKey: "restoringSharedHistoryMergeDone",
    detailParams: {
      count: typeof totalItems === "number" ? totalItems : 0,
    },
  };
}

export function buildSharedHistoryFinalizeProgress(): HistoryLoadingProgress {
  return {
    phase: "finalize",
    percent: 100,
    titleKey: "restoringSharedHistory",
    detailKey: "restoringSharedHistoryFinalize",
  };
}

export function normalizeHistoryLoadingProgress(
  progress: HistoryLoadingProgress,
): HistoryLoadingProgress {
  return {
    ...progress,
    percent: clampPercent(progress.percent),
  };
}
