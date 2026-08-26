// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mergeProductCheckoutRefreshV1 } from "./ProductAccountAppGate";

describe("ProductAccountAppGate checkout reconciliation", () => {
  it("retains the in-memory payment action when polling only returns safe order status", () => {
    const current = {
      checkoutId: 77,
      status: "pending" as const,
      expiresAt: "2030-01-01T00:30:00Z",
      planName: "Doge Pro",
      action: {
        kind: "open_url" as const,
        url: "https://pay.example.test/order/77",
        data: null,
      },
    };
    const refreshed = {
      ...current,
      status: "processing" as const,
      action: null,
    };

    expect(mergeProductCheckoutRefreshV1(current, refreshed).action).toEqual(current.action);
  });

  it("does not carry a payment action across different checkout ids", () => {
    const current = {
      checkoutId: 77,
      status: "pending" as const,
      expiresAt: "2030-01-01T00:30:00Z",
      planName: null,
      action: {
        kind: "show_qr" as const,
        url: null,
        data: "synthetic-qr",
      },
    };
    const refreshed = {
      checkoutId: 78,
      status: "pending" as const,
      expiresAt: "2030-01-01T00:30:00Z",
      planName: null,
      action: null,
    };

    expect(mergeProductCheckoutRefreshV1(current, refreshed).action).toBeNull();
  });

});
