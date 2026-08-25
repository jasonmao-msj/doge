import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createDefaultProductUsageQueryV1,
  createProductAccountDetailsClientV1,
  productUsageQueryKeyV1,
  type ProductAccountDetailsClientV1,
  type ProductBillingDetailsV1,
  type ProductUsageDetailsV1,
  type ProductUsageQueryV1,
} from "../runtime/productAccountDetailsClient";
import { useProductEntitlementSnapshotV1 } from "../runtime/productEntitlementStore";
import type { EngineOnboardingFailureV1 } from "../runtime/onboardingTypes";

export type ProductDetailsResourceV1<Value> = {
  readonly value: Value | null;
  readonly loading: boolean;
  readonly failure: EngineOnboardingFailureV1 | null;
};

export type ProductAccountDetailsStateV1 = {
  readonly selectedUsageQuery: ProductUsageQueryV1;
  readonly usage: ProductDetailsResourceV1<ProductUsageDetailsV1>;
  readonly billing: ProductDetailsResourceV1<ProductBillingDetailsV1>;
  readonly refreshing: boolean;
  readonly lastUpdatedAt: string | null;
  readonly selectUsageQuery: (query: ProductUsageQueryV1) => void;
  readonly refreshUsage: () => Promise<void>;
  readonly refreshBilling: () => Promise<void>;
  readonly refreshAll: () => Promise<void>;
};

const EMPTY_RESOURCE = Object.freeze({
  value: null,
  loading: false,
  failure: null,
});

type OwnedUsageResourceV1 = {
  readonly key: string | null;
  readonly resource: ProductDetailsResourceV1<ProductUsageDetailsV1>;
};

const EMPTY_OWNED_USAGE: OwnedUsageResourceV1 = Object.freeze({
  key: null,
  resource: EMPTY_RESOURCE,
});

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
  const [selectedUsageQuery, setSelectedUsageQuery] =
    useState<ProductUsageQueryV1>(createDefaultProductUsageQueryV1);
  const selectedUsageKey = productUsageQueryKeyV1(selectedUsageQuery);
  const selectedUsageKeyRef = useRef(selectedUsageKey);
  selectedUsageKeyRef.current = selectedUsageKey;
  const [ownedUsage, setOwnedUsage] = useState(EMPTY_OWNED_USAGE);
  const [billing, setBilling] = useState<
    ProductDetailsResourceV1<ProductBillingDetailsV1>
  >(EMPTY_RESOURCE);
  const usageGeneration = useRef(0);
  const billingGeneration = useRef(0);
  const usageInFlight = useRef<{
    readonly key: string;
    readonly request: Promise<void>;
  } | null>(null);
  const billingInFlight = useRef<Promise<void> | null>(null);

  const loadUsage = useCallback((query: ProductUsageQueryV1): Promise<void> => {
    const key = productUsageQueryKeyV1(query);
    if (usageInFlight.current?.key === key) return usageInFlight.current.request;
    const generation = usageGeneration.current + 1;
    usageGeneration.current = generation;
    setOwnedUsage((current) => ({
      key,
      resource: current.key === key
        ? { ...current.resource, loading: true, failure: null }
        : { value: null, loading: true, failure: null },
    }));
    const request = client.usage(query)
      .catch(() => ({
        ok: false as const,
        error: { code: "serviceUnavailable" },
      }))
      .then((result) => {
        if (
          usageGeneration.current !== generation ||
          selectedUsageKeyRef.current !== key
        ) return;
        setOwnedUsage((current) => ({
          key,
          resource: result.ok
            ? { value: result.value, loading: false, failure: null }
            : {
              ...(current.key === key ? current.resource : EMPTY_RESOURCE),
              loading: false,
              failure: result.error,
            },
        }));
      })
      .finally(() => {
        if (usageInFlight.current?.request === request) usageInFlight.current = null;
      });
    usageInFlight.current = { key, request };
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
    usageGeneration.current += 1;
    billingGeneration.current += 1;
    usageInFlight.current = null;
    billingInFlight.current = null;
    setOwnedUsage(EMPTY_OWNED_USAGE);
    setBilling(EMPTY_RESOURCE);
    if (productIdentity) void loadBilling();
  }, [loadBilling, loadUsage, productIdentity]);

  useEffect(() => {
    if (productIdentity && ownedUsage.key !== selectedUsageKey) {
      void loadUsage(selectedUsageQuery);
    }
  }, [loadUsage, ownedUsage.key, productIdentity, selectedUsageKey, selectedUsageQuery]);

  useEffect(() => () => {
    usageGeneration.current += 1;
    billingGeneration.current += 1;
  }, []);

  const selectedUsage = ownedUsage.key === selectedUsageKey
    ? ownedUsage.resource
    : EMPTY_RESOURCE;
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
    selectedUsageQuery,
    usage,
    billing: visibleBilling,
    refreshing: usage.loading || visibleBilling.loading,
    lastUpdatedAt,
    selectUsageQuery: setSelectedUsageQuery,
    refreshUsage: () => loadUsage(selectedUsageQuery),
    refreshBilling: loadBilling,
    refreshAll: async () => {
      await Promise.all([loadUsage(selectedUsageQuery), loadBilling()]);
    },
  };
}
