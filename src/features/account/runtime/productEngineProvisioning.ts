import {
  getCliInstallPlan,
  runCliInstaller,
} from "../../../services/cliInstallerCommands";
import { activateAccountEngineV1 } from "../../../services/accountEngineCommands";
import { subscribeCliInstallerEvents } from "../../../services/events";
import type {
  CliInstallEngine,
  CliInstallProgressEvent,
  CliInstallStrategy,
} from "../../../types";
import { MANAGED_PROVIDER_PROFILE_ID_V1 } from "./engineEntitlementStore";
import {
  isProductManagedEngineId,
  type ProductRuntimeEngineIdV1,
} from "./productManagedEnginePolicy";
import {
  createManagedEngineToolchainClientV1,
  resolveManagedToolchainEngineIdV1,
  type ManagedEngineToolchainResultV1,
  type ManagedToolchainEngineIdV1,
} from "./managedEngineToolchain";
import {
  createAccountProductOnboardingClientV1,
  type ProductEngineIdV1,
} from "./productOnboardingClient";
import { publishProductReadyV1 } from "./productEntitlementStore";
import { prepareProductWithBoundedRetryV1 } from "./productPrepareRetry";

export type ProductProvisioningEngineIdV1 = ProductRuntimeEngineIdV1;

export type ProductEngineProvisioningPhaseV1 =
  | "idle"
  | "installing"
  | "ready"
  | "error";

export type ProductEngineProvisioningSnapshotV1 = {
  readonly engine: ProductProvisioningEngineIdV1 | null;
  readonly phase: ProductEngineProvisioningPhaseV1;
  readonly errorCode: string | null;
  readonly retryable: boolean;
};

export type EnsureProductEngineReadyInputV1 = {
  readonly engine: string;
  readonly providerProfileId?: string | null;
};

export type ProductEngineProvisioningDependenciesV1 = {
  readonly prepareProduct: (
    engineId: ProductEngineIdV1,
  ) => ReturnType<
    ReturnType<typeof createAccountProductOnboardingClientV1>["prepare"]
  >;
  readonly inspectToolchain: (
    engineId: ManagedToolchainEngineIdV1,
  ) => Promise<ManagedEngineToolchainResultV1>;
  readonly chooseToolchain: ReturnType<
    typeof createManagedEngineToolchainClientV1
  >["choose"];
  readonly activate: (engineId: string) => Promise<void>;
  readonly getInstallPlan: typeof getCliInstallPlan;
  readonly runInstaller: typeof runCliInstaller;
  readonly subscribeInstallerEvents: typeof subscribeCliInstallerEvents;
};

const IDLE_SNAPSHOT: ProductEngineProvisioningSnapshotV1 = Object.freeze({
  engine: null,
  phase: "idle",
  errorCode: null,
  retryable: false,
});

const productClient = createAccountProductOnboardingClientV1();
const managedToolchain = createManagedEngineToolchainClientV1();

const defaultDependencies: ProductEngineProvisioningDependenciesV1 = {
  prepareProduct: (engineId) => productClient.prepare(engineId),
  inspectToolchain: (engineId) => managedToolchain.inspect(engineId),
  chooseToolchain: managedToolchain.choose,
  activate: activateAccountEngineV1,
  getInstallPlan: getCliInstallPlan,
  runInstaller: runCliInstaller,
  subscribeInstallerEvents: subscribeCliInstallerEvents,
};

let snapshot = IDLE_SNAPSHOT;
let generation = 0;
let serialTail: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();
const readyEngines = new Set<ProductProvisioningEngineIdV1>();
const retryOwnerByEngine = new Map<
  ProductProvisioningEngineIdV1,
  {
    readonly input: EnsureProductEngineReadyInputV1;
    readonly dependencies: ProductEngineProvisioningDependenciesV1;
  }
>();
const inFlightByEngine = new Map<
  ProductProvisioningEngineIdV1,
  Promise<void>
>();

export class ProductEngineProvisioningErrorV1 extends Error {
  readonly code: string;
  readonly engine: ProductProvisioningEngineIdV1;

  constructor(engine: ProductProvisioningEngineIdV1, code: string) {
    super(`Product engine provisioning failed: ${engine}/${code}`);
    this.name = "ProductEngineProvisioningErrorV1";
    this.code = code;
    this.engine = engine;
  }
}

export function readProductEngineProvisioningSnapshotV1(): ProductEngineProvisioningSnapshotV1 {
  return snapshot;
}

export function subscribeProductEngineProvisioningV1(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function dismissProductEngineProvisioningV1(): void {
  if (snapshot.phase === "installing") {
    return;
  }
  publishSnapshot(IDLE_SNAPSHOT);
}

export function clearProductEngineProvisioningV1(): void {
  generation += 1;
  readyEngines.clear();
  retryOwnerByEngine.clear();
  publishSnapshot(IDLE_SNAPSHOT);
}

export function retryProductEngineProvisioningV1(): Promise<void> {
  const engine = snapshot.engine;
  if (!engine) return Promise.resolve();
  const owner = retryOwnerByEngine.get(engine);
  if (!owner) return Promise.resolve();
  readyEngines.delete(engine);
  publishSnapshot(IDLE_SNAPSHOT);
  return ensureProductEngineReadyV1(owner.input, owner.dependencies);
}

export function ensureProductEngineReadyV1(
  input: EnsureProductEngineReadyInputV1,
  dependencies: ProductEngineProvisioningDependenciesV1 = defaultDependencies,
): Promise<void> {
  if (input.providerProfileId?.trim() !== MANAGED_PROVIDER_PROFILE_ID_V1) {
    return Promise.resolve();
  }
  const engine = normalizeProductProvisioningEngine(input.engine);
  if (!engine) return Promise.resolve();
  retryOwnerByEngine.set(engine, {
    input: {
      engine,
      providerProfileId: MANAGED_PROVIDER_PROFILE_ID_V1,
    },
    dependencies,
  });
  if (readyEngines.has(engine)) return Promise.resolve();
  const existing = inFlightByEngine.get(engine);
  if (existing) return existing;

  const requestGeneration = generation;
  const run = serialTail
    .catch(() => undefined)
    .then(() => runProvisioning(engine, requestGeneration, dependencies));
  serialTail = run.catch(() => undefined);
  inFlightByEngine.set(engine, run);
  const clearInFlight = () => {
    if (inFlightByEngine.get(engine) === run) {
      inFlightByEngine.delete(engine);
    }
  };
  void run.then(clearInFlight, clearInFlight);
  return run;
}

async function runProvisioning(
  engine: ProductProvisioningEngineIdV1,
  requestGeneration: number,
  dependencies: ProductEngineProvisioningDependenciesV1,
): Promise<void> {
  try {
    const productEngineId = managedEngineId(engine);
    const prepared = await prepareProductWithBoundedRetryV1(() =>
      dependencies.prepareProduct(productEngineId),
    );
    assertCurrent(requestGeneration);
    if (!prepared?.ok) {
      throw new ProductEngineProvisioningErrorV1(
        engine,
        prepared?.error.code ?? "serviceUnavailable",
      );
    }
    publishProductReadyV1(prepared.value);

    let toolchain = await dependencies.inspectToolchain(productEngineId);
    let installerRan = false;
    assertCurrent(requestGeneration);
    if (!toolchain.ok && isInstallerFallbackError(toolchain.error.code)) {
      installerRan = true;
      await installEngine(engine, requestGeneration, dependencies);
      toolchain = await dependencies.inspectToolchain(productEngineId);
      assertCurrent(requestGeneration);
    }
    if (!toolchain.ok) {
      throw new ProductEngineProvisioningErrorV1(engine, toolchain.error.code);
    }
    if (toolchain.value.status === "choiceRequired") {
      if (!toolchain.value.bundledVersion) {
        throw new ProductEngineProvisioningErrorV1(
          engine,
          "engineBundleUnavailable",
        );
      }
      toolchain = await dependencies.chooseToolchain(
        productEngineId,
        "bundled",
        toolchain.value,
      );
      assertCurrent(requestGeneration);
      if (!toolchain.ok || toolchain.value.status !== "ready") {
        throw new ProductEngineProvisioningErrorV1(
          engine,
          toolchain.ok ? "engineBundleUnavailable" : toolchain.error.code,
        );
      }
    }

    if (engine !== "kimi") {
      await dependencies.activate(productEngineId);
      assertCurrent(requestGeneration);
    }
    readyEngines.add(engine);
    if (installerRan) {
      publishCurrent(requestGeneration, {
        engine,
        phase: "ready",
        errorCode: null,
        retryable: false,
      });
    }
  } catch (error) {
    if (requestGeneration !== generation) throw error;
    const normalized = normalizeProvisioningError(engine, error);
    publishSnapshot({
      engine,
      phase: "error",
      errorCode: normalized.code,
      retryable: true,
    });
    throw normalized;
  }
}

async function installEngine(
  engine: ProductProvisioningEngineIdV1,
  requestGeneration: number,
  dependencies: ProductEngineProvisioningDependenciesV1,
): Promise<void> {
  const installerEngine = installerEngineId(engine);
  const strategy = installerStrategy(installerEngine);
  const plan = await dependencies.getInstallPlan(
    installerEngine,
    "installLatest",
    strategy,
  );
  assertCurrent(requestGeneration);
  if (!plan.canRun) {
    throw new ProductEngineProvisioningErrorV1(
      engine,
      "engineInstallerUnavailable",
    );
  }
  const runId = `product-${installerEngine}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  publishCurrent(requestGeneration, {
    engine,
    phase: "installing",
    errorCode: null,
    retryable: false,
  });
  const unsubscribe = dependencies.subscribeInstallerEvents((event) => {
    if (event.runId !== runId || requestGeneration !== generation) return;
    publishInstallerProgress(engine, event);
  });
  try {
    const result = await dependencies.runInstaller(
      installerEngine,
      "installLatest",
      strategy,
      runId,
    );
    assertCurrent(requestGeneration);
    if (!result.ok || result.doctorResult?.ok !== true) {
      throw new ProductEngineProvisioningErrorV1(
        engine,
        "engineInstallVerificationFailed",
      );
    }
  } finally {
    unsubscribe();
  }
}

function publishInstallerProgress(
  engine: ProductProvisioningEngineIdV1,
  event: CliInstallProgressEvent,
) {
  publishSnapshot({
    engine,
    phase: event.phase === "error" ? "error" : "installing",
    errorCode: event.phase === "error" ? "engineInstallFailed" : null,
    retryable: event.phase === "error",
  });
}

function normalizeProductProvisioningEngine(
  engine: string,
): ProductProvisioningEngineIdV1 | null {
  return isProductManagedEngineId(engine) ? engine : null;
}

function managedEngineId(
  engine: ProductProvisioningEngineIdV1,
): ProductEngineIdV1 {
  const resolved = resolveManagedToolchainEngineIdV1(engine);
  if (!resolved) {
    throw new Error("Managed Product engine mapping is unavailable");
  }
  return resolved;
}

function installerEngineId(
  engine: ProductProvisioningEngineIdV1,
): CliInstallEngine {
  return engine;
}

function installerStrategy(engine: CliInstallEngine): CliInstallStrategy {
  return engine === "claude" ? "officialNative" : "npmGlobal";
}

function isInstallerFallbackError(code: string): boolean {
  return (
    code === "engineBundleUnavailable" ||
    code === "engineBundleVerificationFailed"
  );
}

function normalizeProvisioningError(
  engine: ProductProvisioningEngineIdV1,
  error: unknown,
): ProductEngineProvisioningErrorV1 {
  if (error instanceof ProductEngineProvisioningErrorV1) return error;
  return new ProductEngineProvisioningErrorV1(
    engine,
    error instanceof Error && error.name === "ProductEngineProvisioningStale"
      ? "staleRequest"
      : "serviceUnavailable",
  );
}

function assertCurrent(requestGeneration: number): void {
  if (requestGeneration !== generation) {
    const error = new Error("Product engine provisioning request is stale");
    error.name = "ProductEngineProvisioningStale";
    throw error;
  }
}

function publishCurrent(
  requestGeneration: number,
  next: ProductEngineProvisioningSnapshotV1,
): void {
  if (requestGeneration === generation) publishSnapshot(next);
}

function publishSnapshot(next: ProductEngineProvisioningSnapshotV1): void {
  snapshot = Object.freeze({ ...next });
  listeners.forEach((listener) => listener());
}
