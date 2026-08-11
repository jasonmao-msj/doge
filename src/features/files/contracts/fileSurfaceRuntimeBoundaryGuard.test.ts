import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(path: string) {
  return readFileSync(path, "utf8");
}

function extractFileViewPanelProps(source: string) {
  const match = source.match(/type FileViewPanelProps = \{[\s\S]*?\n\};/);
  if (!match) {
    throw new Error("FileViewPanelProps type block was not found.");
  }
  return match[0];
}

function extractFileViewPanelUsages(source: string) {
  return Array.from(source.matchAll(/<FileViewPanel[\s\S]*?\/>/g)).map(
    (match) => match[0],
  );
}

describe("file surface runtime boundary guard", () => {
  it("keeps realtime conversation maps out of FileViewPanel props", () => {
    const fileViewPanelSource = readSource(
      "src/features/files/components/FileViewPanelContract.ts",
    );
    const propsBlock = extractFileViewPanelProps(fileViewPanelSource);

    expect(propsBlock).not.toContain("threadStatusById");
    expect(propsBlock).not.toContain("conversationItems");
    expect(propsBlock).not.toContain("conversationReducer");
    expect(propsBlock).toContain("fileRenderPressure");
  });

  it("passes only narrow render pressure into layout and diff file surfaces", () => {
    const layoutSource = readSource("src/features/layout/hooks/useLayoutNodes.tsx");
    const editableDiffSource = readSource(
      "src/features/git/components/WorkspaceEditableDiffReviewSurface.tsx",
    );
    const detachedExplorerSource = readSource(
      "src/features/files/components/FileExplorerWorkspace.tsx",
    );
    const usages = [
      ...extractFileViewPanelUsages(layoutSource),
      ...extractFileViewPanelUsages(editableDiffSource),
      ...extractFileViewPanelUsages(detachedExplorerSource),
    ];

    expect(usages.length).toBeGreaterThanOrEqual(2);
    for (const usage of usages) {
      expect(usage).not.toContain("threadStatusById");
      expect(usage).not.toContain("conversationItems");
      expect(usage).not.toContain("conversationReducer");
    }
    expect(usages.some((usage) => usage.includes("fileRenderPressure"))).toBe(true);
  });

  it("keeps sidebar realtime aggregation out of file explorer workspace props", () => {
    const fileExplorerWorkspaceSource = readSource(
      "src/features/files/components/FileExplorerWorkspace.tsx",
    );
    const worktreeSectionSource = readSource(
      "src/features/app/components/WorktreeSection.tsx",
    );

    expect(extractFileViewPanelUsages(fileExplorerWorkspaceSource).join("\n")).not.toContain(
      "threadStatusById",
    );
    expect(fileExplorerWorkspaceSource).not.toContain("threadStatusById");
    expect(worktreeSectionSource).toContain("threadStatusById");
  });
});
