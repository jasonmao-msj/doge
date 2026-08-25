/**
 * 协作调度特殊提示词：模型可见、幕布默认隐藏。
 * 幕布只突出用户真正发送的那一行任务原文。
 *
 * 原则：主幕消息要短、禁工具、禁探索，避免调度对话变成「第二套实现会话」。
 *
 * ## 防污染约定（修改本文件前必须理解）
 *
 * briefing/summary 消息通过 `sendSharedSessionTurnV2` 发送到 Shared Session。
 * 它们会写入 canonical fact log（持久化），但 canvas 层通过以下机制过滤：
 *
 * 1. `filterMultiAgentCanvasItems` → `stripCollabInternalPrompt` 对 summary marker
 *    返回空字符串 → 整条 user 消息从 canvas 丢弃。
 * 2. 同函数对 `isCollabInternalPromptText` + doge/legacy summary marker 的 assistant 消息
 *    整段隐藏。
 * 3. 其他客户端连接同一 Shared Session 时会走同样的 filter → UI 一致。
 *
 * **禁止**修改 marker 格式而不更新 `SUMMARY_HIDE_HINTS` / `STRIP_FROM_HINTS`，
 * 否则内部调度指令会泄漏到用户可见的 canvas 时间线。
 *
 * **禁止**移除 `"此后用户消息均为普通编程对话"` 这句话——它确保 summary turn 后
 * 模型退出「协作调度者」角色，恢复普通 CLI 行为。
 */

/** 主幕调度对话（briefing）注入标记 */
export const COLLAB_BRIEFING_MARKER = "【协作调度 · 主幕对话】";

/** 完成后主幕模型汇总请求标记 */
export const COLLAB_SUMMARY_MARKER = "【协作调度 · 完成汇总】";

/** 出现即整段隐藏的汇总请求特征（summary 提示词可能内嵌用户任务原文） */
const SUMMARY_HIDE_HINTS = [
  "[[doge.collab.summary",
  "[[mossx.collab.summary",
  COLLAB_SUMMARY_MARKER,
];

/** 出现即从该处截断的调度指令特征（兼容流式半截 marker，无闭合 `】` 也能命中） */
const STRIP_FROM_HINTS = [
  "[[doge.collab.briefing",
  "[[doge.collab.",
  "[[mossx.collab.briefing",
  "[[mossx.collab.",
  "【协作调度",
];

function earliestIndexOf(raw: string, hints: readonly string[]): number {
  let best = -1;
  for (const hint of hints) {
    const idx = raw.indexOf(hint);
    if (idx >= 0 && (best < 0 || idx < best)) best = idx;
  }
  return best;
}

/** 是否含协作内部调度提示（应在幕布上剥离或整段隐藏） */
export function isCollabInternalPromptText(
  text: string | null | undefined,
): boolean {
  const raw = (text ?? "").trim();
  if (!raw) return false;
  return (
    earliestIndexOf(raw, SUMMARY_HIDE_HINTS) >= 0 ||
    earliestIndexOf(raw, STRIP_FROM_HINTS) >= 0
  );
}

export function isCollabSummaryPromptText(
  text: string | null | undefined,
): boolean {
  return earliestIndexOf((text ?? "").trim(), SUMMARY_HIDE_HINTS) >= 0;
}

/**
 * 从 user 气泡正文中剥掉调度指令，只保留用户任务原文。
 * - 汇总请求：整段隐藏（返回 ""）
 * - briefing：从首个标记特征处截断（兼容流式增量文本的半截标记）
 */
export function stripCollabInternalPrompt(
  text: string | null | undefined,
): string {
  const raw = (text ?? "").trim();
  if (!raw) return "";
  if (earliestIndexOf(raw, SUMMARY_HIDE_HINTS) >= 0) return "";
  const cutIdx = earliestIndexOf(raw, STRIP_FROM_HINTS);
  if (cutIdx < 0) return raw;
  return raw
    .slice(0, cutIdx)
    .replace(/\s*---\s*$/g, "")
    .trim();
}

/** 组装 briefing 发送正文：用户原文 + 隐藏标记指令（极简、禁工具） */
export function buildCollabBriefingSendText(input: {
  userText: string;
  flowLabel: string;
}): string {
  const userText = input.userText.trim();
  return [
    userText,
    "",
    "---",
    COLLAB_BRIEFING_MARKER,
    "角色：主会话「协作调度者」（不是规划/实现/审查节点）。",
    `模板流程：${input.flowLabel}。`,
    "",
    "硬性约束（违反即失败）：",
    "1) 禁止调用任何工具、子代理、Explore、读写文件、跑命令。",
    "2) 禁止进入 Plan Mode、禁止长篇分析、禁止寒暄与分节标题。",
    "3) 只输出两行纯中文短句，总字数 ≤ 120 字：",
    "   第一行：一句话复述任务理解。",
    "   第二行：一句话说明将按上述流程依次调度哪些环节，并告知即将启动。",
    "4) 仅当任务完全无法理解时，才改用一行提出 1 个澄清问题。",
    "[[doge.collab.briefing]]",
  ].join("\n");
}

/** 组装完成汇总请求（整段对幕布隐藏；要求成文、勿省略） */
export function buildCollabSummarySendText(input: {
  userText: string;
  stageSections: string;
}): string {
  return [
    "[[doge.collab.summary]]",
    COLLAB_SUMMARY_MARKER,
    "本轮多引擎协作已结束。请仅根据下方摘录写一份中文交付汇总（Markdown）。",
    "要求：完整成文、勿用省略号截断关键改动；勿整段粘贴摘录；勿调用工具。",
    "结构：## 任务回顾 / ## 各环节结论 / ## 关键改动 / ## 验收与风险",
    "重要：此后用户消息均为普通编程对话，勿再以「协作调度者」身份接管会话。",
    "",
    "用户原任务：",
    input.userText.trim() || "（空）",
    "",
    "【节点摘录】",
    input.stageSections.trim() || "（无）",
  ].join("\n");
}
