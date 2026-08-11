const MAX_SAFE_PROJECT_MAP_SEGMENT_LENGTH = 64;

const PROJECT_MAP_IMPORTANT_FILE_NAMES = new Set([
  "package.json",
  "pnpm-workspace.yaml",
  "vite.config.ts",
  "tsconfig.json",
  "pyproject.toml",
  "requirements.txt",
  "go.mod",
  "Cargo.toml",
  "pom.xml",
  "build.gradle",
  "settings.gradle",
  "CMakeLists.txt",
  "Makefile",
  "README.md",
  "AGENTS.md",
]);

const PROJECT_MAP_TEXT_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".conf",
  ".cpp",
  ".cs",
  ".css",
  ".go",
  ".gradle",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".md",
  ".mdx",
  ".mjs",
  ".cjs",
  ".properties",
  ".py",
  ".rb",
  ".rs",
  ".sql",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

const PROJECT_MAP_EXCLUDED_PATH_SEGMENTS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "target",
  ".next",
  ".nuxt",
  "coverage",
  ".doge",
  ".venv",
  "venv",
  "__pycache__",
  ".idea",
]);

const WINDOWS_RESERVED_PATH_SEGMENTS = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

function stripLineSuffix(value: string): string {
  return value.replace(/:(?:\d+)(?::\d+)?$/, "");
}

function stripWrappingPunctuation(value: string): string {
  const unwrapped = value
    .replace(/^[`'"([{<]+/, "")
    .replace(/[>`'"\])},.;]+$/, "");
  return stripLineSuffix(unwrapped).replace(/[>`'"\])},.;]+$/, "");
}

export function getProjectMapPathBasename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function getProjectMapPathExtension(path: string): string {
  const fileName = getProjectMapPathBasename(path);
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : "";
}

export function isWindowsReservedProjectMapPathSegment(value: string): boolean {
  const stem = value.trim().toLowerCase().split(".")[0] ?? "";
  return WINDOWS_RESERVED_PATH_SEGMENTS.has(stem);
}

export function normalizeProjectMapPathSegment(
  value: unknown,
  fallback: string,
  reservedPrefix = "segment",
): string {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, MAX_SAFE_PROJECT_MAP_SEGMENT_LENGTH)
    .replace(/[._-]+$/g, "");
  const candidate = normalized || fallback;
  return isWindowsReservedProjectMapPathSegment(candidate)
    ? `${reservedPrefix}-${candidate}`
    : candidate;
}

export function uniqueProjectMapPathSegment(
  value: unknown,
  used: Set<string>,
  fallback: string,
  reservedPrefix = "segment",
): string {
  const base = normalizeProjectMapPathSegment(value, fallback, reservedPrefix);
  let candidate = base;
  let index = 2;
  while (used.has(candidate)) {
    const suffix = `-${index}`;
    candidate = `${base.slice(0, MAX_SAFE_PROJECT_MAP_SEGMENT_LENGTH - suffix.length)}${suffix}`;
    index += 1;
  }
  used.add(candidate);
  return candidate;
}

export function normalizeWorkspaceEvidencePath(value: string): string {
  const trimmed = stripWrappingPunctuation(value.trim());
  if (!trimmed || /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return "";
  }

  const normalized = trimmed.replace(/\\/g, "/").replace(/\/+/g, "/");
  if (
    normalized.startsWith("/") ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    /^[a-zA-Z]:\//.test(normalized) ||
    normalized.includes(":")
  ) {
    return "";
  }

  const withoutCurrentPrefix = normalized.replace(/^(?:\.\/)+/, "");
  const segments = withoutCurrentPrefix.split("/").filter(Boolean);
  if (segments.length === 0) {
    return "";
  }

  for (const segment of segments) {
    const lowerSegment = segment.toLowerCase();
    if (
      segment === "." ||
      segment === ".." ||
      lowerSegment === ".git" ||
      PROJECT_MAP_EXCLUDED_PATH_SEGMENTS.has(lowerSegment)
    ) {
      return "";
    }
  }

  const fileName = segments.at(-1) ?? "";
  if (
    !PROJECT_MAP_IMPORTANT_FILE_NAMES.has(fileName) &&
    !PROJECT_MAP_TEXT_EXTENSIONS.has(getProjectMapPathExtension(fileName))
  ) {
    return "";
  }

  return segments.join("/");
}

export function isProjectMapReadableWorkspacePath(value: string): boolean {
  return normalizeWorkspaceEvidencePath(value) !== "";
}

export function looksLikeProjectMapWorkspaceFilePath(value: string): boolean {
  return normalizeWorkspaceEvidencePath(value) !== "";
}

export function inferProjectMapWorkspaceFilePath(input: {
  label?: string | null;
  path?: string | null;
  ref?: string | null;
}): string {
  for (const candidate of [input.path, input.label, input.ref]) {
    const normalized = normalizeWorkspaceEvidencePath(candidate ?? "");
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

export function extractProjectMapWorkspaceEvidencePaths(text: string): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  const tokenPattern = /[^\s`'"(){}[\]<>]+/g;
  let match: RegExpExecArray | null = tokenPattern.exec(text);
  while (match) {
    const normalized = normalizeWorkspaceEvidencePath(match[0] ?? "");
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      paths.push(normalized);
    }
    match = tokenPattern.exec(text);
  }
  return paths;
}

export function isProjectMapDiagramRelativePath(value: string): boolean {
  const normalized = value.trim().replace(/\\/g, "/");
  const match = normalized.match(/^diagrams\/([^/]+)\.md$/);
  return Boolean(match?.[1] && normalizeProjectMapPathSegment(match[1], "diagram") === match[1]);
}
