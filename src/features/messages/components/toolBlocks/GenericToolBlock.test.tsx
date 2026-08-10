// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationItem } from "../../../../types";
import * as diffParser from "../../../../utils/diff";
import { GenericToolBlock } from "./GenericToolBlock";

/** 展开 fileChange 场景级折叠壳，返回场景 header */
function expandFileEditScene(container: HTMLElement = document.body) {
  const header =
    within(container).queryByRole("button", {
      name: /tools\.fileEditSceneToggle|Batch edit|File changes|批量修改|文件修改/i,
    }) ??
    (container.querySelector('[data-slot="marker"][aria-expanded="false"]') as HTMLElement | null);
  expect(header).toBeTruthy();
  fireEvent.click(header!);
  return header!;
}

const askUserItem: Extract<ConversationItem, { kind: "tool" }> = {
  id: "tool-1",
  kind: "tool",
  toolType: "toolCall",
  title: "Tool: askuserquestion",
  detail: "{}",
};

const fileChangeItem: Extract<ConversationItem, { kind: "tool" }> = {
  id: "tool-2",
  kind: "tool",
  toolType: "fileChange",
  title: "File changes",
  detail: "{}",
  status: "completed",
  changes: [
    { path: "src/App.tsx", kind: "modified", diff: "@@ -1 +1 @@\n-old\n+new" },
    { path: "src/New.tsx", kind: "added", diff: "@@ -0,0 +1 @@\n+const x = 1;" },
  ],
};

const fileChangeManyItem: Extract<ConversationItem, { kind: "tool" }> = {
  id: "tool-2-many",
  kind: "tool",
  toolType: "fileChange",
  title: "File changes",
  detail: "{}",
  status: "completed",
  changes: [
    { path: "src/App.tsx", kind: "modified", diff: "@@ -1 +1 @@\n-old\n+new" },
    { path: "src/New.tsx", kind: "added", diff: "@@ -0,0 +1 @@\n+const x = 1;" },
    { path: "src/routes/Home.tsx", kind: "modified", diff: "@@ -1 +1 @@\n-old\n+new" },
    { path: "src/routes/About.tsx", kind: "modified", diff: "@@ -1 +1 @@\n-old\n+new" },
    { path: "src/lib/api.ts", kind: "modified", diff: "@@ -1 +1 @@\n-old\n+new" },
    { path: "src/lib/store.ts", kind: "modified", diff: "@@ -1 +1 @@\n-old\n+new" },
    { path: "src/styles/app.css", kind: "modified", diff: "@@ -1 +1 @@\n-old\n+new" },
    { path: "package.json", kind: "modified", diff: "@@ -1 +1 @@\n-old\n+new" },
  ],
};

const fileChangeWithOutputItem: Extract<ConversationItem, { kind: "tool" }> = {
  id: "tool-2-output",
  kind: "tool",
  toolType: "fileChange",
  title: "File changes",
  detail: "{}",
  status: "completed",
  output: "@@ -1 +1 @@\n-old\n+new",
  changes: [
    { path: "src/App.tsx", kind: "modified", diff: "@@ -1 +1 @@\n-old\n+new" },
  ],
};

const fileChangeWithoutInlineDiffItem: Extract<ConversationItem, { kind: "tool" }> = {
  id: "tool-2-output-fallback",
  kind: "tool",
  toolType: "fileChange",
  title: "File changes",
  detail: "{}",
  status: "completed",
  output: "@@ -1 +1 @@\n-old\n+new",
  changes: [{ path: "src/App.tsx", kind: "modified" }],
};

const fileChangePathHintCompatItem: Extract<ConversationItem, { kind: "tool" }> = {
  id: "tool-2-pathhint-compat",
  kind: "tool",
  toolType: "fileChange",
  title: "File changes",
  detail: JSON.stringify({
    input: {
      file_path: "/repo/src/App.tsx",
      old_string: "const oldValue = 1;",
      new_string: "const newValue = 1;",
    },
  }),
  status: "completed",
  changes: [{ path: "src/App.tsx", kind: "modified" }],
};

const markdownOutputItem: Extract<ConversationItem, { kind: "tool" }> = {
  id: "tool-3",
  kind: "tool",
  toolType: "fileChange",
  title: "File changes",
  detail: "{}",
  status: "completed",
  output: "## Summary\n\n| Name | Value |\n| --- | --- |\n| a | b |",
};

const heavyOutputItem: Extract<ConversationItem, { kind: "tool" }> = {
  id: "tool-heavy-output",
  kind: "tool",
  toolType: "toolCall",
  title: "Tool: Bash",
  detail: "{}",
  status: "completed",
  output: Array.from({ length: 420 }, (_, index) => `heavy output line ${index}`).join("\n"),
};

const heavyFileChangeItem: Extract<ConversationItem, { kind: "tool" }> = {
  id: "tool-heavy-file-change",
  kind: "tool",
  toolType: "fileChange",
  title: "File changes",
  detail: "{}",
  status: "completed",
  changes: Array.from({ length: 8 }, (_, index) => ({
    path: `src/heavy-${index}.ts`,
    kind: "modified",
    diff: [
      "@@ -1 +1 @@",
      `-old value ${index}`,
      `+new value ${index}`,
    ].join("\n"),
  })),
};

const blockedModeItem: Extract<ConversationItem, { kind: "tool" }> = {
  id: "tool-4",
  kind: "tool",
  toolType: "modeBlocked",
  title: "Tool: askuserquestion",
  detail: "item/tool/requestUserInput",
  status: "completed",
  output:
    "requestUserInput is blocked while effective_mode=code\n\nSwitch to Plan mode and resend the prompt when user input is needed.",
};

const exitPlanModeItem: Extract<ConversationItem, { kind: "tool" }> = {
  id: "tool-5",
  kind: "tool",
  toolType: "toolCall",
  title: "Tool: ExitPlanMode",
  detail:
    "PLAN\n# Plan\n\n## Context\nCreate a few sample files.\n\n## Steps\n- add aaa.txt\n- add bbb.txt\n\nPLANFILEPATH\n/Users/demo/.claude/plans/sample-plan.md",
  status: "completed",
};

const exitPlanModeRawFallbackItem: Extract<ConversationItem, { kind: "tool" }> = {
  id: "tool-6",
  kind: "tool",
  toolType: "toolCall",
  title: "Tool: ExitPlanMode",
  detail: "plain exit plan payload without labeled sections",
  status: "completed",
};

const exitPlanModeJsonItem: Extract<ConversationItem, { kind: "tool" }> = {
  id: "tool-7",
  kind: "tool",
  toolType: "toolCall",
  title: "Tool: ExitPlanMode",
  detail: JSON.stringify({
    plan: "# 计划\n\n## Context\n用户要求创建多个简单的文本文件。",
    planFilePath: "/Users/demo/.claude/plans/json-plan.md",
  }),
  output: "Exit plan mode?",
  status: "completed",
};

const exitPlanModeSlashVariantItem: Extract<ConversationItem, { kind: "tool" }> = {
  id: "tool-8",
  kind: "tool",
  toolType: "toolCall",
  title: "Claude / exit_plan_mode",
  detail: "PLAN\n# Variant Plan\n\n- step one",
  status: "completed",
};

const exitPlanModeBareClaudeVariantItem: Extract<ConversationItem, { kind: "tool" }> = {
  id: "tool-8b",
  kind: "tool",
  toolType: "toolCall",
  title: "Claude / exitplanmode",
  detail: "PLAN\n# Bare Variant Plan\n\n- step one",
  status: "completed",
};

const exitPlanModeDecoratedClaudeVariantItem: Extract<ConversationItem, { kind: "tool" }> = {
  id: "tool-8c",
  kind: "tool",
  toolType: "toolCall",
  title: "Claude / exitplanmode (plan)",
  detail: "PLAN\n# Decorated Variant Plan\n\n- step one",
  status: "completed",
};

const exitPlanModePayloadOnlyFallbackItem: Extract<ConversationItem, { kind: "tool" }> = {
  id: "tool-8d",
  kind: "tool",
  toolType: "toolCall",
  title: "Claude / something-unexpected",
  detail: `ALLOWEDPROMPTS
[
  {
    "prompt": "run maven tests",
    "tool": "Bash"
  }
]

PLAN
# springboot-demo 改进计划

- step one
- step two`,
  status: "completed",
};

const exitPlanModeRichMarkdownItem: Extract<ConversationItem, { kind: "tool" }> = {
  id: "tool-9",
  kind: "tool",
  toolType: "toolCall",
  title: "Tool: ExitPlanMode",
  detail: `PLAN
# Rollout

## Checklist
- done
  - nested detail

| Item | State |
| --- | --- |
| API | ready |

\`\`\`md
PLANFILEPATH should stay inside code fence
\`\`\`

<!-- keep table and code block stable -->

PLANFILEPATH
/Users/demo/.claude/plans/rich-plan.md`,
  status: "completed",
};

describe("GenericToolBlock", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows plan-mode hint for askuserquestion in code mode", () => {
    render(
      <GenericToolBlock
        item={askUserItem}
        isExpanded={false}
        onToggle={vi.fn()}
        activeCollaborationModeId="code"
      />,
    );

    expect(screen.getByText("This feature requires Plan mode")).toBeTruthy();
  });

  it("hides plan-mode hint when collaboration mode is plan", () => {
    render(
      <GenericToolBlock
        item={askUserItem}
        isExpanded={false}
        onToggle={vi.fn()}
        activeCollaborationModeId="plan"
      />,
    );

    expect(screen.queryByText("This feature requires Plan mode")).toBeNull();
  });

  it("hides plan-mode hint for claude askuserquestion when pending user input exists", () => {
    render(
      <GenericToolBlock
        item={askUserItem}
        isExpanded={false}
        onToggle={vi.fn()}
        activeCollaborationModeId="code"
        activeEngine="claude"
        hasPendingUserInputRequest
      />,
    );

    expect(screen.queryByText("This feature requires Plan mode")).toBeNull();
  });

  it("hides plan-mode hint for claude askuserquestion in history without pending request", () => {
    render(
      <GenericToolBlock
        item={askUserItem}
        isExpanded={false}
        onToggle={vi.fn()}
        activeCollaborationModeId="code"
        activeEngine="claude"
      />,
    );

    expect(screen.queryByText("This feature requires Plan mode")).toBeNull();
  });

  it("shows blocked suggestion for modeBlocked askuserquestion item", () => {
    const view = render(
      <GenericToolBlock
        item={blockedModeItem}
        isExpanded={false}
        onToggle={vi.fn()}
        activeCollaborationModeId="code"
      />,
    );

    expect(screen.getByText("This feature requires Plan mode")).toBeTruthy();
    const header = view.container.querySelector('[data-slot="marker"]');
    expect(header).toBeTruthy();
    if (header) {
      fireEvent.click(header);
    }
    const rawPre = view.container.querySelector(".tool-output-raw-pre");
    expect(rawPre?.textContent ?? "").toContain("Switch to Plan mode");
  });

  it("renders each changed file as its own compact row with per-file stats", () => {
    const view = render(
      <GenericToolBlock
        item={fileChangeItem}
        isExpanded
        onToggle={vi.fn()}
      />,
    );

    // 场景默认折叠；展开后每文件一行（共享 FileChangeRow）
    expandFileEditScene(view.container);
    // 1 场景头 + 2 文件行
    expect(view.container.querySelectorAll('[data-slot="marker"]').length).toBe(3);
    expect(view.container.querySelector(".tool-change-kind-badge")).toBeNull();
    expect(screen.getByText("App.tsx")).toBeTruthy();
    expect(screen.getByText("New.tsx")).toBeTruthy();
    // App.tsx: +1 -1，New.tsx: +1（删除为 0 时不显示 -0）
    expect(screen.getAllByText("+1").length).toBe(2);
    expect(screen.getAllByText("-1").length).toBe(1);
    expect(screen.queryByText("-0")).toBeNull();
  });

  it("opens workspace editor for any row without inline diff (not only added)", () => {
    const onOpenFilePath = vi.fn();
    const onOpenDiffPath = vi.fn();
    const view = render(
      <GenericToolBlock
        item={{
          ...fileChangeItem,
          id: "tool-added-no-diff",
          output: "## Created file\n\n- first item\n- second item",
          changes: [
            { path: "src/New.tsx", kind: "added" },
            { path: "src/Modified.tsx", kind: "modified" },
          ],
        }}
        isExpanded
        onToggle={vi.fn()}
        onOpenFilePath={onOpenFilePath}
        onOpenDiffPath={onOpenDiffPath}
      />,
    );

    expandFileEditScene(view.container);
    const rows = view.container.querySelectorAll('[data-slot="marker"]');
    // scene + 2 file rows
    expect(rows.length).toBeGreaterThanOrEqual(3);
    fireEvent.click(rows[1] as HTMLElement);
    fireEvent.click(rows[2] as HTMLElement);

    // Prefer editor open; avoid broken git dual-pane for missing inline diffs.
    expect(onOpenFilePath).toHaveBeenCalledTimes(2);
    expect(onOpenFilePath).toHaveBeenCalledWith("src/New.tsx");
    expect(onOpenFilePath).toHaveBeenCalledWith("src/Modified.tsx");
    expect(onOpenDiffPath).not.toHaveBeenCalled();
    expect(screen.queryByText("-2")).toBeNull();
  });

  it("keeps added files with inline diff on the inline preview path", () => {
    const onOpenDiffPath = vi.fn();
    const view = render(
      <GenericToolBlock
        item={{
          ...fileChangeItem,
          id: "tool-added-with-diff",
          changes: [
            { path: "src/New.tsx", kind: "added", diff: "@@ -0,0 +1 @@\n+const x = 1;" },
          ],
        }}
        isExpanded
        onToggle={vi.fn()}
        onOpenDiffPath={onOpenDiffPath}
      />,
    );

    const markers = view.container.querySelectorAll('[data-slot="marker"]');
    fireEvent.click(markers[markers.length - 1] as HTMLElement);

    expect(onOpenDiffPath).not.toHaveBeenCalled();
    expect(screen.getByText("const x = 1;")).toBeTruthy();
  });

  it("keeps apply_patch added-file content inside the conversation canvas", () => {
    const onOpenDiffPath = vi.fn();
    const view = render(
      <GenericToolBlock
        item={{
          ...fileChangeItem,
          id: "tool-added-apply-patch-diff",
          changes: [
            {
              path: "src/New.tsx",
              kind: "added",
              diff: [
                "*** Add File: src/New.tsx",
                "+const value = 1;",
                "*** End Patch",
              ].join("\n"),
            },
          ],
        }}
        isExpanded
        onToggle={vi.fn()}
        onOpenDiffPath={onOpenDiffPath}
      />,
    );

    const markers = view.container.querySelectorAll('[data-slot="marker"]');
    fireEvent.click(markers[markers.length - 1] as HTMLElement);

    expect(onOpenDiffPath).not.toHaveBeenCalled();
    expect(screen.getByText("const value = 1;")).toBeTruthy();
  });

  it("shows scene summary for single file changes until expanded", () => {
    render(
      <GenericToolBlock
        item={fileChangeWithOutputItem}
        isExpanded={false}
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByText("App.tsx")).toBeTruthy();
    fireEvent.click(document.querySelector('[data-slot="marker"]') as HTMLElement);
    expect(screen.getByText("App.tsx")).toBeTruthy();
  });

  it("shows each changed file as its own collapsed row without overflow summary", () => {
    const parseDiffSpy = vi.spyOn(diffParser, "parseDiff");
    const view = render(
      <GenericToolBlock
        item={fileChangeManyItem}
        isExpanded={false}
        onToggle={vi.fn()}
      />,
    );

    expandFileEditScene(view.container);
    expect(screen.getByText("App.tsx")).toBeTruthy();
    expect(screen.getByText("New.tsx")).toBeTruthy();
    expect(screen.getByText("Home.tsx")).toBeTruthy();
    expect(screen.getByText("About.tsx")).toBeTruthy();
    expect(screen.getByText("api.ts")).toBeTruthy();
    expect(screen.getByText("store.ts")).toBeTruthy();
    expect(screen.getByText("app.css")).toBeTruthy();
    expect(screen.getByText("package.json")).toBeTruthy();
    expect(screen.queryByText(/\+\d+\s+more files/i)).toBeNull();
    // scene header + 8 file rows
    expect(view.container.querySelectorAll('[data-slot="marker"]').length).toBe(9);
    expect(parseDiffSpy).not.toHaveBeenCalled();
    parseDiffSpy.mockRestore();
  });

  it("toggles collapsed multi-file rows independently", () => {
    const view = render(
      <GenericToolBlock
        item={fileChangeManyItem}
        isExpanded={false}
        onToggle={vi.fn()}
      />,
    );

    expandFileEditScene(view.container);
    const headers = Array.from(
      view.container.querySelectorAll('[data-slot="marker"]'),
    );
    // scene + 8 files
    expect(headers.length).toBe(9);
    expect(view.container.querySelectorAll(".tool-change-inline-diff").length).toBe(0);

    fireEvent.click(headers[1]!);
    expect(view.container.querySelectorAll(".tool-change-inline-diff").length).toBe(1);

    fireEvent.click(headers[2]!);
    expect(view.container.querySelectorAll(".tool-change-inline-diff").length).toBe(2);

    fireEvent.click(headers[1]!);
    expect(view.container.querySelectorAll(".tool-change-inline-diff").length).toBe(1);
  });

  it("renders each expanded file change inside its own visual card", () => {
    const view = render(
      <GenericToolBlock
        item={fileChangeItem}
        isExpanded
        onToggle={vi.fn()}
      />,
    );

    expandFileEditScene(view.container);
    const headers = Array.from(
      view.container.querySelectorAll('[data-slot="marker"]'),
    );
    expect(headers.length).toBe(3);
    // 折叠态不渲染 diff，逐行展开后每行各自一个 inline diff 卡片
    expect(view.container.querySelector(".tool-change-inline-diff")).toBeNull();
    fireEvent.click(headers[1]!);
    fireEvent.click(headers[2]!);
    expect(view.container.querySelectorAll(".tool-change-inline-diff").length).toBe(2);
  });

  it("shows inline diff preview for file changes and hides raw diff output pane", () => {
    const view = render(
      <GenericToolBlock
        item={fileChangeWithOutputItem}
        isExpanded
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByText("App.tsx")).toBeTruthy();
    expect(document.querySelector(".tool-output-raw-pre")).toBeNull();
    // diff 仅在展开该行后出现，且不回退到原始输出面板
    expect(document.querySelector(".tool-change-inline-diff")).toBeNull();
    const markers = view.container.querySelectorAll('[data-slot="marker"]');
    fireEvent.click(markers[markers.length - 1]!);
    expect(screen.getByText("old")).toBeTruthy();
    expect(screen.getByText("new")).toBeTruthy();
    expect(document.querySelector(".tool-change-inline-diff")).toBeTruthy();
    expect(document.querySelector(".tool-output-raw-pre")).toBeNull();
  });

  it("keeps heavy file-change diffs collapsed until a row is opened", () => {
    const view = render(
      <GenericToolBlock
        item={heavyFileChangeItem}
        isExpanded
        onToggle={vi.fn()}
      />,
    );

    expandFileEditScene(view.container);
    // scene + 8 行折叠紧凑行，折叠态不渲染任何 diff（天然延迟）
    expect(view.container.querySelectorAll('[data-slot="marker"]').length).toBe(9);
    expect(view.container.querySelector(".tool-change-inline-diff")).toBeNull();

    // 文件名为纯文本，不再是可点跳转链接
    expect(screen.queryByRole("button", { name: "heavy-0.ts" })).toBeNull();

    // 点击文件行头展开后才渲染该行 diff（跳过场景头）
    const markers = view.container.querySelectorAll('[data-slot="marker"]');
    fireEvent.click(markers[1]!);
    expect(view.container.querySelector(".tool-change-inline-diff")).toBeTruthy();
  });

  it("falls back to output diff stats when change rows omit inline diff", () => {
    const view = render(
      <GenericToolBlock
        item={fileChangeWithoutInlineDiffItem}
        isExpanded
        onToggle={vi.fn()}
      />,
    );

    // 折叠行即显示来自输出回退的统计，不显示原始输出面板
    expect(screen.getAllByText("+1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("-1").length).toBeGreaterThan(0);
    expect(document.querySelector(".tool-output-raw-pre")).toBeNull();
    const markers = view.container.querySelectorAll('[data-slot="marker"]');
    fireEvent.click(markers[markers.length - 1]!);
    expect(screen.getByText("old")).toBeTruthy();
    expect(screen.getByText("new")).toBeTruthy();
  });

  it("matches path hints with absolute/relative compatibility for stats fallback", () => {
    const view = render(
      <GenericToolBlock
        item={fileChangePathHintCompatItem}
        isExpanded
        onToggle={vi.fn()}
      />,
    );

    expandFileEditScene(view.container);
    expect(screen.getAllByText("+1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("-1").length).toBeGreaterThan(0);
  });

  it("keeps markdown-like output in raw text mode", () => {
    render(
      <GenericToolBlock
        item={markdownOutputItem}
        isExpanded
        onToggle={vi.fn()}
      />,
    );
    const rawPre = document.querySelector(".tool-output-raw-pre");
    expect(rawPre).toBeTruthy();
    const rawText = rawPre?.textContent ?? "";
    expect(rawText).toContain("## Summary");
    expect(rawText).toContain("| Name | Value |");
  });

  it("defers heavy raw tool output but keeps canonical copy", async () => {
    render(
      <GenericToolBlock
        item={heavyOutputItem}
        isExpanded
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByText("Tool detail deferred")).toBeTruthy();
    expect(document.querySelector(".tool-output-raw-pre")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "messages.copy" }));
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("heavy output line 419"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Show detail" }));
    expect(document.querySelector(".tool-output-raw-pre")?.textContent ?? "")
      .toContain("heavy output line 419");
  });

  it("renders exit plan mode as a dedicated plan-ready card", () => {
    const onExitPlanModeExecute = vi.fn();
    const onToggle = vi.fn();
    const view = render(
      <GenericToolBlock
        item={exitPlanModeItem}
        isExpanded={false}
        onToggle={onToggle}
        activeEngine="claude"
        selectedExitPlanExecutionMode={null}
        onExitPlanModeExecute={onExitPlanModeExecute}
      />,
    );

    expect(screen.getByText("Execution Plan Ready")).toBeTruthy();
    expect(screen.queryByText("Plan summary")).toBeNull();
    const header = view.container.querySelector(".tool-exit-plan-card-toggle");
    expect(header).toBeTruthy();
    if (header) {
      fireEvent.click(header);
    }
    expect(onToggle).toHaveBeenCalledWith("tool-5");
    view.rerender(
      <GenericToolBlock
        item={exitPlanModeItem}
        isExpanded={true}
        onToggle={onToggle}
        activeEngine="claude"
        selectedExitPlanExecutionMode={null}
        onExitPlanModeExecute={onExitPlanModeExecute}
      />,
    );
    expect(screen.getByText("Plan summary")).toBeTruthy();
    expect(screen.getByText("Execution handoff")).toBeTruthy();
    expect(screen.getByText("Choose execution mode")).toBeTruthy();
    expect(screen.queryByText("Default approval mode")).toBeNull();
    expect(screen.queryByText("Full auto")).toBeNull();
    expect(screen.getByRole("button", { name: "Switch to default approval mode and run" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Switch to full auto and run" })).toBeTruthy();
    expect(screen.getByText("Plan file")).toBeTruthy();
    expect(screen.getByText("/Users/demo/.claude/plans/sample-plan.md")).toBeTruthy();
    expect(view.container.querySelector(".tool-exit-plan-card")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Switch to default approval mode and run" }));
    expect(onExitPlanModeExecute).toHaveBeenCalledWith("tool-5", "default");

    view.rerender(
      <GenericToolBlock
        item={exitPlanModeItem}
        isExpanded={true}
        onToggle={onToggle}
        activeEngine="claude"
        selectedExitPlanExecutionMode="default"
        onExitPlanModeExecute={onExitPlanModeExecute}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Switch to default approval mode and run · 已选" }).hasAttribute("disabled"),
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Switch to full auto and run" }));
    expect(onExitPlanModeExecute).not.toHaveBeenCalledWith("tool-5", "full-access");
  });

  it("copies exit plan markdown from the card header without toggling", async () => {
    const onToggle = vi.fn();
    render(
      <GenericToolBlock
        item={exitPlanModeItem}
        isExpanded={true}
        onToggle={onToggle}
        activeEngine="claude"
        selectedExitPlanExecutionMode={null}
        onExitPlanModeExecute={vi.fn()}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "messages.copy" }));
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("# Plan"),
    );
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("falls back to raw output when exit plan payload has no labeled sections", () => {
    const onToggle = vi.fn();
    const view = render(
      <GenericToolBlock
        item={exitPlanModeRawFallbackItem}
        isExpanded={false}
        onToggle={onToggle}
      />,
    );

    const header = view.container.querySelector(".tool-exit-plan-card-toggle");
    expect(header).toBeTruthy();
    if (header) {
      fireEvent.click(header);
    }
    expect(onToggle).toHaveBeenCalledWith("tool-6");
    view.rerender(
      <GenericToolBlock
        item={exitPlanModeRawFallbackItem}
        isExpanded={true}
        onToggle={onToggle}
      />,
    );
    expect(screen.getByText("Raw output")).toBeTruthy();
    expect(view.container.querySelector(".tool-exit-plan-card-markdown")?.textContent ?? "").toContain(
      "plain exit plan payload without labeled sections",
    );
  });

  it("hides trivial exit plan raw output noise", () => {
    const noisyExitPlanItem: Extract<ConversationItem, { kind: "tool" }> = {
      id: "tool-raw-noise",
      kind: "tool",
      toolType: "toolCall",
      title: "Tool: ExitPlanMode",
      detail: "{}",
      status: "completed",
    };
    const view = render(
      <GenericToolBlock
        item={noisyExitPlanItem}
        isExpanded={true}
        onToggle={vi.fn()}
      />,
    );

    expect(screen.queryByText("Raw output")).toBeNull();
    expect(view.container.querySelector(".tool-exit-plan-card-markdown")?.textContent ?? "").not.toContain(
      "{}",
    );
  });

  it("parses json exit plan payload and renders plan markdown", () => {
    const onToggle = vi.fn();
    const view = render(
      <GenericToolBlock
        item={exitPlanModeJsonItem}
        isExpanded={false}
        onToggle={onToggle}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Execution Plan ReadyExit Plan mode" }));
    expect(onToggle).toHaveBeenCalledWith("tool-7");
    view.rerender(
      <GenericToolBlock
        item={exitPlanModeJsonItem}
        isExpanded={true}
        onToggle={onToggle}
      />,
    );
    expect(screen.getByText("计划")).toBeTruthy();
    expect(screen.getByText("用户要求创建多个简单的文本文件。")).toBeTruthy();
    expect(screen.getByText("/Users/demo/.claude/plans/json-plan.md")).toBeTruthy();
    expect(screen.queryByText("Exit plan mode?")).toBeNull();
  });

  it("normalizes exit plan tool name variants before rendering the dedicated card", () => {
    render(
      <GenericToolBlock
        item={exitPlanModeSlashVariantItem}
        isExpanded={false}
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByText("Execution Plan Ready")).toBeTruthy();
  });

  it("matches claude-prefixed exitplanmode variant without underscores", () => {
    render(
      <GenericToolBlock
        item={exitPlanModeBareClaudeVariantItem}
        isExpanded={false}
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByText("Execution Plan Ready")).toBeTruthy();
  });

  it("matches decorated claude exitplanmode title variants", () => {
    render(
      <GenericToolBlock
        item={exitPlanModeDecoratedClaudeVariantItem}
        isExpanded={false}
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByText("Execution Plan Ready")).toBeTruthy();
  });

  it("falls back to exit plan card when payload clearly contains plan sections", () => {
    render(
      <GenericToolBlock
        item={exitPlanModePayloadOnlyFallbackItem}
        isExpanded={false}
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByText("Execution Plan Ready")).toBeTruthy();
  });

  it("preserves rich markdown when extracting labeled exit plan payload", async () => {
    const onToggle = vi.fn();
    const view = render(
      <GenericToolBlock
        item={exitPlanModeRichMarkdownItem}
        isExpanded={false}
        onToggle={onToggle}
      />,
    );

    const header = view.container.querySelector(".tool-exit-plan-card-toggle");
    expect(header).toBeTruthy();
    if (header) {
      fireEvent.click(header);
    }
    expect(onToggle).toHaveBeenCalledWith("tool-9");
    view.rerender(
      <GenericToolBlock
        item={exitPlanModeRichMarkdownItem}
        isExpanded={true}
        onToggle={onToggle}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Rollout")).toBeTruthy();
      expect(screen.getByText("Checklist")).toBeTruthy();
      expect(screen.getByText("nested detail")).toBeTruthy();
      expect(screen.getByText("API")).toBeTruthy();
      expect(screen.getByText("PLANFILEPATH should stay inside code fence")).toBeTruthy();
      expect(screen.getByText("/Users/demo/.claude/plans/rich-plan.md")).toBeTruthy();
    });
  });
});
