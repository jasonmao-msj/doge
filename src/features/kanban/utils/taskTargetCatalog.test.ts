import { describe, expect, it } from "vitest";

import type { EngineStatus, ModelOption } from "../../../types";
import { projectProductTargetCatalogV1 } from "../../account/runtime/productTargetCatalog";
import {
  buildKanbanTaskTargetCatalog,
  findKanbanTaskTargetModel,
} from "./taskTargetCatalog";

describe("buildKanbanTaskTargetCatalog", () => {
  it("treats Product as the complete authority without leaking local engines", () => {
    const catalog = buildKanbanTaskTargetCatalog({
      productCatalog: projectProductTargetCatalogV1({
        engines: [
          { id: "codex", displayName: "Codex" },
          { id: "claude-code", displayName: "Claude" },
          { id: "kimi", displayName: "Kimi CLI" },
        ],
        models: [
          {
            id: "kimi-code/kimi-for-coding",
            displayName: "Kimi For Coding",
            model: "kimi-for-coding",
            apiProtocols: [
              "openai-responses",
              "openai-chat-completions",
            ],
            capabilities: [],
          },
          {
            id: "claude-sonnet-4-8",
            displayName: "Claude Sonnet 4.8",
            model: "claude-sonnet-4-8",
            apiProtocols: ["anthropic-messages"],
            capabilities: [],
          },
        ],
      }),
      engineStatuses: [status("grok", true)],
      codexModels: [],
    });

    expect(catalog.authority).toBe("product");
    expect(catalog.engines.map((engine) => engine.id)).toEqual([
      "codex",
      "claude",
      "kimi",
    ]);
    expect(catalog.engines.some((engine) => engine.id === "grok")).toBe(false);
    expect(catalog.engines[0]?.models[0]?.target).toMatchObject({
      engine: "codex",
      providerProfileId: "doge-token-matrix",
      modelCatalogEntryId: "kimi-code/kimi-for-coding",
      model: "kimi-for-coding",
      providerProfileSource: "managed",
    });
    expect(catalog.engines[2]?.models[0]?.target).toMatchObject({
      engine: "kimi",
      model: "kimi-for-coding",
    });
  });

  it("keeps Local Codex hydrated models and installed semantics", () => {
    const catalog = buildKanbanTaskTargetCatalog({
      productCatalog: null,
      engineStatuses: [
        status("codex", true, [{
          id: "legacy",
          displayName: "Legacy",
          description: "",
          isDefault: true,
        }]),
        status("kimi", false),
      ],
      codexModels: [modelOption("gpt-5.6-sol")],
    });

    expect(catalog.authority).toBe("local");
    expect(catalog.engines[0]).toMatchObject({
      id: "codex",
      selectable: true,
      models: [{ id: "gpt-5.6-sol" }],
    });
    expect(catalog.engines[1]).toMatchObject({
      id: "kimi",
      selectable: false,
      unavailableReason: "not-installed",
    });
  });
});

describe("findKanbanTaskTargetModel", () => {
  it("preserves an exact target before using legacy identity fallback", () => {
    const catalog = buildKanbanTaskTargetCatalog({
      productCatalog: projectProductTargetCatalogV1({
        engines: [{ id: "codex", displayName: "Codex" }],
        models: [{
          id: "catalog-entry",
          displayName: "Runtime Model",
          model: "runtime-model",
          apiProtocols: ["openai-responses"],
          capabilities: [],
        }],
      }),
      engineStatuses: [],
      codexModels: [],
    });
    const engine = catalog.engines[0];

    expect(findKanbanTaskTargetModel({
      engine,
      target: engine?.models[0]?.target,
      legacyModelId: "stale",
    })?.id).toBe("catalog-entry");
    expect(findKanbanTaskTargetModel({
      engine,
      legacyModelId: "runtime-model",
    })?.id).toBe("catalog-entry");
  });
});

function status(
  engineType: EngineStatus["engineType"],
  installed: boolean,
  models: EngineStatus["models"] = [],
): EngineStatus {
  return {
    engineType,
    installed,
    version: null,
    binPath: null,
    features: {
      streaming: true,
      reasoning: false,
      reasoningEffort: false,
      toolUse: true,
      toolsControl: true,
      sessionResume: true,
      sessionContinuation: true,
      imageInput: true,
      mcp: false,
      collaborationMode: false,
    },
    models,
    error: null,
  };
}

function modelOption(id: string): ModelOption {
  return {
    id,
    model: id,
    displayName: id,
    description: "",
    source: "runtime",
    provider: null,
    protocol: null,
    provenance: null,
    observedAt: null,
    lastVerifiedAt: null,
    lifecycle: null,
    providerProfileId: null,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: null,
    isDefault: true,
  };
}

