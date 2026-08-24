import type {
  ManagedEngineIdV1,
  ManagedEngineViewV1,
} from "./onboardingTypes";

export type ManagedEngineEntitlementStatusV1 = "active" | "none" | "unknown";
export type ManagedEngineEntitlementSnapshotV1 = Readonly<
  Record<ManagedEngineIdV1, ManagedEngineEntitlementStatusV1>
>;

/** The only provider identity that account preparation is allowed to default. */
export const MANAGED_PROVIDER_PROFILE_ID_V1 = "doge-token-matrix" as const;

export type ManagedEnginePreparationStatusV1 =
  | "prepared"
  | "unprepared"
  | "unknown";
export type ManagedEnginePreparationSnapshotV1 = Readonly<
  Record<ManagedEngineIdV1, ManagedEnginePreparationStatusV1>
>;

const UNKNOWN_SNAPSHOT: ManagedEngineEntitlementSnapshotV1 = Object.freeze({
  codex: "unknown",
  "claude-code": "unknown",
});
const UNKNOWN_PREPARATION_SNAPSHOT: ManagedEnginePreparationSnapshotV1 = Object.freeze({
  codex: "unknown",
  "claude-code": "unknown",
});

let snapshot = UNKNOWN_SNAPSHOT;
let preparationSnapshot = UNKNOWN_PREPARATION_SNAPSHOT;
const listeners = new Set<() => void>();
const preparationListeners = new Set<() => void>();

export function readManagedEngineEntitlementsV1(): ManagedEngineEntitlementSnapshotV1 {
  return snapshot;
}

export function subscribeManagedEngineEntitlementsV1(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function readManagedEnginePreparationV1(): ManagedEnginePreparationSnapshotV1 {
  return preparationSnapshot;
}

export function subscribeManagedEnginePreparationV1(listener: () => void): () => void {
  preparationListeners.add(listener);
  return () => preparationListeners.delete(listener);
}

export function publishManagedEngineEntitlementsV1(
  engines: readonly ManagedEngineViewV1[],
): void {
  const next: ManagedEngineEntitlementSnapshotV1 = Object.freeze({
    codex: engines.find((engine) => engine.id === "codex")?.entitlement.status ?? "unknown",
    "claude-code": engines.find((engine) => engine.id === "claude-code")?.entitlement.status ?? "unknown",
  });
  publish(next);

  // Catalog truth alone is not preparation truth. Preserve a previously
  // prepared active engine during an in-app catalog reread, but never promote
  // an active entitlement to prepared before the activation transaction ends.
  const nextPreparation: ManagedEnginePreparationSnapshotV1 = Object.freeze({
    codex:
      next.codex === "active" && preparationSnapshot.codex === "prepared"
        ? "prepared"
        : next.codex === "active"
          ? "unprepared"
          : "unknown",
    "claude-code":
      next["claude-code"] === "active" && preparationSnapshot["claude-code"] === "prepared"
        ? "prepared"
        : next["claude-code"] === "active"
          ? "unprepared"
          : "unknown",
  });
  publishPreparation(nextPreparation);
}

export function markManagedEngineEntitledV1(engineId: ManagedEngineIdV1): void {
  if (snapshot[engineId] === "active") return;
  publish(Object.freeze({ ...snapshot, [engineId]: "active" }));
}

/**
 * Marks an entitlement usable for managed new-session defaults only after the
 * account prepare + engine activation + provider activation transaction has
 * completed successfully.
 */
export function markManagedEnginePreparedV1(engineId: ManagedEngineIdV1): void {
  if (snapshot[engineId] !== "active") return;
  if (preparationSnapshot[engineId] === "prepared") return;
  publishPreparation(Object.freeze({ ...preparationSnapshot, [engineId]: "prepared" }));
}

export function clearManagedEnginePreparedV1(engineId: ManagedEngineIdV1): void {
  const current = preparationSnapshot[engineId];
  const nextStatus: ManagedEnginePreparationStatusV1 =
    current === "unknown" ? "unknown" : "unprepared";
  if (current === nextStatus) return;
  publishPreparation(Object.freeze({ ...preparationSnapshot, [engineId]: nextStatus }));
}

export function isManagedEnginePreparedV1(engineId: ManagedEngineIdV1): boolean {
  return preparationSnapshot[engineId] === "prepared";
}

export function clearManagedEngineEntitlementsV1(): void {
  publish(UNKNOWN_SNAPSHOT);
  publishPreparation(UNKNOWN_PREPARATION_SNAPSHOT);
}

export function managedEngineIdForRuntimeV1(
  engine: string,
): ManagedEngineIdV1 | null {
  if (engine === "codex") return "codex";
  if (engine === "claude") return "claude-code";
  return null;
}

export function isManagedProviderProfileIdV1(
  providerProfileId: string | null | undefined,
): boolean {
  return providerProfileId?.trim() === MANAGED_PROVIDER_PROFILE_ID_V1;
}

function publish(next: ManagedEngineEntitlementSnapshotV1): void {
  if (next.codex === snapshot.codex && next["claude-code"] === snapshot["claude-code"]) {
    return;
  }
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function publishPreparation(next: ManagedEnginePreparationSnapshotV1): void {
  if (
    next.codex === preparationSnapshot.codex &&
    next["claude-code"] === preparationSnapshot["claude-code"]
  ) {
    return;
  }
  preparationSnapshot = next;
  preparationListeners.forEach((listener) => listener());
}
