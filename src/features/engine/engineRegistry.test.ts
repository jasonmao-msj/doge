import { describe, expect, it } from "vitest";
import {
  BUILTIN_ENGINE_TYPES,
  asEngineId,
  createEngineAvailabilityRegistry,
  getEngineRegistryEntry,
  isSupportedEngineType,
  registerExternalEngine,
} from "./engineRegistry";

describe("engineRegistry", () => {
  it("owns the complete built-in identity and protocol set", () => {
    expect(BUILTIN_ENGINE_TYPES).toEqual([
      "claude",
      "codex",
      "gemini",
      "grok",
      "kimi",
      "opencode",
    ]);
    expect(getEngineRegistryEntry("codex")).toMatchObject({
      protocolFamily: "app-server-json-rpc",
      executionModel: "persistent",
      source: { kind: "builtin", trustOrigin: "doge-host" },
    });
    expect(getEngineRegistryEntry("grok")).toMatchObject({
      protocolFamily: "stream-json-cli",
      executionModel: "one-shot",
    });
    expect(getEngineRegistryEntry("kimi")).toMatchObject({
      protocolFamily: "stream-json-cli",
      executionModel: "one-shot",
    });
    expect(isSupportedEngineType("grok")).toBe(true);
    expect(isSupportedEngineType("kimi")).toBe(true);
    expect(isSupportedEngineType("other")).toBe(false);
  });

  it("validates external identity and provenance without changing EngineType", () => {
    expect(
      registerExternalEngine({
        id: "acme.agent",
        displayName: "Acme Agent",
        adapterId: "plugin.acme.agent",
        protocolFamily: "stream-json-cli",
        executionModel: "one-shot",
        capabilityProfile: "acme.agent",
        source: {
          kind: "plugin",
          registrationId: "plugin.acme.agent",
          version: "1.0.0",
          trustOrigin: "signed-marketplace",
        },
      }),
    ).toMatchObject({
      id: "acme.agent",
      source: { kind: "plugin", version: "1.0.0" },
    });
    expect(() => asEngineId("INVALID ID")).toThrow("Invalid engine id");
    expect(() =>
      registerExternalEngine({
        id: "codex",
        displayName: "Duplicate",
        adapterId: "plugin.duplicate",
        protocolFamily: "stream-json-cli",
        executionModel: "one-shot",
        capabilityProfile: "duplicate",
        source: {
          kind: "plugin",
          registrationId: "plugin.duplicate",
          version: "1",
          trustOrigin: "test",
        },
      }),
    ).toThrow("already registered");
  });

  it("keeps mutable availability outside immutable metadata", () => {
    const registry = createEngineAvailabilityRegistry();
    const codexId = asEngineId("codex");
    registry.update(codexId, {
      installed: false,
      ready: false,
      reason: "binary-missing",
      observedAtMs: 1,
    });
    expect(registry.get(codexId)).toEqual({
      installed: false,
      ready: false,
      reason: "binary-missing",
      observedAtMs: 1,
    });
    expect(getEngineRegistryEntry("codex")?.source.kind).toBe("builtin");
  });
});
