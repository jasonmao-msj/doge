import { describe, expect, it } from "vitest";
import {
  applyManagedCodexStatus,
  buildAvailableEngines,
  ENABLED_ENGINE_TYPES,
} from "./engineControllerAvailability";
import type { EngineStatus } from "../../../types";

describe("engineControllerAvailability", () => {
  it("marks bundled Codex ready without changing other engine statuses", () => {
    const statuses: EngineStatus[] = [
      {
        engineType: "codex",
        installed: false,
        version: null,
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: [],
        error: "not installed",
      },
      {
        engineType: "claude",
        installed: true,
        version: "2.1.0",
        binPath: "/usr/local/bin/claude",
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: [],
        error: null,
      },
    ];

    const next = applyManagedCodexStatus(statuses, {
      ok: true,
      value: {
        engineId: "codex",
        status: "ready",
        bundledVersion: "0.147.0",
        externalVersion: null,
        selectedSource: "bundled",
      },
    });

    expect(next).toEqual([
      expect.objectContaining({
        engineType: "codex",
        installed: true,
        version: "0.147.0",
        error: null,
      }),
      statuses[1],
    ]);
  });

  it("keeps the generic Codex status when managed resolution is unavailable", () => {
    const status: EngineStatus = {
      engineType: "codex",
      installed: false,
      version: null,
      binPath: null,
      features: {
        streaming: true,
        reasoning: true,
        toolUse: true,
        imageInput: true,
        sessionContinuation: true,
      },
      models: [],
      error: "not installed",
    };

    expect(applyManagedCodexStatus([status], null)).toEqual([status]);
  });

  it("projects labels from the canonical registry and excludes retired engines", () => {
    expect(ENABLED_ENGINE_TYPES).toEqual([
      "claude",
      "codex",
      "grok",
      "kimi",
      "opencode",
    ]);
    expect(buildAvailableEngines([], false)).toEqual([
      expect.objectContaining({
        type: "claude",
        displayName: "Claude",
        shortName: "Claude",
        availabilityState: "loading",
      }),
      expect.objectContaining({
        type: "codex",
        displayName: "Codex",
        shortName: "Codex",
      }),
      expect.objectContaining({
        type: "grok",
        displayName: "Grok",
        shortName: "Grok",
      }),
      expect.objectContaining({
        type: "kimi",
        displayName: "Kimi",
        shortName: "Kimi",
      }),
      expect.objectContaining({
        type: "opencode",
        displayName: "OpenCode",
        shortName: "OpenCode",
      }),
    ]);
  });
});
