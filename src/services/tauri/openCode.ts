import { invoke } from "@tauri-apps/api/core";
import { traceStartupCommand, type StartupWorkspaceScope } from "../../features/startup-orchestration/utils/startupTrace";

function workspaceScope(workspaceId: string): StartupWorkspaceScope {
  return { workspaceId };
}

function traceStartupInvoke<T>(
  commandLabel: string,
  scope: StartupWorkspaceScope,
  run: () => Promise<T>,
) {
  return traceStartupCommand(commandLabel, scope, run);
}

async function withInvokeTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/**
 * Expected OpenCode CLI unavailability for discovery / catalog prewarm.
 * Missing / disabled / unsafe CLI must resolve as empty data — not as a
 * failed startup command ("内部命令失败") in the runtime notice dock.
 * Aligns with catalog projection treating "OpenCode CLI not found" as empty.
 */
export function isOpenCodeCliUnavailableError(error: unknown): boolean {
  const message = String(error);
  return (
    message.includes("OpenCode CLI not found") ||
    message.includes("OpenCode CLI is disabled in CLI validation settings") ||
    message.includes("Engine is disabled in CLI validation settings") ||
    message.includes("[OPENCODE_CLI_UNSAFE]")
  );
}

/** @deprecated Use {@link isOpenCodeCliUnavailableError}. */
export const isOpenCodeSessionListUnavailableError = isOpenCodeCliUnavailableError;

export type GetOpenCodeSessionListOptions = {
  /**
   * When set, the startup trace duration is capped by this budget (timeout
   * returns []). Outer withTimeout without this still lets zombie IPC record
   * full wall-clock in command cost rank.
   */
  timeoutMs?: number;
  /** Preserve timeout as null so callers can distinguish it from an authoritative empty list. */
  timeoutResult?: "empty" | "null";
};

export async function getOpenCodeSessionList(
  workspaceId: string,
  options?: GetOpenCodeSessionListOptions,
) {
  return traceStartupInvoke(
    "opencode_session_list",
    workspaceScope(workspaceId),
    async () => {
      try {
        const invokePromise = invoke<
          Array<{
            sessionId: string;
            title: string;
            updatedLabel: string;
            updatedAt?: number | null;
          }>
        >("opencode_session_list", { workspaceId });
        if (
          typeof options?.timeoutMs === "number" &&
          Number.isFinite(options.timeoutMs) &&
          options.timeoutMs > 0
        ) {
          const budgeted = await withInvokeTimeout(
            invokePromise,
            options.timeoutMs,
          );
          return budgeted ?? (options.timeoutResult === "null" ? null : []);
        }
        return await invokePromise;
      } catch (error) {
        if (isOpenCodeCliUnavailableError(error)) {
          return [];
        }
        throw error;
      }
    },
  );
}

export async function getOpenCodeStats(workspaceId: string, days?: number | null) {
  return invoke<string>("opencode_stats", {
    workspaceId,
    days: days ?? null,
  });
}

export async function exportOpenCodeSession(workspaceId: string, sessionId: string, outputPath?: string | null) {
  return invoke<{ sessionId: string; filePath: string }>("opencode_export_session", {
    workspaceId,
    sessionId,
    outputPath: outputPath ?? null,
  });
}

export async function importOpenCodeSession(workspaceId: string, source: string) {
  return invoke<{ sessionId?: string | null; source: string; output: string }>("opencode_import_session", {
    workspaceId,
    source,
  });
}

export async function shareOpenCodeSession(workspaceId: string, sessionId: string) {
  return invoke<{ sessionId: string; url: string }>("opencode_share_session", {
    workspaceId,
    sessionId,
  });
}

export async function getOpenCodeMcpStatus(workspaceId: string) {
  return invoke<{ text: string }>("opencode_mcp_status", { workspaceId });
}

export async function getOpenCodeProviderHealth(workspaceId: string, provider?: string | null) {
  return invoke<{
    provider: string;
    connected: boolean;
    credentialCount: number;
    matched: boolean;
    authenticatedProviders?: string[];
    error?: string | null;
  }>("opencode_provider_health", {
    workspaceId,
    provider: provider ?? null,
  });
}

export async function getOpenCodeProviderCatalog(workspaceId: string) {
  return invoke<
    Array<{
      id: string;
      label: string;
      description?: string | null;
      category: "popular" | "other";
      recommended: boolean;
    }>
  >("opencode_provider_catalog", { workspaceId });
}

export async function connectOpenCodeProvider(workspaceId: string, providerId?: string | null) {
  return invoke<{
    started: boolean;
    providerId?: string | null;
    command?: string | null;
  }>("opencode_provider_connect", {
    workspaceId,
    providerId: providerId ?? null,
  });
}

export async function getOpenCodeStatusSnapshot(input: { workspaceId: string; threadId?: string | null; model?: string | null; agent?: string | null; variant?: string | null }) {
  return invoke<{
    sessionId?: string | null;
    model?: string | null;
    agent?: string | null;
    variant?: string | null;
    provider?: string | null;
    providerHealth: {
      provider: string;
      connected: boolean;
      credentialCount: number;
      matched: boolean;
      authenticatedProviders?: string[];
      error?: string | null;
    };
    mcpEnabled: boolean;
    mcpServers: Array<{
      name: string;
      enabled: boolean;
      status?: string | null;
      permissionHint?: string | null;
    }>;
    mcpRaw: string;
    managedToggles: boolean;
    tokenUsage?: number | null;
    contextWindow?: number | null;
  }>("opencode_status_snapshot", {
    workspaceId: input.workspaceId,
    threadId: input.threadId ?? null,
    model: input.model ?? null,
    agent: input.agent ?? null,
    variant: input.variant ?? null,
  });
}

export async function setOpenCodeMcpToggle(
  workspaceId: string,
  input: {
    serverName?: string | null;
    enabled?: boolean | null;
    globalEnabled?: boolean | null;
  },
) {
  return invoke<{
    workspaceId: string;
    mcpEnabled: boolean;
    serverStates: Record<string, boolean>;
    managedToggles: boolean;
  }>("opencode_mcp_toggle", {
    workspaceId,
    serverName: input.serverName ?? null,
    enabled: input.enabled ?? null,
    globalEnabled: input.globalEnabled ?? null,
  });
}

export async function getOpenCodeLspDiagnostics(workspaceId: string, filePath: string) {
  return invoke<{ filePath: string; result: unknown }>("opencode_lsp_diagnostics", {
    workspaceId,
    filePath,
  });
}

export async function getOpenCodeLspSymbols(workspaceId: string, query: string) {
  return invoke<{ query: string; result: unknown }>("opencode_lsp_symbols", {
    workspaceId,
    query,
  });
}

export async function getOpenCodeLspDocumentSymbols(workspaceId: string, fileUri: string) {
  return invoke<{ fileUri: string; result: unknown }>("opencode_lsp_document_symbols", {
    workspaceId,
    fileUri,
  });
}

export type CodeNavigationMode = "semantic" | "fast-search";
export type CodeNavigationLifecycle = "starting" | "indexing" | "ready" | "degraded";

export type CodeNavigationFallbackReason =
  | "provider-unavailable"
  | "initialize-timeout"
  | "request-timeout"
  | "provider-exited"
  | "invalid-response"
  | "provider-failed";

export type CodeNavigationResponse = {
  filePath: string;
  line: number;
  character: number;
  language: string | null;
  mode: CodeNavigationMode;
  provider: string;
  lifecycle: CodeNavigationLifecycle;
  fallbackReasonCode: CodeNavigationFallbackReason | null;
  result: unknown;
};

function normalizeCodeNavigationResponse(value: unknown): CodeNavigationResponse {
  const payload = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  const provider = typeof payload.provider === "string" && payload.provider.trim()
    ? payload.provider.trim()
    : "heuristic";
  const mode: CodeNavigationMode = payload.mode === "semantic"
    ? "semantic"
    : "fast-search";
  const knownFallbackReasons = new Set<CodeNavigationFallbackReason>([
    "provider-unavailable",
    "initialize-timeout",
    "request-timeout",
    "provider-exited",
    "invalid-response",
    "provider-failed",
  ]);
  const fallbackReasonCode =
    typeof payload.fallbackReasonCode === "string"
    && knownFallbackReasons.has(payload.fallbackReasonCode as CodeNavigationFallbackReason)
      ? payload.fallbackReasonCode as CodeNavigationFallbackReason
      : null;
  const knownLifecycles = new Set<CodeNavigationLifecycle>([
    "starting",
    "indexing",
    "ready",
    "degraded",
  ]);
  const lifecycle = typeof payload.lifecycle === "string"
    && knownLifecycles.has(payload.lifecycle as CodeNavigationLifecycle)
    ? payload.lifecycle as CodeNavigationLifecycle
    : mode === "semantic"
      ? "ready"
      : "degraded";

  return {
    filePath: typeof payload.filePath === "string" ? payload.filePath : "",
    line: typeof payload.line === "number" && Number.isFinite(payload.line)
      ? payload.line
      : 0,
    character:
      typeof payload.character === "number" && Number.isFinite(payload.character)
        ? payload.character
        : 0,
    language: typeof payload.language === "string" ? payload.language : null,
    mode,
    provider,
    lifecycle,
    fallbackReasonCode,
    result: payload.result,
  };
}

export type CodeNavigationPrepareResponse = Pick<
  CodeNavigationResponse,
  "language" | "provider" | "lifecycle" | "fallbackReasonCode"
>;

export async function prepareCodeIntel(workspaceId: string, filePath: string) {
  const response = await invoke<unknown>("code_intel_prepare", {
    workspaceId,
    filePath,
  });
  const normalized = normalizeCodeNavigationResponse(response);
  return {
    language: normalized.language,
    provider: normalized.provider,
    lifecycle: normalized.lifecycle,
    fallbackReasonCode: normalized.fallbackReasonCode,
  } satisfies CodeNavigationPrepareResponse;
}

export async function getCodeIntelDefinition(
  workspaceId: string,
  input: {
    filePath: string;
    line: number;
    character: number;
    documentText?: string;
  },
) {
  const response = await invoke<unknown>("code_intel_definition", {
    workspaceId,
    filePath: input.filePath,
    line: input.line,
    character: input.character,
    ...(input.documentText === undefined ? {} : { documentText: input.documentText }),
  });
  return normalizeCodeNavigationResponse(response);
}

export async function getCodeIntelReferences(
  workspaceId: string,
  input: {
    filePath: string;
    line: number;
    character: number;
    includeDeclaration?: boolean;
    documentText?: string;
  },
) {
  const response = await invoke<unknown>("code_intel_references", {
    workspaceId,
    filePath: input.filePath,
    line: input.line,
    character: input.character,
    includeDeclaration: input.includeDeclaration ?? false,
    ...(input.documentText === undefined ? {} : { documentText: input.documentText }),
  });
  return normalizeCodeNavigationResponse(response);
}

export async function getCodeIntelImplementations(
  workspaceId: string,
  input: {
    filePath: string;
    line: number;
    character: number;
    documentText?: string;
  },
) {
  const response = await invoke<unknown>("code_intel_implementations", {
    workspaceId,
    filePath: input.filePath,
    line: input.line,
    character: input.character,
    ...(input.documentText === undefined ? {} : { documentText: input.documentText }),
  });
  return normalizeCodeNavigationResponse(response);
}

export type LspPosition = {
  line: number;
  character: number;
};

export type LspRange = {
  start: LspPosition;
  end: LspPosition;
};

export type LspLocation = {
  uri: string;
  range: LspRange;
};

export async function getOpenCodeLspDefinition(
  workspaceId: string,
  input: {
    fileUri: string;
    line: number;
    character: number;
  },
) {
  return invoke<{
    fileUri: string;
    line: number;
    character: number;
    result: unknown;
  }>("opencode_lsp_definition", {
    workspaceId,
    fileUri: input.fileUri,
    line: input.line,
    character: input.character,
  });
}

export async function getOpenCodeLspReferences(
  workspaceId: string,
  input: {
    fileUri: string;
    line: number;
    character: number;
    includeDeclaration?: boolean;
  },
) {
  return invoke<{
    fileUri: string;
    line: number;
    character: number;
    includeDeclaration: boolean;
    result: unknown;
  }>("opencode_lsp_references", {
    workspaceId,
    fileUri: input.fileUri,
    line: input.line,
    character: input.character,
    includeDeclaration: input.includeDeclaration ?? false,
  });
}
