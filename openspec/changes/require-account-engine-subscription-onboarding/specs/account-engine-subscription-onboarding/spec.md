## ADDED Requirements

### Requirement: Main App SHALL require an authenticated account and ready managed engine
系统 MUST 在 main AppShell 挂载前完成 token2api account session 与 managed engine readiness gate；未登录、权益失效或准备失败时不得启动受管理的 engine runtime。

#### Scenario: Cold start without a session
- **WHEN** 用户在没有可恢复 session 时启动 Doge
- **THEN** 系统 SHALL 只展示登录/注册入口，且不得渲染 workspace 或启动 Codex/Claude Code runtime

#### Scenario: Valid session and managed engine restore
- **WHEN** 用户 session、最近 engine、active subscription、vault binding 与 configuration verifier 都有效
- **THEN** 系统 SHALL 自动恢复该 engine 并进入 AppShell，无需再次选择套餐或 API Key

#### Scenario: Cold restore minimizes OS vault authorization
- **WHEN** Doge 通过 `gateway.bootstrap` 恢复 active session 并旋转 refresh credential
- **THEN** Native SHALL 在本次 bootstrap 中只评估一次 vault availability，并且只读取一次当前 refresh credential
- **AND** 已读取 credential SHALL 作为 rotation rollback snapshot 复用；rotated refresh 仍 MUST 写回 OS vault，repository commit 失败时 MUST 恢复旧 credential

#### Scenario: Readiness cannot be proven
- **WHEN** network、authority、subscription、vault 或 configuration 状态无法 authoritative verify
- **THEN** 系统 SHALL fail closed 在可恢复 gate，不得进入假 ready 状态

### Requirement: Engine choice SHALL expose only supported managed engines
系统 SHALL 使用 versioned engine catalog 展示已完成 managed access 的 engine；首期 catalog MUST 只包含 `codex` 与 `claude-code`，并把最近成功 engine 作为可恢复偏好而非 authority。

#### Scenario: First successful login
- **WHEN** 用户首次登录且没有最近 engine preference
- **THEN** 系统 SHALL 展示 Codex 与 Claude Code 两个简洁选择，不展示 Provider、模型或 API Key

#### Scenario: User switches engine
- **WHEN** ready 用户从 Settings 或 account menu 主动切换 engine
- **THEN** 系统 SHALL 重新验证目标 engine 的 entitlement 与 binding，且不得复用其他 engine 或其他账号的 credential

#### Scenario: User adds a second engine from the main picker
- **WHEN** 已订阅 Codex 的 ready 用户在 main engine picker 选择未订阅的 Claude
- **THEN** 系统 SHALL 直接读取并展示 Claude 的 authoritative subscription plans，不得要求用户再经过通用 engine selector 或理解 API Key
- **AND** Codex entitlement 与现有 Codex conversation SHALL 保持不变

#### Scenario: Target engine is already entitled
- **WHEN** in-App intent 指向已有 active entitlement 的 managed engine
- **THEN** 系统 SHALL 跳过 plan/checkout，重新 authoritative prepare 目标 engine 后完成切换

### Requirement: Subscription plan catalog SHALL be server authoritative and subscription-only
系统 MUST 只展示 token2api 对当前 engine 返回的、当前用户可购买且 `for_sale=true` 的 subscription plans。Doge MUST NOT 提供 balance recharge、pay-as-you-go、按量付费或相应 fallback。

#### Scenario: Public plans are configured
- **WHEN** token2api 对所选 engine 返回 N 个公开可订阅套餐
- **THEN** Doge SHALL 按 server order 展示同样 N 个套餐，并直接使用 server 的名称、价格、币种、周期、额度与 features

#### Scenario: Plan is unpublished
- **WHEN** 管理员把一个 plan 的 `for_sale` 改为 false
- **THEN** 下一次 authoritative plan read SHALL 不再在 Doge 展示该 plan，且无需发布新版 Doge

#### Scenario: No plans are for sale
- **WHEN** 当前 engine 没有公开可订阅套餐
- **THEN** Doge SHALL 显示空状态与重试/帮助入口，并且不得展示充值、按量计费或本地默认套餐

#### Scenario: Non-entitlement failure occurs
- **WHEN** entitlement read 因网络、protocol、vault 或服务异常失败
- **THEN** Doge SHALL 展示对应恢复动作，而不是把用户导向套餐页面

### Requirement: Checkout SHALL create only subscription orders and reconcile automatically
系统 SHALL 通过 Native Broker 创建与读取 subscription checkout；支付在 provider-owned/system-browser surface 完成，Doge MUST 自动感知 terminal result 且不得要求用户点击“我已支付”。

#### Scenario: One payment method is available
- **WHEN** 用户选择套餐且 server 只返回一个可用 payment method
- **THEN** 系统 SHALL 自动使用该 method 创建 subscription order 并打开其 typed payment action

#### Scenario: Multiple payment methods are available
- **WHEN** server 返回多个可用 payment methods
- **THEN** 系统 SHALL 在创建订单前渐进披露一个简洁支付方式选择，且不展示余额支付

#### Scenario: Payment completes
- **WHEN** provider webhook 与 subscription fulfillment 均已完成
- **THEN** Native reconciliation SHALL 产生 paid terminal receipt 并自动进入 managed engine preparing

#### Scenario: Second engine payment completes
- **WHEN** 用户在已进入 App 的增购 flow 中完成目标 engine 支付
- **THEN** 系统 SHALL 自动 ensure/reuse managed credential、写入 OS vault、配置并激活目标 engine，随后打开该 engine 的空白新会话入口
- **AND** 用户不得再次选择 API Key、点击配置确认或手工刷新支付状态

#### Scenario: Payment is cancelled or expires
- **WHEN** checkout 被取消或超过 server expiry
- **THEN** 系统 SHALL 停止 reconciliation，展示重试/重新选套餐动作，且不得误建 managed credential

#### Scenario: QR checkout is displayed
- **WHEN** 当前 selected server plan 创建的 typed payment action 为 `show_qr`
- **THEN** 支付页标题 SHALL 显示 `Doge {plan.name}`，其中 `plan.name` 来自用户刚选择的 authoritative plan projection，不得显示内部 plan id 或本地硬编码套餐名

#### Scenario: Renderer reconciliation remains outside the AppShell root
- **WHEN** checkout 处于 pending 或 processing
- **THEN** React SHALL 只在 AccountGate-owned surface 内执行有 absolute expiry 的 bounded authoritative read，不得在 AppShell/root hook 中建立秒级 polling
- **AND** 登录后的第二引擎增购 MAY 保持 AppShell mounted 在 overlay 之后，但 checkout tick 不得成为 AppShell root state update

#### Scenario: User leaves a recovered checkout
- **WHEN** App 恢复 pending/processing checkout 并展示等待支付页面
- **THEN** 页面 SHALL 同时提供“返回套餐”与“退出登录”；返回套餐 MUST 先清除当前账号、设备和 checkout id 对应的 local durable checkpoint，再读取当前 engine 的 authoritative plan catalog，退出登录 MUST 进入登录页且不得把用户困在支付恢复状态
- **AND** local checkpoint abandon MUST NOT 声称已取消 provider-owned remote order，也不得调用 balance/pay-as-you-go fallback

### Requirement: Managed engine access SHALL be idempotent and secret isolated
token2api SHALL 在 active subscription 验证后按 `user + device + engine` 幂等 ensure 一个 active managed binding；raw credential MUST 只存在于 token2api one-time response、Doge Rust memory 与 OS vault 写入路径。

#### Scenario: Concurrent ensure requests
- **WHEN** 同一 user/device/engine 并发或重试 ensure
- **THEN** token2api SHALL 只保留一个 active binding，并通过 stable receipt/reconciliation 返回同一业务结果

#### Scenario: Subscription does not cover engine
- **WHEN** 用户没有映射到目标 engine platform 的 active subscription
- **THEN** ensure SHALL 返回稳定的 no-entitlement reason，且不得创建 API key 或 binding

#### Scenario: Secret crosses renderer boundary
- **WHEN** managed credential 被创建、旋转或恢复
- **THEN** raw secret SHALL NOT 出现在 IPC projection、event、React state、SQLite、日志、配置文件或 idempotency response 中

#### Scenario: Account or engine changes
- **WHEN** 当前账号或 engine identity 变化
- **THEN** vault scope 与 managed binding SHALL 隔离，旧账号/旧 engine 的 secret 不得被复用

#### Scenario: Managed credential receives a novice-readable name
- **WHEN** server 为 active engine subscription 创建或恢复 deterministic managed credential
- **THEN** API Key display name SHALL 为 `Doge {engine display name} {authoritative plan name}`，其中 engine name 不带 `CLI`
- **AND** legacy managed key 名称更新 MUST 原地执行，不得改变 secret、binding identity、group 或 active key 数量

### Requirement: Codex and Claude Code SHALL be configured without API Key interaction
系统 SHALL 为 Codex 与 Claude Code 提供 engine-scoped configuration recipe，并在 entitlement 成立后自动执行；产品 UI MUST NOT 展示 API Key 选择、复制、粘贴、文件列表或 diff confirmation。

#### Scenario: Codex preparation succeeds
- **WHEN** Codex binding secret 已安全写入 vault 且 Codex CLI 可用
- **THEN** 系统 SHALL 写入不含 secret 的 managed provider configuration、验证可用性并进入 ready

#### Scenario: Claude Code preparation succeeds
- **WHEN** Claude Code binding secret 已安全写入 vault 且 Claude Code CLI 可用
- **THEN** 系统 SHALL 写入 managed provider sentinel，并在 launch 时从 vault 注入所需 token 与 base URL 后进入 ready

#### Scenario: CLI is missing
- **WHEN** 所选 engine CLI 未安装或 verifier 失败
- **THEN** 系统 SHALL 提供安装/重试恢复动作，不得错误展示订阅套餐或标记 ready

#### Scenario: Configuration outcome is uncertain
- **WHEN** server、vault 或 file side effect 可能已发生但本地 commit/response 丢失
- **THEN** 系统 SHALL 持久化 `outcomeUnknown` safe receipt 并执行 authoritative reconcile，不得当作普通 rejected 重做

### Requirement: Onboarding UI SHALL minimize attention and disclose details progressively
account gate SHALL 每屏只呈现一个主要决策；说明性内容 SHALL 收入可访问的自适应 help tooltip，错误信息 SHALL 使用用户可行动的文案而非 protocol code。

#### Scenario: Primary path is rendered
- **WHEN** 用户处于登录、选 engine、选套餐、等待支付或 preparing 任一状态
- **THEN** 页面 SHALL 只突出当前步骤的 primary action，不展示 scenario selector、技术状态表或配置说明段落

#### Scenario: Authenticated engine management is rendered
- **WHEN** 用户在 Settings Account 查看 managed engine 入口
- **THEN** 页面 SHALL 使用“我的引擎”表达已拥有与可增加的 engine，不得使用会暗示替换现有权益的“切换引擎”作为唯一入口文案

#### Scenario: Account Center header actions are rendered
- **WHEN** authenticated Account Center 被渲染
- **THEN** Header SHALL 显示 server-safe display name 与 account identity，并只用带 accessible name 和 hover/focus tooltip 的 icon action 提供退出登录
- **AND** 额度 Tab SHALL 在同一 Header 中额外显示最近一次成功读取的短格式时间与 icon-only refresh，不得在内容区重复刷新按钮或“额度”标题

#### Scenario: Security tab is rendered
- **WHEN** 用户打开安全 Tab
- **THEN** 内容 SHALL 直接从两步验证、修改密码与登录方式 rows 开始，不得重复渲染“安全”section heading
- **AND** 资料与密码 editor SHALL 只在用户选择对应 action 后展开

#### Scenario: In-App acquisition is cancelled
- **WHEN** ready 用户从 Account Center 或 main engine picker 打开增购 flow 后选择 cancel/back
- **THEN** 系统 SHALL 关闭 overlay 并返回原 workspace/conversation/draft，上层 AppShell 不得因 flow 打开或关闭而 unmount

#### Scenario: In-App acquisition succeeds
- **WHEN** 目标 engine prepare 与 activation committed
- **THEN** 系统 SHALL 关闭 overlay、切换 active engine 并打开目标 engine 的空白新会话入口，不得原地改写当前既有 thread 的 engine identity

#### Scenario: User asks for context
- **WHEN** 用户 hover、focus 或激活 `?` help icon
- **THEN** 系统 SHALL 以内容自适应 tooltip 展示说明，并支持 keyboard 与 screen reader

#### Scenario: Recoverable error is shown
- **WHEN** 操作因 stable typed reason 失败
- **THEN** UI SHALL 展示对应的下一步与重试动作，不得裸露 `protocolMismatch`、`vaultUnavailable` 等内部枚举

#### Scenario: Masked account identity is restored
- **WHEN** signed-in cold restore 返回符合 masking contract 的 `primaryEmailLabel`，包括 local part 中的 `*`
- **THEN** renderer SHALL 接受该 safe projection 并继续加载 engine catalog，不得把成功的 bootstrap 误判为 `protocolMismatch` 或“服务暂时不可用”

#### Scenario: Authenticated user changes account from a blocking gate
- **WHEN** 已登录用户停留在 engine catalog、套餐列表、无可售套餐、支付方式、等待支付、preparing 或 authenticated service failure 任一 pre-AppShell blocking state
- **THEN** 页面 SHALL 始终提供可见的“退出登录”动作；成功后 MUST 回到登录/注册页，使没有目标订阅的用户可以切换账号
- **AND** logout pending 期间该动作 MUST 防止重复提交，失败时 MUST 留在当前页面并展示可重试的用户文案

#### Scenario: Logout races with a session event bootstrap
- **WHEN** `logout(thisDevice)` 清除本地 session 并在 mutation 返回前触发 `sessionChanged`，使 controller 启动新的 account bootstrap
- **THEN** logout 成功 SHALL 作废旧账号 bootstrap，并在有限时间内回到登录/注册页
- **AND** 被作废的 stale bootstrap MUST 释放自己拥有的 loading state，不得让页面永久停留在“正在连接”

#### Scenario: Novice-facing engine navigation is rendered
- **WHEN** 用户打开 engine picker 或 Settings engine management 页面
- **THEN** 主路径 SHALL 使用 `Claude / Codex / Grok / Kimi / OpenCode` 与“引擎管理”等产品名称，不得在入口、列表、标题、搜索提示或可见说明中暴露 `CLI` 术语

#### Scenario: Composer is rendered
- **WHEN** 用户进入可输入消息的主界面
- **THEN** composer SHALL 不展示每日古诗、轮换文案或其 dismiss control；通用 SDK warning/header composition MAY 继续存在以承载明确的未来产品消息

### Requirement: Subscription usage SHALL be projected per entitled engine
系统 SHALL 以 server-owned Desktop engine entitlement 关联 subscription quota 与 usage analytics，不得用 account-level platform quota 代替 subscription truth。额度读取 MUST 保持 pull-only，并以 credential-free projection 进入 renderer。

#### Scenario: User opens quota with multiple subscriptions
- **WHEN** 用户同时拥有 Codex 与 Claude 的 active subscriptions 并主动打开额度页
- **THEN** Doge SHALL 为每个已订阅 engine 展示 daily/weekly/monthly 的 total、used、remaining、progress 与 reset time
- **AND** engine 与 subscription 的关联 MUST 来自 authoritative `subscription_id/group_id`，不得由套餐名称、API Key 名称或模型字符串推断

#### Scenario: Subscription cards adapt and select one detail owner
- **WHEN** 额度页拥有一个或多个 active subscription engines
- **THEN** UI SHALL 以 selectable engine cards 展示，一行最多 3 张；1/2/3 张 card 分别等宽占满当前行，更多 card 自动换行，窄屏自动收敛为 2/1 列
- **AND** 切换 card SHALL 只更新所选 engine 的 quota windows、年度 heatmap 与 model detail，不得重新读取全部 usage summary 或持久化 selected card

#### Scenario: Account platform quota is empty
- **WHEN** active subscription 存在但 `/user/platform-quotas` 为空或 limit 为 null
- **THEN** Doge SHALL 继续使用 subscription progress 展示真实额度，不得显示“暂时无法读取额度”

#### Scenario: Year heatmap is rendered
- **WHEN** selected engine 的最近一年 daily usage 已成功读取
- **THEN** UI SHALL 用类似 GitHub contribution graph 的紧凑日历展示每天的用量强度，并支持 pointer hover、keyboard focus 与 screen reader date/value label
- **AND** cell color SHALL 基于该 engine 的 daily actual cost 做 bounded intensity projection，不能把颜色等级作为新的 billing truth
- **AND** 零用量日期 SHALL 仍以低对比度小格显示，month label 每月最多出现一次，overflow 初始位置 SHALL 显示最近日期
- **AND** 月份、星期、日期、数字与货币 SHALL 跟随 Doge 当前语言，不得从操作系统 locale 产生中英文混排
- **AND** UI SHALL 不展示“少/多”等额外颜色图例；tooltip 与 cell accessible label 负责渐进披露精确值

#### Scenario: User inspects one day
- **WHEN** 用户 hover 或 focus 某个有用量的日期
- **THEN** tooltip SHALL 立即展示该 engine 当天的 requests、input/output/cache tokens、standard cost 与 actual cost，并按需读取该日不同 models 的同类 breakdown
- **AND** model read SHALL 以 `engineId + date` 在当前 session 去重缓存，不得持续 polling 或在 renderer 传递 raw group/subscription id

#### Scenario: One engine analytics fails
- **WHEN** 某个 engine 的 trend 或 day-model authority read 失败
- **THEN** 其他 engine 与已成功的 subscription window summary SHALL 继续可见；day tooltip SHALL 保留 aggregate 并提供可重试状态，不得清空整个额度页

### Requirement: Account and checkout recovery SHALL be durable and bounded
系统 SHALL 持久化 credential-free session/checkpoint/receipt，并为 checkout、managed binding 与 configuration 提供 crash-safe recovery；reconciliation MUST 有 absolute expiry 与 bounded backoff。

#### Scenario: App restarts during checkout
- **WHEN** Doge 在 pending checkout 期间退出并重启
- **THEN** 系统 SHALL 恢复 safe checkout receipt、authoritative read 当前状态，并继续或终止 bounded reconciliation

#### Scenario: App restarts during preparation
- **WHEN** Doge 在 vault/config transaction 中断后重启
- **THEN** 系统 SHALL 从 durable checkpoint 检查 binding、vault 与 configuration truth，不得盲目创建新 key

#### Scenario: Reconciliation reaches expiry
- **WHEN** checkout 或 operation 超过 server-declared expiry
- **THEN** 系统 SHALL 停止后台读取并投影明确 terminal/recovery state
