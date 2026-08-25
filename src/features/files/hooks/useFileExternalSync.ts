import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  subscribeDetachedExternalFileChangeBatch,
  subscribeDetachedExternalFileChanges,
} from "../../../services/events";
import { isAppServerEventBatchConsumerEnabled } from "@/conversation-presentation/realtimePerfFlags";
import { readWorkspaceFile } from "../../../services/tauri";
import { pushErrorToast } from "../../../services/toasts";
import {
  reduceExternalChangeSyncState,
  type ExternalChangeSyncState,
} from "../externalChangeStateMachine";
import { normalizeComparablePath } from "../../../utils/workspacePaths";
import {
  DEFAULT_FILE_RENDER_PRESSURE,
  hasForegroundFileRenderPressure,
  type FileRenderPressure,
} from "../types/fileRenderPressure";

const EXTERNAL_CHANGE_NOTICE_MS = 3_200;
const EXTERNAL_CHANGE_ERROR_TOAST_THRESHOLD = 3;
const EXTERNAL_CHANGE_ERROR_TOAST_COOLDOWN_MS = 30_000;
const MISSING_FILE_ERROR_PATTERN =
  /no such file or directory|os error 2|enoent|cannot find the file|cannot find the path|path not found|the system cannot find the file specified|the system cannot find the path specified|系统找不到指定的路径/i;
const WINDOWS_PATH_NOT_FOUND_ERROR_PATTERN =
  /os error 3/i;
const WINDOWS_PATH_NOT_FOUND_TEXT_PATTERN =
  /cannot find the path|path not found|the system cannot find the path specified|系统找不到指定的路径/i;

type DetachedExternalFileChangeInput = {
  workspaceId: string;
  normalizedPath: string;
  eventKind: string;
  source: string;
};

export function coalesceDetachedExternalFileChangeBatch<
  T extends DetachedExternalFileChangeInput,
>(batch: readonly T[], caseInsensitivePathCompare: boolean): T[] {
  const latestByKey = new Map<string, T>();
  for (const event of batch) {
    const comparablePath = normalizeComparablePath(
      event.normalizedPath,
      caseInsensitivePathCompare,
    );
    latestByKey.set(`${event.workspaceId}\0${comparablePath}`, event);
  }
  return Array.from(latestByKey.values());
}

export type ExternalChangeConflict = {
  diskContent: string;
  diskTruncated: boolean;
  updateCount: number;
  detectedAt: number;
};

export type ExternalChangePendingRefresh = {
  diskContent: string;
  diskTruncated: boolean;
  updateCount: number;
  detectedAt: number;
  expectedSnapshotVersion: number;
};

type UseFileExternalSyncArgs = {
  filePath: string;
  workspaceId: string;
  workspaceRelativeFilePath: string;
  fileReadTargetDomain: "workspace" | "external-spec" | "external-absolute" | "invalid";
  externalChangeMonitoringEnabled: boolean;
  externalChangeTransportMode: "watcher" | "polling";
  externalChangePollIntervalMs: number;
  externalChangeApplyMode?: "auto" | "manual";
  externalChangeAutoApplyDebounceMs?: number;
  isBinary: boolean;
  isDirty: boolean;
  isLoading: boolean;
  caseInsensitivePathCompare: boolean;
  replaceDocumentSnapshot: (content: string, truncated: boolean) => void;
  previewSnapshotVersion: number;
  fileRenderPressure?: FileRenderPressure;
  savedContentRef: MutableRefObject<string>;
  latestIsDirtyRef: MutableRefObject<boolean>;
  externalDiskSnapshotRef: MutableRefObject<{ content: string; truncated: boolean } | null>;
  autoSyncedMessage: string;
};

function isMissingFileErrorMessage(message: string) {
  return (
    MISSING_FILE_ERROR_PATTERN.test(message) ||
    (
      WINDOWS_PATH_NOT_FOUND_ERROR_PATTERN.test(message) &&
      WINDOWS_PATH_NOT_FOUND_TEXT_PATTERN.test(message)
    )
  );
}

function errorMessageFromUnknown(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }
  }
  return fallback;
}

export function useFileExternalSync({
  filePath,
  workspaceId,
  workspaceRelativeFilePath,
  fileReadTargetDomain,
  externalChangeMonitoringEnabled,
  externalChangeTransportMode,
  externalChangePollIntervalMs,
  externalChangeApplyMode = "auto",
  externalChangeAutoApplyDebounceMs = 0,
  isBinary,
  isDirty,
  isLoading,
  caseInsensitivePathCompare,
  replaceDocumentSnapshot,
  previewSnapshotVersion,
  fileRenderPressure = DEFAULT_FILE_RENDER_PRESSURE,
  savedContentRef,
  latestIsDirtyRef,
  externalDiskSnapshotRef,
  autoSyncedMessage,
}: UseFileExternalSyncArgs) {
  const [externalChangeConflict, setExternalChangeConflict] =
    useState<ExternalChangeConflict | null>(null);
  const [externalPendingRefresh, setExternalPendingRefresh] =
    useState<ExternalChangePendingRefresh | null>(null);
  const [externalCompareOpen, setExternalCompareOpen] = useState(false);
  const [externalAutoSyncAt, setExternalAutoSyncAt] = useState<number | null>(null);
  const [externalChangeSyncState, setExternalChangeSyncState] =
    useState<ExternalChangeSyncState>("in-sync");
  const externalPollInFlightRef = useRef(false);
  const externalPollErrorCountRef = useRef(0);
  const externalPollLastToastAtRef = useRef(0);
  const watcherRefreshQueuedRef = useRef(false);
  const fileVersionRef = useRef(0);
  const autoApplyTimeoutRef = useRef<number | null>(null);
  const latestPreviewSnapshotVersionRef = useRef(previewSnapshotVersion);

  useEffect(() => {
    latestPreviewSnapshotVersionRef.current = previewSnapshotVersion;
  }, [previewSnapshotVersion]);

  const clearAutoApplyTimeout = useCallback(() => {
    if (autoApplyTimeoutRef.current === null) {
      return;
    }
    window.clearTimeout(autoApplyTimeoutRef.current);
    autoApplyTimeoutRef.current = null;
  }, []);

  useEffect(() => clearAutoApplyTimeout, [clearAutoApplyTimeout]);

  useEffect(() => {
    fileVersionRef.current += 1;
    externalPollInFlightRef.current = false;
    watcherRefreshQueuedRef.current = false;
    externalPollErrorCountRef.current = 0;
    clearAutoApplyTimeout();
    setExternalChangeConflict(null);
    setExternalPendingRefresh(null);
    setExternalCompareOpen(false);
    setExternalAutoSyncAt(null);
    setExternalChangeSyncState((current) =>
      reduceExternalChangeSyncState(current, { type: "file-loaded" }),
    );
  }, [clearAutoApplyTimeout, filePath]);

  useEffect(() => {
    if (!externalAutoSyncAt) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setExternalAutoSyncAt(null);
      setExternalChangeSyncState((current) =>
        reduceExternalChangeSyncState(current, { type: "notice-cleared" }),
      );
    }, EXTERNAL_CHANGE_NOTICE_MS);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [externalAutoSyncAt]);

  const applyCleanExternalDiskSnapshot = useCallback(
    (
      nextContent: string,
      nextTruncated: boolean,
      source: "polling" | "watcher" | string,
      eventKind: string,
    ) => {
      replaceDocumentSnapshot(nextContent, nextTruncated);
      savedContentRef.current = nextContent;
      setExternalCompareOpen(false);
      setExternalChangeConflict(null);
      setExternalPendingRefresh(null);
      setExternalAutoSyncAt(Date.now());
      setExternalChangeSyncState((current) =>
        reduceExternalChangeSyncState(
          reduceExternalChangeSyncState(current, { type: "external-change-detected-clean" }),
          { type: "refresh-applied" },
        ),
      );
      if (source === "polling" && eventKind === "watcher-fallback") {
        pushErrorToast({
          title: "External file monitor fallback",
          message: autoSyncedMessage,
        });
      }
    },
    [autoSyncedMessage, replaceDocumentSnapshot, savedContentRef],
  );

  const promoteExternalDiskSnapshotToConflict = useCallback(
    (nextContent: string, nextTruncated: boolean, updateCountHint?: number) => {
      clearAutoApplyTimeout();
      setExternalPendingRefresh(null);
      setExternalChangeSyncState((current) =>
        reduceExternalChangeSyncState(current, { type: "external-change-detected-dirty" }),
      );
      setExternalChangeConflict((current) => {
        if (
          current &&
          current.diskContent === nextContent &&
          current.diskTruncated === nextTruncated
        ) {
          return current;
        }
        return {
          diskContent: nextContent,
          diskTruncated: nextTruncated,
          updateCount: Math.min(99, Math.max(updateCountHint ?? 0, (current?.updateCount ?? 0) + 1)),
          detectedAt: Date.now(),
        };
      });
    },
    [clearAutoApplyTimeout],
  );

  const scheduleCleanExternalDiskSnapshot = useCallback(
    (
      nextContent: string,
      nextTruncated: boolean,
      source: "polling" | "watcher" | string,
      eventKind: string,
    ) => {
      if (externalChangeAutoApplyDebounceMs <= 0) {
        applyCleanExternalDiskSnapshot(nextContent, nextTruncated, source, eventKind);
        return;
      }
      setExternalChangeSyncState((current) =>
        reduceExternalChangeSyncState(current, { type: "external-change-detected-clean" }),
      );
      clearAutoApplyTimeout();
      const expectedSnapshotVersion = latestPreviewSnapshotVersionRef.current;
      autoApplyTimeoutRef.current = window.setTimeout(() => {
        autoApplyTimeoutRef.current = null;
        if (latestIsDirtyRef.current) {
          promoteExternalDiskSnapshotToConflict(nextContent, nextTruncated);
          return;
        }
        if (expectedSnapshotVersion !== latestPreviewSnapshotVersionRef.current) {
          setExternalAutoSyncAt(null);
          setExternalPendingRefresh((current) => {
            if (
              current &&
              current.diskContent === nextContent &&
              current.diskTruncated === nextTruncated
            ) {
              return {
                ...current,
                expectedSnapshotVersion: latestPreviewSnapshotVersionRef.current,
              };
            }
            return {
              diskContent: nextContent,
              diskTruncated: nextTruncated,
              updateCount: Math.min(99, (current?.updateCount ?? 0) + 1),
              detectedAt: Date.now(),
              expectedSnapshotVersion: latestPreviewSnapshotVersionRef.current,
            };
          });
          return;
        }
        applyCleanExternalDiskSnapshot(nextContent, nextTruncated, source, eventKind);
      }, externalChangeAutoApplyDebounceMs);
    },
    [
      applyCleanExternalDiskSnapshot,
      clearAutoApplyTimeout,
      externalChangeAutoApplyDebounceMs,
      latestIsDirtyRef,
      promoteExternalDiskSnapshotToConflict,
    ],
  );

  const applyExternalDiskSnapshot = useCallback(
    (
      nextContent: string,
      nextTruncated: boolean,
      source: "polling" | "watcher" | string,
      eventKind: string,
    ) => {
      const previousDiskSnapshot = externalDiskSnapshotRef.current;
      const isSameAsKnownDisk =
        previousDiskSnapshot?.content === nextContent &&
        previousDiskSnapshot?.truncated === nextTruncated;
      if (isSameAsKnownDisk) {
        return;
      }

      externalDiskSnapshotRef.current = {
        content: nextContent,
        truncated: nextTruncated,
      };
      if (latestIsDirtyRef.current) {
        promoteExternalDiskSnapshotToConflict(nextContent, nextTruncated);
        return;
      }

      const shouldKeepPendingRefresh =
        externalChangeApplyMode === "manual" ||
        hasForegroundFileRenderPressure(fileRenderPressure);
      if (shouldKeepPendingRefresh) {
        clearAutoApplyTimeout();
        setExternalAutoSyncAt(null);
        setExternalChangeSyncState((current) =>
          reduceExternalChangeSyncState(current, { type: "external-change-detected-clean" }),
        );
        setExternalPendingRefresh((current) => {
          if (
            current &&
            current.diskContent === nextContent &&
            current.diskTruncated === nextTruncated
          ) {
            return current;
          }
          return {
            diskContent: nextContent,
            diskTruncated: nextTruncated,
            updateCount: Math.min(99, (current?.updateCount ?? 0) + 1),
            detectedAt: Date.now(),
            expectedSnapshotVersion: latestPreviewSnapshotVersionRef.current,
          };
        });
        return;
      }
      scheduleCleanExternalDiskSnapshot(nextContent, nextTruncated, source, eventKind);
    },
    [
      clearAutoApplyTimeout,
      externalDiskSnapshotRef,
      externalChangeApplyMode,
      fileRenderPressure,
      latestIsDirtyRef,
      promoteExternalDiskSnapshotToConflict,
      scheduleCleanExternalDiskSnapshot,
    ],
  );

  useEffect(() => {
    if (!isDirty || !externalPendingRefresh) {
      return;
    }
    promoteExternalDiskSnapshotToConflict(
      externalPendingRefresh.diskContent,
      externalPendingRefresh.diskTruncated,
      externalPendingRefresh.updateCount,
    );
  }, [externalPendingRefresh, isDirty, promoteExternalDiskSnapshotToConflict]);

  const refreshFromDisk = useCallback(
    async (source: "polling" | "watcher" | string, eventKind: string) => {
      const requestedFileVersion = fileVersionRef.current;
      if (externalPollInFlightRef.current) {
        watcherRefreshQueuedRef.current = true;
        return;
      }
      externalPollInFlightRef.current = true;
      try {
        const response = await readWorkspaceFile(workspaceId, workspaceRelativeFilePath);
        if (requestedFileVersion !== fileVersionRef.current) {
          return;
        }
        externalPollErrorCountRef.current = 0;
        const nextContent = response.content ?? "";
        const nextTruncated = Boolean(response.truncated);
        applyExternalDiskSnapshot(nextContent, nextTruncated, source, eventKind);
      } catch (pollError) {
        if (requestedFileVersion !== fileVersionRef.current) {
          return;
        }
        const message = errorMessageFromUnknown(
          pollError,
          "Unable to refresh file from disk.",
        );
        const isMissingFileError = isMissingFileErrorMessage(message);
        const isTransientFsError =
          /permission denied|resource busy|sharing violation|used by another process/i.test(
            message,
          );
        if (isMissingFileError) {
          externalPollErrorCountRef.current = 0;
          return;
        }
        if (!isTransientFsError) {
          externalPollErrorCountRef.current += 1;
          const now = Date.now();
          const shouldNotify =
            externalPollErrorCountRef.current >= EXTERNAL_CHANGE_ERROR_TOAST_THRESHOLD &&
            now - externalPollLastToastAtRef.current >=
              EXTERNAL_CHANGE_ERROR_TOAST_COOLDOWN_MS;
          if (shouldNotify) {
            externalPollLastToastAtRef.current = now;
            externalPollErrorCountRef.current = 0;
            pushErrorToast({
              title: "External file monitor is unavailable",
              message,
            });
          }
        }
      } finally {
        const shouldReleasePollingSlot = requestedFileVersion === fileVersionRef.current;
        if (shouldReleasePollingSlot) {
          externalPollInFlightRef.current = false;
          if (watcherRefreshQueuedRef.current) {
            watcherRefreshQueuedRef.current = false;
            void refreshFromDisk(source, eventKind);
          }
        }
      }
    },
    [applyExternalDiskSnapshot, workspaceId, workspaceRelativeFilePath],
  );

  useEffect(() => {
    if (
      !externalChangeMonitoringEnabled ||
      externalChangeTransportMode !== "polling" ||
      fileReadTargetDomain !== "workspace" ||
      isBinary ||
      isLoading
    ) {
      return;
    }

    let cancelled = false;
    let timeoutId = 0;
    externalPollErrorCountRef.current = 0;

    const scheduleNext = () => {
      if (cancelled) {
        return;
      }
      timeoutId = window.setTimeout(() => {
        void refreshFromDisk("polling", "polling-tick").finally(() => {
          scheduleNext();
        });
      }, externalChangePollIntervalMs);
    };

    // visibility 门控：窗口隐藏时暂停兜底轮询，恢复可见时先补一跳再恢复周期，
    // 语义与 setVisibilityGatedInterval 一致，但保持递归 setTimeout 的
    // "in-flight 完成后才排下一跳"结构。
    const handleVisibilityChange = () => {
      if (cancelled) {
        return;
      }
      window.clearTimeout(timeoutId);
      if (document.visibilityState === "hidden") {
        return;
      }
      void refreshFromDisk("polling", "polling-tick").finally(() => {
        scheduleNext();
      });
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    if (document.visibilityState !== "hidden") {
      scheduleNext();
    }

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    externalChangeMonitoringEnabled,
    externalChangePollIntervalMs,
    externalChangeTransportMode,
    fileReadTargetDomain,
    isBinary,
    isLoading,
    refreshFromDisk,
  ]);

  useEffect(() => {
    if (
      !externalChangeMonitoringEnabled ||
      externalChangeTransportMode !== "watcher" ||
      fileReadTargetDomain !== "workspace" ||
      isBinary ||
      isLoading
    ) {
      return;
    }

    const handleEvent = (event: { workspaceId: string; normalizedPath: string; eventKind: string; source: string }) => {
      if (event.workspaceId !== workspaceId) {
        return;
      }
      if (event.eventKind === "watcher-fallback") {
        return;
      }
      const samePath =
        normalizeComparablePath(event.normalizedPath, caseInsensitivePathCompare) ===
        normalizeComparablePath(workspaceRelativeFilePath, caseInsensitivePathCompare);
      if (!samePath) {
        return;
      }
      void refreshFromDisk(event.source, event.eventKind || "watcher-event");
    };

    // Per design §2.2 and parent change Step 4 tasks: subscribe to ONE
    // channel at a time. The runtime flag picks the batch channel as the
    // preferred path and falls back to the single channel only when the
    // flag is off. Double-subscribing would cause duplicate refresh jobs
    // when the runtime config flips to "both" in the future.
    if (isAppServerEventBatchConsumerEnabled()) {
      return subscribeDetachedExternalFileChangeBatch((batch) => {
        const coalescedBatch = coalesceDetachedExternalFileChangeBatch(
          batch,
          caseInsensitivePathCompare,
        );
        for (const event of coalescedBatch) {
          handleEvent(event);
        }
      });
    }
    return subscribeDetachedExternalFileChanges(handleEvent);
  }, [
    caseInsensitivePathCompare,
    externalChangeMonitoringEnabled,
    externalChangeTransportMode,
    fileReadTargetDomain,
    isBinary,
    isLoading,
    refreshFromDisk,
    workspaceId,
    workspaceRelativeFilePath,
  ]);

  const handleExternalReloadFromDisk = useCallback(() => {
    if (!externalChangeConflict) {
      return;
    }
    replaceDocumentSnapshot(
      externalChangeConflict.diskContent,
      externalChangeConflict.diskTruncated,
    );
    savedContentRef.current = externalChangeConflict.diskContent;
    externalDiskSnapshotRef.current = {
      content: externalChangeConflict.diskContent,
      truncated: externalChangeConflict.diskTruncated,
    };
    setExternalCompareOpen(false);
    setExternalChangeConflict(null);
    setExternalAutoSyncAt(Date.now());
    setExternalChangeSyncState((current) =>
      reduceExternalChangeSyncState(current, { type: "conflict-reload" }),
    );
  }, [externalChangeConflict, externalDiskSnapshotRef, replaceDocumentSnapshot, savedContentRef]);

  const handleExternalApplyPendingRefresh = useCallback(() => {
    if (!externalPendingRefresh) {
      return;
    }
    if (latestIsDirtyRef.current) {
      promoteExternalDiskSnapshotToConflict(
        externalPendingRefresh.diskContent,
        externalPendingRefresh.diskTruncated,
        externalPendingRefresh.updateCount,
      );
      return;
    }
    if (
      externalPendingRefresh.expectedSnapshotVersion !==
      latestPreviewSnapshotVersionRef.current
    ) {
      clearAutoApplyTimeout();
      if (savedContentRef.current === externalPendingRefresh.diskContent) {
        setExternalCompareOpen(false);
        setExternalPendingRefresh(null);
        setExternalChangeSyncState("in-sync");
        return;
      }
      promoteExternalDiskSnapshotToConflict(
        externalPendingRefresh.diskContent,
        externalPendingRefresh.diskTruncated,
        externalPendingRefresh.updateCount,
      );
      return;
    }
    clearAutoApplyTimeout();
    replaceDocumentSnapshot(
      externalPendingRefresh.diskContent,
      externalPendingRefresh.diskTruncated,
    );
    savedContentRef.current = externalPendingRefresh.diskContent;
    externalDiskSnapshotRef.current = {
      content: externalPendingRefresh.diskContent,
      truncated: externalPendingRefresh.diskTruncated,
    };
    setExternalCompareOpen(false);
    setExternalPendingRefresh(null);
    setExternalAutoSyncAt(Date.now());
    setExternalChangeSyncState((current) =>
      reduceExternalChangeSyncState(
        reduceExternalChangeSyncState(current, { type: "external-change-detected-clean" }),
        { type: "refresh-applied" },
      ),
    );
  }, [
    clearAutoApplyTimeout,
    externalDiskSnapshotRef,
    externalPendingRefresh,
    latestIsDirtyRef,
    promoteExternalDiskSnapshotToConflict,
    replaceDocumentSnapshot,
    savedContentRef,
  ]);

  const handleExternalKeepLocal = useCallback(() => {
    clearAutoApplyTimeout();
    setExternalCompareOpen(false);
    setExternalChangeConflict(null);
    setExternalPendingRefresh(null);
    setExternalChangeSyncState("in-sync");
  }, [clearAutoApplyTimeout]);

  const handleExternalToggleCompare = useCallback(() => {
    setExternalCompareOpen((current) => !current);
  }, []);

  return {
    externalChangeConflict,
    externalPendingRefresh,
    externalCompareOpen,
    externalAutoSyncAt,
    externalChangeSyncState,
    handleExternalReloadFromDisk,
    handleExternalApplyPendingRefresh,
    handleExternalKeepLocal,
    handleExternalToggleCompare,
    setExternalChangeSyncState,
    setExternalChangeConflict,
    setExternalPendingRefresh,
    setExternalCompareOpen,
    setExternalAutoSyncAt,
  };
}
