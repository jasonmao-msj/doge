import type { MonthlyBudgetConfig, SessionBudgetConfig } from "./budgetTypes";

export type BudgetStore = {
  get(sessionId: string): SessionBudgetConfig | null;
  set(config: SessionBudgetConfig): void;
  remove(sessionId: string): void;
  list(): readonly SessionBudgetConfig[];
};

export function createBudgetStore(
  seed: readonly SessionBudgetConfig[] = [],
): BudgetStore {
  const configs = new Map<string, SessionBudgetConfig>();
  for (const config of seed) {
    configs.set(config.sessionId, config);
  }

  return {
    get(sessionId) {
      return configs.get(sessionId) ?? null;
    },
    set(config) {
      configs.set(config.sessionId, config);
    },
    remove(sessionId) {
      configs.delete(sessionId);
    },
    list() {
      return Array.from(configs.values());
    },
  };
}

export type MonthlyBudgetStore = {
  get(): MonthlyBudgetConfig;
  set(config: MonthlyBudgetConfig): void;
  clear(): void;
  degraded(): boolean;
};

const MONTHLY_BUDGET_STORAGE_KEY = "doge.statusPanel.monthlyBudget.v1";
const MONTHLY_BUDGET_CHANGE_EVENT = "doge:status-panel-monthly-budget-change";

const DEFAULT_MONTHLY_BUDGET: MonthlyBudgetConfig = {
  currency: "USD",
  monthlyLimitUsd: null,
  warnRatio: 0.8,
  exceededRatio: 1,
};

function canUseLocalStorage() {
  try {
    return typeof window !== "undefined" && Boolean(window.localStorage);
  } catch {
    return false;
  }
}

function readStoredMonthlyBudget() {
  if (!canUseLocalStorage()) return null;
  try {
    return window.localStorage.getItem(MONTHLY_BUDGET_STORAGE_KEY);
  } catch {
    return null;
  }
}

function notifyMonthlyBudgetChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(MONTHLY_BUDGET_CHANGE_EVENT, {
      detail: { key: MONTHLY_BUDGET_STORAGE_KEY },
    }),
  );
  window.dispatchEvent(
    new CustomEvent("localStorageChange", {
      detail: { key: MONTHLY_BUDGET_STORAGE_KEY },
    }),
  );
}

function parseMonthlyBudget(raw: string | null): MonthlyBudgetConfig {
  if (!raw) return DEFAULT_MONTHLY_BUDGET;
  try {
    const parsed = JSON.parse(raw) as Partial<MonthlyBudgetConfig>;
    const warnRatio =
      typeof parsed.warnRatio === "number" && Number.isFinite(parsed.warnRatio)
        ? Math.max(parsed.warnRatio, 0)
        : DEFAULT_MONTHLY_BUDGET.warnRatio;
    const exceededRatio =
      typeof parsed.exceededRatio === "number" &&
      Number.isFinite(parsed.exceededRatio)
        ? Math.max(parsed.exceededRatio, warnRatio)
        : Math.max(DEFAULT_MONTHLY_BUDGET.exceededRatio, warnRatio);
    return {
      currency: "USD",
      monthlyLimitUsd:
        typeof parsed.monthlyLimitUsd === "number" &&
        Number.isFinite(parsed.monthlyLimitUsd)
          ? Math.max(parsed.monthlyLimitUsd, 0)
          : null,
      warnRatio,
      exceededRatio,
    };
  } catch {
    return DEFAULT_MONTHLY_BUDGET;
  }
}

export function createMonthlyBudgetStore(
  seed: MonthlyBudgetConfig = DEFAULT_MONTHLY_BUDGET,
): MonthlyBudgetStore {
  let degraded = false;
  let config = canUseLocalStorage()
    ? parseMonthlyBudget(readStoredMonthlyBudget())
    : seed;

  function persist(next: MonthlyBudgetConfig) {
    if (!canUseLocalStorage()) return;
    try {
      window.localStorage.setItem(
        MONTHLY_BUDGET_STORAGE_KEY,
        JSON.stringify(next),
      );
    } catch {
      degraded = true;
    }
  }

  return {
    get() {
      return config;
    },
    set(next) {
      config = next;
      persist(next);
      notifyMonthlyBudgetChanged();
    },
    clear() {
      config = DEFAULT_MONTHLY_BUDGET;
      persist(config);
      notifyMonthlyBudgetChanged();
    },
    degraded() {
      return degraded;
    },
  };
}

export const budgetStoreInternals = {
  DEFAULT_MONTHLY_BUDGET,
  MONTHLY_BUDGET_CHANGE_EVENT,
  MONTHLY_BUDGET_STORAGE_KEY,
  notifyMonthlyBudgetChanged,
  parseMonthlyBudget,
};
