## Context

- **现状**：`ConfigSelect.tsx` 的 `inline` tool menu 使用 Radix `DropdownMenu` 纵向列表；「实时用量」是 `DropdownMenuSub`，Quota 在二级 `composer-tool-menu-usage` 里。宽度固定/内容驱动，与 Composer 对话框宽度无关。
- **目标视觉**：Metrics HUD（用户选定）——左控制列表 + 右 `QUOTA WINDOW` + 底工具栏，深色样张已确认；需同时适配浅色。
- **约束**：UI-only；复用 `usageSnapshot` / `refreshUsageSnapshot` 与现有 handlers。

参考截图语义：

```
┌──────────────────────────── Composer width ────────────────────────────┐
│ 左：智能体 / 计划模式 / Speed / Fork / Review / 实时用量 / 记忆参考     │ 右：QUOTA │
│                                                                        │ WINDOW  │
│ 底：附件 · 消息 · 历史 · 样式                    [pills: agents…]      │
└────────────────────────────────────────────────────────────────────────┘
                              ↑ 锚定在对话框上方
```

## Goals / Non-Goals

**Goals**

- 双栏 HUD 布局 + 宽度锚定 Composer
- 浅/深主题 token 化
- Quota 主指标默认可见
- 动作契约零回退

**Non-Goals**

- 后端额度、新 IPC、Status Panel 整页重构
- 复杂图表库；sparkline 可用纯 CSS/SVG 占位，数据来自既有百分比序列若无则静态空态

## 技术方案对比（实现路径）

| 选项 | 做法 | 取舍 |
|------|------|------|
| A. 继续 100% Radix Dropdown content 内 flex 双栏 | 改 `DropdownMenuContent` class + 内部 grid | 定位/宽度受 Radix collision 影响；可先做 |
| B. 打开时改用 `ComposerContextMenuPopover` portal 自绘 HUD | 自管 position + width = anchor width | 宽度锚定更准；需复刻 a11y |
| **C. Hybrid（推荐）** | 触发仍用现有 `+` / Config 入口；content 渲染 `SessionControlHud` 组件；宽度用 `var(--composer-hud-width)` 或 measure Composer root | 最小侵入 + 可测 |

采用 **C**：抽出展示组件，数据仍由 ConfigSelect / parent 注入。

## Architecture

```
Composer / ChatInputBox
  └─ ConfigSelect (inline tool menu trigger)
       └─ onOpen → measure composer shell width
       └─ SessionControlHud
            ├─ LeftRail   (rows + toggles + nested pickers)
            ├─ QuotaPane  (usageSnapshot view)
            └─ FooterTools (attachments / pills)
```

### 宽度锚定

1. 打开菜单时读取 Composer 外壳（`chat-input-box` / composer shell）`getBoundingClientRect().width`。
2. 设 CSS 变量 `--composer-session-hud-width: ${width}px` 到 content 根。
3. HUD `width: var(--composer-session-hud-width)`，`max-width: min(100vw - 16px, var(...))`。
4. `resize` / Composer 高度拖拽结束后重测（与现有 `ComposerContextMenuPopover` 的 window listener 同级）。

### 布局

- Root：`display: grid; grid-template-rows: 1fr auto; grid-template-columns: minmax(0,1.15fr) minmax(160px,0.85fr)`（窄屏 `< 480px` 时 Quota 叠到下方或折叠为可展开区块）。
- 左栏行高与现 tool menu row 接近；选中「实时用量」高亮左行，右栏始终展示摘要（不依赖二级 open）。
- Speed / 智能体：保留 submenu 或行内弹出层，**不要**为选一项关掉整个 HUD（除非现行为如此且产品接受）。

### 主题

- 使用既有 semantic tokens（如 `--bg-elevated`、`--fg-primary`、`--fg-muted`、`--border-subtle`、`--accent`）。
- 暗色样张映射到 dark tokens；浅色用 light tokens + 略浅 elevated 背景。
- 禁止在组件 style 中写死 `#0b1220` 等仅 dark 色为唯一背景。

### 数据绑定（只读复用）

| UI 位 | 数据源 |
|-------|--------|
| Used / session % | `usageSnapshot.sessionPercent` 等既有字段 |
| Reset | 既有 reset/window 文案字段；无则 `--` |
| Provider | 当前 model/provider 展示名（已有 props） |
| Sparkline | 可选：若无历史序列则用单进度条代替，**不**新拉 API |
| Refresh | 既有 `refreshUsageSnapshot` |

### 交互

- Esc / outside click：沿用 Dropdown 关闭。
- Plan mode Switch：`preventDefault` on select 防止关菜单（现状已有则保留）。
- 打开 HUD 时若用量可能 stale：可在 open 时 `void refreshUsageSnapshot()`（与现 submenu open 行为一致），**不**新增轮询。

## File touch list（预期）

| 文件 | 变更 |
|------|------|
| `src/features/composer/components/ChatInputBox/selectors/ConfigSelect.tsx` | 组装 HUD 结构 |
| 新建 `SessionControlHud.tsx`（同目录或 `components/`） | 纯展示 + a11y 结构 |
| `styles/selectors.css`（及/或 `session-control-hud.css`） | 双栏 / footer / theme |
| 可能 `ComposerContextMenuPopover.tsx` | 仅当需要 width=anchor 的 portal 策略 |
| `*.test.tsx` | 宽度 class、Quota 默认可见、主题 class |
| i18n `composer.ts` / `home` | 复用优先，缺键再补 |

**禁止**：`src-tauri/**` 业务逻辑。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| Radix 定位与自定义宽度冲突 | measure + collision padding；必要时 portal 到 body 并 left=composer.left |
| 窄窗口双栏挤压 | breakpoint 单栏堆叠 |
| 浅色对比不足 | 对照现有 selectors light theme 测试 |
| 与 Status Panel 用量 UI 重复 | 文案可一致但组件不硬耦合；本 change 不合并 |

## Migration Plan

1. 落地 `SessionControlHud` + CSS tokens（feature 无 flag 也可，视觉替换）。
2. 接 ConfigSelect inline 路径。
3. 测浅/深 + resize。
4. 删除仅服务于旧二级 usage 的冗余样式（确认无其它引用）。

回滚：还原 ConfigSelect 列表结构与 CSS；无数据迁移。

## Open Questions

1. 窄于 ~480px 时：Quota 堆叠在下 vs 默认折叠？**默认建议堆叠**。
2. sparkline 无时间序列时是否一律进度条？**是**。
3. 非 Codex provider 是否也显示右栏？**显示 empty/`--` 右栏以保持布局稳定**（避免左右跳动）。
