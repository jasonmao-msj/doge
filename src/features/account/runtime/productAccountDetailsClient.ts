import {
  readAccountProductBillingV1,
  readAccountProductUsageV1,
  type AccountProductUsageQueryV1,
} from "../../../services/accountProductCommands";
import type {
  EngineOnboardingFailureV1,
  EngineOnboardingResultV1,
} from "./onboardingTypes";

export const PRODUCT_USAGE_GRANULARITIES_V1 = ["day", "hour"] as const;
export type ProductUsageGranularityV1 =
  (typeof PRODUCT_USAGE_GRANULARITIES_V1)[number];

export type ProductUsageQueryV1 = AccountProductUsageQueryV1;

export type ProductUsageModelV1 = {
  readonly id: string;
  readonly displayName: string;
  readonly requests: number;
  readonly totalTokens: number;
  readonly standardCostUsd: number;
  readonly actualCostUsd: number;
};

export type ProductUsageTrendPointV1 = {
  readonly bucket: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationTokens: number;
  readonly cacheReadTokens: number;
  readonly totalTokens: number;
  readonly standardCostUsd: number;
  readonly actualCostUsd: number;
};

export type ProductUsageDetailsV1 = {
  readonly query: ProductUsageQueryV1;
  readonly fetchedAt: string;
  readonly range: {
    readonly queryStartDate: string;
    readonly queryEndDate: string;
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
  readonly trendStatus: "available" | "unavailable";
  readonly trend: readonly ProductUsageTrendPointV1[];
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
};

export type ProductBillingDetailsV1 = {
  readonly fetchedAt: string;
  readonly orders: readonly ProductBillingOrderV1[];
};

export type ProductAccountDetailsClientV1 = {
  readonly usage: (
    query: ProductUsageQueryV1,
  ) => Promise<EngineOnboardingResultV1<ProductUsageDetailsV1>>;
  readonly billing: () => Promise<EngineOnboardingResultV1<ProductBillingDetailsV1>>;
};

export function createDefaultProductUsageQueryV1(
  now = new Date(),
): ProductUsageQueryV1 {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  return {
    startDate: formatLocalDate(start),
    endDate: formatLocalDate(end),
    granularity: "day",
  };
}

export function productUsageQueryKeyV1(query: ProductUsageQueryV1): string {
  return `${query.startDate}:${query.endDate}:${query.granularity}`;
}

export function createProductAccountDetailsClientV1(): ProductAccountDetailsClientV1 {
  return {
    usage: async (query) => parseProductUsageDetails(
      await readAccountProductUsageV1(query),
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
  const query = asObject(root?.query);
  const range = asObject(root?.range);
  const totals = asObject(root?.totals);
  const trend = Array.isArray(root?.trend) ? root.trend.map(parseUsageTrendPoint) : null;
  const models = Array.isArray(root?.models) ? root.models.map(parseUsageModel) : null;
  if (
    !root ||
    !query ||
    !validDate(query.start_date) ||
    !validDate(query.end_date) ||
    !isUsageGranularity(query.granularity) ||
    !validTimestamp(root.fetched_at) ||
    !range ||
    !validDate(range.query_start_date) ||
    !validDate(range.query_end_date) ||
    range.query_start_date !== query.start_date ||
    range.query_end_date !== query.end_date ||
    query.start_date > query.end_date ||
    !totals ||
    !nonNegativeInteger(totals.requests) ||
    !nonNegativeInteger(totals.input_tokens) ||
    !nonNegativeInteger(totals.output_tokens) ||
    !nonNegativeInteger(totals.cache_tokens) ||
    !nonNegativeInteger(totals.total_tokens) ||
    !finiteNonNegative(totals.standard_cost_usd) ||
    !finiteNonNegative(totals.actual_cost_usd) ||
    !finiteNonNegative(totals.average_duration_ms) ||
    (root.trend_status !== "available" && root.trend_status !== "unavailable") ||
    trend === null ||
    trend.length > 800 ||
    trend.some((point) => point === null) ||
    (root.models_status !== "available" && root.models_status !== "unavailable") ||
    models === null ||
    models.length > 12 ||
    models.some((model) => model === null)
  ) {
    return protocolFailure();
  }
  return {
    ok: true,
    value: {
      query: {
        startDate: query.start_date,
        endDate: query.end_date,
        granularity: query.granularity,
      },
      fetchedAt: root.fetched_at,
      range: {
        queryStartDate: range.query_start_date,
        queryEndDate: range.query_end_date,
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
      trendStatus: root.trend_status,
      trend: trend as ProductUsageTrendPointV1[],
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
      orders: orders as ProductBillingOrderV1[],
    },
  };
}

function parseUsageTrendPoint(value: unknown): ProductUsageTrendPointV1 | null {
  const point = asObject(value);
  if (
    !point ||
    !safeText(point.bucket, 32) ||
    !nonNegativeInteger(point.input_tokens) ||
    !nonNegativeInteger(point.output_tokens) ||
    !nonNegativeInteger(point.cache_creation_tokens) ||
    !nonNegativeInteger(point.cache_read_tokens) ||
    !nonNegativeInteger(point.total_tokens) ||
    !finiteNonNegative(point.standard_cost_usd) ||
    !finiteNonNegative(point.actual_cost_usd)
  ) {
    return null;
  }
  return {
    bucket: point.bucket,
    inputTokens: point.input_tokens,
    outputTokens: point.output_tokens,
    cacheCreationTokens: point.cache_creation_tokens,
    cacheReadTokens: point.cache_read_tokens,
    totalTokens: point.total_tokens,
    standardCostUsd: point.standard_cost_usd,
    actualCostUsd: point.actual_cost_usd,
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
    !statuses.includes(order.status as (typeof statuses)[number])
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

function isUsageGranularity(value: unknown): value is ProductUsageGranularityV1 {
  return PRODUCT_USAGE_GRANULARITIES_V1.includes(
    value as ProductUsageGranularityV1,
  );
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
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function formatLocalDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function protocolFailure(): EngineOnboardingResultV1<never> {
  return { ok: false, error: { code: "protocolMismatch" } };
}
