## 1. Discovery and compatibility evidence

- [ ] 1.1 [P0] 在当前 pinned Kimi Windows version 上实测 Bash discovery：`PATH`、`SHELL`、固定路径、registry、working directory 与 child process behavior；保存 command、version、exit code 与关键输出证据。
- [ ] 1.2 [P0] 在 macOS arm64/x64 实测 bundled Kimi 对系统 `/bin/sh`/`bash` 的依赖，确认无需额外 shell artifact。
- [ ] 1.3 [P0] 比较 MinGit 与 Git for Windows portable package：文件完整性、体积、license、签名/AV 兼容性、`bash`/`git`/DLL smoke；选定一个 artifact 并记录来源与版本策略。

## 2. Cross-platform bundled artifact pipeline

- [x] 2.1 [P0] 扩展 bundled-engine manifest schema，声明 Windows Kimi shell runtime 的 URL、version、archive、SHA256、root 与 required files；保留 Kimi executable 独立校验。
- [x] 2.2 [P0] 更新 `prepare-bundled-engines.mjs`：按 target 下载、校验、路径安全检查、staging、原子替换；macOS 不下载 Windows shell artifact。
- [ ] 2.3 [P1] 增加 bundled artifact license notices、source metadata 与 release packaging review input。已写入 source manifest 的 source/license metadata；正式 third-party notice 文件与 installer review 仍由 release gate 完成。
- [x] 2.4 [P0] 扩展 Node tests，覆盖 Windows shell artifact、checksum mismatch、missing required file、archive traversal、stale replacement 与 macOS exclusion。

## 3. Kimi launch and diagnostics contract

- [x] 3.1 [P0] 新增统一 Kimi launch context builder，解析 bundled/external Kimi、Windows portable Git、macOS system shell、process-level PATH 与 `KIMI_CODE_HOME`。
- [x] 3.2 [P0] 让 Kimi send、version probe、toolchain inspection 与 doctor 复用 launch context；不得通过 global PATH/profile 注入依赖。
- [x] 3.3 [P0] Windows 为 Kimi child process 注入 verified portable Git PATH；macOS 仅使用系统 shell capability；所有 command 继续保持 argv-safe。
- [ ] 3.4 [P0] doctor 增加 shell identity、required-file、permission 与 minimal command probe，并映射 `missing/invalid/checksum-mismatch/permission-denied/unsupported-platform/probe-failed`。当前已覆盖 missing/invalid/unsupported-platform/probe-failed；checksum/permission 的 installer 实机 evidence 仍待补齐。
- [x] 3.5 [P1] 增加 frontend-safe diagnostics 与 repair/update action；不能将“`kimi --version` 成功”单独视为 ready。

## 4. Focused verification and release evidence

- [ ] 4.1 [P0] Rust focused tests：launch context path boundary、platform policy、PATH isolation、KIMI_CODE_HOME preservation、doctor failure mapping。
- [x] 4.2 [P0] 运行 affected Node tests、Rust targeted tests、`cargo check --manifest-path src-tauri/Cargo.toml --lib`、`npm run typecheck`、targeted lint 与相关 runtime/engine contract checks。已完成 Node bundled-engine tests、Rust Kimi focused tests、TypeScript typecheck、targeted ESLint、runtime contract、独立 `cargo check --lib` 与 strict OpenSpec validation。
- [ ] 4.3 [P0] Windows clean-machine smoke：未安装 Git Bash/Node/npm 时完成 Kimi version、普通回复、Bash tool、Git tool、cancel 与 error diagnostics。
- [ ] 4.4 [P0] macOS arm64/x64 smoke：bundled Kimi 使用系统 shell，验证 package 不携带 Windows shell artifact，普通回复、Bash tool 与 provider home 均正常。
- [ ] 4.5 [P1] 验证安装路径包含空格/非 ASCII、外部 Kimi、system Git Bash 已存在、portable Git 被删除/隔离等矩阵。
- [ ] 4.6 [P0] L4 release gate：正式 Windows/macOS installer、resource manifest、third-party license notices、binary signing、checksum 与 startup/send smoke。
- [ ] 4.7 [P0] OpenSpec strict validation；已通过 change strict validation。收口前仍需评估并记录 engine runtime foundation ADR calibration gate。
