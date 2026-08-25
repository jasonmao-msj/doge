import { useCallback, useEffect, useState } from "react";
import type { CliInstallEngine, CliVersionStatus } from "@/types";
import { getCliVersionStatus } from "@/services/tauri";
import {
  createManagedEngineToolchainClientV1,
  resolveManagedToolchainEngineIdV1,
  type ManagedToolchainEngineIdV1,
} from "@/features/account/runtime/managedEngineToolchain";

type UseCliVersionStatusOptions = {
  engine: CliInstallEngine;
  enabled?: boolean;
};

/** Session-local cache so CLI switch can paint last-known version immediately. */
const cliVersionStatusCache = new Map<CliInstallEngine, CliVersionStatus>();
const managedToolchain = createManagedEngineToolchainClientV1();

async function resolveManagedStatus(
  engine: CliInstallEngine,
  managedEngineId: ManagedToolchainEngineIdV1,
): Promise<CliVersionStatus> {
  const result = await managedToolchain.inspect(managedEngineId);
  if (!result.ok) {
    return {
      engine,
      installed: false,
      localVersion: null,
      latestVersion: null,
      updateAvailable: false,
      nodeOk: false,
      details: `Managed ${engine} toolchain is unavailable: ${result.error.code}`,
    };
  }

  const { value } = result;
  const ready = value.status === "ready";
  const localVersion = value.selectedSource === "external"
    ? value.externalVersion ?? value.bundledVersion
    : value.bundledVersion;
  return {
    engine,
    installed: ready,
    localVersion: ready ? localVersion : null,
    // The bundled manifest is a verified version, not an upstream latest
    // version. Avoid rendering a false "Up to date" claim.
    latestVersion: null,
    updateAvailable: false,
    // Managed engines are verified from the bundled toolchain; Node/npm is
    // not part of the managed runtime contract.
    nodeOk: ready,
    details: ready
      ? `Managed ${engine} toolchain (${value.selectedSource ?? "unknown"})`
      : `Managed ${engine} toolchain requires a source selection.`,
  };
}

async function resolveStatus(engine: CliInstallEngine): Promise<CliVersionStatus> {
  const managedEngineId = resolveManagedToolchainEngineIdV1(engine);
  return managedEngineId
    ? resolveManagedStatus(engine, managedEngineId)
    : getCliVersionStatus(engine);
}

function readCachedStatus(engine: CliInstallEngine): CliVersionStatus | null {
  return cliVersionStatusCache.get(engine) ?? null;
}

export function useCliVersionStatus({
  engine,
  enabled = true,
}: UseCliVersionStatusOptions) {
  const cached = enabled ? readCachedStatus(engine) : null;
  const [status, setStatus] = useState<CliVersionStatus | null>(cached);
  // Avoid first paint flashing "not installed" before the effect runs.
  const [loading, setLoading] = useState(() => enabled && cached === null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await resolveStatus(engine);
      // Guard against out-of-order responses if engine/enabled flips mid-flight.
      if (next.engine && next.engine !== engine) {
        return;
      }
      cliVersionStatusCache.set(engine, next);
      setStatus(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      // Keep cached status if any; only clear when we had nothing to show.
      setStatus((previous) => previous ?? readCachedStatus(engine));
    } finally {
      setLoading(false);
    }
  }, [enabled, engine]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const nextCached = readCachedStatus(engine);
    setStatus(nextCached);
    // Soft refresh when cache hits; hard loading only when cold.
    setLoading(nextCached === null);
    void refresh();
  }, [enabled, engine, refresh]);

  return {
    status,
    loading,
    error,
    refresh,
  };
}
