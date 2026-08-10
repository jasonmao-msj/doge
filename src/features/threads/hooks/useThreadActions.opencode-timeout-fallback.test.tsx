// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationItem, ThreadSummary } from "../../../types";
import {
  connectWorkspace,
  createWorkspaceDirectory,
  getOpenCodeSessionList,
  listClaudeSessions,
  listGeminiSessions,
  listThreadTitles,
  listThreads,
  listWorkspaceSessions,
  renameThreadTitleKey,
  setThreadTitle,
} from "../../../services/tauri";
import { listSharedSessions } from "../../shared-session/services/sharedSessions";
import {
  getThreadTimestamp,
  mergeThreadItems,
  previewThreadName,
} from "../../../utils/threadItems";
import { clearGlobalRuntimeNotices } from "../../../services/globalRuntimeNotices";
import { loadSidebarSnapshot } from "../utils/sidebarSnapshot";
import { useThreadActions } from "./useThreadActions";
import { renderActions, workspace } from "./useThreadActions.test-utils";

vi.mock("../../../services/tauri", () => ({
  startThread: vi.fn(),
  connectWorkspace: vi.fn(),
  createWorkspaceDirectory: vi.fn(),
  forkClaudeSession: vi.fn(),
  forkClaudeSessionFromMessage: vi.fn(),
  forkThread: vi.fn(),
  rewindCodexThread: vi.fn(),
  listClaudeSessions: vi.fn(),
  listGeminiSessions: vi.fn(),
  listKimiSessions: vi.fn(),
  listGrokSessions: vi.fn(),
  getOpenCodeSessionList: vi.fn(),
  listWorkspaceSessions: vi.fn(),
  loadClaudeSession: vi.fn(),
  loadGeminiSession: vi.fn(),
  loadCodexSession: vi.fn(),
  listThreadTitles: vi.fn(),
  readWorkspaceFile: vi.fn(),
  renameThreadTitleKey: vi.fn(),
  setThreadTitle: vi.fn(),
  resumeThread: vi.fn(),
  listThreads: vi.fn(),
  archiveThread: vi.fn(),
  deleteCodexSession: vi.fn(),
  deleteClaudeSession: vi.fn(),
  deleteGeminiSession: vi.fn(),
  deleteOpenCodeSession: vi.fn(),
  trashWorkspaceItem: vi.fn(),
  writeWorkspaceFile: vi.fn(),
}));

vi.mock("../../shared-session/services/sharedSessions", () => ({
  listSharedSessions: vi.fn(async () => []),
}));

vi.mock("../../../utils/threadItems", () => ({
  buildItemsFromThread: vi.fn(),
  extractClaudeApprovalResumeEntries: vi.fn(() => []),
  getThreadTimestamp: vi.fn(),
  isReviewingFromThread: vi.fn(),
  mergeThreadItems: vi.fn(),
  normalizeItem: vi.fn((item: ConversationItem) => item),
  previewThreadName: vi.fn(),
  stripClaudeApprovalResumeArtifacts: vi.fn((text: string) => text),
}));

vi.mock("../utils/threadStorage", () => ({
  makeCustomNameKey: (workspaceId: string, threadId: string) =>
    `${workspaceId}:${threadId}`,
  saveThreadActivity: vi.fn(),
}));

vi.mock("../utils/sidebarSnapshot", () => ({
  loadSidebarSnapshot: vi.fn(() => null),
}));

vi.mock("../../../services/globalRuntimeNotices", async () => {
  const actual = await vi.importActual<typeof import("../../../services/globalRuntimeNotices")>(
    "../../../services/globalRuntimeNotices",
  );
  return actual;
});

const RESOLVES_TIMEOUT_SIGNAL = (
  _workspaceId: string,
) => Promise.resolve(null);

function makeCachedOpenCodeSummary(idSuffix: string, updatedAt: number): ThreadSummary {
  return {
    id: `opencode:oc-${idSuffix}`,
    name: `Cached OpenCode ${idSuffix}`,
    updatedAt,
    engineSource: "opencode" as const,
    threadKind: "native" as const,
    sizeBytes: 1024,
  };
}

function getLatestSetThreadsDispatch(dispatch: ReturnType<typeof vi.fn>) {
  for (let i = dispatch.mock.calls.length - 1; i >= 0; i -= 1) {
    const arg = dispatch.mock.calls[i][0];
    if (arg && arg.type === "setThreads") {
      return arg;
    }
  }
  return null;
}

function renderActionsWithMutableThreadState(
  threadsByWorkspace: Record<string, ThreadSummary[]>,
) {
  const dispatch = vi.fn();
  const loadedThreadsRef = { current: {} as Record<string, boolean> };
  const replaceOnResumeRef = { current: {} as Record<string, boolean> };
  const threadActivityRef = {
    current: {} as Record<string, Record<string, number>>,
  };
  let currentThreadsByWorkspace = threadsByWorkspace;
  const baseArgs: Parameters<typeof useThreadActions>[0] = {
    dispatch,
    itemsByThread: {},
    userInputRequests: [],
    threadsByWorkspace: currentThreadsByWorkspace,
    activeThreadIdByWorkspace: {},
    threadListCursorByWorkspace: {},
    threadStatusById: {},
    getCustomName: () => undefined,
    threadActivityRef,
    loadedThreadsRef,
    replaceOnResumeRef,
    applyCollabThreadLinksFromThread: vi.fn(),
    updateThreadParent: vi.fn(),
    onThreadTitleMappingsLoaded: vi.fn(),
    onRenameThreadTitleMapping: vi.fn(),
  };

  const hook = renderHook(() =>
    useThreadActions({
      ...baseArgs,
      threadsByWorkspace: currentThreadsByWorkspace,
    }),
  );

  return {
    ...hook,
    dispatch,
    rerenderWithThreadState(nextThreadsByWorkspace: Record<string, ThreadSummary[]>) {
      currentThreadsByWorkspace = nextThreadsByWorkspace;
      hook.rerender();
    },
  };
}

describe("useThreadActions opencode sidebar listing timeout fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.mocked(listThreadTitles).mockResolvedValue({});
    vi.mocked(listSharedSessions).mockResolvedValue([]);
    vi.mocked(listClaudeSessions).mockResolvedValue([]);
    vi.mocked(listGeminiSessions).mockResolvedValue([]);
    vi.mocked(getOpenCodeSessionList).mockResolvedValue([]);
    vi.mocked(listWorkspaceSessions).mockResolvedValue({
      data: [],
      nextCursor: null,
      partialSource: null,
    });
    vi.mocked(listThreads).mockResolvedValue({
      result: { data: [], nextCursor: null },
    } as any);
    vi.mocked(renameThreadTitleKey).mockResolvedValue(undefined);
    vi.mocked(setThreadTitle).mockResolvedValue("title");
    vi.mocked(connectWorkspace).mockResolvedValue(undefined);
    vi.mocked(createWorkspaceDirectory).mockResolvedValue(undefined);
    vi.mocked(previewThreadName).mockImplementation((text: string, fallback: string) => {
      const trimmed = (text ?? "").trim();
      return trimmed || fallback;
    });
    vi.mocked(getThreadTimestamp).mockImplementation((thread) => {
      const value = (thread as Record<string, unknown>).updated_at as number | undefined;
      return value ?? 0;
    });
    vi.mocked(loadSidebarSnapshot).mockReturnValue(null);
    vi.mocked(mergeThreadItems).mockImplementation(
      (primaryItems: ConversationItem[]) => primaryItems,
    );
    clearGlobalRuntimeNotices();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("includes opencode listing during normal hydration", async () => {
    const { result } = renderActions();

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace, {
        preserveState: true,
      });
    });

    expect(getOpenCodeSessionList).toHaveBeenCalledWith("ws-1", {
      timeoutMs: 3_000,
      timeoutResult: "null",
    });
  });

  it(
    "case 1: opencode listing timeout still keeps last-good opencode entries when codex returns a session",
    async () => {
      vi.mocked(getOpenCodeSessionList).mockImplementation(RESOLVES_TIMEOUT_SIGNAL);
      vi.mocked(listWorkspaceSessions).mockResolvedValue({
        data: [
          {
            sessionId: "codex-1",
            title: "Codex Active",
            engine: "codex",
            updatedAt: 5000,
            sizeBytes: 2048,
            folderId: null,
            parentSessionId: null,
            source: null,
            provider: null,
            sourceLabel: null,
          },
        ],
        nextCursor: null,
        partialSource: null,
      } as any);

      const { result, dispatch } = renderActions({
        threadsByWorkspace: {
          "ws-1": [
            makeCachedOpenCodeSummary("a", 9000),
            makeCachedOpenCodeSummary("b", 8500),
          ],
        },
      });

      const promise = result.current.listThreadsForWorkspace(workspace, {
        preserveState: true,
        includeOpenCodeSessions: true,
      });
      await act(async () => {
        await promise;
      });

      const dispatched = getLatestSetThreadsDispatch(dispatch);
      expect(dispatched).not.toBeNull();
      const ids = dispatched!.threads.map((t: any) => t.id);
      expect(ids).toContain("opencode:oc-a");
      expect(ids).toContain("opencode:oc-b");
      expect(ids).toContain("codex-1");
    },
    20_000,
  );

  it(
    "case 2: opencode listing rejection still keeps last-good opencode entries and emits diagnostics",
    async () => {
      vi.mocked(getOpenCodeSessionList).mockRejectedValue(
        new Error("synthetic-opencode-failure"),
      );
      vi.mocked(listWorkspaceSessions).mockResolvedValue({
        data: [
          {
            sessionId: "codex-1",
            title: "Codex Active",
            engine: "codex",
            updatedAt: 5000,
            sizeBytes: 2048,
            folderId: null,
            parentSessionId: null,
            source: null,
            provider: null,
            sourceLabel: null,
          },
        ],
        nextCursor: null,
        partialSource: null,
      } as any);

      const debugEvents: Array<{ label?: string; payload?: any }> = [];
      const { result, dispatch } = renderActions({
        threadsByWorkspace: {
          "ws-1": [
            makeCachedOpenCodeSummary("a", 9000),
            makeCachedOpenCodeSummary("b", 8500),
          ],
        },
        onDebug: (event: any) => {
          debugEvents.push({ label: event?.label, payload: event?.payload });
        },
      });

      await act(async () => {
        await result.current.listThreadsForWorkspace(workspace, {
          preserveState: true,
          includeOpenCodeSessions: true,
        });
      });

      const dispatched = getLatestSetThreadsDispatch(dispatch);
      expect(dispatched).not.toBeNull();
      const ids = dispatched!.threads.map((t: any) => t.id);
      expect(ids).toContain("opencode:oc-a");
      expect(ids).toContain("opencode:oc-b");
      expect(ids).toContain("codex-1");

      const errorLabels = debugEvents.map((e) => e.label ?? "");
      expect(errorLabels).toEqual(
        expect.arrayContaining([expect.stringMatching(/opencode.*error/i)]),
      );

      const errorPayload = debugEvents.find(
        (e) => typeof e.label === "string" && /opencode.*error/i.test(e.label),
      )?.payload;
      expect(errorPayload).toEqual(
        expect.objectContaining({ workspaceId: "ws-1" }),
      );
      expect(typeof errorPayload.error).toBe("string");
      expect(errorPayload.error.length).toBeGreaterThan(0);
    },
    10_000,
  );

  it(
    "case 3: consecutive opencode timeouts do not progressively drop more opencode sessions",
    async () => {
      vi.mocked(getOpenCodeSessionList).mockImplementation(RESOLVES_TIMEOUT_SIGNAL);
      vi.mocked(listWorkspaceSessions).mockResolvedValue({
        data: [
          {
            sessionId: "codex-1",
            title: "Codex Active",
            engine: "codex",
            updatedAt: 5000,
            sizeBytes: 2048,
            folderId: null,
            parentSessionId: null,
            source: null,
            provider: null,
            sourceLabel: null,
          },
        ],
        nextCursor: null,
        partialSource: null,
      } as any);

      const initialThreadsByWorkspace = {
        "ws-1": [
          makeCachedOpenCodeSummary("a", 9000),
          makeCachedOpenCodeSummary("b", 8500),
          makeCachedOpenCodeSummary("c", 8000),
        ],
      };
      const { result, dispatch, rerenderWithThreadState } =
        renderActionsWithMutableThreadState(initialThreadsByWorkspace);

      const firstRun = result.current.listThreadsForWorkspace(workspace, {
        preserveState: true,
        includeOpenCodeSessions: true,
      });
      await act(async () => {
        await firstRun;
      });

      const firstDispatch = getLatestSetThreadsDispatch(dispatch);
      expect(firstDispatch).not.toBeNull();
      const firstOpenCodeIds = firstDispatch!.threads
        .filter((t: any) => t.engineSource === "opencode")
        .map((t: any) => t.id);
      expect(firstOpenCodeIds).toEqual(
        expect.arrayContaining(["opencode:oc-a", "opencode:oc-b", "opencode:oc-c"]),
      );

      dispatch.mockClear();
      rerenderWithThreadState({
        "ws-1": firstDispatch!.threads.map((thread: any) => ({
          ...thread,
          isDegraded: true,
          partialSource: "opencode-session-timeout",
          degradedReason: "partial-thread-list",
        })),
      });

      const secondRun = result.current.listThreadsForWorkspace(workspace, {
        preserveState: true,
        includeOpenCodeSessions: true,
      });
      await act(async () => {
        await secondRun;
      });

      const secondDispatch = getLatestSetThreadsDispatch(dispatch);
      expect(secondDispatch).not.toBeNull();
      const secondOpenCodeIds = secondDispatch!.threads
        .filter((t: any) => t.engineSource === "opencode")
        .map((t: any) => t.id);
      expect(secondOpenCodeIds.length).toBeGreaterThanOrEqual(firstOpenCodeIds.length);
      expect(secondOpenCodeIds).toEqual(
        expect.arrayContaining(["opencode:oc-a", "opencode:oc-b", "opencode:oc-c"]),
      );
    },
    20_000,
  );

  it(
    "case 4: archived and pending last-good opencode entries are not resurrected by seed",
    async () => {
      vi.mocked(getOpenCodeSessionList).mockImplementation(RESOLVES_TIMEOUT_SIGNAL);
      vi.mocked(listWorkspaceSessions).mockResolvedValue({
        data: [
          {
            sessionId: "codex-1",
            title: "Codex Active",
            engine: "codex",
            updatedAt: 5000,
            sizeBytes: 2048,
            folderId: null,
            parentSessionId: null,
            source: null,
            provider: null,
            sourceLabel: null,
          },
        ],
        nextCursor: null,
        partialSource: null,
      } as any);

      const archivedSummary: ThreadSummary = {
        ...makeCachedOpenCodeSummary("archived", 9500),
        archivedAt: 9000,
      };
      const pendingSummary: ThreadSummary = {
        id: "opencode-pending-123",
        name: "Pending OpenCode",
        updatedAt: 9400,
        engineSource: "opencode",
        threadKind: "native",
        sizeBytes: 128,
      };
      const liveSummary = makeCachedOpenCodeSummary("live", 9200);

      const { result, dispatch } = renderActions({
        threadsByWorkspace: {
          "ws-1": [archivedSummary, pendingSummary, liveSummary],
        },
      });

      const run = result.current.listThreadsForWorkspace(workspace, {
        preserveState: true,
        includeOpenCodeSessions: true,
      });
      await act(async () => {
        await run;
      });

      const dispatched = getLatestSetThreadsDispatch(dispatch);
      expect(dispatched).not.toBeNull();
      const ids = dispatched!.threads.map((t: any) => t.id);
      expect(ids).toContain("opencode:oc-live");
      expect(ids).not.toContain("opencode:oc-archived");
      expect(ids).not.toContain("opencode-pending-123");
    },
    20_000,
  );
});
