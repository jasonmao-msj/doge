import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createProductAccountDetailsClientV1,
  type ProductAccountDetailsClientV1,
  type ProductBillingDetailsV1,
  type ProductUsageDetailsV1,
  type ProductUsagePeriodV1,
} from "../runtime/productAccountDetailsClient";
import { useProductEntitlementSnapshotV1 } from "../runtime/productEntitlementStore";
import type { EngineOnboardingFailureV1 } from "../runtime/engineOnboardingClient";

export type ProductDetailsResourceV1<Value> = {
  readonly value: Value | null;
  readonly loading: boolean;
  readonly failure: EngineOnboardingFailureV1 | null;
};

export type ProductAccountDetailsStateV1 = {
  readonly selectedPeriod: ProductUsagePeriodV1;
  readonly usage: ProductDetailsResourceV1<ProductUsageDetailsV1>;
  readonly billing: ProductDetailsResourceV1<ProductBillingDetailsV1>;
  readonly refreshing: boolean;
  readonly lastUpdatedAt: string | null;
  readonly selectPeriod: (period: ProductUsagePeriodV1) => void;
  readonly refreshUsage: () => Promise<void>;
  readonly refreshBilling: () => Promise<void>;
  readonly refreshAll: () => Promise<void>;
};

const EMPTY_RESOURCE = Object.freeze({
  value: null,
  loading: false,
  failure: null,
});

const INITIAL_USAGE_RESOURCES: Record<
  ProductUsagePeriodV1,
  ProductDetailsResourceV1<ProductUsageDetailsV1>
> = {
  current: EMPTY_RESOURCE,
  previous: EMPTY_RESOURCE,
};

export function useProductAccountDetailsV1(
  injectedClient?: ProductAccountDetailsClientV1,
): ProductAccountDetailsStateV1 {
  const client = useMemo(
    () => injectedClient ?? createProductAccountDetailsClientV1(),
    [injectedClient],
  );
  const product = useProductEntitlementSnapshotV1();
  const productIdentity = product.status === "ready"
    ? `${product.entitlement?.subscriptionId ?? "none"}:${product.entitlement?.groupId ?? "none"}`
    : null;
  const [selectedPeriod, setSelectedPeriod] = useState<ProductUsagePeriodV1>("current");
  const [usageResources, setUsageResources] = useState(INITIAL_USAGE_RESOURCES);
  const [billing, setBilling] = useState<
    ProductDetailsResourceV1<ProductBillingDetailsV1>
  >(EMPTY_RESOURCE);
  const usageGenerations = useRef<Record<ProductUsagePeriodV1, number>>({
    current: 0,
    previous: 0,
  });
  const billingGeneration = useRef(0);
  const usageInFlight = useRef<Partial<Record<ProductUsagePeriodV1, Promise<void>>>>({});
  const billingInFlight = useRef<Promise<void> | null>(null);

  const loadUsage = useCallback((period: ProductUsagePeriodV1): Promise<void> => {
    const existing = usageInFlight.current[period];
    if (existing) return existing;
    const generation = usageGenerations.current[period] + 1;
    usageGenerations.current[period] = generation;
    setUsageResources((current) => ({
      ...current,
      [period]: { ...current[period], loading: true, failure: null },
    }));
    const request = client.usage(period)
      .catch(() => ({
        ok: false as const,
        error: { code: "serviceUnavailable" },
      }))
      .then((result) => {
        if (usageGenerations.current[period] !== generation) return;
        setUsageResources((current) => ({
          ...current,
          [period]: result.ok
            ? { value: result.value, loading: false, failure: null }
            : { ...current[period], loading: false, failure: result.error },
        }));
      })
      .finally(() => {
        if (usageInFlight.current[period] === request) {
          delete usageInFlight.current[period];
        }
      });
    usageInFlight.current[period] = request;
    return request;
  }, [client]);

  const loadBilling = useCallback((): Promise<void> => {
    if (billingInFlight.current) return billingInFlight.current;
    const generation = billingGeneration.current + 1;
    billingGeneration.current = generation;
    setBilling((current) => ({ ...current, loading: true, failure: null }));
    const request = client.billing()
      .catch(() => ({
        ok: false as const,
        error: { code: "serviceUnavailable" },
      }))
      .then((result) => {
        if (billingGeneration.current !== generation) return;
        setBilling((current) => result.ok
          ? { value: result.value, loading: false, failure: null }
          : { ...current, loading: false, failure: result.error });
      })
      .finally(() => {
        if (billingInFlight.current === request) billingInFlight.current = null;
      });
    billingInFlight.current = request;
    return request;
  }, [client]);

  useEffect(() => {
    usageGenerations.current.current += 1;
    usageGenerations.current.previous += 1;
    billingGeneration.current += 1;
    usageInFlight.current = {};
    billingInFlight.current = null;
    setSelectedPeriod("current");
    setUsageResources(INITIAL_USAGE_RESOURCES);
    setBilling(EMPTY_RESOURCE);
    if (productIdentity) {
      void loadUsage("current");
      void loadBilling();
    }
  }, [loadBilling, loadUsage, productIdentity]);

  useEffect(() => {
    const selected = usageResources[selectedPeriod];
    if (productIdentity && !selected.value && !selected.loading && !selected.failure) {
      void loadUsage(selectedPeriod);
    }
  }, [loadUsage, productIdentity, selectedPeriod, usageResources]);

  useEffect(() => () => {
    usageGenerations.current.current += 1;
    usageGenerations.current.previous += 1;
    billingGeneration.current += 1;
  }, []);

  const selectedUsage = usageResources[selectedPeriod];
  const usage = productIdentity && !selectedUsage.value && !selectedUsage.failure
    ? { ...selectedUsage, loading: true }
    : selectedUsage;
  const visibleBilling = productIdentity && !billing.value && !billing.failure
    ? { ...billing, loading: true }
    : billing;
  const lastUpdatedAt = [usage.value?.fetchedAt, visibleBilling.value?.fetchedAt]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;

  return {
    selectedPeriod,
    usage,
    billing: visibleBilling,
    refreshing: usage.loading || visibleBilling.loading,
    lastUpdatedAt,
    selectPeriod: setSelectedPeriod,
    refreshUsage: () => loadUsage(selectedPeriod),
    refreshBilling: loadBilling,
    refreshAll: async () => {
      await Promise.all([loadUsage(selectedPeriod), loadBilling()]);
    },
  };
}
