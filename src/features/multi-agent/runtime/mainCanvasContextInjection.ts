/**
 * 协作 Context Fan-in：主幕已有对话 → 首段 model text 头部 digest。
 *
 * 仅改模型入站文本；不污染主幕 visibleText / 用户气泡。
 */

import type { ConversationItem } from "../../../types/conversation";
import {
  isCollabInternalPromptText,
  stripCollabInternalPrompt,
} from "@/conversation-presentation/multi-agent/collabPrompt";
import { isMultiAgentHistFoldItemId } from "@/conversation-presentation/multi-agent/canvasItems";

export const MAIN_CANVAS_CONTEXT_PREFIX = "【主幕对话上下文】";

const MAX_TURN_CHARS = 800;
const MAX_TOTAL_CHARS = 6000;
const MAX_TURNS = 24;

export type MainCanvasContextInjectionResult = {
  finalText: string;
  injectedCount: number;
  injectedChars: number;
};

function clampChars(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}…`;
}

function normalizeMessageText(
  item: Extract<ConversationItem, { kind: "message" }>,
): string {
  const raw = (item.text ?? "").trim();
  if (!raw) return "";
  if (item.role === "user") {
    const cleaned = stripCollabInternalPrompt(raw);
    if (!cleaned || isCollabInternalPromptText(cleaned)) return "";
    return cleaned;
  }
  // assistant：整段 collab 内部调度/汇总隐藏
  if (isCollabInternalPromptText(raw)) return "";
  return raw;
}

/**
 * 从主幕 items 抽取可注入的对话行（最近优先，再按时间正序输出）。
 */
export function buildMainCanvasDialogueLines(
  items: readonly ConversationItem[],
): string[] {
  const lines: string[] = [];
  for (const item of items) {
    if (item.kind !== "message") continue;
    if (item.role !== "user" && item.role !== "assistant") continue;
    if (isMultiAgentHistFoldItemId(item.id)) continue;
    // 本轮 optimistic 若已入列表，不重复计入 digest（任务句在 userText）
    if (item.id.startsWith("optimistic-user-")) continue;
    const text = normalizeMessageText(item);
    if (!text) continue;
    const roleLabel = item.role === "user" ? "user" : "assistant";
    lines.push(`[${roleLabel}] ${clampChars(text, MAX_TURN_CHARS)}`);
  }
  if (lines.length === 0) return [];
  // 取最近 MAX_TURNS 条，保持时间正序
  const recent = lines.slice(-MAX_TURNS);
  // 总 cap：从旧向新丢弃
  const kept: string[] = [];
  let total = 0;
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const line = recent[i] ?? "";
    if (!line) continue;
    if (total + line.length > MAX_TOTAL_CHARS && kept.length > 0) break;
    const remaining = MAX_TOTAL_CHARS - total;
    const clipped =
      line.length > remaining ? clampChars(line, remaining) : line;
    if (!clipped.trim()) continue;
    kept.push(clipped);
    total += clipped.length;
  }
  kept.reverse();
  return kept;
}

export function buildMainCanvasContextBlock(lines: string[]): string {
  if (lines.length === 0) return "";
  return [
    MAIN_CANVAS_CONTEXT_PREFIX,
    "<main-canvas-context>",
    "以下为主幕布触发协作前的已有对话摘录（供本环节理解背景；勿整段复读）：",
    ...lines,
    "</main-canvas-context>",
  ].join("\n");
}

/**
 * 将主幕对话 digest 注入 model text 头部。
 */
export function injectMainCanvasContext(input: {
  userText: string;
  items: readonly ConversationItem[];
}): MainCanvasContextInjectionResult {
  const lines = buildMainCanvasDialogueLines(input.items);
  if (lines.length === 0) {
    return {
      finalText: input.userText,
      injectedCount: 0,
      injectedChars: 0,
    };
  }
  const block = buildMainCanvasContextBlock(lines);
  const userPart = (input.userText ?? "").trim();
  const finalText = userPart ? `${block}\n\n${userPart}` : block;
  return {
    finalText,
    injectedCount: lines.length,
    injectedChars: block.length,
  };
}

/**
 * 从 requestText / model text 抽出主幕上下文正文（供 Inspector 展示）。
 * 无标记时返回空串。
 */
export function extractMainCanvasContextBody(
  text: string | null | undefined,
): string {
  const raw = (text ?? "").trim();
  if (!raw) return "";
  const open = raw.indexOf("<main-canvas-context>");
  const close = raw.indexOf("</main-canvas-context>");
  if (open >= 0 && close > open) {
    return raw
      .slice(open + "<main-canvas-context>".length, close)
      .replace(/^\s*以下为主幕布触发协作前的已有对话摘录[^：:]*[：:]\s*/u, "")
      .trim();
  }
  // 兼容半截 / 无闭合标签：从前缀后截取到双换行 + 非注入内容
  const prefixIdx = raw.indexOf(MAIN_CANVAS_CONTEXT_PREFIX);
  if (prefixIdx < 0) return "";
  const after = raw.slice(prefixIdx + MAIN_CANVAS_CONTEXT_PREFIX.length).trim();
  const cut = after.search(/\n\n(?!\[)/);
  return (cut >= 0 ? after.slice(0, cut) : after)
    .replace(/<\/?main-canvas-context>/g, "")
    .replace(/^\s*以下为主幕布触发协作前的已有对话摘录[^：:]*[：:]\s*/u, "")
    .trim();
}

/**
 * 剥离主幕上下文块，得到给人看的标题/任务候选。
 */
export function stripMainCanvasContextBlock(
  text: string | null | undefined,
): string {
  const raw = (text ?? "").trim();
  if (!raw) return "";
  if (!raw.includes(MAIN_CANVAS_CONTEXT_PREFIX) && !raw.includes("<main-canvas-context>")) {
    return raw;
  }
  let out = raw;
  const open = out.indexOf(MAIN_CANVAS_CONTEXT_PREFIX);
  if (open >= 0) {
    const closeTag = out.indexOf("</main-canvas-context>", open);
    if (closeTag >= 0) {
      out = (
        out.slice(0, open) +
        out.slice(closeTag + "</main-canvas-context>".length)
      ).trim();
    } else {
      // 无闭合：去掉前缀到首个「双换行后非 [ 行」之前的整块，尽量保留任务句
      const afterPrefix = out.slice(open);
      const restMatch = afterPrefix.match(/\n\n(?!\[user\]|\[assistant\])/);
      if (restMatch && restMatch.index != null) {
        out = (
          out.slice(0, open) + afterPrefix.slice(restMatch.index)
        ).trim();
      } else {
        out = out.slice(0, open).trim();
      }
    }
  }
  return out.replace(/^\n+|\n+$/g, "").trim();
}

/**
 * 主幕协作卡 / 终态锚点标题：优先可见原文，绝不展示注入标记。
 */
export function collabDisplayTitle(
  projection: {
    userVisibleText?: string | null;
    requestText?: string | null;
  },
  maxChars = 36,
): string {
  const visible = (projection.userVisibleText ?? "").trim();
  const raw = visible || stripMainCanvasContextBlock(projection.requestText);
  if (!raw) return "";
  // 再挡一层：若 strip 失败仍含标记，截到标记前
  const cut = raw.indexOf(MAIN_CANVAS_CONTEXT_PREFIX);
  const safe = cut >= 0 ? raw.slice(0, cut).trim() : raw;
  if (!safe) return "";
  return safe.length <= maxChars ? safe : safe.slice(0, maxChars);
}
