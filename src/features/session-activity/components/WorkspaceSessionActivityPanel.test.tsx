// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach as afterEachTest, describe, expect, it, vi } from "vitest";
import type { WorkspaceSessionActivityViewModel } from "../types";
import { WorkspaceSessionActivityPanel } from "./WorkspaceSessionActivityPanel";

const { getGitFileFullDiffMock } = vi.hoisted(() => ({
  getGitFileFullDiffMock: vi.fn<(workspaceId: string, path: string) => Promise<string>>(),
}));

vi.mock("../../../services/tauri", () => ({
  getGitFileFullDiff: getGitFileFullDiffMock,
}));

const mockEditableDiffReviewSurface = vi.fn((props: Record<string, unknown>) => (
  <div data-testid="activity-diff-viewer">
    {JSON.stringify({
      selectedPath: props.selectedPath,
      workspaceId: props.workspaceId,
      diffStyle: props.diffStyle,
    })}
  </div>
));

vi.mock("../../git/components/WorkspaceEditableDiffReviewSurface", () => ({
  WorkspaceEditableDiffReviewSurface: (props: Record<string, unknown>) =>
    mockEditableDiffReviewSurface(props),
}));

const SOLO_FOLLOW_COACH_DISMISSED_BY_WORKSPACE_STORAGE_KEY =
  "doge.sessionActivity.soloFollowCoachDismissedByWorkspace";

function dismissSoloFollowCoachForWorkspace(workspaceId: string) {
  window.localStorage.setItem(
    SOLO_FOLLOW_COACH_DISMISSED_BY_WORKSPACE_STORAGE_KEY,
    JSON.stringify({
      [workspaceId]: Date.now(),
    }),
  );
}

function getEventNode(container: HTMLElement, kind: string) {
  return container.querySelector(`.session-activity-event-${kind}`) as HTMLElement | null;
}

function getPreviewTextForKind(container: HTMLElement, kind: string) {
  return getEventNode(container, kind)?.querySelector(".session-activity-preview-text");
}

function getPreviewToggleForKind(container: HTMLElement, kind: string) {
  return getEventNode(container, kind)?.querySelector(".session-activity-preview-toggle");
}

function getTurnGroup(container: HTMLElement, index: number) {
  return container.querySelectorAll(".session-activity-turn-group")[index] as HTMLElement | undefined;
}

function createViewModel(): WorkspaceSessionActivityViewModel {
  return {
    rootThreadId: "root-thread",
    rootThreadName: "Root session",
    relevantThreadIds: ["root-thread", "child-thread"],
    isProcessing: true,
    emptyState: "running",
    sessionSummaries: [
      {
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        eventCount: 2,
        isProcessing: true,
      },
      {
        threadId: "child-thread",
        threadName: "Child session",
        sessionRole: "child",
        relationshipSource: "fallbackLinking",
        eventCount: 1,
        isProcessing: false,
      },
    ],
    timeline: [
      {
        eventId: "file:file-1",
        turnId: "turn-2",
        turnIndex: 2,
        threadId: "child-thread",
        threadName: "Child session",
        sessionRole: "child",
        relationshipSource: "fallbackLinking",
        kind: "fileChange",
        occurredAt: 30,
        summary: "File change · src/App.tsx",
        status: "completed",
        fileChangeStatusLetter: "M",
        jumpTarget: {
          type: "file",
          path: "src/App.tsx",
          line: 9,
          markers: { added: [9], modified: [10] },
        },
        additions: 3,
        deletions: 1,
        fileChanges: [
          {
            filePath: "src/App.tsx",
            fileName: "App.tsx",
            statusLetter: "M",
            additions: 3,
            deletions: 1,
            diff: "@@ -1 +1 @@\n-old\n+new",
            line: 9,
            markers: { added: [9], modified: [10] },
          },
          {
            filePath: "src-tauri/Cargo.toml",
            fileName: "Cargo.toml",
            statusLetter: "A",
            additions: 2,
            deletions: 0,
            diff: "@@ -0,0 +1,2 @@\n+[dependencies]\n+tauri = \"2\"",
            line: 1,
            markers: { added: [1, 2], modified: [] },
          },
        ],
      },
      {
        eventId: "task:task-1",
        turnId: "turn-2",
        turnIndex: 2,
        threadId: "child-thread",
        threadName: "Child session",
        sessionRole: "child",
        relationshipSource: "directParent",
        kind: "task",
        occurredAt: 20,
        summary: "Task · Audit current panel",
        status: "running",
        jumpTarget: { type: "thread", threadId: "child-thread" },
      },
      {
        eventId: "command:cmd-1",
        turnId: "turn-2",
        turnIndex: 2,
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        kind: "command",
        occurredAt: 10,
        summary: "pnpm vitest",
        status: "running",
        commandText: "pnpm vitest --runInBand",
        commandDescription: "Run focused test suite",
        commandWorkingDirectory: "/workspace/project",
        commandPreview: "stderr line\nstdout tail",
      },
      {
        eventId: "explore:explore-1",
        turnId: "turn-2",
        turnIndex: 2,
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        kind: "explore",
        occurredAt: 5,
        summary: "Search · activity panel",
        status: "completed",
      },
      {
        eventId: "reasoning:reason-1",
        turnId: "turn-2",
        turnIndex: 2,
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        kind: "reasoning",
        occurredAt: 4,
        summary: "Thinking · compare recent panel states",
        status: "running",
        jumpTarget: { type: "thread", threadId: "root-thread" },
        reasoningPreview:
          "用户想要在备忘录中添加分类功能。\n我需要：1. 修改 Memo 实体；2. 修改 MemoRequest；3. 调整 controller。",
      },
    ],
  };
}

function getPrimaryFileChangeEvent(viewModel: WorkspaceSessionActivityViewModel) {
  const event = viewModel.timeline.find((candidate) => candidate.kind === "fileChange");
  if (!event) {
    throw new Error("Expected test view model to include a file-change event");
  }
  return event;
}

describe("WorkspaceSessionActivityPanel", () => {
  afterEachTest(() => {
    cleanup();
    window.localStorage.removeItem(SOLO_FOLLOW_COACH_DISMISSED_BY_WORKSPACE_STORAGE_KEY);
    getGitFileFullDiffMock.mockReset();
    mockEditableDiffReviewSurface.mockReset();
  });

  it("routes turn artifact file rows to the correct jump target", () => {
    const onOpenDiffPath = vi.fn();

    render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={createViewModel()}
        onOpenDiffPath={onOpenDiffPath}
        onSelectThread={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /App\.tsx\+3-1/i }));

    expect(onOpenDiffPath).toHaveBeenCalledWith(
      "src/App.tsx",
      { line: 9, column: 1 },
      { highlightMarkers: { added: [9], modified: [10] } },
    );
  });

  it("shows the complete file list for file-change events and maximizes after opening a row", () => {
    const onOpenDiffPath = vi.fn();
    const onEnsureEditorFileMaximized = vi.fn();

    render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={createViewModel()}
        onOpenDiffPath={onOpenDiffPath}
        onEnsureEditorFileMaximized={onEnsureEditorFileMaximized}
        onSelectThread={vi.fn()}
      />,
    );

    expect(screen.getByText("App.tsx")).toBeTruthy();
    expect(screen.getByText("Cargo.toml")).toBeTruthy();
    expect(screen.queryByText("src-tauri/Cargo.toml")).toBeNull();

    fireEvent.click(screen.getByText("Cargo.toml"));

    expect(onOpenDiffPath).toHaveBeenCalledWith(
      "src-tauri/Cargo.toml",
      { line: 1, column: 1 },
      { highlightMarkers: { added: [1, 2], modified: [] } },
    );
    expect(onEnsureEditorFileMaximized).toHaveBeenCalledTimes(1);
  });

  it("shows semantic diff facts inside the turn artifact tabs", () => {
    const viewModel = createViewModel();
    const primaryFileChangeEvent = getPrimaryFileChangeEvent(viewModel);
    viewModel.timeline[0] = {
      ...primaryFileChangeEvent,
      summary: "File change · GlobalExceptionHandler.java",
      turnSemantic:
        "请处理 <OperationLog> 不存在时的 404 响应，并避免泄漏内部异常。",
      fileChanges: [
        {
          filePath: "src/main/java/com/example/demo/exception/GlobalExceptionHandler.java",
          fileName: "GlobalExceptionHandler.java",
          statusLetter: "M",
          additions: 10,
          deletions: 0,
          diff: [
            "@@ -76,0 +77,10 @@",
            "+    /**",
            "+     * 处理操作日志不存在异常",
            "+     */",
            "+    @ExceptionHandler(OperationLogNotFoundException.class)",
            "+    public ResponseEntity<ApiResponse<Void>> handleOperationLogNotFoundException(OperationLogNotFoundException e) {",
            "+        return ResponseEntity",
            "+                .status(HttpStatus.NOT_FOUND)",
            "+                .body(ApiResponse.<Void>error(404, e.getMessage()));",
            "+    }",
          ].join("\n"),
        },
      ],
    };

    const onOpenDiffPath = vi.fn();
    const onEnsureEditorFileMaximized = vi.fn();

    render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={onOpenDiffPath}
        onEnsureEditorFileMaximized={onEnsureEditorFileMaximized}
        onSelectThread={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "activityPanel.artifacts.tabs.semantic" }));

    expect(screen.getByText("activityPanel.artifacts.turnSemanticTitle")).toBeTruthy();
    expect(
      screen.getByText(
        "请处理 <OperationLog> 不存在时的 404 响应，并避免泄漏内部异常。",
      ),
    ).toBeTruthy();
    expect(document.body.innerHTML).not.toContain("<OperationLog> 不存在时");
    expect(
      screen.getByText(
        "Adds handler handleOperationLogNotFoundException for OperationLogNotFoundException.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "OperationLogNotFoundException maps to HTTP 404 NOT_FOUND through handleOperationLogNotFoundException.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "handleOperationLogNotFoundException returns ApiResponse.error(404, ...).",
      ),
    ).toBeTruthy();

    const evidenceLink = screen.getAllByRole("button", {
      name: "src/main/java/com/example/demo/exception/GlobalExceptionHandler.java:80",
    })[0];
    fireEvent.click(evidenceLink);
    expect(onOpenDiffPath).toHaveBeenCalledWith(
      "src/main/java/com/example/demo/exception/GlobalExceptionHandler.java",
      { line: 80, column: 1 },
      undefined,
    );
    expect(onEnsureEditorFileMaximized).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll(".session-activity-semantic-evidence-refs")).toHaveLength(0);
  });

  it("shows same-turn validation command evidence in semantic diff", () => {
    const viewModel = createViewModel();
    const primaryFileChangeEvent = getPrimaryFileChangeEvent(viewModel);
    viewModel.timeline = [
      {
        ...primaryFileChangeEvent,
        turnId: "turn-validation",
        turnIndex: 3,
        threadId: "root-thread",
        threadName: "Root session",
        fileChanges: [
          {
            filePath: "src/App.tsx",
            fileName: "App.tsx",
            statusLetter: "M",
            additions: 1,
            deletions: 1,
            diff: "@@ -1 +1 @@\n-export const oldValue = 1;\n+export const newValue = 2;",
          },
        ],
      },
      {
        eventId: "command:vitest",
        turnId: "turn-validation",
        turnIndex: 3,
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        kind: "command",
        occurredAt: 31,
        summary: "Test · npx vitest run src/App.test.tsx",
        status: "completed",
        commandText: "npx vitest run src/App.test.tsx",
        commandDescription: "Run focused tests",
      },
    ];

    render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "activityPanel.artifacts.tabs.semantic" }));

    expect(screen.getByText("test validation command completed: Run focused tests.")).toBeTruthy();
    expect(
      Array.from(document.querySelectorAll(".session-activity-semantic-evidence-label")).some((node) =>
        node.textContent?.includes("Run focused tests"),
      ),
    ).toBe(true);
    expect(screen.getAllByText("Run focused tests").length).toBeGreaterThan(0);
    expect(screen.queryByText("External validation evidence is not connected to this summary yet.")).toBeNull();
  });

  it("counts artifacts by deduped files instead of raw file-change events", () => {
    const viewModel = createViewModel();
    const primaryFileChangeEvent = getPrimaryFileChangeEvent(viewModel);
    viewModel.timeline = [
      primaryFileChangeEvent,
      {
        ...primaryFileChangeEvent,
        eventId: "file:file-duplicate",
        occurredAt: 31,
        fileChanges: [
          {
            filePath: "src/App.tsx",
            fileName: "App.tsx",
            statusLetter: "M",
            additions: 5,
            deletions: 0,
            diff: "@@ -2 +2 @@\n-old\n+newer",
          },
        ],
      },
    ];

    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    const artifactsTab = screen.getByRole("tab", { name: /activityPanel\.tabs\.file/i });
    expect(artifactsTab.querySelector(".session-activity-tab-count")?.textContent).toBe("2");
    expect(view.container.querySelectorAll(".session-activity-file-row")).toHaveLength(2);
  });

  it("opens diff preview modal from the dedicated file action button", () => {
    render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={createViewModel()}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "git.previewModalAction" })[0]!);

    expect(screen.getByRole("dialog", { name: "src/App.tsx" })).toBeTruthy();
  });

  it("falls back to the diff preview modal for deleted files instead of forcing file open", () => {
    const deletedViewModel = createViewModel();
    deletedViewModel.timeline[0] = {
      ...deletedViewModel.timeline[0]!,
      summary: "File change · src/Removed.tsx",
      filePath: "src/Removed.tsx",
      fileChangeStatusLetter: "D",
      jumpTarget: {
        type: "file",
        path: "src/Removed.tsx",
      },
      fileChanges: [
        {
          filePath: "src/Removed.tsx",
          fileName: "Removed.tsx",
          statusLetter: "D",
          additions: 0,
          deletions: 3,
          diff: "@@ -1,3 +0,0 @@\n-old\n-older\n-oldest",
          markers: { added: [], modified: [] },
        },
      ],
    };

    const onOpenDiffPath = vi.fn();
    const onEnsureEditorFileMaximized = vi.fn();

    render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={deletedViewModel}
        onOpenDiffPath={onOpenDiffPath}
        onEnsureEditorFileMaximized={onEnsureEditorFileMaximized}
        onSelectThread={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("Removed.tsx"));

    expect(onOpenDiffPath).not.toHaveBeenCalled();
    expect(onEnsureEditorFileMaximized).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "src/Removed.tsx" })).toBeTruthy();
  });

  it("skips focus restore when the diff preview trigger element has been unmounted", () => {
    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={createViewModel()}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    const trigger = screen.getAllByRole("button", { name: "git.previewModalAction" })[0]!;
    trigger.focus();
    const triggerFocusSpy = vi.spyOn(trigger, "focus");
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "src/App.tsx" })).toBeTruthy();

    // 时间线清空后触发按钮随产物列表卸载,关闭模态框 MUST NOT 对已卸载节点归还焦点
    const emptyViewModel = createViewModel();
    emptyViewModel.timeline = [];
    view.rerender(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={emptyViewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );
    expect(trigger.isConnected).toBe(false);

    fireEvent.keyDown(screen.getByRole("dialog", { name: "src/App.tsx" }), { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "src/App.tsx" })).toBeNull();
    expect(triggerFocusSpy).not.toHaveBeenCalled();
  });

  it("passes the workspace-backed preview target into the editable review surface", async () => {
    const onCreateCodeAnnotation = vi.fn();
    const codeAnnotations = [
      {
        id: "annotation-activity",
        path: "src/App.tsx",
        lineRange: { startLine: 2, endLine: 2 },
        body: "review activity diff",
        source: "modal-diff-view" as const,
      },
    ];
    render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={createViewModel()}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
        onCreateCodeAnnotation={onCreateCodeAnnotation}
        codeAnnotations={codeAnnotations}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "git.previewModalAction" })[0]!);

    await waitFor(() => {
      expect(mockEditableDiffReviewSurface.mock.lastCall?.[0]).toMatchObject({
        workspaceId: "workspace-1",
        selectedPath: "src/App.tsx",
        onCreateCodeAnnotation,
        codeAnnotations,
        codeAnnotationSurface: "modal-diff-view",
      });
    });
  });

  it("normalizes absolute preview paths before passing them to the editable review surface", async () => {
    const viewModel = createViewModel();
    viewModel.timeline[0] = {
      ...viewModel.timeline[0]!,
      summary: "File change · /repo/src/App.tsx",
      jumpTarget: {
        type: "file",
        path: "/repo/src/App.tsx",
        line: 9,
        markers: { added: [9], modified: [10] },
      },
      fileChanges: [
        {
          filePath: "/repo/src/App.tsx",
          fileName: "App.tsx",
          statusLetter: "M",
          additions: 3,
          deletions: 1,
          diff: "@@ -1 +1 @@\n-old\n+new",
          line: 9,
          markers: { added: [9], modified: [10] },
        },
      ],
    };

    render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-absolute"
        workspacePath="/repo"
        viewModel={viewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "git.previewModalAction" }));

    await waitFor(() => {
      expect(mockEditableDiffReviewSurface.mock.lastCall?.[0]).toMatchObject({
        workspaceId: "workspace-absolute",
        workspacePath: "/repo",
        selectedPath: "src/App.tsx",
      });
    });
  });

  it("shows file status badge for file change rows", () => {
    const { container } = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={createViewModel()}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    const badge = container.querySelector(".session-activity-file-row .session-activity-file-kind-badge");
    expect(badge).toBeTruthy();
    if (!badge) {
      throw new Error("Expected file status badge to exist");
    }
    expect(badge.className).toContain("session-activity-file-kind-badge");
    expect(badge.className).toContain("is-m");
  });

  it("routes read activity cards to file opening when jumpTarget is file", () => {
    const onOpenDiffPath = vi.fn();
    const viewModel = createViewModel();
    viewModel.timeline = [
      {
        eventId: "task:read-1",
        turnId: "turn-2",
        turnIndex: 2,
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        kind: "task",
        occurredAt: 40,
        summary: "Read · README.md",
        status: "completed",
        jumpTarget: { type: "file", path: "/workspace/README.md" },
      },
    ];

    render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={onOpenDiffPath}
        onSelectThread={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Read · README\.md/i }));

    expect(onOpenDiffPath).toHaveBeenCalledWith("/workspace/README.md", undefined, undefined);
  });

  it("collapses older turn groups and only expands the latest one by default", () => {
    const viewModel = createViewModel();
    viewModel.timeline = [
      ...viewModel.timeline,
      {
        eventId: "command:cmd-older",
        turnId: "turn-1",
        turnIndex: 1,
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        kind: "command",
        occurredAt: 1,
        summary: "Older command",
        status: "completed",
        commandDescription: "Older command",
        commandPreview: "older output",
      },
    ];

    const { container } = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    const latestGroup = getTurnGroup(container, 0);
    const olderGroup = getTurnGroup(container, 1);
    expect(latestGroup?.querySelector(".session-activity-turn-group-events")).toBeTruthy();
    expect(olderGroup?.querySelector(".session-activity-turn-group-events")).toBeNull();
    expect(screen.queryByRole("button", { name: /Older command/i })).toBeNull();
  });

  it("allows expanding a collapsed older turn group", () => {
    const viewModel = createViewModel();
    viewModel.timeline = [
      ...viewModel.timeline,
      {
        eventId: "command:cmd-older",
        turnId: "turn-1",
        turnIndex: 1,
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        kind: "command",
        occurredAt: 1,
        summary: "Older command",
        status: "completed",
        commandDescription: "Older command",
        commandPreview: "older output",
      },
    ];

    const { container } = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    const olderGroup = getTurnGroup(container, 1);
    const olderToggle = olderGroup?.querySelector(
      ".session-activity-turn-group-header",
    ) as HTMLButtonElement | null;
    expect(olderToggle?.getAttribute("aria-expanded")).toBe("false");
    if (!olderToggle) {
      return;
    }
    fireEvent.click(olderToggle);
    expect(screen.getByRole("button", { name: /Older command/i })).toBeTruthy();
    expect(getTurnGroup(container, 1)?.querySelector(".session-activity-turn-group-events")).toBeTruthy();
  });

  it("auto-expands a newly arrived latest turn group while older groups stay collapsed", () => {
    const baseViewModel = createViewModel();
    baseViewModel.timeline = [
      {
        eventId: "command:cmd-initial",
        turnId: "turn-1",
        turnIndex: 1,
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        kind: "command",
        occurredAt: 1,
        summary: "Initial command",
        status: "completed",
        commandDescription: "Initial command",
        commandPreview: "done",
      },
    ];
    baseViewModel.isProcessing = false;
    baseViewModel.emptyState = "completed";
    baseViewModel.sessionSummaries = [
      {
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        eventCount: 1,
        isProcessing: false,
      },
    ];

    const { container, rerender } = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={baseViewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(getTurnGroup(container, 0)?.querySelector(".session-activity-turn-group-events")).toBeTruthy();

    const updatedViewModel = createViewModel();
    updatedViewModel.timeline = [
      ...baseViewModel.timeline,
      {
        eventId: "command:cmd-latest",
        turnId: "turn-2",
        turnIndex: 2,
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        kind: "command",
        occurredAt: 20,
        summary: "Latest command",
        status: "running",
        commandDescription: "Latest command",
        commandPreview: "running",
      },
    ];
    updatedViewModel.isProcessing = true;
    updatedViewModel.emptyState = "running";
    updatedViewModel.sessionSummaries = [
      {
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        eventCount: 2,
        isProcessing: true,
      },
    ];

    rerender(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={updatedViewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(getTurnGroup(container, 0)?.querySelector(".session-activity-turn-group-events")).toBeTruthy();
    expect(getTurnGroup(container, 1)?.querySelector(".session-activity-turn-group-events")).toBeNull();
    expect(screen.getByRole("button", { name: /Latest command/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Initial command/i })).toBeNull();
  });

  it("collapses the previous turn when a new running reasoning turn arrives", () => {
    const initialViewModel = createViewModel();
    initialViewModel.timeline = [
      {
        eventId: "reasoning:reason-initial",
        turnId: "turn-1",
        turnIndex: 1,
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        kind: "reasoning",
        occurredAt: 1,
        summary: "Thinking · initial reasoning",
        status: "running",
        reasoningPreview: "initial reasoning preview",
      },
    ];
    initialViewModel.sessionSummaries = [
      {
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        eventCount: 1,
        isProcessing: true,
      },
    ];

    const { container, rerender } = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={initialViewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(getTurnGroup(container, 0)?.querySelector(".session-activity-turn-group-events")).toBeTruthy();

    const updatedViewModel = createViewModel();
    updatedViewModel.timeline = [
      {
        eventId: "reasoning:reason-latest",
        turnId: "turn-2",
        turnIndex: 2,
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        kind: "reasoning",
        occurredAt: 20,
        summary: "Thinking · latest reasoning",
        status: "running",
        reasoningPreview: "latest reasoning preview",
      },
      {
        eventId: "reasoning:reason-initial",
        turnId: "turn-1",
        turnIndex: 1,
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        kind: "reasoning",
        occurredAt: 1,
        summary: "Thinking · initial reasoning",
        status: "completed",
        reasoningPreview: "initial reasoning preview",
      },
    ];
    updatedViewModel.sessionSummaries = [
      {
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        eventCount: 2,
        isProcessing: true,
      },
    ];

    rerender(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={updatedViewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(getTurnGroup(container, 0)?.querySelector(".session-activity-turn-group-events")).toBeTruthy();
    expect(getTurnGroup(container, 1)?.querySelector(".session-activity-turn-group-events")).toBeNull();
    expect(screen.getByRole("button", { name: /Thinking · latest reasoning/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Thinking · initial reasoning/i })).toBeNull();
  });

  it("does not pass empty highlight markers when a file card has no parsed line ranges", () => {
    const onOpenDiffPath = vi.fn();
    const viewModel = createViewModel();
    viewModel.timeline = viewModel.timeline.map((event) =>
      event.kind === "fileChange"
        ? {
            ...event,
            fileChanges: event.fileChanges?.map((fileChange) =>
              fileChange.filePath === "src/App.tsx"
                ? {
                    ...fileChange,
                    line: undefined,
                    markers: { added: [], modified: [] },
                  }
                : fileChange,
            ),
            jumpTarget:
              event.jumpTarget?.type === "file"
                ? {
                    ...event.jumpTarget,
                    line: undefined,
                    markers: { added: [], modified: [] },
                  }
                : event.jumpTarget,
          }
        : event,
    );

    render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={onOpenDiffPath}
        onSelectThread={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /App\.tsx\+3-1/i }));

    expect(onOpenDiffPath).toHaveBeenCalledWith("src/App.tsx", undefined, undefined);
  });

  it("shows and filters the explore category independently", () => {
    render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={createViewModel()}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(screen.getByRole("tab", { name: /activityPanel\.tabs\.explore1/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /activityPanel\.tabs\.explore1/i }));

    expect(screen.getByRole("button", { name: /Search · activity panel/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Run focused test suite/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Task · Audit current panel/i })).toBeNull();
  });

  it("allows expanding task events when inspection preview is available", () => {
    const viewModel = createViewModel();
    viewModel.timeline = [
      {
        eventId: "task:search-preview-1",
        turnId: "turn-2",
        turnIndex: 2,
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        kind: "task",
        occurredAt: 99,
        summary: "Search · AGENTS.md",
        status: "completed",
        explorePreview: "https://developers.openai.com/codex/guides/agents-md",
        jumpTarget: { type: "thread", threadId: "root-thread" },
      },
    ];
    viewModel.isProcessing = false;
    viewModel.emptyState = "completed";
    viewModel.sessionSummaries = [
      {
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        eventCount: 1,
        isProcessing: false,
      },
    ];

    const { container } = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    const toggle = getPreviewToggleForKind(container, "task");
    expect(toggle).toBeTruthy();
    if (!toggle) {
      return;
    }
    fireEvent.click(toggle);

    expect(getPreviewTextForKind(container, "task")?.textContent).toContain("agents-md");
  });

  it("keeps completed explore run entries collapsed even when they carry command metadata", () => {
    const viewModel = createViewModel();
    viewModel.timeline = [
      {
        eventId: "explore:run:collapsed",
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        kind: "explore",
        occurredAt: 40,
        summary: "List · NO .codex",
        status: "completed",
        commandText: "List · NO .codex",
        commandDescription: "/Users/demo/.codex not found",
        jumpTarget: { type: "thread", threadId: "root-thread" },
      },
    ];
    viewModel.isProcessing = false;
    viewModel.emptyState = "completed";
    viewModel.sessionSummaries = [
      {
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        eventCount: 1,
        isProcessing: false,
      },
    ];

    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    const eventNode = view.container.querySelector(".session-activity-event-explore");
    expect(eventNode?.classList.contains("is-expanded")).toBe(false);
    expect(view.container.querySelector(".session-activity-preview-toggle")).toBeNull();
    expect(view.container.querySelector(".session-activity-preview-text")).toBeNull();
  });

  it("shows and filters the reasoning category independently", () => {
    render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={createViewModel()}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(screen.getByRole("tab", { name: /activityPanel\.tabs\.reasoning1/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /activityPanel\.tabs\.reasoning1/i }));

    expect(
      screen.getByRole("button", { name: /Thinking · compare recent panel states/i }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Search · activity panel/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Run focused test suite/i })).toBeNull();
  });

  it("pins reasoning to the top of the turn group in summary view", () => {
    const viewModel = createViewModel();

    render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    const latestGroup = getTurnGroup(document.body as unknown as HTMLElement, 0);
    const eventTitles = Array.from(
      latestGroup?.querySelectorAll(".session-activity-card-title") ?? [],
    ).map((node) => node.textContent?.trim() ?? "");

    expect(eventTitles[0]).toBe("messages.thinkingLabel");
  });

  it("keeps reasoning items in chronological order within the reasoning block", () => {
    const viewModel = createViewModel();
    viewModel.timeline = [
      {
        eventId: "reasoning:reason-older",
        turnId: "turn-2",
        turnIndex: 2,
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        kind: "reasoning",
        occurredAt: 2,
        summary: "Thinking · first step",
        status: "completed",
        reasoningPreview: "first step preview",
      },
      {
        eventId: "reasoning:reason-newer",
        turnId: "turn-2",
        turnIndex: 2,
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        kind: "reasoning",
        occurredAt: 4,
        summary: "Thinking · second step",
        status: "completed",
        reasoningPreview: "second step preview",
      },
      ...createViewModel().timeline.filter((event) => event.kind !== "reasoning"),
    ];

    render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    const latestGroup = getTurnGroup(document.body as unknown as HTMLElement, 0);
    const reasoningButtons = Array.from(
      latestGroup?.querySelectorAll(
        ".session-activity-event-reasoning .session-activity-card-main",
      ) ?? [],
    );
    const reasoningAriaLabels = reasoningButtons.map((node) =>
      node.getAttribute("aria-label") ?? "",
    );

    expect(reasoningAriaLabels[0]).toContain("first step");
    expect(reasoningAriaLabels[1]).toContain("second step");
  });

  it("supports expanding explore events when detail preview exists", () => {
    const viewModel = createViewModel();
    viewModel.timeline = [
      {
        eventId: "explore-read-preview-1",
        turnId: "turn-1",
        turnIndex: 1,
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        kind: "explore",
        occurredAt: 40,
        summary: "Read · 读取策略",
        status: "completed",
        explorePreview: "优先读取该目录，再回退到工作区默认 openspec。",
        jumpTarget: { type: "thread", threadId: "root-thread" },
      },
    ];

    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    const previewToggle = view.container.querySelector(".session-activity-preview-toggle");
    expect(previewToggle).toBeTruthy();
    fireEvent.click(previewToggle as HTMLElement);
    expect(view.container.querySelector(".session-activity-preview-text")?.textContent).toContain(
      "优先读取该目录",
    );
  });

  it("does not expand read explore events when the preview is a file path and opens the file instead", () => {
    const onOpenDiffPath = vi.fn();
    const viewModel = createViewModel();
    viewModel.timeline = [
      {
        eventId: "explore-read-path-1",
        turnId: "turn-1",
        turnIndex: 1,
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        kind: "explore",
        occurredAt: 40,
        summary: "Read · Cargo.toml",
        status: "completed",
        explorePreview: "src-tauri/Cargo.toml",
        jumpTarget: { type: "file", path: "src-tauri/Cargo.toml" },
      },
    ];

    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={onOpenDiffPath}
        onSelectThread={vi.fn()}
      />,
    );

    expect(view.container.querySelector(".session-activity-preview-toggle")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Read · Cargo\.toml/i }));

    expect(onOpenDiffPath).toHaveBeenCalledWith("src-tauri/Cargo.toml", undefined, undefined);
    expect(view.container.querySelector(".session-activity-preview-text")).toBeNull();
  });

  it("expands explore events for path-like preview text when jumpTarget is not a file", () => {
    const onSelectThread = vi.fn();
    const onOpenDiffPath = vi.fn();
    const viewModel = createViewModel();
    viewModel.timeline = [
      {
        eventId: "explore-pathlike-nonfile-1",
        turnId: "turn-1",
        turnIndex: 1,
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        kind: "explore",
        occurredAt: 41,
        summary: "List · 当前生效路径",
        status: "completed",
        explorePreview: "/Users/chenxiangning/code/AI/github/codemoss-openspec/openspec",
        jumpTarget: { type: "thread", threadId: "root-thread" },
      },
    ];

    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={onOpenDiffPath}
        onSelectThread={onSelectThread}
      />,
    );

    expect(view.container.querySelector(".session-activity-preview-toggle")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /List · 当前生效路径/i }));

    expect(view.container.querySelector(".session-activity-preview-text")?.textContent).toContain(
      "/Users/chenxiangning/code/AI/github/codemoss-openspec/openspec",
    );
    expect(onSelectThread).not.toHaveBeenCalled();
    expect(onOpenDiffPath).not.toHaveBeenCalled();
  });

  it("auto-expands reasoning while running and allows manual collapse/expand", () => {
    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={createViewModel()}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /activityPanel\.tabs\.reasoning1/i }));
    expect(view.container.querySelector(".session-activity-event-reasoning.is-expanded")).toBeTruthy();
    expect(view.container.querySelector(".session-activity-preview-text")?.textContent).toContain(
      "Memo 实体",
    );

    const previewToggle = getPreviewToggleForKind(view.container, "reasoning");
    expect(previewToggle).toBeTruthy();
    if (!previewToggle) {
      return;
    }
    fireEvent.click(previewToggle);
    expect(view.container.querySelector(".session-activity-event-reasoning.is-expanded")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Thinking · compare recent panel states/i }));
    expect(view.container.querySelector(".session-activity-event-reasoning.is-expanded")).toBeTruthy();
  });

  it("renders running reasoning preview with markdown formatting", () => {
    const viewModel = createViewModel();
    viewModel.timeline = viewModel.timeline.map((event) =>
      event.kind === "reasoning"
        ? {
            ...event,
            reasoningPreview:
              "当前问题：\n1. **异常处理不规范**\n2. `LogEntry` 设计混用\n\n重构计划：\n1. 新建 DTO\n2. 完善测试",
          }
        : event,
    );

    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /activityPanel\.tabs\.reasoning1/i }));

    expect(view.container.querySelector(".session-activity-preview-markdown.markdown-live-streaming")).toBeTruthy();
    expect(view.container.querySelector(".session-activity-reasoning-surface")).toBeTruthy();
    expect(view.container.querySelector(".session-activity-preview-markdown strong")?.textContent).toBe(
      "异常处理不规范",
    );
    expect(view.container.querySelector(".session-activity-preview-markdown code")?.textContent).toBe(
      "LogEntry",
    );
    expect(view.container.querySelectorAll(".session-activity-preview-markdown ol li")).toHaveLength(4);
  });

  it("preserves soft line breaks in running reasoning preview", async () => {
    const viewModel = createViewModel();
    viewModel.timeline = viewModel.timeline.map((event) =>
      event.kind === "reasoning"
        ? {
            ...event,
            reasoningPreview: "第一行\n第二行\n第三行",
          }
        : event,
    );

    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /activityPanel\.tabs\.reasoning1/i }));

    await waitFor(() => {
      expect(view.container.querySelectorAll(".session-activity-preview-markdown br").length).toBe(2);
    });
  });

  it("pins running reasoning preview to the bottom while streaming updates", () => {
    const initialViewModel = createViewModel();
    initialViewModel.timeline = initialViewModel.timeline.map((event) =>
      event.kind === "reasoning"
        ? {
            ...event,
            reasoningPreview: "第一段\n第二段",
          }
        : event,
    );

    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={initialViewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /activityPanel\.tabs\.reasoning1/i }));

    const preview = view.container.querySelector(
      ".session-activity-event-reasoning .session-activity-preview-text.is-markdown",
    ) as HTMLDivElement | null;
    expect(preview).toBeTruthy();
    if (!preview) {
      return;
    }

    let mockedScrollHeight = 360;
    Object.defineProperty(preview, "scrollHeight", {
      configurable: true,
      get: () => mockedScrollHeight,
    });
    const scrollToSpy = vi.fn();
    Object.defineProperty(preview, "scrollTo", {
      configurable: true,
      value: scrollToSpy,
    });

    mockedScrollHeight = 720;
    const updatedViewModel = createViewModel();
    updatedViewModel.timeline = updatedViewModel.timeline.map((event) =>
      event.kind === "reasoning"
        ? {
            ...event,
            reasoningPreview: "第一段\n第二段\n第三段\n第四段",
          }
        : event,
    );

    view.rerender(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={updatedViewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(scrollToSpy).toHaveBeenCalledWith({ top: 720, behavior: "auto" });
  });

  it("resumes reasoning auto-follow after user scrolls back to the bottom", () => {
    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={createViewModel()}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /activityPanel\.tabs\.reasoning1/i }));

    const preview = view.container.querySelector(
      ".session-activity-event-reasoning .session-activity-preview-text.is-markdown",
    ) as HTMLDivElement | null;
    expect(preview).toBeTruthy();
    if (!preview) {
      return;
    }

    const mockedScrollHeight = 720;
    let mockedScrollTop = 0;
    Object.defineProperty(preview, "scrollHeight", {
      configurable: true,
      get: () => mockedScrollHeight,
    });
    Object.defineProperty(preview, "clientHeight", {
      configurable: true,
      get: () => 100,
    });
    Object.defineProperty(preview, "scrollTop", {
      configurable: true,
      get: () => mockedScrollTop,
      set: (value: number) => {
        mockedScrollTop = value;
      },
    });
    const scrollToSpy = vi.fn();
    Object.defineProperty(preview, "scrollTo", {
      configurable: true,
      value: scrollToSpy,
    });

    // 用户上滚超过阈值(48px) → 暂停自动跟随并展示「回到底部」入口
    fireEvent.scroll(preview);
    expect(screen.getByRole("button", { name: "messages.backToBottom" })).toBeTruthy();

    // 暂停期间流式更新不再触发滚底
    scrollToSpy.mockClear();
    const updatedViewModel = createViewModel();
    updatedViewModel.timeline = updatedViewModel.timeline.map((event) =>
      event.kind === "reasoning"
        ? {
            ...event,
            reasoningPreview: "第一段\n第二段\n第三段\n第四段",
          }
        : event,
    );
    view.rerender(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={updatedViewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );
    expect(scrollToSpy).not.toHaveBeenCalled();

    // 用户滚回底部 → 暂停标记清除,自动跟随恢复并立即滚底
    mockedScrollTop = mockedScrollHeight - 100;
    fireEvent.scroll(preview);
    expect(screen.queryByRole("button", { name: "messages.backToBottom" })).toBeNull();
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 720, behavior: "auto" });
  });

  it("only auto-expands the latest running reasoning item", () => {
    const viewModel = createViewModel();
    viewModel.timeline.push({
      eventId: "reasoning:reason-older",
      turnId: "turn-2",
      turnIndex: 2,
      threadId: "root-thread",
      threadName: "Root session",
      sessionRole: "root",
      relationshipSource: "directParent",
      kind: "reasoning",
      occurredAt: 3,
      summary: "Thinking · older reasoning should stay collapsed",
      status: "running",
      reasoningPreview: "older reasoning",
    });

    render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /activityPanel\.tabs\.reasoning2/i }));

    const latestReasoningCard = screen
      .getByRole("button", { name: /Thinking · compare recent panel states/i })
      .closest(".session-activity-event-reasoning");
    const olderReasoningCard = screen
      .getByRole("button", { name: /Thinking · older reasoning should stay collapsed/i })
      .closest(".session-activity-event-reasoning");

    expect(latestReasoningCard?.classList.contains("is-expanded")).toBe(true);
    expect(olderReasoningCard?.classList.contains("is-expanded")).toBe(false);
  });

  it("keeps running reasoning expanded for at least 2s, then auto-collapses after completion", () => {
    vi.useFakeTimers();
    const { container, rerender } = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={createViewModel()}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(container.querySelector(".session-activity-event-reasoning.is-expanded")).toBeTruthy();

    const completedViewModel = createViewModel();
    completedViewModel.isProcessing = false;
    completedViewModel.emptyState = "completed";
    completedViewModel.timeline = completedViewModel.timeline.map((event) =>
      event.kind === "reasoning"
        ? {
            ...event,
            status: "completed" as const,
            reasoningPreview: `${event.reasoningPreview}\nDone`,
          }
        : event,
    );

    rerender(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={completedViewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(container.querySelector(".session-activity-event-reasoning.is-expanded")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1999);
    });

    expect(container.querySelector(".session-activity-event-reasoning.is-expanded")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(container.querySelector(".session-activity-event-reasoning.is-expanded")).toBeNull();
    vi.useRealTimers();
  });

  it("uses command card click to expand and collapse inline output", () => {
    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={createViewModel()}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(getPreviewTextForKind(view.container, "command")?.textContent).toBe(
      "stderr line\nstdout tail",
    );
    expect(
      getEventNode(view.container, "command")?.querySelector(".session-activity-card-title")
        ?.textContent,
    ).toBe(
      "Run focused test suite",
    );
    expect(view.container.querySelector(".session-activity-command-value")?.textContent).toContain(
      "pnpm vitest --runInBand",
    );
    expect(view.container.querySelector(".session-activity-command-copy")).toBeNull();
    const expandedHeaderCopy = view.container.querySelector(
      ".session-activity-event-command.is-expanded .session-activity-card-copy",
    );
    expect(expandedHeaderCopy).toBeTruthy();
    expect(expandedHeaderCopy?.textContent).toContain("Run focused test suite");
    expect(expandedHeaderCopy?.textContent).toContain("activityPanel.status.running");
    expect(screen.queryByText("activityPanel.hideOutput")).toBeNull();
    expect(screen.queryByText("activityPanel.showOutput")).toBeNull();

    const previewToggle = getPreviewToggleForKind(view.container, "command");
    expect(previewToggle).toBeTruthy();
    if (!previewToggle) {
      return;
    }
    fireEvent.click(previewToggle);
    expect(getPreviewTextForKind(view.container, "command")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Run focused test suite/i }));
    const previewText = getPreviewTextForKind(view.container, "command");
    expect(previewText?.textContent).toBe("stderr line\nstdout tail");

    fireEvent.click(screen.getByRole("button", { name: /Run focused test suite/i }));
    expect(getPreviewTextForKind(view.container, "command")).toBeNull();
  });

  it("falls back to command text when command description is missing", () => {
    const viewModel = createViewModel();
    viewModel.timeline = viewModel.timeline.map((event) =>
      event.kind === "command"
        ? {
            ...event,
            commandDescription: "",
          }
        : event,
    );

    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(
      getEventNode(view.container, "command")?.querySelector(".session-activity-card-title")
        ?.textContent,
    ).toBe("activityPanel.commandCategories.test · pnpm vitest --runInBand");
  });

  it("hides placeholder command detail row when command text is generic", () => {
    const viewModel = createViewModel();
    viewModel.timeline = viewModel.timeline.map((event) =>
      event.kind === "command"
        ? {
            ...event,
            commandDescription: "",
            commandText: "Command",
          }
        : event,
    );

    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    const commandEventNode = getEventNode(view.container, "command");
    const commandDetailRows = Array.from(
      commandEventNode?.querySelectorAll(".session-activity-command-row") ?? [],
    );
    const commandRow = commandDetailRows.find(
      (row) =>
        row.querySelector(".session-activity-command-label")?.textContent ===
        "activityPanel.command",
    );

    expect(commandRow).toBeUndefined();
  });

  it("normalizes wrapped shell command and adds category in collapsed command title", () => {
    const viewModel = createViewModel();
    viewModel.timeline = viewModel.timeline.map((event) =>
      event.kind === "command"
        ? {
            ...event,
            commandDescription: "",
            commandText:
              "/bin/zsh -lc \"zsh -lc 'source ~/.zshrc && rg -n \\\"TODO\\\" src'\"",
          }
        : event,
    );

    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(
      getEventNode(view.container, "command")?.querySelector(".session-activity-card-title")
        ?.textContent,
    ).toBe("activityPanel.commandCategories.search · rg -n \\\"TODO\\\" src");
  });

  it("normalizes wrapped Windows shell command and adds category in collapsed command title", () => {
    const viewModel = createViewModel();
    viewModel.timeline = viewModel.timeline.map((event) =>
      event.kind === "command"
        ? {
            ...event,
            commandDescription: "",
            commandText:
              "\"C:\\\\Program Files\\\\Git\\\\bin\\\\bash.exe\" -lc \"zsh -lc 'source ~/.zshrc && rg -n \\\\\\\"TODO\\\\\\\" src'\"",
          }
        : event,
    );

    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(
      getEventNode(view.container, "command")?.querySelector(".session-activity-card-title")
        ?.textContent,
    ).toBe("activityPanel.commandCategories.search · rg -n \\\"TODO\\\" src");
  });

  it("classifies wc command as read in collapsed command title", () => {
    const viewModel = createViewModel();
    viewModel.timeline = viewModel.timeline.map((event) =>
      event.kind === "command"
        ? {
            ...event,
            commandDescription: "",
            commandText: "wc -l /workspace/CHANGELOG.md",
          }
        : event,
    );

    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(
      getEventNode(view.container, "command")?.querySelector(".session-activity-card-title")
        ?.textContent,
    ).toBe("activityPanel.commandCategories.read · wc -l /workspace/CHANGELOG.md");
  });

  it("classifies find command as list in collapsed command title", () => {
    const viewModel = createViewModel();
    viewModel.timeline = viewModel.timeline.map((event) =>
      event.kind === "command"
        ? {
            ...event,
            commandDescription: "",
            commandText: "find src -maxdepth 2",
          }
        : event,
    );

    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(
      getEventNode(view.container, "command")?.querySelector(".session-activity-card-title")
        ?.textContent,
    ).toBe("activityPanel.commandCategories.list · find src -maxdepth 2");
  });

  it("keeps running commands expanded for at least 2s, then auto-collapses after completion", () => {
    vi.useFakeTimers();
    const { container, rerender } = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={createViewModel()}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(container.querySelector(".session-activity-event-command.is-expanded")).toBeTruthy();

    const completedViewModel = createViewModel();
    completedViewModel.isProcessing = false;
    completedViewModel.emptyState = "completed";
    completedViewModel.timeline = completedViewModel.timeline.map((event) =>
      event.kind === "command"
        ? {
            ...event,
            status: "completed" as const,
            commandPreview: "stderr line\nstdout tail\nDone",
          }
        : event,
    );

    rerender(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={completedViewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(container.querySelector(".session-activity-event-command.is-expanded")).toBeTruthy();
    expect(getPreviewTextForKind(container, "command")?.textContent).toBe(
      "stderr line\nstdout tail\nDone",
    );

    act(() => {
      vi.advanceTimersByTime(1999);
    });

    expect(container.querySelector(".session-activity-event-command.is-expanded")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(container.querySelector(".session-activity-event-command.is-expanded")).toBeNull();
    expect(getPreviewTextForKind(container, "command")).toBeNull();
    vi.useRealTimers();
  });

  it("allows manually expanding a completed command after auto-collapse", () => {
    const completedViewModel = createViewModel();
    completedViewModel.isProcessing = false;
    completedViewModel.emptyState = "completed";
    completedViewModel.timeline = completedViewModel.timeline.map((event) =>
      event.kind === "command"
        ? {
            ...event,
            status: "completed" as const,
            commandPreview: "stderr line\nstdout tail\nDone",
          }
        : event,
    );

    const { container } = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={completedViewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(container.querySelector(".session-activity-event-command.is-expanded")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Run focused test suite/i }));

    expect(container.querySelector(".session-activity-event-command.is-expanded")).toBeTruthy();
    expect(getPreviewTextForKind(container, "command")?.textContent).toBe(
      "stderr line\nstdout tail\nDone",
    );
  });

  it("keeps expanded running commands live even before output arrives", () => {
    const waitingViewModel = createViewModel();
    waitingViewModel.timeline = waitingViewModel.timeline.map((event) =>
      event.kind === "command"
        ? {
            ...event,
            commandPreview: "",
            commandText: "",
            commandDescription: "",
            commandWorkingDirectory: "",
          }
        : event,
    );

    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={waitingViewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(getPreviewTextForKind(view.container, "command")?.textContent).toContain(
      "activityPanel.waitingForOutput",
    );
    expect(
      getEventNode(view.container, "command")?.querySelector(".session-activity-card-title")
        ?.textContent,
    ).toBe(
      "activityPanel.commandPendingSummary",
    );

    const updatedViewModel = createViewModel();
    updatedViewModel.timeline = updatedViewModel.timeline.map((event) =>
      event.kind === "command"
        ? {
            ...event,
            commandPreview: "line 1\nline 2",
            commandText: "",
            commandDescription: "",
            commandWorkingDirectory: "",
          }
        : event,
    );

    view.rerender(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={updatedViewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(getPreviewTextForKind(view.container, "command")?.textContent).toBe(
      "line 1\nline 2",
    );
  });

  it("renders command output as markdown when reading markdown files", () => {
    const viewModel = createViewModel();
    viewModel.timeline = viewModel.timeline.map((event) =>
      event.kind === "command"
        ? {
            ...event,
            commandText: "cat README.md",
            commandPreview: "# Title\n\n- item",
            status: "completed" as const,
          }
        : event,
    );
    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Run focused test suite/i }));

    expect(
      view.container.querySelector(".session-activity-event-command .session-activity-preview-text.is-command-markdown"),
    ).toBeTruthy();
    expect(
      view.container.querySelector(".session-activity-event-command .session-activity-preview-markdown h1")
        ?.textContent,
    ).toBe("Title");
  });

  it("renders command output as code when reading source files", () => {
    const viewModel = createViewModel();
    viewModel.timeline = viewModel.timeline.map((event) =>
      event.kind === "command"
        ? {
            ...event,
            commandText:
              'sed -n "1,240p" src/main/java/com/example/springbootdemo123/user/UserController.java',
            commandPreview: "public class UserController {}",
            status: "completed" as const,
          }
        : event,
    );
    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Run focused test suite/i }));
    expect(
      view.container.querySelector(".session-activity-event-command .session-activity-preview-text.is-command-code"),
    ).toBeTruthy();
    expect(
      view.container.querySelector(".session-activity-event-command .session-activity-preview-text.is-command-code .token"),
    ).toBeTruthy();
  });

  it("renders command output as code when reading xml files", () => {
    const viewModel = createViewModel();
    viewModel.timeline = viewModel.timeline.map((event) =>
      event.kind === "command"
        ? {
            ...event,
            commandText: `/bin/zsh -lc "zsh -lc 'source ~/.zshrc && cat pom.xml'"`,
            commandPreview:
              '<?xml version="1.0" encoding="UTF-8"?>\n<project>\n  <modelVersion>4.0.0</modelVersion>\n</project>',
            status: "completed" as const,
          }
        : event,
    );
    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Run focused test suite/i }));

    expect(
      view.container.querySelector(".session-activity-event-command .session-activity-preview-text.is-command-code"),
    ).toBeTruthy();
    expect(
      view.container.querySelector(".session-activity-event-command .session-activity-preview-text.is-command-code .token.tag"),
    ).toBeTruthy();
  });

  it("uses session pills to jump directly to a related thread", () => {
    const onSelectThread = vi.fn();

    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={createViewModel()}
        onOpenDiffPath={vi.fn()}
        onSelectThread={onSelectThread}
      />,
    );

    const sessionPills = view.container.querySelectorAll(".session-activity-session-pill");
    expect(sessionPills).toHaveLength(1);
    expect(sessionPills[0]?.textContent).not.toContain("Child session");
    expect(sessionPills[0]?.textContent).toContain("activityPanel.fallbackLinking");
    fireEvent.click(sessionPills[0] as HTMLButtonElement);
    expect(onSelectThread).toHaveBeenCalledWith("workspace-1", "child-thread");
  });

  it("keeps child session pills visible when realtime summaries temporarily drop", () => {
    const viewModel = createViewModel();
    const { container, rerender } = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(container.querySelectorAll(".session-activity-session-pill")).toHaveLength(1);

    const rootOnlyViewModel: WorkspaceSessionActivityViewModel = {
      ...viewModel,
      sessionSummaries: viewModel.sessionSummaries.filter((session) => session.sessionRole === "root"),
    };

    act(() => {
      rerender(
        <WorkspaceSessionActivityPanel
          workspaceId="workspace-1"
          viewModel={rootOnlyViewModel}
          onOpenDiffPath={vi.fn()}
          onSelectThread={vi.fn()}
        />,
      );
    });

    const sessionPills = container.querySelectorAll(".session-activity-session-pill");
    expect(sessionPills).toHaveLength(1);
    expect(sessionPills[0]?.textContent).not.toContain("Child session");
  });

  it("caps related child session pills at ten and exposes the full set on hover", () => {
    const viewModel = createViewModel();
    viewModel.sessionSummaries = [
      viewModel.sessionSummaries[0],
      ...Array.from({ length: 12 }, (_, index) => ({
        threadId: `child-thread-${index + 1}`,
        threadName: `Child session ${index + 1}`,
        sessionRole: "child" as const,
        relationshipSource: "fallbackLinking" as const,
        eventCount: 100 - index,
        isProcessing: false,
      })),
    ];

    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    const visibleSessionPills = view.container.querySelectorAll(
      '.session-activity-session-pill[role="button"]',
    );
    expect(visibleSessionPills).toHaveLength(10);

    const overflowSessionPill = view.container.querySelector(".session-activity-session-pill.is-overflow");
    expect(overflowSessionPill).toBeTruthy();
    expect(overflowSessionPill?.textContent).toBe("+2");
    expect(overflowSessionPill?.getAttribute("title")).toContain("activityPanel.childSession 11");
    expect(overflowSessionPill?.getAttribute("title")).toContain("activityPanel.childSession 12");
  });

  it("renders a time label for each activity item", () => {
    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={createViewModel()}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    const timeLabels = view.container.querySelectorAll(".session-activity-card-time");
    expect(timeLabels).toHaveLength(4);
    for (const label of timeLabels) {
      expect(label.textContent).toMatch(/\d{2}:\d{2}:\d{2}/);
    }
  });

  it("filters activity list by tab kind", () => {
    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={createViewModel()}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(view.container.querySelectorAll(".session-activity-event")).toHaveLength(4);
    fireEvent.click(screen.getByRole("tab", { name: /activityPanel\.tabs\.file/i }));
    expect(view.container.querySelectorAll(".session-activity-event")).toHaveLength(0);
    expect(view.container.querySelector(".session-activity-turn-artifacts")).toBeTruthy();
    expect(view.container.querySelector(".session-activity-event-command")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /activityPanel\.tabs\.explore/i }));
    expect(view.container.querySelectorAll(".session-activity-event")).toHaveLength(1);
    expect(view.container.querySelector(".session-activity-event-explore")).toBeTruthy();
    expect(view.container.querySelector(".session-activity-event-task")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /activityPanel\.tabs\.reasoning/i }));
    expect(view.container.querySelectorAll(".session-activity-event")).toHaveLength(1);
    expect(view.container.querySelector(".session-activity-event-reasoning")).toBeTruthy();
  });

  it("hides zero-count tabs and falls back to all when current tab becomes hidden", () => {
    const initialViewModel = createViewModel();
    initialViewModel.timeline = initialViewModel.timeline.filter(
      (event) => event.kind === "reasoning",
    );

    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={initialViewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(screen.queryByRole("tab", { name: /activityPanel\.tabs\.command/i })).toBeNull();
    expect(screen.queryByRole("tab", { name: /activityPanel\.tabs\.file/i })).toBeNull();
    expect(screen.queryByRole("tab", { name: /activityPanel\.tabs\.task/i })).toBeNull();
    expect(screen.queryByRole("tab", { name: /activityPanel\.tabs\.explore/i })).toBeNull();
    expect(screen.getByRole("tab", { name: /activityPanel\.tabs\.reasoning1/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /activityPanel\.tabs\.reasoning1/i }));

    const updatedViewModel = createViewModel();
    updatedViewModel.timeline = updatedViewModel.timeline.filter(
      (event) => event.kind === "command",
    );

    view.rerender(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={updatedViewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(screen.queryByRole("tab", { name: /activityPanel\.tabs\.reasoning/i })).toBeNull();
    expect(screen.getByRole("tab", { name: /activityPanel\.tabs\.command1/i })).toBeTruthy();
    expect(view.container.querySelectorAll(".session-activity-event")).toHaveLength(1);
    expect(view.container.querySelector(".session-activity-event-command")).toBeTruthy();
  });

  it("renders an explicit live edit preview toggle when provided", () => {
    const onToggleLiveEditPreview = vi.fn();

    render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={createViewModel()}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
        liveEditPreviewEnabled
        onToggleLiveEditPreview={onToggleLiveEditPreview}
      />,
    );

    const toggle = screen.getByRole("button", { name: "activityPanel.liveEditPreview" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.className).toContain("session-activity-live-edit-toggle");
    expect(toggle.className).toContain("is-active");
    expect(toggle.getAttribute("title")).toBe("activityPanel.disableLiveEditPreview");
    fireEvent.click(toggle);
    expect(onToggleLiveEditPreview).toHaveBeenCalledTimes(1);
  });

  it("keeps live edit preview toggle in inactive state by default", () => {
    const onToggleLiveEditPreview = vi.fn();

    render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={createViewModel()}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
        liveEditPreviewEnabled={false}
        onToggleLiveEditPreview={onToggleLiveEditPreview}
      />,
    );

    const toggle = screen.getByRole("button", { name: "activityPanel.liveEditPreview" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.className).toContain("session-activity-live-edit-toggle");
    expect(toggle.className).not.toContain("is-active");
    expect(toggle.getAttribute("title")).toBe("activityPanel.liveEditPreviewTooltip");
    fireEvent.click(toggle);
    expect(onToggleLiveEditPreview).toHaveBeenCalledTimes(1);
  });

  it("shows follow coach once and remembers dismissal per workspace", () => {
    const onToggleLiveEditPreview = vi.fn();
    const viewModel = createViewModel();
    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
        liveEditPreviewEnabled={false}
        onToggleLiveEditPreview={onToggleLiveEditPreview}
      />,
    );

    expect(screen.getByText("activityPanel.followCoachBody")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "activityPanel.followCoachDismiss" }));
    expect(screen.queryByText("activityPanel.followCoachBody")).toBeNull();

    view.rerender(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
        liveEditPreviewEnabled={false}
        onToggleLiveEditPreview={onToggleLiveEditPreview}
      />,
    );

    expect(screen.queryByText("activityPanel.followCoachBody")).toBeNull();
  });

  it("auto-dismisses follow coach after 8 seconds without permanent suppression", () => {
    vi.useFakeTimers();
    try {
      const onToggleLiveEditPreview = vi.fn();
      const viewModel = createViewModel();
      const view = render(
        <WorkspaceSessionActivityPanel
          workspaceId="workspace-1"
          viewModel={viewModel}
          onOpenDiffPath={vi.fn()}
          onSelectThread={vi.fn()}
          liveEditPreviewEnabled={false}
          onToggleLiveEditPreview={onToggleLiveEditPreview}
        />,
      );

      expect(screen.getByText("activityPanel.followCoachBody")).toBeTruthy();

      act(() => {
        vi.advanceTimersByTime(7999);
      });
      expect(screen.getByText("activityPanel.followCoachBody")).toBeTruthy();

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(screen.queryByText("activityPanel.followCoachBody")).toBeNull();

      // 自动消失不写入永久 dismiss，仅显式 dismiss 才记录
      expect(
        window.localStorage.getItem(SOLO_FOLLOW_COACH_DISMISSED_BY_WORKSPACE_STORAGE_KEY),
      ).toBeNull();
      expect(onToggleLiveEditPreview).not.toHaveBeenCalled();

      // 同 workspace 重新挂载后 coach 可再次展示
      view.unmount();
      render(
        <WorkspaceSessionActivityPanel
          workspaceId="workspace-1"
          viewModel={viewModel}
          onOpenDiffPath={vi.fn()}
          onSelectThread={vi.fn()}
          liveEditPreviewEnabled={false}
          onToggleLiveEditPreview={onToggleLiveEditPreview}
        />,
      );
      expect(screen.getByText("activityPanel.followCoachBody")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows follow nudge for file-change and suppresses repeats within the same turn", () => {
    const onToggleLiveEditPreview = vi.fn();
    const viewModel = createViewModel();
    dismissSoloFollowCoachForWorkspace("workspace-1");
    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
        liveEditPreviewEnabled={false}
        onToggleLiveEditPreview={onToggleLiveEditPreview}
      />,
    );

    expect(screen.getByText("activityPanel.followNudgeBody")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "activityPanel.followNudgeLater" }));
    expect(screen.queryByText("activityPanel.followNudgeBody")).toBeNull();

    view.rerender(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
        liveEditPreviewEnabled={false}
        onToggleLiveEditPreview={onToggleLiveEditPreview}
      />,
    );

    expect(screen.queryByText("activityPanel.followNudgeBody")).toBeNull();

    const nextTurnViewModel = createViewModel();
    nextTurnViewModel.timeline = [
      {
        eventId: "file:file-2",
        turnId: "turn-3",
        turnIndex: 3,
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        kind: "fileChange",
        occurredAt: 40,
        summary: "File change · src/NewFile.ts",
        status: "completed",
        fileChangeStatusLetter: "A",
        jumpTarget: { type: "file", path: "src/NewFile.ts", line: 3 },
        additions: 6,
        deletions: 0,
        filePath: "src/NewFile.ts",
      },
      ...nextTurnViewModel.timeline,
    ];

    view.rerender(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={nextTurnViewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
        liveEditPreviewEnabled={false}
        onToggleLiveEditPreview={onToggleLiveEditPreview}
      />,
    );

    expect(screen.getByText("activityPanel.followNudgeBody")).toBeTruthy();
  });

  it("auto-dismisses follow nudge after 8 seconds", () => {
    vi.useFakeTimers();
    try {
      const onToggleLiveEditPreview = vi.fn();
      const viewModel = createViewModel();
      dismissSoloFollowCoachForWorkspace("workspace-1");
      const view = render(
        <WorkspaceSessionActivityPanel
          workspaceId="workspace-1"
          viewModel={viewModel}
          onOpenDiffPath={vi.fn()}
          onSelectThread={vi.fn()}
          liveEditPreviewEnabled={false}
          onToggleLiveEditPreview={onToggleLiveEditPreview}
        />,
      );

      expect(screen.getByText("activityPanel.followNudgeBody")).toBeTruthy();

      act(() => {
        vi.advanceTimersByTime(8000);
      });

      expect(screen.queryByText("activityPanel.followNudgeBody")).toBeNull();

      view.rerender(
        <WorkspaceSessionActivityPanel
          workspaceId="workspace-1"
          viewModel={viewModel}
          onOpenDiffPath={vi.fn()}
          onSelectThread={vi.fn()}
          liveEditPreviewEnabled={false}
          onToggleLiveEditPreview={onToggleLiveEditPreview}
        />,
      );

      expect(screen.queryByText("activityPanel.followNudgeBody")).toBeNull();
      expect(onToggleLiveEditPreview).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("enables live follow from nudge action", () => {
    const onToggleLiveEditPreview = vi.fn();
    dismissSoloFollowCoachForWorkspace("workspace-1");
    render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={createViewModel()}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
        liveEditPreviewEnabled={false}
        onToggleLiveEditPreview={onToggleLiveEditPreview}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "activityPanel.followNudgeEnable" }));
    expect(onToggleLiveEditPreview).toHaveBeenCalledTimes(1);
  });

  it("keeps activity panel scoped to current-task timeline", () => {
    render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={createViewModel()}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(screen.queryByRole("tab", { name: "activityPanel.radar.modeWorkspaceRadar" })).toBeNull();
    expect(screen.queryByText("activityPanel.radar.modeWorkspaceRadar")).toBeNull();
  });

  it("closes the diff preview modal with Escape and restores focus to the trigger card", () => {
    render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={createViewModel()}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    const trigger = screen.getAllByRole("button", { name: "git.previewModalAction" })[0]!;
    // jsdom 不会在 click 时自动聚焦，先显式聚焦以匹配真实浏览器行为
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "src/App.tsx" });
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "src/App.tsx" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps the diff preview open on Escape while dirty and surfaces the unsaved changes dialog", () => {
    render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={createViewModel()}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "git.previewModalAction" })[0]!);

    act(() => {
      const surfaceProps = mockEditableDiffReviewSurface.mock.lastCall?.[0] as {
        onDirtyChange?: (dirty: boolean) => void;
      };
      surfaceProps.onDirtyChange?.(true);
    });

    const dialog = screen.getByRole("dialog", { name: "src/App.tsx" });
    fireEvent.keyDown(dialog, { key: "Escape" });

    // 脏状态保留既有 UnsavedChangesDialog 拦截链，diff 预览不直接关闭
    // （alertdialog 弹出时 radix 会对背景应用 aria-hidden，故用 class 查询 diff 模态框）
    expect(screen.getByRole("alertdialog", { name: "files.unsavedChanges" })).toBeTruthy();
    expect(document.querySelector(".git-history-diff-modal")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "files.discardChangesAction" }));
    expect(screen.queryByRole("alertdialog", { name: "files.unsavedChanges" })).toBeNull();
    expect(document.querySelector(".git-history-diff-modal")).toBeNull();
  });

  it("supports arrow-key navigation with roving tabindex on category tabs", () => {
    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={createViewModel()}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    const allTab = screen.getByRole("tab", { name: /activityPanel\.tabs\.all/i });
    expect(allTab.getAttribute("tabindex")).toBe("0");

    fireEvent.keyDown(allTab, { key: "ArrowRight" });

    const commandTab = screen.getByRole("tab", { name: /activityPanel\.tabs\.command/i });
    expect(commandTab.getAttribute("aria-selected")).toBe("true");
    expect(commandTab.getAttribute("tabindex")).toBe("0");
    expect(allTab.getAttribute("aria-selected")).toBe("false");
    expect(allTab.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(commandTab);
    expect(view.container.querySelectorAll(".session-activity-event-command")).toHaveLength(1);

    fireEvent.keyDown(commandTab, { key: "ArrowLeft" });

    expect(allTab.getAttribute("aria-selected")).toBe("true");
    expect(allTab.getAttribute("tabindex")).toBe("0");
    expect(document.activeElement).toBe(allTab);
  });

  it("pairs category tabs with the timeline tabpanel via aria-controls and aria-labelledby", () => {
    render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={createViewModel()}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    const allTab = screen.getByRole("tab", { name: /activityPanel\.tabs\.all/i });
    const tabpanel = document.getElementById("session-activity-tabpanel-workspace-1");
    expect(tabpanel).toBeTruthy();
    expect(allTab.getAttribute("aria-controls")).toBe(tabpanel?.id);
    expect(tabpanel?.getAttribute("aria-labelledby")).toBe(allTab.id);

    const reasoningTab = screen.getByRole("tab", { name: /activityPanel\.tabs\.reasoning/i });
    fireEvent.click(reasoningTab);
    expect(tabpanel?.getAttribute("aria-labelledby")).toBe(reasoningTab.id);
  });

  it("supports arrow-key navigation on turn artifact tabs with aria pairing", () => {
    render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={createViewModel()}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    const artifactsTab = screen.getByRole("tab", {
      name: "activityPanel.artifacts.tabs.artifacts",
    });
    const semanticTab = screen.getByRole("tab", {
      name: "activityPanel.artifacts.tabs.semantic",
    });
    expect(artifactsTab.getAttribute("tabindex")).toBe("0");
    expect(semanticTab.getAttribute("tabindex")).toBe("-1");

    const artifactsPanel = document.getElementById(
      "session-activity-artifact-panel-turn-2-artifacts",
    );
    expect(artifactsPanel).toBeTruthy();
    expect(artifactsTab.getAttribute("aria-controls")).toBe(artifactsPanel?.id);
    expect(artifactsPanel?.getAttribute("aria-labelledby")).toBe(artifactsTab.id);

    fireEvent.keyDown(artifactsTab, { key: "ArrowRight" });

    expect(semanticTab.getAttribute("aria-selected")).toBe("true");
    expect(semanticTab.getAttribute("tabindex")).toBe("0");
    expect(document.activeElement).toBe(semanticTab);

    const semanticPanel = document.getElementById(
      "session-activity-artifact-panel-turn-2-semantic",
    );
    expect(semanticPanel).toBeTruthy();
    expect(semanticTab.getAttribute("aria-controls")).toBe(semanticPanel?.id);
    expect(semanticPanel?.getAttribute("aria-labelledby")).toBe(semanticTab.id);
  });

  it("pauses reasoning auto-follow when the user scrolls up and resumes via the back-to-bottom button", () => {
    const initialViewModel = createViewModel();
    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={initialViewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /activityPanel\.tabs\.reasoning1/i }));

    const preview = view.container.querySelector(
      ".session-activity-event-reasoning .session-activity-preview-text.is-markdown",
    ) as HTMLDivElement | null;
    expect(preview).toBeTruthy();
    if (!preview) {
      return;
    }

    let mockedScrollHeight = 720;
    Object.defineProperty(preview, "scrollHeight", {
      configurable: true,
      get: () => mockedScrollHeight,
    });
    Object.defineProperty(preview, "clientHeight", {
      configurable: true,
      get: () => 360,
    });
    const scrollToSpy = vi.fn();
    Object.defineProperty(preview, "scrollTo", {
      configurable: true,
      value: scrollToSpy,
    });

    // 用户上滚超过 48px 阈值 → 暂停自动跟随并显示「回到底部」
    fireEvent.scroll(preview, { target: { scrollTop: 0 } });
    expect(screen.getByRole("button", { name: "messages.backToBottom" })).toBeTruthy();

    // 暂停期间流式更新不再自动滚底
    scrollToSpy.mockClear();
    mockedScrollHeight = 900;
    const pausedViewModel = createViewModel();
    pausedViewModel.timeline = pausedViewModel.timeline.map((event) =>
      event.kind === "reasoning"
        ? { ...event, reasoningPreview: `${event.reasoningPreview}\n第三段` }
        : event,
    );
    view.rerender(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={pausedViewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );
    expect(scrollToSpy).not.toHaveBeenCalled();

    // 点击「回到底部」恢复跟随
    fireEvent.click(screen.getByRole("button", { name: "messages.backToBottom" }));
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 900, behavior: "auto" });
    expect(screen.queryByRole("button", { name: "messages.backToBottom" })).toBeNull();

    // 后续流式更新恢复自动滚底
    scrollToSpy.mockClear();
    mockedScrollHeight = 1080;
    const resumedViewModel = createViewModel();
    resumedViewModel.timeline = resumedViewModel.timeline.map((event) =>
      event.kind === "reasoning"
        ? { ...event, reasoningPreview: `${event.reasoningPreview}\n第三段\n第四段` }
        : event,
    );
    view.rerender(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={resumedViewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 1080, behavior: "auto" });
  });

  it("shows event count and file change summary badges on collapsed turn group headers", () => {
    const viewModel = createViewModel();
    viewModel.timeline = [
      ...viewModel.timeline,
      {
        eventId: "file:file-older",
        turnId: "turn-1",
        turnIndex: 1,
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        kind: "fileChange",
        occurredAt: 2,
        summary: "File change · src/Old.tsx",
        status: "completed",
        fileChangeStatusLetter: "M",
        filePath: "src/Old.tsx",
        additions: 4,
        deletions: 2,
      },
      {
        eventId: "command:cmd-older",
        turnId: "turn-1",
        turnIndex: 1,
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        kind: "command",
        occurredAt: 1,
        summary: "Older command",
        status: "completed",
        commandDescription: "Older command",
        commandPreview: "older output",
      },
    ];

    const { container } = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    const olderGroup = getTurnGroup(container, 1);
    const olderHeader = olderGroup?.querySelector(
      ".session-activity-turn-group-header",
    ) as HTMLButtonElement | null;
    expect(olderHeader?.getAttribute("aria-expanded")).toBe("false");

    const badges = olderHeader?.querySelector(".session-activity-turn-group-summary-badges");
    expect(badges).toBeTruthy();
    expect(badges?.textContent).toContain("activityPanel.eventsCount");
    expect(badges?.querySelector(".is-add")?.textContent).toBe("+4");
    expect(badges?.querySelector(".is-del")?.textContent).toBe("-2");

    // 展开后摘要徽章隐藏
    if (!olderHeader) {
      return;
    }
    fireEvent.click(olderHeader);
    expect(
      getTurnGroup(container, 1)?.querySelector(".session-activity-turn-group-summary-badges"),
    ).toBeNull();
  });
});
