import { describe, expect, it } from "vitest";

import {
  groupProductModelsForDisplay,
  productModelVendorBrand,
} from "./productModelGrouping";

describe("groupProductModelsForDisplay", () => {
  it("groups models by vendor in a stable order and preserves upstream order within each group", () => {
    const groups = groupProductModelsForDisplay([
      { id: "k3", displayName: "K3" },
      { id: "o3", displayName: "o3" },
      { id: "ark-code-latest", displayName: "豆包" },
      { id: "gpt-image-2", displayName: "gpt-image-2" },
      { id: "claude-opus-5", displayName: "Opus 5" },
      { id: "deepseek-v3", displayName: "DeepSeek V3" },
      { id: "glm-5", displayName: "GLM-5" },
    ]);

    expect(groups.map((group) => group.id)).toEqual([
      "openai",
      "anthropic",
      "doubao",
      "kimi",
      "zhipu",
      "deepseek",
    ]);
    expect(groups[0].models.map((model) => model.id)).toEqual([
      "o3",
      "gpt-image-2",
    ]);
  });

  it("uses the display name as a vendor fallback", () => {
    const groups = groupProductModelsForDisplay([
      { id: "vendor-alias", displayName: "豆包模型" },
    ]);

    expect(groups).toEqual([
      {
        id: "doubao",
        models: [{ id: "vendor-alias", displayName: "豆包模型" }],
      },
    ]);
  });

  it("filters before grouping and omits empty vendor groups", () => {
    const groups = groupProductModelsForDisplay(
      [
        { id: "gpt-5.6-sol", displayName: "gpt-5.6-sol" },
        { id: "kimi-for-coding", displayName: "Kimi For Coding" },
      ],
      "kimi",
    );

    expect(groups.map((group) => group.id)).toEqual(["kimi"]);
    expect(groups[0].models.map((model) => model.id)).toEqual([
      "kimi-for-coding",
    ]);
  });

  it("exposes the icon brand represented by each presentation group", () => {
    expect(productModelVendorBrand("anthropic")).toBe("claude");
    expect(productModelVendorBrand("kimi")).toBe("kimi");
    expect(productModelVendorBrand("other")).toBeNull();
  });
});
