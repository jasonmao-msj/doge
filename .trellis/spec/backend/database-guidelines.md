# Data Storage Guidelines（文件存储与一致性）

> 当前项目核心是 file-based persistence，不是传统 SQL-first 架构。

## 现有模式（必须复用）

- 原子写：`write_string_atomically(...)`
- 文件锁：`acquire_storage_lock(...)` / `with_storage_lock(...)`
- stale lock 处理：按超时策略清理
- JSON 序列化：`serde_json`（必要时 `rename_all = "camelCase"`）

## Scenario: 持久化 workspace / settings / client store / project memory

### 1. Scope / Trigger

- Trigger：修改 `storage.rs`、`client_storage.rs`、`project_memory.rs`、任何 file-based persistence。
- 目标：避免并发写覆盖、半写入、锁泄漏、旧数据不兼容。

### 2. Signatures

- lock acquisition：`acquire_storage_lock(...)` / `with_storage_lock(...)`
- atomic write：`write_string_atomically(...)`
- 调用方 contract：先准备完整 payload，再进入 lock + write path

### 3. Contracts

- 关键 JSON 文件写入必须遵循 `lock -> serialize -> temp write -> rename`
- 多线程/多进程都可能竞争同一路径，不能假设单写者
- serialization 字段名与 frontend mapping 保持兼容；变更字段时优先 backward compatibility

### 4. Validation & Error Matrix

| 场景 | 正确处理 | 禁止处理 |
|---|---|---|
| 并发写 | 加 lock 后写入 | 无锁直接覆盖 |
| stale lock | 清理过期 lock 后继续 | 永久阻塞 |
| Windows rename | 先移除旧文件再 rename（按现有实现） | 直接假设 Unix 行为 |
| JSON 损坏 | 返回 parse error / fallback default | 写入空对象掩盖问题 |

### 5. Good / Base / Bad Cases

- Good：复用 `with_storage_lock` + `write_string_atomically`
- Base：不存在的 settings 文件返回 default
- Bad：`std::fs::write(path, payload)` 直接覆盖关键状态文件

### 6. Tests Required

- 并发写入不会生成损坏文件
- stale lock 被正确清理
- Windows / rename 兼容逻辑至少有行为说明或测试覆盖
- 旧版 JSON 结构读取后仍能 fallback

### 7. Wrong vs Correct

#### Wrong

```rust
let data = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
std::fs::write(path, data).map_err(|e| e.to_string())?;
```

#### Correct

```rust
with_storage_lock(path, || {
    let data = serde_json::to_string_pretty(&settings)
        .map_err(|error| format!("failed to serialize settings: {error}"))?;
    write_string_atomically(path, &data)
})?;
```

## 写入规则

- 先写 temp file，再 rename 覆盖（atomic replace）。
- 任何可并发写入路径必须加锁。
- 不允许直接 `std::fs::write` 覆盖关键状态文件。

## 一致性规则

- 读写 key/字段命名与 frontend mapping 保持一致。
- 数据迁移必须兼容旧结构（backward compatibility）。
- 默认值逻辑要集中，避免多处分叉 fallback。

## Scenario: Versioned settings defaults migration

### 1. Scope / Trigger

- Trigger：新增一个默认开启的 persisted setting，但旧版 `settings.json` 已经显式写入旧字段值，单纯修改 serde default 无法覆盖 existing install。
- 目标：默认值只迁移一次，同时保留 migration 后的用户 opt-out。

### 2. Signatures

- persisted marker：`AppSettings.<domain>_defaults_version`
- startup upgrader：`AppSettings::upgrade_<domain>_defaults_for_startup(&mut self)`
- read owner：`storage::read_settings(path: &PathBuf) -> Result<AppSettings, String>`
- frontend mirror：`AppSettings.<domain>DefaultsVersion`

### 3. Contracts

- fresh `AppSettings::default()` MUST 使用 current marker version 与 current defaults。
- legacy JSON 缺 marker 时 MUST deserialize 为 `0`，由 `read_settings()` 调用 startup upgrader；禁止让 serde default 直接返回 current version，否则无法识别 legacy data。
- upgrader MUST 是 idempotent；marker 已达到 current version 时不得改写用户值。
- `undefined`/missing legacy field、legacy explicit value 与 explicit empty collection MUST 分别定义迁移语义。
- migration 只更新 startup memory snapshot；下次正常 settings write 原子持久化 marker。若用户在 migration 后 opt out，该 write MUST 同时保留 current marker，后续启动不得重新开启。
- Rust serde field、TypeScript `AppSettings` field、frontend default snapshot 与 OpenSpec behavior contract MUST 同步。

### 4. Validation & Error Matrix

| Persisted state | Startup result | Later restart |
|---|---|---|
| file missing | current defaults + current marker | 保持 current defaults |
| legacy non-empty value + marker missing | 执行一次 additive migration + marker current | 用户未修改时可重复 idempotent migration |
| legacy explicit empty collection + marker missing | 保持 empty + marker current | 不静默加入 defaults |
| current marker + user opt-out | 保持 opt-out | 禁止重新开启 |
| malformed JSON | 返回 parse error | 禁止覆盖原文件 |

### 5. Good / Base / Bad Cases

- Good：`curatedSkillDefaultsVersion=1`；旧 `["lazy-senior-dev"]` 补入 `caveman`，旧 `[]` 保持空，用户之后关闭 Caveman 并保存后仍保持关闭。
- Base：新安装直接从 `AppSettings::default()` 得到完整 defaults，不执行 legacy branch。
- Bad：只修改 `#[serde(default = "default_enabled_...")]`；旧 JSON 已有字段，所以新增 default 永远不会应用。
- Bad：每次启动发现某 id 缺失就补回；用户无法永久关闭该默认项。

### 6. Tests Required

- Rust storage test MUST 覆盖：legacy non-empty migration、legacy explicit empty、migration 后 opt-out write + reread。
- frontend test MUST 覆盖 missing payload fallback 与 explicit empty collection 的差异。
- typecheck MUST 证明 Rust camelCase payload 对应的 TypeScript marker field 已更新。

### 7. Wrong vs Correct

#### Wrong

```rust
#[serde(default = "default_enabled_items")]
enabled_items: Vec<String>,

// Re-adds the item forever, including after a user disables it.
if !settings.enabled_items.contains(&new_default) {
    settings.enabled_items.push(new_default);
}
```

#### Correct

```rust
#[serde(default)]
defaults_version: u8,

if settings.defaults_version < CURRENT_DEFAULTS_VERSION {
    migrate_legacy_values(&mut settings);
    settings.defaults_version = CURRENT_DEFAULTS_VERSION;
}
```

## Scenario: AppSettings shortcut 字段镜像与 round-trip

### 1. Scope / Trigger

- Trigger：新增、删除或重命名 `src/types/settings.ts` 中任何 persisted shortcut 字段，或修改 `save_app_settings` 的 request/response。
- 目标：防止 TypeScript-only 字段在 Rust `serde` deserialize 时被丢弃，随后由 backend echo 覆盖 UI draft，表现为“设置后自动还原”。

### 2. Signatures

- frontend type：`src/types/settings.ts::AppSettings`
- frontend defaults：`src/features/settings/hooks/useAppSettings.ts::defaultSettings`
- backend type/default：`src-tauri/src/types.rs::AppSettings` / `impl Default for AppSettings`
- persistence command：`save_app_settings(settings: AppSettings) -> Result<AppSettings, String>`
- regression test：`types::tests::app_settings_round_trips_all_frontend_shortcut_fields`

### 3. Contracts

- 每个 persisted shortcut key MUST 同时存在于 TypeScript `AppSettings`、frontend `defaultSettings`、Rust `AppSettings` 和 Rust `Default`。
- JSON wire key MUST 为 camelCase；Rust snake_case field 使用 `#[serde(rename = "<camelCase>")]`。
- custom shortcut string MUST 在 `JSON -> Rust -> JSON` 后原值返回。
- 显式 `null` MUST 保持 `null`；missing field MUST 使用 Rust/frontend 对齐的 default，不能把两者混为同一语义。
- 新增无默认键位的 action 使用 `string | null` / `Option<String>`，两端 default 均为 `null` / `None`。

### 4. Validation & Error Matrix

| 输入状态 | Rust deserialize | backend echo | UI 行为 |
|---|---|---|---|
| custom string | `Some(value)` | 相同 string | 保留用户设置 |
| explicit `null` | `None` | `null` | 保持未绑定 |
| missing + 有默认值 | `default_*()` | 默认 shortcut | 展示默认值 |
| missing + 无默认值 | `None` | `null` | 展示空绑定 |
| frontend-only field | 禁止进入交付 | 字段会丢失 | 必须由 round-trip test 阻断 |
| malformed JSON/type | 返回 deserialize error | 不写盘 | 禁止用 defaults 静默覆盖用户文件 |

### 5. Good / Base / Bad Cases

- Good：`toggleGitGraphShortcut: "CmdOrCtrl+Shift+G"` 保存后 backend echo 同值，重启后仍保持。
- Base：`openBrowserDockShortcut: null` round-trip 后仍为 `null`。
- Bad：只在 `src/types/settings.ts` 和 UI metadata 增加字段；Rust 未声明该字段，`serde` 默认忽略 unknown field，保存响应把 draft 还原。

### 6. Tests Required

- Rust round-trip test MUST 构造包含全部 frontend shortcut keys 的 JSON；断言 serialize 后 key 集合完整、custom string 不变、explicit `null` 不变。
- 新 shortcut action MUST 有 frontend dispatch test，覆盖 happy path、`null` no-op、editable target protection。
- settings UI MUST 断言 setting key 只映射到一个 draft key；featured group 可复用 action metadata，但不得创建第二份 persisted state。
- 交付前 MUST 通过：

```bash
cargo test app_settings_round_trips_all_frontend_shortcut_fields --manifest-path src-tauri/Cargo.toml
npm run typecheck
npm run check:runtime-contracts
```

### 7. Wrong vs Correct

#### Wrong

```ts
// 只改 frontend；Rust deserialize/save/serialize 会丢弃字段。
type AppSettings = {
  toggleGitGraphShortcut: string | null;
};
```

#### Correct

```rust
#[serde(default, rename = "toggleGitGraphShortcut")]
pub toggle_git_graph_shortcut: Option<String>,

// AppSettings::default()
toggle_git_graph_shortcut: None,
```

## 性能规则

- CPU/IO 重任务使用 `tokio::task::spawn_blocking`。
- 不在锁内做重计算或外部命令调用。

## Scenario: Create-Only Managed File MUST Use Exclusive Create

### 1. Scope / Trigger

- Trigger：command/API 语义是“目标不存在才创建，重名拒绝”，例如 `claude_command_create` 写入 workspace managed `<name>.md`。
- 目标：并发请求不得穿透 `exists()` preflight 后互相覆盖。

### 2. Signatures

- Command：`claude_command_create(workspace_id, name, content) -> Result<ClaudeCommandEntry, String>`。
- File owner：`write_managed_command(dir: &Path, name: &str, content: &str)`。
- Filesystem primitive：`OpenOptions::new().write(true).create_new(true).open(path)`。

### 3. Contracts

- MUST 先确保 parent directory 存在，再在 target file 上执行 exclusive create。
- `ErrorKind::AlreadyExists` MUST 映射为稳定 duplicate error，MUST NOT 打开并覆盖原文件。
- create 成功后的 write failure MUST 显式返回，并 best-effort 删除本次创建的 partial file。
- 仅“更新/替换既有文件”语义才允许 atomic temp-file + rename；不得把 replace primitive 用于 create-only API。

### 4. Validation & Error Matrix

| Filesystem 结果 | API 结果 | 磁盘状态 |
|---|---|---|
| target absent + write success | success | 完整新文件 |
| target already exists | duplicate error | 原内容不变 |
| concurrent same-name creates | exactly one success | winner 内容不被覆盖 |
| exclusive create success + write failure | write error | partial file best-effort removed |
| parent create failure | create-dir error | 不尝试 target write |

### 5. Good / Base / Bad Cases

- Good：duplicate safety 由 filesystem `create_new(true)` 保证，可跨 thread/process。
- Base：不同 name 并发创建互不阻塞。
- Bad：`if path.exists() { return Err(...) }` 后调用 `fs::write(path, ...)`；两个 caller 可同时通过 check。

### 6. Tests Required

- 顺序 duplicate test MUST 断言第二次失败且第一版内容不变。
- 并发 test MUST 通过 barrier 同时创建同名文件，断言一成功、一 duplicate error、最终内容属于 winner。
- Focused gate：`cargo test --manifest-path src-tauri/Cargo.toml claude_commands --lib`。

### 7. Wrong vs Correct

#### Wrong

```rust
if path.exists() {
    return Err("already exists".to_string());
}
fs::write(path, content)?;
```

#### Correct

```rust
let mut file = OpenOptions::new()
    .write(true)
    .create_new(true)
    .open(&path)?;
file.write_all(content.as_bytes())?;
```

## 测试建议

- 覆盖并发写、锁冲突、stale lock、损坏 JSON、fallback default 场景。

## Scenario: SQLite WAL Crash Recovery Probe MUST Distinguish Access Mode From Corruption

### 1. Scope / Trigger

- Trigger：修改 `src-tauri/src/shared_event_log/recovery.rs::open()`、SQLite WAL startup probe、`ReadOnlyRecovery` classification 或 crash harness。
- 目标：unclean shutdown 后 hot WAL 需要内部 recovery 时，纯 read-only `quick_check` 的 `SQLITE_READONLY` 不能被误判为 logical corruption；真实损坏仍须 fail closed。

### 2. Signatures

- startup owner：`shared_event_log::recovery::open(path: &Path) -> Result<OpenOutcome, StoreError>`
- primary probe：`probe_integrity(path: &Path) -> Result<(), RecoveryReason>`
- fallback opener：`open_wal_recovery_probe(path: &Path) -> Result<Connection, RecoveryReason>`
- typed classification：`is_readonly_sqlite_error(error: &rusqlite::Error) -> bool`

### 3. Contracts

- Existing non-empty DB MUST 先用 `SQLITE_OPEN_READ_ONLY` 执行 `PRAGMA quick_check(1)`。
- 只有 base SQLite code 为 `ErrorCode::ReadOnly` 时，MAY fallback；禁止按英文 message substring 或所有 query error 宽泛 fallback。
- Fallback MUST 使用 `SQLITE_OPEN_READ_WRITE` 且 MUST NOT 带 `SQLITE_OPEN_CREATE`，随后在任何 integrity SQL 前设置 `PRAGMA query_only = ON`。
- `query_only` 禁止 application SQL mutation；SQLite pager 为恢复 WAL journal/sidecar 执行的内部 I/O 不得被当作业务写入。
- `CORRUPT`、`NOTADB`、`BUSY`、`LOCKED`、fallback open/config/check failure MUST 继续返回 `IntegrityCheckFailed`，由 `open()` 进入 `ReadOnlyRecovery`；原 DB 禁止删除、重命名或覆盖。

### 4. Validation & Error Matrix

| Primary read-only probe | Fallback | Result |
|---|---|---|
| `ok` | 不执行 | writable `Ready` |
| non-`ok` integrity row | 不执行 | `ReadOnlyRecovery` |
| `SQLITE_READONLY` | RW/no-create + query-only `ok` | writable `Ready` |
| `SQLITE_READONLY` | fallback failure / non-`ok` | `ReadOnlyRecovery` with both contexts |
| `CORRUPT` / `NOTADB` / other error | 不执行 | `ReadOnlyRecovery` |
| path missing | 不走 existing-file probe | normal fresh-create path owns creation |

### 5. Good / Base / Bad Cases

- Good：macOS runner kill 后 read-only probe 返回 `attempt to write a readonly database`；typed `ReadOnly` fallback 恢复 WAL，`quick_check` 通过，restart 保留 committed facts。
- Base：clean existing DB 的 read-only probe 直接 `ok`，不升级权限。
- Bad：任何 `quick_check` error 都用 writable connection 再试；这会弱化 corruption fail-closed boundary。
- Bad：fallback 复用 `Connection::open()`；默认 flags 包含 `CREATE`，可能在 path race 中创建空库。

### 6. Tests Required

- Unit MUST assert only `ErrorCode::ReadOnly` matches fallback classification。
- Unit MUST assert fallback missing path 返回 error 且不创建 DB。
- Unit MUST assert fallback connection 的 `query_only=1`，并拒绝 test INSERT。
- Integration MUST run `shared_event_log_crash`：transaction boundaries + randomized kills ≥50，断言 `quick_check=ok`、sequence 连续、ack replay idempotent。
- Integration MUST keep damaged-database test，断言 corruption 仍进入 read-only recovery 且文件未覆盖。

### 7. Wrong vs Correct

#### Wrong

```rust
// READ_ONLY 可能只是无法完成 hot WAL recovery；不能直接判 corruption。
let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
conn.query_row("PRAGMA quick_check(1)", [], |row| row.get(0))?;
```

#### Correct

```rust
match quick_check(&read_only_conn) {
    Err(error) if is_readonly_sqlite_error(&error) => {
        let conn = open_wal_recovery_probe(path)?; // READ_WRITE, no CREATE, query_only=ON
        require_quick_check_ok(&conn)
    }
    result => require_quick_check_ok_result(result),
}
```
