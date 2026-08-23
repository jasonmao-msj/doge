import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));

import {
  createAccountProductCheckoutV1,
  prepareAccountProductV1,
  readAccountProductBillingV1,
  readAccountProductCheckoutV1,
  readAccountProductModelsV1,
  readAccountProductUsageV1,
} from "./accountProductCommands";

beforeEach(() => vi.clearAllMocks());

describe("account product Tauri commands", () => {
  it("maps product payloads to the exact native command shape", async () => {
    tauri.invoke.mockResolvedValue({ ok: true, value: null });

    await createAccountProductCheckoutV1({
      planId: 5,
      paymentType: "alipay",
      operationId: "operation_checkout_0001",
    });
    await readAccountProductCheckoutV1(9);
    await prepareAccountProductV1("operation_prepare_0001");
    await readAccountProductUsageV1("previous");
    await readAccountProductBillingV1();
    await readAccountProductModelsV1();

    expect(tauri.invoke).toHaveBeenNthCalledWith(
      1,
      "account_product_v1_create_checkout",
      {
        planId: 5,
        paymentType: "alipay",
        operationId: "operation_checkout_0001",
      },
    );
    expect(tauri.invoke).toHaveBeenNthCalledWith(
      2,
      "account_product_v1_checkout",
      { checkoutId: 9 },
    );
    expect(tauri.invoke).toHaveBeenNthCalledWith(
      3,
      "account_product_v1_prepare",
      { operationId: "operation_prepare_0001" },
    );
    expect(tauri.invoke).toHaveBeenNthCalledWith(
      4,
      "account_product_v1_usage",
      { period: "previous" },
    );
    expect(tauri.invoke).toHaveBeenNthCalledWith(5, "account_product_v1_billing");
    expect(tauri.invoke).toHaveBeenNthCalledWith(6, "account_product_v1_models");
  });
});
