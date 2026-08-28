// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceInfo } from "../../../types";
import { useWorkspaceActions } from "./useWorkspaceActions";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  ensureRuntimeReady,
  isWebServiceRuntime,
  openNewWindow,
  pickWorkspacePath,
} from "../../../services/tauri";
import { pushGlobalRuntimeNotice } from "../../../services/globalRuntimeNotices";
import { pushErrorToast } from "../../../services/toasts";
import { ensureProductEngineReadyV1 } from "../../account/runtime/productEngineProvisioning";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      switch (key) {
        case "workspace.loadingProgressCreateSessionMessage":
          return `create:${String(options?.engine ?? "")}:${String(options?.workspace ?? "")}`;
        case "workspace.loadingProgressAddProjectMessage":
          return `add:${String(options?.project ?? "")}`;
        case "workspace.loadingProgressOpenProjectMessage":
          return `open:${String(options?.project ?? "")}`;
        case "errors.failedToCreateSessionRuntimeRecovering":
          return "errors.failedToCreateSessionRuntimeRecovering";
        case "errors.codexProviderWireApiUnsupported":
          return "errors.codexProviderWireApiUnsupported";
        case "errors.codexProviderConfigInvalid":
          return "errors.codexProviderConfigInvalid";
        case "errors.reconnectAndRetryCreateSession":
          return "errors.reconnectAndRetryCreateSession";
        case "errors.reconnectingAndRetryingCreateSession":
          return "errors.reconnectingAndRetryingCreateSession";
        case "errors.runtimeRecovered":
          return "errors.runtimeRecovered";
        case "errors.retryingCreateSessionAfterRecovery":
          return "errors.retryingCreateSessionAfterRecovery";
        default:
          return key;
      }
    },
  }),
}));

vi.mock("./useNewAgentShortcut", () => ({
  useNewAgentShortcut: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: vi.fn(),
}));

vi.mock("../../../services/tauri", () => ({
  openNewWindow: vi.fn(async () => undefined),
  pickWorkspacePath: vi.fn(async () => null),
  ensureRuntimeReady: vi.fn(async () => undefined),
  isWebServiceRuntime: vi.fn(() => false),
}));

vi.mock("../../../services/toasts", () => ({
  pushErrorToast: vi.fn(),
}));

vi.mock("../../../services/globalRuntimeNotices", () => ({
  pushGlobalRuntimeNotice: vi.fn(),
}));

vi.mock("../../account/runtime/productEngineProvisioning", () => ({
  ensureProductEngineReadyV1: vi.fn(async () => undefined),
}));

const baseWorkspace: WorkspaceInfo = {
  id: "ws-1",
  name: "Workspace",
  path: "/tmp/workspace",
  connected: true,
  settings: { sidebarCollapsed: false },
};

function makeOptions(overrides?: Partial<Parameters<typeof useWorkspaceActions>[0]>) {
  return {
    activeWorkspace: baseWorkspace,
    isCompact: false,
    activeEngine: "claude" as const,
    newAgentShortcut: null,
    setActiveEngine: vi.fn(async () => true),
    addWorkspace: vi.fn(async () => null),
    addWorkspaceFromPath: vi.fn(async () => null),
    connectWorkspace: vi.fn(async () => undefined),
    startThreadForWorkspace: vi.fn(async () => "thread-1"),
    setActiveThreadId: vi.fn(),
    setActiveTab: vi.fn(),
    exitDiffView: vi.fn(),
    selectWorkspace: vi.fn(),
    openWorktreePrompt: vi.fn(),
    openClonePrompt: vi.fn(),
    composerInputRef: { current: null },
    showLoadingProgressDialog: vi.fn(() => "loading-1"),
    hideLoadingProgressDialog: vi.fn(),
    onDebug: vi.fn(),
    ...overrides,
  };
}

describe("useWorkspaceActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isWebServiceRuntime).mockReturnValue(false);
    vi.stubGlobal("alert", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses selected engine for new session and switches active engine first", async () => {
    const workspace: WorkspaceInfo = { ...baseWorkspace, connected: false };
    const options = makeOptions({ activeEngine: "claude" });

    const { result } = renderHook(() => useWorkspaceActions(options));

    await act(async () => {
      const threadId = await result.current.handleAddAgent(workspace, "codex");
      expect(threadId).toBe("thread-1");
    });

    expect(options.selectWorkspace).toHaveBeenCalledWith("ws-1");
    expect(options.connectWorkspace).toHaveBeenCalledWith(workspace);
    expect(options.setActiveEngine).toHaveBeenCalledWith("codex", {
      ensureRuntime: true,
    });
    expect(options.startThreadForWorkspace).toHaveBeenCalledWith("ws-1", {
      engine: "codex",
    });
    expect(options.showLoadingProgressDialog).toHaveBeenCalledWith({
      title: "workspace.loadingProgressCreateSessionTitle",
      message: "create:workspace.engineCodex:Workspace",
    });
    expect(options.hideLoadingProgressDialog).toHaveBeenCalledWith("loading-1");
  });

  it("passes a managed provider to engine activation before creating", async () => {
    const options = makeOptions({ activeEngine: "kimi" });
    const { result } = renderHook(() => useWorkspaceActions(options));

    await act(async () => {
      await result.current.handleAddAgent(baseWorkspace, "codex", {
        providerProfileId: "doge-token-matrix",
        providerProfile: {
          id: "doge-token-matrix",
          name: "Doge",
          source: "managed",
        },
      });
    });

    expect(ensureProductEngineReadyV1).toHaveBeenCalledWith({
      engine: "codex",
      providerProfileId: "doge-token-matrix",
    });
    expect(options.setActiveEngine).toHaveBeenCalledWith("codex", {
      ensureRuntime: true,
      providerProfileId: "doge-token-matrix",
    });
    expect(options.startThreadForWorkspace).toHaveBeenCalledWith("ws-1", {
      engine: "codex",
      providerProfileId: "doge-token-matrix",
      providerProfile: {
        id: "doge-token-matrix",
        name: "Doge",
        source: "managed",
      },
    });
  });

  it("does not open the blocking session dialog when on-demand provisioning fails", async () => {
    vi.mocked(ensureProductEngineReadyV1).mockRejectedValueOnce(
      new Error("engine unavailable"),
    );
    const options = makeOptions({ activeEngine: "kimi" });
    const { result } = renderHook(() => useWorkspaceActions(options));

    let threadId: string | null = "unexpected";
    await act(async () => {
      threadId = await result.current.handleAddAgent(baseWorkspace, "codex", {
        providerProfileId: "doge-token-matrix",
      });
    });

    expect(threadId).toBeNull();
    expect(options.showLoadingProgressDialog).not.toHaveBeenCalled();
    expect(options.setActiveEngine).not.toHaveBeenCalled();
    expect(options.startThreadForWorkspace).not.toHaveBeenCalled();
  });

  it("creates a session with the active OpenCode engine when no explicit engine is provided", async () => {
    const options = makeOptions({ activeEngine: "opencode" });

    const { result } = renderHook(() => useWorkspaceActions(options));

    let threadId: string | null = null;
    await act(async () => {
      threadId = await result.current.handleAddAgent(baseWorkspace);
    });

    expect(threadId).toBe("thread-1");
    expect(options.setActiveEngine).toHaveBeenCalledWith("opencode");
    expect(options.startThreadForWorkspace).toHaveBeenCalledWith("ws-1", {
      engine: "opencode",
    });
  });

  it("keeps Kimi one-shot creation independent from native active-engine confirmation", async () => {
    const options = makeOptions({
      activeEngine: "kimi",
      setActiveEngine: vi.fn(async () => false),
    });
    const { result } = renderHook(() => useWorkspaceActions(options));

    let threadId: string | null = null;
    await act(async () => {
      threadId = await result.current.handleAddAgent(baseWorkspace, "kimi", {
        providerProfileId: "provider-kimi",
      });
    });

    expect(threadId).toBe("thread-1");
    expect(options.setActiveEngine).toHaveBeenCalledWith("kimi", {
      providerProfileId: "provider-kimi",
    });
    expect(options.startThreadForWorkspace).toHaveBeenCalledWith("ws-1", {
      engine: "kimi",
      providerProfileId: "provider-kimi",
    });
    expect(pushErrorToast).not.toHaveBeenCalled();
  });

  it("does not start a session when the requested engine cannot be activated", async () => {
    const options = makeOptions({
      activeEngine: "codex",
      setActiveEngine: vi.fn(async () => false),
    });
    const { result } = renderHook(() => useWorkspaceActions(options));

    await act(async () => {
      const threadId = await result.current.handleAddAgent(baseWorkspace, "codex");
      expect(threadId).toBeNull();
    });

    expect(options.setActiveEngine).toHaveBeenCalledWith("codex", {
      ensureRuntime: true,
    });
    expect(options.startThreadForWorkspace).not.toHaveBeenCalled();
    expect(options.onDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "workspace/create-session error",
        payload: expect.objectContaining({
          engine: "codex",
          error: "ENGINE_SWITCH_FAILED:codex",
        }),
      }),
    );
    expect(pushErrorToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "errors.failedToCreateSession",
        message: "errors.failedToCreateSession",
        sticky: true,
      }),
    );
  });

  it("rejects Gemini session creation before switching or starting a thread", async () => {
    const options = makeOptions({ activeEngine: "claude" });
    const { result } = renderHook(() => useWorkspaceActions(options));

    await act(async () => {
      const threadId = await result.current.handleAddAgent(
        baseWorkspace,
        "gemini",
      );
      expect(threadId).toBeNull();
    });

    expect(options.setActiveEngine).not.toHaveBeenCalled();
    expect(options.startThreadForWorkspace).not.toHaveBeenCalled();
    expect(options.connectWorkspace).not.toHaveBeenCalled();
    expect(options.showLoadingProgressDialog).not.toHaveBeenCalled();
    expect(options.onDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "workspace/create-session disabled engine",
        payload: expect.objectContaining({
          engine: "gemini",
          error: "unsupported_engine",
        }),
      }),
    );
  });

  it("adds workspace to current window when open mode is current", async () => {
    vi.mocked(pickWorkspacePath).mockResolvedValue("/tmp/new-repo");
    vi.mocked(ask).mockResolvedValueOnce(true);
    const options = makeOptions({
      addWorkspaceFromPath: vi.fn(async () => ({
        id: "ws-2",
        name: "new-repo",
        path: "/tmp/new-repo",
        connected: true,
        settings: { sidebarCollapsed: false },
      })),
    });
    const { result } = renderHook(() => useWorkspaceActions(options));

    await act(async () => {
      await result.current.handleAddWorkspace();
    });

    expect(options.addWorkspaceFromPath).toHaveBeenCalledWith("/tmp/new-repo");
    expect(openNewWindow).not.toHaveBeenCalled();
    expect(options.showLoadingProgressDialog).toHaveBeenCalledWith({
      title: "workspace.loadingProgressAddProjectTitle",
      message: "add:new-repo",
    });
    expect(options.hideLoadingProgressDialog).toHaveBeenCalledWith("loading-1");
  });

  it("uses manual remote path entry in web service runtime", async () => {
    vi.mocked(isWebServiceRuntime).mockReturnValue(true);
    vi.stubGlobal("prompt", vi.fn(() => "  /home/user/project  "));
    const options = makeOptions({
      addWorkspaceFromPath: vi.fn(async () => ({
        id: "ws-2",
        name: "project",
        path: "/home/user/project",
        connected: true,
        settings: { sidebarCollapsed: false },
      })),
    });
    const { result } = renderHook(() => useWorkspaceActions(options));

    await act(async () => {
      await result.current.handleAddWorkspace();
    });

    expect(pickWorkspacePath).not.toHaveBeenCalled();
    expect(ask).not.toHaveBeenCalled();
    expect(options.addWorkspaceFromPath).toHaveBeenCalledWith("/home/user/project");
    expect(options.showLoadingProgressDialog).toHaveBeenCalledWith({
      title: "workspace.loadingProgressAddProjectTitle",
      message: "add:project",
    });
  });

  it("does not add workspace when web service remote path entry is blank", async () => {
    vi.mocked(isWebServiceRuntime).mockReturnValue(true);
    vi.stubGlobal("prompt", vi.fn(() => "   "));
    const options = makeOptions();
    const { result } = renderHook(() => useWorkspaceActions(options));

    await act(async () => {
      await result.current.handleAddWorkspace();
    });

    expect(pickWorkspacePath).not.toHaveBeenCalled();
    expect(ask).not.toHaveBeenCalled();
    expect(options.addWorkspaceFromPath).not.toHaveBeenCalled();
    expect(options.showLoadingProgressDialog).not.toHaveBeenCalled();
  });

  it("does not add workspace when web service remote path entry is cancelled", async () => {
    vi.mocked(isWebServiceRuntime).mockReturnValue(true);
    vi.stubGlobal("prompt", vi.fn(() => null));
    const options = makeOptions();
    const { result } = renderHook(() => useWorkspaceActions(options));

    await act(async () => {
      await result.current.handleAddWorkspace();
    });

    expect(pickWorkspacePath).not.toHaveBeenCalled();
    expect(ask).not.toHaveBeenCalled();
    expect(options.addWorkspaceFromPath).not.toHaveBeenCalled();
    expect(options.showLoadingProgressDialog).not.toHaveBeenCalled();
  });

  it("opens new window when mode is new-window", async () => {
    vi.mocked(pickWorkspacePath).mockResolvedValue("/tmp/new-repo");
    vi.mocked(ask).mockResolvedValueOnce(false);
    const options = makeOptions();
    const { result } = renderHook(() => useWorkspaceActions(options));

    await act(async () => {
      await result.current.handleAddWorkspace();
    });

    expect(openNewWindow).toHaveBeenCalledWith("/tmp/new-repo");
    expect(options.addWorkspaceFromPath).not.toHaveBeenCalled();
    expect(options.showLoadingProgressDialog).toHaveBeenCalledWith({
      title: "workspace.loadingProgressOpenProjectTitle",
      message: "open:new-repo",
    });
    expect(options.hideLoadingProgressDialog).toHaveBeenCalledWith("loading-1");
  });

  it("asks user for mode once on each add workspace flow", async () => {
    vi.mocked(pickWorkspacePath).mockResolvedValue("/tmp/new-repo");
    vi.mocked(ask).mockResolvedValueOnce(false);
    const options = makeOptions();
    const { result } = renderHook(() => useWorkspaceActions(options));

    await act(async () => {
      await result.current.handleAddWorkspace();
    });

    expect(ask).toHaveBeenCalledTimes(1);
    expect(openNewWindow).toHaveBeenCalledWith("/tmp/new-repo");
  });

  it("extracts the project name from Windows paths when showing progress copy", async () => {
    vi.mocked(pickWorkspacePath).mockResolvedValue("C:\\Users\\chen\\code\\mossx");
    vi.mocked(ask).mockResolvedValueOnce(true);
    const options = makeOptions({
      addWorkspaceFromPath: vi.fn(async () => ({
        id: "ws-2",
        name: "",
        path: "C:\\Users\\chen\\code\\mossx",
        connected: true,
        settings: { sidebarCollapsed: false },
      })),
    });
    const { result } = renderHook(() => useWorkspaceActions(options));

    await act(async () => {
      await result.current.handleAddWorkspace();
    });

    expect(options.showLoadingProgressDialog).toHaveBeenCalledWith({
      title: "workspace.loadingProgressAddProjectTitle",
      message: "add:mossx",
    });
  });

  it("surfaces session creation failures when no thread id is returned", async () => {
    const options = makeOptions({
      isCompact: true,
      startThreadForWorkspace: vi.fn(async () => null),
    });
    const { result } = renderHook(() => useWorkspaceActions(options));

    await act(async () => {
      await result.current.handleAddAgent(baseWorkspace, "claude");
    });

    expect(pushErrorToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "errors.failedToCreateSession",
        message: "errors.failedToCreateSessionNoThreadId",
        sticky: true,
      }),
    );
    expect(window.alert).not.toHaveBeenCalled();
    expect(options.setActiveTab).not.toHaveBeenCalled();
    expect(options.hideLoadingProgressDialog).toHaveBeenCalledWith("loading-1");
  });

  it("localizes stopping-runtime create-session failures after automatic retry is exhausted", async () => {
    const options = makeOptions({
      startThreadForWorkspace: vi.fn(async () => {
        throw new Error(
          "[SESSION_CREATE_RUNTIME_RECOVERING] Managed runtime was restarting while creating this session. The app retried automatically but could not acquire a healthy runtime yet. Reconnect the workspace and try again.",
        );
      }),
    });
    const { result } = renderHook(() => useWorkspaceActions(options));

    await act(async () => {
      await result.current.handleAddAgent(baseWorkspace, "codex");
    });

    expect(pushErrorToast).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "create-session-recovery-ws-1-codex",
        title: "errors.failedToCreateSession",
        message: "errors.failedToCreateSessionRuntimeRecovering",
        sticky: true,
        actions: [
          expect.objectContaining({
            label: "errors.reconnectAndRetryCreateSession",
            pendingLabel: "errors.reconnectingAndRetryingCreateSession",
          }),
        ],
      }),
    );
    expect(pushGlobalRuntimeNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        messageKey: "runtimeNotice.error.createSessionRecoveryRequired",
        messageParams: {
          workspace: "Workspace",
        },
      }),
    );
    expect(options.onDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "workspace/create-session recovery toast",
        payload: expect.objectContaining({
          error: expect.stringContaining("[SESSION_CREATE_RUNTIME_RECOVERING]"),
        }),
      }),
    );
    expect(window.alert).not.toHaveBeenCalled();
  });

  it("automatically recovers disk codex create-session once before showing manual recovery", async () => {
    let startAttempt = 0;
    const options = makeOptions({
      startThreadForWorkspace: vi.fn(async () => {
        startAttempt += 1;
        if (startAttempt === 1) {
          throw new Error(
            "[SESSION_CREATE_RUNTIME_RECOVERING] Managed runtime was restarting while creating this session. The app retried automatically but could not acquire a healthy runtime yet. Reconnect the workspace and try again.",
          );
        }
        return "thread-recovered-inline";
      }),
    });
    const { result } = renderHook(() => useWorkspaceActions(options));

    await act(async () => {
      const threadId = await result.current.handleAddAgent(baseWorkspace, "codex", {
        providerProfileId: "__disk__",
      });
      expect(threadId).toBe("thread-recovered-inline");
    });

    expect(ensureRuntimeReady).toHaveBeenCalledWith("ws-1");
    expect(options.startThreadForWorkspace).toHaveBeenCalledTimes(2);
    expect(pushErrorToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: "create-session-recovery-ws-1-codex" }),
    );
  });

  it("does not create a second disk codex session after post-start readiness failures", async () => {
    const options = makeOptions({
      startThreadForWorkspace: vi.fn(async () => {
        throw new Error(
          "thread/start ready confirmation failed for workspace ws-1 thread thread-1: thread/resume failed during readiness check: permission denied",
        );
      }),
    });
    const { result } = renderHook(() => useWorkspaceActions(options));

    await act(async () => {
      await result.current.handleAddAgent(baseWorkspace, "codex", {
        providerProfileId: "__disk__",
      });
    });

    expect(ensureRuntimeReady).not.toHaveBeenCalled();
    expect(options.startThreadForWorkspace).toHaveBeenCalledTimes(1);
    expect(options.startThreadForWorkspace).toHaveBeenCalledWith("ws-1", {
      engine: "codex",
      providerProfileId: "__disk__",
    });
    expect(pushErrorToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "errors.failedToCreateSession",
        message: expect.stringContaining("thread/start ready confirmation failed"),
        sticky: true,
      }),
    );
    expect(window.alert).not.toHaveBeenCalled();
  });

  it("shows recoverable copy for disk codex post-start stale readiness failures without auto-creating another session", async () => {
    const options = makeOptions({
      startThreadForWorkspace: vi.fn(async () => {
        throw new Error(
          "thread/start ready confirmation failed for workspace ws-1 thread thread-1: thread not found: thread-1",
        );
      }),
    });
    const { result } = renderHook(() => useWorkspaceActions(options));

    await act(async () => {
      await result.current.handleAddAgent(baseWorkspace, "codex", {
        providerProfileId: "__disk__",
      });
    });

    expect(ensureRuntimeReady).not.toHaveBeenCalled();
    expect(options.startThreadForWorkspace).toHaveBeenCalledTimes(1);
    expect(pushErrorToast).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "create-session-recovery-ws-1-codex",
        title: "errors.failedToCreateSession",
        message: "errors.failedToCreateSessionRuntimeRecovering",
        sticky: true,
      }),
    );
    expect(window.alert).not.toHaveBeenCalled();
  });

  it("does not add disk auto-recovery to managed codex provider creation", async () => {
    const options = makeOptions({
      startThreadForWorkspace: vi.fn(async () => {
        throw new Error(
          "[SESSION_CREATE_RUNTIME_RECOVERING] Managed runtime was restarting while creating this session. The app retried automatically but could not acquire a healthy runtime yet. Reconnect the workspace and try again.",
        );
      }),
    });
    const { result } = renderHook(() => useWorkspaceActions(options));

    await act(async () => {
      await result.current.handleAddAgent(baseWorkspace, "codex", {
        providerProfileId: "provider-a",
      });
    });

    expect(ensureRuntimeReady).not.toHaveBeenCalled();
    expect(options.startThreadForWorkspace).toHaveBeenCalledTimes(1);
    expect(options.startThreadForWorkspace).toHaveBeenCalledWith("ws-1", {
      engine: "codex",
      providerProfileId: "provider-a",
    });
    expect(pushErrorToast).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "create-session-recovery-ws-1-codex",
        sticky: true,
      }),
    );
  });

  it("does not expose raw broken pipe for managed codex provider creation", async () => {
    const options = makeOptions({
      startThreadForWorkspace: vi.fn(async () => {
        throw new Error("Broken pipe (os error 32)");
      }),
    });
    const { result } = renderHook(() => useWorkspaceActions(options));

    await act(async () => {
      await result.current.handleAddAgent(baseWorkspace, "codex", {
        providerProfileId: "provider-named-kimi",
        providerProfile: {
          id: "provider-named-kimi",
          name: "Kimi",
          source: "managed",
        },
      });
    });

    expect(ensureRuntimeReady).not.toHaveBeenCalled();
    expect(options.startThreadForWorkspace).toHaveBeenCalledTimes(1);
    expect(pushErrorToast).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "create-session-recovery-ws-1-codex",
        message: "errors.failedToCreateSessionRuntimeRecovering",
        sticky: true,
      }),
    );
    expect(window.alert).not.toHaveBeenCalled();
  });

  it("explains unsupported Codex chat wire API instead of exposing transport errors", async () => {
    const options = makeOptions({
      startThreadForWorkspace: vi.fn(async () => {
        throw new Error(
          '[codex_provider_wire_api_unsupported] Codex provider Kimi configures model provider crs with wire_api = "chat".',
        );
      }),
    });
    const { result } = renderHook(() => useWorkspaceActions(options));

    await act(async () => {
      await result.current.handleAddAgent(baseWorkspace, "codex", {
        providerProfileId: "provider-named-kimi",
      });
    });

    expect(ensureRuntimeReady).not.toHaveBeenCalled();
    expect(pushErrorToast).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "create-session-failure-ws-1-codex",
        title: "errors.failedToCreateSession",
        message: "errors.codexProviderWireApiUnsupported",
        sticky: true,
      }),
    );
    expect(
      JSON.stringify(vi.mocked(pushErrorToast).mock.calls[0]?.[0]),
    ).not.toMatch(/broken pipe|os error 32/i);
    expect(window.alert).not.toHaveBeenCalled();
  });

  it("explains invalid Codex provider TOML without exposing parser details", async () => {
    const options = makeOptions({
      startThreadForWorkspace: vi.fn(async () => {
        throw new Error(
          "[codex_provider_config_invalid] Codex provider configToml is not valid TOML.",
        );
      }),
    });
    const { result } = renderHook(() => useWorkspaceActions(options));

    await act(async () => {
      await result.current.handleAddAgent(baseWorkspace, "codex", {
        providerProfileId: "provider-named-kimi",
      });
    });

    expect(pushErrorToast).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "create-session-failure-ws-1-codex",
        title: "errors.failedToCreateSession",
        message: "errors.codexProviderConfigInvalid",
        sticky: true,
      }),
    );
    expect(
      JSON.stringify(vi.mocked(pushErrorToast).mock.calls[0]?.[0]),
    ).not.toMatch(/parse error|line 10|column|wire_api =/i);
    expect(window.alert).not.toHaveBeenCalled();
  });

  it("redacts persistent raw broken pipe after disk codex compatibility recovery", async () => {
    const options = makeOptions({
      startThreadForWorkspace: vi.fn(async () => {
        throw new Error("Broken pipe (os error 32)");
      }),
    });
    const { result } = renderHook(() => useWorkspaceActions(options));

    await act(async () => {
      await result.current.handleAddAgent(baseWorkspace, "codex", {
        providerProfileId: "__disk__",
      });
    });

    expect(ensureRuntimeReady).toHaveBeenCalledWith("ws-1");
    expect(options.startThreadForWorkspace).toHaveBeenCalledTimes(2);
    expect(pushErrorToast).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "create-session-recovery-ws-1-codex",
        message: "errors.failedToCreateSessionRuntimeRecovering",
        sticky: true,
      }),
    );
    expect(window.alert).not.toHaveBeenCalled();
  });

  it("does not apply disk readiness recovery copy to managed codex provider creation", async () => {
    const options = makeOptions({
      startThreadForWorkspace: vi.fn(async () => {
        throw new Error(
          "thread/start ready confirmation failed for workspace ws-1 thread thread-1: thread not found: thread-1",
        );
      }),
    });
    const { result } = renderHook(() => useWorkspaceActions(options));

    await act(async () => {
      await result.current.handleAddAgent(baseWorkspace, "codex", {
        providerProfileId: "provider-a",
      });
    });

    expect(ensureRuntimeReady).not.toHaveBeenCalled();
    expect(options.startThreadForWorkspace).toHaveBeenCalledTimes(1);
    expect(pushErrorToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "errors.failedToCreateSession",
        message: expect.stringContaining("thread/start ready confirmation failed"),
        sticky: true,
      }),
    );
    expect(window.alert).not.toHaveBeenCalled();
  });

  it("reuses runtime-ready recovery contract when the create-session toast action runs", async () => {
    let shouldFail = true;
    const recoverableOptions = makeOptions({
      startThreadForWorkspace: vi.fn(async () => {
        if (shouldFail) {
          throw new Error(
            "[SESSION_CREATE_RUNTIME_RECOVERING] Managed runtime was restarting while creating this session. The app retried automatically but could not acquire a healthy runtime yet. Reconnect the workspace and try again.",
          );
        }
        return "thread-recovered";
      }),
    });
    const recoverableHook = renderHook(() => useWorkspaceActions(recoverableOptions));

    await act(async () => {
      await recoverableHook.result.current.handleAddAgent(baseWorkspace, "codex");
    });

    const toastInput = vi.mocked(pushErrorToast).mock.calls[0]?.[0];
    const retryAction = toastInput?.actions?.[0];

    shouldFail = false;

    await act(async () => {
      await retryAction?.run();
    });

    expect(ensureRuntimeReady).toHaveBeenCalledWith("ws-1");
    expect(vi.mocked(pushErrorToast)).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: "create-session-recovery-progress-ws-1-codex",
        title: "errors.runtimeRecovered",
        message: "errors.retryingCreateSessionAfterRecovery",
        variant: "info",
      }),
    );
    expect(recoverableOptions.startThreadForWorkspace).toHaveBeenCalledWith("ws-1", {
      engine: "codex",
    });
  });

  it("preserves the selected managed profile when a create-session retry runs", async () => {
    let shouldFail = true;
    const recoverableOptions = makeOptions({
      startThreadForWorkspace: vi.fn(async () => {
        if (shouldFail) {
          throw new Error(
            "[SESSION_CREATE_RUNTIME_RECOVERING] Managed runtime was restarting while creating this session.",
          );
        }
        return "thread-recovered";
      }),
    });
    const recoverableHook = renderHook(() => useWorkspaceActions(recoverableOptions));
    const providerProfile = {
      id: "doge-token-matrix",
      name: "Doge",
      source: "managed" as const,
    };

    await act(async () => {
      await recoverableHook.result.current.handleAddAgent(baseWorkspace, "codex", {
        providerProfileId: providerProfile.id,
        providerProfile,
      });
    });

    const toastInput = vi.mocked(pushErrorToast).mock.calls[0]?.[0];
    const retryAction = toastInput?.actions?.[0];
    shouldFail = false;

    await act(async () => {
      await retryAction?.run();
    });

    expect(recoverableOptions.setActiveEngine).toHaveBeenLastCalledWith("codex", {
      ensureRuntime: true,
      providerProfileId: "doge-token-matrix",
    });
    expect(recoverableOptions.startThreadForWorkspace).toHaveBeenLastCalledWith("ws-1", {
      engine: "codex",
      providerProfileId: "doge-token-matrix",
      providerProfile,
    });
  });

  it("localizes empty-thread retry failures before surfacing them back to the toast action", async () => {
    let shouldRecover = false;
    const recoverableOptions = makeOptions({
      startThreadForWorkspace: vi.fn(async () => {
        if (!shouldRecover) {
          throw new Error(
            "[SESSION_CREATE_RUNTIME_RECOVERING] Managed runtime was restarting while creating this session. The app retried automatically but could not acquire a healthy runtime yet. Reconnect the workspace and try again.",
          );
        }
        return null;
      }),
    });
    const recoverableHook = renderHook(() => useWorkspaceActions(recoverableOptions));

    await act(async () => {
      await recoverableHook.result.current.handleAddAgent(baseWorkspace, "codex");
    });

    const toastInput = vi.mocked(pushErrorToast).mock.calls[0]?.[0];
    const retryAction = toastInput?.actions?.[0];
    shouldRecover = true;

    await expect(retryAction?.run()).rejects.toThrow(
      "errors.failedToCreateSessionNoThreadId",
    );
  });

  it("localizes Windows CLI-not-found create-session failures", async () => {
    const options = makeOptions({
      startThreadForWorkspace: vi.fn(async () => {
        throw new Error(
          "Failed to execute codex: The system cannot find the file specified. (os error 2)",
        );
      }),
    });
    const { result } = renderHook(() => useWorkspaceActions(options));

    await act(async () => {
      await result.current.handleAddAgent(baseWorkspace, "codex");
    });

    expect(pushErrorToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "errors.failedToCreateSession",
        message: "errors.cliNotFound\n\nerrors.cliNotFoundHint",
        sticky: true,
      }),
    );
    expect(window.alert).not.toHaveBeenCalled();
  });
});
