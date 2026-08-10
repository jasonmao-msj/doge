// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationItem, RequestUserInputRequest } from "../../../types";
import { Messages } from "./Messages";

vi.mock("./Markdown", () => ({
  Markdown: ({ value, className }: { value: string; className?: string }) => (
    <div className={className}>{value}</div>
  ),
}));

describe("Messages history loading", () => {
  beforeAll(() => {
    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = vi.fn();
    }
    if (!HTMLElement.prototype.scrollTo) {
      HTMLElement.prototype.scrollTo = vi.fn();
    }
  });

  beforeEach(() => {
    window.localStorage.setItem("doge.claude.hideReasoningModule", "0");
    window.localStorage.removeItem("doge.messages.live.autoFollow");
    window.localStorage.setItem("doge.messages.live.collapseMiddleSteps", "0");
  });

  afterEach(() => {
    cleanup();
  });

  it("shows history loading state instead of the empty thread placeholder", () => {
    render(
      <Messages
        items={[]}
        threadId="thread-codex-history-loading"
        workspaceId="ws-1"
        isThinking={false}
        isHistoryLoading
        activeEngine="codex"
        onUserInputSubmit={vi.fn()}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByText("messages.restoringHistory")).toBeTruthy();
    expect(screen.getByText("messages.restoringHistoryHint")).toBeTruthy();
    expect(screen.getByRole("progressbar")).toBeTruthy();
    expect(screen.queryByText("messages.emptyThread")).toBeNull();
  });

  it("shows Shared restore phase copy and determinate progress", () => {
    render(
      <Messages
        items={[]}
        threadId="shared:session-history-loading"
        workspaceId="ws-1"
        isThinking={false}
        isHistoryLoading
        historyLoadingProgress={{
          phase: "projection",
          percent: 58,
          titleKey: "restoringSharedHistory",
          detailKey: "restoringSharedHistoryProjection",
        }}
        activeEngine="claude"
        onUserInputSubmit={vi.fn()}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(screen.getByText("messages.restoringSharedHistory")).toBeTruthy();
    expect(
      screen.getByText("messages.restoringSharedHistoryProjection"),
    ).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "58",
    );
    expect(screen.getByText("58%")).toBeTruthy();
    expect(screen.queryByText("messages.emptyThread")).toBeNull();
  });

  it("shows the same restoring surface for Claude history loading", () => {
    render(
      <Messages
        items={[]}
        threadId="claude:session-history-loading"
        workspaceId="ws-1"
        isThinking={false}
        isHistoryLoading
        activeEngine="claude"
        onUserInputSubmit={vi.fn()}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByText("messages.restoringHistory")).toBeTruthy();
    expect(screen.queryByText("messages.emptyThread")).toBeNull();
  });

  it("keeps the empty thread placeholder when history is not loading", () => {
    render(
      <Messages
        items={[]}
        threadId="thread-empty"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="codex"
        onUserInputSubmit={vi.fn()}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(screen.getByText("messages.emptyThread")).toBeTruthy();
    expect(screen.queryByText("messages.restoringHistory")).toBeNull();
  });

  it("shows a bounded retry surface instead of empty-thread after history recovery fails", () => {
    const onRetryHistory = vi.fn();

    render(
      <Messages
        items={[]}
        threadId="thread-history-recovery-failed"
        workspaceId="ws-1"
        isThinking={false}
        historyRecoveryFailureReason="history-empty-after-retry"
        onRetryHistory={onRetryHistory}
        activeEngine="codex"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(screen.getByRole("alert", { name: "messages.threadRecoveryTitle" })).toBeTruthy();
    expect(screen.getByText("messages.threadRecoveryFailed")).toBeTruthy();
    expect(screen.queryByText("messages.emptyThread")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "messages.threadRecoveryAction" }),
    );
    expect(onRetryHistory).toHaveBeenCalledTimes(1);
  });

  it("does not show the Native recovery card for Shared sessions", () => {
    render(
      <Messages
        items={[]}
        threadId="shared:session-history-recovery-failed"
        workspaceId="ws-1"
        isThinking={false}
        historyRecoveryFailureReason="history-empty-after-retry"
        onRetryHistory={vi.fn()}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(
      screen.queryByRole("alert", { name: "messages.threadRecoveryTitle" }),
    ).toBeNull();
    expect(screen.queryByText("messages.threadRecoveryFailed")).toBeNull();
    expect(screen.getByText("messages.emptyThread")).toBeTruthy();
  });

  it("keeps last-good history visible beside the recovery failure surface", () => {
    render(
      <Messages
        items={[
          {
            id: "assistant-last-good",
            kind: "message",
            role: "assistant",
            text: "上一次成功恢复的消息",
            isFinal: true,
          },
        ]}
        threadId="thread-history-partial-recovery"
        workspaceId="ws-1"
        isThinking={false}
        historyRecoveryFailureReason="history-partial-after-retry"
        activeEngine="codex"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(screen.getByText("上一次成功恢复的消息")).toBeTruthy();
    expect(screen.getByText("messages.threadRecoveryFailed")).toBeTruthy();
    expect(screen.queryByText("messages.emptyThread")).toBeNull();
  });

  it("keeps Claude transcript-heavy history readable via file tools when assistant text is sparse", () => {
    const readTools: ConversationItem[] = [
      {
        id: "tool-1",
        kind: "tool",
        toolType: "mcpToolCall",
        title: "Read README.md",
        detail: JSON.stringify({ path: "README.md" }),
        status: "completed",
        output: "README.md\nsrc\n",
      },
      {
        id: "tool-2",
        kind: "tool",
        toolType: "mcpToolCall",
        title: "Read src/index.ts",
        detail: JSON.stringify({ path: "src/index.ts" }),
        status: "completed",
        output: "export {}\n",
      },
      {
        id: "tool-3",
        kind: "tool",
        toolType: "mcpToolCall",
        title: "Read package.json",
        detail: JSON.stringify({ path: "package.json" }),
        status: "completed",
        output: "{\"name\":\"demo\"}\n",
      },
    ];
    render(
      <Messages
        items={readTools}
        threadId="claude:history-transcript-heavy"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        conversationState={{
          items: readTools,
          plan: null,
          userInputQueue: [],
          meta: {
            workspaceId: "ws-1",
            threadId: "claude:history-transcript-heavy",
            engine: "claude",
            activeTurnId: null,
            isThinking: false,
            heartbeatPulse: null,
            historyRestoredAtMs: Date.now(),
          },
        }}
        onUserInputSubmit={vi.fn()}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    // File-read tools stay on canvas; shell stays off for perf.
    expect(screen.queryByText("messages.emptyThread")).toBeNull();
    expect(screen.getByText(/README\.md/)).toBeTruthy();
  });

  it("keeps file-inspection bash rows on Claude canvas outside history restore", () => {
    render(
      <Messages
        items={[
          {
            id: "tool-idle-1",
            kind: "tool",
            toolType: "bash",
            title: "Bash",
            detail: "{\"command\":\"ls -la\"}",
            status: "completed",
            output: "README.md\nsrc\n",
          },
          {
            id: "tool-idle-2",
            kind: "tool",
            toolType: "bash",
            title: "Bash",
            detail: "{\"command\":\"find src -maxdepth 2\"}",
            status: "completed",
            output: "src/index.ts\nsrc/app.tsx\n",
          },
          {
            id: "tool-idle-3",
            kind: "tool",
            toolType: "bash",
            title: "Bash",
            detail: "{\"command\":\"cat package.json\"}",
            status: "completed",
            output: "{\"name\":\"demo\"}\n",
          },
        ]}
        threadId="claude:idle-transcript-heavy"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        onUserInputSubmit={vi.fn()}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    // find/cat are file-inspection → stay on canvas; pure ls noise is filtered out of the group.
    expect(screen.getByText(/tools\.bashGroupBatchRun/)).toBeTruthy();
  });

  it("hides pure shell noise bash groups on Claude canvas outside history restore", () => {
    render(
      <Messages
        items={[
          {
            id: "tool-noise-1",
            kind: "tool",
            toolType: "bash",
            title: "Bash",
            detail: "{\"command\":\"pwd\"}",
            status: "completed",
            output: "/repo",
          },
          {
            id: "tool-noise-2",
            kind: "tool",
            toolType: "bash",
            title: "Bash",
            detail: "{\"command\":\"ls -la\"}",
            status: "completed",
            output: "README.md\n",
          },
          {
            id: "tool-noise-3",
            kind: "tool",
            toolType: "bash",
            title: "Bash",
            detail: "{\"command\":\"echo done\"}",
            status: "completed",
            output: "done\n",
          },
        ]}
        threadId="claude:idle-pure-shell"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        onUserInputSubmit={vi.fn()}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(screen.queryByText(/tools\.bashGroupBatchRun/)).toBeNull();
  });

  // jsdom drops scrollTop writes on unlaid-out elements, so back the scroller
  // with a real value and fixed metrics. scrollTop setter 按浏览器语义 clamp
  // 到 [0, maxScrollTop]（scrollToBottom 写的是 scrollHeight，真实浏览器会钳回底）。
  const stubScrollerMetrics = (container: HTMLElement, scrollHeight: number) => {
    const scroller = container.querySelector(".messages") as HTMLDivElement;
    expect(scroller).toBeTruthy();
    let currentScrollTop = 0;
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true,
      get: () => currentScrollTop,
      set: (value: number) => {
        currentScrollTop = Math.max(0, Math.min(value, scrollHeight - 720));
      },
    });
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 720 });
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: scrollHeight });
    return scroller;
  };

  it("pins the viewport to the bottom when opening a loaded history thread", () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();

    const { container, rerender } = render(
      <Messages
        items={[]}
        threadId="thread-history-bottom-pin"
        workspaceId="ws-1"
        isThinking={false}
        isHistoryLoading
        activeEngine="codex"
        onUserInputSubmit={vi.fn()}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );
    // Stub metrics before history lands, so the pin sees a scrollable container.
    const scroller = stubScrollerMetrics(container, 2400);

    rerender(
      <Messages
        items={[
          { id: "m-1", kind: "message", role: "user", text: "hello" },
          { id: "m-2", kind: "message", role: "assistant", text: "world", isFinal: true },
        ]}
        threadId="thread-history-bottom-pin"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="codex"
        onUserInputSubmit={vi.fn()}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(scroller.scrollTop).toBe(2400 - 720);
  });

  it("does not pin the viewport while history is still loading", () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();

    const { container } = render(
      <Messages
        items={[]}
        threadId="thread-history-loading-no-pin"
        workspaceId="ws-1"
        isThinking={false}
        isHistoryLoading
        activeEngine="codex"
        onUserInputSubmit={vi.fn()}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const scroller = stubScrollerMetrics(container, 2400);
    expect(scroller.scrollTop).toBe(0);
  });

  it("prefers request_user_input UI over history loading when the active thread has a pending request", () => {
    const request: RequestUserInputRequest = {
      request_id: "request-1",
      workspace_id: "ws-1",
      params: {
        thread_id: "thread-with-request",
        turn_id: "turn-1",
        item_id: "item-1",
        questions: [
          {
            id: "mode",
            question: "Choose one",
            header: "Mode",
            options: [
              { label: "Quick", description: "Fast path" },
            ],
          },
        ],
      },
    };

    render(
      <Messages
        items={[]}
        threadId="thread-with-request"
        workspaceId="ws-1"
        isThinking={false}
        isHistoryLoading
        activeEngine="codex"
        userInputRequests={[request]}
        onUserInputSubmit={vi.fn()}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(screen.getByText("Choose one")).toBeTruthy();
    expect(screen.queryByText("messages.restoringHistory")).toBeNull();
    expect(screen.queryByText("messages.emptyThread")).toBeNull();
  });
});
