import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useEventCallback } from "../../../utils/useEventCallback";
import type {
  ComposerSendShortcut,
  ComposerEditorSettings,
  ConversationItem,
  CustomCommandOption,
  CustomPromptOption,
  DictationTranscript,
  EngineType,
  MessageSendOptions,
  ModelOption,
  OpenCodeAgentOption,
  QueuedMessage,
  RateLimitSnapshot,
  RequestUserInputRequest,
  RuntimeLifecycleState,
  ThreadTokenUsage,
  TurnPlan,
} from "../../../types";
import type {
  ReviewPromptState,
  ReviewPromptStep,
} from "../../threads/hooks/useReviewPrompt";
import type { EngineDisplayInfo } from "../../engine/hooks/useEngineController";
import {
  hydrateSharedTargetState,
  useSharedTargetState,
  getSharedTargetState,
  beginSharedTargetPersist,
  endSharedTargetPersist,
} from "../../shared-session/target/targetStore";
import {
  freezeTurnSnapshot,
  isResolvedExecutionTarget,
  resolveBackendAuthoritativeExecutionTarget,
  type ExecutionTarget,
} from "../../shared-session/target/types";
import { persistSharedSessionSelectedTarget } from "../../shared-session/services/sharedSessions";
import { resolveComposerAtomicSelectedModelId } from "../utils/resolveComposerAtomicSelectedModelId";
import { resolveDefaultCreationExecutionTarget } from "../utils/resolveDefaultCreationExecutionTarget";
import { isSharedSessionThreadId } from "../../shared-session/utils/sharedSessionIdentity";
import { dispatchSharedSendEvent } from "../../shared-session/runtime/sharedSendStateStore";
import { requestProviderContinuationDialog } from "../../threads/services/providerContinuationRequests";
import {
  CLAUDE_LOCAL_PROVIDER_PROFILE_ID,
  CODEX_DISK_PROVIDER_PROFILE_ID,
  LOCAL_PROVIDER_PROFILE_DISPLAY_NAME,
} from "../../threads/constants/codexProviderProfiles";
import { computeDictationInsertion } from "../../../utils/dictation";
import { useComposerAutocompleteState } from "../hooks/useComposerAutocompleteState";
import { useComposerDraft } from "../hooks/composerDraftStore";
import { ChatInputBoxAdapter } from "./ChatInputBox/ChatInputBoxAdapter";
import type { ChatInputBoxHandle } from "./ChatInputBox/ChatInputBoxAdapter";
import { isSameProviderExecutionProfile } from "./ChatInputBox/selectors/ModelSelect";
import {
  accessModeToPermissionMode,
  permissionModeToAccessMode,
  type ProviderId,
} from "./ChatInputBox/types";
import {
  reconcileAtomicReasoningEffort,
  resolveAtomicReasoningOptions,
} from "../../models/atomicModelReasoning";
import {
  ClaudeRewindConfirmDialog,
  type ClaudeRewindPreviewState,
} from "./ClaudeRewindConfirmDialog";
import { ReviewInlinePrompt } from "./ReviewInlinePrompt";
import {
  ComposerBranchBadge,
  type ComposerBranchControl,
} from "./ComposerBranchBadge";
import { ContextBar } from "./ChatInputBox/ContextBar";
import { TokenIndicator } from "./ChatInputBox/TokenIndicator";
import type {
  ClaudeContextUsageViewModel,
  CodexCompactionSource,
  ContextSelectionChip,
  MemoryReferenceMode,
  PermissionMode,
  SelectedAgent as ChatInputSelectedAgent,
} from "./ChatInputBox/types";
import { useStatusPanelData } from "../../status-panel/hooks/useStatusPanelData";
import { ComposerRunStatusStrip } from "./run-status";
import { isEngineCapabilityAvailable } from "../../engine/engineCapabilityMatrix";
import {
  buildTurnFileChangesByBoundaryId,
  mergeTurnFileChangesSummaries,
  overlaySessionFileChangesWithGitStats,
} from "../../messages/utils/turnFileChanges";
import {
  assembleSinglePrompt,
  expandLeadingManagedCommand,
  assembleSkillInvocations,
  shouldAssemblePrompt,
} from "../utils/promptAssembler";
import { buildComposerSendReadiness } from "../utils/composerSendReadiness";
import type {
  CodeAnnotationDraftInput,
  CodeAnnotationSelection,
} from "../../code-annotations/types";
import {
  appendCodeAnnotationsToPrompt,
  buildCodeAnnotationDedupeKey,
  formatCodeAnnotationLineRange,
} from "../../code-annotations/utils/codeAnnotations";
import {
  buildLatestRewindPreview,
  buildRewindPreviewForMessage,
  extractInlineFileReferenceTokens,
  mergeInlineFileReferences,
  normalizeInlineFileReferenceTokens,
  normalizeRewindExportPath,
  replaceVisibleFileReferenceLabels,
  resolvePreferredStatus,
  resolveRewindSupportedEngineFromThreadId,
  toRewindPathDedupeKey,
  type InlineFileReferenceSelection,
  type RewindFileChangeStatus,
} from "../utils/composerFileReferences";
import {
  resolveManualMemoryChipDetail,
  resolveManualMemoryChipTitle,
  resolveNoteCardChipDetail,
  resolveNoteCardChipTitle,
} from "../utils/contextSelectionChips";
import {
  extractInlineSelections,
  mergeUniqueNames,
} from "../utils/inlineSelections";
import { useStreamActivityPhase } from "../../threads/hooks/useStreamActivityPhase";
import { exportRewindFiles } from "../../../services/tauri";
import { pushErrorToast } from "../../../services/toasts";
import {
  engineSupportsImageInput,
  formatEngineImageInputUnsupportedMessage,
  getEngineImageInputLabel,
  sanitizeImageAttachmentPaths,
} from "../../engine/utils/engineImageInput";
import { getManualMemoryInjectionMode } from "../../project-memory/utils/manualInjectionMode";
import { estimateClaudeContextWindow } from "../../models/claudeContextWindow";
import type { RewindMode } from "../../threads/utils/rewindMode";
import {
  buildRetainedContextChipKeys,
  filterRetainedChipNames,
  filterRetainedEntries,
} from "../../context-ledger/utils/contextLedgerGovernance";
import { resolveDualContextUsageModel } from "../../context-ledger/utils/contextLedgerProjection";
import {
  BrowserContextPreview,
  useBrowserContextAttachment,
} from "../../browser-agent";
import { IntentCanvasAttachmentCard } from "../../intent-canvas/components/IntentCanvasAttachmentCard";
import type { IntentCanvasDocument } from "../../intent-canvas/types";
import { resolveBrowserNavigationUrl } from "../utils/browserNavigation";
import { useAgentProjection } from "../../multi-agent/store/agentStore";
import { useCollabUiState } from "../../multi-agent/store/collabUiStore";
import { isTerminalAgentStatus } from "../../multi-agent/types";
import {
  isMultiAgentTargetSupported,
  MultiAgentComposerToggle,
} from "../../multi-agent/components/ComposerToggle";


type RewindExecutionOptions = {
  mode?: RewindMode;
};

export type ComposerRewindDialogRequest = {
  requestId: number;
  userMessageId: string;
};

function keepArrayWhenEmpty<T>(current: T[]): T[] {
  return current.length === 0 ? current : [];
}

function finiteNonNegative(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(value, 0)
    : null;
}

function finitePositive(value: number | null | undefined): number | null {
  const normalizedValue = finiteNonNegative(value);
  return normalizedValue !== null && normalizedValue > 0
    ? normalizedValue
    : null;
}

function resolveClaudeWindowUsedTokens(
  contextUsage: ThreadTokenUsage,
): number | null {
  const explicitContextUsedTokens = finiteNonNegative(
    contextUsage.contextUsedTokens,
  );
  if (explicitContextUsedTokens !== null) {
    return explicitContextUsedTokens;
  }
  const inputTokens = finiteNonNegative(contextUsage.last.inputTokens) ?? 0;
  const cachedInputTokens =
    finiteNonNegative(contextUsage.last.cachedInputTokens) ?? 0;
  const hasWindowSnapshot = inputTokens > 0 || cachedInputTokens > 0;
  return hasWindowSnapshot ? inputTokens + cachedInputTokens : null;
}

type ComposerProps = {
  kanbanContextMode?: "new" | "inherit";
  onKanbanContextModeChange?: (mode: "new" | "inherit") => void;
  items?: ConversationItem[];
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
  canStop: boolean;
  disabled?: boolean;
  /** 禁止提交但保留文本编辑；Shared non-idle 用于维持 Turn 线性顺序。 */
  submitDisabled?: boolean;
  isProcessing: boolean;
  steerEnabled: boolean;
  collaborationModes: { id: string; label: string }[];
  collaborationModesEnabled: boolean;
  selectedCollaborationModeId: string | null;
  onSelectCollaborationMode: (id: string | null) => void;
  isSharedSession?: boolean;
  /** New Home 仅复用双栏 picker，不启用 Shared Session durable semantics。 */
  createSessionTargetPicker?: boolean;
  /** New Home 标题只接收 creation target 的 Engine projection；完整 Target 仍由 Composer 持有。 */
  onCreationTargetEngineChange?: (engine: EngineType | null) => void;
  /** Wave 4 / B.6：Shared Send 状态机非 idle 时锁定四级 Picker（§14.5.3）。 */
  sharedTargetPickerLocked?: boolean;
  // Engine props
  engines?: EngineDisplayInfo[];
  selectedEngine?: EngineType;
  onSelectEngine?: (engine: EngineType) => void;
  // Model props
  models: { id: string; displayName: string; model: string }[];
  providerModelCatalogs?: Partial<Record<EngineType, ModelOption[]>>;
  providerProfileId?: string | null;
  /** 当前会话创建时的供应商显示名（切老会话时底栏渠道芯片用，避免回落到列表首项 DeepSeek） */
  providerProfileName?: string | null;
  selectedModelId: string | null;
  onSelectModel: (id: string) => void;
  reasoningOptions: string[];
  selectedEffort: string | null;
  onSelectEffort: (effort: string | null) => void;
  reasoningSupported: boolean;
  onResolvedAlwaysThinkingChange?: (enabled: boolean) => void;
  opencodeAgents?: OpenCodeAgentOption[];
  selectedOpenCodeAgent?: string | null;
  onSelectOpenCodeAgent?: (agentId: string | null) => void;
  selectedAgent?: ChatInputSelectedAgent | null;
  onAgentSelect?: (agent: ChatInputSelectedAgent | null) => void;
  onOpenAgentSettings?: () => void;
  onOpenPromptSettings?: () => void;
  onOpenModelSettings?: (providerId?: string) => void;
  onOpenCliSettings?: () => void;
  onRefreshModelConfig?: (providerId?: string) => Promise<void> | void;
  isModelConfigRefreshing?: boolean;
  onForkQuickStart?: () => void;
  opencodeVariantOptions?: string[];
  selectedOpenCodeVariant?: string | null;
  onSelectOpenCodeVariant?: (variant: string | null) => void;
  accessMode: "default" | "read-only" | "current" | "full-access";
  onSelectAccessMode: (
    mode: "default" | "read-only" | "current" | "full-access",
  ) => void;
  skills: {
    name: string;
    path: string;
    description?: string;
    source?: string;
  }[];
  customSkillDirectories?: string[];
  prompts: CustomPromptOption[];
  commands?: CustomCommandOption[];
  files: string[];
  directories?: string[];
  contextUsage?: ThreadTokenUsage | null;
  contextDualViewEnabled?: boolean;
  isContextCompacting?: boolean;
  codexCompactionLifecycleState?: "idle" | "compacting" | "completed";
  codexCompactionSource?: CodexCompactionSource | null;
  codexCompactionCompletedAt?: number | null;
  lastTokenUsageUpdatedAt?: number | null;
  codexAutoCompactionEnabled?: boolean;
  codexAutoCompactionThresholdPercent?: number;
  onCodexAutoCompactionSettingsChange?: (patch: {
    enabled?: boolean;
    thresholdPercent?: number;
  }) => Promise<void> | void;
  accountRateLimits?: RateLimitSnapshot | null;
  usageShowRemaining?: boolean;
  onRefreshAccountRateLimits?: () => Promise<void> | void;
  queuedMessages?: QueuedMessage[];
  onEditQueued?: (item: QueuedMessage) => void;
  onDeleteQueued?: (id: string) => void;
  onFuseQueued?: (id: string) => void | Promise<void>;
  canFuseQueuedMessages?: boolean;
  fuseDisabledReasonKey?: string | null;
  fusingQueuedMessageId?: string | null;
  userInputRequests?: RequestUserInputRequest[];
  onJumpToUserInputRequest?: (request: RequestUserInputRequest) => void;
  runtimeLifecycleState?: RuntimeLifecycleState | null;
  sendLabel?: string;
  onDraftChange?: (text: string) => void;
  attachedImages?: string[];
  onPickImages?: () => void;
  onAttachImages?: (paths: string[]) => void;
  onRemoveImage?: (path: string) => void;
  intentCanvasAttachments?: IntentCanvasDocument[];
  onRemoveIntentCanvasAttachment?: (documentId: string) => void;
  prefillDraft?: QueuedMessage | null;
  onPrefillHandled?: (id: string) => void;
  insertText?: QueuedMessage | null;
  onInsertHandled?: (id: string) => void;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  editorSettings?: ComposerEditorSettings;
  sendShortcut?: ComposerSendShortcut;
  textareaHeight?: number;
  onTextareaHeightChange?: (height: number) => void;
  dictationEnabled?: boolean;
  dictationState?: "idle" | "listening" | "processing";
  dictationLevel?: number;
  onToggleDictation?: () => void;
  onOpenDictationSettings?: () => void;
  onOpenSkillsSettings?: () => void;
  onOpenExperimentalSettings?: () => void;
  dictationTranscript?: DictationTranscript | null;
  onDictationTranscriptHandled?: (id: string) => void;
  dictationError?: string | null;
  onDismissDictationError?: () => void;
  dictationHint?: string | null;
  onDismissDictationHint?: () => void;
  reviewPrompt?: ReviewPromptState;
  onReviewPromptClose?: () => void;
  onReviewPromptShowPreset?: () => void;
  onReviewPromptChoosePreset?: (
    preset: Exclude<ReviewPromptStep, "preset"> | "uncommitted",
  ) => void;
  highlightedPresetIndex?: number;
  onReviewPromptHighlightPreset?: (index: number) => void;
  highlightedBranchIndex?: number;
  onReviewPromptHighlightBranch?: (index: number) => void;
  highlightedCommitIndex?: number;
  onReviewPromptHighlightCommit?: (index: number) => void;
  onReviewPromptKeyDown?: (event: {
    key: string;
    shiftKey?: boolean;
    preventDefault: () => void;
  }) => boolean;
  onReviewPromptSelectBranch?: (value: string) => void;
  onReviewPromptSelectBranchAtIndex?: (index: number) => void;
  onReviewPromptConfirmBranch?: () => Promise<void>;
  onReviewPromptSelectCommit?: (sha: string, title: string) => void;
  onReviewPromptSelectCommitAtIndex?: (index: number) => void;
  onReviewPromptConfirmCommit?: () => Promise<void>;
  onReviewPromptUpdateCustomInstructions?: (value: string) => void;
  onReviewPromptConfirmCustom?: () => Promise<void>;
  linkedKanbanPanels?: {
    id: string;
    name: string;
    workspaceId: string;
    createdAt?: number;
  }[];
  selectedLinkedKanbanPanelId?: string | null;
  onSelectLinkedKanbanPanel?: (panelId: string | null) => void;
  onOpenLinkedKanbanPanel?: (panelId: string) => void;
  activeFilePath?: string | null;
  activeFileLineRange?: { startLine: number; endLine: number } | null;
  fileReferenceMode?: "path" | "none";
  activeWorkspaceId?: string | null;
  activeWorkspaceName?: string | null;
  activeWorkspacePath?: string | null;
  branchControl?: ComposerBranchControl | null;
  /** 输入框下方分支行右侧的上下文占用指示器；首页由 HomeChat 自行渲染，置 false 关闭 */
  footerUsageIndicatorEnabled?: boolean;
  rewindWorkspaceGitState?: {
    isGitRepository: boolean;
    hasDetectedChanges: boolean;
  } | null;
  activeThreadId?: string | null;
  threadItemsByThread?: Record<string, ConversationItem[]>;
  threadParentById?: Record<string, string>;
  threadStatusById?: Record<string, { isProcessing?: boolean } | undefined>;
  plan?: TurnPlan | null;
  isPlanMode?: boolean;
  onOpenDiffPath?: (path: string) => void;
  /**
   * 工作区 git 脏文件（含行统计）。会话「已编辑」pill 的 +/− 以此为准，
   * path 集合仍来自本会话 AI 工具调用。
   */
  gitChangedFiles?: Array<{
    path: string;
    additions: number;
    deletions: number;
  }> | null;
  /** 非 git 仓库时传 false，退回 tool 统计 */
  isGitRepository?: boolean;
  /** AI 改文件后请求刷新 git status（防抖由 Composer 侧触发） */
  onRequestGitStatusRefresh?: () => void;
  /** 撤销会话已编辑列表中的单个文件（git restore） */
  onRevertFile?: (path: string) => void | Promise<void>;
  /** 撤销会话已编辑列表中的多个文件 */
  onRevertAllFiles?: (paths: string[]) => void | Promise<void>;
  onRewind?: (
    userMessageId: string,
    options?: RewindExecutionOptions,
  ) => void | Promise<void>;
  rewindDialogRequest?: ComposerRewindDialogRequest | null;
  onRewindDialogRequestConsumed?: (requestId: number) => void;
  showStatusPanelToggleOverride?: boolean;
  statusPanelExpandedOverride?: boolean;
  onToggleStatusPanelOverride?: () => void;
  completionEmailSelected?: boolean;
  completionEmailDisabled?: boolean;
  onToggleCompletionEmail?: () => void;
  pendingCodeAnnotation?: CodeAnnotationDraftInput | null;
  onCodeAnnotationConsumed?: (dedupeKey: string) => void;
  selectedCodeAnnotations?: CodeAnnotationSelection[];
  onRemoveCodeAnnotation?: (annotationId: string) => void;
  onClearCodeAnnotations?: () => void;
  externalNoteCardSelectionRequest?: ComposerNoteCardSelectionRequest | null;
};

type ManualMemorySelection = {
  id: string;
  title: string;
  summary: string;
  detail: string;
  kind: string;
  importance: string;
  updatedAt: number;
  tags: string[];
};

export type NoteCardSelection = {
  id: string;
  title: string;
  plainTextExcerpt: string;
  bodyMarkdown: string;
  updatedAt: number;
  archived: boolean;
  imageCount: number;
  previewAttachments: Array<{
    id: string;
    fileName: string;
    contentType: string;
    absolutePath: string;
  }>;
};

export type ComposerNoteCardSelectionRequest = {
  requestId: number;
  noteCard: NoteCardSelection;
};

const EMPTY_ITEMS: ConversationItem[] = [];
const COMPOSER_MIN_HEIGHT = 20;
const COMPOSER_EXPAND_HEIGHT = 80;
const COMPOSER_INPUT_INTERACTION_IDLE_MS = 320;
const BROWSER_OPEN_DOCK_EVENT = "browser-agent:open-dock";
const BROWSER_OPEN_URL_EVENT = "browser-agent:open-url";
const PENDING_BROWSER_URL_KEY = "ccgui.browserAgent.pendingUrl";
const COMPOSER_CANVAS_ONLY_PROPS = new Set<keyof ComposerProps>([
  "items",
  "threadItemsByThread",
  "threadStatusById",
  "contextUsage",
  "accountRateLimits",
]);

function toContextChipCarryOverKey(chip: ContextSelectionChip) {
  return `${chip.type}:${chip.name}`;
}

function resolveSelectedNamedItems<T extends { name: string }>(
  selectedNames: string[],
  items: T[],
): T[] {
  if (selectedNames.length === 0 || items.length === 0) {
    return [];
  }
  const firstByName = new Map<string, T>();
  for (const item of items) {
    const normalizedName = item.name.trim();
    if (!normalizedName || firstByName.has(normalizedName)) {
      continue;
    }
    firstByName.set(normalizedName, item);
  }
  const resolved: T[] = [];
  const seen = new Set<string>();
  for (const selectedName of selectedNames) {
    const normalizedName = selectedName.trim();
    if (!normalizedName || seen.has(normalizedName)) {
      continue;
    }
    const resolvedItem = firstByName.get(normalizedName);
    if (!resolvedItem) {
      continue;
    }
    seen.add(normalizedName);
    resolved.push(resolvedItem);
  }
  return resolved;
}

const OPENCODE_DIRECT_COMMANDS = new Set(["status", "mcp", "export", "share"]);

function normalizeCommandChipName(name: string) {
  const token = name.trim().replace(/^\/+/, "").split(/\s+/)[0];
  return token ? token.toLowerCase() : "";
}

function ComposerImpl({
  kanbanContextMode: _kanbanContextMode = "new",
  onKanbanContextModeChange: _onKanbanContextModeChange,
  items = EMPTY_ITEMS,
  onSend,
  onQueue,
  onRequestContextCompaction,
  onStop,
  canStop,
  disabled = false,
  submitDisabled = false,
  isProcessing,
  steerEnabled: _steerEnabled,
  collaborationModes: _collaborationModes,
  collaborationModesEnabled: _collaborationModesEnabled,
  selectedCollaborationModeId: _selectedCollaborationModeId,
  onSelectCollaborationMode: _onSelectCollaborationMode,
  isSharedSession = false,
  createSessionTargetPicker = false,
  onCreationTargetEngineChange,
  sharedTargetPickerLocked = false,
  engines,
  selectedEngine,
  onSelectEngine,
  models,
  providerModelCatalogs,
  providerProfileId,
  providerProfileName,
  selectedModelId,
  onSelectModel,
  reasoningOptions,
  selectedEffort,
  onSelectEffort,
  reasoningSupported,
  onResolvedAlwaysThinkingChange,
  opencodeAgents = [],
  selectedOpenCodeAgent = null,
  onSelectOpenCodeAgent,
  selectedAgent = null,
  onAgentSelect,
  onOpenAgentSettings,
  onOpenPromptSettings,
  onOpenModelSettings,
  onOpenCliSettings,
  onRefreshModelConfig,
  isModelConfigRefreshing,
  onForkQuickStart,
  opencodeVariantOptions: _opencodeVariantOptions = [],
  selectedOpenCodeVariant: _selectedOpenCodeVariant = null,
  onSelectOpenCodeVariant: _onSelectOpenCodeVariant,
  accessMode,
  onSelectAccessMode,
  skills,
  customSkillDirectories,
  prompts,
  commands = [],
  files,
  directories = [],
  contextUsage = null,
  contextDualViewEnabled = false,
  isContextCompacting = false,
  codexCompactionLifecycleState = "idle",
  codexCompactionSource = null,
  codexCompactionCompletedAt = null,
  lastTokenUsageUpdatedAt = null,
  codexAutoCompactionEnabled = true,
  codexAutoCompactionThresholdPercent = 92,
  onCodexAutoCompactionSettingsChange,
  accountRateLimits = null,
  usageShowRemaining = false,
  onRefreshAccountRateLimits,
  queuedMessages = [],
  onDeleteQueued,
  onFuseQueued,
  canFuseQueuedMessages = false,
  fuseDisabledReasonKey = null,
  fusingQueuedMessageId = null,
  userInputRequests = [],
  onJumpToUserInputRequest,
  runtimeLifecycleState = null,
  sendLabel: _sendLabel = "Send",
  onDraftChange,
  attachedImages = [],
  onPickImages,
  onAttachImages,
  onRemoveImage,
  intentCanvasAttachments = [],
  onRemoveIntentCanvasAttachment,
  prefillDraft = null,
  onPrefillHandled,
  insertText = null,
  onInsertHandled,
  textareaRef: externalTextareaRef,
  editorSettings: _editorSettingsProp,
  sendShortcut = "enter",
  textareaHeight = 80,
  onTextareaHeightChange,
  dictationEnabled: _dictationEnabled = false,
  dictationState: _dictationState = "idle",
  dictationLevel: _dictationLevel = 0,
  onToggleDictation: _onToggleDictation,
  onOpenDictationSettings: _onOpenDictationSettings,
  onOpenSkillsSettings: _onOpenSkillsSettings,
  onOpenExperimentalSettings: _onOpenExperimentalSettings,
  dictationTranscript = null,
  onDictationTranscriptHandled,
  dictationError: _dictationError = null,
  onDismissDictationError: _onDismissDictationError,
  dictationHint: _dictationHint = null,
  onDismissDictationHint: _onDismissDictationHint,
  reviewPrompt,
  onReviewPromptClose: _onReviewPromptClose,
  onReviewPromptShowPreset: _onReviewPromptShowPreset,
  onReviewPromptChoosePreset: _onReviewPromptChoosePreset,
  highlightedPresetIndex: _highlightedPresetIndex,
  onReviewPromptHighlightPreset: _onReviewPromptHighlightPreset,
  highlightedBranchIndex: _highlightedBranchIndex,
  onReviewPromptHighlightBranch: _onReviewPromptHighlightBranch,
  highlightedCommitIndex: _highlightedCommitIndex,
  onReviewPromptHighlightCommit: _onReviewPromptHighlightCommit,
  onReviewPromptKeyDown: _onReviewPromptKeyDown,
  onReviewPromptSelectBranch: _onReviewPromptSelectBranch,
  onReviewPromptSelectBranchAtIndex: _onReviewPromptSelectBranchAtIndex,
  onReviewPromptConfirmBranch: _onReviewPromptConfirmBranch,
  onReviewPromptSelectCommit: _onReviewPromptSelectCommit,
  onReviewPromptSelectCommitAtIndex: _onReviewPromptSelectCommitAtIndex,
  onReviewPromptConfirmCommit: _onReviewPromptConfirmCommit,
  onReviewPromptUpdateCustomInstructions:
    _onReviewPromptUpdateCustomInstructions,
  onReviewPromptConfirmCustom: _onReviewPromptConfirmCustom,
  linkedKanbanPanels: _linkedKanbanPanels = [],
  selectedLinkedKanbanPanelId: _selectedLinkedKanbanPanelId = null,
  onSelectLinkedKanbanPanel: _onSelectLinkedKanbanPanel,
  onOpenLinkedKanbanPanel: _onOpenLinkedKanbanPanel,
  activeFilePath = null,
  activeFileLineRange = null,
  fileReferenceMode = "path",
  activeWorkspaceId = null,
  activeWorkspaceName = null,
  activeWorkspacePath = null,
  branchControl = null,
  footerUsageIndicatorEnabled = true,
  rewindWorkspaceGitState = null,
  activeThreadId = null,
  threadItemsByThread,
  threadParentById,
  threadStatusById,
  plan = null,
  isPlanMode = false,
  onOpenDiffPath,
  gitChangedFiles = null,
  isGitRepository = true,
  onRequestGitStatusRefresh,
  onRevertFile,
  onRevertAllFiles,
  onRewind,
  rewindDialogRequest = null,
  onRewindDialogRequestConsumed,
  showStatusPanelToggleOverride,
  statusPanelExpandedOverride,
  onToggleStatusPanelOverride,
  completionEmailSelected,
  completionEmailDisabled,
  onToggleCompletionEmail,
  pendingCodeAnnotation = null,
  onCodeAnnotationConsumed,
  selectedCodeAnnotations = [],
  onRemoveCodeAnnotation,
  onClearCodeAnnotations,
  externalNoteCardSelectionRequest = null,
}: ComposerProps) {
  const { t } = useTranslation();
  const isCodexEngine = selectedEngine === "codex";
  const deferredItems = useDeferredValue(items);
  const performanceScopedItems = isProcessing ? deferredItems : items;
  const supportsStreamActivityPhaseFx =
    selectedEngine === "codex" ||
    selectedEngine === "claude" ||
    selectedEngine === "gemini" ||
    selectedEngine === "grok" ||
    selectedEngine === "kimi";
  const streamActivityPhase = useStreamActivityPhase({
    isProcessing: Boolean(isProcessing && supportsStreamActivityPhaseFx),
    items: performanceScopedItems,
  });
  const isReviewQuickActionEngine =
    selectedEngine === "codex" || selectedEngine === "claude";
  const sharedTargetState = useSharedTargetState(
    activeWorkspaceId ?? "",
    activeThreadId ?? "",
  );
  const selectedSharedTarget = sharedTargetState.selectedNextTarget;
  const [selectedCreationTarget, setSelectedCreationTarget] =
    useState<ExecutionTarget | null>(null);
  // 首页 picker 主动切换 engine 时，parent selectedEngine 可能尚未异步跟上；
  // 用 ref 标记「等待 parent 追上的目标」，避免误清 sticky creation target。
  const pendingPickerEngineRef = useRef<EngineType | null>(null);
  const defaultCreationTarget = useMemo<ExecutionTarget | null>(() => {
    return resolveDefaultCreationExecutionTarget({
      enabled: createSessionTargetPicker,
      selectedEngine,
      selectedModelId,
      selectedEffort,
      providerProfileId,
      models,
    });
  }, [
    createSessionTargetPicker,
    models,
    providerProfileId,
    selectedEffort,
    selectedEngine,
    selectedModelId,
  ]);
  const effectiveCreationTarget =
    selectedCreationTarget ?? defaultCreationTarget;
  // 只在 engine 语义变化时通知父层，避免等价 setState 触发 layout 重渲染环
  const publishedCreationTargetEngineRef = useRef<
    EngineType | null | undefined
  >(undefined);
  useEffect(() => {
    if (!createSessionTargetPicker) {
      publishedCreationTargetEngineRef.current = undefined;
      return;
    }
    const nextEngine =
      effectiveCreationTarget?.engine ?? selectedEngine ?? null;
    if (publishedCreationTargetEngineRef.current === nextEngine) {
      return;
    }
    publishedCreationTargetEngineRef.current = nextEngine;
    onCreationTargetEngineChange?.(nextEngine);
  }, [
    createSessionTargetPicker,
    effectiveCreationTarget?.engine,
    onCreationTargetEngineChange,
    selectedEngine,
  ]);
  useEffect(() => {
    if (!createSessionTargetPicker) {
      return;
    }
    return () => {
      publishedCreationTargetEngineRef.current = undefined;
      pendingPickerEngineRef.current = null;
      onCreationTargetEngineChange?.(null);
    };
  }, [createSessionTargetPicker, onCreationTargetEngineChange]);
  // 全局 selectedEngine 外部变更（启动 restore / 从会话回首页）时，丢掉与其不一致的
  // sticky creation target，否则首页会卡在首屏默认 claude，而会话区已是 grok。
  // 仅依赖 selectedEngine：用户点选时只写 sticky、不立刻改 prop，故不会误清。
  useEffect(() => {
    if (!createSessionTargetPicker || !selectedEngine) {
      return;
    }
    if (pendingPickerEngineRef.current != null) {
      if (pendingPickerEngineRef.current === selectedEngine) {
        // 用户点选已落地，保留 sticky 的 model/profile 细节
        pendingPickerEngineRef.current = null;
        return;
      }
      // parent 走到了别的 engine（外部 restore 或 switch 失败后的回落）
      pendingPickerEngineRef.current = null;
    }
    setSelectedCreationTarget((prev) => {
      if (prev == null || prev.engine === selectedEngine) {
        return prev;
      }
      return null;
    });
  }, [createSessionTargetPicker, selectedEngine]);
  /**
   * Native Atomic 点选的即时投影。
   * Shared 写 selectedNextTarget 即可立刻刷新勾选；Native 若只走 onSelectModel
   * 长链，catalog 分叉时勾选/触发器不更新。用本状态对齐 Shared 的「target 即 UI」。
   * 只覆盖 model 身份；effort 仍跟 selectedEffort prop，避免抢走推理档位选择器。
   */
  const [nativeAtomicSelection, setNativeAtomicSelection] = useState<{
    modelCatalogEntryId: string;
    model: string;
  } | null>(null);
  // 切会话 / 引擎 / 渠道时丢弃点选覆盖，避免串台
  useEffect(() => {
    setNativeAtomicSelection((prev) => (prev === null ? prev : null));
  }, [activeThreadId, selectedEngine, providerProfileId]);
  // Native 会话合成 ExecutionTarget，驱动与首页相同的 Atomic 双栏选中态（含渠道）。
  const nativeSessionTarget = useMemo((): ExecutionTarget | null => {
    if (isSharedSession || createSessionTargetPicker || !selectedEngine) {
      return null;
    }
    const rawProfileId = providerProfileId?.trim() || null;
    // 本地 sentinel 与 Shared 一致：对外投影为 null + disk，避免 __disk__ 被当成 managed
    const isLocalCodexDisk =
      selectedEngine === "codex" &&
      rawProfileId === CODEX_DISK_PROVIDER_PROFILE_ID;
    const isLocalClaude =
      selectedEngine === "claude" &&
      rawProfileId === CLAUDE_LOCAL_PROVIDER_PROFILE_ID;
    const profileId = isLocalCodexDisk || isLocalClaude ? null : rawProfileId;
    const profileName = providerProfileName?.trim() || null;
    const propModelId = selectedModelId?.trim() || null;
    const modelCatalogEntryId =
      nativeAtomicSelection?.modelCatalogEntryId ?? propModelId;
    // runtime 优先 catalog 当前映射，禁止用档位 id / 跨供应商残留冒充 --model。
    const catalogEntry =
      modelCatalogEntryId != null
        ? (models.find((candidate) => candidate.id === modelCatalogEntryId) ??
          null)
        : null;
    const catalogRuntime = catalogEntry?.model?.trim() || null;
    const atomicRuntime = nativeAtomicSelection?.model?.trim() || null;
    const runtimeModel =
      catalogRuntime ||
      (atomicRuntime &&
      atomicRuntime !== modelCatalogEntryId &&
      !/^k3$/i.test(atomicRuntime) &&
      !/^kimi-/i.test(atomicRuntime)
        ? atomicRuntime
        : null) ||
      null;
    return {
      engine: selectedEngine,
      providerProfileId: profileId,
      modelCatalogEntryId,
      model: runtimeModel,
      reasoning: selectedEffort ? { effort: selectedEffort } : null,
      // managed 必须带上创建时供应商名，底栏渠道芯片才能显示 kimi/m3 而非回落 DeepSeek
      providerProfileNameSnapshot: profileId
        ? profileName || profileId
        : LOCAL_PROVIDER_PROFILE_DISPLAY_NAME,
      providerProfileSource: profileId ? "managed" : "disk",
    };
  }, [
    createSessionTargetPicker,
    isSharedSession,
    models,
    nativeAtomicSelection,
    providerProfileId,
    providerProfileName,
    selectedEffort,
    selectedEngine,
    selectedModelId,
  ]);
  // 身份 id-first 纵深防御（fix-shared-session-identity-id-first）：
  // prop 链收敛正确时与 isSharedSession 一致；prop 过期时 shared: id 仍兜底，
  // 保证 shared id 永不进入 native 续接分支。
  const isSharedSessionResolved =
    isSharedSession || isSharedSessionThreadId(activeThreadId);
  const selectedAtomicTarget = isSharedSessionResolved
    ? selectedSharedTarget
    : createSessionTargetPicker
      ? effectiveCreationTarget
      : nativeSessionTarget;
  const [agentArmed, setAgentArmed] = useState(false);
  const agentProjection = useAgentProjection(activeWorkspaceId, activeThreadId);
  const agentTargetSupported = isMultiAgentTargetSupported(
    selectedAtomicTarget?.engine,
  );
  const hasActiveAgentRun = Boolean(
    agentProjection && !isTerminalAgentStatus(agentProjection.status),
  );
  const collabUi = useCollabUiState(activeWorkspaceId, activeThreadId);
  // 协作运行中（含启动/汇总空窗）pill 显示进行中，避免「未开启」误导
  const collabRunActive =
    hasActiveAgentRun ||
    Boolean(
      collabUi &&
        collabUi.phase !== "idle" &&
        collabUi.phase !== "done",
    );
  // 编排执行中锁定主输入区；终态后 collabRunActive 变 false 自动恢复
  const collabLocksComposer = collabRunActive;
  const composerInteractionDisabled = disabled || collabLocksComposer;
  useEffect(() => {
    setAgentArmed(false);
  }, [activeThreadId, activeWorkspaceId]);
  useEffect(() => {
    if (!agentTargetSupported) {
      setAgentArmed(false);
    }
  }, [agentTargetSupported]);
  /**
   * Shared / create-session Atomic：思考档位 options + effort 只信 target 的
   * engine+model。Native Codex 残留的 activeEngine / selectedEffort /
   * reasoningOptions 禁止在 Shared 初始化或 target 短暂为空时回灌 UI。
   */
  const atomicModelReasoningRef = useMemo(() => {
    const target = selectedAtomicTarget;
    if (!target?.engine) {
      return null;
    }
    const catalogEntryId = target.modelCatalogEntryId?.trim() || null;
    const runtimeModel = target.model?.trim() || null;
    if (target.engine !== "codex") {
      return {
        engine: target.engine,
        model: {
          id: catalogEntryId ?? runtimeModel,
          model: runtimeModel ?? catalogEntryId,
        },
      };
    }
    type ModelReasoningLike = {
      id: string;
      model?: string;
      source?: string | null;
      supportedReasoningEfforts?: ModelOption["supportedReasoningEfforts"];
      defaultReasoningEffort?: string | null;
    };
    const catalog = (providerModelCatalogs?.codex ??
      []) as ModelReasoningLike[];
    const parentModels = models as ModelReasoningLike[];
    const matchByIdentity = (entry: ModelReasoningLike) => {
      if (catalogEntryId && entry.id === catalogEntryId) {
        return true;
      }
      if (
        runtimeModel &&
        (entry.model === runtimeModel || entry.id === runtimeModel)
      ) {
        return true;
      }
      return false;
    };
    const matchedCatalog = catalog.find(matchByIdentity) ?? null;
    const matchedParent = parentModels.find(matchByIdentity) ?? null;
    const preferred = matchedCatalog ?? matchedParent;
    return {
      engine: target.engine,
      model: {
        id: catalogEntryId ?? preferred?.id ?? runtimeModel,
        model: runtimeModel ?? preferred?.model ?? catalogEntryId,
        source: preferred?.source ?? undefined,
        supportedReasoningEfforts:
          preferred?.supportedReasoningEfforts &&
          preferred.supportedReasoningEfforts.length > 0
            ? preferred.supportedReasoningEfforts
            : matchedParent?.supportedReasoningEfforts,
        defaultReasoningEffort:
          preferred?.defaultReasoningEffort ??
          matchedParent?.defaultReasoningEffort ??
          null,
      },
    };
  }, [models, providerModelCatalogs, selectedAtomicTarget]);
  const useAtomicReasoningProjection =
    isSharedSessionResolved || Boolean(createSessionTargetPicker);
  const atomicReasoningOptions = useMemo(() => {
    if (!useAtomicReasoningProjection) {
      return reasoningOptions;
    }
    // Shared / create-session：即使 target 尚未 hydrate，也禁止回落父层
    // Native Codex 的全量 options（会带出 xhigh/max/ultra + 脏 effort）。
    if (atomicModelReasoningRef) {
      return resolveAtomicReasoningOptions(
        atomicModelReasoningRef.engine,
        atomicModelReasoningRef.model,
      );
    }
    return [];
  }, [atomicModelReasoningRef, reasoningOptions, useAtomicReasoningProjection]);
  const atomicSelectedEffort = useMemo(() => {
    if (!useAtomicReasoningProjection) {
      return selectedEffort;
    }
    if (!selectedAtomicTarget?.engine) {
      // Shared 无 target：不展示父层 Codex high 等残留
      return null;
    }
    return reconcileAtomicReasoningEffort({
      engine: selectedAtomicTarget.engine,
      model: atomicModelReasoningRef?.model ?? null,
      effort: selectedAtomicTarget.reasoning?.effort ?? null,
    });
  }, [
    atomicModelReasoningRef,
    selectedAtomicTarget,
    selectedEffort,
    useAtomicReasoningProjection,
  ]);
  // Shared：收敛 null/非法 effort（含 Claude/Grok 夹紧 + Codex 播种）。
  useEffect(() => {
    if (
      !isSharedSessionResolved ||
      sharedTargetPickerLocked ||
      !selectedSharedTarget ||
      !isResolvedExecutionTarget(selectedSharedTarget) ||
      !atomicModelReasoningRef
    ) {
      return;
    }
    if (!activeWorkspaceId || !activeThreadId) {
      return;
    }
    const engine = selectedSharedTarget.engine;
    if (engine !== "codex" && engine !== "claude" && engine !== "grok") {
      return;
    }
    const raw = selectedSharedTarget.reasoning?.effort ?? null;
    const normalizedRaw = typeof raw === "string" ? raw.trim() || null : null;
    const reconciled = reconcileAtomicReasoningEffort({
      engine,
      model: atomicModelReasoningRef.model,
      effort: normalizedRaw,
    });
    if (reconciled === normalizedRaw) {
      return;
    }
    // 仅内存收敛：保证本会话 UI/send 一致；下次 hydrate 仍会再 reconcile。
    hydrateSharedTargetState(activeWorkspaceId, activeThreadId, {
      ...selectedSharedTarget,
      reasoning: reconciled ? { effort: reconciled } : null,
    });
  }, [
    activeThreadId,
    activeWorkspaceId,
    atomicModelReasoningRef,
    isSharedSessionResolved,
    selectedSharedTarget,
    sharedTargetPickerLocked,
  ]);
  const imageAttachEngine = useMemo((): EngineType | null => {
    if (isSharedSession && isResolvedExecutionTarget(selectedSharedTarget)) {
      return selectedSharedTarget.engine;
    }
    if (
      createSessionTargetPicker &&
      isResolvedExecutionTarget(effectiveCreationTarget)
    ) {
      return effectiveCreationTarget.engine;
    }
    return selectedEngine ?? null;
  }, [
    createSessionTargetPicker,
    effectiveCreationTarget,
    isSharedSession,
    selectedEngine,
    selectedSharedTarget,
  ]);
  const imageInputSupported = engineSupportsImageInput(imageAttachEngine);
  const notifyImageInputUnsupported = useCallback(() => {
    if (!imageAttachEngine) {
      return;
    }
    pushErrorToast({
      title: t("composer.imageInputUnsupportedTitle", {
        defaultValue: "Image not supported",
      }),
      message: t("composer.imageAttachUnsupported", {
        engine: getEngineImageInputLabel(imageAttachEngine),
        defaultValue:
          "{{engine}} does not support image attachments in this release",
      }),
      durationMs: 3600,
    });
  }, [imageAttachEngine, t]);
  const handleAttachImagesGuarded = useCallback(
    (paths: string[]) => {
      if (!imageInputSupported) {
        notifyImageInputUnsupported();
        return;
      }
      onAttachImages?.(paths);
    },
    [imageInputSupported, notifyImageInputUnsupported, onAttachImages],
  );
  const handlePickImagesGuarded = useCallback(() => {
    if (!imageInputSupported) {
      notifyImageInputUnsupported();
      return;
    }
    onPickImages?.();
  }, [imageInputSupported, notifyImageInputUnsupported, onPickImages]);
  const sharedTargetResolved =
    !isSharedSession || isResolvedExecutionTarget(selectedSharedTarget);
  const effectiveSubmitDisabled = submitDisabled || !sharedTargetResolved;
  const sharedTargetPersistenceByThreadRef = useRef(
    new Map<string, Promise<void>>(),
  );
  const handleSharedTargetChange = useCallback(
    (target: ExecutionTarget) => {
      if (!activeWorkspaceId || !activeThreadId || sharedTargetPickerLocked) {
        return;
      }
      if (!isResolvedExecutionTarget(target)) {
        // CLI / Provider 菜单导航属于 Picker 内部过渡态，不是一次持久化失败。
        // 只有完整 Model row 形成 ResolvedExecutionTarget 后才允许跨过该边界。
        return;
      }
      const workspaceId = activeWorkspaceId;
      const threadId = activeThreadId;
      // 捕获变更前值，用于 persist 失败时回滚。
      const previousState = getSharedTargetState(workspaceId, threadId);
      const previousTarget = previousState.selectedNextTarget;
      // 乐观更新：先 hydrate UI，再异步持久化。
      hydrateSharedTargetState(workspaceId, threadId, target);
      beginSharedTargetPersist(workspaceId, threadId);
      const persistenceKey = `${workspaceId}::${threadId}`;
      const previousPersistence =
        sharedTargetPersistenceByThreadRef.current.get(persistenceKey) ??
        Promise.resolve();
      const currentPersistence = previousPersistence
        .catch(() => undefined)
        .then(async () => {
          const response = await persistSharedSessionSelectedTarget(
            workspaceId,
            threadId,
            target,
          );
          const persistedTarget = resolveBackendAuthoritativeExecutionTarget(
            response,
            target,
          );
          hydrateSharedTargetState(workspaceId, threadId, persistedTarget);
          dispatchSharedSendEvent(workspaceId, threadId, {
            type: "targetRepaired",
          });
        })
        .catch((error) => {
          // 持久化失败：回滚到变更前值。
          hydrateSharedTargetState(
            workspaceId,
            threadId,
            previousTarget ?? null,
          );
          pushErrorToast({
            title: t("sharedSend.selectionPersistFailedTitle"),
            message: t("sharedSend.selectionPersistFailedMessage", {
              reason: error instanceof Error ? error.message : String(error),
            }),
          });
        })
        .finally(() => {
          endSharedTargetPersist(workspaceId, threadId);
        });
      sharedTargetPersistenceByThreadRef.current.set(
        persistenceKey,
        currentPersistence,
      );
      void currentPersistence.finally(() => {
        if (
          sharedTargetPersistenceByThreadRef.current.get(persistenceKey) ===
          currentPersistence
        ) {
          sharedTargetPersistenceByThreadRef.current.delete(persistenceKey);
        }
      });
    },
    [activeThreadId, activeWorkspaceId, sharedTargetPickerLocked, t],
  );
  const handleNativeProviderTargetChange = useCallback(
    (target: ExecutionTarget) => {
      if (
        isSharedSessionResolved ||
        !activeWorkspaceId ||
        !activeThreadId ||
        (target.engine !== "claude" && target.engine !== "codex") ||
        !target.providerProfileId?.trim()
      ) {
        return;
      }
      const snapshot = freezeTurnSnapshot(target);
      requestProviderContinuationDialog({
        workspaceId: activeWorkspaceId,
        sourceSessionId: activeThreadId,
        destination: {
          engine: target.engine,
          providerProfileId: target.providerProfileId,
          modelCatalogEntryId: target.modelCatalogEntryId ?? null,
          model: target.model ?? null,
          reasoningEffort: target.reasoning?.effort ?? null,
          providerProfileNameSnapshot:
            target.providerProfileNameSnapshot ?? null,
          providerProfileSource: snapshot.providerProfileSource ?? null,
          runtimeCapabilityFingerprint:
            target.engine === "claude" ? "echo-checksum" : null,
        },
      });
    },
    [activeThreadId, activeWorkspaceId, isSharedSessionResolved],
  );
  /**
   * Native 会话也走首页同款 Atomic 双栏 picker（含「本地配置」渠道）。
   * 同 engine+profile 只切模型；跨 managed profile 走续接；其余走 engine/model 切换。
   *
   * 同 profile 切模型：先写 nativeAtomicSelection（勾选即时反馈），再 onSelectModel
   * 持久化；不依赖 parent catalog 是否收录该 id（catalog 外自定义名同样生效）。
   */
  const handleNativeAtomicTargetChange = useCallback(
    (target: ExecutionTarget) => {
      if (
        isSharedSessionResolved ||
        createSessionTargetPicker ||
        !selectedEngine
      ) {
        return;
      }
      const currentProvider = selectedEngine as ProviderId;
      const sameProfile = isSameProviderExecutionProfile(
        currentProvider,
        providerProfileId,
        target,
      );
      const catalogEntryId =
        target.modelCatalogEntryId?.trim() || target.model?.trim() || null;
      const runtimeModel = target.model?.trim() || catalogEntryId;
      const nextEffort = target.reasoning?.effort ?? null;
      if (sameProfile) {
        if (catalogEntryId && runtimeModel) {
          setNativeAtomicSelection({
            modelCatalogEntryId: catalogEntryId,
            model: runtimeModel,
          });
          // 持久化用 catalog entry id；自由名与 runtime 通常相同
          onSelectModel(catalogEntryId);
        }
        if (nextEffort !== selectedEffort) {
          onSelectEffort(nextEffort);
        }
        return;
      }
      // 跨渠道时清掉本会话点选覆盖，避免沿用旧模型 id
      setNativeAtomicSelection(null);
      // Claude/Codex 切到 managed 渠道 → Native Provider Continuation
      if (
        (target.engine === "claude" || target.engine === "codex") &&
        target.providerProfileId?.trim()
      ) {
        handleNativeProviderTargetChange(target);
        return;
      }
      if (target.engine !== selectedEngine) {
        onSelectEngine?.(target.engine);
      }
      if (catalogEntryId && runtimeModel) {
        setNativeAtomicSelection({
          modelCatalogEntryId: catalogEntryId,
          model: runtimeModel,
        });
        onSelectModel(catalogEntryId);
      }
      if (nextEffort !== selectedEffort) {
        onSelectEffort(nextEffort);
      }
    },
    [
      createSessionTargetPicker,
      handleNativeProviderTargetChange,
      isSharedSessionResolved,
      onSelectEffort,
      onSelectEngine,
      onSelectModel,
      providerProfileId,
      selectedEffort,
      selectedEngine,
    ],
  );
  const handleCreationTargetChange = useCallback(
    (target: ExecutionTarget) => {
      if (!createSessionTargetPicker || !isResolvedExecutionTarget(target)) {
        return;
      }
      // 首页 engine 选择必须同步全局 activeEngine + client store，否则重启后首页
      // 回落到默认 claude，而项目会话因 thread.engineSource 仍显示上次的 CLI。
      if (target.engine !== selectedEngine) {
        pendingPickerEngineRef.current = target.engine;
        onSelectEngine?.(target.engine);
      }
      setSelectedCreationTarget(target);
    },
    [createSessionTargetPicker, onSelectEngine, selectedEngine],
  );
  // 草稿值直接订阅模块级 store(而非经 app-shell 根 prop 灌入):按键写 store 时
  // 只有 Composer 自身重渲染,不再把整个 app-shell 拖下水。
  const draftText = useComposerDraft(activeThreadId);
  const [text, setText] = useState(draftText);
  const [selectionStart, setSelectionStart] = useState<number | null>(null);
  const [selectedSkillNames, setSelectedSkillNames] = useState<string[]>([]);
  const [selectedCommonsNames, setSelectedCommonsNames] = useState<string[]>(
    [],
  );
  const [selectedManualMemories, setSelectedManualMemories] = useState<
    ManualMemorySelection[]
  >([]);
  const [selectedNoteCards, setSelectedNoteCards] = useState<
    NoteCardSelection[]
  >([]);
  const [memoryReferenceMode, setMemoryReferenceMode] =
    useState<MemoryReferenceMode>("off");
  const [carryOverManualMemoryIds, setCarryOverManualMemoryIds] = useState<
    string[]
  >([]);
  const [retainedManualMemoryIds, setRetainedManualMemoryIds] = useState<
    string[]
  >([]);
  const [carryOverNoteCardIds, setCarryOverNoteCardIds] = useState<string[]>(
    [],
  );
  const [retainedNoteCardIds, setRetainedNoteCardIds] = useState<string[]>([]);
  const [carryOverContextChipKeys, setCarryOverContextChipKeys] = useState<
    string[]
  >([]);
  const [, setRetainedContextChipKeys] = useState<string[]>([]);
  const [selectedInlineFileReferences, setSelectedInlineFileReferences] =
    useState<InlineFileReferenceSelection[]>([]);
  const browserContext = useBrowserContextAttachment(activeWorkspaceId);
  const onClearCodeAnnotationsRef = useRef(onClearCodeAnnotations);
  const [isComposerCollapsed, setIsComposerCollapsed] = useState(false);
  const [dismissedActiveFileReference, setDismissedActiveFileReference] =
    useState<string | null>(null);
  const [openCodeProviderTone, _setOpenCodeProviderTone] = useState<
    "is-ok" | "is-runtime" | "is-fail"
  >("is-fail");
  const [openCodeProviderToneReady, _setOpenCodeProviderToneReady] =
    useState(false);
  const [rewindInFlight, setRewindInFlight] = useState(false);
  const [rewindPreviewState, setRewindPreviewState] =
    useState<ClaudeRewindPreviewState | null>(null);
  const [rewindMode, setRewindMode] =
    useState<RewindMode>("messages-and-files");
  const rewindInFlightRef = useRef(false);
  const handledRewindDialogRequestIdRef = useRef<number | null>(null);
  const handledNoteCardSelectionRequestIdRef = useRef<number | null>(null);
  const lastExpandedHeightRef = useRef(
    Math.max(textareaHeight, COMPOSER_EXPAND_HEIGHT),
  );
  const composerInputInteractionTimerRef = useRef<number | null>(null);
  const [
    isComposerInputInteractionActive,
    setIsComposerInputInteractionActive,
  ] = useState(false);
  const shouldDeferStatusSummary =
    isProcessing && isComposerInputInteractionActive;
  const {
    todos: statusTodos,
    subagents: statusSubagents,
    todoTotal,
    subagentTotal,
    commandTotal,
  } = useStatusPanelData(performanceScopedItems, {
    isCodexEngine,
    activeEngine: selectedEngine ?? null,
    activeThreadId,
    itemsByThread: threadItemsByThread,
    threadParentById,
    threadStatusById,
    deferSummary: shouldDeferStatusSummary,
  });
  // 文件编辑汇总用未 deferred 的 items，保证 AI 改文件时 path 实时出现
  const sessionToolFileChanges = useMemo(() => {
    const byBoundary = buildTurnFileChangesByBoundaryId(items);
    return mergeTurnFileChangesSummaries(byBoundary.values());
  }, [items]);

  // 回合结束后 git 刷新有延迟：短 grace 内仍允许 tool 临时数，避免 pill 闪空
  const [gitOverlayGrace, setGitOverlayGrace] = useState(false);
  useEffect(() => {
    if (isProcessing) {
      setGitOverlayGrace(true);
      return;
    }
    const timer = window.setTimeout(() => setGitOverlayGrace(false), 1600);
    return () => window.clearTimeout(timer);
  }, [isProcessing]);

  // 行统计对齐 git status；进行中/grace 内允许 tool 临时数，稳定后只保留仍 dirty 的 path
  const sessionFileChanges = useMemo(
    () =>
      overlaySessionFileChangesWithGitStats(
        sessionToolFileChanges,
        isGitRepository ? gitChangedFiles : null,
        {
          workspacePath: activeWorkspacePath ?? null,
          allowToolProvisional: Boolean(isProcessing) || gitOverlayGrace,
        },
      ),
    [
      activeWorkspacePath,
      gitChangedFiles,
      gitOverlayGrace,
      isGitRepository,
      isProcessing,
      sessionToolFileChanges,
    ],
  );

  // AI 改文件后尽快刷 git，避免 pill 长期停在 tool 临时数或虚高累加
  const sessionToolFileSignature = useMemo(() => {
    if (!sessionToolFileChanges) return "";
    return sessionToolFileChanges.files
      .map((file) => `${file.path}:${file.additions}:${file.deletions}`)
      .join("|");
  }, [sessionToolFileChanges]);

  useEffect(() => {
    if (!onRequestGitStatusRefresh || !isGitRepository) return;
    if (!sessionToolFileSignature) return;
    const timer = window.setTimeout(() => {
      onRequestGitStatusRefresh();
    }, 450);
    return () => window.clearTimeout(timer);
  }, [
    isGitRepository,
    onRequestGitStatusRefresh,
    sessionToolFileSignature,
  ]);
  const mergePlanIntoTodos =
    isCodexEngine &&
    selectedEngine != null &&
    isEngineCapabilityAvailable(selectedEngine, "collaboration.mode");
  const hasStatusPanelActivity = useMemo(() => {
    const hasLegacyActivity =
      todoTotal > 0 ||
      subagentTotal > 0 ||
      Boolean(sessionFileChanges) ||
      isPlanMode ||
      Boolean(plan);
    if (isCodexEngine) {
      return hasLegacyActivity || commandTotal > 0;
    }
    return hasLegacyActivity;
  }, [
    commandTotal,
    isCodexEngine,
    isPlanMode,
    plan,
    sessionFileChanges,
    subagentTotal,
    todoTotal,
  ]);
  // 底部 dock 已退役；toggle 仅兼容旧 override，默认不再展示。
  const [statusPanelExpanded, setStatusPanelExpanded] = useState(false);
  const previousStatusPanelActivityRef = useRef(hasStatusPanelActivity);
  const internalRef = useRef<HTMLTextAreaElement | null>(null);
  const textareaRef = externalTextareaRef ?? internalRef;
  const chatInputRef = useRef<ChatInputBoxHandle>(null);
  const activeFileReferenceSignature = activeFilePath
    ? activeFileLineRange
      ? `${activeFilePath}:${activeFileLineRange.startLine}-${activeFileLineRange.endLine}`
      : `${activeFilePath}:all`
    : null;
  const rewindSupportedEngine =
    resolveRewindSupportedEngineFromThreadId(activeThreadId);
  const canRewindSession = Boolean(onRewind && rewindSupportedEngine);
  const resetRewindState = useEventCallback(() => {
    if (rewindPreviewState !== null) {
      setRewindPreviewState(null);
    }
    if (rewindMode !== "messages-and-files") {
      setRewindMode("messages-and-files");
    }
  });
  const hasActiveFileReference = Boolean(
    activeFileReferenceSignature &&
    fileReferenceMode === "path" &&
    dismissedActiveFileReference !== activeFileReferenceSignature,
  );

  const selectedSkills = useMemo(
    () => resolveSelectedNamedItems(selectedSkillNames, skills),
    [selectedSkillNames, skills],
  );
  const selectedCommons = useMemo(
    () => resolveSelectedNamedItems(selectedCommonsNames, commands),
    [commands, selectedCommonsNames],
  );
  const selectedOpenCodeDirectCommand = useMemo(() => {
    if (selectedEngine !== "opencode") {
      return null;
    }
    for (const name of selectedCommonsNames) {
      const normalized = normalizeCommandChipName(name);
      if (OPENCODE_DIRECT_COMMANDS.has(normalized)) {
        return normalized;
      }
    }
    return null;
  }, [selectedCommonsNames, selectedEngine]);

  useEffect(() => {
    if (!dismissedActiveFileReference) {
      return;
    }
    if (
      !activeFileReferenceSignature ||
      activeFileReferenceSignature !== dismissedActiveFileReference
    ) {
      setDismissedActiveFileReference(null);
    }
  }, [activeFileReferenceSignature, dismissedActiveFileReference]);

  useEffect(
    () => () => {
      if (composerInputInteractionTimerRef.current !== null) {
        window.clearTimeout(composerInputInteractionTimerRef.current);
      }
    },
    [],
  );

  const markComposerInputInteraction = useCallback(() => {
    setIsComposerInputInteractionActive(true);
    if (composerInputInteractionTimerRef.current !== null) {
      window.clearTimeout(composerInputInteractionTimerRef.current);
    }
    composerInputInteractionTimerRef.current = window.setTimeout(() => {
      setIsComposerInputInteractionActive(false);
      composerInputInteractionTimerRef.current = null;
    }, COMPOSER_INPUT_INTERACTION_IDLE_MS);
  }, []);

  const activeFileLinesLabel = useMemo(() => {
    if (!activeFileLineRange) {
      return undefined;
    }
    if (activeFileLineRange.startLine === activeFileLineRange.endLine) {
      return `L${activeFileLineRange.startLine}`;
    }
    return `L${activeFileLineRange.startLine}-${activeFileLineRange.endLine}`;
  }, [activeFileLineRange]);

  const selectedChatInputAgent = useMemo<ChatInputSelectedAgent | null>(() => {
    if (selectedEngine === "opencode") {
      if (!selectedOpenCodeAgent) {
        return null;
      }
      const matchedAgent = opencodeAgents.find(
        (agent) => agent.id === selectedOpenCodeAgent,
      );
      return {
        id: selectedOpenCodeAgent,
        name: selectedOpenCodeAgent,
        prompt: matchedAgent?.description,
      };
    }
    return selectedAgent;
  }, [opencodeAgents, selectedAgent, selectedEngine, selectedOpenCodeAgent]);
  const opencodeDisconnected =
    selectedEngine === "opencode" &&
    openCodeProviderToneReady &&
    openCodeProviderTone === "is-fail";

  const contextSelectionChips = useMemo<ContextSelectionChip[]>(
    () => [
      ...selectedSkills.map((skill) => ({
        type: "skill" as const,
        name: skill.name,
        description: skill.description,
        path: skill.path,
        source: skill.source,
      })),
      ...selectedCommons.map((item) => ({
        type: "commons" as const,
        name: item.name,
        description: item.description,
        path: item.path,
        source: item.source,
      })),
    ],
    [selectedCommons, selectedSkills],
  );

  useEffect(() => {
    onClearCodeAnnotationsRef.current = onClearCodeAnnotations;
  }, [onClearCodeAnnotations]);

  const clearComposerContextSelections = useCallback(() => {
    setSelectedSkillNames(keepArrayWhenEmpty);
    setSelectedCommonsNames(keepArrayWhenEmpty);
    setSelectedManualMemories(keepArrayWhenEmpty);
    setSelectedNoteCards(keepArrayWhenEmpty);
    setSelectedInlineFileReferences(keepArrayWhenEmpty);
    onClearCodeAnnotationsRef.current?.();
    setCarryOverManualMemoryIds(keepArrayWhenEmpty);
    setRetainedManualMemoryIds(keepArrayWhenEmpty);
    setCarryOverNoteCardIds(keepArrayWhenEmpty);
    setRetainedNoteCardIds(keepArrayWhenEmpty);
    setCarryOverContextChipKeys(keepArrayWhenEmpty);
    setRetainedContextChipKeys(keepArrayWhenEmpty);
    setMemoryReferenceMode("off");
  }, []);
  useEffect(() => {
    if (textareaHeight > COMPOSER_MIN_HEIGHT) {
      lastExpandedHeightRef.current = textareaHeight;
    }
  }, [textareaHeight]);

  useEffect(() => {
    if (statusPanelExpandedOverride !== undefined) {
      return;
    }
    const hadActivity = previousStatusPanelActivityRef.current;
    if (!hasStatusPanelActivity) {
      setStatusPanelExpanded((prev) => (prev ? false : prev));
    } else if (!hadActivity) {
      setStatusPanelExpanded((prev) => (prev ? prev : true));
    }
    previousStatusPanelActivityRef.current = hasStatusPanelActivity;
  }, [hasStatusPanelActivity, statusPanelExpandedOverride]);

  useEffect(() => {
    clearComposerContextSelections();
  }, [activeThreadId, activeWorkspaceId, clearComposerContextSelections]);

  useEffect(() => {
    if (!pendingCodeAnnotation) {
      return;
    }
    const dedupeKey = buildCodeAnnotationDedupeKey(pendingCodeAnnotation);
    if (!dedupeKey) {
      onCodeAnnotationConsumed?.(dedupeKey);
      return;
    }
    onCodeAnnotationConsumed?.(dedupeKey);
  }, [onCodeAnnotationConsumed, pendingCodeAnnotation]);

  useEffect(() => {
    resetRewindState();
  }, [activeThreadId, resetRewindState]);

  useEffect(() => {
    if (!canRewindSession) {
      resetRewindState();
    }
  }, [canRewindSession, resetRewindState]);

  const handleExpandComposer = useCallback(() => {
    setIsComposerCollapsed(false);
    onTextareaHeightChange?.(
      Math.max(lastExpandedHeightRef.current, COMPOSER_EXPAND_HEIGHT),
    );
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }, [onTextareaHeightChange, textareaRef]);

  useEffect(() => {
    setText((prev) => (prev === draftText ? prev : draftText));
  }, [draftText]);

  // text / draft / catalog 经 ref 读：setComposerText 保持稳定 identity，
  // extract effect 不得因 onDraftChange / skills / commands 引用抖动重入（#185 AP-04）。
  const textRef = useRef(text);
  textRef.current = text;
  const onDraftChangeRef = useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;
  const selectedInlineFileReferencesRef = useRef(selectedInlineFileReferences);
  selectedInlineFileReferencesRef.current = selectedInlineFileReferences;
  const skillsRef = useRef(skills);
  skillsRef.current = skills;
  const commandsRef = useRef(commands);
  commandsRef.current = commands;

  const setComposerText = useCallback((next: string) => {
    // 等价值短路：禁止 text→draft→text 虚写叠 nested update
    if (textRef.current === next) {
      return;
    }
    textRef.current = next;
    setText(next);
    onDraftChangeRef.current?.(next);
  }, []);

  useEffect(() => {
    // 只订阅 text：selection / skills / commands 读 ref。
    // 旧 deps 含 selectedInlineFileReferences 时，即便 merge 幂等，
    // 父树 skills 引用抖动 + 同 tick 多 setState 仍可能叠满 #185（0.7.16 / App-DjQ3UnSh）。
    const existingReferenceIds = new Set(
      selectedInlineFileReferencesRef.current
        .filter((entry) => text.includes(entry.label))
        .map((entry) => entry.id),
    );
    const { cleanedText, extracted } = extractInlineFileReferenceTokens(
      text,
      existingReferenceIds,
    );
    if (extracted.length > 0) {
      // mergeInlineFileReferences：无新增保持原引用
      setSelectedInlineFileReferences((prev) =>
        mergeInlineFileReferences(prev, extracted),
      );
    }
    if (cleanedText !== text) {
      setComposerText(cleanedText);
      return;
    }
    const {
      cleanedText: cleanedSelectionText,
      matchedSkillNames,
      matchedCommonsNames,
    } = extractInlineSelections(text, skillsRef.current, commandsRef.current);
    if (matchedSkillNames.length > 0) {
      setSelectedSkillNames((prev) =>
        mergeUniqueNames(prev, matchedSkillNames),
      );
    }
    if (matchedCommonsNames.length > 0) {
      setSelectedCommonsNames((prev) =>
        mergeUniqueNames(prev, matchedCommonsNames),
      );
    }
    if (cleanedSelectionText !== text) {
      setComposerText(cleanedSelectionText);
    }
  }, [setComposerText, text]);

  const handleSelectManualMemory = useCallback(
    (memory: ManualMemorySelection) => {
      setSelectedManualMemories((prev) => {
        if (prev.some((entry) => entry.id === memory.id)) {
          setCarryOverManualMemoryIds((ids) =>
            ids.filter((entryId) => entryId !== memory.id),
          );
          return prev.filter((entry) => entry.id !== memory.id);
        }
        return [...prev, memory];
      });
    },
    [],
  );

  const handleSelectNoteCard = useCallback((noteCard: NoteCardSelection) => {
    setSelectedNoteCards((prev) => {
      if (prev.some((entry) => entry.id === noteCard.id)) {
        setCarryOverNoteCardIds((ids) =>
          ids.filter((entryId) => entryId !== noteCard.id),
        );
        return prev.filter((entry) => entry.id !== noteCard.id);
      }
      return [...prev, noteCard];
    });
  }, []);

  useEffect(() => {
    if (
      !externalNoteCardSelectionRequest ||
      handledNoteCardSelectionRequestIdRef.current ===
        externalNoteCardSelectionRequest.requestId
    ) {
      return;
    }
    handledNoteCardSelectionRequestIdRef.current =
      externalNoteCardSelectionRequest.requestId;
    const requestedNoteCard = externalNoteCardSelectionRequest.noteCard;
    setSelectedNoteCards((previous) =>
      previous.some((entry) => entry.id === requestedNoteCard.id)
        ? previous
        : [...previous, requestedNoteCard],
    );
    chatInputRef.current?.focus();
  }, [externalNoteCardSelectionRequest]);

  const handleSelectSkill = useCallback((skillName: string) => {
    const normalized = skillName.trim();
    if (!normalized) {
      return;
    }
    setSelectedSkillNames((prev) => {
      if (prev.includes(normalized)) {
        setCarryOverContextChipKeys((keys) =>
          keys.filter((entry) => entry !== `skill:${normalized}`),
        );
        return prev.filter((entry) => entry !== normalized);
      }
      return mergeUniqueNames(prev, [normalized]);
    });
  }, []);

  const handleRemoveContextChip = useCallback((chip: ContextSelectionChip) => {
    const carryOverKey = toContextChipCarryOverKey(chip);
    setCarryOverContextChipKeys((prev) =>
      prev.filter((entry) => entry !== carryOverKey),
    );
    setRetainedContextChipKeys((prev) =>
      prev.filter((entry) => entry !== carryOverKey),
    );
    if (chip.type === "skill") {
      setSelectedSkillNames((prev) =>
        prev.filter((name) => name !== chip.name),
      );
      return;
    }
    setSelectedCommonsNames((prev) =>
      prev.filter((name) => name !== chip.name),
    );
  }, []);

  const { isAutocompleteOpen, handleTextChange, handleSelectionChange } =
    useComposerAutocompleteState({
      text,
      selectionStart,
      setText: setComposerText,
      setSelectionStart,
    });
  const reviewPromptOpen = Boolean(reviewPrompt);
  const suggestionsOpen = reviewPromptOpen || isAutocompleteOpen;

  const handleTextChangeWithHistory = useCallback(
    (next: string, cursor: number | null) => {
      markComposerInputInteraction();
      handleTextChange(next, cursor);
    },
    [handleTextChange, markComposerInputInteraction],
  );

  const applyActiveFileReference = useCallback(
    (message: string) => {
      if (!(
        hasActiveFileReference &&
        fileReferenceMode === "path" &&
        activeFilePath
      )) {
        return message;
      }
      const referenceTarget = activeFileLineRange
        ? `${activeFilePath}#L${activeFileLineRange.startLine}-L${activeFileLineRange.endLine}`
        : activeFilePath;
      if (
        message.includes(referenceTarget) ||
        message.includes(activeFilePath)
      ) {
        return message;
      }
      return `@file \`${referenceTarget}\`\n${message}`.trim();
    },
    [
      activeFileLineRange,
      activeFilePath,
      fileReferenceMode,
      hasActiveFileReference,
    ],
  );

  const handleClearContext = useCallback(() => {
    if (activeFileReferenceSignature) {
      setDismissedActiveFileReference(activeFileReferenceSignature);
    }
  }, [activeFileReferenceSignature]);

  const handleAgentSelect = useCallback(
    (agent: ChatInputSelectedAgent | null) => {
      if (selectedEngine === "opencode") {
        onSelectOpenCodeAgent?.(agent?.id ?? null);
        return;
      }
      onAgentSelect?.(agent);
    },
    [onAgentSelect, onSelectOpenCodeAgent, selectedEngine],
  );

  const handleModeSelect = useCallback(
    (mode: PermissionMode) => {
      onSelectAccessMode(permissionModeToAccessMode(mode));
    },
    [onSelectAccessMode],
  );

  const handleToggleStatusPanel = useCallback(() => {
    setStatusPanelExpanded((prev) => !prev);
  }, []);
  const resolvedShowStatusPanelToggle = showStatusPanelToggleOverride ?? false;
  const resolvedStatusPanelExpanded =
    statusPanelExpandedOverride ?? statusPanelExpanded;
  const resolvedToggleStatusPanel =
    onToggleStatusPanelOverride ?? handleToggleStatusPanel;
  const handleCancelRewind = useCallback(() => {
    if (rewindInFlight) {
      return;
    }
    setRewindPreviewState(null);
    setRewindMode("messages-and-files");
  }, [rewindInFlight]);

  const openRewindDialogForMessage = useCallback(
    (userMessageId: string) => {
      if (rewindInFlightRef.current || rewindInFlight) {
        return;
      }
      if (!canRewindSession || !onRewind) {
        pushErrorToast({
          title: t("rewind.title"),
          message: t("rewind.notAvailable"),
        });
        return;
      }
      const preview = buildRewindPreviewForMessage(
        items,
        userMessageId,
        activeThreadId,
        selectedEngine,
      );
      if (!preview) {
        pushErrorToast({
          title: t("rewind.title"),
          message: t("rewind.noEligibleMessage"),
        });
        return;
      }
      setRewindMode("messages-and-files");
      setRewindPreviewState(preview);
    },
    [
      activeThreadId,
      canRewindSession,
      items,
      onRewind,
      rewindInFlight,
      selectedEngine,
      t,
    ],
  );

  const handleRewind = useCallback(() => {
    if (rewindInFlightRef.current || rewindInFlight) {
      return;
    }
    if (canRewindSession && onRewind) {
      const preview = buildLatestRewindPreview(
        items,
        activeThreadId,
        selectedEngine,
      );
      if (!preview) {
        pushErrorToast({
          title: t("rewind.title"),
          message: t("rewind.noEligibleMessage"),
        });
        return;
      }
      setRewindMode("messages-and-files");
      setRewindPreviewState(preview);
      return;
    }
    pushErrorToast({
      title: t("rewind.title"),
      message: t("rewind.notAvailable"),
    });
  }, [
    activeThreadId,
    canRewindSession,
    items,
    onRewind,
    rewindInFlight,
    selectedEngine,
    t,
  ]);

  useEffect(() => {
    if (!rewindDialogRequest) {
      return;
    }
    if (
      handledRewindDialogRequestIdRef.current === rewindDialogRequest.requestId
    ) {
      return;
    }
    handledRewindDialogRequestIdRef.current = rewindDialogRequest.requestId;
    openRewindDialogForMessage(rewindDialogRequest.userMessageId);
    onRewindDialogRequestConsumed?.(rewindDialogRequest.requestId);
  }, [
    onRewindDialogRequestConsumed,
    openRewindDialogForMessage,
    rewindDialogRequest,
  ]);

  const handleConfirmRewind = useCallback(async () => {
    const preview = rewindPreviewState;
    if (!preview) {
      return;
    }
    if (!onRewind) {
      pushErrorToast({
        title: t("rewind.title"),
        message: t("rewind.notAvailable"),
      });
      setRewindPreviewState(null);
      setRewindMode("messages-and-files");
      return;
    }
    if (rewindInFlightRef.current || rewindInFlight) {
      return;
    }

    rewindInFlightRef.current = true;
    try {
      setRewindInFlight(true);
      await onRewind(preview.targetMessageId, { mode: rewindMode });
      setRewindPreviewState(null);
      setRewindMode("messages-and-files");
    } catch (error) {
      pushErrorToast({
        title: t("rewind.title"),
        message:
          (error instanceof Error ? error.message : String(error)) ||
          t("rewind.failed"),
      });
    } finally {
      setRewindInFlight(false);
      rewindInFlightRef.current = false;
    }
  }, [onRewind, rewindMode, rewindInFlight, rewindPreviewState, t]);

  const handleStoreRewindChanges = useCallback(
    async (preview: ClaudeRewindPreviewState) => {
      const workspaceId = activeWorkspaceId?.trim() ?? "";
      const sessionId = preview.sessionId?.trim() ?? "";
      if (!workspaceId || !sessionId) {
        throw new Error(t("rewind.storeUnavailable"));
      }
      const filesByPath = new Map<
        string,
        { path: string; status?: RewindFileChangeStatus }
      >();
      for (const file of preview.affectedFiles) {
        const path = normalizeRewindExportPath(file.filePath);
        const dedupeKey = toRewindPathDedupeKey(file.filePath);
        if (!path || !dedupeKey) {
          continue;
        }
        const existing = filesByPath.get(dedupeKey);
        if (!existing) {
          filesByPath.set(dedupeKey, { path, status: file.status });
          continue;
        }
        const currentStatus = existing.status ?? "M";
        const incomingStatus = file.status ?? "M";
        existing.status = resolvePreferredStatus(currentStatus, incomingStatus);
      }
      const exportFiles = Array.from(filesByPath.values());
      if (exportFiles.length === 0) {
        throw new Error(t("rewind.filesEmpty"));
      }
      return exportRewindFiles({
        workspaceId,
        engine: preview.engine,
        sessionId,
        targetMessageId: preview.targetMessageId,
        conversationLabel: preview.conversationLabel,
        files: exportFiles,
      });
    },
    [activeWorkspaceId, t],
  );

  const handleManualCompactContext = useCallback(async () => {
    if (selectedEngine !== "codex") {
      return;
    }
    if (!activeWorkspaceId || !activeThreadId || !onRequestContextCompaction) {
      pushErrorToast({
        title: t("chat.contextDualViewManualCompact"),
        message: t("chat.contextDualViewManualCompactUnavailable"),
      });
      return;
    }
    try {
      await onRequestContextCompaction();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushErrorToast({
        title: t("chat.contextDualViewManualCompact"),
        message: message || t("chat.contextDualViewManualCompactFailed"),
      });
    }
  }, [
    activeThreadId,
    activeWorkspaceId,
    onRequestContextCompaction,
    selectedEngine,
    t,
  ]);

  const handleCodexQuickCommand = useCallback(
    (command: string) => {
      if (disabled || effectiveSubmitDisabled || collabLocksComposer) {
        return;
      }
      const normalized = command.trim().toLowerCase();
      const isReviewCommand = /^\/review\b/.test(normalized);
      const isFastCommand = /^\/fast\b/.test(normalized);
      if (isFastCommand && selectedEngine !== "codex") {
        return;
      }
      if (isReviewCommand && !isReviewQuickActionEngine) {
        return;
      }
      if (!isReviewCommand && !isFastCommand && selectedEngine !== "codex") {
        return;
      }
      void onSend(command, []);
    },
    [
      collabLocksComposer,
      disabled,
      effectiveSubmitDisabled,
      isReviewQuickActionEngine,
      onSend,
      selectedEngine,
    ],
  );

  const handleForkQuickStart = useCallback(() => {
    if (disabled || effectiveSubmitDisabled || collabLocksComposer) {
      return;
    }
    if (onForkQuickStart) {
      onForkQuickStart();
      return;
    }
    if (selectedEngine !== "codex" && selectedEngine !== "claude") {
      return;
    }
    void onSend("/fork", []);
  }, [
    collabLocksComposer,
    disabled,
    effectiveSubmitDisabled,
    onForkQuickStart,
    onSend,
    selectedEngine,
  ]);

  const handleSend = useCallback(
    (submittedText?: string, submittedImages?: string[]) => {
      if (disabled || effectiveSubmitDisabled || collabLocksComposer) {
        return;
      }
      if (opencodeDisconnected) {
        pushErrorToast({
          title: "OpenCode 未连接",
          message:
            "当前连接状态为红色，请先在 OpenCode 管理面板完成连接后再发送。",
        });
        return;
      }
      const trimmed = (submittedText ?? text).trim();
      // Merge images from Composer state (file picker) and ChatInputBox (paste/drop)
      const mergedImages = sanitizeImageAttachmentPaths([
        ...attachedImages,
        ...(submittedImages ?? []),
      ]);
      const hasIntentCanvasAttachments = intentCanvasAttachments.length > 0;
      if (
        !trimmed &&
        mergedImages.length === 0 &&
        !selectedOpenCodeDirectCommand &&
        !hasIntentCanvasAttachments
      ) {
        return;
      }
      const isAgentSubmission = agentArmed;
      if (isAgentSubmission) {
        // Shared 内用户已启用协作：不再用 feature flag 拦截；
        // 边界只看 shared 身份 + 完整 target（native 永不会走到 arm）。
        if (
          !isSharedSessionResolved ||
          !isResolvedExecutionTarget(selectedAtomicTarget)
        ) {
          pushErrorToast({
            title: t("multiAgent.errors.unavailableTitle"),
            message: t("multiAgent.errors.incompleteTarget"),
          });
          return;
        }
        if (!isMultiAgentTargetSupported(selectedAtomicTarget.engine)) {
          setAgentArmed(false);
          pushErrorToast({
            title: t("multiAgent.errors.unavailableTitle"),
            message: t("multiAgent.errors.targetUnavailable"),
          });
          return;
        }
        // 图片：Context Fan-in 进首段，已放行。
        // Browser Context / Intent Canvas 尚未并入协作首段注入链，暂仍拦截。
        if (hasIntentCanvasAttachments || Boolean(browserContext.attachment)) {
          pushErrorToast({
            title: t("multiAgent.errors.attachmentsTitle"),
            message: t("multiAgent.errors.attachments"),
          });
          return;
        }
      }
      // Composer-side capability gate: keep draft when engine cannot accept images.
      // Current engines are all image-capable; retained for future unsupported engines.
      if (
        mergedImages.length > 0 &&
        imageAttachEngine &&
        !engineSupportsImageInput(imageAttachEngine)
      ) {
        pushErrorToast({
          title: t("composer.imageInputUnsupportedTitle", {
            defaultValue: "Image not supported",
          }),
          message: formatEngineImageInputUnsupportedMessage(
            imageAttachEngine,
            // i18next TFunction is wider than our helper; keep runtime options intact.
            t as (key: string, options?: Record<string, unknown>) => string,
          ),
          durationMs: 4200,
        });
        // ChatInputBox clears before onSubmit; restore Composer-owned draft + images.
        setComposerText(submittedText ?? text);
        onAttachImages?.(mergedImages);
        return;
      }
      const browserNavigationUrl =
        mergedImages.length === 0 && !hasIntentCanvasAttachments
          ? resolveBrowserNavigationUrl(trimmed)
          : null;
      if (browserNavigationUrl && activeWorkspaceId) {
        window.sessionStorage.setItem(
          PENDING_BROWSER_URL_KEY,
          browserNavigationUrl,
        );
        window.dispatchEvent(new CustomEvent(BROWSER_OPEN_DOCK_EVENT));
        window.dispatchEvent(
          new CustomEvent(BROWSER_OPEN_URL_EVENT, {
            detail: { url: browserNavigationUrl },
          }),
        );
        clearComposerContextSelections();
        setComposerText("");
        return;
      }
      if (selectedOpenCodeDirectCommand) {
        onSend(`/${selectedOpenCodeDirectCommand}`, []);
        clearComposerContextSelections();
        setComposerText("");
        return;
      }
      const shouldAssembleSelectedSkills = shouldAssemblePrompt({
        userInput: trimmed,
        selectedSkillCount: selectedSkills.length,
        selectedCommonsCount: selectedCommons.length,
      });
      const finalText = shouldAssembleSelectedSkills
        ? assembleSinglePrompt({
            userInput: trimmed,
            skills: selectedSkills,
            commons: selectedCommons.map((item) => ({ name: item.name })),
          })
        : trimmed;
      // 结构化契约与降级文本同源于一次组装：仅在真正发生拼接时下发。
      const skillInvocations = shouldAssembleSelectedSkills
        ? assembleSkillInvocations({
            skills: selectedSkills,
            commons: selectedCommons.map((item) => ({
              name: item.name,
              path: item.path,
            })),
          })
        : [];
      // managed 目录命令引擎不可见，发送前在客户端展开为正文。
      const expandedFinalText = expandLeadingManagedCommand(
        finalText,
        commands,
      );
      const finalTextWithReference =
        applyActiveFileReference(expandedFinalText);
      const resolvedFinalText = replaceVisibleFileReferenceLabels(
        normalizeInlineFileReferenceTokens(finalTextWithReference),
        selectedInlineFileReferences,
      );
      const resolvedFinalTextWithAnnotations = appendCodeAnnotationsToPrompt(
        resolvedFinalText,
        selectedCodeAnnotations,
      );
      const selectedMemoryIds = selectedManualMemories.map((entry) => entry.id);
      const selectedNoteCardIds = selectedNoteCards.map((entry) => entry.id);
      const selectedMemoryInjectionMode = getManualMemoryInjectionMode();
      const shouldReferenceMemory = memoryReferenceMode !== "off";
      // Context Fan-in（§8.6）：协作不再整类拦截 skill/记忆/便签；注入由发送链路首段消化。
      const browserContextAttachment = browserContext.attachment;
      const hasBrowserContextAttachment = Boolean(browserContextAttachment);
      const createSessionTarget =
        createSessionTargetPicker &&
        isResolvedExecutionTarget(effectiveCreationTarget)
          ? {
              engine: effectiveCreationTarget.engine,
              providerProfileId:
                effectiveCreationTarget.providerProfileId?.trim() || null,
              providerProfileName:
                effectiveCreationTarget.providerProfileNameSnapshot,
              providerProfileSource:
                effectiveCreationTarget.providerProfileSource,
              modelCatalogEntryId: effectiveCreationTarget.modelCatalogEntryId,
              model: effectiveCreationTarget.model,
              effort: effectiveCreationTarget.reasoning?.effort ?? null,
            }
          : null;
      const sendOptions: MessageSendOptions | undefined =
        skillInvocations.length > 0 ||
        selectedMemoryIds.length > 0 ||
        selectedNoteCardIds.length > 0 ||
        shouldReferenceMemory ||
        hasBrowserContextAttachment ||
        createSessionTarget !== null ||
        isAgentSubmission
          ? {
              ...(skillInvocations.length > 0 ? { skillInvocations } : {}),
              ...(shouldReferenceMemory
                ? { memoryReferenceEnabled: true }
                : {}),
              ...(selectedMemoryIds.length > 0
                ? { selectedMemoryIds, selectedMemoryInjectionMode }
                : {}),
              ...(selectedNoteCardIds.length > 0
                ? { selectedNoteCardIds }
                : {}),
              ...(browserContextAttachment ? { browserContextAttachment } : {}),
              ...(createSessionTarget ? { createSessionTarget } : {}),
              ...(isAgentSubmission &&
              isResolvedExecutionTarget(selectedAtomicTarget)
                ? {
                    squadRequest: true as const,
                    sharedExecutionTarget: {
                      engine: selectedAtomicTarget.engine,
                      providerProfileId:
                        selectedAtomicTarget.providerProfileId?.trim() || null,
                      modelCatalogEntryId:
                        selectedAtomicTarget.modelCatalogEntryId,
                      model: selectedAtomicTarget.model,
                      reasoning: selectedAtomicTarget.reasoning
                        ? { ...selectedAtomicTarget.reasoning }
                        : null,
                      providerProfileNameSnapshot:
                        selectedAtomicTarget.providerProfileNameSnapshot,
                      providerProfileSource:
                        selectedAtomicTarget.providerProfileSource,
                    },
                  }
                : {}),
            }
          : undefined;
      const sendResult = onSend(
        resolvedFinalTextWithAnnotations,
        mergedImages,
        sendOptions,
      );
      if (isAgentSubmission) {
        setAgentArmed(false);
      }
      if (browserContextAttachment) {
        browserContext.remove();
      }
      const retainedManualMemories = filterRetainedEntries(
        selectedManualMemories,
        carryOverManualMemoryIds,
      );
      const retainedNoteCards = filterRetainedEntries(
        selectedNoteCards,
        carryOverNoteCardIds,
      );
      const retainedSkillNames = filterRetainedChipNames(
        selectedSkillNames,
        carryOverContextChipKeys,
        "skill",
      );
      const retainedCommonsNames = filterRetainedChipNames(
        selectedCommonsNames,
        carryOverContextChipKeys,
        "commons",
      );
      const nextRetainedContextChipKeys = buildRetainedContextChipKeys(
        retainedSkillNames,
        retainedCommonsNames,
      );
      setSelectedSkillNames([]);
      setSelectedCommonsNames([]);
      void Promise.resolve(sendResult)
        .catch((error: unknown) => {
          if (!isAgentSubmission) {
            throw error;
          }
          setComposerText(submittedText ?? text);
          setAgentArmed(true);
          const diagnostic =
            error instanceof Error ? error.message : String(error);
          let message = t("multiAgent.errors.startFailedDiagnostic", {
            diagnostic,
          });
          if (diagnostic.startsWith("agent-request-busy:")) {
            message = t("multiAgent.errors.busy");
          } else if (diagnostic.startsWith("agent-run-conflict:")) {
            message = t("multiAgent.entry.activeRun");
          } else if (
            diagnostic.startsWith("agent-request-images-unsupported:")
          ) {
            message = t("multiAgent.errors.attachments");
          } else if (
            diagnostic.startsWith("agent-request-context-unsupported:")
          ) {
            message = t("multiAgent.errors.contextUnsupportedTitle");
          } else if (
            diagnostic.includes("target-capability-unavailable") ||
            diagnostic.startsWith("agent-request-target-unavailable:")
          ) {
            message = t("multiAgent.errors.targetUnavailable");
          } else if (diagnostic.startsWith("agent-disabled:")) {
            // 勿再映射成 incompleteTarget，避免「配置正确却报 CLI 不完整」
            message = t("multiAgent.errors.featureDisabled");
          } else if (
            diagnostic.startsWith("agent-request-target-incomplete:") ||
            diagnostic.startsWith("agent-request-unavailable:") ||
            diagnostic.startsWith("invalid-target:") ||
            diagnostic.includes("shared-v2-target-incomplete")
          ) {
            message = t("multiAgent.errors.incompleteTarget");
          }
          pushErrorToast({
            title: t("multiAgent.errors.startFailed"),
            message,
            durationMs: 5_000,
          });
        })
        .finally(() => {
          setSelectedManualMemories(retainedManualMemories);
          setSelectedNoteCards(retainedNoteCards);
          setSelectedInlineFileReferences([]);
          onClearCodeAnnotations?.();
          setSelectedSkillNames(retainedSkillNames);
          setSelectedCommonsNames(retainedCommonsNames);
          setRetainedManualMemoryIds(
            retainedManualMemories.map((entry) => entry.id),
          );
          setRetainedNoteCardIds(retainedNoteCards.map((entry) => entry.id));
          setRetainedContextChipKeys(nextRetainedContextChipKeys);
          setCarryOverManualMemoryIds([]);
          setCarryOverNoteCardIds([]);
          setCarryOverContextChipKeys([]);
          setMemoryReferenceMode((currentMode) =>
            currentMode === "single" ? "off" : currentMode,
          );
        });
      setComposerText("");
    },
    [
      attachedImages,
      activeWorkspaceId,
      browserContext,
      createSessionTargetPicker,
      effectiveCreationTarget,
      collabLocksComposer,
      disabled,
      effectiveSubmitDisabled,
      imageAttachEngine,
      intentCanvasAttachments.length,
      applyActiveFileReference,
      commands,
      opencodeDisconnected,
      selectedOpenCodeDirectCommand,
      selectedCommons,
      selectedSkills,
      selectedInlineFileReferences,
      selectedCodeAnnotations,
      onAttachImages,
      onClearCodeAnnotations,
      selectedManualMemories,
      selectedNoteCards,
      memoryReferenceMode,
      onSend,
      setComposerText,
      selectedCommonsNames,
      selectedSkillNames,
      setSelectedManualMemories,
      t,
      text,
      agentArmed,
      isSharedSessionResolved,
      selectedAtomicTarget,
      carryOverContextChipKeys,
      carryOverManualMemoryIds,
      carryOverNoteCardIds,
      clearComposerContextSelections,
    ],
  );

  const handleRemoveManualMemory = useCallback((memoryId: string) => {
    setCarryOverManualMemoryIds((prev) =>
      prev.filter((entryId) => entryId !== memoryId),
    );
    setRetainedManualMemoryIds((prev) =>
      prev.filter((entryId) => entryId !== memoryId),
    );
    setSelectedManualMemories((prev) =>
      prev.filter((entry) => entry.id !== memoryId),
    );
  }, []);

  const handleRemoveNoteCard = useCallback((noteCardId: string) => {
    setCarryOverNoteCardIds((prev) =>
      prev.filter((entryId) => entryId !== noteCardId),
    );
    setRetainedNoteCardIds((prev) =>
      prev.filter((entryId) => entryId !== noteCardId),
    );
    setSelectedNoteCards((prev) =>
      prev.filter((entry) => entry.id !== noteCardId),
    );
  }, []);

  const handleRemoveCodeAnnotation = useCallback(
    (annotationId: string) => {
      onRemoveCodeAnnotation?.(annotationId);
    },
    [onRemoveCodeAnnotation],
  );

  useEffect(() => {
    if (!prefillDraft) {
      return;
    }
    setComposerText(prefillDraft.text);
    onPrefillHandled?.(prefillDraft.id);
  }, [onPrefillHandled, prefillDraft, setComposerText]);

  useEffect(() => {
    if (!insertText) {
      return;
    }
    setComposerText(insertText.text);
    onInsertHandled?.(insertText.id);
  }, [insertText, onInsertHandled, setComposerText]);

  useEffect(() => {
    if (!dictationTranscript) {
      return;
    }
    const textToInsert = dictationTranscript.text.trim();
    if (!textToInsert) {
      onDictationTranscriptHandled?.(dictationTranscript.id);
      return;
    }
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? selectionStart ?? text.length;
    const end = textarea?.selectionEnd ?? start;
    const { nextText, nextCursor } = computeDictationInsertion(
      text,
      textToInsert,
      start,
      end,
    );
    setComposerText(nextText);
    requestAnimationFrame(() => {
      if (!textareaRef.current) {
        return;
      }
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(nextCursor, nextCursor);
      handleSelectionChange(nextCursor);
    });
    onDictationTranscriptHandled?.(dictationTranscript.id);
  }, [
    dictationTranscript,
    handleSelectionChange,
    onDictationTranscriptHandled,
    selectionStart,
    setComposerText,
    text,
    textareaRef,
  ]);

  const claudeContextUsage = useMemo<ClaudeContextUsageViewModel | null>(() => {
    if (!contextUsage || selectedEngine !== "claude") {
      return null;
    }
    const usedTokens = resolveClaudeWindowUsedTokens(contextUsage);
    // CLI 没上报窗口总量时按模型估算兜底，让占用百分比可以计算。
    const contextWindow =
      finitePositive(contextUsage.modelContextWindow) ??
      (usedTokens !== null
        ? estimateClaudeContextWindow(selectedModelId)
        : null);
    const totalTokens = finiteNonNegative(contextUsage.total.totalTokens);
    const inputTokens = finiteNonNegative(contextUsage.total.inputTokens);
    const cachedInputTokens = finiteNonNegative(
      contextUsage.total.cachedInputTokens,
    );
    const outputTokens = finiteNonNegative(contextUsage.total.outputTokens);
    const explicitUsedPercent = finiteNonNegative(
      contextUsage.contextUsedPercent,
    );
    const usedPercent =
      explicitUsedPercent ??
      (usedTokens !== null && contextWindow !== null
        ? (usedTokens / contextWindow) * 100
        : null);
    const explicitRemainingPercent = finiteNonNegative(
      contextUsage.contextRemainingPercent,
    );
    const remainingPercent =
      explicitRemainingPercent ??
      (usedPercent !== null ? Math.max(100 - usedPercent, 0) : null);

    return {
      usedTokens,
      contextWindow,
      totalTokens,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      usedPercent,
      remainingPercent,
      freshness: contextUsage.contextUsageFreshness ?? "estimated",
      source: contextUsage.contextUsageSource ?? null,
      hasUsage:
        usedTokens !== null || usedPercent !== null || (totalTokens ?? 0) > 0,
      categoryUsages: contextUsage.contextCategoryUsages ?? null,
      toolUsages: contextUsage.contextToolUsages ?? null,
      toolUsagesTruncated: contextUsage.contextToolUsagesTruncated ?? null,
    };
  }, [contextUsage, selectedEngine, selectedModelId]);

  const legacyContextUsage = useMemo(() => {
    if (!contextUsage) {
      return null;
    }
    if (selectedEngine === "claude") {
      const usedTokens = resolveClaudeWindowUsedTokens(contextUsage);
      const contextWindow =
        finitePositive(contextUsage.modelContextWindow) ??
        estimateClaudeContextWindow(selectedModelId);
      return usedTokens !== null
        ? { used: usedTokens, total: contextWindow }
        : null;
    }
    return {
      used: contextUsage.total.totalTokens,
      total: contextUsage.modelContextWindow ?? 0,
    };
  }, [contextUsage, selectedEngine, selectedModelId]);

  const dualContextUsage = useMemo(
    () =>
      resolveDualContextUsageModel(
        contextUsage,
        isContextCompacting,
        codexCompactionLifecycleState,
        codexCompactionSource,
        codexCompactionCompletedAt,
        lastTokenUsageUpdatedAt,
      ),
    [
      contextUsage,
      isContextCompacting,
      codexCompactionLifecycleState,
      codexCompactionSource,
      codexCompactionCompletedAt,
      lastTokenUsageUpdatedAt,
    ],
  );
  const deferredStreamActivityPhase = useDeferredValue(streamActivityPhase);
  const deferredLegacyContextUsage = useDeferredValue(legacyContextUsage);
  const deferredDualContextUsage = useDeferredValue(dualContextUsage);
  const deferredClaudeContextUsage = useDeferredValue(claudeContextUsage);
  const deferredAccountRateLimits = useDeferredValue(accountRateLimits);
  const resolvedComposerStreamActivityPhase =
    isProcessing && isComposerInputInteractionActive
      ? deferredStreamActivityPhase
      : streamActivityPhase;
  const resolvedLegacyContextUsage =
    isProcessing && isComposerInputInteractionActive
      ? deferredLegacyContextUsage
      : legacyContextUsage;
  const resolvedDualContextUsage =
    isProcessing && isComposerInputInteractionActive
      ? deferredDualContextUsage
      : dualContextUsage;
  const resolvedClaudeContextUsage =
    isProcessing && isComposerInputInteractionActive
      ? deferredClaudeContextUsage
      : claudeContextUsage;
  const resolvedAccountRateLimits =
    isProcessing && isComposerInputInteractionActive
      ? deferredAccountRateLimits
      : accountRateLimits;
  const selectedEngineInfo = useMemo(
    () => engines?.find((engine) => engine.type === selectedEngine),
    [engines, selectedEngine],
  );
  const selectedModelOption = useMemo(
    () => models.find((model) => model.id === selectedModelId),
    [models, selectedModelId],
  );
  const selectedPermissionMode = accessModeToPermissionMode(accessMode);
  const activeUserInputRequest = useMemo(
    () =>
      userInputRequests.find((request) => {
        if (!activeThreadId || request.params.thread_id !== activeThreadId) {
          return false;
        }
        if (activeWorkspaceId && request.workspace_id !== activeWorkspaceId) {
          return false;
        }
        return request.params.completed !== true;
      }) ?? null,
    [activeThreadId, activeWorkspaceId, userInputRequests],
  );
  const handleJumpToUserInputRequest = useCallback(() => {
    if (!activeUserInputRequest) {
      return;
    }
    onJumpToUserInputRequest?.(activeUserInputRequest);
  }, [activeUserInputRequest, onJumpToUserInputRequest]);
  const codexContextDualViewEnabled = contextDualViewEnabled && isCodexEngine;
  // 所有 provider 的上下文占用入口统一渲染在输入框下方分支行右侧；
  // Codex 继续使用 dual-view ContextBar，保留 tooltip 与 compaction controls。
  const showFooterUsageIndicator = footerUsageIndicatorEnabled;
  const footerUsagePercentage =
    resolvedLegacyContextUsage && resolvedLegacyContextUsage.total > 0
      ? Math.round(
          (resolvedLegacyContextUsage.used / resolvedLegacyContextUsage.total) *
            100,
        )
      : null;
  const composerReadinessAccessMode =
    selectedEngine === "codex" && _selectedCollaborationModeId === "plan"
      ? "read-only"
      : accessMode;
  const composerSendReadiness = useMemo(
    () =>
      buildComposerSendReadiness({
        engine: selectedEngine ?? "claude",
        providerLabel:
          selectedEngineInfo?.shortName ||
          selectedEngineInfo?.displayName ||
          selectedEngine ||
          "Claude Code",
        modelLabel:
          selectedModelOption?.displayName ||
          selectedModelOption?.model ||
          selectedModelId ||
          t("composer.noModels"),
        modeLabel:
          selectedEngine === "codex" && _selectedCollaborationModeId === "plan"
            ? t("codexModes.plan.label")
            : t(`modes.${selectedPermissionMode}.label`),
        modeImpactLabel: t(
          `composer.readinessModeImpact.${composerReadinessAccessMode}`,
        ),
        accessMode: composerReadinessAccessMode,
        draftText: text,
        hasAttachments: attachedImages.length > 0,
        isProcessing,
        streamActivityPhase: resolvedComposerStreamActivityPhase,
        queuedCount: queuedMessages.length,
        fusingQueuedMessageId,
        canQueue: Boolean(onQueue),
        canStop,
        configLoading: isModelConfigRefreshing,
        runtimeLifecycleState,
        requestUserInputState: activeUserInputRequest ? "pending" : null,
        context: {
          selectedMemoryCount: selectedManualMemories.length,
          selectedNoteCardCount: selectedNoteCards.length,
          fileReferenceCount:
            selectedInlineFileReferences.length +
            (hasActiveFileReference ? 1 : 0),
          imageCount: attachedImages.length,
          selectedAgentName: selectedChatInputAgent?.name ?? null,
        },
      }),
    [
      activeUserInputRequest,
      attachedImages.length,
      canStop,
      composerReadinessAccessMode,
      fusingQueuedMessageId,
      hasActiveFileReference,
      isModelConfigRefreshing,
      isProcessing,
      onQueue,
      queuedMessages.length,
      resolvedComposerStreamActivityPhase,
      runtimeLifecycleState,
      selectedChatInputAgent?.name,
      selectedEngine,
      selectedEngineInfo?.displayName,
      selectedEngineInfo?.shortName,
      _selectedCollaborationModeId,
      selectedInlineFileReferences.length,
      selectedManualMemories.length,
      selectedModelId,
      selectedModelOption?.displayName,
      selectedModelOption?.model,
      selectedNoteCards.length,
      selectedPermissionMode,
      t,
      text,
    ],
  );
  const selectedManualMemoryIds = useMemo(
    () => selectedManualMemories.map((entry) => entry.id),
    [selectedManualMemories],
  );
  const selectedNoteCardIds = useMemo(
    () => selectedNoteCards.map((entry) => entry.id),
    [selectedNoteCards],
  );
  const manualMemorySelectionHintCopy =
    carryOverManualMemoryIds.length > 0
      ? t("composer.contextLedgerCarryOverReasonWillCarry")
      : retainedManualMemoryIds.length > 0
        ? t("composer.contextLedgerCarryOverReasonInherited")
        : t("composer.manualMemorySelectionHint");
  const noteCardSelectionHintCopy =
    carryOverNoteCardIds.length > 0
      ? t("composer.contextLedgerCarryOverReasonWillCarry")
      : retainedNoteCardIds.length > 0
        ? t("composer.contextLedgerCarryOverReasonInherited")
        : t("composer.noteCardSelectionHint");
  const shouldRenderReviewInlinePrompt =
    isReviewQuickActionEngine &&
    Boolean(reviewPrompt) &&
    Boolean(_onReviewPromptClose) &&
    Boolean(_onReviewPromptShowPreset) &&
    Boolean(_onReviewPromptChoosePreset) &&
    _highlightedPresetIndex !== undefined &&
    Boolean(_onReviewPromptHighlightPreset) &&
    _highlightedBranchIndex !== undefined &&
    Boolean(_onReviewPromptHighlightBranch) &&
    _highlightedCommitIndex !== undefined &&
    Boolean(_onReviewPromptHighlightCommit) &&
    Boolean(_onReviewPromptSelectBranch) &&
    Boolean(_onReviewPromptSelectBranchAtIndex) &&
    Boolean(_onReviewPromptConfirmBranch) &&
    Boolean(_onReviewPromptSelectCommit) &&
    Boolean(_onReviewPromptSelectCommitAtIndex) &&
    Boolean(_onReviewPromptConfirmCommit) &&
    Boolean(_onReviewPromptUpdateCustomInstructions) &&
    Boolean(_onReviewPromptConfirmCustom);
  const hasScrollableContextStack =
    selectedManualMemories.length > 0 ||
    selectedNoteCards.length > 0 ||
    selectedCodeAnnotations.length > 0 ||
    shouldRenderReviewInlinePrompt;

  return (
    <footer
      className={`composer${composerInteractionDisabled ? " is-disabled" : ""}`}
    >
      <div
        className={`composer-shell${isComposerCollapsed ? " is-collapsed" : ""}`}
      >
        {isComposerCollapsed ? (
          <button
            type="button"
            className={`composer-shell-collapsed-strip${isProcessing ? " is-processing" : ""}`}
            onClick={handleExpandComposer}
            aria-label={t("composer.expandInput")}
            title={t("composer.expandInput")}
          >
            <span className="composer-shell-collapsed-rail" aria-hidden>
              <span />
              <span />
              <span />
            </span>
            <span className="composer-shell-collapsed-text">
              {isProcessing
                ? t("composer.collapsedProcessing")
                : t("composer.expandInput")}
            </span>
          </button>
        ) : (
          <>
            {/* Management toolbar (help, skill, commons, kanban) removed -- was disabled with {false && ...} */}
            {hasScrollableContextStack ? (
              <div className="composer-context-stack">
                {selectedManualMemories.length > 0 && (
                  <div className="composer-memory-strip">
                    <div className="composer-memory-strip-head">
                      <span className="composer-memory-strip-label">
                        {t("composer.manualMemorySelection", {
                          count: selectedManualMemories.length,
                        })}
                      </span>
                      <span className="composer-memory-strip-hint">
                        {manualMemorySelectionHintCopy}
                      </span>
                    </div>
                    <div className="composer-memory-chip-list">
                      {selectedManualMemories.map((memory, memoryIndex) => {
                        const chipTitle = `[M${memoryIndex + 1}] ${resolveManualMemoryChipTitle(memory)}`;
                        const chipDetail =
                          resolveManualMemoryChipDetail(memory);
                        return (
                          <article
                            key={`manual-memory-${memory.id}`}
                            className="composer-memory-chip"
                          >
                            <button
                              type="button"
                              className="composer-memory-chip-remove"
                              onClick={() =>
                                handleRemoveManualMemory(memory.id)
                              }
                              title={t("composer.manualMemoryRemove", {
                                title: memory.title,
                              })}
                              aria-label={t("composer.manualMemoryRemove", {
                                title: memory.title,
                              })}
                            >
                              ×
                            </button>
                            <div className="composer-memory-chip-main">
                              <span className="composer-memory-chip-title">
                                {chipTitle}
                              </span>
                              {chipDetail && (
                                <span className="composer-memory-chip-summary">
                                  {chipDetail}
                                </span>
                              )}
                              <span className="composer-memory-chip-meta">
                                {carryOverManualMemoryIds.includes(
                                  memory.id,
                                ) ? (
                                  <span className="composer-memory-chip-state composer-memory-chip-state--carry">
                                    {t(
                                      "composer.contextLedgerCarryOverReasonWillCarry",
                                    )}
                                  </span>
                                ) : retainedManualMemoryIds.includes(
                                    memory.id,
                                  ) ? (
                                  <span className="composer-memory-chip-state composer-memory-chip-state--retained">
                                    {t(
                                      "composer.contextLedgerCarryOverReasonInherited",
                                    )}
                                  </span>
                                ) : null}
                                <span>{memory.kind}</span>
                                <span>{memory.importance}</span>
                                <span>
                                  {new Date(
                                    memory.updatedAt,
                                  ).toLocaleDateString(undefined, {
                                    month: "2-digit",
                                    day: "2-digit",
                                  })}
                                </span>
                              </span>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </div>
                )}

                {selectedNoteCards.length > 0 && (
                  <div className="composer-memory-strip">
                    <div className="composer-memory-strip-head">
                      <span className="composer-memory-strip-label">
                        {t("composer.noteCardSelection", {
                          count: selectedNoteCards.length,
                        })}
                      </span>
                      <span className="composer-memory-strip-hint">
                        {noteCardSelectionHintCopy}
                      </span>
                    </div>
                    <div className="composer-memory-chip-list">
                      {selectedNoteCards.map((noteCard) => {
                        const chipTitle = resolveNoteCardChipTitle(noteCard);
                        const chipDetail = resolveNoteCardChipDetail(noteCard);
                        return (
                          <article
                            key={`note-card-${noteCard.id}`}
                            className="composer-memory-chip"
                          >
                            <button
                              type="button"
                              className="composer-memory-chip-remove"
                              onClick={() => handleRemoveNoteCard(noteCard.id)}
                              title={t("composer.noteCardRemove", {
                                title: noteCard.title,
                              })}
                              aria-label={t("composer.noteCardRemove", {
                                title: noteCard.title,
                              })}
                            >
                              ×
                            </button>
                            <div className="composer-memory-chip-main">
                              <span className="composer-memory-chip-title">
                                {chipTitle}
                              </span>
                              {chipDetail && (
                                <span className="composer-memory-chip-summary">
                                  {chipDetail}
                                </span>
                              )}
                              <span className="composer-memory-chip-meta">
                                {carryOverNoteCardIds.includes(noteCard.id) ? (
                                  <span className="composer-memory-chip-state composer-memory-chip-state--carry">
                                    {t(
                                      "composer.contextLedgerCarryOverReasonWillCarry",
                                    )}
                                  </span>
                                ) : retainedNoteCardIds.includes(
                                    noteCard.id,
                                  ) ? (
                                  <span className="composer-memory-chip-state composer-memory-chip-state--retained">
                                    {t(
                                      "composer.contextLedgerCarryOverReasonInherited",
                                    )}
                                  </span>
                                ) : null}
                                {noteCard.archived ? (
                                  <span>
                                    {t("composer.noteCardArchivedBadge")}
                                  </span>
                                ) : null}
                                <span>
                                  {new Date(
                                    noteCard.updatedAt,
                                  ).toLocaleDateString(undefined, {
                                    month: "2-digit",
                                    day: "2-digit",
                                  })}
                                </span>
                                {noteCard.imageCount > 0 ? (
                                  <span>
                                    {t("noteCards.imageCount", {
                                      count: noteCard.imageCount,
                                    })}
                                  </span>
                                ) : null}
                              </span>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </div>
                )}

                {selectedCodeAnnotations.length > 0 && (
                  <div className="composer-memory-strip composer-code-annotation-strip">
                    <div className="composer-memory-strip-head">
                      <span className="composer-memory-strip-label">
                        {t("composer.codeAnnotationSelection", {
                          count: selectedCodeAnnotations.length,
                        })}
                      </span>
                      <span className="composer-memory-strip-hint">
                        {t("composer.codeAnnotationSelectionHint", {
                          count: selectedCodeAnnotations.length,
                        })}
                      </span>
                    </div>
                    <div className="composer-memory-chip-list composer-code-annotation-list">
                      {selectedCodeAnnotations.map((annotation) => {
                        const lineLabel = formatCodeAnnotationLineRange(
                          annotation.lineRange,
                        );
                        const fileName =
                          annotation.path
                            .split(/[\\/]/)
                            .filter(Boolean)
                            .pop() ?? annotation.path;
                        return (
                          <article
                            key={annotation.id}
                            className="composer-memory-chip composer-code-annotation-chip"
                          >
                            <button
                              type="button"
                              className="composer-memory-chip-remove"
                              onClick={() =>
                                handleRemoveCodeAnnotation(annotation.id)
                              }
                              title={t("composer.codeAnnotationRemove", {
                                path: annotation.path,
                              })}
                              aria-label={t("composer.codeAnnotationRemove", {
                                path: annotation.path,
                              })}
                            >
                              ×
                            </button>
                            <div className="composer-memory-chip-main">
                              <span className="composer-memory-chip-title">
                                {fileName} · {lineLabel}
                              </span>
                              <span className="composer-memory-chip-summary">
                                {annotation.body}
                              </span>
                              <span className="composer-memory-chip-meta">
                                <span>{annotation.path}</span>
                              </span>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </div>
                )}

                {shouldRenderReviewInlinePrompt && reviewPrompt && (
                  <div
                    className="composer-suggestions popover-surface review-inline-suggestions"
                    role="listbox"
                    style={{
                      position: "relative",
                      left: "auto",
                      right: "auto",
                      top: "auto",
                      bottom: "auto",
                      width: "min(540px, 100%)",
                      maxWidth: "min(540px, 100%)",
                      marginBottom: "4px",
                    }}
                  >
                    <ReviewInlinePrompt
                      reviewPrompt={reviewPrompt}
                      onClose={_onReviewPromptClose!}
                      onShowPreset={_onReviewPromptShowPreset!}
                      onChoosePreset={_onReviewPromptChoosePreset!}
                      highlightedPresetIndex={_highlightedPresetIndex!}
                      onHighlightPreset={_onReviewPromptHighlightPreset!}
                      highlightedBranchIndex={_highlightedBranchIndex!}
                      onHighlightBranch={_onReviewPromptHighlightBranch!}
                      highlightedCommitIndex={_highlightedCommitIndex!}
                      onHighlightCommit={_onReviewPromptHighlightCommit!}
                      onSelectBranch={_onReviewPromptSelectBranch!}
                      onSelectBranchAtIndex={
                        _onReviewPromptSelectBranchAtIndex!
                      }
                      onConfirmBranch={_onReviewPromptConfirmBranch!}
                      onSelectCommit={_onReviewPromptSelectCommit!}
                      onSelectCommitAtIndex={
                        _onReviewPromptSelectCommitAtIndex!
                      }
                      onConfirmCommit={_onReviewPromptConfirmCommit!}
                      onUpdateCustomInstructions={
                        _onReviewPromptUpdateCustomInstructions!
                      }
                      onConfirmCustom={_onReviewPromptConfirmCustom!}
                      onKeyDown={_onReviewPromptKeyDown}
                    />
                  </div>
                )}
              </div>
            ) : null}
            {activeWorkspaceId &&
            (browserContext.attachment || browserContext.error) ? (
              <div className="composer-browser-context">
                {browserContext.attachment ? (
                  <BrowserContextPreview
                    attachment={browserContext.attachment}
                    busy={browserContext.busy}
                    onRefresh={() => void browserContext.refresh()}
                    onRemove={browserContext.remove}
                  />
                ) : null}
                {browserContext.error ? (
                  <div className="composer-browser-context-error" role="status">
                    {browserContext.error ===
                    "browser_context_no_active_session"
                      ? t("browserAgent.composer.noSession")
                      : browserContext.error}
                  </div>
                ) : null}
              </div>
            ) : null}
            {intentCanvasAttachments.length > 0 ? (
              <div
                className="composer-intent-canvas-attachments"
                aria-label={t("intentCanvas.attachment.groupLabel")}
              >
                {intentCanvasAttachments.map((document) => (
                  <IntentCanvasAttachmentCard
                    key={document.id}
                    document={document}
                    onRemove={onRemoveIntentCanvasAttachment}
                  />
                ))}
              </div>
            ) : null}
            <ComposerRunStatusStrip
              todos={statusTodos}
              subagents={statusSubagents}
              plan={plan ?? null}
              isPlanMode={Boolean(isPlanMode)}
              isProcessing={Boolean(isProcessing)}
              mergePlanIntoTodos={mergePlanIntoTodos}
              sessionFileChanges={sessionFileChanges}
              sessionScopeKey={activeThreadId ?? null}
              isCodexEngine={isCodexEngine}
              onOpenDiffPath={onOpenDiffPath}
              onRevertFile={onRevertFile}
              onRevertAllFiles={onRevertAllFiles}
            />
            <ChatInputBoxAdapter
              ref={chatInputRef}
              text={text}
              disabled={composerInteractionDisabled}
              submitDisabled={
                effectiveSubmitDisabled || collabLocksComposer
              }
              isProcessing={isProcessing}
              streamActivityPhase={resolvedComposerStreamActivityPhase}
              canStop={canStop}
              onSend={handleSend}
              onStop={onStop}
              onTextChange={handleTextChangeWithHistory}
              selectedModelId={resolveComposerAtomicSelectedModelId({
                isSharedSession: isSharedSessionResolved,
                executionTarget: selectedAtomicTarget,
                globalSelectedModelId: selectedModelId,
              })}
              selectedEngine={selectedAtomicTarget?.engine ?? selectedEngine}
              isSharedSession={isSharedSessionResolved}
              // 全场景统一首页 Atomic 双栏 picker（含「本地配置」渠道），
              // 不再维护 conversation native 单栏/无渠道分叉。
              providerTargetPickerMode={
                isSharedSessionResolved && !createSessionTargetPicker
                  ? "shared"
                  : "create-session"
              }
              threadId={activeThreadId}
              engines={engines}
              models={models}
              providerModelCatalogs={providerModelCatalogs}
              providerProfileId={
                selectedAtomicTarget
                  ? (selectedAtomicTarget.providerProfileId ?? null)
                  : providerProfileId
              }
              executionTarget={selectedAtomicTarget}
              onExecutionTargetChange={
                isSharedSessionResolved && !sharedTargetPickerLocked
                  ? handleSharedTargetChange
                  : createSessionTargetPicker
                    ? handleCreationTargetChange
                    : handleNativeAtomicTargetChange
              }
              reasoningOptions={atomicReasoningOptions}
              selectedEffort={
                useAtomicReasoningProjection
                  ? atomicSelectedEffort
                  : selectedEffort
              }
              onSelectEffort={
                sharedTargetPickerLocked
                  ? undefined
                  : isSharedSessionResolved &&
                      isResolvedExecutionTarget(selectedSharedTarget)
                    ? (effort) =>
                        handleSharedTargetChange({
                          ...selectedSharedTarget,
                          reasoning: effort ? { effort } : null,
                        })
                    : createSessionTargetPicker &&
                        isResolvedExecutionTarget(effectiveCreationTarget)
                      ? (effort) =>
                          setSelectedCreationTarget({
                            ...effectiveCreationTarget,
                            reasoning: effort ? { effort } : null,
                          })
                      : onSelectEffort
              }
              reasoningSupported={reasoningSupported}
              onResolvedAlwaysThinkingChange={onResolvedAlwaysThinkingChange}
              attachments={attachedImages}
              hasContextAttachment={intentCanvasAttachments.length > 0}
              onAddAttachment={
                onPickImages || !imageInputSupported
                  ? handlePickImagesGuarded
                  : undefined
              }
              onAttachImages={
                onAttachImages ? handleAttachImagesGuarded : undefined
              }
              onRemoveAttachment={onRemoveImage}
              textareaHeight={textareaHeight}
              onHeightChange={onTextareaHeightChange}
              contextUsage={resolvedLegacyContextUsage}
              claudeContextUsage={resolvedClaudeContextUsage}
              queuedMessages={queuedMessages}
              onDeleteQueued={onDeleteQueued}
              onFuseQueued={onFuseQueued}
              canFuseQueuedMessages={canFuseQueuedMessages}
              fuseDisabledReasonKey={fuseDisabledReasonKey}
              fusingQueuedMessageId={fusingQueuedMessageId}
              suggestionsOpen={suggestionsOpen}
              files={files}
              customSkillDirectories={customSkillDirectories}
              directories={directories}
              commands={commands}
              prompts={prompts}
              workspaceId={activeWorkspaceId}
              workspaceName={activeWorkspaceName}
              workspacePath={activeWorkspacePath}
              onManualMemorySelect={handleSelectManualMemory}
              onNoteCardSelect={handleSelectNoteCard}
              onSelectSkill={handleSelectSkill}
              sendShortcut={sendShortcut}
              placeholder={
                collabLocksComposer
                  ? t("multiAgent.entry.collabRunningLock")
                  : sendShortcut === "cmdEnter"
                    ? t("chat.inputPlaceholderCmdEnter")
                    : t("chat.inputPlaceholderEnter")
              }
              activeFile={
                hasActiveFileReference
                  ? (activeFilePath ?? undefined)
                  : undefined
              }
              selectedLines={
                hasActiveFileReference ? activeFileLinesLabel : undefined
              }
              onClearContext={
                hasActiveFileReference ? handleClearContext : undefined
              }
              selectedAgent={selectedChatInputAgent}
              selectedContextChips={contextSelectionChips}
              selectedManualMemoryIds={selectedManualMemoryIds}
              selectedNoteCardIds={selectedNoteCardIds}
              onRemoveContextChip={handleRemoveContextChip}
              onAgentSelect={handleAgentSelect}
              onOpenAgentSettings={onOpenAgentSettings}
              onOpenPromptSettings={onOpenPromptSettings}
              onOpenModelSettings={onOpenModelSettings}
              onOpenCliSettings={onOpenCliSettings}
              onOpenFileReference={onOpenDiffPath}
              onRefreshModelConfig={onRefreshModelConfig}
              isModelConfigRefreshing={isModelConfigRefreshing}
              permissionMode={selectedPermissionMode}
              onModeSelect={handleModeSelect}
              sendReadiness={composerSendReadiness}
              onJumpToRequest={
                activeUserInputRequest
                  ? handleJumpToUserInputRequest
                  : undefined
              }
              onOpenSkillsSettings={_onOpenSkillsSettings}
              selectedCollaborationModeId={_selectedCollaborationModeId}
              onSelectCollaborationMode={_onSelectCollaborationMode}
              accountRateLimits={resolvedAccountRateLimits}
              usageShowRemaining={usageShowRemaining}
              onRefreshAccountRateLimits={onRefreshAccountRateLimits}
              onCodexQuickCommand={handleCodexQuickCommand}
              onForkQuickStart={handleForkQuickStart}
              memoryReferenceMode={memoryReferenceMode}
              onSetMemoryReferenceMode={setMemoryReferenceMode}
              hasMessages={items.length > 0}
              onRewind={handleRewind}
              showRewindEntry={canRewindSession}
              statusPanelExpanded={resolvedStatusPanelExpanded}
              showStatusPanelToggle={resolvedShowStatusPanelToggle}
              onToggleStatusPanel={resolvedToggleStatusPanel}
              completionEmailSelected={completionEmailSelected}
              completionEmailDisabled={completionEmailDisabled}
              onToggleCompletionEmail={onToggleCompletionEmail}
            />
            {branchControl?.branchName ||
            showFooterUsageIndicator ||
            isSharedSessionResolved ? (
              <div className="composer-branch-row">
                {branchControl?.branchName ? (
                  <ComposerBranchBadge {...branchControl} />
                ) : null}
                {showFooterUsageIndicator || isSharedSessionResolved ? (
                  <div className="composer-branch-row-trailing">
                    {isSharedSessionResolved ? (
                      <div className="composer-collab-slot">
                        <MultiAgentComposerToggle
                          engine={selectedAtomicTarget?.engine}
                          armed={agentArmed || collabRunActive}
                          disabled={
                            disabled ||
                            effectiveSubmitDisabled ||
                            !isResolvedExecutionTarget(selectedAtomicTarget) ||
                            collabRunActive
                          }
                          hasActiveRun={collabRunActive}
                          onToggle={() => {
                            if (collabRunActive) return;
                            setAgentArmed((armed) => !armed);
                          }}
                          onArm={() => setAgentArmed(true)}
                        />
                      </div>
                    ) : null}
                    {showFooterUsageIndicator ? (
                      <div className="composer-branch-row-usage">
                        {codexContextDualViewEnabled ? (
                          <ContextBar
                            surface="tool-popover"
                            contextDualViewEnabled
                            dualContextUsage={resolvedDualContextUsage}
                            onRequestContextCompaction={
                              handleManualCompactContext
                            }
                            codexAutoCompactionEnabled={
                              codexAutoCompactionEnabled
                            }
                            codexAutoCompactionThresholdPercent={
                              codexAutoCompactionThresholdPercent
                            }
                            onCodexAutoCompactionSettingsChange={
                              onCodexAutoCompactionSettingsChange
                            }
                            currentProvider="codex"
                          />
                        ) : (
                          <TokenIndicator
                            percentage={footerUsagePercentage}
                            usedTokens={resolvedLegacyContextUsage?.used}
                            maxTokens={resolvedLegacyContextUsage?.total}
                            claudeContextUsage={
                              selectedEngine === "claude"
                                ? resolvedClaudeContextUsage
                                : null
                            }
                          />
                        )}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>
      <ClaudeRewindConfirmDialog
        preview={rewindPreviewState}
        isBusy={rewindInFlight}
        rewindMode={rewindMode}
        shouldShowAffectedFiles={
          !rewindWorkspaceGitState?.isGitRepository ||
          Boolean(rewindWorkspaceGitState.hasDetectedChanges)
        }
        onRewindModeChange={setRewindMode}
        onOpenDiffPath={onOpenDiffPath}
        onStoreChanges={handleStoreRewindChanges}
        onCancel={handleCancelRewind}
        onConfirm={handleConfirmRewind}
      />
    </footer>
  );
}

function areComposerPropsEqual(
  previous: ComposerProps,
  next: ComposerProps,
): boolean {
  const shouldUseInteractionLaneComparator =
    Boolean(previous.isProcessing) && Boolean(next.isProcessing);
  if (!shouldUseInteractionLaneComparator) {
    return areComposerPropsShallowEqual(previous, next, null);
  }
  if ((previous.items?.length ?? 0) === 0 && (next.items?.length ?? 0) > 0) {
    return false;
  }
  return areComposerPropsShallowEqual(
    previous,
    next,
    COMPOSER_CANVAS_ONLY_PROPS,
  );
}

function areComposerPropsShallowEqual(
  previous: ComposerProps,
  next: ComposerProps,
  ignoredProps: ReadonlySet<keyof ComposerProps> | null,
): boolean {
  const previousKeys = Object.keys(previous) as Array<keyof ComposerProps>;
  const nextKeys = Object.keys(next) as Array<keyof ComposerProps>;
  if (previousKeys.length !== nextKeys.length) {
    return false;
  }
  for (const key of previousKeys) {
    if (!Object.prototype.hasOwnProperty.call(next, key)) {
      return false;
    }
    if (ignoredProps?.has(key)) {
      continue;
    }
    if (!Object.is(previous[key], next[key])) {
      return false;
    }
  }
  return true;
}

export const Composer = memo(ComposerImpl, areComposerPropsEqual);
