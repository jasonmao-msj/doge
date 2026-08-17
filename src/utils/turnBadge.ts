import type { EngineType } from "../types";

export type TurnBadgeSnapshot = {
  engine: EngineType;
  providerProfileId?: string | null;
  model?: string | null;
  reasoning?: { effort: string } | null;
  providerProfileNameSnapshot?: string | null;
  providerProfileSource?: string | null;
};

export type TurnBadgeUnavailableReason =
  | "provider-deleted"
  | "provider-missing"
  | "runtime-missing";

export type TurnBadgeModel = {
  engine: EngineType;
  engineLabel: string;
  providerLabel: string;
  modelLabel: string | null;
  reasoningLabel: string | null;
  unavailable: boolean;
  unavailableReason: TurnBadgeUnavailableReason | null;
};

export type TurnBadgeAvailability = {
  providerExists: boolean;
  providerAvailable: boolean;
  runtimeAvailable: boolean;
};

const FULLY_AVAILABLE: TurnBadgeAvailability = {
  providerExists: true,
  providerAvailable: true,
  runtimeAvailable: true,
};

export const LOCAL_PROVIDER_LABEL = "本地配置";
export const LOCAL_PROVIDER_SOURCE = "disk";

function resolveEngineLabel(engine: EngineType): string {
  switch (engine) {
    case "claude":
      return "Claude";
    case "codex":
      return "Codex";
    case "kimi":
      return "Kimi";
    case "gemini":
      return "Gemini";
    case "grok":
      return "Grok";
    case "opencode":
      return "OpenCode";
  }
}

export function resolveSnapshotProviderLabel(
  snapshot: TurnBadgeSnapshot,
): string {
  const name = snapshot.providerProfileNameSnapshot?.trim();
  if (name) {
    return name;
  }
  const id = snapshot.providerProfileId?.trim();
  if (id) {
    return id;
  }
  return snapshot.providerProfileSource?.trim() === "disk" ||
    snapshot.providerProfileSource?.trim() === "local"
    ? LOCAL_PROVIDER_LABEL
    : "历史配置未知";
}

export function resolveTurnBadge(
  snapshot: TurnBadgeSnapshot,
  availability: TurnBadgeAvailability = FULLY_AVAILABLE,
): TurnBadgeModel {
  let unavailableReason: TurnBadgeUnavailableReason | null = null;
  if (!availability.providerExists) {
    unavailableReason = "provider-deleted";
  } else if (!availability.providerAvailable) {
    unavailableReason = "provider-missing";
  } else if (!availability.runtimeAvailable) {
    unavailableReason = "runtime-missing";
  }

  return {
    engine: snapshot.engine,
    engineLabel: resolveEngineLabel(snapshot.engine),
    providerLabel: resolveSnapshotProviderLabel(snapshot),
    modelLabel: snapshot.model?.trim() || null,
    reasoningLabel: snapshot.reasoning?.effort?.trim() || null,
    unavailable: unavailableReason !== null,
    unavailableReason,
  };
}

/**
 * Stable comparison key for consecutive turn-target badge dedupe.
 * Intentionally uses identity fields only (not display labels).
 */
export function buildTurnTargetBadgeKey(
  snapshot: TurnBadgeSnapshot,
): string {
  const providerId = snapshot.providerProfileId?.trim() || "";
  const providerSource = snapshot.providerProfileSource?.trim() || "";
  const providerName = snapshot.providerProfileNameSnapshot?.trim() || "";
  const model = snapshot.model?.trim() || "";
  const reasoning = snapshot.reasoning?.effort?.trim() || "";
  return [
    snapshot.engine,
    providerId,
    providerSource,
    providerName,
    model,
    reasoning,
  ].join("\u0001");
}

type TurnTargetBadgeVisibilityItem = {
  id: string;
  kind: string;
  role?: "user" | "assistant";
  executionTargetSnapshot?: TurnBadgeSnapshot | null;
};

/**
 * Decide which assistant items should render the turn-target badge.
 *
 * Policy B (per user turn + target change):
 * - Show on the first assistant message that carries a snapshot after each user message
 *   (or at conversation start).
 * - Within the same user turn, hide consecutive assistants with an identical target key.
 * - Re-show when the target key changes mid-turn.
 */
export function buildTurnTargetBadgeVisibleItemIds(
  items: readonly TurnTargetBadgeVisibilityItem[],
): Set<string> {
  const visibleIds = new Set<string>();
  let seenAssistantWithBadgeSinceUser = false;
  let previousTargetKey: string | null = null;

  for (const item of items) {
    if (item.kind === "message" && item.role === "user") {
      seenAssistantWithBadgeSinceUser = false;
      continue;
    }

    if (item.kind !== "message" || item.role !== "assistant") {
      continue;
    }

    const snapshot = item.executionTargetSnapshot;
    if (!snapshot) {
      continue;
    }

    const targetKey = buildTurnTargetBadgeKey(snapshot);
    const shouldShow =
      !seenAssistantWithBadgeSinceUser ||
      previousTargetKey === null ||
      targetKey !== previousTargetKey;

    if (shouldShow) {
      visibleIds.add(item.id);
    }

    seenAssistantWithBadgeSinceUser = true;
    previousTargetKey = targetKey;
  }

  return visibleIds;
}
