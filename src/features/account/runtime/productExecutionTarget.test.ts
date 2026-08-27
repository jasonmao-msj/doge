import { describe, expect, it } from "vitest";

import {
  PRODUCT_DOUBAO_RUNTIME_MODEL,
  isSameProductExecutionTargetV1,
  resolveProductManagedExecutionTargetV1,
  resolveProductRuntimeModelIdV1,
} from "./productExecutionTarget";
import type { ProductModelViewV1 } from "./productOnboardingClient";

const engines = [
  { id: "codex" as const, displayName: "Codex" },
  { id: "claude-code" as const, displayName: "Claude" },
  { id: "kimi" as const, displayName: "Kimi" },
];
const models: ProductModelViewV1[] = [
  productModel("gpt-5.6-sol", "GPT-5.6 Sol", [
    "openai-responses",
    "openai-chat-completions",
  ]),
  productModel("claude-sonnet-4-8", "Claude Sonnet 4.8", [
    "anthropic-messages",
  ]),
  productModel("kimi-for-coding", "Kimi for Coding", [
    "openai-responses",
    "openai-chat-completions",
  ]),
  productModel(
    "doubao-entry",
    "豆包",
    ["openai-responses", "openai-chat-completions", "anthropic-messages"],
    "ark-code-latest",
  ),
];

describe("resolveProductManagedExecutionTargetV1", () => {
  it("defaults Product Home to Codex and its first released model", () => {
    expect(
      resolveProductManagedExecutionTargetV1({
        preferredEngine: "codex",
        engines: [engines[1], engines[2], engines[0]],
        models: [
          productModel("claude-opus-4-8", "Claude Opus 4.8", [
            "anthropic-messages",
          ]),
          productModel("gpt-5.6-luna", "GPT-5.6 Luna", ["openai-responses"]),
          productModel("gpt-5.6-sol", "GPT-5.6 Sol", ["openai-responses"]),
        ],
      }),
    ).toMatchObject({
      engine: "codex",
      providerProfileId: "doge-token-matrix",
      modelCatalogEntryId: "gpt-5.6-luna",
      model: "gpt-5.6-luna",
    });
  });

  it("replaces a persisted local profile and repairs an incompatible model", () => {
    expect(
      resolveProductManagedExecutionTargetV1({
        target: {
          engine: "claude",
          providerProfileId: null,
          modelCatalogEntryId: "gpt-5.6-sol",
          model: "gpt-5.6-sol",
          reasoning: null,
          providerProfileNameSnapshot: "本地配置",
          providerProfileSource: "disk",
        },
        engines,
        models,
      }),
    ).toEqual({
      engine: "claude",
      providerProfileId: "doge-token-matrix",
      modelCatalogEntryId: "claude-sonnet-4-8",
      model: "claude-sonnet-4-8",
      reasoning: null,
      providerProfileNameSnapshot: "Doge",
      providerProfileSource: "managed",
    });
  });

  it("uses the Composite public alias instead of the private Ark account model", () => {
    expect(
      resolveProductRuntimeModelIdV1({
        id: "doubao-entry",
        model: "ark-code-latest",
      }),
    ).toBe("豆包");
  });

  it("normalizes a public Doubao alias to the callable Ark runtime model", () => {
    expect(
      resolveProductRuntimeModelIdV1({
        id: "豆包",
        displayName: "豆包",
        model: "豆包",
      }),
    ).toBe(PRODUCT_DOUBAO_RUNTIME_MODEL);
    expect(
      resolveProductRuntimeModelIdV1({
        id: "doubao-entry",
        displayName: "豆包",
        model: "",
      }),
    ).toBe(PRODUCT_DOUBAO_RUNTIME_MODEL);
  });

  it("normalizes the Kimi fallback catalog namespace to the product runtime id", () => {
    expect(
      resolveProductManagedExecutionTargetV1({
        target: {
          engine: "kimi",
          providerProfileId: "doge-token-matrix",
          modelCatalogEntryId: "kimi-code/kimi-for-coding",
          model: "kimi-code/kimi-for-coding",
          reasoning: null,
          providerProfileNameSnapshot: null,
          providerProfileSource: "managed",
        },
        engines,
        models: [
          productModel("gpt-5.5", "gpt-5.5", ["openai-chat-completions"]),
          productModel("kimi-for-coding", "Kimi for Coding", [
            "openai-responses",
            "openai-chat-completions",
          ]),
        ],
      }),
    ).toMatchObject({
      engine: "kimi",
      providerProfileId: "doge-token-matrix",
      modelCatalogEntryId: "kimi-code/kimi-for-coding",
      model: "kimi-for-coding",
    });
  });

  it("is stable after the managed target has already been committed", () => {
    const target = resolveProductManagedExecutionTargetV1({
      preferredEngine: "kimi",
      preferredModelId: "kimi-for-coding",
      preferredEffort: "low",
      engines,
      models,
    });
    const next = resolveProductManagedExecutionTargetV1({
      target,
      engines,
      models,
    });

    expect(isSameProductExecutionTargetV1(target, next)).toBe(true);
  });

  it("fails closed when the selected engine has no compatible model in the catalog", () => {
    expect(
      resolveProductManagedExecutionTargetV1({
        preferredEngine: "claude",
        engines: engines.filter((engine) => engine.id === "claude-code"),
        models: [
          productModel("gpt-5.6-sol", "GPT-5.6 Sol", ["openai-responses"]),
        ],
      }),
    ).toBeNull();
  });
});

function productModel(
  id: string,
  displayName: string,
  apiProtocols: ProductModelViewV1["apiProtocols"],
  runtimeModel = id,
): ProductModelViewV1 {
  return {
    id,
    displayName,
    model: runtimeModel,
    apiProtocols,
    capabilities: [],
  };
}
