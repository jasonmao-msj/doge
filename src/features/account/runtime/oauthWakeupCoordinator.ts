import type { OAuthAttemptHandleV1 } from "../contracts";
import type { AccountFailureCodeV1 } from "../contracts";

const TERMINAL_OAUTH_FAILURES_V1 = new Set<AccountFailureCodeV1>([
  "oauthStateMismatch",
  "oauthDenied",
  "externalIntentInvalid",
  "externalIntentExpired",
  "externalIntentConsumed",
  "contractUnsupported",
  "capabilityUnavailable",
  "protocolMismatch",
]);

export function isTerminalOAuthFailureV1(code: AccountFailureCodeV1): boolean {
  return TERMINAL_OAUTH_FAILURES_V1.has(code);
}

/**
 * Correlates wakeup-only OAuth events with the exact renderer-owned attempt.
 * Early events are buffered; duplicate events cannot start concurrent reads.
 */
export class OAuthWakeupCoordinatorV1 {
  private active: OAuthAttemptHandleV1 | null = null;
  private readonly pending = new Set<OAuthAttemptHandleV1>();
  private readonly inFlight = new Set<OAuthAttemptHandleV1>();

  observe(attempt: OAuthAttemptHandleV1): boolean {
    if (this.active === attempt) return true;
    this.pending.add(attempt);
    return false;
  }

  activate(attempt: OAuthAttemptHandleV1): boolean {
    this.active = attempt;
    return this.pending.delete(attempt);
  }

  beginRead(attempt: OAuthAttemptHandleV1): boolean {
    if (this.active !== attempt || this.inFlight.has(attempt)) return false;
    this.inFlight.add(attempt);
    return true;
  }

  finishRead(attempt: OAuthAttemptHandleV1, terminal: boolean): void {
    this.inFlight.delete(attempt);
    if (terminal) this.clear(attempt);
  }

  clear(attempt: OAuthAttemptHandleV1): void {
    this.pending.delete(attempt);
    this.inFlight.delete(attempt);
    if (this.active === attempt) this.active = null;
  }
}
