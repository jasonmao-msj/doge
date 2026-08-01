# Obsidian 社区插件市场：治理与上架流程调研

> **Lifecycle**：External Current-State Research（截至 2026-08-01）。市场、review 与政策会独立演进；用于立项时必须重新核对官方 Community dashboard、Developer Policies 与 release repository。
> 调研日期：2026-07-25（以仓库 master 最新提交 2026-07-24 为准）
> 用途：mossx（Tauri 2 + React + Rust）规划 Obsidian 式插件市场的竞品参考
> 方法：web search + 抓取官方一手来源（github.com/obsidianmd 仓库实际文件与 git history、docs.obsidian.md 开发者文档源码 obsidianmd/obsidian-developer-docs、obsidian.md 官方博客、官方论坛）

---

## 0. 最重要的时效性结论（先说清楚）

**Obsidian 的插件上架流程在 2026 年 5 月发生了一次根本性的架构切换**，2026-08-01 复核仍成立；调研时必须区分新旧两套体系：

- **2026-05-12 前后**：官方上线 **Obsidian Community**（`community.obsidian.md`）——新的 directory + developer dashboard，引入**全自动 review 系统**，对**每个版本**（不只是首次提交）做安全与代码质量扫描。官方博客称借此在几天内处理完了积压的 **2,300+** 排队提交。
  - 来源：[The future of Obsidian plugins — Obsidian 官方博客](https://obsidian.md/blog/future-of-plugins/)
- **2026-05-15**：`obsidianmd/obsidian-releases` 删除了全部 PR templates 与 validation GitHub Actions（commit `d4f06944`，"remove PR templates & validation actions"，-805 行），README 同日更新为 "Remove submission instructions in favor of new system"。
  - 来源：[commit d4f06944](https://github.com/obsidianmd/obsidian-releases/commit/d4f06944)
- **现状**：`obsidian-releases` 仓库中的 `community-plugins.json` 已**不再是提交入口**，而是由 GitHub Actions 每小时（cron `17 * * * *`）从 `https://community.obsidian.md/assets/community-plugins.json` **镜像**同步，并带保留率校验（`MIN_RETENTION_PCT: 95`，插件数硬下限 1500）。
  - 来源：[.github/workflows/mirror-community-json.yml](https://github.com/obsidianmd/obsidian-releases/blob/master/.github/workflows/mirror-community-json.yml)

**对 mossx 的启示**：Obsidian 走过了 "Git 仓库 + PR + 人工 review" → "托管目录服务 + 账户体系 + 自动化扫描 + 人工兜底" 的完整演进路径。旧的 PR 模式在提交量增长到数千后崩溃（2025 年 review 积压 3+ 个月，见 §2.4），这是自建市场时最重要的前车之鉴。

下文 ①② 会同时描述新流程（current）与旧流程（historical，2020–2026.05），因为旧流程的所有规则文档仍是理解其治理思想的最好材料。

---

## ① obsidianmd/obsidian-releases 仓库结构

> ⚠️ 注意：Obsidian 本体闭源，此仓库**不含 Obsidian 源码**，只托管 community 目录数据与 desktop releases。
> 来源：[README.md](https://github.com/obsidianmd/obsidian-releases/blob/master/README.md)

### 1.1 顶层文件清单（master @ 2026-07-24 实测）

| 文件 | 作用 | 实测规模 |
|---|---|---|
| `community-plugins.json` | 社区插件主列表（现为目录镜像） | **6,002 个插件** |
| `community-css-themes.json` | 社区主题列表 | **646 个主题** |
| `community-plugins-removed.json` | 已下架插件 + **下架原因** | 175 条 |
| `community-css-themes-removed.json` | 已下架主题 | — |
| `community-plugin-deprecation.json` | 按插件 id 封禁**特定问题版本**的版本黑名单 | 见 §4.3 |
| `community-snippets.json` | CSS snippets 目录 | — |
| `community-plugin-stats.json` | 下载量等统计（每日由 `plugin-stat.yml` 拉取） | — |
| `desktop-releases.json` | Obsidian 桌面端自身的 release 清单 | — |
| `cla.md` | Contributor License Agreement（PR 时代要求贡献者回复签署） | — |
| `plugin-review.md` | 原 review 指南，现仅剩一行指针，指向 docs 的 Plugin guidelines | — |

### 1.2 `community-plugins.json` 条目格式

每条目**有且仅有 5 个字段**（旧 validation bot 会拒绝任何多余 key）：

```json
{
  "id": "obsidian-git",
  "name": "Git",
  "author": "Vinzent",
  "description": "Integrate Git version control with automatic backup and other advanced features.",
  "repo": "vinzent03/obsidian-git"
}
```

- `id`：唯一 id，必须与插件 `manifest.json` 的 `id` 一致
- `name` / `author` / `description`：用于 App 内搜索
- `repo`：GitHub 仓库标识，格式 `owner/repo`

**App 端消费协议**（README 原文，极其重要——这定义了市场的分发模型）：

1. Obsidian 读取 `community-plugins.json`，用 `name`/`author`/`description` 做搜索；
2. 用户打开详情页时，App 直接从插件 GitHub repo 拉 `manifest.json` 和 `README.md`；
3. repo 里的 `manifest.json` **只用于判断最新版本号**，实际安装文件从 GitHub Releases 取；
4. 若 manifest 要求的 `minAppVersion` 高于当前 App 版本，则查 `versions.json` 找兼容的最新插件版本；
5. 安装时下载 tag 与 manifest `version` 完全一致的 GitHub release 中的 `manifest.json`、`main.js`、`styles.css`（如有），存入 vault。

即：**目录只存元数据指针，二进制分发完全依赖 GitHub Releases，Obsidian 不做任何代码托管**。这是典型的 "thin registry + thick source platform" 设计。
来源：[README.md — How community plugins are pulled](https://github.com/obsidianmd/obsidian-releases/blob/master/README.md)

---

## ② 上架流程全貌

### 2.1 新流程（current，2026-05 起）

来源：[Submit your plugin — docs.obsidian.md](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin)（内容经 obsidianmd/obsidian-developer-docs 仓库 `en/Plugins/Releasing/Submit your plugin.md` 逐字核实）

1. **前置**：GitHub 账号 + **Obsidian 账号**；repo 根目录需有 `README.md`、`LICENSE`、`manifest.json`。
2. **建 release**：`manifest.json` 的 `version` 遵循 Semantic Versioning 且**仅支持 `x.y.z` 格式**；创建 GitHub release，**Tag version 必须与 manifest version 完全一致**；上传 `main.js`、`manifest.json`、`styles.css`（可选）作为二进制附件。
3. **提交**：在 `community.obsidian.md` 用 Obsidian 账号登录 → **绑定 GitHub 账号**（目录据此验证你对 repo 的所有权）→ Plugins → New plugin → 填 repo URL → 同意 Developer policies 并承诺持续维护 → Submit。
   - 目录处理的是**默认分支 HEAD 的 `manifest.json`**；`id` 必须全局唯一且不得包含 `obsidian`。
4. **自动 review + 反馈循环**：提交后由自动化系统 review，dashboard 显示需要修正的项；修正方式 = 更新 repo + 发一个版本号递增的新 GitHub release。**自动 review 不通过则插件无法在 App 内被安装**，但作者可随时编辑描述并重新 Publish。
5. **只需提交首个版本**；上架后用户直接从 GitHub 更新，无需再走任何审核提交。

**新旧对比的关键差异**：

- 旧：只有**首次提交**被人工 review，后续版本完全不审（官方博客承认这是旧体系的缺陷）；新：**每个版本都被自动扫描**（含 malware scanning），外加 scorecard 向用户公开检查结果。
- 新体系下 **manual review 继续存在**，但转向重点对象：popular plugins、featured plugins、社区举报的项目。
- 存量项目已全部用新系统 re-review 过一遍；不合新规的老项目被给予**临时豁免（temporary exception）**，但最终会被逐步清出官方目录（"phased out"）。
- 来源：[The future of Obsidian plugins](https://obsidian.md/blog/future-of-plugins/)

> **不确定性标注**：自动化 review 系统的具体检查实现**未开源、无公开文档**，官方只披露了政策合规、best practices、known vulnerabilities、malware 四类目标。博客确切发布日期页面 meta 未能提取，按搜索结果为 2026-05-12；从 2026-05-15 删除旧流程的 commit 佐证，时间基本吻合。

### 2.2 旧流程（historical，2020–2026-05）：fork + PR + 模板

2026-05-15 前有效，从 git history 完整还原：

1. Fork `obsidianmd/obsidian-releases`；
2. 把插件条目**追加到 `community-plugins.json` 列表末尾**（必须末尾，bot 会校验）；
3. 发 PR，按 `pull_request_template.md` 引导选择 `plugin.md` / `theme.md` 模板。

**plugin.md PR 模板 checklist**（最后版本 @ commit `104ad1dc`, 2025-09）：

- **Developer pledge**（2025-08 新增）：承诺交付高质量插件、持续维护、响应 bug report；若无力维护，尽力寻找继任 maintainer 或主动下架；
- 已在 Windows / macOS / Linux / Android / iOS（如适用）测试；
- GitHub release 包含全部必需文件（**独立文件**，不能只在 source.zip 里）：`main.js` / `manifest.json` / `styles.css`（可选）；
- **GitHub release 名与 manifest.json 的 version 完全一致（不得加 `v` 前缀）**；
- manifest 的 `id` 与 `community-plugins.json` 条目一致；
- README 说明用途与用法；
- 已读 Developer policies 并自评合规；
- 已读 Plugin guidelines 并自查常见坑；
- 已添加 LICENSE 文件；
- 尊重所用他人代码的原 license 并在 README 署名。

来源：[历史 plugin.md @ 104ad1dc](https://github.com/obsidianmd/obsidian-releases/blob/104ad1dc/.github/PULL_REQUEST_TEMPLATE/plugin.md)

### 2.3 Review bot 自动化检查项（旧体系，完整还原）

旧体系的 "bot" 是 repo 内的 GitHub Action `validate-plugin-entry.yml`（`pull_request_target` 触发，357 行 JavaScript，2026-05-15 与新流程切换时删除）。它把结果以 :x: error / :warning: warning 评论到 PR。完整检查项：

**结构类**
- 只能修改 `community-plugins.json` 一个文件
- 必须使用了 PR 模板（逐句匹配模板文本）
- 新条目必须在列表**末尾**，且提交者必须是 repo owner（GitHub org 需为 public member）
- JSON 可解析；条目恰好包含 5 个必需 key，无多余 key
- `repo` 格式正确且 GitHub 上真实存在

**命名类（error）**
- `id`：不得含 `obsidian`、不得以 `plugin` 结尾、必须匹配 `^[a-z0-9-_]+$`
- `name`：不得含 `Obsidian`（含 `Obsi-` / `-dian` 变体）、不得以 `Plugin` 结尾
- `description`：不得含 `Obsidian`；必须以 `.?!)` 之一结尾；**≤ 250 字符**
- `id` / `name` / `repo` 三者均不得与现有条目重复
- `id` 不得与**已下架插件**的历史 id 冲突（避免影响仍装着旧插件的用户）

**manifest.json 一致性类**
- repo 根目录必须存在可解析的 `manifest.json`
- manifest 恰好包含 `id, name, description, author, version, minAppVersion, isDesktopOnly`，仅允许额外 `authorUrl, fundingUrl, helpUrl`
- manifest 的 `id` / `name` / `description` 必须与 PR 条目**逐字一致**
- `authorUrl` 不得指向 obsidian.md 或插件 repo 自身；`fundingUrl` 不得为空或指向 obsidian.md/pricing
- `version` 必须匹配 `^[0-9.]+$`

**release / license 类**
- 必须存在 tag 与 manifest `version` **完全一致**的 GitHub release，且 assets 中有 `main.js` 和 `manifest.json`
- repo 必须含 LICENSE（调 GitHub license API 探测）

**warning 类（不阻塞）**：repo 未开 issues；`author` 填了邮箱；不允许 maintainer 编辑 PR；描述出现 "This is a plugin..." 句式；与已下架插件重名。

来源：[历史 validate-plugin-entry.yml @ d4f06944^](https://github.com/obsidianmd/obsidian-releases/blob/d4f06944%5E/.github/workflows/validate-plugin-entry.yml)；theme 对应 `validate-theme-entry.yml`（310 行）。

### 2.4 人工 review 标准与时长

- **标准**：人工 review 依据三份公开文档——[Developer policies](https://docs.obsidian.md/Developer+policies)（硬性政策）、[Submission requirements for plugins](https://docs.obsidian.md/Plugins/Releasing/Submission+requirements+for+plugins)（硬性要求）、[Plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)（"recommendations，但视严重程度仍可要求修改"）。后者是 review comment 的主要来源，涵盖：禁用全局 `app` 实例、安全（禁 `innerHTML`/`outerHTML`/`insertAdjacentHTML` 拼接用户输入）、资源必须随 unload 释放、UI 文案 sentence case、禁硬编码样式（用 CSS variables）、优先 Vault API 而非 Adapter API 等数十条。
- **时长（旧体系）**：官方 reviewer（joethei）明确表示**无法给出估计**，取决于插件大小、队列长度、作者修复速度、reviewer 可用时间、返工次数；2025 年社区实测反馈为 **1～3+ 个月**，官方（WhiteNoise）承认因 "提交免费 + 最终环节仍人工 + vibe-coding 导致提交暴增" 造成积压，对策是加强 ReviewBot 自动化 + 增聘 reviewer。
  - 来源：[Obsidian Forum — Why does it take so long to review plugins?](https://forum.obsidian.md/t/recurrent-why-does-it-take-so-long-to-review-plugins-whats-the-usual-time-it-takes-to-review-a-new-plugin-how-long-does-it-take-to-review-a-plugin/107899)
- **一个旧流程的运营细节**：bot 必须检测到作者完成了修改，PR 才会重新进入人工队列；否则无人查看。
- **时长（新体系）**：自动 review 近乎实时；官方未公布新体系下人工复审环节的 SLA。⚠️ 不确定。

---

## ③ 提交要求（硬指标汇总）

来源：[Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin)、[Submission requirements for plugins](https://docs.obsidian.md/Plugins/Releasing/Submission+requirements+for+plugins)、[Reference/Manifest](https://docs.obsidian.md/Reference/Manifest)、[Developer policies](https://docs.obsidian.md/Developer+policies)

| 要求 | 细则 |
|---|---|
| `LICENSE` | 必须；且须遵守所引用代码的原 license、必要时在 README 署名；不得滥用 Obsidian 商标让用户误以为是一方产品 |
| `README.md` | 必须；描述插件用途与用法；付费/账号/联网/访问 vault 外文件/界面内静态广告/服务端遥测/闭源 等情形**必须在 README 明确披露** |
| `manifest.json` | 必须放 repo 根目录；必需字段 `id, name, description, author, version, minAppVersion, isDesktopOnly` |
| 版本号 | Semantic Versioning，**仅 `x.y.z` 格式**（bot 校验 `^[0-9.]+$`） |
| GitHub release | **tag 与 manifest `version` 完全一致（无 `v` 前缀）**；assets 必须含 `main.js` + `manifest.json`；`styles.css` 可选 |
| `id` 规则 | 全局唯一；仅小写字母/数字/连字符；不得含 `obsidian`；不得以 `plugin` 结尾 |
| `name` 规则 | 短且描述性；Basic Latin 字符；不含 "Obsidian"/"Plugin"；不得与核心插件功能重名（如 "Bases"）；唯一 |
| `isDesktopOnly` | 使用 NodeJS/Electron API（`fs`/`crypto` 等）必须设为 `true` |
| `minAppVersion` | 设为实际兼容的最低 App 版本；不确定就填最新 stable build 号 |
| `fundingUrl` | 仅用于捐赠链接；不接受捐赠就删除该字段 |
| 代码要求 | 删除 sample plugin 示例代码；command id 不要自带插件 id 前缀（App 会自动加） |
| 发布自动化 | 官方提供 GitHub Actions 模板：push tag → build → `gh release create` 自动上传三件套，见 [Release your plugin with GitHub Actions](https://docs.obsidian.md/Plugins/Releasing/Release+your+plugin+with+GitHub+Actions) |

---

## ④ minAppVersion 机制与 API 版本化策略

### 4.1 minAppVersion + versions.json 回退机制

来源：[Reference/Versions](https://docs.obsidian.md/Reference/Versions)（经 obsidian-developer-docs 仓库逐字核实）

- `manifest.json` 的 `minAppVersion` 声明插件所需的最低 Obsidian 版本。
- 若用户 App 版本低于该值，Obsidian 会查插件 repo 根目录的 **`versions.json`**：一个 `{ "插件版本": "minAppVersion" }` 的映射表，据此为用户安装**兼容的最新旧版插件**。
- 官方明确：**无需列出全部历史版本**，仅在 `minAppVersion` 发生变化时更新 `versions.json`。

这是一套非常务实的**客户端侧版本协商协议**：目录不存多版本，兼容性解析完全由客户端按声明数据完成。

### 4.2 API 版本化与弃用策略

- Obsidian API **没有独立于 App 版本的 API 版本号**；API 演进直接跟随 App 版本，通过 [obsidianmd/obsidian-api](https://github.com/obsidianmd/obsidian-api) 的 TypeScript 类型定义（`obsidian.d.ts`，约 8,500 行）对外发布。
- 实测 `obsidian.d.ts`：**859 处 `@since` 标注**（标明 API 引入的 App 版本，如 `@since 1.4.10`），**13 处 `@deprecated`**，且 deprecated 条目几乎都带 `{@link 替代API}` 指引（如 `MarkdownPreviewRenderer.render` → `MarkdownRenderer.render`）。
- **弃用风格是 "软弃用"**：标记 `@deprecated` + 文档引导迁移，而非硬性移除；Plugin guidelines 中唯一明确警告可能移除的是全局 `app` 调试对象（"might be removed in the future"）。
- 新 API 请求的官方渠道是论坛 `Developers & API` 版块。
- ⚠️ 不确定：官方未公开成文的 "API 兼容性承诺/弃用周期" 政策文档；以上结论来自类型定义与文档的实证观察。

### 4.3 版本级封禁：community-plugin-deprecation.json

一个补充治理工具：按插件 id 列出**被官方封禁的具体版本号**（如 `"templater-obsidian": ["0.5.2", "0.5.3"]`），用于在发现某版本有严重问题时阻止其继续分发，而不必下架整个插件。
来源：[community-plugin-deprecation.json](https://github.com/obsidianmd/obsidian-releases/blob/master/community-plugin-deprecation.json)

---

## ⑤ 被拒 / 下架的常见原因与政策

### 5.1 硬性政策（Developer policies "Not allowed"）

来源：[Developer policies](https://docs.obsidian.md/Developer+policies)（经仓库源码逐字核实）

插件和主题**不得**：

1. 混淆代码以隐藏目的（Obfuscate code）；
2. 插入从网络加载的**动态广告**；
3. 在插件自身界面之外插入**静态广告**；
4. 包含**客户端遥测**（client-side telemetry）；
5. **自带更新机制**（更新必须走官方渠道）；
6. （主题）从网络加载任何资源。

**须披露才允许**：完整功能需付费 / 需账号 / 联网（说明用了哪些远程服务及原因）/ 访问 vault 外文件 / 界面内静态广告 / 服务端遥测（须附 privacy policy）/ 闭源（case by case）。

**Fork 政策**：原则上不允许 fork 上架，除非①原作者以可公开验证的方式书面同意，或②能证明原作者失联且项目 ≥ **6 个月**未更新；两种情况都必须署名原作者。官方鼓励 "少数高质量项目协作" 而非重复造轮子。

### 5.2 常见被拒原因（review 层面）

- 触发 bot 的任何 error 项（见 §2.3）：命名含 Obsidian/Plugin、描述超长或不含结束标点、release 缺文件、tag 与版本不符、无 LICENSE 等——这是旧体系最高频的驳回来源。
- 人工 review 高频意见集中在 [Plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)：XSS 风险的 DOM 拼接、资源未随 unload 释放、硬编码样式、UI 文案非 sentence case、滥用 `workspace.activeLeaf`、遍历全部文件找路径等。

### 5.3 下架流程与实测原因

政策原文（Developer policies — Removing plugins and themes）：

- 违规后官方**通常会联系作者并给出合理整改期限**；逾期未改则移出目录；
- **立即移除**的情形：疑似恶意、作者不配合、重复违规；
- 另外，**无人维护或严重损坏**（unmaintained or severely broken）的项目也可能被移除；
- 改名违规的后果：新 name 无效时目录会 **delist 插件直至修复**（Manifest 文档）。

`community-plugins-removed.json` 实测的 175 条下架原因样本（`reason` 字段原文）：

- `No longer functional`（Obsidian 升级后失效，最高频）
- `No longer maintained`
- `Archived repository`
- `Features merged into Commander plugin`（功能被其他插件吸收）
- `Developer banned from GitHub`

**违规举报流程**：先在插件 repo 开 GitHub issue → 作者 7 天无响应 → 联系 Obsidian 团队；严重违规可直接上报。

---

## ⑥ Beta 渠道（BRAT）与官方渠道的关系

来源：[Beta-testing plugins](https://docs.obsidian.md/Plugins/Releasing/Beta-testing+plugins)、[BRAT repo](https://github.com/TfTHacker/obsidian42-brat)、[README — Announcing](https://github.com/obsidianmd/obsidian-releases/blob/master/README.md)

- **Obsidian 没有官方 beta 渠道**（"Obsidian doesn't officially support beta releases"），官方文档的做法是直接**推荐第三方社区插件 BRAT**（Beta Reviewers Auto-update Tester，作者 TfTHacker）。
- BRAT 机制：测试者在 BRAT 里填入 beta 插件的 GitHub repo 路径，BRAT 直接从该 repo 下载/更新/重载插件，绕过官方目录。
- 官方文档建议：正式提交前先用 BRAT 做公开 beta 收集反馈；README 也推荐用 BRAT 降低 beta tester 的安装门槛。
- **治理边界**：Developer policies 明确**只适用于官方目录内的插件**；通过 BRAT / 手动 sideload 分发的插件不受官方政策约束（官方称其为 "nonetheless good practices"）。即官方渠道与 beta 渠道是**完全平行**的两条分发路径，BRAT 不是官方市场的 "testflight"。
- 新动态：论坛讨论中出现了另一个同类工具 **VERA** 被与 BRAT 并提（2025-11 论坛帖），细节未深入核实。⚠️ 不确定项。

---

## ⑦ Themes 市场的异同

来源：[Submit your theme](https://docs.obsidian.md/Themes/App+themes/Submit+your+theme)、[community-css-themes.json](https://github.com/obsidianmd/obsidian-releases/blob/master/community-css-themes.json)、历史 theme.md 模板 @ `104ad1dc`

**相同点**：同一目录（community.obsidian.md）、同一套 Developer policies、同样的 GitHub Releases 分发模型（tag 与 manifest version 一致）、同样的新自动 review 流程、同样只需提交首个版本。

**不同点**：

| 维度 | Plugins | Themes |
|---|---|---|
| 列表文件 | `community-plugins.json` | `community-css-themes.json` |
| 主键 | `id`（全局唯一，规则严格） | **无 `id`**，以 `name` 为唯一键 |
| 条目字段 | id/name/author/description/repo | name/author/repo/**screenshot**/**modes**/publish/legacy |
| 改名 | 可通过改 manifest `name` 更新（无效则被 delist） | **提交后 name 不可更改** |
| 命名限制 | 不得含 "Plugin"/"Obsidian" | **不得含 "Theme"** |
| release 资产 | `main.js` + `manifest.json`（+可选 `styles.css`） | `manifest.json` + **`theme.css`** |
| 额外资材 | — | 截图，16:9，推荐 **512×288** |
| 特有字段 | `isDesktopOnly`、`minAppVersion` 等 | `modes: ["dark","light"]`；`publish: true`（兼容 Obsidian Publish）；`legacy: true`（旧版主题标记） |
| 特有政策 | NodeJS/Electron API 限制 | **禁止从网络加载任何资源**（字体/图片须内嵌） |

**对 mossx 的启示**：Obsidian 用一套治理框架覆盖了两种资产类型，差异只在元数据 schema 与分发文件清单——schema 设计上值得直接借鉴 "共用 policy 层 + 类型特定 manifest 层" 的分层方式。

---

## 附：对 mossx 插件市场设计的要点提炼

1. **分发模型**：Obsidian = "thin registry（元数据 JSON）+ GitHub Releases 承载二进制"。零托管成本，但把可用性/审查深度让渡给了 GitHub；2026 年才用自有目录服务补上治理短板。mossx 若早期可采用同款轻量模式，但应预判提交量增长后的 review 瓶颈。
2. **版本协商**：`minAppVersion` + `versions.json` 的客户端回退协议简单可靠，值得照搬。
3. **自动化检查前置**：旧 bot 的 30+ 项检查（命名、schema、release 资产、license、一致性）几乎全部可无人工介入，应作为 CI 第一层；人工只看政策与代码质量。
4. **政策文本先行**：Developer policies / Submission requirements / Plugin guidelines 三层文档（硬性政策 / 硬性要求 / 建议）的划分清晰，直接可用作 mossx 政策文档结构参考。
5. **下架治理**：`removed.json`（含 reason）+ `deprecation.json`（版本级封禁）提供了 "软下架" 与 "版本熔断" 两种粒度。
6. **beta 渠道**：官方不建 beta 渠道、把需求外包给社区工具（BRAT），同时声明政策只管目录内——是一种低成本的治理边界划法。

---

## 来源清单（均为一手来源）

- [obsidianmd/obsidian-releases README](https://github.com/obsidianmd/obsidian-releases/blob/master/README.md)（及 master @ 2026-07-24 全部 JSON 数据文件实测）
- [mirror-community-json.yml](https://github.com/obsidianmd/obsidian-releases/blob/master/.github/workflows/mirror-community-json.yml)
- [commit d4f06944 — remove PR templates & validation actions](https://github.com/obsidianmd/obsidian-releases/commit/d4f06944)
- [历史 plugin.md PR 模板 @ 104ad1dc](https://github.com/obsidianmd/obsidian-releases/blob/104ad1dc/.github/PULL_REQUEST_TEMPLATE/plugin.md)
- [历史 validate-plugin-entry.yml @ d4f06944^](https://github.com/obsidianmd/obsidian-releases/blob/d4f06944%5E/.github/workflows/validate-plugin-entry.yml)
- [Submit your plugin — docs.obsidian.md](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin)
- [Developer policies](https://docs.obsidian.md/Developer+policies)
- [Submission requirements for plugins](https://docs.obsidian.md/Plugins/Releasing/Submission+requirements+for+plugins)
- [Plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)
- [Reference/Manifest](https://docs.obsidian.md/Reference/Manifest)
- [Reference/Versions](https://docs.obsidian.md/Reference/Versions)
- [Beta-testing plugins](https://docs.obsidian.md/Plugins/Releasing/Beta-testing+plugins)
- [Submit your theme](https://docs.obsidian.md/Themes/App+themes/Submit+your+theme)
- [Release your plugin with GitHub Actions](https://docs.obsidian.md/Plugins/Releasing/Release+your+plugin+with+GitHub+Actions)
- [The future of Obsidian plugins — 官方博客](https://obsidian.md/blog/future-of-plugins/)
- [Obsidian Forum — review 时长讨论帖](https://forum.obsidian.md/t/recurrent-why-does-it-take-so-long-to-review-plugins-whats-the-usual-time-it-takes-to-review-a-new-plugin-how-long-does-it-take-to-review-a-plugin/107899)
- [obsidianmd/obsidian-api](https://github.com/obsidianmd/obsidian-api)（`obsidian.d.ts` 实测）
- [TfTHacker/obsidian42-brat](https://github.com/TfTHacker/obsidian42-brat)

> 文档原文核实方式：docs.obsidian.md 是 Obsidian Publish SPA，正文经其源码仓库 [obsidianmd/obsidian-developer-docs](https://github.com/obsidianmd/obsidian-developer-docs)（`en/**.md`）逐字读取核实。
