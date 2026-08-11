import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

const rendererDiagnosticsMocks = vi.hoisted(() => ({
  appendRendererDiagnostic: vi.fn(),
}));

vi.mock("./rendererDiagnostics", () => rendererDiagnosticsMocks);

import {
  addWorkspace,
  forkClaudeSession,
  forkClaudeSessionFromMessage,
  forkThread,
  rewindCodexThread,
  generateThreadTitle,
  getGitHubIssues,
  getGitLog,
  getGitCommitHistory,
  getGitPushPreview,
  getGitStatus,
  getGitDiffs,
  getGitFileBlame,
  getOpenAppIcon,
  getModelList,
  discoverCodexModels,
  getPromptsList,
  getWorkspaceFiles,
  listThreadTitles,
  listThreads,
  listMcpServerStatus,
  listGlobalMcpServers,
  setGlobalMcpServerEnabled,
  readGlobalAgentsMd,
  readGlobalCodexAuthJson,
  readGlobalCodexConfigToml,
  pushGit,
  pullGit,
  updateGitBranch,
  listGitBranches,
  listGitRepositorySummaries,
  checkoutGitBranch,
  createGitBranch,
  createGitPrWorkflow,
  runWorkspaceCommand,
  runSpecCommand,
  resetGitCommit,
  listWorkspaces,
  reloadCodexRuntimeConfig,
  openWorkspaceIn,
  openNewWindow,
  prewarmCodexDiskRuntime,
  readAgentMd,
  readClaudeMd,
  setCodexUnifiedExecOfficialOverride,
  renameThreadTitleKey,
  setThreadTitle,
  stageGitAll,
  unstageGitAll,
  unstageGitPaths,
  revertGitPaths,
  respondToServerRequest,
  respondToUserInputRequest,
  sendUserMessage,
  startThread,
  startReview,
  writeGlobalAgentsMd,
  writeGlobalCodexAuthJson,
  writeGlobalCodexConfigToml,
  writeAgentMd,
  writeClaudeMd,
  connectOpenCodeProvider,
  getOpenCodeProviderHealth,
  getCodeIntelDefinition,
  getCodeIntelImplementations,
  getCodeIntelReferences,
  prepareCodeIntel,
  getOpenCodeLspDefinition,
  getOpenCodeLspReferences,
  getOpenCodeStatusSnapshot,
  detectEngines,
  getActiveEngine,
  getEngineModels,
  getEngineActiveProcessDiagnostics,
  getEngineStatus,
  engineSendMessage,
  engineInterrupt,
  exportRewindFiles,
  getComputerUseBridgeStatus,
  getSkillsList,
  runComputerUseActivationProbe,
  runComputerUseCodexBroker,
  runComputerUseHostContractDiagnostics,
  getWorkspaceSessionProjectionSummary,
  listGlobalCodexSessions,
  listProjectRelatedCodexSessions,
  listProjectRelatedSessions,
  listExternalSpecTree,
  listWorkspaceSessions,
  listWorkspaceSessionArchiveEvidence,
  listWorkspaceSessionFolders,
  createWorkspaceSessionFolder,
  renameWorkspaceSessionFolder,
  moveWorkspaceSessionFolder,
  deleteWorkspaceSessionFolder,
  assignWorkspaceSessionFolder,
  assignWorkspaceSessionFolders,
  recordAutoSessionMetadata,
  archiveWorkspaceSessions,
  unarchiveWorkspaceSessions,
  deleteWorkspaceSessions,
  previewCodexLaunchProfile,
  runCodexDoctor,
  runClaudeDoctor,
  getCliInstallPlan,
  getCliVersionStatus,
  runCliInstaller,
  setOpenCodeMcpToggle,
  switchEngine,
  readExternalSpecFile,
  readExternalAbsoluteFile,
  readEngineTaskOutputArtifact,
  resolveFilePreviewHandle,
  writeExternalSpecFile,
  writeExternalAbsoluteFile,
  engineSendMessageSync,
  deleteClaudeSession,
  deleteGeminiSession,
  deleteGrokSession,
  deleteKimiSession,
  sendConversationCompletionEmail,
  appendClientErrorLog,
  exportDiagnosticsBundle,
  hydrateClaudeDeferredImage,
  setMainWindowOpacity,
  fetchClaudeProviderModels,
  readClaudeSettingsJson,
  reorderClaudeProviders,
  saveClaudeSettingsJson,
  getWebAssetsStatus,
  installWebAssets,
  installWebAssetsFromFile,
  generateCommitMessage,
} from "./tauri";
import { resetRuntimeModeStateForTests } from "./tauri/runtimeMode";
import {
  getStartupTraceSnapshot,
  resetStartupTraceForTests,
} from "../features/startup-orchestration/utils/startupTrace";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

function authorizationContinuity() {
  return {
    kind: "matching_host",
    diagnosticMessage:
      "current host matches the last successful authorization host",
    currentHost: {
      displayName: "doge.app",
      executablePath: "/Applications/doge.app/Contents/MacOS/cc-gui",
      identifier: "com.codex.ccgui",
      teamIdentifier: "TEAM123",
      backendMode: "local",
      hostRole: "foreground_app",
      launchMode: "packaged_app",
      signingSummary: "Authority=Developer ID Application: Demo",
    },
    lastSuccessfulHost: {
      displayName: "doge.app",
      executablePath: "/Applications/doge.app/Contents/MacOS/cc-gui",
      identifier: "com.codex.ccgui",
      teamIdentifier: "TEAM123",
      backendMode: "local",
      hostRole: "foreground_app",
      launchMode: "packaged_app",
      signingSummary: "Authority=Developer ID Application: Demo",
    },
    driftFields: [],
  };
}

function setWebRuntimeFlag(value: boolean) {
  const globalRef = globalThis as any;
  if (!globalRef.window) {
    globalRef.window = {};
  }
  globalRef.window.__MOSSX_WEB_SERVICE__ = value;
}

function clearWebRuntimeFlag() {
  const globalRef = globalThis as any;
  if (!globalRef.window) {
    return;
  }
  delete globalRef.window.__MOSSX_WEB_SERVICE__;
}

describe("tauri invoke wrappers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearWebRuntimeFlag();
    resetRuntimeModeStateForTests();
    resetStartupTraceForTests();
  });

  it("maps repository-scoped commit message generation without changing legacy payloads", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValue("fix: generated");

    await generateCommitMessage("ws-1", "zh", ["legacy.ts"]);
    expect(invokeMock).toHaveBeenLastCalledWith("generate_commit_message", {
      workspaceId: "ws-1",
      language: "zh",
      selectedPaths: ["legacy.ts"],
    });

    const repositorySelections = [
      { repositoryRoot: "services/api", selectedPaths: ["pom.xml"] },
      { repositoryRoot: "services/web", selectedPaths: ["package.json"] },
    ];
    await generateCommitMessage("ws-1", "en", undefined, repositorySelections);
    expect(invokeMock).toHaveBeenLastCalledWith("generate_commit_message", {
      workspaceId: "ws-1",
      language: "en",
      selectedPaths: undefined,
      repositorySelections,
    });

    await generateCommitMessage("ws-1", "zh", undefined, []);
    expect(invokeMock).toHaveBeenLastCalledWith("generate_commit_message", {
      workspaceId: "ws-1",
      language: "zh",
      selectedPaths: undefined,
      repositorySelections: [],
    });
  });

  it("forwards explicit large-range confirmation only on the confirmed retry", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValue({
      ok: true,
      status: "success",
      message: "created",
      stages: [],
    });
    const options = {
      upstreamRepo: "example/mossx",
      baseBranch: "main",
      headOwner: "developer",
      headBranch: "feature/large-pr",
      title: "feat(git): large pull request",
    };

    await createGitPrWorkflow("ws-1", options);
    expect(invokeMock).toHaveBeenLastCalledWith("create_git_pr_workflow", {
      workspaceId: "ws-1",
      upstreamRepo: "example/mossx",
      baseBranch: "main",
      headOwner: "developer",
      headBranch: "feature/large-pr",
      title: "feat(git): large pull request",
      body: null,
      commentAfterCreate: null,
      commentBody: null,
      allowLargeRange: null,
      confirmedRangeFingerprint: null,
    });

    await createGitPrWorkflow("ws-1", {
      ...options,
      allowLargeRange: true,
      confirmedRangeFingerprint: "base-revision...head-revision",
    });
    expect(invokeMock).toHaveBeenLastCalledWith(
      "create_git_pr_workflow",
      expect.objectContaining({
        allowLargeRange: true,
        confirmedRangeFingerprint: "base-revision...head-revision",
      }),
    );
  });

  it("maps Web assets status and install commands without payload drift", async () => {
    const invokeMock = vi.mocked(invoke);
    const readyStatus = {
      state: "ready" as const,
      installedVersion: "0.7.2",
      requiredVersion: "0.7.2",
      lastError: null,
      installationRequired: true,
    };
    invokeMock
      .mockResolvedValueOnce(readyStatus)
      .mockResolvedValueOnce(readyStatus)
      .mockResolvedValueOnce(readyStatus);

    await expect(getWebAssetsStatus()).resolves.toEqual(readyStatus);
    await expect(installWebAssets()).resolves.toEqual(readyStatus);
    await expect(
      installWebAssetsFromFile("/tmp/ccgui-web-assets_0.7.2.zip"),
    ).resolves.toEqual(readyStatus);
    expect(invokeMock).toHaveBeenNthCalledWith(1, "get_web_assets_status");
    expect(invokeMock).toHaveBeenNthCalledWith(2, "install_web_assets");
    expect(invokeMock).toHaveBeenNthCalledWith(
      3,
      "install_web_assets_from_file",
      { archivePath: "/tmp/ccgui-web-assets_0.7.2.zip" },
    );
  });

  it("uses codex_bin for addWorkspace", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({ id: "ws-1" });

    await addWorkspace("/tmp/project", null);

    expect(invokeMock).toHaveBeenCalledWith("add_workspace", {
      path: "/tmp/project",
      codex_bin: null,
    });
  });

  it("maps Claude provider model fetch requests", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      models: ["claude-sonnet"],
      endpoint: "https://proxy.example.com/v1/models",
    });

    await fetchClaudeProviderModels("https://proxy.example.com/anthropic", "sk-test");

    expect(invokeMock).toHaveBeenCalledWith("vendor_fetch_claude_models", {
      baseUrl: "https://proxy.example.com/anthropic",
      apiKey: "sk-test",
    });
  });

  it("maps Claude provider reorder requests", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce(undefined);

    await reorderClaudeProviders(["provider-b", "provider-a"]);

    expect(invokeMock).toHaveBeenCalledWith("vendor_reorder_claude_providers", {
      orderedIds: ["provider-b", "provider-a"],
    });
  });

  it("maps Claude settings.json read and save requests", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce('{"model":"opus"}').mockResolvedValueOnce(undefined);

    await expect(readClaudeSettingsJson()).resolves.toBe('{"model":"opus"}');
    await saveClaudeSettingsJson('{"model":"sonnet"}');

    expect(invokeMock).toHaveBeenNthCalledWith(
      1,
      "vendor_read_claude_settings_json",
    );
    expect(invokeMock).toHaveBeenNthCalledWith(
      2,
      "vendor_save_claude_settings_json",
      { content: '{"model":"sonnet"}' },
    );
  });

  it("maps native window opacity requests to the Tauri command", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      requestedOpacity: 0.72,
      appliedOpacity: 0.72,
      applied: true,
      platform: "macos",
      reason: null,
    });

    await setMainWindowOpacity(0.72);

    expect(invokeMock).toHaveBeenCalledWith("set_main_window_opacity", {
      opacity: 0.72,
    });
  });

  it("maps workspace_id to workspaceId for git status", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      branchName: "main",
      files: [],
      stagedFiles: [],
      unstagedFiles: [],
      totalAdditions: 0,
      totalDeletions: 0,
    });

    await getGitStatus("ws-1");

    expect(invokeMock).toHaveBeenCalledWith("get_git_status", {
      workspaceId: "ws-1",
      repositoryRoot: null,
    });
    expect(
      getStartupTraceSnapshot().events.some(
        (event) =>
          event.type === "command" &&
          event.commandLabel === "get_git_status" &&
          event.status === "completed",
      ),
    ).toBe(true);
  });

  it("maps provider-scoped Codex CLI model discovery", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({ data: [] });

    await discoverCodexModels("ws-1", "  provider-b  ");

    expect(invokeMock).toHaveBeenCalledWith("discover_codex_models", {
      workspaceId: "ws-1",
      providerProfileId: "provider-b",
    });

    await discoverCodexModels("ws-1", "   ");
    expect(invokeMock).toHaveBeenLastCalledWith("discover_codex_models", {
      workspaceId: "ws-1",
      providerProfileId: null,
    });
  });

  it("traces startup-heavy wrappers without changing invoke parameters", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValue({});

    await getGitDiffs("ws-1");
    await getModelList("ws-1");
    await getSkillsList("ws-1", ["/opt/skills"]);
    await getPromptsList("ws-1");
    await getWorkspaceFiles("ws-1");
    await listThreads("ws-1", "cursor-1", 20);
    await listThreadTitles("ws-1");

    expect(invokeMock).toHaveBeenCalledWith("get_git_diffs", {
      workspaceId: "ws-1",
    });
    expect(invokeMock).toHaveBeenCalledWith("model_list", {
      workspaceId: "ws-1",
    });
    expect(invokeMock).toHaveBeenCalledWith("skills_list", {
      workspaceId: "ws-1",
      customSkillRoots: ["/opt/skills"],
    });
    expect(invokeMock).toHaveBeenCalledWith("prompts_list", {
      workspaceId: "ws-1",
    });
    expect(invokeMock).toHaveBeenCalledWith("list_workspace_files", {
      workspaceId: "ws-1",
      forceRefresh: false,
    });
    expect(invokeMock).toHaveBeenCalledWith("list_threads", {
      workspaceId: "ws-1",
      cursor: "cursor-1",
      limit: 20,
    });
    expect(invokeMock).toHaveBeenCalledWith("list_thread_titles", {
      workspaceId: "ws-1",
    });
    const labels = getStartupTraceSnapshot()
      .events.filter((event) => event.type === "command")
      .map((event) => event.commandLabel);
    expect(labels).toEqual([
      "get_git_diffs",
      "model_list",
      "skills_list",
      "prompts_list",
      "list_workspace_files",
      "list_threads",
      "list_thread_titles",
    ]);
  });

  it("traces startup-heavy wrapper failures without swallowing errors", async () => {
    const invokeMock = vi.mocked(invoke);
    const error = new Error("git failed");
    invokeMock.mockRejectedValueOnce(error);

    await expect(getGitDiffs("ws-1")).rejects.toBe(error);

    expect(getStartupTraceSnapshot().events).toEqual([
      expect.objectContaining({
        type: "command",
        commandLabel: "get_git_diffs",
        status: "failed",
      }),
    ]);
  });

  it("maps an explicit repository scope for Git History diff loading", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce([]);

    await getGitDiffs("ws-1", "services/api");

    expect(invokeMock).toHaveBeenCalledWith("get_git_diffs", {
      workspaceId: "ws-1",
      repositoryRoot: "services/api",
    });
  });

  it("invokes codex runtime reload command", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      status: "applied",
      stage: "swapped",
      restartedSessions: 2,
      message: null,
    });

    await reloadCodexRuntimeConfig();

    expect(invokeMock).toHaveBeenCalledWith("reload_codex_runtime_config");
  });

  it("invokes diagnostics bundle export command", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      filePath: "/tmp/diagnostics.json",
      generatedAt: "123",
    });

    await expect(exportDiagnosticsBundle()).resolves.toEqual({
      filePath: "/tmp/diagnostics.json",
      generatedAt: "123",
    });

    expect(invokeMock).toHaveBeenCalledWith("export_diagnostics_bundle");
  });

  it("invokes global client error log append command", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      filePath: "/Users/demo/.ccgui/error-log/2026-05-29.jsonl",
    });

    await expect(
      appendClientErrorLog({
        schemaVersion: 1,
        timestamp: "2026-05-29T12:00:00.000Z",
        source: "error",
        label: "terminal write error",
        payload: { workspaceId: "ws-1" },
      }),
    ).resolves.toEqual({
      filePath: "/Users/demo/.ccgui/error-log/2026-05-29.jsonl",
    });

    expect(invokeMock).toHaveBeenCalledWith("append_client_error_log", {
      entry: {
        schemaVersion: 1,
        timestamp: "2026-05-29T12:00:00.000Z",
        source: "error",
        label: "terminal write error",
        payload: { workspaceId: "ws-1" },
      },
    });
  });

  it("passes custom skill roots to the skills_list command", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce([]);

    await getSkillsList("ws-1", ["/opt/skills"]);

    expect(invokeMock).toHaveBeenCalledWith("skills_list", {
      workspaceId: "ws-1",
      customSkillRoots: ["/opt/skills"],
    });
  });

  it("invokes codex_doctor with the provided CLI inputs", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({ ok: true });

    await runCodexDoctor("/bin/codex", "--profile demo");

    expect(invokeMock).toHaveBeenCalledWith("codex_doctor", {
      codexBin: "/bin/codex",
      codexArgs: "--profile demo",
    });
  });

  it("invokes codex launch profile preview with workspace draft inputs", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({ ok: true });

    await previewCodexLaunchProfile({
      codexBin: "/bin/codex",
      codexArgs: "--profile demo",
      workspaceId: "ws-1",
      useWorkspaceDraft: true,
    });

    expect(invokeMock).toHaveBeenCalledWith("codex_preview_launch_profile", {
      codexBin: "/bin/codex",
      codexArgs: "--profile demo",
      workspaceId: "ws-1",
      useWorkspaceDraft: true,
    });
  });

  it("invokes claude_doctor with the provided CLI input", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({ ok: true });

    await runClaudeDoctor("/bin/claude");

    expect(invokeMock).toHaveBeenCalledWith("claude_doctor", {
      claudeBin: "/bin/claude",
    });
  });

  it("invokes CLI installer commands with enum payloads only", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({ canRun: true });
    invokeMock.mockResolvedValueOnce({ ok: true });
    invokeMock.mockResolvedValueOnce({
      engine: "kimi",
      installed: false,
      localVersion: null,
      latestVersion: null,
      updateAvailable: false,
      nodeOk: true,
      details: null,
    });

    await getCliInstallPlan("codex", "installLatest", "npmGlobal");
    await runCliInstaller("claude", "updateLatest", "npmGlobal", "run-1");
    await getCliVersionStatus("kimi");

    expect(invokeMock).toHaveBeenCalledWith("cli_install_plan", {
      engine: "codex",
      action: "installLatest",
      strategy: "npmGlobal",
    });
    expect(invokeMock).toHaveBeenCalledWith("cli_install_run", {
      engine: "claude",
      action: "updateLatest",
      strategy: "npmGlobal",
      runId: "run-1",
    });
    expect(invokeMock).toHaveBeenCalledWith("cli_version_status", {
      engine: "kimi",
    });
    expect(
      invokeMock.mock.calls.flatMap(([, payload]) =>
        Object.keys(payload ?? {}),
      ),
    ).not.toContain("command");
  });

  it("invokes unified_exec official override command", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      configPath: "/tmp/codex/config.toml",
      hasExplicitUnifiedExec: true,
      explicitUnifiedExecValue: true,
      officialDefaultEnabled: true,
    });

    await setCodexUnifiedExecOfficialOverride(true);

    expect(invokeMock).toHaveBeenCalledWith(
      "set_codex_unified_exec_official_override",
      { enabled: true },
    );
  });

  it("invokes conversation completion email command through the typed bridge", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      provider: "custom",
      acceptedRecipients: ["saved-recipient@example.com"],
      durationMs: 12,
    });

    await sendConversationCompletionEmail({
      workspaceId: "ws-1",
      threadId: "thread-1",
      turnId: "turn-1",
      subject: "Moss conversation completed",
      textBody: "User: hi\nAssistant: done",
    });

    expect(invokeMock).toHaveBeenCalledWith(
      "send_conversation_completion_email",
      {
        request: {
          workspaceId: "ws-1",
          threadId: "thread-1",
          turnId: "turn-1",
          subject: "Moss conversation completed",
          textBody: "User: hi\nAssistant: done",
        },
      },
    );
  });

  it("invokes computer use bridge status command", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      featureEnabled: true,
      activationEnabled: true,
      status: "blocked",
      platform: "macos",
      codexAppDetected: true,
      pluginDetected: true,
      pluginEnabled: true,
      blockedReasons: ["helper_bridge_unverified"],
      guidanceCodes: ["verify_helper_bridge"],
      codexConfigPath: "/Users/demo/.codex/config.toml",
      pluginManifestPath:
        "/Users/demo/.codex/plugins/cache/openai-bundled/computer-use/1/.codex-plugin/plugin.json",
      helperPath: null,
      helperDescriptorPath:
        "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use/.mcp.json",
      marketplacePath:
        "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/.agents/plugins/marketplace.json",
      diagnosticMessage: null,
      authorizationContinuity: authorizationContinuity(),
    });

    await getComputerUseBridgeStatus();

    expect(invokeMock).toHaveBeenCalledWith("get_computer_use_bridge_status");
  });

  it("invokes computer use activation probe command", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      outcome: "blocked",
      failureKind: "host_incompatible",
      bridgeStatus: {
        featureEnabled: true,
        activationEnabled: true,
        status: "blocked",
        platform: "macos",
        codexAppDetected: true,
        pluginDetected: true,
        pluginEnabled: true,
        blockedReasons: ["permission_required", "approval_required"],
        guidanceCodes: ["grant_system_permissions", "review_allowed_apps"],
        codexConfigPath: "/Users/demo/.codex/config.toml",
        pluginManifestPath:
          "/Users/demo/.codex/plugins/cache/openai-bundled/computer-use/1/.codex-plugin/plugin.json",
        helperPath:
          "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use/Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient",
        helperDescriptorPath:
          "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use/.mcp.json",
        marketplacePath:
          "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/.agents/plugins/marketplace.json",
        diagnosticMessage: null,
        authorizationContinuity: authorizationContinuity(),
      },
      durationMs: 312,
      diagnosticMessage: "helper bridge verified",
      stderrSnippet: null,
      exitCode: 0,
    });

    await runComputerUseActivationProbe();

    expect(invokeMock).toHaveBeenCalledWith(
      "run_computer_use_activation_probe",
    );
  });

  it("invokes computer use host-contract diagnostics command", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      kind: "requires_official_parent",
      bridgeStatus: {
        featureEnabled: true,
        activationEnabled: true,
        status: "blocked",
        platform: "macos",
        codexAppDetected: true,
        pluginDetected: true,
        pluginEnabled: true,
        blockedReasons: ["helper_bridge_unverified"],
        guidanceCodes: ["verify_helper_bridge"],
        codexConfigPath: "/Users/demo/.codex/config.toml",
        pluginManifestPath:
          "/Users/demo/.codex/plugins/cache/openai-bundled/computer-use/1/.codex-plugin/plugin.json",
        helperPath:
          "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use/Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient",
        helperDescriptorPath:
          "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use/.mcp.json",
        marketplacePath:
          "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/.agents/plugins/marketplace.json",
        diagnosticMessage: null,
        authorizationContinuity: authorizationContinuity(),
      },
      evidence: {
        helperPath:
          "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use/Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient",
        helperDescriptorPath:
          "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use/.mcp.json",
        currentHostPath:
          "/Applications/ThirdPartyHost.app/Contents/MacOS/third-party-host",
        handoffMethod: "direct_exec_skipped_nested_app_bundle",
        codesignSummary: "codesign exited with status 0",
        spctlSummary: "spctl exited with status 0",
        durationMs: 4,
        stdoutSnippet: null,
        stderrSnippet: "Authority=Developer ID Application",
        officialParentHandoff: {
          kind: "requires_official_parent",
          methods: [],
          evidence: {
            codexInfoPlistPath: "/Applications/Codex.app/Contents/Info.plist",
            serviceInfoPlistPath:
              "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use/Codex Computer Use.app/Contents/Info.plist",
            helperInfoPlistPath:
              "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use/Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/Info.plist",
            parentCodeRequirementPath:
              "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use/Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/Resources/SkyComputerUseClient_Parent.coderequirement",
            pluginManifestPath:
              "/Users/demo/.codex/plugins/cache/openai-bundled/computer-use/1/.codex-plugin/plugin.json",
            mcpDescriptorPath:
              "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use/.mcp.json",
            codexUrlSchemes: ["codex"],
            serviceBundleIdentifier: "com.openai.sky.CUAService",
            helperBundleIdentifier: "com.openai.sky.CUAService.cli",
            parentTeamIdentifier: "2DC432GLL2",
            applicationGroups: ["2DC432GLL2.com.openai.sky.CUAService"],
            xpcServiceIdentifiers: [],
            durationMs: 3,
            stdoutSnippet: null,
            stderrSnippet: null,
          },
          durationMs: 3,
          diagnosticMessage:
            "Readable metadata points to an official OpenAI parent/team contract.",
        },
      },
      durationMs: 4,
      diagnosticMessage:
        "Computer Use helper appears to require the official Codex parent contract.",
    });

    await runComputerUseHostContractDiagnostics();

    expect(invokeMock).toHaveBeenCalledWith(
      "run_computer_use_host_contract_diagnostics",
    );
  });

  it("invokes computer use Codex broker command", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      outcome: "completed",
      failureKind: null,
      bridgeStatus: {
        featureEnabled: true,
        activationEnabled: true,
        status: "blocked",
        platform: "macos",
        codexAppDetected: true,
        pluginDetected: true,
        pluginEnabled: true,
        blockedReasons: ["permission_required", "approval_required"],
        guidanceCodes: ["grant_system_permissions", "review_allowed_apps"],
        codexConfigPath: "/Users/demo/.codex/config.toml",
        pluginManifestPath:
          "/Users/demo/.codex/plugins/cache/openai-bundled/computer-use/1/.codex-plugin/plugin.json",
        helperPath:
          "/Users/demo/.codex/plugins/cache/openai-bundled/computer-use/1/Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient",
        helperDescriptorPath:
          "/Users/demo/.codex/plugins/cache/openai-bundled/computer-use/1/.mcp.json",
        marketplacePath:
          "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/.agents/plugins/marketplace.json",
        diagnosticMessage: null,
        authorizationContinuity: authorizationContinuity(),
      },
      text: "done",
      diagnosticMessage:
        "Computer Use task completed through the official Codex runtime.",
      durationMs: 1200,
    });

    await runComputerUseCodexBroker({
      workspaceId: "workspace-1",
      instruction: "inspect Chrome",
    });

    expect(invokeMock).toHaveBeenCalledWith("run_computer_use_codex_broker", {
      request: {
        workspaceId: "workspace-1",
        instruction: "inspect Chrome",
      },
    });
  });

  it("maps rewind export params to export_rewind_files", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      outputPath:
        "/Users/demo/.ccgui/chat-diff/claude/session-1/export-20260413T000000Z-ab12cd34",
      filesPath:
        "/Users/demo/.ccgui/chat-diff/claude/session-1/export-20260413T000000Z-ab12cd34/files",
      manifestPath:
        "/Users/demo/.ccgui/chat-diff/claude/session-1/export-20260413T000000Z-ab12cd34/manifest.json",
      exportId: "export-20260413T000000Z-ab12cd34",
      fileCount: 2,
    });

    await exportRewindFiles({
      workspaceId: "ws-1",
      engine: "claude",
      sessionId: "session-1",
      targetMessageId: "user-1",
      conversationLabel: "test",
      files: [
        { path: "src/App.tsx", status: "M" },
        { path: "/tmp/demo.ts", status: "D" },
      ],
    });

    expect(invokeMock).toHaveBeenCalledWith("export_rewind_files", {
      workspaceId: "ws-1",
      engine: "claude",
      sessionId: "session-1",
      targetMessageId: "user-1",
      conversationLabel: "test",
      files: [
        { path: "src/App.tsx", status: "M" },
        { path: "/tmp/demo.ts", status: "D" },
      ],
    });
  });

  it("maps workspace_id to workspaceId for GitHub issues", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({ total: 0, issues: [] });

    await getGitHubIssues("ws-2");

    expect(invokeMock).toHaveBeenCalledWith("get_github_issues", {
      workspaceId: "ws-2",
    });
  });

  it("maps workspace session list options to list_workspace_sessions", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      data: [],
      nextCursor: "offset:20",
      partialSource: null,
    });

    await listWorkspaceSessions("ws-2", {
      query: { keyword: "bugfix", engine: "codex", status: "archived" },
      cursor: "offset:0",
      limit: 20,
    });

    expect(invokeMock).toHaveBeenCalledWith("list_workspace_sessions", {
      workspaceId: "ws-2",
      query: { keyword: "bugfix", engine: "codex", status: "archived" },
      cursor: "offset:0",
      limit: 20,
    });
  });

  it("preserves workspace session catalog source and ownership fields", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      data: [
        {
          sessionId: "claude:session-1",
          stableSessionKey: "claude:child-ws:session-1",
          canonicalSessionId: "session-1",
          workspaceId: "child-ws",
          engine: "claude",
          title: "Investigate ownership",
          updatedAt: 123,
          threadKind: "native",
          sourceCompleteness: "complete",
          sourceStatusReason: null,
          attributionStatus: "strict-match",
          attributionReason: "cwd-longest",
          attributionConfidence: "high",
          matchedWorkspaceId: "child-ws",
          matchedWorkspaceLabel: "Child",
        },
      ],
      nextCursor: null,
      partialSource: null,
      sourceStatuses: [
        {
          engine: "claude",
          completeness: "complete",
          reason: null,
          scannedCandidates: 1,
          skippedCandidates: 0,
          scanCapReached: false,
          diagnostics: [
            {
              engine: "claude",
              code: "cwd-project-conflict",
              reason: "cwd-project-conflict",
              sessionId: "claude:conflict",
              physicalLocator: "conflict.jsonl:0123456789abcdef",
            },
          ],
          cache: {
            hits: 1,
            misses: 2,
            stale: 0,
            rebuilds: 2,
            failures: 0,
          },
        },
      ],
    });

    const page = await listWorkspaceSessions("parent-ws", {
      query: { status: "active" },
      limit: 50,
    });

    expect(page.data[0]).toMatchObject({
      sessionId: "claude:session-1",
      stableSessionKey: "claude:child-ws:session-1",
      sourceCompleteness: "complete",
      attributionReason: "cwd-longest",
      attributionConfidence: "high",
      matchedWorkspaceId: "child-ws",
    });
    expect(page.sourceStatuses?.[0]).toMatchObject({
      engine: "claude",
      completeness: "complete",
      scannedCandidates: 1,
      scanCapReached: false,
      diagnostics: [
        {
          code: "cwd-project-conflict",
          physicalLocator: "conflict.jsonl:0123456789abcdef",
        },
      ],
      cache: {
        hits: 1,
        rebuilds: 2,
      },
    });
    expect(invokeMock).toHaveBeenCalledWith("list_workspace_sessions", {
      workspaceId: "parent-ws",
      query: { status: "active" },
      cursor: null,
      limit: 50,
    });
  });

  it("maps global codex session list options to list_global_codex_sessions", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      data: [],
      nextCursor: "offset:10",
      partialSource: null,
    });

    await listGlobalCodexSessions({
      query: { keyword: "archive", engine: "codex", status: "all" },
      cursor: "offset:0",
      limit: 10,
    });

    expect(invokeMock).toHaveBeenCalledWith("list_global_codex_sessions", {
      query: { keyword: "archive", engine: "codex", status: "all" },
      cursor: "offset:0",
      limit: 10,
    });
  });

  it("maps related codex session list options to list_project_related_codex_sessions", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      data: [],
      nextCursor: "offset:5",
      partialSource: null,
    });

    await listProjectRelatedCodexSessions("ws-2", {
      query: { keyword: "feature", engine: "codex", status: "active" },
      cursor: "offset:0",
      limit: 5,
    });

    expect(invokeMock).toHaveBeenCalledWith(
      "list_project_related_codex_sessions",
      {
        workspaceId: "ws-2",
        query: { keyword: "feature", engine: "codex", status: "active" },
        cursor: "offset:0",
        limit: 5,
      },
    );
  });

  it("maps engine-neutral related session list options to list_project_related_sessions", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      data: [],
      nextCursor: "offset:5",
      partialSource: null,
    });

    await listProjectRelatedSessions("ws-2", {
      query: { keyword: "feature", engine: "claude", status: "active" },
      cursor: "offset:0",
      limit: 5,
    });

    expect(invokeMock).toHaveBeenCalledWith("list_project_related_sessions", {
      workspaceId: "ws-2",
      query: { keyword: "feature", engine: "claude", status: "active" },
      cursor: "offset:0",
      limit: 5,
    });
  });

  it("maps workspace session archive evidence requests", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      archivedAtBySessionId: {
        "claude:session-1": 123,
      },
      partialSource: null,
      sourceStatuses: [
        {
          engine: "archive-metadata",
          completeness: "complete",
          scannedCandidates: 1,
        },
      ],
    });

    const evidence = await listWorkspaceSessionArchiveEvidence("ws-2");

    expect(evidence.archivedAtBySessionId["claude:session-1"]).toBe(123);
    expect(invokeMock).toHaveBeenCalledWith(
      "list_workspace_session_archive_evidence",
      {
        workspaceId: "ws-2",
      },
    );
  });

  it("maps workspace projection summary requests", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      scopeKind: "project",
      ownerWorkspaceIds: ["ws-2", "ws-3"],
      activeTotal: 8,
      archivedTotal: 2,
      allTotal: 10,
      filteredTotal: 8,
      partialSources: [],
    });

    await getWorkspaceSessionProjectionSummary("ws-2", {
      query: { keyword: "feature", engine: "codex", status: "active" },
    });

    expect(invokeMock).toHaveBeenCalledWith(
      "get_workspace_session_projection_summary",
      {
        workspaceId: "ws-2",
        query: { keyword: "feature", engine: "codex", status: "active" },
      },
    );
  });

  it("maps workspace session batch mutations", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValue({
      results: [
        {
          sessionId: "opencode:1",
          ok: true,
          code: "ALREADY_MISSING_CLEANED",
          deletedFromDisk: false,
          metadataCleaned: true,
        },
      ],
    });

    await archiveWorkspaceSessions("ws-2", ["claude:1", "codex-1"]);
    expect(invokeMock).toHaveBeenNthCalledWith(
      1,
      "archive_workspace_sessions",
      {
        workspaceId: "ws-2",
        sessionIds: ["claude:1", "codex-1"],
      },
    );

    await unarchiveWorkspaceSessions("ws-2", ["claude:1"]);
    expect(invokeMock).toHaveBeenNthCalledWith(
      2,
      "unarchive_workspace_sessions",
      {
        workspaceId: "ws-2",
        sessionIds: ["claude:1"],
      },
    );

    const deleteResult = await deleteWorkspaceSessions("ws-2", ["opencode:1"]);
    expect(invokeMock).toHaveBeenNthCalledWith(3, "delete_workspace_sessions", {
      workspaceId: "ws-2",
      sessionIds: ["opencode:1"],
    });
    expect(deleteResult.results[0]).toMatchObject({
      code: "ALREADY_MISSING_CLEANED",
      deletedFromDisk: false,
      metadataCleaned: true,
    });
  });

  it("maps workspace session folder commands", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValue({});

    await listWorkspaceSessionFolders("ws-2");
    expect(invokeMock).toHaveBeenNthCalledWith(
      1,
      "list_workspace_session_folders",
      {
        workspaceId: "ws-2",
      },
    );

    await createWorkspaceSessionFolder("ws-2", "Bugs", "parent-1");
    expect(invokeMock).toHaveBeenNthCalledWith(
      2,
      "create_workspace_session_folder",
      {
        workspaceId: "ws-2",
        name: "Bugs",
        parentId: "parent-1",
      },
    );

    await renameWorkspaceSessionFolder("ws-2", "folder-1", "Fixes");
    expect(invokeMock).toHaveBeenNthCalledWith(
      3,
      "rename_workspace_session_folder",
      {
        workspaceId: "ws-2",
        folderId: "folder-1",
        name: "Fixes",
      },
    );

    await moveWorkspaceSessionFolder("ws-2", "folder-1", null);
    expect(invokeMock).toHaveBeenNthCalledWith(
      4,
      "move_workspace_session_folder",
      {
        workspaceId: "ws-2",
        folderId: "folder-1",
        parentId: null,
      },
    );

    await deleteWorkspaceSessionFolder("ws-2", "folder-1");
    expect(invokeMock).toHaveBeenNthCalledWith(
      5,
      "delete_workspace_session_folder",
      {
        workspaceId: "ws-2",
        folderId: "folder-1",
      },
    );

    await assignWorkspaceSessionFolder("ws-2", "claude:1", "folder-1");
    expect(invokeMock).toHaveBeenNthCalledWith(
      6,
      "assign_workspace_session_folder",
      {
        workspaceId: "ws-2",
        sessionId: "claude:1",
        folderId: "folder-1",
      },
    );

    await assignWorkspaceSessionFolders("ws-2", ["claude:1", "codex-2"], null);
    expect(invokeMock).toHaveBeenNthCalledWith(
      7,
      "assign_workspace_session_folders",
      {
        workspaceId: "ws-2",
        sessionIds: ["claude:1", "codex-2"],
        folderId: null,
      },
    );

    await recordAutoSessionMetadata("ws-2", "codex:auto-1", {
      sessionPurpose: "prompt-enhancer",
      visibility: "hidden",
      ownerFeature: "composer",
      autoArchive: true,
      createdBy: "system",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(
      8,
      "record_auto_session_metadata",
      {
        workspaceId: "ws-2",
        sessionId: "codex:auto-1",
        metadata: {
          sessionPurpose: "prompt-enhancer",
          visibility: "hidden",
          ownerFeature: "composer",
          autoArchive: true,
          createdBy: "system",
        },
      },
    );
  });

  it("returns an empty list when the Tauri invoke bridge is missing", async () => {
    const invokeMock = vi.mocked(invoke);
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    invokeMock.mockRejectedValueOnce(
      new TypeError("Cannot read properties of undefined (reading 'invoke')"),
    );

    await expect(listWorkspaces()).resolves.toEqual([]);
    expect(invokeMock).toHaveBeenCalledWith("list_workspaces");
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "Tauri invoke bridge unavailable; returning empty workspaces list.",
    );
    consoleWarnSpy.mockRestore();
  });

  it("applies default limit for git log", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      total: 0,
      entries: [],
      ahead: 0,
      behind: 0,
      aheadEntries: [],
      behindEntries: [],
      upstream: null,
    });

    await getGitLog("ws-3");

    expect(invokeMock).toHaveBeenCalledWith("get_git_log", {
      workspaceId: "ws-3",
      limit: 40,
    });
  });

  it("maps optional path and repository scope for git commit history", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      snapshotId: "snapshot-1",
      total: 0,
      offset: 0,
      limit: 100,
      hasMore: false,
      commits: [],
    });

    await getGitCommitHistory("ws-3", {
      path: "src/value.ts",
      repositoryRoot: "packages/app",
    });

    expect(invokeMock).toHaveBeenCalledWith("get_git_commit_history", {
      workspaceId: "ws-3",
      branch: null,
      query: null,
      author: null,
      dateFrom: null,
      dateTo: null,
      snapshotId: null,
      path: "src/value.ts",
      offset: 0,
      limit: 100,
      repositoryRoot: "packages/app",
    });
  });

  it("preserves the repository-wide git commit history payload when path is omitted", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      snapshotId: "snapshot-1",
      total: 0,
      offset: 0,
      limit: 100,
      hasMore: false,
      commits: [],
    });

    await getGitCommitHistory("ws-3");

    expect(invokeMock).toHaveBeenCalledWith("get_git_commit_history", {
      workspaceId: "ws-3",
      branch: null,
      query: null,
      author: null,
      dateFrom: null,
      dateTo: null,
      snapshotId: null,
      path: null,
      offset: 0,
      limit: 100,
    });
  });

  it("maps repository scope for file blame", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      path: "src/value.ts",
      headSha: "abc123",
      lineCount: 1,
      hunks: [],
    });

    await getGitFileBlame("ws-3", "src/value.ts", "packages/app");

    expect(invokeMock).toHaveBeenCalledWith("get_git_file_blame", {
      workspaceId: "ws-3",
      path: "src/value.ts",
      repositoryRoot: "packages/app",
    });
  });

  it("maps workspaceId and threadId for fork_thread", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await forkThread("ws-9", "thread-9");

    expect(invokeMock).toHaveBeenCalledWith("fork_thread", {
      workspaceId: "ws-9",
      threadId: "thread-9",
      messageId: null,
      providerProfileId: null,
      targetUserTurnIndex: null,
      targetUserMessageText: null,
      targetUserMessageOccurrence: null,
      localUserMessageCount: null,
    });
  });

  it("maps providerProfileId for start_thread and fork_thread", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValue({});

    await startThread("ws-9", { providerProfileId: "provider-a" });
    await forkThread("ws-9", "thread-9", null, {
      providerProfileId: "provider-b",
    });

    expect(invokeMock).toHaveBeenNthCalledWith(1, "start_thread", {
      workspaceId: "ws-9",
      autoSession: null,
      providerProfileId: "provider-a",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "fork_thread", {
      workspaceId: "ws-9",
      threadId: "thread-9",
      messageId: null,
      providerProfileId: "provider-b",
      targetUserTurnIndex: null,
      targetUserMessageText: null,
      targetUserMessageOccurrence: null,
      localUserMessageCount: null,
    });
  });

  it("maps disk Codex runtime prewarm command", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await prewarmCodexDiskRuntime("ws-9");

    expect(invokeMock).toHaveBeenCalledWith("prewarm_codex_disk_runtime", {
      workspaceId: "ws-9",
    });
  });

  it("maps codex rewind params to rewind_codex_thread", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await rewindCodexThread("ws-9", "thread-9", 2, "user-2", {
      targetUserMessageText: "1+1",
      targetUserMessageOccurrence: 1,
      localUserMessageCount: 3,
    });

    expect(invokeMock).toHaveBeenCalledWith("rewind_codex_thread", {
      workspaceId: "ws-9",
      threadId: "thread-9",
      messageId: "user-2",
      targetUserTurnIndex: 2,
      targetUserMessageText: "1+1",
      targetUserMessageOccurrence: 1,
      localUserMessageCount: 3,
    });
  });

  it("normalizes codex rewind index/messageId payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await rewindCodexThread("ws-9", "thread-9", 2.8, "  user-2  ", {
      targetUserMessageText: " 1+1 ",
      targetUserMessageOccurrence: Number.POSITIVE_INFINITY,
      localUserMessageCount: Number.POSITIVE_INFINITY,
    });

    expect(invokeMock).toHaveBeenCalledWith("rewind_codex_thread", {
      workspaceId: "ws-9",
      threadId: "thread-9",
      messageId: "user-2",
      targetUserTurnIndex: 2,
      targetUserMessageText: "1+1",
    });
  });

  it("rejects codex rewind when targetUserTurnIndex is invalid", async () => {
    const invokeMock = vi.mocked(invoke);

    await expect(
      rewindCodexThread("ws-9", "thread-9", 0, "user-2"),
    ).rejects.toThrow("targetUserTurnIndex must be >= 1 for codex rewind");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("maps optional messageId for fork_thread", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await forkThread("ws-9", "thread-9", "msg-9");

    expect(invokeMock).toHaveBeenCalledWith("fork_thread", {
      workspaceId: "ws-9",
      threadId: "thread-9",
      messageId: "msg-9",
      providerProfileId: null,
      targetUserTurnIndex: null,
      targetUserMessageText: null,
      targetUserMessageOccurrence: null,
      localUserMessageCount: null,
    });
  });

  it("maps codex provider fork anchor hints for fork_thread", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await forkThread("ws-9", "thread-9", "msg-9", {
      providerProfileId: "provider-b",
      targetUserTurnIndex: 2.8,
      targetUserMessageText: " 继续这里 ",
      targetUserMessageOccurrence: 1,
      localUserMessageCount: 3,
    });

    expect(invokeMock).toHaveBeenCalledWith("fork_thread", {
      workspaceId: "ws-9",
      threadId: "thread-9",
      messageId: "msg-9",
      providerProfileId: "provider-b",
      targetUserTurnIndex: 2,
      targetUserMessageText: "继续这里",
      targetUserMessageOccurrence: 1,
      localUserMessageCount: 3,
    });
  });

  it("maps workspacePath and sessionId for fork_claude_session", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await forkClaudeSession("/tmp/project", "claude-session-1");

    expect(invokeMock).toHaveBeenCalledWith("fork_claude_session", {
      workspacePath: "/tmp/project",
      sessionId: "claude-session-1",
    });
  });

  it("maps workspacePath/sessionId/messageId for fork_claude_session_from_message", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await forkClaudeSessionFromMessage(
      "/tmp/project",
      "claude-session-1",
      "550e8400-e29b-41d4-a716-446655440000",
    );

    expect(invokeMock).toHaveBeenCalledWith(
      "fork_claude_session_from_message",
      {
        workspacePath: "/tmp/project",
        sessionId: "claude-session-1",
        messageId: "550e8400-e29b-41d4-a716-446655440000",
      },
    );
  });

  it("maps workspaceId/cursor/limit for list_mcp_server_status", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await listMcpServerStatus("ws-10", "cursor-1", 25);

    expect(invokeMock).toHaveBeenCalledWith("list_mcp_server_status", {
      workspaceId: "ws-10",
      cursor: "cursor-1",
      limit: 25,
    });
  });

  it("invokes list_global_mcp_servers", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce([]);

    await listGlobalMcpServers();

    expect(invokeMock).toHaveBeenCalledWith("list_global_mcp_servers");
  });

  it("invokes set_global_mcp_server_enabled", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce(undefined);

    await setGlobalMcpServerEnabled("github", "doge_config", false);

    expect(invokeMock).toHaveBeenCalledWith("set_global_mcp_server_enabled", {
      name: "github",
      source: "doge_config",
      enabled: false,
    });
  });

  it("invokes stage_git_all", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await stageGitAll("ws-6");

    expect(invokeMock).toHaveBeenCalledWith("stage_git_all", {
      workspaceId: "ws-6",
      repositoryRoot: null,
    });
  });

  it("invokes unstage_git_all and unstage_git_paths", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({}).mockResolvedValueOnce({});

    await unstageGitAll("ws-6");
    await unstageGitPaths("ws-6", ["a.ts", "b.ts"], "services/api");

    expect(invokeMock).toHaveBeenNthCalledWith(1, "unstage_git_all", {
      workspaceId: "ws-6",
      repositoryRoot: null,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "unstage_git_paths", {
      workspaceId: "ws-6",
      paths: ["a.ts", "b.ts"],
      repositoryRoot: "services/api",
    });
  });

  it("invokes revert_git_paths", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await revertGitPaths("ws-6", ["a.ts", "b.ts"]);

    expect(invokeMock).toHaveBeenCalledWith("revert_git_paths", {
      workspaceId: "ws-6",
      paths: ["a.ts", "b.ts"],
      repositoryRoot: null,
    });
  });

  it("maps reset git commit payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await resetGitCommit("ws-20", "abcdef1234567890", "mixed");

    expect(invokeMock).toHaveBeenCalledWith("reset_git_commit", {
      workspaceId: "ws-20",
      commitHash: "abcdef1234567890",
      mode: "mixed",
    });
  });

  it("maps push git payload with options", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await pushGit("ws-30", {
      remote: "origin",
      branch: "main",
      forceWithLease: true,
      pushTags: true,
      runHooks: false,
      pushToGerrit: true,
      topic: "topic-1",
      reviewers: "alice,bob",
      cc: "carol",
    });

    expect(invokeMock).toHaveBeenCalledWith("push_git", {
      workspaceId: "ws-30",
      remote: "origin",
      branch: "main",
      forceWithLease: true,
      pushTags: true,
      runHooks: false,
      pushToGerrit: true,
      topic: "topic-1",
      reviewers: "alice,bob",
      cc: "carol",
      repositoryRoot: null,
    });
  });

  it("maps pull git payload with options", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await pullGit("ws-32", {
      remote: "origin",
      branch: "main",
      strategy: "--rebase",
      noCommit: false,
      noVerify: true,
    });

    expect(invokeMock).toHaveBeenCalledWith("pull_git", {
      workspaceId: "ws-32",
      remote: "origin",
      branch: "main",
      strategy: "--rebase",
      noCommit: false,
      noVerify: true,
      repositoryRoot: null,
    });
  });

  it("maps explicit repository scope for status and stage", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValue({
      branchName: "main",
      files: [],
      stagedFiles: [],
      unstagedFiles: [],
      totalAdditions: 0,
      totalDeletions: 0,
    });

    await getGitStatus("ws-1", "services/api");
    await stageGitAll("ws-1", "services/api");

    expect(invokeMock).toHaveBeenNthCalledWith(1, "get_git_status", {
      workspaceId: "ws-1",
      repositoryRoot: "services/api",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "stage_git_all", {
      workspaceId: "ws-1",
      repositoryRoot: "services/api",
    });
  });

  it("maps update git branch payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      branch: "feature/demo",
      status: "success",
      reason: null,
      message: "updated",
      worktreePath: null,
    });

    await updateGitBranch("ws-33", "feature/demo", "services/api");

    expect(invokeMock).toHaveBeenCalledWith("update_git_branch", {
      workspaceId: "ws-33",
      branchName: "feature/demo",
      repositoryRoot: "services/api",
    });
  });

  it("maps repository-scoped Git command payloads", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValue([]);

    await listGitRepositorySummaries("ws-scoped", 3);
    await listGitBranches("ws-scoped", "services\\api");
    await checkoutGitBranch("ws-scoped", "main", "services/api");
    await createGitBranch("ws-scoped", "feature/new", "");

    expect(invokeMock).toHaveBeenNthCalledWith(1, "list_git_repository_summaries", {
      workspaceId: "ws-scoped",
      depth: 3,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "list_git_branches", {
      workspaceId: "ws-scoped",
      repositoryRoot: "services\\api",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "checkout_git_branch", {
      workspaceId: "ws-scoped",
      name: "main",
      repositoryRoot: "services/api",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(4, "create_git_branch", {
      workspaceId: "ws-scoped",
      name: "feature/new",
      repositoryRoot: "",
    });
  });

  it("maps get git push preview payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      sourceBranch: "main",
      targetRemote: "origin",
      targetBranch: "main",
      targetRef: "refs/remotes/origin/main",
      targetFound: true,
      hasMore: false,
      commits: [],
    });

    await getGitPushPreview("ws-31", {
      remote: "origin",
      branch: "main",
    });

    expect(invokeMock).toHaveBeenCalledWith("get_git_push_preview", {
      workspaceId: "ws-31",
      remote: "origin",
      branch: "main",
      limit: 120,
    });
  });

  it("maps repository scope for git push preview", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      sourceBranch: "main",
      targetRemote: "origin",
      targetBranch: "main",
      targetRef: "refs/remotes/origin/main",
      targetFound: true,
      hasMore: false,
      commits: [],
    });

    await getGitPushPreview("ws-31", {
      remote: "origin",
      branch: "main",
      repositoryRoot: "services/api",
    });

    expect(invokeMock).toHaveBeenCalledWith("get_git_push_preview", {
      workspaceId: "ws-31",
      remote: "origin",
      branch: "main",
      limit: 120,
      repositoryRoot: "services/api",
    });
  });

  it("maps openWorkspaceIn options", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await openWorkspaceIn("/tmp/project", {
      appName: "Xcode",
      args: ["--reuse-window"],
    });

    expect(invokeMock).toHaveBeenCalledWith("open_workspace_in", {
      path: "/tmp/project",
      app: "Xcode",
      command: null,
      args: ["--reuse-window"],
    });
  });

  it("maps openNewWindow payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await openNewWindow("/tmp/project");

    expect(invokeMock).toHaveBeenCalledWith("open_new_window", {
      path: "/tmp/project",
    });
  });

  it("maps run workspace command payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      command: ["echo", "hello"],
      exitCode: 0,
      success: true,
      stdout: "hello",
      stderr: "",
    });

    await runWorkspaceCommand("ws-40", ["echo", "hello"], 5000);

    expect(invokeMock).toHaveBeenCalledWith("run_workspace_command", {
      workspaceId: "ws-40",
      command: ["echo", "hello"],
      timeoutMs: 5000,
    });
  });

  it("maps run spec command payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      command: ["openspec", "--version"],
      exitCode: 0,
      success: true,
      stdout: "0.6.0",
      stderr: "",
    });

    await runSpecCommand("ws-41", ["openspec", "--version"], {
      customSpecRoot: "/tmp/external-spec-root",
      timeoutMs: 7000,
    });

    expect(invokeMock).toHaveBeenCalledWith("run_spec_command", {
      workspaceId: "ws-41",
      command: ["openspec", "--version"],
      customSpecRoot: "/tmp/external-spec-root",
      timeoutMs: 7000,
    });
  });

  it("maps list external spec tree payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      files: [],
      directories: [],
      gitignored_files: [],
      gitignored_directories: [],
    });

    await listExternalSpecTree("ws-41", "/tmp/external-spec-root");

    expect(invokeMock).toHaveBeenCalledWith("list_external_spec_tree", {
      workspaceId: "ws-41",
      specRoot: "/tmp/external-spec-root",
    });
  });

  it("maps read external spec file payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      exists: true,
      content: "# spec",
      truncated: false,
    });

    await readExternalSpecFile(
      "ws-41",
      "/tmp/external-spec-root",
      "openspec/project.md",
    );

    expect(invokeMock).toHaveBeenCalledWith("read_external_spec_file", {
      workspaceId: "ws-41",
      specRoot: "/tmp/external-spec-root",
      path: "openspec/project.md",
    });
  });

  it("maps read external absolute file payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      content: "# skill",
      truncated: false,
    });

    await readExternalAbsoluteFile(
      "ws-41",
      "/Users/demo/.codex/skills/openspec-apply-change/SKILL.md",
    );

    expect(invokeMock).toHaveBeenCalledWith("read_external_absolute_file", {
      workspaceId: "ws-41",
      path: "/Users/demo/.codex/skills/openspec-apply-change/SKILL.md",
    });
  });

  it("maps task output artifact tail payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      exists: true,
      content: "progress",
      truncated: false,
      byteLength: 8,
    });

    const response = await readEngineTaskOutputArtifact({
      workspaceId: "ws-41",
      path: "/tmp/tasks/task.output",
    });

    expect(invokeMock).toHaveBeenCalledWith("engine_task_output_read_artifact", {
      workspaceId: "ws-41",
      path: "/tmp/tasks/task.output",
    });
    expect(response.content).toBe("progress");
  });

  it("maps file preview handle payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      absolutePath: "/repo/docs/report.pdf",
      byteLength: 2048,
      extension: "pdf",
    });

    await resolveFilePreviewHandle("ws-41", {
      domain: "workspace",
      path: "docs/report.pdf",
    });

    expect(invokeMock).toHaveBeenCalledWith("resolve_file_preview_handle", {
      workspaceId: "ws-41",
      domain: "workspace",
      path: "docs/report.pdf",
      specRoot: null,
    });
  });

  it("maps write external spec file payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await writeExternalSpecFile(
      "ws-41",
      "/tmp/external-spec-root",
      "openspec/project.md",
      "# Project Context",
    );

    expect(invokeMock).toHaveBeenCalledWith("write_external_spec_file", {
      workspaceId: "ws-41",
      specRoot: "/tmp/external-spec-root",
      path: "openspec/project.md",
      content: "# Project Context",
    });
  });

  it("maps write external absolute file payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await writeExternalAbsoluteFile(
      "ws-41",
      "/Users/demo/.codex/skills/openspec-apply-change/SKILL.md",
      "# Updated skill",
    );

    expect(invokeMock).toHaveBeenCalledWith("write_external_absolute_file", {
      workspaceId: "ws-41",
      path: "/Users/demo/.codex/skills/openspec-apply-change/SKILL.md",
      content: "# Updated skill",
    });
  });

  it("invokes get_open_app_icon", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce("data:image/png;base64,abc");

    await getOpenAppIcon("Xcode");

    expect(invokeMock).toHaveBeenCalledWith("get_open_app_icon", {
      appName: "Xcode",
    });
  });

  it("reads agent.md for a workspace", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      exists: true,
      content: "# Agent",
      truncated: false,
    });

    await readAgentMd("ws-agent");

    expect(invokeMock).toHaveBeenCalledWith("file_read", {
      scope: "workspace",
      kind: "agents",
      workspaceId: "ws-agent",
    });
  });

  it("writes agent.md for a workspace", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await writeAgentMd("ws-agent", "# Agent");

    expect(invokeMock).toHaveBeenCalledWith("file_write", {
      scope: "workspace",
      kind: "agents",
      workspaceId: "ws-agent",
      content: "# Agent",
    });
  });

  it("reads global AGENTS.md", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      exists: true,
      content: "# Global",
      truncated: false,
    });

    await readGlobalAgentsMd();

    expect(invokeMock).toHaveBeenCalledWith("file_read", {
      scope: "global",
      kind: "agents",
      workspaceId: undefined,
    });
  });

  it("writes global AGENTS.md", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await writeGlobalAgentsMd("# Global");

    expect(invokeMock).toHaveBeenCalledWith("file_write", {
      scope: "global",
      kind: "agents",
      workspaceId: undefined,
      content: "# Global",
    });
  });

  it("reads global config.toml", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      exists: true,
      content: 'model = "gpt-5"',
      truncated: false,
    });

    await readGlobalCodexConfigToml();

    expect(invokeMock).toHaveBeenCalledWith("file_read", {
      scope: "global",
      kind: "config",
      workspaceId: undefined,
    });
  });

  it("reads global auth.json", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      exists: true,
      content: '{"tokens":[]}',
      truncated: false,
    });

    await readGlobalCodexAuthJson();

    expect(invokeMock).toHaveBeenCalledWith("file_read", {
      scope: "global",
      kind: "auth",
      workspaceId: undefined,
    });
  });

  it("writes global config.toml", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await writeGlobalCodexConfigToml('model = "gpt-5"');

    expect(invokeMock).toHaveBeenCalledWith("file_write", {
      scope: "global",
      kind: "config",
      workspaceId: undefined,
      content: 'model = "gpt-5"',
    });
  });

  it("writes global auth.json", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await writeGlobalCodexAuthJson('{"tokens":[]}');

    expect(invokeMock).toHaveBeenCalledWith("file_write", {
      scope: "global",
      kind: "auth",
      workspaceId: undefined,
      content: '{"tokens":[]}',
    });
  });

  it("reads CLAUDE.md for a workspace", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      exists: true,
      content: "# Claude",
      truncated: false,
    });

    await readClaudeMd("ws-claude");

    expect(invokeMock).toHaveBeenCalledWith("file_read", {
      scope: "workspace",
      kind: "claude",
      workspaceId: "ws-claude",
    });
  });

  it("writes CLAUDE.md for a workspace", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await writeClaudeMd("ws-claude", "# Claude");

    expect(invokeMock).toHaveBeenCalledWith("file_write", {
      scope: "workspace",
      kind: "claude",
      workspaceId: "ws-claude",
      content: "# Claude",
    });
  });

  it("fills sendUserMessage defaults in payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await sendUserMessage("ws-4", "thread-1", "hello", {
      accessMode: "full-access",
      images: ["image.png"],
    });

    expect(invokeMock).toHaveBeenCalledWith("send_user_message", {
      workspaceId: "ws-4",
      threadId: "thread-1",
      text: "hello",
      model: null,
      effort: null,
      disableThinking: false,
      accessMode: "full-access",
      images: ["image.png"],
      preferredLanguage: null,
      resumeSource: null,
      resumeTurnId: null,
    });
  });

  it("forwards read-only access mode for claude plan flows", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await sendUserMessage("ws-4", "thread-1", "plan first", {
      accessMode: "read-only",
    });

    expect(invokeMock).toHaveBeenCalledWith("send_user_message", {
      workspaceId: "ws-4",
      threadId: "thread-1",
      text: "plan first",
      model: null,
      effort: null,
      disableThinking: false,
      accessMode: "read-only",
      images: null,
      preferredLanguage: null,
      resumeSource: null,
      resumeTurnId: null,
    });
  });

  it("forwards customSpecRoot in sendUserMessage payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await sendUserMessage("ws-4", "thread-1", "hello", {
      customSpecRoot: "/tmp/external-openspec",
    });

    expect(invokeMock).toHaveBeenCalledWith("send_user_message", {
      workspaceId: "ws-4",
      threadId: "thread-1",
      text: "hello",
      model: null,
      effort: null,
      disableThinking: false,
      accessMode: null,
      images: null,
      preferredLanguage: null,
      resumeSource: null,
      resumeTurnId: null,
      customSpecRoot: "/tmp/external-openspec",
    });
  });

  it("records content-safe Codex turn-start ack latency on send success", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({ turnId: "turn-1" });
    const dateNowSpy = vi.spyOn(Date, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_125);

    try {
      await sendUserMessage("ws-4", "thread-1", "secret prompt", {
        model: "MiniMax-M3",
      });

      expect(rendererDiagnosticsMocks.appendRendererDiagnostic).toHaveBeenCalledWith(
        "stream-latency/codex-turn-start-ack",
        expect.objectContaining({
          workspaceId: "ws-4",
          threadId: "thread-1",
          model: "MiniMax-M3",
          requestStartedAtMs: 1_000,
          respondedAtMs: 1_125,
          durationMs: 125,
          outcome: "ok",
        }),
      );
      expect(JSON.stringify(rendererDiagnosticsMocks.appendRendererDiagnostic.mock.calls)).not.toContain(
        "secret prompt",
      );
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it("keeps send success when Codex turn-start ack diagnostic persistence fails", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({ turnId: "turn-1" });
    rendererDiagnosticsMocks.appendRendererDiagnostic.mockImplementationOnce(() => {
      throw new Error("diagnostic persistence failed");
    });
    const dateNowSpy = vi.spyOn(Date, "now")
      .mockReturnValueOnce(3_000)
      .mockReturnValueOnce(3_010);

    try {
      await expect(sendUserMessage("ws-4", "thread-1", "hello")).resolves.toEqual({
        turnId: "turn-1",
      });
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it("records Codex turn-start ack latency on send error without swallowing the error", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockRejectedValueOnce(new Error("boom"));
    const dateNowSpy = vi.spyOn(Date, "now")
      .mockReturnValueOnce(2_000)
      .mockReturnValueOnce(2_250);

    try {
      await expect(sendUserMessage("ws-4", "thread-1", "hidden prompt")).rejects.toThrow("boom");

      expect(rendererDiagnosticsMocks.appendRendererDiagnostic).toHaveBeenCalledWith(
        "stream-latency/codex-turn-start-ack",
        expect.objectContaining({
          workspaceId: "ws-4",
          threadId: "thread-1",
          durationMs: 250,
          outcome: "error",
          errorName: "Error",
        }),
      );
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it("omits delivery when starting reviews without override", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await startReview("ws-5", "thread-2", { type: "uncommittedChanges" });

    expect(invokeMock).toHaveBeenCalledWith("start_review", {
      workspaceId: "ws-5",
      threadId: "thread-2",
      target: { type: "uncommittedChanges" },
    });
  });

  it("nests decisions for server request responses", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await respondToServerRequest("ws-6", 101, "accept");

    expect(invokeMock).toHaveBeenCalledWith("respond_to_server_request", {
      workspaceId: "ws-6",
      requestId: 101,
      result: { decision: "accept" },
      providerProfileId: null,
    });
  });

  it("routes Shared approvals with the exact Runtime owner", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});
    const owner = {
      attemptId: "attempt-approval",
      providerRuntimeKey: "codex::ws-6::provider-a",
      sharedThreadId: "shared:thread-a",
      nativeThreadId: "codex-native-a",
      runtimeTurnId: "runtime-turn-a",
      engine: "codex" as const,
      providerProfileId: "provider-a",
    };

    await respondToServerRequest("ws-6", 102, "accept", owner);

    expect(invokeMock).toHaveBeenCalledWith("respond_to_server_request", {
      workspaceId: "ws-6",
      requestId: 102,
      result: { decision: "accept" },
      providerProfileId: "provider-a",
      threadId: "codex-native-a",
      turnId: "runtime-turn-a",
      sharedAttemptId: "attempt-approval",
      sharedThreadId: "shared:thread-a",
      providerRuntimeKey: "codex::ws-6::provider-a",
    });
  });

  it("nests answers for user input responses", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await respondToUserInputRequest("ws-7", 202, {
      confirm_path: { answers: ["Yes"] },
    });

    expect(invokeMock).toHaveBeenCalledWith("respond_to_server_request", {
      workspaceId: "ws-7",
      requestId: 202,
      result: {
        answers: {
          confirm_path: { answers: ["Yes"] },
        },
      },
      threadId: null,
      turnId: null,
    });
  });

  it("routes Shared user input with the exact Runtime owner", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});
    const owner = {
      attemptId: "attempt-input",
      providerRuntimeKey: "claude::ws-7::provider-b",
      sharedThreadId: "shared:thread-b",
      nativeThreadId: "claude-native-b",
      runtimeTurnId: "runtime-turn-b",
      engine: "claude" as const,
      providerProfileId: "provider-b",
    };

    await respondToUserInputRequest(
      "ws-7",
      203,
      { confirm_path: { answers: ["Yes"] } },
      {
        threadId: "poisoned-thread",
        turnId: "poisoned-turn",
        sharedOwner: owner,
      },
    );

    expect(invokeMock).toHaveBeenCalledWith("respond_to_server_request", {
      workspaceId: "ws-7",
      requestId: 203,
      result: {
        answers: {
          confirm_path: { answers: ["Yes"] },
        },
      },
      threadId: "claude-native-b",
      turnId: "runtime-turn-b",
      providerProfileId: "provider-b",
      sharedAttemptId: "attempt-input",
      sharedThreadId: "shared:thread-b",
      providerRuntimeKey: "claude::ws-7::provider-b",
    });
  });

  it("passes through multiple user input answers", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    const answers = {
      confirm_path: { answers: ["Yes"] },
      notes: { answers: ["First line", "Second line"] },
    };

    await respondToUserInputRequest("ws-8", 303, answers);

    expect(invokeMock).toHaveBeenCalledWith("respond_to_server_request", {
      workspaceId: "ws-8",
      requestId: 303,
      result: {
        answers,
      },
      threadId: null,
      turnId: null,
    });
  });

  it("passes skipped question ids with user input responses", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await respondToUserInputRequest(
      "ws-9",
      404,
      {
        first: { answers: ["Docs"] },
        second: { answers: [] },
      },
      { skippedQuestionIds: ["second"] },
    );

    expect(invokeMock).toHaveBeenCalledWith("respond_to_server_request", {
      workspaceId: "ws-9",
      requestId: 404,
      result: {
        answers: {
          first: { answers: ["Docs"] },
          second: { answers: [] },
        },
        skippedQuestionIds: ["second"],
      },
      threadId: null,
      turnId: null,
    });
  });

  it("lists thread titles for a workspace", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({ "thread-1": "Fix login flow" });

    await listThreadTitles("ws-12");

    expect(invokeMock).toHaveBeenCalledWith("list_thread_titles", {
      workspaceId: "ws-12",
    });
  });

  it("sets a thread title mapping", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce("Fix login flow");

    await setThreadTitle("ws-13", "thread-13", "Fix login flow");

    expect(invokeMock).toHaveBeenCalledWith("set_thread_title", {
      workspaceId: "ws-13",
      threadId: "thread-13",
      title: "Fix login flow",
    });
  });

  it("generates a thread title with codex backend", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce("Fix login flow");

    await generateThreadTitle(
      "ws-14",
      "thread-14",
      "Please fix login redirect loop",
      "zh",
    );

    expect(invokeMock).toHaveBeenCalledWith("generate_thread_title", {
      workspaceId: "ws-14",
      threadId: "thread-14",
      userMessage: "Please fix login redirect loop",
      preferredLanguage: "zh",
    });
  });

  it("renames a thread title key", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({ ok: true });

    await renameThreadTitleKey("ws-15", "claude-pending-1", "claude:session-1");

    expect(invokeMock).toHaveBeenCalledWith("rename_thread_title_key", {
      workspaceId: "ws-15",
      oldThreadId: "claude-pending-1",
      newThreadId: "claude:session-1",
    });
  });

  it("maps opencode provider health params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      provider: "openai",
      connected: true,
      credentialCount: 1,
      matched: true,
    });

    await getOpenCodeProviderHealth("ws-16", "openai");

    expect(invokeMock).toHaveBeenCalledWith("opencode_provider_health", {
      workspaceId: "ws-16",
      provider: "openai",
    });
  });

  it("maps opencode provider connect params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({ started: true });

    await connectOpenCodeProvider("ws-17", null);

    expect(invokeMock).toHaveBeenCalledWith("opencode_provider_connect", {
      workspaceId: "ws-17",
      providerId: null,
    });
  });

  it("maps opencode status snapshot params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      providerHealth: {
        provider: "openai",
        connected: true,
        credentialCount: 1,
        matched: true,
      },
      mcpEnabled: true,
      mcpServers: [],
      mcpRaw: "",
      managedToggles: true,
    });

    await getOpenCodeStatusSnapshot({
      workspaceId: "ws-18",
      threadId: "opencode:ses_18",
      model: "openai/gpt-5.3-codex",
      agent: "default",
      variant: "default",
    });

    expect(invokeMock).toHaveBeenCalledWith("opencode_status_snapshot", {
      workspaceId: "ws-18",
      threadId: "opencode:ses_18",
      model: "openai/gpt-5.3-codex",
      agent: "default",
      variant: "default",
    });
  });

  it("maps opencode MCP toggle params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      workspaceId: "ws-19",
      mcpEnabled: true,
      serverStates: {},
      managedToggles: true,
    });

    await setOpenCodeMcpToggle("ws-19", { serverName: "fs", enabled: false });

    expect(invokeMock).toHaveBeenCalledWith("opencode_mcp_toggle", {
      workspaceId: "ws-19",
      serverName: "fs",
      enabled: false,
      globalEnabled: null,
    });
  });

  it("maps opencode lsp definition params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      fileUri: "file:///tmp/ws/src/Main.java",
      line: 10,
      character: 4,
      result: [],
    });

    await getOpenCodeLspDefinition("ws-lsp-1", {
      fileUri: "file:///tmp/ws/src/Main.java",
      line: 10,
      character: 4,
    });

    expect(invokeMock).toHaveBeenCalledWith("opencode_lsp_definition", {
      workspaceId: "ws-lsp-1",
      fileUri: "file:///tmp/ws/src/Main.java",
      line: 10,
      character: 4,
    });
  });

  it("maps code intel definition params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      filePath: "src/Main.java",
      line: 10,
      character: 4,
      result: [],
    });

    const response = await getCodeIntelDefinition("ws-ci-1", {
      filePath: "src/Main.java",
      line: 10,
      character: 4,
    });

    expect(invokeMock).toHaveBeenCalledWith("code_intel_definition", {
      workspaceId: "ws-ci-1",
      filePath: "src/Main.java",
      line: 10,
      character: 4,
    });
    expect(response).toMatchObject({
      mode: "fast-search",
      provider: "heuristic",
      fallbackReasonCode: null,
      result: [],
    });
  });

  it("maps code intel prepare params and lifecycle", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      language: "JavaScript",
      provider: "typescript-language-server",
      lifecycle: "starting",
      fallbackReasonCode: null,
    });

    await expect(prepareCodeIntel("ws-ci-prepare", "src/main.js")).resolves.toEqual({
      language: "JavaScript",
      provider: "typescript-language-server",
      lifecycle: "starting",
      fallbackReasonCode: null,
    });
    expect(invokeMock).toHaveBeenCalledWith("code_intel_prepare", {
      workspaceId: "ws-ci-prepare",
      filePath: "src/main.js",
    });
  });

  it("preserves semantic navigation metadata and rejects unknown reason codes", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      filePath: "src/Main.ts",
      line: 2,
      character: 3,
      language: "typescript",
      mode: "semantic",
      provider: "typescript-language-server",
      fallbackReasonCode: "not-a-public-reason",
      result: [{ uri: "file:///repo/src/Main.ts", line: 2, character: 3 }],
    });

    await expect(getCodeIntelDefinition("ws-ci-semantic", {
      filePath: "src/Main.ts",
      line: 2,
      character: 3,
    })).resolves.toMatchObject({
      language: "typescript",
      mode: "semantic",
      provider: "typescript-language-server",
      fallbackReasonCode: null,
    });
  });

  it("propagates code intel definition errors", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockRejectedValueOnce(new Error("code intel unavailable"));

    await expect(
      getCodeIntelDefinition("ws-ci-err-1", {
        filePath: "src/Main.java",
        line: 1,
        character: 1,
      }),
    ).rejects.toThrow("code intel unavailable");
  });

  it("maps code intel implementation params with current document text", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({ result: [] });

    await getCodeIntelImplementations("ws-ci-rust", {
      filePath: "src/lib.rs",
      line: 4,
      character: 9,
      documentText: "trait Renderer {}",
    });

    expect(invokeMock).toHaveBeenCalledWith("code_intel_implementations", {
      workspaceId: "ws-ci-rust",
      filePath: "src/lib.rs",
      line: 4,
      character: 9,
      documentText: "trait Renderer {}",
    });
  });

  it("maps code intel references params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      filePath: "src/Main.java",
      line: 11,
      character: 8,
      includeDeclaration: false,
      result: [],
    });

    await getCodeIntelReferences("ws-ci-2", {
      filePath: "src/Main.java",
      line: 11,
      character: 8,
      includeDeclaration: false,
    });

    expect(invokeMock).toHaveBeenCalledWith("code_intel_references", {
      workspaceId: "ws-ci-2",
      filePath: "src/Main.java",
      line: 11,
      character: 8,
      includeDeclaration: false,
    });
  });

  it("propagates code intel references errors", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockRejectedValueOnce(new Error("references unavailable"));

    await expect(
      getCodeIntelReferences("ws-ci-err-2", {
        filePath: "src/Main.java",
        line: 2,
        character: 3,
      }),
    ).rejects.toThrow("references unavailable");
  });

  it("maps opencode lsp references params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      fileUri: "file:///tmp/ws/src/Main.java",
      line: 11,
      character: 8,
      includeDeclaration: true,
      result: [],
    });

    await getOpenCodeLspReferences("ws-lsp-2", {
      fileUri: "file:///tmp/ws/src/Main.java",
      line: 11,
      character: 8,
      includeDeclaration: true,
    });

    expect(invokeMock).toHaveBeenCalledWith("opencode_lsp_references", {
      workspaceId: "ws-lsp-2",
      fileUri: "file:///tmp/ws/src/Main.java",
      line: 11,
      character: 8,
      includeDeclaration: true,
    });
  });

  it("maps sync engine send payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      engine: "codex",
      text: '{"projectType":"legacy"}',
    });

    await engineSendMessageSync("ws-21", {
      text: "Generate project context",
      engine: "codex",
      accessMode: "read-only",
      continueSession: false,
    });

    expect(invokeMock).toHaveBeenCalledWith("engine_send_message_sync", {
      workspaceId: "ws-21",
      text: "Generate project context",
      engine: "codex",
      model: null,
      effort: null,
      disableThinking: false,
      images: null,
      continueSession: false,
      accessMode: "read-only",
      sessionId: null,
      forkSessionId: null,
      agent: null,
      variant: null,
      customSpecRoot: null,
      autoSession: null,
    });
  });

  it("rejects every Gemini execution RPC before invoking the backend", async () => {
    const invokeMock = vi.mocked(invoke);

    await expect(switchEngine("gemini")).rejects.toThrow(
      "Selected CLI engine is disabled by product policy",
    );
    await expect(getEngineModels("gemini")).rejects.toThrow(
      "Selected CLI engine is disabled by product policy",
    );
    await expect(
      engineSendMessage("ws-gemini", {
        text: "must not run",
        engine: "gemini",
      }),
    ).rejects.toThrow("Selected CLI engine is disabled by product policy");
    await expect(
      engineSendMessageSync("ws-gemini", {
        text: "must not run",
        engine: "gemini",
      }),
    ).rejects.toThrow("Selected CLI engine is disabled by product policy");

    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("maps sync engine send custom spec root payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      engine: "opencode",
      text: "ok",
    });

    await engineSendMessageSync("ws-22", {
      text: "check spec",
      engine: "opencode",
      customSpecRoot: "/tmp/external-openspec",
    });

    expect(invokeMock).toHaveBeenCalledWith("engine_send_message_sync", {
      workspaceId: "ws-22",
      text: "check spec",
      engine: "opencode",
      model: null,
      effort: null,
      disableThinking: false,
      images: null,
      continueSession: false,
      accessMode: null,
      sessionId: null,
      forkSessionId: null,
      agent: null,
      variant: null,
      customSpecRoot: "/tmp/external-openspec",
      autoSession: null,
    });
  });

  it("maps automatic session metadata in sync engine send payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      engine: "codex",
      text: "ok",
    });

    await engineSendMessageSync("ws-auto", {
      text: "enhance prompt",
      engine: "codex",
      autoSession: {
        sessionPurpose: "prompt-enhancer",
        visibility: "hidden",
        ownerFeature: "composer",
        autoArchive: true,
        createdBy: "system",
      },
    });

    expect(invokeMock).toHaveBeenCalledWith("engine_send_message_sync", {
      workspaceId: "ws-auto",
      text: "enhance prompt",
      engine: "codex",
      model: null,
      effort: null,
      disableThinking: false,
      images: null,
      continueSession: false,
      accessMode: null,
      sessionId: null,
      forkSessionId: null,
      agent: null,
      variant: null,
      customSpecRoot: null,
      autoSession: {
        sessionPurpose: "prompt-enhancer",
        visibility: "hidden",
        ownerFeature: "composer",
        autoArchive: true,
        createdBy: "system",
      },
    });
  });

  it("falls back to codex-only engine statuses in web runtime when detect command is unavailable", async () => {
    const invokeMock = vi.mocked(invoke);
    setWebRuntimeFlag(true);
    invokeMock.mockRejectedValueOnce(
      new Error("unknown method: detect_engines"),
    );

    const statuses = await detectEngines();
    const codexStatus = statuses.find((entry) => entry.engineType === "codex");
    const claudeStatus = statuses.find(
      (entry) => entry.engineType === "claude",
    );

    expect(codexStatus?.installed).toBe(true);
    expect(claudeStatus?.installed).toBe(false);
    expect(claudeStatus?.error).toContain("Codex CLI");
  });

  it("returns a friendly error after web runtime fallback state is learned", async () => {
    const invokeMock = vi.mocked(invoke);
    setWebRuntimeFlag(true);
    invokeMock.mockRejectedValueOnce(
      new Error("unknown method: detect_engines"),
    );

    await detectEngines();

    const response = await engineSendMessage("ws-web", {
      text: "hello",
      engine: "claude",
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(response).toEqual({
      error: {
        message:
          "Web 服务当前仅支持 Codex CLI。请切换到 Codex CLI（Web service currently supports Codex CLI only）.",
      },
    });
  });

  it("continues to invoke codex engine send after web runtime fallback state is learned", async () => {
    const invokeMock = vi.mocked(invoke);
    setWebRuntimeFlag(true);
    invokeMock
      .mockRejectedValueOnce(new Error("unknown method: detect_engines"))
      .mockResolvedValueOnce({ engine: "codex", threadId: "codex-thread-1" });

    await detectEngines();

    const response = await engineSendMessage("ws-web", {
      text: "hello codex",
      engine: "codex",
      threadId: "codex-thread-1",
    });

    expect(response).toEqual({ engine: "codex", threadId: "codex-thread-1" });
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenLastCalledWith("engine_send_message", {
      workspaceId: "ws-web",
      text: "hello codex",
      engine: "codex",
      model: null,
      effort: null,
      disableThinking: false,
      images: null,
      continueSession: false,
      accessMode: null,
      threadId: "codex-thread-1",
      sessionId: null,
      forkSessionId: null,
      agent: null,
      variant: null,
      providerProfileId: null,
      customSpecRoot: null,
      autoSession: null,
      skillInvocations: null,
    });
  });

  it("preserves Claude reasoning effort in engine_send_message payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      engine: "claude",
      threadId: "claude:session-1",
    });

    await engineSendMessage("ws-claude", {
      text: "think harder",
      engine: "claude",
      model: "Cxn[1m]",
      effort: "high",
      threadId: "claude:session-1",
      providerProfileId: "claude-provider-a",
    });

    expect(invokeMock).toHaveBeenCalledWith("engine_send_message", {
      workspaceId: "ws-claude",
      text: "think harder",
      engine: "claude",
      model: "Cxn[1m]",
      effort: "high",
      disableThinking: false,
      images: null,
      continueSession: false,
      accessMode: null,
      threadId: "claude:session-1",
      sessionId: null,
      forkSessionId: null,
      agent: null,
      variant: null,
      providerProfileId: "claude-provider-a",
      customSpecRoot: null,
      autoSession: null,
      skillInvocations: null,
    });
  });

  it("preserves Claude fork session id in engine_send_message payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({ engine: "claude" });

    await engineSendMessage("ws-claude", {
      text: "start from here",
      engine: "claude",
      threadId: "claude-fork:parent-session-1:local-1",
      forkSessionId: "parent-session-1",
    });

    expect(invokeMock).toHaveBeenCalledWith("engine_send_message", {
      workspaceId: "ws-claude",
      text: "start from here",
      engine: "claude",
      model: null,
      effort: null,
      disableThinking: false,
      images: null,
      continueSession: false,
      accessMode: null,
      threadId: "claude-fork:parent-session-1:local-1",
      sessionId: null,
      forkSessionId: "parent-session-1",
      agent: null,
      variant: null,
      providerProfileId: null,
      customSpecRoot: null,
      autoSession: null,
      skillInvocations: null,
    });
  });

  it("passes structured skill invocations through engine_send_message payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({ engine: "claude" });

    await engineSendMessage("ws-claude", {
      text: "/Code-Review 请审查这段代码",
      engine: "claude",
      skillInvocations: [{ name: "Code-Review" }],
    });

    expect(invokeMock).toHaveBeenCalledWith("engine_send_message", {
      workspaceId: "ws-claude",
      text: "/Code-Review 请审查这段代码",
      engine: "claude",
      model: null,
      effort: null,
      disableThinking: false,
      images: null,
      continueSession: false,
      accessMode: null,
      threadId: null,
      sessionId: null,
      forkSessionId: null,
      agent: null,
      variant: null,
      providerProfileId: null,
      customSpecRoot: null,
      autoSession: null,
      skillInvocations: [{ name: "Code-Review" }],
    });
  });

  it("blocks non-codex engine switch after web runtime fallback state is learned", async () => {
    const invokeMock = vi.mocked(invoke);
    setWebRuntimeFlag(true);
    invokeMock.mockRejectedValueOnce(
      new Error("unknown method: detect_engines"),
    );

    await detectEngines();

    await expect(switchEngine("claude")).rejects.toThrow(
      "Web 服务当前仅支持 Codex CLI。请切换到 Codex CLI（Web service currently supports Codex CLI only）.",
    );
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("returns empty models for non-codex engine after web runtime fallback state is learned", async () => {
    const invokeMock = vi.mocked(invoke);
    setWebRuntimeFlag(true);
    invokeMock.mockRejectedValueOnce(
      new Error("unknown method: detect_engines"),
    );

    await detectEngines();

    await expect(getEngineModels("claude")).resolves.toEqual([]);
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("invokes get_active_engine", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce("claude");

    const engine = await getActiveEngine();

    expect(engine).toBe("claude");
    expect(invokeMock).toHaveBeenCalledWith("get_active_engine");
  });

  it("maps switch_engine params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce(undefined);

    await switchEngine("claude");

    expect(invokeMock).toHaveBeenCalledWith("switch_engine", {
      engineType: "claude",
    });
  });

  it("maps get_engine_status params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce(null);

    const status = await getEngineStatus("claude");

    expect(status).toBeNull();
    expect(invokeMock).toHaveBeenCalledWith("get_engine_status", {
      engineType: "claude",
    });
  });

  it("invokes get_engine_active_process_diagnostics", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      measured: true,
      sampledAtMs: 1_765_647_000_000,
      totalActiveProcessCount: 2,
      workspaces: [
        {
          workspaceId: "ws-1",
          engine: "claude",
          activeProcessIds: [101, 102],
          registeredActiveProcesses: [
            { pid: 101, registeredAgeMs: 0 },
            { pid: 102, registeredAgeMs: 0 },
          ],
        },
      ],
      unsupportedReason: null,
      osChildLiveness: {
        evidenceClass: "unsupported",
        sampledAfterCloseMs: 0,
        sampledOsChildCount: null,
        sampler: null,
        rationale:
          "Runtime does not ship a cross-platform OS child process sampler.",
      },
      staleChildCandidates: [],
    });

    const diagnostics = await getEngineActiveProcessDiagnostics();

    expect(diagnostics.totalActiveProcessCount).toBe(2);
    expect(diagnostics.workspaces[0]?.activeProcessIds).toEqual([101, 102]);
    expect(diagnostics.workspaces[0]?.registeredActiveProcesses).toEqual([
      { pid: 101, registeredAgeMs: 0 },
      { pid: 102, registeredAgeMs: 0 },
    ]);
    expect(diagnostics.osChildLiveness.evidenceClass).toBe("unsupported");
    expect(diagnostics.staleChildCandidates).toEqual([]);
    expect(invokeMock).toHaveBeenCalledWith(
      "get_engine_active_process_diagnostics",
    );
  });

  it("maps get_engine_models params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce([
      {
        id: "claude-sonnet-option",
        model: "sonnet",
        displayName: "Sonnet",
        description: "Discovered",
        source: "cli-discovered",
        isDefault: true,
      },
    ]);

    const models = await getEngineModels("claude");

    expect(models).toEqual([
      {
        id: "claude-sonnet-option",
        model: "sonnet",
        displayName: "Sonnet",
        description: "Discovered",
        source: "cli-discovered",
        isDefault: true,
      },
    ]);
    expect(invokeMock).toHaveBeenCalledWith("get_engine_models", {
      engineType: "claude",
    });
  });

  it("maps get_engine_models force refresh params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce([]);

    const models = await getEngineModels("claude", { forceRefresh: true });

    expect(models).toEqual([]);
    expect(invokeMock).toHaveBeenCalledWith("get_engine_models", {
      engineType: "claude",
      forceRefresh: true,
    });
  });

  it("maps get_engine_models provider scope without leaking blank ids", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValue([]);

    await getEngineModels("kimi", {
      providerProfileId: "  provider-k3  ",
      forceRefresh: true,
    });
    expect(invokeMock).toHaveBeenLastCalledWith("get_engine_models", {
      engineType: "kimi",
      providerProfileId: "provider-k3",
      forceRefresh: true,
    });

    await getEngineModels("kimi", { providerProfileId: "   " });
    expect(invokeMock).toHaveBeenLastCalledWith("get_engine_models", {
      engineType: "kimi",
    });
  });

  it("maps engine_interrupt params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce(undefined);

    await engineInterrupt("ws-interrupt");

    expect(invokeMock).toHaveBeenCalledWith("engine_interrupt", {
      workspaceId: "ws-interrupt",
    });
  });

  it("maps delete_claude_session params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce(undefined);

    await deleteClaudeSession("/tmp/workspace", "claude-session-1");

    expect(invokeMock).toHaveBeenCalledWith("delete_claude_session", {
      workspacePath: "/tmp/workspace",
      sessionId: "claude-session-1",
    });
  });

  it("maps delete_gemini_session params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce(undefined);

    await deleteGeminiSession("/tmp/workspace", "gemini-session-1");

    expect(invokeMock).toHaveBeenCalledWith("delete_gemini_session", {
      workspacePath: "/tmp/workspace",
      sessionId: "gemini-session-1",
    });
  });

  it("maps delete_kimi_session params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce(undefined);

    await deleteKimiSession("/tmp/workspace", "kimi-session-1");

    expect(invokeMock).toHaveBeenCalledWith("delete_kimi_session", {
      workspacePath: "/tmp/workspace",
      sessionId: "kimi-session-1",
    });
  });

  it("maps delete_grok_session params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce(undefined);

    await deleteGrokSession("/tmp/workspace", "grok-session-1");

    expect(invokeMock).toHaveBeenCalledWith("delete_grok_session", {
      workspacePath: "/tmp/workspace",
      sessionId: "grok-session-1",
    });
  });

  it("maps hydrate_claude_deferred_image params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      src: "data:image/png;base64,AAAA",
      mediaType: "image/png",
      byteSize: 3,
      locator: {
        sessionId: "claude-session-1",
        lineIndex: 4,
        blockIndex: 1,
        mediaType: "image/png",
      },
    });

    const locator = {
      sessionId: "claude-session-1",
      lineIndex: 4,
      blockIndex: 1,
      mediaType: "image/png",
    };
    const result = await hydrateClaudeDeferredImage("/tmp/workspace", locator);

    expect(result.src).toBe("data:image/png;base64,AAAA");
    expect(invokeMock).toHaveBeenCalledWith("hydrate_claude_deferred_image", {
      workspacePath: "/tmp/workspace",
      locator,
    });
  });
});
