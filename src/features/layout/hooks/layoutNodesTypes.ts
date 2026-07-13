import type { DragEvent, MouseEvent, ReactNode, RefObject } from "react";
import type { ProjectMapDatasetController } from "../../project-map";
import type {
  IntentCanvasCodeSelectionAnchor,
  IntentCanvasDocument,
  IntentCanvasOpenRequest,
} from "../../intent-canvas/types";
import type { OrchestrationDispatchConfirmation } from "../../agent-orchestration";
import type { AgentTaskScrollRequest } from "../../messages/types";
import type { SubagentInfo } from "../../status-panel/types";
import type {
  EditorHighlightTarget,
  EditorNavigationLocation,
  EditorNavigationTarget,
  CenterMode,
  OpenFileOptions,
} from "../../app/hooks/useGitPanelController";
import type { FileCompareSession } from "../../files/types/fileCompare";
import type {
  ReviewPromptState,
  ReviewPromptStep,
} from "../../threads/hooks/useReviewPrompt";
import type { WorkspaceLaunchScriptsState } from "../../app/hooks/useWorkspaceLaunchScripts";
import type { OpenAppMenuExtraAction } from "../../app/components/OpenAppMenu";
import type {
  AccessMode,
  AppMode,
  ApprovalRequest,
  BranchInfo,
  CollaborationModeOption,
  ConversationItem,
  ComposerEditorSettings,
  CustomCommandOption,
  CustomPromptOption,
  AccountSnapshot,
  DebugEntry,
  DictationSessionState,
  DictationTranscript,
  EngineType,
  GitFileStatus,
  GitHubIssue,
  GitHubPullRequestComment,
  GitHubPullRequest,
  GitLogEntry,
  MessageSendOptions,
  ModelOption,
  OpenCodeAgentOption,
  OpenAppTarget,
  QueuedMessage,
  RateLimitSnapshot,
  RequestUserInputRequest,
  RequestUserInputResponse,
  RequestUserInputSettlementResult,
  RequestUserInputSettlementOptions,
  SkillOption,
  SelectedAgentOption,
  ThreadSummary,
  ThreadTokenUsage,
  TurnPlan,
  WorkspaceInfo,
} from "../../../types";
import type { EngineDisplayInfo } from "../../engine/hooks/useEngineController";
import type { UpdateState } from "../../update/hooks/useUpdater";
import type { TerminalSessionState } from "../../terminal/hooks/useTerminalSession";
import type { TerminalTab } from "../../terminal/hooks/useTerminalTabs";
import type { ErrorToast } from "../../../services/toasts";
import type { LoadingProgressDialogConfig } from "../../app/hooks/useLoadingProgressDialogState";
import type { WorkspaceDirectoryEntry } from "../../../services/tauri";
import type { CodeAnnotationBridgeProps } from "../../code-annotations/types";
import type { RuntimeReconnectRecoveryCallbackResult } from "../../messages/components/runtimeReconnect";
import type { QueuedHandoffBubble } from "../../threads/utils/queuedHandoffBubble";
import type { SessionRadarEntry } from "../../session-activity/hooks/useSessionRadarFeed";
import type { CodexProviderProfileSelection } from "../../threads/constants/codexProviderProfiles";

export type ThreadActivityStatus = {
  isProcessing: boolean;
  hasUnread: boolean;
  isReviewing: boolean;
  isContextCompacting?: boolean;
  processingStartedAt?: number | null;
  lastDurationMs?: number | null;
  heartbeatPulse?: number;
  codexCompactionSource?: "auto" | "manual" | null;
  codexCompactionLifecycleState?: "idle" | "compacting" | "completed";
  codexCompactionCompletedAt?: number | null;
  lastTokenUsageUpdatedAt?: number | null;
  codexSilentSuspectedAt?: number | null;
  codexSilentSuspectedSource?: string | null;
};

export type GitDiffViewerItem = {
  path: string;
  status: string;
  diff: string;
  isImage?: boolean;
  oldImageData?: string | null;
  newImageData?: string | null;
  oldImageMime?: string | null;
  newImageMime?: string | null;
};

export type GitDiffListView = "flat" | "tree";

export type WorktreeRenameState = {
  name: string;
  error: string | null;
  notice: string | null;
  isSubmitting: boolean;
  isDirty: boolean;
  upstream?: {
    oldBranch: string;
    newBranch: string;
    error: string | null;
    isSubmitting: boolean;
    onConfirm: () => void;
  } | null;
  onFocus: () => void;
  onChange: (value: string) => void;
  onCancel: () => void;
  onCommit: () => void;
};

export type LayoutNodesFlatOptions = {
  workspaces: WorkspaceInfo[];
  groupedWorkspaces: Array<{
    id: string | null;
    name: string;
    workspaces: WorkspaceInfo[];
  }>;
  hasWorkspaceGroups: boolean;
  deletingWorktreeIds: Set<string>;
  threadsByWorkspace: Record<string, ThreadSummary[]>;
  threadParentById: Record<string, string>;
  threadStatusById: Record<string, ThreadActivityStatus>;
  historyLoadingByThreadId: Record<string, boolean>;
  historyRestoredAtMsByThread?: Record<string, number | null | undefined>;
  runningSessionCountByWorkspaceId: Record<string, number>;
  recentCompletedSessionCountByWorkspaceId: Record<string, number>;
  hydratedThreadListWorkspaceIds: ReadonlySet<string>;
  threadListLoadingByWorkspace: Record<string, boolean>;
  threadListPagingByWorkspace: Record<string, boolean>;
  threadListCursorByWorkspace: Record<string, string | null>;
  activeWorkspaceId: string | null;
  activeThreadId: string | null;
  activeTurnId?: string | null;
  systemProxyEnabled?: boolean;
  systemProxyUrl?: string | null;
  activeItems: ConversationItem[];
  activeQueuedHandoffBubble: QueuedHandoffBubble | null;
  threadItemsByThread: Record<string, ConversationItem[]>;
  sessionRadarRunningSessions: SessionRadarEntry[];
  sessionRadarRecentCompletedSessions: SessionRadarEntry[];
  activeRateLimits: RateLimitSnapshot | null;
  usageShowRemaining: boolean;
  showSidebarProviderLabels: boolean;
  onRefreshAccountRateLimits?: () => Promise<void> | void;
  showMessageAnchors: boolean;
  accountInfo: AccountSnapshot | null;
  onSwitchAccount: () => void;
  onCancelSwitchAccount: () => void;
  accountSwitching: boolean;
  codeBlockCopyUseModifier: boolean;
  openAppTargets: OpenAppTarget[];
  openAppIconById: Record<string, string>;
  selectedOpenAppId: string;
  onSelectOpenAppId: (id: string) => void;
  approvals: ApprovalRequest[];
  userInputRequests: RequestUserInputRequest[];
  handleApprovalDecision: (
    request: ApprovalRequest,
    decision: "accept" | "decline" | "dismiss",
  ) => void;
  handleApprovalBatchAccept: (requests: ApprovalRequest[]) => void;
  handleApprovalRemember: (request: ApprovalRequest, command: string[]) => void;
  handleUserInputSubmit: (
    request: RequestUserInputRequest,
    response: RequestUserInputResponse,
    options?: RequestUserInputSettlementOptions,
  ) => Promise<RequestUserInputSettlementResult | void> | RequestUserInputSettlementResult | void;
  handleUserInputDismiss: (
    request: RequestUserInputRequest,
    options?: RequestUserInputSettlementOptions,
  ) => Promise<RequestUserInputSettlementResult | void> | RequestUserInputSettlementResult | void;
  onRecoverThreadRuntime?: (
    workspaceId: string,
    threadId: string,
  ) =>
    | Promise<RuntimeReconnectRecoveryCallbackResult>
    | RuntimeReconnectRecoveryCallbackResult;
  onRecoverThreadRuntimeAndResend?: (
    workspaceId: string,
    threadId: string,
    message: Pick<QueuedMessage, "text" | "images">,
  ) =>
    | Promise<RuntimeReconnectRecoveryCallbackResult>
    | RuntimeReconnectRecoveryCallbackResult;
  onThreadRecoveryFork?: () => Promise<void> | void;
  handleExitPlanModeExecute?: (
    mode: Extract<AccessMode, "default" | "full-access">,
  ) => Promise<void> | void;
  onOpenSettings: () => void;
  onOpenExperimentalSettings: () => void;
  onOpenDictationSettings?: () => void;
  onOpenSkillsSettings?: () => void;
  onOpenDebug: () => void;
  showDebugButton: boolean;
  onAddWorkspace: () => void;
  onSelectHome: () => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onConnectWorkspace: (workspace: WorkspaceInfo) => Promise<void>;
  onAddAgent: (
    workspace: WorkspaceInfo,
    engine?: EngineType,
    options?: { folderId?: string | null } & CodexProviderProfileSelection,
  ) => Promise<string | null>;
  engineOptions?: EngineDisplayInfo[];
  enabledEngines?: Partial<Record<EngineType, boolean>>;
  onRefreshEngineOptions?: () =>
    | Promise<
        | import("../../engine/hooks/useEngineController").EngineRefreshResult
        | void
      >
    | import("../../engine/hooks/useEngineController").EngineRefreshResult
    | void;
  onAddSharedAgent: (workspace: WorkspaceInfo) => Promise<string | null>;
  onAddWorktreeAgent: (workspace: WorkspaceInfo) => Promise<void>;
  onAddCloneAgent: (workspace: WorkspaceInfo) => Promise<void>;
  onToggleWorkspaceCollapse: (workspaceId: string, collapsed: boolean) => void;
  onSelectThread: (workspaceId: string, threadId: string) => void;
  onDeleteThread: (workspaceId: string, threadId: string) => void;
  onArchiveThread: (workspaceId: string, threadId: string) => void;
  deleteConfirmThreadId?: string | null;
  deleteConfirmWorkspaceId?: string | null;
  deleteConfirmBusy?: boolean;
  onCancelDeleteConfirm?: () => void;
  onConfirmDeleteConfirm?: () => void;
  onSyncThread: (workspaceId: string, threadId: string) => void;
  pinThread: (workspaceId: string, threadId: string) => boolean;
  unpinThread: (workspaceId: string, threadId: string) => void;
  isThreadPinned: (workspaceId: string, threadId: string) => boolean;
  isThreadAutoNaming: (workspaceId: string, threadId: string) => boolean;
  getPinTimestamp: (workspaceId: string, threadId: string) => number | null;
  pinnedThreadsVersion: number;
  onRenameThread: (workspaceId: string, threadId: string) => void;
  onAutoNameThread: (workspaceId: string, threadId: string) => void;
  onOpenClaudeTui?: (input: {
    workspaceId: string;
    workspacePath: string;
    sessionId: string;
  }) => void;
  onDeleteWorkspace: (workspaceId: string) => void;
  onDeleteWorktree: (workspaceId: string) => void;
  onRenameWorkspaceAlias: (workspace: WorkspaceInfo) => void;
  onLoadOlderThreads: (workspaceId: string) => void;
  onReloadWorkspaceThreads: (workspaceId: string) => void;
  onQuickReloadWorkspaceThreads?: (workspaceId: string) => void;
  workspaceDropTargetRef: RefObject<HTMLElement | null>;
  isWorkspaceDropActive: boolean;
  workspaceDropText: string;
  onWorkspaceDragOver: (event: DragEvent<HTMLElement>) => void;
  onWorkspaceDragEnter: (event: DragEvent<HTMLElement>) => void;
  onWorkspaceDragLeave: (event: DragEvent<HTMLElement>) => void;
  onWorkspaceDrop: (event: DragEvent<HTMLElement>) => void;
  appMode: AppMode;
  isPhone: boolean;
  isTablet: boolean;
  onAppModeChange: (mode: AppMode) => void;
  onOpenHomeChat: () => void;
  onOpenMemory: () => void;
  onOpenProjectMemory: () => void;
  onOpenContextLedgerMemory?: (memoryId: string) => void;
  onOpenContextLedgerNote?: (noteId: string) => void;
  onOpenReleaseNotes: () => void;
  onOpenGlobalSearch: () => void;
  globalSearchShortcut: string | null;
  openChatShortcut: string | null;
  openKanbanShortcut: string | null;
  showLoadingProgressDialog?: (config: LoadingProgressDialogConfig) => string;
  hideLoadingProgressDialog?: (requestId: string) => void;
  cycleOpenSessionPrevShortcut: string | null;
  cycleOpenSessionNextShortcut: string | null;
  closeCurrentSessionShortcut: string | null;
  saveFileShortcut: string | null;
  findInFileShortcut: string | null;
  toggleGitDiffListViewShortcut: string | null;
  onOpenSpecHub: () => void;
  onOpenWorkspaceHome: () => void;
  updaterState: UpdateState;
  onUpdate: () => void;
  onDismissUpdate: () => void;
  errorToasts: ErrorToast[];
  onDismissErrorToast: (id: string) => void;
  latestAgentRuns: Array<{
    threadId: string;
    message: string;
    timestamp: number;
    projectName: string;
    groupName?: string | null;
    workspaceId: string;
    isProcessing: boolean;
  }>;
  isLoadingLatestAgents: boolean;
  onSelectHomeThread: (workspaceId: string, threadId: string) => void;
  onSelectHomeWorkspace: (workspaceId: string) => void;
  activeWorkspace: WorkspaceInfo | null;
  activeParentWorkspace: WorkspaceInfo | null;
  worktreeLabel: string | null;
  worktreeRename?: WorktreeRenameState;
  isWorktreeWorkspace: boolean;
  branchName: string;
  branches: BranchInfo[];
  onCheckoutBranch: (name: string) => Promise<void>;
  onCreateBranch: (name: string) => Promise<void>;
  onCopyThread: () => void | Promise<void>;
  onLockPanel?: () => void;
  onToggleTerminal: () => void;
  showTerminalButton: boolean;
  launchScript: string | null;
  launchScriptEditorOpen: boolean;
  launchScriptDraft: string;
  launchScriptSaving: boolean;
  launchScriptError: string | null;
  onRunLaunchScript: () => void;
  onOpenLaunchScriptEditor: () => void;
  onCloseLaunchScriptEditor: () => void;
  onLaunchScriptDraftChange: (value: string) => void;
  onSaveLaunchScript: () => void;
  launchScriptsState?: WorkspaceLaunchScriptsState;
  mainHeaderActions?: OpenAppMenuExtraAction[];
  browserDockOpen?: boolean;
  onCloseBrowserDock?: () => void;
  centerMode: CenterMode;
  setCenterMode: (mode: CenterMode) => void;
  fileCompareSession: FileCompareSession | null;
  editorSplitCompanion: "chat" | "projectMap";
  setEditorSplitCompanion: (companion: "chat" | "projectMap") => void;
  editorSplitLayout: "vertical" | "horizontal";
  onToggleEditorSplitLayout: () => void;
  isEditorFileMaximized: boolean;
  onToggleEditorFileMaximized: () => void;
  editorFilePath: string | null;
  editorNavigationTarget: EditorNavigationTarget | null;
  editorHighlightTarget: EditorHighlightTarget | null;
  openEditorTabs: string[];
  onActivateEditorTab: (path: string) => void;
  onCloseEditorTab: (path: string) => void;
  onCloseAllEditorTabs: () => void;
  onActiveEditorLineRangeChange: (
    range: { startLine: number; endLine: number } | null,
  ) => void;
  onOpenFile: (
    path: string,
    location?: EditorNavigationLocation,
    options?: OpenFileOptions,
  ) => void;
  onCompareFiles: (paths: string[]) => boolean;
  onCloseFileCompare: () => void;
  externalChangeMonitoringEnabled?: boolean;
  externalChangeTransportMode?: "watcher" | "polling";
  externalChangeApplyMode?: "auto" | "manual";
  externalChangeAutoApplyDebounceMs?: number;
  liveEditPreviewEnabled?: boolean;
  onToggleLiveEditPreview?: () => void;
  onExitEditor: () => void;
  onExitDiff: () => void;
  activeTab: "projects" | "codex" | "spec" | "git" | "log";
  onSelectTab: (tab: "projects" | "codex" | "spec" | "git" | "log") => void;
  tabletNavTab: "codex" | "spec" | "git" | "log";
  gitPanelMode: "diff" | "log" | "issues" | "prs";
  onGitPanelModeChange: (mode: "diff" | "log" | "issues" | "prs") => void;
  onOpenGitHistoryPanel: () => void;
  onOpenProjectMap: () => void;
  intentCanvasOpenRequest?: IntentCanvasOpenRequest | null;
  onOpenIntentCanvas?: (
    request?: Omit<IntentCanvasOpenRequest, "requestId">,
  ) => void;
  onIntentCanvasOpenRequestConsumed?: (requestId: number) => void;
  onAttachIntentCanvasToThread?: (
    document: IntentCanvasDocument,
  ) => Promise<void> | void;
  pendingIntentCanvasDocuments?: IntentCanvasDocument[];
  onRemovePendingIntentCanvas?: (documentId: string) => void;
  gitDiffViewStyle: "split" | "unified";
  gitDiffListView: GitDiffListView;
  onGitDiffListViewChange: (view: "flat" | "tree") => void;
  worktreeApplyLabel: string;
  worktreeApplyTitle: string | null;
  worktreeApplyLoading: boolean;
  worktreeApplyError: string | null;
  worktreeApplySuccess: boolean;
  onApplyWorktreeChanges?: () => void | Promise<void>;
  filePanelMode:
    | "git"
    | "files"
    | "search"
    | "notes"
    | "prompts"
    | "memory"
    | "activity"
    | "radar"
    | "pluginPreview";
  onFilePanelModeChange: (
    mode:
      | "git"
      | "files"
      | "search"
      | "notes"
      | "prompts"
      | "memory"
      | "activity"
      | "radar"
      | "pluginPreview",
  ) => void;
  focusedProjectMemoryId?: string | null;
  focusedProjectMemoryRequestKey?: number;
  focusedWorkspaceNoteId?: string | null;
  focusedWorkspaceNoteRequestKey?: number;
  fileTreeLoading: boolean;
  fileTreeLoadError?: string | null;
  onRefreshFiles?: () => void;
  onOpenDetachedFileExplorer?: (initialFilePath?: string | null) => void;
  onToggleRuntimeConsole: () => void;
  runtimeConsoleVisible: boolean;
  gitStatus: {
    branchName: string;
    files: GitFileStatus[];
    stagedFiles: GitFileStatus[];
    unstagedFiles: GitFileStatus[];
    totalAdditions: number;
    totalDeletions: number;
    error: string | null;
  };
  fileStatus: string;
  selectedDiffPath: string | null;
  diffScrollRequestId: number;
  onSelectDiff: (path: string | null) => void;
  gitLogEntries: GitLogEntry[];
  gitLogTotal: number;
  gitLogAhead: number;
  gitLogBehind: number;
  gitLogAheadEntries: GitLogEntry[];
  gitLogBehindEntries: GitLogEntry[];
  gitLogUpstream: string | null;
  selectedCommitSha: string | null;
  onSelectCommit: (entry: GitLogEntry) => void;
  gitLogError: string | null;
  gitLogLoading: boolean;
  refreshGitDiffs: () => void;
  queueGitStatusRefresh: () => void;
  gitIssues: GitHubIssue[];
  gitIssuesTotal: number;
  gitIssuesLoading: boolean;
  gitIssuesError: string | null;
  gitPullRequests: GitHubPullRequest[];
  gitPullRequestsTotal: number;
  gitPullRequestsLoading: boolean;
  gitPullRequestsError: string | null;
  selectedPullRequestNumber: number | null;
  selectedPullRequest: GitHubPullRequest | null;
  selectedPullRequestComments: GitHubPullRequestComment[];
  selectedPullRequestCommentsLoading: boolean;
  selectedPullRequestCommentsError: string | null;
  onSelectPullRequest: (pullRequest: GitHubPullRequest) => void;
  gitRemoteUrl: string | null;
  gitRoot: string | null;
  gitRootCandidates: string[];
  gitRootScanDepth: number;
  gitRootScanLoading: boolean;
  gitRootScanError: string | null;
  gitRootScanHasScanned: boolean;
  onGitRootScanDepthChange: (depth: number) => void;
  onScanGitRoots: () => void;
  onSelectGitRoot: (path: string) => void;
  onClearGitRoot: () => void;
  onPickGitRoot: () => void | Promise<void>;
  onStageGitAll: () => Promise<void>;
  onStageGitFile: (path: string) => Promise<void>;
  onUnstageGitFile: (path: string) => Promise<void>;
  onRevertGitFile: (path: string) => Promise<void>;
  onRevertAllGitChanges: () => Promise<void>;
  gitDiffs: GitDiffViewerItem[];
  gitDiffLoading: boolean;
  gitDiffError: string | null;
  onDiffActivePathChange?: (path: string) => void;
  onGitDiffViewStyleChange: (style: "split" | "unified") => void;
  commitMessage: string;
  commitMessageLoading: boolean;
  commitMessageError: string | null;
  onCommitMessageChange: (value: string) => void;
  onGenerateCommitMessage: (
    language?: "zh" | "en",
    engine?: "codex" | "claude" | "gemini" | "opencode",
    selectedPaths?: string[],
  ) => void | Promise<void>;
  onCommit?: (selectedPaths?: string[]) => void | Promise<void>;
  onCommitAndPush?: (selectedPaths?: string[]) => void | Promise<void>;
  onCommitAndSync?: (selectedPaths?: string[]) => void | Promise<void>;
  onPush?: () => void | Promise<void>;
  onSync?: () => void | Promise<void>;
  commitLoading?: boolean;
  pushLoading?: boolean;
  syncLoading?: boolean;
  commitError?: string | null;
  pushError?: string | null;
  syncError?: string | null;
  commitsAhead?: number;
  onSendPrompt: (text: string) => void | Promise<void>;
  onSendPromptToNewAgent: (text: string) => void | Promise<void>;
  onCreatePrompt: (data: {
    scope: "workspace" | "global";
    name: string;
    description?: string | null;
    argumentHint?: string | null;
    content: string;
  }) => void | Promise<void>;
  onUpdatePrompt: (data: {
    path: string;
    name: string;
    description?: string | null;
    argumentHint?: string | null;
    content: string;
  }) => void | Promise<void>;
  onDeletePrompt: (path: string) => void | Promise<void>;
  onMovePrompt: (data: {
    path: string;
    scope: "workspace" | "global";
  }) => void | Promise<void>;
  onRevealWorkspacePrompts: () => void | Promise<void>;
  onRevealGeneralPrompts: () => void | Promise<void>;
  canRevealGeneralPrompts: boolean;
  onSend: (
    text: string,
    images: string[],
    options?: MessageSendOptions,
  ) => void | Promise<void>;
  onQueue: (
    text: string,
    images: string[],
    options?: MessageSendOptions,
  ) => void | Promise<void>;
  onRequestContextCompaction?: () => Promise<void> | void;
  onStop: () => void;
  completionEmailSelected?: boolean;
  completionEmailDisabled?: boolean;
  onToggleCompletionEmail?: () => void;
  onRewind?: (
    userMessageId: string,
    options?: { mode?: "messages-and-files" | "messages-only" | "files-only" },
  ) => void | Promise<void>;
  onForkFromMessage?: (
    userMessageId: string,
    options?: CodexProviderProfileSelection,
  ) => void | Promise<void>;
  canStop: boolean;
  isReviewing: boolean;
  isProcessing: boolean;
  steerEnabled: boolean;
  reviewPrompt: ReviewPromptState;
  onReviewPromptClose: () => void;
  onReviewPromptShowPreset: () => void;
  onReviewPromptChoosePreset: (
    preset: Exclude<ReviewPromptStep, "preset"> | "uncommitted",
  ) => void;
  highlightedPresetIndex: number;
  onReviewPromptHighlightPreset: (index: number) => void;
  highlightedBranchIndex: number;
  onReviewPromptHighlightBranch: (index: number) => void;
  highlightedCommitIndex: number;
  onReviewPromptHighlightCommit: (index: number) => void;
  onReviewPromptKeyDown: (event: {
    key: string;
    shiftKey?: boolean;
    preventDefault: () => void;
  }) => boolean;
  onReviewPromptSelectBranch: (value: string) => void;
  onReviewPromptSelectBranchAtIndex: (index: number) => void;
  onReviewPromptConfirmBranch: () => Promise<void>;
  onReviewPromptSelectCommit: (sha: string, title: string) => void;
  onReviewPromptSelectCommitAtIndex: (index: number) => void;
  onReviewPromptConfirmCommit: () => Promise<void>;
  onReviewPromptUpdateCustomInstructions: (value: string) => void;
  onReviewPromptConfirmCustom: () => Promise<void>;
  activeTokenUsage: ThreadTokenUsage | null;
  contextDualViewEnabled?: boolean;
  codexAutoCompactionEnabled?: boolean;
  codexAutoCompactionThresholdPercent?: number;
  onCodexAutoCompactionSettingsChange?: (patch: {
    enabled?: boolean;
    thresholdPercent?: number;
  }) => Promise<void> | void;
  activeQueue: QueuedMessage[];
  onDraftChange: (next: string) => void;
  activeImages: string[];
  onPickImages: () => void | Promise<void>;
  onAttachImages: (paths: string[]) => void;
  onRemoveImage: (path: string) => void;
  prefillDraft: QueuedMessage | null;
  onPrefillHandled: (id: string) => void;
  insertText: QueuedMessage | null;
  onInsertHandled: (id: string) => void;
  onEditQueued: (item: QueuedMessage) => void;
  onDeleteQueued: (id: string) => void;
  onFuseQueued: (id: string) => void | Promise<void>;
  canFuseActiveQueue: boolean;
  activeFusingMessageId: string | null;
  collaborationModes: CollaborationModeOption[];
  collaborationModesEnabled: boolean;
  selectedCollaborationModeId: string | null;
  onSelectCollaborationMode: (id: string | null) => void;
  // Engine props
  engines?: EngineDisplayInfo[];
  selectedEngine?: EngineType;
  usePresentationProfile?: boolean;
  onSelectEngine?: (engine: EngineType) => void;
  // Model props
  models: ModelOption[];
  providerModelCatalogs?: Partial<Record<EngineType, ModelOption[]>>;
  selectedModelId: string | null;
  projectMapDatasetController?: ProjectMapDatasetController;
  onSelectModel: (id: string | null) => void;
  onDispatchOrchestrationTask?: (
    confirmation: OrchestrationDispatchConfirmation,
  ) =>
    | Promise<{ ok: boolean; taskId?: string | null; reason?: string }>
    | { ok: boolean; taskId?: string | null; reason?: string };
  reasoningOptions: string[];
  selectedEffort: string | null;
  onSelectEffort: (effort: string | null) => void;
  claudeThinkingVisible?: boolean;
  onResolvedClaudeThinkingVisibleChange?: (enabled: boolean) => void;
  reasoningSupported: boolean;
  opencodeAgents: OpenCodeAgentOption[];
  selectedOpenCodeAgent: string | null;
  onSelectOpenCodeAgent: (agentId: string | null) => void;
  selectedAgent: SelectedAgentOption | null;
  onSelectAgent: (agent: SelectedAgentOption | null) => void;
  onOpenAgentSettings: () => void;
  onOpenPromptSettings: () => void;
  onOpenModelSettings: (providerId?: string) => void;
  onRefreshModelConfig?: (providerId?: string) => Promise<void> | void;
  isModelConfigRefreshing?: boolean;
  opencodeVariantOptions: string[];
  selectedOpenCodeVariant: string | null;
  onSelectOpenCodeVariant: (variant: string | null) => void;
  accessMode: AccessMode;
  onSelectAccessMode: (mode: AccessMode) => void;
  skills: SkillOption[];
  customSkillDirectories?: string[];
  prompts: CustomPromptOption[];
  commands?: CustomCommandOption[];
  files: string[];
  directories: string[];
  directoryMetadata: WorkspaceDirectoryEntry[];
  fileTreeSourceVersion?: string | null;
  gitignoredFiles: Set<string>;
  gitignoredDirectories: Set<string>;
  onInsertComposerText: (text: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  composerEditorSettings: ComposerEditorSettings;
  composerSendShortcut: "enter" | "cmdEnter";
  textareaHeight: number;
  onTextareaHeightChange: (height: number) => void;
  dictationEnabled: boolean;
  dictationState: DictationSessionState;
  dictationLevel: number;
  onToggleDictation: () => void;
  dictationTranscript: DictationTranscript | null;
  onDictationTranscriptHandled: (id: string) => void;
  dictationError: string | null;
  onDismissDictationError: () => void;
  dictationHint: string | null;
  onDismissDictationHint: () => void;
  showComposer: boolean;
  composerSendLabel?: string;
  composerLinkedKanbanPanels: {
    id: string;
    name: string;
    workspaceId: string;
    createdAt?: number;
  }[];
  selectedComposerKanbanPanelId: string | null;
  composerKanbanContextMode: "new" | "inherit";
  onSelectComposerKanbanPanel: (panelId: string | null) => void;
  onComposerKanbanContextModeChange: (mode: "new" | "inherit") => void;
  onOpenComposerKanbanPanel: (panelId: string) => void;
  activeComposerFilePath: string | null;
  activeComposerFileLineRange: { startLine: number; endLine: number } | null;
  activeCodeSelectionAnchor: IntentCanvasCodeSelectionAnchor | null;
  onActiveCodeSelectionAnchorChange: (
    anchor: IntentCanvasCodeSelectionAnchor | null,
  ) => void;
  fileReferenceMode: "path" | "none";
  onFileReferenceModeChange: (mode: "path" | "none") => void;
  plan: TurnPlan | null;
  isPlanMode: boolean;
  onOpenPlanPanel: () => void;
  onClosePlanPanel: () => void;
  bottomStatusPanelExpanded: boolean;
  agentTaskScrollRequest?: AgentTaskScrollRequest | null;
  onSelectSubagent?: (agent: SubagentInfo) => void;
  debugEntries: DebugEntry[];
  debugOpen: boolean;
  terminalOpen: boolean;
  terminalTabs: TerminalTab[];
  activeTerminalId: string | null;
  onSelectTerminal: (terminalId: string) => void;
  onNewTerminal: () => void;
  onCloseTerminal: (terminalId: string) => void;
  terminalState: TerminalSessionState | null;
  onClearDebug: () => void;
  onCopyDebug: () => void;
  onResizeDebug: (event: MouseEvent<Element>) => void;
  onResizeTerminal: (event: MouseEvent<Element>) => void;
  onBackFromDiff: () => void;
  onGoProjects: () => void;
};

export type WorkspaceLayoutNodesOptions = Pick<
  LayoutNodesFlatOptions,
  | "workspaces"
  | "groupedWorkspaces"
  | "hasWorkspaceGroups"
  | "deletingWorktreeIds"
  | "threadsByWorkspace"
  | "threadParentById"
  | "threadStatusById"
  | "historyLoadingByThreadId"
  | "historyRestoredAtMsByThread"
  | "runningSessionCountByWorkspaceId"
  | "recentCompletedSessionCountByWorkspaceId"
  | "hydratedThreadListWorkspaceIds"
  | "threadListLoadingByWorkspace"
  | "threadListPagingByWorkspace"
  | "threadListCursorByWorkspace"
  | "activeWorkspaceId"
  | "activeThreadId"
  | "isPhone"
  | "isTablet"
  | "systemProxyEnabled"
  | "systemProxyUrl"
>;

export type RuntimeLayoutNodesOptions = Pick<
  LayoutNodesFlatOptions,
  | "activeItems"
  | "activeQueuedHandoffBubble"
  | "threadItemsByThread"
  | "sessionRadarRunningSessions"
  | "sessionRadarRecentCompletedSessions"
  | "activeRateLimits"
  | "usageShowRemaining"
  | "showSidebarProviderLabels"
  | "onRefreshAccountRateLimits"
  | "showMessageAnchors"
  | "accountInfo"
  | "onSwitchAccount"
  | "onCancelSwitchAccount"
  | "accountSwitching"
  | "codeBlockCopyUseModifier"
  | "openAppTargets"
  | "openAppIconById"
  | "selectedOpenAppId"
  | "onSelectOpenAppId"
  | "approvals"
  | "userInputRequests"
  | "handleApprovalDecision"
  | "handleApprovalBatchAccept"
  | "handleApprovalRemember"
  | "handleUserInputSubmit"
  | "handleUserInputDismiss"
  | "onRecoverThreadRuntime"
  | "onRecoverThreadRuntimeAndResend"
  | "onThreadRecoveryFork"
  | "handleExitPlanModeExecute"
>;

export type ChromeLayoutNodesOptions = Pick<
  LayoutNodesFlatOptions,
  | "onOpenSettings"
  | "onOpenAgentSettings"
  | "onOpenPromptSettings"
  | "onOpenModelSettings"
  | "onRefreshModelConfig"
  | "isModelConfigRefreshing"
  | "onOpenDictationSettings"
  | "onOpenSkillsSettings"
  | "onOpenDebug"
  | "showDebugButton"
  | "onAddWorkspace"
  | "onSelectHome"
  | "onSelectWorkspace"
  | "onConnectWorkspace"
  | "onAddAgent"
  | "engineOptions"
  | "enabledEngines"
  | "onRefreshEngineOptions"
  | "onAddSharedAgent"
  | "onAddWorktreeAgent"
  | "onAddCloneAgent"
  | "onToggleWorkspaceCollapse"
  | "onSelectThread"
  | "onSelectHomeWorkspace"
  | "onDeleteThread"
  | "onArchiveThread"
  | "deleteConfirmThreadId"
  | "deleteConfirmWorkspaceId"
  | "deleteConfirmBusy"
  | "onCancelDeleteConfirm"
  | "onConfirmDeleteConfirm"
  | "onSyncThread"
  | "pinThread"
  | "unpinThread"
  | "isThreadPinned"
  | "getPinTimestamp"
  | "pinnedThreadsVersion"
  | "isThreadAutoNaming"
  | "onRenameThread"
  | "onAutoNameThread"
  | "onOpenClaudeTui"
  | "onDeleteWorkspace"
  | "onDeleteWorktree"
  | "onRenameWorkspaceAlias"
  | "onLoadOlderThreads"
  | "onQuickReloadWorkspaceThreads"
  | "onReloadWorkspaceThreads"
  | "updaterState"
  | "onUpdate"
  | "onDismissUpdate"
  | "errorToasts"
  | "onDismissErrorToast"
  | "latestAgentRuns"
  | "isLoadingLatestAgents"
  | "onSelectHomeThread"
  | "onOpenSpecHub"
  | "showLoadingProgressDialog"
  | "hideLoadingProgressDialog"
  | "activeWorkspace"
  | "activeParentWorkspace"
  | "worktreeLabel"
  | "worktreeRename"
  | "isWorktreeWorkspace"
  | "branchName"
  | "branches"
  | "onCheckoutBranch"
  | "onCreateBranch"
  | "onCopyThread"
  | "onLockPanel"
  | "onToggleTerminal"
  | "showTerminalButton"
  | "launchScript"
  | "launchScriptEditorOpen"
  | "launchScriptDraft"
  | "launchScriptSaving"
  | "launchScriptError"
  | "onRunLaunchScript"
  | "onOpenLaunchScriptEditor"
  | "onCloseLaunchScriptEditor"
  | "onLaunchScriptDraftChange"
  | "onSaveLaunchScript"
  | "launchScriptsState"
  | "mainHeaderActions"
  | "filePanelMode"
  | "onFilePanelModeChange"
  | "liveEditPreviewEnabled"
  | "onToggleLiveEditPreview"
  | "fileTreeLoading"
  | "fileTreeLoadError"
  | "onRefreshFiles"
  | "onOpenDetachedFileExplorer"
  | "onToggleRuntimeConsole"
  | "runtimeConsoleVisible"
  | "browserDockOpen"
  | "onCloseBrowserDock"
>;

export type EditorLayoutNodesOptions = Pick<
  LayoutNodesFlatOptions,
  | "centerMode"
  | "setCenterMode"
  | "fileCompareSession"
  | "editorSplitCompanion"
  | "setEditorSplitCompanion"
  | "editorSplitLayout"
  | "onToggleEditorSplitLayout"
  | "isEditorFileMaximized"
  | "onToggleEditorFileMaximized"
  | "editorFilePath"
  | "editorNavigationTarget"
  | "editorHighlightTarget"
  | "openEditorTabs"
  | "onActivateEditorTab"
  | "onCloseEditorTab"
  | "onCloseAllEditorTabs"
  | "onActiveEditorLineRangeChange"
  | "onOpenFile"
  | "onCompareFiles"
  | "onCloseFileCompare"
  | "externalChangeMonitoringEnabled"
  | "externalChangeTransportMode"
  | "externalChangeApplyMode"
  | "externalChangeAutoApplyDebounceMs"
  | "onExitEditor"
  | "onExitDiff"
  | "activeTab"
  | "onSelectTab"
  | "tabletNavTab"
  | "gitPanelMode"
  | "onGitPanelModeChange"
  | "onOpenGitHistoryPanel"
  | "onOpenProjectMap"
  | "gitDiffViewStyle"
  | "gitDiffListView"
  | "onGitDiffListViewChange"
  | "worktreeApplyLabel"
  | "worktreeApplyTitle"
  | "worktreeApplyLoading"
  | "worktreeApplyError"
  | "worktreeApplySuccess"
  | "onApplyWorktreeChanges"
>;

export type GitLayoutNodesOptions = Pick<
  LayoutNodesFlatOptions,
  | "gitStatus"
  | "fileStatus"
  | "selectedDiffPath"
  | "diffScrollRequestId"
  | "onSelectDiff"
  | "gitLogEntries"
  | "gitLogTotal"
  | "gitLogAhead"
  | "gitLogBehind"
  | "gitLogAheadEntries"
  | "gitLogBehindEntries"
  | "gitLogUpstream"
  | "gitLogError"
  | "gitLogLoading"
  | "selectedCommitSha"
  | "gitIssues"
  | "gitIssuesTotal"
  | "gitIssuesLoading"
  | "gitIssuesError"
  | "gitPullRequests"
  | "gitPullRequestsTotal"
  | "gitPullRequestsLoading"
  | "gitPullRequestsError"
  | "selectedPullRequestNumber"
  | "selectedPullRequest"
  | "selectedPullRequestComments"
  | "selectedPullRequestCommentsLoading"
  | "selectedPullRequestCommentsError"
  | "onSelectPullRequest"
  | "onSelectCommit"
  | "gitRemoteUrl"
  | "gitRoot"
  | "gitRootCandidates"
  | "gitRootScanDepth"
  | "gitRootScanLoading"
  | "gitRootScanError"
  | "gitRootScanHasScanned"
  | "onGitRootScanDepthChange"
  | "onScanGitRoots"
  | "onSelectGitRoot"
  | "onClearGitRoot"
  | "onPickGitRoot"
  | "onStageGitAll"
  | "onStageGitFile"
  | "onUnstageGitFile"
  | "onRevertGitFile"
  | "onRevertAllGitChanges"
  | "gitDiffs"
  | "gitDiffLoading"
  | "gitDiffError"
  | "refreshGitDiffs"
  | "queueGitStatusRefresh"
  | "onDiffActivePathChange"
  | "onGitDiffViewStyleChange"
  | "commitMessage"
  | "commitMessageLoading"
  | "commitMessageError"
  | "onCommitMessageChange"
  | "onGenerateCommitMessage"
  | "onCommit"
  | "onCommitAndPush"
  | "onCommitAndSync"
  | "onPush"
  | "onSync"
  | "commitLoading"
  | "pushLoading"
  | "syncLoading"
  | "commitError"
  | "pushError"
  | "syncError"
  | "commitsAhead"
>;

export type ComposerLayoutNodesOptions = Pick<
  LayoutNodesFlatOptions,
  | "onSendPrompt"
  | "onSendPromptToNewAgent"
  | "onCreatePrompt"
  | "onUpdatePrompt"
  | "onDeletePrompt"
  | "onMovePrompt"
  | "onRevealWorkspacePrompts"
  | "onRevealGeneralPrompts"
  | "canRevealGeneralPrompts"
  | "onSend"
  | "onQueue"
  | "onRequestContextCompaction"
  | "onStop"
  | "completionEmailSelected"
  | "completionEmailDisabled"
  | "onToggleCompletionEmail"
  | "onRewind"
  | "onForkFromMessage"
  | "canStop"
  | "isReviewing"
  | "isProcessing"
  | "steerEnabled"
  | "reviewPrompt"
  | "onReviewPromptClose"
  | "onReviewPromptShowPreset"
  | "onReviewPromptChoosePreset"
  | "highlightedPresetIndex"
  | "onReviewPromptHighlightPreset"
  | "highlightedBranchIndex"
  | "onReviewPromptHighlightBranch"
  | "highlightedCommitIndex"
  | "onReviewPromptHighlightCommit"
  | "onReviewPromptKeyDown"
  | "onReviewPromptSelectBranch"
  | "onReviewPromptSelectBranchAtIndex"
  | "onReviewPromptConfirmBranch"
  | "onReviewPromptSelectCommit"
  | "onReviewPromptSelectCommitAtIndex"
  | "onReviewPromptConfirmCommit"
  | "onReviewPromptUpdateCustomInstructions"
  | "onReviewPromptConfirmCustom"
  | "activeTokenUsage"
  | "contextDualViewEnabled"
  | "codexAutoCompactionEnabled"
  | "codexAutoCompactionThresholdPercent"
  | "onCodexAutoCompactionSettingsChange"
  | "activeQueue"
  | "onDraftChange"
  | "activeImages"
  | "onPickImages"
  | "onAttachImages"
  | "onRemoveImage"
  | "prefillDraft"
  | "onPrefillHandled"
  | "insertText"
  | "onInsertHandled"
  | "onEditQueued"
  | "onDeleteQueued"
  | "onFuseQueued"
  | "canFuseActiveQueue"
  | "activeFusingMessageId"
  | "collaborationModes"
  | "collaborationModesEnabled"
  | "selectedCollaborationModeId"
  | "onSelectCollaborationMode"
  | "engines"
  | "selectedEngine"
  | "usePresentationProfile"
  | "onSelectEngine"
  | "models"
  | "providerModelCatalogs"
  | "selectedModelId"
  | "projectMapDatasetController"
  | "onSelectModel"
  | "onDispatchOrchestrationTask"
  | "intentCanvasOpenRequest"
  | "onOpenIntentCanvas"
  | "onIntentCanvasOpenRequestConsumed"
  | "onAttachIntentCanvasToThread"
  | "pendingIntentCanvasDocuments"
  | "onRemovePendingIntentCanvas"
  | "reasoningOptions"
  | "selectedEffort"
  | "onSelectEffort"
  | "claudeThinkingVisible"
  | "onResolvedClaudeThinkingVisibleChange"
  | "reasoningSupported"
  | "opencodeAgents"
  | "selectedOpenCodeAgent"
  | "onSelectOpenCodeAgent"
  | "selectedAgent"
  | "onSelectAgent"
  | "opencodeVariantOptions"
  | "selectedOpenCodeVariant"
  | "onSelectOpenCodeVariant"
  | "accessMode"
  | "onSelectAccessMode"
  | "skills"
  | "customSkillDirectories"
  | "prompts"
  | "commands"
  | "files"
  | "directories"
  | "directoryMetadata"
  | "fileTreeSourceVersion"
  | "gitignoredFiles"
  | "gitignoredDirectories"
  | "onInsertComposerText"
  | "textareaRef"
  | "composerEditorSettings"
  | "composerSendShortcut"
  | "textareaHeight"
  | "onTextareaHeightChange"
  | "dictationEnabled"
  | "dictationState"
  | "dictationLevel"
  | "onToggleDictation"
  | "dictationTranscript"
  | "onDictationTranscriptHandled"
  | "dictationError"
  | "onDismissDictationError"
  | "dictationHint"
  | "onDismissDictationHint"
  | "onOpenExperimentalSettings"
  | "composerSendLabel"
  | "composerLinkedKanbanPanels"
  | "selectedComposerKanbanPanelId"
  | "composerKanbanContextMode"
  | "onSelectComposerKanbanPanel"
  | "onComposerKanbanContextModeChange"
  | "onOpenComposerKanbanPanel"
  | "activeComposerFilePath"
  | "activeComposerFileLineRange"
  | "activeCodeSelectionAnchor"
  | "onActiveCodeSelectionAnchorChange"
  | "fileReferenceMode"
  | "onFileReferenceModeChange"
>;

export type PanelsLayoutNodesOptions = Pick<
  LayoutNodesFlatOptions,
  | "showComposer"
  | "plan"
  | "isPlanMode"
  | "onOpenPlanPanel"
  | "onClosePlanPanel"
  | "bottomStatusPanelExpanded"
  | "agentTaskScrollRequest"
  | "onSelectSubagent"
  | "debugEntries"
  | "debugOpen"
  | "terminalOpen"
  | "terminalTabs"
  | "activeTerminalId"
  | "onSelectTerminal"
  | "onNewTerminal"
  | "onCloseTerminal"
  | "terminalState"
  | "onClearDebug"
  | "onCopyDebug"
  | "onResizeDebug"
  | "onResizeTerminal"
  | "onBackFromDiff"
  | "onGoProjects"
  | "workspaceDropTargetRef"
  | "isWorkspaceDropActive"
  | "workspaceDropText"
  | "onWorkspaceDragOver"
  | "onWorkspaceDragEnter"
  | "onWorkspaceDragLeave"
  | "onWorkspaceDrop"
  | "appMode"
  | "onAppModeChange"
  | "onOpenHomeChat"
  | "onOpenMemory"
  | "onOpenProjectMemory"
  | "onOpenContextLedgerMemory"
  | "onOpenContextLedgerNote"
  | "onOpenReleaseNotes"
  | "focusedProjectMemoryId"
  | "focusedProjectMemoryRequestKey"
  | "focusedWorkspaceNoteId"
  | "focusedWorkspaceNoteRequestKey"
  | "onOpenGlobalSearch"
  | "globalSearchShortcut"
  | "openChatShortcut"
  | "openKanbanShortcut"
  | "cycleOpenSessionPrevShortcut"
  | "cycleOpenSessionNextShortcut"
  | "closeCurrentSessionShortcut"
  | "saveFileShortcut"
  | "findInFileShortcut"
  | "toggleGitDiffListViewShortcut"
  | "onOpenWorkspaceHome"
>;

export type LayoutNodesOptions = {
  workspace: WorkspaceLayoutNodesOptions;
  runtime: RuntimeLayoutNodesOptions;
  chrome: ChromeLayoutNodesOptions;
  editor: EditorLayoutNodesOptions;
  git: GitLayoutNodesOptions;
  composer: ComposerLayoutNodesOptions;
  panels: PanelsLayoutNodesOptions;
};

export type LayoutNodesResult = {
  codeAnnotationBridgeProps: CodeAnnotationBridgeProps;
  sidebarNode: ReactNode;
  messagesNode: ReactNode;
  composerNode: ReactNode;
  approvalToastsNode: ReactNode;
  updateToastNode: ReactNode;
  errorToastsNode: ReactNode;
  globalRuntimeNoticeDockNode: ReactNode;
  homeNode: ReactNode;
  mainHeaderNode: ReactNode;
  desktopTopbarLeftNode: ReactNode;
  tabletNavNode: ReactNode;
  tabBarNode: ReactNode;
  rightPanelToolbarNode: ReactNode;
  gitDiffPanelNode: ReactNode;
  gitDiffViewerNode: ReactNode;
  fileViewPanelNode: ReactNode;
  noteCardsPanelNode: ReactNode;
  fileComparePanelNode: ReactNode;
  projectMapPanelNode: ReactNode;
  intentCanvasPanelNode: ReactNode;
  browserDockNode: ReactNode;
  planPanelNode: ReactNode;
  debugPanelNode: ReactNode;
  debugPanelFullNode: ReactNode;
  terminalDockNode: ReactNode;
  compactEmptyCodexNode: ReactNode;
  compactEmptySpecNode: ReactNode;
  compactEmptyGitNode: ReactNode;
  compactGitBackNode: ReactNode;
};

export type RightPanelTabSelection =
  | LayoutNodesFlatOptions["filePanelMode"]
  | "projectMap"
  | "intentCanvas"
  | "specHub"
  | "detachedExplorer";
