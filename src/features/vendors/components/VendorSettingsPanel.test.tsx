// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCodexUnifiedExecExternalStatus,
  readGlobalCodexAuthJson,
  readGlobalCodexConfigToml,
  restoreCodexUnifiedExecOfficialDefault,
  setCodexUnifiedExecOfficialOverride,
} from "../../../services/tauri";
import { pushErrorToast } from "../../../services/toasts";
import type { AppSettings } from "../../../types";
import type {
  GrokProviderConfig,
  OpenCodeProviderConfig,
} from "../types";
import { VendorSettingsPanel } from "./VendorSettingsPanel";

const mockState = vi.hoisted(() => ({
  claudeManagement: {
    currentConfig: null,
    currentConfigLoading: false,
    providers: [],
    localProvider: null,
    loading: false,
    handleSwitchProvider: vi.fn(),
    handleAddProvider: vi.fn(),
    handleEditProvider: vi.fn(),
    handleDeleteProvider: vi.fn(),
    providerDialog: { isOpen: false, provider: null },
    handleCloseProviderDialog: vi.fn(),
    handleSaveProvider: vi.fn(),
    deleteConfirm: { isOpen: false, provider: null },
    confirmDeleteProvider: vi.fn(),
    cancelDeleteProvider: vi.fn(),
  },
  codexManagement: {
    codexProviderError: null,
    codexProviders: [],
    codexLoading: false,
    handleAddCodexProvider: vi.fn(),
    handleEditCodexProvider: vi.fn(),
    handleDeleteCodexProvider: vi.fn(),
    handleSwitchCodexProvider: vi.fn(),
    codexProviderDialog: { isOpen: false, provider: null },
    handleCloseCodexProviderDialog: vi.fn(),
    handleSaveCodexProvider: vi.fn(),
    deleteCodexConfirm: { isOpen: false, provider: null },
    confirmDeleteCodexProvider: vi.fn(),
    cancelDeleteCodexProvider: vi.fn(),
  },
  kimiManagement: {
    kimiProviderError: null,
    kimiProviders: [],
    kimiLoading: false,
    handleAddKimiProvider: vi.fn(),
    handleEditKimiProvider: vi.fn(),
    handleDeleteKimiProvider: vi.fn(),
    handleSwitchKimiProvider: vi.fn(),
    kimiProviderDialog: { isOpen: false, provider: null },
    handleCloseKimiProviderDialog: vi.fn(),
    handleSaveKimiProvider: vi.fn(),
    deleteKimiConfirm: { isOpen: false, provider: null },
    confirmDeleteKimiProvider: vi.fn(),
    cancelDeleteKimiProvider: vi.fn(),
    currentKimiConfig: null,
  },
  grokManagement: {
    grokProviderError: null,
    grokProviders: [] as GrokProviderConfig[],
    grokLoading: false,
    handleAddGrokProvider: vi.fn(),
    handleEditGrokProvider: vi.fn(),
    handleDeleteGrokProvider: vi.fn(),
    handleSwitchGrokProvider: vi.fn(),
    grokProviderDialog: { isOpen: false, provider: null },
    handleCloseGrokProviderDialog: vi.fn(),
    handleSaveGrokProvider: vi.fn(),
    deleteGrokConfirm: { isOpen: false, provider: null },
    confirmDeleteGrokProvider: vi.fn(),
    cancelDeleteGrokProvider: vi.fn(),
    currentGrokConfig: null,
  },
  openCodeManagement: {
    openCodeProviderError: null,
    openCodeProviders: [] as OpenCodeProviderConfig[],
    openCodeLoading: false,
    handleAddOpenCodeProvider: vi.fn(),
    handleEditOpenCodeProvider: vi.fn(),
    handleDeleteOpenCodeProvider: vi.fn(),
    handleSwitchOpenCodeProvider: vi.fn(),
    openCodeProviderDialog: { isOpen: false, provider: null },
    handleCloseOpenCodeProviderDialog: vi.fn(),
    handleSaveOpenCodeProvider: vi.fn(),
    deleteOpenCodeConfirm: { isOpen: false, provider: null },
    confirmDeleteOpenCodeProvider: vi.fn(),
    cancelDeleteOpenCodeProvider: vi.fn(),
    currentOpenCodeConfig: null,
  },
  claudeModels: { models: [], updateModels: vi.fn() },
  codexModels: { models: [], updateModels: vi.fn() },
}));

vi.mock("../hooks/useProviderManagement", () => ({
  useProviderManagement: vi.fn(() => mockState.claudeManagement),
}));

vi.mock("../hooks/useCodexProviderManagement", () => ({
  useCodexProviderManagement: vi.fn(() => mockState.codexManagement),
}));

vi.mock("../hooks/useKimiProviderManagement", () => ({
  useKimiProviderManagement: vi.fn(() => mockState.kimiManagement),
}));

vi.mock("../hooks/useGrokProviderManagement", () => ({
  useGrokProviderManagement: vi.fn(() => mockState.grokManagement),
}));

vi.mock("../hooks/useOpenCodeProviderManagement", () => ({
  useOpenCodeProviderManagement: vi.fn(() => mockState.openCodeManagement),
}));

vi.mock("../hooks/usePluginModels", () => ({
  usePluginModels: vi.fn((key: string) => {
    if (key === "codex-custom-models") {
      return mockState.codexModels;
    }
    return mockState.claudeModels;
  }),
}));

vi.mock("../modelManagerRequest", () => ({
  consumeVendorModelManagerRequest: vi.fn(() => null),
  VENDOR_MODEL_MANAGER_REQUEST_EVENT: "vendor-model-manager-request",
}));

vi.mock("./ProviderList", () => ({
  ProviderList: () => <div data-testid="provider-list-stub" />,
}));

vi.mock("./ClaudeLocalSettingsCard", () => ({
  ClaudeLocalSettingsCard: () => (
    <div data-testid="claude-local-settings-stub" />
  ),
}));

vi.mock("./CodexProviderList", () => ({
  CodexProviderList: () => <div data-testid="codex-provider-list-stub" />,
}));

vi.mock("./KimiProviderList", () => ({
  KimiProviderList: () => <div data-testid="kimi-provider-list-stub" />,
}));

vi.mock("./GrokProviderList", () => ({
  GrokProviderList: () => <div data-testid="grok-provider-list-stub" />,
}));

vi.mock("./OpenCodeProviderList", () => ({
  OpenCodeProviderList: () => <div data-testid="opencode-provider-list-stub" />,
}));

vi.mock("./ProviderDialog", () => ({
  ProviderDialog: () => null,
}));

vi.mock("./CodexProviderDialog", () => ({
  CodexProviderDialog: () => null,
}));

vi.mock("./KimiProviderDialog", () => ({
  KimiProviderDialog: () => null,
}));

vi.mock("./GrokProviderDialog", () => ({
  GrokProviderDialog: () => null,
}));

vi.mock("./OpenCodeProviderDialog", () => ({
  OpenCodeProviderDialog: () => null,
}));

vi.mock("./DeleteConfirmDialog", () => ({
  DeleteConfirmDialog: () => null,
}));

vi.mock("./CustomModelDialog", () => ({
  CustomModelDialog: () => null,
}));

vi.mock("./CurrentCodexGlobalConfigCard", () => ({
  CurrentCodexGlobalConfigCard: () => (
    <div data-testid="current-codex-config-stub" />
  ),
}));

vi.mock("../../../services/tauri", async () => {
  const actual = await vi.importActual<
    typeof import("../../../services/tauri")
  >("../../../services/tauri");
  return {
    ...actual,
    readGlobalCodexConfigToml: vi.fn(),
    readGlobalCodexAuthJson: vi.fn(),
    getCodexUnifiedExecExternalStatus: vi.fn(),
    restoreCodexUnifiedExecOfficialDefault: vi.fn(),
    setCodexUnifiedExecOfficialOverride: vi.fn(),
  };
});

vi.mock("../../../services/toasts", () => ({
  pushErrorToast: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));

const readGlobalCodexConfigTomlMock = vi.mocked(readGlobalCodexConfigToml);
const readGlobalCodexAuthJsonMock = vi.mocked(readGlobalCodexAuthJson);
const getCodexUnifiedExecExternalStatusMock = vi.mocked(
  getCodexUnifiedExecExternalStatus,
);
const restoreCodexUnifiedExecOfficialDefaultMock = vi.mocked(
  restoreCodexUnifiedExecOfficialDefault,
);
const setCodexUnifiedExecOfficialOverrideMock = vi.mocked(
  setCodexUnifiedExecOfficialOverride,
);
const pushErrorToastMock = vi.mocked(pushErrorToast);
const openUrlMock = vi.mocked(openUrl);

function renderPanel(
  options: {
    appSettings?: Partial<AppSettings>;
    handleReloadCodexRuntimeConfig?: () => Promise<void>;
    codexReloadStatus?: "idle" | "reloading" | "applied" | "failed";
    codexReloadMessage?: string | null;
    onUpdateAppSettings?: (next: AppSettings) => Promise<void>;
  } = {},
) {
  const handleReloadCodexRuntimeConfig =
    options.handleReloadCodexRuntimeConfig ??
    vi.fn().mockResolvedValue(undefined);
  const appSettings = {
    showSidebarProviderLabels: false,
    ...options.appSettings,
  } as AppSettings;
  const onUpdateAppSettings =
    options.onUpdateAppSettings ?? vi.fn().mockResolvedValue(undefined);

  render(
    <VendorSettingsPanel
      appSettings={appSettings}
      codexReloadStatus={options.codexReloadStatus ?? "idle"}
      codexReloadMessage={options.codexReloadMessage ?? null}
      handleReloadCodexRuntimeConfig={handleReloadCodexRuntimeConfig}
      onUpdateAppSettings={onUpdateAppSettings}
    />,
  );

  return {
    handleReloadCodexRuntimeConfig,
    onUpdateAppSettings,
  };
}

/** 取某 CLI 行的「...」更多操作触发器(与行主按钮同名前缀,须 within 行容器)。 */
function getCliRowMoreButton(cliName: string): HTMLElement {
  const row = screen
    .getByRole("button", { name: cliName })
    .closest(".vendor-engine-tab") as HTMLElement;
  return within(row).getByRole("button", { name: "更多操作" });
}

async function openCodexTab() {
  fireEvent.click(screen.getByRole("button", { name: "Codex CLI" }));
  await waitFor(() => {
    expect(getCodexUnifiedExecExternalStatusMock).toHaveBeenCalled();
  });
  return (await screen.findByText("Background terminal")).closest(
    ".vendor-group-row",
  ) as HTMLElement;
}

beforeEach(() => {
  readGlobalCodexConfigTomlMock.mockResolvedValue({
    exists: true,
    content: "[features]\n",
    truncated: false,
  });
  readGlobalCodexAuthJsonMock.mockResolvedValue({
    exists: true,
    content: '{"access_token":"***"}',
    truncated: false,
  });
  getCodexUnifiedExecExternalStatusMock.mockResolvedValue({
    configPath: "/tmp/codex/config.toml",
    hasExplicitUnifiedExec: false,
    explicitUnifiedExecValue: null,
    officialDefaultEnabled: true,
  });
  restoreCodexUnifiedExecOfficialDefaultMock.mockResolvedValue({
    configPath: "/tmp/codex/config.toml",
    hasExplicitUnifiedExec: false,
    explicitUnifiedExecValue: null,
    officialDefaultEnabled: true,
  });
  setCodexUnifiedExecOfficialOverrideMock.mockResolvedValue({
    configPath: "/tmp/codex/config.toml",
    hasExplicitUnifiedExec: true,
    explicitUnifiedExecValue: true,
    officialDefaultEnabled: true,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockState.grokManagement.grokProviders = [];
  mockState.openCodeManagement.openCodeProviders = [];
  mockState.kimiManagement.kimiProviders = [];
});

describe("VendorSettingsPanel", () => {
  it("leaves the section heading to SettingsView titlebar", async () => {
    renderPanel();

    await waitFor(() => {
      expect(readGlobalCodexConfigTomlMock).toHaveBeenCalled();
      expect(readGlobalCodexAuthJsonMock).toHaveBeenCalled();
    });

    expect(document.querySelector(".vendor-section-heading")).toBeNull();
    expect(screen.queryByRole("heading", { name: "settings.vendorsTitle" })).toBeNull();
  });

  it("renders only supported CLI engines as enabled tabs", async () => {
    renderPanel();

    await waitFor(() => {
      expect(readGlobalCodexConfigTomlMock).toHaveBeenCalled();
      expect(readGlobalCodexAuthJsonMock).toHaveBeenCalled();
    });
    expect(screen.getByRole("button", { name: /Claude Code CLI/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Codex CLI/ })).toBeTruthy();
    expect(screen.getByPlaceholderText("搜索CLI")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: /OpenCode CLI/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(
      (screen.getByRole("button", { name: /Gemini CLI/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(
      (screen.getByRole("button", { name: /Kiro CLI/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(
      (screen.getByRole("button", { name: /瑞幸 CLI/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);

    const navLabels = screen
      .getAllByRole("button")
      .map(
        (button) =>
          button.querySelector(".min-w-0")?.textContent?.trim() ?? "",
      )
      .filter((label) => label.endsWith("CLI"));
    expect(navLabels.slice(0, 9)).toEqual([
      "Claude Code CLI",
      "Codex CLI",
      "Kimi CLI",
      "Grok CLI",
      "OpenCode CLI",
      "Gemini CLI",
      "GLM CLI",
      "Trae CLI",
      "Cursor CLI",
    ]);
    expect(navLabels).toEqual(
      expect.arrayContaining(["瑞幸 CLI", "DevEco CLI", "PI CLI", "iFlow CLI"]),
    );
    expect(screen.queryByRole("button", { name: /Droid CLI/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Goose CLI/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Hermes CLI/ })).toBeNull();

    const supportedButtons = ["Claude Code CLI", "Codex CLI"];
    for (const name of supportedButtons) {
      expect(
        (screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
      ).toBe(false);
      const icon = screen
        .getByRole("button", { name })
        .querySelector(".vendor-engine-icon img, .vendor-engine-icon span");
      expect(icon).toBeTruthy();
      expect((icon as HTMLElement).className).not.toContain("mono");
    }

    // Kimi CLI is supported but intentionally keeps the monochrome icon
    // (COLOR_CLI_ICON_IDS only includes claude/codex).
    const kimiNavButton = screen.getByRole("button", { name: /Kimi CLI/ });
    expect((kimiNavButton as HTMLButtonElement).disabled).toBe(false);
    const kimiIcon = kimiNavButton.querySelector(
      ".vendor-engine-icon img, .vendor-engine-icon span",
    );
    expect(kimiIcon).toBeTruthy();
    expect((kimiIcon as HTMLElement).className).toContain("mono");

    // Grok CLI is supported and likewise keeps the monochrome icon.
    const grokNavButton = screen.getByRole("button", { name: /Grok CLI/ });
    expect((grokNavButton as HTMLButtonElement).disabled).toBe(false);
    const grokIcon = grokNavButton.querySelector(
      ".vendor-engine-icon img, .vendor-engine-icon span",
    );
    expect(grokIcon).toBeTruthy();
    expect((grokIcon as HTMLElement).className).toContain("mono");

    // OpenCode CLI is supported and likewise keeps the monochrome icon.
    const openCodeNavButton = screen.getByRole("button", {
      name: /OpenCode CLI/,
    });
    expect((openCodeNavButton as HTMLButtonElement).disabled).toBe(false);
    const openCodeIcon = openCodeNavButton.querySelector(
      ".vendor-engine-icon img, .vendor-engine-icon span",
    );
    expect(openCodeIcon).toBeTruthy();
    expect((openCodeIcon as HTMLElement).className).toContain("mono");

    const unsupportedButtons = [
      "Gemini CLI",
      "GLM CLI",
      "Trae CLI",
      "Cursor CLI",
      "瑞幸 CLI",
      "DevEco CLI",
      "PI CLI",
      "iFlow CLI",
      "Qoder CLI",
      "Qwen CLI",
      "CodeBuddy CLI",
      "Copilot CLI",
      "飞书 CLI",
      "Kiro CLI",
    ];
    for (const name of unsupportedButtons) {
      expect(
        (screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
      ).toBe(false);
      const icon = screen
        .getByRole("button", { name })
        .querySelector(".vendor-engine-icon img, .vendor-engine-icon span");
      expect(icon).toBeTruthy();
      if (icon instanceof HTMLImageElement) {
        expect(icon.className).toContain("vendor-cli-logo-img-mono");
        expect(icon.src).not.toContain("color");
      } else {
        expect((icon as HTMLElement).className).toContain(
          "vendor-cli-logo-mono",
        );
      }
    }
  });

  it("filters CLI engines from the search box", async () => {
    renderPanel();

    await waitFor(() => {
      expect(readGlobalCodexConfigTomlMock).toHaveBeenCalled();
      expect(readGlobalCodexAuthJsonMock).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByPlaceholderText("搜索CLI"), {
      target: { value: "qwen" },
    });

    expect(screen.getByRole("button", { name: /Qwen CLI/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Claude Code CLI/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Codex CLI/ })).toBeNull();
  });

  it("opens the coming-soon page for unsupported CLI placeholders", async () => {
    renderPanel();

    await waitFor(() => {
      expect(readGlobalCodexConfigTomlMock).toHaveBeenCalled();
      expect(readGlobalCodexAuthJsonMock).toHaveBeenCalled();
    });
    fireEvent.click(screen.getByRole("button", { name: /CodeBuddy CLI/ }));

    expect(pushErrorToastMock).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "CodeBuddy CLI" })).toBeTruthy();
    expect(screen.getByText("正在适配此CLI，即将开放")).toBeTruthy();
    const docsLink = screen.getByRole("link", {
      name: "Official docs",
    });
    expect(docsLink.getAttribute("href")).toBe(
      "https://www.codebuddy.ai/docs/cli/quickstart",
    );
    fireEvent.click(docsLink);
    expect(openUrlMock).toHaveBeenCalledWith(
      "https://www.codebuddy.ai/docs/cli/quickstart",
    );
    expect(screen.queryByTestId("provider-list-stub")).toBeNull();
    expect(screen.queryByTestId("current-codex-config-stub")).toBeNull();
  });

  it("renders the Grok CLI tab with official config row and provider list", async () => {
    renderPanel();

    await waitFor(() => {
      expect(readGlobalCodexConfigTomlMock).toHaveBeenCalled();
      expect(readGlobalCodexAuthJsonMock).toHaveBeenCalled();
    });
    fireEvent.click(screen.getByRole("button", { name: /Grok CLI/ }));

    const brandHeader = screen
      .getByRole("heading", { name: "Grok CLI" })
      .closest(".vendor-brand-header") as HTMLElement;
    expect(brandHeader).toBeTruthy();
    const docsLink = within(brandHeader).getByRole("link", {
      name: "Official docs",
    });
    expect(docsLink.getAttribute("href")).toBe("https://x.ai/cli");
    fireEvent.click(docsLink);
    expect(openUrlMock).toHaveBeenCalledWith("https://x.ai/cli");

    expect(screen.getByTestId("grok-provider-list-stub")).toBeTruthy();
    expect(screen.queryByTestId("provider-list-stub")).toBeNull();
    expect(screen.queryByTestId("codex-provider-list-stub")).toBeNull();
    expect(screen.queryByTestId("kimi-provider-list-stub")).toBeNull();
    expect(screen.queryByTestId("current-codex-config-stub")).toBeNull();
    expect(screen.queryByText("正在适配此CLI，即将开放")).toBeNull();
    expect(screen.queryByText("settings.vendor.grokCurrentConfig")).toBeNull();
    expect(screen.queryByText("settings.vendor.grokNoConfig")).toBeNull();
    expect(screen.getByText("Official Config")).toBeTruthy();
    // No third-party active → official defaults to in-use (Codex parity).
    expect(screen.getByText("In Use")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "使用" })).toBeNull();
    // Official config edit entry (pencil when in use).
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(
      screen.queryByText("settings.vendor.grokLocalProviderDescription"),
    ).toBeNull();
    fireEvent.click(
      screen.getAllByRole("button", { name: "What does this do?" })[0],
    );
    expect(
      await screen.findByText("settings.vendor.grokLocalProviderDescription"),
    ).toBeTruthy();
  });

  it("shows Grok official as Use when a managed third-party is active", async () => {
    mockState.grokManagement.grokProviders = [
      {
        id: "third-party-a",
        name: "Third Party A",
        isActive: true,
        baseUrl: "https://example.test",
        apiKey: "k",
        model: "m",
      },
    ];
    renderPanel();

    await waitFor(() => {
      expect(readGlobalCodexConfigTomlMock).toHaveBeenCalled();
    });
    fireEvent.click(screen.getByRole("button", { name: /Grok CLI/ }));

    expect(screen.getByText("Official Config")).toBeTruthy();
    expect(screen.queryByText("In Use")).toBeNull();
    expect(screen.getByRole("button", { name: "使用" })).toBeTruthy();
  });

  it("renders the OpenCode CLI tab with official config row and provider list", async () => {
    renderPanel();

    await waitFor(() => {
      expect(readGlobalCodexConfigTomlMock).toHaveBeenCalled();
      expect(readGlobalCodexAuthJsonMock).toHaveBeenCalled();
    });
    fireEvent.click(screen.getByRole("button", { name: /OpenCode CLI/ }));

    const brandHeader = screen
      .getByRole("heading", { name: "OpenCode CLI" })
      .closest(".vendor-brand-header") as HTMLElement;
    expect(brandHeader).toBeTruthy();
    const docsLink = within(brandHeader).getByRole("link", {
      name: "Official docs",
    });
    expect(docsLink.getAttribute("href")).toBe("https://opencode.ai/docs/");
    fireEvent.click(docsLink);
    expect(openUrlMock).toHaveBeenCalledWith("https://opencode.ai/docs/");

    expect(screen.getByTestId("opencode-provider-list-stub")).toBeTruthy();
    expect(screen.queryByTestId("provider-list-stub")).toBeNull();
    expect(screen.queryByTestId("codex-provider-list-stub")).toBeNull();
    expect(screen.queryByTestId("kimi-provider-list-stub")).toBeNull();
    expect(screen.queryByTestId("grok-provider-list-stub")).toBeNull();
    expect(screen.queryByTestId("current-codex-config-stub")).toBeNull();
    expect(screen.queryByText("正在适配此CLI，即将开放")).toBeNull();
    expect(
      screen.queryByText("settings.vendor.opencodeCurrentConfig"),
    ).toBeNull();
    expect(screen.queryByText("settings.vendor.opencodeNoConfig")).toBeNull();
    expect(screen.getByText("Official Config")).toBeTruthy();
    // No third-party active → official defaults to in-use (Codex parity).
    expect(screen.getByText("In Use")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "使用" })).toBeNull();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(
      screen.queryByText("settings.vendor.opencodeLocalProviderDescription"),
    ).toBeNull();
    fireEvent.click(
      screen.getAllByRole("button", { name: "What does this do?" })[0],
    );
    expect(
      await screen.findByText(
        "settings.vendor.opencodeLocalProviderDescription",
      ),
    ).toBeTruthy();
  });

  it("shows OpenCode official as Use when a managed third-party is active", async () => {
    mockState.openCodeManagement.openCodeProviders = [
      {
        id: "third-party-b",
        name: "Third Party B",
        isActive: true,
        baseUrl: "https://example.test",
        apiKey: "k",
        models: ["m"],
      },
    ];
    renderPanel();

    await waitFor(() => {
      expect(readGlobalCodexConfigTomlMock).toHaveBeenCalled();
    });
    fireEvent.click(screen.getByRole("button", { name: /OpenCode CLI/ }));

    expect(screen.getByText("Official Config")).toBeTruthy();
    expect(screen.queryByText("In Use")).toBeNull();
    expect(screen.getByRole("button", { name: "使用" })).toBeTruthy();
  });

  it("keeps the CLI engine list in its own scroll container", async () => {
    renderPanel();

    await waitFor(() => {
      expect(readGlobalCodexConfigTomlMock).toHaveBeenCalled();
      expect(readGlobalCodexAuthJsonMock).toHaveBeenCalled();
    });

    const nav = screen.getByLabelText("settings.vendorsTitle");
    expect(nav.className).toContain("vendor-engine-nav");
    expect(nav.className).not.toContain("vendor-engine-nav-scroll");
    expect(
      nav.querySelector(":scope > .vendor-engine-nav-scroll"),
    ).toBeTruthy();
  });

  it("switches mobile master–detail pane when selecting a CLI and going back", async () => {
    renderPanel();

    await waitFor(() => {
      expect(readGlobalCodexConfigTomlMock).toHaveBeenCalled();
    });

    const panel = document.querySelector(".vendor-settings-panel");
    expect(panel?.getAttribute("data-mobile-pane")).toBe("list");

    fireEvent.click(screen.getByRole("button", { name: "Codex CLI" }));
    expect(panel?.getAttribute("data-mobile-pane")).toBe("detail");
    expect(
      screen.getByRole("heading", { name: "Codex CLI" }),
    ).toBeTruthy();

    const back = document.querySelector<HTMLButtonElement>(
      ".vendor-settings-mobile-back",
    );
    expect(back).toBeTruthy();
    expect(back?.textContent).toContain("返回 CLI 列表");
    fireEvent.click(back!);
    expect(panel?.getAttribute("data-mobile-pane")).toBe("list");
  });

  it("keeps the Codex runtime refresh action hidden from the brand header", async () => {
    renderPanel();

    await openCodexTab();

    const brandHeader = screen
      .getByRole("heading", { name: "Codex CLI" })
      .closest(".vendor-brand-header") as HTMLElement;
    const codexGroupCard = document.querySelector(
      ".vendor-group-card",
    ) as HTMLElement;

    expect(brandHeader).toBeTruthy();
    expect(
      within(brandHeader).queryByRole("button", {
        name: "settings.codexRuntimeReload",
      }),
    ).toBeNull();
    expect(codexGroupCard).toBeTruthy();
    expect(
      within(codexGroupCard).queryByRole("button", {
        name: "settings.codexRuntimeReload",
      }),
    ).toBeNull();
    expect(document.querySelector(".vendor-codex-runtime-reload-row")).toBeNull();
  });

  it("separates engine settings and provider channels into sibling sections", async () => {
    renderPanel();

    await openCodexTab();

    const dense = document.querySelector(
      ".vendor-tab-content-dense",
    ) as HTMLElement;
    expect(dense).toBeTruthy();

    const engineLabel = within(dense).getByRole("heading", {
      level: 3,
      name: "Engine settings",
    });
    const engineSection = engineLabel.closest(
      ".vendor-settings-section",
    ) as HTMLElement;
    expect(engineSection).toBeTruthy();
    expect(engineSection.querySelector(".vendor-group-card")).toBeTruthy();

    // CodexProviderList is stubbed in this suite; assert the sibling section wraps it.
    const providerStub = within(dense).getByTestId("codex-provider-list-stub");
    const providerSection = providerStub.closest(
      ".vendor-settings-section",
    ) as HTMLElement;
    expect(providerSection).toBeTruthy();
    expect(providerSection).not.toBe(engineSection);
  });

  it("renders a Claude brand header above the provider sections", async () => {
    renderPanel();

    await waitFor(() => {
      expect(readGlobalCodexConfigTomlMock).toHaveBeenCalled();
      expect(readGlobalCodexAuthJsonMock).toHaveBeenCalled();
    });

    const brandHeader = screen
      .getByRole("heading", { name: "Claude Code CLI" })
      .closest(".vendor-brand-header") as HTMLElement;

    expect(brandHeader).toBeTruthy();
    const brandLogo = brandHeader.querySelector(".vendor-brand-logo");
    expect(brandLogo).toBeTruthy();
    expect(brandLogo?.querySelector(".vendor-cli-logo-img")).toBeTruthy();
    expect(brandLogo?.querySelector(".vendor-cli-logo-img-mono")).toBeNull();
    const docsLink = within(brandHeader).getByRole("link", {
      name: "Official docs",
    });
    expect(docsLink.getAttribute("href")).toBe(
      "https://code.claude.com/docs/en/cli-reference",
    );
    fireEvent.click(docsLink);
    expect(openUrlMock).toHaveBeenCalledWith(
      "https://code.claude.com/docs/en/cli-reference",
    );
    expect(
      within(brandHeader).queryByText(
        "Configure Claude Code CLI providers and local settings used by doge.",
      ),
    ).toBeNull();
    expect(screen.getByTestId("claude-local-settings-stub")).toBeTruthy();
    expect(screen.getByTestId("provider-list-stub")).toBeTruthy();
    expect(screen.queryByTestId("current-codex-config-stub")).toBeNull();
  });

  it("renders a Codex brand header above the config sections", async () => {
    renderPanel();

    await openCodexTab();

    const brandHeader = screen
      .getByRole("heading", { name: "Codex CLI" })
      .closest(".vendor-brand-header") as HTMLElement;

    expect(brandHeader).toBeTruthy();
    const brandLogo = brandHeader.querySelector(".vendor-brand-logo");
    expect(brandLogo).toBeTruthy();
    expect(brandLogo?.querySelector(".vendor-cli-logo-img")).toBeTruthy();
    expect(brandLogo?.querySelector(".vendor-cli-logo-img-mono")).toBeNull();
    const docsLink = within(brandHeader).getByRole("link", {
      name: "Official docs",
    });
    expect(docsLink.getAttribute("href")).toBe(
      "https://learn.chatgpt.com/docs/codex/cli",
    );
    fireEvent.click(docsLink);
    expect(openUrlMock).toHaveBeenCalledWith(
      "https://learn.chatgpt.com/docs/codex/cli",
    );
    expect(
      within(brandHeader).queryByText(
        "Configure the Codex CLI used by ccgui and validate the install.",
      ),
    ).toBeNull();
    expect(
      within(brandHeader).queryByRole("button", {
        name: "settings.codexRuntimeReload",
      }),
    ).toBeNull();
  });

  it("renders the Kimi CLI tab with official config row and provider list", async () => {
    renderPanel();

    await waitFor(() => {
      expect(readGlobalCodexConfigTomlMock).toHaveBeenCalled();
      expect(readGlobalCodexAuthJsonMock).toHaveBeenCalled();
    });
    fireEvent.click(screen.getByRole("button", { name: /Kimi CLI/ }));

    const brandHeader = screen
      .getByRole("heading", { name: "Kimi CLI" })
      .closest(".vendor-brand-header") as HTMLElement;
    expect(brandHeader).toBeTruthy();
    const docsLink = within(brandHeader).getByRole("link", {
      name: "Official docs",
    });
    expect(docsLink.getAttribute("href")).toBe(
      "https://www.kimi.com/code/docs/en/",
    );
    fireEvent.click(docsLink);
    expect(openUrlMock).toHaveBeenCalledWith(
      "https://www.kimi.com/code/docs/en/",
    );

    expect(screen.getByTestId("kimi-provider-list-stub")).toBeTruthy();
    expect(screen.queryByTestId("provider-list-stub")).toBeNull();
    expect(screen.queryByTestId("codex-provider-list-stub")).toBeNull();
    expect(screen.queryByTestId("current-codex-config-stub")).toBeNull();
    expect(screen.queryByText("正在适配此CLI，即将开放")).toBeNull();
    // Summary card removed; official config lives in the engine group card.
    expect(screen.queryByText("settings.vendor.kimiCurrentConfig")).toBeNull();
    expect(screen.queryByText("settings.vendor.kimiNoConfig")).toBeNull();
    expect(screen.getByText("Official Config")).toBeTruthy();
    expect(screen.getByText("In Use")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    // Local provider explanation is folded into the row help popover.
    expect(
      screen.queryByText("settings.vendor.kimiLocalProviderDescription"),
    ).toBeNull();
    fireEvent.click(
      screen.getAllByRole("button", { name: "What does this do?" })[0],
    );
    expect(
      await screen.findByText("settings.vendor.kimiLocalProviderDescription"),
    ).toBeTruthy();
  });

  it("shows compact background terminal official actions in the Codex tab", async () => {
    renderPanel();

    const runtimeRow = await openCodexTab();
    const runtimeCardQueries = within(runtimeRow);

    expect(runtimeCardQueries.getByText("Background terminal")).toBeTruthy();
    expect(runtimeCardQueries.getByText("Enable")).toBeTruthy();
    expect(runtimeCardQueries.getByText("Disable")).toBeTruthy();
    expect(runtimeCardQueries.getByText("Follow official default")).toBeTruthy();
    expect(runtimeRow.className).toContain("settings-toggle-row");
    // Long official-status copy lives in the section help popover, not inline.
    expect(
      runtimeCardQueries.queryByText(
        "Official default on this platform: enabled.",
      ),
    ).toBeNull();
    expect(
      runtimeCardQueries.queryByText(
        "Official config status: no explicit unified_exec key; Codex will fall back to the official default or any remaining config.",
      ),
    ).toBeNull();
  });

  it("surfaces per-row Codex engine setting explanations in help popovers", async () => {
    renderPanel();
    await openCodexTab();

    const helpButtons = screen.getAllByRole("button", {
      name: "What does this do?",
    });
    // CurrentCodexGlobalConfigCard is mocked and custom models intentionally
    // uses an inline hint, leaving help for custom path, runtime, and labels.
    expect(helpButtons).toHaveLength(3);

    fireEvent.click(helpButtons[0]);
    expect(
      await screen.findByText("Configure the executable path for this CLI."),
    ).toBeTruthy();
    expect(
      screen.getByText("Leave empty to resolve via system PATH."),
    ).toBeTruthy();

    // Close the open popover before opening the next row help.
    fireEvent.click(helpButtons[0]);
    fireEvent.click(helpButtons[1]);
    expect(
      await screen.findByText("Official default on this platform: enabled."),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Edit the official CODEX_HOME/config.toml unified_exec directly.",
      ),
    ).toBeTruthy();

    fireEvent.click(helpButtons[1]);
    fireEvent.click(helpButtons[2]);
    expect(
      await screen.findByText(
        "Display Codex provider badges in the sidebar and pinned session lists.",
      ),
    ).toBeTruthy();
  });

  it("toggles sidebar provider labels from the Codex provider tab", async () => {
    const { onUpdateAppSettings } = renderPanel();

    await openCodexTab();

    fireEvent.click(
      screen.getByRole("switch", {
        name: "Show provider labels in session lists",
      }),
    );

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ showSidebarProviderLabels: true }),
      );
    });
  });

  it("restores official default without extra confirm dialog", async () => {
    getCodexUnifiedExecExternalStatusMock.mockResolvedValue({
      configPath: "/tmp/codex/config.toml",
      hasExplicitUnifiedExec: true,
      explicitUnifiedExecValue: false,
      officialDefaultEnabled: true,
    });
    restoreCodexUnifiedExecOfficialDefaultMock.mockResolvedValue({
      configPath: "/tmp/codex/config.toml",
      hasExplicitUnifiedExec: false,
      explicitUnifiedExecValue: null,
      officialDefaultEnabled: true,
    });

    renderPanel();
    await openCodexTab();

    fireEvent.click(
      screen.getByRole("button", { name: "Follow official default" }),
    );

    await waitFor(() => {
      expect(restoreCodexUnifiedExecOfficialDefaultMock).toHaveBeenCalledTimes(
        1,
      );
    });
    expect(
      await screen.findByText("Restored the official unified_exec config."),
    ).toBeTruthy();
  });

  it("writes official unified_exec and reloads inherit sessions", async () => {
    const handleReloadCodexRuntimeConfig = vi.fn().mockResolvedValue(undefined);
    setCodexUnifiedExecOfficialOverrideMock.mockResolvedValue({
      configPath: "/tmp/codex/config.toml",
      hasExplicitUnifiedExec: true,
      explicitUnifiedExecValue: true,
      officialDefaultEnabled: true,
    });

    renderPanel({ handleReloadCodexRuntimeConfig });
    await openCodexTab();

    fireEvent.click(screen.getByRole("button", { name: "Enable" }));

    await waitFor(() => {
      expect(setCodexUnifiedExecOfficialOverrideMock).toHaveBeenCalledWith(
        true,
      );
      expect(handleReloadCodexRuntimeConfig).toHaveBeenCalledTimes(1);
    });
    expect(
      await screen.findByText("Wrote official unified_exec = enabled."),
    ).toBeTruthy();
  });

  it("shows the no-session reload message without an applied prefix", async () => {
    renderPanel({
      codexReloadStatus: "applied",
      codexReloadMessage:
        "No Codex session is currently connected. The config has been updated and will apply on the next connection.",
    });

    await openCodexTab();

    expect(
      screen.getByText(
        "No Codex session is currently connected. The config has been updated and will apply on the next connection.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Codex runtime config applied:/)).toBeNull();
  });

  it("hides the temporary Codex runtime reload entry", async () => {
    renderPanel();

    await openCodexTab();

    expect(
      screen.queryByRole("button", { name: "settings.codexRuntimeReload" }),
    ).toBeNull();
    expect(screen.queryByText("settings.codexRuntimeReloadHint")).toBeNull();
  });

  it("groups supported CLIs under 已启用 and keeps 未启用 hidden when empty", async () => {
    renderPanel();

    await waitFor(() => {
      expect(readGlobalCodexConfigTomlMock).toHaveBeenCalled();
    });

    const enabledHeader = screen.getByRole("button", { name: "已启用" });
    const upcomingHeader = screen.getByRole("button", { name: "暂未开放" });
    expect(enabledHeader.getAttribute("aria-expanded")).toBe("true");
    expect(upcomingHeader.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "未启用" })).toBeNull();

    const enabledGroup = enabledHeader.closest(
      ".vendor-engine-group",
    ) as HTMLElement;
    expect(enabledGroup.className).not.toContain(
      "vendor-engine-group-collapsed",
    );
    expect(
      within(enabledGroup).getByRole("button", { name: /OpenCode CLI/ }),
    ).toBeTruthy();

    // jsdom 不应用 CSS,折叠仅体现在 class 与 aria-expanded 上,行仍在 DOM 中。
    const upcomingGroup = upcomingHeader.closest(
      ".vendor-engine-group",
    ) as HTMLElement;
    expect(upcomingGroup.className).toContain("vendor-engine-group-collapsed");
    expect(
      within(upcomingGroup).getByRole("button", { name: /Gemini CLI/ }),
    ).toBeTruthy();
    // 暂未开放行没有「...」启停菜单。
    expect(
      within(upcomingGroup).queryByRole("button", { name: /更多操作/ }),
    ).toBeNull();
  });

  it("disables a CLI from its hover actions menu", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const { onUpdateAppSettings } = renderPanel();

    await waitFor(() => {
      expect(readGlobalCodexConfigTomlMock).toHaveBeenCalled();
    });

    await user.click(getCliRowMoreButton("OpenCode CLI"));
    await user.click(await screen.findByRole("menuitem", { name: "关闭启用" }));

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ disabledCliEngines: ["opencode"] }),
      );
    });
  });

  it("lands a disabled CLI in 未启用(collapsed by default) with config still reachable", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const { onUpdateAppSettings } = renderPanel({
      appSettings: { disabledCliEngines: ["opencode"] },
    });

    await waitFor(() => {
      expect(readGlobalCodexConfigTomlMock).toHaveBeenCalled();
    });

    // 首次挂载即使已有停用项也保持默认折叠(不自动展开)。
    const disabledHeader = screen.getByRole("button", { name: "未启用" });
    expect(disabledHeader.getAttribute("aria-expanded")).toBe("false");
    const disabledGroup = disabledHeader.closest(
      ".vendor-engine-group",
    ) as HTMLElement;
    expect(
      within(disabledGroup).getByRole("button", { name: /OpenCode CLI/ }),
    ).toBeTruthy();

    const enabledGroup = screen
      .getByRole("button", { name: "已启用" })
      .closest(".vendor-engine-group") as HTMLElement;
    expect(
      within(enabledGroup).queryByRole("button", { name: /OpenCode CLI/ }),
    ).toBeNull();

    // 停用不删除配置:点击行仍打开该 CLI 的配置页。
    fireEvent.click(
      within(disabledGroup).getByRole("button", { name: /OpenCode CLI/ }),
    );
    expect(screen.getByTestId("opencode-provider-list-stub")).toBeTruthy();

    await user.click(getCliRowMoreButton("OpenCode CLI"));
    await user.click(await screen.findByRole("menuitem", { name: "启用" }));
    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ disabledCliEngines: [] }),
      );
    });
  });

  it("moves a freshly disabled CLI into 未启用 and auto-expands the group", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    function StatefulPanel() {
      const [settings, setSettings] = useState<AppSettings>({
        showSidebarProviderLabels: false,
        disabledCliEngines: [],
      } as unknown as AppSettings);
      return (
        <VendorSettingsPanel
          appSettings={settings}
          codexReloadStatus="idle"
          codexReloadMessage={null}
          handleReloadCodexRuntimeConfig={vi.fn().mockResolvedValue(undefined)}
          onUpdateAppSettings={async (next) => setSettings(next)}
        />
      );
    }
    render(<StatefulPanel />);

    await waitFor(() => {
      expect(readGlobalCodexConfigTomlMock).toHaveBeenCalled();
    });
    expect(screen.queryByRole("button", { name: "未启用" })).toBeNull();

    await user.click(getCliRowMoreButton("OpenCode CLI"));
    await user.click(await screen.findByRole("menuitem", { name: "关闭启用" }));

    // 新停用的 CLI 落入「未启用」且组自动展开一次,给出可见归宿。
    await waitFor(() => {
      expect(
        screen
          .getByRole("button", { name: "未启用" })
          .getAttribute("aria-expanded"),
      ).toBe("true");
    });
    const disabledGroup = screen
      .getByRole("button", { name: "未启用" })
      .closest(".vendor-engine-group") as HTMLElement;
    expect(
      within(disabledGroup).getByRole("button", { name: /OpenCode CLI/ }),
    ).toBeTruthy();
    const enabledGroup = screen
      .getByRole("button", { name: "已启用" })
      .closest(".vendor-engine-group") as HTMLElement;
    expect(
      within(enabledGroup).queryByRole("button", { name: /OpenCode CLI/ }),
    ).toBeNull();
  });

  it("expands and collapses groups from their headers", async () => {
    renderPanel();

    await waitFor(() => {
      expect(readGlobalCodexConfigTomlMock).toHaveBeenCalled();
    });

    const upcomingHeader = screen.getByRole("button", { name: "暂未开放" });
    expect(upcomingHeader.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(upcomingHeader);
    expect(upcomingHeader.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(upcomingHeader);
    expect(upcomingHeader.getAttribute("aria-expanded")).toBe("false");

    const enabledHeader = screen.getByRole("button", { name: "已启用" });
    expect(enabledHeader.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(enabledHeader);
    expect(enabledHeader.getAttribute("aria-expanded")).toBe("false");
  });

  it("hides group headers while searching", async () => {
    renderPanel();

    await waitFor(() => {
      expect(readGlobalCodexConfigTomlMock).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByPlaceholderText("搜索CLI"), {
      target: { value: "qwen" },
    });

    expect(screen.queryByRole("button", { name: "已启用" })).toBeNull();
    expect(screen.queryByRole("button", { name: "暂未开放" })).toBeNull();
    expect(screen.getByRole("button", { name: /Qwen CLI/ })).toBeTruthy();
  });

  it("shows the empty hint when every supported CLI is disabled", async () => {
    renderPanel({
      appSettings: {
        disabledCliEngines: ["claude", "codex", "kimi", "grok", "opencode"],
      },
    });

    await waitFor(() => {
      expect(readGlobalCodexConfigTomlMock).toHaveBeenCalled();
    });

    expect(screen.getByText("没有已启用的 CLI")).toBeTruthy();
    expect(screen.getByRole("button", { name: "未启用" })).toBeTruthy();
  });
});
