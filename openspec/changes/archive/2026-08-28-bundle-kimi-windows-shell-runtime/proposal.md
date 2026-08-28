## Why

当前发布流程已经为 macOS 与 Windows 准备 bundled Kimi CLI，但 Kimi 在 Windows 执行 Bash / Git 工具时仍要求用户本机预先安装 Git Bash。这样会造成“CLI 已随应用安装，但首次执行工具失败”的隐性依赖；Windows 用户还可能没有 Node、npm 或可继承的 interactive shell 环境。

macOS 的系统 shell 能满足 Kimi 当前的 POSIX shell 运行边界，但两端仍需要使用同一个可验证的 Kimi launch contract，避免 bundled binary、external binary、doctor 与正式发送各自解析出不同环境。

## What Changes

- macOS 与 Windows 的正式 bundle 均携带 pinned、checksum-verified 的 Kimi CLI，并将 bundled Kimi 作为无外部安装时的默认 toolchain。
- Windows bundle 额外携带经过 license review 的 portable Git runtime，包含 Kimi 实际需要的 `bash`、Git、DLL 与 shell support files；不要求用户安装 Git Bash，不修改系统 `PATH`。
- 新增 Kimi launch context：统一解析 binary、shell runtime、process-level `PATH` 与 `KIMI_CODE_HOME`，发送、版本探测和 doctor 必须复用同一解析结果。
- macOS 使用系统 shell capability；仅在系统 shell 不可用或 probe 失败时返回结构化诊断，不打包 Windows portable Git 到 macOS。
- `kimi doctor` 增加 shell preflight：Windows 校验 bundled portable Git，macOS 校验 `/bin/sh` 与必要的 shell command；缺失、损坏、权限或版本不匹配必须区分报告。
- bundled artifact 的下载、解压、SHA256、目录边界、代码签名与 release smoke test 纳入现有 bundled-engine pipeline。

## Non-Goals

- 不把 Git Bash、WSL、MSYS2 或 Node/npm 安装到用户系统。
- 不持久化修改 Windows `PATH`、PowerShell profile、`.bashrc` 或 macOS shell profile。
- 不修改 Kimi ACP / stream-json 协议、不改变 provider home materialization、不为 Shared Session 增加新能力。
- 不把 portable Git runtime 暴露为通用 terminal shell；它只服务于 Kimi 子进程。

## Impact

- Build/release: `scripts/bundled-engines.manifest.json`、`scripts/prepare-bundled-engines.mjs`、Tauri bundled resources、Windows/macOS artifact license and signing metadata。
- Backend: Kimi launch context、process environment、status/doctor 与 bundled toolchain resolution。
- Tests: manifest/preparation tests、Rust launch-context/doctor tests、Windows 与 macOS smoke matrix。
- Existing behavior: external Kimi binary remains supported；用户显式选择 external binary 时仍不覆盖其 binary，但默认 shell resolution 仍必须可诊断、可回退且不污染全局环境。

## Verification Level

L3 Cross-layer / High-risk。原因是该 change 同时影响 installer resource、跨平台 process launch、engine routing、diagnostics、release artifact 与安全边界。正式安装包 build、签名、Windows/macOS 实机 smoke 属于 L4 Release/CI gate。
