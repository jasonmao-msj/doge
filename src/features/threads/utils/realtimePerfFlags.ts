import {
  RENDER_SCHEDULE_TIER_DEFAULT,
  RENDER_TIER_FLAG_KEY,
  isRenderScheduleTier,
  type RenderScheduleTier,
} from "./renderSchedulingPolicy";

const FLAG_PREFIX = "doge.perf.";
const REALTIME_PERF_FLAG_IDS = [
  "realtimeBatching",
  "appServerEventBatch",
  "reducerNoopGuard",
  "incrementalDerivation",
  "backgroundRenderGating",
  "backgroundBufferedFlush",
  "stagedHydration",
  "debugLightPath",
  "liveTextExternalization",
] as const;

export type RealtimePerfFlagId = (typeof REALTIME_PERF_FLAG_IDS)[number];

export type ActiveRealtimePerfFlag = {
  value: boolean;
  source: "localStorage" | "default";
  storageKey: string;
  defaultValue: boolean;
  testDefaultValue: boolean;
  metric: string;
};

type RealtimePerfFlagDefinition = {
  id: RealtimePerfFlagId;
  defaultValue: boolean;
  testDefaultValue: boolean;
  metric: string;
};

const PERF_FLAG_DEFINITIONS: readonly RealtimePerfFlagDefinition[] = [
  {
    id: "realtimeBatching",
    defaultValue: true,
    testDefaultValue: false,
    metric: "realtime event dispatch batch size and reducer dispatch rate",
  },
  {
    id: "appServerEventBatch",
    defaultValue: true,
    testDefaultValue: false,
    metric: "app-server-event-batch consumer path",
  },
  {
    id: "reducerNoopGuard",
    defaultValue: true,
    testDefaultValue: true,
    metric: "useThreadsReducer no-op state preservation",
  },
  {
    id: "incrementalDerivation",
    defaultValue: true,
    testDefaultValue: true,
    metric: "thread/workspace incremental derived state rebuilds",
  },
  {
    id: "backgroundRenderGating",
    defaultValue: true,
    testDefaultValue: true,
    metric: "background thread render gating",
  },
  {
    id: "backgroundBufferedFlush",
    defaultValue: true,
    testDefaultValue: true,
    metric: "background realtime buffered flush cadence",
  },
  {
    id: "stagedHydration",
    defaultValue: true,
    testDefaultValue: true,
    metric: "staged thread hydration work",
  },
  {
    id: "debugLightPath",
    defaultValue: true,
    testDefaultValue: true,
    metric: "debug/diagnostic light-path gating",
  },
  {
    // A4 流式正文外部化（docs/perf/a4-live-text-externalization-plan.md）：
    // 流式正文 delta 只写 liveAssistantTextChannel（订阅行小树渲染），不再
    // 逐条 dispatch 进根 reducer。2026-07-08 人工验收「卡顿大幅优化」后默认
    // 开启；异常时 localStorage 置 doge.perf.liveTextExternalization=0 回退。
    id: "liveTextExternalization",
    defaultValue: true,
    testDefaultValue: false,
    metric: "streaming agent-text delta root-render bypass",
  },
];

function storageKeyForFlag(key: string) {
  return `${FLAG_PREFIX}${key}`;
}

const isTestMode = (() => {
  try {
    return import.meta.env.MODE === "test";
  } catch {
    return false;
  }
})();

const cachedFlags: Record<string, boolean> = {};

function parseBooleanFlag(raw: string | null): boolean | null {
  if (raw == null) {
    return null;
  }
  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "1" || normalized === "true" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "off") {
    return false;
  }
  return null;
}

function readRealtimePerfFlag(
  key: string,
  defaultValue: boolean,
  testDefaultValue = defaultValue,
): boolean {
  const fallbackValue = isTestMode ? testDefaultValue : defaultValue;

  if (!isTestMode && key in cachedFlags) {
    return cachedFlags[key] ?? fallbackValue;
  }

  let resolved = fallbackValue;
  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem(storageKeyForFlag(key));
      const parsed = parseBooleanFlag(stored);
      if (parsed !== null) {
        resolved = parsed;
      }
    } catch {
      // Ignore storage read errors and keep fallback.
    }
  }

  if (!isTestMode) {
    cachedFlags[key] = resolved;
  }
  return resolved;
}

export function isRealtimeBatchingEnabled(): boolean {
  // Keep existing tests deterministic by default; runtime remains enabled by default.
  return readRealtimePerfFlagById("realtimeBatching");
}

export function isAppServerEventBatchConsumerEnabled(): boolean {
  // Webview-side gate for the `app-server-event-batch` channel exposed by
  // `services/events.ts`. The Rust side also gates the channel via
  // `CCGUI_APP_SERVER_EVENT_BATCH`; the webview side falls back to single
  // `app-server-event` channel when this flag is off. localStorage is the
  // correct source for this knob per spec
  // `app-server-event-batching` §"Backend Runtime Config Source" (frontend
  // localStorage controls webview behavior; backend batch toggle is its
  // own env var).
  return readRealtimePerfFlagById("appServerEventBatch");
}

export function isReducerNoopGuardEnabled(): boolean {
  return readRealtimePerfFlagById("reducerNoopGuard");
}

export function isLiveTextExternalizationEnabled(): boolean {
  return readRealtimePerfFlagById("liveTextExternalization");
}

export function isIncrementalDerivationEnabled(): boolean {
  return readRealtimePerfFlagById("incrementalDerivation");
}

export function isDebugLightPathEnabled(): boolean {
  return readRealtimePerfFlagById("debugLightPath");
}

export function isBackgroundRenderGatingEnabled(): boolean {
  return readRealtimePerfFlagById("backgroundRenderGating");
}

export function isBackgroundBufferedFlushEnabled(): boolean {
  return readRealtimePerfFlagById("backgroundBufferedFlush");
}

export function isStagedHydrationEnabled(): boolean {
  return readRealtimePerfFlagById("stagedHydration");
}

function getRealtimePerfFlagDefinition(id: RealtimePerfFlagId) {
  const definition = PERF_FLAG_DEFINITIONS.find((entry) => entry.id === id);
  if (!definition) {
    throw new Error(`unknown realtime perf flag: ${id}`);
  }
  return definition;
}

function readRealtimePerfFlagById(id: RealtimePerfFlagId): boolean {
  const definition = getRealtimePerfFlagDefinition(id);
  return readRealtimePerfFlag(
    definition.id,
    definition.defaultValue,
    definition.testDefaultValue,
  );
}

export function getActiveRealtimePerfFlags(): Record<
  RealtimePerfFlagId,
  ActiveRealtimePerfFlag
> {
  return Object.fromEntries(
    PERF_FLAG_DEFINITIONS.map((definition) => {
      const storageKey = storageKeyForFlag(definition.id);
      let source: ActiveRealtimePerfFlag["source"] = "default";
      if (typeof window !== "undefined") {
        try {
          if (parseBooleanFlag(window.localStorage.getItem(storageKey)) !== null) {
            source = "localStorage";
          }
        } catch {
          source = "default";
        }
      }
      return [
        definition.id,
        {
          value: readRealtimePerfFlagById(definition.id),
          source,
          storageKey,
          defaultValue: definition.defaultValue,
          testDefaultValue: definition.testDefaultValue,
          metric: definition.metric,
        },
      ];
    }),
  ) as Record<RealtimePerfFlagId, ActiveRealtimePerfFlag>;
}

export const TOOL_OUTPUT_TAIL_GATE_FLAG_KEY = "doge.perf.toolOutputTailGate";
const TOOL_OUTPUT_TAIL_GATE_DEFAULT = true;
const TOOL_OUTPUT_TAIL_GATE_TEST_DEFAULT = true;

function readStringFlag(key: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function readStreamingScheduleTier(): RenderScheduleTier {
  const raw = readStringFlag(RENDER_TIER_FLAG_KEY);
  if (raw && isRenderScheduleTier(raw)) {
    return raw;
  }
  return RENDER_SCHEDULE_TIER_DEFAULT;
}

export function isStreamingScheduleAggressiveEnabled(): boolean {
  return readStreamingScheduleTier() === "aggressive";
}

export function isToolOutputTailGateEnabled(): boolean {
  if (readStreamingScheduleTier() === "baseline") {
    return false;
  }
  const fallback = isTestMode
    ? TOOL_OUTPUT_TAIL_GATE_TEST_DEFAULT
    : TOOL_OUTPUT_TAIL_GATE_DEFAULT;
  const stored = readStringFlag(TOOL_OUTPUT_TAIL_GATE_FLAG_KEY);
  const parsed = parseBooleanFlag(stored);
  if (parsed !== null) {
    return parsed;
  }
  return fallback;
}

export function resetRealtimePerfFlags(): string[] {
  const removedKeys: string[] = [];
  if (typeof window !== "undefined") {
    const removeKey = (key: string) => {
      try {
        if (window.localStorage.getItem(key) !== null) {
          removedKeys.push(key);
        }
        window.localStorage.removeItem(key);
      } catch {
        // Ignore storage write errors; cache reset still restores defaults in-memory.
      }
    };
    for (const definition of PERF_FLAG_DEFINITIONS) {
      removeKey(storageKeyForFlag(definition.id));
    }
    removeKey(RENDER_TIER_FLAG_KEY);
    removeKey(TOOL_OUTPUT_TAIL_GATE_FLAG_KEY);
  }
  __resetRealtimePerfFlagCacheForTests();
  return removedKeys;
}

export function __resetRealtimePerfFlagCacheForTests() {
  for (const key of Object.keys(cachedFlags)) {
    delete cachedFlags[key];
  }
}
