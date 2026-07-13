# Journal - chenxiangning (Part 25)

> Continuation from `journal-24.md` (archived at ~2000 lines)
> Started: 2026-07-10

---



## Session 970: 添加 Codex 5.6 系列模型

**Date**: 2026-07-10
**Task**: 添加 Codex 5.6 系列模型
**Branch**: `ui-refactoring`

### Summary

将 gpt-5.6-sol、gpt-5.6-terra、gpt-5.6-luna 加入 Codex 内置模型下拉，并同步中英文 i18n 映射与模型列表测试。

### Main Changes

| Area | Change |
|------|--------|
| Codex catalog | Added `gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna` ahead of `gpt-5.5` in `src/features/models/codexModelCatalog.ts`. |
| Composer model selector | Added label and description i18n key mappings in `src/features/composer/components/ChatInputBox/selectors/ModelSelect.tsx`. |
| i18n | Added English and Chinese model labels/descriptions in `src/i18n/locales/en.models.ts` and `src/i18n/locales/zh.models.ts`. |
| Tests | Updated `src/features/composer/components/ChatInputBox/types.test.ts` to lock the new built-in model order. |

### Verification

- `git diff --check`
- `node node_modules/vitest/vitest.mjs run --maxWorkers 1 --minWorkers 1 src/features/composer/components/ChatInputBox/types.test.ts`
- `npm run typecheck`
- `npm run lint`


### Git Commits

| Hash | Message |
|------|---------|
| `94de14e6` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 971: Git 可编辑双栏差异预览

**Date**: 2026-07-10
**Task**: Git 可编辑双栏差异预览
**Branch**: `feature/v-0.7.0`

### Summary

完成 IDEA-style workspace diff 双栏直接编辑，保留原 Toolbar 与只读 fallback；修复 dirty/save/cache refresh 竞态、未保存关闭保护和 Git 冷启动样式依赖，并通过 focused tests、lint、typecheck、build 与 OpenSpec strict validation。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `942776b3` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 972: 优化中央便签工作台交互

**Date**: 2026-07-11
**Task**: 优化中央便签工作台交互
**Branch**: `feature/v-0.7.1`

### Summary

完成便签 Master-Detail 工作台、草稿保护、显式保存状态、归档撤销、Composer 引用与分栏比例持久化；补齐中英文文案、可访问交互和目标测试，同步主规范并归档两次便签 OpenSpec change。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `c8eb17ba` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 973: 校准 OpenSpec 提案并归档完成变更

**Date**: 2026-07-11
**Task**: 校准 OpenSpec 提案并归档完成变更
**Branch**: `feature/v-0.7.1`

### Summary

(Add summary)

### Main Changes

## 工作摘要

- 按 `tasks=100% + strict validation` 口径归档 18 个已完成 OpenSpec changes，并同步 delta specs 到主 specs。
- 校准 4 个失效的 delta Requirement 锚点/section，确保 OpenSpec archive 原子同步成功。
- 补充 2 份 design、7 份 verification，并恢复 2 个 sidebar loading change 的 proposal/design/tasks/spec deltas。
- 更新 `openspec/project.md`：active=12、archive=581、main specs=383，明确结构校验不等于实现验证。

## 验证

- `openspec validate --all --strict --no-interactive`: 395 passed, 0 failed。
- OpenSpec consistency check: 执行成功，保留历史 main spec 标题格式警告。
- 提交范围仅为 `openspec/**`，未修改产品代码、配置、脚本或测试。

## 提交

- `1d7e88fc docs(openspec): 校准提案并归档已完成变更`


### Git Commits

| Hash | Message |
|------|---------|
| `1d7e88fc` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 974: 移除 Gemini 和 OpenCode 前端入口

**Date**: 2026-07-11
**Task**: 移除 Gemini 和 OpenCode 前端入口
**Branch**: `feature/v-0.7.1`

### Summary

收敛 MCP 与 Git commit 菜单为 Claude/Codex 双引擎

### Main Changes

目标：在不扩散 backend/shared contract 的前提下，移除 MCP / Skills、Git Diff 和 Git History worktree 三个前端入口中的 Gemini/OpenCode 可见内容。

主要改动：
- McpSection 页面只展示 Claude/Codex，并在页面 boundary 过滤 legacy engine status，删除 OpenCode snapshot side effect。
- GitDiffPanel 与 GitHistoryWorktreePanel 的 commit message engine menu 只保留 Codex/Claude。
- OpenSpec change 记录 5.7-5.9 三个独立 frontend slice。

验证：
- McpSection focused tests 4/4。
- GitDiffPanel focused tests 56/56。
- GitHistoryWorktreePanel focused tests 19/19。
- npm run typecheck、npm run lint、OpenSpec strict validation、git diff --check 通过。
- 完整 npm run test 在未修改的 Sidebar.test.tsx 存在 3 个既有失败，单文件重跑可复现；未纳入本次范围。

边界：未修改 CheckpointCommitDialog、legacy last-config compatibility、shared CommitMessageEngine、services 或 Rust backend。


### Git Commits

| Hash | Message |
|------|---------|
| `be0aa7a2` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 975: 修复 Tooltip 更新回环与会话空白

**Date**: 2026-07-12
**Task**: 修复 Tooltip 更新回环与会话空白
**Branch**: `feature/v-0.7.1`

### Summary

定位生产 React #185 到 sidebar toggle 的 Radix TooltipTrigger/PopperAnchor 链路，恢复 Base UI render element 通过 Radix asChild composition 的兼容契约，并保留 direct TooltipTrigger children，修复左侧 workspace session 空白回归。新增 caller-owned trigger、64 次稳定 rerender、sidebar/topbar host 搬迁与 direct children 回归测试。验证：Tooltip/ThreadList/PinnedThreadList 聚焦测试 41/41，通过 typecheck、lint、OpenSpec strict validation；全量 npm test 在既有 Sidebar.test.tsx 三处 stale assertion 停止（menuitem vs menuitemradio 两处、runtime notice DOM order 一处），未修改该范围。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `a463a259` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 976: 全局搜索结果分层

**Date**: 2026-07-13
**Task**: 全局搜索结果分层
**Branch**: `feature/v-0.7.2`

### Summary

全局搜索结果按内容类型分层展示，文件标题改为 basename，完整路径保留为位置元数据，并完成搜索回归与 OpenSpec 验证。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `2577fd6f` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 977: 根治 Tooltip 启动更新回环

**Date**: 2026-07-13
**Task**: 根治 Tooltip 启动更新回环
**Branch**: `feature/v-0.7.2`

### Summary

将 TooltipIconButton 从 Radix PopperAnchor/SlotClone 状态机迁移到 native button + Floating UI portal，保留原有视觉、定位和交互能力，并完成 Tauri 冷启动人工验收。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `0d2c5cad` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 978: 根治 Sidebar 首次启动会话行更新回环

**Date**: 2026-07-13
**Task**: 根治 Sidebar 首次启动会话行更新回环
**Branch**: `feature/v-0.7.2`

### Summary

将会话行 Tooltip 定位状态改为交互时按需挂载，删除确认改用稳定 virtual anchor；补齐 StrictMode、AppShell、focus 和 Escape 回归测试，并完成新安装包首次启动人工验收。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `db663a44` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 979: 收口 Web 资源分发与首次启动稳定性

**Date**: 2026-07-13
**Task**: 收口 Web 资源分发与首次启动稳定性
**Branch**: `feature/v-0.7.2`

### Summary

(Add summary)

### Main Changes

| 模块 | 完成内容 |
|---|---|
| React 稳定性 | 将 radix-ui 内的 @radix-ui/react-presence 固定到 1.1.6，修复生产包首次启动 React #185 崩溃。 |
| Web 资源安装 | 完成 GitHub Release ZIP 下载、SHA-256 校验、本地包选择、原子覆盖安装、状态检测与操作反馈。 |
| Daemon 服务 | 从应用数据目录的 web-assets/current 加载前端资源，并保留失败时的有效已安装版本。 |
| Release | 新增可选 Web 资源产物；Web ZIP 缺失或构建失败不阻断 macOS、Windows、Linux 原有发布。 |

**验证结果**：typecheck、lint、build、174 个 focused frontend tests、20 个 Rust tests、runtime contracts、OpenSpec strict validation、release archive smoke 均通过；完整测试仅保留 3 个与本次 diff 无关的 Sidebar 既有失败。


### Git Commits

| Hash | Message |
|------|---------|
| `1173ae67` | (see git log) |
| `27c501a7` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 980: 补充 v0.7.2 发布记录并延长 Codex 健康检查超时

**Date**: 2026-07-13
**Task**: 补充 v0.7.2 发布记录并延长 Codex 健康检查超时
**Branch**: `feature/v-0.7.2`

### Summary

补充 v0.7.1/v0.7.2 中英文发布日志；将 Codex GUI、workspace core 与 daemon 的 session health probe timeout 从 3 秒统一调整为 15 秒，降低冷启动时正常 runtime 被过早清理的概率。cargo check 与 git diff --check 通过；全仓库 cargo fmt --check 仍受既有未格式化文件影响。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `76c52d81` | (see git log) |
| `cf17256e` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 981: 修复 Messages 自动滚底锚点更新回环

**Date**: 2026-07-13
**Task**: 修复 Messages 自动滚底锚点更新回环
**Branch**: `feature/v-0.7.2`

### Summary

定位并修复 long conversation streaming、virtualized row measurement 与 bottom-follow 共同触发的 active anchor state feedback。near-bottom 时稳定选择 latest user anchor，scroll-away 后保留原 viewport geometry tracking；补充 focused regression test 与 OpenSpec change，相关测试、lint、typecheck、build 和 strict validation 均通过。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `b27891b0` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 982: 修复 Sidebar ScrollArea React 19 ref 回环

**Date**: 2026-07-13
**Task**: 修复 Sidebar ScrollArea React 19 ref 回环
**Branch**: `feature/v-0.7.2`

### Summary

将 radix-ui 内 ScrollArea scoped override 到 1.2.14，补充 React 19 StrictMode ref 连续性回归测试，并完成 OpenSpec、构建与用户实机验证。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `28851873` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 983: 修复 AppShell composer 冷启动状态回环

**Date**: 2026-07-13
**Task**: 修复 AppShell composer 冷启动状态回环
**Branch**: `feature/v-0.7.2`

### Summary

切断 composer selection cache state 对 reload layout effect 的自反馈，保证 pending 到 canonical selection 连续迁移，并移除 React Scan 内部 signal 强写；相关回归、lint、typecheck、build、OpenSpec 与用户实机验证通过。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `0c198dc7` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
