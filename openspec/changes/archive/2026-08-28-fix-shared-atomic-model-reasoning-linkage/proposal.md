## Why

Shared Session Atomic 选择器在 **Grok CLI → Codex**（以及更广义的跨引擎/跨模型）切换后，思考强度 **不跟目标模型 capability 联动**：

1. 选中值常落成 `null`（UI「默认」），而 catalog 如 `gpt-5.6-sol` 的 `defaultReasoningEffort` 是 `low`
2. 档位列表仍可能来自全局 `activeEngine`（例如 Grok 固定 `low/medium/high`），丢掉 Codex 模型的 `xhigh/max/ultra`

Native Codex 的 model ↔ effort 路径是通的；断裂只在 Shared / create-session Atomic `ExecutionTarget` 构造与 Composer options 投影。

这是一类问题：Atomic 把「模型身份」与「reasoning options/effort」拆成两条互不通信的链路。

## What Changes

- 新增纯函数模块 `atomicModelReasoning`：按 engine+model 解析 options / default / inherit 校验
- Atomic catalog `ModelInfo` 保留/补齐 `supportedReasoningEfforts` + `defaultReasoningEffort`（Codex generated catalog / custom）
- `buildProviderExecutionTarget` 写入 `reasoning` 时：
  - 同 engine+profile：旧 effort 仍在 allowlist 则保留，否则落到模型 default
  - 跨引擎：不继承旧引擎 effort，用目标模型 default
- Shared / create-session Composer 的 `reasoningOptions` 跟 `selectedAtomicTarget`（即 Shared 的 `selectedNextTarget`）走，禁止用全局 activeEngine 的 Grok 三档冒充 Codex
- 回归测试锁定 `gpt-5.6-sol` 与跨引擎/同 profile 场景

## 目标与边界

- **目标**：Shared Atomic 选模型/切引擎后，思考 options 与 selected effort 与 Native Codex 一样由目标模型 capability 驱动
- **边界**：只修 Atomic target 构造 + Composer options 投影 + catalog enrich；不改 send 权威、Turn Badge 快照、Native 续接、capability matrix fixture

## 非目标

- 不强制 Shared 切换 target 时 `setActiveEngine`（options 走 target-local 解析即可）
- 不为 unknown runtime 模型伪造 capability（保持 capability-neutral）
- 不改变 Claude/Grok fixed allowlist 与 Default（null）语义
- 不在本 change 自动 rewrite 历史已落盘的 `reasoning: null`（新选择与新切换即正确）

## Capabilities

### New Capabilities

- （无）收敛到既有 Shared execution target 契约

### Modified Capabilities

- `shared-execution-target`：补充 **Atomic model ↔ reasoning effort linkage**——选模型/切引擎时 effort seed 与 options 必须以目标 engine+model capability 为权威，不得继承跨引擎 stale effort，不得用全局 activeEngine fixed list 冒充 Codex 模型档位

## Impact

- Frontend:
  - `src/features/models/atomicModelReasoning.ts`（新）
  - `ModelSelect.tsx` / `buildProviderExecutionTarget`
  - `useProviderTargetCatalogOwners.ts`（toModelInfo enrich）
  - `Composer.tsx`（atomicReasoningOptions）
  - `ChatInputBox/types.ts`（ModelInfo 字段）
- Tests: `atomicModelReasoning.test.ts`、`ModelSelect.test.tsx`
- Docs/OpenSpec: 本 change + `shared-execution-target` delta
- Backend: 无

## 技术方案对比

| 选项 | 描述 | 取舍 |
|------|------|------|
| A. Shared 切 target 时同步 setActiveEngine | 让父层 options 碰巧正确 | 仍不读模型 default；竞态与全局 engine 污染 |
| B. 仅在 UI 层按模型 id 硬编码档位 | 快速止血 | 双源、难维护、与 catalog 脱节 |
| **C. Target-local capability resolver + catalog enrich（推荐）** | Atomic 构造与 options 共用 `atomicModelReasoning` | 与 Native 语义对齐、可单测、无全局副作用 |

采用 **C**。

## 验收标准

1. Shared 中从 Grok 切到 Codex `gpt-5.6-sol` 后：
   - selected effort MUST 为 `low`（模型 default），MUST NOT 保持 Grok 的 effort，MUST NOT 无意义地停在 Default/null
   - options MUST 包含 `xhigh`/`max`/`ultra`（catalog 声明），MUST NOT 仅显示 Grok 三档
2. 同 Codex profile 内从 A 模型（effort=high）切到仍支持 high 的 B 模型：MUST 保留 high
3. 同 profile 内切到不支持当前 effort 的模型：MUST 收敛到该模型 default
4. Claude/Grok：跨引擎不继承；同引擎可 inherit；未选手动时仍可为 Default/null
5. Native Codex 既有 model↔effort 路径 MUST 不回退

## 实现状态

- [x] `atomicModelReasoning` 纯函数 + 单测
- [x] `buildProviderExecutionTarget` seed/校验
- [x] Atomic catalog enrich（toModelInfo / discover）
- [x] Composer Shared/create-session options 跟 target
- [x] ModelSelect 回归（Grok→Codex sol / same-profile keep）
- [x] 本提案与 delta spec 更新

## Review 补强（第二轮）

换角度审查后追加：

1. **partial metadata merge**：仅有 `defaultReasoningEffort`、空 `supported` 时仍从 catalog 补全 supported，避免 options 退化为单档
2. **`reconcileAtomicReasoningEffort`**：UI 显示与 store 收敛共用；Codex null/非法 → 模型 default；Claude/Grok 非法 → null
3. **Composer 内存 soft-repair**：Shared hydrate 后遗留 null/非法 effort 时写回 `selectedNextTarget`（语义相等则 skip，防环）
4. **Send 边界 reconcile**：`useThreadMessaging` Shared 发送路径对 target effort 再收敛一次，防止 UI 已修但 send 仍带 null

## Review 补强（第三轮：Shared Grok 初始化 × Native Codex 残留）

用户复现：先用 **Native Codex**，再创建 **Shared Grok** 初始化时思考菜单出现 Default + Low…Ultra（Codex 全量档），并可能勾上父层残留 `high`。

根因链路：

```text
Native Codex → activeEngine=codex + selectedEffort=high + options=catalog全量
     ↓
start Shared Grok → initialTarget.engine=grok, reasoning=null
     ↓ 不 setActiveEngine
Composer 若 target 未就绪 / 回落父层 → 仍用 codex options + high
     + showDefaultOption(grok)=true → 截图态
```

第三轮加固：

1. **Shared/create-session 禁止回落父层** `reasoningOptions` / `selectedEffort`（target 空 → `[]` / `null` fail-closed）
2. **`buildLocalSharedSessionInitialTarget`** 按目标 engine+model 播种 effort，禁止 inherit 全局 Native 状态
3. soft-repair 覆盖 claude/grok/codex
