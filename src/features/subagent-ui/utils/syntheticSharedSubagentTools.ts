import type { ConversationItem, EngineType, ThreadSummary } from "../../../types";
import { isCollabSpawnTool, isSubagentTool } from "@/utils/isSubagentTool";
import { resolveSyntheticChildToolStatus } from "./subagentCardStatus";
import { extractCollabAgentIds } from "./subagentViewModel";

type ToolItem = Extract<ConversationItem, { kind: "tool" }>;

/**
 * 是否已有「足够」的 subagent 卡源，从而禁止 child synthetic。
 * - Claude / Grok / Kimi 真实 tool：阻塞
 * - Codex collab spawn 且已有 receiver：阻塞
 * - collab spawn 尚无 receiver（live 半截）：不阻塞，允许 children 合成补齐小队
 */
export function hasBlockingSubagentToolSource(
  items: readonly ConversationItem[],
): boolean {
  return items.some((item) => {
    if (item.kind !== "tool" || !isSubagentTool(item)) {
      return false;
    }
    if (isCollabSpawnTool(item)) {
      return extractCollabAgentIds(item as ToolItem).length > 0;
    }
    return true;
  });
}

type ChildStatusOptions = {
  statusById?: Record<string, { isProcessing?: boolean }>;
  itemsByThread?: Record<string, ConversationItem[] | undefined>;
  /** synthetic tool id 前缀；默认 shared，Codex native 用 codex */
  idPrefix?: "shared" | "codex";
};

export type ChildSubagentSyntheticEligibilityInput = {
  /** 本 Messages 实例绑定的 thread（嵌套详情是 child id） */
  ownThreadId: string | null | undefined;
  /** 主幕布 active canvas threadId；嵌套详情时与 own 不同 */
  canvasThreadId?: string | null | undefined;
  activeEngine?: EngineType | string | null | undefined;
  items: readonly ConversationItem[];
  childCount: number;
};

/**
 * 是否应用子会话合成小队。
 * - Shared 父：保持既有行为（任意 engine，投影常缺 spawn tool）
 * - Codex native live 缺口：engine=codex 且无 isSubagentTool
 * - 嵌套详情幕布：own !== canvas → 永不注入
 * - Claude/Grok/Kimi native：硬否（除非 shared 父）
 */
export function shouldInjectChildSubagentSynthetic(
  input: ChildSubagentSyntheticEligibilityInput,
): boolean {
  const childCount = input.childCount;
  if (childCount <= 0) {
    return false;
  }
  const own = (input.ownThreadId ?? "").trim();
  if (!own) {
    return false;
  }
  const canvas = (input.canvasThreadId ?? "").trim();
  // 嵌套子代理详情：canvas 是父、own 是子 → 禁止再注入父小队
  if (canvas && own !== canvas) {
    return false;
  }
  if (hasBlockingSubagentToolSource(input.items)) {
    return false;
  }
  if (own.startsWith("shared:")) {
    return true;
  }
  const engine = (input.activeEngine ?? "").toString().trim().toLowerCase();
  return engine === "codex";
}

/**
 * Shared / Codex live 缺 spawn 卡时，用已挂到父会话下的子线程合成 tool items，
 * 以便 groupToolItems → SubagentSquadGrid。
 */
export function buildSyntheticSpawnToolsFromChildren(
  children: readonly ThreadSummary[],
  options?: ChildStatusOptions,
): Extract<ConversationItem, { kind: "tool" }>[] {
  const idPrefix = options?.idPrefix ?? "shared";
  return children.map((thread, index) => {
    const rawId = thread.id.trim();
    // 保留完整 thread id（grok:… / claude:… / 裸 codex uuid），避免详情走错 loader
    const description = thread.name?.trim() || `SubAgent ${index + 1}`;
    const cardStatus = resolveSyntheticChildToolStatus(rawId, {
      isDegraded: thread.isDegraded,
      statusById: options?.statusById,
      itemsByThread: options?.itemsByThread,
    });
    const childItems = options?.itemsByThread?.[rawId] ?? [];
    const assistantTail = childItems
      .filter(
        (item): item is Extract<ConversationItem, { kind: "message" }> =>
          item.kind === "message" &&
          item.role === "assistant" &&
          typeof item.text === "string" &&
          item.text.trim().length > 0,
      )
      .map((item) => item.text.trim())
      .slice(-2)
      .join("\n");
    return {
      id: `synthetic-${idPrefix}-subagent:${rawId}`,
      kind: "tool" as const,
      toolType: "spawn_subagent",
      title: "Spawn Subagent",
      detail: JSON.stringify({
        description,
        subagent_type: "general-purpose",
        subagent_id: rawId,
      }),
      status: cardStatus === "running" ? "running" : "completed",
      output: [
        cardStatus === "completed"
          ? "Subagent completed."
          : "Subagent started in background.",
        `subagent_id: ${rawId}`,
        "type: general-purpose",
        `description: ${description}`,
        cardStatus === "completed" ? "status: completed" : "status: running",
        ...(assistantTail ? [assistantTail] : []),
      ].join("\n"),
    };
  });
}

/**
 * 若 timeline 尚无 subagent tool，则把 synthetic tools 插到最后一条 user 消息之后。
 */
export function injectSyntheticSubagentToolsIfNeeded(
  items: readonly ConversationItem[],
  syntheticTools: readonly Extract<ConversationItem, { kind: "tool" }>[],
): ConversationItem[] {
  if (syntheticTools.length === 0) {
    return items as ConversationItem[];
  }
  let lastUserIndex = -1;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item?.kind === "message" && item.role === "user") {
      lastUserIndex = i;
      break;
    }
  }
  if (lastUserIndex < 0) {
    return [...items, ...syntheticTools];
  }
  return [
    ...items.slice(0, lastUserIndex + 1),
    ...syntheticTools,
    ...items.slice(lastUserIndex + 1),
  ];
}

export type EnrichTimelineSyntheticSubagentInput = {
  items: readonly ConversationItem[];
  ownThreadId: string | null | undefined;
  canvasThreadId?: string | null | undefined;
  activeEngine?: EngineType | string | null | undefined;
  childThreads: readonly ThreadSummary[];
  statusById?: Record<string, { isProcessing?: boolean }>;
  itemsByThread?: Record<string, ConversationItem[] | undefined>;
};

/**
 * 在 process-phase 折叠 **之前** 注入合成 spawn 卡。
 *
 * 必须先于 resolveCollapsedTimelineItems：若在折叠后注入，
 * 真 Agent 被 hard-unmount 后 hasBlocking 变 false → 合成卡钉回 user 后、
 * 落在「已处理」chip 外侧（Shared 会话回归）。
 */
export function enrichTimelineWithSyntheticSubagentsBeforeCollapse(
  input: EnrichTimelineSyntheticSubagentInput,
): ConversationItem[] {
  const items = input.items;
  if (
    !shouldInjectChildSubagentSynthetic({
      ownThreadId: input.ownThreadId,
      canvasThreadId: input.canvasThreadId,
      activeEngine: input.activeEngine,
      items,
      childCount: input.childThreads.length,
    })
  ) {
    return items as ConversationItem[];
  }
  const own = (input.ownThreadId ?? "").trim();
  const engine = (input.activeEngine ?? "").toString().trim().toLowerCase();
  const idPrefix =
    own.startsWith("shared:") && engine !== "codex"
      ? "shared"
      : engine === "codex"
        ? "codex"
        : "shared";
  const synthetic = buildSyntheticSpawnToolsFromChildren(input.childThreads, {
    statusById: input.statusById,
    itemsByThread: input.itemsByThread,
    idPrefix,
  });
  return injectSyntheticSubagentToolsIfNeeded(items, synthetic);
}
