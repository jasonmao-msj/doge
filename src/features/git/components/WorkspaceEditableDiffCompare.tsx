import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type UIEvent,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronUp from "lucide-react/dist/esm/icons/chevron-up";
import type { GitLineMarkers } from "../../files/utils/gitLineMarkers";
import { useFileDocumentState } from "../../files/hooks/useFileDocumentState";
import {
  buildFocusedFileCompareRanges,
  computeFileCompareDiff,
} from "../../files/utils/fileCompareDiff";
import { resolveFileRenderProfile } from "@/utils/fileRenderProfile";
import {
  CompareEditorColumn,
  type CompareColumnDraft,
  useFileCompareEditorTheme,
} from "../../files/components/WorkspaceFileComparePanel";
import { resolveFileReadTarget } from "../../../utils/workspacePaths";
import { loadFileViewStyles } from "../../../styles/featureStyleLoaders";
import { getGitFileFullDiff } from "../../../services/tauri";
import { reconstructPreviousVersion } from "../utils/reconstructPreviousVersion";
import type { DiffPresentationEntry } from "../utils/diffPresentationModel";

type WorkspaceEditableDiffCompareProps = Pick<
  DiffPresentationEntry,
  "filePath" | "diff"
> & {
  workspaceId: string;
  workspacePath: string;
  workspaceFilePath?: string;
  fullDiffLoader?: ((path: string) => Promise<string>) | null;
  contentMode?: "all" | "focused";
  onSaveSuccess: () => void;
  onDirtyChange: (isDirty: boolean) => void;
  onDraftActionsChange?: (actions: EditableDiffDraftActions | null) => void;
  headerControlsTarget?: HTMLElement | null;
};

export type EditableDiffDraftActions = {
  save: () => Promise<boolean>;
  discard: () => void;
  isSaving: boolean;
};

const EMPTY_MARKERS: GitLineMarkers = { added: [], modified: [] };

export function WorkspaceEditableDiffCompare({
  workspaceId,
  workspacePath,
  filePath,
  workspaceFilePath = filePath,
  diff,
  fullDiffLoader = null,
  contentMode = "all",
  onSaveSuccess,
  onDirtyChange,
  onDraftActionsChange,
  headerControlsTarget = null,
}: WorkspaceEditableDiffCompareProps) {
  const { t } = useTranslation();
  const editorTheme = useFileCompareEditorTheme();
  const scrollSyncingRef = useRef(false);
  const reconstructedBaselineRef = useRef<{ diff: string; source: string } | null>(null);
  const renderProfile = useMemo(() => resolveFileRenderProfile(filePath), [filePath]);
  const fileReadTarget = useMemo(
    () => resolveFileReadTarget(workspacePath, workspaceFilePath, null),
    [workspaceFilePath, workspacePath],
  );
  const documentState = useFileDocumentState({
    workspaceId,
    customSpecRoot: null,
    workspaceRelativeFilePath: fileReadTarget.workspaceRelativePath,
    fileReadTarget,
    skipTextRead: renderProfile.previewSourceKind !== "inline-bytes",
    externalAbsoluteReadOnlyMessage: t("files.externalAbsoluteReadOnly"),
  });
  const [previousSource, setPreviousSource] = useState<string | null>(null);
  const [hasResolvedBaseline, setHasResolvedBaseline] = useState(false);
  const [activeDifferenceIndex, setActiveDifferenceIndex] = useState(0);
  const loadFullDiff = useCallback(
    (path: string) => fullDiffLoader?.(path) ?? getGitFileFullDiff(workspaceId, path),
    [fullDiffLoader, workspaceId],
  );

  useEffect(() => {
    void loadFileViewStyles();
  }, []);

  useEffect(() => {
    reconstructedBaselineRef.current = null;
    setPreviousSource(null);
    setHasResolvedBaseline(false);
    setActiveDifferenceIndex(0);
  }, [filePath]);

  useEffect(() => {
    const savedSource = documentState.savedContentRef.current;
    const reconstructedBaseline = reconstructedBaselineRef.current;
    if (
      documentState.isLoading
      || (reconstructedBaseline?.diff === diff && reconstructedBaseline.source === savedSource)
    ) {
      return;
    }
    reconstructedBaselineRef.current = { diff, source: savedSource };
    setPreviousSource(null);
    setHasResolvedBaseline(false);

    const previewBaseline = reconstructPreviousVersion(savedSource, diff);
    if (previewBaseline !== null) {
      setPreviousSource(previewBaseline);
      setHasResolvedBaseline(true);
      return;
    }

    let cancelled = false;
    void loadFullDiff(filePath)
      .then((fullDiff) => {
        if (cancelled) {
          return;
        }
        setPreviousSource(reconstructPreviousVersion(savedSource, fullDiff));
        setHasResolvedBaseline(true);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setPreviousSource(null);
        setHasResolvedBaseline(true);
      });

    return () => {
      cancelled = true;
    };
  }, [
    diff,
    documentState.content,
    documentState.isLoading,
    documentState.isSaving,
    documentState.savedContentRef,
    filePath,
    loadFullDiff,
    workspaceId,
  ]);

  useEffect(() => {
    onDirtyChange(documentState.isDirty);
    return () => onDirtyChange(false);
  }, [documentState.isDirty, onDirtyChange]);

  const deferredContentForDiff = useDeferredValue(documentState.content);
  const baselineUnavailable = hasResolvedBaseline && previousSource === null;
  const diffResult = useMemo(
    () => computeFileCompareDiff([
      previousSource ?? deferredContentForDiff,
      deferredContentForDiff,
    ]),
    [deferredContentForDiff, previousSource],
  );
  const activeDifference = diffResult.changedBlocks[activeDifferenceIndex] ?? null;
  const canNavigateDifferences = diffResult.changedBlocks.length > 0;
  const saveDocument = documentState.handleSave;
  const discardDocument = documentState.handleDiscard;

  useEffect(() => {
    if (activeDifferenceIndex < diffResult.changedBlocks.length) {
      return;
    }
    setActiveDifferenceIndex(Math.max(0, diffResult.changedBlocks.length - 1));
  }, [activeDifferenceIndex, diffResult.changedBlocks.length]);

  const handleSave = useCallback(async () => {
    const shouldRefresh = documentState.isDirty;
    const saved = await saveDocument();
    if (saved && shouldRefresh) {
      onSaveSuccess();
    }
    return saved;
  }, [documentState.isDirty, onSaveSuccess, saveDocument]);

  const handleDiscard = useCallback(() => {
    discardDocument();
    onDirtyChange(false);
  }, [discardDocument, onDirtyChange]);

  useEffect(() => {
    onDraftActionsChange?.({
      save: handleSave,
      discard: handleDiscard,
      isSaving: documentState.isSaving,
    });
    return () => onDraftActionsChange?.(null);
  }, [documentState.isSaving, handleDiscard, handleSave, onDraftActionsChange]);

  const drafts = useMemo<CompareColumnDraft[]>(
    () => [
      {
        id: `previous:${filePath}`,
        label: filePath,
        title: t("files.editableDiff.previousVersion"),
        content: previousSource ?? documentState.content,
        isDirty: false,
        isSaving: false,
        isLoading: documentState.isLoading || !hasResolvedBaseline,
        error: baselineUnavailable ? t("git.diffUnavailable") : null,
        saveError: null,
        truncated: false,
        readOnlyReason: null,
        editable: false,
        onChange: () => {},
        onSave: () => false,
      },
      {
        id: filePath,
        label: filePath,
        title: t("files.editableDiff.sourceCode"),
        content: documentState.content,
        isDirty: documentState.isDirty,
        isSaving: documentState.isSaving,
        isLoading: documentState.isLoading,
        error: documentState.error,
        saveError: null,
        truncated: documentState.truncated,
        readOnlyReason: documentState.truncated
          ? t("files.fileCompare.truncatedReadOnly")
          : null,
        editable: !documentState.truncated && !documentState.error,
        onChange: documentState.setContent,
        onSave: handleSave,
      },
    ],
    [
      documentState.content,
      documentState.error,
      documentState.isDirty,
      documentState.isLoading,
      documentState.isSaving,
      documentState.setContent,
      documentState.truncated,
      filePath,
      hasResolvedBaseline,
      handleSave,
      baselineUnavailable,
      previousSource,
      t,
    ],
  );
  const markersByColumn = useMemo<GitLineMarkers[]>(
    () =>
      diffResult.changedLineNumbersByColumn.map((modified) => ({
        added: [],
        modified,
      })),
    [diffResult.changedLineNumbersByColumn],
  );
  const collapsedRangesByColumn = useMemo(
    () =>
      contentMode === "focused"
        ? drafts.map((draft, columnIndex) =>
            buildFocusedFileCompareRanges(
              draft.content,
              diffResult.changedLineNumbersByColumn[columnIndex] ?? [],
            ),
          )
        : drafts.map(() => []),
    [contentMode, diffResult.changedLineNumbersByColumn, drafts],
  );

  const handlePanelScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const sourceScroller = event.target;
    if (
      scrollSyncingRef.current ||
      !(sourceScroller instanceof HTMLElement) ||
      !sourceScroller.classList.contains("cm-scroller")
    ) {
      return;
    }
    const scrollers = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        ".file-compare-cm .cm-scroller",
      ),
    );
    scrollSyncingRef.current = true;
    for (const scroller of scrollers) {
      if (scroller !== sourceScroller) {
        scroller.scrollTop = sourceScroller.scrollTop;
      }
    }
    window.requestAnimationFrame(() => {
      scrollSyncingRef.current = false;
    });
  }, []);

  const differenceNavigator = (
    <div
      className={`editable-diff-compare-nav${headerControlsTarget ? " is-external" : ""}`}
      aria-live="polite"
    >
      <span>
        {canNavigateDifferences
          ? t("files.fileCompare.differenceCount", {
              current: activeDifferenceIndex + 1,
              total: diffResult.changedBlocks.length,
            })
          : t("files.fileCompare.noDifferences")}
      </span>
      <button
        type="button"
        className="ghost"
        onClick={() =>
          setActiveDifferenceIndex(
            (current) =>
              (current - 1 + diffResult.changedBlocks.length) %
              diffResult.changedBlocks.length,
          )
        }
        disabled={!canNavigateDifferences}
        aria-label={t("files.fileCompare.previousDifference")}
        title={t("files.fileCompare.previousDifference")}
      >
        <ChevronUp size={14} aria-hidden />
      </button>
      <button
        type="button"
        className="ghost"
        onClick={() =>
          setActiveDifferenceIndex(
            (current) => (current + 1) % diffResult.changedBlocks.length,
          )
        }
        disabled={!canNavigateDifferences}
        aria-label={t("files.fileCompare.nextDifference")}
        title={t("files.fileCompare.nextDifference")}
      >
        <ChevronDown size={14} aria-hidden />
      </button>
    </div>
  );

  return (
    <div
      className={`editable-diff-compare${headerControlsTarget ? " has-external-nav" : ""}`}
      onScrollCapture={handlePanelScroll}
    >
      {headerControlsTarget
        ? createPortal(differenceNavigator, headerControlsTarget)
        : differenceNavigator}
      <div
        className="file-compare-columns editable-diff-compare-columns"
        style={{ "--file-compare-column-count": "2" } as CSSProperties}
      >
        {drafts.map((draft, columnIndex) => (
          <CompareEditorColumn
            key={draft.id}
            draft={draft}
            editorTheme={editorTheme}
            markers={markersByColumn[columnIndex] ?? EMPTY_MARKERS}
            lineGaps={diffResult.gapLineCountsByColumn[columnIndex] ?? []}
            collapsedRanges={collapsedRangesByColumn[columnIndex] ?? []}
            saveFileShortcut="cmd+s"
            activeLineNumber={
              activeDifference?.lineNumbersByColumn[columnIndex] ?? null
            }
          />
        ))}
      </div>
    </div>
  );
}
