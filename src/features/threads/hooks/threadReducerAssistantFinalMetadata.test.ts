import { describe, expect, it } from "vitest";
import type { ConversationItem, ThreadTokenUsage } from "../../../types";
import {
  resolveTurnTokenCountsFromUsage,
  stampLatestFinalAssistantTurnTokens,
} from "./threadReducerAssistantFinalMetadata";

describe("stampLatestFinalAssistantTurnTokens", () => {
  it("stamps last-turn usage onto the latest final assistant message", () => {
    const items: ConversationItem[] = [
      {
        id: "a1",
        kind: "message",
        role: "assistant",
        text: "old",
        isFinal: true,
        finalDurationMs: 1000,
      },
      {
        id: "a2",
        kind: "message",
        role: "assistant",
        text: "new",
        isFinal: true,
        finalDurationMs: 13_000,
      },
    ];
    const usage: ThreadTokenUsage = {
      total: {
        totalTokens: 43_149,
        inputTokens: 37,
        cachedInputTokens: 42_963,
        outputTokens: 149,
        reasoningOutputTokens: 0,
      },
      last: {
        totalTokens: 43_149,
        inputTokens: 37,
        cachedInputTokens: 42_963,
        outputTokens: 149,
        reasoningOutputTokens: 0,
      },
      modelContextWindow: null,
    };
    expect(resolveTurnTokenCountsFromUsage(usage)).toEqual({
      inputTokens: 43_000,
      outputTokens: 149,
    });
    const next = stampLatestFinalAssistantTurnTokens(items, usage);
    expect(next[0]).toEqual(items[0]);
    expect(next[1]).toMatchObject({
      id: "a2",
      finalInputTokens: 43_000,
      finalOutputTokens: 149,
    });
  });
});
