// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCliVersionStatus } from "../hooks/useCliVersionStatus";
import {
  CliLifecycleHeaderActions,
  CliLifecycleProvider,
} from "./CliLifecycleHeaderActions";

vi.mock("../hooks/useCliVersionStatus", () => ({
  useCliVersionStatus: vi.fn(),
}));

vi.mock("@/features/settings/hooks/useCliInstallLifecycle", () => ({
  useCliInstallLifecycle: vi.fn(() => ({
    installerState: null,
    installerNowMs: 0,
    isBusy: false,
    requestInstallPlan: vi.fn(),
    confirmInstallRun: vi.fn(),
    cancelInstaller: vi.fn(),
  })),
}));

const useCliVersionStatusMock = vi.mocked(useCliVersionStatus);

function renderHeader(
  status: {
    localVersion: string | null;
    latestVersion: string | null;
    updateAvailable: boolean;
    installed?: boolean;
  } | null,
  options?: { loading?: boolean; engine?: "claude" | "codex" | "kimi" | "grok" },
) {
  useCliVersionStatusMock.mockReturnValue({
    status: status
      ? {
          engine: "claude",
          installed: status.installed ?? true,
          nodeOk: true,
          details: null,
          ...status,
        }
      : null,
    loading: options?.loading ?? false,
    error: null,
    refresh: vi.fn(),
  });

  render(
    <CliLifecycleProvider engine={options?.engine ?? "claude"} active>
      <CliLifecycleHeaderActions />
    </CliLifecycleProvider>,
  );
}

describe("CliLifecycleHeaderActions", () => {
  beforeEach(() => {
    useCliVersionStatusMock.mockReset();
  });

  it("does not claim the CLI is current when the latest version is unknown", () => {
    renderHeader({
      localVersion: "2.0.52 (Claude Code)",
      latestVersion: null,
      updateAvailable: false,
    });

    expect(document.querySelectorAll('[data-slot="badge"]')).toHaveLength(1);
    expect(screen.queryByText("Up to date")).toBeNull();
  });

  it("shows the available version and update action when an update exists", () => {
    renderHeader({
      localVersion: "2.0.52 (Claude Code)",
      latestVersion: "2.0.53",
      updateAvailable: true,
    }, { engine: "grok" });

    expect(screen.getByText("→ 2.0.53")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "settings.cliUpdateLatest" }),
    ).toBeTruthy();
  });

  it("shows current status only after the latest version is known", () => {
    renderHeader({
      localVersion: "2.0.53 (Claude Code)",
      latestVersion: "2.0.53",
      updateAvailable: false,
    });

    expect(screen.getByText("Up to date")).toBeTruthy();
  });

  it("shows a checking placeholder instead of not-installed while status is cold", () => {
    renderHeader(null, { loading: true });

    expect(screen.getByText("settings.cliVersionChecking")).toBeTruthy();
    expect(screen.queryByText("settings.cliVersionNotInstalled")).toBeNull();
  });

  it("keeps the last known version visible while a soft refresh is in flight", () => {
    renderHeader(
      {
        localVersion: "2.1.226 (Claude Code)",
        latestVersion: "2.1.226",
        updateAvailable: false,
      },
      { loading: true },
    );

    // Test i18n mock returns the key; presence of version label means not-checking.
    expect(screen.getByText("settings.cliVersionLabel")).toBeTruthy();
    expect(screen.getByText("Up to date")).toBeTruthy();
    expect(screen.queryByText("settings.cliVersionChecking")).toBeNull();
  });

  it("shows not-installed only after a definitive status says so", () => {
    renderHeader({
      localVersion: null,
      latestVersion: null,
      updateAvailable: false,
      installed: false,
    });

    expect(screen.getByText("settings.cliVersionNotInstalled")).toBeTruthy();
  });

  it.each([
    ["Codex", "codex", "0.147.0"],
    ["Claude", "claude", "2.1.233"],
    ["Kimi", "kimi", "0.38.0"],
  ] as const)("does not expose the npm installer for managed %s", (_label, engine, version) => {
    renderHeader(
      {
        localVersion: version,
        latestVersion: null,
        updateAvailable: false,
      },
      { engine },
    );

    expect(screen.getByText("settings.cliVersionLabel")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "settings.cliInstallLatest" })).toBeNull();
    expect(screen.queryByRole("button", { name: "settings.cliUpdateLatest" })).toBeNull();
  });
});
