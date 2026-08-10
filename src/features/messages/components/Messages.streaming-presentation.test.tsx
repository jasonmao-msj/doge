// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationItem } from "../../../types";
import type { GroupedEntry } from "../utils/groupToolItems";
import type { TurnFileChangesSummary } from "../utils/turnFileChanges";
import type { MessagesTimelineProps } from "../orchestration/models/messagesTimelineModels";

const timelineSnapshots = vi.hoisted(() => ({
  entries: [] as Array<{
    assistantFinalBoundaryIds: string[];
    renderedTexts: string[];
    threadId: string | null;
    liveAssistantIsFinal: boolean | null;
    liveAssistantText: string | null;
    liveReasoningItemId: string | null;
    latestReasoningId: string | null;
    presentationMode: string;
    sessionFileChangesSummary: TurnFileChangesSummary | null;
    isWorking: boolean;
  }>,
}));

function collectGroupedEntryTexts(entries: GroupedEntry[]) {
  return entries.flatMap((entry) => {
    if (entry.kind === "item") {
      return entry.item.kind === "message" ? [entry.item.text] : [];
    }
    return entry.items.flatMap((item) => [item.title, item.output ?? ""]);
  });
}

vi.mock("./MessagesTimeline", () => ({
  MessagesTimeline: (props: MessagesTimelineProps) => {
    timelineSnapshots.entries.push({
      assistantFinalBoundaryIds: Array.from(props.snapshot.assistantFinalBoundarySet),
      renderedTexts: collectGroupedEntryTexts(props.snapshot.groupedEntries),
      threadId: props.runtime.threadId,
      liveAssistantIsFinal: props.live.liveAssistantItem?.isFinal ?? null,
      liveAssistantText: props.live.liveAssistantItem?.text ?? null,
      liveReasoningItemId: props.live.liveReasoningItem?.id ?? null,
      latestReasoningId: props.live.latestReasoningId,
      presentationMode: props.presentation.presentationMode,
      sessionFileChangesSummary: props.snapshot.sessionFileChangesSummary,
      isWorking: props.live.isWorking,
    });
    return <div data-testid="messages-timeline-probe" />;
  },
}));

vi.mock("./Markdown", () => ({
  Markdown: ({ value, className }: { value: string; className?: string }) => (
    <div className={className}>{value}</div>
  ),
}));

import { Messages } from "./Messages";

describe("Messages streaming presentation contract", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    timelineSnapshots.entries = [];
    window.localStorage.setItem("ccgui.claude.hideReasoningModule", "0");
    window.localStorage.removeItem("ccgui.messages.live.autoFollow");
    window.localStorage.setItem("ccgui.messages.live.collapseMiddleSteps", "0");
  });

  beforeAll(() => {
    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = vi.fn();
    }
    if (!HTMLElement.prototype.scrollTo) {
      HTMLElement.prototype.scrollTo = vi.fn();
    }
  });

  it("updates the timeline and final boundary in the same render", async () => {
    const liveAssistantItem: Extract<ConversationItem, { kind: "message" }> = {
      id: "assistant-1",
      kind: "message",
      role: "assistant",
      text: "第一段输出",
      isFinal: false,
    };
    const initialItems: ConversationItem[] = [
      {
        id: "user-1",
        kind: "message",
        role: "user",
        text: "继续分析",
      },
      liveAssistantItem,
    ];

    const view = render(
      <Messages
        items={initialItems}
        threadId="thread-stream-contract"
        workspaceId="ws-1"
        isThinking
        activeEngine="codex"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    timelineSnapshots.entries = [];

    view.rerender(
      <Messages
        items={[
          initialItems[0],
          {
            ...liveAssistantItem,
            text: "第一段输出\n\n第二段输出",
            isFinal: true,
          },
        ]}
        threadId="thread-stream-contract"
        workspaceId="ws-1"
        isThinking
        activeEngine="codex"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(
      timelineSnapshots.entries.some(
        (entry) =>
          entry.liveAssistantText === "第一段输出\n\n第二段输出"
          && entry.liveAssistantIsFinal === true
          && entry.assistantFinalBoundaryIds.includes("assistant-1"),
      ),
    ).toBe(true);

    await waitFor(() => {
      expect(
        timelineSnapshots.entries.some((entry) =>
          entry.assistantFinalBoundaryIds.includes("assistant-1")
        ),
      ).toBe(true);
    });
  });

  it("does not reuse a stable presentation snapshot after switching threads", () => {
    const threadAItems: ConversationItem[] = [
      {
        id: "user-a",
        kind: "message",
        role: "user",
        text: "分析 A 会话",
      },
      {
        id: "assistant-a",
        kind: "message",
        role: "assistant",
        text: "A 会话的最终总结",
        isFinal: true,
      },
    ];
    const threadBItems: ConversationItem[] = [
      {
        id: "user-b",
        kind: "message",
        role: "user",
        text: "分析 B 会话",
      },
      {
        id: "assistant-b",
        kind: "message",
        role: "assistant",
        text: "B 会话正在输出",
        isFinal: false,
      },
    ];

    const view = render(
      <Messages
        items={threadAItems}
        threadId="thread-a"
        workspaceId="ws-1"
        isThinking
        activeEngine="codex"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    timelineSnapshots.entries = [];

    view.rerender(
      <Messages
        items={threadBItems}
        threadId="thread-b"
        workspaceId="ws-1"
        isThinking
        activeEngine="codex"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const threadBSnapshots = timelineSnapshots.entries.filter(
      (entry) => entry.threadId === "thread-b",
    );
    expect(threadBSnapshots.length).toBeGreaterThan(0);
    expect(
      threadBSnapshots.some((entry) =>
        entry.renderedTexts.some((text) => text.includes("A 会话")),
      ),
    ).toBe(false);
    expect(
      threadBSnapshots.some((entry) =>
        entry.renderedTexts.some((text) => text.includes("B 会话")),
      ),
    ).toBe(true);
  });

  it("surfaces a newly inserted live reasoning row before the deferred snapshot catches up", () => {
    const initialItems: ConversationItem[] = [
      {
        id: "user-1",
        kind: "message",
        role: "user",
        text: "具体模型型号",
      },
      {
        id: "assistant-1",
        kind: "message",
        role: "assistant",
        text: "正在生成",
        isFinal: false,
      },
    ];

    const view = render(
      <Messages
        items={initialItems}
        threadId="thread-live-reasoning"
        workspaceId="ws-1"
        isThinking
        activeEngine="kimi"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    timelineSnapshots.entries = [];

    view.rerender(
      <Messages
        items={[
          initialItems[0],
          {
            id: "reasoning-live",
            kind: "reasoning",
            summary: "思考",
            content: "用户问具体模型型号，直接回答即可。",
            engineSource: "kimi",
          },
          initialItems[1],
        ]}
        threadId="thread-live-reasoning"
        workspaceId="ws-1"
        isThinking
        activeEngine="kimi"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(
      timelineSnapshots.entries.some(
        (entry) =>
          entry.latestReasoningId === "reasoning-live"
          && entry.liveReasoningItemId === "reasoning-live",
      ),
    ).toBe(true);
  });

  it("keeps expanded full history available while streaming after a jump request", async () => {
    const items: ConversationItem[] = [
      {
        id: "user-oldest",
        kind: "message",
        role: "user",
        text: "最早的历史问题",
      },
      ...Array.from({ length: 160 }, (_, index) => ({
        id: `assistant-history-${index + 1}`,
        kind: "message" as const,
        role: "assistant" as const,
        text: `历史回复 ${index + 1}`,
        isFinal: true,
      })),
      {
        id: "user-latest",
        kind: "message",
        role: "user",
        text: "最新问题",
      },
      {
        id: "assistant-live",
        kind: "message",
        role: "assistant",
        text: "正在生成的回复",
        isFinal: false,
      },
    ];

    render(
      <Messages
        items={items}
        threadId="thread-expanded-streaming-window"
        workspaceId="ws-1"
        isThinking
        activeEngine="codex"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    timelineSnapshots.entries = [];

    act(() => {
      document.dispatchEvent(
        new CustomEvent<string>("ccgui:jump-to-message", {
          detail: "user-oldest",
        }),
      );
    });

    await waitFor(() => {
      expect(
        timelineSnapshots.entries.some(
          (entry) => entry.presentationMode === "realtime-expanded-history-jump",
        ),
      ).toBe(true);
    });

    const expandedStreamingSnapshot = timelineSnapshots.entries
      .filter((entry) => entry.presentationMode === "realtime-expanded-history-jump")
      .at(-1);

    expect(expandedStreamingSnapshot?.renderedTexts).toContain("最新问题");
    expect(expandedStreamingSnapshot?.renderedTexts).toContain("正在生成的回复");
    expect(expandedStreamingSnapshot?.renderedTexts).toContain("最早的历史问题");
    expect(
      expandedStreamingSnapshot?.renderedTexts.some((text) => text === "历史回复 1"),
    ).toBe(true);
  });

  it("keeps the session file-change summary gated while Codex is still working", async () => {
    const items: ConversationItem[] = [
      {
        id: "user-1",
        kind: "message",
        role: "user",
        text: "更新文件",
      },
      {
        id: "tool-file-change-1",
        kind: "tool",
        toolType: "fileChange",
        title: "File changes",
        detail: "",
        status: "completed",
        changes: [
          {
            path: "src/App.tsx",
            kind: "modified",
            diff: "@@ -1,1 +1,1 @@\n-old\n+new",
          },
        ],
      },
      {
        id: "assistant-1",
        kind: "message",
        role: "assistant",
        text: "还在总结",
        isFinal: true,
      },
    ];

    const view = render(
      <Messages
        items={items}
        threadId="thread-codex-file-summary"
        workspaceId="ws-1"
        isThinking
        activeEngine="codex"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    await waitFor(() => {
      expect(
        timelineSnapshots.entries.some(
          (entry) => entry.isWorking && entry.sessionFileChangesSummary !== null,
        ),
      ).toBe(true);
    });

    view.rerender(
      <Messages
        items={items}
        threadId="thread-codex-file-summary"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="codex"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    await waitFor(() => {
      expect(
        timelineSnapshots.entries.some(
          (entry) => !entry.isWorking && entry.sessionFileChangesSummary !== null,
        ),
      ).toBe(true);
    });
  });
});
