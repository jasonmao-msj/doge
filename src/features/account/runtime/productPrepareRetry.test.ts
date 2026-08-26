// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  prepareProductWithBoundedRetryV1,
  productPrepareRetryDelaysMs,
} from "./productPrepareRetry";

describe("prepareProductWithBoundedRetryV1", () => {
  it("bounds automatic retry to the exact backoff schedule and preserves stage diagnostics", async () => {
    const unavailable = {
      ok: false as const,
      error: { code: "serviceUnavailable", stage: "productModels" },
    };
    const prepare = vi.fn(async () => unavailable);
    const wait = vi.fn(async (_delayMs: number) => undefined);
    const onAttemptFailure = vi.fn();

    await expect(prepareProductWithBoundedRetryV1(prepare, {
      wait,
      onAttemptFailure,
    }))
      .resolves.toEqual(unavailable);
    expect(prepare).toHaveBeenCalledTimes(productPrepareRetryDelaysMs().length);
    expect(wait.mock.calls.map(([delayMs]) => delayMs)).toEqual(
      productPrepareRetryDelaysMs().slice(1),
    );
    expect(onAttemptFailure).toHaveBeenNthCalledWith(1, {
      error: unavailable.error,
      attempt: 1,
      maxAttempts: productPrepareRetryDelaysMs().length,
      retryDelayMs: productPrepareRetryDelaysMs()[1],
    });
    expect(onAttemptFailure).toHaveBeenLastCalledWith({
      error: unavailable.error,
      attempt: productPrepareRetryDelaysMs().length,
      maxAttempts: productPrepareRetryDelaysMs().length,
      retryDelayMs: null,
    });
  });

  it("can converge on the final bounded attempt without exposing an intermediate failure", async () => {
    const unavailable = {
      ok: false as const,
      error: { code: "serviceUnavailable", stage: "productPrepare" },
    };
    const ready = readyResult();
    const prepare = vi.fn()
      .mockResolvedValueOnce(unavailable)
      .mockResolvedValueOnce(unavailable)
      .mockResolvedValueOnce(unavailable)
      .mockResolvedValueOnce(unavailable)
      .mockResolvedValueOnce(unavailable)
      .mockResolvedValueOnce(ready);
    const wait = vi.fn(async (_delayMs: number) => undefined);

    await expect(prepareProductWithBoundedRetryV1(prepare, { wait }))
      .resolves.toEqual(ready);
    expect(prepare).toHaveBeenCalledTimes(6);
    expect(wait.mock.calls.map(([delayMs]) => delayMs)).toEqual(
      productPrepareRetryDelaysMs().slice(1),
    );
  });

  it("does not retry after the request generation becomes stale", async () => {
    let current = true;
    const prepare = vi.fn(async () => ({
      ok: false as const,
      error: { code: "serviceUnavailable" },
    }));
    const wait = vi.fn(async (_delayMs: number) => {
      current = false;
    });

    await prepareProductWithBoundedRetryV1(prepare, {
      isCurrent: () => current,
      wait,
    });
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it("respects a server cooldown instead of auto-retrying", async () => {
    const rateLimited = {
      ok: false as const,
      error: { code: "serviceUnavailable", retryAfterMs: 6_000 },
    };
    const prepare = vi.fn(async () => rateLimited);
    const wait = vi.fn(async (_delayMs: number) => undefined);

    await expect(prepareProductWithBoundedRetryV1(prepare, { wait }))
      .resolves.toEqual(rateLimited);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("does not hide a genuine protocol mismatch behind repeated renderer retries", async () => {
    const mismatch = {
      ok: false as const,
      error: { code: "protocolMismatch", stage: "productPrepare" },
    };
    const prepare = vi.fn(async () => mismatch);
    const wait = vi.fn(async (_delayMs: number) => undefined);

    await expect(prepareProductWithBoundedRetryV1(prepare, { wait }))
      .resolves.toEqual(mismatch);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("retries one thrown bridge result", async () => {
    const ready = readyResult();
    const prepare = vi.fn()
      .mockRejectedValueOnce(new Error("bridge response lost"))
      .mockResolvedValueOnce(ready);

    await expect(prepareProductWithBoundedRetryV1(prepare, {
      wait: vi.fn(async (_delayMs: number) => undefined),
    })).resolves.toEqual(ready);
    expect(prepare).toHaveBeenCalledTimes(2);
  });
});

function readyResult() {
  return {
    ok: true as const,
    value: {
      status: "ready" as const,
      entitlement: {
        status: "active" as const,
        subscriptionId: 9,
        groupId: 5,
        groupName: "Doge",
        planName: "Doge",
        expiresAt: "2030-01-01T00:00:00Z",
        usage: {
          daily: { usedUsd: 0, limitUsd: 1, percentage: 0 },
          weekly: { usedUsd: 0, limitUsd: 1, percentage: 0 },
          monthly: { usedUsd: 0, limitUsd: 1, percentage: 0 },
        },
      },
      models: [],
      engines: [],
    },
  };
}
