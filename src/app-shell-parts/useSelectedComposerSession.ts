import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { getClientStoreSync, writeClientStoreValue } from "../services/clientStorage";
import type { DebugEntry } from "../types";
import {
  extractClaudeForkParentThreadId,
  getThreadComposerSelectionStorageKey,
  normalizeComposerSessionSelection,
  normalizeComposerSessionSelectionForThread,
  shouldApplyDraftComposerSelectionToThread,
  shouldInheritComposerSelectionFromClaudeForkParent,
  shouldMigrateComposerSelectionBetweenThreadIds,
  type ComposerSessionSelection,
} from "./selectedComposerSession";

function selectionsEqual(
  left: ComposerSessionSelection | null,
  right: ComposerSessionSelection | null,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return left.modelId === right.modelId && left.effort === right.effort;
}

function readStoredThreadComposerSelectionEntryBySessionKey(
  sessionKey: string,
): { exists: boolean; value: ComposerSessionSelection | null } {
  const raw = getClientStoreSync<unknown>("composer", sessionKey);
  if (raw === undefined) {
    return {
      exists: false,
      value: null,
    };
  }
  return {
    exists: true,
    value: normalizeComposerSessionSelection(raw),
  };
}

type UseSelectedComposerSessionOptions = {
  activeThreadId: string | null;
  activeWorkspaceId: string | null;
  resolveCanonicalThreadId: (threadId: string) => string;
  engineDefaultSelectionReady?: boolean;
  /**
   * Supplies the durable per-engine "last used" selection so a brand-new
   * conversation opens with the model/effort the user last chose for that engine.
   * Return null to keep the engine catalog default (e.g. codex, which persists
   * its global selection through a separate path).
   */
  resolveEngineDefaultComposerSelection?: (
    threadId: string,
  ) => ComposerSessionSelection | null;
  onDebug?: (entry: DebugEntry) => void;
};

type UseSelectedComposerSessionResult = {
  selectedComposerSelection: ComposerSessionSelection | null;
  selectedComposerSelectionRef: MutableRefObject<ComposerSessionSelection | null>;
  handleSelectComposerSelection: (selection: ComposerSessionSelection | null) => void;
  persistComposerSelectionForThread: (
    workspaceId: string | null,
    threadId: string | null,
    selection: ComposerSessionSelection | null,
  ) => void;
  reloadSelectedComposerSelection: () => void;
  resolveComposerSelectionForThread: (
    workspaceId: string | null,
    threadId: string | null,
  ) => ComposerSessionSelection | null;
};

export function useSelectedComposerSession({
  activeThreadId,
  activeWorkspaceId,
  resolveCanonicalThreadId,
  engineDefaultSelectionReady = true,
  resolveEngineDefaultComposerSelection,
}: UseSelectedComposerSessionOptions): UseSelectedComposerSessionResult {
  const [selectedComposerSelectionBySessionKey, setSelectedComposerSelectionBySessionKey] =
    useState<Record<string, ComposerSessionSelection | null>>({});
  const selectedComposerSelectionBySessionKeyRef = useRef<
    Record<string, ComposerSessionSelection | null>
  >({});
  const [draftComposerSelection, setDraftComposerSelection] =
    useState<ComposerSessionSelection | null>(null);
  const [selectedComposerSelection, setSelectedComposerSelection] =
    useState<ComposerSessionSelection | null>(null);
  const selectedComposerSelectionRef = useRef<ComposerSessionSelection | null>(null);
  const draftComposerSelectionWorkspaceIdRef = useRef<string | null>(null);
  const shouldApplyDraftToNextThreadRef = useRef(false);

  const resolveSelectedComposerSessionKey = useCallback(
    (workspaceId: string | null, threadId: string | null): string | null => {
      if (!threadId) {
        return null;
      }
      return getThreadComposerSelectionStorageKey(workspaceId, threadId);
    },
    [],
  );

  const cacheSelectionForSessionKey = useCallback(
    (sessionKey: string, selection: ComposerSessionSelection | null) => {
      const currentCache = selectedComposerSelectionBySessionKeyRef.current;
      if (selectionsEqual(currentCache[sessionKey] ?? null, selection)) {
        return;
      }
      selectedComposerSelectionBySessionKeyRef.current = {
        ...currentCache,
        [sessionKey]: selection,
      };
      setSelectedComposerSelectionBySessionKey((currentState) => {
        if (selectionsEqual(currentState[sessionKey] ?? null, selection)) {
          return currentState;
        }
        return {
          ...currentState,
          [sessionKey]: selection,
        };
      });
    },
    [],
  );

  const writeSelectionForSessionKey = useCallback(
    (sessionKey: string, selection: ComposerSessionSelection | null) => {
      cacheSelectionForSessionKey(sessionKey, selection);
      const stored = readStoredThreadComposerSelectionEntryBySessionKey(sessionKey);
      if (stored.exists && selectionsEqual(stored.value, selection)) {
        return;
      }
      writeClientStoreValue("composer", sessionKey, selection);
    },
    [cacheSelectionForSessionKey],
  );

  const persistComposerSelectionForThread = useCallback(
    (
      workspaceId: string | null,
      threadId: string | null,
      selection: ComposerSessionSelection | null,
    ) => {
      if (!threadId) {
        return;
      }
      const sessionKey = resolveSelectedComposerSessionKey(workspaceId, threadId);
      if (!sessionKey) {
        return;
      }
      const normalized = normalizeComposerSessionSelectionForThread(threadId, selection);
      writeSelectionForSessionKey(sessionKey, normalized);
    },
    [resolveSelectedComposerSessionKey, writeSelectionForSessionKey],
  );

  const handleSelectComposerSelection = useCallback(
    (selection: ComposerSessionSelection | null) => {
      const normalized = normalizeComposerSessionSelection(selection);
      selectedComposerSelectionRef.current = normalized;
      setSelectedComposerSelection(normalized);
      if (!activeThreadId) {
        setDraftComposerSelection(normalized);
        draftComposerSelectionWorkspaceIdRef.current = activeWorkspaceId ?? null;
        shouldApplyDraftToNextThreadRef.current = Boolean(normalized);
        return;
      }
      shouldApplyDraftToNextThreadRef.current = false;
      persistComposerSelectionForThread(activeWorkspaceId, activeThreadId, normalized);
    },
    [activeThreadId, activeWorkspaceId, persistComposerSelectionForThread],
  );

  const resolveComposerSelectionForThread = useCallback(
    (workspaceId: string | null, threadId: string | null): ComposerSessionSelection | null => {
      const sessionKey = resolveSelectedComposerSessionKey(workspaceId, threadId);
      if (!sessionKey) {
        return null;
      }
      if (Object.prototype.hasOwnProperty.call(selectedComposerSelectionBySessionKey, sessionKey)) {
        return normalizeComposerSessionSelectionForThread(
          threadId,
          selectedComposerSelectionBySessionKey[sessionKey] ?? null,
        );
      }
      return normalizeComposerSessionSelectionForThread(
        threadId,
        readStoredThreadComposerSelectionEntryBySessionKey(sessionKey).value,
      );
    },
    [resolveSelectedComposerSessionKey, selectedComposerSelectionBySessionKey],
  );

  const reloadSelectedComposerSelection = useCallback(() => {
    if (!activeThreadId) {
      const draftForActiveWorkspace =
        draftComposerSelectionWorkspaceIdRef.current === (activeWorkspaceId ?? null)
          ? draftComposerSelection
          : null;
      selectedComposerSelectionRef.current = draftForActiveWorkspace;
      setSelectedComposerSelection(draftForActiveWorkspace);
      return;
    }

    const sessionKey = resolveSelectedComposerSessionKey(activeWorkspaceId, activeThreadId);
    if (!sessionKey) {
      selectedComposerSelectionRef.current = null;
      setSelectedComposerSelection(null);
      return;
    }

    let candidate: ComposerSessionSelection | null = null;
    let hasCandidate = false;
    const selectionCache = selectedComposerSelectionBySessionKeyRef.current;
    if (Object.prototype.hasOwnProperty.call(selectionCache, sessionKey)) {
      candidate = normalizeComposerSessionSelectionForThread(
        activeThreadId,
        selectionCache[sessionKey] ?? null,
      );
      hasCandidate = true;
    } else {
      const stored = readStoredThreadComposerSelectionEntryBySessionKey(sessionKey);
      candidate = normalizeComposerSessionSelectionForThread(activeThreadId, stored.value);
      hasCandidate = stored.exists;
      const parentThreadId = extractClaudeForkParentThreadId(activeThreadId);
      const parentSessionKey = parentThreadId
        ? resolveSelectedComposerSessionKey(activeWorkspaceId, parentThreadId)
        : null;
      const parentStored = parentSessionKey
        ? readStoredThreadComposerSelectionEntryBySessionKey(parentSessionKey)
        : { exists: false, value: null };
      const parentSelection = normalizeComposerSessionSelectionForThread(
        parentThreadId,
        parentStored.value,
      );
      const shouldInheritClaudeForkSelection =
        shouldInheritComposerSelectionFromClaudeForkParent({
          activeThreadId,
          hasCandidate,
          hasParentSelection: Boolean(parentSelection),
        });
      if (shouldInheritClaudeForkSelection) {
        candidate = normalizeComposerSessionSelectionForThread(activeThreadId, parentSelection);
        hasCandidate = true;
        writeSelectionForSessionKey(sessionKey, candidate);
      }
      const draftSelectionForActiveThread = normalizeComposerSessionSelectionForThread(
        activeThreadId,
        draftComposerSelection,
      );
      const shouldApplyDraftSelection =
        draftComposerSelectionWorkspaceIdRef.current === (activeWorkspaceId ?? null) &&
        shouldApplyDraftComposerSelectionToThread({
          candidate,
          shouldApplyDraftToNextThread: shouldApplyDraftToNextThreadRef.current,
          draftComposerSelection: draftSelectionForActiveThread,
          activeThreadId,
        });
      if (shouldApplyDraftSelection) {
        candidate = draftSelectionForActiveThread;
        hasCandidate = true;
        shouldApplyDraftToNextThreadRef.current = false;
        writeSelectionForSessionKey(sessionKey, candidate);
      }
      if (
        !hasCandidate &&
        engineDefaultSelectionReady &&
        activeThreadId.includes("-pending-")
      ) {
        const engineDefault = normalizeComposerSessionSelectionForThread(
          activeThreadId,
          resolveEngineDefaultComposerSelection?.(activeThreadId) ?? null,
        );
        if (engineDefault) {
          candidate = engineDefault;
          hasCandidate = true;
          writeSelectionForSessionKey(sessionKey, candidate);
        }
      }
      if (hasCandidate) {
        cacheSelectionForSessionKey(sessionKey, candidate);
      }
    }

    selectedComposerSelectionRef.current = candidate;
    setSelectedComposerSelection((currentSelection) =>
      selectionsEqual(currentSelection, candidate) ? currentSelection : candidate
    );
  }, [
    activeThreadId,
    activeWorkspaceId,
    draftComposerSelection,
    engineDefaultSelectionReady,
    cacheSelectionForSessionKey,
    resolveEngineDefaultComposerSelection,
    resolveSelectedComposerSessionKey,
    writeSelectionForSessionKey,
  ]);

  const previousThreadIdForDraftCarryRef = useRef<string | null>(activeThreadId ?? null);
  useEffect(() => {
    const previousThreadId = previousThreadIdForDraftCarryRef.current;
    if (previousThreadId && !activeThreadId) {
      const latestSelection = selectedComposerSelectionRef.current;
      setDraftComposerSelection(latestSelection ?? null);
      draftComposerSelectionWorkspaceIdRef.current = activeWorkspaceId ?? null;
      shouldApplyDraftToNextThreadRef.current = Boolean(latestSelection);
    }
    previousThreadIdForDraftCarryRef.current = activeThreadId ?? null;
  }, [activeThreadId, activeWorkspaceId]);

  const previousThreadIdRef = useRef<string | null>(null);
  const previousThreadWorkspaceIdRef = useRef<string | null>(null);
  const lastComposerSelectionMigrationRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const previousThreadId = previousThreadIdRef.current;
    const previousWorkspaceId = previousThreadWorkspaceIdRef.current;
    const previousSelectedComposerSessionKey = resolveSelectedComposerSessionKey(
      previousWorkspaceId,
      previousThreadId,
    );
    const activeSelectedComposerSessionKey = resolveSelectedComposerSessionKey(
      activeWorkspaceId,
      activeThreadId,
    );
    const selectionCache = selectedComposerSelectionBySessionKeyRef.current;
    const previousSelectedComposerFromMemory =
      previousSelectedComposerSessionKey &&
      Object.prototype.hasOwnProperty.call(
        selectionCache,
        previousSelectedComposerSessionKey,
      )
        ? selectionCache[previousSelectedComposerSessionKey] ?? null
        : null;
    const activeSelectedComposerFromMemory =
      activeSelectedComposerSessionKey &&
      Object.prototype.hasOwnProperty.call(
        selectionCache,
        activeSelectedComposerSessionKey,
      )
        ? selectionCache[activeSelectedComposerSessionKey] ?? null
        : null;
    const previousSelectedComposerFromStore = previousSelectedComposerSessionKey
      ? readStoredThreadComposerSelectionEntryBySessionKey(previousSelectedComposerSessionKey)
          .value
      : null;
    const activeSelectedComposerFromStore = activeSelectedComposerSessionKey
      ? readStoredThreadComposerSelectionEntryBySessionKey(activeSelectedComposerSessionKey).value
      : null;
    const previousSelectedComposerValue = normalizeComposerSessionSelectionForThread(
      previousThreadId,
      previousSelectedComposerFromMemory ?? previousSelectedComposerFromStore,
    );
    const activeSelectedComposerValue = normalizeComposerSessionSelectionForThread(
      activeThreadId,
      activeSelectedComposerFromMemory ?? activeSelectedComposerFromStore,
    );
    const shouldMigrateComposerSelection =
      shouldMigrateComposerSelectionBetweenThreadIds({
        previousThreadId,
        activeThreadId,
        previousSessionKey: previousSelectedComposerSessionKey,
        activeSessionKey: activeSelectedComposerSessionKey,
        hasSourceSelection: Boolean(previousSelectedComposerValue),
        hasTargetSelection: Boolean(activeSelectedComposerValue),
        resolveCanonicalThreadId,
      });
    if (
      shouldMigrateComposerSelection &&
      previousSelectedComposerSessionKey &&
      activeSelectedComposerSessionKey
    ) {
      const migrationKey = [
        previousWorkspaceId ?? "",
        previousThreadId ?? "",
        activeWorkspaceId ?? "",
        activeThreadId ?? "",
        previousSelectedComposerSessionKey,
        activeSelectedComposerSessionKey,
      ].join("\u0000");
      if (lastComposerSelectionMigrationRef.current !== migrationKey) {
        lastComposerSelectionMigrationRef.current = migrationKey;
        const migratedSelection = normalizeComposerSessionSelectionForThread(
          activeThreadId,
          previousSelectedComposerValue,
        );
        writeSelectionForSessionKey(activeSelectedComposerSessionKey, migratedSelection);
      }
    }
    previousThreadIdRef.current = activeThreadId ?? null;
    previousThreadWorkspaceIdRef.current = activeWorkspaceId ?? null;
  }, [
    activeThreadId,
    activeWorkspaceId,
    resolveCanonicalThreadId,
    resolveSelectedComposerSessionKey,
    writeSelectionForSessionKey,
  ]);

  useLayoutEffect(() => {
    reloadSelectedComposerSelection();
  }, [reloadSelectedComposerSelection]);

  return {
    selectedComposerSelection,
    selectedComposerSelectionRef,
    handleSelectComposerSelection,
    persistComposerSelectionForThread,
    reloadSelectedComposerSelection,
    resolveComposerSelectionForThread,
  };
}
