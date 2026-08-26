export type CodexDoctorEnvironmentDiagnosis = {
  category: string;
  message?: string | null;
  configuredPath?: string | null;
  configuredPathMissing?: boolean;
  guiPathBinary?: string | null;
  fallbackBinary?: string | null;
  resolvedBinaryPath?: string | null;
  missedByGuiPath?: boolean;
};

export type CodexDoctorProxyDiagnosis = {
  category: string;
  primarySource?: string | null;
  configuredKeys?: string[];
  processEnv?: Record<string, string | null>;
  valuesRedacted?: boolean;
};

export type CodexDoctorNetworkDiagnosis = {
  category: string;
  proxy?: CodexDoctorProxyDiagnosis | null;
};

export type CodexDoctorResult = {
  ok: boolean;
  codexBin: string | null;
  version: string | null;
  appServerOk: boolean;
  appServerProbeStatus?: string | null;
  details: string | null;
  path: string | null;
  pathEnvUsed?: string | null;
  proxyEnvSnapshot?: Record<string, string | null>;
  nodeOk: boolean;
  nodeRequired?: boolean;
  nodeVersion: string | null;
  nodeDetails: string | null;
  kimiShell?: {
    ok: boolean;
    category?: string;
    source?: "bundled" | "external";
    shellPath?: string;
    shellVersion?: string | null;
    gitVersion?: string | null;
    cwdProbeOk?: boolean;
    message?: string;
    details?: unknown;
  } | null;
  resolvedBinaryPath?: string | null;
  wrapperKind?: string | null;
  fallbackRetried?: boolean;
  environmentDiagnosis?: CodexDoctorEnvironmentDiagnosis | null;
  proxyDiagnosis?: CodexDoctorProxyDiagnosis | null;
  networkDiagnosis?: CodexDoctorNetworkDiagnosis | null;
  debug?: {
    platform: string;
    arch: string;
    resolvedBinaryPath?: string | null;
    wrapperKind?: string | null;
    pathEnvUsed?: string | null;
    proxyEnvSnapshot?: Record<string, string | null>;
    proxyDiagnosis?: CodexDoctorProxyDiagnosis | null;
    envVars?: Record<string, string | null>;
    extraSearchPaths?: Array<{
      path: string;
      exists: boolean;
      isDir: boolean;
      hasCodexCmd?: boolean;
      hasClaudeCmd?: boolean;
    }>;
    claudeFound: string | null;
    codexFound: string | null;
    claudeStandardWhich: string | null;
    codexStandardWhich: string | null;
    customBin: string | null;
    combinedSearchPaths: string;
  };
};

export type CodexLaunchProfilePreview = {
  ok: boolean;
  scope: "global" | "workspace" | string;
  workspaceId: string | null;
  executableSource: string;
  argumentsSource: string;
  codexBin: string | null;
  codexArgs: string | null;
  resolvedExecutable: string;
  wrapperKind: string;
  userArguments: string[];
  injectedArguments: string[];
  launchArguments: string[];
  pathEnvUsed: string | null;
  warnings: string[];
  details: string | null;
  nextLaunchOnly: boolean;
};

export type CliInstallEngine = "codex" | "claude" | "kimi" | "grok" | "opencode";

export type CliInstallAction = "installLatest" | "updateLatest" | "uninstall";

export type CliInstallStrategy = "npmGlobal" | "cliSelfUpdate" | "officialNative";

export type CliInstallBackend = "local" | "remote";

export type CliInstallPlatform = "macos" | "windows" | "linux" | "unknown";

export type CliInstallPlan = {
  engine: CliInstallEngine;
  action: CliInstallAction;
  strategy: CliInstallStrategy;
  backend: CliInstallBackend;
  platform: CliInstallPlatform;
  commandPreview: string[];
  canRun: boolean;
  blockers: string[];
  warnings: string[];
  manualFallback: string | null;
};

export type CliInstallResult = {
  ok: boolean;
  engine: CliInstallEngine;
  action: CliInstallAction;
  strategy: CliInstallStrategy;
  backend: CliInstallBackend;
  exitCode: number | null;
  stdoutSummary: string | null;
  stderrSummary: string | null;
  details: string | null;
  durationMs: number;
  doctorResult: CodexDoctorResult | null;
};

export type CliInstallProgressPhase =
  | "started"
  | "stdout"
  | "stderr"
  | "finished"
  | "error";

export type CliInstallOutputStream = "stdout" | "stderr";

export type CliInstallProgressEvent = {
  runId: string;
  engine: CliInstallEngine;
  action: CliInstallAction;
  strategy: CliInstallStrategy;
  backend: CliInstallBackend;
  phase: CliInstallProgressPhase;
  stream: CliInstallOutputStream | null;
  message: string | null;
  exitCode: number | null;
  durationMs: number | null;
};

export type CliVersionStatus = {
  engine: CliInstallEngine;
  installed: boolean;
  localVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  nodeOk: boolean;
  details: string | null;
};

