import { readAccountProductModelsV1 } from "../../../services/accountProductCommands";
import {
  publishProductModelsRefreshFailedV1,
  publishProductModelsRefreshingV1,
  publishProductModelsUpdatedV1,
  readProductEntitlementSnapshotV1,
} from "./productEntitlementStore";
import { parseProductModels } from "./productOnboardingClient";

const PRODUCT_MODEL_FRESHNESS_MS = 30_000;

let inFlight: {
  readonly subscriptionId: number;
  readonly promise: Promise<boolean>;
} | null = null;

export async function refreshProductModelsV1(options: {
  readonly force?: boolean;
} = {}): Promise<boolean> {
  const current = readProductEntitlementSnapshotV1();
  const subscriptionId = current.entitlement?.subscriptionId;
  if (current.status !== "ready" || subscriptionId === null || subscriptionId === undefined) {
    return false;
  }
  if (!options.force && current.modelsUpdatedAt !== null &&
    Date.now() - current.modelsUpdatedAt < PRODUCT_MODEL_FRESHNESS_MS) {
    return true;
  }
  if (inFlight?.subscriptionId === subscriptionId) return inFlight.promise;

  publishProductModelsRefreshingV1(subscriptionId);
  const promise = readAccountProductModelsV1()
    .then(parseProductModels)
    .then((result) => {
      if (!result.ok) {
        publishProductModelsRefreshFailedV1({
          subscriptionId,
          code: result.error.code,
        });
        return false;
      }
      const parsedFetchedAt = Date.parse(result.value.fetchedAt);
      publishProductModelsUpdatedV1({
        subscriptionId,
        models: result.value.models,
        fetchedAt: Number.isFinite(parsedFetchedAt) ? parsedFetchedAt : Date.now(),
      });
      return true;
    })
    .catch(() => {
      publishProductModelsRefreshFailedV1({
        subscriptionId,
        code: "serviceUnavailable",
      });
      return false;
    })
    .finally(() => {
      if (inFlight?.promise === promise) inFlight = null;
    });
  inFlight = { subscriptionId, promise };
  return promise;
}
