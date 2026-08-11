import {
  PERSONA_AUTHOR_POOL,
  PERSONA_FALLBACK_NAME,
  resolveGithubAvatarUrl,
  resolveGithubProfileUrl,
  type PersonaAuthorEntry,
} from "../constants/personaAuthorPool";
import { resolveLocalPersonaAvatarSrc } from "../constants/personaAvatarAssets";

export type AssignedPersona = {
  name: string;
  githubLogin: string | null;
  githubProfileUrl: string | null;
  /** 优先本地打包图，其次 GitHub CDN */
  avatarSrc: string | null;
};

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function totalWeight(pool: readonly PersonaAuthorEntry[]): number {
  return pool.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
}

function toAssignedPersona(entry: PersonaAuthorEntry | null | undefined): AssignedPersona {
  const name = entry?.name?.trim() || PERSONA_FALLBACK_NAME;
  const githubLogin = entry?.githubLogin?.trim() || null;
  const local = resolveLocalPersonaAvatarSrc(entry?.avatarKey);
  const remote = resolveGithubAvatarUrl(githubLogin, 96);
  return {
    name,
    githubLogin,
    githubProfileUrl: resolveGithubProfileUrl(githubLogin),
    avatarSrc: local ?? remote,
  };
}

function pickEntry(
  agentId: string,
  cycleOffset: number,
  pool: readonly PersonaAuthorEntry[],
): PersonaAuthorEntry | null {
  if (pool.length === 0) {
    return null;
  }
  const weightSum = totalWeight(pool);
  if (weightSum <= 0) {
    const index = (hashString(agentId) + cycleOffset) % pool.length;
    return pool[index] ?? null;
  }

  const target = hashString(agentId) % weightSum;
  let cursor = 0;
  let pickedIndex = 0;
  for (let i = 0; i < pool.length; i += 1) {
    cursor += Math.max(0, pool[i]?.weight ?? 0);
    if (target < cursor) {
      pickedIndex = i;
      break;
    }
  }

  const finalIndex = (pickedIndex + Math.max(0, cycleOffset)) % pool.length;
  return pool[finalIndex] ?? null;
}

/**
 * 按 agentId 确定性加权挑选作者。同一 agentId 永远同一 persona。
 * 循环复用：squad 内第 k 个可用 cycleOffset。
 */
export function assignPersona(
  agentId: string,
  cycleOffset = 0,
  pool: readonly PersonaAuthorEntry[] = PERSONA_AUTHOR_POOL,
): AssignedPersona {
  return toAssignedPersona(pickEntry(agentId, cycleOffset, pool));
}

/** @deprecated 兼容旧调用，等同 assignPersona(...).name */
export function assignPersonaName(
  agentId: string,
  cycleOffset = 0,
  pool: readonly PersonaAuthorEntry[] = PERSONA_AUTHOR_POOL,
): string {
  return assignPersona(agentId, cycleOffset, pool).name;
}

/**
 * 为一组 agentId 分配 persona：
 * - 单 id 稳定（hash）
 * - 同批内尽量不重名：偏移直到未用过的作者；池用尽后才允许复用
 */
export function assignPersonasForSquad(
  agentIds: readonly string[],
  pool: readonly PersonaAuthorEntry[] = PERSONA_AUTHOR_POOL,
): AssignedPersona[] {
  const usedNames = new Set<string>();
  return agentIds.map((agentId) => {
    const picked = assignPersona(agentId, 0, pool);
    if (!usedNames.has(picked.name)) {
      usedNames.add(picked.name);
      return picked;
    }
    const maxProbe = Math.max(pool.length, 1);
    for (let offset = 1; offset < maxProbe; offset += 1) {
      const candidate = assignPersona(agentId, offset, pool);
      if (!usedNames.has(candidate.name)) {
        usedNames.add(candidate.name);
        return candidate;
      }
    }
    // 池已用尽：允许复用，仍保持确定性
    usedNames.add(picked.name);
    return picked;
  });
}

/** @deprecated 兼容旧调用 */
export function assignPersonaNamesForSquad(
  agentIds: readonly string[],
  pool: readonly PersonaAuthorEntry[] = PERSONA_AUTHOR_POOL,
): string[] {
  return assignPersonasForSquad(agentIds, pool).map((entry) => entry.name);
}
