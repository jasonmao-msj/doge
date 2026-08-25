// @vitest-environment jsdom
/**
 * Shared DataSource 单元测试（Wave 3 / A3，任务 5.4）。
 *
 * 验证：映射规则、default-on + explicit-negative rollback、不污染 Native 路径。
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isSharedProjectionDataSourceEnabled,
  resolveSharedConversationItems,
  setSharedProjectionTestOverrideEnabled,
  SHARED_PROJECTION_STORAGE_KEY,
  toSharedConversationItems,
} from "./dataSource";
import type { SharedProjectionItem } from "./types";

function makeItem(
  overrides: Partial<SharedProjectionItem> & { kind: SharedProjectionItem["kind"] },
): SharedProjectionItem {
  return {
    id: "1:test",
    content: {},
    fidelity: "canonical",
    checksum: "x",
    ...overrides,
  };
}

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllEnvs();
});

describe("toSharedConversationItems", () => {
  it("maps message / reasoning / tool items to ConversationItem", () => {
    const items: SharedProjectionItem[] = [
      makeItem({
        id: "1:user",
        kind: "message",
        content: { role: "user", text: "hi", turnId: "turn-1", engineSource: "claude" },
      }),
      makeItem({
        id: "2:assistant:0",
        kind: "message",
        content: {
          role: "assistant",
          text: "hello",
          turnId: "turn-1",
          engineSource: "claude",
          isFinal: true,
          finalCompletedAt: 123,
        },
      }),
      makeItem({
        id: "2:reasoning:1",
        kind: "reasoning",
        content: { summary: "thinking", content: "thinking", engineSource: "claude" },
      }),
      makeItem({
        id: "2:tool:0",
        kind: "tool",
        content: {
          toolType: "Bash",
          turnId: "turn-1",
          title: "Bash",
          detail: "ls",
          status: "completed",
          output: "ok",
          engineSource: "claude",
        },
      }),
    ];

    const result = toSharedConversationItems(items);
    expect(result).toHaveLength(4);

    expect(result[0]).toMatchObject({
      id: "1:user",
      kind: "message",
      role: "user",
      text: "hi",
      turnId: "turn-1",
      engineSource: "claude",
    });
    expect(result[1]).toMatchObject({
      kind: "message",
      role: "assistant",
      isFinal: true,
      finalCompletedAt: 123,
    });
    expect(result[2]).toMatchObject({ kind: "reasoning", summary: "thinking" });
    expect(result[3]).toMatchObject({
      kind: "tool",
      toolType: "Bash",
      status: "completed",
      output: "ok",
    });
  });

  it("rebuilds Codex apply_patch summary into fileChange changes via buildConversationItem", () => {
    const patch =
      "*** Begin Patch\n*** Update File: src/keep.ts\n@@\n-old\n+new\n*** End Patch\n";
    const [tool] = toSharedConversationItems([
      makeItem({
        id: "2:tool:patch",
        kind: "tool",
        content: {
          toolType: "apply_patch",
          title: "apply_patch",
          detail: JSON.stringify({ name: "apply_patch", input: patch, patch }),
          status: "completed",
          output: "Success. Updated the following files:\nM src/keep.ts",
          engineSource: "codex",
          turnId: "turn-1",
        },
      }),
    ]);
    expect(tool).toMatchObject({
      kind: "tool",
      toolType: "fileChange",
      engineSource: "codex",
      turnId: "turn-1",
    });
    expect(
      tool && tool.kind === "tool" ? tool.changes?.[0]?.path : null,
    ).toBe("src/keep.ts");
  });

  it("maps final footer meta and fileChange changes for Shared history parity", () => {
    const [assistant, tool] = toSharedConversationItems([
      makeItem({
        id: "2:assistant:0",
        kind: "message",
        content: {
          role: "assistant",
          text: "done",
          turnId: "turn-1",
          engineSource: "claude",
          isFinal: true,
          finalCompletedAt: 1_700_000_000_001,
          finalDurationMs: 13_000,
          finalInputTokens: 41_100,
          finalOutputTokens: 105,
        },
      }),
      makeItem({
        id: "2:tool:0",
        kind: "tool",
        content: {
          toolType: "fileChange",
          turnId: "turn-1",
          title: "Write",
          detail: '{"path":"docs/note.md"}',
          status: "completed",
          output: "wrote",
          engineSource: "claude",
          changes: [{ path: "docs/note.md", kind: "modified" }],
        },
      }),
    ]);

    expect(assistant).toMatchObject({
      kind: "message",
      role: "assistant",
      isFinal: true,
      finalCompletedAt: 1_700_000_000_001,
      finalDurationMs: 13_000,
      finalInputTokens: 41_100,
      finalOutputTokens: 105,
    });
    expect(tool).toMatchObject({
      kind: "tool",
      toolType: "fileChange",
      title: "Write",
      changes: [{ path: "docs/note.md", kind: "modified" }],
    });
  });

  it("maps user message images locators from shared projection content", () => {
    const [item] = toSharedConversationItems([
      makeItem({
        id: "1:user",
        kind: "message",
        content: {
          role: "user",
          text: "看这张图",
          images: ["/tmp/shot.png", "  ", "/tmp/shot-2.jpg"],
          turnId: "turn-img",
          engineSource: "grok",
        },
      }),
    ]);

    expect(item).toMatchObject({
      id: "1:user",
      kind: "message",
      role: "user",
      text: "看这张图",
      images: ["/tmp/shot.png", "/tmp/shot-2.jpg"],
      engineSource: "grok",
    });
  });

  it("drops systemNotice and metadata items (shadow 观测面不属于渲染面)", () => {
    const items: SharedProjectionItem[] = [
      makeItem({ id: "1:control", kind: "systemNotice", content: { text: "Control: cancel" } }),
      makeItem({ id: "2:usage", kind: "metadata", content: { type: "usage" } }),
      makeItem({
        id: "1:user",
        kind: "message",
        content: { role: "user", text: "hi" },
      }),
    ];

    const result = toSharedConversationItems(items);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "1:user", kind: "message" });
  });

  it("preserves the immutable execution target snapshot for Turn Badge", () => {
    const [item] = toSharedConversationItems([
      makeItem({
        id: "2:assistant:0",
        kind: "message",
        content: {
          role: "assistant",
          text: "done",
          engineSource: "claude",
          executionTargetSnapshot: {
            engine: "claude",
            providerProfileId: "openrouter",
            modelCatalogEntryId: "catalog-sonnet",
            providerProfileNameSnapshot: "OpenRouter",
            model: "claude-sonnet-4-5",
            reasoning: { effort: "high" },
          },
        },
      }),
    ]);

    expect(item).toMatchObject({
      executionTargetSnapshot: {
        engine: "claude",
        providerProfileId: "openrouter",
        modelCatalogEntryId: "catalog-sonnet",
        providerProfileNameSnapshot: "OpenRouter",
        model: "claude-sonnet-4-5",
        reasoning: { effort: "high" },
      },
    });
  });

  it("restores canonical explicit local targets", () => {
    const [item] = toSharedConversationItems([
      makeItem({
        id: "2:assistant:local",
        kind: "message",
        content: {
          role: "assistant",
          text: "local",
          executionTargetSnapshot: {
            engine: "codex",
            providerProfileId: null,
            model: "MiniMax-M3",
            providerProfileSource: "local",
          },
        },
      }),
    ]);

    expect(item).toMatchObject({
      executionTargetSnapshot: {
        providerProfileId: null,
        providerProfileNameSnapshot: "本地配置",
        providerProfileSource: "local",
      },
    });
  });

  it("does not infer local identity from an incomplete canonical target", () => {
    const [item] = toSharedConversationItems([
      makeItem({
        id: "2:assistant:incomplete",
        kind: "message",
        content: {
          role: "assistant",
          text: "legacy canonical",
          executionTargetSnapshot: {
            engine: "codex",
            providerProfileId: null,
            model: "MiniMax-M3",
          },
        },
      }),
    ]);

    expect(item).toMatchObject({
      executionTargetSnapshot: {
        providerProfileId: null,
        providerProfileNameSnapshot: null,
        providerProfileSource: null,
      },
    });
  });

  it("drops selection-domain and unknown sources from canonical projection", () => {
    const [item] = toSharedConversationItems([
      makeItem({
        id: "2:assistant:invalid-source",
        kind: "message",
        content: {
          role: "assistant",
          text: "managed",
          executionTargetSnapshot: {
            engine: "codex",
            providerProfileId: "provider-openai",
            providerProfileSource: "disk",
          },
        },
      }),
    ]);

    expect(item).toMatchObject({
      executionTargetSnapshot: {
        providerProfileId: "provider-openai",
        providerProfileSource: null,
      },
    });
  });

  it("does not fabricate local identity for presentation-only legacy targets", () => {
    const [item] = toSharedConversationItems([
      makeItem({
        id: "legacy:assistant",
        kind: "message",
        fidelity: "presentation-only",
        content: {
          role: "assistant",
          text: "legacy",
          executionTargetSnapshot: {
            engine: "codex",
            providerProfileId: null,
          },
        },
      }),
    ]);

    expect(item).toMatchObject({
      executionTargetSnapshot: {
        providerProfileId: null,
        providerProfileNameSnapshot: null,
        providerProfileSource: null,
      },
    });
  });

  it("keeps distinct provider snapshots when multi-provider history is rebuilt", () => {
    const result = toSharedConversationItems([
      makeItem({
        id: "2:assistant:0",
        kind: "message",
        content: {
          role: "assistant",
          text: "Claude result",
          executionTargetSnapshot: {
            engine: "claude",
            providerProfileId: "provider-a",
            providerProfileNameSnapshot: "Provider A",
            model: "sonnet",
          },
        },
      }),
      makeItem({
        id: "4:assistant:0",
        kind: "message",
        content: {
          role: "assistant",
          text: "Codex result",
          executionTargetSnapshot: {
            engine: "codex",
            providerProfileId: "provider-b",
            providerProfileNameSnapshot: "Provider B",
            model: "gpt-5-codex",
          },
        },
      }),
    ]);

    expect(
      result.map((item) =>
        item.kind === "message" ? item.executionTargetSnapshot : null,
      ),
    ).toEqual([
      expect.objectContaining({
        engine: "claude",
        providerProfileNameSnapshot: "Provider A",
        model: "sonnet",
      }),
      expect.objectContaining({
        engine: "codex",
        providerProfileNameSnapshot: "Provider B",
        model: "gpt-5-codex",
      }),
    ]);
  });

  it("non-user role falls back to assistant", () => {
    const result = toSharedConversationItems([
      makeItem({ id: "1:m", kind: "message", content: { role: "system", text: "x" } }),
    ]);
    expect(result[0]).toMatchObject({ kind: "message", role: "assistant" });
  });

  it("drops unknown engineSource values at the projection boundary", () => {
    const result = toSharedConversationItems([
      makeItem({
        id: "1:m",
        kind: "message",
        content: { role: "assistant", text: "x", engineSource: "future-engine" },
      }),
    ]);
    expect(result[0]).toMatchObject({ kind: "message", role: "assistant" });
    expect(result[0]?.engineSource).toBeUndefined();
  });

  it("does not mutate input and preserves order", () => {
    const items: SharedProjectionItem[] = [
      makeItem({ id: "a", kind: "message", content: { role: "user", text: "1" } }),
      makeItem({ id: "b", kind: "message", content: { role: "user", text: "2" } }),
    ];
    const snapshot = JSON.parse(JSON.stringify(items));

    const result = toSharedConversationItems(items);
    expect(items).toEqual(snapshot);
    expect(result.map((item) => item.id)).toEqual(["a", "b"]);
  });
});

describe("projection rollout flag", () => {
  it("is enabled by default", () => {
    expect(isSharedProjectionDataSourceEnabled()).toBe(true);
  });

  it("maps canonical projection without a local override", () => {
    const items: SharedProjectionItem[] = [
      makeItem({ id: "a", kind: "message", content: { role: "user", text: "hi" } }),
    ];
    expect(resolveSharedConversationItems(items)).toHaveLength(1);
  });

  it("returns null only for an explicit negative rollback", () => {
    window.localStorage.setItem(SHARED_PROJECTION_STORAGE_KEY, "0");
    const items: SharedProjectionItem[] = [
      makeItem({ id: "a", kind: "message", content: { role: "user", text: "hi" } }),
    ];
    expect(isSharedProjectionDataSourceEnabled()).toBe(false);
    expect(resolveSharedConversationItems(items)).toBeNull();
  });

  it("lets the local override take precedence over a negative build flag", () => {
    vi.stubEnv("VITE_MOSSX_SHARED_PROJECTION", "false");
    window.localStorage.setItem(SHARED_PROJECTION_STORAGE_KEY, "1");
    expect(isSharedProjectionDataSourceEnabled()).toBe(true);
  });

  it("supports an explicit negative build rollback", () => {
    vi.stubEnv("VITE_MOSSX_SHARED_PROJECTION", "off");
    expect(isSharedProjectionDataSourceEnabled()).toBe(false);
  });

  it("returns null for nullish input while enabled", () => {
    expect(resolveSharedConversationItems(null)).toBeNull();
    expect(resolveSharedConversationItems(undefined)).toBeNull();
  });

  it("drops multi-agent durable settle summary assistant bubbles", () => {
    const items: SharedProjectionItem[] = [
      makeItem({
        id: "squad:run-1:user",
        kind: "message",
        content: {
          role: "user",
          text: "fix docs",
          turnId: "squad:run-1",
          squadRunId: "run-1",
        },
      }),
      makeItem({
        id: "squad:run-1:assistant",
        kind: "message",
        content: {
          role: "assistant",
          text: "short final summary",
          turnId: "squad:run-1",
          squadRunId: "run-1",
          isFinal: true,
        },
      }),
    ];
    const mapped = toSharedConversationItems(items);
    expect(mapped.map((item) => item.id)).toEqual(["squad:run-1:user"]);
  });

  it("persists positive/negative overrides and can clear them", () => {
    expect(setSharedProjectionTestOverrideEnabled(true)).toBe(true);
    expect(window.localStorage.getItem(SHARED_PROJECTION_STORAGE_KEY)).toBe("1");
    expect(isSharedProjectionDataSourceEnabled()).toBe(true);
    expect(setSharedProjectionTestOverrideEnabled(true)).toBe(false);

    expect(setSharedProjectionTestOverrideEnabled(false)).toBe(true);
    expect(window.localStorage.getItem(SHARED_PROJECTION_STORAGE_KEY)).toBe("0");
    expect(isSharedProjectionDataSourceEnabled()).toBe(false);
    expect(setSharedProjectionTestOverrideEnabled(false)).toBe(false);
    expect(setSharedProjectionTestOverrideEnabled(null)).toBe(true);
    expect(window.localStorage.getItem(SHARED_PROJECTION_STORAGE_KEY)).toBeNull();
    expect(isSharedProjectionDataSourceEnabled()).toBe(true);
    expect(setSharedProjectionTestOverrideEnabled(null)).toBe(false);
  });
});
