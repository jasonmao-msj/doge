// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationItem } from "../../../types";
import type { ConversationState } from "../../threads/contracts/conversationCurtainContracts";
import { CODEX_FINALIZING_LIVE_WINDOW_MS } from "../constants/messagesConstants";
import { Messages } from "./Messages";

vi.mock("./Markdown", () => ({
  Markdown: ({ value, className }: { value: string; className?: string }) => (
    <div className={className}>
      <p>{value}</p>
    </div>
  ),
}));

describe("Messages live markdown streaming", () => {
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

  it("renders the latest claude assistant row as markdown while streaming", () => {
    const items: ConversationItem[] = [
      {
        id: "user-claude-live-1",
        kind: "message",
        role: "user",
        text: "帮我分析这个问题",
      },
      {
        id: "assistant-live:turn-1",
        kind: "message",
        role: "assistant",
        text: "高概率这是前端渲染问题，正文流已经到了。",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="claude:thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const markdownParagraph = container.querySelector(".message.assistant .markdown p");
    expect(markdownParagraph?.textContent ?? "").toContain("高概率这是前端渲染问题");
    expect(container.querySelector(".message.assistant .markdown-live-streaming")).toBeTruthy();
  });

  it("renders the latest gemini assistant row as live markdown while streaming", () => {
    const items: ConversationItem[] = [
      {
        id: "user-gemini-live-1",
        kind: "message",
        role: "user",
        text: "总结这次检查",
      },
      {
        id: "assistant-gemini-live-1",
        kind: "message",
        role: "assistant",
        text: "Gemini 正在流式输出结论。",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="gemini:thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        activeEngine="gemini"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const markdownParagraph = container.querySelector(".message.assistant .markdown p");
    expect(markdownParagraph?.textContent ?? "").toContain("Gemini 正在流式输出结论");
    expect(container.querySelector(".message.assistant .markdown-live-streaming")).toBeTruthy();
  });

  it("updates codex reasoning row when streamed body arrives", async () => {
    const initialItems: ConversationItem[] = [
      {
        id: "reasoning-codex-stream-1",
        kind: "reasoning",
        summary: "Preparing plan",
        content: "",
      },
    ];

    const { container, rerender } = render(
      <Messages
        items={initialItems}
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

    const streamedItems: ConversationItem[] = [
      {
        id: "reasoning-codex-stream-1",
        kind: "reasoning",
        summary: "Preparing plan\nStep 1 complete",
        content: "",
      },
    ];

    rerender(
      <Messages
        items={streamedItems}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        activeEngine="codex"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    await waitFor(() => {
      expect(container.querySelector(".thinking-content")?.textContent ?? "").toContain(
        "Step 1 complete",
      );
    });
  });

  it("keeps the latest assistant row on the live markdown surface briefly after streaming stops", () => {
    vi.useFakeTimers();
    try {
      const streamingItems: ConversationItem[] = [
        {
          id: "user-finalizing-live-1",
          kind: "message",
          role: "user",
          text: "帮我给出最后总结",
        },
        {
          id: "assistant-finalizing-live-1",
          kind: "message",
          role: "assistant",
          text: "- streaming 阶段已经可见的总结",
          isFinal: false,
        },
      ];
      const completedItems: ConversationItem[] = [
        streamingItems[0],
        {
          id: "assistant-finalizing-live-1",
          kind: "message",
          role: "assistant",
          text: [
            "- streaming 阶段已经可见的总结",
            ...Array.from(
              { length: 16 },
              (_, index) => `- 第 ${index + 1} 条 completion 追加总结：这是一段较长的 Codex completion 内容，用来确认 finalizing window 不会立刻切回完整 Markdown。`,
            ),
          ].join("\n"),
          isFinal: true,
        },
      ];

      const { container, rerender } = render(
        <Messages
          items={streamingItems}
          threadId="codex:finalizing-live-1"
          workspaceId="ws-1"
          isThinking
          processingStartedAt={Date.now() - 1_000}
          activeEngine="codex"
          openTargets={[]}
          selectedOpenAppId=""
        />,
      );

      expect(container.querySelector(".message.assistant .markdown-live-streaming")).toBeTruthy();

      rerender(
        <Messages
          items={completedItems}
          threadId="codex:finalizing-live-1"
          workspaceId="ws-1"
          isThinking={false}
          activeEngine="codex"
          openTargets={[]}
          selectedOpenAppId=""
        />,
      );

      expect(container.querySelector(".message.assistant .markdown-live-streaming")).toBeTruthy();
      expect(container.querySelector(".messages-final-boundary")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the completion frame on the live markdown surface before passive effects flush", () => {
    const items: ConversationItem[] = [
      {
        id: "user-finalizing-commit-frame-1",
        kind: "message",
        role: "user",
        text: "最后总结",
      },
      {
        id: "assistant-finalizing-commit-frame-1",
        kind: "message",
        role: "assistant",
        text: "最终总结：\n- A\n- B",
        isFinal: true,
      },
    ];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      act(() => {
        flushSync(() => {
          root.render(
            <Messages
              items={items}
              threadId="codex:finalizing-commit-frame-1"
              workspaceId="ws-1"
              isThinking
              activeEngine="codex"
              openTargets={[]}
              selectedOpenAppId=""
            />,
          );
        });
      });

      act(() => {
        flushSync(() => {
          root.render(
            <Messages
              items={items}
              threadId="codex:finalizing-commit-frame-1"
              workspaceId="ws-1"
              isThinking={false}
              activeEngine="codex"
              openTargets={[]}
              selectedOpenAppId=""
            />,
          );
        });
        expect(container.querySelector(".message.assistant .markdown-live-streaming")).toBeTruthy();
        expect(container.querySelector(".messages-final-boundary")).toBeNull();
      });
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });

  it("restores final boundary after the finalizing live window elapses", () => {
    vi.useFakeTimers();
    try {
      const items: ConversationItem[] = [
        {
          id: "user-finalizing-boundary-1",
          kind: "message",
          role: "user",
          text: "继续",
        },
        {
          id: "assistant-finalizing-boundary-1",
          kind: "message",
          role: "assistant",
          text: "最终整理如下",
          isFinal: true,
        },
      ];

      const { container, rerender } = render(
        <Messages
          items={items}
          threadId="codex:finalizing-boundary-1"
          workspaceId="ws-1"
          isThinking
          activeEngine="codex"
          openTargets={[]}
          selectedOpenAppId=""
        />,
      );

      rerender(
        <Messages
          items={items}
          threadId="codex:finalizing-boundary-1"
          workspaceId="ws-1"
          isThinking={false}
          activeEngine="codex"
          openTargets={[]}
          selectedOpenAppId=""
        />,
      );

      act(() => {
        vi.advanceTimersByTime(CODEX_FINALIZING_LIVE_WINDOW_MS + 1);
      });

      expect(container.querySelector(".messages-final-boundary")).toBeTruthy();
      expect(container.querySelector(".message.assistant .markdown-live-streaming")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("freezes assistant content updates while text is selected", () => {
    const initialItem: Extract<ConversationItem, { kind: "message" }> = {
      id: "assistant-selection-1",
      kind: "message",
      role: "assistant",
      text: "这是用于复制稳定性的测试文本。",
    };
    const initialItems: ConversationItem[] = [initialItem];

    const { container, rerender } = render(
      <Messages
        items={initialItems}
        threadId="thread-selection-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const initialParagraph = container.querySelector(".message.assistant .markdown p");
    const initialTextNode = initialParagraph?.firstChild;
    expect(initialTextNode?.textContent).toBe("这是用于复制稳定性的测试文本。");

    const selection = window.getSelection();
    selection?.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(initialTextNode as Node);
    selection?.addRange(range);
    act(() => {
      document.dispatchEvent(new Event("selectionchange"));
    });
    expect(selection?.toString()).toBe("这是用于复制稳定性的测试文本。");

    const updatedItem: Extract<ConversationItem, { kind: "message" }> = {
      ...initialItem,
      text: "新的流式内容不应打断当前复制。",
    };
    const conversationState: ConversationState = {
      items: [updatedItem],
      plan: null,
      userInputQueue: [],
      meta: {
        workspaceId: "ws-1",
        threadId: "thread-selection-1",
        engine: "codex",
        activeTurnId: null,
        isThinking: false,
        heartbeatPulse: 3,
        historyRestoredAtMs: null,
      },
    };

    rerender(
      <Messages
        items={[updatedItem]}
        threadId="thread-selection-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
        userInputRequests={[]}
        conversationState={conversationState}
      />,
    );

    const rerenderedParagraph = container.querySelector(".message.assistant .markdown p");
    expect(rerenderedParagraph?.textContent).toBe("这是用于复制稳定性的测试文本。");
  });

  it("keeps a single codex reasoning row stable under rapid stream updates", async () => {
    const { container, rerender } = render(
      <Messages
        items={[
          {
            id: "reasoning-codex-rapid-1",
            kind: "reasoning",
            summary: "Drafting response",
            content: "",
          },
        ]}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        activeEngine="codex"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    for (let index = 1; index <= 8; index += 1) {
      rerender(
        <Messages
          items={[
            {
              id: "reasoning-codex-rapid-1",
              kind: "reasoning",
              summary: `Drafting response\nchunk ${index}`,
              content: "",
            },
          ]}
          threadId="thread-1"
          workspaceId="ws-1"
          isThinking
          processingStartedAt={Date.now() - 1_000}
          activeEngine="codex"
          openTargets={[]}
          selectedOpenAppId=""
        />,
      );
    }

    expect(container.querySelectorAll(".thinking-block").length).toBe(1);
    await waitFor(() => {
      expect(container.querySelector(".thinking-content")?.textContent ?? "").toContain(
        "chunk 8",
      );
    });
  });
});
