# Proposal: Product CLI Engine Lazy Provisioning

## Why

当前 authenticated Product startup 把 Codex、Claude Code、Kimi 三套 toolchain provisioning
串进 `ProductAccountAppGate`。任一 binary/bundle/installer/verification failure 都会让用户停在
full-screen preparing/failure surface，无法进入 Home，也看不到真实进度。这个 blast radius 与
engine 的使用范围不匹配：用户可能只需要其中一个 engine，却被另外两个 engine 的失败锁住整个 App。

Product shell readiness、managed credential/config readiness 与 CLI binary readiness 是三个不同事实。
登录成功和 active subscription 只能决定用户能否进入 App；具体 engine 是否可执行，应在冻结 send
target 后、创建 Session/Turn side effect 前按需准备。

## What Changes

- Product gate 不再 inspect/install/verify 三个 CLI，也不渲染 engine-specific full-screen preparing UI。
- active subscription catalog 成功后立即 mount AppShell/Home；model/key bootstrap 在后台收敛，失败只形成
  non-blocking catalog state/diagnostic。
- `account_product_v1_prepare` 增加 optional `engineId`：`null` 只准备 product key/model catalog，指定 engine
  时只 apply 该 engine 的 managed config，禁止 startup 一次写三套 engine configuration。
- 新增 send-time Product engine provisioning coordinator：按 frozen
  `engine + providerProfileId` 执行 account prepare、toolchain resolve/install、activation；同 engine 并发 dedupe。
- 首次发送需要安装时，右下角显示复用 updater card classes 的 non-blocking progress card；成功自动继续原
  message，失败恢复 draft/attachments 并提供 retry。
- Codex、Claude、Kimi、Native new-session、existing Native、Shared target 都复用同一 readiness owner；
  provisioning failure 在任何 Session/Turn side effect 前 fail closed，但 AppShell 保持可操作。

## Scope

- Account Product gate、entitlement/model bootstrap state。
- Product managed toolchain/config preparation bridge。
- send/session activation boundary 与 Composer draft recovery。
- updater toast stack / engine provisioning progress UI 与 i18n。
- Rust product prepare/config selection 与 toolchain external fallback。
- OpenSpec/Trellis/foundation ADR executable contracts。

不在本 change 中移除 release package 的 bundled engines，不新增 CDN archive format，不开放 Product Provider
或 toolchain source 管理 UI，不改变 Grok/OpenCode/Gemini local installer 语义。

## Verification

选择 **L3 Cross-layer / High-risk**：影响 startup、auth/vault、installer、engine routing、new/existing/shared
send、Windows/macOS process/binary resolution。运行 Account gate/coordinator/Composer/UpdateToast focused Vitest、
service mapping tests、Rust account/toolchain tests、target ESLint、typecheck、`cargo check --lib`、runtime/engine/
OpenSpec/docs gates；L4 packaged Windows/macOS missing-engine smoke 由 CI/review 承担。
