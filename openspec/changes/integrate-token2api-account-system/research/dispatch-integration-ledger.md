# Dispatch Plan and Integration Ledger

> Change：`integrate-token2api-account-system`
>
> 状态：`active / G1-blocked / continuously-updated`
>
> 初始治理快照：2026-08-12 04:56:19 -0700
>
> Owner：`documentation-governance-owner`

## 1. Purpose and truth rules

本文是当前 change 的 durable Dispatch Plan、handoff index 与 continuously updated Integration Ledger。它记录已发生的派工和工作区事实，但不替代 formal `proposal.md`、`design.md`、behavior spec 或 executable `tasks.md`。

状态语言必须遵循以下规则：

- `candidate`、`lane-local`、`review-blocked`、`ready-for-re-review`、`review-passed` 与 `gate-passed` 是不同状态。
- C0 自检或 task 1.1–1.5 checkbox 不等于 task 1.6 independent review通过，也不等于 G1/task 1.7完成。
- F0/D0/T0 任一 lane green 不等于 cross-lane conformance、Real integration、M0 或 A0完成。
- M0 只能写 `UI accepted against Mock scenarios`；只有 A0 可写 `local packaged trial complete`。
- Working-tree snapshot 是带时间的 evidence，不是永久 current fact。active writer继续修改后，必须追加新 snapshot，不能覆盖旧 observation 的含义。
- 不在本文复制 credential、secret、PII、raw callback、absolute user path、config content、diff payload或大段线程输出。

## 2. Governance deviation GD-001

### 2.1 Finding

OpenSpec task 0.3 要求在任何 write 之前存在 consolidated Dispatch Plan，冻结 C0/F/D/T、shared integration、review/release ownership、non-goals 与 collaboration notice。首批 individual delegation briefs 确实在各 writer 开始前给出了 bounded ownership、non-goals 与 collaboration notice，但没有发现一个在首批写入前已落库、可追溯且覆盖全部 lane/shared/review/release owner 的 consolidated Dispatch Plan artifact。

本 ledger 创建时，以下写入已经发生：

- C0：`src/features/account/contracts/**`；
- F0：`src/features/account/**` excluding `contracts/**`；
- D0：`src-tauri/src/account/**`；
- T0：`research/token2api-t0-execution-plan.md`。

因此 task 0.3 的 historical `before writes` gate **未满足**。本文只能重建事实与建立 prospective control，不能事后伪造成 pre-write evidence。task 0.3 保持未勾选。

### 2.2 Impact and mitigating evidence

| Dimension | Current evidence | Verdict |
|---|---|---|
| Individual brief | 六个线程均有明确 role/goal/ownership/non-goals/validation；write brief包含 collaboration notice | Partial mitigation；不是 consolidated plan |
| Path ownership | C0/F0/D0/T0 当前 path roots互不重叠 | No observed first-batch path collision |
| Shared zones | Settings/AppShell/Tauri registries/Cargo/locale indexes/Codex runtime已在 `tasks.md`列为 serialized zones；初始 snapshot 未发现这些 zone 的 account-lane diff | Mitigation only；后续仍须 pre-write check |
| Review independence | Type/Security reviewers均为 read-only，未修改 canonical files | Satisfied for initial review |
| Historical gate evidence | 没有首批写入前的 durable consolidated plan | Missing；0.3不能关闭 |

### 2.3 Project-lead disposition — option 2 accepted

2026-08-12，`doge-project-lead` 接受 option 2：将 task 0.3 作为 **prospective remediation gate** 继续执行。该决定不改变 historical finding：first batch 永远不能被写成 retroactively compliant，也不能删除 `GD-001`、倒填早于实际创建时间的记录，或用 thread transcript替代 repo artifact history。

Task 0.3 继续保持未勾。只有同时满足以下条件，lead才可把它关闭为 **`remediated, not retroactively compliant`**：

1. 至少一个 ledger 创建后的 **source write wave** 在任何 source write发生前有明确 ledger revision。
2. 该 pre-write revision 冻结所有 exclusive source owners、dependencies / accepted input、shared serialized exclusions、read-only reviewers、non-goals、validation与completion language。
3. 每个 writer的 dispatch brief包含 collaboration notice，且与 ledger revision一致。
4. Wave结束后记录 point-in-time actual diff，并通过 path/symbol ownership overlap audit；shared serialized zones无未授权写入。
5. Closure wording保留 `GD-001`，明确 first batch未曾合规；不得简写为 `0.3 historically passed`、`pre-write gate satisfied for first batch` 或其他 retroactive claim。

当前 token2api `O-B0` PlanFirst artifact creation 发生在本 ledger 建立和明确派工之后，但它是 **docs/spec wave**，不是 source write wave。即使其 ownership、dependencies和reviewers均可追溯，也不能单独满足上述 source-wave remediation acceptance。它只证明 prospective control已开始运作；0.3仍保持未勾。

## 3. Reconstructed first-batch Dispatch Plan

### 3.1 Assignments and current state

| Lane / role | Thread | Exclusive write ownership | Explicit non-goals / forbidden zones | Current handoff state |
|---|---|---|---|---|
| C0 — `quality-engineer` acting as designated canonical contract owner | `019fefee-be9d-7922-ad5e-4e2870967816` | `src/features/account/contracts/**` only；canonical schema/manifest/validators/fixtures single writer | No UI、Rust broker、network、token2api；no Settings/AppShell/Tauri registry/Cargo/locale indexes；reviewers read-only | **Active remediation** after Type/Security BLOCKED verdicts；1.6/1.7 remain open |
| F0 — `frontend-engineer` | `019fefee-1aba-7e53-9860-a709e9bbdf3a` | `src/features/account/**` excluding `src/features/account/contracts/**`；feature-local provider/consumer/Mock/Lab/runtime/tests/styles/locale leaf files | No canonical contract edits、Settings/AppShell/global route、Tauri services/native、locale indexes、style loader/package/config | **Active lane-local implementation**；final conformance waits for C0 delta；2.1 remains open |
| D0 — `backend-runtime-engineer` | `019fefee-ba42-77f1-904e-75e6e27f40c8` | `src-tauri/src/account/**` leaf-only Rust harness | No `lib.rs`/`state.rs`/`command_registry.rs`、Cargo manifests/lock、frontend/contracts/token2api/real network/OS vault/SQLite | **Active lane-local harness**；lead已明确禁止在C0 blocked时勾2.2；final alignment waits for C0 delta |
| T0 — token2api evidence/planning, performed by `backend-runtime-engineer` lane | `019fefee-ba42-77f1-904e-75e6e27f40c8` | `research/token2api-t0-execution-plan.md` only for this slice；token2api repository read-only | No token2api source/schema/deployment、no fetch/merge/worktree mutation、no commit/push/PR | **Planning evidence complete**；2.3 checked；T1 remains not ready |
| Type Contract Review — `type-contract-reviewer` | `019fefee-f28d-76f0-ab46-6e26311e0aae` | Strict read-only | No canonical/tasks/source writes；does not implement fixes | **BLOCKED**；re-review not yet passed |
| Threat Review — `security-privacy-reviewer` | `019fefef-42ec-7663-916b-9acb6bff72c8` | Strict read-only | No canonical/tasks/source writes；does not implement fixes | **BLOCKED**；re-review not yet passed |
| Governance ledger — `documentation-governance-owner` | current documentation thread | This file；only task 0.3/0.4/1.7 governance wording when authorized | No source/canonical/proposal/design/spec edits；no reviewer verdict rewrite | Active continuous ledger |

### 3.2 Shared serialized zones

The following zones are not owned by current parallel leaf writers and require a new pre-write ledger revision plus one exclusive integration owner:

| Zone | Reserved owner / phase | Current rule |
|---|---|---|
| Canonical schemas、scenario manifest、validators、forbidden corpus | C0 designated contract owner through G1 | Other lanes consume only；reviewers read-only |
| `src/features/app/hooks/useSettingsModalState.ts`、`src/features/settings/**`、`src/app-shell-parts/**`、style loaders | F6 frontend integration owner | No F0 write |
| `src/services/tauri.ts`、`src/services/tauri.test.ts`、`src-tauri/src/{command_registry.rs,lib.rs,state.rs}` | D7 IPC integration owner | No D0 write |
| `src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` | D6 dependency integration owner | No current lane write |
| Locale `index.ts` files | F6 i18n integration owner | F0 may write feature-local locale leaf files only |
| Codex target/provider/session runtime shared files | C3/C4 Codex recipe/runtime owner | Wait for D5/config contract gate |
| token2api routes/handlers/services/schema/migrations | Future token2api OpenSpec single writers | T0 is evidence-only；T1 blocked |
| `tasks.md` execution truth | Assigned task owner for its explicitly authorized checkbox; governance wording by documentation owner | No broad task-body rewrite by source lanes |

At the initial snapshot, no account-lane diff was observed in the Settings/AppShell/Tauri registry/Cargo serialized paths listed above. This is a time-bounded observation, not a future guarantee.

## 4. Contract version ledger

| Contract / schema | Candidate version | Authority | Current support verdict |
|---|---:|---|---|
| `doge-account-semantic` | `1.0.0` | C0 designated contract owner | Candidate only；G1 blocked |
| `doge-account-gateway` / `AccountGatewayV1` | `1.0.0` | C0 designated contract owner | Candidate only；F0 consumes but must realign after C0 remediation |
| `doge-account-ipc` | `1.0.0` | C0 designated contract owner | Candidate only；initial Type/Security review found runtime/identity blockers |
| `doge-account-broker` | `1.0.0` | C0 designated contract owner | Candidate only；D0 is lane-local harness, not cross-language acceptance |
| `token2api-account-authority` | `1.0.0` | C0 semantic shape + future token2api API wire owner | Semantic candidate only；wire routes/guarantees not frozen or deployed |
| `doge-config-recipe` | `1.0.0` | C0/config contract owner | Candidate only；no planner/apply implementation acceptance |
| `doge.account.codex-token-service` | recipe version `1` | Local immutable recipe owner | Candidate schema seam only |
| `doge-account-persistence` | schema version `1` | C0/data-storage bounded owner | Candidate only；initial review found record-schema enforcement gaps |

**Supported version decision：none for Real integration.** G1/task 1.7 remains blocked until C0 remediation is complete and both independent reviewers return passing re-review verdicts. Unknown version/enum/guarantee must continue to fail Account Convenience closed while Local Mode remains available.

## 5. Handoff and review ledger

| Record | From → To | Artifact / evidence | Status | Downstream rule |
|---|---|---|---|---|
| H-001 | project lead → C0 | C0 tasks 1.1–1.5 brief；`src/features/account/contracts/**` single ownership | Delivered；initial implementation wrote candidate artifacts | Does not imply 1.6/1.7 |
| H-002 | C0 → Type reviewer | 21-file canonical candidate surface and focused tests | Review completed: BLOCKED | Exact blockers must be fixed by C0 only |
| H-003 | C0 → Security reviewer | Same canonical candidate surface, privacy/secret boundary focus | Review completed: BLOCKED | Exact blockers must be fixed by C0 only |
| H-004 | reviewers → C0 | Consolidated A–F remediation brief | In progress | After C0 final evidence, both reviewers must independently re-review current digest |
| H-005 | C0 candidate → F0 | `AccountGatewayV1` and canonical manifest consumed by Mock shell | Provisional | F0 must rebase/revalidate against post-remediation C0 digest before 2.1 acceptance |
| H-006 | C0 candidate → D0 | semantic/transport/broker/authority shapes consumed as reference | Provisional | D0 must realign identity/receipt/epoch/generation/event ordering after C0 delta |
| H-007 | project lead → D0 | C0 BLOCKED delta；continue internal harness, do not check 2.2 | Confirmed in D0 thread | No cross-layer completion claim |
| H-008 | T0 evidence → project lead/future token2api owner | `research/token2api-t0-execution-plan.md` | Planning complete；T1 not ready | Requires token2api-local OpenSpec approvals, clean baseline, C0/G1 and explicit future dispatch |
| H-009 | project lead → token2api O-B0 PlanFirst author | `token2api:openspec/changes/sync-account-security-baseline/{.openspec.yaml,proposal.md,design.md,tasks.md,specs/account-security-baseline-sync/spec.md}` | Initial docs/spec artifacts created and strict-passed；both independent reviews subsequently BLOCKED；revision dispatched | This is not source work and does not satisfy GD-001 source-wave remediation；T1 remains not ready |
| H-010 | solution architecture → future token2api change authors | `token2api:openspec/changes/account-convenience-program-architecture.md` | Cross-change ADR created；status `dependency-review-only` | Does not approve O-SESSION/O-DESKTOP/O-KEY/O-CONTRACT、source/schema edits、commit/push/PR/deploy |
| H-011 | project lead → B0 Security reviewer `019fefef-42ec-7663-916b-9acb6bff72c8` | Read-only review of O-B0 scope、M1/M7 regression、dirty checkout、rollback/fail-closed and secret/production boundary | Initial verdict completed：`security-approval: blocked`，3 blockers | O-B0 task 1.4 remains open；writer must revise artifacts and obtain a new independent pass |
| H-012 | project lead → B0 Fork capability reviewer `019fefef-46fb-7d23-a065-6ce8a593dae1` | Read-only review of fork capability classes、upstream delta identity、clean isolation、lock/generated/migration/build/rollback protection | Initial verdict completed：`fork-capability-approval: blocked` | O-B0 task 1.4 remains open；writer must revise artifacts and obtain a new independent pass |
| H-013 | F0 `019fefee-1aba-7e53-9860-a709e9bbdf3a` → project lead | Interim F0 implementation handoff：15 owned leaf files；focused Vitest 22/22；target ESLint and diff check passed；runtime/static zero-call guards | Lane-local interim green；`fetch`、Tauri invoke、native open observed calls = 0；2.1 remains unchecked | Wait for C0 final digest and G1；then rerun final alignment/acceptance against that exact digest |
| H-014 | D0 `019fefee-ba42-77f1-904e-75e6e27f40c8` → project lead | Interim D0 implementation handoff：6 `src-tauri/src/account/**` files；`rustc -D warnings --test` 24/24；rustfmt/source/privacy/diff guards passed | Leaf-harness interim green；no shared registry、Cargo manifest or lock change；2.2 remains unchecked | Wait for C0 final digest and G1；main-crate/D7 integration is still unverified |
| H-015 | B0 Security reviewer → O-B0 writer/lead | Three blockers：standalone clone/ref isolation；insecure rollback target must be non-deployable with abort/forward-fix；real pinned scanner covering history/worktree/generated artifacts | BLOCKED；scope/M1/M7 boundaries otherwise accepted | Artifact revision and security re-review required；no source execution |
| H-016 | B0 Fork capability reviewer → O-B0 writer/lead | Blockers：`U_PREV/F_BASE/U_NEXT` delta model；expanded capability classes；generated/lock reproducibility；migration ledger；executable command matrix；candidate teardown vs deployed-schema rollback separation | BLOCKED；initial strict pass is insufficient | Artifact revision and fork-capability re-review required；no source execution |
| H-017 | project lead → original O-B0 spec writer `019fefee-13ba-74f1-961b-3dcc6c8003d7` | Bounded revision brief covering all Security/Fork capability blockers；ownership remains `token2api:openspec/changes/sync-account-security-baseline/**` only | Revision in progress；task 1.4 remains unchecked | Writer must strict-validate revised artifacts；both independent reviewers must pass afterward |

### 5.1 Prospective remediation evidence register

| Revision / wave | Kind | Pre-write governance evidence | Post-wave evidence | Counts toward task 0.3 remediation? |
|---|---|---|---|---|
| `GD-001-D1 / O-B0 PlanFirst` | Docs/spec only | Dispatched after ledger creation；exclusive token2api OpenSpec paths、no source/schema/deploy/commit boundary、Security and Fork capability reviewers identified | Five O-B0 artifacts exist；token2api strict OpenSpec passed；cross-change ADR exists；review verdicts pending | **No**。Not a source write wave |
| `B0-SOURCE-01 / pre-write` | Source write；token2api O-B0 local reviewable candidate | Recorded below before source writer starts；phase-exclusive writer、standalone clone path、inputs、dependencies、shared exclusions、reviewers、non-goals and acceptance language frozen | Pending；must append candidate actual diff plus original dirty checkout before/after integrity and ownership overlap audit | **Prospective candidate only**。May support `remediated, not retroactively compliant` after the completed wave audit；does not close 0.3 now |

### 5.2 Revision B0-SOURCE-01 / pre-write

> Record state：`pre-write recorded / source writer not yet accepted as complete`
>
> Governance purpose：首个可用于 `GD-001` prospective remediation 的 source write wave。该 revision 必须先于 writer 的任何 source write；post-wave audit缺失时无效。

| Field | Frozen dispatch contract |
|---|---|
| Goal / Gate | 执行 token2api O-B0 tasks 2–7，产出 **local reviewable candidate**：建立 standalone clone baseline，冻结 `U_PREV/F_BASE/U_NEXT`，执行 whole-release semantic upstream sync，保留 fork capabilities，证明 M1 OAuth takeover与M7 ACL presence regressions，并完成 O-B0 executable validation。No deployment。 |
| Writer | `backend-runtime-engineer` thread `019fefee-ba42-77f1-904e-75e6e27f40c8`；phase-exclusive token2api whole-tree single writer。Wave期间不得并行第二个 token2api source writer。 |
| Exclusive write path | 新 standalone clone `/Users/jason/GitHub/token2api-account-b0-candidate/**`。原 checkout `/Users/jason/GitHub/token2api/**` 严格 read-only，只允许 tasks 2.1/2.4 规定的 before/after integrity observation；不得写入其 files、index、refs或runtime state。 |
| Approved inputs | `token2api:openspec/changes/sync-account-security-baseline/**`，其 tasks 1.1–1.4均已完成；Security reviewer PASS；Fork capability reviewer PASS。Cross-change ADR可作 dependency input，但不扩大 source scope。 |
| Dependency boundary | Doge C0/G1 **不是** B0 sync/M1/M7 的前置；本 wave不得等待或消费未冻结的 Doge Authority DTO。B0完成也不解除doge G1或后续T1 source-train gates。 |
| Shared exclusions | 原 `/Users/jason/GitHub/token2api/**` dirty checkout与其中所有 user/agent changes；任何 doge source；任何并行 token2api source train；O-B0 allowlist外的 external working copy。 |
| Non-goals / unauthorized actions | 不复制、stash、reset、checkout、clean或提交当前 token2api dirty files；不实现 `O-SESSION`、`O-DESKTOP`、`O-KEY`、`O-CONTRACT` feature source；不执行 commit、push、PR、merge、deployment、production probe或migration execution；不修改 doge source。 |
| Read-only post-wave reviewers | Security reviewer thread `019fefef-42ec-7663-916b-9acb6bff72c8`；Fork/Build reviewer thread `019fefef-46fb-7d23-a065-6ce8a593dae1`；若 blocker涉及未覆盖的 cross-change correctness/spec drift，再派 `change-reviewer`，保持只读。 |
| Validation source of truth | Exact commands、required ledgers、scanner/version、generator/lock/migration/build checks与rollback evidence以 approved O-B0 tasks 2–7为准；任何 unavailable/skipped gate按该change的blocking/exception policy处理。 |
| Allowed completion language | 验证完成的 mutable/uncommitted candidate最多标记 `B0 reviewable tree` 或 `local reviewable candidate`。未获commit授权且未形成exact commit时，禁止称为 immutable `B0_SHA`；不得声称T1 ready、production-ready、merged或deployed。 |
| Required post-wave handoff | Candidate actual changed-path/symbol inventory与digest；`U_PREV/F_BASE/U_NEXT` exact tuple；capability/overlap ledger；M1/M7 regression summary；executable command matrix result；candidate teardown/deployed rollback distinction；原 dirty checkout HEAD/index/refs/status/untracked before/after evidence；source ownership overlap audit；reviewer blockers/unverified items。 |

#### Prospective remediation acceptance rule

`B0-SOURCE-01` pre-write record本身不关闭 task 0.3或0.4。只有本 source wave实际完成，并且 post-wave evidence证明：

1. actual diff全部位于 standalone candidate clone与 O-B0 approved scope；
2. 原 token2api dirty checkout before/after audit无未授权变化；
3. phase-exclusive ownership无第二 writer、shared exclusion无越界、actual diff overlap audit通过；
4. Security与Fork/Build post-wave review所需 evidence已完整交接；

届时 task 0.3 才可按既定 lead 决策考虑写为 **`remediated, not retroactively compliant`**。First batch依然永不 retroactively compliant；task 0.4作为continuous ledger在active change期间仍保持未勾。

## 6. Current review blockers

The two independent reviews overlap and are normalized into the following open remediation groups. These are not resolved until the respective reviewer re-runs against the post-fix candidate and issues a passing verdict.

| Group | Open blocker | Required evidence for closure | State / owner |
|---|---|---|---|
| A — IPC and identity | Read/mutation envelope discrimination；all mutations carry `GatewayIntentIdV1` with epoch/operation binding；strict per-operation request/result/event validation；ID kind separation | Good/Base/Bad negative tests for bogus payload、intent/request swap、extra keys、operation/value mismatch | Open；C0 writer, Type + Security re-review |
| B — Broker and ordering | Receipt operation discriminator and legal combination matrix；account epoch、process generation、event sequence、wakeup-only event behavior、stale settlement rejection | Illegal receipt and stale epoch/generation/eventSeq tests；terminal/reconcile evidence | Open；C0 writer, Type reviewer |
| C — Scenario parity | Exact 89 IDs + semantic revisions；each step contains executable request/result/event payload；Mock and IPC projections use same manifest | Exact-set assertion and parity runner across all scenarios, not count-only or metadata-only fixtures | Open；C0 writer, both reviewers |
| D — Secret/privacy/handles | TOTP only in purpose-specific one-time envelope；validated nominal `SafeText`/`SafeLabel`；expanded recursive corpus；purpose/epoch/generation/TTL-bound opaque handles | Cross-kind、callback/path/diff/server-text/token synonym、TOTP snapshot/diagnostic/support-bundle negative tests | Open；C0 writer, Security reviewer |
| E — Schema/persistence/diagnostics | Exact-key authority/recipe/persistence/diagnostic/support schemas；strict RFC3339 UTC and canonical decimal；actual record schemas；sanitized rebuild after decode | Wrong array member/extra field/date/decimal/persistence canaries rejected | Open；C0 writer, both reviewers |
| F — Test sufficiency | Existing green tests did not exercise the above fail-open triggers | Focused negative suite、typecheck、target lint and strict OpenSpec on final digest | Open；C0 writer, both reviewers |

Current gate verdict：**task 1.6 BLOCKED；task 1.7 MUST remain unchecked**。C0 is actively editing, so previous review line numbers and the initial digest are evidence of the reviewed candidate, not proof about the eventual fix.

### 6.1 Token2api O-B0 review blockers

O-B0 initial strict validation proved OpenSpec structure only；it did not prove execution safety or fork preservation. Both task 1.4 reviewers returned blocking verdicts.

| Review | Blocking finding | Required artifact correction | Current owner/state |
|---|---|---|---|
| Security S-1 | A linked worktree shares Git common-dir refs/objects；fetch cannot satisfy the promised dirty-checkout ref isolation | Require a standalone clone with a different `git-common-dir`；record original checkout HEAD、index tree、refs fingerprint、porcelain status and untracked paths before/after；handoff artifacts by approved commit/patch, never copy dirty files | Original O-B0 writer revising；security re-review pending |
| Security S-2 | No executable route kill switch exists for rollback targets lacking M1/M7 | Define such targets as **non-deployable**；allow abort/forward-fix only；do not imply B0 creates a new flag；separate DB compatibility/restore handling | Original O-B0 writer revising；security re-review pending |
| Security S-3 | Referenced secret-scan command points to a missing scanner | Specify a real version-pinned executable scanner covering candidate history、worktree and generated artifacts；missing/unavailable scan blocks B0 | Original O-B0 writer revising；security re-review pending |
| Fork F-1 | `fork-base..upstream-release` conflates upstream release delta with fork overlay | Freeze immutable `U_PREV`、`F_BASE`、`U_NEXT`；inventory rename/binary-aware `U_PREV..U_NEXT` and `U_PREV..F_BASE` separately；then reconcile overlap/capabilities | Original O-B0 writer revising；fork re-review pending |
| Fork F-2 | Capability classes omit fork application/governance/tooling/release/Terraform/legal/build input surfaces | Add canonical paths、preserve/reconcile decision、targeted gate and rollback effect for every class | Original O-B0 writer revising；fork re-review pending |
| Fork F-3 | Generated and lock assets lack reproducibility contract | Exclude dirty pnpm artifacts；pin pnpm；frozen install；Ent/Wire second-generation zero diff；separate Go/frontend/root OpenSpec lock checks；unchanged manifest implies unchanged lock | Original O-B0 writer revising；fork re-review pending |
| Fork F-4 | Migration evidence is not executable | Add filename/checksum/transaction mode/append-only ledger、fresh DB、upgrade、old-binary/new-schema compatibility；any existing migration byte change blocks B0 | Original O-B0 writer revising；fork re-review pending |
| Fork F-5 | Validation is descriptive and rollback modes are conflated | Freeze executable backend/frontend/generator/Docker/Terraform/scanner/migration/OpenSpec/fork-regression command matrix；unavailable gate blocks absent named exception；separate clean-candidate teardown from deployed-schema rollback | Original O-B0 writer revising；fork re-review pending |

Current O-B0 truth：task 1.4 is open；the original spec writer has been dispatched to revise proposal/design/tasks/spec；no reviewer pass, clean baseline execution, source edit or immutable `B0_SHA` exists.

## 7. Actual working-tree diff snapshot

Snapshot method：repo-relative file inventory + line count + SHA-256 manifest。All four lane artifacts were untracked at observation time, so plain `git diff` alone does not enumerate their content. Digests identify the point-in-time candidate without copying source or secrets.

| Slice | Actual paths | Files / lines | Snapshot digest | Status truth |
|---|---|---:|---|---|
| C0 | `src/features/account/contracts/{accountContracts.test,authority,broker,compatibility,fixtures,freezeResolutions,gateway,gateway.typecheck,index,laneProjection,persistence,privacy,recipe,roundTripFixtures,scenario,scenarioManifest,scenarioValidator,schema,semantic,semanticValidator,transport}.ts` | 21 / 4,793 | path `7a4b26e8…f66f`; content manifest `d032dfb4…896b` | Active remediation；digest will change |
| F0 | `src/features/account/{components,gateway,hooks,lab,locale,mock,testing}/**` excluding contracts | 10 / 2,127 | path `66c608f0…7132`; content manifest `9d663a0b…94b` | Lane-local implementation；2.1 open |
| D0 | `src-tauri/src/account/{broker.rs,mod.rs,model.rs,test_support.rs,tests.rs}` | 5 / 1,996 | path `fd9458e2…784f`; content manifest `f25b8017…ee0c` | Leaf harness only；2.2 open |
| T0 | `research/token2api-t0-execution-plan.md` | 1 / 380 | path `a3132c0c…4028`; content `5077cc33…ac23` | Planning complete；2.3 checked；T1 blocked |

Task truth at this snapshot：1.1–1.5 are checked from C0 initial self-validation；1.6/1.7 are open after independent blockers；2.1/2.2 are open；2.3 is checked；2.4 remains open. Checked 1.1–1.5 must not be interpreted as G1 acceptance.

### 7.1 Live drift observation — 2026-08-12 05:05:02 -0700

Active shared-workspace writers changed C0 and F0 after the initial snapshot, as expected. This update preserves the initial reviewed-candidate digest and adds a newer **in-progress** observation；it is not a review or gate verdict.

| Slice | New observation | Current thread state | Governance consequence |
|---|---|---|---|
| C0 | 23 files / 5,066 lines；path `a1df93f1…f1ec`；content manifest `c76db1dc…5452`；new leaves include `handleValidator.ts` and `safeValues.ts` | Active remediation；reported work on purpose/epoch/generation/TTL-bound handles and nominal safe values；IPC validator work still in progress | Prior Type/Security BLOCKED verdict remains the only reviewer verdict；the new digest has not passed either re-review |
| F0 | 14 files / 2,555 lines；path `eecb2b91…4a5d`；content manifest `6d700c04…b4d5`；new focused test leaves are present | Active adaptation to the changing C0 surface | 2.1 remains open；final evidence must name the accepted post-remediation C0 digest |
| D0 | 5 files / 1,996 lines；path `fd9458e2…784f`；content manifest unchanged at `f25b8017…ee0c` | Active lane-local validation；main-crate registration remains intentionally absent | 2.2 remains open；C0 delta alignment still required |
| Type/Security review | No new passing verdict observed | Both initial reviews remain BLOCKED；C0-triggered re-review not complete | 1.6/1.7 remain open |

Because C0 is in an intentionally non-atomic repair interval, temporary type/test failures must not be converted into a durable completion claim. The next authoritative digest belongs in this ledger only after C0 reports its final command evidence and stops writing for re-review.

### 7.2 Interim handoffs and active C0 observation — 2026-08-12 05:37:48 -0700

These are lane-local/interim observations. They do not supersede the requirement to align F0/D0 to the final C0 digest after G1, and they do not close tasks 2.1 or 2.2.

| Slice | Owned surface and snapshot | Validation evidence | Remaining gate |
|---|---|---|---|
| F0 | 15 files / 2,776 lines under `src/features/account/{components,gateway,hooks,lab,locale,mock,testing}/**`, excluding `contracts/**`；path `eecb2b91…4a5d`；content manifest `ad3f8e8a…a421` | Focused Vitest 22/22；target ESLint passed；diff check passed；runtime guard intercepted `fetch`、Tauri invoke and native open with observed real-call count 0；static boundary guard found no real call site | 2.1 remains unchecked；wait for C0 final digest/G1, then final conformance and acceptance |
| D0 | 6 files / 2,324 lines：`src-tauri/src/account/{broker.rs,event_buffer.rs,mod.rs,model.rs,test_support.rs,tests.rs}`；path `01661ad5…c801`；content manifest `aeafe556…81f2` | Standalone `rustc -D warnings --test` 24/24；rustfmt、source boundary、privacy and diff guards passed；no change observed in `src-tauri/src/{lib.rs,state.rs,command_registry.rs}` or `src-tauri/{Cargo.toml,Cargo.lock}` | 2.2 remains unchecked；wait for C0 final digest/G1；main-crate registration/D7 remains unverified |
| C0 | 29 files / 7,213 lines under `src/features/account/contracts/**`；path `39b34f19…4264`；content manifest `8677d012…bdbc` | Good/Base focused suite restored to 26/26 and typecheck restored after fixture/schema reconciliation | Still active：remaining exact schemas、89-scenario real payload parity and full negative suite are in progress；no final digest or reviewer re-review；1.6/1.7 remain open |

Interim outcome language：F0 and D0 may be described only as `lane-local interim green`；C0 may be described only as `partial remediation green / final suite in progress`。None of these states imply G1、G3、G4、M0 or A0.

## 8. Unverified and blocked items

- C0 Good/Base 26/26 and typecheck have recovered, but exact schema closure、89-scenario real payload parity、full negative suite、final digest and both re-review verdicts are not yet available.
- F0 interim evidence is 22/22 with zero real calls, but it has not demonstrated final conformance to the accepted post-remediation C0 digest.
- D0 is not registered in the main Rust crate by design; leaf harness evidence cannot be presented as D7/main-crate IPC integration.
- D0 interim evidence is 24/24 with shared registry/Cargo untouched, but its leaf harness is not main-crate/D7 integration and has not aligned to an accepted final C0 digest.
- No G4 Mock/Real/Broker/Authority normalized trace conformance has run.
- token2api O-B0 PlanFirst artifacts exist and initial strict validation passed, but both task 1.4 reviewers returned BLOCKED；the original spec writer is revising all findings, and both re-review passes remain outstanding.
- token2api T1 source readiness remains blocked：O-B0 PlanFirst/ADR creation is not an executed clean baseline or immutable `B0_SHA`，and doge G1、token2api source-train approvals/execution briefs remain outstanding. Exact deployed token2api SHA/version/guarantees remain unknown.
- No OS vault、SQLite account DB、system-browser callback、Real authority adapter、managed key、Codex plan/apply/recovery, M0 review or A0 package evidence exists here.
- Current platform evidence is insufficient for any all-platform statement; target remains the separately gated macOS ARM64 local trial.
- `GD-001` disposition is resolved as option 2 prospective remediation, but acceptance evidence is incomplete；no qualifying source write wave has yet satisfied both pre-write revision and post-wave overlap audit.

## 9. Continuous update protocol

Task 0.4 is continuous and must remain unchecked while implementation/review/release records are still arriving.

Before each new write wave, append or update a dispatch record containing:

```text
Revision / observedAt:
Goal and gate:
Writer thread + project role:
Exclusive paths:
Read-only reviewers:
Dependencies / accepted input digest:
Shared serialized zones excluded:
Non-goals:
Validation and completion language:
```

At each handoff, record:

```text
Record id:
From → To:
Actual paths and point-in-time digest:
Contract/schema versions consumed:
Commands and summarized result:
Resolved findings:
Open blockers / unverified:
Downstream action and owner:
```

Update rules：

1. Use repo-relative paths and sanitized summaries；do not paste full transcripts or logs.
2. Preserve prior blocked/failed observations；append resolution evidence instead of rewriting history.
3. Refresh the actual-diff snapshot before any gate decision because active shared-workspace writers can change files after observation.
4. Every reviewer pass must name the exact candidate digest reviewed；a pass on an older digest does not approve later edits.
5. Record Mock、backend lane、G4 conformance、Real integration、M0、package and A0 verdicts separately.
6. 0.4 may be checked only when the change reaches its authorized closure point and every handoff/verdict/unverified item has an owner or explicit deferred change.

## 10. Next required governance actions

1. Original O-B0 spec writer completes the bounded artifact revision and strict validation；Security and Fork capability reviewers then independently re-review；task 1.4 remains open until both pass.
2. Before the next source write wave, `doge-project-lead` appends the qualifying prospective ledger revision；docs/spec-only O-B0 work cannot substitute for it.
3. After that source wave, quality/governance records the actual-diff overlap audit；only then may 0.3 be considered for `remediated, not retroactively compliant` closure.
4. C0 completes A–F fixes and produces a new sanitized inventory/digest plus exact validation summary.
5. Type and Security reviewers independently re-review that same digest；neither writer nor governance owner may substitute for their verdict.
6. F0 and D0 receive the accepted C0 delta, record their consumed digest, and rerun lane validation before 2.1/2.2 acceptance.
7. Quality owner performs task 2.4 first-wave boundary/conformance audit after 2.1/2.2/2.3 evidence exists.
8. Documentation owner updates this ledger before considering task 1.7；strict OpenSpec alone is necessary but not sufficient for G1.
