import { describe, expect, it } from "vitest";
import type { ExternalIntentHandleV1 } from "../contracts";
import { PasswordResetWakeupCoordinatorV1 } from "./passwordResetWakeupCoordinator";

const INTENT_A = "external-intent/password-reset/a" as ExternalIntentHandleV1;
const INTENT_B = "external-intent/password-reset/b" as ExternalIntentHandleV1;

describe("PasswordResetWakeupCoordinatorV1", () => {
  it("buffers an email return that arrives before the request response", () => {
    const coordinator = new PasswordResetWakeupCoordinatorV1();
    coordinator.startRequest();
    expect(coordinator.observe(INTENT_A)).toBe(false);
    expect(coordinator.finishRequest(true)).toEqual(INTENT_A);
    expect(coordinator.beginRead(INTENT_A)).toBe(true);
  });

  it("rejects unsolicited, duplicate, and mismatched intents", () => {
    const coordinator = new PasswordResetWakeupCoordinatorV1();
    expect(coordinator.observe(INTENT_A)).toBe(false);
    coordinator.startRequest();
    expect(coordinator.finishRequest(true)).toBeNull();
    expect(coordinator.observe(INTENT_A)).toBe(true);
    expect(coordinator.beginRead(INTENT_A)).toBe(true);
    expect(coordinator.observe(INTENT_A)).toBe(false);
    expect(coordinator.observe(INTENT_B)).toBe(false);
  });

  it("allows a safe read retry until a terminal outcome clears the flow", () => {
    const coordinator = new PasswordResetWakeupCoordinatorV1();
    coordinator.startRequest();
    coordinator.finishRequest(true);
    coordinator.observe(INTENT_A);
    expect(coordinator.beginRead(INTENT_A)).toBe(true);
    coordinator.finishRead(INTENT_A, false);
    expect(coordinator.beginRead(INTENT_A)).toBe(true);
    coordinator.finishRead(INTENT_A, true);
    expect(coordinator.observe(INTENT_A)).toBe(false);
  });
});
