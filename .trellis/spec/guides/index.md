# Thinking Guides（思考指南）

这些指南用于减少 “实现正确但系统失真” 的风险，尤其是跨层改动和重复改动。

## 可用指南

| Guide | Purpose | 触发条件 |
|---|---|---|
| [Project Instruction Layering Guide](./project-instruction-layering-guide.md) | 固化规则入口、更新边界与 single source of truth | 修改项目规则文档、治理入口、ignore policy、host hook 入口 |
| [Code Reuse Thinking Guide](./code-reuse-thinking-guide.md) | 降低 duplication 和 drift | 同类逻辑出现 2 次以上 |
| [Cross-Layer Thinking Guide](./cross-layer-thinking-guide.md) | 保护 UI-runtime-backend contract | 触及 component + service + tauri/rust |
| [Codex Unified Exec Override Contract](./codex-unified-exec-override-contract.md) | 固化 unified_exec 的 settings/runtime/global-config 边界 | 触及 experimental settings、Codex args、global config repair |
| [Terminal Shell Configuration Contract](./terminal-shell-configuration.md) | 固化 built-in terminal shell path override 与平台 fallback 边界 | 触及 terminal shell path 设置或 `terminal_open` shell 解析 |
| [Workspace Session Catalog Contract](./workspace-session-catalog-contract.md) | 固化 workspace session membership、ownership、metadata overlay、source-fact cache 边界 | 触及工作区会话列表、Claude history、Session Management、Sidebar session merge |
| [Native WebView API Risk Gate](./native-webview-api-risk-gate.md) | 原生接口三问（替代方案 / startup guard / 验收矩阵），防 uiScale 卡死类 P0 复发 | 调 native / WebView / Tauri command；新增启动时生效的持久化设置；处理平台卡死反馈 |
| [新 CLI 接入指南](../../../docs/research/mossx-new-cli-onboarding-guide.md) | 新 CLI engine 全量接入点核对矩阵（含静默失败点标注）；上游契约为[基石设计](../../../docs/research/mossx-multi-cli-provider-session-foundation-design.md) | 接入新 CLI engine，或恢复/变更既有 engine 的接入面（registry、capability、渲染白名单、Shared 集合、i18n） |

## 项目级触发信号（doge）

- 修改 `src/services/tauri.ts` 或 command payload mapping。
- 修改 polling/listener 型 hook。
- 修改大 CSS 文件或 `*.partN.css`。
- 修改 `threads/spec-hub/git-history/file-view/composer` 主流程。
- 修改 `AGENTS.md`、`openspec/README.md`、`openspec/project.md`、`.gitignore`、`.claude/**`、`.codex/**` 等治理入口。
- 新增/恢复 CLI engine，或修改 `engineIds.json`、`EngineType`、`sharedSessionEngines`、capability matrix fixture、幕布渲染白名单（`TimelineRowRenderer` / `MessagesCore` / `useAppServerEvents`）中的任一 engine 分支。
- 调用 native / WebView 系统能力（zoom、DPI、窗口、透明度等），或新增「启动时生效的持久化设置」→ 必读 [Native WebView API Risk Gate](./native-webview-api-risk-gate.md)。

## Pre-Change Search Rule

变更前先搜索已有实现：

```bash
rg -n "<keyword>" src
```

## DoD（思考层）

- 已列出 cross-layer 影响面。
- 已评估 reuse 机会。
- 已定义验证命令与关键测试点。
