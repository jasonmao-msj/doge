# 异步按需安装 Product CLI 引擎

## Goal

登录后的 Account/Product gate 只负责 authentication、subscription 与进入产品所需的最小
account authority，不再串行检查或准备 Codex、Claude Code、Kimi CLI。用户始终可进入首页；
只有在实际发送到某个 managed engine 时，Doge 才检查并准备该 engine。准备过程显示为右下角
非阻塞进度卡，失败只影响该 engine 的本次发送，不锁定整个 App。

## What I already know

- 当前 `ProductAccountAppGate.prepare()` 先调用
  `prepareProductEngineProvisioningV1()`，按 Codex → Claude Code → Kimi 串行解析三套 bundled
  toolchain；任一失败都会让 full-screen gate 停在 preparing/failure。
- Gate 随后调用 `account_product_v1_prepare`，该 mutation 还会为三个 engine 一次性写 managed
  credential/configuration 并读取 model catalog。
- Native 已存在 per-engine `account_engine_v1_prepare`、`account_engine_v1_toolchain` 与
  `account_engine_v1_activate`；可复用为 send-time 单 engine transaction。
- `UpdateToast` 已提供右下角 card、progress bar、busy/error/retry 交互与现有样式，可抽取共享
  presentation primitive，避免复制 updater UI。
- `cli-installer-event` 已提供 installer started/stdout/stderr/finished/error event；managed toolchain
  resolver 当前优先使用 shipping bundled resource，因此已随 App 存在的 binary 只需验证，不应
  伪装成 network download。
- Composer 会在 `onSend()` 后清空 draft；若 provisioning 失败，必须显式恢复原 text/images，
  否则“App 未锁定”仍会造成用户输入丢失。

## Assumptions (temporary)

- MVP 保留现有 bundled-engine shipping contract，不在本 change 中移除 release bundle 或新建
  runtime archive downloader；若 bundle 不可用，可使用现有 CLI installer 作为明确 fallback，
  但必须保持 managed provider/config isolation。
- 同一 engine 的并发发送共享一个 in-flight provisioning promise；不同 engine 可以独立显示状态，
  但 MVP 同一时间只允许一个主动 installation transaction，避免 installer/process 冲突。
- 安装成功后自动继续原始发送是推荐体验；失败时恢复 draft，并在卡片提供 retry。

## Open Questions

- 已决策：安装成功自动继续 exact frozen original send；失败恢复 draft/attachments，由用户显式 Retry。

## Requirements (evolving)

- authenticated + active subscription 后不得因 CLI inspect/install/verify 失败阻塞 Home/AppShell。
- 删除 Product gate 中 engine-specific preparing full-screen UI 与三 engine eager provisioning。
- send-time 只准备 frozen target 指定的单个 engine；不得顺带检查或安装其他 engine。
- engine provisioning progress 使用右下角非阻塞 card；AppShell、Sidebar、Settings、其他会话保持可操作。
- engine 已由 bundled/external toolchain 验证可用时，credential/config/toolchain inspection/activation 全部 silent；
  只有真正启动 CLI installer 时才显示 progress card。card 只需要 installing / ready / error、engine label、
  indeterminate progress、safe error 与 retry；busy 时不得关闭导致 owner 丢失。
- progress card 的 visible copy 只表达 engine、当前 phase 与可执行 action；禁止展示“仍可继续使用 App”一类
  implementation/acceptance explanation，禁止重复 engine label、重复 dismiss action 或伪造 determinate percentage。
- credential/config/toolchain/activation 必须保持单 engine、幂等、deduped，并在实际 session/turn
  side effect 前完成。
- provisioning failure 不得创建 partial thread/turn，不得丢失 draft/attachments，不得修改其他 engine。
- Windows 与 macOS 行为一致；路径、secret、command output 不进入 Renderer-visible error。

## Acceptance Criteria (evolving)

- [x] 清空 managed engine state 后登录，直接进入首页；无 `正在准备 Claude Code/Kimi CLI` full-screen gate。（Hot Doge 用户目视通过）
- [x] 首次选择 Codex 发送时只触发 Codex provisioning；仅 actual installer 显示右下角非阻塞进度卡。
- [x] 首次选择 Claude/Kimi 时分别只准备对应 engine。
- [x] 成功后使用 exact frozen target 继续发送；没有重复 thread/turn。
- [x] 失败时 App 仍可操作、draft/attachments 可恢复、卡片可 retry，其他 engine 仍可发送。
- [x] 同 engine 双击发送只运行一个 provisioning transaction。
- [x] focused React/Rust/contract tests 与 L3 verification 通过。

## Definition of Done

- OpenSpec proposal/design/spec delta/tasks 完整并 strict-valid。
- startup gate、send pipeline、provisioning coordinator、progress card 与 i18n tests 完成。
- `.trellis/spec/**` 与 foundation ADR 按 executable contract 校准。
- Windows/macOS focused behavior matrix 有证据；L4 packaged smoke 交给 CI/review。

## Research Notes

### Approach A: send-time coordinator + shared progress card（Recommended）

- 在 neutral runtime owner 中维护 per-engine state/in-flight promise；Product gate 完全移除 engine
  provisioning。send boundary 先执行 per-engine account prepare → toolchain resolve/install fallback →
  activation，再继续原发送。
- 优点：单一 owner、所有发送入口可复用、可 dedupe/retry、UI 与业务状态解耦。
- 代价：需要接入 native/shared/new-session 三类 send boundary，并处理 draft restore。

### Approach B: 在每个 engine adapter 内临时安装

- 各 adapter 启动失败时自行安装并重试。
- 优点：离 binary launch 最近。
- 缺点：UI progress、dedupe、credential prepare、draft recovery 会在 Codex/Claude/Kimi 三处复制；
  错误发生在 thread/turn side effect 之后，难以保证无 partial session。

### Approach C: 登录后后台静默预装全部 engine

- Gate 直接进入 Home，但 background task 仍准备全部 engine。
- 优点：实现最小。
- 缺点：仍违背“用到哪个才下载哪个”，浪费网络/磁盘，多个 engine failure 仍会制造噪声。

## Decision (ADR-lite)

**Context**：startup eager provisioning 会把任一 engine failure 放大成全 App 不可用；现有 Native 已有
per-engine commands，但缺少 send-time orchestration 与 non-blocking UI owner。

**Decision**：采用 Approach A。Product gate 不拥有 engine lifecycle；send-time coordinator 是
single owner，进度 UI 复用 updater card primitive。

**Consequences**：首次使用某 engine 的发送会等待该 engine ready；等待期间 App 仍可操作。必须处理
original send queue、draft recovery、concurrent dedupe 与 stale target guard。

## Out of Scope

- 移除 release package 内的 bundled engines 或重做 CDN/runtime archive format。
- 让用户在 Product UI 重新选择 provider/toolchain source。
- 修改 Grok/OpenCode/Gemini 的现有 local-mode installer UX。
- 多 engine 并行安装与后台预下载策略。

## Technical Notes

- OpenSpec change：`lazy-engine-provisioning`。
- 预计修改：`ProductAccountAppGate*`、`productEngineProvisioning*`、send/session activation boundary、
  `UpdateToast` shared card、layout toast mount、account engine command bridge、i18n/tests。
- Verification level：L3 Cross-layer / High-risk；最高风险是 startup/send/installer/managed credential
  transaction 与 Windows/macOS parity。
