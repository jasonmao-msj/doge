import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DebugEntry, WorkspaceInfo } from "../../../types";
import { getWorkspaceDirectoryChildren, getWorkspaceFiles } from "../../../services/tauri";
import type {
  WorkspaceFileListingBudgetMetadata,
  WorkspaceDirectoryEntry,
  WorkspaceFilesResponse,
  WorkspaceFileScanState,
} from "../../../services/tauri";
import { appendWorkspaceFileListingBudgetDiagnostic } from "../../../services/rendererDiagnostics";
import {
  upsertSharedWorkspaceFileIndex,
} from "../utils/sharedWorkspaceFileIndex";

const WORKSPACE_FILES_DEBUG_KEY = "doge.debug.workspace-files";
const WORKSPACE_FILES_SLOW_REQUEST_MS = 800;
const INITIAL_RETRY_DELAY_MS = 1_500;
const MAX_INITIAL_RETRY_ATTEMPTS = 1;
const MAX_ROOT_SNAPSHOT_CACHE_ENTRIES = 12;

function isWorkspaceFilesDebugEnabled() {
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(WORKSPACE_FILES_DEBUG_KEY) === "1";
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isRootDirectorySentinelCompatibilityError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("path cannot be empty") ||
    normalized.includes("directory path cannot be empty") ||
    normalized.includes("invalid directory path")
  );
}

function normalizeDirectoryEntries(entries: unknown): WorkspaceDirectoryEntry[] {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries.filter((entry): entry is WorkspaceDirectoryEntry => {
    if (!entry || typeof entry !== "object") {
      return false;
    }
    const candidate = entry as Partial<WorkspaceDirectoryEntry>;
    return typeof candidate.path === "string" && typeof candidate.child_state === "string";
  });
}

type NormalizedWorkspaceFilesSnapshot = {
  files: string[];
  directories: string[];
  gitignoredFiles: string[];
  gitignoredDirectories: string[];
  scanState: WorkspaceFileScanState;
  limitHit: boolean;
  directoryMetadata: WorkspaceDirectoryEntry[];
  listingBudget: WorkspaceFileListingBudgetMetadata | null;
  sourceVersion: string | null;
  payloadBytes: number | null;
  cacheState: string;
};

function normalizeWorkspaceFilesSnapshot(
  response: WorkspaceFilesResponse,
): NormalizedWorkspaceFilesSnapshot {
  const listingBudget = response.listingBudget ?? null;
  return {
    files: Array.isArray(response.files) ? response.files : [],
    directories: Array.isArray(response.directories) ? response.directories : [],
    gitignoredFiles: Array.isArray(response.gitignored_files) ? response.gitignored_files : [],
    gitignoredDirectories: Array.isArray(response.gitignored_directories)
      ? response.gitignored_directories
      : [],
    scanState: response.scan_state === "partial" ? "partial" : "complete",
    limitHit: Boolean(response.limit_hit),
    directoryMetadata: normalizeDirectoryEntries(response.directory_entries),
    listingBudget,
    sourceVersion: response.sourceVersion ?? listingBudget?.sourceVersion ?? null,
    payloadBytes:
      typeof listingBudget?.payloadBytes === "number"
        ? listingBudget.payloadBytes
        : response.payloadBudget?.estimatedBytes ?? null,
    cacheState: listingBudget?.cacheState ?? response.payloadBudget?.cacheState ?? "unsupported",
  };
}

function isWorkspaceRootChildPath(path: string) {
  return path.length > 0 && !path.includes("/") && !path.includes("\\");
}

function toRootOnlyWorkspaceFilesSnapshot(
  snapshot: NormalizedWorkspaceFilesSnapshot,
): NormalizedWorkspaceFilesSnapshot {
  const rootDirectoryMetadataByPath = new Map(
    snapshot.directoryMetadata
      .filter((entry) => isWorkspaceRootChildPath(entry.path))
      .map((entry) => [entry.path, entry]),
  );
  const directories = snapshot.directories.filter(isWorkspaceRootChildPath);

  return {
    files: snapshot.files.filter(isWorkspaceRootChildPath),
    directories,
    gitignoredFiles: snapshot.gitignoredFiles.filter(isWorkspaceRootChildPath),
    gitignoredDirectories: snapshot.gitignoredDirectories.filter(isWorkspaceRootChildPath),
    scanState: snapshot.scanState,
    limitHit: snapshot.limitHit,
    directoryMetadata: directories.map(
      (path) => rootDirectoryMetadataByPath.get(path) ?? { path, child_state: "unknown" },
    ),
    listingBudget: snapshot.listingBudget,
    sourceVersion: snapshot.sourceVersion,
    payloadBytes: snapshot.payloadBytes,
    cacheState: snapshot.cacheState,
  };
}

function createRootSnapshotCacheKey(workspace: WorkspaceInfo) {
  return `${workspace.id}:${workspace.path}`;
}

type UseWorkspaceFilesOptions = {
  activeWorkspace: WorkspaceInfo | null;
  onDebug?: (entry: DebugEntry) => void;
  initialLoadEnabled?: boolean;
  pollingEnabled?: boolean;
};

export function useWorkspaceFiles({
  activeWorkspace,
  onDebug,
  initialLoadEnabled = true,
  pollingEnabled = true,
}: UseWorkspaceFilesOptions) {
  const [files, setFiles] = useState<string[]>([]);
  const [directories, setDirectories] = useState<string[]>([]);
  const [gitignoredFiles, setGitignoredFiles] = useState<Set<string>>(new Set());
  const [gitignoredDirectories, setGitignoredDirectories] = useState<Set<string>>(new Set());
  const [scanState, setScanState] = useState<WorkspaceFileScanState>("complete");
  const [limitHit, setLimitHit] = useState(false);
  const [directoryMetadata, setDirectoryMetadata] = useState<WorkspaceDirectoryEntry[]>([]);
  const [sourceVersion, setSourceVersion] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(() =>
    Boolean(activeWorkspace?.id && initialLoadEnabled),
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const hasLoadedWorkspaceId = useRef<string | null>(null);
  const latestWorkspaceIdRef = useRef<string | null>(null);
  const isMountedRef = useRef(false);
  const inFlightWorkspaceIds = useRef<Set<string>>(new Set());
  const rootSnapshotCache = useRef<Map<string, NormalizedWorkspaceFilesSnapshot>>(new Map());
  const consecutiveFailures = useRef(0);
  const retryAttemptsByWorkspaceId = useRef<Map<string, number>>(new Map());
  const initialRetryTimer = useRef<number | null>(null);
  const refreshFilesRef = useRef<
    ((reason?: "initial" | "retry" | "poll" | "manual") => Promise<void>) | null
  >(null);

  const BASE_REFRESH_INTERVAL_MS = 30_000;
  const MAX_REFRESH_INTERVAL_MS = 180_000;
  const workspaceId = activeWorkspace?.id ?? null;
  const workspaceCacheKey = activeWorkspace ? createRootSnapshotCacheKey(activeWorkspace) : null;
  const isConnected = Boolean(activeWorkspace?.connected);
  latestWorkspaceIdRef.current = workspaceId;

  const clearInitialRetryTimer = useCallback(() => {
    if (initialRetryTimer.current !== null) {
      window.clearTimeout(initialRetryTimer.current);
      initialRetryTimer.current = null;
    }
  }, []);

  const scheduleInitialRetry = useCallback(
    (failedWorkspaceId: string) => {
      clearInitialRetryTimer();
      const attempts = retryAttemptsByWorkspaceId.current.get(failedWorkspaceId) ?? 0;
      if (attempts >= MAX_INITIAL_RETRY_ATTEMPTS) {
        return;
      }
      retryAttemptsByWorkspaceId.current.set(failedWorkspaceId, attempts + 1);
      initialRetryTimer.current = window.setTimeout(() => {
        initialRetryTimer.current = null;
        void refreshFilesRef.current?.("retry");
      }, INITIAL_RETRY_DELAY_MS);
    },
    [clearInitialRetryTimer],
  );

  const rememberWorkspaceFilesSnapshot = useCallback(
    (requestWorkspaceCacheKey: string, snapshot: NormalizedWorkspaceFilesSnapshot) => {
      rootSnapshotCache.current.delete(requestWorkspaceCacheKey);
      rootSnapshotCache.current.set(requestWorkspaceCacheKey, snapshot);
      while (rootSnapshotCache.current.size > MAX_ROOT_SNAPSHOT_CACHE_ENTRIES) {
        const oldestCacheKey = rootSnapshotCache.current.keys().next().value;
        if (!oldestCacheKey) {
          break;
        }
        rootSnapshotCache.current.delete(oldestCacheKey);
      }
    },
    [],
  );

  const applyWorkspaceFilesSnapshot = useCallback(
    (requestWorkspaceId: string, snapshot: NormalizedWorkspaceFilesSnapshot) => {
      if (!isMountedRef.current || requestWorkspaceId !== latestWorkspaceIdRef.current) {
        return false;
      }
      setFiles(snapshot.files);
      setDirectories(snapshot.directories);
      setGitignoredFiles(new Set(snapshot.gitignoredFiles));
      setGitignoredDirectories(new Set(snapshot.gitignoredDirectories));
      setScanState(snapshot.scanState);
      setLimitHit(snapshot.limitHit);
      setDirectoryMetadata(snapshot.directoryMetadata);
      setSourceVersion(snapshot.sourceVersion);
      upsertSharedWorkspaceFileIndex({
        workspaceId: requestWorkspaceId,
        sourceVersion: snapshot.sourceVersion,
        files: snapshot.files,
        directories: snapshot.directories,
        partial: snapshot.scanState === "partial" || snapshot.limitHit,
      });
      setLoadError(null);
      hasLoadedWorkspaceId.current = requestWorkspaceId;
      consecutiveFailures.current = 0;
      retryAttemptsByWorkspaceId.current.delete(requestWorkspaceId);
      clearInitialRetryTimer();
      return true;
    },
    [clearInitialRetryTimer],
  );

  const refreshFiles = useCallback(async (
    reason: "initial" | "retry" | "poll" | "manual" = "manual",
  ) => {
    if (!workspaceId || !workspaceCacheKey || !isConnected) {
      return;
    }
    if (inFlightWorkspaceIds.current.has(workspaceId)) {
      return;
    }
    inFlightWorkspaceIds.current.add(workspaceId);
    const requestWorkspaceId = workspaceId;
    const isFirstLoadForWorkspace = hasLoadedWorkspaceId.current !== workspaceId;
    if (reason === "manual" || (reason !== "poll" && isFirstLoadForWorkspace)) {
      setIsLoading(true);
    }
    const startedAt = Date.now();
    onDebug?.({
      id: `${startedAt}-client-files-list`,
      timestamp: startedAt,
      source: "client",
      label: "files/list",
      payload: { workspaceId: requestWorkspaceId, reason },
    });
    try {
      const response = await getWorkspaceDirectoryChildren(requestWorkspaceId, "", {
        forceRefresh: reason === "manual",
      });
      const elapsedMs = Date.now() - startedAt;
      const snapshot = normalizeWorkspaceFilesSnapshot(response);
      appendWorkspaceFileListingBudgetDiagnostic({
        surfaceId: "initial-listing",
        workspaceId: requestWorkspaceId,
        durationMs: elapsedMs,
        returnedEntries:
          snapshot.listingBudget?.returnedEntries ??
          snapshot.files.length + snapshot.directories.length + snapshot.directoryMetadata.length,
        payloadBytes: snapshot.payloadBytes,
        cacheState: snapshot.cacheState,
        scanState: snapshot.scanState,
        partial: snapshot.scanState === "partial" || snapshot.limitHit,
        limitHit: snapshot.limitHit,
        sourceVersion: snapshot.sourceVersion,
        evidenceClass: snapshot.sourceVersion ? "measured" : "unsupported",
      });
      if (
        import.meta.env.DEV &&
        (elapsedMs >= WORKSPACE_FILES_SLOW_REQUEST_MS ||
        isWorkspaceFilesDebugEnabled())
      ) {
        console.info("[workspace-files]", {
          workspaceId: requestWorkspaceId,
          reason,
          ms: elapsedMs,
          files: snapshot.files.length,
          directories: snapshot.directories.length,
          gitignoredFiles: snapshot.gitignoredFiles.length,
          gitignoredDirectories: snapshot.gitignoredDirectories.length,
          scanState: snapshot.scanState,
          limitHit: snapshot.limitHit,
          directoryEntries: snapshot.directoryMetadata.length,
        });
      }
      onDebug?.({
        id: `${Date.now()}-server-files-list`,
        timestamp: Date.now(),
        source: "server",
        label: "files/list response",
        payload: {
          workspaceId: requestWorkspaceId,
          reason,
          ms: elapsedMs,
          files: snapshot.files.length,
          directories: snapshot.directories.length,
          gitignoredFiles: snapshot.gitignoredFiles.length,
          gitignoredDirectories: snapshot.gitignoredDirectories.length,
          scanState: snapshot.scanState,
          limitHit: snapshot.limitHit,
          directoryEntries: snapshot.directoryMetadata.length,
        },
      });
      rememberWorkspaceFilesSnapshot(workspaceCacheKey, snapshot);
      applyWorkspaceFilesSnapshot(requestWorkspaceId, snapshot);
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      const message = normalizeErrorMessage(error);
      const isCurrentWorkspaceResponse =
        isMountedRef.current && requestWorkspaceId === latestWorkspaceIdRef.current;
      const canFallbackToFullSnapshot =
        isCurrentWorkspaceResponse &&
        reason !== "poll" &&
        isRootDirectorySentinelCompatibilityError(message) &&
        hasLoadedWorkspaceId.current !== requestWorkspaceId &&
        !rootSnapshotCache.current.has(workspaceCacheKey);
      if (canFallbackToFullSnapshot) {
        const fallbackStartedAt = Date.now();
        onDebug?.({
          id: `${fallbackStartedAt}-client-files-list-fallback`,
          timestamp: fallbackStartedAt,
          source: "client",
          label: "files/list fallback",
          payload: {
            workspaceId: requestWorkspaceId,
            reason,
            rootError: message,
          },
        });
        try {
          const fallbackResponse = await getWorkspaceFiles(requestWorkspaceId, {
            forceRefresh: reason === "manual",
          });
          const fallbackElapsedMs = Date.now() - fallbackStartedAt;
          const fallbackSnapshot = normalizeWorkspaceFilesSnapshot(fallbackResponse);
          const fallbackRootSnapshot = toRootOnlyWorkspaceFilesSnapshot(fallbackSnapshot);
          rememberWorkspaceFilesSnapshot(workspaceCacheKey, fallbackRootSnapshot);
          const applied = applyWorkspaceFilesSnapshot(requestWorkspaceId, fallbackRootSnapshot);
          appendWorkspaceFileListingBudgetDiagnostic({
            surfaceId: "fallback-full-listing",
            workspaceId: requestWorkspaceId,
            durationMs: fallbackElapsedMs,
            returnedEntries:
              fallbackRootSnapshot.listingBudget?.returnedEntries ??
              fallbackRootSnapshot.files.length +
                fallbackRootSnapshot.directories.length +
                fallbackRootSnapshot.directoryMetadata.length,
            payloadBytes: fallbackRootSnapshot.payloadBytes,
            cacheState: fallbackRootSnapshot.cacheState,
            scanState: fallbackRootSnapshot.scanState,
            partial: fallbackRootSnapshot.scanState === "partial" || fallbackRootSnapshot.limitHit,
            limitHit: fallbackRootSnapshot.limitHit,
            sourceVersion: fallbackRootSnapshot.sourceVersion,
            evidenceClass: fallbackRootSnapshot.sourceVersion ? "measured" : "unsupported",
            fallbackReason: message,
          });
          onDebug?.({
            id: `${Date.now()}-server-files-list-fallback-response`,
            timestamp: Date.now(),
            source: "server",
            label: "files/list fallback response",
            payload: {
              workspaceId: requestWorkspaceId,
              reason,
              ms: fallbackElapsedMs,
              applied,
              files: fallbackRootSnapshot.files.length,
              directories: fallbackRootSnapshot.directories.length,
              fullSnapshotFiles: fallbackSnapshot.files.length,
              fullSnapshotDirectories: fallbackSnapshot.directories.length,
              scanState: fallbackRootSnapshot.scanState,
              limitHit: fallbackRootSnapshot.limitHit,
              rootError: message,
            },
          });
          return;
        } catch (fallbackError) {
          const fallbackMessage = normalizeErrorMessage(fallbackError);
          onDebug?.({
            id: `${Date.now()}-client-files-list-fallback-error`,
            timestamp: Date.now(),
            source: "error",
            label: "files/list fallback error",
            payload: {
              workspaceId: requestWorkspaceId,
              reason,
              rootError: message,
              fallbackError: fallbackMessage,
            },
          });
        }
      }
      if (isCurrentWorkspaceResponse) {
        consecutiveFailures.current += 1;
      }
      if (isCurrentWorkspaceResponse) {
        setLoadError(message);
        if (reason === "initial") {
          scheduleInitialRetry(requestWorkspaceId);
        }
      }
      if (import.meta.env.DEV && isWorkspaceFilesDebugEnabled()) {
        console.warn("[workspace-files] refresh failed", {
          workspaceId: requestWorkspaceId,
          reason,
          ms: elapsedMs,
          failureCount: consecutiveFailures.current,
          stale: !isCurrentWorkspaceResponse,
          error: message,
        });
      }
      onDebug?.({
        id: `${Date.now()}-client-files-list-error`,
        timestamp: Date.now(),
        source: "error",
        label: "files/list error",
        payload: {
          workspaceId: requestWorkspaceId,
          reason,
          ms: elapsedMs,
          failureCount: consecutiveFailures.current,
          stale: !isCurrentWorkspaceResponse,
          message,
        },
      });
    } finally {
      inFlightWorkspaceIds.current.delete(requestWorkspaceId);
      if (isMountedRef.current && requestWorkspaceId === latestWorkspaceIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [
    applyWorkspaceFilesSnapshot,
    isConnected,
    rememberWorkspaceFilesSnapshot,
    onDebug,
    scheduleInitialRetry,
    workspaceCacheKey,
    workspaceId,
  ]);

  useEffect(() => {
    refreshFilesRef.current = refreshFiles;
  }, [refreshFiles]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    setLoadError(null);
    consecutiveFailures.current = 0;
    retryAttemptsByWorkspaceId.current.clear();
    clearInitialRetryTimer();
    const cachedSnapshot = workspaceCacheKey
      ? rootSnapshotCache.current.get(workspaceCacheKey)
      : undefined;
    if (workspaceId && initialLoadEnabled && cachedSnapshot) {
      setFiles(cachedSnapshot.files);
      setDirectories(cachedSnapshot.directories);
      setGitignoredFiles(new Set(cachedSnapshot.gitignoredFiles));
      setGitignoredDirectories(new Set(cachedSnapshot.gitignoredDirectories));
      setScanState(cachedSnapshot.scanState);
      setLimitHit(cachedSnapshot.limitHit);
      setDirectoryMetadata(cachedSnapshot.directoryMetadata);
      setSourceVersion(cachedSnapshot.sourceVersion);
      hasLoadedWorkspaceId.current = workspaceId;
      setIsLoading(false);
      return;
    }
    setFiles([]);
    setDirectories([]);
    setGitignoredFiles(new Set());
    setGitignoredDirectories(new Set());
    setScanState("complete");
    setLimitHit(false);
    setDirectoryMetadata([]);
    setSourceVersion(null);
    hasLoadedWorkspaceId.current = null;
    setIsLoading(Boolean(workspaceId && initialLoadEnabled));
  }, [clearInitialRetryTimer, initialLoadEnabled, workspaceCacheKey, workspaceId]);

  useEffect(() => {
    if (!workspaceId || !initialLoadEnabled) {
      setIsLoading(false);
      return;
    }
    if (hasLoadedWorkspaceId.current === workspaceId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
  }, [initialLoadEnabled, isConnected, workspaceId]);

  useEffect(() => {
    return () => {
      clearInitialRetryTimer();
    };
  }, [clearInitialRetryTimer]);

  useEffect(() => {
    if (!workspaceId || !isConnected || !initialLoadEnabled) {
      return;
    }
    const needsRefresh = hasLoadedWorkspaceId.current !== workspaceId;
    if (!needsRefresh) {
      return;
    }
    void refreshFiles("initial");
  }, [initialLoadEnabled, isConnected, refreshFiles, workspaceId]);

  useEffect(() => {
    if (!workspaceId || !isConnected || !pollingEnabled) {
      return;
    }

    let cancelled = false;
    let timeoutId = 0;
    const scheduleNext = () => {
      if (cancelled) {
        return;
      }
      const backoffMultiplier = Math.max(1, 2 ** consecutiveFailures.current);
      const intervalMs = Math.min(
        MAX_REFRESH_INTERVAL_MS,
        BASE_REFRESH_INTERVAL_MS * backoffMultiplier,
      );
      timeoutId = window.setTimeout(() => {
        void refreshFiles("poll").finally(() => {
          scheduleNext();
        });
      }, intervalMs);
    };
    scheduleNext();

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [isConnected, pollingEnabled, refreshFiles, workspaceId]);

  const fileOptions = useMemo(() => files.filter(Boolean), [files]);
  const directoryOptions = useMemo(() => directories.filter(Boolean), [directories]);

  return {
    files: fileOptions,
    directories: directoryOptions,
    gitignoredFiles,
    gitignoredDirectories,
    scanState,
    limitHit,
    directoryMetadata,
    sourceVersion,
    isLoading,
    loadError,
    refreshFiles,
  };
}
