import { useEffect, useRef } from "react";
import type { EngineType, SetActiveEngine } from "../types";
import { resolveFallbackEngineWhenDisabled } from "../features/engine/utils/resolveFallbackEngineWhenDisabled";

type EngineCandidate = {
  type: EngineType;
  installed: boolean;
};

type UseAutoMigrateDisabledActiveEngineInput = {
  activeEngine: EngineType;
  activeThreadEngine: EngineType | null | undefined;
  activeThreadId: string | null | undefined;
  appSettingsLoading: boolean;
  disabledCliEngineIds: readonly string[] | undefined;
  installedEngines: readonly EngineCandidate[];
  setActiveEngine: SetActiveEngine;
};

/**
 * When CLI settings disable the current active engine, migrate home / new-session
 * defaults to the first still-available CLI. Bound historical threads keep their
 * engine until the user leaves them, matching ProviderSelect's in-flight preserve.
 */
export function useAutoMigrateDisabledActiveEngine({
  activeEngine,
  activeThreadEngine,
  activeThreadId,
  appSettingsLoading,
  disabledCliEngineIds,
  installedEngines,
  setActiveEngine,
}: UseAutoMigrateDisabledActiveEngineInput) {
  const setActiveEngineRef = useRef(setActiveEngine);
  useEffect(() => {
    setActiveEngineRef.current = setActiveEngine;
  }, [setActiveEngine]);

  const migratingToRef = useRef<EngineType | null>(null);

  useEffect(() => {
    if (appSettingsLoading) {
      return;
    }

    const preserveDisabledActiveEngine = Boolean(
      activeThreadId &&
        activeThreadEngine &&
        activeThreadEngine === activeEngine,
    );

    const fallback = resolveFallbackEngineWhenDisabled({
      activeEngine,
      disabledCliEngineIds,
      candidates: installedEngines,
      preserveDisabledActiveEngine,
    });

    if (!fallback) {
      migratingToRef.current = null;
      return;
    }

    // Avoid re-entry while an async switch to the same target is in flight.
    if (migratingToRef.current === fallback) {
      return;
    }
    migratingToRef.current = fallback;
    void Promise.resolve(setActiveEngineRef.current(fallback)).finally(() => {
      if (migratingToRef.current === fallback) {
        migratingToRef.current = null;
      }
    });
  }, [
    activeEngine,
    activeThreadEngine,
    activeThreadId,
    appSettingsLoading,
    disabledCliEngineIds,
    installedEngines,
  ]);
}
