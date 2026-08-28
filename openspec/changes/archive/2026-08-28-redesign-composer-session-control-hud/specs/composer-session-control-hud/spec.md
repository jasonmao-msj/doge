# composer-session-control-hud Specification

## Purpose

定义 Composer 对话框上方 **Session Control HUD** 的布局、宽度锚定、双栏信息架构与浅/深主题表现。本 capability 仅约束 **UI 呈现与前端绑定**；额度数据 MUST 复用既有前端 snapshot，MUST NOT 引入新后端查询契约。

## ADDED Requirements

### Requirement: Session Control HUD MUST anchor width to the composer dialog

打开会话控制表面时，HUD 根容器宽度 MUST 与当前 Composer / 对话框内容区宽度对齐（允许固定外边距 ≤ 8px），并在窗口或 Composer 尺寸变化后重新测量更新。

#### Scenario: open aligns to composer width

- **WHEN** 用户打开会话控制 HUD
- **AND** Composer 外壳可测量
- **THEN** HUD 可视宽度 MUST 等于 Composer 内容宽度（±8px 边距内）
- **AND** MUST NOT 使用与对话框无关的固定窄宽（例如仅 240px 列表）作为默认宽

#### Scenario: resize updates width

- **WHEN** HUD 处于打开状态
- **AND** 用户调整窗口宽度或 Composer 宽度
- **THEN** 系统 MUST 在合理时间内（下一帧或 resize 回调）更新 HUD 宽度
- **AND** 不得残留明显错位的 left/width

### Requirement: HUD MUST use dual-pane Metrics layout

HUD MUST 提供左栏会话控制列表与右栏 Quota 摘要区；右栏主指标 MUST 在 HUD 打开时默认可见，MUST NOT 仅依赖二级 flyout/submenu 才能看到 Used / session limit 等主信息。

#### Scenario: quota pane visible on open

- **WHEN** 用户打开 HUD
- **THEN** 右栏 Quota 区域 MUST 可见
- **AND** MUST 展示至少一项主指标或明确的 empty/`--` 态

#### Scenario: left rail keeps control actions

- **WHEN** HUD 打开
- **THEN** 左栏 MUST 暴露既有控制入口（在引擎支持范围内）：智能体、计划模式、Speed、Fork、Review、实时用量、记忆参考
- **AND** 各入口触发的业务回调 MUST 与改前语义一致

#### Scenario: narrow viewport stacks panes

- **WHEN** 可用宽度低于实现约定的窄屏阈值（建议 480px）
- **THEN** HUD MUST 将 Quota 区堆叠到控制列表下方或等价单栏布局
- **AND** MUST NOT 出现不可滚动的严重水平裁切导致主操作不可达

### Requirement: HUD MUST support light and dark themes via tokens

HUD 视觉 MUST 使用语义化主题 token（或项目既有 CSS 变量），在浅色与深色主题下均保持可读对比度。

#### Scenario: dark theme readable

- **WHEN** 应用处于深色主题
- **THEN** HUD 背景、主文字、次要文字、选中行、分隔线 MUST 可区分
- **AND** MUST NOT 出现浅色主题专用硬编码导致文字不可见

#### Scenario: light theme readable

- **WHEN** 应用处于浅色主题
- **THEN** HUD 背景、主文字、次要文字、选中行、分隔线 MUST 可区分
- **AND** MUST NOT 仅使用深色样张硬编码 hex 作为唯一背景/前景

### Requirement: Quota pane MUST bind existing frontend snapshot only

Quota 区展示的百分比、余额提示、loading、error、refresh MUST 绑定既有前端 usage / session snapshot 与 refresh 回调；MUST NOT 新增 Tauri command、MUST NOT 引入轮询。

#### Scenario: refresh reuses existing callback

- **WHEN** 用户触发用量刷新（若 UI 提供刷新控件）
- **THEN** 系统 MUST 调用既有 `refreshUsageSnapshot`（或等价既有函数）
- **AND** MUST NOT 发起本 capability 新增的后端接口

#### Scenario: missing data shows safe empty

- **WHEN** snapshot 无可用百分比或字段为 null
- **THEN** UI MUST 显示 `--` 或既有 empty 文案
- **AND** MUST NOT 因空数据崩溃或抛未捕获异常

### Requirement: Closing and keyboard behavior MUST remain predictable

HUD MUST 支持 Escape 关闭与点击外部关闭（与宿主菜单/popover 契约一致），关闭后不得残留不可见焦点陷阱。

#### Scenario: escape closes hud

- **WHEN** HUD 打开且用户按下 Escape
- **THEN** HUD MUST 关闭

#### Scenario: outside click closes hud

- **WHEN** HUD 打开且用户点击 HUD 与触发器外的区域
- **THEN** HUD MUST 关闭
