use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::shared_event_log::canonical::types::ArtifactRef;
use crate::workspaces::MAX_INLINE_IMAGE_BYTES;

const MAX_HISTORY_TAIL_BYTES: u64 = 64 * 1024 * 1024;
const MAX_HISTORY_LINE_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ImageFormat {
    media_type: &'static str,
    extension: &'static str,
}

pub(crate) fn materialize_codex_generated_images_from_history(
    app_data_dir: &Path,
    history_path: &Path,
    runtime_turn_id: &str,
) -> Result<Vec<ArtifactRef>, String> {
    let runtime_turn_id = runtime_turn_id.trim();
    if runtime_turn_id.is_empty() {
        return Err("generated image reconciliation requires runtime turn id".to_string());
    }
    let mut file = File::open(history_path).map_err(|error| {
        format!(
            "open Codex history {} for generated images: {error}",
            history_path.display()
        )
    })?;
    let file_len = file
        .metadata()
        .map_err(|error| format!("stat Codex history {}: {error}", history_path.display()))?
        .len();
    let tail_start = file_len.saturating_sub(MAX_HISTORY_TAIL_BYTES);
    let mut starts_inside_line = false;
    if tail_start > 0 {
        file.seek(SeekFrom::Start(tail_start - 1))
            .map_err(|error| {
                format!(
                    "seek Codex history {} tail boundary: {error}",
                    history_path.display()
                )
            })?;
        let mut preceding = [0_u8; 1];
        file.read_exact(&mut preceding).map_err(|error| {
            format!(
                "read Codex history {} tail boundary: {error}",
                history_path.display()
            )
        })?;
        starts_inside_line = preceding[0] != b'\n';
        file.seek(SeekFrom::Start(tail_start)).map_err(|error| {
            format!(
                "seek Codex history {} tail: {error}",
                history_path.display()
            )
        })?;
    }
    let mut reader = BufReader::new(file);
    if starts_inside_line {
        discard_until_newline(&mut reader).map_err(|error| {
            format!(
                "align Codex history {} bounded tail: {error}",
                history_path.display()
            )
        })?;
    }

    let mut artifacts = Vec::new();
    let mut first_error = None;
    let mut line = Vec::new();
    loop {
        match read_bounded_line(&mut reader, &mut line, MAX_HISTORY_LINE_BYTES).map_err(
            |error| {
                format!(
                    "read Codex history {} for generated images: {error}",
                    history_path.display()
                )
            },
        )? {
            BoundedLineRead::Eof => break,
            BoundedLineRead::Oversized => continue,
            BoundedLineRead::Line => {}
        }
        let Ok(entry) = serde_json::from_slice::<Value>(&line) else {
            continue;
        };
        let Some(payload) = matching_generated_image_payload(&entry, runtime_turn_id) else {
            continue;
        };
        match materialize_generated_image_payload(app_data_dir, payload) {
            Ok(artifact) => {
                if !artifacts.iter().any(|existing: &ArtifactRef| {
                    existing.artifact_id == artifact.artifact_id
                        || existing.sha256 == artifact.sha256
                }) {
                    artifacts.push(artifact);
                }
            }
            Err(error) => {
                first_error.get_or_insert(error);
            }
        };
    }
    if artifacts.is_empty() {
        if let Some(error) = first_error {
            return Err(error);
        }
    }
    Ok(artifacts)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BoundedLineRead {
    Eof,
    Line,
    Oversized,
}

fn read_bounded_line<R: BufRead>(
    reader: &mut R,
    output: &mut Vec<u8>,
    max_bytes: usize,
) -> std::io::Result<BoundedLineRead> {
    output.clear();
    let read = reader
        .take(max_bytes.saturating_add(1) as u64)
        .read_until(b'\n', output)?;
    if read == 0 {
        return Ok(BoundedLineRead::Eof);
    }
    if output.last() == Some(&b'\n') || output.len() <= max_bytes {
        return Ok(BoundedLineRead::Line);
    }
    discard_until_newline(reader)?;
    output.clear();
    Ok(BoundedLineRead::Oversized)
}

fn discard_until_newline<R: BufRead>(reader: &mut R) -> std::io::Result<()> {
    loop {
        let buffer = reader.fill_buf()?;
        if buffer.is_empty() {
            return Ok(());
        }
        if let Some(index) = buffer.iter().position(|byte| *byte == b'\n') {
            reader.consume(index + 1);
            return Ok(());
        }
        let length = buffer.len();
        reader.consume(length);
    }
}

fn matching_generated_image_payload<'a>(
    entry: &'a Value,
    runtime_turn_id: &str,
) -> Option<&'a serde_json::Map<String, Value>> {
    if entry.get("type").and_then(Value::as_str) != Some("response_item") {
        return None;
    }
    let payload = entry.get("payload")?.as_object()?;
    let payload_type = payload
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if !matches!(
        payload_type.as_str(),
        "image_generation_call" | "image_generation_end"
    ) {
        return None;
    }
    let status = payload
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if !matches!(status.as_str(), "completed" | "succeeded" | "success") {
        return None;
    }
    let item_turn_id = payload
        .get("internal_chat_message_metadata_passthrough")
        .or_else(|| payload.get("internalChatMessageMetadataPassthrough"))
        .and_then(Value::as_object)
        .and_then(|metadata| metadata.get("turn_id").or_else(|| metadata.get("turnId")))
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    (item_turn_id == runtime_turn_id).then_some(payload)
}

fn materialize_generated_image_payload(
    app_data_dir: &Path,
    payload: &serde_json::Map<String, Value>,
) -> Result<ArtifactRef, String> {
    let Some(result) = payload
        .get("result")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|result| !result.is_empty())
    else {
        return Err("generated image result is missing".to_string());
    };
    let bytes = decode_image_result(result, MAX_INLINE_IMAGE_BYTES as usize)?;
    let format = detect_image_format(&bytes)
        .ok_or_else(|| "unsupported generated image payload format".to_string())?;
    let sha256 = format!("{:x}", Sha256::digest(&bytes));
    let destination = generated_image_path(app_data_dir, &sha256, format.extension);
    write_content_addressed_image(&destination, &bytes)?;

    let artifact_id = payload
        .get("id")
        .or_else(|| payload.get("call_id"))
        .or_else(|| payload.get("callId"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("generated-image-{sha256}"));
    let prompt_text = payload
        .get("revised_prompt")
        .or_else(|| payload.get("revisedPrompt"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|prompt| !prompt.is_empty())
        .map(str::to_string);
    Ok(ArtifactRef {
        artifact_id,
        media_type: format.media_type.to_string(),
        size_bytes: Some(bytes.len() as i64),
        sha256,
        locator: destination.to_string_lossy().into_owned(),
        redaction: None,
        extra: json!({
            "sourceToolName": "image_generation_call",
            "promptText": prompt_text,
        }),
    })
}

fn decode_image_result(result: &str, max_bytes: usize) -> Result<Vec<u8>, String> {
    let encoded = if result.starts_with("data:") {
        let (header, encoded) = result
            .split_once(',')
            .ok_or_else(|| "invalid generated image data URL".to_string())?;
        if !header.to_ascii_lowercase().ends_with(";base64") {
            return Err("generated image data URL must use base64".to_string());
        }
        encoded
    } else {
        result
    };
    let maximum_encoded_len = max_bytes.saturating_add(2) / 3 * 4;
    if encoded.len() > maximum_encoded_len {
        return Err(format!(
            "generated image payload exceeds {max_bytes} decoded bytes"
        ));
    }
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|error| format!("invalid generated image base64: {error}"))?;
    if bytes.is_empty() {
        return Err("generated image payload is empty".to_string());
    }
    if bytes.len() > max_bytes {
        return Err(format!(
            "generated image payload exceeds {max_bytes} decoded bytes"
        ));
    }
    Ok(bytes)
}

fn detect_image_format(bytes: &[u8]) -> Option<ImageFormat> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some(ImageFormat {
            media_type: "image/png",
            extension: "png",
        });
    }
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return Some(ImageFormat {
            media_type: "image/jpeg",
            extension: "jpg",
        });
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some(ImageFormat {
            media_type: "image/gif",
            extension: "gif",
        });
    }
    if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return Some(ImageFormat {
            media_type: "image/webp",
            extension: "webp",
        });
    }
    None
}

fn generated_image_path(app_data_dir: &Path, sha256: &str, extension: &str) -> PathBuf {
    app_data_dir
        .join("generated-images")
        .join("shared")
        .join(format!("{sha256}.{extension}"))
}

fn write_content_addressed_image(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    let directory = path
        .parent()
        .ok_or_else(|| "generated image directory unavailable".to_string())?;
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let temporary = directory.join(format!(
        ".{}.{}.tmp",
        path.file_name().unwrap_or_default().to_string_lossy(),
        Uuid::new_v4()
    ));

    let publish = (|| {
        let mut options = OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&temporary)
            .map_err(|error| error.to_string())?;
        file.write_all(bytes).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        match fs::rename(&temporary, path) {
            Ok(()) => sync_parent_directory(directory),
            Err(_) if path.exists() => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    })();
    if publish.is_err() || temporary.exists() {
        let _ = fs::remove_file(&temporary);
    }
    publish
}

#[cfg(unix)]
fn sync_parent_directory(directory: &Path) -> Result<(), String> {
    File::open(directory)
        .and_then(|file| file.sync_all())
        .map_err(|error| error.to_string())
}

#[cfg(not(unix))]
fn sync_parent_directory(_directory: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    const PNG_1X1: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    fn temp_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!("doge-shared-image-{label}-{}", Uuid::new_v4()))
    }

    fn history_entry(turn_id: &str, result: &str) -> String {
        json!({
            "type": "response_item",
            "payload": {
                "type": "image_generation_call",
                "id": "ig-test-1",
                "status": "completed",
                "revised_prompt": "black doge",
                "result": result,
                "internal_chat_message_metadata_passthrough": {
                    "turn_id": turn_id,
                }
            }
        })
        .to_string()
    }

    #[test]
    fn reconciles_exact_turn_png_as_compact_artifact_idempotently() {
        let root = temp_root("persist");
        fs::create_dir_all(&root).expect("create root");
        let history_path = root.join("rollout.jsonl");
        fs::write(
            &history_path,
            format!(
                "{}\n{}\n",
                history_entry("old-turn", PNG_1X1),
                history_entry("target-turn", PNG_1X1)
            ),
        )
        .expect("write history");
        let first =
            materialize_codex_generated_images_from_history(&root, &history_path, "target-turn")
                .expect("materialize");
        let second =
            materialize_codex_generated_images_from_history(&root, &history_path, "target-turn")
                .expect("materialize again");

        assert_eq!(first, second);
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].artifact_id, "ig-test-1");
        assert_eq!(first[0].media_type, "image/png");
        assert!(Path::new(&first[0].locator).is_file());
        assert!(materialize_codex_generated_images_from_history(
            &root,
            &history_path,
            "missing-turn"
        )
        .expect("missing turn")
        .is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_invalid_or_oversized_payload_without_artifact() {
        assert!(decode_image_result("not-base64", 1024).is_err());
        let valid = STANDARD.encode([0_u8; 9]);
        assert!(decode_image_result(&valid, 4).is_err());

        let root = temp_root("invalid");
        fs::create_dir_all(&root).expect("create root");
        let history_path = root.join("rollout.jsonl");
        fs::write(&history_path, history_entry("target-turn", "not-base64"))
            .expect("write history");
        assert!(materialize_codex_generated_images_from_history(
            &root,
            &history_path,
            "target-turn"
        )
        .is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn bounded_line_reader_discards_oversized_line_without_losing_next_line() {
        let mut reader = Cursor::new(b"0123456789\nnext\n".to_vec());
        let mut line = Vec::new();

        assert_eq!(
            read_bounded_line(&mut reader, &mut line, 4).expect("oversized"),
            BoundedLineRead::Oversized
        );
        assert_eq!(
            read_bounded_line(&mut reader, &mut line, 4).expect("next"),
            BoundedLineRead::Line
        );
        assert_eq!(line, b"next\n");
        assert_eq!(
            read_bounded_line(&mut reader, &mut line, 4).expect("eof"),
            BoundedLineRead::Eof
        );
    }
}
