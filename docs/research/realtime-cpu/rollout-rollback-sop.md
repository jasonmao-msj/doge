---
type: guide
status: active
---

<!-- DOC-LIFECYCLE: active-runbook -->
> [!NOTE]
> **Lifecycle: Current scoped runbook.** 本 SOP 只覆盖文中四个 legacy realtime flags；current registry 已有九项。新增 flags、backend env gate 与 `liveTextExternalization` 的权威定义以 `src/conversation-presentation/realtimePerfFlags.ts` 和相关 specs 为准。

# Realtime CPU Optimization Rollout and Rollback SOP

## Scope

This SOP covers client-side realtime conversation CPU optimizations for:

- `ccgui.perf.realtimeBatching`
- `ccgui.perf.reducerNoopGuard`
- `ccgui.perf.incrementalDerivation`
- `ccgui.perf.debugLightPath`

No protocol/schema migration is involved. Rollback does not require data migration.

> Current code source: `src/conversation-presentation/realtimePerfFlags.ts`. The four flags in this SOP currently default to enabled in production; `localStorage` values are diagnostic overrides, not a durable settings schema.

## Compatibility and Stability Hard Gates

Before release:

1. Run boundary guard and parity tests:
   - `npm run perf:realtime:boundary-guard`
   - `npx vitest run src/features/threads/contracts/realtimeHistoryParity.test.ts`
2. Generate replay reports:
   - `npm run perf:realtime:report`
3. Confirm report gates:
   - 5-minute: CPU drop >= 30%, peak frame-load proxy drop >= 25%.
   - 60-minute: semantic hash parity, zero integrity failures, no stuck processing.

## Rollout Plan

### Stage 0: Controlled Baseline Validation

- For a controlled comparison only, set all four `ccgui.perf.*` overrides to `0`, reload, and record the disabled-path baseline.
- Record baseline report from `docs/research/realtime-cpu/baseline-report.md`.

### Stage 1: Enable Batching and No-Op Guard

- Enable:
  - `ccgui.perf.realtimeBatching=1`
  - `ccgui.perf.reducerNoopGuard=1`
- Keep incremental derivation and debug light path unchanged.
- Validate:
  - no event loss
  - no lifecycle stuck processing
  - no duplicate rows in activity/radar.

### Stage 2: Enable Incremental Derivation

- Enable `ccgui.perf.incrementalDerivation=1`.
- Validate:
  - unchanged threads keep reference stability where expected
  - activity/radar changed-thread refresh remains duplicate-free.

### Stage 3: Enable Debug Light Path (Default)

- Enable `ccgui.perf.debugLightPath=1`.
- Keep `ccgui.debug.threadSessionMirror=0` by default.
- Validate debug critical events still present (`error`, lifecycle boundaries, warnings).

## Monitoring Checklist

- CPU proxy from replay report:
  - `metrics.cpuTimeMs`
  - `metrics.totalActions`
  - `metrics.peakActionsPerFrame`
- Integrity:
  - `missingAgentMessages`
  - `missingToolOutputs`
  - `stuckProcessingThreads`
- Semantic equivalence:
  - baseline and optimized semantic hash match.

## Layered Rollback Procedure

If regression appears, rollback in strict order:

1. Disable batching:
   - `ccgui.perf.realtimeBatching=0`
2. Disable incremental derivation:
   - `ccgui.perf.incrementalDerivation=0`
3. Disable reducer no-op guard:
   - `ccgui.perf.reducerNoopGuard=0`
4. Disable debug light path only if debug payload completeness is the issue:
   - `ccgui.perf.debugLightPath=0`

After each step:

- replay boundary guard
- verify no stuck processing
- verify message continuity.

## Incident Escalation Triggers

- semantic hash mismatch against baseline replay
- any non-empty `missingAgentMessages` / `missingToolOutputs`
- `stuckProcessingThreads` not empty
- peak frame-load proxy regresses above baseline.
