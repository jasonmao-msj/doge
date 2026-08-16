import type { GatewayCallContextV1 } from "../contracts/gateway";
import {
  gatewayIntentIdV1,
  type SecretInputV1,
} from "../contracts/semantic";

let intentSequenceV1 = 0;

export function createAccountCallContextV1(): GatewayCallContextV1 {
  intentSequenceV1 += 1;
  return {
    intent: gatewayIntentIdV1(
      `intent_ui${Date.now().toString(36)}${intentSequenceV1.toString(36).padStart(6, "0")}`,
    ),
  };
}

/** Form-local value: call only at the narrow Gateway invocation boundary. */
export function transientSecretInputV1(value: string): SecretInputV1 {
  return value as SecretInputV1;
}
