import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from "react";
import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import FileText from "lucide-react/dist/esm/icons/file-text";
import Globe from "lucide-react/dist/esm/icons/globe";
import Minus from "lucide-react/dist/esm/icons/minus";
import PanelRightOpen from "lucide-react/dist/esm/icons/panel-right-open";
import Plus from "lucide-react/dist/esm/icons/plus";
import Undo2 from "lucide-react/dist/esm/icons/undo-2";
import { Badge } from "@/components/ui/badge";
import { FloatingTooltipButton } from "@/components/ui/floating-tooltip-button";
import type { GitFileStatus } from "../../../types";
import { getFileTreeIconSvg } from "@/utils/fileTreeIcons";
import { isHtmlFilePath } from "../../files/utils/openHtmlInBrowser";
import { GitDiffPanelSectionActions } from "./GitDiffPanelSectionActions";
import {
  type InclusionState,
  InclusionToggle,
  getFileInclusionState,
  normalizeDiffPath,
} from "./GitDiffPanelInclusion";

export type DiffFile = GitFileStatus;

export function isDeletedDiffFile(file: Pick<DiffFile, "status">) {
  return file.status.trim().toUpperCase() === "D";
}

export const TREE_INDENT_STEP = 8;

export function DiffFolderRow({
  name,
  iconName = name,
  depth,
  collapsed,
  hasChildren = true,
  indentStep = TREE_INDENT_STEP,
  className = "",
  onToggle,
}: {
  name: string;
  iconName?: string;
  depth: number;
  collapsed: boolean;
  hasChildren?: boolean;
  indentStep?: number;
  className?: string;
  onToggle: () => void;
}) {
  const treeIndentPx = depth * indentStep;
  return (
    <div
      className={`diff-tree-folder-row git-filetree-folder-row ${className}`}
      style={{
        paddingLeft: `${treeIndentPx}px`,
        ["--git-tree-indent-x" as string]: `${Math.max(treeIndentPx - 5, 0)}px`,
        ["--git-tree-line-opacity" as string]: getTreeLineOpacity(depth),
      }}
      data-tree-depth={depth + 1}
      data-collapsed={hasChildren ? String(collapsed) : undefined}
      role="treeitem"
      tabIndex={0}
      aria-level={depth + 1}
      aria-label={name}
      aria-expanded={hasChildren ? !collapsed : undefined}
      onClick={() => hasChildren && onToggle()}
      onKeyDown={(event) => {
        if ((event.key === "Enter" || event.key === " ") && hasChildren) {
          event.preventDefault();
          onToggle();
        }
      }}
    >
      <span className="diff-tree-folder-toggle" aria-hidden>
        {hasChildren ? (collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />) : <span className="diff-tree-folder-spacer" />}
      </span>
      <GitFileTreeIcon name={iconName} isFolder isOpen={!collapsed} className="diff-tree-folder-icon" />
      <span className="diff-tree-folder-name">{name}</span>
    </div>
  );
}

/**
 * Git 面板文件/文件夹图标：复用项目文件树的彩色类型图标（getFileTreeIconSvg），
 * 让提交面板与文件树的图标视觉保持一致，替代原先的单色 FileIcon。
 */
export function GitFileTreeIcon({
  name,
  isFolder = false,
  isOpen = false,
  className,
}: {
  name: string;
  isFolder?: boolean;
  isOpen?: boolean;
  className?: string;
}) {
  const html = useMemo(
    () => getFileTreeIconSvg(name, isFolder, isOpen),
    [name, isFolder, isOpen],
  );
  return (
    <span
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
      aria-hidden
    />
  );
}

function splitPath(path: string) {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length === 0) {
    return { name: "", dir: "" };
  }
  if (parts.length === 1) {
    return { name: parts[0] ?? "", dir: "" };
  }
  return { name: parts[parts.length - 1], dir: parts.slice(0, -1).join("/") };
}

export function getTreeLineOpacity(depth: number): string {
  return depth === 1 ? "1" : "0";
}

function splitNameAndExtension(name: string) {
  const lastDot = name.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === name.length - 1) {
    return { base: name, extension: "" };
  }
  return {
    base: name.slice(0, lastDot),
    extension: name.slice(lastDot + 1).toLowerCase(),
  };
}

function getStatusLetter(status: string, section: "staged" | "unstaged") {
  switch (status) {
    case "A":
      return section === "unstaged" ? "U" : "A";
    case "M":
      return "M";
    case "D":
      return "D";
    case "R":
      return "R";
    case "T":
      return "T";
    default:
      return "?";
  }
}

function getStatusClass(status: string) {
  switch (status) {
    case "A":
      return "diff-icon-added";
    case "M":
      return "diff-icon-modified";
    case "D":
      return "diff-icon-deleted";
    case "R":
      return "diff-icon-renamed";
    case "T":
      return "diff-icon-typechange";
    default:
      return "diff-icon-unknown";
  }
}

type DiffFileRowProps = {
  file: DiffFile;
  className?: string;
  inclusionClassName?: string;
  statsClassName?: string;
  showStats?: boolean;
  isSelected: boolean;
  isActive: boolean;
  section: "staged" | "unstaged";
  inclusionState: InclusionState;
  inclusionDisabled?: boolean;
  indentLevel?: number;
  showDirectory?: boolean;
  treeItem?: boolean;
  treeDepth?: number;
  treeParentFolderKey?: string;
  onClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onKeySelect: () => void;
  onOpenInlinePreview?: () => void;
  onOpenPreview?: () => void;
  onOpenInBrowser?: () => void;
  onContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onStageFile?: (path: string) => Promise<void> | void;
  onUnstageFile?: (path: string) => Promise<void> | void;
  onDiscardFile?: (path: string) => Promise<void> | void;
  onSetCommitSelection?: (paths: string[], selected: boolean) => void;
};

export const DiffFileRow = memo(function DiffFileRow({
  file,
  className = "",
  inclusionClassName,
  statsClassName = "",
  showStats = false,
  isSelected,
  isActive,
  section,
  inclusionState,
  inclusionDisabled = false,
  indentLevel = 0,
  showDirectory = true,
  treeItem = false,
  treeDepth = 1,
  treeParentFolderKey,
  onClick,
  onKeySelect,
  onOpenInlinePreview,
  onOpenPreview,
  onOpenInBrowser,
  onContextMenu,
  onStageFile,
  onUnstageFile,
  onDiscardFile,
  onSetCommitSelection,
}: DiffFileRowProps) {
  const { t } = useTranslation();
  const { name, dir } = splitPath(file.path);
  const { base, extension } = splitNameAndExtension(name ?? "");
  const statusLetter = getStatusLetter(file.status, section);
  const statusClass = getStatusClass(file.status);
  const mutationDisabled = Boolean(file.mutationDisabled || file.isDiffOnlyFallback);
  const showStage = section === "unstaged" && Boolean(onStageFile) && !mutationDisabled;
  const showUnstage = section === "staged" && Boolean(onUnstageFile) && !mutationDisabled;
  const showDiscard = section === "unstaged" && Boolean(onDiscardFile) && !mutationDisabled;
  const showOpenInBrowser =
    Boolean(onOpenInBrowser) &&
    isHtmlFilePath(file.path) &&
    !isDeletedDiffFile(file);
  const inclusionLabel = t("git.commitSelectionToggleFile", { path: file.path });
  const treeIndentPx = indentLevel * TREE_INDENT_STEP;
  const treeRowStyle = treeItem
    ? ({
        paddingLeft: `${treeIndentPx}px`,
        ["--git-tree-indent-x" as string]: `${Math.max(treeIndentPx - 5, 0)}px`,
        ["--git-tree-line-opacity" as string]: getTreeLineOpacity(treeDepth - 1),
      } as CSSProperties)
    : undefined;

  return (
    <div
      className={`diff-row git-filetree-row${treeItem ? " git-filetree-row--tree" : ""} ${isActive ? "active" : ""} ${isSelected ? "selected" : ""} ${className}`}
      style={treeRowStyle}
      data-section={section}
      data-status={file.status}
      data-path={file.path}
      data-diff-only-fallback={file.isDiffOnlyFallback ? "true" : undefined}
      data-tree-depth={treeItem ? treeDepth : undefined}
      data-parent-folder-key={treeItem ? treeParentFolderKey : undefined}
      role={treeItem ? "treeitem" : "button"}
      tabIndex={0}
      aria-label={file.path}
      aria-selected={isActive}
      aria-level={treeItem ? treeDepth : undefined}
      onClick={onClick}
      onKeyDown={(event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest("button")) {
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onKeySelect();
        }
      }}
      onDoubleClick={(event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest("button")) {
          return;
        }
        onOpenPreview?.();
      }}
      onContextMenu={onContextMenu}
    >
      <span className={`diff-status-letter ${statusClass}`} aria-hidden>
        {statusLetter}
      </span>
      <span className="diff-file-icon" aria-hidden>
        <GitFileTreeIcon name={name ?? ""} />
      </span>
      <div className="diff-file" title={file.path}>
        <div className="diff-path">
          <span className="diff-name">
            <span className="diff-name-base">{base}</span>
            {extension && <span className="diff-name-ext">.{extension}</span>}
          </span>
        </div>
        {showDirectory && dir && <div className="diff-dir">{dir}</div>}
      </div>
      <div className="diff-row-meta">
        {showStats ? (
          <span
            className={`diff-counts-inline git-filetree-badge ${statsClassName}`}
            aria-label={`+${file.additions} -${file.deletions}`}
          >
            <span className="is-add">+{file.additions}</span>
            <span className="is-sep">/</span>
            <span className="is-del">-{file.deletions}</span>
          </span>
        ) : null}
        <div className="diff-row-actions" role="group" aria-label={t("git.fileActions")}>
          {showOpenInBrowser ? (
            <FloatingTooltipButton
              type="button"
              className="diff-row-action diff-row-action--open-browser"
              tooltipLabel={t("files.openInBrowser")}
              tooltipSide="bottom"
              tooltipAlign="end"
              tooltipDelay={180}
              aria-label={t("files.openInBrowser")}
              onClick={(event) => {
                event.stopPropagation();
                onOpenInBrowser?.();
              }}
            >
              <Globe size={12} aria-hidden />
            </FloatingTooltipButton>
          ) : null}
          {onOpenInlinePreview ? (
            <FloatingTooltipButton
              type="button"
              className="diff-row-action diff-row-action--preview-inline"
              tooltipLabel={t("git.previewInline")}
              tooltipSide="bottom"
              tooltipAlign="end"
              tooltipDelay={180}
              aria-label={t("git.previewInlineAction")}
              onClick={(event) => {
                event.stopPropagation();
                onOpenInlinePreview();
              }}
            >
              <PanelRightOpen size={12} aria-hidden />
            </FloatingTooltipButton>
          ) : null}
          {onOpenPreview && !isDeletedDiffFile(file) ? (
            <FloatingTooltipButton
              type="button"
              className="diff-row-action diff-row-action--preview-modal"
              tooltipLabel={t("git.openFileContent")}
              tooltipSide="bottom"
              tooltipAlign="end"
              tooltipDelay={180}
              aria-label={t("git.openFileContentAction")}
              onClick={(event) => {
                event.stopPropagation();
                onOpenPreview();
              }}
            >
              <FileText size={12} aria-hidden />
            </FloatingTooltipButton>
          ) : null}
          {showStage && (
            <FloatingTooltipButton
              type="button"
              className="diff-row-action diff-row-action--stage"
              tooltipLabel={t("git.stageChanges")}
              tooltipSide="bottom"
              tooltipAlign="end"
              tooltipDelay={180}
              aria-label={t("git.stageFile")}
              onClick={(event) => {
                event.stopPropagation();
                void onStageFile?.(file.path);
              }}
            >
              <Plus size={12} aria-hidden />
            </FloatingTooltipButton>
          )}
          {showUnstage && (
            <FloatingTooltipButton
              type="button"
              className="diff-row-action diff-row-action--unstage"
              tooltipLabel={t("git.unstageChanges")}
              tooltipSide="bottom"
              tooltipAlign="end"
              tooltipDelay={180}
              aria-label={t("git.unstageFile")}
              onClick={(event) => {
                event.stopPropagation();
                void onUnstageFile?.(file.path);
              }}
            >
              <Minus size={12} aria-hidden />
            </FloatingTooltipButton>
          )}
          {showDiscard && (
            <FloatingTooltipButton
              type="button"
              className="diff-row-action diff-row-action--discard"
              tooltipLabel={t("git.discardChanges")}
              tooltipSide="bottom"
              tooltipAlign="end"
              tooltipDelay={180}
              aria-label={t("git.discardChange")}
              onClick={(event) => {
                event.stopPropagation();
                void onDiscardFile?.(file.path);
              }}
            >
              <Undo2 size={12} aria-hidden />
            </FloatingTooltipButton>
          )}
        </div>
        {!mutationDisabled ? (
          <InclusionToggle
            state={inclusionState}
            label={inclusionLabel}
            className={inclusionClassName}
            disabled={inclusionDisabled}
            stopPropagation
            onToggle={() => {
              void onSetCommitSelection?.([file.path], inclusionState !== "all");
            }}
          />
        ) : null}
      </div>
    </div>
  );
});

export type DiffSectionProps = {
  title: string;
  files: DiffFile[];
  section: "staged" | "unstaged";
  includedPaths: string[];
  excludedPaths: string[];
  partialPaths: string[];
  rootFolderName?: string;
  rootTrailingAction?: ReactNode;
  leadingMeta?: ReactNode;
  compactHeader?: boolean;
  isCollapsed?: boolean;
  onToggleCollapsed?: () => void;
  selectedFiles: Set<string>;
  selectedPath: string | null;
  onActivateFile?: (
    path: string,
    section: "staged" | "unstaged",
  ) => void;
  onStageAllChanges?: () => Promise<void> | void;
  onStageFile?: (path: string) => Promise<void> | void;
  onUnstageAllChanges?: () => Promise<void> | void;
  onUnstageFile?: (path: string) => Promise<void> | void;
  onUnstageFiles?: (paths: string[]) => Promise<void> | void;
  onDiscardFile?: (path: string) => Promise<void> | void;
  onDiscardFiles?: (paths: string[]) => Promise<void> | void;
  isCommitPathLocked?: (path: string) => boolean;
  onSetCommitSelection?: (paths: string[], selected: boolean) => void;
  onFileClick: (
    event: ReactMouseEvent<HTMLDivElement>,
    path: string,
    section: "staged" | "unstaged",
  ) => void;
  onOpenInlinePreview?: (path: string) => void;
  onOpenFilePreview?: (
    file: DiffFile,
    section: "staged" | "unstaged",
  ) => void;
  onOpenInBrowser?: (path: string) => void;
  onShowFileMenu: (
    event: ReactMouseEvent<HTMLDivElement>,
    path: string,
    section: "staged" | "unstaged",
  ) => void;
};

export function renderSectionIndicator(
  section: "staged" | "unstaged",
  count: number,
  t: (key: string, options?: Record<string, unknown>) => string,
  isCollapsed = false,
  onToggleCollapsed?: () => void,
) {
  const label = section === "staged" ? t("git.staged") : t("git.unstaged");
  const className = `diff-section-indicator is-${section}`;
  const content = (
    <>
      <span className="diff-section-indicator-chevron" aria-hidden>
        {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
      </span>
      <span className="diff-section-indicator-label">{label}</span>
    </>
  );
  if (onToggleCollapsed) {
    return (
      <button
        type="button"
        className={className}
        aria-label={`${label} (${count})`}
        aria-expanded={!isCollapsed}
        title={label}
        onClick={(event) => {
          event.stopPropagation();
          onToggleCollapsed();
        }}
      >
        {content}
      </button>
    );
  }
  return (
    <span className={className} aria-label={`${label} (${count})`} title={label}>
      {content}
    </span>
  );
}

export function renderSectionCountBadge(count: number) {
  return (
    <Badge
      variant="secondary"
      size="sm"
      className="diff-section-count-badge"
      aria-hidden
    >
      {count}
    </Badge>
  );
}
export function renderSectionLineStatsBadge(additions: number, deletions: number) {
  if (additions <= 0 && deletions <= 0) {
    return null;
  }
  return (
    <span
      className="diff-counts-inline git-filetree-badge diff-section-line-stats-badge"
      aria-label={`+${additions} -${deletions}`}
    >
      <span className="is-add">+{additions}</span>
      <span className="is-sep" aria-hidden>/</span>
      <span className="is-del">-{deletions}</span>
    </span>
  );
}


export function DiffSection({
  title,
  files,
  section,
  includedPaths,
  excludedPaths,
  partialPaths,
  rootTrailingAction,
  leadingMeta,
  compactHeader = false,
  isCollapsed = false,
  onToggleCollapsed,
  selectedFiles,
  selectedPath,
  onActivateFile,
  onStageAllChanges,
  onStageFile,
  onUnstageAllChanges,
  onUnstageFile,
  onUnstageFiles,
  onDiscardFile,
  onDiscardFiles,
  isCommitPathLocked,
  onSetCommitSelection,
  onFileClick,
  onOpenInlinePreview,
  onOpenFilePreview,
  onOpenInBrowser,
  onShowFileMenu,
}: DiffSectionProps) {
  const { t } = useTranslation();
  const normalizedIncludedPaths = useMemo(
    () => includedPaths.map((path) => normalizeDiffPath(path)),
    [includedPaths],
  );
  const normalizedExcludedPaths = useMemo(
    () => excludedPaths.map((path) => normalizeDiffPath(path)),
    [excludedPaths],
  );
  const normalizedPartialPaths = useMemo(
    () => partialPaths.map((path) => normalizeDiffPath(path)),
    [partialPaths],
  );
  const includedPathSet = useMemo(
    () => new Set(normalizedIncludedPaths),
    [normalizedIncludedPaths],
  );
  const excludedPathSet = useMemo(
    () => new Set(normalizedExcludedPaths),
    [normalizedExcludedPaths],
  );
  const partialPathSet = useMemo(
    () => new Set(normalizedPartialPaths),
    [normalizedPartialPaths],
  );
  const actionFilePaths = useMemo(
    () =>
      files
        .filter((file) => !file.mutationDisabled && !file.isDiffOnlyFallback)
        .map((file) => file.path),
    [files],
  );
  const toggleableFilePaths = useMemo(
    () =>
      files
        .filter((file) => !file.mutationDisabled && !file.isDiffOnlyFallback)
        .map((file) => file.path)
        .filter((path) => !isCommitPathLocked?.(path)),
    [files, isCommitPathLocked],
  );
  const sectionInclusionState = useMemo(() => {
    if (files.length === 0) {
      return "none";
    }
    const fileStates = files.map((file) =>
      getFileInclusionState(
        file.path,
        includedPathSet,
        excludedPathSet,
        partialPathSet,
      ),
    );
    if (fileStates.every((state) => state === "all")) {
      return "all";
    }
    if (fileStates.every((state) => state === "none")) {
      return "none";
    }
    return "partial";
  }, [excludedPathSet, files, includedPathSet, partialPathSet]);
  const sectionLineStats = useMemo(() => files.reduce(
    (acc, file) => ({
      additions: acc.additions + (file.additions ?? 0),
      deletions: acc.deletions + (file.deletions ?? 0),
    }),
    { additions: 0, deletions: 0 },
  ), [files]);
  const showSectionActions =
    toggleableFilePaths.length > 0 || actionFilePaths.length > 0;

  return (
    <div
      className={`diff-section git-filetree-section diff-section--${section}${
        isCollapsed ? " is-collapsed" : ""
      }`}
    >
      <div
        className={`diff-section-title diff-section-title--row git-filetree-section-header${
          compactHeader ? " is-compact" : ""
        }`}
      >
        <span className="diff-tree-summary-section-label">
          {renderSectionIndicator(
            section,
            files.length,
            t,
            isCollapsed,
            onToggleCollapsed,
          )}
        </span>
        {!isCollapsed && rootTrailingAction ? (
          <span className="diff-tree-summary-root-action">{rootTrailingAction}</span>
        ) : null}
        {!isCollapsed && leadingMeta ? (
          <span className="diff-tree-summary-meta">{leadingMeta}</span>
        ) : null}
        {!isCollapsed && showSectionActions && (
          <GitDiffPanelSectionActions
            title={title}
            section={section}
            sectionInclusionState={sectionInclusionState}
            toggleableFilePaths={toggleableFilePaths}
            filePaths={actionFilePaths}
            onSetCommitSelection={onSetCommitSelection}
            onStageAllChanges={
              actionFilePaths.length === files.length ? onStageAllChanges : undefined
            }
            onStageFile={onStageFile}
            onUnstageAllChanges={
              actionFilePaths.length === files.length ? onUnstageAllChanges : undefined
            }
            onUnstageFile={onUnstageFile}
            onUnstageFiles={onUnstageFiles}
            onDiscardFiles={onDiscardFiles}
          />
        )}
        {renderSectionLineStatsBadge(sectionLineStats.additions, sectionLineStats.deletions)}
        {renderSectionCountBadge(files.length)}
      </div>
      {!isCollapsed ? (
        <div className="diff-section-list git-filetree-list">
          {files.map((file) => {
            const isSelected =
              selectedFiles.size > 1 && selectedFiles.has(file.path);
            const isActive = selectedPath === file.path;
            return (
              <DiffFileRow
                key={`${section}-${file.path}`}
                file={file}
                isSelected={isSelected}
                isActive={isActive}
                section={section}
                inclusionState={getFileInclusionState(
                  file.path,
                  includedPathSet,
                  excludedPathSet,
                  partialPathSet,
                )}
                inclusionDisabled={Boolean(
                  file.mutationDisabled ||
                    file.isDiffOnlyFallback ||
                    isCommitPathLocked?.(file.path),
                )}
                onClick={(event) => onFileClick(event, file.path, section)}
                onKeySelect={() => onActivateFile?.(file.path, section)}
                onOpenInlinePreview={
                  onOpenInlinePreview
                    ? () => onOpenInlinePreview(file.path)
                    : undefined
                }
                onOpenPreview={
                  onOpenFilePreview
                    ? () => onOpenFilePreview(file, section)
                    : undefined
                }
                onOpenInBrowser={
                  onOpenInBrowser
                    ? () => onOpenInBrowser(file.path)
                    : undefined
                }
                onContextMenu={(event) =>
                  onShowFileMenu(event, file.path, section)
                }
                onStageFile={onStageFile}
                onUnstageFile={onUnstageFile}
                onDiscardFile={onDiscardFile}
                onSetCommitSelection={onSetCommitSelection}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
