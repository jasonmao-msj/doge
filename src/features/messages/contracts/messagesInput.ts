import type { ConversationState } from "../../threads/contracts/conversationCurtainContracts";
import type { MessagesProps } from "../types/messagesTypes";

export type MessagesConversationInput = {
  state: ConversationState;
  workspacePath: MessagesProps["workspacePath"];
};

export type MessagesRuntimeInput = Pick<
  MessagesProps,
  | "isHistoryLoading"
  | "historyLoadingProgress"
  | "historyRecoveryFailureReason"
  | "isContextCompacting"
  | "proxyEnabled"
  | "proxyUrl"
  | "processingStartedAt"
  | "lastDurationMs"
  | "codexSilentSuspectedAt"
  | "approvals"
  | "taskRuns"
>;

export type MessagesInteractionInput = Pick<
  MessagesProps,
  | "onRetryHistory"
  | "onUserInputSubmit"
  | "onUserInputDismiss"
  | "onApprovalDecision"
  | "onApprovalBatchAccept"
  | "onApprovalRemember"
  | "onOpenDiffPath"
  | "onPreviewFileDiff"
  | "onOpenPlanPanel"
  | "onExitPlanModeExecute"
  | "onOpenWorkspaceFile"
  | "onCaptureNote"
  | "onSaveAsPrompt"
  | "onRecoverThreadRuntime"
  | "onRecoverThreadRuntimeAndResend"
  | "onThreadRecoveryFork"
  | "onForkFromMessage"
  | "onRewindFromMessage"
>;

export type MessagesPresentationInput = Pick<
  MessagesProps,
  | "openTargets"
  | "selectedOpenAppId"
  | "showMessageAnchors"
  | "codeBlockCopyUseModifier"
  | "workspaces"
  | "claudeThinkingVisible"
  | "activeCollaborationModeId"
  | "isPlanMode"
  | "isPlanProcessing"
  | "presentationProfile"
  | "agentTaskScrollRequest"
  | "timelineLeadingNode"
  | "timelineTrailingNode"
  | "renderHistoryFold"
  | "isProviderContinuation"
>;

export type MessagesCoreProps = {
  conversation: MessagesConversationInput;
  runtime: MessagesRuntimeInput;
  interactions: MessagesInteractionInput;
  presentation: MessagesPresentationInput;
};

function hasScopeMismatch(
  activeScope: string | null | undefined,
  canonicalScope: string | null | undefined,
) {
  return Boolean(activeScope && canonicalScope && activeScope !== canonicalScope);
}

function buildLegacyConversationState(props: MessagesProps): ConversationState {
  const isWorking = props.isThinking || Boolean(props.isContextCompacting);
  return {
    items: props.items,
    plan: props.plan ?? null,
    userInputQueue: props.userInputRequests ?? [],
    meta: {
      workspaceId: props.workspaceId ?? "",
      threadId: props.threadId ?? "",
      engine: props.activeEngine ?? "claude",
      activeTurnId: null,
      isThinking: isWorking,
      heartbeatPulse: props.heartbeatPulse ?? 0,
      historyRestoredAtMs: null,
    },
  };
}

export function adaptLegacyMessagesProps(props: MessagesProps): MessagesCoreProps {
  const canonicalState = props.conversationState;
  const state = canonicalState &&
    !hasScopeMismatch(props.workspaceId, canonicalState.meta.workspaceId) &&
    !hasScopeMismatch(props.threadId, canonicalState.meta.threadId)
    ? canonicalState
    : buildLegacyConversationState(props);
  const supportsNativeHistoryMutation =
    !state.meta.threadId.startsWith("shared:");

  return {
    conversation: {
      state,
      workspacePath: props.workspacePath ?? null,
    },
    runtime: {
      isHistoryLoading: props.isHistoryLoading ?? false,
      historyLoadingProgress: props.historyLoadingProgress ?? null,
      historyRecoveryFailureReason: props.historyRecoveryFailureReason ?? null,
      isContextCompacting: props.isContextCompacting ?? false,
      proxyEnabled: props.proxyEnabled ?? false,
      proxyUrl: props.proxyUrl ?? null,
      processingStartedAt: props.processingStartedAt ?? null,
      lastDurationMs: props.lastDurationMs ?? null,
      codexSilentSuspectedAt: props.codexSilentSuspectedAt ?? null,
      approvals: props.approvals ?? [],
      taskRuns: props.taskRuns ?? [],
    },
    interactions: {
      onRetryHistory: props.onRetryHistory,
      onUserInputSubmit: props.onUserInputSubmit,
      onUserInputDismiss: props.onUserInputDismiss,
      onApprovalDecision: props.onApprovalDecision,
      onApprovalBatchAccept: props.onApprovalBatchAccept,
      onApprovalRemember: props.onApprovalRemember,
      onOpenDiffPath: props.onOpenDiffPath,
      onPreviewFileDiff: props.onPreviewFileDiff,
      onOpenPlanPanel: props.onOpenPlanPanel,
      onExitPlanModeExecute: props.onExitPlanModeExecute,
      onOpenWorkspaceFile: props.onOpenWorkspaceFile,
      onCaptureNote: props.onCaptureNote,
      onSaveAsPrompt: props.onSaveAsPrompt,
      onRecoverThreadRuntime: props.onRecoverThreadRuntime,
      onRecoverThreadRuntimeAndResend: props.onRecoverThreadRuntimeAndResend,
      onThreadRecoveryFork: props.onThreadRecoveryFork,
      onForkFromMessage: supportsNativeHistoryMutation
        ? props.onForkFromMessage
        : undefined,
      onRewindFromMessage: supportsNativeHistoryMutation
        ? props.onRewindFromMessage
        : undefined,
    },
    presentation: {
      openTargets: props.openTargets,
      selectedOpenAppId: props.selectedOpenAppId,
      showMessageAnchors: props.showMessageAnchors ?? true,
      codeBlockCopyUseModifier: props.codeBlockCopyUseModifier ?? false,
      workspaces: props.workspaces ?? [],
      claudeThinkingVisible: props.claudeThinkingVisible,
      activeCollaborationModeId: props.activeCollaborationModeId ?? null,
      isPlanMode: props.isPlanMode ?? false,
      isPlanProcessing: props.isPlanProcessing ?? false,
      presentationProfile: props.presentationProfile ?? null,
      agentTaskScrollRequest: props.agentTaskScrollRequest ?? null,
      timelineLeadingNode: props.timelineLeadingNode ?? null,
      timelineTrailingNode: props.timelineTrailingNode ?? null,
      renderHistoryFold: props.renderHistoryFold,
      isProviderContinuation: props.isProviderContinuation ?? false,
    },
  };
}
