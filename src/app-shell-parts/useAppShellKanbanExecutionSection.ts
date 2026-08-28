import { useCallback, useEffect, useMemo, useRef } from "react";
import { captureBrowserAgentSnapshot } from "../services/tauri";
import { isKanbanThreadCompatibleWithTarget } from "../features/kanban/utils/contextMode";
import { findTaskDownstream } from "../features/kanban/utils/chaining";
import {
  buildChainedPromptPrefix,
  extractKanbanResultSnapshot,
} from "../features/kanban/utils/resultSnapshot";
import {
  beginKanbanTaskRunLifecycle,
  patchKanbanTaskRunLifecycle,
} from "../features/tasks/utils/kanbanTaskRunLifecycle";
import {
  beginTaskRunRecovery,
  cancelTaskRunRecovery,
} from "../features/tasks/utils/taskRunRecovery";
import { buildLatestRunSummary } from "../features/tasks/utils/taskRunProjection";
import { deriveTaskRunTelemetryPatch } from "../features/tasks/utils/taskRunTelemetry";
import {
  buildTaskRunBrowserEvidenceRef,
  loadTaskRunStore,
} from "../features/tasks/utils/taskRunStorage";
import {
  buildBrowserContextAttachment,
  getActiveBrowserContext,
} from "../features/browser-agent";
import type { TaskRunRecord } from "../features/tasks/types";
import {
  applyMissedRunPolicy,
  hasReachedRecurringRoundLimit,
  isScheduleDue,
  markRecurringScheduleCompleted,
  markScheduleTriggered,
  resolvePostProcessingStatus,
} from "../features/kanban/utils/scheduling";
import type {
  KanbanTask,
  KanbanTaskExecutionSource,
  KanbanTaskStatus,
  KanbanViewState,
} from "../features/kanban/types";
import type { ThreadSummary, WorkspaceInfo } from "../types";
import { isEngineExecutionEnabled } from "../utils/engineExecutionPolicy";
import {
  buildRecurringKanbanTaskCloneInput,
  resolvePendingSessionThreadCandidate,
  resolveTaskThreadId,
  syncKanbanExecutionEngineAndModel,
} from "./useAppShellSections.kanbanHelpers";
import type { UseAppShellSectionsContext } from "./useAppShellSectionsTypes";
import { ensureProductEngineReadyV1 } from "../features/account/runtime/productEngineProvisioning";
import { readProductEntitlementSnapshotV1 } from "../features/account/runtime/productEntitlementStore";
import { isNewTaskRunEngine } from "../features/tasks/taskRunEnginePolicy";
import {
  prepareKanbanExecutionTarget,
  resolveKanbanExecutionTarget,
} from "./kanbanExecutionTarget";

// 到期任务的最小重查间隔：next-due 对齐定时器的下限，防止过期 nextRunAt 造成忙循环。
const KANBAN_SCHEDULER_MIN_INTERVAL_MS = 5_000;
const KANBAN_EXECUTION_LOCK_STALE_MS = 120_000;

type CreateKanbanTaskInput = Pick<
  KanbanTask,
  | "workspaceId"
  | "panelId"
  | "title"
  | "description"
  | "engineType"
  | "modelId"
  | "executionTarget"
  | "branchName"
  | "images"
  | "autoStart"
  | "schedule"
  | "chain"
>;

export function useAppShellKanbanExecutionSection(
  ctx: UseAppShellSectionsContext,
) {
  const {
    activeWorkspaceId,
    activeThreadId,
    interruptTurn,
    connectWorkspace,
    startThreadForWorkspace,
    selectWorkspace,
    setActiveThreadId,
    sendUserMessageToThread,
    threadsByWorkspace,
    setActiveEngine,
    persistComposerSelectionForThread,
    resolveComposerSelectionForThread,
    threadItemsByThread,
    threadStatusById,
    kanbanTasks,
    appMode,
    setSelectedKanbanTaskId,
    workspacesByPath,
    setActiveWorkspaceId,
    kanbanViewState,
    kanbanCreateTask,
    kanbanUpdateTask,
    resolveCanonicalThreadId,
  } = ctx;
  const typedKanbanTasks = kanbanTasks as KanbanTask[];
  const typedThreadItemsByThread = threadItemsByThread as Record<string, any[]>;
  const typedThreadsByWorkspace = threadsByWorkspace as Record<
    string,
    ThreadSummary[]
  >;
  const typedThreadStatusById = threadStatusById as Record<string, any>;
  const typedWorkspacesByPath = workspacesByPath as Map<string, WorkspaceInfo>;
  const typedKanbanViewState = kanbanViewState as KanbanViewState;

  const kanbanTasksRef = useRef<KanbanTask[]>(typedKanbanTasks);
  const schedulerStartedAtRef = useRef(Date.now());
  const kanbanExecutionLocksRef = useRef<
    Record<
      string,
      { token: string; source: KanbanTaskExecutionSource; acquiredAt: number }
    >
  >({});

  useEffect(() => {
    kanbanTasksRef.current = typedKanbanTasks;
  }, [typedKanbanTasks]);

  const updateTaskExecution = useCallback(
    (taskId: string, changes: Record<string, unknown>) => {
      const current = kanbanTasksRef.current.find((task) => task.id === taskId);
      if (!current) {
        return;
      }
      const currentExecution = (current.execution ?? {}) as Record<
        string,
        unknown
      >;
      // 等值短路：scheduler tick 每轮都会对 processing/locked 任务写相同值，
      // 无变化时不产生新 store 版本——既避免本文件 scheduler effect
      // （依赖 typedKanbanTasks）自触发无限循环，也消掉无效落盘。
      const hasEffectiveChange = Object.entries(changes).some(
        ([key, value]) => currentExecution[key] !== value,
      );
      if (!hasEffectiveChange) {
        return;
      }
      kanbanUpdateTask(taskId, {
        execution: {
          ...currentExecution,
          ...changes,
        },
      });
    },
    [kanbanUpdateTask],
  );

  const setTaskChainBlockedReason = useCallback(
    (taskId: string, blockedReason: string | null) => {
      const current = kanbanTasksRef.current.find((task) => task.id === taskId);
      if (!current?.chain) {
        return;
      }
      kanbanUpdateTask(taskId, {
        chain: {
          ...current.chain,
          blockedReason,
        },
      });
    },
    [kanbanUpdateTask],
  );

  const patchTaskRunAndProjectToKanban = useCallback(
    (input: Parameters<typeof patchKanbanTaskRunLifecycle>[0]) => {
      let result: ReturnType<typeof patchKanbanTaskRunLifecycle> = null;
      try {
        result = patchKanbanTaskRunLifecycle(input);
      } catch (error) {
        console.error("Failed to patch Kanban task run lifecycle", error);
        return null;
      }
      if (result?.latestRunSummary) {
        kanbanUpdateTask(result.run.task.taskId, {
          latestRunSummary: result.latestRunSummary,
        });
      }
      return result;
    },
    [kanbanUpdateTask],
  );

  const persistKanbanTaskComposerSelection = useCallback(
    (
      workspaceId: string,
      threadId: string,
      modelId: string | null | undefined,
    ) => {
      if (!modelId) {
        return;
      }
      const currentSelection = resolveComposerSelectionForThread(
        workspaceId,
        threadId,
      );
      persistComposerSelectionForThread(workspaceId, threadId, {
        modelId,
        effort: currentSelection?.effort ?? null,
      });
    },
    [persistComposerSelectionForThread, resolveComposerSelectionForThread],
  );

  const launchKanbanTaskExecution = useCallback(
    async (params: {
      taskId: string;
      source: KanbanTaskExecutionSource;
      activate?: boolean;
      injectedPrefix?: string;
      forceNewThread?: boolean;
      existingRunId?: string | null;
    }): Promise<
      { ok: true; threadId: string } | { ok: false; reason: string }
    > => {
      const task = kanbanTasksRef.current.find(
        (entry) => entry.id === params.taskId,
      );
      if (!task) {
        return { ok: false, reason: "task_not_found" };
      }
      const targetResolution = resolveKanbanExecutionTarget({
        task,
        product: readProductEntitlementSnapshotV1(),
      });
      if (!targetResolution.ok) {
        updateTaskExecution(task.id, {
          lastSource: params.source,
          blockedReason: targetResolution.reason,
        });
        return { ok: false, reason: targetResolution.reason };
      }
      const executionTarget = targetResolution.target;
      const requestedEngine = executionTarget.engine;
      if (
        !isEngineExecutionEnabled(requestedEngine) ||
        !isNewTaskRunEngine(requestedEngine)
      ) {
        updateTaskExecution(task.id, {
          lastSource: params.source,
          blockedReason: "unsupported_engine",
        });
        return { ok: false, reason: "unsupported_engine" };
      }
      let taskRunId: string | null = params.existingRunId ?? null;
      let launchedSuccessfully = false;
      if (params.source !== "chained" && task.chain?.previousTaskId) {
        setTaskChainBlockedReason(task.id, "chain_requires_head_trigger");
        updateTaskExecution(task.id, {
          lastSource: params.source,
          blockedReason: "chain_requires_head_trigger",
        });
        return { ok: false, reason: "chain_requires_head_trigger" };
      }
      if (params.source === "chained" && task.chain?.previousTaskId) {
        setTaskChainBlockedReason(task.id, null);
      }
      const existingLock = kanbanExecutionLocksRef.current[task.id];
      if (existingLock) {
        updateTaskExecution(task.id, {
          lastSource: params.source,
          blockedReason: "non_reentrant_trigger_blocked",
        });
        return { ok: false, reason: "non_reentrant_trigger_blocked" };
      }
      if (!taskRunId) {
        let taskRunResult: ReturnType<
          typeof beginKanbanTaskRunLifecycle
        > | null = null;
        try {
          taskRunResult = beginKanbanTaskRunLifecycle({
            task,
            source: params.source,
            executionTarget,
          });
        } catch (error) {
          console.error("Failed to begin Kanban task run lifecycle", error);
        }
        if (taskRunResult && !taskRunResult.ok) {
          if (taskRunResult.latestRunSummary) {
            kanbanUpdateTask(task.id, {
              latestRunSummary: taskRunResult.latestRunSummary,
            });
          }
          updateTaskExecution(task.id, {
            lastSource: params.source,
            blockedReason: taskRunResult.reason,
          });
          return { ok: false, reason: taskRunResult.reason };
        }
        if (taskRunResult) {
          taskRunId = taskRunResult.run.runId;
          kanbanUpdateTask(task.id, {
            latestRunSummary: taskRunResult.latestRunSummary,
          });
        }
      }

      const lock = {
        token: `${params.source}-${Date.now()}`,
        source: params.source,
        acquiredAt: Date.now(),
      } as const;
      kanbanExecutionLocksRef.current[task.id] = lock;
      updateTaskExecution(task.id, {
        lastSource: params.source,
        lock,
        blockedReason: null,
      });

      try {
        const workspace = typedWorkspacesByPath.get(task.workspaceId);
        if (!workspace) {
          throw new Error("workspace_not_found");
        }

        const sessionTarget = await prepareKanbanExecutionTarget(
          executionTarget,
          ensureProductEngineReadyV1,
        );
        await connectWorkspace(workspace);
        const workspaceThreads = typedThreadsByWorkspace[workspace.id] ?? [];
        const {
          outboundModel,
          shouldSyncComposerSelection,
          composerSelection,
        } = await syncKanbanExecutionEngineAndModel({
          activate: params.activate,
          target: executionTarget,
          setActiveEngine,
        });

        const shouldForceNewThread = Boolean(params.forceNewThread);
        const canonicalTaskThreadId = shouldForceNewThread
          ? null
          : resolveTaskThreadId(task.threadId, resolveCanonicalThreadId);
        const canonicalTaskThreadEngine = canonicalTaskThreadId
          ? (workspaceThreads.find(
              (entry) => entry.id === canonicalTaskThreadId,
            )?.engineSource ?? null)
          : null;
        const canonicalTaskThreadProviderProfileId = canonicalTaskThreadId
          ? (workspaceThreads.find(
              (entry) => entry.id === canonicalTaskThreadId,
            )?.providerProfileId ?? null)
          : null;
        const canReuseExistingThread = isKanbanThreadCompatibleWithTarget({
          target: executionTarget,
          threadId: canonicalTaskThreadId,
          threadEngine: canonicalTaskThreadEngine,
          threadProviderProfileId: canonicalTaskThreadProviderProfileId,
        });
        let threadId = canReuseExistingThread ? canonicalTaskThreadId : null;
        if (shouldForceNewThread && task.threadId) {
          // Keep previous run in review state before switching task to the new execution thread.
          kanbanUpdateTask(task.id, { status: "testing" });
        }
        if (
          canonicalTaskThreadId &&
          canonicalTaskThreadId !== task.threadId &&
          canReuseExistingThread
        ) {
          kanbanUpdateTask(task.id, { threadId: canonicalTaskThreadId });
          patchTaskRunAndProjectToKanban({
            runId: taskRunId,
            status: "planning",
            linkedThreadId: canonicalTaskThreadId,
            currentStep: "reuse_existing_thread",
          });
        }
        if (!threadId) {
          threadId = await startThreadForWorkspace(workspace.id, {
            ...sessionTarget,
            activate: params.activate ?? false,
          });
          if (!threadId) {
            throw new Error("thread_create_failed");
          }
          kanbanUpdateTask(task.id, { threadId });
          patchTaskRunAndProjectToKanban({
            runId: taskRunId,
            status: "planning",
            linkedThreadId: threadId,
            currentStep: "thread_created",
          });
        }

        if (shouldSyncComposerSelection && composerSelection?.modelId) {
          persistKanbanTaskComposerSelection(
            workspace.id,
            threadId,
            composerSelection.modelId,
          );
        }

        const executionStartedAt = Date.now();
        const baseMessage = task.description?.trim() || task.title;
        let browserContextAttachment = null;
        try {
          const activeBrowserContext = getActiveBrowserContext();
          if (
            activeBrowserContext &&
            activeBrowserContext.workspaceId === workspace.id &&
            activeBrowserContext.rendererBound &&
            activeBrowserContext.session.status === "ready"
          ) {
            const snapshot = await captureBrowserAgentSnapshot(
              activeBrowserContext.browserSessionId,
            );
            browserContextAttachment = buildBrowserContextAttachment(snapshot);
          }
        } catch (error) {
          console.warn(
            "Browser context source evidence unavailable for Kanban task dispatch",
            error,
          );
        }
        const firstMessage = params.injectedPrefix
          ? `${params.injectedPrefix}\n\n${baseMessage}`
          : baseMessage;
        if (firstMessage) {
          await sendUserMessageToThread(
            workspace,
            threadId,
            firstMessage,
            task.images ?? [],
            {
              ...(outboundModel ? { model: outboundModel } : {}),
              ...(browserContextAttachment ? { browserContextAttachment } : {}),
            },
          );
        }

        kanbanUpdateTask(task.id, { status: "inprogress" });
        patchTaskRunAndProjectToKanban({
          runId: taskRunId,
          status: "running",
          linkedThreadId: threadId,
          currentStep: "first_message_sent",
          startedAt: executionStartedAt,
          browserEvidence: browserContextAttachment
            ? buildTaskRunBrowserEvidenceRef(browserContextAttachment)
            : undefined,
        });
        updateTaskExecution(task.id, {
          lastSource: params.source,
          lock: null,
          blockedReason: null,
          startedAt: executionStartedAt,
          finishedAt: null,
        });
        launchedSuccessfully = true;
        return { ok: true, threadId };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        updateTaskExecution(task.id, {
          lastSource: params.source,
          lock: null,
          blockedReason: reason,
        });
        patchTaskRunAndProjectToKanban({
          runId: taskRunId,
          status: "failed",
          failureReason: reason,
          finishedAt: Date.now(),
        });
        return { ok: false, reason };
      } finally {
        if (!launchedSuccessfully) {
          delete kanbanExecutionLocksRef.current[task.id];
        }
      }
    },
    [
      typedWorkspacesByPath,
      connectWorkspace,
      typedThreadsByWorkspace,
      setActiveEngine,
      startThreadForWorkspace,
      persistKanbanTaskComposerSelection,
      kanbanUpdateTask,
      sendUserMessageToThread,
      updateTaskExecution,
      setTaskChainBlockedReason,
      resolveCanonicalThreadId,
      patchTaskRunAndProjectToKanban,
    ],
  );

  // --- Kanban conversation handlers ---
  const handleOpenTaskConversation = useCallback(
    async (task: KanbanTask) => {
      setSelectedKanbanTaskId(task.id);
      const workspace = typedWorkspacesByPath.get(task.workspaceId);
      if (!workspace) return;

      await connectWorkspace(workspace);
      selectWorkspace(workspace.id);

      const targetResolution = resolveKanbanExecutionTarget({
        task,
        product: readProductEntitlementSnapshotV1(),
      });
      if (!targetResolution.ok) {
        updateTaskExecution(task.id, {
          lastSource: "manual",
          blockedReason: targetResolution.reason,
        });
        return;
      }
      const executionTarget = targetResolution.target;
      const engine = executionTarget.engine;
      const workspaceThreads = typedThreadsByWorkspace[workspace.id] ?? [];
      const canStartNewExecution =
        isEngineExecutionEnabled(engine) && isNewTaskRunEngine(engine);
      let sessionTarget: {
        engine: typeof engine;
        providerProfileId?: string;
      } = { engine };
      if (canStartNewExecution) {
        sessionTarget = await prepareKanbanExecutionTarget(
          executionTarget,
          ensureProductEngineReadyV1,
        );
        const providerProfileId =
          executionTarget.providerProfileId?.trim() || null;
        await setActiveEngine(
          engine,
          providerProfileId ? { providerProfileId } : undefined,
        );
      }

      if (task.threadId) {
        let resolvedThreadId =
          resolveTaskThreadId(task.threadId, resolveCanonicalThreadId) ??
          task.threadId;
        const resolvedThreadEngine =
          workspaceThreads.find((entry) => entry.id === resolvedThreadId)
            ?.engineSource ?? null;
        const resolvedThreadProviderProfileId =
          workspaceThreads.find((entry) => entry.id === resolvedThreadId)
            ?.providerProfileId ?? null;
        const canReuseExistingThread = isKanbanThreadCompatibleWithTarget({
          target: executionTarget,
          threadId: resolvedThreadId,
          threadEngine: resolvedThreadEngine,
          threadProviderProfileId: resolvedThreadProviderProfileId,
        });
        if (resolvedThreadId !== task.threadId) {
          kanbanUpdateTask(task.id, { threadId: resolvedThreadId });
        }

        if (!canReuseExistingThread) {
          resolvedThreadId = "";
        }

        const isPendingThread =
          resolvedThreadId.startsWith("claude-pending-") ||
          resolvedThreadId.startsWith("opencode-pending-");
        const hasThreadStatus =
          typedThreadStatusById[resolvedThreadId] !== undefined;
        const existsInWorkspaceThreads = workspaceThreads.some(
          (entry) => entry.id === resolvedThreadId,
        );

        if (isPendingThread && !hasThreadStatus && !existsInWorkspaceThreads) {
          const occupiedThreadIds = new Set(
            typedKanbanTasks
              .filter((entry) => entry.id !== task.id && entry.threadId)
              .map((entry) =>
                resolveTaskThreadId(entry.threadId, resolveCanonicalThreadId),
              )
              .filter((threadId): threadId is string =>
                Boolean(
                  threadId &&
                  !threadId.startsWith("claude-pending-") &&
                  !threadId.startsWith("opencode-pending-"),
                ),
              ),
          );
          const uniqueCandidate = resolvePendingSessionThreadCandidate({
            pendingThreadId: resolvedThreadId,
            workspaceThreadIds: workspaceThreads.map((entry) => entry.id),
            occupiedThreadIds,
          });
          if (uniqueCandidate) {
            resolvedThreadId = uniqueCandidate;
            kanbanUpdateTask(task.id, { threadId: resolvedThreadId });
          }
        }

        const canActivateExistingThread =
          typedThreadStatusById[resolvedThreadId] !== undefined ||
          workspaceThreads.some((entry) => entry.id === resolvedThreadId) ||
          resolvedThreadId.startsWith("claude-pending-") ||
          resolvedThreadId.startsWith("opencode-pending-");
        if (canActivateExistingThread) {
          persistKanbanTaskComposerSelection(
            workspace.id,
            resolvedThreadId,
            executionTarget.modelCatalogEntryId ?? executionTarget.model,
          );
          setActiveThreadId(resolvedThreadId, workspace.id);
          return;
        }
      }

      if (!canStartNewExecution) {
        return;
      }
      const threadId = await startThreadForWorkspace(workspace.id, {
        ...sessionTarget,
      });
      if (threadId) {
        kanbanUpdateTask(task.id, { threadId });
        persistKanbanTaskComposerSelection(
          workspace.id,
          threadId,
          executionTarget.modelCatalogEntryId ?? executionTarget.model,
        );
        setActiveThreadId(threadId, workspace.id);
      }
    },
    [
      typedWorkspacesByPath,
      connectWorkspace,
      selectWorkspace,
      setActiveThreadId,
      startThreadForWorkspace,
      kanbanUpdateTask,
      setActiveEngine,
      persistKanbanTaskComposerSelection,
      typedThreadStatusById,
      typedThreadsByWorkspace,
      typedKanbanTasks,
      resolveCanonicalThreadId,
      setSelectedKanbanTaskId,
      updateTaskExecution,
    ],
  );

  const handleCloseTaskConversation = useCallback(() => {
    setSelectedKanbanTaskId(null);
  }, [setSelectedKanbanTaskId]);

  const resolveTaskByRun = useCallback((run: TaskRunRecord) => {
    return (
      kanbanTasksRef.current.find((task) => task.id === run.task.taskId) ?? null
    );
  }, []);

  const handleRetryTaskRun = useCallback(
    (run: TaskRunRecord) => {
      if (!isEngineExecutionEnabled(run.engine)) {
        return;
      }
      const task = resolveTaskByRun(run);
      if (!task) {
        return;
      }
      const targetResolution = resolveKanbanExecutionTarget({
        task,
        product: readProductEntitlementSnapshotV1(),
      });
      if (!targetResolution.ok) {
        updateTaskExecution(task.id, {
          lastSource: "manual",
          blockedReason: targetResolution.reason,
        });
        return;
      }
      const recovery = beginTaskRunRecovery({
        task,
        trigger: "retry",
        parentRun: run,
        executionTarget: targetResolution.target,
      });
      if (!recovery.ok) {
        if (recovery.latestRunSummary) {
          kanbanUpdateTask(task.id, {
            latestRunSummary: recovery.latestRunSummary,
          });
        }
        return;
      }
      kanbanUpdateTask(task.id, {
        latestRunSummary: recovery.latestRunSummary,
      });
      void launchKanbanTaskExecution({
        taskId: task.id,
        source: "manual",
        activate: false,
        forceNewThread: true,
        existingRunId: recovery.run.runId,
      });
    },
    [
      kanbanUpdateTask,
      launchKanbanTaskExecution,
      resolveTaskByRun,
      updateTaskExecution,
    ],
  );

  const handleForkTaskRun = useCallback(
    (run: TaskRunRecord) => {
      if (!isEngineExecutionEnabled(run.engine)) {
        return;
      }
      const task = resolveTaskByRun(run);
      if (!task) {
        return;
      }
      const targetResolution = resolveKanbanExecutionTarget({
        task,
        product: readProductEntitlementSnapshotV1(),
      });
      if (!targetResolution.ok) {
        updateTaskExecution(task.id, {
          lastSource: "manual",
          blockedReason: targetResolution.reason,
        });
        return;
      }
      const recovery = beginTaskRunRecovery({
        task,
        trigger: "forked",
        parentRun: run,
        executionTarget: targetResolution.target,
      });
      if (!recovery.ok) {
        if (recovery.latestRunSummary) {
          kanbanUpdateTask(task.id, {
            latestRunSummary: recovery.latestRunSummary,
          });
        }
        return;
      }
      kanbanUpdateTask(task.id, {
        latestRunSummary: recovery.latestRunSummary,
      });
      void launchKanbanTaskExecution({
        taskId: task.id,
        source: "manual",
        activate: false,
        forceNewThread: true,
        existingRunId: recovery.run.runId,
      });
    },
    [
      kanbanUpdateTask,
      launchKanbanTaskExecution,
      resolveTaskByRun,
      updateTaskExecution,
    ],
  );

  const handleResumeTaskRun = useCallback(
    async (run: TaskRunRecord) => {
      if (!run.linkedThreadId || !isEngineExecutionEnabled(run.engine)) {
        return;
      }
      const task = resolveTaskByRun(run);
      if (task) {
        await handleOpenTaskConversation(task);
      }
    },
    [handleOpenTaskConversation, resolveTaskByRun],
  );

  const handleCancelTaskRun = useCallback(
    async (run: TaskRunRecord) => {
      if (run.linkedThreadId && activeThreadId === run.linkedThreadId) {
        await interruptTurn();
      }
      const canceled = cancelTaskRunRecovery({
        runId: run.runId,
        now: Date.now(),
      });
      if (canceled.run) {
        kanbanUpdateTask(run.task.taskId, {
          latestRunSummary: buildLatestRunSummary(canceled.run),
        });
      }
    },
    [activeThreadId, interruptTurn, kanbanUpdateTask],
  );

  const handleKanbanCreateTask = useCallback(
    (input: CreateKanbanTaskInput) => {
      const task = kanbanCreateTask(input);
      if (input.autoStart) {
        const tryLaunch = (attempt: number) => {
          void launchKanbanTaskExecution({
            taskId: task.id,
            source: "autoStart",
            activate: false,
          }).then((result) => {
            if (result.ok) {
              return;
            }
            if (result.reason !== "task_not_found" || attempt >= 3) {
              return;
            }
            window.setTimeout(
              () => {
                tryLaunch(attempt + 1);
              },
              (attempt + 1) * 40,
            );
          });
        };
        tryLaunch(0);
      }
      return task;
    },
    [kanbanCreateTask, launchKanbanTaskExecution],
  );

  // Sync kanban task threadIds when pending IDs are renamed to session IDs.
  // Strategy:
  // 1) Prefer canonical alias resolution from useThreads (deterministic).
  // 2) Fallback to unique-candidate mapping only when there is exactly one safe target.
  // Never guess by taking the first candidate.
  useEffect(() => {
    for (const task of typedKanbanTasks) {
      if (!task.threadId) {
        continue;
      }
      const canonicalThreadId = resolveTaskThreadId(
        task.threadId,
        resolveCanonicalThreadId,
      );
      if (canonicalThreadId && canonicalThreadId !== task.threadId) {
        kanbanUpdateTask(task.id, { threadId: canonicalThreadId });
        continue;
      }

      const taskThreadId = canonicalThreadId ?? task.threadId;
      const isPendingThread =
        taskThreadId.startsWith("claude-pending-") ||
        taskThreadId.startsWith("opencode-pending-");
      if (!isPendingThread) {
        continue;
      }
      if (typedThreadStatusById[taskThreadId] !== undefined) {
        continue;
      }
      const wsId = typedWorkspacesByPath.get(task.workspaceId)?.id;
      const threads = wsId ? (typedThreadsByWorkspace[wsId] ?? []) : [];
      if (threads.some((entry) => entry.id === taskThreadId)) {
        continue;
      }
      const otherTaskThreadIds = new Set(
        typedKanbanTasks
          .filter((entry) => entry.id !== task.id && entry.threadId)
          .map((entry) =>
            resolveTaskThreadId(entry.threadId, resolveCanonicalThreadId),
          )
          .filter((threadId): threadId is string =>
            Boolean(
              threadId &&
              !threadId.startsWith("claude-pending-") &&
              !threadId.startsWith("opencode-pending-"),
            ),
          ),
      );
      const uniqueCandidate = resolvePendingSessionThreadCandidate({
        pendingThreadId: taskThreadId,
        workspaceThreadIds: threads.map((entry) => entry.id),
        occupiedThreadIds: otherTaskThreadIds,
      });
      if (uniqueCandidate) {
        kanbanUpdateTask(task.id, { threadId: uniqueCandidate });
      }
    }
  }, [
    typedKanbanTasks,
    typedThreadStatusById,
    typedThreadsByWorkspace,
    kanbanUpdateTask,
    typedWorkspacesByPath,
    resolveCanonicalThreadId,
  ]);

  useEffect(() => {
    if (appMode !== "kanban") {
      setSelectedKanbanTaskId(null);
    }
  }, [appMode, setSelectedKanbanTaskId]);

  // Sync activeWorkspaceId when kanban navigates to a workspace
  useEffect(() => {
    if (appMode === "kanban" && "workspaceId" in typedKanbanViewState) {
      const kanbanWsPath = typedKanbanViewState.workspaceId;
      const ws = kanbanWsPath ? typedWorkspacesByPath.get(kanbanWsPath) : null;
      if (ws && ws.id !== activeWorkspaceId) {
        setActiveWorkspaceId(ws.id);
      }
    }
  }, [
    appMode,
    typedKanbanViewState,
    activeWorkspaceId,
    setActiveWorkspaceId,
    typedWorkspacesByPath,
  ]);

  // Compute which kanban tasks are currently processing (AI responding)
  const taskProcessingMap = useMemo(() => {
    const map: Record<
      string,
      { isProcessing: boolean; startedAt: number | null }
    > = {};
    for (const task of typedKanbanTasks) {
      const taskThreadId = resolveTaskThreadId(
        task.threadId,
        resolveCanonicalThreadId,
      );
      if (taskThreadId) {
        const status = typedThreadStatusById[taskThreadId];
        map[task.id] = {
          isProcessing: status?.isProcessing ?? false,
          startedAt: status?.processingStartedAt ?? null,
        };
      }
    }
    return map;
  }, [typedKanbanTasks, typedThreadStatusById, resolveCanonicalThreadId]);

  useEffect(() => {
    const runSchedulerTick = () => {
      const nowTs = Date.now();
      const activeTaskIds = new Set(
        kanbanTasksRef.current.map((entry) => entry.id),
      );
      for (const taskId of Object.keys(kanbanExecutionLocksRef.current)) {
        if (activeTaskIds.has(taskId)) {
          continue;
        }
        delete kanbanExecutionLocksRef.current[taskId];
      }
      for (const task of kanbanTasksRef.current) {
        const runtimeLock = kanbanExecutionLocksRef.current[task.id];
        if (runtimeLock) {
          const hasPersistedExecutionLock = Boolean(task.execution?.lock);
          const isLockExpired =
            nowTs - runtimeLock.acquiredAt > KANBAN_EXECUTION_LOCK_STALE_MS;
          if (
            !hasPersistedExecutionLock ||
            task.status !== "todo" ||
            isLockExpired
          ) {
            delete kanbanExecutionLocksRef.current[task.id];
            if (task.execution?.lock) {
              updateTaskExecution(task.id, { lock: null });
            }
          }
        }
        if (task.execution?.blockedReason === "scheduled_trigger_blocked") {
          updateTaskExecution(task.id, { blockedReason: null });
        }
        const schedule = task.schedule;
        if (!schedule || schedule.mode === "manual") {
          continue;
        }
        if (schedule.paused) {
          continue;
        }
        const taskThreadId = resolveTaskThreadId(
          task.threadId,
          resolveCanonicalThreadId,
        );
        if (taskThreadId && task.threadId && taskThreadId !== task.threadId) {
          kanbanUpdateTask(task.id, { threadId: taskThreadId });
        }
        const isTaskProcessing = taskThreadId
          ? (typedThreadStatusById[taskThreadId]?.isProcessing ?? false)
          : false;
        const shouldPromoteTestingToTodo =
          schedule.mode === "recurring" &&
          schedule.recurringExecutionMode !== "new_thread" &&
          task.status === "testing" &&
          !isTaskProcessing &&
          typeof schedule.nextRunAt === "number" &&
          schedule.nextRunAt <= nowTs;
        const normalizedStatus = shouldPromoteTestingToTodo
          ? "todo"
          : task.status;
        if (normalizedStatus !== task.status) {
          kanbanUpdateTask(task.id, { status: normalizedStatus });
        }
        if (normalizedStatus !== "todo") {
          continue;
        }

        const missedRunResult = applyMissedRunPolicy(
          task,
          schedulerStartedAtRef.current,
          nowTs,
        );
        let effectiveSchedule = schedule;
        if (missedRunResult) {
          effectiveSchedule = missedRunResult.schedule;
          kanbanUpdateTask(task.id, {
            schedule: missedRunResult.schedule,
          });
          updateTaskExecution(task.id, {
            lastSource: "scheduled",
            blockedReason: missedRunResult.blockedReason,
          });
          continue;
        }

        if (!isScheduleDue(effectiveSchedule, nowTs)) {
          continue;
        }

        if (
          effectiveSchedule.mode === "recurring" &&
          effectiveSchedule.recurringExecutionMode === "new_thread"
        ) {
          const recurringSeriesId =
            typeof effectiveSchedule.seriesId === "string" &&
            effectiveSchedule.seriesId.trim().length > 0
              ? effectiveSchedule.seriesId.trim()
              : task.id;
          const hasSiblingExecuting = kanbanTasksRef.current.some((entry) => {
            if (entry.id === task.id) {
              return false;
            }
            const siblingSchedule = entry.schedule;
            if (
              !siblingSchedule ||
              siblingSchedule.mode !== "recurring" ||
              siblingSchedule.recurringExecutionMode !== "new_thread"
            ) {
              return false;
            }
            const siblingSeriesId =
              typeof siblingSchedule.seriesId === "string" &&
              siblingSchedule.seriesId.trim().length > 0
                ? siblingSchedule.seriesId.trim()
                : entry.id;
            if (siblingSeriesId !== recurringSeriesId) {
              return false;
            }
            return (
              entry.status === "inprogress" ||
              Boolean(kanbanExecutionLocksRef.current[entry.id])
            );
          });
          if (hasSiblingExecuting) {
            updateTaskExecution(task.id, {
              lastSource: "scheduled",
              blockedReason: "scheduled_trigger_blocked",
            });
            continue;
          }
        }

        if (
          effectiveSchedule.mode === "recurring" &&
          hasReachedRecurringRoundLimit(effectiveSchedule)
        ) {
          kanbanUpdateTask(task.id, {
            status: "done",
            schedule: {
              ...effectiveSchedule,
              nextRunAt: null,
            },
          });
          updateTaskExecution(task.id, {
            lastSource: "scheduled",
            blockedReason: "max_rounds_reached_auto_completed",
          });
          continue;
        }

        if (
          isTaskProcessing ||
          Boolean(kanbanExecutionLocksRef.current[task.id])
        ) {
          // Running/locked is an expected transient condition for due recurring tasks.
          // Do not expose it as user-facing "blocked" state.
          updateTaskExecution(task.id, {
            lastSource: "scheduled",
            blockedReason: null,
          });
          continue;
        }

        if (effectiveSchedule.mode === "once") {
          const triggeredSchedule = markScheduleTriggered(
            effectiveSchedule,
            "scheduled",
            nowTs,
          );
          kanbanUpdateTask(task.id, { schedule: triggeredSchedule });
        } else {
          kanbanUpdateTask(task.id, {
            schedule: {
              ...effectiveSchedule,
              overdue: false,
              lastTriggeredAt: nowTs,
              lastTriggerSource: "scheduled",
            },
          });
        }
        updateTaskExecution(task.id, {
          lastSource: "scheduled",
          blockedReason: null,
        });
        const forceNewThread =
          effectiveSchedule.mode === "recurring" &&
          effectiveSchedule.recurringExecutionMode === "new_thread";
        const injectedPrefix =
          forceNewThread &&
          effectiveSchedule.newThreadResultMode !== "none" &&
          task.lastResultSnapshot
            ? buildChainedPromptPrefix(task.lastResultSnapshot)
            : undefined;
        void launchKanbanTaskExecution({
          taskId: task.id,
          source: "scheduled",
          activate: false,
          forceNewThread,
          injectedPrefix,
        });
      }
    };

    // 固定 20s 轮询改为 next-due 对齐：每次 tick 后按最近的 schedule.nextRunAt
    // 自续期 setTimeout；无到期任务时完全休眠。任务增删/改 schedule 会使本
    // effect 重跑（typedKanbanTasks 在 deps 中），立即补一次 tick 并重算唤醒点。
    let schedulerTimer: number | null = null;
    const scheduleNextTick = () => {
      if (schedulerTimer !== null) {
        window.clearTimeout(schedulerTimer);
        schedulerTimer = null;
      }
      const nowTs = Date.now();
      let nextDueAt: number | null = null;
      for (const task of kanbanTasksRef.current) {
        const schedule = task.schedule;
        if (!schedule || schedule.mode === "manual" || schedule.paused) {
          continue;
        }
        if (typeof schedule.nextRunAt !== "number") {
          continue;
        }
        if (nextDueAt === null || schedule.nextRunAt < nextDueAt) {
          nextDueAt = schedule.nextRunAt;
        }
      }
      if (nextDueAt === null) {
        return;
      }
      const delay = Math.max(
        nextDueAt - nowTs,
        KANBAN_SCHEDULER_MIN_INTERVAL_MS,
      );
      schedulerTimer = window.setTimeout(() => {
        schedulerTimer = null;
        runSchedulerTick();
        scheduleNextTick();
      }, delay);
    };

    runSchedulerTick();
    scheduleNextTick();
    return () => {
      if (schedulerTimer !== null) {
        window.clearTimeout(schedulerTimer);
      }
    };
  }, [
    typedKanbanTasks,
    typedThreadStatusById,
    kanbanUpdateTask,
    updateTaskExecution,
    launchKanbanTaskExecution,
    resolveCanonicalThreadId,
    kanbanCreateTask,
  ]);

  // Track previous processing state to detect transitions
  const prevProcessingMapRef = useRef<Record<string, boolean>>({});
  const prevTaskStatusMapRef = useRef<Record<string, KanbanTaskStatus>>({});

  useEffect(() => {
    const previousStatusMap = prevTaskStatusMapRef.current;
    const nextStatusMap: Record<string, KanbanTaskStatus> = {};
    for (const task of typedKanbanTasks) {
      nextStatusMap[task.id] = task.status;
      const previousStatus = previousStatusMap[task.id];
      if (previousStatus === task.status) {
        continue;
      }
      if (task.status === "inprogress") {
        const hasStartedAt = typeof task.execution?.startedAt === "number";
        const hasFinishedAt = typeof task.execution?.finishedAt === "number";
        if (!hasStartedAt || hasFinishedAt) {
          updateTaskExecution(task.id, {
            startedAt: Date.now(),
            finishedAt: null,
          });
        }
        continue;
      }
      if (previousStatus === "inprogress") {
        updateTaskExecution(task.id, {
          finishedAt: Date.now(),
        });
      }
    }
    prevTaskStatusMapRef.current = nextStatusMap;
  }, [typedKanbanTasks, updateTaskExecution]);

  useEffect(() => {
    const prev = prevProcessingMapRef.current;
    for (const task of typedKanbanTasks) {
      const wasProcessing = prev[task.id] ?? false;
      const nowProcessing = taskProcessingMap[task.id]?.isProcessing ?? false;
      if (wasProcessing === nowProcessing) continue;

      // AI finished processing (true → false): auto-move inprogress → testing
      if (wasProcessing && !nowProcessing && task.status === "inprogress") {
        const completedAt = Date.now();
        updateTaskExecution(task.id, {
          finishedAt: completedAt,
        });
        const nextStatus = resolvePostProcessingStatus(task);
        if (task.schedule?.mode === "recurring") {
          const completionSource = task.execution?.lastSource ?? "scheduled";
          const recurringSignature = [
            task.workspaceId,
            task.panelId,
            task.title,
            String(task.schedule.interval ?? 1),
            task.schedule.unit ?? "days",
            task.schedule.newThreadResultMode ?? "pass",
          ].join("|");
          const recurringSiblings = kanbanTasksRef.current.filter((entry) => {
            const schedule = entry.schedule;
            if (
              !schedule ||
              schedule.mode !== "recurring" ||
              schedule.recurringExecutionMode !== "new_thread"
            ) {
              return false;
            }
            const signature = [
              entry.workspaceId,
              entry.panelId,
              entry.title,
              String(schedule.interval ?? 1),
              schedule.unit ?? "days",
              schedule.newThreadResultMode ?? "pass",
            ].join("|");
            return signature === recurringSignature;
          });
          const siblingSeriesIds = Array.from(
            new Set(
              recurringSiblings
                .map((entry) => entry.schedule?.seriesId)
                .filter(
                  (seriesId): seriesId is string =>
                    typeof seriesId === "string" && seriesId.trim().length > 0,
                ),
            ),
          );
          const recurringSeriesId =
            task.schedule.recurringExecutionMode === "new_thread"
              ? (task.schedule.seriesId ??
                (siblingSeriesIds.length === 1 ? siblingSeriesIds[0] : null) ??
                task.id)
              : (task.schedule.seriesId ?? null);
          if (
            task.schedule.recurringExecutionMode === "new_thread" &&
            siblingSeriesIds.length <= 1
          ) {
            for (const sibling of recurringSiblings) {
              if (
                !sibling.schedule ||
                sibling.schedule.seriesId === recurringSeriesId
              ) {
                continue;
              }
              kanbanUpdateTask(sibling.id, {
                schedule: {
                  ...sibling.schedule,
                  seriesId: recurringSeriesId,
                },
              });
            }
          }
          const completedSchedule = markRecurringScheduleCompleted(
            {
              ...task.schedule,
              seriesId: recurringSeriesId,
            },
            completionSource,
            completedAt,
          );
          const reachedRoundLimit =
            hasReachedRecurringRoundLimit(completedSchedule);
          if (task.schedule.recurringExecutionMode === "new_thread") {
            kanbanUpdateTask(task.id, {
              status: reachedRoundLimit ? "done" : nextStatus,
              // Freeze this completed run card in review; next cycle will use a new cloned task.
              schedule: {
                ...completedSchedule,
                nextRunAt: null,
              },
            });
            if (!reachedRoundLimit) {
              const hasPendingSeriesTask = recurringSiblings.some((sibling) => {
                if (sibling.id === task.id) {
                  return false;
                }
                const siblingSchedule = sibling.schedule;
                if (
                  !siblingSchedule ||
                  siblingSchedule.mode !== "recurring" ||
                  siblingSchedule.recurringExecutionMode !== "new_thread"
                ) {
                  return false;
                }
                const siblingSeriesId =
                  typeof siblingSchedule.seriesId === "string" &&
                  siblingSchedule.seriesId.trim().length > 0
                    ? siblingSchedule.seriesId.trim()
                    : sibling.id;
                if (siblingSeriesId !== recurringSeriesId) {
                  return false;
                }
                return (
                  sibling.status === "todo" || sibling.status === "inprogress"
                );
              });
              if (!hasPendingSeriesTask) {
                kanbanCreateTask(
                  buildRecurringKanbanTaskCloneInput(task, completedSchedule),
                );
              }
            } else {
              updateTaskExecution(task.id, {
                lastSource: completionSource,
                blockedReason: "max_rounds_reached_auto_completed",
              });
            }
          } else {
            kanbanUpdateTask(task.id, {
              status: reachedRoundLimit ? "done" : nextStatus,
              schedule: reachedRoundLimit
                ? {
                    ...completedSchedule,
                    nextRunAt: null,
                  }
                : completedSchedule,
            });
            if (reachedRoundLimit) {
              updateTaskExecution(task.id, {
                lastSource: completionSource,
                blockedReason: "max_rounds_reached_auto_completed",
              });
            }
          }
        } else {
          kanbanUpdateTask(task.id, { status: nextStatus });
        }

        const snapshot = extractKanbanResultSnapshot(
          resolveTaskThreadId(task.threadId, resolveCanonicalThreadId),
          (() => {
            const taskThreadId = resolveTaskThreadId(
              task.threadId,
              resolveCanonicalThreadId,
            );
            return taskThreadId
              ? typedThreadItemsByThread[taskThreadId]
              : undefined;
          })(),
        );
        if (snapshot) {
          const taskThreadId = resolveTaskThreadId(
            task.threadId,
            resolveCanonicalThreadId,
          );
          kanbanUpdateTask(task.id, {
            ...(taskThreadId && task.threadId && taskThreadId !== task.threadId
              ? { threadId: taskThreadId }
              : null),
            lastResultSnapshot: snapshot,
          });
        }

        const downstreamTask = findTaskDownstream(
          kanbanTasksRef.current,
          task.id,
        );
        if (downstreamTask) {
          if (!snapshot) {
            setTaskChainBlockedReason(
              downstreamTask.id,
              "missing_upstream_snapshot",
            );
            updateTaskExecution(downstreamTask.id, {
              lastSource: "chained",
              blockedReason: "missing_upstream_snapshot",
            });
          } else if (downstreamTask.status !== "todo") {
            setTaskChainBlockedReason(downstreamTask.id, "downstream_not_todo");
            updateTaskExecution(downstreamTask.id, {
              lastSource: "chained",
              blockedReason: "downstream_not_todo",
            });
          } else if (
            downstreamTask.schedule?.mode &&
            downstreamTask.schedule.mode !== "manual"
          ) {
            setTaskChainBlockedReason(
              downstreamTask.id,
              "downstream_has_schedule",
            );
            updateTaskExecution(downstreamTask.id, {
              lastSource: "chained",
              blockedReason: "downstream_has_schedule",
            });
          } else {
            setTaskChainBlockedReason(downstreamTask.id, null);
            updateTaskExecution(downstreamTask.id, {
              lastSource: "chained",
              blockedReason: null,
            });
            void launchKanbanTaskExecution({
              taskId: downstreamTask.id,
              source: "chained",
              activate: false,
              injectedPrefix: buildChainedPromptPrefix(snapshot),
            }).then((result) => {
              if (!result.ok) {
                setTaskChainBlockedReason(downstreamTask.id, result.reason);
                updateTaskExecution(downstreamTask.id, {
                  lastSource: "chained",
                  blockedReason: result.reason,
                });
              }
            });
          }
        }
      }
      // User sent follow-up (false → true): auto-move testing → inprogress
      if (!wasProcessing && nowProcessing && task.status === "testing") {
        kanbanUpdateTask(task.id, { status: "inprogress" });
        updateTaskExecution(task.id, {
          startedAt: taskProcessingMap[task.id]?.startedAt ?? Date.now(),
          finishedAt: null,
        });
      }
    }
    const boolMap: Record<string, boolean> = {};
    for (const [id, val] of Object.entries(taskProcessingMap)) {
      boolMap[id] = val.isProcessing;
    }
    prevProcessingMapRef.current = boolMap;
  }, [
    taskProcessingMap,
    typedKanbanTasks,
    kanbanUpdateTask,
    kanbanCreateTask,
    typedThreadItemsByThread,
    setTaskChainBlockedReason,
    updateTaskExecution,
    launchKanbanTaskExecution,
    resolveCanonicalThreadId,
  ]);

  useEffect(() => {
    const store = loadTaskRunStore();
    for (const run of store.runs) {
      if (!run.linkedThreadId) {
        continue;
      }
      if (
        run.status !== "planning" &&
        run.status !== "running" &&
        run.status !== "waiting_input"
      ) {
        continue;
      }
      const canonicalThreadId = resolveTaskThreadId(
        run.linkedThreadId,
        resolveCanonicalThreadId,
      );
      if (!canonicalThreadId) {
        continue;
      }
      const patch = deriveTaskRunTelemetryPatch({
        run,
        threadStatus: typedThreadStatusById[canonicalThreadId],
        items: typedThreadItemsByThread[canonicalThreadId],
        now: Date.now(),
      });
      if (!patch) {
        continue;
      }
      const result = patchTaskRunAndProjectToKanban({
        runId: run.runId,
        status: patch.status,
        currentStep: patch.currentStep,
        latestOutputSummary: patch.latestOutputSummary,
        artifacts: patch.artifacts,
        finishedAt: patch.finishedAt,
        now: patch.now,
      });
      if (result?.latestRunSummary) {
        kanbanUpdateTask(run.task.taskId, {
          latestRunSummary: result.latestRunSummary,
        });
      }
    }
  }, [
    kanbanUpdateTask,
    patchTaskRunAndProjectToKanban,
    resolveCanonicalThreadId,
    typedThreadItemsByThread,
    typedThreadStatusById,
  ]);

  // Drag to "inprogress" auto-execute: create thread and send first message (without opening conversation panel)
  const handleDragToInProgress = useCallback(
    (task: KanbanTask) => {
      void launchKanbanTaskExecution({
        taskId: task.id,
        source: "drag",
        activate: false,
      });
    },
    [launchKanbanTaskExecution],
  );

  return {
    handleOpenTaskConversation,
    handleRetryTaskRun,
    handleResumeTaskRun,
    handleCancelTaskRun,
    handleForkTaskRun,
    handleCloseTaskConversation,
    handleKanbanCreateTask,
    taskProcessingMap,
    handleDragToInProgress,
  };
}
