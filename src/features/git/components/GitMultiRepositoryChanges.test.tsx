/** @vitest-environment jsdom */
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import type { RepositoryGitStatus } from "../hooks/useMultiRepositoryGitStatus";
import { GitMultiRepositoryChanges } from "./GitMultiRepositoryChanges";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params?.path ? `${key}:${params.path}` : params?.count !== undefined ? `${key}:${params.count}` : key,
  }),
}));

const repositoryStatus = (repositoryRoot: string): RepositoryGitStatus => ({
  repositoryRoot,
  displayName: repositoryRoot,
  branchName: repositoryRoot === "a" ? "main" : "sit-p2",
  stagedFiles: [],
  unstagedFiles: [{ path: "pom.xml", status: "M", additions: 1, deletions: 0 }],
  totalAdditions: 1,
  totalDeletions: 0,
  error: null,
});

type FileMenuHandler = (
  event: ReactMouseEvent<HTMLDivElement>,
  repositoryRoot: string,
  path: string,
  section: "staged" | "unstaged",
) => void;

describe("GitMultiRepositoryChanges", () => {
  it("restores an aggregate status refresh action in every repository header", () => {
    const onRefresh = vi.fn(async () => undefined);
    render(
      <GitMultiRepositoryChanges
        workspaceId="ws-1"
        statuses={[repositoryStatus("a"), repositoryStatus("b")]}
        isLoading={false}
        commitMessage=""
        commitLoading={false}
        onRefresh={onRefresh}
      />,
    );

    const groups = document.querySelectorAll<HTMLElement>(".git-repository-change-group");
    expect(groups).toHaveLength(2);
    groups.forEach((group) => {
      expect(within(group).getByRole("button", { name: "git.refreshStatus" })).not.toBeNull();
    });

    fireEvent.click(within(groups[1] as HTMLElement).getByRole("button", {
      name: "git.refreshStatus",
    }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("disables repository refresh actions while the aggregate refresh is loading", () => {
    const onRefresh = vi.fn(async () => undefined);
    render(
      <GitMultiRepositoryChanges
        workspaceId="ws-1"
        statuses={[repositoryStatus("a"), repositoryStatus("b")]}
        isLoading
        commitMessage=""
        commitLoading={false}
        onRefresh={onRefresh}
      />,
    );

    const refreshButtons = screen.getAllByRole("button", { name: "git.refreshStatus" });
    expect(refreshButtons).toHaveLength(2);
    refreshButtons.forEach((button) => {
      expect(button.getAttribute("disabled")).not.toBeNull();
      expect(button.classList.contains("is-spinning")).toBe(true);
      fireEvent.click(button);
    });
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("collapses repository sections independently without triggering Git actions", () => {
    const firstStatus = repositoryStatus("a");
    firstStatus.stagedFiles = [
      { path: "staged-a.ts", status: "M", additions: 2, deletions: 0 },
    ];
    const onStageFile = vi.fn(async () => undefined);
    const onUnstageFile = vi.fn(async () => undefined);
    const onDiscardFile = vi.fn();
    const onOpenFile = vi.fn();
    const onRefresh = vi.fn(async () => undefined);

    render(
      <GitMultiRepositoryChanges
        workspaceId="ws-1"
        statuses={[firstStatus, repositoryStatus("b")]}
        isLoading={false}
        commitMessage=""
        commitLoading={false}
        onStageFile={onStageFile}
        onUnstageFile={onUnstageFile}
        onDiscardFile={onDiscardFile}
        onOpenFile={onOpenFile}
        onRefresh={onRefresh}
      />,
    );

    const groups = document.querySelectorAll<HTMLElement>(".git-repository-change-group");
    const firstGroup = groups[0] as HTMLElement;
    const secondGroup = groups[1] as HTMLElement;
    const stagedToggle = within(firstGroup).getByRole("button", {
      name: "git.staged (1)",
    });
    const firstUnstagedToggle = within(firstGroup).getByRole("button", {
      name: "git.unstaged (1)",
    });
    const secondUnstagedToggle = within(secondGroup).getByRole("button", {
      name: "git.unstaged (1)",
    });
    const selectionStateBefore = within(firstGroup)
      .getAllByRole("checkbox")
      .map((toggle) => toggle.getAttribute("aria-checked"));

    fireEvent.click(stagedToggle);

    expect(stagedToggle.getAttribute("aria-expanded")).toBe("false");
    expect(firstUnstagedToggle.getAttribute("aria-expanded")).toBe("true");
    expect(secondUnstagedToggle.getAttribute("aria-expanded")).toBe("true");
    expect(firstGroup.querySelector('[data-path="staged-a.ts"]')).toBeNull();
    expect(firstGroup.querySelector('[data-path="pom.xml"]')).not.toBeNull();
    expect(secondGroup.querySelector('[data-path="pom.xml"]')).not.toBeNull();
    expect(onStageFile).not.toHaveBeenCalled();
    expect(onUnstageFile).not.toHaveBeenCalled();
    expect(onDiscardFile).not.toHaveBeenCalled();
    expect(onOpenFile).not.toHaveBeenCalled();
    expect(onRefresh).not.toHaveBeenCalled();

    fireEvent.click(stagedToggle);

    expect(stagedToggle.getAttribute("aria-expanded")).toBe("true");
    expect(
      within(firstGroup)
        .getAllByRole("checkbox")
        .map((toggle) => toggle.getAttribute("aria-checked")),
    ).toEqual(selectionStateBefore);
  });

  it("does not carry collapsed sections into another workspace with the same repository root", () => {
    const status = repositoryStatus("shared-root");
    const { rerender } = render(
      <GitMultiRepositoryChanges
        workspaceId="ws-1"
        statuses={[status]}
        isLoading={false}
        commitMessage=""
        commitLoading={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "git.unstaged (1)" }));
    expect(screen.queryByLabelText("pom.xml")).toBeNull();

    rerender(
      <GitMultiRepositoryChanges
        workspaceId="ws-2"
        statuses={[status]}
        isLoading={false}
        commitMessage=""
        commitLoading={false}
      />,
    );

    expect(
      screen.getByRole("button", { name: "git.unstaged (1)" }).getAttribute("aria-expanded"),
    ).toBe("true");
    expect(screen.getByLabelText("pom.xml")).toBeTruthy();
  });

  it("renders repository groups and isolates the same relative path selection", () => {
    const onCommitRepositories = vi.fn();
    const onGenerateCommitMessage = vi.fn();
    render(
      <GitMultiRepositoryChanges
        workspaceId="ws-1"
        statuses={[repositoryStatus("a"), repositoryStatus("b")]}
        isLoading={false}
        commitMessage="fix: scoped"
        commitLoading={false}
        onCommitRepositories={onCommitRepositories}
        onGenerateCommitMessage={onGenerateCommitMessage}
      />,
    );

    const groups = document.querySelectorAll(".git-repository-change-group");
    expect(groups).toHaveLength(2);
    expect(within(groups[0] as HTMLElement).getByText("main")).not.toBeNull();
    expect(within(groups[1] as HTMLElement).getByText("sit-p2")).not.toBeNull();
    const content = document.querySelector(".git-multi-repository-changes__content");
    const composer = document.querySelector(".git-commit-composer");
    expect(Boolean(
      content && composer &&
      (content.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING),
    )).toBe(true);

    const secondFileToggle = within(groups[1] as HTMLElement).getByRole("checkbox", {
      name: "git.commitSelectionToggleFile:pom.xml",
    });
    fireEvent.click(secondFileToggle);
    const configChip = screen.getByRole("button", {
      name: "git.generateCommitMessage",
    });
    expect(configChip.querySelector(".commit-message-engine-icon")).not.toBeNull();
    fireEvent.click(configChip);
    // Popover opens structured picker; generation needs explicit CTA.
    expect(onGenerateCommitMessage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "git.commit" }));

    expect(onCommitRepositories).toHaveBeenCalledWith([
      { repositoryRoot: "b", selectedPaths: ["pom.xml"] },
    ]);
  });

  it("forwards modal preview with repository identity", () => {
    const onOpenFilePreview = vi.fn();
    render(
      <GitMultiRepositoryChanges
        workspaceId="ws-1"
        statuses={[repositoryStatus("services/api")]}
        isLoading={false}
        commitMessage=""
        commitLoading={false}
        onOpenFilePreview={onOpenFilePreview}
      />,
    );

    const row = document.querySelector<HTMLElement>('.diff-row[data-path="pom.xml"]');
    expect(row).toBeTruthy();
    fireEvent.click(row as HTMLElement);

    expect(onOpenFilePreview).toHaveBeenCalledWith(
      "services/api",
      expect.objectContaining({ path: "pom.xml", status: "M" }),
      "unstaged",
    );
  });

  it("forwards inline center-area preview clicks with repository identity", () => {
    const onOpenInlinePreview = vi.fn();
    render(
      <GitMultiRepositoryChanges
        workspaceId="ws-1"
        statuses={[repositoryStatus("services/api")]}
        isLoading={false}
        commitMessage=""
        commitLoading={false}
        onOpenInlinePreview={onOpenInlinePreview}
      />,
    );

    const previewButton = document.querySelector<HTMLButtonElement>(
      '.diff-row[data-path="pom.xml"] .diff-row-action--preview-inline',
    );
    expect(previewButton).toBeTruthy();
    fireEvent.click(previewButton as HTMLButtonElement);

    expect(onOpenInlinePreview).toHaveBeenCalledWith("services/api", "pom.xml");
  });

  it("forwards direct file-row previews with repository identity", () => {
    const onOpenFile = vi.fn();
    const onOpenFilePreview = vi.fn();
    render(
      <GitMultiRepositoryChanges
        workspaceId="ws-1"
        statuses={[repositoryStatus("repo-a"), repositoryStatus("repo-b")]}
        isLoading={false}
        commitMessage=""
        commitLoading={false}
        onOpenFile={onOpenFile}
        onOpenFilePreview={onOpenFilePreview}
      />,
    );

    const rows = document.querySelectorAll<HTMLElement>('.diff-row[data-path="pom.xml"]');
    expect(rows).toHaveLength(2);
    fireEvent.click(rows[0] as HTMLElement);
    fireEvent.click(rows[1] as HTMLElement);
    fireEvent.keyDown(rows[1] as HTMLElement, { key: "Enter" });

    expect(onOpenFile).not.toHaveBeenCalled();
    expect(onOpenFilePreview).toHaveBeenNthCalledWith(
      1,
      "repo-a",
      expect.objectContaining({ path: "pom.xml", status: "M" }),
      "unstaged",
    );
    expect(onOpenFilePreview).toHaveBeenNthCalledWith(
      2,
      "repo-b",
      expect.objectContaining({ path: "pom.xml", status: "M" }),
      "unstaged",
    );
    expect(onOpenFilePreview).toHaveBeenNthCalledWith(
      3,
      "repo-b",
      expect.objectContaining({ path: "pom.xml", status: "M" }),
      "unstaged",
    );
  });

  it("previews repository-scoped rename destinations on click and Enter", () => {
    const status = repositoryStatus("services/api");
    status.unstagedFiles = [{
      path: "archive/spec.md",
      oldPath: "changes/spec.md",
      status: "R",
      additions: 0,
      deletions: 0,
    }];
    const onOpenFile = vi.fn();
    const onOpenFilePreview = vi.fn();
    render(
      <GitMultiRepositoryChanges
        workspaceId="ws-1"
        statuses={[status]}
        isLoading={false}
        commitMessage=""
        commitLoading={false}
        onOpenFile={onOpenFile}
        onOpenFilePreview={onOpenFilePreview}
      />,
    );

    const row = document.querySelector<HTMLElement>(
      '.diff-row[data-path="archive/spec.md"]',
    ) as HTMLElement;
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: "Enter" });

    expect(onOpenFile).not.toHaveBeenCalled();
    expect(onOpenFilePreview).toHaveBeenNthCalledWith(
      1,
      "services/api",
      expect.objectContaining({
        path: "archive/spec.md",
        oldPath: "changes/spec.md",
        status: "R",
      }),
      "unstaged",
    );
    expect(onOpenFilePreview).toHaveBeenNthCalledWith(
      2,
      "services/api",
      expect.objectContaining({
        path: "archive/spec.md",
        oldPath: "changes/spec.md",
        status: "R",
      }),
      "unstaged",
    );
  });

  it("routes repository-scoped deleted rows to preview on click and Enter", () => {
    const status = repositoryStatus("services/api");
    status.unstagedFiles = [{
      path: "src/deleted.ts",
      status: "D",
      additions: 0,
      deletions: 1,
    }];
    const onOpenFile = vi.fn();
    const onOpenFilePreview = vi.fn();
    render(
      <GitMultiRepositoryChanges
        workspaceId="ws-1"
        statuses={[status]}
        isLoading={false}
        commitMessage=""
        commitLoading={false}
        onOpenFile={onOpenFile}
        onOpenFilePreview={onOpenFilePreview}
      />,
    );

    const row = document.querySelector<HTMLElement>(
      '.diff-row[data-path="src/deleted.ts"]',
    ) as HTMLElement;
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: "Enter" });

    expect(onOpenFile).not.toHaveBeenCalled();
    expect(onOpenFilePreview).toHaveBeenCalledTimes(2);
    expect(onOpenFilePreview).toHaveBeenNthCalledWith(
      1,
      "services/api",
      expect.objectContaining({ path: "src/deleted.ts", status: "D" }),
      "unstaged",
    );
    expect(onOpenFilePreview).toHaveBeenNthCalledWith(
      2,
      "services/api",
      expect.objectContaining({ path: "src/deleted.ts", status: "D" }),
      "unstaged",
    );
  });

  it("shows discard only for unstaged rows and forwards repository identity", () => {
    const onDiscardFile = vi.fn();
    const status = repositoryStatus("services/api");
    status.stagedFiles = [
      { path: "staged.md", status: "M", additions: 1, deletions: 0 },
    ];
    render(
      <GitMultiRepositoryChanges
        workspaceId="ws-1"
        statuses={[status]}
        isLoading={false}
        commitMessage=""
        commitLoading={false}
        onDiscardFile={onDiscardFile}
      />,
    );

    const discardButtons = document.querySelectorAll<HTMLButtonElement>(
      ".diff-row-action--discard",
    );
    expect(discardButtons).toHaveLength(1);
    expect(discardButtons[0]?.closest(".diff-row")?.getAttribute("data-path")).toBe("pom.xml");

    fireEvent.click(discardButtons[0] as HTMLButtonElement);

    expect(onDiscardFile).toHaveBeenCalledWith("services/api", "pom.xml");
  });

  it("shows section discard-all in unstaged section header and forwards repository identity", () => {
    const onDiscardFiles = vi.fn();
    const status = repositoryStatus("services/api");
    status.unstagedFiles = [
      { path: "a.ts", status: "M", additions: 1, deletions: 0 },
      { path: "b.ts", status: "M", additions: 2, deletions: 1 },
    ];
    status.stagedFiles = [
      { path: "staged.md", status: "M", additions: 1, deletions: 0 },
    ];
    render(
      <GitMultiRepositoryChanges
        workspaceId="ws-1"
        statuses={[status]}
        isLoading={false}
        commitMessage=""
        commitLoading={false}
        onDiscardFiles={onDiscardFiles}
      />,
    );

    const sectionDiscardButtons = document.querySelectorAll<HTMLButtonElement>(
      ".diff-section-actions .diff-row-action--discard",
    );
    expect(sectionDiscardButtons).toHaveLength(1);

    fireEvent.click(sectionDiscardButtons[0] as HTMLButtonElement);

    expect(onDiscardFiles).toHaveBeenCalledWith("services/api", ["a.ts", "b.ts"]);
  });

  it("forwards staged and unstaged row context menus with exact repository identity", () => {
    const status = repositoryStatus("services/api");
    status.stagedFiles = [
      { path: "staged.md", status: "M", additions: 1, deletions: 0 },
    ];
    const observedDefaultPrevented: boolean[] = [];
    const onShowFileMenu = vi.fn<FileMenuHandler>((event) => {
      event.preventDefault();
      observedDefaultPrevented.push(event.defaultPrevented);
    });

    render(
      <GitMultiRepositoryChanges
        workspaceId="ws-1"
        statuses={[status]}
        isLoading={false}
        commitMessage=""
        commitLoading={false}
        onShowFileMenu={onShowFileMenu}
      />,
    );

    const stagedRow = document.querySelector<HTMLElement>(
      '.diff-row[data-section="staged"][data-path="staged.md"]',
    );
    const unstagedRow = document.querySelector<HTMLElement>(
      '.diff-row[data-section="unstaged"][data-path="pom.xml"]',
    );
    expect(stagedRow).toBeTruthy();
    expect(unstagedRow).toBeTruthy();

    fireEvent.contextMenu(stagedRow as HTMLElement);
    fireEvent.contextMenu(unstagedRow as HTMLElement);

    expect(onShowFileMenu).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      "services/api",
      "staged.md",
      "staged",
    );
    expect(onShowFileMenu).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "services/api",
      "pom.xml",
      "unstaged",
    );
    expect(observedDefaultPrevented).toEqual([true, true]);
  });

  it("keeps same-path context menus repository-scoped without row side effects", () => {
    const onShowFileMenu = vi.fn<FileMenuHandler>((event) => {
      event.preventDefault();
    });
    const onOpenFile = vi.fn();
    const onRefresh = vi.fn(async () => undefined);

    render(
      <GitMultiRepositoryChanges
        workspaceId="ws-1"
        statuses={[repositoryStatus("repo-a"), repositoryStatus("repo-b")]}
        isLoading={false}
        commitMessage=""
        commitLoading={false}
        onShowFileMenu={onShowFileMenu}
        onOpenFile={onOpenFile}
        onRefresh={onRefresh}
      />,
    );

    const groups = document.querySelectorAll<HTMLElement>(".git-repository-change-group");
    const secondRow = within(groups[1] as HTMLElement).getByLabelText("pom.xml");
    const selectionStateBefore = screen
      .getAllByRole("checkbox")
      .map((toggle) => toggle.getAttribute("aria-checked"));
    const collapseStateBefore = screen
      .getAllByRole("button", { name: "git.unstaged (1)" })
      .map((toggle) => toggle.getAttribute("aria-expanded"));

    fireEvent.contextMenu(secondRow);

    expect(onShowFileMenu).toHaveBeenCalledTimes(1);
    expect(onShowFileMenu).toHaveBeenCalledWith(
      expect.anything(),
      "repo-b",
      "pom.xml",
      "unstaged",
    );
    expect(onOpenFile).not.toHaveBeenCalled();
    expect(onRefresh).not.toHaveBeenCalled();
    expect(
      screen
        .getAllByRole("checkbox")
        .map((toggle) => toggle.getAttribute("aria-checked")),
    ).toEqual(selectionStateBefore);
    expect(
      screen
        .getAllByRole("button", { name: "git.unstaged (1)" })
        .map((toggle) => toggle.getAttribute("aria-expanded")),
    ).toEqual(collapseStateBefore);
  });

  it("preserves an explicit workspace-root repository identity in context menus", () => {
    const status = repositoryStatus("");
    status.displayName = "workspace-root";
    const onShowFileMenu = vi.fn<FileMenuHandler>((event) => {
      event.preventDefault();
    });

    render(
      <GitMultiRepositoryChanges
        workspaceId="ws-1"
        statuses={[status]}
        isLoading={false}
        commitMessage=""
        commitLoading={false}
        onShowFileMenu={onShowFileMenu}
      />,
    );

    const row = document.querySelector<HTMLElement>('.diff-row[data-path="pom.xml"]');
    expect(row).toBeTruthy();
    fireEvent.contextMenu(row as HTMLElement);

    expect(onShowFileMenu).toHaveBeenCalledWith(
      expect.anything(),
      "",
      "pom.xml",
      "unstaged",
    );
  });

  it("renders per-repo line-stats badge from totalAdditions/totalDeletions", () => {
    const status = repositoryStatus("a");
    status.totalAdditions = 12;
    status.totalDeletions = 4;
    render(
      <GitMultiRepositoryChanges
        workspaceId="ws-1"
        statuses={[status]}
        isLoading={false}
        commitMessage=""
        commitLoading={false}
      />,
    );

    const header = document.querySelector(".git-repository-change-group__header");
    const badge = header?.querySelector(".diff-counts-inline.git-filetree-badge");
    expect(badge).toBeTruthy();
    expect(badge?.getAttribute("aria-label")).toBe("+12 -4");
    expect(badge?.textContent).toContain("+12");
    expect(badge?.textContent).toContain("-4");
  });

  it("hides per-repo line-stats badge when both totals are zero", () => {
    const status = repositoryStatus("a");
    status.totalAdditions = 0;
    status.totalDeletions = 0;
    render(
      <GitMultiRepositoryChanges
        workspaceId="ws-1"
        statuses={[status]}
        isLoading={false}
        commitMessage=""
        commitLoading={false}
      />,
    );

    const header = document.querySelector(".git-repository-change-group__header");
    expect(header?.querySelector(".diff-counts-inline.git-filetree-badge")).toBeNull();
  });
});
