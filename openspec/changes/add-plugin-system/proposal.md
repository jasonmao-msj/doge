# add-plugin-system

## Why

CC GUI 目前的能力边界完全由本体代码决定，无法像 VSCode / Figma 那样通过第三方生态扩展。本次变更引入最小可用的插件系统 v0.1：插件以 GitHub 开源仓库为载体、以 `plugin.json` manifest 自描述能力，应用本体保持通用（不为任何具体插件写死逻辑）。首个官方插件为 `gzh-design`（公众号排版 Skill + HTML 产物预览）。

## 目标与边界

- 插件安装形态：从 GitHub `git clone --depth 1` 或本地目录复制到 `~/.ccgui/plugins/<id>`；卸载即删除目录并清理 skill 链接。
- 能力模型 v1 共三种 capability：
  - `skill`: 插件携带 `SKILL.md`，激活方式为在 `~/.claude/skills/<id>` 创建指向插件目录的 symlink（Windows 回退为目录复制），claude CLI 原生自动发现，GUI 不做 prompt 注入。
  - `viewer`: 声明 `filePattern` + `action: "html-preview"`，AI 产物文件命中 pattern 时，回合文件变更卡上出现预览入口，点击在右侧面板以 sandboxed iframe 渲染并提供复制。
  - `glossary`: 声明词库 JSON 的相对路径 `entry`，安装后消息正文中命中词条的技术名词被标注为可点击入口，点击弹出通俗解释卡片（面向非程序员），代码/链接/公式子树不标注。首个官方插件为 `tech-glossary`。
- 三个 UI 入口：左侧栏「插件」导航（已有禁用按钮，本次激活并接入新 `AppMode "plugins"` 全屏管理页）、composer 工具条插件按钮（列已安装插件，点选即选中其 skill）、消息文件变更卡预览入口。
- 官方插件目录 v1 为前端静态 catalog（仅展示元数据与仓库地址），安装动作始终以插件仓库内的 `plugin.json` 为唯一事实源；仓库缺 manifest 时安装失败并明确报错。

## What Changes

- Backend 新增 `plugins` 命令域：`plugin_list_installed` / `plugin_install` / `plugin_uninstall`，安装含 clone 失败回滚、manifest 校验、skill symlink 激活（带来源校验的安全卸载）。
- `app_paths.rs` 新增 `plugins_dir()`（`~/.ccgui/plugins`）。
- Frontend 新增 `AppMode "plugins"` 全屏插件管理页（官方 catalog + 已安装列表 + 按 GitHub URL/本地路径安装 + 卸载）。
- Composer 工具条新增插件按钮（已安装插件 popover，点选 skill、入口跳插件页）。
- 右侧面板新增 `PanelTabId "pluginPreview"` 隐藏模式 + `HtmlPreviewPanel`（sandboxed iframe + 复制 HTML/富文本），`TurnFilesChangedCard` 文件行命中已安装插件 viewer pattern 时显示预览按钮。
- i18n 中英文文案、插件页与预览面板样式。

## 方案比较与取舍

- Skill 注入：方案 A 把 SKILL.md 内容拼进 `--append-system-prompt`——每会话重复注入、无法利用 skill 的按需加载；方案 B 安装进 `~/.claude/plugins/cache`——该目录归 Claude Code 官方插件系统管辖，寄生有登记不一致风险；方案 C（采用）symlink 进 `~/.claude/skills`——CLI 原生发现、`$` 技能列表自动镜像、卸载可通过 symlink 目标校验安全清理，且仓库已有 `native_skill_mirror.rs` 同构先例。
- HTML 预览：方案 A 扩展 `files` 模式的 `FileViewSurfaceKind`——复用文件树基建但「消息直达渲染视图」仍需额外 action；方案 B（采用）新增一级 `PanelTabId`——入口直达、iframe 沙箱独立可控，代价是联合类型 7 处同步。

## 非目标

- 不做插件更新检查/版本升级（后续迭代）。
- 不做第三方插件提交审核流程与远程 catalog。
- ~~不做第二类界面渲染型插件（技术名词解释）~~（已随本 change 追加实现：`glossary` capability + 官方插件 `tech-glossary`，消息正文名词标注 + 点击弹解释卡）。
- 不改变既有技能（`$`）、curated skills、Claude spawn 链路的任何现有行为。

## Capabilities

### New Capabilities

- `plugin-system`: 约束插件 manifest 契约、安装/卸载生命周期、skill 激活方式与 viewer 预览行为。

### Modified Capabilities

- 无。

## Impact

- Backend: `src-tauri/src/plugins.rs`（新建）、`src-tauri/src/app_paths.rs`、`src-tauri/src/lib.rs`、`src-tauri/src/command_registry.rs`。
- Frontend 服务/类型: `src/services/tauri/plugins.ts`（新建）、`src/services/tauri.ts`、`src/features/plugins/`（新建：types/catalog/hooks/components）。
- AppMode 链路: `src/types/settings.ts`、`src/app-shell.tsx`、`src/app-shell-parts/{useAppShellViewStateSection,useAppShellSectionsTypes,useAppShellSections,renderAppShellTypes,renderAppShell,appShellDomainContexts,lazyViews}`、`src/features/app/components/{Sidebar,AppLayout}.tsx`、`src/features/layout/components/DesktopLayout.tsx`。
- 预览链路: `src/features/layout/components/PanelTabs.tsx`、`src/app-shell-parts/{useAppShellSearchRadarSection,useAppShellSearchAndComposerSection,useAppShellLayoutNodesSection}`、`src/features/layout/hooks/{layoutNodesTypes,useLayoutNodes}`、`src/features/git/hooks/usePullRequestComposer.ts`、`src/features/app/hooks/useGitPanelController.ts`、`src/features/messages/components/{TurnFilesChangedCard,MessagesTimeline}.tsx`、新建 `HtmlPreviewPanel`。
- Composer: `src/features/composer/components/ChatInputBox/ButtonArea.tsx` 及新建 `selectors/PluginsSelect.tsx`。
- i18n: `src/i18n/locales/{zh,en}.part*.ts`；样式: `src/styles/`。

## 验收标准

- 安装：给定含合法 `plugin.json` 的 GitHub 仓库 URL 或本地目录，安装后出现在已安装列表；skill capability 生效（`~/.claude/skills/<id>` 链接存在、`$` 技能列表可见）；缺 manifest 时安装失败且不留残目录。
- 卸载：插件目录删除、skill 链接清理；非本系统创建的同名 skill 目录不被误删。
- 预览：安装 gzh-design 后，AI 产出 `*.gzh.html` 的回合文件卡出现预览按钮，点击右侧面板 iframe 渲染 HTML，复制按钮可复制。
- 侧栏「插件」按钮激活并高亮对应 `AppMode`；未安装任何插件时 composer 插件按钮与文件卡预览按钮不产生额外请求或渲染负担（启动拉取一次、事件驱动刷新，无秒级轮询）。
- focused Vitest、cargo test、TypeScript typecheck、lint 通过。
