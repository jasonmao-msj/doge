import { isSharedSessionThreadId } from "../../shared-session/utils/sharedSessionIdentity";
import {
  sharedSessionV2AwaitTurnTerminal,
  sharedSessionV2CancelAttempt,
  sharedSessionV2DispatchTurn,
  sharedSessionV2InterruptTurn,
  sharedSessionV2PrepareDelivery,
  sharedSessionV2RecoverAttempt,
} from "../../shared-session/services/sharedSessions";
import { sendSharedSessionTurnV2 } from "../../shared-session/runtime/sendSharedSessionTurnV2";
import {
  isResolvedExecutionTarget,
  type ExecutionTarget,
} from "../../shared-session/target/types";
import { isSharedSessionSupportedEngine } from "../../shared-session/utils/sharedSessionEngines";
import {
  sharedAgentApprove,
  sharedAgentCancel,
  sharedAgentFinalizeCancel,
  sharedAgentGet,
  sharedAgentListAll,
  sharedAgentRecordExecute,
  sharedAgentRequestRun,
  sharedAgentRetryStage,
} from "../../../services/tauri/agentOrchestration";
import { pushErrorToast } from "../../../services/toasts";
import {
  flushAgentProjectionNotify,
  publishAgentProjection,
  registerAgentAttempt,
} from "../store/agentStore";
import {
  clearCollabUiState,
  patchCollabUiState,
  setCollabUiState,
} from "../store/collabUiStore";
import {
  beginAgentLivePhase,
  clearAgentLivePhase,
  getAgentStageLiveText,
  resetAgentLivePhaseArchive,
  seedAgentStageArchive,
} from "./livePhaseChannel";
import { pickLongestStageBody } from "../utils/stageBodyText";
import {
  emitApproveConversationItems,
  emitCollabStatusAssistantMessage,
  emitCollabVisibleUserMessage,
  emitMultiAgentConversationItems,
  emitReplanConversationItems,
} from "./conversationBridge";
import {
  applyCollabThreadProcessingFromProjection,
  restoreCollabThreadProcessingIfActive,
  setCollabThreadProcessing,
} from "./collabThreadProcessingBridge";
import { openAgentInspector } from "../store/inspectorStore";
import type {
  AgentExecutionTarget,
  AgentPreparedAttempt,
  AgentProjectionV1,
  AgentStageBinding,
} from "../types";
import { isTerminalAgentStatus } from "../types";
import { buildCollabSummarySendText } from "@/conversation-presentation/multi-agent/collabPrompt";
import { maT } from "../utils/i18n";

const ATTEMPT_TIMEOUT_MS = 30 * 60 * 1_000;
const running = new Map<string, Promise<AgentProjectionV1>>();
/** 驱动链中止令牌：单节点重试时打断旧 driveAutoChain，避免与新链竞态 */
const chainTokens = new Map<string, { generation: number }>();

function chainKey(workspaceId: string, threadId: string, runId: string): string {
  return `${workspaceId}\u0000${threadId}\u0000${runId}`;
}

function bumpChainGeneration(
  workspaceId: string,
  threadId: string,
  runId: string,
): number {
  const key = chainKey(workspaceId, threadId, runId);
  const prev = chainTokens.get(key)?.generation ?? 0;
  const next = prev + 1;
  chainTokens.set(key, { generation: next });
  return next;
}

function currentChainGeneration(
  workspaceId: string,
  threadId: string,
  runId: string,
): number {
  return chainTokens.get(chainKey(workspaceId, threadId, runId))?.generation ?? 0;
}

function collabFlowLabel(stageBindings?: AgentStageBinding[]): string {
  return (
    (stageBindings ?? [])
      .map((binding) => binding.title?.trim() || binding.id)
      .filter(Boolean)
      .join(" → ") ||
    maT("multiAgent.collab.defaultFlow", {
      defaultValue: "规划 → 实现 → 审查",
    })
  );
}

/** 主幕 sticky 窗相位：阶段切换/空窗期都保持可见，避免用户误以为中断 */
function patchCollabPhase(
  workspaceId: string,
  threadId: string,
  phase: "running_stages" | "summarizing",
  activeStageId?: string | null,
): void {
  patchCollabUiState(workspaceId, threadId, {
    phase,
    ...(phase === "summarizing"
      ? {
          headline: maT("multiAgent.collab.summarizing"),
          detail: maT("multiAgent.collab.summarizingDetail"),
          activeStageId: null,
        }
      : { activeStageId: activeStageId ?? null }),
  });
}

function key(workspaceId: string, threadId: string, runId: string): string {
  return `${workspaceId}\u0000${threadId}\u0000${runId}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asPrepared(
  value: AgentPreparedAttempt | null | undefined,
): AgentPreparedAttempt | null {
  if (!value) return null;
  return {
    ...value,
    stageId: value.stageId || value.phase || "plan",
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  attemptId: string,
): Promise<T> {
  let timeoutId: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = window.setTimeout(
          () => reject(new Error(`agent-attempt-timeout: ${attemptId}`)),
          ATTEMPT_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

async function driveAttempt(
  workspaceId: string,
  threadId: string,
  attempt: AgentPreparedAttempt,
): Promise<void> {
  const stageId = attempt.stageId || "plan";
  registerAgentAttempt(attempt.attemptId, {
    workspaceId,
    threadId,
    phase: stageId,
    bindingKey: attempt.bindingKey,
  });
  beginAgentLivePhase(
    workspaceId,
    threadId,
    attempt.attemptId,
    stageId,
    attempt.runId,
  );
  openAgentInspector({
    workspaceId,
    threadId,
    runId: attempt.runId,
    stageId,
  });
  const delivery = await sharedSessionV2PrepareDelivery(
    workspaceId,
    threadId,
    attempt.attemptId,
  );
  await sharedSessionV2DispatchTurn(workspaceId, threadId, {
    attemptId: attempt.attemptId,
    artifactId: delivery.artifactId,
    artifactChecksum: delivery.artifactChecksum,
    accessMode: attempt.accessMode === "current" ? "current" : "read-only",
    collaborationMode: null,
  });
  await withTimeout(
    sharedSessionV2AwaitTurnTerminal(
      workspaceId,
      threadId,
      attempt.attemptId,
    ),
    attempt.attemptId,
  );
}

/**
 * 驱动 N 段串行：drive → record → 若有下一段 attempt 则继续；
 * awaiting-approval / terminal 则停。
 */
function unwrapRecorded(recorded: unknown): {
  projection: AgentProjectionV1;
  stageAttempt: AgentPreparedAttempt | null;
} {
  if (recorded && typeof recorded === "object" && "projection" in recorded) {
    const row = recorded as {
      projection: AgentProjectionV1;
      stageAttempt?: AgentPreparedAttempt | null;
    };
    return {
      projection: row.projection,
      stageAttempt: asPrepared(row.stageAttempt ?? null),
    };
  }
  return {
    projection: recorded as AgentProjectionV1,
    stageAttempt: null,
  };
}

/**
 * 驱动 N 段串行：drive → record_execute → 有 next 继续。
 * 统一走 record_execute（后端按 requires_approval 门闩），避免首段强制 plan parse 误杀。
 */
async function driveAutoChain(
  workspaceId: string,
  threadId: string,
  runId: string,
  first: AgentPreparedAttempt,
  generation?: number,
): Promise<AgentProjectionV1> {
  const gen =
    generation ?? bumpChainGeneration(workspaceId, threadId, runId);
  let attempt: AgentPreparedAttempt | null = first;
  let guard = 0;
  while (attempt && guard < 32) {
    guard += 1;
    if (currentChainGeneration(workspaceId, threadId, runId) !== gen) {
      // 被单节点重试/强制停打断
      return (
        (await sharedAgentGet(workspaceId, threadId)) ??
        ({ runId, status: "cancelled" } as AgentProjectionV1)
      );
    }
    // 进度只走 sticky 编排卡 / 右栏，不在主幕时间线刷「协作进展」气泡
    patchCollabPhase(workspaceId, threadId, "running_stages", attempt.stageId);
    try {
      await driveAttempt(workspaceId, threadId, attempt);
    } catch (error) {
      if (currentChainGeneration(workspaceId, threadId, runId) !== gen) {
        return (
          (await sharedAgentGet(workspaceId, threadId)) ??
          ({ runId, status: "cancelled" } as AgentProjectionV1)
        );
      }
      throw error;
    }

    if (currentChainGeneration(workspaceId, threadId, runId) !== gen) {
      return (
        (await sharedAgentGet(workspaceId, threadId)) ??
        ({ runId, status: "cancelled" } as AgentProjectionV1)
      );
    }

    // 本段 live 全文（clear 前抓一次）
    const liveFull = getAgentStageLiveText(
      workspaceId,
      threadId,
      attempt.stageId,
      runId,
    );
    const recorded = await sharedAgentRecordExecute(
      workspaceId,
      threadId,
      runId,
      attempt.attemptId,
    );
    const { projection, stageAttempt: nextAttempt } = unwrapRecorded(recorded);
    publishAgentProjection(workspaceId, threadId, projection);

    // 只归档「本段」最长正文一次；禁止 live 半截盖住 fullOutcome
    const currentStage = (projection.stages ?? []).find(
      (stage) => stage.id === attempt!.stageId,
    );
    const archiveBody = pickLongestStageBody(
      liveFull,
      currentStage?.fullOutcome,
      attempt.stageId === "plan" || currentStage?.requiresApproval
        ? projection.plan?.markdown
        : "",
      currentStage?.shortOutcome,
    );
    if (archiveBody) {
      seedAgentStageArchive(
        workspaceId,
        threadId,
        projection.runId,
        attempt.stageId,
        archiveBody,
      );
    }

    if (isTerminalAgentStatus(projection.status)) {
      return projection;
    }
    if (projection.status === "awaiting-approval") {
      return projection;
    }
    if (!nextAttempt) {
      // 再 hydrate 一次：可能已 settle 但字段未带齐
      const latest = await sharedAgentGet(workspaceId, threadId);
      if (latest) {
        publishAgentProjection(workspaceId, threadId, latest);
        return latest;
      }
      return projection;
    }
    // 防止同一 attempt 死循环
    if (nextAttempt.attemptId === attempt.attemptId) {
      return projection;
    }
    clearAgentLivePhase(workspaceId, threadId);
    attempt = nextAttempt;
  }
  return (
    (await sharedAgentGet(workspaceId, threadId)) ??
    ({ runId, status: "failed" } as AgentProjectionV1)
  );
}

function toExecutionTarget(target: AgentExecutionTarget): ExecutionTarget {
  return {
    engine: target.engine,
    providerProfileId: target.providerProfileId ?? null,
    modelCatalogEntryId: target.modelCatalogEntryId ?? null,
    model: target.model ?? null,
    reasoning: target.reasoningEffort
      ? { effort: target.reasoningEffort }
      : null,
    providerProfileNameSnapshot: target.providerProfileNameSnapshot ?? null,
    providerProfileSource:
      target.providerProfileSource === "managed" ||
      target.providerProfileSource === "disk"
        ? target.providerProfileSource
        : target.providerProfileSource === "local"
          ? "disk"
          : null,
  };
}

async function runSharedOrchestratorTurn(input: {
  workspaceId: string;
  threadId: string;
  target: AgentExecutionTarget;
  /** 模型可见正文（可含内部标记；幕布会隐藏/剥离） */
  modelText: string;
  accessMode?: "read-only" | "current";
  label: string;
}): Promise<void> {
  const execTarget = toExecutionTarget(input.target);
  if (
    !isSharedSessionSupportedEngine(execTarget.engine) ||
    !isResolvedExecutionTarget(execTarget)
  ) {
    return;
  }
  try {
    const result = await sendSharedSessionTurnV2({
      workspaceId: input.workspaceId,
      threadId: input.threadId,
      engine: execTarget.engine,
      text: input.modelText,
      model: execTarget.model ?? null,
      effort: execTarget.reasoning?.effort ?? null,
      images: [],
      accessMode: input.accessMode ?? "read-only",
      target: execTarget,
      providerMeta: {
        providerProfileNameSnapshot: execTarget.providerProfileNameSnapshot,
        providerProfileSource: execTarget.providerProfileSource,
        runtimeCapabilityFingerprint:
          input.target.runtimeCapabilityFingerprint ?? null,
      },
    });
    if (result && typeof result === "object" && "status" in result) {
      const status = (result as { status?: string }).status;
      if (
        status === "blocked" ||
        status === "recovery-required" ||
        status === "target-unavailable" ||
        status === "cancelled"
      ) {
        console.warn(`[multi-agent] ${input.label} skipped`, result);
      }
    }
  } catch (error) {
    console.warn(`[multi-agent] ${input.label} failed`, error);
  }
}

/**
 * 调度开场短状态（非「协作进展」环节刷屏）。
 * 仅在启动时发一条，表明已接到任务；阶段进度仍走 sticky / 右栏。
 */
function emitCollabBootstrapStatus(input: {
  workspaceId: string;
  threadId: string;
  text: string;
  flowLabel: string;
}): void {
  const task = input.text.trim().slice(0, 80);
  const taskLabel = task
    ? task + (input.text.trim().length > 80 ? "…" : "")
    : maT("multiAgent.collab.emptyTask", { defaultValue: "（空任务）" });
  emitCollabStatusAssistantMessage(
    input.workspaceId,
    input.threadId,
    `bootstrap:${Date.now()}`,
    [
      maT("multiAgent.collab.bootstrapReceived", {
        task: taskLabel,
        defaultValue: `已接收协作任务：**${taskLabel}**`,
      }),
      maT("multiAgent.collab.bootstrapFlow", {
        flow: input.flowLabel,
        defaultValue: `流程：**${input.flowLabel}** · 右侧查看各环节直播，主幕保持简洁进度。`,
      }),
    ].join("\n"),
  );
}

/** 节点全部完成后：主幕模型再跑一轮，生成交付汇总（非字符串拼接） */
async function runCollabFinalSummaryTurn(input: {  workspaceId: string;
  threadId: string;
  text: string;
  target: AgentExecutionTarget;
  projection: AgentProjectionV1;
}): Promise<void> {
  const sections = (input.projection.stages ?? [])
    .map((stage) => {
      const body = pickLongestStageBody(
        stage.fullOutcome,
        stage.id === "plan"
          ? input.projection.plan?.markdown
          : "",
        stage.id === "plan" ? input.projection.plan?.summary : "",
        stage.shortOutcome,
      );
      if (!body) return "";
      // 给模型的摘录：每段上限，避免 prompt 爆炸；输出由模型完整成文
      const excerpt =
        body.length > 2500 ? `${body.slice(0, 2500)}\n…(节点原文已截断供概括)` : body;
      return `### ${stage.title || stage.id}\n${excerpt}`;
    })
    .filter(Boolean)
    .join("\n\n");
  // 汇总 turn：begin_turn 只写带标记的内部请求（幕布隐藏），避免「禁止工具」类长指令污染后续普通 Shared 对话
  await runSharedOrchestratorTurn({
    workspaceId: input.workspaceId,
    threadId: input.threadId,
    target: input.target,
    modelText: buildCollabSummarySendText({
      userText: input.text,
      stageSections: sections,
    }),
    accessMode: "read-only",
    label: "orchestrator final summary",
  });
}

/**
 * 汇总 turn 期间主幕保持「正在生成交付汇总」相位；
 * 结束后清掉相位，时间线折叠卡 + 汇总消息接管叙事。
 */
async function runCollabSummaryWithPhase(input: {
  workspaceId: string;
  threadId: string;
  text: string;
  target: AgentExecutionTarget;
  projection: AgentProjectionV1;
}): Promise<void> {
  patchCollabPhase(input.workspaceId, input.threadId, "summarizing");
  try {
    await runCollabFinalSummaryTurn(input);
  } finally {
    clearCollabUiState(input.workspaceId, input.threadId);
  }
}

export async function requestAgentPlan(input: {
  workspaceId: string;
  threadId: string;
  /** 注入后的 model text（可含 skill/记忆/便签块） */
  text: string;
  /** 主幕用户气泡可见原文；缺省回退 text */
  visibleText?: string;
  /** 首段附图 */
  images?: string[];
  target: AgentExecutionTarget;
  stageBindings?: AgentStageBinding[];
}): Promise<AgentProjectionV1> {
  resetAgentLivePhaseArchive(input.workspaceId, input.threadId);

  const images = (input.images ?? []).filter((path) => path.trim().length > 0);
  // 纯图：模型侧用占位任务文案；主幕气泡可只挂图
  const modelText =
    input.text.trim() ||
    (images.length > 0
      ? maT("multiAgent.collab.imageOnlyTask", {
          defaultValue: "（请根据附图回答）",
        })
      : "");
  const visible =
    (input.visibleText ?? input.text).trim() ||
    (images.length > 0 ? "" : modelText);
  // ① 立刻上屏干净用户气泡 + sticky 窗（无 Shared 历史污染）
  const flowLabel = collabFlowLabel(input.stageBindings);
  setCollabUiState({
    workspaceId: input.workspaceId,
    threadId: input.threadId,
    phase: "starting_stages",
    headline: maT("multiAgent.collab.starting"),
    detail: maT("multiAgent.collab.startingDetail", { flow: flowLabel }),
    requestText: visible || modelText,
    flowLabel,
  });
  // B：协作开始 → 左侧会话蓝点 / 代理电
  setCollabThreadProcessing(input.threadId, true);
  emitCollabVisibleUserMessage(
    input.workspaceId,
    input.threadId,
    visible,
    undefined,
    images,
  );
  emitCollabBootstrapStatus({
    workspaceId: input.workspaceId,
    threadId: input.threadId,
    text: visible || modelText,
    flowLabel,
  });

  // ② 启动节点引擎；阶段进度走 sticky/右栏，不刷「协作进展：xx 环节」气泡
  let requested: Awaited<ReturnType<typeof sharedAgentRequestRun>>;
  try {
    requested = await sharedAgentRequestRun(
      input.workspaceId,
      input.threadId,
      modelText,
      input.target,
      input.stageBindings,
      images.length > 0 ? images : null,
      visible || null,
    );
  } catch (error) {
    clearCollabUiState(input.workspaceId, input.threadId);
    setCollabThreadProcessing(input.threadId, false);
    throw error;
  }
  publishAgentProjection(
    input.workspaceId,
    input.threadId,
    requested.projection,
  );
  const firstStageId =
    requested.projection.stages?.[0]?.id ||
    requested.stageAttempt?.stageId ||
    "plan";
  openAgentInspector({
    workspaceId: input.workspaceId,
    threadId: input.threadId,
    runId: requested.projection.runId,
    stageId: firstStageId,
  });
  const planAttempt = asPrepared(
    requested.stageAttempt ?? requested.planAttempt,
  );
  if (!planAttempt) {
    clearCollabUiState(input.workspaceId, input.threadId);
    setCollabThreadProcessing(input.threadId, false);
    throw new Error("agent-plan-attempt-missing");
  }
  try {
    const settled = await driveAutoChain(
      input.workspaceId,
      input.threadId,
      requested.projection.runId,
      planAttempt,
    );
    // ③ 节点全部成功后：主幕模型生成交付汇总（相位保持到汇总落幕）
    if (settled.status === "succeeded") {
      await runCollabSummaryWithPhase({
        workspaceId: input.workspaceId,
        threadId: input.threadId,
        text: input.text,
        target: input.target,
        projection: settled,
      });
      // 汇总 turn 不改 projection；刷新一次最新态即可
      const latest = await sharedAgentGet(
        input.workspaceId,
        input.threadId,
      );
      if (latest) {
        publishAgentProjection(input.workspaceId, input.threadId, latest);
        applyCollabThreadProcessingFromProjection(input.threadId, latest);
        return latest;
      }
      applyCollabThreadProcessingFromProjection(input.threadId, settled);
      return settled;
    }
    clearCollabUiState(input.workspaceId, input.threadId);
    // awaiting-approval 等非终态保持蓝点；终态熄灭
    applyCollabThreadProcessingFromProjection(input.threadId, settled);
    return settled;
  } catch (error) {
    clearCollabUiState(input.workspaceId, input.threadId);
    try {
      const recovery = await sharedSessionV2RecoverAttempt(
        input.workspaceId,
        input.threadId,
        planAttempt.attemptId,
      );
      if (
        recovery.status === "terminal-committed" ||
        recovery.status === "not-accepted-committed" ||
        recovery.status === "active"
      ) {
        if (recovery.status === "active") {
          await withTimeout(
            sharedSessionV2AwaitTurnTerminal(
              input.workspaceId,
              input.threadId,
              planAttempt.attemptId,
            ),
            planAttempt.attemptId,
          );
        }
        const planned = await sharedAgentRecordExecute(
          input.workspaceId,
          input.threadId,
          requested.projection.runId,
          planAttempt.attemptId,
        );
        const { projection } = unwrapRecorded(planned);
        publishAgentProjection(
          input.workspaceId,
          input.threadId,
          projection,
        );
        applyCollabThreadProcessingFromProjection(
          input.threadId,
          projection,
        );
        return projection;
      }
    } catch {
      // fall through
    }
    return stopAgent(
      input.workspaceId,
      input.threadId,
      requested.projection.runId,
      `stage failed: ${errorMessage(error)}`,
    );
  }
}

export async function approveAndExecuteAgent(
  workspaceId: string,
  threadId: string,
  runId: string,
  revision: number,
  /** 可选：批准时用户补充，并入后续段 prompt */
  approvalNote?: string | null,
): Promise<AgentProjectionV1> {
  // B：审批通过后继续执行 → 重新点亮左侧运行态
  setCollabThreadProcessing(threadId, true);
  const note = approvalNote?.trim() || "";
  let approved: Awaited<ReturnType<typeof sharedAgentApprove>>;
  try {
    approved = await sharedAgentApprove(
      workspaceId,
      threadId,
      runId,
      revision,
      note || null,
    );
  } catch (error) {
    // Approve RPC 失败不得留下悬挂蓝点
    setCollabThreadProcessing(threadId, false);
    throw error;
  }
  // 主幕叙事：RPC 成功后再记气泡，避免失败时误报已批准
  if (note) {
    emitApproveConversationItems(workspaceId, threadId, runId, note);
  }
  publishAgentProjection(workspaceId, threadId, approved.projection);
  const implementAttempt = asPrepared(
    approved.stageAttempt ?? approved.executeAttempt,
  );
  if (!implementAttempt) {
    applyCollabThreadProcessingFromProjection(threadId, approved.projection);
    return approved.projection;
  }
  openAgentInspector({
    workspaceId,
    threadId,
    runId,
    stageId: implementAttempt.stageId,
  });
  clearAgentLivePhase(workspaceId, threadId);
  const runKey = key(workspaceId, threadId, runId);
  const existing = running.get(runKey);
  if (existing) return existing;
  const task = (async () => {
    try {
      const settled = await driveAutoChain(
        workspaceId,
        threadId,
        runId,
        implementAttempt,
      );
      if (settled.status === "succeeded") {
        await runCollabSummaryWithPhase({
          workspaceId,
          threadId,
          text: settled.requestText || "",
          target: settled.target ?? approved.projection.target,
          projection: settled,
        });
        const latest = await sharedAgentGet(workspaceId, threadId);
        if (latest) {
          publishAgentProjection(workspaceId, threadId, latest);
          applyCollabThreadProcessingFromProjection(threadId, latest);
          return latest;
        }
        applyCollabThreadProcessingFromProjection(threadId, settled);
        return settled;
      }
      clearCollabUiState(workspaceId, threadId);
      applyCollabThreadProcessingFromProjection(threadId, settled);
      return settled;
    } catch (error) {
      clearCollabUiState(workspaceId, threadId);
      pushErrorToast({
        title: maT("multiAgent.errors.executionInterrupted"),
        message: errorMessage(error),
        durationMs: 5_000,
      });
      return stopAgent(
        workspaceId,
        threadId,
        runId,
        `execute failed: ${errorMessage(error)}`,
      );
    } finally {
      running.delete(runKey);
    }
  })();
  running.set(runKey, task);
  return task;
}

/**
 * 打回重规划：先完整收口当前 run → 主幕线性事件 → 再开新 run。
 * replanNote 可选：用户追加提示词，并入原任务后重走编排。
 * 必须等 cancel settle，否则 ensure_no_active_run 会冲突。
 */
export async function rejectAndReplanAgent(input: {
  workspaceId: string;
  threadId: string;
  runId: string;
  requestText: string;
  /** 用户可选追加；空则按原 requestText 重规划 */
  replanNote?: string | null;
  target: AgentExecutionTarget;
  stageBindings?: AgentStageBinding[];
}): Promise<AgentProjectionV1> {
  const note = input.replanNote?.trim() ?? "";
  const base = input.requestText.trim();
  const nextText = note
    ? base
      ? `${base}\n\n【打回补充】\n${note}`
      : note
    : base;
  // 诊断码稳定英文；conversationBridge 仍兼容旧文案「打回重规划」
  const stopped = await stopAgent(
    input.workspaceId,
    input.threadId,
    input.runId,
    "reject-replan",
  );
  // 双保险：未 terminal 则不再强开新 run
  if (!isTerminalAgentStatus(stopped.status)) {
    throw new Error("agent-replan-blocked: previous run not settled");
  }
  emitReplanConversationItems(
    input.workspaceId,
    input.threadId,
    input.runId,
    nextText,
    note || undefined,
  );
  // 短暂让出：避免 cancel 与 request 同 tick 撞 active-run 锁
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, 50);
  });
  return requestAgentPlan({
    workspaceId: input.workspaceId,
    threadId: input.threadId,
    text: nextText,
    target: input.target,
    stageBindings: input.stageBindings,
  });
}

export async function stopAgent(
  workspaceId: string,
  threadId: string,
  runId: string,
  reason = "user stop",
): Promise<AgentProjectionV1> {
  // 无论后端成败，先清 UI 相位/直播，避免用户卡在「编排进行中」锁输入
  clearCollabUiState(workspaceId, threadId);
  clearAgentLivePhase(workspaceId, threadId);
  // B：停止立刻熄灭左侧运行态（不等 cancel RPC）
  setCollabThreadProcessing(threadId, false);
  try {
    const cancelling = await sharedAgentCancel(
      workspaceId,
      threadId,
      runId,
      reason,
    );
    publishAgentProjection(workspaceId, threadId, cancelling.projection);
    const attemptResults = await Promise.all(
      (cancelling.attemptIds ?? []).map(async (attemptId) => {
        try {
          await sharedSessionV2InterruptTurn(workspaceId, threadId, attemptId);
          return { attemptId, status: "interrupted" };
        } catch (interruptError) {
          try {
            await sharedSessionV2CancelAttempt(
              workspaceId,
              threadId,
              attemptId,
              "multi-agent stop",
            );
            return { attemptId, status: "cancelled-before-dispatch" };
          } catch (cancelError) {
            return {
              attemptId,
              status: "error",
              error: `${errorMessage(interruptError)}; ${errorMessage(cancelError)}`,
            };
          }
        }
      }),
    );
    const settled = await sharedAgentFinalizeCancel(
      workspaceId,
      threadId,
      runId,
      attemptResults,
    );
    publishAgentProjection(workspaceId, threadId, settled);
    return settled;
  } catch (error) {
    // 后端 cancel 失败时仍尽量标终端，解锁输入
    const latest = await sharedAgentGet(workspaceId, threadId).catch(() => null);
    if (latest) {
      publishAgentProjection(workspaceId, threadId, {
        ...latest,
        status: "cancelled",
        diagnostics: [
          ...(latest.diagnostics ?? []),
          `force-stop: ${errorMessage(error)}`,
        ],
      });
      return { ...latest, status: "cancelled" };
    }
    throw error;
  } finally {
    clearCollabUiState(workspaceId, threadId);
    clearAgentLivePhase(workspaceId, threadId);
  }
}

/**
 * 卡死恢复：停止当前 run + 清空相位，保证 composer 解锁。
 * 不要求后端全部成功。
 */
export async function forceStopAndUnlock(
  workspaceId: string,
  threadId: string,
  runId: string,
  reason = "force unlock (stuck stage)",
): Promise<void> {
  try {
    await stopAgent(workspaceId, threadId, runId, reason);
  } catch {
    // stopAgent 已尽力清 UI；吞掉错误，保证调用方 toast 友好
  } finally {
    clearCollabUiState(workspaceId, threadId);
    clearAgentLivePhase(workspaceId, threadId);
    setCollabThreadProcessing(threadId, false);
  }
}

/**
 * 整轮重试：强制停止后同任务/模板重新 requestAgentPlan。
 */
export async function retryCollabRun(input: {
  workspaceId: string;
  threadId: string;
  runId: string;
  requestText: string;
  target: AgentExecutionTarget;
  stageBindings?: AgentStageBinding[];
  stuckStageId?: string;
}): Promise<AgentProjectionV1> {
  bumpChainGeneration(input.workspaceId, input.threadId, input.runId);
  await forceStopAndUnlock(
    input.workspaceId,
    input.threadId,
    input.runId,
    input.stuckStageId
      ? `retry from stage ${input.stuckStageId}`
      : "retry collab run",
  );
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, 80);
  });
  const note = input.stuckStageId
    ? `\n\n【节点重试】上一轮在「${input.stuckStageId}」环节卡住/中断，请从该环节关注续作，已完成步骤可简要确认。`
    : "";
  return requestAgentPlan({
    workspaceId: input.workspaceId,
    threadId: input.threadId,
    text: `${input.requestText.trim()}${note}`,
    target: input.target,
    stageBindings: input.stageBindings,
  });
}

/**
 * 单节点重试：不 settle 整 run，只关掉当前卡死/失败 stage 的 attempt，
 * 再开同 stage 新 turn，并从该段继续串行后续节点。
 */
export async function retryAgentStage(input: {
  workspaceId: string;
  threadId: string;
  runId: string;
  stageId: string;
  oldAttemptId?: string | null;
}): Promise<AgentProjectionV1> {
  const gen = bumpChainGeneration(
    input.workspaceId,
    input.threadId,
    input.runId,
  );
  clearAgentLivePhase(input.workspaceId, input.threadId);
  // B：单节点重试继续跑 → 保持 / 点亮左侧运行态
  setCollabThreadProcessing(input.threadId, true);

  // 尽量打断卡死 turn，让旧 driveAutoChain 退出
  const oldAttempt = input.oldAttemptId?.trim();
  if (oldAttempt) {
    try {
      await sharedSessionV2InterruptTurn(
        input.workspaceId,
        input.threadId,
        oldAttempt,
      );
    } catch {
      try {
        await sharedSessionV2CancelAttempt(
          input.workspaceId,
          input.threadId,
          oldAttempt,
          "retry stage",
        );
      } catch {
        // ignore
      }
    }
  }

  let prepared: Awaited<ReturnType<typeof sharedAgentRetryStage>>;
  try {
    prepared = await sharedAgentRetryStage(
      input.workspaceId,
      input.threadId,
      input.runId,
      input.stageId,
    );
  } catch (error) {
    setCollabThreadProcessing(input.threadId, false);
    throw error;
  }
  publishAgentProjection(
    input.workspaceId,
    input.threadId,
    prepared.projection,
  );
  const stageAttempt = asPrepared(
    prepared.stageAttempt ?? null,
  );
  if (!stageAttempt) {
    // 无法续跑：熄灭，避免悬挂蓝点（不沿用可能仍非终态的旧 projection）
    setCollabThreadProcessing(input.threadId, false);
    throw new Error("agent-retry-stage: missing stageAttempt");
  }

  openAgentInspector({
    workspaceId: input.workspaceId,
    threadId: input.threadId,
    runId: input.runId,
    stageId: input.stageId,
  });

  const runKey = `${input.workspaceId}\u0000${input.threadId}\u0000${input.runId}`;
  const task = driveAutoChain(
    input.workspaceId,
    input.threadId,
    input.runId,
    stageAttempt,
    gen,
  )
    .then((projection) => {
      applyCollabThreadProcessingFromProjection(input.threadId, projection);
      return projection;
    })
    .catch((error) => {
      setCollabThreadProcessing(input.threadId, false);
      throw error;
    })
    .finally(() => {
      if (running.get(runKey) === task) running.delete(runKey);
    });
  running.set(runKey, task);
  return task;
}

export async function hydrateAgentProjection(
  workspaceId: string,
  threadId: string,
  _expectedRunId?: string,
): Promise<AgentProjectionV1 | null> {
  if (!isSharedSessionThreadId(threadId)) return null;

  // 刷新后重放所有历史轮次：先批量写 store（少 notify），再统一 emit 折叠卡
  const allRuns = await sharedAgentListAll(workspaceId, threadId);
  if (allRuns.length > 0) {
    for (let i = 0; i < allRuns.length; i += 1) {
      const run = allRuns[i]!;
      const isLast = i === allRuns.length - 1;
      publishAgentProjection(workspaceId, threadId, run, {
        skipCanvasEmit: true,
        skipNotify: !isLast,
      });
    }
    // 按时间序补折叠卡 / user 锚点（bridge 内部对重复 user/同 text fold 有短路）
    for (const run of allRuns) {
      emitMultiAgentConversationItems(workspaceId, threadId, run);
    }
    flushAgentProjectionNotify();
    const latest = allRuns[allRuns.length - 1]!;
    // 仅活跃 run 恢复蓝点；终态不 force false（避免盖掉普通 Shared turn）
    restoreCollabThreadProcessingIfActive(threadId, latest);
    return latest;
  }

  // 兜底：event log 无记录时尝试旧 single-get
  const projection = await sharedAgentGet(workspaceId, threadId);
  if (projection) {
    publishAgentProjection(workspaceId, threadId, projection);
    restoreCollabThreadProcessingIfActive(threadId, projection);
  }
  return projection;
}

export function isActiveAgentProjection(
  projection: AgentProjectionV1 | null | undefined,
): boolean {
  return Boolean(projection && !isTerminalAgentStatus(projection.status));
}
