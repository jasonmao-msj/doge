# Verification

## Scope

- Change: `add-wechat-multimedia-messages`
- Verification level: **L3**
- Highest-risk trigger: Tencent iLink CDN network/crypto contract、managed filesystem boundary、
  localhost webhook payload 与 selected-engine dispatch 跨层变化。
- ADR calibration: 未修改 engine registry、Shared support set、provider binding、canonical fact
  schema、context compiler、terminal/ACK 或 recovery exit/abandon，不命中 foundation ADR 回写触发器。

## Automated Results

| Command | Result |
|---|---|
| `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-wechat-check --lib wechat` | PASS, 39 passed |
| `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-wechat-check --bin wechat-bridge` | PASS, 18 passed |
| `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-wechat-check --lib engine::codex_prompt_service::tests` | PASS, 11 passed |
| `cargo check --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-wechat-check --lib` | PASS; existing repository warnings only |
| `npm run typecheck` | PASS |
| `npm run check:runtime-contracts` | PASS |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check` | PASS |
| `git diff --check` | PASS |
| `npx openspec validate add-wechat-multimedia-messages --strict --no-interactive` | PASS |
| `npm run check:large-files` | Completed in report mode; repository baseline reports 98 existing/new-baseline entries, including the touched large Rust modules |

默认 Cargo target 首次验证受正在运行的 Tauri 资源文件占用影响，Windows 返回 `os error 32`；
使用独立 `src-tauri/target-wechat-check` 后相同 test/compile surface 全部通过，没有终止或修改运行中的应用。

`npx openspec validate --all --strict --no-interactive` 结果为 528 passed / 9 failed。本 change 与
`spec/wechat-bridge-channel` 均通过；失败项为仓库既有且不在本 change 范围：

- `change/add-sub2api-relay-quota`
- `spec/app-shortcuts`
- `spec/composer-note-card-reference`
- `change/doge-unified-product-subscription`
- `change/fix-ui-scale-native-zoom-freeze-all-platforms`
- `change/fix-windows-cold-start-freeze-residual`
- `change/retire-canvas-subagent-squad-grid`
- `spec/spec-hub-workbench-ui`
- `spec/workspace-note-card-pool`

## Cross-Layer Review

- Inbound: iLink item -> bounded Tencent CDN download/decrypt -> WeChat managed inbox -> authenticated
  webhook -> canonical path validation -> WeChat-only prompt/images -> existing selected-engine sync call。
- Outbound: selected-engine sync result -> structured/Markdown artifact reconciliation -> shared canonical
  root/type/size validation -> localhost media request -> iLink `getuploadurl` -> encrypted CDN upload ->
  typed `image_item` / `video_item` / `file_item`。
- Access mode: webhook snapshots normalized `defaultAccessMode` and passes the existing argument; Desktop
  Composer payload、engine function signature、history 与 non-WeChat callers remain unchanged。
- Exact wire bytes: `getuploadurl.aeskey` uses lowercase hex；typed `media.aes_key` Base64-encodes that
  hex string's ASCII bytes，covered by byte-exact tests。

## Manual QA Waiver / Remaining Risk

用户于 2026-09-02 明确要求归档并提交 PR。按 archive policy，尚未完整执行的真实设备矩阵继续在
`tasks.md` 保持 unchecked：微信图片可查看、视频可播放、文件可打开，以及 inbound
image/voice/video/file fallback。此前交互反馈覆盖了部分图片与文件行为，但不足以宣称完整矩阵通过。

未执行 L4 full test suite、production package、cross-platform build 与 release smoke；由 CI/Release
承担。Tencent iLink 公开 provider contract 未声明 outbound hard size limit；当前 outbound 8 MiB 是
Doge bounded policy，不作为腾讯官方限制。
