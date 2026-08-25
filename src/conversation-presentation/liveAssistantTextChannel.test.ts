import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendLiveAssistantText,
  clearLiveAssistantText,
  drainLiveAssistantTextTail,
  drainLiveAssistantTextTailIfItemChanged,
  getLiveAssistantTextSnapshot,
  LIVE_ASSISTANT_TEXT_PUBLISH_INTERVAL_MS,
  peekLiveAssistantText,
  renameLiveAssistantTextThread,
  resetLiveAssistantTextChannelForTests,
  resolveLiveAssistantSettlementText,
  subscribeLiveAssistantText,
  updateLiveAssistantTextSnapshot,
} from "./liveAssistantTextChannel";

describe("liveAssistantTextChannel", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(0);
  });

  afterEach(() => {
    resetLiveAssistantTextChannelForTests();
    vi.useRealTimers();
  });

  it("publishes cumulative snapshot growth without treating replacements as append", () => {
    expect(
      updateLiveAssistantTextSnapshot("thread-1", "item-1", "第一段"),
    ).toBe("first");
    expect(
      updateLiveAssistantTextSnapshot(
        "thread-1",
        "item-1",
        "第一段\n第二段",
      ),
    ).toBe("growth");
    expect(
      updateLiveAssistantTextSnapshot(
        "thread-1",
        "item-1",
        "第一段\n第二段",
      ),
    ).toBe("unchanged");
    expect(
      updateLiveAssistantTextSnapshot("thread-1", "item-1", "替换正文"),
    ).toBe("replacement");
    expect(getLiveAssistantTextSnapshot("thread-1")?.text).toBe("第一段");

    vi.advanceTimersByTime(LIVE_ASSISTANT_TEXT_PUBLISH_INTERVAL_MS);
    expect(getLiveAssistantTextSnapshot("thread-1")?.text).toBe(
      "第一段\n第二段",
    );
  });

  it("marks the first delta per item as isFirst and accumulates the rest", () => {
    expect(appendLiveAssistantText("t1", "item-1", "Hello")).toEqual({
      isFirst: true,
    });
    expect(appendLiveAssistantText("t1", "item-1", " world")).toEqual({
      isFirst: false,
    });

    const snapshot = getLiveAssistantTextSnapshot("t1");
    expect(snapshot?.itemId).toBe("item-1");
    expect(snapshot?.text).toBe("Hello");
    expect(snapshot?.shellTextLength).toBe("Hello".length);

    vi.advanceTimersByTime(LIVE_ASSISTANT_TEXT_PUBLISH_INTERVAL_MS);
    expect(getLiveAssistantTextSnapshot("t1")?.text).toBe("Hello world");
  });

  it("resets the entry when the itemId changes (new turn or segment)", () => {
    appendLiveAssistantText("t1", "item-1", "first turn");
    expect(appendLiveAssistantText("t1", "item-2", "second")).toEqual({
      isFirst: true,
    });
    expect(getLiveAssistantTextSnapshot("t1")?.text).toBe("second");
  });

  it("drains the previous item tail when the next text run switches itemId", () => {
    // 模拟 Gemini/Grok/Kimi Text↔Reasoning 交错：text-1 建壳后只走通道，
    // 随后 reasoning 打断，text-2 以新 itemId 到来。
    appendLiveAssistantText("t1", "item-1", "先");
    appendLiveAssistantText("t1", "item-1", "查看截图");
    expect(
      drainLiveAssistantTextTailIfItemChanged("t1", "item-1:text-2"),
    ).toEqual({
      itemId: "item-1",
      tailDelta: "查看截图",
    });
    expect(getLiveAssistantTextSnapshot("t1")).toBeNull();
    expect(
      drainLiveAssistantTextTailIfItemChanged("t1", "item-1:text-2"),
    ).toBeNull();

    appendLiveAssistantText("t1", "item-1:text-2", "截");
    appendLiveAssistantText("t1", "item-1:text-2", "图右侧");
    expect(drainLiveAssistantTextTailIfItemChanged("t1", "item-1:text-2")).toBeNull();
    expect(drainLiveAssistantTextTail("t1")).toEqual({
      itemId: "item-1:text-2",
      tailDelta: "图右侧",
    });
  });

  it("does not drain when the next delta stays on the same itemId", () => {
    appendLiveAssistantText("t1", "item-1", "shell");
    appendLiveAssistantText("t1", "item-1", " tail");
    expect(drainLiveAssistantTextTailIfItemChanged("t1", "item-1")).toBeNull();
    expect(getLiveAssistantTextSnapshot("t1")?.text).toBe("shell");
    vi.advanceTimersByTime(LIVE_ASSISTANT_TEXT_PUBLISH_INTERVAL_MS);
    expect(getLiveAssistantTextSnapshot("t1")?.text).toBe("shell tail");
  });

  it("publishes the first entry immediately and keeps snapshots stable until trailing flush", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLiveAssistantText("t1", listener);

    appendLiveAssistantText("t1", "item-1", "a");
    expect(listener).toHaveBeenCalledTimes(1);

    const first = getLiveAssistantTextSnapshot("t1");
    expect(getLiveAssistantTextSnapshot("t1")).toBe(first);

    appendLiveAssistantText("t1", "item-1", "b");
    appendLiveAssistantText("t1", "item-1", "c");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getLiveAssistantTextSnapshot("t1")).toBe(first);

    vi.advanceTimersByTime(LIVE_ASSISTANT_TEXT_PUBLISH_INTERVAL_MS - 1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getLiveAssistantTextSnapshot("t1")).toBe(first);

    vi.advanceTimersByTime(1);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getLiveAssistantTextSnapshot("t1")?.text).toBe("abc");

    clearLiveAssistantText("t1");
    expect(listener).toHaveBeenCalledTimes(3);
    expect(getLiveAssistantTextSnapshot("t1")).toBeNull();

    unsubscribe();
    appendLiveAssistantText("t1", "item-1", "next");
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("cancels a pending trailing publish when the entry is cleared", () => {
    const listener = vi.fn();
    subscribeLiveAssistantText("t1", listener);

    appendLiveAssistantText("t1", "item-1", "a");
    appendLiveAssistantText("t1", "item-1", "b");
    clearLiveAssistantText("t1");
    expect(listener).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(LIVE_ASSISTANT_TEXT_PUBLISH_INTERVAL_MS);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getLiveAssistantTextSnapshot("t1")).toBeNull();
  });

  it("drains only the tail beyond the shell text and clears the entry", () => {
    appendLiveAssistantText("t1", "item-1", "shell");
    appendLiveAssistantText("t1", "item-1", " tail-1");
    appendLiveAssistantText("t1", "item-1", " tail-2");

    expect(drainLiveAssistantTextTail("t1")).toEqual({
      itemId: "item-1",
      tailDelta: " tail-1 tail-2",
    });
    expect(getLiveAssistantTextSnapshot("t1")).toBeNull();
  });

  it("peeks authoritative text even when the published snapshot lags", () => {
    appendLiveAssistantText("t1", "item-1", "**");
    appendLiveAssistantText("t1", "item-1", "Todo 演示已就绪");
    // 首段立即 publish；后续仍在 cadence 内 → published 仍是壳
    expect(getLiveAssistantTextSnapshot("t1")?.text).toBe("**");
    expect(peekLiveAssistantText("t1")?.text).toBe("**Todo 演示已就绪");
  });

  it("resolves settlement text so incomplete complete cannot wipe the live body", () => {
    appendLiveAssistantText("t1", "item-1", "**");
    appendLiveAssistantText(
      "t1",
      "item-1",
      "Todo 演示已就绪（刻意放慢更新）**",
    );
    const full = "**Todo 演示已就绪（刻意放慢更新）**";

    // provider 终稿只有建壳首段 / 空 → 保留通道全文
    expect(resolveLiveAssistantSettlementText("t1", "**")).toBe(full);
    expect(resolveLiveAssistantSettlementText("t1", "")).toBe(full);
    // 正常完整终稿
    expect(resolveLiveAssistantSettlementText("t1", full)).toBe(full);
    // 无通道时回落 provider
    expect(resolveLiveAssistantSettlementText("missing", "only-provider")).toBe(
      "only-provider",
    );
    // 不 clear 通道（由调用方负责）
    expect(peekLiveAssistantText("t1")?.text).toBe(full);
  });

  it("returns null from drain when nothing beyond the shell has accumulated", () => {
    appendLiveAssistantText("t1", "item-1", "shell-only");
    expect(drainLiveAssistantTextTail("t1")).toBeNull();
    expect(getLiveAssistantTextSnapshot("t1")).toBeNull();
    expect(drainLiveAssistantTextTail("missing")).toBeNull();
  });

  it("migrates the entry and notifies both threads on rename", () => {
    const oldListener = vi.fn();
    const newListener = vi.fn();
    subscribeLiveAssistantText("pending-1", oldListener);
    subscribeLiveAssistantText("claude:s1", newListener);

    appendLiveAssistantText("pending-1", "item-1", "streamed");
    oldListener.mockClear();

    renameLiveAssistantTextThread("pending-1", "claude:s1");
    expect(getLiveAssistantTextSnapshot("pending-1")).toBeNull();
    expect(getLiveAssistantTextSnapshot("claude:s1")?.text).toBe("streamed");
    expect(oldListener).toHaveBeenCalledTimes(1);
    expect(newListener).toHaveBeenCalledTimes(1);

    // 后续 delta 继续累计在新 threadId 上，不再视为首条。
    expect(appendLiveAssistantText("claude:s1", "item-1", " more")).toEqual({
      isFirst: false,
    });
    expect(getLiveAssistantTextSnapshot("claude:s1")?.text).toBe("streamed");
    vi.advanceTimersByTime(LIVE_ASSISTANT_TEXT_PUBLISH_INTERVAL_MS);
    expect(getLiveAssistantTextSnapshot("claude:s1")?.text).toBe(
      "streamed more",
    );
  });

  it("renames the latest accumulated text and prevents the old timer from firing", () => {
    const oldListener = vi.fn();
    const newListener = vi.fn();
    subscribeLiveAssistantText("pending-1", oldListener);
    subscribeLiveAssistantText("claude:s1", newListener);

    appendLiveAssistantText("pending-1", "item-1", "shell");
    appendLiveAssistantText("pending-1", "item-1", " pending");
    oldListener.mockClear();

    renameLiveAssistantTextThread("pending-1", "claude:s1");
    expect(getLiveAssistantTextSnapshot("pending-1")).toBeNull();
    expect(getLiveAssistantTextSnapshot("claude:s1")?.text).toBe(
      "shell pending",
    );
    expect(oldListener).toHaveBeenCalledTimes(1);
    expect(newListener).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(LIVE_ASSISTANT_TEXT_PUBLISH_INTERVAL_MS);
    expect(oldListener).toHaveBeenCalledTimes(1);
    expect(newListener).toHaveBeenCalledTimes(1);
  });
});
