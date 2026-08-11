//! Shared helpers for CLI engines that accept local image attachments.
//!
//! Used by Grok (`--prompt-file` ACP blocks), OpenCode (`run -f`), and Kimi
//! (path injection + ReadMediaFile workflow).

use std::path::{Path, PathBuf};

/// CLI-only text block Grok injects when the user attaches images with empty text.
///
/// Multimodal `--prompt-file` requires at least one text content block. This
/// string is **not** user-authored and MUST be stripped from history / canvas
/// display (see `parse_grok_user_prompt_for_display`).
pub(crate) const GROK_IMAGE_ONLY_FALLBACK_TEXT: &str = "Please analyze the attached image(s).";

/// Collect trimmed, non-empty, deduped image path entries from send params.
pub(crate) fn collect_non_empty_image_paths(images: Option<&[String]>) -> Vec<String> {
    let Some(images) = images else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in images {
        let trimmed = entry.trim();
        if trimmed.is_empty() {
            continue;
        }
        if out.iter().any(|existing: &String| existing == trimmed) {
            continue;
        }
        out.push(trimmed.to_string());
    }
    out
}

/// Normalize a user-facing image reference into a local filesystem path.
///
/// Supports absolute/relative paths, `file://` URLs, and rejects empty input.
/// Data URLs are rejected because callers must handle them separately.
pub(crate) fn normalize_local_image_path(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("empty path".to_string());
    }
    if trimmed.get(..5).map(|s| s.eq_ignore_ascii_case("data:")) == Some(true) {
        return Err("data URL is not a filesystem path".to_string());
    }
    let without_scheme = if let Some(rest) = trimmed.strip_prefix("file://") {
        let rest = rest.strip_prefix("localhost").unwrap_or(rest);
        percent_decode_path(rest)
    } else {
        trimmed.to_string()
    };
    let path = PathBuf::from(without_scheme);
    if path.as_os_str().is_empty() {
        return Err("empty path".to_string());
    }
    Ok(path)
}

/// Resolve image paths that exist on disk as absolute paths.
///
/// Data URLs and unreadable paths are skipped with a warning-friendly error list.
pub(crate) fn resolve_existing_image_files(
    images: Option<&[String]>,
    workspace_path: &Path,
) -> Result<Vec<PathBuf>, String> {
    let raw_paths = collect_non_empty_image_paths(images);
    if raw_paths.is_empty() {
        return Ok(Vec::new());
    }

    let mut resolved = Vec::new();
    let mut errors = Vec::new();
    for raw in raw_paths {
        if raw.get(..5).map(|s| s.eq_ignore_ascii_case("data:")) == Some(true) {
            // Persist data URL to a temp file under the workspace so path-based
            // CLIs (OpenCode -f, Kimi ReadMediaFile) can consume it.
            match materialize_data_url_to_workspace(&raw, workspace_path) {
                Ok(path) => resolved.push(path),
                Err(error) => errors.push(format!("{raw}: {error}")),
            }
            continue;
        }
        match normalize_local_image_path(&raw) {
            Ok(path) => {
                let absolute = if path.is_absolute() {
                    path
                } else {
                    workspace_path.join(path)
                };
                match std::fs::metadata(&absolute) {
                    Ok(meta) if meta.is_file() => resolved.push(absolute),
                    Ok(_) => errors.push(format!("{}: not a regular file", absolute.display())),
                    Err(error) => {
                        errors.push(format!("{}: {}", absolute.display(), error));
                    }
                }
            }
            Err(error) => errors.push(format!("{raw}: {error}")),
        }
    }

    if resolved.is_empty() {
        return Err(format!(
            "none of the attached images could be resolved ({})",
            errors.join("; ")
        ));
    }
    if !errors.is_empty() {
        log::warn!(
            "[cli-image] partial image resolve: {} ok, {} failed ({})",
            resolved.len(),
            errors.len(),
            errors.join("; ")
        );
    }
    Ok(resolved)
}

fn materialize_data_url_to_workspace(raw: &str, workspace_path: &Path) -> Result<PathBuf, String> {
    let rest = raw.get(5..).ok_or_else(|| "invalid data URL".to_string())?;
    let (meta, payload) = rest
        .split_once(',')
        .ok_or_else(|| "invalid data URL".to_string())?;
    if !meta.to_ascii_lowercase().contains(";base64") {
        return Err("data URL must be base64".to_string());
    }
    let mime = meta
        .split(';')
        .next()
        .map(str::trim)
        .filter(|value| value.starts_with("image/"))
        .unwrap_or("image/png");
    let ext = match mime {
        "image/jpeg" | "image/jpg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/bmp" => "bmp",
        _ => "png",
    };
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let bytes = STANDARD
        .decode(payload.trim())
        .map_err(|error| format!("invalid base64 data URL: {error}"))?;
    let dir = workspace_path.join(".doge").join("image-staging");
    std::fs::create_dir_all(&dir).map_err(|error| format!("mkdir staging: {error}"))?;
    let path = dir.join(format!("attach-{}.{}", uuid::Uuid::new_v4(), ext));
    std::fs::write(&path, bytes).map_err(|error| format!("write staging: {error}"))?;
    Ok(path)
}

fn percent_decode_path(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (
                (bytes[index + 1] as char).to_digit(16),
                (bytes[index + 2] as char).to_digit(16),
            ) {
                out.push((hi * 16 + lo) as u8);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Stable marker separating user-visible text from Kimi CLI-only image injection.
/// The Kimi history loader strips everything from this marker onward.
pub(crate) const KIMI_IMAGE_INJECTION_MARKER: &str = "\n\n<!-- doge:kimi-image-attachments -->\n";
const LEGACY_KIMI_IMAGE_INJECTION_MARKERS: &[&str] =
    &["\n\n<!-- mossx:kimi-image-attachments -->\n"];

/// Build a Kimi headless prompt that makes attached images reachable.
///
/// Kimi's `-p` path only accepts a text prompt. Interactive paste expands to
/// `image_url` parts via TUI store; headless uses path tags + ReadMediaFile
/// (auto permission in print mode). Absolute paths are required.
///
/// The injection block is marked so UI/history can strip it and restore
/// `images[]` for thumbnail display — users must never see the tool instructions.
pub(crate) fn build_kimi_prompt_with_images(text: &str, image_paths: &[PathBuf]) -> String {
    if image_paths.is_empty() {
        return text.to_string();
    }

    let mut out = text.trim_end().to_string();
    out.push_str(KIMI_IMAGE_INJECTION_MARKER);
    out.push_str("The user attached the following image file(s). ");
    out.push_str(
        "You MUST call ReadMediaFile on each path below before answering any question about visual content.\n",
    );
    for (index, path) in image_paths.iter().enumerate() {
        let display = path.display();
        out.push_str(&format!("{}. {}\n", index + 1, display));
        // Kimi's degraded-media / ReadMediaFile workflow recognizes this tag form.
        out.push_str(&format!(
            "<image path=\"{}\"></image>\n",
            escape_xml_attr(&display.to_string())
        ));
    }
    out
}

/// Split a Kimi wire prompt into user-visible text + image paths for UI/history.
///
/// Returns `(display_text, image_paths)`. When no doge or legacy injection marker is
/// present, also falls back to detecting the plain-English instruction block
/// from older builds.
pub(crate) fn split_kimi_prompt_for_display(text: &str) -> (String, Vec<String>) {
    let matched_marker = std::iter::once(KIMI_IMAGE_INJECTION_MARKER)
        .chain(LEGACY_KIMI_IMAGE_INJECTION_MARKERS.iter().copied())
        .find_map(|marker| text.find(marker).map(|index| (marker, index)));
    if let Some((marker, split_at)) = matched_marker {
        let visible = text[..split_at].trim_end().to_string();
        let injection = &text[split_at + marker.len()..];
        return (visible, extract_image_paths_from_injection(injection));
    }

    // Legacy injection without HTML marker (pre-marker builds).
    const LEGACY_PREFIX: &str =
        "The user attached the following image file(s). You MUST call ReadMediaFile";
    if let Some(split_at) = text.find(LEGACY_PREFIX) {
        // Prefer splitting at the double-newline before the instruction.
        let boundary = text[..split_at]
            .rfind("\n\n")
            .map(|idx| idx)
            .unwrap_or(split_at);
        let visible = text[..boundary].trim_end().to_string();
        let injection = text[boundary..].trim_start();
        return (visible, extract_image_paths_from_injection(injection));
    }

    (text.to_string(), Vec::new())
}

fn extract_image_paths_from_injection(injection: &str) -> Vec<String> {
    let mut paths = Vec::new();
    // Prefer structured tags: <image path="..."></image>
    let mut rest = injection;
    while let Some(start) = rest.find("<image path=\"") {
        let after = &rest[start + "<image path=\"".len()..];
        if let Some(end) = after.find('"') {
            let raw = &after[..end];
            let path = unescape_xml_attr(raw);
            if !path.is_empty() && !paths.iter().any(|existing: &String| existing == &path) {
                paths.push(path);
            }
            rest = &after[end + 1..];
            continue;
        }
        break;
    }
    if !paths.is_empty() {
        return paths;
    }

    // Fallback: numbered absolute paths like `1. /tmp/a.png`
    for line in injection.lines() {
        let trimmed = line.trim();
        let Some((_idx, path_part)) = trimmed.split_once(". ") else {
            continue;
        };
        let path = path_part.trim();
        if path.starts_with('/') && !paths.iter().any(|existing: &String| existing == path) {
            paths.push(path.to_string());
        }
    }
    paths
}

fn escape_xml_attr(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn unescape_xml_attr(value: &str) -> String {
    value
        .replace("&quot;", "\"")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collects_and_dedupes_paths() {
        let paths = collect_non_empty_image_paths(Some(&[
            " /a.png ".to_string(),
            "".to_string(),
            "/a.png".to_string(),
            "/b.jpg".to_string(),
        ]));
        assert_eq!(paths, vec!["/a.png".to_string(), "/b.jpg".to_string()]);
    }

    #[test]
    fn kimi_prompt_injects_image_tags() {
        let prompt =
            build_kimi_prompt_with_images("what is this?", &[PathBuf::from("/tmp/demo.png")]);
        assert!(prompt.contains("what is this?"));
        assert!(prompt.contains(KIMI_IMAGE_INJECTION_MARKER));
        assert!(prompt.contains("ReadMediaFile"));
        assert!(prompt.contains("<image path=\"/tmp/demo.png\"></image>"));
    }

    #[test]
    fn splits_kimi_prompt_for_display_with_marker() {
        let prompt = build_kimi_prompt_with_images(
            "截图说明",
            &[PathBuf::from("/tmp/a.png"), PathBuf::from("/tmp/b.png")],
        );
        let (visible, images) = split_kimi_prompt_for_display(&prompt);
        assert_eq!(visible, "截图说明");
        assert_eq!(
            images,
            vec!["/tmp/a.png".to_string(), "/tmp/b.png".to_string()]
        );
        assert!(!visible.contains("ReadMediaFile"));
        assert!(!visible.contains("<image path"));
    }

    #[test]
    fn splits_legacy_kimi_prompt_without_marker() {
        let legacy = "hello\n\nThe user attached the following image file(s). You MUST call ReadMediaFile on each path below before answering any question about visual content.\n1. /tmp/legacy.png\n<image path=\"/tmp/legacy.png\"></image>\n";
        let (visible, images) = split_kimi_prompt_for_display(legacy);
        assert_eq!(visible, "hello");
        assert_eq!(images, vec!["/tmp/legacy.png".to_string()]);
    }

    #[test]
    fn split_leaves_plain_prompt_unchanged() {
        let (visible, images) = split_kimi_prompt_for_display("just text");
        assert_eq!(visible, "just text");
        assert!(images.is_empty());
    }

    #[test]
    fn materializes_data_url_to_workspace_file() {
        let dir = std::env::temp_dir().join(format!("cli-image-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let data_url = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
        let paths = resolve_existing_image_files(Some(&[data_url.to_string()]), &dir).unwrap();
        assert_eq!(paths.len(), 1);
        assert!(paths[0].exists());
        assert!(paths[0].starts_with(dir.join(".doge").join("image-staging")));
        let _ = std::fs::remove_dir_all(dir);
    }
}
