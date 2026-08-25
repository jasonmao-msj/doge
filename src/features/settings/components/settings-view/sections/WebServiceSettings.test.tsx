// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@/types";
import {
  generateFixedWebServiceToken,
  WebServiceSettings,
} from "./WebServiceSettings";

const getWebServerStatusMock = vi.fn();
const startWebServerMock = vi.fn();
const stopWebServerMock = vi.fn();
const getDaemonStatusMock = vi.fn();
const startDaemonMock = vi.fn();
const stopDaemonMock = vi.fn();
const getWebAssetsStatusMock = vi.fn();
const installWebAssetsMock = vi.fn();
const installWebAssetsFromFileMock = vi.fn();
const pickWebAssetsArchiveMock = vi.fn();

vi.mock("@/services/tauri", () => ({
  getWebServerStatus: (...args: unknown[]) => getWebServerStatusMock(...args),
  startWebServer: (...args: unknown[]) => startWebServerMock(...args),
  stopWebServer: (...args: unknown[]) => stopWebServerMock(...args),
  getDaemonStatus: (...args: unknown[]) => getDaemonStatusMock(...args),
  startDaemon: (...args: unknown[]) => startDaemonMock(...args),
  stopDaemon: (...args: unknown[]) => stopDaemonMock(...args),
  getWebAssetsStatus: (...args: unknown[]) =>
    getWebAssetsStatusMock(...args),
  installWebAssets: (...args: unknown[]) => installWebAssetsMock(...args),
  installWebAssetsFromFile: (...args: unknown[]) =>
    installWebAssetsFromFileMock(...args),
  pickWebAssetsArchive: (...args: unknown[]) =>
    pickWebAssetsArchiveMock(...args),
}));

const baseSettings = {
  remoteBackendHost: "127.0.0.1:4732",
  webServicePort: 3080,
  webServiceToken: null,
} as AppSettings;

function identityTranslator(key: string): string {
  return key;
}

describe("WebServiceSettings", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getDaemonStatusMock.mockResolvedValue({
      running: false,
      host: "127.0.0.1:4732",
      lastError: null,
    });
    startDaemonMock.mockResolvedValue({
      running: true,
      host: "127.0.0.1:4732",
      lastError: null,
    });
    stopDaemonMock.mockResolvedValue({
      running: false,
      host: "127.0.0.1:4732",
      lastError: null,
    });
    getWebAssetsStatusMock.mockResolvedValue({
      state: "ready",
      installedVersion: "0.7.2",
      requiredVersion: "0.7.2",
      lastError: null,
      installationRequired: true,
    });
    installWebAssetsMock.mockResolvedValue({
      state: "ready",
      installedVersion: "0.7.2",
      requiredVersion: "0.7.2",
      lastError: null,
      installationRequired: true,
    });
    installWebAssetsFromFileMock.mockResolvedValue({
      state: "ready",
      installedVersion: "0.7.2",
      requiredVersion: "0.7.2",
      lastError: null,
      installationRequired: true,
    });
    pickWebAssetsArchiveMock.mockResolvedValue(null);
  });
  afterEach(() => {
    cleanup();
  });

  it("generates fixed token bytes as lowercase hex", () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.fill(10);
      return bytes;
    });

    expect(generateFixedWebServiceToken(getRandomValues)).toBe("0a".repeat(24));
    expect(getRandomValues).toHaveBeenCalledTimes(1);
    expect(getRandomValues.mock.calls[0]?.[0]).toHaveLength(24);
  });

  it("renders running status and masked token", async () => {
    getWebServerStatusMock.mockResolvedValue({
      running: true,
      rpcEndpoint: "127.0.0.1:4732",
      webPort: 3080,
      addresses: ["http://127.0.0.1:3080"],
      webAccessToken: "abcd1234efgh5678",
      lastError: null,
    });

    render(
      <WebServiceSettings
        t={identityTranslator}
        appSettings={baseSettings}
        onUpdateAppSettings={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    await screen.findByText("settings.webServiceRunning");
    expect(
      screen.getByRole("button", { name: "settings.webServiceStop" }),
    ).toBeTruthy();
    expect(screen.getByDisplayValue("http://127.0.0.1:3080")).toBeTruthy();
    expect(screen.getByDisplayValue(/••••/)).toBeTruthy();
    expect(
      screen.getByText("settings.webServiceFixedTokenRunningHint"),
    ).toBeTruthy();
  });

  it("blocks invalid port on blur", async () => {
    getWebServerStatusMock.mockResolvedValue({
      running: false,
      rpcEndpoint: "127.0.0.1:4732",
      webPort: 3080,
      addresses: [],
      webAccessToken: null,
      lastError: null,
    });

    render(
      <WebServiceSettings
        t={identityTranslator}
        appSettings={baseSettings}
        onUpdateAppSettings={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const portInput = await screen.findByLabelText(
      "settings.webServicePortAriaLabel",
    );
    fireEvent.change(portInput, { target: { value: "80" } });
    fireEvent.blur(portInput);

    await waitFor(() => {
      expect(screen.getByText("settings.webServicePortInvalid")).toBeTruthy();
    });
    expect(startWebServerMock).not.toHaveBeenCalled();
    expect(stopWebServerMock).not.toHaveBeenCalled();
  });

  it("renders fixed token controls and saves a trimmed fixed token", async () => {
    getWebServerStatusMock.mockResolvedValue({
      running: false,
      rpcEndpoint: "127.0.0.1:4732",
      webPort: 3080,
      addresses: [],
      webAccessToken: null,
      lastError: null,
    });
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);

    render(
      <WebServiceSettings
        t={identityTranslator}
        appSettings={baseSettings}
        onUpdateAppSettings={onUpdateAppSettings}
      />,
    );

    const fixedTokenInput = await screen.findByLabelText(
      "settings.webServiceFixedTokenAriaLabel",
    );
    expect(screen.getByText("settings.webServiceFixedToken")).toBeTruthy();
    expect(
      screen.getByText("settings.webServiceFixedTokenStoppedHint"),
    ).toBeTruthy();

    fireEvent.change(fixedTokenInput, {
      target: { value: "  durable-token  " },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "settings.webServiceSaveToken" }),
    );

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          webServiceToken: "durable-token",
        }),
      );
    });
  });

  it("clears fixed token back to auto-generate mode", async () => {
    getWebServerStatusMock.mockResolvedValue({
      running: false,
      rpcEndpoint: "127.0.0.1:4732",
      webPort: 3080,
      addresses: [],
      webAccessToken: null,
      lastError: null,
    });
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);

    render(
      <WebServiceSettings
        t={identityTranslator}
        appSettings={{ ...baseSettings, webServiceToken: "durable-token" }}
        onUpdateAppSettings={onUpdateAppSettings}
      />,
    );

    const clearButton = await screen.findByRole("button", {
      name: "settings.webServiceClearToken",
    });
    await waitFor(() => {
      expect((clearButton as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(clearButton);

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          webServiceToken: null,
        }),
      );
    });
  });

  it("generates fixed token and persists it", async () => {
    getWebServerStatusMock.mockResolvedValue({
      running: false,
      rpcEndpoint: "127.0.0.1:4732",
      webPort: 3080,
      addresses: [],
      webAccessToken: null,
      lastError: null,
    });
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    const generateFixedToken = vi.fn(() => "0a".repeat(24));

    render(
      <WebServiceSettings
        t={identityTranslator}
        appSettings={baseSettings}
        onUpdateAppSettings={onUpdateAppSettings}
        generateFixedToken={generateFixedToken}
      />,
    );

    await screen.findByRole("button", {
      name: "settings.webServiceGenerateToken",
    });
    await waitFor(() => {
      expect(
        (
          screen.getByRole("button", {
            name: "settings.webServiceGenerateToken",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false);
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.webServiceGenerateToken",
      }),
    );

    await waitFor(() => {
      expect(generateFixedToken).toHaveBeenCalledTimes(1);
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          webServiceToken: "0a".repeat(24),
        }),
      );
    });
  });

  it("starts without fixed token using explicit auto-generate null", async () => {
    getWebServerStatusMock.mockResolvedValue({
      running: false,
      rpcEndpoint: "127.0.0.1:4732",
      webPort: 3080,
      addresses: [],
      webAccessToken: null,
      lastError: null,
    });
    startWebServerMock.mockResolvedValue({
      running: true,
      rpcEndpoint: "127.0.0.1:4732",
      webPort: 3080,
      addresses: ["http://127.0.0.1:3080"],
      webAccessToken: "runtime-generated-token",
      lastError: null,
    });
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);

    render(
      <WebServiceSettings
        t={identityTranslator}
        appSettings={baseSettings}
        onUpdateAppSettings={onUpdateAppSettings}
      />,
    );

    const startButton = await screen.findByRole("button", {
      name: "settings.webServiceStart",
    });
    await waitFor(() => {
      expect((startButton as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(startButton);

    await waitFor(() => {
      expect(startWebServerMock).toHaveBeenCalledWith({
        port: 3080,
        token: null,
      });
    });
    expect(onUpdateAppSettings).not.toHaveBeenCalledWith(
      expect.objectContaining({
        webServiceToken: "runtime-generated-token",
      }),
    );
  });

  it("passes a trimmed fixed token when starting", async () => {
    getWebServerStatusMock.mockResolvedValue({
      running: false,
      rpcEndpoint: "127.0.0.1:4732",
      webPort: 3080,
      addresses: [],
      webAccessToken: null,
      lastError: null,
    });
    startWebServerMock.mockResolvedValue({
      running: true,
      rpcEndpoint: "127.0.0.1:4732",
      webPort: 3080,
      addresses: ["http://127.0.0.1:3080"],
      webAccessToken: "durable-token",
      lastError: null,
    });

    render(
      <WebServiceSettings
        t={identityTranslator}
        appSettings={{ ...baseSettings, webServiceToken: "  durable-token  " }}
        onUpdateAppSettings={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const startButton = await screen.findByRole("button", {
      name: "settings.webServiceStart",
    });
    await waitFor(() => {
      expect((startButton as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(startButton);

    await waitFor(() => {
      expect(startWebServerMock).toHaveBeenCalledWith({
        port: 3080,
        token: "durable-token",
      });
    });
  });

  it("starts with the current fixed token draft before parent settings rerender", async () => {
    getWebServerStatusMock.mockResolvedValue({
      running: false,
      rpcEndpoint: "127.0.0.1:4732",
      webPort: 3080,
      addresses: [],
      webAccessToken: null,
      lastError: null,
    });
    startWebServerMock.mockResolvedValue({
      running: true,
      rpcEndpoint: "127.0.0.1:4732",
      webPort: 3080,
      addresses: ["http://127.0.0.1:3080"],
      webAccessToken: "draft-token",
      lastError: null,
    });
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);

    render(
      <WebServiceSettings
        t={identityTranslator}
        appSettings={{ ...baseSettings, webServiceToken: "old-token" }}
        onUpdateAppSettings={onUpdateAppSettings}
      />,
    );

    const fixedTokenInput = await screen.findByLabelText(
      "settings.webServiceFixedTokenAriaLabel",
    );
    fireEvent.change(fixedTokenInput, { target: { value: "  draft-token  " } });
    const startButton = screen.getByRole("button", {
      name: "settings.webServiceStart",
    });
    await waitFor(() => {
      expect((startButton as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(startButton);

    await waitFor(() => {
      expect(startWebServerMock).toHaveBeenCalledWith({
        port: 3080,
        token: "draft-token",
      });
    });
  });

  it("does not mutate current runtime token when fixed token changes while running", async () => {
    getWebServerStatusMock.mockResolvedValue({
      running: true,
      rpcEndpoint: "127.0.0.1:4732",
      webPort: 3080,
      addresses: ["http://127.0.0.1:3080"],
      webAccessToken: "current-runtime-token",
      lastError: null,
    });
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);

    render(
      <WebServiceSettings
        t={identityTranslator}
        appSettings={{ ...baseSettings, webServiceToken: "old-fixed-token" }}
        onUpdateAppSettings={onUpdateAppSettings}
      />,
    );

    await screen.findByText("settings.webServiceRunning");
    const fixedTokenInput = screen.getByLabelText(
      "settings.webServiceFixedTokenAriaLabel",
    );
    fireEvent.change(fixedTokenInput, { target: { value: "new-fixed-token" } });
    fireEvent.click(
      screen.getByRole("button", { name: "settings.webServiceSaveToken" }),
    );

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          webServiceToken: "new-fixed-token",
        }),
      );
    });
    expect(
      screen.getByText("settings.webServiceFixedTokenRunningHint"),
    ).toBeTruthy();
    expect(startWebServerMock).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue(/••••/)).toBeTruthy();
  });

  it("starts daemon from daemon controls", async () => {
    const stoppedWebServerStatus = {
      running: false,
      rpcEndpoint: "127.0.0.1:4732",
      webPort: 3080,
      addresses: [],
      webAccessToken: null,
      lastError: null,
    };
    getWebServerStatusMock
      .mockResolvedValueOnce(stoppedWebServerStatus)
      .mockResolvedValueOnce(stoppedWebServerStatus);

    render(
      <WebServiceSettings
        t={identityTranslator}
        appSettings={baseSettings}
        onUpdateAppSettings={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const startDaemonButton = await screen.findByRole("button", {
      name: "settings.webServiceDaemonStart",
    });
    await waitFor(() => {
      expect((startDaemonButton as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(startDaemonButton);

    await waitFor(() => {
      expect(startDaemonMock).toHaveBeenCalledTimes(1);
      expect(getWebServerStatusMock).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByText("settings.webServiceDaemonRunning")).toBeTruthy();
  });

  it("blocks Web Service start until missing assets are installed", async () => {
    getWebAssetsStatusMock.mockResolvedValue({
      state: "missing",
      installedVersion: null,
      requiredVersion: "0.7.2",
      lastError: null,
      installationRequired: true,
    });
    getWebServerStatusMock.mockResolvedValue({
      running: false,
      rpcEndpoint: "127.0.0.1:4732",
      webPort: 3080,
      addresses: [],
      webAccessToken: null,
      lastError: null,
    });

    render(
      <WebServiceSettings
        t={identityTranslator}
        appSettings={baseSettings}
        onUpdateAppSettings={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    await screen.findByText("settings.webServiceAssetsMissing");
    const startButton = screen.getByRole("button", {
      name: "settings.webServiceStart",
    }) as HTMLButtonElement;
    expect(startButton.disabled).toBe(true);

    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.webServiceAssetsInstall",
      }),
    );

    await waitFor(() => {
      expect(installWebAssetsMock).toHaveBeenCalledTimes(1);
      expect(
        screen.getByText("settings.webServiceAssetsReady"),
      ).toBeTruthy();
      expect(startButton.disabled).toBe(false);
    });
  });

  it("keeps install recovery available after an assets installation failure", async () => {
    getWebAssetsStatusMock.mockResolvedValue({
      state: "failed",
      installedVersion: null,
      requiredVersion: "0.7.2",
      lastError: "checksum mismatch",
      installationRequired: true,
    });

    render(
      <WebServiceSettings
        t={identityTranslator}
        appSettings={baseSettings}
        onUpdateAppSettings={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    await screen.findByText("settings.webServiceAssetsFailed");
    expect(screen.getByText("checksum mismatch")).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "settings.webServiceAssetsInstall",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "settings.webServiceAssetsRecheck",
      }),
    ).toBeTruthy();
  });

  it("keeps remote reinstall available when current assets are ready", async () => {
    render(
      <WebServiceSettings
        t={identityTranslator}
        appSettings={baseSettings}
        onUpdateAppSettings={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const reinstallButton = await screen.findByRole("button", {
      name: "settings.webServiceAssetsReinstall",
    });
    fireEvent.click(reinstallButton);

    await waitFor(() => {
      expect(installWebAssetsMock).toHaveBeenCalledTimes(1);
    });
  });

  it("reports a failed reinstall without disabling valid current assets", async () => {
    installWebAssetsMock.mockResolvedValue({
      state: "ready",
      installedVersion: "0.7.2",
      requiredVersion: "0.7.2",
      lastError: "failed to download Web assets checksum: 404 Not Found",
      installationRequired: true,
    });

    render(
      <WebServiceSettings
        t={identityTranslator}
        appSettings={baseSettings}
        onUpdateAppSettings={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: "settings.webServiceAssetsReinstall",
      }),
    );

    await screen.findByText(
      "failed to download Web assets checksum: 404 Not Found",
    );
    expect(
      screen.queryByText("settings.webServiceAssetsInstallSuccess"),
    ).toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "settings.webServiceStart",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("shows button-level progress while rechecking Web assets", async () => {
    let resolveRecheck: (status: unknown) => void = () => undefined;
    getWebAssetsStatusMock
      .mockResolvedValueOnce({
        state: "ready",
        installedVersion: "0.7.2",
        requiredVersion: "0.7.2",
        lastError: null,
        installationRequired: true,
      })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveRecheck = resolve;
        }),
      );

    render(
      <WebServiceSettings
        t={identityTranslator}
        appSettings={baseSettings}
        onUpdateAppSettings={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: "settings.webServiceAssetsRecheck",
      }),
    );

    const checkingButton = await screen.findByRole("button", {
      name: "settings.webServiceAssetsRechecking",
    });
    expect(
      screen.getByText("settings.webServiceAssetsRecheckProgress"),
    ).toBeTruthy();
    expect(checkingButton.getAttribute("aria-busy")).toBe("true");
    expect((checkingButton as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByRole("button", {
        name: "settings.webServiceAssetsReinstall",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);

    resolveRecheck({
      state: "ready",
      installedVersion: "0.7.2",
      requiredVersion: "0.7.2",
      lastError: null,
      installationRequired: true,
    });

    const recheckButton = await screen.findByRole("button", {
      name: "settings.webServiceAssetsRecheck",
    });
    expect(
      screen.getByText("settings.webServiceAssetsRecheckSuccess"),
    ).toBeTruthy();
    expect(recheckButton.getAttribute("aria-busy")).toBe("false");
    expect((recheckButton as HTMLButtonElement).disabled).toBe(false);
  });

  it("installs a selected local Web assets package", async () => {
    getWebAssetsStatusMock.mockResolvedValue({
      state: "missing",
      installedVersion: null,
      requiredVersion: "0.7.2",
      lastError: null,
      installationRequired: true,
    });
    pickWebAssetsArchiveMock.mockResolvedValue(
      "/tmp/ccgui-web-assets_0.7.2.zip",
    );

    render(
      <WebServiceSettings
        t={identityTranslator}
        appSettings={baseSettings}
        onUpdateAppSettings={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const installLocalButton = await screen.findByRole("button", {
      name: "settings.webServiceAssetsInstallLocal",
    });
    await waitFor(() => {
      expect((installLocalButton as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(installLocalButton);

    await waitFor(() => {
      expect(installWebAssetsFromFileMock).toHaveBeenCalledWith(
        "/tmp/ccgui-web-assets_0.7.2.zip",
      );
      expect(screen.getByText("settings.webServiceAssetsReady")).toBeTruthy();
      expect(
        screen.getByText("settings.webServiceAssetsInstallLocalSuccess"),
      ).toBeTruthy();
    });
  });

  it("keeps the current status when local package selection is canceled", async () => {
    getWebAssetsStatusMock.mockResolvedValue({
      state: "missing",
      installedVersion: null,
      requiredVersion: "0.7.2",
      lastError: null,
      installationRequired: true,
    });

    render(
      <WebServiceSettings
        t={identityTranslator}
        appSettings={baseSettings}
        onUpdateAppSettings={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const installLocalButton = await screen.findByRole("button", {
      name: "settings.webServiceAssetsInstallLocal",
    });
    await waitFor(() => {
      expect((installLocalButton as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(installLocalButton);

    await waitFor(() => {
      expect(pickWebAssetsArchiveMock).toHaveBeenCalledTimes(1);
    });
    expect(installWebAssetsFromFileMock).not.toHaveBeenCalled();
    expect(screen.getByText("settings.webServiceAssetsMissing")).toBeTruthy();
    expect(
      screen.queryByText("settings.webServiceAssetsSelectLocalProgress"),
    ).toBeNull();
  });

  it("keeps Web assets installation single-flight", async () => {
    getWebAssetsStatusMock.mockResolvedValue({
      state: "missing",
      installedVersion: null,
      requiredVersion: "0.7.2",
      lastError: null,
      installationRequired: true,
    });
    let resolveInstall: (status: unknown) => void = () => undefined;
    installWebAssetsMock.mockReturnValue(
      new Promise((resolve) => {
        resolveInstall = resolve;
      }),
    );

    render(
      <WebServiceSettings
        t={identityTranslator}
        appSettings={baseSettings}
        onUpdateAppSettings={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const installButton = await screen.findByRole("button", {
      name: "settings.webServiceAssetsInstall",
    });
    await waitFor(() => {
      expect((installButton as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(installButton);

    const installingButton = await screen.findByRole("button", {
      name: "settings.webServiceAssetsInstalling",
    });
    expect((installingButton as HTMLButtonElement).disabled).toBe(true);
    expect(installingButton.getAttribute("aria-busy")).toBe("true");
    expect(
      screen.getByText("settings.webServiceAssetsInstallProgress"),
    ).toBeTruthy();
    fireEvent.click(installingButton);
    expect(installWebAssetsMock).toHaveBeenCalledTimes(1);

    resolveInstall({
      state: "ready",
      installedVersion: "0.7.2",
      requiredVersion: "0.7.2",
      lastError: null,
      installationRequired: true,
    });
    await screen.findByText("settings.webServiceAssetsReady");
    expect(
      screen.getByText("settings.webServiceAssetsInstallSuccess"),
    ).toBeTruthy();
  });

  it.each([
    {
      name: "remote daemon",
      rpcEndpoint: "10.0.0.8:4732",
      installationRequired: true,
    },
    {
      name: "development build",
      rpcEndpoint: "127.0.0.1:4732",
      installationRequired: false,
    },
  ])("does not gate $name on local managed assets", async (scenario) => {
    getWebAssetsStatusMock.mockResolvedValue({
      state: "missing",
      installedVersion: null,
      requiredVersion: "0.7.2",
      lastError: null,
      installationRequired: scenario.installationRequired,
    });
    getWebServerStatusMock.mockResolvedValue({
      running: false,
      rpcEndpoint: scenario.rpcEndpoint,
      webPort: 3080,
      addresses: [],
      webAccessToken: null,
      lastError: null,
    });

    render(
      <WebServiceSettings
        t={identityTranslator}
        appSettings={{
          ...baseSettings,
          remoteBackendHost: scenario.rpcEndpoint,
        }}
        onUpdateAppSettings={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const startButton = await screen.findByRole("button", {
      name: "settings.webServiceStart",
    });
    await waitFor(() => {
      expect((startButton as HTMLButtonElement).disabled).toBe(false);
    });
  });
});
