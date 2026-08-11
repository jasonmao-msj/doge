// @vitest-environment jsdom
import { createElement, StrictMode, type ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings, CodexDoctorResult } from "../../../types";
import { useAppSettings } from "./useAppSettings";
import {
  getAppSettings,
  runClaudeDoctor,
  runCodexDoctor,
  runGrokDoctor,
  runKimiDoctor,
  takeSettingsRecoveryNotice,
  updateAppSettings,
} from "../../../services/tauri";
import { pushErrorToast } from "../../../services/toasts";
import { UI_SCALE_DEFAULT, UI_SCALE_MAX } from "../../../utils/uiScale";
import {
  DEFAULT_CODE_FONT_FAMILY,
  DEFAULT_UI_FONT_FAMILY,
  LEGACY_CODE_FONT_FAMILY,
  LEGACY_MONACO_UI_FONT_FAMILY,
  LEGACY_SYSTEM_UI_FONT_FAMILY,
} from "../../../utils/fonts";
import { applyDockIconPreference } from "../../theme/utils/dockIcon";
import {
  getStartupTraceSnapshot,
  resetStartupTraceForTests,
} from "../../startup-orchestration/utils/startupTrace";

vi.mock("../../../services/tauri", () => ({
  getAppSettings: vi.fn(),
  updateAppSettings: vi.fn(),
  runClaudeDoctor: vi.fn(),
  runCodexDoctor: vi.fn(),
  runGrokDoctor: vi.fn(),
  runKimiDoctor: vi.fn(),
  takeSettingsRecoveryNotice: vi.fn(),
}));

vi.mock("../../theme/utils/dockIcon", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../theme/utils/dockIcon")>();
  return {
    ...actual,
    applyDockIconPreference: vi.fn(async () => undefined),
    reapplyLastDockIconPreference: vi.fn(async () => undefined),
  };
});

vi.mock("../../../services/toasts", () => ({
  pushErrorToast: vi.fn(),
}));

const getAppSettingsMock = vi.mocked(getAppSettings);
const runClaudeDoctorMock = vi.mocked(runClaudeDoctor);
const runKimiDoctorMock = vi.mocked(runKimiDoctor);
const runGrokDoctorMock = vi.mocked(runGrokDoctor);
const updateAppSettingsMock = vi.mocked(updateAppSettings);
const runCodexDoctorMock = vi.mocked(runCodexDoctor);
const takeSettingsRecoveryNoticeMock = vi.mocked(takeSettingsRecoveryNotice);
const pushErrorToastMock = vi.mocked(pushErrorToast);
const applyDockIconPreferenceMock = vi.mocked(applyDockIconPreference);

function StrictModeWrapper({ children }: { children: ReactNode }) {
  return createElement(StrictMode, null, children);
}

describe("useAppSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default to "no pending recovery notice" so implementations never leak
    // across cases (clearAllMocks does not reset implementations).
    takeSettingsRecoveryNoticeMock.mockResolvedValue(null);
    window.localStorage.clear();
    resetStartupTraceForTests();
  });

  afterEach(() => {
    cleanup();
  });

  it("loads settings and normalizes theme + uiScale", async () => {
    getAppSettingsMock.mockResolvedValue({
      uiScale: UI_SCALE_MAX + 1,
      theme: "nope" as unknown as AppSettings["theme"],
      lightThemePresetId:
        "vscode-dark-plus" as unknown as AppSettings["lightThemePresetId"],
      darkThemePresetId:
        "vscode-light-plus" as unknown as AppSettings["darkThemePresetId"],
      canvasWidthMode: "invalid" as unknown as AppSettings["canvasWidthMode"],
      layoutMode: "invalid" as unknown as NonNullable<
        AppSettings["layoutMode"]
      >,
      userMsgColor: "#XYZXYZ",
      backendMode: "remote",
      remoteBackendHost: "example:1234",
      uiFontFamily: "",
      codeFontFamily: "  ",
      codeFontSize: 25,
      experimentalUnifiedExecEnabled: true,
      codexAutoCompactionEnabled: undefined,
      codexAutoCompactionThresholdPercent: 93,
    } as unknown as AppSettings);

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.uiScale).toBe(UI_SCALE_DEFAULT);
    expect(result.current.settings.theme).toBe("system");
    expect(result.current.settings.lightThemePresetId).toBe(
      "vscode-light-modern",
    );
    expect(result.current.settings.darkThemePresetId).toBe(
      "vscode-dark-modern",
    );
    expect(result.current.settings.canvasWidthMode).toBe("narrow");
    expect(result.current.settings.layoutMode).toBe("default");
    expect(result.current.settings.userMsgColor).toBe("");
    expect(result.current.settings.uiFontFamily).toBe(DEFAULT_UI_FONT_FAMILY);
    expect(result.current.settings.uiFontFamily).not.toMatch(/^Monaco,/);
    expect(result.current.settings.codeFontFamily).toBe(
      DEFAULT_CODE_FONT_FAMILY,
    );
    expect(result.current.settings.codeFontSize).toBe(16);
    expect(result.current.settings.codexUnifiedExecPolicy).toBe("inherit");
    expect(result.current.settings.backendMode).toBe("remote");
    expect(result.current.settings.remoteBackendHost).toBe("example:1234");
    expect(result.current.settings.disabledCliEngines).toEqual([]);
    expect(result.current.settings.claudeBin).toBeNull();
    expect(result.current.settings.codexAutoCompactionEnabled).toBe(true);
    expect(result.current.settings.codexAutoCompactionThresholdPercent).toBe(
      92,
    );
    expect(result.current.settings.performanceCompatibilityModeEnabled).toBe(
      false,
    );
    expect(result.current.settings.showSidebarProviderLabels).toBe(false);
    expect(result.current.settings.sessionAttributionMode).toBe("related");
    expect(result.current.settings.enabledCuratedSkillIds).toEqual([
      "lazy-senior-dev",
      "caveman",
    ]);
    expect(result.current.settings.curatedSkillDefaultsVersion).toBe(1);
  });

  it("deduplicates the initial settings and recovery reads under StrictMode", async () => {
    let resolveSettings: (value: AppSettings) => void = () => {};
    getAppSettingsMock.mockReturnValue(
      new Promise<AppSettings>((resolve) => {
        resolveSettings = resolve;
      }),
    );

    const { result } = renderHook(() => useAppSettings(), {
      wrapper: StrictModeWrapper,
    });

    expect(getAppSettingsMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveSettings({ dockIconId: "default" } as AppSettings);
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() =>
      expect(takeSettingsRecoveryNoticeMock).toHaveBeenCalledTimes(1),
    );

    expect(getAppSettingsMock).toHaveBeenCalledTimes(1);
    expect(applyDockIconPreferenceMock).not.toHaveBeenCalled();
    expect(getStartupTraceSnapshot().events).toContainEqual(
      expect.objectContaining({
        type: "command",
        commandLabel: "get_app_settings",
        status: "completed",
      }),
    );
  });

  it("normalizes a persisted legacy Dock icon without replaying it", async () => {
    getAppSettingsMock.mockResolvedValue({
      dockIconId: "multi-orbit-hub",
    } as AppSettings);

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.settings.dockIconId).toBe("default");
    expect(applyDockIconPreferenceMock).not.toHaveBeenCalled();
  });

  it("normalizes persisted disabled CLI engines", async () => {
    getAppSettingsMock.mockResolvedValue({
      disabledCliEngines: ["opencode", " opencode ", "", 42, "kimi"],
    } as unknown as AppSettings);

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.disabledCliEngines).toEqual([
      "opencode",
      "kimi",
    ]);
  });

  it("surfaces a toast and keeps defaults when loading settings fails", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    getAppSettingsMock.mockRejectedValue(new Error("settings read failed"));

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.theme).toBe("system");
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(pushErrorToastMock).toHaveBeenCalledTimes(1);
    expect(pushErrorToastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.any(String),
        message: expect.any(String),
      }),
    );
    // The invoke-failure copy must not claim a backend backup that never happened.
    const failureToast = pushErrorToastMock.mock.calls[0]?.[0];
    expect(failureToast?.message ?? "").not.toContain(".bak");
    // The invoke-failure path never reaches the recovery-notice command.
    expect(takeSettingsRecoveryNoticeMock).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("surfaces exactly one recovery toast when load succeeds with a quarantine notice", async () => {
    const backupFileName = "settings.json.corrupted-20260724T000000Z.bak";
    getAppSettingsMock.mockResolvedValue({} as AppSettings);
    takeSettingsRecoveryNoticeMock.mockResolvedValue({ backupFileName });

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() =>
      expect(pushErrorToastMock).toHaveBeenCalledTimes(1),
    );

    expect(takeSettingsRecoveryNoticeMock).toHaveBeenCalledTimes(1);
    expect(pushErrorToastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.any(String),
        message: expect.stringContaining(backupFileName),
      }),
    );
  });

  it("stays silent when load succeeds without a recovery notice", async () => {
    getAppSettingsMock.mockResolvedValue({} as AppSettings);
    takeSettingsRecoveryNoticeMock.mockResolvedValue(null);

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(takeSettingsRecoveryNoticeMock).toHaveBeenCalledTimes(1);
    expect(pushErrorToastMock).not.toHaveBeenCalled();
  });

  it("uses the backup-failed copy when the notice has no backup file name", async () => {
    getAppSettingsMock.mockResolvedValue({} as AppSettings);
    takeSettingsRecoveryNoticeMock.mockResolvedValue({ backupFileName: null });

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() =>
      expect(pushErrorToastMock).toHaveBeenCalledTimes(1),
    );

    const toast = pushErrorToastMock.mock.calls[0]?.[0];
    expect(toast?.message).toEqual(expect.any(String));
    expect(toast?.message ?? "").not.toContain("{{backupFileName}}");
    expect(toast?.message ?? "").not.toContain(".bak");
  });

  it("keeps loaded settings when the recovery notice fetch itself fails", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    getAppSettingsMock.mockResolvedValue({
      theme: "dark",
    } as unknown as AppSettings);
    takeSettingsRecoveryNoticeMock.mockRejectedValue(new Error("notice fail"));

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.theme).toBe("dark");
    expect(pushErrorToastMock).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("keeps an explicitly cleared curated skill list disabled", async () => {
    getAppSettingsMock.mockResolvedValue({
      enabledCuratedSkillIds: [],
    } as unknown as AppSettings);

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.enabledCuratedSkillIds).toEqual([]);
  });

  it("normalizes invalid session attribution mode to related", async () => {
    getAppSettingsMock.mockResolvedValue({
      sessionAttributionMode: "invalid",
    } as unknown as AppSettings);

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.sessionAttributionMode).toBe("related");
  });

  it("migrates the legacy Monaco UI default back to the system UI stack", async () => {
    getAppSettingsMock.mockResolvedValue({
      uiFontFamily: LEGACY_MONACO_UI_FONT_FAMILY,
    } as unknown as AppSettings);

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.uiFontFamily).toBe(DEFAULT_UI_FONT_FAMILY);
    expect(result.current.settings.uiFontFamily).not.toMatch(/^Monaco,/);
  });

  it("migrates legacy default font stacks to Windows-readable defaults", async () => {
    getAppSettingsMock.mockResolvedValue({
      uiFontFamily: LEGACY_SYSTEM_UI_FONT_FAMILY,
      codeFontFamily: LEGACY_CODE_FONT_FAMILY,
    } as AppSettings);

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.uiFontFamily).toBe(DEFAULT_UI_FONT_FAMILY);
    expect(result.current.settings.codeFontFamily).toBe(
      DEFAULT_CODE_FONT_FAMILY,
    );
  });

  it("preserves workspace-only session attribution mode", async () => {
    getAppSettingsMock.mockResolvedValue({
      sessionAttributionMode: "workspace-only",
    } as AppSettings);

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.sessionAttributionMode).toBe(
      "workspace-only",
    );
  });

  it("preserves explicitly enabled performance compatibility mode", async () => {
    getAppSettingsMock.mockResolvedValue({
      performanceCompatibilityModeEnabled: true,
    } as AppSettings);

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.performanceCompatibilityModeEnabled).toBe(
      true,
    );
  });

  it("preserves disabled Codex auto-compaction", async () => {
    getAppSettingsMock.mockResolvedValue({
      codexAutoCompactionEnabled: false,
      codexAutoCompactionThresholdPercent: 150,
    } as AppSettings);

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.codexAutoCompactionEnabled).toBe(false);
    expect(result.current.settings.codexAutoCompactionThresholdPercent).toBe(
      150,
    );
  });

  it("keeps supported Codex auto-compaction thresholds", async () => {
    getAppSettingsMock.mockResolvedValue({
      codexAutoCompactionThresholdPercent: 150,
    } as AppSettings);

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.codexAutoCompactionThresholdPercent).toBe(
      150,
    );
  });

  it("normalizes terminal shell path while loading settings", async () => {
    getAppSettingsMock.mockResolvedValue({
      terminalShellPath: "  C:\\Program Files\\PowerShell\\7\\pwsh.exe  ",
    } as AppSettings);

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.terminalShellPath).toBe(
      "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
    );
  });

  it("normalizes Web Service fixed token while loading settings", async () => {
    getAppSettingsMock.mockResolvedValue({
      webServiceToken: "  durable-token  ",
    } as AppSettings);

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.webServiceToken).toBe("durable-token");
  });

  it("preserves 10 second email inbound polling interval while loading settings", async () => {
    getAppSettingsMock.mockResolvedValue({
      emailInbound: {
        enabled: true,
        provider: "custom",
        imapHost: "imap.example.com",
        imapPort: 993,
        security: "ssl_tls",
        username: "user@example.com",
        mailboxFolder: "INBOX",
        allowedSenders: ["sender@example.com"],
        pollIntervalSeconds: 10,
        readOnlyMode: true,
        actionWindowHours: 24,
        debugStorageEnabled: false,
      },
    } as AppSettings);

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.emailInbound?.pollIntervalSeconds).toBe(10);
  });

  it("normalizes blank Web Service fixed token to null before persisting", async () => {
    getAppSettingsMock.mockResolvedValue({} as AppSettings);
    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    updateAppSettingsMock.mockResolvedValue({
      ...result.current.settings,
      webServiceToken: null,
    });

    await act(async () => {
      await result.current.saveSettings({
        ...result.current.settings,
        webServiceToken: "   ",
      });
    });

    expect(updateAppSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        webServiceToken: null,
      }),
    );
  });

  it("normalizes custom skill directories while loading settings", async () => {
    getAppSettingsMock.mockResolvedValue({
      customSkillDirectories: [
        "  ~/shared-skills  ",
        "",
        "~/shared-skills",
        "/opt/team-skills",
      ],
    } as AppSettings);

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.customSkillDirectories).toEqual([
      "~/shared-skills",
      "/opt/team-skills",
    ]);
  });

  it("normalizes custom skill directories before persisting settings", async () => {
    getAppSettingsMock.mockResolvedValue({} as AppSettings);
    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    updateAppSettingsMock.mockResolvedValue({
      ...result.current.settings,
      customSkillDirectories: ["/team-skills"],
    });

    await act(async () => {
      await result.current.saveSettings({
        ...result.current.settings,
        customSkillDirectories: [" /team-skills ", "/team-skills", ""],
      });
    });

    expect(updateAppSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        customSkillDirectories: ["/team-skills"],
      }),
    );
  });

  it("normalizes blank terminal shell path to null while loading settings", async () => {
    getAppSettingsMock.mockResolvedValue({
      terminalShellPath: "   ",
    } as AppSettings);

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.terminalShellPath).toBeNull();
  });

  it("upgrades legacy warm ttl to the current startup default when loading", async () => {
    getAppSettingsMock.mockResolvedValue({
      codexWarmTtlSeconds: 300,
    } as AppSettings);

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.codexWarmTtlSeconds).toBe(7200);
  });

  it("upgrades legacy realtime and history curtain flags to the normalized defaults", async () => {
    getAppSettingsMock.mockResolvedValue({
      chatCanvasUseNormalizedRealtime: false,
      chatCanvasUseUnifiedHistoryLoader: false,
    } as AppSettings);

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.chatCanvasUseNormalizedRealtime).toBe(true);
    expect(result.current.settings.chatCanvasUseUnifiedHistoryLoader).toBe(
      true,
    );
  });

  it("preserves an explicitly cleared global search shortcut", async () => {
    getAppSettingsMock.mockResolvedValue({
      toggleGlobalSearchShortcut: null,
    } as AppSettings);

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.toggleGlobalSearchShortcut).toBeNull();
  });

  it("preserves dim theme while sanitizing preset ids into valid appearance slots", async () => {
    getAppSettingsMock.mockResolvedValue({
      theme: "dim",
      lightThemePresetId:
        "vscode-dark-plus" as unknown as AppSettings["lightThemePresetId"],
      darkThemePresetId:
        "vscode-light-plus" as unknown as AppSettings["darkThemePresetId"],
    } as AppSettings);

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.theme).toBe("dim");
    expect(result.current.settings.lightThemePresetId).toBe(
      "vscode-light-modern",
    );
    expect(result.current.settings.darkThemePresetId).toBe(
      "vscode-dark-modern",
    );
  });

  it("keeps defaults when getAppSettings fails", async () => {
    getAppSettingsMock.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.uiScale).toBe(UI_SCALE_DEFAULT);
    expect(result.current.settings.theme).toBe("system");
    expect(result.current.settings.uiFontFamily).toBe(DEFAULT_UI_FONT_FAMILY);
    expect(result.current.settings.uiFontFamily).not.toMatch(/^Monaco,/);
    expect(result.current.settings.codeFontFamily).toBe(
      DEFAULT_CODE_FONT_FAMILY,
    );
    expect(result.current.settings.backendMode).toBe("local");
    expect(result.current.settings.disabledCliEngines).toEqual([]);
    expect(result.current.settings.dictationModelId).toBe("base");
    expect(result.current.settings.interruptShortcut).toBeTruthy();
    expect(result.current.settings.performanceCompatibilityModeEnabled).toBe(
      false,
    );
  });

  it("persists settings via updateAppSettings and updates local state", async () => {
    getAppSettingsMock.mockResolvedValue({} as AppSettings);
    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const next: AppSettings = {
      ...result.current.settings,
      codexArgs: "--profile dev",
      theme: "nope" as unknown as AppSettings["theme"],
      lightThemePresetId:
        "vscode-dark-modern" as unknown as AppSettings["lightThemePresetId"],
      darkThemePresetId:
        "vscode-light-modern" as unknown as AppSettings["darkThemePresetId"],
      uiScale: 0.04,
      uiFontFamily: "",
      codeFontFamily: "  ",
      codeFontSize: 2,
      notificationSoundsEnabled: false,
      codexAutoCompactionEnabled: false,
      codexAutoCompactionThresholdPercent: 95,
    };
    const saved: AppSettings = {
      ...result.current.settings,
      codexArgs: "--profile dev",
      theme: "dark",
      lightThemePresetId: "vscode-light-modern",
      darkThemePresetId: "vscode-dark-modern",
      uiScale: 1.25,
      uiFontFamily: "Avenir, sans-serif",
      codeFontFamily: "JetBrains Mono, monospace",
      codeFontSize: 13,
      notificationSoundsEnabled: false,
    };
    updateAppSettingsMock.mockResolvedValue(saved);

    let returned: AppSettings | undefined;
    await act(async () => {
      returned = await result.current.saveSettings(next);
    });

    expect(updateAppSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        theme: "system",
        lightThemePresetId: "vscode-light-modern",
        darkThemePresetId: "vscode-dark-modern",
        uiScale: 0.8,
        uiFontFamily: DEFAULT_UI_FONT_FAMILY,
        codeFontFamily: DEFAULT_CODE_FONT_FAMILY,
        codeFontSize: 9,
        notificationSoundsEnabled: false,
        codexAutoCompactionEnabled: false,
        codexAutoCompactionThresholdPercent: 92,
      }),
    );
    expect(returned).toEqual(saved);
    expect(result.current.settings.theme).toBe("dark");
    expect(result.current.settings.uiScale).toBe(1.25);
  });

  it("sanitizes preset slots before persisting settings", async () => {
    getAppSettingsMock.mockResolvedValue({} as AppSettings);
    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    updateAppSettingsMock.mockResolvedValue({
      ...result.current.settings,
      theme: "dim",
      lightThemePresetId: "vscode-light-plus",
      darkThemePresetId: "vscode-dark-plus",
    });

    await act(async () => {
      await result.current.saveSettings({
        ...result.current.settings,
        theme: "dim",
        lightThemePresetId:
          "vscode-dark-plus" as unknown as AppSettings["lightThemePresetId"],
        darkThemePresetId:
          "vscode-light-plus" as unknown as AppSettings["darkThemePresetId"],
      });
    });

    expect(updateAppSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        theme: "dim",
        lightThemePresetId: "vscode-light-modern",
        darkThemePresetId: "vscode-dark-modern",
      }),
    );
  });

  it("surfaces doctor errors", async () => {
    getAppSettingsMock.mockResolvedValue({} as AppSettings);
    runCodexDoctorMock.mockRejectedValue(new Error("doctor fail"));
    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(
      result.current.doctor("/bin/codex", "--profile test"),
    ).rejects.toThrow("doctor fail");
    expect(runCodexDoctorMock).toHaveBeenCalledWith(
      "/bin/codex",
      "--profile test",
    );
  });

  it("returns doctor results", async () => {
    getAppSettingsMock.mockResolvedValue({} as AppSettings);
    const response: CodexDoctorResult = {
      ok: true,
      codexBin: "/bin/codex",
      version: "1.0.0",
      appServerOk: true,
      details: null,
      path: null,
      nodeOk: true,
      nodeVersion: "20.0.0",
      nodeDetails: null,
    };
    runCodexDoctorMock.mockResolvedValue(response);
    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(result.current.doctor("/bin/codex", null)).resolves.toEqual(
      response,
    );
  });

  it("returns claude doctor results", async () => {
    getAppSettingsMock.mockResolvedValue({} as AppSettings);
    const response: CodexDoctorResult = {
      ok: true,
      codexBin: "/bin/claude",
      version: "0.9.0",
      appServerOk: false,
      details: null,
      path: null,
      nodeOk: true,
      nodeVersion: "20.0.0",
      nodeDetails: null,
    };
    runClaudeDoctorMock.mockResolvedValue(response);
    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(result.current.claudeDoctor("/bin/claude")).resolves.toEqual(
      response,
    );
    expect(runClaudeDoctorMock).toHaveBeenCalledWith("/bin/claude");
  });

  it("returns kimi doctor results", async () => {
    getAppSettingsMock.mockResolvedValue({} as AppSettings);
    const response: CodexDoctorResult = {
      ok: true,
      codexBin: "/bin/kimi",
      version: "0.1.0",
      appServerOk: false,
      details: null,
      path: null,
      nodeOk: true,
      nodeVersion: "20.0.0",
      nodeDetails: null,
    };
    runKimiDoctorMock.mockResolvedValue(response);
    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(result.current.kimiDoctor("/bin/kimi")).resolves.toEqual(
      response,
    );
    expect(runKimiDoctorMock).toHaveBeenCalledWith("/bin/kimi");
  });

  it("returns grok doctor results", async () => {
    getAppSettingsMock.mockResolvedValue({} as AppSettings);
    const response: CodexDoctorResult = {
      ok: true,
      codexBin: "/bin/grok",
      version: "0.1.0",
      appServerOk: false,
      details: null,
      path: null,
      nodeOk: true,
      nodeVersion: "20.0.0",
      nodeDetails: null,
    };
    runGrokDoctorMock.mockResolvedValue(response);
    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(result.current.grokDoctor("/bin/grok")).resolves.toEqual(
      response,
    );
    expect(runGrokDoctorMock).toHaveBeenCalledWith("/bin/grok");
  });

  it("uses legacy localStorage user message color when settings value is missing", async () => {
    window.localStorage.setItem("userMsgColor", "#6E40C9");
    getAppSettingsMock.mockResolvedValue({} as AppSettings);

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.userMsgColor).toBe("#6e40c9");
  });
});
