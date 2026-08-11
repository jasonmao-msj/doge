/**
 * Shared V2 Send 开关（Wave 4 / Change B）。
 *
 * 职责：控制 Shared Session 发送链路是否走 V2（begin_turn → send → commit_turn
 * durable-first 编排）。Phase 2 完成后默认开启；显式 negative flag 回滚 V0。
 *
 * 形态沿用 `sharedProjection/dataSource.ts` 的 flag 惯例：
 * build flag（`VITE_DOGE_SHARED_V2_SEND`）或 localStorage override 任一开启即生效。
 */

export const SHARED_V2_SEND_STORAGE_KEY = "doge.sharedV2Send";
const LEGACY_SHARED_V2_SEND_STORAGE_KEY = "mossx.sharedV2Send";

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

/** 当前 local override 是否生效（供设置页/测试读取）。 */
export function isSharedV2SendOverrideEnabled() {
  return readStorageFlag(SHARED_V2_SEND_STORAGE_KEY) === true;
}

/**
 * 写入 rollout override。`true` 开启；`false` 显式回滚 V0；
 * `null` 删除 key，回到 build flag / default-on 判定。
 * 返回值表示 storage 是否实际变化，供调用方决定是否 reload。
 */
export function setSharedV2SendOverride(enabled: boolean | null) {
  try {
    if (typeof window === "undefined") {
      return false;
    }
    const currentValue = window.localStorage.getItem(SHARED_V2_SEND_STORAGE_KEY);
    if (enabled !== null) {
      const nextValue = enabled ? "1" : "0";
      if (currentValue === nextValue) {
        return false;
      }
      window.localStorage.setItem(SHARED_V2_SEND_STORAGE_KEY, nextValue);
      return true;
    }
    if (currentValue === null) {
      return false;
    }
    window.localStorage.removeItem(SHARED_V2_SEND_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Shared V2 Send 开关：local override > build flag > default-on。 */
export function isSharedV2SendEnabled() {
  const localOverride = readStorageFlag(SHARED_V2_SEND_STORAGE_KEY);
  if (localOverride !== null) {
    return localOverride;
  }
  const legacyLocalOverride = readStorageFlag(LEGACY_SHARED_V2_SEND_STORAGE_KEY);
  if (legacyLocalOverride !== null) {
    return legacyLocalOverride;
  }
  return (
    parseBooleanFlag(
      import.meta.env.VITE_DOGE_SHARED_V2_SEND ??
        import.meta.env.VITE_MOSSX_SHARED_V2_SEND,
    ) ?? true
  );
}
