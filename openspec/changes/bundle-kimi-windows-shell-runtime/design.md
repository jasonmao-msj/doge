## Context

当前 `scripts/bundled-engines.manifest.json` 已声明 macOS arm64/x64 与 Windows x64 的 Kimi executable，Tauri config 也会将 `bundled-engines` 作为 resource 打包。现有 `KimiSession::build_command` 负责解析 `kimi`、注入 `KIMI_CODE_HOME` 并启动子进程，但没有统一的 shell dependency resolution。

当前 status/doctor 主要验证 `kimi --version`。这只能证明主 executable 能启动，不能证明 Kimi 后续调用 Bash / Git tool 时具备可用 shell，因此会产生 false-ready 状态。

## Decision

### 1. 双平台 toolchain policy

| Platform | Kimi CLI | Shell runtime | Default source | Failure policy |
|---|---|---|---|---|
| Windows x64 | bundled Kimi executable | bundled portable Git/Bash | bundled | bundled shell 缺失或校验失败时 fail closed，并给出 repair/update 诊断 |
| Windows x64 external Kimi | configured/PATH Kimi executable | bundled portable Git/Bash，必要时检测 system Git Bash | external binary + managed shell | 不因 external binary 可执行就隐藏 shell blocker |
| macOS arm64/x64 | bundled Kimi executable | system `/bin/sh`/`bash` capability | bundled | system shell probe 失败时返回 actionable diagnostic |
| macOS external Kimi | configured/PATH Kimi executable | system shell capability | external binary | 保持 external binary 选择，不写入 shell profile |

Windows 使用 portable Git 的完整目录，不只复制 `bash.exe`。准备脚本必须验证 `bash`、`git`、依赖 DLL 与 required support files 均存在；具体目录布局以选定发行包的实测结果为准，不在代码中硬编码未经验证的单一路径。

### 2. Artifact manifest and staging

扩展 bundled-engine source manifest，使 Kimi 的 Windows entry 能声明 shell runtime artifact 的 URL、version、archive type、SHA256 与 expected root/files。现有 Kimi executable artifact 保持独立校验；shell runtime 不得通过未校验的动态下载或用户 PATH 获取。

`prepare-bundled-engines.mjs` 按 target 下载并校验 Kimi 与 portable Git，先写入 temporary staging tree，再一次性替换 output tree。macOS target 不应下载或复制 Windows shell artifact。缓存命中仍必须重新计算 SHA256，archive entry 必须通过现有路径穿越检查。

### 3. Kimi launch context

新增内部 launch context，至少包含：

- resolved Kimi executable and source (`bundled` / `external`)
- shell runtime source and resolved shell executable when applicable
- process-level `PATH`
- `KIMI_CODE_HOME` override
- diagnostic facts safe for frontend exposure

Windows PATH 只在 Kimi child process 上设置，优先包含 portable Git 的实际 `cmd`、`bin`、`usr/bin`、`mingw64/bin` directories，再追加原始 PATH；不得覆盖用户的全局环境。Kimi command 继续使用 argv API，不通过 `cmd.exe /c` 或字符串拼接间接执行。

macOS 不打包 Windows runtime，也不将 `/bin/bash` 复制到 app resource；launch context 使用系统 capability，并在 spawn 前做存在性与可执行性检查。

发送、`probe_engine_version_text`、Kimi doctor、toolchain inspection 必须复用同一 launch context builder。这样不能出现 version probe 通过但真实 turn 缺少 shell，或 bundled Kimi 与 external Kimi 使用不同隐式环境的情况。

### 4. Discovery and compatibility spike

在固定 Kimi version 上先做 black-box discovery，记录 Kimi 是通过 `PATH`、`SHELL`、固定安装目录、registry 还是其他机制发现 Bash。只有当 probe 证明 portable Git 能满足 Kimi 的 discovery contract 后，才能将该 runtime 标记为 ready。

如果未来 Kimi 改为硬编码 Git Bash 安装目录或 registry 检查，不能伪造用户注册表或静默绕过检查；应优先使用官方配置入口，必要时将该版本标记为 unsupported 并等待 upstream fix。

### 5. Doctor and recovery

Doctor 分三层报告：

1. Kimi executable identity/version；
2. shell runtime identity/version/path；
3. minimal command probe，例如 `bash --version`、`git --version` 与 workspace cwd probe。

错误分类至少包括 `missing`、`invalid`、`checksum-mismatch`、`permission-denied`、`unsupported-platform` 与 `probe-failed`。frontend 只展示 mapped safe message，不暴露 API key、完整环境变量或未经截断的 stderr。

### 6. Security, license and updates

Portable Git artifact 必须记录来源、版本、SHA256、license notice 与更新责任；Windows installer 中的 third-party notices 与 binaries 一起进入 release review。bundled executable 与 shell binaries 按现有 Windows/macOS signing policy 处理，杀毒软件误报或 quarantine 必须能被 doctor 识别。

Kimi 或 portable Git 更新时必须重新运行 discovery、license review、checksum verification 和双平台 smoke；旧缓存不能仅凭文件存在判定有效。

## Failure Matrix

| 场景 | 预期 |
|---|---|
| 全新 Windows，无 Git Bash/Node/npm | bundled Kimi + bundled portable Git 可完成 version、text、Bash/Git tool smoke |
| Windows bundled Kimi 缺 `bash` 或 DLL | doctor 返回 shell blocker，发送不启动半成功 turn |
| Windows 只安装了 system Git Bash | bundled Kimi 默认仍使用受管 shell；system shell 只作为明确 external/compatibility fallback |
| Windows external Kimi + bundled shell | external binary 保留，shell context 可诊断且不改全局 PATH |
| macOS arm64/x64 | bundled Kimi 使用系统 shell，macOS 包不含 Windows portable Git |
| 安装路径含空格或非 ASCII | binary、bash、cwd 和 `KIMI_CODE_HOME` 均通过 argv/path API 正常工作 |
| artifact SHA256 不匹配或 archive 越界 | prepare fail fast，不生成部分成功的 resource tree |
| portable Git 被删除/隔离 | 下次 doctor 明确报告 invalid/missing，并提供 repair/update path |
| Kimi 新版本改变 Bash discovery | capability probe 失败或显式降级，不冒充默认可用 |

## Open Questions To Resolve In Spike

- 选用 MinGit 还是 Git for Windows portable package，以及该版本实际包含的 shell files。
- Kimi 对 Windows shell 的精确 discovery contract 与是否需要 `SHELL` / `MSYSTEM` 等环境变量。
- portable Git 是否需要额外的 license/source offer 资产，以及 installer/AV 对资源目录的限制。
