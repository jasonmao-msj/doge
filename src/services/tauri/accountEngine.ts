import { invoke } from "@tauri-apps/api/core";

export function readAccountEngineCatalogV1(): Promise<unknown> {
  return invoke("account_engine_v1_catalog");
}

export function readAccountEnginePlansV1(engineId: string): Promise<unknown> {
  return invoke("account_engine_v1_plans", { engineId });
}

export function createAccountEngineCheckoutV1(input: {
  readonly engineId: string;
  readonly planId: number;
  readonly paymentType: string;
  readonly operationId: string;
}): Promise<unknown> {
  return invoke("account_engine_v1_create_checkout", input);
}

export function readAccountEngineCheckoutV1(checkoutId: number): Promise<unknown> {
  return invoke("account_engine_v1_checkout", { checkoutId });
}

export function readPendingAccountEngineCheckoutV1(): Promise<unknown> {
  return invoke("account_engine_v1_pending_checkout");
}

export function abandonAccountEngineCheckoutV1(checkoutId: number): Promise<unknown> {
  return invoke("account_engine_v1_abandon_checkout", { checkoutId });
}

export function readAccountEngineReadinessV1(engineId: string): Promise<unknown> {
  return invoke("account_engine_v1_readiness", { engineId });
}

export function prepareAccountEngineV1(
  engineId: string,
  operationId: string,
): Promise<unknown> {
  return invoke("account_engine_v1_prepare", { engineId, operationId });
}

export function resolveAccountEngineToolchainV1(
  engineId: string,
  choice: "bundled" | "external" | null,
): Promise<unknown> {
  return invoke("account_engine_v1_toolchain", { engineId, choice });
}

export function activateAccountEngineV1(engineId: "codex" | "claude-code"): Promise<void> {
  return invoke("account_engine_v1_activate", { engineId });
}
