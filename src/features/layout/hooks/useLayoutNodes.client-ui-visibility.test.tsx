// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { ConversationItem, WorkspaceInfo } from "../../../types";
import { setComposerDraft } from "../../composer/hooks/composerDraftStore";
import { useLayoutNodes } from "./useLayoutNodes";
import type {
  LayoutNodesFlatOptions,
  LayoutNodesOptions,
} from "./layoutNodesTypes";
import { getCodexProviders } from "../../../services/tauri";
import {
  dispatchSharedSendEvent,
  resetSharedSendStateStoreForTests,
} from "../../shared-session/runtime/sharedSendStateStore";

const clientUiVisibilityMock = vi.hoisted(() => ({
  visiblePanels: new Set<string>(),
  visibleControls: new Set<string>(),
}));
const composerMockState = vi.hoisted(() => ({
  thinkingCallbacks: [] as Array<((enabled: boolean) => void) | undefined>,
}));
let capturedMessagesNoteCapture:
  | ((draft: {
      title: string;
      bodyMarkdown: string;
      source: {
        kind: "conversationThread";
        threadId: string;
        itemCount: number;
        capturedAt: number;
      };
    }) => void)
  | undefined;
let capturedWorkspaceNotePanelProps: {
  captureRequest?: {
    requestId: number;
    draft: {
      title: string;
      bodyMarkdown: string;
    };
  } | null;
  onCaptureRequestHandled?: (requestId: number) => void;
  onOpenCodeSource?: (source: {
    kind: "codeSelection";
    path: string;
    startLine: number;
    endLine: number;
    language?: string | null;
  }) => void;
} | null = null;

vi.mock("react-i18next", () => ({
  initReactI18next: {
    type: "3rdParty",
    init: vi.fn(),
  },
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../client-ui-visibility/hooks/useClientUiVisibility", () => ({
  useClientUiVisibility: () => ({
    preference: {
      panels: {
        topSessionTabs:
          clientUiVisibilityMock.visiblePanels.has("topSessionTabs"),
        topRunControls:
          clientUiVisibilityMock.visiblePanels.has("topRunControls"),
        topToolControls:
          clientUiVisibilityMock.visiblePanels.has("topToolControls"),
        rightActivityToolbar: clientUiVisibilityMock.visiblePanels.has(
          "rightActivityToolbar",
        ),
        bottomActivityPanel: clientUiVisibilityMock.visiblePanels.has(
          "bottomActivityPanel",
        ),
        cornerStatusIndicator: clientUiVisibilityMock.visiblePanels.has(
          "cornerStatusIndicator",
        ),
        globalRuntimeNoticeDock: clientUiVisibilityMock.visiblePanels.has(
          "globalRuntimeNoticeDock",
        ),
      },
      controls: {
        "topRun.start":
          clientUiVisibilityMock.visibleControls.has("topRun.start"),
        "topTool.openWorkspace": clientUiVisibilityMock.visibleControls.has(
          "topTool.openWorkspace",
        ),
        "topTool.runtimeConsole": clientUiVisibilityMock.visibleControls.has(
          "topTool.runtimeConsole",
        ),
        "topTool.terminal":
          clientUiVisibilityMock.visibleControls.has("topTool.terminal"),
        "topTool.focus":
          clientUiVisibilityMock.visibleControls.has("topTool.focus"),
        "topTool.rightPanel":
          clientUiVisibilityMock.visibleControls.has("topTool.rightPanel"),
        "topTool.clientDocumentation":
          clientUiVisibilityMock.visibleControls.has(
            "topTool.clientDocumentation",
          ),
        "rightToolbar.activity": clientUiVisibilityMock.visibleControls.has(
          "rightToolbar.activity",
        ),
        "rightToolbar.projectMap": clientUiVisibilityMock.visibleControls.has(
          "rightToolbar.projectMap",
        ),
        "rightToolbar.radar":
          clientUiVisibilityMock.visibleControls.has("rightToolbar.radar"),
        "rightToolbar.git":
          clientUiVisibilityMock.visibleControls.has("rightToolbar.git"),
        "rightToolbar.files":
          clientUiVisibilityMock.visibleControls.has("rightToolbar.files"),
        "rightToolbar.search": clientUiVisibilityMock.visibleControls.has(
          "rightToolbar.search",
        ),
        "bottomActivity.tasks": clientUiVisibilityMock.visibleControls.has(
          "bottomActivity.tasks",
        ),
        "bottomActivity.agents": clientUiVisibilityMock.visibleControls.has(
          "bottomActivity.agents",
        ),
        "bottomActivity.checkpoint": clientUiVisibilityMock.visibleControls.has(
          "bottomActivity.checkpoint",
        ),
        "cornerStatus.messageAnchors":
          clientUiVisibilityMock.visibleControls.has(
            "cornerStatus.messageAnchors",
          ),
      },
    },
    isPanelVisible: (id: string) =>
      clientUiVisibilityMock.visiblePanels.has(id),
    isControlVisible: (id: string) =>
      clientUiVisibilityMock.visibleControls.has(id),
    isControlPreferenceVisible: (id: string) =>
      clientUiVisibilityMock.visibleControls.has(id),
    setPanelVisible: vi.fn(),
    setControlVisible: vi.fn(),
    resetVisibility: vi.fn(),
  }),
}));

vi.mock("../../../services/tauri", () => ({
  getCodexProviders: vi.fn(async () => []),
}));

vi.mock("../../app/components/Sidebar", () => ({
  Sidebar: ({ onOpenSettings }: { onOpenSettings: () => void }) => (
    <aside data-testid="sidebar">
      <button type="button" onClick={onOpenSettings}>
        settings
      </button>
    </aside>
  ),
}));

vi.mock("../../messages", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../messages")>();
  return {
    ...actual,
    Messages: ({
    showMessageAnchors,
    conversationState,
    activeEngine,
    isHistoryLoading,
    onForkFromMessage,
    onCaptureNote,
    timelineLeadingNode,
    isProviderContinuation,
  }: {
    showMessageAnchors: boolean;
    activeEngine?: string;
    isHistoryLoading?: boolean;
    onForkFromMessage?: (messageId: string) => void;
    onCaptureNote?: typeof capturedMessagesNoteCapture;
    timelineLeadingNode?: ReactNode;
    isProviderContinuation?: boolean;
    conversationState?: {
      meta?: {
        engine?: string;
        historyRestoredAtMs?: number | null;
      };
    } | null;
  }) => {
    capturedMessagesNoteCapture = onCaptureNote;
    return (
      <section
      data-testid="messages"
      data-message-anchors={String(showMessageAnchors)}
      data-active-engine={String(activeEngine ?? "")}
      data-history-loading={String(Boolean(isHistoryLoading))}
      data-conversation-engine={String(conversationState?.meta?.engine ?? "")}
      data-history-restored-at={String(
        conversationState?.meta?.historyRestoredAtMs ?? "",
      )}
      data-provider-continuation={String(Boolean(isProviderContinuation))}
    >
      {timelineLeadingNode}
      {onForkFromMessage ? (
        <button
          type="button"
          onClick={() => onForkFromMessage("user-fork-anchor")}
        >
          open fork confirm
        </button>
      ) : null}
      </section>
    );
    },
  };
});

vi.mock("../../composer/components/Composer", async () => {
  // 真实 Composer 已改为从 composerDraftStore 订阅草稿(不再有 draftText prop),
  // mock 同样从 store 读取,保持与生产一致的数据来源。
  const { useComposerDraft } = await import("../../composer/hooks/composerDraftStore");
  return {
  Composer: ({
    activeThreadId = null,
    onDraftChange,
    onSend,
    sendLabel,
    onOpenDiffPath,
    showStatusPanelToggleOverride,
    onResolvedAlwaysThinkingChange,
    createSessionTargetPicker = false,
    onCreationTargetEngineChange,
    selectedEngine,
    isSharedSession = false,
    providerProfileId = null,
    providerProfileName = null,
    selectedModelRuntime = null,
    onPersistNativeSessionTarget,
    submitDisabled = false,
    isContextCompacting = false,
    codexCompactionLifecycleState = "idle",
    codexCompactionSource = null,
  }: {
    activeThreadId?: string | null;
    onDraftChange: (next: string) => void;
    onSend: (text: string, images: string[]) => void;
    sendLabel: string;
    onOpenDiffPath?: (path: string) => void;
    showStatusPanelToggleOverride?: boolean;
    onResolvedAlwaysThinkingChange?: (enabled: boolean) => void;
    createSessionTargetPicker?: boolean;
    onCreationTargetEngineChange?: (
      engine: "claude" | "codex" | "gemini" | "kimi" | "opencode" | null,
    ) => void;
    selectedEngine?: string;
    isSharedSession?: boolean;
    providerProfileId?: string | null;
    providerProfileName?: string | null;
    selectedModelRuntime?: string | null;
    onPersistNativeSessionTarget?: (target: {
      engine: "codex";
      modelCatalogEntryId: string;
      model: string;
    }) => void;
    submitDisabled?: boolean;
    isContextCompacting?: boolean;
    codexCompactionLifecycleState?: string;
    codexCompactionSource?: string | null;
  }) => {
    const draftText = useComposerDraft(activeThreadId ?? null);
    composerMockState.thinkingCallbacks.push(onResolvedAlwaysThinkingChange);
    return (
      <form
        data-testid="composer"
        data-show-status-panel-toggle-override={String(
          showStatusPanelToggleOverride,
        )}
        data-create-session-target-picker={String(createSessionTargetPicker)}
        data-selected-engine={selectedEngine ?? ""}
        data-is-shared-session={String(isSharedSession)}
        data-provider-profile-id={providerProfileId ?? ""}
        data-provider-profile-name={providerProfileName ?? ""}
        data-selected-model-runtime={selectedModelRuntime ?? ""}
        data-submit-disabled={String(submitDisabled)}
        data-is-context-compacting={String(isContextCompacting)}
        data-codex-compaction-lifecycle={codexCompactionLifecycleState}
        data-codex-compaction-source={codexCompactionSource ?? ""}
      >
        <textarea
          aria-label="composer input"
          value={draftText}
          onChange={(event) => onDraftChange(event.currentTarget.value)}
        />
        <button type="button" onClick={() => onSend(draftText, [])}>
          {sendLabel}
        </button>
        {onOpenDiffPath ? (
          <button type="button" onClick={() => onOpenDiffPath("src/App.tsx")}>
            open file reference
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => onResolvedAlwaysThinkingChange?.(false)}
        >
          report thinking disabled
        </button>
        <button
          type="button"
          onClick={() =>
            onPersistNativeSessionTarget?.({
              engine: "codex",
              modelCatalogEntryId: "k3-256k",
              model: "k3-256k",
            })
          }
        >
          persist native target
        </button>
        {createSessionTargetPicker ? (
          <button
            type="button"
            onClick={() => onCreationTargetEngineChange?.("codex")}
          >
            select Codex creation target
          </button>
        ) : null}
      </form>
    );
  },
  };
});

vi.mock("../../app/components/MainHeader", () => ({
  MainHeader: ({
    sessionTabsNode,
    extraActionsNode,
  }: {
    sessionTabsNode?: ReactNode;
    extraActionsNode?: ReactNode;
  }) => (
    <header data-testid="main-header">
      {sessionTabsNode}
      {extraActionsNode}
    </header>
  ),
}));

vi.mock("../../app/components/TopbarSessionTabs", () => ({
  TopbarSessionTabs: () => <div data-testid="topbar-session-tabs" />,
}));

vi.mock("../../home/components/HomeChat", () => ({
  HomeChat: ({
    composerNode,
    selectedEngine,
  }: {
    composerNode?: ReactNode;
    selectedEngine?: string;
  }) => (
    <section data-testid="home-chat" data-selected-engine={selectedEngine}>
      {composerNode}
    </section>
  ),
}));

vi.mock("../../update/components/UpdateToast", () => ({
  UpdateToast: () => <div data-testid="update-toast" />,
}));

vi.mock("../../notifications/components/ErrorToasts", () => ({
  ErrorToasts: () => <div data-testid="error-toasts" />,
}));

vi.mock("../../notifications/components/GlobalRuntimeNoticeDock", () => ({
  GlobalRuntimeNoticeDock: () => <div data-testid="runtime-notice-dock" />,
}));

let capturedGitDiffPanelProps: {
  onOpenFileHistory?: (target: unknown) => void;
  headerControlsTarget?: HTMLElement | null;
} | null = null;

vi.mock("../../git/components/GitDiffPanel", () => ({
  GitDiffPanel: (props: typeof capturedGitDiffPanelProps) => {
    capturedGitDiffPanelProps = props;
    return <div data-testid="git-diff-panel" />;
  },
}));

vi.mock("../../git/components/GitDiffViewer", () => ({
  GitDiffViewer: () => <div data-testid="git-diff-viewer" />,
}));

let capturedFileTreePanelProps: {
  onGitRepositoryAction?: (request: {
    action: "stage-all";
    repositoryRoot: string;
  }) => Promise<void>;
  revealRequest?: {
    workspaceId: string;
    path: string;
    requestId: number;
  } | null;
} | null = null;
let capturedFileViewPanelProps: {
  filePath?: string;
  onRevealInFileTree?: (path: string) => void;
} | null = null;

vi.mock("../../files/components/FileTreePanel", () => ({
  FileTreePanel: (props: typeof capturedFileTreePanelProps) => {
    capturedFileTreePanelProps = props;
    return <div data-testid="file-tree-panel" />;
  },
}));

vi.mock("../../search/components/WorkspaceSearchPanel", () => ({
  WorkspaceSearchPanel: () => <div data-testid="workspace-search-panel" />,
}));

vi.mock("../../files/components/FileViewPanel", () => ({
  FileViewPanel: (props: typeof capturedFileViewPanelProps) => {
    capturedFileViewPanelProps = props;
    return <div data-testid="file-view-panel" />;
  },
}));

vi.mock("../../note-cards/components/WorkspaceNoteCardPanel", () => ({
  WorkspaceNoteCardPanel: (
    props: typeof capturedWorkspaceNotePanelProps,
  ) => {
    capturedWorkspaceNotePanelProps = props;
    return <div data-testid="workspace-note-card-panel" />;
  },
}));

vi.mock("../../prompts/components/PromptPanel", () => ({
  PromptPanel: () => <div data-testid="prompt-panel" />,
}));

vi.mock("../../project-memory/components/ProjectMemoryPanel", () => ({
  ProjectMemoryPanel: () => <div data-testid="project-memory-panel" />,
}));

vi.mock(
  "../../session-activity/components/WorkspaceSessionActivityPanel",
  () => ({
    WorkspaceSessionActivityPanel: () => (
      <div data-testid="workspace-session-activity-panel" />
    ),
  }),
);

vi.mock("../../session-activity/components/WorkspaceSessionRadarPanel", () => ({
  WorkspaceSessionRadarPanel: () => (
    <div data-testid="workspace-session-radar-panel" />
  ),
}));

vi.mock("../../debug/components/DebugPanel", () => ({
  DebugPanel: () => <div data-testid="debug-panel" />,
}));

vi.mock("../components/PanelTabs", () => ({
  PanelTabs: ({
    active,
    onSelect,
    visibleTabs,
  }: {
    active: string;
    onSelect: (id: string) => void;
    visibleTabs?: Partial<Record<string, boolean>>;
  }) => (
    <div data-testid="panel-tabs" data-active={active}>
      {visibleTabs?.projectMap !== false ? (
        <button type="button" onClick={() => onSelect("projectMap")}>
          projectMap
        </button>
      ) : null}
      {visibleTabs?.files !== false ? (
        <button type="button" onClick={() => onSelect("files")}>
          files
        </button>
      ) : null}
      <button type="button" onClick={() => onSelect("notes")}>
        notes
      </button>
    </div>
  ),
}));

vi.mock("../../app/components/TabBar", () => ({
  TabBar: () => <div data-testid="tab-bar" />,
}));

vi.mock("../../app/components/TabletNav", () => ({
  TabletNav: () => <div data-testid="tablet-nav" />,
}));

vi.mock("../../terminal/components/TerminalDock", () => ({
  TerminalDock: () => <div data-testid="terminal-dock" />,
}));

vi.mock("../../terminal/components/TerminalPanel", () => ({
  TerminalPanel: () => <div data-testid="terminal-panel" />,
}));

vi.mock("../../status-panel/components/StatusPanel", () => ({
  StatusPanel: ({
    dockCollapsed,
    selectedEngine,
  }: {
    dockCollapsed?: boolean;
    selectedEngine?: string;
  }) => (
    <div
      data-testid="status-panel"
      data-dock-collapsed={String(dockCollapsed)}
      data-selected-engine={String(selectedEngine ?? "")}
    />
  ),
}));

vi.mock("../../status-panel/hooks/useStatusPanelData", () => ({
  useStatusPanelData: () => ({
    todoTotal: 0,
    subagentTotal: 0,
    fileChanges: [],
    commandTotal: 0,
  }),
}));

vi.mock("../../session-activity/hooks/useWorkspaceSessionActivity", () => ({
  useWorkspaceSessionActivity: () => ({ isProcessing: false }),
}));

vi.mock("../../notifications/hooks/useGlobalRuntimeNoticeDock", () => ({
  useGlobalRuntimeNoticeDock: () => ({
    notices: [],
    visibility: "hidden",
    status: "idle",
    expand: vi.fn(),
    minimize: vi.fn(),
    clear: vi.fn(),
  }),
}));

const workspace: WorkspaceInfo = {
  id: "workspace-1",
  name: "Workspace",
  path: "/tmp/workspace",
  connected: true,
  settings: {},
} as WorkspaceInfo;

const activeItems: ConversationItem[] = [
  {
    id: "message-1",
    kind: "message",
    role: "user",
    text: "hello",
  },
];

const noop = vi.fn();
const asyncNoop = vi.fn(async () => undefined);
const asyncNull = vi.fn(async () => null);

function createGroupedLayoutNodesOptionsForTest(
  flatOptions: LayoutNodesFlatOptions,
): LayoutNodesOptions {
  return {
    workspace: flatOptions,
    runtime: flatOptions,
    chrome: flatOptions,
    editor: flatOptions,
    git: flatOptions,
    composer: flatOptions,
    panels: flatOptions,
  };
}

function createLayoutOptions(
  overrides: Partial<LayoutNodesFlatOptions> = {},
): Parameters<typeof useLayoutNodes>[0] {
  const baseOptions = {
    workspaces: [workspace],
    groupedWorkspaces: [
      { id: null, name: "Ungrouped", workspaces: [workspace] },
    ],
    hasWorkspaceGroups: false,
    deletingWorktreeIds: new Set(),
    threadsByWorkspace: {
      [workspace.id]: [{ id: "thread-1", name: "Thread", updatedAt: 1 }],
    },
    threadParentById: {},
    threadStatusById: {},
    historyLoadingByThreadId: {},
    historyRestoredAtMsByThread: {},
    runningSessionCountByWorkspaceId: {},
    recentCompletedSessionCountByWorkspaceId: {},
    hydratedThreadListWorkspaceIds: new Set(),
    threadListLoadingByWorkspace: {},
    threadListPagingByWorkspace: {},
    threadListCursorByWorkspace: {},
    activeWorkspaceId: workspace.id,
    activeThreadId: "thread-1",
    activeItems,
    activeQueuedHandoffBubble: null,
    threadItemsByThread: {},
    sessionRadarRunningSessions: [],
    sessionRadarRecentCompletedSessions: [],
    activeRateLimits: null,
    usageShowRemaining: false,
    showSidebarProviderLabels: false,
    showMessageAnchors: true,
    accountInfo: null,
    onSwitchAccount: noop,
    onCancelSwitchAccount: noop,
    accountSwitching: false,
    codeBlockCopyUseModifier: false,
    openAppTargets: [],
    openAppIconById: {},
    selectedOpenAppId: "",
    onSelectOpenAppId: noop,
    approvals: [],
    userInputRequests: [],
    handleApprovalDecision: noop,
    handleApprovalBatchAccept: noop,
    handleApprovalRemember: noop,
    handleUserInputDismiss: noop,
    handleUserInputSubmit: asyncNoop,
    onOpenSettings: noop,
    onOpenExperimentalSettings: noop,
    onOpenDebug: noop,
    showDebugButton: false,
    onAddWorkspace: noop,
    onSelectHome: noop,
    onSelectWorkspace: noop,
    onConnectWorkspace: asyncNoop,
    onAddAgent: asyncNull,
    onAddSharedAgent: asyncNull,
    onAddWorktreeAgent: asyncNoop,
    onAddCloneAgent: asyncNoop,
    onToggleWorkspaceCollapse: noop,
    onSelectThread: noop,
    onDeleteThread: noop,
    onArchiveThread: noop,
    onSyncThread: noop,
    pinThread: () => true,
    unpinThread: noop,
    isThreadPinned: () => false,
    isThreadAutoNaming: () => false,
    getPinTimestamp: () => null,
    pinnedThreadsVersion: 0,
    onRenameThread: noop,
    onAutoNameThread: noop,
    onDeleteWorkspace: noop,
    onDeleteWorktree: noop,
    onLoadOlderThreads: noop,
    onReloadWorkspaceThreads: noop,
    workspaceDropTargetRef: { current: null },
    isWorkspaceDropActive: false,
    workspaceDropText: "",
    onWorkspaceDragOver: noop,
    onWorkspaceDragEnter: noop,
    onWorkspaceDragLeave: noop,
    onWorkspaceDrop: noop,
    appMode: "chat",
    isPhone: false,
    isTablet: false,
    onAppModeChange: noop,
    onOpenHomeChat: noop,
    onOpenMemory: noop,
    onOpenProjectMemory: noop,
    onOpenReleaseNotes: noop,
    onOpenGlobalSearch: noop,
    globalSearchShortcut: null,
    openChatShortcut: null,
    openKanbanShortcut: null,
    cycleOpenSessionPrevShortcut: null,
    cycleOpenSessionNextShortcut: null,
    saveFileShortcut: null,
    findInFileShortcut: null,
    expandSelectionShortcut: null,
    toggleGitDiffListViewShortcut: null,
    onOpenSpecHub: noop,
    onOpenWorkspaceHome: noop,
    updaterState: { stage: "idle" },
    onUpdate: noop,
    onDismissUpdate: noop,
    errorToasts: [],
    onDismissErrorToast: noop,
    onSelectHomeWorkspace: noop,
    activeWorkspace: workspace,
    activeParentWorkspace: null,
    worktreeLabel: null,
    isWorktreeWorkspace: false,
    branchName: "main",
    branches: [],
    onCheckoutBranch: asyncNoop,
    onCreateBranch: asyncNoop,
    onCopyThread: noop,
    onToggleTerminal: noop,
    showTerminalButton: true,
    launchScript: null,
    launchScriptEditorOpen: false,
    launchScriptDraft: "",
    launchScriptSaving: false,
    launchScriptError: null,
    onRunLaunchScript: noop,
    onOpenLaunchScriptEditor: noop,
    onCloseLaunchScriptEditor: noop,
    onLaunchScriptDraftChange: noop,
    onSaveLaunchScript: noop,
    centerMode: "chat",
    setCenterMode: noop,
    fileCompareSession: null,
    editorSplitCompanion: "chat",
    setEditorSplitCompanion: noop,
    editorSplitLayout: "vertical",
    onToggleEditorSplitLayout: noop,
    isEditorFileMaximized: false,
    onToggleEditorFileMaximized: noop,
    editorFilePath: null,
    editorNavigationTarget: null,
    editorHighlightTarget: null,
    openEditorTabs: [],
    onActivateEditorTab: noop,
    onCloseEditorTab: noop,
    onCloseOtherEditorTabs: noop,
    onCloseAllEditorTabs: noop,
    onReorderEditorTabs: noop,
    onActiveEditorLineRangeChange: noop,
    onOpenFile: noop,
    onCompareFiles: () => true,
    onCloseFileCompare: noop,
    onExitEditor: noop,
    onExitDiff: noop,
    activeTab: "codex",
    onSelectTab: noop,
    tabletNavTab: "codex",
    gitPanelMode: "diff",
    onGitPanelModeChange: noop,
    onOpenGitHistoryPanel: noop,
    onOpenProjectMap: noop,
    gitDiffViewStyle: "split",
    gitDiffListView: "flat",
    onGitDiffListViewChange: noop,
    worktreeApplyLabel: "Apply",
    worktreeApplyTitle: null,
    worktreeApplyLoading: false,
    worktreeApplyError: null,
    worktreeApplySuccess: false,
    filePanelMode: "files",
    onFilePanelModeChange: noop,
    fileTreeLoading: false,
    fileTreeLoadError: null,
    onToggleRuntimeConsole: noop,
    runtimeConsoleVisible: false,
    gitStatus: {
      branchName: "main",
      files: [],
      stagedFiles: [],
      unstagedFiles: [],
      totalAdditions: 0,
      totalDeletions: 0,
      error: null,
    },
    fileStatus: "",
    selectedDiffPath: null,
    diffScrollRequestId: 0,
    onSelectDiff: noop,
    gitLogEntries: [],
    gitLogTotal: 0,
    gitLogAhead: 0,
    gitLogBehind: 0,
    gitLogAheadEntries: [],
    gitLogBehindEntries: [],
    gitLogUpstream: null,
    selectedCommitSha: null,
    onSelectCommit: noop,
    gitLogError: null,
    gitLogLoading: false,
    gitIssues: [],
    gitIssuesTotal: 0,
    gitIssuesLoading: false,
    gitIssuesError: null,
    gitPullRequests: [],
    gitPullRequestsTotal: 0,
    gitPullRequestsLoading: false,
    gitPullRequestsError: null,
    selectedPullRequestNumber: null,
    selectedPullRequest: null,
    selectedPullRequestComments: [],
    selectedPullRequestCommentsLoading: false,
    selectedPullRequestCommentsError: null,
    onSelectPullRequest: noop,
    gitRemoteUrl: null,
    gitRoot: null,
    gitRootCandidates: [],
    gitRootScanDepth: 3,
    gitRootScanLoading: false,
    gitRootScanError: null,
    gitRootScanHasScanned: false,
    onGitRootScanDepthChange: noop,
    onScanGitRoots: noop,
    onSelectGitRoot: noop,
    onClearGitRoot: noop,
    onPickGitRoot: noop,
    onStageGitAll: asyncNoop,
    onStageGitFile: asyncNoop,
    onUnstageGitAll: asyncNoop,
    onUnstageGitFile: asyncNoop,
    onUnstageGitPaths: asyncNoop,
    onRevertGitFile: asyncNoop,
    onRevertGitPaths: asyncNoop,
    onRevertAllGitChanges: asyncNoop,
    gitDiffs: [],
    gitDiffLoading: false,
    gitDiffError: null,
    onGitDiffViewStyleChange: noop,
    commitMessage: "",
    commitMessageLoading: false,
    commitMessageError: null,
    onCommitMessageChange: noop,
    onGenerateCommitMessage: noop,
    onSendPrompt: noop,
    onSendPromptToNewAgent: noop,
    onCreatePrompt: noop,
    onUpdatePrompt: noop,
    onDeletePrompt: noop,
    onMovePrompt: noop,
    onRevealWorkspacePrompts: noop,
    onRevealGeneralPrompts: noop,
    canRevealGeneralPrompts: false,
    onSend: noop,
    onQueue: noop,
    onStop: noop,
    canStop: false,
    isReviewing: false,
    isProcessing: false,
    steerEnabled: false,
    reviewPrompt: null,
    onReviewPromptClose: noop,
    onReviewPromptShowPreset: noop,
    onReviewPromptChoosePreset: noop,
    highlightedPresetIndex: -1,
    onReviewPromptHighlightPreset: noop,
    highlightedBranchIndex: -1,
    onReviewPromptHighlightBranch: noop,
    highlightedCommitIndex: -1,
    onReviewPromptHighlightCommit: noop,
    onReviewPromptKeyDown: () => false,
    onReviewPromptSelectBranch: noop,
    onReviewPromptSelectBranchAtIndex: noop,
    onReviewPromptConfirmBranch: asyncNoop,
    onReviewPromptSelectCommit: noop,
    onReviewPromptSelectCommitAtIndex: noop,
    onReviewPromptConfirmCommit: asyncNoop,
    onReviewPromptUpdateCustomInstructions: noop,
    onReviewPromptConfirmCustom: asyncNoop,
    activeTokenUsage: null,
    activeQueue: [],
    onDraftChange: noop,
    activeImages: [],
    onPickImages: noop,
    onAttachImages: noop,
    onRemoveImage: noop,
    prefillDraft: null,
    onPrefillHandled: noop,
    insertText: null,
    onInsertHandled: noop,
    onEditQueued: noop,
    onDeleteQueued: noop,
    onFuseQueued: noop,
    canFuseActiveQueue: false,
    activeFusingMessageId: null,
    collaborationModes: [],
    collaborationModesEnabled: false,
    selectedCollaborationModeId: null,
    onSelectCollaborationMode: noop,
    selectedEngine: "codex",
    models: [],
    selectedModelId: null,
    onSelectModel: noop,
    reasoningOptions: [],
    selectedEffort: null,
    onSelectEffort: noop,
    reasoningSupported: false,
    opencodeAgents: [],
    selectedOpenCodeAgent: null,
    onSelectOpenCodeAgent: noop,
    selectedAgent: null,
    onSelectAgent: noop,
    onOpenAgentSettings: noop,
    onOpenPromptSettings: noop,
    onOpenModelSettings: noop,
    onOpenCliSettings: noop,
    opencodeVariantOptions: [],
    selectedOpenCodeVariant: null,
    onSelectOpenCodeVariant: noop,
    accessMode: "default",
    onSelectAccessMode: noop,
    skills: [],
    prompts: [],
    commands: [],
    files: [],
    directories: [],
    gitignoredFiles: new Set(),
    gitignoredDirectories: new Set(),
    onInsertComposerText: noop,
    textareaRef: { current: null },
    composerEditorSettings: {
      preset: "default",
      expandFenceOnSpace: false,
      expandFenceOnEnter: false,
      fenceLanguageTags: false,
      fenceWrapSelection: false,
      autoWrapPasteMultiline: false,
      autoWrapPasteCodeLike: false,
      continueListOnShiftEnter: false,
    },
    composerSendShortcut: "enter",
    textareaHeight: 120,
    onTextareaHeightChange: noop,
    dictationEnabled: false,
    dictationState: "idle",
    dictationLevel: 0,
    onToggleDictation: noop,
    dictationTranscript: null,
    onDictationTranscriptHandled: noop,
    dictationError: null,
    onDismissDictationError: noop,
    dictationHint: null,
    onDismissDictationHint: noop,
    showComposer: true,
    composerLinkedKanbanPanels: [],
    selectedComposerKanbanPanelId: null,
    composerKanbanContextMode: "new",
    onSelectComposerKanbanPanel: noop,
    onComposerKanbanContextModeChange: noop,
    onOpenComposerKanbanPanel: noop,
    activeComposerFilePath: null,
    activeComposerFileLineRange: null,
    fileReferenceMode: "none",
    onFileReferenceModeChange: noop,
    plan: null,
    isPlanMode: false,
    onOpenPlanPanel: noop,
    onClosePlanPanel: noop,
    bottomStatusPanelExpanded: true,
    debugEntries: [],
    debugOpen: false,
    terminalOpen: false,
    terminalTabs: [],
    activeTerminalId: null,
    onSelectTerminal: noop,
    onNewTerminal: noop,
    onCloseTerminal: noop,
    terminalState: null,
    onClearDebug: noop,
    onCopyDebug: noop,
    onResizeDebug: noop,
    onResizeTerminal: noop,
    onBackFromDiff: noop,
    onGoProjects: noop,
    activeTurnId: null,
    systemProxyEnabled: false,
    systemProxyUrl: "",
    onRefreshAccountRateLimits: asyncNoop,
    onRecoverThreadRuntime: asyncNoop,
    onRecoverThreadRuntimeAndResend: asyncNoop,
    onThreadRecoveryFork: asyncNoop,
    handleExitPlanModeExecute: noop,
    onOpenDictationSettings: noop,
    engineOptions: [],
    onRefreshEngineOptions: asyncNoop,
    deleteConfirmThreadId: null,
    deleteConfirmWorkspaceId: null,
    deleteConfirmBusy: false,
    onCancelDeleteConfirm: noop,
    onConfirmDeleteConfirm: noop,
    onOpenClaudeTui: noop,
    onRenameWorkspaceAlias: noop,
    onQuickReloadWorkspaceThreads: noop,
    showLoadingProgressDialog: noop,
    hideLoadingProgressDialog: noop,
    closeCurrentSessionShortcut: null,
    worktreeRename: undefined,
    onLockPanel: noop,
    launchScriptsState: {
      launchScripts: [],
      editorOpenId: null,
      draftScript: "",
      draftIcon: "play",
      draftLabel: "",
      newEditorOpen: false,
      newDraftScript: "",
      newDraftIcon: "play",
      newDraftLabel: "",
      newError: null,
      isSaving: false,
      error: null,
      errorById: {},
      onRunScript: noop,
      onOpenEditor: noop,
      onCloseEditor: noop,
      onDraftScriptChange: noop,
      onDraftIconChange: noop,
      onDraftLabelChange: noop,
      onSaveScript: asyncNoop,
      onDeleteScript: asyncNoop,
      onOpenNew: noop,
      onCloseNew: noop,
      onNewDraftScriptChange: noop,
      onNewDraftIconChange: noop,
      onNewDraftLabelChange: noop,
      onCreateNew: asyncNoop,
    },
    mainHeaderActions: [],
    browserDockOpen: false,
    onCloseBrowserDock: noop,
    externalChangeMonitoringEnabled: false,
    externalChangeTransportMode: "watcher",
    externalChangeApplyMode: "manual",
    externalChangeAutoApplyDebounceMs: 300,
    liveEditPreviewEnabled: false,
    onToggleLiveEditPreview: noop,
    intentCanvasOpenRequest: null,
    onOpenIntentCanvas: noop,
    onIntentCanvasOpenRequestConsumed: noop,
    onAttachIntentCanvasToThread: asyncNoop,
    pendingIntentCanvasDocuments: [],
    onRemovePendingIntentCanvas: noop,
    onApplyWorktreeChanges: asyncNoop,
    focusedProjectMemoryId: null,
    focusedProjectMemoryRequestKey: 0,
    focusedWorkspaceNoteId: null,
    focusedWorkspaceNoteRequestKey: 0,
    onRefreshFiles: noop,
    onOpenDetachedFileExplorer: noop,
    refreshGitLog: noop,
    refreshGitDiffs: asyncNoop,
    queueGitStatusRefresh: noop,
    onDiffActivePathChange: noop,
    onCommit: asyncNoop,
    onCommitAndPush: asyncNoop,
    onCommitAndSync: asyncNoop,
    onPush: asyncNoop,
    onSync: asyncNoop,
    commitLoading: false,
    pushLoading: false,
    syncLoading: false,
    commitError: null,
    pushError: null,
    syncError: null,
    commitsAhead: 0,
    onRequestContextCompaction: noop,
    completionEmailSelected: false,
    completionEmailDisabled: false,
    onToggleCompletionEmail: noop,
    onRewind: noop,
    onForkFromMessage: asyncNoop,
    contextDualViewEnabled: false,
    codexAutoCompactionEnabled: false,
    codexAutoCompactionThresholdPercent: 80,
    onCodexAutoCompactionSettingsChange: noop,
    engines: [],
    usePresentationProfile: false,
    onSelectEngine: noop,
    projectMapDatasetController: undefined,
    claudeThinkingVisible: false,
    onResolvedClaudeThinkingVisibleChange: noop,
    onRefreshModelConfig: asyncNoop,
    isModelConfigRefreshing: false,
    customSkillDirectories: [],
    directoryMetadata: [],
    fileTreeSourceVersion: null,
    composerSendLabel: "messages.send",
    activeCodeSelectionAnchor: null,
    onActiveCodeSelectionAnchorChange: noop,
    agentTaskScrollRequest: null,
    onSelectSubagent: noop,
  } satisfies LayoutNodesFlatOptions;
  const flatOptions = Object.assign(baseOptions, overrides);

  return createGroupedLayoutNodesOptionsForTest(flatOptions);
}

function LayoutNodesHarness({
  options,
}: {
  options: Parameters<typeof useLayoutNodes>[0];
}) {
  const nodes = useLayoutNodes(options);
  return (
    <>
      {nodes.messagesNode}
      {nodes.composerNode}
    </>
  );
}

function HomeLayoutNodesHarness({
  options,
}: {
  options: Parameters<typeof useLayoutNodes>[0];
}) {
  return useLayoutNodes(options).homeNode;
}

async function renderUseLayoutNodes(
  options: Parameters<typeof useLayoutNodes>[0],
) {
  const renderedHook = renderHook(() => useLayoutNodes(options));
  await act(async () => {
    await Promise.resolve();
  });
  return renderedHook;
}

describe("useLayoutNodes client UI visibility", () => {
  afterEach(() => {
    resetSharedSendStateStoreForTests();
    capturedGitDiffPanelProps = null;
    capturedFileTreePanelProps = null;
    clientUiVisibilityMock.visiblePanels.clear();
    clientUiVisibilityMock.visibleControls.clear();
    composerMockState.thinkingCallbacks.length = 0;
    capturedMessagesNoteCapture = undefined;
    capturedWorkspaceNotePanelProps = null;
    vi.clearAllMocks();
  });

  it("enables the create-session target picker only for Home composer", async () => {
    const options = createLayoutOptions({
      activeThreadId: "shared-thread",
      threadsByWorkspace: {
        [workspace.id]: [
          {
            id: "shared-thread",
            name: "Shared",
            updatedAt: 1,
            engineSource: "claude",
            threadKind: "shared",
            providerProfileId: "__local_settings_json__",
            providerProfileName: "Local Settings",
          },
        ],
      },
    });
    const { result } = await renderUseLayoutNodes(options);

    const normalComposer = render(<>{result.current.composerNode}</>);
    expect(
      normalComposer.getByTestId("composer").dataset
        .createSessionTargetPicker,
    ).toBe("false");
    expect(
      normalComposer.getByTestId("composer").dataset.isSharedSession,
    ).toBe("true");
    expect(
      normalComposer.getByTestId("composer").dataset.providerProfileId,
    ).toBe("__local_settings_json__");
    expect(
      normalComposer.getByTestId("composer").dataset.providerProfileName,
    ).toBe("Local Settings");
    normalComposer.unmount();

    const homeComposer = render(<>{result.current.homeNode}</>);
    expect(
      homeComposer.getByTestId("composer").dataset.createSessionTargetPicker,
    ).toBe("true");
    expect(
      homeComposer.getByTestId("composer").dataset.isSharedSession,
    ).toBe("false");
    expect(
      homeComposer.getByTestId("composer").dataset.providerProfileId,
    ).toBe("");
    expect(
      homeComposer.getByTestId("composer").dataset.providerProfileName,
    ).toBe("");
  });

  it("forwards native runtime model identity and persistence through the layout", async () => {
    const onPersistNativeSessionTarget = vi.fn();
    const { result } = await renderUseLayoutNodes(
      createLayoutOptions({
        selectedModelRuntime: "k3-256k",
        onPersistNativeSessionTarget,
      }),
    );

    render(<>{result.current.composerNode}</>);

    expect(screen.getByTestId("composer").dataset.selectedModelRuntime).toBe(
      "k3-256k",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "persist native target" }),
    );
    expect(onPersistNativeSessionTarget).toHaveBeenCalledWith({
      engine: "codex",
      modelCatalogEntryId: "k3-256k",
      model: "k3-256k",
    });
  });

  it("allows Shared running follow-up queue and projects compaction lifecycle", async () => {
    const threadId = "shared-thread";
    dispatchSharedSendEvent(workspace.id, threadId, { type: "send" });
    dispatchSharedSendEvent(workspace.id, threadId, {
      type: "packagePrepared",
    });
    dispatchSharedSendEvent(workspace.id, threadId, { type: "runtimeAck" });
    const options = createLayoutOptions({
      activeThreadId: threadId,
      isProcessing: true,
      composerSendLabel: undefined,
      threadStatusById: {
        [threadId]: {
          isProcessing: true,
          hasUnread: false,
          isReviewing: false,
          isContextCompacting: true,
          processingStartedAt: 1,
          lastDurationMs: null,
          codexCompactionLifecycleState: "compacting",
          codexCompactionSource: "auto",
        },
      },
      threadsByWorkspace: {
        [workspace.id]: [
          {
            id: threadId,
            name: "Shared",
            updatedAt: 1,
            engineSource: "codex",
            threadKind: "shared",
          },
        ],
      },
    });
    const { result } = await renderUseLayoutNodes(options);

    const rendered = render(<>{result.current.composerNode}</>);
    const composer = rendered.getByTestId("composer");
    expect(composer.dataset.submitDisabled).toBe("false");
    expect(composer.dataset.isContextCompacting).toBe("true");
    expect(composer.dataset.codexCompactionLifecycle).toBe("compacting");
    expect(composer.dataset.codexCompactionSource).toBe("auto");
    expect(
      rendered.getByRole("button", { name: "messages.queue" }),
    ).toBeTruthy();
  });

  it("projects the Home creation target Engine into the hero icon owner", async () => {
    render(
      <HomeLayoutNodesHarness
        options={createLayoutOptions({ selectedEngine: "claude" })}
      />,
    );

    expect(screen.getByTestId("home-chat").dataset.selectedEngine).toBe(
      "claude",
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "select Codex creation target",
      }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("home-chat").dataset.selectedEngine).toBe(
        "codex",
      );
    });
  });

  it("projects the loaded source turn into Provider Continuation metadata", async () => {
    const { result } = await renderUseLayoutNodes(
      createLayoutOptions({
        activeThreadId: "codex:target",
        threadsByWorkspace: {
          [workspace.id]: [
            {
              id: "claude:source",
              name: "Source",
              updatedAt: 1,
              engineSource: "claude",
            },
            {
              id: "codex:target",
              name: "Target",
              updatedAt: 2,
              engineSource: "codex",
              originKind: "provider-continuation",
              sourceSessionId: "claude:source",
            },
          ],
        },
        threadItemsByThread: {
          "claude:source": [
            {
              id: "source-user",
              kind: "message",
              role: "user",
              text: "来源最后一个问题",
            },
            {
              id: "source-assistant",
              kind: "message",
              role: "assistant",
              text: "来源最后一个回答",
            },
          ],
        },
      }),
    );
    render(<>{result.current.messagesNode}</>);

    expect(screen.getByText("来源最后一个问题")).toBeTruthy();
    expect(screen.getByText("来源最后一个回答")).toBeTruthy();
    expect(screen.getByTestId("messages").dataset.providerContinuation).toBe(
      "true",
    );
  });

  it("selects the exact repository before staging from the file-tree Git menu", async () => {
    const onSelectGitRoot = vi.fn(async () => undefined);
    const onStageGitAll = vi.fn(async () => undefined);
    const { result } = await renderUseLayoutNodes(
      createLayoutOptions({ onSelectGitRoot, onStageGitAll }),
    );

    render(<>{result.current.gitDiffPanelNode}</>);
    await act(async () => {
      await capturedFileTreePanelProps?.onGitRepositoryAction?.({
        action: "stage-all",
        repositoryRoot: "services/api",
      });
    });

    expect(onSelectGitRoot).toHaveBeenCalledWith("services/api");
    expect(onStageGitAll).toHaveBeenCalledTimes(1);
    expect(onSelectGitRoot.mock.invocationCallOrder[0]).toBeLessThan(
      onStageGitAll.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
  });

  it("forwards the existing File History navigation capability into Git Diff", async () => {
    const onOpenFileHistory = vi.fn();
    const { result } = await renderUseLayoutNodes(
      createLayoutOptions({
        filePanelMode: "git",
        onOpenFileHistory,
      }),
    );

    render(<>{result.current.gitDiffPanelNode}</>);
    await screen.findByTestId("git-diff-panel");

    expect(capturedGitDiffPanelProps?.onOpenFileHistory).toBe(
      onOpenFileHistory,
    );
  });

  it("keeps conversation, composer, send, and settings recovery available when every optional entry is hidden", async () => {
    const onOpenSettings = vi.fn();
    const onSend = vi.fn();
    // 草稿经 composerDraftStore 注入(fixture 的 activeThreadId 为 thread-1)。
    setComposerDraft("thread-1", "hello from maximum hidden mode");
    const { result } = await renderUseLayoutNodes(
      createLayoutOptions({ onOpenSettings, onSend }),
    );

    expect(result.current.rightPanelToolbarNode).toBeNull();
    expect(result.current.planPanelNode).toBeNull();
    expect(result.current.globalRuntimeNoticeDockNode).toBeNull();

    render(
      <>
        {result.current.sidebarNode}
        {result.current.messagesNode}
        {result.current.composerNode}
        {result.current.globalRuntimeNoticeDockNode}
      </>,
    );

    expect(screen.queryByTestId("runtime-notice-dock")).toBeNull();
    expect(screen.getByTestId("messages")).toBeTruthy();
    expect(screen.getByTestId("messages").dataset.messageAnchors).toBe("false");
    expect(
      screen.getByRole("textbox", { name: "composer input" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "messages.send" }));
    expect(onSend).toHaveBeenCalledWith("hello from maximum hidden mode", []);

    fireEvent.click(screen.getByRole("button", { name: "settings" }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("does not show history loading for a freshly opened pending draft", async () => {
    const { result } = await renderUseLayoutNodes(
      createLayoutOptions({
        activeThreadId: "codex-pending-123",
        activeItems: [],
      }),
    );

    render(
      <>
        {result.current.messagesNode}
        {result.current.composerNode}
      </>,
    );

    expect(screen.getByTestId("messages").dataset.historyLoading).toBe("false");
  });

  it("does not forward duplicate resolved Claude thinking visibility", async () => {
    const onResolvedClaudeThinkingVisibleChange = vi.fn();
    const { result } = await renderUseLayoutNodes(
      createLayoutOptions({
        claudeThinkingVisible: false,
        onResolvedClaudeThinkingVisibleChange,
      }),
    );

    render(
      <>
        {result.current.messagesNode}
        {result.current.composerNode}
      </>,
    );

    fireEvent.click(screen.getByText("report thinking disabled"));

    expect(onResolvedClaudeThinkingVisibleChange).not.toHaveBeenCalled();
  });

  it("keeps the resolved Claude thinking callback stable after local sync", async () => {
    const onResolvedClaudeThinkingVisibleChange = vi.fn();

    render(
      <LayoutNodesHarness
        options={createLayoutOptions({
          claudeThinkingVisible: undefined,
          onResolvedClaudeThinkingVisibleChange,
        })}
      />,
    );

    const firstCallback = composerMockState.thinkingCallbacks.at(-1);
    fireEvent.click(screen.getByText("report thinking disabled"));

    await waitFor(() => {
      expect(onResolvedClaudeThinkingVisibleChange).toHaveBeenCalledWith(false);
    });

    expect(composerMockState.thinkingCallbacks.at(-1)).toBe(firstCallback);

    fireEvent.click(screen.getByText("report thinking disabled"));
    expect(onResolvedClaudeThinkingVisibleChange).toHaveBeenCalledTimes(1);
  });

  it("forwards restored history metadata into the runtime conversation state", async () => {
    const { result } = await renderUseLayoutNodes(
      createLayoutOptions({
        historyRestoredAtMsByThread: {
          "thread-1": 1234,
        },
      }),
    );

    render(<>{result.current.messagesNode}</>);

    expect(screen.getByTestId("messages").dataset.historyRestoredAt).toBe(
      "1234",
    );
  });

  it("confirms message-tail fork before running the fork callback", async () => {
    const onForkFromMessage = vi.fn(async () => {});

    render(
      <LayoutNodesHarness
        options={createLayoutOptions({ onForkFromMessage })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "open fork confirm" }));

    expect(onForkFromMessage).not.toHaveBeenCalled();
    expect(screen.getByText("messages.forkConfirmTitle")).toBeTruthy();
    expect(screen.getByText("messages.forkConfirmDescription")).toBeTruthy();
    expect(screen.getByText("messages.forkConfirmPurpose")).toBeTruthy();
    expect(screen.getByText("messages.forkConfirmUsage")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "messages.forkConfirmAction" }),
    );

    await waitFor(() => {
      expect(onForkFromMessage).toHaveBeenCalledWith("user-fork-anchor", {
        providerProfileId: "__disk__",
        providerProfile: {
          id: "__disk__",
          name: "本地配置",
          source: "disk",
        },
      });
    });
  });

  it(
    "keeps message-tail fork on the active codex provider",
    async () => {
      vi.mocked(getCodexProviders).mockResolvedValueOnce([
        { id: "provider-a", name: "Provider A" },
        { id: "provider-b", name: "Provider B" },
      ]);
      const onForkFromMessage = vi.fn(async () => {});

      render(
        <LayoutNodesHarness
          options={createLayoutOptions({
            onForkFromMessage,
            threadsByWorkspace: {
              [workspace.id]: [
                {
                  id: "thread-1",
                  name: "Thread",
                  updatedAt: 1,
                  engineSource: "codex",
                  providerProfileId: "provider-a",
                  providerProfileName: "Provider A",
                  providerProfileSource: "managed",
                },
              ],
            },
          })}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "open fork confirm" }));

      const selector = await screen.findByLabelText("messages.forkProviderLabel");
      expect((selector as HTMLSelectElement).value).toBe("provider-a");
      expect(screen.queryByRole("option", { name: "Provider B" })).toBeNull();
      fireEvent.click(
        screen.getByRole("button", { name: "messages.forkConfirmAction" }),
      );

      await waitFor(() => {
        expect(onForkFromMessage).toHaveBeenCalledWith("user-fork-anchor", {
          providerProfileId: "provider-a",
          providerProfile: {
            id: "provider-a",
            name: "Provider A",
            source: "managed",
          },
        });
      });
    },
    10_000,
  );

  it("uses the active thread engine when restoring a Claude session while Codex is selected globally", async () => {
    const { result } = await renderUseLayoutNodes(
      createLayoutOptions({
        selectedEngine: "codex",
        activeThreadId: "claude:session-1",
        threadsByWorkspace: {
          [workspace.id]: [
            {
              id: "claude:session-1",
              name: "Claude history",
              updatedAt: 1,
              engineSource: "claude",
            },
          ],
        },
        historyLoadingByThreadId: {
          "claude:session-1": true,
        },
      }),
    );

    render(<>{result.current.messagesNode}</>);

    expect(screen.getByTestId("messages").dataset.activeEngine).toBe("claude");
    expect(screen.getByTestId("messages").dataset.conversationEngine).toBe(
      "claude",
    );
    render(<>{result.current.composerNode}</>);
    expect(screen.getByTestId("composer").dataset.selectedEngine).toBe("claude");
  });

  it.each([
    "claude",
    "codex",
    "gemini",
    "grok",
    "kimi",
    "opencode",
  ] as const)(
    "keeps the Composer engine bound to a restored %s thread",
    async (engineSource) => {
      const { result } = await renderUseLayoutNodes(
        createLayoutOptions({
          selectedEngine: engineSource === "codex" ? "claude" : "codex",
          activeThreadId: `${engineSource}:session-1`,
          threadsByWorkspace: {
            [workspace.id]: [
              {
                id: `${engineSource}:session-1`,
                name: `${engineSource} history`,
                updatedAt: 1,
                engineSource,
                selectedEngine:
                  engineSource === "codex" ? "claude" : "codex",
              },
            ],
          },
        }),
      );

      render(<>{result.current.composerNode}</>);

      expect(screen.getByTestId("composer").dataset.selectedEngine).toBe(
        engineSource,
      );
    },
  );

  it("does not crash when restored history metadata is omitted by a caller", async () => {
    const optionsWithoutRestoreMeta = {
      ...createLayoutOptions(),
      historyRestoredAtMsByThread: undefined,
    };

    const { result } = await renderUseLayoutNodes(optionsWithoutRestoreMeta);

    render(<>{result.current.messagesNode}</>);

    expect(screen.getByTestId("messages").dataset.historyRestoredAt ?? "").toBe(
      "",
    );
  });

  it("routes composer file reference open actions through the file-open pipeline", async () => {
    const onOpenFile = vi.fn();
    const { result } = await renderUseLayoutNodes(
      createLayoutOptions({
        onOpenFile,
      }),
    );

    render(<>{result.current.composerNode}</>);

    fireEvent.click(
      screen.getByRole("button", { name: "open file reference" }),
    );

    expect(onOpenFile).toHaveBeenCalledWith("src/App.tsx");
  });

  it("toggles the Project Map toolbar icon off from full Project Map mode", async () => {
    clientUiVisibilityMock.visiblePanels.add("rightActivityToolbar");
    clientUiVisibilityMock.visibleControls.add("rightToolbar.projectMap");
    const setCenterMode = vi.fn();
    const { result } = await renderUseLayoutNodes(
      createLayoutOptions({
        centerMode: "projectMap",
        setCenterMode,
      }),
    );

    render(<>{result.current.rightPanelToolbarNode}</>);
    expect(screen.getByTestId("panel-tabs").dataset.active).toBe("projectMap");

    fireEvent.click(screen.getByRole("button", { name: "projectMap" }));

    expect(setCenterMode).toHaveBeenCalledWith("chat");
  });

  it("opens the Project Map toolbar icon from chat mode", async () => {
    clientUiVisibilityMock.visiblePanels.add("rightActivityToolbar");
    clientUiVisibilityMock.visibleControls.add("rightToolbar.projectMap");
    const onOpenProjectMap = vi.fn();
    const { result } = await renderUseLayoutNodes(
      createLayoutOptions({
        centerMode: "chat",
        onOpenProjectMap,
      }),
    );

    render(<>{result.current.rightPanelToolbarNode}</>);
    expect(screen.getByTestId("panel-tabs").dataset.active).toBe("files");

    fireEvent.click(screen.getByRole("button", { name: "projectMap" }));

    expect(onOpenProjectMap).toHaveBeenCalledTimes(1);
  });

  it("connects the active Git toolbar leading slot to GitDiffPanel", async () => {
    clientUiVisibilityMock.visiblePanels.add("rightActivityToolbar");
    clientUiVisibilityMock.visibleControls.add("rightToolbar.git");
    const { result } = await renderUseLayoutNodes(
      createLayoutOptions({
        filePanelMode: "git",
      }),
    );

    const toolbarView = render(<>{result.current.rightPanelToolbarNode}</>);
    const toolbar = toolbarView.container.querySelector(".right-panel-toolbar");
    const target = toolbarView.container.querySelector<HTMLElement>(
      ".right-panel-git-mode-slot",
    );

    expect(target).toBeTruthy();
    expect(toolbar?.classList.contains("has-git-mode-slot")).toBe(true);
    expect(toolbar?.firstElementChild).toBe(target);
    expect(target?.nextElementSibling?.getAttribute("data-testid")).toBe(
      "panel-tabs",
    );

    render(<>{result.current.gitDiffPanelNode}</>);
    await screen.findByTestId("git-diff-panel");

    expect(capturedGitDiffPanelProps?.headerControlsTarget).toBe(target);
  });

  it("does not render a Git mode slot for a non-Git right panel tab", async () => {
    clientUiVisibilityMock.visiblePanels.add("rightActivityToolbar");
    clientUiVisibilityMock.visibleControls.add("rightToolbar.files");
    const { result } = await renderUseLayoutNodes(
      createLayoutOptions({
        filePanelMode: "files",
      }),
    );

    const toolbarView = render(<>{result.current.rightPanelToolbarNode}</>);

    expect(
      toolbarView.container.querySelector(".right-panel-git-mode-slot"),
    ).toBeNull();
    expect(
      toolbarView.container
        .querySelector(".right-panel-toolbar")
        ?.classList.contains("has-git-mode-slot"),
    ).toBe(false);
    expect(
      toolbarView.container
        .querySelector(".right-panel-toolbar")
        ?.firstElementChild?.getAttribute("data-testid"),
    ).toBe("panel-tabs");
  });

  it("opens note cards as a center surface and keeps the toolbar selection", async () => {
    clientUiVisibilityMock.visiblePanels.add("rightActivityToolbar");
    clientUiVisibilityMock.visibleControls.add("rightToolbar.notes");
    const setCenterMode = vi.fn();
    const onFilePanelModeChange = vi.fn();
    const { result } = await renderUseLayoutNodes(
      createLayoutOptions({
        centerMode: "chat",
        setCenterMode,
        onFilePanelModeChange,
      }),
    );

    render(<>{result.current.rightPanelToolbarNode}</>);
    fireEvent.click(screen.getByRole("button", { name: "notes" }));

    expect(onFilePanelModeChange).toHaveBeenCalledWith("notes");
    expect(setCenterMode).toHaveBeenCalledWith("notes");
  });

  it("routes a captured draft into the note workbench with a monotonic request", async () => {
    const setCenterMode = vi.fn();
    const onFilePanelModeChange = vi.fn();
    const initialOptions = createLayoutOptions({
      centerMode: "chat",
      setCenterMode,
      onFilePanelModeChange,
    });
    const rendered = renderHook(
      ({ options }: { options: Parameters<typeof useLayoutNodes>[0] }) =>
        useLayoutNodes(options),
      { initialProps: { options: initialOptions } },
    );
    render(<>{rendered.result.current.messagesNode}</>);

    await act(async () => {
      capturedMessagesNoteCapture?.({
        title: "Captured conversation",
        bodyMarkdown: "Semantic body",
        source: {
          kind: "conversationThread",
          threadId: "thread-1",
          itemCount: 2,
          capturedAt: 123,
        },
      });
      await Promise.resolve();
    });

    expect(onFilePanelModeChange).toHaveBeenCalledWith("notes");
    expect(setCenterMode).toHaveBeenCalledWith("notes");

    await act(async () => {
      rendered.rerender({
        options: createLayoutOptions({
          centerMode: "notes",
          setCenterMode,
          onFilePanelModeChange,
        }),
      });
      await Promise.resolve();
    });
    render(<>{rendered.result.current.noteCardsPanelNode}</>);

    expect(capturedWorkspaceNotePanelProps?.captureRequest).toMatchObject({
      requestId: 1,
      draft: {
        title: "Captured conversation",
        bodyMarkdown: "Semantic body",
      },
    });
    await act(async () => {
      capturedWorkspaceNotePanelProps?.onCaptureRequestHandled?.(1);
      await Promise.resolve();
    });
    await act(async () => {
      rendered.rerender({
        options: createLayoutOptions({
          centerMode: "notes",
          setCenterMode,
          onFilePanelModeChange,
        }),
      });
      await Promise.resolve();
    });
    render(<>{rendered.result.current.noteCardsPanelNode}</>);
    expect(capturedWorkspaceNotePanelProps?.captureRequest).toBeNull();
  });

  it("routes a note code source to the editor and restores its captured line range", async () => {
    const onOpenFile = vi.fn();
    const onActiveEditorLineRangeChange = vi.fn();
    const { result } = await renderUseLayoutNodes(
      createLayoutOptions({
        centerMode: "notes",
        onOpenFile,
        onActiveEditorLineRangeChange,
      }),
    );
    render(<>{result.current.noteCardsPanelNode}</>);

    act(() => {
      capturedWorkspaceNotePanelProps?.onOpenCodeSource?.({
        kind: "codeSelection",
        path: "src/main/java/AppUserController.java",
        startLine: 21,
        endLine: 37,
        language: "java",
      });
    });

    expect(onActiveEditorLineRangeChange).not.toHaveBeenCalled();
    expect(onOpenFile).toHaveBeenCalledWith(
      "src/main/java/AppUserController.java",
      {
        line: 21,
        endLine: 37,
        column: 1,
        scrollPosition: "center",
      },
      {
        editorSplitCompanion: "notes",
      },
    );
  });

  it("keeps the note workbench mounted only for the notes editor companion", async () => {
    const notesCompanion = await renderUseLayoutNodes(
      createLayoutOptions({
        centerMode: "editor",
        editorSplitCompanion: "notes",
      }),
    );
    render(<>{notesCompanion.result.current.noteCardsPanelNode}</>);

    expect(capturedWorkspaceNotePanelProps).not.toBeNull();

    capturedWorkspaceNotePanelProps = null;
    const chatCompanion = await renderUseLayoutNodes(
      createLayoutOptions({
        centerMode: "editor",
        editorSplitCompanion: "chat",
      }),
    );

    expect(chatCompanion.result.current.noteCardsPanelNode).toBeNull();
    expect(capturedWorkspaceNotePanelProps).toBeNull();
  });

  it("toggles the Project Map toolbar icon off from editor companion mode", async () => {
    clientUiVisibilityMock.visiblePanels.add("rightActivityToolbar");
    clientUiVisibilityMock.visibleControls.add("rightToolbar.projectMap");
    const setEditorSplitCompanion = vi.fn();
    const { result } = await renderUseLayoutNodes(
      createLayoutOptions({
        centerMode: "editor",
        editorSplitCompanion: "projectMap",
        setEditorSplitCompanion,
      }),
    );

    render(<>{result.current.rightPanelToolbarNode}</>);
    expect(screen.getByTestId("panel-tabs").dataset.active).toBe("projectMap");

    fireEvent.click(screen.getByRole("button", { name: "projectMap" }));

    expect(setEditorSplitCompanion).toHaveBeenCalledWith("chat");
  });

  it("opens the Project Map toolbar icon as an editor companion without closing the editor", async () => {
    clientUiVisibilityMock.visiblePanels.add("rightActivityToolbar");
    clientUiVisibilityMock.visibleControls.add("rightToolbar.projectMap");
    const onOpenProjectMap = vi.fn();
    const setCenterMode = vi.fn();
    const setEditorSplitCompanion = vi.fn();
    const { result } = await renderUseLayoutNodes(
      createLayoutOptions({
        centerMode: "editor",
        editorSplitCompanion: "chat",
        onOpenProjectMap,
        setCenterMode,
        setEditorSplitCompanion,
      }),
    );

    render(<>{result.current.rightPanelToolbarNode}</>);
    expect(screen.getByTestId("panel-tabs").dataset.active).toBe("files");

    fireEvent.click(screen.getByRole("button", { name: "projectMap" }));

    expect(setEditorSplitCompanion).toHaveBeenCalledWith("projectMap");
    expect(onOpenProjectMap).not.toHaveBeenCalled();
    expect(setCenterMode).not.toHaveBeenCalled();
  });

  it("restores a maximized editor when the Project Map toolbar icon opens as companion", async () => {
    clientUiVisibilityMock.visiblePanels.add("rightActivityToolbar");
    clientUiVisibilityMock.visibleControls.add("rightToolbar.projectMap");
    const setEditorSplitCompanion = vi.fn();
    const onToggleEditorFileMaximized = vi.fn();
    const { result } = await renderUseLayoutNodes(
      createLayoutOptions({
        centerMode: "editor",
        editorSplitCompanion: "chat",
        setEditorSplitCompanion,
        isEditorFileMaximized: true,
        onToggleEditorFileMaximized,
      }),
    );

    render(<>{result.current.rightPanelToolbarNode}</>);

    fireEvent.click(screen.getByRole("button", { name: "projectMap" }));

    expect(setEditorSplitCompanion).toHaveBeenCalledWith("projectMap");
    expect(onToggleEditorFileMaximized).toHaveBeenCalledTimes(1);
  });

  it("hides the Project Map toolbar icon when its visibility control is disabled", async () => {
    clientUiVisibilityMock.visiblePanels.add("rightActivityToolbar");
    clientUiVisibilityMock.visibleControls.add("rightToolbar.files");
    const onOpenProjectMap = vi.fn();
    const { result } = await renderUseLayoutNodes(
      createLayoutOptions({
        centerMode: "chat",
        onOpenProjectMap,
      }),
    );

    render(<>{result.current.rightPanelToolbarNode}</>);

    expect(screen.queryByRole("button", { name: "projectMap" })).toBeNull();
    expect(screen.getByRole("button", { name: "files" })).toBeTruthy();
  });

  it("retires the bottom status dock in favor of composer run-status strip", async () => {
    clientUiVisibilityMock.visiblePanels.add("bottomActivityPanel");
    clientUiVisibilityMock.visibleControls.add("bottomActivity.checkpoint");

    const { result } = await renderUseLayoutNodes(
      createLayoutOptions({
        bottomStatusPanelExpanded: false,
        selectedEngine: "opencode",
      }),
    );

    // 任务/子代理/Plan/编辑迁到 Composer 上方；底部 dock（含概览）不再挂载。
    expect(result.current.planPanelNode).toBeNull();

    render(<>{result.current.composerNode}</>);

    expect(screen.queryByTestId("status-panel")).toBeNull();
    expect(
      screen.getByTestId("composer").dataset.showStatusPanelToggleOverride,
    ).toBe("false");
  });

  it("routes file reveal intents to the main Files tree with a monotonic request", async () => {
    const onFilePanelModeChange = vi.fn();
    const rendered = await renderUseLayoutNodes(
      createLayoutOptions({
        editorFilePath: "src/features/Main.tsx",
        openEditorTabs: ["src/features/Main.tsx"],
        filePanelMode: "files",
        onFilePanelModeChange,
      }),
    );
    const surfaces = render(
      <>
        {rendered.result.current.gitDiffPanelNode}
        {rendered.result.current.fileViewPanelNode}
      </>,
    );
    await screen.findByTestId("file-view-panel");

    act(() => {
      capturedFileViewPanelProps?.onRevealInFileTree?.("src/features/Main.tsx");
    });
    surfaces.rerender(
      <>
        {rendered.result.current.gitDiffPanelNode}
        {rendered.result.current.fileViewPanelNode}
      </>,
    );

    expect(onFilePanelModeChange).toHaveBeenCalledWith("files");
    expect(capturedFileTreePanelProps?.revealRequest).toEqual({
      workspaceId: "workspace-1",
      path: "src/features/Main.tsx",
      requestId: 1,
    });

    act(() => {
      capturedFileViewPanelProps?.onRevealInFileTree?.("src/features/Main.tsx");
    });
    surfaces.rerender(
      <>
        {rendered.result.current.gitDiffPanelNode}
        {rendered.result.current.fileViewPanelNode}
      </>,
    );
    expect(capturedFileTreePanelProps?.revealRequest?.requestId).toBe(2);
  });
});
