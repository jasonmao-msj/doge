## ADDED Requirements

### Requirement: Plugin MUST be self-described by an in-repo manifest

每个插件 MUST 在其仓库根目录携带 `plugin.json`（`manifestVersion`/`id`/`name`/`version`/`description` 必填；`capabilities.skill.entry`、`capabilities.viewer.{filePattern,action,title}` 与 `capabilities.glossary.entry` 可选）。应用 MUST 以该 manifest 为唯一能力事实源，MUST NOT 为具体插件在本体内写死行为。

#### Scenario: Install a repository without plugin.json
- **WHEN** 用户以 GitHub URL 或本地目录安装一个缺少 `plugin.json` 的仓库
- **THEN** 安装 MUST 失败并返回可读错误
- **AND** `~/.ccgui/plugins` 下 MUST NOT 留下残余目录

#### Scenario: Manifest id mismatch with catalog is tolerated
- **WHEN** 安装来源的 manifest 合法
- **THEN** 系统 MUST 以 manifest 的 `id` 作为安装目录名与唯一键

### Requirement: Skill capability MUST activate via native discovery

带 `skill` capability 的插件安装后，系统 MUST 在 `~/.claude/skills/<id>` 创建指向 `~/.ccgui/plugins/<id>` 的 symlink（不支持 symlink 的平台回退为复制），使 claude CLI 与 `$` 技能列表原生发现该 skill；系统 MUST NOT 将 skill 内容注入 system prompt。

#### Scenario: Uninstall cleans only owned links
- **WHEN** 卸载插件时 `~/.claude/skills/<id>` 存在
- **THEN** 仅当该路径是指向 `~/.ccgui/plugins/<id>` 的 symlink（或含本系统哨兵标记的复制目录）时 MUST 删除
- **AND** 用户自建的同名 skill 目录 MUST 保持原样

### Requirement: Viewer capability MUST drive message-side preview

带 `viewer` capability（`action: "html-preview"`）的插件安装后，当回合文件变更卡中的文件路径命中 `filePattern` 时，该文件行 MUST 显示预览入口；点击 MUST 在右侧面板以 sandboxed iframe（禁 same-origin 与脚本外逃）渲染文件内容，并提供复制 HTML 的操作。

#### Scenario: No plugin installed
- **WHEN** 没有任何已安装插件声明 viewer capability
- **THEN** 文件变更卡 MUST 按现状渲染，MUST NOT 触发额外后端请求

#### Scenario: Matched artifact preview
- **WHEN** 已安装 gzh-design 且回合产出 `out/attention.gzh.html`
- **THEN** 该文件行 MUST 出现预览按钮，点击后右侧面板渲染该 HTML 并可复制

### Requirement: Glossary capability MUST drive in-message term explanation

带 `glossary` capability 的插件 MUST 声明一个仓库内相对路径的 `.json` 词库（`{version: 1, terms: [{term, aliases?, explanation}]}`）。安装后，消息 Markdown 正文中命中词条（含别名，ASCII 词带词边界、大小写不敏感）的文本 MUST 标注为可点击入口，点击 MUST 弹出该词条的解释卡片并注明来源插件。标注 MUST 跳过代码块、行内代码、链接与公式子树，且同一条消息内同一词条仅标注首次出现。

#### Scenario: No glossary plugin installed
- **WHEN** 没有任何已安装插件声明 glossary capability
- **THEN** Markdown 渲染管线 MUST NOT 挂载词库匹配插件（零额外遍历），消息按现状渲染

#### Scenario: Term matched in prose but not in code
- **WHEN** 已安装 tech-glossary 且 AI 回复正文与行内代码中都出现「API」
- **THEN** 正文首个「API」MUST 渲染为解释入口，行内代码中的「API」MUST 保持纯文本

#### Scenario: Glossary entry file invalid
- **WHEN** 词库 JSON 解析失败或结构不合法
- **THEN** 系统 MUST 跳过该插件词库并记录警告，MUST NOT 影响消息渲染

### Requirement: Plugin state MUST follow render-perf red lines

已安装插件列表 MUST 启动拉取一次并由安装/卸载动作事件驱动刷新；MUST NOT 在根 hook 链引入秒级轮询或每事件级 setState。

#### Scenario: Idle session with plugins installed
- **WHEN** 会话空闲
- **THEN** 插件子系统 MUST NOT 产生周期性根渲染
