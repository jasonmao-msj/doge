/**
 * ChatInputBoxAdapter - Bridge between Composer.tsx props and ChatInputBox props
 *
 * This adapter translates the Composer's prop interface to ChatInputBox's interface,
 * keeping visual and interaction consistency with idea-claude-code-gui's input box.
 */
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ChatInputBox } from './ChatInputBox';
import type {
  ChatInputBoxHandle,
  Attachment,
  CodexSpeedMode,
  ClaudeContextUsageViewModel,
  ContextSelectionChip,
  MemoryReferenceMode,
  ModelInfo,
  PermissionMode,
  ProviderModelCatalogs,
  ProviderTargetPickerMode,
  ReasoningEffort,
  SelectedAgent,
  StreamActivityPhase,
  FileItem,
  CommandItem,
  PromptItem,
  SkillItem,
  NoteCardItem,
} from './types';
import type { ExecutionTarget } from '../../../shared-session/target/types';
import type { QueuedMessage as ComposerQueuedMessage } from '../../../../types';
import type { CustomCommandOption, CustomPromptOption } from '../../../../types';
import type { EngineType } from '../../../../types';
import type { RateLimitSnapshot } from '../../../../types';
import type { ComposerSendReadiness } from '../../utils/composerSendReadiness';
import { formatEngineVersionLabel } from '../../../engine/utils/engineLabels';
import { projectMemoryFacade } from '../../../project-memory/services/projectMemoryFacade';
import { noteCardsFacade } from '../../../note-cards/services/noteCardsFacade';
import { isSharedSessionSupportedEngine } from '../../../shared-session/utils/sharedSessionEngines';
import {
  getClaudeProviders,
  getClaudeAlwaysThinkingEnabled,
  setClaudeAlwaysThinkingEnabled,
  updateClaudeProvider,
  getWorkspaceFiles,
  getWorkspaceDirectoryChildren,
  getSkillsList,
} from '../../../../services/tauri';
import {
  CREATE_NEW_PROMPT_ID,
  EMPTY_STATE_ID,
} from './providers/promptProvider';
import {
  getPromptHeatLevel,
  getPromptUsageEntry,
} from '../../../prompts/promptUsage';
import { requestCustomPromptsRefresh } from '../../../prompts/promptEvents';
import { appendComposerRenderBudgetDiagnostic } from '../../../../services/rendererDiagnostics';

// Re-export the handle type for Composer to use
export type { ChatInputBoxHandle };

const STREAMING_ENABLED_STORAGE_KEY = 'doge.composer.streaming-enabled';
const LOCAL_SETTINGS_PROVIDER_ID = '__local_settings_json__';

type ClaudeProviderLike = {
  id: string;
  name: string;
  isActive?: boolean;
  isLocalProvider?: boolean;
  settingsConfig?: {
    alwaysThinkingEnabled?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type AdapterModelOption = {
  id: string;
  displayName?: string;
  model?: string;
  description?: string;
  source?: string;
};

function normalizeAdapterModelOptions(
  modelOptions: AdapterModelOption[] | undefined,
): ModelInfo[] | undefined {
  if (!modelOptions || modelOptions.length === 0) {
    return undefined;
  }
  return modelOptions.map((modelOption) => {
    const runtimeModel = modelOption.model || modelOption.id;
    const label = modelOption.displayName || runtimeModel || modelOption.id;
    return {
      id: modelOption.id,
      model: runtimeModel,
      label,
      description:
        modelOption.description ||
        (runtimeModel && runtimeModel !== label ? runtimeModel : undefined),
      source: modelOption.source,
    };
  });
}

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

type NoteCardSelection = {
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

type AdapterEngineInfo = {
  type: EngineType;
  installed: boolean;
  version: string | null;
  availabilityState?: 'loading' | 'ready' | 'requires-login' | 'unavailable';
  availabilityLabelKey?: string | null;
};

function readStoredStreamingEnabled(): boolean {
  if (typeof window === 'undefined' || !window.localStorage) {
    return true;
  }
  const value = window.localStorage.getItem(STREAMING_ENABLED_STORAGE_KEY);
  if (value === null) {
    return true;
  }
  return value === '1' || value === 'true';
}

function findActiveClaudeProvider(providers: ClaudeProviderLike[]): ClaudeProviderLike | null {
  return providers.find((provider) => provider?.isActive) ?? null;
}

function isLocalClaudeProvider(provider: ClaudeProviderLike | null): boolean {
  if (!provider) {
    return false;
  }
  return Boolean(provider.isLocalProvider) || provider.id === LOCAL_SETTINGS_PROVIDER_ID;
}

function areStringArraysEqual(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right || left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function areContextSelectionChipsEqual(
  left: readonly ContextSelectionChip[] | undefined,
  right: readonly ContextSelectionChip[] | undefined,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right || left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const leftChip = left[index];
    const rightChip = right[index];
    if (
      leftChip?.type !== rightChip?.type ||
      leftChip?.name !== rightChip?.name ||
      leftChip?.description !== rightChip?.description ||
      leftChip?.path !== rightChip?.path ||
      leftChip?.source !== rightChip?.source
    ) {
      return false;
    }
  }
  return true;
}

function areQueuedMessagesEqual(
  left: readonly ComposerQueuedMessage[] | undefined,
  right: readonly ComposerQueuedMessage[] | undefined,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right || left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const leftMessage = left[index];
    const rightMessage = right[index];
    if (
      leftMessage?.id !== rightMessage?.id ||
      leftMessage?.text !== rightMessage?.text ||
      leftMessage?.createdAt !== rightMessage?.createdAt ||
      leftMessage?.sharedDispatchState !== rightMessage?.sharedDispatchState
    ) {
      return false;
    }
  }
  return true;
}

function areCustomCommandsEqual(
  left: readonly CustomCommandOption[] | undefined,
  right: readonly CustomCommandOption[] | undefined,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right || left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const leftCommand = left[index];
    const rightCommand = right[index];
    if (
      leftCommand?.name !== rightCommand?.name ||
      leftCommand?.path !== rightCommand?.path ||
      leftCommand?.description !== rightCommand?.description ||
      leftCommand?.argumentHint !== rightCommand?.argumentHint ||
      leftCommand?.content !== rightCommand?.content ||
      leftCommand?.source !== rightCommand?.source
    ) {
      return false;
    }
  }
  return true;
}

function areCustomPromptsEqual(
  left: readonly CustomPromptOption[] | undefined,
  right: readonly CustomPromptOption[] | undefined,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right || left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const leftPrompt = left[index];
    const rightPrompt = right[index];
    if (
      leftPrompt?.name !== rightPrompt?.name ||
      leftPrompt?.path !== rightPrompt?.path ||
      leftPrompt?.description !== rightPrompt?.description ||
      leftPrompt?.argumentHint !== rightPrompt?.argumentHint ||
      leftPrompt?.content !== rightPrompt?.content ||
      leftPrompt?.scope !== rightPrompt?.scope
    ) {
      return false;
    }
  }
  return true;
}

function areContextUsageEqual(
  left: ChatInputBoxAdapterProps['contextUsage'],
  right: ChatInputBoxAdapterProps['contextUsage'],
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return left === right;
  }
  return left.used === right.used && left.total === right.total;
}

function areClaudeContextUsageEqual(
  left: ChatInputBoxAdapterProps['claudeContextUsage'],
  right: ChatInputBoxAdapterProps['claudeContextUsage'],
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return left === right;
  }
  return (
    left.usedTokens === right.usedTokens &&
    left.contextWindow === right.contextWindow &&
    left.totalTokens === right.totalTokens &&
    left.inputTokens === right.inputTokens &&
    left.cachedInputTokens === right.cachedInputTokens &&
    left.outputTokens === right.outputTokens &&
    left.usedPercent === right.usedPercent &&
    left.remainingPercent === right.remainingPercent &&
    left.freshness === right.freshness &&
    left.source === right.source &&
    left.hasUsage === right.hasUsage
  );
}

function areRateLimitWindowsEqual(
  left: RateLimitSnapshot['primary'] | RateLimitSnapshot['secondary'],
  right: RateLimitSnapshot['primary'] | RateLimitSnapshot['secondary'],
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return left === right;
  }
  return (
    left.usedPercent === right.usedPercent &&
    left.windowDurationMins === right.windowDurationMins &&
    left.resetsAt === right.resetsAt
  );
}

function areAccountRateLimitsEqual(
  left: ChatInputBoxAdapterProps['accountRateLimits'],
  right: ChatInputBoxAdapterProps['accountRateLimits'],
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return left === right;
  }
  return (
    left.planType === right.planType &&
    areRateLimitWindowsEqual(left.primary, right.primary) &&
    areRateLimitWindowsEqual(left.secondary, right.secondary) &&
    left.credits?.hasCredits === right.credits?.hasCredits &&
    left.credits?.unlimited === right.credits?.unlimited &&
    left.credits?.balance === right.credits?.balance
  );
}

function areChatInputBoxAdapterPropsEqual(
  previousProps: Readonly<ChatInputBoxAdapterProps>,
  nextProps: Readonly<ChatInputBoxAdapterProps>,
): boolean {
  const propKeys = new Set<keyof ChatInputBoxAdapterProps>([
    ...(Object.keys(previousProps) as (keyof ChatInputBoxAdapterProps)[]),
    ...(Object.keys(nextProps) as (keyof ChatInputBoxAdapterProps)[]),
  ]);

  for (const propKey of propKeys) {
    if (propKey === 'contextUsage') {
      if (!areContextUsageEqual(previousProps.contextUsage, nextProps.contextUsage)) {
        return false;
      }
      continue;
    }
    if (propKey === 'claudeContextUsage') {
      if (!areClaudeContextUsageEqual(previousProps.claudeContextUsage, nextProps.claudeContextUsage)) {
        return false;
      }
      continue;
    }
    if (propKey === 'accountRateLimits') {
      if (!areAccountRateLimitsEqual(previousProps.accountRateLimits, nextProps.accountRateLimits)) {
        return false;
      }
      continue;
    }
    if (propKey === 'queuedMessages') {
      if (!areQueuedMessagesEqual(previousProps.queuedMessages, nextProps.queuedMessages)) {
        return false;
      }
      continue;
    }
    if (propKey === 'commands') {
      if (!areCustomCommandsEqual(previousProps.commands, nextProps.commands)) {
        return false;
      }
      continue;
    }
    if (propKey === 'prompts') {
      if (!areCustomPromptsEqual(previousProps.prompts, nextProps.prompts)) {
        return false;
      }
      continue;
    }
    if (
      propKey === 'attachments' ||
      propKey === 'selectedManualMemoryIds' ||
      propKey === 'selectedNoteCardIds' ||
      propKey === 'customSkillDirectories'
    ) {
      const previousArray = previousProps[propKey];
      const nextArray = nextProps[propKey];
      if (
        !areStringArraysEqual(
          previousArray as readonly string[] | undefined,
          nextArray as readonly string[] | undefined,
        )
      ) {
        return false;
      }
      continue;
    }
    if (propKey === 'selectedContextChips') {
      if (!areContextSelectionChipsEqual(previousProps.selectedContextChips, nextProps.selectedContextChips)) {
        return false;
      }
      continue;
    }
    if (!Object.is(previousProps[propKey], nextProps[propKey])) {
      return false;
    }
  }

  return true;
}

export interface ChatInputBoxAdapterProps {
  // Core state
  text: string;
  disabled?: boolean;
  submitDisabled?: boolean;
  isProcessing: boolean;
  streamActivityPhase?: StreamActivityPhase;
  canStop: boolean;

  // Callbacks
  onSend: (submittedText?: string, submittedImages?: string[]) => void;
  onStop: () => void;
  onTextChange: (text: string, selectionStart: number | null) => void;

  // Permission mode
  permissionMode?: PermissionMode;
  onModeSelect?: (mode: PermissionMode) => void;

  // Model/Engine
  selectedModelId: string | null;
  selectedEngine?: EngineType;
  isSharedSession?: boolean;
  providerTargetPickerMode?: ProviderTargetPickerMode;
  /** Shared Thread id（Wave 4 / B.6：send 状态条/状态机的 store key 组成）。 */
  threadId?: string | null;
  engines?: AdapterEngineInfo[];
  models?: AdapterModelOption[];
  providerModelCatalogs?: Partial<Record<EngineType, AdapterModelOption[]>>;
  providerProfileId?: string | null;
  executionTarget?: ExecutionTarget | null;
  onExecutionTargetChange?: (target: ExecutionTarget) => void;

  // Reasoning
  reasoningOptions?: string[];
  selectedEffort?: string | null;
  onSelectEffort?: (effort: string | null) => void;
  reasoningSupported?: boolean;
  alwaysThinkingEnabled?: boolean;
  onToggleThinking?: (enabled: boolean) => void;
  onResolvedAlwaysThinkingChange?: (enabled: boolean) => void;
  streamingEnabled?: boolean;
  onStreamingEnabledChange?: (enabled: boolean) => void;

  // Attachments (string paths in Composer, Attachment objects in ChatInputBox)
  attachments?: string[];
  hasContextAttachment?: boolean;
  onAddAttachment?: () => void;
  onAttachImages?: (paths: string[]) => void;
  onRemoveAttachment?: (path: string) => void;

  // Height
  textareaHeight?: number;
  onHeightChange?: (height: number) => void;

  // Context usage
  contextUsage?: { used: number; total: number } | null;
  claudeContextUsage?: ClaudeContextUsageViewModel | null;
  accountRateLimits?: RateLimitSnapshot | null;
  usageShowRemaining?: boolean;
  onRefreshAccountRateLimits?: () => Promise<void> | void;
  selectedCollaborationModeId?: string | null;
  onSelectCollaborationMode?: (id: string | null) => void;
  onCodexQuickCommand?: (command: string) => void | Promise<void>;
  memoryReferenceMode?: MemoryReferenceMode;
  onSetMemoryReferenceMode?: (mode: MemoryReferenceMode) => void;

  // Queue
  queuedMessages?: ComposerQueuedMessage[];
  sendReadiness?: ComposerSendReadiness | null;
  onJumpToRequest?: () => void;
  onOpenSkillsSettings?: () => void;
  onDeleteQueued?: (id: string) => void;
  onFuseQueued?: (id: string) => void | Promise<void>;
  canFuseQueuedMessages?: boolean;
  fuseDisabledReasonKey?: string | null;
  fusingQueuedMessageId?: string | null;

  // External keyboard handler (for Composer-level shortcuts)
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;

  // Autocomplete overlay props (rendered by Composer, positioned outside ChatInputBox)
  suggestionsOpen?: boolean;

  // Local completion data sources (from Composer)
  files?: string[];
  customSkillDirectories?: string[];
  directories?: string[];
  commands?: CustomCommandOption[];
  prompts?: CustomPromptOption[];
  workspaceId?: string | null;
  workspaceName?: string | null;
  workspacePath?: string | null;
  onManualMemorySelect?: (memory: ManualMemorySelection) => void;
  onNoteCardSelect?: (noteCard: NoteCardSelection) => void;
  onSelectSkill?: (skillName: string) => void;

  // Header/context bar
  placeholder?: string;
  sendShortcut?: 'enter' | 'cmdEnter';
  activeFile?: string;
  selectedLines?: string;
  onClearContext?: () => void;
  selectedAgent?: SelectedAgent | null;
  selectedContextChips?: ContextSelectionChip[];
  selectedManualMemoryIds?: string[];
  selectedNoteCardIds?: string[];
  onRemoveContextChip?: (chip: ContextSelectionChip) => void;
  onAgentSelect?: (agent: SelectedAgent | null) => void;
  onOpenAgentSettings?: () => void;
  onOpenPromptSettings?: () => void;
  onOpenModelSettings?: (providerId?: string) => void;
  onOpenCliSettings?: () => void;
  onOpenFileReference?: (path: string) => void;
  onRefreshModelConfig?: (providerId?: string) => Promise<void> | void;
  isModelConfigRefreshing?: boolean;
  onForkQuickStart?: () => void;
  squadSurface?: React.ReactNode;
  hasMessages?: boolean;
  onRewind?: () => void;
  showRewindEntry?: boolean;
  statusPanelExpanded?: boolean;
  showStatusPanelToggle?: boolean;
  onToggleStatusPanel?: () => void;
  completionEmailSelected?: boolean;
  completionEmailDisabled?: boolean;
  onToggleCompletionEmail?: () => void;
}

/**
 * Adapts Composer's image path strings to ChatInputBox Attachment objects
 */
function pathsToAttachments(paths?: string[]): Attachment[] | undefined {
  if (!paths || paths.length === 0) return undefined;
  return paths.map((path, index) => ({
    id: `img-${index}-${path}`,
    fileName: extractFileName(path),
    mediaType: guessMediaType(path),
    data: path, // Store path as data since Tauri will handle file reading
  }));
}

function extractFileName(path: string): string {
  const sanitizedPath = path.split(/[?#]/, 1)[0] ?? path;
  const normalizedPath = sanitizedPath.replace(/\\/g, '/');
  return normalizedPath.split('/').pop() || path;
}

function guessMediaType(path: string): string {
  const ext = extractFileName(path).split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
  };
  return map[ext] || 'image/png';
}

function isHostAbsolutePath(value: string): boolean {
  return (
    value.startsWith('/') ||
    value.startsWith('\\\\') ||
    /^[A-Za-z]:[\\/]/.test(value)
  );
}

function decodePercentEncoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function fileUriToHostPath(value: string): string | null {
  if (!value.toLowerCase().startsWith('file://')) {
    return null;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'file:') {
      return null;
    }
    const host = parsed.host;
    const isLocalHost = !host || parsed.hostname.toLowerCase() === 'localhost';
    let pathPart = decodePercentEncoded(parsed.pathname || '');
    if (!pathPart) {
      return null;
    }
    // Windows file URI may look like "/C:/Users/demo/image.png"
    if (/^\/[A-Za-z]:\//.test(pathPart)) {
      pathPart = pathPart.slice(1);
    }
    if (isLocalHost) {
      return pathPart;
    }
    // Preserve UNC-like host paths for Windows network shares.
    return `//${host}${pathPart}`;
  } catch {
    // Keep a conservative fallback for malformed URIs.
    let pathPart = value.slice('file://'.length);
    if (
      pathPart.startsWith('localhost/') ||
      pathPart.startsWith('LOCALHOST/')
    ) {
      pathPart = `/${pathPart.slice('localhost/'.length)}`;
    }
    pathPart = decodePercentEncoded(pathPart);
    if (/^\/[A-Za-z]:\//.test(pathPart)) {
      pathPart = pathPart.slice(1);
    }
    return pathPart || null;
  }
}

function attachmentToClaudeImageInput(attachment: Attachment): string | null {
  if (!attachment.mediaType.startsWith('image/')) {
    return null;
  }
  const payload = attachment.data.trim();
  if (!payload) {
    return null;
  }
  if (payload.startsWith('data:')) {
    return payload;
  }
  if (payload.toLowerCase().startsWith('file://')) {
    return payload;
  }
  if (
    payload.startsWith('http://') ||
    payload.startsWith('https://') ||
    isHostAbsolutePath(payload)
  ) {
    return payload;
  }
  return `data:${attachment.mediaType};base64,${payload}`;
}

function attachmentToGeminiImageInput(attachment: Attachment): string | null {
  if (!attachment.mediaType.startsWith('image/')) {
    return null;
  }
  const payload = attachment.data.trim();
  if (!payload) {
    return null;
  }
  if (payload.toLowerCase().startsWith('file://')) {
    return fileUriToHostPath(payload) ?? payload;
  }
  if (payload.startsWith('data:')) {
    const commaIndex = payload.indexOf(',');
    if (commaIndex > -1) {
      const dataSegment = payload.slice(commaIndex + 1).trim();
      if (dataSegment.toLowerCase().startsWith('file://')) {
        return fileUriToHostPath(dataSegment) ?? dataSegment;
      }
    }
    return payload;
  }
  if (
    payload.startsWith('http://') ||
    payload.startsWith('https://') ||
    isHostAbsolutePath(payload)
  ) {
    return payload;
  }
  return `data:${attachment.mediaType};base64,${payload}`;
}

function attachmentsToImageInputs(
  attachments: Attachment[] | undefined,
  provider: 'claude' | 'codex' | 'gemini' | 'grok' | 'kimi' | 'opencode' = 'claude',
): string[] | undefined {
  if (!attachments || attachments.length === 0) {
    return undefined;
  }
  const mapper = provider === 'gemini'
    ? attachmentToGeminiImageInput
    : attachmentToClaudeImageInput;
  const mapped = attachments
    .map(mapper)
    .filter((entry): entry is string => Boolean(entry));
  if (mapped.length === 0) {
    return undefined;
  }
  return Array.from(new Set(mapped));
}

/**
 * Maps Composer engine types to ChatInputBox provider IDs
 */
type ChatInputProvider = 'claude' | 'codex' | 'gemini' | 'grok' | 'kimi' | 'opencode';

function engineToProvider(engine?: EngineType): ChatInputProvider {
  switch (engine) {
    case 'codex':
      return 'codex';
    case 'opencode':
      return 'opencode';
    case 'gemini':
      return 'gemini';
    case 'grok':
      return 'grok';
    case 'kimi':
      return 'kimi';
    case 'claude':
    default:
      return 'claude';
  }
}

function normalizeReasoningEffort(effort?: string | null): ReasoningEffort | null {
  if (effort === null || effort === undefined) {
    return null;
  }
  const normalizedEffort = effort.trim();
  switch (normalizedEffort) {
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
      return 'high';
    case 'xhigh':
      return 'xhigh';
    case 'max':
      return 'max';
    case 'ultra':
      return 'ultra';
    default:
      return null;
  }
}

function effortToOptionalReasoning(effort?: string | null): ReasoningEffort | null {
  return normalizeReasoningEffort(effort);
}

function normalizeReasoningOptions(options?: string[]): ReasoningEffort[] | undefined {
  if (!options) {
    return undefined;
  }
  if (options.length === 0) {
    return [];
  }
  const normalized = options
    .map((option) => effortToOptionalReasoning(option))
    .filter((option): option is ReasoningEffort => option !== null);
  return normalized;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/$/, '');
}

function normalizeCompletionSourcePath(path: unknown): string | null {
  if (typeof path !== 'string') {
    return null;
  }
  const normalizedPath = normalizePath(path.trim());
  return normalizedPath.length > 0 ? normalizedPath : null;
}

function fileNameFromPath(path: string): string {
  const normalized = normalizePath(path);
  const segments = normalized.split('/').filter(Boolean);
  return segments.length > 0 ? (segments[segments.length - 1] ?? path) : path;
}

function stemNameFromPath(path: string): string {
  const fileName = fileNameFromPath(path);
  const idx = fileName.lastIndexOf('.');
  if (idx <= 0 || idx >= fileName.length - 1) {
    return fileName;
  }
  return fileName.slice(0, idx);
}

function extensionFromFileName(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  if (idx <= 0 || idx >= fileName.length - 1) {
    return '';
  }
  return fileName.slice(idx + 1).toLowerCase();
}

function isSubsequenceMatch(query: string, target: string) {
  let queryIndex = 0;
  let targetIndex = 0;
  while (queryIndex < query.length && targetIndex < target.length) {
    if (query[queryIndex] === target[targetIndex]) {
      queryIndex += 1;
    }
    targetIndex += 1;
  }
  return queryIndex === query.length;
}

function scoreCompletionPath(path: string, query: string) {
  const normalizedQuery = normalizePath(query).trim().toLowerCase();
  if (!normalizedQuery) {
    return 0;
  }
  const normalizedPath = normalizePath(path).toLowerCase();
  const fileName = fileNameFromPath(path).toLowerCase();
  const stemName = stemNameFromPath(path).toLowerCase();
  if (fileName === normalizedQuery || stemName === normalizedQuery) {
    return 120;
  }
  if (stemName.startsWith(normalizedQuery)) {
    return 115;
  }
  if (fileName.startsWith(normalizedQuery)) {
    return 110;
  }
  if (normalizedPath.startsWith(normalizedQuery)) {
    return 95;
  }
  if (fileName.includes(normalizedQuery)) {
    return 90;
  }
  if (normalizedPath.includes(normalizedQuery)) {
    return 70;
  }
  if (isSubsequenceMatch(normalizedQuery, fileName)) {
    return 50;
  }
  return 0;
}

function rankCompletionPaths(paths: readonly unknown[], query: string) {
  return paths
    .map((path) => {
      const normalizedPath = normalizeCompletionSourcePath(path);
      if (!normalizedPath) {
        return null;
      }
      const score = scoreCompletionPath(normalizedPath, query);
      return score > 0 ? { path: normalizedPath, score } : null;
    })
    .filter((entry): entry is { path: string; score: number } => entry !== null)
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      const leafLengthDelta =
        fileNameFromPath(left.path).length - fileNameFromPath(right.path).length;
      if (leafLengthDelta !== 0) {
        return leafLengthDelta;
      }
      return left.path.localeCompare(right.path);
    });
}

function normalizeSlashCommandName(name: unknown): string | null {
  if (typeof name !== 'string') {
    return null;
  }
  const cleanName = name.trim().replace(/^\//, '');
  return cleanName.length > 0 ? cleanName : null;
}

function normalizeOptionalString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

type SkillPayloadRecord = Record<string, unknown>;
type RawSkillEntry = SkillPayloadRecord & {
  name?: unknown;
  skillName?: unknown;
  enabled?: unknown;
  source?: unknown;
  description?: unknown;
  shortDescription?: unknown;
  interface?: unknown;
  path?: unknown;
};

function asSkillPayloadRecord(value: unknown): SkillPayloadRecord | null {
  return typeof value === 'object' && value !== null
    ? (value as SkillPayloadRecord)
    : null;
}

function asRawSkillEntries(value: unknown): RawSkillEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const record = asSkillPayloadRecord(entry);
    return record ? [record as RawSkillEntry] : [];
  });
}

function flattenSkillBuckets(buckets: unknown): RawSkillEntry[] {
  if (!Array.isArray(buckets)) {
    return [];
  }
  return buckets.flatMap((bucket) => {
    const record = asSkillPayloadRecord(bucket);
    return asRawSkillEntries(record?.skills);
  });
}

function extractRawSkills(response: unknown): RawSkillEntry[] {
  if (Array.isArray(response)) {
    return asRawSkillEntries(response);
  }
  const payload = asSkillPayloadRecord(response);
  if (!payload) {
    return [];
  }
  const rawResult = payload.result;
  const payloadResult = asSkillPayloadRecord(rawResult);

  if (Array.isArray(payload?.skills)) {
    return asRawSkillEntries(payload.skills);
  }
  if (Array.isArray(payloadResult?.skills)) {
    return asRawSkillEntries(payloadResult.skills);
  }

  const fromResultData = flattenSkillBuckets(payloadResult?.data);
  if (fromResultData.length > 0) {
    return fromResultData;
  }

  const fromData = flattenSkillBuckets(payload?.data);
  if (fromData.length > 0) {
    return fromData;
  }

  if (Array.isArray(rawResult)) {
    return asRawSkillEntries(rawResult);
  }

  return [];
}

const SKILL_SOURCE_PRIORITY: Record<string, number> = {
  workspace_managed: 0,
  project_claude: 1,
  project_codex: 2,
  project_agents: 3,
  global_claude: 4,
  custom: 5,
  global_claude_plugin: 6,
  global_codex: 7,
  global_agents: 8,
};

function normalizeSkillName(value: unknown) {
  return String(value ?? '')
    .trim()
    .replace(/^[/$]+/, '');
}

function resolveSkillScope(source?: string): 'global' | 'project' {
  if (source && (source.startsWith('global_') || source === 'custom')) {
    return 'global';
  }
  return 'project';
}

export const ChatInputBoxAdapter = memo(forwardRef<ChatInputBoxHandle, ChatInputBoxAdapterProps>(
  (props, ref) => {
    const {
      text,
      disabled,
      submitDisabled,
      isProcessing,
      streamActivityPhase = 'idle',
      onTextChange,
      onSend,
      onStop,
      permissionMode,
      onModeSelect,
      selectedModelId,
      selectedEngine,
      isSharedSession = false,
      providerTargetPickerMode,
      engines,
      models,
      providerModelCatalogs,
      providerProfileId,
      executionTarget,
      onExecutionTargetChange,
      reasoningOptions,
      selectedEffort,
      onSelectEffort,
      alwaysThinkingEnabled,
      onToggleThinking,
      onResolvedAlwaysThinkingChange,
      streamingEnabled,
      onStreamingEnabledChange,
      attachments,
      hasContextAttachment = false,
      onAddAttachment,
      onRemoveAttachment,
      contextUsage,
      claudeContextUsage,
      accountRateLimits,
      usageShowRemaining,
      onRefreshAccountRateLimits,
      selectedCollaborationModeId,
      onSelectCollaborationMode,
      onCodexQuickCommand,
      memoryReferenceMode,
      onSetMemoryReferenceMode,
      queuedMessages,
      sendReadiness,
      onJumpToRequest,
      onOpenSkillsSettings,
      onDeleteQueued,
      onFuseQueued,
      canFuseQueuedMessages = false,
      fuseDisabledReasonKey = null,
      fusingQueuedMessageId = null,
      files,
      customSkillDirectories,
      directories,
      commands,
      prompts = [],
      workspaceId,
      workspaceName,
      workspacePath,
      onManualMemorySelect,
      onNoteCardSelect,
      onSelectSkill,
      placeholder,
      sendShortcut = 'enter',
      activeFile,
      selectedLines,
      onClearContext,
      selectedAgent,
      selectedContextChips,
      selectedManualMemoryIds,
      selectedNoteCardIds,
      onRemoveContextChip,
      onAgentSelect,
      onOpenAgentSettings,
      onOpenPromptSettings,
      onOpenModelSettings,
      onOpenCliSettings,
      onOpenFileReference,
      onRefreshModelConfig,
      isModelConfigRefreshing,
      onForkQuickStart,
      squadSurface,
      hasMessages,
      onRewind,
      showRewindEntry,
      statusPanelExpanded,
      showStatusPanelToggle,
      onToggleStatusPanel,
      completionEmailSelected,
      completionEmailDisabled,
      onToggleCompletionEmail,
    } = props;
    // 统一 Atomic 双栏；Shared Session 用 shared catalog，其余 create-session。
    const effectiveProviderTargetPickerMode =
      providerTargetPickerMode ?? (isSharedSession ? 'shared' : 'create-session');
    const { t } = useTranslation();
    const chatInputRef = useRef<ChatInputBoxHandle>(null);
    const renderCountRef = useRef(0);
    renderCountRef.current += 1;
    const [localAlwaysThinkingEnabled, setLocalAlwaysThinkingEnabled] =
      useState(false);
    const hasResolvedAlwaysThinkingRef = useRef<{
      resolved: boolean;
      lastReported: boolean | null;
    }>({
      resolved: alwaysThinkingEnabled !== undefined,
      lastReported: null,
    });
    const [localStreamingEnabled, setLocalStreamingEnabled] = useState(
      () => readStoredStreamingEnabled(),
    );
    const [codexSpeedMode, setCodexSpeedMode] = useState<CodexSpeedMode>('unknown');
    const isCodexEngine = selectedEngine === 'codex';
    const normalizedModels = useMemo(() => {
      return normalizeAdapterModelOptions(models);
    }, [models]);
    const normalizedProviderModelCatalogs = useMemo(() => {
      if (!providerModelCatalogs) {
        return undefined;
      }
      const catalogs: ProviderModelCatalogs = {};
      (Object.entries(providerModelCatalogs) as [
        EngineType,
        AdapterModelOption[] | undefined,
      ][]).forEach(([engineType, catalog]) => {
        const normalizedCatalog = normalizeAdapterModelOptions(catalog);
        if (normalizedCatalog && normalizedCatalog.length > 0) {
          catalogs[engineType] = normalizedCatalog;
        }
      });
      return Object.keys(catalogs).length > 0 ? catalogs : undefined;
    }, [providerModelCatalogs]);
    const resolvedSelectedModelId = useMemo(() => {
      if (selectedModelId) {
        return selectedModelId;
      }
      if (selectedEngine === 'codex') {
        return '';
      }
      if (models && models.length > 0) {
        return models[0]?.id ?? '';
      }
      return '';
    }, [models, selectedEngine, selectedModelId]);

    // Expose ChatInputBoxHandle to parent
    useImperativeHandle(ref, () => ({
      getValue: () => chatInputRef.current?.getValue() ?? '',
      setValue: (value: string) => chatInputRef.current?.setValue(value),
      focus: () => chatInputRef.current?.focus(),
      clear: () => chatInputRef.current?.clear(),
      hasContent: () => chatInputRef.current?.hasContent() ?? false,
      getFileTags: () => chatInputRef.current?.getFileTags() ?? [],
    }));

    useEffect(() => {
      if (isCodexEngine || alwaysThinkingEnabled !== undefined) {
        return;
      }
      let cancelled = false;
      hasResolvedAlwaysThinkingRef.current.resolved = false;
      const loadActiveThinkingSetting = async () => {
        try {
          const providers = (await getClaudeProviders()) as ClaudeProviderLike[];
          if (cancelled) {
            return;
          }
          const activeProvider = findActiveClaudeProvider(providers);
          const activeProviderThinking =
            activeProvider?.settingsConfig?.alwaysThinkingEnabled;
          if (typeof activeProviderThinking === 'boolean') {
            hasResolvedAlwaysThinkingRef.current.resolved = true;
            setLocalAlwaysThinkingEnabled(
              activeProviderThinking,
            );
            if (
              hasResolvedAlwaysThinkingRef.current.lastReported !==
              activeProviderThinking
            ) {
              hasResolvedAlwaysThinkingRef.current.lastReported =
                activeProviderThinking;
              onResolvedAlwaysThinkingChange?.(activeProviderThinking);
            }
            return;
          }
          const enabled = await getClaudeAlwaysThinkingEnabled();
          if (cancelled) {
            return;
          }
          hasResolvedAlwaysThinkingRef.current.resolved = true;
          setLocalAlwaysThinkingEnabled(enabled);
          if (hasResolvedAlwaysThinkingRef.current.lastReported !== enabled) {
            hasResolvedAlwaysThinkingRef.current.lastReported = enabled;
            onResolvedAlwaysThinkingChange?.(enabled);
          }
        } catch {
          // Keep the state unresolved on read failure so send-time logic does
          // not accidentally force-disable Claude thinking before settings load.
        }
      };
      void loadActiveThinkingSetting();
      return () => {
        cancelled = true;
      };
    }, [
      alwaysThinkingEnabled,
      isCodexEngine,
      onResolvedAlwaysThinkingChange,
    ]);

    useEffect(() => {
      appendComposerRenderBudgetDiagnostic({
        surfaceId: 'chat-input-adapter',
        evidenceKind: 'proxy',
        workspaceId,
        renderCount: renderCountRef.current,
        isProcessing: Boolean(isProcessing),
        disabled: Boolean(disabled),
        streamActivityPhase,
        textLength: text.length,
      });
    });

    // Handle input from ChatInputBox -> Composer text state
    const handleInput = useCallback((content: string) => {
      onTextChange(content, null);
    }, [onTextChange]);

    // Handle submit from ChatInputBox
    const handleSubmit = useCallback((submittedText: string, submittedAttachments?: Attachment[]) => {
      const provider = engineToProvider(selectedEngine);
      const fallbackAttachments =
        submittedAttachments ?? pathsToAttachments(attachments);
      onSend(submittedText, attachmentsToImageInputs(fallbackAttachments, provider));
    }, [attachments, onSend, selectedEngine]);

    // Handle attachment removal (convert Attachment id back to path)
    const handleRemoveAttachment = useCallback((id: string) => {
      // id format: "img-{index}-{path}"
      const path = id.replace(/^img-\d+-/, '');
      onRemoveAttachment?.(path);
    }, [onRemoveAttachment]);

    // Handle reasoning effort change
    const handleReasoningChange = useCallback((effort: ReasoningEffort | null) => {
      onSelectEffort?.(effort);
    }, [onSelectEffort]);

    const handleThinkingToggle = useCallback(
      async (enabled: boolean) => {
        if (isCodexEngine) {
          return;
        }
        hasResolvedAlwaysThinkingRef.current.resolved = true;
        setLocalAlwaysThinkingEnabled(enabled);
        if (onToggleThinking) {
          onToggleThinking(enabled);
          return;
        }
        const rollbackValue = localAlwaysThinkingEnabled;
        try {
          const providers = (await getClaudeProviders()) as ClaudeProviderLike[];
          const activeProvider = findActiveClaudeProvider(providers);
          if (!activeProvider || isLocalClaudeProvider(activeProvider)) {
            await setClaudeAlwaysThinkingEnabled(enabled);
            return;
          }
          const nextProvider = {
            ...activeProvider,
            settingsConfig: {
              ...(activeProvider.settingsConfig ?? {}),
              alwaysThinkingEnabled: enabled,
            },
          };
          await updateClaudeProvider(activeProvider.id, nextProvider);
        } catch {
          setLocalAlwaysThinkingEnabled(rollbackValue);
        }
      },
      [isCodexEngine, localAlwaysThinkingEnabled, onToggleThinking],
    );

    const handleStreamingToggle = useCallback(
      (enabled: boolean) => {
        if (isCodexEngine) {
          return;
        }
        setLocalStreamingEnabled(enabled);
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(
            STREAMING_ENABLED_STORAGE_KEY,
            enabled ? '1' : '0',
          );
        }
        onStreamingEnabledChange?.(enabled);
      },
      [isCodexEngine, onStreamingEnabledChange],
    );

    const handleCodexSpeedModeChange = useCallback(
      (mode: Exclude<CodexSpeedMode, 'unknown'>) => {
        setCodexSpeedMode(mode);
        void onCodexQuickCommand?.(mode === 'fast' ? '/fast on' : '/fast off');
      },
      [onCodexQuickCommand],
    );

    const handleCodexReviewQuickStart = useCallback(() => {
      void onCodexQuickCommand?.('/review');
    }, [onCodexQuickCommand]);

    const resolvedAlwaysThinkingEnabled = isCodexEngine
      ? true
      : alwaysThinkingEnabled !== undefined
        ? alwaysThinkingEnabled
        : localAlwaysThinkingEnabled;

    useEffect(() => {
      if (isCodexEngine) {
        return;
      }
      if (
        alwaysThinkingEnabled === undefined &&
        !hasResolvedAlwaysThinkingRef.current.resolved
      ) {
        return;
      }
      if (
        hasResolvedAlwaysThinkingRef.current.lastReported !==
        resolvedAlwaysThinkingEnabled
      ) {
        hasResolvedAlwaysThinkingRef.current.lastReported =
          resolvedAlwaysThinkingEnabled;
        onResolvedAlwaysThinkingChange?.(resolvedAlwaysThinkingEnabled);
      }
    }, [
      alwaysThinkingEnabled,
      isCodexEngine,
      onResolvedAlwaysThinkingChange,
      resolvedAlwaysThinkingEnabled,
    ]);

    const resolvedStreamingEnabled = isCodexEngine
      ? true
      : streamingEnabled !== undefined
        ? streamingEnabled
        : localStreamingEnabled;

    // Convert context usage
    const usagePercentage = useMemo(() => {
      if (!contextUsage) return null;
      const { used, total } = contextUsage;
      return total > 0 ? Math.round((used / total) * 100) : null;
    }, [contextUsage]);

    // Convert queued messages (Composer uses text/createdAt, ChatInputBox uses content/queuedAt)
    const messageQueue = useMemo(() => {
      if (!queuedMessages) return undefined;
      return queuedMessages.map(q => ({
        id: q.id,
        content: q.text,
        fullContent: q.text,
        queuedAt: q.createdAt,
        isFusing: q.id === fusingQueuedMessageId,
        // Shared pending-ack：仅透传 UI 标识，队列出队逻辑不变
        isPendingAck: q.sharedDispatchState === "pending-ack",
      }));
    }, [fusingQueuedMessageId, queuedMessages]);

    const fullWorkspaceFileCompletionCacheRef = useRef<{
      workspaceId: string;
      response: unknown | null;
      promise: Promise<unknown> | null;
    } | null>(null);

    const fileCompletionProvider = useCallback(
      async (query: string, signal: AbortSignal): Promise<FileItem[]> => {
        if (signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        const maxSuggestions = 200;
        const results: FileItem[] = [];
        const seenResultKeys = new Set<string>();

        const pushResult = (item: FileItem) => {
          const resultKey = `${item.type}:${item.path}`;
          if (seenResultKeys.has(resultKey)) {
            return;
          }
          seenResultKeys.add(resultKey);
          results.push(item);
        };

        const pushDirectoryFromPath = (path: unknown) => {
          const sourcePath = normalizeCompletionSourcePath(path);
          if (!sourcePath) {
            return;
          }
          const normalizedPath = `${sourcePath}/`;
          const name = fileNameFromPath(sourcePath);
          if (!name) {
            return;
          }
          pushResult({
            name,
            path: normalizedPath,
            absolutePath: normalizedPath,
            type: 'directory',
            extension: '',
          });
        };
        const pushFileFromPath = (path: unknown) => {
          const normalizedPath = normalizeCompletionSourcePath(path);
          if (!normalizedPath) {
            return;
          }
          const name = fileNameFromPath(normalizedPath);
          if (!name) {
            return;
          }
          pushResult({
            name,
            path: normalizedPath,
            absolutePath: normalizedPath,
            type: 'file',
            extension: extensionFromFileName(name),
          });
        };
        const getResponseDirectories = (response: unknown): unknown[] => {
          if (!response || typeof response !== 'object') {
            return [];
          }
          const directoriesValue = (response as { directories?: unknown }).directories;
          return Array.isArray(directoriesValue) ? directoriesValue : [];
        };
        const getResponseFiles = (response: unknown): unknown[] => {
          if (!response || typeof response !== 'object') {
            return [];
          }
          const filesValue = (response as { files?: unknown }).files;
          return Array.isArray(filesValue) ? filesValue : [];
        };
        const getFullWorkspaceSnapshot = async () => {
          if (!workspaceId) {
            return null;
          }
          const cached = fullWorkspaceFileCompletionCacheRef.current;
          if (cached?.workspaceId === workspaceId && cached.response) {
            return cached.response;
          }
          if (cached?.workspaceId === workspaceId && cached.promise) {
            return cached.promise;
          }
          const promise = getWorkspaceFiles(workspaceId)
            .then((response) => {
              const nextCache = fullWorkspaceFileCompletionCacheRef.current;
              if (nextCache?.workspaceId === workspaceId) {
                nextCache.response = response;
                nextCache.promise = null;
              }
              return response;
            })
            .catch((error) => {
              const nextCache = fullWorkspaceFileCompletionCacheRef.current;
              if (nextCache?.workspaceId === workspaceId) {
                nextCache.promise = null;
              }
              throw error;
            });
          fullWorkspaceFileCompletionCacheRef.current = {
            workspaceId,
            response: null,
            promise,
          };
          return promise;
        };
        const pushFromResponse = (response: unknown) => {
          for (const dir of getResponseDirectories(response)) {
            pushDirectoryFromPath(dir);
            if (results.length >= maxSuggestions) return;
          }
          for (const file of getResponseFiles(response)) {
            pushFileFromPath(file);
            if (results.length >= maxSuggestions) return;
          }
        };

        const normalizedQuery = query.trim();

        // Parse query: separate directory path from search fragment
        // e.g. "src/com" -> { dirPath: "src", fragment: "com" }
        // e.g. "src/"   -> { dirPath: "src", fragment: "" }
        // e.g. "but"    -> { dirPath: "", fragment: "but" }
        const lastSlashIndex = normalizedQuery.lastIndexOf('/');
        const dirPath = lastSlashIndex >= 0 ? normalizedQuery.slice(0, lastSlashIndex) : '';
        const fragment = lastSlashIndex >= 0 ? normalizedQuery.slice(lastSlashIndex + 1) : normalizedQuery;
        const lowerFragment = fragment.toLowerCase();

        // If we have a workspace ID and a directory path, use lazy loading
        if (workspaceId && dirPath) {
          try {
            const response = await getWorkspaceDirectoryChildren(workspaceId, dirPath);
            if (signal.aborted) {
              throw new DOMException('Aborted', 'AbortError');
            }
            if (!lowerFragment) {
              // No search term - show all direct children of the directory
              pushFromResponse(response);
            } else {
              // Filter by fragment
              for (const dir of getResponseDirectories(response)) {
                const normalizedDir = normalizeCompletionSourcePath(dir);
                if (!normalizedDir) {
                  continue;
                }
                const name = fileNameFromPath(normalizedDir);
                if (name.toLowerCase().includes(lowerFragment)) {
                  pushDirectoryFromPath(normalizedDir);
                  if (results.length >= maxSuggestions) break;
                }
              }
              for (const file of getResponseFiles(response)) {
                const normalizedFile = normalizeCompletionSourcePath(file);
                if (!normalizedFile) {
                  continue;
                }
                const name = fileNameFromPath(normalizedFile);
                if (name.toLowerCase().includes(lowerFragment)) {
                  pushFileFromPath(normalizedFile);
                  if (results.length >= maxSuggestions) break;
                }
              }
            }
            return results;
          } catch (error) {
            if ((error as Error).name === 'AbortError') throw error;
            // Fallback to local filtering on error
          }
        }

        // For root-level browsing or search, use the pre-loaded file/directory arrays
        const sourceDirectories = directories ?? [];
        const sourceFiles = files ?? [];

        if (!normalizedQuery) {
          // No query: show only root-level entries (direct children of workspace root)
          for (const path of sourceDirectories) {
            const normalizedPath = normalizeCompletionSourcePath(path);
            if (normalizedPath && !normalizedPath.includes('/')) {
              pushDirectoryFromPath(normalizedPath);
              if (results.length >= maxSuggestions) return results;
            }
          }
          for (const path of sourceFiles) {
            const normalizedPath = normalizeCompletionSourcePath(path);
            if (normalizedPath && !normalizedPath.includes('/')) {
              pushFileFromPath(normalizedPath);
              if (results.length >= maxSuggestions) return results;
            }
          }
          return results;
        }

        // Search query without directory path: search by name across all entries
        for (const entry of rankCompletionPaths(sourceDirectories, fragment)) {
          pushDirectoryFromPath(entry.path);
          if (results.length >= maxSuggestions) return results;
        }
        for (const entry of rankCompletionPaths(sourceFiles, fragment)) {
          pushFileFromPath(entry.path);
          if (results.length >= maxSuggestions) return results;
        }
        if (workspaceId && results.length < maxSuggestions) {
          try {
            const fullSnapshot = await getFullWorkspaceSnapshot();
            if (signal.aborted) {
              throw new DOMException('Aborted', 'AbortError');
            }
            for (const entry of rankCompletionPaths(getResponseDirectories(fullSnapshot), fragment)) {
              pushDirectoryFromPath(entry.path);
              if (results.length >= maxSuggestions) return results;
            }
            for (const entry of rankCompletionPaths(getResponseFiles(fullSnapshot), fragment)) {
              pushFileFromPath(entry.path);
              if (results.length >= maxSuggestions) return results;
            }
          } catch (error) {
            if ((error as Error).name === 'AbortError') {
              throw error;
            }
          }
        }
        return results;
      },
      [directories, files, workspaceId],
    );

    const manualMemoryCompletionProvider = useCallback(
      async (query: string, signal: AbortSignal): Promise<ManualMemorySelection[]> => {
        if (!workspaceId) {
          return [];
        }
        if (signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        const response = await projectMemoryFacade.list({
          workspaceId,
          query: query.trim() || null,
          importance: null,
          kind: null,
          tag: null,
          page: 0,
          pageSize: 50,
        });
        if (signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        return response.items.map((item) => ({
          id: item.id,
          title: item.title?.trim() || item.summary?.trim() || item.id,
          summary: item.summary?.trim() || '',
          detail: item.detail?.trim() || item.cleanText?.trim() || item.summary?.trim() || '',
          kind: item.kind || 'note',
          importance: item.importance || 'normal',
          updatedAt: item.updatedAt || item.createdAt || Date.now(),
          tags: Array.isArray(item.tags) ? item.tags.filter(Boolean) : [],
        }));
      },
      [workspaceId],
    );

    const noteCardCompletionProvider = useCallback(
      async (query: string, signal: AbortSignal): Promise<NoteCardItem[]> => {
        if (!workspaceId) {
          return [];
        }
        if (signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        const normalizedQuery = query.trim() || null;
        const [activeResponse, archivedResponse] = await Promise.all([
          noteCardsFacade.list({
            workspaceId,
            workspaceName,
            workspacePath,
            archived: false,
            query: normalizedQuery,
            page: 0,
            pageSize: 25,
          }),
          noteCardsFacade.list({
            workspaceId,
            workspaceName,
            workspacePath,
            archived: true,
            query: normalizedQuery,
            page: 0,
            pageSize: 25,
          }),
        ]);
        if (signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        return [...activeResponse.items, ...archivedResponse.items].map((item) => ({
          id: item.id,
          title: item.title?.trim() || item.plainTextExcerpt?.trim() || item.id,
          plainTextExcerpt: item.plainTextExcerpt?.trim() || '',
          bodyMarkdown: item.bodyMarkdown?.trim() || item.plainTextExcerpt?.trim() || '',
          updatedAt: item.updatedAt || item.createdAt || Date.now(),
          archived: item.archived,
          imageCount: item.imageCount || 0,
          previewAttachments: Array.isArray(item.previewAttachments)
            ? item.previewAttachments
                .filter(
                  (attachment): attachment is NoteCardSelection["previewAttachments"][number] =>
                    typeof attachment?.id === 'string'
                    && typeof attachment?.fileName === 'string'
                    && typeof attachment?.contentType === 'string'
                    && typeof attachment?.absolutePath === 'string',
                )
                .map((attachment) => ({
                  id: attachment.id,
                  fileName: attachment.fileName,
                  contentType: attachment.contentType,
                  absolutePath: attachment.absolutePath,
                }))
            : [],
        }));
      },
      [workspaceId, workspaceName, workspacePath],
    );

    const builtinSlashCommands = useMemo<CommandItem[]>(() => {
      const commands: CommandItem[] = [
        { id: 'clear', label: '/clear', description: t('chat.commands.clear'), category: 'system' },
        { id: 'new', label: '/new', description: t('chat.commands.new'), category: 'system' },
        { id: 'status', label: '/status', description: t('chat.commands.status'), category: 'session' },
        { id: 'context', label: '/context', description: t('chat.commands.context'), category: 'session' },
        { id: 'resume', label: '/resume', description: t('chat.commands.resume'), category: 'session' },
        { id: 'review', label: '/review', description: t('chat.commands.review'), category: 'workflow' },
        { id: 'fork', label: '/fork', description: t('chat.commands.fork'), category: 'workflow' },
        { id: 'mcp', label: '/mcp', description: t('chat.commands.mcp'), category: 'tooling' },
        { id: 'export', label: '/export', description: t('chat.commands.export'), category: 'session' },
        { id: 'import', label: '/import', description: t('chat.commands.import'), category: 'session' },
        { id: 'lsp', label: '/lsp', description: t('chat.commands.lsp'), category: 'tooling' },
        { id: 'share', label: '/share', description: t('chat.commands.share'), category: 'session' },
        { id: 'spec-root', label: '/spec-root', description: t('chat.commands.specRoot'), category: 'tooling' },
      ];
      if (selectedEngine === 'claude') {
        commands.push({
          id: 'compact',
          label: '/compact',
          description: t('chat.commands.compact'),
          category: 'session',
        });
      }
      if (selectedEngine === 'codex') {
        commands.push(
          {
            id: 'fast',
            label: '/fast',
            description: t('chat.commands.fast'),
            category: 'workflow',
          },
          {
            id: 'goal',
            label: '/goal',
            description: t('chat.commands.goal'),
            category: 'workflow',
          },
          {
            id: 'goal-pause',
            label: '/goal pause',
            description: t('chat.commands.goalPause'),
            category: 'workflow',
          },
          {
            id: 'goal-resume',
            label: '/goal resume',
            description: t('chat.commands.goalResume'),
            category: 'workflow',
          },
          {
            id: 'goal-clear',
            label: '/goal clear',
            description: t('chat.commands.goalClear'),
            category: 'workflow',
          },
          {
            id: 'plan',
            label: '/plan',
            description: t('chat.commands.plan'),
            category: 'workflow',
          },
          {
            id: 'default',
            label: '/default',
            description: t('chat.commands.defaultMode'),
            category: 'workflow',
          },
          {
            id: 'code',
            label: '/code',
            description: t('chat.commands.code'),
            category: 'workflow',
          },
          {
            id: 'mode',
            label: '/mode',
            description: t('chat.commands.mode'),
            category: 'workflow',
          },
        );
      }
      return commands;
    }, [selectedEngine, t]);

    const completionCommands = useMemo<CommandItem[]>(() => {
      const commandSource = Array.isArray(commands) ? commands : [];
      const customCommands = commandSource.reduce<CommandItem[]>((acc, entry) => {
        const cleanName = normalizeSlashCommandName(entry?.name);
        if (!cleanName) {
          return acc;
        }
        acc.push({
          id: cleanName,
          label: `/${cleanName}`,
          description: normalizeOptionalString(entry.description),
          category: 'custom',
        });
        return acc;
      }, []);

      const seen = new Set<string>();
      const merged = [...builtinSlashCommands, ...customCommands].filter((entry) => {
        const key = entry.label.toLowerCase();
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
      return merged;
    }, [commands, builtinSlashCommands]);

    const providerAvailability = useMemo(() => {
      if (!engines || engines.length === 0) {
        return undefined;
      }
      const engineMap = new Map(engines.map((entry) => [entry.type, entry]));
      const isEngineEnabled = (engine: EngineType) =>
        (
          engineMap.get(engine)?.availabilityState
            ? engineMap.get(engine)?.availabilityState === "ready"
            : Boolean(engineMap.get(engine)?.installed)
        ) &&
        (!isSharedSession || isSharedSessionSupportedEngine(engine));
      return {
        claude: isEngineEnabled('claude'),
        codex: isEngineEnabled('codex'),
        opencode: isEngineEnabled('opencode'),
        gemini: isEngineEnabled('gemini'),
        grok: isEngineEnabled('grok'),
        kimi: isEngineEnabled('kimi'),
      } as const;
    }, [engines, isSharedSession]);

    const providerStatusLabels = useMemo(() => {
      if (!engines || engines.length === 0) {
        return undefined;
      }

      const byEngine = new Map(engines.map((entry) => [entry.type, entry]));
      const resolveStatusLabel = (engineType: EngineType) => {
        const engine = byEngine.get(engineType);
        if (!engine?.availabilityLabelKey) {
          return null;
        }
        return t(engine.availabilityLabelKey);
      };

      return {
        claude: resolveStatusLabel('claude'),
        codex: resolveStatusLabel('codex'),
        opencode: resolveStatusLabel('opencode'),
        gemini: resolveStatusLabel('gemini'),
        grok: resolveStatusLabel('grok'),
        kimi: resolveStatusLabel('kimi'),
      } as const;
    }, [engines, t]);

    const providerVersions = useMemo(() => {
      if (!engines || engines.length === 0) {
        return undefined;
      }

      const engineDisplayName: Record<EngineType, string> = {
        claude: 'Claude Code',
        codex: 'Codex CLI',
        gemini: 'Gemini CLI',
        grok: 'Grok CLI',
        kimi: 'Kimi CLI',
        opencode: 'OpenCode',
      };

      const byEngine = new Map(engines.map((entry) => [entry.type, entry]));
      const resolveVersion = (engineType: EngineType) => {
        const engine = byEngine.get(engineType);
        if (!engine?.version) {
          return null;
        }
        return formatEngineVersionLabel({
          type: engineType,
          displayName: engineDisplayName[engineType],
          shortName: engineDisplayName[engineType],
          installed: engine.installed,
          version: engine.version,
          error: null,
        });
      };

      return {
        claude: resolveVersion('claude'),
        codex: resolveVersion('codex'),
        opencode: resolveVersion('opencode'),
        gemini: resolveVersion('gemini'),
        grok: resolveVersion('grok'),
        kimi: resolveVersion('kimi'),
      } as const;
    }, [engines]);

    const commandCompletionProvider = useCallback(
      async (query: string, signal: AbortSignal): Promise<CommandItem[]> => {
        if (signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        const normalizedQuery = query.trim().toLowerCase();
        if (!normalizedQuery) {
          return completionCommands;
        }
        return completionCommands.filter((entry) => {
          const label = entry.label.toLowerCase();
          const id = entry.id.toLowerCase();
          const description = entry.description?.toLowerCase() ?? '';
          return (
            label.includes(normalizedQuery) ||
            id.includes(normalizedQuery) ||
            description.includes(normalizedQuery)
          );
        });
      },
      [completionCommands],
    );

    const skillCompletionProvider = useCallback(
      async (query: string, signal: AbortSignal): Promise<SkillItem[]> => {
        if (!workspaceId || signal.aborted) {
          return [];
        }

        const response = await getSkillsList(workspaceId, customSkillDirectories ?? []);
        if (signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        const rawSkills = extractRawSkills(response);
        const dedupedByScopeAndName = new Map<string, SkillItem>();
        const normalizedQuery = query.trim().toLowerCase();

        for (const item of rawSkills) {
          if (!item || typeof item !== 'object' || item.enabled === false) {
            continue;
          }
          const rawName =
            typeof item.name === 'string'
              ? item.name
              : typeof item.skillName === 'string'
                ? item.skillName
                : '';
          const name = normalizeSkillName(rawName);
          if (!name) {
            continue;
          }
          const source =
            typeof item.source === 'string' && item.source.trim()
              ? item.source.trim()
              : undefined;
          const interfaceObject = asSkillPayloadRecord(item.interface);
          const description =
            typeof item.description === 'string'
              ? item.description.trim()
              : typeof item.shortDescription === 'string'
                ? item.shortDescription.trim()
                : typeof interfaceObject?.shortDescription === 'string'
                  ? interfaceObject.shortDescription.trim()
                  : undefined;
          const scope = resolveSkillScope(source);
          const skill: SkillItem = {
            name,
            path: typeof item.path === 'string' ? item.path : '',
            description: description || undefined,
            source,
            scopeLabel: scope === 'global' ? t('chat.skillScopeGlobal') : t('chat.skillScopeProject'),
          };

          const key = `${scope}:${name.toLowerCase()}`;
          const prev = dedupedByScopeAndName.get(key);
          if (!prev) {
            dedupedByScopeAndName.set(key, skill);
            continue;
          }
          const prevPriority = SKILL_SOURCE_PRIORITY[prev.source ?? ''] ?? Number.MAX_SAFE_INTEGER;
          const currentPriority = SKILL_SOURCE_PRIORITY[source ?? ''] ?? Number.MAX_SAFE_INTEGER;
          if (currentPriority < prevPriority) {
            dedupedByScopeAndName.set(key, skill);
          }
        }

        return Array.from(dedupedByScopeAndName.values())
          .filter((skill) => {
            if (!normalizedQuery) {
              return true;
            }
            const text = `${skill.name} ${skill.description ?? ''}`.toLowerCase();
            return text.includes(normalizedQuery);
          })
          .sort((a, b) => {
            const ap = SKILL_SOURCE_PRIORITY[a.source ?? ''] ?? Number.MAX_SAFE_INTEGER;
            const bp = SKILL_SOURCE_PRIORITY[b.source ?? ''] ?? Number.MAX_SAFE_INTEGER;
            if (ap !== bp) {
              return ap - bp;
            }
            return a.name.localeCompare(b.name);
          });
      },
      [customSkillDirectories, t, workspaceId],
    );

    const promptCompletionProvider = useCallback(
      async (query: string, signal: AbortSignal): Promise<PromptItem[]> => {
        if (signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        // 内存为空时 on-demand revalidate：修复启动 soft-failure 导致的永久空态。
        // 非空时只读 props，避免每次 `!` 打 IPC。
        let sourcePrompts = prompts;
        if (sourcePrompts.length === 0 && workspaceId) {
          const refreshed = await requestCustomPromptsRefresh(
            workspaceId,
            'on-demand',
            { skipIfAuthoritative: true },
          );
          if (signal.aborted) {
            throw new DOMException('Aborted', 'AbortError');
          }
          if (Array.isArray(refreshed) && refreshed.length > 0) {
            sourcePrompts = refreshed;
          }
        }

        const normalizedQuery = query.trim().toLowerCase();
        const filteredPrompts = sourcePrompts
          .filter((prompt) => prompt.name)
          .filter((prompt) => {
            if (!normalizedQuery) {
              return true;
            }
            const scopeLabel = prompt.scope === 'global'
              ? t('settings.prompt.scopeGlobal')
              : t('settings.prompt.scopeWorkspace');
            const haystack =
              `${prompt.name} ${prompt.description ?? ''} ${prompt.content} ${prompt.argumentHint ?? ''} ${prompt.scope ?? ''} ${scopeLabel}`.toLowerCase();
            return haystack.includes(normalizedQuery);
          })
          .map((prompt) => {
            const id = prompt.path || `prompt:${prompt.scope}:${prompt.name}`;
            const usage = getPromptUsageEntry(id);
            return {
              id,
              name: prompt.name,
              content: prompt.content,
              description: prompt.description ?? undefined,
              scopeLabel: prompt.scope === 'global'
                ? t('settings.prompt.scopeGlobal')
                : t('settings.prompt.scopeWorkspace'),
              argumentHint: prompt.argumentHint ?? undefined,
              argumentHintLabel: t('settings.prompt.argumentHintLabel'),
              usageCount: usage.count,
              heatLevel: getPromptHeatLevel(usage.count),
              kind: 'prompt' as const,
              lastUsedAt: usage.lastUsedAt,
            };
          })
          .sort((left, right) => {
            if ((right.usageCount ?? 0) !== (left.usageCount ?? 0)) {
              return (right.usageCount ?? 0) - (left.usageCount ?? 0);
            }
            if ((right.lastUsedAt ?? 0) !== (left.lastUsedAt ?? 0)) {
              return (right.lastUsedAt ?? 0) - (left.lastUsedAt ?? 0);
            }
            return left.name.localeCompare(right.name);
          });

        const createPromptItem: PromptItem = {
          id: CREATE_NEW_PROMPT_ID,
          name: t('settings.prompt.createPrompt'),
          content: '',
          kind: 'create',
        };

        if (filteredPrompts.length === 0) {
          return [
            {
              id: EMPTY_STATE_ID,
              name: t('settings.prompt.noPromptsDropdown'),
              content: '',
            },
            createPromptItem,
          ];
        }

        return [...filteredPrompts, createPromptItem];
      },
      [prompts, t, workspaceId],
    );

    return (
      <ChatInputBox
        ref={chatInputRef}
        isLoading={isProcessing}
        streamActivityPhase={streamActivityPhase}
        disabled={disabled}
        submitDisabled={submitDisabled}
        value={text}
        workspaceId={workspaceId}
        placeholder={placeholder ?? t('chat.inputPlaceholder')}
        sendShortcut={sendShortcut}
        selectedModel={resolvedSelectedModelId}
        models={normalizedModels}
        providerModelCatalogs={normalizedProviderModelCatalogs}
        permissionMode={permissionMode}
        currentProvider={engineToProvider(selectedEngine)}
        currentProviderProfileId={providerProfileId}
        executionTarget={executionTarget}
        onExecutionTargetChange={onExecutionTargetChange}
        providerTargetPickerMode={effectiveProviderTargetPickerMode}
        providerAvailability={providerAvailability}
        providerVersions={providerVersions}
        providerStatusLabels={providerStatusLabels}
        providerDisabledMessages={providerStatusLabels}
        activeFile={activeFile}
        selectedLines={selectedLines}
        onClearContext={onClearContext}
        onSubmit={handleSubmit}
        onStop={onStop}
        onInput={handleInput}
        attachments={pathsToAttachments(attachments)}
        hasContextAttachment={hasContextAttachment}
        onAddAttachment={onAddAttachment ? (_files?: FileList | null) => {
          // In Tauri, we use the native file picker instead of FileList
          onAddAttachment?.();
        } : undefined}
        onRemoveAttachment={handleRemoveAttachment}
        onModeSelect={onModeSelect}
        // Atomic 双栏唯一选择入口：engine/model 改动走 onExecutionTargetChange。
        onModelSelect={undefined}
        onProviderSelect={undefined}
        reasoningEffort={effortToOptionalReasoning(selectedEffort)}
        reasoningOptions={normalizeReasoningOptions(reasoningOptions)}
        onReasoningChange={onSelectEffort ? handleReasoningChange : undefined}
        alwaysThinkingEnabled={resolvedAlwaysThinkingEnabled}
        onToggleThinking={handleThinkingToggle}
        streamingEnabled={resolvedStreamingEnabled}
        onStreamingEnabledChange={handleStreamingToggle}
        selectedAgent={selectedAgent}
        selectedContextChips={selectedContextChips}
        selectedManualMemoryIds={selectedManualMemoryIds}
        selectedNoteCardIds={selectedNoteCardIds}
        onRemoveContextChip={onRemoveContextChip}
        onAgentSelect={onAgentSelect}
        onClearAgent={onAgentSelect ? () => onAgentSelect?.(null) : undefined}
        onOpenAgentSettings={onOpenAgentSettings}
        onOpenPromptSettings={onOpenPromptSettings}
        onOpenModelSettings={onOpenModelSettings}
        onOpenCliSettings={onOpenCliSettings}
        onOpenFileReference={onOpenFileReference}
        onRefreshModelConfig={onRefreshModelConfig}
        isModelConfigRefreshing={isModelConfigRefreshing}
        onForkQuickStart={onForkQuickStart}
        squadSurface={squadSurface}
        hasMessages={hasMessages}
        onRewind={onRewind}
        showRewindEntry={showRewindEntry}
        statusPanelExpanded={statusPanelExpanded}
        showStatusPanelToggle={showStatusPanelToggle}
        onToggleStatusPanel={onToggleStatusPanel}
        completionEmailSelected={completionEmailSelected}
        completionEmailDisabled={completionEmailDisabled}
        onToggleCompletionEmail={onToggleCompletionEmail}
        usagePercentage={usagePercentage}
        usageUsedTokens={contextUsage?.used}
        usageMaxTokens={contextUsage?.total}
        showUsage={true}
        claudeContextUsage={claudeContextUsage}
        accountRateLimits={accountRateLimits}
        usageShowRemaining={usageShowRemaining}
        onRefreshAccountRateLimits={onRefreshAccountRateLimits}
        selectedCollaborationModeId={selectedCollaborationModeId}
        onSelectCollaborationMode={onSelectCollaborationMode}
        codexSpeedMode={codexSpeedMode}
        onCodexSpeedModeChange={handleCodexSpeedModeChange}
        onCodexReviewQuickStart={handleCodexReviewQuickStart}
        memoryReferenceMode={memoryReferenceMode}
        onSetMemoryReferenceMode={onSetMemoryReferenceMode}
        messageQueue={messageQueue}
        sendReadiness={sendReadiness}
        onJumpToRequest={onJumpToRequest}
        onOpenSkillsSettings={onOpenSkillsSettings}
        onRemoveFromQueue={onDeleteQueued}
        onFuseFromQueue={onFuseQueued}
        canFuseFromQueue={canFuseQueuedMessages}
        fuseDisabledReasonKey={fuseDisabledReasonKey}
        fusingQueueMessageId={fusingQueuedMessageId}
        sdkInstalled={true}
        fileCompletionProvider={fileCompletionProvider}
        commandCompletionProvider={commandCompletionProvider}
        skillCompletionProvider={skillCompletionProvider}
        promptCompletionProvider={promptCompletionProvider}
        manualMemoryCompletionProvider={manualMemoryCompletionProvider}
        noteCardCompletionProvider={noteCardCompletionProvider}
        onSelectManualMemory={onManualMemorySelect}
        onSelectNoteCard={onNoteCardSelect}
        onSelectSkill={onSelectSkill}
      />
    );
  }
), areChatInputBoxAdapterPropsEqual);

ChatInputBoxAdapter.displayName = 'ChatInputBoxAdapter';
