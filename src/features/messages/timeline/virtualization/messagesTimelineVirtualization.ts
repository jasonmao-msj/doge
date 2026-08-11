import type { ConversationItem } from "../../../../types";
import type { TimelineProjectionRow } from "../projection/messagesTimelineProjection";

/** 历史门槛常量（虚拟化已移除；仅诊断/测试引用）。 */
export const TIMELINE_VIRTUALIZATION_MIN_ROWS = 48;
export const TIMELINE_VIRTUALIZATION_STREAMING_MIN_ROWS = 16;
export const TIMELINE_VIRTUALIZATION_MIN_RENDER_WEIGHT = 96;
export const TIMELINE_VIRTUALIZATION_HEAVY_ROW_WEIGHT = 16;
export const TIMELINE_RENDER_WEIGHT_BASELINE_FLAG_KEY =
  "doge.perf.timelineRenderWeightBaseline";
/**
 * Adaptive render-weight 统计仍开启（轻量诊断 / heavy 行计数）。
 * 2026-08：消息时间线列表虚拟化已永久关闭（对齐 reference desktop client 全量 DOM）。
 */
export const TIMELINE_ADAPTIVE_RENDERING_ENABLED = true;

export type TimelineRenderWeightCategory =
  | "anchorOutlinePressure"
  | "codeFence"
  | "deferredImage"
  | "diff"
  | "generatedImage"
  | "image"
  | "markdownTable"
  | "messageText"
  | "readBatch"
  | "reasoning"
  | "review"
  | "toolOutput"
  | "toolRawPayload";

export type TimelineRenderWeightCategoryCounts = Partial<
  Record<TimelineRenderWeightCategory, number>
>;

export type TimelineRenderWeightSummary = {
  rowCount: number;
  renderWeight: number;
  heavyRowCount: number;
  categoryCounts: TimelineRenderWeightCategoryCounts;
};

/** @deprecated 时间线虚拟化已移除；恒为 false。 */
export const TIMELINE_VIRTUALIZATION_DURING_STREAMING_ENABLED = false;

function canReadBaselineFlag() {
  if (typeof globalThis === "undefined") {
    return false;
  }
  try {
    return typeof globalThis.localStorage !== "undefined";
  } catch {
    return false;
  }
}

export function isTimelineRenderWeightGateEnabled() {
  if (!TIMELINE_ADAPTIVE_RENDERING_ENABLED) {
    return false;
  }
  if (!canReadBaselineFlag()) {
    return true;
  }
  try {
    const value = globalThis.localStorage.getItem(TIMELINE_RENDER_WEIGHT_BASELINE_FLAG_KEY);
    return value !== "1" && value !== "true" && value !== "on";
  } catch {
    return true;
  }
}

export function shouldVirtualizeTimelineRows(_input: {
  isThinking: boolean;
  isWorking?: boolean;
  rowCount: number;
  renderWeight?: number;
}): boolean {
  void _input;
  return false;
}

type RenderWeightBreakdown = {
  weight: number;
  categoryCounts: TimelineRenderWeightCategoryCounts;
};

function incrementCategory(
  categoryCounts: TimelineRenderWeightCategoryCounts,
  category: TimelineRenderWeightCategory,
  amount: number,
) {
  if (amount <= 0) {
    return;
  }
  categoryCounts[category] = (categoryCounts[category] ?? 0) + amount;
}

function mergeCategoryCounts(
  target: TimelineRenderWeightCategoryCounts,
  source: TimelineRenderWeightCategoryCounts,
) {
  for (const [category, amount] of Object.entries(source)) {
    incrementCategory(
      target,
      category as TimelineRenderWeightCategory,
      typeof amount === "number" ? amount : 0,
    );
  }
}

function countRegexMatches(input: string, pattern: RegExp, maxCount: number) {
  let count = 0;
  for (const _match of input.matchAll(pattern)) {
    count += 1;
    if (count >= maxCount) {
      break;
    }
  }
  return count;
}

function countMarkdownTableRows(text: string) {
  let tableRows = 0;
  for (const line of text.split(/\r?\n/)) {
    const pipeCount = countRegexMatches(line, /\|/g, 8);
    if (pipeCount >= 2) {
      tableRows += 1;
    }
    if (tableRows >= 160) {
      break;
    }
  }
  return tableRows;
}

function estimateMarkdownTextBreakdown(text: string): RenderWeightBreakdown {
  const categoryCounts: TimelineRenderWeightCategoryCounts = {};
  let weight = Math.min(24, Math.floor(text.length / 2_000));
  incrementCategory(categoryCounts, "messageText", weight);

  const tableRows = countMarkdownTableRows(text);
  if (tableRows > 0) {
    const tableWeight = Math.min(48, tableRows * 2);
    weight += tableWeight;
    incrementCategory(categoryCounts, "markdownTable", tableRows);
  }

  const codeFenceCount = countRegexMatches(text, /(^|\n)(```|~~~)/g, 32);
  if (codeFenceCount > 0) {
    const codeFenceWeight = Math.min(40, codeFenceCount * 6 + Math.floor(text.length / 6_000));
    weight += codeFenceWeight;
    incrementCategory(categoryCounts, "codeFence", codeFenceCount);
  }

  const toolXmlCount = countRegexMatches(
    text,
    /<(?:function_calls?|invoke|tool_call|tool_result|tool_use)\b/gi,
    12,
  );
  if (toolXmlCount > 0) {
    const toolXmlWeight = Math.min(36, toolXmlCount * 12);
    weight += toolXmlWeight;
    incrementCategory(categoryCounts, "toolRawPayload", toolXmlCount);
  }

  return { weight, categoryCounts };
}

function estimateConversationItemRenderWeight(item: ConversationItem): RenderWeightBreakdown {
  const categoryCounts: TimelineRenderWeightCategoryCounts = {};
  if (item.kind === "message") {
    const imageWeight = (item.images ?? []).reduce((total, image) => {
      const inlineDataWeight = image.toLowerCase().startsWith("data:image/")
        ? Math.min(160, Math.ceil(image.length / 32_768))
        : 0;
      return total + 28 + inlineDataWeight;
    }, 0);
    const deferredImageWeight = (item.deferredImages?.length ?? 0) * 18;
    const textBreakdown = estimateMarkdownTextBreakdown(item.text);
    incrementCategory(categoryCounts, "image", item.images?.length ?? 0);
    incrementCategory(categoryCounts, "deferredImage", item.deferredImages?.length ?? 0);
    mergeCategoryCounts(categoryCounts, textBreakdown.categoryCounts);
    return {
      weight: 1 + imageWeight + deferredImageWeight + textBreakdown.weight,
      categoryCounts,
    };
  }
  if (item.kind === "generatedImage") {
    const imageWeight = item.images.reduce((total, image) => {
      const inlineDataWeight = image.src.toLowerCase().startsWith("data:image/")
        ? Math.min(160, Math.ceil(image.src.length / 32_768))
        : 0;
      return total + 28 + inlineDataWeight;
    }, 0);
    incrementCategory(categoryCounts, "generatedImage", item.images.length || 1);
    return { weight: 24 + imageWeight, categoryCounts };
  }
  if (item.kind === "reasoning") {
    const weight = Math.min(18, Math.floor((item.summary.length + item.content.length) / 2_000));
    incrementCategory(categoryCounts, "reasoning", weight);
    return { weight: 1 + weight, categoryCounts };
  }
  if (item.kind === "tool") {
    const outputLength = item.output?.length ?? 0;
    const changeCount = item.changes?.length ?? 0;
    const changeDiffLength =
      item.changes?.reduce((total, change) => total + (change.diff?.length ?? 0), 0) ?? 0;
    const outputWeight = Math.min(32, Math.floor(outputLength / 1_500));
    const changeWeight = Math.min(32, changeCount * 4 + Math.floor(changeDiffLength / 1_500));
    const rawPayloadCount = countRegexMatches(
      `${item.title}\n${item.detail}\n${item.output ?? ""}`,
      /<(?:function_calls?|invoke|tool_call|tool_result|tool_use)\b/gi,
      12,
    );
    const rawPayloadWeight = Math.min(36, rawPayloadCount * 12);
    incrementCategory(categoryCounts, "toolOutput", outputWeight);
    incrementCategory(categoryCounts, "diff", changeCount);
    incrementCategory(categoryCounts, "toolRawPayload", rawPayloadCount);
    return {
      weight: 1 + outputWeight + changeWeight + rawPayloadWeight,
      categoryCounts,
    };
  }
  if (item.kind === "diff" || item.kind === "review") {
    const textLength = item.kind === "diff" ? item.diff.length : item.text.length;
    const diffMarkerCount =
      item.kind === "diff"
        ? countRegexMatches(item.diff, /(^|\n)(diff --git|@@|\+\+\+ |--- )/g, 80)
        : 0;
    const weight = Math.min(40, Math.floor(textLength / 1_500) + diffMarkerCount * 2);
    incrementCategory(categoryCounts, item.kind === "diff" ? "diff" : "review", weight);
    return { weight: 1 + weight, categoryCounts };
  }
  return { weight: 1, categoryCounts };
}

export function estimateTimelineProjectionRenderWeight(row: TimelineProjectionRow) {
  return summarizeTimelineProjectionRowRenderWeight(row).renderWeight;
}

function summarizeTimelineProjectionRowRenderWeight(row: TimelineProjectionRow) {
  if (row.kind !== "entry") {
    return {
      renderWeight: row.kind === "bottomAnchor" ? 0 : 1,
      categoryCounts: {} satisfies TimelineRenderWeightCategoryCounts,
    };
  }
  const categoryCounts: TimelineRenderWeightCategoryCounts = {};
  let renderWeight = 0;
  if (row.entry.kind === "item") {
    const breakdown = estimateConversationItemRenderWeight(row.entry.item);
    renderWeight += breakdown.weight;
    mergeCategoryCounts(categoryCounts, breakdown.categoryCounts);
  } else {
    if (row.entry.kind === "readGroup") {
      const readBatchWeight = Math.min(48, row.entry.items.length * 6);
      renderWeight += readBatchWeight;
      incrementCategory(categoryCounts, "readBatch", row.entry.items.length);
    }
    for (const item of row.entry.items) {
      const breakdown = estimateConversationItemRenderWeight(item);
      renderWeight += breakdown.weight;
      mergeCategoryCounts(categoryCounts, breakdown.categoryCounts);
    }
  }
  if (row.hasActiveUserInputAnchor) {
    renderWeight += 8;
    incrementCategory(categoryCounts, "anchorOutlinePressure", 1);
  }
  return { renderWeight, categoryCounts };
}

export function summarizeTimelineProjectionRenderWeight(
  rows: readonly TimelineProjectionRow[],
): TimelineRenderWeightSummary {
  const categoryCounts: TimelineRenderWeightCategoryCounts = {};
  let renderWeight = 0;
  let heavyRowCount = 0;
  for (const row of rows) {
    const rowSummary = summarizeTimelineProjectionRowRenderWeight(row);
    renderWeight += rowSummary.renderWeight;
    if (rowSummary.renderWeight >= TIMELINE_VIRTUALIZATION_HEAVY_ROW_WEIGHT) {
      heavyRowCount += 1;
    }
    mergeCategoryCounts(categoryCounts, rowSummary.categoryCounts);
  }
  return {
    rowCount: rows.length,
    renderWeight,
    heavyRowCount,
    categoryCounts,
  };
}

export function getTimelineVirtualizationThresholdReason(input: {
  rowCount: number;
  renderWeight: number;
}) {
  void input;
  return "disabled" as const;
}

export function buildTimelineRenderWeightDiagnosticPayload(input: {
  summary: TimelineRenderWeightSummary;
  shouldVirtualize: boolean;
  hydratedHeavyRowCount?: number | null;
  localErrorState?: "none" | "contained" | "blocked" | "unknown";
  threadId?: string | null;
  workspaceId?: string | null;
}) {
  const thresholdReason = getTimelineVirtualizationThresholdReason({
    rowCount: input.summary.rowCount,
    renderWeight: input.summary.renderWeight,
  });
  return {
    threadId: input.threadId ?? null,
    workspaceId: input.workspaceId ?? null,
    rowCount: input.summary.rowCount,
    renderWeight: input.summary.renderWeight,
    heavyRowCount: input.summary.heavyRowCount,
    hydratedHeavyRowCount: input.hydratedHeavyRowCount ?? null,
    localErrorState: input.localErrorState ?? "unknown",
    categoryCounts: input.summary.categoryCounts,
    shouldVirtualize: input.shouldVirtualize,
    thresholdReason,
  };
}

export function getActiveLiveTimelineRowKeys(input: {
  rows: readonly TimelineProjectionRow[];
  liveAssistantItemId?: string | null;
  liveReasoningItemId?: string | null;
}) {
  const liveItemIds = new Set(
    [input.liveAssistantItemId, input.liveReasoningItemId].filter(
      (itemId): itemId is string => typeof itemId === "string" && itemId.length > 0,
    ),
  );
  if (liveItemIds.size === 0) {
    return [];
  }
  return input.rows
    .filter((row) => {
      if (row.kind === "entry") {
        return row.itemIds.some((itemId) => liveItemIds.has(itemId));
      }
      if (row.kind === "dockedReasoning") {
        return liveItemIds.has(row.itemId);
      }
      return false;
    })
    .map((row) => row.key);
}
