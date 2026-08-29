import { describe, expect, it } from "vitest";
import type { ConversationItem } from "../types";
import {
  buildConversationItem,
  buildConversationItemFromThreadItem,
  buildItemsFromThread,
  getThreadTimestamp,
  mergeThreadItems,
  normalizeItem,
  previewThreadName,
  prepareThreadItems,
  rebalanceTrailingToolsBeforeFinalAssistants,
  upsertItem,
} from "./threadItems";

type ExploreItem = Extract<ConversationItem, { kind: "explore" }>;
type ToolItem = Extract<ConversationItem, { kind: "tool" }>;
type MessageItem = Extract<ConversationItem, { kind: "message" }>;
type ReviewItem = Extract<ConversationItem, { kind: "review" }>;
type ReasoningItem = Extract<ConversationItem, { kind: "reasoning" }>;
type GeneratedImageItem = Extract<ConversationItem, { kind: "generatedImage" }>;

function expectExploreItem(item: ConversationItem | undefined): ExploreItem {
  expect(item?.kind).toBe("explore");
  return item as ExploreItem;
}

function expectToolItem(item: ConversationItem | undefined): ToolItem {
  expect(item?.kind).toBe("tool");
  return item as ToolItem;
}

function expectMessageItem(item: ConversationItem | undefined): MessageItem {
  expect(item?.kind).toBe("message");
  return item as MessageItem;
}

function expectReviewItem(item: ConversationItem | undefined): ReviewItem {
  expect(item?.kind).toBe("review");
  return item as ReviewItem;
}

function expectReasoningItem(item: ConversationItem | undefined): ReasoningItem {
  expect(item?.kind).toBe("reasoning");
  return item as ReasoningItem;
}

function expectGeneratedImageItem(
  item: ConversationItem | undefined,
): GeneratedImageItem {
  expect(item?.kind).toBe("generatedImage");
  return item as GeneratedImageItem;
}

describe("threadItems", () => {
  it("truncates long message text in normalizeItem", () => {
    const text = "a".repeat(21000);
    const item: ConversationItem = {
      id: "msg-1",
      kind: "message",
      role: "user",
      text,
    };
    const normalized = normalizeItem(item);
    expect(normalized.kind).toBe("message");
    if (normalized.kind === "message") {
      expect(normalized.text).not.toBe(text);
      expect(normalized.text.endsWith("...")).toBe(true);
      expect(normalized.text.length).toBeLessThan(text.length);
    }
  });

  it("normalizes fragmented and repeated assistant message text", () => {
    const fragmented =
      "你\n\n好\n\n!\n\n有什\n\n么\n\n可以\n\n帮\n\n你的\n\n吗\n\n？";
    const clean = "你好！有什么可以帮你的吗？";
    const item: ConversationItem = {
      id: "msg-assistant-normalize-1",
      kind: "message",
      role: "assistant",
      text: `${fragmented}\n\n${clean}\n\n${clean}`,
    };
    const normalized = normalizeItem(item);
    expect(normalized.kind).toBe("message");
    if (normalized.kind === "message") {
      const comparable = (value: string) =>
        value.replace(/[！!]/g, "!").replace(/[？?]/g, "?");
      expect(comparable(normalized.text)).toBe(comparable(clean));
    }
  });

  it("keeps normal markdown assistant output unchanged", () => {
    const markdown = [
      "## 项目定位",
      "",
      "| 技术 | 版本/用途 |",
      "| --- | --- |",
      "| Node.js | >= 18.0.0 |",
      "",
      "```text",
      "plan -> code -> verify -> doc",
      "```",
      "",
      "- 第一项",
      "- 第二项",
    ].join("\n");
    const item: ConversationItem = {
      id: "msg-assistant-markdown-1",
      kind: "message",
      role: "assistant",
      text: markdown,
    };
    const normalized = normalizeItem(item);
    expect(normalized.kind).toBe("message");
    if (normalized.kind === "message") {
      expect(normalized.text).toBe(markdown);
    }
  });

  it("preserves inline code spans when normalizing fragmented assistant text", () => {
    const item: ConversationItem = {
      id: "msg-assistant-inline-code-normalize-1",
      kind: "message",
      role: "assistant",
      text: [
        "执行",
        "命令：",
        "`pnpm",
        "run",
        "lint`",
        "完成",
        "之后",
        "把",
        "执行结果",
        "告诉我。",
      ].join("\n\n"),
    };
    const normalized = normalizeItem(item);
    expect(normalized.kind).toBe("message");
    if (normalized.kind === "message") {
      expect(normalized.text).toContain("`pnpm\n\nrun\n\nlint`");
      expect(normalized.text).toContain("完成之后把执行结果告诉我。");
      expect(normalized.text).not.toContain("pnpmrunlint");
    }
  });

  it("dedupes repeated assistant text that contains multiple inline code spans", () => {
    const duplicated = [
      "`computer_use` 修复已提交, commit hash 是 a06c730c。",
      "我继续补 `journal record`, 然后再提测试和 `changelog`。",
      "`computer_use` 修复已提交, commit hash 是 a06c730c。",
      "我继续补 `journal record`, 然后再提测试和 `changelog`。",
    ].join(" ");
    const item: ConversationItem = {
      id: "msg-assistant-inline-code-duplicate-1",
      kind: "message",
      role: "assistant",
      text: duplicated,
    };
    const normalized = normalizeItem(item);
    expect(normalized.kind).toBe("message");
    if (normalized.kind === "message") {
      expect(normalized.text).toBe(
        "`computer_use` 修复已提交, commit hash 是 a06c730c。我继续补 `journal record`, 然后再提测试和 `changelog`。",
      );
    }
  });

  it("normalizes assistant no-content placeholders to empty text", () => {
    const item: ConversationItem = {
      id: "msg-assistant-empty-placeholder",
      kind: "message",
      role: "assistant",
      text: "(no content)",
    };
    const normalized = normalizeItem(item);
    expect(normalized.kind).toBe("message");
    if (normalized.kind === "message") {
      expect(normalized.text).toBe("");
    }
  });

  it("strips synthetic Claude approval resume text from assistant messages", () => {
    const item: ConversationItem = {
      id: "msg-assistant-approval-resume-artifacts",
      kind: "message",
      role: "assistant",
      text: [
        "创建已经完成。",
        "",
        "Completed approved operations:",
        "- Created aaa.txt",
        "- Created bbb.txt",
        "Please continue from the current workspace state and finish the original task.",
        "",
        "No response requested.",
      ].join("\n"),
    };
    const normalized = normalizeItem(item);
    expect(normalized.kind).toBe("message");
    if (normalized.kind === "message") {
      expect(normalized.text).toBe("创建已经完成。");
    }
  });

  it("strips structured Claude approval resume marker from assistant messages", () => {
    const item: ConversationItem = {
      id: "msg-assistant-approval-marker",
      kind: "message",
      role: "assistant",
      text: [
        "创建已经完成。",
        "",
        '<ccgui-approval-resume>[{"summary":"Approved and updated aaa.txt","path":"aaa.txt","kind":"modified","status":"completed"}]</ccgui-approval-resume>',
        "Please continue from the current workspace state and finish the original task.",
      ].join("\n"),
    };
    const normalized = normalizeItem(item);
    expect(normalized.kind).toBe("message");
    if (normalized.kind === "message") {
      expect(normalized.text).toBe("创建已经完成。");
    }
  });

  it("uses only [User Input] content for default thread title", () => {
    const source =
      "[System] [Session Spec Link] source=custom; status=visible; root=/tmp/spec. " +
      "[Spec Root Priority] Active external OpenSpec root: /tmp/spec. " +
      "When checking spec visibility, prioritize this root.\n" +
      "[User Input] 工作区代码做一下兼容性测试,在更新一下提案";
    expect(previewThreadName(source, "Agent 1")).toBe(
      "工作区代码做一下兼容性测试,在更新一下提案",
    );
  });

  it("uses current user request after shared-session sync wrapper for default thread title", () => {
    const source =
      "Shared session context sync. Continue from these recent turns before answering the new request:\n\n" +
      "Turn 1\nUser: hello\ncodex: world\n\n" +
      "Current user request:\n帮我梳理共享会话的上下文同步链路";
    expect(previewThreadName(source, "Agent 1")).toBe(
      "帮我梳理共享会话的上下文同步链路",
    );
  });

  it("truncates default thread title to 50 characters", () => {
    const longText = "a".repeat(60);
    expect(previewThreadName(longText, "Agent 1")).toBe("a".repeat(50));
  });

  it("uses the slash-command question for default thread title", () => {
    const source = [
      "<command-message>aimax:code-review</command-message>",
      "<command-name>/aimax:code-review</command-name>",
      "<command-args>审查PR428，并告诉我他解决了什么问题</command-args>",
    ].join("\n");
    expect(previewThreadName(source, "Agent 1")).toBe(
      "审查PR428，并告诉我他解决了什么问题",
    );
  });

  it("falls back to the command name for argument-less slash commands", () => {
    const source = [
      "<command-message>clear</command-message>",
      "<command-name>/clear</command-name>",
      "<command-args></command-args>",
    ].join("\n");
    expect(previewThreadName(source, "Agent 1")).toBe("clear");
  });

  it("filters out assistant placeholder messages after normalization", () => {
    const items: ConversationItem[] = [
      {
        id: "msg-assistant-empty-placeholder",
        kind: "message",
        role: "assistant",
        text: "(no content)",
      },
      {
        id: "reasoning-1",
        kind: "reasoning",
        summary: "思考中",
        content: "先确认需求。",
      },
    ];
    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expectReasoningItem(prepared[0]);
  });

  it("preserves an empty Shared assistant provenance anchor", () => {
    const anchor: ConversationItem = {
      id: "shared-provenance-anchor",
      kind: "message",
      role: "assistant",
      text: "",
      isFinal: true,
      engineSource: "codex",
      executionTargetSnapshot: {
        engine: "codex",
        providerProfileId: "provider-a",
        modelCatalogEntryId: "catalog-a",
        model: "runtime-a",
        reasoning: { effort: "high" },
        providerProfileNameSnapshot: "Provider A",
        providerProfileSource: "managed",
        runtimeCapabilityFingerprint: null,
      },
    };

    const prepared = prepareThreadItems([anchor]);
    expect(prepared).toHaveLength(1);
    expect(prepared[0]).toMatchObject(anchor);
  });

  it("preserves tool output for fileChange and commandExecution", () => {
    const output = "x".repeat(21000);
    const item: ConversationItem = {
      id: "tool-1",
      kind: "tool",
      toolType: "fileChange",
      title: "File changes",
      detail: "",
      output,
    };
    const normalized = normalizeItem(item);
    expect(normalized.kind).toBe("tool");
    if (normalized.kind === "tool") {
      expect(normalized.output).toBe(output);
    }
  });

  it("bounds oversized command output during history normalization", () => {
    const normalized = normalizeItem({
      id: "tool-large",
      kind: "tool",
      toolType: "commandExecution",
      title: "Command",
      detail: "",
      output: `head${"x".repeat(300 * 1024)}tail`,
    });
    expect(normalized.kind).toBe("tool");
    if (normalized.kind === "tool") {
      expect(normalized.output?.length ?? 0).toBeLessThanOrEqual(256 * 1024);
      expect(normalized.output).toMatch(/omitted \d+ chars/);
      expect(normalized.output?.startsWith("head")).toBe(true);
      expect(normalized.output?.endsWith("tail")).toBe(true);
    }
  });

  it("preserves long structured edit detail JSON", () => {
    const oldString = Array.from({ length: 180 }, (_, index) => `old-${index}`).join("\n");
    const newString = Array.from({ length: 180 }, (_, index) => `new-${index}`).join("\n");
    const detail = JSON.stringify({
      replace_all: false,
      file_path: "/Users/zhukunpeng/Desktop/codemoss/.github/workflows/release.yml",
      old_string: oldString,
      new_string: newString,
    });
    const item: ConversationItem = {
      id: "tool-edit-long-detail",
      kind: "tool",
      toolType: "Edit",
      title: "Tool: Edit",
      detail,
      status: "completed",
    };

    const normalized = normalizeItem(item);
    expect(normalized.kind).toBe("tool");
    if (normalized.kind === "tool") {
      expect(normalized.detail).toBe(detail);
      expect(normalized.detail.length).toBeGreaterThan(2000);
    }
  });

  it("preserves long structured read detail JSON", () => {
    const detail = JSON.stringify({
      file_path: "/Users/zhukunpeng/Desktop/codemoss/README.md",
      content: "x".repeat(5000),
      offset: 0,
      limit: 200,
    });
    const item: ConversationItem = {
      id: "tool-read-long-detail",
      kind: "tool",
      toolType: "Read",
      title: "Tool: Read",
      detail,
      status: "completed",
    };

    const normalized = normalizeItem(item);
    expect(normalized.kind).toBe("tool");
    if (normalized.kind === "tool") {
      expect(normalized.detail).toBe(detail);
      expect(normalized.detail.length).toBeGreaterThan(2000);
    }
  });

  it("still truncates long plain-text tool detail", () => {
    const detail = "plain-text-".repeat(500);
    const item: ConversationItem = {
      id: "tool-plain-long-detail",
      kind: "tool",
      toolType: "customTool",
      title: "Tool: customTool",
      detail,
      status: "completed",
    };

    const normalized = normalizeItem(item);
    expect(normalized.kind).toBe("tool");
    if (normalized.kind === "tool") {
      expect(normalized.detail).not.toBe(detail);
      expect(normalized.detail.endsWith("...")).toBe(true);
      expect(normalized.detail.length).toBeLessThan(detail.length);
    }
  });

  it("keeps recent tool output untruncated while truncating older entries", () => {
    const output = "y".repeat(21000);
    const items: ConversationItem[] = Array.from({ length: 41 }, (_, index) => ({
      id: `tool-${index}`,
      kind: "tool",
      toolType: "commandExecution",
      title: "Tool",
      detail: "",
      output,
    }));
    const prepared = prepareThreadItems(items);
    const firstOutput = expectToolItem(prepared[0]).output;
    const recentFullOutput = expectToolItem(prepared[35]).output;
    const latestFullOutput = expectToolItem(prepared[40]).output;
    expect(firstOutput).not.toBe(output);
    expect(firstOutput?.endsWith("...")).toBe(true);
    expect(recentFullOutput).toBe(output);
    expect(latestFullOutput).toBe(output);
  });

  it("drops assistant review summaries that duplicate completed review items", () => {
    const items: ConversationItem[] = [
      {
        id: "review-1",
        kind: "review",
        state: "completed",
        text: "Review summary",
      },
      {
        id: "msg-1",
        kind: "message",
        role: "assistant",
        text: "Review summary",
      },
    ];
    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expectReviewItem(prepared[0]);
  });

  it("summarizes explored reads and hides raw commands", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: cat src/foo.ts",
        detail: "",
        status: "completed",
        output: "",
      },
      {
        id: "cmd-2",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: sed -n '1,10p' src/bar.ts",
        detail: "",
        status: "completed",
        output: "",
      },
      {
        id: "msg-1",
        kind: "message",
        role: "assistant",
        text: "Done reading",
      },
    ];

    const prepared = prepareThreadItems(items);
    const explore = expectExploreItem(prepared[0]);
    expect(explore.entries).toHaveLength(2);
    expect(explore.entries[0]?.kind).toBe("read");
    expect(explore.entries[0]?.label).toContain("foo.ts");
    expect(explore.entries[1]?.kind).toBe("read");
    expect(explore.entries[1]?.label).toContain("bar.ts");
    expect(prepared.filter((item) => item.kind === "tool")).toHaveLength(0);
  });

  it("treats inProgress command status as exploring", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: rg RouterDestination src",
        detail: "",
        status: "inProgress",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    const explore = expectExploreItem(prepared[0]);
    expect(explore.status).toBe("exploring");
    expect(explore.entries[0]?.kind).toBe("search");
  });

  it("deduplicates explore entries when consecutive summaries merge", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: cat src/customPrompts.ts",
        detail: "",
        status: "completed",
        output: "",
      },
      {
        id: "cmd-2",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: cat src/customPrompts.ts",
        detail: "",
        status: "completed",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    const explore = expectExploreItem(prepared[0]);
    expect(explore.entries).toHaveLength(1);
    expect(explore.entries[0]?.label).toContain("customPrompts.ts");
  });

  it("coalesces duplicate message snapshots by id when preparing thread items", () => {
    const items: ConversationItem[] = [
      {
        id: "assistant-dup-1",
        kind: "message",
        role: "assistant",
        text: "你\n\n好\n\n!",
      },
      {
        id: "assistant-dup-1",
        kind: "message",
        role: "assistant",
        text: "你好！",
      },
    ];
    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    const message = expectMessageItem(prepared[0]);
    expect(message.id).toBe("assistant-dup-1");
    expect(message.text).toBe("你好！");
  });

  it("keeps reasoning item when it shares id with assistant message", () => {
    const items: ConversationItem[] = [
      {
        id: "shared-1",
        kind: "reasoning",
        summary: "思考中",
        content: "先检查上下文",
      },
      {
        id: "shared-1",
        kind: "message",
        role: "assistant",
        text: "我先检查一下上下文。",
      },
    ];
    const prepared = prepareThreadItems(items);
    const reasoning = prepared.find((entry) => entry.kind === "reasoning");
    const message = prepared.find(
      (entry) => entry.kind === "message" && entry.role === "assistant",
    );
    expect(reasoning).toBeDefined();
    expect(message).toBeDefined();
  });

  it("maps plan and planImplementation items into timeline tool entries", () => {
    const proposed = buildConversationItem({
      id: "plan-1",
      type: "plan",
      actionId: "implement-plan:turn-1",
      steps: [
        { step: "Inspect codebase", status: "in_progress" },
        { step: "Draft patch", status: "pending" },
      ],
    });
    expect(proposed).toEqual({
      id: "plan-1",
      kind: "tool",
      toolType: "proposed-plan",
      title: "Proposed Plan",
      detail: "implement-plan:turn-1",
      status: "",
      output: "- [in_progress] Inspect codebase\n- [pending] Draft patch",
    });

    const implementation = buildConversationItem({
      id: "plan-impl-1",
      type: "planImplementation",
      text: "Apply patch and verify",
    });
    expect(implementation).toEqual({
      id: "plan-impl-1",
      kind: "tool",
      toolType: "plan-implementation",
      title: "Plan Implementation",
      detail: "",
      status: "",
      output: "Apply patch and verify",
    });
  });

  it("extracts implement-plan action id from nested action payload", () => {
    const proposed = buildConversationItem({
      id: "plan-2",
      type: "plan",
      action: { id: "implement-plan:turn-2" },
      steps: [{ step: "Run tests", status: "pending" }],
    });
    expect(proposed).toEqual({
      id: "plan-2",
      kind: "tool",
      toolType: "proposed-plan",
      title: "Proposed Plan",
      detail: "implement-plan:turn-2",
      status: "",
      output: "- [pending] Run tests",
    });
  });

  it("preserves distinct read paths that share the same basename", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: cat src/foo/index.ts",
        detail: "",
        status: "completed",
        output: "",
      },
      {
        id: "cmd-2",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: cat tests/foo/index.ts",
        detail: "",
        status: "completed",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    const explore = expectExploreItem(prepared[0]);
    expect(explore.entries).toHaveLength(2);
    const details = explore.entries.map((entry) => entry.detail ?? entry.label);
    expect(details).toContain("src/foo/index.ts");
    expect(details).toContain("tests/foo/index.ts");
  });

  it("preserves multi-path read commands instead of collapsing to the last path", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: cat src/a.ts src/b.ts",
        detail: "",
        status: "completed",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    const explore = expectExploreItem(prepared[0]);
    expect(explore.entries).toHaveLength(2);
    const details = explore.entries.map((entry) => entry.detail ?? entry.label);
    expect(details).toContain("src/a.ts");
    expect(details).toContain("src/b.ts");
  });

  it("keeps existing tool detail when completed payload omits arguments", () => {
    const existing: ConversationItem = {
      id: "tool-1",
      kind: "tool",
      toolType: "mcpToolCall",
      title: "Tool: claude / read",
      detail: JSON.stringify({ file_path: "src/index.js" }),
      status: "started",
      output: "",
    };
    const completed: ConversationItem = {
      id: "tool-1",
      kind: "tool",
      toolType: "mcpToolCall",
      title: "Tool: claude / read",
      detail: "",
      status: "completed",
      output: "ok",
    };

    const merged = upsertItem([existing], completed);
    expect(merged).toHaveLength(1);
    const mergedTool = expectToolItem(merged[0]);
    expect(mergedTool.detail).toContain("src/index.js");
    expect(mergedTool.status).toBe("completed");
    expect(mergedTool.output).toBe("ok");
  });

  it("upserts by id+kind and preserves entries with same id across kinds", () => {
    const existingAssistant: ConversationItem = {
      id: "shared-1",
      kind: "message",
      role: "assistant",
      text: "assistant",
    };
    const incomingReasoning: ConversationItem = {
      id: "shared-1",
      kind: "reasoning",
      summary: "",
      content: "thinking",
    };

    const merged = upsertItem([existingAssistant], incomingReasoning);
    expect(merged).toHaveLength(2);
    expect(
      merged.some((item) => item.kind === "message" && item.id === "shared-1"),
    ).toBe(true);
    expect(
      merged.some((item) => item.kind === "reasoning" && item.id === "shared-1"),
    ).toBe(true);
  });

  it("inserts multi-agent hist-fold right after its user even when later turns exist", () => {
    const collabUser: ConversationItem = {
      id: "squad:run-1:user",
      kind: "message",
      role: "user",
      text: "帮我更新一下文档",
    };
    const laterUser: ConversationItem = {
      id: "u-later",
      kind: "message",
      role: "user",
      text: "1+1",
    };
    const laterAssistant: ConversationItem = {
      id: "a-later",
      kind: "message",
      role: "assistant",
      text: "2",
    };
    const fold: ConversationItem = {
      id: "agent:run-1:hist-fold",
      kind: "message",
      role: "assistant",
      text: "fold anchor",
    };
    const next = upsertItem([collabUser, laterUser, laterAssistant], fold);
    expect(next.map((item) => item.id)).toEqual([
      "squad:run-1:user",
      "agent:run-1:hist-fold",
      "u-later",
      "a-later",
    ]);
  });

  it("relocates existing multi-agent hist-fold when re-upserted after later turns", () => {
    const collabUser: ConversationItem = {
      id: "squad:run-1:user",
      kind: "message",
      role: "user",
      text: "帮我更新一下文档",
    };
    const laterUser: ConversationItem = {
      id: "u-later",
      kind: "message",
      role: "user",
      text: "1+1",
    };
    const fold: ConversationItem = {
      id: "agent:run-1:hist-fold",
      kind: "message",
      role: "assistant",
      text: "old",
    };
    const list = [collabUser, laterUser, fold];
    const next = upsertItem(list, {
      ...fold,
      text: "updated",
    });
    expect(next.map((item) => item.id)).toEqual([
      "squad:run-1:user",
      "agent:run-1:hist-fold",
      "u-later",
    ]);
    expect(
      (next[1] as Extract<ConversationItem, { kind: "message" }>).text,
    ).toBe("updated");
  });

  it("inserts late tools before trailing final assistant conclusion (not after)", () => {
    const user: ConversationItem = {
      id: "user-1",
      kind: "message",
      role: "user",
      text: "查一下再总结",
    };
    const conclusion: ConversationItem = {
      id: "assistant-1",
      kind: "message",
      role: "assistant",
      text: "方案 A：改动最小。",
      isFinal: true,
    };
    const lateTool: ConversationItem = {
      id: "tool-read-1",
      kind: "tool",
      toolType: "mcpToolCall",
      title: "Read proposal.md",
      detail: "",
      status: "completed",
      output: "...",
    };

    const next = upsertItem([user, conclusion], lateTool);
    expect(next.map((item) => item.id)).toEqual([
      "user-1",
      "tool-read-1",
      "assistant-1",
    ]);
  });

  it("does not pull mid-stream tools before a non-final preamble", () => {
    const list: ConversationItem[] = [
      {
        id: "user-1",
        kind: "message",
        role: "user",
        text: "go",
      },
      {
        id: "assistant-1",
        kind: "message",
        role: "assistant",
        text: "我先读文件。",
        isFinal: false,
      },
    ];
    const midTool: ConversationItem = {
      id: "tool-1",
      kind: "tool",
      toolType: "mcpToolCall",
      title: "Read",
      detail: "",
      status: "in_progress",
    };
    const next = upsertItem(list, midTool);
    expect(next.map((item) => item.id)).toEqual([
      "user-1",
      "assistant-1",
      "tool-1",
    ]);
  });

  it("inserts late tools before trailing final assistant (+ reasoning) block", () => {
    const list: ConversationItem[] = [
      {
        id: "user-1",
        kind: "message",
        role: "user",
        text: "go",
      },
      {
        id: "assistant-1",
        kind: "message",
        role: "assistant",
        text: "结论在工具后才对",
        isFinal: true,
      },
      {
        id: "reasoning-1",
        kind: "reasoning",
        summary: "",
        content: "think",
      },
    ];
    const lateTool: ConversationItem = {
      id: "tool-1",
      kind: "tool",
      toolType: "commandExecution",
      title: "Read",
      detail: "",
      status: "in_progress",
    };
    const next = upsertItem(list, lateTool);
    expect(next.map((item) => item.kind)).toEqual([
      "message",
      "tool",
      "message",
      "reasoning",
    ]);
    expect(next[1]?.id).toBe("tool-1");
  });

  it("keeps in-place tool updates and does not move existing tools", () => {
    const list: ConversationItem[] = [
      {
        id: "user-1",
        kind: "message",
        role: "user",
        text: "q",
      },
      {
        id: "tool-1",
        kind: "tool",
        toolType: "mcpToolCall",
        title: "Read",
        detail: "a.ts",
        status: "in_progress",
      },
      {
        id: "assistant-1",
        kind: "message",
        role: "assistant",
        text: "done",
      },
    ];
    const completed: ConversationItem = {
      id: "tool-1",
      kind: "tool",
      toolType: "mcpToolCall",
      title: "Read",
      detail: "a.ts",
      status: "completed",
      output: "ok",
    };
    const next = upsertItem(list, completed);
    expect(next.map((item) => item.id)).toEqual([
      "user-1",
      "tool-1",
      "assistant-1",
    ]);
    expect((next[1] as Extract<ConversationItem, { kind: "tool" }>).status).toBe(
      "completed",
    );
  });

  it("appends tools when there is no trailing assistant", () => {
    const list: ConversationItem[] = [
      {
        id: "user-1",
        kind: "message",
        role: "user",
        text: "q",
      },
    ];
    const tool: ConversationItem = {
      id: "tool-1",
      kind: "tool",
      toolType: "mcpToolCall",
      title: "Read",
      detail: "",
      status: "in_progress",
    };
    const next = upsertItem(list, tool);
    expect(next.map((item) => item.id)).toEqual(["user-1", "tool-1"]);
  });

  it("rebalances trailing tools before final assistants after late append", () => {
    const list: ConversationItem[] = [
      {
        id: "user-1",
        kind: "message",
        role: "user",
        text: "q",
      },
      {
        id: "assistant-1",
        kind: "message",
        role: "assistant",
        text: "长结论",
        isFinal: true,
      },
      {
        id: "tool-1",
        kind: "tool",
        toolType: "mcpToolCall",
        title: "Read a",
        detail: "",
        status: "completed",
      },
      {
        id: "tool-2",
        kind: "tool",
        toolType: "mcpToolCall",
        title: "Read b",
        detail: "",
        status: "completed",
      },
    ];
    const next = rebalanceTrailingToolsBeforeFinalAssistants(list);
    expect(next.map((item) => item.id)).toEqual([
      "user-1",
      "tool-1",
      "tool-2",
      "assistant-1",
    ]);
  });

  it("ignores glob patterns when summarizing rg --files commands", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: rg --files -g '*.ts' src",
        detail: "",
        status: "completed",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    const explore = expectExploreItem(prepared[0]);
    expect(explore.entries).toHaveLength(1);
    expect(explore.entries[0]?.kind).toBe("list");
    expect(explore.entries[0]?.label).toBe("src");
  });

  it("skips rg glob flag values and keeps the actual search path", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: rg myQuery -g '*.ts' src",
        detail: "",
        status: "completed",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    const explore = expectExploreItem(prepared[0]);
    expect(explore.entries).toHaveLength(1);
    expect(explore.entries[0]?.kind).toBe("search");
    expect(explore.entries[0]?.label).toBe("myQuery in src");
  });

  it("strips injected project-memory block from user message text", () => {
    const converted = buildConversationItem({
      id: "user-1",
      type: "userMessage",
      content: [
        {
          type: "text",
          text: `<project-memory source="project-memory" count="1" truncated="false">
[对话记录] 测试记忆
</project-memory>

你猜我会不会 go 语言`,
        },
      ],
    });

    expect(converted).toBeTruthy();
    expect(converted?.kind).toBe("message");
    if (converted?.kind === "message") {
      expect(converted.role).toBe("user");
      expect(converted.text).toBe("你猜我会不会 go 语言");
    }
  });

  it("strips injected project-memory block when rebuilding thread history", () => {
    const converted = buildConversationItemFromThreadItem({
      id: "user-2",
      type: "userMessage",
      content: [
        {
          type: "text",
          text: `<project-memory source="project-memory" count="2" truncated="false">
[项目上下文] xxx
[对话记录] yyy
</project-memory>
go lang`,
        },
      ],
    });

    expect(converted).toBeTruthy();
    expect(converted?.kind).toBe("message");
    if (converted?.kind === "message") {
      expect(converted.text).toBe("go lang");
    }
  });

  it("strips legacy injected memory lines even if project-memory xml tags are missing", () => {
    const converted = buildConversationItem({
      id: "user-legacy-memory-1",
      type: "userMessage",
      content: [
        {
          type: "text",
          text: `[对话记录] 用户输入：我今天从辽阳开车回沈阳了。中午12点半走的。和我老婆一起。 助手输出摘要：好的！从辽阳回沈阳，路程不远...

我和谁一起回沈阳的`,
        },
      ],
    });

    expect(converted).toBeTruthy();
    expect(converted?.kind).toBe("message");
    if (converted?.kind === "message") {
      expect(converted.role).toBe("user");
      expect(converted.text).toBe("我和谁一起回沈阳的");
    }
  });

  it("falls back to direct text when userMessage has no content array", () => {
    const converted = buildConversationItem({
      id: "user-direct-text-1",
      type: "userMessage",
      text: "这是 Claude 直出文本",
    });

    expect(converted).toBeTruthy();
    expect(converted?.kind).toBe("message");
    if (converted?.kind === "message") {
      expect(converted.role).toBe("user");
      expect(converted.text).toBe("这是 Claude 直出文本");
    }
  });

  it("extracts user request from shared-session wrapper in direct text fallback", () => {
    const converted = buildConversationItem({
      id: "user-direct-shared-wrapper-1",
      type: "userMessage",
      text:
        "Shared session context sync. Continue from these recent turns before answering the new request:\n\n" +
        "Turn 1\nUser: hi2\nclaude: done\n\nCurrent user request:\nhello2",
    });

    expect(converted).toBeTruthy();
    expect(converted?.kind).toBe("message");
    if (converted?.kind === "message") {
      expect(converted.role).toBe("user");
      expect(converted.text).toBe("hello2");
    }
  });

  it("detects fallback collaboration mode from direct text userMessage payload", () => {
    const converted = buildConversationItem({
      id: "user-direct-plan-mode-1",
      type: "userMessage",
      text:
        "Execution policy (plan mode): planning-only. If blocker appears, call requestUserInput.\n\n" +
        "User request: 只做方案输出",
    });

    expect(converted).toBeTruthy();
    expect(converted?.kind).toBe("message");
    if (converted?.kind === "message") {
      expect(converted.role).toBe("user");
      expect(converted.text).toBe("只做方案输出");
      expect(converted.collaborationMode).toBe("plan");
    }
  });

  it("unwraps unquoted /bin/zsh -lc rg commands", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: 'Command: /bin/zsh -lc rg -n "RouterDestination" src',
        detail: "",
        status: "completed",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    const explore = expectExploreItem(prepared[0]);
    expect(explore.entries).toHaveLength(1);
    expect(explore.entries[0]?.kind).toBe("search");
    expect(explore.entries[0]?.label).toBe("RouterDestination in src");
  });

  it("unwraps powershell -Command rg commands on windows", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-win-ps-1",
        kind: "tool",
        toolType: "commandExecution",
        title:
          'Command: C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoProfile -Command "rg -n RouterDestination src"',
        detail: "",
        status: "completed",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    const explore = expectExploreItem(prepared[0]);
    expect(explore.entries).toHaveLength(1);
    expect(explore.entries[0]?.kind).toBe("search");
    expect(explore.entries[0]?.label).toBe("RouterDestination in src");
  });

  it("unwraps cmd /c rg commands on windows", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-win-cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: 'Command: cmd /c "rg -n RouterDestination src"',
        detail: "",
        status: "completed",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    const explore = expectExploreItem(prepared[0]);
    expect(explore.entries).toHaveLength(1);
    expect(explore.entries[0]?.kind).toBe("search");
    expect(explore.entries[0]?.label).toBe("RouterDestination in src");
  });

  it("treats nl -ba as a read command", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: nl -ba src/foo.ts",
        detail: "",
        status: "completed",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    const explore = expectExploreItem(prepared[0]);
    expect(explore.entries).toHaveLength(1);
    expect(explore.entries[0]?.kind).toBe("read");
    expect(explore.entries[0]?.detail ?? explore.entries[0]?.label).toBe("src/foo.ts");
  });

  it("treats wc -l as a read command when a file path is present", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: wc -l src/foo.ts",
        detail: "",
        status: "completed",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    const explore = expectExploreItem(prepared[0]);
    expect(explore.entries).toHaveLength(1);
    expect(explore.entries[0]?.kind).toBe("read");
    expect(explore.entries[0]?.detail ?? explore.entries[0]?.label).toBe("src/foo.ts");
  });

  it("summarizes piped nl commands using the left-hand read", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: nl -ba src/foo.ts | sed -n '1,10p'",
        detail: "",
        status: "completed",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    const explore = expectExploreItem(prepared[0]);
    expect(explore.entries).toHaveLength(1);
    expect(explore.entries[0]?.kind).toBe("read");
    expect(explore.entries[0]?.detail ?? explore.entries[0]?.label).toBe("src/foo.ts");
  });

  it("does not trim pipes that appear inside quoted arguments", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: 'Command: rg "foo | bar" src',
        detail: "",
        status: "completed",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    const explore = expectExploreItem(prepared[0]);
    expect(explore.entries).toHaveLength(1);
    expect(explore.entries[0]?.kind).toBe("search");
    expect(explore.entries[0]?.label).toBe("foo | bar in src");
  });

  it("keeps raw commands when they are not recognized", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: git status",
        detail: "",
        status: "completed",
        output: "",
      },
    ];
    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expectToolItem(prepared[0]);
  });

  it("keeps raw commands when they fail", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: cat src/foo.ts",
        detail: "",
        status: "failed",
        output: "No such file",
      },
    ];
    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expectToolItem(prepared[0]);
  });

  it("builds file change items with summary details", () => {
    const item = buildConversationItem({
      type: "fileChange",
      id: "change-1",
      status: "done",
      changes: [
        {
          path: "foo.txt",
          kind: "add",
          diff: "diff --git a/foo.txt b/foo.txt",
        },
      ],
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.title).toBe("File changes");
      expect(item.detail).toBe("A foo.txt");
      expect(item.output).toContain("diff --git a/foo.txt b/foo.txt");
      expect(item.changes?.[0]?.path).toBe("foo.txt");
    }
  });

  it("normalizes file change fallback fields from files payload", () => {
    const item = buildConversationItem({
      type: "fileChange",
      id: "change-2",
      status: "done",
      files: [
        {
          filePath: "src/App.tsx",
          status: "A",
          patch: "@@ -0,0 +1 @@\n+const x = 1;",
        },
      ],
      output: "fallback-diff",
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.detail).toBe("A src/App.tsx");
      expect(item.output).toContain("const x = 1");
      expect(item.changes?.[0]?.kind).toBe("add");
    }
  });

  it("infers file change path from input payload when changes are missing", () => {
    const item = buildConversationItem({
      type: "fileChange",
      id: "change-3",
      status: "started",
      input: {
        file_path: "src/features/messages/components/Messages.tsx",
        old_string: "before",
        new_string: "after",
      },
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.detail).toBe("M src/features/messages/components/Messages.tsx");
      expect(item.changes?.[0]?.path).toBe("src/features/messages/components/Messages.tsx");
      expect(item.changes?.[0]?.kind).toBe("modified");
      expect(item.changes?.[0]?.diff).toContain("@@ -1,1 +1,1 @@");
      expect(item.output).toContain("-before");
      expect(item.output).toContain("+after");
    }
  });

  it("backfills file change diff from structured input when change entries only include the path", () => {
    const item = buildConversationItem({
      type: "fileChange",
      id: "change-structured-fallback-1",
      status: "completed",
      changes: [
        {
          path: "src/user/UserRequest.java",
          kind: "modified",
        },
      ],
      input: {
        file_path: "src/user/UserRequest.java",
        old_string: "String address,\nString email",
        new_string: "String address,\nString address2,\nString email",
      },
    });

    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.changes?.[0]?.diff).toContain("@@ -1,2 +1,3 @@");
      expect(item.changes?.[0]?.diff).toContain("+String address2,");
      expect(item.output).toContain("+String address2,");
    }
  });

  it("builds added file diffs from content-only payloads", () => {
    const item = buildConversationItem({
      type: "fileChange",
      id: "change-content-1",
      status: "completed",
      input: {
        file_path: "src/user/User.java",
        content: "public record User(String name) {}",
      },
    });

    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.detail).toBe("M src/user/User.java");
      expect(item.changes?.[0]?.diff).toContain("@@ -0,0 +1,1 @@");
      expect(item.changes?.[0]?.diff).toContain("+public record User(String name) {}");
      expect(item.output).toContain("+public record User(String name) {}");
    }
  });

  it("infers file list from apply_patch style input text", () => {
    const item = buildConversationItem({
      type: "fileChange",
      id: "change-4",
      status: "completed",
      input: {
        patch: [
          "*** Begin Patch",
          "*** Update File: src/a.ts",
          "@@",
          "*** Add File: src/new.ts",
          "*** End Patch",
        ].join("\n"),
      },
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.detail).toContain("M src/a.ts");
      expect(item.detail).toContain("A src/new.ts");
      expect(item.changes).toHaveLength(2);
    }
  });

  it("uses Move to target path for apply_patch rename entries", () => {
    const item = buildConversationItem({
      type: "fileChange",
      id: "change-move-to-1",
      status: "completed",
      input: {
        patch: [
          "*** Begin Patch",
          "*** Update File: src/old-name.ts",
          "*** Move to: src/new-name.ts",
          "@@ -1 +1 @@",
          "-const oldName = true;",
          "+const newName = true;",
          "*** End Patch",
        ].join("\n"),
      },
    });

    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.detail).toContain("R src/new-name.ts");
      expect(item.detail).not.toContain("src/old-name.ts");
      expect(item.changes?.[0]?.path).toBe("src/new-name.ts");
      expect(item.changes?.[0]?.kind).toBe("rename");
      expect(item.changes?.[0]?.diff).toContain("*** Move to: src/new-name.ts");
    }
  });

  it("infers file changes from output-only unified diff payloads", () => {
    const item = buildConversationItem({
      type: "fileChange",
      id: "change-output-only-1",
      status: "completed",
      output: [
        "diff --git a/src/main/java/com/example/OperationLog.java b/src/main/java/com/example/OperationLog.java",
        "--- a/src/main/java/com/example/OperationLog.java",
        "+++ b/src/main/java/com/example/OperationLog.java",
        "@@ -1,1 +1,2 @@",
        " public class OperationLog {}",
        "+// added line",
      ].join("\n"),
    });

    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.detail).toBe("M src/main/java/com/example/OperationLog.java");
      expect(item.changes?.[0]?.path).toBe("src/main/java/com/example/OperationLog.java");
      expect(item.changes?.[0]?.kind).toBe("modified");
      expect(item.output).toContain("+// added line");
    }
  });

  it("builds commandExecution items with structured detail payload", () => {
    const item = buildConversationItem({
      type: "commandExecution",
      id: "cmd-structured-1",
      command: ["git", "status", "--short"],
      description: "Show working tree status",
      cwd: "/repo",
      status: "completed",
      aggregatedOutput: "ok",
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.title).toBe("Command: Show working tree status");
      const parsed = JSON.parse(item.detail) as Record<string, string>;
      expect(parsed.command).toBe("git status --short");
      expect(parsed.description).toBe("Show working tree status");
      expect(parsed.cwd).toBe("/repo");
    }
  });

  it("keeps mcpToolCall output from output-like fallback fields", () => {
    const item = buildConversationItem({
      type: "mcpToolCall",
      id: "mcp-tool-1",
      server: "codex",
      tool: "exec_command",
      arguments: { cmd: "pwd" },
      status: "completed",
      output: "/repo\n",
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.toolType).toBe("mcpToolCall");
      expect(item.output).toContain("/repo");
    }
  });

  it("converts codex imagegen mcpToolCall into generated image artifact", () => {
    const item = buildConversationItem({
      type: "mcpToolCall",
      id: "imagegen-tool-1",
      server: "codex",
      tool: "imagegen",
      arguments: {
        prompt: "主播写真，直播间氛围",
      },
      status: "completed",
      output: "/Users/demo/.codex/generated_images/ig_demo.png",
    });

    const generatedImage = expectGeneratedImageItem(item ?? undefined);
    expect(generatedImage.status).toBe("completed");
    expect(generatedImage.promptText).toContain("主播写真");
    expect(generatedImage.images[0]?.localPath).toBe(
      "/Users/demo/.codex/generated_images/ig_demo.png",
    );
  });

  it("converts native image_generation_end payload with call_id fallback into generated image artifact", () => {
    const item = buildConversationItemFromThreadItem({
      type: "image_generation_end",
      call_id: "imagegen-native-1",
      status: "completed",
      revised_prompt: "国风书生夜读插画",
      saved_path: "/Users/demo/.codex/generated_images/ig_native.png",
    });

    const generatedImage = expectGeneratedImageItem(item ?? undefined);
    expect(generatedImage.id).toBe("imagegen-native-1");
    expect(generatedImage.status).toBe("completed");
    expect(generatedImage.promptText).toContain("国风书生");
    expect(generatedImage.images[0]?.localPath).toBe(
      "/Users/demo/.codex/generated_images/ig_native.png",
    );
  });

  it("anchors generated image artifacts to the latest user message", () => {
    const items: ConversationItem[] = [
      {
        id: "user-image-1",
        kind: "message",
        role: "user",
        text: "给我生成一张图",
      },
      {
        id: "generated-image-1",
        kind: "generatedImage",
        status: "processing",
        promptText: "一张图",
        images: [],
      },
    ];

    const prepared = prepareThreadItems(items);
    const generatedImage = expectGeneratedImageItem(prepared[1]);
    expect(generatedImage.anchorUserMessageId).toBe("user-image-1");
  });

  it("keeps described commandExecution items as command tools during exploration summarization", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-described-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: 列出工作区根目录内容",
        detail: JSON.stringify({
          command: "ls -la /workspace",
          description: "列出工作区根目录内容",
        }),
        status: "completed",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    const tool = expectToolItem(prepared[0]);
    expect(tool.toolType).toBe("commandExecution");
    expect(tool.title).toBe("Command: 列出工作区根目录内容");
  });

  it("falls back to description when commandExecution command is missing", () => {
    const item = buildConversationItem({
      type: "commandExecution",
      id: "cmd-structured-2",
      description: "Commit staged changes",
      cwd: "/repo",
      status: "completed",
      aggregatedOutput: "done",
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.title).toBe("Command: Commit staged changes");
      const parsed = JSON.parse(item.detail) as Record<string, string>;
      expect(parsed.description).toBe("Commit staged changes");
      expect(parsed.cwd).toBe("/repo");
    }
  });

  it("uses commandExecution output fallback fields when aggregatedOutput is absent", () => {
    const item = buildConversationItem({
      type: "commandExecution",
      id: "cmd-structured-3",
      description: "Run fallback output",
      output: "stdout-line",
      status: "completed",
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.output).toBe("stdout-line");
    }
  });

  it("stringifies commandExecution structured result payloads", () => {
    const item = buildConversationItem({
      type: "commandExecution",
      id: "cmd-structured-4",
      description: "Run structured output",
      result: {
        stdout: "ok",
        exitCode: 0,
      },
      status: "completed",
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.output).toContain("\"stdout\": \"ok\"");
      expect(item.output).toContain("\"exitCode\": 0");
    }
  });

  it("converts successful apply_patch commandExecution to fileChange", () => {
    const item = buildConversationItem({
      type: "commandExecution",
      id: "cmd-apply-patch-1",
      cmd:
        "cat > /tmp/changelog_patch.diff <<'PATCH'\n" +
        "*** Begin Patch\n" +
        "*** Update File: CHANGELOG.md\n" +
        "@@ -1,1 +1,2 @@\n" +
        " old-line\n" +
        "+new-line\n" +
        "*** End Patch\n" +
        "PATCH\n" +
        "apply_patch < /tmp/changelog_patch.diff",
      status: "completed",
      aggregatedOutput: "Success. Updated the following files:\nM CHANGELOG.md",
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.toolType).toBe("fileChange");
      expect(item.title).toBe("File changes");
      expect(item.detail).toContain("CHANGELOG.md");
      expect(item.changes?.[0]?.path).toBe("CHANGELOG.md");
      expect(item.changes?.[0]?.kind).toBe("modified");
      expect(item.changes?.[0]?.diff).toContain("+new-line");
    }
  });

  it("keeps apply_patch commandExecution as command tool when execution fails", () => {
    const item = buildConversationItem({
      type: "commandExecution",
      id: "cmd-apply-patch-failed-1",
      cmd: "apply_patch < /tmp/changelog_patch.diff",
      status: "failed",
      aggregatedOutput: "error: malformed patch",
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.toolType).toBe("commandExecution");
      expect(item.title).toBe("Command: apply_patch < /tmp/changelog_patch.diff");
    }
  });

  it("does not convert commandExecution when patch text exists but apply_patch is not executed", () => {
    const item = buildConversationItem({
      type: "commandExecution",
      id: "cmd-patch-text-only-1",
      cmd:
        "cat > /tmp/changelog_patch.diff <<'PATCH'\n" +
        "*** Begin Patch\n" +
        "*** Update File: CHANGELOG.md\n" +
        "@@ -1,1 +1,2 @@\n" +
        " old-line\n" +
        "+new-line\n" +
        "*** End Patch\n" +
        "PATCH",
      status: "completed",
      aggregatedOutput: "",
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.toolType).toBe("commandExecution");
    }
  });

  it("converts successful shell heredoc writes to fileChange", () => {
    const item = buildConversationItem({
      type: "commandExecution",
      id: "cmd-heredoc-write-1",
      cmd:
        "cat > /Users/demo/repo/src/main/java/com/example/demo/logging/LogEvent.java <<'EOF'\n" +
        "package com.example.demo.logging;\n" +
        "public enum LogEvent { CREATED }\n" +
        "EOF\n" +
        "echo wrote LogEvent.java",
      status: "completed",
      aggregatedOutput: "wrote LogEvent.java",
    });

    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.toolType).toBe("fileChange");
      expect(item.title).toBe("File changes");
      expect(item.detail).toContain(
        "/Users/demo/repo/src/main/java/com/example/demo/logging/LogEvent.java",
      );
      expect(item.changes).toEqual([
        expect.objectContaining({
          path: "/Users/demo/repo/src/main/java/com/example/demo/logging/LogEvent.java",
          kind: "add",
        }),
      ]);
    }
  });

  it("keeps output capture commandExecution out of fileChange cards", () => {
    const item = buildConversationItem({
      type: "commandExecution",
      id: "cmd-output-capture-1",
      cmd:
        "claude --help > claude_help.txt 2>&1; " +
        'grep -E "--append-system-prompt-file" claude_help.txt',
      status: "completed",
      aggregatedOutput: "--append-system-prompt-file <FILE>",
    });

    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.toolType).toBe("commandExecution");
      expect(item.title).toContain("claude --help");
      expect(item.changes).toBeUndefined();
    }
  });

  it("converts apply_patch commandExecution when status is missing but output has success marker", () => {
    const item = buildConversationItem({
      type: "commandExecution",
      id: "cmd-apply-patch-status-missing-1",
      cmd: "apply_patch < /tmp/changelog_patch.diff",
      aggregatedOutput: "Success. Updated the following files:\nM CHANGELOG.md",
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.toolType).toBe("fileChange");
      expect(item.changes?.[0]?.path).toBe("CHANGELOG.md");
    }
  });

  it("falls back to reasoning text when content is missing in streaming items", () => {
    const item = buildConversationItem({
      type: "reasoning",
      id: "reasoning-1",
      summary: "Planning unchecked tasks extraction",
      text: "I found the change folder and will extract unchecked tasks next.",
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "reasoning") {
      expect(item.summary).toBe("Planning unchecked tasks extraction");
      expect(item.content).toBe(
        "I found the change folder and will extract unchecked tasks next.",
      );
    }
  });

  it("drops empty reasoning snapshots in streaming items", () => {
    const item = buildConversationItem({
      type: "reasoning",
      id: "reasoning-empty-1",
      summary: "",
      content: "",
      text: "",
    });
    expect(item).toBeNull();
  });

  it("keeps encrypted-only reasoning snapshots in streaming items", () => {
    const item = buildConversationItem({
      type: "reasoning",
      id: "reasoning-encrypted-1",
      summary: "",
      content: "",
      encrypted_content: "gAAAAA-encrypted-payload",
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "reasoning") {
      expect(item.summary).toBe("Encrypted reasoning");
      expect(item.content).toBe("");
    }
  });

  it("falls back to reasoning text when content is missing in thread history items", () => {
    const item = buildConversationItemFromThreadItem({
      type: "reasoning",
      id: "reasoning-2",
      summary: "Checking event payload mapping",
      text: "I will verify item.completed payload fields before patching.",
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "reasoning") {
      expect(item.summary).toBe("Checking event payload mapping");
      expect(item.content).toBe(
        "I will verify item.completed payload fields before patching.",
      );
    }
  });

  it("drops empty reasoning snapshots in thread history items", () => {
    const item = buildConversationItemFromThreadItem({
      type: "reasoning",
      id: "reasoning-empty-2",
      summary: "",
      content: "",
      text: "",
    });
    expect(item).toBeNull();
  });

  it("keeps encrypted-only reasoning snapshots in thread history items", () => {
    const item = buildConversationItemFromThreadItem({
      type: "reasoning",
      id: "reasoning-encrypted-2",
      summary: "",
      content: "",
      encrypted_content: "gAAAAA-encrypted-history",
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "reasoning") {
      expect(item.summary).toBe("Encrypted reasoning");
      expect(item.content).toBe("");
    }
  });

  it("extracts reasoning text from structured content objects", () => {
    const item = buildConversationItem({
      type: "reasoning",
      id: "reasoning-structured-1",
      summary: [{ text: "Inspecting risk points" }],
      content: [
        { type: "reasoning_text", text: "First, I will scan high-risk modules." },
        { value: "Then I will validate edge cases and error paths." },
      ],
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "reasoning") {
      expect(item.summary).toContain("Inspecting risk points");
      expect(item.content).toContain("First, I will scan high-risk modules.");
      expect(item.content).toContain("Then I will validate edge cases and error paths.");
    }
  });

  it("joins tokenized reasoning fragments without forced newlines", () => {
    const item = buildConversationItem({
      type: "reasoning",
      id: "reasoning-tokenized-1",
      summary: [{ text: "回忆记忆模块" }],
      content: ["好", "的，我来帮你回", "忆一下记", "忆模块的分", "析。"],
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "reasoning") {
      expect(item.content).toBe("好的，我来帮你回忆一下记忆模块的分析。");
      expect(item.content).not.toContain("\n");
    }
  });

  it("collapses duplicated reasoning snapshots when rebuilding items from thread history", () => {
    const items = buildItemsFromThread({
      turns: [
        {
          items: [
            {
              type: "userMessage",
              id: "user-1",
              content: [{ type: "input_text", text: "分析项目" }],
            },
            {
              type: "reasoning",
              id: "reasoning-history-1",
              summary: "项目分析中...",
              content: "先检查项目目录结构和入口模块。",
            },
            {
              type: "reasoning",
              id: "reasoning-history-2",
              summary: "项目分析中...",
              content: "先检查项目目录结构和入口模块，然后确认核心路由。",
            },
            {
              type: "reasoning",
              id: "reasoning-history-3",
              summary: "项目分析中...",
              content: "先检查项目目录结构和入口模块，然后确认核心路由。",
            },
          ],
        },
      ],
    } as Record<string, unknown>);

    const reasoningItems = items.filter(
      (item): item is Extract<ConversationItem, { kind: "reasoning" }> =>
        item.kind === "reasoning",
    );
    expect(reasoningItems).toHaveLength(1);
    expect(reasoningItems[0]?.id).toBe("reasoning-history-1");
    expect(reasoningItems[0]?.content).toBe(
      "先检查项目目录结构和入口模块，然后确认核心路由。",
    );
  });

  it("merges thread items preferring richer local tool output", () => {
    const remote: ConversationItem = {
      id: "tool-2",
      kind: "tool",
      toolType: "webSearch",
      title: "Web search",
      detail: "query",
      status: "ok",
      output: "short",
    };
    const local: ConversationItem = {
      id: "tool-2",
      kind: "tool",
      toolType: "webSearch",
      title: "Web search",
      detail: "query",
      output: "much longer output",
    };
    const merged = mergeThreadItems([remote], [local]);
    expect(merged).toHaveLength(1);
    const tool = expectToolItem(merged[0]);
    expect(tool.output).toBe("much longer output");
    expect(tool.status).toBe("ok");
  });

  it("builds webSearch items with query detail and output payload", () => {
    const item = buildConversationItem({
      type: "webSearch",
      id: "web-search-1",
      status: "completed",
      search_query: [{ q: "openclaw github" }, { q: "openclaw security advisory" }],
      result: {
        items: [
          { title: "OpenClaw GitHub", url: "https://github.com/openclaw/openclaw" },
        ],
      },
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.toolType).toBe("webSearch");
      expect(item.status).toBe("completed");
      expect(item.detail).toContain("openclaw github");
      expect(item.output).toContain("OpenClaw GitHub");
      expect(item.output).toContain("https://github.com/openclaw/openclaw");
    }
  });

  it("prefers readable assistant message when remote snapshot is longer but duplicated", () => {
    const clean = "你好！我是你的 AI 联合架构师。有什么可以帮你的吗？";
    const remote: ConversationItem = {
      id: "assistant-merge-readable-1",
      kind: "message",
      role: "assistant",
      text: `${clean}\n\n${clean}\n\n${clean}`,
    };
    const local: ConversationItem = {
      id: "assistant-merge-readable-1",
      kind: "message",
      role: "assistant",
      text: clean,
    };

    const merged = mergeThreadItems([remote], [local]);
    expect(merged).toHaveLength(1);
    const message = expectMessageItem(merged[0]);
    expect(message.text).toBe(clean);
  });

  it("builds user message text from mixed inputs", () => {
    const item = buildConversationItemFromThreadItem({
      type: "userMessage",
      id: "msg-1",
      content: [
        { type: "text", text: "Please" },
        { type: "skill", name: "Review" },
        { type: "image", url: "https://example.com/image.png" },
      ],
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "message") {
      expect(item.role).toBe("user");
      expect(item.text).toBe("Please $Review");
      expect(item.images).toEqual(["https://example.com/image.png"]);
    }
  });

  it("derives selected agent metadata from explicit Agent Name line in prompt block", () => {
    const item = buildConversationItemFromThreadItem({
      type: "userMessage",
      id: "msg-agent-name-line-1",
      content: [
        {
          type: "text",
          text:
            "请继续优化。\n\n## Agent Role and Instructions\n\nAgent Name: 后端架构师\nAgent Icon: agent-robot-04\n\n你是一位资深后端架构师，擅长服务治理和高并发设计。",
        },
      ],
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "message") {
      expect(item.role).toBe("user");
      expect(item.selectedAgentName).toBe("后端架构师");
      expect(item.selectedAgentIcon).toBe("agent-robot-04");
    }
  });

  it("derives selected agent name from the first prompt clause when metadata is missing", () => {
    const item = buildConversationItemFromThreadItem({
      type: "userMessage",
      id: "msg-agent-clause-1",
      content: [
        {
          type: "text",
          text:
            "请继续优化。\n\n## Agent Role and Instructions\n\n你是一位资深的桌面软件架构师，专精于 Tauri v2 生态。",
        },
      ],
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "message") {
      expect(item.role).toBe("user");
      expect(item.selectedAgentName).toBe("你是一位资深的桌面软件架构师");
    }
  });

  it("preserves multiline structure when user text is split into multiple text inputs", () => {
    const item = buildConversationItemFromThreadItem({
      type: "userMessage",
      id: "msg-multiline-split-1",
      content: [
        { type: "text", text: "整理内容为：\n" },
        { type: "text", text: "1. 宏观观点\n2. 技术观点\n" },
        { type: "text", text: "\n3. 商品观点" },
      ],
    });

    expect(item).not.toBeNull();
    if (item && item.kind === "message") {
      expect(item.role).toBe("user");
      expect(item.text).toBe("整理内容为：\n1. 宏观观点\n2. 技术观点\n\n3. 商品观点");
    }
  });

  it("keeps a single separator before skill token without collapsing text structure", () => {
    const item = buildConversationItemFromThreadItem({
      type: "userMessage",
      id: "msg-skill-spacing-1",
      content: [
        { type: "text", text: "Please" },
        { type: "skill", name: "Review" },
        { type: "text", text: "\nline2" },
      ],
    });

    expect(item).not.toBeNull();
    if (item && item.kind === "message") {
      expect(item.role).toBe("user");
      expect(item.text).toBe("Please $Review\nline2");
    }
  });

  it("adds a separator after skill token when following text starts inline", () => {
    const item = buildConversationItemFromThreadItem({
      type: "userMessage",
      id: "msg-skill-inline-follow-1",
      content: [
        { type: "text", text: "Please" },
        { type: "skill", name: "Review" },
        { type: "text", text: "now" },
      ],
    });

    expect(item).not.toBeNull();
    if (item && item.kind === "message") {
      expect(item.role).toBe("user");
      expect(item.text).toBe("Please $Review now");
    }
  });

  it("preserves multiline [User Input] block when skill token and common/system prefixes coexist", () => {
    const rawInput = "你好\n我是陈湘宁!!";
    const item = buildConversationItemFromThreadItem({
      type: "userMessage",
      id: "msg-skill-common-user-input-1",
      content: [
        { type: "skill", name: "tr-zh-en-jp" },
        {
          type: "text",
          text:
            "[System] 你是 ccgui Agent。\n[Skill Prompt] tr-zh-en-jp\n[Commons Prompt] follow project rules\n[User Input] " +
            rawInput,
        },
      ],
    });

    expect(item).not.toBeNull();
    if (item && item.kind === "message") {
      expect(item.role).toBe("user");
      expect(item.text).toContain("$tr-zh-en-jp");
      expect(item.text).toContain("[Commons Prompt]");
      expect(item.text).toContain(`[User Input] ${rawInput}`);
    }
  });

  it("strips plan fallback directive prefix from user message content", () => {
    const item = buildConversationItemFromThreadItem({
      type: "userMessage",
      id: "msg-plan-fallback-1",
      content: [
        {
          type: "text",
          text:
            "Execution policy (plan mode): planning-only. If blocker appears, call requestUserInput.\n\nUser request: 只改前端，不改后端。",
        },
      ],
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "message") {
      expect(item.role).toBe("user");
      expect(item.text).toBe("只改前端，不改后端。");
      expect(item.collaborationMode).toBe("plan");
    }
  });

  it("extracts collaboration mode metadata from user message payload", () => {
    const item = buildConversationItemFromThreadItem({
      type: "userMessage",
      id: "msg-mode-meta-1",
      mode: "default",
      content: [{ type: "text", text: "保持默认模式" }],
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "message") {
      expect(item.role).toBe("user");
      expect(item.text).toBe("保持默认模式");
      expect(item.collaborationMode).toBe("code");
    }
  });

  it("strips shared-session sync wrapper from user message content", () => {
    const item = buildConversationItemFromThreadItem({
      type: "userMessage",
      id: "msg-shared-sync-wrapper-1",
      content: [
        {
          type: "text",
          text:
            "Shared session context sync. Continue from these recent turns before answering the new request:\n\n" +
            "Turn 1\nUser: 第一轮问题\ncodex: 第一轮回答\n\n" +
            "Current user request:\n请继续分析第3个问题",
        },
      ],
    });

    expect(item).not.toBeNull();
    if (item && item.kind === "message") {
      expect(item.role).toBe("user");
      expect(item.text).toBe("请继续分析第3个问题");
    }
  });

  it("keeps image-only user messages without placeholder text", () => {
    const item = buildConversationItemFromThreadItem({
      type: "userMessage",
      id: "msg-2",
      content: [{ type: "image", url: "https://example.com/only.png" }],
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "message") {
      expect(item.role).toBe("user");
      expect(item.text).toBe("");
      expect(item.images).toEqual(["https://example.com/only.png"]);
    }
  });

  it("formats collab tool calls with receivers and agent states", () => {
    const item = buildConversationItem({
      type: "collabToolCall",
      id: "collab-1",
      tool: "handoff",
      status: "ok",
      senderThreadId: "thread-a",
      receiverThreadIds: ["thread-b"],
      newThreadId: "thread-c",
      prompt: "Coordinate work",
      agentStatus: { "agent-1": { status: "running" } },
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.title).toBe("Collab: handoff");
      expect(item.detail).toContain("From thread-a");
      expect(item.detail).toContain("thread-b, thread-c");
      expect(item.output).toBe("Coordinate work\n\nagent-1: running");
      expect(item.senderThreadId).toBe("thread-a");
      expect(item.receiverThreadIds).toEqual(["thread-b", "thread-c"]);
      expect(item.agentStatus).toEqual({
        "agent-1": { status: "running" },
      });
    }
  });

  it("normalizes array-shaped collab agent states into a stable map", () => {
    const item = buildConversationItem({
      type: "collabToolCall",
      id: "collab-2",
      tool: "wait",
      status: "completed",
      receiverThreadIds: ["agent-2"],
      prompt: "Check progress",
      agentStatus: [{ id: "agent-2", status: "completed" }],
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.output).toBe("Check progress\n\nagent-2: completed");
      expect(item.agentStatus).toEqual({
        "agent-2": { status: "completed" },
      });
    }
  });

  it("extracts live collab receivers from targets and arguments (history parity)", () => {
    const fromTargets = buildConversationItem({
      type: "collabToolCall",
      id: "wait-targets-1",
      tool: "wait_agent",
      status: "running",
      targets: ["agent-current-1", "agent-current-2"],
    });
    expect(fromTargets).not.toBeNull();
    if (fromTargets && fromTargets.kind === "tool") {
      expect(fromTargets.receiverThreadIds).toEqual([
        "agent-current-1",
        "agent-current-2",
      ]);
      // tool call id must not become a receiver
      expect(fromTargets.receiverThreadIds).not.toContain("wait-targets-1");
    }

    const fromArgs = buildConversationItem({
      type: "collabToolCall",
      id: "wait-args-1",
      tool: "wait",
      status: "running",
      arguments: JSON.stringify({ ids: ["agent-9"] }),
    });
    expect(fromArgs).not.toBeNull();
    if (fromArgs && fromArgs.kind === "tool") {
      expect(fromArgs.receiverThreadIds).toEqual(["agent-9"]);
    }

    const fromDetailArrow = buildConversationItem({
      type: "collabToolCall",
      id: "wait-detail-1",
      tool: "wait",
      status: "running",
      detail: "From parent-root → agent-a, agent-b",
    });
    expect(fromDetailArrow).not.toBeNull();
    if (fromDetailArrow && fromDetailArrow.kind === "tool") {
      expect(fromDetailArrow.receiverThreadIds).toEqual(["agent-a", "agent-b"]);
    }
  });

  it("normalizes AskUserQuestion answer echo into submitted history card", () => {
    const items: ConversationItem[] = [
      {
        id: "ask-tool-1",
        kind: "tool",
        toolType: "askuserquestion",
        title: "Tool: askuserquestion",
        detail: JSON.stringify({
          questions: [
            {
              id: "q-0",
              header: "编程语言",
              question: "你最喜欢的编程语言是什么？",
              options: [
                { label: "Python", description: "简洁优雅" },
                { label: "TypeScript", description: "类型安全" },
              ],
            },
          ],
        }),
        status: "started",
      },
      {
        id: "user-answer-1",
        kind: "message",
        role: "user",
        text: "The user answered the AskUserQuestion: Python. Please continue based on this selection.",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(2);
    expect(prepared[0]).toMatchObject({
      id: "ask-tool-1",
      kind: "tool",
      status: "completed",
      output: "Python",
    });
    expect(prepared[1]).toMatchObject({
      id: "request-user-input-submitted-ask-tool-1",
      kind: "tool",
      toolType: "requestUserInputSubmitted",
      status: "completed",
      output: "Python",
    });
    if (prepared[1]?.kind === "tool") {
      const payload = JSON.parse(prepared[1].detail);
      expect(payload.schema).toBe("requestUserInputSubmitted/v1");
      expect(payload.questions[0].question).toBe("你最喜欢的编程语言是什么？");
      expect(payload.questions[0].selectedOptions).toEqual(["Python"]);
    }
  });

  it("normalizes skipped AskUserQuestion echo without preserving stale question text", () => {
    const items: ConversationItem[] = [
      {
        id: "ask-tool-skip-1",
        kind: "tool",
        toolType: "askuserquestion",
        title: "Tool: askuserquestion",
        detail: JSON.stringify({
          questions: [
            {
              id: "q-0",
              header: "协作期望",
              question: "你最需要我在哪些方面发力？",
            },
          ],
        }),
        status: "started",
      },
      {
        id: "user-skip-1",
        kind: "message",
        role: "user",
        text: "The user skipped this AskUserQuestion without selecting an option. Do not ask the same question again; continue the original task using the available context and reasonable assumptions.",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(2);
    expect(prepared[0]).toMatchObject({
      id: "ask-tool-skip-1",
      kind: "tool",
      status: "completed",
    });
    expect(prepared[1]).toMatchObject({
      id: "request-user-input-submitted-ask-tool-skip-1",
      kind: "tool",
      toolType: "requestUserInputSubmitted",
      status: "completed",
    });
    if (prepared[1]?.kind === "tool") {
      const payload = JSON.parse(prepared[1].detail);
      expect(payload.questions[0].selectedOptions).toEqual([]);
      expect(payload.questions[0].note).toBe("");
      expect(prepared[1].output).not.toContain("你最需要我在哪些方面发力");
    }
  });

  it("normalizes partial AskUserQuestion answer with skipped remaining questions", () => {
    const items: ConversationItem[] = [
      {
        id: "ask-tool-partial-skip-1",
        kind: "tool",
        toolType: "askuserquestion",
        title: "Tool: askuserquestion",
        detail: JSON.stringify({
          questions: [
            {
              id: "q-0",
              header: "交互风格",
              question: "你希望我以什么风格和你协作？",
              options: [
                { label: "直接给方案", description: "少废话，直接上代码和结论" },
                { label: "先讨论再动手", description: "先聊清楚思路，确认后再写代码" },
              ],
            },
            {
              id: "q-1",
              header: "语言偏好",
              question: "你希望我用什么语言表达？",
              options: [
                { label: "中英混合", description: "中文解释，保留技术术语" },
                { label: "纯中文", description: "尽量全部中文表达" },
              ],
            },
            {
              id: "q-2",
              header: "关注点",
              question: "你最关注什么？",
            },
          ],
        }),
        status: "started",
      },
      {
        id: "user-partial-skip-1",
        kind: "message",
        role: "user",
        text: "The user answered the AskUserQuestion: 直接给方案; 中英混合. The user skipped 1 remaining question(s) without selecting an option. Do not ask the skipped question(s) again; continue the original task using the available context and reasonable assumptions.",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(2);
    expect(prepared[0]).toMatchObject({
      id: "ask-tool-partial-skip-1",
      kind: "tool",
      status: "completed",
      output: "直接给方案; 中英混合",
    });
    expect(prepared[1]).toMatchObject({
      id: "request-user-input-submitted-ask-tool-partial-skip-1",
      kind: "tool",
      toolType: "requestUserInputSubmitted",
      status: "completed",
      output: "直接给方案; 中英混合",
    });
    if (prepared[1]?.kind === "tool") {
      const payload = JSON.parse(prepared[1].detail);
      expect(payload.questions[0].selectedOptions).toEqual(["直接给方案"]);
      expect(payload.questions[1].selectedOptions).toEqual(["中英混合"]);
      expect(payload.questions[2].selectedOptions).toEqual([]);
    }
  });

  it("maps keyed partial AskUserQuestion answers to their original question ids", () => {
    const items: ConversationItem[] = [
      {
        id: "ask-tool-keyed-partial-skip-1",
        kind: "tool",
        toolType: "askuserquestion",
        title: "Tool: askuserquestion",
        detail: JSON.stringify({
          questions: [
            {
              id: "language",
              header: "语言偏好",
              question: "你平时主要用什么语言写后端？",
              options: [
                { label: "Java", description: "Spring Boot / Spring Cloud 生态" },
                { label: "Go", description: "Gin / gRPC / 云原生方向" },
              ],
            },
            {
              id: "style",
              header: "协作风格",
              question: "你希望我以什么风格和你协作？",
              options: [
                { label: "直接给方案", description: "少废话，直接上代码和结论" },
                { label: "先讨论再动手", description: "先聊清楚思路，确认后再写代码" },
              ],
            },
            {
              id: "focus",
              header: "关注点",
              question: "你最关注什么？",
            },
          ],
        }),
        status: "started",
      },
      {
        id: "user-keyed-partial-skip-1",
        kind: "message",
        role: "user",
        text: "The user answered the AskUserQuestion: style=直接给方案. The user skipped 1 remaining question(s) without selecting an option. Do not ask the skipped question(s) again; continue the original task using the available context and reasonable assumptions.",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(2);
    if (prepared[1]?.kind !== "tool") {
      throw new Error("expected submitted AskUserQuestion history card");
    }
    const payload = JSON.parse(prepared[1].detail);
    expect(payload.questions[0].selectedOptions).toEqual([]);
    expect(payload.questions[1].selectedOptions).toEqual(["直接给方案"]);
    expect(payload.questions[2].selectedOptions).toEqual([]);
    expect(prepared[1].output).toBe("直接给方案");
  });

  it("keeps equals signs in free-text AskUserQuestion answers as normal text", () => {
    const items: ConversationItem[] = [
      {
        id: "ask-tool-free-text-equals",
        kind: "tool",
        toolType: "askuserquestion",
        title: "Tool: askuserquestion",
        detail: JSON.stringify({
          questions: [
            {
              id: "note",
              header: "备注",
              question: "补充说明？",
            },
          ],
        }),
        status: "started",
      },
      {
        id: "user-free-text-equals",
        kind: "message",
        role: "user",
        text: "The user answered the AskUserQuestion: version=1.0. Please continue based on this selection.",
      },
    ];

    const prepared = prepareThreadItems(items);
    if (prepared[1]?.kind !== "tool") {
      throw new Error("expected submitted AskUserQuestion history card");
    }
    const payload = JSON.parse(prepared[1].detail);
    expect(payload.questions[0].selectedOptions).toEqual(["version=1.0"]);
    expect(prepared[1].output).toBe("version=1.0");
  });

  it("prefers structured AskUserQuestion result markers over text splitting", () => {
    const marker =
      "eyJhbnN3ZXJzIjp7InN0eWxlIjpbIuebtOaOpee7meaWueahiDsga2V5PXZhbHVlIl0sImxhbmd1YWdlIjpbIkphdmEiXX0sInNraXBwZWRRdWVzdGlvbklkcyI6WyJmb2N1cyJdfQ==";
    const items: ConversationItem[] = [
      {
        id: "ask-tool-structured-marker",
        kind: "tool",
        toolType: "askuserquestion",
        title: "Tool: askuserquestion",
        detail: JSON.stringify({
          questions: [
            {
              id: "style",
              header: "协作风格",
              question: "你希望我以什么风格和你协作？",
              options: [{ label: "直接给方案; key=value", description: "" }],
            },
            {
              id: "language",
              header: "语言偏好",
              question: "你平时主要用什么语言写后端？",
              options: [{ label: "Java", description: "" }],
            },
            {
              id: "focus",
              header: "关注点",
              question: "你最关注什么？",
            },
          ],
        }),
        status: "started",
      },
      {
        id: "user-structured-marker",
        kind: "message",
        role: "user",
        text: `The user answered the AskUserQuestion: style=直接给方案; key=value; language=Java. The user skipped 1 remaining question(s) without selecting an option. AskUserQuestionResultBase64:${marker}`,
      },
    ];

    const prepared = prepareThreadItems(items);
    if (prepared[1]?.kind !== "tool") {
      throw new Error("expected submitted AskUserQuestion history card");
    }
    const payload = JSON.parse(prepared[1].detail);
    expect(payload.questions[0].selectedOptions).toEqual(["直接给方案; key=value"]);
    expect(payload.questions[1].selectedOptions).toEqual(["Java"]);
    expect(payload.questions[2].selectedOptions).toEqual([]);
    expect(prepared[1].output).toBe("直接给方案; key=value; Java");
  });

  it("keeps previous AskUserQuestion answers attached to the original tool only", () => {
    const items: ConversationItem[] = [
      {
        id: "ask-tool-old",
        kind: "tool",
        toolType: "askuserquestion",
        title: "Tool: askuserquestion",
        detail: JSON.stringify({
          questions: [
            {
              id: "style",
              header: "协作风格",
              question: "你希望我以什么风格和你协作？",
              options: [{ label: "直接给方案", description: "" }],
            },
          ],
        }),
        status: "started",
      },
      {
        id: "user-answer-old",
        kind: "message",
        role: "user",
        text: "The user answered the AskUserQuestion: style=直接给方案. Please continue based on this selection.",
      },
      {
        id: "ask-tool-new",
        kind: "tool",
        toolType: "askuserquestion",
        title: "Tool: askuserquestion",
        detail: JSON.stringify({
          questions: [
            {
              id: "language",
              header: "语言偏好",
              question: "你平时主要用什么语言写后端？",
              options: [{ label: "Java", description: "" }],
            },
          ],
        }),
        status: "started",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared.map((item) => item.id)).toEqual([
      "ask-tool-old",
      "request-user-input-submitted-ask-tool-old",
      "ask-tool-new",
    ]);
    expect(prepared[2]).toMatchObject({
      id: "ask-tool-new",
      kind: "tool",
      status: "started",
    });
    if (prepared[1]?.kind !== "tool" || prepared[2]?.kind !== "tool") {
      throw new Error("expected AskUserQuestion tool history items");
    }
    const payload = JSON.parse(prepared[1].detail);
    expect(payload.questions[0].id).toBe("style");
    expect(payload.questions[0].selectedOptions).toEqual(["直接给方案"]);
    expect(prepared[2].detail).toContain("language");
    expect(prepared[2].detail).not.toContain("直接给方案");
  });

  it("normalizes mcp askuserquestion answer echo into submitted history card", () => {
    const items: ConversationItem[] = [
      {
        id: "mcp-ask-1",
        kind: "tool",
        toolType: "mcpToolCall",
        title: "Tool: Claude / askuserquestion",
        detail: JSON.stringify({
          questions: [
            {
              id: "q-0",
              header: "框架",
              question: "偏好哪个框架？",
              options: [
                { label: "React", description: "生态完整" },
                { label: "Vue", description: "易上手" },
              ],
            },
          ],
        }),
        status: "running",
      },
      {
        id: "user-answer-2",
        kind: "message",
        role: "user",
        text: "The user answered the AskUserQuestion: React. Please continue based on this selection.",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(2);
    expect(prepared[0]).toMatchObject({
      id: "mcp-ask-1",
      kind: "tool",
      status: "completed",
      output: "React",
    });
    expect(prepared[1]).toMatchObject({
      id: "request-user-input-submitted-mcp-ask-1",
      kind: "tool",
      toolType: "requestUserInputSubmitted",
      status: "completed",
      output: "React",
    });
  });

  it("normalizes shared MCP AskUserQuestion _input/_output dump into submitted card", () => {
    const questions = [
      {
        id: "q-0",
        header: "实现方式",
        multiSelect: false,
        question: "实现方式选择哪一种？",
        options: [
          { label: "A 适配层", description: "改动小" },
          { label: "B 重写引擎", description: "成本高" },
        ],
      },
    ];
    const items: ConversationItem[] = [
      {
        id: "mcp-shared-ask-1",
        kind: "tool",
        toolType: "mcpToolCall",
        title: "Tool: mcp__ccgui__AskUserQuestion",
        detail: JSON.stringify({ questions }),
        status: "completed",
        output: JSON.stringify({
          _input: { questions },
          _output:
            "The user answered the AskUserQuestion: q-0=B 重写引擎. Please continue based on this selection.",
        }),
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expect(prepared[0]).toMatchObject({
      id: "request-user-input-submitted-mcp-shared-ask-1",
      kind: "tool",
      toolType: "requestUserInputSubmitted",
      status: "completed",
    });
    expect(prepared[0].kind === "tool" && prepared[0].detail).toContain("B 重写引擎");
    expect(prepared[0].kind === "tool" && prepared[0].detail).toContain(
      "requestUserInputSubmitted/v1",
    );
  });

  it("parses ISO timestamps for thread updates", () => {
    const timestamp = getThreadTimestamp({ updated_at: "2025-01-01T00:00:00Z" });
    expect(timestamp).toBe(Date.parse("2025-01-01T00:00:00Z"));
  });

  it("returns 0 for invalid thread timestamps", () => {
    const timestamp = getThreadTimestamp({ updated_at: "not-a-date" });
    expect(timestamp).toBe(0);
  });

});
