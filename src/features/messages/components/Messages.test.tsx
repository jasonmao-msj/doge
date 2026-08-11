// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationItem } from "../../../types";
import {
  OPEN_TASK_RUN_EVENT,
  readOpenTaskRunEvent,
} from "../../tasks/utils/taskRunNavigationEvents";
import type { TaskRunRecord } from "../../tasks/types";
import { Messages } from "./Messages";
import { MessagesAnchorRail } from "./conversation/MessagesAnchorRail";

function makeRun(overrides: Partial<TaskRunRecord> = {}): TaskRunRecord {
  return {
    runId: "run-1",
    task: {
      taskId: "task-1",
      source: "kanban",
      workspaceId: "ws-1",
      title: "Ship linked run",
    },
    engine: "codex",
    status: "running",
    trigger: "manual",
    linkedThreadId: "thread-1",
    currentStep: "Rendering linked run",
    latestOutputSummary: "Linked run output",
    blockedReason: null,
    failureReason: null,
    artifacts: [],
    availableRecoveryActions: ["open_conversation"],
    updatedAt: 20,
    ...overrides,
  };
}

describe("Messages", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    window.localStorage.setItem("doge.claude.hideReasoningModule", "0");
    window.localStorage.removeItem("doge.messages.live.autoFollow");
    window.localStorage.setItem("doge.messages.live.collapseMiddleSteps", "0");
  });

  beforeAll(() => {
    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = vi.fn();
    }
    if (!HTMLElement.prototype.scrollTo) {
      HTMLElement.prototype.scrollTo = vi.fn();
    }
  });

  it("hides continuation protocol markers but keeps ordinary conversation", () => {
    const packageId = `sha256:${"a".repeat(64)}`;
    const checksum = `sha256:${"b".repeat(64)}`;
    const marker = `MOSSX_CONTEXT_PACKAGE:${packageId}:${checksum}`;
    const items: ConversationItem[] = [
      {
        id: "protocol-package",
        kind: "message",
        role: "user",
        text: marker,
      },
      {
        id: "imported-user",
        kind: "message",
        role: "user",
        text: "# AGENTS.md instructions",
      },
      {
        id: "protocol-accepted",
        kind: "message",
        role: "assistant",
        text: `MOSSX_CONTEXT_ACCEPTED:${packageId}:${checksum}`,
      },
      {
        id: "visible-user",
        kind: "message",
        role: "user",
        text: "继续修复登录问题",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="claude:continuation"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.textContent).toContain("继续修复登录问题");
    expect(container.textContent).not.toContain("AGENTS.md");
    expect(container.textContent).not.toContain("MOSSX_CONTEXT_");
  });

  it("renders continuation metadata inside the existing messages scroller only when provided", () => {
    const { container, rerender } = render(
      <Messages
        items={[]}
        threadId="claude:continuation"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
        timelineLeadingNode={<div data-testid="continuation-metadata">lineage</div>}
      />,
    );

    const scroller = container.querySelector(".messages.scrollable");
    expect(scroller?.querySelector("[data-testid='continuation-metadata']")).toBeTruthy();

    rerender(
      <Messages
        items={[]}
        threadId="claude:ordinary"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );
    expect(container.querySelector("[data-testid='continuation-metadata']")).toBeNull();
  });

  it("hides Codex host bootstrap only for a Provider Continuation target", () => {
    const packageId = `sha256:${"c".repeat(64)}`;
    const checksum = `sha256:${"d".repeat(64)}`;
    const marker = `MOSSX_CONTEXT_PACKAGE:${packageId}:${checksum}`;
    const items: ConversationItem[] = [
      {
        id: "codex-environment",
        kind: "message",
        role: "user",
        text:
          "<environment_context>\n" +
          "  <cwd>/workspace</cwd>\n" +
          "</environment_context>",
      },
      {
        id: "continuation-control",
        kind: "message",
        role: "user",
        text:
          `${marker}\n` +
          "MOSSX_SHARED_CONTEXT_V1\n" +
          "session:shared-session-1\n" +
          "binding:codex::managed-a\n\n" +
          "Shared Context Transcript\n\nTurn 1\nUser: 旧问题\n" +
          `${marker}\n\n` +
          "Current user request:\n继续",
      },
      {
        id: "bootstrap-assistant",
        kind: "message",
        role: "assistant",
        text: "你好！我是 bootstrap assistant。",
      },
      {
        id: "real-user",
        kind: "message",
        role: "user",
        text: "这是续接后的真实问题",
      },
      {
        id: "real-assistant",
        kind: "message",
        role: "assistant",
        text: "开始处理真实问题。",
      },
    ];
    const { container, rerender } = render(
      <Messages
        items={items}
        threadId="codex-continuation"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="codex"
        isProviderContinuation
        openTargets={[]}
        selectedOpenAppId=""
        timelineLeadingNode={
          <div data-testid="continuation-metadata">Provider 续接</div>
        }
      />,
    );

    expect(screen.getByTestId("continuation-metadata")).toBeTruthy();
    expect(container.textContent).toContain("这是续接后的真实问题");
    expect(container.textContent).toContain("开始处理真实问题");
    expect(container.textContent).not.toContain("environment_context");
    expect(container.textContent).not.toContain("bootstrap assistant");

    rerender(
      <Messages
        items={items}
        threadId="ordinary-codex"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="codex"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.textContent).toContain("environment_context");
    expect(container.textContent).toContain("bootstrap assistant");
  });

  it("keeps Claude reasoning title stable while streaming", () => {
    window.localStorage.removeItem("doge.claude.hideReasoningModule");

    const items: ConversationItem[] = [
      {
        id: "msg-user-streaming",
        kind: "message",
        role: "user",
        text: "继续分析",
      },
      {
        id: "reasoning-streaming",
        kind: "reasoning",
        summary: "检查日志模块",
        content: "先核对 Controller，再核对 Service。",
      },
    ];

    render(
      <Messages
        items={items}
        threadId="claude:session-streaming"
        workspaceId="ws-1"
        isThinking={true}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(screen.getByText("messages.thinking")).toBeTruthy();
    expect(screen.queryByText("messages.thinkingProcess")).toBeNull();
  });

  it("does not submit repeated expansion state for equivalent streaming reasoning renders", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const createItems = (): ConversationItem[] => [
      ...Array.from({ length: 64 }, (_, index): ConversationItem => ({
        id: `history-${index}`,
        kind: "message",
        role: index % 2 === 0 ? "user" : "assistant",
        text: `history ${index}`,
      })),
      {
        id: "streaming-user",
        kind: "message",
        role: "user",
        text: "继续分析",
      },
      {
        id: "streaming-reasoning",
        kind: "reasoning",
        summary: "检查渲染状态",
        content: "保持同一个 reasoning id，但每次父级传入新数组引用。",
      },
    ];

    try {
      const view = render(
        <Messages
          items={createItems()}
          threadId="thread-streaming-depth-guard"
          workspaceId="ws-1"
          isThinking
          activeEngine="codex"
          openTargets={[]}
          selectedOpenAppId=""
        />,
      );

      for (let index = 0; index < 12; index += 1) {
        view.rerender(
          <Messages
            items={createItems()}
            threadId="thread-streaming-depth-guard"
            workspaceId="ws-1"
            isThinking
            activeEngine="codex"
            openTargets={[]}
            selectedOpenAppId=""
          />,
        );
      }

      const updateDepthErrors = consoleErrorSpy.mock.calls.filter((call) =>
        call.some((entry) => String(entry).includes("Maximum update depth exceeded")),
      );
      expect(updateDepthErrors).toHaveLength(0);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("renders the linked TaskRun indicator for the active thread and opens run detail", () => {
    const openedRunIds: string[] = [];
    const handleOpenTaskRun = (event: Event) => {
      const runId = readOpenTaskRunEvent(event);
      if (runId) {
        openedRunIds.push(runId);
      }
    };
    window.addEventListener(OPEN_TASK_RUN_EVENT, handleOpenTaskRun);

    try {
      render(
        <Messages
          items={[]}
          threadId="thread-1"
          workspaceId="ws-1"
          isThinking={false}
          activeEngine="codex"
          openTargets={[]}
          selectedOpenAppId=""
          taskRuns={[
            makeRun(),
            makeRun({
              runId: "run-other",
              linkedThreadId: "thread-other",
              task: {
                taskId: "task-other",
                source: "kanban",
                workspaceId: "ws-1",
                title: "Other run",
              },
            }),
          ]}
        />,
      );

      expect(screen.getByText("Ship linked run")).toBeTruthy();
      expect(screen.getByText(/Linked run output/)).toBeTruthy();
      expect(screen.queryByText("Other run")).toBeNull();

      fireEvent.click(screen.getByText("messages.openLinkedRun"));

      expect(openedRunIds).toEqual(["run-1"]);
    } finally {
      window.removeEventListener(OPEN_TASK_RUN_EVENT, handleOpenTaskRun);
    }
  });

  it("keeps legacy Claude docked reasoning mode when the flag is explicitly enabled", () => {
    window.localStorage.setItem("doge.claude.hideReasoningModule", "1");

    const items: ConversationItem[] = [
      {
        id: "msg-user-docked",
        kind: "message",
        role: "user",
        text: "先分析",
      },
      {
        id: "reasoning-docked",
        kind: "reasoning",
        summary: "思考",
        content: "先检查 Controller 和 Service。",
      },
      {
        id: "msg-assistant-docked",
        kind: "message",
        role: "assistant",
        text: "我已经分析完了。",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-claude-docked"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const reasoningBlock = container.querySelector(".thinking-block");
    const assistantMessage = container.querySelector(".message.assistant");
    expect(reasoningBlock).toBeTruthy();
    expect(assistantMessage).toBeTruthy();
    if (!reasoningBlock || !assistantMessage) {
      throw new Error("expected reasoning block and assistant message");
    }
    expect(
      assistantMessage.compareDocumentPosition(reasoningBlock) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders assistant tail copy actions with fork and rewind only on final replies", async () => {
    const handleForkFromMessage = vi.fn();
    const handleRewindFromMessage = vi.fn();
    const writeTextMock = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      configurable: true,
    });
    const items: ConversationItem[] = [
      {
        id: "user-tail-actions-1",
        kind: "message",
        role: "user",
        text: "first request",
      },
      {
        id: "assistant-tail-actions-1-part-1",
        kind: "message",
        role: "assistant",
        text: "first answer part 1",
      },
      {
        id: "assistant-tail-actions-1",
        kind: "message",
        role: "assistant",
        text: "first answer part 2",
        isFinal: true,
      },
      {
        id: "user-tail-actions-2",
        kind: "message",
        role: "user",
        text: "second request",
      },
      {
        id: "assistant-tail-actions-2",
        kind: "message",
        role: "assistant",
        text: "second answer",
        isFinal: true,
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="codex:tail-actions"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="codex"
        openTargets={[]}
        selectedOpenAppId=""
        onForkFromMessage={handleForkFromMessage}
        onRewindFromMessage={handleRewindFromMessage}
      />,
    );

    expect(container.querySelector(".message-tail-action-row")).toBeNull();
    expect(
      container.querySelectorAll(".messages-final-boundary .message-action-bar-row"),
    ).toHaveLength(2);
    expect(
      container.querySelectorAll(".message.user .bubble .message-copy-button"),
    ).toHaveLength(2);
    const boundaryActionRows = container.querySelectorAll(
      ".messages-final-boundary .message-action-bar-row",
    );
    expect(boundaryActionRows[0].querySelectorAll("button")).toHaveLength(1);
    expect(boundaryActionRows[1].querySelectorAll("button")).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: "messages.copyMessage" })).toHaveLength(2);
    const userCopyButtons = screen.getAllByRole("button", {
      name: "messages.copyUserMessage",
    });
    expect(userCopyButtons).toHaveLength(2);
    await act(async () => {
      fireEvent.click(userCopyButtons[0]);
    });
    expect(writeTextMock).toHaveBeenCalledWith("first request");
    const assistantCopyButtons = container.querySelectorAll(
      ".messages-final-boundary .message-copy-button",
    );
    expect(assistantCopyButtons).toHaveLength(2);
    await act(async () => {
      fireEvent.click(assistantCopyButtons[0]);
    });
    expect(writeTextMock).toHaveBeenCalledWith("first answer part 1\n\nfirst answer part 2");
    const forkButtons = screen.getAllByRole("button", { name: "messages.forkMessage" });
    expect(forkButtons).toHaveLength(1);
    expect(forkButtons[0].querySelector(".message-fork-icon")).toBeTruthy();
    fireEvent.click(forkButtons[0]);
    expect(handleForkFromMessage).toHaveBeenCalledWith("user-tail-actions-2");

    const rewindButtons = screen.getAllByRole("button", { name: "messages.rewindMessage" });
    expect(rewindButtons).toHaveLength(1);
    expect(rewindButtons[0].querySelector(".message-history-icon")).toBeTruthy();
    fireEvent.click(rewindButtons[0]);
    expect(handleRewindFromMessage).toHaveBeenCalledWith("user-tail-actions-2");
  });

  it("hides unsupported fork and rewind actions for a strictly linear Shared Session", () => {
    const { container } = render(
      <Messages
        items={[
          {
            id: "shared-user-1",
            kind: "message",
            role: "user",
            text: "shared request",
          },
          {
            id: "shared-assistant-1",
            kind: "message",
            role: "assistant",
            text: "shared answer",
            isFinal: true,
          },
        ]}
        threadId="shared:linear-session"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
        onForkFromMessage={vi.fn()}
        onRewindFromMessage={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "messages.forkMessage" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "messages.rewindMessage" }),
    ).toBeNull();
    expect(
      container.querySelectorAll(
        ".messages-final-boundary .message-action-bar-row button",
      ),
    ).toHaveLength(1);
  });

  it("does not backfill historical user message badge from active mode", () => {
    const items: ConversationItem[] = [
      {
        id: "msg-no-mode-1",
        kind: "message",
        role: "user",
        text: "这条消息本身没有模式元数据",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="codex"
        openTargets={[]}
        selectedOpenAppId=""
        activeCollaborationModeId="plan"
      />,
    );

    expect(container.querySelector(".message-mode-badge")).toBeNull();
  });

  it("does not show collaboration badge for non-codex engines", () => {
    const items: ConversationItem[] = [
      {
        id: "msg-claude-1",
        kind: "message",
        role: "user",
        text:
          "Collaboration mode: code. Do not ask the user follow-up questions.\n\nUser request: 你好",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
        activeEngine="claude"
        activeCollaborationModeId="code"
      />,
    );

    expect(container.querySelector(".message-mode-badge")).toBeNull();
    expect(container.textContent ?? "").toContain(
      "Collaboration mode: code. Do not ask the user follow-up questions.",
    );
  });

  it("keeps Codex verification progress visually plain", async () => {
    const items: ConversationItem[] = [
      {
        id: "assistant-lead-1",
        kind: "message",
        role: "assistant",
        text: "Typecheck 通过。最后跑 ESLint，确认没有静态问题。\n\n~~runtime-ready~~",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="codex"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    await waitFor(() => {
      expect(container.querySelector("del")?.textContent).toBe("runtime-ready");
    });
    expect(container.textContent ?? "").toContain(
      "Typecheck 通过。最后跑 ESLint，确认没有静态问题。",
    );
    expect(container.querySelector(".markdown-lead-paragraph")).toBeNull();
    expect(container.textContent ?? "").not.toContain("✅");
  });

  it("keeps the Codex presentation profile text-neutral", async () => {
    const items: ConversationItem[] = [
      {
        id: "assistant-profile-1",
        kind: "message",
        role: "assistant",
        text: "PLAN\n\n执行内容\n\n~~runtime-ready~~",
      },
    ];
    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        presentationProfile={{
          engine: "codex",
          preferCommandSummary: true,
          codexCanvasMarkdown: true,
          showReasoningLiveDot: true,
          heartbeatWaitingHint: false,
          assistantMarkdownStreamingThrottleMs: 80,
          reasoningStreamingThrottleMs: 180,
          useCodexStagedMarkdownThrottle: true,
        }}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    await waitFor(() => {
      expect(container.querySelector("del")?.textContent).toBe("runtime-ready");
    });
    expect(container.querySelector(".markdown-codex-canvas")).toBeNull();
  });

  it("hides TodoWrite tool blocks from chat stream", () => {
    const items: ConversationItem[] = [
      {
        id: "tool-read-1",
        kind: "tool",
        toolType: "toolCall",
        title: "Tool: read",
        detail: JSON.stringify({ file_path: "src/keep-a.ts" }),
        status: "completed",
        output: "content",
      },
      {
        id: "tool-todo-1",
        kind: "tool",
        toolType: "toolCall",
        title: "Tool: TodoWrite",
        detail: JSON.stringify({ todos: [{ content: "step1" }] }),
        status: "completed",
        output: "todo updated",
      },
      {
        id: "tool-edit-1",
        kind: "tool",
        toolType: "toolCall",
        title: "Tool: edit",
        detail: JSON.stringify({
          file_path: "src/keep-b.ts",
          old_string: "a",
          new_string: "b",
        }),
        status: "completed",
      },
    ];

    render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(screen.getByText("keep-a.ts")).toBeTruthy();
    expect(screen.getByText("keep-b.ts")).toBeTruthy();
    expect(screen.queryByText("待办列表")).toBeNull();
  });

  it("collapses duplicate reasoning snapshots separated only by hidden TodoWrite tools", () => {
    const repeated =
      "用户要求进行项目分析，这是一个比较宽泛的请求。我需要先读取项目规范并查看项目结构。";
    const items: ConversationItem[] = [
      {
        id: "reasoning-hidden-sep-1",
        kind: "reasoning",
        summary: repeated,
        content: repeated,
      },
      {
        id: "tool-hidden-todo-1",
        kind: "tool",
        toolType: "toolCall",
        title: "Tool: TodoWrite",
        detail: JSON.stringify({ todos: [{ content: "step 1" }] }),
        status: "completed",
        output: "todo updated",
      },
      {
        id: "reasoning-hidden-sep-2",
        kind: "reasoning",
        summary: `${repeated} 现在我继续读取 README.md。`,
        content: `${repeated} 现在我继续读取 README.md。`,
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelectorAll(".thinking-block").length).toBe(1);
    expect(container.textContent ?? "").toContain("现在我继续读取 README.md");
  });

  it("keeps next-step wording visually plain", async () => {
    const items: ConversationItem[] = [
      {
        id: "assistant-lead-next-1",
        kind: "message",
        role: "assistant",
        text: "下一步建议\n\n继续补齐验收。\n\n~~runtime-ready~~",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="codex"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    await waitFor(() => {
      expect(container.querySelector("del")?.textContent).toBe("runtime-ready");
    });
    expect(container.textContent ?? "").toContain("下一步建议");
    expect(container.querySelector(".markdown-lead-next")).toBeNull();
    expect(container.textContent ?? "").not.toContain("🚀");
  });

  it("preserves emoji explicitly written by the assistant", async () => {
    const items: ConversationItem[] = [
      {
        id: "assistant-explicit-emoji-1",
        kind: "message",
        role: "assistant",
        text: "✅ 已完成\n\n~~runtime-ready~~",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="codex"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    await waitFor(() => {
      expect(container.querySelector("del")?.textContent).toBe("runtime-ready");
    });
    expect(container.textContent ?? "").toContain("✅ 已完成");
  });

  it("collapses pathological fragmented paragraphs in assistant markdown", () => {
    const fragmented = [
      "湘宁大兄弟",
      "你好！",
      "这段记录",
      "说",
      "的是：",
      "记",
      "录内容分",
      "析",
      "这是一个**",
      "对",
      "话开场片",
      "段**",
    ].join("\n\n");
    const items: ConversationItem[] = [
      {
        id: "assistant-fragmented-1",
        kind: "message",
        role: "assistant",
        text: `这段记录看起来是：\n\n${fragmented}\n\n总结完毕。`,
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const paragraphs = container.querySelectorAll(".markdown p");
    expect(paragraphs.length).toBeGreaterThanOrEqual(1);
    expect(paragraphs.length).toBeLessThanOrEqual(3);
    const markdownText = container.querySelector(".markdown")?.textContent ?? "";
    expect(markdownText).toContain("湘宁大兄弟你好！");
    expect(markdownText).toContain("这段记录说的是：");
    expect(markdownText).toContain("这是一个对话开场片段");
  });

  it("collapses pathological fragmented blockquote paragraphs in assistant markdown", () => {
    const fragmentedQuote = [
      "湘宁大兄弟",
      "你好！",
      "这段记录",
      "说",
      "的是：",
      "记",
      "录内容分",
      "析",
      "这是一个**",
      "对",
      "话开场片",
      "段**",
    ]
      .map((line) => `> ${line}`)
      .join("\n\n");

    const items: ConversationItem[] = [
      {
        id: "assistant-fragmented-quote-1",
        kind: "message",
        role: "assistant",
        text: `这段记录看起来是：\n\n${fragmentedQuote}\n\n总结完毕。`,
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const quoteParagraphs = container.querySelectorAll(".markdown blockquote p");
    expect(quoteParagraphs.length).toBeGreaterThanOrEqual(1);
    expect(quoteParagraphs.length).toBeLessThanOrEqual(3);
    const markdownText = container.querySelector(".markdown")?.textContent ?? "";
    expect(markdownText).toContain("湘宁大兄弟你好！");
    expect(markdownText).toContain("这段记录说的是：");
    expect(markdownText).toContain("这是一个对话开场片段");
  });

  it("collapses fragmented paragraphs when blank lines contain spaces", () => {
    const fragmented = [
      "你好",
      "！",
      "有什么",
      "我可以",
      "帮",
      "你的",
      "吗",
      "？",
    ].join("\n \n");
    const items: ConversationItem[] = [
      {
        id: "assistant-fragmented-spaces-1",
        kind: "message",
        role: "assistant",
        text: `先回应：\n \n${fragmented}`,
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const markdownText = container.querySelector(".markdown")?.textContent ?? "";
    expect(markdownText).toContain("你好！有什么我可以帮你的吗？");
  });

  it("collapses single-line fragmented cjk runs in assistant markdown", () => {
    const fragmented = [
      "你",
      "好",
      "！",
      "我",
      "是",
      "你",
      "的",
      "AI",
      "联",
      "合",
      "架",
      "构",
      "师",
      "。",
    ].join("\n");
    const items: ConversationItem[] = [
      {
        id: "assistant-single-line-fragmented-1",
        kind: "message",
        role: "assistant",
        text: fragmented,
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const markdownText = container.querySelector(".markdown")?.textContent ?? "";
    expect(markdownText).toContain("你好！我是你的AI联合架构师。");
  });

  it("renders memory context summary as a separate collapsible card", async () => {
    const items: ConversationItem[] = [
      {
        id: "memory-summary-1",
        kind: "message",
        role: "assistant",
        text: "【记忆上下文摘要】\n[对话记录] 第一条；[项目上下文] 第二条",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelector(".memory-context-summary-card")).toBeTruthy();
    expect(container.querySelector(".message.assistant .bubble")).toBeNull();
    expect(container.querySelector(".markdown")).toBeNull();
    const toggle = container.querySelector(".memory-context-summary-toggle");
    expect(toggle).toBeTruthy();
    if (!toggle) {
      return;
    }
    fireEvent.click(toggle);
    await waitFor(() => {
      const content = container.querySelector(".memory-context-summary-content");
      expect(content?.textContent ?? "").toContain("第一条");
      expect(content?.textContent ?? "").toContain("第二条");
    });
  });

  it("renders legacy user-injected memory prefix as summary card and keeps user input text", async () => {
    const items: ConversationItem[] = [
      {
        id: "legacy-user-memory-1",
        kind: "message",
        role: "user",
        text:
          "[对话记录] 用户输入：你知道苹果手机吗。 我刚买了一个16pro 助手输出摘要：知道的！ iPhone 16 Pro 是苹果 2024 年发布的旗舰机型。 助手输出：知道的！\n\n我的手机是什么牌子的",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelector(".memory-context-summary-card")).toBeTruthy();
    const bubble = container.querySelector(".message.user .bubble");
    const memoryCard = container.querySelector(".memory-context-summary-card");
    expect(bubble).toBeTruthy();
    expect(memoryCard).toBeTruthy();
    expect(bubble?.contains(memoryCard)).toBe(false);
    const userText = container.querySelector(".user-collapsible-text-content");
    expect(userText?.textContent ?? "").toBe("我的手机是什么牌子的");
    expect(userText?.textContent ?? "").not.toContain("用户输入：你知道苹果手机吗");
    const toggle = container.querySelector(".memory-context-summary-toggle");
    expect(toggle).toBeTruthy();
    if (!toggle) {
      return;
    }
    fireEvent.click(toggle);
    await waitFor(() => {
      const content = container.querySelector(".memory-context-summary-content");
      expect(content?.textContent ?? "").toContain("[对话记录]");
      expect(content?.textContent ?? "").toContain("助手输出摘要");
    });
  });

  it("renders codex memory-scout references as standalone context resources", async () => {
    const items: ConversationItem[] = [
      {
        id: "codex-user-memory-scout-1",
        kind: "message",
        role: "user",
        text: [
          '<project-memory source="memory-scout" count="1" status="ok" truncated="false">',
          "Memory Brief:",
          "1. [conversation_turn] 项目分析 (memoryId=m-1)",
          "   reason: Matched query terms: 项目",
          "   summary: 历史对话里已经分析过这个项目",
          "   source: threadId=t-1 turnId=turn-1 engine=codex updatedAt=1",
          "</project-memory>",
          "",
          "以前做过项目分析吗",
        ].join("\n"),
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-memory-scout"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="codex"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const bubble = container.querySelector(".message.user .bubble");
    const memoryCard = container.querySelector(".memory-context-summary-card");
    expect(memoryCard).toBeTruthy();
    expect(bubble).toBeTruthy();
    expect(bubble?.contains(memoryCard)).toBe(false);
    expect(container.querySelector(".user-collapsible-text-content")?.textContent ?? "").toBe(
      "以前做过项目分析吗",
    );
    expect(bubble?.textContent ?? "").not.toContain("Memory Brief");

    const toggle = container.querySelector(".memory-context-summary-toggle");
    expect(toggle).toBeTruthy();
    if (!toggle) {
      return;
    }
    fireEvent.click(toggle);
    await waitFor(() => {
      const content = container.querySelector(".memory-context-summary-content");
      expect(content?.textContent ?? "").toContain("项目分析");
      expect(content?.textContent ?? "").toContain("engine=codex");
    });
  });

  it("renders retrieval pack references with stable memory indexes outside the user bubble", async () => {
    const items: ConversationItem[] = [
      {
        id: "codex-user-memory-pack-1",
        kind: "message",
        role: "user",
        text: [
          '<project-memory-pack source="memory-scout" count="1" cleaned="true" cleanerStatus="cleaned" truncated="false">',
          "Cleaned Context:",
          "- [M1] 项目使用 Spring Boot 2.7 + Java 11。",
          "",
          "Conflicts:",
          "- none",
          "",
          "Irrelevant Records:",
          "- none",
          "",
          "Source Records:",
          "[M1] memoryId=m-pack-1 title=项目技术栈 recordKind=conversation_turn sourceType=conversation_turn threadId=t-1 turnId=turn-1 engine=codex updatedAt=1",
          "Original user input:",
          "项目技术栈是什么",
          "Original assistant response:",
          "项目使用 Spring Boot 2.7 + Java 11。",
          "",
          "Instruction:",
          "Use relevant records as prior project context.",
          "</project-memory-pack>",
          "",
          "继续分析项目",
        ].join("\n"),
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-memory-pack"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="codex"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const bubble = container.querySelector(".message.user .bubble");
    const memoryCard = container.querySelector(".memory-context-summary-card");
    expect(memoryCard).toBeTruthy();
    expect(bubble).toBeTruthy();
    expect(bubble?.contains(memoryCard)).toBe(false);
    expect(container.querySelector(".user-collapsible-text-content")?.textContent ?? "").toBe(
      "继续分析项目",
    );
    expect(bubble?.textContent ?? "").not.toContain("project-memory-pack");

    const toggle = container.querySelector(".memory-context-summary-toggle");
    expect(toggle).toBeTruthy();
    if (!toggle) {
      return;
    }
    fireEvent.click(toggle);
    await waitFor(() => {
      const content = container.querySelector(".memory-context-summary-content");
      expect(content?.querySelector(".memory-context-summary-record")).toBeTruthy();
      expect(content?.querySelector(".memory-context-summary-record-index")?.textContent).toBe(
        "#1",
      );
      expect(content?.textContent ?? "").toContain("项目技术栈");
      expect(content?.textContent ?? "").not.toContain("Spring Boot");
      expect(content?.textContent ?? "").not.toContain("Original user input");
    });
  });

  it("uses unique display indexes for multiple memory packs and exposes the real sent payload", async () => {
    const items: ConversationItem[] = [
      {
        id: "codex-user-memory-pack-detail-1",
        kind: "message",
        role: "user",
        text: [
          '<project-memory-pack source="manual-selection" count="1" cleaned="false" cleanerStatus="source_records_only" truncated="false">',
          "Cleaned Context:",
          "- source records only",
          "",
          "Source Records:",
          "[M1] memoryId=m-manual-1 title=手动选择记忆 recordKind=conversation_turn sourceType=conversation_turn threadId=t-1 turnId=turn-1 engine=codex updatedAt=1",
          "Original user input:",
          "手动记忆问题",
          "Original assistant response:",
          "手动记忆回答",
          "",
          "Instruction:",
          "Use relevant records as prior project context.",
          "</project-memory-pack>",
          "",
          '<project-memory-pack source="memory-scout" count="1" cleaned="true" cleanerStatus="cleaned" truncated="false">',
          "Cleaned Context:",
          "### 自动记忆摘要",
          "",
          "- **重点**：自动引用事实",
          "",
          "Source Records:",
          "[M1] memoryId=m-scout-1 title=自动引用记忆 recordKind=conversation_turn sourceType=conversation_turn threadId=t-2 turnId=turn-2 engine=codex updatedAt=2",
          "Original user input:",
          "自动记忆问题",
          "Original assistant response:",
          "自动记忆回答",
          "",
          "Instruction:",
          "Use relevant records as prior project context.",
          "</project-memory-pack>",
          "",
          "继续分析",
        ].join("\n"),
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-memory-pack-detail"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="codex"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const toggle = container.querySelector(".memory-context-summary-toggle");
    expect(toggle).toBeTruthy();
    if (!toggle) {
      return;
    }
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(
        [...container.querySelectorAll(".memory-context-summary-record-index")].map(
          (node) => node.textContent,
        ),
      ).toEqual(["#1", "#2"]);
      const cardText = container.querySelector(".memory-context-summary-content")?.textContent ?? "";
      expect(cardText).toContain("手动选择记忆");
      expect(cardText).toContain("自动引用记忆");
      expect(cardText).not.toContain("手动记忆问题");
      expect(cardText).not.toContain("自动记忆问题");
    });

    const detailButton = container.querySelector(".memory-context-summary-detail-button");
    expect(detailButton).toBeTruthy();
    if (!detailButton) {
      return;
    }
    fireEvent.click(detailButton);
    await waitFor(() => {
      const dialog = document.body.querySelector(".memory-context-payload-dialog");
      expect(dialog?.querySelector(".memory-context-payload-dialog-close")?.textContent).toBe(
        "×",
      );
      expect(
        dialog?.querySelector(".memory-context-payload-markdown h3")?.textContent,
      ).toBe("自动记忆摘要");
      expect(dialog?.querySelector(".memory-context-payload-markdown strong")?.textContent).toBe(
        "重点",
      );
      expect(dialog?.textContent ?? "").toContain(
        '<project-memory-pack source="manual-selection"',
      );
      expect(dialog?.textContent ?? "").toContain(
        '<project-memory-pack source="memory-scout"',
      );
      expect(dialog?.textContent ?? "").toContain("[M1] memoryId=m-manual-1");
      expect(dialog?.textContent ?? "").toContain("[M1] memoryId=m-scout-1");
      expect(dialog?.textContent ?? "").toContain("Original user input:");
    });
  });

  it("formats legacy markdown memory summaries inside the normalized context card", async () => {
    const items: ConversationItem[] = [
      {
        id: "memory-summary-markdown-1",
        kind: "message",
        role: "assistant",
        text: [
          "【记忆上下文摘要】",
          "### 项目约束",
          "",
          "- 必须保留 Markdown 列表",
          "- `Memory Reference` 只展示一张卡",
        ].join("\n"),
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-memory-markdown"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="codex"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const toggle = container.querySelector(".memory-context-summary-toggle");
    expect(toggle).toBeTruthy();
    if (!toggle) {
      return;
    }
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(container.querySelector(".memory-context-summary-markdown h3")?.textContent).toBe(
        "项目约束",
      );
      expect(container.querySelectorAll(".memory-context-summary-markdown li")).toHaveLength(2);
      expect(container.querySelector(".memory-context-summary-markdown code")?.textContent).toBe(
        "Memory Reference",
      );
    });
  });

  it("dedupes assistant memory summary cards against attributed user memory wrapper in the same turn", () => {
    const items: ConversationItem[] = [
      {
        id: "assistant-memory-summary-1",
        kind: "message",
        role: "assistant",
        text: "【记忆上下文摘要】\n[对话记录] 第一条；[项目上下文] 第二条...",
      },
      {
        id: "real-user-memory-1",
        kind: "message",
        role: "user",
        text: [
          '<project-memory source="manual-selection" count="3" truncated="true">',
          "[对话记录] 第一条",
          "[项目上下文] 第二条",
          "[已知问题] 第三条",
          "</project-memory>",
          "",
          "请基于这些记忆继续分析",
        ].join("\n"),
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-memory-dedupe"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="codex"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelectorAll(".memory-context-summary-card")).toHaveLength(1);
    const userText = container.querySelector(".user-collapsible-text-content");
    expect(userText?.textContent ?? "").toBe("请基于这些记忆继续分析");
    expect(container.textContent ?? "").not.toContain("[对话记录] 第一条");
  });

  it("does not leak project-memory xml when a same-turn assistant summary suppresses a memory-only user row", () => {
    const items: ConversationItem[] = [
      {
        id: "assistant-memory-summary-only",
        kind: "message",
        role: "assistant",
        text: "【记忆上下文摘要】\n[对话记录] 第一条；[项目上下文] 第二条",
      },
      {
        id: "real-user-memory-only",
        kind: "message",
        role: "user",
        text: [
          '<project-memory source="manual-selection" count="2" truncated="false">',
          "[对话记录] 第一条",
          "[项目上下文] 第二条",
          "</project-memory>",
          "",
        ].join("\n"),
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-memory-only-dedupe"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="codex"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelectorAll(".memory-context-summary-card")).toHaveLength(1);
    expect(container.querySelector(".message.user .bubble")).toBeNull();
    expect(container.textContent ?? "").not.toContain("<project-memory");
  });

  it("shows collapsible user input toggle when content overflows and expands on click", () => {
    const originalScrollHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollHeight",
    );
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return this.classList.contains("user-collapsible-text-content") ? 280 : 0;
      },
    });

    try {
      const items: ConversationItem[] = [
        {
          id: "user-collapse-1",
          kind: "message",
          role: "user",
          text: Array.from({ length: 24 }, (_, index) => `Line ${index + 1}`).join("\n"),
        },
      ];

      const { container } = render(
        <Messages
          items={items}
          threadId="thread-1"
          workspaceId="ws-1"
          isThinking={false}
          openTargets={[]}
          selectedOpenAppId=""
        />,
      );

      const toggle = container.querySelector(".user-collapsible-toggle") as HTMLButtonElement | null;
      const content = container.querySelector(".user-collapsible-content") as HTMLDivElement | null;
      expect(toggle).toBeTruthy();
      expect(content).toBeTruthy();
      expect(content?.style.maxHeight).toBe("160px");

      if (toggle) {
        fireEvent.click(toggle);
      }

      expect(toggle?.getAttribute("aria-expanded")).toBe("true");
      expect(content?.style.maxHeight).toBe("none");
    } finally {
      if (originalScrollHeight) {
        Object.defineProperty(HTMLElement.prototype, "scrollHeight", originalScrollHeight);
      } else {
        delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
      }
    }
  });

  it("renders user-only anchors and scrolls on click", () => {
    const scrollToMock = vi.fn();
    HTMLElement.prototype.scrollTo = scrollToMock;
    HTMLElement.prototype.scrollIntoView = vi.fn();

    const items: ConversationItem[] = [
      {
        id: "anchor-u1",
        kind: "message",
        role: "user",
        text: "first\nsimple description",
      },
      {
        id: "anchor-a1",
        kind: "message",
        role: "assistant",
        text: "second",
      },
      {
        id: "anchor-u2",
        kind: "message",
        role: "user",
        text: "third",
      },
    ];

    render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const rail = screen.getByRole("navigation", { name: "messages.anchorNavigation" });
    expect(rail).toBeTruthy();
    const dashes = screen.getAllByTestId("messages-anchor-dash");
    expect(dashes.length).toBe(2);

    fireEvent.mouseEnter(dashes[0]!);
    const preview = screen.getByTestId("messages-anchor-preview");
    expect(preview.textContent).toContain("1. first");
    expect(preview.textContent).toContain("simple description");
    expect(screen.getAllByTestId("messages-anchor-preview").length).toBe(1);
    expect(screen.queryByTestId("messages-anchor-row")).toBeNull();

    fireEvent.mouseEnter(dashes[1]!);
    expect(screen.getByTestId("messages-anchor-preview").textContent).toContain("2. third");
    expect(screen.getAllByTestId("messages-anchor-preview").length).toBe(1);

    fireEvent.click(dashes[0]!);
    expect(scrollToMock).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "smooth" }),
    );
  });

  it("renders the anchor rail for a single user message", () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();

    render(
      <Messages
        items={[{ id: "anchor-only", kind: "message", role: "user", text: "only" }]}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const rail = screen.getByRole("navigation", { name: "messages.anchorNavigation" });
    expect(rail.querySelectorAll(".messages-anchor-dash").length).toBe(1);
  });

  it("bounds anchor dashes, preserves active anchor, and supports keyboard jump", () => {
    const onScrollToAnchor = vi.fn();
    const anchors = Array.from({ length: 40 }, (_, index) => ({
      id: `anchor-many-${index + 1}`,
      role: "user",
      title: `message ${index + 1}`,
      description: `description ${index + 1}`,
    }));
    render(
      <MessagesAnchorRail
        activeAnchorId="anchor-many-40"
        anchors={anchors}
        anchorNavigationLabel="Message anchors"
        getFallbackTitle={(index) => `User ${index + 1}`}
        onScrollToAnchor={onScrollToAnchor}
      />,
    );

    const dashes = screen.getAllByTestId("messages-anchor-dash");
    expect(dashes.length).toBe(32);
    expect(
      dashes.every((dash) => !dash.closest(".messages-anchor-item")?.hasAttribute("style")),
    ).toBe(true);

    const firstDash = document.querySelector<HTMLButtonElement>(
      '[data-anchor-id="anchor-many-1"]',
    );
    const lastDash = document.querySelector<HTMLButtonElement>(
      '[data-anchor-id="anchor-many-40"]',
    );
    expect(firstDash?.closest(".messages-anchor-item")?.classList.contains("is-preview-down")).toBe(
      true,
    );
    expect(
      dashes.some((dash) =>
        dash.closest(".messages-anchor-item")?.classList.contains("is-preview-center"),
      ),
    ).toBe(true);
    expect(lastDash).toBeTruthy();
    expect(lastDash?.classList.contains("is-active")).toBe(true);
    expect(
      lastDash?.closest(".messages-anchor-item")?.classList.contains("is-preview-up"),
    ).toBe(true);

    fireEvent.mouseEnter(dashes[16]!);
    expect(dashes[16]?.classList.contains("is-proximity-0")).toBe(true);
    expect(dashes[15]?.classList.contains("is-proximity-1")).toBe(true);
    expect(dashes[17]?.classList.contains("is-proximity-1")).toBe(true);
    expect(dashes[14]?.classList.contains("is-proximity-2")).toBe(true);
    expect(dashes[18]?.classList.contains("is-proximity-2")).toBe(true);
    expect(dashes[13]?.classList.contains("is-proximity-3")).toBe(true);
    expect(dashes[19]?.classList.contains("is-proximity-3")).toBe(true);
    expect(dashes[12]?.className).not.toContain("is-proximity-");
    fireEvent.mouseLeave(screen.getByRole("navigation", { name: "Message anchors" }));
    expect(dashes[16]?.className).not.toContain("is-proximity-");

    if (!lastDash) {
      throw new Error("Active anchor dash not found");
    }
    fireEvent.focus(lastDash);
    expect(lastDash.classList.contains("is-proximity-0")).toBe(true);
    expect(screen.getByTestId("messages-anchor-preview").textContent).toContain(
      "40. message 40",
    );
    fireEvent.keyDown(lastDash, { key: "Enter" });
    fireEvent.focus(lastDash);
    fireEvent.keyDown(lastDash, { key: " " });
    expect(onScrollToAnchor).toHaveBeenNthCalledWith(1, "anchor-many-40");
    expect(onScrollToAnchor).toHaveBeenNthCalledWith(2, "anchor-many-40");

    if (!firstDash) {
      throw new Error("First anchor dash not found");
    }
    fireEvent.mouseEnter(firstDash);
    expect(screen.getByTestId("messages-anchor-preview").textContent).toContain(
      "1. message 1",
    );
    fireEvent.mouseLeave(screen.getByRole("navigation", { name: "Message anchors" }));
    expect(screen.queryByTestId("messages-anchor-preview")).toBeNull();
  });

  // A2:VISIBLE_MESSAGE_WINDOW=10000(95bc726a)有意禁用数量折叠(旧阈值 30,故 32 条折叠 2 条);折叠当前不启用,恢复策略后去 skip。
  it.skip("collapses earlier items and reveals them on demand", () => {
    const items: ConversationItem[] = Array.from({ length: 32 }, (_, index) => ({
      id: `history-item-${index + 1}`,
      kind: "message",
      role: index % 2 === 0 ? "user" : "assistant",
      text: `history message ${index + 1}`,
    }));

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-history-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    // Scope text queries to the message body: the anchor rail now also
    // renders user-message text in its hover labels, which would
    // otherwise make these queries match multiple elements.
    const body = container.querySelector(".messages") as HTMLElement;
    expect(within(body).queryByText("history message 1")).toBeNull();
    expect(within(body).getByText("history message 3")).toBeTruthy();
    expect(within(body).getByText("history message 17")).toBeTruthy();

    const indicator = container.querySelector(".messages-collapsed-indicator");
    expect(indicator).toBeTruthy();
    expect(indicator?.getAttribute("data-collapsed-count")).toBe("2");
    if (!indicator) {
      return;
    }
    fireEvent.click(indicator);

    expect(within(body).getByText("history message 1")).toBeTruthy();
    expect(container.querySelector(".messages-collapsed-indicator")).toBeNull();
  });

  // A2:VISIBLE_MESSAGE_WINDOW=10000(95bc726a)有意禁用数量折叠;折叠当前不启用,恢复策略后去 skip。
  it.skip("resets collapsed state when conversation head changes", () => {
    const firstBatch: ConversationItem[] = Array.from({ length: 32 }, (_, index) => ({
      id: `session-a-${index + 1}`,
      kind: "message",
      role: index % 2 === 0 ? "user" : "assistant",
      text: `session A message ${index + 1}`,
    }));
    const secondBatch: ConversationItem[] = Array.from({ length: 32 }, (_, index) => ({
      id: `session-b-${index + 1}`,
      kind: "message",
      role: index % 2 === 0 ? "user" : "assistant",
      text: `session B message ${index + 1}`,
    }));

    const { container, rerender } = render(
      <Messages
        items={firstBatch}
        threadId="thread-history-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    // Scope text queries to the message body; the anchor rail labels
    // also contain user-message text (see note above).
    const body = container.querySelector(".messages") as HTMLElement;
    const firstIndicator = container.querySelector(".messages-collapsed-indicator");
    expect(firstIndicator).toBeTruthy();
    if (firstIndicator) {
      fireEvent.click(firstIndicator);
    }
    expect(within(body).getByText("session A message 1")).toBeTruthy();

    rerender(
      <Messages
        items={secondBatch}
        threadId="thread-history-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const bodyAfterRerender = container.querySelector(".messages") as HTMLElement;
    expect(within(bodyAfterRerender).queryByText("session B message 1")).toBeNull();
    const secondIndicator = container.querySelector(".messages-collapsed-indicator");
    expect(secondIndicator).toBeTruthy();
    expect(secondIndicator?.getAttribute("data-collapsed-count")).toBe("2");
  });

  it("keeps title-only reasoning rows visible without echoing title into the working indicator", () => {
    const items: ConversationItem[] = [
      {
        id: "reasoning-1",
        kind: "reasoning",
        summary: "Scanning repository",
        content: "",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    // Spinner + timer + fixed status; reasoning title stays in the thinking row, not the working bar.
    expect(container.querySelector(".working")).toBeTruthy();
    expect(container.querySelector(".working-timer-clock")).toBeTruthy();
    expect(container.querySelector(".working-text")?.textContent ?? "").toContain("响应中");
    expect(container.querySelector(".thinking-block")).toBeTruthy();
    expect(container.querySelector(".thinking-title")).toBeTruthy();
    expect(container.querySelector(".thinking-content")?.textContent ?? "").toContain(
      "Scanning repository",
    );
  });

  it("shows title-only reasoning rows in codex canvas for real-time visibility", () => {
    const items: ConversationItem[] = [
      {
        id: "reasoning-codex-live-1",
        kind: "reasoning",
        summary: "Scanning repository",
        content: "",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        activeEngine="codex"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelector(".thinking-block")).toBeTruthy();
    expect(container.querySelector(".thinking-title")).toBeTruthy();
  });

  it("shows a prominent proxy badge in the working indicator when proxy is enabled", () => {
    const { container } = render(
      <Messages
        items={[]}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        proxyEnabled
        proxyUrl="http://127.0.0.1:7890"
        processingStartedAt={Date.now() - 1_000}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const badge = container.querySelector(".working .working-proxy-badge");
    expect(badge).toBeTruthy();
    expect(badge?.textContent ?? "").toBe("");
    expect(badge?.classList.contains("proxy-status-badge--animated")).toBe(true);
    expect(badge?.getAttribute("aria-label") ?? "").toContain("127.0.0.1:7890");
  });

});
