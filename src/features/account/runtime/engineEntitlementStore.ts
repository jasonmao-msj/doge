import type {
  ManagedEngineIdV1,
  ManagedEngineViewV1,
} from "./engineOnboardingClient";

export type ManagedEngineEntitlementStatusV1 = "active" | "none" | "unknown";
export type ManagedEngineEntitlementSnapshotV1 = Readonly<
  Record<ManagedEngineIdV1, ManagedEngineEntitlementStatusV1>
>;

const UNKNOWN_SNAPSHOT: ManagedEngineEntitlementSnapshotV1 = Object.freeze({
  codex: "unknown",
  "claude-code": "unknown",
});

let snapshot = UNKNOWN_SNAPSHOT;
const listeners = new Set<() => void>();

export function readManagedEngineEntitlementsV1(): ManagedEngineEntitlementSnapshotV1 {
  return snapshot;
}

export function subscribeManagedEngineEntitlementsV1(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishManagedEngineEntitlementsV1(
  engines: readonly ManagedEngineViewV1[],
): void {
  const next: ManagedEngineEntitlementSnapshotV1 = Object.freeze({
    codex: engines.find((engine) => engine.id === "codex")?.entitlement.status ?? "unknown",
    "claude-code": engines.find((engine) => engine.id === "claude-code")?.entitlement.status ?? "unknown",
  });
  publish(next);
}

export function markManagedEngineEntitledV1(engineId: ManagedEngineIdV1): void {
  if (snapshot[engineId] === "active") return;
  publish(Object.freeze({ ...snapshot, [engineId]: "active" }));
}

export function clearManagedEngineEntitlementsV1(): void {
  publish(UNKNOWN_SNAPSHOT);
}

export function managedEngineIdForRuntimeV1(
  engine: string,
): ManagedEngineIdV1 | null {
  if (engine === "codex") return "codex";
  if (engine === "claude") return "claude-code";
  return null;
}

function publish(next: ManagedEngineEntitlementSnapshotV1): void {
  if (next.codex === snapshot.codex && next["claude-code"] === snapshot["claude-code"]) {
    return;
  }
  snapshot = next;
  listeners.forEach((listener) => listener());
}
