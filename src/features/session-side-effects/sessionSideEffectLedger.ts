/**
 * Session Side-Effect Ledger（客户端 durable 切片）
 *
 * 统一承载：
 * - fileEdits：Composer「已编辑」Strip
 * - subagents：侧栏父子树 + Strip 子代理 pill 的补充源
 *
 * UI 组件零改：投影为既有 TurnFileChangesSummary / ThreadSummary pending 形态。
 * 持久化：localStorage（会话级）；删会话可 GC。
 */
import type { ConversationItem } from "../../types";
import type { TurnFileChange, TurnFileChangesSummary } from "../messages/utils/turnFileChanges";
import {
  buildTurnFileChangesByBoundaryId,
  mergeTurnFileChangesSummaries,
} from "../messages/utils/turnFileChanges";
import { collectRunStatusSourceItems } from "../composer/components/run-status/collectRunStatusSourceItems";

const STORAGE_KEY = "doge.sessionSideEffectLedger.v1";

export type LedgerSubagentEntry = {
  id: string;
  name: string;
  parentSessionId: string;
  status: "running" | "completed" | "failed" | "unknown";
  engineSource?: string | null;
  updatedAt: number;
};

export type SessionSideEffectRecord = {
  threadId: string;
  fileEdits: TurnFileChange[];
  totalAdditions: number;
  totalDeletions: number;
  subagents: LedgerSubagentEntry[];
  updatedAt: number;
};

type LedgerStore = Record<string, SessionSideEffectRecord>;

const memory: { store: LedgerStore } = { store: {} };
let hydrated = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // ignore
    }
  });
}

function readStorage(): LedgerStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as LedgerStore;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStorage(store: LedgerStore) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // quota / private mode
  }
}

function ensureHydrated() {
  if (hydrated) return;
  hydrated = true;
  memory.store = readStorage();
}

export function subscribeSessionSideEffectLedger(listener: () => void): () => void {
  ensureHydrated();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSessionSideEffectRecord(
  threadId: string | null | undefined,
): SessionSideEffectRecord | null {
  ensureHydrated();
  const id = threadId?.trim() ?? "";
  if (!id) return null;
  return memory.store[id] ?? null;
}

export function ledgerToFileChangesSummary(
  threadId: string | null | undefined,
): TurnFileChangesSummary | null {
  const record = getSessionSideEffectRecord(threadId);
  if (!record || record.fileEdits.length === 0) return null;
  return {
    files: record.fileEdits,
    totalAdditions: record.totalAdditions,
    totalDeletions: record.totalDeletions,
  };
}

/** 保留历史 path；同一 path 以最新扫描为准（避免重复扫同一 diff 双计）。 */
function mergeFileEdits(
  prev: TurnFileChange[],
  next: TurnFileChange[],
): TurnFileChange[] {
  const byPath = new Map<string, TurnFileChange>();
  for (const f of prev) {
    if (f.path.trim()) byPath.set(f.path, { ...f });
  }
  for (const f of next) {
    const path = f.path.trim();
    if (!path) continue;
    byPath.set(path, { ...f, path });
  }
  return Array.from(byPath.values()).filter(
    (f) => f.additions > 0 || f.deletions > 0,
  );
}

/**
 * 从当前对话 items（含 agent-canvas fan-in）刷新文件账本。
 * 仅当扫到非空变更时写入，避免空扫描抹掉历史账本。
 */
export function ingestFileEditsFromConversationItems(input: {
  threadId: string | null | undefined;
  mainItems: ConversationItem[];
  threadItemsByThread?: Record<string, ConversationItem[] | undefined>;
}): TurnFileChangesSummary | null {
  ensureHydrated();
  const threadId = input.threadId?.trim() ?? "";
  if (!threadId) return ledgerToFileChangesSummary(null);

  const sourceItems = collectRunStatusSourceItems({
    mainItems: input.mainItems,
    threadItemsByThread: input.threadItemsByThread,
    activeThreadId: threadId,
  });
  const scanned = mergeTurnFileChangesSummaries(
    buildTurnFileChangesByBoundaryId(sourceItems).values(),
  );

  const existing = memory.store[threadId];
  if (!scanned || scanned.files.length === 0) {
    return existing
      ? {
          files: existing.fileEdits,
          totalAdditions: existing.totalAdditions,
          totalDeletions: existing.totalDeletions,
        }
      : null;
  }

  const mergedFiles = mergeFileEdits(existing?.fileEdits ?? [], scanned.files);
  const totalAdditions = mergedFiles.reduce((s, f) => s + f.additions, 0);
  const totalDeletions = mergedFiles.reduce((s, f) => s + f.deletions, 0);
  const next: SessionSideEffectRecord = {
    threadId,
    fileEdits: mergedFiles,
    totalAdditions,
    totalDeletions,
    subagents: existing?.subagents ?? [],
    updatedAt: Date.now(),
  };
  memory.store = { ...memory.store, [threadId]: next };
  writeStorage(memory.store);
  emit();
  return {
    files: mergedFiles,
    totalAdditions,
    totalDeletions,
  };
}

export function removeFileEditPaths(
  threadId: string | null | undefined,
  paths: string[],
): void {
  ensureHydrated();
  const id = threadId?.trim() ?? "";
  if (!id || paths.length === 0) return;
  const existing = memory.store[id];
  if (!existing) return;
  const drop = new Set(paths.map((p) => p.trim()).filter(Boolean));
  const fileEdits = existing.fileEdits.filter((f) => !drop.has(f.path));
  const totalAdditions = fileEdits.reduce((s, f) => s + f.additions, 0);
  const totalDeletions = fileEdits.reduce((s, f) => s + f.deletions, 0);
  memory.store = {
    ...memory.store,
    [id]: {
      ...existing,
      fileEdits,
      totalAdditions,
      totalDeletions,
      updatedAt: Date.now(),
    },
  };
  writeStorage(memory.store);
  emit();
}

/**
 * 记录/更新子代理条目（侧栏与 strip 共用）。
 */
export function upsertLedgerSubagent(entry: LedgerSubagentEntry): void {
  ensureHydrated();
  const parent = entry.parentSessionId.trim();
  const childId = entry.id.trim();
  if (!parent || !childId) return;
  const existing = memory.store[parent];
  const list = existing?.subagents ?? [];
  const idx = list.findIndex((s) => s.id === childId);
  const nextList =
    idx >= 0
      ? list.map((s, i) => (i === idx ? { ...s, ...entry, id: childId, parentSessionId: parent } : s))
      : [...list, { ...entry, id: childId, parentSessionId: parent }];
  memory.store = {
    ...memory.store,
    [parent]: {
      threadId: parent,
      fileEdits: existing?.fileEdits ?? [],
      totalAdditions: existing?.totalAdditions ?? 0,
      totalDeletions: existing?.totalDeletions ?? 0,
      subagents: nextList,
      updatedAt: Date.now(),
    },
  };
  writeStorage(memory.store);
  emit();
}

export function listLedgerSubagents(
  parentSessionId: string | null | undefined,
): LedgerSubagentEntry[] {
  ensureHydrated();
  const id = parentSessionId?.trim() ?? "";
  if (!id) return [];
  return memory.store[id]?.subagents ?? [];
}

/** 测试用：重置内存与 hydration 标记 */
export function __resetSessionSideEffectLedgerForTests() {
  memory.store = {};
  hydrated = false;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}
