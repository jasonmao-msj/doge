// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getClientStoreSync,
  writeClientStoreValue,
} from "../../../services/clientStorage";
import {
  appendLiveAssistantShadowDelta,
  buildLiveAssistantShadowTranscriptId,
  findLiveAssistantShadowTranscriptForRestore,
  flushLiveAssistantShadowTranscriptsNow,
  normalizeLiveAssistantShadowTranscriptStore,
  resetLiveAssistantShadowTranscriptsForTests,
  settleLiveAssistantShadowTranscript,
  upsertLiveAssistantShadowSnapshot,
} from "./liveAssistantShadowTranscript";

const STORE_KEY = "liveAssistantShadowTranscripts";

describe("liveAssistantShadowTranscript", () => {
  beforeEach(() => {
    resetLiveAssistantShadowTranscriptsForTests();
    writeClientStoreValue("threads", STORE_KEY, {});
    window.localStorage.clear();
  });

  it("appends Claude live assistant deltas into a bounded shadow transcript", () => {
    const now = Date.now();
    const input = {
      engine: "claude" as const,
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      turnId: "turn-1",
      itemId: "assistant-1",
    };

    appendLiveAssistantShadowDelta({ ...input, delta: "第一段\n\n", timestamp: now });
    appendLiveAssistantShadowDelta({ ...input, delta: "第二段", timestamp: now + 100 });
    flushLiveAssistantShadowTranscriptsNow();

    const id = buildLiveAssistantShadowTranscriptId(input);
    const store = getClientStoreSync<Record<string, unknown>>("threads", STORE_KEY);
    expect(store?.[id]).toMatchObject({
      id,
      engine: "claude",
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      sessionId: "session-1",
      turnId: "turn-1",
      itemId: "assistant-1",
      text: "第一段\n\n第二段",
      createdAt: now,
      updatedAt: now + 100,
    });
  });

  it("merges growing agent message snapshots without duplicating the previous body", () => {
    const now = Date.now();
    const input = {
      engine: "claude" as const,
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      turnId: "turn-1",
      itemId: "assistant-1",
    };

    upsertLiveAssistantShadowSnapshot({
      ...input,
      text: "第一段",
      timestamp: now,
    });
    upsertLiveAssistantShadowSnapshot({
      ...input,
      text: "第一段\n\n第二段",
      timestamp: now + 100,
    });
    flushLiveAssistantShadowTranscriptsNow();

    const id = buildLiveAssistantShadowTranscriptId(input);
    const store = getClientStoreSync<Record<string, { text?: string }>>(
      "threads",
      STORE_KEY,
    );
    expect(store?.[id]?.text).toBe("第一段\n\n第二段");
    expect(store?.[id]?.text).not.toBe("第一段第一段\n\n第二段");
  });

  it("throttles delta persistence into the client store while keeping restore reads fresh", () => {
    vi.useFakeTimers();
    try {
      const now = Date.now();
      const input = {
        engine: "claude" as const,
        workspaceId: "ws-1",
        threadId: "claude:session-1",
        turnId: "turn-1",
        itemId: "assistant-1",
      };

      appendLiveAssistantShadowDelta({ ...input, delta: "streamed", timestamp: now });

      // 节流窗口内不写 client store，但 restore 读内存态可见。
      expect(getClientStoreSync("threads", STORE_KEY)).toEqual({});
      expect(
        findLiveAssistantShadowTranscriptForRestore({
          workspaceId: "ws-1",
          threadId: "claude:session-1",
        })?.text,
      ).toBe("streamed");

      vi.advanceTimersByTime(1_100);
      const id = buildLiveAssistantShadowTranscriptId(input);
      const store = getClientStoreSync<Record<string, { text?: string }>>(
        "threads",
        STORE_KEY,
      );
      expect(store?.[id]?.text).toBe("streamed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores non-Claude engines for the initial recovery contract", () => {
    appendLiveAssistantShadowDelta({
      engine: "codex",
      workspaceId: "ws-1",
      threadId: "codex:session-1",
      itemId: "assistant-1",
      delta: "not persisted",
    });

    expect(getClientStoreSync("threads", STORE_KEY)).toEqual({});
  });

  it("finds the most recent matching transcript for restore", () => {
    const now = Date.now();
    appendLiveAssistantShadowDelta({
      engine: "claude",
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      itemId: "assistant-old",
      delta: "old",
      timestamp: now,
    });
    appendLiveAssistantShadowDelta({
      engine: "claude",
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      itemId: "assistant-new",
      delta: "new",
      timestamp: now + 1000,
    });

    expect(
      findLiveAssistantShadowTranscriptForRestore({
        workspaceId: "ws-1",
        threadId: "claude:session-1",
      })?.text,
    ).toBe("new");
  });

  it("prefers matching turn for restore when expected turn id is provided", () => {
    const now = Date.now();
    appendLiveAssistantShadowDelta({
      engine: "claude",
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      turnId: "turn-old",
      itemId: "assistant-old",
      delta: "old turn text",
      timestamp: now,
    });
    appendLiveAssistantShadowDelta({
      engine: "claude",
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      turnId: "turn-new",
      itemId: "assistant-new",
      delta: "current turn text",
      timestamp: now + 500,
    });

    expect(
      findLiveAssistantShadowTranscriptForRestore({
        workspaceId: "ws-1",
        threadId: "claude:session-1",
        expectedTurnId: "turn-new",
      })?.text,
    ).toBe("current turn text");
  });

  it("does not fall back to a different concrete turn when expected turn id does not match", () => {
    const now = Date.now();
    appendLiveAssistantShadowDelta({
      engine: "claude",
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      turnId: "turn-old",
      itemId: "assistant-old",
      delta: "old turn text",
      timestamp: now,
    });
    appendLiveAssistantShadowDelta({
      engine: "claude",
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      turnId: "turn-other",
      itemId: "assistant-other",
      delta: "other turn text",
      timestamp: now + 100,
    });

    expect(
      findLiveAssistantShadowTranscriptForRestore({
        workspaceId: "ws-1",
        threadId: "claude:session-1",
        expectedTurnId: "turn-missing",
      }),
    ).toBeNull();
  });

  it("falls back to legacy candidates without turn id when expected turn id does not match", () => {
    const now = Date.now();
    appendLiveAssistantShadowDelta({
      engine: "claude",
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      itemId: "assistant-legacy",
      delta: "legacy recoverable text",
      timestamp: now,
    });

    expect(
      findLiveAssistantShadowTranscriptForRestore({
        workspaceId: "ws-1",
        threadId: "claude:session-1",
        expectedTurnId: "turn-current",
      })?.text,
    ).toBe("legacy recoverable text");
  });

  it("promotes and removes same-item legacy no-turn shadows when a concrete turn settles", () => {
    const now = Date.now();
    const legacyInput = {
      engine: "claude" as const,
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      itemId: "assistant-1",
    };
    const settledInput = {
      ...legacyInput,
      turnId: "turn-final",
    };

    appendLiveAssistantShadowDelta({
      ...legacyInput,
      delta: "legacy body",
      timestamp: now,
    });
    settleLiveAssistantShadowTranscript({
      ...settledInput,
      timestamp: now + 100,
      providerFinalObserved: true,
    });

    const legacyId = buildLiveAssistantShadowTranscriptId(legacyInput);
    const settledId = buildLiveAssistantShadowTranscriptId(settledInput);
    const store = getClientStoreSync<Record<string, { text?: string }>>(
      "threads",
      STORE_KEY,
    );

    expect(store?.[legacyId]).toBeUndefined();
    expect(store?.[settledId]).toMatchObject({
      turnId: "turn-final",
      text: "legacy body",
      providerFinalObserved: true,
      settledAt: now + 100,
    });
    expect(
      findLiveAssistantShadowTranscriptForRestore({
        workspaceId: "ws-1",
        threadId: "claude:session-1",
        expectedTurnId: "turn-next",
        requireUnsettled: true,
      }),
    ).toBeNull();
  });

  it("can disable restore without deleting captured shadow text", () => {
    const now = Date.now();
    appendLiveAssistantShadowDelta({
      engine: "claude",
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      itemId: "assistant-1",
      delta: "recoverable",
      timestamp: now,
    });
    flushLiveAssistantShadowTranscriptsNow();
    window.localStorage.setItem(
      "doge.recovery.liveAssistantShadowTranscript.disabled",
      "1",
    );

    expect(
      findLiveAssistantShadowTranscriptForRestore({
        workspaceId: "ws-1",
        threadId: "claude:session-1",
      }),
    ).toBeNull();
    expect(getClientStoreSync("threads", STORE_KEY)).not.toEqual({});
  });

  it("retains settled entries briefly and prunes stale or corrupt entries", () => {
    const now = Date.now();
    const input = {
      engine: "claude" as const,
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      itemId: "assistant-1",
    };
    appendLiveAssistantShadowDelta({ ...input, delta: "final", timestamp: now });
    settleLiveAssistantShadowTranscript({
      ...input,
      text: "final",
      timestamp: now + 200,
      providerFinalObserved: true,
    });

    const normalized = normalizeLiveAssistantShadowTranscriptStore(
      {
        ...(getClientStoreSync<Record<string, unknown>>("threads", STORE_KEY) ?? {}),
        broken: { id: 1 },
      },
      now + 300,
    );
    expect(Object.values(normalized)).toHaveLength(1);
    expect(Object.values(normalized)[0]).toMatchObject({
      text: "final",
      settledAt: now + 200,
      providerFinalObserved: true,
    });

    expect(
      normalizeLiveAssistantShadowTranscriptStore(
        normalized,
        now + 2 * 24 * 60 * 60 * 1000,
      ),
    ).toEqual({});
  });

  it("preserves interrupted entries ahead of newer provider-final entries during pruning", () => {
    const now = Date.now();
    const providerFinalEntries = Object.fromEntries(
      Array.from({ length: 48 }, (_, index) => {
        const id = `settled-${index}`;
        return [
          id,
          {
            id,
            engine: "claude",
            workspaceId: "ws-1",
            threadId: "claude:session-1",
            sessionId: "session-1",
            turnId: `settled-turn-${index}`,
            itemId: `settled-assistant-${index}`,
            text: `provider final ${index}`,
            createdAt: now + index,
            updatedAt: now + index,
            settledAt: now + index,
            providerFinalObserved: true,
          },
        ];
      }),
    );
    const interrupted = {
      id: "interrupted-old",
      engine: "claude",
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      sessionId: "session-1",
      turnId: "interrupted-turn",
      itemId: "interrupted-assistant",
      text: "recover me",
      createdAt: now - 1000,
      updatedAt: now - 1000,
    };

    const normalized = normalizeLiveAssistantShadowTranscriptStore(
      {
        ...providerFinalEntries,
        [interrupted.id]: interrupted,
      },
      now + 2000,
    );

    expect(Object.values(normalized)).toHaveLength(48);
    expect(normalized[interrupted.id]?.text).toBe("recover me");
  });
});
