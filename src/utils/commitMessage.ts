import type {
  CommitMessageEngine,
  CommitMessageLanguage,
} from "../services/tauri";
import { normalizeEngineForExecution } from "./engineExecutionPolicy";

const LAST_COMMIT_MESSAGE_CONFIG_KEY = "doge.git.lastCommitMessageConfig";
const COMMIT_MESSAGE_ENGINES: readonly CommitMessageEngine[] = [
  "claude",
  "codex",
  "gemini",
  "grok",
  "kimi",
  "opencode",
];
const COMMIT_MESSAGE_LANGUAGES: readonly CommitMessageLanguage[] = ["zh", "en"];

export type LastCommitMessageConfig = {
  engine: CommitMessageEngine;
  language: CommitMessageLanguage;
};

export function readLastCommitMessageConfig(): LastCommitMessageConfig | null {
  try {
    const raw = window.localStorage.getItem(LAST_COMMIT_MESSAGE_CONFIG_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<LastCommitMessageConfig>;
    if (
      !COMMIT_MESSAGE_ENGINES.includes(parsed.engine as CommitMessageEngine) ||
      !COMMIT_MESSAGE_LANGUAGES.includes(parsed.language as CommitMessageLanguage)
    ) {
      return null;
    }
    return {
      engine: normalizeEngineForExecution(parsed.engine),
      language: parsed.language as CommitMessageLanguage,
    };
  } catch {
    return null;
  }
}

export function saveLastCommitMessageConfig(config: LastCommitMessageConfig): void {
  try {
    window.localStorage.setItem(
      LAST_COMMIT_MESSAGE_CONFIG_KEY,
      JSON.stringify({
        ...config,
        engine: normalizeEngineForExecution(config.engine),
      }),
    );
  } catch {
    // localStorage unavailable — the quick option simply stays disabled
  }
}

export function shouldApplyCommitMessage(
  activeWorkspaceId: string | null,
  requestWorkspaceId: string,
): boolean {
  return activeWorkspaceId === requestWorkspaceId;
}

const CONVENTIONAL_COMMIT_TITLE_PATTERN =
  /^[a-z][a-z0-9-]*(\([^)]+\))?!?\s*[:：]\s*\S+/i;

function normalizeCommitLinePrefix(line: string): string {
  return line
    .trim()
    .replace(/^[-*>\s]+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/^`+|`+$/g, "");
}

function isConventionalCommitTitle(line: string): boolean {
  const normalized = normalizeCommitLinePrefix(line);
  return CONVENTIONAL_COMMIT_TITLE_PATTERN.test(normalized);
}

function normalizeCommitTitleSeparator(line: string): string {
  const withAsciiColon = line.replace("：", ":");
  return withAsciiColon.replace(
    /^([a-z][a-z0-9-]*(\([^)]+\))?!?)\s*:\s*/i,
    "$1: ",
  );
}

function extractCommitFromText(content: string): string | null {
  const lines = content.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => isConventionalCommitTitle(line));
  if (startIndex < 0) {
    return null;
  }
  const extractedLines = lines.slice(startIndex);
  if (extractedLines.length === 0) {
    return null;
  }
  extractedLines[0] = normalizeCommitTitleSeparator(
    normalizeCommitLinePrefix(extractedLines[0] ?? ""),
  );
  while (extractedLines.length > 0) {
    const tail = extractedLines[extractedLines.length - 1]?.trim() ?? "";
    if (tail === "" || tail.startsWith("```")) {
      extractedLines.pop();
      continue;
    }
    break;
  }
  const extracted = extractedLines.join("\n").trim();
  return extracted || null;
}

function extractFencedBlocks(content: string): string[] {
  const lines = content.split(/\r?\n/);
  const blocks: string[] = [];
  let inFence = false;
  let current: string[] = [];
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("```")) {
      if (inFence) {
        blocks.push(current.join("\n"));
        current = [];
        inFence = false;
      } else {
        inFence = true;
      }
      continue;
    }
    if (inFence) {
      current.push(line);
    }
  }
  if (inFence && current.length > 0) {
    blocks.push(current.join("\n"));
  }
  return blocks;
}

export function sanitizeGeneratedCommitMessage(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }
  const fencedBlocks = extractFencedBlocks(trimmed);
  for (const block of fencedBlocks) {
    const extracted = extractCommitFromText(block);
    if (extracted) {
      return extracted;
    }
  }
  return extractCommitFromText(trimmed) ?? trimmed;
}

const CREATE_SESSION_RUNTIME_RECOVERING_ERROR_PREFIX =
  "[SESSION_CREATE_RUNTIME_RECOVERING]";

/**
 * Maps backend commit-message generation failures to i18n keys.
 * Returns null when the raw message should be shown as-is.
 */
export function resolveCommitMessageGenerationErrorKey(
  message: string,
  engine?: CommitMessageEngine,
): "git.commitMessageRequiresCodex" | "git.commitMessageRuntimeRecovering" | null {
  const raw = message.trim();
  if (!raw) {
    return null;
  }
  const normalized = raw.toLowerCase();
  const isCodexEngine = !engine || engine === "codex";
  if (
    isCodexEngine &&
    (raw.includes("requires the Codex CLI") ||
      normalized.includes("workspace not connected"))
  ) {
    return "git.commitMessageRequiresCodex";
  }
  if (
    raw.startsWith(CREATE_SESSION_RUNTIME_RECOVERING_ERROR_PREFIX) ||
    normalized.includes("broken pipe") ||
    normalized.includes("the pipe is being closed") ||
    normalized.includes("the pipe has been ended") ||
    normalized.includes("os error 32") ||
    normalized.includes("os error 109") ||
    normalized.includes("os error 232") ||
    (normalized.includes("[runtime_ended]") && normalized.includes("stopped after")) ||
    normalized.includes("manual shutdown") ||
    normalized.includes("manual_shutdown")
  ) {
    return "git.commitMessageRuntimeRecovering";
  }
  return null;
}
