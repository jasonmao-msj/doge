import { describe, expect, it } from "vitest";

import type { ProductModelViewV1 } from "./productOnboardingClient";
import { projectProductTargetCatalogV1 } from "./productTargetCatalog";

const engines = [
  { id: "codex", displayName: "Codex" },
  { id: "claude-code", displayName: "Claude" },
  { id: "kimi", displayName: "Kimi CLI" },
] as const;

describe("projectProductTargetCatalogV1", () => {
  it("projects upstream rows once into exact engine target catalogs", () => {
    const catalog = projectProductTargetCatalogV1({
      engines,
      models: [
        model("gpt-5.6-sol", [
          "openai-responses",
          "openai-chat-completions",
        ]),
        model("claude-sonnet-4-8", [
          "openai-responses",
          "anthropic-messages",
        ]),
        model("kimi-code/kimi-for-coding", [
          "openai-responses",
          "openai-chat-completions",
        ], "kimi-for-coding"),
      ],
    });

    expect(catalog.engines.map((engine) => engine.id)).toEqual([
      "codex",
      "claude",
      "kimi",
    ]);
    expect(catalog.engines[0]?.models.map((entry) => entry.id)).toEqual([
      "gpt-5.6-sol",
      "claude-sonnet-4-8",
      "kimi-code/kimi-for-coding",
    ]);
    expect(catalog.engines[1]?.models.map((entry) => entry.id)).toEqual([
      "claude-sonnet-4-8",
    ]);
    expect(catalog.engines[2]?.models.map((entry) => entry.id)).toEqual([
      "gpt-5.6-sol",
      "kimi-code/kimi-for-coding",
    ]);
    expect(catalog.engines[2]?.models[1]).toMatchObject({
      id: "kimi-code/kimi-for-coding",
      model: "kimi-for-coding",
      runtimeModel: "kimi-for-coding",
    });
  });

  it("keeps catalog identity separate from a normalized runtime model", () => {
    const catalog = projectProductTargetCatalogV1({
      engines: [{ id: "codex", displayName: "Codex" }],
      models: [{
        ...model("doubao-entry", ["openai-responses"], "ark-code-latest"),
        displayName: "豆包",
      }],
      modelsStatus: "stale",
      modelsUpdatedAt: 123,
    });

    expect(catalog).toMatchObject({
      modelsStatus: "stale",
      modelsUpdatedAt: 123,
      engines: [{
        id: "codex",
        models: [{
          id: "doubao-entry",
          model: "ark-code-latest",
          runtimeModel: "豆包",
        }],
      }],
    });
  });
});

function model(
  id: string,
  apiProtocols: ProductModelViewV1["apiProtocols"],
  runtimeModel = id,
): ProductModelViewV1 {
  return {
    id,
    displayName: id,
    model: runtimeModel,
    apiProtocols,
    capabilities: [],
  };
}
