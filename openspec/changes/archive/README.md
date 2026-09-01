# Archived OpenSpec Proposal Index

本页为 `mossx` 已归档 OpenSpec proposal 的完整可点击索引。目录名中的日期是 archive date，不代表 proposal 首次创建时间。

- Indexed proposals: `889`
- Updated At: `2026-09-01`
- Source of truth: `openspec/changes/archive/<archive-date>-<change-id>/proposal.md`
- Back to current changes: [`../README.md`](../README.md)
- Back to workspace overview: [`../../project.md`](../../project.md)

## 2026-09

### 2026-09-01

- [`2026-09-01-fix-managed-codex-first-turn-target-drift`](2026-09-01-fix-managed-codex-first-turn-target-drift/proposal.md) — completed change；已同步 `engine-per-session-provider-binding` 与 `managed-codex-image-generation`，修复 managed Codex 首轮模型漂移与 Shared 图片持久化/预览链路

## 2026-08

### 2026-08-31

- [`2026-08-31-fix-shared-event-log-wal-recovery-probe`](2026-08-31-fix-shared-event-log-wal-recovery-probe/proposal.md) — completed change；已同步 `shared-event-storage`，修复 unclean WAL restart 时 read-only probe 把 healthy database 误判为 corruption

### 2026-08-30

- [`2026-08-30-fix-kimi-managed-session-catalog`](2026-08-30-fix-kimi-managed-session-catalog/proposal.md) — completed change；已同步 `kimi-engine-runtime` 与 `workspace-session-catalog-projection`，修复 managed Kimi history 重启后 workspace catalog 丢失
- [`2026-08-30-fix-managed-session-target-cold-start`](2026-08-30-fix-managed-session-target-cold-start/proposal.md) — completed change；Windows restart smoke passed；已同步 `codex-provider-scoped-session-launch`、`engine-per-session-provider-binding` 与 `shared-execution-target`

### 2026-08-28

- [`2026-08-28-enforce-release-changelog-gate`](2026-08-28-enforce-release-changelog-gate/proposal.md) — `CHANGELOG.md` 统一 App/updater/GitHub Release；tag collision与 bounded CI gates已通过 `v0.1.10` signed Release实证
- [`2026-08-28-bundle-kimi-windows-shell-runtime`](2026-08-28-bundle-kimi-windows-shell-runtime/proposal.md) — user-authorized waiver archive；已同步 `kimi-engine-runtime`；保留 discovery、跨平台实机、installer/signing 与 L4 release 未完成任务，不代表完整发布验收
- [`2026-08-28-add-collab-first-stage-main-canvas-context`](2026-08-28-add-collab-first-stage-main-canvas-context/proposal.md) — completed change，已同步 `collab-first-stage-main-canvas-context` 与 `multi-agent-orchestration`
- [`2026-08-28-add-multi-agent-inspector-inject-context`](2026-08-28-add-multi-agent-inspector-inject-context/proposal.md) — completed change，已同步 `multi-agent-inspector-inject-context` 与 `multi-agent-orchestration`
- [`2026-08-28-add-shared-session-project-memory-capture`](2026-08-28-add-shared-session-project-memory-capture/proposal.md) — completed change，已同步 `project-memory-auto-capture` 与 `shared-session-project-memory`
- [`2026-08-28-add-shared-squad-control-plane`](2026-08-28-add-shared-squad-control-plane/proposal.md) — completed change，已同步 shared squad control-plane capabilities
- [`2026-08-28-add-windows-main-window-close-confirm`](2026-08-28-add-windows-main-window-close-confirm/proposal.md) — completed change，已同步 `windows-main-window-close-confirm`
- [`2026-08-28-add-windows-sidebar-quick-switcher-and-collapse`](2026-08-28-add-windows-sidebar-quick-switcher-and-collapse/proposal.md) — completed change，已同步 `windows-sidebar-chrome-parity`
- [`2026-08-28-custom-model-provider-binding`](2026-08-28-custom-model-provider-binding/proposal.md) — completed change，已同步 custom provider binding capabilities
- [`2026-08-28-establish-doge-development-agent-system`](2026-08-28-establish-doge-development-agent-system/proposal.md) — completed change，已同步 `project-instruction-layering-governance`
- [`2026-08-28-fix-assistant-duplicate-render-native-shared`](2026-08-28-fix-assistant-duplicate-render-native-shared/proposal.md) — completed change，已同步 assistant/conversation convergence capabilities
- [`2026-08-28-fix-composer-rewind-reset-update-depth-loop`](2026-08-28-fix-composer-rewind-reset-update-depth-loop/proposal.md) — completed change，已同步 `client-renderer-stability-under-pressure`
- [`2026-08-28-fix-create-session-engine-routing`](2026-08-28-fix-create-session-engine-routing/proposal.md) — completed change，已同步 `create-session-engine-routing`
- [`2026-08-28-fix-custom-prompts-stale-empty-cache`](2026-08-28-fix-custom-prompts-stale-empty-cache/proposal.md) — completed change，已同步 `composer-prompt-completion`
- [`2026-08-28-fix-deepseek-balance-quota`](2026-08-28-fix-deepseek-balance-quota/proposal.md) — completed change，已同步 provider quota and status-panel capabilities
- [`2026-08-28-fix-engine-routed-session-launch`](2026-08-28-fix-engine-routed-session-launch/proposal.md) — completed change，已同步 `native-provider-continuation`
- [`2026-08-28-fix-grok-kimi-native-memory-completion`](2026-08-28-fix-grok-kimi-native-memory-completion/proposal.md) — completed change，已同步 `project-memory-auto-capture`
- [`2026-08-28-fix-local-dev-managed-engine-resources`](2026-08-28-fix-local-dev-managed-engine-resources/proposal.md) — completed change，已同步 `local-development-managed-engine-resources`
- [`2026-08-28-fix-product-provisional-thread-terminal-settlement`](2026-08-28-fix-product-provisional-thread-terminal-settlement/proposal.md) — completed change，已同步 product thread settlement capabilities
- [`2026-08-28-fix-provider-continuation-target-hydration`](2026-08-28-fix-provider-continuation-target-hydration/proposal.md) — completed change，已同步 `native-provider-continuation`
- [`2026-08-28-fix-shared-atomic-model-reasoning-linkage`](2026-08-28-fix-shared-atomic-model-reasoning-linkage/proposal.md) — completed change，已同步 shared model/reasoning capabilities
- [`2026-08-28-fix-shared-context-resume-integrity`](2026-08-28-fix-shared-context-resume-integrity/proposal.md) — completed change，已同步 `shared-context-resume-integrity`
- [`2026-08-28-fix-shared-create-default-provider-catalog`](2026-08-28-fix-shared-create-default-provider-catalog/proposal.md) — completed change，已同步 `model-provider-catalog-runtime`
- [`2026-08-28-fix-shared-model-picker-display-authority`](2026-08-28-fix-shared-model-picker-display-authority/proposal.md) — completed change，已同步 `model-provider-catalog-runtime`
- [`2026-08-28-fix-shared-session-recovery-exit-closure`](2026-08-28-fix-shared-session-recovery-exit-closure/proposal.md) — completed change，已同步 `shared-session-recovery-exit` 与 `shared-send-pipeline`
- [`2026-08-28-fix-shared-user-image-bubble-projection`](2026-08-28-fix-shared-user-image-bubble-projection/proposal.md) — completed change，已同步 shared canonical/user-image projection capabilities
- [`2026-08-28-hide-startup-gate-overlay`](2026-08-28-hide-startup-gate-overlay/proposal.md) — completed change，已同步 `client-startup-orchestration`
- [`2026-08-28-redesign-composer-session-control-hud`](2026-08-28-redesign-composer-session-control-hud/proposal.md) — completed change，已同步 composer session-control capabilities
- [`2026-08-28-refine-account-center-subscription-ui`](2026-08-28-refine-account-center-subscription-ui/proposal.md) — completed change，已同步 `account-center-subscription-ui` 与 `cli-engine-visibility`
- [`2026-08-28-refine-account-shortcut-and-managed-provider-default`](2026-08-28-refine-account-shortcut-and-managed-provider-default/proposal.md) — completed change，已同步 account/provider catalog capabilities
- [`2026-08-28-retire-claude-subagent-agent-session-card`](2026-08-28-retire-claude-subagent-agent-session-card/proposal.md) — completed change，已同步 Claude subagent presentation capabilities
- [`2026-08-28-simplify-shared-recovery-bar-ux`](2026-08-28-simplify-shared-recovery-bar-ux/proposal.md) — completed change，已同步 `shared-recovery-bar-ux` 与 `shared-session-recovery-exit`
- [`2026-08-28-stabilize-project-map-windows-test-latency`](2026-08-28-stabilize-project-map-windows-test-latency/proposal.md) — completed change，已同步 `architecture-ci-governance`
- [`2026-08-28-fix-workspace-session-startup-hydration`](2026-08-28-fix-workspace-session-startup-hydration/proposal.md) — startup gate-ready 后按 idle 顺序自动 hydration 可见非 active workspace 的 first-paint session list；保留 manual Tauri 冷启动验收 waiver

### 2026-08-26

- [`2026-08-26-enable-doge-remote-updater`](2026-08-26-enable-doge-remote-updater/proposal.md) — doge signed remote updater 已实现并同步 `doge-release-updater`；L3 focused gates 通过，真实两版本 Windows/macOS update smoke 保留为发布者验收项

### 2026-08-08

- [`2026-08-08-add-local-html-open-in-builtin-browser`](2026-08-08-add-local-html-open-in-builtin-browser/proposal.md) — verified implementation，已同步 `local-html-builtin-browser-open`、`vibecoding-browser-agent`；本地 HTML 经内置 Browser Agent（`file://`）打开；内容区/文件树/Git 入口；失败走全局 toast + i18n

### 2026-08-03

- [`2026-08-03-add-atlas-cloud-codex-preset`](2026-08-03-add-atlas-cloud-codex-preset/proposal.md) — verified implementation，已同步 `codex-provider-management`；Codex provider 预设新增 Atlas Cloud，含 Live API smoke
- [`2026-08-03-close-native-session-provider-create-binding`](2026-08-03-close-native-session-provider-create-binding/proposal.md) — verified implementation，已同步 `claude-provider-management`、`engine-per-session-provider-binding`、`shared-execution-target`；Native 新建菜单绑定供应商 + Shared Claude 切渠道重载 catalog
- [`2026-08-03-default-collapse-workspace-actions-menu`](2026-08-03-default-collapse-workspace-actions-menu/proposal.md) — verified implementation，已同步 `sidebar-workspace-menu-group-collapse`；workspace actions 组默认折叠，支持可访问临时展开
- [`2026-08-03-fix-linux-startup-preserve-baidu-analytics`](2026-08-03-fix-linux-startup-preserve-baidu-analytics/proposal.md) — verified implementation，已同步 `linux-native-baidu-analytics-stability`；Linux native 百度统计绕过 unsafe WebKit 路径，保留 PV/UV 与 visitor identity
- [`2026-08-03-honor-native-session-renamed-titles`](2026-08-03-honor-native-session-renamed-titles/proposal.md) — verified implementation，已同步 `claude-session-sidebar-state-parity`、`codex-session-sidebar-state-parity`；侧栏标题优先展示 native rename（custom-title / thread_name）
- [`2026-08-03-grok-cli-image-input-capability-gap`](2026-08-03-grok-cli-image-input-capability-gap/proposal.md) — verified / 已验收，已同步 `engine-image-input-boundary`；Grok/Kimi/OpenCode image transport + history presentation；Claude/Codex 兼容
- [`2026-08-03-enhance-subagent-canvas-persona-ui`](2026-08-03-enhance-subagent-canvas-persona-ui/proposal.md) — verified / 已验收，已同步 `subagent-canvas-persona-ui`、`generic-tool-presentation`；subagent canvas 人格卡片、squad grid、inspector drawer


#### 2026-08-03 第二波（complete / archive-ready）

- [`2026-08-03-add-skill-invocation-contract-and-prompt-distill`](2026-08-03-add-skill-invocation-contract-and-prompt-distill/proposal.md) — 已同步 skill invocation / prompt distill contracts
- [`2026-08-03-add-skills-hub-management`](2026-08-03-add-skills-hub-management/proposal.md) — 已同步 `extensions-management-surface`、`curated-skill-bundles`、`skills-hub-management`
- [`2026-08-03-add-tokentracker-usage-dashboard`](2026-08-03-add-tokentracker-usage-dashboard/proposal.md) — complete implementation archive；无 delta specs
- [`2026-08-03-allow-provider-continuation-cancel-while-running`](2026-08-03-allow-provider-continuation-cancel-while-running/proposal.md) — 已同步 running 态 continuation cancel
- [`2026-08-03-default-collapse-provider-continuation-families`](2026-08-03-default-collapse-provider-continuation-families/proposal.md) — 已同步 provider continuation families 默认折叠
- [`2026-08-03-enhance-provider-empty-model-and-custom-reasoning`](2026-08-03-enhance-provider-empty-model-and-custom-reasoning/proposal.md) — 已同步 empty model / custom reasoning
- [`2026-08-03-establish-session-foundation-contracts`](2026-08-03-establish-session-foundation-contracts/proposal.md) — 已同步 session foundation contracts
- [`2026-08-03-extend-shared-session-cli-targets`](2026-08-03-extend-shared-session-cli-targets/proposal.md) — 已同步 shared session CLI targets 扩展
- [`2026-08-03-filter-native-grok-opencode-provider-picker`](2026-08-03-filter-native-grok-opencode-provider-picker/proposal.md) — 已同步 native Grok/OpenCode provider picker filter
- [`2026-08-03-fix-codex-model-reasoning-fallback-mapping`](2026-08-03-fix-codex-model-reasoning-fallback-mapping/proposal.md) — 已同步 Codex model reasoning fallback mapping
- [`2026-08-03-fix-codex-provider-continuation-projection`](2026-08-03-fix-codex-provider-continuation-projection/proposal.md) — 已同步 `native-provider-continuation` Codex projection
- [`2026-08-03-fix-codex-provider-continuation-source-identity`](2026-08-03-fix-codex-provider-continuation-source-identity/proposal.md) — 已同步 Codex continuation source identity
- [`2026-08-03-fix-codex-stale-dead-thread-fork-continuation`](2026-08-03-fix-codex-stale-dead-thread-fork-continuation/proposal.md) — 已同步 Codex stale/dead thread fork continuation
- [`2026-08-03-fix-grok-history-tool-projection`](2026-08-03-fix-grok-history-tool-projection/proposal.md) — 已同步 Grok history tool projection
- [`2026-08-03-fix-native-continuation-token-projection`](2026-08-03-fix-native-continuation-token-projection/proposal.md) — 已同步 native continuation token projection
- [`2026-08-03-fix-provider-scoped-model-catalog-selection`](2026-08-03-fix-provider-scoped-model-catalog-selection/proposal.md) — 已同步 provider-scoped model catalog selection
- [`2026-08-03-fix-shared-canonical-history-recovery`](2026-08-03-fix-shared-canonical-history-recovery/proposal.md) — 已同步 shared canonical history recovery
- [`2026-08-03-fix-shared-durable-terminal-barrier`](2026-08-03-fix-shared-durable-terminal-barrier/proposal.md) — 已同步 shared durable terminal barrier
- [`2026-08-03-fix-shared-hidden-binding-visibility`](2026-08-03-fix-shared-hidden-binding-visibility/proposal.md) — 已同步 shared hidden binding visibility
- [`2026-08-03-fix-shared-local-claude-target-selection`](2026-08-03-fix-shared-local-claude-target-selection/proposal.md) — 已同步 shared local Claude target selection
- [`2026-08-03-fix-shared-session-askuserquestion-control-owner`](2026-08-03-fix-shared-session-askuserquestion-control-owner/proposal.md) — 已同步 AskUserQuestion control owner
- [`2026-08-03-fix-shared-session-identity-id-first`](2026-08-03-fix-shared-session-identity-id-first/proposal.md) — 已同步 shared session identity id-first
- [`2026-08-03-fix-shared-session-live-projection-resume`](2026-08-03-fix-shared-session-live-projection-resume/proposal.md) — 已同步 shared live projection resume
- [`2026-08-03-fix-shared-target-send-rollout`](2026-08-03-fix-shared-target-send-rollout/proposal.md) — 已同步 shared target send rollout / pipeline
- [`2026-08-03-fix-shared-terminal-recovery-i18n`](2026-08-03-fix-shared-terminal-recovery-i18n/proposal.md) — 已同步 shared terminal recovery i18n
- [`2026-08-03-fix-streaming-render-stall-then-flush`](2026-08-03-fix-streaming-render-stall-then-flush/proposal.md) — 已同步 streaming render stall/flush
- [`2026-08-03-grok-cli-reasoning-effort`](2026-08-03-grok-cli-reasoning-effort/proposal.md) — 已同步 Grok CLI reasoning effort
- [`2026-08-03-harden-composer-and-ai-commit-controls`](2026-08-03-harden-composer-and-ai-commit-controls/proposal.md) — 已同步 composer / AI commit control surfaces
- [`2026-08-03-modernize-prompt-enhancer-and-curated-skills-refresh`](2026-08-03-modernize-prompt-enhancer-and-curated-skills-refresh/proposal.md) — 已同步 `composer-prompt-enhancer` 与 curated skills refresh
- [`2026-08-03-move-mcp-inventory-to-extensions`](2026-08-03-move-mcp-inventory-to-extensions/proposal.md) — 已同步 `extensions-management-surface`、`claude-runtime-mcp-servers-panel`、`mcp-inventory-extensions-placement`
- [`2026-08-03-prune-composer-autocomplete-dead-paths`](2026-08-03-prune-composer-autocomplete-dead-paths/proposal.md) — 已同步 composer autocomplete dead-path 清理相关 specs
- [`2026-08-03-repair-shared-cli-creation-runtime-contracts`](2026-08-03-repair-shared-cli-creation-runtime-contracts/proposal.md) — 已同步 shared CLI creation runtime contracts
- [`2026-08-03-restore-opencode-engine`](2026-08-03-restore-opencode-engine/proposal.md) — 已同步 OpenCode restore；移除 soft-retirement 过时约束
- [`2026-08-03-sync-shared-session-curtain-parity`](2026-08-03-sync-shared-session-curtain-parity/proposal.md) — 已同步 shared session curtain parity
- [`2026-08-03-unify-conversation-canvas`](2026-08-03-unify-conversation-canvas/proposal.md) — 已同步 unified conversation canvas
- [`2026-08-03-unify-input-history-and-commands-refresh`](2026-08-03-unify-input-history-and-commands-refresh/proposal.md) — 已同步 input history / commands refresh contracts
- [`2026-08-03-use-home-double-column-target-picker`](2026-08-03-use-home-double-column-target-picker/proposal.md) — 已同步 home double-column target picker


#### 2026-08-03 第三波（shipped + manual residual waived）

判定口径：实现已合入主线，仅剩人工 smoke / 可选测试 / quantified evidence 的 change，按“已上线解决主问题”归档。

- [`2026-08-03-adapt-subagent-cross-engine-display`](2026-08-03-adapt-subagent-cross-engine-display/proposal.md) — 已上线+用户验收；可选 ja/ko 文案 residual waived；已同步 subagent persona/tree specs
- [`2026-08-03-add-cc-switch-provider-import`](2026-08-03-add-cc-switch-provider-import/proposal.md) — 实现已上线；真实 CC Switch DB 手工 residual waived
- [`2026-08-03-add-cli-engine-visibility-toggle`](2026-08-03-add-cli-engine-visibility-toggle/proposal.md) — 实现已上线；设置页/composer 可见性开关；已同步 `cli-engine-visibility`
- [`2026-08-03-add-grok-engine`](2026-08-03-add-grok-engine/proposal.md) — Grok 引擎 runtime 已上线；GUI 全路径 smoke residual waived；已同步 `grok-engine-runtime`
- [`2026-08-03-add-message-file-edit-scene-collapse`](2026-08-03-add-message-file-edit-scene-collapse/proposal.md) — 幕布文件修改折叠已上线；人工 smoke residual waived
- [`2026-08-03-add-shared-session-catalog-management`](2026-08-03-add-shared-session-catalog-management/proposal.md) — shared catalog 已上线；可选单测 residual waived
- [`2026-08-03-add-vendor-cli-lifecycle-header`](2026-08-03-add-vendor-cli-lifecycle-header/proposal.md) — CLI lifecycle header 已上线；多状态手工 residual waived
- [`2026-08-03-compact-diff-push-button`](2026-08-03-compact-diff-push-button/proposal.md) — compact push 已上线；UI 确认 residual waived
- [`2026-08-03-disable-session-activity-and-solo-mode`](2026-08-03-disable-session-activity-and-solo-mode/proposal.md) — session activity/solo 下线已上线；人工清单 residual waived
- [`2026-08-03-enable-claude-lightweight-streaming-and-frame-attribution`](2026-08-03-enable-claude-lightweight-streaming-and-frame-attribution/proposal.md) — lightweight streaming + frame attribution 已上线；quantified FPS residual waived
- [`2026-08-03-fix-messages-scroll-echo-follow-loss`](2026-08-03-fix-messages-scroll-echo-follow-loss/proposal.md) — scroll echo 修复已上线（含 focused tests）；实机 residual waived
- [`2026-08-03-fix-native-claude-provider-runtime-model-sync`](2026-08-03-fix-native-claude-provider-runtime-model-sync/proposal.md) — Claude provider runtime model sync 已上线；DeepSeek 手工 residual waived
- [`2026-08-03-fix-native-session-quota-target-scoping`](2026-08-03-fix-native-session-quota-target-scoping/proposal.md) — quota target scoping 已上线；已同步 `status-panel-session-overview`
- [`2026-08-03-fix-runtime-jank-feedback-and-catalog-race`](2026-08-03-fix-runtime-jank-feedback-and-catalog-race/proposal.md) — jank/catalog race 修复已上线+自动化通过；packaged runtime residual waived
- [`2026-08-03-fix-shared-session-target-race-and-merge`](2026-08-03-fix-shared-session-target-race-and-merge/proposal.md) — shared target race/merge 已上线；手工 residual waived
- [`2026-08-03-reduce-client-polling-overhead`](2026-08-03-reduce-client-polling-overhead/proposal.md) — polling 降载已上线+自动化通过；四路径 smoke residual waived
- [`2026-08-03-refactor-conversation-canvas-scroll-ownership`](2026-08-03-refactor-conversation-canvas-scroll-ownership/proposal.md) — scroll ownership 重构已上线；实机 residual waived
- [`2026-08-03-replace-checkpoint-governance-with-session-overview`](2026-08-03-replace-checkpoint-governance-with-session-overview/proposal.md) — 结果 tab 会话概览已上线；手工 residual waived
- [`2026-08-03-stabilize-client-runtime-and-diagnostics`](2026-08-03-stabilize-client-runtime-and-diagnostics/proposal.md) — runtime/diagnostics 稳定化已上线；功能 smoke 已过，quantified frame residual waived
- [`2026-08-03-streamline-native-provider-continuation`](2026-08-03-streamline-native-provider-continuation/proposal.md) — provider continuation 单确认/进度已上线；跨引擎手工 residual waived

#### 2026-08-03 历史索引补全

- [`2026-08-03-govern-documentation-information-architecture`](2026-08-03-govern-documentation-information-architecture/proposal.md) — historical archive index backfill

### 2026-08-02

- [`2026-08-02-fix-native-process-phase-orphan-reasoning`](2026-08-02-fix-native-process-phase-orphan-reasoning/proposal.md) — verified implementation，已同步 `message-process-phase-collapse`；过程相位折叠改为 turn-final ownership，吸收 Native 流式 mid-plan 前的孤儿思考过程
- [`2026-08-02-fix-native-continuation-artifact-path-windows-compat`](2026-08-02-fix-native-continuation-artifact-path-windows-compat/proposal.md) — verified implementation，已同步 `native-provider-continuation`；artifact 存储路径改为 platform-safe key，修复 Windows `os error 267`，读取兼容 legacy `{sessionId}` 布局

## 2026-07 (249)

### 2026-07-30

- [`2026-07-30-fix-live-history-reveal-click`](2026-07-30-fix-live-history-reveal-click/proposal.md) — historical archive index backfill
- [`2026-07-30-fix-shared-active-turn-timeout-recovery`](2026-07-30-fix-shared-active-turn-timeout-recovery/proposal.md) — historical archive index backfill
- [`2026-07-30-refine-message-anchor-rail-preview`](2026-07-30-refine-message-anchor-rail-preview/proposal.md) — historical archive index backfill
- [`2026-07-30-restore-shared-queue-fusion-compaction-continuity`](2026-07-30-restore-shared-queue-fusion-compaction-continuity/proposal.md) — historical archive index backfill

### 2026-07-29

- [`2026-07-29-group-provider-continuation-family-in-sidebar`](2026-07-29-group-provider-continuation-family-in-sidebar/proposal.md) — historical archive index backfill
- [`2026-07-29-separate-config-reload-and-cli-model-discovery`](2026-07-29-separate-config-reload-and-cli-model-discovery/proposal.md) — historical archive index backfill

### 2026-07-28

- [`2026-07-28-add-native-provider-continuation`](2026-07-28-add-native-provider-continuation/proposal.md) — historical archive index backfill
- [`2026-07-28-add-shared-context-compiler`](2026-07-28-add-shared-context-compiler/proposal.md) — historical archive index backfill
- [`2026-07-28-calibrate-multi-cli-session-foundation-a-d`](2026-07-28-calibrate-multi-cli-session-foundation-a-d/proposal.md) — historical archive index backfill
- [`2026-07-28-complete-multi-cli-provider-switching-ux`](2026-07-28-complete-multi-cli-provider-switching-ux/proposal.md) — historical archive index backfill
- [`2026-07-28-compose-shared-session-execution-target`](2026-07-28-compose-shared-session-execution-target/proposal.md) — historical archive index backfill
- [`2026-07-28-fix-native-continuation-runtime-model-ack`](2026-07-28-fix-native-continuation-runtime-model-ack/proposal.md) — historical archive index backfill
- [`2026-07-28-fix-native-provider-model-picker`](2026-07-28-fix-native-provider-model-picker/proposal.md) — historical archive index backfill
- [`2026-07-28-fix-provider-continuation-header-collapse`](2026-07-28-fix-provider-continuation-header-collapse/proposal.md) — historical archive index backfill
- [`2026-07-28-fix-shared-provider-picker-accordion-focus`](2026-07-28-fix-shared-provider-picker-accordion-focus/proposal.md) — historical archive index backfill
- [`2026-07-28-fix-shared-provider-picker-focus-stall`](2026-07-28-fix-shared-provider-picker-focus-stall/proposal.md) — historical archive index backfill
- [`2026-07-28-fix-shared-session-canvas-history-parity`](2026-07-28-fix-shared-session-canvas-history-parity/proposal.md) — historical archive index backfill
- [`2026-07-28-fix-shared-terminal-final-persistence`](2026-07-28-fix-shared-terminal-final-persistence/proposal.md) — historical archive index backfill
- [`2026-07-28-refine-provider-continuation-header-surface`](2026-07-28-refine-provider-continuation-header-surface/proposal.md) — historical archive index backfill
- [`2026-07-28-replace-shared-picker-with-stable-two-pane`](2026-07-28-replace-shared-picker-with-stable-two-pane/proposal.md) — historical archive index backfill
- [`2026-07-28-show-provider-continuation-source-excerpt`](2026-07-28-show-provider-continuation-source-excerpt/proposal.md) — historical archive index backfill
- [`2026-07-28-stabilize-provider-continuation-ux`](2026-07-28-stabilize-provider-continuation-ux/proposal.md) — historical archive index backfill

### 2026-07-27

- [`2026-07-27-assemble-shared-canonical-facts`](2026-07-27-assemble-shared-canonical-facts/proposal.md) — historical archive index backfill
- [`2026-07-27-establish-shared-event-storage`](2026-07-27-establish-shared-event-storage/proposal.md) — historical archive index backfill
- [`2026-07-27-isolate-claude-provider-runtimes-and-align-vendor-ui`](2026-07-27-isolate-claude-provider-runtimes-and-align-vendor-ui/proposal.md) — historical archive index backfill
- [`2026-07-27-project-shared-canonical-conversation`](2026-07-27-project-shared-canonical-conversation/proposal.md) — historical archive index backfill
- [`2026-07-27-expose-shared-projection-test-toggle`](2026-07-27-expose-shared-projection-test-toggle/proposal.md) — verified implementation，已同步 `shared-canonical-projection`；设置 → 其他设置新增默认关闭、可回滚的 Shared Projection 动态测试开关
- [`2026-07-27-improve-codex-provider-protocol-error`](2026-07-27-improve-codex-provider-protocol-error/proposal.md) — verified implementation，已同步 `codex-provider-scoped-session-launch` 与新增 `frontend-error-feedback`；Codex managed provider 非法 TOML/unsupported wire protocol 使用本地化 global Error Toast，renderer production code 禁止 native Alert

### 2026-07-26

- [`2026-07-26-align-engine-runtime-capability-contract`](2026-07-26-align-engine-runtime-capability-contract/proposal.md) — historical archive index backfill
- [`2026-07-26-cache-message-search-index`](2026-07-26-cache-message-search-index/proposal.md) — historical archive index backfill
- [`2026-07-26-converge-model-provider-catalog-runtime`](2026-07-26-converge-model-provider-catalog-runtime/proposal.md) — historical archive index backfill
- [`2026-07-26-define-engine-adapter-protocol-registry`](2026-07-26-define-engine-adapter-protocol-registry/proposal.md) — historical archive index backfill
- [`2026-07-26-define-engine-message-delivery-semantics`](2026-07-26-define-engine-message-delivery-semantics/proposal.md) — historical archive index backfill
- [`2026-07-26-enforce-opencode-soft-retirement-boundary`](2026-07-26-enforce-opencode-soft-retirement-boundary/proposal.md) — historical archive index backfill
- [`2026-07-26-establish-executable-session-registry`](2026-07-26-establish-executable-session-registry/proposal.md) — historical archive index backfill
- [`2026-07-26-establish-logical-session-runtime-identity`](2026-07-26-establish-logical-session-runtime-identity/proposal.md) — historical archive index backfill
- [`2026-07-26-establish-unified-engine-event-bus`](2026-07-26-establish-unified-engine-event-bus/proposal.md) — historical archive index backfill
- [`2026-07-26-fix-retired-opencode-session-hydration`](2026-07-26-fix-retired-opencode-session-hydration/proposal.md) — historical archive index backfill
- [`2026-07-26-harden-claude-provider-management`](2026-07-26-harden-claude-provider-management/proposal.md) — historical archive index backfill
- [`2026-07-26-harden-kimi-engine-governance`](2026-07-26-harden-kimi-engine-governance/proposal.md) — historical archive index backfill
- [`2026-07-26-harden-per-session-provider-selection-review-findings`](2026-07-26-harden-per-session-provider-selection-review-findings/proposal.md) — historical archive index backfill
- [`2026-07-26-migrate-engine-controller-facade`](2026-07-26-migrate-engine-controller-facade/proposal.md) — historical archive index backfill
- [`2026-07-26-redesign-git-commit-composer`](2026-07-26-redesign-git-commit-composer/proposal.md) — historical archive index backfill
- [`2026-07-26-remove-generated-worktree-branch-default`](2026-07-26-remove-generated-worktree-branch-default/proposal.md) — historical archive index backfill
- [`2026-07-26-unify-per-session-provider-selection`](2026-07-26-unify-per-session-provider-selection/proposal.md) — historical archive index backfill
- [`2026-07-26-fix-file-document-loading-error-stuck-state`](2026-07-26-fix-file-document-loading-error-stuck-state/proposal.md) — verified implementation，已同步 `file-document-loading-error-surface`；Windows manual gate 经 product owner 明确授权 waived

### 2026-07-25

- [`2026-07-25-add-terminal-search-and-web-links`](2026-07-25-add-terminal-search-and-web-links/proposal.md) — historical archive index backfill
- [`2026-07-25-modularize-git-file-and-diff-surfaces`](2026-07-25-modularize-git-file-and-diff-surfaces/proposal.md) — historical archive index backfill
- [`2026-07-25-restore-git-history-type-safety`](2026-07-25-restore-git-history-type-safety/proposal.md) — historical archive index backfill
- [`2026-07-25-separate-markdown-preview-renderer-boundaries`](2026-07-25-separate-markdown-preview-renderer-boundaries/proposal.md) — historical archive index backfill
- [`2026-07-25-stabilize-code-annotation-anchors`](2026-07-25-stabilize-code-annotation-anchors/proposal.md) — historical archive index backfill

### 2026-07-24

- [`2026-07-24-close-cleanup-review-findings`](2026-07-24-close-cleanup-review-findings/proposal.md) — verified correction pass，已同步 composer completion、semantic review 与 settings/workspaces corruption recovery contracts
- [`2026-07-24-add-agency-agent-catalog`](2026-07-24-add-agency-agent-catalog/proposal.md) — verified implementation，已同步 `curated-agent-catalog` 与 `settings-navigation-consolidation`
- [`2026-07-24-align-kanban-codex-model-catalog`](2026-07-24-align-kanban-codex-model-catalog/proposal.md) — verified implementation，已同步 `codex-model-catalog-coverage`
- [`2026-07-24-derive-rate-limit-label-from-window-duration`](2026-07-24-derive-rate-limit-label-from-window-duration/proposal.md) — verified implementation，已同步 `codex-chat-canvas-usage-overview`
- [`2026-07-24-soften-git-pr-range-gate`](2026-07-24-soften-git-pr-range-gate/proposal.md) — verified implementation，已同步 `git-history-panel`、`git-operations` 与 `git-pr-submission-workflow`
- [`2026-07-24-add-kimi-engine`](2026-07-24-add-kimi-engine/proposal.md) — verified implementation，已同步 `kimi-engine-runtime`
- [`2026-07-24-fix-agent-catalog-startup-convergence`](2026-07-24-fix-agent-catalog-startup-convergence/proposal.md) — verified implementation，已同步 `agent-startup-selection-stability`
- [`2026-07-24-unify-source-aware-note-capture-workbench`](2026-07-24-unify-source-aware-note-capture-workbench/proposal.md) — verified implementation，已同步 `workspace-note-card-pool`、`workspace-note-card-storage` 与 `workspace-note-context-capture`
- [`2026-07-24-add-pr-ai-title-body-generator`](2026-07-24-add-pr-ai-title-body-generator/proposal.md) — verified implementation，已同步 `git-history-panel`、`git-pr-submission-workflow` 与 `pr-ai-content-generation`
- [`2026-07-24-fix-claude-cli-native-installer`](2026-07-24-fix-claude-cli-native-installer/proposal.md) — verified implementation，已同步 `cli-one-click-installer`
- [`2026-07-24-add-file-editor-goto-line-shortcut`](2026-07-24-add-file-editor-goto-line-shortcut/proposal.md) — verified implementation，已同步 `file-editor-line-navigation` 与 `file-editor-tab-strip`
- [`2026-07-24-restore-git-history-branch-tree-capabilities`](2026-07-24-restore-git-history-branch-tree-capabilities/proposal.md) — verified implementation，已同步 `git-history-panel`
- [`2026-07-24-move-file-history-into-git-graph-tabs`](2026-07-24-move-file-history-into-git-graph-tabs/proposal.md) — verified implementation，已同步 `file-history-view` 与 `git-history-panel`
- [`2026-07-24-fix-codex-subagent-live-sidebar-convergence`](2026-07-24-fix-codex-subagent-live-sidebar-convergence/proposal.md) — verified implementation，已同步 `subagent-session-tree-navigation`
- [`2026-07-24-add-composer-prompt-enhancer-entry`](2026-07-24-add-composer-prompt-enhancer-entry/proposal.md) — verified implementation，已同步 `composer-prompt-enhancer`
- [`2026-07-24-add-file-context-menu-shortcuts`](2026-07-24-add-file-context-menu-shortcuts/proposal.md) — verified implementation，已同步 `app-shortcuts` 与 `filetree-multitab-open`
- [`2026-07-24-fix-messages-core-update-depth-loop`](2026-07-24-fix-messages-core-update-depth-loop/proposal.md) — verified implementation，已同步 `client-renderer-stability-under-pressure`
- [`2026-07-24-add-git-diff-section-line-count-badge`](2026-07-24-add-git-diff-section-line-count-badge/proposal.md) — verified implementation，已同步 `git-panel-diff-view` 与 `multi-repository-git-commit-workspace`
- [`2026-07-24-enable-file-history-resizable-pane-and-diff-horizontal-scroll`](2026-07-24-enable-file-history-resizable-pane-and-diff-horizontal-scroll/proposal.md) — verified implementation，已同步 `file-history-view` 与 `git-panel-diff-view`
- [`2026-07-24-add-extensions-management-surface`](2026-07-24-add-extensions-management-surface/proposal.md) — verified implementation，已同步 `extensions-management-surface`
- [`2026-07-24-remove-legacy-composer-input-implementation`](2026-07-24-remove-legacy-composer-input-implementation/proposal.md) — verified dead-code removal，未修改 capability specs
- [`2026-07-24-remove-parallel-orphan-module`](2026-07-24-remove-parallel-orphan-module/proposal.md) — verified orphan-module removal，未修改 capability specs
- [`2026-07-24-remove-search-workspace-indexing-layer`](2026-07-24-remove-search-workspace-indexing-layer/proposal.md) — verified dead-code removal，未修改 capability specs
- [`2026-07-24-remove-project-map-orchestration-center`](2026-07-24-remove-project-map-orchestration-center/proposal.md) — verified implementation，已移除 `agent-task-orchestration-center` main capability spec
- [`2026-07-24-fix-engine-attribution-and-model-id-validation`](2026-07-24-fix-engine-attribution-and-model-id-validation/proposal.md) — verified implementation，已同步 `engine-task-output-inspector` 与 `composer-model-selector-config-actions`
- [`2026-07-24-preserve-corrupted-app-settings-on-load`](2026-07-24-preserve-corrupted-app-settings-on-load/proposal.md) — verified implementation，已同步 `app-settings-corruption-recovery`
- [`2026-07-24-notify-settings-recovery-after-corruption`](2026-07-24-notify-settings-recovery-after-corruption/proposal.md) — verified implementation，已同步 `app-settings-corruption-recovery`：quarantine 记录一次性 recovery notice，前端加载成功后弹一次本地化 toast
- [`2026-07-24-remove-settings-view-ts-nocheck-and-skills-dead-branch`](2026-07-24-remove-settings-view-ts-nocheck-and-skills-dead-branch/proposal.md) — verified implementation，已同步 `settings-view-type-safety`
- [`2026-07-24-remove-jcef-bridge-noop-stubs`](2026-07-24-remove-jcef-bridge-noop-stubs/proposal.md) — verified dead-code removal，未修改 capability specs
- [`2026-07-24-remove-latest-agent-runs-dead-chain`](2026-07-24-remove-latest-agent-runs-dead-chain/proposal.md) — verified dead-code removal，未修改 capability specs
- [`2026-07-24-inline-refresh-codex-model-config-passthrough`](2026-07-24-inline-refresh-codex-model-config-passthrough/proposal.md) — verified dead-code removal，未修改 capability specs
- [`2026-07-24-remove-responsive-layout-dead-branches`](2026-07-24-remove-responsive-layout-dead-branches/proposal.md) — verified dead-code removal，未修改 capability specs
- [`2026-07-24-remove-settings-view-dead-entry-switches`](2026-07-24-remove-settings-view-dead-entry-switches/proposal.md) — verified dead-code removal，未修改 capability specs
- [`2026-07-24-remove-orchestration-residual-dead-fields`](2026-07-24-remove-orchestration-residual-dead-fields/proposal.md) — verified dead-code removal，未修改 capability specs
- [`2026-07-24-remove-dock-streaming-dead-branch`](2026-07-24-remove-dock-streaming-dead-branch/proposal.md) — verified implementation，已同步 `global-runtime-notice-dock`
- [`2026-07-24-add-ai-review-producer-wiring`](2026-07-24-add-ai-review-producer-wiring/proposal.md) — verified implementation，已同步 `git-panel-diff-view`
- [`2026-07-24-preserve-corrupted-workspaces-on-load-and-notify`](2026-07-24-preserve-corrupted-workspaces-on-load-and-notify/proposal.md) — verified implementation，已同步 `workspaces-corruption-recovery`：`workspaces.json` 损坏时先隔离备份再回退空列表，quarantine 记录一次性 recovery notice，前端挂载后弹一次本地化 toast

### 2026-07-23

- [`2026-07-23-enhance-session-activity-panels`](2026-07-23-enhance-session-activity-panels/proposal.md) — verified implementation，已同步 `codex-chat-canvas-workspace-session-activity-panel`
- [`2026-07-23-enhance-quick-switcher-hub`](2026-07-23-enhance-quick-switcher-hub/proposal.md) — verified implementation，已同步 `quick-context-switcher`
- [`2026-07-23-enhance-quick-switcher-nav-toggle`](2026-07-23-enhance-quick-switcher-nav-toggle/proposal.md) — verified implementation，已同步 `quick-context-switcher`
- [`2026-07-23-add-theme-aware-syntax-and-diff-tokens`](2026-07-23-add-theme-aware-syntax-and-diff-tokens/proposal.md) — verified implementation，已同步 `settings-custom-theme-presets`
- [`2026-07-23-fix-multi-repository-git-inline-diff-scope`](2026-07-23-fix-multi-repository-git-inline-diff-scope/proposal.md) — verified implementation，已同步 `multi-repository-git-commit-workspace` 与 `multi-repository-git-command-center`
- [`2026-07-23-add-python-go-semantic-navigation`](2026-07-23-add-python-go-semantic-navigation/proposal.md) — verified implementation，已同步 `file-view-code-intelligence-navigation`
- [`2026-07-23-add-file-editor-navigation-history`](2026-07-23-add-file-editor-navigation-history/proposal.md) — verified implementation，已同步 `file-view-code-intelligence-navigation`
- [`2026-07-23-add-quick-switcher`](2026-07-23-add-quick-switcher/proposal.md) — verified implementation，已同步 `quick-context-switcher`
- [`2026-07-23-fix-cold-start-update-depth-loop`](2026-07-23-fix-cold-start-update-depth-loop/proposal.md) — verified implementation，已同步 `client-renderer-stability-under-pressure`
- [`2026-07-23-fix-dark-collapsed-sidebar-theme`](2026-07-23-fix-dark-collapsed-sidebar-theme/proposal.md) — verified implementation，已同步 `workspace-sidebar-visual-harmony`
- [`2026-07-23-fix-file-editor-navigation-viewport-restore`](2026-07-23-fix-file-editor-navigation-viewport-restore/proposal.md) — verified implementation，已同步 `file-view-code-intelligence-navigation`
- [`2026-07-23-fix-quick-switcher-file-activation-main-area`](2026-07-23-fix-quick-switcher-file-activation-main-area/proposal.md) — verified implementation，已同步 `quick-context-switcher`
- [`2026-07-23-stabilize-semantic-navigation-lifecycle`](2026-07-23-stabilize-semantic-navigation-lifecycle/proposal.md) — verified implementation，已同步 `file-view-code-intelligence-navigation` 与 `semantic-code-navigation-provider`

### 2026-07-22

- [`2026-07-22-add-open-file-reveal-in-tree`](2026-07-22-add-open-file-reveal-in-tree/proposal.md) — verified implementation，已同步 `filetree-multitab-open` 与 `independent-file-explorer-workspace`
- [`2026-07-22-fix-agent-completion-selection-index-alignment`](2026-07-22-fix-agent-completion-selection-index-alignment/proposal.md) — verified implementation，已同步 `composer-file-reference-completion-stability`
- [`2026-07-22-fix-multi-runtime-npm-cli-discovery`](2026-07-22-fix-multi-runtime-npm-cli-discovery/proposal.md) — verified implementation，已同步 `semantic-code-navigation-provider`
- [`2026-07-22-fix-symlinked-npm-cli-discovery`](2026-07-22-fix-symlinked-npm-cli-discovery/proposal.md) — verified implementation，已同步 `semantic-code-navigation-provider`
- [`2026-07-22-add-java-typescript-semantic-navigation`](2026-07-22-add-java-typescript-semantic-navigation/proposal.md) — verified implementation，已同步 `file-view-code-intelligence-navigation` 与 `semantic-code-navigation-provider`
- [`2026-07-22-add-multi-repository-git-history-branch-tree`](2026-07-22-add-multi-repository-git-history-branch-tree/proposal.md) — verified implementation，已同步 `git-history-panel`
- [`2026-07-22-add-platform-language-server-install-hints`](2026-07-22-add-platform-language-server-install-hints/proposal.md) — verified implementation，已同步 `file-view-code-intelligence-navigation`
- [`2026-07-22-compact-file-editor-context-menu`](2026-07-22-compact-file-editor-context-menu/proposal.md) — verified implementation，已同步 `client-scrollbar-visual-consistency`
- [`2026-07-22-enhance-global-search-and-editor-selection`](2026-07-22-enhance-global-search-and-editor-selection/proposal.md) — verified implementation，已同步 `app-shortcuts`、`global-search-action-discovery` 与 `global-search-result-presentation`
- [`2026-07-22-expose-expand-selection-context-menu`](2026-07-22-expose-expand-selection-context-menu/proposal.md) — verified implementation，已同步 `app-shortcuts` 与 `client-scrollbar-visual-consistency`
- [`2026-07-22-fix-editor-navigation-affordances`](2026-07-22-fix-editor-navigation-affordances/proposal.md) — verified implementation，已同步 `app-shortcuts` 与 `file-view-code-intelligence-navigation`
- [`2026-07-22-fix-file-editor-git-marker-load-race`](2026-07-22-fix-file-editor-git-marker-load-race/proposal.md) — verified implementation，已同步 `file-open-rendering-scheduler`
- [`2026-07-22-fix-language-server-discovery-and-install-retry`](2026-07-22-fix-language-server-discovery-and-install-retry/proposal.md) — verified implementation，已同步 `file-view-code-intelligence-navigation` 与 `semantic-code-navigation-provider`
- [`2026-07-22-integrate-file-note-and-git-context-actions`](2026-07-22-integrate-file-note-and-git-context-actions/proposal.md) — verified implementation，已同步 `filetree-multitab-open`
- [`2026-07-22-move-file-toolbar-actions-to-context-menu`](2026-07-22-move-file-toolbar-actions-to-context-menu/proposal.md) — verified implementation，已同步 `filetree-multitab-open`
- [`2026-07-22-redesign-file-tab-context-menu`](2026-07-22-redesign-file-tab-context-menu/proposal.md) — verified implementation，已同步 `filetree-multitab-open`
- [`2026-07-22-replace-language-server-fallback-with-install-guidance`](2026-07-22-replace-language-server-fallback-with-install-guidance/proposal.md) — verified implementation，已同步 `file-view-code-intelligence-navigation` 与 `semantic-code-navigation-provider`
- [`2026-07-22-upgrade-semantic-code-navigation`](2026-07-22-upgrade-semantic-code-navigation/proposal.md) — verified implementation，已同步 `file-view-code-intelligence-navigation` 与 `semantic-code-navigation-provider`

### 2026-07-21

- [`2026-07-21-add-mermaid-fullscreen-png-download`](2026-07-21-add-mermaid-fullscreen-png-download/proposal.md) — verified implementation，已同步 `markdown-mermaid-block-fullscreen-viewer`
- [`2026-07-21-add-multi-repository-global-git-actions`](2026-07-21-add-multi-repository-global-git-actions/proposal.md) — verified implementation，已同步 `git-branch-management` 与 `multi-repository-git-command-center`
- [`2026-07-21-decompose-generic-tool-presentation`](2026-07-21-decompose-generic-tool-presentation/proposal.md) — verified implementation，已同步 `generic-tool-presentation`
- [`2026-07-21-enforce-messages-final-boundaries`](2026-07-21-enforce-messages-final-boundaries/proposal.md) — verified implementation，已同步 `messages-final-boundary-enforcement`
- [`2026-07-21-fix-mermaid-png-native-save`](2026-07-21-fix-mermaid-png-native-save/proposal.md) — verified implementation，已同步 `markdown-mermaid-block-fullscreen-viewer`
- [`2026-07-21-fix-message-row-context-and-media-scope`](2026-07-21-fix-message-row-context-and-media-scope/proposal.md) — verified implementation，已同步 `messages-row-correctness`
- [`2026-07-21-fix-shortcut-persistence-and-add-common-modules`](2026-07-21-fix-shortcut-persistence-and-add-common-modules/proposal.md) — verified implementation，已同步 `app-shortcuts`
- [`2026-07-21-harden-messages-module-boundaries`](2026-07-21-harden-messages-module-boundaries/proposal.md) — verified implementation，已同步 `messages-module-boundaries`
- [`2026-07-21-isolate-message-row-owners`](2026-07-21-isolate-message-row-owners/proposal.md) — verified implementation，已同步 `message-row-ownership`
- [`2026-07-21-isolate-messages-orchestration-controller`](2026-07-21-isolate-messages-orchestration-controller/proposal.md) — verified implementation，已同步 `messages-orchestration-ownership`
- [`2026-07-21-isolate-messages-timeline-controller`](2026-07-21-isolate-messages-timeline-controller/proposal.md) — verified implementation，已同步 `messages-timeline-ownership`
- [`2026-07-21-normalize-conversation-presentation-context`](2026-07-21-normalize-conversation-presentation-context/proposal.md) — verified implementation，已同步 `conversation-presentation-context-normalization`
- [`2026-07-21-promote-shared-markdown-renderer`](2026-07-21-promote-shared-markdown-renderer/proposal.md) — verified implementation，已同步 `shared-markdown-renderer`
- [`2026-07-21-refactor-messages-presentation-architecture`](2026-07-21-refactor-messages-presentation-architecture/proposal.md) — verified implementation，已同步 `messages-presentation-architecture`
- [`2026-07-21-relocate-shared-message-domain-helpers`](2026-07-21-relocate-shared-message-domain-helpers/proposal.md) — verified implementation，已同步 `shared-message-domain-helpers`
- [`2026-07-21-stabilize-git-history-cross-platform-ordering`](2026-07-21-stabilize-git-history-cross-platform-ordering/proposal.md) — verified implementation，已同步 `git-history-panel`
- [`2026-07-21-stabilize-messages-public-input`](2026-07-21-stabilize-messages-public-input/proposal.md) — verified implementation，已同步 `messages-public-input`

### 2026-07-20

- [`2026-07-20-add-caveman-curated-skill-bundle`](2026-07-20-add-caveman-curated-skill-bundle/proposal.md) — verified implementation，已同步 main spec
- [`2026-07-20-align-codex-context-indicator-footer`](2026-07-20-align-codex-context-indicator-footer/proposal.md) — verified implementation，已同步 `composer-context-dual-view`
- [`2026-07-20-unify-composer-submit-button-size`](2026-07-20-unify-composer-submit-button-size/proposal.md) — verified implementation，已同步 `composer-control-surface`

### 2026-07-19

- [`2026-07-19-fix-mermaid-fullscreen-svg-serialization`](2026-07-19-fix-mermaid-fullscreen-svg-serialization/proposal.md) — verified implementation，已同步 `markdown-mermaid-block-fullscreen-viewer`
- [`2026-07-19-harden-mermaid-fullscreen-normalization-runtime`](2026-07-19-harden-mermaid-fullscreen-normalization-runtime/proposal.md) — verified implementation，已同步 `markdown-mermaid-block-fullscreen-viewer`

### 2026-07-18

- [`2026-07-18-2026-06-24-infer-thread-rename-from-claude-codex-jsonl`](2026-07-18-2026-06-24-infer-thread-rename-from-claude-codex-jsonl/proposal.md) — unimplemented/stale，未同步 delta specs
- [`2026-07-18-2026-06-24-retire-opencode-and-gemini-cli`](2026-07-18-2026-06-24-retire-opencode-and-gemini-cli/proposal.md) — superseded hard-delete plan，未同步 delta specs
- [`2026-07-18-2026-06-22-release-pipeline-cache-sccache`](2026-07-18-2026-06-22-release-pipeline-cache-sccache/proposal.md) — failed performance experiment，未同步 delta specs
- [`2026-07-18-add-askuserquestion-default-mode-mcp-bridge`](2026-07-18-add-askuserquestion-default-mode-mcp-bridge/proposal.md) — verified implementation，已同步 main specs
- [`2026-07-18-fix-sidebar-session-catalog-progressive-loading`](2026-07-18-fix-sidebar-session-catalog-progressive-loading/proposal.md) — automated evidence closure，已同步 main specs
- [`2026-07-18-harden-conversation-rendering-for-large-history`](2026-07-18-harden-conversation-rendering-for-large-history/proposal.md) — product-owner acceptance waiver，已同步 main specs
- [`2026-07-18-optimize-conversation-streaming-render-perf`](2026-07-18-optimize-conversation-streaming-render-perf/proposal.md) — duplicate trace waived，已同步 main specs
- [`2026-07-18-redesign-workspace-sidebar-session-loading`](2026-07-18-redesign-workspace-sidebar-session-loading/proposal.md) — automated evidence closure，已同步 main specs
- [`2026-07-18-fix-git-renamed-deleted-file-path-identity`](2026-07-18-fix-git-renamed-deleted-file-path-identity/proposal.md) — verified implementation，已同步 `git-working-tree-change-path-identity`
- [`2026-07-18-refine-git-graph-menu-entry`](2026-07-18-refine-git-graph-menu-entry/proposal.md) — verified implementation，已同步 `git-panel-diff-view`

### 2026-07-17

- [`2026-07-17-add-api-endpoint-global-search`](2026-07-17-add-api-endpoint-global-search/proposal.md)
- [`2026-07-17-add-claude-runtime-mcp-servers-panel`](2026-07-17-add-claude-runtime-mcp-servers-panel/proposal.md)
- [`2026-07-17-add-file-history-view`](2026-07-17-add-file-history-view/proposal.md)
- [`2026-07-17-add-file-view-git-blame`](2026-07-17-add-file-view-git-blame/proposal.md)
- [`2026-07-17-add-git-diff-file-history-context-action`](2026-07-17-add-git-diff-file-history-context-action/proposal.md)
- [`2026-07-17-add-git-history-commit-filters`](2026-07-17-add-git-history-commit-filters/proposal.md)
- [`2026-07-17-add-multi-repository-git-command-center`](2026-07-17-add-multi-repository-git-command-center/proposal.md)
- [`2026-07-17-add-multi-repository-git-commit-workspace`](2026-07-17-add-multi-repository-git-commit-workspace/proposal.md)
- [`2026-07-17-add-turn-file-summary-modal-diff-preview`](2026-07-17-add-turn-file-summary-modal-diff-preview/proposal.md)
- [`2026-07-17-align-codex-model-reasoning-capabilities`](2026-07-17-align-codex-model-reasoning-capabilities/proposal.md)
- [`2026-07-17-compact-git-history-changed-file-tree`](2026-07-17-compact-git-history-changed-file-tree/proposal.md)
- [`2026-07-17-enhance-git-history-author-timeline-colors`](2026-07-17-enhance-git-history-author-timeline-colors/proposal.md)
- [`2026-07-17-explain-git-pull-option-effects`](2026-07-17-explain-git-pull-option-effects/proposal.md)
- [`2026-07-17-fallback-untracked-added-file-empty-inline-diff`](2026-07-17-fallback-untracked-added-file-empty-inline-diff/proposal.md)
- [`2026-07-17-fix-codex-pending-draft-history-loading`](2026-07-17-fix-codex-pending-draft-history-loading/proposal.md)
- [`2026-07-17-fix-codex-subagent-sidebar-projection`](2026-07-17-fix-codex-subagent-sidebar-projection/proposal.md)
- [`2026-07-17-fix-codex-thread-start-continuity-and-recovery`](2026-07-17-fix-codex-thread-start-continuity-and-recovery/proposal.md)
- [`2026-07-17-fix-global-file-search-hydration`](2026-07-17-fix-global-file-search-hydration/proposal.md)
- [`2026-07-17-fix-large-file-editable-diff-alignment`](2026-07-17-fix-large-file-editable-diff-alignment/proposal.md)
- [`2026-07-17-fix-multi-repository-file-open-and-blame-scope`](2026-07-17-fix-multi-repository-file-open-and-blame-scope/proposal.md)
- [`2026-07-17-fix-multi-repository-file-tree-decorations`](2026-07-17-fix-multi-repository-file-tree-decorations/proposal.md)
- [`2026-07-17-fix-multi-repository-git-preview-density`](2026-07-17-fix-multi-repository-git-preview-density/proposal.md)
- [`2026-07-17-fix-sidebar-radix-presence-version-convergence`](2026-07-17-fix-sidebar-radix-presence-version-convergence/proposal.md)
- [`2026-07-17-fix-workspace-drop-overlay-leave-settlement`](2026-07-17-fix-workspace-drop-overlay-leave-settlement/proposal.md)
- [`2026-07-17-hide-diff-repository-switch-and-fix-multi-repo-collapse`](2026-07-17-hide-diff-repository-switch-and-fix-multi-repo-collapse/proposal.md)
- [`2026-07-17-hide-git-history-overview-pane`](2026-07-17-hide-git-history-overview-pane/proposal.md)
- [`2026-07-17-refine-git-history-title-layer-frame`](2026-07-17-refine-git-history-title-layer-frame/proposal.md)
- [`2026-07-17-relocate-git-diff-mode-selector-to-right-panel-toolbar`](2026-07-17-relocate-git-diff-mode-selector-to-right-panel-toolbar/proposal.md)
- [`2026-07-17-restore-multi-repository-discard-action`](2026-07-17-restore-multi-repository-discard-action/proposal.md)
- [`2026-07-17-restore-multi-repository-status-refresh`](2026-07-17-restore-multi-repository-status-refresh/proposal.md)
- [`2026-07-17-stabilize-git-command-center-branch-menu`](2026-07-17-stabilize-git-command-center-branch-menu/proposal.md)
- [`2026-07-17-unify-git-diff-file-context-menu-actions`](2026-07-17-unify-git-diff-file-context-menu-actions/proposal.md)
- [`2026-07-17-unify-git-file-list-and-preview-modal`](2026-07-17-unify-git-file-list-and-preview-modal/proposal.md)

### 2026-07-15

- [`2026-07-15-add-downloadable-web-assets`](2026-07-15-add-downloadable-web-assets/proposal.md)
- [`2026-07-15-align-codex-message-rendering-with-official`](2026-07-15-align-codex-message-rendering-with-official/proposal.md)
- [`2026-07-15-fix-app-shell-composer-startup-convergence`](2026-07-15-fix-app-shell-composer-startup-convergence/proposal.md)
- [`2026-07-15-fix-codex-settled-turn-loading-revival`](2026-07-15-fix-codex-settled-turn-loading-revival/proposal.md)
- [`2026-07-15-fix-message-math-container-prefix`](2026-07-15-fix-message-math-container-prefix/proposal.md)
- [`2026-07-15-fix-messages-scroll-anchor-update-loop`](2026-07-15-fix-messages-scroll-anchor-update-loop/proposal.md)
- [`2026-07-15-fix-radix-select-popup-webview-zoom`](2026-07-15-fix-radix-select-popup-webview-zoom/proposal.md)
- [`2026-07-15-fix-sidebar-scroll-area-react19-ref-loop`](2026-07-15-fix-sidebar-scroll-area-react19-ref-loop/proposal.md)
- [`2026-07-15-fix-sidebar-thread-row-provider-startup-loop`](2026-07-15-fix-sidebar-thread-row-provider-startup-loop/proposal.md)
- [`2026-07-15-fix-tooltip-startup-update-loop`](2026-07-15-fix-tooltip-startup-update-loop/proposal.md)
- [`2026-07-15-fix-user-fork-sidebar-visibility`](2026-07-15-fix-user-fork-sidebar-visibility/proposal.md)
- [`2026-07-15-group-global-search-results`](2026-07-15-group-global-search-results/proposal.md)
- [`2026-07-15-harden-message-compact-display-math-boundaries`](2026-07-15-harden-message-compact-display-math-boundaries/proposal.md)
- [`2026-07-15-reduce-idle-chrome-render-cost`](2026-07-15-reduce-idle-chrome-render-cost/proposal.md)
- [`2026-07-15-restore-added-file-diff-access`](2026-07-15-restore-added-file-diff-access/proposal.md)
- [`2026-07-15-retro-weekly-code-change-spec-coverage-2026-07-15`](2026-07-15-retro-weekly-code-change-spec-coverage-2026-07-15/proposal.md)
- [`2026-07-15-unify-conversation-scroll-bottom-convergence`](2026-07-15-unify-conversation-scroll-bottom-convergence/proposal.md)

### 2026-07-11

- [`2026-07-11-add-browser-page-selector-and-window-sizing`](2026-07-11-add-browser-page-selector-and-window-sizing/proposal.md)
- [`2026-07-11-add-filetree-root-header-actions`](2026-07-11-add-filetree-root-header-actions/proposal.md)
- [`2026-07-11-add-idea-style-editable-workspace-diff`](2026-07-11-add-idea-style-editable-workspace-diff/proposal.md)
- [`2026-07-11-add-message-anchor-bottom-jump`](2026-07-11-add-message-anchor-bottom-jump/proposal.md)
- [`2026-07-11-add-workspace-file-compare-tool`](2026-07-11-add-workspace-file-compare-tool/proposal.md)
- [`2026-07-11-fix-claude-manual-compact-wall-clock-cap`](2026-07-11-fix-claude-manual-compact-wall-clock-cap/proposal.md)
- [`2026-07-11-fix-client-store-bloat-and-write-cost`](2026-07-11-fix-client-store-bloat-and-write-cost/proposal.md)
- [`2026-07-11-fix-codex-startup-cli-probe`](2026-07-11-fix-codex-startup-cli-probe/proposal.md)
- [`2026-07-11-fix-diagnostics-idle-cpu-storm`](2026-07-11-fix-diagnostics-idle-cpu-storm/proposal.md)
- [`2026-07-11-fix-editor-file-maximize-and-workspace-file-tabs`](2026-07-11-fix-editor-file-maximize-and-workspace-file-tabs/proposal.md)
- [`2026-07-11-fix-git-diff-stats-display`](2026-07-11-fix-git-diff-stats-display/proposal.md)
- [`2026-07-11-fix-live-auto-follow-rearm-scroll`](2026-07-11-fix-live-auto-follow-rearm-scroll/proposal.md)
- [`2026-07-11-fix-non-git-diff-scan-noise`](2026-07-11-fix-non-git-diff-scan-noise/proposal.md)
- [`2026-07-11-fix-streaming-conversation-jank`](2026-07-11-fix-streaming-conversation-jank/proposal.md)
- [`2026-07-11-fix-windows-titlebar-drag-latency`](2026-07-11-fix-windows-titlebar-drag-latency/proposal.md)
- [`2026-07-11-ratchet-large-file-new-files`](2026-07-11-ratchet-large-file-new-files/proposal.md)
- [`2026-07-11-reduce-idle-chrome-render-cost`](2026-07-11-reduce-idle-chrome-render-cost/proposal.md)
- [`2026-07-11-restore-git-switch-in-diff-menu`](2026-07-11-restore-git-switch-in-diff-menu/proposal.md)

### 2026-07-10

- [`2026-07-10-optimize-note-cards-workbench-ux`](2026-07-10-optimize-note-cards-workbench-ux/proposal.md)
- [`2026-07-10-refactor-note-cards-center-workbench`](2026-07-10-refactor-note-cards-center-workbench/proposal.md)

### 2026-07-09

- [`2026-07-09-externalize-live-assistant-text-channel`](2026-07-09-externalize-live-assistant-text-channel/proposal.md)
- [`2026-07-09-fix-live-bottom-follow-scroll-control`](2026-07-09-fix-live-bottom-follow-scroll-control/proposal.md)

### 2026-07-05

- [`2026-07-05-fix-codex-app-server-curated-skill-transport`](2026-07-05-fix-codex-app-server-curated-skill-transport/proposal.md)
- [`2026-07-05-fix-messages-react-update-depth-loop`](2026-07-05-fix-messages-react-update-depth-loop/proposal.md)
- [`2026-07-05-fix-windows-chat-stream-final-only-regression`](2026-07-05-fix-windows-chat-stream-final-only-regression/proposal.md)
- [`2026-07-05-fix-windows-claude-stream-json-history-pollution`](2026-07-05-fix-windows-claude-stream-json-history-pollution/proposal.md)
- [`2026-07-05-fix-windows-claude-stream-json-stdin-prompt`](2026-07-05-fix-windows-claude-stream-json-stdin-prompt/proposal.md)
- [`2026-07-05-fix-windows-codex-wrapper-curated-instructions`](2026-07-05-fix-windows-codex-wrapper-curated-instructions/proposal.md)
- [`2026-07-05-harden-codex-disk-session-readiness-and-error-copy`](2026-07-05-harden-codex-disk-session-readiness-and-error-copy/proposal.md)
- [`2026-07-05-remove-inline-message-copy-actions`](2026-07-05-remove-inline-message-copy-actions/proposal.md)
- [`2026-07-05-retro-claude-turn-settlement-and-stream-lifecycle`](2026-07-05-retro-claude-turn-settlement-and-stream-lifecycle/proposal.md)
- [`2026-07-05-retro-composer-engine-preferences-and-context-indicator`](2026-07-05-retro-composer-engine-preferences-and-context-indicator/proposal.md)
- [`2026-07-05-retro-composer-selector-and-home-chat-simplification`](2026-07-05-retro-composer-selector-and-home-chat-simplification/proposal.md)
- [`2026-07-05-retro-composer-tool-menu-and-primary-controls`](2026-07-05-retro-composer-tool-menu-and-primary-controls/proposal.md)
- [`2026-07-05-retro-conversation-streaming-merge-performance`](2026-07-05-retro-conversation-streaming-merge-performance/proposal.md)
- [`2026-07-05-retro-diagnostics-storage-and-agent-config`](2026-07-05-retro-diagnostics-storage-and-agent-config/proposal.md)
- [`2026-07-05-retro-header-sidebar-and-panel-navigation-chrome`](2026-07-05-retro-header-sidebar-and-panel-navigation-chrome/proposal.md)
- [`2026-07-05-retro-message-codeblock-and-filechange-rendering`](2026-07-05-retro-message-codeblock-and-filechange-rendering/proposal.md)
- [`2026-07-05-retro-message-reading-navigation-and-reasoning-ux`](2026-07-05-retro-message-reading-navigation-and-reasoning-ux/proposal.md)
- [`2026-07-05-retro-message-tool-marker-shell`](2026-07-05-retro-message-tool-marker-shell/proposal.md)
- [`2026-07-05-retro-react-scan-and-frame-diagnostics`](2026-07-05-retro-react-scan-and-frame-diagnostics/proposal.md)
- [`2026-07-05-retro-render-storm-and-background-polling-controls`](2026-07-05-retro-render-storm-and-background-polling-controls/proposal.md)
- [`2026-07-05-retro-search-release-notes-and-diff-polish`](2026-07-05-retro-search-release-notes-and-diff-polish/proposal.md)
- [`2026-07-05-retro-settings-surface-redesign-and-shortcuts`](2026-07-05-retro-settings-surface-redesign-and-shortcuts/proposal.md)
- [`2026-07-05-retro-shadcn-radix-zinc-design-system`](2026-07-05-retro-shadcn-radix-zinc-design-system/proposal.md)
- [`2026-07-05-retro-skills-menu-build-and-ci-maintenance`](2026-07-05-retro-skills-menu-build-and-ci-maintenance/proposal.md)
- [`2026-07-05-retro-typography-font-and-markdown-readability`](2026-07-05-retro-typography-font-and-markdown-readability/proposal.md)
- [`2026-07-05-retro-workspace-file-tree-and-right-panel-tabs`](2026-07-05-retro-workspace-file-tree-and-right-panel-tabs/proposal.md)

## 2026-06 (131)

### 2026-06-26

- [`2026-06-26-remove-sticky-user-bubble-curtain-bar`](2026-06-26-remove-sticky-user-bubble-curtain-bar/proposal.md)

### 2026-06-25

- [`2026-06-25-2026-06-24-curated-skill-always-on-simplification`](2026-06-25-2026-06-24-curated-skill-always-on-simplification/proposal.md)
- [`2026-06-25-2026-06-24-harden-realtime-interaction-jank-during-tool-call`](2026-06-25-2026-06-24-harden-realtime-interaction-jank-during-tool-call/proposal.md)
- [`2026-06-25-2026-06-25-composer-readiness-bar-indicator-layout`](2026-06-25-2026-06-25-composer-readiness-bar-indicator-layout/proposal.md)
- [`2026-06-25-externalize-active-canvas-state-selectors`](2026-06-25-externalize-active-canvas-state-selectors/proposal.md)
- [`2026-06-25-fix-history-canvas-lightweight-spacing`](2026-06-25-fix-history-canvas-lightweight-spacing/proposal.md)
- [`2026-06-25-harden-codex-disk-session-start-readiness`](2026-06-25-harden-codex-disk-session-start-readiness/proposal.md)
- [`2026-06-25-isolate-conversation-canvas-runtime`](2026-06-25-isolate-conversation-canvas-runtime/proposal.md)
- [`2026-06-25-shell-first-lazy-runtime-isolation`](2026-06-25-shell-first-lazy-runtime-isolation/proposal.md)

### 2026-06-24

- [`2026-06-24-2026-06-24-curated-skill-bundles`](2026-06-24-2026-06-24-curated-skill-bundles/proposal.md)
- [`2026-06-24-fix-codex-provider-composer-cold-start-binding`](2026-06-24-fix-codex-provider-composer-cold-start-binding/proposal.md)
- [`2026-06-24-fix-fast-markdown-annotation-action`](2026-06-24-fix-fast-markdown-annotation-action/proposal.md)

### 2026-06-23

- [`2026-06-23-fix-app-shell-startup-react-depth-loop`](2026-06-23-fix-app-shell-startup-react-depth-loop/proposal.md)
- [`2026-06-23-fix-codex-exec-command-file-change-replay`](2026-06-23-fix-codex-exec-command-file-change-replay/proposal.md)
- [`2026-06-23-fix-codex-provider-recovery-binding`](2026-06-23-fix-codex-provider-recovery-binding/proposal.md)
- [`2026-06-23-fix-message-outline-streaming-jank`](2026-06-23-fix-message-outline-streaming-jank/proposal.md)
- [`2026-06-23-fix-provider-model-catalog-and-codex-refresh-isolation`](2026-06-23-fix-provider-model-catalog-and-codex-refresh-isolation/proposal.md)
- [`2026-06-23-fix-user-input-stale-submit-settlement`](2026-06-23-fix-user-input-stale-submit-settlement/proposal.md)
- [`2026-06-23-refine-home-recent-conversations-ui`](2026-06-23-refine-home-recent-conversations-ui/proposal.md)
- [`2026-06-23-relocate-runtime-notice-dock-sidebar-entry`](2026-06-23-relocate-runtime-notice-dock-sidebar-entry/proposal.md)
- [`2026-06-23-soften-transient-runtime-reconnect-card`](2026-06-23-soften-transient-runtime-reconnect-card/proposal.md)

### 2026-06-22

- [`2026-06-22-add-image-fullscreen-and-messages-outline`](2026-06-22-add-image-fullscreen-and-messages-outline/proposal.md)
- [`2026-06-22-add-mermaid-block-fullscreen-viewer`](2026-06-22-add-mermaid-block-fullscreen-viewer/proposal.md)
- [`2026-06-22-improve-markdown-render-performance`](2026-06-22-improve-markdown-render-performance/proposal.md)

### 2026-06-21

- [`2026-06-21-add-claude-provider-management-order-and-model-fetch`](2026-06-21-add-claude-provider-management-order-and-model-fetch/proposal.md)
- [`2026-06-21-fix-codex-parallel-runtime-ended-isolation`](2026-06-21-fix-codex-parallel-runtime-ended-isolation/proposal.md)

### 2026-06-20

- [`2026-06-20-clean-up-perf-archive-readiness-debt`](2026-06-20-clean-up-perf-archive-readiness-debt/proposal.md)

### 2026-06-18

- [`2026-06-18-fix-disk-codex-empty-draft-fresh-replay`](2026-06-18-fix-disk-codex-empty-draft-fresh-replay/proposal.md)
- [`2026-06-18-fix-runtime-reconnect-card-state-loop`](2026-06-18-fix-runtime-reconnect-card-state-loop/proposal.md)
- [`2026-06-18-follow-up-v0511-large-file-cookbook-and-measured-evidence`](2026-06-18-follow-up-v0511-large-file-cookbook-and-measured-evidence/proposal.md)
- [`2026-06-18-measure-codex-first-delta-latency`](2026-06-18-measure-codex-first-delta-latency/proposal.md)
- [`2026-06-18-measure-codex-post-ack-first-delta-latency`](2026-06-18-measure-codex-post-ack-first-delta-latency/proposal.md)
- [`2026-06-18-measure-codex-turn-start-ack-latency`](2026-06-18-measure-codex-turn-start-ack-latency/proposal.md)
- [`2026-06-18-optimize-governance-sentry-noise-and-large-file-split`](2026-06-18-optimize-governance-sentry-noise-and-large-file-split/proposal.md)
- [`2026-06-18-reduce-message-row-render-amplification`](2026-06-18-reduce-message-row-render-amplification/proposal.md)
- [`2026-06-18-reduce-streaming-reducer-commit-lag`](2026-06-18-reduce-streaming-reducer-commit-lag/proposal.md)
- [`2026-06-18-reduce-turn-trace-batch-flush-lag`](2026-06-18-reduce-turn-trace-batch-flush-lag/proposal.md)
- [`2026-06-18-refactor-v0511-thread-messaging-recovery-and-streaming`](2026-06-18-refactor-v0511-thread-messaging-recovery-and-streaming/proposal.md)
- [`2026-06-18-v0511-performance-evidence-and-runtime-jank-hardening`](2026-06-18-v0511-performance-evidence-and-runtime-jank-hardening/proposal.md)

### 2026-06-17

- [`2026-06-17-app-shell-domain-context-isolation-2026-06`](2026-06-17-app-shell-domain-context-isolation-2026-06/proposal.md)
- [`2026-06-17-chat-stream-render-isolation-2026-06`](2026-06-17-chat-stream-render-isolation-2026-06/proposal.md)
- [`2026-06-17-stabilize-long-running-client-runtime-2026-06`](2026-06-17-stabilize-long-running-client-runtime-2026-06/proposal.md)
- [`2026-06-17-topbar-runtime-state-stability-2026-06`](2026-06-17-topbar-runtime-state-stability-2026-06/proposal.md)

### 2026-06-14

- [`2026-06-14-close-client-performance-residual-2026-06`](2026-06-14-close-client-performance-residual-2026-06/proposal.md)
- [`2026-06-14-close-performance-iteration-2026-06`](2026-06-14-close-performance-iteration-2026-06/proposal.md)
- [`2026-06-14-fix-app-server-event-channel-compat`](2026-06-14-fix-app-server-event-channel-compat/proposal.md)
- [`2026-06-14-fix-parallel-conversation-runtime-residuals-2026-06`](2026-06-14-fix-parallel-conversation-runtime-residuals-2026-06/proposal.md)
- [`2026-06-14-fix-progressive-reveal-runtime-residual-2026-06`](2026-06-14-fix-progressive-reveal-runtime-residual-2026-06/proposal.md)

### 2026-06-13

- [`2026-06-13-collect-release-grade-performance-evidence`](2026-06-13-collect-release-grade-performance-evidence/proposal.md)
- [`2026-06-13-windows-offline-installer-2026-06`](2026-06-13-windows-offline-installer-2026-06/proposal.md)

### 2026-06-12

- [`2026-06-12-add-manual-git-status-refresh`](2026-06-12-add-manual-git-status-refresh/proposal.md)
- [`2026-06-12-backend-io-cache-and-bridge-payload-budget`](2026-06-12-backend-io-cache-and-bridge-payload-budget/proposal.md)
- [`2026-06-12-calibrate-performance-iteration-debt`](2026-06-12-calibrate-performance-iteration-debt/proposal.md)
- [`2026-06-12-composer-and-message-row-render-budget`](2026-06-12-composer-and-message-row-render-budget/proposal.md)
- [`2026-06-12-file-editor-io-render-isolation-2026-06`](2026-06-12-file-editor-io-render-isolation-2026-06/proposal.md)
- [`2026-06-12-fix-file-tree-virtual-scroll-height-hotfix-closeout`](2026-06-12-fix-file-tree-virtual-scroll-height-hotfix-closeout/proposal.md)
- [`2026-06-12-frontend-prop-chain-stability-2026-06`](2026-06-12-frontend-prop-chain-stability-2026-06/proposal.md)
- [`2026-06-12-markdown-off-main-thread-pipeline`](2026-06-12-markdown-off-main-thread-pipeline/proposal.md)
- [`2026-06-12-realtime-input-and-io-isolation-2026-06`](2026-06-12-realtime-input-and-io-isolation-2026-06/proposal.md)
- [`2026-06-12-renderer-resource-backpressure`](2026-06-12-renderer-resource-backpressure/proposal.md)
- [`2026-06-12-workspace-tree-and-large-file-listing-budget`](2026-06-12-workspace-tree-and-large-file-listing-budget/proposal.md)

### 2026-06-11

- [`2026-06-11-lazy-file-preview-dependencies`](2026-06-11-lazy-file-preview-dependencies/proposal.md)
- [`2026-06-11-realtime-trace-correlation-gate`](2026-06-11-realtime-trace-correlation-gate/proposal.md)
- [`2026-06-11-search-index-and-bounded-hydration`](2026-06-11-search-index-and-bounded-hydration/proposal.md)

### 2026-06-10

- [`2026-06-10-add-codex-provider-scoped-session-launch`](2026-06-10-add-codex-provider-scoped-session-launch/proposal.md)
- [`2026-06-10-add-custom-theme-palette-presets`](2026-06-10-add-custom-theme-palette-presets/proposal.md)
- [`2026-06-10-add-prompt-enhancer-manual-provider-timeout`](2026-06-10-add-prompt-enhancer-manual-provider-timeout/proposal.md)
- [`2026-06-10-add-semantic-diff-review`](2026-06-10-add-semantic-diff-review/proposal.md)
- [`2026-06-10-deepen-semantic-diff-review`](2026-06-10-deepen-semantic-diff-review/proposal.md)
- [`2026-06-10-enforce-bundle-budget-gate`](2026-06-10-enforce-bundle-budget-gate/proposal.md)
- [`2026-06-10-extend-client-font-size-coverage`](2026-06-10-extend-client-font-size-coverage/proposal.md)
- [`2026-06-10-fix-browser-context-light-theme-contrast`](2026-06-10-fix-browser-context-light-theme-contrast/proposal.md)
- [`2026-06-10-fix-message-fork-workspace-mutation`](2026-06-10-fix-message-fork-workspace-mutation/proposal.md)
- [`2026-06-10-fix-windows-titlebar-controls-overlap`](2026-06-10-fix-windows-titlebar-controls-overlap/proposal.md)
- [`2026-06-10-harden-codex-provider-session-catalog-recovery`](2026-06-10-harden-codex-provider-session-catalog-recovery/proposal.md)
- [`2026-06-10-harden-codex-tui-compatible-user-agent`](2026-06-10-harden-codex-tui-compatible-user-agent/proposal.md)
- [`2026-06-10-harden-file-editor-typing-latency`](2026-06-10-harden-file-editor-typing-latency/proposal.md)
- [`2026-06-10-harden-file-markdown-preview-rendering`](2026-06-10-harden-file-markdown-preview-rendering/proposal.md)
- [`2026-06-10-harden-live-message-canvas-rendering`](2026-06-10-harden-live-message-canvas-rendering/proposal.md)
- [`2026-06-10-harden-realtime-composer-status-panel-performance`](2026-06-10-harden-realtime-composer-status-panel-performance/proposal.md)
- [`2026-06-10-lazy-markdown-runtime`](2026-06-10-lazy-markdown-runtime/proposal.md)
- [`2026-06-10-parallelize-bootstrap-locale-loading`](2026-06-10-parallelize-bootstrap-locale-loading/proposal.md)
- [`2026-06-10-polish-project-map-files-api-mvp`](2026-06-10-polish-project-map-files-api-mvp/proposal.md)
- [`2026-06-10-refine-project-map-api-contract-detail-view`](2026-06-10-refine-project-map-api-contract-detail-view/proposal.md)
- [`2026-06-10-refresh-v059-performance-baseline`](2026-06-10-refresh-v059-performance-baseline/proposal.md)
- [`2026-06-10-split-app-shell-performance-boundaries`](2026-06-10-split-app-shell-performance-boundaries/proposal.md)
- [`2026-06-10-split-app-shell-runtime-boundaries`](2026-06-10-split-app-shell-runtime-boundaries/proposal.md)
- [`2026-06-10-split-startup-css-loading`](2026-06-10-split-startup-css-loading/proposal.md)
- [`2026-06-10-unify-client-workflow-runtime-model`](2026-06-10-unify-client-workflow-runtime-model/proposal.md)

### 2026-06-07

- [`2026-06-07-split-large-file-hard-debt`](2026-06-07-split-large-file-hard-debt/proposal.md)

### 2026-06-06

- [`2026-06-06-add-intent-canvas-workspace-files`](2026-06-06-add-intent-canvas-workspace-files/proposal.md)
- [`2026-06-06-add-project-canvas-code-graph-import`](2026-06-06-add-project-canvas-code-graph-import/proposal.md)
- [`2026-06-06-add-project-map-api-contract-view`](2026-06-06-add-project-map-api-contract-view/proposal.md)
- [`2026-06-06-add-project-map-intent-canvas-context`](2026-06-06-add-project-map-intent-canvas-context/proposal.md)
- [`2026-06-06-add-project-map-relations-scan-loading`](2026-06-06-add-project-map-relations-scan-loading/proposal.md)
- [`2026-06-06-add-project-map-relationship-dashboard`](2026-06-06-add-project-map-relationship-dashboard/proposal.md)
- [`2026-06-06-fix-project-map-file-navigation-completeness`](2026-06-06-fix-project-map-file-navigation-completeness/proposal.md)
- [`2026-06-06-harden-client-renderer-stability-under-pressure`](2026-06-06-harden-client-renderer-stability-under-pressure/proposal.md)
- [`2026-06-06-harden-windows-ask-user-question-resume`](2026-06-06-harden-windows-ask-user-question-resume/proposal.md)

### 2026-06-05

- [`2026-06-05-fix-codex-session-create-shutdown-race`](2026-06-05-fix-codex-session-create-shutdown-race/proposal.md)
- [`2026-06-05-fix-live-inline-code-markdown-rendering-continuity`](2026-06-05-fix-live-inline-code-markdown-rendering-continuity/proposal.md)
- [`2026-06-05-pin-live-user-question-bubble`](2026-06-05-pin-live-user-question-bubble/proposal.md)
- [`2026-06-05-show-codex-history-loading-state-continuity`](2026-06-05-show-codex-history-loading-state-continuity/proposal.md)

### 2026-06-04

- [`2026-06-04-add-session-attribution-mode-setting`](2026-06-04-add-session-attribution-mode-setting/proposal.md)
- [`2026-06-04-deepen-project-map-query-and-association-workbench`](2026-06-04-deepen-project-map-query-and-association-workbench/proposal.md)
- [`2026-06-04-fix-ask-user-question-timeout-settlement`](2026-06-04-fix-ask-user-question-timeout-settlement/proposal.md)
- [`2026-06-04-fix-claude-argv-prompt-shell-escaping`](2026-06-04-fix-claude-argv-prompt-shell-escaping/proposal.md)
- [`2026-06-04-fix-client-runtime-interaction-jank`](2026-06-04-fix-client-runtime-interaction-jank/proposal.md)
- [`2026-06-04-fix-codex-queued-user-bubble-gap`](2026-06-04-fix-codex-queued-user-bubble-gap/proposal.md)
- [`2026-06-04-fix-stale-thread-binding-recovery-continuity`](2026-06-04-fix-stale-thread-binding-recovery-continuity/proposal.md)
- [`2026-06-04-fix-webview2-message-image-memory-pressure`](2026-06-04-fix-webview2-message-image-memory-pressure/proposal.md)
- [`2026-06-04-refactor-project-map-view-information-architecture`](2026-06-04-refactor-project-map-view-information-architecture/proposal.md)

### 2026-06-03

- [`2026-06-03-add-agent-task-orchestration-center`](2026-06-03-add-agent-task-orchestration-center/proposal.md)
- [`2026-06-03-add-project-map-evidence-file-explorer`](2026-06-03-add-project-map-evidence-file-explorer/proposal.md)
- [`2026-06-03-add-project-map-focused-tests`](2026-06-03-add-project-map-focused-tests/proposal.md)
- [`2026-06-03-add-project-map-guided-tour-and-path-navigation`](2026-06-03-add-project-map-guided-tour-and-path-navigation/proposal.md)
- [`2026-06-03-add-project-map-staleness-refresh-and-graph-repair`](2026-06-03-add-project-map-staleness-refresh-and-graph-repair/proposal.md)
- [`2026-06-03-advance-browser-dock-trusted-observation-and-code-bridge`](2026-06-03-advance-browser-dock-trusted-observation-and-code-bridge/proposal.md)
- [`2026-06-03-complete-project-map-relation-persistence-and-impact-sources`](2026-06-03-complete-project-map-relation-persistence-and-impact-sources/proposal.md)
- [`2026-06-03-eliminate-large-file-baseline-debt`](2026-06-03-eliminate-large-file-baseline-debt/proposal.md)
- [`2026-06-03-enhance-project-map-graph-experience`](2026-06-03-enhance-project-map-graph-experience/proposal.md)
- [`2026-06-03-extend-project-map-code-spec-task-knowledge-graph`](2026-06-03-extend-project-map-code-spec-task-knowledge-graph/proposal.md)
- [`2026-06-03-improve-project-map-context-and-impact-navigation`](2026-06-03-improve-project-map-context-and-impact-navigation/proposal.md)
- [`2026-06-03-improve-project-map-relation-ux`](2026-06-03-improve-project-map-relation-ux/proposal.md)
- [`2026-06-03-prevent-passive-runtime-acquisition`](2026-06-03-prevent-passive-runtime-acquisition/proposal.md)
- [`2026-06-03-reduce-project-map-large-file-and-test-pressure`](2026-06-03-reduce-project-map-large-file-and-test-pressure/proposal.md)

### 2026-06-02

- [`2026-06-02-add-vibecoding-browser-agent`](2026-06-02-add-vibecoding-browser-agent/proposal.md)
- [`2026-06-02-enhance-browser-agent-page-understanding`](2026-06-02-enhance-browser-agent-page-understanding/proposal.md)
- [`2026-06-02-enhance-file-tree-management-actions`](2026-06-02-enhance-file-tree-management-actions/proposal.md)
- [`2026-06-02-fix-foreground-turn-settlement-phase2b`](2026-06-02-fix-foreground-turn-settlement-phase2b/proposal.md)
- [`2026-06-02-harden-model-structured-output-normalization`](2026-06-02-harden-model-structured-output-normalization/proposal.md)

## 2026-05 (188)

### 2026-05-31

- [`2026-05-31-add-codex-structured-launch-profile`](2026-05-31-add-codex-structured-launch-profile/proposal.md)
- [`2026-05-31-add-file-tab-detached-open`](2026-05-31-add-file-tab-detached-open/proposal.md)
- [`2026-05-31-classify-auto-session-visibility`](2026-05-31-classify-auto-session-visibility/proposal.md)
- [`2026-05-31-fix-codex-thread-list-engine-switch-degradation`](2026-05-31-fix-codex-thread-list-engine-switch-degradation/proposal.md)
- [`2026-05-31-fix-git-change-canonical-model`](2026-05-31-fix-git-change-canonical-model/proposal.md)
- [`2026-05-31-fix-runtime-acquire-helper-read-regression`](2026-05-31-fix-runtime-acquire-helper-read-regression/proposal.md)
- [`2026-05-31-fix-thread-recovery-fork-shortcut`](2026-05-31-fix-thread-recovery-fork-shortcut/proposal.md)
- [`2026-05-31-harden-project-map-organizer-review-ux`](2026-05-31-harden-project-map-organizer-review-ux/proposal.md)
- [`2026-05-31-refine-conversation-message-copy-actions`](2026-05-31-refine-conversation-message-copy-actions/proposal.md)

### 2026-05-30

- [`2026-05-30-add-project-map-ai-node-organizer`](2026-05-30-add-project-map-ai-node-organizer/proposal.md)
- [`2026-05-30-stabilize-project-map-hierarchy`](2026-05-30-stabilize-project-map-hierarchy/proposal.md)

### 2026-05-29

- [`2026-05-29-add-appearance-translucent-blur-controls`](2026-05-29-add-appearance-translucent-blur-controls/proposal.md)
- [`2026-05-29-add-close-current-session-shortcut`](2026-05-29-add-close-current-session-shortcut/proposal.md)
- [`2026-05-29-add-codex-goal-slash-command-ux`](2026-05-29-add-codex-goal-slash-command-ux/proposal.md)
- [`2026-05-29-add-cross-workspace-cost-admin-view`](2026-05-29-add-cross-workspace-cost-admin-view/proposal.md)
- [`2026-05-29-add-engine-plugin-onboarding-kit`](2026-05-29-add-engine-plugin-onboarding-kit/proposal.md)
- [`2026-05-29-add-message-tail-action-icons`](2026-05-29-add-message-tail-action-icons/proposal.md)
- [`2026-05-29-design-three-evidence-status-query-reconciliation`](2026-05-29-design-three-evidence-status-query-reconciliation/proposal.md)
- [`2026-05-29-design-three-evidence-turn-settlement`](2026-05-29-design-three-evidence-turn-settlement/proposal.md)
- [`2026-05-29-fix-home-composer-submit-button-state-and-theme`](2026-05-29-fix-home-composer-submit-button-state-and-theme/proposal.md)
- [`2026-05-29-fix-remote-git-root-scan`](2026-05-29-fix-remote-git-root-scan/proposal.md)
- [`2026-05-29-fix-web-service-add-workspace-path-entry`](2026-05-29-fix-web-service-add-workspace-path-entry/proposal.md)
- [`2026-05-29-fix-web-service-empty-dist-white-screen`](2026-05-29-fix-web-service-empty-dist-white-screen/proposal.md)
- [`2026-05-29-fix-workspace-filetree-first-paint-performance`](2026-05-29-fix-workspace-filetree-first-paint-performance/proposal.md)
- [`2026-05-29-fix-workspace-folder-open-performance`](2026-05-29-fix-workspace-folder-open-performance/proposal.md)
- [`2026-05-29-harden-client-runtime-environment-recovery`](2026-05-29-harden-client-runtime-environment-recovery/proposal.md)
- [`2026-05-29-implement-three-evidence-dry-run-settlement`](2026-05-29-implement-three-evidence-dry-run-settlement/proposal.md)
- [`2026-05-29-implement-three-evidence-status-query-reconciliation`](2026-05-29-implement-three-evidence-status-query-reconciliation/proposal.md)
- [`2026-05-29-observe-foreground-turn-settlement-gaps`](2026-05-29-observe-foreground-turn-settlement-gaps/proposal.md)
- [`2026-05-29-persist-client-error-log`](2026-05-29-persist-client-error-log/proposal.md)
- [`2026-05-29-preserve-editor-on-topbar-session-switch`](2026-05-29-preserve-editor-on-topbar-session-switch/proposal.md)
- [`2026-05-29-tune-composer-input-bottom-affordance`](2026-05-29-tune-composer-input-bottom-affordance/proposal.md)

### 2026-05-28

- [`2026-05-28-add-email-driven-session-continuation`](2026-05-28-add-email-driven-session-continuation/proposal.md)
- [`2026-05-28-add-engine-task-output-inspector`](2026-05-28-add-engine-task-output-inspector/proposal.md)
- [`2026-05-28-add-file-markdown-math-preview`](2026-05-28-add-file-markdown-math-preview/proposal.md)
- [`2026-05-28-add-memory-reference-persistent-mode`](2026-05-28-add-memory-reference-persistent-mode/proposal.md)
- [`2026-05-28-add-project-map-candidate-review-actions`](2026-05-28-add-project-map-candidate-review-actions/proposal.md)
- [`2026-05-28-add-project-map-node-diagram-artifacts`](2026-05-28-add-project-map-node-diagram-artifacts/proposal.md)
- [`2026-05-28-add-project-xray-panel`](2026-05-28-add-project-xray-panel/proposal.md)
- [`2026-05-28-adjust-git-worktree-checkbox-placement`](2026-05-28-adjust-git-worktree-checkbox-placement/proposal.md)
- [`2026-05-28-advance-harness-governance-to-90`](2026-05-28-advance-harness-governance-to-90/proposal.md)
- [`2026-05-28-desktop-editor-split-left-composer`](2026-05-28-desktop-editor-split-left-composer/proposal.md)
- [`2026-05-28-dynamic-project-governance-evidence`](2026-05-28-dynamic-project-governance-evidence/proposal.md)
- [`2026-05-28-fix-bottom-status-dock-collapse-stability`](2026-05-28-fix-bottom-status-dock-collapse-stability/proposal.md)
- [`2026-05-28-fix-claude-custom-model-fact-source-normalization`](2026-05-28-fix-claude-custom-model-fact-source-normalization/proposal.md)
- [`2026-05-28-fix-claude-issue529-second-turn-blank-session`](2026-05-28-fix-claude-issue529-second-turn-blank-session/proposal.md)
- [`2026-05-28-fix-codex-deferred-completion-after-assistant-ingress`](2026-05-28-fix-codex-deferred-completion-after-assistant-ingress/proposal.md)
- [`2026-05-28-fix-codex-empty-draft-stale-thread-auto-replay`](2026-05-28-fix-codex-empty-draft-stale-thread-auto-replay/proposal.md)
- [`2026-05-28-fix-codex-stale-history-fork-shortcut`](2026-05-28-fix-codex-stale-history-fork-shortcut/proposal.md)
- [`2026-05-28-fix-composer-file-reference-at-white-screen`](2026-05-28-fix-composer-file-reference-at-white-screen/proposal.md)
- [`2026-05-28-fix-composer-file-reference-without-file-tree-open`](2026-05-28-fix-composer-file-reference-without-file-tree-open/proposal.md)
- [`2026-05-28-fix-composer-tool-popover-stability`](2026-05-28-fix-composer-tool-popover-stability/proposal.md)
- [`2026-05-28-fix-long-live-assistant-stream-recovery`](2026-05-28-fix-long-live-assistant-stream-recovery/proposal.md)
- [`2026-05-28-fix-markdown-preview-auto-refresh`](2026-05-28-fix-markdown-preview-auto-refresh/proposal.md)
- [`2026-05-28-fix-project-map-auto-ingestion-background-scheduler`](2026-05-28-fix-project-map-auto-ingestion-background-scheduler/proposal.md)
- [`2026-05-28-fix-reasoning-effort-engine-switch-staleness`](2026-05-28-fix-reasoning-effort-engine-switch-staleness/proposal.md)
- [`2026-05-28-fix-session-folder-intent-and-worktree-move-menu`](2026-05-28-fix-session-folder-intent-and-worktree-move-menu/proposal.md)
- [`2026-05-28-fix-stale-thread-recovery-confidence-gates`](2026-05-28-fix-stale-thread-recovery-confidence-gates/proposal.md)
- [`2026-05-28-fix-user-input-dismiss-settlement`](2026-05-28-fix-user-input-dismiss-settlement/proposal.md)
- [`2026-05-28-harden-claude-sidebar-list-timeout-fallback`](2026-05-28-harden-claude-sidebar-list-timeout-fallback/proposal.md)
- [`2026-05-28-improve-email-mail-session-list-controls`](2026-05-28-improve-email-mail-session-list-controls/proposal.md)
- [`2026-05-28-improve-project-map-drag-and-root-visual`](2026-05-28-improve-project-map-drag-and-root-visual/proposal.md)
- [`2026-05-28-improve-project-map-inspector-evidence-ux`](2026-05-28-improve-project-map-inspector-evidence-ux/proposal.md)
- [`2026-05-28-improve-project-map-interactive-layout`](2026-05-28-improve-project-map-interactive-layout/proposal.md)
- [`2026-05-28-integrate-openspec-trellis-bridge-into-status-panel`](2026-05-28-integrate-openspec-trellis-bridge-into-status-panel/proposal.md)
- [`2026-05-28-optimize-bundle-chunking`](2026-05-28-optimize-bundle-chunking/proposal.md)
- [`2026-05-28-optimize-long-list-virtualization`](2026-05-28-optimize-long-list-virtualization/proposal.md)
- [`2026-05-28-optimize-realtime-event-batching`](2026-05-28-optimize-realtime-event-batching/proposal.md)
- [`2026-05-28-refactor-file-open-rendering-scheduler`](2026-05-28-refactor-file-open-rendering-scheduler/proposal.md)
- [`2026-05-28-refactor-mega-hub-split`](2026-05-28-refactor-mega-hub-split/proposal.md)
- [`2026-05-28-refactor-workspace-session-management`](2026-05-28-refactor-workspace-session-management/proposal.md)
- [`2026-05-28-sharpen-project-map-generation-prompts`](2026-05-28-sharpen-project-map-generation-prompts/proposal.md)
- [`2026-05-28-stabilize-composer-control-surface`](2026-05-28-stabilize-composer-control-surface/proposal.md)
- [`2026-05-28-stabilize-core-runtime-and-realtime-contracts`](2026-05-28-stabilize-core-runtime-and-realtime-contracts/proposal.md)
- [`2026-05-28-stabilize-file-markdown-preview-render-architecture`](2026-05-28-stabilize-file-markdown-preview-render-architecture/proposal.md)
- [`2026-05-28-stabilize-markdown-preview-awareness-and-large-rendering`](2026-05-28-stabilize-markdown-preview-awareness-and-large-rendering/proposal.md)
- [`2026-05-28-stabilize-project-map-for-v0-5-4`](2026-05-28-stabilize-project-map-for-v0-5-4/proposal.md)
- [`2026-05-28-stabilize-project-map-incremental-generation`](2026-05-28-stabilize-project-map-incremental-generation/proposal.md)
- [`2026-05-28-stabilize-runtime-performance-evidence-gates`](2026-05-28-stabilize-runtime-performance-evidence-gates/proposal.md)
- [`2026-05-28-stabilize-session-management-truth-boundaries`](2026-05-28-stabilize-session-management-truth-boundaries/proposal.md)
- [`2026-05-28-unify-claude-workspace-session-catalog`](2026-05-28-unify-claude-workspace-session-catalog/proposal.md)
- [`2026-05-28-unify-context-ledger-toggle-position`](2026-05-28-unify-context-ledger-toggle-position/proposal.md)
- [`2026-05-28-wire-project-map-auto-ingestion`](2026-05-28-wire-project-map-auto-ingestion/proposal.md)

### 2026-05-27

- [`2026-05-27-fix-project-map-cross-workspace-run-isolation`](2026-05-27-fix-project-map-cross-workspace-run-isolation/proposal.md)

### 2026-05-20

- [`2026-05-20-add-agent-domain-event-schema`](2026-05-20-add-agent-domain-event-schema/proposal.md)
- [`2026-05-20-add-capability-aware-policy-router`](2026-05-20-add-capability-aware-policy-router/proposal.md)
- [`2026-05-20-add-engine-capability-matrix-spec`](2026-05-20-add-engine-capability-matrix-spec/proposal.md)
- [`2026-05-20-add-governance-telemetry-loop`](2026-05-20-add-governance-telemetry-loop/proposal.md)
- [`2026-05-20-add-policy-decision-audit-surface`](2026-05-20-add-policy-decision-audit-surface/proposal.md)
- [`2026-05-20-evolve-checkpoint-to-policy-chain`](2026-05-20-evolve-checkpoint-to-policy-chain/proposal.md)
- [`2026-05-20-evolve-context-ledger-to-cost-budget`](2026-05-20-evolve-context-ledger-to-cost-budget/proposal.md)
- [`2026-05-20-evolve-harness-governance-closed-loop`](2026-05-20-evolve-harness-governance-closed-loop/proposal.md)
- [`2026-05-20-formalize-engine-runtime-contract`](2026-05-20-formalize-engine-runtime-contract/proposal.md)
- [`2026-05-20-soften-harness-governance-to-advisory-mode`](2026-05-20-soften-harness-governance-to-advisory-mode/proposal.md)
- [`2026-05-20-wire-agent-domain-event-runtime`](2026-05-20-wire-agent-domain-event-runtime/proposal.md)

### 2026-05-19

- [`2026-05-19-add-message-tool-call-card-fallback`](2026-05-19-add-message-tool-call-card-fallback/proposal.md)
- [`2026-05-19-normalize-user-input-question-card`](2026-05-19-normalize-user-input-question-card/proposal.md)
- [`2026-05-19-refactor-session-display-projection`](2026-05-19-refactor-session-display-projection/proposal.md)
- [`2026-05-19-unify-sidebar-list-timeout-fallback-across-engines`](2026-05-19-unify-sidebar-list-timeout-fallback-across-engines/proposal.md)

### 2026-05-15

- [`2026-05-15-add-runtime-perf-baseline`](2026-05-15-add-runtime-perf-baseline/proposal.md)
- [`2026-05-15-fix-claude-pending-transcript-reconciliation`](2026-05-15-fix-claude-pending-transcript-reconciliation/proposal.md)
- [`2026-05-15-fix-claude-repeat-turn-first-token-latency`](2026-05-15-fix-claude-repeat-turn-first-token-latency/proposal.md)
- [`2026-05-15-fix-claude-sidebar-native-session-continuity`](2026-05-15-fix-claude-sidebar-native-session-continuity/proposal.md)
- [`2026-05-15-harden-claude-stream-json-liveness`](2026-05-15-harden-claude-stream-json-liveness/proposal.md)
- [`2026-05-15-harden-codex-silent-turn-liveness`](2026-05-15-harden-codex-silent-turn-liveness/proposal.md)
- [`2026-05-15-harden-session-start-and-claude-list-window`](2026-05-15-harden-session-start-and-claude-list-window/proposal.md)
- [`2026-05-15-improve-progressive-file-tree-loading`](2026-05-15-improve-progressive-file-tree-loading/proposal.md)
- [`2026-05-15-repair-project-memory-reference-retrieval-integrity`](2026-05-15-repair-project-memory-reference-retrieval-integrity/proposal.md)

### 2026-05-14

- [`2026-05-14-fix-memory-reference-single-status-card`](2026-05-14-fix-memory-reference-single-status-card/proposal.md)
- [`2026-05-14-project-memory-local-semantic-retrieval`](2026-05-14-project-memory-local-semantic-retrieval/proposal.md)
- [`2026-05-14-project-memory-phase3-usability-reliability`](2026-05-14-project-memory-phase3-usability-reliability/proposal.md)
- [`2026-05-14-project-memory-refactor`](2026-05-14-project-memory-refactor/proposal.md)
- [`2026-05-14-project-memory-retrieval-pack-cleaner`](2026-05-14-project-memory-retrieval-pack-cleaner/proposal.md)

### 2026-05-13

- [`2026-05-13-add-cli-one-click-installer`](2026-05-13-add-cli-one-click-installer/proposal.md)
- [`2026-05-13-claude-code-mode-progressive-rollout`](2026-05-13-claude-code-mode-progressive-rollout/proposal.md)
- [`2026-05-13-clean-openspec-main-spec-hygiene`](2026-05-13-clean-openspec-main-spec-hygiene/proposal.md)
- [`2026-05-13-fix-claude-native-session-continuation-race`](2026-05-13-fix-claude-native-session-continuation-race/proposal.md)
- [`2026-05-13-fix-claude-session-engine-resolution`](2026-05-13-fix-claude-session-engine-resolution/proposal.md)
- [`2026-05-13-fix-linux-appimage-wayland-library-pruning`](2026-05-13-fix-linux-appimage-wayland-library-pruning/proposal.md)
- [`2026-05-13-fix-realtime-late-event-terminal-fence`](2026-05-13-fix-realtime-late-event-terminal-fence/proposal.md)
- [`2026-05-13-fix-realtime-turn-completion-settlement-race`](2026-05-13-fix-realtime-turn-completion-settlement-race/proposal.md)
- [`2026-05-13-fix-tauri-native-menu-deadlock`](2026-05-13-fix-tauri-native-menu-deadlock/proposal.md)
- [`2026-05-13-fix-windows-codex-app-server-wrapper-launch`](2026-05-13-fix-windows-codex-app-server-wrapper-launch/proposal.md)
- [`2026-05-13-optimize-runtime-session-background-scheduling`](2026-05-13-optimize-runtime-session-background-scheduling/proposal.md)

### 2026-05-12

- [`2026-05-12-add-claude-fork-session-support`](2026-05-12-add-claude-fork-session-support/proposal.md)
- [`2026-05-12-add-claude-reasoning-effort-support`](2026-05-12-add-claude-reasoning-effort-support/proposal.md)
- [`2026-05-12-add-claude-tui-resume-actions`](2026-05-12-add-claude-tui-resume-actions/proposal.md)
- [`2026-05-12-add-subagent-session-tree-navigation`](2026-05-12-add-subagent-session-tree-navigation/proposal.md)
- [`2026-05-12-converge-conversation-fact-contract`](2026-05-12-converge-conversation-fact-contract/proposal.md)
- [`2026-05-12-fix-claude-context-usage-display`](2026-05-12-fix-claude-context-usage-display/proposal.md)
- [`2026-05-12-fix-codex-sessionstart-hook-fallback`](2026-05-12-fix-codex-sessionstart-hook-fallback/proposal.md)
- [`2026-05-12-harden-claude-history-large-payloads`](2026-05-12-harden-claude-history-large-payloads/proposal.md)
- [`2026-05-12-improve-composer-send-readiness-ux`](2026-05-12-improve-composer-send-readiness-ux/proposal.md)
- [`2026-05-12-stabilize-runtime-session-lifecycle`](2026-05-12-stabilize-runtime-session-lifecycle/proposal.md)

### 2026-05-10

- [`2026-05-10-refactor-client-startup-orchestrator`](2026-05-10-refactor-client-startup-orchestrator/proposal.md)

### 2026-05-09

- [`2026-05-09-add-client-module-documentation-window`](2026-05-09-add-client-module-documentation-window/proposal.md)
- [`2026-05-09-add-file-line-annotation-composer-bridge`](2026-05-09-add-file-line-annotation-composer-bridge/proposal.md)
- [`2026-05-09-align-claude-thinking-visibility-control`](2026-05-09-align-claude-thinking-visibility-control/proposal.md)
- [`2026-05-09-fix-claude-control-plane-session-contamination`](2026-05-09-fix-claude-control-plane-session-contamination/proposal.md)
- [`2026-05-09-fix-web-service-reconnect-state-refresh`](2026-05-09-fix-web-service-reconnect-state-refresh/proposal.md)
- [`2026-05-09-fix-workspace-filetree-transient-empty-state`](2026-05-09-fix-workspace-filetree-transient-empty-state/proposal.md)
- [`2026-05-09-format-claude-history-control-events`](2026-05-09-format-claude-history-control-events/proposal.md)
- [`2026-05-09-harden-engine-transcript-channel-isolation`](2026-05-09-harden-engine-transcript-channel-isolation/proposal.md)

### 2026-05-08

- [`2026-05-08-configure-workspace-thread-root-visibility`](2026-05-08-configure-workspace-thread-root-visibility/proposal.md)
- [`2026-05-08-dynamic-claude-model-discovery`](2026-05-08-dynamic-claude-model-discovery/proposal.md)
- [`2026-05-08-manage-project-session-folders`](2026-05-08-manage-project-session-folders/proposal.md)
- [`2026-05-08-persist-web-service-access-token`](2026-05-08-persist-web-service-access-token/proposal.md)
- [`2026-05-08-refine-checkpoint-result-panel`](2026-05-08-refine-checkpoint-result-panel/proposal.md)

### 2026-05-07

- [`2026-05-07-add-editable-workspace-diff-review-surface`](2026-05-07-add-editable-workspace-diff-review-surface/proposal.md)
- [`2026-05-07-control-cli-engine-startup-gates`](2026-05-07-control-cli-engine-startup-gates/proposal.md)
- [`2026-05-07-fix-claude-history-transcript-blanking`](2026-05-07-fix-claude-history-transcript-blanking/proposal.md)
- [`2026-05-07-fix-linux-webkitgtk-ime-env`](2026-05-07-fix-linux-webkitgtk-ime-env/proposal.md)
- [`2026-05-07-normalize-conversation-file-change-surfaces`](2026-05-07-normalize-conversation-file-change-surfaces/proposal.md)
- [`2026-05-07-replace-edits-with-checkpoint`](2026-05-07-replace-edits-with-checkpoint/proposal.md)
- [`2026-05-07-streamline-governance-doc-stack`](2026-05-07-streamline-governance-doc-stack/proposal.md)

### 2026-05-06

- [`2026-05-06-fix-conversation-curtain-i18n-gaps`](2026-05-06-fix-conversation-curtain-i18n-gaps/proposal.md)
- [`2026-05-06-fix-conversation-curtain-visible-copy-tail`](2026-05-06-fix-conversation-curtain-visible-copy-tail/proposal.md)

### 2026-05-05

- [`2026-05-05-fix-windows-opencode-foreground-launch`](2026-05-05-fix-windows-opencode-foreground-launch/proposal.md)

### 2026-05-04

- [`2026-05-04-add-agent-task-center`](2026-05-04-add-agent-task-center/proposal.md)
- [`2026-05-04-connect-task-center-completion-and-recovery`](2026-05-04-connect-task-center-completion-and-recovery/proposal.md)
- [`2026-05-04-connect-task-center-runtime-lifecycle`](2026-05-04-connect-task-center-runtime-lifecycle/proposal.md)
- [`2026-05-04-extend-conversation-curtain-assembly-to-claude-gemini`](2026-05-04-extend-conversation-curtain-assembly-to-claude-gemini/proposal.md)
- [`2026-05-04-optimize-realtime-conversation-client-performance`](2026-05-04-optimize-realtime-conversation-client-performance/proposal.md)
- [`2026-05-04-phase1-architecture-hardening`](2026-05-04-phase1-architecture-hardening/proposal.md)
- [`2026-05-04-status-panel-user-conversation-timeline`](2026-05-04-status-panel-user-conversation-timeline/proposal.md)

### 2026-05-03

- [`2026-05-03-add-context-ledger`](2026-05-03-add-context-ledger/proposal.md)
- [`2026-05-03-advance-context-ledger-transition-visibility`](2026-05-03-advance-context-ledger-transition-visibility/proposal.md)
- [`2026-05-03-deepen-context-ledger-governance-and-attribution`](2026-05-03-deepen-context-ledger-governance-and-attribution/proposal.md)
- [`2026-05-03-enhance-task-center-visibility-and-affordance`](2026-05-03-enhance-task-center-visibility-and-affordance/proposal.md)
- [`2026-05-03-extend-context-ledger-source-navigation`](2026-05-03-extend-context-ledger-source-navigation/proposal.md)
- [`2026-05-03-refine-context-ledger-session-boundaries-and-drawer`](2026-05-03-refine-context-ledger-session-boundaries-and-drawer/proposal.md)

### 2026-05-02

- [`2026-05-02-add-performance-compatibility-diagnostics`](2026-05-02-add-performance-compatibility-diagnostics/proposal.md)
- [`2026-05-02-adjust-codex-stalled-timeouts`](2026-05-02-adjust-codex-stalled-timeouts/proposal.md)
- [`2026-05-02-consolidate-settings-basic-entry-tabs`](2026-05-02-consolidate-settings-basic-entry-tabs/proposal.md)
- [`2026-05-02-fix-codex-compaction-status-copy`](2026-05-02-fix-codex-compaction-status-copy/proposal.md)
- [`2026-05-02-fix-windows-external-file-monitor-toast-storm`](2026-05-02-fix-windows-external-file-monitor-toast-storm/proposal.md)
- [`2026-05-02-reduce-core-complexity-preserve-behavior`](2026-05-02-reduce-core-complexity-preserve-behavior/proposal.md)

### 2026-05-01

- [`2026-05-01-add-claude-plugin-skill-discovery`](2026-05-01-add-claude-plugin-skill-discovery/proposal.md)
- [`2026-05-01-add-configurable-terminal-shell`](2026-05-01-add-configurable-terminal-shell/proposal.md)
- [`2026-05-01-allow-branch-update-without-checkout`](2026-05-01-allow-branch-update-without-checkout/proposal.md)
- [`2026-05-01-fix-ask-user-question-timeout-settlement`](2026-05-01-fix-ask-user-question-timeout-settlement/proposal.md)
- [`2026-05-01-fix-claude-model-refresh-stale-mapping`](2026-05-01-fix-claude-model-refresh-stale-mapping/proposal.md)
- [`2026-05-01-fix-codex-composer-startup-selection-stability`](2026-05-01-fix-codex-composer-startup-selection-stability/proposal.md)
- [`2026-05-01-fix-codex-context-summary-and-history-user-images`](2026-05-01-fix-codex-context-summary-and-history-user-images/proposal.md)
- [`2026-05-01-fix-completion-email-turn-terminal-normalization`](2026-05-01-fix-completion-email-turn-terminal-normalization/proposal.md)
- [`2026-05-01-fix-idempotent-missing-session-delete`](2026-05-01-fix-idempotent-missing-session-delete/proposal.md)
- [`2026-05-01-fix-sidebar-exited-session-visibility-toggle`](2026-05-01-fix-sidebar-exited-session-visibility-toggle/proposal.md)
- [`2026-05-01-sync-post-3adf51a-doc-backfill`](2026-05-01-sync-post-3adf51a-doc-backfill/proposal.md)

## 2026-04 (121)

### 2026-04-30

- [`2026-04-30-add-workspace-note-card-pool`](2026-04-30-add-workspace-note-card-pool/proposal.md)
- [`2026-04-30-align-git-commit-scope-surfaces`](2026-04-30-align-git-commit-scope-surfaces/proposal.md)
- [`2026-04-30-expose-git-file-preview-actions`](2026-04-30-expose-git-file-preview-actions/proposal.md)
- [`2026-04-30-spec-hub-change-backlog-and-console-defaults`](2026-04-30-spec-hub-change-backlog-and-console-defaults/proposal.md)
- [`2026-04-30-spec-hub-viewer-and-detached-window`](2026-04-30-spec-hub-viewer-and-detached-window/proposal.md)

### 2026-04-29

- [`2026-04-29-add-conversation-email-notification`](2026-04-29-add-conversation-email-notification/proposal.md)
- [`2026-04-29-add-global-runtime-notice-dock-visibility-control`](2026-04-29-add-global-runtime-notice-dock-visibility-control/proposal.md)
- [`2026-04-29-add-model-selector-config-actions`](2026-04-29-add-model-selector-config-actions/proposal.md)
- [`2026-04-29-add-settings-custom-theme-presets`](2026-04-29-add-settings-custom-theme-presets/proposal.md)
- [`2026-04-29-add-workspace-sidebar-alias`](2026-04-29-add-workspace-sidebar-alias/proposal.md)
- [`2026-04-29-configure-codex-auto-compaction-threshold`](2026-04-29-configure-codex-auto-compaction-threshold/proposal.md)
- [`2026-04-29-expand-configurable-app-shortcuts`](2026-04-29-expand-configurable-app-shortcuts/proposal.md)
- [`2026-04-29-fix-claude-long-thread-render-amplification`](2026-04-29-fix-claude-long-thread-render-amplification/proposal.md)
- [`2026-04-29-fix-codex-background-rollout-session-leak`](2026-04-29-fix-codex-background-rollout-session-leak/proposal.md)
- [`2026-04-29-fix-codex-stale-thread-manual-recovery`](2026-04-29-fix-codex-stale-thread-manual-recovery/proposal.md)
- [`2026-04-29-fix-codex-stalled-late-event-quarantine`](2026-04-29-fix-codex-stalled-late-event-quarantine/proposal.md)
- [`2026-04-29-fix-linux-ime-composer-compatibility`](2026-04-29-fix-linux-ime-composer-compatibility/proposal.md)
- [`2026-04-29-fix-linux-nix-flake-packaging`](2026-04-29-fix-linux-nix-flake-packaging/proposal.md)
- [`2026-04-29-fix-mode-blocked-and-codex-resume-settlement`](2026-04-29-fix-mode-blocked-and-codex-resume-settlement/proposal.md)
- [`2026-04-29-fix-windows-runtime-pool-initial-load`](2026-04-29-fix-windows-runtime-pool-initial-load/proposal.md)
- [`2026-04-29-hide-codex-streaming-thinking-config-toggles`](2026-04-29-hide-codex-streaming-thinking-config-toggles/proposal.md)
- [`2026-04-29-show-codex-auto-compaction-message`](2026-04-29-show-codex-auto-compaction-message/proposal.md)

### 2026-04-28

- [`2026-04-28-add-client-ui-visibility-controls`](2026-04-28-add-client-ui-visibility-controls/proposal.md)
- [`2026-04-28-add-email-sending-settings`](2026-04-28-add-email-sending-settings/proposal.md)
- [`2026-04-28-harden-codex-conversation-liveness`](2026-04-28-harden-codex-conversation-liveness/proposal.md)

### 2026-04-27

- [`2026-04-27-add-git-selective-commit`](2026-04-27-add-git-selective-commit/proposal.md)
- [`2026-04-27-complete-conversation-curtain-assembler`](2026-04-27-complete-conversation-curtain-assembler/proposal.md)
- [`2026-04-27-fix-approval-ui-thread-scoping`](2026-04-27-fix-approval-ui-thread-scoping/proposal.md)
- [`2026-04-27-fix-claude-concurrent-realtime-isolation`](2026-04-27-fix-claude-concurrent-realtime-isolation/proposal.md)
- [`2026-04-27-fix-claude-thread-session-continuity`](2026-04-27-fix-claude-thread-session-continuity/proposal.md)
- [`2026-04-27-fix-claude-windows-streaming-latency`](2026-04-27-fix-claude-windows-streaming-latency/proposal.md)
- [`2026-04-27-fix-codex-computer-use-authorization-continuity`](2026-04-27-fix-codex-computer-use-authorization-continuity/proposal.md)
- [`2026-04-27-fix-codex-generated-image-turn-linkage`](2026-04-27-fix-codex-generated-image-turn-linkage/proposal.md)
- [`2026-04-27-fix-codex-queued-user-bubble-gap`](2026-04-27-fix-codex-queued-user-bubble-gap/proposal.md)
- [`2026-04-27-fix-codex-runtime-lifecycle-recovery`](2026-04-27-fix-codex-runtime-lifecycle-recovery/proposal.md)
- [`2026-04-27-fix-codex-session-sidebar-state-parity`](2026-04-27-fix-codex-session-sidebar-state-parity/proposal.md)
- [`2026-04-27-fix-updater-check-fallback`](2026-04-27-fix-updater-check-fallback/proposal.md)
- [`2026-04-27-split-p0-p1-large-files`](2026-04-27-split-p0-p1-large-files/proposal.md)
- [`2026-04-27-unify-conversation-curtain-normalization`](2026-04-27-unify-conversation-curtain-normalization/proposal.md)

### 2026-04-24

- [`2026-04-24-fix-claude-completed-output-duplication`](2026-04-24-fix-claude-completed-output-duplication/proposal.md)
- [`2026-04-24-fix-claude-long-markdown-progressive-reveal`](2026-04-24-fix-claude-long-markdown-progressive-reveal/proposal.md)
- [`2026-04-24-fix-claude-repeat-turn-blanking`](2026-04-24-fix-claude-repeat-turn-blanking/proposal.md)
- [`2026-04-24-fix-claude-session-sidebar-state-parity`](2026-04-24-fix-claude-session-sidebar-state-parity/proposal.md)
- [`2026-04-24-fix-claude-windows-streaming-visibility-stall`](2026-04-24-fix-claude-windows-streaming-visibility-stall/proposal.md)

### 2026-04-23

- [`2026-04-23-add-codex-cli-computer-use-broker`](2026-04-23-add-codex-cli-computer-use-broker/proposal.md)
- [`2026-04-23-add-codex-computer-use-activation-bridge`](2026-04-23-add-codex-computer-use-activation-bridge/proposal.md)
- [`2026-04-23-add-codex-computer-use-plugin-bridge`](2026-04-23-add-codex-computer-use-plugin-bridge/proposal.md)
- [`2026-04-23-clean-cc-gui-daemon-warning-surface`](2026-04-23-clean-cc-gui-daemon-warning-surface/proposal.md)
- [`2026-04-23-clean-heavy-test-noise-surface`](2026-04-23-clean-heavy-test-noise-surface/proposal.md)
- [`2026-04-23-clean-rust-test-target-warning-surface`](2026-04-23-clean-rust-test-target-warning-surface/proposal.md)
- [`2026-04-23-clean-tauri-dev-warning-surface`](2026-04-23-clean-tauri-dev-warning-surface/proposal.md)
- [`2026-04-23-discover-computer-use-official-parent-handoff`](2026-04-23-discover-computer-use-official-parent-handoff/proposal.md)
- [`2026-04-23-enforce-heavy-test-noise-ci-sentry`](2026-04-23-enforce-heavy-test-noise-ci-sentry/proposal.md)
- [`2026-04-23-fix-claude-doctor-settings-alignment`](2026-04-23-fix-claude-doctor-settings-alignment/proposal.md)
- [`2026-04-23-fix-codex-realtime-canvas-duplicate-messages`](2026-04-23-fix-codex-realtime-canvas-duplicate-messages/proposal.md)
- [`2026-04-23-fix-linux-appimage-wayland-startup`](2026-04-23-fix-linux-appimage-wayland-startup/proposal.md)
- [`2026-04-23-integrate-codex-cli-computer-use-plugin-bridge`](2026-04-23-integrate-codex-cli-computer-use-plugin-bridge/proposal.md)
- [`2026-04-23-investigate-computer-use-helper-host-contract`](2026-04-23-investigate-computer-use-helper-host-contract/proposal.md)
- [`2026-04-23-productize-computer-use-parent-contract-blocked-state`](2026-04-23-productize-computer-use-parent-contract-blocked-state/proposal.md)
- [`2026-04-23-stabilize-exhaustive-deps-tail-warnings`](2026-04-23-stabilize-exhaustive-deps-tail-warnings/proposal.md)

### 2026-04-22

- [`2026-04-22-add-create-session-recovery-toast-action`](2026-04-22-add-create-session-recovery-toast-action/proposal.md)
- [`2026-04-22-add-global-runtime-notice-dock`](2026-04-22-add-global-runtime-notice-dock/proposal.md)
- [`2026-04-22-align-live-sticky-with-history-header`](2026-04-22-align-live-sticky-with-history-header/proposal.md)
- [`2026-04-22-fix-claude-chat-canvas-cross-platform-blanking`](2026-04-22-fix-claude-chat-canvas-cross-platform-blanking/proposal.md)
- [`2026-04-22-fix-codex-fusion-stalled-continuity`](2026-04-22-fix-codex-fusion-stalled-continuity/proposal.md)
- [`2026-04-22-fix-codex-session-create-shutdown-race`](2026-04-22-fix-codex-session-create-shutdown-race/proposal.md)
- [`2026-04-22-fix-history-expansion-scroll-restoration`](2026-04-22-fix-history-expansion-scroll-restoration/proposal.md)
- [`2026-04-22-fix-live-inline-code-markdown-rendering`](2026-04-22-fix-live-inline-code-markdown-rendering/proposal.md)
- [`2026-04-22-fix-opencode-auto-probe-churn`](2026-04-22-fix-opencode-auto-probe-churn/proposal.md)
- [`2026-04-22-fix-qwen-desktop-streaming-latency`](2026-04-22-fix-qwen-desktop-streaming-latency/proposal.md)
- [`2026-04-22-split-app-shell-orchestration`](2026-04-22-split-app-shell-orchestration/proposal.md)
- [`2026-04-22-split-composer-rewind-modal-styles`](2026-04-22-split-composer-rewind-modal-styles/proposal.md)
- [`2026-04-22-split-engine-opencode-command-surface`](2026-04-22-split-engine-opencode-command-surface/proposal.md)
- [`2026-04-22-split-git-branch-commands`](2026-04-22-split-git-branch-commands/proposal.md)
- [`2026-04-22-split-git-history-branch-compare-styles`](2026-04-22-split-git-history-branch-compare-styles/proposal.md)
- [`2026-04-22-split-runtime-session-lifecycle`](2026-04-22-split-runtime-session-lifecycle/proposal.md)
- [`2026-04-22-split-settings-css-panel-sections`](2026-04-22-split-settings-css-panel-sections/proposal.md)
- [`2026-04-22-split-tauri-service-facade`](2026-04-22-split-tauri-service-facade/proposal.md)
- [`2026-04-22-split-thread-actions-session-runtime`](2026-04-22-split-thread-actions-session-runtime/proposal.md)
- [`2026-04-22-split-thread-items-assistant-text-normalization`](2026-04-22-split-thread-items-assistant-text-normalization/proposal.md)
- [`2026-04-22-split-thread-messaging-session-tooling`](2026-04-22-split-thread-messaging-session-tooling/proposal.md)
- [`2026-04-22-stabilize-app-shell-parts-exhaustive-deps-hotspot`](2026-04-22-stabilize-app-shell-parts-exhaustive-deps-hotspot/proposal.md)
- [`2026-04-22-stabilize-exhaustive-deps-sentinel-patterns`](2026-04-22-stabilize-exhaustive-deps-sentinel-patterns/proposal.md)
- [`2026-04-22-stabilize-git-history-exhaustive-deps-hotspot`](2026-04-22-stabilize-git-history-exhaustive-deps-hotspot/proposal.md)
- [`2026-04-22-stabilize-threads-exhaustive-deps-hotspot`](2026-04-22-stabilize-threads-exhaustive-deps-hotspot/proposal.md)
- [`2026-04-22-triage-exhaustive-deps-warning-batches`](2026-04-22-triage-exhaustive-deps-warning-batches/proposal.md)
- [`2026-04-22-upgrade-large-file-governance-policy-v2`](2026-04-22-upgrade-large-file-governance-policy-v2/proposal.md)

### 2026-04-21

- [`2026-04-21-add-unified-exec-official-config-actions`](2026-04-21-add-unified-exec-official-config-actions/proposal.md)
- [`2026-04-21-align-unified-exec-defaults-and-overrides`](2026-04-21-align-unified-exec-defaults-and-overrides/proposal.md)
- [`2026-04-21-claude-code-compact-command-adaptation`](2026-04-21-claude-code-compact-command-adaptation/proposal.md)
- [`2026-04-21-fix-codex-stale-thread-binding-recovery`](2026-04-21-fix-codex-stale-thread-binding-recovery/proposal.md)
- [`2026-04-21-fix-codex-stalled-user-input-and-runtime-idle-mismatch`](2026-04-21-fix-codex-stalled-user-input-and-runtime-idle-mismatch/proposal.md)
- [`2026-04-21-fix-explored-card-auto-collapse-after-stage`](2026-04-21-fix-explored-card-auto-collapse-after-stage/proposal.md)
- [`2026-04-21-fix-realtime-completion-sound-once`](2026-04-21-fix-realtime-completion-sound-once/proposal.md)
- [`2026-04-21-harden-codex-runtime-exit-recovery`](2026-04-21-harden-codex-runtime-exit-recovery/proposal.md)
- [`2026-04-21-harden-conversation-runtime-stability`](2026-04-21-harden-conversation-runtime-stability/proposal.md)
- [`2026-04-21-mitigate-windows-codex-runtime-churn`](2026-04-21-mitigate-windows-codex-runtime-churn/proposal.md)
- [`2026-04-21-pin-history-user-question-bubble`](2026-04-21-pin-history-user-question-bubble/proposal.md)
- [`2026-04-21-pin-live-user-question-bubble`](2026-04-21-pin-live-user-question-bubble/proposal.md)

### 2026-04-20

- [`2026-04-20-codex-config-flag-boundary-cleanup`](2026-04-20-codex-config-flag-boundary-cleanup/proposal.md)
- [`2026-04-20-fix-project-session-management-scope`](2026-04-20-fix-project-session-management-scope/proposal.md)
- [`2026-04-20-global-session-history-archive-center`](2026-04-20-global-session-history-archive-center/proposal.md)
- [`2026-04-20-workspace-session-catalog-projection-parity`](2026-04-20-workspace-session-catalog-projection-parity/proposal.md)

### 2026-04-19

- [`2026-04-19-project-session-management-center`](2026-04-19-project-session-management-center/proposal.md)
- [`2026-04-19-runtime-orchestrator-pool-console`](2026-04-19-runtime-orchestrator-pool-console/proposal.md)

### 2026-04-17

- [`2026-04-17-harden-codex-rewind-semantics`](2026-04-17-harden-codex-rewind-semantics/proposal.md)
- [`2026-04-17-rewind-mutation-only-file-selection`](2026-04-17-rewind-mutation-only-file-selection/proposal.md)

### 2026-04-16

- [`2026-04-16-add-shared-session-thread`](2026-04-16-add-shared-session-thread/proposal.md)
- [`2026-04-16-rewind-optional-workspace-restore`](2026-04-16-rewind-optional-workspace-restore/proposal.md)

### 2026-04-15

- [`2026-04-15-add-status-panel-latest-user-message-tab`](2026-04-15-add-status-panel-latest-user-message-tab/proposal.md)
- [`2026-04-15-fix-inline-latex-mixed-rendering`](2026-04-15-fix-inline-latex-mixed-rendering/proposal.md)
- [`2026-04-15-improve-codex-rewind-diff-storage`](2026-04-15-improve-codex-rewind-diff-storage/proposal.md)

### 2026-04-14

- [`2026-04-14-improve-claude-rewind-diff-storage`](2026-04-14-improve-claude-rewind-diff-storage/proposal.md)

### 2026-04-13

- [`2026-04-13-add-topbar-session-tabs-bulk-close-actions`](2026-04-13-add-topbar-session-tabs-bulk-close-actions/proposal.md)
- [`2026-04-13-codex-queued-followup-fusion`](2026-04-13-codex-queued-followup-fusion/proposal.md)
- [`2026-04-13-expand-file-view-document-preview-support`](2026-04-13-expand-file-view-document-preview-support/proposal.md)

### 2026-04-12

- [`2026-04-12-2026-04-12-sync-v0.3.12-openspec`](2026-04-12-2026-04-12-sync-v0.3.12-openspec/proposal.md)
- [`2026-04-12-improve-file-rendering-and-renderer-architecture`](2026-04-12-improve-file-rendering-and-renderer-architecture/proposal.md)

### 2026-04-11

- [`2026-04-11-2026-04-12-sync-v0.3.8-v0.3.12-openspec`](2026-04-11-2026-04-12-sync-v0.3.8-v0.3.12-openspec/proposal.md)

### 2026-04-08

- [`2026-04-08-fix-claude-runtime-termination-hardening`](2026-04-08-fix-claude-runtime-termination-hardening/proposal.md)
- [`2026-04-08-fix-codex-source-switch-runtime-apply-2026-03-31`](2026-04-08-fix-codex-source-switch-runtime-apply-2026-03-31/proposal.md)

## 2026-03 (49)

### 2026-03-31

- [`2026-03-31-add-client-web-service-settings`](2026-03-31-add-client-web-service-settings/proposal.md)

### 2026-03-28

- [`2026-03-28-add-detached-file-external-change-awareness`](2026-03-28-add-detached-file-external-change-awareness/proposal.md)

### 2026-03-27

- [`2026-03-27-add-detached-file-explorer-window`](2026-03-27-add-detached-file-explorer-window/proposal.md)

### 2026-03-23

- [`2026-03-23-backfill-gemini-vendor-settings`](2026-03-23-backfill-gemini-vendor-settings/proposal.md)
- [`2026-03-23-claude-2026-03-23-auto-compact-retry-ui-signal`](2026-03-23-claude-2026-03-23-auto-compact-retry-ui-signal/proposal.md)
- [`2026-03-23-codex-2026-03-23-chat-realtime-cpu-stability-no-behavior-change`](2026-03-23-codex-2026-03-23-chat-realtime-cpu-stability-no-behavior-change/proposal.md)

### 2026-03-22

- [`2026-03-22-add-kanban-scheduled-and-chained-tasks`](2026-03-22-add-kanban-scheduled-and-chained-tasks/proposal.md)
- [`2026-03-22-add-topbar-session-tabs-rotation`](2026-03-22-add-topbar-session-tabs-rotation/proposal.md)
- [`2026-03-22-fix-claude-code-askuserquestion-rendering`](2026-03-22-fix-claude-code-askuserquestion-rendering/proposal.md)

### 2026-03-20

- [`2026-03-20-add-client-global-ui-scaling`](2026-03-20-add-client-global-ui-scaling/proposal.md)
- [`2026-03-20-add-session-activity-solo-follow-discoverability`](2026-03-20-add-session-activity-solo-follow-discoverability/proposal.md)
- [`2026-03-20-add-session-radar-history-delete-management`](2026-03-20-add-session-radar-history-delete-management/proposal.md)
- [`2026-03-20-fix-git-history-branch-checkout-dirty-worktree`](2026-03-20-fix-git-history-branch-checkout-dirty-worktree/proposal.md)

### 2026-03-19

- [`2026-03-19-2026-03-19-codex-user-input-license-display-format`](2026-03-19-2026-03-19-codex-user-input-license-display-format/proposal.md)
- [`2026-03-19-2026-03-20-file-open-shell-group-rendering`](2026-03-19-2026-03-20-file-open-shell-group-rendering/proposal.md)
- [`2026-03-19-fix-chat-input-incremental-undo`](2026-03-19-fix-chat-input-incremental-undo/proposal.md)
- [`2026-03-19-session-activity-external-file-open`](2026-03-19-session-activity-external-file-open/proposal.md)
- [`2026-03-19-workspace-session-radar-panel`](2026-03-19-workspace-session-radar-panel/proposal.md)

### 2026-03-18

- [`2026-03-18-chat-support-drag-drop-files-folders`](2026-03-18-chat-support-drag-drop-files-folders/proposal.md)
- [`2026-03-18-fix-codex-history-subsession-parity`](2026-03-18-fix-codex-history-subsession-parity/proposal.md)
- [`2026-03-18-large-file-modularization-wave2-near-threshold`](2026-03-18-large-file-modularization-wave2-near-threshold/proposal.md)
- [`2026-03-18-workspace-external-file-open-routing`](2026-03-18-workspace-external-file-open-routing/proposal.md)
- [`2026-03-18-workspace-open-mode-and-new-window`](2026-03-18-workspace-open-mode-and-new-window/proposal.md)

### 2026-03-16

- [`2026-03-16-bridge-cleanup-and-large-file-modularization`](2026-03-16-bridge-cleanup-and-large-file-modularization/proposal.md)

### 2026-03-15

- [`2026-03-15-optimize-session-activity-incremental-refresh`](2026-03-15-optimize-session-activity-incremental-refresh/proposal.md)
- [`2026-03-15-preserve-codex-session-activity-history`](2026-03-15-preserve-codex-session-activity-history/proposal.md)

### 2026-03-14

- [`2026-03-14-add-current-session-activity-panel`](2026-03-14-add-current-session-activity-panel/proposal.md)
- [`2026-03-14-add-live-edit-preview`](2026-03-14-add-live-edit-preview/proposal.md)

### 2026-03-13

- [`2026-03-13-split-file-markdown-renderer-github-style`](2026-03-13-split-file-markdown-renderer-github-style/proposal.md)

### 2026-03-12

- [`2026-03-12-codex-windows-runtime-hardening`](2026-03-12-codex-windows-runtime-hardening/proposal.md)
- [`2026-03-12-improve-file-rendering-theme-and-markdown-ux`](2026-03-12-improve-file-rendering-theme-and-markdown-ux/proposal.md)

### 2026-03-11

- [`2026-03-11-add-claude-review-quick-action-2026-03-07`](2026-03-11-add-claude-review-quick-action-2026-03-07/proposal.md)
- [`2026-03-11-add-codex-fast-review-controls-2026-03-07`](2026-03-11-add-codex-fast-review-controls-2026-03-07/proposal.md)
- [`2026-03-11-add-external-auto-engine-session-feishu-2026-03-08`](2026-03-11-add-external-auto-engine-session-feishu-2026-03-08/proposal.md)
- [`2026-03-11-add-third-party-message-ingestion-feishu-2026-03-08`](2026-03-11-add-third-party-message-ingestion-feishu-2026-03-08/proposal.md)

### 2026-03-07

- [`2026-03-07-unify-file-tree-visual-style`](2026-03-07-unify-file-tree-visual-style/proposal.md)

### 2026-03-06

- [`2026-03-06-filetree-special-directory-progressive-loading`](2026-03-06-filetree-special-directory-progressive-loading/proposal.md)
- [`2026-03-06-workspace-filetree-root-node`](2026-03-06-workspace-filetree-root-node/proposal.md)

### 2026-03-05

- [`2026-03-05-chat-file-change-diff-persistence`](2026-03-05-chat-file-change-diff-persistence/proposal.md)
- [`2026-03-05-codex-context-auto-compaction-runtime`](2026-03-05-codex-context-auto-compaction-runtime/proposal.md)
- [`2026-03-05-composer-context-dual-view-preserve-legacy`](2026-03-05-composer-context-dual-view-preserve-legacy/proposal.md)
- [`2026-03-05-project-runtime-log-viewer`](2026-03-05-project-runtime-log-viewer/proposal.md)

### 2026-03-03

- [`2026-03-03-codex-native-plan-mode-sync-2026-02-28`](2026-03-03-codex-native-plan-mode-sync-2026-02-28/proposal.md)
- [`2026-03-03-codex-plan-official-parity-2026-03-03`](2026-03-03-codex-plan-official-parity-2026-03-03/proposal.md)

### 2026-03-02

- [`2026-03-02-codex-live-usage-entry-2026-03-02`](2026-03-02-codex-live-usage-entry-2026-03-02/proposal.md)
- [`2026-03-02-file-view-code-intelligence-navigation-2026-03-01`](2026-03-02-file-view-code-intelligence-navigation-2026-03-01/proposal.md)

### 2026-03-01

- [`2026-03-01-file-module-foundation-2026-03-01`](2026-03-01-file-module-foundation-2026-03-01/proposal.md)
- [`2026-03-01-fix-chat-template-bugs`](2026-03-01-fix-chat-template-bugs/proposal.md)
- [`2026-03-01-spec-hub-speckit-openspec-isolation-audit-2026-02-25`](2026-03-01-spec-hub-speckit-openspec-isolation-audit-2026-02-25/proposal.md)

## 2026-02 (44)

### 2026-02-27

- [`2026-02-27-chat-canvas-conversation-curtain-architecture-refactor`](2026-02-27-chat-canvas-conversation-curtain-architecture-refactor/proposal.md)
- [`2026-02-27-codex-plan-code-mode-realization`](2026-02-27-codex-plan-code-mode-realization/proposal.md)

### 2026-02-26

- [`2026-02-26-spec-hub-apply-auto-execution-feedback-2026-02-25`](2026-02-26-spec-hub-apply-auto-execution-feedback-2026-02-25/proposal.md)
- [`2026-02-26-spec-hub-session-switch-and-sidebar-entry-fix-2026-02-26`](2026-02-26-spec-hub-session-switch-and-sidebar-entry-fix-2026-02-26/proposal.md)
- [`2026-02-26-spec-hub-speckit-module-2026-02-25`](2026-02-26-spec-hub-speckit-module-2026-02-25/proposal.md)
- [`2026-02-26-workspace-home-shadcn-redesign-2026-02-25`](2026-02-26-workspace-home-shadcn-redesign-2026-02-25/proposal.md)

### 2026-02-25

- [`2026-02-25-codemoss-spec-hub-mvp-2026-02-23`](2026-02-25-codemoss-spec-hub-mvp-2026-02-23/proposal.md)
- [`2026-02-25-composer-project-scope-skill-command-discovery`](2026-02-25-composer-project-scope-skill-command-discovery/proposal.md)
- [`2026-02-25-spec-hub-openspec-hardening-2026-02-25`](2026-02-25-spec-hub-openspec-hardening-2026-02-25/proposal.md)

### 2026-02-24

- [`2026-02-24-t1-4-manual-memory-reference-in-chat`](2026-02-24-t1-4-manual-memory-reference-in-chat/proposal.md)

### 2026-02-23

- [`2026-02-23-codemoss-spec-platform-integration-2026-02-22`](2026-02-23-codemoss-spec-platform-integration-2026-02-22/proposal.md)
- [`2026-02-23-t1-3-ui-memory-list-improvements`](2026-02-23-t1-3-ui-memory-list-improvements/proposal.md)

### 2026-02-22

- [`2026-02-22-git-panel-create-pr-button`](2026-02-22-git-panel-create-pr-button/proposal.md)

### 2026-02-21

- [`2026-02-21-fix-worktree-publish-recovery-and-git-command-stability`](2026-02-21-fix-worktree-publish-recovery-and-git-command-stability/proposal.md)

### 2026-02-20

- [`2026-02-20-git-branch-list-context-menu`](2026-02-20-git-branch-list-context-menu/proposal.md)
- [`2026-02-20-git-commit-history-context-menu-reset-flow`](2026-02-20-git-commit-history-context-menu-reset-flow/proposal.md)
- [`2026-02-20-git-history-pull-dialog-options`](2026-02-20-git-history-pull-dialog-options/proposal.md)
- [`2026-02-20-git-history-push-dialog-options`](2026-02-20-git-history-push-dialog-options/proposal.md)
- [`2026-02-20-worktree-explicit-base-selection-followup`](2026-02-20-worktree-explicit-base-selection-followup/proposal.md)

### 2026-02-19

- [`2026-02-19-worktree-explicit-base-selection`](2026-02-19-worktree-explicit-base-selection/proposal.md)

### 2026-02-18

- [`2026-02-18-fix-session-hard-delete-and-enable-opencode-home`](2026-02-18-fix-session-hard-delete-and-enable-opencode-home/proposal.md)
- [`2026-02-18-git-history-panel`](2026-02-18-git-history-panel/proposal.md)
- [`2026-02-18-improve-codex-plan-visibility-and-default-mode`](2026-02-18-improve-codex-plan-visibility-and-default-mode/proposal.md)
- [`2026-02-18-opencode-session-hard-delete`](2026-02-18-opencode-session-hard-delete/proposal.md)
- [`2026-02-18-t1-4-ui-workspace-sidebar-harmony`](2026-02-18-t1-4-ui-workspace-sidebar-harmony/proposal.md)
- [`2026-02-18-unify-canvas-session-lifecycle`](2026-02-18-unify-canvas-session-lifecycle/proposal.md)

### 2026-02-17

- [`2026-02-17-optimize-codex-chat-canvas`](2026-02-17-optimize-codex-chat-canvas/proposal.md)

### 2026-02-15

- [`2026-02-15-git-panel-tree-view-a11y-and-test-followup`](2026-02-15-git-panel-tree-view-a11y-and-test-followup/proposal.md)
- [`2026-02-15-git-panel-tree-view-single-diff`](2026-02-15-git-panel-tree-view-single-diff/proposal.md)
- [`2026-02-15-opencode-non-streaming-resilience`](2026-02-15-opencode-non-streaming-resilience/proposal.md)

### 2026-02-14

- [`2026-02-14-opencode-chat-send-guard-and-panel-onboarding`](2026-02-14-opencode-chat-send-guard-and-panel-onboarding/proposal.md)
- [`2026-02-14-opencode-chat-stability-hardening`](2026-02-14-opencode-chat-stability-hardening/proposal.md)
- [`2026-02-14-opencode-engine-isolation-hardening`](2026-02-14-opencode-engine-isolation-hardening/proposal.md)
- [`2026-02-14-opencode-first-session-binding-fix`](2026-02-14-opencode-first-session-binding-fix/proposal.md)
- [`2026-02-14-opencode-provider-panel-ux-refactor`](2026-02-14-opencode-provider-panel-ux-refactor/proposal.md)
- [`2026-02-14-opencode-session-concurrency-hardening`](2026-02-14-opencode-session-concurrency-hardening/proposal.md)

### 2026-02-13

- [`2026-02-13-opencode-chat-layout-phase4`](2026-02-13-opencode-chat-layout-phase4/proposal.md)
- [`2026-02-13-opencode-cli-capabilities-phase2`](2026-02-13-opencode-cli-capabilities-phase2/proposal.md)
- [`2026-02-13-opencode-engine-integration`](2026-02-13-opencode-engine-integration/proposal.md)
- [`2026-02-13-opencode-mode-ux-phase3`](2026-02-13-opencode-mode-ux-phase3/proposal.md)

### 2026-02-12

- [`2026-02-12-improve-filetree-multitab-and-composer-visibility`](2026-02-12-improve-filetree-multitab-and-composer-visibility/proposal.md)
- [`2026-02-12-link-composer-with-active-file-tab`](2026-02-12-link-composer-with-active-file-tab/proposal.md)
- [`2026-02-12-t1-4-panel-lock-screen-overlay`](2026-02-12-t1-4-panel-lock-screen-overlay/proposal.md)

### 2026-02-11

- [`2026-02-11-add-kanban-linked-issues-and-bulk-delete`](2026-02-11-add-kanban-linked-issues-and-bulk-delete/proposal.md)

## Maintenance Contract

- 每次 archive change 后，同步更新本页的 proposal link 与顶部计数。
- 只索引实际存在的 `proposal.md`；不得为缺失 artifact 构造虚假链接。
- 归档历史只追加或校准链接，不覆盖 proposal / design / tasks / verification 的原始证据。
