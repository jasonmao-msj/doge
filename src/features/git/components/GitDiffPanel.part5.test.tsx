/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  resetClientStorageForTests,
  writeClientStoreValue,
} from "../../../services/clientStorage";
import type { GitLogEntry } from "../../../types";

const mockPreviewSave = vi.fn(async () => true);
const mockPreviewDiscard = vi.fn();
const mockEditableDiffReviewSurface = vi.fn((props: Record<string, unknown>) => (
  <div data-testid="git-diff-viewer">
    {typeof props.onDirtyChange === "function" ? (
      <button type="button" onClick={() => {
        if (typeof props.onDraftActionsChange === "function") {
          (props.onDraftActionsChange as (actions: unknown) => void)({
            save: mockPreviewSave,
            discard: mockPreviewDiscard,
            isSaving: false,
          });
        }
        (props.onDirtyChange as (dirty: boolean) => void)(true);
      }}>
        Mock dirty preview
      </button>
    ) : null}
    {typeof props.onRequestClose === "function" ? (
      <button type="button" onClick={() => (props.onRequestClose as () => void)()}>
        Mock close preview
      </button>
    ) : null}
  </div>
));

// Mock react-i18next
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        "git.commit": "Commit",
        "git.committing": "Committing...",
        "git.commitMessage": "Commit message...",
        "git.staged": "Staged Changes",
        "git.unstaged": "Changes",
        "git.commitStagedChanges": "Commit staged changes",
        "git.commitAllChanges": "Commit all unstaged changes",
        "git.noChangesToCommit": "No changes to commit",
        "git.enterCommitMessage": "Enter commit message",
        "git.selectFilesToCommit": "Select files to commit first",
        "git.selectedFilesForCommit": "{{count}} file selected for commit",
        "git.selectedFilesForCommit_other": "{{count}} files selected for commit",
        "git.commitSelectedChanges": "Commit selected changes",
        "git.commitSelectionToggleFile": "Toggle commit selection: {{path}}",
        "git.commitSelectionToggleScope": "Toggle commit selection: {{path}}",
        "git.sectionActions": "{{title}} actions",
        "git.commitRestoreSelectionFailed": "Commit completed, but failed to restore excluded staged files: {{error}}",
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
        "git.generateCommitMessageWithConfig": "Generate with this config",
        "git.generateCommitMessageQuick": "Regenerate with current configuration",
        "git.generatingCommitMessage": "Generating…",
        "git.commitMessageAvailableEngines": "Engines",
        "git.commitWithCount": "Commit ({{count}})",
        "common.language": "Language",
        "git.commitComposerPlacementMenuLabel": "Commit box position",
        "git.commitComposerPlacementBottom": "Bottom",
        "git.commitComposerPlacementTop": "Top",
        "git.listFlat": "Flat",
        "git.listTree": "Tree",
        "git.listView": "List view",
        "git.refreshStatus": "Refresh Git status",
        "git.toggleCommitSection": "Toggle commit section",
        "git.panelView": "Git panel view",
        "git.previewInline": "Preview in center pane",
        "git.previewInlineAction": "Preview diff in center pane",
        "git.previewModal": "Preview in modal",
        "git.previewModalAction": "Open diff preview modal",
        "git.openFileContent": "Open file",
        "git.openFileContentAction": "Open file content",
        "git.diffMode": "Diff",
        "git.diffModeDescription": "Inspect file changes",
        "git.logMode": "Git",
        "git.logModeDescription": "Browse commits and history",
        "git.issuesMode": "Issues",
        "git.issuesModeDescription": "Track repository issues",
        "git.prsMode": "PRs",
        "git.prsModeDescription": "Review pull requests",
        "git.fileActions": "File actions",
        "git.repositoryMenuTitle": "Git",
        "git.repositoryMenuFileHistory": "Show file history",
        "git.stageFile": "Stage file",
        "git.stageFiles": "Stage files",
        "git.stageChanges": "Stage changes",
        "git.stageAllChangesAction": "Stage all changes",
        "git.path": "Path:",
        "git.change": "Switch",
        "git.unstageFile": "Unstage file",
        "git.unstageFiles": "Unstage files",
        "git.unstageChanges": "Unstage changes",
        "git.unstageAllChangesAction": "Unstage all changes",
        "git.discardChanges": "Discard changes",
        "git.discardChange": "Discard change",
        "git.discardChangeMultiple": "Discard changes",
        "git.statusUnavailable": "Git status unavailable",
        "git.noRepositoriesFound": "No repositories found.",
        "git.historyQuickAction": "Git Graph",
        "git.switchRepository": "Switch Git repository",
        "git.switchRepositoryDescription": "Choose which repo the Diff panel uses",
        "menu.maximize": "Maximize",
        "common.restore": "Restore",
        "common.close": "Close",
        "files.unsavedChanges": "Unsaved changes",
        "files.unsavedChangesCloseDescription": "Changes will be lost.",
        "files.saveAndClose": "Save and close",
        "files.saving": "Saving...",
        "files.continueEditing": "Continue editing",
        "files.discardChangesAction": "Discard changes",
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

vi.mock("./WorkspaceEditableDiffReviewSurface", () => ({
  WorkspaceEditableDiffReviewSurface: (props: Record<string, unknown>) =>
    mockEditableDiffReviewSurface(props),
}));

import {
  GitDiffPanel,
  buildDiffTree,
  compactDiffTree,
  resolveBottomCommitMessageMenuPosition,
} from "./GitDiffPanel";
import {
  resolveGitDiffFileHistoryTarget,
  resolveRepositoryWorkspaceFilePath,
} from "./GitDiffPanelFileScope";
import { saveLastCommitMessageConfig } from "../../../utils/commitMessage";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: vi.fn(async () => true),
}));

const logEntries: GitLogEntry[] = [];

const baseProps = {
  mode: "diff" as const,
  onModeChange: vi.fn(),
  filePanelMode: "git" as const,
  onFilePanelModeChange: vi.fn(),
  branchName: "main",
  totalAdditions: 0,
  totalDeletions: 0,
  fileStatus: "1 file changed",
  logEntries,
  stagedFiles: [],
  unstagedFiles: [],
};

afterEach(() => {
  cleanup();
  mockEditableDiffReviewSurface.mockClear();
  mockPreviewSave.mockReset();
  mockPreviewSave.mockResolvedValue(true);
  mockPreviewDiscard.mockReset();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(null);
  resetClientStorageForTests();
  window.localStorage.clear();
});

async function chooseCodexEnglishCommitMessage() {
  fireEvent.click(screen.getByRole("button", { name: "Generate commit message" }));
  fireEvent.click(await screen.findByRole("button", { name: "English" }));
  fireEvent.click(await screen.findByRole("radio", { name: "Codex" }));
  fireEvent.click(await screen.findByRole("button", { name: "Generate with this config" }));
}

async function openGitFileContextMenu(row: HTMLElement) {
  fireEvent.contextMenu(row);
  const gitMenuTrigger = await screen.findByRole("menuitem", { name: "Git" });
  fireEvent.click(gitMenuTrigger);
  return screen.findByRole("menu", { name: "Git" });
}

void [act, cleanup, createEvent, fireEvent, render, screen, waitFor, within, afterEach, describe, expect, it, vi, invoke, resetClientStorageForTests, writeClientStoreValue, mockPreviewSave, mockPreviewDiscard, mockEditableDiffReviewSurface, GitDiffPanel, buildDiffTree, compactDiffTree, resolveBottomCommitMessageMenuPosition, resolveGitDiffFileHistoryTarget, resolveRepositoryWorkspaceFilePath, saveLastCommitMessageConfig, logEntries, baseProps, chooseCodexEnglishCommitMessage, openGitFileContextMenu];

describe("GitDiffPanel", () => {
  it("does not reopen a repository preview closed while its request is pending", async () => {
      let resolvePendingPreview: ((value: unknown) => void) | null = null;
      vi.mocked(invoke).mockImplementation((command) => {
        if (command === "get_git_diffs") {
          return new Promise((resolve) => {
            resolvePendingPreview = resolve;
          });
        }
        return Promise.resolve(null);
      });
      render(
        <GitDiffPanel
          {...baseProps}
          workspaceId="workspace-1"
          workspacePath="/workspace"
          multiRepositoryMode
          repositoryStatuses={[{
            repositoryRoot: "services/api",
            displayName: "api",
            branchName: "main",
            stagedFiles: [],
            unstagedFiles: [{ path: "pom.xml", status: "M", additions: 1, deletions: 1 }],
            totalAdditions: 1,
            totalDeletions: 1,
            error: null,
          }]}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "pom.xml" }));
      const overlay = document.querySelector<HTMLElement>(".git-history-diff-modal-overlay");
      if (!overlay) {
        throw new Error("Expected repository preview overlay to open");
      }
      fireEvent.click(overlay);
      expect(document.querySelector(".git-history-diff-modal")).toBeNull();

      await act(async () => {
        resolvePendingPreview?.([{
          path: "pom.xml",
          status: "M",
          diff: "@@ -1 +1 @@\n-old\n+new",
        }]);
      });
      expect(document.querySelector(".git-history-diff-modal")).toBeNull();
    });

  it("settles a failed repository preview to unavailable", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(invoke).mockImplementation((command) => {
        if (command === "get_git_diffs") {
          return Promise.reject(new Error("scoped diff failed"));
        }
        return Promise.resolve(null);
      });
      render(
        <GitDiffPanel
          {...baseProps}
          workspaceId="workspace-1"
          workspacePath="/workspace"
          multiRepositoryMode
          repositoryStatuses={[{
            repositoryRoot: "services/api",
            displayName: "api",
            branchName: "main",
            stagedFiles: [],
            unstagedFiles: [{ path: "pom.xml", status: "M", additions: 1, deletions: 1 }],
            totalAdditions: 1,
            totalDeletions: 1,
            error: null,
          }]}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "pom.xml" }));
      expect(await screen.findByText("git.diffUnavailable")).toBeTruthy();
      expect(screen.queryByText("common.loading")).toBeNull();
      expect(errorSpy).toHaveBeenCalledWith(
        "Failed to load repository-scoped git diff",
        expect.any(Error),
      );
    });

  it("closes a single-repository preview when the selected git root changes", async () => {
      const previewProps = {
        ...baseProps,
        workspaceId: "workspace-1",
        workspacePath: "/workspace",
        gitRoot: "services/a",
        unstagedFiles: [{ path: "pom.xml", status: "M", additions: 1, deletions: 1 }],
        diffEntries: [{
          path: "pom.xml",
          status: "M",
          diff: "@@ -1 +1 @@\n-old\n+new",
        }],
      };
      const { rerender } = render(<GitDiffPanel {...previewProps} />);

      fireEvent.click(screen.getByLabelText("pom.xml"));
      expect(document.querySelector(".git-history-diff-modal")).toBeTruthy();

      rerender(<GitDiffPanel {...previewProps} gitRoot="services/b" />);
      await waitFor(() => {
        expect(document.querySelector(".git-history-diff-modal")).toBeNull();
      });
    });

  it("disables the last-config footer action when no previous generation exists", async () => {
      render(
        <GitDiffPanel
          {...baseProps}
          onGenerateCommitMessage={vi.fn()}
          unstagedFiles={[{ path: "file.txt", status: "M", additions: 1, deletions: 0 }]}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Generate commit message" }));

      expect(
        await screen.findByRole("button", { name: "Generate with this config" }),
      ).toBeTruthy();
      expect(
        (
          screen.getByRole("button", {
            name: "Use last configuration",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
    });

  it("disables the last-config footer action for a retired engine", async () => {
      window.localStorage.setItem(
        "doge.git.lastCommitMessageConfig",
        JSON.stringify({ engine: "retired-engine", language: "en" }),
      );
      render(
        <GitDiffPanel
          {...baseProps}
          onGenerateCommitMessage={vi.fn()}
          unstagedFiles={[{ path: "file.txt", status: "M", additions: 1, deletions: 0 }]}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Generate commit message" }));

      expect(
        await screen.findByRole("button", { name: "Generate with this config" }),
      ).toBeTruthy();
      expect(
        (
          screen.getByRole("button", {
            name: "Use last configuration",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
    });

  it("regenerates directly with the remembered engine and language from the quick option", async () => {
      const onGenerateCommitMessage = vi.fn();

      render(
        <GitDiffPanel
          {...baseProps}
          onGenerateCommitMessage={onGenerateCommitMessage}
          unstagedFiles={[{ path: "file.txt", status: "M", additions: 1, deletions: 0 }]}
        />,
      );
      await chooseCodexEnglishCommitMessage();
      await waitFor(() => {
        expect(onGenerateCommitMessage).toHaveBeenCalledWith("en", "codex");
      });

      // 上次配置仍是可见 quick option，不改变主按钮的显式选择语义。
      fireEvent.click(screen.getByRole("button", { name: "Generate commit message" }));
      fireEvent.click(
        await screen.findByRole("button", { name: /^Use last configuration/ }),
      );

      await waitFor(() => {
        expect(onGenerateCommitMessage).toHaveBeenCalledTimes(2);
      });
      expect(onGenerateCommitMessage).toHaveBeenLastCalledWith("en", "codex");
    });

  it("passes selected commit scope when generating commit message from the commit section", async () => {
      const onGenerateCommitMessage = vi.fn();

      render(
        <GitDiffPanel
          {...baseProps}
          onGenerateCommitMessage={onGenerateCommitMessage}
          unstagedFiles={[{ path: "file.txt", status: "M", additions: 1, deletions: 0 }]}
        />,
      );
      fireEvent.click(
        screen.getByRole("checkbox", { name: "Toggle commit selection: file.txt" }),
      );
      await chooseCodexEnglishCommitMessage();

      await waitFor(() => {
        expect(onGenerateCommitMessage).toHaveBeenCalledWith("en", "codex", [
          "file.txt",
        ]);
      });
    });

  it("passes an explicit empty scope after the user clears staged defaults", async () => {
      const onGenerateCommitMessage = vi.fn();

      render(
        <GitDiffPanel
          {...baseProps}
          onGenerateCommitMessage={onGenerateCommitMessage}
          stagedFiles={[{ path: "file.txt", status: "M", additions: 1, deletions: 0 }]}
        />,
      );
      fireEvent.click(
        screen.getByRole("checkbox", { name: "Toggle commit selection: file.txt" }),
      );
      await chooseCodexEnglishCommitMessage();

      await waitFor(() => {
        expect(onGenerateCommitMessage).toHaveBeenCalledWith("en", "codex", []);
      });
    });

  it("keeps an explicit empty scope after the user selects and re-clears an unstaged file", async () => {
      const onGenerateCommitMessage = vi.fn();

      render(
        <GitDiffPanel
          {...baseProps}
          onGenerateCommitMessage={onGenerateCommitMessage}
          unstagedFiles={[{ path: "file.txt", status: "M", additions: 1, deletions: 0 }]}
        />,
      );
      const selectionToggle = screen.getByRole("checkbox", {
        name: "Toggle commit selection: file.txt",
      });
      fireEvent.click(selectionToggle);
      fireEvent.click(selectionToggle);
      await chooseCodexEnglishCommitMessage();

      await waitFor(() => {
        expect(onGenerateCommitMessage).toHaveBeenCalledWith("en", "codex", []);
      });
    });

  it("shows spinning engine icon while generating commit message", () => {
      render(
        <GitDiffPanel
          {...baseProps}
          commitMessageLoading
          onGenerateCommitMessage={vi.fn()}
          unstagedFiles={[{ path: "file.txt", status: "M", additions: 1, deletions: 0 }]}
        />,
      );
      expect(document.querySelector(".commit-message-engine-icon--spinning")).toBeTruthy();
    });

  it("applies unified file-tree semantic classes without diff stat badges", () => {
      render(
        <GitDiffPanel
          {...baseProps}
          gitDiffListView="tree"
          stagedFiles={[
            { path: "src/core/a.ts", status: "M", additions: 2, deletions: 1 },
          ]}
        />,
      );

      const section = document.querySelector(".diff-section.git-filetree-section");
      const folderRow = document.querySelector(".diff-tree-folder-row.git-filetree-folder-row");
      const fileRow = document.querySelector(".diff-row.git-filetree-row.git-filetree-row--tree");
      const fileRowChildren = Array.from(fileRow?.children ?? []);

      expect(section).toBeTruthy();
      expect(folderRow).toBeTruthy();
      expect(fileRow).toBeTruthy();
      expect(fileRowChildren[0]?.classList.contains("diff-status-letter")).toBe(true);
      expect(fileRowChildren[1]?.classList.contains("diff-file-icon")).toBe(true);
      expect(fileRow?.querySelector(".diff-row-meta .diff-status-letter")).toBeNull();
      expect(fileRow?.querySelector(".diff-counts-inline.git-filetree-badge")).toBeNull();
    });

  it("does not render inline file stats in the compact Source Control list", () => {
      render(
        <GitDiffPanel
          {...baseProps}
          unstagedFiles={[
            {
              path: "src/large.ts",
              status: "M",
              additions: 12_345,
              deletions: 10_001,
            },
          ]}
        />,
      );

      expect(screen.queryByText("+12.3k")).toBeNull();
      expect(screen.queryByText("-10k")).toBeNull();
      const fileRow = document.querySelector(".diff-row.git-filetree-row");
      expect(fileRow?.querySelector(".diff-counts-inline.git-filetree-badge")).toBeNull();
    });

  it("renders single-path diff package folders in a.b.c style", () => {
      render(
        <GitDiffPanel
          {...baseProps}
          gitDiffListView="tree"
          unstagedFiles={[
            {
              path: "test/java/com/example/demo/service/UserServiceTest.java",
              status: "M",
              additions: 95,
              deletions: 2,
            },
          ]}
        />,
      );

      expect(screen.getByText("test.java.com.example.demo.service")).toBeTruthy();
      expect(screen.queryByText("java")).toBeNull();
      expect(screen.queryByText("com")).toBeNull();
    });

  it("keeps diff folder branches unmerged when a folder contains files and child folders", () => {
      render(
        <GitDiffPanel
          {...baseProps}
          gitDiffListView="tree"
          unstagedFiles={[
            { path: "service/UserService.java", status: "M", additions: 42, deletions: 2 },
            { path: "service/impl/UserServiceImpl.java", status: "M", additions: 57, deletions: 3 },
          ]}
        />,
      );

      expect(screen.getByText("service")).toBeTruthy();
      expect(screen.queryByText("service.impl")).toBeNull();
      expect(screen.getByText("impl")).toBeTruthy();
    });

  it("renders compact tree summary in single-section tree mode", () => {
      render(
        <GitDiffPanel
          {...baseProps}
          gitDiffListView="tree"
          gitRoot="/repo/desktop-cc-gui"
          totalAdditions={1}
          totalDeletions={1}
          unstagedFiles={[{ path: "src/main.css", status: "M", additions: 1, deletions: 1 }]}
        />,
      );

      expect(document.querySelector(".git-filetree-section-header.is-compact")).toBeTruthy();
      expect(screen.getByText("desktop-cc-gui")).toBeTruthy();
      expect(screen.getByLabelText("Changes (1)")).toBeTruthy();
    });

  it("keeps staged and unstaged tree sections visually consistent", () => {
      render(
        <GitDiffPanel
          {...baseProps}
          gitDiffListView="tree"
          gitRoot="/repo/codex-2026-03-12-v0.2.7"
          totalAdditions={12}
          totalDeletions={3}
          stagedFiles={[{ path: "src/staged.ts", status: "M", additions: 8, deletions: 1 }]}
          unstagedFiles={[{ path: "src/unstaged.ts", status: "M", additions: 4, deletions: 2 }]}
        />,
      );

      expect(document.querySelectorAll(".git-filetree-section-header.is-compact")).toHaveLength(2);
      expect(screen.getAllByText("codex-2026-03-12-v0.2.7")).toHaveLength(2);
    });

  it("renders compact flat summary in single-section flat mode", () => {
      render(
        <GitDiffPanel
          {...baseProps}
          gitDiffListView="flat"
          gitRoot="/repo/desktop-cc-gui"
          totalAdditions={302}
          totalDeletions={10}
          stagedFiles={[{ path: "src/main.css", status: "M", additions: 302, deletions: 10 }]}
        />,
      );

      const header = document.querySelector(".git-filetree-section-header.is-compact");
      expect(header).toBeTruthy();
      expect(screen.queryByText("1 file changed")).toBeNull();
      expect(screen.queryByText("desktop-cc-gui")).toBeNull();
      expect(screen.getByLabelText("Staged Changes (1)")).toBeTruthy();
      expect(header?.lastElementChild?.classList.contains("diff-section-count-badge")).toBe(true);
      expect(header?.lastElementChild?.textContent).toBe("1");
      expect(header?.lastElementChild?.getAttribute("data-slot")).toBe("badge");
      expect(header?.lastElementChild?.className).toContain("bg-secondary");
      expect(header?.lastElementChild?.className).toContain("text-secondary-foreground");
      expect(header?.lastElementChild?.className).toContain("sm:min-w-4");
    });

  it("renders section line-stats badge aggregating additions and deletions in flat mode", () => {
      render(
        <GitDiffPanel
          {...baseProps}
          gitDiffListView="flat"
          stagedFiles={[
            { path: "src/alpha.ts", status: "M", additions: 3, deletions: 1 },
            { path: "src/beta.ts", status: "M", additions: 5, deletions: 2 },
          ]}
          unstagedFiles={[
            { path: "src/gamma.ts", status: "M", additions: 7, deletions: 4 },
          ]}
        />,
      );

      const headers = document.querySelectorAll(".git-filetree-section-header");
      expect(headers).toHaveLength(2);
      const [stagedHeader, unstagedHeader] = headers;
      expect(stagedHeader?.querySelector(".diff-section-line-stats-badge")?.textContent).toContain("+8");
      expect(stagedHeader?.querySelector(".diff-section-line-stats-badge")?.textContent).toContain("-3");
      expect(stagedHeader?.querySelector(".diff-section-line-stats-badge")?.getAttribute("aria-label")).toBe("+8 -3");
      expect(unstagedHeader?.querySelector(".diff-section-line-stats-badge")?.textContent).toContain("+7");
      expect(unstagedHeader?.querySelector(".diff-section-line-stats-badge")?.textContent).toContain("-4");
      expect(unstagedHeader?.querySelector(".diff-section-line-stats-badge")?.getAttribute("aria-label")).toBe("+7 -4");
    });

  it("renders section line-stats badge aggregating additions and deletions in tree mode", () => {
      render(
        <GitDiffPanel
          {...baseProps}
          gitDiffListView="tree"
          stagedFiles={[
            { path: "src/dir1/a.ts", status: "M", additions: 2, deletions: 0 },
            { path: "src/dir2/b.ts", status: "M", additions: 1, deletions: 4 },
          ]}
        />,
      );

      const header = document.querySelector(".git-filetree-section-header");
      expect(header?.querySelector(".diff-section-line-stats-badge")?.textContent).toContain("+3");
      expect(header?.querySelector(".diff-section-line-stats-badge")?.textContent).toContain("-4");
    });
});
