/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitHistoryWorktreePanel } from "./GitHistoryWorktreePanel";
import { saveLastCommitMessageConfig } from "../../../utils/commitMessage";

const mockGetGitStatus = vi.fn<(workspaceId: string, repositoryRoot?: string | null) => Promise<unknown>>();
const mockCommitGit = vi.fn<(workspaceId: string, message: string, repositoryRoot?: string | null) => Promise<void>>();
const mockGenerateCommitMessage = vi.fn<
  (
    workspaceId: string,
    language?: "zh" | "en",
    engine?: "codex" | "claude" | "gemini" | "opencode",
    selectedPaths?: string[],
    repositorySelections?: Array<{ repositoryRoot: string; selectedPaths: string[] }>,
  ) => Promise<string>
>();
const mockStageGitFile = vi.fn<(workspaceId: string, path: string, repositoryRoot?: string | null) => Promise<void>>();
const mockStageGitAll = vi.fn<(workspaceId: string, repositoryRoot?: string | null) => Promise<void>>();
const mockUnstageGitFile = vi.fn<(workspaceId: string, path: string, repositoryRoot?: string | null) => Promise<void>>();
const mockUnstageGitAll = vi.fn<(workspaceId: string, repositoryRoot?: string | null) => Promise<void>>();
const mockUnstageGitPaths = vi.fn<(workspaceId: string, paths: string[], repositoryRoot?: string | null) => Promise<void>>();
const mockRevertGitFile = vi.fn<(workspaceId: string, path: string, repositoryRoot?: string | null) => Promise<void>>();
const mockRevertGitPaths = vi.fn<(workspaceId: string, paths: string[], repositoryRoot?: string | null) => Promise<void>>();
const mockRevertGitAll = vi.fn<(workspaceId: string, repositoryRoot?: string | null) => Promise<void>>();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        "git.staged": "Staged",
        "git.unstaged": "Unstaged",
        "git.commit": "Commit",
        "git.committing": "Committing...",
        "git.commitMessage": "Commit message",
        "git.enterCommitMessage": "Enter commit message",
        "git.noChangesToCommit": "No changes to commit",
        "git.selectFilesToCommit": "Select files to commit first",
        "git.selectedFilesForCommit": "{{count}} file selected for commit",
        "git.selectedFilesForCommit_other": "{{count}} files selected for commit",
        "git.commitSelectedChanges": "Commit selected changes",
        "git.commitSelectionToggleFile": "Toggle commit selection: {{path}}",
        "git.commitSelectionToggleScope": "Toggle commit selection: {{path}}",
        "git.sectionActions": "{{title}} actions",
        "git.commitRestoreSelectionFailed": "Commit completed, but failed to restore excluded staged files: {{error}}",
        "git.fileActions": "File actions",
        "git.noChangesDetected": "No changes",
        "git.stageFile": "Stage file",
        "git.unstageFile": "Unstage file",
        "git.discardFile": "Discard file",
        "git.stageAllChanges": "Stage all changes",
        "git.stageAllChangesAction": "Stage all",
        "git.unstageAllChanges": "Unstage all changes",
        "git.unstageAllChangesAction": "Unstage all",
        "git.discardAllChanges": "Discard all changes",
        "git.discardAllChangesAction": "Discard all",
        "git.generateCommitMessage": "Generate commit message",
        "git.generateCommitMessageStaged": "Generate commit message from staged changes",
        "git.generateCommitMessageUnstaged": "Generate commit message from unstaged changes",
        "git.generateCommitMessageChinese": "中文",
        "git.generateCommitMessageEnglish": "English",
        "git.generateCommitMessageEngineCodex": "Codex",
        "git.generateCommitMessageEngineClaude": "Claude Code",
        "git.generateCommitMessageEngineGemini": "Gemini",
        "git.generateCommitMessageEngineOpenCode": "OpenCode",
        "git.generateCommitMessageLastConfig": "Use last configuration",
      };
      const template = translations[key] ?? key;
      if (!options) {
        return template;
      }
      return template.replace(/\{\{(\w+)\}\}/g, (_, token: string) => String(options[token] ?? ""));
    },
    i18n: {
      language: "en",
      changeLanguage: vi.fn(),
    },
  }),
}));

vi.mock("../../../services/tauri", () => ({
  commitGit: (...args: [string, string, (string | null)?]) => mockCommitGit(...args),
  generateCommitMessageWithEngine: (
    ...args: [
      string,
      ("zh" | "en")?,
      ("codex" | "claude" | "gemini" | "opencode")?,
      string[]?,
      Array<{ repositoryRoot: string; selectedPaths: string[] }>?,
    ]
  ) => mockGenerateCommitMessage(...args),
  getGitStatus: (...args: [string, (string | null)?]) => mockGetGitStatus(...args),
  revertGitAll: (...args: [string, (string | null)?]) => mockRevertGitAll(...args),
  revertGitFile: (...args: [string, string, (string | null)?]) => mockRevertGitFile(...args),
  revertGitPaths: (...args: [string, string[], (string | null)?]) => mockRevertGitPaths(...args),
  stageGitAll: (...args: [string, (string | null)?]) => mockStageGitAll(...args),
  stageGitFile: (...args: [string, string, (string | null)?]) => mockStageGitFile(...args),
  unstageGitAll: (...args: [string, (string | null)?]) => mockUnstageGitAll(...args),
  unstageGitFile: (...args: [string, string, (string | null)?]) => mockUnstageGitFile(...args),
  unstageGitPaths: (...args: [string, string[], (string | null)?]) => mockUnstageGitPaths(...args),
}));

describe("GitHistoryWorktreePanel", () => {
  beforeEach(() => {
    // AI commit 生成会持久化上次 engine/language 配置, 不清理会污染后续测试的菜单路径
    window.localStorage.clear();
    mockGetGitStatus.mockReset();
    mockCommitGit.mockReset();
    mockGenerateCommitMessage.mockReset();
    mockStageGitFile.mockReset();
    mockStageGitAll.mockReset();
    mockUnstageGitFile.mockReset();
    mockUnstageGitAll.mockReset();
    mockUnstageGitPaths.mockReset();
    mockRevertGitFile.mockReset();
    mockRevertGitPaths.mockReset();
    mockRevertGitAll.mockReset();
    mockCommitGit.mockResolvedValue(undefined);
    mockGenerateCommitMessage.mockResolvedValue("Generated commit message");
    mockStageGitFile.mockResolvedValue(undefined);
    mockStageGitAll.mockResolvedValue(undefined);
    mockUnstageGitFile.mockResolvedValue(undefined);
    mockUnstageGitAll.mockResolvedValue(undefined);
    mockUnstageGitPaths.mockResolvedValue(undefined);
    mockRevertGitFile.mockResolvedValue(undefined);
    mockRevertGitPaths.mockResolvedValue(undefined);
    mockRevertGitAll.mockResolvedValue(undefined);
    mockGetGitStatus.mockResolvedValue({
      branchName: "main",
      files: [
        { path: "src/staged.ts", status: "M", additions: 2, deletions: 1 },
        { path: "src/feature/unstaged.ts", status: "M", additions: 3, deletions: 1 },
      ],
      stagedFiles: [{ path: "src/staged.ts", status: "M", additions: 2, deletions: 1 }],
      unstagedFiles: [{ path: "src/feature/unstaged.ts", status: "M", additions: 3, deletions: 1 }],
      totalAdditions: 5,
      totalDeletions: 2,
    });
  });

  afterEach(() => {
    cleanup();
  });

async function chooseCodexEnglishCommitMessage() {
  const generateButton = await waitFor(() => {
    const button = screen.getByRole("button", {
      name: "Generate commit message",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    return button;
  });
  fireEvent.click(generateButton);

  fireEvent.click(await screen.findByRole("button", { name: "English" }));
  const codexItem = screen.getByRole("radio", { name: "Codex" });
  expect(screen.getByRole("radio", { name: "Claude Code" })).toBeTruthy();
  expect(screen.getByRole("radio", { name: "Grok" })).toBeTruthy();
  expect(screen.getByRole("radio", { name: "Kimi" })).toBeTruthy();
  expect(screen.getByRole("radio", { name: "OpenCode" })).toBeTruthy();
  expect(screen.queryByRole("radio", { name: "Gemini" })).toBeNull();
  fireEvent.click(codexItem);
  fireEvent.click(screen.getByRole("button", { name: "Generate with this config" }));
}

  function renderScopedPanel(repositoryRoot: string, onSummaryChange?: (summary: {
    changedFiles: number;
    totalAdditions: number;
    totalDeletions: number;
  }) => void) {
    return (
      <GitHistoryWorktreePanel
        key={`w1:repository:${repositoryRoot}`}
        workspaceId="w1"
        repositoryRoot={repositoryRoot}
        listView="tree"
        onSummaryChange={onSummaryChange}
      />
    );
  }

  it("renders unified file-tree semantic classes in tree mode", async () => {
    render(<GitHistoryWorktreePanel workspaceId="w1" listView="tree" />);

    await waitFor(() => {
      expect(screen.getByLabelText("Staged (1)")).toBeTruthy();
      expect(screen.getByLabelText("Unstaged (1)")).toBeTruthy();
    });

    expect(document.querySelector(".git-history-worktree-section.git-filetree-section")).toBeTruthy();
    expect(document.querySelector(".git-history-worktree-section-header.git-filetree-section-header")).toBeTruthy();
    expect(document.querySelector(".git-history-worktree-folder-row.diff-tree-folder-row.git-filetree-folder-row")).toBeTruthy();
    expect(document.querySelector(".git-history-worktree-file-row.diff-row.git-filetree-row")).toBeTruthy();
    expect(document.querySelector(".git-history-worktree-file-stats.diff-counts-inline.git-filetree-badge")).toBeTruthy();
    expect(document.querySelector(".git-history-worktree-generate.commit-message-generate-button")).toBeTruthy();
    expect(document.querySelector(".git-history-worktree-engine-icon.commit-message-engine-icon")).toBeTruthy();
  });

  it("renders file commit selection checkbox in the trailing meta area without opening diff", async () => {
    const openDiffPath = vi.fn();
    render(
      <GitHistoryWorktreePanel
        workspaceId="w1"
        listView="tree"
        onOpenDiffPath={openDiffPath}
      />,
    );

    const selectionToggle = await screen.findByRole("checkbox", {
      name: "Toggle commit selection: src/staged.ts",
    });
    expect(selectionToggle.closest(".diff-row-meta")).toBeTruthy();
    expect(selectionToggle.classList.contains("git-history-worktree-row-selection")).toBe(true);

    fireEvent.click(selectionToggle);

    expect(openDiffPath).not.toHaveBeenCalled();
  });

  it("keeps stage-file behavior unchanged", async () => {
    render(<GitHistoryWorktreePanel workspaceId="w1" listView="tree" />);

    const stageButton = await screen.findByRole("button", { name: "Stage file" });
    fireEvent.click(stageButton);

    await waitFor(() => {
      expect(mockStageGitFile).toHaveBeenCalledWith("w1", "src/feature/unstaged.ts");
    });
  });

  it("reloads visible files and mutations when repository scope changes", async () => {
    mockGetGitStatus.mockImplementation(async (_workspaceId, repositoryRoot) => {
      const path = repositoryRoot === "services/b" ? "src/from-b.ts" : "src/from-a.ts";
      return {
        branchName: repositoryRoot === "services/b" ? "branch-b" : "branch-a",
        files: [{ path, status: "M", additions: 1, deletions: 0 }],
        stagedFiles: [],
        unstagedFiles: [{ path, status: "M", additions: 1, deletions: 0 }],
        totalAdditions: 1,
        totalDeletions: 0,
      };
    });
    const { rerender } = render(
      <GitHistoryWorktreePanel
        workspaceId="w1"
        repositoryRoot="services/a"
        rootFolderName="service-a"
        listView="tree"
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("src/from-a.ts")).toBeTruthy();
    }, { timeout: 500 });
    rerender(
      <GitHistoryWorktreePanel
        workspaceId="w1"
        repositoryRoot="services/b"
        rootFolderName="service-b"
        listView="tree"
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("src/from-b.ts")).toBeTruthy();
    }, { timeout: 500 });
    expect(screen.queryByLabelText("src/from-a.ts")).toBeNull();
    expect(screen.getByText("service-b", { selector: ".diff-tree-folder-name" })).toBeTruthy();
    expect(mockGetGitStatus).toHaveBeenCalledWith("w1", "services/b");

    fireEvent.click(screen.getByRole("button", { name: "Stage file" }));
    await waitFor(() => {
      expect(mockStageGitFile).toHaveBeenCalledWith("w1", "src/from-b.ts", "services/b");
    });
  });

  it("ignores a stale status response from the previously selected repository", async () => {
    const staleStatus = {
      branchName: "branch-a",
      files: [{ path: "src/stale-a.ts", status: "M", additions: 1, deletions: 0 }],
      stagedFiles: [],
      unstagedFiles: [{ path: "src/stale-a.ts", status: "M", additions: 1, deletions: 0 }],
      totalAdditions: 1,
      totalDeletions: 0,
    };
    const currentStatus = {
      branchName: "branch-b",
      files: [{ path: "src/current-b.ts", status: "M", additions: 2, deletions: 0 }],
      stagedFiles: [],
      unstagedFiles: [{ path: "src/current-b.ts", status: "M", additions: 2, deletions: 0 }],
      totalAdditions: 2,
      totalDeletions: 0,
    };
    let resolveStaleStatus: (status: typeof staleStatus) => void = () => undefined;
    const pendingStaleStatus = new Promise<typeof staleStatus>((resolve) => {
      resolveStaleStatus = resolve;
    });
    mockGetGitStatus.mockImplementation(async (_workspaceId, repositoryRoot) =>
      repositoryRoot === "services/a" ? pendingStaleStatus : currentStatus,
    );
    const { rerender } = render(
      <GitHistoryWorktreePanel
        workspaceId="w1"
        repositoryRoot="services/a"
        listView="tree"
      />,
    );
    await waitFor(() => {
      expect(mockGetGitStatus).toHaveBeenCalledWith("w1", "services/a");
    });

    rerender(
      <GitHistoryWorktreePanel
        workspaceId="w1"
        repositoryRoot="services/b"
        listView="tree"
      />,
    );
    expect(await screen.findByLabelText("src/current-b.ts")).toBeTruthy();

    await act(async () => {
      resolveStaleStatus(staleStatus);
      await pendingStaleStatus;
    });
    expect(screen.queryByLabelText("src/stale-a.ts")).toBeNull();
    expect(screen.getByLabelText("src/current-b.ts")).toBeTruthy();
  });

  it("keeps a completed mutation from the previous repository out of the current view", async () => {
    mockGetGitStatus.mockImplementation(async (_workspaceId, repositoryRoot) => {
      const path = repositoryRoot === "services/b" ? "src/current-b.ts" : "src/current-a.ts";
      return {
        branchName: repositoryRoot === "services/b" ? "branch-b" : "branch-a",
        files: [{ path, status: "M", additions: 1, deletions: 0 }],
        stagedFiles: [],
        unstagedFiles: [{ path, status: "M", additions: 1, deletions: 0 }],
        totalAdditions: 1,
        totalDeletions: 0,
      };
    });
    let resolveStage: () => void = () => undefined;
    const pendingStage = new Promise<void>((resolve) => {
      resolveStage = resolve;
    });
    mockStageGitFile.mockReturnValue(pendingStage);
    const { rerender } = render(renderScopedPanel("services/a"));

    expect(await screen.findByLabelText("src/current-a.ts")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stage file" }));
    await waitFor(() => {
      expect(mockStageGitFile).toHaveBeenCalledWith(
        "w1",
        "src/current-a.ts",
        "services/a",
      );
    });

    rerender(renderScopedPanel("services/b"));
    expect(await screen.findByLabelText("src/current-b.ts")).toBeTruthy();
    await act(async () => {
      resolveStage();
      await pendingStage;
      await Promise.resolve();
    });

    expect(screen.queryByLabelText("src/current-a.ts")).toBeNull();
    expect(screen.getByLabelText("src/current-b.ts")).toBeTruthy();
  });

  it("ignores commit messages generated for a repository that is no longer selected", async () => {
    let resolveGeneratedMessage: (message: string) => void = () => undefined;
    const pendingGeneration = new Promise<string>((resolve) => {
      resolveGeneratedMessage = resolve;
    });
    mockGenerateCommitMessage.mockReturnValue(pendingGeneration);
    const { rerender } = render(renderScopedPanel("services/a"));

    await chooseCodexEnglishCommitMessage();
    await waitFor(() => {
      expect(mockGenerateCommitMessage).toHaveBeenCalled();
    });
    rerender(renderScopedPanel("services/b"));
    expect(await screen.findByRole("button", { name: "Generate commit message" })).toBeTruthy();

    await act(async () => {
      resolveGeneratedMessage("message from repository a");
      await pendingGeneration;
      await Promise.resolve();
    });

    expect((screen.getByPlaceholderText("Commit message") as HTMLTextAreaElement).value).toBe("");
  });

  it("resets same-path commit selection when repository identity changes", async () => {
    mockGetGitStatus.mockResolvedValue({
      branchName: "main",
      files: [{ path: "pom.xml", status: "M", additions: 1, deletions: 0 }],
      stagedFiles: [{ path: "pom.xml", status: "M", additions: 1, deletions: 0 }],
      unstagedFiles: [],
      totalAdditions: 1,
      totalDeletions: 0,
    });
    const { rerender } = render(renderScopedPanel("services/a"));
    const repositoryASelection = await screen.findByRole("checkbox", {
      name: "Toggle commit selection: pom.xml",
    });
    expect(repositoryASelection.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(repositoryASelection);
    expect(repositoryASelection.getAttribute("aria-checked")).toBe("false");

    rerender(renderScopedPanel("services/b"));
    await waitFor(() => {
      expect(screen.getByRole("checkbox", {
        name: "Toggle commit selection: pom.xml",
      }).getAttribute("aria-checked")).toBe("true");
    });
  });

  it("clears the previous repository summary before the next status resolves or fails", async () => {
    const repositoryAStatus = {
      branchName: "branch-a",
      files: [{ path: "src/a.ts", status: "M", additions: 7, deletions: 2 }],
      stagedFiles: [],
      unstagedFiles: [{ path: "src/a.ts", status: "M", additions: 7, deletions: 2 }],
      totalAdditions: 7,
      totalDeletions: 2,
    };
    let rejectRepositoryBStatus: (error: Error) => void = () => undefined;
    const pendingRepositoryBStatus = new Promise<never>((_resolve, reject) => {
      rejectRepositoryBStatus = reject;
    });
    mockGetGitStatus.mockImplementation(async (_workspaceId, repositoryRoot) =>
      repositoryRoot === "services/a" ? repositoryAStatus : pendingRepositoryBStatus,
    );
    const onSummaryChange = vi.fn();
    const { rerender } = render(renderScopedPanel("services/a", onSummaryChange));
    await waitFor(() => {
      expect(onSummaryChange).toHaveBeenLastCalledWith({
        changedFiles: 1,
        totalAdditions: 7,
        totalDeletions: 2,
      });
    });

    rerender(renderScopedPanel("services/b", onSummaryChange));
    await waitFor(() => {
      expect(onSummaryChange).toHaveBeenLastCalledWith({
        changedFiles: 0,
        totalAdditions: 0,
        totalDeletions: 0,
      });
    });
    await act(async () => {
      rejectRepositoryBStatus(new Error("repository b unavailable"));
      await pendingRepositoryBStatus.catch(() => undefined);
    });
    expect(onSummaryChange).toHaveBeenLastCalledWith({
      changedFiles: 0,
      totalAdditions: 0,
      totalDeletions: 0,
    });
  });

  it("renders Windows-style file paths with correct leaf names", async () => {
    mockGetGitStatus.mockResolvedValue({
      branchName: "main",
      files: [
        { path: "src\\staged.ts", status: "M", additions: 2, deletions: 1 },
        { path: "src\\feature\\unstaged.ts", status: "M", additions: 3, deletions: 1 },
      ],
      stagedFiles: [{ path: "src\\staged.ts", status: "M", additions: 2, deletions: 1 }],
      unstagedFiles: [{ path: "src\\feature\\unstaged.ts", status: "M", additions: 3, deletions: 1 }],
      totalAdditions: 5,
      totalDeletions: 2,
    });

    render(<GitHistoryWorktreePanel workspaceId="w1" listView="tree" />);

    await waitFor(() => {
      expect(screen.getByLabelText("src\\feature\\unstaged.ts")).toBeTruthy();
    });
  });

  it("renders package-only worktree folders in a.b.c style", async () => {
    mockGetGitStatus.mockResolvedValue({
      branchName: "main",
      files: [
        {
          path: "test/java/com/example/demo/service/UserServiceTest.java",
          status: "M",
          additions: 95,
          deletions: 2,
        },
      ],
      stagedFiles: [],
      unstagedFiles: [
        {
          path: "test/java/com/example/demo/service/UserServiceTest.java",
          status: "M",
          additions: 95,
          deletions: 2,
        },
      ],
      totalAdditions: 95,
      totalDeletions: 2,
    });

    render(<GitHistoryWorktreePanel workspaceId="w1" listView="tree" />);

    await waitFor(() => {
      expect(screen.getByText("test.java.com.example.demo.service")).toBeTruthy();
    });
    expect(screen.queryByText("java", { selector: ".diff-tree-folder-name" })).toBeNull();
    expect(screen.queryByText("com", { selector: ".diff-tree-folder-name" })).toBeNull();
  });

  it("keeps worktree branch folders unmerged when a folder contains files and child folders", async () => {
    mockGetGitStatus.mockResolvedValue({
      branchName: "main",
      files: [
        { path: "service/UserService.java", status: "M", additions: 42, deletions: 2 },
        { path: "service/impl/UserServiceImpl.java", status: "M", additions: 57, deletions: 3 },
      ],
      stagedFiles: [],
      unstagedFiles: [
        { path: "service/UserService.java", status: "M", additions: 42, deletions: 2 },
        { path: "service/impl/UserServiceImpl.java", status: "M", additions: 57, deletions: 3 },
      ],
      totalAdditions: 99,
      totalDeletions: 5,
    });

    render(<GitHistoryWorktreePanel workspaceId="w1" listView="tree" />);

    await waitFor(() => {
      expect(screen.getByText("service", { selector: ".diff-tree-folder-name" })).toBeTruthy();
    });
    expect(screen.queryByText("service.impl", { selector: ".diff-tree-folder-name" })).toBeNull();
    expect(screen.getByText("impl", { selector: ".diff-tree-folder-name" })).toBeTruthy();
  });

  it("generates English commit message after menu selection", async () => {
    render(<GitHistoryWorktreePanel workspaceId="w1" listView="tree" />);

    await screen.findByRole("button", { name: "Generate commit message" });
    await chooseCodexEnglishCommitMessage();

    await waitFor(() => {
      expect(mockGenerateCommitMessage).toHaveBeenCalledWith(
        "w1",
        "en",
        "codex",
        ["src/staged.ts"],
      );
    });
  });

  it("keeps engine and language selection visible with a last saved configuration", async () => {
    saveLastCommitMessageConfig({ engine: "codex", language: "zh" });
    render(<GitHistoryWorktreePanel workspaceId="w1" listView="tree" />);

    const generateButton = await waitFor(() => {
      const button = screen.getByRole("button", {
        name: "Generate commit message",
      }) as HTMLButtonElement;
      expect(button.disabled).toBe(false);
      return button;
    });
    fireEvent.click(generateButton);

    expect(await screen.findByRole("radio", { name: "Codex" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Claude Code" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Use last configuration/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "English" })).toBeTruthy();
    expect(mockGenerateCommitMessage).not.toHaveBeenCalled();
  });

  it("generates from the visible last-configuration quick option", async () => {
    saveLastCommitMessageConfig({ engine: "codex", language: "zh" });
    render(<GitHistoryWorktreePanel workspaceId="w1" listView="tree" />);

    const generateButton = await waitFor(() => {
      const button = screen.getByRole("button", {
        name: "Generate commit message",
      }) as HTMLButtonElement;
      expect(button.disabled).toBe(false);
      return button;
    });
    fireEvent.click(generateButton);
    fireEvent.click(await screen.findByRole("button", { name: /^Use last configuration/ }));

    await waitFor(() => {
      expect(mockGenerateCommitMessage).toHaveBeenCalledWith(
        "w1",
        "zh",
        "codex",
        ["src/staged.ts"],
      );
    });
  });

  it("scopes commit message generation to the selected repository", async () => {
    render(
      <GitHistoryWorktreePanel
        workspaceId="w1"
        repositoryRoot="services/b"
        listView="tree"
      />,
    );

    await chooseCodexEnglishCommitMessage();

    await waitFor(() => {
      expect(mockGenerateCommitMessage).toHaveBeenCalledWith(
        "w1",
        "en",
        "codex",
        undefined,
        [{ repositoryRoot: "services/b", selectedPaths: ["src/staged.ts"] }],
      );
    });
  });

  it("shows the same staged-default commit hint as the main git panel", async () => {
    render(<GitHistoryWorktreePanel workspaceId="w1" listView="tree" />);

    await waitFor(() => {
      expect(mockGetGitStatus).toHaveBeenCalledWith("w1");
    });
    await act(async () => {
      await mockGetGitStatus.mock.results[0]?.value;
    });

    expect(screen.getByText("1 file selected for commit")).toBeTruthy();
  });

  it("toggles unstaged file selection and commits only the scoped file", async () => {
    mockGetGitStatus.mockResolvedValue({
      branchName: "main",
      files: [{ path: "src/only-unstaged.ts", status: "M", additions: 1, deletions: 0 }],
      stagedFiles: [],
      unstagedFiles: [{ path: "src/only-unstaged.ts", status: "M", additions: 1, deletions: 0 }],
      totalAdditions: 1,
      totalDeletions: 0,
    });

    render(<GitHistoryWorktreePanel workspaceId="w1" listView="tree" />);

    const selectionToggle = await screen.findByRole("checkbox", {
      name: "Toggle commit selection: src/only-unstaged.ts",
    });
    fireEvent.click(selectionToggle);

    const commitInput = screen.getByPlaceholderText("Commit message");
    fireEvent.change(commitInput, { target: { value: "feat: scoped history commit" } });
    fireEvent.click(screen.getByRole("button", { name: "Commit" }));

    await waitFor(() => {
      expect(mockStageGitFile).toHaveBeenCalledWith("w1", "src/only-unstaged.ts");
      expect(mockCommitGit).toHaveBeenCalledWith("w1", "feat: scoped history commit");
    });
    expect(mockStageGitAll).not.toHaveBeenCalled();
  });

  it("scopes selected-file commit mutations to the selected repository", async () => {
    mockGetGitStatus.mockResolvedValue({
      branchName: "main",
      files: [{ path: "src/only-unstaged.ts", status: "M", additions: 1, deletions: 0 }],
      stagedFiles: [],
      unstagedFiles: [{ path: "src/only-unstaged.ts", status: "M", additions: 1, deletions: 0 }],
      totalAdditions: 1,
      totalDeletions: 0,
    });
    render(
      <GitHistoryWorktreePanel
        workspaceId="w1"
        repositoryRoot="services/b"
        listView="tree"
      />,
    );

    fireEvent.click(await screen.findByRole("checkbox", {
      name: "Toggle commit selection: src/only-unstaged.ts",
    }));
    fireEvent.change(screen.getByPlaceholderText("Commit message"), {
      target: { value: "fix: scoped repository commit" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Commit" }));

    await waitFor(() => {
      expect(mockStageGitFile).toHaveBeenCalledWith(
        "w1",
        "src/only-unstaged.ts",
        "services/b",
      );
      expect(mockCommitGit).toHaveBeenCalledWith(
        "w1",
        "fix: scoped repository commit",
        "services/b",
      );
    });
  });

  it("passes selected unstaged scope into commit message generation", async () => {
    mockGetGitStatus.mockResolvedValue({
      branchName: "main",
      files: [{ path: "src/only-unstaged.ts", status: "M", additions: 1, deletions: 0 }],
      stagedFiles: [],
      unstagedFiles: [{ path: "src/only-unstaged.ts", status: "M", additions: 1, deletions: 0 }],
      totalAdditions: 1,
      totalDeletions: 0,
    });
    render(<GitHistoryWorktreePanel workspaceId="w1" listView="tree" />);

    fireEvent.click(
      await screen.findByRole("checkbox", {
        name: "Toggle commit selection: src/only-unstaged.ts",
      }),
    );
    await chooseCodexEnglishCommitMessage();

    await waitFor(() => {
      expect(mockGenerateCommitMessage).toHaveBeenCalledWith(
        "w1",
        "en",
        "codex",
        ["src/only-unstaged.ts"],
      );
    });
  });

  it("passes an explicit empty scope after clearing staged defaults", async () => {
    render(<GitHistoryWorktreePanel workspaceId="w1" listView="tree" />);

    fireEvent.click(
      await screen.findByRole("checkbox", {
        name: "Toggle commit selection: src/staged.ts",
      }),
    );
    await chooseCodexEnglishCommitMessage();

    await waitFor(() => {
      expect(mockGenerateCommitMessage).toHaveBeenCalledWith("w1", "en", "codex", []);
    });
  });

  it("keeps an explicit empty scope after the user selects and re-clears an unstaged file", async () => {
    mockGetGitStatus.mockResolvedValue({
      branchName: "main",
      files: [{ path: "src/only-unstaged.ts", status: "M", additions: 1, deletions: 0 }],
      stagedFiles: [],
      unstagedFiles: [{ path: "src/only-unstaged.ts", status: "M", additions: 1, deletions: 0 }],
      totalAdditions: 1,
      totalDeletions: 0,
    });
    render(<GitHistoryWorktreePanel workspaceId="w1" listView="tree" />);

    const selectionToggle = await screen.findByRole("checkbox", {
      name: "Toggle commit selection: src/only-unstaged.ts",
    });
    fireEvent.click(selectionToggle);
    fireEvent.click(selectionToggle);
    await chooseCodexEnglishCommitMessage();

    await waitFor(() => {
      expect(mockGenerateCommitMessage).toHaveBeenCalledWith("w1", "en", "codex", []);
    });
  });

  it("keeps tree folder rows free of commit checkboxes and normalizes Windows file selection", async () => {
    mockGetGitStatus.mockResolvedValue({
      branchName: "main",
      files: [{ path: "src\\feature\\only-unstaged.ts", status: "M", additions: 1, deletions: 0 }],
      stagedFiles: [],
      unstagedFiles: [{ path: "src\\feature\\only-unstaged.ts", status: "M", additions: 1, deletions: 0 }],
      totalAdditions: 1,
      totalDeletions: 0,
    });

    render(<GitHistoryWorktreePanel workspaceId="w1" listView="tree" />);

    expect(
      screen.queryByRole("checkbox", {
        name: "Toggle commit selection: src",
      }),
    ).toBeNull();

    fireEvent.click(
      await screen.findByRole("checkbox", {
        name: "Toggle commit selection: src\\feature\\only-unstaged.ts",
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("1 file selected for commit")).toBeTruthy();
    });
  });

  it("renders engine icon in generate button", async () => {
    render(<GitHistoryWorktreePanel workspaceId="w1" listView="tree" />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Generate commit message" })).toBeTruthy();
    });

    expect(document.querySelector(".git-history-worktree-engine-icon")).toBeTruthy();
  });

  it("hides empty sections when there are no files in that section", async () => {
    mockGetGitStatus.mockResolvedValue({
      branchName: "main",
      files: [{ path: "src/staged.ts", status: "M", additions: 2, deletions: 1 }],
      stagedFiles: [{ path: "src/staged.ts", status: "M", additions: 2, deletions: 1 }],
      unstagedFiles: [],
      totalAdditions: 2,
      totalDeletions: 1,
    });

    render(<GitHistoryWorktreePanel workspaceId="w1" listView="tree" />);

    await waitFor(() => {
      expect(screen.getAllByLabelText("Staged (1)").length).toBeGreaterThan(0);
    });

    expect(screen.queryByText("Unstaged (0)")).toBeNull();
    expect(screen.queryByText("No changes")).toBeNull();
  });

  it("renders compact summary bar when only one section is visible", async () => {
    mockGetGitStatus.mockResolvedValue({
      branchName: "main",
      files: [{ path: "src/staged.ts", status: "M", additions: 2, deletions: 1 }],
      stagedFiles: [{ path: "src/staged.ts", status: "M", additions: 2, deletions: 1 }],
      unstagedFiles: [],
      totalAdditions: 2,
      totalDeletions: 1,
    });

    render(<GitHistoryWorktreePanel workspaceId="w1" listView="tree" commitSectionCollapsed />);

    await waitFor(() => {
      expect(document.querySelector(".git-history-worktree-summary-bar")).toBeTruthy();
    });

    expect(screen.getByText("main")).toBeTruthy();
    expect(screen.getAllByLabelText("Staged (1)").length).toBeGreaterThan(0);
  });

  it("hides commit box when commit section is collapsed", async () => {
    render(<GitHistoryWorktreePanel workspaceId="w1" listView="tree" commitSectionCollapsed />);

    await waitFor(() => {
      expect(screen.getByLabelText("Staged (1)")).toBeTruthy();
    });

    expect(screen.queryByPlaceholderText("Commit message")).toBeNull();
    expect(screen.queryByRole("button", { name: "Commit" })).toBeNull();
  });

  it("shows empty-state text when both staged and unstaged sections are empty", async () => {
    mockGetGitStatus.mockResolvedValue({
      branchName: "main",
      files: [],
      stagedFiles: [],
      unstagedFiles: [],
      totalAdditions: 0,
      totalDeletions: 0,
    });

    render(<GitHistoryWorktreePanel workspaceId="w1" listView="tree" commitSectionCollapsed />);

    await waitFor(() => {
      expect(screen.getByText("No changes")).toBeTruthy();
    });
  });

  it("disables commit and avoids auto-stage-all when only unstaged files exist", async () => {
    mockGetGitStatus.mockResolvedValue({
      branchName: "main",
      files: [{ path: "src/only-unstaged.ts", status: "M", additions: 1, deletions: 0 }],
      stagedFiles: [],
      unstagedFiles: [{ path: "src/only-unstaged.ts", status: "M", additions: 1, deletions: 0 }],
      totalAdditions: 1,
      totalDeletions: 0,
    });

    render(<GitHistoryWorktreePanel workspaceId="w1" listView="tree" />);

    expect(await screen.findByLabelText("src/only-unstaged.ts")).toBeTruthy();
    const commitButton = await screen.findByRole("button", { name: "Commit" });
    expect((commitButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Select files to commit first")).toBeTruthy();

    fireEvent.click(commitButton);
    expect(mockStageGitAll).not.toHaveBeenCalled();
    expect(mockCommitGit).not.toHaveBeenCalled();
  });
});
