# Design: hide-startup-gate-overlay

## Context

`AppRouter` 原先在 main window 同时挂载 `AppShell` 与 `StartupGateOverlay`。第一阶段已取消该 global mount；新增需求是在“其他设置”提供一个默认关闭的本机测试开关，让用户能在需要时恢复 overlay。Overlay 自身负责 platform guard、全屏 click interception、startup trace 展示、10 秒 force-enter 与 20 秒 absolute ceiling；后台 startup orchestration 由 AppShell 相关 hooks 独立驱动。

本次仍是 presentation policy 变更：默认停止展示 overlay，但允许显式进入 test mode。实现不删除 overlay，也不改变 hydration、milestone、stale cancellation 或 `uiScale` startup guard。`uiScale` 仍可通过 `startup-gate-ready` 或既有 12 秒 ceiling 收敛。

## Goals / Non-Goals

**Goals:**

- default-off 时 main window 只挂载 `AppShell`，不实例化 `StartupGateOverlay`。
- 用户开启测试开关后，在下次 main window mount 时恢复 `StartupGateOverlay`。
- 开关放在“其他设置”底部，并清楚说明 next-start-only 语义。
- 保留 overlay 组件、诊断 helper、兼容 export、i18n 和 unit tests。
- 用 Router 与 settings regression tests 保护 composition 和 persistence boundary。

**Non-Goals:**

- 不改变 startup orchestration 的状态机与 task owner。
- 不调整 gate timer、force-enter 或诊断组件内部实现。
- 不修改 Rust / `AppSettings` schema，不增加 backend API 或 dependency。
- 不在当前 settings session 即时挂载 overlay。
- 不为 detached windows 增加 startup overlay。

## Decisions

### D1. 在 Router composition boundary 采用 default-off conditional mount

`AppRouter` 用 lazy `useState` initializer 在 mount 时读取一次 test flag。default-off 返回 `AppShell`；显式开启时返回 `AppShell` + `StartupGateOverlay`。该 state 位于 route branches 之前以满足 React hook order，但 JSX 只存在于 main window 分支；detached windows 永不挂载 overlay。

**Alternatives:**

- 每次 render 直接读 localStorage：拒绝。设置页更新可能通过父级 render 让 overlay 在当前窗口突然出现。
- module-level constant：拒绝。测试隔离差，且 module lifetime 不等于 Router mount lifetime。
- 组件内部固定 `return null`：拒绝。无法满足显式恢复测试能力。

### D2. 使用 feature-local localStorage helper

新增 `startupGateOverlayTestFlag.ts` 封装同步读写。仅 `"1"` 为 true；关闭时删除 key；storage 不可用、拒绝访问或值异常时安全回退 false。该开关仅是本机诊断偏好，不进入跨层 `AppSettings`。

### D3. 设置页切换只持久化，不即时 reload

`OtherSection` 初始化 Switch state 时读取 helper；切换时先写 storage，再以 helper 读取结果回填 controlled Switch。文案明确“下次启动生效”，避免正在编辑设置时突然出现全屏遮罩或 reload 丢失草稿。UI 复用既有 `settings-toggle-*` classes，不新增 CSS。

### D4. 保留组件测试，扩展 Router sentinel

`StartupGateOverlay.test.tsx` 继续验证组件自身能力。`router.test.tsx` mock flag reader 与 overlay sentinel，分别覆盖 default-off、explicit opt-in，以及 detached window isolation。`OtherSection.test.tsx` 覆盖默认关闭和 localStorage 持久化。

### D5. 不迁移 overlay side effects

不把 force-enter、diagnostic copy 或 auto-close side effects 搬入 AppShell。它们属于被隐藏 surface 的行为；startup orchestration 和 `uiScale` 已有独立 readiness / ceiling contract。

### D6. 提交前校准 AppShell domain ownership catalog

全量测试确认 `rawAppShellDomainContexts.workspaceNavigationContext` 已包含 `handleRevertRepositoryFiles`，`useAppShellLayoutNodesSection` 也从该 domain 消费它，但 `APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS` 仍把该 key 留在 `composerContext`。实现 MUST 仅将 key 从 `composerContext` 移到 `workspaceNavigationContext`，不得改动 production context composition、consumer wiring 或放宽 drift test。

**Alternatives:**

- 把 production property 改回 `composerContext`：拒绝。会逆转已经正确的 layout-section dependency，并扩大 runtime 变更。
- 在 drift test 中忽略该 key：拒绝。会隐藏 ownership catalog 与真实 context 的分叉。

### D7. 提交前校准 Sidebar 本地配置测试 selector

全量测试继续发现 `Sidebar.test.tsx` 两处 selector 仍查询旧显示名 `codex-tui/default-config`，而 production contract 与 payload assertion 已统一为 `本地配置`。实现 MUST 只补齐 test i18n mock 并更新这两处 selector，不得回退 production UI 或 provider payload。

## Risks / Trade-offs

- [初始化期间用户可立即点击，可能与后台 hydration 竞争] → 依赖现有 bounded first-paint、single in-flight、stale cancellation；本 change 不宣称消除底层性能风险。
- [测试开关长期保持开启会让每次启动被遮罩] → 开关默认关闭、文案标记测试用途；overlay 仍有 10 秒 force-enter 和 20 秒 absolute ceiling，用户可进入设置关闭，不构成永久 lockout，因此不新增 startup guard。
- [localStorage 不可写] → helper best-effort 写入并回读，Switch 回到真实持久化状态；默认仍为关闭。
- [Overlay tests 通过但默认产品不展示] → Router sentinel test 明确锁定 default-off 与 opt-in 两种 composition policy。

## Migration Plan

1. 更新 OpenSpec contract，增加 default-off / opt-in / next-start-only scenarios。
2. 新增 feature-local persistence helper 与 settings Switch。
3. 在 Router 增加 boot snapshot conditional mount，并扩展 focused tests。
4. 运行 focused tests、typecheck、target lint 和 OpenSpec strict validation；按用户明确要求不再重跑 full suite。
5. 回滚时移除 settings row、helper 与 Router conditional branch；无需数据迁移，残留 localStorage key 会被忽略。

## Open Questions

无。用户已明确选择“默认关闭、下次启动生效”。
