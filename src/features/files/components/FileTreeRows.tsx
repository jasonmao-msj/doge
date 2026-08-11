import type { DragEvent, MouseEvent } from "react";
import type { TFunction } from "i18next";
import type { GitRepositorySummary } from "../../../types";
import Globe from "lucide-react/dist/esm/icons/globe";
import Plus from "lucide-react/dist/esm/icons/plus";
import { getFileTreeIconSvg } from "../utils/fileTreeIcons";
import { isHtmlFilePath } from "../utils/openHtmlInBrowser";
import {
  gitRepositoryStatusItems,
  gitRepositoryStatusTokens,
} from "../../git/utils/gitRepositorySummary";
import type { DetachedFileTreeDragBridgePayload } from "../detachedFileTreeDragBridge";
import {
  bindChatDropTargetsForTreeDrag,
  clearFileTreeDragBridge,
  createWindowsFileTreeDragImage,
  insertPathsIntoChat,
  isWindowsDragPreviewRuntime,
  setFileTreeDragBridge,
  setFileTreeDragPosition,
  triggerChatInputInsertFromTreeDrag,
} from "../utils/fileTreeDragBridge";
import {
  isDirectlyGitignoredFolderPath,
  type FileTreeNode,
  type VisibleFileTreeRow,
} from "./fileTreePanelInternals";

type MutableRef<T> = {
  current: T;
};

export type FileTreeRowState = {
  expandedFolders: Set<string>;
  loadingLazyDirectories: Set<string>;
  lazyDirectoryLoadErrors: Map<string, string>;
  folderGitStatusMap: Map<string, string>;
  gitStatusMap: Map<string, string>;
  mergedGitignoredDirectories: Set<string>;
  mergedGitignoredFiles: Set<string>;
  gitignoredTreeNodeMap: Map<string, boolean>;
  selectedNodePaths: Set<string>;
  selectedNodePath: string | null;
  orderedSelectedNodePaths: string[];
  repositorySummaryMap: Map<string, GitRepositorySummary>;
};

export type FileTreeRowHandlers = {
  setRangeSelection: (path: string, type: "file" | "folder") => void;
  togglePathSelection: (path: string, type: "file" | "folder") => void;
  setSingleSelection: (path: string, type: "file" | "folder") => void;
  setSelectedNodePath: (path: string) => void;
  setSelectedNodeType: (type: "file" | "folder") => void;
  toggleFolderExpandedState: (path: string, isLazyFolder: boolean) => void;
  loadLazyDirectoryChildren: (path: string) => void;
  openPreview: (path: string, target: HTMLElement) => void;
  showContextMenu: (
    event: MouseEvent<HTMLButtonElement>,
    relativePath: string,
    isFolder: boolean,
  ) => void;
  resolvePath: (relativePath: string) => string;
  broadcastCrossWindowTreeDrag: (payload: DetachedFileTreeDragBridgePayload) => void;
  rebroadcastCrossWindowTreeDrag: () => void;
  onOpenFile?: (path: string) => void;
  onInsertText?: (text: string) => void;
  onOpenInBrowser?: (relativePath: string) => void;
};

export type FileTreeRowRefs = {
  activeCrossWindowDragPathsRef: MutableRef<string[]>;
  lastCrossWindowDragBroadcastRef: MutableRef<number>;
  dragImageCleanupRef: MutableRef<(() => void) | null>;
};

type FileTreeRowsSharedProps = {
  state: FileTreeRowState;
  handlers: FileTreeRowHandlers;
  refs: FileTreeRowRefs;
  t: TFunction;
};

type FileTreeNodeRowProps = FileTreeRowsSharedProps & {
  node: FileTreeNode;
  depth: number;
};

function getFileTreeRowMetadata(node: FileTreeNode, state: FileTreeRowState) {
  const isFolder = node.type === "folder";
  const isLazyFolder = isFolder && (node.isLazyLoadable ?? false);
  const hasChildren = isFolder && node.children.length > 0;
  const canExpand = isFolder && (hasChildren || isLazyFolder);
  const isExpanded = canExpand && state.expandedFolders.has(node.path);
  const rawGitStatus = isFolder
    ? state.folderGitStatusMap.get(node.path) ?? null
    : state.gitStatusMap.get(node.path) ?? null;
  const fileGitStatus =
    isFolder && rawGitStatus?.toUpperCase() === "D"
      ? "M"
      : rawGitStatus;
  const gitStatusClass = fileGitStatus
    ? ` git-${fileGitStatus.toLowerCase()}`
    : "";
  const isGitignored = isFolder
    ? isDirectlyGitignoredFolderPath(node.path, state.mergedGitignoredDirectories) ||
      state.gitignoredTreeNodeMap.get(node.path) === true
    : state.mergedGitignoredFiles.has(node.path);
  const isSelected = state.selectedNodePaths.has(node.path);
  const isPrimarySelection = state.selectedNodePath === node.path;
  const repositorySummary = isFolder
    ? state.repositorySummaryMap.get(node.path) ?? null
    : null;

  return {
    isFolder,
    isLazyFolder,
    hasChildren,
    canExpand,
    isExpanded,
    gitStatusClass,
    isGitignored,
    isSelected,
    isPrimarySelection,
    repositorySummary,
  };
}

function GitRepositoryStatus({ repository }: { repository: GitRepositorySummary }) {
  const statusTokens = gitRepositoryStatusTokens(repository);
  const statusItems = gitRepositoryStatusItems(repository, statusTokens);
  return (
    <span
      className="file-tree-git-summary"
      aria-label={`${repository.displayName} Git ${statusTokens.join(" ")}`}
      title={repository.error ?? repository.upstream ?? undefined}
    >
      {statusItems.map((item, index) => (
        <span
          key={`${item.label}:${index}`}
          className={`file-tree-git-token is-${item.kind}`}
        >
          {item.label}
        </span>
      ))}
    </span>
  );
}

function FileTreeNodeRow({
  node,
  depth,
  state,
  handlers,
  refs,
  t,
}: FileTreeNodeRowProps) {
  const row = getFileTreeRowMetadata(node, state);

  const handleDragStart = (event: DragEvent<HTMLButtonElement>) => {
    const dragSourcePaths = row.isSelected
      ? state.orderedSelectedNodePaths
      : [node.path];
    const uniqueSourcePaths = Array.from(new Set(dragSourcePaths));
    if (uniqueSourcePaths.length === 0) {
      return;
    }
    if (!row.isSelected) {
      handlers.setSingleSelection(node.path, node.type);
    }
    if (
      typeof window !== "undefined" &&
      (window.__fileTreeDragActive === true ||
        typeof window.__fileTreeDragCleanup === "function")
    ) {
      clearFileTreeDragBridge();
    }
    const absolutePaths = uniqueSourcePaths.map((path) => handlers.resolvePath(path));
    refs.activeCrossWindowDragPathsRef.current = absolutePaths;
    refs.lastCrossWindowDragBroadcastRef.current = Date.now();
    refs.dragImageCleanupRef.current?.();
    refs.dragImageCleanupRef.current = null;
    setFileTreeDragBridge(absolutePaths);
    window.__fileTreeDragCleanup = bindChatDropTargetsForTreeDrag(absolutePaths);
    setFileTreeDragPosition(event.clientX, event.clientY);
    handlers.broadcastCrossWindowTreeDrag({
      type: "start",
      paths: absolutePaths,
    });
    if (!event.dataTransfer) {
      return;
    }
    const encodedPaths = JSON.stringify(absolutePaths);
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-doge-file-paths", encodedPaths);
    event.dataTransfer.setData("text/plain", absolutePaths.join("\n"));
    if (isWindowsDragPreviewRuntime() && typeof event.dataTransfer.setDragImage === "function") {
      const preview = createWindowsFileTreeDragImage(
        absolutePaths[0] ?? "",
        absolutePaths.length,
        row.isFolder,
      );
      if (preview) {
        event.dataTransfer.setDragImage(preview.element, 18, 14);
        refs.dragImageCleanupRef.current = preview.cleanup;
      }
    }
  };

  const handleDragEnd = (event: DragEvent<HTMLButtonElement>) => {
    refs.activeCrossWindowDragPathsRef.current = [];
    refs.lastCrossWindowDragBroadcastRef.current = 0;
    refs.dragImageCleanupRef.current?.();
    refs.dragImageCleanupRef.current = null;
    if (typeof window !== "undefined" && window.__fileTreeDragDropped === true) {
      clearFileTreeDragBridge();
      return;
    }
    const inserted = triggerChatInputInsertFromTreeDrag(
      event,
      window.__fileTreeDragPaths ?? [],
    );
    if (!inserted) {
      const fallbackPaths = window.__fileTreeDragPaths ?? [];
      const hasChatInput = Boolean(document.querySelector(".chat-input-box"));
      if (hasChatInput && fallbackPaths.length > 0) {
        insertPathsIntoChat(fallbackPaths);
      }
    }
    clearFileTreeDragBridge();
  };

  const openOrToggleNode = (target: HTMLElement) => {
    if (row.isFolder) {
      if (!row.canExpand) {
        return;
      }
      handlers.toggleFolderExpandedState(node.path, row.isLazyFolder);
      return;
    }
    if (handlers.onOpenFile) {
      handlers.onOpenFile(node.path);
      return;
    }
    handlers.openPreview(node.path, target);
  };

  const canOpenInBrowser =
    !row.isFolder &&
    Boolean(handlers.onOpenInBrowser) &&
    isHtmlFilePath(node.path);

  return (
    <div
      className={`file-tree-row-wrap${canOpenInBrowser ? " has-browser-action" : ""}`}
    >
      <button
        type="button"
        data-file-tree-path={node.path}
        className={`file-tree-row${row.isFolder ? " is-folder" : " is-file"}${row.repositorySummary ? " is-git-repository" : ""}${row.isGitignored ? " is-gitignored" : ""}${row.isSelected ? " is-selected" : ""}${row.isPrimarySelection ? " is-primary" : ""}`}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
        onClick={(event) => {
          const isToggleSelect = event.metaKey || event.ctrlKey;
          if (event.shiftKey) {
            handlers.setRangeSelection(node.path, node.type);
            return;
          }
          if (isToggleSelect) {
            handlers.togglePathSelection(node.path, node.type);
            return;
          }
          handlers.setSingleSelection(node.path, node.type);
          if (event.detail > 1) {
            return;
          }
          openOrToggleNode(event.currentTarget);
        }}
        onContextMenu={(event) => {
          if (!state.selectedNodePaths.has(node.path)) {
            handlers.setSingleSelection(node.path, node.type);
          } else {
            handlers.setSelectedNodePath(node.path);
            handlers.setSelectedNodeType(node.type);
          }
          handlers.showContextMenu(event, node.path, row.isFolder);
        }}
        draggable
        onDragStart={handleDragStart}
        onDrag={(event) => {
          setFileTreeDragPosition(event.clientX, event.clientY);
          handlers.rebroadcastCrossWindowTreeDrag();
        }}
        onDragEnd={handleDragEnd}
      >
        <span
          className={`file-tree-icon-cell${row.isFolder && row.canExpand ? " has-chevron" : ""}`}
          aria-hidden
        >
          <span
            className="file-tree-icon"
            dangerouslySetInnerHTML={{
              __html: getFileTreeIconSvg(node.name, row.isFolder, row.isExpanded),
            }}
          />
          {row.isFolder && row.canExpand && (
            <span
              className={`file-tree-chevron${row.isExpanded ? " is-open" : ""}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                handlers.toggleFolderExpandedState(node.path, row.isLazyFolder);
              }}
            >
              &rsaquo;
            </span>
          )}
        </span>
        <span className={`file-tree-name${row.gitStatusClass}`}>{node.name}</span>
        {row.repositorySummary ? (
          <GitRepositoryStatus repository={row.repositorySummary} />
        ) : null}
      </button>
      <div
        className={`file-tree-actions${row.isSelected ? " is-visible" : ""}`}
      >
        {canOpenInBrowser ? (
          <button
            type="button"
            className="ghost icon-button file-tree-action file-tree-action--browser"
            onMouseDown={(event) => {
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
              handlers.onOpenInBrowser?.(node.path);
            }}
            aria-label={t("files.openInBrowser")}
            title={t("files.openInBrowser")}
          >
            <Globe size={10} aria-hidden />
          </button>
        ) : null}
        <button
          type="button"
          className="ghost icon-button file-tree-action file-tree-action--mention"
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
            const absolutePath = handlers.resolvePath(node.path);
            if (typeof window !== "undefined" && window.handleFilePathFromJava) {
              window.handleFilePathFromJava(absolutePath);
              return;
            }
            const mentionText = `@${absolutePath}${node.type === "file" ? " " : ""}`;
            handlers.onInsertText?.(mentionText);
          }}
          aria-label={t("files.mentionFile", { name: node.name })}
          title={t("files.mentionInChat")}
        >
          <Plus size={10} aria-hidden />
        </button>
      </div>
    </div>
  );
}

export function FileTreeLazyStateRow({
  path,
  depth,
  state,
  error,
  t,
  onLoad,
}: {
  path: string;
  depth?: number;
  state: "loading" | "error" | "empty";
  error: string | null;
  t: TFunction;
  onLoad: (path: string) => void;
}) {
  if (state === "loading") {
    return (
      <div
        className="file-tree-lazy-state"
        style={depth === undefined ? undefined : { paddingLeft: `${depth * 12 + 32}px` }}
      >
        {t("files.loadingFiles")}
      </div>
    );
  }
  if (state === "error") {
    return (
      <button
        type="button"
        className="file-tree-lazy-retry"
        style={depth === undefined ? undefined : { marginLeft: `${depth * 12 + 8}px` }}
        onClick={() => onLoad(path)}
        title={error ?? undefined}
      >
        {t("files.retryLoadFiles")}
      </button>
    );
  }
  return (
    <div
      className="file-tree-lazy-state"
      style={depth === undefined ? undefined : { paddingLeft: `${depth * 12 + 32}px` }}
    >
      {t("files.noFilesAvailable")}
    </div>
  );
}

export function FileTreeVirtualRow({
  row,
  state,
  handlers,
  refs,
  t,
}: FileTreeRowsSharedProps & {
  row: VisibleFileTreeRow;
}) {
  if (row.kind === "lazy-state") {
    return (
      <FileTreeLazyStateRow
        path={row.path}
        depth={row.depth}
        state={row.state}
        error={row.error}
        t={t}
        onLoad={handlers.loadLazyDirectoryChildren}
      />
    );
  }
  return (
    <FileTreeNodeRow
      node={row.entry.node}
      depth={row.entry.depth}
      state={state}
      handlers={handlers}
      refs={refs}
      t={t}
    />
  );
}

export function FileTreeNodeBranch({
  node,
  depth,
  state,
  handlers,
  refs,
  t,
}: FileTreeNodeRowProps) {
  const row = getFileTreeRowMetadata(node, state);
  const isLazyLoading = row.isLazyFolder && state.loadingLazyDirectories.has(node.path);
  const lazyLoadError = row.isLazyFolder
    ? state.lazyDirectoryLoadErrors.get(node.path) ?? null
    : null;

  return (
    <div>
      <FileTreeNodeRow
        node={node}
        depth={depth}
        state={state}
        handlers={handlers}
        refs={refs}
        t={t}
      />
      {row.hasChildren && row.isExpanded && (
        <div className="file-tree-children">
          {node.children.map((child) => (
            <FileTreeNodeBranch
              key={child.path}
              node={child}
              depth={depth + 1}
              state={state}
              handlers={handlers}
              refs={refs}
              t={t}
            />
          ))}
        </div>
      )}
      {row.isLazyFolder && row.isExpanded && node.children.length === 0 && (
        <div className="file-tree-children">
          <FileTreeLazyStateRow
            path={node.path}
            state={isLazyLoading ? "loading" : lazyLoadError ? "error" : "empty"}
            error={lazyLoadError}
            t={t}
            onLoad={handlers.loadLazyDirectoryChildren}
          />
        </div>
      )}
    </div>
  );
}
