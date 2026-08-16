# token2api T0 Execution Plan

> 状态：`T0-planning-complete / T1-not-ready`
>
> Project role：`token2api API owner / backend-runtime-engineer`
>
> 核对日期：2026-08-12
>
> Scope：只读核对 `/Users/jason/GitHub/token2api`，冻结 clean baseline、semantic upstream sync、source PR、migration、rollback、test 与 ownership 执行计划；本 artifact 不修改 token2api source、schema、deployment 或 runtime state。

## 1. Executive Decision

OpenSpec task 2.3 的 planning output 已具备：current checkout、cached refs、live remote refs、dirty overlap、route/service/schema inventory、M1–M10/A1–A3/T-GAP mapping、semantic sync、PR/migration/rollback/test 与 approval ledger 均有可核对 evidence。

**T1 source changes 当前仍不得开始。** 用户已在本次 delegation 明确授权本需求范围内的 token2api source work；这满足 `token2api/AGENTS.md` 的“业务 scope 需 explicit approval”，但不等于 execution prerequisites 已完成。以下 hard blockers 仍在：

1. 当前 token2api checkout dirty，且 local/cached refs 落后 live remote；不可作为 source baseline。
2. 尚未在git-common-dir独立的standalone clone执行 B0 live ref refresh + semantic upstream sync；`02e50cc22` 尚不在 current/cached fork baseline。
3. token2api 已建立独立 `O-B0: sync-account-security-baseline` OpenSpec，但dual reviewer gate/task 1.4尚未通过；其`design.md`/`tasks.md`是B0执行事实源，review PASS前不得开始source sync。
4. doge task 1.3 authority shape freeze 与 1.7 v1 freeze 仍未完成；不得预先固化 Desktop route DTO 或 guarantee payload。
5. 当前授权不包含 production deployment、production migration、commit、push 或 PR publication；这些动作需要届时 execution brief 单独授权。

因此本计划给出的授权结论是：**scope authorization = approved；T1 execution readiness = blocked。** B0/5.1 与下文 `O-*` OpenSpec prerequisites 完成并由 `doge-project-lead` 派发后，才可把 T1 状态翻为 ready。

## 2. Evidence Boundary And Repository Rules

### 2.1 Read rules

- doge：`AGENTS.md`、`.agents/agents/backend-runtime-engineer.md`、`.agents/agents/doge-project-lead.md`、`.agents/agents/README.md`、`.trellis/spec/backend/**`、相关 guides、formal `design.md`/`tasks.md` 与既有 research。
- token2api：`/Users/jason/GitHub/token2api/AGENTS.md`；`find` 未发现更深层 `AGENTS.md`。
- token2api 的 source-change rule 要求：优先 runtime/config；若必须修改 upstream-tracked source/schema/behavior，须解释 config 不足、记录 upstream merge impact、取得 explicit user approval。

本 change 无法用 config 完成的原因已经成立：atomic refresh/MFA consume 是 server linearizability；durable revoke 与 key hash-at-rest 是 schema/storage truth；Desktop OAuth/reset 是新 transport；typed error/capability 是 server contract。以上均不是 runtime flag、admin setting 或 doge client compensation 可以安全实现的行为。

### 2.2 Prohibited evidence shortcuts

- 未读取或输出任何 secret、credential、Terraform value、environment value 或 production payload。
- 未执行 `pull`、`fetch`、`clone`、`merge`、`reset`、`checkout`、worktree creation、migration、deployment 或 source write。
- live remote facts只来自 read-only `git ls-remote`；它不会更新 local refs。production deployed SHA/version 未被探测，因此保持 **unknown**，不得以 cached release record替代。

## 3. Current HEAD, Origin, Upstream And Release Facts

| Fact class | 2026-08-12 evidence | Decision impact |
|---|---|---|
| Current checkout | branch `main`；HEAD `7a9906d5d67e8db137ac199c3ab3a7d4224c285b`；`backend/cmd/server/VERSION=0.1.146` | stale/dirty；只可作为 audit input，不可建 T1 branch |
| Cached fork ref | `refs/remotes/origin/main=8f0036e8582967ecddca0c7181eeb9942db8d7d6`；local branch显示 behind 10；cached VERSION `0.1.168`；ref最后 fetch于 2026-08-08 | cached ref本身也不是当前 remote truth |
| Live fork ref | read-only `git ls-remote origin`：`main=3b1f15f8de77acb0b43f83515e283db7b416ae78` | B0 必须 fetch 后以 exact object重新审计；本 T0 不猜该 commit 的 VERSION/content |
| Remote config | 仅配置 `origin=https://github.com/jasonmao-msj/token2api.git`；没有 configured `upstream` remote | B0 需显式、可审计地引入 upstream fetch source；不得把 stale `refs/remotes/upstream/*` 当 remote config |
| Cached upstream security release | local annotated `v0.1.172` tag object `61ba94d2...`，peeled commit `155c494964c3ea6ecc31f52679525c1034bf0f16`；tagged tree内 VERSION为 `0.1.171` | tag名、tag object、peeled commit、tree VERSION要分别记录，禁止混称 |
| Live upstream | `Wei-Shaw/sub2api` live `main=4ec9ceec4adac9b7679848347164804451bca48a`；latest observed tag `v0.1.173` object `9e2a27ad...`，peeled `29009f0b2ea14edf3b11ae2564fb617ff91a03b4` | B0 默认评估 `v0.1.173` 或执行时更新且批准的 newer release，不锁死旧 tag |
| OAuth takeover baseline | commit `02e50cc22d038dabf3c6af92dbb92d1e0321f8d5` 不在 current HEAD，也不在 cached `origin/main`；在 local peeled `v0.1.172` ancestry内 | OAuth release前 B0/M1 hard blocker；必须保留 upstream regression |
| Production release | 未执行 production probe；exact deployed SHA/version/guarantees unknown | 不能部署、迁移或启用 Real adapter；T4/5.5 必须补 exact deployment evidence |

`v0.1.172` tag tree VERSION 比 tag名小一位属于 packaging/timing fact，不应被解释为 tag无效。release ledger始终以 immutable tag object + peeled commit + artifact metadata 三元组标识。

## 4. Dirty Work Matrix And Overlap Decision

### 4.1 Snapshot

当前 token2api index无 staged change。tracked modified共 15 个：

| Area | Dirty paths | Direct T1 overlap | B0 sync overlap |
|---|---|---:|---:|
| Docs | `docs/aws-operations-runbook.md`、`docs/aws-workstation-setup.md`、`docs/gpt-native-share-experiment.md`、`docs/open-webui-byok-chat.md` | No | Possible |
| Frontend dependency | `frontend/pnpm-lock.yaml` | No | **Yes**；upstream sync常改 lock/workspace |
| Fork infra | `infra/aws/README.md`、`infra/aws/ai-share-remote-backup-handoff.md`、`infra/aws/dns.tf`、`infra/aws/iam.tf`、`infra/aws/imports/production-us-east-1.md`、`infra/aws/outputs.tf`、`infra/aws/terraform.tfvars.example`、`infra/aws/tools/inventory.py`、`infra/aws/variables.tf` | No | **Yes/structural**；fork-only capability可能被 upstream tree删除或移动 |
| OpenSpec | `openspec/specs/ai-share-chat/spec.md` | No | **Yes/structural** |

Untracked共 2 个 top-level path：`frontend/pnpm-workspace.yaml` 与 `openspec/changes/archive/2026-08-08-retire-ai-share-chat/`。它们与 T1 auth source没有直接 path overlap，但与 B0 whole-tree sync有 structural overlap。

用于收尾核对的 sanitized snapshot fingerprints：

- porcelain status SHA-256（NUL-delimited）：`16487b93b1b4989a3302d0363e014daef76da24e8992823f2331558370493de1`
- tracked diff SHA-256：`932105369bdd823fe63458a592810984425754891b8405aea8d03291c51a3ec3`
- untracked-name list SHA-256：`250b71546722c30b0de91f5f61c830f80f3ff9e378aaf5491be8d07fb7141`
- staged diff SHA-256：`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`（empty）

### 4.2 Decision

- **不得在当前 worktree stash、discard、commit、rebase 或叠加 source work。** dirty ownership未知，必须视为其他用户/agent资产。
- B0 应在git-common-dir不同、无`--shared`/`--reference`/alternates的standalone clone中，从 freshly fetched live `origin/main` exact SHA创建candidate；当前 dirty checkout只做before/after只读取证。
- 若 B0 semantic matrix发现必须移植当前 dirty path内容，先停止并由原 owner提供 commit/patch/handoff；不得自行读取敏感值、复制工作副本或整文件覆盖。

## 5. Current Route → Handler → Service → Schema Inventory

以下是 current checkout的实现定位，不是 frozen renderer/API DTO。B0 后所有 path/symbol必须重新 inventory 并生成 delta。

| Current route/domain | Handler | Service/repository | Current durable/cache fact | T0 classification |
|---|---|---|---|---|
| `POST /api/v1/auth/register`、`/login` | `AuthHandler.Register`、`Login` | `AuthService` token issuance；user repository | `user` schema；refresh state经 cache | reuse business rules；M2/M4/M8/M10 gate |
| `POST /api/v1/auth/login/2fa` | `AuthHandler.Login2FA` | `TotpService` + `TotpCache` | temp login session先 Get、后 best-effort Delete | reuse；M3 atomic consume gate |
| `POST /api/v1/auth/refresh` | `AuthHandler.RefreshToken` | `AuthService.RefreshTokenPair`；`RefreshTokenCache` / repository | current `GET → DEL → mint`，无 durable lost-response result | M2/T-GAP-02 source change |
| `POST /api/v1/auth/logout` | `AuthHandler.Logout` | `AuthService.RevokeRefreshToken` | revoke error可被吞，nil cache可 no-op success | M5/T-GAP-11 source change |
| `POST /api/v1/auth/revoke-all-sessions` | `AuthHandler.RevokeAllSessions` | `AuthService.RevokeAllUserTokens`；user repo | user schema无 persisted session generation | M4/T-GAP-03 schema change |
| `POST /api/v1/auth/forgot-password`、`/reset-password` | `AuthHandler.ForgotPassword`、`ResetPassword` | `AuthService.RequestPasswordResetAsync`、`ResetPassword` | current reset link携 raw Web token/email | request/domain reuse；A2 narrow Desktop handoff |
| `/api/v1/auth/oauth/{provider}/start|callback|complete-registration|bind-login|create-account` 与 `/oauth/pending/**` | provider handlers；`AuthHandler.ExchangePendingOAuthCompletion` | provider services；`AuthPendingIdentityService` | browser cookie/fragment/pending session flow | M1先同步；A1复用业务、增加 generic Desktop transport |
| `GET /api/v1/auth/me`、`GET/PUT /api/v1/user/profile`、identity binding | `AuthHandler.GetCurrentUser`、`UserHandler` | `UserService` / user repo | `user`、auth identity schemas | 直接复用；M8/M10 normalization |
| `/api/v1/user/totp/**` | `TotpHandler` | `TotpService` / TOTP storage/cache | server持有 MFA truth | 直接复用；不在 doge重造 |
| `GET/POST/PUT/DELETE /api/v1/keys/**` | `APIKeyHandler.List/GetByID/Create/Update/Delete` | `APIKeyService` / API key repo | `api_key.key` raw；generic idempotency response与 deleted audit可含 raw key | M6/M7；T3前禁止 managed-key Real flow |
| `/api/v1/usage/**`、`/user/api-keys/:id/usage/daily` | `UsageHandler` | usage services/repos | authority-owned metering | 直接复用 read APIs；M8 error normalization |
| `/api/v1/subscriptions/{,active,progress,summary}` | `SubscriptionHandler` | `SubscriptionService` | progress collection可 silent partial；无 registered `/:id/progress` | summary可复用；M9/T-GAP-13在 progress UI前关闭 |
| `GET /api/v1/settings/public` | `SettingHandler.GetPublicSettings` | `SettingService` | 无 doge contract version/guarantee bits | 保留业务 flags；A3使用独立 versioned descriptor |

关键 source anchors：

- `backend/internal/server/routes/{auth,user}.go`
- `backend/internal/handler/{auth_handler,auth_oauth_pending_flow,totp_handler,api_key_handler,subscription_handler}.go`
- `backend/internal/service/{auth_service,refresh_token_cache,totp_service,api_key_service}.go`
- `backend/internal/repository/{refresh_token_cache,totp_cache,user_repo,api_key_repo}.go`
- `backend/ent/schema/{user,api_key,idempotency_record,pending_auth_session}.go`
- `backend/migrations/{057_add_idempotency_records,122_pending_auth_completion_token_cleanup,145_deleted_api_key_audit}.sql`

## 6. M1–M10 / A1–A3 / T-GAP Mapping

| Item | T-GAP / release surface | Required token2api treatment | Upstream strategy | Planned change/PR train |
|---|---|---|---|---|
| M1 OAuth takeover | A1 security precondition | integrate `02e50cc22` plus victim/pending/no-token regression | take upstream semantics; no fork rewrite | `O-B0` → `B0-sync` |
| M2 durable pair + refresh | `01`, `02` | remove access-only auth success；durable atomic family rotate；same-op bounded replay；reuse tombstone | propose generic upstream design；fork implementation only behind guarantees | `O-SESSION` → `S1–S3` |
| M3 MFA atomic consume/log | auth/MFA and A1 gate | atomic claim/consume；idempotent side-effect boundary；remove email/token fragments | generic upstream hardening | `O-SESSION` → `S4` |
| M4 revoke generation | `03` | persisted generation；access+refresh validation；typed revoke receipt | upstream design first；fork needs full migration matrix | `O-SESSION` → `S0`, `S3`, `S5` |
| M5 logout truth | `11` | typed `revoked/already_revoked/unconfirmed` or reconcile receipt；never false success | backward-compatible response evolution | `O-SESSION` → `S5` |
| M6 key lifecycle | `06` | hash-at-rest、metadata-only List/Get、one-time delivery ledger、audit/idempotency purge | high-drift generic upstream proposal；fork phased migration | `O-KEY` → `K0–K4` |
| M7 key patch presence | `07` | omitted/clear/set；sync existing upstream pointer semantics | take upstream implementation if still present after B0 | `B0-sync` + `O-KEY/K2` regression |
| M8 stable reasons/429 | `08` | closed reason set；standard envelope；`Retry-After`；message non-contract | generic upstream change | `O-CONTRACT` → `C1` |
| M9 subscription progress | `13` | explicit shape、partial/errors/observed_at；single-id route ownership or removal | upstream contract correction | deferred `O-SUBSCRIPTION` before progress UI |
| M10 auth log privacy | cross-cutting release/privacy gate | auth-safe logging；no email/token/query fragment；closed correlation only | generic upstream helper preferred | `O-CONTRACT` → `C2`；M3 hot path in `S4` |
| A1 Desktop OAuth | `04`；conditional `12` | generic Desktop authorization/ticket/exchange；state/PKCE/audience/device/TTL/single-use/MFA gate | narrow new transport reusing services；no provider-rule fork | `O-DESKTOP` → `D1–D3` |
| A2 reset handoff | `05` | trusted Web landing consumes raw token，App只收 opaque bound ticket | narrow transport；reuse current reset service | `O-DESKTOP` → `D4` |
| A3 descriptor | `09` | versioned contract + per-guarantee bits；missing/unknown fail closed | independent narrow endpoint preferred | doge 1.3/1.7 freeze → `O-CONTRACT/C0` |

Unowned/deferred gaps：

- `T-GAP-10` device/session inventory、revoke-one、account deletion属于 later change；当前不得显示或暗示该能力。
- `T-GAP-12` 仅在 selected deployment启用 human verification 时成为 A0 blocker；由 `O-DESKTOP` 增加 one-use Desktop proof handle，renderer不持有 challenge token。
- `T-GAP-13` 由 M9关闭；若首期隐藏 progress，仅 list/summary可交付，不得将它标记 completed。

## 7. Clean Baseline And Semantic Upstream Sync

### 7.1 B0 procedure

1. 原 dirty checkout保持 untouched；按O-B0记录before/after HEAD、index entries、refs、porcelain status、untracked paths与canonical git-common-dir fingerprints，不得stash/reset/checkout/clean/commit或读取/copy dirty content。
2. 使用explicit fork URL创建standalone clone；clone与原checkout的canonical `git-common-dir`必须不同，且不得使用linked worktree、`--shared`、`--reference`或alternates。O-B0 artifacts只通过approved commit/patch handoff进入clone。
3. 在clone内fresh fetch并冻结三点immutable evidence：`U_PREV`=fork上次同步的upstream peeled commit、`F_BASE`=fresh live fork tip、`U_NEXT`=approved upstream release peeled commit。Tag object、peeled commit、tree VERSION、signature status分别记录；U_NEXT必须以ancestry证明包含`02e50cc22`。
4. 分别生成rename/copy/binary-aware `U_PREV..U_NEXT` upstream release delta与`U_PREV..F_BASE` fork overlay；禁止以`F_BASE..U_NEXT`单范围替代。先完成overlap/path ownership/capability ledger，再做semantic merge。
5. B0只同步complete approved upstream release并保留M1/M7 regression；不得夹带T1 session、Desktop adapter、M6 key lifecycle、A3 contract或deployment新实现。
6. 按O-B0 executable validation matrix完成locks/generators、migration、backend/frontend、Docker linux/arm64、Terraform、secret scan、OpenSpec与fork regression gates；unavailable/skip默认blocker。
7. 未获commit授权时candidate明确标为`UNCOMMITTED`，不得声称immutable baseline；只有未来获得独立Git授权、形成并集成exact commit后才能冻结`B0_SHA`供T1派生。

**Execution source of truth**：本节是Doge dependency summary；token2api `openspec/changes/sync-account-security-baseline/design.md`与`tasks.md`是standalone clone、three-point evidence、two-range inventory、commands、review/approval、rollback与acceptance的规范执行事实源。两处不一致时先修订/重新review O-B0，禁止以本research覆盖它。

### 7.2 Capability matrix rules

O-B0 capability ledger必须至少覆盖：upstream security/domain；fork application behavior；governance/tooling/release workflows；Terraform/provider lock；legal/docs/assets build inputs；shared dependencies/locks/generated source；migrations与true conflicts。每个actual overlap记录canonical path、owner、take/preserve/reconcile/regenerate decision、targeted gate、rollback effect与review disposition。

禁止 `git checkout --ours/--theirs <whole-file>`、merge driver整文件覆盖、以“能编译”代替semantic evidence。具体canonical paths、reproducibility rules、migration ledger与validation commands不在本research复制维护，统一以O-B0 `design.md`/`tasks.md`为准。

## 8. Required token2api OpenSpec Changes And PR DAG

下列 `O-*` 必须在 **token2api 仓库内独立审批**。`O-B0` artifacts已建立但仍在dual review；其余changes仍待按dependency创建。它们必须引用doge frozen semantic contract，但不得把token2api wire DTO暴露为renderer contract。

| Change id placeholder | Source scope | Why independent |
|---|---|---|
| `O-B0: sync-account-security-baseline` | live origin/upstream sync、M1、M7 regression、fork capability matrix | upstream sync与feature implementation分 PR，便于回滚和 future sync |
| `O-SESSION: harden-auth-session-spine` | M2/M3/M4/M5；schema、refresh、MFA、logout | security/durability cross-layer change，需要 migration + rolling matrix |
| `O-DESKTOP: add-generic-desktop-auth-completion` | A1/A2，按部署策略含 T-GAP-12 | transport lifecycle/security review独立，不污染 provider business services |
| `O-KEY: harden-managed-api-key-lifecycle` | M6/M7 | secret migration/retention/backup risk最高，必须独立 rollback window |
| `O-CONTRACT: publish-account-authority-contract` | A3/M8/M10 | version/guarantee/error/privacy可独立验收；只有真实 guarantees通过才置位 |
| `O-SUBSCRIPTION`（deferred） | M9/T-GAP-13 | 不阻塞 Foundation；启用 progress UI前单独完成 |

PR dependency DAG：

```text
doge 2.3 plan
  -> O-B0 approved -> B0-sync(M1/M7) -> immutable B0_SHA
                                            |
doge 1.3 + 1.7 frozen ----------------------+
                                            +-> O-SESSION -> S0 -> S1 -> S2 -> S3 -> S4 -> S5
                                            |                  \-> O-DESKTOP -> D1 -> D2 -> D3 -> D4
                                            |                  \-> O-KEY -> K0 -> K1 -> K2 -> K3 -> K4
                                            \-> O-CONTRACT/C0 -> C1/C2 (only green guarantees advertised)

all required trains + conformance + rollback evidence
  -> token2api release candidate (no production deploy implied)
  -> doge Lane T readiness / late Real-adapter integration gate
```

Recommended server PR sequence：

| PR | Scope | Merge/enable rule |
|---|---|---|
| `B0-sync` | clean semantic upstream sync；M1/M7 only | phase-exclusive；all fork capability tests green |
| `S0-schema-expand` | append session generation、refresh family/operation/tombstone storage；generated code | additive only；old server仍可运行 |
| `S1-refresh-store` | atomic store primitives + repository fault tests | no route contract change；feature off |
| `S2-refresh-orchestration` | single-successor rotation、same-op replay、reuse tombstone | compatibility shadow/metrics first；guarantee false |
| `S3-issuance-validation` | durable-pair fail-closed；generation embedded/validated | rollout matrix green后才 enable；legacy family policy明确 |
| `S4-mfa-atomic` | atomic temp-session claim、exactly-once binding boundary、safe logs | auth edge single owner；MFA conformance green |
| `S5-revoke-logout` | durable increment、typed revoke-all/logout receipt、reconcile | only then advertise `durable_revoke_v1` / logout truth |
| `D1–D4` | Desktop auth record、callback/PKCE exchange、provider matrix、reset handoff | doge contract frozen；zero raw token in redirect/renderer/log/DB |
| `K0–K4` | key schema expand、dual read/new write、metadata contract、rotate/backfill、cleanup | managed-key capability stays false until recursive secret scan green |
| `C0–C2` | descriptor、stable errors/429、auth-safe logging | bit-by-bit truth；never advertise planned behavior |

## 9. Approved Single-writer Ownership Ledger

本 ledger 的“Approved”来自本次 user delegation 对 end-to-end requirement scope的明确授权；它只分配未来执行责任，不授权当前 T0 写源码、commit、push、PR或 deployment。每个 PR仍须有 token2api OpenSpec approval与 project-lead dispatch。

| Phase / path | Sole writer | Reviewer / consumer | Status and handoff |
|---|---|---|---|
| current dirty worktree全部现有 changes | existing user/agent owner（unknown） | token2api API owner read-only | **protected**；本 feature不得修改、stash或清理 |
| `B0-sync` whole-tree conflict resolution | token2api API owner，phase-exclusive | security reviewer + fork deployment owner | approved conditional on `O-B0`；B0期间不得并行 source PR |
| `backend/ent/schema/**`、new migrations、generated Ent files、schema test fixtures | T1 data/storage single writer | session owner + security reviewer | `S0` exclusive；生成后 handoff immutable schema commit给 S1–S5 |
| `backend/internal/service/refresh_token_cache.go`、`backend/internal/repository/refresh_token_cache.go` 及其 tests | T1 session-store single writer | auth integration owner | `S1` exclusive；interface freeze后 handoff |
| `backend/internal/service/auth_service.go`、JWT/session validation path及 tests | T1 auth-integration single writer | data/session owners read-only | `S2/S3/S5` serialized；不得多人并改 hot file |
| `backend/internal/handler/auth_handler.go`、`auth_oauth_pending_flow.go` 及 tests | T1 auth-edge single writer | security reviewer | `S3/S4/S5` serialized；MFA与logout不并行改同文件 |
| `backend/internal/service/totp_service.go`、`repository/totp_cache.go` 及 tests | T1 MFA single writer | auth-edge owner | `S4`；需要 handler change时由 auth-edge owner落盘 |
| Desktop new route/handler/record files；existing provider handlers | Desktop transport single writer；existing shared auth file仍由 auth-edge owner | provider/security matrix reviewer | `D*`从 frozen service interfaces开始；共享文件用handoff PR，不抢 ownership |
| API key schema/service/repo/handler/DTO/idempotency/audit paths | Key-lifecycle single writer | data owner审 migration，security reviewer审 secret flow | `K*`独立 train；不得与 generic schema generator并发 |
| settings/capability/error envelope/rate-limit/auth-safe logging shared paths | Contract single writer | Doge broker consumer + security reviewer | `C*`在 v1 freeze后；descriptor不复用 raw handler DTO |

Ownership rules：

1. 任一文件任一时刻只有一个 writer；shared hot file通过 serialized PR/handoff，不以跨 branch“最后再合”替代 ownership。
2. generated Ent output和 migration checksum只由 data owner生成；其他 owner提交 schema request，不手改 generated file。
3. security reviewer默认 read-only、可阻断 merge；不得同时作为同一 security invariant的唯一 author和唯一 approver。
4. 发现 current dirty path、新 agent branch或 upstream sync与上述 path overlap，立即停止并回报 lead；先更新 ledger，再继续。

## 10. Migration, Compatibility And Rollback

### 10.1 Global migration rules

- B0 后先检查 live latest migration ID；所有 migration使用新的 append-only ID，禁止预先假定编号，禁止编辑已存在的 `057`、`122`、`145` 或任何已应用 migration。
- 每个 schema train执行 `expand → backfill/dual-read → switch → contract/cleanup`。schema expand必须先于 reader/writer切换；destructive cleanup至少跨一个明确 release window并有 backup restore evidence。
- rolling compatibility matrix覆盖 `old server/new schema`、`new server/expanded schema`、mixed server pool、Redis restart、DB reload、rollback binary。unsupported mixed combination必须在 deploy runbook中 fail closed。
- feature/guarantee bits默认 false；rollback优先关 behavior bit并保留 additive schema，不以 down migration删除仍可能被旧/新 binary引用的数据。

### 10.2 Session spine (`S0–S5`)

| Stage | Data/behavior | Compatibility | Rollback window |
|---|---|---|---|
| Expand | persisted `session_generation` default/backfill；refresh family、operation result、tombstone durable records | old server忽略 additive storage；new server读取缺失值为 legacy generation 0 | 可回 old binary，保留 columns/tables |
| Dual | new issuance写 generation/family/op id；validation shadow-compare；legacy refresh families明确标记 | legacy token不伪装满足 atomic guarantee；Desktop可要求 reauth，Web legacy policy单独记录 | 关新 issuance/enforcement flag；不删 durable records |
| Switch | durable-pair fail closed；atomic consume/rotate；access+refresh generation enforcement；typed revoke/logout | mixed pool经过 linearizability tests后才切；否则 drain旧实例再切 | bounded switch window内回 binary + flag；已 tombstone/revoked generation绝不回退或复活 |
| Contract | descriptor逐 bit置 `durable_token_pair_v1`、`atomic_refresh_v1`、`durable_revoke_v1` | bit为 true即成为 client可依赖 guarantee | rollback先清 bit、使 Real adapter fail closed；不虚构 legacy success |

关键 rollback invariant：任何 rollback都不能 resurrect 已 revoke family、降低 generation、让已 consume refresh token再次成功，或把 remote unconfirmed改报 confirmed。

### 10.3 Managed API key (`K0–K4`)

1. **Expand**：新增 pepper-aware hash、nonsecret prefix/fingerprint、secret version、one-time delivery ledger；deleted audit新增 nonsecret fields。legacy raw column暂保留。
2. **Dual read/new write**：auth lookup先 hash再受控 legacy；所有新 key只写 hash；List/Get开始建立 metadata projection，但 capability仍 false。
3. **Backfill/rotate**：可安全 hash的 legacy raw row做 hash backfill；要求 users/automation逐步 rotate；记录 remaining legacy count，不输出 key。
4. **Contract switch**：List/Get/Update metadata-only；Create/Rotate只经 purpose-specific encrypted short-TTL delivery ledger replay；generic `idempotency_records.response_body`不得存 secret。
5. **Cleanup**：purge `deleted_api_key_audits.key`历史 plaintext与 generic idempotency secret response；按 retention policy处理 backup；证明 zero legacy read后才考虑 drop raw column。

Rollback只能在 cleanup前回到 dual-read；一旦 metadata-only contract/secret cleanup完成，不允许通过 rollback重新开放 raw List/Get。delivery failure时 capability关闭、人工 rotate/reconcile，不生成第二枚不可追踪 key。

## 11. Feature Flags And Guarantee Truth

Server flags与 A3 guarantees是两个层次：flag控制 rollout，guarantee只描述已验证且当前 active的行为。建议的 internal flags为：

- `desktop_account_contract_v1`
- `durable_token_pair_v1`
- `atomic_refresh_v1`
- `durable_revoke_v1`
- `desktop_oauth_ticket_v1`
- `desktop_reset_handoff_v1`
- `managed_key_one_time_v1`
- deployment-specific `desktop_human_verification_v1`

Requirements：默认 off；未知/缺失 fail closed；per-capability独立启用/回滚；不能只因 code merged就发布 bit；Local Mode不读取这些 flags也不受 authority outage影响。doge Real adapter只有在 exact deployment SHA/version与所需 bits匹配 frozen contract时才可启用。

## 12. Contract Tests, Fake Authority And Record/replay Fixtures

### 12.1 Server acceptance without UI

每个 T train必须在无 doge/UI 条件下通过：

- API schema/route contract tests：status、stable reason、retry hint、opaque IDs、absence semantics与 redaction。
- state-machine tests：happy path、terminal error、duplicate same operation、concurrent different operation、expired、replayed、cancelled/disconnected client、lost response、process/Redis restart。
- persistence/fault tests：DB commit boundary、Redis unavailable、transaction failure、migration forward/rollback compatibility、backup restore sampling。
- security tests：M1 victim state不变；MFA exactly one success；generation reload；OAuth state/PKCE/audience/device/redirect/TTL；secret/PII canary recursive scan。
- compatibility tests：current Web clients、old/new server/schema matrix、feature-off behavior、unknown contract version。

Cancellation rule：client disconnect/cancel只停止等待，不隐式撤销已提交 server operation；相同 `operation_id` retry必须 replay/reconcile terminal result。未经 server receipt不得把 timeout显示为 failure或 success。

### 12.2 Sanitized Authority fixtures

由 token2api contract tests生成 canonical normalized traces，再经过 sanitizer提交至 doge fixture corpus；禁止手工复制 production response。

Fixture最小集合：

- register/login/verify/MFA pending + terminal；durable write failure；MFA duplicate/claim failure。
- refresh first success、same-op lost-response replay、different-op reuse、family revoked、generation stale、cancel-after-commit。
- logout `revoked/already_revoked/revocation_unconfirmed`；revoke-all receipt/reconcile。
- OAuth provider×intent×MFA×pending decision；state/PKCE/device/audience/redirect/expiry/replay failures；M1 takeover regression。
- reset requested neutral result、handoff expired/replayed/wrong device、Web/App exclusive completion。
- key create one-time delivery/replay、metadata list/get、omitted/clear/set ACL、secret delivery expiry/delete/rotate。
- error envelope 4xx/409/422/429/5xx、`Retry-After`、unknown reason/version/guarantee。

Sanitizer gate递归拒绝：access/refresh/reset/pending/API key/TOTP token、cookie、authorization header、email、provider subject、URL query/fragment与 production IDs。保留 synthetic stable IDs、relative timing、status/reason/retry hint、operation state。record/replay metadata必须包含 `contract_version`、fixture schema version、generator commit、sanitizer version和 deterministic clock seed。

Fake authority必须和 Real authority运行同一 conformance scenario set：

| Dimension | Fake acceptance | Real token2api acceptance | Equality rule |
|---|---|---|---|
| State transitions | deterministic clock/fault injection覆盖全部 terminal branch | integration DB/Redis + HTTP fault injection | same terminal state and stable reason |
| Idempotency | same op replay same receipt/result | persistent operation ledger survives restart | no duplicate side effect |
| Cancellation | cancel after submit可 query/retry | disconnect after commit可 reconcile | cancellation不是 rollback |
| Refresh/revoke | family/tombstone/generation model | storage reload与concurrency evidence | no token resurrection |
| Error mapping | closed reason set；unknown injection | message可变化，reason稳定 | broker不解析 raw message |
| Redaction | fixture serializer rejects canary | logs/DB/response/support bundle scan | zero forbidden secret/PII |
| Capability | bits按 scenario可控 | bits只随 verified deployment enable | missing/false/unknown都 fail closed |

## 13. Test Gates And Rollback Evidence By PR

| Gate | Required command/evidence class | Blocks |
|---|---|---|
| B0 build/regression | backend Go test/build/lint；frontend lock/install/typecheck/build；migration checksum；fork infra static validation；M1 regression | all source trains |
| Session correctness | handler/service/repository unit + DB/Redis integration + 50+ concurrency + crash points + rolling matrix | persistent login/restore/refresh/revoke/logout guarantees |
| Desktop completion | route schema + provider matrix + loopback/app-not-running + token-flow recursive scan | OAuth/reset Real adapter |
| Key lifecycle | schema/auth lookup/DTO/idempotency/audit/backup tests + secret canary scan | managed key/config write |
| Contract/error/privacy | descriptor truth table、negative scenario table、429 headers、log/support bundle canary | Real adapter enablement |
| Guest regression | authority flags off/unreachable/invalid；no account setup；existing Local Mode launch/task/session/preferences remain green | every token2api release candidate and doge integration |
| Rollback drill | release `N-1/N` schema matrix、flag-off、binary rollback、DB restore sample、no resurrection/no re-exposure assertions | production migration/deployment approval |

No UI is required for these gates. UI review通过前继续 zero real doge↔token2api interaction；token2api server tests与 doge fake-authority tests独立运行。

## 14. Ready-for-T1 And Ready-for-Integration Checklists

### 14.1 T1 source start

- [x] 当前 direct user delegation明确授权 end-to-end requirement scope内的 token2api source changes。
- [x] configuration insufficient与 upstream merge impact已在本计划逐项记录。
- [x] current dirty work已 inventory，T1 direct path overlap为 none，B0 structural overlap为 yes。
- [ ] current dirty work owner/handoff已确认且保持 untouched。
- [ ] live origin/upstream已在git-common-dir独立的standalone clone中fresh fetch，并冻结U_PREV/F_BASE/U_NEXT与two-range inventories。
- [ ] `O-B0` approved，`B0-sync`通过并冻结 `B0_SHA`；`02e50cc22` ancestry + regression green。
- [ ] doge task 1.3 与 1.7已冻结 Authority shape/v1 contract。
- [ ] token2api `O-SESSION`已建立、reviewed、approved，T1 single-writer paths已由 lead派发。
- [ ] execution brief明确是否授权 local edits、commit、push、PR；production/deployment仍 excluded。

任一未勾选项存在时，**不得开始 T1 source changes**。

### 14.2 Late Real-adapter integration

- [ ] T1/T2/T3/T4所需 train、migration与 rollback drills全部 green。
- [ ] exact token2api release/deployed SHA、contract version与 guarantee bits可验证。
- [ ] Fake/Real conformance matrix相同；sanitized fixtures由相同 scenarios生成。
- [ ] doge broker acceptance无 UI可独立通过；guest/Local Mode regression green。
- [ ] UI通过评审；此前无真实 interop。
- [ ] Real adapter替换只发生在 composition root；renderer contract与 Mock adapter shape不变。
- [ ] negative scenarios、cancellation/lost response、vault/restart、OAuth provider matrix通过。

## 15. No-UI-Rewrite Guarantee

联调后不要求 UI 重写，只有在以下条件持续成立时才可承诺：

1. doge renderer只依赖 frozen product port；token2api wire DTO、server reason message、Rust persistence/vault entity均不外泄。
2. Mock、Fake、Real adapters通过同一 product-port contract tests；Real只做 wire→canonical mapping。
3. A3 version/guarantees、closed error algebra、absence semantics、idempotency/cancellation receipt在接 Real前冻结。
4. Backend新增字段默认 additive/optional；breaking change提升 contract major，旧 adapter fail closed而不是猜测。
5. UI状态与文案不依赖 raw HTTP status/message、provider-specific callback字段或 secret presence。
6. feature flag/capability只改变入口可用性与 typed terminal state，不改变 renderer payload shape。
7. Local Mode path与 Account Mode依赖图隔离；authority失败不会改变 guest/local data model。

如果任一条件被破坏，必须重新走 contract/UI review，不能把 renderer rewrite成本隐藏为“adapter integration”。

## 16. T0 Handoff Contract

交给 `doge-project-lead` / token2api API owner的下一步不是 T1 code，而是：

1. 完成token2api `O-B0` dual review；保护现有dirty checkout，在git-common-dir独立的standalone clone执行，不使用linked worktree。
2. 按O-B0 design/tasks fresh refs、冻结U_PREV/F_BASE/U_NEXT、生成two-range ledger，完成phase-exclusive semantic upstream sync与M1/M7 regression。
3. 完成 doge 1.3/1.7 freeze；再在 token2api 建立 `O-SESSION`，把 frozen semantic contract与本文件的 single-writer/migration/test matrix写入 tasks。
4. 由 lead发出明确 T1 execution brief；source edit可在该范围内开始，commit/push/PR/deploy按独立授权执行。

当前结论保持：**task 2.3 planning evidence complete；O-B0 artifacts存在但dual review未完成；T1 source start not authorized yet；token2api source/schema/runtime unchanged。**
