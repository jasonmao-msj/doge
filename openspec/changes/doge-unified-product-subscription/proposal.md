# Change: Doge 全产品统一订阅

## Why

Doge 当前按 engine 展示权益、套餐和托管凭据，用户需要先理解 Codex / Claude，再分别订阅与准备。token2api 已通过 `Composite` group 和单一 `Doge订阅` plan 提供跨协议模型路由，因此客户端可以把商业心智收敛为“一次订阅，使用 Doge 当前全部可用模型”。

## What Changes

- 将启动 Account Gate 从 engine-scoped entitlement 改为 product-scoped entitlement；登录后只判断当前账号是否拥有有效的 Doge Composite 订阅。
- 未订阅时使用上游 plan 的 `name`、`description`、`price`、`currency`、`validity` 和 payment methods 渲染全屏阻断 Gate；支付成功并准备好托管凭据前不挂载 AppShell。
- 复用 token2api 现有 generic checkout、subscription summary、API key 与 Composite `/v1/models` 能力，不新增 token2api schema 或生产发布。
- 将套餐对应的一个 Composite credential 以 Native / OS vault 作为持久化事实源，并自动投影给 Doge 支持的本地 engine；renderer 不读取或展示 secret。Kimi CLI 若要求文件配置，仅允许 Native 在隔离的 `KIMI_CODE_HOME` 中生成 owner-only runtime config。
- 将 composer 的 nested engine submenu 改为 Doge 原生右侧 engine + model 组合面板：engine 来自本地 registry，model entitlement、显示名与调用名来自上游统一 catalog；目录在 ready 后持续增量刷新，不再维护具体 model id 白名单。
- 将账号中心收敛为一张 product subscription 卡与 product/model 用量，同时保留现有显示名称、修改密码、安全状态、身份绑定和退出登录。
- 将账号中心进一步收敛为原型信息层级的单页账户详情：profile/entitlement 立即渲染，usage 与 billing 独立渐进加载；可选时间范围的 summary、model usage table 与 subscription orders 只使用 token2api authoritative user routes。
- 修复验收发现的 product plan wire/parser mismatch 与 Kimi 非默认 runtime model alias 缺口，确保“catalog 可见”与“runtime 可启动”一致。
- macOS 日常 debug build 使用 repo 外、owner-only 的 local development vault，消除 `npm run tauri:dev:hot` 的 Keychain 交互授权；Release 与其他非目标 build 继续 fail-closed 使用 OS credential vault。

## Scope

- Doge frontend、Native account authority/runtime、managed provider projection、focused tests、OpenSpec/Trellis 文档。
- 首期支持已内置且可接收 Token Matrix credential 的 Codex、Claude、Kimi；Composite catalog 决定商业 entitlement 上限。上游可选 `compatible_engines/capabilities` 元数据优先决定能力边界，字段缺失时按稳定 family 规则把 GPT/Claude/Kimi 新版本动态投影到对应 engine，豆包使用三种 managed adapter；未知 family 在上游提供 metadata 前 fail closed。
- 本 change 不修改 token2api 代码、不迁移既有生产订阅、不调整服务端限流阈值。
- engine-attributed usage 暂不在上游 contract 中，本轮不渲染 engine usage block、也不推断。invoice artifact/download 不在 contract 中，UI 完全不提该能力。

## Source Reconciliation

- PRD 定义业务目标、authority 与验收口径，是需求事实源。
- 交互原型定义信息架构与主动线，但不覆盖 Doge 已成熟的账号生命周期与安全交互。
- 现有 Doge UI 中显示名称、密码、安全、身份绑定、退出登录、错误恢复等能力全部保留；原型中重复说明、模拟字段、engine→model 联动和悬浮卡片式选择器不进入实现。
- token2api `Composite` group 是当前代码事实；PRD 中“单 plan 无法跨协议、必须新增 product entitlement schema”的旧判断被本 change 取代。

## Impact

- 主要代码：`src/features/account/**`、`src/features/composer/**`、`src-tauri/src/account/**`、managed provider/runtime 配置层。
- 风险等级：L4 Release / CI（用户明确要求全量）。需要全量 TypeScript/Vitest/ESLint、Rust tests/check/build、contract gates、OpenSpec strict validate、标准 `npm run tauri:dev:hot` 目视 smoke 与三引擎真实发送 E2E。
