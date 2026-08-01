# mossx 插件市场调研：Obsidian × Pi 双参照设计手册

> **Lifecycle**：Exploratory Comparative Design。不是已批准的 mossx plugin runtime / marketplace architecture。
> **最后复核**：2026-08-01；本地 pi evidence 锚定 `/Users/chenxiangning/code/AI/github/pi` @ `a9f5b1c123`，Obsidian 市场演进锚定 2026-05 Community launch。进入实现前必须重新确认外部 revision、license、distribution policy 与 sandbox/capability 边界。
> 更新日期：2026-07-24（第二版，基于四份 Obsidian 一手调研重写）
> 调研对象：Obsidian（插件市场标杆）与 pi（`/Users/chenxiangning/code/AI/github/pi`，agent 扩展架构标杆）
> 目的：mossx（ccgui，Tauri 2 + React 19 + Rust）要做**插件市场 + 扩展体系**，本文回答三个问题：
> ① Obsidian 和 pi 各自的优点是什么、为什么值得学；
> ② 两家都没解决的问题（mossx 必须自己补的）；
> ③ 落到 mossx 的架构与路径建议。
>
> 配套深度报告（本文只留结论，细节看子报告）：
> - [obsidian-plugin-runtime-architecture.md](./obsidian-plugin-runtime-architecture.md) — Obsidian 运行时与 API 面
> - [obsidian-plugin-marketplace-governance.md](./obsidian-plugin-marketplace-governance.md) — 市场治理与上架流程（含 2026-05 体系大改版）
> - [obsidian-plugin-distribution-dev-experience.md](./obsidian-plugin-distribution-dev-experience.md) — 分发、安装与开发者体验
> - [obsidian-security-trust-model-analysis.md](./obsidian-security-trust-model-analysis.md) — 安全与信任模型

---

## 一、一页结论

mossx 做插件市场，**运行时学 pi、市场治理学 Obsidian、安全模型两家都不够要自己补**。理由：

| 层次 | 学谁 | 核心资产 |
|---|---|---|
| 插件运行时协议（格式 / API 注入 / 事件 / 能力注册） | **pi** | factory 单文件插件、虚拟模块注入宿主 API、事件中间件、错误分级隔离 |
| 插件市场治理（registry / 上架 / 版本兼容 / 分发） | **Obsidian** | thin registry + GitHub Releases、`versions.json` 版本回退矩阵、自动化 review + scorecard（2026-05 新体系） |
| UI 挂载协议 | **Obsidian** | 挂载点白名单化（registerView/StatusBar/Ribbon/SettingTab…）+ `Component.register*` 注册即绑定清理 |
| 安全与信任 | **两家都不合格，自建** | 两家都是"无沙箱 + review + 用户自担"；mossx 基于 Tauri 2 capability 有机会做成差异化优势 |
| CLI 基石 + 多 CLI 串线 | **pi** | 统一 AgentEvent 流、steering 消息队列、RPC JSONL 协议、compaction 式上下文交接 |

**为什么运行时学 pi 而不是 Obsidian**：Obsidian 的 API 是笔记编辑器专用（Vault/Workspace/MetadataCache），pi 的 API 是 agent 专用（registerTool / tool_call 事件 / provider 注册 / system prompt 改写）——与 mossx 的 domain 完全吻合。且 pi 的"虚拟模块注入"比 Obsidian 的 esbuild external 更彻底地解决了宿主 API 版本漂移。

**为什么治理学 Obsidian 而不是 pi**：pi 没有真市场（只是 npm keyword 聚合画廊，无 registry、无审核、无版本兼容承诺）；Obsidian 运营了 6 年、6000+ 插件、1.2 亿+ 下载，治理体系经过实战验证，且在 2026-05 刚完成"全自动 review + scorecard"的现代化改版——mossx 可以直接抄新版，跳过它的人工 review 时代。

---

## 二、Obsidian 的优点（市场治理 + 生态设计）

### 2.1 极简物理格式：生态爆发的第一推动力

插件 = 一个文件夹三件套（[子报告①](./obsidian-plugin-runtime-architecture.md)）：

| 文件 | 必需 | 说明 |
|---|---|---|
| `manifest.json` | ✅ | id/name/version/minAppVersion/description/author/isDesktopOnly |
| `main.js` | ✅ | esbuild 单 bundle，default export 是 `Plugin` 子类 |
| `styles.css` | 可选 | 存在即自动加载/随插件卸载 |

**零构建工具要求、零框架绑定**，一个文本编辑器就能写插件。这是 6000+ 插件生态的门槛设计。mossx 借鉴点：插件格式的入门形态必须做到"单文件可跑"，manifest 只在需要时出现（pi 也是这个哲学）。

### 2.2 挂载点白名单 + 注册即绑定清理（最值得抄的两个运行时设计）

- **UI 挂载点全部显式 API 化**：`addCommand` / `addRibbonIcon` / `addStatusBarItem` / `addSettingTab` / `registerView` / `registerMarkdownPostProcessor` / `registerEditorExtension`（CodeMirror 6）/ context menu 事件……插件**不能摸任意 DOM**，只能在白名单挂载点内渲染。这对 mossx 至关重要：React 应用若不白名单化，第三方插件会直接操作 DOM 破坏渲染一致性。
- **`Component.register*` 自动清理**：`register(cb)` / `registerEvent` / `registerDomEvent` / `registerInterval` / `addChild` —— 注册时即绑定到组件生命周期，`onunload` 时统一回收，比"插件作者手动清理"可靠一个量级。**这是插件系统不内存泄漏、不残留监听的工程关键**。

### 2.3 版本兼容：`minAppVersion` + `versions.json` 回退矩阵

- manifest 声明 `minAppVersion`；
- 仓库里 `versions.json` 维护"插件版本 → 最低 app 版本"映射；
- **旧版 app 安装时自动回退下载兼容的旧插件版本**。

API 跟随 app 版本演进，859 处 `@since` 标注、软弃用（`@deprecated` 但不删）。这套机制让 app 可以持续升级 API 而不炸老用户——pi 完全没做这件事（0.x 频繁 breaking），mossx 必须学 Obsidian。

### 2.4 市场治理：thin registry + GitHub Releases（2026-05 刚现代化）

- **registry 只存元数据指针**（id/name/author/description/repo），二进制全在 GitHub Releases——官方不托管代码，运维成本极低，7 人团队运营 6000+ 插件。
- **release 约定**：tag 与 manifest version 完全一致（SemVer `x.y.z`，无 `v` 前缀），release 附件必含 main.js + manifest.json + styles.css。
- **2026-05 大改版（mossx 可直接对标新版）**：废弃"fork + PR + 人工 review"旧流程，上线 Obsidian Community 目录 + developer dashboard + **每个版本自动化扫描**（基于开源的 eslint-plugin-obsidianmd + malware scanning）+ **公开 scorecard**，几天清掉 2300+ 积压。
- **下架机制两粒度**：`removed.json`（整插件下架，含 reason）+ `deprecation.json`（版本级熔断）。
- **硬性禁令**：混淆代码 / 动态广告 / 客户端遥测 / 自更新机制；network 与 vault 外文件访问需在 README 披露。
- **BRAT 通道**：官方不管 sideload，第三方 BRAT 插件承接 beta 分发——官方渠道与非官方渠道平行互不约束，这个"只管目录内"的边界划分很干净。

### 2.5 用户侧信任交互

- **Restricted mode 默认开启**，用户需显式 "Turn on community plugins"；
- **插件不自动更新**（官方明确这是安全设计），更新需用户手动确认；
- 移动端通过 `isDesktopOnly` 机制性收窄（无 Node/Electron API 的环境直接禁止安装高危插件）。

### 2.6 开发者体验

- 官方 sample plugin 即 GitHub template repo，内置 esbuild 配置（`obsidian`/`electron`/CM6 全列 external——**宿主运行时注入 API**，bundle 极小）；
- `version-bump.mjs` 挂 `npm version` 钩子自动同步 manifest + versions.json；
- 官方 eslint-plugin-obsidianmd **把开发者政策变成 lint 规则**——政策前置到开发期而非上架期；
- 热重载是短板（靠社区 hot-reload 插件），mossx 可内建形成优势。

---

## 三、pi 的优点（agent 扩展运行时）

核心文档：`pi/packages/coding-agent/docs/extensions.md`（2961 行）；源码：`src/core/extensions/`（loader 721 行 / runner 1223 行）。

### 3.1 薄 core + 全 hook 注入

`pi-agent-core` 仅 ~2200 行，UI 无关，只发事件（`AgentEvent` 联合类型）不渲染；loop 的所有决策点（`convertToLlm` / `transformContext` / `beforeToolCall` / `afterToolCall` / `getSteeringMessages` …）都是注入 hook。**sub-agent、plan mode、permission gate 这些"重磅功能"全部是扩展实现，不在 core 里**——这是 pi "灵活"的真正来源，也是 mossx 引擎适配层该学的分寸。

### 3.2 插件格式：单文件 TS factory，零构建零 manifest

```typescript
export default function (pi: ExtensionAPI) { ... }
```

jiti 运行时加载 TS，入门形态就是一个文件。**factory 注入 API 比 Obsidian 的 Plugin 基类继承更干净**（无基类耦合、可 async、天然支持依赖注入式测试）。

### 3.3 虚拟模块注入宿主 API（比 Obsidian external 更彻底的一手）

插件 `import` 宿主 SDK 时，经 jiti alias / `VIRTUAL_MODULES` 表指向**宿主自己已加载的同一份模块对象**：免安装、无版本漂移、无 diamond dependency。Obsidian 的 esbuild external 是构建期外挂，pi 这是运行期保证。插件市场长期健康的关键设计。

### 3.4 事件中间件：可阻断、可改写、链式协作

30+ 事件按 load order 串行执行，前者输出是后者输入：

- `tool_call`（**可阻断、可原地改参数**）/ `tool_result`（链式改结果）
- `before_agent_start`（注入消息 + 链式改写 system prompt）
- `context`（每次 LLM 调用前改写上下文）
- `before_provider_request`（替换整个 provider payload）/ `registerProvider`（整体注册新 provider）
- `session_before_compact`（cancel 或提供自定义摘要）

mossx 代理多个 CLI 引擎，正需要这层统一的拦截改写面。

### 3.5 工程机制

- **错误分级隔离**：加载失败单个跳过记 diagnostics；普通事件出错记日志继续；**`tool_call` handler 抛错故意不 catch，fail-close 阻断工具执行**——安全 gate 不能因插件 bug 放行。
- **provenance/sourceInfo**：每个注册项可溯源到 user/project/package/temporary——做"禁用某插件全部贡献"时必需。
- **热重载 runner 换绑**：hook 执行时读当前 runner，reload 只换 runner 不重装 hook；session 替换后旧 ctx 调用抛带指引错误（stale ctx invalidate）。
- **包管理语义**：npm/git/local 三 source、版本/ref pin、user/project 双 scope 与 delta 覆盖、一个包可 bundle extensions+skills+prompts+themes。
- **session tree 持久化 + `pi.appendEntry`**：插件状态落进 session 文件但不进 LLM context，回放重建。
- **examples-driven 文档**：~80 个可运行扩展示例 + API↔示例对照表，生态冷启动的最佳教材形态。

### 3.6 对"CLI 基石 + 串线"的支撑

- **统一事件/消息模型**：AgentEvent + 可扩展 AgentMessage + `convertToLlm` 桥接 = 把任何 agent 运行态归一成标准事件流；mossx 四个 CLI 引擎若统一到此模型，串线就是"消息流路由"而非 N×N 格式转换。
- **steering 消息队列**（`getSteeringMessages`/`getFollowUpMessages`）：运行中插话/结束追话的官方通道，A CLI 产物注入 B CLI 运行中会话靠它，而非杀掉重启。
- **RPC JSONL 协议**：stdin/stdout 把完整 agent 能力暴露给任意进程（连 UI dialog 都走协议）——mossx 当"基石"被别的工具串时的传输层参考；生态内 `pi-chat`（Slack 编排）是现成案例。
- **上下文交接走摘要**：compaction 可自定义，全量历史留在各自 session tree——异构 CLI 串线不灌原始历史，避免爆 context/丢语义。

---

## 四、两家共同的短板：mossx 必须自己补的三件事

### 4.1 安全模型（最重要）

两家现状：**无沙箱、无权限声明**——Obsidian 官方理由是 "Due to technical limitations, Obsidian cannot reliably restrict plugins to specific permissions"，靠 restricted mode + review + 用户自担；pi 明说"扩展跑你的全部权限，自己审源码"，把沙箱留给扩展层自己接。

Obsidian 运营 6 年无目录投毒公开事件，但争议不断：只初审不复审（2026-05 才补上每版本自动扫描）、2026-04 REF6598/PHANTOMPULSE 社工事件暴露配置滥用风险、Obsidian 2026 年才开始补 Access Disclosure（声明式披露，仍非强制隔离）。

**mossx 的机会**：Tauri 2 原生有 capability/permission 体系，插件若为"声明权限（文件/网络/shell/LLM provider）+ 安装时授权页 + JS 代码跑隔离 WebView/Worker"，就是相对两家的明确差异化优势。设计上应从第一天把权限声明写进 manifest（哪怕初期不强制隔离），避免重蹈 Obsidian"事后补权限模型"的被动。

### 4.2 API 版本化承诺

Obsidian 有 `minAppVersion` + `versions.json` 机制但无正式弃用周期文档（软弃用）；pi 0.x 频繁 breaking 无承诺。mossx 需自己定义：API 语义化版本、弃用周期（如标记 deprecated 后保留 N 个 minor）、breaking 迁移指南义务。

### 4.3 UI 契约

- Obsidian 的挂载点是笔记编辑器专用（ribbon/status bar/CM6）；
- pi 的 `ctx.ui` 是终端组件模型（Box/Text/overlay/theme JSON）。

两家都不能直接用。mossx 需要自己的：**声明式 panel/widget schema + React 组件协议**，挂载点白名单化（ExtensionsView tab、sidebar、composer、设置页……），禁止插件直接操作宿主 DOM。

---

## 五、落到 mossx：架构与路径建议

### 5.1 目标分层架构

```
L4 市场层（学 Obsidian）
    registry（thin，元数据指针）+ 自动扫描 + scorecard + versions.json 回退
L3 插件运行时层（学 pi）
    factory 加载 + 虚拟模块注入 + 事件中间件 + 错误分级 + provenance
L2 扩展能力面（mossx 定义）
    白名单挂载点（panel/widget/command/skill/渲染器）+ Component 式自动清理
    + agent 事件面（tool_call/context/provider，适配多 CLI 引擎）
L1 引擎适配层（已有 engine/ + capability matrix）
    各 CLI 归一成 pi 式 AgentEvent 流 → 支撑串线编排
```

安全横切：manifest 权限声明 + 安装授权页 + 隔离执行（WebView/Worker）。

### 5.2 manifest 草案方向（融合两家）

```jsonc
{
  "id": "my-plugin",              // Obsidian 规则：小写+连字符，与目录同名
  "name": "My Plugin",
  "version": "1.0.0",             // SemVer x.y.z
  "minClientVersion": "0.9.0",    // 学 Obsidian minAppVersion + versions.json 回退
  "description": "...",
  "author": "...",
  "main": "index.ts",             // 学 pi：单文件 factory 入口，jiti 加载
  "permissions": ["fs.read", "network", "llm.provider"],  // 两家都没有，mossx 自建
  "contributes": {                // 白名单挂载点声明（静态可扫描）
    "commands": [...], "panels": [...], "skills": [...]
  }
}
```

### 5.3 复用 mossx 已有资产

- **货架**：`src/features/extensions/components/ExtensionsView.tsx`（9 个空 tab 等货）；
- **供应链原型**：curated-skills（`skills-lock.json` 版本/hash/license/category/minClientVersion + build 校验）与 agent-catalog（GitHub 上游 pin + hash + overrides）——把"build 期打包"换成"运行时下载到用户目录"即是市场 MVP；
- **引擎抽象**：`src-tauri/src/engine/` adapter + capability matrix，向下延伸统一 AgentEvent 流；
- **contract 门禁文化**：`check:*` 脚本体系正好用来约束第三方插件（manifest schema 校验、权限扫描、政策 lint）。

### 5.4 MVP → 完整市场的路径

1. **MVP（填货架）**：registry = 一个 JSON 索引 + tarball/GitHub Releases；下载到用户目录，沿用 lock/hash/license 校验；ExtensionsView skills tab 先填真货；Restricted mode 式默认关闭 + 显式开启。
2. **运行时协议**：定义 mossx ExtensionAPI（注册 command/skill/panel/渲染器 + 事件订阅），虚拟模块注入宿主 API；`Component.register*` 式自动清理。
3. **治理**：developer 提交 → 自动扫描（manifest schema + 权限 + 政策 lint，学前置 eslint 化）→ scorecard；`versions.json` 回退矩阵；removed/deprecation 两级下架。
4. **安全**：manifest 权限声明 → 安装授权页 → 隔离执行。
5. **串线（并行线）**：engine 层统一 AgentEvent 流 → steering 队列 → pipeline 编排 + compaction 式交接。

### 5.5 红线与避坑

- **性能**：AppShell 根渲染曾有 100~350ms 阻塞（`docs/perf/render-jank-knife-experiments-2026-07-08.md`），市场 UI 走 ExtensionsView 懒加载，高频数据禁挂根 hook 链；
- **不要放任插件摸宿主 DOM**（Obsidian 教训：白名单化是生态长期健康的护栏）；
- **不要默认自动更新插件**（Obsidian 明确作为安全设计）；
- **安全 gate 类 hook 必须 fail-close**（pi 的 tool_call 设计）；
- **API 从第一天打 `@since` 标签**（Obsidian 859 处 @since 是 6 年演进没炸的关键习惯）；
- **异构 CLI 串线交接走摘要，不灌原始历史**（pi 的 compaction 分寸）。

---

## 附：关键文件索引

pi 侧（本地仓库 `/Users/chenxiangning/code/AI/github/pi`）：

- `packages/agent/src/types.ts` — core hook 契约与 AgentEvent 定义
- `packages/coding-agent/src/core/extensions/loader.ts` — 扩展发现/加载/虚拟模块注入
- `packages/coding-agent/src/core/extensions/runner.ts` — 事件分发与错误分级
- `packages/coding-agent/src/core/package-manager.ts` — 包管理器（2650 行）
- `packages/coding-agent/docs/extensions.md` / `docs/packages.md` / `docs/security.md`
- `packages/coding-agent/examples/extensions/` — ~80 个可运行示例

Obsidian 侧（详见四份子报告，含全部来源 URL）：

- [obsidian-api/obsidian.d.ts](https://github.com/obsidianmd/obsidian-api) — API 全貌（8498 行）
- [obsidian-sample-plugin](https://github.com/obsidianmd/obsidian-sample-plugin) — 官方 template
- [obsidian-releases](https://github.com/obsidianmd/obsidian-releases) — registry（现为 community.obsidian.md 镜像）
- [Plugin security](https://help.obsidian.md/Extending+Obsidian/Plugin+security) — 官方安全立场

mossx 侧：

- `src/features/extensions/components/ExtensionsView.tsx` — 市场货架（9 tab 骨架）
- `src-tauri/src/curated_skills.rs` + `skills-lock.json` — 准市场供应链原型
- `scripts/agent-catalog/sync-agency-agents.mjs` — 上游同步链路
- `src-tauri/src/engine/` — 引擎 adapter + capability matrix
- `docs/perf/render-jank-knife-experiments-2026-07-08.md` — 根渲染性能红线
