// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TurnFilesChangedCard } from "./TurnFilesChangedCard";
import type { TurnFileChangesSummary } from "../../utils/turnFileChanges";

function buildSummary(fileCount: number): TurnFileChangesSummary {
  const files = Array.from({ length: fileCount }, (_, index) => ({
    path: `src/file-${index}.ts`,
    additions: index + 1,
    deletions: index,
    status: "completed" as const,
  }));
  return {
    files,
    totalAdditions: files.reduce((sum, file) => sum + file.additions, 0),
    totalDeletions: files.reduce((sum, file) => sum + file.deletions, 0),
  };
}

afterEach(() => {
  cleanup();
});

describe("TurnFilesChangedCard", () => {
  it("renders title, total stats and collapses long file lists", () => {
    render(<TurnFilesChangedCard summary={buildSummary(6)} />);
    expect(screen.getByText("messages.turnFilesChanged.title")).toBeTruthy();
    // 总计 +21 -15（1+..+6 / 0+..+5）
    expect(screen.getByText("+21")).toBeTruthy();
    expect(screen.getByText("-15")).toBeTruthy();
    // 收起态只显示前 4 个文件
    expect(screen.getByText("file-0.ts")).toBeTruthy();
    expect(screen.getByText("file-3.ts")).toBeTruthy();
    expect(screen.queryByText("file-4.ts")).toBeNull();
    expect(screen.getByText("messages.turnFilesChanged.showMore")).toBeTruthy();
  });

  it("hides undo entry points when revert callbacks are not provided", () => {
    render(<TurnFilesChangedCard summary={buildSummary(2)} />);
    expect(
      screen.queryByTestId("turn-files-changed-revert-all"),
    ).toBeNull();
    expect(
      screen.queryByTestId("turn-files-changed-revert-file"),
    ).toBeNull();
  });

  it("expands hidden files when clicking show-more", () => {
    render(<TurnFilesChangedCard summary={buildSummary(6)} />);
    fireEvent.click(screen.getByText("messages.turnFilesChanged.showMore"));
    expect(screen.getByText("file-5.ts")).toBeTruthy();
    expect(screen.queryByText("messages.turnFilesChanged.showMore")).toBeNull();
  });

  it("renders file rows as non-clickable display-only elements", () => {
    render(<TurnFilesChangedCard summary={buildSummary(2)} />);
    expect(screen.getByText("file-0.ts").closest("button")).toBeNull();
    expect(screen.getByText("file-1.ts").closest("button")).toBeNull();
  });

  it("requests modal diff preview from an accessible file button", () => {
    const onPreviewFileDiff = vi.fn();
    render(
      <TurnFilesChangedCard
        summary={buildSummary(2)}
        onPreviewFileDiff={onPreviewFileDiff}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /file-1\.ts/ }));

    expect(onPreviewFileDiff).toHaveBeenCalledOnce();
    expect(onPreviewFileDiff).toHaveBeenCalledWith("src/file-1.ts");
  });

  it("expands hidden files without requesting a modal preview", () => {
    const onPreviewFileDiff = vi.fn();
    render(
      <TurnFilesChangedCard
        summary={buildSummary(6)}
        onPreviewFileDiff={onPreviewFileDiff}
      />,
    );

    fireEvent.click(screen.getByText("messages.turnFilesChanged.showMore"));

    expect(screen.getByText("file-5.ts")).toBeTruthy();
    expect(onPreviewFileDiff).not.toHaveBeenCalled();
  });

  it("shows revert-all danger control and requires confirm before calling onRevertAll", async () => {
    const onRevertAll = vi.fn().mockResolvedValue(undefined);
    render(
      <TurnFilesChangedCard
        summary={buildSummary(2)}
        onRevertAll={onRevertAll}
      />,
    );

    fireEvent.click(screen.getByTestId("turn-files-changed-revert-all"));
    expect(onRevertAll).not.toHaveBeenCalled();

    // ConfirmDialog 确认按钮
    fireEvent.click(
      screen.getByRole("button", {
        name: "messages.turnFilesChanged.revertAllConfirmAction",
      }),
    );

    await waitFor(() => {
      expect(onRevertAll).toHaveBeenCalledOnce();
    });
    expect(onRevertAll).toHaveBeenCalledWith([
      "src/file-0.ts",
      "src/file-1.ts",
    ]);
  });

  it("shows text revert control and requires confirm before calling onRevertFile", async () => {
    const onRevertFile = vi.fn().mockResolvedValue(undefined);
    render(
      <TurnFilesChangedCard
        summary={buildSummary(2)}
        onRevertFile={onRevertFile}
      />,
    );

    const fileButtons = screen.getAllByTestId("turn-files-changed-revert-file");
    expect(fileButtons).toHaveLength(2);
    // 纯文字，无 SVG 图标
    expect(fileButtons[0]!.textContent).toBe(
      "messages.turnFilesChanged.revertFileAction",
    );
    expect(fileButtons[0]!.querySelector("svg")).toBeNull();

    fireEvent.click(fileButtons[0]!);
    expect(onRevertFile).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", {
        name: "messages.turnFilesChanged.revertFileConfirmAction",
      }),
    );

    await waitFor(() => {
      expect(onRevertFile).toHaveBeenCalledOnce();
    });
    expect(onRevertFile).toHaveBeenCalledWith("src/file-0.ts");
    // 列表隐藏由上层 summary 过滤；本卡只负责触发 onRevertFile
    expect(screen.getByText("file-0.ts")).toBeTruthy();
  });

  it("cancels single-file revert without calling onRevertFile", () => {
    const onRevertFile = vi.fn();
    render(
      <TurnFilesChangedCard
        summary={buildSummary(2)}
        onRevertFile={onRevertFile}
      />,
    );

    fireEvent.click(screen.getAllByTestId("turn-files-changed-revert-file")[0]!);
    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));

    expect(onRevertFile).not.toHaveBeenCalled();
    expect(screen.getByText("file-0.ts")).toBeTruthy();
  });

  it("cancels revert-all without calling onRevertAll", () => {
    const onRevertAll = vi.fn();
    render(
      <TurnFilesChangedCard
        summary={buildSummary(2)}
        onRevertAll={onRevertAll}
      />,
    );

    fireEvent.click(screen.getByTestId("turn-files-changed-revert-all"));
    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));

    expect(onRevertAll).not.toHaveBeenCalled();
  });
});
