# token2api Account Convenience — 当前实现与试用包证据

> 状态：`active-implementation / existing-key-real-e2e-green / unsigned-local-package-built / upstream-deploy-pending`
> 复核日期：2026-08-14
> 本文是 current code fact；早期 research 中的 `no implementation` / `ready-for-first-batch` 仅保留为历史快照，不再代表当前实现状态。

## 1. 已实现范围

- Local Mode 与账号增强层隔离；账号 service/vault failure 不阻塞 AppShell、本地 workspace、conversation、Git、terminal 或 CLI。
- `Settings → Account` fixed entry + header lightweight entry，二者进入同一 Account route。
- Real adapter 已实现 email/password login、registration、conditional email verification、MFA login、durable session restore/logout、profile read/update、password change 的 native mapping；所有 remote action还需同时通过Authority descriptor/guarantee gate。production descriptor exact path现已冻结为`GET /api/v1/desktop/v1/authority`，Doge与token2api均有closed-schema contract test。
- pull-only quota：只有用户打开/刷新额度 view 才请求 `GET /api/v1/user/platform-quotas`，无后台 polling/notice。
- Codex recipe：登录后 explicit offer → 读取已有 API Key metadata → 用户选择exact key → Native handoff写OS vault → changed-file list → lazy semantic diff → exact apply consent → journaled config apply/rollback + semantic verification。产品路径不自动创建API Key；无可选Key时只提供`https://token-matrix.com/keys`与主动刷新。
- configuration 普通关闭后由 App-level Doge bubble 保留重开入口；bubble `×` 才 durable hard-dismiss。
- refresh credential 与 managed Codex key 只进 OS credential vault；SQLite 只保存 safe metadata；renderer 不接收 token/key/raw path/raw diff。
- selected key 独立于 account UI session；logout/change-password/session revoke 保留已配置 key；App内“移除”只解除当前device vault binding，不删除或轮换Token Matrix远端API Key。
- Account SQLite v6 以 `authorityOriginId + accountLinkId + deviceId` 隔离 session/key/task；同 intent semantic retry复用 durable operation；event envelope通过identity + monotonic cursor gate。
- 配置 result、ack 与 recovery task durable；App重启会恢复 verified result或回滚 interrupted apply，renderer handle按新process generation重签发。
- Doge bubble点击会发出一次性reopen intent，Settings Account authoritative读取并恢复当前offer、未过期plan或result；不是只导航到Account section。
- registration/MFA错误保留有效attempt供原地重试；logout在token2api尚无typed revocation truth时只报告`unconfirmed`，不把2xx冒充远端已撤销。
- logout先durable清除本地session并立即settle UI；只有cached validated descriptor允许时才异步best-effort远端清理，网络延迟/失败不阻塞Local Mode，也不提升`unconfirmed`真值。
- managed-key create/rotate 使用vault补偿 + SQLite transaction更新binding/session；配置journal只在safe receipt durable之后清理。
- renderer build kill switch不可被localStorage覆盖；Native no-default-features lane不打开Account DB/Authority/vault。

## 2. Capability-driven honest cut

2026-08-13 以token2api v0.1.175同步完成后的隔离worktree与本地真实服务复核：registration/email verification可由descriptor与public settings共同启用；password reset、OAuth、TOTP management仍保持desktop unsupported/disabled。因此本地试用包：

- login/register 只有descriptor同时声明对应capability与durable/atomic/stable guarantees才展示；当前token2api implementation已提供descriptor与session guarantees，malformed/missing descriptor仍fail closed；password reset request与completion在完整Native handoff上线前一并隐藏；
- OAuth 当前 server disabled 且无 Desktop completion，隐藏；
- TOTP management 无 Native one-time presentation，隐藏；MFA login contract存在但只在 server返回 `requires_2fa` 时进入；
- reset request/completion 都不复用 legacy Web link 冒充 Native completion；
- revoke-all的durable generation已在token2api schema/service/middleware落地，但Doge首包仍保持disabled，直到typed UI projection与完整real failure matrix独立验收。

token2api current branch已将API Key认证值迁移为SHA-256 hash，并把可恢复原文放入server-side envelope-encrypted `credential_ciphertext`；generic list/get只返回metadata。Doge使用专用existing-key list/handoff，不把generic `/keys` response当作secret transport。Desktop OAuth/reset仍未闭合，相关capability继续disabled。

## 3. Cross-layer implementation evidence

| Layer | Current fact source |
|---|---|
| React Gateway/UI | `src/features/account/**`, `src/services/accountGateway.ts` |
| Safe Tauri bridge | `src/services/tauri/account.ts`, `src-tauri/src/command_registry.rs` |
| Native broker/vault/DB | `src-tauri/src/account/{runtime,vault,persistence,authority}.rs` |
| Config transaction | `src-tauri/src/account/configuration.rs` |
| Codex runtime injection | `src-tauri/src/codex/session_runtime.rs`, `src-tauri/src/backend/app_server.rs` |
| Executable contract | `.trellis/spec/backend/account-convenience-native-contract.md` |

## 4. Current verification evidence

- token2api upstream sync `v0.1.172 → v0.1.175` 已由独立任务合并；本实现基线为merge commit `eabd569377d719939cc7b2c27b4f5d27462740b4`。server实现、migration 222与security baseline修订当前head为`45555d7a0`，PR [#37](https://github.com/jasonmao-msj/token2api/pull/37) 为open/mergeable，尚未merge/deploy。
- isolated Real E2E：真实token2api server + PostgreSQL + Redis上完成login durable pair、metadata-only existing-key list、owner-authorized handoff、same-idempotency replay与invalid binding closed-400；数据库断言API Key为`hash + envelope`而非raw。
- Doge live Native adapter E2E：`account::authority_desktop_tests::live_token2api_existing_key_handoff_matches_native_contract`通过，验证descriptor/login/list/handoff exact HTTP contract。
- Doge live AccountRuntime E2E：`account::runtime::runtime_live_e2e_tests::live_runtime_selects_existing_key_without_renderer_secret`通过，验证bootstrap→login→list→select、Native vault写入及renderer response不含raw secret。

- 账号产品导航修正：signed-out只显示`登录 / 注册`两个Tab，找回密码从登录页次级action进入focused subflow；authenticated只显示`概览 / 额度 / 安全`三个Tab。Settings产品页面已移除`交互预览`、scenario selector与raw scenario id；scenario control仅保留于Account Lab/自动化测试。
- Account/frontend + AppShell focused：137/137 passed；其中最后一轮dialog focus、Preview bubble、product journey focused suite为30/30 passed。覆盖注册、登录、找回/重置、pull-only额度、文件列表→lazy safe diff→apply/result、普通关闭→App-level Doge bubble→重开同一task、bubble `×` hard-dismiss。
- latest existing-key focused：24/24 passed；覆盖已有Key选择、无Key跳转、全部Key不可选时跳转、失效选择清理、lazy diff与Real Gateway correlation。
- Rust Account：default feature suite包含67 passed / 2 live ignored；`--no-default-features account:: --lib`为67 passed / 2 ignored，两条lane均green（含frozen descriptor、missing guarantee与Local Mode invariant）。
- Rust full lib：2070 passed / 2 live ignored，exit 0。
- `npm run typecheck`：passed。
- `npm run lint`：0 errors；16 pre-existing warnings in unrelated files。
- `npm run check:runtime-contracts`、`npm run check:branding`、`npm run doctor:strict`：passed。
- production bundle scan：`MockAccountGatewayV1`、`AccountLab` 与 canonical Mock scenario ID 均为 0；收窄 `accountFormValues.ts` 的 production import 后，其 chunk 从约 33 KB 降至 251 B。
- `npm run test`：1094/1094 test files completed，exit 0；最后的不可选Key UI修订另以focused 24/24 current-source suite复核。
- token2api：`go test ./...`与`go vet ./...`均exit 0。
- token2api PR门禁：旧API contract fixture已同步为“创建时一次性secret、列表metadata-only”；完整integration suite进一步发现旧cache trigger会对已哈希`api_keys.key`二次SHA-256，migration 222已修正raw rolling row与hashed row的统一cache-key语义，并兼容`key_hashed`状态与legacy/direct-write形状不一致的滚动窗口。真实PostgreSQL full integration、repository unit、Go 1.26.6 server contract与pnpm audit exception policy均在本地green；PR current head的12个远程checks全部通过，push/PR两套完整`test`分别13m24s与13m18s green。新发布的Go stdlib公告以1.26.6最小patch处理，`nanoid`公告以3.3.18最小patch处理，未扩大framework升级面。
- OpenSpec：`change/integrate-token2api-account-system` strict validation通过；`openspec validate --all --strict`仍因4个unrelated既有change失败，未冒充repository-wide全绿。本机缺少`~/.claude/skills/osp-openspec-sync/scripts/validate-consistency.py`，consistency wrapper无法执行。
- 新增 Account files 已全部拆到 800 行 new-file ratchet以内；`npm run check:large-files:gate`仍因当前 dirty worktree/baseline把 78 个既有或并行文件判为`new`而失败，但失败清单已无任何`src-tauri/src/account/**`或`src/features/account/**`文件。不得把本地 DMG verdict提升为 merge-ready。

## 5. Current existing-key internal trial package

2026-08-14 基于current source执行`npm run build:mac-arm64 -- --skip-sign --skip-notarize`，并对exact bundle做启动与Settings Account目视验收。该包包含Real Account adapter与existing-key选择闭环；由于token2api PR #37尚未merge/deploy，production origin当前会truthfully fail closed并显示账号服务暂不可用，不能把本地包称为production A0完成。

- DMG：`release-local/doge_0.1.0_aarch64.dmg`（35,068,841 bytes，约33 MB）。
- SHA-256：`a1a1e4a43d5cfb693e7a560ac9af94be6c2105541be1d7cab6489302f5a70e30`。
- Architecture：App executable、bundled daemon、`libssl`与`libcrypto`均为Mach-O arm64；OpenSSL references使用bundle内`@rpath`。
- Integrity：`hdiutil verify`为VALID；production bundle含`https://token-matrix.com`，不含isolated E2E origin、test identity、Mock Gateway或scenario ID。
- Exact GUI：AppShell无透明度穿透；Settings Account只呈现Local Mode状态、账号服务状态与retry，解释收进自适应`?` tooltip；canonical orange Doge icon在App与配置入口保持一致。
- Signed-in flow evidence来自同一current-source Preview/Real isolated验收：`登录 → 选择已有API Key → 文件列表 → 点击展开safe semantic diff → 明确同意应用 → 结果/气泡重开`；无Key、全部Key不可用或选择失效时均提供`https://token-matrix.com/keys`并允许返回刷新。
- Signing limitation：unsigned internal-only；`codesign --verify --deep --strict`按预期失败（no resources），未notarize，不作为跨Mac无摩擦分发门禁通过证据。

## 6. Prior M0 UI review package（historical）

2026-08-13 00:00 完成 current-source `VITE_DOGE_ACCOUNT_UI_PREVIEW_V1=1` macOS arm64 internal review build。该包是 **M0 — Account UI Mock Review Package**，只用于visual/interaction review；真实token2api、OS vault、Account SQLite与真实配置写入均由build-time preview boundary关闭，不是A0 Real集成包。

- DMG：`release-local/doge_0.1.0_account-product-preview_aarch64.dmg`（33 MB）。
- SHA-256：`254fd3846263c0e929cdf24e5446e43fb3852ba52b9521fcae44df5d4919f093`。
- Architecture：App executable与bundled daemon均为Mach-O arm64；OpenSSL依赖使用bundle内`@rpath/libssl.3.dylib` / `@rpath/libcrypto.3.dylib`。
- DMG：`hdiutil verify` checksum VALID；App/daemon architecture与OpenSSL references通过检查。
- Signing limitation：unsigned internal-only；`codesign --verify --deep --strict`按预期失败（no resources），未notarize，不作为分发/安装门禁通过证据。
- GUI/manual（Computer Use，exact 23:49 current bundle）：
  - Settings Account不存在scenario selector/preview toolbar；signed-out为`登录 / 注册`2 tabs，找回为login内action；
  - authenticated为`概览 / 额度 / 安全`3 tabs；额度只在点击`额度`后读取；
  - configuration dialog不透明，canonical Doge icon一致；初始focus为`稍后处理`，help tooltip不自动展开；
  - changed-file list先展示，点击后才展开redacted semantic diff；apply后显示per-file result与`已知晓`；
  - ordinary close后全局Doge bubble跨Settings存在，独立`×`可hard dismiss，bubble主体可导航回Settings并reopen同一Preview Gateway task。
- `npm run lint`：0 errors / 16 unrelated existing warnings；`npm run typecheck`、runtime contracts、strict OpenSpec与`git diff --check`passed。
- `npm run test` current-source runner在235/274批因unrelated `ClaudeSettingsJsonDialog` Tab缩进用例达到默认5s timeout而exit 1；同一文件立即定点重跑3/3 passed（该用例34ms），判定为负载型flaky，不是Account回归。随后从file 941继续按同样4-file/1-worker方式运行到1097/1097，剩余157 files全部passed。账号/壳层focused 137/137、typecheck/lint/runtime/OpenSpec/GUI gates均green；未将首次全量exit 1误报为全绿。

## 7. Prior structural package（historical）

2026-08-12 15:08 曾执行 `npm run build:mac-arm64 -- --skip-sign --skip-notarize`。随后新增 Authority descriptor/guarantee hard gate，因此以下产物现在是**旧的结构验收包**，不得再称 current-source package；最终集成后必须重新构建：

- DMG：`release-local/doge_0.1.0_aarch64.dmg`（33 MB）。
- App：`src-tauri/target/aarch64-apple-darwin/release/bundle/macos/doge.app`（56 MB）。
- Architecture：App executable 与 bundled daemon 均为 Mach-O arm64；OpenSSL 依赖使用 `@rpath/libssl.3.dylib` / `@rpath/libcrypto.3.dylib`。
- DMG structure：`hdiutil verify` 通过；read-only mount 内含 `doge.app`、`Applications` symlink 与 background asset。
- production dist scan：`MockAccountGatewayV1`、`AccountLab`、canonical Mock scenario id 均 0 match；Real Account symbols与fixed origin存在。
- Limitation：包未签名、未 notarize，只能作为本机 internal trial；linker adhoc signature不封装resources，`codesign --verify --deep --strict`按预期失败，Gatekeeper不得记作通过。
- GUI/manual与生产账号Real E2E仍未完成；structural package green不等于A0。
- 通过 Computer Use 启动目视验收时，macOS 处于 locked state 且自动解锁失败；未绕过锁屏。用户解锁后需继续检查 AppShell、`Settings → Account`、login/register、Local Mode、offer/list/lazy detail/apply/result/bubble。

- SHA-256：`678c1b8ebbe3f3c4e14aa36090a903aec1c649a1c085b5e7b932955da1eaf9d0`。

Current production A0仍受token2api PR #37 merge/deploy、上游CI/security baseline清理、Developer ID signing/notarization与部署后production smoke阻塞；isolated Real E2E、current-source local package与exact bundle GUI已完成，但不越级声明production ready。
