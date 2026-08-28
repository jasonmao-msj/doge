# Design: Lazy Product Engine Provisioning

## Domain boundaries

```text
Authenticated Product Shell Readiness
  = authenticated session + active subscription catalog
  ≠ model catalog ready
  ≠ managed provider configured
  ≠ CLI binary ready

Send Target Readiness
  = frozen engine/provider target
  + product credential/config for that engine
  + verified engine toolchain
  + required native activation
```

Product gate owns only the first boundary. `ProductEngineProvisioningCoordinatorV1` owns the second.

## Startup flow

```text
login/authenticated
  → account_product_v1_catalog
  → entitlement active
  → publish shell-ready snapshot (engines, empty/stale models)
  → mount AppShell immediately
  → background account_product_v1_prepare(engineId=null)
      → ensure/reconcile shared Composite key
      → store safe managed secret handles
      → fetch models
      → DO NOT inspect/download/activate CLI
      → DO NOT apply three engine configs
  → success publishes model catalog; failure leaves Home mounted + retryable stale catalog
```

删除 `ProductAccountAppGate` 的 `preparingEngine`、`prepareToolchains`、engine-specific loading branch。
Checkout/subscription/auth states 仍是 account gate；engine availability 不再参与 Router/AppShell mount decision。

## IPC contract

```typescript
prepareAccountProductV1(
  operationId: string,
  engineId?: "codex" | "claude-code" | "kimi" | null,
): Promise<unknown>;
```

```rust
account_product_v1_prepare(
    operation_id: String,
    engine_id: Option<String>,
) -> Result<Value, String>
```

Semantics:

| `engineId` | managed secret | engine config | models |
|---|---|---|---|
| `null/undefined` | ensure/reconcile product key; make it durably retrievable | none | fetch + return |
| exact product engine | ensure/reconcile same product key | apply only exact engine | fetch + return |
| unknown | no mutation | none | typed validation failure |

Native mutation remains idempotent by deterministic key identity + `operationId`; malformed/unknown engine fails before file mutation。

## Send-time coordinator

```typescript
type ProductEngineProvisioningPhase =
  | "idle"
  | "installing"
  | "ready"
  | "error";

type ProductEngineProvisioningSnapshotV1 = {
  engine: "codex" | "claude" | "kimi" | null;
  phase: ProductEngineProvisioningPhase;
  errorCode: string | null;
  retryable: boolean;
};

ensureProductEngineReadyV1({
  engine,
  providerProfileId,
}): Promise<void>;
```

Rules:

1. Only `providerProfileId=doge-token-matrix` + Codex/Claude/Kimi enters this owner; local/custom targets no-op。
2. Freeze target before provisioning; completion MUST compare the same target identity before Session/Turn creation。
3. Same engine concurrent calls share one in-flight promise; other engine send does not inherit or cancel it。
4. Call `account_product_v1_prepare(engineId=exact)` before toolchain activation; this revalidates native credential on every
   unprepared transition and applies only the chosen engine config。
5. Inspect managed toolchain. Ready bundled/external source is accepted; `choiceRequired` selects bundled per Product policy。
6. If no usable toolchain exists, use existing `cli_install_plan/run` for exactly one engine and consume
   `cli-installer-event`; after installer settlement re-probe authoritative binary status before activation。
7. Codex/Claude call managed activation; Kimi is one-shot and consumes the verified per-turn binary without global active-engine
   read-back。
8. Only after all steps succeed may new Session/Shared Binding/Turn side effects begin。
9. Access prepare、toolchain inspect/choice and activation are silent when a bundled/external engine is already usable；they MUST
   NOT publish checking/configuring/ready UI。Only an actual `cli_install_run` opens the progress card；its success may publish
   bounded ready。Failure throws a stable provisioning error, restores draft/attachments and leaves an error card retryable。

## Progress UI

`UpdateToast` 与 `EngineProvisioningToast` 由同一个 `.update-toasts` stack host 渲染，card body 复用
`.update-toast*` visual classes。Engine card is presentation-only：

- installed/bundled/external ready：全程 silent，用户不看到 checking/configuring/activating/ready。
- actual installer running：installing card + indeterminate or event-derived progress；不可 dismiss。
- actual installer success：ready 短时自动 dismiss。
- error：safe localized copy + Retry/Dismiss；raw path/token/command output 不进入 UI。
- visible hierarchy 固定为 `engine name → phase/action`；不得再显示“App 仍可使用”等实现自证文案，也不得在
  header/body/footer 重复 engine name。没有 authoritative bytes/percentage 时只能使用 indeterminate progress。
- busy 不渲染 disabled close；ready 自动消失；error 使用 header close + 单一 Retry action，禁止重复 Dismiss。
- 多次 installer stdout/stderr 只保留 bounded latest safe message，不逐事件写 AppShell root state；store 用
  `useSyncExternalStore` leaf subscription。

## Send and draft semantics

- New Home/Native send：provision before `startThreadForWorkspace`，安装成功后自动继续原 send。
- Existing Native send：provision before optimistic user bubble/processing side effect。
- Shared send：provision frozen `selectedNextTarget` before Tx1/Binding provisioning；失败保持 idle/target-unavailable，
  不进入 recovery-required。
- Composer catches provisioning rejection for ordinary sends and restores submitted text、images、context selections；
  retry card 只重跑 exact-engine provisioning，ready 后由用户再次确认发送，不能自动生成 duplicate thread/turn。

## Validation and error matrix

| Scenario | Required | Forbidden |
|---|---|---|
| login, no CLI installed | Home mounted | full-screen engine preparing/failure |
| first Codex send | only Codex prepare/toolchain | inspect Claude/Kimi |
| first Kimi send | Kimi one-shot path | global switch read-back failure |
| same engine double send | one provisioning owner | duplicate installer/key/config mutation |
| install success + response uncertainty | authoritative re-probe then continue | user Retry required to discover success |
| install/config failure | draft restored, card retry, App interactive | partial Session/Turn or silent fallback |
| target changes during install | original frozen target only, or abort before side effect | new picker value rewrites queued send |
| updater + engine progress together | stacked cards | overlapping fixed containers |
| logout during install | generation invalidates continuation; no send | late completion creates Session |

## Good / Base / Bad

- Good：one coordinator dedupes exact engine transaction；Updater/engine cards share one stack；send awaits ready before
  any external session/turn side effect。
- Base：shipping bundle 或 verified external 已可用，first send silent continue；不显示 checking/configuring/ready card。
- Bad：login background installs all engines；each adapter installs itself；or UI hides gate while provider/session side effects
  still begin before readiness。

## Engine onboarding matrix decision

- A/B/D registry/runtime/renderer identity：unchanged。
- C capability registry：unchanged；no new engine/capability。
- E send/model selection：affected only at readiness boundary；exact target remains authoritative。
- F Shared：affected before Binding/Tx1; supported-engine sets unchanged。
- G UI：new non-blocking progress card；Engine Management remains hidden。
- H i18n：new provisioning card keys across all locales。
- ⚠ manually audit New Home、Existing Native、Shared、Sidebar direct create、Provider Continuation、retry/recovery、Windows/macOS。
- 🔵 runtime download format/bundle removal：deferred，shipping bundled resources retained。
