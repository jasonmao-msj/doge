## 0. Fork 与开发环境基线

- [x] 0.1 [P0][depends:none][I:GitHub 登录账号与空 workspace][O:`jasonmao-msj/doge` Fork；`origin`/只读 `upstream`；repo-local Git identity][V:`git remote -v`、`git config --local --get-regexp '^(user|pull)\\.'`、`git status --short --branch`] 创建 Fork 并配置安全 Git topology。
- [x] 0.2 [P0][depends:0.1][I:macOS arm64 + upstream prerequisites][O:Rust/Cargo 1.97.1、CMake 4.4.2、OpenSSL 3.5.7、npm lock dependencies、持久 PATH][V:`rustc --version`、`cargo --version`、`cmake --version`、`openssl version`、`npm ls --depth=0`] 完成本机开发依赖。
- [x] 0.3 [P0][depends:0.2][I:未修改的 upstream commit][O:doctor/lint/typecheck/Vitest/Rust/Tauri baseline evidence][V:`node scripts/doctor.mjs --strict` PASS；`npm run tauri:dev:hot` 启动到 `target/debug/cc-gui`；其余已知失败记录于 `design.md`] 记录原版基线并完成一次实际启动。

## 1. Baseline release gate 隔离修复

- [x] 1.1 [P0][depends:0.3][I:doge `main` 与本 change artifacts][O:`chore/rebrand-client-to-doge` implementation branch][V:`git branch --show-current` 与 clean pre-change diff] 创建实施分支，禁止直接在 `main` 堆叠改动。
- [x] 1.2 [P0][depends:1.1][I:AppShell runtime contract failure][O:最小 key-contract 校准，单独 baseline commit][V:`npm run check:app-shell:runtime-contract`] 修复 `groupId` / `orderedWorkspaceIds` baseline 漂移。
- [x] 1.3 [P0][depends:1.1][I:ESLint 两个 error][O:仅修 `no-extra-boolean-cast` 与 `prefer-const` 的 baseline commit][V:`npm run lint` 无 error] 闭合已知 lint blocker，不顺手清理全部 warning。
- [x] 1.4 [P0][depends:1.1][I:两个 client UI visibility/documentation failing tests][O:source/test contract 对齐的 baseline commit][V:focused Vitest 通过且 `npm run test` 能越过 batch 38] 修复 frontend baseline tests。
- [x] 1.5 [P0][depends:1.1][I:Rust `include_str!` 缺失 active-change fixtures][O:指向 canonical archived fixture 或 stable test fixture 的 baseline commit][V:`cargo test --manifest-path src-tauri/Cargo.toml --test assemble_canonical_facts`] 修复 Rust fixture path。
- [x] 1.6 [P0][depends:1.2,1.3,1.4,1.5][I:baseline repair commits][O:可归因的 pre-brand gate report][V:`npm run check:runtime-contracts`、`npm run lint`、`npm run typecheck`、`npm run test`、`cargo test --manifest-path src-tauri/Cargo.toml`] 复跑全基线并记录 exact exit。

## 2. 上游服务先行隔离

- [x] 2.1 [P0][depends:1.6][I:当前 Tauri/release/About/web-assets/provider configs][O:针对 upstream repository、bundle id、Baidu site id、`hm.baidu.com`、`fufei.mossx.ai` 的 failing negative tests][V:新 focused tests 在实现前红且能报告具体 source] 先写 upstream-service isolation tests。
- [x] 2.2 [P0][depends:2.1][I:上游 updater endpoint/public key][O:doge endpoint placeholder + updater fail-closed 状态；不再信任上游 key][V:update config focused test 无上游 endpoint/key] 切断上游自动更新信任链。
- [x] 2.3 [P0][depends:2.1][I:`src/services/baiduTongji*` 与 production bootstrap][O:移除 renderer analytics injection 和 frontend wrapper][V:focused tests 证明 production/dev/secondary window 均不注入 Baidu script/beacon] 移除 frontend Baidu analytics。
- [x] 2.4 [P0][depends:2.3][I:Rust Baidu state/commands、command registry、CSP][O:删除 native proxy、cookie state、site id 与 `hm.baidu.com` CSP permissions][V:`rg` negative scan + Rust compile + command registry test] 移除 backend/Linux Baidu transport。
- [x] 2.5 [P0][depends:2.1][I:上游 managed provider preset 与 generic custom-provider path][O:删除 `fufei.mossx.ai` doge defaults，保留用户自定义 URL 能力][V:provider focused tests 覆盖“无默认上游 + custom URL 可用”] 隔离上游 provider service。
- [x] 2.6 [P0][depends:2.1][I:About/Settings/ErrorBoundary/web-assets/release URLs][O:全部 doge-owned URL 或明确 local-only fallback][V:URL inventory test 与 runtime link click unit tests] 替换上游 Issue、About、下载与 web-assets 入口。
- [x] 2.7 [P0][depends:2.2,2.4,2.5,2.6][I:service-isolation implementation][O:shipping source 无上游运行时依赖][V:2.1 negative suite 全绿；network endpoint inventory 人工复核] 完成第一阶段 fail-closed 验收。

## 3. Canonical doge identity 与构建元数据

- [x] 3.1 [P0][depends:2.7][I:`design.md#D1` identity matrix][O:`config/brand.json` 非秘密 canonical manifest + schema/type][V:JSON parse + required field unit test] 建立 doge brand source of truth。
- [x] 3.2 [P0][depends:3.1][I:canonical manifest 与现有 `check-branding.mjs`][O:manifest equality、legacy brand、upstream service、narrow allowlist checker][V:checker fixtures 覆盖 pass/fail/allowlist reason] 重写品牌门禁。
- [x] 3.3 [P0][depends:3.1][I:frontend product constants/links][O:runtime import canonical doge manifest，无散落旧 product constants][V:frontend brand config unit test + typecheck] 接入 frontend canonical identity。
- [x] 3.4 [P0][depends:3.1][I:Tauri prod/dev configs][O:`productName=doge`、`doge-dev`、`io.github.jasonmao-msj.doge[.dev]`][V:JSON config tests + `tauri info`] 修改 Tauri product/bundle identity。
- [x] 3.5 [P0][depends:3.1][I:npm/Cargo metadata 与 Rust imports][O:npm package `doge`、Rust package/default-run `doge`、lib `doge_lib`][V:`npm install --package-lock-only --ignore-scripts` 后 lock diff + `cargo check --manifest-path src-tauri/Cargo.toml`] 修改 package/crate identity。
- [x] 3.6 [P0][depends:3.5][I:daemon/binary discovery、build scripts、artifact paths][O:`doge` / `doge_daemon` 新写与 old daemon compatibility read][V:build-script tests、daemon discovery tests、无 dangling `cc_gui_daemon` shipping write] 修改二进制与 daemon identity。
- [x] 3.7 [P0][depends:3.2,3.3,3.4,3.5,3.6][I:全 identity change][O:跨层 manifest 全部与 canonical doge 对齐][V:`npm run check:branding` + Cargo/npm/Tauri focused tests] 完成 identity matrix gate。

## 4. Storage、local keys 与 serialized compatibility

- [x] 4.1 [P0][depends:3.7][I:现有 `app_paths.rs` migration helpers][O:fresh/ccgui/mossx/codemoss/multiple-source/destination-wins/idempotent Rust tests][V:focused Rust tests 在实现前覆盖全部 matrix] 先写 filesystem migration tests。
- [x] 4.2 [P0][depends:4.1][I:`~/.ccgui` current root 与 legacy candidates][O:`~/.doge` current root + `.ccgui` 优先 copy-forward + versioned sentinel][V:4.1 focused Rust tests 全绿] 实现 app-home migration。
- [x] 4.3 [P0][depends:4.1][I:Tauri doge/legacy bundle app-data candidates][O:doge app-data destination-wins copy-forward][V:valid/empty/corrupt/multiple candidate Rust tests] 实现 bundle app-data migration。
- [x] 4.4 [P0][depends:3.7][I:`migrateLocalStorage.ts` 与 client-store keys][O:doge-key destination-wins test matrix][V:focused Vitest 在实现前覆盖 only-legacy/both/repeat] 先写 WebView/client-store migration tests。
- [x] 4.5 [P0][depends:4.4][I:legacy `ccgui.*` / `mossx.*` keys][O:doge new-write keys + copy-once compatibility reader][V:4.4 focused Vitest + reload idempotence] 实现 localStorage/client-store migration。
- [x] 4.6 [P1][depends:3.7][I:历史 markers、MIME types、context tags、daemon names][O:逐项 dual-read/new-write compatibility inventory 与 tests][V:legacy fixture read + doge fixture roundtrip] 先固定 serialized compatibility contract。
- [x] 4.7 [P1][depends:4.6][I:protocol/media/context producers and readers][O:新记录写 doge namespace、旧记录继续可读][V:frontend/Rust roundtrip focused tests + user-visible marker negative scan] 实现 serialized marker migration。
- [x] 4.8 [P0][depends:4.2,4.3,4.5,4.7][I:migration logs/sentinels/errors][O:bounded non-secret diagnostics][V:fixture 含 fake API key/token 时输出断言不包含 secret] 加固 migration privacy。

## 5. UI、native chrome 与 10 套 locale

- [x] 5.1 [P0][depends:3.7][I:shipping source brand inventory + `src/i18n/index.ts`][O:按 namespace/surface 分类的 doge replacement matrix][V:matrix 覆盖每个旧品牌 shipping occurrence，compat/legal 已分类] 建立可见品牌触点清单。
- [x] 5.2 [P0][depends:5.1][I:App/Home/About/Lock/Error/Update source locale copy][O:doge 品牌故事、tagline、developer-first 能力描述与 doge links][V:组件 focused tests + 文案人工 review] 替换核心 UI copy。
- [x] 5.3 [P0][depends:4.5,5.1][I:Settings/Workspace/Memory/Canvas/ProjectMap storage/path copy][O:`~/.doge` 与 doge product wording][V:path-copy focused tests + legacy only in migration message] 替换设置与路径提示。
- [x] 5.4 [P0][depends:5.2,5.3][I:source locale key set与其余 locale modules][O:所有 registered locales 的 doge brand copy][V:locale namespace/key/placeholder parity script] 同步 10 套已发布 locale。
- [x] 5.5 [P0][depends:5.4][I:native `menu.rs`、Info.plist、window labels][O:doge native menu/title/permission descriptions][V:Rust menu tests + macOS dev manual smoke] 替换 native chrome 文案。
- [x] 5.6 [P0][depends:5.2,5.3,5.4,5.5][I:完整 UI/i18n change][O:普通用户 surface doge-only][V:`npm run check:branding`、i18n parity、App 页面遍历截图 checklist] 验收用户可见品牌。

## 6. Mascot、平台图标与产品截图

- [x] 6.1 [P1][depends:5.2][I:品牌故事、lowercase doge、非 crypto 视觉约束][O:3 个小柴犬 mascot/icon concept 与色板][V:1024px、128px、32px concept sheet 人工 review] 生成品牌视觉方向。
- [x] 6.2 [P1][depends:6.1][I:获选 concept 与 review feedback][O:透明背景 master raster、简化 small-size mark、canonical color tokens][V:边缘/透明度/contrast/16-32px 人工检查] 定稿 doge master assets。
- [x] 6.3 [P0][depends:6.2][I:master assets + Tauri icon inventory][O:macOS `.icns`、Windows `.ico`/Square logos、Linux/PNG、mobile residual icon matrix][V:Tauri icon generation/存在性检查 + `file` dimensions audit] 派生全部平台图标。
- [x] 6.4 [P1][depends:6.2][I:doge visual tokens 与 installer layouts][O:doge DMG backgrounds、root/public app icon][V:rendered DMG composition 和 alpha/safe-area 人工检查] 替换安装包视觉。
- [ ] 6.5 [P1][depends:5.6,6.3][I:doge UI running build][O:README doge banner/screenshots 与 alt text][V:README render + screenshot 不含 legacy brand] 重新采集产品视觉。

## 7. GitHub Releases 与安全自动更新

- [ ] 7.1 [P0][depends:2.2][I:Tauri updater key tool 与安全本机环境][O:doge keypair；private key 离线备份 + GitHub Actions Secrets；public key 可提交][V:secret list 显示名称但不回显值；repo scan 无 private key] 建立 doge updater trust chain。
- [ ] 7.2 [P0][depends:3.4,7.1][I:doge public key + release endpoint][O:Tauri updater config 只信任 doge feed/key][V:update config focused test + invalid signature rejection test] 启用 doge updater。
- [ ] 7.3 [P0][depends:3.6,7.2][I:现有 release workflow/build scripts][O:doge-named macOS/Windows/Linux artifacts 与 signatures][V:workflow static tests + local artifact-name dry run] 修改 release matrix。
- [ ] 7.4 [P0][depends:7.3][I:artifact matrix 与 tag version][O:parseable doge `latest.json` URLs/signatures/platform entries][V:fixture generator test + URL 文件名一致性检查] 修改 update metadata。
- [ ] 7.5 [P0][depends:7.1,7.3,7.4][I:缺失/错误 signing secrets cases][O:release job fail-closed guards][V:workflow test 证明无 secret 时不发布 `latest.json`] 加固 release secret 边界。
- [ ] 7.6 [P1][depends:7.3,7.4,7.5][I:non-production tag/workflow dispatch][O:GitHub Release dry-run evidence 或 draft release][V:每个 artifact URL 可下载、signature/metadata 匹配、无上游 URL] 验证 GitHub-only distribution。
- [ ] 7.7 [P0][depends:7.6][I:两个连续 doge test versions][O:已安装旧版发现、下载、验签并更新到新版的 macOS smoke evidence][V:版本号变化 + invalid-signature negative case] 完成自动更新端到端验收。

## 8. README、current docs 与 upstream governance

- [ ] 8.1 [P0][depends:5.6,6.5,7.6][I:canonical brand story/current code/release facts][O:doge 中文 README][V:links/commands/version/features 对当前事实 + `npm run check:docs`] 重写中文产品文档。
- [ ] 8.2 [P0][depends:8.1][I:中文 canonical narrative 与 English terminology][O:doge English README key parity][V:section/link/command parity review + docs check] 重写英文产品文档。
- [ ] 8.3 [P1][depends:3.7,4.8,5.6][I:current docs/AGENTS/OpenSpec living context][O:doge current identity、storage、distribution、workflow facts][V:current-doc scan 无 stale version/brand；历史内容未批量改写] 校准 living documentation。
- [ ] 8.4 [P0][depends:3.2,8.3][I:LICENSE、CHANGELOG、archive、migration/protocol readers][O:legal/history/compatibility narrow allowlist，含 reason/removal condition][V:allowlist unit tests + 人工逐项审计] 保留真实归属并封闭例外。
- [x] 8.5 [P1][depends:8.3][I:只读 upstream Git topology][O:developer-only semantic sync guide/helper；不进入 App links][V:本地 fetch/compare rehearsal + runtime bundle scan 无 remote config] 固化后续上游同步流程。
- [ ] 8.6 [P0][depends:8.1,8.2,8.3,8.4,8.5][I:all current docs][O:可达、无 broken links、doge current truth][V:`npm run check:docs` + documentation-governance focused scan] 完成文档 gate。

## 9. 全量验证、打包与 OpenSpec 收口

- [x] 9.1 [P0][depends:4.8,5.6,7.5,8.6][I:brand/service/migration/update focused suites][O:所有 change-local automated contracts 通过][V:逐条记录 command、test count、exit code] 运行 focused verification。
- [x] 9.2 [P0][depends:9.1][I:shipping source/config/artifacts/current docs][O:legacy brand/upstream service 仅剩 reasoned allowlist][V:`npm run check:branding` + raw `rg` audit + allowlist diff] 运行最终品牌/服务审计。
- [x] 9.3 [P0][depends:9.1][I:frontend implementation][O:前端质量门禁全绿][V:`npm run lint && npm run typecheck && npm run test`] 运行 frontend full gates。
- [x] 9.4 [P0][depends:9.1][I:Rust/backend implementation][O:backend test suite 全绿][V:`cargo test --manifest-path src-tauri/Cargo.toml`] 运行 Rust full gate。
- [x] 9.5 [P0][depends:9.2,9.3,9.4][I:macOS arm64 dev environment][O:doge Tauri 实际启动与核心 surface smoke evidence][V:`npm run tauri:dev` + title/menu/home/settings/About/update manual checklist] 完成 macOS dev smoke。
- [ ] 9.6 [P0][depends:9.5][I:doge release config/assets/signing environment][O:macOS ARM64 doge bundle][V:`npm run build:mac-arm64` + bundle identifier/icons/dylib/signature inspection] 完成 macOS ARM64 构建。
- [ ] 9.7 [P1][depends:7.6,9.3,9.4][I:GitHub Actions matrix][O:Windows/Linux artifacts 与 static inspection evidence][V:workflow jobs green；artifact names/config/signatures/launch logs] 验证跨平台 CI。
- [x] 9.8 [P0][depends:9.1][I:change artifacts][O:strict-valid proposal/design/specs/tasks][V:`openspec validate rebrand-client-to-doge --strict --no-interactive`] 验证 OpenSpec change。
- [ ] 9.9 [P0][depends:9.2,9.3,9.4,9.5,9.6,9.7,9.8][I:all automated/manual evidence][O:`verification.md`，按平台标注已证实/未验证且无伪造结论][V:evidence links/commands/commits 可复核，unchecked manual task 保留] 汇总 release readiness。
- [ ] 9.10 [P1][depends:9.9][I:verified change 与 main specs][O:spec sync、indexes 更新、archive-ready state][V:`openspec validate --all --strict --no-interactive` + consistency validator] 按 OpenSpec lifecycle 收口；未完成实机 gate 时不归档。
