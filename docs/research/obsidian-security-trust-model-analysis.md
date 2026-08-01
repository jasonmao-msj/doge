# Obsidian 安全与信任模型调研报告

> **Lifecycle**：External Security Snapshot。安全结论具有时效性，不是 mossx threat model 或权限 contract。
> **最后复核**：2026-08-01；官方仍说明 community plugins 可访问本机数据并建议敏感场景独立审计。2026-05 automated review / scorecard 已上线；Access Disclosure、Verified Developer 等公告中的 future work 不应写成已交付能力。
> 调研时间：2026-07（基于当前可获取的公开资料）
> 调研范围：官方 help 文档、Developer docs、obsidian-releases / obsidian-developer-docs / eslint-plugin 仓库、官方 blog、CEO 在 Hacker News 的发言、第三方安全研究（Elastic Security Labs）
> 用途：mossx（Tauri 2 + React + Rust）插件市场安全模型竞品参考

---

## TL;DR

Obsidian 的信任模型长期是：**无沙箱（no sandbox）+ 默认 Restricted mode + 一次性人工初审 + 用户自担风险**。2026 年 4 月的 REF6598 / PHANTOMPULSE 安全事件成为转折点，官方于 2026 年 5 月上线了自动化 review（扫描每一个版本）、safety scorecard，并规划 Access Disclosure（权限声明）与 Verified Developer 标签。即便如此，官方明确承认"由于技术限制无法可靠地限制插件权限"，插件继承 Obsidian 的全部能力（文件系统、网络、可安装其他程序）。该模型 6 年（2020–2026）间支撑了 4000+ 插件/主题、1.2 亿次下载，没有出现过官方目录直接分发恶意软件的公开事件，但"只有初审、后续版本无人 review"被社区广泛批评为主要风险敞口。

---

## ① 官方对插件安全风险的立场与警告文案

官方有一篇专门的 [Plugin security](https://help.obsidian.md/Extending+Obsidian/Plugin+security) 帮助页，核心表述：

- 开篇定调："The Obsidian team takes security seriously. This page explains the risks involved when installing community plugins, and what the Obsidian team does to address them."
- [Community plugins](https://help.obsidian.md/Extending%20Obsidian/Community%20plugins) 页顶部有 **Warning** 块："Community plugins run third-party code on your behalf that could potentially do harm."
- 对插件能力的直白警告（Plugin capabilities 一节）：
  - "Community plugins can access files on your computer."
  - "Community plugins can connect to internet."
  - "Community plugins can install additional programs."
- 对敏感数据用户的 Tip："If you're working with sensitive data and wish to install a community plugin, we recommend that you perform an independent security audit on the plugin before using it."（即官方把审计责任交还给用户/第三方）

来源：[Plugin security - Obsidian Help](https://help.obsidian.md/Extending+Obsidian/Plugin+security)；GitHub 镜像 [obsidian-help/en/Extending Obsidian/Plugin security.md](https://github.com/obsidianmd/obsidian-help/blob/master/en/Extending%20Obsidian/Plugin%20security.md)

## ② Restricted mode 默认值与首次启用流程

- **默认开启**。"By default, Obsidian runs in Restricted Mode to prevent third-party code execution."
- 首次启用流程（关闭 Restricted mode）：
  1. 打开 **Settings**
  2. 侧边栏选 **Community plugins**
  3. 点 **Turn on community plugins**（安装插件前必须先关闭 Restricted Mode）
  4. 之后 **Browse** → 选插件 → **Install** → **Enable**
- 重新打开 Restricted mode 后，已安装插件**保留在 vault 中但被忽略**（不卸载、不执行）。
- 值得注意的设计：插件**不做自动更新**，官方理由是安全考虑——"For security purposes, community plugins don't update automatically"，用户需手动 Check for updates / Update all。

来源：[Plugin security](https://help.obsidian.md/Extending+Obsidian/Plugin+security)、[Community plugins](https://help.obsidian.md/Extending%20Obsidian/Community%20plugins)

## ③ Review 过程中实际检查什么

**2026-05 之前（人工初审时代）：**

- 只在首次提交时由小团队人工 review，确认符合 [Developer Policies](https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Developer%20policies.md) 与 [Submission requirements](https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Plugins/Releasing/Submission%20requirements%20for%20plugins.md)。
- 政策层面明令禁止：obfuscate code to hide its purpose（混淆代码掩饰目的）、dynamic ads、static ads outside plugin's own interface、client-side telemetry、插件自更新机制；theme 不得从网络加载资源。
- **要求 README 披露（Disclosure）而非禁止**：付费、账号要求、network use（须解释用了哪些远程服务及原因）、访问 vault 之外的文件、server-side telemetry（须附隐私政策）、闭源代码（case by case）。
- 也就是说：网络请求、vault 外文件访问**不是被审计拦截的**，而是靠"README 披露 + 人工抽查"；官方文档没有任何"审计 eval / 动态代码执行 / 具体网络端点"的承诺。
- **后续版本不 review**。官方原话："The Obsidian team is small and unable to manually review every new release of community plugins. Instead, we rely on the help of the community to identify and report issues." 社区论坛也确认："once it's published, there is no forced checks anymore"（[Obsidian Forum, 2024-11](https://forum.obsidian.md/t/how-obsidian-team-monitors-plugins-once-they-are-published/92447)）。

**2026-05 之后（automated review 时代）：**

- 官方 blog [The future of Obsidian plugins](https://obsidian.md/blog/future-of-plugins/) 宣布：**每一个版本**（not just the initial submission）都会被自动扫描，检查 developer policies 合规、代码质量（best practices）、已知漏洞（known vulnerabilities）和潜在恶意代码（malware scanning）。
- 自动化系统基于开源的 [eslint-plugin-obsidianmd](https://github.com/obsidianmd/eslint-plugin)（CEO 在 HN 确认 review 系统基于该 ESLint 插件且 open source / reproducible），规则包括 `no-nodejs-modules`（Node 内置模块须 `Platform.isDesktop` 守卫）、`no-unsupported-api`、`hardcoded-config-path`、`no-sample-code`、`validate-manifest`、`sentence-case` 等 40+ 条，主要覆盖代码质量/平台兼容性；安全检测（malware scan、network egress 披露）在 scorecard 中以独立信号呈现。
- 人工 review 保留，聚焦 popular / featured 插件和社区举报的问题。
- 存量插件全部重新扫描，不合规的老插件给了临时 exception，未来将逐步移出目录。
- 每个插件详情页展示 **safety scorecard**（自动化检查结果对用户可见），例如 Templater 的 scorecard 会披露 dynamic code execution、network calls 等（[HN 讨论](https://news.ycombinator.com/item?id=48109970)）。

来源：[obsidian.md/blog/future-of-plugins](https://obsidian.md/blog/future-of-plugins/)、[Developer policies](https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Developer%20policies.md)、[eslint-plugin README](https://github.com/obsidianmd/eslint-plugin)、[HN thread](https://news.ycombinator.com/item?id=48109970)

## ④ 恶意插件处置政策与历史事件

**处置政策**（[Developer policies - Removing plugins and themes](https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Developer%20policies.md)）：

- 一般违规：先联系开发者，给合理期限整改；不整改则移出目录。
- **立即移除**的情形：插件/主题 appears to be malicious、开发者不合作、重复违规。
- 也可能移除 unmaintained 或 severely broken 的项目。
- 举报路径：发现小问题找插件作者的 `security.md` / issue；怀疑恶意插件直接报给 Obsidian support 或 DM 论坛 moderator。

**历史事件：**

- 2020–2025 年间，**没有公开报道过官方目录中的插件直接投递恶意软件的事件**（这一点是"未发现"而非"确认无"，请按不确定项对待）。第三方批评主要集中在"机制风险"而非"实锤事件"，如 [Will Chatham 的博客（2025-07）](https://blog.willchatham.com/2025/07/20/obsidian-md-and-plugin-security/)：准入门槛低、只审一次、无后续 review，作者 GitHub 账号被劫持即可向数千用户推送恶意更新。
- **2026-04 REF6598 / PHANTOMPULSE**（标志性事件）：Elastic Security Labs 披露，疑似 DPRK 关联的攻击者在 LinkedIn/Telegram 社工金融与加密货币从业者，诱导受害者连接攻击者控制的云端 vault 并开启 community plugin sync；vault 内预配置的**合法社区插件 Shell Commands（配恶意 `data.json`）+ Hider** 在打开 vault 时静默执行 PowerShell（Windows，经 PHANTOMPULL loader 内存加载 PHANTOMPULSE RAT，具备 keylogging、截屏、进程注入、UAC bypass、以太坊链上 C2）或混淆 AppleScript（macOS）。要点：
  - 这不是官方目录的插件被投毒，而是**合法插件的合法功能 + 社工**被滥用；攻击"未利用任何软件漏洞"。
  - community plugin sync 默认关闭，受害者需手动忽略多道安全提示。
  - 官方回应：CEO Steph Ango (kepano) 在 HN 表示这是需要用户主动绕过多个安全警告的社工攻击、标题有误导性，且未收到实际损害报告；同时预告了插件安全大更新（一个月后的 automated review 发布）。
- 来源：[Elastic Security Labs - Phantom in the vault (2026-04-14)](https://www.elastic.co/security-labs/phantom-in-the-vault)、[Elastic - PHANTOMPULSE 分析](https://www.elastic.co/cn/security-labs/blockchain-c2-phantompulse-rat-sinkhole)、[GIGAZINE 报道（含 CEO 回应）](https://gigazine.net/gsc_news/en/20260513-obsidian-plugin-future/)

## ⑤ 是否有权限声明 / 沙箱机制

**确认没有（截至 2026-07 仍是"没有真正的沙箱"，但权限声明在路上）：**

- 官方原文："Due to technical limitations, Obsidian cannot reliably restrict plugins to specific permissions or access levels. This means that plugins will inherit Obsidian's access levels."（[Plugin security](https://help.obsidian.md/Extending+Obsidian/Plugin+security)）
- 即：没有 permission manifest、没有运行时 capability 隔离；插件就是跑在 Obsidian 主进程 WebView 里的任意 JavaScript，桌面端还能用完整 Node.js / Electron API。
- 官方没有给出过系统性的"为什么不沙箱"的技术长文，"technical limitations"是 help 文档中的唯一理由；实际原因是插件深度依赖 DOM 与 app 内部对象（非公开 API 也被大量插件使用），做权限隔离会破坏兼容性（此项为基于架构常识的推断，非官方原话）。
- **变化中**：2026-05 官方宣布计划推出 **Access Disclosure**（开发者声明插件是否访问 network / file system / clipboard，用户在安装前可见）与 **Verified Developer** 标签——注意这仍是"声明 + 展示"，不是强制沙箱。来源：[The future of Obsidian plugins](https://obsidian.md/blog/future-of-plugins/)、[GIGAZINE](https://gigazine.net/gsc_news/en/20260513-obsidian-plugin-future/)

## ⑥ 移动端为何不开放全部插件

移动端**并非完全禁止社区插件**，而是机制性收窄：

- 移动版 Obsidian 是 webview 架构，**没有 Node.js 和 Electron API**；任何用到这些 API 的插件会直接 crash。
- 官方强制：用了 Node/Electron API 的插件必须在 `manifest.json` 设 `isDesktopOnly: true`，移动端用户将无法安装该插件。
- 其他移动端坑：iOS 16.4 以下不支持正则 lookbehind 等（[Mobile development - Troubleshooting](https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Plugins/Getting%20started/Mobile%20development.md)）。
- 这本质上是**运行时能力差异**导致的兼容性收窄，顺带把"能访问文件系统/执行进程的桌面级高危能力"挡在了移动端之外。

来源：[Mobile development](https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Plugins/Getting%20started/Mobile%20development.md)、[Submission requirements - Node.js and Electron APIs are only allowed on desktop](https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Plugins/Releasing/Submission%20requirements%20for%20plugins.md)

## ⑦ 对企业 / 安全敏感用户的官方建议

- 对敏感数据用户：安装插件前**自行或委托第三方做独立安全审计**（官方明确把责任转移给用户）（[Plugin security](https://help.obsidian.md/Extending+Obsidian/Plugin+security)）。
- 保持 Restricted mode 开启；只对信任作者的插件关闭它。
- 2026-05 新增的 **Tools for teams**：让团队可以管理"哪些社区插件被允许"、向团队成员分发私有插件、发布官方插件的团队可申请 official label（[blog](https://obsidian.md/blog/future-of-plugins/)、[GIGAZINE](https://gigazine.net/gsc_news/en/20260513-obsidian-plugin-future/)）。
- 第三方（Elastic）对组织的建议可作参考：监控 Obsidian 派生 PowerShell/osascript 等子进程、制定应用层插件策略、禁止从不信任 vault 同步插件配置（[Elastic](https://www.elastic.co/security-labs/phantom-in-the-vault)）。

## ⑧ 总结：模型 10 年运营的效果与争议

注：Obsidian API 发布于 2020 年，插件生态实际运营约 6 年（2020–2026），"10 年"按提问口径理解为长期运营视角。

**效果：**

- 生态繁荣：4000+ 插件/主题、1.2 亿+ 累计下载（[官方 blog](https://obsidian.md/blog/future-of-plugins/)）。7 人团队支撑数千开发者、数百万用户，说明"轻 review + 社区自治"模型在成本上极其高效。
- 安全记录：2026 年前没有官方目录直接分发恶意软件的公开事件；唯一的标志性事件（REF6598）本质是社工 + 合法插件功能滥用，防线（Restricted mode 默认开、plugin sync 默认关）在攻击链中真实存在，是被社工绕过的。

**争议：**

1. **"只审一次"是最大风险敞口**：插件更新无 review、无自动更新（用户手动点 Update 反而可能把恶意更新拉进来），作者账号被劫持即可规模化投毒——与 VS Code 扩展市场同构的问题（[Will Chatham](https://blog.willchatham.com/2025/07/20/obsidian-md-and-plugin-security/)）。
2. **无沙箱 + 全能力继承**：任何插件都能读全盘文件、联网、装程序；官方 help 文档用"independent security audit"把责任转移给用户，被批不现实。
3. **披露靠自觉**：network use / telemetry 靠 README 披露而非技术强制；2026 新系统的 scorecard 才第一次把这些信号机器化、可见化（HN 上仍有争议：Templater 这类高权限插件 92 分是否"及格线太低"）。
4. **自动化 review 的误报/漏报**：CEO 承认上线即暴露数万条 warning，false positive / false negative 需迭代（[HN](https://news.ycombinator.com/item?id=48109970)）。
5. **社工攻击面无法靠 review 解决**：REF6598 证明共享 vault + 插件配置同步本身是攻击面，防线只能建在"默认关闭 + 用户教育"上。

**对 mossx 的启示（评估者注）：**

- Restricted mode 默认开、显式警告文案、安装/更新手动确认，是低成本高收益的必选项。
- 人工初审 + 每个版本的自动化扫描（ESLint 式规则 + malware scan）+ 公开 scorecard，是被 Obsidian 验证过的可扩展路径。
- 无沙箱是 Obsidian 最大的历史包袱；mossx 基于 Tauri 2，应尽早设计 capability/permission 声明（哪怕是声明式披露先行），避免走上"事后补权限模型"的路。
- 插件配置随 vault/工作区同步是独立攻击面，需默认关闭 + 明确信任边界。

---

## 附：主要来源清单

| 主题 | 来源 |
|---|---|
| 官方安全立场 / Restricted mode / 能力警告 | https://help.obsidian.md/Extending+Obsidian/Plugin+security |
| 社区插件使用流程 | https://help.obsidian.md/Extending%20Obsidian/Community%20plugins |
| Developer Policies（禁止项 / 披露项 / 移除政策） | https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Developer%20policies.md |
| Submission requirements | https://docs.obsidian.md/Plugins/Releasing/Submission+requirements+for+plugins |
| 2026 新 review 体系 / scorecard / teams | https://obsidian.md/blog/future-of-plugins/ |
| 新社区站 | https://community.obsidian.md/ |
| eslint-plugin（自动 review 规则基座） | https://github.com/obsidianmd/eslint-plugin |
| obsidian-releases（目录与拉取机制） | https://github.com/obsidianmd/obsidian-releases |
| 移动端限制 | https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Plugins/Getting%20started/Mobile%20development.md |
| REF6598 / PHANTOMPULSE | https://www.elastic.co/security-labs/phantom-in-the-vault |
| CEO HN 发言 | https://news.ycombinator.com/item?id=48109970 / https://news.ycombinator.com/item?id=48111426 |
| 发布后无强制 review（社区证词） | https://forum.obsidian.md/t/how-obsidian-team-monitors-plugins-once-they-are-published/92447 |
| 第三方批评 | https://blog.willchatham.com/2025/07/20/obsidian-md-and-plugin-security/ |

## 不确定项声明

- "2020–2025 官方目录无恶意插件分发事件"是"未检索到公开报道"，非官方声明。
- 关闭 Restricted mode 时应用内 modal 的精确文案未从官方文档获取，本文仅引用 help 页面文字。
- 自动化 review 的 malware scanning 具体技术细节（是否沙箱动态执行、签名校验等）官方未公开，仅知基于开源 eslint-plugin + 未公开的扫描管线。
- Access Disclosure / Verified Developer 为 2026-05 宣布的"coming months"计划，截至调研时的落地状态未逐一验证。
