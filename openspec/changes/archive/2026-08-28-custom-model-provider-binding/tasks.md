## 1. Types & pure binding helpers

- [x] 1.1 扩展 `ProviderConfig.customModels`（TS）与 Rust `ProviderConfig.custom_models`，打通 `value_to_claude_provider` / `claude_provider_to_value`
- [x] 1.2 新增 `src/features/vendors/customModelProviderBinding.ts`：local sentinel、按 provider 分组、provider store strip、diff patch
- [x] 1.3 单元测试覆盖 grouping / rebind / local-only 不进 managed

## 2. Dialog UX

- [x] 2.1 `CustomModelDialog` 添加/编辑表单前置供应商 select；列表展示归属
- [x] 2.2 save/delete 在模型上写入/清除 `providerProfileId`
- [x] 2.3 i18n（zh + en 至少）modelManager.provider / localProvider 等 key
- [x] 2.4 更新 `CustomModelDialog.test.tsx`

## 3. Host / Settings 写回

- [x] 3.1 `VendorModelManagerDialogHost` 加载 Claude/Codex providers，注入 options，默认活跃或 request 预选
- [x] 3.2 保存时 localStorage + `update*Provider` 双写；改绑/删除同步
- [x] 3.3 `VendorSettingsPanel` 共用同一写回逻辑
- [x] 3.4 Claude `mergeClaudeProviderCustomModelsIntoStore`；load 时 merge
- [x] 3.5 `modelManagerRequest` 支持 `preferredProviderProfileId`
- [x] 3.6 Host / binding 回归测试

## 4. Gate

- [x] 4.1 `openspec validate custom-model-provider-binding --strict --no-interactive`
- [x] 4.2 相关 vitest 通过
- [x] 4.3 typecheck 无新增错误（触及文件）— cargo check 通过；vitest 24/24
