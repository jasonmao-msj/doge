import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import RefreshCcw from "lucide-react/dist/esm/icons/refresh-ccw";
import Sparkles from "lucide-react/dist/esm/icons/sparkles";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";

import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../../../components/ui/alert-dialog";
import type { EngineType, WorkspaceInfo } from "../../../types";
import {
  normalizeEngineType,
  useProjectMapGenerationOptions,
} from "../hooks/useProjectMapGenerationOptions";
import type {
  ProjectMapGenerationRequest,
  ProjectMapNode,
  ProjectMapStorageLocation,
} from "../types";
import { ProjectMapSourceChip } from "./ProjectMapTraceChips";

function normalizePathForComparing(value: string): string {
  return value.replace(/[\\/]+$/g, "").replace(/\\/g, "/");
}

function resolveGenerationWritePath(
  workspacePath: string | null,
  storageKey: string,
  storageLocation: ProjectMapStorageLocation,
  writePath: string,
): string {
  if (storageLocation === "project" && workspacePath) {
    const pathSeparator = workspacePath.includes("\\") ? "\\" : "/";
    const trimmedWorkspacePath = workspacePath.replace(/[\\/]+$/g, "");
    return `${trimmedWorkspacePath}${pathSeparator}.doge${pathSeparator}project-map${pathSeparator}${storageKey}`;
  }

  if (storageLocation === "global" && workspacePath) {
    const expected = normalizePathForComparing(
      `${workspacePath.replace(/[\\/]+$/g, "")}/.doge/project-map/${storageKey}`,
    );
    const normalized = normalizePathForComparing(writePath);
    const isCaseInsensitive = typeof process !== "undefined" && process.platform === "win32";
    if (isCaseInsensitive ? normalized.toLowerCase() === expected.toLowerCase() : normalized === expected) {
      return `.doge/project-map/${storageKey}`;
    }
  }

  return writePath;
}

export function DeleteNodeConfirmDialog({
  node,
  onCancel,
  onConfirm,
}: {
  node: ProjectMapNode | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const isOpen = Boolean(node);

  return (
    <AlertDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          onCancel();
        }
      }}
    >
      <AlertDialogPopup className="project-map-delete-dialog" bottomStickOnMobile={false}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("projectMap.confirmDeleteNodeTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("projectMap.confirmDeleteNode", { title: node?.title ?? "" })}
          </AlertDialogDescription>
          <p className="project-map-delete-dialog-warning">
            {t("projectMap.confirmDeleteNodeWarning")}
          </p>
        </AlertDialogHeader>
        <AlertDialogFooter className="project-map-delete-dialog-footer">
          <button className="project-map-delete-dialog-secondary" type="button" onClick={onCancel}>
            {t("projectMap.confirmDeleteNodeCancel")}
          </button>
          <button className="project-map-delete-dialog-danger" type="button" onClick={onConfirm}>
            <Trash2 aria-hidden />
            {t("projectMap.confirmDeleteNodeConfirm")}
          </button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

export function GenerationConfirmationDialog({
  activeWorkspace,
  request,
  storageKey,
  onCancel,
  onConfirm,
}: {
  activeWorkspace: WorkspaceInfo | null;
  request: ProjectMapGenerationRequest | null;
  storageKey: string;
  onCancel: () => void;
  onConfirm: (requestOverride?: ProjectMapGenerationRequest) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [isConfirming, setIsConfirming] = useState(false);
  const [selectedEngine, setSelectedEngine] = useState<EngineType>(() =>
    normalizeEngineType(request?.engine),
  );
  const [selectedModel, setSelectedModel] = useState(request?.model ?? "default");
  const [selectedStorageLocation, setSelectedStorageLocation] =
    useState<ProjectMapStorageLocation>(() => request?.storageLocation ?? "global");
  const generationOptions = useProjectMapGenerationOptions({
    workspace: activeWorkspace,
    selectedEngine,
  });
  const isOrganizerRequest = request?.generationIntent === "organizeUnassigned";

  useEffect(() => {
    if (!request) {
      return;
    }
    setSelectedEngine(normalizeEngineType(request.engine));
    setSelectedModel(request.model);
    setSelectedStorageLocation(request.storageLocation);
    setIsConfirming(false);
  }, [request]);

  useEffect(() => {
    if (!request || generationOptions.modelsLoading) {
      return;
    }
    if (generationOptions.models.length === 0) {
      setSelectedModel("");
      return;
    }
    const selectedModelStillExists = generationOptions.models.some(
      (model) => model.model === selectedModel || model.id === selectedModel,
    );
    if (selectedModelStillExists) {
      return;
    }
    const defaultModel =
      generationOptions.models.find((model) => model.isDefault) ?? generationOptions.models[0];
    setSelectedModel(defaultModel?.model ?? "");
  }, [generationOptions.models, generationOptions.modelsLoading, request, selectedModel]);

  if (!request) {
    return null;
  }

  const selectedModelOption =
    generationOptions.models.find((model) => model.model === selectedModel) ??
    generationOptions.models.find((model) => model.id === selectedModel) ??
    null;
  const resolvedWritePath = request
    ? resolveGenerationWritePath(
        activeWorkspace?.path ?? null,
        storageKey,
        selectedStorageLocation,
        request.writePath,
      )
    : "";
  const canConfirm =
    !isConfirming &&
    !generationOptions.modelsLoading &&
    generationOptions.models.length > 0 &&
    Boolean(selectedModelOption);
  const confirmedRequest: ProjectMapGenerationRequest = {
    ...request,
    engine: selectedEngine,
    model: selectedModelOption?.model ?? selectedModel.trim(),
    storageLocation: selectedStorageLocation,
    writePath: resolvedWritePath,
  };

  return (
    <div className="project-map-dialog-backdrop" role="presentation">
      <section
        className="project-map-dialog project-map-confirmation-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("projectMap.confirmation.title")}
      >
        <header>
          <h3>
            {t(
              isOrganizerRequest
                ? "projectMap.confirmation.organizerTitle"
                : "projectMap.confirmation.title",
            )}
          </h3>
          <p>
            {t(
              isOrganizerRequest
                ? "projectMap.confirmation.organizerSubtitle"
                : "projectMap.confirmation.subtitle",
            )}
          </p>
        </header>
        <dl className="project-map-definition-grid project-map-confirmation-grid">
          <div className="project-map-confirmation-row">
            <dt>{t("projectMap.confirmation.engine")}</dt>
            <dd>
              <select
                className="project-map-dialog-control"
                value={selectedEngine}
                aria-label={t("projectMap.confirmation.engine")}
                onChange={(event) => setSelectedEngine(normalizeEngineType(event.currentTarget.value))}
              >
                {generationOptions.engines.map((engine) => (
                  <option key={engine.id} value={engine.id} disabled={!engine.installed}>
                    {engine.label}
                  </option>
                ))}
              </select>
              {generationOptions.enginesLoading ? (
                <span className="project-map-dialog-hint">{t("projectMap.confirmation.loadingEngines")}</span>
              ) : null}
              {generationOptions.enginesError ? (
                <span className="project-map-dialog-warning">{generationOptions.enginesError}</span>
              ) : null}
            </dd>
          </div>
          <div className="project-map-confirmation-row">
            <dt>{t("projectMap.confirmation.model")}</dt>
            <dd>
              <div className="project-map-confirmation-model-row">
                <select
                  className="project-map-dialog-control"
                  value={selectedModel}
                  aria-label={t("projectMap.confirmation.model")}
                  onChange={(event) => setSelectedModel(event.currentTarget.value)}
                  disabled={generationOptions.modelsLoading || generationOptions.models.length === 0}
                >
                  {generationOptions.models.map((model) => (
                    <option key={`${model.id}-${model.model}`} value={model.model}>
                      {model.displayName}
                    </option>
                  ))}
                </select>
                <button
                  className="project-map-dialog-refresh project-map-dialog-refresh-inline"
                  type="button"
                  onClick={() => void generationOptions.refreshModels()}
                  disabled={generationOptions.modelsLoading}
                >
                  <RefreshCcw aria-hidden />
                  <span>{t("projectMap.confirmation.refreshModels")}</span>
                </button>
              </div>
              {generationOptions.modelsLoading ? (
                <span className="project-map-dialog-hint">{t("projectMap.confirmation.loadingModels")}</span>
              ) : null}
              {!generationOptions.modelsLoading && generationOptions.models.length === 0 ? (
                <span className="project-map-dialog-warning">
                  {generationOptions.modelsError ?? t("projectMap.confirmation.noModels")}
                </span>
              ) : null}
            </dd>
          </div>
          <div className="project-map-confirmation-row">
            <dt>{t("projectMap.confirmation.scope")}</dt>
            <dd>
              {request.scope.kind === "organizer"
                ? t("projectMap.confirmation.organizerScope", {
                    count: request.scope.unassignedCount,
                  })
                : request.scope.kind}
            </dd>
          </div>
          <div className="project-map-confirmation-row">
            <dt>{t("projectMap.confirmation.storageLocation")}</dt>
            <dd className="project-map-confirmation-radio-group">
              <label>
                <input
                  type="radio"
                  name="projectMapStorageLocation"
                  value="global"
                  checked={selectedStorageLocation === "global"}
                  onChange={() => setSelectedStorageLocation("global")}
                />
                {t("projectMap.confirmation.storageLocationGlobal")}
              </label>
              <label>
                <input
                  type="radio"
                  name="projectMapStorageLocation"
                  value="project"
                  checked={selectedStorageLocation === "project"}
                  onChange={() => setSelectedStorageLocation("project")}
                />
                {t("projectMap.confirmation.storageLocationProject")}
              </label>
            </dd>
          </div>
          <div className="project-map-confirmation-row">
            <dt>{t("projectMap.confirmation.writePath")}</dt>
            <dd>
              <code className="project-map-confirmation-path">{resolvedWritePath}</code>
            </dd>
          </div>
        </dl>
        <section className="project-map-confirmation-sources">
          <h4>{t("projectMap.confirmation.readSources")}</h4>
          <div className="project-map-source-list">
            {request.readSources.slice(0, 8).map((source) => (
              <ProjectMapSourceChip
                key={`${source.type}-${source.label}-${source.path ?? source.hash ?? ""}`}
                source={source}
              />
            ))}
            {request.readSources.length === 0 ? (
              <span className="project-map-dialog-hint">
                {t("projectMap.confirmation.noReadSources")}
              </span>
            ) : null}
          </div>
        </section>
        <footer>
          <button type="button" onClick={onCancel} disabled={isConfirming}>
            {t("projectMap.confirmation.cancel")}
          </button>
          <button
            className="project-map-primary-button"
            type="button"
            disabled={!canConfirm}
            onClick={() => {
              setIsConfirming(true);
              void onConfirm(confirmedRequest).finally(() => setIsConfirming(false));
            }}
          >
            <Sparkles aria-hidden />
            {isConfirming
              ? t(
                  isOrganizerRequest
                    ? "projectMap.confirmation.organizerConfirming"
                    : "projectMap.confirmation.confirming",
                )
              : t(
                  isOrganizerRequest
                    ? "projectMap.confirmation.organizerConfirm"
                    : "projectMap.confirmation.confirm",
                )}
          </button>
        </footer>
      </section>
    </div>
  );
}
