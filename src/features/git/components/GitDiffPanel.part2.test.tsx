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
  it.each(["flat", "tree"] as const)(
      "routes a single-repository unstaged context-menu Stage through the Git submenu only in %s view",
      async (gitDiffListView) => {
        const onStageFile = vi.fn(async () => undefined);
        const onRevertFile = vi.fn(async () => undefined);
        const onOpenFile = vi.fn();
        const onRefreshGitStatus = vi.fn();
        const onRefreshGitDiffs = vi.fn();
        render(
          <GitDiffPanel
            {...baseProps}
            gitDiffListView={gitDiffListView}
            unstagedFiles={[
              { path: "src/main.ts", status: "M", additions: 1, deletions: 1 },
            ]}
            onStageFile={onStageFile}
            onRevertFile={onRevertFile}
            onOpenFile={onOpenFile}
            onRefreshGitStatus={onRefreshGitStatus}
            onRefreshGitDiffs={onRefreshGitDiffs}
          />,
        );

        const row = document.querySelector<HTMLElement>(
          '.diff-row[data-section="unstaged"][data-path="src/main.ts"]',
        );
        if (!row) {
          throw new Error("Expected unstaged file row");
        }
        const gitMenu = await openGitFileContextMenu(row);

        expect(onStageFile).not.toHaveBeenCalled();
        expect(onRevertFile).not.toHaveBeenCalled();
        expect(onOpenFile).not.toHaveBeenCalled();
        expect(onRefreshGitStatus).not.toHaveBeenCalled();
        expect(onRefreshGitDiffs).not.toHaveBeenCalled();
        expect(
          within(gitMenu)
            .getByRole("menuitem", { name: "Discard change" })
            .classList.contains("is-danger"),
        ).toBe(true);

        fireEvent.click(
          within(gitMenu).getByRole("menuitem", { name: "Stage file" }),
        );

        await waitFor(() => {
          expect(onStageFile).toHaveBeenCalledOnce();
          expect(onStageFile).toHaveBeenCalledWith("src/main.ts");
        });
        expect(onRevertFile).not.toHaveBeenCalled();
        expect(onOpenFile).not.toHaveBeenCalled();
        expect(onRefreshGitStatus).not.toHaveBeenCalled();
        expect(onRefreshGitDiffs).not.toHaveBeenCalled();
      },
    );

  it("keeps same-path staged context-menu actions isolated from the unstaged section", async () => {
      const onStageFile = vi.fn(async () => undefined);
      const onUnstageFile = vi.fn(async () => undefined);
      const onRevertFile = vi.fn(async () => undefined);
      render(
        <GitDiffPanel
          {...baseProps}
          stagedFiles={[
            { path: "shared.ts", status: "M", additions: 1, deletions: 0 },
          ]}
          unstagedFiles={[
            { path: "shared.ts", status: "M", additions: 0, deletions: 1 },
          ]}
          onStageFile={onStageFile}
          onUnstageFile={onUnstageFile}
          onRevertFile={onRevertFile}
        />,
      );

      const stagedRow = document.querySelector<HTMLElement>(
        '.diff-row[data-section="staged"][data-path="shared.ts"]',
      );
      if (!stagedRow) {
        throw new Error("Expected staged file row");
      }
      const gitMenu = await openGitFileContextMenu(stagedRow);

      expect(within(gitMenu).getByRole("menuitem", { name: "Unstage file" })).toBeTruthy();
      expect(within(gitMenu).queryByRole("menuitem", { name: "Stage file" })).toBeNull();
      expect(within(gitMenu).queryByRole("menuitem", { name: "Discard change" })).toBeNull();

      fireEvent.click(within(gitMenu).getByRole("menuitem", { name: "Unstage file" }));

      await waitFor(() => {
        expect(onUnstageFile).toHaveBeenCalledOnce();
        expect(onUnstageFile).toHaveBeenCalledWith("shared.ts");
      });
      expect(onStageFile).not.toHaveBeenCalled();
      expect(onRevertFile).not.toHaveBeenCalled();
    });

  it("limits a single-repository context-menu batch to the clicked section", async () => {
      const onStageFile = vi.fn(async () => undefined);
      const onUnstageFile = vi.fn(async () => undefined);
      const onRevertFile = vi.fn(async () => undefined);
      render(
        <GitDiffPanel
          {...baseProps}
          stagedFiles={[
            { path: "staged-only.ts", status: "M", additions: 1, deletions: 0 },
          ]}
          unstagedFiles={[
            { path: "src/a.ts", status: "M", additions: 1, deletions: 0 },
            { path: "src/b.ts", status: "M", additions: 1, deletions: 0 },
          ]}
          onStageFile={onStageFile}
          onUnstageFile={onUnstageFile}
          onRevertFile={onRevertFile}
        />,
      );

      const selectedRows = [
        document.querySelector<HTMLElement>(
          '.diff-row[data-section="staged"][data-path="staged-only.ts"]',
        ),
        document.querySelector<HTMLElement>(
          '.diff-row[data-section="unstaged"][data-path="src/a.ts"]',
        ),
        document.querySelector<HTMLElement>(
          '.diff-row[data-section="unstaged"][data-path="src/b.ts"]',
        ),
      ];
      if (selectedRows.some((row) => !row)) {
        throw new Error("Expected all staged and unstaged file rows");
      }
      selectedRows.forEach((row) => fireEvent.click(row as HTMLElement, { ctrlKey: true }));

      const gitMenu = await openGitFileContextMenu(selectedRows[1] as HTMLElement);
      expect(within(gitMenu).getByRole("menuitem", { name: "Stage files (2)" })).toBeTruthy();
      expect(within(gitMenu).getByRole("menuitem", { name: "Discard changes (2)" })).toBeTruthy();
      expect(within(gitMenu).queryByRole("menuitem", { name: /Unstage/ })).toBeNull();

      fireEvent.click(within(gitMenu).getByRole("menuitem", { name: "Stage files (2)" }));

      await waitFor(() => {
        expect(onStageFile).toHaveBeenCalledTimes(2);
      });
      expect(onStageFile).toHaveBeenNthCalledWith(1, "src/a.ts");
      expect(onStageFile).toHaveBeenNthCalledWith(2, "src/b.ts");
      expect(onUnstageFile).not.toHaveBeenCalled();
      expect(onRevertFile).not.toHaveBeenCalled();

      const discardMenu = await openGitFileContextMenu(selectedRows[1] as HTMLElement);
      fireEvent.click(
        within(discardMenu).getByRole("menuitem", { name: "Discard changes (2)" }),
      );
      fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
      expect(onRevertFile).not.toHaveBeenCalled();

      const confirmedDiscardMenu = await openGitFileContextMenu(
        selectedRows[1] as HTMLElement,
      );
      fireEvent.click(
        within(confirmedDiscardMenu).getByRole("menuitem", {
          name: "Discard changes (2)",
        }),
      );
      fireEvent.click(
        screen.getByRole("button", { name: "git.discardDialogConfirmAction" }),
      );

      await waitFor(() => {
        expect(onRevertFile).toHaveBeenCalledTimes(2);
      });
      expect(onRevertFile).toHaveBeenNthCalledWith(1, "src/a.ts");
      expect(onRevertFile).toHaveBeenNthCalledWith(2, "src/b.ts");
      expect(onRevertFile).not.toHaveBeenCalledWith("staged-only.ts");
    });

  it.each(["flat", "tree"] as const)(
      "opens nested single-repository File History for only the clicked row in %s view",
      async (gitDiffListView) => {
        const onOpenFileHistory = vi.fn();
        const onStageFile = vi.fn(async () => undefined);
        const onRevertFile = vi.fn(async () => undefined);
        render(
          <GitDiffPanel
            {...baseProps}
            workspaceId="ws-1"
            workspacePath="/workspace"
            gitRoot="/workspace/services/api"
            gitDiffListView={gitDiffListView}
            unstagedFiles={[
              { path: "src/a.ts", status: "M", additions: 1, deletions: 0 },
              { path: "src/b.ts", status: "M", additions: 1, deletions: 0 },
            ]}
            onStageFile={onStageFile}
            onRevertFile={onRevertFile}
            onOpenFileHistory={onOpenFileHistory}
          />,
        );

        const firstRow = document.querySelector<HTMLElement>(
          '.diff-row[data-section="unstaged"][data-path="src/a.ts"]',
        );
        const clickedRow = document.querySelector<HTMLElement>(
          '.diff-row[data-section="unstaged"][data-path="src/b.ts"]',
        );
        if (!firstRow || !clickedRow) {
          throw new Error("Expected both nested repository rows");
        }
        fireEvent.click(firstRow, { ctrlKey: true });
        fireEvent.click(clickedRow, { ctrlKey: true });

        const gitMenu = await openGitFileContextMenu(clickedRow);
        expect(
          within(gitMenu).getByRole("menuitem", { name: "Stage files (2)" }),
        ).toBeTruthy();
        fireEvent.click(
          within(gitMenu).getByRole("menuitem", { name: "Show file history" }),
        );

        expect(onOpenFileHistory).toHaveBeenCalledOnce();
        expect(onOpenFileHistory).toHaveBeenCalledWith({
          workspaceId: "ws-1",
          workspacePath: "/workspace",
          repositoryRoot: "services/api",
          path: "src/b.ts",
          displayPath: "services/api/src/b.ts",
        });
        expect(onStageFile).not.toHaveBeenCalled();
        expect(onRevertFile).not.toHaveBeenCalled();
      },
    );

  it.each([
      {
        path: "mutation-disabled.ts",
        mutationDisabled: true,
      },
      {
        path: "diff-only-fallback.ts",
        isDiffOnlyFallback: true,
      },
    ])("does not expose mutation menu actions for $path", ({ path, ...fileFlags }) => {
      render(
        <GitDiffPanel
          {...baseProps}
          unstagedFiles={[
            {
              path,
              status: "M",
              additions: 1,
              deletions: 1,
              ...fileFlags,
            },
          ]}
          onStageFile={vi.fn(async () => undefined)}
          onRevertFile={vi.fn(async () => undefined)}
        />,
      );

      const row = document.querySelector<HTMLElement>(
        `.diff-row[data-section="unstaged"][data-path="${path}"]`,
      );
      if (!row) {
        throw new Error(`Expected disabled mutation row: ${path}`);
      }
      fireEvent.contextMenu(row);

      expect(screen.queryByRole("menuitem", { name: "Git" })).toBeNull();
    });

  it("keeps File History available on a mutation-disabled row without mutation actions", async () => {
      const onOpenFileHistory = vi.fn();
      render(
        <GitDiffPanel
          {...baseProps}
          workspaceId="ws-1"
          workspacePath="/workspace"
          unstagedFiles={[
            {
              path: "readonly.ts",
              status: "M",
              additions: 1,
              deletions: 1,
              mutationDisabled: true,
            },
          ]}
          onStageFile={vi.fn(async () => undefined)}
          onRevertFile={vi.fn(async () => undefined)}
          onOpenFileHistory={onOpenFileHistory}
        />,
      );

      const row = document.querySelector<HTMLElement>(
        '.diff-row[data-section="unstaged"][data-path="readonly.ts"]',
      );
      if (!row) {
        throw new Error("Expected mutation-disabled row");
      }
      const gitMenu = await openGitFileContextMenu(row);

      expect(
        within(gitMenu).queryByRole("menuitem", { name: "Stage file" }),
      ).toBeNull();
      expect(
        within(gitMenu).queryByRole("menuitem", { name: "Discard change" }),
      ).toBeNull();
      fireEvent.click(
        within(gitMenu).getByRole("menuitem", { name: "Show file history" }),
      );
      expect(onOpenFileHistory).toHaveBeenCalledWith({
        workspaceId: "ws-1",
        workspacePath: "/workspace",
        repositoryRoot: "",
        path: "readonly.ts",
        displayPath: "readonly.ts",
      });
    });

  it("selects language then engine from the layered commit message picker", async () => {
      const onGenerateCommitMessage = vi.fn();

      render(
        <GitDiffPanel
          {...baseProps}
          onGenerateCommitMessage={onGenerateCommitMessage}
          unstagedFiles={[{ path: "file.txt", status: "M", additions: 1, deletions: 0 }]}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Generate commit message" }));
      expect(await screen.findByRole("radio", { name: "Codex" })).toBeTruthy();
      expect(screen.getByRole("radio", { name: "Claude Code" })).toBeTruthy();
      expect(screen.queryByRole("radio", { name: "Gemini" })).toBeNull();
      expect(screen.getByRole("radio", { name: "OpenCode" })).toBeTruthy();
      fireEvent.click(await screen.findByRole("button", { name: "English" }));
      fireEvent.click(screen.getByRole("radio", { name: "Codex" }));
      expect(onGenerateCommitMessage).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Generate with this config" }));

      await waitFor(() => {
        expect(onGenerateCommitMessage).toHaveBeenCalledWith("en", "codex");
      });
    });

  it("keeps engine and language selection visible with a last saved configuration", async () => {
      const onGenerateCommitMessage = vi.fn();
      saveLastCommitMessageConfig({ engine: "codex", language: "zh" });

      render(
        <GitDiffPanel
          {...baseProps}
          onGenerateCommitMessage={onGenerateCommitMessage}
          unstagedFiles={[{ path: "file.txt", status: "M", additions: 1, deletions: 0 }]}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Generate commit message" }));

      expect(await screen.findByRole("radio", { name: "Codex" })).toBeTruthy();
      expect(screen.getByRole("radio", { name: "Claude Code" })).toBeTruthy();
      expect(screen.getByRole("button", { name: /^Use last configuration/ })).toBeTruthy();
      expect(screen.getByRole("button", { name: "English" })).toBeTruthy();
      expect(onGenerateCommitMessage).not.toHaveBeenCalled();
    });

  it("generates from the visible last-configuration quick option", async () => {
      const onGenerateCommitMessage = vi.fn();
      saveLastCommitMessageConfig({ engine: "codex", language: "zh" });

      render(
        <GitDiffPanel
          {...baseProps}
          onGenerateCommitMessage={onGenerateCommitMessage}
          unstagedFiles={[{ path: "file.txt", status: "M", additions: 1, deletions: 0 }]}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Generate commit message" }));
      fireEvent.click(await screen.findByRole("button", { name: /^Use last configuration/ }));

      await waitFor(() => {
        expect(onGenerateCommitMessage).toHaveBeenCalledWith("zh", "codex");
      });
    });

  it("opens layered commit config popover without placement settings", async () => {
      render(
        <GitDiffPanel
          {...baseProps}
          onGenerateCommitMessage={vi.fn()}
          unstagedFiles={[{ path: "file.txt", status: "M", additions: 1, deletions: 0 }]}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Generate commit message" }));
      expect(await screen.findByRole("button", { name: "Generate with this config" })).toBeTruthy();
      expect(screen.queryByText("Commit box position")).toBeNull();
    });
});
