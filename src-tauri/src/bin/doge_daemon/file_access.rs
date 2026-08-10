use super::*;
use crate::workspace_io::{
    list_external_absolute_directory_children_inner, list_external_spec_tree_inner,
    list_workspace_directory_children_inner_with_refresh, list_workspace_files_inner_with_refresh,
    read_external_absolute_file_inner, read_external_spec_file_inner, read_workspace_file_inner,
    read_workspace_file_preview_inner, write_external_absolute_file_inner,
    write_external_spec_file_inner, ExternalSpecFileResponse, WorkspaceFileResponse,
    WorkspaceFilesResponse,
};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;

const MAX_TASK_OUTPUT_TAIL_BYTES: u64 = 16_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EngineTaskOutputArtifactTailResponse {
    pub exists: bool,
    pub content: String,
    pub truncated: bool,
    pub byte_length: u64,
}

fn empty_task_output_artifact_response() -> EngineTaskOutputArtifactTailResponse {
    EngineTaskOutputArtifactTailResponse {
        exists: false,
        content: String::new(),
        truncated: false,
        byte_length: 0,
    }
}

fn candidate_task_output_temp_roots() -> Vec<PathBuf> {
    let mut roots = vec![std::env::temp_dir()];
    #[cfg(unix)]
    {
        roots.push(PathBuf::from("/tmp"));
        roots.push(PathBuf::from("/private/tmp"));
    }
    roots
}

fn canonical_task_output_roots(workspace_path: &str) -> Vec<PathBuf> {
    let mut roots = vec![PathBuf::from(workspace_path)];
    roots.extend(candidate_task_output_temp_roots());
    roots
        .into_iter()
        .filter_map(|root| root.canonicalize().ok())
        .fold(Vec::<PathBuf>::new(), |mut acc, root| {
            if !acc.iter().any(|existing| existing == &root) {
                acc.push(root);
            }
            acc
        })
}

fn read_task_output_artifact_tail(
    workspace_path: &str,
    artifact_path: &str,
) -> Result<EngineTaskOutputArtifactTailResponse, String> {
    let raw_path = PathBuf::from(artifact_path.trim());
    if !raw_path.is_absolute() {
        return Err("Task output artifact path must be absolute.".to_string());
    }
    if !raw_path.exists() {
        return Ok(empty_task_output_artifact_response());
    }

    let canonical_path = raw_path
        .canonicalize()
        .map_err(|err| format!("Failed to resolve task output artifact: {err}"))?;
    if !std::fs::metadata(&canonical_path)
        .map_err(|err| format!("Failed to read task output artifact metadata: {err}"))?
        .is_file()
    {
        return Err("Task output artifact is not a file.".to_string());
    }
    let allowed_roots = canonical_task_output_roots(workspace_path);
    if !allowed_roots
        .iter()
        .any(|allowed_root| canonical_path.starts_with(allowed_root))
    {
        return Err("Task output artifact is outside allowed directories.".to_string());
    }

    let mut file = File::open(&canonical_path)
        .map_err(|err| format!("Failed to open task output artifact: {err}"))?;
    let byte_length = file
        .metadata()
        .map_err(|err| format!("Failed to read task output artifact metadata: {err}"))?
        .len();
    let truncated = byte_length > MAX_TASK_OUTPUT_TAIL_BYTES;
    let read_start = byte_length.saturating_sub(MAX_TASK_OUTPUT_TAIL_BYTES);
    if read_start > 0 {
        file.seek(SeekFrom::Start(read_start))
            .map_err(|err| format!("Failed to seek task output artifact: {err}"))?;
    }
    let mut buffer = Vec::new();
    file.take(MAX_TASK_OUTPUT_TAIL_BYTES + 1)
        .read_to_end(&mut buffer)
        .map_err(|err| format!("Failed to read task output artifact: {err}"))?;
    if buffer.len() > MAX_TASK_OUTPUT_TAIL_BYTES as usize {
        buffer.truncate(MAX_TASK_OUTPUT_TAIL_BYTES as usize);
    }

    Ok(EngineTaskOutputArtifactTailResponse {
        exists: true,
        content: crate::text_encoding::decode_text_bytes(&buffer, "Task output artifact")?,
        truncated,
        byte_length,
    })
}

impl DaemonState {
    pub(crate) async fn list_workspace_files(
        &self,
        workspace_id: String,
        force_refresh: bool,
    ) -> Result<WorkspaceFilesResponse, String> {
        let root = workspaces_core::resolve_workspace_root(&self.workspaces, &workspace_id).await?;
        Ok(tokio::task::spawn_blocking(move || {
            list_workspace_files_inner_with_refresh(&root, 12_000, force_refresh)
        })
        .await
        .map_err(|err| format!("failed to join workspace file scan task: {err}"))?)
    }

    pub(crate) async fn list_workspace_directory_children(
        &self,
        workspace_id: String,
        path: String,
        force_refresh: bool,
    ) -> Result<WorkspaceFilesResponse, String> {
        let root = workspaces_core::resolve_workspace_root(&self.workspaces, &workspace_id).await?;
        tokio::task::spawn_blocking(move || {
            list_workspace_directory_children_inner_with_refresh(&root, &path, 2_000, force_refresh)
        })
        .await
        .map_err(|err| format!("failed to join workspace directory scan task: {err}"))?
    }

    pub(crate) async fn list_external_absolute_directory_children(
        &self,
        workspace_id: String,
        path: String,
    ) -> Result<WorkspaceFilesResponse, String> {
        let custom_skill_roots = {
            let app_settings = self.app_settings.lock().await;
            crate::skills::normalize_custom_skill_roots(
                app_settings.custom_skill_directories.clone(),
            )
        };
        let allowed_roots = {
            let workspaces = self.workspaces.lock().await;
            self.allowed_external_skill_roots(&workspaces, &workspace_id, &custom_skill_roots)?
        };
        list_external_absolute_directory_children_inner(&path, &allowed_roots, 2_000)
    }

    pub(crate) async fn read_workspace_file(
        &self,
        workspace_id: String,
        path: String,
    ) -> Result<WorkspaceFileResponse, String> {
        workspaces_core::read_workspace_file_core(
            &self.workspaces,
            &workspace_id,
            &path,
            |root, rel_path| read_workspace_file_inner(root, rel_path),
        )
        .await
    }

    pub(crate) async fn read_workspace_file_preview(
        &self,
        workspace_id: String,
        path: String,
    ) -> Result<WorkspaceFileResponse, String> {
        workspaces_core::read_workspace_file_core(
            &self.workspaces,
            &workspace_id,
            &path,
            |root, rel_path| read_workspace_file_preview_inner(root, rel_path),
        )
        .await
    }

    pub(crate) async fn list_external_spec_tree(
        &self,
        workspace_id: String,
        spec_root: String,
    ) -> Result<WorkspaceFilesResponse, String> {
        const MAX_EXTERNAL_SPEC_TREE_FILES: usize = 8_000;
        {
            let workspaces = self.workspaces.lock().await;
            if !workspaces.contains_key(&workspace_id) {
                return Err(format!("Workspace not found: {workspace_id}"));
            }
        }
        list_external_spec_tree_inner(&spec_root, MAX_EXTERNAL_SPEC_TREE_FILES)
    }

    pub(crate) async fn read_external_spec_file(
        &self,
        workspace_id: String,
        spec_root: String,
        path: String,
    ) -> Result<ExternalSpecFileResponse, String> {
        {
            let workspaces = self.workspaces.lock().await;
            if !workspaces.contains_key(&workspace_id) {
                return Err(format!("Workspace not found: {workspace_id}"));
            }
        }
        read_external_spec_file_inner(&spec_root, &path)
    }

    pub(crate) async fn read_external_absolute_file(
        &self,
        workspace_id: String,
        path: String,
    ) -> Result<WorkspaceFileResponse, String> {
        let custom_skill_roots = {
            let app_settings = self.app_settings.lock().await;
            crate::skills::normalize_custom_skill_roots(
                app_settings.custom_skill_directories.clone(),
            )
        };
        let allowed_roots = {
            let workspaces = self.workspaces.lock().await;
            self.allowed_external_skill_roots(&workspaces, &workspace_id, &custom_skill_roots)?
        };
        read_external_absolute_file_inner(&path, &allowed_roots)
    }

    pub(crate) async fn read_engine_task_output_artifact(
        &self,
        workspace_id: String,
        path: String,
    ) -> Result<EngineTaskOutputArtifactTailResponse, String> {
        let workspace_path = {
            let workspaces = self.workspaces.lock().await;
            workspaces
                .get(&workspace_id)
                .map(|entry| entry.path.clone())
                .ok_or_else(|| format!("Workspace not found: {workspace_id}"))?
        };

        read_task_output_artifact_tail(&workspace_path, &path)
    }

    pub(crate) async fn write_external_spec_file(
        &self,
        workspace_id: String,
        spec_root: String,
        path: String,
        content: String,
    ) -> Result<(), String> {
        {
            let workspaces = self.workspaces.lock().await;
            if !workspaces.contains_key(&workspace_id) {
                return Err(format!("Workspace not found: {workspace_id}"));
            }
        }
        write_external_spec_file_inner(&spec_root, &path, &content)
    }

    pub(crate) async fn write_external_absolute_file(
        &self,
        workspace_id: String,
        path: String,
        content: String,
    ) -> Result<(), String> {
        let custom_skill_roots = {
            let app_settings = self.app_settings.lock().await;
            crate::skills::normalize_custom_skill_roots(
                app_settings.custom_skill_directories.clone(),
            )
        };
        let allowed_roots = {
            let workspaces = self.workspaces.lock().await;
            self.allowed_external_skill_roots(&workspaces, &workspace_id, &custom_skill_roots)?
        };
        write_external_absolute_file_inner(&path, &allowed_roots, &content)
    }
}
