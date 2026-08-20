import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AccountSubscriptionSummaryViewV1,
  GatewayFailureV1,
} from "../contracts";
import { useAccountGatewayV1 } from "../gateway/AccountGatewayProvider";

export type UseAccountSubscriptionSummaryOptionsV1 = {
  /** Read automatically when the owning surface is mounted. */
  readonly autoLoad?: boolean;
  /** Capability gate for surfaces that may be rendered without subscription access. */
  readonly enabled?: boolean;
};

export type AccountSubscriptionSummaryStateV1 = {
  readonly summary: AccountSubscriptionSummaryViewV1 | null;
  readonly loading: boolean;
  readonly hasLoaded: boolean;
  readonly failure: GatewayFailureV1 | null;
  readonly load: () => Promise<void>;
  readonly refresh: () => Promise<void>;
};

/**
 * Pull-only subscription facts for account surfaces.
 *
 * The request identity is owned here so an account popover can be mounted and
 * dismissed without allowing a late response to update a newer surface.
 */
export function useAccountSubscriptionSummaryV1(
  options: UseAccountSubscriptionSummaryOptionsV1 = {},
): AccountSubscriptionSummaryStateV1 {
  const gateway = useAccountGatewayV1();
  const autoLoad = options.autoLoad !== false;
  const enabled = options.enabled !== false;
  const [summary, setSummary] =
    useState<AccountSubscriptionSummaryViewV1 | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [failure, setFailure] = useState<GatewayFailureV1 | null>(null);
  const generationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!enabled) return;

    const generation = generationRef.current + 1;
    generationRef.current = generation;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setLoading(true);
    setFailure(null);

    const result = await gateway.subscription.read({ signal: controller.signal });
    if (controller.signal.aborted || generationRef.current !== generation) return;

    setLoading(false);
    setHasLoaded(true);
    if (result.ok) {
      setSummary(result.value);
      setFailure(null);
    } else {
      setSummary(null);
      setFailure(result.error);
    }
  }, [enabled, gateway]);

  useEffect(() => {
    if (!enabled || !autoLoad) return;
    void load();
  }, [autoLoad, enabled, load]);

  useEffect(
    () => () => {
      generationRef.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = null;
    },
    [autoLoad, enabled, gateway],
  );

  return {
    summary,
    loading,
    hasLoaded,
    failure,
    load,
    refresh: load,
  };
}
