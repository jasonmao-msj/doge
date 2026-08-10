// @vitest-environment jsdom
//
// A4 live-text 外部化 + 分段交错的回归守卫。
//
// liveTextExternalization 开启后，一段正文里只有「建壳首 delta」会落进 reducer，
// 其余都停在 liveAssistantTextChannel。工具开始时前端会 incrementAgentSegment，
// 后续正文改落新的 assistant item——若不在分段前把通道尾段灌回，本段正文会被
// 下一段的首 delta 顶掉而永久丢失，界面表现为「整轮正文挤成一坨排在所有工具之前」。
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildConversationItem } from "../../../utils/threadItems";
import {
  getLiveAssistantTextSnapshot,
  LIVE_ASSISTANT_TEXT_PUBLISH_INTERVAL_MS,
  peekLiveAssistantText,
  resetLiveAssistantTextChannelForTests,
} from "../utils/liveAssistantTextChannel";
import { useThreadItemEvents } from "./useThreadItemEvents";

vi.mock("../../../utils/threadItems", () => ({
  buildConversationItem: vi.fn(),
}));

// 该 flag 的 testDefaultValue 为 false；本文件专门验证它开启后的行为。
// useThreadItemEvents 在模块加载时读取一次，故必须在 import 前用 mock 覆盖。
vi.mock("../utils/realtimePerfFlags", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../utils/realtimePerfFlags")
  >();
  return { ...actual, isLiveTextExternalizationEnabled: () => true };
});

const THREAD_ID = "claude:session-1";
const WORKSPACE_ID = "ws-1";
const ITEM_ID = "claude-item-1";

const makeHook = () => {
  const dispatch = vi.fn();
  const { result } = renderHook(() =>
    useThreadItemEvents({
      activeThreadId: THREAD_ID,
      dispatch,
      getCustomName: vi.fn(() => undefined),
      markProcessing: vi.fn(),
      markReviewing: vi.fn(),
      safeMessageActivity: vi.fn(),
      recordThreadActivity: vi.fn(),
      applyCollabThreadLinks: vi.fn(),
      interruptedThreadsRef: { current: new Map<string, Map<string, true>>() },
    }),
  );
  return { result, dispatch };
};

const agentDeltaCalls = (dispatch: ReturnType<typeof vi.fn>) =>
  dispatch.mock.calls
    .map(([action]) => action as Record<string, unknown>)
    .filter((action) => action.type === "appendAgentDelta");

const dispatchedTypes = (dispatch: ReturnType<typeof vi.fn>) =>
  dispatch.mock.calls.map(([action]) => (action as { type: string }).type);

describe("useThreadItemEvents live-text segmentation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.removeItem("doge.perf.realtimeBatching");
    resetLiveAssistantTextChannelForTests();
    vi.mocked(buildConversationItem).mockReturnValue({
      id: "tool-1",
      kind: "tool",
    } as unknown as ReturnType<typeof buildConversationItem>);
  });

  afterEach(() => {
    resetLiveAssistantTextChannelForTests();
    vi.useRealTimers();
  });

  it("drains the live-text tail into the current segment before a tool boundary", () => {
    const { result, dispatch } = makeHook();

    act(() => {
      // 首 delta 建壳 → 落 reducer。
      result.current.onAgentMessageDelta({
        workspaceId: WORKSPACE_ID,
        threadId: THREAD_ID,
        itemId: ITEM_ID,
        delta: "Let me check the mount point.",
      });
      // 后续 delta 只进通道，不落 reducer。
      result.current.onAgentMessageDelta({
        workspaceId: WORKSPACE_ID,
        threadId: THREAD_ID,
        itemId: ITEM_ID,
        delta: " Searching now.",
      });
    });

    expect(agentDeltaCalls(dispatch).map((action) => action.delta)).toEqual([
      "Let me check the mount point.",
    ]);

    act(() => {
      result.current.onItemStarted(WORKSPACE_ID, THREAD_ID, {
        type: "commandExecution",
        id: "tool-1",
      });
    });

    // 尾段被灌回同一个 itemId（reducer 会用「旧 segment」解析出本段的 item）。
    expect(agentDeltaCalls(dispatch)).toEqual([
      expect.objectContaining({ itemId: ITEM_ID, delta: "Let me check the mount point." }),
      expect.objectContaining({
        itemId: ITEM_ID,
        delta: " Searching now.",
        hasCustomName: true,
      }),
    ]);

    // 且灌回必须严格早于 incrementAgentSegment，否则会落到下一段的 item 上。
    const types = dispatchedTypes(dispatch);
    const drainIndex = types.lastIndexOf("appendAgentDelta");
    const incrementIndex = types.indexOf("incrementAgentSegment");
    expect(incrementIndex).toBeGreaterThan(-1);
    expect(drainIndex).toBeLessThan(incrementIndex);
  });

  it("starts a fresh shell for the text that follows the tool", () => {
    const { result, dispatch } = makeHook();

    act(() => {
      result.current.onAgentMessageDelta({
        workspaceId: WORKSPACE_ID,
        threadId: THREAD_ID,
        itemId: ITEM_ID,
        delta: "before tool",
      });
      result.current.onItemStarted(WORKSPACE_ID, THREAD_ID, {
        type: "commandExecution",
        id: "tool-1",
      });
      // 通道已在分段时清空 → 这条 delta 重新建壳（isFirst），落进新 segment 的 item。
      result.current.onAgentMessageDelta({
        workspaceId: WORKSPACE_ID,
        threadId: THREAD_ID,
        itemId: ITEM_ID,
        delta: "after tool",
      });
    });

    const deltas = agentDeltaCalls(dispatch).map((action) => action.delta);
    expect(deltas).toEqual(["before tool", "after tool"]);

    const types = dispatchedTypes(dispatch);
    expect(types.indexOf("incrementAgentSegment")).toBeLessThan(
      types.lastIndexOf("appendAgentDelta"),
    );
  });

  it("keeps growing agent snapshots in the row-local channel after the shell", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { result, dispatch } = makeHook();

    act(() => {
      result.current.onItemUpdated(WORKSPACE_ID, THREAD_ID, {
        type: "agentMessage",
        id: ITEM_ID,
        text: "第一段",
      });
      result.current.onItemUpdated(WORKSPACE_ID, THREAD_ID, {
        type: "agentMessage",
        id: ITEM_ID,
        text: "第一段\n第二段",
      });
    });

    expect(agentDeltaCalls(dispatch).map((action) => action.delta)).toEqual([
      "第一段",
    ]);
    expect(getLiveAssistantTextSnapshot(THREAD_ID)?.text).toBe("第一段");
    act(() => {
      vi.advanceTimersByTime(LIVE_ASSISTANT_TEXT_PUBLISH_INTERVAL_MS);
    });
    expect(getLiveAssistantTextSnapshot(THREAD_ID)?.text).toBe(
      "第一段\n第二段",
    );
  });

  it("routes snapshot replacement and completion through durable state", () => {
    const { result, dispatch } = makeHook();

    act(() => {
      result.current.onItemUpdated(WORKSPACE_ID, THREAD_ID, {
        type: "agentMessage",
        id: ITEM_ID,
        text: "第一段",
      });
      result.current.onItemUpdated(WORKSPACE_ID, THREAD_ID, {
        type: "agentMessage",
        id: ITEM_ID,
        text: "替换正文",
      });
      result.current.onItemCompleted(WORKSPACE_ID, THREAD_ID, {
        type: "agentMessage",
        id: ITEM_ID,
        text: "最终正文",
      });
    });

    expect(agentDeltaCalls(dispatch).map((action) => action.delta)).toEqual([
      "第一段",
      "替换正文",
      "最终正文",
    ]);
    expect(getLiveAssistantTextSnapshot(THREAD_ID)).toBeNull();
  });

  it("drains the previous text-run tail when a new interleaved itemId starts", () => {
    // 回归：对话中 Reasoning 交错产生多个 text run（item / item:text-2）。
    // live 通道按 thread 单槽；若不在 itemId 切换时 drain，上一段只剩建壳首字
    // （用户看到「先」「截」），历史重载才恢复完整正文。
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { result, dispatch } = makeHook();
    const secondItemId = `${ITEM_ID}:text-2`;

    act(() => {
      result.current.onAgentMessageDelta({
        workspaceId: WORKSPACE_ID,
        threadId: THREAD_ID,
        itemId: ITEM_ID,
        delta: "先",
      });
      result.current.onAgentMessageDelta({
        workspaceId: WORKSPACE_ID,
        threadId: THREAD_ID,
        itemId: ITEM_ID,
        delta: "查看相关组件。",
      });
      // 新 text run（中间穿插过 reasoning，前端只看到 itemId 变化）。
      result.current.onAgentMessageDelta({
        workspaceId: WORKSPACE_ID,
        threadId: THREAD_ID,
        itemId: secondItemId,
        delta: "截",
      });
      result.current.onAgentMessageDelta({
        workspaceId: WORKSPACE_ID,
        threadId: THREAD_ID,
        itemId: secondItemId,
        delta: "图右侧黑卡片。",
      });
    });

    expect(agentDeltaCalls(dispatch)).toEqual([
      expect.objectContaining({ itemId: ITEM_ID, delta: "先" }),
      expect.objectContaining({
        itemId: ITEM_ID,
        delta: "查看相关组件。",
      }),
      expect.objectContaining({ itemId: secondItemId, delta: "截" }),
    ]);
    expect(getLiveAssistantTextSnapshot(THREAD_ID)?.itemId).toBe(secondItemId);
    // 首条立即 publish；后续 delta 在 cadence 后才刷新 published 快照。
    expect(getLiveAssistantTextSnapshot(THREAD_ID)?.text).toBe("截");

    act(() => {
      vi.advanceTimersByTime(LIVE_ASSISTANT_TEXT_PUBLISH_INTERVAL_MS);
    });
    expect(getLiveAssistantTextSnapshot(THREAD_ID)?.text).toBe(
      "截图右侧黑卡片。",
    );
  });

  it("flushes the live channel body when complete text is only the shell first token", () => {
    // 回归：流式首 delta 为 Markdown `**`，全文在 live 通道；provider complete
    // 若只带回壳文本却 clear 通道，结束后 UI 只剩 `**`，重开历史才完整。
    const { result, dispatch } = makeHook();
    const fullText =
      "**Todo 演示已就绪（刻意放慢更新，方便你看 pill 过程）：**\n\n表格正文";

    act(() => {
      result.current.onAgentMessageDelta({
        workspaceId: WORKSPACE_ID,
        threadId: THREAD_ID,
        itemId: ITEM_ID,
        delta: "**",
      });
      result.current.onAgentMessageDelta({
        workspaceId: WORKSPACE_ID,
        threadId: THREAD_ID,
        itemId: ITEM_ID,
        delta: "Todo 演示已就绪（刻意放慢更新，方便你看 pill 过程）：**\n\n表格正文",
      });
    });

    expect(peekLiveAssistantText(THREAD_ID)?.text).toBe(fullText);
    expect(agentDeltaCalls(dispatch).map((action) => action.delta)).toEqual([
      "**",
    ]);

    act(() => {
      result.current.onAgentMessageCompleted({
        workspaceId: WORKSPACE_ID,
        threadId: THREAD_ID,
        itemId: ITEM_ID,
        // 不完整终稿：仅建壳首段
        text: "**",
      });
    });

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "flushAgentCompletedBatch",
        threadId: THREAD_ID,
        itemId: ITEM_ID,
        text: fullText,
      }),
    );
    expect(getLiveAssistantTextSnapshot(THREAD_ID)).toBeNull();
    expect(peekLiveAssistantText(THREAD_ID)).toBeNull();
  });

  it("salvages residual live text when complete arrives after the turn is terminal", () => {
    const { result, dispatch } = makeHook();
    const fullText = "**结论文本完整内容**";

    act(() => {
      result.current.noteRealtimeTurnStarted(THREAD_ID, "turn-1");
      result.current.onAgentMessageDelta({
        workspaceId: WORKSPACE_ID,
        threadId: THREAD_ID,
        itemId: ITEM_ID,
        delta: "**",
      });
      result.current.onAgentMessageDelta({
        workspaceId: WORKSPACE_ID,
        threadId: THREAD_ID,
        itemId: ITEM_ID,
        delta: "结论文本完整内容**",
      });
      // 模拟 turn settle 先于 complete，且未 drain 成功（通道仍在）
      result.current.markRealtimeTurnTerminal(THREAD_ID, "turn-1");
    });

    dispatch.mockClear();

    act(() => {
      result.current.onAgentMessageCompleted({
        workspaceId: WORKSPACE_ID,
        threadId: THREAD_ID,
        itemId: ITEM_ID,
        text: "**",
        turnId: "turn-1",
      });
    });

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "flushAgentCompletedBatch",
        text: fullText,
      }),
    );
    expect(peekLiveAssistantText(THREAD_ID)).toBeNull();
  });
});
