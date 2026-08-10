import type { EngineType, TokenUsageBreakdown } from "../../../types";
import type {
  CostDegradationReason,
  CostProjectionScope,
  CostRecord,
} from "./costTypes";

export type CostHistoryEntry = CostRecord & {
  readonly sessionId: string;
  readonly occurredAt: string;
};

export type CostHistoryStore = {
  add(entry: CostHistoryEntry): void;
  upsertActiveSession(entry: CostHistoryEntry): void;
  list(): readonly CostHistoryEntry[];
  totals(now?: Date): {
    readonly sessionUsd: (sessionId: string) => number | null;
    readonly todayUsd: number | null;
    readonly monthUsd: number | null;
    readonly degraded: boolean;
  };
};

const COST_HISTORY_STORAGE_KEY = "doge.statusPanel.costHistory.v1";
const KNOWN_ENGINES: readonly EngineType[] = [
  "claude",
  "codex",
  "gemini",
  "grok",
  "kimi",
  "opencode",
];
const KNOWN_SCOPES: readonly CostProjectionScope[] = ["turn", "session"];
const KNOWN_DEGRADATION_REASONS: readonly CostDegradationReason[] = [
  "pricing-unavailable",
  "pricing-stale",
  "usage-unavailable",
  "block-level-cost-unsupported",
];

function canUseLocalStorage() {
  try {
    return typeof window !== "undefined" && Boolean(window.localStorage);
  } catch {
    return false;
  }
}

function readStoredEntries() {
  if (!canUseLocalStorage()) return null;
  try {
    return window.localStorage.getItem(COST_HISTORY_STORAGE_KEY);
  } catch {
    return null;
  }
}

function finiteNonNegative(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(value, 0)
    : 0;
}

function normalizeUsage(value: unknown): TokenUsageBreakdown | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  return {
    totalTokens: finiteNonNegative(input.totalTokens),
    inputTokens: finiteNonNegative(input.inputTokens),
    cachedInputTokens: finiteNonNegative(input.cachedInputTokens),
    outputTokens: finiteNonNegative(input.outputTokens),
    reasoningOutputTokens: finiteNonNegative(input.reasoningOutputTokens),
  };
}

function parseCostHistoryEntry(value: unknown): CostHistoryEntry | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const engine = input.engine;
  const scope = input.scope;
  const sessionId = input.sessionId;
  const occurredAt = input.occurredAt;
  const usage = normalizeUsage(input.usage);
  if (
    !KNOWN_ENGINES.includes(engine as EngineType) ||
    !KNOWN_SCOPES.includes(scope as CostProjectionScope) ||
    typeof sessionId !== "string" ||
    !sessionId.trim() ||
    typeof occurredAt !== "string" ||
    !Number.isFinite(Date.parse(occurredAt)) ||
    !usage
  ) {
    return null;
  }
  const amountUsd = input.amountUsd;
  const degradationReason = input.degradationReason;
  return {
    engine: engine as EngineType,
    model: typeof input.model === "string" ? input.model : null,
    scope: scope as CostProjectionScope,
    usage,
    amountUsd:
      typeof amountUsd === "number" && Number.isFinite(amountUsd)
        ? Math.max(amountUsd, 0)
        : null,
    currency: "USD",
    pricingSource: null,
    degraded: input.degraded === true,
    degradationReason: KNOWN_DEGRADATION_REASONS.includes(
      degradationReason as CostDegradationReason,
    )
      ? (degradationReason as CostDegradationReason)
      : null,
    sessionId,
    occurredAt,
  };
}

function parseEntries(raw: string | null): CostHistoryEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.flatMap((entry) => {
          const parsedEntry = parseCostHistoryEntry(entry);
          return parsedEntry ? [parsedEntry] : [];
        })
      : [];
  } catch {
    return [];
  }
}

function sumKnown(entries: readonly CostHistoryEntry[]) {
  const known = entries.filter(
    (entry) => entry.amountUsd != null && Number.isFinite(entry.amountUsd),
  );
  if (known.length === 0) return null;
  return known.reduce((sum, entry) => sum + (entry.amountUsd ?? 0), 0);
}

function isSameLocalDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function isSameLocalMonth(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth()
  );
}

export function createCostHistoryStore(
  seed: readonly CostHistoryEntry[] = [],
): CostHistoryStore {
  let degraded = false;
  let entries = [...seed];
  if (entries.length === 0 && canUseLocalStorage()) {
    entries = parseEntries(readStoredEntries());
  }

  function persist() {
    if (!canUseLocalStorage()) return;
    try {
      window.localStorage.setItem(
        COST_HISTORY_STORAGE_KEY,
        JSON.stringify(entries.slice(-500)),
      );
    } catch {
      degraded = true;
    }
  }

  return {
    add(entry) {
      entries = [...entries, entry].slice(-500);
      persist();
    },
    upsertActiveSession(entry) {
      entries = [
        ...entries.filter(
          (current) =>
            !(
              current.sessionId === entry.sessionId &&
              current.engine === entry.engine &&
              current.model === entry.model &&
              current.scope === entry.scope
            ),
        ),
        entry,
      ].slice(-500);
      persist();
    },
    list() {
      return entries;
    },
    totals(now = new Date()) {
      const withDates = entries
        .map((entry) => ({ entry, date: new Date(entry.occurredAt) }))
        .filter(({ date }) => Number.isFinite(date.getTime()));
      return {
        sessionUsd: (sessionId) =>
          sumKnown(entries.filter((entry) => entry.sessionId === sessionId)),
        todayUsd: sumKnown(
          withDates
            .filter(({ date }) => isSameLocalDay(date, now))
            .map(({ entry }) => entry),
        ),
        monthUsd: sumKnown(
          withDates
            .filter(({ date }) => isSameLocalMonth(date, now))
            .map(({ entry }) => entry),
        ),
        degraded,
      };
    },
  };
}

export const costHistoryStoreInternals = {
  COST_HISTORY_STORAGE_KEY,
  isSameLocalDay,
  isSameLocalMonth,
  parseEntries,
};
