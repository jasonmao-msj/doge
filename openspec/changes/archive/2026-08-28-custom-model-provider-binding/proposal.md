## Why

Claude / Codex 的「管理自定义模型」弹窗（`CustomModelDialog`）目前只把模型写入引擎级 localStorage 扁平列表，**不让用户选择所属三方供应商**。结果是新加模型默认落到「本地配置」语义：没有 `providerProfileId`、不会回写到对应 managed provider 的 `customModels`。而设置页供应商行已经展示「N 个自定义模型」，Codex managed profile 也已支持 `customModels` 并会 merge 进 catalog——**录入路径与消费路径不一致**。用户在模型管理页添加/修改时，需要先选供应商，再把自定义模型写入该供应商。

## 目标与边界

- **目标**：Claude 与 Codex 采用**同一套**自定义模型管理交互与写盘语义——添加/修改表单前置「供应商」选择；保存时把模型写入所选供应商的 provider-owned 模型集合，并同步 composer 可见 catalog（含 `providerProfileId` 溯源）。
- **边界**：只改自定义模型 **录入 / 编辑 / 删除 / 列表展示归属** 与对应持久化；不改会话 binding、send pipeline、runtime switch。
- **引擎范围**：Claude Code + Codex CLI 对称；Gemini 及其他引擎不在本 change 强制落地（可复用 UI 接口但非验收必达）。

## 非目标

- 不改 Composer 模型选择器的 footer「添加模型」路由目标（仍打开本机模型管理弹窗），但允许预填当前会话/当前活跃供应商。
- 不改变 Claude shape-only / Codex model-id 校验差异。
- 不引入新的第三方依赖。
- 不强制迁移历史无归属模型为某一供应商（可继续作为 local/unscoped 展示与可选编辑）。
- 不把供应商管理（增删改 provider 配置本体）并入本弹窗。
- 不在本 change 自动 git commit。

## What Changes

- `CustomModelDialog`（及 `VendorModelManagerDialogHost` / 设置页入口）在 **添加与修改** 表单最前增加 **供应商选择器**（本地配置 sentinel + 当前引擎的三方/managed providers 列表）。
- 保存自定义模型时：
  - 选 **managed / 三方供应商** → 写入该 provider 的 `customModels`（持久化到既有 provider store），并在引擎级 catalog store 中带上 `providerProfileId`。
  - 选 **本地配置** → 仅写入引擎级 localStorage 自定义模型列表，且 **不得** 伪绑到某个 managed provider。
- 列表展示：已有模型应可见其归属供应商（名称或 badge）；编辑时回填当前归属；允许改绑到另一供应商（从旧 provider 移除、写入新 provider）。
- **Claude 与 Codex 同一处理方式**：
  - Codex：复用已有 `CodexProviderConfig.customModels` + `mergeCodexProviderCustomModelsIntoStore` 链路，补齐「从模型管理弹窗写回 provider」的缺口。
  - Claude：补齐与 Codex 对称的 **provider-owned custom models** 持久化与 catalog merge（当前 Claude `ProviderConfig` / localStorage 仅有引擎级列表，缺少 provider 写回面）。
- 删除模型：从所属 provider 与引擎级 store 同步移除，避免幽灵条目。
- 补充 i18n（zh 为主，en 等现有 locale 同步 key）、组件单测与写盘/merge 回归。

## Capabilities

### New Capabilities

- `vendor-custom-model-provider-binding`：定义 Claude/Codex 自定义模型管理弹窗的供应商绑定 UX、写盘权威、列表归属展示、改绑与删除同步，以及与引擎级 catalog store 的一致性合同。

### Modified Capabilities

- `codex-provider-scoped-session-launch`：补充「模型管理弹窗写入」作为 `customModels` 的一等录入路径（不仅限 provider 编辑对话框）。
- `claude-dynamic-model-discovery`：自定义模型可携带 provider 溯源；provider-owned 与引擎级 custom 合并规则明确。
- `claude-provider-management`：Claude managed provider 支持持久化 `customModels`（或等价 provider-owned 字段），与 Codex 语义对齐。
- `composer-model-selector-config-actions`：从 Composer「添加模型」打开管理弹窗时，应预选当前会话/活跃供应商（若可解析），不得静默落到本地。

## 方案对比与取舍

| 选项 | 描述 | 取舍 |
|------|------|------|
| A. 仅在 localStorage 条目上标 `providerProfileId`，不写回 provider store | 前端改动小 | 供应商行「N 个自定义模型」与 import/export/cc-switch 不同步；Codex 已有 provider `customModels` 双源分裂 |
| B. 只在各 Provider 编辑对话框里加模型，废弃全局管理弹窗 | 单一写入口 | 破坏现有「自定义模型 / 管理模型」入口与 Composer 添加模型路径 |
| **C. 管理弹窗前置供应商选择，写回 provider-owned `customModels` + 同步引擎 catalog（推荐）** | 与现有 Codex merge 方向一致；Claude 补齐对称能力 | 需 Claude 持久化扩展与双向同步，范围可控 |

采用 **C**。

## 验收标准

1. **Codex 添加**：在模型管理中选择三方供应商 A，填写 model id/label 后保存 → A 的 `customModels` 含该模型；供应商列表显示计数增加；引擎 catalog 条目带 `providerProfileId=A`。
2. **Claude 添加**：同上对称行为（选择 Claude 三方供应商 B 后写回 B 的 provider-owned 模型集合，catalog 可溯源）。
3. **本地配置**：显式选择「本地配置」保存的模型 **不** 写入任何 managed provider 的 `customModels`。
4. **编辑改绑**：将模型从供应商 A 改到 B → A 移除、B 写入；catalog 溯源更新；无重复 id 幽灵。
5. **删除**：删除归属 A 的模型 → A 与引擎 store 均移除。
6. **列表归属可见**：管理列表中每个模型可识别所属供应商（含本地）。
7. **Composer 入口**：在已绑定 managed provider 的会话中点「添加模型」，打开弹窗时供应商默认预选该 provider（可改）。
8. **回归**：既有无 `providerProfileId` 的历史 custom models 仍可选、可编辑；不因本 change 被静默删除。
9. 相关 vitest（Dialog / Host / provider merge / Claude normalize）通过；实现后不自动 commit。

## Impact

- **Frontend**
  - `src/features/vendors/components/CustomModelDialog.tsx`（+ tests）
  - `src/features/vendors/components/VendorModelManagerDialogHost.tsx`（+ tests）
  - `src/features/vendors/components/VendorSettingsPanel.tsx`（模型管理入口数据：providers 列表注入）
  - `src/features/vendors/hooks/usePluginModels.ts` / `useCodexProviderManagement.ts` / `useProviderManagement.ts`
  - Claude custom model normalize / catalog merge（`src/features/models/claudeCustomModels.ts` 等）
  - i18n：`settings.vendor.modelManager.*`
- **Backend / persistence**
  - Codex：优先复用现有 `CodexProviderConfig.customModels` 读写（Tauri `vendor_update_codex_provider` 等）
  - Claude：扩展 provider 持久化以支持 provider-owned custom models（对齐 Codex 字段语义；落点在 vendors store + 类型）
- **Specs / tests**
  - 本 change 新 capability + 上述 modified capability deltas
  - Dialog 交互与写盘 merge 单测
- **Dependencies**：无新增运行时依赖
- **风险**
  - 双写（provider store + localStorage catalog）必须单路径编排，避免只写一半
  - Claude 新字段需向后兼容旧 provider JSON（缺省 `[]` / omit）
