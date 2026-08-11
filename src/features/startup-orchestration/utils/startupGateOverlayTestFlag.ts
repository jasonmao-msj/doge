export const STARTUP_GATE_OVERLAY_TEST_FLAG_KEY =
  "doge.startupGateOverlay.test";

function getLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function isStartupGateOverlayTestEnabled(): boolean {
  const storage = getLocalStorage();
  if (!storage) {
    return false;
  }
  try {
    return storage.getItem(STARTUP_GATE_OVERLAY_TEST_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

export function setStartupGateOverlayTestEnabled(enabled: boolean): void {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }
  try {
    if (enabled) {
      storage.setItem(STARTUP_GATE_OVERLAY_TEST_FLAG_KEY, "1");
    } else {
      storage.removeItem(STARTUP_GATE_OVERLAY_TEST_FLAG_KEY);
    }
  } catch {
    // localStorage 仅作本机测试偏好；不可用时安全回退为默认关闭。
  }
}
