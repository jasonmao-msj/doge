/**
 * Shared Recovery Exit Ladder 开关（fix-shared-session-recovery-exit-closure）。
 *
 * 开启时 UI 暴露 Stop / 停止并重建 / 放弃本轮；关闭时回退 Probe+Rebuild 双按钮（旧行为）。
 * 默认 on；localStorage `doge.sharedRecoveryExitV2` 或 `VITE_DOGE_SHARED_RECOVERY_EXIT_V2` 可关。
 */

export const SHARED_RECOVERY_EXIT_V2_STORAGE_KEY = "doge.sharedRecoveryExitV2";
const LEGACY_SHARED_RECOVERY_EXIT_V2_STORAGE_KEY = "mossx.sharedRecoveryExitV2";

function isEnabledFlag(value: unknown) {
  return typeof value === "string" && /^(1|true|yes|on)$/i.test(value.trim());
}

function isDisabledFlag(value: unknown) {
  return typeof value === "string" && /^(0|false|no|off)$/i.test(value.trim());
}

function parseBooleanFlag(value: unknown): boolean | null {
  if (isEnabledFlag(value)) {
    return true;
  }
  if (isDisabledFlag(value)) {
    return false;
  }
  return null;
}

function readStorageFlag(key: string): boolean | null {
  try {
    if (typeof window === "undefined") {
      return null;
    }
    return parseBooleanFlag(window.localStorage.getItem(key));
  } catch {
    return null;
  }
}

/** Recovery Exit Ladder：local override > build flag > default-on。 */
export function isSharedRecoveryExitV2Enabled() {
  const localOverride = readStorageFlag(SHARED_RECOVERY_EXIT_V2_STORAGE_KEY);
  if (localOverride !== null) {
    return localOverride;
  }
  const legacyLocalOverride = readStorageFlag(
    LEGACY_SHARED_RECOVERY_EXIT_V2_STORAGE_KEY,
  );
  if (legacyLocalOverride !== null) {
    return legacyLocalOverride;
  }
  return (
    parseBooleanFlag(
      import.meta.env.VITE_DOGE_SHARED_RECOVERY_EXIT_V2 ??
        import.meta.env.VITE_MOSSX_SHARED_RECOVERY_EXIT_V2,
    ) ?? true
  );
}
