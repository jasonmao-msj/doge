import { describe, expect, it } from "vitest";
import type { ConversationItem } from "../../../types/conversation";
import {
  MAIN_CANVAS_CONTEXT_PREFIX,
  buildMainCanvasDialogueLines,
  collabDisplayTitle,
  extractMainCanvasContextBody,
  injectMainCanvasContext,
  stripMainCanvasContextBlock,
} from "./mainCanvasContextInjection";
import { multiAgentHistFoldItemId } from "../utils/canvasItems";
import {
  buildCollabBriefingSendText,
  buildCollabSummarySendText,
} from "../utils/collabPrompt";

function msg(
  id: string,
  role: "user" | "assistant",
  text: string,
): ConversationItem {
  return { id, kind: "message", role, text };
}

describe("buildMainCanvasDialogueLines", () => {
  it("extracts user and assistant messages in order", () => {
    const lines = buildMainCanvasDialogueLines([
      msg("u1", "user", "背景：要重构日志"),
      msg("a1", "assistant", "可以，先定边界"),
      msg("u2", "user", "只动 src/log"),
    ]);
    expect(lines).toEqual([
      "[user] 背景：要重构日志",
      "[assistant] 可以，先定边界",
      "[user] 只动 src/log",
    ]);
  });

  it("skips non-message, fold, optimistic, and collab-internal text", () => {
    const briefing = buildCollabBriefingSendText({
      userText: "任务",
      flowLabel: "规划 → 实现",
    });
    const summary = buildCollabSummarySendText({
      userText: "任务",
      stageSections: "### plan\nok",
    });
    const lines = buildMainCanvasDialogueLines([
      { id: "r1", kind: "reasoning", summary: "x", content: "y" },
      msg("u1", "user", "保留这句"),
      msg(multiAgentHistFoldItemId("run-1"), "assistant", "折叠卡正文应丢"),
      msg("optimistic-user-abc", "user", "本轮不应进 digest"),
      msg("u-brief", "user", briefing),
      msg("a-sum", "assistant", summary),
      msg("a1", "assistant", "助手回复"),
    ]);
    // briefing 经 strip 后只剩用户原文「任务」；summary 整段丢弃
    expect(lines).toEqual([
      "[user] 保留这句",
      "[user] 任务",
      "[assistant] 助手回复",
    ]);
    expect(lines.join("\n")).not.toContain("[[mossx.collab");
    expect(briefing).toContain("[[doge.collab.briefing]]");
    expect(summary).toContain("[[doge.collab.summary]]");
    expect(lines.join("\n")).not.toContain("协作调度");
  });

  it("returns empty for empty history", () => {
    expect(buildMainCanvasDialogueLines([])).toEqual([]);
  });
});

describe("injectMainCanvasContext", () => {
  it("prepends digest block before user task", () => {
    const result = injectMainCanvasContext({
      userText: "按上面做实现",
      items: [
        msg("u1", "user", "我们要加导出按钮"),
        msg("a1", "assistant", "放在工具栏右侧"),
      ],
    });
    expect(result.injectedCount).toBe(2);
    expect(result.finalText.startsWith(MAIN_CANVAS_CONTEXT_PREFIX)).toBe(true);
    expect(result.finalText).toContain("[user] 我们要加导出按钮");
    expect(result.finalText).toContain("[assistant] 放在工具栏右侧");
    expect(result.finalText.trimEnd().endsWith("按上面做实现")).toBe(true);
    // 标记块在任务前
    const idxBlock = result.finalText.indexOf(MAIN_CANVAS_CONTEXT_PREFIX);
    const idxTask = result.finalText.indexOf("按上面做实现");
    expect(idxBlock).toBeLessThan(idxTask);
  });

  it("is no-op when no history", () => {
    const result = injectMainCanvasContext({
      userText: "从零开始",
      items: [],
    });
    expect(result).toEqual({
      finalText: "从零开始",
      injectedCount: 0,
      injectedChars: 0,
    });
  });

  it("does not put digest into empty userText when no lines", () => {
    const result = injectMainCanvasContext({
      userText: "",
      items: [msg("a1", "assistant", "")],
    });
    expect(result.finalText).toBe("");
    expect(result.injectedCount).toBe(0);
  });

  it("caps total digest size while keeping recent turns", () => {
    const items: ConversationItem[] = [];
    for (let i = 0; i < 40; i += 1) {
      items.push(msg(`u${i}`, "user", `旧消息-${i}-` + "x".repeat(200)));
      items.push(
        msg(`a${i}`, "assistant", `旧回复-${i}-` + "y".repeat(200)),
      );
    }
    const result = injectMainCanvasContext({
      userText: "最新任务",
      items,
    });
    expect(result.injectedCount).toBeGreaterThan(0);
    expect(result.injectedChars).toBeLessThanOrEqual(7000);
    expect(result.finalText).toContain("最新任务");
    // 最近内容更可能保留
    expect(result.finalText).toContain("旧消息-39");
  });
});

describe("collabDisplayTitle / strip / extract", () => {
  const dirty = [
    "【主幕对话上下文】",
    "<main-canvas-context>",
    "以下为主幕布触发协作前的已有对话摘录（供本环节理解背景；勿整段复读）：",
    "[user] 你好啊",
    "[assistant] 你谁啊",
    "</main-canvas-context>",
    "",
    "写个打油诗",
  ].join("\n");

  it("collabDisplayTitle prefers userVisibleText", () => {
    expect(
      collabDisplayTitle(
        { userVisibleText: "写个打油诗", requestText: dirty },
        36,
      ),
    ).toBe("写个打油诗");
  });

  it("collabDisplayTitle strips digest when only requestText", () => {
    const title = collabDisplayTitle(
      { userVisibleText: "", requestText: dirty },
      36,
    );
    expect(title).toBe("写个打油诗");
    expect(title).not.toContain("主幕对话");
    expect(title).not.toContain("main-canvas");
  });

  it("extractMainCanvasContextBody returns dialogue lines", () => {
    const body = extractMainCanvasContextBody(dirty);
    expect(body).toContain("[user] 你好啊");
    expect(body).toContain("[assistant] 你谁啊");
    expect(body).not.toContain("写个打油诗");
  });

  it("stripMainCanvasContextBlock keeps task text", () => {
    expect(stripMainCanvasContextBlock(dirty)).toBe("写个打油诗");
  });
});
