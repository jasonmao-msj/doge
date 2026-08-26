// ==================== Engine Types ====================

/**
 * Supported AI coding CLI engine types
 */
export type EngineType = "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode";

/** Options for coordinating the selected engine with the native runtime. */
export type SetActiveEngineOptions = {
  ensureRuntime?: boolean;
  /** Managed product provider that must activate its verified native toolchain first. */
  providerProfileId?: string | null;
};

export type SetActiveEngine = (
  engine: EngineType,
  options?: SetActiveEngineOptions,
) => Promise<boolean> | void;

/**
 * Feature capabilities for each engine
 */
export type EngineFeatures = {
  streaming: boolean;
  imageInput: boolean;
  reasoningEffort?: boolean;
  collaborationMode?: boolean;
  sessionResume?: boolean;
  toolsControl?: boolean;
  mcp?: boolean;
  /** @deprecated 兼容旧缓存与测试 fixture；runtime DTO 使用 reasoningEffort。 */
  reasoning?: boolean;
  /** @deprecated 兼容旧缓存与测试 fixture；runtime DTO 使用 toolsControl。 */
  toolUse?: boolean;
  /** @deprecated 兼容旧缓存与测试 fixture；runtime DTO 使用 sessionResume。 */
  sessionContinuation?: boolean;
};

/**
 * Model information for an engine
 */
export type EngineModelInfo = {
  id: string;
  model?: string;
  displayName: string;
  description: string;
  source?: string;
  provider?: string | null;
  protocol?: string | null;
  provenance?: string | null;
  observedAt?: number | null;
  lastVerifiedAt?: string | null;
  lifecycle?: string | null;
  providerProfileId?: string | null;
  isDefault: boolean;
};

/**
 * Engine installation and availability status
 */
export type EngineStatus = {
  engineType: EngineType;
  installed: boolean;
  version: string | null;
  binPath: string | null;
  features: EngineFeatures;
  models: EngineModelInfo[];
  error: string | null;
};

/**
 * Engine configuration options
 */
export type EngineConfig = {
  binPath: string | null;
  homeDir: string | null;
  customArgs: string | null;
};

/**
 * Parameters for sending a message to an engine
 */
export type EngineSendMessageParams = {
  text: string;
  model: string | null;
  images: string[] | null;
  continueSession: boolean;
  sessionId: string | null;
  forkSessionId?: string | null;
  accessMode: string | null;
  agent?: string | null;
  variant?: string | null;
};

/**
 * Unified engine event types for streaming
 */
export type EngineEvent =
  | {
      type: "sessionStarted";
      workspaceId: string;
      sessionId: string;
      engine: EngineType;
    }
  | {
      type: "turnStarted";
      workspaceId: string;
      turnId: string;
    }
  | {
      type: "textDelta";
      workspaceId: string;
      text: string;
    }
  | {
      type: "reasoningDelta";
      workspaceId: string;
      text: string;
    }
  | {
      type: "toolStarted";
      workspaceId: string;
      toolId: string;
      toolName: string;
      input: unknown;
    }
  | {
      type: "toolCompleted";
      workspaceId: string;
      toolId: string;
      output: unknown;
      error: string | null;
    }
  | {
      type: "approvalRequest";
      workspaceId: string;
      requestId: unknown;
      toolName: string;
      input: unknown;
      message: string | null;
    }
  | {
      type: "turnCompleted";
      workspaceId: string;
      result: unknown;
    }
  | {
      type: "turnError";
      workspaceId: string;
      error: string;
      code: string | null;
    }
  | {
      type: "sessionEnded";
      workspaceId: string;
      sessionId: string;
    }
  | {
      type: "usageUpdate";
      workspaceId: string;
      inputTokens: number | null;
      outputTokens: number | null;
      cachedTokens: number | null;
    }
  | {
      type: "raw";
      workspaceId: string;
      engine: EngineType;
      data: unknown;
    };
