# 统一 Product 目标目录并修复面板管理选项

## Goal

以 `unify-product-target-catalog-consumers` OpenSpec change 为计划载体，让 Doge Product 的 Composer、
Kanban「面板管理」与任务执行链共享同一份 upstream-derived exact execution target catalog，消除 local
engine detection 泄漏与 model/provider/runtime identity 漂移。

## What I already know

- 截图来自 `src/features/kanban/components/TaskCreateModal.tsx`。
- 当前 modal 对 Codex 使用 `codexModels`，其它 engine 使用 `EngineStatus.models`；engine options 直接遍历
  local detection statuses。
- 归档 change `align-kanban-codex-model-catalog` 明确只修 Codex，保留其它 engine 旧 source。
- Product Composer 已使用 upstream entitlement + exact API protocol compatibility，但 projection 目前在
  Composer component 内临时组装。
- Kanban task 只保存 `engineType + modelId`，execution helper 还存在 `"claude" | "codex"` cast；Kimi
  可以显示但 TaskRun policy 可能拒绝，属于 displayed-vs-executable drift。

## Requirements

- Product ready 时 Kanban 只显示 Product entitlement engines/models，不回退 local catalog。
- Composer、Kanban、target repair、task execution 复用 canonical Product target projection。
- entitlement 与 installation 分离；未安装但有合法 target 的 Product engine 可选择，执行时按需准备。
- task 持久化 exact `ExecutionTarget`，flat fields 兼容镜像；旧 task dual-read。
- 所有 launch trigger 使用 managed provider + runtime model，side effect 前 fail closed。
- Local Mode 行为与 custom/provider-scoped catalog 保持兼容。

## Acceptance Criteria

- [ ] Product Kanban 仅显示 Codex/Claude/Kimi，不显示 local Grok/OpenCode。
- [ ] 每个 engine model rows 与 Composer canonical Product catalog 完全一致。
- [ ] `modelCatalogEntryId != model` 时实际 send 使用 runtime model。
- [ ] Kimi/Codex/Claude selectable task target 均能建立 TaskRun/session；不再有 UI 可选但 coordinator 拒绝。
- [ ] Product catalog unavailable/incompatible 时零 local provider drift、零 session side effect。
- [ ] legacy task/draft/run 数据仍可读。
- [ ] L3 focused verification 与 Hot Doge user visual smoke 通过。

## Definition of Done

- Tests added/updated for projection, modal, storage, resolver and orchestration.
- Typecheck、targeted lint、contract/docs/OpenSpec gates 通过。
- Foundation ADR 最近校准与 Trellis executable contract 同步。
- PR 描述附 Engine Onboarding §0 matrix、render smoke 与 L4 CI scope。

## Technical Approach

采用 canonical Product target catalog + explicit Product/Local adapter；不污染 `EngineStatus`。Kanban 新写
exact target、保留 legacy mirror；AppShell orchestration 在 TaskRun/session side effect 前按 current authority
验证并冻结 target。

## Decision (ADR-lite)

**Context**：局部 Codex prop patch 已证明会随新增 Product authority 再次 drift；直接覆盖 `EngineStatus`
又会混淆 entitlement 与 installation。

**Decision**：Product target projection 是唯一 Product catalog owner；Local controller 只拥有 local facts。
selector 与 execution 共享 exact target shape。

**Consequences**：增加一个稳定 domain projection 和 optional task storage 字段，但换来 UI/execute parity、
future consumer reuse 与可回滚 dual-read。

## Out of Scope

- Rust/Tauri/upstream model API 改造。
- Kanban visual redesign、schedule/chaining redesign。
- 无证据地迁移不可达的 auxiliary surfaces；consumer audit 会记录结果。

## Relevant Specs

- `.trellis/spec/backend/provider-scoped-model-catalog.md`：catalog identity、provider scope、last-good/fail-closed。
- `.trellis/spec/backend/account-convenience-native-contract.md`：managed provider 与 Product authority。
- `.trellis/spec/guides/cross-layer-thinking-guide.md`：selector → storage → execution target data flow。
- `.trellis/spec/guides/code-reuse-thinking-guide.md`：消除多处 protocol/model filtering。
- `.trellis/spec/guides/risk-based-test-strategy.md`：L3 routing/persistence verification。

## Code Patterns Found

- `productModelCompatibility.ts`：canonical endpoint protocol compatibility。
- `productExecutionTarget.ts`：catalog id/runtime model/provider identity resolution。
- `engineControllerCatalog.ts`：Local Mode model projection，不承担 Product entitlement。
- `shared-session/target/types.ts`：`ExecutionTarget` normalization 与 resolved identity contract。

## Files Likely To Modify

- `src/features/account/runtime/productTargetCatalog.ts`（new）及 Product picker/target resolver。
- `src/features/kanban/components/TaskCreateModal.tsx`、Kanban prop chain、types/storage/tests。
- `src/app-shell-parts/useAppShellKanbanExecutionSection.ts`、Kanban helpers、TaskRun types/storage/tests。
- OpenSpec/Trellis/foundation ADR documents。

## Verification Level

L3 Cross-layer / High-risk：影响 Product catalog authority、client storage、engine/provider routing 与 scheduled
execution。执行 affected Vitest/integration、targeted ESLint、full TS typecheck、runtime/docs/contracts；L4 full
suite、Windows/macOS package smoke 留给 CI/Release。

