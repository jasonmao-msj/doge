import { useSyncExternalStore } from "react";
import type {
  ProductEngineViewV1,
  ProductEntitlementV1,
  ProductModelViewV1,
} from "./productOnboardingClient";

export type ProductEntitlementSnapshotV1 = {
  readonly status: "unknown" | "required" | "ready";
  readonly entitlement: ProductEntitlementV1 | null;
  readonly engines: readonly ProductEngineViewV1[];
  readonly models: readonly ProductModelViewV1[];
  readonly modelsStatus: "idle" | "ready" | "refreshing" | "stale";
  readonly modelsUpdatedAt: number | null;
  readonly modelsError: string | null;
};

const EMPTY: ProductEntitlementSnapshotV1 = Object.freeze({
  status: "unknown",
  entitlement: null,
  engines: Object.freeze([]),
  models: Object.freeze([]),
  modelsStatus: "idle",
  modelsUpdatedAt: null,
  modelsError: null,
});

let snapshot = EMPTY;
const listeners = new Set<() => void>();

export function readProductEntitlementSnapshotV1(): ProductEntitlementSnapshotV1 {
  return snapshot;
}

export function subscribeProductEntitlementSnapshotV1(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useProductEntitlementSnapshotV1(): ProductEntitlementSnapshotV1 {
  return useSyncExternalStore(
    subscribeProductEntitlementSnapshotV1,
    readProductEntitlementSnapshotV1,
    readProductEntitlementSnapshotV1,
  );
}

export function publishProductRequiredV1(
  engines: readonly ProductEngineViewV1[],
): void {
  publish(Object.freeze({
    status: "required",
    entitlement: null,
    engines: Object.freeze([...engines]),
    models: Object.freeze([]),
    modelsStatus: "idle",
    modelsUpdatedAt: null,
    modelsError: null,
  }));
}

export function publishProductReadyV1(input: {
  readonly entitlement: ProductEntitlementV1;
  readonly engines: readonly ProductEngineViewV1[];
  readonly models: readonly ProductModelViewV1[];
}): void {
  publish(Object.freeze({
    status: "ready",
    entitlement: input.entitlement,
    engines: Object.freeze([...input.engines]),
    models: Object.freeze([...input.models]),
    modelsStatus: "ready",
    modelsUpdatedAt: Date.now(),
    modelsError: null,
  }));
}

export function publishProductShellReadyV1(input: {
  readonly entitlement: ProductEntitlementV1;
  readonly engines: readonly ProductEngineViewV1[];
}): void {
  publish(Object.freeze({
    status: "ready",
    entitlement: input.entitlement,
    engines: Object.freeze([...input.engines]),
    models: Object.freeze([]),
    modelsStatus: "refreshing",
    modelsUpdatedAt: null,
    modelsError: null,
  }));
}

export function publishProductModelsRefreshingV1(subscriptionId: number): void {
  if (snapshot.status !== "ready" ||
    snapshot.entitlement?.subscriptionId !== subscriptionId ||
    snapshot.modelsStatus === "refreshing") return;
  publish(Object.freeze({
    ...snapshot,
    modelsStatus: "refreshing",
    modelsError: null,
  }));
}

export function publishProductModelsUpdatedV1(input: {
  readonly subscriptionId: number;
  readonly models: readonly ProductModelViewV1[];
  readonly fetchedAt: number;
}): void {
  if (snapshot.status !== "ready" ||
    snapshot.entitlement?.subscriptionId !== input.subscriptionId) return;
  publish(Object.freeze({
    ...snapshot,
    models: Object.freeze([...input.models]),
    modelsStatus: "ready",
    modelsUpdatedAt: input.fetchedAt,
    modelsError: null,
  }));
}

export function publishProductModelsRefreshFailedV1(input: {
  readonly subscriptionId: number;
  readonly code: string;
}): void {
  if (snapshot.status !== "ready" ||
    snapshot.entitlement?.subscriptionId !== input.subscriptionId) return;
  publish(Object.freeze({
    ...snapshot,
    modelsStatus: "stale",
    modelsError: input.code,
  }));
}

export function clearProductEntitlementV1(): void {
  publish(EMPTY);
}

function publish(next: ProductEntitlementSnapshotV1): void {
  snapshot = next;
  listeners.forEach((listener) => listener());
}
