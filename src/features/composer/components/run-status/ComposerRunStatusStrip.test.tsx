/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ComposerRunStatusStrip } from "./ComposerRunStatusStrip";

describe("ComposerRunStatusStrip", () => {
  it("renders nothing without activity", () => {
    const { container } = render(
      <ComposerRunStatusStrip
        todos={[]}
        subagents={[]}
        plan={null}
        isPlanMode={false}
        isProcessing={false}
        mergePlanIntoTodos={false}
        sessionFileChanges={null}
      />,
    );
    expect(container.querySelector('[data-testid="composer-run-status"]')).toBeNull();
  });

  it("renders pills and expands edited files list on click", () => {
    render(
      <ComposerRunStatusStrip
        todos={[
          { content: "【演示】任务 A", status: "completed" },
          { content: "【演示】任务 B", status: "pending" },
        ]}
        subagents={[]}
        plan={null}
        isPlanMode={false}
        isProcessing={false}
        mergePlanIntoTodos={false}
        sessionFileChanges={{
          files: [
            {
              path: "src/a.ts",
              additions: 10,
              deletions: 2,
              status: "completed",
            },
            {
              path: "src/b.ts",
              additions: 1,
              deletions: 0,
              status: "completed",
            },
          ],
          totalAdditions: 11,
          totalDeletions: 2,
        }}
      />,
    );

    expect(screen.getByTestId("composer-run-status")).toBeTruthy();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.length).toBeGreaterThanOrEqual(2);

    const editTab =
      tabs.find((tab) => tab.getAttribute("data-section") === "edit") ??
      tabs[tabs.length - 1]!;
    // pill 行级 +add/-del：目标值在 data-value（NumberFlow 首帧可能仍是 0 在滚）
    expect(
      screen.getByTestId("composer-run-status-edit-additions").getAttribute(
        "data-value",
      ),
    ).toBe("11");
    expect(
      screen.getByTestId("composer-run-status-edit-deletions").getAttribute(
        "data-value",
      ),
    ).toBe("2");
    expect(editTab.getAttribute("data-section")).toBe("edit");

    fireEvent.click(editTab);
    expect(screen.getByText("a.ts")).toBeTruthy();
    expect(screen.getByText("b.ts")).toBeTruthy();
  });

  it("wires file revert actions into the edited files panel", async () => {
    const onRevertFile = vi.fn().mockResolvedValue(undefined);
    const onRevertAllFiles = vi.fn().mockResolvedValue(undefined);
    render(
      <ComposerRunStatusStrip
        todos={[]}
        subagents={[]}
        plan={null}
        isPlanMode={false}
        isProcessing={false}
        mergePlanIntoTodos={false}
        sessionFileChanges={{
          files: [
            {
              path: "src/a.ts",
              additions: 10,
              deletions: 2,
              status: "completed",
            },
            {
              path: "src/b.ts",
              additions: 1,
              deletions: 0,
              status: "completed",
            },
          ],
          totalAdditions: 11,
          totalDeletions: 2,
        }}
        onRevertFile={onRevertFile}
        onRevertAllFiles={onRevertAllFiles}
      />,
    );

    const editTab = screen
      .getAllByRole("tab")
      .find((tab) => tab.getAttribute("data-section") === "edit")!;
    fireEvent.click(editTab);

    expect(screen.getByTestId("turn-files-changed-revert-all")).toBeTruthy();
    fireEvent.click(screen.getByTestId("turn-files-changed-revert-all"));
    fireEvent.click(
      screen.getByRole("button", {
        name: "messages.turnFilesChanged.revertAllConfirmAction",
      }),
    );
    await waitFor(() => {
      expect(onRevertAllFiles).toHaveBeenCalledWith(["src/a.ts", "src/b.ts"]);
    });
  });

  it("clears the edit pill after undo-all succeeds", async () => {
    const onRevertAllFiles = vi.fn().mockResolvedValue(undefined);
    render(
      <ComposerRunStatusStrip
        todos={[]}
        subagents={[]}
        plan={null}
        isPlanMode={false}
        isProcessing={false}
        mergePlanIntoTodos={false}
        sessionScopeKey="thread-1"
        sessionFileChanges={{
          files: [
            {
              path: "src/a.ts",
              additions: 10,
              deletions: 2,
              status: "completed",
            },
          ],
          totalAdditions: 10,
          totalDeletions: 2,
        }}
        onRevertAllFiles={onRevertAllFiles}
      />,
    );

    const editTab = screen
      .getAllByRole("tab")
      .find((tab) => tab.getAttribute("data-section") === "edit")!;
    fireEvent.click(editTab);
    fireEvent.click(screen.getByTestId("turn-files-changed-revert-all"));
    fireEvent.click(
      screen.getByRole("button", {
        name: "messages.turnFilesChanged.revertAllConfirmAction",
      }),
    );

    await waitFor(() => {
      expect(onRevertAllFiles).toHaveBeenCalledOnce();
    });
    await waitFor(() => {
      expect(
        screen
          .queryAllByRole("tab")
          .find((tab) => tab.getAttribute("data-section") === "edit"),
      ).toBeUndefined();
    });
    // 仅编辑段时撤销全部后整条 strip 也应消失
    expect(screen.queryByTestId("composer-run-status")).toBeNull();
  });

  it("collapses pills via chrome toggle and restores them", () => {
    window.localStorage.setItem("ccgui.composer.runStatusChromeOpen", "1");
    render(
      <ComposerRunStatusStrip
        todos={[{ content: "任务 A", status: "pending" }]}
        subagents={[]}
        plan={null}
        isPlanMode={false}
        isProcessing={false}
        mergePlanIntoTodos={false}
        sessionFileChanges={null}
      />,
    );

    expect(screen.getAllByRole("tab").length).toBeGreaterThan(0);
    const toggle = screen.getByTestId("composer-run-status-chrome-toggle");
    fireEvent.click(toggle);
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.getByTestId("composer-run-status").dataset.chromeOpen).toBe(
      "false",
    );

    fireEvent.click(toggle);
    expect(screen.getAllByRole("tab").length).toBeGreaterThan(0);
    expect(screen.getByTestId("composer-run-status").dataset.chromeOpen).toBe(
      "true",
    );
  });
});
