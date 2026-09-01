import { invoke } from "@tauri-apps/api/core";
import type {
  UpdateWechatChannelRequest,
  WechatChannelView,
  WechatChannelStatus,
  WechatLoginQrCode,
} from "../../types";

export function getWechatChannel(): Promise<WechatChannelView> {
  return invoke<WechatChannelView>("get_wechat_channel");
}

export function updateWechatChannel(
  request: UpdateWechatChannelRequest,
): Promise<WechatChannelView> {
  return invoke<WechatChannelView>("update_wechat_channel", { request });
}

export function getWechatLoginQrCode(): Promise<WechatLoginQrCode> {
  return invoke<WechatLoginQrCode>("wechat_get_login_qrcode");
}

export function getWechatLoginStatus(): Promise<WechatChannelStatus> {
  return invoke<WechatChannelStatus>("wechat_get_login_status");
}

export function submitWechatLoginVerify(code: string): Promise<WechatChannelStatus> {
  return invoke<WechatChannelStatus>("wechat_submit_login_verify", { code });
}

export function testWechatConnection(): Promise<string> {
  return invoke<string>("wechat_test_connection");
}

export function sendWechatReply(wxid: string, text: string): Promise<number> {
  return invoke<number>("wechat_send_reply", { wxid, text });
}
