## ADDED Requirements

### Requirement: Main App SHALL require an authenticated account and ready managed engine
系统 MUST 在 main AppShell 挂载前完成 token2api account session 与 managed engine readiness gate；未登录、权益失效或准备失败时不得启动受管理的 engine runtime。

#### Scenario: Cold start without a session
- **WHEN** 用户在没有可恢复 session 时启动 Doge
- **THEN** 系统 SHALL 只展示登录/注册入口，且不得渲染 workspace 或启动 Codex/Claude Code runtime

#### Scenario: Valid session and managed engine restore
- **WHEN** 用户 session、最近 engine、active subscription、vault binding 与 configuration verifier 都有效
- **THEN** 系统 SHALL 自动恢复该 engine 并进入 AppShell，无需再次选择套餐或 API Key

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

#### Scenario: Payment is cancelled or expires
- **WHEN** checkout 被取消或超过 server expiry
- **THEN** 系统 SHALL 停止 reconciliation，展示重试/重新选套餐动作，且不得误建 managed credential

#### Scenario: Renderer reconciliation remains outside the AppShell root
- **WHEN** checkout 处于 pending 或 processing
- **THEN** React SHALL 只在 pre-AppShell AccountGate 内执行有 absolute expiry 的 bounded authoritative read，不得在 AppShell/root hook 中建立秒级 polling

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

#### Scenario: User asks for context
- **WHEN** 用户 hover、focus 或激活 `?` help icon
- **THEN** 系统 SHALL 以内容自适应 tooltip 展示说明，并支持 keyboard 与 screen reader

#### Scenario: Recoverable error is shown
- **WHEN** 操作因 stable typed reason 失败
- **THEN** UI SHALL 展示对应的下一步与重试动作，不得裸露 `protocolMismatch`、`vaultUnavailable` 等内部枚举

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
