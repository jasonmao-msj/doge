import { useMemo, useRef } from "react";
import type { ConversationItem, EngineType } from "../../../types";
import type {
  TodoItem,
  SubagentInfo,
  FileChangeSummary,
  CommandSummary,
  SubagentNavigationTarget,
} from "../types";
import {
  extractToolName,
  parseToolArgs,
  resolveToolStatus,
} from "../../../utils/toolSemantics";
import {
  extractCommandSummaries,
  extractFileChangeSummaries,
} from "../../operation-facts/operationFacts";
import {
  normalizeCollabAgentStatusMap,
  parseCollabFallbackLink,
} from "../../../utils/collabToolParsing";
import {
  isCollabLifecycleTool,
  isCollabSpawnTool,
  isSubagentTool,
} from "@/utils/isSubagentTool";

interface StatusPanelData {
  todos: TodoItem[];
  subagents: SubagentInfo[];
  fileChanges: FileChangeSummary[];
  commands: CommandSummary[];
  todoCompleted: number;
  todoTotal: number;
  hasInProgressTodo: boolean;
  subagentCompleted: number;
  subagentTotal: number;
  hasRunningSubagent: boolean;
  commandCompleted: number;
  commandTotal: number;
  hasRunningCommand: boolean;
  totalAdditions: number;
  totalDeletions: number;
}

type ThreadStatusSnapshot = {
  isProcessing?: boolean;
};

interface StatusPanelDataOptions {
  isCodexEngine?: boolean;
  /** 真实引擎值;提供时优先用于 taskOutput attribution,避免二元假设误标 */
  activeEngine?: EngineType | null;
  activeThreadId?: string | null;
  activeTurnId?: string | null;
  itemsByThread?: Record<string, ConversationItem[]>;
  threadParentById?: Record<string, string>;
  threadStatusById?: Record<string, ThreadStatusSnapshot | undefined>;
  /**
   * S10 同源：canvas 已收集的子代理线程 id（含 Shared 无 parent 的 claude:subagent:owner:*）。
   * seed 时与 threadParentById 并集，避免历史只靠 parent 表漏子。
   */
  childSubagentThreadIds?: readonly string[] | null;
  deferSummary?: boolean;
}

type ToolItem = Extract<ConversationItem, { kind: "tool" }>;

type SubagentAccumulator = SubagentInfo & {
  statusPriority: number;
};

type StatusPanelProjectionInputs = {
  items: ConversationItem[];
  activeThreadId?: string | null;
  activeTurnId?: string | null;
  itemsByThread?: Record<string, ConversationItem[]>;
  threadParentById?: Record<string, string>;
  threadStatusById?: Record<string, ThreadStatusSnapshot | undefined>;
};

const fallbackParentByItemsByThreadCache = new WeakMap<
  Record<string, ConversationItem[]>,
  Record<string, string>
>();

function getRuntimeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function getToolTitle(item: ToolItem): string {
  return getRuntimeString((item as { title?: unknown }).title);
}

function getToolDetail(item: ToolItem): string {
  return getRuntimeString((item as { detail?: unknown }).detail);
}

function getToolType(item: ToolItem): string {
  return getRuntimeString((item as { toolType?: unknown }).toolType);
}

function getToolOutput(item: ToolItem): string | undefined {
  const output = getRuntimeString((item as { output?: unknown }).output);
  return output.length > 0 ? output : undefined;
}

const COLLAB_ACTION_NAMES = new Set([
  "spawn agent",
  "send input",
  "wait",
  "wait agent",
  "resume agent",
  "close agent",
]);

const STATUS_WEIGHT: Record<SubagentInfo["status"], number> = {
  running: 0,
  error: 1,
  completed: 2,
};

function useDeferredStatusPanelInputs(
  latestInputs: StatusPanelProjectionInputs,
  deferSummary: boolean,
): StatusPanelProjectionInputs {
  const lastReadyInputsRef = useRef(latestInputs);
  if (!deferSummary) {
    lastReadyInputsRef.current = latestInputs;
    return latestInputs;
  }
  return lastReadyInputsRef.current;
}

/**
 * 从 ConversationItem[] 中提取 StatusPanel 所需数据。
 *
 * - todos: 取最后一个 TodoWrite 工具的 detail JSON
 * - subagents: 聚合 task/agent/collab 子代理事实
 * - fileChanges: 取所有有 changes 字段的 Edit/Write 工具
 */
export function useStatusPanelData(
  items: ConversationItem[],
  options: StatusPanelDataOptions = {},
): StatusPanelData {
  const {
    isCodexEngine = false,
    activeEngine = null,
    activeThreadId,
    activeTurnId,
    itemsByThread,
    threadParentById,
    threadStatusById,
    childSubagentThreadIds = null,
    deferSummary = false,
  } = options;
  const projectionInputs = useDeferredStatusPanelInputs(
    {
      items,
      activeThreadId,
      activeTurnId,
      itemsByThread,
      threadParentById,
      threadStatusById,
    },
    deferSummary,
  );

  const todos = useMemo(() => {
    let lastTodos: TodoItem[] = [];
    for (const item of projectionInputs.items) {
      if (item.kind !== "tool") continue;
      const toolName = extractToolName(getToolTitle(item)).trim().toLowerCase();
      if (toolName !== "todowrite" && toolName !== "todo_write") continue;
      const args = parseToolArgs(getToolDetail(item));
      if (!args) continue;
      const raw = args.todos;
      if (!Array.isArray(raw)) continue;
      lastTodos = raw
        .filter(
          (t): t is { content: string; status: string } =>
            typeof t === "object" &&
            t !== null &&
            typeof (t as Record<string, unknown>).content === "string",
        )
        .map((t) => ({
          content: t.content,
          status: normalizeTodoStatus(t.status),
          activeForm:
            typeof (t as Record<string, unknown>).activeForm === "string"
              ? ((t as Record<string, unknown>).activeForm as string)
              : undefined,
        }));
    }
    return lastTodos;
  }, [projectionInputs.items]);

  const scopedToolEntries = useMemo(
    () =>
      collectScopedToolEntries(projectionInputs.items, {
        activeThreadId: projectionInputs.activeThreadId,
        activeTurnId: projectionInputs.activeTurnId,
        itemsByThread: projectionInputs.itemsByThread,
        threadParentById: projectionInputs.threadParentById,
      }),
    [
      projectionInputs.activeThreadId,
      projectionInputs.activeTurnId,
      projectionInputs.items,
      projectionInputs.itemsByThread,
      projectionInputs.threadParentById,
    ],
  );

  const subagents = useMemo(() => {
    const result = new Map<string, SubagentAccumulator>();
    const engineForTask =
      activeEngine ?? (isCodexEngine ? "codex" : "claude");

    scopedToolEntries.entries.forEach(({ threadId, item }) => {
      const toolName = extractToolName(getToolTitle(item)).trim().toLowerCase();
      const normalizedType = getToolType(item).trim().toLowerCase();
      const isCollabToolRow =
        normalizedType === "collabtoolcall" ||
        normalizedType === "collabagenttoolcall" ||
        isCollabSpawnTool(item) ||
        isCollabLifecycleTool(item);

      // Codex collab：spawn/wait/close 必须走 agentIds 路径（多 agent），不能压成单条 tool id
      if (isCollabToolRow) {
        const collabActionName = extractCollabActionName(getToolTitle(item));
        if (!COLLAB_ACTION_NAMES.has(collabActionName)) {
          return;
        }

        const fallbackLink = parseCollabFallbackLink(getToolDetail(item), threadId);
        const structuredStatuses = collectStructuredAgentStatuses(item.agentStatus);
        const textStatuses = collectTextAgentStatuses(getToolOutput(item));
        const agentIds = uniqueStringList([
          ...(item.receiverThreadIds ?? []),
          ...(fallbackLink?.receivers ?? []),
          ...Object.keys(structuredStatuses),
          ...Object.keys(textStatuses),
        ]);
        if (agentIds.length === 0) {
          // 无 receiver 时留给下方 child 种子（S10 合成同口径）
          return;
        }

        const collabDescription = extractCollabDescription(getToolOutput(item));
        agentIds.forEach((agentId) => {
          const threadScopedStatus = resolveThreadScopedSubagentStatus(
            agentId,
            projectionInputs.threadStatusById,
            projectionInputs.itemsByThread,
          );
          const explicitStatus = structuredStatuses[agentId] ?? textStatuses[agentId];
          const genericStatus = inferCollabRuntimeStatus(collabActionName, item.status);
          const resolvedStatus = threadScopedStatus ?? explicitStatus ?? genericStatus;
          if (!resolvedStatus) {
            return;
          }
          upsertSubagent(result, {
            id: agentId,
            type: agentId,
            description: collabDescription,
            status: resolvedStatus,
            statusPriority: threadScopedStatus
              ? 5
              : explicitStatus
                ? 4
                : collabActionName === "wait" ||
                    collabActionName === "wait agent" ||
                    collabActionName === "close agent"
                  ? 3
                  : 1,
            taskOutput: {
              id: agentId,
              engine: "codex",
              title: agentId,
              description: collabDescription,
              status: mapSubagentStatusToTaskOutputStatus(resolvedStatus),
              taskId: null,
              toolUseId: item.id,
              threadId: agentId,
              outputFileName: null,
              recentOutput: collabDescription || getToolOutput(item) || null,
            },
            navigationTarget: { kind: "thread", threadId: agentId },
          });
        });
        return;
      }

      // S10 宽识别：与 isSubagentTool 完全对齐（含 detail payload / 描述顶 title / swarm…）
      if (!isSubagentTool(item)) {
        return;
      }

      const args = parseToolArgs(getToolDetail(item));
      const resolved = resolveToolStatus(item.status, Boolean(getToolOutput(item)));
      const taskStatus =
        resolved === "failed"
          ? "error"
          : resolved === "completed"
            ? "completed"
            : "running";
      const onChildThread =
        Boolean(scopedToolEntries.rootThreadId) &&
        threadId !== scopedToolEntries.rootThreadId;
      const threadScopedStatus = onChildThread
        ? resolveThreadScopedSubagentStatus(
            threadId,
            projectionInputs.threadStatusById,
            projectionInputs.itemsByThread,
          )
        : undefined;
      const taskDescription = extractTaskDescription(args, item);
      const taskType = extractTaskType(args, toolName);
      const taskId = resolveTaskLikeTaskId(args);
      const toolOutput = getToolOutput(item) ?? null;
      // S10 同源：优先 subagent_id/agentId（args 或 output meta），禁止只用 tool 行 id
      // （tool 行 id 无法 load 子会话 → 右侧详情退回原始 JSON）
      const agentKey = extractSubagentAgentKey(args, toolOutput);
      const subagentId = onChildThread ? threadId : agentKey ?? item.id;
      const subagentType = onChildThread ? threadId : taskType;
      const sessionThreadHint = onChildThread ? threadId : agentKey;
      upsertSubagent(result, {
        id: subagentId,
        type: subagentType,
        description: taskDescription,
        status: threadScopedStatus ?? taskStatus,
        statusPriority: threadScopedStatus ? 5 : 2,
        taskOutput: {
          id: subagentId,
          engine: engineForTask,
          title: taskType,
          description: taskDescription,
          status: mapSubagentStatusToTaskOutputStatus(threadScopedStatus ?? taskStatus),
          taskId,
          toolUseId: item.id,
          threadId: sessionThreadHint,
          outputFileName: extractOutputFileName(args),
          outputFilePath: extractOutputFilePath(args),
          // 详情回退用：优先 output；历史常只有 detail，把 detail 也并入便于抽 agentId
          recentOutput:
            toolOutput ||
            (typeof getToolDetail(item) === "string" ? getToolDetail(item) : null),
        },
        navigationTarget: onChildThread
          ? { kind: "thread", threadId }
          : sessionThreadHint && looksLikeLoadableThreadId(sessionThreadHint)
            ? { kind: "thread", threadId: sessionThreadHint }
            : buildTaskLikeNavigationTarget(item, args),
      });
    });

    // tool/collab 扫空时：parent 表 ∪ canvas 子代理线程列表（S10 childSubagentThreads 同源）
    if (result.size === 0) {
      seedSubagentsFromChildTree(result, {
        rootThreadId:
          scopedToolEntries.rootThreadId ??
          projectionInputs.activeThreadId ??
          null,
        activeThreadId: projectionInputs.activeThreadId ?? null,
        threadParentById: projectionInputs.threadParentById,
        threadStatusById: projectionInputs.threadStatusById,
        itemsByThread: projectionInputs.itemsByThread,
        childSubagentThreadIds,
        engine: engineForTask,
      });
    }

    return Array.from(result.values())
      .map(({ statusPriority: _statusPriority, ...subagent }) => subagent)
      .sort((left, right) => {
        const weightDiff = STATUS_WEIGHT[left.status] - STATUS_WEIGHT[right.status];
        if (weightDiff !== 0) {
          return weightDiff;
        }
        return left.type.localeCompare(right.type);
      });
  }, [
    activeEngine,
    childSubagentThreadIds,
    isCodexEngine,
    projectionInputs.activeThreadId,
    projectionInputs.itemsByThread,
    projectionInputs.threadParentById,
    projectionInputs.threadStatusById,
    scopedToolEntries,
  ]);

  const fileChanges = useMemo(() => {
    return extractFileChangeSummaries(
      scopedToolEntries.entries.map(({ item }) => item),
    ) as FileChangeSummary[];
  }, [scopedToolEntries]);

  const commands = useMemo(() => {
    return extractCommandSummaries(
      scopedToolEntries.entries.map(({ item }) => item),
      { isCodexEngine },
    ) as CommandSummary[];
  }, [isCodexEngine, scopedToolEntries]);

  const todoStats = useMemo(() => {
    const completed = todos.filter((t) => t.status === "completed").length;
    const hasInProgress = todos.some((t) => t.status === "in_progress");
    return {
      todoCompleted: completed,
      todoTotal: todos.length,
      hasInProgressTodo: hasInProgress,
    };
  }, [todos]);

  const subagentStats = useMemo(() => {
    const completed = subagents.filter((s) => s.status === "completed").length;
    const hasRunning = subagents.some((s) => s.status === "running");
    return {
      subagentCompleted: completed,
      subagentTotal: subagents.length,
      hasRunningSubagent: hasRunning,
    };
  }, [subagents]);

  const commandStats = useMemo(() => {
    const completed = commands.filter((c) => c.status === "completed").length;
    const hasRunning = commands.some((c) => c.status === "running");
    return {
      commandCompleted: completed,
      commandTotal: commands.length,
      hasRunningCommand: hasRunning,
    };
  }, [commands]);

  const fileStats = useMemo(() => {
    let totalAdditions = 0;
    let totalDeletions = 0;
    for (const change of fileChanges) {
      totalAdditions += change.additions;
      totalDeletions += change.deletions;
    }
    return {
      totalAdditions,
      totalDeletions,
    };
  }, [fileChanges]);

  return {
    todos,
    subagents,
    fileChanges,
    commands,
    ...todoStats,
    ...subagentStats,
    ...commandStats,
    ...fileStats,
  };
}

export function collectScopedToolEntries(
  items: ConversationItem[],
  options: Pick<
    StatusPanelDataOptions,
    "activeThreadId" | "activeTurnId" | "itemsByThread" | "threadParentById"
  >,
) {
  const currentThreadId = options.activeThreadId ?? "current-thread";
  const currentTurnId = options.activeTurnId?.trim() || null;
  const filterEntriesForTurn = (
    entries: Array<{ threadId: string; item: ToolItem }>,
  ) => {
    if (!currentTurnId) {
      return entries;
    }
    const matchingTurnEntries = entries.filter(
      ({ item }) => (item.turnId?.trim() || null) === currentTurnId,
    );
    return matchingTurnEntries.length > 0 ? matchingTurnEntries : entries;
  };
  if (!options.activeThreadId || !options.itemsByThread) {
    return {
      rootThreadId: null,
      entries: filterEntriesForTurn(
        items
          .filter((item): item is ToolItem => item.kind === "tool")
          .map((item) => ({ threadId: currentThreadId, item })),
      ),
    };
  }

  const fallbackParentById = getFallbackParentById(options.itemsByThread);
  const rootThreadId = resolveRootThreadId(
    options.activeThreadId,
    options.threadParentById ?? {},
    fallbackParentById,
  );
  const candidateThreadIds = new Set<string>([
    options.activeThreadId,
    rootThreadId,
    ...Object.keys(options.itemsByThread),
    ...Object.keys(options.threadParentById ?? {}),
    ...Object.values(options.threadParentById ?? {}),
    ...Object.keys(fallbackParentById),
    ...Object.values(fallbackParentById),
  ]);

  const relevantThreadIds = Array.from(candidateThreadIds).filter(
    (threadId) =>
      threadId &&
      isDescendantOfRoot(
        threadId,
        rootThreadId,
        options.threadParentById ?? {},
        fallbackParentById,
      ),
  );

  return {
    rootThreadId,
    entries: filterEntriesForTurn(
      relevantThreadIds.flatMap((threadId) =>
        (options.itemsByThread?.[threadId] ?? [])
          .filter((item): item is ToolItem => item.kind === "tool")
          .map((item) => ({ threadId, item })),
      ),
    ),
  };
}

export function buildFallbackParentById(
  itemsByThread: Record<string, ConversationItem[]>,
) {
  const fallbackParentById: Record<string, string> = {};
  Object.entries(itemsByThread).forEach(([threadId, entries]) => {
    entries.forEach((item) => {
      if (item.kind !== "tool" || getToolType(item) !== "collabToolCall") {
        return;
      }
      const parsed = parseCollabFallbackLink(getToolDetail(item), threadId);
      if (!parsed) {
        return;
      }
      parsed.receivers.forEach((receiverId) => {
        if (!fallbackParentById[receiverId]) {
          fallbackParentById[receiverId] = parsed.parentId;
        }
      });
    });
  });
  return fallbackParentById;
}

export function getFallbackParentById(
  itemsByThread: Record<string, ConversationItem[]>,
) {
  const cached = fallbackParentByItemsByThreadCache.get(itemsByThread);
  if (cached) {
    return cached;
  }
  const fallbackParentById = buildFallbackParentById(itemsByThread);
  fallbackParentByItemsByThreadCache.set(itemsByThread, fallbackParentById);
  return fallbackParentById;
}

function resolveRootThreadId(
  activeThreadId: string,
  threadParentById: Record<string, string>,
  fallbackParentById: Record<string, string>,
) {
  const visited = new Set<string>();
  let current = activeThreadId;
  while (current && !visited.has(current)) {
    visited.add(current);
    const nextParent = threadParentById[current] ?? fallbackParentById[current];
    if (!nextParent) {
      return current;
    }
    current = nextParent;
  }
  return activeThreadId;
}

function isDescendantOfRoot(
  threadId: string,
  rootThreadId: string,
  threadParentById: Record<string, string>,
  fallbackParentById: Record<string, string>,
) {
  if (threadId === rootThreadId) {
    return true;
  }
  const visited = new Set<string>();
  let current: string | undefined = threadId;
  while (current && !visited.has(current)) {
    visited.add(current);
    const nextParent: string | undefined =
      threadParentById[current] ?? fallbackParentById[current];
    if (!nextParent) {
      return false;
    }
    if (nextParent === rootThreadId) {
      return true;
    }
    current = nextParent;
  }
  return false;
}

/**
 * S10 同源：从 args / output 抽 subagent_id / agentId，供 Strip→inspector 加载子会话。
 */
function extractSubagentAgentKey(
  args: Record<string, unknown> | null,
  outputText: string | null,
): string | null {
  for (const key of [
    "subagent_id",
    "subagentId",
    "agent_id",
    "agentId",
    "agentID",
    "child_session_id",
    "childSessionId",
  ]) {
    const value = args?.[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  const nested = args?._input;
  if (nested && typeof nested === "object" && nested !== null) {
    const fromNested = extractSubagentAgentKey(
      nested as Record<string, unknown>,
      null,
    );
    if (fromNested) {
      return fromNested;
    }
  }
  if (!outputText?.trim()) {
    return null;
  }
  const match =
    /subagent_id\s*[:=]\s*['"]?([a-z0-9:_-]+)['"]?/i.exec(outputText) ??
    /"subagent_id"\s*:\s*"([^"]+)"/i.exec(outputText) ??
    /agentId\s*[:=]\s*['"]?([a-z0-9:_-]+)['"]?/i.exec(outputText) ??
    /"agentId"\s*:\s*"([^"]+)"/i.exec(outputText) ??
    /agent_id\s*[:=]\s*['"]?([a-z0-9:_-]+)['"]?/i.exec(outputText) ??
    /"agent_id"\s*:\s*"([^"]+)"/i.exec(outputText);
  return match?.[1]?.trim() || null;
}

/** 已是可交给 history loader 的 thread id（或裸 UUID / Claude hex） */
function looksLikeLoadableThreadId(id: string): boolean {
  const raw = id.trim();
  if (!raw) return false;
  if (
    raw.startsWith("claude:") ||
    raw.startsWith("grok:") ||
    raw.startsWith("kimi:") ||
    raw.startsWith("gemini:") ||
    raw.startsWith("opencode:") ||
    raw.startsWith("shared:")
  ) {
    return true;
  }
  if (/^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(raw)) return true;
  if (/^[a-f0-9]{12,32}$/i.test(raw)) return true;
  return false;
}

function extractTaskDescription(args: Record<string, unknown> | null, item: ToolItem) {
  return (
    (args && typeof args.description === "string" ? args.description : "") ||
    (args && typeof args.prompt === "string" ? args.prompt : "") ||
    (args && typeof args.query === "string" ? args.query : "") ||
    (args && typeof args.task === "string" ? args.task : "") ||
    getToolOutput(item)?.split(/\r?\n/, 1)[0]?.trim() ||
    getToolTitle(item).replace(/^Tool:\s*/i, "").trim() ||
    "Subagent"
  )
    .trim()
    .slice(0, 120);
}

function extractTaskType(args: Record<string, unknown> | null, fallbackToolName: string) {
  const rawSubagentType =
    args && typeof args.subagent_type === "string"
      ? args.subagent_type
      : args && typeof args.agent === "string"
        ? args.agent
        : args && typeof args.type === "string"
          ? args.type
          : args && typeof args.name === "string"
            ? args.name
            : args && typeof args.tool === "string"
              ? args.tool
              : "";
  const normalizedType = rawSubagentType.trim();
  return normalizedType.length > 0 ? normalizedType : fallbackToolName || "task";
}

function buildTaskLikeNavigationTarget(
  item: ToolItem,
  args: Record<string, unknown> | null,
): SubagentNavigationTarget | null {
  const normalizedToolType = getToolType(item).trim().toLowerCase();
  const normalizedTitle = extractToolName(getToolTitle(item)).trim().toLowerCase();
  const isClaudeAgentTool =
    normalizedToolType === "agent" || normalizedTitle === "agent";
  if (isClaudeAgentTool) {
    const taskId = resolveTaskLikeTaskId(args);
    return {
      kind: "claude-task",
      taskId,
      toolUseId: item.id,
    };
  }
  return null;
}

function resolveTaskLikeTaskId(args: Record<string, unknown> | null) {
  const rawTaskId =
    typeof args?.task_id === "string"
      ? args.task_id
      : typeof args?.taskId === "string"
        ? args.taskId
        : "";
  const normalized = rawTaskId.trim();
  return normalized.length > 0 ? normalized : null;
}

function mapSubagentStatusToTaskOutputStatus(status: SubagentInfo["status"]) {
  if (status === "error") {
    return "error";
  }
  if (status === "completed") {
    return "completed";
  }
  return "running";
}

function extractOutputFileName(args: Record<string, unknown> | null) {
  const normalized = extractOutputFilePath(args);
  if (!normalized) {
    return null;
  }
  return normalized.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? normalized;
}

function extractOutputFilePath(args: Record<string, unknown> | null) {
  const rawOutputFile =
    typeof args?.output_file === "string"
      ? args.output_file
      : typeof args?.outputFile === "string"
        ? args.outputFile
        : "";
  const normalized = rawOutputFile.trim();
  return normalized.length > 0 ? normalized : null;
}

function extractCollabActionName(title: string) {
  const matched = title.match(/^Collab:\s*(.+)$/i);
  return (matched?.[1] ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ");
}

function collectStructuredAgentStatuses(
  value: ToolItem["agentStatus"],
): Record<string, SubagentInfo["status"]> {
  const result: Record<string, SubagentInfo["status"]> = {};
  const normalizedStatuses = normalizeCollabAgentStatusMap(value);
  if (!normalizedStatuses) {
    return result;
  }
  Object.entries(normalizedStatuses).forEach(([agentId, state]) => {
    const normalizedStatus = normalizeSubagentStatusValue(state.status);
    if (!normalizedStatus) {
      return;
    }
    result[agentId] = normalizedStatus;
  });
  return result;
}

function collectTextAgentStatuses(output: string | undefined) {
  const result: Record<string, SubagentInfo["status"]> = {};
  if (!output) {
    return result;
  }
  output.split(/\r?\n/).forEach((line) => {
    const parsed = parseTextAgentStatusLine(line);
    if (!parsed) {
      return;
    }
    result[parsed.agentId] = parsed.status;
  });
  return result;
}

function parseTextAgentStatusLine(line: string) {
  const separatorIndex = line.indexOf(":");
  if (separatorIndex <= 0) {
    return null;
  }
  const agentId = line.slice(0, separatorIndex).trim();
  const rawStatus = line.slice(separatorIndex + 1).trim();
  const status = normalizeSubagentStatusValue(rawStatus);
  if (!agentId || !status) {
    return null;
  }
  return { agentId, status };
}

function normalizeSubagentStatusValue(value: unknown): SubagentInfo["status"] | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (/(fail|error|cancel(?:led)?|abort|timeout|timed[_ -]?out)/.test(normalized)) {
    return "error";
  }
  if (/(complete|completed|success|succeed(?:ed)?|done|finish(?:ed)?)/.test(normalized)) {
    return "completed";
  }
  if (/(pending|running|processing|started|in[_ -]?progress|inprogress|queued)/.test(normalized)) {
    return "running";
  }
  return null;
}

function extractCollabDescription(output: string | undefined) {
  if (!output) {
    return "";
  }
  const sections = output
    .split(/\r?\n\s*\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const firstReadableSection = sections.find((section) => {
    const statusLines = section
      .split(/\r?\n/)
      .filter((line) => Boolean(line.trim()))
      .filter((line) => Boolean(parseTextAgentStatusLine(line)));
    return statusLines.length === 0;
  });
  return (firstReadableSection ?? "").slice(0, 120);
}

function inferCollabRuntimeStatus(
  collabActionName: string,
  toolStatus: string | undefined,
): SubagentInfo["status"] | null {
  const resolved = resolveToolStatus(toolStatus, false);
  if (resolved === "failed") {
    return "error";
  }
  if (
    collabActionName === "spawn agent" ||
    collabActionName === "send input" ||
    collabActionName === "resume agent"
  ) {
    return "running";
  }
  if (collabActionName === "close agent") {
    return resolved === "completed" ? "completed" : "running";
  }
  if (collabActionName === "wait" || collabActionName === "wait agent") {
    return resolved === "completed" ? "completed" : "running";
  }
  return null;
}

function resolveThreadScopedSubagentStatus(
  threadId: string,
  threadStatusById: Record<string, ThreadStatusSnapshot | undefined> | undefined,
  itemsByThread: Record<string, ConversationItem[]> | undefined,
): SubagentInfo["status"] | undefined {
  const status = threadStatusById?.[threadId];
  if (status?.isProcessing) {
    return "running";
  }
  const threadItems = itemsByThread?.[threadId] ?? [];
  if (threadItems.length === 0) {
    return undefined;
  }
  return inferHistoricalThreadTerminalStatus(threadItems);
}

/**
 * parent→child 子树补 SubagentInfo（Strip / StatusPanel 共用）。
 * 不限引擎：Claude/Grok/Shared 历史重开与 Codex wait 无 receiver 都走这里。
 */
function seedSubagentsFromChildTree(
  result: Map<string, SubagentAccumulator>,
  options: {
    rootThreadId: string | null;
    activeThreadId: string | null;
    threadParentById?: Record<string, string>;
    threadStatusById?: Record<string, ThreadStatusSnapshot | undefined>;
    itemsByThread?: Record<string, ConversationItem[]>;
    /** S10 canvas child 列表（可含无 parent 的 subagent 行） */
    childSubagentThreadIds?: readonly string[] | null;
    engine?: EngineType | null;
  },
) {
  const parentById = options.threadParentById ?? {};
  const rootId =
    (options.rootThreadId ?? options.activeThreadId ?? "").trim() || null;
  // parent 表：仅当前根下的直接 children
  const fromParentMap = rootId
    ? Object.entries(parentById)
        .filter(([, parentId]) => parentId === rootId)
        .map(([childId]) => childId.trim())
        .filter((childId) => childId && childId !== rootId)
    : [];
  // canvas 已过滤的子代理线程（Shared claude:subagent:owner:* 等）
  const fromCanvasChildren = (options.childSubagentThreadIds ?? [])
    .map((id) => id.trim())
    .filter((id) => id && id !== rootId);
  const childIds = uniqueStringList([...fromParentMap, ...fromCanvasChildren]);
  if (childIds.length === 0) {
    return;
  }
  const engineLabel: EngineType = options.engine ?? "claude";
  childIds.forEach((childId) => {
    const threadScopedStatus = resolveThreadScopedSubagentStatus(
      childId,
      options.threadStatusById,
      options.itemsByThread,
    );
    // 无任何证据时默认 running（live 常见）；有历史 assistant/tool 终态则用终态
    const status = threadScopedStatus ?? "running";
    upsertSubagent(result, {
      id: childId,
      type: childId,
      description: "",
      status,
      statusPriority: threadScopedStatus ? 5 : 2,
      taskOutput: {
        id: childId,
        engine: engineLabel,
        title: childId,
        description: "",
        status: mapSubagentStatusToTaskOutputStatus(status),
        taskId: null,
        toolUseId: null,
        threadId: childId,
        outputFileName: null,
        recentOutput: null,
      },
      navigationTarget: { kind: "thread", threadId: childId },
    });
  });
}

function inferHistoricalThreadTerminalStatus(
  items: ConversationItem[],
): SubagentInfo["status"] | undefined {
  const lastMeaningfulItem = findLastMeaningfulThreadHistoryItem(items);
  if (!lastMeaningfulItem) {
    return undefined;
  }

  if (lastMeaningfulItem.kind === "message") {
    return lastMeaningfulItem.role === "assistant" ? "completed" : undefined;
  }

  if (lastMeaningfulItem.kind === "tool") {
    const resolved = resolveToolStatus(
      lastMeaningfulItem.status,
      Boolean(lastMeaningfulItem.output),
    );
    return resolved === "failed" ? "error" : "completed";
  }

  if (lastMeaningfulItem.kind === "diff") {
    return normalizeSubagentStatusValue(lastMeaningfulItem.status) === "error"
      ? "error"
      : "completed";
  }

  return "completed";
}

function findLastMeaningfulThreadHistoryItem(items: ConversationItem[]) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item) {
      continue;
    }
    if (item.kind === "message") {
      if (item.role === "user") {
        return item;
      }
      if (
        item.text.trim() ||
        item.isFinal === true ||
        typeof item.finalCompletedAt === "number"
      ) {
        return item;
      }
      continue;
    }
    if (
      item.kind === "reasoning" &&
      !item.summary.trim() &&
      !item.content.trim()
    ) {
      continue;
    }
    return item;
  }
  return undefined;
}

function upsertSubagent(
  target: Map<string, SubagentAccumulator>,
  next: SubagentAccumulator,
) {
  const existing = target.get(next.id);
  if (!existing) {
    target.set(next.id, next);
    return;
  }
  target.set(next.id, {
    ...existing,
    type: choosePreferredSubagentLabel(existing.type, next.type),
    description: choosePreferredDescription(existing.description, next.description),
    navigationTarget: choosePreferredNavigationTarget(
      existing.navigationTarget,
      next.navigationTarget,
    ),
    taskOutput: choosePreferredTaskOutput(existing.taskOutput, next.taskOutput),
    status:
      next.statusPriority >= existing.statusPriority ? next.status : existing.status,
    statusPriority: Math.max(existing.statusPriority, next.statusPriority),
  });
}

function choosePreferredTaskOutput(
  current: SubagentInfo["taskOutput"],
  next: SubagentInfo["taskOutput"],
) {
  if (!current) {
    return next ?? null;
  }
  if (!next) {
    return current;
  }
  if (next.recentOutput && !current.recentOutput) {
    return next;
  }
  if (next.threadId && !current.threadId) {
    return next;
  }
  if (next.taskId && !current.taskId) {
    return next;
  }
  return current;
}

function choosePreferredNavigationTarget(
  current: SubagentNavigationTarget | null | undefined,
  next: SubagentNavigationTarget | null | undefined,
): SubagentNavigationTarget | null {
  if (!current) {
    return next ?? null;
  }
  if (!next) {
    return current;
  }
  if (current.kind !== next.kind) {
    return current;
  }
  if (current.kind === "thread" && next.kind === "thread") {
    return current.threadId ? current : next;
  }
  if (current.kind === "claude-task" && next.kind === "claude-task") {
    const currentScore = Number(Boolean(current.taskId)) + Number(Boolean(current.toolUseId));
    const nextScore = Number(Boolean(next.taskId)) + Number(Boolean(next.toolUseId));
    return nextScore > currentScore ? next : current;
  }
  return current;
}

function choosePreferredSubagentLabel(current: string, next: string) {
  if (!current) {
    return next;
  }
  if (!next) {
    return current;
  }
  const currentGeneric = /^(task|agent)$/i.test(current);
  const nextGeneric = /^(task|agent)$/i.test(next);
  if (currentGeneric && !nextGeneric) {
    return next;
  }
  return current;
}

function choosePreferredDescription(current: string, next: string) {
  if (!current) {
    return next;
  }
  if (!next) {
    return current;
  }
  return next.length > current.length ? next : current;
}

function uniqueStringList(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach((value) => {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    result.push(normalized);
  });
  return result;
}

function normalizeTodoStatus(status: unknown): TodoItem["status"] {
  if (typeof status !== "string") return "pending";
  const lower = status.toLowerCase();
  if (lower === "completed" || lower === "done") return "completed";
  if (
    lower === "in_progress" ||
    lower === "in-progress" ||
    lower === "inprogress"
  ) {
    return "in_progress";
  }
  return "pending";
}
