import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEventCallback } from "../utils/useEventCallback";
import { ask } from "@tauri-apps/plugin-dialog";
import { useLayoutNodes } from "../features/layout/hooks/useLayoutNodes";
import { useMainHeaderActionItems } from "../features/app/components/MainHeaderActions";
import { WorkspaceAliasPrompt } from "../features/workspaces/components/WorkspaceAliasPrompt";
import { useClientUiVisibility } from "../features/client-ui-visibility/hooks/useClientUiVisibility";
import { useProjectMapDataset } from "../features/project-map/hooks/useProjectMapDataset";
import {
  buildIntentCanvasContextAttachment,
  formatIntentCanvasThreadContext,
} from "../features/intent-canvas/utils/context";
import type {
  IntentCanvasCodeSelectionAnchor,
  IntentCanvasDocument,
  IntentCanvasOpenRequest,
} from "../features/intent-canvas/types";
import { normalizeSharedSessionEngine } from "../features/shared-session/utils/sharedSessionEngines";
import {
  recoverThreadBindingAndResendForManualRecovery,
  recoverThreadBindingForManualRecovery,
} from "./manualThreadRecovery";
import { OPENCODE_VARIANT_OPTIONS } from "./utils";
import type { CodexProviderProfileSelection } from "../features/threads/constants/codexProviderProfiles";
import type {
  WorkspaceInfo,
  QueuedMessage,
  GitHubPullRequest,
  GitLogEntry,
} from "../types";
import {
  archiveWorkspaceSessions,
  clearDetachedExternalChangeMonitor,
  configureDetachedExternalChangeMonitor,
} from "../services/tauri";
import { openOrFocusBrowserAgentDockWindow } from "../features/browser-agent/browserAgentDockWindow";
import {
  setPluginPreviewTarget,
  subscribePluginHtmlPreviewRequests,
  type PluginHtmlPreviewRequest,
} from "../features/plugins/pluginPreviewBus";
import { shouldEnableMainFileExternalChangeMonitoring } from "./fileExternalMonitoring";
import {
  getThreadSelectDiffCleanupAction,
  shouldPreserveEditorOnThreadSelect,
} from "./threadEditorPreservation";
import {
  flattenSelectedAppShellDomainContexts,
  type AppShellDomainContextName,
  type AppShellDomainContexts,
} from "./appShellDomainContexts";

type AppShellLayoutNodesContext = Record<string, any>;

export type AppShellLayoutNodesSectionInput = {
  appShellDomainContexts: AppShellDomainContexts;
  searchAndComposerSection: Record<string, any>;
  sections: Record<string, any>;
  isPullRequestComposer: any;
  isPullRequestComposerFromSections: any;
};

type WorkspaceAliasPromptState = {
  workspaceId: string;
  workspaceName: string;
  alias: string;
  originalAlias: string;
  error: string | null;
  isSaving: boolean;
};

const APP_SHELL_LAYOUT_NODES_DOMAIN_NAMES = [
  "workspaceNavigationContext",
  "composerContext",
  "layoutContext",
  "fileEditorContext",
  "settingsContext",
  "runtimeContext",
  "modelSelectionContext",
  "collaborationModeContext",
] as const satisfies readonly AppShellDomainContextName[];

// Stable empty-array sentinel so optional `string[]` fallbacks keep a constant
// reference across renders (avoids defeating downstream React.memo shields).
const EMPTY_STRING_ARRAY: string[] = [];
Object.freeze(EMPTY_STRING_ARRAY);

function formatWorkspaceAliasError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function reportMainFileExternalChangeMonitorCleanupError(error: unknown) {
  console.warn(
    "[files] Failed to clear main file external change monitor",
    error,
  );
}

function resolveProjectMapSelectedGenerationModel(
  selectedModelId: string | null,
  models: any[],
): string | null {
  const trimmedSelection = selectedModelId?.trim() ?? "";
  if (!trimmedSelection) {
    return null;
  }
  const matchedModel = models?.find(
    (model) =>
      model.id === trimmedSelection || model.model === trimmedSelection,
  );
  return matchedModel?.model ?? trimmedSelection;
}

function flattenAppShellLayoutNodesContext(
  input: AppShellLayoutNodesSectionInput,
): AppShellLayoutNodesContext {
  return {
    ...flattenSelectedAppShellDomainContexts(
      input.appShellDomainContexts,
      APP_SHELL_LAYOUT_NODES_DOMAIN_NAMES,
    ),
    ...input.searchAndComposerSection,
    ...input.sections,
    isPullRequestComposer: input.isPullRequestComposer,
    isPullRequestComposerFromSections: input.isPullRequestComposerFromSections,
    sections: input.sections,
  };
}

export function useAppShellLayoutNodesSection(
  input: AppShellLayoutNodesSectionInput,
) {
  const ctx = flattenAppShellLayoutNodesContext(input);
  const runtimeRunState = input.appShellDomainContexts.runtimeContext
    .runtimeRunState as any;
  const clientUiVisibility = useClientUiVisibility();
  const [workspaceAliasPrompt, setWorkspaceAliasPrompt] =
    useState<WorkspaceAliasPromptState | null>(null);
  const [
    mainFileExternalChangeTransportMode,
    setMainFileExternalChangeTransportMode,
  ] = useState<"watcher" | "polling">("polling");
  const [focusedProjectMemoryId, setFocusedProjectMemoryId] = useState<
    string | null
  >(null);
  const [focusedProjectMemoryRequestKey, setFocusedProjectMemoryRequestKey] =
    useState(0);
  const [focusedWorkspaceNoteId, setFocusedWorkspaceNoteId] = useState<
    string | null
  >(null);
  const [focusedWorkspaceNoteRequestKey, setFocusedWorkspaceNoteRequestKey] =
    useState(0);
  const [intentCanvasOpenRequest, setIntentCanvasOpenRequest] =
    useState<IntentCanvasOpenRequest | null>(null);
  const [
    activeIntentCanvasCodeSelectionAnchor,
    setActiveIntentCanvasCodeSelectionAnchor,
  ] = useState<IntentCanvasCodeSelectionAnchor | null>(null);
  const intentCanvasOpenRequestSequenceRef = useRef(0);
  const [pendingIntentCanvasByThreadId, setPendingIntentCanvasByThreadId] =
    useState<Record<string, IntentCanvasDocument[]>>({});
  const {
    accessMode,
    accountSwitching,
    activeAccount,
    activeDiffError,
    activeDiffLoading,
    activeDiffs,
    activeEditorFilePath,
    activeEditorLineRange,
    activeEngine,
    activeFusingMessageId,
    fileCompareSession,
    activeGitRoot,
    activeImages,
    activeItems,
    activeParentWorkspace,
    activePlan,
    activeQueue,
    activeQueuedHandoffBubble,
    activeRateLimits,
    activeTab,
    agentTaskScrollRequest,
    activeTerminalId,
    activeThreadId,
    activeTokenUsage,
    activeWorkspace,
    activeWorkspaceId,
    addDebugEntry,
    alertError,
    appMode,
    appSettings,
    applySelectedCollaborationMode,
    approvals,
    attachImages,
    branches,
    canFuseActiveQueue,
    canInterrupt,
    centerMode,
    choosePreset,
    claudeThinkingVisible,
    clearDebugEntries,
    clearDictationError,
    clearDictationHint,
    clearDictationTranscript,
    closePlanPanel,
    closeReviewPrompt,
    closeSettings,
    collaborationModes,
    collaborationModesEnabled,
    collapseSidebar,
    commands,
    commitError,
    commitLoading,
    commitMessage,
    commitMessageError,
    commitMessageLoading,
    completionEmailIntentByThread,
    composerEditorSettings,
    composerInputRef,
    composerInsert,
    composerKanbanContextMode,
    composerLinkedKanbanPanels,
    composerSendLabel,
    confirmBranch,
    confirmCommit,
    confirmCustom,
    connectWorkspace,
    debugEntries,
    debugOpen,
    deleteThreadPrompt,
    deletingWorktreeIds,
    dictationError,
    dictationHint,
    dictationLevel,
    dictationReady,
    dictationState,
    dictationTranscript,
    diffScrollRequestId,
    diffSource,
    directories,
    directoryMetadata,
    dismissErrorToast,
    dismissUpdate,
    dropOverlayActive,
    dropOverlayText,
    editorHighlightTarget,
    editorNavigationTarget,
    editorSplitCompanion,
    editorSplitLayout,
    effectiveModels,
    effectiveReasoningSupported,
    effectiveSelectedModelId,
    providerModelCatalogs,
    ensureWorkspaceThreadListLoaded,
    errorToasts,
    exitDiffView,
    expandRightPanel,
    filePanelMode,
    fileReferenceMode,
    fileStatus,
    fileTreeLoadError,
    fileTreeSourceVersion,
    files,
    forkThreadForWorkspace,
    forkSessionFromMessageForWorkspace,
    getPinTimestamp,
    gitDiffListView,
    gitDiffViewStyle,
    gitIssues,
    gitIssuesError,
    gitIssuesLoading,
    gitIssuesTotal,
    gitLogAhead,
    gitLogAheadEntries,
    gitLogBehind,
    gitLogBehindEntries,
    gitLogEntries,
    gitLogError,
    gitLogLoading,
    gitLogTotal,
    gitLogUpstream,
    gitPanelMode,
    gitPullRequestComments,
    gitPullRequestCommentsError,
    gitPullRequestCommentsLoading,
    gitPullRequests,
    gitPullRequestsError,
    gitPullRequestsLoading,
    gitPullRequestsTotal,
    gitRemoteUrl,
    gitRootCandidates,
    gitRootScanDepth,
    gitRootScanError,
    gitRootScanHasScanned,
    gitRootScanLoading,
    gitStatus,
    gitignoredDirectories,
    gitignoredFiles,
    groupedWorkspaces,
    handleActivateWorkspaceFileTab,
    handleActiveDiffPath,
    handleAddAgent,
    handleAddCloneAgent,
    handleAddWorkspace,
    handleAddWorktreeAgent,
    handleAppModeChange,
    handleApplyWorktreeChanges,
    handleApprovalBatchAccept,
    handleApprovalDecision,
    handleApprovalRemember,
    handleCancelSwitchAccount,
    handleCheckoutBranch,
    handleCloseAllWorkspaceFileTabs,
    handleCloseWorkspaceFileTab,
    handleCommit,
    handleCommitAndPush,
    handleCommitAndSync,
    handleCommitMessageChange,
    handleComposerQueueWithEditorFallback,
    handleComposerSendWithEditorFallback,
    handleCopyDebug,
    handleCopyThread,
    handleCreateBranch,
    handleCreatePrompt,
    handleDebugClick,
    handleDeletePrompt,
    handleDeleteQueued,
    handleDeleteThreadPromptCancel,
    handleDeleteThreadPromptConfirm,
    handleDraftChange,
    handleEditQueued,
    handleExitWorkspaceEditor,
    handleGenerateCommitMessage,
    handleGitPanelModeChange,
    handleInsertComposerText,
    handleDispatchOrchestrationTask,
    handleLockPanel,
    handleMovePrompt,
    handleOpenComposerKanbanPanel,
    handleOpenDetachedFileExplorer,
    handleOpenWorkspaceFileCompare,
    handleOpenScratchFileCompare,
    handleCloseFileCompare,
    handleOpenHomeChat,
    handleOpenModelSettings,
    handleRefreshModelConfig,
    handleOpenSearchPalette,
    handleOpenSpecHub,
    handleOpenClientDocumentation,
    handleResolvedClaudeThinkingVisibleChange,
    handleOpenWorkspaceFile,
    handleOpenWorkspaceHome,
    handlePickGitRoot,
    handlePush,
    handleRefreshAccountRateLimits,
    handleRenameThread,
    handleRevealGeneralPrompts,
    handleRevealWorkspacePrompts,
    handleRevertAllGitChanges,
    handleRevertGitFile,
    handleReviewPromptKeyDown,
    handleRewindFromMessage,
    handleSelectAgent,
    handleSelectCommit,
    handleSelectDiffForPanel,
    handleSelectHomeWorkspace,
    handleSelectModel,
    handleSelectOpenAppId,
    handleSelectOpenCodeAgent,
    handleSelectOpenCodeVariant,
    handleSelectPullRequest,
    handleSelectWorkspaceInstance,
    handleSendPrompt,
    handleSendPromptToNewAgent,
    handleSelectStatusPanelSubagent,
    handleSetAccessMode,
    handleSetGitRoot,
    handleStageGitAll,
    handleStageGitFile,
    handleStartSharedConversation,
    handleSwitchAccount,
    handleFuseQueued,
    handleSync,
    handleToggleDictation,
    handleToggleRuntimeConsole,
    handleToggleTerminalPanel,
    handleUnstageGitFile,
    handleUpdatePrompt,
    handleUserInputDismiss,
    handleUserInputSubmitWithPlanApply,
    handleExitPlanModeExecute,
    handleWorkspaceDragEnter,
    handleWorkspaceDragLeave,
    handleWorkspaceDragOver,
    handleWorkspaceDrop,
    highlightedBranchIndex,
    highlightedCommitIndex,
    highlightedPresetIndex,
    availableEngines,
    hydratedThreadListWorkspaceIdsRef,
    interruptTurn,
    isCompact,
    isDeleteThreadPromptBusy,
    isEditorFileMaximized,
    isFilesLoading,
    isLoadingLatestAgents,
    isModelConfigRefreshing,
    isPhone,
    isPlanMode,
    isPlanPanelDismissed,
    isProcessing,
    isReviewing,
    isSoloMode,
    isTablet,
    isThreadAutoNaming,
    isThreadPinned,
    isWorktreeWorkspace,
    latestAgentRuns,
    launchScriptState,
    launchScriptsState,
    listThreadsForWorkspaceTracked,
    liveEditPreviewEnabled,
    loadOlderThreadsForWorkspace,
    handleOpenClaudeTui,
    onCloseTerminal,
    onDebugPanelResizeStart,
    onNewTerminal,
    onSelectTerminal,
    onTerminalPanelResizeStart,
    onTextareaHeightChange,
    openAppIconById,
    openCodeAgents,
    openDeleteThreadPrompt,
    openFileTabs,
    openPlanPanel,
    openReleaseNotes,
    openSettings,
    pickImages,
    pinThread,
    pinnedThreadsVersion,
    prefillDraft,
    prompts,
    pushError,
    pushLoading,
    queueGitStatusRefresh,
    queueSaveSettings,
    reasoningOptions,
    refreshEngines,
    refreshFiles,
    refreshGitDiffs,
    refreshThread,
    removeImage,
    removeWorkspace,
    removeWorktree,
    resetPullRequestSelection,
    reviewPrompt,
    rightPanelCollapsed,
    scanGitRoots,
    selectBranch,
    selectBranchAtIndex,
    selectCommit,
    selectCommitAtIndex,
    selectWorkspace,
    selectedAgent,
    selectedCollaborationModeId,
    selectedCommitSha,
    selectedComposerKanbanPanelId,
    selectedDiffPath,
    selectedEffort,
    selectedOpenCodeAgent,
    selectedOpenCodeVariant,
    selectedPullRequest,
    sendUserMessageToThread,
    setActiveEditorLineRange,
    setActiveEngine,
    setActiveTab,
    setActiveThreadId,
    setActiveWorkspaceId,
    setAppMode,
    setCenterMode,
    setComposerInsert,
    setComposerKanbanContextMode,
    setEditorSplitCompanion,
    setEditorSplitLayout,
    setFilePanelMode,
    setFileReferenceMode,
    setGitDiffListView,
    setGitDiffViewStyle,
    setGitRootScanDepth,
    setHighlightedBranchIndex,
    setHighlightedCommitIndex,
    setHighlightedPresetIndex,
    setIsEditorFileMaximized,
    setLiveEditPreviewEnabled,
    setPrefillDraft,
    setSelectedCommitSha,
    setSelectedComposerKanbanPanelId,
    setSelectedDiffPath,
    setSelectedEffort,
    setHomeOpen,
    setWorkspaceHomeWorkspaceId,
    showComposer,
    showLoadingProgressDialog,
    hideLoadingProgressDialog,
    showDebugButton,
    showPresetStep,
    sidebarToggleProps,
    skills,
    soloModeEnabled,
    startCompact,
    startFork,
    startThreadForWorkspace,
    startUpdate,
    syncError,
    syncLoading,
    t,
    tabletTab,
    terminalOpen,
    terminalState,
    terminalTabs,
    textareaHeight,
    threadItemsByThread,
    threadListCursorByWorkspace,
    threadListLoadingByWorkspace,
    threadListPagingByWorkspace,
    threadParentById,
    threadStatusById,
    historyLoadingByThreadId,
    historyRestoredAtMsByThread,
    threadsByWorkspace,
    toggleCompletionEmailIntent,
    toggleSoloMode,
    triggerAutoThreadTitle,
    unpinThread,
    updateCustomInstructions,
    updateSharedSessionEngineSelection,
    updateThreadParent,
    updateWorkspaceSettings,
    updaterState,
    userInputRequests,
    workspaceDropTargetRef,
    workspaceGroups,
    workspaces,
    workspacesById,
    worktreeApplyError,
    worktreeApplyLoading,
    worktreeApplySuccess,
    worktreeLabel,
    worktreeRename,
    sessionRadarRunningSessions,
    sessionRadarRecentCompletedSessions,
    runningSessionCountByWorkspaceId,
    recentCompletedSessionCountByWorkspaceId,
  } = ctx;
  const pendingIntentCanvasDocuments = useMemo(
    () =>
      activeThreadId
        ? (pendingIntentCanvasByThreadId[activeThreadId] ?? [])
        : [],
    [activeThreadId, pendingIntentCanvasByThreadId],
  );

  const appendPendingIntentCanvasContext = useCallback(
    (text: string, documents: IntentCanvasDocument[]) => {
      if (documents.length === 0) {
        return text;
      }
      return [
        text.trim(),
        ...documents.map((document) =>
          formatIntentCanvasThreadContext(document, activeWorkspace?.name),
        ),
      ]
        .filter(Boolean)
        .join("\n\n");
    },
    [activeWorkspace?.name],
  );

  const appendPendingIntentCanvasSendOptions = useCallback(
    (documents: IntentCanvasDocument[], options?: any) => {
      if (documents.length === 0) {
        return options;
      }
      const attachments = documents.map((document) =>
        buildIntentCanvasContextAttachment(document, activeWorkspace?.name),
      );
      return {
        ...(options ?? {}),
        intentCanvasContextAttachments: [
          ...(Array.isArray(options?.intentCanvasContextAttachments)
            ? options.intentCanvasContextAttachments
            : []),
          ...attachments,
        ],
      };
    },
    [activeWorkspace?.name],
  );

  const clearPendingIntentCanvasForThread = useCallback(
    (targetThreadId: string) => {
      setPendingIntentCanvasByThreadId((current) => {
        if (!current[targetThreadId]?.length) {
          return current;
        }
        const next = { ...current };
        delete next[targetThreadId];
        return next;
      });
    },
    [],
  );

  const handleRemovePendingIntentCanvas = useCallback(
    (documentId: string) => {
      if (!activeThreadId) {
        return;
      }
      setPendingIntentCanvasByThreadId((current) => {
        const currentDocuments = current[activeThreadId] ?? [];
        const nextDocuments = currentDocuments.filter(
          (document) => document.id !== documentId,
        );
        if (nextDocuments.length === currentDocuments.length) {
          return current;
        }
        if (nextDocuments.length === 0) {
          const next = { ...current };
          delete next[activeThreadId];
          return next;
        }
        return {
          ...current,
          [activeThreadId]: nextDocuments,
        };
      });
    },
    [activeThreadId],
  );

  const handleComposerSendWithIntentCanvas = useCallback(
    async (text: string, images: string[], options?: any) => {
      const stagedDocuments = pendingIntentCanvasDocuments;
      const nextText = appendPendingIntentCanvasContext(text, stagedDocuments);
      const nextOptions = appendPendingIntentCanvasSendOptions(
        stagedDocuments,
        options,
      );
      await handleComposerSendWithEditorFallback(nextText, images, nextOptions);
      if (activeThreadId && stagedDocuments.length > 0) {
        clearPendingIntentCanvasForThread(activeThreadId);
      }
    },
    [
      activeThreadId,
      appendPendingIntentCanvasContext,
      appendPendingIntentCanvasSendOptions,
      clearPendingIntentCanvasForThread,
      handleComposerSendWithEditorFallback,
      pendingIntentCanvasDocuments,
    ],
  );

  const handleComposerQueueWithIntentCanvas = useCallback(
    async (text: string, images: string[], options?: any) => {
      const stagedDocuments = pendingIntentCanvasDocuments;
      const nextText = appendPendingIntentCanvasContext(text, stagedDocuments);
      const nextOptions = appendPendingIntentCanvasSendOptions(
        stagedDocuments,
        options,
      );
      await handleComposerQueueWithEditorFallback(
        nextText,
        images,
        nextOptions,
      );
      if (activeThreadId && stagedDocuments.length > 0) {
        clearPendingIntentCanvasForThread(activeThreadId);
      }
    },
    [
      activeThreadId,
      appendPendingIntentCanvasContext,
      appendPendingIntentCanvasSendOptions,
      clearPendingIntentCanvasForThread,
      handleComposerQueueWithEditorFallback,
      pendingIntentCanvasDocuments,
    ],
  );

  const handleSelectConversationEngine = useCallback(
    async (engine: "claude" | "codex" | "gemini" | "opencode") => {
      const thread =
        activeWorkspaceId && activeThreadId
          ? (threadsByWorkspace[activeWorkspaceId] ?? []).find(
              (entry: any) => entry.id === activeThreadId,
            )
          : null;
      const nextEngine =
        thread?.threadKind === "shared"
          ? normalizeSharedSessionEngine(engine)
          : engine;
      await setActiveEngine(nextEngine);
      if (!activeWorkspaceId || !activeThreadId) {
        return;
      }
      if (thread?.threadKind === "shared") {
        updateSharedSessionEngineSelection(
          activeWorkspaceId,
          activeThreadId,
          nextEngine,
        );
      }
    },
    [
      activeThreadId,
      activeWorkspaceId,
      setActiveEngine,
      threadsByWorkspace,
      updateSharedSessionEngineSelection,
    ],
  );
  const mainFileExternalChangeAwarenessEnabled =
    appSettings.detachedExternalChangeAwarenessEnabled !== false;
  const mainFileExternalChangeWatcherEnabled =
    appSettings.detachedExternalChangeWatcherEnabled !== false;
  const projectMapGenerationModel = useMemo(
    () =>
      resolveProjectMapSelectedGenerationModel(
        effectiveSelectedModelId,
        effectiveModels,
      ),
    [effectiveModels, effectiveSelectedModelId],
  );
  const isProjectMapDatasetEnabled =
    centerMode === "projectMap" ||
    (centerMode === "editor" && editorSplitCompanion === "projectMap");
  const projectMapDatasetController = useProjectMapDataset(
    activeWorkspace ?? null,
    {
      enabled: isProjectMapDatasetEnabled,
      generationDefaults: {
        engine: activeEngine ?? null,
        model: projectMapGenerationModel,
      },
    },
  );
  const activeWorkspaceExternalChangeId =
    activeWorkspace?.id ?? activeWorkspaceId ?? null;
  const activeWorkspaceExternalChangePath = activeWorkspace?.path ?? null;
  const enableMainFileExternalChangeMonitoring =
    mainFileExternalChangeAwarenessEnabled &&
    shouldEnableMainFileExternalChangeMonitoring({
      activeWorkspace,
      activeEditorFilePath,
    });

  useEffect(() => {
    if (
      !enableMainFileExternalChangeMonitoring ||
      !activeWorkspaceExternalChangeId ||
      !activeWorkspaceExternalChangePath ||
      !activeEditorFilePath
    ) {
      setMainFileExternalChangeTransportMode("polling");
      if (activeWorkspaceExternalChangeId) {
        void clearDetachedExternalChangeMonitor(
          activeWorkspaceExternalChangeId,
        ).catch(reportMainFileExternalChangeMonitorCleanupError);
      }
      return;
    }

    let active = true;
    setMainFileExternalChangeTransportMode("watcher");
    void configureDetachedExternalChangeMonitor(
      activeWorkspaceExternalChangeId,
      activeWorkspaceExternalChangePath,
      activeEditorFilePath,
      mainFileExternalChangeWatcherEnabled,
    )
      .then(() => {
        if (!active) {
          return;
        }
        setMainFileExternalChangeTransportMode("watcher");
      })
      .catch(() => {
        if (!active) {
          return;
        }
        setMainFileExternalChangeTransportMode("polling");
      });

    return () => {
      active = false;
      void clearDetachedExternalChangeMonitor(
        activeWorkspaceExternalChangeId,
      ).catch(reportMainFileExternalChangeMonitorCleanupError);
    };
  }, [
    activeEditorFilePath,
    activeWorkspaceExternalChangeId,
    activeWorkspaceExternalChangePath,
    enableMainFileExternalChangeMonitoring,
    mainFileExternalChangeWatcherEnabled,
  ]);
  const handleRenameWorkspaceAlias = useCallback((workspace: WorkspaceInfo) => {
    const currentAlias =
      typeof workspace?.settings?.projectAlias === "string"
        ? workspace.settings.projectAlias
        : "";
    setWorkspaceAliasPrompt({
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      alias: currentAlias,
      originalAlias: currentAlias.trim(),
      error: null,
      isSaving: false,
    });
  }, []);
  const handleWorkspaceAliasPromptChange = useCallback((alias: string) => {
    setWorkspaceAliasPrompt((prev) =>
      prev
        ? {
            ...prev,
            alias,
            error: null,
          }
        : prev,
    );
  }, []);
  const handleWorkspaceAliasPromptCancel = useCallback(() => {
    setWorkspaceAliasPrompt((prev) => (prev?.isSaving ? prev : null));
  }, []);
  const handleWorkspaceAliasPromptConfirm = useCallback(async () => {
    if (!workspaceAliasPrompt || workspaceAliasPrompt.isSaving) {
      return;
    }
    const nextAlias = workspaceAliasPrompt.alias.trim();
    if (nextAlias === workspaceAliasPrompt.originalAlias) {
      setWorkspaceAliasPrompt(null);
      return;
    }
    setWorkspaceAliasPrompt((prev) =>
      prev
        ? {
            ...prev,
            error: null,
            isSaving: true,
          }
        : prev,
    );
    try {
      await updateWorkspaceSettings(workspaceAliasPrompt.workspaceId, {
        projectAlias: nextAlias || null,
      });
      setWorkspaceAliasPrompt(null);
    } catch (error) {
      const message = formatWorkspaceAliasError(error);
      setWorkspaceAliasPrompt((prev) =>
        prev && prev.workspaceId === workspaceAliasPrompt.workspaceId
          ? {
              ...prev,
              error: message,
              isSaving: false,
            }
          : prev,
      );
      alertError(error);
    }
  }, [alertError, updateWorkspaceSettings, workspaceAliasPrompt]);
  const workspaceAliasPromptNode = workspaceAliasPrompt ? (
    <WorkspaceAliasPrompt
      workspaceName={workspaceAliasPrompt.workspaceName}
      alias={workspaceAliasPrompt.alias}
      error={workspaceAliasPrompt.error}
      isBusy={workspaceAliasPrompt.isSaving}
      onChange={handleWorkspaceAliasPromptChange}
      onCancel={handleWorkspaceAliasPromptCancel}
      onConfirm={() => {
        void handleWorkspaceAliasPromptConfirm();
      }}
    />
  ) : null;
  const mainHeaderSidebarToggleProps = {
    ...sidebarToggleProps,
    rightPanelAvailable:
      sidebarToggleProps.rightPanelAvailable &&
      clientUiVisibility.isControlVisible("topTool.rightPanel"),
  };
  const browserDockOpen = false;
  const handleToggleBrowserDock = useCallback(() => {
    void openOrFocusBrowserAgentDockWindow({
      workspaceId: activeWorkspaceId,
      workspaceName: activeWorkspace?.name ?? null,
    }).catch((error) => {
      alertError(error instanceof Error ? error.message : String(error));
    });
  }, [activeWorkspace?.name, activeWorkspaceId, alertError]);

  const mainHeaderActions = useMainHeaderActionItems({
    isCompact,
    rightPanelCollapsed,
    sidebarToggleProps: mainHeaderSidebarToggleProps,
    showRuntimeConsoleButton:
      !isCompact && clientUiVisibility.isControlVisible("topTool.runtimeConsole"),
    isRuntimeConsoleVisible: runtimeRunState.runtimeConsoleVisible,
    onToggleRuntimeConsole: handleToggleRuntimeConsole,
    showTerminalButton:
      !isCompact && clientUiVisibility.isControlVisible("topTool.terminal"),
    isTerminalOpen: terminalOpen,
    onToggleTerminal: handleToggleTerminalPanel,
    showSoloButton:
      soloModeEnabled && clientUiVisibility.isControlVisible("topTool.focus"),
    isSoloMode,
    onToggleSoloMode: toggleSoloMode,
    isBrowserDockOpen: browserDockOpen,
    onToggleBrowserDock: clientUiVisibility.isControlVisible("topTool.browserDock")
      ? handleToggleBrowserDock
      : undefined,
    showClientDocumentationButton:
      !isCompact &&
      clientUiVisibility.isControlVisible("topTool.clientDocumentation"),
    onOpenClientDocumentation: handleOpenClientDocumentation,
    showFileCompareButton: !isCompact,
    isFileCompareActive: centerMode === "fileCompare",
    onOpenFileCompare: handleOpenScratchFileCompare,
  });
  const handleCloseBrowserDock = useCallback(() => {
    // Browser Agent now lives in its own tool window.
  }, []);

  const handleOpenIntentCanvas = useCallback(
    (request?: Omit<IntentCanvasOpenRequest, "requestId">) => {
      if (!activeWorkspace) {
        alertError(t("intentCanvas.errors.noWorkspace"));
        return;
      }
      closeSettings();
      collapseSidebar();
      setAppMode("chat");
      setCenterMode("intentCanvas");
      expandRightPanel();
      if (!request) {
        setIntentCanvasOpenRequest(null);
        return;
      }
      const nextRequestId = intentCanvasOpenRequestSequenceRef.current + 1;
      intentCanvasOpenRequestSequenceRef.current = nextRequestId;
      setIntentCanvasOpenRequest({
        requestId: nextRequestId,
        mode: request.mode,
        target: request.target ?? null,
        canvasId: request.canvasId ?? null,
        title: request.title ?? null,
        summary: request.summary ?? null,
        source: request.source ?? null,
        seedSemanticGraphs: request.seedSemanticGraphs,
      });
    },
    [
      activeWorkspace,
      alertError,
      closeSettings,
      collapseSidebar,
      expandRightPanel,
      setAppMode,
      setCenterMode,
      t,
    ],
  );

  const handleIntentCanvasOpenRequestConsumed = useCallback(
    (requestId: number) => {
      setIntentCanvasOpenRequest((current) =>
        current?.requestId === requestId ? null : current,
      );
    },
    [],
  );

  const handleAttachIntentCanvasToThread = useCallback(
    async (document: IntentCanvasDocument) => {
      if (!activeWorkspace) {
        const message = t("intentCanvas.errors.noWorkspace");
        alertError(message);
        throw new Error(message);
      }

      if (!activeWorkspace.connected) {
        await connectWorkspace(activeWorkspace);
      }

      const targetThreadId =
        activeThreadId ??
        (await startThreadForWorkspace(activeWorkspace.id, {
          activate: true,
        }));
      if (!targetThreadId) {
        const message = t("intentCanvas.errors.noThread");
        alertError(message);
        throw new Error(message);
      }

      setActiveThreadId(targetThreadId, activeWorkspace.id);
      setCenterMode("chat");
      const stagedDocument = document.links.threadIds.includes(targetThreadId)
        ? document
        : {
            ...document,
            links: {
              ...document.links,
              threadIds: [...document.links.threadIds, targetThreadId],
            },
          };
      setPendingIntentCanvasByThreadId((current) => {
        const currentDocuments = current[targetThreadId] ?? [];
        const nextDocuments = [
          stagedDocument,
          ...currentDocuments.filter((item) => item.id !== stagedDocument.id),
        ];
        return {
          ...current,
          [targetThreadId]: nextDocuments,
        };
      });
    },
    [
      activeThreadId,
      activeWorkspace,
      alertError,
      connectWorkspace,
      setActiveThreadId,
      setCenterMode,
      startThreadForWorkspace,
      t,
    ],
  );

  useEffect(() => {
    const handleExternalToggle = () => {
      void openOrFocusBrowserAgentDockWindow({
        workspaceId: activeWorkspaceId,
        workspaceName: activeWorkspace?.name ?? null,
      }).catch((error) => {
        alertError(error instanceof Error ? error.message : String(error));
      });
    };
    const handleExternalOpen = () => {
      void openOrFocusBrowserAgentDockWindow({
        workspaceId: activeWorkspaceId,
        workspaceName: activeWorkspace?.name ?? null,
      }).catch((error) => {
        alertError(error instanceof Error ? error.message : String(error));
      });
    };

    window.addEventListener("browser-agent:toggle-dock", handleExternalToggle);
    window.addEventListener("browser-agent:open-dock", handleExternalOpen);
    return () => {
      window.removeEventListener(
        "browser-agent:toggle-dock",
        handleExternalToggle,
      );
      window.removeEventListener("browser-agent:open-dock", handleExternalOpen);
    };
  }, [activeWorkspace?.name, activeWorkspaceId, alertError]);

  // Stabilized handler/prop references for the useLayoutNodes options object.
  // Each was previously an inline arrow/object literal recreated every render,
  // which defeated the React.memo shields on Messages/Composer/Sidebar. Wrapping
  // in useEventCallback (stable identity, always-latest closure) / useMemo keeps
  // behavior identical while preserving referential stability.
  const handleRecoverThreadRuntime = useEventCallback(
    async (workspaceId: string, threadId: string) =>
      recoverThreadBindingForManualRecovery({
        workspaceId,
        threadId,
        threadsByWorkspace,
        refreshThread,
        startThreadForWorkspace,
      }),
  );
  const handleRecoverThreadRuntimeAndResend = useEventCallback(
    async (
      workspaceId: string,
      threadId: string,
      message: Pick<QueuedMessage, "text" | "images">,
    ) =>
      recoverThreadBindingAndResendForManualRecovery({
        workspaceId,
        threadId,
        message,
        threadsByWorkspace,
        resolveWorkspace: (targetWorkspaceId) =>
          (typeof workspacesById?.get === "function"
            ? workspacesById.get(targetWorkspaceId)
            : workspacesById?.[targetWorkspaceId]) ??
          workspaces.find((entry: any) => entry.id === targetWorkspaceId) ??
          null,
        refreshThread,
        forkThreadForWorkspace,
        startThreadForWorkspace,
        connectWorkspace,
        sendUserMessageToThread,
      }),
  );
  const handleThreadRecoveryFork = useEventCallback(async () => {
    await startFork("/fork");
  });
  const handleOpenSettings = useEventCallback(() => openSettings());
  const handleOpenAgentSettings = useEventCallback(() =>
    openSettings("agent-prompt-management", "agent-management"),
  );
  const handleOpenPromptSettings = useEventCallback(() =>
    openSettings("agent-prompt-management", "prompt-library"),
  );
  const handleOpenDictationSettings = useEventCallback(() =>
    openSettings("dictation"),
  );
  const handleOpenSkillsSettings = useEventCallback(() =>
    openSettings("mcp", "mcp-skills"),
  );
  const handleSelectHome = useEventCallback(() => {
    closeSettings();
    handleOpenHomeChat();
  });
  const handleSelectWorkspace = useEventCallback((workspaceId: string) => {
    closeSettings();
    exitDiffView();
    resetPullRequestSelection();
    setHomeOpen(false);
    setWorkspaceHomeWorkspaceId(null);
    setCenterMode("chat");
    setActiveWorkspaceId(workspaceId);
    if (isCompact) {
      setActiveTab("codex");
    }
    ensureWorkspaceThreadListLoaded(workspaceId);
    setActiveThreadId(null, workspaceId);
  });
  const handleConnectWorkspace = useEventCallback(
    async (workspace: WorkspaceInfo) => {
      await connectWorkspace(workspace);
      ensureWorkspaceThreadListLoaded(workspace.id, { force: true });
      if (isCompact) {
        setActiveTab("codex");
      }
    },
  );
  const enabledEngines = useMemo(
    () => ({
      gemini: appSettings.geminiEnabled !== false,
      opencode: appSettings.opencodeEnabled !== false,
    }),
    [appSettings.geminiEnabled, appSettings.opencodeEnabled],
  );
  const handleToggleWorkspaceCollapse = useEventCallback(
    (workspaceId: string, collapsed: boolean) => {
      const target = workspacesById.get(workspaceId);
      if (!target) {
        return;
      }
      void updateWorkspaceSettings(workspaceId, {
        sidebarCollapsed: collapsed,
      }).then(() => {
        if (!collapsed) {
          ensureWorkspaceThreadListLoaded(workspaceId);
        }
      });
    },
  );
  const handleSelectThread = useEventCallback(
    (workspaceId: string, threadId: string) => {
      const preserveEditor = shouldPreserveEditorOnThreadSelect({
        isCompact,
        centerMode,
        activeWorkspaceId,
        targetWorkspaceId: workspaceId,
        activeEditorFilePath,
      });
      const diffCleanupAction =
        getThreadSelectDiffCleanupAction(preserveEditor);
      closeSettings();
      if (diffCleanupAction === "clear-selected-diff") {
        setSelectedDiffPath(null);
      } else {
        exitDiffView();
      }
      resetPullRequestSelection();
      setHomeOpen(false);
      setWorkspaceHomeWorkspaceId(null);
      if (!preserveEditor) {
        setCenterMode("chat");
      }
      setAppMode("chat");
      setActiveTab("codex");
      selectWorkspace(workspaceId);
      setActiveThreadId(threadId, workspaceId);
      // Auto-switch engine based on thread's engineSource
      const threads = threadsByWorkspace[workspaceId] ?? [];
      const thread = threads.find(
        (threadEntry: { id: string }) => threadEntry.id === threadId,
      );
      if (thread?.engineSource) {
        setActiveEngine(thread.engineSource);
      }
    },
  );
  const handleDeleteThread = useEventCallback(
    async (workspaceId: string, threadId: string) => {
      openDeleteThreadPrompt(workspaceId, threadId);
    },
  );
  const handleArchiveThread = useEventCallback(
    async (workspaceId: string, threadId: string) => {
      try {
        const response = await archiveWorkspaceSessions(workspaceId, [
          threadId,
        ]);
        const mutationResult = response.results.find(
          (result: any) => result.sessionId === threadId,
        );
        if (!mutationResult?.ok) {
          throw new Error(
            mutationResult?.error ?? t("workspace.archiveConversationFailed"),
          );
        }
        if (
          activeWorkspaceId === workspaceId &&
          activeThreadId === threadId
        ) {
          setActiveThreadId(null, workspaceId);
        }
        ensureWorkspaceThreadListLoaded(workspaceId, { force: true });
      } catch (error: unknown) {
        alertError(error instanceof Error ? error.message : String(error));
      }
    },
  );
  const handleConfirmDeleteConfirm = useEventCallback(() => {
    void handleDeleteThreadPromptConfirm();
  });
  const handleSyncThread = useEventCallback(
    (workspaceId: string, threadId: string) => {
      void refreshThread(workspaceId, threadId);
    },
  );
  const handleSidebarRenameThread = useEventCallback(
    (workspaceId: string, threadId: string) => {
      handleRenameThread(workspaceId, threadId);
    },
  );
  const handleAutoNameThread = useEventCallback(
    (workspaceId: string, threadId: string) => {
      addDebugEntry({
        id: `${Date.now()}-thread-title-manual-trigger`,
        timestamp: Date.now(),
        source: "client",
        label: "thread/title manual trigger",
        payload: { workspaceId, threadId },
      });
      void triggerAutoThreadTitle(workspaceId, threadId, { force: true })
        .then((title: string | null | undefined) => {
          if (!title) {
            addDebugEntry({
              id: `${Date.now()}-thread-title-manual-empty`,
              timestamp: Date.now(),
              source: "client",
              label: "thread/title manual skipped",
              payload: { workspaceId, threadId },
            });
            return;
          }
          addDebugEntry({
            id: `${Date.now()}-thread-title-manual-success`,
            timestamp: Date.now(),
            source: "server",
            label: "thread/title manual generated",
            payload: { workspaceId, threadId, title },
          });
        })
        .catch((error: unknown) => {
          addDebugEntry({
            id: `${Date.now()}-thread-title-manual-error`,
            timestamp: Date.now(),
            source: "error",
            label: "thread/title manual error",
            payload: error instanceof Error ? error.message : String(error),
          });
        });
    },
  );
  const handleDeleteWorkspace = useEventCallback((workspaceId: string) => {
    void removeWorkspace(workspaceId);
  });
  const handleDeleteWorktree = useEventCallback((workspaceId: string) => {
    void removeWorktree(workspaceId);
  });
  const handleLoadOlderThreads = useEventCallback((workspaceId: string) => {
    const workspace = workspacesById.get(workspaceId);
    if (!workspace) {
      return;
    }
    void loadOlderThreadsForWorkspace(workspace);
  });
  const handleQuickReloadWorkspaceThreads = useEventCallback(
    (workspaceId: string) => {
      const workspace = workspacesById.get(workspaceId);
      if (!workspace) {
        return;
      }
      const targets =
        workspace.kind === "main"
          ? [
              workspace,
              ...workspaces.filter(
                (candidate: WorkspaceInfo) =>
                  candidate.parentId === workspace.id,
              ),
            ]
          : [workspace];
      void Promise.allSettled(
        targets.map((target) => listThreadsForWorkspaceTracked(target)),
      );
    },
  );
  const handleReloadWorkspaceThreads = useEventCallback(
    async (workspaceId: string) => {
      const workspace = workspacesById.get(workspaceId);
      if (!workspace) {
        return;
      }
      const workspaceName =
        workspace.name || t("workspace.noWorkspaceSelected");
      const detailLines = [
        t("workspace.reloadWorkspaceThreadsEffectRefresh"),
        t("workspace.reloadWorkspaceThreadsEffectDisplayOnly"),
        t("workspace.reloadWorkspaceThreadsEffectNoDelete"),
        t("workspace.reloadWorkspaceThreadsEffectNoGitWrite"),
      ];
      const confirmed = await ask(
        `${t("workspace.reloadWorkspaceThreadsConfirm", { name: workspaceName })}\n\n${t("workspace.reloadWorkspaceThreadsBeforeYouConfirm")}\n${detailLines.map((line) => `• ${line}`).join("\n")}`,
        {
          title: t("workspace.reloadWorkspaceThreadsTitle"),
          kind: "warning",
          okLabel: t("threads.reloadThreads"),
          cancelLabel: t("common.cancel"),
        },
      );
      if (!confirmed) {
        return;
      }
      const targets =
        workspace.kind === "main"
          ? [
              workspace,
              ...workspaces.filter(
                (candidate: WorkspaceInfo) =>
                  candidate.parentId === workspace.id,
              ),
            ]
          : [workspace];
      void Promise.allSettled(
        targets.map((target) => listThreadsForWorkspaceTracked(target)),
      );
    },
  );
  const handleToggleLiveEditPreview = useEventCallback(() => {
    setLiveEditPreviewEnabled((current: boolean) => !current);
  });
  const handleToggleEditorSplitLayout = useEventCallback(() =>
    setEditorSplitLayout((prev: "vertical" | "horizontal") =>
      prev === "vertical" ? "horizontal" : "vertical",
    ),
  );
  const handleToggleEditorFileMaximized = useEventCallback(() =>
    setIsEditorFileMaximized((prev: boolean) => !prev),
  );
  const handleExitDiff = useEventCallback(() => {
    setCenterMode("chat");
    handleSelectDiffForPanel(null);
  });
  const handleOpenGitHistoryPanel = useEventCallback(() => {
    setAppMode((current: string) =>
      current === "gitHistory" ? "chat" : "gitHistory",
    );
  });
  const handleOpenProjectMap = useEventCallback(() => {
    closeSettings();
    collapseSidebar();
    setAppMode("chat");
    setCenterMode("projectMap");
    expandRightPanel();
  });
  const handleGitSelectPullRequest = useEventCallback(
    (pullRequest: GitHubPullRequest) => {
      setSelectedCommitSha(null);
      handleSelectPullRequest(pullRequest);
    },
  );
  const handleGitSelectCommit = useEventCallback((entry: GitLogEntry) => {
    handleSelectCommit(entry.sha);
  });
  const handleSelectGitRoot = useEventCallback((path: string) => {
    void handleSetGitRoot(path);
  });
  const handleClearGitRoot = useEventCallback(() => {
    void handleSetGitRoot(null);
  });
  const handleRequestContextCompaction = useEventCallback(() =>
    startCompact("/compact"),
  );
  const handleToggleCompletionEmail = useEventCallback(() => {
    if (activeThreadId) {
      toggleCompletionEmailIntent(activeThreadId);
    }
  });
  const handleForkFromMessage = useEventCallback(
    async (messageId: string, options?: CodexProviderProfileSelection) => {
      if (!activeWorkspace || !activeThreadId) {
        return;
      }
      const forkedThreadId = await forkSessionFromMessageForWorkspace(
        activeWorkspace.id,
        activeThreadId,
        messageId,
        {
          activate: true,
          mode: "messages-only",
          providerProfileId: options?.providerProfileId ?? null,
          providerProfile: options?.providerProfile ?? null,
        },
      );
      if (!forkedThreadId) {
        throw new Error("Fork did not return a child conversation.");
      }
      if (forkedThreadId && forkedThreadId !== activeThreadId) {
        if (typeof updateThreadParent === "function") {
          updateThreadParent(activeThreadId, [forkedThreadId]);
        }
      }
    },
  );
  const handleCodexAutoCompactionSettingsChange = useEventCallback(
    async (patch: { enabled?: boolean; thresholdPercent?: number }) => {
      await queueSaveSettings({
        ...appSettings,
        codexAutoCompactionEnabled:
          patch.enabled ?? appSettings.codexAutoCompactionEnabled,
        codexAutoCompactionThresholdPercent:
          patch.thresholdPercent ??
          appSettings.codexAutoCompactionThresholdPercent,
      });
    },
  );
  const handlePrefillHandled = useEventCallback((id: string) => {
    if (prefillDraft?.id === id) {
      setPrefillDraft(null);
    }
  });
  const handleInsertHandled = useEventCallback((id: string) => {
    if (composerInsert?.id === id) {
      setComposerInsert(null);
    }
  });
  const handleDictationTranscriptHandled = useEventCallback((id: string) => {
    clearDictationTranscript(id);
  });
  const handleOpenExperimentalSettings = useEventCallback(() =>
    openSettings("experimental", "experimental-collaboration-modes"),
  );
  const handleBackFromDiff = useEventCallback(() => {
    setSelectedDiffPath(null);
    setCenterMode("chat");
  });
  const handleGoProjects = useEventCallback(() => setActiveTab("projects"));
  const handleOpenMemory = useEventCallback(() => {
    setFocusedProjectMemoryId(null);
    setFocusedWorkspaceNoteId(null);
    closeSettings();
    setAppMode("chat");
    setCenterMode("memory");
  });
  const handleOpenProjectMemory = useEventCallback(() => {
    setFocusedProjectMemoryId(null);
    setFocusedWorkspaceNoteId(null);
    closeSettings();
    setAppMode("chat");
    setCenterMode("chat");
    setFilePanelMode("memory");
    expandRightPanel();
    if (isCompact) {
      setActiveTab("git");
    }
  });
  // 插件 HTML 预览请求：消息卡点击 → 事件总线 → 打开右侧预览面板。
  // useEventCallback 保证回调引用稳定（订阅只建立一次），闭包内总是读到最新的 isCompact。
  const handlePluginHtmlPreviewRequest = useEventCallback(
    (request: PluginHtmlPreviewRequest) => {
      setPluginPreviewTarget(request);
      setFilePanelMode("pluginPreview");
      expandRightPanel();
      if (isCompact) {
        setActiveTab("git");
      }
    },
  );
  useEffect(
    () => subscribePluginHtmlPreviewRequests(handlePluginHtmlPreviewRequest),
    [handlePluginHtmlPreviewRequest],
  );
  const handleOpenContextLedgerMemory = useEventCallback(
    (memoryId: string) => {
      setFocusedWorkspaceNoteId(null);
      setFocusedProjectMemoryId(memoryId);
      setFocusedProjectMemoryRequestKey((value) => value + 1);
      closeSettings();
      setAppMode("chat");
      setCenterMode("chat");
      setFilePanelMode("memory");
      expandRightPanel();
      if (isCompact) {
        setActiveTab("git");
      }
    },
  );
  const handleOpenContextLedgerNote = useEventCallback((noteId: string) => {
    setFocusedProjectMemoryId(null);
    setFocusedWorkspaceNoteId(noteId);
    setFocusedWorkspaceNoteRequestKey((value) => value + 1);
    closeSettings();
    setAppMode("chat");
    setCenterMode("notes");
    setFilePanelMode("notes");
    expandRightPanel();
    if (isCompact) {
      setActiveTab("git");
    }
  });
  const handleOpenReleaseNotes = useEventCallback(() => {
    void openReleaseNotes();
  });

  const {
    sidebarNode,
    messagesNode,
    composerNode,
    approvalToastsNode,
    updateToastNode,
    errorToastsNode,
    globalRuntimeNoticeDockNode,
    homeNode,
    mainHeaderNode,
    desktopTopbarLeftNode,
    tabletNavNode,
    tabBarNode,
    rightPanelToolbarNode,
    gitDiffPanelNode,
    gitDiffViewerNode,
    fileViewPanelNode,
    noteCardsPanelNode,
    fileComparePanelNode,
    projectMapPanelNode,
    intentCanvasPanelNode,
    browserDockNode,
    planPanelNode,
    debugPanelNode,
    debugPanelFullNode,
    terminalDockNode,
    compactEmptyCodexNode,
    compactEmptySpecNode,
    compactEmptyGitNode,
    compactGitBackNode,
    codeAnnotationBridgeProps,
  } = useLayoutNodes({
    workspace: {
      workspaces,
      groupedWorkspaces,
      hasWorkspaceGroups: workspaceGroups.length > 0,
      deletingWorktreeIds,
      threadsByWorkspace,
      threadParentById,
      threadStatusById,
      historyLoadingByThreadId,
      historyRestoredAtMsByThread,
      runningSessionCountByWorkspaceId,
      recentCompletedSessionCountByWorkspaceId,
      hydratedThreadListWorkspaceIds: hydratedThreadListWorkspaceIdsRef.current,
      threadListLoadingByWorkspace,
      threadListPagingByWorkspace,
      threadListCursorByWorkspace,
      activeWorkspaceId,
      activeThreadId,
      isPhone,
      isTablet,
      systemProxyEnabled: appSettings.systemProxyEnabled,
      systemProxyUrl: appSettings.systemProxyUrl,
    },
    runtime: {
      activeItems,
      activeQueuedHandoffBubble,
      threadItemsByThread,
      sessionRadarRunningSessions,
      sessionRadarRecentCompletedSessions,
      activeRateLimits,
      usageShowRemaining: appSettings.usageShowRemaining,
      showSidebarProviderLabels: appSettings.showSidebarProviderLabels,
      onRefreshAccountRateLimits: handleRefreshAccountRateLimits,
      showMessageAnchors: appSettings.showMessageAnchors,
      accountInfo: activeAccount,
      onSwitchAccount: handleSwitchAccount,
      onCancelSwitchAccount: handleCancelSwitchAccount,
      accountSwitching,
      codeBlockCopyUseModifier: appSettings.composerCodeBlockCopyUseModifier,
      openAppTargets: appSettings.openAppTargets,
      openAppIconById,
      selectedOpenAppId: appSettings.selectedOpenAppId,
      onSelectOpenAppId: handleSelectOpenAppId,
      approvals,
      userInputRequests,
      handleApprovalDecision,
      handleApprovalBatchAccept,
      handleApprovalRemember,
      handleUserInputSubmit: handleUserInputSubmitWithPlanApply,
      handleUserInputDismiss,
      onRecoverThreadRuntime: handleRecoverThreadRuntime,
      onRecoverThreadRuntimeAndResend: handleRecoverThreadRuntimeAndResend,
      onThreadRecoveryFork: handleThreadRecoveryFork,
      handleExitPlanModeExecute,
    },
    chrome: {
      onOpenSettings: handleOpenSettings,
      onOpenAgentSettings: handleOpenAgentSettings,
      onOpenPromptSettings: handleOpenPromptSettings,
      onOpenModelSettings: handleOpenModelSettings,
      onRefreshModelConfig: handleRefreshModelConfig,
      isModelConfigRefreshing,
      onOpenDictationSettings: handleOpenDictationSettings,
      onOpenSkillsSettings: handleOpenSkillsSettings,
      onOpenDebug: handleDebugClick,
      showDebugButton,
      onAddWorkspace: handleAddWorkspace,
      onSelectHome: handleSelectHome,
      onSelectWorkspace: handleSelectWorkspace,
      onConnectWorkspace: handleConnectWorkspace,
      onAddAgent: handleAddAgent,
      engineOptions: availableEngines,
      enabledEngines,
      onRefreshEngineOptions: refreshEngines,
      onAddSharedAgent: handleStartSharedConversation,
      onAddWorktreeAgent: handleAddWorktreeAgent,
      onAddCloneAgent: handleAddCloneAgent,
      onToggleWorkspaceCollapse: handleToggleWorkspaceCollapse,
      onSelectThread: handleSelectThread,
      onSelectHomeWorkspace: handleSelectHomeWorkspace,
      onDeleteThread: handleDeleteThread,
      onArchiveThread: handleArchiveThread,
      deleteConfirmThreadId: deleteThreadPrompt?.threadId ?? null,
      deleteConfirmWorkspaceId: deleteThreadPrompt?.workspaceId ?? null,
      deleteConfirmBusy: isDeleteThreadPromptBusy,
      onCancelDeleteConfirm: handleDeleteThreadPromptCancel,
      onConfirmDeleteConfirm: handleConfirmDeleteConfirm,
      onSyncThread: handleSyncThread,
      pinThread,
      unpinThread,
      isThreadPinned,
      getPinTimestamp,
      pinnedThreadsVersion,
      isThreadAutoNaming,
      onRenameThread: handleSidebarRenameThread,
      onAutoNameThread: handleAutoNameThread,
      onOpenClaudeTui: handleOpenClaudeTui,
      onDeleteWorkspace: handleDeleteWorkspace,
      onDeleteWorktree: handleDeleteWorktree,
      onRenameWorkspaceAlias: handleRenameWorkspaceAlias,
      onLoadOlderThreads: handleLoadOlderThreads,
      onQuickReloadWorkspaceThreads: handleQuickReloadWorkspaceThreads,
      onReloadWorkspaceThreads: handleReloadWorkspaceThreads,
      updaterState,
      onUpdate: startUpdate,
      onDismissUpdate: dismissUpdate,
      errorToasts,
      onDismissErrorToast: dismissErrorToast,
      latestAgentRuns,
      isLoadingLatestAgents,
      onSelectHomeThread: handleSelectWorkspaceInstance,
      onOpenSpecHub: handleOpenSpecHub,
      showLoadingProgressDialog,
      hideLoadingProgressDialog,
      activeWorkspace,
      activeParentWorkspace,
      worktreeLabel,
      worktreeRename: worktreeRename ?? undefined,
      isWorktreeWorkspace,
      branchName: gitStatus.branchName,
      branches,
      onCheckoutBranch: handleCheckoutBranch,
      onCreateBranch: handleCreateBranch,
      onCopyThread: handleCopyThread,
      onLockPanel: handleLockPanel,
      onToggleTerminal: handleToggleTerminalPanel,
      showTerminalButton: !isCompact,
      launchScript: launchScriptState.launchScript,
      launchScriptEditorOpen: launchScriptState.editorOpen,
      launchScriptDraft: launchScriptState.draftScript,
      launchScriptSaving: launchScriptState.isSaving,
      launchScriptError: launchScriptState.error,
      onRunLaunchScript: launchScriptState.onRunLaunchScript,
      onOpenLaunchScriptEditor: launchScriptState.onOpenEditor,
      onCloseLaunchScriptEditor: launchScriptState.onCloseEditor,
      onLaunchScriptDraftChange: launchScriptState.onDraftScriptChange,
      onSaveLaunchScript: launchScriptState.onSaveLaunchScript,
      launchScriptsState,
      mainHeaderActions,
      filePanelMode,
      onFilePanelModeChange: setFilePanelMode,
      liveEditPreviewEnabled,
      onToggleLiveEditPreview: handleToggleLiveEditPreview,
      fileTreeLoading: isFilesLoading,
      fileTreeLoadError,
      onRefreshFiles: refreshFiles,
      onOpenDetachedFileExplorer: handleOpenDetachedFileExplorer,
      onToggleRuntimeConsole: handleToggleRuntimeConsole,
      runtimeConsoleVisible: runtimeRunState.runtimeConsoleVisible,
      browserDockOpen,
      onCloseBrowserDock: handleCloseBrowserDock,
    },
    editor: {
      centerMode,
      setCenterMode,
      fileCompareSession,
      editorSplitCompanion,
      setEditorSplitCompanion,
      editorSplitLayout,
      onToggleEditorSplitLayout: handleToggleEditorSplitLayout,
      isEditorFileMaximized,
      onToggleEditorFileMaximized: handleToggleEditorFileMaximized,
      editorFilePath: activeEditorFilePath,
      editorNavigationTarget,
      editorHighlightTarget,
      openEditorTabs: openFileTabs,
      onActivateEditorTab: handleActivateWorkspaceFileTab,
      onCloseEditorTab: handleCloseWorkspaceFileTab,
      onCloseAllEditorTabs: handleCloseAllWorkspaceFileTabs,
      onActiveEditorLineRangeChange: setActiveEditorLineRange,
      onOpenFile: handleOpenWorkspaceFile,
      onCompareFiles: handleOpenWorkspaceFileCompare,
      onCloseFileCompare: handleCloseFileCompare,
      externalChangeMonitoringEnabled: enableMainFileExternalChangeMonitoring,
      externalChangeTransportMode: mainFileExternalChangeTransportMode,
      externalChangeApplyMode: liveEditPreviewEnabled ? "auto" : "manual",
      externalChangeAutoApplyDebounceMs: liveEditPreviewEnabled ? 700 : 0,
      onExitEditor: handleExitWorkspaceEditor,
      onExitDiff: handleExitDiff,
      activeTab,
      onSelectTab: setActiveTab,
      tabletNavTab: tabletTab,
      gitPanelMode,
      onGitPanelModeChange: handleGitPanelModeChange,
      onOpenGitHistoryPanel: handleOpenGitHistoryPanel,
      onOpenProjectMap: handleOpenProjectMap,
      gitDiffViewStyle,
      gitDiffListView,
      onGitDiffListViewChange: setGitDiffListView,
      worktreeApplyLabel: t("git.applyWorktreeChangesAction"),
      worktreeApplyTitle: activeParentWorkspace?.name
        ? t("git.applyWorktreeChanges") + ` ${activeParentWorkspace.name}`
        : t("git.applyWorktreeChanges"),
      worktreeApplyLoading: isWorktreeWorkspace ? worktreeApplyLoading : false,
      worktreeApplyError: isWorktreeWorkspace ? worktreeApplyError : null,
      worktreeApplySuccess: isWorktreeWorkspace ? worktreeApplySuccess : false,
      onApplyWorktreeChanges: isWorktreeWorkspace
        ? handleApplyWorktreeChanges
        : undefined,
    },
    git: {
      gitStatus,
      fileStatus,
      selectedDiffPath,
      diffScrollRequestId,
      onSelectDiff: handleSelectDiffForPanel,
      gitLogEntries,
      gitLogTotal,
      gitLogAhead,
      gitLogBehind,
      gitLogAheadEntries,
      gitLogBehindEntries,
      gitLogUpstream,
      gitLogError,
      gitLogLoading,
      selectedCommitSha,
      gitIssues,
      gitIssuesTotal,
      gitIssuesLoading,
      gitIssuesError,
      gitPullRequests,
      gitPullRequestsTotal,
      gitPullRequestsLoading,
      gitPullRequestsError,
      selectedPullRequestNumber: selectedPullRequest?.number ?? null,
      selectedPullRequest: diffSource === "pr" ? selectedPullRequest : null,
      selectedPullRequestComments:
        diffSource === "pr" ? gitPullRequestComments : [],
      selectedPullRequestCommentsLoading: gitPullRequestCommentsLoading,
      selectedPullRequestCommentsError: gitPullRequestCommentsError,
      onSelectPullRequest: handleGitSelectPullRequest,
      onSelectCommit: handleGitSelectCommit,
      gitRemoteUrl,
      gitRoot: activeGitRoot,
      gitRootCandidates,
      gitRootScanDepth,
      gitRootScanLoading,
      gitRootScanError,
      gitRootScanHasScanned,
      onGitRootScanDepthChange: setGitRootScanDepth,
      onScanGitRoots: scanGitRoots,
      onSelectGitRoot: handleSelectGitRoot,
      onClearGitRoot: handleClearGitRoot,
      onPickGitRoot: handlePickGitRoot,
      onStageGitAll: handleStageGitAll,
      onStageGitFile: handleStageGitFile,
      onUnstageGitFile: handleUnstageGitFile,
      onRevertGitFile: handleRevertGitFile,
      onRevertAllGitChanges: handleRevertAllGitChanges,
      gitDiffs: activeDiffs,
      gitDiffLoading: activeDiffLoading,
      gitDiffError: activeDiffError,
      refreshGitDiffs,
      queueGitStatusRefresh,
      onDiffActivePathChange: handleActiveDiffPath,
      onGitDiffViewStyleChange: setGitDiffViewStyle,
      commitMessage,
      commitMessageLoading,
      commitMessageError,
      onCommitMessageChange: handleCommitMessageChange,
      onGenerateCommitMessage: handleGenerateCommitMessage,
      onCommit: handleCommit,
      onCommitAndPush: handleCommitAndPush,
      onCommitAndSync: handleCommitAndSync,
      onPush: handlePush,
      onSync: handleSync,
      commitLoading,
      pushLoading,
      syncLoading,
      commitError,
      pushError,
      syncError,
      commitsAhead: gitLogAhead,
    },
    composer: {
      onSendPrompt: handleSendPrompt,
      onSendPromptToNewAgent: handleSendPromptToNewAgent,
      onCreatePrompt: handleCreatePrompt,
      onUpdatePrompt: handleUpdatePrompt,
      onDeletePrompt: handleDeletePrompt,
      onMovePrompt: handleMovePrompt,
      onRevealWorkspacePrompts: handleRevealWorkspacePrompts,
      onRevealGeneralPrompts: handleRevealGeneralPrompts,
      canRevealGeneralPrompts: Boolean(activeWorkspace),
      onSend: handleComposerSendWithIntentCanvas,
      onQueue: handleComposerQueueWithIntentCanvas,
      onRequestContextCompaction: handleRequestContextCompaction,
      onStop: interruptTurn,
      completionEmailSelected: Boolean(
        activeThreadId && completionEmailIntentByThread?.[activeThreadId],
      ),
      completionEmailDisabled: !activeThreadId,
      onToggleCompletionEmail: handleToggleCompletionEmail,
      onRewind: handleRewindFromMessage,
      onForkFromMessage: handleForkFromMessage,
      canStop: canInterrupt,
      isReviewing,
      isProcessing,
      steerEnabled: appSettings.experimentalSteerEnabled,
      reviewPrompt,
      onReviewPromptClose: closeReviewPrompt,
      onReviewPromptShowPreset: showPresetStep,
      onReviewPromptChoosePreset: choosePreset,
      highlightedPresetIndex,
      onReviewPromptHighlightPreset: setHighlightedPresetIndex,
      highlightedBranchIndex,
      onReviewPromptHighlightBranch: setHighlightedBranchIndex,
      highlightedCommitIndex,
      onReviewPromptHighlightCommit: setHighlightedCommitIndex,
      onReviewPromptKeyDown: handleReviewPromptKeyDown,
      onReviewPromptSelectBranch: selectBranch,
      onReviewPromptSelectBranchAtIndex: selectBranchAtIndex,
      onReviewPromptConfirmBranch: confirmBranch,
      onReviewPromptSelectCommit: selectCommit,
      onReviewPromptSelectCommitAtIndex: selectCommitAtIndex,
      onReviewPromptConfirmCommit: confirmCommit,
      onReviewPromptUpdateCustomInstructions: updateCustomInstructions,
      onReviewPromptConfirmCustom: confirmCustom,
      activeTokenUsage,
      contextDualViewEnabled: activeEngine === "codex",
      codexAutoCompactionEnabled: appSettings.codexAutoCompactionEnabled,
      codexAutoCompactionThresholdPercent:
        appSettings.codexAutoCompactionThresholdPercent,
      onCodexAutoCompactionSettingsChange:
        handleCodexAutoCompactionSettingsChange,
      activeQueue,
      onDraftChange: handleDraftChange,
      activeImages,
      onPickImages: pickImages,
      onAttachImages: attachImages,
      onRemoveImage: removeImage,
      prefillDraft,
      onPrefillHandled: handlePrefillHandled,
      insertText: composerInsert,
      onInsertHandled: handleInsertHandled,
      onEditQueued: handleEditQueued,
      onDeleteQueued: handleDeleteQueued,
      onFuseQueued: handleFuseQueued,
      canFuseActiveQueue,
      activeFusingMessageId,
      collaborationModes,
      collaborationModesEnabled,
      selectedCollaborationModeId,
      onSelectCollaborationMode: applySelectedCollaborationMode,
      engines: availableEngines,
      selectedEngine: activeEngine,
      usePresentationProfile: appSettings.chatCanvasUsePresentationProfile,
      onSelectEngine: handleSelectConversationEngine,
      models: effectiveModels,
      providerModelCatalogs,
      selectedModelId: effectiveSelectedModelId,
      projectMapDatasetController,
      onSelectModel: handleSelectModel,
      onDispatchOrchestrationTask: handleDispatchOrchestrationTask,
      intentCanvasOpenRequest,
      onOpenIntentCanvas: handleOpenIntentCanvas,
      onIntentCanvasOpenRequestConsumed: handleIntentCanvasOpenRequestConsumed,
      onAttachIntentCanvasToThread: handleAttachIntentCanvasToThread,
      pendingIntentCanvasDocuments,
      onRemovePendingIntentCanvas: handleRemovePendingIntentCanvas,
      reasoningOptions,
      selectedEffort,
      onSelectEffort: setSelectedEffort,
      claudeThinkingVisible,
      onResolvedClaudeThinkingVisibleChange:
        handleResolvedClaudeThinkingVisibleChange,
      reasoningSupported: effectiveReasoningSupported,
      opencodeAgents: openCodeAgents,
      selectedOpenCodeAgent,
      onSelectOpenCodeAgent: handleSelectOpenCodeAgent,
      selectedAgent,
      onSelectAgent: handleSelectAgent,
      opencodeVariantOptions: OPENCODE_VARIANT_OPTIONS,
      selectedOpenCodeVariant,
      onSelectOpenCodeVariant: handleSelectOpenCodeVariant,
      accessMode,
      onSelectAccessMode: handleSetAccessMode,
      skills,
      customSkillDirectories: appSettings.customSkillDirectories ?? EMPTY_STRING_ARRAY,
      prompts,
      commands,
      files,
      directories,
      directoryMetadata,
      fileTreeSourceVersion,
      gitignoredFiles,
      gitignoredDirectories,
      onInsertComposerText: handleInsertComposerText,
      textareaRef: composerInputRef,
      composerEditorSettings,
      composerSendShortcut: appSettings.composerSendShortcut,
      textareaHeight,
      onTextareaHeightChange,
      dictationEnabled: appSettings.dictationEnabled && dictationReady,
      dictationState,
      dictationLevel,
      onToggleDictation: handleToggleDictation,
      dictationTranscript,
      onDictationTranscriptHandled: handleDictationTranscriptHandled,
      dictationError,
      onDismissDictationError: clearDictationError,
      dictationHint,
      onDismissDictationHint: clearDictationHint,
      onOpenExperimentalSettings: handleOpenExperimentalSettings,
      composerSendLabel,
      composerLinkedKanbanPanels,
      selectedComposerKanbanPanelId,
      composerKanbanContextMode,
      onSelectComposerKanbanPanel: setSelectedComposerKanbanPanelId,
      onComposerKanbanContextModeChange: setComposerKanbanContextMode,
      onOpenComposerKanbanPanel: handleOpenComposerKanbanPanel,
      activeComposerFilePath: activeEditorFilePath,
      activeComposerFileLineRange: activeEditorLineRange,
      activeCodeSelectionAnchor: activeIntentCanvasCodeSelectionAnchor,
      onActiveCodeSelectionAnchorChange:
        setActiveIntentCanvasCodeSelectionAnchor,
      fileReferenceMode,
      onFileReferenceModeChange: setFileReferenceMode,
    },
    panels: {
      showComposer,
      plan: activePlan,
      isPlanMode,
      onOpenPlanPanel: openPlanPanel,
      onClosePlanPanel: closePlanPanel,
      bottomStatusPanelExpanded: !isPlanPanelDismissed,
      agentTaskScrollRequest,
      onSelectSubagent: handleSelectStatusPanelSubagent,
      debugEntries,
      debugOpen,
      terminalOpen,
      terminalTabs,
      activeTerminalId,
      onSelectTerminal,
      onNewTerminal,
      onCloseTerminal,
      terminalState,
      onClearDebug: clearDebugEntries,
      onCopyDebug: handleCopyDebug,
      onResizeDebug: onDebugPanelResizeStart,
      onResizeTerminal: onTerminalPanelResizeStart,
      onBackFromDiff: handleBackFromDiff,
      onGoProjects: handleGoProjects,
      workspaceDropTargetRef,
      isWorkspaceDropActive: dropOverlayActive,
      workspaceDropText: dropOverlayText,
      onWorkspaceDragOver: handleWorkspaceDragOver,
      onWorkspaceDragEnter: handleWorkspaceDragEnter,
      onWorkspaceDragLeave: handleWorkspaceDragLeave,
      onWorkspaceDrop: handleWorkspaceDrop,
      appMode,
      onAppModeChange: handleAppModeChange,
      onOpenHomeChat: handleOpenHomeChat,
      onOpenMemory: handleOpenMemory,
      onOpenProjectMemory: handleOpenProjectMemory,
      onOpenContextLedgerMemory: handleOpenContextLedgerMemory,
      onOpenContextLedgerNote: handleOpenContextLedgerNote,
      onOpenReleaseNotes: handleOpenReleaseNotes,
      focusedProjectMemoryId,
      focusedProjectMemoryRequestKey,
      focusedWorkspaceNoteId,
      focusedWorkspaceNoteRequestKey,
      onOpenGlobalSearch: handleOpenSearchPalette,
      globalSearchShortcut: appSettings.toggleGlobalSearchShortcut,
      openChatShortcut: appSettings.openChatShortcut,
      openKanbanShortcut: appSettings.openKanbanShortcut,
      cycleOpenSessionPrevShortcut: appSettings.cycleOpenSessionPrevShortcut,
      cycleOpenSessionNextShortcut: appSettings.cycleOpenSessionNextShortcut,
      closeCurrentSessionShortcut: appSettings.closeCurrentSessionShortcut,
      saveFileShortcut: appSettings.saveFileShortcut,
      findInFileShortcut: appSettings.findInFileShortcut,
      toggleGitDiffListViewShortcut: appSettings.toggleGitDiffListViewShortcut,
      onOpenWorkspaceHome: handleOpenWorkspaceHome,
    },
  });

  return {
    sidebarNode,
    messagesNode,
    composerNode,
    approvalToastsNode,
    updateToastNode,
    errorToastsNode,
    globalRuntimeNoticeDockNode,
    homeNode,
    mainHeaderNode,
    desktopTopbarLeftNode,
    tabletNavNode,
    tabBarNode,
    rightPanelToolbarNode,
    gitDiffPanelNode,
    gitDiffViewerNode,
    fileViewPanelNode,
    noteCardsPanelNode,
    fileComparePanelNode,
    projectMapPanelNode,
    intentCanvasPanelNode,
    browserDockNode,
    planPanelNode,
    debugPanelNode,
    debugPanelFullNode,
    terminalDockNode,
    compactEmptyCodexNode,
    compactEmptySpecNode,
    compactEmptyGitNode,
    compactGitBackNode,
    codeAnnotationBridgeProps,
    workspaceAliasPromptNode,
  };
}
