## Why

`doge` 自 2026-08-10 与 `zhukunpenglinyutong/desktop-cc-gui` 分叉后，已经形成账号、托管引擎、按协议模型目录、异步引擎安装与发布链等独立产品边界；与此同时，上游在 476 个提交中修复了多项会话正确性、provider fact、Windows/macOS/Linux 与大输出稳定性问题。直接 merge 会把 PI/DSH/Qoder、壁纸、上游品牌与 release surface 一并带入，也会覆盖 doge 已验证的产品改造；完全不跟进则会重复承受上游已解决的 bug。

本 change 建立一次证据驱动的 selective upstream sync：以 doge 当前实现为事实源，按 capability 逐项采用、适配或拒绝上游变更，并为以后同步保留可审计的 decision matrix。

## 目标与边界

- 以 `2da6da39831a33cf31ea7f0c6796c66348e3a0c4` 为 merge-base，审计 `upstream/main@cd362f8cf` 相对 `origin/main@e0cad68d8` 的 476 个提交。
- 优先同步用户无感但影响可靠性的修复：terminal final text、Claude history/stream settlement、orphan turn recovery、Codex provider catalog/env/context facts、Windows/macOS 文件与进程行为。
- 对冲突执行 semantic merge：先识别 doge 改造意图，再移植上游根因修复；若 doge 已存在等价或更强 contract，则保留 doge 实现并补回归证据。
- 同步后的 engine/model 行为继续服从 doge 的 Product target catalog、managed provider、lazy provisioning 与登录后无阻塞首页 contract。
- 使用 L3 focused verification 覆盖 TypeScript/Rust contract、相关单测与 OpenSpec strict validation；跨平台安装包与完整 smoke test 留给 L4 CI/Release。

## 非目标

- 不 merge 整个 `upstream/main`，不追求 Git commit 数字上的“零 behind”。
- 不引入 PI、DSH、Qoder、Grok、OpenCode 等 doge 当前产品面未启用的新增入口或其专属 UI/runtime。
- 不引入上游 wallpaper/market、品牌、analytics、updater、version、release notes、账号/供应商管理实现。
- 不在本 change 搬运 AppShell、Session Index、历史分页、Markdown pipeline 的整套架构重写；只有能在 doge 现有 contract 上独立证明收益的修复才落地。
- 不改变 doge 当前发布版本号，也不发 Release。

## What Changes

- 建立 upstream capability matrix，记录每一类变更的 `adopt / adapt / already-covered / reject / defer` 结论、上游 commit evidence、doge 冲突意图与验证点。
- 移植会话数据完整性修复：terminal event 提交 live assistant 尾段、Claude history reconcile 不吞可见消息、stream idle/zero-first-event watchdog 只在有权威证据时结算。
- 移植 provider fact 修复：Codex managed scope 不混入官方幽灵模型、provider `env_key` 在 GUI/daemon 启动中可解析、未知 context window 不伪造 200K、runtime reasoning metadata 不在目录合成中丢失。
- 移植跨平台修复：Windows Rust stack reserve/deep future、F5 主窗口保护与 Windows Markdown 本地文件链接解析；对后台命令/进程存活 helper 先核对当前 fork 是否仍存在，已被 doge 当前架构覆盖或移除的路径不重建；网络盘 canonicalize blanket fallback 因 containment 风险延期。
- 只移植与 doge 当前结构兼容的性能/安全止血：live terminal output budget、client-store serialization/Markdown worker crash backoff 等须通过独立 compatibility check 后才纳入。
- 修复 staged/unstaged discard 的 index 语义（若 doge 当前仍存在该缺陷），保证丢弃 unstaged 修改不会误删 staged 内容。

## 技术方案取舍

### 方案 A：直接 merge `upstream/main`

优点是 ancestry 清晰、一次性获得全部修复；缺点是会导入大量 doge 无用 product surface，并对账号、引擎、模型目录、启动与 release contract 产生高风险覆盖。**不采用**。

### 方案 B：按 upstream commit 机械 cherry-pick

优点是保留原 commit attribution；缺点是 476 个提交之间存在密集架构依赖，大部分 patch 与 doge 已分叉文件冲突，且一个 commit 常混有 OpenSpec、品牌或未启用 engine 变更。**不作为主路径**，只对单一职责且能 clean apply 的 commit 使用。

### 方案 C：capability-driven semantic port

先对上游修复按用户价值与 doge 产品边界分类，再将根因修复映射到 doge 当前 contract、补齐本地 tests/specs，并记录被拒绝或延期项。它需要更多人工判断，但能最大限度保留 doge 改造并复用上游已验证方案。**采用**。

## Capabilities

### New Capabilities

- `markdown-local-file-link-open`: 本地 Markdown 文件链接在 Windows drive/UNC 与 macOS/Linux path 上保持安全、可解析、可打开的统一 contract。
- `desktop-cross-platform-runtime-guardrails`: Windows 主线程栈、deep future、隐藏子进程窗口、F5 reload 与跨平台 process liveness 的 desktop safety contract。

### Modified Capabilities

- `conversation-realtime-history-parity`: terminal completion 必须提交尚未落账的 live assistant text，history reconcile 不得吞掉已可见终稿。
- `conversation-realtime-client-performance`: command/file-change output 必须在 reducer 与 history normalization 边界保持有界，同时保留可诊断的 head/tail。
- `runtime-session-lifecycle-stability`: Claude stream idle、零首事件 orphan turn 与已完成进程退出必须依据 scoped terminal evidence 结算，避免永久 responding 或 false retry storm。
- `session-history-display-fidelity`: bounded/windowed Claude history hydrate 必须保留窗口边界上的完整消息与可见 realtime prefix。
- `codex-provider-scoped-session-launch`: managed provider 的 `env_key` 必须在 GUI 与 daemon 启动环境中可靠解析，且不得泄漏到日志或全局配置。
- `provider-model-catalog-refresh`: provider-scoped Codex catalog 不得混入未由该 provider 声明的官方 fallback，目录恢复仍使用 doge 的 binding-aware refresh contract。
- `codex-model-catalog-coverage`: provider-owned Codex model 必须保留 runtime reasoning metadata；未知 context window 必须显示未上报而不是伪造默认值。
- `workspace-filetree-progressive-scan-protocol`: Windows network/mapped drive canonicalize 失败时，已通过边界校验的 workspace path 仍可列出、读取与写入。
- `git-panel-diff-view`: 丢弃 unstaged 修改必须从 index 恢复 working tree，不得把 staged 内容一并丢弃。

## 验收标准

- [ ] capability matrix 覆盖 476 个提交的主要产品域，并为 adopted/deferred/rejected 结论提供 upstream SHA 与理由。
- [ ] doge 登录、首页、managed engine、lazy provisioning、Product target catalog 与 release workflow 不被上游专属行为回退。
- [ ] terminal final、Claude history、stream/orphan settlement、Codex provider facts 与跨平台路径修复均有 focused regression test。
- [ ] 不存在 PI/DSH/Qoder/wallpaper/upstream brand/release surface 的新增用户入口。
- [ ] `openspec validate --change sync-upstream-stability-2026-08 --strict --no-interactive`、受影响 Vitest/Rust tests、`npm run typecheck` 通过。
- [ ] L4 未覆盖范围（Windows/macOS/Linux 实机、installer/build、长会话 smoke）在 verification/PR 中明确列出。

## Impact

- Frontend: `src/features/threads/**`、`src/features/app/hooks/**`、`src/features/messages/**`、`src/markdown/**`、`src/utils/**`。
- Backend: `src-tauri/src/engine/**`、`src-tauri/src/codex/**`、`src-tauri/src/workspaces/**`、`src-tauri/src/git/**`、Tauri startup/build glue。
- Contracts: frontend event settlement、provider-scoped model facts、filesystem path resolution、Git discard semantics。
- 无数据库 migration；可能新增小型 Windows dependency/guard，但不得改变 doge 的 remote service 或 Release contract。
