# composer-tool-menu-primary-controls Delta

## Purpose

扩展 Composer secondary/tool 菜单打开后的 **表面形态**：在保留 primary 控件可达性的前提下，会话控制可呈现为宽幅 Session Control HUD，而非仅窄列表 dropdown。

## MODIFIED Requirements

### Requirement: Composer secondary tools MUST be grouped behind a compact tool menu

Composer SHALL 在直接 toolbar 空间有限时，将 secondary tools 与会话控制动作分组到 compact 入口（例如 `+` / config menu）。打开后的内容表面 MAY 为：

1. 传统纵向 dropdown 列表；或
2. **Session Control HUD**（双栏：控制 + Quota，宽度锚定 Composer）

无论何种表面，submit/stop 等 primary 控件 MUST 仍保持在 Composer 主行立即可见；会话控制动作集合 MUST 保持可到达。

#### Scenario: 普通工作区聊天

- **WHEN** 普通工作区聊天
- **THEN** 当 Composer toolbar 渲染时，secondary tools 必须可从 compact 入口到达
- **AND** submit/stop 仍保持立即可见

#### Scenario: session control opens as HUD when enabled by product UI

- **WHEN** 产品 UI 采用 Session Control HUD 表面
- **AND** 用户打开会话控制入口
- **THEN** 表面 MUST 满足 `composer-session-control-hud` 的宽度锚定与双栏默认可见 Quota 要求
- **AND** 既有 secondary 动作（在引擎支持范围内）MUST 仍可从该表面到达

## ADDED Requirements

### Requirement: Tool menu surface change MUST remain UI-only for session controls

将会话控制从窄列表升级为 HUD 时，MUST NOT 改变 send pipeline、provider binding、额度后端契约或引入新的 Tauri command。

#### Scenario: no new backend dependency

- **WHEN** 实现 Session Control HUD
- **THEN** 变更 MUST 仅依赖既有前端 props / hooks / snapshot
- **AND** MUST NOT 新增额度查询 IPC
