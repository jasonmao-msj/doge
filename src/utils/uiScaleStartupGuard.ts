/**
 * Startup guard for the uiScale freeze loop (P0, 2026-08-06).
 *
 * Background: a non-100% interface scale has frozen the renderer in the field
 * (WebView2 SetZoomFactor proven; WKWebView pageZoom reported). The worst part
 * of that failure mode is the lock-out loop: the freeze happens at startup,
 * before the user can reach Settings to change the scale back, so every launch
 * freezes again.
 *
 * This module is the escape hatch:
 * - Whenever a non-identity scale is APPLIED, a pending record is written to
 *   localStorage (synchronous, survives a frozen/killed renderer).
 * - If the renderer proves itself alive within HEALTHY_CONFIRM_DELAY_MS (a
 *   requestAnimationFrame fires → the paint pipeline is not wedged), or the
 *   page hides cleanly, the record is cleared.
 * - On the next launch, a leftover pending record means "last session applied
 *   this scale and never proved healthy" → the caller applies scale 1 for that
 *   session only. The stored user setting is never rewritten.
 */

const STORAGE_KEY = "doge.uiScaleStartupGuard.v1";
const HEALTHY_CONFIRM_DELAY_MS = 8_000;

export type UiScaleStartupGuardRecord = {
  scale: number;
  markedAt: number;
};

let healthyConfirmTimer: number | null = null;
let pagehideHookInstalled = false;

function canUseLocalStorage(): boolean {
  try {
    return typeof globalThis.localStorage !== "undefined";
  } catch {
    return false;
  }
}

function readRecord(): UiScaleStartupGuardRecord | null {
  if (!canUseLocalStorage()) {
    return null;
  }
  try {
    const raw = globalThis.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as UiScaleStartupGuardRecord).scale !== "number" ||
      !Number.isFinite((parsed as UiScaleStartupGuardRecord).scale) ||
      typeof (parsed as UiScaleStartupGuardRecord).markedAt !== "number"
    ) {
      return null;
    }
    return parsed as UiScaleStartupGuardRecord;
  } catch {
    return null;
  }
}

function writeRecord(record: UiScaleStartupGuardRecord | null): void {
  if (!canUseLocalStorage()) {
    return;
  }
  try {
    if (record === null) {
      globalThis.localStorage.removeItem(STORAGE_KEY);
    } else {
      globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    }
  } catch {
    // Best effort — the guard must never break scale application.
  }
}

function cancelHealthyConfirm(): void {
  if (healthyConfirmTimer !== null && typeof window !== "undefined") {
    window.clearTimeout(healthyConfirmTimer);
  }
  healthyConfirmTimer = null;
}

/** A pending record means the previous session never proved healthy at ≠1. */
export function shouldForceUiScaleIdentity(): boolean {
  return readRecord() !== null;
}

/** @internal exposed for tests */
export function readUiScaleStartupGuardRecord(): UiScaleStartupGuardRecord | null {
  return readRecord();
}

/** Clear the pending record: scale 1 applied, or renderer proven healthy. */
export function confirmUiScaleHealthy(): void {
  cancelHealthyConfirm();
  writeRecord(null);
}

function installPagehideHook(): void {
  if (pagehideHookInstalled || typeof window === "undefined") {
    return;
  }
  pagehideHookInstalled = true;
  // Clean exit before the healthy timer fires is proof enough — without this,
  // closing the window quickly would force scale 1 on the next launch.
  window.addEventListener("pagehide", () => {
    confirmUiScaleHealthy();
  });
}

/**
 * Record that a non-identity scale was just applied. If the renderer survives
 * to paint HEALTHY_CONFIRM_DELAY_MS later (rAF fires), the record clears
 * itself; a freeze leaves it behind for the next launch to find.
 */
export function markUiScalePending(scale: number): void {
  cancelHealthyConfirm();
  writeRecord({ scale, markedAt: Date.now() });
  installPagehideHook();
  if (typeof window === "undefined") {
    return;
  }
  healthyConfirmTimer = window.setTimeout(() => {
    healthyConfirmTimer = null;
    // setTimeout alone can fire on a live-but-stalled main thread; requiring a
    // rAF tick proves the paint pipeline actually ran.
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => confirmUiScaleHealthy());
    } else {
      confirmUiScaleHealthy();
    }
  }, HEALTHY_CONFIRM_DELAY_MS);
}

/** @internal test helper */
export function resetUiScaleStartupGuardForTests(): void {
  cancelHealthyConfirm();
  writeRecord(null);
  pagehideHookInstalled = false;
}
