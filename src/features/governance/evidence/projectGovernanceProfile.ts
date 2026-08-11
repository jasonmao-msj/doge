import { normalizeGovernancePath } from "./pathUtils";
import type { GovernanceEvidence, WorkspaceGovernanceSnapshot } from "./types";
import { createGovernanceEvidence } from "./governanceEvidence";

export type GovernanceEcosystem =
  | "generic"
  | "node"
  | "typescript"
  | "python"
  | "rust"
  | "go"
  | "maven"
  | "gradle";

export type GovernanceSystem = "openspec" | "trellis" | "agent-rules";

export type PackageManager =
  | "npm"
  | "pnpm"
  | "yarn"
  | "bun"
  | "cargo"
  | "go"
  | "maven"
  | "gradle";

export type CiProvider = "github-actions" | "gitlab-ci" | "circleci";

export type GovernanceGateProfile = {
  readonly name: string;
  readonly artifactPath: string;
  readonly source: "large-file" | "heavy-test-noise" | "script" | "config";
  readonly severity: "info" | "warn" | "fail";
  readonly command?: string;
};

export type ProjectGovernanceProfile = {
  readonly files: readonly string[];
  readonly ecosystems: readonly GovernanceEcosystem[];
  readonly governanceSystems: readonly GovernanceSystem[];
  readonly packageManagers: readonly PackageManager[];
  readonly ciProviders: readonly CiProvider[];
  readonly scripts: Readonly<Record<string, string>>;
  readonly workflows: readonly string[];
  readonly gates: readonly GovernanceGateProfile[];
  readonly configEvidence: readonly GovernanceEvidence[];
};

type PackageJsonWithScripts = {
  readonly scripts?: Record<string, unknown>;
  readonly packageManager?: unknown;
};

type GovernanceConfigV1 = {
  readonly version?: unknown;
  readonly scripts?: readonly unknown[];
  readonly workflows?: readonly unknown[];
  readonly gates?: readonly unknown[];
  readonly openspec?: { readonly root?: unknown };
  readonly trellis?: { readonly root?: unknown };
};

const SCRIPT_TO_GATE: readonly {
  readonly scriptName: string;
  readonly gate: GovernanceGateProfile;
}[] = [
  {
    scriptName: "check:large-files:gate",
    gate: {
      name: "Large-file hard gate",
      artifactPath: ".artifacts/large-files-gate.json",
      source: "large-file",
      severity: "fail",
      command: "npm run check:large-files:gate",
    },
  },
  {
    scriptName: "check:large-files:near-threshold",
    gate: {
      name: "Large-file near-threshold watch",
      artifactPath: ".artifacts/large-files-near-threshold.json",
      source: "large-file",
      severity: "warn",
      command: "npm run check:large-files:near-threshold",
    },
  },
  {
    scriptName: "check:heavy-test-noise",
    gate: {
      name: "Heavy test noise sentry",
      artifactPath: ".artifacts/heavy-test-noise.json",
      source: "heavy-test-noise",
      severity: "warn",
      command: "npm run check:heavy-test-noise",
    },
  },
];

const WORKFLOW_TO_GATE: readonly {
  readonly workflowPath: string;
  readonly gate: GovernanceGateProfile;
}[] = [
  {
    workflowPath: ".github/workflows/large-file-governance.yml",
    gate: {
      name: "Large-file hard gate",
      artifactPath: ".artifacts/large-files-gate.json",
      source: "large-file",
      severity: "fail",
      command: "npm run check:large-files:gate",
    },
  },
  {
    workflowPath: ".github/workflows/heavy-test-noise-sentry.yml",
    gate: {
      name: "Heavy test noise sentry",
      artifactPath: ".artifacts/heavy-test-noise.json",
      source: "heavy-test-noise",
      severity: "warn",
      command: "npm run check:heavy-test-noise",
    },
  },
];

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return Array.from(new Set(values)).sort((left, right) =>
    left.localeCompare(right, "en"),
  );
}

function hasFile(files: readonly string[], path: string) {
  const normalized = normalizeGovernancePath(path);
  return files.includes(normalized);
}

function hasFilePrefix(files: readonly string[], prefix: string) {
  const normalized = normalizeGovernancePath(prefix);
  return files.some(
    (path) => path === normalized || path.startsWith(`${normalized}/`),
  );
}

export function parsePackageScripts(
  packageJson: string,
): Record<string, string> | null {
  try {
    const parsed = JSON.parse(packageJson) as PackageJsonWithScripts;
    if (!parsed.scripts || typeof parsed.scripts !== "object") {
      return {};
    }
    const scripts: Record<string, string> = {};
    for (const [name, command] of Object.entries(parsed.scripts)) {
      if (typeof command === "string") {
        scripts[name] = command;
      }
    }
    return scripts;
  } catch {
    return null;
  }
}

function detectPackageManagers(
  files: readonly string[],
  packageJson: string | null,
): PackageManager[] {
  const managers: PackageManager[] = [];
  if (hasFile(files, "package-lock.json")) managers.push("npm");
  if (hasFile(files, "pnpm-lock.yaml")) managers.push("pnpm");
  if (hasFile(files, "yarn.lock")) managers.push("yarn");
  if (hasFile(files, "bun.lockb") || hasFile(files, "bun.lock"))
    managers.push("bun");
  if (hasFile(files, "Cargo.lock")) managers.push("cargo");
  if (hasFile(files, "go.mod")) managers.push("go");
  if (hasFile(files, "pom.xml")) managers.push("maven");
  if (hasFile(files, "build.gradle") || hasFile(files, "build.gradle.kts"))
    managers.push("gradle");

  if (packageJson) {
    try {
      const parsed = JSON.parse(packageJson) as PackageJsonWithScripts;
      if (typeof parsed.packageManager === "string") {
        const manager = parsed.packageManager.split("@")[0] as PackageManager;
        if (["npm", "pnpm", "yarn", "bun"].includes(manager)) {
          managers.push(manager);
        }
      }
    } catch {
      // malformed package.json is reported by script evidence when scripts are applicable
    }
  }

  return uniqueSorted(managers);
}

function detectEcosystems(
  files: readonly string[],
  scripts: Readonly<Record<string, string>>,
): GovernanceEcosystem[] {
  const ecosystems: GovernanceEcosystem[] = [];
  if (hasFile(files, "package.json")) ecosystems.push("node");
  if (
    hasFile(files, "tsconfig.json") ||
    files.some((path) => path.endsWith(".ts") || path.endsWith(".tsx"))
  ) {
    ecosystems.push("typescript");
  }
  if (
    hasFile(files, "pyproject.toml") ||
    hasFile(files, "pytest.ini") ||
    hasFile(files, "ruff.toml") ||
    hasFile(files, "requirements.txt")
  ) {
    ecosystems.push("python");
  }
  if (hasFile(files, "Cargo.toml")) ecosystems.push("rust");
  if (hasFile(files, "go.mod")) ecosystems.push("go");
  if (hasFile(files, "pom.xml")) ecosystems.push("maven");
  if (hasFile(files, "build.gradle") || hasFile(files, "build.gradle.kts"))
    ecosystems.push("gradle");
  if (Object.keys(scripts).length > 0 && !ecosystems.includes("node"))
    ecosystems.push("node");
  return uniqueSorted(ecosystems.length > 0 ? ecosystems : ["generic"]);
}

function detectGovernanceSystems(files: readonly string[]): GovernanceSystem[] {
  const systems: GovernanceSystem[] = [];
  if (hasFilePrefix(files, "openspec")) systems.push("openspec");
  if (hasFilePrefix(files, ".trellis")) systems.push("trellis");
  if (
    hasFile(files, "AGENTS.md") ||
    hasFilePrefix(files, ".codex") ||
    hasFilePrefix(files, ".claude")
  ) {
    systems.push("agent-rules");
  }
  return uniqueSorted(systems);
}

function detectCiProviders(files: readonly string[]): CiProvider[] {
  const providers: CiProvider[] = [];
  if (hasFilePrefix(files, ".github/workflows"))
    providers.push("github-actions");
  if (hasFile(files, ".gitlab-ci.yml")) providers.push("gitlab-ci");
  if (hasFile(files, ".circleci/config.yml")) providers.push("circleci");
  return uniqueSorted(providers);
}

function detectWorkflows(files: readonly string[]) {
  return files
    .filter((path) => path.startsWith(".github/workflows/"))
    .sort((left, right) => left.localeCompare(right, "en"));
}

function addGate(
  gates: Map<string, GovernanceGateProfile>,
  gate: GovernanceGateProfile,
) {
  gates.set(gate.artifactPath, gate);
}

function detectGates(
  files: readonly string[],
  scripts: Readonly<Record<string, string>>,
  workflows: readonly string[],
): GovernanceGateProfile[] {
  const gates = new Map<string, GovernanceGateProfile>();
  for (const { scriptName, gate } of SCRIPT_TO_GATE) {
    if (scripts[scriptName]) {
      addGate(gates, gate);
    }
  }
  for (const { workflowPath, gate } of WORKFLOW_TO_GATE) {
    if (workflows.includes(workflowPath)) {
      addGate(gates, gate);
    }
  }
  for (const artifactPath of files.filter((path) =>
    path.startsWith(".artifacts/"),
  )) {
    if (artifactPath.includes("large-files-gate")) {
      addGate(gates, {
        name: "Large-file hard gate",
        artifactPath,
        source: "large-file",
        severity: "fail",
        command: "npm run check:large-files:gate",
      });
    }
    if (artifactPath.includes("large-files-near-threshold")) {
      addGate(gates, {
        name: "Large-file near-threshold watch",
        artifactPath,
        source: "large-file",
        severity: "warn",
        command: "npm run check:large-files:near-threshold",
      });
    }
    if (artifactPath.includes("heavy-test-noise")) {
      addGate(gates, {
        name: "Heavy test noise sentry",
        artifactPath,
        source: "heavy-test-noise",
        severity: "warn",
        command: "npm run check:heavy-test-noise",
      });
    }
  }
  return Array.from(gates.values()).sort((left, right) =>
    left.artifactPath.localeCompare(right.artifactPath, "en"),
  );
}

function readStringProperty(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : null;
}

function createConfigEvidence(summary: string): GovernanceEvidence {
  return createGovernanceEvidence({
    id: "governance-config:parse",
    source: "workflow",
    status: "warn",
    degraded: true,
    degradationReason: "governance-config-malformed",
    title: "Governance config",
    summary,
    provenance: {
      sourceType: "workspace",
      sourceId: "governance.config.json",
      observedAt: "1970-01-01T00:00:00.000Z",
      artifactPath: "governance.config.json",
      qualifier: "config-malformed",
    },
  });
}

function createMalformedPackageJsonEvidence(): GovernanceEvidence {
  return createGovernanceEvidence({
    id: "script:package-json",
    source: "script",
    status: "unknown",
    degraded: true,
    degradationReason: "package-json-malformed",
    title: "Package scripts",
    summary: "package.json scripts could not be parsed.",
    provenance: {
      sourceType: "workspace",
      sourceId: "package.json",
      observedAt: "1970-01-01T00:00:00.000Z",
      artifactPath: "package.json",
      qualifier: "package-json-malformed",
    },
  });
}

function mergeConfig(input: {
  configText: string | null;
  governanceSystems: GovernanceSystem[];
  scripts: Record<string, string>;
  workflows: string[];
  gates: GovernanceGateProfile[];
  baseEvidence?: readonly GovernanceEvidence[];
}): {
  readonly governanceSystems: GovernanceSystem[];
  readonly scripts: Record<string, string>;
  readonly workflows: string[];
  readonly gates: GovernanceGateProfile[];
  readonly configEvidence: GovernanceEvidence[];
} {
  if (!input.configText) {
    return { ...input, configEvidence: [...(input.baseEvidence ?? [])] };
  }

  let parsed: GovernanceConfigV1;
  try {
    parsed = JSON.parse(input.configText) as GovernanceConfigV1;
  } catch {
    return {
      ...input,
      configEvidence: [
        ...(input.baseEvidence ?? []),
        createConfigEvidence(
          "governance.config.json exists but could not be parsed.",
        ),
      ],
    };
  }

  if (parsed.version !== 1) {
    return {
      ...input,
      configEvidence: [
        ...(input.baseEvidence ?? []),
        createConfigEvidence("governance.config.json must declare version 1."),
      ],
    };
  }

  const scripts = { ...input.scripts };
  for (const entry of parsed.scripts ?? []) {
    const name = readStringProperty(entry, "name");
    const command =
      readStringProperty(entry, "command") ?? (name ? `npm run ${name}` : null);
    if (name && command) {
      scripts[name] = command;
    }
  }

  const workflows = new Set(input.workflows);
  for (const entry of parsed.workflows ?? []) {
    const path = readStringProperty(entry, "path");
    if (path) workflows.add(normalizeGovernancePath(path));
  }

  const gates = new Map(input.gates.map((gate) => [gate.artifactPath, gate]));
  for (const entry of parsed.gates ?? []) {
    const artifactPath = readStringProperty(entry, "artifact");
    const name = readStringProperty(entry, "name") ?? artifactPath;
    if (!artifactPath || !name) continue;
    const severity = readStringProperty(entry, "severity");
    addGate(gates, {
      name,
      artifactPath: normalizeGovernancePath(artifactPath),
      source: "config",
      severity: severity === "fail" || severity === "info" ? severity : "warn",
      command: readStringProperty(entry, "command") ?? undefined,
    });
  }

  const governanceSystems = new Set(input.governanceSystems);
  if (
    typeof parsed.openspec?.root === "string" &&
    parsed.openspec.root.trim()
  ) {
    governanceSystems.add("openspec");
  }
  if (typeof parsed.trellis?.root === "string" && parsed.trellis.root.trim()) {
    governanceSystems.add("trellis");
  }

  return {
    governanceSystems: uniqueSorted(Array.from(governanceSystems)),
    scripts,
    workflows: uniqueSorted(Array.from(workflows)),
    gates: Array.from(gates.values()).sort((left, right) =>
      left.artifactPath.localeCompare(right.artifactPath, "en"),
    ),
    configEvidence: [...(input.baseEvidence ?? [])],
  };
}

export async function deriveProjectGovernanceProfile(
  snapshot: WorkspaceGovernanceSnapshot,
): Promise<ProjectGovernanceProfile> {
  const files = uniqueSorted(snapshot.files.map(normalizeGovernancePath));
  const packageJson = await snapshot.readFile("package.json");
  const parsedScripts = packageJson ? parsePackageScripts(packageJson) : {};
  const scripts = parsedScripts ?? {};
  const baseEvidence =
    parsedScripts === null ? [createMalformedPackageJsonEvidence()] : [];
  const workflows = detectWorkflows(files);
  const configText = await snapshot.readFile("governance.config.json");
  const merged = mergeConfig({
    configText,
    governanceSystems: detectGovernanceSystems(files),
    scripts,
    workflows,
    gates: detectGates(files, scripts, workflows),
    baseEvidence,
  });

  return {
    files,
    ecosystems: detectEcosystems(files, merged.scripts),
    governanceSystems: merged.governanceSystems,
    packageManagers: detectPackageManagers(files, packageJson),
    ciProviders: detectCiProviders(files),
    scripts: merged.scripts,
    workflows: merged.workflows,
    gates: merged.gates,
    configEvidence: merged.configEvidence,
  };
}

export function createGovernanceConfigTemplate() {
  return JSON.stringify(
    {
      $schema: "https://doge.dev/schemas/governance.config.v1.json",
      version: 1,
      scripts: [],
      workflows: [],
      gates: [],
    },
    null,
    2,
  );
}

export const projectGovernanceProfileInternals = {
  SCRIPT_TO_GATE,
  WORKFLOW_TO_GATE,
  detectEcosystems,
  detectGates,
  parsePackageScripts,
};
