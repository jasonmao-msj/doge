import { useTranslation } from "react-i18next";

import type { EngineType } from "../../../types";
import type { ExecutionTarget } from "../../shared-session/target/types";
import type { KanbanTaskTargetCatalog } from "../utils/taskTargetCatalog";
import { findKanbanTaskTargetModel } from "../utils/taskTargetCatalog";

type TaskTargetSelectorsProps = {
  readonly catalog: KanbanTaskTargetCatalog;
  readonly engineType: EngineType;
  readonly modelId: string | null;
  readonly executionTarget: ExecutionTarget | null;
  readonly onChange: (selection: {
    readonly engineType: EngineType;
    readonly modelId: string | null;
    readonly executionTarget: ExecutionTarget | null;
  }) => void;
};

export function TaskTargetSelectors({
  catalog,
  engineType,
  modelId,
  executionTarget,
  onChange,
}: TaskTargetSelectorsProps) {
  const { t } = useTranslation();
  const selectedEngine = catalog.engines.find(
    (engine) => engine.id === engineType,
  );
  const availableModels = selectedEngine?.models ?? [];

  return (
    <>
      <div className="kanban-task-selector">
        <select
          className="kanban-select"
          value={engineType}
          onChange={(event) => {
            const nextEngineType = event.target.value as EngineType;
            const nextEngine = catalog.engines.find(
              (engine) => engine.id === nextEngineType,
            );
            const nextModel = findKanbanTaskTargetModel({
              engine: nextEngine,
              target: executionTarget,
              legacyModelId: modelId,
            }) ?? nextEngine?.models[0] ?? null;
            onChange({
              engineType: nextEngineType,
              modelId: nextModel?.id ?? null,
              executionTarget: nextModel?.target ?? null,
            });
          }}
        >
          {catalog.engines.map((engine) => (
            <option
              key={engine.id}
              value={engine.id}
              disabled={!engine.selectable}
            >
              {engine.displayName}
              {engine.unavailableReason === "not-installed"
                ? ` (${t("kanban.task.notInstalled")})`
                : engine.unavailableReason === "no-models"
                  ? ` (${t("kanban.task.noModels")})`
                  : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="kanban-task-selector">
        <select
          className="kanban-select"
          value={modelId ?? ""}
          onChange={(event) => {
            const nextModel = availableModels.find(
              (model) => model.id === event.target.value,
            ) ?? null;
            onChange({
              engineType,
              modelId: nextModel?.id ?? null,
              executionTarget: nextModel?.target ?? null,
            });
          }}
        >
          {availableModels.map((model) => (
            <option key={model.id} value={model.id}>
              {model.displayName}
            </option>
          ))}
          {availableModels.length === 0 ? (
            <option value="">{t("kanban.task.noModels")}</option>
          ) : null}
        </select>
      </div>
    </>
  );
}

