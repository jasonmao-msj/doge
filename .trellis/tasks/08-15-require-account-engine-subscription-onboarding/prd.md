# 强制账号与引擎订阅式启动闭环

OpenSpec single source of truth：`openspec/changes/require-account-engine-subscription-onboarding/`。

## 用户目标

面向不理解 API Key、Provider 和配置文件的小白用户，把 Doge 主路径收敛为：登录 → 选择 Codex/Claude Code → 有订阅则自动准备；无订阅则展示 token2api 当前公开可售套餐 → 支付 → 自动创建/恢复 managed credential → 自动配置 → 进入 App。

本轮把“自动准备”补齐为完整工具链：macOS/Windows 安装包内置 pinned 官方 Codex/Claude binary，运行时不下载。无外部安装时自动使用 bundled；外部版本相同或更高时静默复用；外部版本较低时提示一次选择 bundled 新版或保留现有版，且绝不覆盖用户全局安装。Windows/macOS 都不得要求管理员权限。Windows 已有配置文件替换必须在当前用户 profile 内可靠完成，并给出 stable 可恢复错误。

登录后的第二引擎增购复用同一闭环：从 main engine picker 或 Settings“我的引擎”直接进入目标 engine 套餐；flow 覆盖在已挂载 AppShell 上，cancel 保留原 workspace/conversation，支付完成后自动配置并打开目标 engine 的空白新会话，原 engine 订阅不受影响。

额度页按每个 active subscription engine 展示 subscription-owned daily/weekly/monthly 总额、已用、剩余、进度与重置时间；最近一年使用 GitHub-style daily heatmap，hover/focus 某天按需读取该 engine 当天 model breakdown。所有读取仅由打开页面、刷新或检查某天触发，不进入 AppShell root polling；本轮只复用 token2api existing APIs，不修改或发布 token2api。

Account Center 采用已确认的渐进披露布局：Header 保留 display name 与 safe account identity，退出登录为带 tooltip 的 icon-only action；额度 Tab 额外在 Header 右侧展示短格式读取时间与 icon-only refresh。额度内容不重复显示“额度”标题，subscription engine 使用可选择卡片展示，一行最多 3 张并按窗口自适应换行；选择卡片后，下方只投影该 engine 的 quota windows、年度 heatmap 与 model drill-down。安全 Tab 不重复显示“安全”标题，直接展示两步验证、修改密码、登录方式以及按需展开的资料/密码编辑器。

macOS cold restore 必须收敛 OS vault 访问：一次 `gateway.bootstrap` 只评估一次 vault availability，refresh credential 只读取一次，并把该值复用为 refresh rotation 的 rollback snapshot。禁止为了状态展示或补偿逻辑重复读取同一 Keychain item；rotated refresh 仍必须持久化，不能以减少授权提示为由降低 session durability。

## 不可变约束

- 只有 subscription plans；无 balance recharge、pay-as-you-go 或按量付费 fallback。
- 套餐、价格、周期、额度、features 与排序以 token2api `for_sale=true` server response 为准。
- renderer 不接收 raw secret；用户不选择 API Key、不看配置文件或 diff。
- ready 前不挂载 AppShell/managed runtime。
- Codex 与 Claude Code 都需完成“无外部 CLI → bundled engine → managed configuration → launch”的真实验证，并覆盖外部版本高/相同/低三类选择。
- token2api 本次解除 HOLD：二维码/payment title 使用 `Doge {plan name}`，managed API Key 名称使用 `Doge {engine name without CLI} {plan name}`；基于最新主分支独立 worktree、server-first 发布并保留回滚证据。
- Account Center 不新增技术说明段落、重复标题或带文字外框的 Header action；所有 icon-only action 必须具备 accessible name 与 hover/focus tooltip。
- 单次 cold restore 对 refresh credential 的 vault read 次数必须为 1；repository commit 失败时仍恢复原 credential，vault locked/unavailable 继续 fail closed。

## 验收与执行

执行清单、architecture decisions、failure contract 与 release gates 均以对应 OpenSpec `tasks.md`、`design.md`、delta specs 为准。旧 `integrate-token2api-account-system` 的 Native foundation 可复用，但其“Local Mode 始终可用”行为被本 change 明确 supersede，不能同步进最终 main specs。
