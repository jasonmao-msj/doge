# Budget Decision Table — 2026-06-24-harden-realtime-interaction-jank-during-tool-call

> **Lifecycle**：Historical Budget Decision。表内 v0.5.11/v0.5.13 proxy 值不是 0.7.x current budget evidence；设计方法可复用，数值必须重测。
> 锚定 proposal `2026-06-24-harden-realtime-interaction-jank-during-tool-call` §验收 + design §6 + tasks 0.2 的相对阈值；本表为**预算决策**（不是预算数值），数值为 v0.5.11 实数作临时基线（待 v0.5.13 release run 回填）。

## 1. 三档能力预算

| Capability | Metric | v0.5.13 baseline (临时=v0.5.11 实数) | guard 目标 | aggressive 目标 | 验证手段 | rollout |
|---|---|---|---|---|---|---|
| `app-server-event-stream-pacing` | `main_thread_long_task_count_during_stream` (10min) | 0 (proxy) | <= 0 | <= 0 | Tauri release run + PerformanceObserver | `approved-pending-runtime-trace` |
| `app-server-event-stream-pacing` | `app_server_event_dropped_snapshot_count` (10min) | 0 (proxy) | < 200 | < 500 | `app-server-event-batch-stats` emit | `approved-pending-runtime-trace` |
| `app-server-event-stream-pacing` | `app_server_event_idle_yield_count` (10min) | 0 (unsupported) | >= 5 | >= 20 | `useRenderScheduler` instrumentation | `approved-pending-runtime-trace` |
| `tool-output-tail-gate` | `toolOutputTailGateSaturated` (10min) | 0 (unsupported) | 1-10 | 10-50 | `useToolOutputTailGate.__getDiagnosticsForTests` | `approved-pending-runtime-trace` |
| `tool-output-tail-gate` | `app_server_event_payload_bytes_per_flush` (p95) | 0 bytes (proxy) | < 524288 bytes (512 KiB) | < 524288 bytes (512 KiB) | `app-server-event-batch-stats` emit | `approved-pending-runtime-trace` |
| `streaming-schedule-tier-rollback` | `realtime_reducer_dispatches_per_1000_delta` | 1000 (proxy) | <= 700 | <= 500 | `useThreadsReducer` `__profile` | `approved-pending-runtime-trace` |
| `streaming-schedule-tier-rollback` | `appendAgentMessageDelta_first_token_p95` | 24 ms (proxy) | <= 25.2 ms (退化 < 5%) | <= 25.2 ms | `realtime_perf_extended_baseline.json` | `approved-pending-runtime-trace` |
| `streaming-schedule-tier-rollback` | `snapshot_throttle_count` (10min) | 0 (proxy) | >= 100 | >= 500 | `app-server-event-batch-stats` emit | `approved-pending-runtime-trace` |

## 2. Rollout 节奏

- **Phase 1** (v0.5.13 release): 切到 `guarded` 默认，shadow 收集 `appServerEventStreamPacing` / `toolOutputTailGate` / `streamingScheduleTierRollback` 三类 metric 实数；不下 hard gate。
- **Phase 2** (v0.5.14): 实数回填本表，切换 `approved-runtime-measured`；下 hard gate，archive 本 change。

## 3. 回滚条件

任一 capability 出现以下任一条件即回滚到 `baseline`：

- `main_thread_long_task_count_during_stream` 不降反升
- `appendAgentMessageDelta` first token 退化 > 5%
- `appServerEventBackpressure` queue depth 持续 > 80% `maxQueueDepth` (3200/4000)
- `toolOutputTailGate.bufferOverflowCount` 在 10min 内 > 100 (暗示 1MB 阈值过紧)

回滚方式：`localStorage.setItem("ccgui.perf.streamingScheduleTier", "baseline")` 立即生效（per design §7）。
