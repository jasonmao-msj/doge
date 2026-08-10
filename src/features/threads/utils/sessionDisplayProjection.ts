import type { ThreadSummary } from "../../../types";
import {
  classifyContextProtocolText,
  isDogeProgramControlTitle,
} from "../../../utils/contextProtocol";

const GENERIC_SESSION_TITLE_PATTERN =
  /^(codex session|claude session|gemini session|opencode session)$/i;
const ORDINAL_AGENT_TITLE_PATTERN = /^agent\s+\d+$/i;
const SHORT_HEX_TITLE_PATTERN = /^[a-f0-9]{4,8}$/i;
// 历史遗留:斜杠命令原始记录曾被直接剪成标题(如 "<command-m"),视为无效标题
const COMMAND_TAG_TITLE_PATTERN = /^<(?:command-|local-command-)/i;

type SessionDisplayTitleStrength = 0 | 1 | 2;

export type SessionDisplayTitleSources = {
  mappedTitle?: string;
  customTitle?: string;
  nativeTitle?: string;
};

export function normalizeSessionDisplayTitle(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isWeakSessionDisplayTitle(value: string | null | undefined): boolean {
  return getSessionDisplayTitleStrength(value) < 2;
}

function getSessionDisplayTitleStrength(
  value: string | null | undefined,
): SessionDisplayTitleStrength {
  const normalized = normalizeSessionDisplayTitle(value);
  if (
    !normalized
    || ORDINAL_AGENT_TITLE_PATTERN.test(normalized)
    || SHORT_HEX_TITLE_PATTERN.test(normalized)
    || COMMAND_TAG_TITLE_PATTERN.test(normalized)
    || isDogeProgramControlTitle(normalized)
    || classifyContextProtocolText(normalized) !== null
  ) {
    return 0;
  }
  if (GENERIC_SESSION_TITLE_PATTERN.test(normalized)) {
    return 1;
  }
  return 2;
}

export function selectProjectedSessionDisplayName(
  params: {
    previous?: ThreadSummary;
    nextName: string;
  } & SessionDisplayTitleSources,
): string {
  // Central title resolver: explicit user naming wins over mapped/native
  // evidence, and weak fallbacks cannot erase a meaningful previous title.
  const customTitle = normalizeSessionDisplayTitle(params.customTitle);
  if (customTitle) {
    return customTitle;
  }

  const rawMappedTitle = normalizeSessionDisplayTitle(params.mappedTitle);
  // 丢弃 control-plane mapped title（含截断后的 MOSSX_* 半截）
  const mappedTitle =
    !isDogeProgramControlTitle(rawMappedTitle) &&
    classifyContextProtocolText(rawMappedTitle) === null
      ? rawMappedTitle
      : "";
  if (mappedTitle) {
    return mappedTitle;
  }

  const nativeTitle = normalizeSessionDisplayTitle(params.nativeTitle);
  if (nativeTitle) {
    return nativeTitle;
  }

  const nextName = normalizeSessionDisplayTitle(params.nextName);
  if (
    params.previous &&
    getSessionDisplayTitleStrength(params.previous.name) >
      getSessionDisplayTitleStrength(nextName)
  ) {
    return params.previous.name;
  }

  return nextName;
}

export function mergeSessionDisplaySummary(
  previous: ThreadSummary | undefined,
  next: ThreadSummary,
  options: SessionDisplayTitleSources = {},
): ThreadSummary {
  if (!previous || previous.id !== next.id) {
    const projectedName = selectProjectedSessionDisplayName({
      nextName: next.name,
      mappedTitle: options.mappedTitle,
      customTitle: options.customTitle,
      nativeTitle: options.nativeTitle,
    });
    return projectedName === next.name ? next : { ...next, name: projectedName };
  }

  const engineSource = next.engineSource ?? previous.engineSource;
  return {
    ...previous,
    ...next,
    engineSource,
    name: selectProjectedSessionDisplayName({
      previous,
      nextName: next.name,
      mappedTitle: options.mappedTitle,
      customTitle: options.customTitle,
      nativeTitle: options.nativeTitle,
    }),
    parentThreadId: next.parentThreadId ?? previous.parentThreadId ?? null,
    folderId: next.folderId ?? previous.folderId ?? null,
    autoSession: next.autoSession ?? previous.autoSession ?? null,
  };
}

export function projectSessionDisplaySummaries(params: {
  baseSummaries: ThreadSummary[];
  candidateSummaries: ThreadSummary[];
  excludedThreadIds?: ReadonlySet<string>;
  canRetainCandidate?: (summary: ThreadSummary) => boolean;
  mergeOlderCandidates?: boolean;
}): ThreadSummary[] {
  const {
    baseSummaries,
    candidateSummaries,
    excludedThreadIds = new Set<string>(),
    canRetainCandidate = () => true,
    mergeOlderCandidates = false,
  } = params;
  const mergedById = new Map<string, ThreadSummary>();
  baseSummaries.forEach((entry) => {
    if (!excludedThreadIds.has(entry.id)) {
      mergedById.set(entry.id, entry);
    }
  });

  candidateSummaries.forEach((candidate) => {
    if (excludedThreadIds.has(candidate.id) || !canRetainCandidate(candidate)) {
      return;
    }
    const previous = mergedById.get(candidate.id);
    if (previous && candidate.updatedAt < previous.updatedAt) {
      if (!mergeOlderCandidates) {
        return;
      }
      mergedById.set(candidate.id, mergeSessionDisplaySummary(candidate, previous));
      return;
    }
    mergedById.set(candidate.id, mergeSessionDisplaySummary(previous, candidate));
  });

  return Array.from(mergedById.values()).sort(
    (left, right) => right.updatedAt - left.updatedAt,
  );
}
