import { useSyncExternalStore } from "react";

import {
  normalizeAgentProjection,
  type AgentProjectionV1,
} from "../types";
import { emitMultiAgentConversationItems } from "../runtime/conversationBridge";

type ScopeKey = string;

const projections = new Map<ScopeKey, AgentProjectionV1 | null>();
/** 同会话历史轮（不含当前 active projection） */
const historyByScope = new Map<ScopeKey, AgentProjectionV1[]>();
/**
 * getAgentRoundList 快照缓存：useSyncExternalStore 要求 getSnapshot 在无变更时返回
 * **同一引用**，否则会触发 Maximum update depth（native / 未开协作也会炸）。
 */
const roundListCache = new Map<ScopeKey, AgentProjectionV1[]>();
const EMPTY_ROUNDS: AgentProjectionV1[] = [];
const evidenceByScope = new Map<ScopeKey, string>();
const attemptIds = new Set<string>();
type AttemptOwner = {
  workspaceId: string;
  threadId: string;
  phase: string;
  bindingKey?: string;
};
const attemptOwners = new Map<string, AttemptOwner>();
const ownersByBindingKey = new Map<string, AttemptOwner & { attemptId: string }>();
const listeners = new Set<() => void>();
const evidenceListeners = new Set<() => void>();

const MAX_PROJECTIONS = 256;
const MAX_HISTORY_PER_SCOPE = 12;
const MAX_ATTEMPTS = 4096;

function invalidateRoundListCache(key: ScopeKey): void {
  roundListCache.delete(key);
}

function buildRoundList(key: ScopeKey): AgentProjectionV1[] {
  const history = historyByScope.get(key);
  const current = projections.get(key) ?? null;
  if (!current) {
    if (!history || history.length === 0) return EMPTY_ROUNDS;
    return history;
  }
  if (!history || history.length === 0) {
    return [current];
  }
  if (history.some((item) => item.runId === current.runId)) {
    return history.map((item) =>
      item.runId === current.runId ? current : item,
    );
  }
  return [...history, current];
}

function scopeKey(workspaceId: string, threadId: string): ScopeKey {
  return `${workspaceId}\u0000${threadId}`;
}

function emit(set: Set<() => void>): void {
  for (const listener of set) listener();
}

export type PublishAgentProjectionOptions = {
  /** 只更新 store，不写主幕 user/fold（hydrate 批量时用） */
  skipCanvasEmit?: boolean;
  /** 跳过 listener 通知（批量末尾再统一 notify） */
  skipNotify?: boolean;
};

function projectionCanvasFingerprint(p: AgentProjectionV1): string {
  const stages = (p.stages ?? [])
    .map(
      (s) =>
        `${s.id}:${s.status}:${s.shortOutcome?.length ?? 0}:${s.fullOutcome?.length ?? 0}`,
    )
    .join("|");
  return `${p.runId}|${p.status}|${p.planRevision}|${p.approvedAt ?? ""}|${stages}|${p.finalSummary?.length ?? 0}|${p.plan?.summary?.length ?? 0}`;
}

export function publishAgentProjection(
  workspaceId: string,
  threadId: string,
  projection: AgentProjectionV1 | null,
  options?: PublishAgentProjectionOptions,
): void {
  const key = scopeKey(workspaceId, threadId);
  const normalized = normalizeAgentProjection(projection);
  const previous = projections.get(key) ?? null;
  if (normalized) {
    // 新 run 顶替旧 run：把终态旧轮推进历史（须在 set/emit 前完成）
    if (
      previous &&
      previous.runId !== normalized.runId &&
      (previous.status === "succeeded" ||
        previous.status === "failed" ||
        previous.status === "cancelled")
    ) {
      const hist = historyByScope.get(key) ?? [];
      if (!hist.some((item) => item.runId === previous.runId)) {
        historyByScope.set(
          key,
          [...hist, previous].slice(-MAX_HISTORY_PER_SCOPE),
        );
      }
    }
    // 先写入 current projection，再算 roundIndex / emit，避免新轮仍读到旧 current
    const sameFingerprint =
      Boolean(previous) &&
      previous!.runId === normalized.runId &&
      projectionCanvasFingerprint(previous!) ===
        projectionCanvasFingerprint(normalized);
    projections.set(key, normalized);
    invalidateRoundListCache(key);
    evidenceByScope.set(key, normalized.runId);
    // 指纹相同：不写时间线（bridge 内部也会跳过同 text fold），减阶段切换卡顿
    if (!options?.skipCanvasEmit && !sameFingerprint) {
      emitMultiAgentConversationItems(workspaceId, threadId, normalized);
    }
    for (const attemptId of normalized.activeAttemptIds ?? []) {
      rememberAttempt(attemptId);
    }
    for (const stage of normalized.stages ?? []) {
      if (stage.attemptId) {
        rememberAttempt(stage.attemptId, {
          workspaceId,
          threadId,
          phase: stage.id,
          bindingKey: stage.bindingKey ?? undefined,
        });
      }
    }
  } else {
    if (!projections.has(key)) {
      return;
    }
    projections.set(key, normalized);
    invalidateRoundListCache(key);
  }
  while (projections.size > MAX_PROJECTIONS) {
    const oldest = projections.keys().next().value;
    if (!oldest) break;
    projections.delete(oldest);
    invalidateRoundListCache(oldest);
  }
  if (!options?.skipNotify) {
    emit(listeners);
    emit(evidenceListeners);
  }
}

/** hydrate 批量结束后统一唤醒订阅方 */
export function flushAgentProjectionNotify(): void {
  emit(listeners);
  emit(evidenceListeners);
}

export function getAgentRunHistory(
  workspaceId: string | null | undefined,
  threadId: string | null | undefined,
): AgentProjectionV1[] {
  if (!workspaceId || !threadId) return EMPTY_ROUNDS;
  return historyByScope.get(scopeKey(workspaceId, threadId)) ?? EMPTY_ROUNDS;
}

/** 当前 + 历史，按时间升序（第一轮…最新轮）。引用在无变更时保持稳定。 */
export function getAgentRoundList(
  workspaceId: string | null | undefined,
  threadId: string | null | undefined,
): AgentProjectionV1[] {
  if (!workspaceId || !threadId) return EMPTY_ROUNDS;
  const key = scopeKey(workspaceId, threadId);
  const cached = roundListCache.get(key);
  if (cached) return cached;
  const next = buildRoundList(key);
  roundListCache.set(key, next);
  return next;
}

export function useAgentRoundList(
  workspaceId: string | null | undefined,
  threadId: string | null | undefined,
): AgentProjectionV1[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => getAgentRoundList(workspaceId, threadId),
    () => EMPTY_ROUNDS,
  );
}

export function getAgentProjectionByRunId(
  workspaceId: string | null | undefined,
  threadId: string | null | undefined,
  runId: string | null | undefined,
): AgentProjectionV1 | null {
  if (!workspaceId || !threadId || !runId) return null;
  const rounds = getAgentRoundList(workspaceId, threadId);
  return rounds.find((item) => item.runId === runId) ?? null;
}

function rememberAttempt(
  attemptId: string,
  owner?: AttemptOwner,
): void {
  const normalized = attemptId.trim();
  if (!normalized) return;
  attemptIds.delete(normalized);
  attemptIds.add(normalized);
  if (owner) {
    attemptOwners.set(normalized, owner);
    const binding = owner.bindingKey?.trim();
    if (binding) {
      ownersByBindingKey.set(binding, { ...owner, attemptId: normalized });
    }
  }
  while (attemptIds.size > MAX_ATTEMPTS) {
    const oldest = attemptIds.values().next().value;
    if (!oldest) break;
    const stale = attemptOwners.get(oldest);
    attemptIds.delete(oldest);
    attemptOwners.delete(oldest);
    if (stale?.bindingKey) ownersByBindingKey.delete(stale.bindingKey);
  }
}

export function registerAgentAttempt(
  attemptId: string,
  owner?: AttemptOwner,
): void {
  rememberAttempt(attemptId, owner);
}

export function isAgentAttempt(attemptId: string | null | undefined): boolean {
  return Boolean(attemptId && attemptIds.has(attemptId));
}

export function getAgentAttemptOwner(
  attemptId: string | null | undefined,
): AttemptOwner | null {
  if (!attemptId) return null;
  return attemptOwners.get(attemptId) ?? null;
}

export function resolveAgentAttemptOwner(input: {
  attemptId?: string | null;
  bindingKey?: string | null;
}): (AttemptOwner & { attemptId: string }) | null {
  const byAttempt = input.attemptId
    ? attemptOwners.get(input.attemptId)
    : null;
  if (byAttempt && input.attemptId) {
    return { ...byAttempt, attemptId: input.attemptId };
  }
  const binding = input.bindingKey?.trim();
  if (binding) {
    return ownersByBindingKey.get(binding) ?? null;
  }
  return null;
}

export function getAgentProjection(
  workspaceId: string | null | undefined,
  threadId: string | null | undefined,
): AgentProjectionV1 | null {
  if (!workspaceId || !threadId) return null;
  return projections.get(scopeKey(workspaceId, threadId)) ?? null;
}

export function useAgentProjection(
  workspaceId: string | null | undefined,
  threadId: string | null | undefined,
): AgentProjectionV1 | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => getAgentProjection(workspaceId, threadId),
    () => null,
  );
}

export function getAgentEvidenceRunId(
  workspaceId: string | null | undefined,
  threadId: string | null | undefined,
): string | null {
  if (!workspaceId || !threadId) return null;
  return evidenceByScope.get(scopeKey(workspaceId, threadId)) ?? null;
}

export function useAgentEvidenceRunId(
  workspaceId: string | null | undefined,
  threadId: string | null | undefined,
): string | null {
  return useSyncExternalStore(
    (listener) => {
      evidenceListeners.add(listener);
      return () => evidenceListeners.delete(listener);
    },
    () => getAgentEvidenceRunId(workspaceId, threadId),
    () => null,
  );
}

export function claimAgentHydration(
  workspaceId: string,
  threadId: string,
  expectedRunId: string,
): boolean {
  const evidence = evidenceByScope.get(scopeKey(workspaceId, threadId));
  return evidence === expectedRunId;
}

export function registerAgentConversationEvidence(
  workspaceId: string,
  threadId: string,
  runId: string,
): void {
  const key = scopeKey(workspaceId, threadId);
  evidenceByScope.set(key, runId);
  emit(evidenceListeners);
}

export function findCanonicalAgentRunId(items: unknown): string | null {
  if (!Array.isArray(items)) return null;
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as {
      id?: unknown;
      content?: unknown;
      fidelity?: unknown;
    };
    if (row.fidelity !== "canonical") continue;
    const content =
      row.content && typeof row.content === "object"
        ? (row.content as Record<string, unknown>)
        : null;
    if (!content) continue;
    const runId =
      typeof content.squadRunId === "string"
        ? content.squadRunId.trim()
        : typeof content.agentRunId === "string"
          ? content.agentRunId.trim()
          : "";
    if (!runId) continue;
    const turnId =
      typeof content.turnId === "string" ? content.turnId.trim() : "";
    if (turnId !== `squad:${runId}` && turnId !== `agent:${runId}`) continue;
    return runId;
  }
  return null;
}
