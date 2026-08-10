import {
  getClientStoreSync,
  writeClientStoreValue,
} from "../../services/clientStorage";
import type { SessionActivityEvent } from "../session-activity/types";
import {
  QUICK_SWITCHER_RECENT_LIMIT,
  type QuickSwitcherRecentFile,
  type QuickSwitcherRecentFileGroup,
  type QuickSwitcherRecentFileSource,
} from "./types";

const STORAGE_KEY = "doge.quickSwitcher.recentFilesByWorkspace";
export const QUICK_SWITCHER_RECENT_FILES_CHANGED =
  "doge:quick-switcher-recent-files-changed";

export type RecentFilesByWorkspace = Record<string, QuickSwitcherRecentFile[]>;

export type RecentFileMutation =
  | {
      kind: "upsert";
      workspaceId: string;
      path: string;
      touchedAt: number;
      source: QuickSwitcherRecentFileSource;
    }
  | { kind: "remove"; workspaceId: string; path: string; touchedAt: number };

function normalizeRecentPath(path: string): string {
  return path.trim().replaceAll("\\", "/").replace(/^\.\//, "");
}

function isPlausibleAiRecentFilePath(path: string): boolean {
  const normalized = normalizeRecentPath(path);
  if (!normalized || normalized.length > 4096) {
    return false;
  }
  if (
    /[\n\r]|\|\||&&|[|;<>`]|\$\(/.test(normalized) ||
    /(?:^|\s)\/(?:dev|proc|sys)(?:\/|$)/i.test(normalized) ||
    /(?:^|\s)(?:null|true|false)(?:\s|$)/i.test(normalized) ||
    /(?:^|\s)(?:cat|grep|rg|find|head|tail|sed|awk|xargs|tee|wc|less|more|printf|echo)\s+(?:-|\/)/i.test(
      normalized,
    )
  ) {
    return false;
  }
  const fileName = normalized.slice(normalized.lastIndexOf("/") + 1);
  return (
    normalized.includes("/") ||
    fileName.includes(".") ||
    /^(?:README|LICENSE|Makefile|Dockerfile|Procfile)$/i.test(fileName)
  );
}

function isRecentFile(value: unknown): value is QuickSwitcherRecentFile {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<QuickSwitcherRecentFile>;
  return (
    typeof candidate.workspaceId === "string" &&
    typeof candidate.path === "string" &&
    typeof candidate.touchedAt === "number" &&
    Number.isFinite(candidate.touchedAt) &&
    (candidate.source === "opened" || candidate.source === "ai-modified")
  );
}

export function normalizeStoredRecentFiles(
  stored: unknown,
): RecentFilesByWorkspace {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(stored).flatMap(([workspaceId, entries]) => {
      if (!Array.isArray(entries)) {
        return [];
      }
      const normalized = entries
        .filter(isRecentFile)
        .map((entry) => ({ ...entry, path: normalizeRecentPath(entry.path) }))
        .filter(
          (entry) =>
            entry.workspaceId === workspaceId &&
            entry.path &&
            (entry.source === "opened" ||
              isPlausibleAiRecentFilePath(entry.path)),
        )
        .sort((left, right) => right.touchedAt - left.touchedAt)
        .filter(
          (entry, index, files) =>
            files.findIndex((candidate) => candidate.path === entry.path) === index,
        )
        .slice(0, QUICK_SWITCHER_RECENT_LIMIT);
      return normalized.length ? [[workspaceId, normalized]] : [];
    }),
  );
}

export function getQuickSwitcherRecentFilesSnapshot(): RecentFilesByWorkspace {
  return normalizeStoredRecentFiles(
    getClientStoreSync<unknown>("app", STORAGE_KEY),
  );
}

export function getQuickSwitcherRecentFiles(
  workspaceId: string | null | undefined,
): QuickSwitcherRecentFile[] {
  if (!workspaceId) {
    return [];
  }
  return getQuickSwitcherRecentFilesSnapshot()[workspaceId] ?? [];
}

export function projectQuickSwitcherRecentFileGroups(
  recentFilesByWorkspace: RecentFilesByWorkspace,
  workspaces: Array<{ id: string; name: string }>,
): QuickSwitcherRecentFileGroup[] {
  const workspaceNames = new Map(
    workspaces.map((workspace) => [workspace.id, workspace.name]),
  );
  const files = Object.values(recentFilesByWorkspace)
    .flat()
    .filter((file) => workspaceNames.has(file.workspaceId))
    .sort((left, right) => right.touchedAt - left.touchedAt)
    .slice(0, QUICK_SWITCHER_RECENT_LIMIT);
  const groups = new Map<string, QuickSwitcherRecentFileGroup>();
  for (const file of files) {
    const group = groups.get(file.workspaceId);
    if (group) {
      group.files.push(file);
      continue;
    }
    groups.set(file.workspaceId, {
      workspaceId: file.workspaceId,
      workspaceName: workspaceNames.get(file.workspaceId) ?? file.workspaceId,
      latestAt: file.touchedAt,
      files: [file],
    });
  }
  return [...groups.values()];
}

export function applyRecentFileMutations(
  current: RecentFilesByWorkspace,
  mutations: RecentFileMutation[],
): RecentFilesByWorkspace {
  let next = current;
  for (const mutation of mutations) {
    const path = normalizeRecentPath(mutation.path);
    if (
      !mutation.workspaceId ||
      !path ||
      (mutation.kind === "upsert" &&
        mutation.source === "ai-modified" &&
        !isPlausibleAiRecentFilePath(path))
    ) {
      continue;
    }
    const existing = next[mutation.workspaceId] ?? [];
    const currentEntry = existing.find((entry) => entry.path === path);
    if (currentEntry && currentEntry.touchedAt > mutation.touchedAt) {
      continue;
    }
    const withoutTarget = existing.filter((entry) => entry.path !== path);
    const files =
      mutation.kind === "remove"
        ? withoutTarget
        : [
            {
              workspaceId: mutation.workspaceId,
              path,
              touchedAt: mutation.touchedAt,
              source: mutation.source,
              ...(mutation.source === "ai-modified"
                ? { aiModifiedAt: mutation.touchedAt }
                : currentEntry?.aiModifiedAt
                  ? { aiModifiedAt: currentEntry.aiModifiedAt }
                  : {}),
            },
            ...withoutTarget,
          ]
            .sort((left, right) => right.touchedAt - left.touchedAt)
            .slice(0, QUICK_SWITCHER_RECENT_LIMIT);
    next = { ...next, [mutation.workspaceId]: files };
  }
  return next;
}

function persistMutations(mutations: RecentFileMutation[]): void {
  if (!mutations.length) {
    return;
  }
  const current = getQuickSwitcherRecentFilesSnapshot();
  const next = applyRecentFileMutations(current, mutations);
  if (JSON.stringify(current) === JSON.stringify(next)) {
    return;
  }
  writeClientStoreValue("app", STORAGE_KEY, next);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(QUICK_SWITCHER_RECENT_FILES_CHANGED));
  }
}

export function recordQuickSwitcherFileOpened(input: {
  workspaceId: string | null | undefined;
  path: string;
  touchedAt?: number;
}): void {
  if (!input.workspaceId) {
    return;
  }
  persistMutations([
    {
      kind: "upsert",
      workspaceId: input.workspaceId,
      path: input.path,
      touchedAt: input.touchedAt ?? Date.now(),
      source: "opened",
    },
  ]);
}

export function collectAiFileMutations(
  workspaceId: string | null | undefined,
  timeline: SessionActivityEvent[],
): RecentFileMutation[] {
  if (!workspaceId) {
    return [];
  }
  return timeline
    .filter(
      (event) => event.kind === "fileChange" && event.status === "completed",
    )
    .sort((left, right) => left.occurredAt - right.occurredAt)
    .flatMap((event) => {
      const changes = event.fileChanges?.length
        ? event.fileChanges
        : event.filePath && event.fileChangeStatusLetter
          ? [
              {
                filePath: event.filePath,
                statusLetter: event.fileChangeStatusLetter,
              },
            ]
          : [];
      return changes.flatMap((change): RecentFileMutation[] => {
        const path = normalizeRecentPath(change.filePath);
        if (!isPlausibleAiRecentFilePath(path)) {
          return [];
        }
        return [
          change.statusLetter === "D"
            ? {
                kind: "remove",
                workspaceId,
                path,
                touchedAt: event.occurredAt,
              }
            : {
                kind: "upsert",
                workspaceId,
                path,
                touchedAt: event.occurredAt,
                source: "ai-modified",
              },
        ];
      });
    });
}

export function recordQuickSwitcherAiFileChanges(
  workspaceId: string | null | undefined,
  timeline: SessionActivityEvent[],
): void {
  persistMutations(collectAiFileMutations(workspaceId, timeline));
}
