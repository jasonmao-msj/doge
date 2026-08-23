import type { ModelInfo, ProviderId } from "../types";

type RankedModel = {
  model: ModelInfo;
  originalIndex: number;
  native: boolean;
  version: number[] | null;
  tierRank: number;
};

const CODEX_GPT_MODEL_PATTERN = /^gpt-(\d+(?:\.\d+)*)(?:-([a-z0-9.-]+))?$/i;
const CLAUDE_MODEL_PATTERN =
  /^claude-(fable|opus|sonnet|haiku)-(\d+(?:[-.]\d+)*)/i;
const CODEX_TIER_RANK: Readonly<Record<string, number>> = {
  sol: 0,
  terra: 1,
  luna: 2,
  "": 3,
};
const CLAUDE_TIER_RANK: Readonly<Record<string, number>> = {
  fable: 0,
  opus: 1,
  sonnet: 2,
  haiku: 3,
};

function parseCodexGptIdentity(model: ModelInfo): {
  version: number[];
  tierRank: number;
} | null {
  const identities = [model.model, model.id];
  for (const identity of identities) {
    const match = identity?.trim().match(CODEX_GPT_MODEL_PATTERN);
    if (!match) {
      continue;
    }
    return {
      version: match[1].split(".").map(Number),
      tierRank: CODEX_TIER_RANK[match[2]?.toLowerCase() ?? ""] ?? 4,
    };
  }
  return null;
}

function parseClaudeIdentity(model: ModelInfo): {
  version: number[];
  tierRank: number;
} | null {
  const identities = [model.id, model.model];
  for (const identity of identities) {
    const match = identity?.trim().match(CLAUDE_MODEL_PATTERN);
    if (!match) {
      continue;
    }
    return {
      version: match[2].split(/[-.]/).map(Number),
      tierRank: CLAUDE_TIER_RANK[match[1].toLowerCase()],
    };
  }
  return null;
}

function compareVersionsDescending(left: number[], right: number[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (right[index] ?? 0) - (left[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function rankModel(
  providerId: ProviderId,
  model: ModelInfo,
  originalIndex: number,
): RankedModel {
  const nativeIdentity =
    providerId === "codex"
      ? parseCodexGptIdentity(model)
      : parseClaudeIdentity(model);
  return {
    model,
    originalIndex,
    native: nativeIdentity !== null,
    version: nativeIdentity?.version ?? null,
    tierRank: nativeIdentity?.tierRank ?? Number.MAX_SAFE_INTEGER,
  };
}

export function orderProviderModelsForDisplay(
  providerId: ProviderId,
  models: readonly ModelInfo[],
): ModelInfo[] {
  if (
    (providerId !== "codex" && providerId !== "claude") ||
    models.length < 2
  ) {
    return Array.from(models);
  }

  return models
    .map((model, index) => rankModel(providerId, model, index))
    .sort((left, right) => {
      if (left.native && !right.native) {
        return -1;
      }
      if (!left.native && right.native) {
        return 1;
      }
      if (!left.native || !right.native || !left.version || !right.version) {
        return left.originalIndex - right.originalIndex;
      }

      const tierOrder = left.tierRank - right.tierRank;
      const versionOrder = compareVersionsDescending(
        left.version,
        right.version,
      );
      const semanticOrder =
        providerId === "codex"
          ? versionOrder || tierOrder
          : tierOrder || versionOrder;
      return semanticOrder || left.originalIndex - right.originalIndex;
    })
    .map(({ model }) => model);
}
