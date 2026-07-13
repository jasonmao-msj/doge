import { useCallback, useEffect } from "react";
import { useGlobalSearchShortcut } from "../features/app/hooks/useGlobalSearchShortcut";
import { useInterruptShortcut } from "../features/app/hooks/useInterruptShortcut";
import { usePullRequestComposer } from "../features/git/hooks/usePullRequestComposer";
import type { CenterMode } from "../features/app/hooks/useGitPanelController";
import { recordSearchResultOpen } from "../features/search/ranking/recencyStore";
import type { KanbanTask } from "../features/kanban/types";
import type {
  SearchContentFilter,
  SearchResult,
  SearchScope,
} from "../features/search/types";
import { resolveSearchScopeOnOpen } from "../features/search/utils/scope";
import { toggleSearchContentFilters } from "../features/search/utils/contentFilters";
import type {
  AppSettings,
  GitHubPullRequest,
  GitHubPullRequestDiff,
  MessageSendOptions,
  WorkspaceInfo,
} from "../types";
import {
  getThreadSelectDiffCleanupAction,
  shouldPreserveEditorOnThreadSelect,
} from "./threadEditorPreservation";

type AppShellTab = "projects" | "codex" | "spec" | "git" | "log";
type DiffSource = "local" | "pr" | "commit";
type FilePanelMode =
  | "git"
  | "files"
  | "search"
  | "notes"
  | "prompts"
  | "memory"
  | "activity"
  | "radar"
  | "pluginPreview";
type GitPanelMode = "diff" | "log" | "issues" | "prs";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export const COMPOSER_SEARCH_BOUNDARY_FIELD_GROUPS = {
  searchPalette: [
    "activeEditorFilePath",
    "activeWorkspaceId",
    "appSettings",
    "canInterrupt",
    "centerMode",
    "exitDiffView",
    "getActiveDraft",
    "handleDraftChange",
    "handleOpenFile",
    "interruptTurn",
    "isCompact",
    "isSearchPaletteOpen",
    "searchPaletteQuery",
    "searchResults",
    "searchScope",
    "selectWorkspace",
    "setActiveTab",
    "setActiveThreadId",
    "setDiffSource",
    "setIsSearchPaletteOpen",
    "setSearchContentFilters",
    "setSearchPaletteQuery",
    "setSearchPaletteSelectedIndex",
    "setSearchScope",
    "setSelectedCommitSha",
    "setSelectedDiffPath",
    "setSelectedPullRequest",
  ],
  composerSend: [
    "activeWorkspace",
    "clearActiveImages",
    "connectWorkspace",
    "gitPullRequestDiffs",
    "handleSend",
    "queueMessage",
    "selectedPullRequest",
    "sendUserMessageToThread",
    "startThreadForWorkspace",
  ],
  gitSearchOpen: [
    "filePanelMode",
    "gitPanelMode",
    "setCenterMode",
    "setGitPanelMode",
    "setPrefillDraft",
  ],
  kanbanBridge: [
    "kanbanTasks",
    "setAppMode",
    "setKanbanViewState",
    "setSelectedKanbanTaskId",
    "workspacesByPath",
  ],
} as const;

export type SearchPaletteBoundary = {
  activeEditorFilePath: string | null | undefined;
  activeWorkspaceId: string | null;
  appSettings: Pick<
    AppSettings,
    "interruptShortcut" | "toggleGlobalSearchShortcut"
  >;
  canInterrupt: boolean;
  centerMode: CenterMode;
  exitDiffView: () => void;
  getActiveDraft: () => string;
  handleDraftChange: (draft: string) => void;
  handleOpenFile: (filePath: string) => void;
  interruptTurn: () => Promise<unknown> | unknown;
  isCompact: boolean;
  isSearchPaletteOpen: boolean;
  searchPaletteQuery: string;
  searchResults: SearchResult[];
  searchScope: SearchScope;
  selectWorkspace: (workspaceId: string) => void;
  setActiveTab: (tab: AppShellTab) => void;
  setActiveThreadId: (threadId: string, workspaceId: string) => void;
  setDiffSource: (source: DiffSource) => void;
  setIsSearchPaletteOpen: (open: boolean) => void;
  setSearchContentFilters: (
    updater: (previous: SearchContentFilter[]) => SearchContentFilter[],
  ) => void;
  setSearchPaletteQuery: (query: string) => void;
  setSearchPaletteSelectedIndex: (
    updater: number | ((previous: number) => number),
  ) => void;
  setSearchScope: (scope: SearchScope) => void;
  setSelectedCommitSha: (sha: string | null) => void;
  setSelectedDiffPath: (path: string | null) => void;
  setSelectedPullRequest: (pullRequest: GitHubPullRequest | null) => void;
};

export type ComposerSendBoundary = {
  activeWorkspace: WorkspaceInfo | null;
  clearActiveImages: () => void;
  connectWorkspace: (workspace: WorkspaceInfo) => Promise<void>;
  gitPullRequestDiffs: GitHubPullRequestDiff[];
  handleSend: (
    text: string,
    images: string[],
    options?: MessageSendOptions,
  ) => Promise<void>;
  queueMessage: (
    text: string,
    images: string[],
    options?: MessageSendOptions,
  ) => Promise<void>;
  selectedPullRequest: GitHubPullRequest | null;
  sendUserMessageToThread: (
    workspace: WorkspaceInfo,
    threadId: string,
    text: string,
    images?: string[],
    options?: MessageSendOptions,
  ) => Promise<void>;
  startThreadForWorkspace: (
    workspaceId: string,
    options?: { activate?: boolean },
  ) => Promise<string | null>;
};

export type GitSearchOpenBoundary = {
  filePanelMode: FilePanelMode;
  gitPanelMode: GitPanelMode;
  setCenterMode: (mode: CenterMode) => void;
  setGitPanelMode: (mode: GitPanelMode) => void;
  setPrefillDraft: (draft: {
    id: string;
    text: string;
    createdAt: number;
  }) => void;
};

export type KanbanComposerBridgeBoundary = {
  kanbanTasks: KanbanTask[];
  setAppMode: (mode: "chat" | "kanban") => void;
  setKanbanViewState: (state: {
    view: "board";
    workspaceId: string;
    panelId: string;
  }) => void;
  setSelectedKanbanTaskId: (taskId: string | null) => void;
  workspacesByPath: Map<string, WorkspaceInfo>;
};

export type ComposerSearchShellBoundary = SearchPaletteBoundary &
  ComposerSendBoundary &
  GitSearchOpenBoundary &
  KanbanComposerBridgeBoundary;

export function useAppShellSearchAndComposerSection(
  input: ComposerSearchShellBoundary,
) {
  const {
    activeEditorFilePath,
    activeWorkspace,
    activeWorkspaceId,
    appSettings,
    canInterrupt,
    centerMode,
    clearActiveImages,
    connectWorkspace,
    exitDiffView,
    filePanelMode,
    getActiveDraft,
    gitPanelMode,
    gitPullRequestDiffs,
    handleDraftChange,
    handleOpenFile,
    handleSend,
    interruptTurn,
    isCompact,
    isSearchPaletteOpen,
    kanbanTasks,
    queueMessage,
    searchPaletteQuery,
    searchResults,
    searchScope,
    selectWorkspace,
    selectedPullRequest,
    sendUserMessageToThread,
    setActiveTab,
    setActiveThreadId,
    setAppMode,
    setCenterMode,
    setDiffSource,
    setGitPanelMode,
    setIsSearchPaletteOpen,
    setKanbanViewState,
    setPrefillDraft,
    setSearchContentFilters,
    setSearchPaletteQuery,
    setSearchPaletteSelectedIndex,
    setSearchScope,
    setSelectedCommitSha,
    setSelectedDiffPath,
    setSelectedKanbanTaskId,
    setSelectedPullRequest,
    startThreadForWorkspace,
    workspacesByPath,
  } = input;

  const closeSearchPalette = useCallback(() => {
    setIsSearchPaletteOpen(false);
    setSearchPaletteQuery("");
    setSearchPaletteSelectedIndex(0);
  }, [
    setIsSearchPaletteOpen,
    setSearchPaletteQuery,
    setSearchPaletteSelectedIndex,
  ]);

  const handleOpenSearchPalette = useCallback(() => {
    const nextScope = resolveSearchScopeOnOpen(searchScope, activeWorkspaceId);
    if (nextScope !== searchScope) {
      setSearchScope(nextScope);
    }
    setIsSearchPaletteOpen(true);
    setSearchPaletteSelectedIndex(0);
  }, [
    activeWorkspaceId,
    searchScope,
    setIsSearchPaletteOpen,
    setSearchPaletteSelectedIndex,
    setSearchScope,
  ]);

  const handleToggleSearchPalette = useCallback(() => {
    if (isSearchPaletteOpen) {
      closeSearchPalette();
      return;
    }
    handleOpenSearchPalette();
  }, [closeSearchPalette, handleOpenSearchPalette, isSearchPaletteOpen]);

  useGlobalSearchShortcut({
    isEnabled: true,
    shortcut: appSettings.toggleGlobalSearchShortcut,
    onTrigger: handleToggleSearchPalette,
  });

  useEffect(() => {
    if (!isSearchPaletteOpen) {
      return;
    }
    setSearchPaletteSelectedIndex(0);
  }, [isSearchPaletteOpen, searchPaletteQuery, setSearchPaletteSelectedIndex]);

  const handleSearchPaletteMoveSelection = useCallback(
    (direction: "up" | "down") => {
      if (!searchResults.length) {
        return;
      }
      setSearchPaletteSelectedIndex((prev) => {
        if (direction === "down") {
          return (prev + 1) % searchResults.length;
        }
        return (prev - 1 + searchResults.length) % searchResults.length;
      });
    },
    [searchResults.length, setSearchPaletteSelectedIndex],
  );

  const handleToggleSearchContentFilter = useCallback(
    (nextFilter: SearchContentFilter) => {
      setSearchContentFilters((prev) =>
        toggleSearchContentFilters(prev, nextFilter),
      );
      setSearchPaletteSelectedIndex(0);
    },
    [setSearchContentFilters, setSearchPaletteSelectedIndex],
  );

  const handleSelectSearchResult = useCallback(
    (result: SearchResult) => {
      switch (result.kind) {
        case "file":
          if (result.filePath) {
            handleOpenFile(result.filePath);
          }
          break;
        case "thread":
          if (
            isNonEmptyString(result.workspaceId) &&
            isNonEmptyString(result.threadId)
          ) {
            const preserveEditor = shouldPreserveEditorOnThreadSelect({
              isCompact,
              centerMode,
              activeWorkspaceId,
              targetWorkspaceId: result.workspaceId,
              activeEditorFilePath,
            });
            const diffCleanupAction =
              getThreadSelectDiffCleanupAction(preserveEditor);
            if (diffCleanupAction === "clear-selected-diff") {
              setSelectedDiffPath(null);
            } else {
              exitDiffView();
            }
            setSelectedPullRequest(null);
            setSelectedCommitSha(null);
            setDiffSource("local");
            selectWorkspace(result.workspaceId);
            setActiveThreadId(result.threadId, result.workspaceId);
          }
          break;
        case "kanban":
          if (result.taskId) {
            const task = kanbanTasks.find(
              (entry) => entry.id === result.taskId,
            );
            if (task) {
              const taskWs = workspacesByPath.get(task.workspaceId);
              setAppMode("kanban");
              setSelectedKanbanTaskId(task.id);
              if (taskWs) selectWorkspace(taskWs.id);
              setKanbanViewState({
                view: "board",
                workspaceId: task.workspaceId,
                panelId: task.panelId,
              });
            }
          }
          break;
        case "history":
          if (result.historyText) {
            handleDraftChange(result.historyText);
            if (isCompact) {
              setActiveTab("codex");
            }
          }
          break;
        case "message":
          if (
            isNonEmptyString(result.workspaceId) &&
            isNonEmptyString(result.threadId)
          ) {
            const preserveEditor = shouldPreserveEditorOnThreadSelect({
              isCompact,
              centerMode,
              activeWorkspaceId,
              targetWorkspaceId: result.workspaceId,
              activeEditorFilePath,
            });
            const diffCleanupAction =
              getThreadSelectDiffCleanupAction(preserveEditor);
            if (diffCleanupAction === "clear-selected-diff") {
              setSelectedDiffPath(null);
            } else {
              exitDiffView();
            }
            setSelectedPullRequest(null);
            setSelectedCommitSha(null);
            setDiffSource("local");
            selectWorkspace(result.workspaceId);
            setActiveThreadId(result.threadId, result.workspaceId);
            if (isCompact) {
              setActiveTab("codex");
            }
          }
          break;
        case "skill":
          if (result.skillName) {
            const slashToken = `/${result.skillName}`;
            const currentDraft = getActiveDraft().trim();
            const nextDraft = currentDraft
              ? `${currentDraft} ${slashToken} `
              : `${slashToken} `;
            handleDraftChange(nextDraft);
            if (isCompact) {
              setActiveTab("codex");
            }
          }
          break;
        case "command":
          if (result.commandName) {
            const slashToken = `/${result.commandName}`;
            const currentDraft = getActiveDraft().trim();
            const nextDraft = currentDraft
              ? `${currentDraft} ${slashToken} `
              : `${slashToken} `;
            handleDraftChange(nextDraft);
            if (isCompact) {
              setActiveTab("codex");
            }
          }
          break;
        default:
          break;
      }
      recordSearchResultOpen(result.id);
      closeSearchPalette();
    },
    [
      activeEditorFilePath,
      activeWorkspaceId,
      centerMode,
      closeSearchPalette,
      exitDiffView,
      getActiveDraft,
      handleDraftChange,
      handleOpenFile,
      isCompact,
      kanbanTasks,
      workspacesByPath,
      selectWorkspace,
      setActiveTab,
      setAppMode,
      setDiffSource,
      setActiveThreadId,
      setKanbanViewState,
      setSelectedCommitSha,
      setSelectedDiffPath,
      setSelectedKanbanTaskId,
      setSelectedPullRequest,
    ],
  );

  useInterruptShortcut({
    isEnabled: canInterrupt,
    shortcut: appSettings.interruptShortcut,
    onTrigger: () => {
      void interruptTurn();
    },
  });

  const {
    handleSelectPullRequest,
    resetPullRequestSelection,
    isPullRequestComposer,
    composerSendLabel,
    handleComposerSend,
    handleComposerQueue,
  } = usePullRequestComposer({
    activeWorkspace,
    selectedPullRequest,
    gitPullRequestDiffs,
    filePanelMode,
    gitPanelMode,
    centerMode,
    isCompact,
    setSelectedPullRequest,
    setDiffSource,
    setSelectedDiffPath,
    setCenterMode,
    setGitPanelMode,
    setPrefillDraft,
    setActiveTab,
    connectWorkspace,
    startThreadForWorkspace,
    sendUserMessageToThread,
    clearActiveImages,
    handleSend,
    queueMessage,
  });

  return {
    closeSearchPalette,
    handleOpenSearchPalette,
    handleToggleSearchPalette,
    handleSearchPaletteMoveSelection,
    handleToggleSearchContentFilter,
    handleSelectSearchResult,
    handleSelectPullRequest,
    resetPullRequestSelection,
    isPullRequestComposer,
    composerSendLabel,
    handleComposerSend,
    handleComposerQueue,
  };
}
