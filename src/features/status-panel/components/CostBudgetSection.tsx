import { memo, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { EngineType, ThreadTokenUsage } from "../../../types";
import type { SessionBudgetConfig } from "../../context-ledger/cost-budget";
import {
  aggregateWorkspaceCost,
  buildTokenBreakdownViewModel,
  createCostHistoryStore,
  projectCostRecord,
  resolveBudgetThresholdSignal,
  useMonthlyBudgetConfig,
} from "../../context-ledger/cost-budget";
import type { TokenBreakdownSegment } from "../../context-ledger/cost-budget";

const costHistoryStore = createCostHistoryStore();

type CostBudgetSectionProps = {
  engine: EngineType | null | undefined;
  model: string | null | undefined;
  usage: ThreadTokenUsage | null | undefined;
  sessionId: string | null | undefined;
  budget?: SessionBudgetConfig | null;
  compact?: boolean;
};

function formatUsd(value: number | null) {
  if (value == null) {
    return "—";
  }
  if (value < 0.01) {
    return `$${value.toFixed(4)}`;
  }
  return `$${value.toFixed(2)}`;
}

function formatTokenCount(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function readCostV2Flag() {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return false;
    }
    return (
      window.localStorage.getItem("doge.flags.statusPanel.costV2") === "1"
    );
  } catch {
    return false;
  }
}

function TokenBreakdownBar({
  segments,
}: {
  readonly segments: readonly TokenBreakdownSegment[];
}) {
  const { t } = useTranslation();
  if (segments.length === 0) {
    return null;
  }
  return (
    <div
      className="sp-cost-token-breakdown"
      aria-label={t("statusPanel.cost.tokenBreakdownLabel")}
    >
      <div className="sp-cost-token-breakdown-bar">
        {segments.map((segment) => (
          <span
            key={segment.kind}
            className={`sp-cost-token-breakdown-segment is-${segment.kind}`}
            style={{ width: `${Math.max(segment.percent, 2)}%` }}
            title={`${segment.kind}: ${formatTokenCount(segment.tokens)}`}
          />
        ))}
      </div>
      <div className="sp-cost-token-breakdown-labels">
        {segments.map((segment) => (
          <span
            key={segment.kind}
            className={`sp-cost-token-breakdown-label is-${segment.kind}`}
          >
            {segment.kind}: {formatTokenCount(segment.tokens)}
          </span>
        ))}
      </div>
    </div>
  );
}

function AccumulatedCostCard({
  monthUsd,
  sessionUsd,
  todayUsd,
}: {
  readonly monthUsd: number | null;
  readonly sessionUsd: number | null;
  readonly todayUsd: number | null;
}) {
  const { t } = useTranslation();
  return (
    <div className="sp-cost-v2-card">
      <span>
        {t("statusPanel.cost.accumulated.session", {
          amount: formatUsd(sessionUsd),
        })}
      </span>
      <span>
        {t("statusPanel.cost.accumulated.today", {
          amount: formatUsd(todayUsd),
        })}
      </span>
      <span>
        {t("statusPanel.cost.accumulated.month", {
          amount: formatUsd(monthUsd),
        })}
      </span>
    </div>
  );
}

function BudgetBar({
  amountUsd,
  budget,
}: {
  readonly amountUsd: number | null;
  readonly budget: SessionBudgetConfig | null;
}) {
  const { t } = useTranslation();
  const limit = budget?.thresholdsUsd.block ?? null;
  const percent =
    amountUsd != null && limit != null && limit > 0
      ? Math.min((amountUsd / limit) * 100, 100)
      : 0;
  return (
    <div
      className="sp-budget-bar"
      aria-label={t("statusPanel.budget.barLabel")}
    >
      <div className="sp-budget-bar-track">
        <span className="sp-budget-bar-fill" style={{ width: `${percent}%` }} />
      </div>
      <span>
        {limit == null
          ? t("statusPanel.budget.unsetShort")
          : t("statusPanel.budget.progress", {
              amount: formatUsd(amountUsd),
              limit: formatUsd(limit),
            })}
      </span>
    </div>
  );
}

export const CostBudgetSection = memo(function CostBudgetSection({
  budget = null,
  compact = false,
  engine,
  model,
  sessionId,
  usage,
}: CostBudgetSectionProps) {
  const { t } = useTranslation();
  const [monthlyBudget] = useMonthlyBudgetConfig();
  const [, setHistoryVersion] = useState(0);
  const projection = useMemo(() => {
    if (!engine) {
      return null;
    }
    const sessionRecord = projectCostRecord({
      engine,
      model,
      usage,
      scope: "session",
    });
    return aggregateWorkspaceCost([sessionRecord]);
  }, [engine, model, usage]);
  const tokenBreakdown = useMemo(
    () => buildTokenBreakdownViewModel(projection?.records[0]?.usage ?? null),
    [projection?.records],
  );
  const costV2Enabled = useMemo(readCostV2Flag, []);
  const effectiveBudget = useMemo<SessionBudgetConfig | null>(() => {
    if (budget) return budget;
    if (monthlyBudget.monthlyLimitUsd == null) return null;
    return {
      sessionId: sessionId ?? "active-session",
      currency: "USD",
      thresholdsUsd: {
        info: monthlyBudget.monthlyLimitUsd * 0.5,
        warn: monthlyBudget.monthlyLimitUsd * monthlyBudget.warnRatio,
        block: monthlyBudget.monthlyLimitUsd * monthlyBudget.exceededRatio,
      },
    };
  }, [
    budget,
    monthlyBudget.exceededRatio,
    monthlyBudget.monthlyLimitUsd,
    monthlyBudget.warnRatio,
    sessionId,
  ]);
  const budgetSignal = useMemo(
    () =>
      resolveBudgetThresholdSignal({
        sessionId: sessionId ?? "",
        amountUsd: projection?.amountUsd ?? null,
        budget: effectiveBudget,
      }),
    [effectiveBudget, projection?.amountUsd, sessionId],
  );
  const primaryRecord = projection?.records[0] ?? null;
  useEffect(() => {
    if (!sessionId || !primaryRecord || primaryRecord.amountUsd == null) {
      return;
    }
    costHistoryStore.upsertActiveSession({
      ...primaryRecord,
      sessionId,
      occurredAt: new Date().toISOString(),
    });
    setHistoryVersion((value) => value + 1);
  }, [primaryRecord, sessionId]);
  const costTotals = (() => {
    const totals = costHistoryStore.totals();
    return {
      sessionUsd: sessionId
        ? totals.sessionUsd(sessionId)
        : (projection?.amountUsd ?? null),
      todayUsd: totals.todayUsd,
      monthUsd: totals.monthUsd,
      degraded: totals.degraded,
    };
  })();

  if (!engine || !usage || !projection) {
    return null;
  }

  const pricingSource = primaryRecord?.pricingSource ?? null;
  const hasKnownPricing = Boolean(
    pricingSource && primaryRecord?.amountUsd != null,
  );
  return (
    <section
      className={`sp-checkpoint-section sp-cost-budget${compact ? " is-compact" : ""}`}
    >
      <div className="sp-checkpoint-inline-heading">
        <span className="sp-checkpoint-section-title">
          {t("statusPanel.cost.title")}
        </span>
        <span className="sp-checkpoint-action-hint">
          {projection.partial
            ? t("statusPanel.cost.partial")
            : t("statusPanel.cost.known")}
        </span>
      </div>
      <div className="sp-checkpoint-evidence-summary-badges">
        <span className="sp-checkpoint-evidence-badge">
          {t("statusPanel.cost.session")}: {formatUsd(projection.amountUsd)}
        </span>
        {sessionId ? (
          <span className="sp-checkpoint-evidence-badge">
            {t("statusPanel.cost.sessionId")}: {sessionId}
          </span>
        ) : null}
        <span className="sp-checkpoint-evidence-badge">
          {t("statusPanel.cost.engine")}: {engine}
        </span>
        <span className="sp-checkpoint-evidence-badge">
          {t("statusPanel.cost.model")}:{" "}
          {model || t("statusPanel.cost.unknownModel")}
        </span>
        {tokenBreakdown ? (
          <span className="sp-checkpoint-evidence-badge">
            {t("statusPanel.cost.tokens")}:{" "}
            {formatTokenCount(tokenBreakdown.totalTokens)}
          </span>
        ) : null}
      </div>
      {tokenBreakdown && (!hasKnownPricing || costV2Enabled) ? (
        <TokenBreakdownBar segments={tokenBreakdown.segments} />
      ) : null}
      {costV2Enabled ? (
        <>
          <AccumulatedCostCard
            monthUsd={costTotals.monthUsd}
            sessionUsd={costTotals.sessionUsd}
            todayUsd={costTotals.todayUsd}
          />
          <BudgetBar
            amountUsd={costTotals.monthUsd ?? projection.amountUsd}
            budget={effectiveBudget}
          />
        </>
      ) : null}
      {primaryRecord?.degraded ? (
        <div className="sp-checkpoint-validation-guide">
          <span className="sp-checkpoint-validation-guide-label">
            {t(
              `statusPanel.cost.degraded.${primaryRecord.degradationReason ?? "unknown"}`,
              {
                engine,
                model: model || t("statusPanel.cost.unknownModel"),
              },
            )}
          </span>
        </div>
      ) : null}
      {pricingSource ? (
        <div className="sp-checkpoint-validation-guide">
          <span className="sp-checkpoint-validation-guide-label">
            {t("statusPanel.cost.pricingSource", {
              source: pricingSource.source,
              date: pricingSource.lastUpdatedAt.slice(0, 10),
            })}
          </span>
        </div>
      ) : null}
      {costTotals.degraded ? (
        <div className="sp-checkpoint-validation-guide is-warn">
          <span className="sp-checkpoint-validation-guide-label">
            {t("statusPanel.cost.historyDegraded")}
          </span>
        </div>
      ) : null}
      {!effectiveBudget ? (
        <div className="sp-checkpoint-validation-guide is-info">
          <span className="sp-checkpoint-validation-guide-label">
            {t("statusPanel.budget.unconfigured")}
          </span>
        </div>
      ) : null}
      {budgetSignal ? (
        <div
          className={`sp-checkpoint-validation-guide is-${budgetSignal.severity}`}
        >
          <span className="sp-checkpoint-validation-guide-label">
            {t(`statusPanel.budget.threshold.${budgetSignal.tier}`, {
              amount: formatUsd(budgetSignal.amountUsd),
              threshold: formatUsd(budgetSignal.thresholdUsd),
            })}
          </span>
        </div>
      ) : null}
    </section>
  );
});
