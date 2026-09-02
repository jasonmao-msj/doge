# Tasks: add-wechat-bridge-channel

## 1. Backend（src-tauri）

- [x] 1.1 新增 `wechat` 模块骨架：内部 bridge/webhook defaults，provider secrets 走安全存储
- [x] 1.1a bundled bridge provider：资源发现、自动启动/停止、崩溃状态和应用退出清理
- [x] 1.1b provider adapter：内置 Rust sidecar 对接 `@tencent-weixin/openclaw-weixin@2.4.6` 的 Tencent iLink API，并按 target 自动构建到资源目录
- [x] 1.1c dev startup：耗时的 bundled resources preparation 在 `tauri dev` 开始等待 frontend 前完成，避免 cold bridge build 触发 180 秒 `devUrl` timeout
- [x] 1.2 内嵌 webhook HTTP server：仅渠道启用时启动，默认 `127.0.0.1:18790/webhook/wechat`，token 校验
- [x] 1.3 bridge API client：`/login/qrcode`、`/login/status`、`/message/send`，统一错误语义
- [x] 1.4 入站消息处理：解析 `msgId` / `wxid` / 文本，忽略群消息，非法请求拒绝
- [x] 1.5 session 路由：`wxid → sessionId` 映射持久化 + `msgId` 去重
- [x] 1.6 回复回流：聚合流式输出 → 超长分片（约 1800 字/片）→ 按序 `message/send`
- [x] 1.7 单元测试：webhook 校验、去重、映射持久化、分片边界
  - 验证：`cargo test --manifest-path src-tauri/Cargo.toml --lib wechat`
- [x] 1.8 execution target binding：持久化 workspace / engine / provider / model 与真实 native sessionId；target 变化时新建 session
- [x] 1.9 visible sync：微信 turn 使用 exact provider-scoped runtime，Codex 不执行 helper hide/archive cleanup，并记录 session target metadata
- [x] 1.10 session catalog event：turn 完成后 emit `wechat://session-updated`
- [x] 1.11 conversational target control：实现 `/target`、`/workspace`、`/engine`、`/model`、`/cancel` 与数字选择，按 `wxid` 持久化 target/pending state
- [x] 1.12 target catalog parity：Product-ready 复用 canonical protocol/model projection；非 Product 聚合 provider-scoped backend catalog，并在选择时保留 provider binding

## 2. Frontend（设置页）

- [x] 2.1 「微信渠道」section：仅保留启停、扫码、登录状态和授权数据流说明；隐藏内部 bridge 配置
- [x] 2.2 登录面板：QR 内容生成二维码 + 状态轮询（未登录 / 待确认 / 待验证码 / 已登录 / 掉线），支持手动刷新过期二维码
- [x] 2.2a QR contract regression：Doge parser 识别 bundled sidecar 顶层 `{ value, expiresAt }` 响应，避免 bridge 正常时误报二维码格式无效
- [x] 2.3 首次启用扫码授权与数据流说明弹窗，显式确认后才开启
- [x] 2.4 连通性测试按钮 + 可读错误文案（不暴露原始 HTTP body）
- [x] 2.5 组件测试：配置表单、QR 状态机、授权数据流确认
- [x] 2.6 设置页显示 workspace / engine / model routing selectors，默认采用当前 target 且不暴露 bridge wiring
- [x] 2.7 frontend 订阅 `wechat://session-updated` 并刷新当前 workspace 会话列表
- [x] 2.8 移除设置页 workspace / engine / model routing selectors，登录与渠道生命周期控件保持不变

## 3. OpenSpec

- [x] 3.1 创建 change `add-wechat-bridge-channel`（proposal / design / tasks / specs）
- [x] 3.2 `openspec validate add-wechat-bridge-channel --strict --no-interactive` 通过
- [ ] 3.3 真实设备 smoke：微信扫码确认、direct text inbound、Doge reply outbound；不要求 provider proxy URL/API key 或公网 webhook

## 4. 收口

- [x] 4.1 按风险等级完成 L3 focused verification（`risk-based-test-strategy.md`）
- [x] 4.2 命中 provider binding 更新触发器，已同步刷新会话基石「最近校准」与当前实现校准表
- [ ] 4.3 commit（中文 Conventional Commits）+ Trellis session record
