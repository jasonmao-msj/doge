# 引擎与模型接入层治理闭环报告

> **2026-08-01 生命周期校准**：Historical Closure Evidence。当前 built-in registry 已为六引擎（含 Grok）；读取本文表格前先核对 `engineIds.json`、Rust `adapter_registry.rs` 与 capability matrix gate。
> - 范围：`engine / codex / claude / gemini / kimi / opencode / models / vendors`
> - 初始审计日期：2026-07-26
> - 更新日期：2026-07-26
> - 基线分支：`feature/v-0710`
> - 初始审计提交：`680f8a71b`
> - 当前代码提交：`1dfdfb47d`
> - OpenSpec 归档提交：`65a174d26`
> - 当前快照提交：`cebb2ca76`
> - 文档性质：初始审计、CLI foundation 实施结果、验证证据与残余边界

## 1. 结论先行

初始审计识别出的核心问题已经闭环：

> 引擎身份、能力、模型目录、供应商元数据和配置持久化缺少跨 TypeScript / Rust / daemon / CLI 的统一 contract。

本轮没有只修补局部 hardcode，而是按依赖顺序建立了 CLI foundation：

```text
Engine capability + runtime identity
                 │
                 ▼
MossxAgentEvent + run.settled
                 │
                 ▼
EngineAdapter × EngineProtocol
                 │
                 ▼
Message delivery + executable session registry
                 │
                 ▼
Model/provider catalog + compatibility governance
                 │
                 ▼
Controller facade migration
```

当前结果：

- 11 个 OpenSpec change 已完成实现、验证、spec sync 与 archive。
- 96 个任务全部完成，完成率 `96/96`。
- capability contract、runtime identity、event bus、adapter/protocol registry、message delivery、executable session registry 和 model/provider catalog 已有明确 owner。
- Kimi、Claude、OpenCode compatibility debt 已进入可验证治理边界。
- `useEngineController.ts` 已从初始审计的 1008 行收薄到约 571 行，并由 `< 600` 行 gate 防回退。
- OpenCode 1011 行不可达控制面已删除；保留的 compatibility surface 默认 fail closed。
- 流式正文继续走 `liveAssistantTextChannel`，没有将逐 delta 更新重新挂入 AppShell root state。

这轮交付的是 **L1 CLI foundation**。没有实现 plugin runtime、marketplace、handoff 或完整 orchestration。

### 1.1 原问题闭环状态

| 初始问题 | 初始判断 | 当前状态 | 当前证据 |
| --- | --- | --- | --- |
| `useEngineController` 1008 行 god hook | P2，foundation 后置 | **已收薄** | 当前约 571 行；availability、selection、catalog、storage revision、runtime notices 已迁出 |
| 引擎枚举和 metadata 多处硬编码 | P1 | **已收敛** | `engineIds.json`、`engineRegistry.ts`、Rust `EngineAdapterRegistry` 与 CI parity gate |
| capability matrix 固定 `unknown` 且 DTO 字段错位 | P0 | **已修复** | Rust/daemon/TypeScript 对齐 7 个 wire fields；legacy aliases 仅 decode-only |
| 模型/provider fallback 多 owner | P1 | **已收敛** | `generatedModelCatalog.json` 成为 Codex/Gemini/Kimi 唯一 generated fallback owner |
| Claude mapping triple-write | P1 | **已修复** | 只写 `claude-model-mapping`；legacy keys 仅迁移读取并 best-effort 删除 |
| `isValidModelId` 双源不一致 | 已修 | **保持关闭** | 单一 contract 继续由既有 regression gate 保护 |
| Claude provider 错误静默 | P1 | **已修复** | typed result/error；失败 durable reload；UI `role="alert"` |
| OpenCode 1011 行不可达面板 | P1 清理 | **已清理** | panel、sections、root hooks、专属 CSS 删除；backend policy fail closed |
| engine/thread 前缀推断散布 | P0-P2 | **核心 owner 已建立，残余迁移继续** | `engineRuntimeIdentity.ts` 是新代码唯一 legacy prefix parser；直接 Claude prefix 从 36 处/25 文件降到 33 处/23 文件 |
| OpenCode provider metadata 序列化丢失 | P1 | **已修复** | `ModelInfo` 传递 `provider/protocol/provenance` |
| Kimi config/provider 静默降级 | P1 | **已修复** | `missing/loaded/malformed/io-error` typed status；cleanup partial warning |

### 1.2 当前架构判断

这轮治理确认了三个长期原则：

1. **Identity 是 contract，不是字符串约定。**

   `logicalSessionId`、`nativeSessionId`、`pendingSessionId`、`runId`、`turnId`、`itemId` 必须分层；prefix 只能作为 compatibility parser 输入。

2. **Protocol 与 engine semantics 必须正交。**

   `EngineProtocol` 负责 executable、execution model 和 wire parsing；`EngineAdapter` 负责 identity、capability、session semantics 与 `EngineEvent` mapping。

3. **Runtime fact 与 fallback metadata 必须有优先级。**

   model catalog 固定采用：

   ```text
   runtime > configured > cached > generated fallback
   ```

### 1.3 残余边界

本轮已经完成 foundation，但不应把它误读为 plugin/orchestration 已就绪：

- Codex 仍保留 native AppServer ingress；其与统一事件模型的 parity 由 common `EngineEvent` shadow adapter test 保护。未来若要求所有 engine 物理进入同一 Rust bus，需单独 change。
- `registerExternalEngine` 和 Rust external registration 当前提供 schema/provenance/duplicate validation boundary，不是动态 plugin runtime。
- 33 处 Claude prefix 直接判断仍存在于历史兼容路径。新代码必须进入 `engineRuntimeIdentity.ts`，不再增加旁路 parser。
- `useEngineController` 仍是 571 行 compatibility facade，不是最终可删除状态；当前 gate 的目标是阻止旧 owner 与高频状态回流。
- OpenCode 保留 history/session identity reader、realtime parser、archive/delete 和 Rust adapter，仅服务旧会话读取、诊断与迁移。
- Gemini 仍是 known engine，但 execution policy 保持禁用；registry 的 `known` 不等于 `runtimeEnabled`。

---

## 2. 当前接入链路

```text
OpenSpec capability matrix
          │ generate + parity check
          ▼
TS/Rust generated capability artifacts
          │
          ├──────────────► TypeScript EngineFeatures
          │
          ▼
Rust EngineAdapterRegistry
  ├─ EngineAdapter: identity / capability / event mapping
  └─ EngineProtocol: executable / parsing / execution model
          │
          ▼
RuntimeManager ── process handle / generation / replacement
          │
          ├──────────────► ExecutableSessionRegistry
          │                 plain data / cursor / recovery / settlement
          ▼
MossxAgentEvent Bus
  sequence / provenance / runId / turnId / itemId / run.settled
          │
          ├─ existing AppServer compatibility projection
          ├─ frontend domain-event runtime
          └─ future persistence / plugin / orchestrator sinks

Model sources
  runtime ─► configured ─► last-good cache ─► generated fallback
          │
          ▼
ModelCatalogEntry(provider / protocol / source / provenance / lifecycle)
```

关键 ownership：

| Contract | 当前 owner |
| --- | --- |
| built-in engine IDs | `src/features/engine/engineIds.json` |
| frontend engine projection | `src/features/engine/engineRegistry.ts` |
| Rust adapter/protocol registry | `src-tauri/src/engine/adapter_registry.rs` |
| capability SSOT | `openspec/specs/engine-capability-matrix/` |
| capability runtime artifacts | `src/features/engine/generated/`、`src-tauri/src/engine/capability_matrix.generated.rs` |
| runtime identity parser | `src/features/threads/contracts/engineRuntimeIdentity.ts` |
| agent event bus | `src-tauri/src/engine/agent_event_bus.rs` |
| process lifecycle | `RuntimeManager` |
| executable session state | `src-tauri/src/runtime/executable_registry.rs` |
| message delivery semantics | `src/features/threads/contracts/engineMessageDelivery.ts` |
| generated model fallback | `src/features/models/generatedModelCatalog.json` |
| Claude mapping storage | `claude-model-mapping` |

---

## 3. 分项实施结果

### 3.1 Capability contract

初始问题：

- TypeScript DTO 缺失 `reasoningEffort`、`collaborationMode`、`mcp`。
- `reasoning/toolUse/sessionContinuation` 与 Rust serde 字段语义错位。
- production TypeScript 直接 import `openspec/**` fixture。

当前实现：

- Rust/daemon/TypeScript 对齐：
  - `reasoningEffort`
  - `collaborationMode`
  - `imageInput`
  - `sessionResume`
  - `toolsControl`
  - `streaming`
  - `mcp`
- `reasoning`、`toolUse`、`sessionContinuation` 仅保留为 decode-only compatibility aliases。
- OpenSpec fixture 生成 TypeScript/Rust runtime artifacts，生产代码不再直接 import `openspec/**`。
- capability status 区分 declared stance 与 runtime evidence；未探测字段保持 `unknown`，不伪装成 unsupported。
- foundation capability 已包含 `input.mid-turn` 与 `rpc.server`：
  - Codex/Claude：`compat-input`
  - Kimi/OpenCode：`unsupported`
  - Codex RPC server：supported

回归 gate：

```bash
node scripts/check-engine-capability-matrix.mjs
```

### 3.2 Runtime identity

当前 contract：

| Identity | 语义 |
| --- | --- |
| `logicalSessionId` | client 稳定会话 identity |
| `nativeSessionId` | engine 原生可恢复 identity |
| `pendingSessionId` | promotion 前 compatibility identity |
| `runId` | 一次执行 identity |
| `turnId` | run 内 turn identity |
| `itemId` | turn 内 item identity |

实现边界：

- `engineRuntimeIdentity.ts` 是唯一新增 legacy prefix parser。
- `threads.threadAliases` 继续作为 durable alias owner。
- alias chain 会 flatten；迟到事件解析到 canonical ID。
- tombstone 上限为 2000，避免无界增长。
- diagnostics、replay、shared realtime adapter、item events、turn events 已消费统一 parser。
- engine branch scanner 从 canonical engine artifact 加载 IDs，并覆盖 Kimi。

当前 Claude prefix 扫描结果：

```text
初始：36 处，25 个 src 文件
当前：33 处，23 个 src 文件
```

这些残余属于 compatibility migration backlog，不再是新 contract 的事实源。

### 3.3 Unified event bus 与 `run.settled`

`AgentEventBus` 当前负责：

- immutable `MossxAgentEvent` envelope
- monotonic sequence
- engine provenance
- `runId / turnId / itemId`
- bounded normal lane
- non-blocking delta coalescing
- unbounded critical lane
- 幂等 `run.settled`

`run.settled` 支持：

- `completed`
- `failed`
- `cancelled`
- `replaced`

重复或冲突 terminal evidence 只增加 diagnostics，不重复 publish。

渲染边界没有回退：

- streaming 继续经过 `realtimeEventBatcher`。
- 正文继续经过 `liveAssistantTextChannel`。
- AppShell root hook 和 reducer 不接收逐 delta bus update。
- AppServer compatibility projection 保持单次 delivery，不产生新旧双投递。

回滚开关：

```text
MOSSX_AGENT_EVENT_BUS_ENABLED=0
```

### 3.4 `EngineAdapter × EngineProtocol` registry

当前职责拆分：

```text
EngineProtocol
  executable / execution model / wire parsing

EngineAdapter
  engine identity / capability profile / EngineEvent mapping

RuntimeManager
  create / replace / abort / teardown / generation guard
```

执行模型：

- Codex app-server：`persistent`
- Claude/Kimi-style CLI：`one-shot`

Rust `EngineType` 继续保留 built-in exhaustive match。外部 engine 使用 opaque `EngineId` 和 source/provenance validation，不要求把 plugin ID 写进 built-in enum。

前端硬编码 owner 已从 controller、availability、runtime fallback 和 composer preference normalization 收敛到 `engineRegistry.ts`。

回归 gate：

```bash
pnpm check:engine-adapter-registry
```

### 3.5 Message delivery semantics

统一 intent：

- `prompt`
- `steer`
- `followUp`
- `nextTurn`

统一 result：

- `accepted`
- `rejected`
- `degraded`

关键行为：

- Codex/Claude `compat-input` 明确返回 degraded steering。
- Kimi/Gemini/OpenCode mid-turn input 默认拒绝；caller 只有显式允许时才能降级到 follow-up queue。
- follow-up 记录 predecessor `terminalPulse`，仅在 `run.settled` 推进后 FIFO dispatch。
- processing flag、response acceptance 和 delta 不再被当作完成信号。
- queue item dispatch 前进入既有 in-flight guard；重复 settlement 不会重复发送。
- diagnostics 只保存 intent、engine、session/run、capability、route、reason，不保存正文、图片或 credential。

### 3.6 Executable session registry

没有新增第二套 process manager：

- `RuntimeManager` 继续持有 process handle、PID、replacement gate 和 generation。
- `ExecutableSessionRegistry` 只持有 plain data。

registry 数据包含：

- logical session
- engine/adapter
- native binding
- runtime generation
- lifecycle state
- monotonic cursor
- last settled run
- settlement idempotency set

可靠性边界：

- register/rebind/resolve/transition/release 均校验 generation。
- replacement 后旧 generation 无法控制新 session。
- `control_lane` 串行化 mutation。
- terminal callback 只 enqueue settlement work，不在 handler 内同步等待同一 lane。
- atomic JSON durable record 支持 restart recovery。
- interrupted `acquiring/active/stopping` 会恢复为 `recoverable`。
- checkpoint compaction 保留 cursor 与 `settledRunIds`。
- mutation error 显式 warning，不静默吞错。

frontend projection 只暴露低频 identity/lifecycle/native binding；delta-only 活动不会改变 projection reference。

### 3.7 Model/provider catalog

当前 precedence：

```text
runtime > configured > cached > generated fallback
```

`ModelCatalogEntry` 当前正交保存：

- `engine`
- `id`
- `provider`
- `protocol`
- `source`
- `provenance`
- `observedAt`
- `lastVerifiedAt`
- `lifecycle`

实现结果：

- Rust/daemon `ModelInfo` 不再丢弃 provider，并补充 protocol/provenance。
- validated runtime refresh 才更新 last-good cache。
- refresh 失败返回 stale/error 并保留上次成功 reference 和 selection。
- `generatedModelCatalog.json` 是 Codex/Gemini/Kimi 唯一 generated fallback roster owner。
- TypeScript 和 Rust 都从同一 artifact 投影。
- Gemini frontend 未发布 preview hardcode 已移除；generated fallback 只保留治理过的 roster。
- OpenCode soft-retired，不新增静态 fallback owner。

回归 gate：

```bash
pnpm check:model-provider-catalog
```

### 3.8 Claude provider management

storage ownership：

- canonical：`claude-model-mapping`
- legacy：`mossx-claude-model-mapping`
- legacy：`codemoss-claude-model-mapping`

当前只写 canonical key。legacy keys 仅由 `migrateModelMappingStorage` 读取并 best-effort 删除：

- canonical 存在时优先。
- legacy-only 时一次性迁移。
- repeated migration 幂等。
- malformed 与 cleanup failure 进入 typed warning。

provider action 统一返回 `ClaudeProviderActionResult`，覆盖：

- load
- save
- switch
- reorder
- delete
- storage

reorder/switch 失败会 reload durable state；save/delete 失败不会关闭为成功状态。`VendorSettingsPanel` 用 `role="alert"` 暴露错误。

### 3.9 Kimi governance

canonical identity：

- pending → canonical promotion 继续复用既有 reducer contract。
- stale history、late ensure、residual row cleanup 有回归覆盖。
- promotion 后 buffered delta 和 terminal completion 解析到 canonical identity。
- 没有改变 `liveAssistantTextChannel` 和逐 delta 路径。

config/provider reliability：

- `read_kimi_config_document` 区分 `missing/loaded/malformed/io-error`。
- missing 使用 generated fallback。
- malformed/I/O error 保留 fallback，同时写入 `EngineStatus.error`。
- provider durable deletion 与 `config.toml` cleanup 分离。
- cleanup 失败返回 `partial-warning`，frontend 保留 residual config warning。

### 3.10 OpenCode soft-retirement

当前策略是 soft-retired，不是继续 modernize：

- frontend settings normalization 与 AppShell gate 固定 false。
- backend/daemon policy 对 OpenCode 无条件 false。
- legacy `opencodeEnabled=true` 和 `defaultEngine=opencode` 会在 startup 被归一。
- execution handler 在 spawn 前 fail closed，返回：

  ```text
  soft-retired and blocked by runtime policy
  ```

已删除：

- `useOpenCodeSelection`
- `useOpenCodeThreadBinding`
- 1011 行 `OpenCodeControlPanel`
- 四个 panel sections
- control hook 与专属 tests
- `opencode-panel.css`
- shared CSS 中只服务 retired panel 的 selectors

保留：

- history/session identity reader
- realtime parser
- archive/delete
- Rust adapter
- compatibility execution surface，但 runtime policy 禁止 spawn

回归 gate：

```bash
pnpm check:opencode-retirement
```

### 3.11 Controller facade

职责迁移：

| 原 controller 责任 | 当前 owner |
| --- | --- |
| availability 与 UI label | `engineControllerAvailability.ts` + `engineRegistry.ts` |
| persisted selection | `engineControllerSelection.ts` |
| model normalize/custom/fallback/projection | `engineControllerCatalog.ts` |
| storage revision lifecycle | `useEngineCatalogRevision.ts` |
| global runtime notices | `useEngineRuntimeNotices.ts` |

当前文件行数：

| 文件 | 行数 |
| --- | ---: |
| `useEngineController.ts` | 571（`wc -l`；gate 按 logical line 计为 572） |
| `engineControllerAvailability.ts` | 57 |
| `engineControllerCatalog.ts` | 221 |
| `engineControllerSelection.ts` | 56 |

facade 返回值通过 `useMemo` 保持引用稳定。storage listener 独立管理并在卸载时清理。没有新增 per-delta、日志追加或轮询级 state。

回归 gate：

```bash
pnpm check:engine-controller-facade
```

---

## 4. 实施批次与闭环状态

| 批次 | OpenSpec change | 任务数 | 状态 |
| --- | --- | ---: | --- |
| Batch 0 | `align-engine-runtime-capability-contract` | 8 | 已归档 |
| Batch 0 | `establish-logical-session-runtime-identity` | 8 | 已归档 |
| Batch 1 | `establish-unified-engine-event-bus` | 9 | 已归档 |
| Batch 2 | `define-engine-adapter-protocol-registry` | 9 | 已归档 |
| Batch 3 | `define-engine-message-delivery-semantics` | 8 | 已归档 |
| Batch 3 | `establish-executable-session-registry` | 9 | 已归档 |
| Batch 4 | `converge-model-provider-catalog-runtime` | 10 | 已归档 |
| Batch 5 | `harden-kimi-engine-governance` | 8 | 已归档 |
| Batch 5 | `harden-claude-provider-management` | 8 | 已归档 |
| Batch 5 | `enforce-opencode-soft-retirement-boundary` | 9 | 已归档 |
| Batch 6 | `migrate-engine-controller-facade` | 10 | 已归档 |
| **合计** | **11 changes** | **96** | **96/96** |

每个 archived change 均保留：

- `proposal.md`
- `design.md`
- `tasks.md`
- `implementation-evidence.md`
- 对应 spec delta

主 specs 已完成 sync。OpenCode 旧 `opencode-engine` active contract 已由 soft-retirement contract 替代。

---

## 5. 验收门禁结果

### 5.1 Contract correctness

- capability DTO 与 serde wire fields 对齐。
- generated artifacts 与 OpenSpec fixture 有 parity gate。
- runtime identity 六类 ID 已定义。
- Kimi promotion 后迟到事件不会复活 pending identity。
- provider/protocol/provenance 不再在 DTO 边界丢失。

### 5.2 Lifecycle 与消息正确性

- `run.settled` 幂等。
- follow-up 只在 settlement 后 drain。
- unsupported mid-turn input 不静默成功。
- stale runtime generation 无法控制 successor session。
- restart recovery 与 compaction 保持 cursor/settlement idempotency。

### 5.3 Compatibility reliability

- Claude mapping canonical-only write。
- Claude provider failures 用户可见。
- Kimi malformed/I/O/cleanup failure 有 typed diagnostics。
- OpenCode 默认不可执行，root UI/CSS 已清理。
- `isValidModelId` 单一 contract 未回退。

### 5.4 Rendering regression

- event bus 不逐 delta 写入 AppShell root state。
- streaming 继续走 batching + `liveAssistantTextChannel`。
- executable session projection 对 delta-only 变化保持 reference stable。
- controller facade 不接收高频消息正文、日志数组或秒级 polling state。

---

## 6. 验证证据

各 change 的 focused verification 已记录在：

```text
openspec/changes/archive/2026-07-26-<change-id>/implementation-evidence.md
```

累计覆盖：

- capability matrix generation/parity
- engine branch scanner
- TypeScript compile
- Rust focused tests
- daemon compile
- domain event/runtime tests
- delivery queue/settlement tests
- executable registry recovery/compaction tests
- model catalog merge/cache/DTO round-trip tests
- Claude provider success/failure/storage migration tests
- Kimi config/promotion/provider warning tests
- OpenCode retirement policy tests
- controller facade focused regression
- strict OpenSpec validation

关键治理命令：

```bash
node scripts/check-engine-capability-matrix.mjs
node --test scripts/scan-engine-name-branches.test.mjs
pnpm check:engine-adapter-registry
pnpm check:model-provider-catalog
pnpm check:opencode-retirement
pnpm check:engine-controller-facade
pnpm check:large-files
pnpm tsc --noEmit
cargo check --bin cc_gui_daemon
```

controller facade 最终 focused suite：

```text
7 files passed
64 tests passed
```

---

## 7. 证据索引

### Engine / capability / registry

- `src/types/engine.ts`
- `src/features/engine/engineIds.json`
- `src/features/engine/engineRegistry.ts`
- `src/features/engine/engineCapabilityMatrix.ts`
- `src/features/engine/generated/engineCapabilityMatrix.generated.ts`
- `src/features/engine/hooks/useEngineController.ts`
- `src/features/engine/hooks/engineControllerAvailability.ts`
- `src/features/engine/hooks/engineControllerCatalog.ts`
- `src/features/engine/hooks/engineControllerSelection.ts`
- `src-tauri/src/engine/adapter_registry.rs`
- `src-tauri/src/engine/capability_matrix.rs`
- `src-tauri/src/engine/capability_matrix.generated.rs`
- `openspec/specs/engine-capability-matrix/spec.md`

### Identity / event / delivery / session

- `src/features/threads/contracts/engineRuntimeIdentity.ts`
- `src/features/threads/contracts/engineMessageDelivery.ts`
- `src/features/threads/contracts/executableSessionProjection.ts`
- `src/features/threads/domain-events/eventRuntime.ts`
- `src/features/threads/domain-events/eventTypes.ts`
- `src/features/threads/adapters/sharedRealtimeAdapter.ts`
- `src-tauri/src/engine/agent_event_bus.rs`
- `src-tauri/src/runtime/executable_registry.rs`

### Models / vendors

- `src/features/models/generatedModelCatalog.json`
- `src/features/models/generatedModelFallbacks.ts`
- `src/features/models/modelProviderCatalog.ts`
- `src/features/models/hooks/useModels.ts`
- `src/features/models/constants.ts`
- `src/features/vendors/hooks/useProviderManagement.ts`
- `src/features/vendors/hooks/useKimiProviderManagement.ts`
- `src-tauri/src/engine/status.rs`
- `src-tauri/src/vendors/kimi_providers.rs`
- `openspec/specs/model-provider-catalog-runtime/spec.md`
- `openspec/specs/claude-provider-management/spec.md`
- `openspec/specs/kimi-engine-runtime/spec.md`

### Governance gates

- `scripts/check-engine-capability-matrix.mjs`
- `scripts/check-engine-adapter-registry.mjs`
- `scripts/check-model-provider-catalog.mjs`
- `scripts/check-opencode-retirement.mjs`（历史 gate；2026-08-01 当前脚本已移除）
- `scripts/check-engine-controller-facade.mjs`
- `scripts/scan-engine-name-branches.mjs`

### Architecture research

- `docs/research/mossx-plugin-market-and-cli-foundation-design.md`
- `docs/research/pi-architecture-plugin-marketplace-analysis.md`
- `docs/research/pi-chat-orchestration-research.md`

---

## 8. 后续能力边界

| 后续能力 | 本轮提供的 foundation | 本轮是否实现 |
| --- | --- | --- |
| Plugin event hooks | `MossxAgentEvent`、provenance、run/turn/item IDs | 否 |
| Plugin engine registration | `EngineAdapter` boundary、extensible `EngineId` validation | 否，仅 contract |
| Marketplace | source/provenance 与 capability declaration boundary | 否 |
| Handoff | executable session registry、cursor、`run.settled` | 否 |
| Steering/follow-up queue | engine-level delivery semantics | 部分，仅 engine contract |
| Background pipeline | settlement、cursor、event-driven control lane | 否 |
| Universal Rust ingress | non-Codex bus ingress + Codex parity boundary | 否，Codex 仍走 native AppServer ingress |

启动后续 plugin/orchestration change 前，必须再次确认：

1. 是否需要把 Codex native ingress 物理并入统一 bus。
2. external registration 是否需要动态 load/unload、权限、签名和 isolation。
3. session registry 的 durable schema 是否满足跨版本 migration。
4. extension sink 是否使用外部 store/细粒度订阅，避免 root render amplification。

---

## 9. 最终判断

原始审计判断成立：问题根因不是“硬编码多”，而是 data plane、control plane 与 identity contract 没有稳定边界。

当前代码已经完成从“多个局部正确机制”到“可验证 foundation contract”的迁移：

- data plane：`MossxAgentEvent`、delivery semantics、model catalog metadata。
- control plane：`RuntimeManager`、`ExecutableSessionRegistry`、generation guard。
- identity plane：logical/native/pending/run/turn/item。
- extension boundary：`EngineAdapter × EngineProtocol` 与 source/provenance validation。

剩余工作不再是本轮治理遗漏，而是下一阶段产品能力：

- plugin runtime
- marketplace
- handoff
- orchestration
- universal event ingress
- legacy prefix compatibility 的持续收敛

> 🛠 **深度推演**：本轮真正的系统熵减，不是把 1008 行拆成多个文件，而是先确定“谁拥有事实、谁拥有进程、谁拥有 identity、什么才算完成”。文件拆分只是 contract 稳定后的结果。后续若绕过这些 owner 直接新增 plugin 或 pipeline，将重新制造第二套 runtime。
