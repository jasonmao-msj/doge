import { describe, expect, it } from "vitest";
import { oauthAttemptHandleV1 } from "../contracts";
import {
  isTerminalOAuthFailureV1,
  OAuthWakeupCoordinatorV1,
} from "./oauthWakeupCoordinator";

const BINDING = {
  purpose: "oauth",
  accountEpoch: 1,
  processGeneration: 1,
  expiresAtEpochSeconds: 1_900_000_000,
} as const;
const ATTEMPT = oauthAttemptHandleV1(BINDING, "0123456789abcdef");
const OTHER = oauthAttemptHandleV1(BINDING, "fedcba9876543210");

describe("OAuthWakeupCoordinatorV1", () => {
  it("replays an early exact-attempt wakeup after start settles", () => {
    const coordinator = new OAuthWakeupCoordinatorV1();
    expect(coordinator.observe(ATTEMPT)).toBe(false);
    expect(coordinator.activate(ATTEMPT)).toBe(true);
    expect(coordinator.beginRead(ATTEMPT)).toBe(true);
  });

  it("deduplicates concurrent reads and never consumes another attempt", () => {
    const coordinator = new OAuthWakeupCoordinatorV1();
    coordinator.observe(OTHER);
    expect(coordinator.activate(ATTEMPT)).toBe(false);
    expect(coordinator.observe(ATTEMPT)).toBe(true);
    expect(coordinator.beginRead(ATTEMPT)).toBe(true);
    expect(coordinator.beginRead(ATTEMPT)).toBe(false);
    expect(coordinator.beginRead(OTHER)).toBe(false);

    coordinator.finishRead(ATTEMPT, false);
    expect(coordinator.beginRead(ATTEMPT)).toBe(true);
    coordinator.finishRead(ATTEMPT, true);
    expect(coordinator.beginRead(ATTEMPT)).toBe(false);
    expect(coordinator.activate(OTHER)).toBe(true);
  });

  it("separates terminal OAuth contract failures from retryable transport or vault failures", () => {
    for (const terminal of [
      "oauthStateMismatch",
      "externalIntentConsumed",
      "protocolMismatch",
    ] as const) {
      expect(isTerminalOAuthFailureV1(terminal)).toBe(true);
    }
    for (const retryable of [
      "offline",
      "serviceUnavailable",
      "rateLimited",
      "vaultLocked",
      "outcomeUnknown",
    ] as const) {
      expect(isTerminalOAuthFailureV1(retryable)).toBe(false);
    }
  });
});
