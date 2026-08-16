import type { AccountGatewayV1 } from "./gateway";
import type { SafePresentedValueV1 } from "./safeValues";
import { safePresentedValueV1, safeTextV1 } from "./safeValues";

/**
 * Compile-time seam consumed by future Mock and Real implementations. Neither
 * adapter may expose a narrower/private compatibility port.
 */
export function assertAccountGatewayV1Parity(
  mock: AccountGatewayV1,
  real: AccountGatewayV1,
): readonly [AccountGatewayV1, AccountGatewayV1] {
  return [mock, real];
}

export const ACCOUNT_SAFE_PRESENTED_VALUE_TYPECHECK: SafePresentedValueV1 =
  safePresentedValueV1({ kind: "safeText", text: safeTextV1("Synthetic value") });

// @ts-expect-error dynamic presentation values must be constructed and validated.
export const ACCOUNT_UNVALIDATED_SAFE_PRESENTED_VALUE_TYPECHECK: SafePresentedValueV1 = {
  kind: "safeText",
  text: safeTextV1("Synthetic value"),
};
