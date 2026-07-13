## 1. Backend Plugin Domain

- [x] 1.1 [P0][depends:none][I: plugin.json 契约][O: `plugins.rs` 含 manifest 解析/扫描/安装/卸载与 skill symlink 激活][V: cargo test] Implement plugins command domain.
- [x] 1.2 [P0][depends:1.1][I: 新命令][O: `app_paths.rs` plugins_dir、`lib.rs` mod、`command_registry.rs` 注册][V: cargo check] Register plugin commands.

## 2. Frontend Services & Plugins Page

- [x] 2.1 [P0][depends:1.2][I: Rust 结构体][O: `services/tauri/plugins.ts` + `features/plugins/types.ts` camelCase 对齐][V: tsc] Add invoke wrappers and types.
- [x] 2.2 [P0][depends:2.1][I: AppMode 链路 13 处清单][O: `AppMode "plugins"` + PluginsView 全屏页 + 侧栏按钮激活][V: focused Vitest + 手动导航] Wire plugins page.
- [x] 2.3 [P1][depends:2.2][I: 官方 catalog + 已安装列表][O: 安装/卸载交互、URL/本地路径安装框][V: 手动安装 gzh-design] Build management UI.

## 3. Composer Entry

- [x] 3.1 [P1][depends:2.1][I: ButtonArea 选择器范式][O: PluginsSelect（已安装列表、点选 skill、管理入口）][V: focused Vitest] Add composer plugin button.

## 4. HTML Preview Chain

- [x] 4.1 [P0][depends:2.1][I: PanelTabId 7 处联合类型清单][O: `pluginPreview` 隐藏模式 + htmlPreviewPath 状态 + 打开 action][V: tsc] Extend panel mode.
- [x] 4.2 [P0][depends:4.1][I: readWorkspaceFilePreview][O: HtmlPreviewPanel（sandboxed iframe + 复制）][V: focused Vitest] Build preview panel.
- [x] 4.3 [P0][depends:4.1][I: viewer filePattern 匹配][O: TurnFilesChangedCard 预览按钮 + 链路透传][V: focused Vitest] Add message-side entry.

## 5. Glossary Capability（第二插件：技术名词解释）

- [x] 5.1 [P0][depends:1.1][I: glossary capability 契约][O: `plugins.rs` glossary 校验 + `plugin_read_glossary` 命令（1MB 上限）+ 注册][V: cargo test] Add glossary capability backend.
- [x] 5.2 [P0][depends:5.1][I: 词库 JSON 契约][O: `glossary.ts` 纯逻辑（解析/匹配器编译/rehype 高亮）+ `glossaryStore.ts` 事件驱动 store][V: focused Vitest] Build glossary matcher pipeline.
- [x] 5.3 [P0][depends:5.2][I: FullMarkdownRuntime rehype 链][O: glossaryPlugin 注入（sanitize 之后）+ GlossaryTermChip（Popover 解释卡）+ Markdown 组件 override][V: Markdown.glossary 集成测试] Wire message rendering.
- [x] 5.4 [P1][depends:5.3][I: 官方目录范式][O: `plugins-demos/tech-glossary` 插件包（113 词条）+ officialPlugins 条目 + i18n + glossary badge][V: 手动安装] Ship tech-glossary plugin.
- [x] 5.5 [P1][depends:5.2][I: MDN translated-content zh-cn glossary（CC-BY-SA）][O: `plugins-demos/tech-glossary-mdn`（580 词条 + convert-mdn-glossary.mjs 转换脚本 + CC-BY-SA 署名）+ matcher 从 alternation 正则改为首字符预筛查表扫描（50 字样例 1.85ms→22µs）+ 多词库先到先得单测][V: focused Vitest + 真实双词库基准] Ship MDN glossary plugin & scale matcher.

## 6. Verification

- [x] 6.1 [P0][depends:all][I: 实现][O: focused Vitest、cargo test、tsc、lint 全绿][V: commands exit 0] Run quality gates.
