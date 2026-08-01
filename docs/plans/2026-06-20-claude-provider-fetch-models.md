# Claude 供应商对话框：拉取模型列表（/v1/models）

> **Lifecycle**：Implemented / Historical Plan。对应 provider order/model fetch change 已归档于 `openspec/changes/archive/2026-06-21-add-claude-provider-management-order-and-model-fetch/`；下文 `feature/v0.5.11` / “待提交”是原始交付窗口。
> **Codex 执行指令**：请严格按本文档实施全部改动（后端命令、前端服务层、对话框 UI、i18n、CSS 五部分），不要偏离已确认的设计选择；完成后按"验证"小节自检（`cargo check` + `cargo test` + 前端构建 + 手动跑通拉取与同步）。如遇文档与实际代码冲突，先以代码现状为准并在 PR 描述中说明。

> 原始状态：已实施（PR #705 已合入当时 `feature/v0.5.11`，待提交）
> 日期：2026-06-20
> 仓库：desktop-cc-gui（Tauri + React + TypeScript）

## 背景 / 目标

新建/编辑 Claude 供应商时，Haiku/Sonnet/Opus 三个"模型映射"字段目前是纯文本输入，用户必须手动键入中转站支持的模型名，易写错。绝大多数 OpenAI 兼容中转站都暴露 `/v1/models`。

本需求：在三个映射字段上方加一个"拉取模型"按钮，用当前填写的 API URL + API Key 请求 `/v1/models`，把返回的模型名作为**下拉建议**挂到三个输入框上（仍可手填）。

请求**必须走 Rust 后端**（避免 webview CORS，自动复用已配置代理）。`reqwest 0.12` 已是依赖（`src-tauri/Cargo.toml`），但目前仓库没有任何向供应商 HTTP 端点发请求的代码——这会是第一处。

## 已确认的设计选择

- **展示方式**：三个输入框共享一个 `<datalist>` 下拉建议（原生 combobox，可选可手填，改动最小）。
- **接口地址**：从当前 API URL（`ANTHROPIC_BASE_URL`）自动推导，依次尝试几种常见候选路径，取第一个成功的。不新增独立地址输入框。
- **鉴权**：同时发送 `Authorization: Bearer <key>` 和 `x-api-key: <key>`，兼容 OpenAI 风格中转与 Anthropic 风格端点。

## 改动一：后端命令

文件：`src-tauri/src/vendors/commands.rs`

1. 纯函数 `fn derive_model_list_candidates(base_url: &str) -> Vec<String>`：
   - trim、去掉尾部 `/`。
   - 候选（去重、保序）：
     1. `{base}/v1/models`
     2. 若 base 以 `/v1` 结尾 → `{base}/models`
     3. 若 base 以 `/anthropic` 结尾 → 去掉该后缀后 `{stripped}/v1/models`
     4. 仅 origin（`scheme://host[:port]`）+ `/v1/models`
   - 加 `#[cfg(test)]` 单测覆盖：纯域名、带 `/v1`、带 `/anthropic`、带尾斜杠等形态。
2. 返回类型：
   ```rust
   #[derive(Debug, Serialize)]
   pub(crate) struct VendorModelListResult {
       models: Vec<String>,
       endpoint: String, // 实际命中的 URL
   }
   ```
3. 命令：
   ```rust
   #[tauri::command]
   pub(crate) async fn vendor_fetch_claude_models(
       base_url: String,
       api_key: String,
   ) -> Result<VendorModelListResult, String>
   ```
   - `base_url` 为空 → 返回 `Err`（前端转成"请先填写 API URL"）。
   - 构建 `reqwest::Client`（连接超时 ~10s、总超时 ~15s），写法参考 `src-tauri/src/dictation/real.rs:485`。
   - 遍历候选 URL：GET，带 `Authorization: Bearer <key>` 与 `x-api-key: <key>` 两个头；首个返回 2xx 且 JSON 可解析者胜出，记录 `endpoint`。
   - 解析顺序：优先 `{ "data": [ { "id": "..." } ] }`（OpenAI/Anthropic 同形）→ 回退顶层数组 → 回退 `{ "models": [...] }`；抽取 `id`/字符串，去空、去重、保序。
   - 全部候选失败 → `Err`，带上最后一次的 HTTP 状态码或错误信息，便于前端展示。
4. 注册：在 `src-tauri/src/command_registry.rs` 的 `// Vendors` 段（约 361-377 行）加入 `crate::vendors::vendor_fetch_claude_models,`。

## 改动二：前端服务层

文件：`src/services/tauri/vendors.ts`（末尾追加，镜像现有 `getGeminiVendorPreflight`）：
```ts
export interface VendorModelListResult {
  models: string[];
  endpoint: string;
}

export async function fetchClaudeProviderModels(
  baseUrl: string,
  apiKey: string,
): Promise<VendorModelListResult> {
  return invoke<VendorModelListResult>("vendor_fetch_claude_models", {
    baseUrl,
    apiKey,
  });
}
```
在 `src/services/tauri.ts` 的 vendors re-export 段（约 262-280 行）补出口。

## 改动三：对话框 UI

文件：`src/features/vendors/components/ProviderDialog.tsx`

1. 新增 state：`fetchedModels: string[]`、`isFetchingModels: boolean`、`modelFetchError: string`。
   - 在打开对话框的 `useEffect`（约 159-191 行）与 `handlePresetClick`（约 130-158 行）中重置这三个值。
2. 新增 `handleFetchModels`：
   - 无 `apiUrl` → 设 `modelFetchError = t("...fetchModelsNeedUrl")` 并返回。
   - 置 `isFetchingModels=true`、清错误 → 调 `fetchClaudeProviderModels(apiUrl, apiKey)`。
   - 成功：`setFetchedModels(result.models)`；列表为空时给 `fetchModelsEmpty` 提示。
   - 失败：`setModelFetchError(message)`。
   - `finally` 关 loading。
3. JSX 插入点：在"模型映射"分组内，label（约 372 行）与 `<div className="vendor-model-grid">`（约 373 行）之间插入工具条一行：
   - 拉取按钮：loading 时禁用并显示"拉取中…"，`!apiUrl` 时禁用。
   - 成功后显示已加载数量提示 / 失败显示错误文案。
4. 在该分组内渲染一个共享 `<datalist id="vendor-fetched-models">`，选项来自 `fetchedModels.map(m => <option value={m} />)`；给三个模型 `<input>`（约行 376/392/408）各加 `list="vendor-fetched-models"`。
   - 选择/输入仍走原有 `setXxxModel(...)` + `updateEnvField(envKey, value)`（95-118 行），与 JSON 配置区双向同步逻辑保持不变。

## 改动三点五：默认 Claude provider settings template 校准

实际落地时，`ProviderDialog.tsx` 还同步修正了新增供应商的默认 `settings.json` 模板：

- 新增 `buildDefaultClaudeProviderSettingsConfig()`，将默认配置从仅 `env` 的窄模板提升为完整 Claude Code provider settings template。
- 顶层字段包括：`alwaysThinkingEnabled`、`autoDreamEnabled`、`cleanupPeriodDays`、`effortLevel`、`hasCompletedOnboarding`、`language`、`model`、`skipAutoPermissionPrompt`、`teammateMode`、`tui`。
- `env` 内按 tier 写入默认模型：
  - `ANTHROPIC_DEFAULT_HAIKU_MODEL`
  - `ANTHROPIC_SMALL_FAST_MODEL`
  - `ANTHROPIC_DEFAULT_SONNET_MODEL`
  - `ANTHROPIC_DEFAULT_OPUS_MODEL`
- 移除了会造成回归的 unsafe env defaults：
  - `CLAUDE_CODE_ATTRIBUTION_HEADER`
  - `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`
- `src-tauri/src/vendors/commands.rs` 的 `PROVIDER_MANAGED_FIELDS` 同步扩展，使这些顶层字段能正确写入 provider settings，而不是被错误塞进 `env`。
- `ProviderDialog.test.ts` 覆盖默认模板，避免后续再把顶层 settings 误退回 `env`。

## 改动四：i18n

在 `src/i18n/locales/en.part1.ts` 与 `src/i18n/locales/zh.part1.ts` 的 `settings.vendor.dialog` 块内新增键：

| key | en | zh |
|---|---|---|
| `fetchModels` | `Fetch models` | `拉取模型` |
| `fetchModelsLoading` | `Fetching…` | `拉取中…` |
| `fetchModelsCount` | `{{count}} models loaded` | `已加载 {{count}} 个模型` |
| `fetchModelsEmpty` | `No models returned` | `未返回模型` |
| `fetchModelsNeedUrl` | `Enter API URL first` | `请先填写 API URL` |
| `fetchModelsError` | `Failed to fetch models` | `拉取模型失败` |

（`{{count}}` 用 i18next 插值；`fetchModelsError` 为通用兜底，后端会带具体原因。）

## 改动五：CSS

文件：`src/styles/settings.vendor-dialog.css` 增补：
- `.vendor-model-fetch`：flex 行、`gap`、`align-items: center`、下边距。
- `.vendor-model-fetch-error`：小号红字（用现有 `--` 颜色变量）。
其余复用现有 `vendor-` 类。

## 验证

1. 已跑 `npm run typecheck`。
2. 已跑目标前端测试：
   ```bash
   npm exec -- vitest run \
     src/features/vendors/components/ProviderDialog.test.ts \
     src/features/vendors/components/ProviderDialog.fetch-models.test.tsx \
     src/features/vendors/components/ProviderList.test.tsx \
     src/features/vendors/hooks/useProviderManagement.test.tsx \
     src/services/tauri.test.ts
   ```
   结果：5 个 test files / 124 tests passed。
3. 已跑 Rust 目标测试：
   ```bash
   cargo test --manifest-path src-tauri/Cargo.toml vendors::commands::tests:: --quiet
   ```
   结果：12 passed。
4. 手动待验：启动应用 → 添加 Claude 供应商 → 填入真实中转站 base URL + key → 点"拉取模型" → 确认三个输入框出现下拉建议；选一个 → 确认 JSON 配置区对应 env 同步更新；再用错误 URL/Key 验证错误提示。

## 合并回写 / 实际落地差异

- `derive_model_list_candidates("https://api.example.com/v1")` 当前会先尝试 `https://api.example.com/v1/v1/models`，再尝试 `https://api.example.com/v1/models`；该行为已由 Rust 单测锁定，属于宽容式候选路径策略。
- `vendor_fetch_claude_models` 返回 `endpoint`，目前 UI 只展示模型数量/错误，不展示命中的 endpoint。
- `src/services/tauri.test.ts` 补了 `vendor_fetch_claude_models` invoke wrapper 映射测试。
- Review 后已撤销 PR 对 `AGENTS.md` Shell Baseline 的 Windows-only `pwsh` 回退；最终 staged diff 不再包含 `AGENTS.md`。

## 注意事项

- 不要在前端用 `fetch()` 直连供应商（CORS + 代理问题）；一律经 Rust 命令。
- `vendor_fetch_claude_models` 用对话框当前**未保存**的 `apiUrl`/`apiKey` 值即可，无需先保存供应商。
- 鉴权头两种都带是有意为之，便于兼容；不要改成只发一种。
