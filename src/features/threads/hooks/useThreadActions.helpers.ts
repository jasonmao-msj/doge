import type { ConversationItem, ThreadSummary } from "../../../types";
import { previewThreadName } from "../../../utils/threadItems";
import { getCollabWorkerNativeHideIds } from "../../multi-agent/runtime/collabNativeHideRegistry";
import { asNumber, asString } from "../utils/threadNormalize";
import { hasCodexBackgroundHelperPreview } from "../utils/codexBackgroundHelpers";
import {
  isWeakSessionDisplayTitle,
  mergeSessionDisplaySummary,
  normalizeSessionDisplayTitle,
  projectSessionDisplaySummaries,
  selectProjectedSessionDisplayName,
  type SessionDisplayTitleSources,
} from "../utils/sessionDisplayProjection";
import { matchesWorkspacePath } from "./useThreadActions.workspacePath";
import {
  classifyContextProtocolText,
  isDogeProgramControlTitle,
} from "../../../utils/contextProtocol";

const CLAUDE_HISTORY_MESSAGE_ID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type MessageConversationItem = Extract<ConversationItem, { kind: "message" }>;
type UserConversationMessage = MessageConversationItem & { role: "user" };
type RewindSupportedEngine = "claude" | "codex";

export type ThreadRecoveryStrategy =
  | "replacement"
  | "new-discovery"
  | "history-match"
  | "fresh-continuation";

export type ThreadRecoveryReasonCode =
  | "matched"
  | "ambiguous"
  | "no-candidate"
  | "low-confidence"
  | "verified"
  | "fresh-only";

export type ThreadRecoveryDecision = {
  oldThreadId: string;
  candidateThreadId: string | null;
  strategy: ThreadRecoveryStrategy;
  confidence: number;
  scoreGap: number;
  featureSignals: string[];
  reasonCode: ThreadRecoveryReasonCode;
  isPersistent: boolean;
  summary?: ThreadSummary;
};

const THREAD_RECOVERY_ALIAS_PERSISTENCE_THRESHOLD = 0.8;
const THREAD_RECOVERY_REPLACEMENT_GAP_THRESHOLD = 50;
const THREAD_RECOVERY_TIME_WINDOW_MS = 24 * 60 * 60 * 1000;

export type GeminiSessionSummary = {
  sessionId: string;
  firstMessage: string;
  updatedAt: number;
  fileSizeBytes?: number;
};

// Kimi session summaries share the Gemini summary shape (id/message/updatedAt/size).
export type KimiSessionSummary = GeminiSessionSummary;

// Grok：在 Gemini 形状上扩展 parent / sessionKind（子代理树）
export type GrokSessionSummary = GeminiSessionSummary & {
  parentSessionId?: string | null;
  sessionKind?: string | null;
};

export type CodexCatalogSessionSummary = {
  sessionId: string;
  workspaceId?: string | null;
  title: string;
  nativeTitle?: string | null;
  updatedAt: number;
  archivedAt?: number | null;
  sizeBytes?: number;
  physicalPath?: string | null;
  parentSessionId?: string | null;
  engine?: ThreadSummary["engineSource"] | string | null;
  source?: string | null;
  provider?: string | null;
  sourceLabel?: string | null;
  providerProfileId?: string | null;
  providerProfileSource?: string | null;
  providerProfileName?: string | null;
  providerAvailability?: string | null;
  folderId?: string | null;
  autoSession?: ThreadSummary["autoSession"];
  originKind?: string | null;
  sourceSessionId?: string | null;
  sourceProviderProfileId?: string | null;
  familyId?: string | null;
  familyRootSessionId?: string | null;
  lineageParentSessionId?: string | null;
  lineageKind?: string | null;
  lineageDepth?: number | null;
};

/**
 * Expand catalog/native session id aliases so hidden automatic helpers can be
 * matched across `engine:id`, `engine:workspace:id`, and raw id forms.
 */
export function buildHiddenAutomaticSessionIdSet(
  ids: readonly string[] | null | undefined,
): Set<string> {
  const set = new Set<string>();
  if (!ids || ids.length === 0) {
    return set;
  }
  for (const rawId of ids) {
    const trimmed = String(rawId ?? "").trim();
    if (!trimmed) {
      continue;
    }
    set.add(trimmed);
    const parts = trimmed.split(":").filter(Boolean);
    if (parts.length === 0) {
      continue;
    }
    const last = parts[parts.length - 1];
    if (last) {
      set.add(last);
    }
    if (parts.length >= 2) {
      const engine = parts[0];
      if (engine && last) {
        set.add(`${engine}:${last}`);
      }
    }
  }
  return set;
}

export function threadIdMatchesHiddenAutomaticSessionSet(
  threadId: string,
  hiddenIds: ReadonlySet<string>,
): boolean {
  const trimmed = threadId.trim();
  if (!trimmed || hiddenIds.size === 0) {
    return false;
  }
  if (hiddenIds.has(trimmed)) {
    return true;
  }
  const parts = trimmed.split(":").filter(Boolean);
  if (parts.length === 0) {
    return false;
  }
  const last = parts[parts.length - 1];
  if (last && hiddenIds.has(last)) {
    return true;
  }
  if (parts.length >= 2) {
    const engine = parts[0];
    if (engine && last && hiddenIds.has(`${engine}:${last}`)) {
      return true;
    }
  }
  return false;
}

export function filterHiddenAutomaticThreadSummaries<
  T extends { id: string; autoSession?: ThreadSummary["autoSession"] },
>(
  summaries: readonly T[],
  hiddenIds: ReadonlySet<string>,
): T[] {
  if (summaries.length === 0) {
    return [];
  }
  if (hiddenIds.size === 0) {
    return summaries.filter(
      (summary) => summary.autoSession?.visibility !== "hidden",
    );
  }
  return summaries.filter((summary) => {
    if (summary.autoSession?.visibility === "hidden") {
      return false;
    }
    return !threadIdMatchesHiddenAutomaticSessionSet(summary.id, hiddenIds);
  });
}

export function normalizeThreadListPartialSource(
  value: unknown,
): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function hasHealthyThreadSummaries(
  threads: ThreadSummary[] | undefined,
): threads is ThreadSummary[] {
  return (
    Array.isArray(threads) &&
    threads.length > 0 &&
    !threads.some(
      (thread) =>
        thread.isDegraded || thread.partialSource || thread.degradedReason,
    )
  );
}

export function markThreadSummariesDegraded(
  threads: ThreadSummary[],
  partialSource: string,
  degradedReason: string,
): ThreadSummary[] {
  return threads.map((thread) => ({
    ...thread,
    isDegraded: true,
    partialSource,
    degradedReason,
  }));
}

export function isWorkspaceNotConnectedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("workspace not connected");
}

function normalizeThreadResumeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .trim()
    .toLowerCase();
}

export function isThreadResumeNotFoundError(error: unknown): boolean {
  const message = normalizeThreadResumeErrorMessage(error);
  return (
    message.includes("thread not found") ||
    message.includes("[session_not_found]") ||
    message.includes("session not found") ||
    message.includes("session file not found")
  );
}

export function inferThreadEngineSource(
  threadId: string,
  summary?: ThreadSummary,
): ThreadSummary["engineSource"] {
  if (summary?.engineSource) {
    return summary.engineSource;
  }
  const normalized = threadId.trim().toLowerCase();
  if (
    normalized.startsWith("claude:") ||
    normalized.startsWith("claude-pending-")
  ) {
    return "claude";
  }
  if (
    normalized.startsWith("gemini:") ||
    normalized.startsWith("gemini-pending-")
  ) {
    return "gemini";
  }
  if (
    normalized.startsWith("grok:") ||
    normalized.startsWith("grok-pending-")
  ) {
    return "grok";
  }
  if (
    normalized.startsWith("kimi:") ||
    normalized.startsWith("kimi-pending-")
  ) {
    return "kimi";
  }
  if (
    normalized.startsWith("opencode:") ||
    normalized.startsWith("opencode-pending-")
  ) {
    return "opencode";
  }
  return "codex";
}

export function isPendingThreadId(threadId: string): boolean {
  const normalized = threadId.trim().toLowerCase();
  return (
    normalized.startsWith("claude-pending-") ||
    normalized.startsWith("gemini-pending-") ||
    normalized.startsWith("grok-pending-") ||
    normalized.startsWith("kimi-pending-") ||
    normalized.startsWith("opencode-pending-") ||
    normalized.startsWith("codex-pending-")
  );
}

export function selectReplacementThreadSummary(params: {
  staleThreadId: string;
  summaries: ThreadSummary[];
  staleSummary?: ThreadSummary;
}): ThreadSummary | null {
  return selectReplacementThreadDecision(params).summary ?? null;
}

export function selectReplacementThreadDecision(params: {
  staleThreadId: string;
  summaries: ThreadSummary[];
  staleSummary?: ThreadSummary;
}): ThreadRecoveryDecision {
  const candidates = listReplacementThreadCandidates(params);
  if (candidates.length === 0) {
    return buildNoCandidateThreadRecoveryDecision(
      params.staleThreadId,
      "replacement",
    );
  }
  const scored = scoreDetailedReplacementThreadCandidates(params).sort(
    (left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return right.entry.updatedAt - left.entry.updatedAt;
    },
  );
  const best = scored[0];
  const next = scored[1];
  if (!best) {
    return buildNoCandidateThreadRecoveryDecision(
      params.staleThreadId,
      "replacement",
    );
  }
  const scoreGap = Math.max(0, best.score - (next?.score ?? 0));
  if (best.score > 0 && (!next || next.score < best.score)) {
    const confidence = resolveReplacementRecoveryConfidence(best.score, scoreGap);
    return buildThreadRecoveryDecision({
      oldThreadId: params.staleThreadId,
      candidate: best.entry,
      strategy: "replacement",
      confidence,
      scoreGap,
      featureSignals: best.featureSignals,
      reasonCode:
        confidence >= THREAD_RECOVERY_ALIAS_PERSISTENCE_THRESHOLD
          ? "verified"
          : "low-confidence",
    });
  }
  if (candidates.length === 1) {
    const candidate = candidates[0];
    if (!candidate) {
      return buildNoCandidateThreadRecoveryDecision(
        params.staleThreadId,
        "replacement",
      );
    }
    return buildThreadRecoveryDecision({
      oldThreadId: params.staleThreadId,
      candidate,
      strategy: "replacement",
      confidence: 0.45,
      scoreGap: 0,
      featureSignals: ["sole_candidate"],
      reasonCode: "low-confidence",
    });
  }
  return {
    oldThreadId: params.staleThreadId,
    candidateThreadId: null,
    strategy: "replacement",
    confidence: 0,
    scoreGap,
    featureSignals: ["ambiguous_score"],
    reasonCode: "ambiguous",
    isPersistent: false,
  };
}

export function selectRecoveredNewThreadSummary(params: {
  staleThreadId: string;
  previousSummaries: ThreadSummary[];
  summaries: ThreadSummary[];
  staleSummary?: ThreadSummary;
}): ThreadSummary | null {
  return selectRecoveredNewThreadDecision(params).summary ?? null;
}

export function selectRecoveredNewThreadDecision(params: {
  staleThreadId: string;
  previousSummaries: ThreadSummary[];
  summaries: ThreadSummary[];
  staleSummary?: ThreadSummary;
}): ThreadRecoveryDecision {
  const candidates = listReplacementThreadCandidates(params);
  if (candidates.length === 0) {
    return buildNoCandidateThreadRecoveryDecision(
      params.staleThreadId,
      "new-discovery",
    );
  }

  const previousIds = new Set(
    params.previousSummaries.map((entry) => entry.id.trim()).filter(Boolean),
  );
  const newlyDiscoveredCandidates = candidates.filter(
    (entry) => !previousIds.has(entry.id.trim()),
  );
  if (newlyDiscoveredCandidates.length === 1) {
    const candidate = newlyDiscoveredCandidates[0];
    if (!candidate) {
      return buildNoCandidateThreadRecoveryDecision(
        params.staleThreadId,
        "new-discovery",
      );
    }
    const timeCoherent = isRecoveryTimeCoherent(candidate, params.staleSummary);
    return buildThreadRecoveryDecision({
      oldThreadId: params.staleThreadId,
      candidate,
      strategy: "new-discovery",
      confidence: timeCoherent ? 0.84 : 0.58,
      scoreGap: timeCoherent ? 30 : 0,
      featureSignals: timeCoherent
        ? ["sole_new_candidate", "time_window_coherent"]
        : ["sole_new_candidate"],
      reasonCode: timeCoherent ? "verified" : "low-confidence",
    });
  }

  const staleUpdatedAt =
    typeof params.staleSummary?.updatedAt === "number" &&
    Number.isFinite(params.staleSummary.updatedAt)
      ? params.staleSummary.updatedAt
      : 0;
  if (staleUpdatedAt > 0) {
    const strictlyNewerCandidates = candidates.filter(
      (entry) =>
        typeof entry.updatedAt === "number" &&
        Number.isFinite(entry.updatedAt) &&
        entry.updatedAt > staleUpdatedAt,
    );
    if (strictlyNewerCandidates.length === 1) {
      const candidate = strictlyNewerCandidates[0];
      if (!candidate) {
        return buildNoCandidateThreadRecoveryDecision(
          params.staleThreadId,
          "new-discovery",
        );
      }
      const timeCoherent = isRecoveryTimeCoherent(candidate, params.staleSummary);
      return buildThreadRecoveryDecision({
        oldThreadId: params.staleThreadId,
        candidate,
        strategy: "new-discovery",
        confidence: timeCoherent ? 0.84 : 0.58,
        scoreGap: timeCoherent ? 30 : 0,
        featureSignals: timeCoherent
          ? ["strictly_newer_candidate", "time_window_coherent"]
          : ["strictly_newer_candidate"],
        reasonCode: timeCoherent ? "verified" : "low-confidence",
      });
    }
  }

  return {
    oldThreadId: params.staleThreadId,
    candidateThreadId: null,
    strategy: "new-discovery",
    confidence: 0,
    scoreGap: 0,
    featureSignals:
      newlyDiscoveredCandidates.length > 1
        ? ["multiple_new_candidates"]
        : ["no_unique_new_candidate"],
    reasonCode: newlyDiscoveredCandidates.length > 1 ? "ambiguous" : "no-candidate",
    isPersistent: false,
  };
}

function buildNoCandidateThreadRecoveryDecision(
  oldThreadId: string,
  strategy: ThreadRecoveryStrategy,
): ThreadRecoveryDecision {
  return {
    oldThreadId,
    candidateThreadId: null,
    strategy,
    confidence: 0,
    scoreGap: 0,
    featureSignals: [],
    reasonCode: "no-candidate",
    isPersistent: false,
  };
}

function buildThreadRecoveryDecision(params: {
  oldThreadId: string;
  candidate: ThreadSummary;
  strategy: ThreadRecoveryStrategy;
  confidence: number;
  scoreGap: number;
  featureSignals: string[];
  reasonCode: ThreadRecoveryReasonCode;
}): ThreadRecoveryDecision {
  const confidence = Math.max(0, Math.min(1, params.confidence));
  return {
    oldThreadId: params.oldThreadId,
    candidateThreadId: params.candidate.id,
    strategy: params.strategy,
    confidence,
    scoreGap: params.scoreGap,
    featureSignals: params.featureSignals,
    reasonCode: params.reasonCode,
    isPersistent:
      confidence >= THREAD_RECOVERY_ALIAS_PERSISTENCE_THRESHOLD &&
      params.reasonCode !== "ambiguous" &&
      params.reasonCode !== "fresh-only",
    summary: params.candidate,
  };
}

function normalizeRecoveryTitle(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function isRecoveryTimeCoherent(
  entry: ThreadSummary,
  staleSummary?: ThreadSummary,
): boolean {
  const staleUpdatedAt =
    typeof staleSummary?.updatedAt === "number" &&
    Number.isFinite(staleSummary.updatedAt)
      ? staleSummary.updatedAt
      : 0;
  if (staleUpdatedAt <= 0 || !Number.isFinite(entry.updatedAt)) {
    return false;
  }
  if (entry.updatedAt < staleUpdatedAt) {
    return false;
  }
  return entry.updatedAt - staleUpdatedAt <= THREAD_RECOVERY_TIME_WINDOW_MS;
}

function scoreReplacementThreadCandidateDetailed(
  entry: ThreadSummary,
  staleSummary?: ThreadSummary,
): { score: number; featureSignals: string[] } {
  const staleName = staleSummary?.name?.trim() ?? "";
  let score = 0;
  const featureSignals: string[] = [];
  if (staleName && entry.name.trim() === staleName) {
    score += 100;
    featureSignals.push("name_exact");
  } else if (
    staleName &&
    normalizeRecoveryTitle(entry.name) === normalizeRecoveryTitle(staleName)
  ) {
    score += 70;
    featureSignals.push("name_normalized_match");
  }
  if (
    staleSummary?.source &&
    entry.source &&
    staleSummary.source === entry.source
  ) {
    score += 20;
    featureSignals.push("source_match");
  }
  if (
    staleSummary?.provider &&
    entry.provider &&
    staleSummary.provider === entry.provider
  ) {
    score += 20;
    featureSignals.push("provider_match");
  }
  if (
    staleSummary?.sourceLabel &&
    entry.sourceLabel &&
    staleSummary.sourceLabel === entry.sourceLabel
  ) {
    score += 20;
    featureSignals.push("source_label_match");
  }
  if (isRecoveryTimeCoherent(entry, staleSummary)) {
    score += 30;
    featureSignals.push("time_window_coherent");
  }
  return { score, featureSignals };
}

function scoreReplacementThreadCandidate(
  entry: ThreadSummary,
  staleSummary?: ThreadSummary,
): number {
  return scoreReplacementThreadCandidateDetailed(entry, staleSummary).score;
}

function resolveReplacementRecoveryConfidence(score: number, scoreGap: number): number {
  if (score >= 130 && scoreGap >= 50) {
    return 0.95;
  }
  if (score >= 100 && scoreGap >= THREAD_RECOVERY_REPLACEMENT_GAP_THRESHOLD) {
    return 0.88;
  }
  if (score >= 70 && scoreGap >= THREAD_RECOVERY_REPLACEMENT_GAP_THRESHOLD) {
    return 0.78;
  }
  return 0.6;
}

export function listReplacementThreadCandidates(params: {
  staleThreadId: string;
  summaries: ThreadSummary[];
  staleSummary?: ThreadSummary;
}): ThreadSummary[] {
  const { staleThreadId, summaries } = params;
  const staleSummary =
    params.staleSummary ??
    summaries.find((entry) => entry.id === staleThreadId);
  const staleEngine = inferThreadEngineSource(staleThreadId, staleSummary);
  return summaries.filter((entry) => {
    if (!entry.id || entry.id === staleThreadId) {
      return false;
    }
    if (entry.threadKind === "shared" || isPendingThreadId(entry.id)) {
      return false;
    }
    return inferThreadEngineSource(entry.id, entry) === staleEngine;
  });
}

export function scoreReplacementThreadCandidates(params: {
  staleThreadId: string;
  summaries: ThreadSummary[];
  staleSummary?: ThreadSummary;
}): Array<{ entry: ThreadSummary; score: number }> {
  const staleSummary =
    params.staleSummary ??
    params.summaries.find((entry) => entry.id === params.staleThreadId);
  return listReplacementThreadCandidates(params).map((entry) => ({
    entry,
    score: scoreReplacementThreadCandidate(entry, staleSummary),
  }));
}

export function scoreDetailedReplacementThreadCandidates(params: {
  staleThreadId: string;
  summaries: ThreadSummary[];
  staleSummary?: ThreadSummary;
}): Array<{ entry: ThreadSummary; score: number; featureSignals: string[] }> {
  const staleSummary =
    params.staleSummary ??
    params.summaries.find((entry) => entry.id === params.staleThreadId);
  return listReplacementThreadCandidates(params).map((entry) => {
    const { score, featureSignals } = scoreReplacementThreadCandidateDetailed(
      entry,
      staleSummary,
    );
    return { entry, score, featureSignals };
  });
}

const THREAD_RECOVERY_PATTERNS = [
  "thread not found",
  "conversation not found",
  "conversation_not_found",
  "[session_not_found]",
  "session not found",
  "session file not found",
] as const;

const THREAD_RECOVERY_ERROR_PREFIXES = [
  "会话启动失败",
  "thread not found",
  "conversation not found",
  "conversation_not_found",
  "session not found",
  "session file not found",
  "[session_not_found]",
  "failed to start",
  "turn failed to start",
  "session failed to start",
  "error: thread not found",
  "error: conversation not found",
  "error: conversation_not_found",
  "error: session not found",
] as const;

const RUNTIME_PIPE_DISCONNECT_PATTERNS = [
  "broken pipe",
  "the pipe is being closed",
  "the pipe has been ended",
  "os error 32",
  "os error 109",
  "os error 232",
] as const;

function lineLooksLikeThreadRecoveryError(line: string): boolean {
  const lowered = line.toLowerCase();
  if (!THREAD_RECOVERY_PATTERNS.some((pattern) => lowered.includes(pattern))) {
    return false;
  }
  return THREAD_RECOVERY_ERROR_PREFIXES.some((prefix) =>
    lowered.startsWith(prefix),
  );
}

function lineLooksLikeRuntimeReconnectError(line: string): boolean {
  const lowered = line.toLowerCase();
  return (
    RUNTIME_PIPE_DISCONNECT_PATTERNS.some((pattern) =>
      lowered.includes(pattern),
    ) ||
    lowered.includes("workspace not connected") ||
    lineLooksLikeThreadRecoveryError(line)
  );
}

function getRuntimeReconnectCandidate(text: string): string | null {
  const normalized = text.trim();
  if (!normalized) {
    return null;
  }
  const lines = normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return null;
  }
  if (lines.length === 1) {
    return lineLooksLikeRuntimeReconnectError(lines[0] ?? "")
      ? (lines[0] ?? null)
      : null;
  }
  if (!lines.every((line) => lineLooksLikeRuntimeReconnectError(line))) {
    return null;
  }
  return lines[0] ?? null;
}

function isTransientReconnectAssistantMessage(item: ConversationItem): boolean {
  if (item.kind !== "message" || item.role !== "assistant") {
    return false;
  }
  return getRuntimeReconnectCandidate(item.text) !== null;
}

function normalizeComparableRecoveryMessageText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function buildComparableRecoveryMessageSignature(
  item: Extract<ConversationItem, { kind: "message" }>,
): string {
  const images = Array.isArray(item.images) ? item.images.join("\u0001") : "";
  return [
    item.role,
    normalizeComparableRecoveryMessageText(item.text),
    images,
  ].join("\u0000");
}

function collectComparableRecoveryMessageSequence(
  items: ConversationItem[],
): string[] {
  return items
    .filter(
      (item): item is Extract<ConversationItem, { kind: "message" }> =>
        item.kind === "message" && !isTransientReconnectAssistantMessage(item),
    )
    .map(buildComparableRecoveryMessageSignature)
    .filter(Boolean);
}

function isComparableMessageSequencePrefix(
  prefix: string[],
  target: string[],
): boolean {
  if (prefix.length === 0 || prefix.length > target.length) {
    return false;
  }
  return prefix.every((value, index) => value === target[index]);
}

function countComparableMessageSuffixOverlap(
  left: string[],
  right: string[],
): number {
  const maxLength = Math.min(left.length, right.length);
  let overlap = 0;
  while (overlap < maxLength) {
    const leftIndex = left.length - 1 - overlap;
    const rightIndex = right.length - 1 - overlap;
    if (left[leftIndex] !== right[rightIndex]) {
      break;
    }
    overlap += 1;
  }
  return overlap;
}

function extractComparableRecoveryUserSequence(sequence: string[]): string[] {
  return sequence.filter((signature) => signature.startsWith("user\u0000"));
}

function scoreThreadRecoveryCandidateByMessages(
  staleItems: ConversationItem[],
  candidateItems: ConversationItem[],
): number {
  const staleSequence = collectComparableRecoveryMessageSequence(staleItems);
  const candidateSequence =
    collectComparableRecoveryMessageSequence(candidateItems);
  if (staleSequence.length === 0 || candidateSequence.length === 0) {
    return 0;
  }
  if (
    staleSequence.length === candidateSequence.length &&
    staleSequence.every((value, index) => value === candidateSequence[index])
  ) {
    return 4_000 + staleSequence.length;
  }
  if (isComparableMessageSequencePrefix(staleSequence, candidateSequence)) {
    return 3_000 + staleSequence.length;
  }
  if (isComparableMessageSequencePrefix(candidateSequence, staleSequence)) {
    return 2_500 + candidateSequence.length;
  }
  const messageSuffixOverlap = countComparableMessageSuffixOverlap(
    staleSequence,
    candidateSequence,
  );
  if (messageSuffixOverlap >= 2) {
    return 2_000 + messageSuffixOverlap;
  }
  const staleUserSequence =
    extractComparableRecoveryUserSequence(staleSequence);
  const candidateUserSequence =
    extractComparableRecoveryUserSequence(candidateSequence);
  if (
    staleUserSequence.length > 0 &&
    staleUserSequence.length === candidateUserSequence.length &&
    staleUserSequence.every(
      (value, index) => value === candidateUserSequence[index],
    )
  ) {
    return 1_500 + staleUserSequence.length;
  }
  if (
    isComparableMessageSequencePrefix(staleUserSequence, candidateUserSequence)
  ) {
    return 1_000 + staleUserSequence.length;
  }
  const userSuffixOverlap = countComparableMessageSuffixOverlap(
    staleUserSequence,
    candidateUserSequence,
  );
  if (userSuffixOverlap >= 1) {
    return 500 + userSuffixOverlap;
  }
  return 0;
}

export function selectReplacementThreadByMessageHistory(params: {
  staleItems: ConversationItem[];
  candidates: Array<{
    summary: ThreadSummary;
    items: ConversationItem[];
  }>;
}): ThreadSummary | null {
  return selectReplacementThreadByMessageHistoryDecision(params).summary ?? null;
}

export function selectReplacementThreadByMessageHistoryDecision(params: {
  staleItems: ConversationItem[];
  candidates: Array<{
    summary: ThreadSummary;
    items: ConversationItem[];
  }>;
  staleThreadId?: string;
}): ThreadRecoveryDecision {
  const scored = params.candidates
    .map(({ summary, items }) => ({
      entry: summary,
      score: scoreThreadRecoveryCandidateByMessages(params.staleItems, items),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return right.entry.updatedAt - left.entry.updatedAt;
    });
  const best = scored[0];
  const next = scored[1];
  if (!best) {
    return buildNoCandidateThreadRecoveryDecision(
      params.staleThreadId ?? "",
      "history-match",
    );
  }
  if (!next || next.score < best.score) {
    return buildThreadRecoveryDecision({
      oldThreadId: params.staleThreadId ?? "",
      candidate: best.entry,
      strategy: "history-match",
      confidence: 0.96,
      scoreGap: Math.max(0, best.score - (next?.score ?? 0)),
      featureSignals: ["history_boundary_match"],
      reasonCode: "verified",
    });
  }
  return {
    oldThreadId: params.staleThreadId ?? "",
    candidateThreadId: null,
    strategy: "history-match",
    confidence: 0,
    scoreGap: 0,
    featureSignals: ["ambiguous_history_match"],
    reasonCode: "ambiguous",
    isPersistent: false,
  };
}

export function mergeRecoveredThreadSummaries(
  existingSummaries: ThreadSummary[],
  refreshedSummaries: ThreadSummary[],
  engineSource: ThreadSummary["engineSource"],
): ThreadSummary[] {
  const mergedById = new Map<string, ThreadSummary>();
  existingSummaries.forEach((entry) => {
    if (inferThreadEngineSource(entry.id, entry) !== engineSource) {
      mergedById.set(entry.id, entry);
    }
  });
  refreshedSummaries.forEach((entry) => {
    const previous = mergedById.get(entry.id);
    if (!previous || entry.updatedAt >= previous.updatedAt) {
      mergedById.set(entry.id, entry);
    }
  });
  return Array.from(mergedById.values()).sort(
    (left, right) => right.updatedAt - left.updatedAt,
  );
}

export function isUserConversationMessage(
  item: ConversationItem | undefined,
): item is UserConversationMessage {
  return item?.kind === "message" && item.role === "user";
}

export function normalizeComparableRewindText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function findLastUserMessageIndexById(
  items: UserConversationMessage[],
  messageId: string,
): number {
  const normalizedMessageId = messageId.trim();
  if (!normalizedMessageId) {
    return -1;
  }
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item) {
      continue;
    }
    if (item.id.trim() === normalizedMessageId) {
      return index;
    }
  }
  return -1;
}

export function resolveClaudeRewindMessageIdFromHistory(params: {
  requestedMessageId: string;
  threadItems: ConversationItem[];
  historyItems: ConversationItem[];
}): string {
  const requestedMessageId = params.requestedMessageId.trim();
  if (!requestedMessageId) {
    return "";
  }
  if (CLAUDE_HISTORY_MESSAGE_ID_REGEX.test(requestedMessageId)) {
    return requestedMessageId;
  }

  const localUserItems = params.threadItems.filter(isUserConversationMessage);
  const targetLocalIndex = localUserItems.findIndex(
    (item) => item.id.trim() === requestedMessageId,
  );
  if (targetLocalIndex < 0) {
    return requestedMessageId;
  }
  const targetLocalItem = localUserItems[targetLocalIndex];
  if (!targetLocalItem) {
    return requestedMessageId;
  }

  const historyUserItems = params.historyItems
    .filter(isUserConversationMessage)
    .map((item) => ({
      id: item.id.trim(),
      text: normalizeComparableRewindText(item.text),
    }))
    .filter((item) => item.id.length > 0);
  if (historyUserItems.length < 1) {
    return requestedMessageId;
  }
  if (historyUserItems.some((item) => item.id === requestedMessageId)) {
    return requestedMessageId;
  }

  const targetText = normalizeComparableRewindText(targetLocalItem.text);
  if (targetText) {
    const targetOccurrenceByText =
      localUserItems.reduce((count, item, index) => {
        if (index > targetLocalIndex) {
          return count;
        }
        return normalizeComparableRewindText(item.text) === targetText
          ? count + 1
          : count;
      }, 0) || 1;
    const historyMatches = historyUserItems.filter(
      (item) => item.text === targetText,
    );
    if (historyMatches.length >= targetOccurrenceByText) {
      return (
        historyMatches[targetOccurrenceByText - 1]?.id ?? requestedMessageId
      );
    }
    if (historyMatches.length > 0) {
      return (
        historyMatches[historyMatches.length - 1]?.id ?? requestedMessageId
      );
    }
  }

  const positionFromLatest = localUserItems.length - 1 - targetLocalIndex;
  const fallbackIndex = historyUserItems.length - 1 - positionFromLatest;
  if (fallbackIndex >= 0 && fallbackIndex < historyUserItems.length) {
    return historyUserItems[fallbackIndex]?.id ?? requestedMessageId;
  }
  return (
    historyUserItems[historyUserItems.length - 1]?.id ?? requestedMessageId
  );
}

export function findLatestHistoryUserMessageId(
  items: ConversationItem[],
): string {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!isUserConversationMessage(item)) {
      continue;
    }
    const id = item.id.trim();
    if (!id) {
      continue;
    }
    return id;
  }
  return "";
}

export function findFirstHistoryUserMessageId(
  items: ConversationItem[],
): string {
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!isUserConversationMessage(item)) {
      continue;
    }
    const id = item.id.trim();
    if (!id) {
      continue;
    }
    return id;
  }
  return "";
}

function normalizeThreadSizeBytes(value: unknown) {
  const sizeBytes = asNumber(value);
  return sizeBytes > 0 ? Math.round(sizeBytes) : undefined;
}

export function extractThreadSizeBytes(record: Record<string, unknown>) {
  return normalizeThreadSizeBytes(
    record.sizeBytes ??
      record.size_bytes ??
      record.fileSizeBytes ??
      record.file_size_bytes ??
      record.byteSize ??
      record.byte_size ??
      record.bytes,
  );
}

function normalizeGeminiSessionSummary(
  value: unknown,
): GeminiSessionSummary | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const sessionId = asString(record.sessionId ?? record.session_id).trim();
  if (!sessionId) {
    return null;
  }
  const fileSizeBytes = extractThreadSizeBytes(record);
  return {
    sessionId,
    firstMessage: asString(record.firstMessage ?? record.first_message).trim(),
    updatedAt: asNumber(record.updatedAt ?? record.updated_at),
    ...(fileSizeBytes !== undefined ? { fileSizeBytes } : {}),
  };
}

export function normalizeGeminiSessionSummaries(
  value: unknown,
): GeminiSessionSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const summaries: GeminiSessionSummary[] = [];
  value.forEach((entry) => {
    const summary = normalizeGeminiSessionSummary(entry);
    if (summary) {
      summaries.push(summary);
    }
  });
  return summaries;
}

export function normalizeKimiSessionSummaries(
  value: unknown,
): KimiSessionSummary[] {
  // Kimi session summaries share the Gemini summary shape.
  return normalizeGeminiSessionSummaries(value);
}

function normalizeGrokSessionSummary(value: unknown): GrokSessionSummary | null {
  const base = normalizeGeminiSessionSummary(value);
  if (!base) {
    return null;
  }
  if (!value || typeof value !== "object") {
    return base;
  }
  const record = value as Record<string, unknown>;
  const parentSessionId = asString(
    record.parentSessionId ?? record.parent_session_id,
  ).trim();
  const sessionKind = asString(
    record.sessionKind ?? record.session_kind,
  ).trim();
  return {
    ...base,
    ...(parentSessionId ? { parentSessionId } : {}),
    ...(sessionKind ? { sessionKind } : {}),
  };
}

export function normalizeGrokSessionSummaries(
  value: unknown,
): GrokSessionSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const summaries: GrokSessionSummary[] = [];
  value.forEach((entry) => {
    const summary = normalizeGrokSessionSummary(entry);
    if (summary) {
      summaries.push(summary);
    }
  });
  return summaries;
}

/**
 * 协作 multi-agent worker 的 Codex 首包标题（整段 multi-line context）。
 * 特征：MOSSX 包 + `binding:squad:`（Provider Continuation 单行 package 不含 squad）。
 * 安全：不单凭 `Agent N` / 普通 MOSSX 单行 package 误杀用户会话或续接会话。
 */
export function isSharedCollabWorkerSpawnTitle(
  value: string | null | undefined,
): boolean {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return false;
  // 协作 worker context 必含 squad binding key
  if (
    /binding\s*:\s*squad:/i.test(normalized) &&
    (normalized.includes("MOSSX_CONTEXT_PACKAGE:") ||
      normalized.includes("MOSSX_SHARED_CONTEXT_V1"))
  ) {
    return true;
  }
  return false;
}

/**
 * 协作规划段把模型首行 `SUMMARY: …` 写进 native session 标题（preview 后常见
 * `SUMMARY: 创建…` / 截断 `SUM`）。这不是用户会话，侧栏必须隐藏。
 * 不匹配句中讨论（非行首），避免误伤。
 */
export function isCollabPlanSummarySidebarTitle(
  value: string | null | undefined,
): boolean {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return false;
  // 半角/全角冒号
  if (/^SUMMARY\s*[:：]/i.test(normalized)) return true;
  // previewThreadName 截到极短：`SUM` / `SUMMARY`
  if (/^SUM(?:MARY)?$/i.test(normalized)) return true;
  return false;
}

/**
 * 协作 worker 首包/改名后的侧栏碎片标题。
 *
 * ⚠️ 仅匹配 **协作管线特有** 文案，禁止泛 Markdown（`##` / `**`）——否则 native
 * 用户首条消息是「## 需求」会被误踢出侧栏。
 */
export function isCollabWorkerOrchestrationPromptTitle(
  value: string | null | undefined,
): boolean {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return false;
  // 自定义模板 stage id 也是【draft】/【polish】等，不能只认中文规划/实现/审查
  if (/多\s*Agent\s*协作管线/i.test(normalized)) return true;
  if (/【[^】]{1,32}】\s*环节/.test(normalized)) return true;
  if (/binding\s*:\s*squad:/i.test(normalized)) return true;
  // 本环节自定义指令 / 协作交付说明块（非任意 **bold**）
  if (normalized.includes("本环节自定义指令")) return true;
  if (/^\*\*交付说明\*\*/.test(normalized)) return true;
  if (/^交付说明\b/.test(normalized)) return true;
  return false;
}

/**
 * Codex catalog 常把 worker 显示名压成 `Agent 11`。
 * 仅当同时具备协作信号时才 hide，避免误杀用户真·Agent 会话。
 * 协作信号：shared 父、hide set（由调用方先查）、nativeTitle/raw 仍含协作特征。
 */
export function isCollabWorkerAgentNumberTitle(
  value: string | null | undefined,
): boolean {
  const normalized = typeof value === "string" ? value.trim() : "";
  return /^Agent\s+\d+$/i.test(normalized);
}

/**
 * Shared control-plane / 程序内部 session 标题闸（侧栏 hide 安全网）。
 *
 * 命中任一即视为非用户顶层会话：
 * 1. 行首 `MOSSX_*`（含 previewThreadName 截断后的半截 package）
 * 2. 完整 protocol classify（未截断的 exact marker / envelope）
 * 3. 协作 worker multi-line（MOSSX + binding:squad:）
 * 4. 协作规划 SUMMARY 标题（改名后仍泄漏的主形态）
 *
 * 不单凭 `Agent N` 删行；Shared 顶层行由 stripHiddenSharedBindingSummaries 豁免。
 */
export function isSharedControlPlaneSpawnTitle(
  value: string | null | undefined,
): boolean {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return false;
  // 行首 MOSSX_：覆盖截断 title（主缺口）与全部已知 control token
  if (isDogeProgramControlTitle(normalized)) {
    return true;
  }
  // 完整 protocol envelope（未截断 multi-line 也可能被 classify 命中）
  if (classifyContextProtocolText(normalized) !== null) {
    return true;
  }
  // 协作规划 SUMMARY 当 title（实机侧栏：`SUMMARY: 创建…` / `SUM`）
  if (isCollabPlanSummarySidebarTitle(normalized)) {
    return true;
  }
  // 协作 worker 管线 prompt 当 firstMessage / title
  if (isCollabWorkerOrchestrationPromptTitle(normalized)) {
    return true;
  }
  // 协作 worker multi-line 包（binding:squad: 可能在截断后丢失，raw 路径另拦）
  return isSharedCollabWorkerSpawnTitle(normalized);
}

/** hide set 命中：id 本体 + 去 engine 前缀后的 raw uuid */
export function threadIdInHiddenSharedBindingSet(
  threadId: string,
  hiddenSharedBindingIds: ReadonlySet<string>,
): boolean {
  const id = threadId.trim();
  if (!id) return false;
  if (hiddenSharedBindingIds.has(id)) return true;
  const colon = id.indexOf(":");
  if (colon > 0) {
    const bare = id.slice(colon + 1).trim();
    if (bare && hiddenSharedBindingIds.has(bare)) return true;
  }
  return false;
}

/**
 * 从侧栏快照剔除 Shared Hidden Native Binding。
 * hide set 由 expandHiddenSharedBindingIds 构建（含 raw / engine:raw / pending 变体）。
 * 额外：剔除 control-plane 标题的 native 行（MOSSX 包 / 协作 context）。
 */
export function stripHiddenSharedBindingSummaries(
  summaries: ThreadSummary[],
  hiddenSharedBindingIds: ReadonlySet<string>,
): ThreadSummary[] {
  if (summaries.length === 0) {
    return summaries;
  }
  // 并入协作 worker runtime 登记表（改名 Agent N 后 id 仍命中）
  const collabHide = getCollabWorkerNativeHideIds();
  const effectiveHide =
    collabHide.size === 0
      ? hiddenSharedBindingIds
      : new Set<string>([...hiddenSharedBindingIds, ...collabHide]);
  let changed = false;
  const next = summaries.filter((summary) => {
    if (threadIdInHiddenSharedBindingSet(summary.id, effectiveHide)) {
      changed = true;
      return false;
    }
    // Shared 顶层会话永不因 control-plane 标题被误杀
    if (summary.id.startsWith("shared:") || summary.threadKind === "shared") {
      return true;
    }
    if (isSharedControlPlaneSpawnTitle(summary.name)) {
      changed = true;
      return false;
    }
    // Shared 子代理：parent 已 remap 到 shared: 时必须保留在列表中，
    // 供 useThreadRows / childSubagentThreads / S10→Strip 合成使用。
    // （旧逻辑直接丢掉 → Shared 无子代理入口；Native 不受影响）
    const parent = summary.parentThreadId?.trim() ?? "";
    if (parent.startsWith("shared:") && !summary.id.startsWith("shared:")) {
      return true;
    }
    return true;
  });
  return changed ? next : summaries;
}

function mergeNativeCliSessionSummaries(params: {
  baseSummaries: ThreadSummary[];
  sessions: Array<
    GeminiSessionSummary & {
      parentSessionId?: string | null;
      sessionKind?: string | null;
    }
  >;
  idPrefix: "gemini" | "grok" | "kimi";
  engineSource: "gemini" | "grok" | "kimi";
  fallbackTitle: string;
  workspaceId: string;
  mappedTitles: Record<string, string>;
  getCustomName: (workspaceId: string, threadId: string) => string | undefined;
  /** Shared-owned native ids；baseline 与新增 session 都必须剔除 */
  hiddenSharedBindingIds?: ReadonlySet<string>;
}): ThreadSummary[] {
  const {
    sessions,
    idPrefix,
    engineSource,
    fallbackTitle,
    workspaceId,
    mappedTitles,
    getCustomName,
    hiddenSharedBindingIds,
  } = params;
  // sessions 全被 hide 过滤为空时，仍要清 baseline 泄漏；禁止 early-return 原 base。
  const baseSummaries = stripHiddenSharedBindingSummaries(
    params.baseSummaries,
    hiddenSharedBindingIds ?? new Set(),
  );
  if (sessions.length === 0) {
    return baseSummaries;
  }
  const mergedById = new Map<string, ThreadSummary>();
  baseSummaries.forEach((entry) => mergedById.set(entry.id, entry));
  sessions.forEach((session) => {
    const id = `${idPrefix}:${session.sessionId}`;
    // id 本体 + bare uuid（与 Codex catalog 路径对齐，避免 hide set 变体漏网）
    if (
      threadIdInHiddenSharedBindingSet(
        id,
        hiddenSharedBindingIds ?? new Set(),
      )
    ) {
      return;
    }
    // 在 clip 标题前用 raw firstMessage 拦 control-plane（截断会丢 sha256 body）
    if (isSharedControlPlaneSpawnTitle(session.firstMessage)) {
      return;
    }
    const prev = mergedById.get(id);
    const updatedAt = Number.isFinite(session.updatedAt)
      ? Math.max(0, session.updatedAt)
      : 0;
    const mappedTitle = mappedTitles[id];
    const customTitle = getCustomName(workspaceId, id);
    const title = previewThreadName(session.firstMessage, fallbackTitle);
    // 双闸：clip 后 name 仍 control-plane / SUMMARY / MOSSX 则不入侧栏
    if (isSharedControlPlaneSpawnTitle(title)) {
      return;
    }
    // mapped/custom 改名后的展示名也过闸（避免「继续：」类之外的协作残留）
    if (
      isSharedControlPlaneSpawnTitle(mappedTitle) ||
      isSharedControlPlaneSpawnTitle(customTitle)
    ) {
      return;
    }
    const rawParent = session.parentSessionId?.trim() || "";
    const parentThreadId =
      rawParent.length > 0
        ? rawParent.startsWith(`${idPrefix}:`)
          ? rawParent
          : `${idPrefix}:${rawParent}`
        : prev?.parentThreadId ?? null;
    const next: ThreadSummary = {
      id,
      name: selectProjectedSessionDisplayName({
        previous: prev,
        nextName: title,
        mappedTitle,
        customTitle,
      }),
      updatedAt,
      sizeBytes: session.fileSizeBytes,
      engineSource,
      ...(parentThreadId ? { parentThreadId } : {}),
    };
    if (!prev || next.updatedAt >= prev.updatedAt) {
      const merged = mergeSessionDisplaySummary(prev, next, {
        mappedTitle,
        customTitle,
      });
      // 保留 parent 链接（mergeSessionDisplaySummary 可能丢掉新字段）
      mergedById.set(id, {
        ...merged,
        parentThreadId:
          next.parentThreadId ?? merged.parentThreadId ?? prev?.parentThreadId ?? null,
      });
    } else if (parentThreadId && !prev.parentThreadId) {
      // 本地 live 线程 updatedAt 更新时，仍要把 list 扫到的 parent 补回去
      mergedById.set(id, {
        ...prev,
        parentThreadId,
      });
    }
  });
  return Array.from(mergedById.values()).sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
}

export function mergeGeminiSessionSummaries(
  baseSummaries: ThreadSummary[],
  geminiSessions: GeminiSessionSummary[],
  workspaceId: string,
  mappedTitles: Record<string, string>,
  getCustomName: (workspaceId: string, threadId: string) => string | undefined,
  hiddenSharedBindingIds?: ReadonlySet<string>,
): ThreadSummary[] {
  return mergeNativeCliSessionSummaries({
    baseSummaries,
    sessions: geminiSessions,
    idPrefix: "gemini",
    engineSource: "gemini",
    fallbackTitle: "Gemini Session",
    workspaceId,
    mappedTitles,
    getCustomName,
    hiddenSharedBindingIds,
  });
}

export function mergeKimiSessionSummaries(
  baseSummaries: ThreadSummary[],
  kimiSessions: KimiSessionSummary[],
  workspaceId: string,
  mappedTitles: Record<string, string>,
  getCustomName: (workspaceId: string, threadId: string) => string | undefined,
  hiddenSharedBindingIds?: ReadonlySet<string>,
): ThreadSummary[] {
  return mergeNativeCliSessionSummaries({
    baseSummaries,
    sessions: kimiSessions,
    idPrefix: "kimi",
    engineSource: "kimi",
    fallbackTitle: "Kimi Session",
    workspaceId,
    mappedTitles,
    getCustomName,
    hiddenSharedBindingIds,
  });
}

export function mergeGrokSessionSummaries(
  baseSummaries: ThreadSummary[],
  grokSessions: GrokSessionSummary[],
  workspaceId: string,
  mappedTitles: Record<string, string>,
  getCustomName: (workspaceId: string, threadId: string) => string | undefined,
  /** native owner → shared: 会话，把子代理挂到 Shared 父节点 */
  nativeOwnerToSharedThreadId?: Map<string, string>,
  hiddenSharedBindingIds?: ReadonlySet<string>,
): ThreadSummary[] {
  const merged = mergeNativeCliSessionSummaries({
    baseSummaries,
    sessions: grokSessions,
    idPrefix: "grok",
    engineSource: "grok",
    fallbackTitle: "Grok Session",
    workspaceId,
    mappedTitles,
    getCustomName,
    hiddenSharedBindingIds,
  });
  if (!nativeOwnerToSharedThreadId || nativeOwnerToSharedThreadId.size === 0) {
    return merged;
  }
  return merged.map((thread) => {
    const parent = thread.parentThreadId?.trim() || "";
    if (!parent) {
      return thread;
    }
    const remapped = nativeOwnerToSharedThreadId.get(parent);
    if (!remapped || remapped === parent) {
      return thread;
    }
    return { ...thread, parentThreadId: remapped };
  });
}

function normalizeCatalogEngine(
  engine: CodexCatalogSessionSummary["engine"],
): ThreadSummary["engineSource"] {
  switch (engine) {
    case "claude":
    case "codex":
    case "gemini":
    case "grok":
    case "kimi":
    case "opencode":
      return engine;
    default:
      return "codex";
  }
}

function selectStableThreadSummaryName(
  params: {
    previous?: ThreadSummary;
    nextName: string;
    engineSource: ThreadSummary["engineSource"];
  } & SessionDisplayTitleSources,
): string {
  return selectProjectedSessionDisplayName(params);
}

export function mergeThreadSummaryPreservingStableIdentity(
  previous: ThreadSummary | undefined,
  next: ThreadSummary,
  titleSources: SessionDisplayTitleSources = {},
): ThreadSummary {
  return mergeSessionDisplaySummary(previous, next, titleSources);
}

export function mergeCodexCatalogSessionSummaries(
  baseSummaries: ThreadSummary[],
  codexSessions: CodexCatalogSessionSummary[],
  workspaceId: string,
  mappedTitles: Record<string, string>,
  getCustomName: (workspaceId: string, threadId: string) => string | undefined,
  /** Shared-owned native ids；merge 前剔除，避免改名成 Agent N 后漏网 */
  hiddenSharedBindingIds: ReadonlySet<string> = new Set(),
): ThreadSummary[] {
  // 先清 baseline 泄漏
  const safeBase = stripHiddenSharedBindingSummaries(
    baseSummaries,
    hiddenSharedBindingIds,
  );
  if (codexSessions.length === 0) {
    return safeBase;
  }
  const mergedById = new Map<string, ThreadSummary>();
  safeBase.forEach((entry) => mergedById.set(entry.id, entry));
  codexSessions.forEach((session) => {
    const title = normalizeSessionDisplayTitle(session.title);
    const nativeTitle = normalizeSessionDisplayTitle(session.nativeTitle);
    const engineSource = normalizeCatalogEngine(session.engine);
    if (!title && !nativeTitle) {
      return;
    }
    // id hide（含 raw / engine: 变体）
    if (
      threadIdInHiddenSharedBindingSet(
        session.sessionId,
        hiddenSharedBindingIds,
      )
    ) {
      return;
    }
    // 协作 worker multi-line（改名 Agent N 前）必须拦
    if (
      isSharedCollabWorkerSpawnTitle(title) ||
      isSharedCollabWorkerSpawnTitle(nativeTitle)
    ) {
      return;
    }
    // 程序 MOSSX_* / SUMMARY / 管线 prompt / Markdown 碎片：非 Provider Continuation 直接丢
    const isControlPlaneTitle =
      isSharedControlPlaneSpawnTitle(title) ||
      isSharedControlPlaneSpawnTitle(nativeTitle);
    const isProviderContinuation =
      session.originKind === "provider-continuation";
    if (isControlPlaneTitle && !isProviderContinuation) {
      return;
    }
    // ⚠️ 禁止：凡 Agent N + parentSessionId 就丢——会误杀 native Codex/Claude 子代理树。
    // 协作 worker 改名 Agent N 的主路径：hide set / collabNativeHideRegistry / MOSSX nativeTitle。
    if (
      engineSource === "codex" &&
      !nativeTitle &&
      hasCodexBackgroundHelperPreview([title])
    ) {
      return;
    }
    const prev = mergedById.get(session.sessionId);
    const updatedAt = Number.isFinite(session.updatedAt)
      ? Math.max(0, session.updatedAt)
      : 0;
    const parentThreadId =
      engineSource === "claude" && session.parentSessionId
        ? session.parentSessionId.startsWith("claude:")
          ? session.parentSessionId
          : `claude:${session.parentSessionId}`
        : (session.parentSessionId ?? null);
    const mappedTitle = mappedTitles[session.sessionId];
    const ownerWorkspaceId = session.workspaceId ?? workspaceId;
    const ownerCustomTitle = getCustomName(ownerWorkspaceId, session.sessionId);
    const selectedWorkspaceCustomTitle =
      ownerWorkspaceId === workspaceId
        ? undefined
        : getCustomName(workspaceId, session.sessionId);
    const customTitle = ownerCustomTitle || selectedWorkspaceCustomTitle;
    const engineFallbackTitle =
      engineSource === "claude"
        ? "Claude Session"
        : engineSource === "gemini"
          ? "Gemini Session"
          : engineSource === "grok"
            ? "Grok Session"
            : engineSource === "kimi"
              ? "Kimi Session"
              : engineSource === "opencode"
                ? "OpenCode Session"
                : "Codex Session";
    const continuationSourceName = session.sourceSessionId
      ? mergedById.get(session.sourceSessionId)?.name?.trim()
      : null;
    const continuationFallbackTitle =
      isProviderContinuation
        ? continuationSourceName
          ? `继续：${continuationSourceName}`
          : `Provider 续接 · ${
              session.providerProfileName?.trim() ||
              engineFallbackTitle.replace(/ Session$/, "")
            }`
        : null;
    // 截断 title 无法 classify；用 control-plane 闸（含 MOSSX_ 行首）触发改写
    const fallbackTitle =
      continuationFallbackTitle && isControlPlaneTitle
        ? continuationFallbackTitle
        : previewThreadName(title || nativeTitle, engineFallbackTitle);
    const next: ThreadSummary = {
      id: session.sessionId,
      name: selectStableThreadSummaryName({
        previous: prev,
        nextName: fallbackTitle,
        mappedTitle,
        customTitle,
        nativeTitle,
        engineSource,
      }),
      updatedAt,
      archivedAt:
        typeof session.archivedAt === "number" &&
        Number.isFinite(session.archivedAt) &&
        session.archivedAt > 0
          ? session.archivedAt
          : undefined,
      sizeBytes: session.sizeBytes,
      physicalPath: session.physicalPath ?? undefined,
      engineSource,
      threadKind: "native",
      source: session.source ?? undefined,
      provider: session.provider ?? undefined,
      sourceLabel: session.sourceLabel ?? undefined,
      providerProfileId: session.providerProfileId ?? undefined,
      providerProfileSource: session.providerProfileSource ?? undefined,
      providerProfileName: session.providerProfileName ?? undefined,
      providerAvailability: session.providerAvailability ?? undefined,
      folderId: session.folderId ?? null,
      autoSession: session.autoSession ?? null,
      parentThreadId,
      originKind: session.originKind ?? undefined,
      sourceSessionId: session.sourceSessionId ?? undefined,
      sourceProviderProfileId: session.sourceProviderProfileId ?? undefined,
      familyId: session.familyId ?? undefined,
      familyRootSessionId: session.familyRootSessionId ?? undefined,
      lineageParentSessionId:
        session.lineageParentSessionId ?? undefined,
      lineageKind: session.lineageKind ?? undefined,
      lineageDepth: session.lineageDepth ?? undefined,
    };
    if (!prev || next.updatedAt >= prev.updatedAt) {
      mergedById.set(
        session.sessionId,
        mergeSessionDisplaySummary(prev, next, {
          mappedTitle,
          customTitle,
          nativeTitle,
        }),
      );
    }
  });
  return Array.from(mergedById.values()).sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
}

/**
 * 用于 `isRetainableEngineContinuitySummary` 的引擎特定 pending 前缀映射。
 *
 * 设计契约：
 * - Claude / Codex / OpenCode：检查对应 `<engine>-pending-` 前缀。
 * - Pending thread 是短期占位态，不能被 last-good seed 复活为历史会话。
 */
type EngineSource = NonNullable<ThreadSummary["engineSource"]>;

const PENDING_PREFIXES_BY_ENGINE: Partial<Record<EngineSource, string>> = {
  claude: "claude-pending-",
  codex: "codex-pending-",
  opencode: "opencode-pending-",
};

function isPendingEngineThreadId(
  engine: EngineSource,
  threadId: string,
): boolean {
  const prefix = PENDING_PREFIXES_BY_ENGINE[engine];
  if (!prefix) {
    return false;
  }
  return threadId.trim().toLowerCase().startsWith(prefix);
}

/**
 * 引擎归一化的 retainable 判定：用于决定 last-good 中某条 summary 是否仍可作为
 * sidebar 兜底 seed 的候选。规则跨引擎共享：
 *
 * - 引擎归属必须匹配 `engine` 参数；
 * - shared / archived 条目 MUST 拒绝；
 * - pending 前缀条目 MUST 拒绝（避免把短期占位 thread 当历史）。
 *
 * 既有 `isRetainableClaudeContinuitySummary` / `isRetainableCodexContinuitySummary`
 * 现已收敛到该通用版本的薄包装，确保跨引擎行为收口在同一处。
 */
export function isRetainableEngineContinuitySummary(
  engine: EngineSource,
  summary: ThreadSummary,
): boolean {
  if (inferThreadEngineSource(summary.id, summary) !== engine) {
    return false;
  }
  if (summary.threadKind === "shared") {
    return false;
  }
  if ((summary.archivedAt ?? 0) > 0) {
    return false;
  }
  if (isPendingEngineThreadId(engine, summary.id)) {
    return false;
  }
  return true;
}

function isRetainableCodexContinuitySummary(summary: ThreadSummary): boolean {
  return isRetainableEngineContinuitySummary("codex", summary);
}

export function shouldApplyCodexSidebarContinuity(
  partialSource: string | null,
): boolean {
  if (!partialSource) {
    return false;
  }
  const normalized = partialSource.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.includes("thread-list") ||
    normalized.includes("codex") ||
    normalized.includes("workspace-not-connected") ||
    normalized.includes("runtime unavailable") ||
    normalized.includes("guarded-recovery") ||
    normalized.includes("local-session-scan")
  );
}

export function mergeDegradedCodexContinuitySummaries(
  baseSummaries: ThreadSummary[],
  fallbackSummaries: ThreadSummary[],
): ThreadSummary[] {
  if (fallbackSummaries.length === 0) {
    return baseSummaries;
  }
  const mergedById = new Map<string, ThreadSummary>();
  baseSummaries.forEach((entry) => mergedById.set(entry.id, entry));
  fallbackSummaries.forEach((entry) => {
    if (
      !isRetainableCodexContinuitySummary(entry) ||
      mergedById.has(entry.id)
    ) {
      return;
    }
    mergedById.set(entry.id, entry);
  });
  return Array.from(mergedById.values()).sort(
    (left, right) => right.updatedAt - left.updatedAt,
  );
}

function isRetainableClaudeContinuitySummary(summary: ThreadSummary): boolean {
  return isRetainableEngineContinuitySummary("claude", summary);
}

export function shouldApplyClaudeSidebarContinuity(
  partialSource: string | null,
): boolean {
  if (!partialSource) {
    return false;
  }
  const normalized = partialSource.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.includes("claude") ||
    normalized.includes("catalog") ||
    normalized.includes("empty-thread-list") ||
    normalized.includes("partial") ||
    normalized.includes("timeout")
  );
}

export function mergeDegradedClaudeContinuitySummaries(
  baseSummaries: ThreadSummary[],
  fallbackSummaries: ThreadSummary[],
  excludedThreadIds: ReadonlySet<string> = new Set(),
): ThreadSummary[] {
  if (fallbackSummaries.length === 0) {
    return baseSummaries;
  }
  return projectSessionDisplaySummaries({
    baseSummaries,
    candidateSummaries: fallbackSummaries,
    excludedThreadIds,
    canRetainCandidate: isRetainableClaudeContinuitySummary,
    mergeOlderCandidates: true,
  });
}

export function filterRetainableContinuitySummaries(
  summaries: ThreadSummary[],
  excludedThreadIds: ReadonlySet<string> = new Set(),
): ThreadSummary[] {
  return summaries.filter((summary) => {
    if (excludedThreadIds.has(summary.id)) {
      return false;
    }
    const engine = inferThreadEngineSource(summary.id, summary);
    if (engine !== "claude" && engine !== "codex" && engine !== "opencode") {
      return summary.threadKind !== "shared" && (summary.archivedAt ?? 0) <= 0;
    }
    return isRetainableEngineContinuitySummary(engine, summary);
  });
}

/**
 * 引擎归一化的 last-good seed：当指定引擎的 native listing 子请求 timeout / null / rejected 时，
 * 把 last-good 列表里仍然适用的对应引擎条目（非 archived、非 shared、非 pending、未被 hidden binding
 * 排除）seed 进当前正在合并的 mergedById。这是 partial-source merge 之前的第一道防线，避免下游
 * catalog merge / archive merge 在只看到空子源时形成残缺基底。
 *
 * 设计契约（详见 `openspec/specs/sidebar-list-timeout-fallback/spec.md`）：
 * - engine 联合类型仅含已纳入主链路 seed 的引擎（"claude" | "opencode"）。
 * - Codex 走 `mergeCodexCatalogSessionSummaries` 的空源早退路径，主链路无需 seed。
 * - Gemini 走 fire-and-forget 独立异步任务，timeout 时不触碰 mergedById，主链路无需 seed。
 * - 任何后续把 Codex / Gemini 改成主链路同步合并的重构，MUST 重新评估该 engine 联合类型并补 seed。
 *
 * 该函数原地修改 mergedById；返回实际 seed 进去的条目数，便于诊断与测试。
 */
export function seedLastGoodEngineIntoMerged(
  engine: "claude" | "opencode",
  mergedById: Map<string, ThreadSummary>,
  lastGoodSummaries: ThreadSummary[],
  excludedThreadIds: ReadonlySet<string> = new Set(),
): number {
  if (lastGoodSummaries.length === 0) {
    return 0;
  }
  let seeded = 0;
  for (const entry of lastGoodSummaries) {
    if (excludedThreadIds.has(entry.id)) {
      continue;
    }
    if (!isRetainableEngineContinuitySummary(engine, entry)) {
      continue;
    }
    const previous = mergedById.get(entry.id);
    if (previous && previous.updatedAt >= entry.updatedAt) {
      if (
        isWeakSessionDisplayTitle(previous.name) &&
        !isWeakSessionDisplayTitle(entry.name)
      ) {
        mergedById.set(entry.id, mergeSessionDisplaySummary(entry, previous));
        seeded += 1;
      }
      continue;
    }
    mergedById.set(
      entry.id,
      previous ? mergeSessionDisplaySummary(previous, entry) : entry,
    );
    seeded += 1;
  }
  return seeded;
}

/**
 * Claude 引擎兜底 seed 的薄包装：行为 100% 等价于
 * `seedLastGoodEngineIntoMerged("claude", ...)`，保留为兼容 1f2f87f1 修复中既有调用点与
 * `useThreadActions.timeout-fallback.test.tsx` 中的测试入口。
 */
export function seedLastGoodClaudeIntoMerged(
  mergedById: Map<string, ThreadSummary>,
  lastGoodSummaries: ThreadSummary[],
  excludedThreadIds: ReadonlySet<string> = new Set(),
): number {
  return seedLastGoodEngineIntoMerged(
    "claude",
    mergedById,
    lastGoodSummaries,
    excludedThreadIds,
  );
}

/**
 * OpenCode 引擎兜底 seed 的薄包装：行为 100% 等价于
 * `seedLastGoodEngineIntoMerged("opencode", ...)`，用于 OpenCode 子源 timeout / rejected 时
 * 保留上一轮可用的 OpenCode 历史条目。
 */
export function seedLastGoodOpenCodeIntoMerged(
  mergedById: Map<string, ThreadSummary>,
  lastGoodSummaries: ThreadSummary[],
  excludedThreadIds: ReadonlySet<string> = new Set(),
): number {
  return seedLastGoodEngineIntoMerged(
    "opencode",
    mergedById,
    lastGoodSummaries,
    excludedThreadIds,
  );
}

export async function withTimeout<T>(
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

export async function mapWithConcurrency<T>(
  items: string[],
  concurrency: number,
  worker: (item: string) => Promise<T>,
): Promise<T[]> {
  if (items.length === 0) {
    return [];
  }
  const normalizedConcurrency = Math.max(1, Math.floor(concurrency));
  const results: T[] = [];
  let cursor = 0;
  const runWorker = async () => {
    while (cursor < items.length) {
      const currentIndex = cursor;
      cursor += 1;
      const item = items[currentIndex];
      if (!item) {
        continue;
      }
      const result = await worker(item);
      results.push(result);
    }
  };
  const workers = Array.from(
    { length: Math.min(normalizedConcurrency, items.length) },
    () => runWorker(),
  );
  await Promise.all(workers);
  return results;
}

export function resolveRewindSupportedEngine(
  threadId: string,
): RewindSupportedEngine | null {
  const normalized = threadId.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith("claude:")) {
    return "claude";
  }
  if (normalized.startsWith("codex:")) {
    return "codex";
  }
  if (
    normalized.startsWith("claude-pending-") ||
    normalized.startsWith("codex-pending-") ||
    normalized.startsWith("gemini:") ||
    normalized.startsWith("gemini-pending-") ||
    normalized.startsWith("grok:") ||
    normalized.startsWith("grok-pending-") ||
    normalized.startsWith("kimi:") ||
    normalized.startsWith("kimi-pending-") ||
    normalized.startsWith("opencode:") ||
    normalized.startsWith("opencode-pending-")
  ) {
    return null;
  }
  if (normalized.includes(":")) {
    return null;
  }
  return "codex";
}

export function isLocalSessionScanUnavailable(
  result: Record<string, unknown>,
): boolean {
  const marker = asString(result.partialSource ?? result.partial_source)
    .trim()
    .toLowerCase();
  return marker === "local-session-scan-unavailable";
}

export function shouldIncludeWorkspaceThreadEntry(
  thread: Record<string, unknown>,
  workspacePath: string,
  knownCodexThreadIds: Set<string>,
  allowKnownCodexWithoutCwd: boolean,
): boolean {
  const threadCwd = asString(thread.cwd).trim();
  if (matchesWorkspacePath(threadCwd, workspacePath)) {
    return shouldIncludeThreadEntry(thread);
  }
  if (!allowKnownCodexWithoutCwd || threadCwd.length > 0) {
    return false;
  }
  const threadId = asString(thread.id).trim();
  if (!threadId || !knownCodexThreadIds.has(threadId)) {
    return false;
  }
  return shouldIncludeThreadEntry(thread);
}

function toBooleanFlag(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes";
  }
  return false;
}

function isArchivedThread(thread: Record<string, unknown>): boolean {
  const archivedFlag = toBooleanFlag(thread.archived ?? thread.isArchived);
  if (archivedFlag) {
    return true;
  }
  return asNumber(thread.archivedAt ?? thread.archived_at) > 0;
}

function normalizeThreadMetaValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function resolveThreadSourceMeta(
  thread: Record<string, unknown>,
): Pick<
  ThreadSummary,
  "source" | "provider" | "sourceLabel" | "parentThreadId"
> {
  const source =
    normalizeThreadMetaValue(thread.source) ??
    normalizeThreadMetaValue(thread.sessionSource);
  const provider =
    normalizeThreadMetaValue(thread.provider) ??
    normalizeThreadMetaValue(thread.providerId) ??
    normalizeThreadMetaValue(thread.sessionProvider);
  const sourceLabel =
    normalizeThreadMetaValue(thread.sourceLabel) ??
    (source && provider ? `${source}/${provider}` : (source ?? provider));
  const parentThreadId =
    normalizeThreadMetaValue(thread.parentThreadId) ??
    normalizeThreadMetaValue(thread.parentSessionId) ??
    normalizeThreadMetaValue(thread.parent_thread_id) ??
    normalizeThreadMetaValue(thread.parent_session_id);
  return {
    source,
    provider,
    sourceLabel,
    ...(parentThreadId ? { parentThreadId } : {}),
  };
}

function shouldIncludeThreadEntry(thread: Record<string, unknown>): boolean {
  if (isArchivedThread(thread)) {
    return false;
  }
  if (normalizeThreadMetaValue(thread.nativeTitle)) {
    return true;
  }
  const previewCandidates = [
    asString(thread.preview).trim(),
    asString(thread.title).trim(),
    asString(thread.name).trim(),
  ].filter(Boolean);
  const isCodexHelperThread =
    hasCodexBackgroundHelperPreview(previewCandidates);
  if (isCodexHelperThread) {
    return false;
  }
  return true;
}

function parseCollabLinkDetail(detail: string, fallbackParentId: string) {
  const trimmed = detail.trim();
  if (!trimmed) {
    return null;
  }
  const hasUnicodeArrow = trimmed.includes("→");
  const hasAsciiArrow = !hasUnicodeArrow && trimmed.includes("->");
  if (!hasUnicodeArrow && !hasAsciiArrow) {
    return null;
  }
  const [leftSideRaw, rightSideRaw] = hasUnicodeArrow
    ? trimmed.split("→", 2)
    : trimmed.split("->", 2);
  const leftSide = (leftSideRaw ?? "").trim();
  const rightSide = (rightSideRaw ?? "").trim();
  const parentMatch = leftSide.match(/^From\s+(.+)$/i);
  const parentId = (parentMatch?.[1]?.trim() || fallbackParentId).trim();
  const childIds = rightSide
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!parentId || childIds.length === 0) {
    return null;
  }
  return { parentId, childIds };
}

export function restoreThreadParentLinksFromSnapshot(
  threadId: string,
  items: ConversationItem[],
  updateThreadParent?: (parentId: string, childIds: string[]) => void,
) {
  if (!updateThreadParent) {
    return;
  }
  items.forEach((item) => {
    if (item.kind !== "tool" || item.toolType !== "collabToolCall") {
      return;
    }
    const parsedLink = parseCollabLinkDetail(item.detail, threadId);
    if (!parsedLink) {
      return;
    }
    updateThreadParent(parsedLink.parentId, parsedLink.childIds);
  });
}

export function collectRelatedThreadIdsFromSnapshot(
  threadId: string,
  items: ConversationItem[],
) {
  const relatedThreadIds = new Set<string>();
  items.forEach((item) => {
    if (item.kind !== "tool" || item.toolType !== "collabToolCall") {
      return;
    }
    const parsedLink = parseCollabLinkDetail(item.detail, threadId);
    if (!parsedLink) {
      return;
    }
    parsedLink.childIds.forEach((childId) => {
      if (!childId || childId === threadId) {
        return;
      }
      relatedThreadIds.add(childId);
    });
  });
  return Array.from(relatedThreadIds);
}

export function isAskUserQuestionToolItem(
  item: ConversationItem,
): item is Extract<ConversationItem, { kind: "tool" }> {
  if (item.kind !== "tool") {
    return false;
  }
  const normalizedToolType =
    typeof item.toolType === "string" ? item.toolType.trim().toLowerCase() : "";
  if (
    normalizedToolType === "askuserquestion" ||
    normalizedToolType === "ask_user_question"
  ) {
    return true;
  }
  const normalizedTitle =
    typeof item.title === "string" ? item.title.trim().toLowerCase() : "";
  return (
    normalizedTitle.includes("askuserquestion") ||
    normalizedTitle.includes("ask_user_question")
  );
}

export function isTerminalToolStatus(status?: string) {
  if (!status) {
    return false;
  }
  const normalized = status.trim().toLowerCase();
  return /(complete|completed|success|succeed(?:ed)?|done|finish(?:ed)?|fail|error|cancel(?:led)?|abort|timeout|timed[_ -]?out)/.test(
    normalized,
  );
}

export function shouldReplaceUserInputQueueFromSnapshot(
  items: ConversationItem[],
  queueLength: number,
  hasLocalPendingQueue: boolean,
) {
  if (queueLength > 0) {
    return true;
  }
  const hasSubmittedRecord = items.some(
    (item) =>
      item.kind === "tool" && item.toolType === "requestUserInputSubmitted",
  );
  if (hasSubmittedRecord) {
    return true;
  }
  if (hasLocalPendingQueue) {
    return false;
  }
  return true;
}
