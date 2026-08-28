## Context

Shared 创建入口（`handleStartSharedConversation`）今天：

```text
getEngineModels(engine)  // 无 profile、无 forceRefresh
  → buildLocalSharedSessionInitialTarget(engine, models, "本地配置", ...)
  → startSharedSession(initialTarget)
```

后端 Claude/Codex 在无 managed profile 时走 `engine_manager` status cache；未 `forceRefresh` 时返回过期 `status.models`。渠道名却写死本地。打开既有会话则走 `selectedTarget` hydrate，行为正确，**必须保留**。

Atomic 渠道切换已证明正确路径：`ensureModels(engine, profileId)` + Claude `syncClaudeModelMappingForProfile(profileId)`。

## Goals / Non-Goals

**Goals:**

1. 创建时默认 **该 CLI Provider catalog 有序列表的第一项**。
2. 该 Provider 的 models / runtime / 展示 mapping 来自 **profile 权威源**。
3. 产出完整 `ExecutionTarget`，与现有 start RPC fail-closed 契约兼容。
4. 打开既有 Shared Session **不改** last-target 回显。

**Non-Goals:**

- 改发送、Badge、recovery、Native 续接产品语义。
- 重做 Provider 排序算法（沿用 `get*Providers` + DEFAULT 本地哨兵顺序）。
- 全局 `setActiveEngine` 作为 display authority。

## Decisions

### D1 — 默认 Provider = 有序列表第一项

Provider 顺序与 Atomic picker 一致：

1. 各引擎 DEFAULT 本地 sentinel（若 catalog 未含则前置）
2. 其后 managed providers（后端 sort_order / created_at）

**第一项** 即创建默认；不得硬编码「永远 local」或「永远第一个 managed」。

### D2 — 模型源权威（按 profile 类型）

| Profile | 取数 |
|---------|------|
| 本地 sentinel | `getEngineModels(engine, { providerProfileId: localId, forceRefresh: true })` |
| managed | `getEngineModels(engine, { providerProfileId: managedId })`（backend provider-scoped，实时读 config） |

禁止创建路径再调用裸 `getEngineModels(engine)`。

默认 model = catalog 默认行（`isDefault`）否则第一行；runtime = `model || id`。

### D3 — Claude mapping 与 target 同步

当默认 engine 为 Claude 时，创建前调用 `syncClaudeModelMappingForProfile(defaultProfileId)`，与 `handleChannelSwitch` 同源，避免 localStorage 残留 MiniMax 映射污染闭合态标签。

其它 CLI 无 ANTHROPIC mapping 则跳过。

### D4 — initialTarget 形状

| 字段 | 规则 |
|------|------|
| `engine` | 用户在 Shared 子菜单选的 CLI |
| `providerProfileId` | 本地 → `null`；managed → 真实 id |
| `providerProfileSource` | `disk` \| `managed` |
| `providerProfileNameSnapshot` | 列表展示名（本地 →「本地配置」i18n） |
| `modelCatalogEntryId` / `model` | 来自权威 catalog |
| `reasoning` | 沿用 `resolveAtomicReasoningEffort`（inherit false） |

可重构 `buildLocalSharedSessionInitialTarget` 为更通用的  
`buildSharedSessionInitialTarget({ engine, profile, models, ... })`，避免双轨语义。

### D5 — 打开既有会话（硬边界）

| 路径 | 行为 |
|------|------|
| create | 本 design 默认第一 Provider |
| open / hydrate | **不变**：磁盘 `selectedTarget` + memory store 回显 last used |
| 切渠道 / 选模型 | 既有 Shared picker 契约 |

实现时 **不得** 在 thread 激活时用「创建默认」覆盖已有 `selectedNextTarget`。

### D6 — Fail-closed

- Provider 列表空 / 第一 profile 模型空 → 抛可读错误，不创建会话
- catalog 拉取失败 → 同上
- mapping sync 失败 → **不阻断** 创建（与渠道切换一致：mapping 失败不挡 target）

### D7 — 打开历史：展示与 mapping 对齐（验收跟进）

创建修复后，打开历史 Shared 仍可能出现「chip 正确、文案/图标串上一 managed」：

1. `ChatInputBox` 在完整 `executionTarget` 变化时对 Claude 调用 `syncClaudeModelMappingForProfile(activeProfileId)`（与切渠道同源；失败不挡 ensure）。
2. 列表**文案**与**图标**统一走 catalog runtime 优先（`resolveClaudeCatalogModelLabel` / `resolveModelIdForIcon`），禁止陈旧 localStorage mapping 盖掉已 forceRefresh / provider-scoped 的 `model.model`。
3. 打开路径仍**禁止**调用 create 默认「第一 Provider」算法 reseed last target。

### D8 — 品牌短 id

Moonshot Coding 常见 runtime 短 id `k3` / `k3-256k` 在 `providerBrandIcon` 中映射到 kimi，避免仅落 Claude 默认图标或被错误 mapping 指到 deepseek。

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| forceRefresh 创建变慢 | 仅创建路径一次；可与 ensureProfiles 并行 |
| 第一项是 local 但用户期望 managed | 顺序与 picker 一致；用户可立即切渠道 |
| 重构 builder 破坏现测 | 保兼容包装或更新 `initialTarget.test.ts` |
| 误伤 open hydrate | 代码评审强制：只碰 create 入口 |

## Migration Plan

- 无数据迁移。已存在会话 selectedTarget 不动。
- 新会话从修复后的创建路径写入完整 target。
- 回滚：恢复裸 `getEngineModels` + local-only builder。

## Open Questions

- 无（「第一供应商」= catalog 有序列表第一项；open 回显 last 已确认）。
