# Changelog

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
