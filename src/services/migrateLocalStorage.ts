import { writeClientStoreData, getClientStoreFullSync } from "./clientStorage";

const FILE_STORE_MIGRATION_FLAG = "doge.clientStorageMigrated";
const PREFIX_MIGRATION_FLAG = "doge.localStoragePrefixMigrated";
const LEGACY_FILE_STORE_MIGRATION_FLAGS = [
  "ccgui.clientStorageMigrated",
  "mossx.clientStorageMigrated",
];
const LEGACY_LOCAL_STORAGE_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ["ccgui.", "doge."],
  ["mossx.", "doge."],
  ["ccgui:", "doge:"],
  ["codemoss:", "doge:"],
];

function readLocalNum(key: string): number | undefined {
  const raw = localStorage.getItem(key);
  if (raw === null) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function readLocalBool(key: string): boolean | undefined {
  const raw = localStorage.getItem(key);
  if (raw === null) return undefined;
  return raw === "true";
}

function readLocalJson<T>(key: string): T | undefined {
  const raw = localStorage.getItem(key);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function readLocalString(key: string): string | undefined {
  const raw = localStorage.getItem(key);
  return raw ?? undefined;
}

function collectPromptHistories(): Record<string, string[]> {
  const prefix = "doge.promptHistory.";
  const result: Record<string, string[]> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(prefix)) continue;
    const historyKey = key.slice(prefix.length);
    const data = readLocalJson<string[]>(key);
    if (Array.isArray(data)) {
      result[historyKey] = data.filter((v) => typeof v === "string");
    }
  }
  return result;
}

function migrateLegacyLocalStoragePrefixes(): void {
  try {
    if (localStorage.getItem(PREFIX_MIGRATION_FLAG) === "true") {
      return;
    }
  } catch {
    return;
  }

  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key) {
      keys.push(key);
    }
  }

  for (const [legacyPrefix, nextPrefix] of LEGACY_LOCAL_STORAGE_PREFIXES) {
    for (const key of keys) {
      if (!key.startsWith(legacyPrefix)) {
        continue;
      }
      const raw = localStorage.getItem(key);
      if (raw == null) {
        continue;
      }
      const nextKey = `${nextPrefix}${key.slice(legacyPrefix.length)}`;
      if (localStorage.getItem(nextKey) == null) {
        localStorage.setItem(nextKey, raw);
      }
    }
  }

  try {
    localStorage.setItem(PREFIX_MIGRATION_FLAG, "true");
  } catch {
    // best effort
  }
}

function hasCompletedFileStoreMigration(): boolean {
  if (localStorage.getItem(FILE_STORE_MIGRATION_FLAG) === "true") {
    return true;
  }
  return LEGACY_FILE_STORE_MIGRATION_FLAGS.some((flag) => localStorage.getItem(flag) === "true");
}

export function migrateLocalStorageToFileStore(): void {
  migrateLegacyLocalStoragePrefixes();

  try {
    if (hasCompletedFileStoreMigration()) {
      return;
    }
  } catch {
    return;
  }

  const existingLayout = getClientStoreFullSync("layout");
  if (existingLayout && Object.keys(existingLayout).length > 0) {
    try {
      localStorage.setItem(FILE_STORE_MIGRATION_FLAG, "true");
    } catch {
      // best effort
    }
    return;
  }

  // --- layout ---
  const layout: Record<string, unknown> = {};
  const layoutNumKeys: [string, string][] = [
    ["doge.sidebarWidth", "sidebarWidth"],
    ["doge.rightPanelWidth", "rightPanelWidth"],
    ["doge.planPanelHeight", "planPanelHeight"],
    ["doge.terminalPanelHeight", "terminalPanelHeight"],
    ["doge.debugPanelHeight", "debugPanelHeight"],
    ["doge.kanbanConversationWidth", "kanbanConversationWidth"],
  ];
  for (const [localKey, jsonKey] of layoutNumKeys) {
    const v = readLocalNum(localKey);
    if (v !== undefined) layout[jsonKey] = v;
  }
  const layoutBoolKeys: [string, string][] = [
    ["doge.sidebarCollapsed", "sidebarCollapsed"],
    ["doge.rightPanelCollapsed", "rightPanelCollapsed"],
    ["reduceTransparency", "reduceTransparency"],
  ];
  for (const [localKey, jsonKey] of layoutBoolKeys) {
    const v = readLocalBool(localKey);
    if (v !== undefined) layout[jsonKey] = v;
  }
  const collapsedGroups = readLocalJson<string[]>("doge.collapsedGroups");
  if (collapsedGroups) layout.collapsedGroups = collapsedGroups;

  if (Object.keys(layout).length > 0) {
    writeClientStoreData("layout", layout);
  }

  // --- composer ---
  const composer: Record<string, unknown> = {};
  const textareaHeight = readLocalNum("composerTextareaHeight");
  if (textareaHeight !== undefined) composer.textareaHeight = textareaHeight;
  const promptHistories = collectPromptHistories();
  if (Object.keys(promptHistories).length > 0) {
    composer.promptHistory = promptHistories;
  }
  if (Object.keys(composer).length > 0) {
    writeClientStoreData("composer", composer);
  }

  // --- threads ---
  const threads: Record<string, unknown> = {};
  const threadKeys: [string, string][] = [
    ["doge.threadLastUserActivity", "lastUserActivity"],
    ["doge.threadCustomNames", "customNames"],
    ["doge.threadAutoTitlePending", "autoTitlePending"],
    ["doge.pinnedThreads", "pinnedThreads"],
  ];
  for (const [localKey, jsonKey] of threadKeys) {
    const v = readLocalJson(localKey);
    if (v !== undefined) threads[jsonKey] = v;
  }
  if (Object.keys(threads).length > 0) {
    writeClientStoreData("threads", threads);
  }

  // --- app ---
  const app: Record<string, unknown> = {};
  const language = readLocalString("doge.language");
  if (language) app.language = language;
  const openApp = readLocalString("open-workspace-app");
  if (openApp) app.openWorkspaceApp = openApp;
  const kanban = readLocalJson("doge.kanban");
  if (kanban) app.kanban = kanban;
  if (Object.keys(app).length > 0) {
    writeClientStoreData("app", app);
  }

  try {
    localStorage.setItem(FILE_STORE_MIGRATION_FLAG, "true");
  } catch {
    // best effort
  }
}
