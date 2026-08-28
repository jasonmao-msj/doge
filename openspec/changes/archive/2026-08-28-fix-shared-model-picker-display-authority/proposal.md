## Why

Shared Session 底栏 Atomic 模型选择器在 `selectedNextTarget` 已完整且发送/Badge 正确时，仍可能显示「选择模型」。根因不是 Shared 之间共享 model 状态，而是 **展示层把 catalog / 全局 `activeEngine.models` 当成了选中态权威**，与 `selectedNextTarget` 权威源脱节。Grok 本地配置场景最易复现；Claude managed 切换还会叠加 target 丢失后的全局回落，造成“串台”体感。

## What Changes

- 明确 Atomic/Shared 闭合态 trigger 的 **display authority**：`executionTarget`（Shared 即 `selectedNextTarget`）快照优先于 catalog 命中与父层 `models`。
- Shared 下 **禁止** 用全局/Native `selectedModelId` 与 `activeEngine` 模型列表去“冒充”已选 target；target 缺失时显式空选，不静默借用。
- Shared 会话在持有完整 `selectedNextTarget` 时，composer 层 **主动 ensure** 对应 engine+profile 的 model catalog（enrichment），但不以 catalog 就绪作为标签前置条件。
- 补齐回归测试：Grok/Shared local 未开菜单、catalog 空、父层 models 为其他 CLI 时，trigger 仍展示正确模型；Shared target 为 null 时不回落全局 model id。
- 文档/契约：在 `shared-execution-target` 中固化 display vs send vs badge 三源关系。

## 目标与边界

- **目标**：Shared 选中态 UI 与 `selectedNextTarget` 一致；catalog 仅增强列表/勾选，不绑架闭合态标签；消除跨会话/跨 CLI 的假共享体感。
- **边界**：只改 Shared/Atomic 展示与 Shared 下 props 解析边界；不改 send 权威、不改 Turn Badge 快照、不改 Native 续接语义、不改磁盘 `selectedTarget` 持久化协议。

## 非目标

- 不把历史 Turn Badge 反推为 next-target（禁止 history→picker 污染）。
- 不取消 V2「不完整 target 禁止发送」fail-closed。
- 不重做整个 ModelSelect 信息架构或拆掉 Atomic 双栏。
- 不在本 change 修 identity 续接类问题（已归档 `fix-shared-session-identity-id-first`）。
- 不提交 git commit（实现后交用户审批）。

## Capabilities

### New Capabilities

- （无）本变更收敛到既有 Shared target 契约，不新增平行 capability 名。

### Modified Capabilities

- `shared-execution-target`: 补充 **Picker closed-state display authority**、Shared 下禁止全局 model 回落、catalog 为 enrichment 的主动加载要求。

## Impact

- Frontend:
  - `ModelSelect.tsx`（闭合态 label / currentModel 解析）
  - `Composer.tsx`（Shared 时 selectedModelId / models 边界；可选 mount ensure）
  - `ChatInputBox.tsx` / Adapter（target-aware catalog ensure 入口）
  - `useProviderTargetCatalogOwners.ts`（仅在需要时配合 ensure，不改 binding key）
- Tests: `ModelSelect.test.tsx`、`Composer*.test.tsx`、必要时 catalog owner 测试
- Docs/OpenSpec: 本 change + `shared-execution-target` delta
- Backend: **无**（不改 Rust 持久化）

## 技术方案对比

| 选项 | 描述 | 取舍 |
|------|------|------|
| A. 仅在 ModelSelect 对空 catalog 用 `value` 合成一行 | 最小 diff | 仍吃父层错误 `models`；Shared/Native 边界不清；止血味重 |
| B. 创建 Shared 时强制 `setActiveEngine` | 顺带修 Grok 创建瞬间 | 无法覆盖 Shared 内换 CLI；全局 engine 仍非权威 |
| **C. Target-snapshot display authority + Shared 隔离回落 + catalog ensure（推荐）** | 闭合态只信 `executionTarget`；列表靠 ensure；null 显式空选 | 与既有 next-target 契约一致，正规、可回归 |

采用 **C**。A/B 可作附带减负，不能替代 C。

## 验收标准

1. Shared + 完整 `selectedNextTarget`（含 Grok 本地配置）时，**未打开**模型菜单，底栏 trigger MUST 显示模型名（或 runtime/catalog entry id），MUST NOT 固定「选择模型」。
2. 父层 `models` 属于其他 CLI 且非空时，Shared Atomic trigger MUST 仍跟 `executionTarget`，MUST NOT 被错误列表掩盖。
3. Shared `selectedNextTarget === null` 时，trigger 显示未选；Composer MUST NOT 把全局 `selectedModelId` 当作 Shared 已选态。
4. 发送仍只信完整 `selectedNextTarget`；Badge 仍只信 Turn 快照；本改不改变二者。
5. 打开菜单后 catalog 列表仍正确；Claude 渠道切换既有契约不回归。
6. 相关 vitest 绿；不提交代码，由用户审批。
