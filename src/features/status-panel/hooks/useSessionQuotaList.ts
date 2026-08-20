import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getCodingPlanQuota,
  type CodingPlanQuotaSnapshot,
} from "../../../services/tauri";
import type { SessionQuotaTarget } from "../utils/sessionQuotaTargets";
import {
  isManagedAccountQuotaTarget,
  loadManagedAccountQuotaSnapshots,
  TOKEN_MATRIX_UNAVAILABLE_MESSAGE,
} from "../utils/managedAccountQuota";

export type SessionQuotaListEntry = {
  target: SessionQuotaTarget;
  snapshot: CodingPlanQuotaSnapshot | null;
  loading: boolean;
  error: string | null;
};

type UseSessionQuotaListOptions = {
  targets: readonly SessionQuotaTarget[];
  enabled?: boolean;
};

function targetsSignature(targets: readonly SessionQuotaTarget[]): string {
  return targets.map((t) => t.key).join("\n");
}

/**
 * 对会话内去重后的供应商目标并行查询额度。
 * 每个 target 独立 loading/error，互不阻塞。
 */
export function useSessionQuotaList({
  targets,
  enabled = true,
}: UseSessionQuotaListOptions) {
  const [entriesByKey, setEntriesByKey] = useState<
    Record<string, SessionQuotaListEntry>
  >({});
  const requestGenRef = useRef(0);
  const signature = useMemo(() => targetsSignature(targets), [targets]);

  const refresh = useCallback(async () => {
    if (!enabled || targets.length === 0) {
      setEntriesByKey({});
      return;
    }

    const gen = ++requestGenRef.current;
    // 先放 loading 占位，保留已有成功结果避免闪空
    setEntriesByKey((prev) => {
      const next: Record<string, SessionQuotaListEntry> = {};
      for (const target of targets) {
        const existing = prev[target.key];
        next[target.key] = {
          target,
          snapshot: existing?.snapshot ?? null,
          loading: true,
          error: null,
        };
      }
      return next;
    });

    const managedTargets = targets.filter(isManagedAccountQuotaTarget);
    const localOrProviderTargets = targets.filter(
      (target) => !isManagedAccountQuotaTarget(target),
    );
    const localOrProviderPromise = Promise.all(
      localOrProviderTargets.map(async (target) => {
        try {
          const snapshot = await getCodingPlanQuota(
            target.engine,
            target.providerProfileId,
          );
          return { target, snapshot, error: null as string | null };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            target,
            snapshot: {
              source: "error",
              success: false,
              error: message,
              windows: [],
              queriedAt: Date.now(),
            } satisfies CodingPlanQuotaSnapshot,
            error: message,
          };
        }
      }),
    );
    const managedPromise =
      managedTargets.length === 0
        ? Promise.resolve([])
        : loadManagedAccountQuotaSnapshots(managedTargets)
            .then((results) =>
              results.map((result) => ({
                target: result.target,
                snapshot: result.snapshot,
                error: result.snapshot.success
                  ? null
                  : (result.snapshot.error ?? TOKEN_MATRIX_UNAVAILABLE_MESSAGE),
              })),
            )
            .catch(() =>
              managedTargets.map((target) => ({
                target,
                snapshot: {
                  source: "token_matrix",
                  success: false,
                  error: TOKEN_MATRIX_UNAVAILABLE_MESSAGE,
                  windows: [],
                  queriedAt: Date.now(),
                } satisfies CodingPlanQuotaSnapshot,
                error: TOKEN_MATRIX_UNAVAILABLE_MESSAGE,
              })),
            );
    const [localOrProviderResults, managedResults] = await Promise.all([
      localOrProviderPromise,
      managedPromise,
    ]);
    const results = [...localOrProviderResults, ...managedResults];

    if (gen !== requestGenRef.current) {
      return;
    }

    const next: Record<string, SessionQuotaListEntry> = {};
    for (const result of results) {
      next[result.target.key] = {
        target: result.target,
        snapshot: result.snapshot,
        loading: false,
        error: result.error,
      };
    }
    setEntriesByKey(next);
  }, [enabled, signature, targets]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const entries = useMemo(() => {
    return targets.map((target) => {
      const existing = entriesByKey[target.key];
      if (existing) {
        return { ...existing, target };
      }
      return {
        target,
        snapshot: null,
        loading: enabled,
        error: null,
      } satisfies SessionQuotaListEntry;
    });
  }, [targets, entriesByKey, enabled]);

  const loading = entries.some((e) => e.loading);

  return { entries, loading, refresh };
}
