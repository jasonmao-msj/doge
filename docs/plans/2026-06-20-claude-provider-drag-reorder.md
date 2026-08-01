# Claude 供应商列表：拖动排序 + 启用项置顶

> **Lifecycle**：Implemented / Historical Plan。对应 provider order/model fetch change 已归档于 `openspec/changes/archive/2026-06-21-add-claude-provider-management-order-and-model-fetch/`；下文 `feature/v0.5.11` / “待提交”是原始交付窗口。
> **Codex 执行指令**：请严格按本文档实施全部改动（数据模型、后端命令与排序、前端服务层、hook、ProviderList 拖拽 UI、i18n、CSS），不要偏离已确认的设计；完成后按"验证"小节自检。如遇文档与实际代码冲突，以代码现状为准并在 PR 描述中说明。

> 原始状态：已实施（PR #705 已合入当时 `feature/v0.5.11`，待提交）
> 日期：2026-06-20
> 仓库：desktop-cc-gui（Tauri + React + TypeScript）
> 范围：仅 Claude 供应商列表（`ProviderList`），不动 Codex/Gemini

## 背景 / 目标

当前 Claude 供应商列表顺序固定：后端 `vendor_get_claude_providers` 按 `created_at` 升序（`id` 兜底）返回，前端原样渲染，用户无法调整。需求：

1. 允许用户**拖动调整**供应商顺序，并持久化（重启后保留）。
2. **被启用（active）的供应商固定显示在第一位、不可拖动**。
3. 只有切换到其他配置后才能拖动它：启用某个供应商时它置顶；当切换启用别的供应商后，**原来的 active 自动回到它在用户排序中的原始位置**。
4. "Local settings.json" 虚拟项**永远置顶**（在 active 卡片之上），不参与拖拽与排序。

实现要点：新增持久化的 `sortOrder` 字段；**启用/切换不修改 `sortOrder`**（所以"回到原位"是自然结果，只是显示时把 active 临时提到顶部）；拖拽用已安装的 `@hello-pangea/dnd ^18.0.1`，镜像现有 `ProjectsSection` 模式。

## 现状关键事实（探索结论）

- 列表组件：`src/features/vendors/components/ProviderList.tsx`。Local 虚拟项渲染在最前（硬编码），其后 `regularProviders.map()`；active 卡片加 `.active` 类 + "In Use" badge，非 active 显示"Enable"按钮 → `onSwitch(id)`。
- 顺序来源：后端 `src-tauri/src/vendors/commands.rs` 的 `vendor_get_claude_providers`（约 740-765 行）+ `sort_claude_providers_by_created_at`（约 456-463 行）。**无 `order` 字段、无 reorder 命令**。
- 存储：`~/.ccgui/config.json`，`claude.providers` 为 `HashMap<String, Value>`（无序），`claude.current` 存 active 的 id；`isActive` 在读取时由 `current == id` 计算，不落盘。
- DnD：`@hello-pangea/dnd ^18.0.1` 已装。可镜像 `src/features/settings/components/settings-view/sections/ProjectsSection.tsx` + `SettingsView.tsx` 的 `handleDragEnd`（约 1660 行）：`DragDropContext`/`Droppable`/`Draggable` + `GripVertical` 手柄 + splice 重排 + 写 `sortOrder`。

## 改动一：数据模型新增 sortOrder

- Rust：`src-tauri/src/types.rs` 的 `ProviderConfig`（约 1813-1834 行）新增 `pub(crate) sort_order: Option<i64>,`（serde `rename_all = "camelCase"` → `sortOrder`）。随 provider 的 JSON 值存入 config。
- TS：`src/features/vendors/types.ts` 的 `ProviderConfig`（约 52-88 行）新增 `sortOrder?: number;`。
- 确认 `value_to_claude_provider` 与写回逻辑保留该字段（结构体序列化即可；reorder 命令会显式写入）。

## 改动二：后端排序 + 新增 reorder 命令

文件：`src-tauri/src/vendors/commands.rs`

1. 改排序键（现 `sort_claude_providers_by_created_at`）：改为元组 `(sort_order.unwrap_or(i64::MAX), created_at.unwrap_or(0), id)`。
   - 迁移安全：reorder 之前都无 `sortOrder` → 全部回退到 `created_at`，保持现状；reorder 后全部被赋 0..n，按它排。
2. 新增命令：
   ```rust
   #[tauri::command]
   pub(crate) async fn vendor_reorder_claude_providers(
       ordered_ids: Vec<String>,
   ) -> Result<(), String>
   ```
   - 读 config；对 `ordered_ids` 按下标 `i` 把对应 provider 的存储 JSON 写入 `sortOrder = i`（跳过 `LOCAL_SETTINGS_PROVIDER_ID` 与不存在的 id）。
   - 不修改 `claude.current`。
   - 写回 config。
3. 在 `src-tauri/src/command_registry.rs` 的 `// Vendors` 段（约 361-377 行）注册 `crate::vendors::vendor_reorder_claude_providers,`。
4. 加 `#[cfg(test)]` 单测：带/不带 `sortOrder` 的混合排序与迁移回退。

## 改动三：前端服务层

`src/services/tauri/vendors.ts` 追加：
```ts
export async function reorderClaudeProviders(orderedIds: string[]): Promise<void> {
  return invoke("vendor_reorder_claude_providers", { orderedIds });
}
```
在 `src/services/tauri.ts` 的 vendors re-export 段补出口。

## 改动四：hook

`src/features/vendors/hooks/useProviderManagement.ts` 新增 `handleReorderProviders(orderedIds: string[])`：
- 乐观更新：按 `orderedIds` 重排本地 `providers` 状态（保持 local 项在最前）。
- 调 `reorderClaudeProviders(orderedIds)`。
- 成功后保留乐观顺序，**不再立即 `loadProviders()`**：避免 drop 后 loading flag 切换与 provider object identity 整体替换造成可见闪烁。
- 失败时重新 `loadProviders()` 回滚。
- 在 hook 返回值暴露 `handleReorderProviders`。

## 改动五：ProviderList 拖拽 UI

文件：`src/features/vendors/components/ProviderList.tsx`（镜像 `ProjectsSection.tsx` 的 DnD 写法）

1. Props 新增 `onReorder: (orderedIds: string[]) => void;`。
2. 渲染分三段：
   - **Local 项**：保持现状，最顶部，不可拖动（不进 Droppable）。
   - **Active 卡片**：从 `regularProviders` 取出 `isActive` 的那个（若有），渲染为紧随 local 之下的**置顶、不可拖动**卡片（沿用现有标记 + "In Use" badge，**不显示拖拽手柄**）。
   - **其余非 active** `others = regularProviders.filter(p => !p.isActive)`（已按后端 `sortOrder` 顺序）：包进 `<DragDropContext onDragEnd={handleDragEnd}>` → `<Droppable droppableId="vendor-provider-list">` → 每项 `<Draggable key={id} draggableId={id} index={i}>`，左侧加 `GripVertical`（lucide-react）手柄 `{...dragHandleProps}`，`snapshot.isDragging` 时加 `is-dragging` 类。
3. `handleDragEnd(result: DropResult)`：
   - 无 `destination` 或 source==dest → return。
   - 对 `others` splice 重排得 `newOthers`。
   - **重建完整顺序并把 active 放回原位**：取 active 在当前 `regularProviders`（后端顺序）中的下标 `homeIndex`；把 active 重新插入 `newOthers` 的 `homeIndex`（越界放末尾）得 `newFull`；无 active 时 `newFull = newOthers`。
   - `onReorder(newFull.map(p => p.id))`。
   - 说明：active 不可拖、其 `sortOrder` 不被拖动改变，但会随 reorder 命令按 home 下标重新落定，切换离开后回到原位置。
4. 编辑/删除/启用按钮点击不受拖拽影响（手柄独立）。

`VendorSettingsPanel`（约 498-505 行）把 `onReorder={claude.handleReorderProviders}` 传给 `ProviderList`。

## 改动六：i18n

`src/i18n/locales/en.part1.ts` 与 `zh.part1.ts` 的 `settings.vendor` 块新增：
- `dragToReorder`：`Drag to reorder` / `拖动调整顺序`（手柄 title）。

## 改动七：CSS

`src/styles/settings.part1.vendor-panels.css` 增补（镜像 `.settings-group-drag-handle` / `is-dragging`）：
- `.vendor-card-drag-handle`：手柄样式（cursor: grab、对齐、颜色用现有变量）。
- `.vendor-card.is-dragging`：拖拽中视觉反馈（阴影/背景）。

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
4. 手动待验：
   - 拖动非 active 供应商调整顺序 → 重启应用确认持久化。
   - 启用某个非 active 供应商 → 它置顶、无拖拽手柄、不可拖；原 active 回到它在排序中的原始位置。
   - 再切换回原来的 → 两者位置互换符合预期。
   - 确认 "Local settings.json" 始终在最顶部、不可拖。
   - 确认 active 卡片无法被拖动，也无法把别的项拖到它上面（active 不在 Droppable 内）。

## 合并回写 / 实际落地差异

- `ProviderList` 新增 `buildClaudeProviderReorderIds` 纯函数，并用 `ProviderList.test.tsx` 覆盖 active home index 与无 active 两种重排路径。
- `useProviderManagement` 的成功路径按实际代码改为"乐观更新后不 refetch"，这是为解决拖拽后闪烁而做的实现校准；失败路径仍通过 `loadProviders()` 回滚。
- `src/services/tauri.test.ts` 补了 `vendor_reorder_claude_providers` invoke wrapper 映射测试。
- 本次 PR 同时带入一个文件树滚动容器修复：`src/styles/file-tree.css` 为 `.diff-panel.file-tree-panel` 补 `min-height: 0;`，并在 `src/styles/client-typography-font-size.test.ts` 中补断言。该改动来自 PR 标题里的"固定文件滚动"，不是 Claude vendor 排序核心链路。
- Review 后已撤销 PR 对 `AGENTS.md` Shell Baseline 的 Windows-only `pwsh` 回退；最终 staged diff 不再包含 `AGENTS.md`。

## 注意事项

- 启用/切换（`vendor_switch_claude_provider`）绝不可修改 `sortOrder`，否则"回到原位"失效。
- reorder 命令入参是**完整的常规供应商顺序 id 列表**（含 active 在其 home 位置），后端按下标重写 `sortOrder`。
- 仅改 Claude 列表；Codex/Gemini 不动。
