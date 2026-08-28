## 1. 结构与组件

- [x] 1.1 新增 `SessionControlHud` 展示组件（左栏 / 右 Quota / 底栏），props 仅接收现有回调与 `usageSnapshot`
- [x] 1.2 在 `ConfigSelect` inline 路径接入 HUD，替换「纯纵向 + 用量二级 sub」为默认双栏
- [x] 1.3 打开时 measure Composer 外壳宽度，写入 `--composer-session-hud-width`（或等价 style），并监听 resize 更新

## 2. 样式与主题

- [x] 2.1 新增/扩展 CSS：双栏 grid、选中行、底栏 tools、Quota 区、窄屏堆叠
- [x] 2.2 全部颜色走语义 token / 现有 theme 变量；验证 light + dark
- [x] 2.3 无 snapshot 时进度条/`--` empty 态；可选 CSS sparkline，无序列则退回单进度条

## 3. 交互保真

- [x] 3.1 Plan mode / Speed / Agent / Fork / Review / Memory / 附件类入口行为与改前一致
- [x] 3.2 打开 HUD 时沿用既有 `refreshUsageSnapshot`（若原先 submenu open 会刷）
- [x] 3.3 Esc / outside click 关闭；Switch 点击不误关（保留 preventDefault 模式）

## 4. 文案与 a11y

- [x] 4.1 Quota 标题与 Used/Reset/Provider 优先复用 i18n；缺键再补中英（及项目要求的 locale）
- [x] 4.2 右栏与关键按钮具备可访问名称；选中行状态可感知

## 5. 测试与验收

- [x] 5.1 Vitest：HUD 渲染时 Quota 默认在文档中；关键回调被触发
- [x] 5.2 Vitest 或 DOM 断言：root 使用锚定宽度策略（style/var/class）
- [x] 5.3 手动：浅/深主题、resize Composer、无用量数据、Codex 与非 Codex 各一次（用户确认主路径 OK）
- [x] 5.4 确认 `openspec validate` 通过；后端额度查询为既有 `get_coding_plan_quota` 复用（非新建 IPC）
- [x] 5.5 Kimi CLI 走 OAuth refresh + `/usages`（via=cli）；Claude/Codex 绑 Kimi HTTP 不改
- [x] 5.6 右侧额度复用 `useCodingPlanQuota` + `buildSessionOverviewQuota`（DeepSeek/MiniMax/智谱等）

## 6. 收尾

- [x] 6.1 原型 HTML 仅 `_temp` 本地对照，不入库
- [x] 6.2 实现完成后用户确认并 commit + Trellis session record
