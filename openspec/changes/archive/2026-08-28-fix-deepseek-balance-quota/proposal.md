## Why

会话概览在 Codex/Claude 绑定 DeepSeek（`https://api.deepseek.com`）时额度查询失败，报 `base_url not a known coding-plan host`。根因有两层：host 未识别；现有 `windows[]` 百分比模型无法表达 DeepSeek 官方 **余额** API。此前归档的 `fix-native-session-quota-target-scoping` 有意把 DeepSeek 标为 unsupported；产品现要求对接官方 [查询余额](https://api-docs.deepseek.com/zh-cn/api/get-user-balance)，并在 **Native / Shared** 两条额度路径同时正确展示。

## What Changes

- 后端 `coding_plan_quota`：识别 DeepSeek host，调用 `GET https://api.deepseek.com/user/balance`（Bearer API Key），不再走 coding-plan 百分比接口。
- **数据结构扩展**（非破坏）：`CodingPlanQuotaSnapshot` 增加可选 `balance`（币种 + total/granted/topped_up + `is_available`）；`windows` 仍服务 Kimi/MiniMax/智谱。
- 前端类型 / viewModel：成功条件改为 `windows.length > 0` **或** `balance.items.length > 0`；余额映射到既有 `hasCredits` / `creditsBalance` 展示。
- UI：仅有余额、无百分比窗口时 MUST NOT 显示 coding-plan empty 文案。
- 覆盖 **Native**（current binding only）与 **Shared**（`useSessionQuotaList` 多 target 并行）——共用同一 `get_coding_plan_quota` command，不新增 IPC。
- 单测：host 检测、JSON 解析、viewModel 余额成功路径、Shared multi-entry 不串台。

## 目标与边界

### 目标

- DeepSeek provider（Codex managed / Claude managed 等，base 含 `api.deepseek.com`）额度查询 **成功** 时展示余额，失败时显式 error，不再误报 “unknown coding-plan host”。
- Native 与 Shared 均能查询并展示 DeepSeek 余额；Shared 多供应商时 DeepSeek 卡独立、不污染其他 source。
- 统一 snapshot 契约：百分比型与余额型共存，前端按形态渲染。

### 边界

- 仅改额度查询识别、balance 字段与概览展示；不改 send/runtime binding、不改 session target 收集策略（仍遵守 Native current-only / Shared multi）。
- 余额 endpoint 固定 `https://api.deepseek.com/user/balance`，不随 chat base 的 `/anthropic` 路径拼接。
- 不引入轮询；仍按现有 mount/refresh 触发查询。

## 非目标

- 不实现 DeepSeek 用量百分比 / rate-limit 窗口（官方无对应 coding-plan API）。
- 不重做整个 status panel 或 Cost 区；token 成本仍归 CostBudgetSection。
- 不扩展其他未知 host 的“万能余额探测”。
- 不改 i18n 键结构（复用 `usage.credits` 等既有键；必要时仅补 deepseek 相关短文案）。
- 实现阶段不自动 git commit（交用户审批）。

## Capabilities

### New Capabilities

- `provider-balance-quota`：余额型供应商额度（DeepSeek 为首个实现）的后端查询契约、snapshot `balance` 形态、与 coding-plan `windows` 并存的前端映射规则。

### Modified Capabilities

- `status-panel-session-overview`：额度卡成功态扩展为「百分比 windows 或 balance credits」；无 windows 但有余额时不得显示 empty；error 文案不再把 DeepSeek 归为 unknown coding-plan host。

## Impact

| 层 | 影响 |
|----|------|
| Backend | `src-tauri/src/coding_plan_quota.rs`（detect / query_deepseek / snapshot 字段） |
| Frontend types | `src/services/tauri/modelCatalog.ts` |
| ViewModel | `sessionOverviewViewModel.ts`（成功条件 + credits 映射） |
| UI | `SessionOverviewSection.tsx`（empty vs credits） |
| Hooks | 无逻辑变更（`useCodingPlanQuota` / `useSessionQuotaList` 复用 command） |
| OpenSpec | 本 change + 上述 capability delta |
| IPC | **无新增** command；扩展既有 `get_coding_plan_quota` 响应形状（additive） |
| Dependencies | 无新增 crate/npm |

## 技术方案对比

| 选项 | 描述 | 取舍 |
|------|------|------|
| A. 仅把 deepseek 标 known，伪造 100% window | 最小前端改动 | 语义错误；余额非百分比；**拒绝** |
| B. 新 Tauri command `get_provider_balance` + 独立 UI 块 | 解耦彻底 | 双路径、Shared 要两套 list；过度设计 |
| **C. 扩展 CodingPlanQuotaSnapshot.balance + 复用 credits 展示（推荐）** | 一个 command、Native/Shared 自动覆盖、UI 已有 credits 行 | 与现网一致；additive 无 BREAKING |

采用 **C**。

## 验收标准

1. Codex/Claude + DeepSeek（`https://api.deepseek.com` 或 `.../anthropic`）Native 概览：额度查询成功时展示余额（默认 `CNY 110.00` 形态，多币种 ` · ` 拼接），MUST NOT 出现 `not a known coding-plan host`。
2. Shared 会话含 DeepSeek 与其它供应商：DeepSeek 卡独立显示 balance；其它卡仍 windows / official_cli；互不串 source。
3. 缺 API Key / HTTP 401：`success=false`，UI error，不崩溃。
4. 余额成功且 `windows=[]`：MUST NOT 显示 codingPlanEmpty；MUST 显示 credits 行。
5. Kimi/MiniMax/智谱百分比路径无回归。
6. `cargo test`（coding_plan_quota）与相关 Vitest 绿。
