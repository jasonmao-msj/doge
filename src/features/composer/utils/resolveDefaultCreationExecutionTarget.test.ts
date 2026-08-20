import { describe, expect, it } from "vitest";

import { isResolvedExecutionTarget } from "../../shared-session/target/types";
import {
  GROK_LOCAL_PROVIDER_PROFILE_ID,
  LOCAL_PROVIDER_PROFILE_DISPLAY_NAME,
} from "../../threads/constants/codexProviderProfiles";
import { resolveDefaultCreationExecutionTarget } from "./resolveDefaultCreationExecutionTarget";

describe("resolveDefaultCreationExecutionTarget", () => {
  it("returns null when create-session is disabled", () => {
    expect(
      resolveDefaultCreationExecutionTarget({
        enabled: false,
        selectedEngine: "grok",
        selectedModelId: "grok",
        models: [{ id: "grok", model: "grok", isDefault: true }],
      }),
    ).toBeNull();
  });

  it("returns null for unsupported engines such as gemini", () => {
    expect(
      resolveDefaultCreationExecutionTarget({
        enabled: true,
        selectedEngine: "gemini",
        selectedModelId: "gemini-2.5-pro",
        models: [{ id: "gemini-2.5-pro", model: "gemini-2.5-pro" }],
      }),
    ).toBeNull();
  });

  it("builds a resolved Grok local target from parent models (home create-session)", () => {
    const target = resolveDefaultCreationExecutionTarget({
      enabled: true,
      selectedEngine: "grok",
      selectedModelId: "Grok 4.5",
      selectedEffort: null,
      providerProfileId: GROK_LOCAL_PROVIDER_PROFILE_ID,
      models: [
        {
          id: "Grok 4.5",
          model: "grok-4.5",
          isDefault: true,
        },
      ],
    });

    expect(target).toEqual({
      engine: "grok",
      providerProfileId: null,
      modelCatalogEntryId: "Grok 4.5",
      model: "grok-4.5",
      reasoning: null,
      providerProfileNameSnapshot: LOCAL_PROVIDER_PROFILE_DISPLAY_NAME,
      providerProfileSource: "disk",
    });
    expect(isResolvedExecutionTarget(target)).toBe(true);
  });

  it("falls back to default/first catalog row when selectedModelId is empty", () => {
    const target = resolveDefaultCreationExecutionTarget({
      enabled: true,
      selectedEngine: "kimi",
      selectedModelId: null,
      models: [
        { id: "k2", model: "kimi-k2", isDefault: false },
        { id: "k3", model: "kimi-k3", isDefault: true },
      ],
    });

    expect(target?.modelCatalogEntryId).toBe("k3");
    expect(target?.model).toBe("kimi-k3");
    expect(target?.engine).toBe("kimi");
    expect(isResolvedExecutionTarget(target)).toBe(true);
  });

  it("uses model id as runtime when catalog row has no model field", () => {
    const target = resolveDefaultCreationExecutionTarget({
      enabled: true,
      selectedEngine: "opencode",
      selectedModelId: "opencode-default",
      models: [{ id: "opencode-default" }],
    });

    expect(target).toMatchObject({
      engine: "opencode",
      modelCatalogEntryId: "opencode-default",
      model: "opencode-default",
      providerProfileSource: "disk",
    });
    expect(isResolvedExecutionTarget(target)).toBe(true);
  });

  it("synthesizes snapshot target when models list is empty but selectedModelId exists", () => {
    const target = resolveDefaultCreationExecutionTarget({
      enabled: true,
      selectedEngine: "grok",
      selectedModelId: "grok",
      models: [],
    });

    expect(target).toMatchObject({
      engine: "grok",
      modelCatalogEntryId: "grok",
      model: "grok",
      providerProfileId: null,
      providerProfileSource: "disk",
    });
    // 闭合态可展示；resolved 供发送
    expect(isResolvedExecutionTarget(target)).toBe(true);
  });

  it("keeps managed provider profile id when not a local sentinel", () => {
    const target = resolveDefaultCreationExecutionTarget({
      enabled: true,
      selectedEngine: "codex",
      selectedModelId: "gpt-5.5",
      providerProfileId: "provider-deepseek",
      models: [{ id: "gpt-5.5", model: "deepseek-v4-pro", isDefault: true }],
    });

    expect(target).toMatchObject({
      engine: "codex",
      providerProfileId: "provider-deepseek",
      modelCatalogEntryId: "gpt-5.5",
      model: "deepseek-v4-pro",
      providerProfileNameSnapshot: "provider-deepseek",
      providerProfileSource: "managed",
    });
    expect(isResolvedExecutionTarget(target)).toBe(true);
  });

  it("still builds Claude local defaults (regression)", () => {
    const target = resolveDefaultCreationExecutionTarget({
      enabled: true,
      selectedEngine: "claude",
      selectedModelId: "claude-sonnet-4-6",
      models: [
        {
          id: "claude-sonnet-4-6",
          model: "claude-sonnet-4-6",
          isDefault: true,
        },
      ],
    });

    expect(target?.engine).toBe("claude");
    expect(target?.providerProfileSource).toBe("disk");
    expect(isResolvedExecutionTarget(target)).toBe(true);
  });

  it("requires explicitly scoped rows for the managed provider", () => {
    expect(
      resolveDefaultCreationExecutionTarget({
        enabled: true,
        selectedEngine: "codex",
        selectedModelId: "local-model",
        providerProfileId: "doge-token-matrix",
        models: [{ id: "local-model", model: "local-model" }],
      }),
    ).toBeNull();

    const target = resolveDefaultCreationExecutionTarget({
      enabled: true,
      selectedEngine: "codex",
      selectedModelId: "matrix-model",
      providerProfileId: "doge-token-matrix",
      models: [
        {
          id: "matrix-model",
          model: "gpt-5.5-codex",
          providerProfileId: "doge-token-matrix",
          isDefault: true,
        },
      ],
    });

    expect(target).toMatchObject({
      providerProfileId: "doge-token-matrix",
      modelCatalogEntryId: "matrix-model",
      model: "gpt-5.5-codex",
      providerProfileSource: "managed",
    });
  });

  it("fails closed when a managed catalog is unavailable", () => {
    expect(
      resolveDefaultCreationExecutionTarget({
        enabled: true,
        selectedEngine: "claude",
        selectedModelId: "stale-local-model",
        providerProfileId: "doge-token-matrix",
        providerCatalogAvailable: false,
        models: [
          {
            id: "stale-local-model",
            model: "stale-local-model",
            providerProfileId: "doge-token-matrix",
          },
        ],
      }),
    ).toBeNull();
  });
});
