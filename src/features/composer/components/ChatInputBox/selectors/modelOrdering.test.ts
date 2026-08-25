import { describe, expect, it } from "vitest";

import { orderProviderModelsForDisplay } from "./modelOrdering";

describe("orderProviderModelsForDisplay", () => {
  it("orders Codex models by generation and tier, then preserves independent model order", () => {
    const models = [
      { id: "豆包", label: "豆包" },
      { id: "gpt-5.6-luna", label: "gpt-5.6-luna" },
      { id: "gpt-5.5", label: "gpt-5.5" },
      { id: "gpt-5.6-terra", label: "gpt-5.6-terra" },
      { id: "alpha", label: "Alpha" },
      { id: "gpt-5.6-sol", label: "gpt-5.6-sol" },
    ];

    expect(
      orderProviderModelsForDisplay("codex", models).map((model) => model.id),
    ).toEqual([
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5",
      "豆包",
      "alpha",
    ]);
  });

  it("orders Claude tiers and versions before independent models", () => {
    const models = [
      { id: "豆包", label: "豆包" },
      { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
      { id: "claude-sonnet-4-7", label: "Sonnet 4.7" },
      { id: "claude-opus-5", label: "Opus 5" },
      { id: "claude-fable-5", label: "Fable 5" },
      { id: "claude-sonnet-5", label: "Sonnet 5" },
    ];

    expect(
      orderProviderModelsForDisplay("claude", models).map((model) => model.id),
    ).toEqual([
      "claude-fable-5",
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-sonnet-4-7",
      "claude-haiku-4-5-20251001",
      "豆包",
    ]);
  });

  it("uses Codex runtime identity and preserves unrelated provider order", () => {
    const models = [
      { id: "custom-sol", model: "gpt-5.7-sol", label: "Custom Sol" },
      { id: "gpt-5.6-sol", label: "gpt-5.6-sol" },
    ];

    expect(
      orderProviderModelsForDisplay("codex", models).map((model) => model.id),
    ).toEqual(["custom-sol", "gpt-5.6-sol"]);
    expect(orderProviderModelsForDisplay("claude", models)).toEqual(models);
  });
});
