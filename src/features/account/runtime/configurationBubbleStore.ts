import { useSyncExternalStore } from "react";

let visible = false;
let reopenRequested = false;
const listeners = new Set<() => void>();

function notifyV1() {
  listeners.forEach((listener) => listener());
}

export function setAccountConfigurationBubbleVisibleV1(nextVisible: boolean) {
  if (visible === nextVisible) return;
  visible = nextVisible;
  notifyV1();
}

export function requestAccountConfigurationReopenV1() {
  visible = false;
  reopenRequested = true;
  notifyV1();
}

export function consumeAccountConfigurationReopenV1() {
  if (!reopenRequested) return;
  reopenRequested = false;
  notifyV1();
}

export function useAccountConfigurationBubbleVisibleV1(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => visible,
    () => false,
  );
}

export function useAccountConfigurationReopenRequestedV1(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => reopenRequested,
    () => false,
  );
}
