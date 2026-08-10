// @vitest-environment jsdom
/**
 * 2026-08：消息时间线列表虚拟化已移除。本文件保留长历史 / jump / 重开落底回归，
 * 断言路径恒为静态全量 DOM（data-timeline-virtualized=false）。
 */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationItem } from "../../../types";

vi.mock("./Markdown", () => ({
  Markdown: ({ value, className }: { value: string; className?: string }) => (
    <div className={className}>{value}</div>
  ),
}));

import { Messages } from "./Messages";

describe("Messages static timeline (virtualization removed)", () => {
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

  it("keeps large idle histories on the static full-DOM path", () => {
    const items: ConversationItem[] = Array.from({ length: 220 }, (_, index) => ({
      id: `u${index + 1}`,
      kind: "message" as const,
      role: "user" as const,
      text: `message ${index + 1}`,
    }));

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-jump-static"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(
      container.querySelector(".messages-full")?.getAttribute("data-timeline-virtualized"),
    ).toBe("false");
    expect(container.querySelector(".messages-virtualized-canvas")).toBeNull();
    expect(container.querySelector('[data-message-anchor-id="u180"]')).toBeTruthy();
  });

  it("keeps dense heavy histories static with full detail", () => {
    const heavyMarkdown = [
      "# Heavy section",
      "| A | B | C |",
      "| - | - | - |",
      ...Array.from({ length: 28 }, (_, index) => `| ${index} | value | value |`),
      "```ts",
      ...Array.from({ length: 24 }, (_, index) => `const value${index} = ${index};`),
      "```",
      "<tool_call><invoke name=\"read_file\" /></tool_call>",
    ].join("\n");
    const items: ConversationItem[] = Array.from({ length: 36 }, (_, index) => ({
      id: `heavy-u${index + 1}`,
      kind: "message" as const,
      role: "user" as const,
      text: `${heavyMarkdown}\n\n${index + 1}`,
    }));

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-heavy-static"
        workspaceId="ws-heavy"
        isThinking={false}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(
      container.querySelector(".messages-full")?.getAttribute("data-timeline-virtualized"),
    ).toBe("false");
    expect(container.querySelector(".messages-virtualized-canvas")).toBeNull();
    expect(container.querySelector('[data-message-anchor-id="heavy-u30"]')).toBeTruthy();
  });

  it("keeps short light conversations static with full detail", () => {
    const items: ConversationItem[] = Array.from({ length: 8 }, (_, index) => ({
      id: `assistant-light-${index + 1}`,
      kind: "message" as const,
      role: "assistant" as const,
      text: `canonical assistant payload ${index + 1}`,
      isFinal: true,
    }));

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-static-short"
        workspaceId="ws-short"
        isThinking={false}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelector(".messages-virtualized-canvas")).toBeNull();
    expect(
      container.querySelector(".messages-full")?.getAttribute("data-timeline-virtualized"),
    ).toBe("false");
    expect(screen.getByText(/canonical assistant payload 8/)).toBeTruthy();
  });

  it("jumps to a history message through the static DOM node map", async () => {
    const items: ConversationItem[] = Array.from({ length: 40 }, (_, index) => ({
      id: `jump-u${index + 1}`,
      kind: "message" as const,
      role: "user" as const,
      text: `message ${index + 1}`,
    }));

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-jump-dom"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const scroller = container.querySelector(".messages") as HTMLDivElement;
    const scrollToSpy = vi.spyOn(scroller, "scrollTo");

    act(() => {
      document.dispatchEvent(
        new CustomEvent<string>("doge:jump-to-message", {
          detail: "jump-u30",
        }),
      );
    });

    await waitFor(() => {
      expect(scrollToSpy).toHaveBeenCalled();
    });
  });

  it("does not inject lightweight summary cards while a heavy conversation is streaming", () => {
    const heavyMarkdown = [
      "# Streaming heavy answer",
      "| A | B | C |",
      "| - | - | - |",
      ...Array.from({ length: 32 }, (_, index) => `| ${index} | value | value |`),
      "```ts",
      ...Array.from({ length: 32 }, (_, index) => `const streamingValue${index} = ${index};`),
      "```",
    ].join("\n");
    const items: ConversationItem[] = Array.from({ length: 8 }, (_, index) => ({
      id: `streaming-heavy-${index + 1}`,
      kind: "message" as const,
      role: "assistant" as const,
      text: `${heavyMarkdown}\n\nchunk ${index + 1}`,
      isFinal: index < 7,
    }));

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-heavy-streaming"
        workspaceId="ws-heavy"
        isThinking={true}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(screen.queryByText("Heavy conversation detected")).toBeNull();
    expect(screen.queryByText("Deferred detail")).toBeNull();
    expect(container.querySelector("[data-timeline-virtualized='true']")).toBeNull();
    expect(screen.getAllByText(/Streaming heavy answer/).length).toBeGreaterThan(0);
  });

  it("pins bottom when reopening dense history", async () => {
    const oversizedMarkdown = [
      "# Oversized section",
      "| A | B | C |",
      "| - | - | - |",
      ...Array.from({ length: 90 }, (_, index) => `| ${index} | value | value |`),
      "```ts",
      ...Array.from({ length: 44 }, (_, index) => `const oversizedValue${index} = ${index};`),
      "```",
      "<tool_call><invoke name=\"read_file\" /></tool_call>",
    ].join("\n");
    const items: ConversationItem[] = Array.from({ length: 12 }, (_, index) => ({
      id: `oversized-u${index + 1}`,
      kind: "message" as const,
      role: "user" as const,
      text: `${oversizedMarkdown}\n\n${index + 1}`,
    }));

    const renderWith = (threadId: string | null, visibleItems: ConversationItem[]) => (
      <Messages
        items={visibleItems}
        threadId={threadId}
        workspaceId="ws-heavy"
        isThinking={false}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />
    );
    const { container, rerender } = render(
      renderWith("thread-oversized-prompt", items),
    );

    const scroller = container.querySelector(".messages") as HTMLDivElement;
    let scrollTop = 0;
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 720 },
      scrollHeight: { configurable: true, value: 4_000 },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = Math.max(0, Math.min(value, 4_000 - 720));
        },
      },
    });

    rerender(renderWith(null, []));
    rerender(renderWith("thread-oversized-prompt", items));
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });

    expect(scroller.scrollTop).toBe(4_000 - 720);
    expect(
      container.querySelector(".messages-full")?.getAttribute("data-timeline-virtualized"),
    ).toBe("false");
  });

  it("never flips into virtualization during streaming churn", () => {
    const buildItems = (count: number): ConversationItem[] =>
      Array.from({ length: count }, (_, index) => ({
        id: `flip-u${index + 1}`,
        kind: "message" as const,
        role: "user" as const,
        text: `message ${index + 1}`,
      }));
    const renderWith = (items: ConversationItem[], thinking: boolean) => (
      <Messages
        items={items}
        threadId="thread-flip-disabled"
        workspaceId="ws-flip"
        isThinking={thinking}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />
    );
    const { container, rerender } = render(renderWith(buildItems(20), false));
    rerender(renderWith(buildItems(20), true));
    rerender(renderWith(buildItems(21), true));

    expect(
      container.querySelector(".messages-full")?.getAttribute("data-timeline-virtualized"),
    ).toBe("false");
    expect(container.querySelector(".messages-virtualized-canvas")).toBeNull();
    expect(container.querySelector('[data-message-anchor-id="flip-u21"]')).toBeTruthy();
  });
});
