## ADDED Requirements

### Requirement: Tauri development SHALL stage managed engine resources

当开发者通过 Tauri dev 启动主应用时，`beforeDevCommand` MUST 先准备 bundled engine source，且 debug `resource_dir` MUST 包含与当前 source 一致的 `bundled-engines/current` tree。同步 MUST 在启动应用前完成 staging 并替换旧 destination，且 destination MUST 是 real copied tree，不得为 source symlink；空或非法 manifest MUST 不得作为 prepared source 放行。

#### Scenario: Prepared source starts a dev application

- **WHEN** `src-tauri/resources/bundled-engines/current/manifest.json` 和对应 binaries 已准备
- **THEN** `src-tauri/target/debug/bundled-engines/current` 包含同一 manifest 与 binaries
- **AND THEN** native toolchain resolver 继续执行既有 manifest 和 binary version verification

#### Scenario: Generated source is absent or invalid before dev startup

- **WHEN** `src-tauri/resources/bundled-engines/current` 缺失、为空或 manifest 无效
- **THEN** `beforeDevCommand` MUST run bundled-engine preparation before debug staging
- **AND THEN** resource preparation failure MUST block Vite/Tauri startup with its verification or download error

#### Scenario: Missing prepared source blocks startup

- **WHEN** bundled engine source directory 缺失或不是 directory
- **THEN** dev resource preparation MUST fail before frontend server starts
- **AND THEN** it MUST NOT create an empty `current` directory as a success substitute

### Requirement: Preparing failures SHALL remain actionable

managed engine preparing 失败时，Account gate MUST 显示 mapped renderer-safe failure message 与 retry action；不得暴露 raw native error、resource path 或 secret。

#### Scenario: Development toolchain resource is unavailable

- **WHEN** toolchain resolver returns `engineBundleUnavailable`
- **THEN** the gate shows the generic preparation title and the mapped bundled-engine recovery message
- **AND THEN** Retry re-runs toolchain inspection

### Requirement: Verified account engines SHALL not depend on global status cache

在当前进程内，Native account toolchain 已成功验证的 managed Codex 或 Claude binary MUST 能完成 account gate 的 active-engine 切换，即使通用 engine status cache 被用户配置或 PATH 探测更新为 unavailable。该例外 MUST 不接受 renderer 传入的 binary path；没有已验证 managed binary 的普通切换仍必须保留 installed verification。

#### Scenario: Global detection marks a configured CLI unavailable after toolchain verification

- **WHEN** account toolchain 已在当前进程内验证并登记选中的 managed engine binary
- **AND WHEN** global engine status cache 将同一 engine 标记为 unavailable
- **THEN** account gate 的 engine activation 成功并设为 active
- **AND THEN** Native 不暴露已验证 binary 的绝对路径给 renderer

#### Scenario: Ordinary switch has no verified managed binary

- **WHEN** 调用方切换到没有当前进程 verified managed binary 的 engine
- **THEN** Native MUST 继续执行既有 installed verification
