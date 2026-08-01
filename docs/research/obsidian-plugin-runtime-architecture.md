# Obsidian 插件运行时架构与 API 面 —— 竞品调研报告

> **Lifecycle**：External Research Snapshot。不是 mossx runtime contract，也不代表 Obsidian 私有实现。
> **最后复核**：2026-08-01；公开 API 与官方 Developer docs 仍是事实源，进入产品设计前须重新检查 API revision、manifest schema 与安全政策。
> 调研日期：2026-07-24。调研方式：抓取 obsidianmd/obsidian-api 的 `obsidian.d.ts`（master 分支，8498 行）逐段精读 + obsidianmd/obsidian-sample-plugin 仓库源码 + docs.obsidian.md 官方 Developer docs。
> 一手来源：
> - API 类型定义（含 TSDoc）：https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts
> - Sample plugin：https://github.com/obsidianmd/obsidian-sample-plugin
> - Build a plugin（官方教程）：https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin
> - Anatomy of a plugin：https://docs.obsidian.md/Plugins/Getting+started/Anatomy+of+a+plugin
> - Manifest schema 参考：https://docs.obsidian.md/Reference/Manifest
> - Editor extensions（CodeMirror 6）：https://docs.obsidian.md/Plugins/Editor/Editor+extensions
> - Custom views：https://docs.obsidian.md/Plugins/User+interface/Views
> - Markdown post processing：https://docs.obsidian.md/Plugins/Editor/Markdown+post+processing

---

## ① 插件物理格式

一个 Obsidian community plugin 在磁盘上就是一个文件夹，放在 vault 的 `<vault>/.obsidian/plugins/<plugin-id>/` 下（来源：sample plugin README「Manually installing the plugin」与 Build a plugin 教程 Step 1）。文件夹内由 2 个必需文件 + 2 个约定文件组成：

| 文件 | 必需 | 说明 |
|---|---|---|
| `manifest.json` | ✅ | 插件元数据（见下表字段全解） |
| `main.js` | ✅ | 编译产物（单 bundle，esbuild 从 TypeScript 打包）。Obsidian 直接 `require`/加载它，default export 必须是继承 `Plugin` 的类 |
| `styles.css` | 可选 | 插件样式，存在时自动加载、随插件卸载 |
| `data.json` | 运行时生成 | `loadData()`/`saveData()` 的持久化落点，存在插件文件夹内（obsidian.d.ts `Plugin.loadData` TSDoc：「Data is stored in `data.json` in the plugin folder」） |

`manifest.json` 字段全解（来源：官方 Manifest schema 参考 + sample manifest 实测）：

| 字段 | 类型 | 必需 | 说明 |
|---|---|---|---|
| `id` | string | ✅ | 插件 ID。**只能含小写字母和连字符；不能以 `plugin` 结尾；不能含 `obsidian`**。本地开发时 id 应与文件夹名一致，否则 `onExternalSettingsChange` 等不会触发 |
| `name` | ✅ | ✅ | 展示名。官方规范：Basic Latin、禁 emoji/特殊字符、不能含「Obsidian」「Plugin」字样、不能与 core plugin 重名 |
| `version` | string | ✅ | SemVer `x.y.z` |
| `minAppVersion` | string | ✅ | 能运行本插件的最低 Obsidian 版本。配合发布时的 `versions.json`（`"插件版本": "最低app版本"`）让旧版 app 下载兼容的旧插件版本 |
| `description` | string | ✅ | 插件描述 |
| `author` | string | ✅ | 作者名 |
| `authorUrl` | string | 可选 | 作者主页 |
| `fundingUrl` | string \| object | 可选 | 赞助链接；单 URL 字符串或 `{名称: URL}` 对象 |
| `isDesktopOnly` | boolean | ✅ | 是否依赖 NodeJS/Electron API（true 则不上移动端） |

注意：`obsidian.d.ts` 里的 `PluginManifest` 接口还含 `dir?: string`（vault 内插件目录路径，运行时注入），且**未包含** `fundingUrl` —— 类型定义略滞后于 manifest schema 文档，以文档为准。

sample plugin 的 manifest 实测（master）：

```json
{
  "id": "sample-plugin", "name": "Sample Plugin", "version": "1.0.0",
  "minAppVersion": "1.0.0",
  "description": "Demonstrates some of the capabilities of the Obsidian API.",
  "author": "Obsidian", "authorUrl": "https://obsidian.md",
  "fundingUrl": "https://obsidian.md/pricing", "isDesktopOnly": false
}
```

**关键设计结论**：Obsidian 插件 = `manifest.json` + 单个 JS bundle + 可选 CSS，**无 sandbox、无权限声明清单**。`isDesktopOnly` 只是一个「是否上移动端」标记，不是安全边界。

---

## ② Plugin 基类生命周期与注册面

`Plugin` 是 abstract class，继承 `Component`（obsidian.d.ts L4901）。插件入口：`export default class X extends Plugin`，构造签名 `constructor(app: App, manifest: PluginManifest)`，实例上有 `this.app` 和 `this.manifest`。

### 生命周期（来源：Anatomy of a plugin + obsidian.d.ts）

| 方法 | 时机 |
|---|---|
| `onload()` | 插件启用时被调用（可 async）。绝大多数注册在这里完成 |
| `onunload()` | 插件被禁用时调用，释放资源 |
| `onUserEnable()` | @since 1.7.2。用户**明确交互**后调用（配合 deferred views），自定义 view 建议在这里打开 |
| `onExternalSettingsChange?()` | @since 1.5.7。`data.json` 被外部（如同步服务）修改时触发，用于重新加载设置 |

继承自 `Component` 的自动清理机制（这是 Obsidian 生命周期的核心设计 —— 注册即绑定生命周期，卸载自动回收）：

- `register(cb)`：注册卸载回调
- `registerEvent(eventRef)`：卸载时自动 detach 事件
- `registerDomEvent(el, type, cb)`：卸载时自动移除 DOM listener
- `registerInterval(id)`：卸载时自动 clearInterval
- `addChild(component)` / `removeChild(component)`：子组件随父级 load/unload

### 注册面全量清单（`Plugin` 类全部 public 方法，逐一核对 obsidian.d.ts）

| 方法 | 作用 | @since |
|---|---|---|
| `addCommand(command: Command)` | 注册命令到 Command Palette，id/name 自动加插件前缀。Command 支持 `callback`（全局）、`editorCallback`（需编辑器上下文）、`checkCallback`（条件可见）、`editorCheckCallback`、hotkeys | 0.9.7 |
| `removeCommand(commandId)` | 手动移除命令（仅动态注册场景需要） | 1.7.2 |
| `addRibbonIcon(icon, title, callback)` | 左侧 ribbon 加图标，返回 HTMLElement | 0.9.7 |
| `addStatusBarItem()` | 底部 status bar 加一项，返回 HTMLElement；移动端不可用 | 0.9.7 |
| `addSettingTab(tab: PluginSettingTab)` | 注册设置页（Settings → 插件区域） | 0.9.7 |
| `registerView(type, viewCreator)` | 注册自定义 View，第二参数是工厂函数 `(leaf) => View` | 0.9.7 |
| `registerExtensions(extensions: string[], viewType)` | 把特定文件扩展名绑定到某个 viewType（如 `.canvas` → 自定义视图） | 0.9.7 |
| `registerMarkdownPostProcessor(pp, sortOrder?)` | 注册 Reading view 的 markdown post processor | 0.9.7 |
| `registerMarkdownCodeBlockProcessor(language, handler, sortOrder?)` | 按语言处理 fenced code block（如 ```mermaid） | 0.9.7 |
| `registerEditorExtension(extension: Extension)` | 注册 CodeMirror 6 extension（CM6 `Extension` 或数组）；动态改数组后调 `workspace.updateOptions()` 生效 | 0.12.8 |
| `registerEditorSuggest(suggest: EditorSuggest)` | 输入时实时建议（如 @ 提及） | 0.12.7 |
| `registerHoverLinkSource(id, info)` | 向 Page preview core plugin 注册 hover-link 事件源 | 1.1.0 |
| `registerObsidianProtocolHandler(action, handler)` | 处理 `obsidian://<action>?k=v` URL | 0.11.0 |
| `registerBasesView(viewId, registration)` | @since 1.10.0，为 Bases（数据库视图）注册自定义视图；Bases 未启用时返回 false | 1.10.0 |
| `registerCliHandler(command, desc, flags, handler)` | @since 1.12.2，注册 CLI 命令处理器，格式 `<plugin-id>` 或 `<plugin-id>:<action>` | 1.12.2 |
| `loadData()` / `saveData(data)` | 读写插件文件夹下 `data.json` | 0.9.7 |

---

## ③ UI 挂载点全景

| 挂载点 | API | 说明 |
|---|---|---|
| Ribbon（左侧栏图标） | `addRibbonIcon()` | 全局快捷入口 |
| Status bar（底部） | `addStatusBarItem()` | desktop only，返回裸 HTMLElement 自行渲染 |
| Sidebar view（左右侧栏） | `registerView()` + `ItemView`；`workspace.getLeftLeaf(split)` / `getRightLeaf(split)` / `ensureSideLeaf()` 挂载 | 自定义 `ItemView` 子类实现 `getViewType()/getDisplayText()/onOpen()/onClose()`，渲染进 `this.contentEl` |
| 主编辑区 workspace leaf | 同 `registerView()`，通过 `workspace.getLeaf('tab'/'split'/'window')` + `leaf.setViewState({type})` 打开 | Workspace 树形结构：`rootSplit` / `leftSplit` / `rightSplit` / `leftRibbon`，leaf 是叶子容器 |
| Modals | 继承 `Modal`（`open()/close()/onOpen()/onClose()`，`this.contentEl`）；`ConfirmationModal`（1.13.0）；`FuzzySuggestModal`/`SuggestModal` | 完全自定义 DOM |
| Settings 页 | `PluginSettingTab` 子类 + `addSettingTab()`；`Setting` 流式 API（addText/addToggle/addDropdown/addButton/addSlider/…） | |
| 编辑器内部（Live Preview） | `registerEditorExtension()` 注入 CM6 extension：View plugins（decoration/widget）与 State fields 两大类（官方文档明确：「Obsidian editor extension 就是 CM6 extension」） | 改 Live Preview 渲染必须走这里 |
| Reading view 渲染后处理 | `registerMarkdownPostProcessor()` / `registerMarkdownCodeBlockProcessor()` | Markdown → HTML 后的 DOM 改写 |
| Editor suggest（输入补全） | `registerEditorSuggest()` + `EditorSuggest<T>` 抽象类 | |
| Context menus（事件注入式） | `workspace.on('file-menu' / 'files-menu' / 'editor-menu' / 'url-menu', cb)` 里往 `Menu` 加 item | 不是独立注册面，走 workspace 事件 |
| Commands（命令面板 + hotkey） | `addCommand()` | 支持 `hotkeys` 默认键位 |
| Hover preview | `registerHoverLinkSource()` | 与 Page preview core plugin 联动 |
| obsidian:// URL scheme | `registerObsidianProtocolHandler()` | 外部唤起入口 |
| 自定义文件类型 | `registerExtensions(['.xyz'], viewType)` | 让特定后缀文件用自定义 View 打开 |

---

## ④ app 内核对象模型（App / Vault / Workspace / MetadataCache）

`App`（obsidian.d.ts L406）是插件访问内核的总入口，字段全部 public：

```
App
├── keymap: Keymap            # 键位管理（pushScope/popScope，Scope 栈）
├── scope: Scope              # 根键盘 scope
├── workspace: Workspace      # 布局/视图/编辑器容器
├── vault: Vault              # 文件系统抽象
├── metadataCache: MetadataCache  # 元数据索引
├── fileManager: FileManager  # renameFile（自动改链）、processFrontMatter、trashFile
├── lastEvent: UserEvent|null
├── renderContext: RenderContext        # @since 1.10.0
├── secretStorage: SecretStorage        # @since 1.11.4（密钥存储）
├── isDarkMode()
└── loadLocalStorage/saveLocalStorage   # vault 级 localStorage（1.8.7）
```

**`Vault`**（文件系统，extends `Events`）：
- 读：`read` / `cachedRead`（仅展示用，更快）/ `readBinary` / `getResourcePath`
- 写：`create` / `createBinary` / `createFolder` / `modify` / `modifyBinary` / `append` / `appendBinary` / `process`（原子 read-modify-write）/ `copy`
- 管理：`delete` / `trash(file, system)` / `rename`（不改链接；改链接要用 `fileManager.renameFile`）
- 查询：`getFileByPath` / `getFolderByPath` / `getAbstractFileByPath` / `getRoot` / `getAllLoadedFiles` / `getAllFolders` / `getMarkdownFiles` / `getFiles` / `recurseChildren`
- 文件对象模型：`TAbstractFile`（path/name/vault/parent）→ `TFile`（stat/extension/basename）与 `TFolder`（children）
- 底层：`adapter: DataAdapter`（原始路径级读写）；`configDir`（通常 `.obsidian`）
- 事件：`create` / `modify` / `delete` / `rename`

**`Workspace`**（布局系统，extends `Events`）：
- 结构：`leftSplit` / `rightSplit`（侧栏）、`rootSplit`（主区）、`leftRibbon`、`containerEl`、`activeEditor`
- leaf 操作：`getLeaf(false/'tab'/'split'/'window')` / `getLeafById` / `getLeftLeaf` / `getRightLeaf` / `ensureSideLeaf` / `createLeafBySplit` / `duplicateLeaf` / `moveLeafToPopout` / `openPopoutLeaf` / `revealLeaf` / `detachLeavesOfType` / `iterateRootLeaves` / `iterateAllLeaves` / `getLeavesOfType`
- 状态：`getActiveViewOfType<T>()` / `getActiveFile()` / `getMostRecentLeaf()` / `setActiveLeaf()`；`activeLeaf` 已 **deprecated**
- 布局：`layoutReady` / `onLayoutReady(cb)`（关键：插件在 layout ready 前的初始化要包在这里面）/ `changeLayout` / `getLayout` / `requestSaveLayout`
- 事件：`active-leaf-change` / `file-open` / `layout-change` / `resize` / `css-change` / `quick-preview` / `editor-change` / `editor-paste` / `editor-drop` / `file-menu` / `files-menu` / `editor-menu` / `url-menu` / `window-open` / `window-close` / `quit`

**`MetadataCache`**（双链/元数据索引，extends `Events`）：
- `getFileCache(file)` / `getCache(path)` → `CachedMetadata`（frontmatter、headings、links、embeds、tags、sections 等）
- `getFirstLinkpathDest(linkpath, sourcePath)`（wiki-link 解析）、`fileToLinktext`
- 全库链接图：`resolvedLinks` / `unresolvedLinks`（`Record<srcPath, Record<dstPath, count>>`）
- 事件：`changed` / `deleted` / `resolve` / `resolved`

**设计要点**：Obsidian 没有「服务定位器 / DI」，就是一个挂在 `App` 上的公共对象树 + 事件总线（`Events` 基类 `on/off/offref/trigger`），插件拿到 `this.app` 即可触达一切。能力边界靠「API 表面约定 + 社区 review」而不是 runtime 隔离。

---

## ⑤ 加载机制

- **何时加载**：Obsidian 启动时读取 `.obsidian/community-plugins.json`（已启用列表），对每个启用插件加载 `<configDir>/plugins/<id>/manifest.json`，再加载 `main.js` 并实例化 default export，调用 `onload()`。manifest.json 变更需要**重启 app** 才生效（Build a plugin 教程 Step 4 明确「Remember to restart Obsidian whenever you make changes to manifest.json」）
- **layout 时序**：`onload()` 执行时 workspace layout 未必就绪；依赖布局的代码放 `this.app.workspace.onLayoutReady(() => ...)`；vault 初次加载时会对每个已有文件触发 `create` 事件，不想接收就把 handler 注册在 `onLayoutReady` 里（d.ts Vault.on('create') TSDoc）
- **Deferred views（1.7.2+）**：view 可能延迟实例化，`revealLeaf()` 返回 Promise，「await this function to ensure your view has been fully loaded and is not deferred」；插件该把「打开自定义 view」逻辑放 `onUserEnable()`
- **热重载**：**官方内核没有内建 hot reload**。官方做法（Build a plugin 教程）：① Command Palette → `Reload app without saving`；② Settings 里关掉再打开插件；③ 推荐安装社区插件 **Hot-Reload**（pjeby/hot-reload）监听 `main.js` 变化自动重载。开发流是 `npm run dev`（esbuild watch）持续产出 `main.js` + Hot-Reload 自动重载
- **持久化约定**：`loadData()` / `saveData(data)` 读写插件目录下 `data.json`（任意可 JSON 序列化对象）。sample plugin 惯例：`Object.assign({}, DEFAULT_SETTINGS, await this.loadData())` 合并默认值。外部改动通过 `onExternalSettingsChange()` 感知；vault 级临时状态可用 `app.loadLocalStorage/saveLocalStorage`
- **卸载语义**：`onunload()` + `Component.register*` 家族自动回收（事件、DOM listener、interval、子组件），这是防止「禁用后残留副作用」的核心机制

---

## ⑥ 官方 sample plugin 与 template 结构

`obsidianmd/obsidian-sample-plugin` 本身就是 **GitHub template repository**（官方教程引导用「Use this template」创建新仓库），即事实上的官方 plugin template。仓库根结构（README + package.json 实测）：

```
obsidian-sample-plugin/
├── src/main.ts          # 入口：MyPlugin extends Plugin（ESM）
├── manifest.json        # 仓库根一份，发 release 时也作为附件一份
├── styles.css
├── versions.json        # {"插件版本": "minAppVersion"} 兼容矩阵
├── esbuild.config.mjs   # 打包：src/main.ts → main.js
├── version-bump.mjs     # npm version 时自动同步 manifest/versions.json
├── package.json         # type: module; dev: esbuild watch; build: tsc -noEmit + esbuild production
├── tsconfig.json
└── eslint.config.mts    # 预置 eslint-plugin-obsidianmd（官方 lint 规则）
```

`package.json` 关键约定（实测 master）：`"main": "main.js"`、`"type": "module"`、devDependencies 含 `esbuild 0.25.x`、`typescript ^5.8`、`obsidian: latest`（npm 上的 obsidian 包只提供 `.d.ts` 类型，无 runtime）、`eslint-plugin-obsidianmd`。

`src/main.ts` 演示的最小全集：ribbon icon → Notice；status bar item；三种 command（`callback` / `editorCallback` / `checkCallback`，后者演示 `workspace.getActiveViewOfType(MarkdownView)` 条件判断）；`addSettingTab`；`registerDomEvent` + `registerInterval`（演示自动清理）；`loadData/saveData` + `Object.assign` 默认值合并；`Modal` 子类（onOpen/onClose + contentEl）。

**发布链路**（sample README「Releasing new releases」）：改 `manifest.json` 版本 → 更新 `versions.json` → GitHub Release（tag 不带 `v` 前缀）→ 附件上传 `main.js` + `manifest.json` + `styles.css` → 向 `obsidianmd/obsidian-releases` 提 PR 进 community plugin 目录。

---

## ⑦ 对 mossx 插件市场设计的要点提炼

1. **物理格式极简**（manifest + 单 JS bundle + 可选 CSS）是 Obsidian 生态爆发的关键；`manifest.json` 的 id 命名规则、`minAppVersion` + `versions.json` 兼容矩阵机制值得直接借鉴
2. **生命周期 = 注册即绑定清理**（`Component.register*`）比「onunload 手动清理」可靠一个量级，mossx 的插件基类应内置等价物
3. **挂载点是白名单式的**：ribbon / status bar / sidebar view / modal / settings tab / CM6 extension / post processor / protocol handler，全部通过显式 register 方法暴露，而不是让插件摸任意 DOM
4. **内核访问 = 公共对象树 + 事件总线**，无沙箱无权限系统 —— 生态信任靠社区 review（obsidian-releases PR 审核）；mossx 若要收紧安全模型（Tauri 环境有 Rust 侧可借力），这是与 Obsidian 差异化的机会点
5. **无内建 hot reload**，开发体验靠 esbuild watch + 社区 Hot-Reload 插件补齐 —— mossx 可在内核内建以形成体验优势

## 不确定 / 未验证项

- `.obsidian/community-plugins.json` 的确切文件名与加载顺序细节未在本轮从官方文档逐字核实（属于社区熟知的实现细节，官方文档未正式公开此文件格式）
- `obsidianmd/obsidian-plugin-template` 仓库本轮网络探测超时（HTTP 000），无法确认是否存在/已替代 sample plugin；以官方文档口径为准，sample plugin 即 template
- `obsidian.d.ts` 为 master 分支快照（2026-07-24 拉取），含 1.13.0 的 `settings` 字段、`ConfirmationModal` 等新 API；具体 app 版本与 API 的对应关系以 `minAppVersion` 机制为准
