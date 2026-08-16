import type {
  ApiKeyCandidateHandleV1,
  ApiKeyCandidateListViewV1,
  ConfigFileDetailViewV1,
  ConfigurationOfferViewV1,
  ConfigurationPlanViewV1,
  ConfigurationResultViewV1,
} from "../contracts";

export type AccountAuthSurfaceV1 =
  | "login"
  | "register"
  | "recover"
  | "verification"
  | "mfa"
  | "oauthWaiting"
  | "oauthAccountCompletion"
  | "resetRequested"
  | "resetPassword";

export type AccountCenterTabV1 = "overview" | "usage" | "security";

export type AccountConfigurationSurfaceV1 = {
  readonly open: boolean;
  readonly bubbleVisible: boolean;
  readonly offer: ConfigurationOfferViewV1 | null;
  readonly plan: ConfigurationPlanViewV1 | null;
  readonly result: ConfigurationResultViewV1 | null;
  readonly expandedFile: string | null;
  readonly fileDetail: ConfigFileDetailViewV1 | null;
  readonly loadingDetail: boolean;
  readonly applying: boolean;
  readonly keyCandidates: ApiKeyCandidateListViewV1 | null;
  readonly selectedKey: ApiKeyCandidateHandleV1 | null;
  readonly loadingKeys: boolean;
  readonly selectingKey: boolean;
  readonly managedKeyReady: boolean;
};

export const INITIAL_CONFIGURATION_SURFACE_V1: AccountConfigurationSurfaceV1 = {
  open: false,
  bubbleVisible: false,
  offer: null,
  plan: null,
  result: null,
  expandedFile: null,
  fileDetail: null,
  loadingDetail: false,
  applying: false,
  keyCandidates: null,
  selectedKey: null,
  loadingKeys: false,
  selectingKey: false,
  managedKeyReady: false,
};
