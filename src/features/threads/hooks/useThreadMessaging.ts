import { useCallback, useEffect, useRef } from "react";
import type { WorkspaceScopedMap } from "./workspaceScopedMap";
import {
  workspaceScopedDelete,
  workspaceScopedHas,
  workspaceScopedSet,
} from "./workspaceScopedMap";
import type { Dispatch, MutableRefObject } from "react";
import { useTranslation } from "react-i18next";
import type {
  AccessMode,
  ConversationItem,
  MemoryContextInjectionMode,
  RateLimitSnapshot,
  ThreadTokenUsage,
  CustomPromptOption,
  DebugEntry,
  ReviewTarget,
  WorkspaceInfo,
  BrowserContextSendAttachment,
  ComposerCreateSessionTarget,
  EngineType,
  IntentCanvasContextSendAttachment,
  SelectedAgentOption,
  SharedQueuedExecutionTarget,
  SkillInvocation,
} from "../../../types";
import type { AutoSessionMetadata } from "../../../services/tauri";
import {
  extractClaudeForkParentSessionId,
  isClaudeForkThreadId,
} from "../utils/claudeForkThread";
import { emitMessagesForcePinBottom } from "../../../live-canvas/liveCanvasControls";
import {
  sendUserMessage as sendUserMessageService,
  startReview as startReviewService,
  interruptTurn as interruptTurnService,
  engineInterruptTurn as engineInterruptTurnService,
  engineSendMessage as engineSendMessageService,
  engineInterrupt as engineInterruptService,
  listGeminiSessions as listGeminiSessionsService,
  listGrokSessions as listGrokSessionsService,
  listKimiSessions as listKimiSessionsService,
} from "../../../services/tauri";
import { sendSharedSessionTurnRouted } from "../../shared-session/runtime/sendSharedSessionTurn";
import {
  SharedActiveAttemptObserverError,
  type SendSharedSessionTurnV2Result,
} from "../../shared-session/runtime/sendSharedSessionTurnV2";
import { subscribeSharedSessionAttemptSettlements } from "../../shared-session/runtime/reattachSharedSessionAttempt";
import { isSharedV2SendEnabled } from "../../shared-session/runtime/sharedV2SendFlag";
import { sharedSessionV2InterruptTurn as sharedSessionV2InterruptTurnService } from "../../shared-session/services/sharedSessions";
import {
  dispatchSharedSendEvent,
  getSharedSendActiveAttemptId,
  getSharedSendState,
  releaseSharedSendAdmission,
  setSharedSendActiveAttempt,
  tryAcquireSharedSend,
} from "../../shared-session/runtime/sharedSendStateStore";
import {
  getSharedTargetState,
  selectNextTarget,
} from "../../shared-session/target/targetStore";
import {
  freezeTurnSnapshot,
  isResolvedExecutionTarget,
} from "../../shared-session/target/types";
import { requestAgentPlan } from "../../multi-agent/runtime/executor";
import { injectCollabSkillContext } from "../../multi-agent/runtime/skillContextInjection";
import { injectMainCanvasContext } from "../../multi-agent/runtime/mainCanvasContextInjection";
import { getSelectedTemplate } from "../../multi-agent/templates/templateStore";
import { templateToStageBindings } from "../../multi-agent/templates/types";
import { subscribeMultiAgentConversationItems } from "../../multi-agent/runtime/conversationBridge";
import { readExternalAbsoluteFile } from "../../../services/tauri/workspaceFiles";
import { reconcileAtomicReasoningEffort } from "../../models/atomicModelReasoning";
import { projectMemoryFacade } from "../../project-memory/services/projectMemoryFacade";
import {
  injectSelectedMemoriesContext,
  type InjectionResult,
} from "../../project-memory/utils/memoryContextInjection";
import {
  injectMemoryScoutBriefContext,
  scoutProjectMemory,
  type MemoryBrief,
} from "../../project-memory/utils/memoryScout";
import { noteCardsFacade } from "../../note-cards/services/noteCardsFacade";
import {
  injectSelectedNoteCardsContext,
  NOTE_CARD_CONTEXT_SUMMARY_PREFIX,
  type NoteCardInjectionResult,
} from "../../note-cards/utils/noteCardContextInjection";
import { MEMORY_CONTEXT_SUMMARY_PREFIX } from "../../project-memory/utils/memoryMarkers";
import { expandCustomPromptText } from "../../../utils/customPrompts";
import {
  asString,
  extractRpcErrorMessage,
  parseReviewTarget,
} from "../utils/threadNormalize";
import type { ThreadAction, ThreadState } from "./useThreadsReducer";
import { useReviewPrompt } from "./useReviewPrompt";
import { pushErrorToast } from "../../../services/toasts";
import { pushThreadFailureRuntimeNotice } from "../../../services/globalRuntimeNotices";
import { resolveAgentIconForAgent } from "../../../utils/agentIcons";
import {
  isSharedSessionSupportedEngine,
  normalizeSharedSessionEngine,
} from "../../shared-session/utils/sharedSessionEngines";
import {
  engineSupportsImageInput,
  formatEngineImageInputUnsupportedMessage,
  sanitizeImageAttachmentPaths,
} from "../../engine/utils/engineImageInput";
import {
  clearPendingClaudeMcpOutputNotice,
  getClaudeMcpRuntimeSnapshot,
  setPendingClaudeMcpOutputNotice,
  rewriteClaudePlaywrightAlias,
} from "../utils/claudeMcpRuntimeSnapshot";
import {
  buildCodexTextWithSpecRootPriority,
  probeSessionSpecLinkWithTimeout,
  resolveWorkspaceSpecRoot,
  shouldProbeSessionSpecForEngine,
  type SessionSpecLinkContext,
} from "./threadMessagingSpecRoot";
import {
  buildReviewCommandText,
  extractSessionIdFromEngineSendResponse,
  isCodexMissingThreadBindingError,
  isInvalidReviewThreadIdError,
  isLikelyForeignModelForGemini,
  isRecoverableCodexThreadBindingError,
  isUnknownEngineInterruptTurnMethodError,
  mapNetworkErrorToUserMessage,
  normalizeAccessMode,
  pickLikelyGeminiSessionId,
  pickLikelyGrokSessionId,
  pickLikelyKimiSessionId,
  primeThreadStreamLatencyForSend,
  resolveCollaborationModeIdFromPayload,
  resolveRecoverableCodexFirstPacketTimeout,
} from "./threadMessagingHelpers";
import {
  classifyStaleThreadRecovery,
  resolveThreadStabilityDiagnostic,
} from "../utils/stabilityDiagnostics";
import { useThreadMessagingSessionTooling } from "./useThreadMessagingSessionTooling";
import { useThreadMessagingThreadResolution } from "./useThreadMessagingThreadResolution";
import {
  createOptimisticGeneratedImageProcessingItem,
  extractOptimisticGeneratedImagePrompt,
} from "../utils/generatedImagePlaceholder";
import {
  resolveCodexAcceptedTurnFact,
  shouldDeferCodexActivityUntilTurnAccepted,
} from "../utils/codexConversationLiveness";
import { drainLiveAssistantTextTail } from "@/conversation-presentation/liveAssistantTextChannel";
import { formatBrowserContextPromptOnce } from "../../browser-agent";
import {
  buildLocalizedMemoryScoutPreviewText,
  extractClaudeCandidateSessionId,
  normalizeEngineScopedEffort,
  withMemoryScoutTimeout,
} from "./messageRuntimeController";
import { useCodexMessageRecovery } from "./useCodexMessageRecovery";
import { assertEngineExecutionEnabled } from "../../../utils/engineExecutionPolicy";
import { resolveSelectedAgentForSend } from "../utils/resolveSelectedAgentForSend";
import { BUILT_IN_AGENT_RESOLUTION_FAILED_EVENT } from "../../agent-catalog/events";

type SendMessageOptions = {
  skillInvocations?: SkillInvocation[];
  skipPromptExpansion?: boolean;
  skipOptimisticUserBubble?: boolean;
  suppressUserMessageRender?: boolean;
  model?: string | null;
  effort?: string | null;
  collaborationMode?: Record<string, unknown> | null;
  accessMode?: AccessMode;
  resumeSource?: "queue-fusion-cutover" | null;
  resumeTurnId?: string | null;
  selectedMemoryIds?: string[];
  selectedMemoryInjectionMode?: MemoryContextInjectionMode;
  memoryReferenceEnabled?: boolean;
  selectedNoteCardIds?: string[];
  selectedAgent?: SelectedAgentOption | null;
  browserContextAttachment?: BrowserContextSendAttachment | null;
  intentCanvasContextAttachments?: IntentCanvasContextSendAttachment[];
  codexInvalidThreadRetryAttempted?: boolean;
  autoSession?: AutoSessionMetadata | null;
  createSessionTarget?: ComposerCreateSessionTarget;
  sharedExecutionTarget?: SharedQueuedExecutionTarget;
  /** Queue  drain 专用：enqueue 瞬间冻结的引擎，优先于 activeEngine 路由。 */
  engineOverride?: EngineType;
  squadRequest?: true;
};

export type ThreadMessageDispatchResult =
  | SendSharedSessionTurnV2Result
  | {
      status: "ambiguous-error";
      reason: string;
    }
  | undefined;

type SendMessageToThreadFn = (
  workspace: WorkspaceInfo,
  threadId: string,
  text: string,
  images?: string[],
  options?: SendMessageOptions,
) => Promise<ThreadMessageDispatchResult>;

type InterruptTurnOptions = {
  reason?: "user-stop" | "queue-fusion" | "plan-handoff";
};

type HandleFusionStalledOptions = {
  message?: string | null;
};

type RunWithCreateSessionLoading = <T>(
  params: {
    workspace: WorkspaceInfo;
    engine: "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode";
  },
  action: () => Promise<T>,
) => Promise<T>;

const AGENT_PROMPT_HEADER = "## Agent Role and Instructions";
const AGENT_PROMPT_NAME_PREFIX = "Agent Name:";
const AGENT_PROMPT_ICON_PREFIX = "Agent Icon:";

const isThreadMessagingTestMode = (() => {
  try {
    return import.meta.env.MODE === "test";
  } catch {
    return false;
  }
})();
const shouldEmitThreadMessagingDevLogs = (() => {
  try {
    return import.meta.env.DEV && !isThreadMessagingTestMode;
  } catch {
    return false;
  }
})();
type UseThreadMessagingOptions = {
  activeWorkspace: WorkspaceInfo | null;
  activeThreadId: string | null;
  accessMode?: "default" | "read-only" | "current" | "full-access";
  model?: string | null;
  effort?: string | null;
  collaborationMode?: Record<string, unknown> | null;
  resolveComposerSelection?: () => {
    id?: string | null;
    model: string | null;
    source?: string | null;
    providerProfileId?: string | null;
    effort: string | null;
    collaborationMode: Record<string, unknown> | null;
  };
  claudeThinkingVisible?: boolean;
  steerEnabled: boolean;
  customPrompts: CustomPromptOption[];
  activeEngine?: "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode";
  threadStatusById: ThreadState["threadStatusById"];
  itemsByThread: ThreadState["itemsByThread"];
  activeTurnIdByThread: ThreadState["activeTurnIdByThread"];
  codexAcceptedTurnByThread: ThreadState["codexAcceptedTurnByThread"];
  tokenUsageByThread: Record<string, ThreadTokenUsage>;
  rateLimitsByWorkspace: Record<string, RateLimitSnapshot | null>;
  codexCompactionInFlightByThreadRef?: MutableRefObject<
    Record<string, boolean>
  >;
  pendingInterruptsRef: MutableRefObject<WorkspaceScopedMap<true>>;
  interruptedThreadsRef: MutableRefObject<WorkspaceScopedMap<true>>;
  dispatch: Dispatch<ThreadAction>;
  getCustomName: (workspaceId: string, threadId: string) => string | undefined;
  getThreadEngine: (
    workspaceId: string,
    threadId: string,
  ) => "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode" | undefined;
  getThreadKind?: (
    workspaceId: string,
    threadId: string,
  ) => "native" | "shared";
  getThreadProviderProfileId?: (
    workspaceId: string,
    threadId: string,
  ) => string | null | undefined;
  markProcessing: (threadId: string, isProcessing: boolean) => void;
  markReviewing: (threadId: string, isReviewing: boolean) => void;
  setActiveTurnId: (threadId: string, turnId: string | null) => void;
  recordThreadActivity: (
    workspaceId: string,
    threadId: string,
    timestamp?: number,
  ) => void;
  safeMessageActivity: () => void;
  onDebug?: (entry: DebugEntry) => void;
  pushThreadErrorMessage: (
    workspaceId: string,
    threadId: string,
    message: string,
  ) => void;
  ensureThreadForActiveWorkspace: () => Promise<string | null>;
  ensureThreadForWorkspace: (workspaceId: string) => Promise<string | null>;
  refreshThread: (
    workspaceId: string,
    threadId: string,
  ) => Promise<string | null>;
  forkThreadForWorkspace: (
    workspaceId: string,
    threadId: string,
    options?: { activate?: boolean; providerProfileId?: string | null },
  ) => Promise<string | null>;
  updateThreadParent: (parentId: string, childIds: string[]) => void;
  startThreadForWorkspace: (
    workspaceId: string,
    options?: {
      activate?: boolean;
      engine?: "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode";
      folderId?: string | null;
      autoSession?: AutoSessionMetadata | null;
      providerProfileId?: string | null;
    },
  ) => Promise<string | null>;
  finalizeCodexPendingThread?: (
    workspaceId: string,
    pendingThreadId: string,
  ) => Promise<string | null>;
  resolveOpenCodeAgent?: (threadId: string | null) => string | null;
  resolveOpenCodeVariant?: (threadId: string | null) => string | null;
  onInputMemoryCaptured?: (payload: {
    workspaceId: string;
    threadId: string;
    turnId: string;
    inputText: string;
    memoryId: string | null;
    workspaceName: string | null;
    workspacePath: string | null;
    engine: string | null;
  }) => void;
  resolveCollaborationRuntimeMode?: (
    threadId: string,
  ) => "plan" | "code" | null;
  runWithCreateSessionLoading?: RunWithCreateSessionLoading;
  onSharedDurableTurnCommitted?: (
    threadId: string,
    runtimeTurnId: string,
  ) => void;
};

export function useThreadMessaging({
  activeWorkspace,
  activeThreadId,
  accessMode,
  model,
  effort,
  collaborationMode,
  resolveComposerSelection,
  claudeThinkingVisible,
  steerEnabled,
  customPrompts,
  activeEngine = "claude",
  threadStatusById,
  itemsByThread,
  activeTurnIdByThread,
  codexAcceptedTurnByThread,
  tokenUsageByThread,
  rateLimitsByWorkspace,
  codexCompactionInFlightByThreadRef,
  pendingInterruptsRef,
  interruptedThreadsRef,
  dispatch,
  getCustomName,
  getThreadEngine,
  getThreadKind,
  getThreadProviderProfileId,
  markProcessing,
  markReviewing,
  setActiveTurnId,
  recordThreadActivity,
  safeMessageActivity,
  onDebug,
  pushThreadErrorMessage,
  ensureThreadForActiveWorkspace,
  ensureThreadForWorkspace,
  refreshThread,
  forkThreadForWorkspace,
  startThreadForWorkspace,
  finalizeCodexPendingThread,
  resolveOpenCodeAgent,
  resolveOpenCodeVariant,
  onInputMemoryCaptured,
  resolveCollaborationRuntimeMode,
  runWithCreateSessionLoading,
  onSharedDurableTurnCommitted,
}: UseThreadMessagingOptions) {
  const { t, i18n } = useTranslation();
  const internalCodexCompactionInFlightByThreadRef = useRef<
    Record<string, boolean>
  >({});
  const effectiveCodexCompactionInFlightByThreadRef =
    codexCompactionInFlightByThreadRef ??
    internalCodexCompactionInFlightByThreadRef;
  const lastOpenCodeModelByThreadRef = useRef<Map<string, string>>(new Map());
  const sessionSpecLinkByThreadRef = useRef<
    Map<string, SessionSpecLinkContext>
  >(new Map());
  const sendMessageToThreadRef = useRef<SendMessageToThreadFn | null>(null);
  const { createRecoveryAttempt } = useCodexMessageRecovery();
  const {
    claudeCandidateSessionIdByPendingThreadRef,
    claudePendingThreadAwaitingNativeSessionRef,
    geminiSessionIdByPendingThreadRef,
    grokSessionIdByPendingThreadRef,
    kimiSessionIdByPendingThreadRef,
    isClaudePendingThreadAwaitingNativeSession,
    isThreadIdCompatibleWithEngine,
    normalizeEngineSelection,
    reconcileClaudePendingThreadFromCandidate,
    resolveThreadEngine,
    resolveThreadKind,
    startThreadForMessageSend,
  } = useThreadMessagingThreadResolution({
    activeEngine,
    dispatch,
    getThreadEngine,
    getThreadKind,
    onDebug,
    runWithCreateSessionLoading,
    startThreadForWorkspace,
  });

  useEffect(
    () =>
      subscribeSharedSessionAttemptSettlements(
        ({ workspaceId, threadId, attemptId, runtimeTurnId }) => {
          // Reattachment 绕过原 send Promise；必须复用正常 V2 terminal 的
          // barrier → processing cleanup 顺序，避免迟到 realtime event 复燃 Stop。
          onSharedDurableTurnCommitted?.(threadId, runtimeTurnId);
          if (
            getSharedSendActiveAttemptId(workspaceId, threadId) !== attemptId
          ) {
            return;
          }
          markProcessing(threadId, false);
          setActiveTurnId(threadId, null);
          safeMessageActivity();
        },
      ),
    [
      markProcessing,
      onSharedDurableTurnCommitted,
      safeMessageActivity,
      setActiveTurnId,
    ],
  );

  useEffect(
    () =>
      subscribeMultiAgentConversationItems(({ workspaceId, threadId, item }) => {
        dispatch({
          type: "upsertItem",
          workspaceId,
          threadId,
          item,
          hasCustomName: Boolean(getCustomName(workspaceId, threadId)),
        });
        safeMessageActivity();
      }),
    [dispatch, getCustomName, safeMessageActivity],
  );

  const sendMessageToThread = useCallback(
    async (
      workspace: WorkspaceInfo,
      threadId: string,
      text: string,
      images: string[] = [],
      options?: SendMessageOptions,
    ): Promise<ThreadMessageDispatchResult> => {
      const messageText = text.trim();
      if (!messageText && images.length === 0) {
        return;
      }
      const threadKind = resolveThreadKind(workspace.id, threadId);
      const resolvedThreadEngine = resolveThreadEngine(workspace.id, threadId);
      if (threadKind !== "shared") {
        assertEngineExecutionEnabled(resolvedThreadEngine);
      }
      if (threadId.startsWith("claude-pending-")) {
        const reconciledThreadId =
          await reconcileClaudePendingThreadFromCandidate(workspace, threadId);
        const retrySend = sendMessageToThreadRef.current;
        if (reconciledThreadId && retrySend) {
          return retrySend(
            workspace,
            reconciledThreadId,
            text,
            images,
            options,
          );
        }
      }
      if (threadId.startsWith("codex-pending-")) {
        // Optimistic codex thread: swap in the real backend thread id before
        // the first message leaves. The backend start was prewarmed at
        // creation, so this usually resolves instantly.
        const finalizedThreadId = finalizeCodexPendingThread
          ? await finalizeCodexPendingThread(workspace.id, threadId)
          : null;
        const retrySend = sendMessageToThreadRef.current;
        if (finalizedThreadId && retrySend) {
          // finalize never returns the pending id itself (it resolves to the
          // real backend id or null), so always re-enter with the resolved id
          // instead of falling through and sending the pending id upstream.
          return retrySend(workspace, finalizedThreadId, text, images, options);
        } else {
          // finalize returns null both when the backend start failed and when
          // the pending thread was deleted mid-flight; only surface the
          // failure (and keep the typed text recoverable) if it still exists.
          if (getThreadEngine(workspace.id, threadId)) {
            dispatch({
              type: "upsertItem",
              workspaceId: workspace.id,
              threadId,
              item: {
                id: `optimistic-user-${Date.now()}-${Math.random()
                  .toString(36)
                  .slice(2, 8)}`,
                kind: "message",
                role: "user",
                text: messageText,
                images: images.length > 0 ? images : undefined,
              },
              hasCustomName: Boolean(getCustomName(workspace.id, threadId)),
            });
            pushThreadErrorMessage(
              workspace.id,
              threadId,
              t("errors.failedToCreateSession"),
            );
            safeMessageActivity();
          }
          return;
        }
      }
      const sharedV2SendEnabled =
        threadKind === "shared" && isSharedV2SendEnabled();
      const storedSharedTarget =
        threadKind === "shared"
          ? (options?.sharedExecutionTarget ??
            getSharedTargetState(workspace.id, threadId).selectedNextTarget)
          : null;
      const supportedStoredSharedTarget =
        storedSharedTarget &&
        isSharedSessionSupportedEngine(storedSharedTarget.engine)
          ? storedSharedTarget
          : null;
      const sharedSendState = sharedV2SendEnabled
        ? getSharedSendState(workspace.id, threadId)
        : null;
      if (sharedSendState && sharedSendState.state !== "idle") {
        onDebug?.({
          id: `${Date.now()}-client-shared-turn-submit-blocked`,
          timestamp: Date.now(),
          source: "client",
          label: "shared-session/turn blocked",
          payload: {
            workspaceId: workspace.id,
            threadId,
            state: sharedSendState.state,
          },
        });
        if (options?.squadRequest) {
          throw new Error(
            `agent-request-busy: Shared Session state=${sharedSendState.state}`,
          );
        }
        return {
          status: "blocked",
          state: sharedSendState.state,
          reason: "shared-send-not-idle",
        };
      }
      if (storedSharedTarget && !supportedStoredSharedTarget) {
        if (options?.squadRequest) {
          throw new Error(
            "agent-request-target-unavailable: stored Shared Session target is unsupported",
          );
        }
        pushThreadErrorMessage(
          workspace.id,
          threadId,
          "当前 Shared Session 目标暂不可执行，请重新选择可用的 CLI 和 Provider。",
        );
        safeMessageActivity();
        return {
          status: "target-unavailable",
          reason: "shared-target-unsupported",
        };
      }
      if (
        sharedV2SendEnabled &&
        !isResolvedExecutionTarget(supportedStoredSharedTarget)
      ) {
        if (options?.squadRequest) {
          throw new Error(
            "agent-request-target-incomplete: Shared Session target is incomplete",
          );
        }
        pushThreadErrorMessage(
          workspace.id,
          threadId,
          "当前 Shared Session 目标不完整，请重新选择 CLI、Provider 和 Model。",
        );
        safeMessageActivity();
        return {
          status: "target-unavailable",
          reason: "shared-target-incomplete",
        };
      }
      if (options?.squadRequest) {
        // Shared 内已走协作发送：不再二次判断 feature flag；
        // 仍强制 shared + V2 + 完整 target，避免 native / 半开 target 越界。
        // Context Fan-in（§8.6）：图/skill/记忆/便签对齐注入首段，不再整类拒绝。
        if (
          threadKind !== "shared" ||
          !sharedV2SendEnabled ||
          !isResolvedExecutionTarget(supportedStoredSharedTarget)
        ) {
          throw new Error(
            "agent-request-unavailable: Multi-Agent requires Shared Session V2 and a complete target",
          );
        }
        const snapshot = freezeTurnSnapshot(supportedStoredSharedTarget);
        const collabTarget = {
          engine: snapshot.engine,
          providerProfileId: snapshot.providerProfileId,
          modelCatalogEntryId: snapshot.modelCatalogEntryId,
          model: snapshot.model,
          reasoningEffort: snapshot.reasoning?.effort ?? null,
          providerProfileNameSnapshot: snapshot.providerProfileNameSnapshot,
          providerProfileSource: snapshot.providerProfileSource,
          runtimeCapabilityFingerprint: snapshot.runtimeCapabilityFingerprint,
        };
        // 可见原文（主幕气泡）；model text 在此基础上叠 skill/记忆/便签/主幕历史
        // 纯图：可见可空，model 侧在 executor 内补占位
        // Context Fan-in 口径：
        // - 主幕已有对话：digest 置顶注入 modelText（不进 visibleText / 主幕卡标题）
        // - 记忆/便签：正文注入进 modelText（与图不同，不走独立 image_refs 通道）
        // - skill：协作 prompt 包层后 slash 常失效 → 读 SKILL.md 正文注入首段
        // - 图 / 便签附图：firstStageImages + dispatch durable 回填
        const visibleUserText = messageText.trim();
        let modelText = messageText.trim() || messageText;
        const skillRefs = (options?.skillInvocations ?? [])
          .map((entry) => ({
            name: entry.name?.trim() ?? "",
            path: entry.path?.trim() || null,
          }))
          .filter((entry) => entry.name.length > 0);
        if (skillRefs.length > 0) {
          const skillInjection = await injectCollabSkillContext({
            workspaceId: workspace.id,
            userText: modelText,
            skills: skillRefs,
            readFile: readExternalAbsoluteFile,
          });
          modelText = skillInjection.finalText;
        }
        const selectedMemoryIds = Array.from(
          new Set(
            (options?.selectedMemoryIds ?? [])
              .map((entry) => entry.trim())
              .filter((entry) => entry.length > 0),
          ),
        );
        if (selectedMemoryIds.length > 0) {
          const retrievalStart = Date.now();
          const selectedMemoryInjectionMode =
            options?.selectedMemoryInjectionMode === "summary"
              ? "summary"
              : "detail";
          const selectedMemories = (
            await Promise.all(
              selectedMemoryIds.map((memoryId) =>
                projectMemoryFacade
                  .get(memoryId, workspace.id)
                  .catch(() => null),
              ),
            )
          ).filter(
            (entry): entry is NonNullable<typeof entry> => entry !== null,
          );
          modelText = injectSelectedMemoriesContext({
            userText: modelText,
            memories: selectedMemories,
            mode: selectedMemoryInjectionMode,
            retrievalMs: Date.now() - retrievalStart,
          }).finalText;
        }
        if (options?.memoryReferenceEnabled === true) {
          const memoryBrief = await withMemoryScoutTimeout(
            scoutProjectMemory({
              workspaceId: workspace.id,
              query: visibleUserText,
              listFn: projectMemoryFacade.listSummary,
            }),
          );
          modelText = injectMemoryScoutBriefContext({
            userText: modelText,
            brief: memoryBrief,
            startIndex: 1,
          }).finalText;
        }
        let finalImages = [...images];
        const selectedNoteCardIds = Array.from(
          new Set(
            (options?.selectedNoteCardIds ?? [])
              .map((entry) => entry.trim())
              .filter((entry) => entry.length > 0),
          ),
        );
        if (selectedNoteCardIds.length > 0) {
          const selectedNotes = (
            await Promise.all(
              selectedNoteCardIds.map((noteId) =>
                noteCardsFacade
                  .get({
                    noteId,
                    workspaceId: workspace.id,
                    workspaceName: workspace.name,
                    workspacePath: workspace.path,
                  })
                  .catch(() => null),
              ),
            )
          ).filter(
            (entry): entry is NonNullable<typeof entry> => entry !== null,
          );
          const noteInjection = injectSelectedNoteCardsContext({
            userText: modelText,
            noteCards: selectedNotes,
          });
          modelText = noteInjection.finalText;
          finalImages = Array.from(
            new Set([...finalImages, ...noteInjection.imagePaths]),
          );
        }
        // 主幕历史 digest 置顶（在 skill/记忆/便签之后 prepend，保证块在最终 modelText 头部）
        // 不污染 visibleUserText / 主幕气泡；空历史 no-op
        modelText = injectMainCanvasContext({
          userText: modelText,
          items: itemsByThread[threadId] ?? [],
        }).finalText;
        finalImages = sanitizeImageAttachmentPaths(finalImages);
        if (
          finalImages.length > 0 &&
          !engineSupportsImageInput(collabTarget.engine)
        ) {
          throw new Error(
            `agent-request-images-unsupported: engine ${collabTarget.engine} does not support image input`,
          );
        }
        // 按当前选中模板生成每段独立 stageBindings（CLI·模型·思考强度）。
        const stageBindings = templateToStageBindings(
          getSelectedTemplate(),
          collabTarget,
        );
        // A：入口只负责点亮 + 异常熄灭；终态/审批/停止由 executor（B）权威收口，
        // 避免 A 晚到的 false 盖掉「停→立刻再开」的新 run。
        // 纯图/首发：await requestAgentPlan 前先上屏用户气泡，避免 emptyThread 闪屏。
        if (
          !options?.suppressUserMessageRender &&
          (visibleUserText.length > 0 || finalImages.length > 0)
        ) {
          dispatch({
            type: "upsertItem",
            workspaceId: workspace.id,
            threadId,
            item: {
              id: `optimistic-user-${Date.now()}-${Math.random()
                .toString(36)
                .slice(2, 8)}`,
              kind: "message",
              role: "user",
              text: visibleUserText,
              images: finalImages.length > 0 ? finalImages : undefined,
            },
            hasCustomName: Boolean(getCustomName(workspace.id, threadId)),
          });
          emitMessagesForcePinBottom();
        }
        markProcessing(threadId, true);
        safeMessageActivity();
        try {
          await requestAgentPlan({
            workspaceId: workspace.id,
            threadId,
            text: modelText,
            visibleText: visibleUserText,
            images: finalImages,
            target: collabTarget,
            stageBindings,
          });
        } catch (error) {
          markProcessing(threadId, false);
          throw error;
        }
        return;
      }
      const resolvedEngine =
        threadKind === "shared"
          ? normalizeSharedSessionEngine(
              supportedStoredSharedTarget?.engine ?? activeEngine,
            )
          : resolvedThreadEngine;
      dispatch({
        type: "ensureThread",
        workspaceId: workspace.id,
        threadId,
        engine: resolvedEngine,
      });
      dispatch({
        type: "setThreadEngine",
        workspaceId: workspace.id,
        threadId,
        engine: resolvedEngine,
      });
      // 首页首发 / 纯图：在任何 await 之前立刻上屏用户气泡，否则 pending→session
      // rebind 期间幕布会长时间保持 emptyThread（「今天想构建什么」），用户以为没发出去。
      // 气泡用可见原文 + 附图；injection 只影响 model text，不改用户气泡正文。
      const earlyImages = sanitizeImageAttachmentPaths(images);
      let optimisticUserItem: Extract<
        ConversationItem,
        { kind: "message" }
      > | null = null;
      let optimisticGeneratedImageItem: Extract<
        ConversationItem,
        { kind: "generatedImage" }
      > | null = null;
      if (
        !options?.suppressUserMessageRender &&
        !options?.skipOptimisticUserBubble &&
        (messageText.length > 0 ||
          earlyImages.length > 0 ||
          Boolean(options?.browserContextAttachment) ||
          Boolean(options?.intentCanvasContextAttachments?.length))
      ) {
        optimisticUserItem = {
          id: `optimistic-user-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 8)}`,
          kind: "message",
          role: "user",
          // 可见原文（纯图为空串）；禁止写 CLI 占位 "Please analyze…"
          text: messageText,
          images: earlyImages.length > 0 ? earlyImages : undefined,
          browserContextAttachment: options?.browserContextAttachment ?? null,
          intentCanvasContextAttachments:
            options?.intentCanvasContextAttachments,
        };
        dispatch({
          type: "upsertItem",
          workspaceId: workspace.id,
          threadId,
          item: optimisticUserItem,
          hasCustomName: Boolean(getCustomName(workspace.id, threadId)),
        });
        // 同步亮起 processing，避免 emptyThread + 无「响应中」的空白闪屏
        markProcessing(threadId, true);
        safeMessageActivity();
        emitMessagesForcePinBottom();
      }
      let finalText = messageText;
      if (!options?.skipPromptExpansion) {
        const promptExpansion = expandCustomPromptText(
          messageText,
          customPrompts,
        );
        if (promptExpansion && "error" in promptExpansion) {
          pushThreadErrorMessage(workspace.id, threadId, promptExpansion.error);
          safeMessageActivity();
          return;
        }
        finalText = promptExpansion?.expanded ?? messageText;
      }
      const visibleUserText = finalText;
      const selectedMemoryIds = Array.from(
        new Set(
          (options?.selectedMemoryIds ?? [])
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0),
        ),
      );
      const memoryReferenceEnabled = options?.memoryReferenceEnabled === true;
      const selectedNoteCardIds = Array.from(
        new Set(
          (options?.selectedNoteCardIds ?? [])
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0),
        ),
      );
      let injectionResult: InjectionResult = {
        finalText,
        injectedCount: 0,
        injectedChars: 0,
        retrievalMs: 0,
        previewText: null,
        disabledReason: null,
      };
      let noteInjectionResult: NoteCardInjectionResult = {
        finalText,
        injectedCount: 0,
        injectedChars: 0,
        imagePaths: [],
        previewText: null,
      };
      if (selectedMemoryIds.length > 0) {
        const retrievalStart = Date.now();
        const selectedMemoryInjectionMode =
          options?.selectedMemoryInjectionMode === "summary"
            ? "summary"
            : "detail";
        const selectedMemories = (
          await Promise.all(
            selectedMemoryIds.map((memoryId) =>
              projectMemoryFacade.get(memoryId, workspace.id).catch(() => null),
            ),
          )
        ).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
        injectionResult = injectSelectedMemoriesContext({
          userText: finalText,
          memories: selectedMemories,
          mode: selectedMemoryInjectionMode,
          retrievalMs: Date.now() - retrievalStart,
        });
      }
      finalText = injectionResult.finalText;
      let memoryScoutInjectionResult: InjectionResult = {
        finalText,
        injectedCount: 0,
        injectedChars: 0,
        retrievalMs: 0,
        previewText: null,
        disabledReason: null,
      };
      let memoryScoutBrief: MemoryBrief | null = null;
      const memoryScoutSummaryItemId = `memory-scout-context-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      if (memoryReferenceEnabled) {
        dispatch({
          type: "upsertItem",
          workspaceId: workspace.id,
          threadId,
          item: {
            id: memoryScoutSummaryItemId,
            kind: "message",
            role: "assistant",
            text: `${MEMORY_CONTEXT_SUMMARY_PREFIX}\n${t("threads.memoryReferenceQuerying")}`,
          },
          hasCustomName: Boolean(getCustomName(workspace.id, threadId)),
        });
        const memoryBrief = await withMemoryScoutTimeout(
          scoutProjectMemory({
            workspaceId: workspace.id,
            query: visibleUserText,
            listFn: projectMemoryFacade.listSummary,
          }),
        );
        memoryScoutBrief = memoryBrief;
        memoryScoutInjectionResult = injectMemoryScoutBriefContext({
          userText: finalText,
          brief: memoryBrief,
          startIndex: injectionResult.injectedCount + 1,
        });
        memoryScoutInjectionResult = {
          ...memoryScoutInjectionResult,
          previewText: buildLocalizedMemoryScoutPreviewText(memoryBrief, t),
        };
        finalText = memoryScoutInjectionResult.finalText;
      }
      let finalImages = [...images];
      if (selectedNoteCardIds.length > 0) {
        const selectedNotes = (
          await Promise.all(
            selectedNoteCardIds.map((noteId) =>
              noteCardsFacade
                .get({
                  noteId,
                  workspaceId: workspace.id,
                  workspaceName: workspace.name,
                  workspacePath: workspace.path,
                })
                .catch(() => null),
            ),
          )
        ).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
        noteInjectionResult = injectSelectedNoteCardsContext({
          userText: finalText,
          noteCards: selectedNotes,
        });
        finalText = noteInjectionResult.finalText;
        finalImages = Array.from(
          new Set([...finalImages, ...noteInjectionResult.imagePaths]),
        );
      }
      finalImages = sanitizeImageAttachmentPaths(finalImages);
      // Capability gate: matrix `image.input`. Current engines are all supported;
      // keep the guard for future unsupported engines (fail before optimistic UI).
      if (finalImages.length > 0 && !engineSupportsImageInput(resolvedEngine)) {
        pushThreadErrorMessage(
          workspace.id,
          threadId,
          formatEngineImageInputUnsupportedMessage(
            resolvedEngine,
            t as (key: string, options?: Record<string, unknown>) => string,
          ),
        );
        safeMessageActivity();
        return;
      }
      // 通过校验后立刻贴底（含无乐观气泡路径）；乐观气泡处再发一次无害。
      emitMessagesForcePinBottom();
      let resolvedSelectedAgent =
        resolvedEngine !== "opencode" ? (options?.selectedAgent ?? null) : null;
      if (resolvedSelectedAgent?.source === "builtIn") {
        const selectedBuiltInAgentId = resolvedSelectedAgent.id;
        const sendResolution = await resolveSelectedAgentForSend(
          resolvedSelectedAgent,
        );
        resolvedSelectedAgent = sendResolution.agent;
        if (sendResolution.error) {
          onDebug?.({
            id: `${Date.now()}-built-in-agent-resolution-error`,
            timestamp: Date.now(),
            source: "error",
            label: "agent/built-in resolution error",
            payload: sendResolution.error.message,
          });
          pushErrorToast({
            title: t("messages.builtInAgentUnavailableTitle"),
            message: t("messages.builtInAgentUnavailableMessage"),
            durationMs: 4200,
          });
          window.dispatchEvent(
            new CustomEvent(BUILT_IN_AGENT_RESOLUTION_FAILED_EVENT, {
              detail: { agentId: selectedBuiltInAgentId },
            }),
          );
        }
      }
      const selectedAgentName =
        resolvedEngine !== "opencode"
          ? resolvedSelectedAgent?.name?.trim() || null
          : null;
      const selectedAgentIcon =
        resolvedEngine !== "opencode" && resolvedSelectedAgent
          ? resolveAgentIconForAgent(resolvedSelectedAgent, "codicon-hubot")
          : null;
      const selectedAgentPrompt = resolvedSelectedAgent?.prompt?.trim() || "";
      const selectedAgentPromptSections: string[] = [];
      if (selectedAgentName) {
        selectedAgentPromptSections.push(
          `${AGENT_PROMPT_NAME_PREFIX} ${selectedAgentName}`,
        );
      }
      if (selectedAgentIcon) {
        selectedAgentPromptSections.push(
          `${AGENT_PROMPT_ICON_PREFIX} ${selectedAgentIcon}`,
        );
      }
      if (selectedAgentPrompt) {
        selectedAgentPromptSections.push(selectedAgentPrompt);
      }
      const selectedAgentPromptBlock = selectedAgentPromptSections
        .join("\n\n")
        .trim();
      if (selectedAgentPromptBlock) {
        if (!finalText.includes(AGENT_PROMPT_HEADER)) {
          finalText = `${finalText}\n\n${AGENT_PROMPT_HEADER}\n\n${selectedAgentPromptBlock}`;
        }
      }
      let claudeMcpDiagnostics: string[] = [];
      let claudeMcpOutputNotice: string | null = null;
      const claudeMcpSnapshot =
        resolvedEngine === "claude"
          ? getClaudeMcpRuntimeSnapshot(workspace.id)
          : null;
      if (resolvedEngine === "claude") {
        const rewriteResult = rewriteClaudePlaywrightAlias(
          workspace.id,
          finalText,
        );
        finalText = rewriteResult.text;
        claudeMcpDiagnostics = rewriteResult.diagnostics;
        if (rewriteResult.aliasMentioned) {
          onDebug?.({
            id: `${Date.now()}-claude-mcp-routing`,
            timestamp: Date.now(),
            source: "client",
            label: "claude/mcp-routing",
            payload: {
              workspaceId: workspace.id,
              threadId,
              applied: rewriteResult.applied,
              fromServer: rewriteResult.fromServer,
              toServer: rewriteResult.toServer,
              diagnostics: rewriteResult.diagnostics,
            },
          });
          claudeMcpOutputNotice = rewriteResult.applied
            ? t("threads.claudeMcpRouteMapped")
            : t("threads.claudeMcpRouteUnavailable");
        }
      }
      if (resolvedEngine === "claude") {
        setPendingClaudeMcpOutputNotice(
          workspace.id,
          threadId,
          claudeMcpOutputNotice,
        );
      } else {
        clearPendingClaudeMcpOutputNotice(workspace.id, threadId);
      }
      if (options?.browserContextAttachment) {
        finalText = formatBrowserContextPromptOnce(
          finalText,
          options.browserContextAttachment,
        );
      }
      if (injectionResult.injectedCount > 0 && injectionResult.previewText) {
        dispatch({
          type: "upsertItem",
          workspaceId: workspace.id,
          threadId,
          item: {
            id: `memory-context-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 8)}`,
            kind: "message",
            role: "assistant",
            text: `${MEMORY_CONTEXT_SUMMARY_PREFIX}\n${injectionResult.previewText}`,
          },
          hasCustomName: Boolean(getCustomName(workspace.id, threadId)),
        });
      }
      if (memoryReferenceEnabled && memoryScoutInjectionResult.previewText) {
        dispatch({
          type: "upsertItem",
          workspaceId: workspace.id,
          threadId,
          item: {
            id: memoryScoutSummaryItemId,
            kind: "message",
            role: "assistant",
            text: `${MEMORY_CONTEXT_SUMMARY_PREFIX}\n${memoryScoutInjectionResult.previewText}`,
          },
          hasCustomName: Boolean(getCustomName(workspace.id, threadId)),
        });
      }
      if (
        noteInjectionResult.injectedCount > 0 &&
        noteInjectionResult.previewText
      ) {
        dispatch({
          type: "upsertItem",
          workspaceId: workspace.id,
          threadId,
          item: {
            id: `note-card-context-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 8)}`,
            kind: "message",
            role: "assistant",
            text: `${NOTE_CARD_CONTEXT_SUMMARY_PREFIX}\n${noteInjectionResult.previewText}`,
          },
          hasCustomName: Boolean(getCustomName(workspace.id, threadId)),
        });
      }
      if (memoryReferenceEnabled) {
        onDebug?.({
          id: `${Date.now()}-memory-scout-result`,
          timestamp: Date.now(),
          source: "client",
          label:
            memoryScoutInjectionResult.injectedCount > 0
              ? "memory/scout-injected"
              : "memory/scout-skipped",
          payload: {
            workspaceId: workspace.id,
            threadId,
            injectedCount: memoryScoutInjectionResult.injectedCount,
            injectedChars: memoryScoutInjectionResult.injectedChars,
            retrievalMs: memoryScoutInjectionResult.retrievalMs,
            reason: memoryScoutInjectionResult.disabledReason,
            retrievalMode: memoryScoutBrief?.retrievalMode ?? "lexical",
            semanticDiagnostics: memoryScoutBrief?.semanticDiagnostics ?? null,
          },
        });
      }
      if (injectionResult.injectedCount > 0) {
        onDebug?.({
          id: `${Date.now()}-memory-context-injected`,
          timestamp: Date.now(),
          source: "client",
          label: "memory/context-injected",
          payload: {
            injectedCount: injectionResult.injectedCount,
            injectedChars: injectionResult.injectedChars,
            retrievalMs: injectionResult.retrievalMs,
          },
        });
      } else if (injectionResult.disabledReason) {
        onDebug?.({
          id: `${Date.now()}-memory-context-skipped`,
          timestamp: Date.now(),
          source: "client",
          label: "memory/context-skipped",
          payload: {
            reason: injectionResult.disabledReason,
            retrievalMs: injectionResult.retrievalMs,
          },
        });
      }
      const resolvedComposerSelection = resolveComposerSelection?.() ?? null;
      const modelFromOptions =
        options?.model !== undefined ? options.model : undefined;
      const modelFromHook = resolvedComposerSelection?.model ?? model;
      const selectedModelId =
        threadKind === "shared"
          ? (supportedStoredSharedTarget?.modelCatalogEntryId ?? null)
          : (resolvedComposerSelection?.id ?? null);
      const selectedModelSource =
        threadKind === "shared"
          ? (supportedStoredSharedTarget?.providerProfileSource ?? "unknown")
          : (resolvedComposerSelection?.source ?? "unknown");
      const resolvedModel =
        threadKind === "shared" && supportedStoredSharedTarget
          ? (supportedStoredSharedTarget.model ?? null)
          : modelFromOptions !== undefined
            ? modelFromOptions
            : modelFromHook;
      const rawResolvedEffort =
        threadKind === "shared" && supportedStoredSharedTarget
          ? (supportedStoredSharedTarget.reasoning?.effort ?? null)
          : options?.effort !== undefined
            ? options.effort
            : (resolvedComposerSelection?.effort ?? effort);
      const resolvedEffort = normalizeEngineScopedEffort(
        resolvedEngine,
        rawResolvedEffort,
      );
      const disableThinkingForClaude =
        resolvedEngine === "claude" && claudeThinkingVisible === false;
      const resolvedCollaborationMode =
        options?.collaborationMode !== undefined
          ? options.collaborationMode
          : (resolvedComposerSelection?.collaborationMode ?? collaborationMode);
      const sanitizedCollaborationMode =
        resolvedCollaborationMode &&
        typeof resolvedCollaborationMode === "object" &&
        "settings" in resolvedCollaborationMode
          ? resolvedCollaborationMode
          : null;
      const resolvedCollaborationModeIdForSend =
        resolveCollaborationModeIdFromPayload(sanitizedCollaborationMode);
      const userCollaborationMode =
        resolvedEngine === "codex" ? resolvedCollaborationModeIdForSend : null;
      const accessModeForSend =
        resolvedEngine === "claude" &&
        resolvedCollaborationModeIdForSend === "plan"
          ? "read-only"
          : options?.accessMode !== undefined
            ? options.accessMode
            : accessMode;
      const resolvedAccessMode = normalizeAccessMode(
        accessModeForSend,
        resolvedEngine,
      );
      const resolvedOpenCodeAgent =
        resolvedEngine === "opencode"
          ? (resolveOpenCodeAgent?.(threadId) ?? null)
          : null;
      const resolvedOpenCodeVariant =
        resolvedEngine === "opencode"
          ? (resolveOpenCodeVariant?.(threadId) ?? null)
          : null;
      const sanitizeOpenCodeModel = (candidate: string | null | undefined) => {
        if (!candidate) {
          return null;
        }
        const trimmed = candidate.trim();
        if (!trimmed) {
          return null;
        }
        // Guard against cross-engine leakage like "claude-sonnet-*".
        if (trimmed.startsWith("claude-")) {
          return null;
        }
        return trimmed;
      };
      const sanitizedModel =
        resolvedEngine === "claude" && resolvedModel
          ? resolvedModel.trim() || null
          : resolvedEngine === "codex" &&
              resolvedModel &&
              resolvedModel.startsWith("claude-")
            ? null
            : resolvedEngine === "gemini" &&
                resolvedModel &&
                isLikelyForeignModelForGemini(resolvedModel)
              ? null
              : resolvedModel;
      const sanitizedOpenCodeModel =
        resolvedEngine === "opencode"
          ? sanitizeOpenCodeModel(sanitizedModel)
          : sanitizedModel;
      const modelForSend =
        resolvedEngine === "opencode"
          ? (sanitizedOpenCodeModel ?? "openai/gpt-5.3-codex")
          : sanitizedOpenCodeModel;
      if (resolvedEngine === "opencode") {
        const normalizedModel = (modelForSend ?? "").trim().toLowerCase();
        const prevModel = lastOpenCodeModelByThreadRef.current.get(threadId);
        const isSessionThread = threadId.startsWith("opencode:");
        if (
          isSessionThread &&
          prevModel &&
          normalizedModel &&
          prevModel !== normalizedModel
        ) {
          pushErrorToast({
            title: t("messages.opencodeModelSwitchTitle"),
            message: t("messages.opencodeModelSwitchMessage"),
            durationMs: 3200,
          });
        }
        if (normalizedModel) {
          lastOpenCodeModelByThreadRef.current.set(threadId, normalizedModel);
        }
      }
      if (
        resolvedEngine === "opencode" &&
        resolvedModel &&
        !sanitizedOpenCodeModel
      ) {
        onDebug?.({
          id: `${Date.now()}-client-opencode-model-sanitize`,
          timestamp: Date.now(),
          source: "client",
          label: "model/sanitize",
          payload: {
            reason: "invalid-opencode-model",
            model: resolvedModel,
            fallback: "openai/gpt-5.3-codex",
          },
        });
      }
      onDebug?.({
        id: `${Date.now()}-client-model-resolve`,
        timestamp: Date.now(),
        source: "client",
        label: "model/resolve",
        payload: {
          threadId,
          engine: resolvedEngine,
          selectedModelId,
          selectedModelSource,
          modelFromOptions: modelFromOptions ?? null,
          modelFromHook: modelFromHook ?? null,
          resolvedModel: resolvedModel ?? null,
          sanitizedModel: sanitizedModel ?? null,
          modelForSend: modelForSend ?? null,
        },
      });
      let sharedSendAdmissionRevision: number | undefined;
      if (sharedV2SendEnabled) {
        const admission = tryAcquireSharedSend(workspace.id, threadId);
        if (!admission.acquired) {
          onDebug?.({
            id: `${Date.now()}-client-shared-turn-admission-blocked`,
            timestamp: Date.now(),
            source: "client",
            label: "shared-session/turn blocked",
            payload: {
              workspaceId: workspace.id,
              threadId,
              state: admission.state,
              phase: "atomic-admission",
            },
          });
          return;
        }
        sharedSendAdmissionRevision = admission.revision;
        // handoff 前若同步 UI mutation 抛错/早退，精确释放本 caller 的 admission。
        // 正常路径中 V2 在第一个 await 前消费 revision，此 microtask 不会误解锁。
        queueMicrotask(() => {
          releaseSharedSendAdmission(
            workspace.id,
            threadId,
            admission.revision,
          );
        });
      }
      const wasProcessing =
        (threadStatusById[threadId]?.isProcessing ?? false) && steerEnabled;
      // 若入口已打 early bubble，这里只补 metadata / 便签附图 / codex 出图占位；
      // 否则（极少路径）再补一次，避免双气泡。
      const shouldEnrichOrAddOptimisticUserBubble =
        !options?.suppressUserMessageRender &&
        !options?.skipOptimisticUserBubble &&
        (Boolean(optimisticUserItem) ||
          resolvedEngine === "codex" ||
          wasProcessing ||
          threadKind === "shared" ||
          finalImages.length > 0 ||
          Boolean(options?.browserContextAttachment) ||
          Boolean(options?.intentCanvasContextAttachments?.length));
      if (shouldEnrichOrAddOptimisticUserBubble) {
        const optimisticDisplayText = visibleUserText;
        const optimisticImages =
          finalImages.length > 0
            ? finalImages
            : (optimisticUserItem?.images ?? []);
        if (
          optimisticDisplayText ||
          optimisticImages.length > 0 ||
          options?.browserContextAttachment ||
          options?.intentCanvasContextAttachments?.length
        ) {
          if (optimisticUserItem) {
            // 更新 early bubble：保留 id，补 agent 元数据与更完整附图
            optimisticUserItem = {
              ...optimisticUserItem,
              // 用户可见正文保持原文（纯图仍为空），不写 injection
              text: optimisticDisplayText,
              images:
                optimisticImages.length > 0 ? optimisticImages : undefined,
              collaborationMode: userCollaborationMode,
              selectedAgentName,
              selectedAgentIcon,
              browserContextAttachment:
                options?.browserContextAttachment ?? null,
              intentCanvasContextAttachments:
                options?.intentCanvasContextAttachments,
            };
          } else {
            optimisticUserItem = {
              id: `optimistic-user-${Date.now()}-${Math.random()
                .toString(36)
                .slice(2, 8)}`,
              kind: "message",
              role: "user",
              text: optimisticDisplayText,
              images:
                optimisticImages.length > 0 ? optimisticImages : undefined,
              collaborationMode: userCollaborationMode,
              selectedAgentName,
              selectedAgentIcon,
              browserContextAttachment:
                options?.browserContextAttachment ?? null,
              intentCanvasContextAttachments:
                options?.intentCanvasContextAttachments,
            };
          }
          dispatch({
            type: "upsertItem",
            workspaceId: workspace.id,
            threadId,
            item: optimisticUserItem,
            hasCustomName: Boolean(getCustomName(workspace.id, threadId)),
          });
          const optimisticGeneratedImagePrompt =
            resolvedEngine === "codex"
              ? extractOptimisticGeneratedImagePrompt(optimisticDisplayText)
              : null;
          if (optimisticGeneratedImagePrompt && !optimisticGeneratedImageItem) {
            optimisticGeneratedImageItem =
              createOptimisticGeneratedImageProcessingItem({
                threadId,
                userMessageId: optimisticUserItem.id,
                promptText: optimisticGeneratedImagePrompt,
              });
            dispatch({
              type: "upsertItem",
              workspaceId: workspace.id,
              threadId,
              item: optimisticGeneratedImageItem,
              hasCustomName: Boolean(getCustomName(workspace.id, threadId)),
            });
          }
        }
      }
      const timestamp = Date.now();
      const effectiveResolvedEngine = resolvedEngine;
      const codexPreSendAcceptedTurnResolution =
        effectiveResolvedEngine === "codex"
          ? resolveCodexAcceptedTurnFact({
              record: codexAcceptedTurnByThread[threadId] ?? null,
              items: itemsByThread[threadId] ?? [],
            })
          : null;
      const shouldDeferCodexDraftActivity = codexPreSendAcceptedTurnResolution
        ? shouldDeferCodexActivityUntilTurnAccepted(
            codexPreSendAcceptedTurnResolution,
          )
        : false;
      if (!shouldDeferCodexDraftActivity) {
        recordThreadActivity(workspace.id, threadId, timestamp);
        dispatch({
          type: "setThreadTimestamp",
          workspaceId: workspace.id,
          threadId,
          timestamp,
        });
      }
      if (
        workspaceScopedHas(pendingInterruptsRef.current, workspace.id, threadId)
      ) {
        workspaceScopedDelete(
          pendingInterruptsRef.current,
          workspace.id,
          threadId,
        );
      }
      if (
        workspaceScopedHas(
          interruptedThreadsRef.current,
          workspace.id,
          threadId,
        )
      ) {
        workspaceScopedDelete(
          interruptedThreadsRef.current,
          workspace.id,
          threadId,
        );
      }
      markProcessing(threadId, true);
      safeMessageActivity();
      primeThreadStreamLatencyForSend(
        workspace.id,
        threadId,
        effectiveResolvedEngine,
        modelForSend,
      );
      onDebug?.({
        id: `${Date.now()}-client-turn-start`,
        timestamp: Date.now(),
        source: "client",
        label: "turn/start",
        payload: {
          workspaceId: workspace.id,
          threadId,
          engine: effectiveResolvedEngine,
          selectedEngine: activeEngine,
          providerProfileId:
            supportedStoredSharedTarget?.providerProfileId ?? null,
          modelCatalogEntryId:
            supportedStoredSharedTarget?.modelCatalogEntryId ?? null,
          text: finalText,
          images: finalImages,
          model: modelForSend,
          effort: resolvedEffort,
          collaborationMode: sanitizedCollaborationMode,
          accessMode: resolvedAccessMode ?? null,
          agent: resolvedOpenCodeAgent,
          variant: resolvedOpenCodeVariant,
          claudeMcpSnapshot:
            resolvedEngine === "claude"
              ? {
                  capturedAt: claudeMcpSnapshot?.capturedAt ?? null,
                  sessionId: claudeMcpSnapshot?.sessionId ?? null,
                  toolsCount: claudeMcpSnapshot?.tools.length ?? 0,
                  servers: claudeMcpSnapshot?.mcpServers ?? [],
                }
              : null,
        },
      });
      if (shouldEmitThreadMessagingDevLogs) {
        console.info("[turn/start]", {
          workspaceId: workspace.id,
          threadId,
          engine: effectiveResolvedEngine,
          selectedEngine: activeEngine,
          model: modelForSend,
          effort: resolvedEffort,
          accessMode: resolvedAccessMode ?? null,
          agent: resolvedOpenCodeAgent,
          variant: resolvedOpenCodeVariant,
          textLength: finalText.length,
          hasImages: finalImages.length > 0,
        });
      }
      const retryCodexSendAfterThreadRefresh = async (errorMessage: string) => {
        const staleRecoveryClassification =
          classifyStaleThreadRecovery(errorMessage);
        if (
          threadKind === "shared" ||
          resolvedEngine !== "codex" ||
          options?.codexInvalidThreadRetryAttempted ||
          !isRecoverableCodexThreadBindingError(errorMessage)
        ) {
          return false;
        }
        let reboundThreadId: string | null = null;
        let refreshErrorMessage: string | null = null;
        try {
          reboundThreadId = await refreshThread(workspace.id, threadId);
        } catch (refreshError) {
          refreshErrorMessage =
            refreshError instanceof Error
              ? refreshError.message
              : String(refreshError);
          reboundThreadId = null;
        }
        const acceptedTurnResolution =
          codexPreSendAcceptedTurnResolution ??
          resolveCodexAcceptedTurnFact({
            record: codexAcceptedTurnByThread[threadId] ?? null,
            items: itemsByThread[threadId] ?? [],
          });
        const moveOptimisticUserIntentToThread = (targetThreadId: string) => {
          if (targetThreadId === threadId || !optimisticUserItem) {
            return;
          }
          dispatch({
            type: "setThreadItems",
            threadId,
            items: (itemsByThread[threadId] ?? []).filter(
              (item) =>
                item.id !== optimisticUserItem.id &&
                item.id !== optimisticGeneratedImageItem?.id,
            ),
          });
          dispatch({
            type: "upsertItem",
            workspaceId: workspace.id,
            threadId: targetThreadId,
            item: optimisticUserItem,
            hasCustomName: Boolean(getCustomName(workspace.id, targetThreadId)),
          });
          if (optimisticGeneratedImageItem) {
            dispatch({
              type: "upsertItem",
              workspaceId: workspace.id,
              threadId: targetThreadId,
              item: {
                ...optimisticGeneratedImageItem,
                id: `optimistic-generated-image:${targetThreadId}:${optimisticUserItem.id}`,
              },
              hasCustomName: Boolean(
                getCustomName(workspace.id, targetThreadId),
              ),
            });
          }
        };
        const retrySendOnThread = async (targetThreadId: string) => {
          markProcessing(threadId, false);
          setActiveTurnId(threadId, null);
          safeMessageActivity();
          await sendMessageToThread(
            workspace,
            targetThreadId,
            finalText,
            finalImages,
            {
              skipPromptExpansion: true,
              skipOptimisticUserBubble: true,
              model: modelForSend,
              effort: resolvedEffort,
              collaborationMode: sanitizedCollaborationMode,
              accessMode: resolvedAccessMode,
              resumeSource: options?.resumeSource,
              resumeTurnId: options?.resumeTurnId,
              codexInvalidThreadRetryAttempted: true,
            },
          );
        };
        const recoveryAttempt = createRecoveryAttempt({
          threadId,
          workspace,
          reboundThreadId,
          acceptedTurnResolution,
          staleRecoveryClassification,
          optimisticUserItem,
          moveOptimisticUserIntentToThread,
          retrySendOnThread,
          startThreadForMessageSend,
          forkThreadForWorkspace,
          dispatch,
          onDebug,
          errorMessage,
          refreshErrorMessage,
          providerProfileId:
            getThreadProviderProfileId?.(workspace.id, threadId) ?? null,
        });
        const isSameMissingThreadRebind =
          reboundThreadId === threadId &&
          isCodexMissingThreadBindingError(errorMessage);
        if (
          !reboundThreadId ||
          recoveryAttempt.isUnverifiedSameThreadMissingRebind ||
          isSameMissingThreadRebind
        ) {
          if (
            await recoveryAttempt.tryFreshDraftReplacement(
              recoveryAttempt.isUnverifiedSameThreadMissingRebind ||
                isSameMissingThreadRebind
                ? "refresh returned the same missing thread"
                : refreshErrorMessage
                  ? `refresh failed: ${refreshErrorMessage}`
                  : null,
            )
          ) {
            return true;
          }
          return recoveryAttempt.tryForkFromMessage(refreshErrorMessage);
        }
        onDebug?.({
          id: `${Date.now()}-client-turn-start-thread-retry`,
          timestamp: Date.now(),
          source: "client",
          label: "turn/start thread rebind retry",
          payload: {
            workspaceId: workspace.id,
            originalThreadId: threadId,
            reboundThreadId,
            reboundChanged: reboundThreadId !== threadId,
            reason: errorMessage,
            reasonCode: staleRecoveryClassification?.reasonCode ?? null,
            staleReason: staleRecoveryClassification?.staleReason ?? null,
            retryable: staleRecoveryClassification?.retryable ?? true,
            userAction:
              staleRecoveryClassification?.userAction ?? "recover-thread",
            outcome:
              staleRecoveryClassification?.recommendedOutcome ?? "rebound",
          },
        });
        if (reboundThreadId !== threadId) {
          dispatch({
            type: "setActiveThreadId",
            workspaceId: workspace.id,
            threadId: reboundThreadId,
          });
          moveOptimisticUserIntentToThread(reboundThreadId);
        }
        await retrySendOnThread(reboundThreadId);
        return true;
      };
      try {
        let response: Record<string, unknown>;
        if (threadKind === "shared") {
          const sharedResolvedEngine = normalizeSharedSessionEngine(
            supportedStoredSharedTarget?.engine ?? resolvedEngine,
          );
          dispatch({
            type: "setThreadEngine",
            workspaceId: workspace.id,
            threadId,
            engine: sharedResolvedEngine,
          });
          // Shared Picker 写入的 selectedNextTarget 是下一轮唯一权威输入。
          // 旧的全局 Composer selection 可能仍指向上一个 CLI/Provider，不能在
          // send boundary 重新组装并覆盖用户刚选中的 Target。
          // effort：对 Codex catalog 模型在 send 边界再 reconcile 一次，
          // 避免 hydrate 遗留 null / 非法档位直送 CLI。
          const sharedTargetBase = supportedStoredSharedTarget ?? {
            engine: sharedResolvedEngine,
            providerProfileId:
              resolvedComposerSelection?.providerProfileId?.trim() || null,
            model: modelForSend ?? null,
            modelCatalogEntryId: resolvedComposerSelection?.id?.trim() || null,
            reasoning: resolvedEffort ? { effort: resolvedEffort } : null,
          };
          const sharedReconciledEffort = reconcileAtomicReasoningEffort({
            engine: sharedTargetBase.engine,
            model: {
              id:
                sharedTargetBase.modelCatalogEntryId?.trim() ||
                sharedTargetBase.model?.trim() ||
                null,
              model: sharedTargetBase.model?.trim() || null,
            },
            effort: sharedTargetBase.reasoning?.effort ?? null,
          });
          const sharedNextTarget = {
            ...sharedTargetBase,
            reasoning: sharedReconciledEffort
              ? { effort: sharedReconciledEffort }
              : null,
          };
          if (!sharedV2SendEnabled && !supportedStoredSharedTarget) {
            selectNextTarget(workspace.id, threadId, sharedNextTarget);
          }
          response = (await sendSharedSessionTurnRouted({
            workspaceId: workspace.id,
            threadId,
            engine: sharedResolvedEngine,
            text: finalText,
            model: sharedNextTarget.model ?? null,
            effort: sharedNextTarget.reasoning?.effort ?? null,
            disableThinking: disableThinkingForClaude,
            collaborationMode: sanitizedCollaborationMode,
            accessMode: resolvedAccessMode,
            images: finalImages,
            preferredLanguage: i18n.language.toLowerCase().startsWith("zh")
              ? "zh"
              : "en",
            customSpecRoot: resolveWorkspaceSpecRoot(workspace.id),
            sharedSendAdmissionRevision,
            target: sharedNextTarget,
          })) as Record<string, unknown>;
          // V2 begin 早退（recovery-required / target-unavailable）：编排层已驱动
          // send 状态机，这里不按发送失败处理，也不抛出；复位 processing，
          // 让 Composer 按状态机渲染恢复/不可用 UI。
          if (
            sharedV2SendEnabled &&
            (response?.status === "blocked" ||
              response?.status === "recovery-required" ||
              response?.status === "target-unavailable")
          ) {
            markProcessing(threadId, false);
            setActiveTurnId(threadId, null);
            safeMessageActivity();
            return response as SendSharedSessionTurnV2Result;
          }
          const sharedNativeThreadId = asString(
            response?.nativeThreadId ?? "",
          ).trim();
          if (
            sharedNativeThreadId &&
            !sharedNativeThreadId.startsWith("shared:")
          ) {
            dispatch({
              type: "hideThread",
              workspaceId: workspace.id,
              threadId: sharedNativeThreadId,
            });
          }

          onDebug?.({
            id: `${Date.now()}-server-shared-turn-start`,
            timestamp: Date.now(),
            source: "server",
            label: "shared-session/turn/start response",
            payload: response,
          });
          const sharedV2Result =
            response.v2 && typeof response.v2 === "object"
              ? (response.v2 as Record<string, unknown>)
              : null;
          if (sharedV2SendEnabled && sharedV2Result?.committed === true) {
            // Shared V2 command 直到 Runtime terminal 被 canonical commit 后才返回。
            // 先用 exact Runtime identity 建立 terminal barrier，避免已排队的
            // assistant/reasoning/item event 在 UI cleanup 后复燃 Stop。
            const sharedRuntimeTurnId = asString(
              response.runtimeTurnId ?? "",
            ).trim();
            if (sharedRuntimeTurnId) {
              onSharedDurableTurnCommitted?.(threadId, sharedRuntimeTurnId);
            } else {
              onDebug?.({
                id: `${Date.now()}-shared-durable-terminal-runtime-id-missing`,
                timestamp: Date.now(),
                source: "error",
                label: "shared-session/durable-terminal-runtime-id-missing",
                payload: {
                  workspaceId: workspace.id,
                  threadId,
                  attemptId: asString(sharedV2Result.attemptId).trim() || null,
                  logicalTurnId:
                    asString(sharedV2Result.logicalTurnId).trim() || null,
                },
              });
            }
            // Project-memory input capture for shared V2 (native path is skipped
            // by this early return). Prefer runtimeTurnId so fusion matches
            // turn/completed / onAgentMessageCompleted turnId.
            const sharedMemoryTurnId =
              sharedRuntimeTurnId ||
              asString(sharedV2Result.logicalTurnId).trim();
            if (sharedMemoryTurnId && visibleUserText.trim()) {
              void projectMemoryFacade
                .captureTurnInput({
                  workspaceId: workspace.id,
                  userInput: visibleUserText,
                  threadId,
                  turnId: sharedMemoryTurnId,
                  workspaceName: workspace.name ?? null,
                  workspacePath: workspace.path ?? null,
                  engine: sharedResolvedEngine,
                })
                .then((captured) => {
                  onInputMemoryCaptured?.({
                    workspaceId: workspace.id,
                    threadId,
                    turnId: sharedMemoryTurnId,
                    inputText: visibleUserText,
                    memoryId: captured?.id ?? null,
                    workspaceName: workspace.name ?? null,
                    workspacePath: workspace.path ?? null,
                    engine: sharedResolvedEngine,
                  });
                })
                .catch((err) => {
                  if (shouldEmitThreadMessagingDevLogs) {
                    console.warn(
                      "[project-memory] shared auto capture failed:",
                      err,
                    );
                  }
                });
            }
            // 此处只收敛 Shared UI projection；不得落入 Native turn-start lifecycle。
            markProcessing(threadId, false);
            setActiveTurnId(threadId, null);
            safeMessageActivity();
            return response as SendSharedSessionTurnV2Result;
          }
          // Shared V1 (or V2 without committed): still capture input when we have
          // a stable turn identity; native capture block is not reached.
          const sharedV1MemoryTurnId =
            asString(response.runtimeTurnId ?? "").trim() ||
            asString(sharedV2Result?.logicalTurnId).trim() ||
            asString(response.logicalTurnId ?? response.turnId ?? "").trim();
          if (sharedV1MemoryTurnId && visibleUserText.trim()) {
            void projectMemoryFacade
              .captureTurnInput({
                workspaceId: workspace.id,
                userInput: visibleUserText,
                threadId,
                turnId: sharedV1MemoryTurnId,
                workspaceName: workspace.name ?? null,
                workspacePath: workspace.path ?? null,
                engine: sharedResolvedEngine,
              })
              .then((captured) => {
                onInputMemoryCaptured?.({
                  workspaceId: workspace.id,
                  threadId,
                  turnId: sharedV1MemoryTurnId,
                  inputText: visibleUserText,
                  memoryId: captured?.id ?? null,
                  workspaceName: workspace.name ?? null,
                  workspacePath: workspace.path ?? null,
                  engine: sharedResolvedEngine,
                });
              })
              .catch((err) => {
                if (shouldEmitThreadMessagingDevLogs) {
                  console.warn(
                    "[project-memory] shared auto capture failed:",
                    err,
                  );
                }
              });
          }
        } else {
          const isClaudeSession = threadId.startsWith("claude:");
          const isOpenCodeSession = threadId.startsWith("opencode:");
          const cliEngine = resolvedEngine === "codex" ? null : resolvedEngine;
          const threadItems = itemsByThread[threadId] ?? [];
          const sessionSpecKey = `${workspace.id}:${threadId}`;
          const customSpecRoot = resolveWorkspaceSpecRoot(workspace.id);
          let sessionSpecLink =
            sessionSpecLinkByThreadRef.current.get(sessionSpecKey) ?? null;
          const shouldProbeSessionSpecLink =
            shouldProbeSessionSpecForEngine(resolvedEngine) &&
            Boolean(customSpecRoot) &&
            (threadItems.length === 0 || !sessionSpecLink);
          if (shouldProbeSessionSpecLink && customSpecRoot) {
            const probeStartAt = Date.now();
            sessionSpecLink = await probeSessionSpecLinkWithTimeout(
              workspace.id,
              workspace.path,
              "custom",
              customSpecRoot,
            );
            const probeDurationMs = Date.now() - probeStartAt;
            sessionSpecLinkByThreadRef.current.set(
              sessionSpecKey,
              sessionSpecLink,
            );
            onDebug?.({
              id: `${Date.now()}-spec-root-probe`,
              timestamp: Date.now(),
              source: "client",
              label: "specRoot/probe",
              payload: {
                workspaceId: workspace.id,
                threadId,
                engine: resolvedEngine,
                source: "custom",
                rootPath: customSpecRoot,
                status: sessionSpecLink.status,
                reason: sessionSpecLink.reason,
                durationMs: probeDurationMs,
              },
            });
          }
          const shouldInjectSpecRootHintInPrompt =
            resolvedEngine === "codex" &&
            Boolean(sessionSpecLink) &&
            threadItems.length === 0;
          const codexEffectiveText =
            shouldInjectSpecRootHintInPrompt && sessionSpecLink
              ? buildCodexTextWithSpecRootPriority(finalText, sessionSpecLink)
              : finalText;
          const shouldInjectSpecRootCard =
            resolvedEngine === "codex" &&
            Boolean(sessionSpecLink) &&
            threadItems.length === 0;
          if (shouldInjectSpecRootCard && sessionSpecLink) {
            const statusLabel = sessionSpecLink.status;
            const priorityDetail =
              sessionSpecLink.status === "visible"
                ? t("threads.specRootContext.priorityDetail")
                : "Linked root is not usable. Resolve link before relying on fallback inference.";
            const entries: {
              kind: "read" | "search" | "list" | "run";
              label: string;
              detail?: string;
            }[] = [
              {
                kind: "list",
                label: t("threads.specRootContext.activeRoot"),
                detail: sessionSpecLink.rootPath,
              },
              {
                kind: "list",
                label: "Probe status",
                detail: statusLabel,
              },
              {
                kind: "read",
                label: t("threads.specRootContext.priorityLabel"),
                detail: priorityDetail,
              },
            ];
            if (sessionSpecLink.reason) {
              entries.push({
                kind: "read",
                label: "Failure reason",
                detail: sessionSpecLink.reason,
              });
            }
            if (sessionSpecLink.status !== "visible") {
              entries.push(
                {
                  kind: "run",
                  label: "/spec-root rebind",
                  detail: "Rebind to latest Spec Hub path and re-probe.",
                },
                {
                  kind: "run",
                  label: "/spec-root default",
                  detail:
                    "Restore workspace default openspec path and re-probe.",
                },
              );
            }
            dispatch({
              type: "upsertItem",
              workspaceId: workspace.id,
              threadId,
              item: {
                id: `spec-root-context-${threadId}`,
                kind: "explore",
                status: "explored",
                title: t("threads.specRootContext.title"),
                collapsible: true,
                mergeKey: "spec-root-context",
                entries,
              },
              hasCustomName: Boolean(getCustomName(workspace.id, threadId)),
            });
          }
          const realSessionId =
            resolvedEngine === "claude" && isClaudeSession
              ? threadId.slice("claude:".length)
              : resolvedEngine === "claude" && isClaudeForkThreadId(threadId)
                ? null
                : resolvedEngine === "claude" &&
                    threadId.startsWith("claude-pending-")
                  ? null
                  : resolvedEngine === "gemini" &&
                      threadId.startsWith("gemini:")
                    ? threadId.slice("gemini:".length)
                    : resolvedEngine === "gemini" &&
                        threadId.startsWith("gemini-pending-")
                      ? (geminiSessionIdByPendingThreadRef.current.get(
                          threadId,
                        ) ?? null)
                      : resolvedEngine === "grok" &&
                          threadId.startsWith("grok:")
                        ? threadId.slice("grok:".length)
                        : resolvedEngine === "grok" &&
                            threadId.startsWith("grok-pending-")
                          ? (grokSessionIdByPendingThreadRef.current.get(
                              threadId,
                            ) ?? null)
                          : resolvedEngine === "kimi" &&
                              threadId.startsWith("kimi:")
                            ? threadId.slice("kimi:".length)
                            : resolvedEngine === "kimi" &&
                                threadId.startsWith("kimi-pending-")
                              ? (kimiSessionIdByPendingThreadRef.current.get(
                                  threadId,
                                ) ?? null)
                              : resolvedEngine === "opencode" &&
                                  isOpenCodeSession
                                ? threadId.slice("opencode:".length)
                                : null;
          const shouldAttachCliSpecRootHint =
            realSessionId === null && Boolean(customSpecRoot);

          if (cliEngine) {
            if (
              resolvedEngine === "claude" &&
              isClaudePendingThreadAwaitingNativeSession(threadId, {
                hasAwaitingMarker:
                  claudePendingThreadAwaitingNativeSessionRef.current.has(
                    threadId,
                  ),
                hasLocalItems: threadItems.length > 0,
                hasActiveTurn: Boolean(activeTurnIdByThread[threadId]),
                isProcessing: Boolean(threadStatusById[threadId]?.isProcessing),
              })
            ) {
              const waitingMessage = t(
                "threads.claudePendingNativeSessionWait",
                {
                  defaultValue:
                    "Claude session is still initializing. Wait for the session to finish binding, then send again.",
                },
              );
              pushThreadErrorMessage(workspace.id, threadId, waitingMessage);
              markProcessing(threadId, false);
              setActiveTurnId(threadId, null);
              safeMessageActivity();
              onDebug?.({
                id: `${Date.now()}-client-claude-pending-native-session-blocked`,
                timestamp: Date.now(),
                source: "client",
                label: "thread/session pending native confirmation blocked",
                payload: {
                  workspaceId: workspace.id,
                  threadId,
                },
              });
              return;
            }

            // Claude/OpenCode/Grok/…: backend only streams assistant/tool events,
            // so add user item locally — unless an early optimistic bubble already
            // covered this turn (image-only / shared / codex paths).
            if (!options?.suppressUserMessageRender && !optimisticUserItem) {
              const userMessageId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
              dispatch({
                type: "upsertItem",
                workspaceId: workspace.id,
                threadId,
                item: {
                  id: userMessageId,
                  kind: "message",
                  role: "user",
                  // Keep user-visible text free of engine-private injection
                  // (e.g. Kimi ReadMediaFile path block is CLI-only).
                  // Image-only: empty text is intentional — never invent
                  // "Please analyze the attached image(s)." for the canvas.
                  text: visibleUserText,
                  // Prefer sanitized image list so canvas screenshots (data URLs /
                  // paths) still render as thumbnails, never as wire text.
                  images: finalImages.length > 0 ? finalImages : undefined,
                  collaborationMode: userCollaborationMode,
                  selectedAgentName,
                  selectedAgentIcon,
                  intentCanvasContextAttachments:
                    options?.intentCanvasContextAttachments,
                },
                hasCustomName: Boolean(getCustomName(workspace.id, threadId)),
              });
            }

            const sendRequestedAt = Date.now();
            const frozenCreateTargetProviderProfileId =
              options?.createSessionTarget?.engine === resolvedEngine
                ? options.createSessionTarget.providerProfileId?.trim() || null
                : null;
            const providerProfileId =
              frozenCreateTargetProviderProfileId ??
              getThreadProviderProfileId?.(workspace.id, threadId) ??
              null;
            response = await engineSendMessageService(workspace.id, {
              text: finalText,
              engine: resolvedEngine,
              model: modelForSend,
              effort: resolvedEffort,
              disableThinking: disableThinkingForClaude,
              images: finalImages.length > 0 ? finalImages : null,
              accessMode: resolvedAccessMode,
              continueSession: realSessionId !== null,
              sessionId: realSessionId,
              threadId: threadId,
              agent: resolvedOpenCodeAgent,
              variant: resolvedOpenCodeVariant,
              providerProfileId,
              forkSessionId:
                resolvedEngine === "claude"
                  ? extractClaudeForkParentSessionId(threadId)
                  : null,
              autoSession: options?.autoSession ?? null,
              skillInvocations: options?.skillInvocations ?? null,
              ...(customSpecRoot && shouldAttachCliSpecRootHint
                ? { customSpecRoot }
                : {}),
            });

            onDebug?.({
              id: `${Date.now()}-server-turn-start`,
              timestamp: Date.now(),
              source: "server",
              label: `turn/start response (${cliEngine})`,
              payload: response,
            });

            const rpcError = extractRpcErrorMessage(response);
            if (rpcError) {
              const stabilityDiagnostic =
                resolveThreadStabilityDiagnostic(rpcError);
              const staleRecoveryClassification =
                classifyStaleThreadRecovery(rpcError);
              const normalized = mapNetworkErrorToUserMessage(rpcError, t);
              const claudeMcpHint =
                resolvedEngine === "claude" &&
                !normalized.isNetwork &&
                claudeMcpDiagnostics.length > 0
                  ? `\n\n${claudeMcpDiagnostics.join("\n")}`
                  : "";
              markProcessing(threadId, false);
              setActiveTurnId(threadId, null);
              pushThreadErrorMessage(
                workspace.id,
                threadId,
                normalized.isNetwork
                  ? normalized.message
                  : `${t("threads.turnFailedWithMessage", { message: normalized.message })}${claudeMcpHint}`,
              );
              pushThreadFailureRuntimeNotice({
                workspaceId: workspace.id,
                threadId,
                engine: resolvedEngine,
                message: normalized.message,
                reasonCode: staleRecoveryClassification?.reasonCode ?? null,
                userAction: staleRecoveryClassification?.userAction ?? null,
              });
              if (stabilityDiagnostic) {
                onDebug?.({
                  id: `${Date.now()}-client-turn-start-stability-diagnostic`,
                  timestamp: Date.now(),
                  source: "client",
                  label: "turn/start stability diagnostic",
                  payload: {
                    workspaceId: workspace.id,
                    threadId,
                    category: stabilityDiagnostic.category,
                    rawMessage: stabilityDiagnostic.rawMessage,
                    recoveryReason: stabilityDiagnostic.reconnectReason ?? null,
                    stage: "rpc-error",
                  },
                });
              }
              if (normalized.isNetwork) {
                pushErrorToast({
                  title: t("common.error"),
                  message: normalized.message,
                  durationMs: 4800,
                });
              }
              safeMessageActivity();
              return;
            }

            if (
              resolvedEngine === "claude" &&
              threadId.startsWith("claude-pending-")
            ) {
              const candidateSessionId =
                extractClaudeCandidateSessionId(response);
              if (candidateSessionId) {
                claudeCandidateSessionIdByPendingThreadRef.current.set(
                  threadId,
                  candidateSessionId,
                );
              }
              claudePendingThreadAwaitingNativeSessionRef.current.add(threadId);
              onDebug?.({
                id: `${Date.now()}-client-claude-session-await-native`,
                timestamp: Date.now(),
                source: "client",
                label: "thread/session awaiting native confirmation",
                payload: {
                  workspaceId: workspace.id,
                  threadId,
                  sessionId: candidateSessionId,
                  source: "engineSendMessageResponse",
                },
              });
            }
            if (
              resolvedEngine === "gemini" &&
              threadId.startsWith("gemini-pending-")
            ) {
              let responseSessionId =
                extractSessionIdFromEngineSendResponse(response);
              if (!responseSessionId) {
                const workspacePath = workspace.path?.trim();
                if (workspacePath) {
                  try {
                    const sessions = await listGeminiSessionsService(
                      workspacePath,
                      6,
                    );
                    responseSessionId = pickLikelyGeminiSessionId(
                      sessions,
                      sendRequestedAt - 120_000,
                    );
                  } catch {
                    responseSessionId = null;
                  }
                }
              }
              if (responseSessionId) {
                geminiSessionIdByPendingThreadRef.current.set(
                  threadId,
                  responseSessionId,
                );
                onDebug?.({
                  id: `${Date.now()}-client-gemini-session-cache`,
                  timestamp: Date.now(),
                  source: "client",
                  label: "thread/session cached",
                  payload: {
                    workspaceId: workspace.id,
                    threadId,
                    sessionId: responseSessionId,
                    source: "geminiSessionListFallback",
                  },
                });
              }
            }
            if (
              resolvedEngine === "grok" &&
              threadId.startsWith("grok-pending-")
            ) {
              let responseSessionId =
                extractSessionIdFromEngineSendResponse(response);
              if (!responseSessionId) {
                const workspacePath = workspace.path?.trim();
                if (workspacePath) {
                  try {
                    const sessions = await listGrokSessionsService(
                      workspacePath,
                      6,
                    );
                    responseSessionId = pickLikelyGrokSessionId(
                      sessions,
                      sendRequestedAt - 120_000,
                    );
                  } catch {
                    responseSessionId = null;
                  }
                }
              }
              if (responseSessionId) {
                grokSessionIdByPendingThreadRef.current.set(
                  threadId,
                  responseSessionId,
                );
                onDebug?.({
                  id: `${Date.now()}-client-grok-session-cache`,
                  timestamp: Date.now(),
                  source: "client",
                  label: "thread/session cached",
                  payload: {
                    workspaceId: workspace.id,
                    threadId,
                    sessionId: responseSessionId,
                    source: "grokSessionListFallback",
                  },
                });
              }
            }
            if (
              resolvedEngine === "kimi" &&
              threadId.startsWith("kimi-pending-")
            ) {
              let responseSessionId =
                extractSessionIdFromEngineSendResponse(response);
              if (!responseSessionId) {
                const workspacePath = workspace.path?.trim();
                if (workspacePath) {
                  try {
                    const sessions = await listKimiSessionsService(
                      workspacePath,
                      6,
                    );
                    responseSessionId = pickLikelyKimiSessionId(
                      sessions,
                      sendRequestedAt - 120_000,
                    );
                  } catch {
                    responseSessionId = null;
                  }
                }
              }
              if (responseSessionId) {
                kimiSessionIdByPendingThreadRef.current.set(
                  threadId,
                  responseSessionId,
                );
                onDebug?.({
                  id: `${Date.now()}-client-kimi-session-cache`,
                  timestamp: Date.now(),
                  source: "client",
                  label: "thread/session cached",
                  payload: {
                    workspaceId: workspace.id,
                    threadId,
                    sessionId: responseSessionId,
                    source: "kimiSessionListFallback",
                  },
                });
              }
            }

            // Extract turn ID - streaming events will handle the rest
            const result = (response?.result ?? response) as Record<
              string,
              unknown
            >;
            const turn = (result?.turn ?? response?.turn ?? null) as Record<
              string,
              unknown
            > | null;
            const turnId = asString(turn?.id ?? "");

            if (!turnId) {
              markProcessing(threadId, false);
              setActiveTurnId(threadId, null);
              pushThreadErrorMessage(
                workspace.id,
                threadId,
                t("threads.turnFailedToStart"),
              );
              safeMessageActivity();
              return;
            }

            // Set active turn ID - useAppServerEvents will handle streaming deltas
            // and mark processing complete when turn/completed event arrives
            setActiveTurnId(threadId, turnId);
          } else {
            // Codex assistant/tool events are event-driven from backend.
            // User message bubble is inserted optimistically on send for instant feedback.
            const preferredLanguage = i18n.language
              .toLowerCase()
              .startsWith("zh")
              ? "zh"
              : "en";
            response = (await sendUserMessageService(
              workspace.id,
              threadId,
              codexEffectiveText,
              {
                model: modelForSend,
                effort: resolvedEffort,
                collaborationMode: sanitizedCollaborationMode,
                accessMode: resolvedAccessMode,
                images: finalImages,
                preferredLanguage,
                resumeSource: options?.resumeSource,
                resumeTurnId: options?.resumeTurnId,
                ...(customSpecRoot ? { customSpecRoot } : {}),
              },
            )) as Record<string, unknown>;
          }

          onDebug?.({
            id: `${Date.now()}-server-turn-start`,
            timestamp: Date.now(),
            source: "server",
            label: "turn/start response",
            payload: response,
          });
          const rpcError = extractRpcErrorMessage(response);
          if (rpcError) {
            if (await retryCodexSendAfterThreadRefresh(rpcError)) {
              return;
            }
            const stabilityDiagnostic =
              resolveThreadStabilityDiagnostic(rpcError);
            const staleRecoveryClassification =
              classifyStaleThreadRecovery(rpcError);
            const firstPacketTimeoutSeconds =
              resolveRecoverableCodexFirstPacketTimeout(
                resolvedEngine,
                rpcError,
              );
            if (firstPacketTimeoutSeconds) {
              const warningMessage = t("threads.firstPacketTimeout", {
                seconds: firstPacketTimeoutSeconds,
              });
              onDebug?.({
                id: `${Date.now()}-client-turn-start-timeout-warning`,
                timestamp: Date.now(),
                source: "client",
                label: "turn/start delayed",
                payload: {
                  threadId,
                  engine: resolvedEngine,
                  timeoutSeconds: firstPacketTimeoutSeconds,
                },
              });
              pushErrorToast({
                title: t("common.warning"),
                message: warningMessage,
                durationMs: 4800,
              });
              pushThreadErrorMessage(workspace.id, threadId, warningMessage);
              markProcessing(threadId, false);
              setActiveTurnId(threadId, null);
              safeMessageActivity();
              return;
            }
            const normalized = mapNetworkErrorToUserMessage(rpcError, t);
            markProcessing(threadId, false);
            setActiveTurnId(threadId, null);
            pushThreadErrorMessage(
              workspace.id,
              threadId,
              normalized.isNetwork
                ? normalized.message
                : t("threads.turnFailedToStartWithMessage", {
                    message: normalized.message,
                  }),
            );
            pushThreadFailureRuntimeNotice({
              workspaceId: workspace.id,
              threadId,
              engine: resolvedEngine,
              message: normalized.message,
              reasonCode: staleRecoveryClassification?.reasonCode ?? null,
              userAction: staleRecoveryClassification?.userAction ?? null,
            });
            if (stabilityDiagnostic) {
              onDebug?.({
                id: `${Date.now()}-client-turn-start-stability-diagnostic`,
                timestamp: Date.now(),
                source: "client",
                label: "turn/start stability diagnostic",
                payload: {
                  workspaceId: workspace.id,
                  threadId,
                  category: stabilityDiagnostic.category,
                  rawMessage: stabilityDiagnostic.rawMessage,
                  recoveryReason: stabilityDiagnostic.reconnectReason ?? null,
                  stage: "rpc-error",
                },
              });
            }
            if (normalized.isNetwork) {
              pushErrorToast({
                title: t("common.error"),
                message: normalized.message,
                durationMs: 4800,
              });
            }
            safeMessageActivity();
            return;
          }
          const result = (response?.result ?? response) as Record<
            string,
            unknown
          >;
          const turn = (result?.turn ?? response?.turn ?? null) as Record<
            string,
            unknown
          > | null;
          const turnId = asString(turn?.id ?? "");
          if (!turnId) {
            markProcessing(threadId, false);
            setActiveTurnId(threadId, null);
            pushThreadErrorMessage(
              workspace.id,
              threadId,
              t("threads.turnFailedToStart"),
            );
            safeMessageActivity();
            return;
          }
          setActiveTurnId(threadId, turnId);
          if (resolvedEngine === "codex") {
            dispatch({
              type: "markCodexAcceptedTurn",
              threadId,
              fact: "accepted",
              source: "turn-start-response",
              timestamp: Date.now(),
            });
            if (shouldDeferCodexDraftActivity) {
              const acceptedTimestamp = Date.now();
              recordThreadActivity(workspace.id, threadId, acceptedTimestamp);
              dispatch({
                type: "setThreadTimestamp",
                workspaceId: workspace.id,
                threadId,
                timestamp: acceptedTimestamp,
              });
            }
          }

          void projectMemoryFacade
            .captureTurnInput({
              workspaceId: workspace.id,
              userInput: visibleUserText,
              threadId,
              turnId,
              workspaceName: workspace.name ?? null,
              workspacePath: workspace.path ?? null,
              engine: resolvedEngine,
            })
            .then((captured) => {
              onInputMemoryCaptured?.({
                workspaceId: workspace.id,
                threadId,
                turnId,
                inputText: visibleUserText,
                memoryId: captured?.id ?? null,
                workspaceName: workspace.name ?? null,
                workspacePath: workspace.path ?? null,
                engine: resolvedEngine,
              });
            })
            .catch((err) => {
              if (shouldEmitThreadMessagingDevLogs) {
                console.warn("[project-memory] auto capture failed:", err);
              }
            });
        }
      } catch (error) {
        const rawMessage =
          error instanceof Error ? error.message : String(error);
        if (await retryCodexSendAfterThreadRefresh(rawMessage)) {
          return;
        }
        const preserveSharedActiveLifecycle =
          threadKind === "shared" &&
          error instanceof SharedActiveAttemptObserverError &&
          getSharedSendActiveAttemptId(workspace.id, threadId) ===
            error.attemptId;
        if (preserveSharedActiveLifecycle) {
          // Runtime 已 accepted；这里只是 frontend observer 脱离。禁止把它投影成
          // Turn failure 或清 processing，recovery card 负责 exact-Attempt reattach。
          onDebug?.({
            id: `${Date.now()}-shared-terminal-observer-detached`,
            timestamp: Date.now(),
            source: "error",
            label: "shared terminal observer detached",
            payload: {
              threadId,
              attemptId: error.attemptId,
              rawMessage,
            },
          });
          safeMessageActivity();
          return {
            status: "ambiguous-error",
            reason: rawMessage,
          };
        }
        const stabilityDiagnostic =
          resolveThreadStabilityDiagnostic(rawMessage);
        const staleRecoveryClassification =
          classifyStaleThreadRecovery(rawMessage);
        const firstPacketTimeoutSeconds =
          resolveRecoverableCodexFirstPacketTimeout(resolvedEngine, rawMessage);
        if (firstPacketTimeoutSeconds) {
          const warningMessage = t("threads.firstPacketTimeout", {
            seconds: firstPacketTimeoutSeconds,
          });
          onDebug?.({
            id: `${Date.now()}-client-turn-start-timeout-warning`,
            timestamp: Date.now(),
            source: "client",
            label: "turn/start delayed",
            payload: {
              threadId,
              engine: resolvedEngine,
              timeoutSeconds: firstPacketTimeoutSeconds,
            },
          });
          pushErrorToast({
            title: t("common.warning"),
            message: warningMessage,
            durationMs: 4800,
          });
          pushThreadErrorMessage(workspace.id, threadId, warningMessage);
          markProcessing(threadId, false);
          setActiveTurnId(threadId, null);
          safeMessageActivity();
          return;
        }
        const normalized = mapNetworkErrorToUserMessage(rawMessage, t);
        markProcessing(threadId, false);
        setActiveTurnId(threadId, null);
        onDebug?.({
          id: `${Date.now()}-client-turn-start-error`,
          timestamp: Date.now(),
          source: "error",
          label: "turn/start error",
          payload: {
            rawMessage,
            category: stabilityDiagnostic?.category ?? null,
            recoveryReason: stabilityDiagnostic?.reconnectReason ?? null,
          },
        });
        pushThreadErrorMessage(workspace.id, threadId, normalized.message);
        if (normalized.isNetwork || staleRecoveryClassification) {
          pushThreadFailureRuntimeNotice({
            workspaceId: workspace.id,
            threadId,
            engine: resolvedEngine,
            message: normalized.message,
            reasonCode: staleRecoveryClassification?.reasonCode ?? null,
            userAction: staleRecoveryClassification?.userAction ?? null,
          });
        }
        if (normalized.isNetwork) {
          pushErrorToast({
            title: t("common.error"),
            message: normalized.message,
            durationMs: 4800,
          });
        }
        safeMessageActivity();
        if (threadKind === "shared") {
          return {
            status: "ambiguous-error",
            reason: rawMessage,
          };
        }
      }
    },
    [
      accessMode,
      activeEngine,
      activeTurnIdByThread,
      collaborationMode,
      claudeCandidateSessionIdByPendingThreadRef,
      claudePendingThreadAwaitingNativeSessionRef,
      claudeThinkingVisible,
      customPrompts,
      codexAcceptedTurnByThread,
      createRecoveryAttempt,
      dispatch,
      effort,
      finalizeCodexPendingThread,
      geminiSessionIdByPendingThreadRef,
      grokSessionIdByPendingThreadRef,
      kimiSessionIdByPendingThreadRef,
      getCustomName,
      getThreadEngine,
      isClaudePendingThreadAwaitingNativeSession,
      markProcessing,
      model,
      onDebug,
      onInputMemoryCaptured,
      onSharedDurableTurnCommitted,
      itemsByThread,
      interruptedThreadsRef,
      pendingInterruptsRef,
      pushThreadErrorMessage,
      recordThreadActivity,
      reconcileClaudePendingThreadFromCandidate,
      resolveComposerSelection,
      getThreadProviderProfileId,
      resolveThreadKind,
      resolveThreadEngine,
      resolveOpenCodeAgent,
      resolveOpenCodeVariant,
      forkThreadForWorkspace,
      refreshThread,
      safeMessageActivity,
      setActiveTurnId,
      startThreadForMessageSend,
      i18n,
      steerEnabled,
      t,
      threadStatusById,
    ],
  );
  sendMessageToThreadRef.current = sendMessageToThread;

  const sendUserMessage = useCallback(
    async (
      text: string,
      images: string[] = [],
      options?: SendMessageOptions,
    ) => {
      if (!activeWorkspace) {
        return;
      }
      const messageText = text.trim();
      if (!messageText && images.length === 0) {
        return;
      }
      const promptExpansion = expandCustomPromptText(
        messageText,
        customPrompts,
      );
      if (promptExpansion && "error" in promptExpansion) {
        if (activeThreadId) {
          pushThreadErrorMessage(
            activeWorkspace.id,
            activeThreadId,
            promptExpansion.error,
          );
          safeMessageActivity();
        } else {
          onDebug?.({
            id: `${Date.now()}-client-prompt-expand-error`,
            timestamp: Date.now(),
            source: "error",
            label: "prompt/expand error",
            payload: promptExpansion.error,
          });
        }
        return;
      }
      const finalText = promptExpansion?.expanded ?? messageText;

      // Detect engine switch from the selected engine to thread ownership.
      const createSessionTarget = options?.createSessionTarget ?? null;
      const currentEngine = normalizeEngineSelection(
        createSessionTarget?.engine ?? options?.engineOverride ?? activeEngine,
      );
      const resolvedComposerSelection = resolveComposerSelection?.() ?? null;
      const firstSendProviderProfileId = createSessionTarget
        ? createSessionTarget.providerProfileId?.trim() || null
        : currentEngine === "codex"
          ? resolvedComposerSelection?.providerProfileId?.trim() || null
          : null;
      const firstSendThreadOptions = firstSendProviderProfileId
        ? { providerProfileId: firstSendProviderProfileId }
        : undefined;
      const firstSendMessageOptions = createSessionTarget
        ? {
            ...options,
            model: createSessionTarget.model,
            effort: createSessionTarget.effort,
          }
        : options;
      if (activeThreadId) {
        const storedThreadEngine = getThreadEngine(
          activeWorkspace.id,
          activeThreadId,
        );
        const threadKind = resolveThreadKind(
          activeWorkspace.id,
          activeThreadId,
        );
        const threadEngine = resolveThreadEngine(
          activeWorkspace.id,
          activeThreadId,
        );
        if (threadKind !== "shared") {
          assertEngineExecutionEnabled(threadEngine);
        }
        const threadIdCompatible = isThreadIdCompatibleWithEngine(
          currentEngine,
          activeThreadId,
        );
        if (threadKind === "shared") {
          await sendMessageToThread(
            activeWorkspace,
            activeThreadId,
            finalText,
            images,
            {
              ...options,
              skipPromptExpansion: true,
            },
          );
          return;
        }
        assertEngineExecutionEnabled(currentEngine);
        // If current thread differs from current selection, or threadId prefix is incompatible, create a new thread.
        if (threadEngine !== currentEngine || !threadIdCompatible) {
          onDebug?.({
            id: `${Date.now()}-client-engine-switch`,
            timestamp: Date.now(),
            source: "client",
            label: "engine/switch",
            payload: {
              workspaceId: activeWorkspace.id,
              oldThreadId: activeThreadId,
              oldEngineFromStore: storedThreadEngine ?? null,
              oldEngine: threadEngine,
              newEngine: currentEngine,
              threadIdCompatible,
            },
          });
          // Create a new thread with the current engine
          const newThreadId = await startThreadForMessageSend(
            activeWorkspace,
            currentEngine,
            firstSendThreadOptions,
          );
          if (!newThreadId) {
            return;
          }
          // Send message to the new thread
          await sendMessageToThread(
            activeWorkspace,
            newThreadId,
            finalText,
            images,
            {
              ...firstSendMessageOptions,
              skipPromptExpansion: true,
            },
          );
          return;
        }
      }

      // No engine switch, proceed normally
      assertEngineExecutionEnabled(currentEngine);
      const threadId = activeThreadId
        ? await ensureThreadForActiveWorkspace()
        : await startThreadForMessageSend(
            activeWorkspace,
            currentEngine,
            firstSendThreadOptions,
          );
      if (!threadId) {
        return;
      }
      await sendMessageToThread(activeWorkspace, threadId, finalText, images, {
        ...firstSendMessageOptions,
        skipPromptExpansion: true,
      });
    },
    [
      activeEngine,
      activeThreadId,
      activeWorkspace,
      customPrompts,
      ensureThreadForActiveWorkspace,
      isThreadIdCompatibleWithEngine,
      normalizeEngineSelection,
      onDebug,
      pushThreadErrorMessage,
      getThreadEngine,
      resolveThreadKind,
      resolveThreadEngine,
      resolveComposerSelection,
      safeMessageActivity,
      sendMessageToThread,
      startThreadForMessageSend,
    ],
  );

  const sendUserMessageToThread = useCallback(
    async (
      workspace: WorkspaceInfo,
      threadId: string,
      text: string,
      images: string[] = [],
      options?: SendMessageOptions,
    ) => {
      return sendMessageToThread(workspace, threadId, text, images, options);
    },
    [sendMessageToThread],
  );

  const handleFusionStalled = useCallback(
    (threadId: string, options?: HandleFusionStalledOptions) => {
      if (!activeWorkspace || !threadId) {
        return;
      }
      dispatch({
        type: "settleThreadPlanInProgress",
        threadId,
        targetStatus: "pending",
      });
      dispatch({
        type: "markContextCompacting",
        threadId,
        isCompacting: false,
        timestamp: Date.now(),
      });
      markProcessing(threadId, false);
      markReviewing(threadId, false);
      setActiveTurnId(threadId, null);
      pushThreadErrorMessage(
        activeWorkspace.id,
        threadId,
        options?.message?.trim() || t("threads.fusionTurnStalled"),
      );
      safeMessageActivity();
    },
    [
      activeWorkspace,
      dispatch,
      markProcessing,
      markReviewing,
      pushThreadErrorMessage,
      safeMessageActivity,
      setActiveTurnId,
      t,
    ],
  );

  const interruptTurn = useCallback(
    async (options?: InterruptTurnOptions) => {
      if (!activeWorkspace || !activeThreadId) {
        return;
      }
      const reason = options?.reason ?? "user-stop";
      const activeThreadKind = resolveThreadKind(
        activeWorkspace.id,
        activeThreadId,
      );
      const usesSharedV2Control =
        activeThreadKind === "shared" && isSharedV2SendEnabled();
      const sharedAttemptId = usesSharedV2Control
        ? getSharedSendActiveAttemptId(activeWorkspace.id, activeThreadId)
        : null;
      const activeTurnId = activeTurnIdByThread[activeThreadId] ?? null;
      const activeThreadIsProcessing =
        threadStatusById[activeThreadId]?.isProcessing ?? false;
      if (!activeTurnId && !activeThreadIsProcessing && !usesSharedV2Control) {
        onDebug?.({
          id: `${Date.now()}-client-turn-interrupt-skipped`,
          timestamp: Date.now(),
          source: "client",
          label: "turn/interrupt skipped",
          payload: {
            workspaceId: activeWorkspace.id,
            threadId: activeThreadId,
            reason,
            cause: "no-active-or-processing-turn",
          },
        });
        return;
      }
      if (usesSharedV2Control && !sharedAttemptId) {
        const sharedSendState = getSharedSendState(
          activeWorkspace.id,
          activeThreadId,
        ).state;
        if (
          sharedSendState === "idle" &&
          (activeTurnId || activeThreadIsProcessing)
        ) {
          // canonical commit 已把 Shared send state 收口并释放 Attempt；此时只剩
          // frontend lifecycle residue。它不再需要、也不允许触发 Runtime interrupt。
          markProcessing(activeThreadId, false);
          setActiveTurnId(activeThreadId, null);
          onDebug?.({
            id: `${Date.now()}-client-shared-turn-residue-converged`,
            timestamp: Date.now(),
            source: "client",
            label: "shared-session/turn residue converged",
            payload: {
              workspaceId: activeWorkspace.id,
              threadId: activeThreadId,
              reason,
              sharedSendState,
            },
          });
          return;
        }
        onDebug?.({
          id: `${Date.now()}-client-turn-interrupt-skipped`,
          timestamp: Date.now(),
          source: "client",
          label: "turn/interrupt skipped",
          payload: {
            workspaceId: activeWorkspace.id,
            threadId: activeThreadId,
            reason,
            cause: "shared-attempt-owner-missing",
            sharedSendState,
          },
        });
        return;
      }
      if (sharedAttemptId) {
        try {
          const interruptResult = await sharedSessionV2InterruptTurnService(
            activeWorkspace.id,
            activeThreadId,
            sharedAttemptId,
          );
          if (interruptResult.status === "terminal-committed") {
            dispatchSharedSendEvent(activeWorkspace.id, activeThreadId, {
              type: "terminalCommitted",
            });
            setSharedSendActiveAttempt(
              activeWorkspace.id,
              activeThreadId,
              null,
            );
            markProcessing(activeThreadId, false);
            setActiveTurnId(activeThreadId, null);
            return;
          }
        } catch (error) {
          onDebug?.({
            id: `${Date.now()}-client-turn-interrupt-error`,
            timestamp: Date.now(),
            source: "error",
            label: "turn/interrupt error",
            payload: error instanceof Error ? error.message : String(error),
          });
          return;
        }
      }
      const turnId = activeTurnId ?? "pending";
      const shouldGuardInterruptedThread = reason !== "queue-fusion";
      // A4 live-text 外部化：中断前把通道里「尚未落 reducer 的尾段」灌回 items，
      // 否则中断后该行会从通道全量文本回退到壳首段。hasCustomName: true 表示
      // 灌回不参与线程自动命名。
      const liveTextTail = drainLiveAssistantTextTail(activeThreadId);
      if (liveTextTail) {
        dispatch({
          type: "appendAgentDelta",
          workspaceId: activeWorkspace.id,
          threadId: activeThreadId,
          itemId: liveTextTail.itemId,
          delta: liveTextTail.tailDelta,
          hasCustomName: true,
        });
      }
      // Queue fusion immediately starts a successor turn on the same curtain; a
      // long-lived interrupted guard would drop that successor's realtime output.
      if (shouldGuardInterruptedThread) {
        workspaceScopedSet(
          interruptedThreadsRef.current,
          activeWorkspace.id,
          activeThreadId,
          true,
        );
      }
      markProcessing(activeThreadId, false);
      setActiveTurnId(activeThreadId, null);
      const interruptNotice =
        reason === "queue-fusion"
          ? t("threads.sessionStoppedForFusion")
          : reason === "plan-handoff"
            ? null
            : t("threads.sessionStopped");
      if (interruptNotice) {
        dispatch({
          type: "addAssistantMessage",
          threadId: activeThreadId,
          text: interruptNotice,
        });
      }
      if (!activeTurnId && shouldGuardInterruptedThread) {
        workspaceScopedSet(
          pendingInterruptsRef.current,
          activeWorkspace.id,
          activeThreadId,
          true,
        );
      }

      // Determine whether this thread is backed by a local CLI session.
      const resolvedThreadEngine = resolveThreadEngine(
        activeWorkspace.id,
        activeThreadId,
      );
      const isCliManagedEngine = resolvedThreadEngine !== "codex";

      onDebug?.({
        id: `${Date.now()}-client-turn-interrupt`,
        timestamp: Date.now(),
        source: "client",
        label: "turn/interrupt",
        payload: {
          workspaceId: activeWorkspace.id,
          threadId: activeThreadId,
          turnId,
          queued: !activeTurnId,
          engine: resolvedThreadEngine,
          reason,
        },
      });
      try {
        const sharedProviderProfileId =
          activeThreadKind === "shared"
            ? (getSharedTargetState(activeWorkspace.id, activeThreadId)
                .activeTurnTarget?.providerProfileId ?? null)
            : null;
        if (usesSharedV2Control) {
          // Shared V2 已由 durable attempt owner 精确中断；禁止再走 mutable
          // target / workspace-wide fallback 产生第二次 control side effect。
          onDebug?.({
            id: `${Date.now()}-server-turn-interrupt`,
            timestamp: Date.now(),
            source: "server",
            label: "turn/interrupt response",
            payload: { success: true },
          });
          return;
        }
        if (isCliManagedEngine) {
          // Claude/OpenCode/Gemini: target only the current turn process.
          // If turn id is not known yet, keep pending interrupt and let onTurnStarted
          // execute a precise kill once the backend emits the real turn id.
          if (activeTurnId) {
            try {
              if (activeThreadKind === "shared") {
                await engineInterruptTurnService(
                  activeWorkspace.id,
                  activeTurnId,
                  resolvedThreadEngine,
                  sharedProviderProfileId,
                );
              } else {
                await engineInterruptTurnService(
                  activeWorkspace.id,
                  activeTurnId,
                  resolvedThreadEngine,
                );
              }
            } catch (error) {
              if (isUnknownEngineInterruptTurnMethodError(error)) {
                // Compatibility fallback for stale daemon/runtime that doesn't
                // implement engine_interrupt_turn yet.
                await engineInterruptService(activeWorkspace.id);
              } else {
                throw error;
              }
            }
          }
        } else {
          // Codex: notify daemon via turn_interrupt RPC, plus engine_interrupt fallback.
          // B.5：Shared Thread 按 active Turn 的 Execution Target provider 路由，
          // 避免同 engine 双 Provider 并行时中断打到 default Provider 会话。
          await Promise.allSettled([
            interruptTurnService(
              activeWorkspace.id,
              activeThreadId,
              turnId,
              sharedProviderProfileId,
            ),
            engineInterruptService(activeWorkspace.id),
          ]);
        }
        onDebug?.({
          id: `${Date.now()}-server-turn-interrupt`,
          timestamp: Date.now(),
          source: "server",
          label: "turn/interrupt response",
          payload: { success: true },
        });
      } catch (error) {
        onDebug?.({
          id: `${Date.now()}-client-turn-interrupt-error`,
          timestamp: Date.now(),
          source: "error",
          label: "turn/interrupt error",
          payload: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [
      activeThreadId,
      activeTurnIdByThread,
      activeWorkspace,
      dispatch,
      interruptedThreadsRef,
      markProcessing,
      onDebug,
      pendingInterruptsRef,
      resolveThreadEngine,
      resolveThreadKind,
      setActiveTurnId,
      t,
      threadStatusById,
    ],
  );

  const startReviewTarget = useCallback(
    async (
      target: ReviewTarget,
      workspaceIdOverride?: string,
    ): Promise<boolean> => {
      const workspaceId = workspaceIdOverride ?? activeWorkspace?.id ?? null;
      if (!workspaceId) {
        return false;
      }
      let threadId = workspaceIdOverride
        ? await ensureThreadForWorkspace(workspaceId)
        : await ensureThreadForActiveWorkspace();
      if (!threadId) {
        return false;
      }
      const reviewExecutionEngine: "claude" | "codex" =
        activeEngine === "claude" ? "claude" : "codex";
      const threadEngine = resolveThreadEngine(workspaceId, threadId);
      const reviewAutoSession: AutoSessionMetadata = {
        sessionPurpose: "review-fallback",
        visibility: "system-auto",
        ownerFeature: "review",
        autoArchive: false,
        createdBy: "system",
      };
      const threadIdCompatible = isThreadIdCompatibleWithEngine(
        reviewExecutionEngine,
        threadId,
      );
      if (threadEngine !== reviewExecutionEngine || !threadIdCompatible) {
        onDebug?.({
          id: `${Date.now()}-client-review-thread-rebind`,
          timestamp: Date.now(),
          source: "client",
          label: "review/thread rebind",
          payload: {
            workspaceId,
            originalThreadId: threadId,
            originalThreadEngine: threadEngine,
            threadIdCompatible,
            targetEngine: reviewExecutionEngine,
          },
        });
        const reviewThreadId = await startThreadForWorkspace(workspaceId, {
          activate: workspaceId === activeWorkspace?.id,
          engine: reviewExecutionEngine,
          autoSession: reviewAutoSession,
        });
        if (!reviewThreadId) {
          return false;
        }
        threadId = reviewThreadId;
      }

      if (reviewExecutionEngine === "claude") {
        const reviewWorkspace =
          activeWorkspace && activeWorkspace.id === workspaceId
            ? activeWorkspace
            : null;
        if (!reviewWorkspace) {
          return false;
        }
        const reviewCommand = buildReviewCommandText(target);
        onDebug?.({
          id: `${Date.now()}-client-review-start`,
          timestamp: Date.now(),
          source: "client",
          label: "review/start (cli command)",
          payload: {
            workspaceId,
            threadId,
            target,
            command: reviewCommand,
            engine: "claude",
          },
        });
        await sendMessageToThread(
          reviewWorkspace,
          threadId,
          reviewCommand,
          [],
          {
            skipPromptExpansion: true,
            autoSession: reviewAutoSession,
          },
        );
        return true;
      }

      markProcessing(threadId, true);
      markReviewing(threadId, true);
      safeMessageActivity();
      let reviewThreadId = threadId;
      onDebug?.({
        id: `${Date.now()}-client-review-start`,
        timestamp: Date.now(),
        source: "client",
        label: "review/start",
        payload: {
          workspaceId,
          threadId,
          target,
        },
      });
      try {
        const runStartReview = async (
          targetThreadId: string,
          label:
            | "review/start response"
            | "review/start retry response" = "review/start response",
        ) => {
          const response = await startReviewService(
            workspaceId,
            targetThreadId,
            target,
            "inline",
          );
          onDebug?.({
            id: `${Date.now()}-server-review-start`,
            timestamp: Date.now(),
            source: "server",
            label,
            payload: response,
          });
          return response;
        };

        let response = await runStartReview(reviewThreadId);
        let rpcError = extractRpcErrorMessage(response);

        if (rpcError && isInvalidReviewThreadIdError(rpcError)) {
          const fallbackThreadId = await startThreadForWorkspace(workspaceId, {
            activate: workspaceId === activeWorkspace?.id,
            engine: "codex",
            autoSession: reviewAutoSession,
          });
          if (fallbackThreadId && fallbackThreadId !== reviewThreadId) {
            onDebug?.({
              id: `${Date.now()}-client-review-thread-retry`,
              timestamp: Date.now(),
              source: "client",
              label: "review/thread retry",
              payload: {
                workspaceId,
                originalThreadId: reviewThreadId,
                fallbackThreadId,
                reason: rpcError,
              },
            });
            markProcessing(reviewThreadId, false);
            markReviewing(reviewThreadId, false);
            reviewThreadId = fallbackThreadId;
            markProcessing(reviewThreadId, true);
            markReviewing(reviewThreadId, true);
            response = await runStartReview(
              reviewThreadId,
              "review/start retry response",
            );
            rpcError = extractRpcErrorMessage(response);
          }
        }
        if (rpcError) {
          markProcessing(reviewThreadId, false);
          markReviewing(reviewThreadId, false);
          setActiveTurnId(reviewThreadId, null);
          pushThreadErrorMessage(
            workspaceId,
            reviewThreadId,
            `Review failed to start: ${rpcError}`,
          );
          safeMessageActivity();
          return false;
        }
        return true;
      } catch (error) {
        markProcessing(reviewThreadId, false);
        markReviewing(reviewThreadId, false);
        onDebug?.({
          id: `${Date.now()}-client-review-start-error`,
          timestamp: Date.now(),
          source: "error",
          label: "review/start error",
          payload: error instanceof Error ? error.message : String(error),
        });
        pushThreadErrorMessage(
          workspaceId,
          reviewThreadId,
          error instanceof Error ? error.message : String(error),
        );
        safeMessageActivity();
        return false;
      }
    },
    [
      activeEngine,
      activeWorkspace,
      ensureThreadForActiveWorkspace,
      ensureThreadForWorkspace,
      isThreadIdCompatibleWithEngine,
      markProcessing,
      markReviewing,
      onDebug,
      pushThreadErrorMessage,
      resolveThreadEngine,
      safeMessageActivity,
      sendMessageToThread,
      setActiveTurnId,
      startThreadForWorkspace,
    ],
  );

  const {
    reviewPrompt,
    openReviewPrompt,
    closeReviewPrompt,
    showPresetStep,
    choosePreset,
    highlightedPresetIndex,
    setHighlightedPresetIndex,
    highlightedBranchIndex,
    setHighlightedBranchIndex,
    highlightedCommitIndex,
    setHighlightedCommitIndex,
    handleReviewPromptKeyDown,
    confirmBranch,
    selectBranch,
    selectBranchAtIndex,
    selectCommit,
    selectCommitAtIndex,
    confirmCommit,
    updateCustomInstructions,
    confirmCustom,
  } = useReviewPrompt({
    activeWorkspace,
    activeThreadId,
    onDebug,
    startReviewTarget,
  });

  const startReview = useCallback(
    async (text: string) => {
      if (!activeWorkspace || !text.trim()) {
        return;
      }
      const trimmed = text.trim();
      if (!trimmed.startsWith("/")) {
        return;
      }
      const commandToken =
        trimmed.slice(1).split(/\s+/, 1)[0]?.toLowerCase() ?? "";
      if (commandToken !== "review") {
        return;
      }
      const rest = trimmed.slice(commandToken.length + 1).trim();
      if (!rest) {
        openReviewPrompt();
        return;
      }

      const target = parseReviewTarget(trimmed);
      await startReviewTarget(target);
    },
    [activeWorkspace, openReviewPrompt, startReviewTarget],
  );

  const {
    startCompact,
    startContext,
    startExport,
    startFast,
    startFork,
    startImport,
    startLsp,
    startMcp,
    startMode,
    startResume,
    startShare,
    startSpecRoot,
    startStatus,
  } = useThreadMessagingSessionTooling({
    activeThreadId,
    activeWorkspace,
    accessMode,
    collaborationMode,
    dispatch,
    effort,
    ensureThreadForActiveWorkspace,
    forkThreadForWorkspace,
    getCustomName,
    isThreadIdCompatibleWithEngine,
    model,
    onDebug,
    pushThreadErrorMessage,
    rateLimitsByWorkspace,
    recordThreadActivity,
    refreshThread,
    resolveCollaborationRuntimeMode,
    resolveComposerSelection,
    resolveThreadEngine,
    resolveThreadKind,
    safeMessageActivity,
    sendMessageToThread,
    sessionSpecLinkByThreadRef,
    t,
    threadStatusById,
    codexCompactionInFlightByThreadRef:
      effectiveCodexCompactionInFlightByThreadRef,
    tokenUsageByThread,
  });

  return {
    handleFusionStalled,
    interruptTurn,
    sendUserMessage,
    sendUserMessageToThread,
    startFork,
    startReview,
    startResume,
    startMcp,
    startSpecRoot,
    startStatus,
    startContext,
    startCompact,
    startFast,
    startMode,
    startExport,
    startImport,
    startLsp,
    startShare,
    reviewPrompt,
    openReviewPrompt,
    closeReviewPrompt,
    showPresetStep,
    choosePreset,
    highlightedPresetIndex,
    setHighlightedPresetIndex,
    highlightedBranchIndex,
    setHighlightedBranchIndex,
    highlightedCommitIndex,
    setHighlightedCommitIndex,
    handleReviewPromptKeyDown,
    confirmBranch,
    selectBranch,
    selectBranchAtIndex,
    selectCommit,
    selectCommitAtIndex,
    confirmCommit,
    updateCustomInstructions,
    confirmCustom,
  };
}
