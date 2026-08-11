import type { ConversationItem } from "../../../types/conversation";
import {
  isCollabInternalPromptText,
  isCollabSummaryPromptText,
  stripCollabInternalPrompt,
} from "./collabPrompt";

/**
 * 主幕布 multi-agent 锚点身份与时间线纠偏。
 *
 * 轮次铁律：
 * - 每个 run 各自保留 user + hist-fold，**禁止**按相同文案跨 run 去重
 * - fold 只能挂到**本 run** 的 user 之后；找不到 user 时保持原相对顺序，禁止抢挂最后一个 user
 * - 同一 user 下多张 fold 按原列表顺序插入（禁止逆序）
 */

const SQUAD_USER_RE = /^squad:(.+):user$/;
const AGENT_USER_RE = /^agent:(.+):user$/;
const SQUAD_PENDING_USER_RE = /^squad:pending-.+:user$/;
const SQUAD_ASSISTANT_RE = /^squad:(.+):assistant$/;
const AGENT_ASSISTANT_RE = /^agent:(.+):assistant$/;
const HIST_FOLD_RE = /^agent:(.+):(hist-fold|orch-card)$/;

export function multiAgentUserItemId(runId: string): string {
  return `squad:${runId}:user`;
}

export function multiAgentHistFoldItemId(runId: string): string {
  return `agent:${runId}:hist-fold`;
}

/** 协作发送瞬间的可见用户气泡（run 尚未创建时） */
export function multiAgentPendingUserItemId(nonce: string): string {
  return `squad:pending-${nonce}:user`;
}

export function parseMultiAgentUserRunId(
  id: string | null | undefined,
): string | null {
  if (!id) return null;
  if (SQUAD_PENDING_USER_RE.test(id)) return null;
  const squad = id.match(SQUAD_USER_RE);
  if (squad?.[1]) return squad[1];
  const agent = id.match(AGENT_USER_RE);
  if (agent?.[1]) return agent[1];
  return null;
}

export function parseMultiAgentHistFoldRunId(
  id: string | null | undefined,
): string | null {
  if (!id) return null;
  const m = id.match(HIST_FOLD_RE);
  return m?.[1] ?? null;
}

export function isMultiAgentHistFoldItemId(
  id: string | null | undefined,
): boolean {
  return Boolean(id && HIST_FOLD_RE.test(id));
}

export function isMultiAgentSettledSummaryItemId(
  id: string | null | undefined,
): boolean {
  if (!id) return false;
  return SQUAD_ASSISTANT_RE.test(id) || AGENT_ASSISTANT_RE.test(id);
}

function isPendingMultiAgentUserId(id: string): boolean {
  return SQUAD_PENDING_USER_RE.test(id);
}

function multiAgentUserIdsForRun(runId: string): Set<string> {
  return new Set([multiAgentUserItemId(runId), `agent:${runId}:user`]);
}

export function findMultiAgentUserIndex(
  list: readonly ConversationItem[],
  runId: string,
): number {
  const userIds = multiAgentUserIdsForRun(runId);
  return list.findIndex(
    (entry) =>
      entry.kind === "message" &&
      entry.role === "user" &&
      userIds.has(entry.id),
  );
}

export function resolveMultiAgentHistFoldInsertIndex(
  list: readonly ConversationItem[],
  foldItemId: string,
): number | null {
  const runId = parseMultiAgentHistFoldRunId(foldItemId);
  if (!runId) return null;
  const userIdx = findMultiAgentUserIndex(list, runId);
  if (userIdx < 0) return null;
  // 插在该 user 之后连续 fold 的末尾，避免多轮 fold 互抢 userIdx+1 逆序
  let insertAt = userIdx + 1;
  while (
    insertAt < list.length &&
    list[insertAt]?.kind === "message" &&
    isMultiAgentHistFoldItemId(
      (list[insertAt] as { id?: string }).id ?? "",
    )
  ) {
    insertAt += 1;
  }
  return insertAt;
}

/**
 * 把各 run 的 hist-fold 挪到**本 run user** 正后方。
 * - 禁止抢挂「最后一个任意 user」
 * - 同一 user 下多张 fold 保持原列表相对顺序
 * - 找不到本 run user 的 fold 按原相对顺序追加在末尾
 */
export function relocateMultiAgentHistFolds(
  items: readonly ConversationItem[],
): ConversationItem[] {
  type Placement = {
    fold: ConversationItem;
    origOrder: number;
    userIdx: number;
  };

  const folds: { fold: ConversationItem; origOrder: number }[] = [];
  const rest: ConversationItem[] = [];
  let order = 0;
  for (const item of items) {
    if (item.kind === "message" && isMultiAgentHistFoldItemId(item.id)) {
      folds.push({ fold: item, origOrder: order++ });
    } else {
      rest.push(item);
    }
  }
  if (folds.length === 0) return items as ConversationItem[];

  const placements: Placement[] = folds.map(({ fold, origOrder }) => {
    const runId = parseMultiAgentHistFoldRunId(fold.id);
    const userIdx =
      runId != null ? findMultiAgentUserIndex(rest, runId) : -1;
    return { fold, origOrder, userIdx };
  });

  const withUser = placements
    .filter((p) => p.userIdx >= 0)
    .sort((a, b) => {
      if (a.userIdx !== b.userIdx) return a.userIdx - b.userIdx;
      return a.origOrder - b.origOrder;
    });
  const orphans = placements
    .filter((p) => p.userIdx < 0)
    .sort((a, b) => a.origOrder - b.origOrder);

  // 从后往前按 user 分组插入，避免下标漂移
  const byUser = new Map<number, ConversationItem[]>();
  for (const p of withUser) {
    const list = byUser.get(p.userIdx) ?? [];
    list.push(p.fold);
    byUser.set(p.userIdx, list);
  }

  let result = [...rest];
  const userIndices = [...byUser.keys()].sort((a, b) => b - a);
  for (const userIdx of userIndices) {
    const group = byUser.get(userIdx) ?? [];
    result = [
      ...result.slice(0, userIdx + 1),
      ...group,
      ...result.slice(userIdx + 1),
    ];
  }

  if (orphans.length > 0) {
    result = [...result, ...orphans.map((p) => p.fold)];
  }
  return result;
}

function userMessageHasRenderableAttachment(
  item: Extract<ConversationItem, { kind: "message" }>,
): boolean {
  if (Array.isArray(item.images) && item.images.some((path) => path.trim().length > 0)) {
    return true;
  }
  if (Array.isArray(item.deferredImages) && item.deferredImages.length > 0) {
    return true;
  }
  if (item.browserContextAttachment) {
    return true;
  }
  if (
    Array.isArray(item.intentCanvasContextAttachments) &&
    item.intentCanvasContextAttachments.length > 0
  ) {
    return true;
  }
  return false;
}

/**
 * 协作内部提示词从 user 气泡剥离。
 * - 纯内部提示（无用户原文、无附图）→ null（整段隐藏）
 * - **纯图 / 仅附件**（正文清理后为空但仍有 images 等）→ 保留，text 置空
 *   这是跨引擎（Claude/Grok/…）「只发图」幕布可见的关键路径：
 *   `resolveCollapsedTimelineItems` 对所有会话都先跑 `filterMultiAgentCanvasItems`。
 */
function normalizeUserItemText(
  item: Extract<ConversationItem, { kind: "message" }>,
): Extract<ConversationItem, { kind: "message" }> | null {
  if (item.role !== "user") return item;
  const cleaned = stripCollabInternalPrompt(item.text);
  if (!cleaned) {
    // 纯内部提示词：无图则隐藏；有图/附件则保留为空正文气泡
    if (userMessageHasRenderableAttachment(item)) {
      return cleaned === item.text ? item : { ...item, text: "" };
    }
    return null;
  }
  if (cleaned === item.text) return item;
  return { ...item, text: cleaned };
}

/** 空正文去重不能只靠 text，否则多条纯图会被互相吃掉 */
function userMessageDedupeKey(
  item: Extract<ConversationItem, { kind: "message" }>,
): string {
  const textKey = item.text.trim();
  if (textKey.length > 0) {
    return `t:${textKey}`;
  }
  const images = (item.images ?? [])
    .map((path) => path.trim())
    .filter((path) => path.length > 0)
    .join("\0");
  if (images.length > 0) {
    return `i:${images}`;
  }
  return `id:${item.id}`;
}

/**
 * 主幕布去重 / 隐藏内部提示 / 时序纠偏：
 * 1) 丢弃 settle 摘要气泡
 * 2) 协作特殊提示词从 user 气泡剥离；纯内部 user 整段隐藏
 * 3) **按 run 去重**，禁止跨轮同文案丢轮
 *    - formal squad:{run}:user 每 run 保留 1 条
 *    - agent:{run}:user 仅当无对应 squad user 时保留
 *    - pending 仅当尚无任意 formal multi-agent user 同文案时保留
 * 4) hist-fold 紧跟**本 run** user
 */
export function filterMultiAgentCanvasItems(
  items: readonly ConversationItem[],
): ConversationItem[] {
  const stripped: ConversationItem[] = [];
  for (const item of items) {
    if (item.kind === "message" && isMultiAgentSettledSummaryItemId(item.id)) {
      continue;
    }
    if (item.kind === "message" && item.role === "user") {
      const next = normalizeUserItemText(item);
      if (!next) continue;
      stripped.push(next);
      continue;
    }
    if (
      item.kind === "message" &&
      item.role === "assistant" &&
      isCollabInternalPromptText(item.text) &&
      isCollabSummaryPromptText(item.text)
    ) {
      continue;
    }
    stripped.push(item);
  }

  const formalSquadRunIds = new Set<string>();
  const formalDedupeKeys = new Set<string>();
  for (const item of stripped) {
    if (item.kind !== "message" || item.role !== "user") continue;
    const runId = parseMultiAgentUserRunId(item.id);
    if (runId && item.id.startsWith("squad:")) {
      formalSquadRunIds.add(runId);
      formalDedupeKeys.add(userMessageDedupeKey(item));
    }
  }

  const seenSquadRun = new Set<string>();
  const seenAgentRun = new Set<string>();
  const seenPendingKeys = new Set<string>();
  const out: ConversationItem[] = [];

  for (const item of stripped) {
    if (item.kind === "message" && item.role === "user") {
      const id = item.id;
      const dedupeKey = userMessageDedupeKey(item);

      if (isPendingMultiAgentUserId(id)) {
        // 已有正式 multi-agent user 同文案/同图 → pending 可丢（避免双气泡）
        if (formalDedupeKeys.has(dedupeKey)) continue;
        if (seenPendingKeys.has(dedupeKey)) continue;
        seenPendingKeys.add(dedupeKey);
        out.push(item);
        continue;
      }

      const runId = parseMultiAgentUserRunId(id);
      if (runId && id.startsWith("squad:")) {
        if (seenSquadRun.has(runId)) continue;
        seenSquadRun.add(runId);
        out.push(item);
        continue;
      }
      if (runId && id.startsWith("agent:")) {
        // 同 run 已有 squad user → 丢 agent 旧轨
        if (formalSquadRunIds.has(runId)) continue;
        if (seenAgentRun.has(runId)) continue;
        seenAgentRun.add(runId);
        out.push(item);
        continue;
      }

      // 普通 user：若与 formal multi-agent user 同文案/同图（多为 briefing 剥离后残留）则丢
      if (formalDedupeKeys.has(dedupeKey)) continue;
      out.push(item);
      continue;
    }
    out.push(item);
  }

  return relocateMultiAgentHistFolds(out);
}
