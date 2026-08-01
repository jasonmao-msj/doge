# Obsidian 插件分发、安装与开发者体验调研

> **Lifecycle**：Historical External Research，正文主体是 2026-02 旧分发模型。
> **2026-08-01 校准**：2026-05-12 已上线 Obsidian Community directory + developer dashboard。新项目从 dashboard 提交并对每个版本做 automated review；GitHub Releases 仍承载版本产物，客户端仍要求用户手动更新。旧 `obsidian-releases` PR/registry 提交流程只保留为演进证据。详见 [官方公告](https://obsidian.md/blog/future-of-plugins/) 与 [marketplace governance 补充报告](./obsidian-plugin-marketplace-governance.md)。
> 调研日期：2026-02（数据以文中标注的抓取时点为准）。面向 mossx（Tauri 2 + React + Rust）插件市场设计的竞品参考。
> 一手来源优先级：docs.obsidian.md 开发者文档 > help.obsidian.md 官方帮助 > github.com/obsidianmd 官方仓库 > 社区/论坛。

---

## 0. TL;DR（对 mossx 的可迁移结论）

- **当前模型（2026-05 起）**：Obsidian Community 提供 directory、developer dashboard 与 automated review；新项目经 dashboard 提交，每个版本都扫描。GitHub Releases 仍承载 `main.js`、`manifest.json` 与可选 `styles.css` 等版本产物。
- **旧模型（本文 2026-02 原始窗口）**：`obsidian-releases` JSON registry + GitHub PR 是 submission/governance 中心。下文对这条链路的描述属于 historical evidence，不可直接复制为新市场方案。
- 安全模型极简：**Restricted Mode**（原 Safe Mode，v0.15.0 改名）一个总开关，默认开启；插件无权限沙箱，官方明示「插件继承 Obsidian 的全部访问权限」。
- 更新**不自动推送**：出于安全考虑需用户手动 `Check for updates` → `Update all`，更新直接从 GitHub 拉新版本 release。
- 桌面/移动共用同一注册表与分发链路，靠 manifest 里的 **`isDesktopOnly`** 布尔字段隔离。
- 开发者体验靠「template repo + esbuild（obsidian API 声明 external）+ `npm version` 触发 `version-bump.mjs` + GitHub Actions 自动发 release」四件套，外加社区插件 **Hot-Reload** 实现热重载。
- **2026-02 快照规模**：注册表 **6,004 个社区插件**、官方统计文件覆盖 5,971 个插件的 GitHub release 下载量，榜首 Excalidraw 约 680 万次下载；这些数字不可当作 2026-08 current metric。官方仍维护 removed/deprecation 数据，实时规模须重新抓取。

---

## 1. 用户侧安装链路（UI 交互全流程）

来源：[help.obsidian.md — Community plugins](https://help.obsidian.md/community-plugins)（[仓库原文 en/Extending Obsidian/Community plugins.md](https://github.com/obsidianmd/obsidian-help/blob/master/en/Extending%20Obsidian/Community%20plugins.md)）

完整链路：

1. **打开 Settings → Community plugins**，默认处于 **Restricted Mode**，社区插件整体禁用。
2. 点击 **"Turn on community plugins"** 关闭 Restricted Mode（官方文案见 §3）。
3. 点击 **Browse** 打开社区插件浏览面板；面板顶部有搜索框，按 **name / author / description** 过滤。也可以在浏览器打开 [community.obsidian.md](https://community.obsidian.md) 网页版目录。
4. 选中插件 → 点 **Install**。
5. 安装后还需 **Enable**：可在安装完成界面直接点 **Enable**，或回到 **Settings → Community plugins → Installed plugins** 用 toggle 开关启用。
6. **更新**：社区插件**不自动更新**（"For security purposes, community plugins don't update automatically"）。
   - 全部更新：Settings → Community plugins → Current plugins → **Check for updates** → 有更新时 **Update all**。
   - 单个更新：Check for updates 后，在 Installed plugins 列表对应插件旁点 **Update**。
7. **卸载**：Installed plugins 列表点 trash 图标 → 弹确认框点 **Uninstall**。
8. **已装插件管理**：每个插件行有 Settings（打开插件设置页）/ Hotkeys（配置快捷键）/ Funding（作者赞赏链接，对应 manifest 的 `fundingUrl`）/ Uninstall / Toggle 五组操作；另有 refresh 图标重载全部插件、folder 图标打开 vault 配置目录下的 plugins 文件夹、搜索框按名称过滤已装插件。

另有手动安装路径：把 `main.js`、`styles.css`、`manifest.json` 拷到 `VaultFolder/.obsidian/plugins/<your-plugin-id>/` 再重启/重载（[obsidian-sample-plugin README](https://github.com/obsidianmd/obsidian-sample-plugin)）。

---

## 2. 客户端如何从 GitHub Releases 拉取插件

来源：[docs.obsidian.md — Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin)、[obsidian-sample-plugin README](https://github.com/obsidianmd/obsidian-sample-plugin)、[obsidianmd/obsidian-releases](https://github.com/obsidianmd/obsidian-releases)（本次实测抓取）

### 2.1 注册表：一个 GitHub 仓库即"市场后端"

- 官方目录数据源是 `obsidianmd/obsidian-releases` 仓库的 JSON 文件：`community-plugins.json`（主注册表，实测 1.7 MB / **6,004** 条，字段仅 `id / name / author / description / repo`）、`community-plugin-stats.json`（下载量统计，1.78 MB / 5,971 条）、`community-plugins-removed.json`（下架记录，175 条，含 `reason`）、`community-plugin-deprecation.json`、`community-css-themes.json` 等。
- 注册表 entry 里**只有 repo 坐标**，没有任何二进制或 CDN 地址——分发完全去中心化到作者自己的 GitHub repo。

### 2.2 Release asset 约定

- 安装时，Obsidian 从 **tag 与 manifest `version` 完全一致**的 GitHub release 下载三个 binary attachments：`main.js`、`manifest.json`、可选 `styles.css`。原文："When a user installs your plugin, Obsidian downloads `main.js`, `manifest.json`, and `styles.css` from the GitHub release whose tag matches the `version` in your manifest"。
- 版本号必须是 **SemVer `x.y.z`** 格式，tag **不带 `v` 前缀**；`manifest.json` 必须同时存在于仓库根目录和 release 附件中。
- 目录在 submit 时处理的是仓库 default branch HEAD 的 `manifest.json`；`id` 必须全局唯一、全小写字母+连字符、不能以 `plugin` 结尾、不能包含 `obsidian`。

### 2.3 版本检查与更新机制

- 首次提交后**只需审核一次**："You only need to submit the initial version of your plugin. After your plugin has been published, users can download new releases from GitHub directly from within Obsidian."——即更新检查是客户端直接去作者 repo 的 GitHub Releases 比较新版本。
- **`versions.json`**（版本 → minAppVersion 映射）：`"new-plugin-version": "minimum-obsidian-version"`，作用是"so older versions of Obsidian can download an older version of your plugin that's compatible"——客户端按当前 app 版本回退选择兼容的历史 release。这是 Obsidian 兼容性策略的核心设计，mossx 可直接借鉴。
- 兼容性下限由 manifest 的 **`minAppVersion`** 字段声明（必填）。

> 不确定点：客户端更新请求的具体 HTTP 细节（是否走 GitHub API、是否经 obsidian.md 代理缓存）未见官方文档逐字描述；官方论坛有用户报告"Failed to load community plugins"与 GitHub 连通性相关（[forum](https://forum.obsidian.md/t/failed-to-load-community-plugins/15687)），侧面印证客户端直连 GitHub。

---

## 3. Restricted Mode（安全模式）设计与文案

来源：[help.obsidian.md — Plugin security](https://help.obsidian.md/plugin-security)、[Obsidian v0.15.0 changelog](https://obsidian.md/changelog/2022-06-14-desktop-v0.15.0/)

- **命名沿革**：早期叫 **Safe mode**，2022-06-14 发布的 desktop v0.15.0 起改名为 **Restricted mode**（changelog 原文："'Safe mode' has been renamed to 'Restricted mode'"）。大量社区插件 README 仍残留"disable Safe Mode"的旧表述。
- **默认开启**："By default, Obsidian runs in Restricted Mode to prevent third-party code execution. Only disable Restricted mode if you trust the authors of the plugins that you install."
- **操作路径**：Settings → Community plugins → **Turn on community plugins**（关闭）；反向操作是 Restricted mode 旁点 **Turn on**。
- **行为语义**：重新打开 Restricted Mode 后，**插件文件保留在 vault 里但被忽略**，不执行。
- **能力声明（罕见的直白文案）**："Due to technical limitations, Obsidian cannot reliably restrict plugins to specific permissions or access levels. This means that plugins will inherit Obsidian's access levels." 并明确列举插件可以：access files on your computer / connect to internet / install additional programs。对敏感数据场景，官方建议"perform an independent security audit"。
- **审核模式**：仅**初次提交**时人工+自动审核；之后每个新版本 release **不再逐个审核**（"The Obsidian team is small and unable to manually review every new release"），依靠社区举报 + 下架机制（removed 列表）。所有插件须遵守 [Developer Policies](https://docs.obsidian.md/Developer+policies)。
- 移动端还提供了 **"Open Vault in Restricted Mode"** 的逃生入口（vault 选择界面长按，2026-01 mobile v1.11.6 changelog 提及），用于插件导致无法打开 vault 时的恢复（[forum 讨论](https://forum.obsidian.md/t/panic-command-add-a-way-to-restart-the-app-in-safe-mode-if-a-plugin-or-theme-is-misbehaving/59554)）。

> 不确定点：点击 "Turn on community plugins" 时 app 内确认弹窗的逐字文案未见于公开文档，本节文案均引自 help 页面（与 app 内语义一致）。

---

## 4. 桌面 vs 移动端差异

来源：[docs.obsidian.md — Manifest](https://docs.obsidian.md/Reference/Manifest)、[docs.obsidian.md — Mobile development](https://docs.obsidian.md/Plugins/Getting+started/Mobile+development)、[obsidianmd/obsidian-api README](https://github.com/obsidianmd/obsidian-api)

- **`isDesktopOnly`**（manifest 必填布尔）："Whether your plugin uses NodeJS or Electron APIs." 设为 `true` 后**移动端直接不允许安装**该插件："If your plugin requires the Node.js or Electron API, you can prevent users from installing the plugin on mobile devices."
- 移动端**没有 Node.js / Electron API**，插件或其依赖调用这些库会直接 crash；正则 **lookbehind** 仅 iOS 16.4+ 支持，需 fallback。
- 运行时检测：官方 API 提供 **`Platform`** 工具（`Platform.isIosApp` / `Platform.isAndroidApp` / `Platform.isMobile`），桌面端还可用 DevTools console 里 `this.app.emulateMobile(true)` 模拟移动端调试。
- 移动端浏览/安装插件的 UI 链路与桌面一致（同一 Settings → Community plugins）；`.obsidian-mobile` 配置目录是社区发现的「按设备隔离配置」变通方式（移动端可配置使用不同的 configuration folder），用于解决桌面/移动启用不同插件集的诉求（[forum 讨论](https://forum.obsidian.md/t/save-settings-for-which-plugins-are-enabled-for-mobile-and-desktop-separately/36740)）。
- 移动端本身支持社区插件是当前状态（iOS/Android app 与桌面同版本线）；插件是否可用完全由 `isDesktopOnly` 与代码健壮性决定，官方不做"移动端认证"分级。

---

## 5. 开发者工具链

来源：[obsidianmd/obsidian-sample-plugin](https://github.com/obsidianmd/obsidian-sample-plugin)（[esbuild.config.mjs 原文](https://raw.githubusercontent.com/obsidianmd/obsidian-sample-plugin/master/esbuild.config.mjs)、[version-bump.mjs 原文](https://raw.githubusercontent.com/obsidianmd/obsidian-sample-plugin/master/version-bump.mjs)）、[docs.obsidian.md — Build a plugin](https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin)、[Release with GitHub Actions](https://docs.obsidian.md/Plugins/Releasing/Release+your+plugin+with+GitHub+Actions)、[pjeby/hot-reload](https://github.com/pjeby/hot-reload)、[obsidianmd/eslint-plugin](https://github.com/obsidianmd/obsidian-api)

### 5.1 官方 template：obsidian-sample-plugin

- GitHub **template repository**，"Use this template" 一键开新 repo；TypeScript + `obsidian` npm 包（类型定义 `obsidian.d.ts`，含 TSDoc 注释）。
- 建议直接把 repo clone 到开发用 vault 的 `.obsidian/plugins/<id>/` 下（并强调**永远不要在主力 vault 里开发**）。

### 5.2 esbuild 配置：API 依赖外挂 external

- `esbuild.config.mjs`：`entryPoints: ['src/main.ts']`，`bundle: true`，`format: 'cjs'`，`target: 'es2021'`，`outfile: 'main.js'`，`treeShaking: true`，dev 模式 `sourcemap: 'inline'` + `watch()`，prod 模式 `minify`。
- **`external` 清单是关键设计**：`'obsidian'`、`'electron'`、全套 `@codemirror/*`、`@lezer/*` 以及 Node `builtinModules` 全部声明 external——即 Obsidian 主进程在运行时通过 `require('obsidian')` 注入宿主 API，插件 bundle 只打包自己的第三方依赖。对 mossx 的启示：宿主提供稳定 require-able 的 API 模块，插件产物保持单文件 `main.js`。
- 运行时约定（[obsidian-api README](https://github.com/obsidianmd/obsidian-api)）：`main.js` 必须 default export 一个 `extends Plugin` 的 class；可用 `require('fs')` / `require('electron')`（桌面端）。

### 5.3 版本 bump：npm version 钩子 + version-bump.mjs

- 官方做法**不是**第三方 `obsidian-version-bump` 工具，而是 template 内置的 `version-bump.mjs`，挂在 npm 生命周期上：
  - `npm version patch|minor|major` 时 npm 先把 `package.json` 版本写入 `npm_package_version` 环境变量；
  - 脚本读 `manifest.json` 的 `minAppVersion`，把 `manifest.version` 改为目标版本；
  - 若目标版本不在 `versions.json` 中，追加 `"<version>": "<minAppVersion>"` 映射。
- 即：**package.json 是版本 single source of truth**，manifest.json / versions.json 由脚本同步。

### 5.4 Release 自动化

- 官方文档给出标准 `.github/workflows/release.yml`：tag push 触发 → `npm run build` → `gh release create "$tag" --draft main.js manifest.json styles.css`（先 draft，人工填 release notes 后 publish）。tag 必须等于 manifest version、无 `v` 前缀。

### 5.5 Hot-Reload（社区方案，官方文档推荐）

- [pjeby/hot-reload](https://github.com/pjeby/hot-reload)（948 stars）：watch 插件目录下 `main.js` / `styles.css` 变化，**文件停止变动约 0.75 秒后自动 disable→enable 该插件**；只作用于含 `.git` 子目录或 `.hotreload` 文件的插件目录（即开发中的插件），因为市场下载只含 `main.js`/`styles.css`，不会误伤普通用户。
- docs.obsidian.md 官方教程直接推荐："Install the Hot-Reload plugin to automatically reload your plugin while developing."
- 注意点：插件自身必须用 `onunload()` 和 `registerX()` 系列方法正确清理，否则热重载会留下不稳定状态。
- 移动端有实验性支持（0.3.0+，需 Obsidian ≥1.6.7）。

### 5.6 代码质量与审核工具

- [obsidianmd/eslint-plugin](https://github.com/obsidianmd/eslint-plugin)：官方 ESLint 规则集，把 Developer Policies 里大量条款变成可自动检查的规则（如 `no-unsupported-api`、`platform`（禁用 navigator 嗅探 OS）、`regex-lookbehind`（iOS 兼容）等）。
- 提交目录需先 agree Developer policies；自动审核不通过会在目录页面给出修改指引，未过审前插件不可安装（[Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin)）。

---

## 6. 插件数据存储约定

来源：[docs.obsidian.md — Plugin.loadData()](https://docs.obsidian.md/Reference/TypeScript+API/Plugin/loadData)、[Manifest](https://docs.obsidian.md/Reference/Manifest)

- 官方 API 文档逐字定义：**"Load settings data from disk. Data is stored in `data.json` in the plugin folder."** 即约定路径为 `<vault>/.obsidian/plugins/<plugin-id>/data.json`，配套 `saveData()` 写回。
- 插件安装目录约定：`<vault>/.obsidian/plugins/<id>/`，内含 `main.js`、`manifest.json`、可选 `styles.css`、`data.json`（运行时生成）。
- 本地开发时**文件夹名必须与 manifest `id` 一致**，否则 `onExternalSettingsChange` 等方法不会被调用。
- vault 级启用列表存于 `.obsidian/community-plugins.json`（删/改名该文件可批量禁用全部社区插件，是官方论坛公认的排障手段）。
- `data.json` 约定意味着插件数据随 vault 走：用同步工具（Obsidian Sync / iCloud / git）时配置天然跨设备迁移——这也是「不同设备启用不同插件」痛点的来源。

---

## 7. 生态规模与官方 stats 展示

来源：本次实测抓取 [obsidianmd/obsidian-releases](https://github.com/obsidianmd/obsidian-releases) 仓库（2026-02 时点）、[obsidian.md/plugins](https://obsidian.md/plugins)

- **插件总数**：`community-plugins.json` 共 **6,004** 个注册插件；另有 **175** 个被移除（`community-plugins-removed.json`，每条含 `reason`，如 "Features merged into Commander plugin"）。
- **下载量统计**：`community-plugin-stats.json` 覆盖 **5,971** 个插件，按 release 版本号记录 GitHub release asset 下载计数并汇总 `downloads` 与 `updated` 时间戳。Top 10（抓取时点）：

  | 排名 | 插件 | 累计下载 |
  |---|---|---|
  | 1 | Excalidraw (`obsidian-excalidraw-plugin`) | 6,798,512 |
  | 2 | Templater (`templater-obsidian`) | 4,974,928 |
  | 3 | Dataview (`dataview`) | 4,618,107 |
  | 4 | Tasks (`obsidian-tasks-plugin`) | 3,857,624 |
  | 5 | Advanced Tables (`table-editor-obsidian`) | 3,044,835 |
  | 6 | Calendar (`calendar`) | 2,920,127 |
  | 7 | Obsidian Git (`obsidian-git`) | 2,901,530 |
  | 8 | Style Settings (`obsidian-style-settings`) | 2,516,793 |
  | 9 | Kanban (`obsidian-kanban`) | 2,457,457 |
  | 10 | Iconize (`obsidian-icon-folder`) | 2,131,807 |

- **官方展示**：[obsidian.md/plugins](https://obsidian.md/plugins) 页面分 **Popular**（按下载量，Notebook Navigator / TaskNotes / Importer / Advanced Tables / Excalidraw / Minimal Theme Settings / Templater 等）和 **Updated**（最近更新）两个榜单；单插件页（`obsidian.md/plugins?id=<id>`）展示 README 全文与下载统计；网页目录另有 [community.obsidian.md](https://community.obsidian.md)。下载量口径是 **GitHub release 二进制附件的累计下载数**，官方没有独立下载计数器。
- 主题生态另有一套平行的 `community-css-themes.json` 注册表（本次未展开）。

---

## 8. 对 mossx 设计的关键启示（简要）

1. **GitHub-as-registry + GitHub-Releases-as-CDN** 模式几乎零后端成本，Tauri 客户端可用同一思路：注册表 JSON 放仓库，release asset 约定 3 个文件。
2. **versions.json 的「版本→minAppVersion」回退选择**是低成本高价值的兼容性设计，值得照搬。
3. **默认 Restricted + 显式免责文案 + 首审后不再审 + removed 列表**，是团队规模有限时诚实的安全模型；配合 app 崩溃后的「以 Restricted Mode 打开 vault」逃生通道。
4. **API external 化**（宿主注入 `require('obsidian')`）让插件 bundle 极小且 API 升级不需插件重新打包——mossx 若用 WebView 内 JS 插件体系可直接复用该模式。
5. **开发者四件套**（template repo、watch 构建、npm version 钩子 bump、tag 触发 release workflow）+ Hot-Reload 把上手门槛压到很低，是其生态 6k+ 插件的重要推手。

---

## 附：主要来源清单

- [docs.obsidian.md — Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin)
- [docs.obsidian.md — Release your plugin with GitHub Actions](https://docs.obsidian.md/Plugins/Releasing/Release+your+plugin+with+GitHub+Actions)
- [docs.obsidian.md — Build a plugin](https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin)
- [docs.obsidian.md — Manifest](https://docs.obsidian.md/Reference/Manifest)
- [docs.obsidian.md — Mobile development](https://docs.obsidian.md/Plugins/Getting+started/Mobile+development)
- [docs.obsidian.md — Plugin.loadData()](https://docs.obsidian.md/Reference/TypeScript+API/Plugin/loadData)
- [help.obsidian.md — Community plugins](https://help.obsidian.md/community-plugins)
- [help.obsidian.md — Plugin security](https://help.obsidian.md/plugin-security)
- [github.com/obsidianmd/obsidian-sample-plugin](https://github.com/obsidianmd/obsidian-sample-plugin)（含 esbuild.config.mjs / version-bump.mjs / README）
- [github.com/obsidianmd/obsidian-api](https://github.com/obsidianmd/obsidian-api)
- [github.com/obsidianmd/obsidian-releases](https://github.com/obsidianmd/obsidian-releases)（注册表与 stats 实测抓取）
- [github.com/obsidianmd/eslint-plugin](https://github.com/obsidianmd/eslint-plugin)
- [github.com/pjeby/hot-reload](https://github.com/pjeby/hot-reload)
- [github.com/TfTHacker/obsidian42-brat](https://github.com/TfTHacker/obsidian42-brat)（BRAT，beta 插件安装器，1,564 stars，可作为"未上架插件分发"参考）
- [Obsidian v0.15.0 changelog（Safe mode → Restricted mode）](https://obsidian.md/changelog/2022-06-14-desktop-v0.15.0/)
- [obsidian.md/plugins](https://obsidian.md/plugins)
- [Obsidian Forum — Restricted mode 启动逃生讨论](https://forum.obsidian.md/t/panic-command-add-a-way-to-restart-the-app-in-safe-mode-if-a-plugin-or-theme-is-misbehaving/59554)
