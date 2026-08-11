import { convertFileSrc } from "@tauri-apps/api/core";
import type { ConversationItem } from "../../../types";
import type {
  ConversationEngine,
  ConversationState,
} from "../../threads/contracts/conversationCurtainContracts";
import type { PresentationProfile } from "../../../conversation-presentation/presentationProfile";
import { groupToolItems } from "./groupToolItems";
import {
  isAssistantMessageConversationItem,
  isUserMessageConversationItem,
} from "./messageItemPredicates";
import { compactComparableReasoningText, parseReasoning } from "../presentation/messagesReasoning";
import {
  buildCommandSummary,
  extractCommandFromTitle,
  extractToolName,
  isBashTool,
  isEditTool,
  isReadTool,
  isSearchTool,
  parseToolArgs,
} from "../components/toolBlocks/toolConstants";
import { buildConversationItem } from "../../../utils/threadItems";
import { inferMutatingFileChangesFromCommand } from "../../../utils/threadItemsFileChanges";

export const SCROLL_THRESHOLD_PX = 120;
export const OPENCODE_NON_STREAMING_HINT_DELAY_MS = 12_000;
const MESSAGES_PERF_DEBUG_FLAG_KEY = "doge.debug.messages.perf";
const CLAUDE_HIDE_REASONING_MODULE_FLAG_KEY = "doge.claude.hideReasoningModule";
const CLAUDE_RENDER_DEBUG_FLAG_KEY = "doge.debug.claude.render";
export const MESSAGES_SLOW_RENDER_WARN_MS = 18;
export const MESSAGES_SLOW_ANCHOR_WARN_MS = 8;
export const VISIBLE_MESSAGE_WINDOW = 10000;
// 流式 live 尾窗：2026-08 起关闭（值 ≤0 = 不裁剪）。
// 原因：流式结束 idle 时尾窗→全量会在上方突然插回历史，scrollTop 相对「往上走」，
// 与 jetbrains 全量消息列表的丝滑 stick-to-bottom 冲突。产品选择性能换丝滑。
// buildLiveTailWorkingSet 在 visibleWindow<=0 时恒返回全量 items。
export const STREAMING_VISIBLE_WINDOW = 0;

export type MessagesEngine = "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode";

export function isSelectionInsideNode(selection: Selection | null, node: HTMLElement | null) {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !node) {
    return false;
  }
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    if (node.contains(range.commonAncestorContainer)) {
      return true;
    }
  }
  return false;
}

export function isMessagesPerfDebugEnabled(): boolean {
  if (!import.meta.env.DEV) {
    return false;
  }
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(MESSAGES_PERF_DEBUG_FLAG_KEY) === "1";
}

export function shouldHideClaudeReasoningModule(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    const value = window.localStorage.getItem(CLAUDE_HIDE_REASONING_MODULE_FLAG_KEY);
    if (!value) {
      return false;
    }
    const normalized = value.trim().toLowerCase();
    return !(normalized === "0" || normalized === "false" || normalized === "off");
  } catch {
    return false;
  }
}

export function isClaudeRenderDebugEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    const value = window.localStorage.getItem(CLAUDE_RENDER_DEBUG_FLAG_KEY);
    if (!value) {
      return false;
    }
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "on";
  } catch {
    return false;
  }
}

export function logClaudeRender(label: string, payload: Record<string, unknown>) {
  if (!isClaudeRenderDebugEnabled()) {
    return;
  }
  console.info(`[messages][claude-render] ${label}`, payload);
}

export function logMessagesPerf(label: string, payload: Record<string, unknown>): void {
  if (!isMessagesPerfDebugEnabled()) {
    return;
  }
  console.info(`[messages][perf] ${label}`, payload);
}

export function normalizeAgentTaskStatus(value: string | null | undefined) {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) {
    return { label: "agent", tone: "neutral" as const };
  }
  if (/(fail|error|cancel(?:led)?|abort|timeout|timed[_ -]?out)/.test(normalized)) {
    return { label: value?.trim() ?? "error", tone: "error" as const };
  }
  if (/(complete|completed|success|done|finish(?:ed)?)/.test(normalized)) {
    return { label: value?.trim() ?? "completed", tone: "completed" as const };
  }
  if (/(running|processing|started|in[_ -]?progress|queued|pending)/.test(normalized)) {
    return { label: value?.trim() ?? "running", tone: "running" as const };
  }
  return { label: value?.trim() ?? normalized, tone: "neutral" as const };
}

export function basenameFromPath(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  if (!normalized) {
    return null;
  }
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? normalized;
}

export function resolveAgentTaskDisplaySummary(summary: string | null | undefined) {
  const normalized = (summary ?? "").trim();
  if (!normalized) {
    return {
      title: "Agent result",
      subtitle: null as string | null,
    };
  }
  const match =
    /Agent\s+["“]?([^"”]+)["”]?/i.exec(normalized)
    ?? /智能体\s*["“]?([^"”]+)["”]?/i.exec(normalized);
  const title = match?.[1]?.trim() || normalized;
  return {
    title,
    subtitle: title === normalized ? null : normalized,
  };
}

export function toConversationEngine(engine: MessagesEngine): ConversationEngine {
  if (engine === "claude" || engine === "gemini" || engine === "grok" || engine === "kimi" || engine === "opencode") {
    return engine;
  }
  return "codex";
}

export function resolveRenderableItems({
  legacyItems,
  legacyThreadId: _legacyThreadId,
  legacyWorkspaceId: _legacyWorkspaceId,
  conversationState,
}: {
  legacyItems: ConversationItem[];
  legacyThreadId: string | null;
  legacyWorkspaceId: string | null;
  conversationState: ConversationState | null;
}) {
  if (!conversationState) {
    return legacyItems;
  }
  return conversationState.items;
}

export function normalizeMessageImageSrc(path: string) {
  if (!path) {
    return "";
  }
  if (path.startsWith("data:") || path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  if (path.startsWith("file://")) {
    return path;
  }
  try {
    return convertFileSrc(path);
  } catch {
    return "";
  }
}

export function formatDurationMs(durationMs: number) {
  const durationSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const durationHours = Math.floor(durationSeconds / 3600);
  const durationMinutes = Math.floor(durationSeconds / 60);
  const durationRemainder = durationSeconds % 60;
  if (durationHours > 0) {
    const remainderMinutes = durationMinutes % 60;
    return `${durationHours}:${String(remainderMinutes).padStart(2, "0")}:${String(durationRemainder).padStart(2, "0")}`;
  }
  return `${durationMinutes}:${String(durationRemainder).padStart(2, "0")}`;
}

/** Human-readable compact duration for process chips, e.g. "1m 3s". */
export function formatDurationCompact(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    if (minutes === 0 && seconds === 0) {
      return `${hours}h`;
    }
    if (seconds === 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  return `${seconds}s`;
}

/** Compact token count for message footers (1234 → "1.2K"), matching jetbrains MessageItem. */
export function formatTokenCount(count: number) {
  if (!Number.isFinite(count) || count < 0) {
    return "0";
  }
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K`;
  }
  return String(Math.floor(count));
}

export function formatCompletedTimeMs(timestampMs: number) {
  const date = new Date(timestampMs);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${month}-${day} ${hours}:${minutes}:${seconds}`;
}

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

/**
 * Compact duration for final-boundary labels, e.g. "13s" / "1m21s" / "1h1m1s"
 * (no spaces — denser than formatDurationCompact).
 */
export function formatDurationSecondsLabel(durationMs: number) {
  return formatDurationCompact(durationMs).replaceAll(" ", "");
}

/**
 * Build final-boundary meta next to message actions, e.g.
 * "07-31 20:42:26 耗时1m21s · 输入 41.1K token / 输出 105 token"
 */
export function buildAssistantFinalBoundaryMetaText(options: {
  finalDurationMs?: number;
  finalInputTokens?: number;
  finalOutputTokens?: number;
  finalCompletedAt?: number;
  t: TranslateFn;
}): string {
  const headParts: string[] = [];
  if (
    typeof options.finalCompletedAt === "number" &&
    options.finalCompletedAt > 0
  ) {
    headParts.push(formatCompletedTimeMs(options.finalCompletedAt));
  }
  if (
    typeof options.finalDurationMs === "number" &&
    Number.isFinite(options.finalDurationMs) &&
    options.finalDurationMs >= 0
  ) {
    headParts.push(
      options.t("messages.durationSeconds", {
        duration: formatDurationSecondsLabel(options.finalDurationMs),
      }),
    );
  }
  const inputTokens =
    typeof options.finalInputTokens === "number" &&
    Number.isFinite(options.finalInputTokens) &&
    options.finalInputTokens > 0
      ? options.finalInputTokens
      : 0;
  const outputTokens =
    typeof options.finalOutputTokens === "number" &&
    Number.isFinite(options.finalOutputTokens) &&
    options.finalOutputTokens > 0
      ? options.finalOutputTokens
      : 0;
  const tokenText =
    inputTokens > 0 || outputTokens > 0
      ? options.t("messages.tokenUsageTooltip", {
          input: formatTokenCount(inputTokens),
          output: formatTokenCount(outputTokens),
        })
      : "";
  const head = headParts.join(" ");
  if (head && tokenText) {
    return `${head} · ${tokenText}`;
  }
  return head || tokenText;
}

/** @deprecated Alias kept for call sites that still use the object helper name. */
export function buildAssistantFinalBoundaryMeta(options: {
  finalDurationMs?: number;
  finalInputTokens?: number;
  finalOutputTokens?: number;
  finalCompletedAt?: number;
  t: TranslateFn;
}) {
  return {
    text: buildAssistantFinalBoundaryMetaText(options),
    tokenTooltip: null as string | null,
  };
}

export function scrollKeyForItems(items: ConversationItem[]) {
  if (!items.length) {
    return "empty";
  }
  const last = items[items.length - 1];
  if (!last) {
    return "empty";
  }
  switch (last.kind) {
    case "message":
      return `${last.id}-${last.text.length}`;
    case "reasoning":
      return `${last.id}-${last.summary.length}-${last.content.length}`;
    case "explore":
      return `${last.id}-${last.status}-${last.entries.length}`;
    case "generatedImage":
      return `${last.id}-${last.status}-${last.images.length}`;
    case "tool":
      return `${last.id}-${last.status ?? ""}-${last.output?.length ?? 0}`;
    case "diff":
      return `${last.id}-${last.status ?? ""}-${last.diff.length}`;
    case "review":
      return `${last.id}-${last.state}-${last.text.length}`;
    default: {
      const _exhaustive: never = last;
      return _exhaustive;
    }
  }
}

export function resolveCodexCommandActivityLabel(item: Extract<ConversationItem, { kind: "tool" }>) {
  return buildCommandSummary(item, { includeDetail: false });
}

/**
 * Extract shell/command text from a tool row (title `Command: …` or detail JSON).
 * Codex/deepseek often only expose file IO through commandExecution argv/text.
 */
export function extractCanvasToolCommandText(
  item: Extract<ConversationItem, { kind: "tool" }>,
): string {
  const fromTitle = extractCommandFromTitle(item.title ?? "");
  if (fromTitle) {
    return fromTitle;
  }
  const args = parseToolArgs(item.detail);
  if (args) {
    const command = args.command ?? args.cmd ?? args.input ?? args.patch;
    if (typeof command === "string" && command.trim()) {
      return command.trim();
    }
    if (Array.isArray(command)) {
      return command
        .map((part) => (typeof part === "string" ? part.trim() : ""))
        .filter(Boolean)
        .join(" ");
    }
  }
  const detail = item.detail?.trim() ?? "";
  if (
    detail.includes("*** Begin Patch") ||
    detail.includes("*** Update File:") ||
    /^(?:cat|head|tail|rg|grep|sed|apply_patch)\b/i.test(detail)
  ) {
    return detail;
  }
  return "";
}

/** apply_patch / mutators → should surface as file write narrative. */
export function isCanvasFileWriteCommand(command: string): boolean {
  const normalized = command.trim();
  if (!normalized) {
    return false;
  }
  if (/(?:^|[\s;&|])apply_patch(?:\s|$)/i.test(normalized)) {
    return true;
  }
  if (
    normalized.includes("*** Begin Patch") ||
    normalized.includes("*** Update File:") ||
    normalized.includes("*** Add File:") ||
    normalized.includes("*** Delete File:")
  ) {
    return true;
  }
  return inferMutatingFileChangesFromCommand(normalized).length > 0;
}

/**
 * Read-only inspection commands Codex uses instead of a dedicated Read tool.
 * Pure noise (ls/pwd/echo/env) stays hidden.
 */
export function isCanvasFileReadCommand(command: string): boolean {
  const normalized = command.trim();
  if (!normalized || isCanvasFileWriteCommand(normalized)) {
    return false;
  }
  if (
    /^(?:ls|pwd|echo|env|printenv|which|type|true|false|clear|date|whoami|id|uname|sleep|printf)\b/i.test(
      normalized,
    )
  ) {
    return false;
  }
  // First-token / common file inspection tools used by Codex shell agents.
  if (
    /^(?:cat|head|tail|bat|less|more|nl|wc|file|stat|rg|grep|ag|ack|find|fd|sed|awk|jq|python3?|node|ruby|perl)\b/i.test(
      normalized,
    )
  ) {
    return true;
  }
  return /\b(?:cat|head|tail|rg|grep|find)\s+\S+/.test(normalized);
}

/**
 * Promote commandExecution that is actually apply_patch / file mutation into
 * fileChange so canvas edit scenes work for Shared Codex (incl. deepseek via CLI).
 */
export function promoteCanvasFileIoToolItem(
  item: ConversationItem,
): ConversationItem {
  if (item.kind !== "tool") {
    return item;
  }
  if (item.toolType === "fileChange" && (item.changes?.length ?? 0) > 0) {
    return item;
  }
  const isShellRow =
    item.toolType === "commandExecution" ||
    isBashTool(extractToolName(item.title).toLowerCase());
  if (!isShellRow) {
    return item;
  }
  const command = extractCanvasToolCommandText(item);
  if (!command || !isCanvasFileWriteCommand(command)) {
    return item;
  }
  const converted = buildConversationItem({
    id: item.id,
    type: "commandExecution",
    command,
    status: item.status ?? "completed",
    aggregatedOutput: item.output ?? "",
    output: item.output ?? "",
  });
  if (
    converted?.kind === "tool" &&
    converted.toolType === "fileChange" &&
    (converted.changes?.length ?? 0) > 0
  ) {
    return {
      ...converted,
      ...(item.engineSource ? { engineSource: item.engineSource } : {}),
      ...(item.turnId ? { turnId: item.turnId } : {}),
    };
  }
  return item;
}

/**
 * Hide bash/commandExecution on the conversation canvas for multi-CLI engines.
 *
 * Product intent (perf + narrative):
 * - Pure shell noise stays off the canvas (Status Panel remains the ops trail).
 * - File read / write (incl. Codex shell-form cat/rg/apply_patch) stay visible
 *   and still participate in process-phase collapse.
 * - Hidden pure shell must not remount on phase expand.
 *
 * ExitPlanMode remains visible. TodoWrite still uses other filters.
 * deepseek-v4 via Codex does not change this — tool wire shape is still Codex.
 *
 * Note: upstream once flipped this gate to always-show for count parity; local
 * policy keeps selective hide so process chips match visible file-IO rows only.
 */
export function shouldHideCodexCanvasCommandCard(
  item: Extract<ConversationItem, { kind: "tool" }>,
  activeEngine: MessagesEngine,
) {
  if (
    activeEngine !== "codex" &&
    activeEngine !== "claude" &&
    activeEngine !== "grok" &&
    activeEngine !== "kimi" &&
    activeEngine !== "opencode"
  ) {
    return false;
  }
  // File-edit scenes must stay on canvas even when titled with patch-ish names.
  if (item.toolType === "fileChange") {
    return false;
  }
  if ((item.changes?.length ?? 0) > 0) {
    return false;
  }
  const normalizedToolName = extractToolName(item.title)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (
    normalizedToolName === "exitplanmode" ||
    normalizedToolName.endsWith("exitplanmode")
  ) {
    return false;
  }
  // Read/Write/Edit/Search agent tools stay visible (file IO narrative).
  const toolNameLower = extractToolName(item.title).toLowerCase();
  if (
    isReadTool(toolNameLower) ||
    isEditTool(toolNameLower) ||
    isSearchTool(toolNameLower)
  ) {
    return false;
  }

  const command = extractCanvasToolCommandText(item);
  // Codex (+ deepseek) file IO often rides commandExecution — keep those rows.
  if (command && (isCanvasFileWriteCommand(command) || isCanvasFileReadCommand(command))) {
    return false;
  }

  if (item.toolType === "commandExecution") {
    return true;
  }
  return isBashTool(toolNameLower);
}

export function isClaudeHistoryTranscriptHeavy(items: ConversationItem[]) {
  let assistantTextCount = 0;
  let reasoningCount = 0;
  let toolCount = 0;

  for (const item of items) {
    if (item.kind === "message" && item.role === "assistant" && item.text.trim()) {
      assistantTextCount += 1;
      continue;
    }
    if (item.kind === "reasoning") {
      reasoningCount += 1;
      continue;
    }
    if (item.kind === "tool") {
      toolCount += 1;
    }
  }

  return toolCount >= 1 && reasoningCount + toolCount >= 3 && assistantTextCount <= 1;
}

export function countRenderableCollapsedEntries(
  items: ConversationItem[],
  activeEngine: MessagesEngine,
) {
  if (items.length === 0) {
    return 0;
  }
  return groupToolItems(items).reduce((count, entry) => {
    // bashGroup may hold Codex file-IO commands (cat/rg/apply_patch) that we
    // intentionally keep. Count only rows that are not pure shell noise.
    if (entry.kind === "bashGroup") {
      const visibleCount = entry.items.filter(
        (toolItem) => !shouldHideCodexCanvasCommandCard(toolItem, activeEngine),
      ).length;
      return count + visibleCount;
    }
    if (
      entry.kind === "item" &&
      entry.item.kind === "tool" &&
      shouldHideCodexCanvasCommandCard(entry.item, activeEngine)
    ) {
      return count;
    }
    // File read/edit/search groups: count underlying rows so multi-file scenes
    // still form a collapsible phase.
    if (
      entry.kind === "readGroup" ||
      entry.kind === "editGroup" ||
      entry.kind === "searchGroup"
    ) {
      return count + Math.max(1, entry.items.length);
    }
    return count + 1;
  }, 0);
}

/**
 * Promote file-IO commandExecution → fileChange when possible, then drop pure
 * shell noise before process-phase collapse / timeline mount.
 */
export function filterCanvasHiddenProcessTools(
  items: readonly ConversationItem[],
  activeEngine: MessagesEngine,
): ConversationItem[] {
  return items
    .map((item) => promoteCanvasFileIoToolItem(item))
    .filter((item) => {
      if (item.kind !== "tool") {
        return true;
      }
      return !shouldHideCodexCanvasCommandCard(item, activeEngine);
    });
}

export function resolveWorkingActivityLabel(
  item: ConversationItem,
  activeEngine: MessagesEngine = "claude",
  presentationProfile: PresentationProfile | null = null,
) {
  if (item.kind === "reasoning") {
    const parsed = parseReasoning(item);
    return parsed.workingLabel;
  }
  if (item.kind === "explore") {
    const lastEntry = item.entries[item.entries.length - 1];
    if (!lastEntry) {
      return item.status === "exploring" ? "Exploring..." : "Explored";
    }
    return lastEntry.detail ? `${lastEntry.label} (${lastEntry.detail})` : lastEntry.label;
  }
  if (item.kind === "generatedImage") {
    if (item.promptText?.trim()) {
      return item.promptText.trim();
    }
    return item.status === "processing" ? "Generating image..." : "Image ready";
  }
  if (item.kind === "tool") {
    const title = item.title?.trim();
    const detail = item.detail?.trim();
    const preferCommandSummary = presentationProfile
      ? presentationProfile.preferCommandSummary
      : activeEngine === "codex";
    if (preferCommandSummary) {
      const codexCommand = resolveCodexCommandActivityLabel(item);
      if (codexCommand) {
        return codexCommand;
      }
    }
    if (!title) {
      return null;
    }
    if (detail && item.toolType === "commandExecution") {
      return `${title} @ ${detail}`;
    }
    return title;
  }
  if (item.kind === "diff") {
    return item.title?.trim() || null;
  }
  if (item.kind === "review") {
    return item.state === "started" ? "Review started" : "Review completed";
  }
  return null;
}

export function findLastUserMessageIndex(items: ConversationItem[]) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (isUserMessageConversationItem(item)) {
      return index;
    }
  }
  return -1;
}

export function findLastAssistantMessageIndex(items: ConversationItem[]) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (isAssistantMessageConversationItem(item)) {
      return index;
    }
  }
  return -1;
}

export function findLatestAssistantMessageIdAfterIndex(
  items: ConversationItem[],
  startIndex: number,
) {
  for (let index = items.length - 1; index > startIndex; index -= 1) {
    const item = items[index];
    if (isAssistantMessageConversationItem(item)) {
      return item.id;
    }
  }
  return null;
}

export function shouldDisplayWorkingActivityLabel(
  reasoningLabel: string | null,
  activityLabel: string | null,
) {
  if (!activityLabel) {
    return false;
  }
  if (!reasoningLabel) {
    return true;
  }
  const compactReasoning = compactComparableReasoningText(reasoningLabel);
  const compactActivity = compactComparableReasoningText(activityLabel);
  if (!compactReasoning || !compactActivity) {
    return true;
  }
  if (compactReasoning === compactActivity) {
    return false;
  }
  if (compactReasoning.length >= 12 && compactActivity.includes(compactReasoning)) {
    return false;
  }
  if (compactActivity.length >= 12 && compactReasoning.includes(compactActivity)) {
    return false;
  }
  return true;
}
