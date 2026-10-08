use std::path::Path;

use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use crate::identity::SourceId;
use crate::model::{MessageRole, SourceKind};

use super::catalog::AcceptedMetadata;
use super::jsonl::{
    object, raw_string, read_bounded_lines, scan_json_records, string, timestamp_date,
};
use super::{
    DocumentKind, EmptyProjection, FullProjectionReason, MessageProjection, ProjectedSource,
    ProjectionCheckpoint, ProjectionMode, ProjectionOutcome, SessionProjection, SourceDocument,
    SourceError, SourceFile, build_session_summary, fallback_session_id, fallback_timestamp,
    first_user_title, time_range,
};

#[derive(Debug)]
struct AcceptedRecord {
    role: MessageRole,
    content_text: String,
    timestamp: String,
    session_id: String,
    cwd: String,
}

pub(crate) fn inventory_metadata(path: &Path) -> Result<Option<AcceptedMetadata>, SourceError> {
    let mut cwd = String::new();
    let mut path_date = None;
    let mut accepted_count = 0_u64;
    let mut hasher = Sha256::new();

    scan_json_records(path, None, |record| {
        let Some(accepted) = accepted_record(record) else {
            return true;
        };
        accepted_count += 1;
        if cwd.is_empty() && !accepted.cwd.is_empty() {
            cwd = accepted.cwd.clone();
        }
        if path_date.is_none() {
            path_date = timestamp_date(&accepted.timestamp);
        }
        hasher.update([0]);
        hasher.update(role_text(accepted.role).as_bytes());
        hasher.update([0]);
        hasher.update(accepted.session_id.as_bytes());
        hasher.update([0]);
        hasher.update(accepted.cwd.as_bytes());
        hasher.update([0]);
        hasher.update(accepted.timestamp.as_bytes());
        hasher.update([0]);
        hasher.update(accepted.content_text.as_bytes());
        true
    })?;

    Ok((accepted_count > 0).then(|| AcceptedMetadata {
        cwd,
        path_date,
        fingerprint: hex::encode(hasher.finalize()),
    }))
}

pub(crate) fn project(
    file: &SourceFile,
    read_limit: u64,
    checkpoint: Option<&ProjectionCheckpoint>,
) -> Result<ProjectionOutcome, SourceError> {
    if let Some(checkpoint) = checkpoint {
        return Ok(ProjectionOutcome::FullRequired {
            reason: if checkpoint.source_id == SourceId::ClaudeCode {
                FullProjectionReason::DeltaUnsupported
            } else {
                FullProjectionReason::SourceMismatch
            },
            read_proof: None,
        });
    }

    let mut documents = Vec::new();
    let mut session_id = String::new();
    let mut cwd = String::new();
    let read = read_bounded_lines(file, read_limit, 0, |record, raw_start, raw_end| {
        let Some(accepted) = accepted_record(record) else {
            return Ok(());
        };
        if session_id.is_empty() && !accepted.session_id.is_empty() {
            session_id = accepted.session_id;
        }
        if cwd.is_empty() && !accepted.cwd.is_empty() {
            cwd = accepted.cwd;
        }
        let seq = documents.len() as i64;
        documents.push(SourceDocument {
            kind: DocumentKind::Message,
            message: MessageProjection {
                role: accepted.role,
                content_text: accepted.content_text,
                timestamp: accepted.timestamp,
                seq,
                source_kind: SourceKind::EventMsg,
            },
            raw_start,
            raw_end,
        });
        Ok(())
    })?;

    if read.proof.opened.identity != file.identity {
        return Ok(ProjectionOutcome::FullRequired {
            reason: FullProjectionReason::FileIdentityChanged,
            read_proof: Some(read.proof),
        });
    }
    let checkpoint = ProjectionCheckpoint {
        source_id: SourceId::ClaudeCode,
        file_identity: read.proof.opened.identity.clone(),
        indexed_bytes: read.proof.safe_offset,
        prefix_digest: read.safe_prefix_digest,
        next_seq: documents.len() as i64,
        reducer_state: r#"{"version":1,"mode":"full_only"}"#.to_owned(),
    };
    if documents.is_empty() {
        return Ok(ProjectionOutcome::Skipped(EmptyProjection {
            read_proof: read.proof,
            checkpoint,
        }));
    }

    // Claude Code names each transcript `<sessionId>.jsonl`. A resumed session
    // copies its parent's records, parent `sessionId` included, into a new
    // file, so the first record's id can name another file's session. The
    // filename is the file's own identity whenever it has Claude Code's form.
    let native_session_id = file_session_uuid(file)
        .or_else(|| (!session_id.is_empty()).then_some(session_id))
        .unwrap_or_else(|| fallback_session_id(file));
    let session_key = format!("claude-code:{native_session_id}");
    let fallback = fallback_timestamp(file);
    let (started_at, ended_at) = time_range(&documents, [], &fallback);
    let session = SessionProjection {
        source_id: SourceId::ClaudeCode,
        native_session_id,
        session_key: session_key.clone(),
        session_uuid: session_key,
        file_path: file.file_path.to_string_lossy().into_owned(),
        title: first_user_title(&documents).unwrap_or_else(|| "(no title)".to_owned()),
        summary_text: build_session_summary(&documents),
        compact_text: String::new(),
        reasoning_summary_text: String::new(),
        cwd: if cwd.is_empty() {
            file.cwd.clone()
        } else {
            cwd
        },
        model: String::new(),
        started_at,
        ended_at,
        document_count: documents.len() as u64,
    };
    Ok(ProjectionOutcome::Projected(Box::new(ProjectedSource {
        mode: ProjectionMode::Full,
        session,
        documents,
        read_proof: read.proof,
        checkpoint,
    })))
}

fn file_session_uuid(file: &SourceFile) -> Option<String> {
    let stem = file.file_path.file_stem()?.to_str()?;
    is_uuid(stem).then(|| stem.to_owned())
}

fn is_uuid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => byte == b'-',
            _ => byte.is_ascii_hexdigit(),
        })
}

fn accepted_record(record: &Map<String, Value>) -> Option<AcceptedRecord> {
    if record.get("isMeta").and_then(Value::as_bool) == Some(true)
        || record.get("isSidechain").and_then(Value::as_bool) == Some(true)
    {
        return None;
    }
    let role = match record.get("type").and_then(Value::as_str) {
        Some("user") => MessageRole::User,
        Some("assistant") => MessageRole::Assistant,
        _ => return None,
    };
    let content_text = extract_text(record);
    if content_text.is_empty() {
        return None;
    }
    Some(AcceptedRecord {
        role,
        content_text,
        timestamp: string(record, "timestamp"),
        session_id: raw_string(record, "sessionId"),
        cwd: raw_string(record, "cwd"),
    })
}

fn extract_text(record: &Map<String, Value>) -> String {
    let direct = record
        .get("content")
        .map(text_from_content)
        .unwrap_or_default();
    if !direct.is_empty() {
        return direct;
    }
    object(record, "message")
        .and_then(|message| message.get("content"))
        .map(text_from_content)
        .unwrap_or_default()
}

fn text_from_content(value: &Value) -> String {
    if let Some(text) = value.as_str() {
        return text.trim().to_owned();
    }
    let Some(items) = value.as_array() else {
        return String::new();
    };
    items
        .iter()
        .filter_map(|item| {
            let item = item.as_object()?;
            if item.get("type").and_then(Value::as_str) != Some("text") {
                return None;
            }
            item.get("text")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|text| !text.is_empty())
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn role_text(role: MessageRole) -> &'static str {
    match role {
        MessageRole::User => "user",
        MessageRole::Assistant => "assistant",
    }
}
