// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ask } from "@tauri-apps/plugin-dialog";
import type { TFunction } from "i18next";
import {
  getWechatChannel,
  getWechatLoginQrCode,
  getWechatLoginStatus,
  submitWechatLoginVerify,
  updateWechatChannel,
} from "@/services/tauri";
import type {
  AppSettings,
  WechatChannelSettings as WechatChannelSettingsValue,
} from "@/types";
import { WechatChannelSettings } from "./WechatChannelSettings";

const { qrToDataUrl } = vi.hoisted(() => ({
  qrToDataUrl: vi.fn<(value: string) => Promise<string>>(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn() }));
vi.mock("qrcode", () => ({ default: { toDataURL: qrToDataUrl } }));
vi.mock("@/services/tauri", () => ({
  getWechatChannel: vi.fn(),
  getWechatLoginQrCode: vi.fn(),
  getWechatLoginStatus: vi.fn(),
  submitWechatLoginVerify: vi.fn(),
  testWechatConnection: vi.fn(),
  updateWechatChannel: vi.fn(),
}));

const settings: WechatChannelSettingsValue = {
  enabled: false,
  bridgeBaseUrl: "",
  webhookHost: "127.0.0.1",
  webhookPort: 18790,
  webhookPath: "/webhook/wechat",
  deviceType: "ipad",
  riskAcknowledged: false,
  workspaceId: "legacy-workspace",
  engine: "codex",
  model: "legacy-model",
  modelCatalogEntryId: "legacy-model",
  providerProfileId: "legacy-provider",
};

const view = {
  settings,
  status: {
    state: "unconfigured" as const,
    message: "not configured",
    listenerRunning: false,
  },
};

function renderSettings() {
  return render(
    <WechatChannelSettings
      t={((key: string) => key) as TFunction}
      appSettings={{ wechatChannel: settings } as AppSettings}
      onUpdateAppSettings={vi.fn().mockResolvedValue(undefined)}
    />,
  );
}

describe("WechatChannelSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getWechatChannel).mockResolvedValue(view);
    vi.mocked(getWechatLoginStatus).mockResolvedValue(view.status);
    vi.mocked(getWechatLoginQrCode).mockResolvedValue({
      value: "https://ilinkai.weixin.qq.com/qr/test",
      expiresAt: null,
    });
    qrToDataUrl.mockResolvedValue("data:image/png;base64,generated");
    vi.mocked(submitWechatLoginVerify).mockResolvedValue({
      state: "awaitingconfirmation",
      message: "waiting",
      listenerRunning: true,
    });
    vi.mocked(updateWechatChannel).mockResolvedValue(view);
    vi.mocked(ask).mockResolvedValue(false);
  });

  it("requires explicit risk confirmation before enabling the channel", async () => {
    const user = userEvent.setup();
    renderSettings();

    const toggle = await screen.findByRole("switch");
    await user.click(toggle);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(updateWechatChannel).not.toHaveBeenCalled();

    vi.mocked(ask).mockResolvedValue(true);
    await user.click(toggle);
    await waitFor(() => {
      expect(updateWechatChannel).toHaveBeenCalledWith({
        settings: expect.objectContaining({ enabled: true, riskAcknowledged: true }),
      });
      expect(getWechatLoginQrCode).toHaveBeenCalledTimes(1);
    });
  });

  it("persists disabling an enabled channel", async () => {
    const user = userEvent.setup();
    vi.mocked(getWechatChannel).mockResolvedValue({
      ...view,
      settings: { ...settings, enabled: true, riskAcknowledged: true },
    });
    renderSettings();

    await user.click(await screen.findByRole("switch"));
    await waitFor(() => {
      expect(updateWechatChannel).toHaveBeenCalledWith({
        settings: expect.objectContaining({ enabled: false }),
      });
    });
  });

  it("cleans up status polling when unmounted", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval", "Date"],
    });
    vi.mocked(getWechatChannel).mockResolvedValue({
      ...view,
      settings: { ...settings, enabled: true, riskAcknowledged: true },
    });
    const { unmount } = renderSettings();
    expect(getWechatChannel).toHaveBeenCalled();
    unmount();
    vi.advanceTimersByTime(10_000);
    expect(getWechatLoginStatus).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("does not expose bridge secrets or manual routing selectors", async () => {
    renderSettings();

    await screen.findByRole("switch");
    expect(screen.queryByLabelText("settings.wechatBridgeUrl")).toBeNull();
    expect(screen.queryByLabelText("settings.wechatApiKey")).toBeNull();
    expect(screen.queryByLabelText("settings.wechatWebhookToken")).toBeNull();
    expect(screen.queryByLabelText("settings.wechatWorkspace")).toBeNull();
    expect(screen.queryByLabelText("settings.wechatExecutionTarget")).toBeNull();
    expect(updateWechatChannel).not.toHaveBeenCalled();
  });

  it("automatically renders the Tencent iLink QR when enabled and logged out", async () => {
    vi.mocked(getWechatChannel).mockResolvedValue({
      ...view,
      settings: { ...settings, enabled: true, riskAcknowledged: true },
      status: { state: "loggedout", message: "scan", listenerRunning: true },
    });
    renderSettings();

    await waitFor(() => {
      expect(qrToDataUrl).toHaveBeenCalledWith(
        "https://ilinkai.weixin.qq.com/qr/test",
        expect.objectContaining({ width: 240 }),
      );
    });
    expect(
      (await screen.findByRole("img", { name: "settings.wechatQrAlt" })).getAttribute("src"),
    ).toBe("data:image/png;base64,generated");
  });

  it("submits the numeric verification code requested by Tencent iLink", async () => {
    const user = userEvent.setup();
    vi.mocked(getWechatChannel).mockResolvedValue({
      ...view,
      settings: { ...settings, enabled: true, riskAcknowledged: true },
      status: {
        state: "needverification",
        message: "verification required",
        listenerRunning: true,
      },
    });
    renderSettings();

    const input = await screen.findByLabelText("settings.wechatVerifyLabel");
    await user.type(input, "12a345");
    await user.click(screen.getByRole("button", { name: "settings.wechatVerifySubmit" }));
    await waitFor(() => {
      expect(submitWechatLoginVerify).toHaveBeenCalledWith("12345");
    });
  });
});
