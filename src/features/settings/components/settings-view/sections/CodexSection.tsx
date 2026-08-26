import { useEffect, useMemo, useState } from "react";
import Stethoscope from "lucide-react/dist/esm/icons/stethoscope";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import type {
  AppSettings,
  CliInstallEngine,
  CodexDoctorResult,
  CodexLaunchProfilePreview,
  WorkspaceInfo,
  WorkspaceSettings,
} from "@/types";
import { previewCodexLaunchProfile } from "@/services/tauri";
import { ComputerUseStatusCard } from "@/features/computer-use/components/ComputerUseStatusCard";
import { ENABLE_COMPUTER_USE_BRIDGE } from "@/features/computer-use/constants";
import {
  resolveInstallerAction,
  useCliInstallLifecycle,
} from "@/features/settings/hooks/useCliInstallLifecycle";
import { CliInstallerPanel } from "@/features/settings/components/CliInstallerPanel";

type DoctorState = {
  status: "idle" | "running" | "done" | "error";
  result: CodexDoctorResult | null;
  error?: string | null;
};

type CodexSectionProps = {
  active: boolean;
  t: (key: string) => string;
  appSettings: AppSettings;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
  handleRunClaudeDoctor: () => Promise<void>;
  claudeDoctorState: DoctorState;
  handleRunKimiDoctor: () => Promise<void>;
  kimiDoctorState: DoctorState;
  handleRunGrokDoctor: () => Promise<void>;
  grokDoctorState: DoctorState;
  handleRunOpenCodeDoctor: () => Promise<void>;
  openCodeDoctorState: DoctorState;
  handleRunDoctor: () => Promise<void>;
  doctorState: DoctorState;
  remoteHostDraft: string;
  setRemoteHostDraft: (value: string) => void;
  remoteTokenDraft: string;
  setRemoteTokenDraft: (value: string) => void;
  handleCommitRemoteHost: () => Promise<void>;
  handleCommitRemoteToken: () => Promise<void>;
  onInstallerDoctorResult: (
    engine: CliInstallEngine,
    result: CodexDoctorResult | null,
  ) => void;
  workspaces?: WorkspaceInfo[];
  activeWorkspace?: WorkspaceInfo | null;
  onUpdateWorkspaceCodexBin?: (
    id: string,
    codexBin: string | null,
  ) => Promise<void>;
  onUpdateWorkspaceSettings?: (
    id: string,
    settings: Partial<WorkspaceSettings>,
  ) => Promise<void>;
};

type PreviewState = {
  status: "idle" | "running" | "done";
  result: CodexLaunchProfilePreview | null;
  error: string | null;
};

type CliValidationTab = "codex" | "claude" | "kimi" | "grok" | "opencode";

// Deprecated: Gemini CLI validation entry is intentionally hidden.
const DEPRECATED_CLI_VALIDATION_ENGINES = new Set(["gemini"]);

type DoctorResultCardProps = {
  t: (key: string) => string;
  state: DoctorState;
  successTitleKey: string;
  errorTitleKey: string;
  showAppServer: boolean;
};

function DoctorResultCard({
  t,
  state,
  successTitleKey,
  errorTitleKey,
  showAppServer,
}: DoctorResultCardProps) {
  if (!state.result) {
    return null;
  }

  const debugEnvVars = state.result.debug?.envVars ?? {};
  const debugExtraSearchPaths = state.result.debug?.extraSearchPaths ?? [];
  const debugProxySnapshot = state.result.debug?.proxyEnvSnapshot ?? null;
  const configuredProxyEntries = Object.entries(
    state.result.proxyEnvSnapshot ?? {},
  ).filter(([, value]) => typeof value === "string" && value.trim().length > 0);
  const environmentDiagnosis = state.result.environmentDiagnosis;
  const shouldShowEnvironmentDiagnosis =
    Boolean(environmentDiagnosis?.category) &&
    environmentDiagnosis?.category !== "resolved";
  const networkDiagnosis = state.result.networkDiagnosis;
  const shouldShowNetworkDiagnosis =
    Boolean(networkDiagnosis?.category) && networkDiagnosis?.category !== "unknown";

  return (
    <div className={`settings-doctor ${state.result.ok ? "ok" : "error"}`}>
      <div className="settings-doctor-title">
        {state.result.ok ? t(successTitleKey) : t(errorTitleKey)}
      </div>
      <div className="settings-doctor-body">
        <div>
          {t("settings.versionLabel")}{" "}
          {state.result.version ?? t("git.unknown")}
        </div>
        {showAppServer ? (
          <div>
            {t("settings.appServerLabel")}{" "}
            {state.result.appServerOk
              ? t("settings.statusOk")
              : t("settings.statusFailed")}
          </div>
        ) : null}
        {state.result.appServerProbeStatus && showAppServer ? (
          <div>
            <strong>{t("settings.doctorAppServerProbe")}:</strong>{" "}
            {state.result.appServerProbeStatus}
          </div>
        ) : null}
        {state.result.resolvedBinaryPath ? (
          <div>
            <strong>{t("settings.doctorResolvedBinary")}:</strong>{" "}
            {state.result.resolvedBinaryPath}
          </div>
        ) : null}
        {state.result.wrapperKind ? (
          <div>
            <strong>{t("settings.doctorWrapperKind")}:</strong>{" "}
            {state.result.wrapperKind}
          </div>
        ) : null}
        {state.result.fallbackRetried ? (
          <div>
            <strong>{t("settings.doctorWrapperFallbackRetry")}:</strong>{" "}
            {t("settings.doctorAttempted")}
          </div>
        ) : null}
        {shouldShowEnvironmentDiagnosis ? (
          <div>
            <strong>{t("settings.doctorEnvironmentDiagnosis")}:</strong>{" "}
            {environmentDiagnosis?.category}
            {environmentDiagnosis?.message
              ? ` · ${environmentDiagnosis.message}`
              : ""}
          </div>
        ) : null}
        {shouldShowNetworkDiagnosis ? (
          <div>
            <strong>{t("settings.doctorNetworkDiagnosis")}:</strong>{" "}
            {networkDiagnosis?.category}
          </div>
        ) : null}
        {configuredProxyEntries.length > 0 ? (
          <div>
            <strong>{t("settings.doctorProxyEnvironment")}:</strong>{" "}
            {configuredProxyEntries
              .map(([key, value]) => `${key}=${value ?? t("settings.notSet")}`)
              .join(" · ")}
          </div>
        ) : null}
        {state.result.nodeRequired !== false ? (
          <div>
            {t("settings.nodeLabel")} {" "}
            {state.result.nodeOk
              ? `${t("settings.statusOk")} (${state.result.nodeVersion ?? t("git.unknown")})`
              : t("settings.statusMissing")}
          </div>
        ) : null}
        {state.result.kimiShell ? (
          <div>
            <strong>{t("settings.doctorEnvironmentDiagnosis")}:</strong>{" "}
            {state.result.kimiShell.category ??
              (state.result.kimiShell.ok
                ? t("settings.statusOk")
                : t("settings.statusFailed"))}
            {state.result.kimiShell.shellPath
              ? ` · ${state.result.kimiShell.shellPath}`
              : ""}
          </div>
        ) : null}
        {state.result.details ? <div>{state.result.details}</div> : null}
        {state.result.nodeDetails ? (
          <div>{state.result.nodeDetails}</div>
        ) : null}
        {state.result.path ? (
          <div className="settings-doctor-path">
            {t("settings.pathLabel")} {state.result.path}
          </div>
        ) : null}
        {state.result.debug ? (
          <details className="settings-doctor-debug">
            <summary
              style={{
                cursor: "pointer",
                marginTop: "8px",
                fontWeight: "bold",
              }}
            >
              {t("settings.doctorDebugInfo")} (
              {t("settings.doctorClickToExpand")})
            </summary>
            <div
              style={{
                marginTop: "8px",
                fontSize: "12px",
                fontFamily: "monospace",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}
            >
              <div>
                <span>{t("settings.doctorPlatform")}:</span>{" "}
                {state.result.debug.platform} ({state.result.debug.arch})
              </div>
              <div>
                <span>{t("settings.doctorResolvedBinary")}:</span>{" "}
                {state.result.debug.resolvedBinaryPath ??
                  t("settings.notFound")}
              </div>
              <div>
                <span>{t("settings.doctorWrapperKind")}:</span>{" "}
                {state.result.debug.wrapperKind ?? t("settings.statusUnknown")}
              </div>
              <div>
                <span>{t("settings.doctorPathUsed")}:</span>{" "}
                {state.result.debug.pathEnvUsed ?? t("settings.notSet")}
              </div>
              <div>
                <span>{t("settings.doctorClaudeFound")}:</span>{" "}
                {state.result.debug.claudeFound ?? t("settings.notFound")}
              </div>
              <div>
                <span>{t("settings.doctorCodexFound")}:</span>{" "}
                {state.result.debug.codexFound ?? t("settings.notFound")}
              </div>
              <div>
                <span>{t("settings.doctorClaudeStandardWhich")}:</span>{" "}
                {state.result.debug.claudeStandardWhich ??
                  t("settings.notFound")}
              </div>
              <div>
                <span>{t("settings.doctorCodexStandardWhich")}:</span>{" "}
                {state.result.debug.codexStandardWhich ??
                  t("settings.notFound")}
              </div>
              {debugProxySnapshot ? (
                <>
                  <div style={{ marginTop: "8px" }}>
                    <span>{t("settings.doctorProxyEnvironment")}:</span>
                  </div>
                  {Object.entries(debugProxySnapshot).map(([key, value]) => (
                    <div key={key} style={{ marginLeft: "12px" }}>
                      <span>{key}:</span> {value ?? t("settings.notSet")}
                    </div>
                  ))}
                </>
              ) : null}
              <div style={{ marginTop: "8px" }}>
                <span>{t("settings.doctorEnvironmentVariables")}:</span>
              </div>
              {Object.entries(debugEnvVars).map(([key, value]) => (
                <div key={key} style={{ marginLeft: "12px" }}>
                  <span>{key}:</span> {value ?? t("settings.notSet")}
                </div>
              ))}
              <div style={{ marginTop: "8px" }}>
                <span>{t("settings.doctorExtraSearchPaths")}:</span>
              </div>
              {debugExtraSearchPaths.map((pathEntry, index) => (
                <div key={index} style={{ marginLeft: "12px" }}>
                  {pathEntry.path}{" "}
                  {pathEntry.exists
                    ? pathEntry.isDir
                      ? "✓"
                      : "✓ (file)"
                    : "✗"}{" "}
                  {pathEntry.hasCodexCmd ? (
                    <span style={{ color: "green" }}>
                      [{t("settings.doctorBinaryMarkerCodexCmd")}]
                    </span>
                  ) : null}
                  {pathEntry.hasClaudeCmd ? (
                    <span style={{ color: "green" }}>
                      [{t("settings.doctorBinaryMarkerClaudeCmd")}]
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </div>
  );
}

type LaunchPreviewCardProps = {
  t: (key: string) => string;
  state: PreviewState;
};

function formatArgumentList(
  t: (key: string) => string,
  args: string[],
): string {
  return args.length > 0 ? args.join(" ") : t("settings.codexLaunchNoArguments");
}

function formatExecutableSource(t: (key: string) => string, source: string) {
  if (source === "draft") {
    return t("settings.codexLaunchExecutableDraft");
  }
  if (source === "global") {
    return t("settings.codexWorkspaceExecutableGlobal");
  }
  if (source === "path") {
    return t("settings.codexWorkspaceExecutablePath");
  }
  return t("settings.codexWorkspaceExecutableOverride");
}

function formatArgumentsSource(t: (key: string) => string, source: string) {
  switch (source) {
    case "draft":
      return t("settings.codexLaunchArgumentsDraft");
    case "global":
      return t("settings.codexWorkspaceArgsGlobal");
    case "parent-workspace":
      return t("settings.codexWorkspaceArgsParent");
    case "default":
      return t("settings.codexWorkspaceArgsDefault");
    default:
      return t("settings.codexWorkspaceArgsOverride");
  }
}

function LaunchPreviewCard({ t, state }: LaunchPreviewCardProps) {
  if (state.status === "idle") {
    return null;
  }
  if (state.status === "running") {
    return (
      <div className="settings-doctor">
        <div className="settings-doctor-title">
          {t("settings.previewingLaunch")}
        </div>
      </div>
    );
  }
  if (state.error) {
    return (
      <div className="settings-doctor error">
        <div className="settings-doctor-title">
          {t("settings.codexLaunchPreviewIssueTitle")}
        </div>
        <div className="settings-doctor-body">{state.error}</div>
      </div>
    );
  }
  if (!state.result) {
    return null;
  }
  return (
    <div className={`settings-doctor ${state.result.ok ? "ok" : "error"}`}>
      <div className="settings-doctor-title">
        {state.result.ok
          ? t("settings.codexLaunchPreviewTitle")
          : t("settings.codexLaunchPreviewIssueTitle")}
      </div>
      <div className="settings-doctor-body">
        <div>
          <span>{t("settings.codexLaunchResolvedExecutable")}:</span>{" "}
          {state.result.resolvedExecutable}
        </div>
        <div>
          <span>{t("settings.codexLaunchWrapperKind")}:</span>{" "}
          {state.result.wrapperKind}
        </div>
        <div>
          <span>{t("settings.codexLaunchUserArguments")}:</span>{" "}
          {formatArgumentList(t, state.result.userArguments)}
        </div>
        <div>
          <span>{t("settings.codexLaunchInjectedArguments")}:</span>{" "}
          {formatArgumentList(t, state.result.injectedArguments)}
        </div>
        <div>
          <span>{t("settings.codexWorkspaceSourceLabel")}:</span>{" "}
          {formatExecutableSource(t, state.result.executableSource)} /{" "}
          {formatArgumentsSource(t, state.result.argumentsSource)}
        </div>
        {state.result.pathEnvUsed ? (
          <div className="settings-doctor-path">
            {t("settings.codexLaunchPathEnv")} {state.result.pathEnvUsed}
          </div>
        ) : null}
        {state.result.details ? <div>{state.result.details}</div> : null}
        {state.result.nextLaunchOnly ? (
          <div>{t("settings.codexLaunchNextLaunchOnly")}</div>
        ) : null}
      </div>
    </div>
  );
}

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeDraftValue(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function CodexSection({
  active,
  t,
  appSettings,
  onUpdateAppSettings,
  handleRunClaudeDoctor,
  claudeDoctorState,
  handleRunKimiDoctor,
  kimiDoctorState,
  handleRunGrokDoctor,
  grokDoctorState,
  handleRunOpenCodeDoctor,
  openCodeDoctorState,
  handleRunDoctor,
  doctorState,
  remoteHostDraft,
  setRemoteHostDraft,
  remoteTokenDraft,
  setRemoteTokenDraft,
  handleCommitRemoteHost,
  handleCommitRemoteToken,
  onInstallerDoctorResult,
  workspaces = [],
  activeWorkspace = null,
  onUpdateWorkspaceCodexBin,
  onUpdateWorkspaceSettings,
}: CodexSectionProps) {
  const [activeTab, setActiveTab] = useState<CliValidationTab>("codex");
  const {
    installerState,
    installerNowMs,
    isBusy: installerBusy,
    requestInstallPlan: requestLifecyclePlan,
    confirmInstallRun,
    cancelInstaller,
  } = useCliInstallLifecycle({
    onDoctorResult: onInstallerDoctorResult,
  });
  const [globalPreviewState, setGlobalPreviewState] = useState<PreviewState>({
    status: "idle",
    result: null,
    error: null,
  });
  const [workspacePreviewState, setWorkspacePreviewState] =
    useState<PreviewState>({
      status: "idle",
      result: null,
      error: null,
    });
  const [workspaceSaveState, setWorkspaceSaveState] = useState<{
    status: "idle" | "saving" | "saved" | "error";
    message: string | null;
  }>({ status: "idle", message: null });
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
    activeWorkspace?.id ?? null,
  );
  const [workspaceCodexPathDraft, setWorkspaceCodexPathDraft] = useState("");
  const [workspaceCodexArgsDraft, setWorkspaceCodexArgsDraft] = useState("");
  const selectedWorkspace = useMemo(() => {
    if (workspaces.length === 0) {
      return null;
    }
    return (
      workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ??
      activeWorkspace ??
      workspaces[0] ??
      null
    );
  }, [activeWorkspace, selectedWorkspaceId, workspaces]);
  const parentWorkspace = useMemo(() => {
    if (!selectedWorkspace?.parentId) {
      return null;
    }
    return (
      workspaces.find(
        (workspace) => workspace.id === selectedWorkspace.parentId,
      ) ?? null
    );
  }, [selectedWorkspace?.parentId, workspaces]);
  const nextWorkspaceCodexBin = normalizeDraftValue(workspaceCodexPathDraft);
  const nextWorkspaceCodexArgs = normalizeDraftValue(workspaceCodexArgsDraft);
  const workspaceLaunchDirty =
    !!selectedWorkspace &&
    (nextWorkspaceCodexBin !== (selectedWorkspace.codex_bin ?? null) ||
      nextWorkspaceCodexArgs !==
        (selectedWorkspace.settings.codexArgs ?? null));
  const workspaceExecutableSource = nextWorkspaceCodexBin
    ? t("settings.codexWorkspaceExecutableOverride")
    : appSettings.codexBin
      ? t("settings.codexWorkspaceExecutableGlobal")
      : t("settings.codexWorkspaceExecutablePath");
  const workspaceArgumentsSource = nextWorkspaceCodexArgs
    ? t("settings.codexWorkspaceArgsOverride")
    : selectedWorkspace?.kind === "worktree" && parentWorkspace?.settings.codexArgs
      ? t("settings.codexWorkspaceArgsParent")
      : appSettings.codexArgs
        ? t("settings.codexWorkspaceArgsGlobal")
        : t("settings.codexWorkspaceArgsDefault");

  useEffect(() => {
    if (workspaces.length === 0) {
      setSelectedWorkspaceId(null);
      return;
    }
    setSelectedWorkspaceId((current) => {
      if (current && workspaces.some((workspace) => workspace.id === current)) {
        return current;
      }
      return activeWorkspace?.id ?? workspaces[0]?.id ?? null;
    });
  }, [activeWorkspace?.id, workspaces]);

  useEffect(() => {
    setWorkspaceCodexPathDraft(selectedWorkspace?.codex_bin ?? "");
    setWorkspaceCodexArgsDraft(selectedWorkspace?.settings.codexArgs ?? "");
    setWorkspacePreviewState({ status: "idle", result: null, error: null });
    setWorkspaceSaveState({ status: "idle", message: null });
  }, [selectedWorkspace?.id, selectedWorkspace?.codex_bin, selectedWorkspace?.settings.codexArgs]);

  const requestInstallPlan = async (
    engine: CliInstallEngine,
    doctorResult: CodexDoctorResult | null,
    actionOverride?: "installLatest" | "updateLatest" | "uninstall",
  ) => {
    const action = actionOverride ?? resolveInstallerAction(doctorResult);
    await requestLifecyclePlan(engine, action);
  };

  const handlePreviewGlobalLaunch = async () => {
    setGlobalPreviewState({ status: "running", result: null, error: null });
    try {
      // Path/args are edited in CLI config management; preview uses saved settings.
      const result = await previewCodexLaunchProfile({
        codexBin: null,
        codexArgs: null,
        workspaceId: null,
        useWorkspaceDraft: false,
      });
      setGlobalPreviewState({ status: "done", result, error: null });
    } catch (error) {
      setGlobalPreviewState({
        status: "done",
        result: null,
        error: normalizeErrorMessage(error),
      });
    }
  };

  const handlePreviewWorkspaceLaunch = async () => {
    if (!selectedWorkspace) {
      return;
    }
    setWorkspacePreviewState({ status: "running", result: null, error: null });
    try {
      const result = await previewCodexLaunchProfile({
        codexBin: nextWorkspaceCodexBin,
        codexArgs: nextWorkspaceCodexArgs,
        workspaceId: selectedWorkspace.id,
        useWorkspaceDraft: true,
      });
      setWorkspacePreviewState({ status: "done", result, error: null });
    } catch (error) {
      setWorkspacePreviewState({
        status: "done",
        result: null,
        error: normalizeErrorMessage(error),
      });
    }
  };

  const handleSaveWorkspaceLaunch = async () => {
    if (!selectedWorkspace || !onUpdateWorkspaceCodexBin || !onUpdateWorkspaceSettings) {
      return;
    }
    const previousCodexBin = selectedWorkspace.codex_bin ?? null;
    setWorkspaceSaveState({ status: "saving", message: null });
    try {
      if (nextWorkspaceCodexBin !== previousCodexBin) {
        await onUpdateWorkspaceCodexBin(selectedWorkspace.id, nextWorkspaceCodexBin);
      }
      if (nextWorkspaceCodexArgs !== (selectedWorkspace.settings.codexArgs ?? null)) {
        await onUpdateWorkspaceSettings(selectedWorkspace.id, {
          codexArgs: nextWorkspaceCodexArgs,
        });
      }
      setWorkspaceSaveState({
        status: "saved",
        message: t("settings.codexLaunchNextLaunchOnly"),
      });
    } catch (error) {
      if (nextWorkspaceCodexBin !== previousCodexBin) {
        await onUpdateWorkspaceCodexBin(selectedWorkspace.id, previousCodexBin).catch(
          () => undefined,
        );
      }
      setWorkspaceSaveState({
        status: "error",
        message: `${t("settings.codexWorkspaceSaveFailed")}: ${normalizeErrorMessage(error)}`,
      });
    }
  };

  if (!active) {
    return null;
  }

  return (
    <section className="settings-section">
      <div className="settings-section-title">
        {t("settings.cliValidationTitle")}
      </div>
      <div className="settings-section-subtitle">
        {t("settings.cliValidationDescription")}
      </div>

      <div className="settings-field">
        <div className="settings-field-label">
          {t("settings.cliExecutionBackendTitle")}
        </div>
        <div className="settings-help">
          {t("settings.cliExecutionBackendDescription")}
        </div>
      </div>

      <div className="settings-field">
        <label className="settings-field-label" htmlFor="backend-mode">
          {t("settings.backendMode")}
        </label>
        <select
          id="backend-mode"
          className="settings-select"
          value={appSettings.backendMode}
          onChange={(event) =>
            void onUpdateAppSettings({
              ...appSettings,
              backendMode: event.target.value as AppSettings["backendMode"],
            })
          }
        >
          <option value="local">{t("settings.backendLocal")}</option>
          <option value="remote">{t("settings.backendRemote")}</option>
        </select>
        <div className="settings-help">{t("settings.backendRemoteDesc")}</div>
      </div>

      {appSettings.backendMode === "remote" ? (
        <div className="settings-field">
          <div className="settings-field-label">
            {t("settings.remoteBackend")}
          </div>
          <div className="settings-field-row">
            <input
              className="settings-input settings-input--compact"
              value={remoteHostDraft}
              placeholder="127.0.0.1:4732"
              onChange={(event) => setRemoteHostDraft(event.target.value)}
              onBlur={() => {
                void handleCommitRemoteHost();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleCommitRemoteHost();
                }
              }}
              aria-label={t("settings.remoteBackendHostAriaLabel")}
            />
            <input
              type="password"
              className="settings-input settings-input--compact"
              value={remoteTokenDraft}
              placeholder={t("settings.remoteBackendToken")}
              onChange={(event) => setRemoteTokenDraft(event.target.value)}
              onBlur={() => {
                void handleCommitRemoteToken();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleCommitRemoteToken();
                }
              }}
              aria-label={t("settings.remoteBackendTokenAriaLabel")}
            />
          </div>
          <div className="settings-help">{t("settings.remoteBackendDesc")}</div>
        </div>
      ) : null}

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          if (DEPRECATED_CLI_VALIDATION_ENGINES.has(value)) {
            setActiveTab("codex");
            return;
          }
          setActiveTab(
            value === "claude"
              ? "claude"
              : value === "kimi"
                ? "kimi"
                : value === "grok"
                  ? "grok"
                  : value === "opencode"
                    ? "opencode"
                    : "codex",
          );
        }}
      >
        <TabsList>
          <TabsTab value="codex">{t("settings.cliValidationTabCodex")}</TabsTab>
          <TabsTab value="claude">
            {t("settings.cliValidationTabClaudeCode")}
          </TabsTab>
          <TabsTab value="kimi">{t("settings.cliValidationTabKimiCli")}</TabsTab>
          <TabsTab value="grok">{t("settings.cliValidationTabGrokCli")}</TabsTab>
          <TabsTab value="opencode">
            {t("settings.cliValidationTabOpenCodeCli")}
          </TabsTab>
        </TabsList>

        <TabsPanel value="codex">
          <div className="settings-field">
            <div className="settings-field-label">
              {t("settings.codexLaunchConfigurationTitle")}
            </div>
            <div className="settings-help">
              {t("settings.cliPathManagedInVendors")}
            </div>
            <div className="settings-help">
              {t("settings.codexLaunchConfigurationDescription")}
            </div>
            <div className="settings-help">
              {t("settings.codexLaunchNextLaunchOnly")}
            </div>
            <div className="settings-field-actions">
              <button
                type="button"
                className="ghost settings-button-compact"
                onClick={() => {
                  void handlePreviewGlobalLaunch();
                }}
                disabled={globalPreviewState.status === "running"}
              >
                <Stethoscope aria-hidden />
                {globalPreviewState.status === "running"
                  ? t("settings.previewingLaunch")
                  : t("settings.previewLaunch")}
              </button>
              <button
                type="button"
                className="ghost settings-button-compact"
                onClick={() => {
                  void handleRunDoctor();
                }}
                disabled={doctorState.status === "running"}
              >
                <Stethoscope aria-hidden />
                {doctorState.status === "running"
                  ? t("settings.running")
                  : t("settings.runDoctor")}
              </button>
              <button
                type="button"
                className="ghost settings-button-compact"
                onClick={() => {
                  void requestInstallPlan("codex", doctorState.result);
                }}
                disabled={installerBusy}
              >
                {resolveInstallerAction(doctorState.result) === "installLatest"
                  ? t("settings.cliInstallLatest")
                  : t("settings.cliUpdateLatest")}
              </button>
            </div>

            <LaunchPreviewCard t={t} state={globalPreviewState} />

            <DoctorResultCard
              t={t}
              state={doctorState}
              successTitleKey="settings.codexLooksGood"
              errorTitleKey="settings.codexIssueDetected"
              showAppServer
            />
          </div>

          <div className="settings-field">
            <div className="settings-field-label">
              {t("settings.codexWorkspaceLaunchConfigurationTitle")}
            </div>
            <div className="settings-help">
              {t("settings.codexWorkspaceLaunchConfigurationDescription")}
            </div>
            {workspaces.length > 0 && selectedWorkspace ? (
              <>
                <label
                  className="settings-field-label"
                  htmlFor="codex-workspace-select"
                >
                  {t("settings.codexWorkspaceSelect")}
                </label>
                <select
                  id="codex-workspace-select"
                  className="settings-select"
                  value={selectedWorkspace.id}
                  onChange={(event) => setSelectedWorkspaceId(event.target.value)}
                >
                  {workspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </option>
                  ))}
                </select>

                <label
                  className="settings-field-label"
                  htmlFor="codex-workspace-path"
                >
                  {t("settings.codexWorkspacePath")}
                </label>
                <input
                  id="codex-workspace-path"
                  className="settings-input"
                  value={workspaceCodexPathDraft}
                  placeholder={t("settings.codexWorkspaceInheritPath")}
                  onChange={(event) =>
                    setWorkspaceCodexPathDraft(event.target.value)
                  }
                />
                <label
                  className="settings-field-label"
                  htmlFor="codex-workspace-args"
                >
                  {t("settings.codexWorkspaceArgs")}
                </label>
                <input
                  id="codex-workspace-args"
                  className="settings-input"
                  value={workspaceCodexArgsDraft}
                  placeholder={t("settings.codexWorkspaceInheritArgs")}
                  onChange={(event) =>
                    setWorkspaceCodexArgsDraft(event.target.value)
                  }
                />
                <div className="settings-help">
                  {t("settings.codexWorkspaceSourceLabel")}{" "}
                  {workspaceExecutableSource} / {workspaceArgumentsSource}
                </div>
                <div className="settings-field-actions">
                  <button
                    type="button"
                    className="ghost settings-button-compact"
                    onClick={() => {
                      void handlePreviewWorkspaceLaunch();
                    }}
                    disabled={workspacePreviewState.status === "running"}
                  >
                    <Stethoscope aria-hidden />
                    {workspacePreviewState.status === "running"
                      ? t("settings.previewingLaunch")
                      : t("settings.previewLaunch")}
                  </button>
                  {workspaceLaunchDirty ? (
                    <button
                      type="button"
                      className="primary"
                      onClick={() => {
                        void handleSaveWorkspaceLaunch();
                      }}
                      disabled={workspaceSaveState.status === "saving"}
                    >
                      {workspaceSaveState.status === "saving"
                        ? t("settings.saving")
                        : t("settings.codexWorkspaceSave")}
                    </button>
                  ) : null}
                </div>
                {workspaceSaveState.message ? (
                  <div
                    className={
                      workspaceSaveState.status === "error"
                        ? "settings-error"
                        : "settings-help"
                    }
                  >
                    {workspaceSaveState.message}
                  </div>
                ) : null}
                <LaunchPreviewCard t={t} state={workspacePreviewState} />
              </>
            ) : (
              <div className="settings-empty">
                {t("settings.codexWorkspaceNoWorkspaces")}
              </div>
            )}
          </div>

          {ENABLE_COMPUTER_USE_BRIDGE ? <ComputerUseStatusCard /> : null}
        </TabsPanel>

        <TabsPanel value="claude">
          <div className="settings-field">
            <div className="settings-help">
              {t("settings.cliPathManagedInVendors")}
            </div>
            <div className="settings-field-actions">
              <button
                type="button"
                className="ghost settings-button-compact"
                onClick={() => {
                  void handleRunClaudeDoctor();
                }}
                disabled={claudeDoctorState.status === "running"}
              >
                <Stethoscope aria-hidden />
                {claudeDoctorState.status === "running"
                  ? t("settings.running")
                  : t("settings.runClaudeDoctor")}
              </button>
              <button
                type="button"
                className="ghost settings-button-compact"
                onClick={() => {
                  void requestInstallPlan("claude", claudeDoctorState.result);
                }}
                disabled={installerBusy}
              >
                {resolveInstallerAction(claudeDoctorState.result) ===
                "installLatest"
                  ? t("settings.cliInstallLatest")
                  : t("settings.cliUpdateLatest")}
              </button>
            </div>

            <DoctorResultCard
              t={t}
              state={claudeDoctorState}
              successTitleKey="settings.claudeLooksGood"
              errorTitleKey="settings.claudeIssueDetected"
              showAppServer={false}
            />
          </div>
        </TabsPanel>

        <TabsPanel value="kimi">
          <div className="settings-field">
            <div className="settings-help">
              {t("settings.cliPathManagedInVendors")}
            </div>
            <div className="settings-field-actions">
              <button
                type="button"
                className="ghost settings-button-compact"
                onClick={() => {
                  void handleRunKimiDoctor();
                }}
                disabled={kimiDoctorState.status === "running"}
              >
                <Stethoscope aria-hidden />
                {kimiDoctorState.status === "running"
                  ? t("settings.running")
                  : t("settings.runKimiDoctor")}
              </button>
              <button
                type="button"
                className="ghost settings-button-compact"
                onClick={() => {
                  void requestInstallPlan("kimi", kimiDoctorState.result);
                }}
                disabled={installerBusy}
              >
                {resolveInstallerAction(kimiDoctorState.result) ===
                "installLatest"
                  ? t("settings.cliInstallLatest")
                  : t("settings.cliUpdateLatest")}
              </button>
            </div>

            <DoctorResultCard
              t={t}
              state={kimiDoctorState}
              successTitleKey="settings.kimiLooksGood"
              errorTitleKey="settings.kimiIssueDetected"
              showAppServer={false}
            />
          </div>
        </TabsPanel>

        <TabsPanel value="grok">
          <div className="settings-field">
            <div className="settings-help">
              {t("settings.cliPathManagedInVendors")}
            </div>
            <div className="settings-field-actions">
              <button
                type="button"
                className="ghost settings-button-compact"
                onClick={() => {
                  void handleRunGrokDoctor();
                }}
                disabled={grokDoctorState.status === "running"}
              >
                <Stethoscope aria-hidden />
                {grokDoctorState.status === "running"
                  ? t("settings.running")
                  : t("settings.runGrokDoctor")}
              </button>
              <button
                type="button"
                className="ghost settings-button-compact"
                onClick={() => {
                  void requestInstallPlan("grok", grokDoctorState.result);
                }}
                disabled={installerBusy}
              >
                {resolveInstallerAction(grokDoctorState.result) ===
                "installLatest"
                  ? t("settings.cliInstallLatest")
                  : t("settings.cliUpdateLatest")}
              </button>
            </div>

            <DoctorResultCard
              t={t}
              state={grokDoctorState}
              successTitleKey="settings.grokLooksGood"
              errorTitleKey="settings.grokIssueDetected"
              showAppServer={false}
            />
          </div>
        </TabsPanel>

        <TabsPanel value="opencode">
          <div className="settings-field">
            <div className="settings-help">
              {t("settings.cliPathManagedInVendors")}
            </div>
            <div className="settings-field-actions">
              <button
                type="button"
                className="ghost settings-button-compact"
                onClick={() => {
                  void handleRunOpenCodeDoctor();
                }}
                disabled={openCodeDoctorState.status === "running"}
              >
                <Stethoscope aria-hidden />
                {openCodeDoctorState.status === "running"
                  ? t("settings.running")
                  : t("settings.runOpenCodeDoctor")}
              </button>
              <button
                type="button"
                className="ghost settings-button-compact"
                onClick={() => {
                  void requestInstallPlan("opencode", openCodeDoctorState.result);
                }}
                disabled={installerBusy}
              >
                {resolveInstallerAction(openCodeDoctorState.result) ===
                "installLatest"
                  ? t("settings.cliInstallLatest")
                  : t("settings.cliUpdateLatest")}
              </button>
            </div>

            <DoctorResultCard
              t={t}
              state={openCodeDoctorState}
              successTitleKey="settings.openCodeLooksGood"
              errorTitleKey="settings.openCodeIssueDetected"
              showAppServer={false}
            />
          </div>
        </TabsPanel>

      </Tabs>

      <CliInstallerPanel
        t={t}
        installerState={installerState}
        installerNowMs={installerNowMs}
        onConfirm={() => {
          void confirmInstallRun();
        }}
        onCancel={cancelInstaller}
      />
    </section>
  );
}
