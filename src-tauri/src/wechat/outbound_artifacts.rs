use regex::Regex;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use super::{WechatOutboundMedia, MAX_WECHAT_IMAGE_BYTES};

static MARKDOWN_LINK_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?P<image>!)?\[(?P<label>[^\]\r\n]*)\]\(\s*(?P<target><[^>\r\n]+>|[^)\s]+)(?:\s+(?:\"[^\"\r\n]*\"|'[^'\r\n]*'|\([^\)\r\n]*\)))?\s*\)"#,
    )
    .expect("valid outbound Markdown link regex")
});

enum MarkdownTarget {
    Ignore,
    Local(PathBuf),
}

fn strip_markdown_target_wrapper(target: &str) -> &str {
    target
        .strip_prefix('<')
        .and_then(|value| value.strip_suffix('>'))
        .unwrap_or(target)
        .trim()
}

fn windows_uri_path(path: &str) -> &str {
    let bytes = path.as_bytes();
    if bytes.len() >= 3 && bytes[0] == b'/' && bytes[2] == b':' {
        &path[1..]
    } else {
        path
    }
}

fn markdown_target_path(target: &str, workspace_root: &Path) -> MarkdownTarget {
    let target = strip_markdown_target_wrapper(target);
    if target.is_empty() || target.starts_with('#') {
        return MarkdownTarget::Ignore;
    }

    let lowercase = target.to_ascii_lowercase();
    if lowercase.starts_with("http://")
        || lowercase.starts_with("https://")
        || lowercase.starts_with("data:")
        || lowercase.starts_with("mailto:")
    {
        return MarkdownTarget::Ignore;
    }

    let local = if lowercase.starts_with("file://") {
        windows_uri_path(&target[7..])
    } else if lowercase.starts_with("sandbox:") {
        windows_uri_path(&target[8..])
    } else {
        if target.contains("://") {
            return MarkdownTarget::Ignore;
        }
        target
    };
    let path = PathBuf::from(local);
    if path.is_absolute() {
        MarkdownTarget::Local(path)
    } else {
        MarkdownTarget::Local(workspace_root.join(path))
    }
}

fn artifact_type(path: &Path) -> Option<(&'static str, &'static str)> {
    let artifact_type = match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => ("image", "image/png"),
        "jpg" | "jpeg" => ("image", "image/jpeg"),
        "gif" => ("image", "image/gif"),
        "webp" => ("image", "image/webp"),
        "mp4" | "m4v" => ("video", "video/mp4"),
        "mov" => ("video", "video/quicktime"),
        "webm" => ("video", "video/webm"),
        "mkv" => ("video", "video/x-matroska"),
        "avi" => ("video", "video/x-msvideo"),
        "mp3" => ("file", "audio/mpeg"),
        "wav" => ("file", "audio/wav"),
        "m4a" => ("file", "audio/mp4"),
        "aac" => ("file", "audio/aac"),
        "ogg" => ("file", "audio/ogg"),
        "opus" => ("file", "audio/opus"),
        "pdf" => ("file", "application/pdf"),
        "ppt" => ("file", "application/vnd.ms-powerpoint"),
        "pptx" => (
            "file",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ),
        "doc" => ("file", "application/msword"),
        "docx" => (
            "file",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
        "xls" => ("file", "application/vnd.ms-excel"),
        "xlsx" => (
            "file",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ),
        "zip" => ("file", "application/zip"),
        "7z" => ("file", "application/x-7z-compressed"),
        "rar" => ("file", "application/vnd.rar"),
        "tar" => ("file", "application/x-tar"),
        "gz" => ("file", "application/gzip"),
        "csv" => ("file", "text/csv"),
        "txt" => ("file", "text/plain"),
        "json" => ("file", "application/json"),
        _ => return None,
    };
    Some(artifact_type)
}

pub(super) fn validate_wechat_outbound_media(
    media: &WechatOutboundMedia,
    workspace_root: &Path,
    app_data_dir: &Path,
) -> Result<WechatOutboundMedia, String> {
    let candidate = Path::new(media.path.trim());
    if !candidate.is_absolute() {
        return Err("媒体路径不是绝对路径".to_string());
    }
    let Some((expected_kind, expected_mime_type)) = artifact_type(candidate) else {
        return Err("文件类型不受支持".to_string());
    };
    if media.kind == "voice" {
        return Err("微信暂不支持发送语音 artifact".to_string());
    }
    if media.kind != expected_kind {
        return Err("媒体类型与文件扩展名不匹配".to_string());
    }

    let canonical_path =
        fs::canonicalize(candidate).map_err(|_| "文件不存在或不可读取".to_string())?;
    let workspace_root = fs::canonicalize(workspace_root).ok();
    let managed_artifact_root = fs::canonicalize(app_data_dir.join("generated-images")).ok();
    let is_allowed = workspace_root
        .iter()
        .chain(managed_artifact_root.iter())
        .any(|root| canonical_path.starts_with(root));
    if !is_allowed {
        return Err("文件不在允许目录内".to_string());
    }

    let metadata = fs::metadata(&canonical_path).map_err(|_| "文件不存在或不可读取".to_string())?;
    if !metadata.is_file() {
        return Err("目标不是普通文件".to_string());
    }
    if metadata.len() == 0 {
        return Err("文件为空".to_string());
    }
    if metadata.len() > MAX_WECHAT_IMAGE_BYTES as u64 {
        return Err("文件超过 8 MiB".to_string());
    }

    let file_name = canonical_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("attachment")
        .to_string();
    Ok(WechatOutboundMedia {
        path: canonical_path.to_string_lossy().into_owned(),
        kind: expected_kind.to_string(),
        mime_type: expected_mime_type.to_string(),
        file_name: Some(file_name),
    })
}

fn attachment_failure(label: &str, target: &str, reason: &str) -> String {
    let display_name = Path::new(strip_markdown_target_wrapper(target))
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| label.trim());
    let display_name = if display_name.is_empty() {
        "attachment"
    } else {
        display_name
    };
    format!("[附件未发送：{display_name}（{reason}）]")
}

pub(super) fn materialize_wechat_markdown_artifacts(
    response_text: &str,
    workspace_root: &Path,
    app_data_dir: &Path,
) -> (String, Vec<WechatOutboundMedia>) {
    let mut rewritten = String::with_capacity(response_text.len());
    let mut artifacts = Vec::new();
    let mut seen = HashSet::new();
    let mut cursor = 0;

    for captures in MARKDOWN_LINK_REGEX.captures_iter(response_text) {
        let Some(link_match) = captures.get(0) else {
            continue;
        };
        rewritten.push_str(&response_text[cursor..link_match.start()]);
        cursor = link_match.end();

        let label = captures
            .name("label")
            .map(|value| value.as_str())
            .unwrap_or_default();
        let target = captures
            .name("target")
            .map(|value| value.as_str())
            .unwrap_or_default();
        let MarkdownTarget::Local(candidate) = markdown_target_path(target, workspace_root) else {
            rewritten.push_str(link_match.as_str());
            continue;
        };
        if artifact_type(&candidate).is_none() {
            rewritten.push_str(link_match.as_str());
            continue;
        }

        let Some((kind, mime_type)) = artifact_type(&candidate) else {
            rewritten.push_str(link_match.as_str());
            continue;
        };
        let media = WechatOutboundMedia {
            path: candidate.to_string_lossy().into_owned(),
            kind: kind.to_string(),
            mime_type: mime_type.to_string(),
            file_name: None,
        };
        let media = match validate_wechat_outbound_media(&media, workspace_root, app_data_dir) {
            Ok(media) => media,
            Err(reason) => {
                rewritten.push_str(&attachment_failure(label, target, &reason));
                continue;
            }
        };

        if seen.insert(PathBuf::from(&media.path)) {
            artifacts.push(media);
        }
    }
    rewritten.push_str(&response_text[cursor..]);

    (rewritten.trim().to_string(), artifacts)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn artifact_test_roots(label: &str) -> (PathBuf, PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!(
            "doge-wechat-artifacts-{label}-{}",
            uuid::Uuid::new_v4()
        ));
        let workspace = root.join("workspace");
        let app_data = root.join("app-data");
        fs::create_dir_all(&workspace).expect("create artifact test workspace");
        fs::create_dir_all(&app_data).expect("create artifact test app data");
        (root, workspace, app_data)
    }

    #[test]
    fn materializes_relative_document_and_audio_links_as_file_media() {
        let (root, workspace, app_data) = artifact_test_roots("relative");
        fs::write(workspace.join("puppy-photo.pptx"), b"pptx bytes").expect("write pptx");
        fs::write(workspace.join("nihao.wav"), b"wav bytes").expect("write wav");

        let (text, artifacts) = materialize_wechat_markdown_artifacts(
            "已找到并返回文件：\n\n[下载 puppy-photo.pptx](puppy-photo.pptx)\n[下载音频](nihao.wav)",
            &workspace,
            &app_data,
        );

        assert_eq!(text, "已找到并返回文件：");
        assert_eq!(artifacts.len(), 2);
        assert_eq!(artifacts[0].kind, "file");
        assert_eq!(artifacts[0].file_name.as_deref(), Some("puppy-photo.pptx"));
        assert_eq!(
            artifacts[0].mime_type,
            "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        );
        assert_eq!(artifacts[1].kind, "file");
        assert_eq!(artifacts[1].mime_type, "audio/wav");
        fs::remove_dir_all(root).expect("remove artifact test root");
    }

    #[test]
    fn materializes_absolute_video_and_managed_image_links() {
        let (root, workspace, app_data) = artifact_test_roots("absolute");
        let video_path = workspace.join("clip.mp4");
        fs::write(&video_path, b"video bytes").expect("write video");
        let managed_dir = app_data.join("generated-images").join("shared");
        fs::create_dir_all(&managed_dir).expect("create managed image directory");
        let image_path = managed_dir.join("preview.png");
        fs::write(&image_path, b"png bytes").expect("write image");
        let response = format!(
            "[视频](<{}>)\n![预览](<{}>)",
            video_path.display(),
            image_path.display()
        );

        let (text, artifacts) =
            materialize_wechat_markdown_artifacts(&response, &workspace, &app_data);

        assert!(text.is_empty());
        assert_eq!(artifacts.len(), 2);
        assert_eq!(artifacts[0].kind, "video");
        assert_eq!(artifacts[1].kind, "image");
        fs::remove_dir_all(root).expect("remove artifact test root");
    }

    #[test]
    fn leaves_remote_and_source_links_and_replaces_unsafe_local_links() {
        let (root, workspace, app_data) = artifact_test_roots("invalid");
        let outside = root.join("outside.pdf");
        fs::write(&outside, b"outside").expect("write outside file");
        fs::write(workspace.join("empty.zip"), []).expect("write empty file");
        fs::write(workspace.join("source.rs"), b"fn main() {}").expect("write source file");
        let oversized = workspace.join("large.zip");
        fs::File::create(&oversized)
            .and_then(|file| file.set_len(MAX_WECHAT_IMAGE_BYTES as u64 + 1))
            .expect("create oversized file");
        let response = format!(
            "[官网](https://example.com/report.pdf)\n[源码](source.rs)\n[缺失](missing.pdf)\n[越界](<{}>)\n[空文件](empty.zip)\n[超限](large.zip)",
            outside.display()
        );

        let (text, artifacts) =
            materialize_wechat_markdown_artifacts(&response, &workspace, &app_data);

        assert!(artifacts.is_empty());
        assert!(text.contains("[官网](https://example.com/report.pdf)"));
        assert!(text.contains("[源码](source.rs)"));
        assert!(text.contains("附件未发送：missing.pdf（文件不存在或不可读取）"));
        assert!(text.contains("附件未发送：outside.pdf（文件不在允许目录内）"));
        assert!(text.contains("附件未发送：empty.zip（文件为空）"));
        assert!(text.contains("附件未发送：large.zip（文件超过 8 MiB）"));
        fs::remove_dir_all(root).expect("remove artifact test root");
    }
}
