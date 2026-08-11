import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left";
import ArrowLeftRight from "lucide-react/dist/esm/icons/arrow-left-right";
import BookOpen from "lucide-react/dist/esm/icons/book-open";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import File from "lucide-react/dist/esm/icons/file";
import Import from "lucide-react/dist/esm/icons/import";
import Search from "lucide-react/dist/esm/icons/search";
import Settings2 from "lucide-react/dist/esm/icons/settings-2";
import type { CodexCustomModel, CodexProviderConfig, VendorTab } from "../types";
import {
  DISABLED_PROVIDER_ID,
  LOCAL_GROK_PROVIDER_ID,
  LOCAL_KIMI_PROVIDER_ID,
  LOCAL_OPENCODE_PROVIDER_ID,
  LOCAL_SETTINGS_PROVIDER_ID,
  STORAGE_KEYS,
  validateCodexCustomModels,
} from "../types";
import {
  buildManagedProviderOptions,
  resolveDefaultProviderOptionId,
} from "../customModelProviderBinding";
import {
  persistClaudeCustomModelCatalog,
  persistCodexCustomModelCatalog,
} from "../persistCustomModelCatalog";
import type { AppSettings, CodexUnifiedExecExternalStatus } from "../../../types";
import { notifyProviderTargetCatalogChanged } from "../../composer/components/ChatInputBox/hooks/useProviderTargetCatalogOwners";
import { useProviderManagement } from "../hooks/useProviderManagement";
import { useCodexProviderManagement } from "../hooks/useCodexProviderManagement";
import { useKimiProviderManagement } from "../hooks/useKimiProviderManagement";
import { useGrokProviderManagement } from "../hooks/useGrokProviderManagement";
import { useOpenCodeProviderManagement } from "../hooks/useOpenCodeProviderManagement";
import { usePluginModels } from "../hooks/usePluginModels";
import { ProviderList } from "./ProviderList";
import { ClaudeLocalSettingsCard } from "./ClaudeLocalSettingsCard";
import { CodexProviderList } from "./CodexProviderList";
import { KimiProviderList } from "./KimiProviderList";
import { GrokProviderList } from "./GrokProviderList";
import { OpenCodeProviderList } from "./OpenCodeProviderList";
import { ClaudeSettingsJsonDialog } from "./ClaudeSettingsJsonDialog";
import { ProviderDialog } from "./ProviderDialog";
import { CodexProviderDialog } from "./CodexProviderDialog";
import { KimiProviderDialog } from "./KimiProviderDialog";
import { GrokProviderDialog } from "./GrokProviderDialog";
import { OpenCodeProviderDialog } from "./OpenCodeProviderDialog";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";
import { CustomModelDialog } from "./CustomModelDialog";
import {
  CliCustomPathDialog,
  CliCustomPathEntry,
  type CliCustomPathEngine,
  type CliCustomPathSavePayload,
} from "./CliCustomPathDialog";
import { CcSwitchImportDialog } from "./CcSwitchImportDialog";
import { type CcSwitchImportTarget } from "../hooks/useCcSwitchImport";
import { CurrentCodexGlobalConfigCard } from "./CurrentCodexGlobalConfigCard";
import { LocalOfficialConfigCard } from "./LocalOfficialConfigCard";
import { LocalOfficialConfigEditDialog } from "./LocalOfficialConfigEditDialog";
import {
  CLI_DOCS_HREF_BY_ID,
  buildCliEngineNavItems,
  CliEngineNavGroupSection,
  CliEngineNavRow,
  CliIcon,
  groupCliEngineNavItems,
  type CliEngineId,
  type CliEngineNavGroupKey,
  type CliEngineNavItem,
} from "./cliEngineNav";
import {
  CliLifecycleHeaderActions,
  CliLifecycleInstallerPanel,
  CliLifecycleProvider,
} from "./CliLifecycleHeaderActions";
import {
  consumeVendorModelManagerRequest,
  VENDOR_MODEL_MANAGER_REQUEST_EVENT,
} from "../modelManagerRequest";
import {
  getCodexUnifiedExecExternalStatus,
  readGlobalCodexAuthJson,
  readGlobalCodexConfigToml,
  readGrokConfigToml,
  readKimiConfigToml,
  readOpenCodeConfigJson,
  restoreCodexUnifiedExecOfficialDefault,
  saveGrokConfigToml,
  saveKimiConfigToml,
  saveOpenCodeConfigJson,
  setCodexUnifiedExecOfficialOverride,
} from "../../../services/tauri";
import { pushErrorToast } from "../../../services/toasts";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { SettingsRowHelp } from "./SettingsRowHelp";

const CODEX_PLUGIN_MODELS_MIGRATION_MARKER =
  "codemoss-codex-plugin-models-migrated-v1";
type ModelDialogTarget = "claude" | "codex";
type InlineNoticeState =
  | { kind: "success" | "error"; message: string }
  | null;

type VendorSettingsPanelProps = {
  appSettings: AppSettings;
  codexReloadStatus: "idle" | "reloading" | "applied" | "failed";
  codexReloadMessage: string | null;
  handleReloadCodexRuntimeConfig: () => Promise<void>;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
};

/** Managed third-party rows only — local/official slots are not counted. */
function isManagedThirdPartyProviderActive(
  provider: {
    id: string;
    isActive?: boolean;
    isLocalProvider?: boolean;
  },
  localProviderId: string,
): boolean {
  return (
    Boolean(provider.isActive) &&
    provider.id !== localProviderId &&
    !provider.isLocalProvider
  );
}

type CliBrandHeaderProps = {
  id: CliEngineId;
  title: string;
  description: string;
  helpLabel: string;
  href?: string;
  actions?: ReactNode;
  monochromeLogo?: boolean;
};

function CliBrandDocsLabel({ label }: { label: string }) {
  return (
    <>
      <BookOpen className="vendor-brand-help-icon" aria-hidden="true" />
      <span>{label}</span>
    </>
  );
}

function CliBrandHeader({
  id,
  title,
  description,
  helpLabel,
  href,
  actions,
  monochromeLogo = false,
}: CliBrandHeaderProps) {
  return (
    <div className="vendor-brand-header">
      <div className="vendor-brand-main">
        <span className="vendor-brand-logo" aria-hidden="true">
          <CliIcon id={id} label={title} monochrome={monochromeLogo} />
        </span>
        <div className="vendor-brand-copy">
          <div className="vendor-brand-title-row">
            <h2 className="vendor-brand-title">{title}</h2>
            {href ? (
              <a
                className="vendor-brand-help"
                href={href}
                target="_blank"
                rel="noreferrer"
                title={description}
                aria-label={helpLabel}
                onClick={(event) => {
                  event.preventDefault();
                  void openUrl(href);
                }}
              >
                <CliBrandDocsLabel label={helpLabel} />
              </a>
            ) : (
              <span
                className="vendor-brand-help"
                title={description}
                aria-label={helpLabel}
              >
                <CliBrandDocsLabel label={helpLabel} />
              </span>
            )}
          </div>
        </div>
      </div>
      {actions ? <div className="vendor-brand-actions">{actions}</div> : null}
    </div>
  );
}

/** Section block for engine settings / provider channels hierarchy. */
function VendorSettingsSection({
  label,
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  return (
    <section className="vendor-settings-section">
      {label ? (
        <h3 className="vendor-settings-section-label">
          <Settings2
            className="vendor-section-label-icon"
            size={15}
            strokeWidth={2}
            aria-hidden
          />
          {label}
        </h3>
      ) : null}
      {children}
    </section>
  );
}

function collectProviderCustomModels(
  providers: CodexProviderConfig[],
): CodexCustomModel[] {
  const merged: CodexCustomModel[] = [];
  const seenIds = new Set<string>();

  for (const provider of providers) {
    const models = validateCodexCustomModels(provider.customModels ?? []);
    for (const model of models) {
      const id = model.id.trim();
      if (!id || seenIds.has(id)) {
        continue;
      }
      seenIds.add(id);
      const label = model.label?.trim() || id;
      const description = model.description?.trim();
      merged.push({
        id,
        label,
        description: description && description.length > 0 ? description : undefined,
      });
    }
  }

  return merged;
}

export function VendorSettingsPanel({
  appSettings,
  codexReloadStatus,
  codexReloadMessage,
  handleReloadCodexRuntimeConfig,
  onUpdateAppSettings,
}: VendorSettingsPanelProps) {
  const { t } = useTranslation();
  const [activeCli, setActiveCli] = useState<CliEngineId>("claude");
  /** Narrow layout: list-only vs detail-only master–detail (ignored above 900px). */
  const [mobilePane, setMobilePane] = useState<"list" | "detail">("list");
  const [cliSearchQuery, setCliSearchQuery] = useState("");
  const [collapsedCliGroups, setCollapsedCliGroups] = useState<
    Record<CliEngineNavGroupKey, boolean>
  >({
    enabled: false,
    disabled: true,
    upcoming: true,
  });
  const [dialogTarget, setDialogTarget] = useState<ModelDialogTarget>("claude");
  /** Which local/official config editor is open (kimi | grok | opencode). */
  const [localOfficialEditEngine, setLocalOfficialEditEngine] = useState<
    "kimi" | "grok" | "opencode" | null
  >(null);
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const [modelDialogAddMode, setModelDialogAddMode] = useState(false);
  const [modelDialogPersistError, setModelDialogPersistError] = useState<
    string | null
  >(null);
  const [customPathDialogEngine, setCustomPathDialogEngine] =
    useState<CliCustomPathEngine | null>(null);
  const [codexGlobalConfigContent, setCodexGlobalConfigContent] = useState("");
  const [codexGlobalConfigExists, setCodexGlobalConfigExists] = useState(false);
  const [codexGlobalConfigTruncated, setCodexGlobalConfigTruncated] = useState(false);
  const [codexGlobalConfigLoading, setCodexGlobalConfigLoading] = useState(false);
  const [codexGlobalConfigError, setCodexGlobalConfigError] = useState<string | null>(null);
  const [codexAuthConfigContent, setCodexAuthConfigContent] = useState("");
  const [codexAuthConfigExists, setCodexAuthConfigExists] = useState(false);
  const [codexAuthConfigTruncated, setCodexAuthConfigTruncated] = useState(false);
  const [codexAuthConfigLoading, setCodexAuthConfigLoading] = useState(false);
  const [codexAuthConfigError, setCodexAuthConfigError] = useState<string | null>(null);
  const [unifiedExecExternalStatus, setUnifiedExecExternalStatus] =
    useState<CodexUnifiedExecExternalStatus | null>(null);
  const [unifiedExecExternalStatusError, setUnifiedExecExternalStatusError] =
    useState<string | null>(null);
  const [unifiedExecExternalStatusLoading, setUnifiedExecExternalStatusLoading] =
    useState(false);
  const [unifiedExecActionBusy, setUnifiedExecActionBusy] = useState(false);
  const [unifiedExecActionNotice, setUnifiedExecActionNotice] =
    useState<InlineNoticeState>(null);
  const didSeedCodexPluginModelsRef = useRef(false);

  const claude = useProviderManagement();
  const codex = useCodexProviderManagement();
  const kimi = useKimiProviderManagement();
  const grok = useGrokProviderManagement();
  const openCode = useOpenCodeProviderManagement();
  const [ccSwitchImportSource, setCcSwitchImportSource] = useState<{
    target: CcSwitchImportTarget;
    sourcePath: string | null;
  } | null>(null);

  // CC Switch 导入按 id 匹配 新增/更新
  const ccSwitchExistingProviderIds = useMemo<string[]>(
    () =>
      ccSwitchImportSource?.target === "codex"
        ? codex.codexProviders.map((provider) => provider.id)
        : claude.providers.map((provider) => provider.id),
    [ccSwitchImportSource?.target, codex.codexProviders, claude.providers],
  );

  const handleCcSwitchImported = useCallback(() => {
    if (ccSwitchImportSource?.target === "claude") {
      void claude.loadProviders().then(() => {
        notifyProviderTargetCatalogChanged();
      });
    } else if (ccSwitchImportSource?.target === "codex") {
      void codex.loadCodexProviders().then(() => {
        notifyProviderTargetCatalogChanged();
      });
    }
  }, [ccSwitchImportSource?.target, claude, codex]);

  const handlePickCcSwitchFile = useCallback(
    async (target: CcSwitchImportTarget) => {
      const selection = await openFileDialog({
        multiple: false,
        directory: false,
        filters: [{ name: "cc-switch", extensions: ["db", "json"] }],
      });
      if (!selection || Array.isArray(selection)) {
        return;
      }
      setCcSwitchImportSource({ target, sourcePath: selection });
    },
    [],
  );

  const renderCcSwitchImportButton = (target: CcSwitchImportTarget) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="xs" variant="outline" className="rounded-[4px]">
          <Import size={14} />
          {t("settings.vendor.ccSwitchImport.entry")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={() => setCcSwitchImportSource({ target, sourcePath: null })}
        >
          <ArrowLeftRight size={14} />
          {t("settings.vendor.importMenu.fromCcSwitchUpdate")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => void handlePickCcSwitchFile(target)}
        >
          <File size={14} />
          {t("settings.vendor.importMenu.fromCcSwitchFile")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const claudeModels = usePluginModels(STORAGE_KEYS.CLAUDE_CUSTOM_MODELS);
  const codexModels = usePluginModels(STORAGE_KEYS.CODEX_CUSTOM_MODELS);
  const codexModelCount = codexModels.models.length;
  const updateCodexModels = codexModels.updateModels;

  const openModelDialog = useCallback((target: ModelDialogTarget, addMode = false) => {
    setDialogTarget(target);
    setModelDialogAddMode(addMode);
    setModelDialogOpen(true);
  }, []);

  const renderPluginModelsEntry = (
    target: ModelDialogTarget,
    count: number,
  ) => (
    <div
      className="vendor-group-row vendor-group-row-clickable vendor-plugin-models-row"
      onClick={() => openModelDialog(target)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          openModelDialog(target);
        }
      }}
    >
      <div className="vendor-group-row-copy">
        <span className="vendor-group-row-title">
          {t("settings.vendor.pluginModels")}
          <span className="settings-help vendor-group-row-title-hint">
            {t("settings.vendor.pluginModelsDesc", {
              defaultValue: "Add custom models for this CLI",
            })}
          </span>
        </span>
      </div>
      <div className="vendor-group-row-trailing">
        {count > 0 ? (
          <span className="vendor-plugin-model-entry-count">{count}</span>
        ) : null}
        <button
          type="button"
          className="vendor-group-row-chevron-btn"
          aria-label={t("settings.vendor.manageModels")}
          onClick={(event) => {
            event.stopPropagation();
            openModelDialog(target);
          }}
        >
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );

  const resolveCustomPathValue = (
    engine: CliCustomPathEngine,
  ): { path: string | null; args: string | null } => {
    switch (engine) {
      case "claude":
        return { path: appSettings.claudeBin ?? null, args: null };
      case "kimi":
        return { path: appSettings.kimiBin ?? null, args: null };
      case "grok":
        return { path: appSettings.grokBin ?? null, args: null };
      case "opencode":
        return { path: appSettings.opencodeBin ?? null, args: null };
      case "codex":
        return {
          path: appSettings.codexBin ?? null,
          args: appSettings.codexArgs ?? null,
        };
    }
  };

  const handleSaveCustomPath = useCallback(
    async (engine: CliCustomPathEngine, payload: CliCustomPathSavePayload) => {
      switch (engine) {
        case "claude":
          await onUpdateAppSettings({
            ...appSettings,
            claudeBin: payload.path,
          });
          break;
        case "kimi":
          await onUpdateAppSettings({
            ...appSettings,
            kimiBin: payload.path,
          });
          break;
        case "grok":
          await onUpdateAppSettings({
            ...appSettings,
            grokBin: payload.path,
          });
          break;
        case "opencode":
          await onUpdateAppSettings({
            ...appSettings,
            opencodeBin: payload.path,
          });
          break;
        case "codex":
          await onUpdateAppSettings({
            ...appSettings,
            codexBin: payload.path,
            codexArgs: payload.args ?? null,
          });
          break;
      }
    },
    [appSettings, onUpdateAppSettings],
  );

  const renderCustomPathEntry = (engine: CliCustomPathEngine) => {
    const { path, args } = resolveCustomPathValue(engine);
    const pathSummary = path?.trim()
      ? path.trim()
      : t("settings.vendor.customPathUsingSystemPath");
    const argsSummary =
      engine === "codex"
        ? args?.trim()
          ? args.trim()
          : t("settings.vendor.customPathNoArgs")
        : null;
    const statusSummary = argsSummary
      ? `${pathSummary} · ${argsSummary}`
      : pathSummary;

    // All CLI engine cards fold path status into the row help popover so the
    // group list stays title + action only.
    return (
      <CliCustomPathEntry
        engine={engine}
        path={path}
        args={args}
        showArgsSummary={engine === "codex"}
        helpContent={
          <div className="vendor-settings-row-help-stack">
            <p>{t("settings.vendor.customPathDescription")}</p>
            <p>{t("settings.vendor.customPathDescriptionHint")}</p>
            <p>{statusSummary}</p>
          </div>
        }
        onConfigure={() => setCustomPathDialogEngine(engine)}
      />
    );
  };

  const closeModelDialog = useCallback(() => {
    setModelDialogOpen(false);
    setModelDialogAddMode(false);
    setModelDialogPersistError(null);
  }, []);

  const loadCodexGlobalConfig = useCallback(async () => {
    setCodexGlobalConfigLoading(true);
    setCodexAuthConfigLoading(true);
    setCodexGlobalConfigError(null);
    setCodexAuthConfigError(null);
    const [configResult, authResult] = await Promise.allSettled([
      readGlobalCodexConfigToml(),
      readGlobalCodexAuthJson(),
    ]);

    if (configResult.status === "fulfilled") {
      setCodexGlobalConfigContent(configResult.value.content);
      setCodexGlobalConfigExists(configResult.value.exists);
      setCodexGlobalConfigTruncated(configResult.value.truncated);
    } else {
      const error = configResult.reason;
      setCodexGlobalConfigError(
        error instanceof Error ? error.message : String(error),
      );
      setCodexGlobalConfigContent("");
      setCodexGlobalConfigExists(false);
      setCodexGlobalConfigTruncated(false);
    }
    setCodexGlobalConfigLoading(false);

    if (authResult.status === "fulfilled") {
      setCodexAuthConfigContent(authResult.value.content);
      setCodexAuthConfigExists(authResult.value.exists);
      setCodexAuthConfigTruncated(authResult.value.truncated);
    } else {
      const error = authResult.reason;
      setCodexAuthConfigError(error instanceof Error ? error.message : String(error));
      setCodexAuthConfigContent("");
      setCodexAuthConfigExists(false);
      setCodexAuthConfigTruncated(false);
    }
    setCodexAuthConfigLoading(false);
  }, []);

  const refreshUnifiedExecExternalStatus = useCallback(async () => {
    setUnifiedExecExternalStatusLoading(true);
    setUnifiedExecExternalStatusError(null);
    try {
      const status = await getCodexUnifiedExecExternalStatus();
      setUnifiedExecExternalStatus(status);
      return status;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setUnifiedExecExternalStatusError(message);
      return null;
    } finally {
      setUnifiedExecExternalStatusLoading(false);
    }
  }, []);

  const refreshUnifiedExecConfigViews = useCallback(async () => {
    await Promise.all([loadCodexGlobalConfig(), refreshUnifiedExecExternalStatus()]);
  }, [loadCodexGlobalConfig, refreshUnifiedExecExternalStatus]);

  const selectCli = useCallback((id: CliEngineId) => {
    setActiveCli(id);
    setMobilePane("detail");
    // Codex detail pulls external status on enter — mark loading immediately so
    // segmented controls do not paint a default "follow official" selection.
    if (id === "codex") {
      setUnifiedExecExternalStatusLoading(true);
    }
  }, []);

  const applyPendingModelManagerRequest = useCallback(() => {
    const request = consumeVendorModelManagerRequest();
    if (!request) {
      return;
    }
    const target: ModelDialogTarget =
      request.target === "codex"
        ? "codex"
        : "claude";
    selectCli(target);
    openModelDialog(target, Boolean(request.addMode));
  }, [openModelDialog, selectCli]);

  useEffect(() => {
    applyPendingModelManagerRequest();
    const handleRequest = () => applyPendingModelManagerRequest();
    window.addEventListener(VENDOR_MODEL_MANAGER_REQUEST_EVENT, handleRequest);
    return () => {
      window.removeEventListener(
        VENDOR_MODEL_MANAGER_REQUEST_EVENT,
        handleRequest,
      );
    };
  }, [applyPendingModelManagerRequest]);

  useEffect(() => {
    void loadCodexGlobalConfig();
  }, [loadCodexGlobalConfig]);

  useEffect(() => {
    if (activeCli !== "codex") {
      return;
    }
    void refreshUnifiedExecExternalStatus();
  }, [activeCli, refreshUnifiedExecExternalStatus]);

  useEffect(() => {
    if (didSeedCodexPluginModelsRef.current) {
      return;
    }
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }
    const alreadyMigrated =
      window.localStorage.getItem(CODEX_PLUGIN_MODELS_MIGRATION_MARKER) === "1";
    if (alreadyMigrated) {
      didSeedCodexPluginModelsRef.current = true;
      return;
    }
    if (codexModelCount > 0) {
      try {
        window.localStorage.setItem(CODEX_PLUGIN_MODELS_MIGRATION_MARKER, "1");
      } catch {
        // ignore marker write errors
      }
      didSeedCodexPluginModelsRef.current = true;
      return;
    }
    if (codex.codexProviders.length === 0) {
      return;
    }

    const fallbackModels = collectProviderCustomModels(codex.codexProviders);
    if (fallbackModels.length === 0) {
      try {
        window.localStorage.setItem(CODEX_PLUGIN_MODELS_MIGRATION_MARKER, "1");
      } catch {
        // ignore marker write errors
      }
      didSeedCodexPluginModelsRef.current = true;
      return;
    }

    updateCodexModels(fallbackModels);
    try {
      window.localStorage.setItem(CODEX_PLUGIN_MODELS_MIGRATION_MARKER, "1");
    } catch {
      // ignore marker write errors
    }
    didSeedCodexPluginModelsRef.current = true;
  }, [codex.codexProviders, codexModelCount, updateCodexModels]);

  useEffect(() => {
    if (!unifiedExecActionNotice) {
      return;
    }
    const timer = window.setTimeout(() => {
      setUnifiedExecActionNotice(null);
    }, 2600);
    return () => window.clearTimeout(timer);
  }, [unifiedExecActionNotice]);

  const runUnifiedExecOfficialAction = useCallback(
    async (
      mutate: () => Promise<CodexUnifiedExecExternalStatus>,
      successMessageKey: string,
    ) => {
      setUnifiedExecActionBusy(true);
      setUnifiedExecActionNotice(null);
      try {
        const status = await mutate();
        setUnifiedExecExternalStatus(status);
        try {
          await handleReloadCodexRuntimeConfig();
          setUnifiedExecActionNotice({
            kind: "success",
            message: t(successMessageKey),
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const reloadFailureMessage = t(
            "settings.backgroundTerminalOfficialWriteReloadFailed",
            { message },
          );
          setUnifiedExecActionNotice({
            kind: "error",
            message: reloadFailureMessage,
          });
          pushErrorToast({
            title: t("common.error"),
            message: reloadFailureMessage,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setUnifiedExecActionNotice({ kind: "error", message });
        pushErrorToast({
          title: t("common.error"),
          message,
        });
      } finally {
        await refreshUnifiedExecConfigViews();
        setUnifiedExecActionBusy(false);
      }
    },
    [handleReloadCodexRuntimeConfig, refreshUnifiedExecConfigViews, t],
  );

  const handleSetUnifiedExecOfficialOverride = useCallback(
    async (enabled: boolean) => {
      await runUnifiedExecOfficialAction(
        () => setCodexUnifiedExecOfficialOverride(enabled),
        enabled
          ? "settings.backgroundTerminalOfficialWriteEnabledSuccess"
          : "settings.backgroundTerminalOfficialWriteDisabledSuccess",
      );
    },
    [runUnifiedExecOfficialAction],
  );

  const handleRestoreUnifiedExecOfficialDefault = useCallback(async () => {
    await runUnifiedExecOfficialAction(
      () => restoreCodexUnifiedExecOfficialDefault(),
      "settings.backgroundTerminalFollowOfficialSuccess",
    );
  }, [runUnifiedExecOfficialAction]);

  const unifiedExecOfficialDefaultDetail = unifiedExecExternalStatus
    ? unifiedExecExternalStatus.officialDefaultEnabled
      ? t("settings.backgroundTerminalDefaultEnabled")
      : t("settings.backgroundTerminalDefaultDisabled")
    : null;
  const unifiedExecOfficialConfigDetail = !unifiedExecExternalStatus
    ? null
    : !unifiedExecExternalStatus.hasExplicitUnifiedExec
      ? t("settings.backgroundTerminalOfficialConfigDefault")
      : unifiedExecExternalStatus.explicitUnifiedExecValue === true
        ? t("settings.backgroundTerminalOfficialConfigEnabled")
        : unifiedExecExternalStatus.explicitUnifiedExecValue === false
          ? t("settings.backgroundTerminalOfficialConfigDisabled")
          : t("settings.backgroundTerminalOfficialConfigInvalid");

  const unifiedExecStatusReady = unifiedExecExternalStatus != null;
  const unifiedExecSegmentDisabled =
    unifiedExecActionBusy ||
    (unifiedExecExternalStatusLoading && !unifiedExecStatusReady);
  const unifiedExecFollowActive =
    unifiedExecStatusReady &&
    unifiedExecExternalStatus.hasExplicitUnifiedExec !== true;
  const unifiedExecEnabledActive =
    unifiedExecStatusReady &&
    unifiedExecExternalStatus.hasExplicitUnifiedExec === true &&
    unifiedExecExternalStatus.explicitUnifiedExecValue === true;
  const unifiedExecDisabledActive =
    unifiedExecStatusReady &&
    unifiedExecExternalStatus.hasExplicitUnifiedExec === true &&
    unifiedExecExternalStatus.explicitUnifiedExecValue === false;

  const currentDialogModels =
    dialogTarget === "codex"
      ? codexModels.models
      : claudeModels.models;

  const modelManagerLocalLabel = t("settings.vendor.modelManager.localProvider", {
    defaultValue: "本地配置",
  });

  const dialogProviderOptions = useMemo(() => {
    if (dialogTarget === "codex") {
      return buildManagedProviderOptions(
        codex.codexProviders,
        modelManagerLocalLabel,
      );
    }
    return buildManagedProviderOptions(
      claude.providers,
      modelManagerLocalLabel,
      [LOCAL_SETTINGS_PROVIDER_ID],
    );
  }, [
    claude.providers,
    codex.codexProviders,
    dialogTarget,
    modelManagerLocalLabel,
  ]);

  const dialogDefaultProviderProfileId = useMemo(() => {
    const active =
      dialogTarget === "codex"
        ? codex.codexProviders.find((provider) => provider.isActive)?.id
        : claude.providers.find(
            (provider) =>
              provider.isActive &&
              !provider.isLocalProvider &&
              provider.id !== LOCAL_SETTINGS_PROVIDER_ID,
          )?.id;
    return resolveDefaultProviderOptionId(
      dialogProviderOptions,
      null,
      active ?? null,
    );
  }, [
    claude.providers,
    codex.codexProviders,
    dialogProviderOptions,
    dialogTarget,
  ]);

  const handleDialogModelsChange = useCallback(
    (models: CodexCustomModel[]) => {
      setModelDialogPersistError(null);
      if (dialogTarget === "codex") {
        codexModels.updateModels(models);
        void persistCodexCustomModelCatalog(models, codex.codexProviders)
          .then(() => {
            void codex.loadCodexProviders();
          })
          .catch((error: unknown) => {
            setModelDialogPersistError(
              error instanceof Error
                ? error.message
                : t("settings.vendor.modelManager.persistFailed", {
                    defaultValue: "同步供应商自定义模型失败，请重试。",
                  }),
            );
          });
        return;
      }
      claudeModels.updateModels(models);
      void persistClaudeCustomModelCatalog(models, claude.providers)
        .then(() => {
          void claude.loadProviders();
        })
        .catch((error: unknown) => {
          setModelDialogPersistError(
            error instanceof Error
              ? error.message
              : t("settings.vendor.modelManager.persistFailed", {
                  defaultValue: "同步供应商自定义模型失败，请重试。",
                }),
          );
        });
    },
    [claude, claudeModels, codex, codexModels, dialogTarget, t],
  );

  const claudeHasConfig = Boolean(claude.currentConfig);
  /**
   * Claude official (local settings.json) is the runtime default when no managed
   * third-party is active — same badge rule as Codex / Kimi / Grok / OpenCode.
   */
  const claudeOfficialInUse = useMemo(
    () =>
      !claude.providers.some((provider) =>
        isManagedThirdPartyProviderActive(provider, LOCAL_SETTINGS_PROVIDER_ID),
      ),
    [claude.providers],
  );
  /** Codex official = no managed third-party currently active */
  const codexOfficialInUse = useMemo(
    () => !codex.codexProviders.some((provider) => provider.isActive),
    [codex.codexProviders],
  );
  /**
   * Kimi / Grok / OpenCode official (local config) is the runtime default when no
   * managed third-party is active — mirror Codex so the badge matches actual launch.
   */
  const kimiOfficialInUse = useMemo(
    () =>
      !kimi.kimiProviders.some((provider) =>
        isManagedThirdPartyProviderActive(provider, LOCAL_KIMI_PROVIDER_ID),
      ),
    [kimi.kimiProviders],
  );
  const grokOfficialInUse = useMemo(
    () =>
      !grok.grokProviders.some((provider) =>
        isManagedThirdPartyProviderActive(provider, LOCAL_GROK_PROVIDER_ID),
      ),
    [grok.grokProviders],
  );
  const openCodeOfficialInUse = useMemo(
    () =>
      !openCode.openCodeProviders.some((provider) =>
        isManagedThirdPartyProviderActive(provider, LOCAL_OPENCODE_PROVIDER_ID),
      ),
    [openCode.openCodeProviders],
  );
  const kimiHasConfig =
    Boolean(kimi.currentKimiConfig?.baseUrl) ||
    kimi.kimiProviders.some(
      (provider) =>
        provider.id !== LOCAL_KIMI_PROVIDER_ID && !provider.isLocalProvider,
    );
  const grokHasConfig =
    Boolean(grok.currentGrokConfig?.baseUrl) ||
    grok.grokProviders.some(
      (provider) =>
        provider.id !== LOCAL_GROK_PROVIDER_ID && !provider.isLocalProvider,
    );
  const openCodeHasConfig =
    Boolean(openCode.currentOpenCodeConfig?.baseUrl) ||
    openCode.openCodeProviders.some(
      (provider) =>
        provider.id !== LOCAL_OPENCODE_PROVIDER_ID && !provider.isLocalProvider,
    );
  const engineNavItems: CliEngineNavItem[] = useMemo(
    () =>
      buildCliEngineNavItems({
        claudeHasConfig,
        codexHasConfig: codexGlobalConfigExists,
        kimiHasConfig,
        grokHasConfig,
        openCodeHasConfig,
      }),
    [claudeHasConfig, codexGlobalConfigExists, kimiHasConfig, grokHasConfig, openCodeHasConfig],
  );
  const filteredEngineNavItems = useMemo(() => {
    const normalizedQuery = cliSearchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return engineNavItems;
    }
    return engineNavItems.filter((item) =>
      item.label.toLowerCase().includes(normalizedQuery),
    );
  }, [cliSearchQuery, engineNavItems]);

  const isCliSearchActive = cliSearchQuery.trim().length > 0;
  const disabledCliEngineIds = useMemo(
    () => appSettings.disabledCliEngines ?? [],
    [appSettings.disabledCliEngines],
  );
  const disabledCliEngineIdSet = useMemo(
    () => new Set(disabledCliEngineIds),
    [disabledCliEngineIds],
  );
  const cliEngineNavGroups = useMemo(
    () => groupCliEngineNavItems(engineNavItems, disabledCliEngineIds),
    [engineNavItems, disabledCliEngineIds],
  );
  // 「未启用」默认折叠,但当用户刚停用一个 CLI(组内数量增加)时自动展开一次,
  // 让被停用的行有可见归宿;首次挂载(含重启后)只记录基线,不自动展开。
  const prevDisabledCliCountRef = useRef<number | null>(null);
  useEffect(() => {
    const count = cliEngineNavGroups.disabled.length;
    if (prevDisabledCliCountRef.current === null) {
      prevDisabledCliCountRef.current = count;
      return;
    }
    if (count > prevDisabledCliCountRef.current) {
      setCollapsedCliGroups((prev) => ({ ...prev, disabled: false }));
    }
    prevDisabledCliCountRef.current = count;
  }, [cliEngineNavGroups.disabled.length]);
  const toggleCliGroup = useCallback((key: CliEngineNavGroupKey) => {
    setCollapsedCliGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);
  const handleToggleCliEngine = useCallback(
    (engineId: VendorTab, enabled: boolean) => {
      const current = appSettings.disabledCliEngines ?? [];
      const next = enabled
        ? current.filter((id) => id !== engineId)
        : current.includes(engineId)
          ? current
          : [...current, engineId];
      void onUpdateAppSettings({ ...appSettings, disabledCliEngines: next });
    },
    [appSettings, onUpdateAppSettings],
  );
  const cliMoreActionsLabel = t("settings.vendor.cliMoreActions", {
    defaultValue: "更多操作",
  });
  const cliDisableLabel = t("settings.vendor.cliDisableEngine", {
    defaultValue: "关闭启用",
  });
  const cliEnableLabel = t("settings.vendor.cliEnableEngine", {
    defaultValue: "启用",
  });

  return (
    <div
      className="vendor-settings-panel flex items-stretch"
      data-mobile-pane={mobilePane}
    >
      <nav
        className="vendor-engine-nav sticky top-0 flex min-h-0 shrink-0 flex-col self-stretch"
        aria-label={t("settings.vendorsTitle")}
      >
        {/*
          滚动层与外壳分离：外壳 overflow:hidden 裁掉任何残留滚动条 gutter，
          避免展开「暂未开放」后 CLI 行被挤窄 1–2px。
        */}
        <div className="vendor-engine-nav-scroll flex min-h-0 flex-1 flex-col">
          <label className="vendor-engine-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={cliSearchQuery}
              placeholder={t("settings.vendor.cliSearchPlaceholder", {
                defaultValue: "搜索CLI",
              })}
              aria-label={t("settings.vendor.cliSearchPlaceholder", {
                defaultValue: "搜索CLI",
              })}
              onChange={(event) => setCliSearchQuery(event.currentTarget.value)}
            />
          </label>
          {isCliSearchActive ? (
            filteredEngineNavItems.map((item) => (
              <CliEngineNavRow
                key={item.key}
                item={item}
                active={activeCli === item.key}
                disabledIds={disabledCliEngineIdSet}
                moreLabel={cliMoreActionsLabel}
                disableLabel={cliDisableLabel}
                enableLabel={cliEnableLabel}
                onSelectCli={selectCli}
                onToggleCliEnabled={handleToggleCliEngine}
              />
            ))
          ) : (
            <>
              <CliEngineNavGroupSection
                label={t("settings.vendor.cliGroupEnabled", {
                  defaultValue: "已启用",
                })}
                items={cliEngineNavGroups.enabled}
                collapsed={collapsedCliGroups.enabled}
                activeCli={activeCli}
                disabledIds={disabledCliEngineIdSet}
                moreLabel={cliMoreActionsLabel}
                disableLabel={cliDisableLabel}
                enableLabel={cliEnableLabel}
                emptyHint={t("settings.vendor.cliGroupEnabledEmpty", {
                  defaultValue: "没有已启用的 CLI",
                })}
                onToggleGroup={() => toggleCliGroup("enabled")}
                onSelectCli={selectCli}
                onToggleCliEnabled={handleToggleCliEngine}
              />
              {cliEngineNavGroups.disabled.length > 0 ? (
                <CliEngineNavGroupSection
                  label={t("settings.vendor.cliGroupDisabled", {
                    defaultValue: "未启用",
                  })}
                  items={cliEngineNavGroups.disabled}
                  collapsed={collapsedCliGroups.disabled}
                  activeCli={activeCli}
                  disabledIds={disabledCliEngineIdSet}
                  moreLabel={cliMoreActionsLabel}
                  disableLabel={cliDisableLabel}
                  enableLabel={cliEnableLabel}
                  onToggleGroup={() => toggleCliGroup("disabled")}
                  onSelectCli={selectCli}
                  onToggleCliEnabled={handleToggleCliEngine}
                />
              ) : null}
              <CliEngineNavGroupSection
                label={t("settings.vendor.cliGroupUpcoming", {
                  defaultValue: "暂未开放",
                })}
                items={cliEngineNavGroups.upcoming}
                collapsed={collapsedCliGroups.upcoming}
                activeCli={activeCli}
                disabledIds={disabledCliEngineIdSet}
                moreLabel={cliMoreActionsLabel}
                disableLabel={cliDisableLabel}
                enableLabel={cliEnableLabel}
                onToggleGroup={() => toggleCliGroup("upcoming")}
                onSelectCli={selectCli}
                onToggleCliEnabled={handleToggleCliEngine}
              />
            </>
          )}
        </div>
      </nav>

      <div className="vendor-settings-content min-w-0 flex-1 min-h-0">
        <button
          type="button"
          className="vendor-settings-mobile-back"
          onClick={() => setMobilePane("list")}
        >
          <ArrowLeft size={14} strokeWidth={2.2} aria-hidden="true" />
          <span>
            {t("settings.backToCliList", { defaultValue: "返回 CLI 列表" })}
          </span>
        </button>
        {activeCli === "claude" ? (
          <CliLifecycleProvider engine="claude" active>
            <div className="vendor-tab-content vendor-tab-content-dense">
            <CliBrandHeader
              id="claude"
              title="Claude Code CLI"
              description={t("settings.claudeDescription")}
              helpLabel={t("settings.vendor.openCliDocs", {
                defaultValue: "Official docs",
              })}
              href={CLI_DOCS_HREF_BY_ID.claude}
              actions={<CliLifecycleHeaderActions />}
            />
            <CliLifecycleInstallerPanel />
            {claude.providerError ? (
              <div className="settings-help" role="alert">
                {claude.providerError.message}
              </div>
            ) : null}
            <VendorSettingsSection
              label={t("settings.vendor.engineSettings", {
                defaultValue: "Engine settings",
              })}
            >
              <div className="vendor-group-card">
                <ClaudeLocalSettingsCard
                  localProvider={claude.localProvider}
                  inUse={claudeOfficialInUse}
                  onSwitch={claude.handleSwitchProvider}
                  onEdit={claude.handleOpenClaudeSettingsJsonDialog}
                />
                {renderCustomPathEntry("claude")}
                {renderPluginModelsEntry("claude", claudeModels.models.length)}
              </div>
            </VendorSettingsSection>
            <VendorSettingsSection>
              <ProviderList
                providers={claude.providers}
                loading={claude.loading}
                headerActions={renderCcSwitchImportButton("claude")}
                onAdd={claude.handleAddProvider}
                onEdit={claude.handleEditProvider}
                onDelete={claude.handleDeleteProvider}
                onReorder={claude.handleReorderProviders}
                onSwitch={claude.handleSwitchProvider}
              />
            </VendorSettingsSection>
            <ProviderDialog
              isOpen={claude.providerDialog.isOpen}
              provider={claude.providerDialog.provider}
              onClose={claude.handleCloseProviderDialog}
              onSave={claude.handleSaveProvider}
              actionError={claude.providerError?.message}
            />
            <ClaudeSettingsJsonDialog
              isOpen={claude.claudeSettingsJsonDialogOpen}
              onClose={claude.handleCloseClaudeSettingsJsonDialog}
              onSaved={claude.handleClaudeSettingsJsonSaved}
            />
            <DeleteConfirmDialog
              isOpen={claude.deleteConfirm.isOpen}
              providerName={claude.deleteConfirm.provider?.name ?? ""}
              onConfirm={claude.confirmDeleteProvider}
              onCancel={claude.cancelDeleteProvider}
            />
          </div>
          </CliLifecycleProvider>
        ) : activeCli === "codex" ? (
          <CliLifecycleProvider engine="codex" active>
          <div className="vendor-tab-content vendor-tab-content-dense">
            <CliBrandHeader
              id="codex"
              title="Codex CLI"
              description={t("settings.codexDescription")}
              helpLabel={t("settings.vendor.openCliDocs", {
                defaultValue: "Official docs",
              })}
              href={CLI_DOCS_HREF_BY_ID.codex}
              actions={<CliLifecycleHeaderActions />}
            />
            <CliLifecycleInstallerPanel />
            {codexReloadStatus !== "idle" && (
              <div className="settings-help">
                {codexReloadStatus === "failed"
                  ? codexReloadMessage
                    ? `${t("settings.codexRuntimeReloadFailed")}: ${codexReloadMessage}`
                    : t("settings.codexRuntimeReloadFailed")
                  : codexReloadMessage ?? t("settings.codexRuntimeReloadApplied")}
              </div>
            )}
            {codex.codexProviderError && (
              <div className="settings-help">
                {t("settings.vendor.codexProviderActionFailed")}:{" "}
                {codex.codexProviderError}
              </div>
            )}
            <VendorSettingsSection
              label={t("settings.vendor.engineSettings", {
                defaultValue: "Engine settings",
              })}
            >
              <div className="vendor-group-card">
                <CurrentCodexGlobalConfigCard
                  configLoading={codexGlobalConfigLoading}
                  configContent={codexGlobalConfigContent}
                  configExists={codexGlobalConfigExists}
                  configTruncated={codexGlobalConfigTruncated}
                  configError={codexGlobalConfigError}
                  authLoading={codexAuthConfigLoading}
                  authContent={codexAuthConfigContent}
                  authExists={codexAuthConfigExists}
                  authTruncated={codexAuthConfigTruncated}
                  authError={codexAuthConfigError}
                  inUse={codexOfficialInUse}
                  helpContent={
                    <div className="vendor-settings-row-help-stack">
                      <p>
                        {`${t("settings.vendor.currentCodexGlobalConfig")} · ${t(
                          "settings.vendor.currentCodexAuthConfig",
                        )}`}
                      </p>
                    </div>
                  }
                  onUse={() => {
                    void codex.handleSwitchCodexProvider(DISABLED_PROVIDER_ID);
                  }}
                  onSaved={refreshUnifiedExecConfigViews}
                />

                {renderCustomPathEntry("codex")}
                {renderPluginModelsEntry("codex", codexModels.models.length)}

                <div className="settings-toggle-row vendor-group-row">
                  <div className="vendor-group-row-copy">
                    <span className="vendor-group-row-title">
                      {t("settings.backgroundTerminal")}
                      <SettingsRowHelp>
                        <div className="vendor-settings-row-help-stack">
                          <p>{t("settings.backgroundTerminalDesc")}</p>
                          <p>{t("settings.backgroundTerminalMarkerDesc")}</p>
                          {unifiedExecOfficialConfigDetail ? (
                            <p>{unifiedExecOfficialConfigDetail}</p>
                          ) : null}
                          {unifiedExecOfficialDefaultDetail ? (
                            <p>{unifiedExecOfficialDefaultDetail}</p>
                          ) : null}
                        </div>
                      </SettingsRowHelp>
                    </span>
                    {unifiedExecExternalStatusLoading &&
                    !unifiedExecExternalStatus ? (
                      <div className="settings-help" aria-live="polite">
                        {t("settings.loading")}
                      </div>
                    ) : null}
                    {unifiedExecExternalStatusError ? (
                      <div className="settings-help">
                        {unifiedExecExternalStatusError}
                      </div>
                    ) : null}
                    {unifiedExecActionNotice ? (
                      <div className="settings-help">
                        {unifiedExecActionNotice.message}
                      </div>
                    ) : null}
                  </div>
                  <div
                    className="settings-segmented vendor-codex-runtime-segmented"
                    role="group"
                    aria-label={t("settings.backgroundTerminal")}
                  >
                    <button
                      type="button"
                      className={cn(
                        "settings-segmented-btn",
                        unifiedExecFollowActive && "active",
                      )}
                      onClick={() =>
                        void handleRestoreUnifiedExecOfficialDefault()
                      }
                      disabled={unifiedExecSegmentDisabled}
                    >
                      {t("settings.backgroundTerminalFollowOfficial")}
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "settings-segmented-btn",
                        unifiedExecEnabledActive && "active",
                      )}
                      onClick={() =>
                        void handleSetUnifiedExecOfficialOverride(true)
                      }
                      disabled={unifiedExecSegmentDisabled}
                    >
                      {t("settings.backgroundTerminalOfficialWriteEnabled")}
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "settings-segmented-btn",
                        unifiedExecDisabledActive && "active",
                      )}
                      onClick={() =>
                        void handleSetUnifiedExecOfficialOverride(false)
                      }
                      disabled={unifiedExecSegmentDisabled}
                    >
                      {t("settings.backgroundTerminalOfficialWriteDisabled")}
                    </button>
                  </div>
                </div>

                <div className="settings-toggle-row vendor-group-row">
                  <div className="vendor-group-row-copy">
                    <span className="vendor-group-row-title">
                      {t("settings.sidebarProviderLabels")}
                      <SettingsRowHelp>
                        {t("settings.sidebarProviderLabelsDesc")}
                      </SettingsRowHelp>
                    </span>
                  </div>
                  <Switch
                    checked={appSettings.showSidebarProviderLabels === true}
                    aria-label={t("settings.sidebarProviderLabels")}
                    onCheckedChange={(checked) =>
                      void onUpdateAppSettings({
                        ...appSettings,
                        showSidebarProviderLabels: checked,
                      })
                    }
                  />
                </div>
              </div>
            </VendorSettingsSection>
            <VendorSettingsSection>
              <CodexProviderList
                providers={codex.codexProviders}
                loading={codex.codexLoading}
                headerActions={renderCcSwitchImportButton("codex")}
                onAdd={codex.handleAddCodexProvider}
                onEdit={codex.handleEditCodexProvider}
                onDelete={codex.handleDeleteCodexProvider}
                onReorder={codex.handleReorderCodexProviders}
                onSwitch={codex.handleSwitchCodexProvider}
              />
            </VendorSettingsSection>
            <CodexProviderDialog
              isOpen={codex.codexProviderDialog.isOpen}
              provider={codex.codexProviderDialog.provider}
              onClose={codex.handleCloseCodexProviderDialog}
              onSave={codex.handleSaveCodexProvider}
            />
            <DeleteConfirmDialog
              isOpen={codex.deleteCodexConfirm.isOpen}
              providerName={codex.deleteCodexConfirm.provider?.name ?? ""}
              onConfirm={codex.confirmDeleteCodexProvider}
              onCancel={codex.cancelDeleteCodexProvider}
            />
          </div>
          </CliLifecycleProvider>
        ) : activeCli === "kimi" ? (
          <CliLifecycleProvider engine="kimi" active>
          <div className="vendor-tab-content vendor-tab-content-dense">
            <CliBrandHeader
              id="kimi"
              title="Kimi CLI"
              description={t("settings.kimiDescription", {
                defaultValue:
                  "Configure the Kimi CLI providers used by doge.",
              })}
              helpLabel={t("settings.vendor.openCliDocs", {
                defaultValue: "Official docs",
              })}
              href={CLI_DOCS_HREF_BY_ID.kimi}
              actions={<CliLifecycleHeaderActions />}
            />
            <CliLifecycleInstallerPanel />
            {kimi.kimiProviderError && (
              <div className="settings-help">
                {t("settings.vendor.kimiProviderActionFailed")}:{" "}
                {kimi.kimiProviderError}
              </div>
            )}
            <VendorSettingsSection
              label={t("settings.vendor.engineSettings", {
                defaultValue: "Engine settings",
              })}
            >
              <div className="vendor-group-card">
                <LocalOfficialConfigCard
                  inUse={kimiOfficialInUse}
                  localProviderId={LOCAL_KIMI_PROVIDER_ID}
                  description={t(
                    "settings.vendor.kimiLocalProviderDescription",
                  )}
                  onSwitch={kimi.handleSwitchKimiProvider}
                  onEdit={() => setLocalOfficialEditEngine("kimi")}
                />
                {renderCustomPathEntry("kimi")}
              </div>
            </VendorSettingsSection>
            <VendorSettingsSection>
              <KimiProviderList
                providers={kimi.kimiProviders}
                loading={kimi.kimiLoading}
                onAdd={kimi.handleAddKimiProvider}
                onEdit={kimi.handleEditKimiProvider}
                onDelete={kimi.handleDeleteKimiProvider}
                onSwitch={kimi.handleSwitchKimiProvider}
              />
            </VendorSettingsSection>
            <KimiProviderDialog
              isOpen={kimi.kimiProviderDialog.isOpen}
              provider={kimi.kimiProviderDialog.provider}
              onClose={kimi.handleCloseKimiProviderDialog}
              onSave={kimi.handleSaveKimiProvider}
            />
            <DeleteConfirmDialog
              isOpen={kimi.deleteKimiConfirm.isOpen}
              providerName={kimi.deleteKimiConfirm.provider?.name ?? ""}
              onConfirm={kimi.confirmDeleteKimiProvider}
              onCancel={kimi.cancelDeleteKimiProvider}
            />
            <LocalOfficialConfigEditDialog
              isOpen={localOfficialEditEngine === "kimi"}
              title={t("settings.vendor.officialConfig")}
              pathLabel={t("settings.vendor.kimiLocalConfigPath")}
              format="toml"
              onClose={() => setLocalOfficialEditEngine(null)}
              onSaved={() => {
                void kimi.loadKimiProviders();
              }}
              readContent={readKimiConfigToml}
              saveContent={saveKimiConfigToml}
            />
          </div>
          </CliLifecycleProvider>
        ) : activeCli === "grok" ? (
          <CliLifecycleProvider engine="grok" active>
          <div className="vendor-tab-content vendor-tab-content-dense">
            <CliBrandHeader
              id="grok"
              title="Grok CLI"
              description={t("settings.grokDescription", {
                defaultValue:
                  "Configure the Grok CLI providers used by doge.",
              })}
              helpLabel={t("settings.vendor.openCliDocs", {
                defaultValue: "Official docs",
              })}
              href={CLI_DOCS_HREF_BY_ID.grok}
              actions={<CliLifecycleHeaderActions />}
            />
            <CliLifecycleInstallerPanel />
            {grok.grokProviderError && (
              <div className="settings-help">
                {t("settings.vendor.grokProviderActionFailed")}:{" "}
                {grok.grokProviderError}
              </div>
            )}
            <VendorSettingsSection
              label={t("settings.vendor.engineSettings", {
                defaultValue: "Engine settings",
              })}
            >
              <div className="vendor-group-card">
                <LocalOfficialConfigCard
                  inUse={grokOfficialInUse}
                  localProviderId={LOCAL_GROK_PROVIDER_ID}
                  description={t(
                    "settings.vendor.grokLocalProviderDescription",
                  )}
                  onSwitch={grok.handleSwitchGrokProvider}
                  onEdit={() => setLocalOfficialEditEngine("grok")}
                />
                {renderCustomPathEntry("grok")}
              </div>
            </VendorSettingsSection>
            <VendorSettingsSection>
              <GrokProviderList
                providers={grok.grokProviders}
                loading={grok.grokLoading}
                onAdd={grok.handleAddGrokProvider}
                onEdit={grok.handleEditGrokProvider}
                onDelete={grok.handleDeleteGrokProvider}
                onSwitch={grok.handleSwitchGrokProvider}
              />
            </VendorSettingsSection>
            <GrokProviderDialog
              isOpen={grok.grokProviderDialog.isOpen}
              provider={grok.grokProviderDialog.provider}
              onClose={grok.handleCloseGrokProviderDialog}
              onSave={grok.handleSaveGrokProvider}
            />
            <DeleteConfirmDialog
              isOpen={grok.deleteGrokConfirm.isOpen}
              providerName={grok.deleteGrokConfirm.provider?.name ?? ""}
              onConfirm={grok.confirmDeleteGrokProvider}
              onCancel={grok.cancelDeleteGrokProvider}
            />
            <LocalOfficialConfigEditDialog
              isOpen={localOfficialEditEngine === "grok"}
              title={t("settings.vendor.officialConfig")}
              pathLabel={t("settings.vendor.grokLocalConfigPath")}
              format="toml"
              onClose={() => setLocalOfficialEditEngine(null)}
              onSaved={() => {
                void grok.loadGrokProviders();
              }}
              readContent={readGrokConfigToml}
              saveContent={saveGrokConfigToml}
            />
          </div>
          </CliLifecycleProvider>
        ) : activeCli === "opencode" ? (
          <CliLifecycleProvider engine="opencode" active>
          <div className="vendor-tab-content vendor-tab-content-dense">
            <CliBrandHeader
              id="opencode"
              title="OpenCode CLI"
              description={t("settings.opencodeDescription", {
                defaultValue:
                  "Configure the OpenCode CLI providers used by doge.",
              })}
              helpLabel={t("settings.vendor.openCliDocs", {
                defaultValue: "Official docs",
              })}
              href={CLI_DOCS_HREF_BY_ID.opencode}
              actions={<CliLifecycleHeaderActions />}
            />
            <CliLifecycleInstallerPanel />
            {openCode.openCodeProviderError && (
              <div className="settings-help">
                {t("settings.vendor.opencodeProviderActionFailed")}:{" "}
                {openCode.openCodeProviderError}
              </div>
            )}
            <VendorSettingsSection
              label={t("settings.vendor.engineSettings", {
                defaultValue: "Engine settings",
              })}
            >
              <div className="vendor-group-card">
                <LocalOfficialConfigCard
                  inUse={openCodeOfficialInUse}
                  localProviderId={LOCAL_OPENCODE_PROVIDER_ID}
                  description={t(
                    "settings.vendor.opencodeLocalProviderDescription",
                  )}
                  onSwitch={openCode.handleSwitchOpenCodeProvider}
                  onEdit={() => setLocalOfficialEditEngine("opencode")}
                />
                {renderCustomPathEntry("opencode")}
              </div>
            </VendorSettingsSection>
            <VendorSettingsSection>
              <OpenCodeProviderList
                providers={openCode.openCodeProviders}
                loading={openCode.openCodeLoading}
                onAdd={openCode.handleAddOpenCodeProvider}
                onEdit={openCode.handleEditOpenCodeProvider}
                onDelete={openCode.handleDeleteOpenCodeProvider}
                onSwitch={openCode.handleSwitchOpenCodeProvider}
              />
            </VendorSettingsSection>
            <OpenCodeProviderDialog
              isOpen={openCode.openCodeProviderDialog.isOpen}
              provider={openCode.openCodeProviderDialog.provider}
              onClose={openCode.handleCloseOpenCodeProviderDialog}
              onSave={openCode.handleSaveOpenCodeProvider}
            />
            <DeleteConfirmDialog
              isOpen={openCode.deleteOpenCodeConfirm.isOpen}
              providerName={openCode.deleteOpenCodeConfirm.provider?.name ?? ""}
              onConfirm={openCode.confirmDeleteOpenCodeProvider}
              onCancel={openCode.cancelDeleteOpenCodeProvider}
            />
            <LocalOfficialConfigEditDialog
              isOpen={localOfficialEditEngine === "opencode"}
              title={t("settings.vendor.officialConfig")}
              pathLabel={t("settings.vendor.opencodeLocalConfigPath")}
              format="json"
              onClose={() => setLocalOfficialEditEngine(null)}
              onSaved={() => {
                void openCode.loadOpenCodeProviders();
              }}
              readContent={readOpenCodeConfigJson}
              saveContent={saveOpenCodeConfigJson}
            />
          </div>
          </CliLifecycleProvider>
        ) : (
          <div className="vendor-tab-content">
            <CliBrandHeader
              id={activeCli}
              title={
                engineNavItems.find((item) => item.key === activeCli)?.label ??
                activeCli
              }
              description={t("settings.vendor.cliComingSoon", {
                defaultValue: "Support is coming soon.",
              })}
              helpLabel={t("settings.vendor.openCliDocs", {
                defaultValue: "Official docs",
              })}
              href={
                engineNavItems.find((item) => item.key === activeCli)?.docsUrl ??
                CLI_DOCS_HREF_BY_ID.claude
              }
              monochromeLogo
            />
            <div className="vendor-empty">
              {t("settings.vendor.cliComingSoonDetail", {
                defaultValue: "正在适配此CLI，即将开放",
              })}
            </div>
          </div>
        )}
      </div>

      <CustomModelDialog
        isOpen={modelDialogOpen}
        models={currentDialogModels}
        onModelsChange={handleDialogModelsChange}
        onClose={closeModelDialog}
        initialAddMode={modelDialogAddMode}
        modelValidation={dialogTarget === "claude" ? "shape-only" : "model-id"}
        providerOptions={dialogProviderOptions}
        defaultProviderProfileId={dialogDefaultProviderProfileId}
        persistError={modelDialogPersistError}
      />
      {customPathDialogEngine ? (
        <CliCustomPathDialog
          isOpen
          engine={customPathDialogEngine}
          initialPath={resolveCustomPathValue(customPathDialogEngine).path}
          initialArgs={resolveCustomPathValue(customPathDialogEngine).args}
          onSave={(payload) =>
            handleSaveCustomPath(customPathDialogEngine, payload)
          }
          onClose={() => setCustomPathDialogEngine(null)}
        />
      ) : null}
      <CcSwitchImportDialog
        isOpen={ccSwitchImportSource !== null}
        target={ccSwitchImportSource?.target ?? "claude"}
        existingProviderIds={ccSwitchExistingProviderIds}
        sourcePath={ccSwitchImportSource?.sourcePath ?? null}
        onClose={() => setCcSwitchImportSource(null)}
        onImported={handleCcSwitchImported}
      />
    </div>
  );
}
