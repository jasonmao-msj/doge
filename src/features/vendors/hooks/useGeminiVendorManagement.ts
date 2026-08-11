import { useCallback, useEffect, useState } from "react";
import {
  getGeminiVendorPreflight,
  getGeminiVendorSettings,
  saveGeminiVendorSettings,
  type GeminiVendorPreflightCheck,
} from "../../../services/tauri";
import {
  GEMINI_AUTH_MODES,
  type GeminiAuthMode,
  type GeminiVendorDraft,
} from "../types";

const GEMINI_ENV_KEYS = {
  baseUrl: "GOOGLE_GEMINI_BASE_URL",
  legacyBaseUrl: "GEMINI_BASE_URL",
  geminiApiKey: "GEMINI_API_KEY",
  legacyGeminiApiKey: "GOOGLE_GEMINI_API_KEY",
  googleApiKey: "GOOGLE_API_KEY",
  cloudProject: "GOOGLE_CLOUD_PROJECT",
  cloudProjectLegacy: "GOOGLE_CLOUD_PROJECT_ID",
  cloudLocation: "GOOGLE_CLOUD_LOCATION",
  applicationCredentials: "GOOGLE_APPLICATION_CREDENTIALS",
  model: "GEMINI_MODEL",
} as const;

const GEMINI_VENDOR_UPDATED_EVENT = "doge:gemini-vendor-updated";

type GeminiImportantValues = Omit<GeminiVendorDraft, "enabled" | "envText" | "authMode">;

function envMapToText(env: Record<string, string>): string {
  const entries = Object.entries(env)
    .map(([key, value]) => [key.trim(), value] as const)
    .filter(([key]) => key.length > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([key, value]) => `${key}=${value}`).join("\n");
}

function parseEnvText(envText: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const rawLine of envText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!key) {
      continue;
    }
    env[key] = value;
  }
  return env;
}

function findEnvValue(env: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const value = env[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
}

function inferGeminiAuthMode(values: GeminiImportantValues): GeminiAuthMode {
  if (values.apiBaseUrl.trim()) return "custom";
  if (values.geminiApiKey.trim()) return "gemini_api_key";
  if (values.googleApiKey.trim()) return "vertex_api_key";
  if (values.googleApplicationCredentials.trim()) return "vertex_service_account";
  if (values.googleCloudProject.trim() || values.googleCloudLocation.trim()) {
    return "vertex_adc";
  }
  return "login_google";
}

function extractGeminiImportantValues(env: Record<string, string>): GeminiImportantValues {
  return {
    apiBaseUrl: findEnvValue(env, [GEMINI_ENV_KEYS.baseUrl, GEMINI_ENV_KEYS.legacyBaseUrl]),
    geminiApiKey: findEnvValue(env, [
      GEMINI_ENV_KEYS.geminiApiKey,
      GEMINI_ENV_KEYS.legacyGeminiApiKey,
    ]),
    googleApiKey: findEnvValue(env, [GEMINI_ENV_KEYS.googleApiKey]),
    googleCloudProject: findEnvValue(env, [
      GEMINI_ENV_KEYS.cloudProject,
      GEMINI_ENV_KEYS.cloudProjectLegacy,
    ]),
    googleCloudLocation: findEnvValue(env, [GEMINI_ENV_KEYS.cloudLocation]),
    googleApplicationCredentials: findEnvValue(env, [GEMINI_ENV_KEYS.applicationCredentials]),
    model: findEnvValue(env, [GEMINI_ENV_KEYS.model]),
  };
}

function normalizeGeminiAuthMode(
  rawMode: string | null | undefined,
  fallbackValues: GeminiImportantValues,
): GeminiAuthMode {
  if (rawMode && GEMINI_AUTH_MODES.includes(rawMode as GeminiAuthMode)) {
    return rawMode as GeminiAuthMode;
  }
  return inferGeminiAuthMode(fallbackValues);
}

function syncGeminiEnvText(draft: GeminiVendorDraft): string {
  const env = parseEnvText(draft.envText);
  const assignOrDelete = (key: string, value: string) => {
    const normalized = value.trim();
    if (!normalized) {
      delete env[key];
      return;
    }
    env[key] = normalized;
  };

  assignOrDelete(GEMINI_ENV_KEYS.baseUrl, draft.apiBaseUrl);
  delete env[GEMINI_ENV_KEYS.legacyBaseUrl];
  assignOrDelete(GEMINI_ENV_KEYS.geminiApiKey, draft.geminiApiKey);
  delete env[GEMINI_ENV_KEYS.legacyGeminiApiKey];
  assignOrDelete(GEMINI_ENV_KEYS.googleApiKey, draft.googleApiKey);
  assignOrDelete(GEMINI_ENV_KEYS.cloudProject, draft.googleCloudProject);
  delete env[GEMINI_ENV_KEYS.cloudProjectLegacy];
  assignOrDelete(GEMINI_ENV_KEYS.cloudLocation, draft.googleCloudLocation);
  assignOrDelete(
    GEMINI_ENV_KEYS.applicationCredentials,
    draft.googleApplicationCredentials,
  );
  assignOrDelete(GEMINI_ENV_KEYS.model, draft.model);

  return envMapToText(env);
}

function patchGeminiAuthMode(
  draft: GeminiVendorDraft,
  mode: GeminiAuthMode,
): GeminiVendorDraft {
  const next: GeminiVendorDraft = {
    ...draft,
    authMode: mode,
  };

  if (mode === "login_google") {
    next.apiBaseUrl = "";
    next.geminiApiKey = "";
    next.googleApiKey = "";
    next.googleCloudProject = "";
    next.googleCloudLocation = "";
    next.googleApplicationCredentials = "";
  } else if (mode === "custom") {
    next.googleApiKey = "";
    next.googleCloudProject = "";
    next.googleCloudLocation = "";
    next.googleApplicationCredentials = "";
  } else if (mode === "gemini_api_key") {
    next.apiBaseUrl = "";
    next.googleApiKey = "";
    next.googleCloudProject = "";
    next.googleCloudLocation = "";
    next.googleApplicationCredentials = "";
  } else if (mode === "vertex_api_key") {
    next.apiBaseUrl = "";
    next.geminiApiKey = "";
    next.googleApplicationCredentials = "";
  } else if (mode === "vertex_service_account") {
    next.apiBaseUrl = "";
    next.geminiApiKey = "";
    next.googleApiKey = "";
  } else {
    next.apiBaseUrl = "";
    next.geminiApiKey = "";
    next.googleApiKey = "";
    next.googleApplicationCredentials = "";
  }

  next.envText = syncGeminiEnvText(next);
  return next;
}

const DEFAULT_DRAFT: GeminiVendorDraft = {
  enabled: true,
  envText: "",
  authMode: "login_google",
  apiBaseUrl: "",
  geminiApiKey: "",
  googleApiKey: "",
  googleCloudProject: "",
  googleCloudLocation: "",
  googleApplicationCredentials: "",
  model: "",
};

type GeminiFieldKey = keyof GeminiImportantValues;

export function useGeminiVendorManagement() {
  const [draft, setDraft] = useState<GeminiVendorDraft>(DEFAULT_DRAFT);
  const [preflightChecks, setPreflightChecks] = useState<GeminiVendorPreflightCheck[]>([]);
  const [loading, setLoading] = useState(false);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [savingEnv, setSavingEnv] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const settings = await getGeminiVendorSettings();
      const envMap = settings?.env ?? {};
      const importantValues = extractGeminiImportantValues(envMap);
      const authMode = normalizeGeminiAuthMode(settings?.authMode, importantValues);
      setDraft({
        enabled: settings?.enabled ?? true,
        envText: envMapToText(envMap),
        authMode,
        ...importantValues,
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshPreflight = useCallback(async () => {
    setPreflightLoading(true);
    setError(null);
    try {
      const result = await getGeminiVendorPreflight();
      setPreflightChecks(result?.checks ?? []);
    } catch (checkError) {
      setError(checkError instanceof Error ? checkError.message : String(checkError));
      setPreflightChecks([]);
    } finally {
      setPreflightLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
    void refreshPreflight();
  }, [loadSettings, refreshPreflight]);

  const persist = useCallback(async (nextDraft: GeminiVendorDraft) => {
    await saveGeminiVendorSettings({
      enabled: nextDraft.enabled,
      authMode: nextDraft.authMode,
      env: parseEnvText(nextDraft.envText),
    });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(GEMINI_VENDOR_UPDATED_EVENT));
    }
    setSavedAt(Date.now());
  }, []);

  const handleDraftEnvTextChange = (value: string) => {
    setDraft((current) => ({ ...current, envText: value }));
  };

  const handleSaveEnv = async () => {
    setSavingEnv(true);
    setError(null);
    try {
      await persist(draft);
      const envMap = parseEnvText(draft.envText);
      const important = extractGeminiImportantValues(envMap);
      setDraft((current) => ({
        ...current,
        ...important,
        authMode: normalizeGeminiAuthMode(current.authMode, important),
        envText: envMapToText(envMap),
      }));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSavingEnv(false);
    }
  };

  const handleGeminiAuthModeChange = (mode: GeminiAuthMode) => {
    setDraft((current) => patchGeminiAuthMode(current, mode));
  };

  const handleEnabledChange = (enabled: boolean) => {
    setDraft((current) => ({ ...current, enabled }));
  };

  const handleGeminiFieldChange = (field: GeminiFieldKey, value: string) => {
    setDraft((current) => {
      const nextDraft: GeminiVendorDraft = {
        ...current,
        [field]: value,
      };
      nextDraft.envText = syncGeminiEnvText(nextDraft);
      return nextDraft;
    });
  };

  const handleSaveConfig = async () => {
    setSavingConfig(true);
    setError(null);
    const nextDraft = {
      ...draft,
      envText: syncGeminiEnvText(draft),
    };
    setDraft(nextDraft);
    try {
      await persist(nextDraft);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSavingConfig(false);
    }
  };

  return {
    draft,
    preflightChecks,
    loading,
    preflightLoading,
    savingEnv,
    savingConfig,
    showKey,
    error,
    savedAt,
    setShowKey,
    setDraft,
    loadSettings,
    refreshPreflight,
    handleDraftEnvTextChange,
    handleSaveEnv,
    handleEnabledChange,
    handleGeminiAuthModeChange,
    handleGeminiFieldChange,
    handleSaveConfig,
  };
}

export type UseGeminiVendorManagementReturn = ReturnType<
  typeof useGeminiVendorManagement
>;
