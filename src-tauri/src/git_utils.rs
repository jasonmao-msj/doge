use std::collections::{HashMap, HashSet};
use std::path::{Component, Path, PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use git2::{
    BranchType, Delta, DiffOptions, ErrorCode, Repository, Status, StatusEntry, StatusOptions, Tree,
};
use ignore::WalkBuilder;

use crate::types::{
    GitBlameHunk, GitCommitDiff, GitFileBlameResponse, GitLogEntry, GitRepositoryFileStatus,
    GitRepositorySummary, WorkspaceEntry,
};
use crate::utils::normalize_git_path;

const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;

pub(crate) const GIT_RESTORE_UNSTAGED_PREFIX: &[&str] = &["restore", "--worktree", "--"];

pub(crate) fn git_restore_unstaged_args(path: &str) -> [&str; 4] {
    ["restore", "--worktree", "--", path]
}

pub(crate) fn image_mime_type(path: &str) -> Option<&'static str> {
    let ext = Path::new(path)
        .extension()
        .and_then(|value| value.to_str())?
        .to_ascii_lowercase();
    match ext.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "svg" => Some("image/svg+xml"),
        "bmp" => Some("image/bmp"),
        "ico" => Some("image/x-icon"),
        _ => None,
    }
}

fn encode_image_base64(data: &[u8]) -> Option<String> {
    if data.len() > MAX_IMAGE_BYTES {
        return None;
    }
    Some(STANDARD.encode(data))
}

pub(crate) fn blob_to_base64(blob: git2::Blob) -> Option<String> {
    if blob.size() > MAX_IMAGE_BYTES {
        return None;
    }
    encode_image_base64(blob.content())
}

pub(crate) fn read_image_base64(path: &Path) -> Option<String> {
    let metadata = std::fs::metadata(path).ok()?;
    if metadata.len() > MAX_IMAGE_BYTES as u64 {
        return None;
    }
    let data = std::fs::read(path).ok()?;
    encode_image_base64(&data)
}

pub(crate) fn build_image_commit_diff(
    repo: &Repository,
    parent_tree: Option<&Tree<'_>>,
    commit_tree: &Tree<'_>,
    delta: &git2::DiffDelta<'_>,
    status: &str,
) -> Option<GitCommitDiff> {
    let old_path = delta.old_file().path();
    let new_path = delta.new_file().path();
    let old_path_text = old_path.map(|path| path.to_string_lossy());
    let new_path_text = new_path.map(|path| path.to_string_lossy());
    let old_image_mime = old_path_text.as_deref().and_then(image_mime_type);
    let new_image_mime = new_path_text.as_deref().and_then(image_mime_type);
    if old_image_mime.is_none() && new_image_mime.is_none() {
        return None;
    }

    let display_path = new_path.or(old_path)?;
    let is_added = delta.status() == git2::Delta::Added;
    let is_deleted = delta.status() == git2::Delta::Deleted;
    let old_image_data = if !is_added && old_image_mime.is_some() {
        parent_tree
            .and_then(|tree| old_path.and_then(|path| tree.get_path(path).ok()))
            .and_then(|entry| repo.find_blob(entry.id()).ok())
            .and_then(blob_to_base64)
    } else {
        None
    };
    let new_image_data = if !is_deleted && new_image_mime.is_some() {
        new_path
            .and_then(|path| commit_tree.get_path(path).ok())
            .and_then(|entry| repo.find_blob(entry.id()).ok())
            .and_then(blob_to_base64)
    } else {
        None
    };

    Some(GitCommitDiff {
        path: normalize_git_path(&display_path.to_string_lossy()),
        status: status.to_string(),
        diff: String::new(),
        is_binary: true,
        is_image: true,
        old_image_data,
        new_image_data,
        old_image_mime: old_image_mime.map(str::to_string),
        new_image_mime: new_image_mime.map(str::to_string),
    })
}

pub(crate) fn commit_to_entry(commit: git2::Commit) -> GitLogEntry {
    let summary = commit.summary().unwrap_or("").to_string();
    let author = commit.author().name().unwrap_or("").to_string();
    let timestamp = commit.time().seconds();
    GitLogEntry {
        sha: commit.id().to_string(),
        summary,
        author,
        timestamp,
    }
}

const GIT_BLAME_MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const GIT_BLAME_MAX_LINES: usize = 50_000;

fn validate_git_blame_path(path: &str) -> Result<String, String> {
    let trimmed = path.trim();
    let normalized = normalize_git_path(trimmed);
    let has_windows_prefix = normalized.as_bytes().get(1) == Some(&b':');
    if normalized.is_empty() {
        return Err("Git blame path is required.".to_string());
    }
    if normalized.starts_with('/') || has_windows_prefix {
        return Err("Invalid Git blame path: repository-relative path required.".to_string());
    }
    let relative = Path::new(&normalized);
    if relative.is_absolute()
        || relative.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("Invalid Git blame path: repository-relative path required.".to_string());
    }
    Ok(normalized)
}

pub(crate) fn build_git_file_blame(
    repo_root: &Path,
    path: &str,
) -> Result<GitFileBlameResponse, String> {
    let normalized_path = validate_git_blame_path(path)?;
    let canonical_repo_root = repo_root
        .canonicalize()
        .map_err(|error| format!("Failed to resolve Git blame repository root: {error}"))?;
    let absolute_path = canonical_repo_root.join(&normalized_path);
    let canonical_path = absolute_path
        .canonicalize()
        .map_err(|error| format!("Failed to resolve Git blame file {normalized_path}: {error}"))?;
    if !canonical_path.starts_with(&canonical_repo_root) {
        return Err("Invalid Git blame path: target resolves outside the repository.".to_string());
    }
    let metadata = std::fs::metadata(&canonical_path)
        .map_err(|error| format!("Failed to inspect Git blame file {normalized_path}: {error}"))?;
    if !metadata.is_file() {
        return Err(format!("Git blame target is not a file: {normalized_path}"));
    }
    if metadata.len() > GIT_BLAME_MAX_FILE_BYTES {
        return Err(format!(
            "Git blame is unavailable for files larger than {GIT_BLAME_MAX_FILE_BYTES} bytes."
        ));
    }

    let buffer = std::fs::read(&canonical_path)
        .map_err(|error| format!("Failed to read Git blame file {normalized_path}: {error}"))?;
    let line_count = buffer.iter().filter(|byte| **byte == b'\n').count() + 1;
    if line_count > GIT_BLAME_MAX_LINES {
        return Err(format!(
            "Git blame is unavailable for files with more than {GIT_BLAME_MAX_LINES} lines."
        ));
    }

    let repo = Repository::open_ext(
        &canonical_repo_root,
        git2::RepositoryOpenFlags::NO_SEARCH,
        std::iter::empty::<&Path>(),
    )
    .map_err(|error| format!("Failed to open Git repository for blame: {error}"))?;
    let head_sha = repo
        .head()
        .and_then(|head| head.peel_to_commit())
        .map(|commit| commit.id().to_string())
        .map_err(|error| format!("Failed to resolve Git HEAD for blame: {error}"))?;
    let committed_blame = repo
        .blame_file(Path::new(&normalized_path), None)
        .map_err(|error| format!("Failed to blame {normalized_path}: {error}"))?;
    let blame = committed_blame.blame_buffer(&buffer).map_err(|error| {
        format!("Failed to map working tree blame for {normalized_path}: {error}")
    })?;

    let mut commit_metadata: HashMap<git2::Oid, (String, i64, String)> = HashMap::new();
    let mut hunks = Vec::with_capacity(blame.len());
    for hunk in blame.iter() {
        let oid = hunk.final_commit_id();
        let (author, authored_at, summary) = if oid.is_zero() {
            (
                "Uncommitted".to_string(),
                0,
                "Uncommitted changes".to_string(),
            )
        } else if let Some(metadata) = commit_metadata.get(&oid) {
            metadata.clone()
        } else {
            let commit = repo.find_commit(oid).map_err(|error| {
                format!("Failed to resolve blame commit {oid} for {normalized_path}: {error}")
            })?;
            let metadata = (
                commit.author().name().unwrap_or("Unknown").to_string(),
                commit.time().seconds(),
                commit.summary().unwrap_or("").to_string(),
            );
            commit_metadata.insert(oid, metadata.clone());
            metadata
        };
        hunks.push(GitBlameHunk {
            start_line: hunk.final_start_line(),
            line_count: hunk.lines_in_hunk(),
            commit_sha: if oid.is_zero() {
                String::new()
            } else {
                oid.to_string()
            },
            author,
            authored_at,
            summary,
            original_path: hunk
                .path()
                .map(|original_path| normalize_git_path(&original_path.to_string_lossy())),
        });
    }

    Ok(GitFileBlameResponse {
        path: normalized_path,
        head_sha,
        line_count,
        hunks,
    })
}

pub(crate) fn checkout_branch(repo: &Repository, name: &str) -> Result<(), git2::Error> {
    let refname = format!("refs/heads/{name}");
    repo.set_head(&refname)?;
    let mut options = git2::build::CheckoutBuilder::new();
    options.safe();
    repo.checkout_head(Some(&mut options))?;
    Ok(())
}

pub(crate) fn find_git_diff_renames(diff: &mut git2::Diff<'_>) -> Result<(), git2::Error> {
    let mut options = git2::DiffFindOptions::new();
    options.renames(true).for_untracked(true);
    diff.find_similar(Some(&mut options))
}

pub(crate) fn git_status_identity_paths(identity: &GitStatusPathIdentity) -> Vec<String> {
    let mut paths = Vec::with_capacity(2);
    if let Some(old_path) = identity.old_path.as_ref() {
        paths.push(old_path.clone());
    }
    if !paths.contains(&identity.path) {
        paths.push(identity.path.clone());
    }
    paths
}

pub(crate) fn diff_stats_for_identity(
    repo: &Repository,
    head_tree: Option<&Tree>,
    identity: &GitStatusPathIdentity,
    layer: GitStatusLayer,
) -> Result<(i64, i64), git2::Error> {
    let mut options = DiffOptions::new();
    for path in git_status_identity_paths(identity) {
        options.pathspec(path);
    }
    if layer == GitStatusLayer::Workdir {
        options
            .include_untracked(true)
            .recurse_untracked_dirs(true)
            .show_untracked_content(true);
    }

    let mut diff = match layer {
        GitStatusLayer::Index => repo.diff_tree_to_index(head_tree, None, Some(&mut options))?,
        GitStatusLayer::Workdir => repo.diff_index_to_workdir(None, Some(&mut options))?,
    };
    find_git_diff_renames(&mut diff)?;
    let stats = diff.stats()?;
    Ok((stats.insertions() as i64, stats.deletions() as i64))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum GitStatusLayer {
    Index,
    Workdir,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct GitStatusPathIdentity {
    pub(crate) path: String,
    pub(crate) old_path: Option<String>,
}

fn normalized_status_path(path: Option<&Path>) -> Option<String> {
    let path = path?;
    let normalized = normalize_git_path(&path.to_string_lossy());
    (!normalized.is_empty()).then_some(normalized)
}

pub(crate) fn git_status_path_identity(
    entry: &StatusEntry<'_>,
    layer: GitStatusLayer,
) -> Option<GitStatusPathIdentity> {
    let fallback_path = entry
        .path()
        .map(normalize_git_path)
        .filter(|path| !path.is_empty());
    let delta = match layer {
        GitStatusLayer::Index => entry.head_to_index(),
        GitStatusLayer::Workdir => entry.index_to_workdir(),
    };
    let Some(delta) = delta else {
        return fallback_path.map(|path| GitStatusPathIdentity {
            path,
            old_path: None,
        });
    };

    let old_path = normalized_status_path(delta.old_file().path());
    let new_path = normalized_status_path(delta.new_file().path());
    let path = if delta.status() == Delta::Deleted {
        old_path.clone().or(new_path)
    } else {
        new_path.or_else(|| old_path.clone())
    }
    .or(fallback_path)?;
    let old_path = (delta.status() == Delta::Renamed)
        .then_some(old_path)
        .flatten()
        .filter(|old_path| old_path != &path);

    Some(GitStatusPathIdentity { path, old_path })
}

fn git_statuses_with_renames(repo: &Repository) -> Result<git2::Statuses<'_>, git2::Error> {
    let mut status_options = StatusOptions::new();
    status_options
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true)
        .include_ignored(false);
    repo.statuses(Some(&mut status_options))
}

pub(crate) fn git_action_paths_for_file(
    repo_root: &Path,
    path: &str,
    layer: GitStatusLayer,
) -> Vec<String> {
    let target = normalize_git_path(path).trim().to_string();
    if target.is_empty() {
        return Vec::new();
    }

    let repo = match Repository::open_ext(
        repo_root,
        git2::RepositoryOpenFlags::NO_SEARCH,
        std::iter::empty::<&Path>(),
    ) {
        Ok(repo) => repo,
        Err(_) => return vec![target],
    };
    let statuses = match git_statuses_with_renames(&repo) {
        Ok(statuses) => statuses,
        Err(_) => return vec![target],
    };

    for entry in statuses.iter() {
        let Some(identity) = git_status_path_identity(&entry, layer) else {
            continue;
        };
        let Some(old_path) = identity.old_path.as_ref() else {
            continue;
        };
        if old_path != &target && identity.path != target {
            continue;
        }
        return git_status_identity_paths(&identity);
    }

    vec![target]
}

pub(crate) fn git_diff_paths_for_file(repo_root: &Path, path: &str) -> Vec<String> {
    let target = normalize_git_path(path).trim().to_string();
    if target.is_empty() {
        return Vec::new();
    }

    let repo = match Repository::open_ext(
        repo_root,
        git2::RepositoryOpenFlags::NO_SEARCH,
        std::iter::empty::<&Path>(),
    ) {
        Ok(repo) => repo,
        Err(_) => return vec![target],
    };
    let statuses = match git_statuses_with_renames(&repo) {
        Ok(statuses) => statuses,
        Err(_) => return vec![target],
    };
    let mut rename_pairs = Vec::new();
    for entry in statuses.iter() {
        for layer in [GitStatusLayer::Index, GitStatusLayer::Workdir] {
            let Some(identity) = git_status_path_identity(&entry, layer) else {
                continue;
            };
            let Some(old_path) = identity.old_path else {
                continue;
            };
            rename_pairs.push((old_path, identity.path));
        }
    }

    let mut connected_paths = HashSet::from([target.clone()]);
    loop {
        let mut expanded = false;
        for (old_path, new_path) in &rename_pairs {
            if !connected_paths.contains(old_path) && !connected_paths.contains(new_path) {
                continue;
            }
            expanded |= connected_paths.insert(old_path.clone());
            expanded |= connected_paths.insert(new_path.clone());
        }
        if !expanded {
            break;
        }
    }

    let mut paths = Vec::new();
    for (old_path, new_path) in rename_pairs {
        if connected_paths.contains(&old_path) && connected_paths.contains(&new_path) {
            if !paths.contains(&old_path) {
                paths.push(old_path);
            }
            if !paths.contains(&new_path) {
                paths.push(new_path);
            }
        }
    }
    if paths.is_empty() {
        paths.push(target);
    }
    paths
}

pub(crate) fn diff_patch_to_string(patch: &mut git2::Patch) -> Result<String, git2::Error> {
    let buf = patch.to_buf()?;
    Ok(buf
        .as_str()
        .map(|value| value.to_string())
        .unwrap_or_else(|| String::from_utf8_lossy(&buf).to_string()))
}

#[cfg(test)]
mod tests {
    use super::{
        build_git_file_blame, build_image_commit_diff, compact_repository_status,
        diff_stats_for_identity, find_git_diff_renames, git_action_paths_for_file,
        git_diff_paths_for_file, git_restore_unstaged_args, git_status_path_identity,
        image_mime_type, list_git_repository_summaries, path_has_git_repository_marker,
        resolve_git_root_for_scope, GitStatusLayer, GIT_RESTORE_UNSTAGED_PREFIX,
    };
    use crate::types::{WorkspaceEntry, WorkspaceKind, WorkspaceSettings};
    use git2::{Delta, DiffOptions, Repository, Signature, Status, StatusOptions};
    use std::fs;

    #[test]
    fn unstaged_restore_arguments_never_mutate_the_index() {
        assert_eq!(
            git_restore_unstaged_args("src/main.rs"),
            ["restore", "--worktree", "--", "src/main.rs"]
        );
        assert!(!GIT_RESTORE_UNSTAGED_PREFIX.contains(&"--staged"));
    }

    fn workspace_entry(path: &std::path::Path) -> WorkspaceEntry {
        WorkspaceEntry {
            id: "workspace".to_string(),
            name: "Workspace".to_string(),
            path: path.display().to_string(),
            codex_bin: None,
            kind: WorkspaceKind::Main,
            parent_id: None,
            worktree: None,
            settings: WorkspaceSettings::default(),
        }
    }

    fn commit_initial_file(repo: &Repository, root: &std::path::Path) {
        fs::write(
            root.join("tracked.txt"),
            "tracked line 1\ntracked line 2\ntracked line 3\n",
        )
        .expect("write tracked file");
        let mut index = repo.index().expect("open index");
        index
            .add_path(std::path::Path::new("tracked.txt"))
            .expect("stage tracked file");
        index.write().expect("write index");
        let tree_id = index.write_tree().expect("write tree");
        let tree = repo.find_tree(tree_id).expect("find tree");
        let signature = Signature::now("Moss Test", "moss@example.test").expect("signature");
        repo.commit(Some("HEAD"), &signature, &signature, "initial", &tree, &[])
            .expect("initial commit");
    }

    fn rename_status_options() -> StatusOptions {
        let mut options = StatusOptions::new();
        options
            .include_untracked(true)
            .recurse_untracked_dirs(true)
            .renames_head_to_index(true)
            .renames_index_to_workdir(true)
            .include_ignored(false);
        options
    }

    #[test]
    fn status_path_identity_uses_staged_rename_destination() {
        let root =
            std::env::temp_dir().join(format!("ccgui-status-rename-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create status rename root");
        let repo = Repository::init(&root).expect("init status rename repo");
        commit_initial_file(&repo, &root);

        fs::rename(root.join("tracked.txt"), root.join("renamed.txt")).expect("rename file");
        let mut index = repo.index().expect("open index");
        index
            .remove_path(std::path::Path::new("tracked.txt"))
            .expect("remove old path");
        index
            .add_path(std::path::Path::new("renamed.txt"))
            .expect("add renamed path");
        index.write().expect("write renamed index");

        let mut options = rename_status_options();
        let statuses = repo.statuses(Some(&mut options)).expect("read statuses");
        let entry = statuses
            .iter()
            .find(|entry| entry.status().contains(Status::INDEX_RENAMED))
            .expect("staged rename entry");
        let identity =
            git_status_path_identity(&entry, GitStatusLayer::Index).expect("rename identity");

        assert_eq!(identity.path, "renamed.txt");
        assert_eq!(identity.old_path.as_deref(), Some("tracked.txt"));
        assert_eq!(
            git_action_paths_for_file(&root, "renamed.txt", GitStatusLayer::Index),
            vec!["tracked.txt".to_string(), "renamed.txt".to_string()]
        );
    }

    #[test]
    fn status_path_identity_uses_workdir_rename_destination() {
        let root =
            std::env::temp_dir().join(format!("ccgui-status-rename-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create status rename root");
        let repo = Repository::init(&root).expect("init status rename repo");
        commit_initial_file(&repo, &root);

        fs::rename(root.join("tracked.txt"), root.join("renamed.txt")).expect("rename file");

        let mut options = rename_status_options();
        let statuses = repo.statuses(Some(&mut options)).expect("read statuses");
        let entry = statuses
            .iter()
            .find(|entry| entry.status().contains(Status::WT_RENAMED))
            .expect("workdir rename entry");
        let identity =
            git_status_path_identity(&entry, GitStatusLayer::Workdir).expect("rename identity");

        assert_eq!(identity.path, "renamed.txt");
        assert_eq!(identity.old_path.as_deref(), Some("tracked.txt"));
    }

    #[test]
    fn diff_detection_preserves_unchanged_rename_patch() {
        let root = std::env::temp_dir().join(format!("ccgui-diff-rename-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create diff rename root");
        let repo = Repository::init(&root).expect("init diff rename repo");
        commit_initial_file(&repo, &root);
        fs::rename(root.join("tracked.txt"), root.join("renamed.txt")).expect("rename file");

        let head_tree = repo
            .head()
            .expect("head")
            .peel_to_tree()
            .expect("head tree");
        let mut diff_options = DiffOptions::new();
        diff_options
            .include_untracked(true)
            .recurse_untracked_dirs(true)
            .show_untracked_content(true);
        let mut diff = repo
            .diff_tree_to_workdir_with_index(Some(&head_tree), Some(&mut diff_options))
            .expect("workdir diff");
        find_git_diff_renames(&mut diff).expect("detect rename");
        let deltas = diff.deltas().collect::<Vec<_>>();

        assert_eq!(deltas.len(), 1);
        assert_eq!(deltas[0].status(), Delta::Renamed);
        assert_eq!(
            deltas[0].new_file().path(),
            Some(std::path::Path::new("renamed.txt"))
        );
        let mut patch = git2::Patch::from_diff(&diff, 0)
            .expect("build rename patch")
            .expect("rename patch");
        let patch_text = super::diff_patch_to_string(&mut patch).expect("render rename patch");
        assert!(patch_text.contains("rename from tracked.txt"));
        assert!(patch_text.contains("rename to renamed.txt"));
    }

    #[test]
    fn diff_detection_and_stats_preserve_modified_rename_identity() {
        let root = std::env::temp_dir().join(format!("ccgui-diff-rename-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create diff rename root");
        let repo = Repository::init(&root).expect("init diff rename repo");
        commit_initial_file(&repo, &root);

        fs::rename(root.join("tracked.txt"), root.join("renamed.txt")).expect("rename file");
        fs::write(
            root.join("renamed.txt"),
            "tracked line 1\ntracked line 2\ntracked line 3\nadded line\n",
        )
        .expect("modify renamed file");

        let mut status_options = rename_status_options();
        let statuses = repo
            .statuses(Some(&mut status_options))
            .expect("read statuses");
        let entry = statuses
            .iter()
            .find(|entry| entry.status().contains(Status::WT_RENAMED))
            .expect("workdir rename entry");
        let identity =
            git_status_path_identity(&entry, GitStatusLayer::Workdir).expect("rename identity");
        let head_tree = repo
            .head()
            .expect("head")
            .peel_to_tree()
            .expect("head tree");

        assert_eq!(
            diff_stats_for_identity(&repo, Some(&head_tree), &identity, GitStatusLayer::Workdir,)
                .expect("rename stats"),
            (1, 0)
        );

        let mut diff_options = DiffOptions::new();
        diff_options
            .include_untracked(true)
            .recurse_untracked_dirs(true)
            .show_untracked_content(true);
        let mut diff = repo
            .diff_tree_to_workdir_with_index(Some(&head_tree), Some(&mut diff_options))
            .expect("workdir diff");
        find_git_diff_renames(&mut diff).expect("detect rename");
        let deltas = diff.deltas().collect::<Vec<_>>();

        assert_eq!(deltas.len(), 1);
        assert_eq!(deltas[0].status(), Delta::Renamed);
        assert_eq!(
            deltas[0].new_file().path(),
            Some(std::path::Path::new("renamed.txt"))
        );
    }

    #[test]
    fn action_paths_honor_layer_for_chained_rename() {
        let root =
            std::env::temp_dir().join(format!("ccgui-chain-rename-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create chained rename root");
        let repo = Repository::init(&root).expect("init chained rename repo");
        commit_initial_file(&repo, &root);

        fs::rename(root.join("tracked.txt"), root.join("indexed.txt")).expect("rename into index");
        let mut index = repo.index().expect("open index");
        index
            .remove_path(std::path::Path::new("tracked.txt"))
            .expect("remove tracked path");
        index
            .add_path(std::path::Path::new("indexed.txt"))
            .expect("add indexed path");
        index.write().expect("write renamed index");
        fs::rename(root.join("indexed.txt"), root.join("workdir.txt")).expect("rename in workdir");

        let expected_index_paths = vec!["tracked.txt".to_string(), "indexed.txt".to_string()];
        let expected_workdir_paths = vec!["indexed.txt".to_string(), "workdir.txt".to_string()];
        for target in ["tracked.txt", "indexed.txt"] {
            assert_eq!(
                git_action_paths_for_file(&root, target, GitStatusLayer::Index),
                expected_index_paths
            );
        }
        for target in ["indexed.txt", "workdir.txt"] {
            assert_eq!(
                git_action_paths_for_file(&root, target, GitStatusLayer::Workdir),
                expected_workdir_paths
            );
        }
        assert_eq!(
            git_diff_paths_for_file(&root, "workdir.txt"),
            vec![
                "tracked.txt".to_string(),
                "indexed.txt".to_string(),
                "workdir.txt".to_string(),
            ]
        );
    }

    #[test]
    fn status_path_identity_keeps_deleted_historical_path() {
        let root =
            std::env::temp_dir().join(format!("ccgui-status-delete-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create status delete root");
        let repo = Repository::init(&root).expect("init status delete repo");
        commit_initial_file(&repo, &root);

        fs::remove_file(root.join("tracked.txt")).expect("delete tracked file");

        let mut options = rename_status_options();
        let statuses = repo.statuses(Some(&mut options)).expect("read statuses");
        let entry = statuses
            .iter()
            .find(|entry| entry.status().contains(Status::WT_DELETED))
            .expect("deleted entry");
        let identity =
            git_status_path_identity(&entry, GitStatusLayer::Workdir).expect("delete identity");

        assert_eq!(identity.path, "tracked.txt");
        assert_eq!(identity.old_path, None);
    }

    #[test]
    fn image_mime_type_detects_known_extensions() {
        assert_eq!(image_mime_type("icon.PNG"), Some("image/png"));
        assert_eq!(image_mime_type("photo.jpeg"), Some("image/jpeg"));
        assert_eq!(image_mime_type("vector.SVG"), Some("image/svg+xml"));
        assert_eq!(image_mime_type("glyph.ico"), Some("image/x-icon"));
        assert_eq!(image_mime_type("readme.txt"), None);
    }

    #[test]
    fn image_commit_diff_contains_shared_old_and_new_payloads() {
        let root = std::env::temp_dir().join(format!("ccgui-image-diff-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create image diff root");
        let repo = Repository::init(&root).expect("init image diff repo");
        let signature = Signature::now("Moss Test", "moss@example.test").expect("signature");

        fs::write(root.join("logo.png"), [0_u8, 1, 2]).expect("write first image");
        let mut index = repo.index().expect("open index");
        index
            .add_path(std::path::Path::new("logo.png"))
            .expect("stage first image");
        index.write().expect("write first index");
        let first_tree_id = index.write_tree().expect("write first tree");
        let first_tree = repo.find_tree(first_tree_id).expect("find first tree");
        let first_oid = repo
            .commit(
                Some("HEAD"),
                &signature,
                &signature,
                "first image",
                &first_tree,
                &[],
            )
            .expect("commit first image");
        drop(first_tree);

        fs::write(root.join("logo.png"), [3_u8, 4, 5]).expect("write second image");
        let mut index = repo.index().expect("reopen index");
        index
            .add_path(std::path::Path::new("logo.png"))
            .expect("stage second image");
        index.write().expect("write second index");
        let second_tree_id = index.write_tree().expect("write second tree");
        let second_tree = repo.find_tree(second_tree_id).expect("find second tree");
        let first_commit = repo.find_commit(first_oid).expect("find first commit");
        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            "second image",
            &second_tree,
            &[&first_commit],
        )
        .expect("commit second image");
        let first_tree = first_commit.tree().expect("load first tree");
        let diff = repo
            .diff_tree_to_tree(Some(&first_tree), Some(&second_tree), None)
            .expect("diff image trees");
        let delta = diff.deltas().next().expect("image delta");

        let image_diff =
            build_image_commit_diff(&repo, Some(&first_tree), &second_tree, &delta, "M")
                .expect("map image diff");
        assert_eq!(image_diff.path, "logo.png");
        assert!(image_diff.is_binary);
        assert!(image_diff.is_image);
        assert_eq!(image_diff.old_image_mime.as_deref(), Some("image/png"));
        assert_eq!(image_diff.new_image_mime.as_deref(), Some("image/png"));
        assert!(image_diff.old_image_data.is_some());
        assert!(image_diff.new_image_data.is_some());

        drop(diff);
        drop(first_tree);
        drop(first_commit);
        drop(second_tree);
        drop(repo);
        fs::remove_dir_all(&root).expect("cleanup image diff root");
    }

    #[test]
    fn path_has_git_repository_marker_accepts_git_dir_and_file() {
        let root = std::env::temp_dir().join(format!("ccgui-git-utils-{}", uuid::Uuid::new_v4()));
        let dir_repo = root.join("dir-repo");
        let file_repo = root.join("file-repo");
        let plain_dir = root.join("plain-dir");

        fs::create_dir_all(dir_repo.join(".git")).expect("create dir repo marker");
        fs::create_dir_all(&file_repo).expect("create file repo root");
        fs::write(file_repo.join(".git"), "gitdir: /tmp/worktree/.git")
            .expect("write file repo marker");
        fs::create_dir_all(&plain_dir).expect("create plain dir");

        assert!(path_has_git_repository_marker(&dir_repo));
        assert!(path_has_git_repository_marker(&file_repo));
        assert!(!path_has_git_repository_marker(&plain_dir));

        fs::remove_dir_all(&root).expect("cleanup temp git utils root");
    }

    #[test]
    fn scoped_git_root_is_cross_platform_and_stays_inside_workspace() {
        let root = std::env::temp_dir().join(format!("ccgui-git-scope-{}", uuid::Uuid::new_v4()));
        let nested = root.join("nested").join("repo");
        let plain = root.join("plain");
        fs::create_dir_all(&root).expect("create workspace");
        Repository::init(&root).expect("init root repo");
        fs::create_dir_all(&nested).expect("create nested repo");
        Repository::init(&nested).expect("init nested repo");
        fs::create_dir_all(&plain).expect("create plain folder");
        let entry = workspace_entry(&root);

        assert_eq!(
            resolve_git_root_for_scope(&entry, Some("nested/repo")).expect("slash scope"),
            nested.canonicalize().expect("canonical nested")
        );
        assert_eq!(
            resolve_git_root_for_scope(&entry, Some("nested\\repo")).expect("backslash scope"),
            nested.canonicalize().expect("canonical nested")
        );
        assert!(resolve_git_root_for_scope(&entry, Some("../outside")).is_err());
        assert!(resolve_git_root_for_scope(&entry, Some("/tmp/outside")).is_err());
        assert!(resolve_git_root_for_scope(&entry, Some("C:\\outside")).is_err());
        assert!(resolve_git_root_for_scope(&entry, Some("plain")).is_err());

        fs::remove_dir_all(&root).expect("cleanup scoped root");
    }

    #[test]
    fn repository_summaries_cover_root_nested_and_dirty_state() {
        let root = std::env::temp_dir().join(format!("ccgui-git-summary-{}", uuid::Uuid::new_v4()));
        let nested = root.join("packages").join("child");
        let sibling = root.join("packages").join("sibling");
        let corrupt = root.join("packages").join("corrupt");
        fs::create_dir_all(&nested).expect("create roots");
        fs::create_dir_all(&sibling).expect("create sibling root");
        fs::create_dir_all(corrupt.join(".git")).expect("create corrupt marker");
        let root_repo = Repository::init(&root).expect("init root repo");
        commit_initial_file(&root_repo, &root);
        let child_repo = Repository::init(&nested).expect("init child repo");
        commit_initial_file(&child_repo, &nested);
        fs::write(nested.join("untracked.txt"), "dirty").expect("write untracked file");
        let sibling_repo = Repository::init(&sibling).expect("init sibling repo");
        commit_initial_file(&sibling_repo, &sibling);
        fs::write(sibling.join("tracked.txt"), "modified").expect("modify sibling file");

        let summaries = list_git_repository_summaries(&root, 4, 16);
        assert_eq!(summaries.len(), 4);
        assert_eq!(summaries[0].repository_root, "");
        assert!(!summaries[0].is_clean);
        let child = summaries
            .iter()
            .find(|summary| summary.repository_root == "packages/child")
            .expect("child summary");
        assert_eq!(child.untracked_count, 1);
        assert_eq!(
            child.file_statuses,
            vec![crate::types::GitRepositoryFileStatus {
                path: "untracked.txt".to_string(),
                status: "A".to_string(),
            }]
        );
        assert!(!child.is_clean);
        let sibling_summary = summaries
            .iter()
            .find(|summary| summary.repository_root == "packages/sibling")
            .expect("sibling summary");
        assert_eq!(sibling_summary.modified_count, 1);
        assert_eq!(sibling_summary.file_statuses[0].path, "tracked.txt");
        assert_eq!(sibling_summary.file_statuses[0].status, "M");
        let unavailable = summaries
            .iter()
            .find(|summary| summary.repository_root == "packages/corrupt")
            .expect("corrupt summary");
        assert_eq!(unavailable.head_state, "unavailable");
        assert!(unavailable.error.is_some());
        assert!(unavailable.file_statuses.is_empty());

        fs::remove_dir_all(&root).expect("cleanup summary root");
    }

    #[test]
    fn compact_repository_status_prefers_conflict_and_worktree_state() {
        assert_eq!(
            compact_repository_status(git2::Status::CONFLICTED),
            Some("U")
        );
        assert_eq!(compact_repository_status(git2::Status::WT_NEW), Some("A"));
        assert_eq!(
            compact_repository_status(git2::Status::WT_DELETED),
            Some("D")
        );
        assert_eq!(
            compact_repository_status(git2::Status::INDEX_RENAMED),
            Some("R")
        );
        assert_eq!(
            compact_repository_status(git2::Status::INDEX_TYPECHANGE),
            Some("T")
        );
        assert_eq!(compact_repository_status(git2::Status::CURRENT), None);
    }

    #[test]
    fn git_file_blame_returns_compressed_commit_hunks_and_uncommitted_lines() {
        let root = std::env::temp_dir().join(format!("ccgui-git-blame-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create blame root");
        let repo = Repository::init(&root).expect("init blame repo");
        fs::write(root.join("tracked.txt"), "first\nsecond\n").expect("write blame file");
        let mut index = repo.index().expect("open blame index");
        index
            .add_path(std::path::Path::new("tracked.txt"))
            .expect("stage blame file");
        index.write().expect("write blame index");
        let tree_id = index.write_tree().expect("write blame tree");
        let tree = repo.find_tree(tree_id).expect("find blame tree");
        let signature = Signature::now("Blame Author", "blame@example.test").expect("signature");
        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            "initial blame",
            &tree,
            &[],
        )
        .expect("commit blame file");

        let committed = build_git_file_blame(&root, "tracked.txt").expect("committed blame");
        assert_eq!(committed.path, "tracked.txt");
        assert_eq!(committed.hunks.len(), 1);
        assert_eq!(committed.hunks[0].author, "Blame Author");
        assert_eq!(committed.hunks[0].summary, "initial blame");

        fs::write(root.join("tracked.txt"), "first\nchanged\n").expect("modify blame file");
        let modified = build_git_file_blame(&root, "tracked.txt").expect("working blame");
        assert!(modified.hunks.iter().any(|hunk| hunk.commit_sha.is_empty()));
        assert!(modified
            .hunks
            .iter()
            .any(|hunk| hunk.author == "Uncommitted"));
        assert!(build_git_file_blame(&root, "../outside.txt").is_err());
        assert!(build_git_file_blame(&root, "/tmp/outside.txt").is_err());
        assert!(build_git_file_blame(&root, "C:\\outside.txt").is_err());

        fs::remove_dir_all(&root).expect("cleanup blame root");
    }
}

pub(crate) fn parse_github_repo(remote_url: &str) -> Option<String> {
    let trimmed = remote_url.trim();
    if trimmed.is_empty() {
        return None;
    }
    let mut path = if trimmed.starts_with("git@github.com:") {
        trimmed.trim_start_matches("git@github.com:").to_string()
    } else if trimmed.starts_with("ssh://git@github.com/") {
        trimmed
            .trim_start_matches("ssh://git@github.com/")
            .to_string()
    } else if let Some(index) = trimmed.find("github.com/") {
        trimmed[index + "github.com/".len()..].to_string()
    } else {
        return None;
    };
    path = path
        .trim_end_matches(".git")
        .trim_end_matches('/')
        .to_string();
    if path.is_empty() {
        None
    } else {
        Some(path)
    }
}

pub(crate) fn resolve_git_root(entry: &WorkspaceEntry) -> Result<PathBuf, String> {
    let base = PathBuf::from(&entry.path);
    let root = entry
        .settings
        .git_root
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty());
    let Some(root) = root else {
        return Ok(base);
    };
    let root_path = if Path::new(root).is_absolute() {
        PathBuf::from(root)
    } else {
        base.join(root)
    };
    if root_path.is_dir() {
        Ok(root_path)
    } else {
        Err(format!("Git root not found: {root}"))
    }
}

pub(crate) fn resolve_git_root_for_scope(
    entry: &WorkspaceEntry,
    repository_root: Option<&str>,
) -> Result<PathBuf, String> {
    let Some(repository_root) = repository_root else {
        return resolve_git_root(entry);
    };
    let base = PathBuf::from(&entry.path);
    let normalized = repository_root.trim().replace('\\', "/");
    let has_windows_prefix = normalized
        .as_bytes()
        .get(1)
        .is_some_and(|separator| *separator == b':');
    if normalized.starts_with('/') || has_windows_prefix {
        return Err("Invalid Git repository root: absolute paths are not allowed.".to_string());
    }
    let relative = Path::new(&normalized);
    if relative.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err("Invalid Git repository root: path traversal is not allowed.".to_string());
    }
    let candidate = if normalized.is_empty() {
        base.clone()
    } else {
        base.join(relative)
    };
    let canonical_base = base
        .canonicalize()
        .map_err(|error| format!("Failed to resolve workspace Git root: {error}"))?;
    let canonical_candidate = candidate
        .canonicalize()
        .map_err(|error| format!("Git repository root not found: {error}"))?;
    if !canonical_candidate.starts_with(&canonical_base) {
        return Err(
            "Invalid Git repository root: path resolves outside the workspace.".to_string(),
        );
    }
    if !path_has_git_repository_marker(&canonical_candidate) {
        return Err("Git repository root does not contain a .git marker.".to_string());
    }
    Ok(canonical_candidate)
}

pub(crate) fn path_has_git_repository_marker(path: &Path) -> bool {
    path.join(".git").is_dir() || path.join(".git").is_file()
}

fn should_skip_dir(name: &str) -> bool {
    matches!(
        name,
        ".git"
            | "node_modules"
            | "dist"
            | "target"
            | "release-artifacts"
            | ".venv"
            | "vendor"
            | "build"
            | "__pycache__"
            | ".cache"
    )
}

pub(crate) fn list_git_roots(root: &Path, max_depth: usize, max_results: usize) -> Vec<String> {
    if !root.is_dir() {
        return Vec::new();
    }

    let mut results = Vec::new();
    let mut seen = HashSet::new();
    let max_depth = max_depth.max(1);
    let walker = WalkBuilder::new(root)
        .hidden(false)
        .follow_links(false)
        .max_depth(Some(max_depth))
        .filter_entry(|entry| {
            if entry.depth() == 0 {
                return true;
            }
            if entry.file_type().is_some_and(|ft| ft.is_dir()) {
                let name = entry.file_name().to_string_lossy();
                if should_skip_dir(&name) {
                    return false;
                }
            }
            true
        })
        .build();

    for entry in walker {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        if !entry.file_type().is_some_and(|ft| ft.is_dir()) {
            continue;
        }
        if entry.depth() == 0 {
            continue;
        }
        let candidate = entry.path();
        let git_marker = candidate.join(".git");
        if !git_marker.is_dir() && !git_marker.is_file() {
            continue;
        }
        let rel = match candidate.strip_prefix(root) {
            Ok(rel) => rel,
            Err(_) => continue,
        };
        let normalized = normalize_git_path(&rel.to_string_lossy());
        if normalized.is_empty() || !seen.insert(normalized.clone()) {
            continue;
        }
        results.push(normalized);
        if results.len() >= max_results {
            break;
        }
    }

    results.sort();
    results
}

fn repository_display_name(repo_root: &Path) -> String {
    repo_root
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or(".")
        .to_string()
}

fn unavailable_repository_summary(
    repository_root: String,
    repo_root: &Path,
    error: String,
) -> GitRepositorySummary {
    GitRepositorySummary {
        repository_root,
        display_name: repository_display_name(repo_root),
        current_branch: None,
        head_state: "unavailable".to_string(),
        upstream: None,
        ahead: 0,
        behind: 0,
        staged_count: 0,
        modified_count: 0,
        untracked_count: 0,
        conflicted_count: 0,
        file_statuses: Vec::new(),
        is_clean: false,
        error: Some(error),
    }
}

fn compact_repository_status(status: Status) -> Option<&'static str> {
    if status.contains(Status::CONFLICTED) {
        return Some("U");
    }
    if status.contains(Status::WT_NEW) {
        return Some("A");
    }
    if status.contains(Status::WT_DELETED) {
        return Some("D");
    }
    if status.contains(Status::WT_RENAMED) {
        return Some("R");
    }
    if status.contains(Status::WT_TYPECHANGE) {
        return Some("T");
    }
    if status.contains(Status::WT_MODIFIED) {
        return Some("M");
    }
    if status.contains(Status::INDEX_NEW) {
        return Some("A");
    }
    if status.contains(Status::INDEX_DELETED) {
        return Some("D");
    }
    if status.contains(Status::INDEX_RENAMED) {
        return Some("R");
    }
    if status.contains(Status::INDEX_TYPECHANGE) {
        return Some("T");
    }
    if status.contains(Status::INDEX_MODIFIED) {
        return Some("M");
    }
    None
}

pub(crate) fn git_repository_summary(
    workspace_root: &Path,
    repository_root: &str,
) -> GitRepositorySummary {
    let repo_root = if repository_root.is_empty() {
        workspace_root.to_path_buf()
    } else {
        workspace_root.join(repository_root)
    };
    let repo = match Repository::open_ext(
        &repo_root,
        git2::RepositoryOpenFlags::NO_SEARCH,
        std::iter::empty::<&Path>(),
    ) {
        Ok(repo) => repo,
        Err(error) => {
            return unavailable_repository_summary(
                repository_root.to_string(),
                &repo_root,
                format!("Failed to open Git repository: {error}"),
            )
        }
    };

    let (current_branch, head_state, head_error) = match repo.head() {
        Ok(head) if head.is_branch() => (
            head.shorthand().map(ToOwned::to_owned),
            "branch".to_string(),
            None,
        ),
        Ok(_) => (None, "detached".to_string(), None),
        Err(error) if error.code() == ErrorCode::UnbornBranch => (None, "unborn".to_string(), None),
        Err(error) => (
            None,
            "unavailable".to_string(),
            Some(format!("Failed to resolve Git HEAD: {error}")),
        ),
    };

    let mut upstream = None;
    let mut ahead = 0;
    let mut behind = 0;
    if let Some(branch_name) = current_branch.as_deref() {
        if let Ok(branch) = repo.find_branch(branch_name, BranchType::Local) {
            if let Ok(upstream_branch) = branch.upstream() {
                upstream = upstream_branch
                    .get()
                    .shorthand()
                    .map(ToOwned::to_owned)
                    .or_else(|| upstream_branch.get().name().map(ToOwned::to_owned));
                if let (Some(local_oid), Some(upstream_oid)) =
                    (branch.get().target(), upstream_branch.get().target())
                {
                    if let Ok((ahead_count, behind_count)) =
                        repo.graph_ahead_behind(local_oid, upstream_oid)
                    {
                        ahead = ahead_count;
                        behind = behind_count;
                    }
                }
            }
        }
    }

    let mut options = StatusOptions::new();
    options
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false);
    let statuses = match repo.statuses(Some(&mut options)) {
        Ok(statuses) => statuses,
        Err(error) => {
            return unavailable_repository_summary(
                repository_root.to_string(),
                &repo_root,
                format!("Failed to read Git status: {error}"),
            )
        }
    };
    let mut staged_count = 0;
    let mut modified_count = 0;
    let mut untracked_count = 0;
    let mut conflicted_count = 0;
    let mut file_statuses = Vec::with_capacity(statuses.len());
    for entry in statuses.iter() {
        let status = entry.status();
        if let (Some(path), Some(compact_status)) =
            (entry.path(), compact_repository_status(status))
        {
            let normalized_path = normalize_git_path(path);
            if !normalized_path.is_empty() {
                file_statuses.push(GitRepositoryFileStatus {
                    path: normalized_path,
                    status: compact_status.to_string(),
                });
                if status.contains(Status::CONFLICTED) {
                    conflicted_count += 1;
                }
                if status.intersects(
                    Status::INDEX_NEW
                        | Status::INDEX_MODIFIED
                        | Status::INDEX_DELETED
                        | Status::INDEX_RENAMED
                        | Status::INDEX_TYPECHANGE,
                ) {
                    staged_count += 1;
                }
                if status.contains(Status::WT_NEW) {
                    untracked_count += 1;
                } else if status.intersects(
                    Status::WT_MODIFIED
                        | Status::WT_DELETED
                        | Status::WT_RENAMED
                        | Status::WT_TYPECHANGE,
                ) {
                    modified_count += 1;
                }
            }
        }
    }
    let is_clean =
        staged_count == 0 && modified_count == 0 && untracked_count == 0 && conflicted_count == 0;

    GitRepositorySummary {
        repository_root: repository_root.to_string(),
        display_name: repository_display_name(&repo_root),
        current_branch,
        head_state,
        upstream,
        ahead,
        behind,
        staged_count,
        modified_count,
        untracked_count,
        conflicted_count,
        file_statuses,
        is_clean,
        error: head_error,
    }
}

pub(crate) fn list_git_repository_summaries(
    workspace_root: &Path,
    max_depth: usize,
    max_results: usize,
) -> Vec<GitRepositorySummary> {
    if !workspace_root.is_dir() || max_results == 0 {
        return Vec::new();
    }
    let mut roots = Vec::new();
    if path_has_git_repository_marker(workspace_root) {
        roots.push(String::new());
    }
    let remaining = max_results.saturating_sub(roots.len());
    if remaining > 0 {
        roots.extend(list_git_roots(workspace_root, max_depth, remaining));
    }
    roots
        .iter()
        .map(|repository_root| git_repository_summary(workspace_root, repository_root))
        .collect()
}
