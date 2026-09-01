import type { AccessMode, ComposerEnginePrefs } from "./conversation";
import type { EmailInboundSettings, EmailSenderSettings } from "./email";
import type { WechatChannelSettings } from "./wechat";
import type { EngineType } from "./engine";
import type { WorkspaceGroup } from "./workspace";

export type BackendMode = "local" | "remote";

export type WorkspaceSessionAttributionMode = "related" | "workspace-only";

export type ThemeAppearance = "light" | "dark";

export type ThemePreference = "system" | "light" | "dark" | "dim" | "custom";

export type LightThemePresetId =
  | "vscode-light-modern"
  | "vscode-light-plus"
  | "vscode-github-light"
  | "vscode-solarized-light"
  | "vscode-catppuccin-latte"
  | "vscode-tokyo-day"
  | "vscode-rose-pine-dawn"
  | "vscode-everforest-light"
  | "vscode-ayu-light";

export type DarkThemePresetId =
  | "vscode-dark-modern"
  | "vscode-dark-plus"
  | "vscode-github-dark"
  | "vscode-github-dark-dimmed"
  | "vscode-one-dark-pro"
  | "vscode-monokai"
  | "vscode-solarized-dark"
  | "vscode-dracula"
  | "vscode-nord"
  | "vscode-catppuccin-mocha"
  | "vscode-tokyo-night"
  | "vscode-rose-pine";

export type ThemePresetId = LightThemePresetId | DarkThemePresetId;

/** Dock / app logo preference. See `features/theme/utils/dockIcon.ts`. */
export type DockIconId =
  | "default"
  | "multi-orbit-hub"
  | "open-star-ring"
  | "gravitational-core"
  | "dual-orbit-handoff"
  | "layered-control-plane"
  | "four-port-router"
  | "adaptive-routing-fabric"
  | "triadic-router";

export type AppMode = "chat" | "kanban" | "gitHistory" | "extensions";

export type ComposerEditorPreset = "default" | "helpful" | "smart";

export type ComposerSendShortcut = "enter" | "cmdEnter";

export type CanvasWidthMode = "narrow" | "wide";

export type LayoutMode = "default" | "swapped";

export type ComposerEditorSettings = {
  preset: ComposerEditorPreset;
  expandFenceOnSpace: boolean;
  expandFenceOnEnter: boolean;
  fenceLanguageTags: boolean;
  fenceWrapSelection: boolean;
  autoWrapPasteMultiline: boolean;
  autoWrapPasteCodeLike: boolean;
  continueListOnShiftEnter: boolean;
};

export type OpenAppTarget = {
  id: string;
  label: string;
  kind: "app" | "command" | "finder";
  appName?: string | null;
  command?: string | null;
  args: string[];
};

export type CodexUnifiedExecPolicy =
  "inherit" | "forceEnabled" | "forceDisabled";

export type CodexUnifiedExecExternalStatus = {
  configPath: string | null;
  hasExplicitUnifiedExec: boolean;
  explicitUnifiedExecValue: boolean | null;
  officialDefaultEnabled: boolean;
};

export type AppSettings = {
  claudeBin: string | null;
  kimiBin: string | null;
  grokBin: string | null;
  opencodeBin: string | null;
  codexBin: string | null;
  codexArgs: string | null;
  terminalShellPath: string | null;
  /** Legacy CLI visibility blacklist; product-managed Claude/Codex/Kimi are always enabled. */
  disabledCliEngines: string[];
  sessionAttributionMode?: WorkspaceSessionAttributionMode;
  backendMode: BackendMode;
  remoteBackendHost: string;
  remoteBackendToken: string | null;
  webServicePort: number;
  webServiceToken: string | null;
  systemProxyEnabled: boolean;
  systemProxyUrl: string | null;
  defaultAccessMode: AccessMode;
  composerModelShortcut: string | null;
  composerAccessShortcut: string | null;
  composerReasoningShortcut: string | null;
  composerCollaborationShortcut: string | null;
  interruptShortcut: string | null;
  openSettingsShortcut: string | null;
  newWindowShortcut: string | null;
  newAgentShortcut: string | null;
  newWorktreeAgentShortcut: string | null;
  newCloneAgentShortcut: string | null;
  archiveThreadShortcut: string | null;
  closeCurrentSessionShortcut: string | null;
  openChatShortcut: string | null;
  openKanbanShortcut: string | null;
  cycleOpenSessionPrevShortcut: string | null;
  cycleOpenSessionNextShortcut: string | null;
  toggleLeftConversationSidebarShortcut: string | null;
  toggleRightConversationSidebarShortcut: string | null;
  toggleProjectsSidebarShortcut: string | null;
  toggleGitSidebarShortcut: string | null;
  toggleGlobalSearchShortcut: string | null;
  toggleDebugPanelShortcut: string | null;
  toggleTerminalShortcut: string | null;
  toggleRuntimeConsoleShortcut: string | null;
  toggleFilesSurfaceShortcut: string | null;
  saveFileShortcut: string | null;
  findInFileShortcut: string | null;
  expandSelectionShortcut: string | null;
  toggleGitDiffListViewShortcut: string | null;
  toggleGitGraphShortcut: string | null;
  openNotesShortcut: string | null;
  openIntentCanvasShortcut: string | null;
  openRadarShortcut: string | null;
  openProjectMapShortcut: string | null;
  openBrowserDockShortcut: string | null;
  openFileCompareShortcut: string | null;
  increaseUiScaleShortcut: string | null;
  decreaseUiScaleShortcut: string | null;
  resetUiScaleShortcut: string | null;
  cycleAgentNextShortcut: string | null;
  cycleAgentPrevShortcut: string | null;
  cycleWorkspaceNextShortcut: string | null;
  cycleWorkspacePrevShortcut: string | null;
  lastComposerModelId: string | null;
  lastComposerReasoningEffort: string | null;
  lastComposerPrefsByEngine?: Partial<Record<EngineType, ComposerEnginePrefs>>;
  uiScale: number;
  theme: ThemePreference;
  /** macOS Dock + in-app logo preference; default is the shipping product icon. */
  dockIconId?: DockIconId;
  lightThemePresetId?: LightThemePresetId;
  darkThemePresetId?: DarkThemePresetId;
  customThemePresetId?: ThemePresetId;
  customSkillDirectories?: string[];
  canvasWidthMode: CanvasWidthMode;
  layoutMode?: LayoutMode;
  userMsgColor: string;
  usageShowRemaining: boolean;
  showMessageAnchors: boolean;
  showSidebarProviderLabels: boolean;
  performanceCompatibilityModeEnabled: boolean;
  uiFontFamily: string;
  codeFontFamily: string;
  codeFontSize: number;
  notificationSoundsEnabled: boolean;
  notificationSoundId: string;
  notificationSoundCustomPath: string;
  systemNotificationEnabled: boolean;
  emailSender: EmailSenderSettings;
  emailInbound?: EmailInboundSettings;
  wechatChannel?: WechatChannelSettings;
  preloadGitDiffs: boolean;
  detachedExternalChangeAwarenessEnabled?: boolean;
  detachedExternalChangeWatcherEnabled?: boolean;
  experimentalCollabEnabled: boolean;
  experimentalCollaborationModesEnabled: boolean;
  codexModeEnforcementEnabled?: boolean;
  experimentalSteerEnabled: boolean;
  codexUnifiedExecPolicy: CodexUnifiedExecPolicy;
  experimentalUnifiedExecEnabled?: boolean | null;
  chatCanvasUseNormalizedRealtime: boolean;
  chatCanvasUseUnifiedHistoryLoader: boolean;
  chatCanvasUsePresentationProfile: boolean;
  dictationEnabled: boolean;
  dictationModelId: string;
  dictationPreferredLanguage: string | null;
  dictationHoldKey: string | null;
  composerEditorPreset: ComposerEditorPreset;
  composerSendShortcut: ComposerSendShortcut;
  composerFenceExpandOnSpace: boolean;
  composerFenceExpandOnEnter: boolean;
  composerFenceLanguageTags: boolean;
  composerFenceWrapSelection: boolean;
  composerFenceAutoWrapPasteMultiline: boolean;
  composerFenceAutoWrapPasteCodeLike: boolean;
  composerListContinuation: boolean;
  composerCodeBlockCopyUseModifier: boolean;
  workspaceGroups: WorkspaceGroup[];
  openAppTargets: OpenAppTarget[];
  selectedOpenAppId: string;
  runtimeRestoreThreadsOnlyOnLaunch: boolean;
  runtimeForceCleanupOnExit: boolean;
  runtimeOrphanSweepOnLaunch: boolean;
  codexMaxHotRuntimes: number;
  codexMaxWarmRuntimes: number;
  codexWarmTtlSeconds: number;
  codexAutoCompactionEnabled: boolean;
  codexAutoCompactionThresholdPercent: number;
  browserAgentEnabled: boolean;
  browserAgentPreferBuiltIn: boolean;
  browserAgentAllowExternalProviderFallback: boolean;
  streamingEnabled?: boolean;
  autoOpenFileEnabled?: boolean;
  diffExpandedByDefault?: boolean;
  commitPrompt?: string;
  sendShortcut?: "enter" | "cmdEnter";
  enabledCuratedSkillIds?: string[];
  curatedSkillDefaultsVersion: number;
  enabledBuiltInAgentIds?: string[];
};
