## ADDED Requirements

### Requirement: Main client startup MUST default to no global startup gate overlay with explicit local test opt-in

主窗口启动 composition MUST 默认直接渲染 `AppShell` 且不 mount `StartupGateOverlay`。系统 MAY 通过“其他设置”中默认关闭的本机测试开关，在下次 main window mount 时显式恢复 overlay。startup orchestration、first-paint hydration、`startup-gate-ready` 与后台 full-catalog flow MUST 继续由既有 owner 独立运行。

#### Scenario: Main window defaults to no startup gate

- **WHEN** application 打开 main client window 且 test flag 缺失、关闭或值无效
- **THEN** `AppRouter` MUST render `AppShell`
- **AND** `AppRouter` MUST NOT instantiate `StartupGateOverlay`
- **AND** 用户 MUST NOT 看到或被全屏 startup gate 阻断

#### Scenario: Explicit test opt-in restores startup gate on next start

- **WHEN** 用户在“其他设置”开启 startup loading test switch
- **AND** application 后续创建新的 main `AppRouter` mount
- **THEN** `AppRouter` MUST render `AppShell`
- **AND** `AppRouter` MUST mount the retained `StartupGateOverlay`
- **AND** overlay MUST continue using its existing platform guard、force-enter 与 absolute ceiling behavior

#### Scenario: Toggle does not interrupt the current settings session

- **WHEN** 用户在当前 main window 修改 startup loading test switch
- **THEN** selection MUST persist locally
- **AND** current `AppRouter` mount MUST NOT immediately add or remove the overlay
- **AND** UI copy MUST state that the change takes effect on the next app start

#### Scenario: Background startup orchestration remains active

- **WHEN** main window 不再 mount `StartupGateOverlay`
- **THEN** bounded first-paint hydration 与后续 startup tasks MUST continue through their existing owners
- **AND** implementation MUST NOT 通过删除 milestone、hydration 或 stale-cancellation logic 来隐藏 overlay

#### Scenario: Startup gate implementation remains recoverable

- **WHEN** startup gate presentation 被隐藏
- **THEN** `StartupGateOverlay` component、diagnostic helper、compatibility export 与 focused unit tests MUST remain in the codebase
- **AND** 恢复展示 MUST NOT require data migration or dependency installation

#### Scenario: Detached window routing remains unchanged

- **WHEN** application 打开 about、file explorer、Spec Hub、client documentation 或 Browser Agent detached window，无论 test flag 是否开启
- **THEN** existing route-specific view MUST render as before
- **AND** change MUST NOT mount startup gate into those windows
