import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import FileIcon from "../../../components/FileIcon";
import { UnsavedChangesDialog } from "../../../components/ui/UnsavedChangesDialog";
import { getGitFileFullDiff } from "../../../services/tauri";
import { computeDiffFromUnifiedPatch } from "../../../utils/diff";
import { resolveFileRenderProfile } from "@/utils/fileRenderProfile";
import {
  resolveFileReadTarget,
  resolveWorkspaceRelativePath,
} from "../../../utils/workspacePaths";
import { GitDiffViewer } from "./GitDiffViewer";
import {
  WorkspaceEditableDiffCompare,
  type EditableDiffDraftActions,
} from "./WorkspaceEditableDiffCompare";
import { WorkspaceReadOnlyDiffCompare } from "./WorkspaceReadOnlyDiffCompare";
import type {
  CodeAnnotationDraftInput,
  CodeAnnotationSelection,
} from "../../code-annotations/types";
import {
  normalizeDiffPresentationEntry,
  type DiffPresentationEntry,
} from "../utils/diffPresentationModel";

export type EditableDiffReviewFile = DiffPresentationEntry & {
  workspaceRelativeFilePath?: string;
  additions: number;
  deletions: number;
};

type NormalizedEditableDiffReviewFile = EditableDiffReviewFile & {
  reviewPath: string;
  reviewFileName: string;
};

type WorkspaceEditableDiffReviewSurfaceProps = {
  workspaceId: string | null;
  workspacePath?: string | null;
  files: EditableDiffReviewFile[];
  selectedPath?: string | null;
  onSelectedPathChange?: (path: string) => void;
  diffStyle?: "split" | "unified";
  onDiffStyleChange?: (style: "split" | "unified") => void;
  onRequestClose?: (() => void) | null;
  headerControlsTarget?: HTMLElement | null;
  fullDiffSourceKey?: string | null;
  fullDiffLoader?: ((path: string) => Promise<string>) | null;
  embeddedAnchorVariant?: "default" | "modal-pager";
  stickyHeaderMode?: "full" | "controls-only";
  toolbarLayout?: "stacked" | "inline-actions";
  showSidebar?: boolean;
  focusSelectedFileOnly?: boolean;
  allowEditing?: boolean;
  readOnlyAlignedCompare?: boolean;
  onRequestRefreshReview?: (() => void | Promise<void>) | null;
  onRequestGitStatusRefresh?: (() => void) | null;
  onDirtyChange?: (isDirty: boolean) => void;
  onDraftActionsChange?: (actions: EditableDiffDraftActions | null) => void;
  onCreateCodeAnnotation?: (annotation: CodeAnnotationDraftInput) => void;
  onRemoveCodeAnnotation?: (annotationId: string) => void;
  codeAnnotations?: CodeAnnotationSelection[];
  codeAnnotationSurface?: "embedded-diff-view" | "modal-diff-view";
};

function canEditReviewFile(
  file: NormalizedEditableDiffReviewFile | null,
  workspacePath: string | null,
  allowEditing: boolean,
) {
  if (!allowEditing || !file || file.status.toUpperCase() === "D") {
    return false;
  }
  const fileReadTarget = resolveFileReadTarget(
    workspacePath,
    file.workspaceRelativeFilePath ?? file.reviewPath,
  );
  if (fileReadTarget.domain !== "workspace") {
    return false;
  }
  const renderProfile = resolveFileRenderProfile(file.reviewPath);
  return renderProfile.editCapability !== "read-only";
}

function resolveReadOnlyHint(
  t: ReturnType<typeof useTranslation>["t"],
  file: NormalizedEditableDiffReviewFile | null,
  editable: boolean,
) {
  if (editable) {
    return null;
  }
  if (!file) {
    return null;
  }
  if (file.status.toUpperCase() === "D") {
    return t("files.readOnly");
  }
  const renderProfile = resolveFileRenderProfile(file.reviewPath);
  if (renderProfile.editCapability === "read-only") {
    return t("files.readOnly");
  }
  return t("files.readOnly");
}

export function WorkspaceEditableDiffReviewSurface({
  workspaceId,
  workspacePath = null,
  files,
  selectedPath = null,
  onSelectedPathChange,
  diffStyle = "split",
  onDiffStyleChange,
  onRequestClose = null,
  headerControlsTarget = null,
  fullDiffSourceKey = null,
  fullDiffLoader = null,
  embeddedAnchorVariant = "default",
  stickyHeaderMode = "full",
  toolbarLayout = "stacked",
  showSidebar = false,
  focusSelectedFileOnly = false,
  allowEditing = false,
  readOnlyAlignedCompare = false,
  onRequestRefreshReview = null,
  onRequestGitStatusRefresh = null,
  onDirtyChange,
  onDraftActionsChange,
  onCreateCodeAnnotation,
  onRemoveCodeAnnotation,
  codeAnnotations = [],
  codeAnnotationSurface = "embedded-diff-view",
}: WorkspaceEditableDiffReviewSurfaceProps) {
  const { t } = useTranslation();
  const normalizedFiles = useMemo<NormalizedEditableDiffReviewFile[]>(
    () =>
      files.map((file) => {
        const normalized = normalizeDiffPresentationEntry(file, (filePath) =>
          resolveWorkspaceRelativePath(workspacePath, filePath),
        );
        return {
          ...normalized,
          reviewPath: normalized.presentationPath,
          reviewFileName: normalized.presentationFileName,
        };
      }),
    [files, workspacePath],
  );
  const [reviewFiles, setReviewFiles] = useState<NormalizedEditableDiffReviewFile[]>(normalizedFiles);
  const [localSelectedPath, setLocalSelectedPath] = useState<string | null>(
    selectedPath ?? normalizedFiles[0]?.reviewPath ?? null,
  );
  const [isDirty, setIsDirty] = useState(false);
  const [contentMode, setContentMode] = useState<"all" | "focused">("all");
  const effectiveContentMode = readOnlyAlignedCompare ? "focused" : contentMode;
  const [pendingDiscardAction, setPendingDiscardAction] = useState<(() => void) | null>(null);
  const [isDraftSaving, setIsDraftSaving] = useState(false);
  const draftActionsRef = useRef<EditableDiffDraftActions | null>(null);

  useEffect(() => {
    setReviewFiles(normalizedFiles);
  }, [normalizedFiles]);

  useEffect(() => {
    if (selectedPath != null) {
      setLocalSelectedPath(selectedPath);
      return;
    }
    setLocalSelectedPath((current) => {
      if (current && normalizedFiles.some((file) => file.reviewPath === current)) {
        return current;
      }
      return normalizedFiles[0]?.reviewPath ?? null;
    });
  }, [normalizedFiles, selectedPath]);

  useEffect(() => {
    setContentMode("all");
  }, [selectedPath]);

  const activeReviewPath = selectedPath ?? localSelectedPath;
  const activeFile =
    reviewFiles.find((file) => file.reviewPath === activeReviewPath)
    ?? reviewFiles[0]
    ?? null;
  const canEdit = canEditReviewFile(activeFile, workspacePath, allowEditing);
  const readOnlyHint = resolveReadOnlyHint(t, activeFile, canEdit);
  const visibleDiffs = useMemo(() => {
    if (!focusSelectedFileOnly || !activeFile) {
      return reviewFiles.map((file) => ({
        path: file.reviewPath,
        status: file.status,
        diff: file.diff,
        isImage: file.isImage,
        oldImageData: file.oldImageData,
        newImageData: file.newImageData,
        oldImageMime: file.oldImageMime,
        newImageMime: file.newImageMime,
      }));
    }
    return [
      {
        path: activeFile.reviewPath,
        status: activeFile.status,
        diff: activeFile.diff,
        isImage: activeFile.isImage,
        oldImageData: activeFile.oldImageData,
        newImageData: activeFile.newImageData,
        oldImageMime: activeFile.oldImageMime,
        newImageMime: activeFile.newImageMime,
      },
    ];
  }, [activeFile, focusSelectedFileOnly, reviewFiles]);

  const handleSelectPath = useCallback(
    (nextPath: string) => {
      if (nextPath === activeReviewPath) {
        return;
      }
      const selectPath = () => {
        setContentMode("all");
        setLocalSelectedPath(nextPath);
        onSelectedPathChange?.(nextPath);
      };
      if (isDirty) {
        setPendingDiscardAction(() => selectPath);
        return;
      }
      selectPath();
    },
    [activeReviewPath, isDirty, onSelectedPathChange],
  );

  const handleRefreshActiveFile = useCallback(async () => {
    if (!workspaceId || !activeFile) {
      return;
    }
    try {
      const diff = await getGitFileFullDiff(workspaceId, activeFile.reviewPath);
      const stats = computeDiffFromUnifiedPatch(diff);
      setReviewFiles((current) =>
        current.map((file) =>
          file.reviewPath === activeFile.reviewPath
            ? {
                ...file,
                diff,
                additions: stats.additions,
                deletions: stats.deletions,
              }
            : file,
        ),
      );
    } catch {
      setReviewFiles((current) =>
        current.map((file) =>
          file.reviewPath === activeFile.reviewPath
            ? {
                ...file,
                diff: "",
                additions: 0,
                deletions: 0,
              }
            : file,
        ),
      );
    }
  }, [activeFile, workspaceId]);

  const handleSaveSuccess = useCallback(() => {
    setIsDirty(false);
    onDirtyChange?.(false);
    void handleRefreshActiveFile();
    void onRequestRefreshReview?.();
    onRequestGitStatusRefresh?.();
  }, [handleRefreshActiveFile, onDirtyChange, onRequestGitStatusRefresh, onRequestRefreshReview]);

  const handleDirtyChange = useCallback((nextIsDirty: boolean) => {
    setIsDirty(nextIsDirty);
    onDirtyChange?.(nextIsDirty);
  }, [onDirtyChange]);

  const handleDraftActionsChange = useCallback((actions: EditableDiffDraftActions | null) => {
    draftActionsRef.current = actions;
    setIsDraftSaving(actions?.isSaving ?? false);
    onDraftActionsChange?.(actions);
  }, [onDraftActionsChange]);

  const handleRequestClose = useCallback(() => {
    onRequestClose?.();
  }, [onRequestClose]);

  const requestViewModeChange = useCallback((changeMode: () => void) => {
    if (!isDirty) {
      changeMode();
      return;
    }
    setPendingDiscardAction(() => changeMode);
  }, [isDirty]);

  const handleDiffStyleChange = useCallback((style: "split" | "unified") => {
    if (style === diffStyle) {
      return;
    }
    requestViewModeChange(() => onDiffStyleChange?.(style));
  }, [diffStyle, onDiffStyleChange, requestViewModeChange]);

  const handleContentModeChange = useCallback((_path: string, mode: "all" | "focused") => {
    if (mode === contentMode) {
      return;
    }
    requestViewModeChange(() => setContentMode(mode));
  }, [contentMode, requestViewModeChange]);

  const handleDiscardPendingAction = useCallback(() => {
    const action = pendingDiscardAction;
    draftActionsRef.current?.discard();
    setPendingDiscardAction(null);
    setIsDirty(false);
    onDirtyChange?.(false);
    action?.();
  }, [onDirtyChange, pendingDiscardAction]);

  const handleSavePendingAction = useCallback(async () => {
    const action = pendingDiscardAction;
    const saved = await draftActionsRef.current?.save();
    if (!saved) {
      return false;
    }
    setPendingDiscardAction(null);
    action?.();
    return true;
  }, [pendingDiscardAction]);

  const shouldShowSidebar = showSidebar && reviewFiles.length > 1;
  const shouldInlineToolbarActions = toolbarLayout === "inline-actions" && Boolean(headerControlsTarget);
  const shouldShowAlignedCompare =
    Boolean(activeFile)
    && diffStyle === "split"
    && canEdit;
  const toolbarActions = (
    <div className="editable-diff-review-toolbar-actions">
      {!canEdit && readOnlyHint ? (
        <span className="editable-diff-review-readonly-hint">{readOnlyHint}</span>
      ) : null}
    </div>
  );

  return (
    <div className={`editable-diff-review-surface${shouldShowSidebar ? " has-sidebar" : ""}${shouldInlineToolbarActions ? " is-toolbar-inline-actions" : ""}`}>
      {shouldInlineToolbarActions && headerControlsTarget
        ? createPortal(toolbarActions, headerControlsTarget)
        : (
            <div className="editable-diff-review-toolbar">
              <div className="editable-diff-review-toolbar-copy">
                <span className="editable-diff-review-toolbar-kicker">
                  {canEdit ? t("files.editableDiff.title") : t("git.previewModalAction")}
                </span>
                <span className="editable-diff-review-toolbar-title">
                  {activeFile?.reviewPath ?? t("git.diffUnavailable")}
                </span>
              </div>
              {toolbarActions}
            </div>
          )}
      <div className="editable-diff-review-layout">
        <div className="editable-diff-review-main">
          <div className={shouldShowAlignedCompare ? "editable-diff-review-viewer is-toolbar-only" : "editable-diff-review-viewer"}>
            <GitDiffViewer
              workspaceId={workspaceId}
              diffs={visibleDiffs}
              selectedPath={activeFile?.reviewPath ?? null}
              isLoading={false}
              error={null}
              listView="flat"
              stickyHeaderMode={stickyHeaderMode}
              embeddedAnchorVariant={embeddedAnchorVariant}
              showContentModeControls
              showAllContentControl={!readOnlyAlignedCompare}
              toolbarOnly={shouldShowAlignedCompare}
              headerControlsTarget={headerControlsTarget}
              onRequestClose={handleRequestClose}
              fullDiffSourceKey={fullDiffSourceKey}
              fullDiffLoader={readOnlyAlignedCompare ? null : fullDiffLoader}
              diffStyle={diffStyle}
              onDiffStyleChange={handleDiffStyleChange}
              contentMode={effectiveContentMode}
              initialContentMode="all"
              onContentModeChange={handleContentModeChange}
              onActivePathChange={focusSelectedFileOnly ? undefined : handleSelectPath}
              onCreateCodeAnnotation={onCreateCodeAnnotation}
              onRemoveCodeAnnotation={onRemoveCodeAnnotation}
              codeAnnotations={codeAnnotations}
              codeAnnotationSurface={codeAnnotationSurface}
            />
          </div>
          {shouldShowAlignedCompare && activeFile ? (
            canEdit && workspaceId && workspacePath ? (
              <WorkspaceEditableDiffCompare
                workspaceId={workspaceId}
                workspacePath={workspacePath}
                filePath={activeFile.reviewPath}
                workspaceFilePath={activeFile.workspaceRelativeFilePath}
                diff={activeFile.diff}
                fullDiffLoader={fullDiffLoader}
                contentMode={effectiveContentMode}
                onSaveSuccess={handleSaveSuccess}
                onDirtyChange={handleDirtyChange}
                onDraftActionsChange={handleDraftActionsChange}
                headerControlsTarget={headerControlsTarget}
              />
            ) : (
              <WorkspaceReadOnlyDiffCompare
                filePath={activeFile.reviewPath}
                diff={activeFile.diff}
                loadFullDiff={fullDiffLoader}
                useFullDiff={effectiveContentMode === "all"}
                headerControlsTarget={headerControlsTarget}
              />
            )
          ) : null}
        </div>
        {shouldShowSidebar ? (
          <aside className="editable-diff-review-sidebar">
            <div className="editable-diff-review-sidebar-title-row">
              <div className="editable-diff-review-sidebar-title">
                {t("statusPanel.checkpoint.fileDetailsTitle")}
              </div>
              <div className="editable-diff-review-sidebar-count">{reviewFiles.length}</div>
            </div>
            <div className="editable-diff-review-sidebar-list">
              {reviewFiles.map((file) => {
                const selected = file.reviewPath === activeFile?.reviewPath;
                return (
                  <button
                    key={file.reviewPath}
                    type="button"
                    className={`editable-diff-review-sidebar-item${selected ? " is-active" : ""}`}
                    onClick={() => handleSelectPath(file.reviewPath)}
                  >
                    <span className={`git-history-file-status git-status-${file.status.toLowerCase()}`}>
                      {file.status}
                    </span>
                    <span className="editable-diff-review-sidebar-icon" aria-hidden>
                      <FileIcon filePath={file.reviewPath} />
                    </span>
                    <span className="editable-diff-review-sidebar-name">{file.reviewFileName}</span>
                    <span className="editable-diff-review-sidebar-stats">
                      <span className="is-add">+{file.additions}</span>
                      <span className="is-del">-{file.deletions}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>
        ) : null}
      </div>
      <UnsavedChangesDialog
        open={pendingDiscardAction !== null}
        isSaving={isDraftSaving}
        onContinueEditing={() => setPendingDiscardAction(null)}
        onDiscard={handleDiscardPendingAction}
        onSaveAndClose={handleSavePendingAction}
      />
    </div>
  );
}
