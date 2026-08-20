import type {
  QuotaUsageViewV1,
  SubscriptionUsageWindowV1,
} from "../../account/contracts";
import { createRealAccountGatewayV1 } from "../../../services/accountGateway";
import type { CodingPlanQuotaSnapshot } from "../../../services/tauri";
import type { SessionQuotaTarget } from "./sessionQuotaTargets";

export const TOKEN_MATRIX_MANAGED_PROVIDER_PROFILE_ID = "doge-token-matrix";
export const TOKEN_MATRIX_UNAVAILABLE_MESSAGE =
  "Token Matrix 额度暂时不可用，请稍后重试";
const TOKEN_MATRIX_NOT_SUBSCRIBED_MESSAGE = "当前引擎未订阅 Token Matrix 套餐";

export type ManagedAccountQuotaResult = {
  readonly target: SessionQuotaTarget;
  readonly snapshot: CodingPlanQuotaSnapshot;
};

export function isManagedAccountQuotaTarget(
  target: SessionQuotaTarget,
): boolean {
  return (
    target.providerProfileId?.trim() ===
      TOKEN_MATRIX_MANAGED_PROVIDER_PROFILE_ID &&
    (target.engine === "codex" || target.engine === "claude")
  );
}

/**
 * Token Matrix managed targets share one authority read per refresh. The account
 * gateway validates the native envelope and keeps vault credentials out of this
 * renderer-facing adapter.
 */
export async function loadManagedAccountQuotaSnapshots(
  targets: readonly SessionQuotaTarget[],
): Promise<readonly ManagedAccountQuotaResult[]> {
  const result = await createRealAccountGatewayV1().usage.read({});
  if (!result.ok) {
    return targets.map((target) => ({
      target,
      snapshot: unavailableSnapshot(),
    }));
  }
  return targets.map((target) => ({
    target,
    snapshot: managedAccountQuotaSnapshot(result.value, target.engine),
  }));
}

export function managedAccountQuotaSnapshot(
  usage: QuotaUsageViewV1,
  engine: SessionQuotaTarget["engine"],
): CodingPlanQuotaSnapshot {
  if (usage.status !== "available") {
    return unavailableSnapshot();
  }
  const engineUsage = usage.engines.find(
    (entry) => entry.engineId === managedEngineId(engine),
  );
  if (!engineUsage) {
    return {
      source: "token_matrix_not_subscribed",
      success: true,
      error: TOKEN_MATRIX_NOT_SUBSCRIBED_MESSAGE,
      planLabel: null,
      windows: [],
      queriedAt: Date.now(),
    };
  }
  if (engineUsage.analyticsStatus !== "available") {
    return unavailableSnapshot();
  }
  return {
    source: "token_matrix",
    success: true,
    error: null,
    planLabel: engineUsage.subscriptionLabel,
    windows: [
      quotaWindow("daily", engineUsage.windows.daily),
      quotaWindow("weekly", engineUsage.windows.weekly),
      quotaWindow("monthly", engineUsage.windows.monthly),
    ].filter((window): window is NonNullable<typeof window> => window !== null),
    usageSummary: {
      totalRequests: engineUsage.totals.requests,
      totalActualCost: engineUsage.totals.actualCost.value,
      totalInputTokens: engineUsage.totals.inputTokens,
      totalOutputTokens: engineUsage.totals.outputTokens,
      totalTokens: engineUsage.totals.totalTokens,
      averageDurationMs: null,
    },
    queriedAt: Date.now(),
  };
}

function managedEngineId(
  engine: SessionQuotaTarget["engine"],
): "codex" | "claude-code" {
  return engine === "claude" ? "claude-code" : "codex";
}

function quotaWindow(
  id: "daily" | "weekly" | "monthly",
  window: SubscriptionUsageWindowV1 | null,
) {
  if (!window) return null;
  const usedPercent = percentage(window.percentage);
  return {
    id,
    usedPercent,
    remainingPercent: Math.max(0, 100 - usedPercent),
    resetsAt: window.resetsAt,
    usedAmount: formatMeasure(window.used.value, window.used.unit),
    limitAmount: formatMeasure(window.limit.value, window.limit.unit),
  };
}

function percentage(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 0;
}

function formatMeasure(value: string, unit: string): string {
  return unit === "usd" ? `USD ${value}` : value;
}

function unavailableSnapshot(): CodingPlanQuotaSnapshot {
  return {
    source: "token_matrix",
    success: false,
    error: TOKEN_MATRIX_UNAVAILABLE_MESSAGE,
    planLabel: null,
    windows: [],
    queriedAt: Date.now(),
  };
}
