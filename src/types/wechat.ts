export type WechatLoginState =
  | "unconfigured"
  | "loggedout"
  | "awaitingconfirmation"
  | "needverification"
  | "loggedin"
  | "disconnected"
  | "error";

export type WechatChannelSettings = {
  enabled: boolean;
  bridgeBaseUrl: string;
  webhookHost: string;
  webhookPort: number;
  webhookPath: string;
  deviceType: "ipad" | "mac";
  riskAcknowledged: boolean;
  workspaceId: string | null;
  engine: import("./engine").EngineType | null;
  model: string | null;
  modelCatalogEntryId: string | null;
  providerProfileId: string | null;
};

export type WechatSessionUpdatedEvent = {
  workspaceId: string;
  sessionId: string;
  engine: import("./engine").EngineType;
  model: string | null;
};

export type WechatChannelStatus = {
  state: WechatLoginState;
  message: string;
  listenerRunning: boolean;
};

export type WechatChannelView = {
  settings: WechatChannelSettings;
  status: WechatChannelStatus;
};

export type UpdateWechatChannelRequest = {
  settings: WechatChannelSettings;
};

export type WechatLoginQrCode = {
  value: string;
  expiresAt: string | null;
};
