// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../features/collaboration/hooks/useCollaborationModeSelection", () => ({
  useCollaborationModeSelection: () => ({ collaborationModePayload: null }),
}));
vi.mock("../features/composer/hooks/useComposerMenuActions", () => ({
  useComposerMenuActions: () => {},
}));
vi.mock("../features/composer/hooks/useComposerShortcuts", () => ({
  useComposerShortcuts: () => {},
}));
vi.mock("../features/app/hooks/usePersistComposerSettings", () => ({
  usePersistComposerSettings: () => {},
}));

import { useAppShellComposerModelSection } from "./useAppShellComposerModelSection";

function makeModel(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    model: id,
    displayName: id,
    description: "",
    source: "test",
    supportedReasoningEfforts: [],
    defaultReasoningEffort: null,
    isDefault: false,
    ...overrides,
  };
}

const claudeModels = [
  makeModel("claude-opus-4-8", { isDefault: true }),
  makeModel("claude-sonnet-4-6"),
];
const kimiModels = [
  makeModel("kimi-code/k3", { isDefault: true }),
  makeModel("kimi-code/kimi-for-coding"),
];

function renderSection(overrides: Record<string, unknown> = {}) {
  return renderHook(() =>
    useAppShellComposerModelSection({
      accessMode: "auto",
      activeEngine: "claude",
      activeThreadId: null,
      activeWorkspaceId: null,
      appSettings: {},
      appSettingsLoading: false,
      applySelectedCollaborationMode: vi.fn(),
      collaborationModes: [],
      composerInputRef: { current: null },
      composerSelectionResolverRef: { current: null },
      engineModelCatalogsAsOptions: { kimi: kimiModels },
      engineModelsAsOptions: claudeModels,
      globalSelectionReady: true,
      handleSelectComposerSelection: vi.fn(),
      handleSetAccessMode: vi.fn(),
      models: [],
      modelsReady: true,
      persistComposerEnginePref: vi.fn(),
      persistComposerSelectionForThread: vi.fn(),
      queueSaveSettings: vi.fn(),
      selectedCollaborationMode: null,
      selectedCollaborationModeId: null,
      selectedComposerSelection: null,
      selectedEffort: null,
      selectedModelId: null,
      setAppSettings: vi.fn(),
      setSelectedEffort: vi.fn(),
      setSelectedModelId: vi.fn(),
      ...overrides,
    }),
  );
}

describe("useAppShellComposerModelSection handleSelectModel", () => {
  it("uses the bound Codex provider catalog instead of the global model list", () => {
    const providerModels = [
      makeModel("provider-a-model", { providerProfileId: "provider-a" }),
      makeModel("gpt-public"),
    ];
    const { result } = renderSection({
      activeEngine: "codex",
      activeThreadId: "codex-thread-1",
      activeProviderProfileId: "provider-a",
      engineModelsAsOptions: providerModels,
      models: [makeModel("global-default-model")],
    });

    expect(result.current.effectiveModels.map((model) => model.id)).toEqual([
      "provider-a-model",
      "gpt-public",
    ]);
    expect(
      result.current.effectiveModels.some(
        (model) => model.id === "global-default-model",
      ),
    ).toBe(false);
  });

  it("inherits Codex reasoning metadata without replacing provider-owned facts", () => {
    const supportedReasoningEfforts = [
      { reasoningEffort: "low", description: "Low" },
      { reasoningEffort: "high", description: "High" },
    ];
    const providerModel = makeModel("gpt-5.6-sol", {
      model: " GPT-5.6-SOL ",
      displayName: "Provider GPT",
      providerProfileId: "provider-a",
      source: "provider-custom",
      isDefault: true,
    });
    const { result } = renderSection({
      activeEngine: "codex",
      activeThreadId: "codex-thread-1",
      activeProviderProfileId: "provider-a",
      engineModelsAsOptions: [providerModel],
      models: [
        makeModel("gpt-5.6-sol", {
          supportedReasoningEfforts,
          defaultReasoningEffort: "high",
        }),
      ],
      selectedComposerSelection: {
        modelId: "gpt-5.6-sol",
        effort: "high",
      },
    });

    expect(result.current.effectiveModels[0]).toEqual({
      ...providerModel,
      supportedReasoningEfforts,
      defaultReasoningEffort: "high",
    });
    expect(result.current.effectiveReasoningOptions).toEqual(["low", "high"]);
    expect(result.current.effectiveSelectedEffort).toBe("high");
  });

  it("projects model-specific reasoning metadata into a Native Codex session", () => {
    const supportedReasoningEfforts = [
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultra",
    ].map((reasoningEffort) => ({
      reasoningEffort,
      description: reasoningEffort,
    }));
    const composerSelectionResolverRef: { current: unknown } = { current: null };
    const { result } = renderSection({
      activeEngine: "codex",
      activeThreadId: "codex-thread-native",
      activeProviderProfileId: null,
      composerSelectionResolverRef,
      models: [
        makeModel("gpt-5.6-sol", {
          supportedReasoningEfforts,
          defaultReasoningEffort: "low",
          isDefault: true,
        }),
      ],
      selectedComposerSelection: {
        modelId: "gpt-5.6-sol",
        effort: "ultra",
      },
    });

    expect(result.current.effectiveReasoningOptions).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultra",
    ]);
    expect(result.current.effectiveSelectedEffort).toBe("ultra");
    expect(composerSelectionResolverRef.current).toMatchObject({
      id: "gpt-5.6-sol",
      model: "gpt-5.6-sol",
      effort: "ultra",
    });
  });

  it("keeps explicit provider reasoning metadata authoritative", () => {
    const providerReasoning = [
      { reasoningEffort: "medium", description: "Provider medium" },
    ];
    const { result } = renderSection({
      activeEngine: "codex",
      activeThreadId: "codex-thread-1",
      activeProviderProfileId: "provider-a",
      engineModelsAsOptions: [
        makeModel("gpt-5.6-sol", {
          providerProfileId: "provider-a",
          supportedReasoningEfforts: providerReasoning,
          defaultReasoningEffort: "medium",
          isDefault: true,
        }),
      ],
      models: [
        makeModel("gpt-5.6-sol", {
          supportedReasoningEfforts: [
            { reasoningEffort: "high", description: "Global high" },
          ],
          defaultReasoningEffort: "high",
        }),
      ],
    });

    expect(result.current.effectiveModels[0]?.supportedReasoningEfforts).toBe(
      providerReasoning,
    );
    expect(result.current.effectiveModels[0]?.defaultReasoningEffort).toBe(
      "medium",
    );
  });

  it("does not infer reasoning support for an unknown provider-only Codex model", () => {
    const persistComposerSelectionForThread = vi.fn();
    const providerModel = makeModel("provider-only-model", {
      providerProfileId: "provider-a",
      isDefault: true,
    });
    const { result } = renderSection({
      activeEngine: "codex",
      activeThreadId: "codex-thread-1",
      activeProviderProfileId: "provider-a",
      engineModelsAsOptions: [providerModel],
      models: [makeModel("gpt-public")],
      persistComposerSelectionForThread,
      selectedComposerSelection: {
        modelId: "provider-only-model",
        effort: "high",
      },
    });

    expect(result.current.effectiveModels[0]).toBe(providerModel);
    expect(result.current.effectiveSelectedModelId).toBe("provider-only-model");
    expect(result.current.effectiveReasoningOptions).toEqual([]);
    expect(result.current.effectiveReasoningSupported).toBe(false);
    expect(result.current.effectiveSelectedEffort).toBeNull();
    expect(persistComposerSelectionForThread).toHaveBeenCalledOnce();
    expect(persistComposerSelectionForThread).toHaveBeenCalledWith(
      null,
      "codex-thread-1",
      {
        modelId: "provider-only-model",
        effort: null,
      },
    );
  });

  it("keeps a provider-only Codex selection without model repair", () => {
    const persistComposerSelectionForThread = vi.fn();
    const { result } = renderSection({
      activeEngine: "codex",
      activeThreadId: "codex-thread-minimax",
      activeWorkspaceId: "workspace-1",
      activeProviderProfileId: "minimax",
      engineModelsAsOptions: [],
      models: [makeModel("gpt-5.6-sol", { isDefault: true })],
      persistComposerSelectionForThread,
      selectedComposerSelection: {
        modelId: "MiniMax-M3",
        effort: null,
      },
    });

    expect(result.current.effectiveSelectedModelId).toBe("MiniMax-M3");
    expect(result.current.resolvedModel).toBe("MiniMax-M3");
    expect(persistComposerSelectionForThread).not.toHaveBeenCalled();
  });

  it("keeps Claude provider-bound reasoning options independent of model metadata", () => {
    const { result } = renderSection({
      activeEngine: "claude",
      activeThreadId: "claude-thread-1",
      activeProviderProfileId: "provider-a",
      engineModelsAsOptions: [
        makeModel("claude-provider-model", {
          providerProfileId: "provider-a",
          isDefault: true,
        }),
      ],
      selectedComposerSelection: {
        modelId: "claude-provider-model",
        effort: "xhigh",
      },
    });

    expect(result.current.effectiveReasoningOptions).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(result.current.effectiveReasoningSupported).toBe(true);
    expect(result.current.effectiveSelectedEffort).toBe("xhigh");
  });

  it("keeps an arbitrary Claude provider model while its catalog is unavailable", () => {
    const persistComposerSelectionForThread = vi.fn();
    const { result } = renderSection({
      activeEngine: "claude",
      activeThreadId: "claude-thread-minimax",
      activeWorkspaceId: "workspace-1",
      activeProviderProfileId: "minimax",
      engineModelsAsOptions: [],
      persistComposerSelectionForThread,
      selectedComposerSelection: {
        modelId: "MiniMax-M2.5",
        effort: "high",
      },
    });

    expect(result.current.effectiveSelectedModelId).toBe("MiniMax-M2.5");
    expect(result.current.resolvedModel).toBe("MiniMax-M2.5");
    expect(result.current.effectiveSelectedEffort).toBe("high");
    expect(persistComposerSelectionForThread).not.toHaveBeenCalled();
  });

  it("stores cross-engine picks under the owning engine and persists its pref", () => {
    const persistComposerEnginePref = vi.fn();
    const handleSelectComposerSelection = vi.fn();
    const setSelectedModelId = vi.fn();
    const { result } = renderSection({
      persistComposerEnginePref,
      handleSelectComposerSelection,
      setSelectedModelId,
    });

    act(() => {
      result.current.handleSelectModel("kimi-code/kimi-for-coding");
    });

    expect(result.current.engineSelectedModelIdByType.kimi).toBe(
      "kimi-code/kimi-for-coding",
    );
    expect(persistComposerEnginePref).toHaveBeenCalledWith("kimi", {
      modelId: "kimi-code/kimi-for-coding",
      effort: null,
    });
    expect(handleSelectComposerSelection).toHaveBeenCalledWith({
      modelId: "kimi-code/kimi-for-coding",
      effort: null,
    });
    expect(setSelectedModelId).not.toHaveBeenCalled();
  });

  it("keeps same-engine selection behavior unchanged", () => {
    const persistComposerEnginePref = vi.fn();
    const handleSelectComposerSelection = vi.fn();
    const { result } = renderSection({
      persistComposerEnginePref,
      handleSelectComposerSelection,
    });

    act(() => {
      result.current.handleSelectModel("claude-sonnet-4-6");
    });

    expect(result.current.engineSelectedModelIdByType.claude).toBe(
      "claude-sonnet-4-6",
    );
    expect(persistComposerEnginePref).toHaveBeenCalledWith("claude", {
      modelId: "claude-sonnet-4-6",
      effort: null,
    });
    expect(handleSelectComposerSelection).toHaveBeenCalledWith({
      modelId: "claude-sonnet-4-6",
      effort: null,
    });
  });

  it("accepts freeform model ids not present in engine catalogs", () => {
    const persistComposerEnginePref = vi.fn();
    const handleSelectComposerSelection = vi.fn();
    const setSelectedModelId = vi.fn();
    const { result } = renderSection({
      activeEngine: "codex",
      activeThreadId: "codex-thread-local",
      activeProviderProfileId: null,
      persistComposerEnginePref,
      handleSelectComposerSelection,
      setSelectedModelId,
    });

    act(() => {
      result.current.handleSelectModel("gpt-5.3-codex-spark");
    });

    expect(handleSelectComposerSelection).toHaveBeenCalledWith({
      modelId: "gpt-5.3-codex-spark",
      effort: null,
    });
    // Active codex thread keeps global selectedModelId for draft-less path only.
    expect(setSelectedModelId).not.toHaveBeenCalled();
  });

  it("preserves the managed Kimi Doubao alias outside the local CLI catalog", () => {
    const composerSelectionResolverRef: { current: unknown } = { current: null };
    const { result } = renderSection({
      activeEngine: "kimi",
      activeThreadId: "kimi:session-managed",
      activeProviderProfileId: "doge-token-matrix",
      composerSelectionResolverRef,
      engineModelsAsOptions: kimiModels,
      selectedComposerSelection: {
        modelId: "豆包",
        effort: null,
      },
    });

    expect(result.current.effectiveSelectedModelId).toBe("豆包");
    expect(result.current.effectiveSelectedModel).toBeNull();
    expect(result.current.resolvedModel).toBe("豆包");
    expect(composerSelectionResolverRef.current).toMatchObject({
      id: "豆包",
      model: "豆包",
      effort: null,
    });
  });

  it("keeps a Native custom Codex model capability-neutral", () => {
    const composerSelectionResolverRef: { current: unknown } = { current: null };
    const { result } = renderSection({
      activeEngine: "codex",
      activeThreadId: "codex-thread-native-custom",
      activeProviderProfileId: null,
      composerSelectionResolverRef,
      models: [makeModel("gpt-5.6-sol", { isDefault: true })],
      selectedComposerSelection: {
        modelId: "gpt-5.3-codex-spark",
        effort: null,
      },
    });

    expect(result.current.effectiveSelectedModelId).toBe("gpt-5.3-codex-spark");
    expect(result.current.effectiveSelectedModel).toBeNull();
    expect(result.current.effectiveReasoningOptions).toEqual([]);
    expect(result.current.effectiveReasoningSupported).toBe(false);
    expect(result.current.effectiveSelectedEffort).toBeNull();
    expect(result.current.resolvedModel).toBe("gpt-5.3-codex-spark");
    expect(composerSelectionResolverRef.current).toMatchObject({
      id: "gpt-5.3-codex-spark",
      model: "gpt-5.3-codex-spark",
      effort: null,
    });
  });
});
