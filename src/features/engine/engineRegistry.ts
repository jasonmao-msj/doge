import type { EngineType } from "../../types";
import registryData from "./engineIds.json";

export type EngineId = string & { readonly __brand: "EngineId" };
export type EngineProtocolFamily = "stream-json-cli" | "app-server-json-rpc";
export type EngineExecutionModel = "one-shot" | "persistent";
export type EngineRegistrySource =
  | Readonly<{
      kind: "builtin";
      registrationId: string;
      version: "host";
      trustOrigin: "doge-host";
    }>
  | Readonly<{
      kind: "plugin";
      registrationId: string;
      version: string;
      trustOrigin: string;
    }>;

export type EngineRegistryEntry = Readonly<{
  id: EngineId;
  displayName: string;
  shortName?: string;
  adapterId: string;
  protocolFamily: EngineProtocolFamily;
  executionModel: EngineExecutionModel;
  capabilityProfile: string;
  source: EngineRegistrySource;
}>;

export type EngineRuntimeAvailability = Readonly<{
  installed: boolean;
  ready: boolean;
  reason: string | null;
  observedAtMs: number;
}>;

const ENGINE_ID_PATTERN = /^[a-z][a-z0-9.-]{1,63}$/;

export function asEngineId(value: string): EngineId {
  const normalized = value.trim().toLowerCase();
  if (!ENGINE_ID_PATTERN.test(normalized)) {
    throw new Error(`Invalid engine id: ${value}`);
  }
  return normalized as EngineId;
}

function createBuiltinEntry(
  input: (typeof registryData.engines)[number],
): EngineRegistryEntry {
  return Object.freeze({
    ...input,
    id: asEngineId(input.id),
    protocolFamily: input.protocolFamily as EngineProtocolFamily,
    executionModel: input.executionModel as EngineExecutionModel,
    source: Object.freeze({
      kind: "builtin" as const,
      registrationId: input.adapterId,
      version: "host" as const,
      trustOrigin: "doge-host" as const,
    }),
  });
}

export const BUILTIN_ENGINE_REGISTRY = Object.freeze(
  Object.fromEntries(
    registryData.engines.map((entry) => [entry.id, createBuiltinEntry(entry)]),
  ) as Record<EngineType, EngineRegistryEntry>,
);

export const BUILTIN_ENGINE_TYPES = Object.freeze(
  registryData.engineIds as EngineType[],
);

export function isSupportedEngineType(value: unknown): value is EngineType {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(BUILTIN_ENGINE_REGISTRY, value)
  );
}

export function getEngineRegistryEntry(engineId: string): EngineRegistryEntry | null {
  return BUILTIN_ENGINE_REGISTRY[engineId as EngineType] ?? null;
}

export function registerExternalEngine(input: {
  id: string;
  displayName: string;
  adapterId: string;
  protocolFamily: EngineProtocolFamily;
  executionModel: EngineExecutionModel;
  capabilityProfile: string;
  source: Extract<EngineRegistrySource, { kind: "plugin" }>;
}): EngineRegistryEntry {
  const id = asEngineId(input.id);
  if (getEngineRegistryEntry(id)) {
    throw new Error(`Engine id already registered: ${id}`);
  }
  if (!input.source.registrationId.trim() || !input.source.version.trim()) {
    throw new Error("External engine source is incomplete");
  }
  return Object.freeze({
    ...input,
    id,
    source: Object.freeze({ ...input.source }),
  });
}

export function createEngineAvailabilityRegistry() {
  const availability = new Map<EngineId, EngineRuntimeAvailability>();
  return Object.freeze({
    update(engineId: EngineId, next: EngineRuntimeAvailability) {
      availability.set(engineId, Object.freeze({ ...next }));
    },
    get(engineId: EngineId): EngineRuntimeAvailability | null {
      return availability.get(engineId) ?? null;
    },
  });
}
