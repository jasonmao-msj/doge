## Context

Shared Atomic 路径用 `ExecutionTarget` 承载下一轮 CLI/Provider/Model/Reasoning。模型选择走 `buildProviderExecutionTarget`，但 reasoning 历史逻辑是：

- 同 engine+profile：原样继承 `current.reasoning`
- 否则：仅 custom 模型硬编码 `medium`，catalog 模型 → `null`

同时 Composer 的 `reasoningOptions` 来自 app-shell `activeEngine` + 全局 model 投影。Shared 切 target **不** `setActiveEngine`，因此从 Grok 切到 Codex 后 options 仍可能是 `GROK_REASONING_OPTIONS`（三档），与 `gpt-5.6-sol` catalog（含 xhigh/max/ultra、default=low）完全脱节。

Native Codex 则经 `ModelOption.supportedReasoningEfforts` / `getReasoningOptionsForModel` 联动。

## Goals / Non-Goals

**Goals**

- Atomic 写 target 时 effort 由目标模型 capability 决定
- Shared/create-session UI options 跟 `selectedAtomicTarget` 决定
- 与 generated Codex catalog / custom 默认档对齐
- 可单测的纯函数边界

**Non-Goals**

- 全局 activeEngine 与 Shared target 强制同步
- 历史已持久化 `reasoning: null` 的批量修复
- EngineModelInfo / Rust ModelInfo wire 字段扩展（本轮用 FE catalog enrich）

## Decisions

### D1：纯函数 `atomicModelReasoning` 为唯一 Atomic 解析入口

- `resolveAtomicReasoningOptions(engine, model)`
- `resolveAtomicDefaultReasoningEffort(engine, model)`
- `resolveAtomicReasoningEffort({ engine, model, previousEffort, inherit })`
- `enrichModelInfoWithAtomicReasoning(engine, model)`

`buildProviderExecutionTarget` 与 Composer 都只调用这些函数，避免第三条规则副本。

### D2：Codex metadata 来源优先级

1. 调用方传入的 modelMeta / ModelInfo 字段
2. `source === "custom"` → `CUSTOM_MODEL_*`
3. `CODEX_MODEL_CATALOG` / generated fallback 按 id/runtime 命中
4. 否则 capability-neutral（空 options、null effort）

### D3：Inherit 规则

| 条件 | 行为 |
|------|------|
| 同 engine+profile 且 previous ∈ allowlist | 保留 previous |
| 同 engine+profile 且 previous ∉ allowlist | Codex → model default；Claude/Grok → null |
| 跨 engine / 跨 profile | 不继承；Codex → model default；Claude/Grok → null |

### D4：Composer options 分叉

- Shared 或 create-session Atomic：`atomicReasoningOptions` 从 target engine+model 解析
- Native 会话：仍用父层 `reasoningOptions`（既有 ModelOption 路径）

### D5：不在本轮扩展 Rust EngineModelInfo

FE enrich 足够覆盖 fallback catalog 与 custom；runtime discover 的未知模型保持 neutral，符合既有 codex-model-catalog-coverage 精神。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| catalog 未加载时 modelMeta 为空 | `buildProviderExecutionTarget` 用 model id 查 generated catalog |
| 父层 providerModelCatalogs 无 reasoning | Composer resolve 时再次 lookup catalog by id |
| 与旧测试假设 `reasoning: null` 跨引擎 | 仅 unknown 模型仍 null；已知 sol 变 low — 更新测试 |

## Migration Plan

- 无 DB/schema 迁移
- 用户重新在 Atomic 中点选/切换渠道后即可得到正确 effort
- 可选后续：hydrate 时对 Codex 完整 target 且 reasoning=null 做一次 soft repair（本 change 不做）

## Open Questions

- 无阻塞项。是否对已落盘 null effort 做 soft repair 留给 follow-up。
