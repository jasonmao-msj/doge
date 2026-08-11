const STORAGE_KEY_HASH_LENGTH = 10;

function normalizeWorkspaceIdentity(value: string): string {
  return value.replace(/\\/g, "/").toLowerCase();
}

function sanitizeProjectName(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return sanitized || "project";
}

export function hashWorkspaceIdentity(value: string): string {
  const normalized = normalizeWorkspaceIdentity(value);
  let hash = 0x811c9dc5;

  for (const byte of new TextEncoder().encode(normalized)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, "0").slice(0, STORAGE_KEY_HASH_LENGTH);
}

export function deriveProjectMapStorageKey(input: {
  projectName: string;
  workspacePath: string;
  workspaceId?: string | null;
}): string {
  const projectSlug = sanitizeProjectName(input.projectName);
  const identity = `${input.workspacePath}#${input.workspaceId ?? ""}`;
  return `${projectSlug}-${hashWorkspaceIdentity(identity)}`;
}

export function buildProjectMapRelativePath(storageKey: string, pathSegments: string[]): string {
  const safeSegments = pathSegments.map((segment) => segment.trim()).filter(Boolean);
  return [".doge", "project-map", storageKey, ...safeSegments].join("/");
}

export function isProjectMapRelativePath(path: string, storageKey: string): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/\/+/g, "/");
  const root = buildProjectMapRelativePath(storageKey, []);
  return normalized === root || normalized.startsWith(`${root}/`);
}
