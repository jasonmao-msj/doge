import type { ManagedEngineIdV1 } from "./onboardingTypes";

const ACCOUNT_ENGINE_SWITCH_EVENT = "doge:account-engine-switch";
const ACCOUNT_ENGINE_READY_EVENT = "doge:account-engine-ready";

export type AccountEngineSwitchIntentV1 = {
  readonly source: "accountCenter" | "enginePicker";
  readonly targetEngineId: ManagedEngineIdV1 | null;
  readonly openNewConversation: boolean;
};

export type AccountEngineReadyIntentV1 = {
  readonly engineId: ManagedEngineIdV1;
  readonly openNewConversation: boolean;
};

const DEFAULT_SWITCH_INTENT: AccountEngineSwitchIntentV1 = {
  source: "accountCenter",
  targetEngineId: null,
  openNewConversation: true,
};

export function requestAccountEngineSwitchV1(
  intent: AccountEngineSwitchIntentV1 = DEFAULT_SWITCH_INTENT,
) {
  window.dispatchEvent(new CustomEvent(ACCOUNT_ENGINE_SWITCH_EVENT, { detail: intent }));
}

export function subscribeAccountEngineSwitchV1(
  listener: (intent: AccountEngineSwitchIntentV1) => void,
) {
  const handleEvent = (event: Event) => {
    listener(readSwitchIntent(event));
  };
  window.addEventListener(ACCOUNT_ENGINE_SWITCH_EVENT, handleEvent);
  return () => window.removeEventListener(ACCOUNT_ENGINE_SWITCH_EVENT, handleEvent);
}

export function publishAccountEngineReadyV1(intent: AccountEngineReadyIntentV1) {
  window.dispatchEvent(new CustomEvent(ACCOUNT_ENGINE_READY_EVENT, { detail: intent }));
}

export function subscribeAccountEngineReadyV1(
  listener: (intent: AccountEngineReadyIntentV1) => void,
) {
  const handleEvent = (event: Event) => {
    const intent = readReadyIntent(event);
    if (intent) listener(intent);
  };
  window.addEventListener(ACCOUNT_ENGINE_READY_EVENT, handleEvent);
  return () => window.removeEventListener(ACCOUNT_ENGINE_READY_EVENT, handleEvent);
}

function readSwitchIntent(event: Event): AccountEngineSwitchIntentV1 {
  if (!(event instanceof CustomEvent) || !isObject(event.detail)) {
    return DEFAULT_SWITCH_INTENT;
  }
  const source = event.detail.source;
  const targetEngineId = event.detail.targetEngineId;
  const openNewConversation = event.detail.openNewConversation;
  if (
    (source !== "accountCenter" && source !== "enginePicker") ||
    (targetEngineId !== null && targetEngineId !== "codex" && targetEngineId !== "claude-code") ||
    typeof openNewConversation !== "boolean"
  ) {
    return DEFAULT_SWITCH_INTENT;
  }
  return { source, targetEngineId, openNewConversation };
}

function readReadyIntent(event: Event): AccountEngineReadyIntentV1 | null {
  if (!(event instanceof CustomEvent) || !isObject(event.detail)) return null;
  const engineId = event.detail.engineId;
  const openNewConversation = event.detail.openNewConversation;
  if (
    (engineId !== "codex" && engineId !== "claude-code") ||
    typeof openNewConversation !== "boolean"
  ) {
    return null;
  }
  return { engineId, openNewConversation };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
