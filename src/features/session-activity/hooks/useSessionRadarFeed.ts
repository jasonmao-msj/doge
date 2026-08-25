import { useEffect, useMemo, useRef, useState } from "react";
import type { ConversationItem, ThreadSummary, WorkspaceInfo } from "../../../types";
import { resolveLockLivePreview } from "../../../app-shell-parts/utils";
import { getClientStoreSync, writeClientStoreValue } from "../../../services/clientStorage";
import { isIncrementalDerivationEnabled } from "@/conversation-presentation/realtimePerfFlags";
import {
  RADAR_RECENT_GLOBAL_LIMIT,
  RADAR_RECENT_TTL_MS,
  RADAR_STORE_NAME,
  SESSION_RADAR_DISMISSED_COMPLETED_AT_BY_ID_KEY,
  SESSION_RADAR_HISTORY_UPDATED_EVENT,
  SESSION_RADAR_READ_STATE_KEY,
  SESSION_RADAR_RECENT_STORAGE_KEY,
  applyRadarRecentBounds,
  buildRadarCompletionId,
  parsePersistedRadarRecentEntry,
  readDismissedCompletedAtById,
  resolveLatestUserMessage as resolveLatestUserMessageFromItems,
  type PersistedRadarRecentEntry,
} from "../utils/sessionRadarPersistence";

const DEFAULT_RUNNING_LIMIT = 12;
const DEFAULT_RECENT_LIMIT = RADAR_RECENT_GLOBAL_LIMIT;

type ThreadStatusSnapshot = {
  isProcessing?: boolean;
  processingStartedAt?: number | null;
  lastDurationMs?: number | null;
};

type LastAgentSnapshot = {
  text: string;
  timestamp: number;
};

export type SessionRadarEntry = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  threadId: string;
  threadName: string;
  engine: string;
  preview: string;
  updatedAt: number;
  isProcessing: boolean;
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
};

type BuildSessionRadarFeedInput = {
  workspaces: WorkspaceInfo[];
  threadsByWorkspace: Record<string, ThreadSummary[]>;
  threadStatusById: Record<string, ThreadStatusSnapshot | undefined>;
  threadItemsByThread: Record<string, ConversationItem[]>;
  lastAgentMessageByThread: Record<string, LastAgentSnapshot | undefined>;
  now?: number;
  runningLimit?: number;
  recentLimit?: number;
};

type SessionRadarFeed = {
  runningSessions: SessionRadarEntry[];
  recentCompletedSessions: SessionRadarEntry[];
  runningCountByWorkspaceId: Record<string, number>;
  recentCountByWorkspaceId: Record<string, number>;
};

type PersistedRecentSessionRef = PersistedRadarRecentEntry;

type CachedLiveThreadEntry = {
  signature: string;
  entry: SessionRadarEntry;
};

type RecentHistorySnapshot = {
  dismissedCompletedAtById: Record<string, number>;
  persistedRecent: PersistedRecentSessionRef[];
};

const latestUserMessageByItemsRef = new WeakMap<ConversationItem[], string>();

function compareRadarEntriesByFreshness(
  left: SessionRadarEntry,
  right: SessionRadarEntry,
) {
  const updatedAtDiff = right.updatedAt - left.updatedAt;
  if (updatedAtDiff !== 0) {
    return updatedAtDiff;
  }
  const completedAtDiff = (right.completedAt ?? 0) - (left.completedAt ?? 0);
  if (completedAtDiff !== 0) {
    return completedAtDiff;
  }
  return left.id.localeCompare(right.id);
}

// 扫描逻辑与 sessionRadarPersistence.resolveLatestUserMessage 统一；此处仅保留
// WeakMap 缓存，避免流式期间对同一 items 数组重复 O(n) 扫描。
function resolveLatestUserMessage(items: ConversationItem[] | undefined) {
  if (!Array.isArray(items) || items.length === 0) {
    return "";
  }
  if (latestUserMessageByItemsRef.has(items)) {
    return latestUserMessageByItemsRef.get(items) ?? "";
  }
  const text = resolveLatestUserMessageFromItems(items);
  latestUserMessageByItemsRef.set(items, text);
  return text;
}

function resolveEntryTimestamp(
  thread: ThreadSummary,
  status: ThreadStatusSnapshot | undefined,
  lastAgent: LastAgentSnapshot | undefined,
) {
  return Math.max(
    thread.updatedAt ?? 0,
    lastAgent?.timestamp ?? 0,
    status?.processingStartedAt ?? 0,
  );
}

function clampDurationMs(durationMs: number | null | undefined) {
  if (durationMs == null || Number.isNaN(durationMs)) {
    return null;
  }
  return Math.max(0, durationMs);
}

function fingerprintConversationItem(item: ConversationItem | undefined) {
  if (!item) {
    return "";
  }
  if (item.kind === "tool") {
    return [
      item.id,
      item.kind,
      item.toolType,
      item.status ?? "",
      item.title ?? "",
      item.output?.length ?? 0,
      item.changes?.length ?? 0,
    ].join(":");
  }
  if (item.kind === "reasoning") {
    return [item.id, item.kind, item.summary.length, item.content.length].join(":");
  }
  if (item.kind === "explore") {
    return [item.id, item.kind, item.status ?? "", item.entries?.length ?? 0].join(":");
  }
  if (item.kind === "message") {
    return [item.id, item.kind, item.role, item.text.length].join(":");
  }
  return [item.id, item.kind].join(":");
}

function buildLiveThreadSignature(
  workspaceId: string,
  thread: ThreadSummary,
  status: ThreadStatusSnapshot | undefined,
  items: ConversationItem[] | undefined,
  lastAgent: LastAgentSnapshot | undefined,
) {
  const resolvedItems = items ?? [];
  const lastItem = resolvedItems[resolvedItems.length - 1];
  const previousItem = resolvedItems[resolvedItems.length - 2];
  return [
    workspaceId,
    thread.id,
    thread.name ?? "",
    String(thread.updatedAt ?? 0),
    String(Boolean(status?.isProcessing)),
    String(status?.processingStartedAt ?? 0),
    String(status?.lastDurationMs ?? 0),
    String(lastAgent?.timestamp ?? 0),
    // 只嵌长度而非全文：全文会让签名构建/比较随 agent 输出线性变贵，
    // 且流式期间每个 token 都要重建一条 O(文本长度) 的字符串。
    String(lastAgent?.text.length ?? 0),
    String(resolvedItems.length),
    fingerprintConversationItem(resolvedItems[0]),
    fingerprintConversationItem(previousItem),
    fingerprintConversationItem(lastItem),
  ].join("|");
}

function buildLiveSessionRadarEntry(input: {
  workspace: WorkspaceInfo;
  thread: ThreadSummary;
  status: ThreadStatusSnapshot | undefined;
  items: ConversationItem[] | undefined;
  lastAgent: LastAgentSnapshot | undefined;
  now: number;
}): SessionRadarEntry {
  const { workspace, thread, status, items, lastAgent, now } = input;
  const isProcessing = Boolean(status?.isProcessing);
  const updatedAt = resolveEntryTimestamp(thread, status, lastAgent);
  const preview =
    resolveLatestUserMessage(items) ||
    resolveLockLivePreview(items, lastAgent?.text);

  const entry: SessionRadarEntry = {
    id: `${workspace.id}:${thread.id}`,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    threadId: thread.id,
    threadName: thread.name?.trim() || "Untitled Thread",
    engine: (thread.engineSource || "codex").toUpperCase(),
    preview,
    updatedAt,
    isProcessing,
    startedAt: null,
    completedAt: null,
    durationMs: null,
  };

  if (!isProcessing) {
    return entry;
  }

  const startedAt = status?.processingStartedAt ?? null;
  entry.startedAt = startedAt;
  entry.durationMs = startedAt ? Math.max(0, now - startedAt) : null;
  return entry;
}

function buildRecentCountByWorkspace(entries: SessionRadarEntry[]) {
  const countByWorkspaceId: Record<string, number> = {};
  for (const entry of entries) {
    countByWorkspaceId[entry.workspaceId] = (countByWorkspaceId[entry.workspaceId] ?? 0) + 1;
  }
  return countByWorkspaceId;
}

function isRecentEntryDismissed(
  entryId: string,
  completedAt: number | null | undefined,
  dismissedCompletedAtById: Record<string, number>,
) {
  const dismissedCompletedAt = dismissedCompletedAtById[entryId];
  if (typeof dismissedCompletedAt !== "number" || !Number.isFinite(dismissedCompletedAt)) {
    return false;
  }
  const resolvedCompletedAt =
    typeof completedAt === "number" && Number.isFinite(completedAt) ? completedAt : 0;
  return resolvedCompletedAt > 0 && dismissedCompletedAt >= resolvedCompletedAt;
}

function readPersistedRecentSessions(): PersistedRecentSessionRef[] {
  const raw = getClientStoreSync<unknown>(RADAR_STORE_NAME, SESSION_RADAR_RECENT_STORAGE_KEY);
  if (!Array.isArray(raw) || raw.length === 0) {
    return [];
  }
  const dedupedById = new Map<string, PersistedRecentSessionRef>();
  for (const item of raw.map(parsePersistedRadarRecentEntry)) {
    if (!item) {
      continue;
    }
    const previous = dedupedById.get(item.id);
    if (!previous || previous.completedAt < item.completedAt) {
      dedupedById.set(item.id, item);
    }
  }
  return Array.from(dedupedById.values())
    .filter((item): item is PersistedRecentSessionRef => Boolean(item))
    .sort((left, right) => {
      const completedAtDiff = right.completedAt - left.completedAt;
      if (completedAtDiff !== 0) {
        return completedAtDiff;
      }
      return left.id.localeCompare(right.id);
    });
}

function readRecentHistorySnapshot(): RecentHistorySnapshot {
  return {
    dismissedCompletedAtById: readDismissedCompletedAtById(),
    persistedRecent: readPersistedRecentSessions(),
  };
}

function mergeRecentSessions(
  liveRecent: SessionRadarEntry[],
  persistedRecent: PersistedRecentSessionRef[],
  workspaces: WorkspaceInfo[],
  threadsByWorkspace: Record<string, ThreadSummary[]>,
  threadItemsByThread: Record<string, ConversationItem[]>,
  lastAgentMessageByThread: Record<string, LastAgentSnapshot | undefined>,
  recentLimit: number,
) {
  const mergedById = new Map<string, SessionRadarEntry>();
  for (const entry of liveRecent) {
    mergedById.set(entry.id, entry);
  }

  const workspaceById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
  const threadByWorkspaceAndId = new Map<string, ThreadSummary>();
  for (const workspace of workspaces) {
    const threads = threadsByWorkspace[workspace.id] ?? [];
    for (const thread of threads) {
      threadByWorkspaceAndId.set(`${workspace.id}:${thread.id}`, thread);
    }
  }

  for (const persistedEntry of persistedRecent) {
    const normalizedId = buildRadarCompletionId(persistedEntry.workspaceId, persistedEntry.threadId);
    const workspace = workspaceById.get(persistedEntry.workspaceId);
    const thread = threadByWorkspaceAndId.get(
      `${persistedEntry.workspaceId}:${persistedEntry.threadId}`,
    );
    const lastAgent = thread ? lastAgentMessageByThread[thread.id] : undefined;
    // updatedAt 用 live thread / lastAgent 刷新：条目删除时 cutoff 必须覆盖用户看到的
    // 这个值（见 sessionRadarHistoryManagement 的 liveUpdatedAt），否则 reconcile 会以
    // 领先的 thread.updatedAt 把已删除条目补写回来。completedAt 保持 persisted 原值。
    const liveUpdatedAt = thread
      ? Math.max(thread.updatedAt ?? 0, lastAgent?.timestamp ?? 0)
      : 0;
    const mergedEntry: SessionRadarEntry = {
      id: normalizedId,
      workspaceId: persistedEntry.workspaceId,
      workspaceName: workspace?.name || persistedEntry.workspaceName || persistedEntry.workspaceId,
      threadId: persistedEntry.threadId,
      threadName: thread?.name?.trim() || persistedEntry.threadName || "Untitled Thread",
      engine:
        (thread?.engineSource || persistedEntry.engine || "codex")
          .toString()
          .toUpperCase(),
      preview:
        resolveLatestUserMessage(thread ? threadItemsByThread[thread.id] : undefined) ||
        (thread ? resolveLockLivePreview(threadItemsByThread[thread.id], lastAgent?.text) : "") ||
        (persistedEntry.preview ?? ""),
      updatedAt: Math.max(persistedEntry.updatedAt ?? persistedEntry.completedAt, liveUpdatedAt),
      isProcessing: false,
      startedAt: persistedEntry.startedAt,
      completedAt: persistedEntry.completedAt,
      durationMs: persistedEntry.durationMs,
    };
    const previous = mergedById.get(normalizedId);
    if (!previous || previous.updatedAt <= mergedEntry.updatedAt) {
      mergedById.set(normalizedId, mergedEntry);
    }
  }
  return Array.from(mergedById.values())
    .sort(compareRadarEntriesByFreshness)
    .slice(0, recentLimit);
}

// 完成记录补偿：启动前已完成或跳变检测遗漏的 thread，用 thread.updatedAt 补写完成
// entry。受 dismissed cutoff 保护（updatedAt <= cutoff 跳过，已删除历史不复活）；
// 超出 TTL 的 thread 跳过——即便补写也会在 merge 惰性修剪时被淘汰；无活动证据
// （无 items 且无 lastAgent 快照）的 thread 跳过——空会话不补记。
function buildReconciledCompletionRefs(input: {
  workspaces: WorkspaceInfo[];
  threadsByWorkspace: Record<string, ThreadSummary[]>;
  threadStatusById: Record<string, ThreadStatusSnapshot | undefined>;
  threadItemsByThread: Record<string, ConversationItem[]>;
  lastAgentMessageByThread: Record<string, LastAgentSnapshot | undefined>;
  persistedRecent: PersistedRecentSessionRef[];
  dismissedCompletedAtById: Record<string, number>;
  now: number;
}): PersistedRecentSessionRef[] {
  const {
    workspaces,
    threadsByWorkspace,
    threadStatusById,
    threadItemsByThread,
    lastAgentMessageByThread,
    persistedRecent,
    dismissedCompletedAtById,
    now,
  } = input;
  const persistedById = new Map(persistedRecent.map((entry) => [entry.id, entry]));
  const reconciled: PersistedRecentSessionRef[] = [];
  for (const workspace of workspaces) {
    const threads = threadsByWorkspace[workspace.id] ?? [];
    for (const thread of threads) {
      const status = threadStatusById[thread.id];
      if (status?.isProcessing) {
        continue;
      }
      const updatedAt = thread.updatedAt ?? 0;
      if (updatedAt <= 0 || now - updatedAt > RADAR_RECENT_TTL_MS) {
        continue;
      }
      const id = buildRadarCompletionId(workspace.id, thread.id);
      const persisted = persistedById.get(id);
      if (persisted && persisted.completedAt >= updatedAt) {
        continue;
      }
      const dismissedCutoff = dismissedCompletedAtById[id] ?? 0;
      if (updatedAt <= dismissedCutoff) {
        continue;
      }
      const items = threadItemsByThread[thread.id];
      const lastAgent = lastAgentMessageByThread[thread.id];
      // 活动证据门槛：无任何 items 且没有 lastAgent 快照的 thread 从未在本端运行过
      // （例如仅被创建/重命名的空会话），不得仅凭 updatedAt 补记进「最近完成」。
      const hasActivityEvidence = (items?.length ?? 0) > 0 || lastAgent != null;
      if (!hasActivityEvidence) {
        continue;
      }
      const durationMs = clampDurationMs(status?.lastDurationMs);
      reconciled.push({
        id,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        threadId: thread.id,
        threadName: thread.name?.trim() || undefined,
        engine: (thread.engineSource || "codex").toUpperCase(),
        preview:
          resolveLatestUserMessage(items) ||
          resolveLockLivePreview(items, lastAgent?.text) ||
          undefined,
        updatedAt,
        startedAt: durationMs != null ? Math.max(0, updatedAt - durationMs) : null,
        completedAt: updatedAt,
        durationMs,
      });
    }
  }
  return reconciled;
}

export function buildSessionRadarFeed(input: BuildSessionRadarFeedInput): SessionRadarFeed {
  const {
    workspaces,
    threadsByWorkspace,
    threadStatusById,
    threadItemsByThread,
    lastAgentMessageByThread,
    now = Date.now(),
    runningLimit = DEFAULT_RUNNING_LIMIT,
    recentLimit = DEFAULT_RECENT_LIMIT,
  } = input;
  const runningSessions: SessionRadarEntry[] = [];
  const recentCompletedSessions: SessionRadarEntry[] = [];
  const runningCountByWorkspaceId: Record<string, number> = {};
  const recentCountByWorkspaceId: Record<string, number> = {};
  const seenRunningIds = new Set<string>();

  for (const workspace of workspaces) {
    const threads = threadsByWorkspace[workspace.id] ?? [];
    for (const thread of threads) {
      const status = threadStatusById[thread.id];
      const lastAgent = lastAgentMessageByThread[thread.id];
      const entry = buildLiveSessionRadarEntry({
        workspace,
        thread,
        status,
        items: threadItemsByThread[thread.id],
        lastAgent,
        now,
      });

      if (entry.isProcessing) {
        if (!seenRunningIds.has(entry.id)) {
          seenRunningIds.add(entry.id);
          runningSessions.push(entry);
        }
        runningCountByWorkspaceId[workspace.id] = (runningCountByWorkspaceId[workspace.id] ?? 0) + 1;
        continue;
      }

      // Completed sessions are sourced from persisted completion entries only.
      // Using thread.updatedAt here would make deleted history entries reappear
      // after unrelated thread updates or app restarts.
    }
  }

  runningSessions.sort(compareRadarEntriesByFreshness);
  recentCompletedSessions.sort(compareRadarEntriesByFreshness);

  return {
    runningSessions: runningSessions.slice(0, runningLimit),
    recentCompletedSessions: recentCompletedSessions.slice(0, recentLimit),
    runningCountByWorkspaceId,
    recentCountByWorkspaceId,
  };
}

type UseSessionRadarFeedInput = Omit<BuildSessionRadarFeedInput, "now"> & {
  runningLimit?: number;
  recentLimit?: number;
};

// 刻意没有秒级时钟:曾经这里有一个"回合进行中每秒 setClockNow"的 interval,而该 state
// 挂在 app-shell 根上,等于回合期间每秒强制整个 app-shell 重渲染一次(~200ms,1Hz 卡顿
// 主因);且运行中条目的实时时长没有任何 UI 消费(雷达面板只显示已完成条目的时长)。
// durationMs 只在 feed 因真实输入变化重建时刷新。
export function useSessionRadarFeed(input: UseSessionRadarFeedInput): SessionRadarFeed {
  const {
    workspaces,
    threadsByWorkspace,
    threadStatusById,
    threadItemsByThread,
    lastAgentMessageByThread,
    runningLimit,
    recentLimit,
  } = input;
  const resolvedRecentLimit = recentLimit ?? DEFAULT_RECENT_LIMIT;
  const [recentHistorySnapshot, setRecentHistorySnapshot] = useState<RecentHistorySnapshot>(() =>
    readRecentHistorySnapshot(),
  );
  const cachedLiveThreadEntriesRef = useRef<Record<string, CachedLiveThreadEntry>>({});

  const liveFeed = useMemo(
    () => {
      if (!isIncrementalDerivationEnabled()) {
        cachedLiveThreadEntriesRef.current = {};
        return buildSessionRadarFeed({
          workspaces,
          threadsByWorkspace,
          threadStatusById,
          threadItemsByThread,
          lastAgentMessageByThread,
          runningLimit,
          recentLimit: resolvedRecentLimit,
        });
      }

      const now = Date.now();
      const runningSessions: SessionRadarEntry[] = [];
      const runningCountByWorkspaceId: Record<string, number> = {};
      const recentCountByWorkspaceId: Record<string, number> = {};
      const seenRunningIds = new Set<string>();
      const nextCachedEntries: Record<string, CachedLiveThreadEntry> = {};

      for (const workspace of workspaces) {
        const threads = threadsByWorkspace[workspace.id] ?? [];
        for (const thread of threads) {
          const threadId = thread.id;
          const entryId = `${workspace.id}:${threadId}`;
          const status = threadStatusById[threadId];
          const items = threadItemsByThread[threadId];
          const lastAgent = lastAgentMessageByThread[threadId];
          const signature = buildLiveThreadSignature(
            workspace.id,
            thread,
            status,
            items,
            lastAgent,
          );
          const cachedEntry = cachedLiveThreadEntriesRef.current[entryId];
          const entry =
            cachedEntry && cachedEntry.signature === signature
              ? (() => {
                  const preserved = cachedEntry.entry;
                  if (!preserved.isProcessing || preserved.startedAt == null) {
                    return preserved;
                  }
                  const nextDurationMs = Math.max(0, now - preserved.startedAt);
                  const previousSeconds = Math.floor((preserved.durationMs ?? 0) / 1000);
                  const nextSeconds = Math.floor(nextDurationMs / 1000);
                  if (previousSeconds === nextSeconds) {
                    return preserved;
                  }
                  return {
                    ...preserved,
                    durationMs: nextDurationMs,
                  };
                })()
              : buildLiveSessionRadarEntry({
                  workspace,
                  thread,
                  status,
                  items,
                  lastAgent,
                  now,
                });
          nextCachedEntries[entryId] = {
            signature,
            entry,
          };
          if (!entry.isProcessing) {
            continue;
          }
          if (!seenRunningIds.has(entry.id)) {
            seenRunningIds.add(entry.id);
            runningSessions.push(entry);
          }
          runningCountByWorkspaceId[workspace.id] =
            (runningCountByWorkspaceId[workspace.id] ?? 0) + 1;
        }
      }

      cachedLiveThreadEntriesRef.current = nextCachedEntries;
      runningSessions.sort(compareRadarEntriesByFreshness);

      return {
        runningSessions: runningSessions.slice(0, runningLimit ?? DEFAULT_RUNNING_LIMIT),
        recentCompletedSessions: [],
        runningCountByWorkspaceId,
        recentCountByWorkspaceId,
      };
    },
    [
      lastAgentMessageByThread,
      resolvedRecentLimit,
      runningLimit,
      threadItemsByThread,
      threadStatusById,
      threadsByWorkspace,
      workspaces,
    ],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleRadarHistoryUpdated = () => {
      setRecentHistorySnapshot(readRecentHistorySnapshot());
    };
    window.addEventListener(SESSION_RADAR_HISTORY_UPDATED_EVENT, handleRadarHistoryUpdated);
    return () => {
      window.removeEventListener(SESSION_RADAR_HISTORY_UPDATED_EVENT, handleRadarHistoryUpdated);
    };
  }, []);

  // reconcile 只需在 threads/status/history 快照变化时重算；items 与 lastAgent 只
  // 用于候选 entry 的 preview，经 ref 读取最新快照，避免流式期间高频引用变化触发
  // W×T 全量扫描（与 completion tracker 的 completionPreviewItemsRef 同一考虑）。
  const reconcileItemsRef = useRef(threadItemsByThread);
  reconcileItemsRef.current = threadItemsByThread;
  const reconcileLastAgentRef = useRef(lastAgentMessageByThread);
  reconcileLastAgentRef.current = lastAgentMessageByThread;

  const reconciledRecentCompletions = useMemo(
    () =>
      buildReconciledCompletionRefs({
        workspaces,
        threadsByWorkspace,
        threadStatusById,
        threadItemsByThread: reconcileItemsRef.current,
        lastAgentMessageByThread: reconcileLastAgentRef.current,
        persistedRecent: recentHistorySnapshot.persistedRecent,
        dismissedCompletedAtById: recentHistorySnapshot.dismissedCompletedAtById,
        now: Date.now(),
      }),
    [recentHistorySnapshot, threadStatusById, threadsByWorkspace, workspaces],
  );

  const mergedRecentFeed = useMemo(() => {
    const mergedRecent = mergeRecentSessions(
      liveFeed.recentCompletedSessions,
      [...recentHistorySnapshot.persistedRecent, ...reconciledRecentCompletions],
      workspaces,
      threadsByWorkspace,
      threadItemsByThread,
      lastAgentMessageByThread,
      resolvedRecentLimit,
    );
    // merge 时惰性修剪（TTL + 每 workspace / 全局上限）；prunedEntryIds 交给持久化
    // effect 同步清理 dismissedCompletedAtById 中的死数据。
    const { entries: boundedRecent, prunedEntryIds } = applyRadarRecentBounds(mergedRecent);
    // dismissed 联动清理只覆盖「曾物理存在于 persisted 快照」的 id：reconcile 合成
    // 条目被 bounds 淘汰时不许连带销毁用户删除留下的 cutoff，否则下一轮 reconcile
    // 会把该条目补写回来（复活循环）。
    const persistedEntryIds = new Set(
      recentHistorySnapshot.persistedRecent.map((entry) => entry.id),
    );
    const physicallyPrunedEntryIds = prunedEntryIds.filter((entryId) =>
      persistedEntryIds.has(entryId),
    );
    const visibleRecent = boundedRecent.filter(
      (entry) =>
        !isRecentEntryDismissed(
          entry.id,
          entry.completedAt,
          recentHistorySnapshot.dismissedCompletedAtById,
        ),
    );
    return {
      ...liveFeed,
      recentCompletedSessions: visibleRecent,
      recentCountByWorkspaceId: buildRecentCountByWorkspace(visibleRecent),
      prunedEntryIds: physicallyPrunedEntryIds,
    };
  }, [
    lastAgentMessageByThread,
    liveFeed,
    reconciledRecentCompletions,
    resolvedRecentLimit,
    recentHistorySnapshot,
    threadItemsByThread,
    threadsByWorkspace,
    workspaces,
  ]);

  const lastPersistedRecentSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    const persistedRecentRefs: PersistedRecentSessionRef[] =
      mergedRecentFeed.recentCompletedSessions.map((entry) => ({
        id: entry.id,
        workspaceId: entry.workspaceId,
        workspaceName: entry.workspaceName,
        threadId: entry.threadId,
        threadName: entry.threadName,
        engine: entry.engine,
        preview: entry.preview,
        updatedAt: entry.updatedAt,
        startedAt: entry.startedAt,
        completedAt: entry.completedAt ?? entry.updatedAt,
        durationMs: entry.durationMs,
      }));
    // The recentCompletedSessions reference churns on every deferred settle while a turn
    // streams, but its persisted content rarely changes mid-stream. Skip the redundant
    // immediate disk writes (which bypass the 300ms debounce and contend with streaming IPC)
    // when the serialized content is unchanged.
    const persistedRecentSignature = JSON.stringify(persistedRecentRefs);
    if (persistedRecentSignature === lastPersistedRecentSignatureRef.current) {
      return;
    }
    lastPersistedRecentSignatureRef.current = persistedRecentSignature;
    writeClientStoreValue(RADAR_STORE_NAME, SESSION_RADAR_RECENT_STORAGE_KEY, persistedRecentRefs, {
      immediate: true,
    });

    const existingReadState =
      getClientStoreSync<Record<string, number>>(RADAR_STORE_NAME, SESSION_RADAR_READ_STATE_KEY) ??
      {};
    const activeIds = new Set(persistedRecentRefs.map((entry) => entry.id));
    const prunedReadState = Object.fromEntries(
      Object.entries(existingReadState).filter(([entryId]) => activeIds.has(entryId)),
    );
    writeClientStoreValue(RADAR_STORE_NAME, SESSION_RADAR_READ_STATE_KEY, prunedReadState, {
      immediate: true,
    });

    // 惰性修剪物理移除的条目，其 dismissed 记录一并清除；用户主动删除的条目不走
    // bounds 修剪（不在 prunedEntryIds 内），cutoff 保留以防止 reconcile 复活。
    if (mergedRecentFeed.prunedEntryIds.length > 0) {
      const prunedIdSet = new Set(mergedRecentFeed.prunedEntryIds);
      const existingDismissed =
        getClientStoreSync<Record<string, number>>(
          RADAR_STORE_NAME,
          SESSION_RADAR_DISMISSED_COMPLETED_AT_BY_ID_KEY,
        ) ?? {};
      const nextDismissed = Object.fromEntries(
        Object.entries(existingDismissed).filter(([entryId]) => !prunedIdSet.has(entryId)),
      );
      if (Object.keys(nextDismissed).length !== Object.keys(existingDismissed).length) {
        writeClientStoreValue(
          RADAR_STORE_NAME,
          SESSION_RADAR_DISMISSED_COMPLETED_AT_BY_ID_KEY,
          nextDismissed,
          { immediate: true },
        );
      }
    }
  }, [mergedRecentFeed]);

  // 计数记录每次重建都是新对象；Sidebar 把它们当 props，引用一变就整树重渲染。
  // 内容未变时复用上一次的引用，让流式期间的 flush 不再击穿 Sidebar 的 memo。
  const stableRunningCountRef = useRef<Record<string, number> | null>(null);
  const stableRecentCountRef = useRef<Record<string, number> | null>(null);
  const runningCountByWorkspaceId = reuseShallowEqualCountRecord(
    stableRunningCountRef,
    mergedRecentFeed.runningCountByWorkspaceId,
  );
  const recentCountByWorkspaceId = reuseShallowEqualCountRecord(
    stableRecentCountRef,
    mergedRecentFeed.recentCountByWorkspaceId,
  );
  return useMemo(
    () => ({
      runningSessions: mergedRecentFeed.runningSessions,
      recentCompletedSessions: mergedRecentFeed.recentCompletedSessions,
      runningCountByWorkspaceId,
      recentCountByWorkspaceId,
    }),
    [mergedRecentFeed, runningCountByWorkspaceId, recentCountByWorkspaceId],
  );
}

function reuseShallowEqualCountRecord(
  ref: { current: Record<string, number> | null },
  next: Record<string, number>,
): Record<string, number> {
  const previous = ref.current;
  if (previous) {
    const previousKeys = Object.keys(previous);
    const nextKeys = Object.keys(next);
    if (
      previousKeys.length === nextKeys.length &&
      nextKeys.every((key) => previous[key] === next[key])
    ) {
      return previous;
    }
  }
  ref.current = next;
  return next;
}
