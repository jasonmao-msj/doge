## Why

Doge Product 已有由 upstream `/v1/models`、API protocol compatibility 与 managed Provider
共同组成的真实 engine/model catalog，但该事实目前只在 Composer 生效。Kanban「面板管理」仍读取
本地 CLI detection 的 `EngineStatus.models`，导致 Product 用户看到 `opencode`、`grok` 与上游未授权
model；更严重的是，任务只保存 flat `engineType + modelId`，展示选择与实际 Provider/runtime model
可能继续分裂。

## 目标与边界

- 建立 canonical `ProductTargetCatalog` projection：把 upstream Product engines/models 一次性投影为
  每个 engine 的完整可执行 target facts。
- Composer、Kanban 创建/编辑 selector 与 Product target repair MUST 复用该 projection，不允许各自重新
  解释 protocol、model identity 或 engine availability。
- Product 用户在 Kanban 只看到 entitlement 中的 `Codex / Claude / Kimi` 以及各自 protocol-compatible
  models；Local Mode 继续使用本地 `useEngineController` catalog。
- 新建/编辑 Kanban task 持久化完整 `ExecutionTarget`，保留 `modelCatalogEntryId != model`、managed
  `providerProfileId` 与 readable provider snapshot；旧 `engineType + modelId` 数据继续可读。
- Kanban 首次执行、scheduled/retry/fork 与新建 conversation MUST 从同一 target 解析结果创建 session 和
  发送，不得再把 Product catalog id 当成 CLI runtime model。

## 非目标

- 不把 Product entitlement 伪装成 `EngineStatus.installed`，不改变按需安装语义。
- 不删除 Local Mode 的 engine detection、custom model 或 provider-scoped catalog。
- 不重做 Kanban modal 视觉布局、schedule/chaining 交互或 Task Center presentation。
- 不新增 Rust/Tauri command，不改变 upstream `/v1/models` wire contract。

## What Changes

- 新增共享 Product target catalog projection 与 typed engine/model target rows。
- Product Composer picker 改为直接消费按 engine 投影后的 catalog，而非在 component 内再次过滤。
- Kanban selector 增加 Product/Local authority adapter；Product ready 时 fail closed，禁止回退旧本地列表。
- Kanban task/draft storage 增加 optional `executionTarget`，执行链以 exact target 为 authority，flat fields
  仅作 backward-compatible mirror。
- 对 displayed-but-not-runnable 的 task engine contract 做一致性修复；新执行仅允许 product policy
  支持的 executable engines，legacy persisted runs 保持可读。

## 方案对比

1. **否决：只给 `TaskCreateModal` 增加 Product 条件分支。** 改动最少，但会复制 protocol filtering，
   也无法修复 catalog id/runtime model/provider binding 的执行偏差。
2. **否决：把 Product catalog 覆盖进 `EngineStatus.models/installed`。** 可以复用更多 legacy consumer，
   但会混淆 entitlement、installation 与 runtime detection；未安装但可按需使用的 engine 会被错误标记。
3. **采用：canonical Product target catalog + consumer adapter。** Product 与 Local authority 保持分离，
   presentation 和 execution 共享同一 target identity，后续其它辅助 selector 可直接接入。

## 验收标准

- Product ready 时，Kanban engine options 与 Composer Product picker 完全同源，只包含 upstream
  entitlement engines；`grok/opencode` 不得从 local detection 泄漏。
- 每个 Kanban engine 的 model ids/order/labels 与 canonical Product target catalog 一致，并复用同一个
  protocol projection；unknown/incompatible model fail closed。
- 切换 engine、catalog refresh、draft/edit restore 使用 preserve-valid / deterministic fallback；不得把旧
  engine 的 model 带到新 engine。
- 新任务持久化 exact `ExecutionTarget`；`modelCatalogEntryId != model` 时，TaskRun/session/send 使用 runtime
  `model` 和 managed provider identity。
- 旧任务只含 `engineType + modelId` 时仍可读取；Product ready 时可按当前 catalog 升级解析，Local Mode
  维持旧行为。
- L3 focused tests、targeted ESLint、TypeScript typecheck、runtime/docs/contracts 与 OpenSpec strict
  validation 通过；Hot Doge 完成真实 Product Kanban 目视 smoke。

## Capabilities

### New Capabilities

- `product-execution-target-catalog`: 定义 Product target catalog 的唯一 projection、consumer parity 与
  exact target identity contract。

### Modified Capabilities

- `codex-model-catalog-coverage`: 将旧的 Kanban Codex-only catalog 补丁升级为 Product/Local authority
  adapter，Product mode 不再允许非 Codex engine 读取 local status models。
- `agent-task-center`: Kanban launch 创建的 TaskRun 必须冻结 exact engine/provider/runtime model target，
  并让 displayed selectable engines 与可执行 policy 一致。

## Impact

- Account/Product：`src/features/account/runtime/productTargetCatalog.ts`、Product picker/target resolver。
- Kanban/Task Center：`TaskCreateModal` prop/data mapping、task/draft storage、task run types 与 execution
  orchestration。
- AppShell：仅作为 Product 与 Kanban peer feature 的 composition owner 传递/解析 exact target；不新增根级
  polling 或高频 store。
- Behavior/Trellis/ADR：新增 OpenSpec capability delta，更新 executable contract 与 foundation 最近校准。

