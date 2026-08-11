// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationItem } from "../../../types";
import { Messages } from "./Messages";

vi.mock("./Markdown", () => ({
  Markdown: ({ value, className }: { value: string; className?: string }) => (
    <div className={className}>{value}</div>
  ),
}));

describe("Messages reasoning visibility and exit plan handoff", () => {
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

  const exitPlanToolItem: ConversationItem = {
    id: "exit-plan-tool",
    kind: "tool",
    toolType: "toolCall",
    title: "Tool: ExitPlanMode",
    detail: "PLAN\n# Plan\n\n- implement feature\n\nPLANFILEPATH\n/Users/demo/.claude/plans/plan.md",
    status: "completed",
  };

  const exitPlanCommandToolItem: ConversationItem = {
    id: "exit-plan-command-tool",
    kind: "tool",
    toolType: "commandExecution",
    title: "Claude / exitplanmode",
    detail: "",
    output: "Exit plan mode?",
    status: "completed",
  };

  it("renders Claude reasoning inline by default when no legacy dock flag is set", () => {
    window.localStorage.removeItem("doge.claude.hideReasoningModule");

    const items: ConversationItem[] = [
      {
        id: "msg-user-inline",
        kind: "message",
        role: "user",
        text: "先分析",
      },
      {
        id: "reasoning-inline",
        kind: "reasoning",
        summary: "思考",
        content: "先检查 Controller 和 Service。",
      },
      {
        id: "msg-assistant-inline",
        kind: "message",
        role: "assistant",
        text: "我已经分析完了。",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-claude-inline"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    fireEvent.click(
      container.querySelector(".messages-process-phase-toggle") as HTMLElement,
    );
    const reasoningBlock = container.querySelector(".thinking-block");
    const assistantMessage = container.querySelector(".message.assistant");
    expect(reasoningBlock).toBeTruthy();
    expect(assistantMessage).toBeTruthy();
    if (!reasoningBlock || !assistantMessage) {
      throw new Error("expected reasoning block and assistant message");
    }
    expect(
      reasoningBlock.compareDocumentPosition(assistantMessage) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("hides Claude reasoning when explicit thinking visibility is disabled", () => {
    window.localStorage.removeItem("doge.claude.hideReasoningModule");

    const items: ConversationItem[] = [
      {
        id: "msg-user-thinking-off",
        kind: "message",
        role: "user",
        text: "hi",
      },
      {
        id: "reasoning-thinking-off",
        kind: "reasoning",
        summary: "思考",
        content: "这段思考不应该展示。",
      },
      {
        id: "msg-assistant-thinking-off",
        kind: "message",
        role: "assistant",
        text: "你好。",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-claude-thinking-off"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        claudeThinkingVisible={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelector(".thinking-block")).toBeNull();
    expect(container.textContent ?? "").not.toContain("这段思考不应该展示。");
    expect(container.textContent ?? "").toContain("你好。");
  });

  it("lets explicit Claude thinking visibility override the legacy hide flag", () => {
    window.localStorage.setItem("doge.claude.hideReasoningModule", "1");

    const items: ConversationItem[] = [
      {
        id: "reasoning-thinking-on",
        kind: "reasoning",
        summary: "思考",
        content: "显式开启时应该展示。",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-claude-thinking-on"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        claudeThinkingVisible
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelector(".thinking-block")).toBeTruthy();
    expect(container.textContent ?? "").toContain("显式开启时应该展示。");
  });

  it("does not apply Claude thinking visibility to non-Claude reasoning", () => {
    const items: ConversationItem[] = [
      {
        id: "codex-reasoning-1",
        kind: "reasoning",
        summary: "Inspect",
        content: "Codex reasoning remains visible.",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-codex-reasoning"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="codex"
        claudeThinkingVisible={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelector(".thinking-block")).toBeTruthy();
    expect(container.textContent ?? "").toContain("Codex reasoning remains visible.");
  });

  it("does not apply the legacy Claude reasoning dock flag to Codex reasoning", () => {
    window.localStorage.setItem("doge.claude.hideReasoningModule", "1");

    const items: ConversationItem[] = [
      {
        id: "codex-reasoning-legacy-flag",
        kind: "reasoning",
        summary: "Inspect",
        content: "Codex reasoning should not use Claude dock behavior.",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-codex-legacy-flag"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="codex"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelector(".thinking-block")).toBeTruthy();
    expect(container.querySelector(".claude-docked-reasoning")).toBeNull();
    expect(container.textContent ?? "").toContain(
      "Codex reasoning should not use Claude dock behavior.",
    );
  });

  it("shows a non-leaking placeholder for hidden Claude reasoning-only history", () => {
    const items: ConversationItem[] = [
      {
        id: "reasoning-only-hidden",
        kind: "reasoning",
        summary: "思考",
        content: "不能泄露的思考正文。",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-claude-reasoning-only"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        claudeThinkingVisible={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.textContent ?? "").toContain("messages.hiddenThinkingContent");
    expect(container.textContent ?? "").not.toContain("messages.emptyThread");
    expect(container.textContent ?? "").not.toContain("不能泄露的思考正文。");
  });

  it("routes exit plan execution buttons through the message tool chain", async () => {
    const onExitPlanModeExecute = vi.fn();
    render(
      <Messages
        items={[exitPlanToolItem]}
        threadId="thread-exit-plan"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
        onExitPlanModeExecute={onExitPlanModeExecute}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Execution Plan ReadyExit Plan mode" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Switch to default approval mode and run" }),
    );

    expect(onExitPlanModeExecute).toHaveBeenCalledWith("default");
    expect(
      screen.getByRole("button", { name: "Switch to default approval mode and run · 已选" }),
    ).toBeTruthy();
  });

  it("renders ExitPlanMode cards collapsed by default", () => {
    render(
      <Messages
        items={[exitPlanToolItem]}
        threadId="thread-exit-plan-collapsed"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
        onExitPlanModeExecute={vi.fn()}
      />,
    );

    const headerButton = screen.getByRole("button", {
      name: "Execution Plan ReadyExit Plan mode",
    });
    expect(headerButton.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Execution handoff")).toBeNull();
  });

  it("keeps ExitPlanMode card expanded during same-thread streaming updates", () => {
    const view = render(
      <Messages
        items={[exitPlanToolItem]}
        threadId="thread-exit-plan-streaming-stable"
        workspaceId="ws-1"
        isThinking={true}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
        onExitPlanModeExecute={vi.fn()}
      />,
    );

    const headerButton = screen.getByRole("button", {
      name: "Execution Plan ReadyExit Plan mode",
    });
    fireEvent.click(headerButton);
    expect(headerButton.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Execution handoff")).toBeTruthy();

    view.rerender(
      <Messages
        items={[
          exitPlanToolItem,
          {
            id: "msg-streaming-followup",
            kind: "message",
            role: "assistant",
            text: "继续执行中",
          },
        ]}
        threadId="thread-exit-plan-streaming-stable"
        workspaceId="ws-1"
        isThinking={true}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
        onExitPlanModeExecute={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Execution Plan ReadyExit Plan mode" }).getAttribute("aria-expanded"),
    ).toBe("true");
    expect(screen.getByText("Execution handoff")).toBeTruthy();
  });

  it("dedupes repeated ExitPlanMode cards and keeps the first one", () => {
    const duplicateExitPlanToolItem: ConversationItem = {
      ...exitPlanToolItem,
      id: "exit-plan-tool-duplicate",
    };

    render(
      <Messages
        items={[exitPlanToolItem, duplicateExitPlanToolItem]}
        threadId="thread-exit-plan-dedupe"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
        onExitPlanModeExecute={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Execution Plan Ready")).toHaveLength(1);
  });

  it("keeps dedupe intact across a selection-freeze recompute with a trailing duplicate", () => {
    // 回归:effectiveItems fast path 在选区冻结触发的引用级重算时,
    // 曾把被去重的尾部 exit-plan 条目写回结果末尾(丢真尾项、复活重复卡片)。
    const duplicateExitPlanToolItem: ConversationItem = {
      ...exitPlanToolItem,
      id: "exit-plan-tool-trailing-duplicate",
    };
    const assistantItem: ConversationItem = {
      id: "msg-assistant-freeze",
      kind: "message",
      role: "assistant",
      text: "计划已经生成完毕。",
    };

    render(
      <Messages
        items={[exitPlanToolItem, assistantItem, duplicateExitPlanToolItem]}
        threadId="thread-exit-plan-freeze"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
        onExitPlanModeExecute={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Execution Plan Ready")).toHaveLength(1);
    const assistantText = screen.getByText("计划已经生成完毕。");

    const selection = window.getSelection();
    if (!selection) {
      throw new Error("expected jsdom selection");
    }
    const range = document.createRange();
    range.selectNodeContents(assistantText);
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent(document, new Event("selectionchange"));

    expect(screen.getByText("计划已经生成完毕。")).toBeTruthy();
    expect(screen.getAllByText("Execution Plan Ready")).toHaveLength(1);
    selection.removeAllRanges();
  });

  it("dedupes mixed ExitPlanMode runtime variants and keeps the first card", () => {
    const duplicateRuntimeVariant: ConversationItem = {
      id: "exit-plan-tool-runtime-duplicate",
      kind: "tool",
      toolType: "commandExecution",
      title: "Claude / exitplanmode",
      detail: "",
      output: "Exit plan mode?",
      status: "completed",
    };

    render(
      <Messages
        items={[exitPlanToolItem, duplicateRuntimeVariant]}
        threadId="thread-exit-plan-runtime-dedupe"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
        onExitPlanModeExecute={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Execution Plan Ready")).toHaveLength(1);
  });

  it("keeps command-like ExitPlanMode items on the dedicated handoff card", () => {
    render(
      <Messages
        items={[exitPlanCommandToolItem]}
        threadId="thread-exit-plan-command"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
        onExitPlanModeExecute={vi.fn()}
      />,
    );

    expect(screen.getByText("Execution Plan Ready")).toBeTruthy();
    expect(screen.queryByText("Claude / exitplanmode")).toBeNull();
  });
});
