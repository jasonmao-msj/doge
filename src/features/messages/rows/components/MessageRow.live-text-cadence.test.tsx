// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendLiveAssistantText,
  LIVE_ASSISTANT_TEXT_PUBLISH_INTERVAL_MS,
  resetLiveAssistantTextChannelForTests,
} from "@/conversation-presentation/liveAssistantTextChannel";
import { MessageRow } from "./MessageRow";

const markdownCalls = vi.hoisted(() => [] as string[]);

vi.mock("@/conversation-presentation/realtimePerfFlags", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/conversation-presentation/realtimePerfFlags")
  >();
  return {
    ...actual,
    isLiveTextExternalizationEnabled: () => true,
  };
});

vi.mock("../../components/Markdown", () => ({
  Markdown: ({ value }: { value: string }) => {
    markdownCalls.push(value);
    return <div data-testid="markdown">{value}</div>;
  },
}));

describe("MessageRow live text cadence", () => {
  afterEach(() => {
    cleanup();
    resetLiveAssistantTextChannelForTests();
    markdownCalls.length = 0;
    vi.useRealTimers();
  });

  it("renders one latest value per channel publish without a stale deferred commit", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    appendLiveAssistantText("thread-live", "assistant-live", "Hello");
    render(
      <MessageRow
        item={{
          id: "assistant-live",
          kind: "message",
          role: "assistant",
          text: "Hello",
        }}
        threadId="thread-live"
        isStreaming
        isCopied={false}
        onCopy={vi.fn()}
      />,
    );
    markdownCalls.length = 0;

    act(() => {
      appendLiveAssistantText("thread-live", "assistant-live", " world");
    });
    expect(markdownCalls).toHaveLength(0);

    act(() => {
      vi.advanceTimersByTime(LIVE_ASSISTANT_TEXT_PUBLISH_INTERVAL_MS);
    });
    expect(markdownCalls).toEqual(["Hello world"]);
  });
});
