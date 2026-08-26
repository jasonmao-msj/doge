import type {
  EngineOnboardingFailureV1,
  EngineOnboardingResultV1,
} from "./onboardingTypes";
import type { ProductReadyViewV1 } from "./productOnboardingClient";

const PRODUCT_PREPARE_RETRY_DELAYS_MS = [0, 1_000, 2_000, 4_000, 8_000, 15_000] as const;

export type ProductPrepareAttemptFailureV1 = {
  readonly error: EngineOnboardingFailureV1;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly retryDelayMs: number | null;
};

export async function prepareProductWithBoundedRetryV1(
  prepare: () => Promise<EngineOnboardingResultV1<ProductReadyViewV1>>,
  options: {
    readonly isCurrent?: () => boolean;
    readonly wait?: (delayMs: number) => Promise<void>;
    readonly onAttemptFailure?: (failure: ProductPrepareAttemptFailureV1) => void;
  } = {},
): Promise<EngineOnboardingResultV1<ProductReadyViewV1> | null> {
  const isCurrent = options.isCurrent ?? (() => true);
  const wait = options.wait ?? waitForProductPrepareRetry;
  let lastResult: EngineOnboardingResultV1<ProductReadyViewV1> | null = null;
  for (let attemptIndex = 0; attemptIndex < PRODUCT_PREPARE_RETRY_DELAYS_MS.length; attemptIndex += 1) {
    if (!isCurrent()) return lastResult;
    const delayMs = PRODUCT_PREPARE_RETRY_DELAYS_MS[attemptIndex] ?? 0;
    if (delayMs > 0) {
      await wait(delayMs);
      if (!isCurrent()) return lastResult;
    }
    const result = await prepare().catch(() => null);
    if (result?.ok) return result;
    lastResult = result;
    const error = result?.error ?? {
      code: "serviceUnavailable",
      stage: "productPrepareBridge",
    };
    const retryDelayMs = PRODUCT_PREPARE_RETRY_DELAYS_MS[attemptIndex + 1] ?? null;
    options.onAttemptFailure?.({
      error,
      attempt: attemptIndex + 1,
      maxAttempts: PRODUCT_PREPARE_RETRY_DELAYS_MS.length,
      retryDelayMs,
    });
    if (
      error.code !== "serviceUnavailable" ||
      (error.retryAfterMs ?? 0) > 0 ||
      retryDelayMs === null
    ) {
      return result;
    }
  }
  return lastResult;
}

export function productPrepareRetryDelaysMs(): readonly number[] {
  return PRODUCT_PREPARE_RETRY_DELAYS_MS;
}

function waitForProductPrepareRetry(delayMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}
