const ACCOUNT_ENGINE_SWITCH_EVENT = "doge:account-engine-switch";

export function requestAccountEngineSwitchV1() {
  window.dispatchEvent(new Event(ACCOUNT_ENGINE_SWITCH_EVENT));
}

export function subscribeAccountEngineSwitchV1(listener: () => void) {
  window.addEventListener(ACCOUNT_ENGINE_SWITCH_EVENT, listener);
  return () => window.removeEventListener(ACCOUNT_ENGINE_SWITCH_EVENT, listener);
}
