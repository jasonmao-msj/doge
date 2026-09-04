# Verification: 修复微信跨平台文件链接传输

## Result

实现已通过 Windows L3 focused verification。截图对应的 `/D:/...` path 仅在 Windows build 的 canonical validation 前归一为 drive-absolute path；non-Windows build 原样保留 native absolute target，避免 macOS/Linux 将合法 `/D:/...` 误改成 relative path。`.md` 与 `.pptx` 均进入既有 outbound `file_item` pipeline；成功 materialize 后，link 独占的空 Markdown bullet 不再进入微信文本。

GitHub Actions run `33630669690` 的唯一失败为 macOS `test-tauri`：`refuses_structured_media_when_workspace_is_unavailable` 使用 Windows-only `C:\\private\\preview.png` fixture，macOS `Path::is_absolute()` 将其判为 relative 并在进入待测 fail-readable branch 前丢弃。fixture 已改为 `std::env::temp_dir()` 生成的 host-native absolute path；产品的 absolute-path 与 workspace fail-closed contract 未放宽。

## Commands

| Command | Result |
|---|---|
| `gh run view 33630669690 --job 100249306436 --log-failed` | 旧 run：2215 passed，1 failed；唯一失败为 workspace-unavailable test 的 macOS path fixture |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib wechat::tests::refuses_structured_media_when_workspace_is_unavailable -- --exact`（isolated `CARGO_TARGET_DIR`） | PASS：1 passed，0 failed |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib wechat::`（isolated `CARGO_TARGET_DIR`） | PASS：43 passed，0 failed |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib outbound_artifacts::tests`（isolated `CARGO_TARGET_DIR`） | PASS：5 passed，0 failed |
| `cargo check --manifest-path src-tauri/Cargo.toml --lib`（isolated `CARGO_TARGET_DIR`） | PASS；仅有 repository baseline warnings |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | PASS |
| `npx openspec validate fix-wechat-windows-outbound-file-links --type change --strict --no-interactive` | PASS |
| `git diff --check` | PASS；仅 Windows line-ending notice |
| `rustup target list --installed` | 本机仅有 `x86_64-pc-windows-msvc`；未伪造 macOS/Linux 本机验证 |

默认 Cargo target 的首次 focused test 在 Tauri build-script resource copy 阶段因运行中的 Doge 占用 `wechat-bridge.exe` 返回 Windows `os error 32`；改用 repository-local isolated target 后完成 compile 与 tests，未停止用户正在运行的应用。

## Covered Scenarios

- slash-prefixed Windows drive `.md` / `.pptx` links materialize 为两个 `kind=file` artifacts。
- `.md` MIME 为 `text/markdown`。
- 成功附件 link 独占 bullet 时不留下空 marker；同一 list item 仍有正文时正文与 marker 保留。
- host-neutral tests 覆盖 relative/native absolute、managed image、video、audio-as-file、remote/source、missing/outside/empty/oversized cases；这些 tests 不依赖 Windows path literal。
- `#[cfg(not(windows))]` regression 明确断言 drive-like `/D:/...` 保持 absolute target；仓库 `test-tauri` job 在 `macos-latest` 原生执行 full Rust tests，macOS/Linux 共用这一 compile-time branch。
- workspace unavailable regression 使用 host-native absolute structured-media fixture，因此 Windows/macOS/Linux 都会进入相同 fail-readable assertion；未通过放宽 relative path 来规避失败。

## Residual Scope

- 未重启当前 Doge 到新 binary，未执行真实微信客户端 CDN upload / download smoke。
- 当前机器没有 macOS/Linux Rust target，未运行这些平台的 native build/test；macOS `test-tauri` CI 将执行该 non-Windows regression，Linux native build/smoke 仍由 Release/CI 承担。
- run `33630669690` 是旧 commit `92c4dc334` 的失败记录，不会因本地修改自动变绿；修复仍需提交后由新 CI run 原生确认。
- 未运行 L4 full `npm run test`、full `cargo test` 或 production package。

## Post-Fix Analysis

- Root cause category：E（Implicit Assumption）+ D（Test Coverage Gap）。adapter 假设 ordinary Markdown absolute path 已符合 native Windows syntax，但 Desktop renderer 会接受 slash-prefixed drive syntax；原 focused tests 没有覆盖这个真实 engine output shape。
- CI follow-up root cause：E（Implicit Assumption）+ D（Test Coverage Gap）。workspace-unavailable test 把 Windows path literal 当成 cross-platform absolute fixture，导致 macOS 没有执行目标分支。
- First verification failure：修复 path/MIME 后暴露成功 link 会留下空 list marker；全局过滤空 marker 会影响原始正文，因此最终按 exact source line 收窄清理范围。
- Prevention：backend executable contract 明确 Windows-only `/D:/...` normalization、non-Windows native absolute path preservation 与 `.md` MIME；focused test 使用中文文件名和截图同形 link，并保留 unsafe path matrix。
- CI prevention：platform-sensitive tests 使用 host-native path constructor；微信目录已扫描，无其他跨平台 test 硬编码 Windows drive fixture。
- Systematic expansion：仓库其他 Windows local path normalizer 已校验 ASCII drive letter；Wechat helper 已对齐。未发现应抽取 shared utility 的第三个同形 channel adapter consumer。
- Knowledge capture：已更新 `.trellis/spec/backend/wechat-bundled-bridge-contract.md`；本仓库不存在 `src/templates/markdown/spec`，无 template sync target。
