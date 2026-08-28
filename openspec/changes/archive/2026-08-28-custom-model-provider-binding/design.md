## Context

- `CustomModelDialog` 仅通过 `usePluginModels` 写引擎级 localStorage（`claude-custom-models` / `codex-custom-models`）。
- Codex managed provider 已有 `customModels` 字段；`mergeCodexProviderCustomModelsIntoStore` 可把 provider 模型 merge 进 catalog，但 **弹窗保存不会写回 provider**。
- Claude `ProviderConfig`（TS/Rust）尚无 `customModels`；自定义模型只有 localStorage。
- 设置页供应商行已展示「N 个自定义模型」，与录入路径脱节。

## Goals / Non-Goals

**Goals:**

- Claude / Codex 对称：管理弹窗添加/编辑时前置供应商选择；写回 provider-owned `customModels` + 引擎 catalog（带 `providerProfileId`）。
- 列表可见归属；支持改绑与删除双向同步。
- 历史无归属模型保留为 local/unscoped。
- Composer「添加模型」打开时优先预选活跃/请求指定的 provider。

**Non-Goals:**

- Gemini 及其他引擎强制落地。
- 改会话 binding / send pipeline / runtime switch。
- 把供应商 CRUD 并入模型管理弹窗。

## Decisions

### D1. 写盘权威

| 归属 | Provider store | 引擎 localStorage catalog |
|------|----------------|---------------------------|
| managed / 三方 | **权威**：`provider.customModels` | 镜像，条目带 `providerProfileId` |
| 本地配置 | 不写 | **权威**：无 `providerProfileId` |

保存编排（单路径）：

1. Dialog 产出完整 `nextModels[]`（每项可含 `providerProfileId`）。
2. `updateModels(nextModels)` 写 localStorage 并派发 `localStorageChange`。
3. 按 provider 重算 `customModels`，仅对 diff 的 provider 调 `update*Provider`。
4. 成功后可选 reload providers / `notifyProviderTargetCatalogChanged`。

### D2. UI 合同

- 添加/编辑表单 **最前** 为供应商 `<select>`。
- 选项：`本地配置`（sentinel id 空串 `""`）+ 当前引擎非 local managed providers。
- 列表行展示归属名称；编辑回填；改绑 = 旧 provider 移除 + 新 provider 写入。
- Props：`providerOptions`、`defaultProviderProfileId`、`providerNameById`。

### D3. Claude 对称

- TS `ProviderConfig.customModels?: CodexCustomModel[]`（结构复用 id/label/description）。
- Rust `ProviderConfig.custom_models` + `value_to_claude_provider` / `claude_provider_to_value` 读写。
- Claude 校验保持 shape-only；Codex 保持 model-id 校验。
- 新增 `mergeClaudeProviderCustomModelsIntoStore`（镜像 Codex merge）。

### D4. Composer 预选

- `VendorModelManagerRequest.preferredProviderProfileId?: string`。
- Host：`request.preferred…` → 否则 `isActive` managed → 否则本地。
- 第一期不强制改 `onOpenModelSettings` 宽签名；Host 用活跃供应商即可满足「不静默落到本地」。

### D5. 模块边界

- 纯函数：`src/features/vendors/customModelProviderBinding.ts`（分组、diff、strip）。
- Host + Settings 共用写回 helper，避免双份编排。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 双写只成功一半 | 先 localStorage 再 provider；provider 失败 surface error，可重试；测试覆盖 diff |
| Claude 旧 JSON 无字段 | `Option` / omit；缺省视为 `[]` |
| Claude id 含空格 vs Codex 校验 | 引擎分支校验；provider 读写 Claude 用 shape-only |
| 历史无归属模型 | 不自动迁移；展示为本地 |

## Migration Plan

1. 部署后无强制 migration。
2. 用户编辑并保存时才写入 `providerProfileId` / provider store。
3. Rollback：回退前端；Claude `customModels` 字段可残留无害。

## Open Questions

- 无阻塞项；Gemini 对称留后续 change。

## Hardening (post-review)

1. **Dialog**：`wasOpenRef` 仅 open edge 初始化；`providerOptions` 异步到达只 soft-update 供应商默认，**禁止**清空已输入 id/label；用户手改 select 后不再覆盖。
2. **Persist**：per-engine 串行 queue，防止并发 full-replace 丢模型；失败 throw + UI `persistError`。
3. **Claude catalog**：`providerProfileId` 仅可选透传，缺省不发明。
4. **Shared / Native 选取权威不回退**：
   - `useAppShellComposerModelSection` 对 Claude 的 `resolvedProviderProfileId` **仍固定 null**（只 Codex 从 model 取 ownership）。
   - 打开会话 / Shared hydrate 仍以 thread / `selectedNextTarget` 为权威，不因 custom model 元数据反推改绑。
   - 历史无归属模型保持 unbound 可选。
