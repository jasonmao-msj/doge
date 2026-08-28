## Context

当前系统有三类不同事实，不能继续压进同一个 `EngineStatus`：

```text
Local runtime detection
  useEngineController -> EngineStatus(installed, models)

Product authority
  productEntitlementStore -> upstream engines + raw models
  productModelCompatibility -> engine endpoint protocol intersection

Execution identity
  ExecutionTarget(engine, providerProfileId, modelCatalogEntryId, model, ...)
```

Composer 在 component 内把后两类拼成 `ProductTargetCatalogV1`；Kanban 则通过三层 props 读取
`codexModels + engineStatuses`。2026-07-24 的 `align-kanban-codex-model-catalog` 只修了 Codex，design
明确保留其它 engine 的旧 source，因此 Doge Product 接入后出现系统性 drift。Kanban storage 仍只有 flat
fields，使 model catalog 修正无法自动保证 actual-send correctness。

## Goals / Non-Goals

**Goals:**

- Product engine/model compatibility 只计算一次，并输出可以直接形成 `ExecutionTarget` 的 rows。
- Product/Local 两种 authority 由 adapter 显式选择；Product ready 时绝不 silent fallback 到 local catalog。
- Kanban task selection、storage、TaskRun snapshot、session creation 与 first send 使用同一 target identity。
- 保持旧数据 dual-read，不要求一次性 migration。

**Non-Goals:**

- 不把所有 local provider/profile catalog 在本 change 内迁成一个全局 store。
- 不改变 Product models API、CLI installer 或 Native provider materialization。
- 不让 selector 的打开/浏览触发 CLI installation；真实 session/send boundary 才调用 preparation。

## Decisions

### 1. Canonical owner 是 Product target projection，不是 `EngineStatus`

新增 `projectProductTargetCatalogV1()`：输入 Product entitlement engines、raw model rows 与 refresh metadata，
输出按 runtime engine 分组的 target model rows。每个 row 同时保留 catalog id 与 resolved runtime model。

Composer picker、`resolveProductManagedExecutionTargetV1()` 与 Kanban Product adapter 都消费该 projection；
component 不再调用 `compatibleProductModelsForEngineV1()` 自行重算。

**Alternative：** overlay `EngineStatus.models`。否决，因为 `installed=false` 仍可能是合法 Product target，
且 `EngineStatus` 没有 managed provider/catalog id/runtime identity 的完整语义。

### 2. Kanban 使用 authority adapter，而不是 Product-only modal fork

feature-local adapter 输出统一的 `KanbanTaskTargetCatalog`：

```ts
type KanbanTaskTargetOption = {
  engine: EngineType;
  displayName: string;
  selectable: boolean;
  target: ExecutionTarget;
};
```

- Product ready：只从 canonical Product target catalog 生成；engine 是否安装不参与 selector visibility。
- Local/unknown：从现有 `engineStatuses + codexModels` 生成，保留 installed disable 与 Codex hydrated
  catalog 兼容。
- Product catalog `refreshing/stale/empty`：保留 Product engine shell 和 last-good rows；没有合法 row 时
  disabled/fail closed，绝不切回 local models。

**Alternative：** 在 modal 内写 `if productReady`。否决，因为 selection normalization、storage mapping 与
tests 会继续依赖两套 shape。

### 3. Kanban task 增加 optional exact `executionTarget`

`KanbanTask`、create/update input 与 draft 增加 `executionTarget?: ExecutionTarget | null`；旧
`engineType/modelId` 作为 compatibility mirror 继续写入。storage loader 使用已有
`normalizePersistedExecutionTarget()`，malformed target 丢弃并保留 legacy fields。

selection 的 value 使用 target identity key，而不是只用 model id，避免跨 engine 同名 model 歧义。
catalog refresh 依次执行：preserve exact target → match legacy catalog/runtime identity → first compatible
row → empty。

### 4. Execution boundary 冻结 fresh target，再产生 side effect

AppShell orchestration 在 TaskRun/session side effect 前解析 target：

1. Product ready：用当前 canonical Product catalog 校验/repair task target；旧 task 通过
   `engineType/modelId` 映射到 managed target。
2. 已持久化 managed target 但 Product catalog 不可用：fail closed，禁止降级 local provider。
3. Local Mode：exact target 可直接使用；旧 fields 构造 explicit disk target。
4. 调用 `ensureProductEngineReadyV1(engine, providerProfileId)`；ready 后才创建 TaskRun/session。
5. session options 带 `providerProfileId`，first send 始终带 resolved runtime `model`；TaskRun snapshot 记录
   runtime model。

这同时覆盖 autoStart、drag、scheduled、retry、fork；不依赖 UI 当前 active engine。

### 5. Displayed engine 与 TaskRun policy 对齐，legacy 继续可读

新 TaskRun creation 使用 `isEngineExecutionEnabled()`；`TaskRunRecord.engine` 扩为完整 `EngineType`，loader
仍接受 legacy Gemini records，避免历史消失。Kanban orchestration 移除 `"claude" | "codex"` cast，使用
registry/policy 支持的 executable engine type。

## Validation and Error Matrix

| Case | Catalog/UI | Persisted target | Execution |
|---|---|---|---|
| Product ready + Codex/Kimi shared row | 两个 engine 均显示 | 各自 engine + managed provider + exact ids | exact endpoint/runtime model |
| Product ready + Anthropic-only row | 仅 Claude | Claude managed target | Claude runtime model |
| Product ready + local Grok installed | 不显示 Grok | 不可新建 Grok Product task | 不发生 side effect |
| Product models refreshing with last-good | 保留 last-good + status | 保留有效 selection | 可按 last-good exact target |
| Product empty/incompatible | Product engines disabled/empty | 不生成 target | create disabled/fail closed |
| Legacy task + Product ready | current catalog repair | 可在下次编辑时升级写入 | managed target |
| Legacy task + Local Mode | local options | legacy compatible | disk/default target |
| malformed persisted target | 忽略 target、尝试 legacy repair | 不传播 poisoned fields | unresolved 时 fail closed |
| catalog id != runtime model | label/id 正常 | 两个字段均保留 | send runtime model |

## Good / Base / Bad

- **Good**：Product picker、Kanban selector 与 execution resolver 都读取同一个按 engine 分组的 target rows。
- **Base**：Local Mode 继续通过现有 controller/provider catalog adapter，不改变 local custom model 行为。
- **Bad**：把 Product models 写回 `EngineStatus.models`，或在 Kanban 根据 model name/protocol 再猜一次。
- **Bad**：只保存 model option value，并在 scheduled run 时从当前 active engine 反推 Provider。

## Risks / Trade-offs

- [Risk] `ExecutionTarget` 增加 storage payload 体积。→ 单 task 仅增加少量 scalar fields；保留 flat mirror
  便于 rollback。
- [Risk] Product catalog refresh 与 modal restore race。→ pure preserve/repair helper + generation-independent
  snapshot，测试 rerender/refresh/empty。
- [Risk] 根 AppShell 订阅 Product store引发额外 render。→ Product adapter 由 lazy Kanban/Composer consumer
  直接订阅或接收 stable projection；不新增 root 高频 state/polling。
- [Risk] 扩大 TaskRun engine type 影响历史。→ loader 明确保留 legacy Gemini；new-run policy 与可见 selector
  分开验证。

## Migration Plan

1. 先新增 canonical Product target catalog 与 pure tests，迁移 Composer consumer，保证现有行为等价。
2. 新增 Kanban authority adapter，Product mode selector 切换到 canonical rows。
3. 扩展 task/draft dual-read storage 与 modal submit；不批量改写已有 store。
4. 执行 boundary 在 side effect 前解析/freeze exact target，补 scheduled/retry/Kimi regression。
5. Hot Doge 目视 smoke：Product Kanban 只显示 3 engines/upstream models，创建任务后检查实际 model/provider。

Rollback：保留 legacy `engineType/modelId` mirror；回滚 UI/execution adapter 后旧版本仍能读取新任务基本字段，
新增 `executionTarget` 会被旧 loader 忽略。

## Open Questions

无阻塞问题。其它辅助 surface（Project Map、Prompt Enhancer、Git commit generation）在本 change 中做
consumer audit；只有确认它们在 Product shipping UI 可达且仍绕过 canonical catalog 时才纳入同一 PR，
避免无证据扩围。

