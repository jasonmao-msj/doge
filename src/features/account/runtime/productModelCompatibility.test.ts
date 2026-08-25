import { describe, expect, it } from "vitest";

import type { ProductModelViewV1 } from "./productOnboardingClient";
import {
  compatibleProductModelsForEngineV1,
  normalizeProductModelIdentityV1,
  productModelMatchesIdentityV1,
} from "./productModelCompatibility";

const models: ProductModelViewV1[] = [
  model("gpt-5.6-sol", ["codex", "kimi"]),
  model("claude-sonnet-4-8", ["claude"]),
  model("kimi-for-coding", ["kimi"]),
  {
    ...model("doubao-entry", ["codex", "claude", "kimi"]),
    displayName: "豆包",
    model: "ark-code-latest",
  },
];

describe("productModelCompatibility", () => {
  it("filters dynamic upstream rows by compatible engines and keeps upstream order", () => {
    expect(
      compatibleProductModelsForEngineV1("codex", models).map((item) => item.id),
    ).toEqual(["gpt-5.6-sol", "doubao-entry"]);
    expect(
      compatibleProductModelsForEngineV1("claude", models).map((item) => item.id),
    ).toEqual(["claude-sonnet-4-8", "doubao-entry"]);
    expect(
      compatibleProductModelsForEngineV1("kimi", models).map((item) => item.id),
    ).toEqual(["gpt-5.6-sol", "kimi-for-coding", "doubao-entry"]);
  });

  it("matches catalog identity and runtime model independently", () => {
    expect(productModelMatchesIdentityV1(models[3]!, "doubao-entry")).toBe(true);
    expect(productModelMatchesIdentityV1(models[3]!, "ark-code-latest")).toBe(true);
    expect(productModelMatchesIdentityV1(models[3]!, "豆包")).toBe(false);
  });

  it("keeps the legacy Kimi presentation namespace compatibility", () => {
    expect(normalizeProductModelIdentityV1("kimi-code/kimi-for-coding")).toBe(
      "kimi-for-coding",
    );
  });
});

function model(
  id: string,
  compatibleEngines: ProductModelViewV1["compatibleEngines"],
): ProductModelViewV1 {
  return {
    id,
    displayName: id,
    model: id,
    compatibleEngines,
    capabilities: [],
  };
}
