import { useCallback, useEffect, useRef, useState } from "react";
import {
  readExternalAbsoluteFile,
  readExternalSpecFile,
  readWorkspaceFile,
  writeExternalSpecFile,
  writeWorkspaceFile,
} from "../../../services/tauri";
import { pushErrorToast } from "../../../services/toasts";
import type { FileReadTarget } from "../../../utils/workspacePaths";
import {
  createFileDocumentSnapshot,
  type FileDocumentSnapshot,
} from "@/utils/fileDocumentSnapshot";

type UseFileDocumentStateArgs = {
  workspaceId: string;
  customSpecRoot: string | null;
  workspaceRelativeFilePath: string;
  fileReadTarget: FileReadTarget;
  skipTextRead: boolean;
  externalAbsoluteReadOnlyMessage: string;
};

type FileDocumentSessionCacheEntry = {
  documentSnapshot: FileDocumentSnapshot;
  savedContent: string;
  externalDiskSnapshot: { content: string; truncated: boolean } | null;
  updatedAt: number;
};

export function detectPreservedLineEnding(content: string): "\r\n" | "\r" | null {
  const withoutCrLf = content.replace(/\r\n/g, "");
  if (content.includes("\r\n") && !withoutCrLf.includes("\r") && !withoutCrLf.includes("\n")) {
    return "\r\n";
  }
  if (content.includes("\r") && !content.includes("\n")) {
    return "\r";
  }
  return null;
}

export function restorePreservedLineEnding(
  content: string,
  lineEnding: "\r\n" | "\r" | null,
) {
  if (!lineEnding) {
    return content;
  }
  return content.replace(/\r\n|\r|\n/g, "\n").replace(/\n/g, lineEnding);
}

const FILE_DOCUMENT_SESSION_CACHE_MAX_ENTRIES = 24;
const FILE_DOCUMENT_SESSION_CACHE_MAX_CONTENT_LENGTH = 1_048_576;
const fileDocumentSessionCache = new Map<string, FileDocumentSessionCacheEntry>();

function canCacheFileDocumentSession(snapshot: FileDocumentSnapshot) {
  return snapshot.content.length <= FILE_DOCUMENT_SESSION_CACHE_MAX_CONTENT_LENGTH;
}

function writeFileDocumentSessionCache(
  key: string,
  entry: Omit<FileDocumentSessionCacheEntry, "updatedAt">,
) {
  if (!canCacheFileDocumentSession(entry.documentSnapshot)) {
    fileDocumentSessionCache.delete(key);
    return;
  }
  fileDocumentSessionCache.set(key, {
    ...entry,
    updatedAt: Date.now(),
  });
  if (fileDocumentSessionCache.size <= FILE_DOCUMENT_SESSION_CACHE_MAX_ENTRIES) {
    return;
  }
  const [oldestKey] = [...fileDocumentSessionCache.entries()].sort(
    (left, right) => left[1].updatedAt - right[1].updatedAt,
  )[0] ?? [];
  if (oldestKey) {
    fileDocumentSessionCache.delete(oldestKey);
  }
}

function readFileDocumentSessionCache(key: string) {
  const cached = fileDocumentSessionCache.get(key);
  if (!cached) {
    return null;
  }
  fileDocumentSessionCache.set(key, {
    ...cached,
    updatedAt: Date.now(),
  });
  return cached;
}

export function clearFileDocumentSessionCacheForTests() {
  fileDocumentSessionCache.clear();
}

export function useFileDocumentState({
  workspaceId,
  customSpecRoot,
  workspaceRelativeFilePath,
  fileReadTarget,
  skipTextRead,
  externalAbsoluteReadOnlyMessage,
}: UseFileDocumentStateArgs) {
  const [documentSnapshot, setDocumentSnapshot] = useState<FileDocumentSnapshot>(() =>
    createFileDocumentSnapshot("", false, 0),
  );
  const content = documentSnapshot.content;
  const truncated = documentSnapshot.truncated;
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedContentRef = useRef("");
  const latestIsDirtyRef = useRef(false);
  const externalDiskSnapshotRef = useRef<{ content: string; truncated: boolean } | null>(null);
  const requestIdRef = useRef(0);
  const saveRequestIdRef = useRef(0);
  const saveInFlightRef = useRef(false);
  const saveInFlightPromiseRef = useRef<Promise<boolean> | null>(null);
  const latestContentRef = useRef(content);
  const latestDocumentSnapshotRef = useRef(documentSnapshot);
  const fileReadTargetDomain = fileReadTarget.domain;
  const fileReadNormalizedInputPath = fileReadTarget.normalizedInputPath;
  const fileReadExternalSpecLogicalPath =
    fileReadTargetDomain === "external-spec"
      ? fileReadTarget.externalSpecLogicalPath
      : null;
  const fileReadTargetKey = [
    workspaceId,
    customSpecRoot ?? "",
    workspaceRelativeFilePath,
    fileReadTargetDomain,
    fileReadNormalizedInputPath,
    fileReadExternalSpecLogicalPath ?? "",
    skipTextRead ? "binary" : "text",
  ].join("\u001f");
  const [loadedFileReadTargetKey, setLoadedFileReadTargetKey] = useState<string | null>(
    null,
  );

  latestContentRef.current = content;
  latestDocumentSnapshotRef.current = documentSnapshot;
  const isDirty = content !== savedContentRef.current;
  latestIsDirtyRef.current = isDirty;

  const replaceDocumentSnapshot = useCallback((nextContent: string, nextTruncated: boolean) => {
    setDocumentSnapshot((current) => {
      if (current.content === nextContent && current.truncated === nextTruncated) {
        return current;
      }
      return createFileDocumentSnapshot(
        nextContent,
        nextTruncated,
        current.snapshotVersion + 1,
      );
    });
  }, []);

  const setContent = useCallback((nextContent: string) => {
    latestContentRef.current = nextContent;
    latestIsDirtyRef.current = nextContent !== savedContentRef.current;
    setDocumentSnapshot((current) => {
      if (current.content === nextContent) {
        return current;
      }
      const nextSnapshot = createFileDocumentSnapshot(
        nextContent,
        current.truncated,
        current.snapshotVersion + 1,
      );
      writeFileDocumentSessionCache(fileReadTargetKey, {
        documentSnapshot: nextSnapshot,
        savedContent: savedContentRef.current,
        externalDiskSnapshot: externalDiskSnapshotRef.current,
      });
      return nextSnapshot;
    });
  }, [fileReadTargetKey]);

  const cacheDraftContent = useCallback((nextContent: string) => {
    latestContentRef.current = nextContent;
    latestIsDirtyRef.current = nextContent !== savedContentRef.current;
    const currentSnapshot = latestDocumentSnapshotRef.current;
    writeFileDocumentSessionCache(fileReadTargetKey, {
      documentSnapshot: createFileDocumentSnapshot(
        nextContent,
        currentSnapshot.truncated,
        currentSnapshot.snapshotVersion + 1,
      ),
      savedContent: savedContentRef.current,
      externalDiskSnapshot: externalDiskSnapshotRef.current,
    });
  }, [fileReadTargetKey]);

  const setTruncated = useCallback((nextTruncated: boolean) => {
    setDocumentSnapshot((current) => {
      if (current.truncated === nextTruncated) {
        return current;
      }
      return createFileDocumentSnapshot(
        current.content,
        nextTruncated,
        current.snapshotVersion + 1,
      );
    });
  }, []);

  useEffect(() => {
    if (skipTextRead) {
      setIsLoading(false);
      setError(null);
      replaceDocumentSnapshot("", false);
      savedContentRef.current = "";
      externalDiskSnapshotRef.current = null;
      setLoadedFileReadTargetKey(fileReadTargetKey);
      return;
    }

    let cancelled = false;
    requestIdRef.current += 1;
    saveRequestIdRef.current += 1;
    saveInFlightRef.current = false;
    saveInFlightPromiseRef.current = null;
    const currentRequest = requestIdRef.current;
    setIsLoading(true);
    setIsSaving(false);
    setError(null);
    setLoadedFileReadTargetKey(null);

    if (fileReadTargetDomain === "invalid") {
      setError("Invalid file path");
      replaceDocumentSnapshot("", false);
      savedContentRef.current = "";
      externalDiskSnapshotRef.current = null;
      setLoadedFileReadTargetKey(fileReadTargetKey);
      setIsLoading(false);
      return;
    }

    const cachedSession = readFileDocumentSessionCache(fileReadTargetKey);
    if (cachedSession) {
      const cachedIsDirty =
        cachedSession.documentSnapshot.content !== cachedSession.savedContent;
      setDocumentSnapshot(cachedSession.documentSnapshot);
      latestContentRef.current = cachedSession.documentSnapshot.content;
      savedContentRef.current = cachedSession.savedContent;
      latestIsDirtyRef.current = cachedIsDirty;
      externalDiskSnapshotRef.current = cachedSession.externalDiskSnapshot;
      setLoadedFileReadTargetKey(fileReadTargetKey);
      setIsLoading(false);
      if (cachedIsDirty) {
        return;
      }
    }

    const readPromise =
      fileReadTargetDomain === "external-spec" && customSpecRoot && fileReadExternalSpecLogicalPath
        ? readExternalSpecFile(
            workspaceId,
            customSpecRoot,
            fileReadExternalSpecLogicalPath,
          ).then((response) => {
            if (!response.exists) {
              throw new Error("Failed to open file: File does not exist");
            }
            return {
              content: response.content ?? "",
              truncated: Boolean(response.truncated),
            };
          })
        : fileReadTargetDomain === "external-absolute"
          ? readExternalAbsoluteFile(
              workspaceId,
              fileReadNormalizedInputPath,
            )
          : readWorkspaceFile(workspaceId, workspaceRelativeFilePath);

    readPromise
      .then((response) => {
        if (cancelled || currentRequest !== requestIdRef.current) return;
        if (latestIsDirtyRef.current) {
          setLoadedFileReadTargetKey(fileReadTargetKey);
          return;
        }
        const nextContent = response.content ?? "";
        const nextTruncated = Boolean(response.truncated);
        latestContentRef.current = nextContent;
        savedContentRef.current = nextContent;
        externalDiskSnapshotRef.current = {
          content: nextContent,
          truncated: nextTruncated,
        };
        setDocumentSnapshot((current) => {
          const nextSnapshot = createFileDocumentSnapshot(
            nextContent,
            nextTruncated,
            current.snapshotVersion + 1,
          );
          writeFileDocumentSessionCache(fileReadTargetKey, {
            documentSnapshot: nextSnapshot,
            savedContent: nextContent,
            externalDiskSnapshot: externalDiskSnapshotRef.current,
          });
          return nextSnapshot;
        });
        setLoadedFileReadTargetKey(fileReadTargetKey);
      })
      .catch((readError) => {
        if (cancelled || currentRequest !== requestIdRef.current) return;
        setError(readError instanceof Error ? readError.message : String(readError));
        setLoadedFileReadTargetKey(fileReadTargetKey);
      })
      .finally(() => {
        if (!cancelled && currentRequest === requestIdRef.current) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    customSpecRoot,
    fileReadTargetKey,
    fileReadExternalSpecLogicalPath,
    fileReadNormalizedInputPath,
    fileReadTargetDomain,
    replaceDocumentSnapshot,
    skipTextRead,
    workspaceId,
    workspaceRelativeFilePath,
  ]);

  const handleSave = useCallback(() => {
    const contentToSave = latestContentRef.current;
    const diskContentToSave = restorePreservedLineEnding(
      contentToSave,
      detectPreservedLineEnding(
        externalDiskSnapshotRef.current?.content ?? savedContentRef.current,
      ),
    );
    const latestIsDirty = contentToSave !== savedContentRef.current;
    if (!latestIsDirty) {
      return Promise.resolve(true);
    }
    if (truncated) {
      return Promise.resolve(false);
    }
    if (saveInFlightRef.current && saveInFlightPromiseRef.current) {
      return saveInFlightPromiseRef.current;
    }
    const saveRequestId = saveRequestIdRef.current + 1;
    saveRequestIdRef.current = saveRequestId;
    saveInFlightRef.current = true;
    setIsSaving(true);
    const savePromise = (async () => {
      try {
        if (
          fileReadTargetDomain === "external-spec" &&
          customSpecRoot &&
          fileReadExternalSpecLogicalPath
        ) {
          await writeExternalSpecFile(
            workspaceId,
            customSpecRoot,
            fileReadExternalSpecLogicalPath,
            diskContentToSave,
          );
        } else if (fileReadTargetDomain === "external-absolute") {
          throw new Error(externalAbsoluteReadOnlyMessage);
        } else if (fileReadTargetDomain === "invalid") {
          throw new Error("Invalid file path");
        } else {
          await writeWorkspaceFile(workspaceId, workspaceRelativeFilePath, diskContentToSave);
        }
        if (saveRequestId !== saveRequestIdRef.current) {
          return false;
        }
        savedContentRef.current = contentToSave;
        latestIsDirtyRef.current = latestContentRef.current !== contentToSave;
        setDocumentSnapshot((current) =>
          createFileDocumentSnapshot(
            current.content,
            current.truncated,
            current.snapshotVersion + 1,
          ),
        );
        externalDiskSnapshotRef.current = {
          content: diskContentToSave,
          truncated,
        };
        writeFileDocumentSessionCache(fileReadTargetKey, {
          documentSnapshot: latestDocumentSnapshotRef.current,
          savedContent: contentToSave,
          externalDiskSnapshot: externalDiskSnapshotRef.current,
        });
        return !latestIsDirtyRef.current;
      } catch (saveError) {
        if (saveRequestId !== saveRequestIdRef.current) {
          return false;
        }
        pushErrorToast({
          title: "Failed to save file",
          message: saveError instanceof Error ? saveError.message : String(saveError),
        });
        return false;
      } finally {
        if (saveRequestId === saveRequestIdRef.current) {
          saveInFlightRef.current = false;
          saveInFlightPromiseRef.current = null;
          setIsSaving(false);
        }
      }
    })();
    saveInFlightPromiseRef.current = savePromise;
    return savePromise;
  }, [
    customSpecRoot,
    externalAbsoluteReadOnlyMessage,
    fileReadExternalSpecLogicalPath,
    fileReadTargetKey,
    fileReadTargetDomain,
    truncated,
    workspaceId,
    workspaceRelativeFilePath,
  ]);

  const handleDiscard = useCallback(() => {
    const savedContent = savedContentRef.current;
    latestContentRef.current = savedContent;
    latestIsDirtyRef.current = false;
    setDocumentSnapshot((current) => {
      const nextSnapshot = createFileDocumentSnapshot(
        savedContent,
        current.truncated,
        current.snapshotVersion + 1,
      );
      writeFileDocumentSessionCache(fileReadTargetKey, {
        documentSnapshot: nextSnapshot,
        savedContent,
        externalDiskSnapshot: externalDiskSnapshotRef.current,
      });
      return nextSnapshot;
    });
  }, [fileReadTargetKey]);

  return {
    content,
    setContent,
    cacheDraftContent,
    documentSnapshot,
    replaceDocumentSnapshot,
    isLoading: isLoading || loadedFileReadTargetKey !== fileReadTargetKey,
    isSaving,
    error,
    truncated,
    setTruncated,
    isDirty,
    savedContentRef,
    latestIsDirtyRef,
    externalDiskSnapshotRef,
    handleSave,
    handleDiscard,
  };
}
