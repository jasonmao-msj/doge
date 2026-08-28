## Why

Shared CLI 创建会话时，`handleStartSharedConversation` 用裸 `getEngineModels(engine)`（无 `providerProfileId`、无 `forceRefresh`）取模型，再硬标「本地配置」。Claude 本地路径落到 `engine_manager` 的 **过期 status cache**，导致渠道 chip 显示「本地配置」、列表却是过期映射（常见全显示 MiniMax-M3）。Native 创建后切供应商因走 provider-scoped catalog + mapping sync 而正确。需要正规化 **创建默认 Provider + 权威 catalog/mapping**，且 **打开既有 Shared Session 仍回显上次 target**。

## What Changes

- Shared 创建路径：对所选 CLI 解析 **有序 Provider 列表的第一项** 作为默认 Provider（与 Atomic picker 渠道顺序一致；含本地 sentinel 时即本地，否则为首个 managed）。
- 默认 Provider 的模型列表与 runtime 映射 MUST 来自 **profile-scoped 权威源**（本地：`forceRefresh` 重读 settings；managed：provider-scoped env/config），禁止裸 `getEngineModels(engine)` 吃全局 engine status cache。
- Claude 创建默认 Provider 时同步 `claude-model-mapping`（与渠道切换同一套 `syncClaudeModelMappingForProfile`），保证展示名与 runtime 一致。
- 初始 `ExecutionTarget` 仍完整（engine + provider 语义 + catalog/runtime model + 可读 snapshot），fail-closed 无可用模型时不创建会话。
- **打开既有 Shared Session**：保持现有 hydrate 逻辑——`selectedNextTarget` / 磁盘 `selectedTarget` 是什么就回显什么；本 change **不**改 resume、不改 history badge、不改发送权威。

## 目标与边界

- **目标**：创建瞬间默认 Provider + 模型数据正确可映射；打开会话回显上次选择。
- **边界**：只改 Shared **创建** 的 initial target 解析与 catalog/mapping 取数；Atomic 双栏交互契约不变。
- **非目标**：
  - 不改 Native 续接 / create-session 首页产品语义（可复用 force-refresh 工具，但不扩产品范围）
  - 不把全局 activeEngine 当 Shared 创建权威
  - 不改 Turn Badge / send pipeline / recovery
  - 不强制用户永远默认 managed 或永远默认本地——**以有序列表第一项为准**
  - 不在本 change 做 git commit

## Capabilities

### New Capabilities

- （无）收敛到既有 Shared target / 创建契约。

### Modified Capabilities

- `shared-session-engine-selection`: 创建时默认 Provider 从「固定 canonical local」改为「该 CLI 有序 Provider 列表第一项 + 权威 catalog/mapping」。
- `shared-execution-target`: 补充 initial target 模型源权威（profile-scoped / forceRefresh）；重申 open hydrate 回显 last target。

## Impact

- Frontend:
  - `src/app-shell-parts/useAppShellSections.ts`（`handleStartSharedConversation`）
  - `src/features/shared-session/target/initialTarget.ts`（扩展为「首 Provider + 权威 models」或并列 builder）
  - 可能复用 `useProviderTargetCatalogOwners` 的 key/ensure 语义、`syncClaudeModelMappingForProfile`
- Tests: `initialTarget.test.ts`、AppShell Shared create 相关、catalog ensure 参数断言
- Backend: **优先不改**；若本地 path 仅靠 `forceRefresh` 即可权威，保持 Rust 不动
- Docs/OpenSpec: 本 change + 两 capability delta

## 技术方案对比

| 选项 | 描述 | 取舍 |
|------|------|------|
| A. 仅给现有 local 路径加 `forceRefresh` | 最小 diff，仍固定本地 | 不满足「默认第一个供应商」；managed 优先场景仍别扭 |
| B. 默认第一个 managed，跳过本地 | 避开 local cache | 与列表顺序不一致；无 managed 时失败 |
| **C. 有序 Provider 第一项 + 该 profile 权威 catalog/mapping（推荐）** | 与 picker 顺序一致；本地/managed 统一取数纪律 | 创建路径略重，但语义清晰、可回归 |

采用 **C**。

## 验收标准

1. Shared 创建 Claude：默认 Provider = Claude 渠道列表第一项；其模型列表与 mapping 与 Atomic 切到该渠道后一致（无过期 MiniMax 串台）。
2. Shared 创建其它 CLI（Codex/Grok/Kimi/OpenCode）：同样第一 Provider + 权威 catalog，完整 initialTarget。
3. 打开既有 Shared Session：底栏 / picker 回显 **上次** `selectedNextTarget`，不因本修被重置为创建默认。
4. 无可用模型时创建 fail-closed，不产生半会话。
5. 相关 vitest 绿；实现后不自动 commit。
