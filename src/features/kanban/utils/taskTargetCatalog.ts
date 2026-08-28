import type {
  EngineStatus,
  EngineType,
  ModelOption,
} from "../../../types";
import type { ProductTargetCatalogV1 } from "../../account/runtime/productTargetCatalog";
import { MANAGED_PROVIDER_PROFILE_ID_V1 } from "../../account/runtime/engineEntitlementStore";
import { PRODUCT_MANAGED_PROVIDER_LABEL } from "../../account/runtime/productExecutionTarget";
import { getEngineRegistryEntry } from "../../engine/engineRegistry";
import type { ExecutionTarget } from "../../shared-session/target/types";
import { LOCAL_PROVIDER_LABEL } from "../../../utils/turnBadge";

export type KanbanTaskTargetModelOption = {
  readonly id: string;
  readonly displayName: string;
  readonly target: ExecutionTarget;
};

export type KanbanTaskTargetEngineOption = {
  readonly id: EngineType;
  readonly displayName: string;
  readonly selectable: boolean;
  readonly unavailableReason: "not-installed" | "no-models" | null;
  readonly models: readonly KanbanTaskTargetModelOption[];
};

export type KanbanTaskTargetCatalog = {
  readonly authority: "product" | "local";
  readonly engines: readonly KanbanTaskTargetEngineOption[];
};

export function buildKanbanTaskTargetCatalog(input: {
  readonly productCatalog?: ProductTargetCatalogV1 | null;
  readonly engineStatuses: readonly EngineStatus[];
  readonly codexModels: readonly ModelOption[];
}): KanbanTaskTargetCatalog {
  if (input.productCatalog) {
    return {
      authority: "product",
      engines: input.productCatalog.engines.map((engine) => {
        const models = engine.models.map((model) => ({
          id: model.id,
          displayName: model.displayName,
          target: {
            engine: engine.id,
            providerProfileId: MANAGED_PROVIDER_PROFILE_ID_V1,
            modelCatalogEntryId: model.id,
            model: model.runtimeModel,
            reasoning: null,
            providerProfileNameSnapshot: PRODUCT_MANAGED_PROVIDER_LABEL,
            providerProfileSource: "managed" as const,
          },
        }));
        return {
          id: engine.id,
          displayName: engine.displayName,
          selectable: models.length > 0,
          unavailableReason: models.length > 0 ? null : "no-models",
          models,
        };
      }),
    };
  }

  return {
    authority: "local",
    engines: input.engineStatuses.map((status) => {
      const sourceModels =
        status.engineType === "codex" ? input.codexModels : status.models;
      return {
        id: status.engineType,
        displayName:
          getEngineRegistryEntry(status.engineType)?.displayName ??
          status.engineType,
        selectable: status.installed,
        unavailableReason: status.installed ? null : "not-installed",
        models: sourceModels.map((model) => ({
          id: model.id,
          displayName: model.displayName,
          target: {
            engine: status.engineType,
            providerProfileId: null,
            modelCatalogEntryId: model.id,
            model: model.model?.trim() || model.id,
            reasoning: null,
            providerProfileNameSnapshot: LOCAL_PROVIDER_LABEL,
            providerProfileSource: "disk" as const,
          },
        })),
      };
    }),
  };
}

export function findKanbanTaskTargetModel(input: {
  readonly engine: KanbanTaskTargetEngineOption | null | undefined;
  readonly target?: ExecutionTarget | null;
  readonly legacyModelId?: string | null;
}): KanbanTaskTargetModelOption | null {
  const models = input.engine?.models ?? [];
  if (models.length === 0) {
    return null;
  }
  const currentTarget = input.target ?? null;
  const exact = currentTarget
    ? models.find((model) => sameExecutionTarget(model.target, currentTarget))
    : null;
  if (exact) {
    return exact;
  }
  const identities = [
    input.target?.modelCatalogEntryId,
    input.target?.model,
    input.legacyModelId,
  ]
    .map((identity) => identity?.trim())
    .filter((identity): identity is string => Boolean(identity));
  return models.find((model) =>
    identities.includes(model.target.modelCatalogEntryId?.trim() || model.id) ||
    identities.includes(model.target.model?.trim() || ""),
  ) ?? null;
}

function sameExecutionTarget(
  left: ExecutionTarget,
  right: ExecutionTarget,
): boolean {
  return (
    left.engine === right.engine &&
    (left.providerProfileId?.trim() || null) ===
      (right.providerProfileId?.trim() || null) &&
    (left.modelCatalogEntryId?.trim() || null) ===
      (right.modelCatalogEntryId?.trim() || null) &&
    (left.model?.trim() || null) === (right.model?.trim() || null)
  );
}
