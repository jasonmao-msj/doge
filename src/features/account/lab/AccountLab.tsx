import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { AccountGatewayConsumerShell } from "../components/AccountGatewayConsumerShell";
import { AccountGatewayProvider } from "../gateway/AccountGatewayProvider";
import { accountLabEnV1 } from "../locale/en";
import { accountLabZhV1 } from "../locale/zh";
import { createMockAccountGatewayV1 } from "../mock/MockAccountGatewayV1";
import {
  ACCOUNT_FRONTEND_SCENARIOS_V1,
  createScenarioRuntimeV1,
  type ScenarioFaultV1,
  type ScenarioRuntimeSnapshotV1,
  type ScenarioRuntimeV1,
} from "../mock/ScenarioRuntimeV1";
import { installAccountZeroCallGuardV1 } from "../testing/zeroCallGuard";
import "./account-lab.css";

const LAB_SCENARIO_GROUPS_V1 = [
  {
    labelKey: "authenticationGroup",
    prefixes: ["register.", "login.", "oauth.", "password-reset."],
  },
  {
    labelKey: "configurationGroup",
    prefixes: ["configuration.", "managed-key."],
  },
  {
    labelKey: "offlineGroup",
    prefixes: ["bootstrap.", "local-mode.", "vault.", "auth.offline"],
  },
] as const;

const LAB_FAULT_OPTIONS_V1: readonly (ScenarioFaultV1 | null)[] = [
  null,
  "offline",
  "serviceUnavailable",
  "lostResponse",
  "vaultUnavailable",
  "concurrentEdit",
  "rollbackFailure",
  "unknownEnum",
  "unsupportedMajor",
];

const DEFAULT_SCENARIO_ID_V1 = "bootstrap.signed-out-happy";

export type AccountLabProps = {
  readonly initialScenarioId?: string;
  readonly language?: "en" | "zh";
};

type RuntimeSelectionV1 =
  | { readonly ok: true; readonly runtime: ScenarioRuntimeV1 }
  | { readonly ok: false; readonly scenarioId: string };

function createRuntimeSelectionV1(scenarioId: string): RuntimeSelectionV1 {
  const result = createScenarioRuntimeV1(scenarioId);
  return result.ok
    ? { ok: true, runtime: result.value }
    : { ok: false, scenarioId };
}

function useScenarioSnapshotV1(runtime: ScenarioRuntimeV1) {
  return useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
}

function ScenarioStatus({
  snapshot,
  labels,
}: {
  readonly snapshot: ScenarioRuntimeSnapshotV1;
  readonly labels: {
    readonly status: string;
    readonly virtualTime: string;
    readonly progress: string;
    readonly pending: string;
  };
}) {
  return (
    <dl className="account-lab-status-grid">
      <div>
        <dt>{labels.status}</dt>
        <dd>{snapshot.status}</dd>
      </div>
      <div>
        <dt>{labels.virtualTime}</dt>
        <dd>{snapshot.nowIso}</dd>
      </div>
      <div>
        <dt>{labels.progress}</dt>
        <dd>{snapshot.operationCursor}/{snapshot.operationCount}</dd>
      </div>
      <div>
        <dt>{labels.pending}</dt>
        <dd>{snapshot.pendingCount}</dd>
      </div>
    </dl>
  );
}

function ScenarioHistory({
  snapshot,
  emptyLabel,
}: {
  readonly snapshot: ScenarioRuntimeSnapshotV1;
  readonly emptyLabel: string;
}) {
  return (
    <ol className="account-lab-history" aria-live="polite">
      {snapshot.history.length === 0 ? <li>{emptyLabel}</li> : null}
      {snapshot.history.map((entry) => (
        <li key={entry.sequence}>
          <time>{entry.atMs}ms</time>
          <span>{entry.kind}</span>
          <code>{entry.operation ?? entry.detail}</code>
          {entry.operation === null ? null : <small>{entry.detail}</small>}
        </li>
      ))}
    </ol>
  );
}

function AccountLabRuntime({
  runtime,
  language,
  onSelectScenario,
}: {
  readonly runtime: ScenarioRuntimeV1;
  readonly language: "en" | "zh";
  readonly onSelectScenario: (scenarioId: string) => void;
}) {
  const copy = language === "zh" ? accountLabZhV1 : accountLabEnV1;
  const snapshot = useScenarioSnapshotV1(runtime);
  const gateway = useMemo(() => createMockAccountGatewayV1(runtime), [runtime]);
  const [lastOutcome, setLastOutcome] = useState("idle");

  useEffect(() => {
    if (import.meta.env.MODE !== "test" && import.meta.env.DEV !== true) {
      return undefined;
    }
    const guard = installAccountZeroCallGuardV1();
    return () => {
      try {
        guard.assertNoCalls();
      } finally {
        guard.restore();
      }
    };
  }, []);

  const runNext = useCallback(() => {
    setLastOutcome("pending");
    void runtime.runNext().then((resolution) => {
      setLastOutcome(resolution.result);
    });
  }, [runtime]);

  const setFault = useCallback(
    (value: string) => {
      runtime.setFault(
        LAB_FAULT_OPTIONS_V1.find((option) => option === value) ?? null,
      );
    },
    [runtime],
  );

  return (
    <AccountGatewayProvider gateway={gateway}>
      <main className="account-lab" data-testid="account-lab">
        <header className="account-lab-header">
          <div>
            <p className="account-lab-eyebrow">{copy.eyebrow}</p>
            <h1>{copy.title}</h1>
            <p>{copy.subtitle}</p>
          </div>
          <span className="account-lab-local-mode">{copy.localMode}</span>
        </header>

        <AccountGatewayConsumerShell
          eyebrow={copy.consumerEyebrow}
          title={copy.consumerTitle}
          description={copy.consumerDescription}
          contractLabel={copy.contractLabel}
        />

        <section className="account-lab-panel" aria-labelledby="account-lab-controls-title">
          <div className="account-lab-panel-heading">
            <div>
              <p className="account-lab-eyebrow">{copy.scenario}</p>
              <h2 id="account-lab-controls-title">{runtime.scenario.id}</h2>
            </div>
            <output aria-label={copy.lastOutcome}>{lastOutcome}</output>
          </div>

          <div className="account-lab-controls">
            <label>
              <span>{copy.scenario}</span>
              <select
                value={runtime.scenario.id}
                onChange={(event) => onSelectScenario(event.target.value)}
              >
                {LAB_SCENARIO_GROUPS_V1.map((group) => {
                  const scenarios = ACCOUNT_FRONTEND_SCENARIOS_V1.filter((scenario) =>
                    group.prefixes.some((prefix) => scenario.id.startsWith(prefix)),
                  );
                  return scenarios.length === 0 ? null : (
                    <optgroup
                      key={group.labelKey}
                      label={copy[group.labelKey]}
                    >
                      {scenarios.map((scenario) => (
                        <option key={scenario.id} value={scenario.id}>
                          {scenario.id}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
            </label>
            <label>
              <span>{copy.fault}</span>
              <select
                value={snapshot.injectedFault ?? ""}
                onChange={(event) => setFault(event.target.value)}
              >
                {LAB_FAULT_OPTIONS_V1.map((fault) => (
                  <option key={fault ?? "none"} value={fault ?? ""}>
                    {fault ?? copy.noFault}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <ScenarioStatus snapshot={snapshot} labels={copy} />

          <div className="account-lab-actions">
            <button
              type="button"
              onClick={runNext}
              disabled={snapshot.nextOperation === null}
            >
              {copy.runNext}
            </button>
            <button type="button" onClick={() => runtime.advanceToNext()}>
              {copy.advanceNext}
            </button>
            <button type="button" onClick={() => runtime.advanceBy(1_000)}>
              {copy.advanceOneSecond}
            </button>
            <button
              type="button"
              onClick={() => runtime.reset()}
              disabled={snapshot.pendingCount > 0}
            >
              {copy.reset}
            </button>
          </div>

          <div className="account-lab-next-operation">
            <span>{copy.nextOperation}</span>
            <code>{snapshot.nextOperation ?? copy.complete}</code>
          </div>
        </section>

        <section className="account-lab-panel" aria-labelledby="account-lab-history-title">
          <div className="account-lab-panel-heading">
            <h2 id="account-lab-history-title">{copy.history}</h2>
            <span>{snapshot.history.length}</span>
          </div>
          <ScenarioHistory snapshot={snapshot} emptyLabel={copy.emptyHistory} />
        </section>
      </main>
    </AccountGatewayProvider>
  );
}

function AccountLabContent({
  initialScenarioId = DEFAULT_SCENARIO_ID_V1,
  language = "en",
}: AccountLabProps) {
  const [selection, setSelection] = useState<RuntimeSelectionV1>(() =>
    createRuntimeSelectionV1(initialScenarioId),
  );
  const copy = language === "zh" ? accountLabZhV1 : accountLabEnV1;

  const selectScenario = useCallback((scenarioId: string) => {
    setSelection(createRuntimeSelectionV1(scenarioId));
  }, []);

  if (!selection.ok) {
    return (
      <main className="account-lab account-lab--closed" role="alert">
        <h1>{copy.title}</h1>
        <p>{copy.unknownScenario}</p>
        <code>{selection.scenarioId}</code>
      </main>
    );
  }

  return (
    <AccountLabRuntime
      key={selection.runtime.scenario.id}
      runtime={selection.runtime}
      language={language}
      onSelectScenario={selectScenario}
    />
  );
}

export function AccountLab(props: AccountLabProps) {
  return isAccountLabAvailableV1() ? <AccountLabContent {...props} /> : null;
}

export function isAccountLabAvailableV1(): boolean {
  return import.meta.env.MODE === "test" ||
    (import.meta.env.DEV === true &&
      import.meta.env.VITE_DOGE_ACCOUNT_LAB === "1");
}
