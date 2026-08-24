import BadgeDollarSign from "lucide-react/dist/esm/icons/badge-dollar-sign";
import Box from "lucide-react/dist/esm/icons/box";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import Clock3 from "lucide-react/dist/esm/icons/clock-3";
import FileText from "lucide-react/dist/esm/icons/file-text";
import Globe2 from "lucide-react/dist/esm/icons/globe-2";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import { useId, useState, type ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../components/ui/tooltip";
import { EngineIcon } from "../../engine/components/EngineIcon";
import {
  groupProductModelsForDisplay,
  productModelVendorBrand,
  type ProductModelVendorGroup,
  type ProductModelVendorGroupId,
} from "../../vendors/productModelGrouping";
import {
  PROVIDER_BRAND_ICON_SRC,
  providerBrandIconNeedsDarkTile,
  resolveProviderBrandIcon,
} from "../../vendors/providerBrandIcon";
import type { ProductAccountDetailsStateV1 } from "../hooks/useProductAccountDetails";
import {
  useAccountExperienceCopyV1,
  useAccountExperienceLocaleV1,
  type AccountExperienceLocaleV1,
} from "../hooks/useAccountExperienceCopy";
import type { ProductEntitlementSnapshotV1 } from "../runtime/productEntitlementStore";
import type {
  ProductBillingOrderV1,
  ProductUsageDetailsV1,
  ProductUsageModelV1,
} from "../runtime/productAccountDetailsClient";

export type ProductAccountDetailsProps = {
  readonly details: ProductAccountDetailsStateV1;
  readonly product: ProductEntitlementSnapshotV1;
};

export function ProductAccountDetails({
  details,
  product,
}: ProductAccountDetailsProps) {
  return (
    <div className="account-product-details">
      <ProductUsageSection details={details} product={product} />
      <ProductBillingSection details={details} />
      <ProductSubscriptionDetails product={product} />
    </div>
  );
}

function ProductUsageSection({
  details,
  product,
}: ProductAccountDetailsProps) {
  const copy = useAccountExperienceCopyV1();
  const locale = useAccountExperienceLocaleV1();
  const usage = details.usage;
  return (
    <section className="account-detail-card account-detail-usage" aria-labelledby="account-usage-title">
      <div className="account-detail-card-head">
        <h2 id="account-usage-title">{copy.accountUsageTitle}</h2>
        <div className="account-period-tabs" role="tablist" aria-label={copy.accountUsagePeriod}>
          <button
            type="button"
            role="tab"
            aria-selected={details.selectedPeriod === "current"}
            data-active={details.selectedPeriod === "current" ? "true" : "false"}
            onClick={() => details.selectPeriod("current")}
          >
            {copy.accountUsageCurrent}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={details.selectedPeriod === "previous"}
            data-active={details.selectedPeriod === "previous" ? "true" : "false"}
            onClick={() => details.selectPeriod("previous")}
          >
            {copy.accountUsagePrevious}
          </button>
        </div>
      </div>
      {usage.value ? (
        <UsageContent
          usage={usage.value}
          engines={product.engines}
          locale={locale}
          refreshing={usage.loading}
        />
      ) : usage.loading ? (
        <UsageSkeleton label={copy.accountUsageLoading} />
      ) : (
        <SectionFailure
          message={copy.accountUsageUnavailable}
          retryLabel={copy.retry}
          onRetry={details.refreshUsage}
        />
      )}
      {usage.failure && usage.value ? (
        <InlineRefreshFailure message={copy.accountUsageRefreshFailed} />
      ) : null}
    </section>
  );
}

function UsageContent({
  usage,
  engines,
  locale,
  refreshing,
}: {
  readonly usage: ProductUsageDetailsV1;
  readonly engines: ProductEntitlementSnapshotV1["engines"];
  readonly locale: AccountExperienceLocaleV1;
  readonly refreshing: boolean;
}) {
  const copy = useAccountExperienceCopyV1();
  const rangeLabel = formatDateRange(
    usage.range.periodStartDate,
    usage.range.periodEndDate,
    locale,
  );
  const maxModelRequests = Math.max(0, ...usage.models.map((model) => model.requests));
  return (
    <div className="account-usage-content" data-refreshing={refreshing ? "true" : "false"}>
      <div className="account-usage-stat-grid">
        <UsageStat
          tone="blue"
          icon={<FileText aria-hidden />}
          label={copy.accountUsageTotalRequests}
          value={formatInteger(usage.totals.requests, locale)}
          detail={rangeLabel}
        />
        <UsageStat
          tone="orange"
          icon={<Box aria-hidden />}
          label={copy.accountUsageTotalTokens}
          value={formatCompact(usage.totals.totalTokens, locale)}
          detail={`${copy.usageInputTokens} ${formatCompact(usage.totals.inputTokens, locale)} · ${copy.usageOutputTokens} ${formatCompact(usage.totals.outputTokens, locale)} · ${copy.usageCacheTokens} ${formatCompact(usage.totals.cacheTokens, locale)}`}
        />
        <UsageStat
          tone="green"
          icon={<BadgeDollarSign aria-hidden />}
          label={copy.accountUsageTotalSpend}
          value={formatUsd(usage.totals.actualCostUsd, locale, 4)}
          detail={`${copy.accountUsageStandard} ${formatUsd(usage.totals.standardCostUsd, locale, 4)}`}
          valueClassName="account-usage-stat-value--spend"
        />
        <UsageStat
          tone="purple"
          icon={<Clock3 aria-hidden />}
          label={copy.accountUsageAverageDuration}
          value={formatDuration(usage.totals.averageDurationMs, locale)}
          detail={usage.range.source === "rolling30Days" ? copy.accountUsageRollingRange : null}
        />
      </div>

      {usage.quota ? (
        <div className="account-quota-block">
          <span
            className="account-quota-meter"
            role="progressbar"
            aria-label={`${copy.accountUsageQuota} ${Math.round(usage.quota.percentage)}%`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(usage.quota.percentage)}
          >
            <i style={{ width: `${usage.quota.percentage}%` }} />
          </span>
          <div className="account-quota-meta">
            <span>
              {copy.accountUsageQuota} {formatUsd(usage.quota.usedUsd, locale)} / {formatUsd(usage.quota.limitUsd, locale)} · {rangeLabel}
            </span>
            <time dateTime={usage.quota.resetsAt}>
              {copy.resetsAt} {formatDateTime(usage.quota.resetsAt, locale)}
            </time>
          </div>
        </div>
      ) : (
        <p className="account-detail-note">
          {usage.period === "previous"
            ? copy.accountUsageHistoricalQuotaUnavailable
            : copy.accountUsageQuotaUnavailable}
        </p>
      )}

      <div className="account-usage-group-label">{copy.accountUsageByEngine}</div>
      <div className="account-usage-breakdown" data-kind="engine">
        {engines.map((engine) => (
          <div className="account-usage-breakdown-row" key={engine.id}>
            <span className="account-usage-breakdown-name">
              <EngineIcon
                engine={engine.id === "claude-code" ? "claude" : engine.id}
                size={17}
              />
              <span>{engine.displayName}</span>
            </span>
            <span className="account-usage-breakdown-track" aria-hidden />
            <span className="account-usage-breakdown-value">—</span>
          </div>
        ))}
        <p className="account-usage-breakdown-explanation">
          {copy.accountUsageEngineUnavailable}
        </p>
      </div>

      <div className="account-usage-group-label">{copy.accountUsageModelTop}</div>
      {usage.modelsStatus === "available" && usage.models.length > 0 ? (
        <div className="account-usage-breakdown" data-kind="model">
          {usage.models.map((model) => (
            <ModelUsageRow
              key={model.id}
              model={model}
              maxRequests={maxModelRequests}
              locale={locale}
            />
          ))}
        </div>
      ) : (
        <p className="account-detail-note">
          {usage.modelsStatus === "unavailable"
            ? copy.accountUsageModelsUnavailable
            : copy.accountUsageNoActivity}
        </p>
      )}
    </div>
  );
}

function UsageStat({
  tone,
  icon,
  label,
  value,
  detail,
  valueClassName,
}: {
  readonly tone: "blue" | "orange" | "green" | "purple";
  readonly icon: ReactNode;
  readonly label: string;
  readonly value: string;
  readonly detail: string | null;
  readonly valueClassName?: string;
}) {
  return (
    <article className="account-usage-stat">
      <span className="account-usage-stat-icon" data-tone={tone}>{icon}</span>
      <span className="account-usage-stat-copy">
        <small>{label}</small>
        <strong className={valueClassName}>{value}</strong>
        {detail ? <span title={detail}>{detail}</span> : null}
      </span>
    </article>
  );
}

function ModelUsageRow({
  model,
  maxRequests,
  locale,
}: {
  readonly model: ProductUsageModelV1;
  readonly maxRequests: number;
  readonly locale: AccountExperienceLocaleV1;
}) {
  const copy = useAccountExperienceCopyV1();
  const icon = [model.id, model.displayName]
    .map((identity) => resolveProviderBrandIcon({ modelId: identity }))
    .find((candidate) => candidate !== null) ?? null;
  const width = maxRequests > 0 ? Math.max(2, (model.requests / maxRequests) * 100) : 0;
  return (
    <div className="account-usage-breakdown-row">
      <span className="account-usage-breakdown-name">
        <BrandIcon src={icon} alt="" />
        <span title={model.displayName}>{model.displayName}</span>
      </span>
      <span className="account-usage-breakdown-track" aria-hidden>
        <i style={{ width: `${width}%` }} />
      </span>
      <span className="account-usage-breakdown-value">
        {formatInteger(model.requests, locale)} {copy.usageRequests}
      </span>
    </div>
  );
}

function ProductBillingSection({
  details,
}: {
  readonly details: ProductAccountDetailsStateV1;
}) {
  const copy = useAccountExperienceCopyV1();
  const locale = useAccountExperienceLocaleV1();
  const billing = details.billing;
  return (
    <section className="account-detail-card" aria-labelledby="account-billing-title">
      <div className="account-detail-card-head">
        <h2 id="account-billing-title">{copy.accountBillingTitle}</h2>
        {billing.value ? (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="account-detail-section-refresh"
                aria-label={copy.accountBillingRefresh}
                aria-busy={billing.loading}
                disabled={billing.loading}
                onClick={() => void details.refreshBilling()}
              >
                <RefreshCw className={billing.loading ? "account-spin" : ""} aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={8}>
              {copy.accountBillingRefresh}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      {billing.value ? (
        billing.value.orders.length > 0 ? (
          <div className="account-billing-list">
            {billing.value.orders.map((order) => (
              <BillingOrderRow key={order.id} order={order} locale={locale} />
            ))}
          </div>
        ) : (
          <p className="account-detail-empty">{copy.accountBillingEmpty}</p>
        )
      ) : billing.loading ? (
        <BillingSkeleton label={copy.accountBillingLoading} />
      ) : (
        <SectionFailure
          message={copy.accountBillingUnavailable}
          retryLabel={copy.retry}
          onRetry={details.refreshBilling}
        />
      )}
      {billing.failure && billing.value ? (
        <InlineRefreshFailure message={copy.accountBillingRefreshFailed} />
      ) : null}
    </section>
  );
}

function BillingOrderRow({
  order,
  locale,
}: {
  readonly order: ProductBillingOrderV1;
  readonly locale: AccountExperienceLocaleV1;
}) {
  const copy = useAccountExperienceCopyV1();
  const status = {
    paid: copy.accountBillingPaid,
    pending: copy.accountBillingPending,
    refunded: copy.accountBillingRefunded,
    failed: copy.accountBillingFailed,
  }[order.status];
  return (
    <div className="account-billing-row" data-status={order.status}>
      <time dateTime={order.occurredAt}>{formatDate(order.occurredAt, locale)}</time>
      <span title={order.planName}>{order.planName}</span>
      <strong>{formatCurrency(order.amount, order.currency, locale)}</strong>
      <small>{status}</small>
    </div>
  );
}

function ProductSubscriptionDetails({
  product,
}: {
  readonly product: ProductEntitlementSnapshotV1;
}) {
  const copy = useAccountExperienceCopyV1();
  const locale = useAccountExperienceLocaleV1();
  const entitlement = product.entitlement;
  const groups = groupProductModelsForDisplay(product.models);
  return (
    <section className="account-detail-card" aria-labelledby="account-subscription-title">
      <div className="account-detail-card-head account-subscription-detail-head">
        <div>
          <h2 id="account-subscription-title">{copy.accountSubscriptionTitle}</h2>
          <p>{entitlement?.planName ?? copy.accountSubscriptionUnavailable}</p>
        </div>
        {entitlement?.expiresAt ? (
          <time dateTime={entitlement.expiresAt}>
            {copy.usageExpiresAt} {formatDate(entitlement.expiresAt, locale)}
          </time>
        ) : null}
      </div>
      <div className="account-subscription-model-heading">
        <strong>{copy.accountAvailableModels}</strong>
        <span>{formatInteger(product.models.length, locale)}</span>
      </div>
      {groups.length > 0 ? (
        <div className="account-subscription-model-groups">
          {groups.map((group) => (
            <ProductSubscriptionModelGroup
              key={group.id}
              group={group}
              locale={locale}
            />
          ))}
        </div>
      ) : (
        <p className="account-detail-empty">{copy.accountModelsUnavailable}</p>
      )}
    </section>
  );
}

function ProductSubscriptionModelGroup({
  group,
  locale,
}: {
  readonly group: ProductModelVendorGroup<
    ProductEntitlementSnapshotV1["models"][number]
  >;
  readonly locale: AccountExperienceLocaleV1;
}) {
  const copy = useAccountExperienceCopyV1();
  const listId = useId();
  const [expanded, setExpanded] = useState(false);
  const vendor = productModelVendorBrand(group.id);
  const icon = vendor ? PROVIDER_BRAND_ICON_SRC[vendor] : null;
  const vendorLabel = productVendorLabel(group.id, copy);
  const countLabel = copy.accountModelCountTemplate.replace(
    "{count}",
    formatInteger(group.models.length, locale),
  );
  const actionLabel = (
    expanded
      ? copy.accountModelGroupCollapseTemplate
      : copy.accountModelGroupExpandTemplate
  ).replace("{vendor}", vendorLabel);

  return (
    <div
      className="account-subscription-model-group"
      data-expanded={expanded ? "true" : "false"}
    >
      <button
        type="button"
        className="account-subscription-model-group-trigger"
        aria-label={actionLabel}
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setExpanded((current) => !current)}
      >
        <BrandIcon src={icon} alt="" />
        <strong>{vendorLabel}</strong>
        <span>{countLabel}</span>
        <ChevronDown aria-hidden />
      </button>
      {expanded ? (
        <ul id={listId} className="account-subscription-model-list">
          {group.models.map((model) => (
            <li key={model.id}>{model.displayName}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function productVendorLabel(
  id: ProductModelVendorGroupId,
  copy: ReturnType<typeof useAccountExperienceCopyV1>,
): string {
  return {
    openai: copy.productVendorOpenAI,
    anthropic: copy.productVendorAnthropic,
    doubao: copy.productVendorDoubao,
    kimi: copy.productVendorKimi,
    zhipu: copy.productVendorZhipu,
    deepseek: copy.productVendorDeepSeek,
    bailian: copy.productVendorBailian,
    minimax: copy.productVendorMiniMax,
    xiaomi: copy.productVendorXiaomi,
    longcat: copy.productVendorLongCat,
    opencode: copy.productVendorOpenCode,
    openrouter: copy.productVendorOpenRouter,
    other: copy.productVendorOther,
  }[id];
}

function BrandIcon({ src, alt }: { readonly src: string | null; readonly alt: string }) {
  if (!src) return <Globe2 className="account-brand-icon-fallback" aria-hidden />;
  return (
    <span
      className="account-brand-icon"
      data-dark-tile={providerBrandIconNeedsDarkTile(src) ? "true" : "false"}
    >
      <img src={src} alt={alt} aria-hidden={alt === ""} />
    </span>
  );
}

function UsageSkeleton({ label }: { readonly label: string }) {
  return (
    <div className="account-detail-skeleton" role="status" aria-label={label}>
      <span className="account-skeleton-stat-grid">
        {Array.from({ length: 4 }, (_, index) => <i key={index} />)}
      </span>
      <i className="account-skeleton-meter" />
      <span className="account-skeleton-rows">
        {Array.from({ length: 5 }, (_, index) => <i key={index} />)}
      </span>
    </div>
  );
}

function BillingSkeleton({ label }: { readonly label: string }) {
  return (
    <div className="account-billing-skeleton" role="status" aria-label={label}>
      {Array.from({ length: 3 }, (_, index) => <i key={index} />)}
    </div>
  );
}

function SectionFailure({
  message,
  retryLabel,
  onRetry,
}: {
  readonly message: string;
  readonly retryLabel: string;
  readonly onRetry: () => Promise<void>;
}) {
  return (
    <div className="account-detail-failure" role="alert">
      <span>{message}</span>
      <button type="button" onClick={() => void onRetry()}>{retryLabel}</button>
    </div>
  );
}

function InlineRefreshFailure({ message }: { readonly message: string }) {
  return <p className="account-detail-inline-failure" role="status">{message}</p>;
}

function formatInteger(value: number, locale: AccountExperienceLocaleV1): string {
  return new Intl.NumberFormat(locale).format(value);
}

function formatCompact(value: number, locale: AccountExperienceLocaleV1): string {
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatUsd(
  value: number,
  locale: AccountExperienceLocaleV1,
  maximumFractionDigits = 2,
): string {
  return formatCurrency(value, "USD", locale, maximumFractionDigits);
}

function formatCurrency(
  value: number,
  currency: string,
  locale: AccountExperienceLocaleV1,
  maximumFractionDigits = 2,
): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
      maximumFractionDigits,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(maximumFractionDigits)}`;
  }
}

function formatDuration(value: number, locale: AccountExperienceLocaleV1): string {
  if (value >= 1_000) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1_000)}s`;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value)}ms`;
}

function formatDateRange(
  start: string,
  end: string,
  locale: AccountExperienceLocaleV1,
): string {
  const formatter = new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    timeZone: "UTC",
  });
  return `${formatter.format(new Date(`${start}T00:00:00Z`))} – ${formatter.format(new Date(`${end}T00:00:00Z`))}`;
}

function formatDate(value: string, locale: AccountExperienceLocaleV1): string {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "UTC",
  }).format(new Date(value.length === 10 ? `${value}T00:00:00Z` : value));
}

function formatDateTime(value: string, locale: AccountExperienceLocaleV1): string {
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
