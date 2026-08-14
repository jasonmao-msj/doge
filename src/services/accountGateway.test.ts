import { beforeEach, describe, expect, it, vi } from "vitest";
import { RealAccountGatewayV1 } from "./accountGateway";
import {
  executeAccountRequestV1,
  getAccountNativeContextV1,
  prepareAccountMutationV1,
  subscribeAccountWakeupV1,
} from "./tauri/account";

vi.mock("./tauri/account", () => ({
  executeAccountRequestV1: vi.fn(),
  getAccountNativeContextV1: vi.fn(),
  prepareAccountMutationV1: vi.fn(),
  subscribeAccountWakeupV1: vi.fn(),
}));

describe("RealAccountGatewayV1", () => {
  beforeEach(() => {
    vi.mocked(executeAccountRequestV1).mockReset();
    vi.mocked(getAccountNativeContextV1).mockReset();
    vi.mocked(prepareAccountMutationV1).mockReset();
    vi.mocked(subscribeAccountWakeupV1).mockReset();
  });

  it("validates native wakeups before notifying subscribers", async () => {
    let nativeListener: ((payload: unknown) => void) | null = null;
    const unlisten = vi.fn();
    vi.mocked(subscribeAccountWakeupV1).mockImplementation(async (listener) => {
      nativeListener = listener;
      return unlisten;
    });
    const listener = vi.fn();
    const unsubscribe = new RealAccountGatewayV1().subscribe(listener);
    await Promise.resolve();
    const emit = nativeListener as unknown as (payload: unknown) => void;
    emit({ event: { kind: "unknown" } });
    expect(listener).not.toHaveBeenCalled();
    emit({
      contractId: "wrong-account-contract",
      contractVersion: "1.0.0",
      event: {
        kind: "sessionChanged",
        eventId: "event_1-0-wakeup",
        emittedAt: "2030-01-01T00:00:00Z",
        processGeneration: 1,
        eventSeq: 0,
        accountEpoch: 2,
      },
    });
    expect(listener).not.toHaveBeenCalled();
    emit({
      contractId: "doge-account-ipc",
      contractVersion: "1.0.0",
      event: {
        kind: "sessionChanged",
        eventId: "event_1-0-wakeup",
        emittedAt: "2030-01-01T00:00:00Z",
        processGeneration: 1,
        eventSeq: 0,
        accountEpoch: 2,
      },
    });
    expect(listener).toHaveBeenCalledTimes(1);
    emit({
      contractId: "doge-account-ipc",
      contractVersion: "1.0.0",
      event: {
        kind: "sessionChanged",
        eventId: "event_1-0-duplicate",
        emittedAt: "2030-01-01T00:00:01Z",
        processGeneration: 1,
        eventSeq: 0,
        accountEpoch: 2,
      },
    });
    expect(listener).toHaveBeenCalledTimes(1);
    emit({
      contractId: "doge-account-ipc",
      contractVersion: "1.0.0",
      event: {
        kind: "configurationTaskChanged",
        eventId: "event_1-1-wakeup",
        emittedAt: "2030-01-01T00:00:02Z",
        processGeneration: 1,
        eventSeq: 1,
        accountEpoch: 2,
      },
    });
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("turns a native read rejection into a safe Local Mode failure", async () => {
    vi.mocked(getAccountNativeContextV1).mockRejectedValue(new Error("raw native detail"));
    const result = await new RealAccountGatewayV1().bootstrap({});
    expect(result).toEqual({
      ok: false,
      error: {
        code: "serviceUnavailable",
        stage: "capabilities",
        recovery: { action: "useLocalMode" },
      },
    });
  });

  it("retries one mutation acceptance with the same request then returns reconcilable uncertainty", async () => {
    vi.mocked(getAccountNativeContextV1).mockResolvedValue({
      processGeneration: 1,
      accountEpoch: 1,
    });
    vi.mocked(prepareAccountMutationV1).mockRejectedValue(new Error("raw broker detail"));
    const result = await new RealAccountGatewayV1().auth.logout(
      { scope: "thisDevice" },
      { intent: "intent_12345678" as never },
    );
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "outcomeUnknown",
        stage: "logout",
        recovery: { action: "reconcile", intent: "intent_12345678" },
      },
    });
    expect(prepareAccountMutationV1).toHaveBeenCalledTimes(2);
    expect(prepareAccountMutationV1).toHaveBeenNthCalledWith(
      2,
      vi.mocked(prepareAccountMutationV1).mock.calls[0]?.[0],
    );
  });
});
