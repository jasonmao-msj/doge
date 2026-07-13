import { useCallback, useEffect } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { getWorkspaceFiles } from "../services/tauri";
import { pushErrorToast } from "../services/toasts";
import { useSoloMode } from "../features/layout/hooks/useSoloMode";
import { useLiveEditPreview } from "../features/live-edit-preview/hooks/useLiveEditPreview";
import { useArchiveShortcut } from "../features/app/hooks/useArchiveShortcut";
import { useAppSurfaceShortcuts } from "../features/app/hooks/useAppSurfaceShortcuts";
import { usePrimaryModeShortcuts } from "../features/app/hooks/usePrimaryModeShortcuts";
import { useWorkspaceCycling } from "../features/app/hooks/useWorkspaceCycling";
import { useAppMenuEvents } from "../features/app/hooks/useAppMenuEvents";
import { useMenuAcceleratorController } from "../features/app/hooks/useMenuAcceleratorController";
import { useMenuLocalization } from "../features/app/hooks/useMenuLocalization";
import { runWithLoadingProgress } from "../features/app/utils/loadingProgressActions";
import { normalizeSharedSessionEngine } from "../features/shared-session/utils/sharedSessionEngines";
import {
  buildDetachedSpecHubSession,
  openOrFocusDetachedSpecHub,
} from "../features/spec/detachedSpecHub";
import { openOrFocusClientDocumentationWindow } from "../features/client-documentation/clientDocumentationWindow";
import type { WorkspaceHomeDeleteResult } from "../features/workspaces/components/WorkspaceHome";
import type { EngineType, WorkspaceInfo } from "../types";
import { isRewindSupportedThreadId } from "./useAppShellSections.kanbanHelpers";
import {
  getThreadSelectDiffCleanupAction,
  shouldCollapseRightPanelOnThreadSelect,
  shouldPreserveEditorOnThreadSelect,
} from "./threadEditorPreservation";
import { useAppShellKanbanComposerSection } from "./useAppShellKanbanComposerSection";
import { useAppShellKanbanExecutionSection } from "./useAppShellKanbanExecutionSection";
import {
  adaptAppShellLegacyFlatContext,
  flattenSelectedAppShellDomainContexts,
  type AppShellDomainContextName,
} from "./appShellDomainContexts";
import type {
  UseAppShellSectionsContext,
  UseAppShellSectionsInput,
} from "./useAppShellSectionsTypes";
import {
  defineAppShellContextActions,
  defineAppShellNavigationActions,
  defineAppShellRuntimeActions,
  defineAppShellTaskRunActions,
} from "./appShellActionBoundaries";
export {
  resolvePendingSessionThreadCandidate,
  resolveTaskThreadId,
  shouldSyncComposerEngineForKanbanExecution,
  stripComposerKanbanTagsPreserveFormatting,
  syncKanbanExecutionEngineAndModel,
} from "./useAppShellSections.kanbanHelpers";

const APP_SHELL_SECTIONS_DOMAIN_NAMES = [
  "workspaceNavigationContext",
  "composerContext",
  "layoutContext",
  "fileEditorContext",
  "settingsContext",
  "runtimeContext",
  "modelSelectionContext",
  "collaborationModeContext",
] as const satisfies readonly AppShellDomainContextName[];

function flattenAppShellSectionsContext(
  input: UseAppShellSectionsInput,
): UseAppShellSectionsContext {
  return adaptAppShellLegacyFlatContext<UseAppShellSectionsContext>({
    ...flattenSelectedAppShellDomainContexts(
      input.appShellDomainContexts,
      APP_SHELL_SECTIONS_DOMAIN_NAMES,
    ),
    ...input.searchAndComposerSection,
  });
}

export function useAppShellSections(input: UseAppShellSectionsInput) {
  const ctx = flattenAppShellSectionsContext(input);
  const {
    activeWorkspace,
    workspaces,
    setAppMode,
    activeEngine,
    activeWorkspaceId,
    activeThreadId,
    addWorkspaceFromPath,
    alertError,
    workspacesById,
    exitDiffView,
    connectWorkspace,
    startThreadForWorkspace,
    startSharedSessionForWorkspace,
    setCenterMode,
    selectWorkspace,
    setActiveThreadId,
    sendUserMessageToThread,
    isPullRequestComposer,
    resetPullRequestSelection,
    threadsByWorkspace,
    addDebugEntry,
    forkSessionFromMessageForWorkspace,
    forkClaudeSessionFromMessageForWorkspace,
    isCompact,
    centerMode,
    setActiveTab,
    recentThreads,
    collapseRightPanel,
    setActiveEngine,
    updateSharedSessionEngineSelection,
    removeThread,
    removeThreads,
    clearDraftForThread,
    removeImagesForThread,
    t,
    appMode,
    selectedKanbanTaskId,
    setActiveWorkspaceId,
    setWorkspaceHomeWorkspaceId,
    updateWorkspaceSettings,
    activeTab,
    tabletTab,
    settingsOpen,
    showWorkspaceHome,
    filePanelMode,
    sidebarCollapsed,
    rightPanelCollapsed,
    isWorkspaceDropActive,
    setFilePanelMode,
    collapseSidebar,
    expandSidebar,
    expandRightPanel,
    resetSoloSplitToHalf,
    liveEditPreviewEnabled,
    workspaceActivity,
    activeEditorFilePath,
    handleOpenFile,
    handleActivateFileTab,
    handleCloseFileTab,
    handleCloseAllFileTabs,
    handleExitEditor,
    selectedDiffPath,
    isTablet,
    isPhone,
    closeSettings,
    selectHome,
    handleArchiveActiveThread,
    appSettings,
    groupedWorkspaces,
    homeWorkspaceSelectedId,
    getThreadRows,
    getPinTimestamp,
    activeWorkspaceIdRef,
    activeThreadIdRef,
    activeWorkspaceRef,
    baseWorkspaceRef,
    handleAddWorkspace,
    handleOpenNewWindow,
    handleAddAgent,
    handleAddWorktreeAgent,
    handleAddCloneAgent,
    openSettings,
    handleDebugClick,
    handleToggleRuntimeConsole,
    handleToggleTerminalPanel,
    handleToggleSearchPalette,
    composerSendLabel,
    refreshAccountRateLimits,
    setHomeOpen,
    showHome,
    showKanban,
    showPlugins,
    showGitHistory,
    showLoadingProgressDialog,
    hideLoadingProgressDialog,
    isWindowsDesktop,
    isMacDesktop,
    reduceTransparency,
    setSelectedDiffPath,
    handleSelectDiff,
  } = ctx;

  const {
    selectedComposerKanbanPanelId,
    setSelectedComposerKanbanPanelId,
    composerKanbanContextMode,
    setComposerKanbanContextMode,
    composerLinkedKanbanPanels,
    handleOpenComposerKanbanPanel,
    handleComposerSendWithEditorFallback,
    handleComposerQueueWithEditorFallback,
  } = useAppShellKanbanComposerSection(ctx);

  const handleRewindFromMessage = useCallback(
    async (
      messageId: string,
      options?: {
        mode?: "messages-and-files" | "messages-only" | "files-only";
      },
    ) => {
      const normalizedMessageId = messageId.trim();
      if (!activeWorkspaceId || !activeThreadId || !normalizedMessageId) {
        throw new Error(t("rewind.notAvailable"));
      }
      if (!isRewindSupportedThreadId(activeThreadId)) {
        throw new Error(t("rewind.notAvailable"));
      }
      const rewindFromMessage =
        forkSessionFromMessageForWorkspace ??
        forkClaudeSessionFromMessageForWorkspace;
      const forkedThreadId = await rewindFromMessage(
        activeWorkspaceId,
        activeThreadId,
        normalizedMessageId,
        {
          activate: true,
          mode: options?.mode,
        },
      );
      if (!forkedThreadId) {
        throw new Error(t("rewind.failed"));
      }
    },
    [
      activeThreadId,
      activeWorkspaceId,
      forkSessionFromMessageForWorkspace,
      forkClaudeSessionFromMessageForWorkspace,
      t,
    ],
  );

  const handleSelectWorkspaceInstance = useCallback(
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
      if (diffCleanupAction === "clear-selected-diff") {
        setSelectedDiffPath(null);
      } else {
        exitDiffView();
      }
      resetPullRequestSelection();
      setHomeOpen(false);
      setWorkspaceHomeWorkspaceId(null);
      setAppMode("chat");
      setActiveTab("codex");
      if (
        shouldCollapseRightPanelOnThreadSelect({
          preserveEditor,
          requestedCollapse: true,
        })
      ) {
        collapseRightPanel();
      }
      selectWorkspace(workspaceId);
      setActiveThreadId(threadId, workspaceId);
      const threads = threadsByWorkspace[workspaceId] ?? [];
      const thread = threads.find((entry: any) => entry.id === threadId);
      if (thread?.engineSource) {
        setActiveEngine(thread.engineSource);
      }
    },
    [
      activeEditorFilePath,
      activeWorkspaceId,
      centerMode,
      exitDiffView,
      collapseRightPanel,
      isCompact,
      resetPullRequestSelection,
      setActiveTab,
      setAppMode,
      setHomeOpen,
      setSelectedDiffPath,
      setWorkspaceHomeWorkspaceId,
      selectWorkspace,
      setActiveEngine,
      setActiveThreadId,
      threadsByWorkspace,
    ],
  );

  const handleStartWorkspaceConversation = useCallback(
    async (engine: EngineType = "claude") => {
      if (!activeWorkspace) {
        return;
      }
      try {
        setHomeOpen(false);
        setWorkspaceHomeWorkspaceId(null);
        if (!activeWorkspace.connected) {
          await connectWorkspace(activeWorkspace);
        }
        await setActiveEngine(engine);
        const threadId = await startThreadForWorkspace(activeWorkspace.id, {
          activate: true,
          engine,
        });
        if (!threadId) {
          return;
        }
        setActiveThreadId(threadId, activeWorkspace.id);
        collapseRightPanel();
        if (isCompact) {
          setActiveTab("codex");
        }
      } catch (error) {
        alertError(error);
      }
    },
    [
      activeWorkspace,
      alertError,
      collapseRightPanel,
      connectWorkspace,
      isCompact,
      setHomeOpen,
      setActiveTab,
      setActiveEngine,
      setActiveThreadId,
      setWorkspaceHomeWorkspaceId,
      startThreadForWorkspace,
    ],
  );

  const handleStartSharedConversation = useCallback(
    async (engineOrWorkspace: EngineType | WorkspaceInfo = "claude") => {
      const targetWorkspace =
        typeof engineOrWorkspace === "object" && engineOrWorkspace !== null
          ? engineOrWorkspace
          : activeWorkspace;
      if (!targetWorkspace) {
        return;
      }
      const engine: EngineType =
        typeof engineOrWorkspace === "string"
          ? engineOrWorkspace
          : activeEngine;
      const sharedEngine = normalizeSharedSessionEngine(engine);
      try {
        return await runWithLoadingProgress(
          { showLoadingProgressDialog, hideLoadingProgressDialog },
          {
            title: t("workspace.loadingProgressCreateSessionTitle"),
            message: t("workspace.loadingProgressCreateSessionMessage", {
              engine: t("sidebar.newSharedSession"),
              workspace: targetWorkspace.name.trim() || targetWorkspace.path,
            }),
          },
          async () => {
            setWorkspaceHomeWorkspaceId(null);
            selectWorkspace(targetWorkspace.id);
            if (!targetWorkspace.connected) {
              await connectWorkspace(targetWorkspace);
            }
            await setActiveEngine(sharedEngine);
            const threadId = await startSharedSessionForWorkspace(
              targetWorkspace.id,
              {
                activate: true,
                initialEngine: sharedEngine,
              },
            );
            if (!threadId) {
              return null;
            }
            updateSharedSessionEngineSelection(
              targetWorkspace.id,
              threadId,
              sharedEngine,
            );
            setActiveThreadId(threadId, targetWorkspace.id);
            collapseRightPanel();
            if (isCompact) {
              setActiveTab("codex");
            }
            return threadId;
          },
        );
      } catch (error) {
        alertError(error);
        return null;
      }
    },
    [
      activeEngine,
      activeWorkspace,
      alertError,
      collapseRightPanel,
      connectWorkspace,
      hideLoadingProgressDialog,
      isCompact,
      selectWorkspace,
      setActiveEngine,
      setActiveThreadId,
      setActiveTab,
      setWorkspaceHomeWorkspaceId,
      startSharedSessionForWorkspace,
      showLoadingProgressDialog,
      t,
      updateSharedSessionEngineSelection,
    ],
  );

  const handleContinueLatestConversation = useCallback(() => {
    const latest = recentThreads[0];
    if (!latest) {
      return;
    }
    handleSelectWorkspaceInstance(latest.workspaceId, latest.threadId);
  }, [handleSelectWorkspaceInstance, recentThreads]);

  const handleStartGuidedConversation = useCallback(
    async (prompt: string, engine: EngineType = "claude") => {
      const normalizedPrompt = prompt.trim();
      if (!activeWorkspace || !normalizedPrompt) {
        return;
      }
      try {
        setHomeOpen(false);
        setWorkspaceHomeWorkspaceId(null);
        if (!activeWorkspace.connected) {
          await connectWorkspace(activeWorkspace);
        }
        await setActiveEngine(engine);
        const threadId = await startThreadForWorkspace(activeWorkspace.id, {
          activate: true,
          engine,
        });
        if (!threadId) {
          return;
        }
        setActiveThreadId(threadId, activeWorkspace.id);
        collapseRightPanel();
        await sendUserMessageToThread(
          activeWorkspace,
          threadId,
          normalizedPrompt,
        );
        if (isCompact) {
          setActiveTab("codex");
        }
      } catch (error) {
        alertError(error);
      }
    },
    [
      activeWorkspace,
      alertError,
      collapseRightPanel,
      connectWorkspace,
      isCompact,
      sendUserMessageToThread,
      setHomeOpen,
      setActiveTab,
      setActiveEngine,
      setActiveThreadId,
      setWorkspaceHomeWorkspaceId,
      startThreadForWorkspace,
    ],
  );

  const handleRevealActiveWorkspace = useCallback(async () => {
    if (!activeWorkspace?.path) {
      return;
    }
    try {
      await revealItemInDir(activeWorkspace.path);
    } catch (error) {
      alertError(error);
    }
  }, [activeWorkspace?.path, alertError]);

  const handleDeleteWorkspaceConversations = useCallback(
    async (threadIds: string[]) => {
      if (!activeWorkspace || threadIds.length === 0) {
        return {
          succeededThreadIds: [],
          failed: [],
        } satisfies WorkspaceHomeDeleteResult;
      }
      const succeededThreadIds: string[] = [];
      const failed: WorkspaceHomeDeleteResult["failed"] = [];
      for (const threadId of threadIds) {
        const result = await removeThread(activeWorkspace.id, threadId);
        if (result.success) {
          succeededThreadIds.push(threadId);
          clearDraftForThread(threadId);
          removeImagesForThread(threadId);
          continue;
        }
        failed.push({
          threadId,
          code: result.code ?? "UNKNOWN",
          message: result.message ?? t("workspace.deleteConversationFailed"),
        });
      }
      if (failed.length > 0) {
        const failedReasonLine = failed
          .slice(0, 3)
          .map(
            (entry) =>
              `- ${entry.threadId}: ${t(`workspace.deleteErrorCode.${entry.code}`)}`,
          )
          .join("\n");
        alertError(
          `${t("workspace.deleteConversationsPartial", {
            succeeded: succeededThreadIds.length,
            failed: failed.length,
          })}${failedReasonLine ? `\n${failedReasonLine}` : ""}`,
        );
      }
      return {
        succeededThreadIds,
        failed,
      } satisfies WorkspaceHomeDeleteResult;
    },
    [
      activeWorkspace,
      alertError,
      clearDraftForThread,
      removeImagesForThread,
      removeThread,
      t,
    ],
  );
  const handleDeleteWorkspaceConversationsInSettings = useCallback(
    async (workspaceId: string, threadIds: string[]) => {
      if (!workspaceId || threadIds.length === 0) {
        return {
          succeededThreadIds: [],
          failed: [],
        };
      }
      const deleteResults = removeThreads
        ? await removeThreads(workspaceId, threadIds)
        : await Promise.all(
            threadIds.map((threadId) => removeThread(workspaceId, threadId)),
          );
      const succeededThreadIds: string[] = [];
      const failed: Array<{ threadId: string; code: string; message: string }> =
        [];
      for (const result of deleteResults) {
        if (result.success) {
          succeededThreadIds.push(result.threadId);
          clearDraftForThread(result.threadId);
          removeImagesForThread(result.threadId);
          continue;
        }
        failed.push({
          threadId: result.threadId,
          code: result.code ?? "UNKNOWN",
          message: result.message ?? t("workspace.deleteConversationFailed"),
        });
      }
      return {
        succeededThreadIds,
        failed,
      };
    },
    [
      clearDraftForThread,
      removeImagesForThread,
      removeThread,
      removeThreads,
      t,
    ],
  );

  const {
    handleOpenTaskConversation,
    handleRetryTaskRun,
    handleResumeTaskRun,
    handleCancelTaskRun,
    handleForkTaskRun,
    handleCloseTaskConversation,
    handleKanbanCreateTask,
    handleDispatchOrchestrationTask,
    taskProcessingMap,
    handleDragToInProgress,
  } = useAppShellKanbanExecutionSection(ctx);

  const orderValue = (entry: WorkspaceInfo) =>
    typeof entry.settings.sortOrder === "number"
      ? entry.settings.sortOrder
      : Number.MAX_SAFE_INTEGER;

  const handleMoveWorkspace = async (
    workspaceId: string,
    direction: "up" | "down",
  ) => {
    const target = workspacesById.get(workspaceId);
    if (!target || (target.kind ?? "main") === "worktree") {
      return;
    }
    const targetGroupId = target.settings.groupId ?? null;
    const ordered = workspaces
      .filter(
        (entry: WorkspaceInfo) =>
          (entry.kind ?? "main") !== "worktree" &&
          (entry.settings.groupId ?? null) === targetGroupId,
      )
      .slice()
      .sort((a: WorkspaceInfo, b: WorkspaceInfo) => {
        const orderDiff = orderValue(a) - orderValue(b);
        if (orderDiff !== 0) {
          return orderDiff;
        }
        return a.name.localeCompare(b.name);
      });
    const index = ordered.findIndex(
      (entry: WorkspaceInfo) => entry.id === workspaceId,
    );
    if (index === -1) {
      return;
    }
    const nextIndex = direction === "up" ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= ordered.length) {
      return;
    }
    const next = ordered.slice();
    const temp = next[index];
    next[index] = next[nextIndex];
    next[nextIndex] = temp;
    await Promise.all(
      next.map((entry: WorkspaceInfo, idx: number) =>
        updateWorkspaceSettings(entry.id, {
          sortOrder: idx,
        }),
      ),
    );
  };

  const shouldMountSpecHub = Boolean(activeWorkspace) && appMode === "chat";
  const showSpecHub = shouldMountSpecHub && activeTab === "spec";
  const rightPanelAvailable = Boolean(
    !isCompact &&
    activeWorkspace &&
    (appMode === "chat" || appMode === "gitHistory") &&
    !settingsOpen &&
    centerMode !== "memory",
  );
  const soloModeEnabled = Boolean(
    !isCompact &&
    activeWorkspace &&
    appMode === "chat" &&
    !settingsOpen &&
    !showSpecHub &&
    !showWorkspaceHome,
  );
  const { isSoloMode, toggleSoloMode, exitSoloMode } = useSoloMode({
    enabled: soloModeEnabled,
    activeTab,
    centerMode,
    filePanelMode,
    sidebarCollapsed,
    rightPanelCollapsed,
    setActiveTab,
    setCenterMode,
    setFilePanelMode,
    collapseSidebar,
    expandSidebar,
    collapseRightPanel,
    expandRightPanel,
    onEnterSoloMode: resetSoloSplitToHalf,
  });
  const sidebarToggleProps = {
    isCompact,
    sidebarCollapsed,
    rightPanelCollapsed,
    isLayoutSwapped: !isCompact && appSettings.layoutMode === "swapped",
    rightPanelAvailable,
    onCollapseSidebar: collapseSidebar,
    onExpandSidebar: expandSidebar,
    onCollapseRightPanel: collapseRightPanel,
    onExpandRightPanel: expandRightPanel,
  };

  useEffect(() => {
    if (!activeWorkspace && isSoloMode) {
      exitSoloMode();
    }
  }, [activeWorkspace, exitSoloMode, isSoloMode]);

  const { markManualNavigation: markLiveEditPreviewManualNavigation } =
    useLiveEditPreview({
      enabled: liveEditPreviewEnabled,
      timeline: workspaceActivity.timeline,
      centerMode,
      activeEditorFilePath,
      onOpenFile: (path) => {
        handleOpenFile(path);
      },
    });

  const handleOpenWorkspaceFile = useCallback(
    (
      path: string,
      location?: { line: number; column: number },
      options?: { editorSplitCompanion?: "chat" | "projectMap" },
    ) => {
      markLiveEditPreviewManualNavigation();
      handleOpenFile(path, location, options);
    },
    [handleOpenFile, markLiveEditPreviewManualNavigation],
  );

  const handleActivateWorkspaceFileTab = useCallback(
    (path: string) => {
      markLiveEditPreviewManualNavigation();
      handleActivateFileTab(path);
    },
    [handleActivateFileTab, markLiveEditPreviewManualNavigation],
  );

  const handleCloseWorkspaceFileTab = useCallback(
    (path: string) => {
      markLiveEditPreviewManualNavigation();
      handleCloseFileTab(path);
    },
    [handleCloseFileTab, markLiveEditPreviewManualNavigation],
  );

  const handleCloseAllWorkspaceFileTabs = useCallback(() => {
    markLiveEditPreviewManualNavigation();
    handleCloseAllFileTabs();
  }, [handleCloseAllFileTabs, markLiveEditPreviewManualNavigation]);

  const handleExitWorkspaceEditor = useCallback(() => {
    markLiveEditPreviewManualNavigation();
    handleExitEditor();
  }, [handleExitEditor, markLiveEditPreviewManualNavigation]);

  const showComposer =
    Boolean(selectedKanbanTaskId) ||
    (!isCompact
      ? (centerMode === "chat" ||
          centerMode === "diff" ||
          centerMode === "editor" ||
          centerMode === "notes") &&
        !showSpecHub &&
        !showWorkspaceHome
      : (isTablet ? tabletTab : activeTab) === "codex" && !showWorkspaceHome);
  const showGitDetail = Boolean(selectedDiffPath) && isPhone;
  const isThreadOpen = Boolean(activeThreadId && showComposer);
  const handleSelectDiffForPanel = useCallback(
    (path: string | null) => {
      markLiveEditPreviewManualNavigation();
      if (!path) {
        setSelectedDiffPath(null);
        return;
      }
      handleSelectDiff(path);
    },
    [
      handleSelectDiff,
      markLiveEditPreviewManualNavigation,
      setSelectedDiffPath,
    ],
  );
  const handleCloseGitHistoryPanel = useCallback(() => {
    setAppMode("chat");
  }, [setAppMode]);
  const normalizeWorkspacePath = useCallback(
    (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, ""),
    [],
  );
  const handleSelectWorkspacePathForGitHistory = useCallback(
    async (path: string) => {
      const normalizedTarget = normalizeWorkspacePath(path);
      const existing = workspaces.find(
        (entry: WorkspaceInfo) =>
          normalizeWorkspacePath(entry.path) === normalizedTarget,
      );
      if (existing) {
        setActiveWorkspaceId(existing.id);
        return;
      }
      try {
        const workspace = await addWorkspaceFromPath(path);
        if (workspace) {
          setActiveWorkspaceId(workspace.id);
        }
      } catch (error) {
        addDebugEntry({
          id: `${Date.now()}-git-history-select-workspace-path-error`,
          timestamp: Date.now(),
          source: "error",
          label: "git-history/select-workspace-path error",
          payload: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [
      addDebugEntry,
      addWorkspaceFromPath,
      normalizeWorkspacePath,
      setActiveWorkspaceId,
      workspaces,
    ],
  );

  const handleOpenSpecHub = useCallback(() => {
    if (!activeWorkspace) {
      pushErrorToast({
        title: t("sidebar.specHub"),
        message: t("specHub.runtime.selectWorkspaceFirst"),
      });
      return;
    }
    closeSettings();
    setActiveTab((current: string) => (current === "spec" ? "codex" : current));
    void getWorkspaceFiles(activeWorkspace.id)
      .then((result) =>
        openOrFocusDetachedSpecHub(
          buildDetachedSpecHubSession({
            workspaceId: activeWorkspace.id,
            workspaceName: activeWorkspace.name,
            files: result.files,
            directories: result.directories,
          }),
        ),
      )
      .catch((error) => {
        pushErrorToast({
          title: t("sidebar.specHub"),
          message: error instanceof Error ? error.message : String(error),
        });
      });
  }, [activeWorkspace, closeSettings, setActiveTab, t]);

  const handleOpenClientDocumentation = useCallback(() => {
    void openOrFocusClientDocumentationWindow().catch((error) => {
      pushErrorToast({
        title: t("clientDocumentation.open"),
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }, [t]);

  const handleOpenWorkspaceHome = useCallback(() => {
    exitDiffView();
    resetPullRequestSelection();
    setHomeOpen(false);
    setAppMode("chat");
    setCenterMode("chat");
    setActiveTab("codex");
    if (activeWorkspaceId) {
      setWorkspaceHomeWorkspaceId(activeWorkspaceId);
      selectWorkspace(activeWorkspaceId);
      setActiveThreadId(null, activeWorkspaceId);
      return;
    }
    setWorkspaceHomeWorkspaceId(null);
    selectHome();
  }, [
    activeWorkspaceId,
    exitDiffView,
    resetPullRequestSelection,
    setActiveTab,
    setAppMode,
    setCenterMode,
    setHomeOpen,
    setWorkspaceHomeWorkspaceId,
    selectHome,
    selectWorkspace,
    setActiveThreadId,
  ]);

  const handleOpenHomeChat = useCallback(() => {
    exitDiffView();
    resetPullRequestSelection();
    setWorkspaceHomeWorkspaceId(null);
    setAppMode("chat");
    setCenterMode("chat");
    setHomeOpen(true);
    if (homeWorkspaceSelectedId) {
      setActiveWorkspaceId(homeWorkspaceSelectedId);
      setActiveThreadId(null, homeWorkspaceSelectedId);
      return;
    }
    selectHome();
  }, [
    exitDiffView,
    homeWorkspaceSelectedId,
    resetPullRequestSelection,
    selectHome,
    setAppMode,
    setCenterMode,
    setActiveThreadId,
    setActiveWorkspaceId,
    setHomeOpen,
    setWorkspaceHomeWorkspaceId,
  ]);

  const handleSelectHomeWorkspace = useCallback(
    (workspaceId: string) => {
      if (!workspaceId) {
        return;
      }
      exitDiffView();
      resetPullRequestSelection();
      setWorkspaceHomeWorkspaceId(null);
      setAppMode("chat");
      setCenterMode("chat");
      setHomeOpen(true);
      setActiveWorkspaceId(workspaceId);
      setActiveThreadId(null, workspaceId);
    },
    [
      exitDiffView,
      resetPullRequestSelection,
      setAppMode,
      setCenterMode,
      setActiveThreadId,
      setActiveWorkspaceId,
      setHomeOpen,
      setWorkspaceHomeWorkspaceId,
    ],
  );

  const handleOpenKanbanMode = useCallback(() => {
    setHomeOpen(false);
    setAppMode("kanban");
    closeSettings();
  }, [closeSettings, setAppMode, setHomeOpen]);

  const handleOpenFilesSurface = useCallback(() => {
    closeSettings();
    setAppMode("chat");
    setCenterMode("chat");
    setFilePanelMode("files");
    expandRightPanel();
    if (isCompact) {
      setActiveTab("git");
    }
  }, [
    closeSettings,
    expandRightPanel,
    isCompact,
    setActiveTab,
    setAppMode,
    setCenterMode,
    setFilePanelMode,
  ]);

  usePrimaryModeShortcuts({
    isEnabled: true,
    openChatShortcut: appSettings.openChatShortcut,
    openKanbanShortcut: appSettings.openKanbanShortcut,
    onOpenChat: handleOpenHomeChat,
    onOpenKanban: handleOpenKanbanMode,
  });

  useAppSurfaceShortcuts({
    isCompact,
    rightPanelAvailable,
    sidebarCollapsed,
    rightPanelCollapsed,
    toggleLeftConversationSidebarShortcut:
      appSettings.toggleLeftConversationSidebarShortcut,
    toggleRightConversationSidebarShortcut:
      appSettings.toggleRightConversationSidebarShortcut,
    toggleRuntimeConsoleShortcut: appSettings.toggleRuntimeConsoleShortcut,
    toggleFilesSurfaceShortcut: appSettings.toggleFilesSurfaceShortcut,
    onExpandSidebar: expandSidebar,
    onCollapseSidebar: collapseSidebar,
    onExpandRightPanel: expandRightPanel,
    onCollapseRightPanel: collapseRightPanel,
    onToggleRuntimeConsole: handleToggleRuntimeConsole,
    onOpenFilesSurface: handleOpenFilesSurface,
  });

  useArchiveShortcut({
    isEnabled: isThreadOpen,
    shortcut: appSettings.archiveThreadShortcut,
    onTrigger: handleArchiveActiveThread,
  });

  const { handleCycleAgent, handleCycleWorkspace } = useWorkspaceCycling({
    workspaces,
    groupedWorkspaces,
    threadsByWorkspace,
    getThreadRows,
    getPinTimestamp,
    activeWorkspaceIdRef,
    activeThreadIdRef,
    activeEditorFilePath,
    centerMode,
    exitDiffView,
    isCompact,
    resetPullRequestSelection,
    selectWorkspace,
    setActiveThreadId,
    setSelectedDiffPath,
  });

  useAppMenuEvents({
    activeWorkspaceRef,
    baseWorkspaceRef,
    onAddWorkspace: () => {
      void handleAddWorkspace();
    },
    onNewWindow: () => {
      void handleOpenNewWindow();
    },
    onAddAgent: (workspace, engine, options) => {
      void handleAddAgent(workspace, engine, options);
    },
    onAddWorktreeAgent: (workspace) => {
      void handleAddWorktreeAgent(workspace);
    },
    onAddCloneAgent: (workspace) => {
      void handleAddCloneAgent(workspace);
    },
    onOpenSettings: () => openSettings(),
    onCycleAgent: handleCycleAgent,
    onCycleWorkspace: handleCycleWorkspace,
    onToggleDebug: handleDebugClick,
    onToggleTerminal: handleToggleTerminalPanel,
    onToggleGlobalSearch: handleToggleSearchPalette,
    sidebarCollapsed,
    rightPanelCollapsed,
    rightPanelAvailable,
    onExpandSidebar: expandSidebar,
    onCollapseSidebar: collapseSidebar,
    onExpandRightPanel: expandRightPanel,
    onCollapseRightPanel: collapseRightPanel,
  });

  useMenuAcceleratorController({ appSettings, onDebug: addDebugEntry });
  useMenuLocalization();
  const handleRefreshAccountRateLimits = useCallback(
    () => refreshAccountRateLimits(activeWorkspaceId ?? undefined),
    [activeWorkspaceId, refreshAccountRateLimits],
  );
  const dropOverlayActive = isWorkspaceDropActive;
  const dropOverlayText = "Drop Project Here";
  const shouldShowSidebarTopbarContent = false;
  const appClassName = `app ${isCompact ? "layout-compact" : "layout-desktop"}${
    isPhone ? " layout-phone" : ""
  }${isTablet ? " layout-tablet" : ""}${
    isWindowsDesktop ? " windows-desktop" : ""
  }${isMacDesktop ? " macos-desktop" : ""}${
    reduceTransparency ? " reduced-transparency" : ""
  }${appSettings.canvasWidthMode === "wide" ? " canvas-width-wide" : ""}${
    !isCompact && appSettings.layoutMode === "swapped" ? " layout-swapped" : ""
  }${!isCompact && sidebarCollapsed ? " sidebar-collapsed" : ""}${
    !isCompact && rightPanelCollapsed ? " right-panel-collapsed" : ""
  }${shouldShowSidebarTopbarContent ? " sidebar-title-relocated" : ""}${
    showHome ? " home-active" : ""
  }${showKanban ? " kanban-active" : ""}${
    showPlugins ? " plugins-active" : ""
  }${
    showGitHistory ? " git-history-active" : ""
  }${isSoloMode ? " solo-mode" : ""}`;

  const runtimeActions = defineAppShellRuntimeActions({
    handleToggleRuntimeConsole,
    handleToggleTerminalPanel,
  });
  const taskRunActions = defineAppShellTaskRunActions({
    handleOpenTaskConversation,
    handleRetryTaskRun,
    handleResumeTaskRun,
    handleCancelTaskRun,
    handleForkTaskRun,
    handleCloseTaskConversation,
    handleKanbanCreateTask,
    handleDispatchOrchestrationTask,
    handleDragToInProgress,
  });
  const navigationActions = defineAppShellNavigationActions({
    handleSelectWorkspaceInstance,
    handleStartWorkspaceConversation,
    handleStartSharedConversation,
    handleContinueLatestConversation,
    handleStartGuidedConversation,
    handleRevealActiveWorkspace,
    handleOpenSpecHub,
    handleOpenClientDocumentation,
    handleOpenWorkspaceHome,
    handleOpenHomeChat,
    handleSelectHomeWorkspace,
    handleSelectWorkspacePathForGitHistory,
  });
  const contextActions = defineAppShellContextActions({
    handleOpenWorkspaceFile,
    handleActivateWorkspaceFileTab,
    handleCloseWorkspaceFileTab,
    handleCloseAllWorkspaceFileTabs,
    handleExitWorkspaceEditor,
    handleSelectDiffForPanel,
    handleRewindFromMessage,
    handleDeleteWorkspaceConversations,
    handleDeleteWorkspaceConversationsInSettings,
  });

  return {
    ...runtimeActions,
    ...taskRunActions,
    ...navigationActions,
    ...contextActions,
    selectedComposerKanbanPanelId,
    setSelectedComposerKanbanPanelId,
    composerKanbanContextMode,
    setComposerKanbanContextMode,
    composerLinkedKanbanPanels,
    handleOpenComposerKanbanPanel,
    handleComposerSendWithEditorFallback,
    handleComposerQueueWithEditorFallback,
    taskProcessingMap,
    handleMoveWorkspace,
    shouldMountSpecHub,
    showSpecHub,
    rightPanelAvailable,
    soloModeEnabled,
    isSoloMode,
    toggleSoloMode,
    sidebarToggleProps,
    showComposer,
    showGitDetail,
    handleCloseGitHistoryPanel,
    handleRefreshAccountRateLimits,
    dropOverlayActive,
    dropOverlayText,
    shouldShowSidebarTopbarContent,
    appClassName,
    isPullRequestComposer,
    composerSendLabel,
    handleToggleSearchPalette,
  };
}
