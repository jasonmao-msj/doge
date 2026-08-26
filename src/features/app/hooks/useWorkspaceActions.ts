import type { RefObject } from "react";
import { useCallback } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import { useNewAgentShortcut } from "./useNewAgentShortcut";
import type { LoadingProgressDialogConfig } from "./useLoadingProgressDialogState";
import { runWithLoadingProgress } from "../utils/loadingProgressActions";
import { pushGlobalRuntimeNotice } from "../../../services/globalRuntimeNotices";
import {
  ensureRuntimeReady,
  isWebServiceRuntime,
  openNewWindow,
  pickWorkspacePath,
} from "../../../services/tauri";
import { pushErrorToast } from "../../../services/toasts";
import type {
  DebugEntry,
  EngineType,
  SetActiveEngine,
  WorkspaceInfo,
} from "../../../types";
import { isEngineExecutionEnabled } from "../../../utils/engineExecutionPolicy";
import { resolveSessionEngineActivation } from "../../engine/utils/engineSessionRouting";
import type { EngineProviderProfileSelection } from "../../threads/constants/codexProviderProfiles";
import { CODEX_DISK_PROVIDER_PROFILE_ID } from "../../threads/constants/codexProviderProfiles";

type WorkspaceOpenMode = "current-window" | "new-window";
type SessionCreationOptions = EngineProviderProfileSelection & {
  folderId?: string | null;
};
const SESSION_CREATION_EMPTY_THREAD_ID = "SESSION_CREATION_EMPTY_THREAD_ID";
const CREATE_SESSION_RUNTIME_RECOVERING_ERROR_PREFIX =
  "[SESSION_CREATE_RUNTIME_RECOVERING]";
const CODEX_PROVIDER_WIRE_API_UNSUPPORTED_ERROR_PREFIX =
  "[codex_provider_wire_api_unsupported]";
const CODEX_PROVIDER_CONFIG_INVALID_ERROR_PREFIX =
  "[codex_provider_config_invalid]";
const CREATE_SESSION_RECOVERY_TOAST_ID_PREFIX = "create-session-recovery";
const CREATE_SESSION_RECOVERY_PROGRESS_TOAST_ID_PREFIX =
  "create-session-recovery-progress";
const CREATE_SESSION_FAILURE_TOAST_ID_PREFIX = "create-session-failure";
const ENGINE_SWITCH_FAILED_PREFIX = "ENGINE_SWITCH_FAILED:";

function isDiskProviderSelection(options?: SessionCreationOptions) {
  const providerProfileId =
    options?.providerProfileId?.trim() || options?.providerProfile?.id?.trim() || "";
  return !providerProfileId || providerProfileId === CODEX_DISK_PROVIDER_PROFILE_ID;
}

function isRecoverableRuntimeCreateSessionError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    message.startsWith(CREATE_SESSION_RUNTIME_RECOVERING_ERROR_PREFIX) ||
    normalized.includes("manual shutdown") ||
    normalized.includes("manual_shutdown") ||
    normalized.includes("broken pipe") ||
    normalized.includes("the pipe is being closed") ||
    normalized.includes("the pipe has been ended") ||
    normalized.includes("os error 32") ||
    normalized.includes("os error 109") ||
    normalized.includes("os error 232") ||
    (normalized.includes("[runtime_ended]") && normalized.includes("stopped after"))
  );
}

function isDiskCodexReadinessRecoveryError(message: string): boolean {
  const normalized = message.toLowerCase();
  if (!normalized.includes("thread/start ready confirmation failed")) {
    return false;
  }
  return (
    normalized.includes("thread not found") ||
    normalized.includes("session not found") ||
    normalized.includes("thread not ready") ||
    normalized.includes("no rollout found for thread id") ||
    normalized.includes("[runtime_ended]") ||
    normalized.includes("stale_reuse_cleanup") ||
    normalized.includes("internal_replacement")
  );
}

function isCliNotFoundError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    message.startsWith("CLI_NOT_FOUND:") ||
    normalized.includes("no such file or directory") ||
    normalized.includes("the system cannot find the file specified") ||
    normalized.includes("is not recognized as an internal or external command") ||
    normalized.includes("spawn") && normalized.includes("enoent") ||
    normalized.includes("failed to execute claude") ||
    normalized.includes("failed to execute codex") ||
    normalized.includes("failed to execute gemini") ||
    normalized.includes("failed to execute opencode")
  );
}

type Params = {
  activeWorkspace: WorkspaceInfo | null;
  isCompact: boolean;
  activeEngine: EngineType;
  newAgentShortcut: string | null;
  setActiveEngine?: SetActiveEngine;
  addWorkspace: () => Promise<WorkspaceInfo | null>;
  addWorkspaceFromPath: (path: string) => Promise<WorkspaceInfo | null>;
  connectWorkspace: (workspace: WorkspaceInfo) => Promise<void>;
  startThreadForWorkspace: (
    workspaceId: string,
    options?: {
      engine?: EngineType;
      folderId?: string | null;
      providerProfileId?: string | null;
      providerProfile?: EngineProviderProfileSelection["providerProfile"];
    },
  ) => Promise<string | null>;
  setActiveThreadId: (threadId: string | null, workspaceId: string) => void;
  setActiveTab: (tab: "projects" | "codex" | "spec" | "git" | "log") => void;
  exitDiffView: () => void;
  selectWorkspace: (workspaceId: string) => void;
  openWorktreePrompt: (workspace: WorkspaceInfo) => void;
  openClonePrompt: (workspace: WorkspaceInfo) => void;
  composerInputRef: RefObject<HTMLTextAreaElement | null>;
  showLoadingProgressDialog: (config: LoadingProgressDialogConfig) => string;
  hideLoadingProgressDialog: (requestId: string) => void;
  onDebug: (entry: DebugEntry) => void;
};

export function useWorkspaceActions({
  activeWorkspace,
  isCompact,
  activeEngine,
  newAgentShortcut,
  setActiveEngine,
  addWorkspace: _addWorkspace,
  addWorkspaceFromPath,
  connectWorkspace,
  startThreadForWorkspace,
  setActiveThreadId,
  setActiveTab,
  exitDiffView,
  selectWorkspace,
  openWorktreePrompt,
  openClonePrompt,
  composerInputRef,
  showLoadingProgressDialog,
  hideLoadingProgressDialog,
  onDebug,
}: Params) {
  const { t } = useTranslation();

  const resolveWorkspaceDisplayName = useCallback((value: string) => {
    const segments = value
      .split(/[\\/]/)
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);
    return segments[segments.length - 1] ?? value;
  }, []);

  const resolveWorkspaceLabel = useCallback(
    (workspace: Pick<WorkspaceInfo, "name" | "path">) => {
      const trimmedName = workspace.name.trim();
      if (trimmedName.length > 0) {
        return trimmedName;
      }
      return resolveWorkspaceDisplayName(workspace.path);
    },
    [resolveWorkspaceDisplayName],
  );

  const resolveEngineLabel = useCallback(
    (engine: EngineType) => {
      switch (engine) {
        case "codex":
          return t("workspace.engineCodex");
        case "gemini":
          return t("workspace.engineGemini");
        case "grok":
          return t("workspace.engineGrok");
        case "kimi":
          return t("workspace.engineKimi");
        case "opencode":
          return t("workspace.engineOpenCode");
        case "claude":
        default:
          return t("workspace.engineClaudeCode");
      }
    },
    [t],
  );

  const localizeErrorMessage = useCallback(
    (message: string): string => {
      if (isCliNotFoundError(message)) {
        return `${t("errors.cliNotFound")}\n\n${t("errors.cliNotFoundHint")}`;
      }
      return message;
    },
    [t],
  );

  const localizeSessionCreationErrorMessage = useCallback(
    (message: string): string => {
      if (message.startsWith(ENGINE_SWITCH_FAILED_PREFIX)) {
        return t("errors.failedToCreateSession");
      }
      if (message.startsWith(CODEX_PROVIDER_CONFIG_INVALID_ERROR_PREFIX)) {
        return t("errors.codexProviderConfigInvalid");
      }
      if (message.startsWith(CODEX_PROVIDER_WIRE_API_UNSUPPORTED_ERROR_PREFIX)) {
        return t("errors.codexProviderWireApiUnsupported");
      }
      if (isRecoverableRuntimeCreateSessionError(message)) {
        return t("errors.failedToCreateSessionRuntimeRecovering");
      }
      return localizeErrorMessage(message);
    },
    [localizeErrorMessage, t],
  );

  const resolveSessionCreationErrorDetail = useCallback(
    (message: string): string => {
      if (message === SESSION_CREATION_EMPTY_THREAD_ID) {
        return t("errors.failedToCreateSessionNoThreadId");
      }
      return localizeSessionCreationErrorMessage(message);
    },
    [localizeSessionCreationErrorMessage, t],
  );

  const runCreateSessionFlow = useCallback(
    async (
      workspace: WorkspaceInfo,
      targetEngine: EngineType,
      options?: SessionCreationOptions,
    ) => {
      if (!isEngineExecutionEnabled(targetEngine)) {
        onDebug({
          id: `${Date.now()}-client-create-session-disabled-engine`,
          timestamp: Date.now(),
          source: "error",
          label: "workspace/create-session disabled engine",
          payload: {
            workspaceId: workspace.id,
            engine: targetEngine,
            error: "unsupported_engine",
          },
        });
        return null;
      }
      return await runWithLoadingProgress(
        { showLoadingProgressDialog, hideLoadingProgressDialog },
        {
          title: t("workspace.loadingProgressCreateSessionTitle"),
          message: t("workspace.loadingProgressCreateSessionMessage", {
            engine: resolveEngineLabel(targetEngine),
            workspace: resolveWorkspaceLabel(workspace),
          }),
        },
        async () => {
          exitDiffView();
          selectWorkspace(workspace.id);
          if (!workspace.connected) {
            await connectWorkspace(workspace);
          }
          if (setActiveEngine) {
            const providerProfileId =
              options?.providerProfileId?.trim() ||
              options?.providerProfile?.id?.trim() ||
              null;
            const activationPlan = resolveSessionEngineActivation(
              targetEngine,
              providerProfileId,
            );
            const engineActivated = activationPlan.options
              ? await setActiveEngine(targetEngine, activationPlan.options)
              : await setActiveEngine(targetEngine);
            if (activationPlan.requireSuccess && engineActivated === false) {
              throw new Error(`${ENGINE_SWITCH_FAILED_PREFIX}${targetEngine}`);
            }
          }
          const creationOptions = {
            engine: targetEngine,
            ...(options?.folderId ? { folderId: options.folderId } : {}),
            ...(options?.providerProfileId
              ? { providerProfileId: options.providerProfileId }
              : {}),
            ...(options?.providerProfile
              ? { providerProfile: options.providerProfile }
              : {}),
          };
          const threadId = await startThreadForWorkspace(workspace.id, creationOptions);
          if (!threadId) {
            throw new Error(SESSION_CREATION_EMPTY_THREAD_ID);
          }
          if (isCompact) {
            setActiveTab("codex");
          }
          setTimeout(() => composerInputRef.current?.focus(), 0);
          return threadId;
        },
      );
    },
    [
      composerInputRef,
      connectWorkspace,
      exitDiffView,
      hideLoadingProgressDialog,
      isCompact,
      onDebug,
      resolveEngineLabel,
      resolveWorkspaceLabel,
      selectWorkspace,
      setActiveEngine,
      setActiveTab,
      showLoadingProgressDialog,
      startThreadForWorkspace,
      t,
    ],
  );

  const retryCreateSessionAfterRuntimeRecovery = useCallback(
    async (workspace: WorkspaceInfo, targetEngine: EngineType) => {
      try {
        await ensureRuntimeReady(workspace.id);
        pushErrorToast({
          id: `${CREATE_SESSION_RECOVERY_PROGRESS_TOAST_ID_PREFIX}-${workspace.id}-${targetEngine}`,
          title: t("errors.runtimeRecovered"),
          message: t("errors.retryingCreateSessionAfterRecovery"),
          variant: "info",
          durationMs: 2600,
        });
        await runCreateSessionFlow(workspace, targetEngine);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(resolveSessionCreationErrorDetail(message));
      }
    },
    [resolveSessionCreationErrorDetail, runCreateSessionFlow, t],
  );

  const showRecoverableCreateSessionToast = useCallback(
    (
      workspace: WorkspaceInfo,
      targetEngine: EngineType,
      message: string,
      detailOverride?: string,
    ) => {
      const detail = detailOverride ?? localizeSessionCreationErrorMessage(message);
      pushGlobalRuntimeNotice({
        severity: "error",
        category: "workspace",
        messageKey: "runtimeNotice.error.createSessionRecoveryRequired",
        messageParams: {
          workspace: resolveWorkspaceLabel(workspace),
        },
        dedupeKey: `workspace:create-session-recovery:${workspace.id}:${targetEngine}`,
      });
      pushErrorToast({
        id: `${CREATE_SESSION_RECOVERY_TOAST_ID_PREFIX}-${workspace.id}-${targetEngine}`,
        title: t("errors.failedToCreateSession"),
        message: detail,
        sticky: true,
        actions: [
          {
            label: t("errors.reconnectAndRetryCreateSession"),
            pendingLabel: t("errors.reconnectingAndRetryingCreateSession"),
            run: async () => {
              onDebug({
                id: `${Date.now()}-client-create-session-recovery-toast-action`,
                timestamp: Date.now(),
                source: "client",
                label: "workspace/create-session recovery toast action",
                payload: {
                  workspaceId: workspace.id,
                  engine: targetEngine,
                },
              });
              await retryCreateSessionAfterRuntimeRecovery(workspace, targetEngine);
            },
          },
        ],
      });
    },
    [
      localizeSessionCreationErrorMessage,
      onDebug,
      resolveWorkspaceLabel,
      retryCreateSessionAfterRuntimeRecovery,
      t,
    ],
  );

  const showSessionCreationFailure = useCallback(
    (
      workspace: WorkspaceInfo,
      targetEngine: EngineType,
      detail: string,
    ) => {
      pushErrorToast({
        id: `${CREATE_SESSION_FAILURE_TOAST_ID_PREFIX}-${workspace.id}-${targetEngine}`,
        title: t("errors.failedToCreateSession"),
        message: detail,
        sticky: true,
      });
    },
    [t],
  );

  const handleWorkspaceAdded = useCallback(
    (workspace: WorkspaceInfo) => {
      setActiveThreadId(null, workspace.id);
      if (isCompact) {
        setActiveTab("codex");
      }
    },
    [isCompact, setActiveTab, setActiveThreadId],
  );

  const resolveWorkspaceOpenMode = useCallback(async (): Promise<WorkspaceOpenMode> => {
    const useCurrentWindow = await ask(t("workspace.addWorkspaceOpenModePrompt"), {
      title: t("workspace.addWorkspaceOpenModeTitle"),
      kind: "info",
      okLabel: t("workspace.addWorkspaceOpenCurrent"),
      cancelLabel: t("workspace.addWorkspaceOpenNewWindow"),
    });
    return useCurrentWindow ? "current-window" : "new-window";
  }, [t]);

  const handleOpenNewWindow = useCallback(
    async (path?: string | null) => {
      const projectName = path?.trim()
        ? resolveWorkspaceDisplayName(path)
        : t("workspace.projectInfo");
      try {
        await runWithLoadingProgress(
          { showLoadingProgressDialog, hideLoadingProgressDialog },
          {
            title: t("workspace.loadingProgressOpenProjectTitle"),
            message: t("workspace.loadingProgressOpenProjectMessage", {
              project: projectName,
            }),
          },
          () => openNewWindow(path),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onDebug({
          id: `${Date.now()}-client-open-new-window-error`,
          timestamp: Date.now(),
          source: "error",
          label: "workspace/open-new-window error",
          payload: message,
        });
        pushErrorToast({
          title: t("errors.failedToOpenNewWindow"),
          message: localizeErrorMessage(message),
        });
      }
    },
    [
      hideLoadingProgressDialog,
      localizeErrorMessage,
      onDebug,
      resolveWorkspaceDisplayName,
      showLoadingProgressDialog,
      t,
    ],
  );

  const handleAddWorkspaceFromPath = useCallback(
    async (path: string) => {
      try {
        await runWithLoadingProgress(
          { showLoadingProgressDialog, hideLoadingProgressDialog },
          {
            title: t("workspace.loadingProgressAddProjectTitle"),
            message: t("workspace.loadingProgressAddProjectMessage", {
              project: resolveWorkspaceDisplayName(path),
            }),
          },
          async () => {
            const workspace = await addWorkspaceFromPath(path);
            if (workspace) {
              handleWorkspaceAdded(workspace);
            }
          },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onDebug({
          id: `${Date.now()}-client-add-workspace-error`,
          timestamp: Date.now(),
          source: "error",
          label: "workspace/add error",
          payload: message,
        });
        pushErrorToast({
          title: t("errors.failedToAddWorkspace"),
          message: localizeErrorMessage(message),
        });
      }
    },
    [
      addWorkspaceFromPath,
      handleWorkspaceAdded,
      hideLoadingProgressDialog,
      localizeErrorMessage,
      onDebug,
      resolveWorkspaceDisplayName,
      showLoadingProgressDialog,
      t,
    ],
  );

  const handleAddWorkspace = useCallback(async () => {
    try {
      if (isWebServiceRuntime()) {
        const manualPath = window.prompt(
          t("workspace.addWorkspaceRemotePathPrompt"),
          "",
        );
        const path = manualPath?.trim() ?? "";
        if (!path) {
          return;
        }
        await handleAddWorkspaceFromPath(path);
        return;
      }
      const path = await pickWorkspacePath();
      if (!path) {
        return;
      }
      const mode = await resolveWorkspaceOpenMode();
      if (mode === "new-window") {
        await handleOpenNewWindow(path);
        return;
      }
      await handleAddWorkspaceFromPath(path);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onDebug({
        id: `${Date.now()}-client-add-workspace-error`,
        timestamp: Date.now(),
        source: "error",
        label: "workspace/add error",
        payload: message,
      });
      pushErrorToast({
        title: t("errors.failedToAddWorkspace"),
        message: localizeErrorMessage(message),
      });
    }
  }, [
    handleAddWorkspaceFromPath,
    handleOpenNewWindow,
    localizeErrorMessage,
    onDebug,
    resolveWorkspaceOpenMode,
    t,
  ]);

  const handleAddAgent = useCallback(
    async (
      workspace: WorkspaceInfo,
      engine?: EngineType,
      options?: SessionCreationOptions,
    ) => {
      const targetEngine = engine ?? activeEngine;
      try {
        return await runCreateSessionFlow(workspace, targetEngine, options);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const shouldAttemptDiskRecovery =
          targetEngine === "codex" &&
          isDiskProviderSelection(options) &&
          isRecoverableRuntimeCreateSessionError(message);
        const shouldShowDiskReadinessRecovery =
          targetEngine === "codex" &&
          isDiskProviderSelection(options) &&
          isDiskCodexReadinessRecoveryError(message);
        if (shouldAttemptDiskRecovery) {
          onDebug({
            id: `${Date.now()}-client-create-session-disk-auto-recovery`,
            timestamp: Date.now(),
            source: "client",
            label: "workspace/create-session disk auto recovery",
            payload: {
              workspaceId: workspace.id,
              engine: targetEngine,
              error: message,
            },
          });
          try {
            await ensureRuntimeReady(workspace.id);
            return await runCreateSessionFlow(workspace, targetEngine, options);
          } catch (retryError) {
            const retryMessage =
              retryError instanceof Error ? retryError.message : String(retryError);
            if (isRecoverableRuntimeCreateSessionError(retryMessage)) {
              onDebug({
                id: `${Date.now()}-client-create-session-recovery-toast`,
                timestamp: Date.now(),
                source: "client",
                label: "workspace/create-session recovery toast",
                payload: {
                  workspaceId: workspace.id,
                  engine: targetEngine,
                  error: retryMessage,
                },
              });
              showRecoverableCreateSessionToast(workspace, targetEngine, retryMessage);
              return null;
            }
            const detail = resolveSessionCreationErrorDetail(retryMessage);
            onDebug({
              id: `${Date.now()}-client-create-session-error`,
              timestamp: Date.now(),
              source: "error",
              label: "workspace/create-session error",
              payload: {
                workspaceId: workspace.id,
                engine: targetEngine,
                error: retryMessage,
              },
            });
            showSessionCreationFailure(
              workspace,
              targetEngine,
              detail,
            );
            return null;
          }
        }
        if (shouldShowDiskReadinessRecovery) {
          onDebug({
            id: `${Date.now()}-client-create-session-disk-readiness-recovery-toast`,
            timestamp: Date.now(),
            source: "client",
            label: "workspace/create-session disk readiness recovery toast",
            payload: {
              workspaceId: workspace.id,
              engine: targetEngine,
              error: message,
            },
          });
          showRecoverableCreateSessionToast(
            workspace,
            targetEngine,
            message,
            t("errors.failedToCreateSessionRuntimeRecovering"),
          );
          return null;
        }
        if (isRecoverableRuntimeCreateSessionError(message)) {
          onDebug({
            id: `${Date.now()}-client-create-session-recovery-toast`,
            timestamp: Date.now(),
            source: "client",
            label: "workspace/create-session recovery toast",
            payload: {
              workspaceId: workspace.id,
              engine: targetEngine,
              error: message,
            },
          });
          showRecoverableCreateSessionToast(workspace, targetEngine, message);
          return null;
        }
        const detail = resolveSessionCreationErrorDetail(message);
        onDebug({
          id: `${Date.now()}-client-create-session-error`,
          timestamp: Date.now(),
          source: "error",
          label: "workspace/create-session error",
          payload: {
            workspaceId: workspace.id,
            engine: targetEngine,
            error: message,
          },
        });
        showSessionCreationFailure(workspace, targetEngine, detail);
        return null;
      }
    },
    [
      activeEngine,
      onDebug,
      resolveSessionCreationErrorDetail,
      runCreateSessionFlow,
      showRecoverableCreateSessionToast,
      showSessionCreationFailure,
      t,
    ],
  );

  const handleAddWorktreeAgent = useCallback(
    async (workspace: WorkspaceInfo) => {
      exitDiffView();
      openWorktreePrompt(workspace);
    },
    [exitDiffView, openWorktreePrompt],
  );

  const handleAddCloneAgent = useCallback(
    async (workspace: WorkspaceInfo) => {
      exitDiffView();
      openClonePrompt(workspace);
    },
    [exitDiffView, openClonePrompt],
  );

  useNewAgentShortcut({
    isEnabled: Boolean(activeWorkspace),
    shortcut: newAgentShortcut,
    onTrigger: () => {
      if (activeWorkspace) {
        void handleAddAgent(activeWorkspace);
      }
    },
  });

  return {
    handleAddWorkspace,
    handleOpenNewWindow,
    handleAddWorkspaceFromPath,
    handleAddAgent,
    handleAddWorktreeAgent,
    handleAddCloneAgent,
  };
}
