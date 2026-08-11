// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getLiveAssistantTextSnapshot,
  LIVE_ASSISTANT_TEXT_PUBLISH_INTERVAL_MS,
  resetLiveAssistantTextChannelForTests,
} from "../utils/liveAssistantTextChannel";
import { useLiveAssistantText } from "./useLiveAssistantText";
import { useThreadItemEvents } from "./useThreadItemEvents";

vi.mock("../utils/realtimePerfFlags", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../utils/realtimePerfFlags")
  >();
  return { ...actual, isLiveTextExternalizationEnabled: () => true };
});

const WORKSPACE_ID = "ws-1";
const SHARED_THREAD_ID = "shared:session-a";
const OTHER_THREAD_ID = "codex:session-b";
const ASSISTANT_ITEM_ID = "assistant-a-1";

const makeHook = () => {
  const dispatch = vi.fn();
  const { result, rerender } = renderHook(
    ({ activeThreadId }: { activeThreadId: string }) => {
      const threadItemEvents = useThreadItemEvents({
        activeThreadId,
        dispatch,
        getCustomName: vi.fn(() => undefined),
        markProcessing: vi.fn(),
        markReviewing: vi.fn(),
        safeMessageActivity: vi.fn(),
        recordThreadActivity: vi.fn(),
        applyCollabThreadLinks: vi.fn(),
        interruptedThreadsRef: {
          current: new Map<string, Map<string, true>>(),
        },
      });
      const activeLiveText = useLiveAssistantText(activeThreadId, true);
      return { threadItemEvents, activeLiveText };
    },
    { initialProps: { activeThreadId: OTHER_THREAD_ID } },
  );
  return { result, rerender, dispatch };
};

const agentDeltaActions = (dispatch: ReturnType<typeof vi.fn>) =>
  dispatch.mock.calls
    .map(([action]) => action as Record<string, unknown>)
    .filter((action) => action.type === "appendAgentDelta");

describe("useThreadItemEvents Shared navigation projection", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    window.localStorage.setItem("doge.perf.realtimeBatching", "1");
    resetLiveAssistantTextChannelForTests();
  });

  afterEach(() => {
    resetLiveAssistantTextChannelForTests();
    window.localStorage.removeItem("doge.perf.realtimeBatching");
    vi.useRealTimers();
  });

  it("creates the first assistant shell while Shared is inactive and reuses its live text on return", () => {
    const { result, rerender, dispatch } = makeHook();

    act(() => {
      result.current.threadItemEvents.onAgentMessageDelta({
        workspaceId: WORKSPACE_ID,
        threadId: SHARED_THREAD_ID,
        itemId: ASSISTANT_ITEM_ID,
        delta: "第一段",
      });
    });

    expect(agentDeltaActions(dispatch)).toEqual([
      expect.objectContaining({
        threadId: SHARED_THREAD_ID,
        itemId: ASSISTANT_ITEM_ID,
        delta: "第一段",
      }),
    ]);

    act(() => {
      result.current.threadItemEvents.onAgentMessageDelta({
        workspaceId: WORKSPACE_ID,
        threadId: SHARED_THREAD_ID,
        itemId: ASSISTANT_ITEM_ID,
        delta: "，后台继续运行",
      });
      vi.advanceTimersByTime(LIVE_ASSISTANT_TEXT_PUBLISH_INTERVAL_MS);
    });

    expect(agentDeltaActions(dispatch)).toHaveLength(1);
    expect(getLiveAssistantTextSnapshot(SHARED_THREAD_ID)).toMatchObject({
      itemId: ASSISTANT_ITEM_ID,
      text: "第一段，后台继续运行",
    });

    rerender({ activeThreadId: SHARED_THREAD_ID });

    expect(agentDeltaActions(dispatch)).toHaveLength(1);
    expect(result.current.activeLiveText?.text).toBe(
      "第一段，后台继续运行",
    );
  });

  it("settles one terminal final for a Shared turn completed while inactive", () => {
    const { result, rerender, dispatch } = makeHook();
    const finalText = "第一段，后台已经完成。";

    act(() => {
      result.current.threadItemEvents.onAgentMessageDelta({
        workspaceId: WORKSPACE_ID,
        threadId: SHARED_THREAD_ID,
        itemId: ASSISTANT_ITEM_ID,
        delta: "第一段",
      });
      result.current.threadItemEvents.onAgentMessageCompleted({
        workspaceId: WORKSPACE_ID,
        threadId: SHARED_THREAD_ID,
        itemId: ASSISTANT_ITEM_ID,
        text: finalText,
      });
    });

    const readFinalActions = () =>
      dispatch.mock.calls
        .map(([action]) => action as Record<string, unknown>)
        .filter((action) =>
          action.threadId === SHARED_THREAD_ID
          && action.itemId === ASSISTANT_ITEM_ID
          && action.text === finalText,
        );

    expect(readFinalActions()).toHaveLength(1);
    expect(getLiveAssistantTextSnapshot(SHARED_THREAD_ID)).toBeNull();

    rerender({ activeThreadId: SHARED_THREAD_ID });
    expect(readFinalActions()).toHaveLength(1);
  });

  it("flushes a pending normalized assistant snapshot when Shared becomes active", () => {
    const { result, rerender, dispatch } = makeHook();

    act(() => {
      result.current.threadItemEvents.onNormalizedRealtimeEvent({
        engine: "codex",
        workspaceId: WORKSPACE_ID,
        threadId: SHARED_THREAD_ID,
        eventId: "shared-snapshot-1",
        itemKind: "message",
        timestampMs: 1,
        operation: "itemUpdated",
        sourceMethod: "item/updated",
        item: {
          id: ASSISTANT_ITEM_ID,
          kind: "message",
          role: "assistant",
          text: "normalized snapshot",
        },
      });
    });

    expect(dispatch).not.toHaveBeenCalled();

    rerender({ activeThreadId: SHARED_THREAD_ID });

    expect(dispatch).toHaveBeenCalledWith({
      type: "applyNormalizedRealtimeEvent",
      workspaceId: WORKSPACE_ID,
      threadId: SHARED_THREAD_ID,
      event: expect.objectContaining({
        eventId: "shared-snapshot-1",
        operation: "itemUpdated",
      }),
      hasCustomName: false,
    });
  });

  it("does not flush another thread's queued delta when Shared creates its shell", () => {
    const { result, dispatch } = makeHook();

    act(() => {
      result.current.threadItemEvents.onAgentMessageDelta({
        workspaceId: WORKSPACE_ID,
        threadId: OTHER_THREAD_ID,
        itemId: "assistant-b-1",
        delta: "native queued text",
      });
      result.current.threadItemEvents.onAgentMessageDelta({
        workspaceId: WORKSPACE_ID,
        threadId: SHARED_THREAD_ID,
        itemId: ASSISTANT_ITEM_ID,
        delta: "shared urgent shell",
      });
    });

    expect(agentDeltaActions(dispatch)).toEqual([
      expect.objectContaining({
        threadId: SHARED_THREAD_ID,
        itemId: ASSISTANT_ITEM_ID,
        delta: "shared urgent shell",
      }),
    ]);

    act(() => {
      vi.advanceTimersByTime(40);
    });

    expect(agentDeltaActions(dispatch)).toEqual([
      expect.objectContaining({ threadId: SHARED_THREAD_ID }),
      expect.objectContaining({
        threadId: OTHER_THREAD_ID,
        itemId: "assistant-b-1",
        delta: "native queued text",
      }),
    ]);
  });
});
