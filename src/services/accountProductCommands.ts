import { invoke } from "@tauri-apps/api/core";

export function readAccountProductCatalogV1(): Promise<unknown> {
  return invoke("account_product_v1_catalog");
}

export function readAccountProductModelsV1(): Promise<unknown> {
  return invoke("account_product_v1_models");
}

export function readAccountProductUsageV1(
  period: "current" | "previous",
): Promise<unknown> {
  return invoke("account_product_v1_usage", { period });
}

export function readAccountProductBillingV1(): Promise<unknown> {
  return invoke("account_product_v1_billing");
}

export function createAccountProductCheckoutV1(input: {
  readonly planId: number;
  readonly paymentType: string;
  readonly operationId: string;
}): Promise<unknown> {
  return invoke("account_product_v1_create_checkout", input);
}

export function readAccountProductCheckoutV1(
  checkoutId: number,
): Promise<unknown> {
  return invoke("account_product_v1_checkout", { checkoutId });
}

export function readPendingAccountProductCheckoutV1(): Promise<unknown> {
  return invoke("account_product_v1_pending_checkout");
}

export function abandonAccountProductCheckoutV1(
  checkoutId: number,
): Promise<unknown> {
  return invoke("account_product_v1_abandon_checkout", { checkoutId });
}

export function prepareAccountProductV1(
  operationId: string,
): Promise<unknown> {
  return invoke("account_product_v1_prepare", { operationId });
}
