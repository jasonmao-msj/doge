import { parseAgentTaskNotification } from "@/contracts/agentTaskNotification";
import type { GroupedEntry } from "../../utils/groupToolItems";

export type TimelineProjectionRow =
  | {
      kind: "entry";
      key: string;
      entry: GroupedEntry;
      itemIds: readonly string[];
      hasActiveUserInputAnchor: boolean;
      /** Soft-collapsed causal process phase (animates open/closed in place). */
      processPhaseCollapsed?: boolean;
      processPhaseKey?: string | null;
      processPhaseRevealIndex?: number;
    }
  | {
      kind: "dockedReasoning";
      key: string;
      itemId: string;
    }
  | {
      kind: "tailUserInput";
      key: string;
    }
  | {
      kind: "liveMiddleCollapsed";
      key: string;
      phaseKey: string;
      count: number;
      expanded: boolean;
      durationMs: number | null;
      breakdown: {
        reasoningCount: number;
        toolCount: number;
        exploreCount: number;
      };
      /** Insert drawer header immediately before this process item. */
      insertBeforeItemId: string;
    }
  | {
      kind: "workingIndicator";
      key: string;
    }
  | {
      kind: "emptyState";
      key: string;
      state: "historyLoading" | "hiddenReasoning" | "empty";
    }
  | {
      kind: "historyRecoveryFailure";
      key: string;
    }
  | {
      kind: "approval";
      key: string;
    }
  | {
      kind: "bottomAnchor";
      key: string;
    };

export function getGroupedEntryItemIds(entry: GroupedEntry): string[] {
  if (entry.kind === "item") {
    return [entry.item.id];
  }
  return entry.items.map((item) => item.id);
}

export function groupedEntryContainsItemId(entry: GroupedEntry, itemId: string): boolean {
  return getGroupedEntryItemIds(entry).includes(itemId);
}

export function findTimelineProjectionRowIndexByItemId(
  rows: readonly TimelineProjectionRow[],
  itemId: string,
) {
  if (!itemId) {
    return -1;
  }
  return rows.findIndex((row) => row.kind === "entry" && row.itemIds.includes(itemId));
}

export function getGroupedEntryProjectionKey(entry: GroupedEntry): string {
  if (entry.kind === "item") {
    const task = entry.item.kind === "message" ? parseAgentTaskNotification(entry.item.text) : null;
    return `${entry.kind}:${entry.item.kind}:${entry.item.id}:${task?.taskId ?? task?.toolUseId ?? ""}`;
  }
  const firstId = entry.items[0]?.id ?? "empty";
  // editGroup：仅用 firstId 锚定投影 identity。
  // streaming 时文件数增长若写入 lastId/length，会 remount 并丢掉用户展开态。
  if (entry.kind === "editGroup") {
    return `${entry.kind}:${firstId}`;
  }
  const lastId = entry.items.at(-1)?.id ?? firstId;
  return `${entry.kind}:${firstId}:${lastId}:${entry.items.length}`;
}

export type TimelineProcessPhaseChip = {
  phaseKey: string;
  count: number;
  expanded: boolean;
  durationMs: number | null;
  breakdown: {
    reasoningCount: number;
    toolCount: number;
    exploreCount: number;
  };
  /** First process item of the phase (present only when expanded / remounted). */
  insertBeforeItemId: string;
  /** Assistant prose this phase produced — used to place header when collapsed. */
  assistantItemId: string;
  hiddenItemIds: readonly string[];
};

export function buildTimelineProjectionRows(input: {
  activeUserInputAnchorItemId: string | null;
  approvalVisible: boolean;
  claudeDockedReasoningItemIds: readonly string[];
  effectiveItemsCount: number;
  groupedEntries: readonly GroupedEntry[];
  hasVisibleUserInputRequest: boolean;
  hiddenClaudeReasoningOnly: boolean;
  historyRecoveryFailureVisible: boolean;
  isHistoryLoading: boolean;
  isThinking: boolean;
  processPhaseChips?: readonly TimelineProcessPhaseChip[];
  shouldRenderUserInputAtTail: boolean;
}): TimelineProjectionRow[] {
  const phaseByFirstItemId = new Map<string, TimelineProcessPhaseChip>();
  const phaseByAssistantId = new Map<string, TimelineProcessPhaseChip>();
  /** Process rows only exist when expanded — tag them for remount fade-in. */
  const expandedProcessMeta = new Map<
    string,
    { phaseKey: string; revealIndex: number }
  >();
  for (const phase of input.processPhaseChips ?? []) {
    // count >= 1 is intentional: single-step thinking also renders as a chip.
    if (phase.count < 1) {
      continue;
    }
    if (phase.expanded) {
      phaseByFirstItemId.set(phase.insertBeforeItemId, phase);
      phase.hiddenItemIds.forEach((itemId, revealIndex) => {
        expandedProcessMeta.set(itemId, {
          phaseKey: phase.phaseKey,
          revealIndex,
        });
      });
    } else {
      // Collapsed: process rows are hard-unmounted; park the header above prose.
      phaseByAssistantId.set(phase.assistantItemId, phase);
    }
  }
  const insertedPhaseKeys = new Set<string>();

  const rows: TimelineProjectionRow[] = [];

  const pushPhaseHeader = (phase: TimelineProcessPhaseChip) => {
    if (insertedPhaseKeys.has(phase.phaseKey)) {
      return;
    }
    rows.push({
      kind: "liveMiddleCollapsed",
      key: `process-phase:${phase.phaseKey}`,
      phaseKey: phase.phaseKey,
      count: phase.count,
      expanded: phase.expanded,
      durationMs: phase.durationMs,
      breakdown: phase.breakdown,
      insertBeforeItemId: phase.insertBeforeItemId,
    });
    insertedPhaseKeys.add(phase.phaseKey);
  };

  for (const entry of input.groupedEntries) {
    const entryItemIds = getGroupedEntryItemIds(entry);

    // Expanded: header before first process row (drawer top).
    for (const itemId of entryItemIds) {
      const phase = phaseByFirstItemId.get(itemId);
      if (phase) {
        pushPhaseHeader(phase);
        break;
      }
    }
    // Collapsed: header before assistant prose (process body unmounted).
    if (
      entry.kind === "item" &&
      entry.item.kind === "message" &&
      entry.item.role === "assistant"
    ) {
      const phase = phaseByAssistantId.get(entry.item.id);
      if (phase) {
        pushPhaseHeader(phase);
      }
    }

    const revealMeta = entryItemIds
      .map((itemId) => expandedProcessMeta.get(itemId))
      .find((meta) => meta != null);
    rows.push({
      kind: "entry",
      key: getGroupedEntryProjectionKey(entry),
      entry,
      itemIds: entryItemIds,
      hasActiveUserInputAnchor: Boolean(
        input.activeUserInputAnchorItemId &&
          groupedEntryContainsItemId(entry, input.activeUserInputAnchorItemId),
      ),
      // Hard-unmounted when collapsed — mounted process rows are always expanded.
      processPhaseCollapsed: false,
      processPhaseKey: revealMeta?.phaseKey ?? null,
      processPhaseRevealIndex: revealMeta?.revealIndex,
    });
  }

  for (const itemId of input.claudeDockedReasoningItemIds) {
    rows.push({
      kind: "dockedReasoning",
      key: `claude-live:${itemId}`,
      itemId,
    });
  }

  if (input.shouldRenderUserInputAtTail) {
    rows.push({ kind: "tailUserInput", key: "user-input-tail" });
  }

  // Fallback for phases whose anchor entry is outside the current window.
  for (const phase of input.processPhaseChips ?? []) {
    if (phase.count >= 1 && !insertedPhaseKeys.has(phase.phaseKey)) {
      pushPhaseHeader(phase);
    }
  }

  rows.push({ kind: "workingIndicator", key: "working-indicator" });

  if (input.historyRecoveryFailureVisible) {
    rows.push({
      kind: "historyRecoveryFailure",
      key: "history-recovery-failure",
    });
  }

  if (
    !input.historyRecoveryFailureVisible &&
    !input.effectiveItemsCount &&
    !input.hasVisibleUserInputRequest
  ) {
    rows.push({
      kind: "emptyState",
      key: "empty-state",
      state: input.isHistoryLoading
        ? "historyLoading"
        : input.hiddenClaudeReasoningOnly
          ? "hiddenReasoning"
          : "empty",
    });
  }

  if (input.approvalVisible) {
    rows.push({ kind: "approval", key: "approval" });
  }

  rows.push({ kind: "bottomAnchor", key: "bottom-anchor" });
  return rows;
}
