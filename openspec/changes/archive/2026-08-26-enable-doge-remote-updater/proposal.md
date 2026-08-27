# Enable doge Remote Updater

## Why

启用 doge desktop app 的 signed remote update。Windows 与 macOS release 必须从 canonical doge GitHub release feed 检查更新，并通过 Tauri updater 的 public key 验证更新包；用户提供的 public key 只进入可公开分发的配置，private key 继续由 GitHub Actions secret 管理。

## What Changes

- 开启 doge updater plugin、updater artifacts 与 canonical endpoint。
- 将提供的 minisign public key 固化到 Tauri shipping config。
- 保持 Windows NSIS 与 macOS `.app.tar.gz` 的 signed artifact / `latest.json` contract。
- 修复 release contract test 在 Windows CRLF 下的误报。
- 防止下载、安装、重启期间的 dismiss 或重复 action 破坏 updater operation state。

## Scope

### In scope

- `config/brand.json`、`src-tauri/tauri.conf.json`、`src-tauri/tauri.windows.conf.json`。
- `.github/workflows/release.yml` 与 release workflow contract test。
- `useUpdater` / `UpdateToast` 及其 focused tests。
- OpenSpec change-local behavior contract。

### Out of scope

- 不生成、提交或打印 `TAURI_SIGNING_PRIVATE_KEY`。
- 不迁移旧 `ccgui` signing key 或旧 release feed。
- 不改变当前分支已有未提交修改。
- 不扩展移动端更新能力；Linux 既有 release job 保持现状，本 change 的 acceptance focus 为 Windows/macOS。

## Acceptance Criteria

1. shipping config 的 updater active、endpoint、public key 和 updater artifacts 全部启用且互相一致。
2. release preflight 能拒绝缺少 signing secret 或不匹配的 config；完整 secret 注入后 Windows/macOS artifact 能进入 `latest.json`。
3. Windows 与 macOS 安装包的 updater artifacts 均使用同一 private key 签名，并由 shipping public key 验签。
4. updater focused tests 覆盖 success、interactive/background failure、stale check、download failure，以及 dismiss/repeated action during download。
5. `npm run typecheck`、affected Vitest、target ESLint、branding contract 与 strict OpenSpec validation 通过。

## Provided public key

```text
dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDA4QjcxRkFFN0Q5NzgxQUYKUldTdmdaZDlyaCszQ0k2NGVoTG1LRnVoNGF3SVZjNFVzeTZlc2VNcUJhdlhmTko4WkY2QU9UQmMK
```

## Impact

这是 cross-layer / installer 级别变更，verification level 为 L3。失败时 background check 保持 non-blocking；interactive check 保持可见错误与 retry；签名链缺失时 release 必须 fail-closed。
