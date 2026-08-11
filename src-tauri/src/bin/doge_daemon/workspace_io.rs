use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::time::Instant;

use crate::backend_budget::ScanCacheState;
use crate::shared::workspace_listing::{
    build_initial_directory_entries, normalize_workspace_relative_file_path,
    normalized_relative_to_pathbuf, should_always_skip, sort_and_truncate_named_entries,
    workspace_files_response, workspace_scan_budget_reached, WorkspaceScanState,
    WORKSPACE_DIRECTORY_SCAN_BUDGET_MULTIPLIER, WORKSPACE_SCAN_TIME_BUDGET,
};
#[cfg(test)]
pub(crate) use crate::shared::workspace_listing::{
    list_workspace_directory_children_inner, list_workspace_files_inner,
};
pub(crate) use crate::shared::workspace_listing::{
    list_workspace_directory_children_inner_with_refresh, list_workspace_files_inner_with_refresh,
    WorkspaceFilesResponse,
};
#[cfg(test)]
use crate::shared::workspace_listing::{
    normalize_workspace_relative_directory_path, WorkspaceDirectoryChildState,
};
use crate::text_encoding::decode_text_bytes;
use crate::utils::normalize_git_path;

#[derive(Serialize, Deserialize)]
pub(crate) struct WorkspaceFileResponse {
    content: String,
    truncated: bool,
}

#[derive(Serialize, Deserialize)]
pub(crate) struct ExternalSpecFileResponse {
    exists: bool,
    content: String,
    truncated: bool,
}

fn normalize_external_spec_root(spec_root: &str) -> Result<PathBuf, String> {
    let trimmed = spec_root.trim();
    if trimmed.is_empty() {
        return Err("Spec root cannot be empty.".to_string());
    }
    let root = PathBuf::from(trimmed);
    if !root.is_absolute() {
        return Err("Spec root must be an absolute path.".to_string());
    }
    let canonical = root
        .canonicalize()
        .map_err(|err| format!("Failed to resolve custom spec root: {err}"))?;
    if !canonical.is_dir() {
        return Err("Custom spec root is not a directory.".to_string());
    }
    Ok(canonical)
}

struct ResolvedExternalSpecRoot {
    root: PathBuf,
    exists: bool,
}

fn resolve_external_spec_root(spec_root: &str) -> Result<ResolvedExternalSpecRoot, String> {
    let custom_root = normalize_external_spec_root(spec_root)?;
    let file_name = custom_root
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if file_name.eq_ignore_ascii_case("openspec") {
        return Ok(ResolvedExternalSpecRoot {
            root: custom_root,
            exists: true,
        });
    }

    let nested = custom_root.join("openspec");
    if nested.is_dir() {
        let canonical_nested = nested
            .canonicalize()
            .map_err(|err| format!("Failed to resolve custom spec root: {err}"))?;
        return Ok(ResolvedExternalSpecRoot {
            root: canonical_nested,
            exists: true,
        });
    }

    let legacy_root = custom_root.join("changes").is_dir() && custom_root.join("specs").is_dir();
    if legacy_root {
        return Ok(ResolvedExternalSpecRoot {
            root: custom_root,
            exists: true,
        });
    }

    Ok(ResolvedExternalSpecRoot {
        root: nested,
        exists: false,
    })
}

fn resolve_external_spec_logical_path(
    spec_root: &Path,
    logical_path: &str,
) -> Result<PathBuf, String> {
    let normalized = logical_path.trim().replace('\\', "/");
    if normalized == "openspec" {
        return Ok(spec_root.to_path_buf());
    }
    if !normalized.starts_with("openspec/") {
        return Err("External spec path must be under openspec/.".to_string());
    }
    let suffix = normalized["openspec/".len()..].trim();
    if suffix.is_empty() {
        return Ok(spec_root.to_path_buf());
    }
    let relative = Path::new(suffix);
    for component in relative.components() {
        match component {
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("Invalid external spec path.".to_string());
            }
            _ => {}
        }
    }
    Ok(spec_root.join(relative))
}

pub(crate) fn list_external_spec_tree_inner(
    spec_root: &str,
    max_files: usize,
) -> Result<WorkspaceFilesResponse, String> {
    const EXTERNAL_SPEC_TREE_MAX_FILES: usize = 8_000;
    let resolved = resolve_external_spec_root(spec_root)?;
    let effective_max_files = max_files.min(EXTERNAL_SPEC_TREE_MAX_FILES).max(1);
    let max_directories = effective_max_files.saturating_mul(2).max(1_000);
    let scan_started_at = Instant::now();
    let mut scanned_entries = 0usize;
    let mut files = Vec::new();
    let mut directories = vec!["openspec".to_string()];
    let mut limit_hit = false;
    if !resolved.exists {
        let directory_entries =
            build_initial_directory_entries(&files, &directories, WorkspaceScanState::Complete);
        return Ok(workspace_files_response(
            "list_external_spec_tree",
            "workspaces.file.external-spec-listing",
            None,
            Some(2),
            effective_max_files,
            ScanCacheState::Unsupported,
            files,
            directories,
            Vec::new(),
            Vec::new(),
            WorkspaceScanState::Complete,
            false,
            directory_entries,
        ));
    }
    let root = resolved.root;

    let walker = WalkBuilder::new(&root)
        .hidden(false)
        .follow_links(false)
        .require_git(false)
        .git_ignore(false)
        .filter_entry(|entry| {
            if entry.depth() == 0 {
                return true;
            }
            let name = entry.file_name().to_string_lossy();
            if entry.file_type().is_some_and(|ft| ft.is_dir()) {
                return !should_always_skip(&name);
            }
            name != ".DS_Store"
        })
        .build();

    for entry in walker {
        if workspace_scan_budget_reached(scan_started_at, scanned_entries) {
            limit_hit = true;
            break;
        }
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        scanned_entries = scanned_entries.saturating_add(1);
        let rel_path = match entry.path().strip_prefix(&root) {
            Ok(path) => path,
            Err(_) => continue,
        };
        let normalized = normalize_git_path(&rel_path.to_string_lossy());
        if normalized.is_empty() {
            continue;
        }
        let logical = format!("openspec/{normalized}");
        if entry.file_type().is_some_and(|ft| ft.is_dir()) {
            if directories.len() < max_directories {
                directories.push(logical);
            } else {
                limit_hit = true;
            }
        } else if entry.file_type().is_some_and(|ft| ft.is_file()) {
            files.push(logical);
            if files.len() >= effective_max_files {
                limit_hit = true;
                break;
            }
        }
    }

    files.sort();
    files.dedup();
    directories.sort();
    directories.dedup();
    let scan_state = if limit_hit {
        WorkspaceScanState::Partial
    } else {
        WorkspaceScanState::Complete
    };
    let directory_entries = build_initial_directory_entries(&files, &directories, scan_state);
    Ok(workspace_files_response(
        "list_external_spec_tree",
        "workspaces.file.external-spec-listing",
        None,
        Some(2),
        effective_max_files,
        ScanCacheState::Unsupported,
        files,
        directories,
        Vec::new(),
        Vec::new(),
        scan_state,
        limit_hit,
        directory_entries,
    ))
}

pub(crate) fn list_external_absolute_directory_children_inner(
    absolute_directory_path: &str,
    allowed_roots: &[PathBuf],
    max_entries: usize,
) -> Result<WorkspaceFilesResponse, String> {
    let canonical_path = resolve_allowed_external_absolute_path(
        absolute_directory_path,
        allowed_roots,
        "directory",
        "Invalid directory path.",
    )?;

    let entries = std::fs::read_dir(&canonical_path)
        .map_err(|err| format!("Failed to read directory: {err}"))?;
    let scan_started_at = Instant::now();
    let max_scanned_entries = max_entries
        .saturating_mul(WORKSPACE_DIRECTORY_SCAN_BUDGET_MULTIPLIER)
        .max(max_entries);
    let mut sorted_entries = Vec::new();
    let mut limit_hit = false;
    for entry in entries {
        if scan_started_at.elapsed() >= WORKSPACE_SCAN_TIME_BUDGET {
            limit_hit = true;
            break;
        }
        if sorted_entries.len() >= max_scanned_entries {
            limit_hit = true;
            break;
        }
        if let Ok(entry) = entry {
            sorted_entries.push((entry.file_name().to_string_lossy().to_string(), entry));
        }
    }
    sort_and_truncate_named_entries(&mut sorted_entries, max_scanned_entries);

    let mut files = Vec::new();
    let mut directories = Vec::new();
    for (name, entry) in sorted_entries {
        let path = entry.path();
        let normalized = normalize_git_path(&path.to_string_lossy());
        if normalized.is_empty() {
            continue;
        }
        let file_type = match entry.file_type() {
            Ok(value) => value,
            Err(_) => continue,
        };
        if file_type.is_dir() {
            if should_always_skip(&name) {
                continue;
            }
            directories.push(normalized);
        } else if file_type.is_file() {
            if name == ".DS_Store" {
                continue;
            }
            files.push(normalized);
        }

        if files.len() + directories.len() >= max_entries {
            limit_hit = true;
            break;
        }
    }

    files.sort();
    files.dedup();
    directories.sort();
    directories.dedup();
    let scan_state = if limit_hit {
        WorkspaceScanState::Partial
    } else {
        WorkspaceScanState::Complete
    };
    Ok(workspace_files_response(
        "list_external_absolute_directory_children",
        "workspaces.file.external-subtree-listing",
        Some(absolute_directory_path),
        Some(1),
        max_entries,
        ScanCacheState::Unsupported,
        files,
        directories,
        Vec::new(),
        Vec::new(),
        scan_state,
        limit_hit,
        Vec::new(),
    ))
}

const MAX_WORKSPACE_FILE_BYTES: u64 = 400_000;
const MAX_WORKSPACE_PREVIEW_FILE_BYTES: u64 = 4 * 1024 * 1024;

pub(crate) fn read_external_spec_file_inner(
    spec_root: &str,
    logical_path: &str,
) -> Result<ExternalSpecFileResponse, String> {
    let resolved = resolve_external_spec_root(spec_root)?;
    if !resolved.exists {
        return Ok(ExternalSpecFileResponse {
            exists: false,
            content: String::new(),
            truncated: false,
        });
    }
    let root = resolved.root;
    let candidate = resolve_external_spec_logical_path(&root, logical_path)?;
    if !candidate.exists() {
        return Ok(ExternalSpecFileResponse {
            exists: false,
            content: String::new(),
            truncated: false,
        });
    }

    let canonical_path = candidate
        .canonicalize()
        .map_err(|err| format!("Failed to resolve external spec file: {err}"))?;
    if !canonical_path.starts_with(&root) {
        return Err("Invalid external spec file path.".to_string());
    }
    let metadata = std::fs::metadata(&canonical_path)
        .map_err(|err| format!("Failed to read external spec file metadata: {err}"))?;
    if !metadata.is_file() {
        return Ok(ExternalSpecFileResponse {
            exists: false,
            content: String::new(),
            truncated: false,
        });
    }

    let file = File::open(&canonical_path)
        .map_err(|err| format!("Failed to open external spec file: {err}"))?;
    let mut buffer = Vec::new();
    file.take(MAX_WORKSPACE_FILE_BYTES + 1)
        .read_to_end(&mut buffer)
        .map_err(|err| format!("Failed to read external spec file: {err}"))?;

    let truncated = buffer.len() > MAX_WORKSPACE_FILE_BYTES as usize;
    if truncated {
        buffer.truncate(MAX_WORKSPACE_FILE_BYTES as usize);
    }
    let content = decode_text_bytes(&buffer, "External spec file")?;
    Ok(ExternalSpecFileResponse {
        exists: true,
        content,
        truncated,
    })
}

pub(crate) fn write_external_spec_file_inner(
    spec_root: &str,
    logical_path: &str,
    content: &str,
) -> Result<(), String> {
    if content.len() > MAX_WORKSPACE_FILE_BYTES as usize {
        return Err("File content exceeds maximum allowed size".to_string());
    }
    let resolved = resolve_external_spec_root(spec_root)?;
    let root = resolved.root;
    let candidate = resolve_external_spec_logical_path(&root, logical_path)?;
    if candidate == root {
        return Err("Cannot write to external spec root directory directly.".to_string());
    }

    let normalized = logical_path.replace('\\', "/");
    if normalized == ".git"
        || normalized.starts_with(".git/")
        || normalized.contains("/.git/")
        || normalized.ends_with("/.git")
    {
        return Err("Cannot write to .git directory".to_string());
    }

    if let Some(parent) = candidate.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create external spec parent directory: {err}"))?;
        let canonical_root = root
            .canonicalize()
            .map_err(|err| format!("Failed to resolve external spec root: {err}"))?;
        let canonical_parent = parent
            .canonicalize()
            .map_err(|err| format!("Failed to resolve external spec parent directory: {err}"))?;
        if !canonical_parent.starts_with(&canonical_root) {
            return Err("Invalid external spec file path.".to_string());
        }
        if let Ok(metadata) = std::fs::symlink_metadata(&candidate) {
            if metadata.file_type().is_symlink() {
                return Err("Cannot write to symlinked external spec file.".to_string());
            }
            if !metadata.is_file() {
                return Err("External spec path is not a file.".to_string());
            }
            let canonical_candidate = candidate
                .canonicalize()
                .map_err(|err| format!("Failed to resolve external spec file: {err}"))?;
            if !canonical_candidate.starts_with(&canonical_root) {
                return Err("Invalid external spec file path.".to_string());
            }
        }
    } else {
        return Err("Invalid external spec file path.".to_string());
    }

    std::fs::write(&candidate, content)
        .map_err(|err| format!("Failed to write external spec file: {err}"))?;
    Ok(())
}

pub(crate) fn read_workspace_file_inner(
    root: &PathBuf,
    relative_path: &str,
) -> Result<WorkspaceFileResponse, String> {
    read_workspace_file_with_limit_inner(root, relative_path, MAX_WORKSPACE_FILE_BYTES)
}

pub(crate) fn read_workspace_file_preview_inner(
    root: &PathBuf,
    relative_path: &str,
) -> Result<WorkspaceFileResponse, String> {
    read_workspace_file_with_limit_inner(root, relative_path, MAX_WORKSPACE_PREVIEW_FILE_BYTES)
}

fn read_workspace_file_with_limit_inner(
    root: &PathBuf,
    relative_path: &str,
    max_bytes: u64,
) -> Result<WorkspaceFileResponse, String> {
    let normalized_path = normalize_workspace_relative_file_path(relative_path)?;
    let canonical_root = root
        .canonicalize()
        .map_err(|err| format!("Failed to resolve workspace root: {err}"))?;
    let candidate = canonical_root.join(normalized_relative_to_pathbuf(&normalized_path));
    let canonical_path = candidate
        .canonicalize()
        .map_err(|err| format!("Failed to open file: {err}"))?;
    if !canonical_path.starts_with(&canonical_root) {
        return Err("Invalid file path".to_string());
    }
    let metadata = std::fs::metadata(&canonical_path)
        .map_err(|err| format!("Failed to read file metadata: {err}"))?;
    if !metadata.is_file() {
        return Err("Path is not a file".to_string());
    }

    let file = File::open(&canonical_path).map_err(|err| format!("Failed to open file: {err}"))?;
    let mut buffer = Vec::new();
    file.take(max_bytes + 1)
        .read_to_end(&mut buffer)
        .map_err(|err| format!("Failed to read file: {err}"))?;

    let truncated = buffer.len() > max_bytes as usize;
    if truncated {
        buffer.truncate(max_bytes as usize);
    }

    let content = decode_text_bytes(&buffer, "File")?;
    Ok(WorkspaceFileResponse { content, truncated })
}

pub(crate) fn read_external_absolute_file_inner(
    absolute_path: &str,
    allowed_roots: &[PathBuf],
) -> Result<WorkspaceFileResponse, String> {
    let canonical_path = resolve_allowed_external_absolute_path(
        absolute_path,
        allowed_roots,
        "file",
        "Invalid file path",
    )?;

    let file = File::open(&canonical_path).map_err(|err| format!("Failed to open file: {err}"))?;
    let mut buffer = Vec::new();
    file.take(MAX_WORKSPACE_FILE_BYTES + 1)
        .read_to_end(&mut buffer)
        .map_err(|err| format!("Failed to read file: {err}"))?;

    let truncated = buffer.len() > MAX_WORKSPACE_FILE_BYTES as usize;
    if truncated {
        buffer.truncate(MAX_WORKSPACE_FILE_BYTES as usize);
    }

    let content = decode_text_bytes(&buffer, "File")?;
    Ok(WorkspaceFileResponse { content, truncated })
}

pub(crate) fn write_external_absolute_file_inner(
    absolute_path: &str,
    allowed_roots: &[PathBuf],
    content: &str,
) -> Result<(), String> {
    if content.len() > MAX_WORKSPACE_FILE_BYTES as usize {
        return Err("File content exceeds maximum allowed size".to_string());
    }

    let canonical_path = resolve_allowed_external_absolute_path(
        absolute_path,
        allowed_roots,
        "file",
        "Invalid file path",
    )?;

    std::fs::write(&canonical_path, content)
        .map_err(|err| format!("Failed to write file: {err}"))?;
    Ok(())
}

fn resolve_allowed_external_absolute_path(
    absolute_path: &str,
    allowed_roots: &[PathBuf],
    expected_kind: &str,
    invalid_path_message: &str,
) -> Result<PathBuf, String> {
    let trimmed = absolute_path.trim();
    if trimmed.is_empty() {
        return Err(invalid_path_message.to_string());
    }

    let raw_path = PathBuf::from(trimmed);
    if !raw_path.is_absolute() {
        return Err(invalid_path_message.to_string());
    }

    let canonical_path = raw_path
        .canonicalize()
        .map_err(|err| format!("Failed to open file: {err}"))?;

    let mut within_allowed_root = false;
    for root in allowed_roots {
        if let Ok(canonical_root) = root.canonicalize() {
            if canonical_path.starts_with(&canonical_root) {
                within_allowed_root = true;
                break;
            }
        }
    }
    if !within_allowed_root {
        return Err("Path is not within allowed directories.".to_string());
    }

    let metadata = std::fs::metadata(&canonical_path)
        .map_err(|err| format!("Failed to read file metadata: {err}"))?;
    let kind_matches = match expected_kind {
        "file" => metadata.is_file(),
        "directory" => metadata.is_dir(),
        _ => false,
    };
    if !kind_matches {
        return Err(format!("Path is not a {expected_kind}."));
    }
    Ok(canonical_path)
}

#[cfg(test)]
mod tests {
    use super::{
        list_workspace_directory_children_inner, list_workspace_files_inner,
        normalize_workspace_relative_directory_path, read_workspace_file_inner,
        write_external_spec_file_inner, WorkspaceDirectoryChildState,
    };
    use crate::backend_budget::ScanCacheState;
    use std::fs;
    use std::path::{Path, PathBuf};
    use uuid::Uuid;

    fn temp_dir(prefix: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("{prefix}-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    #[test]
    fn read_workspace_file_rejects_git_directory_access() {
        let root = temp_dir("ccgui-workspace-io");
        fs::create_dir_all(root.join(".git")).expect("create git dir");
        fs::write(root.join(".git").join("config"), "[core]\n").expect("write git config");

        let result = read_workspace_file_inner(&root, ".git/config");

        assert!(result.is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn read_workspace_file_accepts_windows_style_relative_path() {
        let root = temp_dir("ccgui-workspace-io");
        fs::create_dir_all(root.join("nested").join("dir")).expect("create nested dir");
        fs::write(root.join("nested").join("dir").join("file.txt"), "hello").expect("write file");

        let result = read_workspace_file_inner(&root, "nested\\dir\\file.txt")
            .expect("read windows-style relative path");

        assert_eq!(result.content, "hello");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn directory_path_accepts_root_sentinel_without_weakening_file_paths() {
        assert_eq!(
            normalize_workspace_relative_directory_path("").expect("root path"),
            ""
        );
        assert!(normalize_workspace_relative_directory_path("   ").is_err());
        assert!(normalize_workspace_relative_directory_path("/").is_err());
        assert!(read_workspace_file_inner(&temp_dir("ccgui-file-path"), "").is_err());
        assert!(normalize_workspace_relative_directory_path("../outside").is_err());
        assert!(normalize_workspace_relative_directory_path(".git/config").is_err());
    }

    #[test]
    fn list_workspace_directory_children_accepts_empty_path_as_root() {
        let root = temp_dir("ccgui-root-children");
        fs::create_dir_all(root.join("src")).expect("create src dir");
        fs::write(root.join("README.md"), "# test\n").expect("write readme");
        fs::write(root.join("src").join("main.ts"), "main\n").expect("write nested file");

        let response =
            list_workspace_directory_children_inner(&root, "", 10).expect("list root children");

        assert_eq!(response.files, vec!["README.md".to_string()]);
        assert_eq!(response.directories, vec!["src".to_string()]);
        assert!(!response.files.contains(&"src/main.ts".to_string()));
        assert!(response
            .directory_entries
            .iter()
            .any(|entry| entry.path == "src"
                && entry.child_state == WorkspaceDirectoryChildState::Unknown));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn list_workspace_directory_children_defers_root_gitignore_markers() {
        let root = temp_dir("ccgui-root-gitignore");
        fs::create_dir_all(root.join("src")).expect("create src dir");
        fs::write(root.join(".gitignore"), "src/ignored.ts\n").expect("write gitignore");
        fs::write(root.join("src").join("ignored.ts"), "ignored\n").expect("write ignored file");
        git2::Repository::init(&root).expect("init git repo");

        let root_response =
            list_workspace_directory_children_inner(&root, "", 10).expect("list root children");
        assert!(root_response.gitignored_files.is_empty());
        assert!(root_response.gitignored_directories.is_empty());

        let src_response =
            list_workspace_directory_children_inner(&root, "src", 10).expect("list src children");
        assert_eq!(
            src_response.gitignored_files,
            vec!["src/ignored.ts".to_string()]
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn daemon_list_workspace_files_reports_cache_miss_hit_and_invalidation() {
        let root = temp_dir("ccgui-files-cache");
        fs::create_dir_all(root.join("src").join("deep")).expect("create deep dir");
        fs::write(root.join("src").join("deep").join("a.ts"), "a\n").expect("write a");

        let first = list_workspace_files_inner(&root, 20);
        assert_eq!(
            first
                .payload_budget
                .as_ref()
                .expect("first payload budget")
                .cache_state,
            ScanCacheState::Miss
        );

        let second = list_workspace_files_inner(&root, 20);
        assert_eq!(
            second
                .payload_budget
                .as_ref()
                .expect("second payload budget")
                .cache_state,
            ScanCacheState::Hit
        );

        fs::write(root.join("src").join("deep").join("b.ts"), "b\n").expect("write b");
        let third = list_workspace_files_inner(&root, 20);
        assert_eq!(
            third
                .payload_budget
                .as_ref()
                .expect("third payload budget")
                .cache_state,
            ScanCacheState::Invalidated
        );
        assert!(third.files.iter().any(|path| path == "src/deep/b.ts"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn daemon_list_workspace_directory_children_reports_cache_states() {
        let root = temp_dir("ccgui-dir-cache");
        fs::create_dir_all(root.join("bucket")).expect("create bucket dir");
        fs::write(root.join("bucket").join("a.ts"), "a\n").expect("write a");

        let first =
            list_workspace_directory_children_inner(&root, "bucket", 10).expect("first children");
        assert_eq!(
            first
                .payload_budget
                .as_ref()
                .expect("first payload budget")
                .cache_state,
            ScanCacheState::Miss
        );

        let second =
            list_workspace_directory_children_inner(&root, "bucket", 10).expect("second children");
        assert_eq!(
            second
                .payload_budget
                .as_ref()
                .expect("second payload budget")
                .cache_state,
            ScanCacheState::Hit
        );

        fs::write(root.join("bucket").join("b.ts"), "b\n").expect("write b");
        let third =
            list_workspace_directory_children_inner(&root, "bucket", 10).expect("third children");
        assert_eq!(
            third
                .payload_budget
                .as_ref()
                .expect("third payload budget")
                .cache_state,
            ScanCacheState::Invalidated
        );
        assert!(third.files.iter().any(|path| path == "bucket/b.ts"));

        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn write_external_spec_file_rejects_existing_symlink_target() {
        use std::os::unix::fs::symlink;

        let project_root = temp_dir("ccgui-external-spec");
        let openspec_root = project_root.join("openspec");
        let outside_root = temp_dir("ccgui-external-outside");
        fs::create_dir_all(openspec_root.join("changes")).expect("create changes");
        fs::create_dir_all(openspec_root.join("specs")).expect("create specs");
        let outside_file = outside_root.join("outside.md");
        fs::write(&outside_file, "outside").expect("write outside");
        symlink(
            &outside_file,
            openspec_root.join("changes").join("linked.md"),
        )
        .expect("create symlink");

        let result = write_external_spec_file_inner(
            project_root.to_string_lossy().as_ref(),
            "openspec/changes/linked.md",
            "modified",
        );

        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(Path::new(&outside_file)).expect("read outside"),
            "outside"
        );
        let _ = fs::remove_dir_all(project_root);
        let _ = fs::remove_dir_all(outside_root);
    }
}
