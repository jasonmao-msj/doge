import {
  readAccountProductBillingV1,
  readAccountProductUsageV1,
} from "../../../services/accountProductCommands";
import type {
  EngineOnboardingFailureV1,
  EngineOnboardingResultV1,
} from "./engineOnboardingClient";

export const PRODUCT_USAGE_PERIODS_V1 = ["current", "previous"] as const;
export type ProductUsagePeriodV1 = (typeof PRODUCT_USAGE_PERIODS_V1)[number];

export type ProductUsageQuotaV1 = {
  readonly usedUsd: number;
  readonly limitUsd: number;
  readonly percentage: number;
  readonly resetsAt: string;
};

export type ProductUsageModelV1 = {
  readonly id: string;
  readonly displayName: string;
  readonly requests: number;
  readonly totalTokens: number;
  readonly standardCostUsd: number;
  readonly actualCostUsd: number;
};

export type ProductUsageDetailsV1 = {
  readonly period: ProductUsagePeriodV1;
  readonly fetchedAt: string;
  readonly range: {
    readonly queryStartDate: string;
    readonly queryEndDate: string;
    readonly periodStartDate: string;
    readonly periodEndDate: string;
    readonly resetsAt: string | null;
    readonly source: "subscriptionMonthly" | "rolling30Days";
  };
  readonly totals: {
    readonly requests: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cacheTokens: number;
    readonly totalTokens: number;
    readonly standardCostUsd: number;
    readonly actualCostUsd: number;
    readonly averageDurationMs: number;
  };
  readonly quota: ProductUsageQuotaV1 | null;
  readonly engineBreakdownStatus: "unsupported";
  readonly modelsStatus: "available" | "unavailable";
  readonly models: readonly ProductUsageModelV1[];
};

export type ProductBillingOrderV1 = {
  readonly id: number;
  readonly planName: string;
  readonly occurredAt: string;
  readonly amount: number;
  readonly currency: string;
  readonly status: "paid" | "pending" | "refunded" | "failed";
  readonly invoiceAvailable: false;
};

export type ProductBillingDetailsV1 = {
  readonly fetchedAt: string;
  readonly invoiceDownloadStatus: "unsupported";
  readonly orders: readonly ProductBillingOrderV1[];
};

export type ProductAccountDetailsClientV1 = {
  readonly usage: (
    period: ProductUsagePeriodV1,
  ) => Promise<EngineOnboardingResultV1<ProductUsageDetailsV1>>;
  readonly billing: () => Promise<EngineOnboardingResultV1<ProductBillingDetailsV1>>;
};

export function createProductAccountDetailsClientV1(): ProductAccountDetailsClientV1 {
  return {
    usage: async (period) => parseProductUsageDetails(
      await readAccountProductUsageV1(period),
    ),
    billing: async () => parseProductBillingDetails(
      await readAccountProductBillingV1(),
    ),
  };
}

export function parseProductUsageDetails(
  value: unknown,
): EngineOnboardingResultV1<ProductUsageDetailsV1> {
  const envelope = readEnvelope(value);
  if (!envelope.ok) return envelope;
  const root = asObject(envelope.value);
  const range = asObject(root?.range);
  const totals = asObject(root?.totals);
  const models = Array.isArray(root?.models) ? root.models.map(parseUsageModel) : null;
  if (
    !root ||
    !isUsagePeriod(root.period) ||
    !validTimestamp(root.fetched_at) ||
    !range ||
    !validDate(range.query_start_date) ||
    !validDate(range.query_end_date) ||
    !validDate(range.period_start_date) ||
    !validDate(range.period_end_date) ||
    (range.resets_at !== null && !validTimestamp(range.resets_at)) ||
    (range.source !== "subscriptionMonthly" && range.source !== "rolling30Days") ||
    !totals ||
    !nonNegativeInteger(totals.requests) ||
    !nonNegativeInteger(totals.input_tokens) ||
    !nonNegativeInteger(totals.output_tokens) ||
    !nonNegativeInteger(totals.cache_tokens) ||
    !nonNegativeInteger(totals.total_tokens) ||
    !finiteNonNegative(totals.standard_cost_usd) ||
    !finiteNonNegative(totals.actual_cost_usd) ||
    !finiteNonNegative(totals.average_duration_ms) ||
    root.engine_breakdown_status !== "unsupported" ||
    (root.models_status !== "available" && root.models_status !== "unavailable") ||
    models === null ||
    models.length > 12 ||
    models.some((model) => model === null)
  ) {
    return protocolFailure();
  }
  const quota = root.quota === null ? null : parseQuota(root.quota);
  if (root.quota !== null && quota === null) return protocolFailure();
  return {
    ok: true,
    value: {
      period: root.period,
      fetchedAt: root.fetched_at,
      range: {
        queryStartDate: range.query_start_date,
        queryEndDate: range.query_end_date,
        periodStartDate: range.period_start_date,
        periodEndDate: range.period_end_date,
        resetsAt: range.resets_at,
        source: range.source,
      },
      totals: {
        requests: totals.requests,
        inputTokens: totals.input_tokens,
        outputTokens: totals.output_tokens,
        cacheTokens: totals.cache_tokens,
        totalTokens: totals.total_tokens,
        standardCostUsd: totals.standard_cost_usd,
        actualCostUsd: totals.actual_cost_usd,
        averageDurationMs: totals.average_duration_ms,
      },
      quota,
      engineBreakdownStatus: "unsupported",
      modelsStatus: root.models_status,
      models: models as ProductUsageModelV1[],
    },
  };
}

export function parseProductBillingDetails(
  value: unknown,
): EngineOnboardingResultV1<ProductBillingDetailsV1> {
  const envelope = readEnvelope(value);
  if (!envelope.ok) return envelope;
  const root = asObject(envelope.value);
  const orders = Array.isArray(root?.orders) ? root.orders.map(parseBillingOrder) : null;
  if (
    !root ||
    !validTimestamp(root.fetched_at) ||
    root.invoice_download_status !== "unsupported" ||
    orders === null ||
    orders.length > 12 ||
    orders.some((order) => order === null)
  ) {
    return protocolFailure();
  }
  return {
    ok: true,
    value: {
      fetchedAt: root.fetched_at,
      invoiceDownloadStatus: "unsupported",
      orders: orders as ProductBillingOrderV1[],
    },
  };
}

function parseQuota(value: unknown): ProductUsageQuotaV1 | null {
  const quota = asObject(value);
  if (
    !quota ||
    !finiteNonNegative(quota.used_usd) ||
    !finitePositive(quota.limit_usd) ||
    !finitePercentage(quota.percentage) ||
    !validTimestamp(quota.resets_at)
  ) {
    return null;
  }
  return {
    usedUsd: quota.used_usd,
    limitUsd: quota.limit_usd,
    percentage: quota.percentage,
    resetsAt: quota.resets_at,
  };
}

function parseUsageModel(value: unknown): ProductUsageModelV1 | null {
  const model = asObject(value);
  if (
    !model ||
    !safeText(model.id, 128) ||
    !safeText(model.display_name, 128) ||
    !nonNegativeInteger(model.requests) ||
    !nonNegativeInteger(model.total_tokens) ||
    !finiteNonNegative(model.standard_cost_usd) ||
    !finiteNonNegative(model.actual_cost_usd)
  ) {
    return null;
  }
  return {
    id: model.id,
    displayName: model.display_name,
    requests: model.requests,
    totalTokens: model.total_tokens,
    standardCostUsd: model.standard_cost_usd,
    actualCostUsd: model.actual_cost_usd,
  };
}

function parseBillingOrder(value: unknown): ProductBillingOrderV1 | null {
  const order = asObject(value);
  const statuses = ["paid", "pending", "refunded", "failed"] as const;
  if (
    !order ||
    !positiveInteger(order.id) ||
    !safeText(order.plan_name, 160) ||
    !validTimestamp(order.occurred_at) ||
    !finiteNonNegative(order.amount) ||
    !safeCurrency(order.currency) ||
    !statuses.includes(order.status as (typeof statuses)[number]) ||
    order.invoice_available !== false
  ) {
    return null;
  }
  return {
    id: order.id,
    planName: order.plan_name,
    occurredAt: order.occurred_at,
    amount: order.amount,
    currency: order.currency,
    status: order.status as ProductBillingOrderV1["status"],
    invoiceAvailable: false,
  };
}

function readEnvelope(value: unknown): EngineOnboardingResultV1<unknown> {
  const envelope = asObject(value);
  if (!envelope || typeof envelope.ok !== "boolean") return protocolFailure();
  if (envelope.ok) return { ok: true, value: envelope.value };
  const error = asObject(envelope.error);
  const recovery = asObject(error?.recovery);
  return {
    ok: false,
    error: {
      code: typeof error?.code === "string" ? error.code : "serviceUnavailable",
      ...(typeof recovery?.afterMs === "number" ? { retryAfterMs: recovery.afterMs } : {}),
    } as EngineOnboardingFailureV1,
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isUsagePeriod(value: unknown): value is ProductUsagePeriodV1 {
  return PRODUCT_USAGE_PERIODS_V1.includes(value as ProductUsagePeriodV1);
}

function safeText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim() !== "" && value.length <= maxLength &&
    !Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    });
}

function safeCurrency(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9]{1,12}$/u.test(value);
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  return !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && !Number.isNaN(Date.parse(value));
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function finitePositive(value: unknown): value is number {
  return finiteNonNegative(value) && value > 0;
}

function finitePercentage(value: unknown): value is number {
  return finiteNonNegative(value) && value <= 100;
}

function protocolFailure(): EngineOnboardingResultV1<never> {
  return { ok: false, error: { code: "protocolMismatch" } };
}
