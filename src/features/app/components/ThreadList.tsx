import { FloatingTooltipButton } from "@/components/ui/floating-tooltip-button";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronUp from "lucide-react/dist/esm/icons/chevron-up";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type {
  CSSProperties,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import type { EngineType, ThreadSummary } from "../../../types";
import type { ThreadMoveFolderTarget } from "../hooks/useSidebarMenus";
import { ProxyStatusBadge } from "../../../components/ProxyStatusBadge";
import { EngineIcon } from "../../engine/components/EngineIcon";
import { SharedSessionIcon } from "../../shared-session/components/SharedSessionIcon";
import { resolveIsSharedSession } from "../../shared-session/utils/sharedSessionIdentity";
import { resolveEngineProviderLabel } from "../utils/codexProviderLabel";
import { THREAD_ROW_TOOLTIP_DELAY_MS } from "../constants";
import { getExitedSessionRowVisibility } from "../utils/exitedSessionRows";
import {
  ThreadRowStatusProvider,
  useThreadRowStatus,
  type ThreadStatusMap,
} from "./threadRowStatusStore";
import {
  flattenSidebarWorkspaceItems,
  resolveSidebarItemKey,
  SIDEBAR_THREAD_ROW_ESTIMATED_HEIGHT_PX,
  shouldVirtualizeSidebarList,
  type SidebarVirtualItem,
} from "./sidebarVirtualItems";
import { getThreadRowProjection } from "../utils/threadRowProjection";
import {
  projectContinuationFamilyRows,
  type ContinuationFamilyRow,
  type PresentedContinuationFamilyRow,
} from "../utils/continuationFamilyRows";
import { ThreadDeleteConfirmPopover } from "./ThreadDeleteConfirmPopover";

type ThreadRow = PresentedContinuationFamilyRow<ContinuationFamilyRow>;

type ShowThreadMenuHandler = (
  event: MouseEvent,
  workspaceId: string,
  threadId: string,
  canPin: boolean,
  sizeBytes?: number,
  moveFolderTargets?: ThreadMoveFolderTarget[],
  currentFolderId?: string | null,
  canArchive?: boolean,
  workspacePath?: string,
) => void;

type ThreadRowItemProps = {
  canArchive: boolean;
  canPin: boolean;
  contextMenuMoveFolderTargets?: ThreadMoveFolderTarget[];
  deleteConfirmBusy: boolean;
  engineTitle: string;
  engineSource: EngineType;
  hasChildren: boolean;
  indentPx: number | null;
  isActiveSubagentGroup: boolean;
  isActiveSubagentParent: boolean;
  isActiveThread: boolean;
  isAutoNaming: boolean;
  isDeleteConfirmOpen: boolean;
  isPendingSubagent: boolean;
  isPinned: boolean;
  isRenaming: boolean;
  showProviderLabels: boolean;
  isSharedThread: boolean;
  isSubagentParent: boolean;
  isSubagentParentCollapsed: boolean;
  isSubagentThread: boolean;
  nestedWorkspaceId: string;
  onCancelDeleteConfirm?: () => void;
  onConfirmDeleteConfirm?: () => void;
  onRenameCancel?: () => void;
  onRenameChange?: (value: string) => void;
  onRenameConfirm?: () => void;
  onSelectThread: (workspaceId: string, threadId: string) => void;
  onShowThreadMenu: ShowThreadMenuHandler;
  onToggleThreadPin?: (workspaceId: string, threadId: string) => void;
  relativeTime: string | null;
  renameName: string;
  selectTargetThreadId: string;
  subagentTreeToggleLabel: string;
  systemProxyEnabled: boolean;
  systemProxyUrl: string | null;
  thread: ThreadSummary;
  toggleSubagentParent: (event: MouseEvent, threadId: string) => void;
  handleSubagentParentKeyDown: (event: KeyboardEvent, threadId: string) => void;
  workspacePath: string;
  onThreadRowRender?: (threadId: string) => void;
};

const EMPTY_MOVE_FOLDER_TARGETS: ThreadMoveFolderTarget[] = [];
const EMPTY_FOLDER_ROWS: Array<{ workspaceId: string; folderId: string }> = [];
const EMPTY_WORKTREE_ROWS: Array<{
  parentWorkspaceId: string;
  worktreeWorkspaceId: string;
}> = [];

function renderSidebarVirtualItem(
  item: SidebarVirtualItem,
  rowsByKey: ReadonlyMap<string, ThreadRow>,
  renderThreadRow: (row: ThreadRow) => ReactNode,
) {
  if (item.kind === "separator") {
    return <div className="thread-list-separator" aria-hidden="true" />;
  }
  if (item.kind !== "thread" && item.kind !== "pinned") {
    return null;
  }
  const row = rowsByKey.get(item.key);
  return row ? renderThreadRow(row) : null;
}

function isPendingSubagentThread(thread: ThreadSummary) {
  return (
    thread.id.startsWith("claude-pending-subagent:") ||
    thread.id.includes("-pending-subagent:")
  );
}

function filterCollapsedThreadRows(
  rows: ThreadRow[],
  expandedParentThreadIds: ReadonlySet<string>,
) {
  const visibleRows: ThreadRow[] = [];
  let collapsedDepth: number | null = null;

  rows.forEach((row) => {
    if (collapsedDepth !== null) {
      if (row.depth > collapsedDepth) {
        return;
      }
      collapsedDepth = null;
    }

    visibleRows.push(row);
    // Subagent parents default to collapsed; only those the user explicitly
    // expanded (tracked in expandedParentThreadIds) reveal their children.
    if (row.hasChildren && !expandedParentThreadIds.has(row.thread.id)) {
      collapsedDepth = row.depth;
    }
  });

  return visibleRows;
}

function filterCollapsedContinuationFamilyRows(
  rows: ThreadRow[],
  expandedFamilyIds: ReadonlySet<string>,
) {
  const visibleRows: ThreadRow[] = [];
  let didCollapseFamily = false;

  rows.forEach((row) => {
    const segment = row.continuationFamilySegment;
    const isVisible =
      !segment ||
      expandedFamilyIds.has(segment.familyId) ||
      segment.position === "start";
    if (isVisible) {
      visibleRows.push(row);
      return;
    }
    didCollapseFamily = true;
  });

  return didCollapseFamily ? visibleRows : rows;
}

const ThreadRowItem = memo(function ThreadRowItem({
  canArchive,
  canPin,
  contextMenuMoveFolderTargets,
  deleteConfirmBusy,
  engineTitle,
  engineSource,
  hasChildren,
  indentPx,
  isActiveSubagentGroup,
  isActiveSubagentParent,
  isActiveThread,
  isAutoNaming,
  isDeleteConfirmOpen,
  isPendingSubagent,
  isPinned,
  isRenaming,
  showProviderLabels,
  isSharedThread,
  isSubagentParent,
  isSubagentParentCollapsed,
  isSubagentThread,
  nestedWorkspaceId,
  onCancelDeleteConfirm,
  onConfirmDeleteConfirm,
  onRenameCancel,
  onRenameChange,
  onRenameConfirm,
  onSelectThread,
  onShowThreadMenu,
  onToggleThreadPin,
  relativeTime,
  renameName,
  selectTargetThreadId,
  subagentTreeToggleLabel,
  systemProxyEnabled,
  systemProxyUrl,
  thread,
  toggleSubagentParent,
  handleSubagentParentKeyDown,
  workspacePath,
  onThreadRowRender,
}: ThreadRowItemProps) {
  const { t } = useTranslation();
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const renameSkipBlurRef = useRef(false);
  useEffect(() => {
    onThreadRowRender?.(thread.id);
  });
  useEffect(() => {
    if (!isRenaming) {
      return;
    }
    renameSkipBlurRef.current = false;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [isRenaming]);
  const status = useThreadRowStatus(thread.id);
  const rowProjection = getThreadRowProjection({
    workspaceId: nestedWorkspaceId,
    threadId: thread.id,
    statusVersion: `${status?.isProcessing ? "1" : "0"}:${status?.hasUnread ? "1" : "0"}:${status?.isReviewing ? "1" : "0"}`,
    isProcessing: Boolean(status?.isProcessing),
    hasUnread: Boolean(status?.hasUnread),
    backgroundActivityLabel: status?.isReviewing
      ? "reviewing"
      : status?.isProcessing
        ? "processing"
        : null,
  });
  const statusClass = status?.isReviewing
    ? "reviewing"
    : rowProjection.isProcessing
      ? "processing"
      : rowProjection.hasUnread
        ? "unread"
        : "ready";
  // Live / completion status uses a compact meta-area dot (not a text pill):
  // - processing: blue breathe
  // - reviewing: static light blue
  // - unread (finished while away): green; cleared on select via setActiveThreadId
  const runtimeIndicator = status?.isReviewing
    ? { label: t("threads.runtimeReviewing"), severity: "reviewing" as const }
    : status?.isProcessing
      ? {
          label: t("threads.runtimeProcessing"),
          severity: "processing" as const,
        }
      : status?.hasUnread
        ? {
            label: t("threads.runtimeCompleted", {
              defaultValue: "Completed",
            }),
            severity: "completed" as const,
          }
        : null;
  const isProcessing = rowProjection.isProcessing;
  const showProxyBadge = systemProxyEnabled && isProcessing;
  const indentStyle =
    indentPx !== null
      ? ({ "--thread-indent": `${indentPx}px` } as CSSProperties)
      : undefined;
  const engineIconType = engineSource as EngineType;
  const providerLabel = resolveEngineProviderLabel(thread);
  const isProviderUnavailable = thread.providerAvailability === "unavailable";
  const rowButtonRef = useRef<HTMLButtonElement | null>(null);
  const rowClassName = `thread-row ${isActiveThread ? "active" : ""}${
    isDeleteConfirmOpen ? " has-delete-confirm" : ""
  }${isRenaming ? " is-renaming" : ""}${canPin ? " has-pin-toggle" : ""}${
    hasChildren ? " has-child-threads" : ""
  }${isSubagentParent ? " is-subagent-parent" : ""}${
    isActiveSubagentParent ? " is-active-subagent-parent" : ""
  }${isSubagentThread ? " is-subagent" : ""}${
    isActiveSubagentGroup ? " is-active-subagent-group" : ""
  }${isPendingSubagent ? " is-pending-subagent" : ""}${
    thread.isDegraded ? " is-degraded" : ""
  }`;
  const leadingChrome = (
    <>
      <span className={`thread-status ${statusClass}`} aria-hidden />
      {canPin && onToggleThreadPin && !isRenaming ? (
        <span
          className={`thread-pin-toggle${isPinned ? " is-pinned" : ""}`}
          role="button"
          aria-label={isPinned ? t("threads.unpin") : t("threads.pin")}
          title={isPinned ? t("threads.unpin") : t("threads.pin")}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onToggleThreadPin(nestedWorkspaceId, thread.id);
          }}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <span className="thread-pin-toggle-icon" aria-hidden />
        </span>
      ) : null}
      {thread.originKind === "provider-continuation" && (
        <span
          className="thread-subagent-tag thread-continuation-tag"
          title={t("threads.providerContinuationHint", {
            defaultValue: "Provider 续接：可在会话顶部查看来源",
          })}
        >
          {t("threads.providerContinuationShort", {
            defaultValue: "续接",
          })}
        </span>
      )}
      {isSubagentThread ? (
        <span className="thread-subagent-tag" title={engineTitle}>
          {t("threads.subagentTag")}
        </span>
      ) : (
        <span
          className={`thread-engine-badge ${
            isSharedThread
              ? "thread-engine-shared"
              : `thread-engine-${engineSource}`
          }${isProcessing ? " is-processing" : ""}`}
          title={engineTitle}
        >
          {isSharedThread ? (
            <SharedSessionIcon size={12} />
          ) : (
            <EngineIcon engine={engineIconType} size={12} />
          )}
        </span>
      )}
      {showProxyBadge && (
        <ProxyStatusBadge
          proxyUrl={systemProxyUrl}
          label={t("threads.proxyBadge")}
          variant="compact"
          className="thread-proxy-badge"
        />
      )}
    </>
  );
  if (isRenaming) {
    return (
      <div className={rowClassName} style={indentStyle}>
        {leadingChrome}
        <input
          ref={renameInputRef}
          className="thread-rename-input"
          value={renameName}
          aria-label={t("threads.renameThread")}
          onChange={(event) => onRenameChange?.(event.target.value)}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
          onBlur={() => {
            if (renameSkipBlurRef.current) {
              renameSkipBlurRef.current = false;
              return;
            }
            onRenameConfirm?.();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              renameSkipBlurRef.current = true;
              onRenameCancel?.();
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              renameSkipBlurRef.current = true;
              onRenameConfirm?.();
            }
          }}
        />
      </div>
    );
  }
  const rowButton = (
    <FloatingTooltipButton
      ref={rowButtonRef}
      tooltipLabel={thread.name}
      tooltipSide="top" tooltipAlign="start" tooltipSideOffset={4}
      tooltipClassName="max-w-[400px] break-words" tooltipDisabled={isDeleteConfirmOpen}
      tooltipDelay={THREAD_ROW_TOOLTIP_DELAY_MS}
      type="button"
      className={rowClassName}
      style={indentStyle} aria-expanded={isSubagentParent ? !isSubagentParentCollapsed : undefined}
      onClick={() => onSelectThread(nestedWorkspaceId, selectTargetThreadId)}
      onContextMenu={(event) => {
        if (isPendingSubagent) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        onShowThreadMenu(
          event,
          nestedWorkspaceId,
          thread.id,
          canPin,
          thread.sizeBytes,
          contextMenuMoveFolderTargets,
          thread.folderId ?? null,
          canArchive,
          workspacePath,
        );
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelectThread(nestedWorkspaceId, selectTargetThreadId);
        }
      }}
    >
      {leadingChrome}
      <span className="thread-name">{thread.name}</span>
      <div className="thread-meta">
        {isSubagentParent && (
          <span
            className={`thread-tree-expander${
              isSubagentParentCollapsed ? " is-collapsed" : ""
            }`}
            role="button"
            tabIndex={0}
            aria-label={subagentTreeToggleLabel}
            title={subagentTreeToggleLabel}
            onClick={(event) => toggleSubagentParent(event, thread.id)}
            onKeyDown={(event) => handleSubagentParentKeyDown(event, thread.id)}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          />
        )}
        {isAutoNaming && <span className="thread-auto-naming">{t("threads.autoNaming")}</span>}
        {showProviderLabels && providerLabel ? (
          <span
            className={`thread-provider-label${
              isProviderUnavailable ? " is-unavailable" : ""
            }`}
            title={providerLabel}
          >
            {providerLabel}
          </span>
        ) : null}
        {runtimeIndicator ? (
          <span
            className={`thread-runtime-dot thread-runtime-dot--${runtimeIndicator.severity}`}
            title={runtimeIndicator.label}
            aria-label={runtimeIndicator.label}
            role="status"
          />
        ) : null}
        {relativeTime && !runtimeIndicator ? (
          <span className="thread-time">{relativeTime}</span>
        ) : null}
      </div>
    </FloatingTooltipButton>
  );
  return (
    <ThreadDeleteConfirmPopover
      open={isDeleteConfirmOpen}
      anchorRef={rowButtonRef}
      trigger={rowButton}
      threadName={thread.name}
      isDeleting={deleteConfirmBusy}
      onCancel={onCancelDeleteConfirm}
      onConfirm={onConfirmDeleteConfirm}
    />
  );
});

export type ThreadListProps = {
  workspaceId: string;
  workspacePath: string;
  pinnedRows: ThreadRow[];
  unpinnedRows: ThreadRow[];
  totalThreadRoots: number;
  visibleThreadRootCount: number;
  isExpanded: boolean;
  nextCursor: string | null;
  isPaging: boolean;
  nested?: boolean;
  showLoadOlder?: boolean;
  showProviderLabels?: boolean;
  moveFolderTargets?: ThreadMoveFolderTarget[];
  hideExitedSessions?: boolean;
  activeWorkspaceId: string | null;
  activeThreadId: string | null;
  systemProxyEnabled?: boolean;
  systemProxyUrl?: string | null;
  threadStatusById: ThreadStatusMap;
  getThreadTime: (thread: ThreadSummary) => string | null;
  isThreadPinned: (workspaceId: string, threadId: string) => boolean;
  isThreadAutoNaming: (workspaceId: string, threadId: string) => boolean;
  onToggleThreadPin?: (workspaceId: string, threadId: string) => void;
  onToggleExpanded: (workspaceId: string) => void;
  onLoadOlderThreads: (workspaceId: string) => void;
  onSelectThread: (workspaceId: string, threadId: string) => void;
  onShowThreadMenu: ShowThreadMenuHandler;
  deleteConfirmThreadId?: string | null;
  deleteConfirmWorkspaceId?: string | null;
  deleteConfirmBusy?: boolean;
  onCancelDeleteConfirm?: () => void;
  onConfirmDeleteConfirm?: () => void;
  renameThreadId?: string | null;
  renameWorkspaceId?: string | null;
  renameName?: string;
  onRenameChange?: (value: string) => void;
  onRenameCancel?: () => void;
  onRenameConfirm?: () => void;
  onThreadRowRender?: (threadId: string) => void;
  listClassName?: string;
};

export function ThreadList({
  workspaceId,
  workspacePath,
  pinnedRows,
  unpinnedRows,
  totalThreadRoots,
  visibleThreadRootCount,
  isExpanded,
  nextCursor,
  isPaging,
  nested,
  showLoadOlder = true,
  showProviderLabels = false,
  moveFolderTargets = EMPTY_MOVE_FOLDER_TARGETS,
  hideExitedSessions = false,
  activeWorkspaceId,
  activeThreadId,
  systemProxyEnabled = false,
  systemProxyUrl = null,
  threadStatusById,
  getThreadTime,
  isThreadPinned,
  isThreadAutoNaming,
  onToggleThreadPin,
  onToggleExpanded,
  onLoadOlderThreads,
  onSelectThread,
  onShowThreadMenu,
  deleteConfirmThreadId = null,
  deleteConfirmWorkspaceId = null,
  deleteConfirmBusy = false,
  onCancelDeleteConfirm,
  onConfirmDeleteConfirm,
  renameThreadId = null,
  renameWorkspaceId = null,
  renameName = "",
  onRenameChange,
  onRenameCancel,
  onRenameConfirm,
  onThreadRowRender,
  listClassName,
}: ThreadListProps) {
  const { t } = useTranslation();
  const indentUnit = nested ? 10 : 14;
  const threadListRef = useRef<HTMLDivElement | null>(null);
  const [expandedParentThreadIds, setExpandedParentThreadIds] = useState<
    Set<string>
  >(() => new Set());
  const [expandedContinuationFamilyIds, setExpandedContinuationFamilyIds] =
    useState<Set<string>>(() => new Set());
  const isExitedThread = useCallback(
    (thread: ThreadSummary) => {
      if (isPendingSubagentThread(thread)) {
        return false;
      }
      const status = threadStatusById[thread.id];
      return !status?.isProcessing && !status?.isReviewing;
    },
    [threadStatusById],
  );
  const { visiblePinnedRows, visibleUnpinnedRows, hiddenExitedCount } =
    useMemo(() => {
      const pinnedVisibility = getExitedSessionRowVisibility(pinnedRows, {
        hideExitedSessions,
        isExitedThread,
      });
      const unpinnedVisibility = getExitedSessionRowVisibility(unpinnedRows, {
        hideExitedSessions,
        isExitedThread,
      });

      return {
        visiblePinnedRows: pinnedVisibility.visibleRows,
        visibleUnpinnedRows: unpinnedVisibility.visibleRows,
        hiddenExitedCount:
          pinnedVisibility.hiddenExitedCount +
          unpinnedVisibility.hiddenExitedCount,
      };
    }, [hideExitedSessions, isExitedThread, pinnedRows, unpinnedRows]);
  const showHiddenExitedSummary = useMemo(
    () =>
      hideExitedSessions &&
      hiddenExitedCount > 0 &&
      visiblePinnedRows.length === 0 &&
      visibleUnpinnedRows.length === 0,
    [
      hiddenExitedCount,
      hideExitedSessions,
      visiblePinnedRows.length,
      visibleUnpinnedRows.length,
    ],
  );
  const contextMenuMoveFolderTargets =
    moveFolderTargets.length > 0 ? moveFolderTargets : undefined;
  const displayedPinnedRows = useMemo(
    () =>
      filterCollapsedContinuationFamilyRows(
        projectContinuationFamilyRows(
          filterCollapsedThreadRows(visiblePinnedRows, expandedParentThreadIds),
        ),
        expandedContinuationFamilyIds,
      ),
    [expandedContinuationFamilyIds, expandedParentThreadIds, visiblePinnedRows],
  );
  const displayedUnpinnedRows = useMemo(
    () =>
      filterCollapsedContinuationFamilyRows(
        projectContinuationFamilyRows(
          filterCollapsedThreadRows(
            visibleUnpinnedRows,
            expandedParentThreadIds,
          ),
        ),
        expandedContinuationFamilyIds,
      ),
    [
      expandedContinuationFamilyIds,
      expandedParentThreadIds,
      visibleUnpinnedRows,
    ],
  );
  const rowsBySidebarVirtualKey = useMemo(() => {
    const next = new Map<string, ThreadRow>();
    displayedPinnedRows.forEach((row) => {
      next.set(`pinned:${workspaceId}:${row.thread.id}`, row);
    });
    displayedUnpinnedRows.forEach((row) => {
      next.set(`thread:${workspaceId}:${row.thread.id}`, row);
    });
    return next;
  }, [displayedPinnedRows, displayedUnpinnedRows, workspaceId]);
  const sidebarVirtualItems = useMemo(
    () =>
      flattenSidebarWorkspaceItems({
        pinnedRows: displayedPinnedRows.map((row) => ({
          thread: row.thread,
          workspaceId,
        })),
        unpinnedRows: displayedUnpinnedRows.map((row) => ({
          thread: row.thread,
          workspaceId,
        })),
        folders: EMPTY_FOLDER_ROWS,
        worktrees: EMPTY_WORKTREE_ROWS,
        hasMoreThreads: false,
        isEmpty: false,
      }),
    [displayedPinnedRows, displayedUnpinnedRows, workspaceId],
  );
  const shouldVirtualizeThreads = shouldVirtualizeSidebarList(
    sidebarVirtualItems.length,
  );
  const threadRowVirtualizer = useVirtualizer({
    count: shouldVirtualizeThreads ? sidebarVirtualItems.length : 0,
    getScrollElement: () => threadListRef.current,
    // Match non-virtualized pitch (row min-height 30 + list gap 2). A larger
    // estimate leaves visible gaps after expanding "更多" past the
    // virtualization threshold; measureElement cannot shrink below the CSS
    // min-height on `.thread-list-virtual-row`.
    estimateSize: () => SIDEBAR_THREAD_ROW_ESTIMATED_HEIGHT_PX,
    overscan: 8,
    getItemKey: (index) => resolveSidebarItemKey(sidebarVirtualItems, index),
  });
  const activeThreadParentId = useMemo(() => {
    if (workspaceId !== activeWorkspaceId || !activeThreadId) {
      return null;
    }
    const activeRow = [...visiblePinnedRows, ...visibleUnpinnedRows].find(
      (row) => row.thread.id === activeThreadId,
    );
    return activeRow?.thread.parentThreadId ?? null;
  }, [
    activeThreadId,
    activeWorkspaceId,
    visiblePinnedRows,
    visibleUnpinnedRows,
    workspaceId,
  ]);
  const toggleSubagentParent = useCallback(
    (event: MouseEvent, threadId: string) => {
      event.preventDefault();
      event.stopPropagation();
      setExpandedParentThreadIds((current) => {
        const next = new Set(current);
        if (next.has(threadId)) {
          next.delete(threadId);
        } else {
          next.add(threadId);
        }
        return next;
      });
    },
    [],
  );
  const handleSubagentParentKeyDown = useCallback(
    (event: KeyboardEvent, threadId: string) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setExpandedParentThreadIds((current) => {
        const next = new Set(current);
        if (next.has(threadId)) {
          next.delete(threadId);
        } else {
          next.add(threadId);
        }
        return next;
      });
    },
    [],
  );
  const toggleContinuationFamily = useCallback(
    (event: MouseEvent, familyId: string) => {
      event.preventDefault();
      event.stopPropagation();
      setExpandedContinuationFamilyIds((current) => {
        const next = new Set(current);
        if (next.has(familyId)) {
          next.delete(familyId);
        } else {
          next.add(familyId);
        }
        return next;
      });
    },
    [],
  );
  const renderThreadRow = ({
    thread,
    depth,
    hasChildren = false,
    continuationFamilySegment,
  }: ThreadRow) => {
    const relativeTime = getThreadTime(thread);
    const isActiveThread =
      workspaceId === activeWorkspaceId && thread.id === activeThreadId;
    const indentPx = depth > 0 ? depth * indentUnit : null;
    const canPin = depth === 0;
    const isPinned = canPin && isThreadPinned(workspaceId, thread.id);
    const isAutoNaming = isThreadAutoNaming(workspaceId, thread.id);
    // id-first：shared: 前缀是 hard gate；threadKind 投影可丢/被 native 覆盖
    // （与 fix-shared-session-identity-id-first 同源；图标消费方此前漏迁）。
    const isSharedThread = resolveIsSharedSession(thread.id, thread);
    const isSubagentThread = depth > 0;
    const isSubagentParent = depth === 0 && hasChildren;
    const isActiveSubagentGroup =
      isSubagentThread &&
      workspaceId === activeWorkspaceId &&
      (thread.parentThreadId === activeThreadId ||
        thread.parentThreadId === activeThreadParentId);
    const isActiveSubagentParent =
      isSubagentParent &&
      workspaceId === activeWorkspaceId &&
      (thread.id === activeThreadId || thread.id === activeThreadParentId);
    const isPendingSubagent = isPendingSubagentThread(thread);
    const isSubagentParentCollapsed =
      isSubagentParent && !expandedParentThreadIds.has(thread.id);
    const subagentTreeToggleLabel = isSubagentParentCollapsed
      ? t("threads.subagentTreeExpand")
      : t("threads.subagentTreeCollapse");
    const selectTargetThreadId =
      isPendingSubagent && thread.parentThreadId
        ? thread.parentThreadId
        : thread.id;
    const canArchive = !isPendingSubagent && !isSharedThread;
    const engineSource: EngineType = thread.engineSource ?? "codex";
    const baseEngineTitle =
      engineSource === "claude"
        ? "Claude"
        : engineSource === "gemini"
          ? "Gemini"
          : engineSource === "grok"
            ? "Grok"
          : engineSource === "kimi"
            ? "Kimi"
          : engineSource === "opencode"
            ? "OpenCode"
            : "Codex";
    const engineTitle = isSharedThread
      ? `Shared Session · ${baseEngineTitle}`
      : baseEngineTitle;

    const isDeleteConfirmOpen =
      deleteConfirmWorkspaceId === workspaceId &&
      deleteConfirmThreadId === thread.id;
    const isRenaming =
      renameWorkspaceId === workspaceId && renameThreadId === thread.id;

    const rowNode = (
      <ThreadRowItem
        key={thread.id}
        canArchive={canArchive}
        canPin={canPin}
        contextMenuMoveFolderTargets={contextMenuMoveFolderTargets}
        deleteConfirmBusy={deleteConfirmBusy}
        engineSource={engineSource}
        engineTitle={engineTitle}
        hasChildren={hasChildren}
        indentPx={indentPx}
        isActiveSubagentGroup={isActiveSubagentGroup}
        isActiveSubagentParent={isActiveSubagentParent}
        isActiveThread={isActiveThread}
        isAutoNaming={isAutoNaming}
        isDeleteConfirmOpen={isDeleteConfirmOpen}
        isPendingSubagent={isPendingSubagent}
        isPinned={isPinned}
        isRenaming={isRenaming}
        showProviderLabels={showProviderLabels}
        isSharedThread={isSharedThread}
        isSubagentParent={isSubagentParent}
        isSubagentParentCollapsed={isSubagentParentCollapsed}
        isSubagentThread={isSubagentThread}
        nestedWorkspaceId={workspaceId}
        onCancelDeleteConfirm={onCancelDeleteConfirm}
        onConfirmDeleteConfirm={onConfirmDeleteConfirm}
        onRenameCancel={onRenameCancel}
        onRenameChange={onRenameChange}
        onRenameConfirm={onRenameConfirm}
        onSelectThread={onSelectThread}
        onShowThreadMenu={onShowThreadMenu}
        onToggleThreadPin={onToggleThreadPin}
        relativeTime={relativeTime}
        renameName={isRenaming ? renameName : ""}
        selectTargetThreadId={selectTargetThreadId}
        subagentTreeToggleLabel={subagentTreeToggleLabel}
        systemProxyEnabled={systemProxyEnabled}
        systemProxyUrl={systemProxyUrl}
        thread={thread}
        toggleSubagentParent={toggleSubagentParent}
        handleSubagentParentKeyDown={handleSubagentParentKeyDown}
        workspacePath={workspacePath}
        onThreadRowRender={onThreadRowRender}
      />
    );
    if (!continuationFamilySegment) {
      return rowNode;
    }

    const familyLabel =
      continuationFamilySegment.position === "start"
        ? t("threads.providerContinuationFamilyGroup", {
            count: continuationFamilySegment.memberCount,
          })
        : null;
    const isContinuationFamilyExpanded = expandedContinuationFamilyIds.has(
      continuationFamilySegment.familyId,
    );
    const isCollapsedContinuationFamily =
      continuationFamilySegment.position === "start" &&
      !isContinuationFamilyExpanded;

    return (
      <div
        key={thread.id}
        className={`thread-continuation-family-segment is-${continuationFamilySegment.position}${
          isCollapsedContinuationFamily ? " is-collapsed" : ""
        }`}
        data-continuation-family-id={continuationFamilySegment.familyId}
        data-continuation-family-position={continuationFamilySegment.position}
        data-continuation-family-expanded={String(isContinuationFamilyExpanded)}
      >
        {familyLabel ? (
          <button
            type="button"
            className="thread-continuation-family-label"
            aria-expanded={isContinuationFamilyExpanded}
            onClick={(event) =>
              toggleContinuationFamily(
                event,
                continuationFamilySegment.familyId,
              )
            }
          >
            <span>{familyLabel}</span>
            {isContinuationFamilyExpanded ? (
              <ChevronUp aria-hidden="true" />
            ) : (
              <ChevronDown aria-hidden="true" />
            )}
          </button>
        ) : null}
        {rowNode}
      </div>
    );
  };

  return (
    <ThreadRowStatusProvider threadStatusById={threadStatusById}>
      <div
        ref={threadListRef}
        className={`thread-list scrollable${nested ? " thread-list-nested" : ""}${
          listClassName ? ` ${listClassName}` : ""
        }`}
        data-virtualized={shouldVirtualizeThreads ? "true" : undefined}
      >
        {shouldVirtualizeThreads ? (
          <>
            <div
              className="thread-list-virtual-spacer"
              style={{ height: `${threadRowVirtualizer.getTotalSize()}px` }}
            >
              {threadRowVirtualizer.getVirtualItems().map((virtualRow) => {
                const item = sidebarVirtualItems[virtualRow.index];
                if (!item) {
                  return null;
                }
                const content = renderSidebarVirtualItem(
                  item,
                  rowsBySidebarVirtualKey,
                  renderThreadRow,
                );
                if (!content) {
                  return null;
                }
                return (
                  <div
                    key={virtualRow.key}
                    ref={threadRowVirtualizer.measureElement}
                    data-index={virtualRow.index}
                    className="thread-list-virtual-row"
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                  >
                    {content}
                  </div>
                );
              })}
            </div>
            {showHiddenExitedSummary && (
              <div className="thread-list-hidden-summary">
                {t("threads.exitedSessionsHidden", {
                  count: hiddenExitedCount,
                })}
              </div>
            )}
            {totalThreadRoots > visibleThreadRootCount && (
              <button
                className="thread-more"
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleExpanded(workspaceId);
                }}
              >
                {isExpanded ? t("threads.showLess") : t("threads.more")}
              </button>
            )}
            {showLoadOlder &&
              nextCursor &&
              (isExpanded || totalThreadRoots <= visibleThreadRootCount) && (
                <button
                  className="thread-more"
                  onClick={(event) => {
                    event.stopPropagation();
                    onLoadOlderThreads(workspaceId);
                  }}
                  disabled={isPaging}
                >
                  {isPaging
                    ? t("threads.loading")
                    : totalThreadRoots === 0
                      ? t("threads.searchOlder")
                      : t("threads.loadOlder")}
                </button>
              )}
          </>
        ) : (
          <>
            {displayedPinnedRows.map((row) => renderThreadRow(row))}
            {displayedPinnedRows.length > 0 &&
              displayedUnpinnedRows.length > 0 && (
                <div className="thread-list-separator" aria-hidden="true" />
              )}
            {displayedUnpinnedRows.map((row) => renderThreadRow(row))}
            {showHiddenExitedSummary && (
              <div className="thread-list-hidden-summary">
                {t("threads.exitedSessionsHidden", {
                  count: hiddenExitedCount,
                })}
              </div>
            )}
            {totalThreadRoots > visibleThreadRootCount && (
              <button
                className="thread-more"
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleExpanded(workspaceId);
                }}
              >
                {isExpanded ? t("threads.showLess") : t("threads.more")}
              </button>
            )}
            {showLoadOlder &&
              nextCursor &&
              (isExpanded || totalThreadRoots <= visibleThreadRootCount) && (
                <button
                  className="thread-more"
                  onClick={(event) => {
                    event.stopPropagation();
                    onLoadOlderThreads(workspaceId);
                  }}
                  disabled={isPaging}
                >
                  {isPaging
                    ? t("threads.loading")
                    : totalThreadRoots === 0
                      ? t("threads.searchOlder")
                      : t("threads.loadOlder")}
                </button>
              )}
          </>
        )}
      </div>
    </ThreadRowStatusProvider>
  );
}
