import { useTranslation } from "react-i18next";
import type {
  SessionOverviewQuotaView,
  SessionOverviewUsageSummaryView,
} from "../../../../status-panel/utils/sessionOverviewViewModel";
import { formatRelativeTime } from "../../../../../utils/time";
import { formatTokenCount } from "../../../../../utils/tokenFormat";

export type SessionControlQuotaPaneProps = {
  /** 已由 buildSessionOverviewQuota 合并的额度视图（官方 rate limit + coding plan） */
  quota: SessionOverviewQuotaView;
  usageLoading?: boolean;
  onRefresh?: () => void;
};

function formatQuotaReset(
  resetsAt: number | null,
  labelKey: "usage.sessionReset" | "usage.weeklyReset",
  t: (key: string) => string,
): string | null {
  if (typeof resetsAt !== "number" || !Number.isFinite(resetsAt)) {
    return null;
  }
  const resetMs = resetsAt > 1_000_000_000_000 ? resetsAt : resetsAt * 1000;
  return `${t(labelKey)} ${formatRelativeTime(resetMs)}`;
}

/** 紧凑 Token：6608 → 6.6K，19675 → 19.7K，2.4e9 → 2.4B */
export function formatCompactTokenCount(value: number): string {
  return formatTokenCount(value);
}

/** 毫秒 → 秒展示：3885 → 3.89s（统一 2 位小数） */
export function formatAverageDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return "—";
  }
  const seconds = ms / 1000;
  return `${seconds.toFixed(2)}s`;
}

function UsageSummaryRows({
  summary,
  t,
}: {
  summary: SessionOverviewUsageSummaryView;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const rows: Array<{ key: string; label: string; value: string }> = [];
  if (summary.totalRequests != null) {
    rows.push({
      key: "requests",
      label: t("composer.quotaTotalRequests", { defaultValue: "总计请求" }),
      value: String(summary.totalRequests),
    });
  }
  if (summary.totalActualCost) {
    rows.push({
      key: "cost",
      label: t("composer.quotaTotalCost", { defaultValue: "累计消费" }),
      value: `$${summary.totalActualCost}`,
    });
  }
  if (summary.totalInputTokens != null || summary.totalOutputTokens != null) {
    const input =
      summary.totalInputTokens != null
        ? formatCompactTokenCount(summary.totalInputTokens)
        : "—";
    const output =
      summary.totalOutputTokens != null
        ? formatCompactTokenCount(summary.totalOutputTokens)
        : "—";
    rows.push({
      key: "io",
      label: t("composer.quotaInputOutput", { defaultValue: "输入 / 输出" }),
      value: `${input} / ${output}`,
    });
  }
  if (summary.totalTokens != null) {
    rows.push({
      key: "tokens",
      label: t("composer.quotaTotalTokens", { defaultValue: "累计 Token" }),
      value: formatCompactTokenCount(summary.totalTokens),
    });
  }
  if (summary.averageDurationMs != null) {
    rows.push({
      key: "latency",
      label: t("composer.quotaAvgLatency", { defaultValue: "平均响应" }),
      value: formatAverageDurationMs(summary.averageDurationMs),
    });
  }
  if (rows.length === 0) {
    return null;
  }
  return (
    <>
      {rows.map((row) => (
        <div key={row.key} className="composer-session-hud-quota-row">
          <span className="composer-session-hud-quota-key">{row.label}</span>
          <span className="composer-session-hud-quota-val">{row.value}</span>
        </div>
      ))}
    </>
  );
}

/**
 * Right-rail Quota summary for Session Control HUD.
 * Presentational only — binds SessionOverviewQuotaView from overview pipeline.
 */
export function SessionControlQuotaPane({
  quota,
  usageLoading = false,
  onRefresh,
}: SessionControlQuotaPaneProps) {
  const { t } = useTranslation();
  const usedLabel = t(quota.showRemaining ? "usage.remaining" : "usage.used");
  const loading = usageLoading || quota.loading;
  const providerText =
    quota.providerLabel?.trim() ||
    t("composer.quotaProvider", { defaultValue: "Provider" });

  // 中转供应商 label 形如 `{origin} {source}`（含 http(s)），标题勿整串塞进「xx 套餐额度」
  const isRelayProvider =
    !!quota.providerLabel &&
    (quota.providerLabel.startsWith("http://") ||
      quota.providerLabel.startsWith("https://"));
  const title =
    quota.source === "official_cli"
      ? t("statusPanel.sessionOverview.quota.codexTitle")
      : quota.source === "coding_plan" && isRelayProvider
        ? t("composer.quotaWindow", { defaultValue: "配额窗口" })
        : quota.source === "coding_plan" && quota.providerLabel
          ? t("statusPanel.sessionOverview.quota.codingPlanTitle", {
              provider: quota.providerLabel,
            })
          : t("composer.quotaWindow", { defaultValue: "Quota window" });

  const primaryWindow = quota.windows[0] ?? null;
  const secondaryWindow = quota.windows[1] ?? null;
  const primaryReset = primaryWindow
    ? formatQuotaReset(primaryWindow.resetsAt, "usage.sessionReset", t)
    : null;
  const sparkBase = primaryWindow?.displayPercent ?? 0;
  const sparkHeights = [
    0.35, 0.48, 0.3, 0.62, 0.42, 0.55, 0.38, 0.7, 0.45, 0.52, 0.33, 0.64,
  ].map((scale, index) => {
    const tip = index >= 8;
    const height = Math.max(12, Math.round((sparkBase || 36) * scale * 0.9));
    return { height, tip };
  });

  const hasUsageDetail = quota.usageSummary != null;
  const isBalanceOrUsageOnly =
    !loading &&
    quota.windows.length === 0 &&
    (quota.hasCredits || hasUsageDetail) &&
    (quota.source === "coding_plan" || quota.source === "official_cli");

  const emptyMessage = (() => {
    if (loading) {
      return t("statusPanel.sessionOverview.quota.loading");
    }
    // 友好文案直接展示（后端已替换 404/鉴权等原始错误）
    if (quota.error) {
      return quota.error;
    }
    if (quota.source === "error") {
      return t("statusPanel.sessionOverview.quota.notSupported", {
        defaultValue: "暂不支持额度查询",
      });
    }
    if (quota.source === "unsupported") {
      return (
        quota.error ??
        t("statusPanel.sessionOverview.quota.notSupported", {
          defaultValue: "暂不支持额度查询",
        })
      );
    }
    if (quota.source === "not_subscribed") {
      return (
        quota.error ??
        t("statusPanel.sessionOverview.quota.notSubscribed", {
          defaultValue: "当前引擎未订阅",
        })
      );
    }
    // none：官方无额度块 / 无可查 plan
    if (quota.source === "none") {
      return t("statusPanel.sessionOverview.quota.codingPlanEmpty");
    }
    if (quota.source === "official_cli") {
      return t("statusPanel.sessionOverview.quota.codexEmpty");
    }
    if (quota.source === "coding_plan") {
      return t("statusPanel.sessionOverview.quota.codingPlanEmpty");
    }
    return t("statusPanel.sessionOverview.quota.codingPlanEmpty");
  })();

  const showWindows =
    !loading &&
    (quota.source === "official_cli" || quota.source === "coding_plan") &&
    quota.windows.length > 0;

  return (
    <aside
      className="composer-session-hud-quota"
      data-testid="composer-session-quota-pane"
      aria-label={t("composer.quotaWindow", { defaultValue: "Quota window" })}
    >
      <div className="composer-session-hud-quota-header">
        <h4 className="composer-session-hud-quota-title">{title}</h4>
        {onRefresh ? (
          <button
            type="button"
            className="composer-session-hud-quota-refresh"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onRefresh();
            }}
            title={t("home.refreshUsage")}
            aria-label={t("home.refreshUsage")}
          >
            <span
              className={`codicon ${loading ? "codicon-loading codicon-modifier-spin" : "codicon-refresh"}`}
              aria-hidden="true"
            />
          </button>
        ) : null}
      </div>

      {isBalanceOrUsageOnly ? (
        <div className="composer-session-hud-quota-metrics">
          {quota.hasCredits ? (
            <div className="composer-session-hud-quota-row">
              <span className="composer-session-hud-quota-key">
                {t("usage.credits")}
              </span>
              <span className="composer-session-hud-quota-val">
                {quota.creditsUnlimited
                  ? t("usage.unlimited")
                  : (quota.creditsBalance ?? "—")}
              </span>
            </div>
          ) : null}
          {quota.usageSummary ? (
            <UsageSummaryRows summary={quota.usageSummary} t={t} />
          ) : null}
          <div className="composer-session-hud-quota-row">
            <span className="composer-session-hud-quota-key">
              {t("composer.quotaProvider", { defaultValue: "Provider" })}
            </span>
            <span className="composer-session-hud-quota-val">
              {providerText}
            </span>
          </div>
        </div>
      ) : showWindows ? (
        <>
          <div className="composer-session-hud-quota-metrics">
            <div className="composer-session-hud-quota-row">
              <span className="composer-session-hud-quota-key">
                {t("composer.quotaUsed", { defaultValue: "Used" })}
              </span>
              <span className="composer-session-hud-quota-val">
                {primaryWindow
                  ? `${primaryWindow.displayPercent}% ${usedLabel}`
                  : "--"}
              </span>
            </div>
            {primaryWindow?.usedAmount && primaryWindow.limitAmount ? (
              <div className="composer-session-hud-quota-row">
                <span className="composer-session-hud-quota-key">
                  {t("composer.quotaAmount", { defaultValue: "额度" })}
                </span>
                <span className="composer-session-hud-quota-val">
                  {primaryWindow.usedAmount} / {primaryWindow.limitAmount}
                </span>
              </div>
            ) : null}
            <div className="composer-session-hud-quota-row">
              <span className="composer-session-hud-quota-key">
                {t("composer.quotaReset", { defaultValue: "Reset" })}
              </span>
              <span className="composer-session-hud-quota-val">
                {primaryReset ?? "--"}
              </span>
            </div>
            {quota.hasCredits ? (
              <div className="composer-session-hud-quota-row">
                <span className="composer-session-hud-quota-key">
                  {t("usage.credits")}
                </span>
                <span className="composer-session-hud-quota-val">
                  {quota.creditsUnlimited
                    ? t("usage.unlimited")
                    : (quota.creditsBalance ?? "—")}
                </span>
              </div>
            ) : null}
            {quota.usageSummary ? (
              <UsageSummaryRows summary={quota.usageSummary} t={t} />
            ) : null}
            <div className="composer-session-hud-quota-row">
              <span className="composer-session-hud-quota-key">
                {t("composer.quotaProvider", { defaultValue: "Provider" })}
              </span>
              <span className="composer-session-hud-quota-val">
                {providerText}
              </span>
            </div>
          </div>

          <div
            className="composer-session-hud-quota-progress"
            aria-hidden="true"
          >
            <span
              className="composer-session-hud-quota-progress-fill"
              style={{ width: `${primaryWindow?.displayPercent ?? 0}%` }}
            />
          </div>

          {primaryWindow?.label ? (
            <div className="composer-session-hud-quota-window-label">
              {primaryWindow.label}
            </div>
          ) : null}

          {secondaryWindow ? (
            <div className="composer-session-hud-quota-secondary">
              <div className="composer-session-hud-quota-row">
                <span className="composer-session-hud-quota-key">
                  {secondaryWindow.label}
                </span>
                <span className="composer-session-hud-quota-val">
                  {`${secondaryWindow.displayPercent}% ${usedLabel}`}
                </span>
              </div>
              {formatQuotaReset(
                secondaryWindow.resetsAt,
                "usage.weeklyReset",
                t,
              ) ? (
                <div className="composer-session-hud-quota-reset-secondary">
                  {formatQuotaReset(
                    secondaryWindow.resetsAt,
                    "usage.weeklyReset",
                    t,
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="composer-session-hud-spark" aria-hidden="true">
            {sparkHeights.map((bar, index) => (
              <i
                key={`spark-${index}`}
                className={bar.tip ? "is-tip" : undefined}
                style={{ height: `${bar.height}%` }}
              />
            ))}
          </div>
        </>
      ) : (
        <div className="composer-session-hud-quota-metrics">
          <p className="composer-session-hud-quota-empty">{emptyMessage}</p>
          <div className="composer-session-hud-quota-row">
            <span className="composer-session-hud-quota-key">
              {t("composer.quotaProvider", { defaultValue: "Provider" })}
            </span>
            <span className="composer-session-hud-quota-val">
              {providerText}
            </span>
          </div>
        </div>
      )}
    </aside>
  );
}
