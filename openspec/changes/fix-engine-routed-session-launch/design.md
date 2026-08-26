# Design: Runtime-confirmed engine routing

## Contract

```ts
type SetActiveEngineOptions = {
  ensureRuntime?: boolean;
  providerProfileId?: string | null;
};

setActiveEngine(
  engine: EngineType,
  options?: SetActiveEngineOptions,
): Promise<boolean>;
```

- `true` 表示切换已成功；当 `ensureRuntime: true` 时，额外保证目标 engine 已成为
  native runtime 的 active engine。普通 legacy caller 的同值调用可以直接复用当前 frontend
  selection；创建/续借 caller 必须启用 `ensureRuntime`。
- `false` 表示目标 engine 不可用或 switch failed；调用方不得继续创建或导航。
- `ensureRuntime: true` 在 React `activeEngine` 已等于目标时必须调用 `getActiveEngine()` 复核 native runtime；发生实际切换时以成功的 native `switchEngine` response 作为 mutation confirmation，避免用可能滞后的立即 read-back 误判失败。该 gate 只适用于 persistent engine（当前 Codex）或 managed Codex/Claude activation；Kimi 等 one-shot provider 通过显式 provider/session route，不得被 global active-engine 校验阻断。
- 当 `providerProfileId="doge-token-matrix"` 且目标为 Codex/Claude 时，必须先调用
  `account_engine_v1_activate` 激活已验证的 managed toolchain，再执行通用 engine status/switch
  流程；activation 的成功 response 已经是 native active-engine mutation 的 authority，不能
  再调用只识别 global CLI configuration 的 `switch_engine`，也不能把 renderer 的 generic
  CLI detection 当作 bundled toolchain 的唯一事实源。
- 既有调用方可忽略返回值；使用 persistent/managed activation plan 的创建 Session 或完成 Continuation caller 必须检查返回值，one-shot provider caller 遵循其显式 provider routing contract。

## Flow

```text
user selects Codex
  -> resolve target engine
  -> setActiveEngine("codex", { ensureRuntime: true, providerProfileId })
  -> managed provider: account_engine_v1_activate("codex")
  -> false: publish existing failure / stop
  -> true: start_thread / optimistic codex start
```

```text
continuation ready(target=codex)
  -> hydrate target engine with ensureRuntime
  -> persist exact workspaceId + threadId model/effort
  -> select exact target thread
```

## Validation Matrix

| Case | Expected | Forbidden |
|---|---|---|
| frontend state differs from target | native switch, then create | create while old runtime is active |
| frontend state equals target but native runtime differs | native re-check/switch, then create | trusting stale React state |
| switch fails | `false`, no `start_thread`, no target navigation | silent fallback to old engine |
| continuation target Codex | target engine confirmed before hydration/navigation | source engine remains Composer authority |
| Kimi one-shot create/continuation | explicit provider route continues even if generic active-engine switching returns false | global active-engine failure blocks Kimi provider runtime |
| Shared session | durable target remains owner | legacy native engine setter mutates Shared target |

## Good / Base / Bad

- Good: persistent/managed create waits for `setActiveEngine(target, { ensureRuntime: true }) === true`; Kimi one-shot create continues with explicit provider/session routing.
- Base: same-engine ensure reads native state once and returns true when aligned.
- Bad: `setActiveEngine` catches failure and caller proceeds to `start_thread`.
