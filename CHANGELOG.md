# Changelog

### **2026年8月31日（v0.1.13）**

中文：

#### 新功能

- Codex 现在可以在 GPT-5.6 Sol、Terra 和 Luna 对话中直接生成图片，并在原问题旁显示生成进度、完成预览和历史结果，无需用户手动配置 OpenAI API Key。

#### 修复

- 修复上游已支持生图时，Codex 仍错误提示“图像生成工具不可用”的问题；托管配置会随实际 Codex 版本自动适配。
- 修复应用重启后托管 Kimi 会话可能从工作区会话列表消失的问题，并统一会话的读取、加载与删除来源。

English:

#### New Features

- Codex can now generate images directly in GPT-5.6 Sol, Terra, and Luna conversations, showing progress, completed previews, and restored history next to the original request without requiring users to configure an OpenAI API key.

#### Fixes

- Fixed Codex incorrectly reporting that image generation was unavailable even when the upstream service supported it; managed configuration now adapts automatically to the actual Codex version.
- Fixed managed Kimi conversations disappearing from workspace session lists after an app restart, with listing, loading, and deletion now using the same discovered source.

---

### **2026年8月30日（v0.1.12）**

中文：

#### 新功能

- Codex 现在可以直接使用已验证的 Claude 模型，并在主对话、面板管理与看板中保持一致的模型选择。

#### 改进

- 新用户会在首次发送时自动完成 Codex 托管配置；旧用户升级后也会自动迁移，无需重新设置或等待登录页准备引擎。

#### 修复

- 修复应用重启后会话可能丢失原有引擎、模型和供应商目标的问题。
- 修复线程切换或首次发送时可能受过期全局引擎状态影响而路由错误的问题。

English:

#### New Features

- Codex can now use verified Claude models directly, with consistent model selection across the main composer, Panel Management, and Kanban.

#### Improvements

- New users receive the managed Codex configuration on first send, while existing users migrate automatically after updating without reconfiguration or login-time engine preparation.

#### Fixes

- Fixed conversations losing their exact engine, model, or provider target after an app restart.
- Fixed thread switches and first sends being routed by stale global engine state.

---

### **2026年8月29日（v0.1.11）**

中文：

#### 改进

- 大型命令和文件变更输出会自动保留关键内容并限制内存占用，长时间对话更加流畅。
- Codex 的供应商模型目录更忠实于实际配置：不再补入无关官方模型，未知 context window 不再显示虚假使用率，并保留上游 reasoning 能力。
- Windows 现在支持打开本地磁盘和 UNC 文件链接；Git 面板丢弃未暂存改动时会保留已暂存内容。

#### 修复

- 修复消息结束瞬间偶发丢失助手回复尾段的问题。
- 提升 Windows 深层任务的运行稳定性，并阻止 F5 误刷新造成会话状态丢失。

English:

#### Improvements

- Large command and file-change output now preserves the important content within a bounded memory budget, keeping long conversations responsive.
- Codex provider model catalogs now match the actual provider configuration: unrelated official models are no longer injected, unknown context windows no longer show fabricated usage, and upstream reasoning capabilities are preserved.
- Windows now opens local-drive and UNC file links, while discarding unstaged Git changes preserves staged work.

#### Fixes

- Fixed an end-of-turn race that could occasionally drop the tail of an assistant response.
- Improved stability for deeply nested work on Windows and prevented accidental F5 reloads from discarding session state.

---

### **2026年8月28日（v0.1.10）**

中文：

#### 改进

- 版本记录现在离线展示从 v0.1.0 开始的完整双语历史，并与当前安装包版本保持同步。
- App 内版本记录、自动更新说明与 GitHub Release 使用同一份已审核内容。

#### 修复

- 发布前会提前阻止版本记录不一致或目标 tag 已被占用的构建，避免更新绑定到错误源码。

English:

#### Improvements

- Version History now shows the complete bilingual history from v0.1.0 offline and stays aligned with the installed build.
- In-app Version History, updater notes, and the GitHub Release now share the same reviewed content.

#### Fixes

- Release preparation now blocks inconsistent metadata or occupied target tags before builds can attach an update to the wrong source.

---

### **2026年8月28日（v0.1.3）**

中文：

#### 新功能

- 面板管理与主对话统一读取 Product 引擎和模型目录，并按 Codex、Claude、Kimi 各自支持的协议投影可用模型。
- Product CLI 改为发送消息时按需静默准备，登录和进入首页不再等待引擎安装。

#### 修复

- 修复 Guardian 后台会话出现在用户会话列表的问题。
- 修复新建会话、页面切换和侧边栏账户入口的引擎路由与渲染异常。

English:

#### New Features

- Unified Product engine and model catalogs across Panel Management and the main composer, projecting models by each engine's supported protocols.
- Moved Product CLI preparation to the first managed send so login and Home no longer wait for engine installation.

#### Fixes

- Prevented Guardian background sessions from appearing in user session lists.
- Fixed engine routing and rendering across session creation, page changes, and the account sidebar entry.

---

### **2026年8月27日（v0.1.2）**

中文：

#### 新功能

- 启用 doge 签名远端更新，并提供 Windows、macOS、Linux 与 Web assets 发布产物。
- 内置跨平台 Kimi shell runtime，固化 Codex、Claude、Kimi 三引擎托管订阅流程。
- 接入动态 Product 模型目录、引擎组合选择、Product Gate 与渐进式账户详情。

#### 修复

- 按 Responses、Chat Completions、Anthropic Messages 端点协议正确投影模型，并允许已验证的 Kimi 模型在 Codex 中运行。
- 修正 updater 验签公钥、managed CLI 检测、引擎路由、供应商续接和会话终态恢复。
- 加固 Windows 跨卷打包、macOS 签名顺序及跨平台发布产物生成。

English:

#### New Features

- Enabled signed doge remote updates with Windows, macOS, Linux, and Web asset release artifacts.
- Bundled the cross-platform Kimi shell runtime and completed the managed subscription flow for Codex, Claude, and Kimi.
- Added the dynamic Product model catalog, engine/model target selection, Product Gate, and progressive account details.

#### Fixes

- Projected models by exact Responses, Chat Completions, and Anthropic Messages protocols, including verified Kimi models running through Codex.
- Fixed updater verification keys, managed CLI detection, engine routing, provider continuation, and session terminal recovery.
- Hardened Windows cross-volume packaging, macOS signing order, and cross-platform release artifact generation.

---

### **2026年8月27日（v0.1.1）**

中文：

#### 新功能

- 合并 Skills、Commons 与看板上下文入口，减少输入区的重复控制项。

#### 修复

- 提升 CI 环境中 DMG 卸载与重试流程的稳定性。

English:

#### New Features

- Consolidated Skills, Commons, and Kanban context controls in the composer.

#### Fixes

- Improved DMG detach and retry reliability in CI environments.

---

### **2026年8月26日（v0.1.0）**

中文：

#### 新功能

- 发布 doge 首个正式版本，支持 Windows 应用远端更新，并优化慢速网络下的更新检查稳定性。

English:

#### New Features

- Published the first official doge release with Windows remote updates and more reliable update checks on slow networks.
