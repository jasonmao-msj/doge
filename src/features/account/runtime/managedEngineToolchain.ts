import { resolveAccountEngineToolchainV1 } from "../../../services/accountEngineCommands";
import type { ManagedEngineIdV1 } from "./engineOnboardingClient";

export type ManagedEngineToolchainChoiceV1 = "bundled" | "external";

export type ManagedEngineToolchainViewV1 = {
  readonly engineId: ManagedEngineIdV1;
  readonly status: "ready" | "choiceRequired";
  readonly bundledVersion: string;
  readonly externalVersion: string | null;
  readonly selectedSource: ManagedEngineToolchainChoiceV1 | null;
};

export type ManagedEngineToolchainResultV1 =
  | { readonly ok: true; readonly value: ManagedEngineToolchainViewV1 }
  | { readonly ok: false; readonly error: { readonly code: string } };

export type ManagedEngineToolchainClientV1 = {
  readonly inspect: (engineId: ManagedEngineIdV1) => Promise<ManagedEngineToolchainResultV1>;
  readonly choose: (
    engineId: ManagedEngineIdV1,
    choice: ManagedEngineToolchainChoiceV1,
    versions: Pick<ManagedEngineToolchainViewV1, "bundledVersion" | "externalVersion">,
  ) => Promise<ManagedEngineToolchainResultV1>;
};

type ToolchainDependenciesV1 = {
  readonly resolve: (
    engineId: ManagedEngineIdV1,
    choice: ManagedEngineToolchainChoiceV1 | null,
  ) => Promise<unknown>;
  readonly storage: Pick<Storage, "getItem" | "setItem"> | null;
};

const defaultDependencies: ToolchainDependenciesV1 = {
  resolve: resolveAccountEngineToolchainV1,
  storage: typeof window === "undefined" ? null : window.localStorage,
};

export function createManagedEngineToolchainClientV1(
  dependencies: ToolchainDependenciesV1 = defaultDependencies,
): ManagedEngineToolchainClientV1 {
  const resolveToolchain = async (
    engineId: ManagedEngineIdV1,
    choice: ManagedEngineToolchainChoiceV1 | null,
  ) => parseToolchainResultV1(await dependencies.resolve(engineId, choice));

  return {
    inspect: async (engineId) => {
      const inspected = await resolveToolchain(engineId, null);
      if (!inspected.ok || inspected.value.status !== "choiceRequired") return inspected;
      const remembered = readRememberedChoice(dependencies.storage, engineId, inspected.value);
      return remembered ? resolveToolchain(engineId, remembered) : inspected;
    },
    choose: async (engineId, choice, versions) => {
      const selected = await resolveToolchain(engineId, choice);
      if (selected.ok && selected.value.status === "ready") {
        rememberChoice(dependencies.storage, engineId, versions, choice);
      }
      return selected;
    },
  };
}

function parseToolchainResultV1(value: unknown): ManagedEngineToolchainResultV1 {
  const envelope = asObject(value);
  if (!envelope || typeof envelope.ok !== "boolean") return protocolFailure();
  if (!envelope.ok) {
    const error = asObject(envelope.error);
    return error && typeof error.code === "string"
      ? { ok: false, error: { code: error.code } }
      : protocolFailure();
  }
  const view = asObject(envelope.value);
  if (!view || !isManagedEngineId(view.engineId) ||
    !["ready", "choiceRequired"].includes(String(view.status)) ||
    typeof view.bundledVersion !== "string" ||
    !(typeof view.externalVersion === "string" || view.externalVersion === null) ||
    !["bundled", "external", null].includes(view.selectedSource as never)) {
    return protocolFailure();
  }
  const status = view.status as ManagedEngineToolchainViewV1["status"];
  const selectedSource = view.selectedSource as ManagedEngineToolchainViewV1["selectedSource"];
  if ((status === "choiceRequired" && selectedSource !== null) ||
    (status === "ready" && selectedSource === null)) return protocolFailure();
  return {
    ok: true,
    value: {
      engineId: view.engineId,
      status,
      bundledVersion: view.bundledVersion,
      externalVersion: view.externalVersion,
      selectedSource,
    },
  };
}

function preferenceKey(
  engineId: ManagedEngineIdV1,
  versions: Pick<ManagedEngineToolchainViewV1, "bundledVersion" | "externalVersion">,
) {
  return `doge.account.toolchain-choice.v1:${engineId}:${versions.externalVersion ?? "none"}:${versions.bundledVersion}`;
}

function readRememberedChoice(
  storage: ToolchainDependenciesV1["storage"],
  engineId: ManagedEngineIdV1,
  versions: Pick<ManagedEngineToolchainViewV1, "bundledVersion" | "externalVersion">,
): ManagedEngineToolchainChoiceV1 | null {
  try {
    const value = storage?.getItem(preferenceKey(engineId, versions));
    return value === "bundled" || value === "external" ? value : null;
  } catch {
    return null;
  }
}

function rememberChoice(
  storage: ToolchainDependenciesV1["storage"],
  engineId: ManagedEngineIdV1,
  versions: Pick<ManagedEngineToolchainViewV1, "bundledVersion" | "externalVersion">,
  choice: ManagedEngineToolchainChoiceV1,
) {
  try {
    storage?.setItem(preferenceKey(engineId, versions), choice);
  } catch {
    // A locked/unavailable web storage must not block the selected engine.
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isManagedEngineId(value: unknown): value is ManagedEngineIdV1 {
  return value === "codex" || value === "claude-code";
}

function protocolFailure(): ManagedEngineToolchainResultV1 {
  return { ok: false, error: { code: "protocolMismatch" } };
}
