import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEventCallback } from "../utils/useEventCallback";
import { ask } from "@tauri-apps/plugin-dialog";
import { useLayoutNodes } from "../features/layout/hooks/useLayoutNodes";
import { useMainHeaderActionItems } from "../features/app/components/MainHeaderActions";
import { useExitedSessionVisibility } from "../features/app/hooks/useExitedSessionVisibility";
import { useModuleViewShortcuts } from "../features/app/hooks/useModuleViewShortcuts";
import { GIT_GRAPH_TAB_ID } from "../features/git-history/types";
import { WorkspaceAliasPrompt } from "../features/workspaces/components/WorkspaceAliasPrompt";
import { useClientUiVisibility } from "../features/client-ui-visibility/hooks/useClientUiVisibility";
import { isAccountConvenienceV1Enabled } from "../features/account/runtime/featureFlag";
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
import {
  continueStaleThreadBindingForManualRecovery,
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
import type { QuickSwitcherNavigationId } from "../features/quick-switcher/types";
import {
  computeQuickSwitcherActiveNavigationIds,
  isQuickSwitcherFilesActive,
  isQuickSwitcherGitActive,
  isQuickSwitcherGlobalSearchActive,
  isQuickSwitcherIntentCanvasActive,
  isQuickSwitcherKanbanActive,
  isQuickSwitcherMemoryActive,
  isQuickSwitcherNotesActive,
  isQuickSwitcherProjectMapActive,
  isQuickSwitcherSettingsActive,
  pushQuickSwitcherSelectWorkspaceToast,
  type QuickSwitcherNavigationState,
} from "./quickSwitcherNavigationState";
import {
  archiveWorkspaceSessions,
  clearDetachedExternalChangeMonitor,
  configureDetachedExternalChangeMonitor,
  getEngineModels,
} from "../services/tauri";
import { openOrFocusBrowserAgentDockWindow } from "../features/browser-agent/browserAgentDockWindow";
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

const accountConvenienceV1Enabled = isAccountConvenienceV1Enabled();

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
  const { isExitedSessionsHidden, toggleExitedSessionsHidden } =
    useExitedSessionVisibility();
  const [rootSessionFolderDraftRequestByWorkspaceId, setRootSessionFolderDraftRequestByWorkspaceId] =
    useState<Record<string, number>>({});
  const onRequestRootSessionFolderDraft = useCallback((workspaceId: string) => {
    setRootSessionFolderDraftRequestByWorkspaceId((current) => ({
      ...current,
      [workspaceId]: (current[workspaceId] ?? 0) + 1,
    }));
  }, []);
  const [workspaceAliasPrompt, setWorkspaceAliasPrompt] =
    useState<WorkspaceAliasPromptState | null>(null);
  const [
    mainFileExternalChangeTransportMode,
    setMainFileExternalChangeTransportMode,
  ] = useState<"watcher" | "polling">("polling");
  const [focusedProjectMemoryId, setFocusedProjectMemoryId] = useState<
    string | null
  >(null);
  const [focusedProjectMemoryRequestKey] = useState(0);
  const [focusedWorkspaceNoteId, setFocusedWorkspaceNoteId] = useState<
    string | null
  >(null);
  const [focusedWorkspaceNoteRequestKey] = useState(0);
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
    assignWorkspaceGroup,
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
    branchError,
    currentBranch,
    localBranches,
    remoteBranches,
    repositories,
    repositoriesLoading,
    repositoryError,
    repositoryStatuses,
    repositoryStatusesLoading,
    isMultiRepository,
    refreshRepositoryStatuses,
    handleStageRepositoryFile,
    handleUnstageRepositoryFile,
    handleUnstageRepositoryAll,
    handleUnstageRepositoryFiles,
    handleRevertRepositoryFile,
    handleRevertRepositoryFiles,
    handleStageRepositoryAll,
    handleCommitRepositories,
    repositoryCommitSummary,
    selectedRepositoryRoot,
    selectRepository,
    canFuseActiveQueue,
    fuseDisabledReasonKey,
    canInterrupt,
    centerMode,
    choosePreset,
    claudeThinkingVisible,
    clearDebugEntries,
    clearDictationError,
    clearDictationHint,
    clearDictationTranscript,
    closeQuickSwitcher,
    closePlanPanel,
    closeReviewPrompt,
    closeSettings,
    collaborationModes,
    collaborationModesEnabled,
    collapseRightPanel,
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
    handleRenamePromptCancel,
    handleRenamePromptChange,
    handleRenamePromptConfirm,
    renamePrompt,
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
    handleReorderWorkspaces,
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
    handleCloseOtherWorkspaceFileTabs,
    handleReorderWorkspaceFileTabs,
    handleCommit,
    handleCommitAndPush,
    handleCommitAndSync,
    handleCommitMessageChange,
    handleComposerQueueWithEditorFallback,
    handleComposerSendWithEditorFallback,
    handleCopyDebug,
    handleCopyThread,
    handleCreateBranch,
    handleUpdateBranch,
    handleUpdateAllRepositories,
    handleCheckoutAllRepositories,
    handleLoadCommonRepositoryBranches,
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
    handleLockPanel,
    handleMovePrompt,
    handleOpenComposerKanbanPanel,
    handleOpenDetachedFileExplorer,
    handleOpenWorkspaceFileCompare,
    handleOpenScratchFileCompare,
    handleCloseFileCompare,
    handleOpenFileHistory,
    handleActivateGitHistoryTab,
    handleOpenHomeChat,
    handleOpenModelSettings,
    handleRefreshModelConfig,
    handleOpenSearchPalette,
    handleOpenQuickSwitcher,
    handleOpenSpecHub,
    handleQuickSwitcherNavigate: handleBaseQuickSwitcherNavigate,
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
    handleRevertGitPaths,
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
    handleToggleSearchPalette,
    handleToggleTerminalPanel,
    handleUnstageGitAll,
    handleUnstageGitFile,
    handleUnstageGitPaths,
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
    hydratedThreadListWorkspaceIds,
    interruptTurn,
    isCompact,
    isDeleteThreadPromptBusy,
    isEditorFileMaximized,
    isFilesLoading,
    isModelConfigRefreshing,
    isPhone,
    isPlanMode,
    isPlanPanelDismissed,
    isProcessing,
    isReviewing,
    isSearchPaletteOpen,
    isSoloMode,
    isTablet,
    isThreadAutoNaming,
    isThreadPinned,
    isWorktreeWorkspace,
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
    persistComposerSelectionForThread,
    prefillDraft,
    refreshEngineModels,
    prompts,
    pushError,
    pushLoading,
    clearGitOperationErrors,
    queueGitStatusRefresh,
    queueSaveSettings,
    reasoningOptions,
    refreshEngines,
    refreshFiles,
    refreshGitDiffs,
    refreshGitLog,
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
    settingsOpen,
    showComposer,
    showLoadingProgressDialog,
    hideLoadingProgressDialog,
    showDebugButton,
    showPresetStep,
    sidebarToggleProps,
    skills,
    soloModeEnabled,
    startCompact,
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
    historyLoadingProgressByThreadId,
    historyRestoredAtMsByThread,
    threadsByWorkspace,
    toggleCompletionEmailIntent,
    toggleSoloMode,
    triggerAutoThreadTitle,
    unpinThread,
    updateCustomInstructions,
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
    async (engine: "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode") => {
      const thread =
        activeWorkspaceId && activeThreadId
          ? (threadsByWorkspace[activeWorkspaceId] ?? []).find(
              (entry: any) => entry.id === activeThreadId,
            )
          : null;
      // Shared 的 CLI 切换只能由完整 ExecutionTarget picker 完成。这个 legacy
      // engine-only callback 属于 Native control surface；即使被快捷键或旧调用方
      // 触发，也不能改写 Shared 的全局 Engine 或 durable selectedTarget。
      if (thread?.threadKind === "shared") {
        return;
      }
      await setActiveEngine(engine);
      if (!activeWorkspaceId || !activeThreadId) {
        return;
      }
    },
    [
      activeThreadId,
      activeWorkspaceId,
      setActiveEngine,
      threadsByWorkspace,
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
  const handleOpenAccount = useEventCallback(() => openSettings("account"));
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
    showAccountButton: !isCompact && accountConvenienceV1Enabled,
    onOpenAccount: accountConvenienceV1Enabled ? handleOpenAccount : undefined,
  });
  const handleCloseBrowserDock = useCallback(() => {
    // Browser Agent now lives in its own tool window.
  }, []);

  const handleOpenIntentCanvas = useCallback(
    (request?: Omit<IntentCanvasOpenRequest, "requestId">) => {
      if (!activeWorkspace) {
        // 无效打开提示（D2）：info toast 代替旧 window.alert 阻塞弹窗。
        pushQuickSwitcherSelectWorkspaceToast(t, "intentCanvas");
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
    const workspaceId =
      typeof activeWorkspaceId === "string" ? activeWorkspaceId.trim() : "";
    const threadId =
      typeof activeThreadId === "string" ? activeThreadId.trim() : "";
    if (!workspaceId || !threadId) {
      return {
        kind: "failed" as const,
        reason: "missing workspace or thread id",
        retryable: true,
        userAction: "start-fresh-thread" as const,
      };
    }
    return continueStaleThreadBindingForManualRecovery({
      workspaceId,
      threadId,
      threadsByWorkspace,
      forkThreadForWorkspace,
      startThreadForWorkspace,
    });
  });
  const handleOpenSettings = useEventCallback(() => openSettings());
  const handleOpenShortcutsSettings = useEventCallback(() =>
    openSettings("shortcuts"),
  );
  const handleOpenAgentSettings = useEventCallback(() =>
    openSettings("agent-prompt-management", "agent-management"),
  );
  const handleOpenPromptSettings = useEventCallback(() =>
    openSettings("agent-prompt-management", "prompt-library"),
  );
  const handleOpenCliSettings = useEventCallback(() =>
    openSettings("providers"),
  );
  const handleOpenDictationSettings = useEventCallback(() =>
    openSettings("dictation"),
  );
  // Manual git panel refresh should dismiss stale commit/push/sync error banners.
  const handleManualGitStatusRefresh = useCallback(() => {
    clearGitOperationErrors();
    queueGitStatusRefresh();
  }, [clearGitOperationErrors, queueGitStatusRefresh]);
  const handleOpenSkillsSettings = useEventCallback(() =>
    openSettings("other", "mcp-skills"),
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
  const handleProviderContinuationTargetReady = useEventCallback(
    async (input: {
      workspaceId: string;
      threadId: string;
      engine: string;
      providerProfileId: string | null;
      modelId: string | null;
      modelRuntime?: string | null;
      effort: string | null;
    }) => {
      // 续接成功：把目标供应商模型落到新会话 composer。
      // picker 按 catalog entry id 匹配；仅传 runtime（MiniMax-M3）会显示「选择模型」。
      // 解析顺序：catalog entry id → runtime 反查 → default/首档。
      let resolvedModelId = input.modelId?.trim() || null;
      const runtimeHint =
        input.modelRuntime?.trim() || input.modelId?.trim() || null;
      const effort = input.effort?.trim() || null;
      const engine = input.engine as
        | "claude"
        | "codex"
        | "kimi"
        | "grok"
        | "opencode"
        | "gemini";

      if (
        engine === "claude" ||
        engine === "codex" ||
        engine === "kimi" ||
        engine === "grok" ||
        engine === "opencode"
      ) {
        try {
          const models = await getEngineModels(engine, {
            providerProfileId: input.providerProfileId,
            forceRefresh: true,
          });
          void refreshEngineModels(engine, {
            providerProfileId: input.providerProfileId,
            forceRefresh: true,
            phase: "on-demand",
          });
          const byCatalogId = resolvedModelId
            ? models.find((model) => model.id === resolvedModelId)
            : undefined;
          if (!byCatalogId && runtimeHint) {
            const byRuntime = models.find(
              (model) =>
                (model.model?.trim() || model.id) === runtimeHint,
            );
            if (byRuntime) {
              resolvedModelId = byRuntime.id;
            }
          } else if (byCatalogId) {
            resolvedModelId = byCatalogId.id;
          }
          if (
            !resolvedModelId ||
            !models.some((model) => model.id === resolvedModelId)
          ) {
            const defaultModel =
              models.find((model) => model.isDefault) ?? models[0] ?? null;
            if (defaultModel) {
              resolvedModelId = defaultModel.id;
            }
          }
        } catch {
          // catalog 拉取失败时仍尽量用 destination 给的 id/runtime 落盘
        }
      }

      if (resolvedModelId || effort) {
        persistComposerSelectionForThread(input.workspaceId, input.threadId, {
          modelId: resolvedModelId,
          effort,
        });
      }
      if (resolvedModelId) {
        handleSelectModel(resolvedModelId);
      }
      if (effort) {
        setSelectedEffort(effort);
      }
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
        // Prefer exact id match; fall back to the only result when backend
        // normalizes the requested id into a different sessionId field.
        const mutationResult =
          response.results.find((result) => result.sessionId === threadId) ??
          (response.results.length === 1 ? response.results[0] : undefined);
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
        // Immediately drop the row from local sidebar state via deletedThreadIds.
        // Without this, success only triggers a full catalog rescan — slow, easy
        // to race with continuity merge, and looks like "click does nothing".
        ensureWorkspaceThreadListLoaded(workspaceId, {
          force: true,
          deletedThreadIds: [threadId],
        });
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
    async (workspaceId: string) => {
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
      await Promise.allSettled(
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
    handleActivateGitHistoryTab(GIT_GRAPH_TAB_ID);
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
  // Quick Switcher「状态感知路由」的判定快照（design.md D1）。useMemo 与
  // handleQuickSwitcherNavigate 各自内联构造，保持 predicates 纯函数化、
  // 且不引入跨渲染的引用依赖。
  const quickSwitcherActiveNavigationIds = useMemo<QuickSwitcherNavigationId[]>(
    () =>
      computeQuickSwitcherActiveNavigationIds({
        activeTab,
        appMode,
        centerMode,
        filePanelMode,
        isCompact,
        isSearchPaletteOpen,
        rightPanelCollapsed,
        settingsOpen,
      }),
    [
      activeTab,
      appMode,
      centerMode,
      filePanelMode,
      isCompact,
      isSearchPaletteOpen,
      rightPanelCollapsed,
      settingsOpen,
    ],
  );
  const handleQuickSwitcherNavigate = useEventCallback(
    (target: QuickSwitcherNavigationId) => {
      const navigationState: QuickSwitcherNavigationState = {
        activeTab,
        appMode,
        centerMode,
        filePanelMode,
        isCompact,
        isSearchPaletteOpen,
        rightPanelCollapsed,
        settingsOpen,
      };
      // 首页表面关闭 helper：拦截 action（含回切分支）执行前统一调用，
      // 与 base 的 file/session/navigate 激活路径对齐，避免 action 在 home
      // 遮罩后执行、用户看不到反馈。纯提示分支（无 workspace toast）不打开
      // 模块，toast 在 home 之上可见，故不关 home。委托 base 的分支由 base
      // handler 入口统一关闭，这里不重复调用。
      const closeHomeSurface = () => {
        setHomeOpen(false);
        setWorkspaceHomeWorkspaceId(null);
      };
      // spec 保持 open-or-focus（独立窗口，不做 toggle）。
      if (target === "spec") {
        closeQuickSwitcher();
        closeHomeSurface();
        handleOpenSpecHub();
        return;
      }
      if (target === "intentCanvas") {
        closeQuickSwitcher();
        if (!activeWorkspace) {
          pushQuickSwitcherSelectWorkspaceToast(t, "intentCanvas");
          return;
        }
        closeHomeSurface();
        if (isQuickSwitcherIntentCanvasActive(navigationState)) {
          setCenterMode("chat");
          return;
        }
        handleOpenIntentCanvas();
        return;
      }
      if (target === "projectMap") {
        closeQuickSwitcher();
        if (!activeWorkspace) {
          pushQuickSwitcherSelectWorkspaceToast(t, "projectMap");
          return;
        }
        closeHomeSurface();
        if (isQuickSwitcherProjectMapActive(navigationState)) {
          setCenterMode("chat");
          return;
        }
        handleOpenProjectMap();
        return;
      }
      if (target === "globalSearch") {
        closeQuickSwitcher();
        closeHomeSurface();
        if (isQuickSwitcherGlobalSearchActive(navigationState)) {
          // 已打开 → 回切关闭（现成 toggle，内部走 closeSearchPalette）。
          handleToggleSearchPalette();
        } else {
          handleOpenSearchPalette();
        }
        return;
      }
      if (target === "notes") {
        closeQuickSwitcher();
        if (!activeWorkspace) {
          pushQuickSwitcherSelectWorkspaceToast(t, "notes");
          return;
        }
        closeHomeSurface();
        if (isQuickSwitcherNotesActive(navigationState)) {
          // 便签回切连带把 center mode 复位到 chat（不留残留态）。
          collapseRightPanel();
          setCenterMode("chat");
          return;
        }
        handleOpenNotes();
        return;
      }
      if (target === "memory") {
        closeQuickSwitcher();
        if (!activeWorkspace) {
          pushQuickSwitcherSelectWorkspaceToast(t, "memory");
          return;
        }
        closeHomeSurface();
        if (isQuickSwitcherMemoryActive(navigationState)) {
          collapseRightPanel();
          return;
        }
        handleOpenProjectMemory();
        return;
      }
      if (target === "history") {
        closeQuickSwitcher();
        closeHomeSurface();
        // handleOpenGitHistoryPanel 本身是现成 toggle（gitHistory ↔ chat）。
        handleOpenGitHistoryPanel();
        return;
      }
      // files/git/kanban/settings：wrapper 只拦截「已开 → 回切」分支；
      // 未开时委托 base handler 执行既有 open action（base 保留兜底 case）。
      if (target === "files" || target === "git") {
        const isActive =
          target === "files"
            ? isQuickSwitcherFilesActive(navigationState)
            : isQuickSwitcherGitActive(navigationState);
        if (isActive) {
          closeQuickSwitcher();
          closeHomeSurface();
          collapseRightPanel();
          return;
        }
        handleBaseQuickSwitcherNavigate(target);
        return;
      }
      if (target === "kanban") {
        if (isQuickSwitcherKanbanActive(navigationState)) {
          closeQuickSwitcher();
          closeHomeSurface();
          setAppMode("chat");
          return;
        }
        handleBaseQuickSwitcherNavigate(target);
        return;
      }
      if (target === "settings") {
        if (isQuickSwitcherSettingsActive(navigationState)) {
          closeQuickSwitcher();
          closeHomeSurface();
          closeSettings();
          return;
        }
        handleBaseQuickSwitcherNavigate(target);
        return;
      }
      handleBaseQuickSwitcherNavigate(target);
    },
  );
  const handleGitSelectPullRequest = useEventCallback(
    (pullRequest: GitHubPullRequest) => {
      setSelectedCommitSha(null);
      handleSelectPullRequest(pullRequest);
    },
  );
  const handleGitSelectCommit = useEventCallback((entry: GitLogEntry) => {
    handleSelectCommit(entry.sha);
  });
  const handleSelectGitRoot = useEventCallback(async (path: string) => {
    await handleSetGitRoot(path);
  });
  const handleClearGitRoot = useEventCallback(async () => {
    await handleSetGitRoot(null);
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
          operation: "fork",
          providerProfileId: options?.providerProfileId ?? null,
          providerProfile: options?.providerProfile ?? null,
        },
      );
      if (!forkedThreadId) {
        throw new Error("Fork did not return a child conversation.");
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
  const handleOpenNotes = useEventCallback(() => {
    setFocusedProjectMemoryId(null);
    setFocusedWorkspaceNoteId(null);
    closeSettings();
    setAppMode("chat");
    setCenterMode("notes");
    setFilePanelMode("notes");
    expandRightPanel();
    if (isCompact) {
      setActiveTab("git");
    }
  });
  const handleOpenRadar = useEventCallback(() => {
    closeSettings();
    setAppMode("chat");
    setCenterMode("chat");
    setFilePanelMode("radar");
    expandRightPanel();
    if (isCompact) {
      setActiveTab("git");
    }
  });
  const handleOpenReleaseNotes = useEventCallback(() => {
    void openReleaseNotes();
  });

  useModuleViewShortcuts({
    toggleGitGraphShortcut: appSettings.toggleGitGraphShortcut,
    openNotesShortcut: appSettings.openNotesShortcut,
    openIntentCanvasShortcut: appSettings.openIntentCanvasShortcut,
    openRadarShortcut: appSettings.openRadarShortcut,
    openProjectMapShortcut: appSettings.openProjectMapShortcut,
    openBrowserDockShortcut: appSettings.openBrowserDockShortcut,
    openFileCompareShortcut: appSettings.openFileCompareShortcut,
    onToggleGitGraph: handleOpenGitHistoryPanel,
    onOpenNotes: handleOpenNotes,
    onOpenIntentCanvas: handleOpenIntentCanvas,
    onOpenRadar: handleOpenRadar,
    onOpenProjectMap: handleOpenProjectMap,
    onOpenBrowserDock: handleToggleBrowserDock,
    onOpenFileCompare: handleOpenScratchFileCompare,
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
      historyLoadingProgressByThreadId,
      historyRestoredAtMsByThread,
      runningSessionCountByWorkspaceId,
      recentCompletedSessionCountByWorkspaceId,
      // Prefer state snapshot (new Set identity on each mark) over the ref so
      // memo(Sidebar) actually re-renders when hydration completes / times out.
      hydratedThreadListWorkspaceIds:
        hydratedThreadListWorkspaceIds instanceof Set
          ? hydratedThreadListWorkspaceIds
          : new Set<string>(),
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
      onOpenShortcutsSettings: handleOpenShortcutsSettings,
      onOpenAgentSettings: handleOpenAgentSettings,
      onOpenPromptSettings: handleOpenPromptSettings,
      onOpenModelSettings: handleOpenModelSettings,
      onOpenCliSettings: handleOpenCliSettings,
      onRefreshModelConfig: handleRefreshModelConfig,
      isModelConfigRefreshing,
      onOpenDictationSettings: handleOpenDictationSettings,
      onOpenSkillsSettings: handleOpenSkillsSettings,
      onOpenDebug: handleDebugClick,
      showDebugButton,
      onAddWorkspace: handleAddWorkspace,
      onSelectHome: handleSelectHome,
      onSelectWorkspace: handleSelectWorkspace,
      onReorderWorkspaces: handleReorderWorkspaces,
      onConnectWorkspace: handleConnectWorkspace,
      onAddAgent: handleAddAgent,
      engineOptions: availableEngines,
      onRefreshEngineOptions: refreshEngines,
      onAddSharedAgent: handleStartSharedConversation,
      onAddWorktreeAgent: handleAddWorktreeAgent,
      onAddCloneAgent: handleAddCloneAgent,
      onToggleWorkspaceCollapse: handleToggleWorkspaceCollapse,
      onSelectThread: handleSelectThread,
      onProviderContinuationTargetReady: handleProviderContinuationTargetReady,
      onSelectHomeWorkspace: handleSelectHomeWorkspace,
      onDeleteThread: handleDeleteThread,
      onArchiveThread: handleArchiveThread,
      deleteConfirmThreadId: deleteThreadPrompt?.threadId ?? null,
      deleteConfirmWorkspaceId: deleteThreadPrompt?.workspaceId ?? null,
      deleteConfirmBusy: isDeleteThreadPromptBusy,
      onCancelDeleteConfirm: handleDeleteThreadPromptCancel,
      onConfirmDeleteConfirm: handleConfirmDeleteConfirm,
      renameThreadId: renamePrompt?.threadId ?? null,
      renameWorkspaceId: renamePrompt?.workspaceId ?? null,
      renameName: renamePrompt?.name ?? "",
      onRenameChange: handleRenamePromptChange,
      onRenameCancel: handleRenamePromptCancel,
      onRenameConfirm: handleRenamePromptConfirm,
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
      workspaceGroups,
      onAssignWorkspaceGroup: assignWorkspaceGroup,
      onLoadOlderThreads: handleLoadOlderThreads,
      onQuickReloadWorkspaceThreads: handleQuickReloadWorkspaceThreads,
      onReloadWorkspaceThreads: handleReloadWorkspaceThreads,
      isExitedSessionsHidden,
      onToggleExitedSessionsHidden: toggleExitedSessionsHidden,
      rootSessionFolderDraftRequestByWorkspaceId,
      onRequestRootSessionFolderDraft,
      updaterState,
      onUpdate: startUpdate,
      onDismissUpdate: dismissUpdate,
      errorToasts,
      onDismissErrorToast: dismissErrorToast,
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
      branchError,
      branchCurrentName: currentBranch,
      branchLocalItems: localBranches,
      branchRemoteItems: remoteBranches,
      gitRepositories: repositories,
      gitRepositoriesLoading: repositoriesLoading,
      gitRepositoriesError: repositoryError,
      selectedGitRepositoryRoot: selectedRepositoryRoot,
      onSelectGitRepository: selectRepository,
      onCheckoutBranch: handleCheckoutBranch,
      onCreateBranch: handleCreateBranch,
      onUpdateBranch: handleUpdateBranch,
      onUpdateAllRepositories: handleUpdateAllRepositories,
      onCheckoutAllRepositories: handleCheckoutAllRepositories,
      onLoadCommonRepositoryBranches: handleLoadCommonRepositoryBranches,
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
      onOpenFileHistory: handleOpenFileHistory,
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
      onCloseOtherEditorTabs: handleCloseOtherWorkspaceFileTabs,
      onCloseAllEditorTabs: handleCloseAllWorkspaceFileTabs,
      onReorderEditorTabs: handleReorderWorkspaceFileTabs,
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
      onUnstageGitAll: handleUnstageGitAll,
      onUnstageGitFile: handleUnstageGitFile,
      onUnstageGitPaths: handleUnstageGitPaths,
      onRevertGitFile: handleRevertGitFile,
      onRevertGitPaths: handleRevertGitPaths,
      onRevertAllGitChanges: handleRevertAllGitChanges,
      gitDiffs: activeDiffs,
      gitDiffLoading: activeDiffLoading,
      gitDiffError: activeDiffError,
      refreshGitLog,
      refreshGitDiffs,
      queueGitStatusRefresh: handleManualGitStatusRefresh,
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
      multiRepositoryMode: isMultiRepository,
      repositoryStatuses,
      repositoryStatusesLoading,
      onRefreshRepositoryStatuses: refreshRepositoryStatuses,
      onStageRepositoryFile: handleStageRepositoryFile,
      onUnstageRepositoryFile: handleUnstageRepositoryFile,
      onUnstageRepositoryAll: handleUnstageRepositoryAll,
      onUnstageRepositoryFiles: handleUnstageRepositoryFiles,
      onRevertRepositoryFile: handleRevertRepositoryFile,
      onRevertRepositoryFiles: handleRevertRepositoryFiles,
      onStageRepositoryAll: handleStageRepositoryAll,
      onCommitRepositories: handleCommitRepositories,
      repositoryCommitSummary,
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
      fuseDisabledReasonKey,
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

      onOpenReleaseNotes: handleOpenReleaseNotes,
      focusedProjectMemoryId,
      focusedProjectMemoryRequestKey,
      focusedWorkspaceNoteId,
      focusedWorkspaceNoteRequestKey,
      onOpenGlobalSearch: handleOpenSearchPalette,
      onOpenQuickSwitcher: handleOpenQuickSwitcher,
      onCollapseSidebar: collapseSidebar,
      globalSearchShortcut: appSettings.toggleGlobalSearchShortcut,
      openChatShortcut: appSettings.openChatShortcut,
      openKanbanShortcut: appSettings.openKanbanShortcut,
      cycleOpenSessionPrevShortcut: appSettings.cycleOpenSessionPrevShortcut,
      cycleOpenSessionNextShortcut: appSettings.cycleOpenSessionNextShortcut,
      closeCurrentSessionShortcut: appSettings.closeCurrentSessionShortcut,
      saveFileShortcut: appSettings.saveFileShortcut,
      findInFileShortcut: appSettings.findInFileShortcut,
      expandSelectionShortcut: appSettings.expandSelectionShortcut,
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
    handleQuickSwitcherNavigate,
    quickSwitcherActiveNavigationIds,
  };
}
