export type AccountExternalCallKindV1 =
  | "fetch"
  | "tauriInvoke"
  | "nativeOpen";

export type AccountExternalCallAttemptV1 = {
  readonly kind: AccountExternalCallKindV1;
};

export type AccountZeroCallGuardV1 = {
  readonly attempts: readonly AccountExternalCallAttemptV1[];
  assertNoCalls(): void;
  restore(): void;
};

type MutableRecord = Record<string, unknown>;

function asMutableRecord(value: unknown): MutableRecord | null {
  return typeof value === "object" && value !== null
    ? (value as MutableRecord)
    : null;
}

function replaceFunction(
  owner: MutableRecord,
  key: string,
  kind: AccountExternalCallKindV1,
  attempts: AccountExternalCallAttemptV1[],
  restorers: Array<() => void>,
): void {
  const original = owner[key];
  if (typeof original !== "function") {
    return;
  }
  owner[key] = () => {
    attempts.push({ kind });
    throw new Error(`Account Mock zero-call guard blocked ${kind}`);
  };
  restorers.push(() => {
    owner[key] = original;
  });
}

export function installAccountZeroCallGuardV1(
  root: MutableRecord = globalThis as unknown as MutableRecord,
): AccountZeroCallGuardV1 {
  const attempts: AccountExternalCallAttemptV1[] = [];
  const restorers: Array<() => void> = [];

  replaceFunction(root, "fetch", "fetch", attempts, restorers);

  const tauriInternals = asMutableRecord(root.__TAURI_INTERNALS__);
  if (tauriInternals !== null) {
    replaceFunction(
      tauriInternals,
      "invoke",
      "tauriInvoke",
      attempts,
      restorers,
    );
  }

  const tauri = asMutableRecord(root.__TAURI__);
  const tauriCore = asMutableRecord(tauri?.core);
  if (tauriCore !== null) {
    replaceFunction(
      tauriCore,
      "invoke",
      "tauriInvoke",
      attempts,
      restorers,
    );
  }
  const tauriOpener = asMutableRecord(tauri?.opener);
  if (tauriOpener !== null) {
    replaceFunction(
      tauriOpener,
      "openUrl",
      "nativeOpen",
      attempts,
      restorers,
    );
  }

  return {
    get attempts() {
      return attempts;
    },
    assertNoCalls() {
      if (attempts.length > 0) {
        throw new Error(
          `Account Mock performed external calls: ${attempts.map((attempt) => attempt.kind).join(", ")}`,
        );
      }
    },
    restore() {
      for (let index = restorers.length - 1; index >= 0; index -= 1) {
        restorers[index]?.();
      }
    },
  };
}
