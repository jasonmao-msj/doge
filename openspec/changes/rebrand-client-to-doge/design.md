## Context

### Fork 与分发现状

- GitHub Fork：`jasonmao-msj/doge`。
- Developer remotes：`origin` 指向 doge；`upstream` fetch 指向 `zhukunpenglinyutong/desktop-cc-gui`，push 已禁用。
- Fork baseline：`ccgui@0.8.7`，Tauri `productName=ccgui`，identifier `com.zhukunpenglinyutong.ccgui`。
- 当前 updater endpoint/public key、release artifact URL、About/Issue URL、web-assets URL、Baidu Tongji site id 与部分 managed provider preset 仍属于上游。
- 当前数据根是 `~/.ccgui`，并已包含 `.mossx` / `.codemoss` legacy migration。
- 当前 WebView 发布 10 套 locale bundle；品牌词分散在 UI、native menu、tests、storage keys、protocol markers 和 documentation。

### 产品叙事

Canonical story：

> doge 的故事，从一只总爱坐在你桌边的小柴犬开始。它不是高高在上的万能 AI，也不是只会等待命令的工具；它会记得你的习惯，把散落在文件、终端、任务和灵感里的事情一件件叼回来。工作时，它陪你拆解目标、编写代码、查找资料、推进任务；生活里，它将逐步学会整理计划、保存想法、照看琐事。我们把它叫作 doge——一只住在电脑里的拟人化 AI 小柴犬，也是你可以信任的生活与工作搭档。

首发产品定位必须同时说明：当前交付能力首先聚焦 developer workflow，不声称尚未实现的生活服务。

Canonical tagline：`把复杂的事，叼回来做好。`

### Baseline evidence（2026-08-10，改动前）

| Gate | 结果 | 已知上游事实 |
| --- | --- | --- |
| `node scripts/doctor.mjs --strict` | PASS | 本机依赖 OK |
| `npm run doctor:strict` | FAIL | AppShell runtime contract 缺 `groupId`、`orderedWorkspaceIds` |
| `npm run check:branding` | FAIL | shipping source 仍含大量 `mossx` |
| `npm run typecheck` | PASS | 无 TypeScript error |
| `npm run lint` | FAIL | 2 errors + 16 warnings |
| `npm run test` | FAIL | batch 38/268 的 UI visibility/documentation 2 tests failed |
| `cargo test --manifest-path src-tauri/Cargo.toml` | FAIL | 2 个 `include_str!` 指向已不存在的 active OpenSpec fixtures；Rust dependencies/build 成功 |
| `npm run tauri:dev:hot` | PASS | Vite :1420 ready，`target/debug/cc-gui` 实际启动 |

这些 failure 在任何 doge implementation 前已存在。实现必须以独立 preflight commit 修复 release-blocking baseline，或在 verification 中提供明确 owner/waiver；正式发布不接受 waiver。

### Baseline repair evidence（2026-08-10，品牌实现前）

| Gate | 结果 | 说明 |
| --- | --- | --- |
| `npm run check:runtime-contracts` | PASS（exit 0） | AppShell 与 Git History contracts 全绿 |
| `npm run lint` | PASS（exit 0） | 0 errors；保留 16 个既有 warnings |
| `npm run typecheck` | PASS（exit 0） | 无 TypeScript error |
| partitioned `vitest run` | PASS（exit 0） | `src` 下 1,074 个 test files 全部覆盖；失败批次 focused 回归后通过 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | PASS（exit 0） | 1,123 个 lib tests 与 integration suites 通过 |

除最初列出的 release blockers 外，全量审计还发现并修复了消息附件保真、OpenCode timeout sentinel、Windows CSS zoom 残留、Shared canonical evidence 等上游基线缺陷；这些修复与 doge identity 改动保持在独立 baseline commit。

### 约束

- MIT copyright 与 license 必须保留。
- Immutable archive/history 不做伪造性批量改名。
- Legacy data/protocol 必须可读；新写入必须使用 doge identity。
- Tauri updater 必须验证签名；private key 不得提交。
- 不新增云服务器；静态 release feed 由 GitHub Releases 提供。
- 后续 upstream merge 是长期工作流，shipping brand/service regression 必须机器拦截。

## Goals / Non-Goals

### Goals

1. 建立单一可审计的 doge identity source，并校准 frontend、Rust、Tauri、CI、docs 与 assets。
2. 切断所有上游-owned runtime service，尤其 updater、analytics、web assets 与 managed preset。
3. 安全迁移 app-home、app-data、localStorage/client-store 与 serialized markers。
4. 使用 doge GitHub Releases 完成下载和自动更新。
5. 保持 upstream 可同步，且 merge 后旧品牌不能静默回流。
6. 以分阶段、可回滚提交实施，避免一个全仓库 replacement commit。

### Non-Goals

- 云账号、云同步、subscription、remote execution。
- 新 telemetry。
- 改写第三方 engine/provider 商标。
- 修复所有历史 warning 或重构未触碰模块。
- 让上游安装包跨 signing key 原地升级为 doge。
- 将最终 mascot illustration 细节固化在架构文档；视觉稿需单独 review。

## Decisions

### D1. Canonical brand manifest + static manifest verification

新增 tracked `config/brand.json` 作为非秘密 canonical identity：

| Field | Canonical value |
| --- | --- |
| `productName` | `doge` |
| `displayName` | `doge` |
| `repository` | `jasonmao-msj/doge` |
| `bundleIdentifier` | `io.github.jasonmao-msj.doge` |
| `devBundleIdentifier` | `io.github.jasonmao-msj.doge.dev` |
| `appHomeDirectory` | `.doge` |
| `updateEndpoint` | `https://github.com/jasonmao-msj/doge/releases/latest/download/latest.json` |
| `issueEndpoint` | `https://github.com/jasonmao-msj/doge/issues/new` |

Frontend 可直接 import JSON（项目已启用 `resolveJsonModule`）；Rust/Tauri/npm/Cargo/release workflow 保持静态值，由 `scripts/check-branding.mjs` 解析并校验等值，避免在 build 时动态改写 manifests。

Alternatives：

- 仅 TypeScript constants：无法覆盖 Rust/Tauri/CI。
- build-time generator：会制造 dirty worktree、让 updater/release config 难审阅。
- 采用 manifest + checker：兼顾跨层与静态可审查性，采用。

### D2. Product identity matrix

| Surface | doge identity | Compatibility |
| --- | --- | --- |
| npm package | `doge` | package-lock 同步 |
| Rust package/default bin | `doge` | old binary name 不继续 shipping |
| Rust lib | `doge_lib` | source imports 原子更新 |
| daemon | `doge_daemon` | old daemon filename 可在 discovery reader 暂时识别 |
| Tauri product | `doge` / `doge-dev` | old app 独立存在 |
| Bundle ID | `io.github.jasonmao-msj.doge` | old app-data 仅作为 migration source |
| App home | `~/.doge` | `.ccgui` → `.mossx` → `.codemoss` priority reader |
| Internal marker/media type | `doge.*` / `vnd.doge.*` | dual-read legacy；new-write doge |

Binary rename 与 storage rename 分开提交；每阶段先加 tests 再改实现。

### D3. Legacy copy-forward，不 move/delete

Migration algorithm：

1. Resolve doge destination。
2. 若 doge destination 已存在有效 data，则直接使用，不 merge/overwrite。
3. 按明确 priority 查找 legacy candidate：当前 `.ccgui` / ccgui bundle app-data 优先，其后 `.mossx`、`.codemoss` 与历史 bundle ids。
4. 只 copy regular files/directories，沿用现有 symlink resolution/atomic storage guard。
5. 写 `.migration.json`：只记录 source kind、schema version、timestamp；不记录 API key、完整用户路径内容或文件 payload。
6. legacy source 保留；重复启动不再次覆盖。

`localStorage` / client-store 使用 per-key copy-once：doge key 已存在时不覆盖，legacy key 不删除。Serialized protocol marker 使用 dual-read/new-write，直到另一个明确 removal change 证明旧数据已无消费者。

Alternative “直接 rename/move” 会破坏旧 App 与回滚，否决。

### D4. Upstream service deny-by-default

Shipping source 将以下值纳入 negative gate：

- `zhukunpenglinyutong/desktop-cc-gui`（developer/legal allowlist 外）
- `com.zhukunpenglinyutong.*`（migration allowlist 外）
- Baidu site id 与 `hm.baidu.com`
- `fufei.mossx.ai`
- 上游 updater public key
- legacy product names（compatibility/legal/history allowlist 外）

Baidu implementation（renderer injection、Linux native bridge、Rust command、CSP permission）直接从 doge shipping runtime 移除，不保留 disabled-but-callable proxy。未来 telemetry 必须新开 opt-in change。

Managed provider preset 若依赖上游-owned endpoint 则删除；generic user-supplied provider URL 能力保留。

### D5. GitHub Releases，无 application server

Release flow：

```text
tag vX.Y.Z
  → GitHub Actions matrix build
  → doge artifacts + Tauri signatures
  → GitHub Release
  → latest.json
  → installed doge checks HTTPS feed
  → signature verify
  → download/install
```

安全边界：

- 生成 doge 独立 updater keypair。
- public key 进入 Tauri config；private key 仅进入 GitHub Actions Secret 与离线备份。
- workflow 日志不得打印 private key/password。
- key 尚未配置时 release job fail closed，不生成 unsigned update metadata。
- `latest.json` URL、platform targets、signature paths 用 focused tests 校验。

GitHub outage 时 updater 走已有 background non-blocking contract；核心本地 App 不依赖 doge server。

### D6. User-visible 与 source-visible 的边界

普通产品 surface 包括 WebView/native UI、About、错误反馈、安装包、release notes、README/current product docs。这里必须 doge-only。

允许出现上游的 surface：

1. `LICENSE` 与必要 OSS legal notice；
2. immutable `CHANGELOG` / archived OpenSpec / dated historical evidence；
3. migration/compatibility reader 与对应 tests/fixtures；
4. developer-only Git remote/sync helper；
5. third-party schema field，若删除会破坏外部 compatibility。

每条 code allowlist 必须带 category/reason；禁止用整目录 allowlist 掩盖 shipping code。

### D7. Upstream sync workflow

- `main` 是 doge release truth。
- 每次同步创建 `sync/upstream-YYYYMMDD` branch。
- `git fetch upstream main` 后做 semantic merge；品牌/identity/release/storage 高风险文件禁止整文件 `--ours/--theirs`。
- merge 后先跑 brand/service negative gate，再跑 migration/update focused tests 与全 gates。
- remote URL 存于 local `.git/config`；可选 developer helper 只用于 fetch/compare，不进入 App runtime。

采用 merge 而非长期 rebase，以保留公开 Fork 的同步节点和 doge release history。

### D8. Visual identity

- Official wordmark 使用 lowercase `doge`。
- Mascot 是拟人化小柴犬；避免 coin、币价、火箭等 cryptocurrency 视觉，降低与 Dogecoin 的产品混淆。
- 初始 palette：Shiba amber / warm cream / charcoal；最终色值在 asset review 固化。
- 先生成 1024×1024 master raster 与简化 small-size mark，再派生 Tauri/macOS/Windows/Linux icon matrix。
- 16/32px 必须目视检查轮廓；不能只缩放复杂插画。
- README banner 在 doge UI 落地后重新截图，不复用旧品牌 screenshot。

### D9. Baseline failures 处理

在品牌实现前建立 isolated `chore(baseline)` commit，最小修复：

1. AppShell contract key 漂移；
2. 两个 ESLint errors；
3. 两个 client UI visibility/documentation tests；
4. Rust integration test 的 archived fixture canonical path；
5. 现有 branding gate 的 stale allowlist（该项随 doge gate 重写）。

不借此清零全部 warnings；目标是让 release-blocking commands 能归因。修复前后都记录 exact command/exit。

## Migration Plan

### Phase 0 — Baseline and branch

1. 从 doge `main` 创建 `chore/rebrand-client-to-doge`。
2. 保存本 design 的 baseline evidence。
3. 用独立 commit 闭合 release-blocking upstream failures。

### Phase 1 — Fail closed external isolation

1. 先把 updater endpoint/public key 切离上游；doge key 未就绪前禁用发布更新。
2. 删除 Baidu runtime/CSP/native commands。
3. 删除上游 web-assets/Issue/About/managed preset endpoints。
4. 增加 negative gate，确保此后提交不能重新引入。

### Phase 2 — Identity and migration

1. 引入 `config/brand.json` 与 checker。
2. 改 Tauri/npm/Cargo/binaries/artifacts。
3. 先加 migration tests，再切 `~/.doge` / bundle app-data / local keys。
4. dual-read/new-write protocol compatibility。

### Phase 3 — UI, locale and visuals

1. source locale doge copy。
2. 同步全部 published locales 与 parity check。
3. 替换 native menu/About/lock/home/settings/errors。
4. 生成并 review icon matrix/DMG/banner。

### Phase 4 — Docs and release

1. 重写 README/current docs；保留 legal/history。
2. 配置 doge updater public key、GitHub Secrets、workflow/artifacts。
3. dry-run release validation；不发布无签名 artifact。

### Phase 5 — Verification

1. focused brand/service/migration/update tests。
2. full frontend/Rust gates。
3. `tauri:dev` manual smoke + macOS ARM64 bundle install/update smoke。
4. Windows/Linux CI artifact inspection；实机 smoke 未完成则不得标记跨平台 release ready。

### Rollback

- External service isolation 不允许回滚到上游 endpoints。
- Identity/visual commit 可逐层 revert，但 updater public/private key 必须成对保持。
- Migration 永不删除 legacy/doge data；回滚只改变下次选择，不清理用户目录。
- 若 release artifact 失败，撤回 GitHub Release/latest.json，不复用已泄露或错误的 signing key。

## Risks / Trade-offs

- [大范围 rename 产生 merge conflict] → 按 external isolation / identity / storage / i18n / assets 分 commit，使用 semantic merge。
- [legacy marker 双读长期存在] → allowlist 带 removal condition，后续 telemetry 检测不作为删除依据，需明确 migration version。
- [GitHub Releases 在部分地区慢] → 初期接受；下载量/地域数据证明需要后再引入 object storage/CDN。
- [自编译 OpenSSL 仅是开发机状态] → 不写入 repo；CI 继续使用平台 workflow 依赖，README 补齐真实 prerequisites。
- [Doge 名称与 crypto 语义混淆] → 视觉/文案强调 AI Shiba assistant，避免金融符号；正式商业化前另做 trademark/domain review。
- [全量 gates 原本为红] → Phase 0 隔离修复与 evidence，禁止用“上游本来就红”豁免正式 release。

## Open Questions

1. 最终 mascot master asset 与 palette 是否采用 D8 初始方向，需视觉 review 后定稿。
2. 首个 public version 使用 `0.1.0` 重新起步，还是沿用上游 `0.8.x` lineage；本 design 推荐 doge `0.1.0`，Git history 仍保留 lineage。
3. Apple Developer ID / notarization 与 Windows code-sign certificate 何时配置；不影响 dev/proposal，但影响公开安装体验。
4. GitHub repo 是否保持 public Fork；若保持，GitHub repository page 会显示 fork relation，这不属于 App 用户产品 surface。
