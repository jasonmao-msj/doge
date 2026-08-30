# CLI Version Status Contract

## Scenario: CLI version probe isolates login shell startup output

### 1. Scope / Trigger

- Trigger：修改 `resolve_cli_version_status`、Claude interactive login shell probe、`CliVersionStatus` 或 `CliLifecycleHeaderActions`。
- 目标：shell startup banner、proxy notice 与 profile diagnostics 不得进入 local version，也不得影响 update state。

### 2. Signatures

- Backend：`pick_claude_version_line(output: &str) -> Option<String>`
- Backend：`resolve_cli_version_status(engine, settings) -> CliVersionStatus`
- Payload：`CliVersionStatus { localVersion, latestVersion, updateAvailable, ... }`
- Frontend：`CliLifecycleHeaderActions()`

### 3. Contracts

- Claude login shell output MAY contain arbitrary non-version lines before `command -v claude` 与 `claude -v` output。
- Version parser MUST accept a line containing `claude` + semver，或以 standalone semver token 开头的 canonical version line。
- Version parser MUST reject URLs、IP addresses、proxy notices、shell plugin diagnostics 与 arbitrary trailing lines。
- `updateAvailable=false` 只表示“没有确认更高版本”，不得单独解释为“已是最新”。
- “已是最新” MUST require non-null `localVersion`、non-null `latestVersion` 与 `updateAvailable=false`。
- Desktop header actions MUST stay right-aligned on the title row when space permits；insufficient width MAY wrap in normal flow。

### 4. Validation & Error Matrix

| 输入/状态 | 必须行为 | 禁止行为 |
|---|---|---|
| proxy banner + path + Claude version | select Claude version | select `127.0.0` from proxy URL |
| proxy banner only | `localVersion=null` / fallback probe | expose banner as version |
| local known, latest unknown | show local version only | show “已是最新” |
| local/latest known, latest > local | show target version + update action | hide update |
| local/latest equal | show “已是最新” | show update |

### 5. Good / Base / Bad Cases

- Good：`2.1.218 (Claude Code)` 被选中，前置 `http://127.0.0.1:7890` 被忽略。
- Base：纯 `2.1.218` output 仍可识别。
- Bad：对任意包含三个数字段的行调用 `extract_semver()` 并把首个 match 当版本。
- Bad：`updateAvailable ? outdated : latest`，因为 `false` 同时覆盖 registry probe failure。

### 6. Tests Required

- Rust test MUST 覆盖真实 proxy banner + path + Claude version，以及 banner-only rejection。
- Vitest MUST 覆盖 latest unknown、outdated、confirmed latest 三态。
- Required gates：focused Rust test、focused Vitest、`npm run typecheck`、focused ESLint、`git diff --check`。

### 7. Wrong vs Correct

#### Wrong

```rust
lines.find(|line| extract_semver(line).is_some())
```

```tsx
{updateAvailable ? <UpdateBadge /> : <UpToDateBadge />}
```

#### Correct

```rust
lines.find(|line| is_canonical_claude_version_line(line))
```

```tsx
{updateAvailable && latestVersion
  ? <UpdateBadge />
  : latestVersion
    ? <UpToDateBadge />
    : null}
```

## Scenario: timed-out CLI probe process-group cleanup

### 1. Scope / Trigger

- Trigger：修改 `run_cli_probe()`、`terminate_probe_process_tree()`、Unix process-group setup或其 hanging-probe regression。
- 目标：timeout必须终止整个 probe group；测试必须容忍 kernel/init的 bounded zombie reaping latency，但不能把仍存活 descendant判为成功。

### 2. Signatures

- `configure_probe_process_group(command: &mut tokio::process::Command)`
- `terminate_probe_process_tree(child: &mut tokio::process::Child) -> Result<(), String>`
- `run_cli_probe(bin, args, path_env, deadline) -> Result<CliProbeOutput, CliProbeError>`
- Test observation budget：`DETECTION_CLEANUP_TIMEOUT`。

### 3. Contracts

- Unix probe leader MUST call `setpgid(0, 0)` before exec；timeout MUST send `SIGKILL` to negative leader pid。
- Runtime MUST reap the group leader；stdio readers MUST have bounded cleanup。
- Background descendant被 kill后 MAY成为由 init异步 reap的 transient zombie；此时 `kill(pid, 0)=0` 不证明它仍执行。
- Regression MUST poll until `kill(pid, 0)=-1` and `errno=ESRCH` within `DETECTION_CLEANUP_TIMEOUT`。
- Poll timeout MUST fail；production probe deadline与 cleanup timeout MUST NOT因 test flake被扩大。

### 4. Validation & Error Matrix

| 状态 | 必须行为 | 禁止行为 |
|---|---|---|
| group kill + immediate ESRCH | test pass | extra fixed sleep |
| group kill + transient zombie | bounded poll until ESRCH | immediate false failure |
| descendant remains live beyond cleanup budget | test fail | accept `kill(pid, 0)=0` |
| non-ESRCH probe error | test fail with errno | treat all negative results as gone |

### 5. Good / Base / Bad Cases

- Good：50ms interval bounded poll观察到 ESRCH后立即结束。
- Base：首次 probe已是 ESRCH，零额外等待。
- Bad：单次 immediate `kill(pid, 0)`断言，或 unconditional `sleep(2s)`后不检查 errno。
- Bad：为了测试稳定而提高 `run_cli_probe()` production deadline。

### 6. Tests Required

- Focused Rust test MUST run repeatedly，证明 timeout仍返回 `CliProbeError::Timeout`、elapsed budget不变、descendant最终 ESRCH。
- Required：`cargo test --manifest-path src-tauri/Cargo.toml hanging_probe_times_out_and_terminates_its_process_group`（repeat ≥10）；`cargo check --manifest-path src-tauri/Cargo.toml --lib`；`git diff --check`。

### 7. Wrong vs Correct

#### Wrong

```rust
assert_eq!(unsafe { libc::kill(child_pid, 0) }, -1);
```

#### Correct

```rust
timeout(DETECTION_CLEANUP_TIMEOUT, async {
    loop {
        if unsafe { libc::kill(child_pid, 0) } == -1
            && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH)
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
})
.await?;
```
