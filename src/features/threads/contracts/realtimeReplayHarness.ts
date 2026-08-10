import { createHash } from "node:crypto";
import type { ConversationItem } from "../../../types";
import type { ThreadAction, ThreadState } from "../hooks/useThreadsReducer";
import { __resetRealtimePerfFlagCacheForTests } from "../utils/realtimePerfFlags";
import { inferEngineFromLegacyThreadId as inferEngineFromThreadId } from "./engineRuntimeIdentity";
import type { ReplayProfile, RealtimeReplayEvent } from "./realtimeReplayTypes";

const ABSOLUTE_EPOCH_MS = 1_710_000_000_000;
const FRAME_BUCKET_MS = 16;
const FLAG_PREFIX = "doge.perf.";
const PROFILE_FLAG_VALUES: Record<
  ReplayProfile,
  Record<"realtimeBatching" | "reducerNoopGuard" | "incrementalDerivation" | "debugLightPath", string>
> = {
  baseline: {
    realtimeBatching: "0",
    reducerNoopGuard: "0",
    incrementalDerivation: "0",
    debugLightPath: "0",
  },
  optimized: {
    realtimeBatching: "1",
    reducerNoopGuard: "1",
    incrementalDerivation: "1",
    debugLightPath: "1",
  },
};

type ReducerModule = {
  initialState: ThreadState;
  threadReducer: (state: ThreadState, action: ThreadAction) => ThreadState;
};

export type TimedThreadAction = {
  atMs: number;
  sourceEventId: string;
  action: ThreadAction;
};

export type ReplayIntegrityResult = {
  missingAgentMessages: string[];
  missingReasoningItems: string[];
  missingToolOutputs: string[];
  stuckProcessingThreads: string[];
};

export type ReplaySemanticsSnapshot = {
  threads: Array<{
    threadId: string;
    isProcessing: boolean;
    items: Array<Record<string, unknown>>;
  }>;
};

export type ReplayMetrics = {
  totalEvents: number;
  totalActions: number;
  wallTimeMs: number;
  cpuTimeMs: number;
  p95ActionMs: number;
  maxActionMs: number;
  averageActionsPerFrame: number;
  peakActionsPerFrame: number;
};

export type ReplayRunResult = {
  profile: ReplayProfile;
  metrics: ReplayMetrics;
  actionPlan: TimedThreadAction[];
  semanticsSnapshot: ReplaySemanticsSnapshot;
  semanticsHash: string;
  integrity: ReplayIntegrityResult;
};

type LocalStorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
  key: (index: number) => string | null;
  readonly length: number;
};

function createMemoryLocalStorage(seed: Record<string, string> = {}): LocalStorageLike {
  const backingStore = new Map<string, string>(Object.entries(seed));
  return {
    get length() {
      return backingStore.size;
    },
    getItem(key: string) {
      return backingStore.has(key) ? backingStore.get(key) ?? null : null;
    },
    setItem(key: string, value: string) {
      backingStore.set(key, String(value));
    },
    removeItem(key: string) {
      backingStore.delete(key);
    },
    clear() {
      backingStore.clear();
    },
    key(index: number) {
      const keys = Array.from(backingStore.keys());
      return keys[index] ?? null;
    },
  };
}

async function withProfileFlags<T>(profile: ReplayProfile, runner: () => Promise<T>): Promise<T> {
  const globalWithWindow = globalThis as unknown as {
    window?: { localStorage?: LocalStorageLike };
  };
  const hadWindow = Boolean(globalWithWindow.window);
  const targetWindow = globalWithWindow.window ?? {};
  const localStorage = targetWindow.localStorage ?? createMemoryLocalStorage();
  targetWindow.localStorage = localStorage;
  globalWithWindow.window = targetWindow;

  const previousByKey = new Map<string, string | null>();
  for (const [flagKey, flagValue] of Object.entries(PROFILE_FLAG_VALUES[profile])) {
    const storageKey = `${FLAG_PREFIX}${flagKey}`;
    previousByKey.set(storageKey, localStorage.getItem(storageKey));
    localStorage.setItem(storageKey, flagValue);
  }
  __resetRealtimePerfFlagCacheForTests();

  try {
    return await runner();
  } finally {
    for (const [storageKey, previousValue] of previousByKey.entries()) {
      if (previousValue == null) {
        localStorage.removeItem(storageKey);
      } else {
        localStorage.setItem(storageKey, previousValue);
      }
    }
    __resetRealtimePerfFlagCacheForTests();
    if (!hadWindow) {
      globalWithWindow.window = undefined;
    }
  }
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? 0;
}

function resolveAbsoluteTimestamp(atMs: number) {
  return ABSOLUTE_EPOCH_MS + Math.max(0, Math.trunc(atMs));
}

function isDeltaEvent(
  event: RealtimeReplayEvent,
): event is Extract<
  RealtimeReplayEvent,
  { kind: "agentDelta" | "reasoningSummaryDelta" | "reasoningContentDelta" | "toolOutputDelta" }
> {
  return (
    event.kind === "agentDelta"
    || event.kind === "reasoningSummaryDelta"
    || event.kind === "reasoningContentDelta"
    || event.kind === "toolOutputDelta"
  );
}

function appendEnsureThread(actions: TimedThreadAction[], event: RealtimeReplayEvent) {
  actions.push({
    atMs: event.atMs,
    sourceEventId: event.id,
    action: {
      type: "ensureThread",
      workspaceId: event.workspaceId,
      threadId: event.threadId,
      engine: inferEngineFromThreadId(event.threadId),
    },
  });
}

function appendMarkProcessing(
  actions: TimedThreadAction[],
  event: RealtimeReplayEvent,
  isProcessing: boolean,
) {
  actions.push({
    atMs: event.atMs,
    sourceEventId: event.id,
    action: {
      type: "markProcessing",
      threadId: event.threadId,
      isProcessing,
      timestamp: resolveAbsoluteTimestamp(event.atMs),
    },
  });
}

function appendDeltaAction(actions: TimedThreadAction[], event: Extract<RealtimeReplayEvent, { kind: string }>) {
  if (event.kind === "agentDelta") {
    actions.push({
      atMs: event.atMs,
      sourceEventId: event.id,
      action: {
        type: "appendAgentDelta",
        workspaceId: event.workspaceId,
        threadId: event.threadId,
        itemId: event.itemId,
        delta: event.delta,
        hasCustomName: false,
      },
    });
    return;
  }
  if (event.kind === "reasoningSummaryDelta") {
    actions.push({
      atMs: event.atMs,
      sourceEventId: event.id,
      action: {
        type: "appendReasoningSummary",
        threadId: event.threadId,
        itemId: event.itemId,
        delta: event.delta,
      },
    });
    return;
  }
  if (event.kind === "reasoningContentDelta") {
    actions.push({
      atMs: event.atMs,
      sourceEventId: event.id,
      action: {
        type: "appendReasoningContent",
        threadId: event.threadId,
        itemId: event.itemId,
        delta: event.delta,
      },
    });
    return;
  }
  if (event.kind === "toolOutputDelta") {
    actions.push({
      atMs: event.atMs,
      sourceEventId: event.id,
      action: {
        type: "appendToolOutput",
        threadId: event.threadId,
        itemId: event.itemId,
        delta: event.delta,
      },
    });
  }
}

function appendNonDeltaActions(actions: TimedThreadAction[], event: RealtimeReplayEvent) {
  appendEnsureThread(actions, event);
  if (event.kind === "toolStarted") {
    appendMarkProcessing(actions, event, true);
    const toolItem: ConversationItem = {
      id: event.itemId,
      kind: "tool",
      toolType: "commandExecution",
      title: `Command: ${event.command}`,
      detail: JSON.stringify({ command: event.command }),
      status: "running",
      output: "",
    };
    actions.push({
      atMs: event.atMs,
      sourceEventId: event.id,
      action: {
        type: "upsertItem",
        workspaceId: event.workspaceId,
        threadId: event.threadId,
        item: toolItem,
        hasCustomName: false,
      },
    });
    return;
  }
  if (event.kind === "agentCompleted") {
    actions.push({
      atMs: event.atMs,
      sourceEventId: event.id,
      action: {
        type: "completeAgentMessage",
        workspaceId: event.workspaceId,
        threadId: event.threadId,
        itemId: event.itemId,
        text: event.text,
        hasCustomName: false,
      },
    });
    appendMarkProcessing(actions, event, false);
    actions.push({
      atMs: event.atMs,
      sourceEventId: event.id,
      action: {
        type: "setThreadTimestamp",
        workspaceId: event.workspaceId,
        threadId: event.threadId,
        timestamp: resolveAbsoluteTimestamp(event.atMs),
      },
    });
  }
}

function flushDeltaBuffer(buffered: RealtimeReplayEvent[], actions: TimedThreadAction[]) {
  if (buffered.length === 0) {
    return;
  }
  const ensuredThreads = new Set<string>();
  const processingThreads = new Set<string>();
  for (const event of buffered) {
    if (!ensuredThreads.has(event.threadId)) {
      appendEnsureThread(actions, event);
      ensuredThreads.add(event.threadId);
    }
    if (!processingThreads.has(event.threadId)) {
      appendMarkProcessing(actions, event, true);
      processingThreads.add(event.threadId);
    }
    appendDeltaAction(actions, event);
  }
}

export function expandReplayEventsToActions(
  events: RealtimeReplayEvent[],
  profile: ReplayProfile,
  batchWindowMs: number,
): TimedThreadAction[] {
  const orderedEvents = events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => {
      if (left.event.atMs !== right.event.atMs) {
        return left.event.atMs - right.event.atMs;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.event);

  const actions: TimedThreadAction[] = [];
  if (profile === "baseline") {
    for (const event of orderedEvents) {
      if (isDeltaEvent(event)) {
        appendEnsureThread(actions, event);
        appendMarkProcessing(actions, event, true);
        appendDeltaAction(actions, event);
        continue;
      }
      appendNonDeltaActions(actions, event);
    }
    return actions;
  }

  const deltaBuffer: RealtimeReplayEvent[] = [];
  let bufferStartAtMs = -1;
  const flush = () => {
    flushDeltaBuffer(deltaBuffer, actions);
    deltaBuffer.length = 0;
    bufferStartAtMs = -1;
  };

  for (const event of orderedEvents) {
    if (!isDeltaEvent(event)) {
      flush();
      appendNonDeltaActions(actions, event);
      continue;
    }
    if (deltaBuffer.length === 0) {
      deltaBuffer.push(event);
      bufferStartAtMs = event.atMs;
      continue;
    }
    if (event.atMs - bufferStartAtMs <= batchWindowMs) {
      deltaBuffer.push(event);
      continue;
    }
    flush();
    deltaBuffer.push(event);
    bufferStartAtMs = event.atMs;
  }

  flush();
  return actions;
}

function summarizeItem(item: ConversationItem): Record<string, unknown> {
  if (item.kind === "message") {
    return {
      id: item.id,
      kind: item.kind,
      role: item.role,
      text: item.text,
    };
  }
  if (item.kind === "reasoning") {
    return {
      id: item.id,
      kind: item.kind,
      summary: item.summary,
      content: item.content,
    };
  }
  if (item.kind === "tool") {
    return {
      id: item.id,
      kind: item.kind,
      toolType: item.toolType,
      status: item.status ?? "",
      title: item.title,
      output: item.output ?? "",
    };
  }
  if (item.kind === "explore") {
    return {
      id: item.id,
      kind: item.kind,
      status: item.status ?? "",
      entries: item.entries?.length ?? 0,
    };
  }
  return {
    id: item.id,
    kind: item.kind,
  };
}

export function createSemanticsSnapshot(state: ThreadState): ReplaySemanticsSnapshot {
  const threadIds = Array.from(
    new Set([
      ...Object.keys(state.itemsByThread),
      ...Object.keys(state.threadStatusById),
    ]),
  ).sort();

  return {
    threads: threadIds.map((threadId) => ({
      threadId,
      isProcessing: Boolean(state.threadStatusById[threadId]?.isProcessing),
      items: (state.itemsByThread[threadId] ?? []).map((item) => summarizeItem(item)),
    })),
  };
}

function createSemanticsHash(snapshot: ReplaySemanticsSnapshot): string {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

function summarizeFrameBuckets(actions: TimedThreadAction[]) {
  const bucketCounts = new Map<number, number>();
  for (const timedAction of actions) {
    const bucket = Math.floor(timedAction.atMs / FRAME_BUCKET_MS);
    bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1);
  }
  const counts = Array.from(bucketCounts.values());
  if (counts.length === 0) {
    return {
      averageActionsPerFrame: 0,
      peakActionsPerFrame: 0,
    };
  }
  const total = counts.reduce((sum, value) => sum + value, 0);
  return {
    averageActionsPerFrame: total / counts.length,
    peakActionsPerFrame: Math.max(...counts),
  };
}

function findItemByKindAndId(
  state: ThreadState,
  threadId: string,
  kind: ConversationItem["kind"],
  itemId: string,
) {
  const list = state.itemsByThread[threadId] ?? [];
  return list.find((item) => item.kind === kind && item.id === itemId) ?? null;
}

function normalizeComparableText(value: string): string {
  return value.replace(/\s+/g, "").trim();
}

export function validateReplayIntegrity(
  events: RealtimeReplayEvent[],
  state: ThreadState,
): ReplayIntegrityResult {
  const toCompositeKey = (threadId: string, itemId: string) => `${threadId}::${itemId}`;
  const fromCompositeKey = (value: string) => {
    const separatorIndex = value.lastIndexOf("::");
    if (separatorIndex < 0) {
      return { threadId: value, itemId: value };
    }
    return {
      threadId: value.slice(0, separatorIndex),
      itemId: value.slice(separatorIndex + 2),
    };
  };

  const expectedAgentTexts = new Map<string, string>();
  const expectedReasoningContents = new Map<string, string[]>();
  const expectedToolOutputs = new Map<string, string>();
  const completedThreadIds = new Set<string>();

  for (const event of events) {
    const key = toCompositeKey(event.threadId, event.itemId);
    if (event.kind === "agentCompleted") {
      expectedAgentTexts.set(key, event.text);
      completedThreadIds.add(event.threadId);
      continue;
    }
    if (event.kind === "reasoningContentDelta") {
      const previous = expectedReasoningContents.get(key) ?? [];
      previous.push(event.delta);
      expectedReasoningContents.set(key, previous);
      continue;
    }
    if (event.kind === "toolOutputDelta") {
      expectedToolOutputs.set(key, (expectedToolOutputs.get(key) ?? "") + event.delta);
    }
  }

  const missingAgentMessages: string[] = [];
  for (const [key, expectedText] of expectedAgentTexts.entries()) {
    const { threadId, itemId } = fromCompositeKey(key);
    const item = findItemByKindAndId(state, threadId, "message", itemId);
    if (!item || (item.kind === "message" && item.text !== expectedText)) {
      missingAgentMessages.push(key);
    }
  }

  const missingReasoningItems: string[] = [];
  for (const [key, expectedDeltas] of expectedReasoningContents.entries()) {
    const { threadId, itemId } = fromCompositeKey(key);
    const item = findItemByKindAndId(state, threadId, "reasoning", itemId);
    if (!item || item.kind !== "reasoning") {
      missingReasoningItems.push(key);
      continue;
    }
    const content = normalizeComparableText(item.content);
    const hasMissingFragment = expectedDeltas.some((delta) => {
      const normalizedDelta = normalizeComparableText(delta);
      if (!normalizedDelta) {
        return false;
      }
      return !content.includes(normalizedDelta);
    });
    if (hasMissingFragment) {
      missingReasoningItems.push(key);
    }
  }

  const missingToolOutputs: string[] = [];
  for (const [key, expectedOutput] of expectedToolOutputs.entries()) {
    const { threadId, itemId } = fromCompositeKey(key);
    const item = findItemByKindAndId(state, threadId, "tool", itemId);
    if (!item || (item.kind === "tool" && (item.output ?? "") !== expectedOutput)) {
      missingToolOutputs.push(key);
    }
  }

  const stuckProcessingThreads = Array.from(completedThreadIds).filter((threadId) =>
    Boolean(state.threadStatusById[threadId]?.isProcessing),
  );

  return {
    missingAgentMessages,
    missingReasoningItems,
    missingToolOutputs,
    stuckProcessingThreads,
  };
}

async function loadReducerModule(_profile: ReplayProfile): Promise<ReducerModule> {
  const module = (await import("../hooks/useThreadsReducer")) as {
    initialState: ThreadState;
    threadReducer: (state: ThreadState, action: ThreadAction) => ThreadState;
  };
  return {
    initialState: module.initialState,
    threadReducer: module.threadReducer,
  };
}

export async function runReplayProfile(input: {
  events: RealtimeReplayEvent[];
  profile: ReplayProfile;
  batchWindowMs: number;
}): Promise<ReplayRunResult> {
  const { events, profile, batchWindowMs } = input;
  return withProfileFlags(profile, async () => {
    const actionPlan = expandReplayEventsToActions(events, profile, batchWindowMs);
    const { initialState, threadReducer } = await loadReducerModule(profile);

    let state = initialState;
    const actionDurations: number[] = [];
    const wallStartedAt = typeof performance === "undefined" ? Date.now() : performance.now();
    const cpuStartedAt = typeof process !== "undefined" && typeof process.cpuUsage === "function"
      ? process.cpuUsage()
      : null;

    for (const timedAction of actionPlan) {
      const actionStartedAt = typeof performance === "undefined" ? Date.now() : performance.now();
      state = threadReducer(state, timedAction.action);
      const actionEndedAt = typeof performance === "undefined" ? Date.now() : performance.now();
      actionDurations.push(actionEndedAt - actionStartedAt);
    }

    const wallEndedAt = typeof performance === "undefined" ? Date.now() : performance.now();
    const cpuElapsed = cpuStartedAt && typeof process !== "undefined" && typeof process.cpuUsage === "function"
      ? process.cpuUsage(cpuStartedAt)
      : null;
    const cpuTimeMs = cpuElapsed
      ? (cpuElapsed.user + cpuElapsed.system) / 1000
      : wallEndedAt - wallStartedAt;

    const { averageActionsPerFrame, peakActionsPerFrame } = summarizeFrameBuckets(actionPlan);
    const semanticsSnapshot = createSemanticsSnapshot(state);
    const integrity = validateReplayIntegrity(events, state);

    return {
      profile,
      actionPlan,
      semanticsSnapshot,
      semanticsHash: createSemanticsHash(semanticsSnapshot),
      integrity,
      metrics: {
        totalEvents: events.length,
        totalActions: actionPlan.length,
        wallTimeMs: wallEndedAt - wallStartedAt,
        cpuTimeMs,
        p95ActionMs: percentile(actionDurations, 0.95),
        maxActionMs: actionDurations.length === 0 ? 0 : Math.max(...actionDurations),
        averageActionsPerFrame,
        peakActionsPerFrame,
      },
    };
  });
}
