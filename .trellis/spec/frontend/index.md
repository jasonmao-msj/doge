# Frontend 开发规范（doge）

本目录是 `doge` 前端执行规范，适用于 `React + TypeScript + Vite + Tauri`。

## 适用范围

- 代码范围：`src/**`（重点 `src/features/**`、`src/services/**`、`src/styles/**`）
- 运行边界：`src/services/tauri.ts`（frontend 与 Rust command 的 bridge）
- 质量门禁：`npm run lint && npm run typecheck && npm run test`

## 规范目录

| 文档 | 用途 | 状态 |
|---|---|---|
| [Directory Structure](./directory-structure.md) | 模块目录与文件落位规则 | Active |
| [doge Product Identity Contract](./doge-product-identity.md) | canonical manifest、UI/i18n、链接、品牌门禁与视觉资产 contract | Active |
| [Account Authority IPC Contract](./account-authority-ipc-contract.md) | Authority/Rust success envelope、field-scoped SafeLabel、masked email 与 progressive diagnostic contract | Active |
| [Component Guidelines](./component-guidelines.md) | 组件设计、props、样式与 i18n 规范 | Active |
| [Preference Settings UI / UX Guide](../../../docs/ui-ux/preference-settings-ui-guide.md) | 设置/偏好面板视觉与交互基线（克制 preference list） | Active |
| [Parallel Conversation Runtime Residuals](./parallel-conversation-runtime-residuals.md) | 多 session 并行实时对话的 7 条根因诊断 + 修复 + 回归契约 | Active |
| [Messages Streaming Render Contract](./messages-streaming-render-contract.md) | 固化 live conversation streaming 的 stable snapshot + live row override render contract | Active |
| [Computer Use Bridge](./computer-use-bridge.md) | Computer Use 状态面板、hook 与 bridge service contract | Active |
| [Claude Context Usage Display](./claude-context-usage-display.md) | Claude context usage view model、tooltip layout、pending/estimated/live display contract | Active |
| [Model Structured Output Contract](./model-structured-output.md) | AI model JSON / structured payload normalization、validator、bounded repair contract | Active |
| [Desktop Drag-Drop Contract](./desktop-drag-drop.md) | Tauri multi-WebView 外部文件/文件夹拖入 Composer 的跨层事件契约 | Active |
| [Multi-Repository File Tree Git Decoration Contract](./git-repository-file-tree-decorations.md) | 多 Git repository aggregate status、safe path projection、folder decoration 与 theme token contract | Active |
| [Multi-Repository Git Commit Workspace Contract](./multi-repository-git-commit-workspace.md) | repository-scoped Git identity、single/multi adaptive commit UI 与 partial success contract | Active |
| [File History View Cross-Layer Contract](./file-history-view.md) | file-scoped history、rename-follow、snapshot identity、Desktop/daemon parity 与 stale guard | Active |
| [Codex Provider Session UI Contract](./codex-provider-session-ui.md) | Codex provider selector、start/fork payload、thread metadata merge、sidebar/pinned/composer provider label contract | Active |
| [Provider-Scoped Model Catalog Contract](../backend/provider-scoped-model-catalog.md) | 五 CLI provider-bound/local validation model lookup、public merge、dedupe、Shared capability propagation 与 stale catalog guard | Active |
| [Shared Session V2 Execution Target / Send Contract](../backend/shared-session-v2-send-contract.md) | Composer Target、状态机、terminal observation、Projection Badge 与 provider-scoped owner routing | Active |
| [Native Provider Continuation Contract](../backend/native-provider-continuation-contract.md) | Native Session 跨 Provider 续接、degraded confirmation、Origin/Family、顶层标签与来源导航 | Active |
| [Hook Guidelines](./hook-guidelines.md) | hook 编排、async safety、bridge 调用约束 | Active |
| [State Management](./state-management.md) | local/global/persistent/runtime state 边界 | Active |
| [Workspace Note Context Capture](./workspace-note-context-capture.md) | code/conversation capture、workbench request 与 optional source persistence 的跨层 contract | Active |
| [Quality Guidelines](./quality-guidelines.md) | 禁止项、必做项、review checklist | Active |
| [Markdown Math Normalization Idempotence](./quality-guidelines.md#markdown-math-normalization-must-preserve-container-and-math-range-idempotence) | Markdown container prefix、math-range idempotence 与回归口径 | Active |
| [CodeMirror State-Coupled Extensions 不可跨越 Lazy Boundary](./quality-guidelines.md#codemirror-state-coupled-extensions-不可跨越-lazy-boundary) | 任何把 `@codemirror/*` state-coupled extension 拆到 lazy 边界后的硬性禁止 | Active |
| [Type Safety](./type-safety.md) | strict TypeScript 与 boundary mapping 规则 | Active |
| [Upstream Service and Release Isolation](../backend/upstream-service-isolation.md) | upstream runtime 隔离、custom provider 保留、updater/release fail-closed contract | Active |
| [Vendored Frontend（tokentracker-dashboard）](./tokentracker-dashboard-vendored.md) | 拓展-使用统计 vendored dashboard 的维护、数据通道、Tailwind v4 与性能边界约定 | Active |
| [Multi-Agent Collaboration Contracts](../multi-agent/contracts.md) | 多 CLI 协作 outcome 字符上限、§17.4.3 展示契约、降级 settle | Active |

## Pre-Development Checklist（开始开发前必读）

- 若任务同时涉及项目规则入口或文档治理边界，先读 `../guides/project-instruction-layering-guide.md`。
- 先读 [Directory Structure](./directory-structure.md)，确认文件放在哪个 feature slice。
- 涉及设置页 / 偏好列表 / 表单型管理 UI 时，先读 [Preference Settings UI / UX Guide](../../../docs/ui-ux/preference-settings-ui-guide.md)。
- 涉及 `useEffect`、polling、listener 时先读 [Hook Guidelines](./hook-guidelines.md)。
- 涉及 refactor 或大文件修改时先读 [Quality Guidelines](./quality-guidelines.md)。
- 涉及 CodeMirror / `@uiw/react-codemirror` 拆分 lazy 边界、压缩 startup bundle 时，先读 [CodeMirror State-Coupled Extensions 不可跨越 Lazy Boundary](./quality-guidelines.md#codemirror-state-coupled-extensions-不可跨越-lazy-boundary)。
- 涉及多 session 并行 / 长 turn 实时对话 / 性能卡顿排查时，额外读 [Parallel Conversation Runtime Residuals](./parallel-conversation-runtime-residuals.md) + [docs/perf/parallel-conversation-jank-handbook.md](../../../docs/perf/parallel-conversation-jank-handbook.md)。
- 涉及 live conversation message / Markdown / timeline render path 时，额外读 [Messages Streaming Render Contract](./messages-streaming-render-contract.md)。
- 涉及 UI -> service -> tauri/rust 的跨层变更，额外读：
  - `../guides/cross-layer-thinking-guide.md`
  - `../guides/code-reuse-thinking-guide.md`
- 涉及 Account Gateway、Authority/Rust response、`primaryEmailLabel` 或 Account safe artifact validator 时，额外读 [Account Authority IPC Contract](./account-authority-ipc-contract.md)。
- 涉及 analytics、managed provider default、About/Issue/Release URL 或 updater 时，额外读 [Upstream Service and Release Isolation](../backend/upstream-service-isolation.md)。
- 涉及 Web Service assets 检测/安装状态或启动 gate 时，额外读 `../backend/web-assets-package-contract.md`。
- 涉及 Claude 上下文用量窗体、`ThreadTokenUsage` 或 token indicator 时，额外读 [Claude Context Usage Display](./claude-context-usage-display.md)。
- 涉及 AI model JSON、structured output、`Return pure JSON only` prompt、`JSON.parse(response.text)` 或模型输出 repair 时，额外读 [Model Structured Output Contract](./model-structured-output.md)。
- 涉及 Tauri window/webview builder、Browser Agent child WebView、`src/services/dragDrop.ts` 或 Composer 外部文件/文件夹拖拽时，额外读 [Desktop Drag-Drop Contract](./desktop-drag-drop.md)。
- 涉及 `GitRepositorySummary`、多 repository status scan、file tree Git decoration 或 repository summary token 时，额外读 [Multi-Repository File Tree Git Decoration Contract](./git-repository-file-tree-decorations.md)。
- 涉及 Codex provider selector、`startThread` / `forkThread` payload、thread provider metadata、sidebar/pinned/composer provider label 或供应商管理 Codex tab 时，额外读 [Codex Provider Session UI Contract](./codex-provider-session-ui.md)。
- 涉及五 CLI provider binding、`getEngineModels`、Shared target validation 或 Composer 模型菜单时，额外读 [Provider-Scoped Model Catalog Contract](../backend/provider-scoped-model-catalog.md)。

## 项目事实基线（Project Facts）

- TS 使用 `strict: true`，且启用 `noUnusedLocals/noUnusedParameters`。
- alias：`@/* -> src/*`。
- 测试框架：Vitest，setup 文件为 `src/test/vitest.setup.ts`。
- 大文件守卫：`npm run check:large-files`（threshold 3000 lines）。
