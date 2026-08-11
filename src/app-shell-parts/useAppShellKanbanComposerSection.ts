import { useCallback, useEffect, useMemo, useState } from "react";
import { homeDir } from "@tauri-apps/api/path";
import { ensureWorkspacePathDir, isWebServiceRuntime } from "../services/tauri";
import { resolveKanbanThreadCreationStrategy } from "../features/kanban/utils/contextMode";
import { deriveKanbanTaskTitle } from "../features/kanban/utils/taskTitle";
import {
  getDefaultWorkspaceCandidatePaths,
  isDefaultWorkspacePath,
} from "../features/workspaces/utils/defaultWorkspace";
import type {
  MessageSendOptions,
  ThreadSummary,
  WorkspaceInfo,
} from "../types";
import type { KanbanPanel } from "../features/kanban/types";
import type { KanbanContextMode } from "../features/kanban/utils/contextMode";
import { stripComposerKanbanTagsPreserveFormatting } from "./useAppShellSections.kanbanHelpers";
import type { UseAppShellSectionsContext } from "./useAppShellSectionsTypes";

type ComposerKanbanPanelOption = Pick<
  KanbanPanel,
  "id" | "name" | "workspaceId" | "createdAt"
>;

export function useAppShellKanbanComposerSection(
  ctx: UseAppShellSectionsContext,
) {
  const {
    activeWorkspace,
    workspaces,
    kanbanPanels,
    setKanbanViewState,
    setAppMode,
    activeEngine,
    selectedAgent,
    selectedAgentRef,
    activeWorkspaceId,
    activeThreadId,
    normalizePath,
    addWorkspaceFromPath,
    alertError,
    workspacesById,
    exitDiffView,
    connectWorkspace,
    startThreadForWorkspace,
    persistComposerSelectionForThread,
    setActiveEngine,
    setHomeOpen,
    setCenterMode,
    selectWorkspace,
    setActiveThreadId,
    sendUserMessageToThread,
    handleComposerSend,
    isPullRequestComposer,
    resetPullRequestSelection,
    threadsByWorkspace,
    addDebugEntry,
    effectiveSelectedModelId,
    kanbanCreateTask,
    kanbanUpdateTask,
    forkThreadForWorkspace,
    setWorkspaceHomeWorkspaceId,
    handleComposerQueue,
  } = ctx;
  const typedWorkspaces = workspaces as WorkspaceInfo[];
  const typedKanbanPanels = kanbanPanels as KanbanPanel[];
  const typedThreadsByWorkspace = threadsByWorkspace as Record<
    string,
    ThreadSummary[]
  >;

  const [selectedComposerKanbanPanelId, setSelectedComposerKanbanPanelId] =
    useState<string | null>(null);
  const [composerKanbanContextMode, setComposerKanbanContextMode] =
    useState<KanbanContextMode>("new");
  const composerKanbanWorkspacePaths = useMemo(() => {
    if (!activeWorkspace) {
      return [] as string[];
    }
    const paths = new Set<string>();
    paths.add(activeWorkspace.path);
    if (activeWorkspace.parentId) {
      const parentWorkspace = typedWorkspaces.find(
        (workspace) => workspace.id === activeWorkspace.parentId,
      );
      if (parentWorkspace) {
        paths.add(parentWorkspace.path);
      }
    }
    // If current workspace is a parent/main workspace, include its worktrees too.
    for (const workspace of typedWorkspaces) {
      if (workspace.parentId === activeWorkspace.id) {
        paths.add(workspace.path);
      }
    }
    return Array.from(paths);
  }, [activeWorkspace, typedWorkspaces]);
  const composerLinkedKanbanPanels = useMemo<
    ComposerKanbanPanelOption[]
  >(() => {
    if (composerKanbanWorkspacePaths.length === 0) {
      return [];
    }
    return typedKanbanPanels
      .filter((panel) =>
        composerKanbanWorkspacePaths.includes(panel.workspaceId),
      )
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt || a.sortOrder - b.sortOrder)
      .map((panel) => ({
        id: panel.id,
        name: panel.name,
        workspaceId: panel.workspaceId,
        createdAt: panel.createdAt,
      }));
  }, [composerKanbanWorkspacePaths, typedKanbanPanels]);

  useEffect(() => {
    if (!selectedComposerKanbanPanelId) {
      return;
    }
    const stillExists = composerLinkedKanbanPanels.some(
      (panel) => panel.id === selectedComposerKanbanPanelId,
    );
    if (!stillExists) {
      setSelectedComposerKanbanPanelId(null);
    }
  }, [composerLinkedKanbanPanels, selectedComposerKanbanPanelId]);

  const handleOpenComposerKanbanPanel = useCallback(
    (panelId: string) => {
      const panel = composerLinkedKanbanPanels.find(
        (entry) => entry.id === panelId,
      );
      if (!panel) {
        return;
      }
      setKanbanViewState({
        view: "board",
        workspaceId: panel.workspaceId,
        panelId,
      });
      setAppMode("kanban");
    },
    [composerLinkedKanbanPanels, setAppMode, setKanbanViewState],
  );

  const resolveDefaultHomeComposerWorkspace =
    useCallback(async (): Promise<WorkspaceInfo | null> => {
      if (isWebServiceRuntime()) {
        const existingWorkspace =
          typedWorkspaces.find((entry) => isDefaultWorkspacePath(entry.path)) ??
          typedWorkspaces.find((entry) => entry.kind === "main") ??
          typedWorkspaces[0] ??
          null;
        if (existingWorkspace) {
          return existingWorkspace;
        }

        try {
          const resolvedHome = normalizePath(await homeDir());
          if (!resolvedHome) {
            throw new Error("Unable to resolve default workspace path.");
          }
          let createdWorkspacePath: string | null = null;
          let lastError: unknown = null;
          for (const candidatePath of getDefaultWorkspaceCandidatePaths(
            resolvedHome,
          )) {
            try {
              await ensureWorkspacePathDir(candidatePath);
              createdWorkspacePath = candidatePath;
              break;
            } catch (error) {
              lastError = error;
            }
          }
          if (!createdWorkspacePath) {
            throw (
              lastError ?? new Error("Failed to create default workspace path.")
            );
          }
          const normalizedDefaultPath = normalizePath(createdWorkspacePath);
          return (
            typedWorkspaces.find(
              (entry) =>
                normalizePath(entry.path) === normalizedDefaultPath,
            ) ?? (await addWorkspaceFromPath(createdWorkspacePath))
          );
        } catch (error) {
          alertError(error);
          return null;
        }
      }

      try {
        const resolvedHome = normalizePath(await homeDir());
        const defaultWorkspacePath = `${resolvedHome}/.doge/workspace`;
        await ensureWorkspacePathDir(defaultWorkspacePath);
        const normalizedDefaultPath = normalizePath(defaultWorkspacePath);
        return (
          typedWorkspaces.find(
            (entry) => normalizePath(entry.path) === normalizedDefaultPath,
          ) ?? (await addWorkspaceFromPath(defaultWorkspacePath))
        );
      } catch (error) {
        alertError(error);
        return null;
      }
    }, [
      addWorkspaceFromPath,
      alertError,
      normalizePath,
      typedWorkspaces,
    ]);

  const resolveComposerKanbanPanel = useCallback(
    (text: string) => {
      const tagMatches = Array.from(text.matchAll(/&@([^\s]+)/g))
        .map((entry) => entry[1]?.trim())
        .filter((value): value is string => Boolean(value));
      const panelByName = new Map(
        composerLinkedKanbanPanels.map((panel) => [panel.name, panel.id]),
      );
      const firstTaggedPanelId =
        tagMatches.map((name) => panelByName.get(name)).find(Boolean) ?? null;
      const panelId =
        firstTaggedPanelId ??
        (selectedComposerKanbanPanelId &&
        composerLinkedKanbanPanels.some(
          (panel) => panel.id === selectedComposerKanbanPanelId,
        )
          ? selectedComposerKanbanPanelId
          : null);
      const cleanText = stripComposerKanbanTagsPreserveFormatting(text);
      return { panelId, cleanText };
    },
    [composerLinkedKanbanPanels, selectedComposerKanbanPanelId],
  );

  const mergeSelectedAgentOption = useCallback(
    (options?: MessageSendOptions): MessageSendOptions | undefined => {
      if (activeEngine === "opencode") {
        return options;
      }
      const selectedAgentForSend =
        selectedAgentRef?.current ?? selectedAgent ?? null;
      const merged: MessageSendOptions = {
        ...(options ?? {}),
        selectedAgent: selectedAgentForSend
          ? {
              id: selectedAgentForSend.id,
              name: selectedAgentForSend.name,
              prompt: selectedAgentForSend.prompt ?? null,
              icon: selectedAgentForSend.icon ?? null,
            }
          : null,
      };
      return merged;
    },
    [activeEngine, selectedAgent, selectedAgentRef],
  );

  const handleComposerSendWithKanban = useCallback(
    async (text: string, images: string[], options?: MessageSendOptions) => {
      const trimmedOriginalText = text.trim();
      const { panelId, cleanText } =
        resolveComposerKanbanPanel(trimmedOriginalText);
      const textForSending = cleanText;
      const createSessionTarget = options?.createSessionTarget ?? null;

      if (createSessionTarget && !isPullRequestComposer) {
        const workspace =
          (activeWorkspaceId
            ? workspacesById.get(activeWorkspaceId) ?? null
            : null) ?? (await resolveDefaultHomeComposerWorkspace());
        if (!workspace) {
          return;
        }

        const {
          createSessionTarget: _consumedCreateSessionTarget,
          ...turnOptions
        } = options ?? {};
        const providerProfile = createSessionTarget.providerProfileId
          ? {
              id: createSessionTarget.providerProfileId,
              name:
                createSessionTarget.providerProfileName ??
                createSessionTarget.providerProfileId,
              source: createSessionTarget.providerProfileSource,
            }
          : null;

        exitDiffView();
        resetPullRequestSelection();
        setHomeOpen(false);
        setWorkspaceHomeWorkspaceId(null);
        setAppMode("chat");
        setCenterMode("chat");
        selectWorkspace(workspace.id);
        if (!workspace.connected) {
          await connectWorkspace(workspace);
        }
        await setActiveEngine(createSessionTarget.engine);
        const threadId = await startThreadForWorkspace(workspace.id, {
          engine: createSessionTarget.engine,
          activate: true,
          providerProfileId: createSessionTarget.providerProfileId,
          providerProfile,
        });
        if (!threadId) {
          return;
        }
        persistComposerSelectionForThread(workspace.id, threadId, {
          modelId: createSessionTarget.modelCatalogEntryId,
          effort: createSessionTarget.effort,
        });
        setActiveThreadId(threadId, workspace.id);

        const fallbackText =
          textForSending.length > 0 ? textForSending : trimmedOriginalText;
        if (fallbackText.length > 0 || images.length > 0) {
          await sendUserMessageToThread(
            workspace,
            threadId,
            fallbackText,
            images,
            mergeSelectedAgentOption({
              ...turnOptions,
              model: createSessionTarget.model,
              effort: createSessionTarget.effort,
            }),
          );
        }
        return;
      }

      // HomeChat send: no active workspace yet. Select or create one, then
      // create a thread and jump to normal chat view before sending.
      if (!activeWorkspaceId && !isPullRequestComposer) {
        const workspace = await resolveDefaultHomeComposerWorkspace();
        if (!workspace) {
          return;
        }
        exitDiffView();
        resetPullRequestSelection();
        setWorkspaceHomeWorkspaceId(null);
        setAppMode("chat");
        setCenterMode("chat");
        selectWorkspace(workspace.id);
        if (!workspace.connected) {
          await connectWorkspace(workspace);
        }
        const threadId = await startThreadForWorkspace(workspace.id, {
          engine: activeEngine,
          activate: true,
        });
        if (!threadId) {
          return;
        }
        setActiveThreadId(threadId, workspace.id);
        const fallbackText =
          textForSending.length > 0 ? textForSending : trimmedOriginalText;
        if (fallbackText.length > 0 || images.length > 0) {
          await sendUserMessageToThread(
            workspace,
            threadId,
            fallbackText,
            images,
            mergeSelectedAgentOption(options),
          );
        }
        return;
      }

      if (!panelId || !activeWorkspaceId || isPullRequestComposer) {
        const fallbackText =
          textForSending.length > 0 ? textForSending : trimmedOriginalText;
        await handleComposerSend(
          fallbackText,
          images,
          mergeSelectedAgentOption(options),
        );
        return;
      }

      const workspace = workspacesById.get(activeWorkspaceId);
      if (!workspace) {
        await handleComposerSend(
          textForSending.length > 0 ? textForSending : trimmedOriginalText,
          images,
          mergeSelectedAgentOption(options),
        );
        return;
      }

      // &@ 看板消息必须在新会话里执行，不能污染当前会话窗口
      if (!workspace.connected) {
        await connectWorkspace(workspace);
      }
      const engine = (activeEngine === "codex" ? "codex" : "claude") as
        | "codex"
        | "claude";
      const activeThreadEngine =
        activeThreadId && activeWorkspaceId
          ? (typedThreadsByWorkspace[activeWorkspaceId]?.find(
              (thread) => thread.id === activeThreadId,
            )?.engineSource ?? null)
          : null;
      const isActiveThreadInWorkspace = Boolean(
        activeWorkspaceId &&
        activeThreadId &&
        typedThreadsByWorkspace[activeWorkspaceId]?.some(
          (thread) => thread.id === activeThreadId,
        ),
      );
      const threadCreationStrategy = resolveKanbanThreadCreationStrategy({
        mode: composerKanbanContextMode,
        engine,
        activeThreadId,
        activeThreadEngine,
        activeWorkspaceId,
        targetWorkspaceId: workspace.id,
        isActiveThreadInWorkspace,
      });
      const canInheritViaFork = threadCreationStrategy === "inherit";
      const threadId =
        canInheritViaFork && activeThreadId
          ? await forkThreadForWorkspace(activeWorkspaceId, activeThreadId, {
              activate: false,
            })
          : await startThreadForWorkspace(activeWorkspaceId, {
              engine,
              activate: false,
            });
      const resolvedThreadId =
        threadId ??
        (await startThreadForWorkspace(activeWorkspaceId, {
          engine,
          activate: false,
        }));
      if (!resolvedThreadId) {
        return;
      }
      if (canInheritViaFork && !threadId) {
        addDebugEntry({
          id: `${Date.now()}-kanban-linked-fork-fallback`,
          timestamp: Date.now(),
          source: "client",
          label: "kanban/linked fork fallback",
          payload: {
            workspaceId: activeWorkspaceId,
            reason: "fork-unavailable",
          },
        });
      }

      if (textForSending.length > 0 || images.length > 0) {
        await sendUserMessageToThread(
          workspace,
          resolvedThreadId,
          textForSending,
          images,
          mergeSelectedAgentOption(options),
        );
      }

      const taskDescription =
        textForSending.length > 0 ? textForSending : trimmedOriginalText;
      const taskFallbackTitle =
        composerLinkedKanbanPanels.find((panel) => panel.id === panelId)
          ?.name || "Kanban Task";
      const taskTitle = deriveKanbanTaskTitle(
        taskDescription,
        taskFallbackTitle,
      );
      const createdTask = kanbanCreateTask({
        workspaceId: workspace.path,
        panelId,
        title: taskTitle,
        description: taskDescription,
        engineType: engine,
        modelId: effectiveSelectedModelId,
        branchName: "main",
        images,
        autoStart: true,
      });

      kanbanUpdateTask(createdTask.id, {
        threadId: resolvedThreadId,
        status: "inprogress",
      });
    },
    [
      resolveComposerKanbanPanel,
      handleComposerSend,
      mergeSelectedAgentOption,
      activeWorkspaceId,
      resolveDefaultHomeComposerWorkspace,
      workspacesById,
      exitDiffView,
      resetPullRequestSelection,
      selectWorkspace,
      setAppMode,
      setActiveThreadId,
      setCenterMode,
      setHomeOpen,
      setWorkspaceHomeWorkspaceId,
      connectWorkspace,
      setActiveEngine,
      startThreadForWorkspace,
      persistComposerSelectionForThread,
      forkThreadForWorkspace,
      sendUserMessageToThread,
      isPullRequestComposer,
      activeEngine,
      activeThreadId,
      typedThreadsByWorkspace,
      addDebugEntry,
      composerKanbanContextMode,
      effectiveSelectedModelId,
      composerLinkedKanbanPanels,
      kanbanCreateTask,
      kanbanUpdateTask,
    ],
  );

  const handleComposerSendWithEditorFallback = useCallback(
    async (text: string, images: string[], options?: MessageSendOptions) => {
      await handleComposerSendWithKanban(text, images, options);
    },
    [handleComposerSendWithKanban],
  );

  const handleComposerQueueWithEditorFallback = useCallback(
    async (text: string, images: string[], options?: MessageSendOptions) => {
      await handleComposerQueue(
        text,
        images,
        mergeSelectedAgentOption(options),
      );
    },
    [handleComposerQueue, mergeSelectedAgentOption],
  );

  return {
    selectedComposerKanbanPanelId,
    setSelectedComposerKanbanPanelId,
    composerKanbanContextMode,
    setComposerKanbanContextMode,
    composerLinkedKanbanPanels,
    handleOpenComposerKanbanPanel,
    handleComposerSendWithEditorFallback,
    handleComposerQueueWithEditorFallback,
  };
}
