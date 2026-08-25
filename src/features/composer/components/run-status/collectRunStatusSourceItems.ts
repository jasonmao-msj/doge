/**
 * Composer「已编辑」pill 专用：合成 file-change 扫描源。
 *
 * - 不回写 Messages / 不改变主幕布 items
 * - 不塞进 useStatusPanelData（避免子代理/todo 扫描被 canvas 噪音污染）
 * - 协作写文件在 agent-canvas:{shared}:{attempt}，主时间线通常无 edit tools
 *
 * 字符串匹配 agent-canvas 前缀，避免 composer → multi-agent 深层耦合。
 */
import type { ConversationItem } from "../../../../types";
import { isSubagentTool } from "@/utils/isSubagentTool";

const AGENT_CANVAS_PREFIX = "agent-canvas:";

export type CollectRunStatusSourceItemsInput = {
  mainItems: ConversationItem[];
  threadItemsByThread?: Record<string, ConversationItem[] | undefined>;
  activeThreadId?: string | null;
};

function isAgentCanvasForShared(
  threadId: string,
  sharedThreadId: string,
): boolean {
  if (!threadId.startsWith(AGENT_CANVAS_PREFIX)) return false;
  // agent-canvas:shared:<uuid>:<attemptId>
  const rest = threadId.slice(AGENT_CANVAS_PREFIX.length);
  if (!rest.startsWith("shared:")) return false;
  // sharedThreadId 形如 shared:<uuid>
  if (!sharedThreadId.startsWith("shared:")) {
    return rest.includes(sharedThreadId);
  }
  // rest = shared:<uuid>:<attempt…>
  return rest === sharedThreadId || rest.startsWith(`${sharedThreadId}:`);
}

function pushUnique(
  into: ConversationItem[],
  seen: Set<string>,
  items: ConversationItem[] | undefined,
) {
  if (!items?.length) return;
  for (const item of items) {
    const id = item.id?.trim();
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    into.push(item);
  }
}

/**
 * 主时间线 ∪ 当前 shared 会话的 agent-canvas attempt items（仅用于文件变更汇总）。
 */
export function collectRunStatusSourceItems(
  input: CollectRunStatusSourceItemsInput,
): ConversationItem[] {
  const main = input.mainItems ?? [];
  const byThread = input.threadItemsByThread ?? {};
  const activeId = input.activeThreadId?.trim() || "";

  if (!activeId) return main;

  const seen = new Set<string>();
  for (const item of main) {
    const id = item.id?.trim();
    if (id) seen.add(id);
  }

  const extra: ConversationItem[] = [];
  for (const [threadId, items] of Object.entries(byThread)) {
    if (!items?.length) continue;
    if (threadId === activeId) continue;
    if (!isAgentCanvasForShared(threadId, activeId)) continue;
    pushUnique(extra, seen, items);
  }

  if (extra.length === 0) return main;
  return main.concat(extra);
}

/**
 * Composer「子代理」pill 专用：把当前 shared 会话 agent-canvas 里的
 * subagent 工具事实（spawn / Agent / Task 等）并入扫描源。
 *
 * 协作实时链路把 worker 工具事件隔离在 agent-canvas:{shared}:{attempt}，
 * 主幕 shared: 时间线只有消息与汇总；不并进来 Strip 就永远看不到子代理。
 * 仅并入 subagent 工具，避免 todo / command / 文件扫描被 canvas 噪音污染。
 */
export function collectRunStatusSubagentSourceItems(
  input: CollectRunStatusSourceItemsInput,
): ConversationItem[] {
  const main = input.mainItems ?? [];
  const byThread = input.threadItemsByThread ?? {};
  const activeId = input.activeThreadId?.trim() || "";

  if (!activeId) return main;

  const seen = new Set<string>();
  for (const item of main) {
    const id = item.id?.trim();
    if (id) seen.add(id);
  }

  const extra: ConversationItem[] = [];
  for (const [threadId, items] of Object.entries(byThread)) {
    if (!items?.length) continue;
    if (threadId === activeId) continue;
    if (!isAgentCanvasForShared(threadId, activeId)) continue;
    for (const item of items) {
      if (item.kind !== "tool" || !isSubagentTool(item)) continue;
      const id = item.id?.trim();
      if (id) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      extra.push(item);
    }
  }

  if (extra.length === 0) return main;
  return main.concat(extra);
}
