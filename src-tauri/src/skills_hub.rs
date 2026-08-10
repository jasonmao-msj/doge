//! TokenTracker skills 后端的逐语义 Rust 移植（有意的单文件模块，对照上游单文件 `skills-manager.js`）。
//!
//! 上游对照：
//! - `TokenTracker/src/lib/skills-manager.js`：registry / install / discover / updates / trash /
//!   activity / targets sync 等全部核心逻辑。
//! - `TokenTracker/src/lib/skill-usage.js`：`~/.claude/projects/**/*.jsonl` 的 Skill 调用统计。
//! - `TokenTracker/src/lib/local-api.js` 的 `/functions/tokentracker-skills` 端点（GET/POST 分发），
//!   对应本文件底部的 [`skills_hub_query`] / [`skills_hub_mutate`]。
//!
//! 与 upstream 的故意偏差（仅 4 条）：
//! 1. SSOT 根目录为 `~/.doge/skills`（可用 env `DOGE_SKILLS_HOME` 覆盖，便于测试隔离），upstream
//!    是 `~/.tokentracker/skills`；子布局一致（managed/ .trash/ tmp/ registry.json discover-cache.json
//!    updates-cache.json popular-cache.json activity.jsonl usage-cache.json）。
//! 2. skill_usage 响应不输出 cost 与 models（定价表不移植）。
//! 3. 排序使用 Rust codepoint 序（`Ord`），upstream 用 `String.localeCompare`（本地化排序）。
//! 4. 不移植 local-auth token / loopback origin 校验（Tauri IPC 天然可信）。
//!
//! 注：registry 条目的 sourceSignature 为 null 时省略该字段——这是移植契约的规定行为
//! （upstream 会写出 `"sourceSignature": null`），不属于额外偏差。

use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::app_paths;

// ===== 常量（与 upstream skills-manager.js / skill-usage.js 对齐） =====

const FETCH_TIMEOUT: Duration = Duration::from_secs(20); // upstream FETCH_TIMEOUT_MS
const DISCOVER_CONCURRENCY: usize = 4; // upstream DISCOVER_CONCURRENCY
const DISCOVER_CACHE_TTL_MS: i64 = 60 * 60 * 1000; // 1 小时
const UPDATE_CACHE_TTL_MS: i64 = 60 * 60 * 1000; // 1 小时
const UPDATE_CHECK_CONCURRENCY: usize = 2; // upstream UPDATE_CHECK_CONCURRENCY
const POPULAR_CACHE_TTL_MS: i64 = 6 * 60 * 60 * 1000; // 6 小时
const TRASH_TTL_MS: i64 = 5 * 60 * 1000; // 5 分钟
const ACTIVITY_MAX: usize = 500; // upstream ACTIVITY_MAX
const ACTIVITY_TRIM_BYTES: u64 = 256 * 1024; // 超过则截尾保留最后 ACTIVITY_MAX 行
const USAGE_CACHE_TTL_MS: i64 = 10 * 60 * 1000; // 10 分钟
const MAX_LOCAL_SKILL_SCAN_DEPTH: usize = 3; // upstream MAX_LOCAL_SKILL_SCAN_DEPTH
const DISCOVER_MAX_SKILLS_PER_REPO: usize = 200; // upstream discover 单 repo 截断 200
const POPULAR_SEED_QUERIES: [&str; 12] = [
    "agent", "code", "test", "review", "git", "web", "design", "data", "docs", "python", "api",
    "deploy",
];
const HASH_IGNORE: [&str; 4] = [".git", ".DS_Store", "Thumbs.db", ".gitignore"];

// ===== 错误类型：RateLimit 需要在 allSettled 语义里被单独识别并上抛 =====

#[derive(Debug)]
enum SkillError {
    /// GitHub / skills.sh 限流（HTTP 429|403），文案必须与 upstream 一致。
    RateLimited(String),
    Other(String),
}

impl SkillError {
    fn other(message: impl Into<String>) -> Self {
        Self::Other(message.into())
    }
    fn is_rate_limited(&self) -> bool {
        matches!(self, Self::RateLimited(_))
    }
}

impl std::fmt::Display for SkillError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::RateLimited(m) | Self::Other(m) => write!(f, "{m}"),
        }
    }
}

impl std::error::Error for SkillError {}

impl From<std::io::Error> for SkillError {
    fn from(error: std::io::Error) -> Self {
        Self::Other(error.to_string())
    }
}

type SkillResult<T> = Result<T, SkillError>;

// ===== 路径解析：SSOT 根目录（可注入）与 8 个 sync target =====

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn home_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"))
}

/// SSOT 根目录：`DOGE_SKILLS_HOME` 覆盖；旧 `CCGUI_SKILLS_HOME` 仅兼容读取。
/// 缺省路径由 app-home migration 统一解析为 `~/.doge/skills`。
fn skills_root() -> PathBuf {
    for env_name in ["DOGE_SKILLS_HOME", "CCGUI_SKILLS_HOME"] {
        if let Some(override_dir) = std::env::var_os(env_name) {
            if !override_dir.is_empty() {
                return PathBuf::from(override_dir);
            }
        }
    }
    app_paths::app_home_dir()
        .unwrap_or_else(|_| home_dir().join(".doge"))
        .join("skills")
}

fn registry_path() -> PathBuf {
    skills_root().join("registry.json")
}
fn ssot_dir() -> PathBuf {
    skills_root().join("managed")
}
fn trash_dir() -> PathBuf {
    skills_root().join(".trash")
}
fn tmp_dir() -> PathBuf {
    skills_root().join("tmp")
}
fn discover_cache_path() -> PathBuf {
    skills_root().join("discover-cache.json")
}
fn updates_cache_path() -> PathBuf {
    skills_root().join("updates-cache.json")
}
fn popular_cache_path() -> PathBuf {
    skills_root().join("popular-cache.json")
}
fn activity_path() -> PathBuf {
    skills_root().join("activity.jsonl")
}
fn usage_cache_path() -> PathBuf {
    skills_root().join("usage-cache.json")
}

/// 对应 upstream grok-hook.js 的 resolveGrokHome：
/// `$TOKENTRACKER_GROK_HOME` → `$GROK_HOME` → `~/.grok`。
fn resolve_grok_home() -> PathBuf {
    if let Ok(value) = std::env::var("TOKENTRACKER_GROK_HOME") {
        if !value.is_empty() {
            return PathBuf::from(value);
        }
    }
    if let Ok(value) = std::env::var("GROK_HOME") {
        if !value.is_empty() {
            return PathBuf::from(value);
        }
    }
    home_dir().join(".grok")
}

fn is_dir(path: &Path) -> bool {
    fs::metadata(path)
        .map(|meta| meta.is_dir())
        .unwrap_or(false)
}

/// 对应 upstream antigravity-paths.js 的 resolveAntigravitySkillDirs。
fn resolve_antigravity_skill_dirs() -> Vec<PathBuf> {
    if let Ok(value) = std::env::var("TOKENTRACKER_ANTIGRAVITY_HOME") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return vec![PathBuf::from(trimmed).join("skills")];
        }
    }
    let home = std::env::var_os("HOME")
        .filter(|v| !v.is_empty())
        .or_else(|| std::env::var_os("USERPROFILE").filter(|v| !v.is_empty()))
        .map(PathBuf::from)
        .unwrap_or_else(home_dir);
    let gemini_home = home.join(".gemini");
    let main_skills = gemini_home.join("antigravity").join("skills");
    let ide_skills = gemini_home.join("antigravity-ide").join("skills");
    let mut dirs = Vec::new();
    if is_dir(&gemini_home.join("antigravity")) {
        dirs.push(main_skills.clone());
    }
    if is_dir(&gemini_home.join("antigravity-ide")) {
        dirs.push(ide_skills);
    }
    if dirs.is_empty() {
        vec![main_skills]
    } else {
        dirs
    } // 都不存在时回退 main，保证 targetList 稳定
}

/// 8 个 sync target 的目录种类；目录在调用时按 env/home 动态解析。
enum TargetKind {
    Claude,
    Codex,
    Grok,
    Antigravity,
    Gemini,
    Opencode,
    Hermes,
    Agents,
}

struct Target {
    id: &'static str,
    label: &'static str,
    visible: bool, // visible=false 不进 targetList，但参与全部 sync/scan/classify
    kind: TargetKind,
}

/// 与 upstream TARGETS 顺序固定一致。
static TARGETS: [Target; 8] = [
    Target {
        id: "claude",
        label: "Claude",
        visible: true,
        kind: TargetKind::Claude,
    },
    Target {
        id: "codex",
        label: "Codex",
        visible: true,
        kind: TargetKind::Codex,
    },
    Target {
        id: "grok",
        label: "Grok",
        visible: true,
        kind: TargetKind::Grok,
    },
    Target {
        id: "antigravity",
        label: "Antigravity",
        visible: true,
        kind: TargetKind::Antigravity,
    },
    Target {
        id: "gemini",
        label: "Gemini",
        visible: true,
        kind: TargetKind::Gemini,
    },
    Target {
        id: "opencode",
        label: "OpenCode",
        visible: true,
        kind: TargetKind::Opencode,
    },
    Target {
        id: "hermes",
        label: "Hermes",
        visible: true,
        kind: TargetKind::Hermes,
    },
    Target {
        id: "agents",
        label: "Agents",
        visible: false,
        kind: TargetKind::Agents,
    },
];

fn target_by_id(id: &str) -> Option<&'static Target> {
    TARGETS.iter().find(|target| target.id == id)
}

/// 对应 upstream targetDirs：单目录 target 返回 1 个，多目录 target（Antigravity）返回多个。
fn target_dirs(target: &Target) -> Vec<PathBuf> {
    let home = home_dir();
    match target.kind {
        TargetKind::Claude => vec![home.join(".claude").join("skills")],
        TargetKind::Codex => vec![home.join(".codex").join("skills")],
        TargetKind::Grok => vec![resolve_grok_home().join("skills")],
        TargetKind::Antigravity => resolve_antigravity_skill_dirs(),
        TargetKind::Gemini => vec![home.join(".gemini").join("skills")],
        TargetKind::Opencode => vec![home.join(".config").join("opencode").join("skills")],
        TargetKind::Hermes => vec![home.join(".hermes").join("skills")],
        TargetKind::Agents => vec![home.join(".agents").join("skills")],
    }
}

/// 对应 upstream targetPrimaryDir（多目录 target 取第一个用于 UI 展示）。
fn target_primary_dir(target: &Target) -> PathBuf {
    target_dirs(target).into_iter().next().unwrap_or_default()
}

/// 对应 upstream targetList：仅 visible target。
fn target_list() -> Vec<Value> {
    TARGETS
        .iter()
        .filter(|target| target.visible)
        .map(|t| json!({"id": t.id, "label": t.label, "path": target_primary_dir(t).to_string_lossy()}))
        .collect()
}

// ===== 小工具：JSON / fs / 编码 / JS 语义兼容 =====

fn read_text(path: &Path) -> Option<String> {
    fs::read(path)
        .ok()
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

fn read_json(path: &Path) -> Option<Value> {
    read_text(path).and_then(|text| serde_json::from_str(&text).ok())
}

fn ensure_dir(path: &Path) -> std::io::Result<()> {
    fs::create_dir_all(path)
}

/// unix 下把文件权限收紧到 0o600（registry/cache/activity 共用）；Windows 退化为 no-op。
fn set_private_permissions(path: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

/// 以 unix 0o600 权限写文件（Windows 下退化为普通写；registry/cache/activity 共用）。
fn write_file_private(path: &Path, contents: &str) -> std::io::Result<()> {
    fs::write(path, contents)?;
    set_private_permissions(path)
}

/// upstream writeJson：pretty 2 空格 + 尾换行 + 0o600。
fn write_json(path: &Path, value: &Value) -> SkillResult<()> {
    if let Some(parent) = path.parent() {
        ensure_dir(parent)?;
    }
    let mut text =
        serde_json::to_string_pretty(value).map_err(|e| SkillError::other(e.to_string()))?;
    text.push('\n');
    write_file_private(path, &text).map_err(SkillError::from)
}

/// 追加一行（activity.jsonl 用），创建时 0o600。
fn append_line_private(path: &Path, line: &str) -> std::io::Result<()> {
    use std::io::Write;
    let mut options = fs::OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(line.as_bytes())?;
    set_private_permissions(path)
}

fn is_symlink(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|meta| meta.file_type().is_symlink())
        .unwrap_or(false)
}

/// upstream removePath：entity 或 dangling symlink 存在才删除，递归 force、吞错。
fn remove_path(path: &Path) {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return;
    };
    if meta.file_type().is_symlink() || !meta.is_dir() {
        let _ = fs::remove_file(path);
    } else {
        let _ = fs::remove_dir_all(path);
    }
}

/// 类似 Node `path.resolve`：拼成绝对路径并做词法归一（不解 symlink、不触盘）。
fn resolve_lexical(path: &Path) -> PathBuf {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("/"))
            .join(path)
    };
    let mut out = PathBuf::new();
    for component in absolute.components() {
        match component {
            Component::Prefix(prefix) => out.push(prefix.as_os_str()),
            Component::RootDir => out.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop(); // root 处的 `..` 归一时丢弃（root 上 pop 返回 false）
            }
            Component::Normal(part) => out.push(part),
        }
    }
    out
}

/// 对应 upstream pathStrictlyWithin：child 必须严格位于 parent 之内（词法判定）。
fn path_strictly_within(parent: &Path, child: &Path) -> bool {
    match child.strip_prefix(parent) {
        Ok(rest) => !rest.as_os_str().is_empty(),
        Err(_) => false,
    }
}

/// upstream removeEmptyAncestors：从 startDir 逐级向上删空目录直到 stopDir。
fn remove_empty_ancestors(start_dir: &Path, stop_dir: &Path) {
    let stop = resolve_lexical(stop_dir);
    let mut current = resolve_lexical(start_dir);
    while path_strictly_within(&stop, &current) {
        if fs::remove_dir(&current).is_err() {
            return;
        }
        let Some(parent) = current.parent() else {
            return;
        };
        current = parent.to_path_buf();
    }
}

/// 对应 fs.cpSync(source, dest, {recursive, force})（默认 follow symlink）。
fn copy_dir_recursive(source: &Path, dest: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dest)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let target = dest.join(entry.file_name());
        let meta = fs::metadata(entry.path())?;
        if meta.is_dir() {
            copy_dir_recursive(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

/// upstream copyDir：先防嵌套、清空 dest，再整目录递归 copy。
fn copy_dir(source: &Path, dest: &Path) -> SkillResult<()> {
    assert_not_nested(source, dest)?;
    remove_path(dest);
    copy_dir_recursive(source, dest).map_err(SkillError::from)
}

/// 平台 symlink（目录）；任何失败由调用方回退到 copy。
fn symlink_dir(source: &Path, dest: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    return std::os::unix::fs::symlink(source, dest);
    #[cfg(windows)]
    return std::os::windows::fs::symlink_dir(source, dest);
    #[cfg(not(any(unix, windows)))]
    unreachable!("unsupported platform")
}

/// JS `encodeURIComponent`：保留 A-Za-z0-9 与 `- _ . ! ~ * ' ( )`。
fn encode_uri_component(value: &str) -> String {
    const UNRESERVED: &[u8] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()";
    let mut out = String::new();
    for byte in value.as_bytes() {
        if UNRESERVED.contains(byte) {
            out.push(*byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// URLSearchParams 的 form-urlencoded：空格 → `+`，保留 A-Za-z0-9 与 `* - . _`。
fn encode_form_param(value: &str) -> String {
    const KEEP: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789*-._";
    let mut out = String::new();
    for byte in value.as_bytes() {
        if KEEP.contains(byte) {
            out.push(*byte as char);
        } else if *byte == b' ' {
            out.push('+');
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// GitHub raw/doc URL 的 path 部分逐段 encodeURIComponent。
fn encode_url_path(path: &str) -> String {
    path.split('/')
        .map(encode_uri_component)
        .collect::<Vec<_>>()
        .join("/")
}
fn github_raw_url(owner: &str, name: &str, branch: &str, file_path: &str) -> String {
    format!(
        "https://raw.githubusercontent.com/{owner}/{name}/{branch}/{}",
        encode_url_path(file_path)
    )
}
fn github_doc_url(owner: &str, name: &str, branch: &str, file_path: &str) -> String {
    format!(
        "https://github.com/{owner}/{name}/blob/{branch}/{}",
        encode_url_path(file_path)
    )
}

/// uninstall trash 名：`base64url(directory, 无 padding)`。
fn base64url_no_pad(value: &str) -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(value.as_bytes())
}

/// 近似 JS `String(value)`：null/missing → ""，基本类型转字符串，object/array → ""。
fn js_string(value: Option<&Value>) -> String {
    match value {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::Array(_)) | Some(Value::Object(_)) => String::new(),
    }
}

/// 近似 JS `Number(value)`：string 先 trim，空串 → 0，非法 → NaN。
fn js_f64(value: &Value) -> f64 {
    match value {
        Value::Null => 0.0,
        Value::Bool(b) => {
            if *b {
                1.0
            } else {
                0.0
            }
        }
        Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        Value::String(s) => {
            let t = s.trim();
            if t.is_empty() {
                0.0
            } else {
                t.parse::<f64>().unwrap_or(f64::NAN)
            }
        }
        _ => f64::NAN,
    }
}

/// 对应 JS `Number(x || default)`：falsy（missing/null/false/0/""/NaN）→ default。
fn js_number_or(value: Option<&Value>, default: f64) -> f64 {
    match value {
        None | Some(Value::Null) => default,
        Some(v) => {
            let n = js_f64(v);
            if n == 0.0 || n.is_nan() {
                default
            } else {
                n
            }
        }
    }
}

/// JS Number 的 JSON 序列化：整数值输出为整数（避免 serde_json 把 5.0 打成 "5.0"）。
fn json_number(n: f64) -> Value {
    if n.fract() == 0.0 && n.abs() <= 9.0e15 {
        json!(n as i64)
    } else {
        json!(n)
    }
}

/// JS 的 Unicode 大小写不敏感比较（`a.toLowerCase() === b.toLowerCase()`）。
fn eq_ignore_case(a: &str, b: &str) -> bool {
    a.to_lowercase() == b.to_lowercase()
}

// ===== 安全函数：sanitize 三件套 + targetSkillPath + assertNotNested =====

/// upstream sanitizePathSegment：拒空/`.`/`..`/含 `/` `\` `\0`；允许 `.hidden`。
fn sanitize_path_segment(value: &str) -> Option<String> {
    let segment = value.trim();
    if segment.is_empty() || segment == "." || segment == ".." {
        return None;
    }
    if segment.contains('/') || segment.contains('\\') || segment.contains('\0') {
        return None;
    }
    Some(segment.to_string())
}

/// Node `path.win32.isAbsolute`：以 `/` 或 `\` 开头，或 `X:` 后接分隔符。
fn is_win32_absolute(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.is_empty() {
        return false;
    }
    if bytes[0] == b'/' || bytes[0] == b'\\' {
        return true;
    }
    bytes.len() > 2
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'/' || bytes[2] == b'\\')
}

/// upstream sanitizeRelativePath：`\`→`/`，拒绝对路径/NUL/`.`/`..`/含 `:` 段。
fn sanitize_relative_path(value: &str) -> Option<String> {
    let input = value.trim();
    let raw = input.replace('\\', "/");
    if raw.is_empty() || raw.contains('\0') {
        return None;
    }
    if raw.starts_with('/') || is_win32_absolute(input) || is_win32_absolute(&raw) {
        return None;
    }
    let parts: Vec<&str> = raw.split('/').filter(|part| !part.is_empty()).collect();
    if parts.is_empty()
        || parts
            .iter()
            .any(|part| *part == "." || *part == ".." || part.contains(':'))
    {
        return None;
    }
    Some(parts.join("/"))
}

/// upstream sanitizeLocalSkillPath = sanitizeRelativePath + 拒任何 `.` 开头段。
fn sanitize_local_skill_path(value: &str) -> Option<String> {
    let safe = sanitize_relative_path(value)?;
    if safe.split('/').any(|part| part.starts_with('.')) {
        return None;
    }
    Some(safe)
}

/// upstream installNameFromDirectory：末段再过 sanitizePathSegment。
fn install_name_from_directory(directory: &str) -> Option<String> {
    let safe = sanitize_relative_path(directory)?;
    safe.rsplit('/').next().and_then(sanitize_path_segment)
}

/// upstream targetSkillPath：词法归一 + 严格内含 + 中间祖先 lstat 校验。
fn target_skill_path(base_dir: &Path, directory: &str) -> Option<PathBuf> {
    let safe = sanitize_relative_path(directory)?;
    let root = resolve_lexical(base_dir);
    let target = resolve_lexical(&root.join(&safe));
    if !path_strictly_within(&root, &target) {
        return None;
    }
    // root 若存在必须是目录；ENOENT 放行。
    match fs::metadata(&root) {
        Ok(meta) if meta.is_dir() => {}
        Ok(_) => return None,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return None,
    }
    // safe 的中间祖先逐段 lstat：ENOENT 继续，symlink 或非目录 → None。
    let parts: Vec<&str> = safe.split('/').collect();
    let mut current = root.clone();
    for part in &parts[..parts.len() - 1] {
        current = current.join(part);
        match fs::symlink_metadata(&current) {
            Ok(meta) if !meta.file_type().is_symlink() && meta.is_dir() => {}
            Ok(_) => return None,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return None,
        }
    }
    Some(target)
}

/// upstream managedSkillPath：SSOT managed/ 下的目标路径。
fn managed_skill_path(directory: &str) -> SkillResult<PathBuf> {
    target_skill_path(&ssot_dir(), directory)
        .ok_or_else(|| SkillError::other(format!("Invalid skill directory: {directory}")))
}

/// upstream assertNotNested：resolve 后相等放行，互为严格祖先则拒绝。
fn assert_not_nested(source: &Path, dest: &Path) -> SkillResult<()> {
    let a = resolve_lexical(source);
    let b = resolve_lexical(dest);
    if a == b {
        return Ok(());
    }
    if path_strictly_within(&a, &b) || path_strictly_within(&b, &a) {
        return Err(SkillError::other(
            "Refusing to sync a skill into its own directory tree",
        ));
    }
    Ok(())
}

// ===== frontmatter / marker / 本地扫描 =====

/// upstream readYamlField：inline（可带一层引号）+ block scalar（`|`/`>`，可带 `+`/`-`）。
fn read_yaml_field(yaml: &str, key: &str) -> String {
    let lines: Vec<&str> = yaml.split('\n').collect();
    for (i, line) in lines.iter().enumerate() {
        let indent = line.chars().take_while(|c| c.is_whitespace()).count();
        let trimmed_start = line.trim_start();
        // header 形如 `^(\s*)key:[ \t]*(.*)$`：key 后必须紧跟冒号。
        let Some(after_key) = trimmed_start.strip_prefix(key) else {
            continue;
        };
        let Some(after_colon) = after_key.strip_prefix(':') else {
            continue;
        };
        let inline = after_colon.trim_start_matches([' ', '\t']).trim();
        if matches!(inline, ">" | "|" | ">+" | ">-" | "|+" | "|-") {
            // block scalar：收集后续缩进更深的行，dedent 结束。
            let mut collected: Vec<String> = Vec::new();
            for next in &lines[i + 1..] {
                if next.trim().is_empty() {
                    collected.push(String::new());
                    continue;
                }
                if next.chars().take_while(|c| c.is_whitespace()).count() <= indent {
                    break; // dedent 结束
                }
                collected.push(next.trim().to_string());
            }
            return collected.join(" ");
        }
        // 剥一层首尾引号。
        let mut out = inline;
        if out.starts_with('"') || out.starts_with('\'') {
            out = &out[1..];
        }
        if (out.ends_with('"') || out.ends_with('\'')) && !out.is_empty() {
            out = &out[..out.len() - 1];
        }
        return out.to_string();
    }
    String::new()
}

/// 对应 upstream 的 `/^---\s*\n([\s\S]*?)\n---/` frontmatter 提取。
fn extract_frontmatter(raw: &str) -> Option<&str> {
    let rest = raw.strip_prefix("---")?;
    // `\s*\n`：前导空白 run 内必须有 `\n`（取 run 中最后一个 `\n` 之后）。
    let ws_len: usize = rest
        .char_indices()
        .take_while(|(_, c)| c.is_whitespace())
        .map(|(i, c)| i + c.len_utf8())
        .last()
        .unwrap_or(0);
    let newline = rest[..ws_len].rfind('\n')?;
    let content = &rest[newline + 1..];
    let end = content.find("\n---")?;
    Some(&content[..end])
}

struct SkillMetadata {
    name: String,
    description: String,
}

/// upstream readSkillMetadata：frontmatter 优先，name fallback，description 折叠空白。
fn read_skill_metadata(markdown: &str, fallback_name: &str) -> SkillMetadata {
    let source = extract_frontmatter(markdown).unwrap_or(markdown);
    let name_field = read_yaml_field(source, "name");
    let name = if !name_field.is_empty() {
        name_field
    } else if !fallback_name.is_empty() {
        fallback_name.to_string()
    } else {
        "Skill".to_string()
    };
    let description = read_yaml_field(source, "description")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    SkillMetadata {
        name: name.trim().to_string(),
        description,
    }
}

/// upstream findSkillMarker：SKILL.md（优先大写）或 skill.md，stat 为 file 才算。
fn find_skill_marker(dir: &Path) -> Option<PathBuf> {
    for name in ["SKILL.md", "skill.md"] {
        let candidate = dir.join(name);
        if fs::metadata(&candidate)
            .map(|meta| meta.is_file())
            .unwrap_or(false)
        {
            return Some(candidate);
        }
    }
    None
}

/// upstream scanSkillDirectories：深度 ≤3 递归，不进 symlink 目录、跳过 `.` 开头项，
/// 含 SKILL.md/skill.md 的目录记为 skill（返回相对路径）。
fn scan_skill_directories(root_dir: &Path) -> Vec<String> {
    fn walk(dir: &Path, rel_dir: &str, depth: usize, found: &mut Vec<String>) {
        let Ok(read_dir) = fs::read_dir(dir) else {
            return;
        };
        let mut entries: Vec<_> = read_dir.filter_map(|entry| entry.ok()).collect();
        // codepoint 排序（upstream localeCompare 的计划内偏差）。
        entries.sort_by(|a, b| a.file_name().cmp(&b.file_name()));
        for entry in entries {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if !file_type.is_dir() && !file_type.is_symlink() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.is_empty() || name.starts_with('.') {
                continue;
            }
            let rel = if rel_dir.is_empty() {
                name.clone()
            } else {
                format!("{rel_dir}/{name}")
            };
            let full = entry.path();
            if find_skill_marker(&full).is_some() {
                found.push(rel);
                continue;
            }
            // symlink group folder 不递归（保持扫描在 target skills 树内）。
            if file_type.is_dir() && depth + 1 < MAX_LOCAL_SKILL_SCAN_DEPTH {
                walk(&full, &rel, depth + 1, found);
            }
        }
    }
    let mut found = Vec::new();
    walk(root_dir, "", 0, &mut found);
    found
}

// ===== contentHash / sourceSignature =====

#[cfg(unix)]
fn exec_bit_of(meta: &fs::Metadata) -> u8 {
    use std::os::unix::fs::PermissionsExt;
    if meta.permissions().mode() & 0o111 != 0 {
        1
    } else {
        0
    }
}

#[cfg(not(unix))]
fn exec_bit_of(_meta: &fs::Metadata) -> u8 {
    0
}

/// upstream hashDirectory：按 name 排序递归，文件条目为
/// `"<rel>\0<execBit>\0" + 文件字节 + "\0"`；目录不进 hash；stat 失败跳过、
/// 读失败跳过内容但仍加尾部 NUL。
fn hash_directory(dir: &Path) -> String {
    fn walk(base: &Path, rel_dir: &str, hasher: &mut Sha256) {
        let abs_dir = if rel_dir.is_empty() {
            base.to_path_buf()
        } else {
            base.join(rel_dir)
        };
        let Ok(read_dir) = fs::read_dir(&abs_dir) else {
            return;
        };
        let mut entries: Vec<_> = read_dir.filter_map(|entry| entry.ok()).collect();
        entries.sort_by(|a, b| a.file_name().cmp(&b.file_name()));
        for entry in entries {
            let name = entry.file_name().to_string_lossy().into_owned();
            if HASH_IGNORE.contains(&name.as_str()) {
                continue;
            }
            let rel = if rel_dir.is_empty() {
                name.clone()
            } else {
                format!("{rel_dir}/{name}")
            };
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_dir() {
                walk(base, &rel, hasher);
            } else if file_type.is_file() {
                let abs = base.join(&rel);
                let Ok(meta) = fs::metadata(&abs) else {
                    continue;
                };
                let exec_bit = exec_bit_of(&meta);
                hasher.update(format!("{rel}\0{exec_bit}\0"));
                if let Ok(bytes) = fs::read(&abs) {
                    hasher.update(&bytes);
                }
                hasher.update(b"\0");
            }
        }
    }
    let mut hasher = Sha256::new();
    walk(dir, "", &mut hasher);
    format!("{:x}", hasher.finalize())
}

/// upstream sourceSignatureFromTree：tree 中 sourceDir 前缀内 blob 的
/// `"<path>:<sha>"` 排序后 `"\n".join` 的 sha256 hex；无匹配 → None。
fn source_signature_from_tree(tree: &[Value], source_dir: &str) -> Option<String> {
    if source_dir.is_empty() {
        return None;
    }
    let prefix = format!("{source_dir}/");
    let mut rels: Vec<String> = tree
        .iter()
        .filter_map(|entry| {
            if entry.get("type").and_then(Value::as_str) != Some("blob") {
                return None;
            }
            let sha = entry
                .get("sha")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())?;
            let path = entry.get("path").and_then(Value::as_str).unwrap_or("");
            if path == source_dir || path.starts_with(&prefix) {
                Some(format!("{path}:{sha}"))
            } else {
                None
            }
        })
        .collect();
    if rels.is_empty() {
        return None;
    }
    rels.sort();
    let mut hasher = Sha256::new();
    hasher.update(rels.join("\n"));
    Some(format!("{:x}", hasher.finalize()))
}

// ===== registry 读写与 trash purge =====

struct Registry {
    repos: Vec<Value>,
    skills: Vec<Value>,
}

/// upstream DEFAULT_REPOS。
fn default_repos() -> Vec<Value> {
    vec![
        json!({"owner": "anthropics", "name": "skills", "branch": "main", "enabled": true}),
        json!({"owner": "ComposioHQ", "name": "awesome-claude-skills", "branch": "master", "enabled": true}),
        json!({"owner": "cexll", "name": "myclaude", "branch": "master", "enabled": true}),
        json!({"owner": "JimLiu", "name": "baoyu-skills", "branch": "main", "enabled": true}),
    ]
}

/// upstream readRegistry：文件缺失/解析失败 → 默认；repos 非数组 → DEFAULT_REPOS；
/// skills 非数组 → []。
fn read_registry() -> Registry {
    if let Some(value) = read_json(&registry_path()) {
        if value.is_object() {
            let repos = value
                .get("repos")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_else(default_repos);
            let skills = value
                .get("skills")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            return Registry { repos, skills };
        }
    }
    Registry {
        repos: default_repos(),
        skills: Vec::new(),
    }
}

fn save_registry(registry: &Registry) -> SkillResult<()> {
    write_json(
        &registry_path(),
        &json!({"repos": &registry.repos, "skills": &registry.skills}),
    )
}

/// 条目的 trashedAt（JS truthy 语义：非零数字才算 trashed）。
fn trashed_at_of(skill: &Value) -> Option<f64> {
    skill
        .get("trashedAt")
        .and_then(Value::as_f64)
        .filter(|n| *n != 0.0)
}

/// upstream purgeExpiredTrash：trashedAt 距今 ≥ TRASH_TTL_MS → 删 trash 目录 + registry
/// 删条目；整体 best-effort。
fn purge_expired_trash() {
    let now = now_ms();
    let mut registry = read_registry();
    let mut dirty = false;
    registry.skills.retain(|skill| {
        let Some(trashed_at) = trashed_at_of(skill) else {
            return true;
        };
        if now as f64 - trashed_at < TRASH_TTL_MS as f64 {
            return true;
        }
        if let Some(trashed_directory) = skill.get("trashedDirectory").and_then(Value::as_str) {
            if !trashed_directory.is_empty() {
                remove_path(&trash_dir().join(trashed_directory));
            }
        }
        dirty = true;
        false
    });
    if dirty {
        let _ = save_registry(&registry);
    }
}

// ===== activity 日志（best-effort，永不阻塞 mutation） =====

/// upstream appendActivity：`{ts, ...event}` 单行 JSON 追加（0o600）；
/// 超过 256KB 截尾保留最后 500 行；整体吞错。
fn append_activity(event: Value) {
    let _ = (|| -> std::io::Result<()> {
        ensure_dir(&skills_root())?;
        let mut record = Map::new();
        record.insert("ts".to_string(), json!(now_ms()));
        if let Value::Object(map) = event {
            record.extend(map);
        }
        let line = serde_json::to_string(&Value::Object(record)).unwrap_or_default();
        append_line_private(&activity_path(), &format!("{line}\n"))?;
        let size = fs::metadata(&activity_path())
            .map(|meta| meta.len())
            .unwrap_or(0);
        if size > ACTIVITY_TRIM_BYTES {
            if let Some(raw) = read_text(&activity_path()) {
                let lines: Vec<&str> = raw.split('\n').filter(|l| !l.is_empty()).collect();
                let kept = &lines[lines.len().saturating_sub(ACTIVITY_MAX)..];
                write_file_private(&activity_path(), &format!("{}\n", kept.join("\n")))?;
            }
        }
        Ok(())
    })();
}

/// upstream readActivity：取末尾 limit 行（clamp [1,500]，0 → 100），解析失败的行丢弃，最新在前。
fn read_activity(limit: i64) -> Vec<Value> {
    let want = (if limit == 0 { 100 } else { limit }).clamp(1, ACTIVITY_MAX as i64) as usize;
    let Some(raw) = read_text(&activity_path()) else {
        return Vec::new();
    };
    let lines: Vec<&str> = raw.split('\n').filter(|l| !l.is_empty()).collect();
    lines[lines.len().saturating_sub(want)..]
        .iter()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .rev()
        .collect()
}

// ===== 网络层：UA tokentracker-skills + Accept + 20s 超时，429/403 → RateLimit =====

fn http_client() -> SkillResult<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent("tokentracker-skills")
        .timeout(FETCH_TIMEOUT)
        .build()
        .map_err(|e| SkillError::other(format!("Failed to build HTTP client: {e}")))
}

fn rate_limit_error(status: reqwest::StatusCode) -> SkillError {
    let msg = format!(
        "GitHub rate-limited this request (HTTP {}). Try again later.",
        status.as_u16()
    );
    SkillError::RateLimited(msg)
}

async fn fetch_checked(response: reqwest::Response) -> SkillResult<reqwest::Response> {
    let status = response.status();
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS || status == reqwest::StatusCode::FORBIDDEN
    {
        return Err(rate_limit_error(status));
    }
    if !status.is_success() {
        return Err(SkillError::other(format!("HTTP {}", status.as_u16())));
    }
    Ok(response)
}

/// upstream fetchJson（Accept: application/vnd.github+json）。
async fn fetch_json(client: &reqwest::Client, url: &str) -> SkillResult<Value> {
    let response = client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| SkillError::other(format!("request failed: {e}")))?;
    fetch_checked(response)
        .await?
        .json::<Value>()
        .await
        .map_err(|e| SkillError::other(format!("invalid JSON response: {e}")))
}

/// upstream fetchText（Accept: text/plain）。
async fn fetch_text(client: &reqwest::Client, url: &str) -> SkillResult<String> {
    let response = client
        .get(url)
        .header(reqwest::header::ACCEPT, "text/plain")
        .send()
        .await
        .map_err(|e| SkillError::other(format!("request failed: {e}")))?;
    fetch_checked(response)
        .await?
        .text()
        .await
        .map_err(|e| SkillError::other(format!("failed to read response body: {e}")))
}

/// upstream getRepoTree：branch 回退链 [配置 branch（除非 =~ /^head$/i）, main, master]
/// 去重逐个尝试；全部失败抛最后一个错误。
async fn get_repo_tree(
    client: &reqwest::Client,
    owner: &str,
    name: &str,
    branch: &str,
) -> SkillResult<(String, Vec<Value>)> {
    let mut branches: Vec<String> = Vec::new();
    if !branch.is_empty() && !eq_ignore_case(branch, "head") {
        branches.push(branch.to_string());
    }
    for fallback in ["main", "master"] {
        if !branches.iter().any(|b| b == fallback) {
            branches.push(fallback.to_string());
        }
    }
    let mut last_error: Option<SkillError> = None;
    for candidate in &branches {
        let url = format!(
            "https://api.github.com/repos/{owner}/{name}/git/trees/{}?recursive=1",
            encode_uri_component(candidate)
        );
        match fetch_json(client, &url).await {
            Ok(data) => {
                if let Some(tree) = data.get("tree").and_then(Value::as_array) {
                    return Ok((candidate.clone(), tree.clone()));
                }
            }
            Err(error) => last_error = Some(error),
        }
    }
    Err(last_error.unwrap_or_else(|| SkillError::other(format!("Unable to read {owner}/{name}"))))
}

/// upstream mapWithConcurrency：固定 limit 的 worker 池，结果按输入顺序对齐。
/// （upstream 用 Promise.all，任一 reject 整体 reject；这里收集全部结果由调用方决定，
/// 等价于 allSettled + 调用方首个错误上抛。）
async fn map_with_concurrency<T, R, F, Fut>(
    items: Vec<T>,
    limit: usize,
    worker: F,
) -> Vec<Result<R, SkillError>>
where
    T: Send + 'static,
    R: Send + 'static,
    F: Fn(T) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = Result<R, SkillError>> + Send + 'static,
{
    let count = items.len();
    let worker = Arc::new(worker);
    let semaphore = Arc::new(tokio::sync::Semaphore::new(limit.max(1)));
    let mut set: tokio::task::JoinSet<(usize, Result<R, SkillError>)> = tokio::task::JoinSet::new();
    for (index, item) in items.into_iter().enumerate() {
        // 先拿 permit 再 spawn，等价于上游的 pool of N runners。
        let Ok(permit) = semaphore.clone().acquire_owned().await else {
            break;
        };
        let worker = Arc::clone(&worker);
        set.spawn(async move {
            let _permit = permit;
            let result = worker(item).await;
            (index, result)
        });
    }
    let mut results: Vec<Option<Result<R, SkillError>>> = Vec::new();
    results.resize_with(count, || None);
    while let Some(joined) = set.join_next().await {
        if let Ok((index, result)) = joined {
            results[index] = Some(result);
        }
    }
    results
        .into_iter()
        .map(|slot| slot.unwrap_or_else(|| Err(SkillError::other("concurrent worker failed"))))
        .collect::<Vec<_>>()
}

// ===== classify / scan / sync / remove / installed 列表 =====

/// 单个 (skill, target) 的磁盘三态（upstream classifyTargetSkill 的多目录版核心）：
/// 任一 baseDir 下存在（symlink 可 resolve 或实体）→ "synced"（短路）；
/// 否则若候选是悬空 symlink → "orphan"；否则 "off"。
fn classify_in_dirs(directory: &str, base_dirs: &[PathBuf]) -> &'static str {
    let mut state = "off";
    for base_dir in base_dirs {
        let Some(candidate) = target_skill_path(base_dir, directory) else {
            continue;
        };
        if candidate.exists() {
            return "synced";
        }
        if is_symlink(&candidate) {
            state = "orphan";
        }
    }
    state
}

fn classify_target_skill(directory: &str, target_id: &str) -> &'static str {
    let Some(target) = target_by_id(target_id) else {
        return "off";
    };
    classify_in_dirs(directory, &target_dirs(target))
}

/// upstream scanTargetSkill：任一 baseDir 下候选存在（含 symlink）即 true。
fn scan_target_skill(directory: &str, target_id: &str) -> bool {
    let Some(target) = target_by_id(target_id) else {
        return false;
    };
    target_dirs(target).iter().any(|base_dir| {
        target_skill_path(base_dir, directory)
            .map(|candidate| candidate.exists() || is_symlink(&candidate))
            .unwrap_or(false)
    })
}

/// upstream syncSkillToTarget：SSOT → target 的 symlink，任何失败回退整目录递归 copy。
fn sync_skill_to_target(directory: &str, target_id: &str) -> SkillResult<()> {
    let target = target_by_id(target_id)
        .ok_or_else(|| SkillError::other(format!("Unsupported target: {target_id}")))?;
    let source = managed_skill_path(directory)?;
    if !source.exists() {
        return Err(SkillError::other(format!(
            "Managed skill not found: {directory}"
        )));
    }
    for base_dir in target_dirs(target) {
        let dest = target_skill_path(&base_dir, directory)
            .ok_or_else(|| SkillError::other(format!("Invalid skill directory: {directory}")))?;
        assert_not_nested(&source, &dest)?;
        if let Some(parent) = dest.parent() {
            ensure_dir(parent)?;
        }
        remove_path(&dest);
        if symlink_dir(&source, &dest).is_err() {
            copy_dir(&source, &dest)?;
        }
    }
    Ok(())
}

/// upstream removeSkillFromTarget：removePath + 逐级清理空祖先到 baseDir。
fn remove_skill_from_target(directory: &str, target_id: &str) {
    let Some(target) = target_by_id(target_id) else {
        return;
    };
    for base_dir in target_dirs(target) {
        let Some(target_path) = target_skill_path(&base_dir, directory) else {
            continue;
        };
        remove_path(&target_path);
        if let Some(parent) = target_path.parent() {
            remove_empty_ancestors(parent, &base_dir);
        }
    }
}

/// 在 registry skills 中按 `id == id || key == id` 查找（upstream 多个 mutation 共用）。
fn find_skill_position(skills: &[Value], id: &str) -> Option<usize> {
    skills.iter().position(|entry| {
        entry.get("id").and_then(Value::as_str) == Some(id)
            || entry.get("key").and_then(Value::as_str) == Some(id)
    })
}

/// upstream listInstalledSkills：先 purge trash，再 managed + unmanaged 合并按 name 排序。
fn list_installed_skills() -> Vec<Value> {
    purge_expired_trash();
    let registry = read_registry();
    let mut managed: Vec<Value> = Vec::new();
    for skill in &registry.skills {
        if trashed_at_of(skill).is_some() {
            continue;
        }
        let directory = js_string(skill.get("directory"));
        let intended: HashSet<String> = skill
            .get("targets")
            .and_then(Value::as_array)
            .map(|arr| {
                arr.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        let mut target_states = Map::new();
        let mut targets: Vec<Value> = Vec::new();
        for target in TARGETS.iter() {
            let mut state = classify_target_skill(&directory, target.id);
            // registry 意图包含但磁盘丢失 → orphan。
            if state == "off" && intended.contains(target.id) {
                state = "orphan";
            }
            target_states.insert(target.id.to_string(), json!(state));
            if state == "synced" {
                targets.push(json!(target.id));
            }
        }
        let mut entry = skill.as_object().cloned().unwrap_or_default();
        entry.insert("managed".to_string(), json!(true));
        entry.insert("targets".to_string(), Value::Array(targets));
        entry.insert("targetStates".to_string(), Value::Object(target_states));
        managed.push(Value::Object(entry));
    }

    let managed_dirs: HashSet<String> = managed
        .iter()
        .map(|skill| js_string(skill.get("directory")).to_lowercase())
        .collect();

    // unmanaged：扫描全部 8 个 target 的本地 skill，跨 target 按 directory 小写合并。
    let mut unmanaged: Vec<Value> = Vec::new();
    let mut unmanaged_index: HashMap<String, usize> = HashMap::new();
    for target in TARGETS.iter() {
        for base_dir in target_dirs(target) {
            for directory in scan_skill_directories(&base_dir) {
                if directory.is_empty() || managed_dirs.contains(&directory.to_lowercase()) {
                    continue;
                }
                let Some(marker) = find_skill_marker(&base_dir.join(&directory)) else {
                    continue;
                };
                let markdown = read_text(&marker).unwrap_or_default();
                let fallback =
                    install_name_from_directory(&directory).unwrap_or_else(|| directory.clone());
                let metadata = read_skill_metadata(&markdown, &fallback);
                let key = directory.to_lowercase();
                let index = match unmanaged_index.get(&key) {
                    Some(&i) => i,
                    None => {
                        let target_states: Map<String, Value> = TARGETS
                            .iter()
                            .map(|t| (t.id.to_string(), json!("off")))
                            .collect();
                        unmanaged.push(json!({
                            "id": format!("local:{directory}"),
                            "key": format!("local:{directory}"),
                            "name": metadata.name,
                            "description": metadata.description,
                            "directory": directory,
                            "readmeUrl": Value::Null,
                            "repoOwner": Value::Null,
                            "repoName": Value::Null,
                            "repoBranch": Value::Null,
                            "installedAt": Value::Null,
                            "managed": false,
                            "targets": [],
                            "targetStates": Value::Object(target_states),
                            "targetPaths": {},
                        }));
                        unmanaged_index.insert(key, unmanaged.len() - 1);
                        unmanaged.len() - 1
                    }
                };
                let entry = &mut unmanaged[index];
                if let Some(targets) = entry.get_mut("targets").and_then(Value::as_array_mut) {
                    if !targets.iter().any(|t| t.as_str() == Some(target.id)) {
                        targets.push(json!(target.id));
                    }
                }
                if let Some(states) = entry.get_mut("targetStates").and_then(Value::as_object_mut) {
                    states.insert(target.id.to_string(), json!("synced"));
                }
                if let Some(paths) = entry.get_mut("targetPaths").and_then(Value::as_object_mut) {
                    // 只记录首个命中的 target 路径。
                    paths
                        .entry(target.id.to_string())
                        .or_insert_with(|| json!(base_dir.join(&directory).to_string_lossy()));
                }
            }
        }
    }

    managed.extend(unmanaged);
    // codepoint 排序（upstream localeCompare 的计划内偏差）；Rust sort_by 稳定。
    managed.sort_by(|a, b| js_string(a.get("name")).cmp(&js_string(b.get("name"))));
    managed
}

// ===== mutations：install / uninstall / restore / set_targets / import_local / delete_local =====

/// upstream installSkill：GitHub tree → tmp 下载 → rename 进 SSOT → registry → sync targets。
async fn install_skill(skill_input: &Value, target_ids: &[String]) -> SkillResult<Value> {
    let skill_name_input = js_string(skill_input.get("name"));
    let skill_description_input = js_string(skill_input.get("description"));
    let directory_input = js_string(skill_input.get("directory"));
    let repo_owner = js_string(skill_input.get("repoOwner"));
    let repo_name = js_string(skill_input.get("repoName"));
    let repo_branch = {
        let branch = js_string(skill_input.get("repoBranch"));
        if branch.is_empty() {
            "main".to_string()
        } else {
            branch
        }
    };
    if repo_owner.is_empty() || repo_name.is_empty() {
        return Err(SkillError::other("Missing GitHub repository information"));
    }
    let source_dir = sanitize_relative_path(&directory_input);
    // GitHub 来源的 skill 即使 sourceDirectory 嵌套也沿用扁平 installName。
    let install_name = source_dir.as_deref().and_then(install_name_from_directory);
    let (source_dir, install_name) = match (source_dir, install_name) {
        (Some(dir), Some(name)) => (dir, name),
        _ => return Err(SkillError::other("Invalid skill directory")),
    };

    let mut registry = read_registry();
    let new_repo = format!("{repo_owner}/{repo_name}").to_lowercase();
    let conflict = registry
        .skills
        .iter()
        .find(|entry| {
            let dir = js_string(entry.get("directory"));
            let repo = format!(
                "{}/{}",
                js_string(entry.get("repoOwner")),
                js_string(entry.get("repoName"))
            )
            .to_lowercase();
            eq_ignore_case(&dir, &install_name) && repo != new_repo
        })
        .map(|entry| {
            (
                js_string(entry.get("repoOwner")),
                js_string(entry.get("repoName")),
            )
        });
    if let Some((owner, name)) = conflict {
        return Err(SkillError::other(format!(
            "Skill directory \"{install_name}\" is already managed by {owner}/{name}"
        )));
    }

    let client = http_client()?;
    let (branch, tree) = get_repo_tree(&client, &repo_owner, &repo_name, &repo_branch).await?;
    let prefix = format!("{source_dir}/");
    let files: Vec<&Value> = tree
        .iter()
        .filter(|entry| {
            entry.get("type").and_then(Value::as_str) == Some("blob")
                && entry
                    .get("path")
                    .and_then(Value::as_str)
                    .map(|path| path == source_dir || path.starts_with(&prefix))
                    .unwrap_or(false)
        })
        .collect();
    if !files.iter().any(|entry| {
        entry
            .get("path")
            .and_then(Value::as_str)
            .map(is_skill_md_path)
            .unwrap_or(false)
    }) {
        return Err(SkillError::other(
            "SKILL.md not found in selected directory",
        ));
    }

    let dest = managed_skill_path(&install_name)?;
    let temp = tmp_dir().join(format!("{install_name}-{}", now_ms()));
    remove_path(&temp);
    ensure_dir(&temp)?;
    // 逐文件串行下载；任何失败清理 tmp 后上抛。
    let download = async {
        for entry in &files {
            let path = entry.get("path").and_then(Value::as_str).unwrap_or("");
            let relative = if path == source_dir {
                Path::new(path)
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default()
            } else {
                path[source_dir.len() + 1..].to_string()
            };
            let Some(safe_relative) = sanitize_relative_path(&relative) else {
                continue;
            };
            let out = temp.join(&safe_relative);
            if let Some(parent) = out.parent() {
                ensure_dir(parent)?;
            }
            let text = fetch_text(
                &client,
                &github_raw_url(&repo_owner, &repo_name, &branch, path),
            )
            .await?;
            fs::write(&out, text)?;
        }
        remove_path(&dest);
        if let Some(parent) = dest.parent() {
            ensure_dir(parent)?;
        }
        fs::rename(&temp, &dest)?;
        Ok::<(), SkillError>(())
    };
    if let Err(error) = download.await {
        remove_path(&temp);
        return Err(error);
    }

    // 从落盘 SKILL.md（优先大写，其次 skill.md）重读 name/description。
    let marker = find_skill_marker(&dest);
    let skill_md = marker.and_then(|m| read_text(&m)).unwrap_or_default();
    let fallback_name = if skill_name_input.is_empty() {
        install_name.clone()
    } else {
        skill_name_input.clone()
    };
    let metadata = read_skill_metadata(&skill_md, &fallback_name);
    let description = if metadata.description.is_empty() {
        skill_description_input.clone()
    } else {
        metadata.description
    };
    let selected_targets: Vec<String> = target_ids
        .iter()
        .filter(|id| target_by_id(id).is_some())
        .cloned()
        .collect();

    let id = format!("{repo_owner}/{repo_name}:{source_dir}");
    let mut installed = Map::new();
    installed.insert("id".to_string(), json!(id));
    installed.insert("key".to_string(), json!(id));
    installed.insert("name".to_string(), json!(metadata.name));
    installed.insert("description".to_string(), json!(description));
    installed.insert("directory".to_string(), json!(install_name));
    installed.insert("sourceDirectory".to_string(), json!(source_dir));
    // readmeUrl 恒用大写 SKILL.md（与 upstream 一致）。
    installed.insert(
        "readmeUrl".to_string(),
        json!(github_doc_url(
            &repo_owner,
            &repo_name,
            &branch,
            &format!("{source_dir}/SKILL.md")
        )),
    );
    installed.insert("repoOwner".to_string(), json!(repo_owner));
    installed.insert("repoName".to_string(), json!(repo_name));
    installed.insert("repoBranch".to_string(), json!(branch));
    installed.insert("installedAt".to_string(), json!(now_ms()));
    installed.insert("contentHash".to_string(), json!(hash_directory(&dest)));
    if let Some(signature) = source_signature_from_tree(&tree, &source_dir) {
        installed.insert("sourceSignature".to_string(), json!(signature));
    }
    installed.insert("targets".to_string(), json!(&selected_targets));

    registry.skills.retain(|entry| {
        entry.get("id").and_then(Value::as_str) != Some(id.as_str())
            && !eq_ignore_case(&js_string(entry.get("directory")), &install_name)
    });
    registry.skills.push(Value::Object(installed.clone()));
    save_registry(&registry)?;

    for target_id in &selected_targets {
        sync_skill_to_target(&install_name, target_id)?;
    }
    append_activity(json!({
        "action": "install",
        "name": installed.get("name").cloned().unwrap_or(Value::Null),
        "directory": install_name,
        "targets": &selected_targets,
        "source": format!("{repo_owner}/{repo_name}"),
    }));
    let mut skill = installed;
    skill.insert("managed".to_string(), json!(true));
    Ok(json!({"ok": true, "skill": Value::Object(skill)}))
}

/// upstream uninstallSkill：全部 target 摘除后 SSOT 移入 .trash（5 分钟可 restore），
/// rename 失败或 SSOT 缺失则彻底删除。
fn uninstall_skill(id: &str) -> SkillResult<Value> {
    let mut registry = read_registry();
    let Some(position) = find_skill_position(&registry.skills, id) else {
        return Err(SkillError::other("Managed skill not found"));
    };
    let skill = registry.skills[position].clone();
    let directory = js_string(skill.get("directory"));
    let entry_id = skill.get("id").and_then(Value::as_str).map(str::to_string);
    let ssot_path = managed_skill_path(&directory)?;
    for target in TARGETS.iter() {
        remove_skill_from_target(&directory, target.id);
    }
    let skill_name = skill.get("name").cloned().unwrap_or(Value::Null);
    if ssot_path.exists() {
        ensure_dir(&trash_dir())?;
        let stamp = now_ms();
        let trash_name = format!("{}-{stamp}", base64url_no_pad(&directory));
        let trash_path = trash_dir().join(&trash_name);
        if fs::rename(&ssot_path, &trash_path).is_ok() {
            if let Some(parent) = ssot_path.parent() {
                remove_empty_ancestors(parent, &ssot_dir());
            }
            let mut trashed = skill.as_object().cloned().unwrap_or_default();
            trashed.insert("trashedAt".to_string(), json!(stamp));
            trashed.insert("trashedDirectory".to_string(), json!(trash_name));
            trashed.insert(
                "previousTargets".to_string(),
                skill.get("targets").cloned().unwrap_or_else(|| json!([])),
            );
            trashed.insert("targets".to_string(), json!([]));
            registry
                .skills
                .retain(|entry| entry.get("id").and_then(Value::as_str) != entry_id.as_deref());
            registry.skills.push(Value::Object(trashed));
            save_registry(&registry)?;
            purge_expired_trash();
            append_activity(
                json!({"action": "uninstall", "name": skill_name, "directory": directory}),
            );
            return Ok(json!({
                "ok": true,
                "trashed": true,
                "restoreId": skill.get("id").cloned().unwrap_or(Value::Null),
                "ttlMs": TRASH_TTL_MS,
            }));
        }
        // rename 失败：回退彻底删除。
        remove_path(&ssot_path);
        if let Some(parent) = ssot_path.parent() {
            remove_empty_ancestors(parent, &ssot_dir());
        }
    }
    registry
        .skills
        .retain(|entry| entry.get("id").and_then(Value::as_str) != entry_id.as_deref());
    save_registry(&registry)?;
    append_activity(json!({"action": "uninstall", "name": skill_name, "directory": directory}));
    Ok(json!({"ok": true, "trashed": false}))
}

/// upstream restoreSkill：trash 窗口内 rename 回 SSOT 并按 previousTargets 重新 symlink。
fn restore_skill(id: &str) -> SkillResult<Value> {
    let mut registry = read_registry();
    let Some(index) = find_skill_position(&registry.skills, id) else {
        return Err(SkillError::other("Nothing to restore"));
    };
    let skill = registry.skills[index].clone();
    let Some(trashed_at) = trashed_at_of(&skill) else {
        return Err(SkillError::other("Nothing to restore"));
    };
    if now_ms() as f64 - trashed_at > TRASH_TTL_MS as f64 {
        return Err(SkillError::other("Restore window expired"));
    }
    let directory = js_string(skill.get("directory"));
    let trash_path = trash_dir().join(js_string(skill.get("trashedDirectory")));
    let ssot_path = managed_skill_path(&directory)?;
    if !trash_path.exists() {
        return Err(SkillError::other("Trashed copy is missing"));
    }
    if let Some(parent) = ssot_path.parent() {
        ensure_dir(parent)?;
    }
    remove_path(&ssot_path);
    fs::rename(&trash_path, &ssot_path)?;
    let targets: Vec<String> = skill
        .get("previousTargets")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    let mut restored = skill.as_object().cloned().unwrap_or_default();
    restored.insert("targets".to_string(), json!(&targets));
    restored.remove("trashedAt");
    restored.remove("trashedDirectory");
    restored.remove("previousTargets");
    registry.skills[index] = Value::Object(restored.clone());
    save_registry(&registry)?;
    for target_id in &targets {
        sync_skill_to_target(&directory, target_id)?;
    }
    append_activity(json!({
        "action": "restore",
        "name": restored.get("name").cloned().unwrap_or(Value::Null),
        "directory": directory,
        "targets": &targets,
    }));
    restored.insert("managed".to_string(), json!(true));
    Ok(json!({"ok": true, "skill": Value::Object(restored)}))
}

/// upstream setSkillTargets：对新开 target sync、对关闭 target remove。
fn set_skill_targets(id: &str, target_ids: &[String]) -> SkillResult<Value> {
    let mut registry = read_registry();
    let Some(index) = find_skill_position(&registry.skills, id) else {
        return Err(SkillError::other("Managed skill not found"));
    };
    let skill = registry.skills[index].clone();
    let directory = js_string(skill.get("directory"));
    let selected: Vec<String> = target_ids
        .iter()
        .filter(|tid| target_by_id(tid).is_some())
        .cloned()
        .collect();
    for target in TARGETS.iter() {
        if selected.iter().any(|tid| tid == target.id) {
            sync_skill_to_target(&directory, target.id)?;
        } else {
            remove_skill_from_target(&directory, target.id);
        }
    }
    let mut updated = skill.as_object().cloned().unwrap_or_default();
    updated.insert("targets".to_string(), json!(&selected));
    registry.skills[index] = Value::Object(updated.clone());
    save_registry(&registry)?;
    append_activity(json!({
        "action": "set_targets",
        "name": updated.get("name").cloned().unwrap_or(Value::Null),
        "directory": directory,
        "targets": &selected,
    }));
    updated.insert("managed".to_string(), json!(true));
    Ok(json!({"ok": true, "skill": Value::Object(updated)}))
}

/// upstream findLocalSkillSource：在某 target 下找到含 marker 的源目录。
fn find_local_skill_source(directory: &str) -> Option<(PathBuf, String)> {
    let source_dir = sanitize_local_skill_path(directory)?;
    for target in TARGETS.iter() {
        for base_dir in target_dirs(target) {
            let Some(skill_path) = target_skill_path(&base_dir, &source_dir) else {
                continue;
            };
            if find_skill_marker(&skill_path).is_some() {
                return Some((skill_path, target.id.to_string()));
            }
        }
    }
    None
}

/// upstream importLocalSkill：把本地 skill 复制（非 symlink）进 SSOT 并登记 `local:<dir>`。
fn import_local_skill(directory: &str, target_ids: &[String]) -> SkillResult<Value> {
    let Some(source_dir) = sanitize_local_skill_path(directory) else {
        return Err(SkillError::other("Invalid skill directory"));
    };
    let mut registry = read_registry();
    let existing = registry
        .skills
        .iter()
        .find(|entry| eq_ignore_case(&js_string(entry.get("directory")), &source_dir))
        .cloned();
    if let Some(existing) = existing {
        let existing_id = js_string(existing.get("id"));
        let existing_key = js_string(existing.get("key"));
        let id_or_key = if existing_id.is_empty() {
            existing_key
        } else {
            existing_id
        };
        if !id_or_key.starts_with("local:") {
            return Err(SkillError::other(format!(
                "Skill directory \"{source_dir}\" is already managed by another installed skill"
            )));
        }
        if target_ids.is_empty() {
            let mut skill = existing.as_object().cloned().unwrap_or_default();
            let targets = existing
                .get("targets")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            skill.insert("managed".to_string(), json!(true));
            skill.insert("targets".to_string(), Value::Array(targets));
            return Ok(json!({"ok": true, "skill": Value::Object(skill)}));
        }
        return set_skill_targets(&js_string(existing.get("id")), target_ids);
    }

    let Some((source_path, _target_id)) = find_local_skill_source(&source_dir) else {
        return Err(SkillError::other("Local skill not found"));
    };
    let dest = managed_skill_path(&source_dir)?;
    copy_dir(&source_path, &dest)?;
    let marker = find_skill_marker(&dest);
    let markdown = marker.and_then(|m| read_text(&m)).unwrap_or_default();
    let fallback = install_name_from_directory(&source_dir).unwrap_or_default();
    let metadata = read_skill_metadata(&markdown, &fallback);
    let discovered: Vec<String> = TARGETS
        .iter()
        .filter(|t| scan_target_skill(&source_dir, t.id))
        .map(|t| t.id.to_string())
        .collect();
    let selected: Vec<String> = (if target_ids.is_empty() {
        discovered
    } else {
        target_ids.to_vec()
    })
    .into_iter()
    .filter(|tid| target_by_id(tid).is_some())
    .collect();

    let local_id = format!("local:{source_dir}");
    let mut skill = Map::new();
    skill.insert("id".to_string(), json!(local_id));
    skill.insert("key".to_string(), json!(local_id));
    skill.insert("name".to_string(), json!(metadata.name));
    skill.insert("description".to_string(), json!(metadata.description));
    skill.insert("directory".to_string(), json!(source_dir));
    skill.insert("sourceDirectory".to_string(), json!(source_dir));
    skill.insert("readmeUrl".to_string(), Value::Null);
    skill.insert("repoOwner".to_string(), Value::Null);
    skill.insert("repoName".to_string(), Value::Null);
    skill.insert("repoBranch".to_string(), Value::Null);
    skill.insert("installedAt".to_string(), json!(now_ms()));
    skill.insert("contentHash".to_string(), json!(hash_directory(&dest)));
    skill.insert("targets".to_string(), json!(&selected));
    registry.skills.push(Value::Object(skill.clone()));
    save_registry(&registry)?;
    for target in TARGETS.iter() {
        if selected.iter().any(|tid| tid == target.id) {
            sync_skill_to_target(&source_dir, target.id)?;
        } else {
            remove_skill_from_target(&source_dir, target.id);
        }
    }
    append_activity(json!({
        "action": "import",
        "name": skill.get("name").cloned().unwrap_or(Value::Null),
        "directory": source_dir,
        "targets": &selected,
    }));
    skill.insert("managed".to_string(), json!(true));
    Ok(json!({"ok": true, "skill": Value::Object(skill)}))
}

/// upstream deleteLocalSkill：从指定（缺省全部）target 删除本地 skill。
fn delete_local_skill(directory: &str, target_ids: &[String]) -> SkillResult<Value> {
    let Some(install_name) = sanitize_local_skill_path(directory) else {
        return Err(SkillError::other("Invalid skill directory"));
    };
    let selected: Vec<String> = if target_ids.is_empty() {
        TARGETS.iter().map(|target| target.id.to_string()).collect()
    } else {
        target_ids.to_vec()
    };
    for target_id in &selected {
        remove_skill_from_target(&install_name, target_id);
    }
    append_activity(
        json!({"action": "delete_local", "directory": install_name, "targets": &selected}),
    );
    Ok(json!({"ok": true}))
}

// ===== repos 管理 =====

/// upstream normalizeRepo。
fn normalize_repo(repo: &Value) -> Value {
    let owner = js_string(repo.get("owner")).trim().to_string();
    let name = js_string(repo.get("name")).trim().to_string();
    let branch = {
        let branch = js_string(repo.get("branch")).trim().to_string();
        if branch.is_empty() {
            "main".to_string()
        } else {
            branch
        }
    };
    let enabled = repo.get("enabled").and_then(Value::as_bool).unwrap_or(true);
    json!({"owner": owner, "name": name, "branch": branch, "enabled": enabled})
}

/// upstream OWNER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/。
fn owner_name_valid(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.is_empty() || bytes.len() > 100 || !bytes[0].is_ascii_alphanumeric() {
        return false;
    }
    bytes[1..]
        .iter()
        .all(|b| b.is_ascii_alphanumeric() || *b == b'.' || *b == b'_' || *b == b'-')
}

fn list_repos() -> Vec<Value> {
    read_registry().repos.iter().map(normalize_repo).collect()
}

fn invalidate_discover_cache() {
    let _ = fs::remove_file(discover_cache_path());
}

/// 按 `"owner/name"` 小写去重（upstream addRepo/removeRepo 共用）。
fn retain_repos_not(repos: &mut Vec<Value>, key: &str) {
    repos.retain(|entry| {
        format!(
            "{}/{}",
            js_string(entry.get("owner")),
            js_string(entry.get("name"))
        )
        .to_lowercase()
            != key
    });
}

/// upstream addRepo：校验 → 去重 → push → 失效 discover 缓存。
fn add_repo(repo_input: &Value) -> SkillResult<Value> {
    let repo = normalize_repo(repo_input);
    let owner = js_string(repo.get("owner"));
    let name = js_string(repo.get("name"));
    let branch = js_string(repo.get("branch"));
    if owner.is_empty() || name.is_empty() {
        return Err(SkillError::other("Repository owner and name are required"));
    }
    if !owner_name_valid(&owner) || !owner_name_valid(&name) {
        return Err(SkillError::other(
            "Repository owner and name may only contain letters, digits, '.', '_', or '-'",
        ));
    }
    if !owner_name_valid(&branch) {
        return Err(SkillError::other(
            "Repository branch contains unsupported characters",
        ));
    }
    let mut registry = read_registry();
    retain_repos_not(
        &mut registry.repos,
        &format!("{owner}/{name}").to_lowercase(),
    );
    registry.repos.push(repo.clone());
    save_registry(&registry)?;
    invalidate_discover_cache();
    Ok(json!({"ok": true, "repo": repo}))
}

/// upstream removeRepo。
fn remove_repo(owner: &str, name: &str) -> SkillResult<Value> {
    let mut registry = read_registry();
    retain_repos_not(
        &mut registry.repos,
        &format!("{owner}/{name}").to_lowercase(),
    );
    save_registry(&registry)?;
    invalidate_discover_cache();
    Ok(json!({"ok": true}))
}

// ===== discover / updates / search / popular（缓存 + 网络） =====

/// upstream 的 `/(^|\/)SKILL\.md$/i` 判定（大小写不敏感）。
fn is_skill_md_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    if bytes.len() == "skill.md".len() {
        return bytes.eq_ignore_ascii_case(b"skill.md");
    }
    bytes.len() >= "/skill.md".len()
        && bytes[bytes.len() - "/skill.md".len()..].eq_ignore_ascii_case(b"/skill.md")
}

/// 对应 upstream 的 `docPath.replace(/(^|\/)(?:SKILL|skill)\.md$/i, "")`。
fn strip_skill_md_suffix(doc_path: &str) -> &str {
    let bytes = doc_path.as_bytes();
    if bytes.len() == "skill.md".len() && bytes.eq_ignore_ascii_case(b"skill.md") {
        return "";
    }
    if bytes.len() >= "/skill.md".len()
        && bytes[bytes.len() - "/skill.md".len()..].eq_ignore_ascii_case(b"/skill.md")
    {
        return &doc_path[..doc_path.len() - "/skill.md".len()];
    }
    doc_path
}

/// upstream discoverRepoSkills：tree 里 SKILL.md blob 截 200，并发 4 拉 raw frontmatter，
/// 非 RateLimit 失败用 `{name: installName, description: ""}` fallback 保留条目。
async fn discover_repo_skills(
    client: &reqwest::Client,
    repo_input: &Value,
) -> SkillResult<Vec<Value>> {
    let repo = normalize_repo(repo_input);
    let owner = js_string(repo.get("owner"));
    let name = js_string(repo.get("name"));
    let enabled = repo.get("enabled").and_then(Value::as_bool).unwrap_or(true);
    if owner.is_empty() || name.is_empty() || !enabled {
        return Ok(Vec::new());
    }
    let (branch, tree) =
        get_repo_tree(client, &owner, &name, &js_string(repo.get("branch"))).await?;
    let skill_files: Vec<String> = tree
        .iter()
        .filter(|entry| entry.get("type").and_then(Value::as_str) == Some("blob"))
        .filter_map(|entry| {
            entry
                .get("path")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .filter(|path| is_skill_md_path(path))
        .take(DISCOVER_MAX_SKILLS_PER_REPO)
        .collect();

    let owner = Arc::new(owner);
    let name = Arc::new(name);
    let branch = Arc::new(branch);
    let worker_client = client.clone();
    let results = map_with_concurrency(
        skill_files,
        DISCOVER_CONCURRENCY,
        move |doc_path: String| {
            let client = worker_client.clone();
            let owner = Arc::clone(&owner);
            let name = Arc::clone(&name);
            let branch = Arc::clone(&branch);
            async move {
                let doc_path = doc_path.replace('\\', "/");
                // 根目录 SKILL.md → repo.name。
                let stripped = strip_skill_md_suffix(&doc_path);
                let directory = if stripped.is_empty() {
                    name.as_str().to_string()
                } else {
                    stripped.to_string()
                };
                let Some(install_name) = install_name_from_directory(&directory) else {
                    return Ok(None);
                };
                let mut meta_name = install_name.clone();
                let mut meta_description = String::new();
                match fetch_text(&client, &github_raw_url(&owner, &name, &branch, &doc_path)).await
                {
                    Ok(markdown) => {
                        let metadata = read_skill_metadata(&markdown, &install_name);
                        meta_name = metadata.name;
                        meta_description = metadata.description;
                    }
                    Err(error) => {
                        if error.is_rate_limited() {
                            return Err(error);
                        }
                        // 非 RateLimit 失败：保留条目（metadata fallback）。
                    }
                }
                Ok(Some(json!({
                    "key": format!("{}/{}:{directory}", owner, name),
                    "name": meta_name,
                    "description": meta_description,
                    "directory": directory,
                    "readmeUrl": github_doc_url(&owner, &name, &branch, &doc_path),
                    "repoOwner": owner.as_str(),
                    "repoName": name.as_str(),
                    "repoBranch": branch.as_str(),
                })))
            }
        },
    )
    .await;

    let mut skills = Vec::new();
    for result in results {
        match result {
            Ok(Some(skill)) => skills.push(skill),
            Ok(None) => {}
            Err(error) => return Err(error),
        }
    }
    Ok(skills)
}

/// upstream dedupeSkills：按 key 小写去重（后写覆盖、保持首次位置），按 name 排序。
fn dedupe_skills(skills: Vec<Value>) -> Vec<Value> {
    let mut by_key: HashMap<String, usize> = HashMap::new();
    let mut values: Vec<Value> = Vec::new();
    for skill in skills {
        let key = format!(
            "{}/{}:{}",
            js_string(skill.get("repoOwner")),
            js_string(skill.get("repoName")),
            js_string(skill.get("directory"))
        )
        .to_lowercase();
        match by_key.get(&key) {
            Some(&index) => values[index] = skill,
            None => {
                by_key.insert(key, values.len());
                values.push(skill);
            }
        }
    }
    values.sort_by(|a, b| js_string(a.get("name")).cmp(&js_string(b.get("name"))));
    values
}

/// upstream discover fingerprint：enabled repos 的 `owner/name@branch` sort + `|` join。
fn discover_fingerprint(repos: &[Value]) -> String {
    let mut parts: Vec<String> = repos
        .iter()
        .map(|repo| {
            format!(
                "{}/{}@{}",
                js_string(repo.get("owner")),
                js_string(repo.get("name")),
                js_string(repo.get("branch"))
            )
        })
        .collect();
    parts.sort();
    parts.join("|")
}

/// upstream readDiscoverCache：fingerprint 相等且 generatedAt ≤1h 才命中。
fn read_discover_cache(fingerprint: &str) -> Option<(Vec<Value>, i64)> {
    let data = read_json(&discover_cache_path())?;
    let skills = data.get("skills").and_then(Value::as_array)?.clone();
    if data.get("fingerprint").and_then(Value::as_str) != Some(fingerprint) {
        return None;
    }
    let generated_at = data.get("generatedAt").and_then(Value::as_f64)?;
    if now_ms() as f64 - generated_at > DISCOVER_CACHE_TTL_MS as f64 {
        return None;
    }
    Some((skills, generated_at as i64))
}

fn write_discover_cache(fingerprint: &str, skills: &[Value]) -> SkillResult<()> {
    write_json(
        &discover_cache_path(),
        &json!({"fingerprint": fingerprint, "generatedAt": now_ms(), "skills": skills}),
    )
}

/// upstream discoverSkills：allSettled 语义（单 repo 失败不拖垮其他，
/// 但全空且有 RateLimit → 上抛 RateLimit）。
async fn discover_skills(force: bool) -> SkillResult<Value> {
    let registry = read_registry();
    let enabled: Vec<Value> = registry
        .repos
        .iter()
        .map(normalize_repo)
        .filter(|repo| repo.get("enabled").and_then(Value::as_bool).unwrap_or(true))
        .collect();
    if enabled.is_empty() {
        return Ok(json!({"skills": [], "cached": false, "generatedAt": now_ms()}));
    }
    let fingerprint = discover_fingerprint(&enabled);
    if !force {
        if let Some((skills, generated_at)) = read_discover_cache(&fingerprint) {
            return Ok(json!({"skills": skills, "cached": true, "generatedAt": generated_at}));
        }
    }
    let worker_client = http_client()?;
    let results = map_with_concurrency(enabled, DISCOVER_CONCURRENCY, move |repo: Value| {
        let client = worker_client.clone();
        async move { discover_repo_skills(&client, &repo).await }
    })
    .await;
    let mut merged: Vec<Value> = Vec::new();
    let mut rate_limited: Option<SkillError> = None;
    for result in results {
        match result {
            Ok(skills) => merged.extend(skills),
            Err(error) => {
                if error.is_rate_limited() && rate_limited.is_none() {
                    rate_limited = Some(error);
                }
            }
        }
    }
    let merged = dedupe_skills(merged);
    if merged.is_empty() {
        if let Some(error) = rate_limited {
            return Err(error);
        }
    }
    write_discover_cache(&fingerprint, &merged)?;
    Ok(json!({"skills": merged, "cached": false, "generatedAt": now_ms()}))
}

/// 缓存命中判定：`fingerprint` 相等 + `<key>` 时间戳在 TTL 内 + 指定字段类型校验。
fn cache_hit(
    cached: &Value,
    fingerprint: &str,
    ts_key: &str,
    ttl_ms: i64,
    payload_key: &str,
    want_object: bool,
) -> bool {
    let fresh = cached
        .get(ts_key)
        .and_then(Value::as_f64)
        .map(|ts| now_ms() as f64 - ts < ttl_ms as f64)
        .unwrap_or(false);
    if cached.get("fingerprint").and_then(Value::as_str) != Some(fingerprint) || !fresh {
        return false;
    }
    match cached.get(payload_key) {
        Some(Value::Array(_)) => !want_object,
        Some(v) => want_object && v.is_object(),
        None => false,
    }
}

/// upstream checkUpdates：候选 = `!trashedAt && repoOwner && repoName && sourceSignature`；
/// 按 `"owner/name@branch".toLowerCase()` 分组并发 2 拉 tree；sig 为 null 不写 key。
async fn check_updates(force: bool) -> SkillResult<Value> {
    let registry = read_registry();
    let managed: Vec<Value> = registry
        .skills
        .iter()
        .filter(|skill| {
            trashed_at_of(skill).is_none()
                && !js_string(skill.get("repoOwner")).is_empty()
                && !js_string(skill.get("repoName")).is_empty()
                && !js_string(skill.get("sourceSignature")).is_empty()
        })
        .cloned()
        .collect();
    let mut fingerprint_parts: Vec<String> = managed
        .iter()
        .map(|skill| {
            format!(
                "{}@{}",
                js_string(skill.get("id")),
                js_string(skill.get("sourceSignature"))
            )
        })
        .collect();
    fingerprint_parts.sort();
    let fingerprint = fingerprint_parts.join("|");

    if !force {
        if let Some(cached) = read_json(&updates_cache_path()) {
            if cache_hit(
                &cached,
                &fingerprint,
                "checkedAt",
                UPDATE_CACHE_TTL_MS,
                "updates",
                true,
            ) {
                let updates = cached.get("updates").cloned().unwrap_or_else(|| json!({}));
                let checked_at = cached.get("checkedAt").cloned().unwrap_or(Value::Null);
                return Ok(json!({"updates": updates, "checkedAt": checked_at, "cached": true}));
            }
        }
    }

    // 按 repo 分组（保持插入序）。
    let mut groups: Vec<(String, String, String, Vec<Value>)> = Vec::new();
    let mut group_index: HashMap<String, usize> = HashMap::new();
    for skill in &managed {
        let owner = js_string(skill.get("repoOwner"));
        let name = js_string(skill.get("repoName"));
        let branch = {
            let branch = js_string(skill.get("repoBranch"));
            if branch.is_empty() {
                "main".to_string()
            } else {
                branch
            }
        };
        let key = format!("{owner}/{name}@{branch}").to_lowercase();
        let index = match group_index.get(&key) {
            Some(&i) => i,
            None => {
                group_index.insert(key, groups.len());
                groups.push((owner, name, branch, Vec::new()));
                groups.len() - 1
            }
        };
        groups[index].3.push(skill.clone());
    }

    let client = http_client()?;
    let worker_client = client.clone();
    let results = map_with_concurrency(
        groups,
        UPDATE_CHECK_CONCURRENCY,
        move |(owner, name, branch, skills): (String, String, String, Vec<Value>)| {
            let client = worker_client.clone();
            async move {
                let tree = match get_repo_tree(&client, &owner, &name, &branch).await {
                    Ok((_, tree)) => tree,
                    Err(error) => {
                        if error.is_rate_limited() {
                            return Err(error);
                        }
                        // 非 RateLimit 失败静默跳过（该 repo 的 skills 不写 key）。
                        return Ok(Vec::new());
                    }
                };
                let mut updates: Vec<(String, bool)> = Vec::new();
                for skill in &skills {
                    let source = {
                        let source_directory = js_string(skill.get("sourceDirectory"));
                        if source_directory.is_empty() {
                            js_string(skill.get("directory"))
                        } else {
                            source_directory
                        }
                    };
                    if let Some(signature) = source_signature_from_tree(&tree, &source) {
                        updates.push((
                            js_string(skill.get("id")),
                            signature != js_string(skill.get("sourceSignature")),
                        ));
                    }
                }
                Ok(updates)
            }
        },
    )
    .await;

    let mut updates = Map::new();
    for result in results {
        for (id, has_update) in result? {
            updates.insert(id, json!(has_update));
        }
    }
    let checked_at = now_ms();
    write_json(
        &updates_cache_path(),
        &json!({"fingerprint": fingerprint, "checkedAt": checked_at, "updates": Value::Object(updates.clone())}),
    )?;
    Ok(json!({"updates": Value::Object(updates), "checkedAt": checked_at, "cached": false}))
}

/// upstream searchSkillsSh：`q.trim()` 长度 <2 短路；解析 skills.sh 响应。
async fn search_skills_sh(
    client: &reqwest::Client,
    query: &str,
    limit: f64,
    offset: f64,
) -> SkillResult<Value> {
    let q = query.trim().to_string();
    // JS length 是 UTF-16 code unit 数，用 encode_utf16 对齐。
    if q.encode_utf16().count() < 2 {
        return Ok(json!({"query": q, "totalCount": 0, "skills": []}));
    }
    let limit = {
        let n = if limit == 0.0 || limit.is_nan() {
            20.0
        } else {
            limit
        };
        n.min(50.0).max(1.0) as i64
    };
    let offset = if offset.is_nan() { 0.0 } else { offset }.max(0.0) as i64;
    let url = format!(
        "https://skills.sh/api/search?q={}&limit={limit}&offset={offset}",
        encode_form_param(&q)
    );
    let data = fetch_json(client, &url).await?;
    let skills: Vec<Value> = data
        .get("skills")
        .and_then(Value::as_array)
        .map(|arr| arr.iter().filter_map(parse_search_entry).collect())
        .unwrap_or_default();
    let total_count = {
        let count = data.get("count").map(js_f64).unwrap_or(f64::NAN);
        let n = if count == 0.0 || count.is_nan() {
            skills.len() as f64
        } else {
            count
        };
        json_number(n)
    };
    let query_out = {
        let data_query = js_string(data.get("query"));
        if data_query.is_empty() {
            q
        } else {
            data_query
        }
    };
    Ok(json!({"query": query_out, "totalCount": total_count, "skills": skills}))
}

/// upstream searchSkillsSh 的 entry 映射：`source` 按 `/` split 得 owner/repo（含 `.` 丢弃）。
fn parse_search_entry(entry: &Value) -> Option<Value> {
    let source = js_string(entry.get("source"));
    let mut parts = source.split('/');
    let owner = parts.next().unwrap_or("").to_string();
    let repo_name = parts.next().unwrap_or("").to_string();
    if owner.is_empty() || repo_name.is_empty() || owner.contains('.') || repo_name.contains('.') {
        return None;
    }
    let key = {
        let id = js_string(entry.get("id"));
        if !id.is_empty() {
            id
        } else {
            let skill_id = js_string(entry.get("skillId"));
            let inner = if !skill_id.is_empty() {
                skill_id
            } else {
                js_string(entry.get("name"))
            };
            format!("{owner}/{repo_name}:{inner}")
        }
    };
    let name = {
        let name = js_string(entry.get("name"));
        if !name.is_empty() {
            name
        } else {
            let skill_id = js_string(entry.get("skillId"));
            if !skill_id.is_empty() {
                skill_id
            } else {
                "Skill".to_string()
            }
        }
    };
    let directory = {
        let skill_id = js_string(entry.get("skillId"));
        if !skill_id.is_empty() {
            skill_id
        } else {
            js_string(entry.get("name"))
        }
    };
    Some(json!({
        "key": key,
        "name": name,
        "description": "",
        "directory": directory,
        "repoOwner": owner,
        "repoName": repo_name,
        "repoBranch": "main",
        "readmeUrl": format!("https://github.com/{owner}/{repo_name}"),
        "installs": json_number(js_number_or(entry.get("installs"), 0.0)),
    }))
}

/// upstream fetchPopularSkillsSh：12 个种子查询并发 4，按 key 小写合并保留 installs 大者，
/// installs 降序，截 200 写缓存（6h TTL）。
async fn fetch_popular_skills_sh(force: bool, limit: f64) -> SkillResult<Value> {
    let cap = {
        let n = if limit == 0.0 || limit.is_nan() {
            60.0
        } else {
            limit
        };
        n.min(200.0).max(1.0) as i64 as usize
    };
    if !force {
        if let Some(cached) = read_json(&popular_cache_path()) {
            let fresh = cached
                .get("generatedAt")
                .and_then(Value::as_f64)
                .map(|generated_at| now_ms() as f64 - generated_at < POPULAR_CACHE_TTL_MS as f64)
                .unwrap_or(false);
            if fresh {
                if let Some(skills) = cached.get("skills").and_then(Value::as_array) {
                    let sliced: Vec<Value> = skills.iter().take(cap).cloned().collect();
                    let generated_at = cached.get("generatedAt").cloned().unwrap_or(Value::Null);
                    return Ok(
                        json!({"skills": sliced, "cached": true, "generatedAt": generated_at}),
                    );
                }
            }
        }
    }
    let client = http_client()?;
    let worker_client = client.clone();
    let lists = map_with_concurrency(
        POPULAR_SEED_QUERIES
            .iter()
            .map(|q| q.to_string())
            .collect::<Vec<_>>(),
        DISCOVER_CONCURRENCY,
        move |q: String| {
            let client = worker_client.clone();
            async move {
                match search_skills_sh(&client, &q, 30.0, 0.0).await {
                    Ok(data) => Ok(data
                        .get("skills")
                        .and_then(Value::as_array)
                        .cloned()
                        .unwrap_or_default()),
                    Err(error) => {
                        if error.is_rate_limited() {
                            Err(error)
                        } else {
                            // 非 RateLimit 失败当空列表。
                            Ok(Vec::new())
                        }
                    }
                }
            }
        },
    )
    .await;

    let mut index_of: HashMap<String, usize> = HashMap::new();
    let mut merged: Vec<Value> = Vec::new();
    for list in lists {
        for skill in list? {
            let key = {
                let key = js_string(skill.get("key"));
                if !key.is_empty() {
                    key
                } else {
                    format!(
                        "{}/{}:{}",
                        js_string(skill.get("repoOwner")),
                        js_string(skill.get("repoName")),
                        js_string(skill.get("directory"))
                    )
                }
            }
            .to_lowercase();
            let installs = skill.get("installs").map(js_f64).unwrap_or(0.0);
            match index_of.get(&key) {
                Some(&index) => {
                    let previous = merged[index].get("installs").map(js_f64).unwrap_or(0.0);
                    if installs > previous {
                        merged[index] = skill;
                    }
                }
                None => {
                    index_of.insert(key, merged.len());
                    merged.push(skill);
                }
            }
        }
    }
    merged.sort_by(|a, b| {
        let ai = a.get("installs").map(js_f64).unwrap_or(0.0);
        let bi = b.get("installs").map(js_f64).unwrap_or(0.0);
        bi.partial_cmp(&ai).unwrap_or(std::cmp::Ordering::Equal)
    });
    merged.truncate(200);
    write_json(
        &popular_cache_path(),
        &json!({"generatedAt": now_ms(), "skills": &merged}),
    )?;
    let sliced: Vec<Value> = merged.into_iter().take(cap).collect();
    Ok(json!({"skills": sliced, "cached": false, "generatedAt": now_ms()}))
}

// ===== skill usage（upstream skill-usage.js）：扫 ~/.claude/projects/**/*.jsonl =====

fn claude_projects_dir(home: &Path) -> PathBuf {
    home.join(".claude").join("projects")
}

struct TranscriptFile {
    path: String,
    size: u64,
    mtime_ms: i64,
}

/// upstream listTranscriptFiles：任意深度递归收集 .jsonl（stat 失败跳过），按 path 排序。
fn list_transcript_files(root_dir: &Path) -> Vec<TranscriptFile> {
    fn walk(dir: &Path, out: &mut Vec<TranscriptFile>) {
        let Ok(read_dir) = fs::read_dir(dir) else {
            return;
        };
        for entry in read_dir.filter_map(|entry| entry.ok()) {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            let full = entry.path();
            if file_type.is_dir() {
                walk(&full, out);
            } else if file_type.is_file() && entry.file_name().to_string_lossy().ends_with(".jsonl")
            {
                let Ok(meta) = fs::metadata(&full) else {
                    continue;
                };
                let mtime_ms = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0);
                out.push(TranscriptFile {
                    path: full.to_string_lossy().into_owned(),
                    size: meta.len(),
                    mtime_ms,
                });
            }
        }
    }
    let mut out = Vec::new();
    walk(root_dir, &mut out);
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out
}

/// upstream fingerprintFiles：`"<count>:" + sha256hex(每文件 "<path>:<size>:<mtimeMs>\n")`。
fn fingerprint_files(files: &[TranscriptFile]) -> String {
    let mut hasher = Sha256::new();
    for file in files {
        hasher.update(format!("{}:{}:{}\n", file.path, file.size, file.mtime_ms));
    }
    format!("{}:{:x}", files.len(), hasher.finalize())
}

/// upstream toInt：有限正数 floor，否则 0。
fn to_int(value: f64) -> i64 {
    if value.is_finite() && value > 0.0 {
        value.floor() as i64
    } else {
        0
    }
}

/// 与 upstream SKILL_TOKEN_KEYS 对应的五列（内部用 f64 累计均摊份额）。
#[derive(Default)]
struct UsageTokens {
    input: f64,
    output: f64,
    cached_input: f64,
    cache_creation: f64,
    reasoning: f64,
}

struct UsageEntry {
    skill: String,
    invocations: i64,
    last_used_at: Option<String>,
    tokens: UsageTokens,
}

/// upstream normalizeUsage（列映射与 Claude parser 的 normalizeClaudeUsage 一致）。
fn normalize_usage(usage: Option<&Value>) -> UsageTokens {
    let get = |key: &str| usage.and_then(|u| u.get(key)).map(js_f64).unwrap_or(0.0);
    UsageTokens {
        input: to_int(get("input_tokens")) as f64,
        output: to_int(get("output_tokens")) as f64,
        cached_input: to_int(get("cache_read_input_tokens")) as f64,
        cache_creation: to_int(get("cache_creation_input_tokens")) as f64,
        reasoning: 0.0,
    }
}

/// upstream scanFile：行预筛 `"name":"Skill"` 子串，命中才 JSON 解析；
/// tool_use/Skill/id 跨文件去重/input.skill 非空；turn token 按 block 数均摊。
fn scan_transcript_file(
    path: &str,
    skills: &mut Vec<UsageEntry>,
    index: &mut HashMap<String, usize>,
    seen_block_ids: &mut HashSet<String>,
) {
    use std::io::BufRead;
    let Ok(file) = fs::File::open(path) else {
        return;
    };
    let reader = std::io::BufReader::new(file);
    for line_bytes in reader.split(b'\n') {
        let Ok(line_bytes) = line_bytes else { continue };
        let line = String::from_utf8_lossy(&line_bytes);
        let line = line.strip_suffix('\r').unwrap_or(&line);
        if !line.contains("\"name\":\"Skill\"") {
            continue;
        }
        let Ok(obj) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let Some(content) = obj
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(Value::as_array)
        else {
            continue;
        };
        // 先收集本 turn 的 fresh Skill 调用，再均摊 usage。
        let mut blocks: Vec<String> = Vec::new();
        for block in content {
            if block.get("type").and_then(Value::as_str) != Some("tool_use") {
                continue;
            }
            if block.get("name").and_then(Value::as_str) != Some("Skill") {
                continue;
            }
            let id = block
                .get("id")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty());
            if let Some(id) = id {
                if seen_block_ids.contains(id) {
                    continue;
                }
            }
            let skill_name = js_string(block.get("input").and_then(|input| input.get("skill")))
                .trim()
                .to_string();
            if skill_name.is_empty() {
                continue;
            }
            if let Some(id) = id {
                seen_block_ids.insert(id.to_string());
            }
            blocks.push(skill_name);
        }
        if blocks.is_empty() {
            continue;
        }
        let ts = obj
            .get("timestamp")
            .and_then(Value::as_str)
            .map(str::to_string);
        let turn_tokens = normalize_usage(obj.get("message").and_then(|m| m.get("usage")));
        let share = 1.0 / blocks.len() as f64;
        for skill_name in blocks {
            let entry_index = match index.get(&skill_name) {
                Some(&i) => i,
                None => {
                    let i = skills.len();
                    skills.push(UsageEntry {
                        skill: skill_name.clone(),
                        invocations: 0,
                        last_used_at: None,
                        tokens: UsageTokens::default(),
                    });
                    index.insert(skill_name, i);
                    i
                }
            };
            let entry = &mut skills[entry_index];
            entry.invocations += 1; // invocations 不摊
            if let Some(ts) = &ts {
                if entry
                    .last_used_at
                    .as_deref()
                    .map(|current| ts.as_str() > current)
                    .unwrap_or(true)
                {
                    entry.last_used_at = Some(ts.clone());
                }
            }
            entry.tokens.input += turn_tokens.input * share;
            entry.tokens.output += turn_tokens.output * share;
            entry.tokens.cached_input += turn_tokens.cached_input * share;
            entry.tokens.cache_creation += turn_tokens.cache_creation * share;
            entry.tokens.reasoning += turn_tokens.reasoning * share;
        }
    }
}

/// upstream roundTokens：四舍五入为 int + total_tokens = 五列和。
fn round_tokens(tokens: &UsageTokens) -> Value {
    let input = tokens.input.round() as i64;
    let output = tokens.output.round() as i64;
    let cached_input = tokens.cached_input.round() as i64;
    let cache_creation = tokens.cache_creation.round() as i64;
    let reasoning = tokens.reasoning.round() as i64;
    json!({
        "input_tokens": input,
        "output_tokens": output,
        "cached_input_tokens": cached_input,
        "cache_creation_input_tokens": cache_creation,
        "reasoning_output_tokens": reasoning,
        "total_tokens": input + output + cached_input + cache_creation + reasoning,
    })
}

/// upstream serialize：skills 按 invocations 降序（不输出 models）。
fn serialize_usage(skills: &[UsageEntry]) -> Vec<Value> {
    let mut entries: Vec<Value> = skills
        .iter()
        .map(|entry| {
            json!({
                "skill": entry.skill,
                "invocations": entry.invocations,
                "lastUsedAt": entry.last_used_at.as_deref().map(Value::from).unwrap_or(Value::Null),
                "tokens": round_tokens(&entry.tokens),
            })
        })
        .collect();
    entries.sort_by(|a, b| {
        let ai = a.get("invocations").and_then(Value::as_i64).unwrap_or(0);
        let bi = b.get("invocations").and_then(Value::as_i64).unwrap_or(0);
        bi.cmp(&ai)
    });
    entries
}

/// upstream scanSkillUsage：fingerprint + 10 分钟缓存；home 参数用于测试隔离。
fn scan_skill_usage(home: &Path, force: bool) -> Value {
    let files = list_transcript_files(&claude_projects_dir(home));
    let fingerprint = fingerprint_files(&files);
    if !force {
        if let Some(cached) = read_json(&usage_cache_path()) {
            if cache_hit(
                &cached,
                &fingerprint,
                "generatedAt",
                USAGE_CACHE_TTL_MS,
                "skills",
                false,
            ) {
                let mut result = cached.as_object().cloned().unwrap_or_default();
                result.insert("cached".to_string(), json!(true));
                return Value::Object(result);
            }
        }
    }

    let mut skills: Vec<UsageEntry> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    let mut seen_block_ids: HashSet<String> = HashSet::new();
    for file in &files {
        scan_transcript_file(&file.path, &mut skills, &mut index, &mut seen_block_ids);
    }
    let total_invocations: i64 = skills.iter().map(|s| s.invocations).sum();
    let result = json!({
        "fingerprint": fingerprint,
        "generatedAt": now_ms(),
        "scannedFiles": files.len(),
        "totalInvocations": total_invocations,
        "skills": serialize_usage(&skills),
    });
    // best-effort 缓存写（0o600，单行 JSON + 换行）。
    let _ = ensure_dir(&skills_root());
    if let Ok(text) = serde_json::to_string(&result) {
        let _ = write_file_private(&usage_cache_path(), &format!("{text}\n"));
    }
    let mut out = result.as_object().cloned().unwrap_or_default();
    out.insert("cached".to_string(), json!(false));
    Value::Object(out)
}

/// upstream local-api.js 的 skill_usage join：directory 精确 → directory leaf 唯一 →
/// name 唯一；unusedInstalled = 未被匹配的 installed。不输出 cost 和 models。
fn skill_usage_query(force: bool) -> Value {
    let home = home_dir();
    let usage = scan_skill_usage(&home, force);
    let installed = list_installed_skills();

    fn directory_leaf(value: &str) -> String {
        value
            .replace('\\', "/")
            .split('/')
            .filter(|part| !part.is_empty())
            .last()
            .map(|leaf| leaf.trim().to_lowercase())
            .unwrap_or_default()
    }

    let mut leaf_counts: HashMap<String, usize> = HashMap::new();
    for skill in &installed {
        let leaf = directory_leaf(&js_string(skill.get("directory")));
        if !leaf.is_empty() {
            *leaf_counts.entry(leaf).or_insert(0) += 1;
        }
    }
    let mut by_directory: HashMap<String, &Value> = HashMap::new();
    let mut by_leaf: HashMap<String, &Value> = HashMap::new();
    let mut name_counts: HashMap<String, usize> = HashMap::new();
    let mut by_name: HashMap<String, &Value> = HashMap::new();
    for skill in &installed {
        let dir = js_string(skill.get("directory")).trim().to_lowercase();
        if !dir.is_empty() {
            by_directory.insert(dir, skill);
        }
        let leaf = directory_leaf(&js_string(skill.get("directory")));
        if !leaf.is_empty() && leaf_counts.get(&leaf) == Some(&1) {
            by_leaf.insert(leaf, skill);
        }
        let name = js_string(skill.get("name")).trim().to_lowercase();
        if !name.is_empty() {
            *name_counts.entry(name.clone()).or_insert(0) += 1;
            by_name.entry(name).or_insert(skill);
        }
    }
    let find_installed = |value: &str| -> Option<&Value> {
        let norm = value.trim().to_lowercase();
        if norm.is_empty() {
            return None;
        }
        if let Some(skill) = by_directory.get(&norm) {
            return Some(skill);
        }
        if let Some(skill) = by_leaf.get(&norm) {
            return Some(skill);
        }
        if name_counts.get(&norm) == Some(&1) {
            if let Some(skill) = by_name.get(&norm) {
                return Some(skill);
            }
        }
        None
    };

    let mut used_skill_ids: HashSet<String> = HashSet::new();
    let usage_skills = usage
        .get("skills")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut joined: Vec<Value> = Vec::new();
    for entry in &usage_skills {
        let matched = find_installed(&js_string(entry.get("skill")));
        if let Some(id) = matched.and_then(|m| m.get("id")).and_then(Value::as_str) {
            if !id.is_empty() {
                used_skill_ids.insert(id.to_string());
            }
        }
        joined.push(json!({
            "skill": entry.get("skill").cloned().unwrap_or(Value::Null),
            "invocations": entry.get("invocations").cloned().unwrap_or_else(|| json!(0)),
            "lastUsedAt": entry.get("lastUsedAt").cloned().unwrap_or(Value::Null),
            "tokens": entry.get("tokens").cloned().unwrap_or(Value::Null),
            "installed": matched.is_some(),
            "skillId": matched.and_then(|m| m.get("id").cloned()).unwrap_or(Value::Null),
            "directory": matched.and_then(|m| m.get("directory").cloned()).unwrap_or(Value::Null),
        }));
    }
    let unused_installed: Vec<Value> = installed
        .iter()
        .filter(|skill| {
            skill
                .get("id")
                .and_then(Value::as_str)
                .map(|id| !used_skill_ids.contains(id))
                .unwrap_or(true)
        })
        .map(|skill| {
            json!({
                "skillId": skill.get("id").cloned().unwrap_or(Value::Null),
                "directory": skill.get("directory").cloned().unwrap_or(Value::Null),
                "name": skill.get("name").cloned().unwrap_or(Value::Null),
            })
        })
        .collect();
    json!({
        "generatedAt": usage.get("generatedAt").cloned().unwrap_or(Value::Null),
        "scannedFiles": usage.get("scannedFiles").cloned().unwrap_or_else(|| json!(0)),
        "totalInvocations": usage.get("totalInvocations").cloned().unwrap_or_else(|| json!(0)),
        "cached": usage.get("cached").cloned().unwrap_or_else(|| json!(false)),
        "skills": joined,
        "unusedInstalled": unused_installed,
    })
}

// ===== Tauri commands（对应 local-api.js 的 GET/POST 分发） =====

/// query 的 `force` 仅字符串 "1" 生效（对齐 upstream `get("force") === "1"`）。
fn param_force(params: &Value) -> bool {
    params.get("force").and_then(Value::as_str) == Some("1")
}

/// payload 里的字符串数组参数；key 缺失/非数组 → None（调用方决定默认值）。
fn string_array_param(payload: &Value, key: &str) -> Option<Vec<String>> {
    payload.get(key).and_then(Value::as_array).map(|arr| {
        arr.iter()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect()
    })
}

/// Skills Hub 查询端点（upstream GET /functions/tokentracker-skills）。
#[tauri::command]
pub(crate) async fn skills_hub_query(mode: String, params: Value) -> Result<Value, String> {
    let mode = if mode.is_empty() {
        "installed"
    } else {
        mode.as_str()
    };
    match mode {
        "installed" => tokio::task::spawn_blocking(
            || json!({"targets": target_list(), "skills": list_installed_skills()}),
        )
        .await
        .map_err(|e| format!("skills task failed: {e}")),
        "repos" => Ok(json!({"repos": list_repos()})),
        "discover" => discover_skills(param_force(&params))
            .await
            .map_err(|e| e.to_string()),
        "search" => {
            let q = js_string(params.get("q"));
            let limit = js_number_or(params.get("limit"), 20.0);
            let offset = js_number_or(params.get("offset"), 0.0);
            let client = http_client().map_err(|e| e.to_string())?;
            search_skills_sh(&client, &q, limit, offset)
                .await
                .map_err(|e| e.to_string())
        }
        "popular" => {
            let limit = js_number_or(params.get("limit"), 60.0);
            fetch_popular_skills_sh(param_force(&params), limit)
                .await
                .map_err(|e| e.to_string())
        }
        "updates" => check_updates(param_force(&params))
            .await
            .map_err(|e| e.to_string()),
        "activity" => {
            let limit = js_number_or(params.get("limit"), 50.0) as i64;
            Ok(json!({"activity": read_activity(limit)}))
        }
        "skill_usage" => {
            let force = param_force(&params);
            tokio::task::spawn_blocking(move || skill_usage_query(force))
                .await
                .map_err(|e| format!("skills task failed: {e}"))
        }
        _ => Err("Unknown skills mode".to_string()),
    }
}

/// Skills Hub 变更端点（upstream POST /functions/tokentracker-skills）。
#[tauri::command]
pub(crate) async fn skills_hub_mutate(action: String, payload: Value) -> Result<Value, String> {
    match action.as_str() {
        "install" => {
            let skill = payload.get("skill").cloned().unwrap_or(Value::Null);
            let targets = string_array_param(&payload, "targets")
                .unwrap_or_else(|| vec!["claude".to_string(), "codex".to_string()]);
            install_skill(&skill, &targets)
                .await
                .map_err(|e| e.to_string())
        }
        "uninstall" => uninstall_skill(&js_string(payload.get("id"))).map_err(|e| e.to_string()),
        "restore" => restore_skill(&js_string(payload.get("id"))).map_err(|e| e.to_string()),
        "set_targets" => {
            let targets = string_array_param(&payload, "targets").unwrap_or_default();
            set_skill_targets(&js_string(payload.get("id")), &targets).map_err(|e| e.to_string())
        }
        "import_local" => {
            let targets = string_array_param(&payload, "targets").unwrap_or_default();
            import_local_skill(&js_string(payload.get("directory")), &targets)
                .map_err(|e| e.to_string())
        }
        "delete_local" => {
            let targets = string_array_param(&payload, "targets").unwrap_or_default();
            delete_local_skill(&js_string(payload.get("directory")), &targets)
                .map_err(|e| e.to_string())
        }
        "add_repo" => {
            add_repo(payload.get("repo").unwrap_or(&Value::Null)).map_err(|e| e.to_string())
        }
        "remove_repo" => remove_repo(
            &js_string(payload.get("owner")),
            &js_string(payload.get("name")),
        )
        .map_err(|e| e.to_string()),
        _ => Err("Unknown skills action".to_string()),
    }
}

// ===== 单元测试（fs 测试全部用临时目录 + DOGE_SKILLS_HOME/HOME env 隔离，不碰真实 home） =====

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Mutex, MutexGuard};

    /// env 修改是进程级共享状态，所有改 env 的测试必须串行。
    static ENV_LOCK: Mutex<()> = Mutex::new(());
    static TEMP_COUNTER: AtomicUsize = AtomicUsize::new(0);

    /// 持有 ENV_LOCK 期间设置 env，Drop 时先恢复原值再释放锁。
    struct EnvGuard {
        saved: Vec<(&'static str, Option<std::ffi::OsString>)>,
        _lock: MutexGuard<'static, ()>,
    }

    impl EnvGuard {
        fn new(vars: &[(&'static str, &Path)]) -> Self {
            let lock = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            let mut saved = Vec::new();
            for (key, value) in vars {
                saved.push((*key, std::env::var_os(key)));
                std::env::set_var(key, value);
            }
            Self { saved, _lock: lock }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            for (key, value) in self.saved.drain(..) {
                match value {
                    Some(v) => std::env::set_var(key, v),
                    None => std::env::remove_var(key),
                }
            }
        }
    }

    /// 临时目录，Drop 时清理。
    struct TestDir(PathBuf);

    impl TestDir {
        fn new(tag: &str) -> Self {
            let unique = format!(
                "doge-skills-hub-test-{}-{}-{}",
                std::process::id(),
                TEMP_COUNTER.fetch_add(1, Ordering::Relaxed),
                tag
            );
            let path = std::env::temp_dir().join(unique);
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn sanitize_path_segment_boundaries() {
        assert_eq!(sanitize_path_segment("pdf"), Some("pdf".to_string()));
        assert_eq!(sanitize_path_segment("  pdf  "), Some("pdf".to_string()));
        assert_eq!(
            sanitize_path_segment(".hidden"),
            Some(".hidden".to_string())
        );
        assert_eq!(sanitize_path_segment(""), None);
        assert_eq!(sanitize_path_segment("."), None);
        assert_eq!(sanitize_path_segment(".."), None);
        assert_eq!(sanitize_path_segment("a/b"), None);
        assert_eq!(sanitize_path_segment("a\\b"), None);
        assert_eq!(sanitize_path_segment("a\0b"), None);
    }

    #[test]
    fn sanitize_relative_path_boundaries() {
        assert_eq!(sanitize_relative_path("a/b").as_deref(), Some("a/b"));
        assert_eq!(sanitize_relative_path("a\\b").as_deref(), Some("a/b"));
        assert_eq!(sanitize_relative_path("a//b").as_deref(), Some("a/b"));
        assert_eq!(sanitize_relative_path("  a/b  ").as_deref(), Some("a/b"));
        assert_eq!(sanitize_relative_path("~").as_deref(), Some("~"));
        assert_eq!(sanitize_relative_path(""), None);
        assert_eq!(sanitize_relative_path("/a/b"), None);
        assert_eq!(sanitize_relative_path("a/../b"), None);
        assert_eq!(sanitize_relative_path("a/./b"), None);
        assert_eq!(sanitize_relative_path("a:b"), None);
        assert_eq!(sanitize_relative_path("C:/x"), None);
        assert_eq!(sanitize_relative_path("C:\\x"), None);
        assert_eq!(sanitize_relative_path("\\\\server\\share"), None);
        assert_eq!(sanitize_relative_path("\\tmp"), None);
        assert_eq!(sanitize_relative_path("a\0b"), None);
        // drive-relative（`X:foo`）不是 win32 absolute，但段内含 `:` 同样拒绝。
        assert_eq!(sanitize_relative_path("C:foo"), None);
    }

    #[test]
    fn sanitize_local_skill_path_rejects_dot_segments() {
        assert_eq!(sanitize_local_skill_path("a/b").as_deref(), Some("a/b"));
        assert_eq!(sanitize_local_skill_path(".hidden/x"), None);
        assert_eq!(sanitize_local_skill_path("a/.hidden"), None);
        assert_eq!(sanitize_local_skill_path("a/bad:seg"), None);
    }

    #[test]
    fn install_name_from_directory_semantics() {
        assert_eq!(install_name_from_directory("a/b").as_deref(), Some("b"));
        assert_eq!(
            install_name_from_directory("single").as_deref(),
            Some("single")
        );
        assert_eq!(install_name_from_directory(".."), None);
        assert_eq!(install_name_from_directory("/abs"), None);
    }

    #[test]
    fn read_yaml_field_variants() {
        assert_eq!(read_yaml_field("name: pdf-tools\n", "name"), "pdf-tools");
        assert_eq!(
            read_yaml_field("name: \"quoted name\"\n", "name"),
            "quoted name"
        );
        assert_eq!(read_yaml_field("name: 'single'\n", "name"), "single");
        assert_eq!(read_yaml_field("other: 1\n", "name"), "");
        // key 后必须紧跟冒号。
        assert_eq!(read_yaml_field("names: nope\n", "name"), "");
        // 带缩进的 key 同样匹配。
        assert_eq!(read_yaml_field("  name: nested\n", "name"), "nested");
        // block scalar `|`：收集缩进更深的行，dedent 结束。
        let block = "description: |\n  line one\n  line two\nname: x\n";
        assert_eq!(read_yaml_field(block, "description"), "line one line two");
        // block scalar `>-`：空行折叠为空串后 join。
        let folded = "description: >-\n  first\n\n  second\ntail: 1\n";
        assert_eq!(read_yaml_field(folded, "description"), "first  second");
    }

    #[test]
    fn read_skill_metadata_frontmatter_and_fallback() {
        let md = "---\nname: pdf\ndescription: Extracts text from PDFs\n---\nbody\n";
        let meta = read_skill_metadata(md, "fallback");
        assert_eq!(meta.name, "pdf");
        assert_eq!(meta.description, "Extracts text from PDFs");
        // 无 frontmatter → 整个文本当 source，name 用 fallback。
        let no_fm = read_skill_metadata("just body", "fallback-name");
        assert_eq!(no_fm.name, "fallback-name");
        assert_eq!(no_fm.description, "");
        // fallback 也为空 → "Skill"。
        let empty = read_skill_metadata("", "");
        assert_eq!(empty.name, "Skill");
        // description 同行内多空白折叠（inline value 不跨行）。
        let spaced = read_skill_metadata("description: a   b\n\tc\n", "x");
        assert_eq!(spaced.description, "a b");
    }

    #[test]
    fn skill_md_path_detection() {
        assert!(is_skill_md_path("SKILL.md"));
        assert!(is_skill_md_path("dir/SKILL.md"));
        assert!(is_skill_md_path("dir/sub/skill.md"));
        assert!(is_skill_md_path("dir/SkIlL.Md"));
        assert!(!is_skill_md_path("dir/SKILL.md.bak"));
        assert!(!is_skill_md_path("xskill.md"));
        assert_eq!(strip_skill_md_suffix("SKILL.md"), "");
        assert_eq!(strip_skill_md_suffix("dir/SKILL.md"), "dir");
        assert_eq!(strip_skill_md_suffix("dir/sub/skill.md"), "dir/sub");
        assert_eq!(strip_skill_md_suffix("dir/other.md"), "dir/other.md");
    }

    #[test]
    fn hash_directory_stable_and_sensitive() {
        let temp = TestDir::new("hash");
        let skill = temp.path().join("skill");
        fs::create_dir_all(skill.join("sub")).unwrap();
        fs::write(skill.join("SKILL.md"), b"hello").unwrap();
        fs::write(skill.join("sub").join("a.txt"), b"aaa").unwrap();
        fs::write(skill.join(".DS_Store"), b"junk").unwrap(); // HASH_IGNORE 成员
        let first = hash_directory(&skill);
        // 两次调用一致（排序 + NUL 分隔语义稳定）。
        assert_eq!(first, hash_directory(&skill));
        // ignore 集内容变化不影响 hash。
        fs::write(skill.join(".DS_Store"), b"other junk").unwrap();
        assert_eq!(first, hash_directory(&skill));
        // 文件内容变化 → hash 变化。
        fs::write(skill.join("sub").join("a.txt"), b"aab").unwrap();
        assert_ne!(first, hash_directory(&skill));
        // exec bit 变化 → hash 变化（unix）。
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let before = hash_directory(&skill);
            fs::set_permissions(
                skill.join("sub").join("a.txt"),
                fs::Permissions::from_mode(0o755),
            )
            .unwrap();
            assert_ne!(before, hash_directory(&skill));
        }
    }

    #[test]
    fn source_signature_from_tree_semantics() {
        let tree = json!([
            {"type": "blob", "path": "skill/a.txt", "sha": "aaa"},
            {"type": "blob", "path": "skill/sub/b.txt", "sha": "bbb"},
            {"type": "blob", "path": "other/c.txt", "sha": "ccc"},
            {"type": "tree", "path": "skill/sub", "sha": "ddd"},
            {"type": "blob", "path": "skill/nosha"},
        ]);
        let tree = tree.as_array().unwrap();
        let signature = source_signature_from_tree(tree, "skill").unwrap();
        // 手工计算：排序后 "path:sha" 以 "\n" join 的 sha256。
        let mut hasher = Sha256::new();
        hasher.update("skill/a.txt:aaa\nskill/sub/b.txt:bbb");
        assert_eq!(signature, format!("{:x}", hasher.finalize()));
        assert!(source_signature_from_tree(tree, "missing").is_none());
        assert!(source_signature_from_tree(&[], "skill").is_none());
        assert!(source_signature_from_tree(tree, "").is_none());
    }

    #[test]
    fn target_skill_path_guards() {
        let temp = TestDir::new("tsp");
        let root = temp.path().join("skills");
        // root 不存在：ENOENT 放行。
        assert_eq!(
            target_skill_path(&root, "a/b"),
            Some(resolve_lexical(&root.join("a").join("b")))
        );
        fs::create_dir_all(&root).unwrap();
        // `..` / 绝对路径被拒。
        assert_eq!(target_skill_path(&root, "../x"), None);
        assert_eq!(target_skill_path(&root, "/etc/x"), None);
        // 中间祖先为 symlink → None。
        let outside = temp.path().join("outside");
        fs::create_dir_all(&outside).unwrap();
        symlink_dir(&outside, &root.join("link")).unwrap();
        assert_eq!(target_skill_path(&root, "link/x"), None);
        // 中间祖先为普通目录 → Some。
        fs::create_dir_all(root.join("group")).unwrap();
        assert!(target_skill_path(&root, "group/x").is_some());
        // root 是文件 → None。
        let file_root = temp.path().join("file-root");
        fs::write(&file_root, b"x").unwrap();
        assert_eq!(target_skill_path(&file_root, "a"), None);
    }

    #[test]
    fn assert_not_nested_semantics() {
        let base = Path::new("/tmp/ccgui-nest-check");
        assert!(assert_not_nested(base, base).is_ok()); // 同路径 = 幂等覆盖，放行
        assert!(assert_not_nested(base, &base.join("child")).is_err());
        assert!(assert_not_nested(&base.join("child"), base).is_err());
        assert!(assert_not_nested(&base.join("a"), &base.join("b")).is_ok());
    }

    #[test]
    fn classify_in_dirs_three_states() {
        let temp = TestDir::new("classify");
        let base = temp.path().join("skills");
        fs::create_dir_all(&base).unwrap();
        // 缺失 → off。
        assert_eq!(classify_in_dirs("demo", std::slice::from_ref(&base)), "off");
        // 实体目录 → synced。
        fs::create_dir_all(base.join("demo")).unwrap();
        assert_eq!(
            classify_in_dirs("demo", std::slice::from_ref(&base)),
            "synced"
        );
        // 悬空 symlink → orphan。
        fs::remove_dir_all(base.join("demo")).unwrap();
        symlink_dir(
            Path::new("/nonexistent-ccgui-test-target"),
            &base.join("demo"),
        )
        .unwrap();
        assert_eq!(
            classify_in_dirs("demo", std::slice::from_ref(&base)),
            "orphan"
        );
    }

    #[test]
    fn classify_target_skill_with_home_env() {
        let temp = TestDir::new("home");
        let _env = EnvGuard::new(&[("HOME", temp.path())]);
        let claude_skills = temp.path().join(".claude").join("skills");
        fs::create_dir_all(&claude_skills).unwrap();
        assert_eq!(classify_target_skill("demo", "claude"), "off");
        fs::create_dir_all(claude_skills.join("demo")).unwrap();
        assert_eq!(classify_target_skill("demo", "claude"), "synced");
        fs::remove_dir_all(claude_skills.join("demo")).unwrap();
        symlink_dir(
            Path::new("/nonexistent-ccgui-test-target"),
            &claude_skills.join("demo"),
        )
        .unwrap();
        assert_eq!(classify_target_skill("demo", "claude"), "orphan");
        assert_eq!(classify_target_skill("demo", "bogus-target"), "off");
    }

    #[test]
    fn registry_roundtrip_and_defaults() {
        let temp = TestDir::new("registry");
        let _env = EnvGuard::new(&[("DOGE_SKILLS_HOME", temp.path())]);
        let registry = Registry {
            repos: default_repos(),
            skills: vec![json!({"id": "o/n:dir", "directory": "dir", "targets": ["claude"]})],
        };
        save_registry(&registry).unwrap();
        // unix 下 registry.json 权限 0o600。
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(registry_path()).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }
        let loaded = read_registry();
        assert_eq!(loaded.repos.len(), 4);
        assert_eq!(loaded.skills.len(), 1);
        assert_eq!(
            loaded.skills[0].get("id").and_then(Value::as_str),
            Some("o/n:dir")
        );
        // 坏文件 → 默认值。
        fs::write(registry_path(), b"not json").unwrap();
        let loaded = read_registry();
        assert!(loaded.skills.is_empty());
        assert_eq!(loaded.repos.len(), 4);
        // repos 非数组 → DEFAULT_REPOS；skills 非数组 → []。
        fs::write(registry_path(), br#"{"repos":123,"skills":{}}"#).unwrap();
        let loaded = read_registry();
        assert_eq!(loaded.repos.len(), 4);
        assert_eq!(
            loaded.repos[0].get("owner").and_then(Value::as_str),
            Some("anthropics")
        );
        assert!(loaded.skills.is_empty());
        // 文件缺失 → 默认。
        let _ = fs::remove_file(registry_path());
        let loaded = read_registry();
        assert_eq!(loaded.repos.len(), 4);
        assert!(loaded.skills.is_empty());
    }

    #[test]
    fn purge_expired_trash_ttl() {
        let temp = TestDir::new("trash");
        let _env = EnvGuard::new(&[("DOGE_SKILLS_HOME", temp.path())]);
        // 过期条目（trashedAt 在过去）应被清理；新鲜条目保留。
        let old_stamp = now_ms() - (TRASH_TTL_MS + 60_000);
        let new_stamp = now_ms();
        let old_trash = trash_dir().join("b2xk-1");
        fs::create_dir_all(&old_trash).unwrap();
        let registry = Registry {
            repos: default_repos(),
            skills: vec![
                json!({"id": "o/n:old", "directory": "old", "trashedAt": old_stamp, "trashedDirectory": "b2xk-1"}),
                json!({"id": "o/n:new", "directory": "new", "trashedAt": new_stamp, "trashedDirectory": "bmv3-2"}),
                json!({"id": "o/n:live", "directory": "live"}),
            ],
        };
        save_registry(&registry).unwrap();
        purge_expired_trash();
        let after = read_registry();
        assert_eq!(after.skills.len(), 2);
        assert!(after
            .skills
            .iter()
            .all(|s| s.get("directory").and_then(Value::as_str) != Some("old")));
        assert!(!old_trash.exists());
    }

    fn write_transcript(home: &Path, project: &str, file: &str, lines: &[String]) {
        let dir = claude_projects_dir(home).join(project);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(file), format!("{}\n", lines.join("\n"))).unwrap();
    }

    fn skill_block_line(ts: &str, blocks: &[(&str, &str)], usage: &str) -> String {
        let content: Vec<String> = blocks
            .iter()
            .map(|(id, skill)| {
                format!(r#"{{"type":"tool_use","name":"Skill","id":"{id}","input":{{"skill":"{skill}"}}}}"#)
            })
            .collect();
        format!(
            r#"{{"timestamp":"{ts}","message":{{"model":"m","usage":{usage},"content":[{}]}}}}"#,
            content.join(",")
        )
    }

    #[test]
    fn usage_scan_dedup_share_and_last_used() {
        let home = TestDir::new("usage-home");
        let skills_home = TestDir::new("usage-skills");
        let _env = EnvGuard::new(&[("DOGE_SKILLS_HOME", skills_home.path())]);
        let line_b1 = skill_block_line(
            "2026-01-02T00:00:00.000Z",
            &[("b1", "pdf")],
            r#"{"input_tokens":100,"output_tokens":50,"cache_read_input_tokens":20,"cache_creation_input_tokens":10}"#,
        );
        write_transcript(home.path(), "p1", "a.jsonl", std::slice::from_ref(&line_b1));
        write_transcript(
            home.path(),
            "p1",
            "b.jsonl",
            &[
                line_b1, // 跨文件重复 id → 去重
                // 单 turn 两个 Skill block → usage 均摊。
                skill_block_line(
                    "2026-01-01T00:00:00.000Z",
                    &[("b2", "pdf"), ("b3", "xlsx")],
                    r#"{"input_tokens":90,"output_tokens":30}"#,
                ),
                // 预筛：不含 `"name":"Skill"` 子串的行直接跳过。
                r#"{"message":{"content":[{"type":"tool_use","name":"Other"}]}}"#.to_string(),
                // 含子串但 JSON 非法 → 跳过。
                r#"{"name":"Skill" broken"#.to_string(),
            ],
        );

        let result = scan_skill_usage(home.path(), false);
        assert_eq!(result.get("scannedFiles").and_then(Value::as_i64), Some(2));
        assert_eq!(
            result.get("totalInvocations").and_then(Value::as_i64),
            Some(3)
        );
        assert_eq!(result.get("cached").and_then(Value::as_bool), Some(false));
        let skills = result.get("skills").and_then(Value::as_array).unwrap();
        // 按 invocations 降序：pdf(2) 在前，xlsx(1) 在后。
        assert_eq!(skills.len(), 2);
        let pdf = &skills[0];
        assert_eq!(pdf.get("skill").and_then(Value::as_str), Some("pdf"));
        assert_eq!(pdf.get("invocations").and_then(Value::as_i64), Some(2));
        assert_eq!(
            pdf.get("lastUsedAt").and_then(Value::as_str),
            Some("2026-01-02T00:00:00.000Z")
        );
        let pdf_tokens = pdf.get("tokens").unwrap();
        // b1 独占 turn：100/50/20/10；b2 摊半：45/15 → 145/65/20/10。
        assert_eq!(
            pdf_tokens.get("input_tokens").and_then(Value::as_i64),
            Some(145)
        );
        assert_eq!(
            pdf_tokens.get("output_tokens").and_then(Value::as_i64),
            Some(65)
        );
        assert_eq!(
            pdf_tokens
                .get("cached_input_tokens")
                .and_then(Value::as_i64),
            Some(20)
        );
        assert_eq!(
            pdf_tokens
                .get("cache_creation_input_tokens")
                .and_then(Value::as_i64),
            Some(10)
        );
        assert_eq!(
            pdf_tokens.get("total_tokens").and_then(Value::as_i64),
            Some(240)
        );
        let xlsx = &skills[1];
        assert_eq!(xlsx.get("skill").and_then(Value::as_str), Some("xlsx"));
        assert_eq!(xlsx.get("invocations").and_then(Value::as_i64), Some(1));
        let xlsx_tokens = xlsx.get("tokens").unwrap();
        assert_eq!(
            xlsx_tokens.get("input_tokens").and_then(Value::as_i64),
            Some(45)
        );
        assert_eq!(
            xlsx_tokens.get("total_tokens").and_then(Value::as_i64),
            Some(60)
        );

        // fingerprint 不变 → 第二次命中缓存。
        let cached = scan_skill_usage(home.path(), false);
        assert_eq!(cached.get("cached").and_then(Value::as_bool), Some(true));
        assert_eq!(
            cached.get("totalInvocations").and_then(Value::as_i64),
            Some(3)
        );
        // 文件变化 → fingerprint 失效 → 重新扫描。
        write_transcript(
            home.path(),
            "p1",
            "c.jsonl",
            &[skill_block_line(
                "2026-01-03T00:00:00.000Z",
                &[("b9", "pptx")],
                r#"{"input_tokens":7}"#,
            )],
        );
        let refreshed = scan_skill_usage(home.path(), false);
        assert_eq!(
            refreshed.get("cached").and_then(Value::as_bool),
            Some(false)
        );
        assert_eq!(
            refreshed.get("totalInvocations").and_then(Value::as_i64),
            Some(4)
        );
        assert_eq!(
            refreshed.get("scannedFiles").and_then(Value::as_i64),
            Some(3)
        );
    }
}
