// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GitRepositorySummary, OpenAppTarget } from "../../../types";

const revealInFileManagerMock = vi.fn(async (_path: string) => undefined);
const emitToMock = vi.fn(async () => undefined);

const invokeMock = vi.fn(async (...args: any[]) => {
  const command = args[0];
  if (command === "list_workspace_directory_children") {
    return {
      files: [] as string[],
      directories: [] as string[],
      gitignored_files: [] as string[],
      gitignored_directories: [] as string[],
    };
  }
  if (command === "read_workspace_file") {
    return { content: "", truncated: false };
  }
  if (command === "search_workspace_text") {
    return {
      files: [],
      file_count: 0,
      match_count: 0,
      limit_hit: false,
    };
  }
  return null;
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (value: string) => value,
  invoke: (...args: any[]) => (invokeMock as (...args: any[]) => Promise<any>)(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  emitTo: (...args: any[]) => (emitToMock as (...args: any[]) => Promise<void>)(...args),
}));

vi.mock("../../../services/tauri", () => ({
  getWorkspaceDirectoryChildren: (workspaceId: string, path: string) =>
    invokeMock("list_workspace_directory_children", { workspaceId, path }),
  readWorkspaceFile: (workspaceId: string, path: string) =>
    invokeMock("read_workspace_file", { workspaceId, path }),
  createWorkspaceDirectory: (workspaceId: string, path: string) =>
    invokeMock("create_workspace_directory", { workspaceId, path }),
  copyWorkspaceItem: (workspaceId: string, path: string) =>
    invokeMock("copy_workspace_item", { workspaceId, path }),
  duplicateWorkspaceItem: (workspaceId: string, path: string) =>
    invokeMock("duplicate_workspace_item", { workspaceId, path }),
  pasteWorkspaceItem: (workspaceId: string, sourcePath: string, targetDirectory: string) =>
    invokeMock("paste_workspace_item", { workspaceId, sourcePath, targetDirectory }),
  renameWorkspaceItem: (workspaceId: string, path: string, newName: string) =>
    invokeMock("rename_workspace_item", { workspaceId, path, newName }),
  pasteExternalWorkspaceItems: (
    workspaceId: string,
    sourcePaths: string[],
    targetDirectory: string,
  ) => invokeMock("paste_external_workspace_items", { workspaceId, sourcePaths, targetDirectory }),
  trashWorkspaceItem: (workspaceId: string, path: string) =>
    invokeMock("trash_workspace_item", { workspaceId, path }),
  writeWorkspaceFile: (workspaceId: string, path: string, content: string) =>
    invokeMock("write_workspace_file", { workspaceId, path, content }),
  revealInFileManager: (...args: unknown[]) =>
    revealInFileManagerMock(...(args as [string])),
}));

vi.mock("../../../services/rendererDiagnostics", () => ({
  appendWorkspaceFileListingBudgetDiagnostic: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: vi.fn(async () => true),
}));

vi.mock("../../../components/FileIcon", () => ({
  default: () => <span data-testid="file-icon" />,
}));

vi.mock("./FilePreviewPopover", () => ({
  FilePreviewPopover: () => <div data-testid="file-preview-popover" />,
}));

let FileTreePanel: typeof import("./FileTreePanel").FileTreePanel;

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

beforeAll(async () => {
  ({ FileTreePanel } = await import("./FileTreePanel"));
});

afterEach(() => {
  cleanup();
  invokeMock.mockClear();
  emitToMock.mockClear();
  revealInFileManagerMock.mockClear();
  delete window.handleFilePathFromJava;
  delete window.__fileTreeDragPaths;
  delete window.__fileTreeDragStamp;
  delete window.__fileTreeDragActive;
  delete window.__fileTreeDragPosition;
  delete window.__fileTreeDragOverChat;
  delete window.__fileTreeDragDropped;
  delete window.__fileTreeDragCleanup;
});

describe("FileTreePanel run action isolation", () => {
  it("expands, selects, and repeatedly scrolls a revealed nested file", async () => {
    const scrollIntoView = vi
      .spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(() => undefined);
    const baseProps = {
      workspaceId: "workspace-reveal",
      workspacePath: "/tmp/workspace",
      files: ["src/features/a[1].ts"],
      directories: ["src", "src/features"],
      isLoading: false,
      filePanelMode: "files" as const,
      onFilePanelModeChange: () => undefined,
      onOpenFile: () => undefined,
      openTargets: [] as OpenAppTarget[],
      openAppIconById: {},
      selectedOpenAppId: "",
      onSelectOpenAppId: () => undefined,
    };
    const rendered = render(
      <FileTreePanel
        {...baseProps}
        revealRequest={{
          workspaceId: "workspace-reveal",
          path: "src/features/a[1].ts",
          requestId: 1,
        }}
      />,
    );

    const targetRow = await screen.findByRole("button", { name: "a[1].ts" });
    expect(targetRow.classList.contains("is-selected")).toBe(true);
    expect(targetRow.classList.contains("is-primary")).toBe(true);
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));

    rendered.rerender(
      <FileTreePanel
        {...baseProps}
        revealRequest={{
          workspaceId: "workspace-reveal",
          path: "src/features/a[1].ts",
          requestId: 2,
        }}
      />,
    );

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(2));
    scrollIntoView.mockRestore();
  });

  it("reveals an extensionless file through a progressive lazy directory chain with one request", async () => {
    const previousInvokeImplementation = invokeMock.getMockImplementation();
    const scrollIntoView = vi
      .spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(() => undefined);
    const targetPath = "assets/releases/stable/build-artifact";
    const lazyChildrenByPath = new Map([
      ["assets", { directories: ["assets/releases"], files: [] }],
      ["assets/releases", { directories: ["assets/releases/stable"], files: [] }],
      ["assets/releases/stable", { directories: [], files: [targetPath] }],
      ["docs", { directories: ["docs/new"], files: ["docs/readme.txt"] }],
    ]);

    invokeMock.mockImplementation(async (...args: any[]): Promise<any> => {
      if (args[0] !== "list_workspace_directory_children") {
        return previousInvokeImplementation ? previousInvokeImplementation(...args) : null;
      }
      const path = args[1]?.path as string;
      const children = lazyChildrenByPath.get(path);
      if (!children) {
        return {
          files: [],
          directories: [],
          gitignored_files: [],
          gitignored_directories: [],
        };
      }
      return {
        ...children,
        gitignored_files: [],
        gitignored_directories: [],
        directory_entries: children.directories.map((directoryPath) => ({
          path: directoryPath,
          child_state: "unknown",
        })),
      };
    });

    try {
      render(
        <FileTreePanel
          workspaceId="workspace-progressive-reveal"
          workspacePath="/tmp/workspace"
          files={[]}
          directories={["assets", "docs"]}
          directoryMetadata={[
            { path: "assets", child_state: "unknown" },
            { path: "docs", child_state: "unknown" },
          ]}
          isLoading={false}
          filePanelMode="files"
          onFilePanelModeChange={() => undefined}
          onOpenFile={() => undefined}
          openTargets={[]}
          openAppIconById={{}}
          selectedOpenAppId=""
          onSelectOpenAppId={() => undefined}
          revealRequest={{
            workspaceId: "workspace-progressive-reveal",
            path: targetPath,
            requestId: 1,
          }}
        />,
      );

      const targetRow = await screen.findByRole("button", { name: "build-artifact" });
      await waitFor(() => {
        expect(targetRow.classList.contains("is-selected")).toBe(true);
        expect(targetRow.classList.contains("is-primary")).toBe(true);
      });
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
      expect(invokeMock).toHaveBeenCalledWith("list_workspace_directory_children", {
        workspaceId: "workspace-progressive-reveal",
        path: "assets",
      });
      expect(invokeMock).toHaveBeenCalledWith("list_workspace_directory_children", {
        workspaceId: "workspace-progressive-reveal",
        path: "assets/releases",
      });
      expect(invokeMock).toHaveBeenCalledWith("list_workspace_directory_children", {
        workspaceId: "workspace-progressive-reveal",
        path: "assets/releases/stable",
      });

      const docsRow = screen.getByRole("button", { name: /docs/ });
      fireEvent.click(docsRow);
      await screen.findByRole("button", { name: "readme.txt" });
      expect(docsRow.classList.contains("is-primary")).toBe(true);
    } finally {
      scrollIntoView.mockRestore();
      if (previousInvokeImplementation) {
        invokeMock.mockImplementation(previousInvokeImplementation);
      }
    }
  });

  it("opens root repository file history from the file Git submenu", async () => {
    const onOpenFileHistory = vi.fn();
    const repository: GitRepositorySummary = {
      repositoryRoot: "",
      displayName: "workspace",
      currentBranch: "main",
      headState: "branch",
      upstream: null,
      ahead: 0,
      behind: 0,
      stagedCount: 0,
      modifiedCount: 0,
      untrackedCount: 0,
      conflictedCount: 0,
      fileStatuses: [],
      isClean: true,
      error: null,
    };
    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["README.md"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onOpenFileHistory={onOpenFileHistory}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitRepositories={[repository]}
      />,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: "README.md" }));
    const trigger = await screen.findByRole("menuitem", { name: "git.repositoryMenuTitle" });
    fireEvent.mouseEnter(trigger);
    const gitMenu = await screen.findByRole("menu", { name: "git.repositoryMenuTitle" });
    fireEvent.click(within(gitMenu).getByRole("menuitem", { name: "git.repositoryMenuFileHistory" }));

    expect(onOpenFileHistory).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      workspacePath: "/tmp/workspace",
      repositoryRoot: "",
      path: "README.md",
      displayPath: "README.md",
    });
  });

  it("hides file history when the host has no open capability", () => {
    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["README.md"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitRepositories={[{
          repositoryRoot: "",
          displayName: "workspace",
          currentBranch: "main",
          headState: "branch",
          upstream: null,
          ahead: 0,
          behind: 0,
          stagedCount: 0,
          modifiedCount: 0,
          untrackedCount: 0,
          conflictedCount: 0,
          fileStatuses: [],
          isClean: true,
          error: null,
        }]}
      />,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: "README.md" }));
    expect(screen.queryByRole("menuitem", { name: "git.repositoryMenuTitle" })).toBeNull();
  });

  it("opens nested repository file history with a repository-relative path", async () => {
    const onOpenFileHistory = vi.fn();
    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["packages/app/src/main.ts"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onOpenFileHistory={onOpenFileHistory}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitRepositories={[{
          repositoryRoot: "packages/app",
          displayName: "app",
          currentBranch: "main",
          headState: "branch",
          upstream: null,
          ahead: 0,
          behind: 0,
          stagedCount: 0,
          modifiedCount: 0,
          untrackedCount: 0,
          conflictedCount: 0,
          fileStatuses: [],
          isClean: true,
          error: null,
        }]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /packages/ }));
    fireEvent.click(screen.getByRole("button", { name: /app/ }));
    fireEvent.click(screen.getByRole("button", { name: /src/ }));
    fireEvent.contextMenu(screen.getByRole("button", { name: "main.ts" }));
    const trigger = await screen.findByRole("menuitem", { name: "git.repositoryMenuTitle" });
    fireEvent.mouseEnter(trigger);
    const gitMenu = await screen.findByRole("menu", { name: "git.repositoryMenuTitle" });
    fireEvent.click(within(gitMenu).getByRole("menuitem", { name: "git.repositoryMenuFileHistory" }));

    expect(onOpenFileHistory).toHaveBeenCalledWith(expect.objectContaining({
      repositoryRoot: "packages/app",
      path: "src/main.ts",
      displayPath: "packages/app/src/main.ts",
    }));
  });

  it("shows the focused Git submenu only for an exact repository folder target", async () => {
    const repository: GitRepositorySummary = {
      repositoryRoot: "services/api",
      displayName: "api",
      currentBranch: "main",
      headState: "branch",
      upstream: "origin/main",
      ahead: 0,
      behind: 0,
      stagedCount: 0,
      modifiedCount: 0,
      untrackedCount: 0,
      conflictedCount: 0,
      fileStatuses: [],
      isClean: true,
      error: null,
    };
    const onGitRepositoryAction = vi.fn();
    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["services/api/README.md", "services/web/README.md"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitRepositories={[repository]}
        onGitRepositoryAction={onGitRepositoryAction}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /services/ }));
    const apiRow = screen.getByRole("button", { name: /api/ });
    fireEvent.contextMenu(apiRow);
    const gitMenuTrigger = await screen.findByRole("menuitem", { name: "git.repositoryMenuTitle" });
    fireEvent.mouseEnter(gitMenuTrigger);
    const gitMenu = await screen.findByRole("menu", { name: "git.repositoryMenuTitle" });
    const expectedMenuItems = [
      "Commit", "StageAll", "AddToGitignore", "History", "Push", "Pull", "Fetch",
    ];
    expectedMenuItems.forEach((item) => {
      expect(within(gitMenu).getByRole("menuitem", {
        name: `git.repositoryMenu${item}`,
      })).toBeTruthy();
    });
    expect(within(gitMenu).getByRole("menuitem", {
      name: "git.historyBranchMenuUpdate",
    })).toBeTruthy();
    ["ShowDiff", "CompareRevision", "CompareBranch", "Rollback"].forEach((item) => {
      expect(within(gitMenu).queryByRole("menuitem", {
        name: `git.repositoryMenu${item}`,
      })).toBeNull();
    });
    expect(within(gitMenu).queryByRole("menuitem", { name: "git.repositoryMenuMerge" })).toBeNull();
    fireEvent.click(within(gitMenu).getByRole("menuitem", { name: "git.historyBranchMenuUpdate" }));
    expect(onGitRepositoryAction).toHaveBeenCalledWith({
      action: "update",
      branchName: "main",
      repositoryRoot: "services/api",
    });

    fireEvent.contextMenu(screen.getByRole("button", { name: /web/ }));
    expect(screen.queryByRole("menuitem", { name: "git.repositoryMenuTitle" })).toBeNull();
  });

  it("exposes the same Git submenu from a standalone repository root label", async () => {
    const repository: GitRepositorySummary = {
      repositoryRoot: "",
      displayName: "workspace",
      currentBranch: "main",
      headState: "branch",
      upstream: "origin/main",
      ahead: 0,
      behind: 0,
      stagedCount: 0,
      modifiedCount: 1,
      untrackedCount: 0,
      conflictedCount: 0,
      fileStatuses: [],
      isClean: false,
      error: null,
    };
    const onGitRepositoryAction = vi.fn();
    const { container } = render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["README.md"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitRepositories={[repository]}
        onGitRepositoryAction={onGitRepositoryAction}
      />,
    );

    fireEvent.contextMenu(container.querySelector(".file-tree-root-label") as HTMLElement);
    const trigger = await screen.findByRole("menuitem", { name: "git.repositoryMenuTitle" });
    fireEvent.mouseEnter(trigger);
    const gitMenu = await screen.findByRole("menu", { name: "git.repositoryMenuTitle" });
    fireEvent.click(within(gitMenu).getByRole("menuitem", { name: "git.repositoryMenuHistory" }));
    expect(onGitRepositoryAction).toHaveBeenCalledWith({
      action: "show-history",
      repositoryRoot: "",
    });
  });

  it("disables repository Update when no current branch is available", async () => {
    const onGitRepositoryAction = vi.fn();
    const { container } = render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["README.md"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitRepositories={[{
          repositoryRoot: "",
          displayName: "workspace",
          currentBranch: null,
          headState: "detached",
          upstream: null,
          ahead: 0,
          behind: 0,
          stagedCount: 0,
          modifiedCount: 0,
          untrackedCount: 0,
          conflictedCount: 0,
          fileStatuses: [],
          isClean: true,
          error: null,
        }]}
        onGitRepositoryAction={onGitRepositoryAction}
      />,
    );

    fireEvent.contextMenu(container.querySelector(".file-tree-root-label") as HTMLElement);
    const trigger = await screen.findByRole("menuitem", { name: "git.repositoryMenuTitle" });
    fireEvent.mouseEnter(trigger);
    const gitMenu = await screen.findByRole("menu", { name: "git.repositoryMenuTitle" });
    const updateItem = within(gitMenu).getByRole("menuitem", {
      name: "git.historyBranchMenuUpdate",
    });
    expect((updateItem as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(updateItem);
    expect(onGitRepositoryAction).not.toHaveBeenCalled();
  });

  it("adds an exact nested repository path to the workspace .gitignore once", async () => {
    const repository: GitRepositorySummary = {
      repositoryRoot: "services/api",
      displayName: "api",
      currentBranch: "main",
      headState: "branch",
      upstream: null,
      ahead: 0,
      behind: 0,
      stagedCount: 0,
      modifiedCount: 0,
      untrackedCount: 0,
      conflictedCount: 0,
      fileStatuses: [],
      isClean: true,
      error: null,
    };
    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["services/api/README.md"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitRepositories={[repository]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /services/ }));
    fireEvent.contextMenu(screen.getByRole("button", { name: /api/ }));
    const trigger = await screen.findByRole("menuitem", { name: "git.repositoryMenuTitle" });
    fireEvent.mouseEnter(trigger);
    const gitMenu = await screen.findByRole("menu", { name: "git.repositoryMenuTitle" });
    fireEvent.click(within(gitMenu).getByRole("menuitem", { name: "git.repositoryMenuAddToGitignore" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("write_workspace_file", {
        workspaceId: "workspace-1",
        path: ".gitignore",
        content: "services/api/\n",
      });
    });
  });

  it("renders top-level entries directly without a workspace root row", () => {
    const { container } = render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["src/index.ts", "README.md"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    expect(screen.queryByRole("button", { name: /workspace/ })).toBeNull();
    expect(container.querySelectorAll(".file-tree-row.is-root")).toHaveLength(0);
    expect(screen.getByRole("button", { name: /src/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "README.md" })).toBeTruthy();
  });

  it("restores child expansion state after collapsing and re-expanding a parent folder", () => {
    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["src/index.ts", "src/app/main.ts"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /src/ }));
    expect(screen.getByText("index.ts")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /app/ }));
    expect(screen.getByText("main.ts")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /src/ }));
    expect(screen.queryByText("main.ts")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /src/ }));
    expect(screen.getByText("main.ts")).toBeTruthy();
  });

  it("keeps the root actions toolbar without a workspace root button", () => {
    const { container } = render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["README.md"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        onToggleRuntimeConsole={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    const actionsRow = container.querySelector(".file-tree-root-row");
    expect(actionsRow).toBeTruthy();
    expect(actionsRow?.querySelector(".file-tree-root-actions")).toBeTruthy();
    expect(actionsRow?.querySelectorAll(".file-tree-row")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /workspace/ })).toBeNull();
  });

  it("keeps opened-file contract when running non-open action from a file context menu", async () => {
    const onOpenFile = vi.fn();
    const writeTextMock = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: writeTextMock },
    });

    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["README.md"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={onOpenFile}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: "README.md" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "files.copyPath" }));

    expect(writeTextMock).toHaveBeenCalledWith("/tmp/workspace/README.md");
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("opens file preview read flow when onOpenFile handler is not provided", async () => {
    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["README.md"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "README.md" }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("read_workspace_file", {
        workspaceId: "workspace-1",
        path: "README.md",
      });
    });
  });

  it("applies git color class when git status path is absolute", () => {
    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["src/index.ts"]}
        directories={["src"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[
          {
            path: "/tmp/workspace/src/index.ts",
            status: "M",
            additions: 1,
            deletions: 0,
          },
        ]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /src/ }));
    const fileLabel = screen.getByText("index.ts");
    expect(fileLabel.className).toContain("git-m");
  });

  it("marks visible folders as gitignored only when the whole folder is ignored", () => {
    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={[
          "node_modules/pkg/index.js",
          ".idea/workspace.xml",
          "src-tauri/target/debug/app",
          "src-tauri/src/main.rs",
          "src-tauri/Cargo.toml",
          "src/index.ts",
        ]}
        directories={[
          "node_modules",
          "node_modules/pkg",
          ".idea",
          "src-tauri",
          "src-tauri/target",
          "src-tauri/target/debug",
          "src-tauri/src",
          "src",
        ]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
        gitignoredDirectories={new Set<string>(["node_modules", ".idea", "target"])}
      />,
    );

    const ignoredFolderLabels = Array.from(
      document.querySelectorAll(".file-tree-row.is-gitignored .file-tree-name"),
    ).map((label) => label.textContent ?? "");

    expect(ignoredFolderLabels).toContain("node_modules");
    expect(ignoredFolderLabels).toContain(".idea");
    expect(ignoredFolderLabels).toContain("target");
    expect(ignoredFolderLabels).not.toContain("src-tauri");
    expect(ignoredFolderLabels).not.toContain("src");
  });

  it("lets users collapse folders auto-expanded to show gitignored children", () => {
    const previousInvokeImplementation = invokeMock.getMockImplementation();
    invokeMock.mockImplementation(async (...args: any[]) =>
      previousInvokeImplementation ? previousInvokeImplementation(...args) : null,
    );

    try {
      render(
        <FileTreePanel
          workspaceId="workspace-1"
          workspacePath="/tmp/workspace"
          files={[
            "src-tauri/target/debug/app",
            "src-tauri/src/main.rs",
            "src-tauri/Cargo.toml",
          ]}
          directories={[
            "src-tauri",
            "src-tauri/target",
            "src-tauri/target/debug",
            "src-tauri/src",
          ]}
          isLoading={false}
          filePanelMode="files"
          onFilePanelModeChange={() => undefined}
          onOpenFile={() => undefined}
          onInsertText={() => undefined}
          openTargets={[]}
          openAppIconById={{}}
          selectedOpenAppId=""
          onSelectOpenAppId={() => undefined}
          gitStatusFiles={[]}
          gitignoredFiles={new Set<string>()}
          gitignoredDirectories={new Set<string>(["target"])}
        />,
      );

      const srcTauriRow = screen.getByRole("button", { name: /src-tauri/ });
      expect(screen.getByRole("button", { name: /target/ })).toBeTruthy();
      expect(srcTauriRow.querySelector(".file-tree-chevron")?.className).toContain("is-open");

      invokeMock.mockClear();
      fireEvent.click(srcTauriRow);

      expect(screen.queryByRole("button", { name: /target/ })).toBeNull();
      expect(srcTauriRow.querySelector(".file-tree-chevron")?.className).not.toContain("is-open");
      expect(invokeMock).not.toHaveBeenCalledWith(
        "list_workspace_directory_children",
        expect.any(Object),
      );
    } finally {
      invokeMock.mockImplementation(previousInvokeImplementation ?? (async () => null));
    }
  });

  it("applies git color class for repo-relative status when git root is a workspace subdirectory", () => {
    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/JinSen"
        gitRoot="kmllm-search-showcar-py"
        files={["kmllm-search-showcar-py/README.md", "km-chat-new-web/README.md"]}
        directories={["kmllm-search-showcar-py", "km-chat-new-web"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[
          {
            path: "README.md",
            status: "M",
            additions: 1,
            deletions: 0,
          },
        ]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /kmllm-search-showcar-py/ }));
    const fileLabel = screen.getByText("README.md");
    expect(fileLabel.className).toContain("git-m");
  });

  it("projects dirty file and folder colors for multiple repositories at once", () => {
    const repository = (
      repositoryRoot: string,
      fileName: string,
      status: "A" | "M" | "U",
    ): GitRepositorySummary => ({
      repositoryRoot,
      displayName: repositoryRoot,
      currentBranch: "main",
      headState: "branch",
      upstream: null,
      ahead: 0,
      behind: 0,
      stagedCount: status === "A" ? 1 : 0,
      modifiedCount: status === "M" ? 1 : 0,
      untrackedCount: 0,
      conflictedCount: status === "U" ? 1 : 0,
      fileStatuses: [{ path: `src/${fileName}`, status }],
      isClean: false,
      error: null,
    });

    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        gitRoot="service-a"
        files={["service-a/src/api.ts", "service-b/src/web.ts"]}
        directories={["service-a", "service-a/src", "service-b", "service-b/src"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitRepositories={[
          repository("service-a", "api.ts", "U"),
          repository("service-b", "web.ts", "A"),
        ]}
        gitStatusFiles={[{
          path: "src/api.ts",
          status: "M",
          additions: 1,
          deletions: 0,
        }]}
      />,
    );

    const serviceALabel = screen.getByText("service-a");
    const serviceBLabel = screen.getByText("service-b");
    expect(serviceALabel.className).toContain("git-u");
    expect(serviceBLabel.className).toContain("git-a");
    expect(serviceALabel.closest(".file-tree-row")?.className).toContain("is-git-repository");
    expect(serviceBLabel.closest(".file-tree-row")?.className).toContain("is-git-repository");

    fireEvent.click(serviceALabel.closest("button") as HTMLButtonElement);
    fireEvent.click(serviceBLabel.closest("button") as HTMLButtonElement);
    fireEvent.click(screen.getAllByText("src")[0]?.closest("button") as HTMLButtonElement);
    fireEvent.click(screen.getAllByText("src")[1]?.closest("button") as HTMLButtonElement);

    expect(screen.getByText("api.ts").className).toContain("git-u");
    expect(screen.getByText("web.ts").className).toContain("git-a");
  });

  it("does not apply subrepo repo-relative status to workspace root file with same name", () => {
    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/JinSen"
        gitRoot="kmllm-search-showcar-py"
        files={["README.md", "kmllm-search-showcar-py/README.md"]}
        directories={["kmllm-search-showcar-py"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[
          {
            path: "README.md",
            status: "M",
            additions: 1,
            deletions: 0,
          },
        ]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /kmllm-search-showcar-py/ }));
    const readmeLabels = screen.getAllByText("README.md");
    expect(readmeLabels).toHaveLength(2);
    const highlightedLabels = readmeLabels.filter((label) =>
      label.className.includes("git-m"),
    );
    expect(highlightedLabels).toHaveLength(1);
  });

  it("applies folder git status from deep git path even when file node is not listed", () => {
    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={[]}
        directories={["src-tauri", "src-tauri/src", "src-tauri/src/bin"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[
          {
            path: "/tmp/workspace/src-tauri/src/bin/moss_x_daemon.rs",
            status: "M",
            additions: 10,
            deletions: 2,
          },
        ]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    const folderLabel = screen.getByText("src-tauri.src");
    expect(folderLabel.className).toContain("git-m");
  });

  it("does not render folder label as deleted when only nested files are deleted", () => {
    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/JinSen"
        gitRoot="kmllm-search-showcar-py"
        files={[]}
        directories={["kmllm-search-showcar-py"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[
          {
            path: "obsolete.txt",
            status: "D",
            additions: 0,
            deletions: 10,
          },
        ]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    const folderLabel = screen.getByText("kmllm-search-showcar-py");
    expect(folderLabel.className).toContain("git-m");
    expect(folderLabel.className).not.toContain("git-d");
  });

  it("keeps sticky-top and scroll-list containers separated in DOM structure", () => {
    const { container } = render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["README.md"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    const topZone = container.querySelector(".file-tree-top-zone");
    const listZone = container.querySelector(".file-tree-list");
    expect(topZone).toBeTruthy();
    expect(listZone).toBeTruthy();
    expect(topZone?.contains(listZone as Node)).toBe(false);
  });

  it("uses a virtualized row container for large visible file trees", () => {
    const largeFiles = Array.from({ length: 320 }, (_, index) => `src/file-${index}.ts`);
    const { container } = render(
      <FileTreePanel
        workspaceId="workspace-virtual-tree"
        workspacePath="/tmp/workspace"
        files={largeFiles}
        directories={["src"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /src/ }));

    const listZone = container.querySelector(".file-tree-list");
    expect(listZone?.classList.contains("is-virtualized")).toBe(true);
    expect(listZone?.getAttribute("data-file-tree-row-count")).toBe("321");
    expect(container.querySelector(".file-tree-virtual-spacer")).toBeTruthy();
  });

  it("renders empty directories from workspace directory snapshot", () => {
    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["README.md"]}
        directories={["empty-dir"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    expect(screen.getByText("empty-dir")).toBeTruthy();
    expect(screen.getByText("README.md")).toBeTruthy();
  });

  it("renders single-child empty directory chains in a.b.c style", () => {
    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={[]}
        directories={["a/b/c"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    expect(screen.getByText("a.b.c")).toBeTruthy();
  });

  it("does not render empty state for a directories-only snapshot", () => {
    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={[]}
        directories={["src"]}
        isLoading={true}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
        gitignoredDirectories={new Set<string>()}
      />,
    );

    expect(screen.getByText("src")).toBeTruthy();
    expect(screen.queryByText("files.noFilesAvailable")).toBeNull();
  });

  it("renders the root loading indicator while the first workspace snapshot is pending", () => {
    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={[]}
        directories={[]}
        isLoading={true}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
        gitignoredDirectories={new Set<string>()}
      />,
    );

    expect(screen.getByRole("status").textContent).toContain("files.loadingFiles");
    expect(screen.queryByText("files.noFilesAvailable")).toBeNull();
  });

  it("does not render run icon button when handler is absent", () => {
    const openTargets: OpenAppTarget[] = [];

    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={[]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={openTargets}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    expect(screen.queryByRole("button", { name: "files.openRunConsole" })).toBeNull();
  });

  it("opens files with a single click", () => {
    const onOpenFile = vi.fn();
    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["src/index.ts", "README.md"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={onOpenFile}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "README.md" }));
    expect(onOpenFile).toHaveBeenCalledWith("README.md");
  });

  it("toggles folders with a single click while keeping chevron behavior", () => {
    const onOpenFile = vi.fn();
    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["src/index.ts"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={onOpenFile}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    expect(screen.queryByText("index.ts")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /src/ }));
    expect(screen.getByText("index.ts")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /src/ }));
    expect(screen.queryByText("index.ts")).toBeNull();
    const srcRow = screen.getByRole("button", { name: /src/ });
    const srcChevron = srcRow.querySelector(".file-tree-chevron");
    expect(srcChevron).toBeTruthy();
    fireEvent.click(srcChevron as Element);
    expect(screen.getByText("index.ts")).toBeTruthy();
    fireEvent.click(srcChevron as Element);
    expect(screen.queryByText("index.ts")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /src/ }));
    expect(screen.getByText("index.ts")).toBeTruthy();
    expect(onOpenFile).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalledWith(
      "list_workspace_directory_children",
      expect.any(Object),
    );
  });

  it("loads special directory children lazily when expanded", async () => {
    invokeMock.mockImplementation(async (...args: any[]): Promise<any> => {
      const command = args[0];
      if (command === "list_workspace_directory_children") {
        return {
          files: ["node_modules/package.json"],
          directories: [] as string[],
          gitignored_files: [] as string[],
          gitignored_directories: [] as string[],
        };
      }
      return null;
    });

    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={[]}
        directories={["node_modules"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /node_modules/ }));
    expect(await screen.findByText("package.json")).toBeTruthy();
    expect(invokeMock).toHaveBeenCalledWith("list_workspace_directory_children", {
      workspaceId: "workspace-1",
      path: "node_modules",
    });
  });

  it("loads ordinary unknown directory children lazily when expanded", async () => {
    invokeMock.mockImplementation(async (...args: any[]): Promise<any> => {
      const command = args[0];
      if (command === "list_workspace_directory_children") {
        return {
          files: ["packages/large/index.ts"],
          directories: [] as string[],
          gitignored_files: [] as string[],
          gitignored_directories: [] as string[],
          scan_state: "complete",
          limit_hit: false,
          directory_entries: [
            {
              path: "packages/large",
              child_state: "loaded",
            },
          ],
        };
      }
      return null;
    });

    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={[]}
        directories={["packages/large"]}
        directoryMetadata={[
          {
            path: "packages/large",
            child_state: "unknown",
          },
        ]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /packages/ }));
    fireEvent.click(screen.getByRole("button", { name: /large/ }));

    expect(await screen.findByText("index.ts")).toBeTruthy();
    expect(invokeMock).toHaveBeenCalledWith("list_workspace_directory_children", {
      workspaceId: "workspace-1",
      path: "packages/large",
    });
  });

  it("drops stale lazy directory responses when the root source version changes", async () => {
    const childrenResponse = createDeferred<any>();
    invokeMock.mockImplementation(async (...args: any[]): Promise<any> => {
      const command = args[0];
      if (command === "list_workspace_directory_children") {
        return childrenResponse.promise;
      }
      return null;
    });

    const { rerender } = render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={[]}
        directories={["packages/large"]}
        directoryMetadata={[
          {
            path: "packages/large",
            child_state: "unknown",
          },
        ]}
        sourceVersion="source-v1"
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /packages/ }));
    fireEvent.click(screen.getByRole("button", { name: /large/ }));

    rerender(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={[]}
        directories={["packages/large"]}
        directoryMetadata={[
          {
            path: "packages/large",
            child_state: "unknown",
          },
        ]}
        sourceVersion="source-v2"
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    await act(async () => {
      childrenResponse.resolve({
        files: ["packages/large/stale.ts"],
        directories: [] as string[],
        gitignored_files: [] as string[],
        gitignored_directories: [] as string[],
        scan_state: "complete",
        limit_hit: false,
        sourceVersion: "subtree-v1",
        directory_entries: [
          {
            path: "packages/large",
            child_state: "loaded",
          },
        ],
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText("stale.ts")).toBeNull());
  });

  it("caches confirmed empty ordinary directories without repeated fetches", async () => {
    invokeMock.mockImplementation(async (...args: any[]): Promise<any> => {
      const command = args[0];
      if (command === "list_workspace_directory_children") {
        return {
          files: [] as string[],
          directories: [] as string[],
          gitignored_files: [] as string[],
          gitignored_directories: [] as string[],
          scan_state: "complete",
          limit_hit: false,
          directory_entries: [
            {
              path: "docs/empty",
              child_state: "empty",
            },
          ],
        };
      }
      return null;
    });

    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={[]}
        directories={["docs/empty"]}
        directoryMetadata={[
          {
            path: "docs/empty",
            child_state: "unknown",
          },
        ]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /docs/ }));
    fireEvent.click(screen.getByRole("button", { name: /empty/ }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: /empty/ }));
    fireEvent.click(screen.getByRole("button", { name: /empty/ }));

    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("loads nested directories lazily under special directory", async () => {
    invokeMock.mockImplementation(async (...args: any[]) => {
      const command = args[0];
      const payload = args[1];
      if (command !== "list_workspace_directory_children") {
        return null;
      }
      if (payload.path === "node_modules") {
        return {
          files: [] as string[],
          directories: ["node_modules/@babel"],
          gitignored_files: [] as string[],
          gitignored_directories: [] as string[],
        };
      }
      if (payload.path === "node_modules/@babel") {
        return {
          files: [] as string[],
          directories: ["node_modules/@babel/core"],
          gitignored_files: [] as string[],
          gitignored_directories: [] as string[],
        };
      }
      if (payload.path === "node_modules/@babel/core") {
        return {
          files: ["node_modules/@babel/core/index.js"],
          directories: [] as string[],
          gitignored_files: [] as string[],
          gitignored_directories: [] as string[],
        };
      }
      return {
        files: [] as string[],
        directories: [] as string[],
        gitignored_files: [] as string[],
        gitignored_directories: [] as string[],
      };
    });

    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={[]}
        directories={["node_modules"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /node_modules/ }));
    expect(await screen.findByRole("button", { name: /@babel/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /@babel/ }));
    expect(await screen.findByRole("button", { name: /core/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /core/ }));
    expect(await screen.findByText("index.js")).toBeTruthy();

    expect(invokeMock).toHaveBeenCalledWith("list_workspace_directory_children", {
      workspaceId: "workspace-1",
      path: "node_modules",
    });
    expect(invokeMock).toHaveBeenCalledWith("list_workspace_directory_children", {
      workspaceId: "workspace-1",
      path: "node_modules/@babel",
    });
    expect(invokeMock).toHaveBeenCalledWith("list_workspace_directory_children", {
      workspaceId: "workspace-1",
      path: "node_modules/@babel/core",
    });
  });

  it("opens root create prompts and refreshes from the header actions", () => {
    const onRefreshFiles = vi.fn();

    const { container } = render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspaceName="desktop-cc-gui"
        workspacePath="/tmp/workspace"
        files={["README.md"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        onRefreshFiles={onRefreshFiles}
        showSpecHubAction={false}
        showDetachedExplorerAction={false}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    expect(screen.getByText("DESKTOP-CC-GUI")).toBeTruthy();
    expect(container.querySelectorAll(".file-tree-root-actions button")).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: "files.newFile" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByPlaceholderText("files.newFileNamePlaceholder")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "files.cancel" }));

    fireEvent.click(screen.getByRole("button", { name: "files.newFolder" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByPlaceholderText("files.newFolderNamePlaceholder")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "files.cancel" }));

    fireEvent.click(screen.getByRole("button", { name: "files.refreshFiles" }));
    expect(onRefreshFiles).toHaveBeenCalledTimes(1);
  });

  it("keeps delete out of the root header and trashes a node from its context menu", async () => {
    const onRefreshFiles = vi.fn();

    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["README.md"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        onRefreshFiles={onRefreshFiles}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    expect(screen.queryByRole("button", { name: "files.deleteItem" })).toBeNull();

    fireEvent.contextMenu(screen.getByRole("button", { name: "README.md" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "files.deleteItem" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("trash_workspace_item", {
        workspaceId: "workspace-1",
        path: "README.md",
      });
    });
    expect(onRefreshFiles).toHaveBeenCalledTimes(1);
  });

  it("removes a trashed folder subtree from the visible tree before parent refresh settles", async () => {
    const onRefreshFiles = vi.fn();

    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["target/debug/app"]}
        directories={["target", "target/debug"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        onRefreshFiles={onRefreshFiles}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: /target/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "files.deleteItem" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("trash_workspace_item", {
        workspaceId: "workspace-1",
        path: "target",
      });
    });

    expect(screen.queryByRole("button", { name: "target" })).toBeNull();
    expect(screen.queryByRole("button", { name: /debug/ })).toBeNull();
    expect(onRefreshFiles).toHaveBeenCalledTimes(1);
  });

  it("creates new folder at root from a root-level file context menu", async () => {
    const onRefreshFiles = vi.fn();

    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["README.md"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        onRefreshFiles={onRefreshFiles}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: "README.md" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "files.newFolder" }));
    const folderInput = screen.getByPlaceholderText("files.newFolderNamePlaceholder");
    fireEvent.change(folderInput, { target: { value: "docs" } });
    fireEvent.keyDown(folderInput, { key: "Enter" });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("create_workspace_directory", {
        workspaceId: "workspace-1",
        path: "docs",
      });
    });
    expect(onRefreshFiles).toHaveBeenCalledTimes(1);
  });

  it("creates new folder under a folder from its context menu", async () => {
    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["src/index.ts"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: /src/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "files.newFolder" }));
    const folderInput = screen.getByPlaceholderText("files.newFolderNamePlaceholder");
    fireEvent.change(folderInput, { target: { value: "docs" } });
    fireEvent.keyDown(folderInput, { key: "Enter" });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("create_workspace_directory", {
        workspaceId: "workspace-1",
        path: "src/docs",
      });
    });
  });

  it("creates new file next to a file from its context menu", async () => {
    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["src/index.ts"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /src/ }));
    fireEvent.contextMenu(screen.getByRole("button", { name: "index.ts" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "files.newFile" }));
    const fileInput = screen.getByPlaceholderText("files.newFileNamePlaceholder");
    fireEvent.change(fileInput, { target: { value: "utils.ts" } });
    fireEvent.keyDown(fileInput, { key: "Enter" });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("write_workspace_file", {
        workspaceId: "workspace-1",
        path: "src/utils.ts",
        content: "",
      });
    });
  });

  it("shows retry action when special directory lazy load fails", async () => {
    invokeMock
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({
        files: ["node_modules/package-lock.json"],
        directories: [] as string[],
        gitignored_files: [] as string[],
        gitignored_directories: [] as string[],
      });

    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={[]}
        directories={["node_modules"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /node_modules/ }));
    expect(await screen.findByRole("button", { name: "files.retryLoadFiles" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "files.retryLoadFiles" }));
    await waitFor(() => {
      expect(screen.getByText("package-lock.json")).toBeTruthy();
    });
  });

  it("shows load error state instead of empty state when root file list fails", () => {
    const onRefreshFiles = vi.fn();

    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={[]}
        directories={[]}
        isLoading={false}
        loadError="network down"
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        onRefreshFiles={onRefreshFiles}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    expect(screen.getByText("files.loadFilesFailed")).toBeTruthy();
    expect(screen.queryByText("files.noFilesAvailable")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "files.retryLoadFiles" }));
    expect(onRefreshFiles).toHaveBeenCalledTimes(1);
  });

  it("mentions file using Windows-style absolute path when workspace path uses backslashes", () => {
    const onInsertText = vi.fn();

    const { container } = render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath={"C:\\workspace\\demo"}
        files={["index.ts"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={onInsertText}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    const mentionButton = container.querySelector(".file-tree-action") as HTMLButtonElement | null;
    expect(mentionButton).not.toBeNull();
    fireEvent.click(mentionButton as HTMLButtonElement);

    expect(onInsertText).toHaveBeenCalledWith(
      "@C:\\workspace\\demo\\index.ts ",
    );
  });

  it("builds multi-path drag payload from selected nodes", () => {
    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["README.md", "package.json"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    const readme = screen.getByRole("button", { name: "README.md" });
    const pkg = screen.getByRole("button", { name: "package.json" });
    fireEvent.click(readme);
    fireEvent.click(pkg, { ctrlKey: true });

    const setData = vi.fn();
    const dataTransfer = {
      setData,
      effectAllowed: "",
    };

    fireEvent.dragStart(pkg, { dataTransfer });

    const payloadJson = setData.mock.calls.find(
      (call) => call[0] === "application/x-doge-file-paths",
    )?.[1];
    const payloadText = setData.mock.calls.find(
      (call) => call[0] === "text/plain",
    )?.[1];

    expect(payloadJson).toBeTruthy();
    expect(payloadText).toBeTruthy();
    const parsedPayload = JSON.parse(payloadJson as string) as string[];
    expect(new Set(parsedPayload)).toEqual(
      new Set(["/tmp/workspace/README.md", "/tmp/workspace/package.json"]),
    );
    expect(new Set((payloadText as string).split("\n"))).toEqual(
      new Set(["/tmp/workspace/README.md", "/tmp/workspace/package.json"]),
    );
    expect(new Set(window.__fileTreeDragPaths ?? [])).toEqual(
      new Set(["/tmp/workspace/README.md", "/tmp/workspace/package.json"]),
    );
    expect(typeof window.__fileTreeDragStamp).toBe("number");
    expect(window.__fileTreeDragActive).toBe(true);
    expect(window.__fileTreeDragOverChat).toBe(false);
    expect(typeof window.__fileTreeDragCleanup).toBe("function");

    fireEvent.dragEnd(pkg);
    expect(window.__fileTreeDragPaths).toBeUndefined();
    expect(window.__fileTreeDragStamp).toBeUndefined();
    expect(window.__fileTreeDragActive).toBeUndefined();
    expect(window.__fileTreeDragPosition).toBeUndefined();
    expect(window.__fileTreeDragOverChat).toBeUndefined();
    expect(window.__fileTreeDragDropped).toBeUndefined();
    expect(window.__fileTreeDragCleanup).toBeUndefined();
  });

  it("opens file compare from selected file context menu", async () => {
    const onCompareFiles = vi.fn((_paths: string[]) => true);

    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["README.md", "package.json"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        onCompareFiles={onCompareFiles}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    const readme = screen.getByRole("button", { name: "README.md" });
    const pkg = screen.getByRole("button", { name: "package.json" });
    fireEvent.click(readme);
    fireEvent.click(pkg, { ctrlKey: true });
    fireEvent.contextMenu(pkg);
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "files.fileCompare.compareSelected",
      }),
    );

    expect(onCompareFiles).toHaveBeenCalledTimes(1);
    expect(new Set(onCompareFiles.mock.calls[0]?.[0])).toEqual(
      new Set(["README.md", "package.json"]),
    );
  });

  it("does not reuse previous multi-selection when right-clicking outside it", () => {
    const onCompareFiles = vi.fn(() => true);

    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["README.md", "package.json", "vite.config.ts"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        onCompareFiles={onCompareFiles}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "README.md" }));
    fireEvent.click(screen.getByRole("button", { name: "package.json" }), {
      ctrlKey: true,
    });
    fireEvent.contextMenu(screen.getByRole("button", { name: "vite.config.ts" }));

    expect(
      screen.queryByRole("menuitem", {
        name: "files.fileCompare.compareSelected",
      }),
    ).toBeNull();
    expect(onCompareFiles).not.toHaveBeenCalled();
  });

  it("prompts instead of comparing when more than four files are selected", () => {
    const onCompareFiles = vi.fn(() => true);
    const files = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"];

    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={files}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        onCompareFiles={onCompareFiles}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    const [firstFile, ...remainingFiles] = files;
    fireEvent.click(screen.getByRole("button", { name: firstFile }));
    for (const file of remainingFiles) {
      fireEvent.click(screen.getByRole("button", { name: file }), { ctrlKey: true });
    }
    fireEvent.contextMenu(screen.getByRole("button", { name: "e.ts" }));

    expect(
      screen.queryByRole("menuitem", {
        name: "files.fileCompare.compareSelected",
      }),
    ).toBeNull();
    expect(screen.getByText("files.fileCompare.tooManyFiles")).toBeTruthy();
    expect(onCompareFiles).not.toHaveBeenCalled();
  });

  it("uses a windows-only drag image for internal tree drags", () => {
    const originalPlatform = window.navigator.platform;
    Object.defineProperty(window.navigator, "platform", {
      configurable: true,
      value: "Win32",
    });

    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["README.md"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    const setDragImage = vi.fn();
    fireEvent.dragStart(screen.getByRole("button", { name: "README.md" }), {
      dataTransfer: {
        setData: vi.fn(),
        setDragImage,
        effectAllowed: "",
      },
    });

    expect(setDragImage).toHaveBeenCalledTimes(1);
    const dragImageNode = setDragImage.mock.calls[0]?.[0] as HTMLElement | undefined;
    expect(dragImageNode).toBeInstanceOf(HTMLElement);
    expect(dragImageNode?.textContent).toContain("README.md");
    expect(document.body.contains(dragImageNode ?? null)).toBe(true);

    fireEvent.dragEnd(screen.getByRole("button", { name: "README.md" }));
    expect(document.body.contains(dragImageNode ?? null)).toBe(false);

    Object.defineProperty(window.navigator, "platform", {
      configurable: true,
      value: originalPlatform,
    });
  });

  it("reveals a Windows workspace path via native Explorer command with backslashes", async () => {
    const originalPlatform = window.navigator.platform;
    Object.defineProperty(window.navigator, "platform", {
      configurable: true,
      value: "Win32",
    });

    try {
      render(
        <FileTreePanel
          workspaceId="workspace-win-reveal"
          workspacePath="C:/Users/Chen/Project"
          files={["README.md"]}
          isLoading={false}
          filePanelMode="files"
          onFilePanelModeChange={() => undefined}
          onOpenFile={() => undefined}
          openTargets={[]}
          openAppIconById={{}}
          selectedOpenAppId=""
          onSelectOpenAppId={() => undefined}
        />,
      );

      fireEvent.contextMenu(screen.getByRole("button", { name: "README.md" }));
      fireEvent.click(
        await screen.findByRole("menuitem", { name: "files.revealInExplorer" }),
      );

      await waitFor(() => {
        expect(revealInFileManagerMock).toHaveBeenCalledWith(
          "C:\\Users\\Chen\\Project\\README.md",
        );
      });
    } finally {
      Object.defineProperty(window.navigator, "platform", {
        configurable: true,
        value: originalPlatform,
      });
    }
  });

  it("uses the same insertion bridge as the + action when tree drag ends over chat input", () => {
    const handleFilePathFromJava = vi.fn();
    window.handleFilePathFromJava = handleFilePathFromJava;

    const chatInput = document.createElement("div");
    chatInput.className = "chat-input-box";
    chatInput.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 400, bottom: 200 } as DOMRect);
    document.body.appendChild(chatInput);

    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["README.md", "package.json"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    const readme = screen.getByRole("button", { name: "README.md" });
    fireEvent.dragStart(readme, {
      dataTransfer: { setData: vi.fn(), effectAllowed: "" },
    });
    window.__fileTreeDragPosition = { x: 120, y: 80 };
    fireEvent.dragEnd(readme);

    expect(handleFilePathFromJava).toHaveBeenCalledWith("/tmp/workspace/README.md");
    chatInput.remove();
  });

  it("targets the active chat input even when it's not the first chat-input-box node", () => {
    const handleFilePathFromJava = vi.fn();
    window.handleFilePathFromJava = handleFilePathFromJava;

    const inactiveChatInput = document.createElement("div");
    inactiveChatInput.className = "chat-input-box";
    inactiveChatInput.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 180, bottom: 120 } as DOMRect);
    document.body.appendChild(inactiveChatInput);

    const activeChatInput = document.createElement("div");
    activeChatInput.className = "chat-input-box";
    activeChatInput.getBoundingClientRect = () =>
      ({ left: 520, top: 40, right: 980, bottom: 260 } as DOMRect);
    document.body.appendChild(activeChatInput);

    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["README.md"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    const readme = screen.getByRole("button", { name: "README.md" });
    fireEvent.dragStart(readme, {
      dataTransfer: { setData: vi.fn(), effectAllowed: "" },
    });
    window.__fileTreeDragPosition = { x: 700, y: 120 };
    fireEvent.dragEnd(readme);

    expect(handleFilePathFromJava).toHaveBeenCalledWith("/tmp/workspace/README.md");
    inactiveChatInput.remove();
    activeChatInput.remove();
  });

  it("falls back to + bridge on drag end when hit-test channel is unavailable", () => {
    const handleFilePathFromJava = vi.fn();
    window.handleFilePathFromJava = handleFilePathFromJava;

    const chatInput = document.createElement("div");
    chatInput.className = "chat-input-box";
    document.body.appendChild(chatInput);

    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["README.md"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    const readme = screen.getByRole("button", { name: "README.md" });
    fireEvent.dragStart(readme, {
      dataTransfer: { setData: vi.fn(), effectAllowed: "" },
    });
    // Simulate runtime that doesn't provide usable drag-end location.
    fireEvent.dragEnd(readme, { clientX: 0, clientY: 0 });

    expect(handleFilePathFromJava).toHaveBeenCalledWith("/tmp/workspace/README.md");
    chatInput.remove();
  });
});
