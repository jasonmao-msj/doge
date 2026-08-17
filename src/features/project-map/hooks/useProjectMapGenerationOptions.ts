import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CODEX_MODEL_CATALOG } from "../../models/codexModelCatalog";
import { detectEngines, getConfigModel, getEngineModels, getModelList } from "../../../services/tauri";
import type { EngineModelInfo, EngineStatus, EngineType, WorkspaceInfo } from "../../../types";
import { normalizeEngineForExecution } from "../../../utils/engineExecutionPolicy";

export type ProjectMapGenerationEngineOption = {
  id: EngineType;
  label: string;
  installed: boolean;
  error: string | null;
};

export type ProjectMapGenerationModelOption = {
  id: string;
  model: string;
  displayName: string;
  description: string;
  source: string;
  isDefault: boolean;
};

type UseProjectMapGenerationOptionsInput = {
  workspace: WorkspaceInfo | null;
  selectedEngine: EngineType;
};

const ENGINE_LABELS: Record<EngineType, string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
  grok: "Grok",
  kimi: "Kimi",
  opencode: "OpenCode",
};

const KNOWN_ENGINES: EngineType[] = ["codex", "claude", "grok", "kimi", "opencode"];

const NO_WORKSPACE_MODEL: ProjectMapGenerationModelOption = {
  id: "default",
  model: "default",
  displayName: "default",
  description: "",
  source: "local",
  isDefault: true,
};

const CODEX_FALLBACK_MODELS: ProjectMapGenerationModelOption[] = CODEX_MODEL_CATALOG.map(
  (model, index) => ({
    id: model.id,
    model: model.id,
    displayName: model.label,
    description: model.description,
    source: "codex-fallback",
    isDefault: index === 0,
  }),
);

function normalizeEngineType(value: string | null | undefined): EngineType {
  return normalizeEngineForExecution(value);
}

function normalizeEngineModel(model: EngineModelInfo): ProjectMapGenerationModelOption | null {
  const id = model.id?.trim();
  const runtimeModel = model.model?.trim() || id;
  if (!id || !runtimeModel) {
    return null;
  }
  return {
    id,
    model: runtimeModel,
    displayName: model.displayName?.trim() || runtimeModel,
    description: model.description?.trim() ?? "",
    source: model.source?.trim() || "engine",
    isDefault: Boolean(model.isDefault),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeCodexModelRecord(value: unknown): ProjectMapGenerationModelOption | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = String(value.id ?? value.model ?? "").trim();
  const model = String(value.model ?? value.id ?? "").trim();
  if (!id || !model) {
    return null;
  }
  return {
    id,
    model,
    displayName: String(value.displayName ?? value.display_name ?? model).trim() || model,
    description: String(value.description ?? "").trim(),
    source: String(value.source ?? "codex").trim() || "codex",
    isDefault: Boolean(value.isDefault ?? value.is_default ?? false),
  };
}

function mergeModelOptions(
  modelGroups: Array<Array<ProjectMapGenerationModelOption | null>>,
): ProjectMapGenerationModelOption[] {
  const merged: ProjectMapGenerationModelOption[] = [];
  const seen = new Set<string>();
  for (const model of modelGroups.flat()) {
    if (!model) {
      continue;
    }
    const identity = model.model.trim().toLowerCase();
    if (!identity || seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    merged.push(model);
  }
  return merged.sort((left, right) => Number(right.isDefault) - Number(left.isDefault));
}

function resolveCodexModelOptions(
  modelGroups: Array<Array<ProjectMapGenerationModelOption | null>>,
): ProjectMapGenerationModelOption[] {
  const dynamicModels = mergeModelOptions(modelGroups);
  return dynamicModels.length > 0 ? dynamicModels : CODEX_FALLBACK_MODELS;
}

function buildEngineOptions(statuses: EngineStatus[]): ProjectMapGenerationEngineOption[] {
  return KNOWN_ENGINES.map((engine) => {
    const status = statuses.find((entry) => entry.engineType === engine);
    return {
      id: engine,
      label: ENGINE_LABELS[engine],
      installed: Boolean(status?.installed),
      error: status?.error ?? null,
    };
  });
}

function defaultEngineOptions(): ProjectMapGenerationEngineOption[] {
  return KNOWN_ENGINES.map((engine) => ({
    id: engine,
    label: ENGINE_LABELS[engine],
    installed: engine === "codex",
    error: engine === "codex" ? null : "Engine detection unavailable",
  }));
}

async function loadCodexModels(workspaceId: string): Promise<ProjectMapGenerationModelOption[]> {
  const [engineModelsResult, modelListResult, configModelResult] = await Promise.allSettled([
    getEngineModels("codex"),
    getModelList(workspaceId),
    getConfigModel(workspaceId),
  ]);
  const engineModels =
    engineModelsResult.status === "fulfilled"
      ? engineModelsResult.value.map(normalizeEngineModel)
      : [];
  const response = modelListResult.status === "fulfilled" ? modelListResult.value : null;
  const rawData = response?.result?.data ?? response?.data ?? [];
  const catalogModels = Array.isArray(rawData) ? rawData.map(normalizeCodexModelRecord) : [];
  const configModel =
    configModelResult.status === "fulfilled" && configModelResult.value
      ? {
          id: configModelResult.value,
          model: configModelResult.value,
          displayName: `${configModelResult.value} (config)`,
          description: "Configured in CODEX_HOME/config.toml",
          source: "settings-override",
          isDefault: true,
        }
      : null;
  return resolveCodexModelOptions([engineModels, [configModel], catalogModels]);
}

async function loadEngineModelOptions(
  engine: EngineType,
  workspaceId: string,
): Promise<ProjectMapGenerationModelOption[]> {
  if (engine === "codex") {
    return loadCodexModels(workspaceId);
  }
  const models = await getEngineModels(engine);
  return mergeModelOptions([models.map(normalizeEngineModel)]);
}

export function useProjectMapGenerationOptions({
  workspace,
  selectedEngine,
}: UseProjectMapGenerationOptionsInput) {
  const workspaceId = workspace?.id ?? null;
  const [engines, setEngines] = useState<ProjectMapGenerationEngineOption[]>(() =>
    workspaceId ? defaultEngineOptions() : [
      {
        id: normalizeEngineType(selectedEngine),
        label: ENGINE_LABELS[normalizeEngineType(selectedEngine)],
        installed: true,
        error: null,
      },
    ],
  );
  const [enginesLoading, setEnginesLoading] = useState(Boolean(workspaceId));
  const [enginesError, setEnginesError] = useState<string | null>(null);
  const [models, setModels] = useState<ProjectMapGenerationModelOption[]>(() =>
    workspaceId ? [] : [NO_WORKSPACE_MODEL],
  );
  const [modelsLoading, setModelsLoading] = useState(Boolean(workspaceId));
  const [modelsError, setModelsError] = useState<string | null>(null);
  const requestSequenceRef = useRef(0);

  useEffect(() => {
    if (!workspaceId) {
      const engine = normalizeEngineType(selectedEngine);
      setEngines([{ id: engine, label: ENGINE_LABELS[engine], installed: true, error: null }]);
      setEnginesLoading(false);
      setEnginesError(null);
      return;
    }

    let cancelled = false;
    setEnginesLoading(true);
    setEnginesError(null);
    void detectEngines()
      .then((statuses) => {
        if (cancelled) {
          return;
        }
        setEngines(buildEngineOptions(statuses));
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setEngines(defaultEngineOptions());
        setEnginesError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) {
          setEnginesLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedEngine, workspaceId]);

  const refreshModels = useCallback(async () => {
    const engine = normalizeEngineType(selectedEngine);
    const requestSequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestSequence;

    if (!workspaceId) {
      setModels([NO_WORKSPACE_MODEL]);
      setModelsLoading(false);
      setModelsError(null);
      return;
    }

    setModelsLoading(true);
    setModelsError(null);
    try {
      const nextModels = await loadEngineModelOptions(engine, workspaceId);
      if (requestSequenceRef.current !== requestSequence) {
        return;
      }
      setModels(nextModels);
    } catch (error) {
      if (requestSequenceRef.current !== requestSequence) {
        return;
      }
      setModels([]);
      setModelsError(error instanceof Error ? error.message : String(error));
    } finally {
      if (requestSequenceRef.current === requestSequence) {
        setModelsLoading(false);
      }
    }
  }, [selectedEngine, workspaceId]);

  useEffect(() => {
    void refreshModels();
  }, [refreshModels]);

  const installedEngines = useMemo(
    () => engines.filter((engine) => engine.installed),
    [engines],
  );

  return {
    engines,
    installedEngines,
    enginesLoading,
    enginesError,
    models,
    modelsLoading,
    modelsError,
    refreshModels,
  };
}

export { normalizeEngineType };
