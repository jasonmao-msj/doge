import type { Dispatch, MutableRefObject } from "react";

import type { AutoSessionMetadata } from "../../../services/tauri";
import { pushGlobalRuntimeNotice } from "../../../services/globalRuntimeNotices";
import { previewThreadName } from "../../../utils/threadItems";
import {
  CLAUDE_LOCAL_PROVIDER_PROFILE_ID,
  CODEX_DISK_PROVIDER_PROFILE_ID,
  CODEX_DISK_PROVIDER_PROFILE_NAME,
  GROK_LOCAL_PROVIDER_PROFILE_ID,
  KIMI_LOCAL_PROVIDER_PROFILE_ID,
  OPENCODE_LOCAL_PROVIDER_PROFILE_ID,
  type EngineProviderProfileOption,
} from "../constants/codexProviderProfiles";
import type { ThreadAction, ThreadState } from "./useThreadsReducer";

const HOOK_SAFE_FALLBACK_METADATA_KEYS = [
  "dogeHookSafeFallback",
  "ccguiHookSafeFallback",
] as const;

export type ProviderProfileSelection = {
  providerProfileId?: string | null;
  providerProfileSource?: string | null;
  providerProfileName?: string | null;
  providerAvailability?: string | null;
};

export type SessionLifecycleThreadStarter = {
  dispatch: Dispatch<ThreadAction>;
  loadedThreadsRef: MutableRefObject<Record<string, boolean>>;
  workspaceId: string;
  folderId: string | null;
  shouldActivate: boolean;
  autoSessionPayload?: { autoSession?: AutoSessionMetadata | null };
  selectedProviderBinding: ProviderProfileSelection;
};

export function buildClaudeForkThreadId(parentSessionId: string) {
  return `claude-fork:${parentSessionId}:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function addForkThreadNamePrefix(name: string) {
  const normalized = name.trim();
  if (!normalized) {
    return "fork-Claude Session";
  }
  return normalized.startsWith("fork-") ? normalized : `fork-${normalized}`;
}

export function resolveClaudeForkThreadName({
  workspaceId,
  parentThreadId,
  threadsByWorkspace,
  itemsByThread,
}: {
  workspaceId: string;
  parentThreadId: string;
  threadsByWorkspace: ThreadState["threadsByWorkspace"];
  itemsByThread: ThreadState["itemsByThread"];
}) {
  const parentSummaryName =
    threadsByWorkspace[workspaceId]
      ?.find((thread) => thread.id === parentThreadId)
      ?.name
      .trim() ?? "";
  const parentUserMessage = (itemsByThread[parentThreadId] ?? []).find(
    (item) => item.kind === "message" && item.role === "user",
  );
  const parentMessageName = parentUserMessage
    && parentUserMessage.kind === "message"
    && parentUserMessage.role === "user"
    ? previewThreadName(parentUserMessage.text, "")
    : "";
  return addForkThreadNamePrefix(
    parentSummaryName || parentMessageName || "Claude Session",
  );
}

export function extractThreadId(response: Record<string, unknown> | null | undefined) {
  if (!response || typeof response !== "object") {
    return "";
  }
  const responseRecord = response as Record<string, unknown>;
  const result =
    responseRecord.result && typeof responseRecord.result === "object"
      ? (responseRecord.result as Record<string, unknown>)
      : null;
  const resultThread =
    result?.thread && typeof result.thread === "object"
      ? (result.thread as Record<string, unknown>)
      : null;
  const rootThread =
    responseRecord.thread && typeof responseRecord.thread === "object"
      ? (responseRecord.thread as Record<string, unknown>)
      : null;

  const candidates = [
    resultThread?.id,
    result?.threadId,
    result?.thread_id,
    rootThread?.id,
    responseRecord.threadId,
    responseRecord.thread_id,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" || typeof candidate === "number") {
      const normalized = String(candidate).trim();
      if (normalized) {
        return normalized;
      }
    }
  }
  return "";
}

function normalizeResponseString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function extractStartedThreadRecord(
  response: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!response || typeof response !== "object") {
    return null;
  }
  const result =
    response.result && typeof response.result === "object"
      ? (response.result as Record<string, unknown>)
      : null;
  const resultThread =
    result?.thread && typeof result.thread === "object"
      ? (result.thread as Record<string, unknown>)
      : null;
  const rootThread =
    response.thread && typeof response.thread === "object"
      ? (response.thread as Record<string, unknown>)
      : null;
  return resultThread ?? rootThread;
}

export function extractProviderBindingFromStartedThread(
  response: Record<string, unknown> | null | undefined,
  fallbackProviderBinding: ProviderProfileSelection,
) {
  const thread = extractStartedThreadRecord(response);
  const sourceLabel = normalizeResponseString(thread?.sourceLabel ?? thread?.source_label);
  const providerProfileId =
    normalizeResponseString(
      thread?.providerProfileId ?? thread?.provider_profile_id,
    ) ?? normalizeResponseString(fallbackProviderBinding.providerProfileId);
  const providerProfileSource =
    normalizeResponseString(
      thread?.providerProfileSource ?? thread?.provider_profile_source,
    ) ?? normalizeResponseString(fallbackProviderBinding.providerProfileSource);
  const providerProfileName =
    normalizeResponseString(
      thread?.providerProfileName ?? thread?.provider_profile_name,
    ) ?? normalizeResponseString(fallbackProviderBinding.providerProfileName);
  const providerAvailability = normalizeResponseString(
    thread?.providerAvailability ?? thread?.provider_availability,
  ) ?? normalizeResponseString(fallbackProviderBinding.providerAvailability);
  return {
    ...(sourceLabel ? { sourceLabel } : {}),
    ...(providerProfileId ? { providerProfileId } : {}),
    ...(providerProfileSource ? { providerProfileSource } : {}),
    ...(providerProfileName ? { providerProfileName } : {}),
    ...(providerAvailability ? { providerAvailability } : {}),
  };
}

export function providerBindingFromSelectedProfile(
  providerProfile?: EngineProviderProfileOption | null,
  fallbackProviderProfileId?: string | null,
): ProviderProfileSelection {
  const selectedProfileId = normalizeResponseString(providerProfile?.id);
  const providerProfileId =
    selectedProfileId ?? normalizeResponseString(fallbackProviderProfileId);
  // Local/disk sentinels: no managed L2 override (follow global/disk config).
  // Grok shares Kimi's local id string; keep GROK_LOCAL explicit for readers.
  if (
    providerProfileId === CLAUDE_LOCAL_PROVIDER_PROFILE_ID ||
    providerProfileId === KIMI_LOCAL_PROVIDER_PROFILE_ID ||
    providerProfileId === GROK_LOCAL_PROVIDER_PROFILE_ID ||
    providerProfileId === OPENCODE_LOCAL_PROVIDER_PROFILE_ID
  ) {
    return {};
  }
  const isDiskProvider = providerProfileId === CODEX_DISK_PROVIDER_PROFILE_ID;
  const providerProfileSource = selectedProfileId
    ? normalizeResponseString(providerProfile?.source)
    : isDiskProvider
      ? "disk"
    : null;
  const providerProfileName = selectedProfileId
    ? normalizeResponseString(providerProfile?.name)
    : isDiskProvider
      ? CODEX_DISK_PROVIDER_PROFILE_NAME
    : null;
  return {
    ...(providerProfileId ? { providerProfileId } : {}),
    ...(providerProfileSource ? { providerProfileSource } : {}),
    ...(providerProfileName ? { providerProfileName } : {}),
    ...(selectedProfileId || isDiskProvider ? { providerAvailability: "available" } : {}),
  };
}

export function extractHookSafeFallbackMetadata(
  response: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!response || typeof response !== "object") {
    return null;
  }
  const metadata = HOOK_SAFE_FALLBACK_METADATA_KEYS
    .map((key) => response[key])
    .find((value) => value != null);
  return metadata && typeof metadata === "object"
    ? (metadata as Record<string, unknown>)
    : null;
}

export function pushHookSafeFallbackNotice(
  workspaceId: string,
  metadata: Record<string, unknown>,
) {
  const reason =
    typeof metadata.reason === "string" && metadata.reason.trim()
      ? metadata.reason.trim()
      : "sessionstart_hook_failure";
  const primaryFailureSummary =
    typeof metadata.primaryFailureSummary === "string"
      ? metadata.primaryFailureSummary.trim()
      : "";
  pushGlobalRuntimeNotice({
    severity: "warning",
    category: "runtime",
    messageKey: "runtimeNotice.runtime.codexSessionStartHookSkipped",
    messageParams: {
      reason,
      detail: primaryFailureSummary || null,
    },
    dedupeKey: `codex-sessionstart-hook-safe-fallback:${workspaceId}:${reason}`,
  });
}

export function createSessionLifecycleThreadStarter({
  dispatch,
  loadedThreadsRef,
  workspaceId,
  folderId,
  shouldActivate,
  autoSessionPayload = {},
  selectedProviderBinding,
}: SessionLifecycleThreadStarter) {
  return (response: Record<string, unknown> | null | undefined) => {
    const threadId = extractThreadId(response);
    if (!threadId) {
      return null;
    }
    const fallbackMetadata = extractHookSafeFallbackMetadata(response);
    if (fallbackMetadata) {
      pushHookSafeFallbackNotice(workspaceId, fallbackMetadata);
    }
    dispatch({
      type: "ensureThread",
      workspaceId,
      threadId,
      engine: "codex",
      ...(folderId ? { folderId } : {}),
      ...autoSessionPayload,
      ...extractProviderBindingFromStartedThread(response, selectedProviderBinding),
    });
    dispatch({
      type: "markCodexAcceptedTurn",
      threadId,
      fact: "empty-draft",
      source: "thread-start",
      timestamp: Date.now(),
    });
    if (shouldActivate) {
      dispatch({ type: "setActiveThreadId", workspaceId, threadId });
    }
    loadedThreadsRef.current[threadId] = true;
    return threadId;
  };
}
