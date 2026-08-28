import type { KanbanTask } from "../features/kanban/types";
import {
  PRODUCT_MANAGED_PROVIDER_LABEL,
  resolveProductManagedExecutionTargetV1,
} from "../features/account/runtime/productExecutionTarget";
import type { ProductEntitlementSnapshotV1 } from "../features/account/runtime/productEntitlementStore";
import type { ExecutionTarget } from "../features/shared-session/target/types";
import { isResolvedExecutionTarget } from "../features/shared-session/target/types";
import { LOCAL_PROVIDER_LABEL } from "../utils/turnBadge";

export type KanbanExecutionTargetResolution =
  | { readonly ok: true; readonly target: ExecutionTarget }
  | {
      readonly ok: false;
      readonly reason:
        | "product_target_unavailable"
        | "managed_target_catalog_unavailable"
        | "local_target_invalid";
    };

export function resolveKanbanExecutionTarget(input: {
  readonly task: Pick<
    KanbanTask,
    "engineType" | "modelId" | "executionTarget"
  >;
  readonly product: ProductEntitlementSnapshotV1;
}): KanbanExecutionTargetResolution {
  if (input.product.status === "ready") {
    const target = resolveProductManagedExecutionTargetV1({
      target: input.task.executionTarget,
      preferredEngine: input.task.engineType,
      preferredModelId: input.task.modelId,
      engines: input.product.engines,
      models: input.product.models,
    });
    return target && target.engine === input.task.engineType
      ? { ok: true, target }
      : { ok: false, reason: "product_target_unavailable" };
  }

  if (input.task.executionTarget?.providerProfileSource === "managed") {
    return { ok: false, reason: "managed_target_catalog_unavailable" };
  }
  if (isResolvedExecutionTarget(input.task.executionTarget)) {
    return { ok: true, target: input.task.executionTarget };
  }

  const model = input.task.modelId?.trim() || null;
  const target: ExecutionTarget = {
    engine: input.task.engineType,
    providerProfileId: null,
    modelCatalogEntryId: model,
    model,
    reasoning: null,
    providerProfileNameSnapshot: LOCAL_PROVIDER_LABEL,
    providerProfileSource: "disk",
  };
  if (!target.engine) {
    return { ok: false, reason: "local_target_invalid" };
  }
  return { ok: true, target };
}

export function productTargetDisplayIdentity(
  target: ExecutionTarget,
): string {
  return target.providerProfileSource === "managed"
    ? target.providerProfileNameSnapshot?.trim() || PRODUCT_MANAGED_PROVIDER_LABEL
    : target.providerProfileNameSnapshot?.trim() || LOCAL_PROVIDER_LABEL;
}

export async function prepareKanbanExecutionTarget(
  target: ExecutionTarget,
  ensureReady: (input: {
    readonly engine: ExecutionTarget["engine"];
    readonly providerProfileId?: string | null;
  }) => Promise<unknown>,
): Promise<{
  readonly engine: ExecutionTarget["engine"];
  readonly providerProfileId?: string;
}> {
  await ensureReady({
    engine: target.engine,
    providerProfileId: target.providerProfileId,
  });
  const providerProfileId = target.providerProfileId?.trim() || null;
  return {
    engine: target.engine,
    ...(providerProfileId ? { providerProfileId } : {}),
  };
}
