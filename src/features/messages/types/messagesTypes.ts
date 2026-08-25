import type {
  AccessMode,
  ApprovalRequest,
  ConversationItem,
  OpenAppTarget,
  QueuedMessage,
  RequestUserInputRequest,
  RequestUserInputResponse,
  RequestUserInputSettlementResult,
  RequestUserInputSettlementOptions,
  TurnPlan,
  WorkspaceInfo,
} from "../../../types";
import type { ReactNode } from "react";
import type { ConversationState } from "../../threads/contracts/conversationCurtainContracts";
import type { PresentationProfile } from "../../../conversation-presentation/presentationProfile";
import type { RuntimeReconnectRecoveryCallbackResult } from "../../../runtime-recovery/runtimeReconnect";
import type { AgentTaskScrollRequest } from "../types";
import type { TaskRunRecord } from "../../tasks/types";
import type { NoteCaptureDraft } from "../../note-cards/types";
import type { HistoryLoadingProgress } from "@/conversation-presentation/historyLoadingProgress";

export type LastVisibleTextReport = {
  itemId: string | null;
  visibleTextLength: number;
  reportedAt: number;
};

export type LastRenderSnapshot = {
  items: ConversationItem[];
  userInputRequests: RequestUserInputRequest[];
  conversationState: ConversationState | null;
  presentationProfile: PresentationProfile | null;
  isThinking: boolean;
  heartbeatPulse: number;
  threadId: string | null;
};

/** Legacy public façade input. MessagesCore consumes the grouped canonical contract. */
export type MessagesProps = {
  items: ConversationItem[];
  threadId: string | null;
  workspaceId?: string | null;
  isThinking: boolean;
  isHistoryLoading?: boolean;
  historyLoadingProgress?: HistoryLoadingProgress | null;
  historyRecoveryFailureReason?: string | null;
  onRetryHistory?: () => void;
  isContextCompacting?: boolean;
  proxyEnabled?: boolean;
  proxyUrl?: string | null;
  processingStartedAt?: number | null;
  lastDurationMs?: number | null;
  heartbeatPulse?: number;
  codexSilentSuspectedAt?: number | null;
  workspacePath?: string | null;
  openTargets: OpenAppTarget[];
  selectedOpenAppId: string;
  showMessageAnchors?: boolean;
  codeBlockCopyUseModifier?: boolean;
  userInputRequests?: RequestUserInputRequest[];
  approvals?: ApprovalRequest[];
  workspaces?: WorkspaceInfo[];
  onUserInputSubmit?: (
    request: RequestUserInputRequest,
    response: RequestUserInputResponse,
    options?: RequestUserInputSettlementOptions,
  ) => Promise<RequestUserInputSettlementResult | void> | RequestUserInputSettlementResult | void;
  onUserInputDismiss?: (
    request: RequestUserInputRequest,
    options?: RequestUserInputSettlementOptions,
  ) => Promise<RequestUserInputSettlementResult | void> | RequestUserInputSettlementResult | void;
  onApprovalDecision?: (
    request: ApprovalRequest,
    decision: "accept" | "decline" | "dismiss",
  ) => void;
  onApprovalBatchAccept?: (requests: ApprovalRequest[]) => void;
  onApprovalRemember?: (request: ApprovalRequest, command: string[]) => void;
  activeEngine?: "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode";
  claudeThinkingVisible?: boolean;
  activeCollaborationModeId?: string | null;
  plan?: TurnPlan | null;
  isPlanMode?: boolean;
  isPlanProcessing?: boolean;
  onOpenDiffPath?: (path: string) => void;
  onPreviewFileDiff?: (path: string) => void;
  onOpenPlanPanel?: () => void;
  onExitPlanModeExecute?: (
    mode: Extract<AccessMode, "default" | "full-access">,
  ) => Promise<void> | void;
  conversationState?: ConversationState | null;
  presentationProfile?: PresentationProfile | null;
  onOpenWorkspaceFile?: (path: string) => void;
  onCaptureNote?: (draft: NoteCaptureDraft) => void;
  onSaveAsPrompt?: (sourceText: string) => void;
  agentTaskScrollRequest?: AgentTaskScrollRequest | null;
  onRecoverThreadRuntime?: (
    workspaceId: string,
    threadId: string,
  ) => Promise<RuntimeReconnectRecoveryCallbackResult> | RuntimeReconnectRecoveryCallbackResult;
  onRecoverThreadRuntimeAndResend?: (
    workspaceId: string,
    threadId: string,
    message: Pick<QueuedMessage, "text" | "images">,
  ) => Promise<RuntimeReconnectRecoveryCallbackResult> | RuntimeReconnectRecoveryCallbackResult;
  onThreadRecoveryFork?: () =>
    | Promise<RuntimeReconnectRecoveryCallbackResult>
    | RuntimeReconnectRecoveryCallbackResult;
  onForkFromMessage?: (messageId: string) => void;
  onRewindFromMessage?: (messageId: string) => void;
  taskRuns?: TaskRunRecord[];
  /** 稳定 metadata slot；不得承载普通 message/streaming lifecycle。 */
  timelineLeadingNode?: ReactNode;
  /**
   * 时间线尾部 slot（落在 messages.scrollable 内、时间线之后）。
   * 用于协作终态 HistoryFold 等需随主幕布滚动的 UI，勿放 sticky 区。
  */
  timelineTrailingNode?: ReactNode;
  /** Host-owned renderer for peer feature history-fold rows. */
  renderHistoryFold?: (itemId: string) => ReactNode;
  /** Catalog authoritative origin；仅用于 Provider Continuation presentation gate。 */
  isProviderContinuation?: boolean;
};
