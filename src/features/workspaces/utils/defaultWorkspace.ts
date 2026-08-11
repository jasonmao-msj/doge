const DEFAULT_WORKSPACE_SUFFIXES = [
  "/.doge/workspace",
  "/.ccgui/workspace",
  "/.mossx/workspace",
  "/.codemoss/workspace",
  "/com.zhukunpenglinyutong.ccgui/workspace",
  "/com.zhukunpenglinyutong.mossx/workspace",
  "/com.zhukunpenglinyutong.codemoss/workspace",
];

function normalizeWorkspaceHomePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function normalizeWorkspacePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function isDefaultWorkspacePath(path: string): boolean {
  const normalized = normalizeWorkspacePath(path);
  return DEFAULT_WORKSPACE_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

export function getDefaultWorkspaceCandidatePaths(homePath: string): string[] {
  const normalizedHomePath = normalizeWorkspaceHomePath(homePath);
  if (!normalizedHomePath) {
    return [];
  }
  return DEFAULT_WORKSPACE_SUFFIXES.map((suffix) => `${normalizedHomePath}${suffix}`);
}
