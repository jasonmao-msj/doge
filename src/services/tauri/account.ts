import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type AccountNativeContextV1 = {
  readonly processGeneration: number;
  readonly accountEpoch: number;
};

export function getAccountNativeContextV1(): Promise<AccountNativeContextV1> {
  return invoke<AccountNativeContextV1>("account_v1_context");
}

export function prepareAccountMutationV1(request: unknown): Promise<string> {
  return invoke<string>("account_v1_prepare_mutation", { request });
}

export function executeAccountRequestV1(
  request: unknown,
  operationId: string | null,
): Promise<unknown> {
  return invoke<unknown>("account_v1_execute", { request, operationId });
}

export function subscribeAccountWakeupV1(
  listener: (payload: unknown) => void,
): Promise<UnlistenFn> {
  return listen<unknown>("doge://account-v1/wakeup", (event) => listener(event.payload));
}
