import type { ExternalIntentHandleV1 } from "../contracts";

function sameIntentV1(
  left: ExternalIntentHandleV1 | null,
  right: ExternalIntentHandleV1,
): boolean {
  return left === right;
}

export class PasswordResetWakeupCoordinatorV1 {
  private requestPending = false;
  private requestAccepted = false;
  private queuedIntent: ExternalIntentHandleV1 | null = null;
  private activeIntent: ExternalIntentHandleV1 | null = null;
  private readInFlight = false;

  startRequest(): void {
    this.requestPending = true;
    this.requestAccepted = false;
    this.queuedIntent = null;
    this.activeIntent = null;
    this.readInFlight = false;
  }

  observe(intent: ExternalIntentHandleV1): boolean {
    if (this.requestPending) {
      if (!this.queuedIntent) this.queuedIntent = intent;
      return false;
    }
    if (!this.requestAccepted) return false;
    if (this.activeIntent && !sameIntentV1(this.activeIntent, intent)) return false;
    if (!this.activeIntent) this.activeIntent = intent;
    return !this.readInFlight;
  }

  finishRequest(accepted: boolean): ExternalIntentHandleV1 | null {
    this.requestPending = false;
    this.requestAccepted = accepted;
    if (!accepted) {
      this.clear();
      return null;
    }
    const queued = this.queuedIntent;
    this.queuedIntent = null;
    if (queued) this.activeIntent = queued;
    return queued;
  }

  beginRead(intent: ExternalIntentHandleV1): boolean {
    if (!this.requestAccepted || this.readInFlight) return false;
    if (this.activeIntent && !sameIntentV1(this.activeIntent, intent)) return false;
    this.activeIntent = intent;
    this.readInFlight = true;
    return true;
  }

  finishRead(intent: ExternalIntentHandleV1, terminal: boolean): void {
    if (!sameIntentV1(this.activeIntent, intent)) return;
    this.readInFlight = false;
    if (terminal) this.clear();
  }

  clear(): void {
    this.requestPending = false;
    this.requestAccepted = false;
    this.queuedIntent = null;
    this.activeIntent = null;
    this.readInFlight = false;
  }
}
