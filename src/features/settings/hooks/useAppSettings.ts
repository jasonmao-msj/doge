import { useCallback, useEffect, useRef, useState } from "react";
import type { AppSettings } from "../../../types";
import i18n from "../../../i18n";
import { pushErrorToast } from "../../../services/toasts";
import {
  getAppSettings,
  runClaudeDoctor,
  runCodexDoctor,
  runGrokDoctor,
  runKimiDoctor,
  runOpenCodeDoctor,
  takeSettingsRecoveryNotice,
  updateAppSettings,
} from "../../../services/tauri";
import {
  CODEX_AUTO_COMPACTION_THRESHOLD_DEFAULT_PERCENT,
  normalizeCodexAutoCompactionThresholdPercent,
} from "../../codex/constants/codexAutoCompactionThreshold";
import {
  clampUiScale,
  sanitizeUiScale,
  UI_SCALE_DEFAULT,
} from "../../../utils/uiScale";
import {
  DEFAULT_CODE_FONT_FAMILY,
  DEFAULT_UI_FONT_FAMILY,
  CODE_FONT_SIZE_DEFAULT,
  clampCodeFontSize,
  normalizeCodeFontFamily,
  normalizeUiFontFamily,
} from "../../../utils/fonts";
import {
  DEFAULT_OPEN_APP_ID,
  DEFAULT_OPEN_APP_TARGETS,
} from "../../app/constants";
import { getClientStoreSync } from "../../../services/clientStorage";
import { normalizeComposerEnginePrefsRecord } from "../../../app-shell-parts/composerEnginePrefs";
import { getComposerEnginePrefsSnapshot } from "../../composer/hooks/composerEnginePrefsStore";
import { normalizeOpenAppTargets } from "../../app/utils/openApp";
import { getDefaultInterruptShortcut } from "../../../utils/shortcuts";
import { normalizeHexColor } from "../../../utils/colorUtils";
import {
  sanitizeDarkThemePresetId,
  sanitizeLightThemePresetId,
  sanitizeThemePresetId,
} from "../../theme/utils/themePreset";
import {
  applyDockIconPreference,
  DEFAULT_DOCK_ICON_ID,
  sanitizeDockIconId,
} from "../../theme/utils/dockIcon";
import { traceStartupCommand } from "../../startup-orchestration/utils/startupTrace";

const allowedThemes = new Set(["system", "light", "dark", "dim", "custom"]);
const allowedCanvasWidthModes = new Set(["narrow", "wide"]);
const allowedLayoutModes = new Set(["default", "swapped"]);
const allowedComposerSendShortcuts = new Set(["enter", "cmdEnter"]);
const SEARCH_SHORTCUT_DISALLOWED = new Set(["cmd+p", "ctrl+p"]);
const ALLOWED_NOTIFICATION_SOUND_IDS = new Set([
  "default",
  "chime",
  "bell",
  "ding",
  "success",
  "custom",
]);
const allowedEmailSenderProviders = new Set(["126", "163", "qq", "custom"]);
const allowedEmailSenderSecurity = new Set(["ssl_tls", "start_tls", "none"]);
const DEFAULT_ENABLED_CURATED_SKILL_IDS = ["lazy-senior-dev", "caveman"];
const DEFAULT_DISABLED_CLI_ENGINES = ["grok", "kimi", "opencode"];

function defaultEnabledCuratedSkillIds(): string[] {
  return [...DEFAULT_ENABLED_CURATED_SKILL_IDS];
}

function readLegacyUserMsgColor(): string {
  if (typeof window === "undefined") {
    return "";
  }
  try {
    const stored = window.localStorage.getItem("userMsgColor");
    return normalizeHexColor(stored);
  } catch {
    return "";
  }
}

function normalizeShortcutValue(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "");
  return normalized || null;
}

function normalizeGlobalSearchShortcut(
  value: string | null | undefined,
): string | null {
  if (value === null) {
    return null;
  }
  const normalized = normalizeShortcutValue(value);
  if (!normalized || SEARCH_SHORTCUT_DISALLOWED.has(normalized)) {
    return "cmd+o";
  }
  return normalized;
}

function normalizeNewWorktreeShortcut(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeShortcutValue(value);
  if (normalized === "cmd+shift+n" || normalized === "ctrl+shift+n") {
    return "cmd+alt+shift+n";
  }
  return normalized;
}

function normalizeWebServicePort(value: number | null | undefined): number {
  if (!Number.isFinite(value)) {
    return 3080;
  }
  const normalized = Math.round(value as number);
  if (normalized < 1024 || normalized > 65535) {
    return 3080;
  }
  return normalized;
}

function normalizeWebServiceToken(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

function normalizeCustomSkillDirectories(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const directories: string[] = [];
  for (const item of value) {
    const normalized = String(item ?? "").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    directories.push(normalized);
  }
  return directories;
}

function normalizeEnabledCuratedSkillIds(value: unknown): string[] {
  if (value === undefined) {
    return defaultEnabledCuratedSkillIds();
  }
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const normalized = item.trim();
    if (
      !normalized ||
      normalized.startsWith("-") ||
      normalized.endsWith("-") ||
      !/^[a-z0-9-]+$/.test(normalized) ||
      seen.has(normalized)
    ) {
      continue;
    }
    seen.add(normalized);
    ids.push(normalized);
  }
  return ids;
}

function normalizeEnabledBuiltInAgentIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => /^agency-agents:[a-z0-9-]+\/[a-z0-9-]+$/.test(item)),
    ),
  ).sort();
}

function normalizeDisabledCliEngines(value: unknown): string[] {
  if (value === undefined) {
    return [...DEFAULT_DISABLED_CLI_ENGINES];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    ids.push(normalized);
  }
  return ids;
}

const defaultSettings: AppSettings = {
  claudeBin: null,
  kimiBin: null,
  grokBin: null,
  opencodeBin: null,
  codexBin: null,
  codexArgs: null,
  terminalShellPath: null,
  disabledCliEngines: [...DEFAULT_DISABLED_CLI_ENGINES],
  sessionAttributionMode: "related",
  backendMode: "local",
  remoteBackendHost: "127.0.0.1:4732",
  remoteBackendToken: null,
  webServicePort: 3080,
  webServiceToken: null,
  systemProxyEnabled: false,
  systemProxyUrl: null,
  defaultAccessMode: "full-access",
  composerModelShortcut: "cmd+shift+m",
  composerAccessShortcut: "cmd+shift+a",
  composerReasoningShortcut: "cmd+shift+r",
  composerCollaborationShortcut: "shift+tab",
  interruptShortcut: getDefaultInterruptShortcut(),
  openSettingsShortcut: "cmd+,",
  newWindowShortcut: "cmd+shift+n",
  newAgentShortcut: "cmd+n",
  newWorktreeAgentShortcut: "cmd+alt+shift+n",
  newCloneAgentShortcut: "cmd+alt+n",
  archiveThreadShortcut: "cmd+ctrl+a",
  closeCurrentSessionShortcut: "cmd+w",
  openChatShortcut: "cmd+j",
  openKanbanShortcut: "cmd+k",
  cycleOpenSessionPrevShortcut: "cmd+shift+[",
  cycleOpenSessionNextShortcut: "cmd+shift+]",
  toggleLeftConversationSidebarShortcut: "cmd+alt+[",
  toggleRightConversationSidebarShortcut: "cmd+alt+]",
  toggleProjectsSidebarShortcut: "cmd+shift+p",
  toggleGitSidebarShortcut: "cmd+shift+g",
  toggleGlobalSearchShortcut: "cmd+o",
  toggleDebugPanelShortcut: "cmd+shift+d",
  toggleTerminalShortcut: "cmd+shift+t",
  toggleRuntimeConsoleShortcut: "cmd+shift+`",
  toggleFilesSurfaceShortcut: "cmd+shift+e",
  saveFileShortcut: "cmd+s",
  findInFileShortcut: "cmd+f",
  expandSelectionShortcut: "cmd+w",
  toggleGitDiffListViewShortcut: "alt+shift+v",
  toggleGitGraphShortcut: null,
  openNotesShortcut: null,
  openIntentCanvasShortcut: null,
  openRadarShortcut: null,
  openProjectMapShortcut: null,
  openBrowserDockShortcut: null,
  openFileCompareShortcut: null,
  increaseUiScaleShortcut: "cmd+=",
  decreaseUiScaleShortcut: "cmd+-",
  resetUiScaleShortcut: "cmd+0",
  cycleAgentNextShortcut: "cmd+ctrl+down",
  cycleAgentPrevShortcut: "cmd+ctrl+up",
  cycleWorkspaceNextShortcut: "cmd+shift+down",
  cycleWorkspacePrevShortcut: "cmd+shift+up",
  lastComposerModelId: null,
  lastComposerReasoningEffort: null,
  lastComposerPrefsByEngine: {},
  uiScale: UI_SCALE_DEFAULT,
  theme: "system",
  dockIconId: DEFAULT_DOCK_ICON_ID,
  lightThemePresetId: "vscode-light-modern",
  darkThemePresetId: "vscode-dark-modern",
  customThemePresetId: "vscode-dark-modern",
  customSkillDirectories: [],
  enabledCuratedSkillIds: defaultEnabledCuratedSkillIds(),
  curatedSkillDefaultsVersion: 1,
  enabledBuiltInAgentIds: [],
  canvasWidthMode: "narrow",
  layoutMode: "default",
  userMsgColor: "",
  usageShowRemaining: false,
  showMessageAnchors: true,
  showSidebarProviderLabels: false,
  performanceCompatibilityModeEnabled: false,
  uiFontFamily: DEFAULT_UI_FONT_FAMILY,
  codeFontFamily: DEFAULT_CODE_FONT_FAMILY,
  codeFontSize: CODE_FONT_SIZE_DEFAULT,
  notificationSoundsEnabled: true,
  notificationSoundId: "default",
  notificationSoundCustomPath: "",
  systemNotificationEnabled: true,
  emailSender: {
    enabled: false,
    provider: "custom",
    senderEmail: "",
    senderName: "",
    smtpHost: "",
    smtpPort: 465,
    security: "ssl_tls",
    username: "",
    recipientEmail: "",
  },
  emailInbound: {
    enabled: false,
    provider: "custom",
    imapHost: "",
    imapPort: 993,
    security: "ssl_tls",
    username: "",
    mailboxFolder: "INBOX",
    allowedSenders: [],
    pollIntervalSeconds: 300,
    readOnlyMode: true,
    actionWindowHours: 24,
    debugStorageEnabled: false,
  },
  preloadGitDiffs: true,
  detachedExternalChangeAwarenessEnabled: true,
  detachedExternalChangeWatcherEnabled: true,
  experimentalCollabEnabled: false,
  experimentalCollaborationModesEnabled: true,
  codexModeEnforcementEnabled: true,
  experimentalSteerEnabled: false,
  codexUnifiedExecPolicy: "inherit",
  chatCanvasUseNormalizedRealtime: true,
  chatCanvasUseUnifiedHistoryLoader: true,
  chatCanvasUsePresentationProfile: false,
  dictationEnabled: false,
  dictationModelId: "base",
  dictationPreferredLanguage: null,
  dictationHoldKey: "alt",
  composerEditorPreset: "default",
  composerSendShortcut: "enter",
  composerFenceExpandOnSpace: false,
  composerFenceExpandOnEnter: false,
  composerFenceLanguageTags: false,
  composerFenceWrapSelection: false,
  composerFenceAutoWrapPasteMultiline: false,
  composerFenceAutoWrapPasteCodeLike: false,
  composerListContinuation: false,
  composerCodeBlockCopyUseModifier: true,
  workspaceGroups: [],
  openAppTargets: DEFAULT_OPEN_APP_TARGETS,
  selectedOpenAppId: DEFAULT_OPEN_APP_ID,
  runtimeRestoreThreadsOnlyOnLaunch: true,
  runtimeForceCleanupOnExit: true,
  runtimeOrphanSweepOnLaunch: true,
  codexMaxHotRuntimes: 1,
  codexMaxWarmRuntimes: 1,
  codexWarmTtlSeconds: 7200,
  codexAutoCompactionEnabled: true,
  codexAutoCompactionThresholdPercent:
    CODEX_AUTO_COMPACTION_THRESHOLD_DEFAULT_PERCENT,
  browserAgentEnabled: true,
  browserAgentPreferBuiltIn: true,
  browserAgentAllowExternalProviderFallback: true,
};

const CODEX_WARM_TTL_DEFAULT_SECONDS = 7200;

function normalizeAppSettings(
  settings: AppSettings,
  options?: {
    allowLegacyUserMsgColorFallback?: boolean;
    fallbackUiScaleToDefault?: boolean;
    upgradeWarmTtlToDefaultOnLoad?: boolean;
  },
): AppSettings {
  const normalizedUserMsgColor = normalizeHexColor(settings.userMsgColor);
  const fallbackUserMsgColor =
    options?.allowLegacyUserMsgColorFallback && !normalizedUserMsgColor
      ? readLegacyUserMsgColor()
      : normalizedUserMsgColor;
  const normalizedTargets =
    settings.openAppTargets && settings.openAppTargets.length
      ? normalizeOpenAppTargets(settings.openAppTargets)
      : DEFAULT_OPEN_APP_TARGETS;
  const storedOpenAppId =
    getClientStoreSync<string>("app", "openWorkspaceApp") ?? null;
  const hasPersistedSelection = normalizedTargets.some(
    (target) => target.id === settings.selectedOpenAppId,
  );
  const hasStoredSelection =
    !hasPersistedSelection &&
    storedOpenAppId !== null &&
    normalizedTargets.some((target) => target.id === storedOpenAppId);
  const selectedOpenAppId = hasPersistedSelection
    ? settings.selectedOpenAppId
    : hasStoredSelection
      ? storedOpenAppId
      : (normalizedTargets[0]?.id ?? DEFAULT_OPEN_APP_ID);
  const inboundSettings = settings.emailInbound;
  return {
    ...settings,
    experimentalCollabEnabled: false,
    codexUnifiedExecPolicy: "inherit",
    experimentalUnifiedExecEnabled: undefined,
    claudeBin: settings.claudeBin?.trim() ? settings.claudeBin.trim() : null,
    kimiBin: settings.kimiBin?.trim() ? settings.kimiBin.trim() : null,
    grokBin: settings.grokBin?.trim() ? settings.grokBin.trim() : null,
    opencodeBin: settings.opencodeBin?.trim()
      ? settings.opencodeBin.trim()
      : null,
    codexBin: settings.codexBin?.trim() ? settings.codexBin.trim() : null,
    codexArgs: settings.codexArgs?.trim() ? settings.codexArgs.trim() : null,
    terminalShellPath: settings.terminalShellPath?.trim()
      ? settings.terminalShellPath.trim()
      : null,
    disabledCliEngines: normalizeDisabledCliEngines(
      settings.disabledCliEngines,
    ),
    sessionAttributionMode:
      settings.sessionAttributionMode === "workspace-only"
        ? "workspace-only"
        : "related",
    webServicePort: normalizeWebServicePort(settings.webServicePort),
    webServiceToken: normalizeWebServiceToken(settings.webServiceToken),
    systemProxyUrl: settings.systemProxyUrl?.trim()
      ? settings.systemProxyUrl.trim()
      : null,
    uiScale: options?.fallbackUiScaleToDefault
      ? sanitizeUiScale(settings.uiScale)
      : clampUiScale(settings.uiScale),
    theme: allowedThemes.has(settings.theme) ? settings.theme : "system",
    dockIconId: sanitizeDockIconId(settings.dockIconId),
    lightThemePresetId: sanitizeLightThemePresetId(settings.lightThemePresetId),
    darkThemePresetId: sanitizeDarkThemePresetId(settings.darkThemePresetId),
    customThemePresetId: sanitizeThemePresetId(settings.customThemePresetId),
    customSkillDirectories: normalizeCustomSkillDirectories(
      settings.customSkillDirectories,
    ),
    enabledCuratedSkillIds: normalizeEnabledCuratedSkillIds(
      settings.enabledCuratedSkillIds,
    ),
    enabledBuiltInAgentIds: normalizeEnabledBuiltInAgentIds(
      settings.enabledBuiltInAgentIds,
    ),
    canvasWidthMode: allowedCanvasWidthModes.has(settings.canvasWidthMode)
      ? settings.canvasWidthMode
      : "narrow",
    layoutMode: allowedLayoutModes.has(settings.layoutMode ?? "default")
      ? (settings.layoutMode ?? "default")
      : "default",
    userMsgColor: fallbackUserMsgColor,
    performanceCompatibilityModeEnabled:
      settings.performanceCompatibilityModeEnabled === true,
    uiFontFamily: normalizeUiFontFamily(settings.uiFontFamily),
    codeFontFamily: normalizeCodeFontFamily(settings.codeFontFamily),
    runtimeRestoreThreadsOnlyOnLaunch:
      settings.runtimeRestoreThreadsOnlyOnLaunch !== false,
    runtimeForceCleanupOnExit: settings.runtimeForceCleanupOnExit !== false,
    runtimeOrphanSweepOnLaunch: settings.runtimeOrphanSweepOnLaunch !== false,
    codexMaxHotRuntimes: Number.isFinite(settings.codexMaxHotRuntimes)
      ? Math.max(0, Math.min(8, Math.trunc(settings.codexMaxHotRuntimes)))
      : 1,
    codexMaxWarmRuntimes: Number.isFinite(settings.codexMaxWarmRuntimes)
      ? Math.max(0, Math.min(16, Math.trunc(settings.codexMaxWarmRuntimes)))
      : 1,
    codexWarmTtlSeconds: (() => {
      const normalized = Number.isFinite(settings.codexWarmTtlSeconds)
        ? Math.max(
            15,
            Math.min(14400, Math.trunc(settings.codexWarmTtlSeconds)),
          )
        : CODEX_WARM_TTL_DEFAULT_SECONDS;
      return options?.upgradeWarmTtlToDefaultOnLoad
        ? Math.max(CODEX_WARM_TTL_DEFAULT_SECONDS, normalized)
        : normalized;
    })(),
    codexAutoCompactionThresholdPercent:
      normalizeCodexAutoCompactionThresholdPercent(
        settings.codexAutoCompactionThresholdPercent,
      ),
    codexAutoCompactionEnabled: settings.codexAutoCompactionEnabled !== false,
    browserAgentEnabled: settings.browserAgentEnabled !== false,
    browserAgentPreferBuiltIn: settings.browserAgentPreferBuiltIn !== false,
    browserAgentAllowExternalProviderFallback:
      settings.browserAgentAllowExternalProviderFallback !== false,
    codeFontSize: clampCodeFontSize(settings.codeFontSize),
    notificationSoundId: ALLOWED_NOTIFICATION_SOUND_IDS.has(
      settings.notificationSoundId,
    )
      ? settings.notificationSoundId
      : "default",
    notificationSoundCustomPath:
      settings.notificationSoundCustomPath?.trim() ?? "",
    emailSender: {
      enabled: settings.emailSender?.enabled === true,
      provider: allowedEmailSenderProviders.has(settings.emailSender?.provider)
        ? settings.emailSender.provider
        : "custom",
      senderEmail: settings.emailSender?.senderEmail?.trim() ?? "",
      senderName: settings.emailSender?.senderName?.trim() ?? "",
      smtpHost: settings.emailSender?.smtpHost?.trim() ?? "",
      smtpPort: Number.isFinite(settings.emailSender?.smtpPort)
        ? Math.max(
            1,
            Math.min(65535, Math.trunc(settings.emailSender.smtpPort)),
          )
        : 465,
      security: allowedEmailSenderSecurity.has(settings.emailSender?.security)
        ? settings.emailSender.security
        : "ssl_tls",
      username: settings.emailSender?.username?.trim() ?? "",
      recipientEmail: settings.emailSender?.recipientEmail?.trim() ?? "",
    },
    emailInbound: {
      enabled: inboundSettings?.enabled === true,
      provider:
        inboundSettings?.provider &&
        allowedEmailSenderProviders.has(inboundSettings.provider)
          ? inboundSettings.provider
          : "custom",
      imapHost: inboundSettings?.imapHost?.trim() ?? "",
      imapPort: Number.isFinite(inboundSettings?.imapPort)
        ? Math.max(
            1,
            Math.min(65535, Math.trunc(inboundSettings?.imapPort ?? 993)),
          )
        : 993,
      security:
        inboundSettings?.security &&
        allowedEmailSenderSecurity.has(inboundSettings.security)
          ? inboundSettings.security
          : "ssl_tls",
      username: inboundSettings?.username?.trim() ?? "",
      mailboxFolder: inboundSettings?.mailboxFolder?.trim() || "INBOX",
      allowedSenders: Array.isArray(inboundSettings?.allowedSenders)
        ? inboundSettings.allowedSenders
            .map((sender) => sender.trim())
            .filter(Boolean)
        : [],
      pollIntervalSeconds: Number.isFinite(inboundSettings?.pollIntervalSeconds)
        ? Math.max(
            10,
            Math.min(
              3600,
              Math.trunc(inboundSettings?.pollIntervalSeconds ?? 300),
            ),
          )
        : 300,
      readOnlyMode: true,
      actionWindowHours: Number.isFinite(inboundSettings?.actionWindowHours)
        ? Math.max(
            1,
            Math.min(168, Math.trunc(inboundSettings?.actionWindowHours ?? 24)),
          )
        : 24,
      debugStorageEnabled: inboundSettings?.debugStorageEnabled === true,
    },
    detachedExternalChangeAwarenessEnabled:
      settings.detachedExternalChangeAwarenessEnabled !== false,
    detachedExternalChangeWatcherEnabled:
      settings.detachedExternalChangeWatcherEnabled !== false,
    showSidebarProviderLabels: settings.showSidebarProviderLabels === true,
    codexModeEnforcementEnabled: settings.codexModeEnforcementEnabled !== false,
    // Conversation curtain convergence now depends on the normalized realtime adapters.
    // Keep it enabled even for older persisted settings that still store false.
    chatCanvasUseNormalizedRealtime: true,
    // Session activity history recovery now depends on the unified history loader.
    // Keep it enabled even for older persisted settings that still store false.
    chatCanvasUseUnifiedHistoryLoader: true,
    composerSendShortcut: allowedComposerSendShortcuts.has(
      settings.composerSendShortcut,
    )
      ? settings.composerSendShortcut
      : "enter",
    newWorktreeAgentShortcut: normalizeNewWorktreeShortcut(
      settings.newWorktreeAgentShortcut,
    ),
    toggleGlobalSearchShortcut: normalizeGlobalSearchShortcut(
      settings.toggleGlobalSearchShortcut,
    ),
    openAppTargets: normalizedTargets,
    selectedOpenAppId,
    lastComposerPrefsByEngine: normalizeComposerEnginePrefsRecord(
      settings.lastComposerPrefsByEngine,
      {
        modelId: settings.lastComposerModelId,
        effort: settings.lastComposerReasoningEffort,
      },
    ),
  };
}

// Value equality for the post-save round-trip guard. Both operands are produced by
// normalizeAppSettings (stable key order), so a structural JSON compare is reliable here;
// a false negative would only cost one extra render, never correctness.
function areAppSettingsEqual(a: AppSettings, b: AppSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function useAppSettings() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [isLoading, setIsLoading] = useState(true);
  const initialSettingsRequestRef = useRef<Promise<AppSettings> | null>(null);
  const recoveryNoticeRequestRef = useRef<ReturnType<
    typeof takeSettingsRecoveryNotice
  > | null>(null);

  useEffect(() => {
    let active = true;
    const request = (initialSettingsRequestRef.current ??= traceStartupCommand(
      "get_app_settings",
      "global",
      getAppSettings,
    ));
    void request
      .then((response) => {
        if (!active) {
          return;
        }
        const allowLegacyUserMsgColorFallback =
          (response as Partial<AppSettings>).userMsgColor == null;
        const normalized = normalizeAppSettings(
          {
            ...defaultSettings,
            ...response,
          },
          {
            allowLegacyUserMsgColorFallback,
            fallbackUiScaleToDefault: true,
            upgradeWarmTtlToDefaultOnLoad: true,
          },
        );
        setSettings(normalized);
        // The bundled default icon is already installed by native window creation.
        // Only a persisted custom choice needs a cold-start replay.
        if (
          sanitizeDockIconId(normalized.dockIconId) !== DEFAULT_DOCK_ICON_ID
        ) {
          void applyDockIconPreference(normalized.dockIconId).catch((error) => {
            console.error("[useAppSettings] failed to apply dock icon", error);
          });
        }

        // Recovery notice is secondary startup work. Start it without awaiting,
        // so it cannot extend isLoading; the ref also deduplicates StrictMode replay.
        const noticeRequest = (recoveryNoticeRequestRef.current ??=
          takeSettingsRecoveryNotice());
        void noticeRequest
          .then((notice) => {
            if (!active || !notice) {
              return;
            }
            pushErrorToast({
              title:
                i18n.t("settings.settingsRecoveredTitle", {
                  defaultValue: "设置已恢复",
                }) || "设置已恢复",
              message: notice.backupFileName
                ? i18n.t("settings.settingsRecoveredMessage", {
                    backupFileName: notice.backupFileName,
                    defaultValue:
                      "设置文件已损坏，原文件已备份为 {{backupFileName}}，已回退到默认设置。",
                  }) ||
                  `设置文件已损坏，原文件已备份为 ${notice.backupFileName}，已回退到默认设置。`
                : i18n.t("settings.settingsRecoveredNoBackupMessage", {
                    defaultValue:
                      "设置文件已损坏且自动备份失败，已回退到默认设置。",
                  }) || "设置文件已损坏且自动备份失败，已回退到默认设置。",
            });
          })
          .catch((noticeError) => {
            if (!active) {
              return;
            }
            console.error(
              "[useAppSettings] failed to fetch settings recovery notice",
              noticeError,
            );
          });
      })
      .catch((error) => {
        if (!active) {
          return;
        }
        // Defaults stay in place if loading settings fails, but the failure must be
        // visible: a corrupted settings file silently resets user preferences otherwise.
        console.error(
          "[useAppSettings] failed to load app settings; falling back to defaults",
          error,
        );
        pushErrorToast({
          title:
            i18n.t("settings.appSettingsLoadFailedTitle", {
              defaultValue: "设置加载失败",
            }) || "设置加载失败",
          message:
            i18n.t("settings.appSettingsLoadFailedMessage", {
              defaultValue:
                "无法从后端读取应用设置，已临时使用默认设置。请检查客户端与后端的连接状态。",
            }) ||
            "无法从后端读取应用设置，已临时使用默认设置。请检查客户端与后端的连接状态。",
        });
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const saveSettings = useCallback(
    async (next: AppSettings) => {
      // Composer per-engine prefs live in an external store (composerEnginePrefsStore) so a
      // switch-button click never re-renders the app-shell root. The backend replaces the
      // whole settings file, so overlay the live snapshot here to keep an unrelated settings
      // save from clobbering newer prefs on disk. Skip the overlay before the store is seeded
      // (empty snapshot) to avoid wiping loaded prefs.
      const snapshot = getComposerEnginePrefsSnapshot();
      const hasSnapshot = Object.keys(snapshot).length > 0;
      const previousDockIconId = sanitizeDockIconId(settings.dockIconId);
      const normalized = normalizeAppSettings(
        hasSnapshot ? { ...next, lastComposerPrefsByEngine: snapshot } : next,
      );
      const saved = await updateAppSettings(normalized);
      const nextSettings = normalizeAppSettings({
        ...defaultSettings,
        ...saved,
      });
      // Avoid the whole-tree re-render when the round-trip echoed back an identical value.
      setSettings((current) =>
        areAppSettingsEqual(current, nextSettings) ? current : nextSettings,
      );
      if (sanitizeDockIconId(nextSettings.dockIconId) !== previousDockIconId) {
        void applyDockIconPreference(nextSettings.dockIconId).catch((error) => {
          console.error("[useAppSettings] failed to apply dock icon", error);
        });
      }
      return saved;
    },
    [settings.dockIconId],
  );

  const doctor = useCallback(
    async (codexBin: string | null, codexArgs: string | null) => {
      return runCodexDoctor(codexBin, codexArgs);
    },
    [],
  );

  const claudeDoctor = useCallback(async (claudeBin: string | null) => {
    return runClaudeDoctor(claudeBin);
  }, []);

  const kimiDoctor = useCallback(async (kimiBin: string | null) => {
    return runKimiDoctor(kimiBin);
  }, []);

  const grokDoctor = useCallback(async (grokBin: string | null) => {
    return runGrokDoctor(grokBin);
  }, []);

  const opencodeDoctor = useCallback(async (opencodeBin: string | null) => {
    return runOpenCodeDoctor(opencodeBin);
  }, []);

  return {
    settings,
    setSettings,
    saveSettings,
    doctor,
    claudeDoctor,
    kimiDoctor,
    grokDoctor,
    opencodeDoctor,
    isLoading,
  };
}
