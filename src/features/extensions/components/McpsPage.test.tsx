/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceInfo } from "../../../types";

const translations = vi.hoisted((): Record<string, string> => ({
  "extensions.mcps.title": "MCPs",
  "extensions.mcps.refresh": "Refresh",
  "extensions.mcps.tabs.claude": "Claude Code",
  "extensions.mcps.tabs.codex": "Codex",
  "extensions.mcps.filter.sourceLabel": "Source",
  "extensions.mcps.filter.sourceAll": "All sources",
  "extensions.mcps.filter.sourceConfig": "Config file",
  "extensions.mcps.filter.sourceRuntime": "Runtime",
  "extensions.mcps.filter.resultCount": "{{filtered}} / {{total}} servers",
  "extensions.mcps.filter.clear": "Clear filters",
  "extensions.mcps.search.placeholder": "Search MCP servers…",
  "extensions.mcps.search.aria": "Search MCP servers",
  "extensions.mcps.search.clear": "Clear search",
  "extensions.mcps.groups.config": "Config file",
  "extensions.mcps.groups.runtime": "Runtime",
  "extensions.mcps.row.openDetails": "Open details for {{name}}",
  "extensions.mcps.row.toolsCount": "{{count}} tools",
  "extensions.mcps.badges.enabled": "Enabled",
  "extensions.mcps.badges.disabled": "Disabled",
  "extensions.mcps.badges.builtIn": "Built-in",
  "extensions.mcps.badges.statusUnknown": "Status unknown",
  "extensions.mcps.toggle.ariaEnable": "Enable {{name}}",
  "extensions.mcps.toggle.ariaDisable": "Disable {{name}}",
  "extensions.mcps.toggle.failed": "Failed to toggle {{name}}: {{message}}",
  "extensions.mcps.detail.close": "Close details",
  "extensions.mcps.detail.sectionTitle": "Server details",
  "extensions.mcps.detail.source": "Source",
  "extensions.mcps.detail.sourceClaude": "~/.claude.json",
  "extensions.mcps.detail.sourceDoge": "~/.doge/config.json",
  "extensions.mcps.detail.transport": "Transport",
  "extensions.mcps.detail.transportUnknown": "Unknown transport",
  "extensions.mcps.detail.command": "Command",
  "extensions.mcps.detail.commandMeta": "{{command}} · args {{args}}",
  "extensions.mcps.detail.url": "URL",
  "extensions.mcps.detail.urlMeta": "URL: {{url}}",
  "extensions.mcps.detail.status": "Status",
  "extensions.mcps.detail.auth": "Auth",
  "extensions.mcps.detail.tools": "Tools",
  "extensions.mcps.detail.resourcesTemplatesLabel": "Resources / templates",
  "extensions.mcps.detail.resourcesTemplates":
    "Resources {{resources}} / templates {{templates}}",
  "extensions.mcps.empty.title": "No MCP servers found",
  "extensions.mcps.empty.description":
    "Add MCP servers to your config file, then refresh to see them here.",
  "extensions.mcps.empty.noMatch": "No MCP servers match the current filters",
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      let value = translations[key] ?? key;
      if (params) {
        for (const [paramKey, paramValue] of Object.entries(params)) {
          value = value.replaceAll(`{{${paramKey}}}`, String(paramValue));
        }
      }
      return value;
    },
  }),
}));

vi.mock("../../../services/tauri", () => ({
  listGlobalMcpServers: vi.fn(),
  listMcpServerStatus: vi.fn(),
  setGlobalMcpServerEnabled: vi.fn(),
}));

vi.mock("../../threads/utils/claudeMcpRuntimeSnapshot", () => ({
  getClaudeMcpRuntimeSnapshot: vi.fn(),
}));

import {
  listGlobalMcpServers,
  listMcpServerStatus,
  setGlobalMcpServerEnabled,
} from "../../../services/tauri";
import { getClaudeMcpRuntimeSnapshot } from "../../threads/utils/claudeMcpRuntimeSnapshot";

import { McpsPage } from "./McpsPage";

const workspace: WorkspaceInfo = {
  id: "ws-mcp",
  name: "Workspace MCP",
  path: "/tmp/ws-mcp",
  connected: true,
  settings: { sidebarCollapsed: false },
};

describe("McpsPage", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  beforeEach(() => {
    vi.mocked(listGlobalMcpServers).mockResolvedValue([
      {
        name: "filesystem",
        enabled: true,
        transport: "stdio",
        command: "npx",
        url: null,
        argsCount: 2,
        source: "claude_json",
      },
      {
        name: "github",
        enabled: false,
        transport: "stdio",
        command: "uvx",
        url: null,
        argsCount: 3,
        source: "doge_config",
      },
    ]);
    vi.mocked(listMcpServerStatus).mockResolvedValue({
      result: {
        data: [
          {
            name: "github",
            authStatus: { status: "connected" },
            tools: {
              mcp__github__search_repos: {},
            },
            resources: [],
            resourceTemplates: [],
          },
        ],
      },
    });
    vi.mocked(getClaudeMcpRuntimeSnapshot).mockReturnValue({
      workspaceId: workspace.id,
      sessionId: "session-1",
      tools: [],
      mcpServers: [
        { name: "doge", status: "connected" },
        { name: "chrome-devtools", status: "connected" },
      ],
      capturedAt: Date.now(),
    });
  });

  it("defaults to the first tab and shows the claude inventory", async () => {
    render(<McpsPage activeWorkspace={workspace} />);

    await screen.findByText("filesystem");

    expect(screen.getByRole("button", { name: "Claude Code" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Codex" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("Config file")).toBeTruthy();
    expect(screen.getByText("Runtime")).toBeTruthy();
    expect(screen.getByText("stdio · npx · args 2")).toBeTruthy();
    expect(screen.getByText("Enabled")).toBeTruthy();
    expect(screen.getByText("doge")).toBeTruthy();
    expect(screen.getByText("Built-in")).toBeTruthy();
    expect(screen.getByText("chrome-devtools")).toBeTruthy();
    expect(screen.getByText("3 / 3 servers")).toBeTruthy();
  });

  it("switches to the Codex tab and shows doge config plus runtime inventory", async () => {
    render(<McpsPage activeWorkspace={workspace} />);

    await screen.findByText("filesystem");
    fireEvent.click(screen.getByRole("button", { name: "Codex" }));

    await screen.findAllByText("github");
    expect(screen.getByText("stdio · uvx · args 3")).toBeTruthy();
    expect(screen.getByText("Disabled")).toBeTruthy();
    expect(screen.getByText("connected")).toBeTruthy();
    expect(screen.getByText("1 tools · Resources 0 / templates 0")).toBeTruthy();
    expect(screen.queryByText("filesystem")).toBeNull();
    expect(screen.getByText("2 / 2 servers")).toBeTruthy();
  });

  it("filters rows by the search box and offers a clear action", async () => {
    render(<McpsPage activeWorkspace={workspace} />);

    await screen.findByText("filesystem");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search MCP servers" }), {
      target: { value: "missing" },
    });

    expect(screen.getByText("No MCP servers match the current filters")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Clear filters/ }).length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole("button", { name: "Clear filters" })[0]);
    await screen.findByText("filesystem");
    expect(screen.getByText("3 / 3 servers")).toBeTruthy();
  });

  it("opens the detail panel when a row is clicked and closes it from the header", async () => {
    render(<McpsPage activeWorkspace={workspace} />);

    await screen.findByText("filesystem");
    fireEvent.click(screen.getByRole("button", { name: "Open details for filesystem" }));

    const panel = await screen.findByRole("complementary", { name: "filesystem" });
    expect(panel.textContent).toContain("Server details");
    expect(panel.textContent).toContain("~/.claude.json");
    expect(panel.textContent).toContain("npx · args 2");

    fireEvent.click(screen.getByRole("button", { name: "Close details" }));
    await waitFor(() => {
      expect(screen.queryByRole("complementary", { name: "filesystem" })).toBeNull();
    });
  });

  it("reloads the inventory from the refresh button", async () => {
    render(<McpsPage activeWorkspace={workspace} />);

    await screen.findByText("filesystem");
    expect(listGlobalMcpServers).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));
    await waitFor(() => {
      expect(listGlobalMcpServers).toHaveBeenCalledTimes(2);
    });
  });

  it("toggles a config server from the row switch and reloads", async () => {
    vi.mocked(setGlobalMcpServerEnabled).mockResolvedValue(undefined);
    render(<McpsPage activeWorkspace={workspace} />);

    await screen.findByText("filesystem");
    // claude 侧只有一行配置服务有开关；运行时行只读。
    expect(screen.getAllByRole("switch")).toHaveLength(1);
    expect(listGlobalMcpServers).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("switch", { name: "Disable filesystem" }));
    await waitFor(() => {
      expect(setGlobalMcpServerEnabled).toHaveBeenCalledWith("filesystem", "claude_json", false);
    });
    await waitFor(() => {
      expect(listGlobalMcpServers).toHaveBeenCalledTimes(2);
    });
  });

  it("does not open the detail panel when the row switch is clicked", async () => {
    vi.mocked(setGlobalMcpServerEnabled).mockResolvedValue(undefined);
    render(<McpsPage activeWorkspace={workspace} />);

    await screen.findByText("filesystem");
    fireEvent.click(screen.getByRole("switch", { name: "Disable filesystem" }));

    await waitFor(() => {
      expect(setGlobalMcpServerEnabled).toHaveBeenCalled();
    });
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("shows an error banner when the toggle fails", async () => {
    vi.mocked(setGlobalMcpServerEnabled).mockRejectedValue(new Error("boom"));
    render(<McpsPage activeWorkspace={workspace} />);

    await screen.findByText("filesystem");
    fireEvent.click(screen.getByRole("switch", { name: "Disable filesystem" }));

    await screen.findByText("Failed to toggle filesystem: boom");
    // 失败后也会 reload，回到磁盘上的真实状态
    await waitFor(() => {
      expect(listGlobalMcpServers).toHaveBeenCalledTimes(2);
    });
  });

  it("shows the dashed empty state when nothing is configured", async () => {
    vi.mocked(listGlobalMcpServers).mockResolvedValue([]);
    vi.mocked(listMcpServerStatus).mockResolvedValue({ result: { data: [] } });
    vi.mocked(getClaudeMcpRuntimeSnapshot).mockReturnValue(null);

    render(<McpsPage activeWorkspace={workspace} />);

    await screen.findByText("No MCP servers found");
    expect(
      screen.getByText(
        "Add MCP servers to your config file, then refresh to see them here.",
      ),
    ).toBeTruthy();
  });
});
