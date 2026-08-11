## Why

当前 Fork 仍把 `ccgui` / `mossx` 作为产品身份，并在 updater、Baidu Tongji、Issue/About、release assets 与部分 provider preset 中继续连接上游资源。仅替换窗口标题会让 doge 仍向上游发送流量、接收上游更新，并在本地数据、安装包和当前文档中泄漏旧品牌；同时，盲目全局替换又会破坏 `.ccgui` / `mossx.*` 的兼容读取与未来 `upstream/main` 同步。

本 change 把 doge 建立为独立、可发布、可自动更新的客户端品牌：普通用户只接触 doge 产品面，开发者仍可通过只读 `upstream` remote 同步原项目，法律归属与 legacy migration 保持真实可追溯。

## What Changes

- 统一产品名为小写 `doge`，采用“拟人化 AI 小柴犬生活与工作助手”的品牌故事；首个版本如实声明当前能力聚焦 AI 工程工作流。
- 替换 WebView、native menu、About、锁屏、设置、错误反馈、安装包、图标、DMG、README 与 current documentation 的用户可见品牌。
- **BREAKING（分发身份）**：将 Tauri `productName`、bundle identifier、Rust/npm binary/package identity 与 release artifact 名切换到 doge；doge 使用独立 updater signing key，不继承上游更新信任链。
- 将当前数据根迁移到 `~/.doge` 与 doge bundle app-data；首次启动可从 `.ccgui`、`.mossx`、`.codemoss` 和旧 bundle app-data 做幂等 copy-forward，禁止覆盖已存在的 doge 数据。
- 将 shipping `localStorage` / client-store / protocol marker 命名空间迁到 `doge.*`；仅在 compatibility reader、migration test 与历史协议解析处保留 legacy token。
- 立即移除/禁用上游 Baidu Tongji site id、`fufei.mossx.ai` managed preset、上游 updater/feed、issue/download/web-assets endpoint；不得用 doge 名义继续消费上游专属服务。
- 使用 `jasonmao-msj/doge` GitHub Releases + `latest.json` + Tauri signature 完成下载与自动更新；本阶段不引入自建云服务器。
- 保留开发侧 `upstream = zhukunpenglinyutong/desktop-cc-gui` 的同步知识，并建立 shipping-surface allowlist/check，防止后续 upstream merge 把旧品牌或上游服务重新带回产品。
- 保留原 MIT `LICENSE` copyright、immutable archive/history 与必要 OSS attribution；这些 legal/historical/compatibility surface 不视为用户产品品牌。
- 先记录并隔离 Fork 创建时已存在的 baseline failures；发布前必须以独立、可审阅的修复使最终 gates 全绿，不得把上游红线误归因于品牌改动。

## 目标与边界

### 目标

1. 普通 App 用户在 UI、安装包、更新提示、当前产品文档、反馈/下载入口中只看到 doge。
2. doge 不再向上游 analytics、update、web-assets 或 managed provider service 发送产品流量。
3. doge 可完全依赖 GitHub Actions / Releases 完成多平台产物和安全自动更新，无需自建服务器。
4. 现有上游用户数据可被 doge 一次性、安全、幂等地导入；doge 新数据不再写回 legacy 根。
5. 后续可以持续 merge `upstream/main`，并由 automated brand/service gate 阻止回归。
6. 10 套当前已发布 locale bundle 的品牌 copy 与路径提示保持 parity。

### 边界

- 覆盖 frontend、Rust/Tauri、scripts、CI/release、current docs、visual assets 和兼容迁移。
- `origin` / `upstream` 属于 developer Git topology，不进入 App runtime 配置。
- 品牌视觉产出包含主图、平台 icon matrix 与安装包背景；不在本 proposal 锁定最终插画细节。
- 当前代码事实优先于 stale README/OpenSpec inventory；实现时以 manifests、`src/i18n/index.ts` 与 shipping source scan 为准。

## 非目标

- 不在本阶段增加账号、云同步、远程任务、付费、后台 API gateway 或自建下载服务器。
- 不把现有工程工作台虚构成已经具备日程、邮件、家庭管理等生活助手能力。
- 不删除或伪造原作者 copyright、MIT license、Git commit history、immutable OpenSpec archive。
- 不修改 Claude/Codex/Gemini/Grok/Kimi/OpenCode 的产品商标或 provider protocol。
- 不承诺从上游 ccgui 安装包原地自动升级到 doge；doge 是独立安装与独立信任链。
- 不顺手重构与品牌、identity、distribution、migration 无关的业务模块。
- 不在此 change 接入新的 telemetry；如未来需要，必须另开 opt-in privacy change。

## 技术方案对比

| 方案 | 描述 | 优点 | 风险 | 结论 |
| --- | --- | --- | --- | --- |
| A. 全仓库机械替换 | 将所有 `ccgui/mossx` 字符串直接替换为 `doge` | 快 | 破坏 legacy data/protocol、历史事实和上游同步；易漏外部 endpoint | 否决 |
| B. 每次 upstream merge 后维护人工 patch | shipping source 直接散落 doge 文案，冲突后人工复改 | 初期成本低 | 冲突不可预测，旧品牌/服务容易回流，缺少 machine gate | 仅作过渡，不采用为长期合同 |
| **C. Canonical brand manifest + compatibility allowlist + release isolation** | 用 canonical identity constants/manifest 驱动可复用 surface；Tauri/static manifests 由 check 校准；legacy token 只在 allowlist 中存在 | 可审计、可迁移、适合长期同步、阻止外部服务回归 | 初次覆盖面较大，需要分阶段验证 | **采用** |

实现允许为 Tauri JSON、Cargo/npm metadata 保留必要的静态重复，但这些值必须由 brand check 与 canonical manifest 对齐，不引入运行时动态生成配置。

## Capabilities

### New Capabilities

- `doge-product-identity`: doge 的 canonical name、品牌故事、用户可见 surface、package/bundle/binary identity 与跨平台 visual asset contract。
- `doge-storage-identity-migration`: `~/.doge`、doge app-data、client-store/localStorage namespace 与 legacy copy-forward 的幂等/非覆盖合同。
- `doge-release-distribution`: doge GitHub Releases、artifact naming、`latest.json`、独立 updater signing key、下载/更新 endpoint 与无自建服务器边界。
- `doge-upstream-boundary`: developer-only upstream sync、legal/history/compatibility allowlist，以及 shipping surface 禁止上游品牌与专属 service 回流的 gate。

### Modified Capabilities

- `client-localization-language-support`: 所有已发布 locale 必须同步 doge brand copy、路径提示和 interpolation parity。
- `documentation-governance`: current product docs 使用 doge 事实；legal attribution 与 immutable historical docs 保留原名并声明事实边界。
- `linux-native-baidu-analytics-stability`: 移除“生产环境必须保留 Baidu Tongji”的合同；doge 各平台均不得初始化或调用上游 Baidu analytics。

## Impact

| 层 | 主要影响 |
| --- | --- |
| Product identity | `package.json` / lockfile、`src-tauri/Cargo.toml` / lockfile、Tauri configs、window/menu/About/title |
| Storage | `src-tauri/src/app_paths.rs`、app-data migration、`src/services/migrateLocalStorage.ts`、storage/protocol keys 与 tests |
| Distribution | `.github/workflows/release.yml`、build scripts、Tauri updater config/public key、release artifact tests |
| External services | Baidu Tongji frontend/backend/CSP、upstream GitHub URLs、web assets、managed provider preset |
| Localization | `src/i18n/locales/*` 当前发布的 10 个 locale bundle |
| Visuals | root/public/source icons、Tauri platform icon matrix、DMG backgrounds、README banner/screenshots |
| Docs/governance | README 中英文、About/current docs、`AGENTS.md` / OpenSpec living context、brand check/allowlist |
| Compatibility | legacy `.ccgui/.mossx/.codemoss`、旧 bundle identifier、legacy marker/media type readers |

## 验收标准

1. Normal product surface scan 不再出现 `ccgui`、`CC GUI`、`mossx`、上游仓库 URL、上游 bundle id、Baidu site id 或 `fufei.mossx.ai`；仅 allowlisted legal/history/migration/protocol compatibility 可保留。
2. macOS dev build 的菜单、窗口、首页、锁屏、设置、About、错误反馈和文件路径提示均使用 doge；10 个 locale namespace key/placeholder parity 通过。
3. 新用户只写 `~/.doge` / doge app-data；有 legacy 数据时 copy-forward 一次且不删除源、不覆盖 doge 现有数据，并留下可诊断但不含敏感内容的 migration sentinel。
4. Tauri updater 只信任 doge public key，只访问 `jasonmao-msj/doge` release feed；release workflow 生成 doge 命名的跨平台 artifacts、signatures 与合法 `latest.json`。
5. 生产 bundle 不包含可执行的 Baidu analytics path；CSP 不再放行 `hm.baidu.com`，无 upstream analytics fallback。
6. Developer clone 保持 `origin=jasonmao-msj/doge`、只读 `upstream=zhukunpenglinyutong/desktop-cc-gui`；该 remote 不成为 runtime/user-facing 配置。
7. README/current docs 仅以 doge 叙述当前产品；`LICENSE` 保留原版权，历史 archive 不被批量伪造性改写。
8. `npm run check:branding` 更新为 doge contract，并与 external-service scan 一起阻止 upstream merge 回归。
9. 发布前 `npm run doctor:strict`、`npm run lint`、`npm run typecheck`、`npm run test`、`cargo test --manifest-path src-tauri/Cargo.toml`、`npm run build:mac-arm64` 全绿；Fork 创建时的已知 baseline failures 必须在独立 commit/evidence 中闭合。
10. `openspec validate rebrand-client-to-doge --strict --no-interactive` 通过，实施与验证 evidence 可追溯到本 change。

## 风险与回滚

| 风险 | 缓解 |
| --- | --- |
| identity rename 造成数据“丢失”假象 | copy-forward、非覆盖、sentinel、fixture matrix |
| updater key 丢失导致已安装 doge 无法继续更新 | private key 离线备份 + GitHub Secret；public key 固化并测试 |
| upstream merge 重新带回旧 endpoint | brand/service negative scan 作为 doctor/CI gate |
| binary/crate 重命名影响 scripts | 分层提交，先 metadata tests 后 binary rename |
| 历史/compatibility 被误删 | allowlist 必须写 reason、owner 与 removal condition |
| 全量 i18n 手改漂移 | source locale + namespace parity automation，品牌词只替换目标 key |

回滚按阶段执行：distribution isolation 不回滚到上游 endpoint；UI/visual 可回滚到上一 doge asset；storage migration 采用 copy-forward，回滚不得删除 `~/.doge` 或 legacy source。
