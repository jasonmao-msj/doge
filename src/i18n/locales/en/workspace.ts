// workspace — English UI strings
const workspace = {
  workspace: {
    connect: "Connect",
    disconnect: "Disconnect",
    openInEditor: "Open in Editor",
    openInTerminal: "Open in Terminal",
    openInFinder: "Open in Finder",
    addWorkspaceOpenModeTitle: "Add Workspace",
    addWorkspaceOpenModePrompt: "Choose how to open this workspace.",
    addWorkspaceOpenCurrent: "Add to Current Window",
    addWorkspaceOpenNewWindow: "Open in New Window",
    addWorkspaceRemotePathPrompt:
      "Enter the absolute project path on the daemon machine.",
    workspacesRecoveredTitle: "Workspaces recovered",
    workspacesRecoveredMessage:
      "The workspaces file was corrupted. The original file was backed up as {{backupFileName}} and an empty workspace list has been restored.",
    workspacesRecoveredNoBackupMessage:
      "The workspaces file was corrupted and could not be backed up. An empty workspace list has been restored.",
    loadingProgressRunInBackground: "Run in background",
    loadingProgressCreateSessionTitle: "Creating session...",
    loadingProgressCreateSessionMessage:
      "Preparing a {{engine}} session for {{workspace}}.",
    sharedSessionLocalModelUnavailable:
      "{{engine}} has no local model available for Shared Session. Refresh the CLI status and try again.",
    loadingProgressAddProjectTitle: "Adding project...",
    loadingProgressAddProjectMessage:
      "Adding {{project}} to the current window.",
    loadingProgressOpenProjectTitle: "Opening project...",
    loadingProgressOpenProjectMessage: "Opening {{project}} in a new window.",
    delete: "Delete Workspace",
    deleteWorktree: "Delete Worktree",
    confirmDelete: "Are you sure you want to delete this workspace?",
    confirmDeleteWorktree: "Are you sure you want to delete this worktree?",
    codexPath: "Codex Path",
    codexHome: "Codex Home",
    codexArgs: "Codex Arguments",
    collapseThreads: "Collapse",
    expandThreads: "Expand",
    loadOlderThreads: "Load older threads",
    recentRuns: "Recent runs",
    recentThreads: "Recent threads",
    projectInfo: "Project Info",
    startRunToSee: "Start a run to see its instances tracked here.",
    threadsFromSidebarAppear: "Threads from the sidebar will appear here.",
    local: "Local",
    worktree: "Worktree",
    agentMdPlaceholder: "Add workspace instructions for the agent…",
    agentMdNotFound: "Not found",
    agentMdTruncated: "Truncated",
    agentMdTruncatedWarning: "Showing the first part of a large file.",
    claudeMdPlaceholder: "Add workspace instructions for Claude Code…",
    claudeMdNotFound: "Not found",
    claudeMdTruncated: "Truncated",
    claudeMdTruncatedWarning: "Showing the first part of a large file.",
    branch: "Branch",
    workspaceType: "Workspace type",
    workspaceTypeMain: "Main workspace",
    workspaceTypeWorktree: "Worktree",
    unknownBranch: "unknown",
    homeHeroTitle: "Build anything",
    homeBranchLabelMain: "Primary branch",
    homeBranchLabelWorktree: "Worktree",
    copyPath: "Copy path",
    pathCopied: "Path copied",
    openProjectFolder: "Open project folder",
    conversationType: "Conversation type",
    engineClaudeCode: "Claude Code",
    engineCodex: "Codex",
    engineGemini: "Gemini",
    engineKimi: "Kimi CLI",
    engineGrok: "Grok CLI",
    engineOpenCode: "OpenCode",
    engineStatusLoading: "Checking...",
    engineStatusRequiresLogin: "Sign in required",
    engineComingSoon: "Coming soon",
    startConversation: "Start conversation",
    startSharedConversation: "Claude Code + Codex",
    startingConversation: "Starting...",
    continueLatestConversation: "Continue latest conversation",
    guidedStart: "Spec and execution guides",
    guidedStartHint:
      "Choose OpenSpec or Spec-kit first, then run the general guides.",
    guideProjectSpecTitle: "OpenSpec module",
    guideProjectSpecDescription:
      "For OpenSpec projects: inspect changes, specs, tasks, and verification status.",
    specProviderOpenSpecAction: "Open OpenSpec view",
    specProviderSpecKitTitle: "Spec-kit compatibility view",
    specProviderSpecKitDescription:
      "For Spec-kit projects: reuse the Spec Hub structure to track the minimal compatibility workflow.",
    specProviderSpecKitAction: "Open Spec-kit view",
    generalGuidesTitle: "General guided actions",
    generalGuidesHint: "Requirements first, then execution.",
    guideProjectSpecPrompt:
      "Please read and summarize this project's key specs and constraints first (prioritize AGENTS.md, CLAUDE.md, README, and docs). Extract must-follow rules, boundaries, and common pitfalls.",
    guideCodebaseScanTitle: "Scan codebase quickly",
    guideCodebaseScanDescription:
      "Map module boundaries, entry points, data flow, and dependencies.",
    guideCodebaseScanPrompt:
      "Please perform a fast codebase scan and give me a structured project map: stack, core modules, main entry points, key dependencies, risks, and recommended low-risk change entry points.",
    guideImplementationPlanTitle: "Create implementation plan",
    guideImplementationPlanDescription:
      "Break work into actionable steps with validation and rollback.",
    guideImplementationPlanPrompt:
      "Based on the current project context, create an executable implementation plan: objective, scope, step-by-step tasks, validation strategy, risks, and rollback plan. Prefer minimum viable changes.",
    guideRequirementsTitle: "Break down requirements",
    guideRequirementsDescription:
      "Clarify goals, scope, and acceptance criteria before coding.",
    guideRequirementsPrompt:
      "Help me break down this task. First summarize goals and constraints, then propose a concise implementation plan with risks and validation steps.",
    guideReviewTitle: "Run a code review",
    guideReviewDescription:
      "Focus on correctness, regression risks, and missing tests.",
    guideReviewPrompt:
      "I want a focused code review. Prioritize bugs, behavior regressions, and missing tests. List findings by severity with clear file references.",
    guideDebugTitle: "Investigate a bug",
    guideDebugDescription:
      "Trace symptoms, isolate root cause, and propose a fix path.",
    guideDebugPrompt:
      "Help me debug an issue. Ask for symptoms, likely scope, and reproduction steps, then propose a step-by-step root-cause investigation plan.",
    recentConversations: "Recent conversations",
    recentConversationsHint: "Jump back to a thread and continue.",
    noRecentConversations: "No recent conversations yet.",
    manageRecentConversations: "Manage conversations",
    selectedConversations: "{{count}} selected",
    selectAllConversations: "Select all",
    clearConversationSelection: "Clear selection",
    deleteSelectedConversations: "Delete selected",
    confirmDeleteSelectedConversations: "Confirm delete {{count}}",
    cancelDeleteSelectedConversations: "Cancel delete",
    deletingConversations: "Deleting...",
    deleteConversationFailed: "Failed to delete conversation.",
    archiveConversationFailed: "Failed to archive conversation.",
    deleteConversationsPartial:
      "Deleted {{succeeded}} conversation(s), {{failed}} failed.",
    deleteErrorCode: {
      WORKSPACE_NOT_CONNECTED: "Workspace not connected",
      SESSION_NOT_FOUND: "Session not found",
      PERMISSION_DENIED: "Permission denied",
      IO_ERROR: "IO error",
      ENGINE_UNSUPPORTED: "Engine unsupported",
      UNKNOWN: "Unknown error",
    },
    cancelConversationManagement: "Cancel",
    threadProcessing: "Processing",
    threadReviewing: "Reviewing",
    threadIdle: "Idle",
    instance: "{{count}} instance",
    instance_other: "{{count}} instances",
    failed: "Failed",
    partial: "Partial",
    models: "{{count}} models",
    runs: "{{count}} runs",
    newSharedSession: "Claude Code + Codex",
    newCloneAgent: "New clone agent",
    createWorkingCopyOf: 'Create a new working copy of "{{name}}".',
    copyName: "Copy name",
    copiesFolder: "Copies folder",
    suggested: "Suggested",
    useSuggested: "Use suggested",
    newWorktreeAgent: "New worktree agent",
    createWorktreeUnder: 'Create a worktree under "{{name}}".',
    noviceGuideTitle: "Beginner quick guide (with examples)",
    noviceGuideSubtitle:
      "No need to memorize commands. Follow the examples on the left.",
    noviceGuideBranch:
      "Branch name: use intent-based naming. Example: feat/login-page (feature) or fix/token-timeout (bug fix).",
    noviceGuideBaseBranch:
      "Base branch: where the new branch starts. Dropdown only. Start with upstream/main for most cases; use origin/main if you only track your fork.",
    noviceGuideBasePreview:
      "Base preview: this is your final start point. Example: source upstream + branch upstream/main + commit 0c098bb3.",
    noviceGuidePublish:
      "Publish switch: when enabled, it runs git push -u origin <branch> automatically. Example: git push -u origin feat/login-page.",
    noviceGuideSetupScript:
      "Worktree setup script: runs once after create. Common examples: pnpm install, or pnpm install && pnpm dev.",
    noviceGuideCancel: "Cancel: closes this dialog and creates nothing.",
    noviceGuideCreate:
      "Create: creates the worktree using your selected base branch.",
    branchName: "Branch name",
    branchNameHint:
      "Recommended: feat/login-page (feature) or fix/token-refresh-timeout (bug fix). Avoid vague names like test123.",
    baseBranch: "Base branch",
    baseBranchHint:
      "Pick from dropdown only. Beginners can start with upstream/main; choose origin/main if you only sync with your fork.",
    baseBranchPlaceholder: "Please select",
    baseBranchPlaceholderError:
      "Please choose a base branch from the dropdown first.",
    baseBranchLoading: "Loading base branches...",
    baseBranchNoOptions: "No base branches available",
    baseBranchRootGroup: "Root group",
    baseBranchInvalid: "Base branch is invalid or unavailable.",
    basePreview: "Base preview",
    basePreviewUnavailable: "No base branch selected",
    basePreviewHint:
      "Layered view: source group + branch + commit. Create will use exactly this start point.",
    basePreviewSourceUnknown: "source pending",
    basePreviewCommitUnavailable: "commit unknown",
    nonGitRepositoryError:
      "This project is not a Git repository yet. Initialize Git first (`git init`) before creating a worktree.",
    nonGitRepositoryGuideTitle: "Initialize Git First",
    nonGitRepositoryGuideDescription:
      "Run the 3 commands below in your project root, then return to this dialog to continue.",
    nonGitRepositoryAlertTitle:
      "Cannot create worktree: current folder is not a Git repository",
    nonGitRepositoryAlertDescription:
      "Detected that `{{path}}` does not have Git metadata (.git). Please initialize Git and create at least one initial commit.",
    nonGitRepositoryAlertHint:
      'Suggested flow: `git init` -> `git add . && git commit -m "chore: init repository"` -> return and create worktree.',
    nonGitRepositoryTechnicalDetail: "Technical detail (for troubleshooting)",
    baseBranchGroup: {
      local: "local",
      origin: "origin",
      upstream: "upstream",
      remote: "remote",
    },
    publishToOrigin: "Push to origin and set tracking after create",
    publishToOriginHint:
      "When enabled, example command: `git push -u origin feat/login-page` right after creation.",
    worktreeCreateResultTitle: "Worktree Creation Result",
    worktreeResultSuccessSubtitle:
      "Local and remote status are summarized for quick confirmation.",
    worktreeResultWarningSubtitle:
      "Local creation succeeded, but remote publish needs manual follow-up.",
    worktreeResultErrorTitle: "Critical Warning",
    worktreeCreateSuccess: "Worktree created locally: {{branch}}",
    worktreePublishStatusCreatedTracking:
      "Remote publish succeeded. Tracking set to {{tracking}}.",
    worktreePublishStatusCreatedNoTracking:
      "Remote publish succeeded, but no tracking branch was returned.",
    worktreePublishStatusSkipped:
      "Remote publish was skipped by your current setting.",
    worktreePublishStatusSkippedTracking:
      "Remote publish skipped. Existing tracking branch: {{tracking}}.",
    worktreePublishFailedRecoverable:
      "Local worktree was created, but remote publish failed: {{reason}}. You can retry with the command below.",
    worktreePublishFailedReasonUnknown: "Unknown reason",
    worktreePublishRetryCommandLabel: "Retry command",
    worktreeCreateErrorBaseRef:
      "Cannot create worktree: base branch is unavailable or no longer resolvable. Please re-select a valid base branch.",
    worktreeCreateErrorPathConflict:
      "Cannot create worktree: target path conflict detected ({{path}}). Change branch name or target folder, then retry.",
    worktreeCreateErrorBranchInvalid:
      "Cannot create worktree: branch name is invalid by Git rules ({{branch}}). Please rename and retry.",
    worktreeCreateErrorBranchRequired:
      "Cannot create worktree: branch name is required.",
    worktreeSetupScript: "Worktree setup script",
    worktreeSetupScriptHint:
      "Runs once in a dedicated terminal after each new worktree is created. Example: `pnpm install` or `pnpm install && pnpm dev`.",
    actionsHint:
      "Final check before create: branch name + base preview + publish switch. Cancel never writes any changes.",
    noWorkspaceSelected: "No workspace selected",
    chooseProjectToChat: "Choose a project to start chatting.",
    selectProjectToInspect: "Select a project to inspect diffs.",
    selectProjectToReadSpecs: "Select a project to read specs.",
    goToProjects: "Go to Projects",
    back: "Back",
    diff: "Diff",
    worktreeInfo: "Worktree info",
    name: "Name",
    confirmRename: "Confirm rename",
    updateUpstreamBranchTo:
      "Do you want to update the upstream branch to {{branch}}?",
    updateUpstreamPrompt: "Do you want to update the upstream branch to",
    updateUpstream: "Update upstream",
    terminal: "Terminal",
    repoRoot: "repo root",
    terminalRepoRoot: "Terminal (repo root)",
    copyCommand: "Copy command",
    openWorktreeInTerminal: "Open this worktree in your terminal.",
    reveal: "Reveal",
    revealInFinder: "Reveal in Finder",
    switchProject: "Switch project",
    searchProjects: "Search projects...",
    noProjectsFound: "No projects found",
    noBranchesFound: "No branches found",
    searchOrCreateBranch: "Search or create branch",
    searchBranches: "Search branches",
    createBranch: 'Create branch "{{name}}"',
    createBranchNamed: 'Create branch "{{name}}"',
    branchCannotBeDot: "Branch name cannot be '.' or '..'.",
    branchCannotContainSpaces: "Branch name cannot contain spaces.",
    branchCannotStartEndSlash: "Branch name cannot start or end with '/'.",
    branchCannotEndLock: "Branch name cannot end with '.lock'.",
    branchCannotContainDotDot: "Branch name cannot contain '..'.",
    branchCannotContainAtBrace: "Branch name cannot contain '@{'.",
    branchContainsInvalidChars: "Branch name contains invalid characters.",
    branchCannotEndDot: "Branch name cannot end with '.'.",
    branchNameCannotBeDotOrDotDot: "Branch name cannot be '.' or '..'.",
    branchNameCannotContainSpaces: "Branch name cannot contain spaces.",
    branchNameCannotStartOrEndWithSlash:
      "Branch name cannot start or end with '/'.",
    branchNameCannotEndWithDotLock: "Branch name cannot end with '.lock'.",
    branchNameCannotContainDotDot: "Branch name cannot contain '..'.",
    branchNameCannotContainAtBrace: "Branch name cannot contain '@{'.",
    branchNameContainsInvalidChars: "Branch name contains invalid characters.",
    branchNameCannotEndWithDot: "Branch name cannot end with '.'.",
    deleting: "Deleting",
    agentsActivity: "Agents activity",
    threads: "threads",
    deleteWorkspaceTitle: "Remove Workspace",
    deleteWorkspaceConfirm: 'Are you sure you want to remove "{{name}}"?',
    deleteWorkspaceMessage: "This will remove the workspace from doge.",
    deleteWorkspaceWorktreeWarning:
      "This will also delete {{count}} worktree on disk.",
    deleteWorkspaceWorktreeWarning_other:
      "This will also delete {{count}} worktrees on disk.",
    deleteWorkspaceBeforeYouConfirm: "Before you continue:",
    deleteWorkspaceWillHappenTitle: "What will happen:",
    deleteWorkspaceWillNotHappenTitle: "What will not happen:",
    deleteWorkspaceEffectListOnly:
      "The workspace will be removed from the doge list only.",
    deleteWorkspaceEffectSessions:
      "Active sessions under this workspace (and linked worktrees) will be closed.",
    deleteWorkspaceEffectDeleteWorktrees:
      "{{count}} linked worktree folder on disk will be deleted.",
    deleteWorkspaceEffectDeleteWorktrees_other:
      "{{count}} linked worktree folders on disk will be deleted.",
    deleteWorkspaceEffectKeepFiles:
      "Code files in the main workspace folder will stay untouched.",
    deleteWorkspaceEffectNoGitWrite:
      "No merge/rebase/push or other Git write operation will be executed.",
    deleteWorkspaceEffectReAdd:
      "You can add this workspace back later at any time and continue working.",
    reloadWorkspaceThreadsTitle: "Reload Threads",
    reloadWorkspaceThreadsConfirm: 'Reload the thread list for "{{name}}"?',
    reloadWorkspaceThreadsBeforeYouConfirm: "This action will:",
    reloadWorkspaceThreadsEffectRefresh:
      "Rescan this workspace's sessions and refresh the sidebar list.",
    reloadWorkspaceThreadsEffectDisplayOnly:
      "Only refresh displayed results; ordering may change by latest activity.",
    reloadWorkspaceThreadsEffectNoDelete:
      "Not delete any sessions, code files, branches, or workspace entries.",
    reloadWorkspaceThreadsEffectNoGitWrite:
      "Not run checkout/merge/rebase or any other Git write operation.",
    deleteWorktreeTitle: "Delete Worktree",
    deleteWorktreeConfirm: 'Are you sure you want to delete "{{name}}"?',
    deleteWorktreeMessage:
      "This will close the agent, remove its worktree, and delete it from doge.",
    deleteWorktreeFailed: "Delete worktree failed",
  },
};

export default workspace;
