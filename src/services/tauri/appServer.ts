import { invoke } from "@tauri-apps/api/core";
import type { EngineModelInfo, EngineStatus, EngineType, SkillInvocation } from "../../types";
import type { AutoSessionMetadata } from "./sessionManagement";
import {
  isEngineRpcFallbackMode,
  isUnknownMethodError,
  markDaemonEngineRpcSupported,
  shouldUseWebServiceFallback,
  WEB_SERVICE_CLI_ENGINE_MESSAGE,
  webServiceCodexOnlyStatuses,
} from "./runtimeMode";
import { traceStartupCommand } from "../../features/startup-orchestration/utils/startupTrace";
import { assertEngineExecutionEnabled } from "../../utils/engineExecutionPolicy";

function traceStartupInvoke<T>(
  commandLabel: string,
  scope: { workspaceId: string } | "global",
  run: () => Promise<T>,
) {
  return traceStartupCommand(commandLabel, scope, run);
}

export type WebServerStatus = {
  running: boolean;
  rpcEndpoint: string;
  webPort: number;
  addresses: string[];
  webAccessToken: string | null;
  lastError?: string | null;
};

export type DaemonStatus = {
  running: boolean;
  host: string;
  lastError?: string | null;
};

export type WebAssetsStatus = {
  state: "missing" | "ready" | "failed";
  installedVersion: string | null;
  requiredVersion: string;
  lastError: string | null;
  installationRequired: boolean;
};

export async function startWebServer(options: { port?: number | null; token?: string | null }): Promise<WebServerStatus> {
  return invoke<WebServerStatus>("start_web_server", {
    port: options.port ?? null,
    token: options.token ?? null,
  });
}

export async function stopWebServer(): Promise<WebServerStatus> {
  return invoke<WebServerStatus>("stop_web_server");
}

export async function getWebServerStatus(): Promise<WebServerStatus> {
  return invoke<WebServerStatus>("get_web_server_status");
}

export async function getDaemonStatus(): Promise<DaemonStatus> {
  return invoke<DaemonStatus>("get_daemon_status");
}

export async function startDaemon(): Promise<DaemonStatus> {
  return invoke<DaemonStatus>("start_daemon");
}

export async function stopDaemon(): Promise<DaemonStatus> {
  return invoke<DaemonStatus>("stop_daemon");
}

export async function getWebAssetsStatus(): Promise<WebAssetsStatus> {
  return invoke<WebAssetsStatus>("get_web_assets_status");
}

export async function installWebAssets(): Promise<WebAssetsStatus> {
  return invoke<WebAssetsStatus>("install_web_assets");
}

export async function installWebAssetsFromFile(
  archivePath: string,
): Promise<WebAssetsStatus> {
  return invoke<WebAssetsStatus>("install_web_assets_from_file", { archivePath });
}

// ==================== Engine API ====================

/**
 * Detect all installed engines and their status
 */
export async function detectEngines(): Promise<EngineStatus[]> {
  try {
    const statuses = await invoke<EngineStatus[]>("detect_engines");
    markDaemonEngineRpcSupported(true);
    return statuses;
  } catch (error) {
    if (isUnknownMethodError(error, "detect_engines")) {
      if (!shouldUseWebServiceFallback()) {
        throw error;
      }
      markDaemonEngineRpcSupported(false);
      return webServiceCodexOnlyStatuses();
    }
    throw error;
  }
}

/**
 * Get the currently active engine type
 */
export async function getActiveEngine(): Promise<EngineType> {
  try {
    const engine = await invoke<EngineType>("get_active_engine");
    markDaemonEngineRpcSupported(true);
    return engine;
  } catch (error) {
    if (isUnknownMethodError(error, "get_active_engine")) {
      if (!shouldUseWebServiceFallback()) {
        throw error;
      }
      markDaemonEngineRpcSupported(false);
      return "codex";
    }
    throw error;
  }
}

/**
 * Switch to a different engine
 */
export async function switchEngine(engineType: EngineType): Promise<void> {
  assertEngineExecutionEnabled(engineType);
  if (isEngineRpcFallbackMode() && engineType !== "codex") {
    throw new Error(WEB_SERVICE_CLI_ENGINE_MESSAGE);
  }
  try {
    await invoke("switch_engine", { engineType });
    markDaemonEngineRpcSupported(true);
    return;
  } catch (error) {
    if (isUnknownMethodError(error, "switch_engine")) {
      if (!shouldUseWebServiceFallback()) {
        throw error;
      }
      markDaemonEngineRpcSupported(false);
      if (engineType === "codex") {
        return;
      }
      throw new Error(WEB_SERVICE_CLI_ENGINE_MESSAGE);
    }
    throw error;
  }
}

/**
 * Get status of a specific engine
 */
export async function getEngineStatus(engineType: EngineType): Promise<EngineStatus | null> {
  try {
    const status = await invoke<EngineStatus | null>("get_engine_status", {
      engineType,
    });
    markDaemonEngineRpcSupported(true);
    return status;
  } catch (error) {
    if (isUnknownMethodError(error, "get_engine_status")) {
      if (!shouldUseWebServiceFallback()) {
        throw error;
      }
      markDaemonEngineRpcSupported(false);
      return webServiceCodexOnlyStatuses().find((entry) => entry.engineType === engineType) ?? null;
    }
    throw error;
  }
}

export type EngineWorkspaceActiveProcessDiagnostics = {
  workspaceId: string;
  engine: EngineType;
  activeProcessIds: number[];
  registeredActiveProcesses: Array<{
    pid: number;
    registeredAgeMs: number;
  }>;
};

export type EngineOsChildLivenessEvidence = {
  evidenceClass: "measured" | "proxy" | "manual-only" | "unsupported";
  sampledAfterCloseMs: number;
  sampledOsChildCount: number | null;
  sampler: string | null;
  rationale: string | null;
};

export type EngineStaleChildCandidate = {
  workspaceId: string;
  engine: "claude" | "opencode" | "gemini" | "codex" | string;
  pid: number;
  registeredAgeMs: number;
  staleReason: string;
  progressEvidence: string;
};

export type EngineActiveProcessDiagnostics = {
  measured: boolean;
  sampledAtMs: number;
  totalActiveProcessCount: number;
  workspaces: EngineWorkspaceActiveProcessDiagnostics[];
  unsupportedReason: string | null;
  /**
   * OS-level child process liveness evidence. Kept structurally separate from
   * `totalActiveProcessCount`: a zero registry count only proves no handles
   * remain registered, NOT that the OS has reaped every child process.
   */
  osChildLiveness: EngineOsChildLivenessEvidence;
  /**
   * Diagnostics-only stale child candidates. Never auto-killed in this change.
   * Engines without structured IO/progress metadata report
   * `progressEvidence="unsupported"`.
   */
  staleChildCandidates: EngineStaleChildCandidate[];
};

export async function getEngineActiveProcessDiagnostics(): Promise<EngineActiveProcessDiagnostics> {
  return invoke<EngineActiveProcessDiagnostics>(
    "get_engine_active_process_diagnostics",
  );
}

/**
 * Get available models for a specific engine
 */
export async function getEngineModels(
  engineType: EngineType,
  options: { forceRefresh?: boolean; providerProfileId?: string | null } = {},
): Promise<EngineModelInfo[]> {
  assertEngineExecutionEnabled(engineType);
  if (isEngineRpcFallbackMode() && engineType !== "codex") {
    return [];
  }
  try {
    const params: {
      engineType: EngineType;
      forceRefresh?: boolean;
      providerProfileId?: string;
    } = {
      engineType,
    };
    const providerProfileId = options.providerProfileId?.trim();
    if (providerProfileId) {
      params.providerProfileId = providerProfileId;
    }
    if (options.forceRefresh) {
      params.forceRefresh = true;
    }
    const models = await traceStartupInvoke("get_engine_models", "global", () =>
      invoke<EngineModelInfo[]>("get_engine_models", params),
    );
    markDaemonEngineRpcSupported(true);
    return models;
  } catch (error) {
    if (isUnknownMethodError(error, "get_engine_models")) {
      if (!shouldUseWebServiceFallback()) {
        throw error;
      }
      markDaemonEngineRpcSupported(false);
      return [];
    }
    throw error;
  }
}

/**
 * Send a message using an engine
 */
export async function engineSendMessage(
  workspaceId: string,
  params: {
    text: string;
    engine?: EngineType | null;
    model?: string | null;
    modelCatalogEntryId?: string | null;
    effort?: string | null;
    disableThinking?: boolean | null;
    images?: string[] | null;
    continueSession?: boolean;
    sessionId?: string | null;
    forkSessionId?: string | null;
    accessMode?: string | null;
    threadId?: string | null;
    agent?: string | null;
    variant?: string | null;
    providerProfileId?: string | null;
    customSpecRoot?: string | null;
    autoSession?: AutoSessionMetadata | null;
    skillInvocations?: SkillInvocation[] | null;
  },
): Promise<Record<string, unknown>> {
  if (params.engine) {
    assertEngineExecutionEnabled(params.engine);
  }
  if (isEngineRpcFallbackMode() && params.engine && params.engine !== "codex") {
    return {
      error: {
        message: WEB_SERVICE_CLI_ENGINE_MESSAGE,
      },
    };
  }
  try {
    return await invoke<Record<string, unknown>>("engine_send_message", {
      workspaceId,
      text: params.text,
      engine: params.engine ?? null,
      model: params.model ?? null,
      modelCatalogEntryId: params.modelCatalogEntryId ?? null,
      effort: params.effort ?? null,
      disableThinking: params.disableThinking ?? false,
      images: params.images ?? null,
      continueSession: params.continueSession ?? false,
      accessMode: params.accessMode ?? null,
      threadId: params.threadId ?? null,
      sessionId: params.sessionId ?? null,
      forkSessionId: params.forkSessionId ?? null,
      agent: params.agent ?? null,
      variant: params.variant ?? null,
      providerProfileId: params.providerProfileId ?? null,
      customSpecRoot: params.customSpecRoot ?? null,
      autoSession: params.autoSession ?? null,
      skillInvocations: params.skillInvocations ?? null,
    });
  } catch (error) {
    if (isUnknownMethodError(error, "engine_send_message")) {
      if (!shouldUseWebServiceFallback()) {
        throw error;
      }
      markDaemonEngineRpcSupported(false);
      return {
        error: {
          message: WEB_SERVICE_CLI_ENGINE_MESSAGE,
        },
      };
    }
    throw error;
  }
}

/**
 * Send a message using an engine and wait for a final plain-text response.
 */
export async function engineSendMessageSync(
  workspaceId: string,
  params: {
    text: string;
    engine?: EngineType | null;
    model?: string | null;
    effort?: string | null;
    disableThinking?: boolean | null;
    images?: string[] | null;
    continueSession?: boolean;
    sessionId?: string | null;
    forkSessionId?: string | null;
    accessMode?: string | null;
    agent?: string | null;
    variant?: string | null;
    customSpecRoot?: string | null;
    autoSession?: AutoSessionMetadata | null;
  },
): Promise<{ engine: EngineType; text: string }> {
  if (params.engine) {
    assertEngineExecutionEnabled(params.engine);
  }
  if (isEngineRpcFallbackMode() && params.engine && params.engine !== "codex") {
    throw new Error(WEB_SERVICE_CLI_ENGINE_MESSAGE);
  }
  try {
    return await invoke<{ engine: EngineType; text: string }>("engine_send_message_sync", {
      workspaceId,
      text: params.text,
      engine: params.engine ?? null,
      model: params.model ?? null,
      effort: params.effort ?? null,
      disableThinking: params.disableThinking ?? false,
      images: params.images ?? null,
      continueSession: params.continueSession ?? false,
      accessMode: params.accessMode ?? null,
      sessionId: params.sessionId ?? null,
      forkSessionId: params.forkSessionId ?? null,
      agent: params.agent ?? null,
      variant: params.variant ?? null,
      customSpecRoot: params.customSpecRoot ?? null,
      autoSession: params.autoSession ?? null,
    });
  } catch (error) {
    if (isUnknownMethodError(error, "engine_send_message_sync")) {
      if (!shouldUseWebServiceFallback()) {
        throw error;
      }
      markDaemonEngineRpcSupported(false);
      throw new Error(WEB_SERVICE_CLI_ENGINE_MESSAGE);
    }
    throw error;
  }
}

/**
 * Interrupt the current engine operation
 */
export async function engineInterrupt(workspaceId: string): Promise<void> {
  return invoke("engine_interrupt", { workspaceId });
}
