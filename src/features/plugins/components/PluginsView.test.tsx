// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PluginsView } from "./PluginsView";
import type { InstalledPlugin } from "../types";

const installPluginMock = vi.fn();
const uninstallPluginMock = vi.fn();
const refreshInstalledPluginsMock = vi.fn();
const useInstalledPluginsMock = vi.fn<() => InstalledPlugin[]>();
const openUrlMock = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        "pluginsPage.title": "Plugins",
        "pluginsPage.subtitle": "Install plugins from GitHub",
        "pluginsPage.installedSection": "Installed",
        "pluginsPage.officialSection": "Official Plugins",
        "pluginsPage.install": "Install",
        "pluginsPage.installing": "Installing…",
        "pluginsPage.installedBadge": "Installed badge",
        "pluginsPage.uninstall": "Uninstall",
        "pluginsPage.uninstalling": "Uninstalling…",
        "pluginsPage.openRepository": "View Repository",
        "pluginsPage.customInstallTitle": "Install Custom Plugin",
        "pluginsPage.customInstallPlaceholder": "GitHub URL or local path",
        "pluginsPage.customInstallHint": "Root must contain plugin.json",
        "pluginsPage.installSuccess": "Plugin installed",
        "pluginsPage.installFailed": "Plugin install failed",
        "pluginsPage.uninstallSuccess": "Plugin uninstalled",
        "pluginsPage.uninstallFailed": "Plugin uninstall failed",
        "pluginsPage.emptyInstalled": "No plugins installed yet",
        "pluginsPage.skillBadge": "Skill",
        "pluginsPage.viewerBadge": "Viewer",
        "pluginsPage.skillLinked": "Skill linked",
        "pluginsPage.skillNotLinked": "Skill not linked",
        "pluginsPage.versionLabel": `Version ${params?.version ?? ""}`,
        "settings.backToApp": "Back to app",
      };
      return translations[key] ?? key;
    },
  }),
}));

vi.mock("../../../services/tauri/plugins", () => ({
  installPlugin: (...args: unknown[]) => installPluginMock(...args),
  uninstallPlugin: (...args: unknown[]) => uninstallPluginMock(...args),
}));

vi.mock("../installedPluginsStore", () => ({
  refreshInstalledPlugins: (...args: unknown[]) =>
    refreshInstalledPluginsMock(...args),
  useInstalledPlugins: () => useInstalledPluginsMock(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (...args: unknown[]) => openUrlMock(...args),
}));

function buildInstalledPlugin(
  overrides: Partial<InstalledPlugin["manifest"]> = {},
): InstalledPlugin {
  return {
    installPath: "/tmp/plugins/gzh-design",
    skillLinked: true,
    manifest: {
      manifestVersion: 1,
      id: "gzh-design",
      name: "公众号排版",
      version: "1.2.0",
      description: "Markdown 转公众号 HTML",
      repository: "https://github.com/isjiamu/gzh-design-skill",
      keywords: [],
      capabilities: {
        skill: { entry: "SKILL.md" },
        viewer: { filePattern: "**/*.gzh.html", action: "html-preview" },
      },
      ...overrides,
    },
  };
}

describe("PluginsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refreshInstalledPluginsMock.mockResolvedValue([]);
  });

  it("renders installed plugin card with version, badges and skill status", () => {
    useInstalledPluginsMock.mockReturnValue([buildInstalledPlugin()]);

    render(<PluginsView onAppModeChange={vi.fn()} />);

    expect(screen.getByText("Plugins")).toBeTruthy();
    expect(screen.getAllByText("公众号排版").length).toBeGreaterThan(0);
    expect(screen.getByText("Version 1.2.0")).toBeTruthy();
    expect(screen.getByText("Skill")).toBeTruthy();
    expect(screen.getByText("Viewer")).toBeTruthy();
    expect(screen.getByText("Skill linked")).toBeTruthy();
    // 官方目录中的同 id 插件展示已安装徽章而非安装按钮
    expect(screen.getByText("Installed badge")).toBeTruthy();
  });

  it("shows empty state and official install button when nothing is installed", () => {
    useInstalledPluginsMock.mockReturnValue([]);

    render(<PluginsView onAppModeChange={vi.fn()} />);

    expect(screen.getByText("No plugins installed yet")).toBeTruthy();
    const installButtons = screen.getAllByRole("button", { name: "Install" });
    expect(installButtons.length).toBeGreaterThan(0);
  });

  it("installs an official plugin from its install source and refreshes the list", async () => {
    useInstalledPluginsMock.mockReturnValue([]);
    installPluginMock.mockResolvedValue(buildInstalledPlugin());

    render(<PluginsView onAppModeChange={vi.fn()} />);

    const [officialInstallButton] = screen.getAllByRole("button", {
      name: "Install",
    });
    fireEvent.click(officialInstallButton);

    await waitFor(() => {
      // 调试期 gzh-design 声明了本地 installSource，安装来源优先取它；
      // 未声明 installSource 的条目回退 repository。
      expect(installPluginMock).toHaveBeenCalledWith(
        "/Users/zhukunpeng/Desktop/CC GUI 项目/plugins-demos/gzh-design-skill",
      );
      expect(refreshInstalledPluginsMock).toHaveBeenCalledTimes(1);
    });
  });

  it("uninstalls an installed plugin by id and refreshes the list", async () => {
    useInstalledPluginsMock.mockReturnValue([buildInstalledPlugin()]);
    uninstallPluginMock.mockResolvedValue(undefined);

    render(<PluginsView onAppModeChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Uninstall" }));

    await waitFor(() => {
      expect(uninstallPluginMock).toHaveBeenCalledWith("gzh-design");
      expect(refreshInstalledPluginsMock).toHaveBeenCalledTimes(1);
    });
  });

  it("installs a custom plugin from the input and clears it on success", async () => {
    useInstalledPluginsMock.mockReturnValue([]);
    installPluginMock.mockResolvedValue(buildInstalledPlugin());

    render(<PluginsView onAppModeChange={vi.fn()} />);

    const input = screen.getByPlaceholderText("GitHub URL or local path");
    fireEvent.change(input, { target: { value: "/tmp/my-plugin" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(installPluginMock).toHaveBeenCalledWith("/tmp/my-plugin");
      expect((input as HTMLInputElement).value).toBe("");
    });
  });

  it("returns to chat mode from the back button", () => {
    useInstalledPluginsMock.mockReturnValue([]);
    const onAppModeChange = vi.fn();

    render(<PluginsView onAppModeChange={onAppModeChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Back to app" }));

    expect(onAppModeChange).toHaveBeenCalledWith("chat");
  });
});
