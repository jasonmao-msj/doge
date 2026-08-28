import { describe, expect, it } from "vitest";
import {
  isKanbanThreadCompatibleWithEngine,
  isKanbanThreadCompatibleWithTarget,
  resolveKanbanThreadCreationStrategy,
} from "./contextMode";

describe("resolveKanbanThreadCreationStrategy", () => {
  it("returns new by default", () => {
    expect(
      resolveKanbanThreadCreationStrategy({
        mode: "new",
        engine: "codex",
        activeThreadId: "thread-1",
        activeThreadEngine: "codex",
        activeWorkspaceId: "ws-1",
        targetWorkspaceId: "ws-1",
        isActiveThreadInWorkspace: true,
      }),
    ).toBe("new");
  });

  it("returns inherit only when all fork preconditions are satisfied", () => {
    expect(
      resolveKanbanThreadCreationStrategy({
        mode: "inherit",
        engine: "codex",
        activeThreadId: "thread-1",
        activeThreadEngine: "codex",
        activeWorkspaceId: "ws-1",
        targetWorkspaceId: "ws-1",
        isActiveThreadInWorkspace: true,
      }),
    ).toBe("inherit");
  });

  it("returns inherit for claude when all fork preconditions are satisfied", () => {
    expect(
      resolveKanbanThreadCreationStrategy({
        mode: "inherit",
        engine: "claude",
        activeThreadId: "claude:thread-1",
        activeThreadEngine: "claude",
        activeWorkspaceId: "ws-1",
        targetWorkspaceId: "ws-1",
        isActiveThreadInWorkspace: true,
      }),
    ).toBe("inherit");
  });

  it("falls back to new when thread/workspace context is missing or mismatched", () => {
    expect(
      resolveKanbanThreadCreationStrategy({
        mode: "inherit",
        engine: "codex",
        activeThreadId: null,
        activeThreadEngine: null,
        activeWorkspaceId: "ws-1",
        targetWorkspaceId: "ws-1",
        isActiveThreadInWorkspace: true,
      }),
    ).toBe("new");

    expect(
      resolveKanbanThreadCreationStrategy({
        mode: "inherit",
        engine: "codex",
        activeThreadId: "thread-1",
        activeThreadEngine: "codex",
        activeWorkspaceId: "ws-2",
        targetWorkspaceId: "ws-1",
        isActiveThreadInWorkspace: true,
      }),
    ).toBe("new");

    expect(
      resolveKanbanThreadCreationStrategy({
        mode: "inherit",
        engine: "codex",
        activeThreadId: "thread-1",
        activeThreadEngine: "codex",
        activeWorkspaceId: "ws-1",
        targetWorkspaceId: "ws-1",
        isActiveThreadInWorkspace: false,
      }),
    ).toBe("new");
  });

  it("falls back to new when active thread engine does not match selected engine", () => {
    expect(
      resolveKanbanThreadCreationStrategy({
        mode: "inherit",
        engine: "codex",
        activeThreadId: "claude:thread-1",
        activeThreadEngine: "claude",
        activeWorkspaceId: "ws-1",
        targetWorkspaceId: "ws-1",
        isActiveThreadInWorkspace: true,
      }),
    ).toBe("new");
  });
});

describe("isKanbanThreadCompatibleWithTarget", () => {
  it("rejects reusing a local thread for the same managed engine", () => {
    expect(isKanbanThreadCompatibleWithTarget({
      target: {
        engine: "codex",
        providerProfileId: "doge-token-matrix",
      },
      threadId: "codex:thread-1",
      threadEngine: "codex",
      threadProviderProfileId: null,
    })).toBe(false);
  });

  it("reuses a thread only when engine and provider identity both match", () => {
    expect(isKanbanThreadCompatibleWithTarget({
      target: {
        engine: "kimi",
        providerProfileId: "doge-token-matrix",
      },
      threadId: "kimi:thread-1",
      threadEngine: "kimi",
      threadProviderProfileId: "doge-token-matrix",
    })).toBe(true);
  });
});

describe("isKanbanThreadCompatibleWithEngine", () => {
  it("rejects a claude thread when the task targets codex", () => {
    expect(
      isKanbanThreadCompatibleWithEngine({
        engine: "codex",
        threadId: "claude:session-1",
        threadEngine: "claude",
      }),
    ).toBe(false);
  });

  it("rejects an unprefixed codex thread when the task explicitly targets claude", () => {
    expect(
      isKanbanThreadCompatibleWithEngine({
        engine: "claude",
        threadId: "thread-1",
        threadEngine: "codex",
      }),
    ).toBe(false);
  });

  it("accepts legacy unprefixed thread ids for codex by default", () => {
    expect(
      isKanbanThreadCompatibleWithEngine({
        engine: "codex",
        threadId: "thread-1",
        threadEngine: null,
      }),
    ).toBe(true);
  });

  it("accepts claude pending threads only for claude tasks", () => {
    expect(
      isKanbanThreadCompatibleWithEngine({
        engine: "claude",
        threadId: "claude-pending-1",
        threadEngine: null,
      }),
    ).toBe(true);
    expect(
      isKanbanThreadCompatibleWithEngine({
        engine: "codex",
        threadId: "claude-pending-1",
        threadEngine: null,
      }),
    ).toBe(false);
  });
});
