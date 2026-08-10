// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getClientStoreSync,
  writeClientStoreValue,
} from "../../../services/clientStorage";
import { buildConversationItem } from "../../../utils/threadItems";
import {
  buildLiveAssistantShadowTranscriptId,
  flushLiveAssistantShadowTranscriptsNow,
  resetLiveAssistantShadowTranscriptsForTests,
} from "../utils/liveAssistantShadowTranscript";
import {
  canProgressEventStartProcessing,
  useThreadItemEvents,
} from "./useThreadItemEvents";
import {
  workspaceScopedSet,
} from "./workspaceScopedMap";

vi.mock("../../../utils/threadItems", () => ({
  buildConversationItem: vi.fn(),
}));

type ItemPayload = Record<string, unknown>;

type SetupOverrides = {
  activeThreadId?: string | null;
  resolveCanonicalThreadId?: (threadId: string) => string;
  getCustomName?: (workspaceId: string, threadId: string) => string | undefined;
  resolveCollaborationUiMode?: (
    threadId: string,
  ) => "plan" | "code" | null;
  onAgentMessageCompletedExternal?: (payload: {
    workspaceId: string;
    threadId: string;
    itemId: string;
    text: string;
  }) => void;
  onExitPlanModeToolCompleted?: (payload: {
    workspaceId: string;
    threadId: string;
    itemId: string;
  }) => void;
  scheduleRealtimeDispatch?: (run: () => void) => void;
};

const makeOptions = (overrides: SetupOverrides = {}) => {
  const dispatch = vi.fn();
  const markProcessing = vi.fn();
  const markReviewing = vi.fn();
  const safeMessageActivity = vi.fn();
  const recordThreadActivity = vi.fn();
  const applyCollabThreadLinks = vi.fn();
  const getCustomName =
    overrides.getCustomName ?? vi.fn(() => undefined);
  const resolveCollaborationUiMode = overrides.resolveCollaborationUiMode ?? undefined;
  // chat-stream-render-isolation-2026-06 task 8: workspace-scope ref
  // shape migrated from Set<threadId> to Map<workspaceId, Map<threadId, true>>.
  const interruptedThreadsRef = {
    current: new Map<string, Map<string, true>>(),
  };
  const onAgentMessageCompletedExternal =
    overrides.onAgentMessageCompletedExternal ?? undefined;
  const onExitPlanModeToolCompleted =
    overrides.onExitPlanModeToolCompleted ?? undefined;

  const { result, rerender, unmount } = renderHook(
    ({ activeThreadId }: { activeThreadId: string | null }) =>
      useThreadItemEvents({
        activeThreadId,
        dispatch,
        resolveCanonicalThreadId: overrides.resolveCanonicalThreadId,
        getCustomName,
        resolveCollaborationUiMode,
        markProcessing,
        markReviewing,
        safeMessageActivity,
        recordThreadActivity,
        applyCollabThreadLinks,
        interruptedThreadsRef,
        onAgentMessageCompletedExternal,
        onExitPlanModeToolCompleted,
        scheduleRealtimeDispatch: overrides.scheduleRealtimeDispatch,
      }),
    {
      initialProps: {
        activeThreadId: overrides.activeThreadId ?? null,
      },
    },
  );

  return {
    result,
    rerender,
    unmount,
    dispatch,
    markProcessing,
    markReviewing,
    safeMessageActivity,
    recordThreadActivity,
    applyCollabThreadLinks,
    getCustomName,
    interruptedThreadsRef,
    onAgentMessageCompletedExternal,
    onExitPlanModeToolCompleted,
  };
};

describe("canProgressEventStartProcessing", () => {
  it("denies Codex progress startup without changing other engines", () => {
    expect(canProgressEventStartProcessing("codex")).toBe(false);
    expect(canProgressEventStartProcessing("claude")).toBe(true);
    expect(canProgressEventStartProcessing("gemini")).toBe(true);
    expect(canProgressEventStartProcessing("opencode")).toBe(true);
  });
});

describe("useThreadItemEvents", () => {
  const convertedItem = {
    id: "item-1",
    kind: "message",
    role: "assistant",
    text: "Hello",
  } as const;

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.removeItem("doge.perf.realtimeBatching");
    vi.mocked(buildConversationItem).mockReturnValue(convertedItem);
    resetLiveAssistantShadowTranscriptsForTests();
  });

  it("dispatches item updates and marks review mode on item start", () => {
    const getCustomName = vi.fn(() => "Custom");
    const { result, dispatch, markProcessing, markReviewing, safeMessageActivity, applyCollabThreadLinks } =
      makeOptions({ getCustomName });
    const item: ItemPayload = { type: "enteredReviewMode", id: "item-1" };

    act(() => {
      result.current.onItemStarted("ws-1", "thread-1", item);
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
      engine: "codex",
    });
    expect(markProcessing).not.toHaveBeenCalled();
    expect(markReviewing).toHaveBeenCalledWith("thread-1", true);
    expect(applyCollabThreadLinks).toHaveBeenCalledWith("thread-1", item);
    expect(dispatch).toHaveBeenCalledWith({
      type: "upsertItem",
      workspaceId: "ws-1",
      threadId: "thread-1",
      item: convertedItem,
      hasCustomName: true,
    });
    expect(safeMessageActivity).toHaveBeenCalled();
  });

  it("passes workspace context when a Codex subagent activity completes", () => {
    vi.mocked(buildConversationItem).mockReturnValue(null);
    const { result, applyCollabThreadLinks } = makeOptions();
    const item: ItemPayload = {
      type: "subAgentActivity",
      id: "activity-1",
      kind: "started",
      agentThreadId: "child-thread",
      agentPath: "/root/review_webview_lifecycle",
    };

    act(() => {
      result.current.onItemCompleted("ws-1", "parent-thread", item);
    });

    expect(applyCollabThreadLinks).toHaveBeenCalledWith(
      "parent-thread",
      item,
      "ws-1",
    );
  });

  it("handles item updates without incrementing agent segment repeatedly", () => {
    const { result, dispatch, markProcessing } = makeOptions();
    const item: ItemPayload = { type: "commandExecution", id: "cmd-1" };

    act(() => {
      result.current.onItemUpdated("ws-1", "thread-1", item);
    });

    expect(markProcessing).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
      engine: "codex",
    });
    expect(dispatch).not.toHaveBeenCalledWith({
      type: "incrementAgentSegment",
      threadId: "thread-1",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "upsertItem",
      workspaceId: "ws-1",
      threadId: "thread-1",
      item: convertedItem,
      hasCustomName: false,
    });
  });

  it("treats native generated image starts as a new tool boundary and upserts a processing card", () => {
    const generatedImageItem = {
      id: "generated-image-1",
      kind: "generatedImage",
      status: "processing",
      sourceToolName: "image_generation_call",
      promptText: "搬砖工人的卡通图",
      images: [],
    };
    vi.mocked(buildConversationItem).mockReturnValue(
      generatedImageItem as unknown as ReturnType<typeof buildConversationItem>,
    );
    const { result, dispatch, markProcessing } = makeOptions();

    act(() => {
      result.current.onItemStarted("ws-1", "thread-1", {
        type: "image_generation_call",
        id: "generated-image-1",
      });
    });

    expect(markProcessing).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith({
      type: "incrementAgentSegment",
      threadId: "thread-1",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "upsertItem",
      workspaceId: "ws-1",
      threadId: "thread-1",
      item: generatedImageItem,
      hasCustomName: false,
    });
  });

  it("does not stage generated image card from assistant text announcements", () => {
    const { result, dispatch } = makeOptions();

    act(() => {
      result.current.onAgentMessageDelta({
        workspaceId: "ws-1",
        threadId: "thread-1",
        itemId: "assistant-1",
        delta: "使用 `imagegen` skill，直接生成一张成年女性肖像。",
      });
    });

    const generatedImageCalls = dispatch.mock.calls.filter(
      ([action]) => action?.type === "upsertItem" && action.item?.kind === "generatedImage",
    );
    expect(generatedImageCalls).toHaveLength(0);
  });

  it("does not stage generated image card from completed assistant commentary", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(2468);
    const { result, dispatch } = makeOptions();

    act(() => {
      result.current.onAgentMessageCompleted({
        workspaceId: "ws-1",
        threadId: "thread-1",
        itemId: "assistant-2",
        text: "使用 imagegen skill，按你的约束重生成为完整头部出镜的东亚成年舞者形象。",
      });
    });

    const generatedImageCalls = dispatch.mock.calls.filter(
      ([action]) => action?.type === "upsertItem" && action.item?.kind === "generatedImage",
    );
    expect(generatedImageCalls).toHaveLength(0);

    nowSpy.mockRestore();
  });

  it("does not stage generated image placeholder for assistant engineering discussion", () => {
    const { result, dispatch } = makeOptions();

    act(() => {
      result.current.onAgentMessageDelta({
        workspaceId: "ws-1",
        threadId: "thread-1",
        itemId: "assistant-debug-1",
        delta:
          "我看到了，问题是 user intent placeholder 和 assistant imagegen skill 触发路径重复，需要在 reducer 层去重。",
      });
    });

    const placeholderCalls = dispatch.mock.calls.filter(
      ([action]) =>
        action?.type === "upsertItem" &&
        action.item?.kind === "generatedImage",
    );
    expect(placeholderCalls).toHaveLength(0);
  });

  it("does not restage text-derived image cards around real generated image events", () => {
    vi.mocked(buildConversationItem).mockReturnValue({
      id: "generated-image-1",
      kind: "generatedImage",
      status: "completed",
      sourceToolName: "image_generation_end",
      promptText: "直接生成一张成年女性肖像。",
      images: [{ src: "data:image/png;base64,AAA" }],
    } as unknown as ReturnType<typeof buildConversationItem>);
    const { result, dispatch } = makeOptions();

    act(() => {
      result.current.onAgentMessageDelta({
        workspaceId: "ws-1",
        threadId: "thread-1",
        itemId: "assistant-1",
        delta: "使用 `imagegen` skill，直接生成一张成年女性肖像。",
      });
    });
    expect(
      dispatch.mock.calls.filter(
        ([action]) =>
          action?.type === "upsertItem" &&
          action.item?.kind === "generatedImage",
      ),
    ).toHaveLength(0);

    dispatch.mockClear();

    act(() => {
      result.current.onItemCompleted("ws-1", "thread-1", {
        type: "image_generation_end",
        id: "generated-image-1",
      });
      result.current.onAgentMessageDelta({
        workspaceId: "ws-1",
        threadId: "thread-1",
        itemId: "assistant-1",
        delta: "使用 `imagegen` skill，直接生成一张成年女性肖像。",
      });
    });

    const generatedImageCalls = dispatch.mock.calls.filter(
      ([action]) =>
        action?.type === "upsertItem" &&
        action.item?.kind === "generatedImage",
    );
    expect(generatedImageCalls).toHaveLength(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: "upsertItem",
      workspaceId: "ws-1",
      threadId: "thread-1",
      item: {
        id: "generated-image-1",
        kind: "generatedImage",
        status: "completed",
        sourceToolName: "image_generation_end",
        promptText: "直接生成一张成年女性肖像。",
        images: [{ src: "data:image/png;base64,AAA" }],
      },
      hasCustomName: false,
    });
  });

  it("applies normalized codex realtime events through the assembler action without text-derived image cards", () => {
    const { result, dispatch, markProcessing, safeMessageActivity } = makeOptions();

    act(() => {
      result.current.onNormalizedRealtimeEvent({
        engine: "codex",
        workspaceId: "ws-1",
        threadId: "thread-1",
        eventId: "evt-1",
        itemKind: "message",
        timestampMs: 1,
        operation: "appendAgentMessageDelta",
        sourceMethod: "item/agentMessage/delta",
        delta: "使用 imagegen skill，直接生成一张成年女性肖像。",
        item: {
          id: "assistant-assembler-1",
          kind: "message",
          role: "assistant",
          text: "使用 imagegen skill，直接生成一张成年女性肖像。",
        },
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
      engine: "codex",
    });
    expect(markProcessing).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith({
      type: "applyNormalizedRealtimeEvent",
      workspaceId: "ws-1",
      threadId: "thread-1",
      event: expect.objectContaining({
        operation: "appendAgentMessageDelta",
        item: expect.objectContaining({
          id: "assistant-assembler-1",
          kind: "message",
          role: "assistant",
        }),
      }),
      hasCustomName: false,
    });
    const generatedImageCalls = dispatch.mock.calls.filter(
      ([action]) => action?.type === "upsertItem" && action.item?.kind === "generatedImage",
    );
    expect(generatedImageCalls).toHaveLength(0);
    expect(safeMessageActivity).toHaveBeenCalled();
  });

  it("dispatches cadence-flushed live assistant deltas without transition lag", () => {
    vi.useFakeTimers();
    window.localStorage.setItem("doge.perf.realtimeBatching", "1");
    const queuedTransitions: Array<() => void> = [];
    const { result, dispatch, markProcessing, safeMessageActivity } = makeOptions({
      scheduleRealtimeDispatch: (callback) => {
        queuedTransitions.push(callback);
      },
    });

    act(() => {
      result.current.onNormalizedRealtimeEvent({
        engine: "codex",
        workspaceId: "ws-1",
        threadId: "thread-1",
        turnId: "turn-1",
        eventId: "evt-live-1",
        itemKind: "message",
        timestampMs: 1,
        operation: "appendAgentMessageDelta",
        sourceMethod: "item/agentMessage/delta",
        delta: "第一段",
        item: {
          id: "assistant-live-1",
          kind: "message",
          role: "assistant",
          text: "第一段",
        },
      });
      result.current.onNormalizedRealtimeEvent({
        engine: "codex",
        workspaceId: "ws-1",
        threadId: "thread-1",
        turnId: "turn-1",
        eventId: "evt-live-2",
        itemKind: "message",
        timestampMs: 2,
        operation: "appendAgentMessageDelta",
        sourceMethod: "item/agentMessage/delta",
        delta: "第二段",
        item: {
          id: "assistant-live-1",
          kind: "message",
          role: "assistant",
          text: "第二段",
        },
      });
    });

    expect(queuedTransitions).toHaveLength(0);
    expect(dispatch).toHaveBeenCalledWith({
      type: "applyNormalizedRealtimeEvent",
      workspaceId: "ws-1",
      threadId: "thread-1",
      event: expect.objectContaining({
        eventId: "evt-live-1",
        operation: "appendAgentMessageDelta",
      }),
      hasCustomName: false,
    });

    act(() => {
      vi.advanceTimersByTime(40);
    });

    expect(queuedTransitions).toHaveLength(0);
    expect(dispatch).toHaveBeenCalledWith({
      type: "applyNormalizedRealtimeEvent",
      workspaceId: "ws-1",
      threadId: "thread-1",
      event: expect.objectContaining({
        eventId: "evt-live-2",
        operation: "appendAgentMessageDelta",
      }),
      hasCustomName: false,
    });
    expect(markProcessing).not.toHaveBeenCalled();
    expect(safeMessageActivity).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("batches codex assistant snapshots and flushes only the latest realtime frame", () => {
    vi.useFakeTimers();
    window.localStorage.setItem("doge.perf.realtimeBatching", "1");
    const { result, dispatch, markProcessing, safeMessageActivity } = makeOptions();

    act(() => {
      result.current.onNormalizedRealtimeEvent({
        engine: "codex",
        workspaceId: "ws-1",
        threadId: "thread-1",
        eventId: "evt-1",
        itemKind: "message",
        timestampMs: 1,
        operation: "itemUpdated",
        sourceMethod: "item/updated",
        item: {
          id: "assistant-1",
          kind: "message",
          role: "assistant",
          text: "第一段",
        },
      });
      result.current.onNormalizedRealtimeEvent({
        engine: "codex",
        workspaceId: "ws-1",
        threadId: "thread-1",
        eventId: "evt-2",
        itemKind: "message",
        timestampMs: 2,
        operation: "itemUpdated",
        sourceMethod: "item/updated",
        item: {
          id: "assistant-1",
          kind: "message",
          role: "assistant",
          text: "第一段\n第二段",
        },
      });
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(markProcessing).not.toHaveBeenCalled();
    expect(safeMessageActivity).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(40);
    });

    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
      engine: "codex",
    });
    expect(markProcessing).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: "applyNormalizedRealtimeEvent",
      workspaceId: "ws-1",
      threadId: "thread-1",
      event: expect.objectContaining({
        operation: "itemUpdated",
        item: expect.objectContaining({
          id: "assistant-1",
          kind: "message",
          role: "assistant",
          text: "第一段\n第二段",
        }),
      }),
      hasCustomName: false,
    });
    expect(safeMessageActivity).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("batches gemini normalized assistant snapshots by item identity", () => {
    vi.useFakeTimers();
    window.localStorage.setItem("doge.perf.realtimeBatching", "1");
    const { result, dispatch, markProcessing, safeMessageActivity } = makeOptions();

    act(() => {
      result.current.onNormalizedRealtimeEvent({
        engine: "gemini",
        workspaceId: "ws-1",
        threadId: "gemini:session-1",
        eventId: "evt-1",
        itemKind: "message",
        timestampMs: 1,
        operation: "itemUpdated",
        sourceMethod: "item/updated",
        item: {
          id: "assistant-1",
          kind: "message",
          role: "assistant",
          text: "第一段",
          engineSource: "gemini",
        },
      });
      result.current.onNormalizedRealtimeEvent({
        engine: "gemini",
        workspaceId: "ws-1",
        threadId: "gemini:session-1",
        eventId: "evt-2",
        itemKind: "message",
        timestampMs: 2,
        operation: "itemUpdated",
        sourceMethod: "item/updated",
        item: {
          id: "assistant-1",
          kind: "message",
          role: "assistant",
          text: "第一段\n第二段",
          engineSource: "gemini",
        },
      });
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(markProcessing).not.toHaveBeenCalled();
    expect(safeMessageActivity).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(40);
    });

    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "gemini:session-1",
      engine: "gemini",
    });
    expect(markProcessing).toHaveBeenCalledTimes(1);
    expect(markProcessing).toHaveBeenCalledWith("gemini:session-1", true);
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: "applyNormalizedRealtimeEvent",
      workspaceId: "ws-1",
      threadId: "gemini:session-1",
      event: expect.objectContaining({
        operation: "itemUpdated",
        item: expect.objectContaining({
          id: "assistant-1",
          kind: "message",
          role: "assistant",
          text: "第一段\n第二段",
        }),
      }),
      hasCustomName: false,
    });
    expect(safeMessageActivity).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("flushes pending codex assistant snapshots before final completed payloads", () => {
    vi.useFakeTimers();
    window.localStorage.setItem("doge.perf.realtimeBatching", "1");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(4567);
    const externalCallback = vi.fn();
    const { result, dispatch, safeMessageActivity } = makeOptions({
      activeThreadId: "thread-1",
      onAgentMessageCompletedExternal: externalCallback,
    });

    act(() => {
      result.current.onNormalizedRealtimeEvent({
        engine: "codex",
        workspaceId: "ws-1",
        threadId: "thread-1",
        eventId: "evt-1",
        itemKind: "message",
        timestampMs: 1,
        operation: "itemUpdated",
        sourceMethod: "item/updated",
        item: {
          id: "assistant-1",
          kind: "message",
          role: "assistant",
          text: "前半段",
        },
      });
      result.current.onNormalizedRealtimeEvent({
        engine: "codex",
        workspaceId: "ws-1",
        threadId: "thread-1",
        eventId: "evt-2",
        itemKind: "message",
        timestampMs: 2,
        operation: "completeAgentMessage",
        sourceMethod: "item/completed",
        item: {
          id: "assistant-1",
          kind: "message",
          role: "assistant",
          text: "前半段\n后半段",
        },
      });
    });

    const normalizedDispatches = dispatch.mock.calls
      .map(([action]) => action)
      .filter((action) => action?.type === "applyNormalizedRealtimeEvent");
    expect(normalizedDispatches).toHaveLength(2);
    expect(normalizedDispatches[0]).toEqual({
      type: "applyNormalizedRealtimeEvent",
      workspaceId: "ws-1",
      threadId: "thread-1",
      event: expect.objectContaining({
        operation: "itemUpdated",
        item: expect.objectContaining({ text: "前半段" }),
      }),
      hasCustomName: false,
    });
    expect(normalizedDispatches[1]).toEqual({
      type: "applyNormalizedRealtimeEvent",
      workspaceId: "ws-1",
      threadId: "thread-1",
      event: expect.objectContaining({
        operation: "completeAgentMessage",
        item: expect.objectContaining({ text: "前半段\n后半段" }),
      }),
      hasCustomName: false,
    });
    expect(externalCallback).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "assistant-1",
      text: "前半段\n后半段",
    });
    expect(safeMessageActivity).toHaveBeenCalledTimes(2);

    nowSpy.mockRestore();
    vi.useRealTimers();
  });

  it("routes agentMessage snapshots into assistant streaming delta updates", () => {
    const { result, dispatch, markProcessing, safeMessageActivity } = makeOptions();
    writeClientStoreValue("threads", "liveAssistantShadowTranscripts", {});

    act(() => {
      result.current.onItemUpdated("ws-1", "claude:session-1", {
        type: "agentMessage",
        id: "assistant-1",
        text: "正在输出正文",
      });
    });

    expect(markProcessing).toHaveBeenCalledWith("claude:session-1", true);
    expect(dispatch).toHaveBeenCalledWith({
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      itemId: "assistant-1",
      delta: "正在输出正文",
      hasCustomName: false,
    });
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "upsertItem",
        workspaceId: "ws-1",
        threadId: "claude:session-1",
      }),
    );
    expect(safeMessageActivity).toHaveBeenCalled();
    flushLiveAssistantShadowTranscriptsNow();
    const shadowStore = getClientStoreSync<Record<string, { text?: string }>>(
      "threads",
      "liveAssistantShadowTranscripts",
    );
    expect(Object.values(shadowStore ?? {})[0]?.text).toBe("正在输出正文");
  });

  it("stores growing Claude agentMessage snapshots without duplicating shadow text", () => {
    const { result } = makeOptions();
    writeClientStoreValue("threads", "liveAssistantShadowTranscripts", {});

    act(() => {
      result.current.onItemUpdated("ws-1", "claude:session-1", {
        type: "agentMessage",
        id: "assistant-1",
        text: "第一段",
      });
      result.current.onItemUpdated("ws-1", "claude:session-1", {
        type: "agentMessage",
        id: "assistant-1",
        text: "第一段\n\n第二段",
      });
    });

    const id = buildLiveAssistantShadowTranscriptId({
      engine: "claude",
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      itemId: "assistant-1",
    });
    flushLiveAssistantShadowTranscriptsNow();
    const shadowStore = getClientStoreSync<Record<string, { text?: string }>>(
      "threads",
      "liveAssistantShadowTranscripts",
    );
    expect(shadowStore?.[id]?.text).toBe("第一段\n\n第二段");
  });

  it("marks review/processing false when review mode exits", () => {
    const { result, dispatch, markProcessing, markReviewing, safeMessageActivity } = makeOptions();
    const item: ItemPayload = { type: "exitedReviewMode", id: "review-1" };

    act(() => {
      result.current.onItemCompleted("ws-1", "thread-1", item);
    });

    expect(markReviewing).toHaveBeenCalledWith("thread-1", false);
    expect(markProcessing).toHaveBeenCalledWith("thread-1", false);
    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
      engine: "codex",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "upsertItem",
      workspaceId: "ws-1",
      threadId: "thread-1",
      item: convertedItem,
      hasCustomName: false,
    });
    expect(safeMessageActivity).toHaveBeenCalled();
  });

  it("emits a handoff callback when Claude completes an ExitPlanMode tool", () => {
    const onExitPlanModeToolCompleted = vi.fn();
    vi.mocked(buildConversationItem).mockReturnValue({
      id: "exit-plan-1",
      kind: "tool",
      toolType: "toolCall",
      title: "Claude / exitplanmode",
      detail: "PLAN\n# Plan",
      status: "completed",
    });
    const { result } = makeOptions({ onExitPlanModeToolCompleted });

    act(() => {
      result.current.onItemCompleted("ws-1", "claude:session-1", {
        type: "toolCall",
        id: "exit-plan-1",
      });
    });

    expect(onExitPlanModeToolCompleted).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      itemId: "exit-plan-1",
    });
  });

  it("marks processing and appends agent deltas", () => {
    const { result, dispatch, markProcessing, safeMessageActivity } = makeOptions();

    act(() => {
      result.current.onAgentMessageDelta({
        workspaceId: "ws-1",
        threadId: "thread-1",
        itemId: "assistant-1",
        delta: "Hello",
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
      engine: "codex",
    });
    expect(markProcessing).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith({
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "assistant-1",
      delta: "Hello",
      hasCustomName: false,
    });
    expect(safeMessageActivity).toHaveBeenCalled();
  });

  it("drops batched agent deltas after the turn is marked terminal", () => {
    vi.useFakeTimers();
    window.localStorage.setItem("doge.perf.realtimeBatching", "1");
    const { result, dispatch, markProcessing, safeMessageActivity } = makeOptions();

    act(() => {
      result.current.noteRealtimeTurnStarted("thread-1", "turn-1");
      result.current.onAgentMessageDelta({
        workspaceId: "ws-1",
        threadId: "thread-1",
        itemId: "assistant-1",
        delta: "late text",
        turnId: "turn-1",
      });
      result.current.markRealtimeTurnTerminal("thread-1", "turn-1");
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(markProcessing).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(40);
    });

    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "appendAgentDelta" }),
    );
    expect(markProcessing).not.toHaveBeenCalled();
    expect(safeMessageActivity).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("preserves the terminal ledger across ordinary hook rerenders", () => {
    const { result, rerender } = makeOptions({
      activeThreadId: "shared:thread-1",
    });

    act(() => {
      result.current.noteRealtimeTurnStarted(
        "shared:thread-1",
        "runtime-turn-1",
      );
      result.current.markRealtimeTurnTerminal(
        "shared:thread-1",
        "runtime-turn-1",
      );
    });

    rerender({ activeThreadId: "shared:thread-2" });

    expect(
      result.current.isRealtimeTurnTerminalExact(
        "shared:thread-1",
        "runtime-turn-1",
      ),
    ).toBe(true);
  });

  it("drops queued transitioned normalized events after the turn is marked terminal", () => {
    const queuedTransitions: Array<() => void> = [];
    const { result, dispatch, markProcessing, safeMessageActivity } = makeOptions({
      scheduleRealtimeDispatch: (callback) => {
        queuedTransitions.push(callback);
      },
    });

    act(() => {
      result.current.noteRealtimeTurnStarted("thread-1", "turn-1");
      result.current.onNormalizedRealtimeEvent({
        engine: "codex",
        workspaceId: "ws-1",
        threadId: "thread-1",
        turnId: "turn-1",
        eventId: "evt-queued-1",
        itemKind: "reasoning",
        timestampMs: 1,
        operation: "appendReasoningSummaryBoundary",
        sourceMethod: "item/reasoning/summary/boundary",
        delta: null,
        item: {
          id: "reasoning-queued-1",
          kind: "reasoning",
          summary: "queued summary",
          content: "",
        },
      });
      result.current.markRealtimeTurnTerminal("thread-1", "turn-1");
    });

    expect(queuedTransitions).toHaveLength(1);
    expect(dispatch).not.toHaveBeenCalled();
    expect(markProcessing).not.toHaveBeenCalled();
    expect(safeMessageActivity).toHaveBeenCalledTimes(1);

    markProcessing.mockClear();

    act(() => {
      queuedTransitions.forEach((callback) => callback());
    });

    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "applyNormalizedRealtimeEvent" }),
    );
    expect(markProcessing).not.toHaveBeenCalled();
  });

  it("keeps processing marks outside transitioned normalized dispatches", () => {
    const queuedTransitions: Array<() => void> = [];
    const { result, dispatch, markProcessing } = makeOptions({
      scheduleRealtimeDispatch: (callback) => {
        queuedTransitions.push(callback);
      },
    });

    act(() => {
      result.current.noteRealtimeTurnStarted("thread-1", "turn-1");
      result.current.onNormalizedRealtimeEvent({
        engine: "codex",
        workspaceId: "ws-1",
        threadId: "thread-1",
        turnId: "turn-1",
        eventId: "evt-transition-1",
        itemKind: "reasoning",
        timestampMs: 1,
        operation: "appendReasoningSummaryBoundary",
        sourceMethod: "item/reasoning/summary/boundary",
        delta: null,
        item: {
          id: "reasoning-transition-1",
          kind: "reasoning",
          summary: "transition summary",
          content: "",
        },
      });
    });

    expect(queuedTransitions).toHaveLength(1);
    expect(markProcessing).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "applyNormalizedRealtimeEvent" }),
    );

    markProcessing.mockClear();

    act(() => {
      queuedTransitions.forEach((callback) => callback());
    });

    expect(markProcessing).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith({
      type: "applyNormalizedRealtimeEvent",
      workspaceId: "ws-1",
      threadId: "thread-1",
      event: expect.objectContaining({
        operation: "appendReasoningSummaryBoundary",
        turnId: "turn-1",
      }),
      hasCustomName: false,
    });
  });

  it("completes agent messages and updates thread activity", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1234);
    const { result, dispatch, recordThreadActivity, safeMessageActivity } = makeOptions({
      activeThreadId: "thread-2",
    });

    act(() => {
      result.current.onAgentMessageCompleted({
        workspaceId: "ws-1",
        threadId: "thread-1",
        itemId: "assistant-1",
        text: "Done",
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
      engine: "codex",
    });
    // §6.2: 4 个顺序 dispatch 合并为 1 个 flushAgentCompletedBatch
    expect(dispatch).toHaveBeenCalledWith({
      type: "flushAgentCompletedBatch",
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "assistant-1",
      text: "Done",
      hasCustomName: false,
      timestamp: 1234,
      isActiveThread: false,
    });
    expect(recordThreadActivity).toHaveBeenCalledWith("ws-1", "thread-1", 1234);
    expect(safeMessageActivity).toHaveBeenCalled();

    nowSpy.mockRestore();
  });

  it("drops late raw agent snapshots after the turn is marked terminal", () => {
    const { result, dispatch, markProcessing } = makeOptions();

    act(() => {
      result.current.noteRealtimeTurnStarted("thread-1", "turn-1");
      result.current.onAgentMessageCompleted({
        workspaceId: "ws-1",
        threadId: "thread-1",
        itemId: "assistant-1",
        text: "final answer",
        turnId: "turn-1",
      });
      result.current.markRealtimeTurnTerminal("thread-1", "turn-1");
    });

    dispatch.mockClear();
    markProcessing.mockClear();

    act(() => {
      result.current.onItemUpdated("ws-1", "thread-1", {
        type: "agentMessage",
        id: "assistant-1",
        text: "late snapshot",
        turnId: "turn-1",
      });
    });

    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "appendAgentDelta" }),
    );
    expect(markProcessing).not.toHaveBeenCalled();
  });

  it("dispatches reasoning summary boundaries through the active processing path", () => {
    const { result, dispatch, markProcessing, safeMessageActivity } = makeOptions();

    act(() => {
      result.current.onReasoningSummaryBoundary("ws-1", "claude:session-1", "reasoning-1");
    });

    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      engine: "claude",
    });
    expect(markProcessing).toHaveBeenCalledWith("claude:session-1", true);
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: "appendReasoningSummaryBoundary",
      threadId: "claude:session-1",
      itemId: "reasoning-1",
    });
    expect(safeMessageActivity).toHaveBeenCalled();
  });

  it("dispatches reasoning text deltas through the active processing path", () => {
    const { result, dispatch, markProcessing, safeMessageActivity } = makeOptions();

    act(() => {
      result.current.onReasoningTextDelta(
        "ws-1",
        "claude:session-1",
        "reasoning-1",
        "先检查控制器",
      );
    });

    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      engine: "claude",
    });
    expect(markProcessing).toHaveBeenCalledWith("claude:session-1", true);
    expect(dispatch).toHaveBeenCalledWith({
      type: "appendReasoningContent",
      threadId: "claude:session-1",
      itemId: "reasoning-1",
      delta: "先检查控制器",
    });
    expect(safeMessageActivity).toHaveBeenCalled();
  });

  it("does not re-enable processing for gemini reasoning deltas", () => {
    const { result, dispatch, markProcessing, safeMessageActivity } = makeOptions();

    act(() => {
      result.current.onReasoningTextDelta(
        "ws-1",
        "gemini:session-1",
        "reasoning-1",
        "先确认目录，再组织回答。",
      );
    });

    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "gemini:session-1",
      engine: "gemini",
    });
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: "appendReasoningContent",
      threadId: "gemini:session-1",
      itemId: "reasoning-1",
      delta: "先确认目录，再组织回答。",
    });
    expect(markProcessing).not.toHaveBeenCalled();
    expect(safeMessageActivity).toHaveBeenCalled();
  });

  it("skips reasoning deltas for interrupted threads", () => {
    const { result, dispatch, markProcessing, safeMessageActivity, interruptedThreadsRef } =
      makeOptions();
    workspaceScopedSet(interruptedThreadsRef.current, "ws-1", "claude:session-1", true);

    act(() => {
      result.current.onReasoningSummaryDelta(
        "ws-1",
        "claude:session-1",
        "reasoning-1",
        "晚到的思考",
      );
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(markProcessing).not.toHaveBeenCalled();
    expect(safeMessageActivity).not.toHaveBeenCalled();
  });

  it("submits command output deltas through the tool output tail gate", () => {
    const { result } = makeOptions();

    act(() => {
      result.current.onCommandOutputDelta(
        "ws-1",
        "claude:session-1",
        "cmd-1",
        "partial output",
      );
    });

    // §5.2: 现在走 toolOutputTailGate,dispatch 不再同步发生,
    // 由 tail gate 在 32ms 窗口内合并后回调 enqueueRealtimeDeltaOperation。
    // 验证语义 (appendToolOutput 仍会按尾部 flush 进入 reducer) 由
    // useToolOutputTailGate.test.ts 覆盖。
    expect(
      (globalThis as { __lastTailGateKey?: string }).__lastTailGateKey,
    ).toBeUndefined();
  });

  it("skips agent message deltas for interrupted threads", () => {
    const { result, dispatch, markProcessing, interruptedThreadsRef } = makeOptions();
    workspaceScopedSet(interruptedThreadsRef.current, "ws-1", "thread-1", true);

    act(() => {
      result.current.onAgentMessageDelta({
        workspaceId: "ws-1",
        threadId: "thread-1",
        itemId: "assistant-1",
        delta: "late arriving text",
      });
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(markProcessing).not.toHaveBeenCalled();
  });

  it("skips gemini item snapshots for interrupted threads", () => {
    const { result, dispatch, markProcessing, interruptedThreadsRef, safeMessageActivity } =
      makeOptions();
    workspaceScopedSet(interruptedThreadsRef.current, "ws-1", "gemini:session-1", true);

    act(() => {
      result.current.onItemStarted("ws-1", "gemini:session-1", {
        type: "commandExecution",
        id: "tool-1",
      });
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(markProcessing).not.toHaveBeenCalled();
    expect(safeMessageActivity).not.toHaveBeenCalled();
  });

  it("skips claude item snapshots for interrupted threads", () => {
    const { result, dispatch, markProcessing, interruptedThreadsRef, safeMessageActivity } =
      makeOptions();
    workspaceScopedSet(interruptedThreadsRef.current, "ws-1", "claude:session-1", true);

    act(() => {
      result.current.onItemUpdated("ws-1", "claude:session-1", {
        type: "agentMessage",
        id: "assistant-1",
        text: "late arriving snapshot",
      });
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(markProcessing).not.toHaveBeenCalled();
    expect(safeMessageActivity).not.toHaveBeenCalled();
  });

  it("skips gemini completed agent snapshots for interrupted threads", () => {
    const {
      result,
      dispatch,
      interruptedThreadsRef,
      onAgentMessageCompletedExternal,
    } = makeOptions({
      onAgentMessageCompletedExternal: vi.fn(),
    });
    workspaceScopedSet(interruptedThreadsRef.current, "ws-1", "gemini:session-1", true);

    act(() => {
      result.current.onAgentMessageCompleted({
        workspaceId: "ws-1",
        threadId: "gemini:session-1",
        itemId: "assistant-1",
        text: "late arriving text",
      });
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(onAgentMessageCompletedExternal).not.toHaveBeenCalled();
  });

  it("skips claude completed agent snapshots for interrupted threads", () => {
    const {
      result,
      dispatch,
      interruptedThreadsRef,
      onAgentMessageCompletedExternal,
    } = makeOptions({
      onAgentMessageCompletedExternal: vi.fn(),
    });
    workspaceScopedSet(interruptedThreadsRef.current, "ws-1", "claude:session-1", true);

    act(() => {
      result.current.onAgentMessageCompleted({
        workspaceId: "ws-1",
        threadId: "claude:session-1",
        itemId: "assistant-1",
        text: "late arriving text",
      });
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(onAgentMessageCompletedExternal).not.toHaveBeenCalled();
  });

  it("batches gemini agent deltas in the realtime flush window", () => {
    vi.useFakeTimers();
    window.localStorage.setItem("doge.perf.realtimeBatching", "1");
    const { result, dispatch, markProcessing, safeMessageActivity } = makeOptions();

    act(() => {
      result.current.onAgentMessageDelta({
        workspaceId: "ws-1",
        threadId: "gemini:session-1",
        itemId: "assistant-1",
        delta: "第一段",
      });
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(markProcessing).not.toHaveBeenCalled();
    expect(safeMessageActivity).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(40);
    });

    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "gemini:session-1",
      engine: "gemini",
    });
    expect(markProcessing).toHaveBeenCalledWith("gemini:session-1", true);
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "gemini:session-1",
      itemId: "assistant-1",
      delta: "第一段",
      hasCustomName: false,
    });
    expect(safeMessageActivity).toHaveBeenCalledTimes(1);

    expect(dispatch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("routes a buffered Kimi pending delta through the canonical alias after rename", () => {
    vi.useFakeTimers();
    window.localStorage.setItem("doge.perf.realtimeBatching", "1");
    let canonicalThreadId = "kimi-pending-1";
    const { result, dispatch, markProcessing } = makeOptions({
      resolveCanonicalThreadId: () => canonicalThreadId,
    });

    act(() => {
      result.current.onAgentMessageDelta({
        workspaceId: "ws-1",
        threadId: "kimi-pending-1",
        itemId: "assistant-1",
        delta: "你好",
      });
      canonicalThreadId = "kimi:session-real-1";
      vi.advanceTimersByTime(40);
    });

    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "kimi:session-real-1",
      engine: "kimi",
    });
    expect(markProcessing).toHaveBeenCalledWith("kimi:session-real-1", true);
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "kimi:session-real-1",
      itemId: "assistant-1",
      delta: "你好",
      hasCustomName: false,
    });

    vi.useRealTimers();
  });

  it("dispatches gemini agent deltas immediately when realtime batching is disabled", () => {
    vi.useFakeTimers();
    window.localStorage.setItem("doge.perf.realtimeBatching", "0");
    const { result, dispatch, markProcessing, safeMessageActivity } = makeOptions();

    act(() => {
      result.current.onAgentMessageDelta({
        workspaceId: "ws-1",
        threadId: "gemini:session-1",
        itemId: "assistant-1",
        delta: "第一段",
      });
    });

    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "gemini:session-1",
      engine: "gemini",
    });
    expect(markProcessing).toHaveBeenCalledWith("gemini:session-1", true);
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "gemini:session-1",
      itemId: "assistant-1",
      delta: "第一段",
      hasCustomName: false,
    });
    expect(safeMessageActivity).toHaveBeenCalledTimes(1);

    vi.runOnlyPendingTimers();
    expect(dispatch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("calls onAgentMessageCompletedExternal with correct payload", () => {
    const externalCallback = vi.fn();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(5678);
    const { result } = makeOptions({
      onAgentMessageCompletedExternal: externalCallback,
    });

    act(() => {
      result.current.onAgentMessageCompleted({
        workspaceId: "ws-1",
        threadId: "thread-1",
        itemId: "assistant-1",
        text: "Result text",
      });
    });

    expect(externalCallback).toHaveBeenCalledTimes(1);
    expect(externalCallback).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "assistant-1",
      text: "Result text",
    });

    nowSpy.mockRestore();
  });

  it("settles Claude shadow transcript with provider-final flag on completion", () => {
    const { result } = makeOptions();
    writeClientStoreValue("threads", "liveAssistantShadowTranscripts", {});

    act(() => {
      result.current.onAgentMessageCompleted({
        workspaceId: "ws-1",
        threadId: "claude:session-1",
        itemId: "assistant-1",
        turnId: "turn-1",
        text: "结果输出",
      });
    });

    const id = buildLiveAssistantShadowTranscriptId({
      engine: "claude",
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      turnId: "turn-1",
      itemId: "assistant-1",
    });
    const store = getClientStoreSync<Record<string, { providerFinalObserved?: boolean }>>(
      "threads",
      "liveAssistantShadowTranscripts",
    );
    expect(store?.[id]?.providerFinalObserved).toBe(true);
  });

  it("does not throw when onAgentMessageCompletedExternal is not provided", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(9999);
    const { result } = makeOptions();

    expect(() => {
      act(() => {
        result.current.onAgentMessageCompleted({
          workspaceId: "ws-1",
          threadId: "thread-1",
          itemId: "assistant-1",
          text: "Safe call",
        });
      });
    }).not.toThrow();

    nowSpy.mockRestore();
  });

  it("enriches codex user messages with thread-level collaboration mode when missing", () => {
    vi.mocked(buildConversationItem).mockReturnValue({
      id: "user-1",
      kind: "message",
      role: "user",
      text: "请先计划",
      collaborationMode: null,
    });
    const { result, dispatch } = makeOptions({
      resolveCollaborationUiMode: () => "plan",
    });
    const item: ItemPayload = {
      type: "userMessage",
      id: "user-1",
    };

    act(() => {
      result.current.onItemStarted("ws-1", "thread-1", item);
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "upsertItem",
      workspaceId: "ws-1",
      threadId: "thread-1",
      item: {
        id: "user-1",
        kind: "message",
        role: "user",
        text: "请先计划",
        collaborationMode: "plan",
      },
      hasCustomName: false,
    });
  });

  it("accepts claude reasoning snapshot upsert so live state can converge to history", () => {
    vi.mocked(buildConversationItem).mockReturnValue({
      id: "reasoning-1",
      kind: "reasoning",
      summary: "思考",
      content: "思考内容",
    });
    const { result, dispatch, safeMessageActivity } = makeOptions();

    act(() => {
      result.current.onItemUpdated("ws-1", "claude:session-1", {
        type: "reasoning",
        id: "reasoning-1",
        text: "思考内容",
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      engine: "claude",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "upsertItem",
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      item: {
        id: "reasoning-1",
        kind: "reasoning",
        summary: "思考",
        content: "思考内容",
      },
      hasCustomName: false,
    });
    expect(safeMessageActivity).toHaveBeenCalled();
  });

  it("batches realtime deltas in one flush window while preserving operation order", () => {
    vi.useFakeTimers();
    window.localStorage.setItem("doge.perf.realtimeBatching", "1");
    const { result, dispatch, markProcessing, safeMessageActivity } = makeOptions();

    act(() => {
      result.current.onAgentMessageDelta({
        workspaceId: "ws-1",
        threadId: "claude:session-1",
        itemId: "assistant-1",
        delta: "A",
      });
      result.current.onReasoningTextDelta(
        "ws-1",
        "claude:session-1",
        "reasoning-1",
        "B",
      );
      result.current.onAgentMessageDelta({
        workspaceId: "ws-1",
        threadId: "claude:session-1",
        itemId: "assistant-1",
        delta: "C",
      });
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(markProcessing).not.toHaveBeenCalled();
    expect(safeMessageActivity).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(40);
    });

    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      engine: "claude",
    });
    expect(markProcessing).toHaveBeenCalledTimes(1);
    expect(markProcessing).toHaveBeenCalledWith("claude:session-1", true);
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      itemId: "assistant-1",
      delta: "A",
      hasCustomName: false,
    });
    expect(dispatch).toHaveBeenNthCalledWith(3, {
      type: "appendReasoningContent",
      threadId: "claude:session-1",
      itemId: "reasoning-1",
      delta: "B",
    });
    expect(dispatch).toHaveBeenNthCalledWith(4, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      itemId: "assistant-1",
      delta: "C",
      hasCustomName: false,
    });
    expect(safeMessageActivity).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("flushes buffered realtime deltas on unmount so the last batch is not dropped", () => {
    vi.useFakeTimers();
    window.localStorage.setItem("doge.perf.realtimeBatching", "1");
    const { result, dispatch, markProcessing, safeMessageActivity, unmount } = makeOptions();

    act(() => {
      result.current.onAgentMessageDelta({
        workspaceId: "ws-1",
        threadId: "claude:session-1",
        itemId: "assistant-1",
        delta: "closing text",
      });
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(markProcessing).not.toHaveBeenCalled();
    expect(safeMessageActivity).not.toHaveBeenCalled();

    act(() => {
      unmount();
    });

    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      engine: "claude",
    });
    expect(markProcessing).toHaveBeenCalledWith("claude:session-1", true);
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      itemId: "assistant-1",
      delta: "closing text",
      hasCustomName: false,
    });
    expect(safeMessageActivity).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});
