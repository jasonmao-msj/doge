import type {
  AuthNextViewV1,
  GatewayFailureV1,
  OAuthAttemptViewV1,
} from "../contracts";

export function oauthAttemptToAuthNextV1(
  value: OAuthAttemptViewV1,
): AuthNextViewV1 | null {
  switch (value.status) {
    case "authenticated":
      return { next: "authenticated", session: value.session };
    case "completionRequired":
      return {
        next: "oauthAccountCompletion",
        attempt: value.attempt,
        requirements: value.requirements,
      };
    case "waiting":
    case "cancelled":
    case "expired":
    case "denied":
      return null;
  }
}

export function isTerminalPasswordResetFailureV1(
  code: GatewayFailureV1["code"],
): boolean {
  return code === "externalIntentInvalid" ||
    code === "externalIntentExpired" ||
    code === "externalIntentConsumed" ||
    code === "contractUnsupported" ||
    code === "capabilityUnavailable" ||
    code === "protocolMismatch";
}
