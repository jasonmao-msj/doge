// 流式正文 live-text 外部化通道（perf flag: liveTextExternalization）。
//
// 背景：流式期间每条正文 delta 若都 dispatch 进根 reducer，就会以每秒多次的
// 频率换 itemsByThread 引用并触发 AppShell（根组件）全树重渲染，单次端到端
// 100ms+。本通道让「首条 delta 建壳、后续 delta 只更新此处并按 cadence 通知
// MessageRow 小树、回合结束终稿一次性落 reducer」，把每回合根渲染压到 2 次。
//
// 设计要点：
// - 按 threadId 建模（每线程同时只有一个活跃流式正文）；「这行是否消费通道
//   文本」交给渲染层既有的 isStreaming 判定，从而绕开 reducer 对 item id 的
//   canonicalize/分段改写与事件层 itemId 不一致的问题。
// - 纯内存、无持久化。断流恢复由 liveAssistantShadowTranscript（独立写入）
//   兜底，本通道不参与恢复。
// - 首条 delta 全量记录（text 从首段起累计），渲染侧可直接用 entry.text，
//   无需与壳文本拼接。
// 方案文档：docs/perf/a4-live-text-externalization-plan.md

export type LiveAssistantTextEntry = {
  itemId: string;
  text: string;
  version: number;
  /** 首条 delta（已随建壳 dispatch 落入 reducer）的长度，供中断时 drain 尾段。 */
  shellTextLength: number;
};

export const LIVE_ASSISTANT_TEXT_PUBLISH_INTERVAL_MS = 48;

/** 每条 delta 的权威内存累积值；terminal drain 必须从这里读取。 */
const entriesByThread = new Map<string, LiveAssistantTextEntry>();
/** React 可观察快照；仅允许在 notify 前换引用。 */
const publishedEntriesByThread = new Map<string, LiveAssistantTextEntry>();
const listenersByThread = new Map<string, Set<() => void>>();
const publishTimersByThread = new Map<string, ReturnType<typeof setTimeout>>();
const lastPublishedAtByThread = new Map<string, number>();

function notifyThread(threadId: string): void {
  const listeners = listenersByThread.get(threadId);
  if (!listeners) {
    return;
  }
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      console.error("[liveAssistantTextChannel] listener failed", error);
    }
  }
}

function cancelPendingPublish(threadId: string): void {
  const timer = publishTimersByThread.get(threadId);
  if (timer !== undefined) {
    clearTimeout(timer);
    publishTimersByThread.delete(threadId);
  }
}

function publishEntry(threadId: string, entry: LiveAssistantTextEntry): void {
  cancelPendingPublish(threadId);
  publishedEntriesByThread.set(threadId, entry);
  lastPublishedAtByThread.set(threadId, Date.now());
  notifyThread(threadId);
}

function publishLatestEntry(threadId: string): void {
  publishTimersByThread.delete(threadId);
  const entry = entriesByThread.get(threadId);
  if (!entry) {
    return;
  }
  publishEntry(threadId, entry);
}

function scheduleEntryPublish(
  threadId: string,
  entry: LiveAssistantTextEntry,
): void {
  const lastPublishedAt = lastPublishedAtByThread.get(threadId);
  const elapsed = lastPublishedAt === undefined
    ? LIVE_ASSISTANT_TEXT_PUBLISH_INTERVAL_MS
    : Date.now() - lastPublishedAt;
  if (elapsed >= LIVE_ASSISTANT_TEXT_PUBLISH_INTERVAL_MS) {
    publishEntry(threadId, entry);
    return;
  }
  if (publishTimersByThread.has(threadId)) {
    return;
  }
  publishTimersByThread.set(
    threadId,
    setTimeout(
      () => publishLatestEntry(threadId),
      LIVE_ASSISTANT_TEXT_PUBLISH_INTERVAL_MS - elapsed,
    ),
  );
}

/**
 * 若通道内已有「不同 itemId」的正文，取走其尚未落 reducer 的尾段并清空条目。
 *
 * Gemini/Grok/Kimi 在 Text↔Reasoning 交错时会为每个 text run 生成新 itemId
 *（`base:text-2`…）。live 通道按 thread 只有一条活跃正文；若不在 itemId 切换
 * 前 drain，上一段只剩建壳首 delta，界面会变成「先」「截」这类单字碎片，
 * 历史重载才恢复完整正文。
 */
export function drainLiveAssistantTextTailIfItemChanged(
  threadId: string,
  nextItemId: string,
): { itemId: string; tailDelta: string } | null {
  const existing = entriesByThread.get(threadId);
  if (!existing || existing.itemId === nextItemId) {
    return null;
  }
  return drainLiveAssistantTextTail(threadId);
}

/**
 * 累计一条正文 delta。
 * - 线程无条目或 itemId 变化（新回合/分段切换/别名 id）→ 重置条目并返回
 *   isFirst=true，调用方应照旧 dispatch 该条 delta 以便 reducer 建壳。
 * - 否则无损追加文本并按 publish cadence 通知订阅者，返回 isFirst=false，
 *   调用方跳过 dispatch。
 *
 * 调用方在 itemId 可能变化时必须先
 * {@link drainLiveAssistantTextTailIfItemChanged}，否则上一段尾部会丢失。
 */
export function appendLiveAssistantText(
  threadId: string,
  itemId: string,
  delta: string,
): { isFirst: boolean } {
  const existing = entriesByThread.get(threadId);
  if (!existing || existing.itemId !== itemId) {
    const nextEntry = {
      itemId,
      text: delta,
      version: 1,
      shellTextLength: delta.length,
    };
    entriesByThread.set(threadId, nextEntry);
    publishEntry(threadId, nextEntry);
    return { isFirst: true };
  }
  const nextEntry = {
    itemId: existing.itemId,
    text: existing.text + delta,
    version: existing.version + 1,
    shellTextLength: existing.shellTextLength,
  };
  entriesByThread.set(threadId, nextEntry);
  scheduleEntryPublish(threadId, nextEntry);
  return { isFirst: false };
}

export type LiveAssistantSnapshotUpdate =
  | "first"
  | "growth"
  | "unchanged"
  | "replacement";

/**
 * 接收 runtime 的 cumulative assistant snapshot。
 * 只有同 item 的单调正文增长可留在通道；缩短或改写交给 durable reducer，
 * 避免把结构性 replacement 误判成 append。
 */
export function updateLiveAssistantTextSnapshot(
  threadId: string,
  itemId: string,
  text: string,
): LiveAssistantSnapshotUpdate {
  const existing = entriesByThread.get(threadId);
  if (!existing || existing.itemId !== itemId) {
    const nextEntry = {
      itemId,
      text,
      version: 1,
      shellTextLength: text.length,
    };
    entriesByThread.set(threadId, nextEntry);
    publishEntry(threadId, nextEntry);
    return "first";
  }
  if (text === existing.text) {
    return "unchanged";
  }
  if (!text.startsWith(existing.text)) {
    return "replacement";
  }
  const nextEntry = {
    ...existing,
    text,
    version: existing.version + 1,
  };
  entriesByThread.set(threadId, nextEntry);
  scheduleEntryPublish(threadId, nextEntry);
  return "growth";
}

/** 回合结束/线程删除时清除条目（订阅行随之切回读 item.text）。 */
export function clearLiveAssistantText(threadId: string): void {
  cancelPendingPublish(threadId);
  entriesByThread.delete(threadId);
  lastPublishedAtByThread.delete(threadId);
  if (publishedEntriesByThread.delete(threadId)) {
    notifyThread(threadId);
  }
}

/**
 * 读权威累积正文（entriesByThread），不是 48ms publish 节流后的 published 快照。
 * complete / terminal salvage 必须用这个，否则会漏掉尚未 publish 的尾段。
 */
export function peekLiveAssistantText(
  threadId: string,
): LiveAssistantTextEntry | null {
  return entriesByThread.get(threadId) ?? null;
}

/**
 * 为 complete/settle 选择应写入 durable state 的终稿。
 *
 * A4 路径下 reducer 往往只有建壳首段（例如 Markdown 的 `**`），全文在通道里。
 * 若 provider 终稿为空/偏短却 `clearLiveAssistantText`，UI 会在 isStreaming 结束后
 * 回退到壳文本，重开历史才恢复——本函数在 clear 前把更完整的一侧保住。
 *
 * 不修改通道；调用方写入 reducer 后再 clear/drain。
 */
export function resolveLiveAssistantSettlementText(
  threadId: string,
  completedText: string,
): string {
  const liveText = entriesByThread.get(threadId)?.text ?? "";
  const completed = completedText ?? "";
  if (!liveText) {
    return completed;
  }
  if (!completed) {
    return liveText;
  }
  if (liveText === completed) {
    return completed;
  }
  // provider 终稿只是 live 前缀（不完整 complete）→ 保留通道全文
  if (liveText.startsWith(completed)) {
    return liveText;
  }
  // 正常路径：complete 已是 live 的超集
  if (completed.startsWith(liveText)) {
    return completed;
  }
  // 两侧有分叉时取更长者，避免 clear 后不可恢复地丢掉通道正文
  return liveText.length >= completed.length ? liveText : completed;
}

/**
 * terminal settlement / 中断时取走「尚未落入 reducer 的尾段」并清除条目。
 * 调用方应把 tailDelta 作为一条普通 delta dispatch，让被中断的部分正文
 * 落进 items（否则退出 streaming 后该行会回退到壳首段）。
 */
export function drainLiveAssistantTextTail(
  threadId: string,
): { itemId: string; tailDelta: string } | null {
  const entry = entriesByThread.get(threadId);
  if (!entry) {
    return null;
  }
  cancelPendingPublish(threadId);
  entriesByThread.delete(threadId);
  lastPublishedAtByThread.delete(threadId);
  if (publishedEntriesByThread.delete(threadId)) {
    notifyThread(threadId);
  }
  if (entry.text.length <= entry.shellTextLength) {
    return null;
  }
  return {
    itemId: entry.itemId,
    tailDelta: entry.text.slice(entry.shellTextLength),
  };
}

/** 会话 id 迁移（pending → canonical）时随迁条目。 */
export function renameLiveAssistantTextThread(
  oldThreadId: string,
  newThreadId: string,
): void {
  if (oldThreadId === newThreadId) {
    return;
  }
  const entry = entriesByThread.get(oldThreadId);
  const publishedEntry = publishedEntriesByThread.get(oldThreadId);
  if (!entry && !publishedEntry) {
    return;
  }
  cancelPendingPublish(oldThreadId);
  cancelPendingPublish(newThreadId);
  entriesByThread.delete(oldThreadId);
  publishedEntriesByThread.delete(oldThreadId);
  lastPublishedAtByThread.delete(oldThreadId);
  if (entry) {
    entriesByThread.set(newThreadId, entry);
    publishEntry(newThreadId, entry);
  } else if (publishedEntry) {
    publishedEntriesByThread.set(newThreadId, publishedEntry);
    lastPublishedAtByThread.set(newThreadId, Date.now());
    notifyThread(newThreadId);
  }
  if (publishedEntry) {
    notifyThread(oldThreadId);
  }
}

export function getLiveAssistantTextSnapshot(
  threadId: string,
): LiveAssistantTextEntry | null {
  return publishedEntriesByThread.get(threadId) ?? null;
}

export function subscribeLiveAssistantText(
  threadId: string,
  listener: () => void,
): () => void {
  let listeners = listenersByThread.get(threadId);
  if (!listeners) {
    listeners = new Set();
    listenersByThread.set(threadId, listeners);
  }
  listeners.add(listener);
  return () => {
    const current = listenersByThread.get(threadId);
    if (!current) {
      return;
    }
    current.delete(listener);
    if (current.size === 0) {
      listenersByThread.delete(threadId);
    }
  };
}

export function resetLiveAssistantTextChannelForTests(): void {
  for (const timer of publishTimersByThread.values()) {
    clearTimeout(timer);
  }
  publishTimersByThread.clear();
  entriesByThread.clear();
  publishedEntriesByThread.clear();
  lastPublishedAtByThread.clear();
  listenersByThread.clear();
}
