## Why

Composer 会话控制菜单（智能体 / 计划模式 / Speed / Fork / Review / 实时用量 / 记忆参考）当前是**窄下拉 + 二级 flyout**。实时用量要再开一层才能看到 Rate limit / tokens，且菜单宽度与对话框脱节，浅色/深色下视觉层级不统一。产品已选定 **Metrics HUD 双栏** 视觉方向：左控制列表 + 右 Quota 侧栏，在对话框上方**宽度自适应填满**，主题双态适配。本变更只改 UI 布局与主题表现，不改额度查询、引擎绑定或其它后端逻辑。

## What Changes

- 将会话控制表面从「窄 dropdown 列表」升级为 **Session Control HUD**：
  - 锚定在 Composer / 对话框**上方**打开
  - **宽度跟随对话框**（自适应填满，含 resize）
  - **左栏**：既有控制项（智能体、计划模式、Speed、Fork、Review、实时用量、记忆参考等）
  - **右栏**：Quota Window 摘要（Used / Reset / Provider + 简易 sparkline 或既有进度条），**默认可见**，不再依赖二级 submenu 才出现
  - **底栏**：附件/消息/历史/样式等工具入口 + agent pack pills（沿用现有入口，仅重排）
- 使用 **CSS 变量 / 现有 theme tokens** 做浅色与深色适配；禁止写死仅暗色 hex。
- 保留现有回调与数据源：`usageSnapshot` / `refreshUsageSnapshot`、plan mode toggle、speed select、fork/review、agent 选择、memory reference——**仅改呈现与布局**。
- 补充/更新前端单测与 i18n 展示文案键（若需要），**不新增 Tauri command / IPC / 轮询**。

## 目标与边界

### 目标

1. 打开会话控制时，面板宽度与 Composer 对话框对齐（或等于其 content 宽），随窗口与 Composer 宽度变化自适应。
2. Metrics HUD 双栏信息架构落地：左控制、右 Quota，用量信息不需要再 hover/click 二级 submenu 才能看到主指标。
3. 浅色 / 深色主题均可读、对比度合格，选中态与分隔线使用语义 token。
4. 既有动作可达性不回退（键盘 Esc 关闭、点击外部关闭、各入口仍可触发）。
5. 实现范围严格 **UI-only**。

### 边界

- 只动 Composer tool menu / ConfigSelect 相关布局与样式（及必要的 popover 定位宽度策略）。
- 用量数字、百分比、loading/error 文案继续使用现有 `usageSnapshot`（或等价前端 view model）；**不改** `get_coding_plan_quota` / `account_rate_limits` 契约。
- Status Panel 的 `SessionOverviewSection` **不在本 change 重做**（可复用展示语义，但默认不合并两套 UI 源）。

## 非目标

- **不**新增后端接口、Rust 模块、轮询、额度算法。
- **不**重做 Status Panel 结果 tab / checkpoint / cost 整页。
- **不**改 send pipeline、engine 选择、provider binding、agent 存储 schema。
- **不**强制所有 provider 都显示完整 KPI 条；无数据时右栏展示既有 empty / `--` 态即可。
- **不**把 HTML 原型直接当生产代码；原型仅作视觉参考。

## Capabilities

### New Capabilities

- `composer-session-control-hud`：Composer 对话框上方会话控制 HUD 的布局、宽度锚定、双栏（控制 + Quota）、浅深主题与 UI-only 数据绑定契约。

### Modified Capabilities

- `composer-tool-menu-primary-controls`：会话控制入口打开后的表面形态从「纯列表 dropdown」扩展为「可宽幅 HUD」；primary 动作集合不变，呈现容器变更。

## Impact

| 层 | 影响 |
|----|------|
| Frontend UI | `ConfigSelect.tsx`（inline tool menu 结构）、相关 `selectors.css` / theme tokens、可能 `ComposerContextMenuPopover` 或 Dropdown content 宽度定位 |
| Hooks / data | **复用**现有 usage snapshot / plan mode / agents；无新 store 契约 |
| Backend / IPC | **无** |
| i18n | 可能补 `QUOTA WINDOW` / Used / Reset 展示键（或复用 `home.usageSnapshot` 等既有键） |
| Tests | ConfigSelect / tool menu 布局与主题相关 Vitest；定位宽度回归 |
| OpenSpec | 本 change + 上述 capability delta |
| Demo | `_temp/design-demos/composer-slide-panel-10-variants.html` 仅参考，不入库 gate |

## 技术方案对比

| 选项 | 描述 | 取舍 |
|------|------|------|
| A. 仅 CSS 加宽现有 DropdownMenu | 改 `min-width`，submenu 仍二级 | 用量仍藏二级；难做双栏与填满对话框；**不够** |
| B. 新独立 React 面板 + 新 API 拉额度 | 全新组件 + 后端 | 超出 UI-only；重复 Session Overview；**拒绝** |
| **C. 重组 tool menu 为双栏 HUD，锚定 Composer 宽，复用现有 snapshot（推荐）** | 改布局 + 定位 + theme tokens | 满足视觉与自适应；零后端；动作契约可测 |

采用 **C**。

## 验收标准

1. 在对话框上方打开会话控制：面板 **left/right 与 Composer 内容区对齐**（允许 ±8px 边距），宽度随 Composer resize 更新。
2. 打开后 **默认可见** Quota 侧栏主指标（Used / Reset / Provider 或既有 session limit 百分比）；无数据时显示 `--` / empty，不崩溃。
3. 浅色主题与深色主题下：背景、文字、选中行、分隔线均可读；无写死仅 dark 的硬编码色主导样式。
4. 智能体、计划模式开关、Speed、Fork、Review、记忆参考、附件类底栏入口行为与改前一致（仅布局变化）。
5. Esc / 点击外部关闭仍可用；焦点不困在不可见节点。
6. **无**新增 Tauri command；`git diff` 不含 `src-tauri` 业务逻辑（样式无关则可不碰）。
7. 相关 Vitest 通过；手动：浅/深主题各走一遍打开 → 看用量 → 切换 plan mode → 关闭。
