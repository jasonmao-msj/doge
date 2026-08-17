## ADDED Requirements

### Requirement: Main AppShell startup SHALL be gated by account and engine readiness
main window startup orchestration MUST 在 account session、selected engine entitlement、managed vault binding 与 configuration readiness 被 authoritative prove 后才挂载 AppShell 和启动 managed engine runtime；gate UI 自身 SHALL 保持 first-paint critical path 最小化。

#### Scenario: Gate renders before AppShell
- **WHEN** main window cold start 且 readiness 尚未证明
- **THEN** startup SHALL 渲染轻量 account gate，并且不执行 AppShell workspace hydration、engine discovery 或 managed runtime prewarm

#### Scenario: Readiness becomes committed
- **WHEN** AccountRuntime 发布 committed ready snapshot
- **THEN** startup SHALL 只挂载一次 AppShell，并在挂载后按既有 phase orchestration 启动 workspace work

#### Scenario: Account event wakes the gate
- **WHEN** payment、session 或 managed access event 到达
- **THEN** gate SHALL coalesce authoritative refresh，且不得把每个 event 或 reconciliation tick 作为 AppShell root state update

#### Scenario: Detached window starts without readiness
- **WHEN** detached window route 在 main account readiness 不成立时启动
- **THEN** detached window SHALL fail closed 或等待已提交的 process-level ready state，不得自行绕过 account gate

### Requirement: Windows startup SHALL tolerate hostile external engine wrappers
Windows startup 与 engine discovery MUST 把外部 executable/wrapper 视为不可信输入；任一 probe 挂起、等待 stdin、启动 descendant 或重复启动 App 都不得阻塞/复制主界面。

#### Scenario: Version probe never exits
- **WHEN** `claude --version` 或其他 engine probe 在 4 秒 deadline 内没有退出
- **THEN** probe SHALL 标记 timeout、终止 root 与 descendant process tree、回收 child，并允许其他 engine status 与主界面继续工作

#### Scenario: Wrapper waits for input
- **WHEN** 外部 wrapper 尝试从 stdin 读取登录或交互输入
- **THEN** Doge SHALL 以 closed stdin 启动 probe，且不得显示 console window 或等待用户输入

#### Scenario: User launches Doge repeatedly
- **WHEN** Windows 用户在已有 Doge 实例运行或最小化时再次打开快捷方式
- **THEN** 系统 SHALL 保持单一实例，恢复、显示并聚焦已有 main window，而不是创建第二套 startup probes
