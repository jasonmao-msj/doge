import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { sendWechatReply, submitWechatLoginVerify, updateWechatChannel } from "./wechat";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("wechat Tauri service mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it("passes the nested update request through the IPC boundary", async () => {
    const request = {
      settings: {
        enabled: true,
        bridgeBaseUrl: "http://127.0.0.1:18789",
        webhookHost: "127.0.0.1",
        webhookPort: 18790,
        webhookPath: "/webhook/wechat",
        deviceType: "ipad" as const,
        riskAcknowledged: true,
        workspaceId: "workspace-a",
        engine: "codex" as const,
        model: "gpt-5.6-sol",
        modelCatalogEntryId: "catalog-sol",
        providerProfileId: "provider-openai",
      },
    };

    await updateWechatChannel(request);

    expect(invoke).toHaveBeenCalledWith("update_wechat_channel", { request });
  });

  it("maps reply target and text without reshaping the payload", async () => {
    await sendWechatReply("wxid-user", "reply text");

    expect(invoke).toHaveBeenCalledWith("wechat_send_reply", {
      wxid: "wxid-user",
      text: "reply text",
    });
  });

  it("submits the Tencent iLink verification code", async () => {
    await submitWechatLoginVerify("123456");

    expect(invoke).toHaveBeenCalledWith("wechat_submit_login_verify", {
      code: "123456",
    });
  });
});
