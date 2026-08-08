/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useComposerRunStatus } from "./useComposerRunStatus";
import type { TurnFileChangesSummary } from "../../../messages/utils/turnFileChanges";

const demoSessionFiles: TurnFileChangesSummary = {
  files: [
    { path: "a.ts", additions: 3, deletions: 1, status: "completed" },
    { path: "b.ts", additions: 10, deletions: 2, status: "completed" },
  ],
  totalAdditions: 13,
  totalDeletions: 3,
};

describe("useComposerRunStatus", () => {
  it("hides strip when there is no run activity", () => {
    const { result } = renderHook(() =>
      useComposerRunStatus({
        todos: [],
        subagents: [],
        plan: null,
        isPlanMode: false,
        isProcessing: false,
        mergePlanIntoTodos: false,
        sessionFileChanges: null,
      }),
    );
    expect(result.current.visible).toBe(false);
  });

  it("exposes todo / subagent / plan / edit sections and toggles expand", () => {
    const { result } = renderHook(() =>
      useComposerRunStatus({
        todos: [
          { content: "A", status: "completed" },
          { content: "B", status: "in_progress" },
        ],
        subagents: [
          {
            id: "s1",
            type: "explore",
            description: "Demo agent",
            status: "running",
          },
        ],
        plan: {
          turnId: "t1",
          explanation: null,
          steps: [{ step: "Plan step", status: "pending" }],
        },
        isPlanMode: true,
        isProcessing: true,
        mergePlanIntoTodos: false,
        sessionFileChanges: demoSessionFiles,
      }),
    );

    expect(result.current.visible).toBe(true);
    expect(result.current.showTodoSection).toBe(true);
    expect(result.current.showSubagentSection).toBe(true);
    expect(result.current.showPlanSection).toBe(true);
    expect(result.current.showEditSection).toBe(true);
    expect(result.current.editFileCount).toBe(2);
    expect(result.current.todoCompleted).toBe(1);
    expect(result.current.subagentRunning).toBe(true);
    expect(result.current.expandedSection).toBe("subagent");

    act(() => {
      result.current.toggleSection("edit");
    });
    expect(result.current.expandedSection).toBe("edit");

    act(() => {
      result.current.toggleSection("edit");
    });
    expect(result.current.expandedSection).toBeNull();
  });

  it("merges plan steps into todos when mergePlanIntoTodos is true", () => {
    const { result } = renderHook(() =>
      useComposerRunStatus({
        todos: [{ content: "legacy", status: "pending" }],
        subagents: [],
        plan: {
          turnId: "t1",
          explanation: null,
          steps: [
            { step: "from plan", status: "completed" },
            { step: "next", status: "inProgress" },
          ],
        },
        isPlanMode: false,
        isProcessing: true,
        mergePlanIntoTodos: true,
        sessionFileChanges: null,
      }),
    );

    expect(result.current.showPlanSection).toBe(false);
    expect(result.current.displayTodos).toHaveLength(2);
    expect(result.current.displayTodos[0]?.content).toBe("from plan");
    expect(result.current.displayTodos[1]?.status).toBe("in_progress");
  });

  it("hides edit section after markFilesReverted and restores when stats change", () => {
    const first: TurnFileChangesSummary = {
      files: [
        { path: "a.ts", additions: 3, deletions: 1, status: "completed" },
      ],
      totalAdditions: 3,
      totalDeletions: 1,
    };
    const { result, rerender } = renderHook(
      ({ files }) =>
        useComposerRunStatus({
          todos: [],
          subagents: [],
          plan: null,
          isPlanMode: false,
          isProcessing: false,
          mergePlanIntoTodos: false,
          sessionFileChanges: files,
          sessionScopeKey: "thread-1",
        }),
      { initialProps: { files: first as TurnFileChangesSummary | null } },
    );

    expect(result.current.showEditSection).toBe(true);
    act(() => {
      result.current.markFilesReverted(["a.ts"]);
    });
    expect(result.current.showEditSection).toBe(false);
    expect(result.current.sessionFileChanges).toBeNull();

    const reEdited: TurnFileChangesSummary = {
      files: [
        { path: "a.ts", additions: 8, deletions: 2, status: "completed" },
      ],
      totalAdditions: 8,
      totalDeletions: 2,
    };
    rerender({ files: reEdited });
    expect(result.current.showEditSection).toBe(true);
    expect(result.current.totalAdditions).toBe(8);
  });

  it("clears reverted hide state when sessionScopeKey changes", () => {
    const files = demoSessionFiles;
    const { result, rerender } = renderHook(
      ({ scope }) =>
        useComposerRunStatus({
          todos: [],
          subagents: [],
          plan: null,
          isPlanMode: false,
          isProcessing: false,
          mergePlanIntoTodos: false,
          sessionFileChanges: files,
          sessionScopeKey: scope,
        }),
      { initialProps: { scope: "thread-a" } },
    );

    act(() => {
      result.current.markFilesReverted(["a.ts", "b.ts"]);
    });
    expect(result.current.showEditSection).toBe(false);

    rerender({ scope: "thread-b" });
    expect(result.current.showEditSection).toBe(true);
    expect(result.current.editFileCount).toBe(2);
  });
});
