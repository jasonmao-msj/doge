# doge Storage and Serialized Compatibility Contract

## Scenario: destination-wins copy-forward with doge-only new writes

### 1. Scope / Trigger

- Trigger: 修改 app home、bundle app-data、project-local metadata、localStorage key、daemon/token、MIME/context marker、feature env 或 provider alias。
- 目标：fresh install 只写 doge namespace；历史数据仍可读取/迁移；迁移不删除旧数据且不泄露 secret/path/content。

### 2. Signatures

- `app_home_dir() -> Result<PathBuf, String>`
- `prepare_app_data_dir(current_data_dir: &Path) -> Result<(), String>`
- `project_local_data_dir(workspace_root: &Path, relative_path: &str) -> Result<PathBuf, String>`
- `migrateLocalStorage(): void`
- Sentinel：`{ schemaVersion: 1, source: string, migratedAtMs: number }`
- Current context markers：`DOGE_CONTEXT_PACKAGE`、`DOGE_NATIVE_CONTEXT_V1`、`DOGE_SHARED_CONTEXT_V1`、`dogeDispatchReceipt`。

### 3. Contracts

- Current roots MUST be `~/.doge`、doge bundle app-data、workspace `.doge/*`；candidate priority starts with the immediate predecessor, then older roots。
- Existing doge destination MUST win；migration MUST copy forward once and MUST NOT move/delete source。
- App-data candidate JSON MUST be a regular file and parse successfully；`workspaces`/`models` candidate MUST be a directory。Empty/corrupt/non-app candidates MUST be skipped。
- Project-local relative path MUST reject absolute、parent/current traversal components。
- Sentinel MUST contain only schema version、bounded relative source kind、timestamp；MUST NOT contain absolute path、file content、API key or token。
- New producers MUST write `doge`/`DOGE_*` namespace。Legacy `ccgui`/`mossx`/`codemoss`/`MOSSX_*` values MAY be read for migration, cleanup or exact legacy round-trip only。
- Compatibility writers MUST be explicit exceptions：old LSP owner lock for concurrent old/new client exclusion、external `codemossProviderId` schema、legacy MOSSX continuation only when input package is already legacy。
- Fresh runtime temporary paths MUST use doge names, including Gemini inline images and macOS icon conversion。

### 4. Validation & Error Matrix

| 输入状态 | 必须结果 | 禁止行为 |
|---|---|---|
| fresh install | resolve doge path, no legacy write | create legacy directory/key |
| legacy only | copy to doge + sentinel | move/delete source |
| doge + legacy | preserve doge | merge-overwrite destination |
| corrupt/empty first candidate | skip to next valid candidate | let corrupt source claim priority |
| repeat migration | identical destination/sentinel semantics | duplicate or overwrite data |
| fixture contains fake secret | copied payload allowed; sentinel/error redacted | serialize secret/path/content |
| legacy serialized fixture | reader accepts; next fresh record uses doge | rewrite fresh record with legacy marker |

### 5. Good / Base / Bad Cases

- Good：`.ccgui` is copied to `.doge`，destination already present is untouched，sentinel records only `.ccgui`。
- Base：old context package resumes in its original namespace while every new package is DOGE。
- Bad：new Gemini attachment writes `.moss-x-*`，或 migration log prints the migrated config body。

### 6. Tests Required

- `cargo test --manifest-path src-tauri/Cargo.toml --lib app_paths::tests`
- `npx vitest run src/services/migrateLocalStorage.test.ts src/utils/contextProtocol.test.ts`
- Focused Rust：`shared_context`、`native_continuation`、`shared_session_v2`、native skill mirror、web assets、LSP、daemon identity。
- Assertions MUST cover fresh、every supported legacy family、multiple candidates、destination wins、idempotence、corrupt/empty candidate、secret redaction、doge round-trip + legacy read。

### 7. Wrong vs Correct

#### Wrong

```rust
let root = home.join(".legacy-product");
fs::rename(legacy, root)?;
```

#### Correct

```rust
let current = home.join(".doge");
if current.exists() {
    return Ok(current);
}
copy_dir_recursive(&legacy, &current)?;
write_migration_sentinel(&current, ".ccgui")?;
```
