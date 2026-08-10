import { describe, expect, it } from "vitest";
import type { ConversationItem } from "../../../types/conversation";
import {
  filterMultiAgentCanvasItems,
  isMultiAgentSettledSummaryItemId,
  multiAgentHistFoldItemId,
  multiAgentUserItemId,
  parseMultiAgentUserRunId,
  relocateMultiAgentHistFolds,
  resolveMultiAgentHistFoldInsertIndex,
} from "./canvasItems";
import {
  buildCollabBriefingSendText,
  stripCollabInternalPrompt,
} from "./collabPrompt";

function user(
  id: string,
  text: string,
  images?: string[],
): ConversationItem {
  return {
    id,
    kind: "message",
    role: "user",
    text,
    ...(images && images.length > 0 ? { images } : {}),
  };
}

function assistant(id: string, text: string): ConversationItem {
  return { id, kind: "message", role: "assistant", text };
}

describe("multiAgent canvas item identity", () => {
  it("uses durable squad user id and agent hist-fold id", () => {
    expect(multiAgentUserItemId("run-1")).toBe("squad:run-1:user");
    expect(multiAgentHistFoldItemId("run-1")).toBe("agent:run-1:hist-fold");
  });

  it("parses user run id from squad and legacy agent ids", () => {
    expect(parseMultiAgentUserRunId("squad:run-1:user")).toBe("run-1");
    expect(parseMultiAgentUserRunId("agent:run-1:user")).toBe("run-1");
    expect(parseMultiAgentUserRunId("ordinary-user")).toBeNull();
  });

  it("detects durable settle summary bubbles", () => {
    expect(isMultiAgentSettledSummaryItemId("squad:run-1:assistant")).toBe(
      true,
    );
    expect(isMultiAgentSettledSummaryItemId("agent:run-1:assistant")).toBe(
      true,
    );
    expect(
      isMultiAgentSettledSummaryItemId("agent:run-1:assistant-cancel"),
    ).toBe(false);
    expect(isMultiAgentSettledSummaryItemId("agent:run-1:hist-fold")).toBe(
      false,
    );
  });
});

describe("filterMultiAgentCanvasItems", () => {
  it("keeps deferred-image-only user messages renderable", () => {
    const deferredImageOnly: ConversationItem = {
      id: "claude-deferred-image",
      kind: "message",
      role: "user",
      text: "",
      deferredImages: [{
        workspacePath: "/workspace",
        mediaType: "image/png",
        estimatedByteSize: 700_000,
        reason: "large-inline-image",
        locator: {
          sessionId: "session-1",
          lineIndex: 2,
          blockIndex: 1,
          mediaType: "image/png",
        },
      }],
    };

    expect(filterMultiAgentCanvasItems([deferredImageOnly])).toEqual([
      deferredImageOnly,
    ]);
  });

  it("drops settle summary assistant and keeps hist-fold", () => {
    const items: ConversationItem[] = [
      user("squad:run-1:user", "fix docs"),
      assistant("agent:run-1:hist-fold", "fold anchor"),
      assistant("squad:run-1:assistant", "final summary long text"),
    ];
    const filtered = filterMultiAgentCanvasItems(items);
    expect(filtered.map((item) => item.id)).toEqual([
      "squad:run-1:user",
      "agent:run-1:hist-fold",
    ]);
  });

  it("dedupes dual-track user bubbles preferring squad id", () => {
    const items: ConversationItem[] = [
      user("agent:run-1:user", "fix docs"),
      assistant("agent:run-1:hist-fold", "fold"),
      user("squad:run-1:user", "fix docs"),
      assistant("squad:run-1:assistant", "summary"),
    ];
    const filtered = filterMultiAgentCanvasItems(items);
    // fold 纠偏到 squad user 之后
    expect(filtered.map((item) => item.id)).toEqual([
      "squad:run-1:user",
      "agent:run-1:hist-fold",
    ]);
  });

  it("keeps multiple rounds with the same request text (no cross-run user drop)", () => {
    const task = "@path/to/doc.md 更新一下这个文档";
    const items: ConversationItem[] = [
      user("squad:run-1:user", task),
      assistant("agent:run-1:hist-fold", "fold1"),
      assistant("a-status-1", "已取消"),
      user("squad:run-2:user", task),
      assistant("agent:run-2:hist-fold", "fold2"),
      user("squad:run-3:user", task),
      assistant("agent:run-3:hist-fold", "fold3"),
      user("squad:run-4:user", task),
      assistant("agent:run-4:hist-fold", "fold4"),
    ];
    const filtered = filterMultiAgentCanvasItems(items);
    expect(filtered.map((item) => item.id)).toEqual([
      "squad:run-1:user",
      "agent:run-1:hist-fold",
      "a-status-1",
      "squad:run-2:user",
      "agent:run-2:hist-fold",
      "squad:run-3:user",
      "agent:run-3:hist-fold",
      "squad:run-4:user",
      "agent:run-4:hist-fold",
    ]);
  });

  it("does not reverse fold order when relocating multiple folds", () => {
    const task = "同一任务";
    const items: ConversationItem[] = [
      user("squad:run-1:user", task),
      user("squad:run-2:user", task),
      // folds 错落在末尾且顺序 run2 在前
      assistant("agent:run-2:hist-fold", "fold2"),
      assistant("agent:run-1:hist-fold", "fold1"),
    ];
    const filtered = filterMultiAgentCanvasItems(items);
    expect(filtered.map((item) => item.id)).toEqual([
      "squad:run-1:user",
      "agent:run-1:hist-fold",
      "squad:run-2:user",
      "agent:run-2:hist-fold",
    ]);
  });

  it("keeps ordinary messages untouched", () => {
    const items: ConversationItem[] = [
      user("u-1", "1+1"),
      assistant("a-1", "2"),
    ];
    expect(filterMultiAgentCanvasItems(items)).toEqual(items);
  });

  it("relocates hist-fold to sit right after its user bubble", () => {
    const items: ConversationItem[] = [
      user("squad:run-1:user", "fix docs"),
      user("u-later", "1+1"),
      assistant("a-later", "2"),
      assistant("agent:run-1:hist-fold", "fold"),
    ];
    const filtered = filterMultiAgentCanvasItems(items);
    expect(filtered.map((item) => item.id)).toEqual([
      "squad:run-1:user",
      "agent:run-1:hist-fold",
      "u-later",
      "a-later",
    ]);
  });

  it("strips collab briefing prompt from user bubble and dedupes", () => {
    const dirty = buildCollabBriefingSendText({
      userText: "日志模块简单重构一下",
      flowLabel: "规划 → 实现 → 审查",
    });
    const items: ConversationItem[] = [
      user("squad:pending-1:user", "日志模块简单重构一下"),
      user("u-brief", dirty),
      assistant("a-brief", "任务理解：…"),
      user("squad:run-1:user", "日志模块简单重构一下"),
      assistant("agent:run-1:hist-fold", "fold"),
    ];
    const filtered = filterMultiAgentCanvasItems(items);
    const users = filtered.filter(
      (i) => i.kind === "message" && i.role === "user",
    );
    expect(users).toHaveLength(1);
    const only = users[0];
    expect(only?.kind === "message" && only.text).toBe(
      "日志模块简单重构一下",
    );
    expect(only?.id).toBe("squad:run-1:user");
  });

  it("hides collab summary request user bubbles", () => {
    const items: ConversationItem[] = [
      user("squad:run-1:user", "任务 A"),
      assistant("agent:run-1:hist-fold", "fold"),
      user(
        "u-sum",
        "[[mossx.collab.summary]]\n【协作调度 · 完成汇总】\n请写汇总\n用户原任务：\n任务 A",
      ),
      assistant("a-sum", "## 交付汇总\n…"),
    ];
    const filtered = filterMultiAgentCanvasItems(items);
    expect(
      filtered.filter((i) => i.kind === "message" && i.role === "user"),
    ).toHaveLength(1);
    expect(filtered.some((i) => i.id === "a-sum")).toBe(true);
  });

  it("drops pending when formal squad user exists (formal keeps its timeline seat)", () => {
    // pending 仅作即时上屏；正式 squad:run user 保留在自身时序位置（多轮同文案也安全）
    const items: ConversationItem[] = [
      user("squad:pending-9:user", "日志模块简单重构一下"),
      assistant("a-brief", "任务理解：…"),
      user("squad:run-1:user", "日志模块简单重构一下"),
    ];
    const filtered = filterMultiAgentCanvasItems(items);
    expect(filtered.map((item) => item.id)).toEqual([
      "a-brief",
      "squad:run-1:user",
    ]);
  });

  it("strips partial streaming marker without closing bracket", () => {
    // 流式增量：marker 尚未完整（缺 `】`）也不能把内部提示词露出幕布
    const items: ConversationItem[] = [
      user("u-partial", "日志模块简单重构一下\n\n---\n【协作调度 · 主幕"),
    ];
    const filtered = filterMultiAgentCanvasItems(items);
    expect(filtered).toHaveLength(1);
    const only = filtered[0];
    expect(only?.kind === "message" && only.text).toBe("日志模块简单重构一下");
  });

  it("hides summary request even with partial marker prefix", () => {
    const items: ConversationItem[] = [
      user("u-sum-partial", "[[mossx.collab.summary"),
    ];
    expect(filterMultiAgentCanvasItems(items)).toHaveLength(0);
  });

  it("keeps image-only user bubbles with empty text (cross-engine pure image send)", () => {
    // 回归：resolveCollapsedTimelineItems 对所有会话都先跑本 filter；
    // 旧逻辑把 empty text user 整段丢掉 → 纯图发送幕布空白。
    const items: ConversationItem[] = [
      user("optimistic-user-1", "", ["/tmp/shot.png"]),
      assistant("a-1", "图里是表格"),
    ];
    const filtered = filterMultiAgentCanvasItems(items);
    expect(filtered).toHaveLength(2);
    expect(filtered[0]).toEqual(
      expect.objectContaining({
        id: "optimistic-user-1",
        role: "user",
        text: "",
        images: ["/tmp/shot.png"],
      }),
    );
  });

  it("keeps two different image-only user turns without collapsing them", () => {
    const items: ConversationItem[] = [
      user("u-img-1", "", ["/tmp/a.png"]),
      assistant("a-1", "第一张"),
      user("u-img-2", "", ["/tmp/b.png"]),
      assistant("a-2", "第二张"),
    ];
    const filtered = filterMultiAgentCanvasItems(items);
    const users = filtered.filter(
      (item) => item.kind === "message" && item.role === "user",
    );
    expect(users).toHaveLength(2);
    expect(users.map((item) => item.id)).toEqual(["u-img-1", "u-img-2"]);
  });

  it("still hides pure collab-internal user bubbles without attachments", () => {
    const items: ConversationItem[] = [
      user(
        "u-internal",
        "[[mossx.collab.summary]]\n【协作调度 · 完成汇总】\n请写汇总",
      ),
    ];
    expect(filterMultiAgentCanvasItems(items)).toHaveLength(0);
  });
});

describe("stripCollabInternalPrompt", () => {
  it("keeps only user task text", () => {
    const dirty = buildCollabBriefingSendText({
      userText: "日志模块简单重构一下",
      flowLabel: "规划 → 实现 → 审查",
    });
    expect(stripCollabInternalPrompt(dirty)).toBe("日志模块简单重构一下");
  });
});

describe("resolveMultiAgentHistFoldInsertIndex", () => {
  it("inserts after squad user even when later turns exist", () => {
    const list: ConversationItem[] = [
      user("squad:run-1:user", "fix docs"),
      user("u-later", "1+1"),
      assistant("a-later", "2"),
    ];
    expect(
      resolveMultiAgentHistFoldInsertIndex(list, "agent:run-1:hist-fold"),
    ).toBe(1);
  });

  it("returns null when user is missing", () => {
    expect(
      resolveMultiAgentHistFoldInsertIndex(
        [user("u-1", "hi")],
        "agent:run-1:hist-fold",
      ),
    ).toBeNull();
  });
});

describe("relocateMultiAgentHistFolds", () => {
  it("moves fold before subsequent turns", () => {
    const items: ConversationItem[] = [
      user("squad:run-1:user", "fix docs"),
      user("u-later", "1+1"),
      assistant("agent:run-1:hist-fold", "fold"),
    ];
    expect(relocateMultiAgentHistFolds(items).map((i) => i.id)).toEqual([
      "squad:run-1:user",
      "agent:run-1:hist-fold",
      "u-later",
    ]);
  });
});
