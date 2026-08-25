import { memo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatTokenCount } from "../../../utils/tokenFormat";
import { formatDurationCompact, formatRelativeTime } from "../../../utils/time";
import type {
  SessionOverviewQuotaWindowView,
  SessionOverviewViewModel,
} from "../utils/sessionOverviewViewModel";

type SessionOverviewSectionProps = {
  overview: SessionOverviewViewModel;
  compact?: boolean;
};

function meterToneClass(percent: number, showRemaining: boolean): string {
  // remaining 模式下百分比越高越好；used 模式越高越危险
  const pressure = showRemaining ? 100 - percent : percent;
  if (pressure >= 90) return " is-critical";
  if (pressure >= 75) return " is-high";
  return "";
}

function OverviewProp({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="sp-session-overview-prop">
      <span className="sp-session-overview-prop-label">{label}</span>
      <span
        className={`sp-session-overview-prop-value${mono ? " is-mono" : ""}`}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function OverviewMeter({
  label,
  percent,
  detail,
  showRemaining,
  variant = "context",
  footer,
}: {
  label: string;
  percent: number;
  detail?: string | null;
  showRemaining?: boolean;
  variant?: "context" | "quota";
  footer?: string | null;
}) {
  return (
    <div className="sp-session-overview-meter">
      <div className="sp-session-overview-meter-label">
        <span>{label}</span>
        <span className="sp-session-overview-meter-value">
          {percent}%
          {detail ? ` ${detail}` : ""}
        </span>
      </div>
      <div
        className="sp-session-overview-meter-track"
        role="progressbar"
        aria-label={label}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span
          className={`sp-session-overview-meter-fill${variant === "quota" ? " is-quota" : ""}${meterToneClass(percent, Boolean(showRemaining))}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      {footer ? (
        <div className="sp-session-overview-meter-footer">{footer}</div>
      ) : null}
    </div>
  );
}

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

function QuotaWindows({
  windows,
  showRemaining,
  t,
}: {
  windows: SessionOverviewQuotaWindowView[];
  showRemaining: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const modeLabel = t(showRemaining ? "usage.remaining" : "usage.used");
  return (
    <>
      {windows.map((window) => (
        <OverviewMeter
          key={window.id}
          label={window.label}
          percent={window.displayPercent}
          detail={modeLabel}
          showRemaining={showRemaining}
          variant="quota"
          footer={formatQuotaReset(
            window.resetsAt,
            window.id === "secondary" ||
              window.id === "weekly_limit" ||
              window.id === "seven_day"
              ? "usage.weeklyReset"
              : "usage.sessionReset",
            t,
          )}
        />
      ))}
    </>
  );
}

export const SessionOverviewSection = memo(function SessionOverviewSection({
  overview,
  compact = false,
}: SessionOverviewSectionProps) {
  const { t } = useTranslation();
  const sectionClass = `sp-session-overview${compact ? " is-compact" : ""}`;

  if (!overview.hasAnyContent) {
    return (
      <section
        className={sectionClass}
        aria-label={t("statusPanel.sessionOverview.title")}
      >
        <p className="sp-session-overview-empty-hint">
          {t("statusPanel.sessionOverview.empty")}
        </p>
      </section>
    );
  }

  const durationLabel =
    overview.durationMs != null
      ? overview.status === "idle"
        ? t("statusPanel.sessionOverview.duration.last", {
            duration: formatDurationCompact(overview.durationMs),
          })
        : t("statusPanel.sessionOverview.duration.running", {
            duration: formatDurationCompact(overview.durationMs),
          })
      : null;

  const engineLineValue = overview.engineLine;

  const contextTokenLabel =
    overview.contextUsedTokens != null && overview.modelContextWindow != null
      ? `${formatTokenCount(overview.contextUsedTokens)}/${formatTokenCount(overview.modelContextWindow)}`
      : null;

  const propertyRows: ReactNode[] = [];
  if (overview.sessionId) {
    propertyRows.push(
      <OverviewProp
        key="sessionId"
        label={t("statusPanel.sessionOverview.fields.sessionId")}
        value={overview.sessionId}
        mono
      />,
    );
  }
  if (overview.workspaceLabel) {
    propertyRows.push(
      <OverviewProp
        key="workspace"
        label={t("statusPanel.sessionOverview.fields.workspace")}
        value={overview.workspaceLabel}
      />,
    );
  }
  if (overview.workspacePath) {
    propertyRows.push(
      <OverviewProp
        key="workspacePath"
        label={t("statusPanel.sessionOverview.fields.workspacePath")}
        value={overview.workspacePath}
        mono
      />,
    );
  }
  if (overview.sessionDiskPath) {
    propertyRows.push(
      <OverviewProp
        key="sessionDiskPath"
        label={t("statusPanel.sessionOverview.fields.sessionDiskPath")}
        value={overview.sessionDiskPath}
        mono
      />,
    );
  } else if (overview.sessionId) {
    propertyRows.push(
      <OverviewProp
        key="sessionDiskPathMissing"
        label={t("statusPanel.sessionOverview.fields.sessionDiskPath")}
        value={t("statusPanel.sessionOverview.sessionDiskPathUnknown")}
      />,
    );
  }
  if (engineLineValue) {
    propertyRows.push(
      <OverviewProp
        key="engine"
        label={
          overview.quotaEntries.length > 1
            ? t("statusPanel.sessionOverview.fields.engines")
            : t("statusPanel.sessionOverview.fields.engine")
        }
        value={engineLineValue}
      />,
    );
  }

  const quotaEntries = overview.quotaEntries;
  const hasContextMeter = overview.contextUsedPercent != null;
  const showQuotaSection = quotaEntries.length > 0;

  return (
    <section
      className={sectionClass}
      aria-label={t("statusPanel.sessionOverview.title")}
    >
      {/* 状态文案已在概览 Tab badge 展示，内容区仅保留时长（若有） */}
      {durationLabel ? (
        <div className="sp-session-overview-status-line">
          <span className="sp-session-overview-duration">{durationLabel}</span>
        </div>
      ) : null}

      {propertyRows.length > 0 ? (
        <div className="sp-session-overview-props">{propertyRows}</div>
      ) : null}

      {hasContextMeter || showQuotaSection ? (
        <div className="sp-session-overview-meters">
          {overview.contextUsedPercent != null ? (
            <OverviewMeter
              label={t("statusPanel.sessionOverview.contextLabel")}
              percent={overview.contextUsedPercent}
              detail={contextTokenLabel ? `· ${contextTokenLabel}` : null}
            />
          ) : null}

          {quotaEntries.map((entry) => {
            const { quota } = entry;
            const quotaTitle =
              quota.source === "official_cli"
                ? t("statusPanel.sessionOverview.quota.codexTitle")
                : quota.source === "coding_plan" && quota.providerLabel
                  ? t("statusPanel.sessionOverview.quota.codingPlanTitle", {
                      provider: quota.providerLabel,
                    })
                  : t("statusPanel.sessionOverview.quota.genericTitle");
            const cardTitle =
              quotaEntries.length > 1
                ? entry.subtitle
                  ? `${entry.title} · ${entry.subtitle}`
                  : entry.title
                : quotaTitle;

            if (quota.source === "unsupported" || quota.source === "error") {
              return (
                <div key={entry.key} className="sp-session-overview-quota">
                  {quotaEntries.length > 1 ? (
                    <div className="sp-session-overview-quota-header">
                      <span>{cardTitle}</span>
                    </div>
                  ) : null}
                  <p className="sp-session-overview-quota-empty">
                    {quota.error
                      ? t("statusPanel.sessionOverview.quota.error", {
                          message: quota.error,
                        })
                      : t("statusPanel.sessionOverview.quota.unsupported", {
                          engine: entry.engine,
                        })}
                  </p>
                </div>
              );
            }

            if (
              quota.source !== "official_cli" &&
              quota.source !== "coding_plan"
            ) {
              return null;
            }

            // 余额型（DeepSeek 等）：两行——标题 + 额度金额；去掉套餐副标题 / available
            const isBalanceOnly =
              !quota.loading &&
              quota.windows.length === 0 &&
              quota.hasCredits;
            if (isBalanceOnly) {
              const balanceText = quota.creditsUnlimited
                ? t("usage.unlimited")
                : (quota.creditsBalance ?? "—");
              return (
                <div
                  key={entry.key}
                  className="sp-session-overview-quota is-balance-only"
                >
                  <div className="sp-session-overview-quota-header">
                    <span className="sp-session-overview-quota-title">
                      {cardTitle}
                    </span>
                  </div>
                  <div className="sp-session-overview-quota-credits">
                    <span>{t("usage.credits")}</span>
                    <span className="sp-session-overview-quota-balance">
                      {balanceText}
                    </span>
                  </div>
                </div>
              );
            }

            return (
              <div key={entry.key} className="sp-session-overview-quota">
                <div className="sp-session-overview-quota-header">
                  <span>{cardTitle}</span>
                  {quota.planType ? (
                    <span className="sp-session-overview-quota-plan">
                      {quota.planType}
                    </span>
                  ) : null}
                </div>
                {quotaEntries.length > 1 &&
                (quota.source === "coding_plan" ||
                  quota.source === "official_cli") ? (
                  <div className="sp-session-overview-quota-subhead">
                    {quotaTitle}
                  </div>
                ) : null}
                {quota.loading ? (
                  <p className="sp-session-overview-quota-empty">
                    {t("statusPanel.sessionOverview.quota.loading")}
                  </p>
                ) : quota.windows.length > 0 ? (
                  <QuotaWindows
                    windows={quota.windows}
                    showRemaining={quota.showRemaining}
                    t={t}
                  />
                ) : (
                  <p className="sp-session-overview-quota-empty">
                    {quota.source === "official_cli"
                      ? t("statusPanel.sessionOverview.quota.codexEmpty")
                      : t("statusPanel.sessionOverview.quota.codingPlanEmpty")}
                  </p>
                )}
                {quota.hasCredits ? (
                  <div className="sp-session-overview-quota-credits">
                    <span>{t("usage.credits")}</span>
                    <span>
                      {quota.creditsUnlimited
                        ? t("usage.unlimited")
                        : (quota.creditsBalance ?? "—")}
                    </span>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {overview.messageCount > 0 ? (
        <div className="sp-session-overview-stats">
          {t("statusPanel.sessionOverview.turns", {
            turns: overview.turnCount,
            messages: overview.messageCount,
          })}
        </div>
      ) : null}
    </section>
  );
});
