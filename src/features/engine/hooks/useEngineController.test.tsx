// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEngineController } from "./useEngineController";
import {
  detectEngines,
  getActiveEngine,
  getEngineModels,
  isWebServiceRuntime,
  runCodexDoctor,
  switchEngine,
} from "../../../services/tauri";
import {
  getClientStoreSync,
  writeClientStoreValue,
} from "../../../services/clientStorage";
import { activateAccountEngineV1 } from "../../../services/accountEngineCommands";
import type { DebugEntry, EngineStatus } from "../../../types";
import { STORAGE_KEYS as MODEL_STORAGE_KEYS } from "../../models/constants";
import { STORAGE_KEYS as PROVIDER_STORAGE_KEYS } from "../../composer/types/provider";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

vi.mock("../../../services/tauri", () => ({
  detectEngines: vi.fn(),
  getActiveEngine: vi.fn(),
  getEngineModels: vi.fn(),
  isWebServiceRuntime: vi.fn(),
  runCodexDoctor: vi.fn(),
  switchEngine: vi.fn(),
}));
vi.mock("../../../services/clientStorage", () => ({
  getClientStoreSync: vi.fn(),
  writeClientStoreValue: vi.fn(),
}));
vi.mock("../../../services/accountEngineCommands", () => ({
  activateAccountEngineV1: vi.fn(),
}));

const detectEnginesMock = vi.mocked(detectEngines);
const getActiveEngineMock = vi.mocked(getActiveEngine);
const getEngineModelsMock = vi.mocked(getEngineModels);
const isWebServiceRuntimeMock = vi.mocked(isWebServiceRuntime);
const runCodexDoctorMock = vi.mocked(runCodexDoctor);
const switchEngineMock = vi.mocked(switchEngine);
const getClientStoreSyncMock = vi.mocked(getClientStoreSync);
const writeClientStoreValueMock = vi.mocked(writeClientStoreValue);
const activateAccountEngineMock = vi.mocked(activateAccountEngineV1);

const { inspectManagedCodexMock } = vi.hoisted(() => ({
  inspectManagedCodexMock: vi.fn(),
}));

vi.mock("../../account/runtime/managedEngineToolchain", () => ({
  createManagedEngineToolchainClientV1: () => ({
    inspect: inspectManagedCodexMock,
  }),
}));

function createEngineStatus(
  engineType: EngineStatus["engineType"],
  installed: boolean,
  models: EngineStatus["models"] = [],
): EngineStatus {
  return {
    engineType,
    installed,
    version: installed ? "1.0.0" : null,
    binPath: null,
    features: {
      streaming: true,
      reasoning: true,
      toolUse: true,
      imageInput: true,
      sessionContinuation: true,
    },
    models,
    error: installed ? null : "not installed",
  };
}

describe("useEngineController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    isWebServiceRuntimeMock.mockReturnValue(false);
    switchEngineMock.mockResolvedValue(undefined);
    runCodexDoctorMock.mockResolvedValue({
      ok: false,
      codexBin: null,
      version: null,
      appServerOk: false,
      details: "not found",
      path: null,
      nodeOk: true,
      nodeVersion: "v20.0.0",
      nodeDetails: null,
    });
    getClientStoreSyncMock.mockReturnValue(undefined);
    writeClientStoreValueMock.mockReset();
    activateAccountEngineMock.mockReset();
    activateAccountEngineMock.mockResolvedValue(undefined);
    inspectManagedCodexMock.mockResolvedValue({
      ok: false,
      error: { code: "managed-toolchain-unavailable" },
    });
  });

  it("preserves default flag when custom claude model overrides same id", async () => {
    const claudeModels: EngineStatus["models"] = [
      {
        id: "claude-sonnet-4-6",
        displayName: "Sonnet 4.6",
        description: "default",
        isDefault: true,
      },
      {
        id: "claude-haiku-4-5",
        displayName: "Haiku 4.5",
        description: "",
        isDefault: false,
      },
    ];
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: claudeModels,
        error: null,
      },
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue(claudeModels);
    window.localStorage.setItem(
      PROVIDER_STORAGE_KEYS.CLAUDE_CUSTOM_MODELS,
      JSON.stringify([
        {
          id: "claude-sonnet-4-6",
          label: "Custom Sonnet Alias",
          description: "custom",
        },
      ]),
    );

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    await waitFor(() =>
      expect(result.current.engineModelsAsOptions.length).toBeGreaterThan(0),
    );

    const sonnet = result.current.engineModelsAsOptions.find(
      (model) => model.id === "claude-sonnet-4-6",
    );
    expect(sonnet).toBeDefined();
    expect(sonnet?.displayName).toBe("Custom Sonnet Alias");
    expect(sonnet?.isDefault).toBe(true);
  });

  it("passes custom Claude model values through the runtime model field", async () => {
    const claudeModels: EngineStatus["models"] = [
      {
        id: "sonnet",
        model: "sonnet",
        displayName: "Sonnet",
        description: "default",
        isDefault: true,
      },
    ];
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: claudeModels,
        error: null,
      },
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue(claudeModels);
    window.localStorage.setItem(
      PROVIDER_STORAGE_KEYS.CLAUDE_CUSTOM_MODELS,
      JSON.stringify([{ id: "Cxn[1m]", label: "Cxn[1m]", description: "custom 1m" }]),
    );

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    await waitFor(() =>
      expect(result.current.engineModelsAsOptions.length).toBeGreaterThan(0),
    );

    const customModel = result.current.engineModelsAsOptions.find(
      (model) => model.id === "Cxn[1m]",
    );
    expect(customModel).toBeDefined();
    expect(customModel?.displayName).toBe("Cxn[1m]");
    expect(customModel?.model).toBe("Cxn[1m]");
    expect(customModel?.source).toBe("custom");
  });

  it("preserves Claude runtime model and source metadata from backend catalog", async () => {
    const claudeModels: EngineStatus["models"] = [
      {
        id: "claude-sonnet-option",
        model: "sonnet",
        displayName: "Sonnet",
        description: "Discovered",
        source: "cli-discovered",
        isDefault: true,
      },
    ];
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: claudeModels,
        error: null,
      },
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue(claudeModels);

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    const sonnet = result.current.engineModelsAsOptions.find(
      (model) => model.id === "claude-sonnet-option",
    );
    expect(sonnet?.model).toBe("sonnet");
    expect(sonnet?.source).toBe("cli-discovered");
  });

  it("does not apply stale local Claude model mapping to backend dynamic models", async () => {
    const claudeModels: EngineStatus["models"] = [
      {
        id: "settings-main",
        model: "deepseek-v4-pro",
        displayName: "deepseek-v4-pro",
        description: "Configured in ~/.claude/settings.json",
        source: "settings-override",
        isDefault: true,
      },
      {
        id: "settings-sonnet",
        model: "kimi-for-coding",
        displayName: "kimi-for-coding",
        description: "Configured in ~/.claude/settings.json",
        source: "settings-override",
        isDefault: false,
      },
    ];
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: claudeModels,
        error: null,
      },
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue(claudeModels);
    window.localStorage.setItem(
      MODEL_STORAGE_KEYS.CLAUDE_MODEL_MAPPING,
      JSON.stringify({
        main: "MiniMax-M2.7",
        sonnet: "MiniMax-M2.7",
        opus: "MiniMax-M2.7",
        haiku: "MiniMax-M2.7",
      }),
    );

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    await waitFor(() =>
      expect(result.current.engineModelsAsOptions.length).toBeGreaterThan(0),
    );

    const modelNames = result.current.engineModelsAsOptions.map(
      (model) => model.model,
    );
    const displayNames = result.current.engineModelsAsOptions.map(
      (model) => model.displayName,
    );
    expect(modelNames).toContain("deepseek-v4-pro");
    expect(modelNames).toContain("kimi-for-coding");
    expect(displayNames).toContain("deepseek-v4-pro");
    expect(displayNames).toContain("kimi-for-coding");
    expect(modelNames).not.toContain("MiniMax-M2.7");
    expect(displayNames).not.toContain("MiniMax-M2.7");
  });

  it("normalizes legacy Claude model payload source to unknown", async () => {
    const claudeModels: EngineStatus["models"] = [
      {
        id: "legacy-claude-model",
        displayName: "Legacy",
        description: "legacy",
        isDefault: true,
      },
    ];
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: claudeModels,
        error: null,
      },
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue(claudeModels);

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    const legacy = result.current.engineModelsAsOptions.find(
      (model) => model.id === "legacy-claude-model",
    );
    expect(legacy?.model).toBe("legacy-claude-model");
    expect(legacy?.source).toBe("unknown");
  });

  it("loads legacy claude custom model entries even when label is missing", async () => {
    const claudeModels: EngineStatus["models"] = [
      {
        id: "claude-sonnet-4-6",
        displayName: "Sonnet 4.6",
        description: "default",
        isDefault: true,
      },
    ];
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: claudeModels,
        error: null,
      },
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue(claudeModels);
    window.localStorage.setItem(
      PROVIDER_STORAGE_KEYS.CLAUDE_CUSTOM_MODELS,
      JSON.stringify([
        {
          id: "GLM-5.1",
        },
      ]),
    );

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    await waitFor(() =>
      expect(result.current.engineModelsAsOptions.length).toBeGreaterThan(0),
    );

    const legacyModel = result.current.engineModelsAsOptions.find(
      (model) => model.id === "GLM-5.1",
    );
    expect(legacyModel).toBeDefined();
    expect(legacyModel?.displayName).toBe("GLM-5.1");
  });

  it("keeps user-entered claude custom model ids while filtering only malformed entries", async () => {
    const claudeModels: EngineStatus["models"] = [
      {
        id: "claude-sonnet-4-6",
        displayName: "Sonnet 4.6",
        description: "default",
        isDefault: true,
      },
    ];
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: claudeModels,
        error: null,
      },
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue(claudeModels);
    window.localStorage.setItem(
      PROVIDER_STORAGE_KEYS.CLAUDE_CUSTOM_MODELS,
      JSON.stringify([
        { id: "GLM-5.1", label: "GLM", description: "ok" },
        { id: "GLM-5.1", label: "GLM duplicated", description: "dup" },
        { id: "provider/model:202603[beta]" },
        { id: "Haiku 4.5", label: "Haiku 4.5" },
        { id: "bad model with spaces", label: "Bad" },
        { id: "\u6a21\u578b 666", label: "\u6a21\u578b 666" },
        { id: "   ", label: "Blank" },
        null,
        { foo: "bar" },
      ]),
    );

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    await waitFor(() =>
      expect(result.current.engineModelsAsOptions.length).toBeGreaterThan(0),
    );

    const glmModels = result.current.engineModelsAsOptions.filter(
      (model) => model.id === "GLM-5.1",
    );
    expect(glmModels).toHaveLength(1);
    expect(glmModels[0]?.displayName).toBe("GLM");

    const bracketModel = result.current.engineModelsAsOptions.find(
      (model) => model.id === "provider/model:202603[beta]",
    );
    expect(bracketModel).toBeDefined();
    expect(bracketModel?.displayName).toBe("provider/model:202603[beta]");

    const spacedModel = result.current.engineModelsAsOptions.find(
      (model) => model.id === "Haiku 4.5",
    );
    expect(spacedModel).toBeDefined();
    expect(spacedModel?.model).toBe("Haiku 4.5");
    expect(spacedModel?.displayName).toBe("Haiku 4.5");

    const arbitrarySpacedModel = result.current.engineModelsAsOptions.find(
      (model) => model.id === "bad model with spaces",
    );
    expect(arbitrarySpacedModel).toBeDefined();
    expect(arbitrarySpacedModel?.model).toBe("bad model with spaces");
    expect(arbitrarySpacedModel?.displayName).toBe("Bad");

    const unicodeModel = result.current.engineModelsAsOptions.find(
      (model) => model.id === "\u6a21\u578b 666",
    );
    expect(unicodeModel).toBeDefined();
    expect(unicodeModel?.model).toBe("\u6a21\u578b 666");

    const blankModel = result.current.engineModelsAsOptions.find(
      (model) => model.displayName === "Blank",
    );
    expect(blankModel).toBeUndefined();
  });

  it("marks every engine as loading before detection finishes", () => {
    detectEnginesMock.mockImplementation(
      () => new Promise<EngineStatus[]>((_resolve) => undefined),
    );
    getActiveEngineMock.mockImplementation(
      () => new Promise<"claude">((_resolve) => undefined),
    );

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    expect(result.current.availableEngines.map((engine) => engine.type)).toEqual([
      "claude",
      "codex",
      "grok",
      "kimi",
      "opencode",
    ]);
    expect(
      result.current.availableEngines.every(
        (engine) => engine.availabilityState === "loading",
      ),
    ).toBe(true);
  });

  it("keeps the facade snapshot stable across unrelated parent renders", () => {
    detectEnginesMock.mockImplementation(
      () => new Promise<EngineStatus[]>((_resolve) => undefined),
    );
    getActiveEngineMock.mockImplementation(
      () => new Promise<"claude">((_resolve) => undefined),
    );

    const { result, rerender } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );
    const firstSnapshot = result.current;
    rerender();

    expect(result.current).toBe(firstSnapshot);
  });

  it("shows detected OpenCode in production engine surfaces", async () => {
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
        binPath: null,
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
      {
        engineType: "codex",
        installed: true,
        version: "1.0.0",
        binPath: null,
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
      {
        engineType: "gemini",
        installed: true,
        version: "1.0.0",
        binPath: null,
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
      {
        engineType: "opencode",
        installed: true,
        version: "1.4.4",
        binPath: null,
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
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue([]);

    const { result } = renderHook(() =>
      useEngineController({
        activeWorkspace: {
          id: "ws-1",
          name: "mossx",
          path: "/tmp/mossx",
          connected: true,
          kind: "main",
          settings: {
            sidebarCollapsed: false,
            worktreeSetupScript: null,
          },
        },
      }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    const opencodeEngine = result.current.availableEngines.find(
      (engine) => engine.type === "opencode",
    );
    expect(opencodeEngine).toBeDefined();
    expect(opencodeEngine?.installed).toBe(true);
    expect(opencodeEngine?.availabilityState).toBe("ready");
    expect(
      result.current.availableEngines.some((engine) => engine.type === "gemini"),
    ).toBe(false);
  });

  it("hides disabled Gemini engine from available engine surfaces", async () => {
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
        binPath: null,
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
      {
        engineType: "gemini",
        installed: true,
        version: "1.0.0",
        binPath: null,
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
      {
        engineType: "opencode",
        installed: true,
        version: "1.4.4",
        binPath: null,
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
    ]);
    getActiveEngineMock.mockResolvedValue("opencode");
    getEngineModelsMock.mockResolvedValue([]);

    const { result } = renderHook(() =>
      useEngineController({
        activeWorkspace: null,
      }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    expect(result.current.availableEngines.map((engine) => engine.type)).toEqual([
      "claude",
      "codex",
      "grok",
      "kimi",
      "opencode",
    ]);
    expect(result.current.activeEngine).toBe("opencode");
  });

  it("initializes one-shot activeEngine from persisted selection without native switching", async () => {
    getClientStoreSyncMock.mockReturnValue("grok");
    const detectDeferred = createDeferred<EngineStatus[]>();
    const activeEngineDeferred = createDeferred<"claude">();
    detectEnginesMock.mockReturnValueOnce(detectDeferred.promise);
    getActiveEngineMock.mockReturnValueOnce(activeEngineDeferred.promise);
    getEngineModelsMock.mockResolvedValue([]);

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    // 首屏必须已经是上次选择，不能先渲染 claude 再异步跳回
    expect(result.current.activeEngine).toBe("grok");

    detectDeferred.resolve([
      createEngineStatus("claude", true),
      createEngineStatus("grok", true),
    ]);
    activeEngineDeferred.resolve("claude");

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    expect(result.current.activeEngine).toBe("grok");
    expect(switchEngineMock).not.toHaveBeenCalledWith("grok");
  });

  it("ignores a legacy persisted Gemini execution selection", async () => {
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
        binPath: null,
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
      {
        engineType: "gemini",
        installed: true,
        version: "1.0.0",
        binPath: null,
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
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue([]);
    getClientStoreSyncMock.mockReturnValue("gemini");

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    expect(result.current.activeEngine).toBe("claude");
    expect(result.current.availableEngines.some((engine) => engine.type === "gemini")).toBe(false);
    expect(switchEngineMock).not.toHaveBeenCalledWith("gemini");
    expect(getEngineModelsMock).not.toHaveBeenCalledWith("gemini");
  });

  it("falls back from a legacy active Gemini runtime without native switching", async () => {
    detectEnginesMock.mockResolvedValue([
      createEngineStatus("claude", true),
      createEngineStatus("gemini", true),
    ]);
    getActiveEngineMock.mockResolvedValue("gemini");
    getEngineModelsMock.mockResolvedValue([]);

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    expect(result.current.activeEngine).toBe("claude");
    expect(switchEngineMock).not.toHaveBeenCalledWith("claude");
    expect(switchEngineMock).not.toHaveBeenCalledWith("gemini");
    expect(getEngineModelsMock).not.toHaveBeenCalledWith("gemini");
  });

  it("rejects direct Gemini switch and model refresh requests", async () => {
    detectEnginesMock.mockResolvedValue([
      createEngineStatus("claude", true),
      createEngineStatus("gemini", true),
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue([]);

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );
    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    switchEngineMock.mockClear();
    getEngineModelsMock.mockClear();

    await act(async () => {
      await result.current.setActiveEngine("gemini");
      await result.current.refreshEngineModels("gemini", {
        forceRefresh: true,
      });
    });

    expect(result.current.activeEngine).toBe("claude");
    expect(switchEngineMock).not.toHaveBeenCalled();
    expect(getEngineModelsMock).not.toHaveBeenCalled();
  });

  it("refreshEngineModels reloads only the requested engine catalog", async () => {
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
        binPath: null,
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
      {
        engineType: "opencode",
        installed: true,
        version: "1.4.4",
        binPath: null,
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
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue([]);

    const { result } = renderHook(() =>
      useEngineController({
        activeWorkspace: {
          id: "ws-1",
          name: "mossx",
          path: "/tmp/mossx",
          connected: true,
          kind: "main",
          settings: {
            sidebarCollapsed: false,
            worktreeSetupScript: null,
          },
        },
      }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    expect(getEngineModelsMock).toHaveBeenCalledWith("claude");

    getEngineModelsMock.mockClear();

    await act(async () => {
      await result.current.refreshEngineModels("claude");
    });

    expect(getEngineModelsMock).toHaveBeenCalledTimes(1);
    expect(getEngineModelsMock).toHaveBeenCalledWith("claude");
    expect(getEngineModelsMock).not.toHaveBeenCalledWith("opencode");
  });

  it("does not refresh opencode when claude models are manually refreshed", async () => {
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
        binPath: null,
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
      {
        engineType: "opencode",
        installed: true,
        version: "1.4.4",
        binPath: null,
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
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue([]);

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    getEngineModelsMock.mockClear();

    await act(async () => {
      await result.current.refreshEngineModels("claude");
    });

    expect(getEngineModelsMock).toHaveBeenCalledTimes(1);
    expect(getEngineModelsMock).toHaveBeenCalledWith("claude");
  });

  it("passes force refresh when manually reloading the requested engine catalog", async () => {
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: [
          {
            id: "claude-sonnet-4-6",
            displayName: "Sonnet 4.6",
            description: "cached",
            isDefault: true,
          },
        ],
        error: null,
      },
      {
        engineType: "opencode",
        installed: true,
        version: "1.4.4",
        binPath: null,
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
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValueOnce([
      {
        id: "claude-sonnet-4-6",
        displayName: "Sonnet 4.6",
        description: "cached",
        isDefault: true,
      },
    ]);

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    getEngineModelsMock.mockClear();
    getEngineModelsMock.mockResolvedValueOnce([
      {
        id: "glm-5.1",
        displayName: "GLM-5.1",
        description: "Configured in ~/.claude/settings.json",
        isDefault: true,
      },
    ]);

    await act(async () => {
      await result.current.refreshEngineModels("claude", { forceRefresh: true });
    });

    expect(getEngineModelsMock).toHaveBeenCalledTimes(1);
    expect(getEngineModelsMock).toHaveBeenCalledWith("claude", {
      forceRefresh: true,
    });
    expect(getEngineModelsMock).not.toHaveBeenCalledWith("opencode");
    expect(result.current.engineModelsAsOptions[0]?.id).toBe("glm-5.1");
  });

  it("loads and retains provider-scoped model origin metadata", async () => {
    const claudeModels: EngineStatus["models"] = [
      {
        id: "claude-opus-4-8",
        displayName: "Opus 4.8",
        description: "public",
        isDefault: true,
      },
    ];
    detectEnginesMock.mockResolvedValue([
      createEngineStatus("claude", true, claudeModels),
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValueOnce(claudeModels);

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );
    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    getEngineModelsMock.mockClear();
    getEngineModelsMock.mockResolvedValueOnce([
      {
        id: "settings-main",
        model: "provider-a-model",
        displayName: "Provider A",
        description: "provider",
        source: "settings-override",
        providerProfileId: "provider-a",
        isDefault: true,
      },
      ...claudeModels,
    ]);

    await act(async () => {
      await result.current.refreshEngineModels("claude", {
        providerProfileId: "provider-a",
      });
    });

    expect(getEngineModelsMock).toHaveBeenCalledWith("claude", {
      providerProfileId: "provider-a",
    });
    expect(result.current.engineModelsAsOptions[0]).toEqual(
      expect.objectContaining({
        id: "settings-main",
        model: "provider-a-model",
        providerProfileId: "provider-a",
      }),
    );
  });

  it("does not publish a stale provider catalog after the active scope changes", async () => {
    const publicModels: EngineStatus["models"] = [
      {
        id: "claude-opus-4-8",
        displayName: "Opus 4.8",
        description: "public",
        isDefault: true,
      },
    ];
    detectEnginesMock.mockResolvedValue([
      createEngineStatus("claude", true, publicModels),
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValueOnce(publicModels);

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );
    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    const providerARequest = createDeferred<EngineStatus["models"]>();
    getEngineModelsMock.mockReset();
    getEngineModelsMock
      .mockImplementationOnce(() => providerARequest.promise)
      .mockResolvedValueOnce([
        {
          id: "provider-b-model",
          displayName: "Provider B",
          description: "provider",
          providerProfileId: "provider-b",
          isDefault: true,
        },
        ...publicModels,
      ]);

    let providerAPromise: Promise<unknown> = Promise.resolve();
    let providerBPromise: Promise<unknown> = Promise.resolve();
    act(() => {
      providerAPromise = result.current.refreshEngineModels("claude", {
        providerProfileId: "provider-a",
      });
      providerBPromise = result.current.refreshEngineModels("claude", {
        providerProfileId: "provider-b",
      });
    });

    providerARequest.resolve([
      {
        id: "provider-a-model",
        displayName: "Provider A",
        description: "provider",
        providerProfileId: "provider-a",
        isDefault: true,
      },
      ...publicModels,
    ]);
    await act(async () => {
      await Promise.all([providerAPromise, providerBPromise]);
    });

    expect(result.current.engineModelsAsOptions[0]).toEqual(
      expect.objectContaining({
        id: "provider-b-model",
        providerProfileId: "provider-b",
      }),
    );
    expect(
      result.current.engineModelsAsOptions.some(
        (model) => model.providerProfileId === "provider-a",
      ),
    ).toBe(false);
  });

  it("hides the previous scope while a provider catalog is loading", async () => {
    const publicModels: EngineStatus["models"] = [
      {
        id: "gpt-5.5",
        displayName: "gpt-5.5",
        description: "global",
        isDefault: true,
      },
    ];
    detectEnginesMock.mockResolvedValue([
      createEngineStatus("claude", true, publicModels),
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValueOnce(publicModels);

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );
    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    expect(result.current.engineModelsAsOptions[0]?.id).toBe("gpt-5.5");

    const deepSeekRequest = createDeferred<EngineStatus["models"]>();
    getEngineModelsMock.mockReset();
    getEngineModelsMock.mockImplementationOnce(() => deepSeekRequest.promise);

    let refreshPromise: Promise<unknown> = Promise.resolve();
    act(() => {
      refreshPromise = result.current.refreshEngineModels("claude", {
        providerProfileId: "provider-deepseek",
      });
    });

    expect(result.current.engineModelsAsOptions).toEqual([]);

    deepSeekRequest.resolve([
      {
        id: "deepseek-v4-pro",
        displayName: "deepseek-v4-pro",
        description: "provider",
        providerProfileId: "provider-deepseek",
        isDefault: true,
      },
    ]);
    await act(async () => {
      await refreshPromise;
    });

    expect(result.current.engineModelsAsOptions).toEqual([
      expect.objectContaining({
        id: "deepseek-v4-pro",
        providerProfileId: "provider-deepseek",
        isDefault: true,
      }),
    ]);
    expect(
      result.current.engineModelsAsOptions.some(
        (model) => model.id === "gpt-5.5",
      ),
    ).toBe(false);
  });

  it("retains the same provider last-good catalog when refresh fails", async () => {
    const publicModels: EngineStatus["models"] = [
      {
        id: "claude-opus-4-8",
        displayName: "Opus 4.8",
        description: "public",
        isDefault: true,
      },
    ];
    detectEnginesMock.mockResolvedValue([
      createEngineStatus("claude", true, publicModels),
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValueOnce(publicModels);
    const onDebug = vi.fn();

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null, onDebug }),
    );
    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    getEngineModelsMock.mockResolvedValueOnce([
      {
        id: "provider-a-model",
        displayName: "Provider A",
        description: "provider",
        providerProfileId: "provider-a",
        isDefault: true,
      },
      ...publicModels,
    ]);
    await act(async () => {
      await result.current.refreshEngineModels("claude", {
        providerProfileId: "provider-a",
      });
    });

    getEngineModelsMock.mockRejectedValueOnce(
      new Error("provider-a config is unreadable"),
    );
    await act(async () => {
      await result.current.refreshEngineModels("claude", {
        forceRefresh: true,
        providerProfileId: "provider-a",
      });
    });

    expect(result.current.engineModelsAsOptions[0]).toEqual(
      expect.objectContaining({
        id: "provider-a-model",
        providerProfileId: "provider-a",
      }),
    );
    expect(onDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "engine/models load error",
        payload: expect.objectContaining({
          engine: "claude",
          providerProfileId: "provider-a",
          error: "provider-a config is unreadable",
        }),
      }),
    );
  });

  it("fails closed for the managed provider instead of exposing local models", async () => {
    const localModels: EngineStatus["models"] = [
      {
        id: "settings-main",
        model: "stale-local-model",
        displayName: "Local settings",
        description: "disk",
        isDefault: true,
      },
    ];
    detectEnginesMock.mockResolvedValue([
      createEngineStatus("claude", true, localModels),
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValueOnce(localModels);

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );
    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    getEngineModelsMock.mockResolvedValueOnce([
      {
        id: "matrix-model",
        model: "gpt-5.5-codex",
        displayName: "Managed model",
        description: "provider",
        isDefault: true,
      },
    ]);
    await act(async () => {
      await result.current.refreshEngineModels("claude", {
        providerProfileId: "doge-token-matrix",
      });
    });
    expect(result.current.engineModelsAsOptions[0]).toEqual(
      expect.objectContaining({ providerProfileId: "doge-token-matrix" }),
    );

    getEngineModelsMock.mockRejectedValueOnce(new Error("managed catalog unavailable"));
    await act(async () => {
      await result.current.refreshEngineModels("claude", {
        forceRefresh: true,
        providerProfileId: "doge-token-matrix",
      });
    });

    expect(result.current.engineModelsAsOptions).toEqual([]);
    expect(
      result.current.engineModelsAsOptions.some(
        (model) => model.model === "stale-local-model",
      ),
    ).toBe(false);
  });

  it("preserves model state identity when a refresh is semantically unchanged", async () => {
    const models: EngineStatus["models"] = [
      {
        id: "provider-a-model",
        displayName: "Provider A",
        description: "provider",
        providerProfileId: "provider-a",
        isDefault: true,
      },
    ];
    detectEnginesMock.mockResolvedValue([
      createEngineStatus("claude", true, models),
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue(models);

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );
    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    await act(async () => {
      await result.current.refreshEngineModels("claude", {
        providerProfileId: "provider-a",
      });
    });
    const firstCatalog = result.current.engineModels;

    await act(async () => {
      await result.current.refreshEngineModels("claude", {
        providerProfileId: "provider-a",
      });
    });

    expect(result.current.engineModels).toBe(firstCatalog);
  });

  it("preserves the default flag when a custom Claude model shadows the default runtime model", async () => {
    const claudeModels: EngineStatus["models"] = [
      {
        id: "settings-main",
        model: "deepseek-v4-pro",
        displayName: "deepseek-v4-pro",
        description: "Configured in ~/.claude/settings.json",
        source: "settings-override",
        isDefault: true,
      },
      {
        id: "settings-reasoning",
        model: "deepseek-chat",
        displayName: "deepseek-chat",
        description: "Configured in ~/.claude/settings.json",
        source: "settings-override",
        isDefault: false,
      },
    ];
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: claudeModels,
        error: null,
      },
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue(claudeModels);
    window.localStorage.setItem(
      PROVIDER_STORAGE_KEYS.CLAUDE_CUSTOM_MODELS,
      JSON.stringify([
        { id: "deepseek-chat", label: "DeepSeek Chat" },
        { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
      ]),
    );

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    await waitFor(() =>
      expect(result.current.engineModelsAsOptions.length).toBeGreaterThan(0),
    );

    const customDefault = result.current.engineModelsAsOptions.find(
      (model) => model.id === "deepseek-v4-pro",
    );
    const customNonDefault = result.current.engineModelsAsOptions.find(
      (model) => model.id === "deepseek-chat",
    );

    expect(customDefault?.isDefault).toBe(true);
    expect(customNonDefault?.isDefault).toBe(false);
  });

  it("replaces stale Claude models after source switch force refresh", async () => {
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: [
          {
            id: "settings-main",
            model: "MiniMax-M1[1m]",
            displayName: "MiniMax-M1[1m]",
            description: "old source",
            source: "settings-override",
            isDefault: true,
          },
          {
            id: "settings-reasoning",
            model: "MiniMax-M2.7",
            displayName: "MiniMax-M2.7",
            description: "old source",
            source: "settings-override",
            isDefault: false,
          },
        ],
        error: null,
      },
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValueOnce([
      {
        id: "settings-main",
        model: "MiniMax-M1[1m]",
        displayName: "MiniMax-M1[1m]",
        description: "old source",
        source: "settings-override",
        isDefault: true,
      },
      {
        id: "settings-reasoning",
        model: "MiniMax-M2.7",
        displayName: "MiniMax-M2.7",
        description: "old source",
        source: "settings-override",
        isDefault: false,
      },
    ]);

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    getEngineModelsMock.mockClear();
    getEngineModelsMock.mockResolvedValueOnce([
      {
        id: "settings-main",
        model: "deepseek-v4-pro",
        displayName: "deepseek-v4-pro",
        description: "new source",
        source: "settings-override",
        isDefault: true,
      },
      {
        id: "settings-reasoning",
        model: "deepseek-chat",
        displayName: "deepseek-chat",
        description: "new source",
        source: "settings-override",
        isDefault: false,
      },
    ]);

    await act(async () => {
      await result.current.refreshEngineModels("claude", { forceRefresh: true });
    });

    const modelNames = result.current.engineModelsAsOptions.map(
      (model) => model.model ?? model.id,
    );
    expect(modelNames).toContain("deepseek-v4-pro");
    expect(modelNames).toContain("deepseek-chat");
    expect(modelNames).not.toContain("MiniMax-M1[1m]");
    expect(modelNames).not.toContain("MiniMax-M2.7");
  });

  it("refreshes active engine models on workspace switch without probing unrelated engines", async () => {
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
        binPath: null,
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
      {
        engineType: "opencode",
        installed: true,
        version: "1.4.4",
        binPath: null,
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
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue([]);

    const { rerender } = renderHook(
      ({ workspace }) => useEngineController({ activeWorkspace: workspace }),
      {
        initialProps: {
          workspace: {
            id: "ws-1",
            name: "mossx",
            path: "/tmp/mossx",
            connected: true,
            kind: "main" as const,
            settings: {
              sidebarCollapsed: false,
              worktreeSetupScript: null,
            },
          },
        },
      },
    );

    await waitFor(() => expect(getEngineModelsMock).toHaveBeenCalledWith("claude"));
    getEngineModelsMock.mockClear();

    rerender({
      workspace: {
        id: "ws-2",
        name: "mossx-2",
        path: "/tmp/mossx-2",
        connected: true,
        kind: "main" as const,
        settings: {
          sidebarCollapsed: false,
          worktreeSetupScript: null,
        },
      },
    });

    await waitFor(() => expect(getEngineModelsMock).toHaveBeenCalledWith("claude"));
    expect(getEngineModelsMock).not.toHaveBeenCalledWith("opencode");
  });

  it("reuses the in-flight engine detection when refresh is clicked during initial load", async () => {
    const detectDeferred = createDeferred<EngineStatus[]>();
    const activeEngineDeferred = createDeferred<"claude">();

    detectEnginesMock.mockReturnValueOnce(detectDeferred.promise);
    getActiveEngineMock.mockReturnValueOnce(activeEngineDeferred.promise);
    getEngineModelsMock.mockResolvedValue([]);

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    expect(result.current.isDetecting).toBe(true);
    expect(detectEnginesMock).toHaveBeenCalledTimes(1);

    let refreshSettled = false;
    let refreshResult:
      | Awaited<ReturnType<typeof result.current.refreshEngines>>
      | undefined;
    let refreshPromise: Promise<void>;
    act(() => {
      refreshPromise = result.current.refreshEngines().then((value) => {
        refreshResult = value;
        refreshSettled = true;
      });
    });

    await Promise.resolve();
    expect(detectEnginesMock).toHaveBeenCalledTimes(1);
    expect(refreshSettled).toBe(false);

    detectDeferred.resolve([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
        binPath: null,
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
    ]);
    activeEngineDeferred.resolve("claude");

    await act(async () => {
      await refreshPromise;
    });
    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    expect(refreshSettled).toBe(true);
    expect(detectEnginesMock).toHaveBeenCalledTimes(1);
    expect(refreshResult?.availableEngines.find((engine) => engine.type === "claude")?.installed).toBe(true);
  });

  it("refreshes stale engine status before switching", async () => {
    const codexModels: EngineStatus["models"] = [
      {
        id: "gpt-5",
        displayName: "GPT-5",
        description: "default",
        isDefault: true,
      },
    ];
    detectEnginesMock
      .mockResolvedValueOnce([
        createEngineStatus("claude", true),
        createEngineStatus("codex", false),
      ])
      .mockResolvedValueOnce([
        createEngineStatus("claude", true),
        createEngineStatus("codex", true, codexModels),
      ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue(codexModels);

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    await act(async () => {
      await result.current.setActiveEngine("codex");
    });

    expect(detectEnginesMock).toHaveBeenCalledTimes(2);
    expect(switchEngineMock).toHaveBeenCalledWith("codex");
    expect(runCodexDoctorMock).not.toHaveBeenCalled();
    expect(result.current.activeEngine).toBe("codex");
  });

  it("rechecks native runtime when React already displays Codex", async () => {
    const codexModels: EngineStatus["models"] = [
      {
        id: "gpt-5",
        displayName: "GPT-5",
        description: "default",
        isDefault: true,
      },
    ];
    getClientStoreSyncMock.mockReturnValue("codex");
    detectEnginesMock.mockResolvedValue([
      createEngineStatus("claude", true),
      createEngineStatus("codex", true, codexModels),
    ]);
    getActiveEngineMock
      .mockResolvedValueOnce("claude")
      .mockResolvedValueOnce("claude");
    getEngineModelsMock.mockResolvedValue(codexModels);

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    expect(result.current.activeEngine).toBe("codex");

    let activated = false;
    await act(async () => {
      activated = await result.current.setActiveEngine("codex", {
        ensureRuntime: true,
      });
    });

    expect(activated).toBe(true);
    expect(switchEngineMock).toHaveBeenCalledWith("codex");
    expect(switchEngineMock).toHaveBeenCalledTimes(2);
    expect(result.current.activeEngine).toBe("codex");
  });

  it("returns false when native engine switching fails", async () => {
    detectEnginesMock.mockResolvedValue([
      createEngineStatus("claude", true),
      createEngineStatus("codex", true),
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue([]);
    switchEngineMock.mockRejectedValueOnce(new Error("switch unavailable"));

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );
    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    let activated = true;
    await act(async () => {
      activated = await result.current.setActiveEngine("codex");
    });

    expect(activated).toBe(false);
    expect(result.current.activeEngine).toBe("claude");
  });

  it("activates one-shot Kimi for the UI without native installation gating", async () => {
    detectEnginesMock.mockResolvedValue([
      createEngineStatus("claude", true),
      createEngineStatus("kimi", false),
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue([]);

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );
    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    let activated = false;
    await act(async () => {
      activated = await result.current.setActiveEngine("kimi");
    });

    expect(activated).toBe(true);
    expect(result.current.activeEngine).toBe("kimi");
    expect(switchEngineMock).not.toHaveBeenCalledWith("kimi");
    expect(runCodexDoctorMock).not.toHaveBeenCalled();
  });

  it("treats verified managed Codex activation as the switch boundary", async () => {
    detectEnginesMock.mockResolvedValue([
      createEngineStatus("claude", true),
      createEngineStatus("codex", false),
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue([]);
    switchEngineMock.mockRejectedValueOnce(new Error("global Codex CLI unavailable"));

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );
    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    let activated = false;
    await act(async () => {
      activated = await result.current.setActiveEngine("codex", {
        ensureRuntime: true,
        providerProfileId: "doge-token-matrix",
      });
    });

    expect(activated).toBe(true);
    expect(activateAccountEngineMock).toHaveBeenCalledWith("codex");
    expect(switchEngineMock).not.toHaveBeenCalledWith("codex");
    expect(result.current.activeEngine).toBe("codex");
  });

  it("keeps managed Claude activation ahead of one-shot UI routing", async () => {
    detectEnginesMock.mockResolvedValue([
      createEngineStatus("claude", false),
      createEngineStatus("codex", true),
    ]);
    getActiveEngineMock.mockResolvedValue("codex");
    getEngineModelsMock.mockResolvedValue([]);

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );
    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    let activated = false;
    await act(async () => {
      activated = await result.current.setActiveEngine("claude", {
        ensureRuntime: true,
        providerProfileId: "doge-token-matrix",
      });
    });

    expect(activated).toBe(true);
    expect(activateAccountEngineMock).toHaveBeenCalledWith("claude-code");
    expect(result.current.activeEngine).toBe("claude");
  });

  it("exposes bundled Codex in the selector when the generic probe misses it", async () => {
    detectEnginesMock.mockResolvedValue([
      createEngineStatus("claude", true),
      createEngineStatus("codex", false),
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue([]);
    inspectManagedCodexMock.mockResolvedValue({
      ok: true,
      value: {
        engineId: "codex",
        status: "ready",
        bundledVersion: "0.147.0",
        externalVersion: null,
        selectedSource: "bundled",
      },
    });

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    expect(result.current.availableEngines.find((engine) => engine.type === "codex"))
      .toEqual(expect.objectContaining({
        installed: true,
        version: "0.147.0",
        availabilityState: "ready",
      }));
    expect(result.current.installedEngines.map((engine) => engine.type)).toContain(
      "codex",
    );

    await act(async () => {
      await result.current.setActiveEngine("codex");
    });

    expect(switchEngineMock).toHaveBeenCalledWith("codex");
    expect(runCodexDoctorMock).not.toHaveBeenCalled();
  });

  it("keeps the generic status and records managed Codex inspect failures", async () => {
    detectEnginesMock.mockResolvedValue([
      createEngineStatus("claude", true),
      createEngineStatus("codex", false),
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue([]);
    inspectManagedCodexMock.mockRejectedValue(new Error("command unavailable"));
    const onDebug = vi.fn();

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null, onDebug }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    expect(result.current.availableEngines.find((engine) => engine.type === "codex"))
      .toEqual(expect.objectContaining({
        installed: false,
        availabilityState: "unavailable",
      }));
    expect(onDebug).toHaveBeenCalledWith(expect.objectContaining({
      label: "engine/managed codex inspect error",
      payload: "command unavailable",
    }));
  });

  it("adds Codex doctor evidence when refreshed status is still unavailable", async () => {
    const debugEntries: Array<{ label: string; payload: unknown }> = [];
    const onDebug = (entry: DebugEntry) => {
      debugEntries.push({ label: entry.label, payload: entry.payload });
    };
    detectEnginesMock
      .mockResolvedValueOnce([
        createEngineStatus("claude", true),
        createEngineStatus("codex", false),
      ])
      .mockResolvedValueOnce([
        createEngineStatus("claude", true),
        createEngineStatus("codex", false),
      ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue([]);
    runCodexDoctorMock.mockResolvedValue({
      ok: true,
      codexBin: null,
      version: "codex-cli 0.135.0",
      appServerOk: true,
      details: null,
      path: "/opt/homebrew/bin:/usr/bin",
      pathEnvUsed: "/opt/homebrew/bin:/usr/bin",
      nodeOk: true,
      nodeVersion: "v20.0.0",
      nodeDetails: null,
      resolvedBinaryPath: "/opt/homebrew/bin/codex",
      environmentDiagnosis: {
        category: "gui-path-drift",
        message: "Codex is visible from fallback paths but not GUI PATH.",
        resolvedBinaryPath: "/opt/homebrew/bin/codex",
        missedByGuiPath: true,
      },
    });

    const { result } = renderHook(() =>
      useEngineController({
        activeWorkspace: null,
        onDebug,
      }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    await act(async () => {
      await result.current.setActiveEngine("codex");
    });

    expect(switchEngineMock).not.toHaveBeenCalled();
    expect(runCodexDoctorMock).toHaveBeenCalledWith(null, null);
    const switchError = debugEntries.find(
      (entry) => entry.label === "engine/switch error",
    );
    expect(switchError?.payload).toMatchObject({
      message: "Engine codex is not installed",
      doctorOk: true,
      resolvedBinaryPath: "/opt/homebrew/bin/codex",
      environmentDiagnosis: {
        category: "gui-path-drift",
        missedByGuiPath: true,
      },
    });
  });
});
