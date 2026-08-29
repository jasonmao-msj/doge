import type { ConversationItem, IntentCanvasContextSendAttachment } from "../types";
import { parseIntentCanvasContextSummaries } from "../features/intent-canvas/utils/messageContext";
import {
  isMultiAgentHistFoldItemId,
  resolveMultiAgentHistFoldInsertIndex,
} from "@/conversation-presentation/multi-agent/canvasItems";
import {
  findEquivalentReasoningObservationIndex,
  withMessagePresentationMetadata,
} from "../features/threads/assembly/conversationNormalization";
import {
  extractCollabReceiversFromToolPayload,
  formatCollabAgentStates,
  normalizeCollabAgentStatusMap,
} from "./collabToolParsing";
import { boundToolOutput } from "./boundToolOutput";
import { summarizeExploration } from "./threadItemsExploreSummary";
import {
  inferFileChangesFromCommandExecutionArtifacts,
  inferFileChangesFromPayload,
  inferMutatingFileChangesFromCommand,
  mergeToolChanges,
  normalizeFileChangeKind,
  shouldPreferExplicitFileChangeOutput,
} from "./threadItemsFileChanges";
import {
  compactMessageText,
  getNormalizedAssistantMessageText,
  isAssistantNoContentPlaceholder,
  scoreAssistantMessageReadability,
  shouldNormalizeAssistantText,
} from "./threadItemsAssistantText";
import {
  isGeneratedImageToolName,
  resolveGeneratedImageArtifact,
} from "./generatedImageArtifacts";
import {
  buildGeneratedImageConversationItem,
  isNativeGeneratedImageItemType,
  resolveConversationItemId,
} from "./threadItemsGeneratedImages";
import { normalizeAskUserQuestionHistoryItems } from "./threadItemsAskUserQuestion";
import {
  extractCollaborationModeFromUserMessageItem,
  extractFallbackUserMessagePayload,
  extractModeFallbackMode,
  extractSelectedAgentIconFromUserMessageItem,
  extractSelectedAgentNameFromUserMessageItem,
  normalizeUserMessageText,
} from "./threadItemsUserMessage";
import {
  extractAssistantFinalFlag,
  extractFinalCompletedAtMs,
  extractFinalDurationMs,
  extractFinalTurnTokenCounts,
  extractHistoryItemTimestampMs,
  parseTimestampLikeMs,
} from "./threadItemsTiming";
import {
  extractImplementPlanActionId,
  formatPlanSteps,
} from "./threadItemsPlan";
export type { ClaudeApprovalResumeEntry } from "./threadItemsAssistantText";
export {
  extractClaudeApprovalResumeEntries,
  stripClaudeApprovalResumeArtifacts,
} from "./threadItemsAssistantText";
export { getThreadTimestamp } from "./threadItemsTiming";
export { previewThreadName } from "./threadItemsUserMessage";

export const MAX_ITEM_TEXT = 20000;
const TOOL_OUTPUT_RECENT_ITEMS = 12;
const NO_TRUNCATE_TOOL_OUTPUT_RECENT_ITEMS = 4;
const NO_TRUNCATE_TOOL_TYPES = new Set(["fileChange", "commandExecution"]);
let prepareThreadItemsCallCountForTests = 0;
const EDIT_TOOL_TYPE_HINTS = new Set([
  "edit",
  "edit_file",
  "editfile",
  "multiedit",
  "write",
  "write_file",
  "writefile",
  "write_to_file",
  "replace_string",
  "file_edit",
  "file_write",
  "notebookedit",
  "create_file",
]);

function asString(value: unknown) {
  return typeof value === "string" ? value : value ? String(value) : "";
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function isIntentCanvasContextAttachment(
  value: unknown,
): value is IntentCanvasContextSendAttachment {
  const record = asRecord(value);
  return (
    record?.kind === "intent_canvas_context" &&
    typeof record.attachmentId === "string" &&
    typeof record.canvasId === "string" &&
    typeof record.rawPayload === "string"
  );
}

function normalizeIntentCanvasContextAttachmentList(
  value: unknown,
): IntentCanvasContextSendAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isIntentCanvasContextAttachment);
}

function mergeIntentCanvasContextAttachmentCandidates(
  candidates: IntentCanvasContextSendAttachment[][],
) {
  const merged: IntentCanvasContextSendAttachment[] = [];
  const seen = new Set<string>();
  candidates.flat().forEach((attachment) => {
    if (seen.has(attachment.attachmentId)) {
      return;
    }
    seen.add(attachment.attachmentId);
    merged.push(attachment);
  });
  return merged;
}

function extractIntentCanvasContextAttachmentsFromUserMessageItem(
  item: Record<string, unknown>,
  text: string,
) {
  const metadata = asRecord(item.metadata);
  return mergeIntentCanvasContextAttachmentCandidates([
    normalizeIntentCanvasContextAttachmentList(item.intentCanvasContextAttachments),
    normalizeIntentCanvasContextAttachmentList(item.intent_canvas_context_attachments),
    normalizeIntentCanvasContextAttachmentList(metadata?.intentCanvasContextAttachments),
    normalizeIntentCanvasContextAttachmentList(metadata?.intent_canvas_context_attachments),
    parseIntentCanvasContextSummaries(text),
  ]);
}

function normalizeCommandValue(value: unknown) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (!Array.isArray(value)) {
    return "";
  }
  const parts = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return parts.join(" ").trim();
}

function getFirstStringField(source: Record<string, unknown> | null, keys: string[]) {
  if (!source) {
    return "";
  }
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function getFirstCommandField(source: Record<string, unknown> | null, keys: string[]) {
  if (!source) {
    return "";
  }
  for (const key of keys) {
    const normalized = normalizeCommandValue(source[key]);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function joinReasoningFragments(parts: string[]) {
  const fragments = parts.filter((entry) => entry.length > 0);
  if (fragments.length === 0) {
    return "";
  }
  const firstFragment = fragments[0] ?? "";
  if (fragments.length === 1) {
    return firstFragment;
  }
  return fragments.slice(1).reduce((combined, fragment) => {
    const previousChar = combined[combined.length - 1] ?? "";
    const nextChar = fragment[0] ?? "";
    const shouldInsertSpace =
      /[A-Za-z0-9]/.test(previousChar) &&
      /[A-Za-z0-9]/.test(nextChar);
    return shouldInsertSpace ? `${combined} ${fragment}` : `${combined}${fragment}`;
  }, firstFragment);
}

function extractReasoningText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    // 结构化条目（如 Codex summary_text 段落）是完整段落，用空行分隔；
    // 纯字符串数组是流式 token 碎片，按原有规则无缝拼接。
    // 混合数组按元素类型分别处理：object 段落间空行，相邻 string 碎片无缝拼接。
    if (value.some((entry) => typeof entry === "object" && entry !== null)) {
      const segments: string[] = [];
      let pendingStringFragments: string[] = [];
      const flushStringFragments = () => {
        if (pendingStringFragments.length === 0) {
          return;
        }
        const joined = joinReasoningFragments(pendingStringFragments).trim();
        if (joined) {
          segments.push(joined);
        }
        pendingStringFragments = [];
      };
      value.forEach((entry) => {
        const fragment = extractReasoningText(entry);
        if (!fragment) {
          return;
        }
        if (typeof entry === "object" && entry !== null) {
          flushStringFragments();
          const trimmed = fragment.trim();
          if (trimmed) {
            segments.push(trimmed);
          }
        } else {
          pendingStringFragments.push(fragment);
        }
      });
      flushStringFragments();
      return segments.join("\n\n");
    }
    const fragments = value
      .map((entry) => extractReasoningText(entry))
      .filter(Boolean);
    return joinReasoningFragments(fragments);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const direct =
      extractReasoningText(record.text) ||
      extractReasoningText(record.value) ||
      extractReasoningText(record.content) ||
      extractReasoningText(record.parts) ||
      extractReasoningText(record.summary) ||
      extractReasoningText(record.reasoning);
    return direct;
  }
  return "";
}

function hasVisibleReasoningText(summary: string, content: string): boolean {
  return summary.trim().length > 0 || content.trim().length > 0;
}

function findDuplicateReasoningSnapshotIndex(
  list: ConversationItem[],
  incoming: Extract<ConversationItem, { kind: "reasoning" }>,
) {
  return findEquivalentReasoningObservationIndex(list, incoming);
}

function mergeReasoningSnapshot(
  existing: Extract<ConversationItem, { kind: "reasoning" }>,
  incoming: Extract<ConversationItem, { kind: "reasoning" }>,
): Extract<ConversationItem, { kind: "reasoning" }> {
  const existingSummary = existing.summary.trim();
  const incomingSummary = incoming.summary.trim();
  const existingContent = existing.content.trim();
  const incomingContent = incoming.content.trim();
  return {
    ...existing,
    summary: incomingSummary.length >= existingSummary.length ? incomingSummary : existingSummary,
    content: incomingContent.length >= existingContent.length ? incomingContent : existingContent,
  };
}

function truncateText(text: string, maxLength = MAX_ITEM_TEXT) {
  if (text.length <= maxLength) {
    return text;
  }
  const sliceLength = Math.max(0, maxLength - 3);
  return `${text.slice(0, sliceLength)}...`;
}

function normalizeToolHint(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_]/g, "");
}

function hasStructuredEditDetail(detail: string) {
  const normalized = detail.toLowerCase();
  return (
    normalized.includes("\"old_string\"") ||
    normalized.includes("\"oldstring\"") ||
    normalized.includes("\"new_string\"") ||
    normalized.includes("\"newstring\"") ||
    normalized.includes("\"file_path\"") ||
    normalized.includes("\"filepath\"") ||
    normalized.includes("\"replace_all\"")
  );
}

function hasStructuredJsonDetail(detail: string) {
  const trimmed = detail.trim();
  if (!trimmed) {
    return false;
  }
  const startsLikeJsonObject = trimmed.startsWith("{") && trimmed.endsWith("}");
  const startsLikeJsonArray = trimmed.startsWith("[") && trimmed.endsWith("]");
  if (!startsLikeJsonObject && !startsLikeJsonArray) {
    return false;
  }
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed !== null;
  } catch {
    return false;
  }
}

function shouldPreserveToolDetail(item: Extract<ConversationItem, { kind: "tool" }>) {
  if (NO_TRUNCATE_TOOL_TYPES.has(item.toolType)) {
    return true;
  }
  if (hasStructuredJsonDetail(item.detail)) {
    return true;
  }
  const toolTypeHint = normalizeToolHint(item.toolType);
  if (EDIT_TOOL_TYPE_HINTS.has(toolTypeHint)) {
    return true;
  }
  const title = typeof item.title === "string" ? item.title : "";
  const titleHint = normalizeToolHint(title.replace(/^Tool:\s*/i, ""));
  if (EDIT_TOOL_TYPE_HINTS.has(titleHint)) {
    return true;
  }
  const detail = typeof item.detail === "string" ? item.detail : "";
  if (detail.length > 2000 && hasStructuredEditDetail(detail)) {
    return true;
  }
  return false;
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function extractWebSearchQuery(item: Record<string, unknown>): string {
  const directCandidates = [
    item.query,
    item.q,
    item.searchQuery,
    item.search_query,
    item.prompt,
    item.text,
  ];
  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  const queryPayload = item.search_query ?? item.searchQuery;
  if (Array.isArray(queryPayload)) {
    const queries = queryPayload
      .map((entry) => {
        if (typeof entry === "string") {
          return entry.trim();
        }
        if (!entry || typeof entry !== "object") {
          return "";
        }
        const record = entry as Record<string, unknown>;
        return asString(record.q ?? record.query ?? record.url ?? "").trim();
      })
      .filter(Boolean);
    if (queries.length > 0) {
      return queries.join(" | ");
    }
  }

  if (queryPayload && typeof queryPayload === "object") {
    const record = queryPayload as Record<string, unknown>;
    const nested = asString(record.q ?? record.query ?? record.url ?? "").trim();
    if (nested) {
      return nested;
    }
  }

  return "";
}

function isSuccessfulCommandExecution(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return ["completed", "success", "succeeded", "ok"].includes(normalized);
}

function isApplyPatchCommand(command: string): boolean {
  const normalized = command.toLowerCase();
  return /(?:^|[\s;&|])apply_patch(?:\s|$)/.test(normalized);
}

function hasApplyPatchSuccessSignal(output: string): boolean {
  return /success\.\s*updated the following files:/i.test(output);
}

function extractApplyPatchDiffByPath(command: string) {
  const patchMatch = command.match(/\*\*\* Begin Patch[\s\S]*?\*\*\* End Patch/);
  const patchText = patchMatch?.[0]?.trim();
  if (!patchText) {
    return new Map<string, string>();
  }
  const diffByPath = new Map<string, string>();
  const lines = patchText.split(/\r?\n/);
  let currentPath = "";
  let currentDiffLines: string[] = [];
  const flush = () => {
    if (!currentPath) {
      currentDiffLines = [];
      return;
    }
    const diff = currentDiffLines.join("\n").trim();
    if (diff) {
      diffByPath.set(currentPath, diff);
    }
    currentPath = "";
    currentDiffLines = [];
  };
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.startsWith("*** Update File: ") ||
      trimmed.startsWith("*** Add File: ") ||
      trimmed.startsWith("*** Delete File: ")
    ) {
      flush();
      currentPath = trimmed.replace(/^\*\*\* (?:Update|Add|Delete) File:\s+/, "").trim();
      currentDiffLines = [line];
      continue;
    }
    if (trimmed.startsWith("*** Move to: ")) {
      const movedPath = trimmed.slice("*** Move to: ".length).trim();
      if (movedPath) {
        currentPath = movedPath;
      }
      currentDiffLines.push(line);
      continue;
    }
    if (trimmed === "*** End Patch") {
      currentDiffLines.push(line);
      flush();
      break;
    }
    if (currentPath) {
      currentDiffLines.push(line);
    }
  }
  flush();
  return diffByPath;
}

type NormalizeItemOptions = {
  preserveMessageTextLength?: boolean;
};

export function normalizeItem(
  item: ConversationItem,
  options?: NormalizeItemOptions,
): ConversationItem {
  if (item.kind === "message") {
    let normalizedText =
      item.role === "assistant"
        ? shouldNormalizeAssistantText(item.text)
          ? getNormalizedAssistantMessageText(item.text)
          : item.text
        : item.text;
    if (item.role === "assistant" && isAssistantNoContentPlaceholder(normalizedText)) {
      normalizedText = "";
    }
    return withMessagePresentationMetadata({
      ...item,
      text: options?.preserveMessageTextLength
        ? normalizedText
        : truncateText(normalizedText),
    });
  }
  if (item.kind === "explore") {
    return item;
  }
  if (item.kind === "reasoning") {
    return {
      ...item,
      summary: truncateText(item.summary),
      content: truncateText(item.content),
    };
  }
  if (item.kind === "diff") {
    return { ...item, diff: truncateText(item.diff) };
  }
  if (item.kind === "tool") {
    const shouldKeepDetail = shouldPreserveToolDetail(item);
    const isNoTruncateTool = NO_TRUNCATE_TOOL_TYPES.has(item.toolType);
    return {
      ...item,
      title: truncateText(item.title, 200),
      detail: shouldKeepDetail ? item.detail : truncateText(item.detail, 2000),
      output: isNoTruncateTool
        ? boundToolOutput(item.output, item.toolType)
        : item.output
          ? truncateText(boundToolOutput(item.output, item.toolType))
          : item.output,
      changes: item.changes
        ? item.changes.map((change) => ({
            ...change,
            diff:
              isNoTruncateTool || !change.diff
                ? change.diff
                : truncateText(change.diff),
          }))
        : item.changes,
    };
  }
  if (item.kind === "generatedImage") {
    return {
      ...item,
      promptText: item.promptText ? truncateText(item.promptText, 2000) : item.promptText,
      fallbackText: item.fallbackText
        ? truncateText(item.fallbackText, 4000)
        : item.fallbackText,
      images: item.images.slice(0, 4),
    };
  }
  return item;
}

function mergeToolItemPreservingSnapshot(
  existing: Extract<ConversationItem, { kind: "tool" }>,
  incoming: Extract<ConversationItem, { kind: "tool" }>,
): Extract<ConversationItem, { kind: "tool" }> {
  const hasTitle = incoming.title.trim().length > 0;
  const hasDetail = incoming.detail.trim().length > 0;
  const hasOutput =
    typeof incoming.output === "string" && incoming.output.trim().length > 0;
  const hasChanges = Array.isArray(incoming.changes) && incoming.changes.length > 0;
  return {
    ...existing,
    ...incoming,
    title: hasTitle ? incoming.title : existing.title,
    detail: hasDetail ? incoming.detail : existing.detail,
    output: hasOutput ? incoming.output : existing.output,
    changes: hasChanges ? incoming.changes : existing.changes,
  };
}

function mergeSameKindItem(existing: ConversationItem, incoming: ConversationItem) {
  if (existing.kind === "tool" && incoming.kind === "tool") {
    return mergeToolItemPreservingSnapshot(existing, incoming);
  }
  if (existing.kind === "generatedImage" && incoming.kind === "generatedImage") {
    return {
      ...existing,
      ...incoming,
      status:
        incoming.status === "completed" || incoming.status === "degraded"
          ? incoming.status
          : existing.status,
      promptText: incoming.promptText || existing.promptText,
      fallbackText: incoming.fallbackText || existing.fallbackText,
      anchorUserMessageId: incoming.anchorUserMessageId ?? existing.anchorUserMessageId,
      images: incoming.images.length > 0 ? incoming.images : existing.images,
    };
  }
  return { ...existing, ...incoming } as ConversationItem;
}

function annotateGeneratedImageAnchor(
  items: ConversationItem[],
): ConversationItem[] {
  let latestUserMessageId: string | undefined;
  return items.map((item) => {
    if (item.kind === "message" && item.role === "user") {
      latestUserMessageId = item.id;
      return item;
    }
    if (item.kind !== "generatedImage" || item.anchorUserMessageId) {
      return item;
    }
    return {
      ...item,
      anchorUserMessageId: latestUserMessageId,
    };
  });
}

type PrepareThreadItemsOptions = {
  preserveMessageTextIds?: ReadonlySet<string>;
};

export function prepareThreadItems(
  items: ConversationItem[],
  options?: PrepareThreadItemsOptions,
) {
  prepareThreadItemsCallCountForTests += 1;
  const coalesced: ConversationItem[] = [];
  const coalescedIndexByKey = new Map<string, number>();
  for (const rawItem of items) {
    const item = normalizeItem(rawItem, {
      preserveMessageTextLength:
        rawItem.kind === "message" &&
        options?.preserveMessageTextIds?.has(rawItem.id) === true,
    });
    const key = `${item.kind}\u0000${item.id}`;
    const index = coalescedIndexByKey.get(key);
    if (index === undefined) {
      coalescedIndexByKey.set(key, coalesced.length);
      coalesced.push(item);
      continue;
    }
    const existing = coalesced[index];
    if (!existing) {
      coalescedIndexByKey.set(key, coalesced.length);
      coalesced.push(item);
      continue;
    }
    coalesced[index] = mergeSameKindItem(existing, item);
  }
  const filtered: ConversationItem[] = [];
  for (const item of coalesced) {
    if (
      item.kind === "message" &&
      item.role === "assistant" &&
      item.text.trim().length === 0 &&
      (!item.images || item.images.length === 0) &&
      !item.executionTargetSnapshot
    ) {
      continue;
    }
    const last = filtered[filtered.length - 1];
    if (
      item.kind === "message" &&
      item.role === "assistant" &&
      last?.kind === "review" &&
      last.state === "completed" &&
      item.text.trim() === last.text.trim()
    ) {
      continue;
    }
    filtered.push(item);
  }
  const anchoredItems = annotateGeneratedImageAnchor(filtered);
  const normalizedAskUserItems = normalizeAskUserQuestionHistoryItems(anchoredItems);
  const summarized = summarizeExploration(normalizedAskUserItems);
  const cutoff = Math.max(0, summarized.length - TOOL_OUTPUT_RECENT_ITEMS);
  const noTruncateCutoff = Math.max(
    0,
    summarized.length - NO_TRUNCATE_TOOL_OUTPUT_RECENT_ITEMS,
  );
  return summarized.map((item, index) => {
    if (item.kind !== "tool") {
      return item;
    }
    const isOlderToolItem = index < cutoff;
    const allowNoTruncate =
      NO_TRUNCATE_TOOL_TYPES.has(item.toolType) && index >= noTruncateCutoff;
    if (!isOlderToolItem || allowNoTruncate) {
      return item;
    }
    const output = item.output ? truncateText(item.output) : item.output;
    const changes = item.changes
      ? item.changes.map((change) => ({
          ...change,
          diff: change.diff ? truncateText(change.diff) : change.diff,
        }))
      : item.changes;
    if (output === item.output && changes === item.changes) {
      return item;
    }
    return { ...item, output, changes };
  });
}

export function __resetPrepareThreadItemsCallCountForTests() {
  prepareThreadItemsCallCountForTests = 0;
}

export function __getPrepareThreadItemsCallCountForTests() {
  return prepareThreadItemsCallCountForTests;
}

/**
 * Index at which a newly observed tool should be inserted so late tools do not
 * land after a **settled** trailing assistant conclusion.
 *
 * Failure mode (Grok jsonl bridge / any late ToolStarted after complete):
 * assistant already `isFinal`, tools append at list end → "结论在工具前".
 * History rebuilds correctly; reopen appears fixed.
 *
 * Mid-stream tools after a **non-final** preamble must still append after that
 * preamble so segment++ can place post-tool text after tools
 * (`[preamble, tool, conclusion]`). Only pull tools before trailing assistants
 * when those assistants are already final.
 *
 * @see openspec/changes/fix-live-settle-assistant-tool-order
 * @see docs/analysis/live-settle-assistant-tool-order-2026-08-04.md
 */
export function findToolInsertIndexBeforeTrailingAssistants(
  list: ConversationItem[],
): number {
  let insertAt = list.length;
  let sawFinalTrailingAssistant = false;
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const entry = list[index];
    if (!entry) {
      continue;
    }
    if (entry.kind === "reasoning") {
      // Trailing reasoning may sit after a final assistant; keep walking back.
      insertAt = index;
      continue;
    }
    if (entry.kind === "message" && entry.role === "assistant") {
      if (entry.isFinal === true) {
        sawFinalTrailingAssistant = true;
        insertAt = index;
        continue;
      }
      // Live non-final preamble / in-flight shell: keep append-at-end.
      return list.length;
    }
    break;
  }
  return sawFinalTrailingAssistant ? insertAt : list.length;
}

/**
 * After assistants become final, tools that were appended at the list tail
 * (late ToolStarted while the bubble was still non-final) sit after the
 * conclusion. Move that trailing tool run before the contiguous final
 * assistant/reasoning trailer. No-op when the list already ends on an
 * assistant or when no final assistant precedes the trailing tools.
 */
export function rebalanceTrailingToolsBeforeFinalAssistants(
  list: ConversationItem[],
): ConversationItem[] {
  if (list.length < 2) {
    return list;
  }
  let cursor = list.length - 1;
  while (cursor >= 0 && list[cursor]?.kind === "tool") {
    cursor -= 1;
  }
  const toolsStart = cursor + 1;
  if (toolsStart >= list.length) {
    return list;
  }

  let sawFinalAssistant = false;
  while (cursor >= 0) {
    const entry = list[cursor];
    if (!entry) {
      break;
    }
    if (entry.kind === "reasoning") {
      cursor -= 1;
      continue;
    }
    if (entry.kind === "message" && entry.role === "assistant") {
      if (entry.isFinal === true) {
        sawFinalAssistant = true;
        cursor -= 1;
        continue;
      }
      break;
    }
    break;
  }
  if (!sawFinalAssistant) {
    return list;
  }
  const blockStart = cursor + 1;
  if (blockStart >= toolsStart) {
    return list;
  }

  const prefix = list.slice(0, blockStart);
  const assistantBlock = list.slice(blockStart, toolsStart);
  const trailingTools = list.slice(toolsStart);
  return [...prefix, ...trailingTools, ...assistantBlock];
}

export function upsertItem(list: ConversationItem[], item: ConversationItem) {
  const index = list.findIndex(
    (entry) => entry.id === item.id && entry.kind === item.kind,
  );
  const isMultiAgentHistFold =
    item.kind === "message" && isMultiAgentHistFoldItemId(item.id);

  if (index === -1) {
    if (item.kind === "tool") {
      const insertAt = findToolInsertIndexBeforeTrailingAssistants(list);
      if (insertAt < list.length) {
        const next = list.slice();
        next.splice(insertAt, 0, item);
        return next;
      }
    }
    // Multi-Agent 完成卡：紧跟**本 run** user（及已有同 run fold）之后
    if (isMultiAgentHistFold) {
      const insertAt = resolveMultiAgentHistFoldInsertIndex(list, item.id);
      if (insertAt != null) {
        const next = list.slice();
        next.splice(insertAt, 0, item);
        return next;
      }
    }
    return [...list, item];
  }
  const next = [...list];
  const existing = next[index];
  if (!existing) {
    return [...list, item];
  }
  next[index] = mergeSameKindItem(existing, item);

  // 已存在但位置错：取出后按本 run user 目标位重插
  if (isMultiAgentHistFold) {
    const [foldItem] = next.splice(index, 1);
    if (!foldItem) return next;
    const insertAt = resolveMultiAgentHistFoldInsertIndex(next, item.id);
    if (insertAt != null) {
      next.splice(insertAt, 0, foldItem);
    } else {
      next.push(foldItem);
    }
  }
  return next;
}

export function buildConversationItem(
  item: Record<string, unknown>,
): ConversationItem | null {
  const type = asString(item.type);
  const id = resolveConversationItemId(type, item);
  if (!id || !type) {
    return null;
  }
  if (type === "agentMessage") {
    return null;
  }
  if (type === "userMessage") {
    const content = Array.isArray(item.content) ? item.content : [];
    const {
      text,
      images,
      collaborationMode: fallbackCollaborationMode,
    } = parseUserInputs(content);
    const fallbackPayload = extractFallbackUserMessagePayload(item);
    const resolvedText = text || fallbackPayload.text;
    const resolvedImages = images.length > 0 ? images : fallbackPayload.images;
    const collaborationMode = extractCollaborationModeFromUserMessageItem(
      item,
      fallbackCollaborationMode ?? fallbackPayload.collaborationMode,
    );
    const selectedAgentName = extractSelectedAgentNameFromUserMessageItem(
      item,
      resolvedText,
    );
    const selectedAgentIcon = extractSelectedAgentIconFromUserMessageItem(
      item,
      resolvedText,
    );
    const intentCanvasContextAttachments =
      extractIntentCanvasContextAttachmentsFromUserMessageItem(item, resolvedText);
    return {
      id,
      kind: "message",
      role: "user",
      text: resolvedText,
      images: resolvedImages.length > 0 ? resolvedImages : undefined,
      collaborationMode,
      selectedAgentName,
      selectedAgentIcon,
      ...(intentCanvasContextAttachments.length > 0
        ? { intentCanvasContextAttachments }
        : {}),
    };
  }
  if (type === "reasoning") {
    const summary = extractReasoningText(item.summary ?? "");
    const contentFromItem = extractReasoningText(item.content ?? "");
    const content = contentFromItem || asString(item.text ?? "");
    const encryptedContent = asString(
      item.encrypted_content ?? item.encryptedContent ?? "",
    );
    if (!hasVisibleReasoningText(summary, content)) {
      if (!encryptedContent) {
        return null;
      }
      // Newer Codex Responses can return encrypted reasoning only.
      // Keep a visible placeholder so activity counters don't drop to zero.
      return { id, kind: "reasoning", summary: "Encrypted reasoning", content: "" };
    }
    return { id, kind: "reasoning", summary, content };
  }
  if (isNativeGeneratedImageItemType(type)) {
    return buildGeneratedImageConversationItem(id, type, item);
  }
  if (type === "plan" || type === "planImplementation") {
    const toolType = type === "plan" ? "proposed-plan" : "plan-implementation";
    const actionId = extractImplementPlanActionId(item);
    const planText = formatPlanSteps(item.steps ?? item.plan);
    const fallbackOutput =
      asString(item.content ?? item.text ?? item.summary ?? item.explanation ?? "");
    return {
      id,
      kind: "tool",
      toolType,
      title: type === "plan" ? "Proposed Plan" : "Plan Implementation",
      detail: actionId || "",
      status: asString(item.status ?? ""),
      output: planText || fallbackOutput,
    };
  }
  if (type === "commandExecution") {
    const input = asRecord(item.input);
    const nestedArgs = asRecord(item.arguments);
    const commandKeys = [
      "command",
      "cmd",
      "script",
      "shell_command",
      "bash",
      "argv",
    ];
    const descriptionKeys = [
      "description",
      "summary",
      "label",
      "title",
      "task",
    ];
    const cwdKeys = ["cwd", "workdir", "working_directory", "workingDirectory"];
    const command =
      getFirstCommandField(item, commandKeys) ||
      getFirstCommandField(input, commandKeys) ||
      getFirstCommandField(nestedArgs, commandKeys);
    const description =
      getFirstStringField(item, descriptionKeys) ||
      getFirstStringField(input, descriptionKeys) ||
      getFirstStringField(nestedArgs, descriptionKeys);
    const cwd =
      getFirstStringField(item, cwdKeys) ||
      getFirstStringField(input, cwdKeys) ||
      getFirstStringField(nestedArgs, cwdKeys) ||
      asString(item.cwd ?? "");
    const detailPayload = description
      ? JSON.stringify(
          {
            command: command || undefined,
            description,
            cwd: cwd || undefined,
          },
        )
      : "";
    const status = asString(item.status ?? "");
    const output = stringifyUnknown(
      item.aggregatedOutput ??
        item.output ??
        item.result ??
        item.stdout ??
        item.stderr ??
        item.text ??
        item.error ??
        "",
    );
    const durationMs = asNumber(item.durationMs ?? item.duration_ms);
    const isSuccessfulOrApplyPatchMarked =
      isSuccessfulCommandExecution(status) || hasApplyPatchSuccessSignal(output);
    const commandLooksLikeApplyPatch = command ? isApplyPatchCommand(command) : false;
    const commandTextChanges =
      command && isSuccessfulOrApplyPatchMarked && !commandLooksLikeApplyPatch
        ? inferMutatingFileChangesFromCommand(command)
        : [];
    const shouldTreatAsFileChange =
      command &&
      isSuccessfulOrApplyPatchMarked &&
      (commandLooksLikeApplyPatch || commandTextChanges.length > 0);
    if (shouldTreatAsFileChange) {
      const normalizedChanges = commandLooksLikeApplyPatch
        ? inferFileChangesFromCommandExecutionArtifacts(command, output)
        : commandTextChanges;
      if (normalizedChanges.length > 0) {
        const patchDiffByPath = extractApplyPatchDiffByPath(command);
        const enrichedChanges = normalizedChanges.map((change) => ({
          ...change,
          diff:
            change.diff ||
            patchDiffByPath.get(change.path.trim()) ||
            change.diff,
        }));
        const formattedChanges = normalizedChanges
          .map((change) => {
            const prefix =
              change.kind === "add"
                ? "A"
                : change.kind === "delete"
                  ? "D"
                  : change.kind === "rename"
                    ? "R"
                    : change.kind
                      ? "M"
                      : "";
            return [prefix, change.path].filter(Boolean).join(" ");
          })
          .filter(Boolean);
        return {
          id,
          kind: "tool",
          toolType: "fileChange",
          title: "File changes",
          detail: formattedChanges.join(", ") || "Pending changes",
          status,
          output,
          changes: enrichedChanges,
        };
      }
    }
    const titleText = description || command;
    return {
      id,
      kind: "tool",
      toolType: type,
      title: titleText ? `Command: ${titleText}` : "Command",
      detail: detailPayload || cwd,
      status,
      output,
      durationMs,
    };
  }
  if (type === "fileChange") {
    const namedTitle = asString(item.title ?? item.tool ?? item.name ?? "").trim();
    const changes = Array.isArray(item.changes)
      ? item.changes
      : Array.isArray(item.files)
        ? item.files
        : [];
    const inferredChanges =
      changes.length > 0
        ? inferFileChangesFromPayload(item.input ?? item.arguments ?? null)
        : inferFileChangesFromPayload(item.input ?? item.arguments ?? item);
    const inferredChangeByPath = new Map(
      inferredChanges.map((change) => [change.path, change]),
    );
    const normalizedChanges = (changes.length > 0 ? changes : inferredChanges)
      .map((change) => {
        const path = asString(
          change?.path ??
            change?.file_path ??
            change?.filePath ??
            change?.filename ??
            "",
        );
        const inferredChange = path ? inferredChangeByPath.get(path) : undefined;
        const kind = change?.kind as Record<string, unknown> | string | undefined;
        const rawKind =
          typeof kind === "string"
            ? kind
            : typeof kind === "object" && kind
              ? asString(
                  (kind as Record<string, unknown>).type ??
                    (kind as Record<string, unknown>).status ??
                    "",
                )
              : asString(
                  change?.status ?? change?.type ?? inferredChange?.kind ?? "",
                );
        const normalizedKind = normalizeFileChangeKind(rawKind);
        const diff = asString(
          change?.diff ??
            change?.patch ??
            change?.unifiedDiff ??
            change?.unified_diff ??
            inferredChange?.diff ??
            change?.output ??
            "",
        );
        return { path, kind: normalizedKind || undefined, diff: diff || undefined };
      })
      .filter((change) => change.path);
    const formattedChanges = normalizedChanges
      .map((change) => {
        const prefix =
          change.kind === "add"
            ? "A"
            : change.kind === "delete"
              ? "D"
              : change.kind === "rename"
                ? "R"
              : change.kind
                ? "M"
                : "";
        return [prefix, change.path].filter(Boolean).join(" ");
      })
      .filter(Boolean);
    const paths = formattedChanges.join(", ");
    const diffOutput = normalizedChanges
      .map((change) => change.diff ?? "")
      .filter(Boolean)
      .join("\n\n");
    const explicitOutput = asString(item.aggregatedOutput ?? item.output ?? item.text ?? "");
    const preferExplicitOutput = shouldPreferExplicitFileChangeOutput(explicitOutput);
    return {
      id,
      kind: "tool",
      toolType: type,
      // Prefer runtime tool name (write_file / Edit / …) for specialized EditToolBlock polish.
      title: namedTitle || "File changes",
      detail: paths || "Pending changes",
      status: asString(item.status ?? ""),
      output: preferExplicitOutput ? explicitOutput : diffOutput || explicitOutput,
      changes: normalizedChanges,
    };
  }
  if (type === "mcpToolCall") {
    const server = asString(item.server ?? "");
    const tool = asString(item.tool ?? "");
    const argsPayload = item.arguments ?? null;
    const args = argsPayload ? JSON.stringify(argsPayload, null, 2) : "";
    const output = asString(
      item.result ??
        item.output ??
        item.aggregatedOutput ??
        item.stdout ??
        item.stderr ??
        item.text ??
        item.error ??
        "",
    );
    if (server.trim().toLowerCase() === "codex" && isGeneratedImageToolName(tool)) {
      const artifact = resolveGeneratedImageArtifact(
        asString(item.status ?? ""),
        argsPayload,
        output,
      );
      return {
        id,
        kind: "generatedImage",
        status: artifact.status,
        sourceToolName: tool,
        promptText: artifact.promptText,
        fallbackText: artifact.fallbackText,
        images: artifact.images,
      };
    }
    // Prefer bare tool name for canvas scene grouping (read/edit/search).
    // Keep server prefix only when it adds identity beyond generic agent labels.
    const serverLabel = server.trim().toLowerCase();
    const title =
      tool.trim().length > 0 &&
      (serverLabel === "" || serverLabel === "agent" || serverLabel === "claude")
        ? tool
        : `Tool: ${server}${tool ? ` / ${tool}` : ""}`;
    return {
      id,
      kind: "tool",
      toolType: type,
      title,
      detail: args,
      status: asString(item.status ?? ""),
      output,
    };
  }
  if (type === "collabToolCall" || type === "collabAgentToolCall") {
    const tool = asString(item.tool ?? "");
    const status = asString(item.status ?? "");
    const sender = asString(item.senderThreadId ?? item.sender_thread_id ?? "");
    // Live 与 history 对齐：targets / ids / arguments；禁止把 call id 当 agent
    const receivers = extractCollabReceiversFromToolPayload(item);
    const prompt = asString(item.prompt ?? "");
    const normalizedAgentStatus = normalizeCollabAgentStatusMap(
      item.agentStatus ?? item.agentsStates ?? item.agents_states,
    );
    const agentsState = formatCollabAgentStates(normalizedAgentStatus);
    const detailParts = [sender ? `From ${sender}` : ""]
      .concat(receivers.length > 0 ? `→ ${receivers.join(", ")}` : "")
      .filter(Boolean);
    const outputParts = [prompt, agentsState].filter(Boolean);
    return {
      id,
      kind: "tool",
      toolType: "collabToolCall",
      title: tool ? `Collab: ${tool}` : "Collab tool call",
      detail: detailParts.join(" "),
      status,
      output: outputParts.join("\n\n"),
      senderThreadId: sender || undefined,
      receiverThreadIds: receivers,
      ...(normalizedAgentStatus ? { agentStatus: normalizedAgentStatus } : {}),
    };
  }
  if (type === "webSearch") {
    const query = extractWebSearchQuery(item);
    const detail = query ? JSON.stringify({ query }) : asString(item.query ?? "");
    const output = stringifyUnknown(
      item.result ??
        item.output ??
        item.response ??
        item.results ??
        item.text ??
        item.error ??
        "",
    );
    return {
      id,
      kind: "tool",
      toolType: type,
      title: "Web search",
      detail,
      status: asString(item.status ?? ""),
      output,
    };
  }
  if (type === "imageView") {
    return {
      id,
      kind: "tool",
      toolType: type,
      title: "Image view",
      detail: asString(item.path ?? ""),
      status: "",
      output: "",
    };
  }
  if (type === "enteredReviewMode" || type === "exitedReviewMode") {
    return {
      id,
      kind: "review",
      state: type === "enteredReviewMode" ? "started" : "completed",
      text: asString(item.review ?? ""),
    };
  }
  return null;
}

function extractImageInputValue(input: Record<string, unknown>) {
  const value =
    asString(input.url ?? "") ||
    asString(input.image_url ?? "") ||
    asString(input.imageUrl ?? "") ||
    asString(input.path ?? "") ||
    asString(input.local_path ?? "") ||
    asString(input.localPath ?? "") ||
    asString(input.uri ?? "") ||
    asString(input.src ?? "") ||
    asString(input.value ?? "") ||
    asString(input.data ?? "") ||
    asString(input.source ?? "");
  return value.trim();
}

function parseUserInputs(inputs: Array<Record<string, unknown>>) {
  const textParts: string[] = [];
  const images: string[] = [];
  let collaborationMode: "plan" | "code" | null = null;

  const needsSeparatorBetween = (previous: string, next: string) => {
    if (!previous || !next) {
      return false;
    }
    if (/\s$/.test(previous) || /^\s/.test(next)) {
      return false;
    }
    if (/\$[^\s]+$/.test(previous.trimEnd())) {
      return true;
    }
    const previousChar = previous[previous.length - 1] ?? "";
    const nextChar = next[0] ?? "";
    return /[A-Za-z0-9]/.test(previousChar) && /[A-Za-z0-9]/.test(nextChar);
  };

  const appendTextPart = (value: string) => {
    if (!value) {
      return;
    }
    const previous = textParts[textParts.length - 1] ?? "";
    if (needsSeparatorBetween(previous, value)) {
      textParts.push(` ${value}`);
      return;
    }
    textParts.push(value);
  };

  const appendSkillPart = (name: string) => {
    if (!name) {
      return;
    }
    const token = `$${name}`;
    const previous = textParts[textParts.length - 1] ?? "";
    if (!previous) {
      textParts.push(token);
      return;
    }
    if (/\s$/.test(previous)) {
      textParts.push(token);
      return;
    }
    textParts.push(` ${token}`);
  };

  inputs.forEach((input) => {
    const type = asString(input.type).trim().toLowerCase();
    if (type === "text" || type === "input_text") {
      const text = asString(input.text);
      if (text) {
        collaborationMode = collaborationMode ?? extractModeFallbackMode(text);
        appendTextPart(normalizeUserMessageText(text));
      }
      return;
    }
    if (type === "skill") {
      const name = asString(input.name);
      appendSkillPart(name);
      return;
    }
    if (
      type === "image" ||
      type === "localimage" ||
      type === "local_image" ||
      type === "input_image"
    ) {
      const value = extractImageInputValue(input);
      if (value) {
        images.push(value);
      }
    }
  });
  return {
    text: textParts.join("").trim(),
    images,
    collaborationMode,
  };
}

export function buildConversationItemFromThreadItem(
  item: Record<string, unknown>,
): ConversationItem | null {
  const type = asString(item.type);
  const id = resolveConversationItemId(type, item);
  if (!id || !type) {
    return null;
  }
  if (type === "userMessage") {
    const content = Array.isArray(item.content) ? item.content : [];
    const {
      text,
      images,
      collaborationMode: fallbackCollaborationMode,
    } = parseUserInputs(content);
    const fallbackPayload = extractFallbackUserMessagePayload(item);
    const resolvedText = text || fallbackPayload.text;
    const resolvedImages = images.length > 0 ? images : fallbackPayload.images;
    const collaborationMode = extractCollaborationModeFromUserMessageItem(
      item,
      fallbackCollaborationMode ?? fallbackPayload.collaborationMode,
    );
    const selectedAgentName = extractSelectedAgentNameFromUserMessageItem(
      item,
      resolvedText,
    );
    const selectedAgentIcon = extractSelectedAgentIconFromUserMessageItem(
      item,
      resolvedText,
    );
    const intentCanvasContextAttachments =
      extractIntentCanvasContextAttachmentsFromUserMessageItem(item, resolvedText);
    return {
      id,
      kind: "message",
      role: "user",
      text: resolvedText,
      images: resolvedImages.length > 0 ? resolvedImages : undefined,
      collaborationMode,
      selectedAgentName,
      selectedAgentIcon,
      ...(intentCanvasContextAttachments.length > 0
        ? { intentCanvasContextAttachments }
        : {}),
    };
  }
  if (type === "agentMessage") {
    const isFinal = extractAssistantFinalFlag(item);
    const finalCompletedAt = extractFinalCompletedAtMs(item);
    const finalDurationMs = extractFinalDurationMs(item);
    const turnTokens = extractFinalTurnTokenCounts(item);
    return {
      id,
      kind: "message",
      role: "assistant",
      text: asString(item.text),
      ...(typeof isFinal === "boolean" ? { isFinal } : {}),
      ...(typeof finalCompletedAt === "number" ? { finalCompletedAt } : {}),
      ...(typeof finalDurationMs === "number" ? { finalDurationMs } : {}),
      ...(turnTokens
        ? {
            finalInputTokens: turnTokens.inputTokens,
            finalOutputTokens: turnTokens.outputTokens,
          }
        : {}),
    };
  }
  if (type === "reasoning") {
    const summary = extractReasoningText(item.summary ?? "");
    const contentFromItem = extractReasoningText(item.content ?? "");
    const content = contentFromItem || asString(item.text ?? "");
    const encryptedContent = asString(
      item.encrypted_content ?? item.encryptedContent ?? "",
    );
    if (!hasVisibleReasoningText(summary, content)) {
      if (!encryptedContent) {
        return null;
      }
      return { id, kind: "reasoning", summary: "Encrypted reasoning", content: "" };
    }
    return { id, kind: "reasoning", summary, content };
  }
  return buildConversationItem(item);
}

export function buildItemsFromThread(thread: Record<string, unknown>) {
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  const items: ConversationItem[] = [];
  turns.forEach((turn) => {
    const turnRecord = turn as Record<string, unknown>;
    const turnCompletedAtMs =
      parseTimestampLikeMs(
        turnRecord.completedAt ??
          turnRecord.completed_at ??
          turnRecord.updatedAt ??
          turnRecord.updated_at ??
          turnRecord.createdAt ??
          turnRecord.created_at ??
          null,
      );
    const turnDurationMsRaw = asNumber(
      turnRecord.durationMs ??
        turnRecord.duration_ms ??
        turnRecord.duration ??
        null,
    );
    const turnDurationMs = turnDurationMsRaw !== null && turnDurationMsRaw >= 0
      ? turnDurationMsRaw
      : undefined;
    const turnItems = Array.isArray(turnRecord.items)
      ? (turnRecord.items as Record<string, unknown>[])
      : [];
    let lastAssistantMessageIndexInTurn = -1;
    let finalAssistantMessageIndexInTurn = -1;
    let hasExplicitFinalAssistantInTurn = false;
    let turnStartedAtMs: number | undefined;
    const assistantTimestampByIndex = new Map<number, number>();
    turnItems.forEach((item) => {
      const itemRecord = item as Record<string, unknown>;
      const converted = buildConversationItemFromThreadItem(itemRecord);
      if (converted) {
        const convertedIndex = items.length;
        const itemTimestampMs = extractHistoryItemTimestampMs(itemRecord);
        if (
          converted.kind === "message" &&
          converted.role === "user" &&
          typeof itemTimestampMs === "number"
        ) {
          turnStartedAtMs = itemTimestampMs;
        }
        if (converted.kind === "message" && converted.role === "assistant") {
          if (converted.isFinal === true) {
            hasExplicitFinalAssistantInTurn = true;
            finalAssistantMessageIndexInTurn = convertedIndex;
          }
          lastAssistantMessageIndexInTurn = convertedIndex;
          if (typeof itemTimestampMs === "number") {
            assistantTimestampByIndex.set(convertedIndex, itemTimestampMs);
          }
        }
        if (converted.kind === "reasoning") {
          const duplicateIndex = findDuplicateReasoningSnapshotIndex(items, converted);
          if (duplicateIndex >= 0 && items[duplicateIndex]?.kind === "reasoning") {
            items[duplicateIndex] = mergeReasoningSnapshot(
              items[duplicateIndex] as Extract<ConversationItem, { kind: "reasoning" }>,
              converted,
            );
            return;
          }
        }
        items.push(converted);
      }
    });
    if (!hasExplicitFinalAssistantInTurn && lastAssistantMessageIndexInTurn >= 0) {
      const lastAssistant = items[lastAssistantMessageIndexInTurn];
      if (
        lastAssistant &&
        lastAssistant.kind === "message" &&
        lastAssistant.role === "assistant" &&
        lastAssistant.isFinal !== true
      ) {
        items[lastAssistantMessageIndexInTurn] = {
          ...lastAssistant,
          isFinal: true,
        };
        finalAssistantMessageIndexInTurn = lastAssistantMessageIndexInTurn;
      }
    }
    if (finalAssistantMessageIndexInTurn >= 0) {
      const finalAssistant = items[finalAssistantMessageIndexInTurn];
      if (finalAssistant && finalAssistant.kind === "message" && finalAssistant.role === "assistant") {
        const completedAtCandidates = [
          finalAssistant.finalCompletedAt,
          assistantTimestampByIndex.get(finalAssistantMessageIndexInTurn),
          turnCompletedAtMs,
        ].filter((value): value is number => typeof value === "number" && value > 0);
        const completedAt =
          completedAtCandidates.length > 0 ? Math.max(...completedAtCandidates) : undefined;
        const durationCandidates = [
          finalAssistant.finalDurationMs,
          turnDurationMs,
          typeof completedAt === "number" && typeof turnStartedAtMs === "number"
            ? Math.max(0, completedAt - turnStartedAtMs)
            : undefined,
        ].filter((value): value is number => typeof value === "number" && value >= 0);
        const durationMs =
          durationCandidates.length > 0 ? Math.max(...durationCandidates) : undefined;
        if (
          completedAt !== finalAssistant.finalCompletedAt ||
          durationMs !== finalAssistant.finalDurationMs
        ) {
          items[finalAssistantMessageIndexInTurn] = {
            ...finalAssistant,
            ...(typeof completedAt === "number" ? { finalCompletedAt: completedAt } : {}),
            ...(typeof durationMs === "number" ? { finalDurationMs: durationMs } : {}),
          };
        }
      }
    }
  });
  return items;
}

export function isReviewingFromThread(thread: Record<string, unknown>) {
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  let reviewing = false;
  turns.forEach((turn) => {
    const turnRecord = turn as Record<string, unknown>;
    const turnItems = Array.isArray(turnRecord.items)
      ? (turnRecord.items as Record<string, unknown>[])
      : [];
    turnItems.forEach((item) => {
      const type = asString(item?.type ?? "");
      if (type === "enteredReviewMode") {
        reviewing = true;
      } else if (type === "exitedReviewMode") {
        reviewing = false;
      }
    });
  });
  return reviewing;
}

function chooseRicherItem(remote: ConversationItem, local: ConversationItem) {
  if (remote.kind !== local.kind) {
    return remote;
  }
  if (remote.kind === "message" && local.kind === "message") {
    if (remote.role !== local.role) {
      return remote;
    }
    const withFinalFlag = (
      candidate: Extract<ConversationItem, { kind: "message" }>,
    ): Extract<ConversationItem, { kind: "message" }> => {
      if (candidate.role !== "assistant") {
        return candidate;
      }
      const isFinal = Boolean(candidate.isFinal || remote.isFinal || local.isFinal);
      const completedAtCandidates = [
        candidate.finalCompletedAt,
        remote.finalCompletedAt,
        local.finalCompletedAt,
      ].filter((value): value is number => typeof value === "number" && value > 0);
      const mergedCompletedAt =
        completedAtCandidates.length > 0 ? Math.max(...completedAtCandidates) : undefined;
      const durationCandidates = [
        candidate.finalDurationMs,
        remote.finalDurationMs,
        local.finalDurationMs,
      ].filter((value): value is number => typeof value === "number" && value >= 0);
      const mergedDurationMs =
        durationCandidates.length > 0 ? Math.max(...durationCandidates) : undefined;
      const inputTokenCandidates = [
        candidate.finalInputTokens,
        remote.finalInputTokens,
        local.finalInputTokens,
      ].filter((value): value is number => typeof value === "number" && value >= 0);
      const mergedInputTokens =
        inputTokenCandidates.length > 0 ? Math.max(...inputTokenCandidates) : undefined;
      const outputTokenCandidates = [
        candidate.finalOutputTokens,
        remote.finalOutputTokens,
        local.finalOutputTokens,
      ].filter((value): value is number => typeof value === "number" && value >= 0);
      const mergedOutputTokens =
        outputTokenCandidates.length > 0 ? Math.max(...outputTokenCandidates) : undefined;
      if (
        (candidate.isFinal ?? false) === isFinal &&
        candidate.finalCompletedAt === mergedCompletedAt &&
        candidate.finalDurationMs === mergedDurationMs &&
        candidate.finalInputTokens === mergedInputTokens &&
        candidate.finalOutputTokens === mergedOutputTokens
      ) {
        return candidate;
      }
      return {
        ...candidate,
        isFinal,
        ...(mergedCompletedAt !== undefined ? { finalCompletedAt: mergedCompletedAt } : {}),
        ...(mergedDurationMs !== undefined ? { finalDurationMs: mergedDurationMs } : {}),
        ...(mergedInputTokens !== undefined ? { finalInputTokens: mergedInputTokens } : {}),
        ...(mergedOutputTokens !== undefined ? { finalOutputTokens: mergedOutputTokens } : {}),
      };
    };
    if (remote.role !== "assistant") {
      return local.text.length > remote.text.length ? local : remote;
    }
    const remoteScored = scoreAssistantMessageReadability(remote.text);
    const localScored = scoreAssistantMessageReadability(local.text);
    if (localScored.score < remoteScored.score) {
      return withFinalFlag({ ...local, text: localScored.normalized });
    }
    if (remoteScored.score < localScored.score) {
      return withFinalFlag({ ...remote, text: remoteScored.normalized });
    }
    if (
      compactMessageText(remoteScored.normalized) ===
      compactMessageText(localScored.normalized)
    ) {
      return localScored.normalized.length >= remoteScored.normalized.length
        ? withFinalFlag({ ...local, text: localScored.normalized })
        : withFinalFlag({ ...remote, text: remoteScored.normalized });
    }
    return localScored.normalized.length > remoteScored.normalized.length
      ? withFinalFlag({ ...local, text: localScored.normalized })
      : withFinalFlag({ ...remote, text: remoteScored.normalized });
  }
  if (remote.kind === "reasoning" && local.kind === "reasoning") {
    const remoteLength = remote.summary.length + remote.content.length;
    const localLength = local.summary.length + local.content.length;
    return localLength > remoteLength ? local : remote;
  }
  if (remote.kind === "tool" && local.kind === "tool") {
    const remoteLength = (remote.output ?? "").length;
    const localLength = (local.output ?? "").length;
    const base = localLength > remoteLength ? local : remote;
    return {
      ...base,
      status: remote.status ?? local.status,
      output: localLength > remoteLength ? local.output : remote.output,
      changes: mergeToolChanges(remote.changes, local.changes),
    };
  }
  if (remote.kind === "generatedImage" && local.kind === "generatedImage") {
    const localIsRicher =
      local.images.length > remote.images.length ||
      (local.status === "completed" && remote.status !== "completed") ||
      (local.status === "degraded" && remote.status === "processing");
    return localIsRicher
      ? {
          ...local,
          promptText: local.promptText || remote.promptText,
          fallbackText: local.fallbackText || remote.fallbackText,
          anchorUserMessageId: local.anchorUserMessageId ?? remote.anchorUserMessageId,
        }
      : {
          ...remote,
          promptText: remote.promptText || local.promptText,
          fallbackText: remote.fallbackText || local.fallbackText,
          anchorUserMessageId: remote.anchorUserMessageId ?? local.anchorUserMessageId,
        };
  }
  if (remote.kind === "diff" && local.kind === "diff") {
    const useLocal = local.diff.length > remote.diff.length;
    return {
      ...remote,
      diff: useLocal ? local.diff : remote.diff,
      status: remote.status ?? local.status,
    };
  }
  return remote;
}

export function mergeThreadItems(
  remoteItems: ConversationItem[],
  localItems: ConversationItem[],
) {
  if (!localItems.length) {
    return remoteItems;
  }
  const remoteIds = new Set(remoteItems.map((item) => item.id));
  const localById = new Map(localItems.map((item) => [item.id, item]));
  const merged = remoteItems.map((item) => {
    const local = localById.get(item.id);
    return local ? chooseRicherItem(item, local) : item;
  });
  localItems.forEach((item) => {
    if (!remoteIds.has(item.id)) {
      merged.push(item);
    }
  });
  return merged;
}
