import { describe, expect, it } from "vitest";

import type { ProductModelViewV1 } from "./productOnboardingClient";
import {
  compatibleProductModelsForEngineV1,
  normalizeProductModelIdentityV1,
  productModelMatchesIdentityV1,
} from "./productModelCompatibility";

const models: ProductModelViewV1[] = [
  model("gpt-5.6-sol", ["openai-responses", "openai-chat-completions"]),
  model("claude-sonnet-4-8", ["openai-responses", "anthropic-messages"]),
  model("kimi-for-coding", ["openai-responses", "openai-chat-completions"]),
  {
    ...model("doubao-entry", [
      "openai-responses",
      "openai-chat-completions",
      "anthropic-messages",
    ]),
    displayName: "豆包",
    model: "ark-code-latest",
  },
];

describe("productModelCompatibility", () => {
  it("projects dynamic upstream rows by API protocol and keeps upstream order", () => {
    expect(
      compatibleProductModelsForEngineV1("codex", models).map((item) => item.id),
    ).toEqual([
      "gpt-5.6-sol",
      "claude-sonnet-4-8",
      "kimi-for-coding",
      "doubao-entry",
    ]);
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
  apiProtocols: ProductModelViewV1["apiProtocols"],
): ProductModelViewV1 {
  return {
    id,
    displayName: id,
    model: id,
    apiProtocols,
    capabilities: [],
  };
}
