# Design: Provider Continuation destination-first hydration

## 1. Current failure sequence

```text
backend operation = ready(claude:target)
  -> reload workspace catalog
  -> select target thread
  -> target selection reload sees no per-thread model yet
  -> fire-and-forget target-ready callback
  -> callback closure still compares against source active session
  -> source/global model may change; target active state stays stale
```

Consequences：Canvas/Sidebar 已是 Claude Continuation，Composer 仍以 Codex + `gpt-5.6-sol` 解释 active Native Session；下一次 Claude model click 被 `handleNativeAtomicTargetChange()` 识别为 cross-engine/cross-profile，错误进入新 Continuation。

## 2. Target sequence

```text
backend operation = ready(claude:target)
  -> reload workspace catalog
  -> await hydrateContinuationTarget({ exact target thread, engine, model, effort })
       -> set active engine = claude
       -> refresh provider-scoped catalog (bounded; frozen id/runtime fallback)
       -> persist per-thread selection for exact target
       -> DO NOT mutate source/current selection
  -> select exact target thread
  -> useSelectedComposerSession reloads the already-seeded target selection
```

## 3. Signatures and ownership

Existing callback remains source-compatible：

```ts
onProviderContinuationTargetReady?(input: {
  workspaceId: string;
  threadId: string;
  engine: string;
  providerProfileId: string | null;
  modelId: string | null;
  modelRuntime?: string | null;
  effort: string | null;
}): void | Promise<void>
```

Contract changes：

- `confirmProviderContinuation()` MUST `await` this callback before `onSelectThread()`.
- callback MUST persist selection by `input.workspaceId + input.threadId`, not active closure identity.
- callback MUST set destination engine explicitly because catalog reload state and selection callback may settle in the same React batch.
- callback MUST NOT call active/source-scoped `handleSelectModel()` or `setSelectedEffort()` before target selection.
- `persistComposerSelectionForThread()` remains the only per-thread Composer selection writer；no second store or timer is introduced.

## 4. Validation and error matrix

| Case | Expected | Forbidden |
|---|---|---|
| Codex → Claude ready，catalog refresh succeeds | seed Claude model/effort，then select target | target first paint still shows Codex |
| catalog refresh fails | use frozen destination catalog/runtime identity when non-empty | clear target model or retry backend creation |
| target is not active during hydration | only target per-thread key changes | source Composer selection is overwritten |
| target catalog reload dispatch is batched | explicit destination engine remains authoritative | infer engine only from stale `threadsByWorkspace` closure |
| target active，same Claude+Doge profile model click | normal per-thread model update | create a second Claude → Claude Continuation |
| user selects a genuinely different engine/profile later | existing Continuation preview | silently mutate immutable binding |

## 5. Good / Base / Bad

- Good：ready callback resolves target engine/model truth before navigation；selection reload consumes one complete target.
- Base：frozen destination omits model，provider-scoped catalog supplies default/first model before selection.
- Bad：navigate first and schedule target hydration later；or call `handleSelectModel()` while source thread is still active.
- Bad：sleep/poll until catalog “looks ready”；ordering must come from awaited promises and exact target identity.

## 6. Tests

- `useSidebarMenus.test.tsx`：deferred target hydration MUST resolve before `onSelectThread`; selection exactly once；callback rejection remains visible and does not race a stale select.
- AppShell target hydration test/helper：destination engine set；exact target selection persisted；source/global active model setter not used.
- Existing `ProductEngineModelSelect.test.tsx` cross-engine two-step contract stays green：engine click emits zero target changes，model click emits one complete target.
- Manual hot smoke：Codex `hi` → Continue to Claude → ready target immediately shows Claude model；send ordinary message without a second Continuation Dialog；reply completes normally。

## 7. Risks

- Engine switch before navigation may briefly update background/global catalog，but the application-owned Dialog remains visible until target selection；no source message is sent in this interval.
- Awaiting hydration adds provider catalog latency before target Canvas opens. Existing frozen destination identity provides a fallback, so catalog failure must remain bounded and non-blocking.
