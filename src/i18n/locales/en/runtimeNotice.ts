// runtimeNotice — English UI strings
const runtimeNotice = {
  runtimeNotice: {
    title: "Runtime Notice",
    open: "Open runtime notices",
    minimize: "Minimize",
    clear: "Clear",
    emptyTitle: "No runtime notices yet",
    emptyDescription:
      "Initialization progress and key errors will appear here.",
    statusIdle: "Idle",
    statusError: "Error",
    severityInfo: "Info",
    severityWarning: "Warning",
    severityError: "Error",
    bootstrap: {
      start: "Initializing local state...",
      storageMigrationCheck: "Checking local state migration...",
      inputHistoryRestore: "Restoring input history...",
      interfaceResources: "Loading interface resources...",
      mountShell: "Mounting the client shell...",
      localStorageMigrationFailed:
        "Local state migration failed. Startup continues in degraded mode.",
      ready: "Client initialization completed.",
      failed: "Client initialization failed. Reload and try again.",
    },
    startupGate: {
      title: "Starting",
      message:
        "Finishing startup. Please wait — clicking the UI now may freeze the app.",
      forceDismiss: "Enter now",
    },
    startupTimeline: {
      title: "Background work timeline",
      summary: "{{rawCount}} raw records · {{nodeCount}} merged nodes",
      sections: {
        startup: "Startup",
        startupHint: "startup trace order",
        runtime: "Runtime",
        runtimeHint: "runtime notice time",
      },
      empty: "No records yet",
      globalProject: "Global",
      projectSummary: "{{name}} +{{count}}",
      count: "×{{count}}",
      duration: {
        single: "{{duration}}",
        total: "Total {{duration}}",
        unavailable: "Duration —",
      },
      status: {
        queued: "Queued",
        started: "Running",
        completed: "Done",
        failed: "Failed",
        timedOut: "Timed out",
        cancelled: "Cancelled",
        degraded: "Degraded",
        info: "Info",
        warning: "Warning",
      },
      detail: {
        label: "View {{title}} details",
        project: "Project",
        workspacePath: "Full path",
        workspaceId: "Workspace ID",
        workspaceCatalog: "Projects (local cache)",
        technical: "Technical identifiers",
        phase: "Phase",
        sources: "Sources",
        timing: "Timing breakdown",
        first: "First",
        latest: "Latest",
        max: "Slowest",
        total: "Total",
        durationSamples: "{{count}} timed executions",
        noPath: "Full path was not recorded",
      },
      operations: {
        "workspace-catalog": {
          title: "Load workspaces",
          description:
            "Reads workspace names and paths so later background work targets the correct projects; conversation bodies are not loaded.",
        },
        "session-catalog": {
          title: "Refresh session list",
          description:
            "Reads session indexes, titles, and ownership for this project across CLIs to refresh resumable sidebar sessions; full transcripts are not loaded.",
        },
        "workspace-files": {
          title: "Read project files",
          description: "Reads the project file-tree index for file panels and path navigation.",
        },
        skills: {
          title: "Load Skills",
          description: "Reads project and global Skills for the composer and agents.",
        },
        prompts: {
          title: "Load Prompts",
          description: "Reads project prompt templates for quick selection and reuse.",
        },
        commands: {
          title: "Load Commands",
          description: "Reads CLI and project commands to refresh composer command choices.",
        },
        "collaboration-modes": {
          title: "Load collaboration modes",
          description: "Reads collaboration modes supported by the active engine.",
        },
        models: {
          title: "Refresh models",
          description: "Reads available engine models for session creation and model switching.",
        },
        agents: {
          title: "Load Agents",
          description: "Reads available agents for task delegation and composer selection.",
        },
        "git-status": {
          title: "Check Git status",
          description: "Reads the current branch and file status to refresh Git indicators.",
        },
        "git-diff": {
          title: "Read Git diff",
          description: "Reads file-change summaries for diff panels and commit scope decisions.",
        },
        dictation: {
          title: "Check dictation model",
          description: "Checks whether the local dictation model is available for voice input.",
        },
        "input-history": {
          title: "Restore input history",
          description: "Restores local drafts and input history so unfinished text survives restart.",
        },
        "storage-migration": {
          title: "Check local-state migration",
          description: "Checks and migrates older local state so settings and caches remain readable.",
        },
        "storage-preload": {
          title: "Preload local state",
          description: "Reads lightweight startup configuration before the main interface mounts.",
        },
        "app-import": {
          title: "Load client code",
          description: "Loads the main interface module in preparation for mounting the client shell.",
        },
        i18n: {
          title: "Load language resources",
          description: "Loads localized interface copy for startup and subsequent screens.",
        },
        "interface-resources": {
          title: "Mount client interface",
          description: "Prepares interface resources and mounts the client shell.",
        },
        "runtime-connection": {
          title: "Check runtime connection",
          description: "Tracks project CLI runtime connection, recovery, and availability state.",
        },
        "shell-ready": {
          title: "Client shell ready",
          description: "The main interface shell is mounted and project data can continue loading.",
        },
        "input-ready": {
          title: "Input ready",
          description: "The composer has completed the initialization required for interaction.",
        },
        "active-workspace-ready": {
          title: "Active project first screen ready",
          description: "Essential first-screen project data has settled; heavier work may continue.",
        },
        "startup-gate-ready": {
          title: "Startup safety gate ready",
          description: "Required startup work has settled enough to remove the interaction mask.",
        },
      },
      fallback: {
        task: "Runs a startup background task; inspect its technical identifiers for exact scope.",
        command: "Calls an internal command; inspect its technical identifiers for exact scope.",
        milestone: "Records a readiness milestone in the client startup process.",
        notice: "Records startup or runtime state while preserving the original notice key.",
      },
    },
    uiScale: {
      startupGuardReset:
        "The previous launch froze at {{scale}}% interface scale, so scale was temporarily reset to 100% for this session. Your setting was not changed — you can re-apply it in Settings.",
    },
    runtime: {
      startupPending: "{{workspace}}: {{engine}} runtime is connecting...",
      resumePending:
        "{{workspace}}: Runtime health check failed. Trying recovery.",
      ready: "{{workspace}}: {{engine}} runtime is connected",
      suspectStale:
        "{{workspace}}: Runtime health check failed. Trying recovery.",
      cooldown: "{{workspace}}: Runtime recovery failed. Cooldown is active.",
      quarantined:
        "{{workspace}}: Runtime recovery failed and needs attention.",
      codexSessionStartHookSkipped:
        "Codex skipped the project SessionStart hook and created the session. Inspect `.codex/hooks.json`; project context may be incomplete. ({{reason}})",
    },
    startup: {
      taskStarted:
        "Background load started: {{task}} ({{phase}} / {{workspace}})",
      taskCompleted: "Background load completed: {{task}} ({{durationMs}}ms)",
      taskFailed: "Background load failed: {{task}}",
      taskTimedOut:
        "Background load timed out: {{task}}. Degraded path is active.",
      taskDegraded: "Background load degraded: {{task}} ({{reason}})",
      taskCancelled: "Background load cancelled: {{task}} ({{reason}})",
      commandCompleted:
        "Internal command completed: {{command}} ({{workspace}} / {{durationMs}}ms)",
      commandFailed:
        "Internal command failed: {{command}} ({{workspace}} / {{durationMs}}ms)",
      shellReady: "Client shell is ready",
      inputReady: "Input is interactive",
      activeWorkspaceReady: "Active workspace first screen is ready",
    },
    engine: {
      checking: "Checking {{engine}} status...",
      ready: "{{engine}} is ready",
      unavailable: "{{engine}} is not installed. Install it first.",
      requiresLogin: "{{engine}} requires sign-in",
    },
    codex: {
      providerSelected:
        "{{name}} enabled. Click the Codex entry to create a session.",
    },
    claude: {
      providerSelected:
        "{{name}} enabled. Click the Claude entry to create a session.",
      resumeCommandCopied:
        "Claude resume command copied. If the TUI /resume picker does not show this GUI session, run claude --resume {{sessionId}} or /resume {{sessionId}} explicitly.",
    },
    kimi: {
      providerSelected:
        "{{name}} enabled. Click the Kimi entry to create a session.",
    },
    grok: {
      providerSelected:
        "{{name}} enabled. Click the Grok entry to create a session.",
    },
    opencode: {
      providerSelected:
        "{{name}} enabled. Click the OpenCode entry to create a session.",
    },
    vendor: {
      activateProviderFailed: "Failed to enable provider {{name}}: {{detail}}",
    },
    error: {
      createSessionRecoveryRequired:
        "{{workspace}}: Session creation failed while runtime recovery is in progress",
      threadTurnFailed: "{{engine}} session failed: {{message}}",
      codexSessionRecoverableFailure:
        "Codex connection interrupted: the previous session binding or runtime connection is no longer usable. Retry or reconnect.",
    },
  },
};

export default runtimeNotice;
