import type { ProviderContinuationTargetInput } from "../../../services/tauri/sessionManagement";

export type ProviderContinuationDialogRequest = {
  workspaceId: string;
  sourceSessionId: string;
  destination: ProviderContinuationTargetInput;
};

type ProviderContinuationRequestListener = (
  request: ProviderContinuationDialogRequest,
) => void;

const providerContinuationRequestListeners =
  new Set<ProviderContinuationRequestListener>();

export function requestProviderContinuationDialog(
  request: ProviderContinuationDialogRequest,
): void {
  providerContinuationRequestListeners.forEach((listener) => listener(request));
}

export function subscribeProviderContinuationDialogRequests(
  listener: ProviderContinuationRequestListener,
): () => void {
  providerContinuationRequestListeners.add(listener);
  return () => {
    providerContinuationRequestListeners.delete(listener);
  };
}

/** 用户取消续接时：通知 Picker 丢掉 destination 渠道预览覆盖，回到 source。 */
export const PROVIDER_CONTINUATION_UI_ROLLBACK_EVENT =
  "doge:provider-continuation-ui-rollback";

export type ProviderContinuationUiRollbackDetail = {
  engine: string;
  providerProfileId: string | null;
};

export function notifyProviderContinuationUiRollback(
  detail: ProviderContinuationUiRollbackDetail,
): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent(PROVIDER_CONTINUATION_UI_ROLLBACK_EVENT, { detail }),
  );
}
