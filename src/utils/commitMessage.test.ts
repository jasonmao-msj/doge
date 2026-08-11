// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  readLastCommitMessageConfig,
  resolveCommitMessageGenerationErrorKey,
  sanitizeGeneratedCommitMessage,
  saveLastCommitMessageConfig,
  shouldApplyCommitMessage,
} from "./commitMessage";

describe("commit message engine config", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("normalizes a legacy Gemini quick config to Codex", () => {
    window.localStorage.setItem(
      "doge.git.lastCommitMessageConfig",
      JSON.stringify({ engine: "gemini", language: "en" }),
    );

    expect(readLastCommitMessageConfig()).toEqual({
      engine: "codex",
      language: "en",
    });
  });

  it("never persists Gemini as a new quick config", () => {
    saveLastCommitMessageConfig({ engine: "gemini", language: "zh" });

    expect(readLastCommitMessageConfig()).toEqual({
      engine: "codex",
      language: "zh",
    });
  });
});

describe("shouldApplyCommitMessage", () => {
  it("returns true when workspace ids match", () => {
    expect(shouldApplyCommitMessage("workspace-1", "workspace-1")).toBe(true);
  });

  it("returns false when workspace ids differ", () => {
    expect(shouldApplyCommitMessage("workspace-1", "workspace-2")).toBe(false);
  });

  it("returns false when active workspace is null", () => {
    expect(shouldApplyCommitMessage(null, "workspace-1")).toBe(false);
  });
});

describe("resolveCommitMessageGenerationErrorKey", () => {
  it("maps raw broken pipe to runtime recovering key", () => {
    expect(
      resolveCommitMessageGenerationErrorKey("Broken pipe (os error 32)", "codex"),
    ).toBe("git.commitMessageRuntimeRecovering");
  });

  it("maps stable recovering prefix to runtime recovering key", () => {
    expect(
      resolveCommitMessageGenerationErrorKey(
        "[SESSION_CREATE_RUNTIME_RECOVERING] Managed runtime was restarting while creating this session.",
        "codex",
      ),
    ).toBe("git.commitMessageRuntimeRecovering");
  });

  it("maps missing codex session errors to requires-codex key", () => {
    expect(
      resolveCommitMessageGenerationErrorKey(
        "AI commit message generation requires the Codex CLI. Please install it first: npm install -g @openai/codex",
        "codex",
      ),
    ).toBe("git.commitMessageRequiresCodex");
    expect(
      resolveCommitMessageGenerationErrorKey(
        "Workspace not connected. Please ensure the Codex CLI is installed and reconnect the workspace.",
        "codex",
      ),
    ).toBe("git.commitMessageRequiresCodex");
  });

  it("returns null for unrelated errors", () => {
    expect(
      resolveCommitMessageGenerationErrorKey("No changes to generate commit message for", "codex"),
    ).toBeNull();
  });
});

describe("sanitizeGeneratedCommitMessage", () => {
  it("extracts commit message from fenced code block", () => {
    const raw = [
      "以下是生成结果：",
      "",
      "```text",
      "feat: add quick action menu",
      "",
      "优化提交信息生成入口，新增两级菜单。",
      "```",
    ].join("\n");
    expect(sanitizeGeneratedCommitMessage(raw)).toBe(
      "feat: add quick action menu\n\n优化提交信息生成入口，新增两级菜单。",
    );
  });

  it("extracts commit message from plain text response", () => {
    const raw = [
      "我先检查了配置，然后给你一个建议：",
      "fix: clean commit output",
      "",
      "仅保留提交信息，过滤解释性文本。",
    ].join("\n");
    expect(sanitizeGeneratedCommitMessage(raw)).toBe(
      "fix: clean commit output\n\n仅保留提交信息，过滤解释性文本。",
    );
  });

  it("accepts custom conventional commit types", () => {
    const raw = [
      "生成如下：",
      "",
      "```text",
      "workflow(ui): align engine menu behavior",
      "",
      "统一两个面板入口行为。",
      "```",
      "",
      "以上供参考。",
    ].join("\n");
    expect(sanitizeGeneratedCommitMessage(raw)).toBe(
      "workflow(ui): align engine menu behavior\n\n统一两个面板入口行为。",
    );
  });

  it("normalizes markdown list/title wrappers in plain text responses", () => {
    const raw = [
      "1. `release(core)：prepare v0.3.11`",
      "",
      "- 调整提交生成链路。",
    ].join("\n");
    expect(sanitizeGeneratedCommitMessage(raw)).toBe(
      "release(core): prepare v0.3.11\n\n- 调整提交生成链路。",
    );
  });

  it("returns original trimmed text when conventional title is missing", () => {
    const raw = "没有检测到 Conventional Commit 标题";
    expect(sanitizeGeneratedCommitMessage(raw)).toBe("没有检测到 Conventional Commit 标题");
  });
});
