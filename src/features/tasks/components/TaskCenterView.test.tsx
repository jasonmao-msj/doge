// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TaskCenterView } from "./TaskCenterView";
import type { TaskRunRecord } from "../types";
import { dispatchOpenTaskRunEvent } from "@/services/taskRunNavigationEvents";

function makeRun(overrides: Partial<TaskRunRecord> = {}): TaskRunRecord {
  return {
    runId: "run-1",
    task: {
      taskId: "task-1",
      source: "kanban",
      workspaceId: "/repo",
      title: "Build release",
    },
    engine: "codex",
    status: "running",
    trigger: "manual",
    linkedThreadId: "thread-1",
    planSnapshot: "Plan",
    currentStep: "Writing tests",
    latestOutputSummary: "Updated task run model",
    blockedReason: null,
    failureReason: null,
    artifacts: [{ kind: "file", label: "src/features/tasks/types.ts" }],
    availableRecoveryActions: ["open_conversation", "cancel"],
    startedAt: 10,
    updatedAt: 20,
    finishedAt: null,
    ...overrides,
  };
}

describe("TaskCenterView", () => {
  it("filters runs by workspace, status, and engine", () => {
    render(
      <TaskCenterView
        workspaceId="/repo"
        runs={[
          makeRun(),
          makeRun({
            runId: "run-2",
            task: { taskId: "task-2", source: "kanban", workspaceId: "/repo", title: "Gemini run" },
            engine: "gemini",
            status: "failed",
            updatedAt: 30,
          }),
          makeRun({
            runId: "run-3",
            task: { taskId: "task-3", source: "kanban", workspaceId: "/other", title: "Other" },
            updatedAt: 40,
          }),
        ]}
      />,
    );

    expect(screen.getAllByText("Build release").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Gemini run").length).toBeGreaterThan(0);
    expect(screen.queryByText("Other")).toBeNull();

    fireEvent.change(screen.getByLabelText("taskCenter.statusFilter"), {
      target: { value: "failed" },
    });

    expect(screen.queryByText("Build release")).toBeNull();
    expect(screen.getAllByText("Gemini run").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("taskCenter.engineFilter"), {
      target: { value: "codex" },
    });

    expect(screen.queryByText("Gemini run")).toBeNull();
    expect(screen.getByText("taskCenter.empty")).toBeTruthy();
  });

  it("renders diagnostics, artifacts, and navigation without mutating run state", () => {
    const onOpenConversation = vi.fn();
    const run = makeRun();
    render(<TaskCenterView runs={[run]} onOpenConversation={onOpenConversation} />);

    expect(screen.getByText("Writing tests")).toBeTruthy();
    expect(screen.getAllByText("Updated task run model").length).toBeGreaterThan(0);
    expect(screen.getByText("src/features/tasks/types.ts")).toBeTruthy();
    expect(screen.getAllByText("taskCenter.nextStep.monitor").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText("taskCenter.action.openConversation"));

    expect(onOpenConversation).toHaveBeenCalledWith("thread-1");
    expect(run.status).toBe("running");
  });

  it("selects a linked run when orchestration center dispatches an open-run event", () => {
    render(
      <TaskCenterView
        workspaceId="/repo"
        runs={[
          makeRun({ runId: "run-1", currentStep: "First run step", updatedAt: 30 }),
          makeRun({ runId: "run-2", currentStep: "Second run step", updatedAt: 10 }),
        ]}
      />,
    );

    expect(screen.getByText("First run step")).toBeTruthy();

    act(() => {
      dispatchOpenTaskRunEvent("run-2");
    });

    expect(screen.getByText("Second run step")).toBeTruthy();
  });

  it("keeps orchestration navigation disabled for Kanban runs", () => {
    render(<TaskCenterView runs={[makeRun()]} />);

    expect(screen.queryByText("taskCenter.action.openOrchestrationTask")).toBeNull();
  });

  it("renders linked browser evidence state without treating it as completion", () => {
    const run = makeRun({
      browserEvidence: {
        attachmentId: "browser-attachment-1",
        browserSessionId: "browser-session-1",
        snapshotId: "browser-snapshot-1",
        url: "https://example.com",
        title: "Example",
        capturedAt: 100,
        state: "available",
      },
    });

    render(<TaskCenterView runs={[run]} />);

    expect(screen.getByText(/Example/)).toBeTruthy();
    expect(screen.getByText(/taskCenter.browserEvidenceState.available/)).toBeTruthy();
    expect(run.status).toBe("running");
  });

  it("disables duplicate-producing recovery actions when another active run exists", () => {
    render(
      <TaskCenterView
        runs={[
          makeRun({
            runId: "settled",
            status: "failed",
            updatedAt: 10,
            availableRecoveryActions: ["open_conversation", "retry", "resume"],
          }),
          makeRun({
            runId: "active",
            status: "running",
            updatedAt: 20,
            availableRecoveryActions: ["open_conversation", "cancel"],
          }),
        ]}
        onRetryRun={vi.fn()}
        onForkRun={vi.fn()}
      />,
    );

    fireEvent.click(screen.getAllByText("Build release")[1]!);
    expect(screen.queryByText("taskCenter.action.retry")).toBeNull();
    expect(screen.queryByText("taskCenter.action.fork")).toBeNull();
  });

  it("sorts attention-needing runs ahead of lower-priority active runs", () => {
    render(
      <TaskCenterView
        runs={[
          makeRun({
            runId: "running",
            status: "running",
            updatedAt: 30,
            task: { taskId: "task-running", source: "kanban", workspaceId: "/repo", title: "Running task" },
          }),
          makeRun({
            runId: "blocked",
            status: "blocked",
            blockedReason: "manual intervention required",
            updatedAt: 10,
            task: { taskId: "task-blocked", source: "kanban", workspaceId: "/repo", title: "Blocked task" },
          }),
        ]}
      />,
    );

    const runTitles = screen.getAllByRole("button").map((node) => node.textContent ?? "");
    expect(runTitles[0]).toContain("Blocked task");
    expect(screen.getAllByText("taskCenter.nextStep.openConversation").length).toBeGreaterThan(0);
  });

  it("disables actions that are not available for the selected run", () => {
    render(
      <TaskCenterView
        runs={[
          makeRun({
            status: "completed",
            availableRecoveryActions: ["open_conversation", "fork_new_run"],
          }),
        ]}
        onRetryRun={vi.fn()}
        onResumeRun={vi.fn()}
        onCancelRun={vi.fn()}
        onForkRun={vi.fn()}
      />,
    );

    expect(screen.queryByText("taskCenter.action.retry")).toBeNull();
    expect(screen.queryByText("taskCenter.action.resume")).toBeNull();
    expect(screen.queryByText("taskCenter.action.cancel")).toBeNull();
    expect(screen.getByText("taskCenter.action.fork")).toHaveProperty("disabled", false);
  });
});
