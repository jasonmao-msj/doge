import { useMemo } from "react";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import { EngineIcon } from "../../engine/components/EngineIcon";
import type {
  AccountSubscriptionSummaryItemV1,
  AccountSubscriptionSummaryViewV1,
  GatewayFailureV1,
  ManagedUsageEngineIdV1,
  QuotaMeasureV1,
  SubscriptionSummaryWindowV1,
} from "../contracts";
import {
  useAccountExperienceCopyV1,
  useAccountExperienceLocaleV1,
  type AccountExperienceLocaleV1,
} from "../hooks/useAccountExperienceCopy";
import { useAccountSubscriptionSummaryV1 } from "../hooks/useAccountSubscriptionSummaryV1";
import { requestAccountEngineSwitchV1 } from "../runtime/engineSwitchSignal";

export type AccountSubscriptionPanelProps = {
  readonly enabled?: boolean;
};

export function AccountSubscriptionPanel({
  enabled = true,
}: AccountSubscriptionPanelProps) {
  const summaryState = useAccountSubscriptionSummaryV1({ enabled });

  return (
    <AccountSubscriptionSummarySurface
      summary={summaryState.summary}
      loading={summaryState.loading}
      failure={summaryState.failure}
      onRetry={enabled ? summaryState.load : undefined}
      onSelectEngine={(engineId) =>
        requestAccountEngineSwitchV1({
          source: "accountCenter",
          targetEngineId: engineId,
          openNewConversation: true,
        })
      }
    />
  );
}

export type AccountSubscriptionSummarySurfaceProps = {
  readonly summary: AccountSubscriptionSummaryViewV1 | null;
  readonly loading: boolean;
  readonly failure: GatewayFailureV1 | null;
  readonly compact?: boolean;
  readonly onRetry?: () => void;
  readonly onSelectEngine?: (engineId: ManagedUsageEngineIdV1) => void;
  readonly accountLabel?: string | null;
  readonly onOpenAccount?: () => void;
};

/** Shared account facts surface used by the full account tab and sidebar popover. */
export function AccountSubscriptionSummarySurface({
  summary,
  loading,
  failure,
  compact = false,
  onRetry,
  onSelectEngine,
  accountLabel,
  onOpenAccount,
}: AccountSubscriptionSummarySurfaceProps) {
  const copy = useAccountExperienceCopyV1();
  const locale = useAccountExperienceLocaleV1();
  const subscriptions = useMemo(
    () => (summary?.status === "available" ? summary.subscriptions : []),
    [summary],
  );

  return (
    <div
      className={`account-subscription-panel${compact ? " account-subscription-panel--compact" : ""}`}
      data-summary-status={
        summary?.status ?? (failure ? "error" : loading ? "loading" : "unavailable")
      }
    >
      {accountLabel ? (
        <div className="account-summary-identity">
          <strong>{accountLabel}</strong>
        </div>
      ) : null}
      {loading ? (
        <div className="account-summary-state" role="status" aria-live="polite">
          <LoaderCircle className="account-spin" size={16} aria-hidden />
          <span>{copy.loading}</span>
        </div>
      ) : failure || summary?.status === "unavailable" || !summary ? (
        <div className="account-summary-state account-summary-state--warning" role="status">
          <span>{copy.usageUnavailable}</span>
          {onRetry ? (
            <button type="button" className="account-summary-retry" onClick={onRetry}>
              <RefreshCw size={14} aria-hidden />
              <span>{copy.retry}</span>
            </button>
          ) : null}
        </div>
      ) : subscriptions.length === 0 ? (
        <p className="account-empty-state">{copy.gateNoPlans}</p>
      ) : (
        <div
          className="account-subscription-list account-subscription-engine-list"
          data-columns={Math.min(subscriptions.length, 3)}
        >
          {subscriptions.map((subscription) => (
            <SubscriptionCard
              key={subscription.id}
              subscription={subscription}
              locale={locale}
              compact={compact}
              onSelectEngine={onSelectEngine}
            />
          ))}
        </div>
      )}
      {onOpenAccount ? (
        <button
          type="button"
          className="account-summary-open-account"
          onClick={onOpenAccount}
        >
          {copy.accountCenter}
        </button>
      ) : null}
    </div>
  );
}

function SubscriptionCard({
  subscription,
  locale,
  compact,
  onSelectEngine,
}: {
  readonly subscription: AccountSubscriptionSummaryItemV1;
  readonly locale: AccountExperienceLocaleV1;
  readonly compact: boolean;
  readonly onSelectEngine?: (engineId: ManagedUsageEngineIdV1) => void;
}) {
  const copy = useAccountExperienceCopyV1();
  const daily = subscription.windows.daily;
  const secondaryWindows = [
    [copy.usageWeek, subscription.windows.weekly],
    [copy.usageMonth, subscription.windows.monthly],
  ] as const;
  const hasSecondaryWindows = secondaryWindows.some(
    ([, window]) => window !== null,
  );
  const cardDetails = hasSecondaryWindows ? (
    <details className="account-subscription-card-windows">
      <summary>{copy.usage}</summary>
      <div>
        {secondaryWindows.map(([label, window]) =>
          window ? (
            <QuotaWindow
              key={label}
              label={label}
              window={window}
              locale={locale}
              copy={copy}
            />
          ) : null,
        )}
      </div>
    </details>
  ) : null;
  const cardContent = (
    <>
      <span className="account-subscription-card-heading">
        {subscription.engineId ? (
          <span className="account-subscription-card-engine">
            <span className="account-subscription-card-icon">
              <EngineIcon
                engine={subscription.engineId === "claude-code" ? "claude" : "codex"}
                size={compact ? 18 : 22}
              />
            </span>
            <strong>{subscription.engineLabel}</strong>
          </span>
        ) : null}
        <span className="account-subscription-card-plan">
          <strong>{subscription.subscriptionLabel}</strong>
          <small>
            {subscription.status === "active" ? copy.gateSubscribed : copy.available}
          </small>
        </span>
      </span>
      {daily ? (
        <span className="account-subscription-card-daily">
          <span>{copy.usageToday}</span>
          <strong>
            {formatQuotaMeasure(daily.used, locale, copy)} / {formatQuotaMeasure(daily.limit, locale, copy)}
          </strong>
        </span>
      ) : null}
      {subscription.expiresAt ? (
        <span className="account-subscription-card-expiry">
          {copy.usageExpiresAt} · {formatDate(subscription.expiresAt, locale)}
        </span>
      ) : null}
    </>
  );

  const engineId = subscription.engineId;
  if (engineId && onSelectEngine) {
    return (
      <article className="account-subscription-card account-subscription-engine-card">
        <button
          type="button"
          className="account-subscription-card-action"
          aria-label={`${subscription.engineLabel ?? copy.accountCenter}: ${subscription.subscriptionLabel}`}
          onClick={() => onSelectEngine(engineId)}
        >
          {cardContent}
        </button>
        {cardDetails}
      </article>
    );
  }
  return (
    <article className="account-subscription-card">
      {cardContent}
      {cardDetails}
    </article>
  );
}

function QuotaWindow({
  label,
  window,
  locale,
  copy,
}: {
  readonly label: string;
  readonly window: SubscriptionSummaryWindowV1;
  readonly locale: AccountExperienceLocaleV1;
  readonly copy: ReturnType<typeof useAccountExperienceCopyV1>;
}) {
  return (
    <div className="account-subscription-card-window">
      <span>{label}</span>
      <strong>
        {formatQuotaMeasure(window.used, locale, copy)} / {formatQuotaMeasure(window.limit, locale, copy)}
      </strong>
    </div>
  );
}

function formatQuotaMeasure(
  measure: QuotaMeasureV1,
  locale: AccountExperienceLocaleV1,
  copy: ReturnType<typeof useAccountExperienceCopyV1>,
): string {
  const amount = Number(measure.value);
  if (!Number.isFinite(amount)) return "—";
  if (measure.unit === "usd") {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: amount > 0 && amount < 0.01 ? 4 : 2,
      maximumFractionDigits: 4,
    }).format(amount);
  }
  const label = measure.unit === "requests"
    ? copy.usageRequests
    : measure.unit === "tokens"
      ? copy.usageTokens
      : measure.unit;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(amount)} ${label}`;
}

function formatDate(value: string, locale: AccountExperienceLocaleV1): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}
