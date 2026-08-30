import type { EngineType } from "./engine";

export type AppServerEvent = {
  workspace_id: string;
  message: Record<string, unknown>;
};

export type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

export type ClaudeDeferredImageLocator = {
  sessionId: string;
  lineIndex: number;
  blockIndex: number;
  messageId?: string | null;
  mediaType: string;
};

export type ClaudeDeferredImage = {
  locator: ClaudeDeferredImageLocator;
  mediaType: string;
  estimatedByteSize: number;
  reason: string;
  workspacePath?: string | null;
};

export type ClaudeHydratedImage = {
  locator: ClaudeDeferredImageLocator;
  src: string;
  mediaType: string;
  byteSize: number;
};

export type MemoryPresentationRecord = {
  displayIndex: string;
  index: string;
  memoryId: string;
  source: string;
  title: string;
};

export type MemoryPresentationPack = {
  source: string;
  count: number;
  cleanedContext: string;
  rawPayload: string;
};

export type NoteCardPresentationAttachment = {
  fileName: string;
  absolutePath: string;
};

export type NoteCardPresentationNote = {
  title: string;
  archived: boolean;
  bodyMarkdown: string;
  attachments: NoteCardPresentationAttachment[];
};

export type BrowserPresentationContextView = Pick<
  BrowserContextSendAttachment,
  "title" | "url" | "capturedAt" | "stale" | "summary"
> &
  Partial<
    Omit<
      BrowserContextSendAttachment,
      "kind" | "title" | "url" | "capturedAt" | "stale" | "summary"
    >
  >;

export type ConversationPresentationContext =
  | {
      kind: "browser";
      title: string;
      summary: string;
      evidenceCount: number;
      view: BrowserPresentationContextView;
    }
  | {
      kind: "intent-canvas";
      title: string;
      summary: string;
      view: Omit<IntentCanvasContextSendAttachment, "kind">;
    }
  | {
      kind: "memory";
      preview: string;
      lines: string[];
      markdown?: string;
      rawPayload?: string;
      source?: string;
      records: MemoryPresentationRecord[];
      packs: MemoryPresentationPack[];
    }
  | {
      kind: "note-card";
      title: string;
      summary: string;
      notes: NoteCardPresentationNote[];
      imagePaths: string[];
    };

export type MessagePresentationMetadata = {
  displayText: string;
  stickyCandidateText: string;
  contexts: ConversationPresentationContext[];
};

export type ConversationItem =
  | {
      id: string;
      kind: "message";
      role: "user" | "assistant";
      text: string;
      turnId?: string | null;
      engineSource?: EngineType;
      executionTargetSnapshot?: {
        engine: EngineType;
        providerProfileId?: string | null;
        modelCatalogEntryId?: string | null;
        model?: string | null;
        reasoning?: { effort: string } | null;
        providerProfileNameSnapshot?: string | null;
        providerProfileSource?: string | null;
        runtimeCapabilityFingerprint?: string | null;
        providerAvailable?: boolean;
      };
      isFinal?: boolean;
      finalCompletedAt?: number;
      finalDurationMs?: number;
      /** Whole-turn input-side tokens (non-cache + cache write + cache read). */
      finalInputTokens?: number;
      /** Whole-turn output tokens. */
      finalOutputTokens?: number;
      recoveredFromLiveShadow?: boolean;
      recoveryStatus?: "interrupted" | "recovered";
      recoverySourceId?: string;
      images?: string[];
      deferredImages?: ClaudeDeferredImage[];
      collaborationMode?: "plan" | "code" | null;
      selectedAgentName?: string | null;
      selectedAgentIcon?: string | null;
      browserContextAttachment?: BrowserContextSendAttachment | null;
      intentCanvasContextAttachments?: IntentCanvasContextSendAttachment[];
      presentationMetadata?: MessagePresentationMetadata;
    }
  | {
      id: string;
      kind: "reasoning";
      summary: string;
      content: string;
      engineSource?: EngineType;
    }
  | {
      id: string;
      kind: "diff";
      title: string;
      diff: string;
      status?: string;
      engineSource?: EngineType;
    }
  | {
      id: string;
      kind: "review";
      state: "started" | "completed";
      text: string;
      engineSource?: EngineType;
    }
  | {
      id: string;
      kind: "explore";
      status: "exploring" | "explored";
      engineSource?: EngineType;
      title?: string;
      collapsible?: boolean;
      mergeKey?: string;
      entries: {
        kind: "read" | "search" | "list" | "run";
        label: string;
        detail?: string;
      }[];
    }
  | {
      id: string;
      kind: "generatedImage";
      engineSource?: EngineType;
      status: "processing" | "completed" | "degraded";
      sourceToolName?: string;
      promptText?: string;
      fallbackText?: string;
      anchorUserMessageId?: string;
      images: {
        src: string;
        localPath?: string | null;
      }[];
    }
  | {
      id: string;
      kind: "tool";
      toolType: string;
      engineSource?: EngineType;
      turnId?: string;
      title: string;
      detail: string;
      status?: string;
      output?: string;
      durationMs?: number | null;
      changes?: { path: string; kind?: string; diff?: string }[];
      senderThreadId?: string;
      receiverThreadIds?: string[];
      agentStatus?: Record<string, { status?: string } | string>;
    };

export type AutoSessionVisibility = "hidden" | "system-auto" | "user-visible";

export type AutoSessionCreatedBy = "system" | "user";

export type AutoSessionMetadata = {
  sessionPurpose: string;
  visibility: AutoSessionVisibility;
  ownerFeature: string;
  autoArchive?: boolean | null;
  createdBy: AutoSessionCreatedBy;
};

export type ThreadSummary = {
  id: string;
  name: string;
  updatedAt: number;
  archivedAt?: number;
  threadKind?: "native" | "shared";
  sizeBytes?: number;
  /** 会话 transcript / history 在磁盘上的物理路径（catalog 有则填充）。 */
  physicalPath?: string;
  engineSource?: "codex" | "claude" | "gemini" | "grok" | "kimi" | "opencode";
  selectedEngine?: "codex" | "claude" | "gemini" | "grok" | "kimi" | "opencode";
  source?: string;
  provider?: string;
  sourceLabel?: string;
  providerProfileId?: string;
  providerProfileSource?: "disk" | "managed" | string;
  providerProfileName?: string;
  providerAvailability?: "available" | "unavailable" | string;
  /** Durable execution target hydrated from the native session catalog. */
  modelCatalogEntryId?: string;
  model?: string;
  reasoningEffort?: string;
  partialSource?: string;
  isDegraded?: boolean;
  degradedReason?: string;
  folderId?: string | null;
  autoSession?: AutoSessionMetadata | null;
  nativeThreadIds?: string[];
  parentThreadId?: string | null;
  originKind?: "provider-continuation" | string;
  sourceSessionId?: string;
  sourceProviderProfileId?: string;
  familyId?: string;
  familyRootSessionId?: string;
  lineageParentSessionId?: string;
  lineageKind?: "provider-continuation" | string;
  lineageDepth?: number;
};

export type ReviewTarget =
  | { type: "uncommittedChanges" }
  | { type: "baseBranch"; branch: string }
  | { type: "commit"; sha: string; title?: string }
  | { type: "custom"; instructions: string };

export type AccessMode = "default" | "read-only" | "current" | "full-access";

/**
 * Durable "last used" composer preferences, remembered per engine so a brand-new
 * conversation reopens with the same model / reasoning effort / permission / plan
 * mode the user last chose (survives app restart via AppSettings persistence).
 */
export type ComposerEnginePrefs = {
  modelId: string | null;
  effort: string | null;
  accessMode: AccessMode | null;
  collaborationModeId: string | null;
};

/**
 * Shared follow-up 入队时冻结的可执行目标。
 *
 * 该结构刻意放在通用 conversation contract 中，避免 queue 层反向依赖
 * shared-session feature；字段与 ResolvedExecutionTarget 保持结构兼容。
 */
export type SharedQueuedExecutionTarget = {
  engine: EngineType;
  providerProfileId: string | null;
  modelCatalogEntryId: string;
  model: string;
  reasoning: { effort: string } | null;
  providerProfileNameSnapshot: string;
  providerProfileSource: "disk" | "managed";
};

export type QueuedMessage = {
  id: string;
  text: string;
  createdAt: number;
  images?: string[];
  sendOptions?: MessageSendOptions;
  /** Queue 专用：enqueue 瞬间冻结的引擎，drain 时禁止重读 activeEngine。 */
  engine?: EngineType;
  sharedExecutionTarget?: SharedQueuedExecutionTarget;
  sharedPredecessorAttemptId?: string | null;
  /** 已开始 Shared V2 handoff、但尚未拿到 canonical commit ACK。 */
  sharedDispatchState?: "pending-ack";
};

export type IntentCanvasContextCount = {
  total: number;
  sent: number;
  omitted: number;
};

export type IntentCanvasContextSendAttachment = {
  kind: "intent_canvas_context";
  attachmentId: string;
  canvasId: string;
  title: string;
  mode: string;
  compressionMode: string;
  truncated: boolean;
  payloadCharacters: number;
  rawPayload: string;
  semanticNodes: IntentCanvasContextCount;
  semanticEdges: IntentCanvasContextCount;
  evidence: IntentCanvasContextCount;
  visualTextBlocks: IntentCanvasContextCount;
};

export type MemoryContextInjectionMode = "summary" | "detail";

export type BrowserContextSendAttachment = {
  kind: "browser_snapshot";
  attachmentId: string;
  browserSessionId: string;
  snapshotId: string;
  workspaceId: string;
  title: string | null;
  url: string;
  capturedAt: number;
  stale: boolean;
  freshness?: "fresh" | "stale" | "expired" | "degraded";
  summary: string;
  visibleTextExcerpt?: string;
  pageType?: "article" | "issue" | "docs" | "form" | "dashboard" | "spa" | "unknown";
  primaryContent?: string;
  readableBlocks?: Array<{
    blockId: string;
    role:
      | "article"
      | "issue_body"
      | "docs_section"
      | "form"
      | "dashboard_panel"
      | "paragraph"
      | "code"
      | "other";
    text: string;
    score: number;
    truncated: boolean;
  }>;
  noiseDiagnostics?: Array<{
    diagnosticId: string;
    kind:
      | "navigation_noise"
      | "link_dense_region"
      | "control_dense_region"
      | "auth_wall"
      | "spa_shell"
      | "low_readability";
    severity: "info" | "warning";
    message: string;
    score: number;
  }>;
  visualEvidence?: Array<{
    evidenceId: string;
    kind: "image" | "figure" | "attachment" | "video";
    label: string;
    altText?: string | null;
    srcOrigin?: string | null;
    nearbyText?: string | null;
    visible: boolean;
    sensitive: boolean;
  }>;
  screenshotRefs?: Array<{
    refId: string;
    browserSessionId: string;
    snapshotId: string;
    capturedAt: number;
    kind: "thumbnail_reference";
    storage: "metadata_only" | "ephemeral_ref";
    modelPayloadAllowed: boolean;
  }>;
  ocrTextSupplements?: Array<{
    refId: string;
    screenshotRefId: string;
    text: string;
    capturedAt: number;
    charBudget: number;
    truncated: boolean;
    redactedKinds: string[];
    modelPayloadAllowed: boolean;
  }>;
  elementCounts?: {
    headings: number;
    links: number;
    buttons: number;
    forms: number;
    landmarks: number;
    codeCandidates: number;
    readableBlocks?: number;
    visualEvidence?: number;
    annotations?: number;
  };
  diagnostics?: Array<{
    diagnosticId: string;
    kind: string;
    severity: "info" | "warning" | "error";
    message: string;
    source?: string | null;
    redacted: boolean;
  }>;
  budget?: {
    charLimit: number;
    visibleTextLimit: number;
    elementLimit: number;
    formFieldLimit: number;
    diagnosticLimit: number;
    tokenEstimate?: number | null;
    truncated?: boolean;
    omittedElementCount?: number;
  };
  codeCandidates?: Array<{
    candidateId: string;
    filePath: string;
    symbolName?: string | null;
    reason:
      | "route_match"
      | "file_name_match"
      | "visible_text_match"
      | "heading_match"
      | "button_label_match"
      | "form_label_match"
      | "aria_label_match"
      | "test_id_match"
      | "component_symbol_match"
      | "manual_hint";
    confidence: "high" | "medium" | "low";
    matchedText?: string | null;
    sourceEvidence?: string[];
    explanation?: string;
    openAction?: {
      kind: "open_file";
      filePath: string;
    } | null;
  }>;
  privacy: {
    redactionApplied: boolean;
    redactedKinds: string[];
    omittedKinds: string[];
  };
};

export type SkillInvocation = {
  /** 归一化后的 skill/common 名（无 `/` 前缀，空白转 `-`）。 */
  name: string;
  /** SKILL.md 或 skill 目录绝对路径；协作首段用于正文注入。 */
  path?: string;
  /** 预留的结构化参数通道；当前恒为空，引擎侧解析属后续协议演进。 */
  args?: Record<string, string>;
};

/**
 * New Home 创建会话时冻结的一次性目标。
 *
 * 创建完成后必须消费；后续 Turn 继续以 thread binding 与 thread-scoped
 * Composer selection 为准。
 */
export type ComposerCreateSessionTarget = {
  engine: EngineType;
  providerProfileId: string | null;
  providerProfileName: string | null;
  providerProfileSource: "disk" | "managed";
  modelCatalogEntryId: string;
  model: string;
  effort: string | null;
};

export type MessageSendOptions = {
  skillInvocations?: SkillInvocation[];
  selectedMemoryIds?: string[];
  selectedMemoryInjectionMode?: MemoryContextInjectionMode;
  memoryReferenceEnabled?: boolean;
  selectedNoteCardIds?: string[];
  selectedAgent?: SelectedAgentOption | null;
  model?: string | null;
  effort?: string | null;
  collaborationMode?: Record<string, unknown> | null;
  accessMode?: AccessMode;
  resumeSource?: "queue-fusion-cutover" | null;
  resumeTurnId?: string | null;
  skipOptimisticUserBubble?: boolean;
  suppressUserMessageRender?: boolean;
  autoSession?: AutoSessionMetadata | null;
  browserContextAttachment?: BrowserContextSendAttachment | null;
  intentCanvasContextAttachments?: IntentCanvasContextSendAttachment[];
  createSessionTarget?: ComposerCreateSessionTarget;
  /** Queue/Fusion 专用：发送边界必须优先使用该冻结目标，禁止重读 Picker。 */
  sharedExecutionTarget?: SharedQueuedExecutionTarget;
  /** Queue drain 专用：发送边界必须优先使用该冻结引擎，禁止重读 activeEngine。 */
  engineOverride?: EngineType;
  /** Shared Session one-shot Multi-Agent request；target 仍由 sharedExecutionTarget 冻结。 */
  squadRequest?: true;
};

export type SelectedAgentOption = {
  id: string;
  name: string;
  prompt?: string | null;
  icon?: string | null;
  source?: "custom" | "builtIn";
  divisionId?: string | null;
  divisionLabel?: string | null;
  sourceRevision?: string | null;
  promptHash?: string | null;
};
