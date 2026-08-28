## 1. Pure resolver

- [x] 1.1 新增 `src/features/models/atomicModelReasoning.ts`：options / default / inherit / enrich
- [x] 1.2 单测覆盖：gpt-5.6-sol、跨引擎不继承、同 profile 保留/收敛、Claude/Grok allowlist、custom、unknown neutral

## 2. Atomic target construction

- [x] 2.1 `ModelInfo` 增加 optional reasoning 字段
- [x] 2.2 `toModelInfo` / discover 路径 `enrichModelInfoWithAtomicReasoning`
- [x] 2.3 `buildProviderExecutionTarget` 接入 `resolveAtomicReasoningEffort` + modelMeta
- [x] 2.4 ModelSelect 选模型/切渠道传入 modelMeta

## 3. Composer options projection

- [x] 3.1 Shared / create-session 使用 `atomicReasoningOptions` 跟 target
- [x] 3.2 Native 路径保持父层 reasoningOptions

## 4. Verification

- [x] 4.1 `vitest`：atomicModelReasoning + ModelSelect
- [x] 4.2 更新 OpenSpec proposal / design / tasks / delta spec

## 5. Review hardening

- [x] 5.1 enrich：partial default 时仍补全 supported
- [x] 5.2 `reconcileAtomicReasoningEffort` + Composer UI/store 收敛
- [x] 5.3 Shared send boundary reconcile in `useThreadMessaging`
- [x] 5.4 单测：partial enrich / null→default / invalid→default

## 6. Shared init × Native Codex residue

- [x] 6.1 Shared/create-session 禁止回落父层 reasoningOptions/selectedEffort
- [x] 6.2 `buildLocalSharedSessionInitialTarget` 按目标 CLI 播种 effort
- [x] 6.3 initialTarget 单测：Grok null / Codex sol→low
