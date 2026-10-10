use std::io::Write;

use serde::Serialize;
use serde_json::Value;

use crate::error::AppError;
use crate::model::{
    FindResult, FindSummary, MessageRecord, ReadPageSummary, ReadRangeSummary, SessionListSummary,
    StatsSummary, StatusSummary, ZeroResultsDiagnosis,
};
use crate::retrieval::{EvidenceReadContext, build_evidence_read_action};
use crate::selector::Selector;
use crate::sync::SyncReport;

pub(super) fn write_json(writer: &mut dyn Write, value: &impl Serialize) -> Result<(), AppError> {
    serde_json::to_writer_pretty(&mut *writer, value).map_err(AppError::output)?;
    writeln!(writer).map_err(AppError::output)
}

pub(super) fn write_sync_text(
    writer: &mut dyn Write,
    report: &SyncReport,
    default_source_selected: bool,
) -> Result<(), AppError> {
    writeln!(writer, "shlog sync").map_err(AppError::output)?;
    writeln!(
        writer,
        "selector: {}",
        serde_json::to_string(&report.selector).map_err(AppError::output)?
    )
    .map_err(AppError::output)?;
    if default_source_selected {
        let synced = report.selector.source().as_str();
        writeln!(
            writer,
            "scope:    --source was not given, so this refreshed only the default source {synced}; other sources are unchanged."
        )
        .map_err(AppError::output)?;
        let others = crate::identity::SourceId::ALL
            .iter()
            .filter(|source| source.as_str() != synced)
            .map(|source| source.as_str())
            .collect::<Vec<_>>()
            .join("|");
        writeln!(writer, "next:     shlog sync --source <{others}>").map_err(AppError::output)?;
    }
    writeln!(writer, "scanned:  {}", report.scanned).map_err(AppError::output)?;
    writeln!(writer, "added:    {}", report.added).map_err(AppError::output)?;
    writeln!(writer, "updated:  {}", report.updated).map_err(AppError::output)?;
    writeln!(writer, "skipped:  {}", report.skipped).map_err(AppError::output)?;
    writeln!(writer, "filtered: {}", report.filtered).map_err(AppError::output)?;
    writeln!(writer, "removed:  {}", report.removed).map_err(AppError::output)?;
    if report.retained_cold > 0 {
        writeln!(writer, "retainedCold: {}", report.retained_cold).map_err(AppError::output)?;
    }
    writeln!(writer, "errors:   {}", report.errors).map_err(AppError::output)?;
    let coverage = if report.coverage.written {
        "written".to_owned()
    } else {
        format!(
            "not written ({})",
            report.coverage.reason.as_deref().unwrap_or("unknown")
        )
    };
    writeln!(writer, "coverage: {coverage}").map_err(AppError::output)?;
    if !report.error_details.is_empty() {
        writeln!(writer, "\nsync errors").map_err(AppError::output)?;
        for detail in &report.error_details {
            writeln!(writer, "{}\n  {}", detail.file_path, detail.message)
                .map_err(AppError::output)?;
        }
    }
    Ok(())
}

pub(super) fn write_find_json(
    writer: &mut dyn Write,
    summary: &FindSummary,
    elapsed_ms: u64,
    db_path: &str,
    json_output: bool,
) -> Result<(), AppError> {
    let mut value = serde_json::to_value(summary).map_err(AppError::output)?;
    let object = value
        .as_object_mut()
        .expect("FindSummary always serializes as an object");
    let context = EvidenceReadContext {
        db_path,
        json: json_output,
    };
    if let Some(results) = object.get_mut("results").and_then(Value::as_array_mut) {
        for (result_value, result) in results.iter_mut().zip(&summary.results) {
            result_value
                .as_object_mut()
                .expect("FindResult always serializes as an object")
                .insert(
                    "evidenceRead".to_owned(),
                    serde_json::to_value(build_evidence_read_action(
                        result,
                        Some(&summary.query),
                        &context,
                    ))
                    .map_err(AppError::output)?,
                );
        }
    }
    object.insert("elapsedMs".to_owned(), Value::from(elapsed_ms));
    write_json(writer, &value)
}

pub(super) fn write_elapsed_json<T: Serialize>(
    writer: &mut dyn Write,
    summary: &T,
    elapsed_ms: u64,
) -> Result<(), AppError> {
    let mut value = serde_json::to_value(summary).map_err(AppError::output)?;
    value
        .as_object_mut()
        .expect("command summary always serializes as an object")
        .insert("elapsedMs".to_owned(), Value::from(elapsed_ms));
    write_json(writer, &value)
}

/// Text mode is the agent-facing default: one compact block per candidate,
/// a stored-coverage line, and a verbatim `read:` command. `--json` stays the
/// full machine contract; nothing here is parsed back by the CLI.
pub(super) fn write_find_text(
    writer: &mut dyn Write,
    summary: &FindSummary,
    non_default_db: Option<&str>,
) -> Result<(), AppError> {
    writeln!(writer, "shlog find \"{}\"", summary.query).map_err(AppError::output)?;
    write_find_coverage_line(writer, summary)?;
    if !summary.excluded_sessions.is_empty() {
        writeln!(writer, "excluded: {}", summary.excluded_sessions.join(" "))
            .map_err(AppError::output)?;
    }
    if summary.results.is_empty() {
        writeln!(writer, "没有找到结果").map_err(AppError::output)?;
        write_zero_results_text(writer, summary.zero_results.as_ref())?;
        return write_next_action(writer, summary.next_action.as_ref());
    }
    for result in &summary.results {
        writeln!(writer).map_err(AppError::output)?;
        let anchor = result
            .match_seq
            .map(|seq| format!("seq {seq}"))
            .unwrap_or_else(|| "session-level".to_owned());
        writeln!(
            writer,
            "[{}] {} · {} · {} · {} · {}",
            result.rank,
            date_only(&result.started_at),
            result.source_id.as_str(),
            nonempty(&result.cwd, "-"),
            anchor,
            plural(result.match_count, "hit"),
        )
        .map_err(AppError::output)?;
        let title = display_title(&result.title);
        writeln!(writer, "  {}", collapse_and_trim(&title, TITLE_BUDGET))
            .map_err(AppError::output)?;
        let summary_text = display_summary(&result.summary_text, &result.title);
        if let Some(summary_text) = &summary_text {
            writeln!(writer, "  summary: {summary_text}").map_err(AppError::output)?;
        }
        let snippet = collapse(&strip_marks(&result.snippet));
        if !snippet.is_empty()
            && !repeats(&snippet, &title)
            && !repeats(&snippet, &collapse(&result.title))
            && !summary_text
                .as_deref()
                .is_some_and(|summary_text| repeats(&snippet, summary_text))
        {
            writeln!(writer, "  match: {snippet}").map_err(AppError::output)?;
        }
        writeln!(
            writer,
            "  read: {}",
            read_command_text(result, &summary.query, non_default_db)
        )
        .map_err(AppError::output)?;
    }
    write_next_action(writer, summary.next_action.as_ref())
}

fn write_find_coverage_line(writer: &mut dyn Write, summary: &FindSummary) -> Result<(), AppError> {
    let mut parts = Vec::new();
    match &summary.coverage_by_source {
        Some(by_source) if !by_source.is_empty() => {
            for entry in by_source {
                parts.push(format!(
                    "{} {}",
                    entry.source_id.as_str(),
                    coverage_word(entry.coverage.complete)
                ));
            }
        }
        _ => parts.push(coverage_word(summary.coverage.complete).to_owned()),
    }
    let scope = summary
        .coverage_by_source
        .as_ref()
        .and_then(|by_source| by_source.first())
        .and_then(|entry| entry.coverage.requested.as_ref())
        .or(summary.coverage.requested.as_ref())
        .and_then(scope_text);
    if let Some(scope) = scope {
        parts.push(format!("scope {scope}"));
    }
    writeln!(
        writer,
        "coverage: {} (stored proof; freshness via status)",
        parts.join(" · ")
    )
    .map_err(AppError::output)
}

fn write_zero_results_text(
    writer: &mut dyn Write,
    zero_results: Option<&ZeroResultsDiagnosis>,
) -> Result<(), AppError> {
    let Some(zero_results) = zero_results else {
        return Ok(());
    };
    for hint in &zero_results.hints {
        writeln!(writer, "hint: {hint}").map_err(AppError::output)?;
    }
    if !zero_results.suggested_queries.is_empty() {
        let suggestions = zero_results
            .suggested_queries
            .iter()
            .map(|query| format!("shlog find {}", shell_arg(query)))
            .collect::<Vec<_>>();
        writeln!(writer, "try: {}", suggestions.join(" · ")).map_err(AppError::output)?;
    }
    Ok(())
}

/// The text-mode counterpart of `evidenceRead.command`: minimal, but it must
/// still close over a non-default `--db` so the printed command reads back the
/// same candidate when pasted verbatim.
fn read_command_text(result: &FindResult, query: &str, non_default_db: Option<&str>) -> String {
    let mut command = match result.match_seq {
        Some(seq) => format!(
            "shlog read-range {} --seq {} --query {}",
            result.session_ref,
            seq,
            shell_arg(query)
        ),
        None if !query.is_empty() => format!(
            "shlog read-range {} --query {}",
            result.session_ref,
            shell_arg(query)
        ),
        None => format!(
            "shlog read-page {} --offset 0 --limit 40",
            result.session_ref
        ),
    };
    if let Some(db) = non_default_db {
        command.push_str(" --db ");
        command.push_str(&shell_arg(db));
    }
    command
}

pub(super) fn write_range_text(
    writer: &mut dyn Write,
    summary: &ReadRangeSummary,
) -> Result<(), AppError> {
    writeln!(writer, "shlog read-range {}", summary.session.session_uuid)
        .map_err(AppError::output)?;
    writeln!(
        writer,
        "{} · {}",
        nonempty(&summary.session.title, "(no title)"),
        nonempty(&summary.session.cwd, "-")
    )
    .map_err(AppError::output)?;
    writeln!(
        writer,
        "anchor={} · range={}-{}",
        summary.anchor_seq, summary.range_start_seq, summary.range_end_seq
    )
    .map_err(AppError::output)?;
    writeln!(writer).map_err(AppError::output)?;
    for message in &summary.messages {
        let marker = if message.seq == summary.anchor_seq {
            ">>"
        } else {
            "  "
        };
        write_message(writer, marker, message)?;
    }
    Ok(())
}

pub(super) fn write_page_text(
    writer: &mut dyn Write,
    summary: &ReadPageSummary,
) -> Result<(), AppError> {
    writeln!(writer, "shlog read-page {}", summary.session.session_uuid)
        .map_err(AppError::output)?;
    writeln!(
        writer,
        "{} · total={} · offset={} · limit={} · hasMore={}",
        nonempty(&summary.session.title, "(no title)"),
        summary.total_count,
        summary.offset,
        summary.limit,
        summary.has_more
    )
    .map_err(AppError::output)?;
    writeln!(writer).map_err(AppError::output)?;
    for message in &summary.messages {
        write_message(writer, "", message)?;
    }
    Ok(())
}

pub(super) fn write_list_text(
    writer: &mut dyn Write,
    summary: &SessionListSummary,
    non_default_db: Option<&str>,
) -> Result<(), AppError> {
    writeln!(writer, "shlog list").map_err(AppError::output)?;
    if summary.results.is_empty() {
        writeln!(writer, "没有匹配的 session").map_err(AppError::output)?;
        return write_next_action(writer, summary.next_action.as_ref());
    }
    for (index, entry) in summary.results.iter().enumerate() {
        writeln!(writer).map_err(AppError::output)?;
        writeln!(
            writer,
            "[{}] {} · {} · {}",
            index + 1,
            date_only(&entry.ended_at),
            nonempty(&entry.cwd, "-"),
            plural(entry.message_count, "msg"),
        )
        .map_err(AppError::output)?;
        writeln!(
            writer,
            "  {}",
            collapse_and_trim(&display_title(&entry.title), TITLE_BUDGET)
        )
        .map_err(AppError::output)?;
        if let Some(summary_text) = display_summary(&entry.summary_text, &entry.title) {
            writeln!(writer, "  summary: {summary_text}").map_err(AppError::output)?;
        }
        let mut command = format!(
            "shlog read-page {} --offset 0 --limit 40",
            entry.session_uuid
        );
        if let Some(db) = non_default_db {
            command.push_str(" --db ");
            command.push_str(&shell_arg(db));
        }
        writeln!(writer, "  read: {command}").map_err(AppError::output)?;
    }
    Ok(())
}

pub(super) fn write_stats_text(
    writer: &mut dyn Write,
    stats: &StatsSummary,
) -> Result<(), AppError> {
    writeln!(writer, "shlog stats").map_err(AppError::output)?;
    writeln!(writer, "sessions:        {}", stats.session_count).map_err(AppError::output)?;
    writeln!(writer, "messages:        {}", stats.message_count).map_err(AppError::output)?;
    writeln!(
        writer,
        "earliest:        {}",
        stats.earliest_started_at.as_deref().unwrap_or("-")
    )
    .map_err(AppError::output)?;
    writeln!(
        writer,
        "latest:          {}",
        stats.latest_ended_at.as_deref().unwrap_or("-")
    )
    .map_err(AppError::output)?;
    writeln!(
        writer,
        "last_sync_at:    {}",
        stats.last_sync_at.as_deref().unwrap_or("-")
    )
    .map_err(AppError::output)?;
    writeln!(writer, "index_version:   {}", stats.index_version).map_err(AppError::output)?;
    writeln!(writer, "db_path:         {}", stats.db_path).map_err(AppError::output)?;
    writeln!(writer, "db_size_bytes:   {}", stats.db_size_bytes).map_err(AppError::output)?;
    writeln!(writer, "coverage_count:  {}", stats.coverage.len()).map_err(AppError::output)?;
    if !stats.top_cwds.is_empty() {
        writeln!(writer, "\ntop cwds").map_err(AppError::output)?;
        let width = stats
            .top_cwds
            .iter()
            .map(|row| row.cwd.chars().count())
            .max()
            .unwrap_or(0);
        for row in &stats.top_cwds {
            writeln!(writer, "  {:width$}  {}", row.cwd, row.count, width = width)
                .map_err(AppError::output)?;
        }
    }
    Ok(())
}

pub(super) fn write_status_text(
    writer: &mut dyn Write,
    status: &StatusSummary,
) -> Result<(), AppError> {
    writeln!(writer, "shlog status").map_err(AppError::output)?;
    writeln!(writer, "cwd:            {}", status.context.cwd).map_err(AppError::output)?;
    writeln!(writer, "root:           {}", status.context.root).map_err(AppError::output)?;
    writeln!(writer, "db_path:        {}", status.context.db_path).map_err(AppError::output)?;
    writeln!(
        writer,
        "source_files:   {}",
        status.source_inventory.total_files
    )
    .map_err(AppError::output)?;
    writeln!(
        writer,
        "source_dates:   {}..{}",
        status
            .source_inventory
            .path_date_range
            .from
            .as_deref()
            .unwrap_or("-"),
        status
            .source_inventory
            .path_date_range
            .to
            .as_deref()
            .unwrap_or("-")
    )
    .map_err(AppError::output)?;
    writeln!(writer, "index_exists:   {}", status.index.exists).map_err(AppError::output)?;
    writeln!(writer, "sessions:       {}", status.index.session_count).map_err(AppError::output)?;
    writeln!(writer, "messages:       {}", status.index.message_count).map_err(AppError::output)?;
    writeln!(writer, "coverage_count: {}", status.coverage_count).map_err(AppError::output)?;
    if let Some(requested) = &status.requested_coverage {
        writeln!(writer, "requested_coverage: {:?}", requested.freshness)
            .map_err(AppError::output)?;
        writeln!(writer, "stale_reason:       {:?}", requested.stale_reason)
            .map_err(AppError::output)?;
        writeln!(
            writer,
            "recommended_action:  {:?}",
            requested.recommended_action
        )
        .map_err(AppError::output)?;
        writeln!(
            writer,
            "source_file_count:   {}",
            requested.source_file_count
        )
        .map_err(AppError::output)?;
        writeln!(
            writer,
            "covering_selectors:  {}",
            requested.covering_selectors.len()
        )
        .map_err(AppError::output)?;
    }
    Ok(())
}

fn write_message(
    writer: &mut dyn Write,
    marker: &str,
    message: &MessageRecord,
) -> Result<(), AppError> {
    let role = match message.role {
        crate::model::MessageRole::User => "U",
        crate::model::MessageRole::Assistant => "A",
    };
    let timestamp = message
        .elision
        .as_ref()
        .map(|_| format!(" {}", message.timestamp))
        .unwrap_or_default();
    writeln!(
        writer,
        "{} [{}] {}{} {}",
        marker,
        message.seq,
        role,
        timestamp,
        collapse_and_trim(&message.content_text, 1_000)
    )
    .map_err(AppError::output)?;
    if let Some(elision) = &message.elision {
        writeln!(
            writer,
            "   elided {}/{} chars ({:?}); {}",
            elision.omitted_char_count, elision.original_char_count, elision.strategy, elision.hint
        )
        .map_err(AppError::output)?;
    }
    Ok(())
}

fn write_next_action(
    writer: &mut dyn Write,
    next_action: Option<&crate::model::QueryNextAction>,
) -> Result<(), AppError> {
    let Some(next_action) = next_action else {
        return Ok(());
    };
    writeln!(writer, "next:").map_err(AppError::output)?;
    for step in &next_action.steps {
        writeln!(writer, "  - {step}").map_err(AppError::output)?;
    }
    Ok(())
}

/// Display budgets for text mode. Titles are stored at up to 120 chars; the
/// summary budget is what a reader needs to decide whether to open a session.
const TITLE_BUDGET: usize = 100;
const SUMMARY_BUDGET: usize = 120;
/// Prefix length used to decide that a snippet merely repeats the title.
const REPEAT_PROBE_CHARS: usize = 30;

fn nonempty<'a>(value: &'a str, fallback: &'a str) -> &'a str {
    if value.is_empty() { fallback } else { value }
}

fn strip_marks(value: &str) -> String {
    value.replace("<mark>", "").replace("</mark>", "")
}

fn collapse(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn collapse_and_trim(value: &str, budget: usize) -> String {
    let collapsed = collapse(value);
    let mut output = collapsed.chars().take(budget).collect::<String>();
    if collapsed.chars().count() > budget {
        output.push('…');
    }
    output
}

fn date_only(timestamp: &str) -> &str {
    let date = timestamp.split('T').next().unwrap_or(timestamp);
    if date.is_empty() { "-" } else { date }
}

fn plural(count: u64, noun: &str) -> String {
    if count == 1 {
        format!("1 {noun}")
    } else {
        format!("{count} {noun}s")
    }
}

fn coverage_word(complete: bool) -> &'static str {
    if complete { "covered" } else { "uncovered" }
}

fn scope_text(selector: &Selector) -> Option<String> {
    match selector {
        Selector::All { .. } => None,
        Selector::Cwd { cwd, .. } => Some(format!("cwd {cwd}")),
        Selector::DateRange {
            from_date, to_date, ..
        } => Some(format!("{from_date}..{to_date}")),
        Selector::CwdDateRange {
            cwd,
            from_date,
            to_date,
            ..
        } => Some(format!("cwd {cwd} {from_date}..{to_date}")),
    }
}

/// True when `snippet` is just the title again (typical for seq-0 matches),
/// so printing it would spend tokens without adding information.
fn repeats(snippet: &str, title: &str) -> bool {
    let snippet = snippet.replace('…', "");
    let title = title.replace('…', "");
    let probe = |text: &str| text.chars().take(REPEAT_PROBE_CHARS).collect::<String>();
    let snippet_probe = probe(&snippet);
    let title_probe = probe(&title);
    !snippet_probe.is_empty()
        && !title_probe.is_empty()
        && (title.contains(&snippet_probe) || snippet.contains(&title_probe))
}

/// Source summaries usually open with `user: <first message>`, which is the
/// title again. Show what follows instead (the assistant/follow-up digest);
/// a mid-sentence continuation is prefixed with an ellipsis. `None` means the
/// summary adds nothing beyond the title.
fn display_summary(summary_text: &str, title: &str) -> Option<String> {
    let body = collapse(summary_text);
    let body = body.strip_prefix("user: ").unwrap_or(&body);
    let title = collapse(title);
    let probe_len = title
        .chars()
        .take(REPEAT_PROBE_CHARS)
        .map(char::len_utf8)
        .sum::<usize>();
    let shared = common_prefix_len(body, &title);
    let remainder = if probe_len > 0 && shared >= probe_len {
        let rest = body[shared..].trim_start();
        match rest.strip_prefix("| ") {
            Some(clean) => clean.to_owned(),
            None if rest.is_empty() => String::new(),
            None => format!("…{rest}"),
        }
    } else {
        body.to_owned()
    };
    if remainder.is_empty() {
        None
    } else {
        Some(collapse_and_trim(&remainder, SUMMARY_BUDGET))
    }
}

fn common_prefix_len(left: &str, right: &str) -> usize {
    left.char_indices()
        .zip(right.chars())
        .find(|((_, a), b)| a != b)
        .map(|((index, _), _)| index)
        .unwrap_or_else(|| left.len().min(right.len()))
}

/// Strip agent-runtime wrappers that sources capture as the first user
/// message: `[$skill](path)` / `[@plugin](…)` mentions and Claude Code
/// `<command-name>` / `<command-message>` / `<command-args>` envelopes. The
/// stored title (and therefore the JSON contract and FTS) is untouched; this
/// only decides what text mode shows. Pi `<skill …>` preambles are left alone:
/// the 120-char title cap almost always cuts them before any user text, so
/// there is nothing better to show. If nothing readable remains, the stored
/// title is shown unchanged.
fn display_title(title: &str) -> String {
    let mut rest = title.trim_start();
    let mut kept: Vec<String> = Vec::new();
    loop {
        let before = rest;
        if rest.starts_with("[$") || rest.starts_with("[@") {
            let Some(link) = rest.find("](") else { break };
            let Some(close) = rest[link..].find(')') else {
                break;
            };
            rest = &rest[link + close + 1..];
        } else if rest.starts_with("<command-") {
            let Some(tag_end) = rest.find('>') else { break };
            let tag = &rest[1..tag_end];
            let closing = format!("</{tag}>");
            let Some(close) = rest.find(&closing) else {
                // The title cap cut the envelope; nothing readable follows.
                rest = "";
                break;
            };
            let inner = rest[tag_end + 1..close].trim();
            if matches!(tag, "command-name" | "command-args") && !inner.is_empty() {
                kept.push(inner.to_owned());
            }
            rest = &rest[close + closing.len()..];
        }
        rest = rest.trim_start();
        if rest == before {
            break;
        }
    }
    kept.push(rest.to_owned());
    let cleaned = collapse(&kept.join(" "));
    if cleaned.is_empty() {
        collapse(title)
    } else {
        cleaned
    }
}

fn shell_arg(value: &str) -> String {
    if value.chars().all(|character| {
        character.is_ascii_alphanumeric()
            || matches!(character, '_' | '.' | '/' | ':' | '@' | '=' | '-')
    }) {
        value.to_owned()
    } else {
        format!("'{}'", value.replace('\'', "'\\''"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::SourceId;
    use crate::model::{
        CoverageFreshness, CoverageStatus, FindMatchRole, FindMatchedField, FindSort, MatchSource,
        SourceCoverageStatus, ZeroResultsReason,
    };

    fn coverage(complete: bool, requested: Option<Selector>) -> CoverageStatus {
        CoverageStatus {
            requested,
            complete,
            freshness: CoverageFreshness::NotChecked,
            stale_reason: None,
            covering_selectors: vec![],
        }
    }

    fn result(
        rank: u64,
        title: &str,
        summary: &str,
        snippet: &str,
        seq: Option<i64>,
    ) -> FindResult {
        FindResult {
            rank,
            source_id: SourceId::Pi,
            session_uuid: "pi:0199-aaaa".to_owned(),
            session_ref: "pi:0199-aaaa".to_owned(),
            title: title.to_owned(),
            summary_text: summary.to_owned(),
            cwd: "/repo".to_owned(),
            started_at: "2026-06-11T02:48:17.754Z".to_owned(),
            ended_at: "2026-06-11T03:00:00.000Z".to_owned(),
            match_count: 8,
            match_source: if seq.is_some() {
                MatchSource::Message
            } else {
                MatchSource::Session
            },
            match_seq: seq,
            match_role: FindMatchRole::User,
            match_timestamp: None,
            score: 1.0,
            snippet: snippet.to_owned(),
            matched_fields: vec![FindMatchedField::Message],
            session_message_count: 40,
        }
    }

    fn summary(results: Vec<FindResult>) -> FindSummary {
        FindSummary {
            query: "报警灯 bridge".to_owned(),
            source_ids: vec![SourceId::Codex, SourceId::Pi],
            sort: FindSort::Relevance,
            excluded_sessions: vec![],
            results,
            scanned_message_count: 10,
            coverage: coverage(false, None),
            coverage_by_source: Some(vec![
                SourceCoverageStatus {
                    source_id: SourceId::Codex,
                    coverage: coverage(
                        true,
                        Some(Selector::Cwd {
                            source: SourceId::Codex,
                            root: "/sessions".to_owned(),
                            cwd: "/repo".to_owned(),
                        }),
                    ),
                },
                SourceCoverageStatus {
                    source_id: SourceId::Pi,
                    coverage: coverage(false, None),
                },
            ]),
            next_action: None,
            zero_results: None,
        }
    }

    fn render(summary: &FindSummary, db: Option<&str>) -> String {
        let mut out = Vec::new();
        write_find_text(&mut out, summary, db).unwrap();
        String::from_utf8(out).unwrap()
    }

    #[test]
    fn find_text_is_one_compact_block_per_candidate_with_a_verbatim_read_command() {
        let text = render(
            &summary(vec![result(
                1,
                "之前我们讨论过报警灯 bridge 和 ap 的信号距离问题",
                "user: 之前我们讨论过报警灯 bridge 和 ap 的信号距离问题 | assistant: 我先把之前的讨论捞出来",
                "<mark>报警灯</mark> bridge 和 ap 的信号距离问题",
                Some(0),
            )]),
            Some("/tmp/custom index.sqlite"),
        );
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines[0], "shlog find \"报警灯 bridge\"");
        assert_eq!(
            lines[1],
            "coverage: codex covered · pi uncovered · scope cwd /repo (stored proof; freshness via status)"
        );
        assert_eq!(lines[2], "");
        assert_eq!(lines[3], "[1] 2026-06-11 · pi · /repo · seq 0 · 8 hits");
        assert_eq!(
            lines[4],
            "  之前我们讨论过报警灯 bridge 和 ap 的信号距离问题"
        );
        // The summary repeats the title, so only the assistant digest is shown.
        assert_eq!(lines[5], "  summary: assistant: 我先把之前的讨论捞出来");
        // A seq-0 snippet that repeats the title is not printed twice.
        assert_eq!(
            lines[6],
            "  read: shlog read-range pi:0199-aaaa --seq 0 --query '报警灯 bridge' --db '/tmp/custom index.sqlite'"
        );
        assert_eq!(lines.len(), 7);
        assert!(!text.contains("<mark>"));
    }

    #[test]
    fn find_text_prints_match_snippets_and_omits_db_for_the_default_index() {
        let text = render(
            &summary(vec![result(
                2,
                "mes超时报警的服务检查下网络连接状况",
                "user: mes超时报警的服务检查下网络连接状况",
                "…这里的 Station 是 alarm bridge 本地映射的 stationCode…",
                Some(11),
            )]),
            None,
        );
        assert!(text.contains("[2] 2026-06-11 · pi · /repo · seq 11 · 8 hits\n"));
        assert!(
            text.contains("  match: …这里的 Station 是 alarm bridge 本地映射的 stationCode…\n")
        );
        assert!(
            !text.contains("summary:"),
            "summary that only repeats the title is dropped: {text}"
        );
        assert!(
            text.contains(
                "  read: shlog read-range pi:0199-aaaa --seq 11 --query '报警灯 bridge'\n"
            )
        );
        assert!(!text.contains("--db"));
    }

    #[test]
    fn session_level_hits_read_by_query_and_plain_page_when_the_query_is_empty() {
        let hit = result(1, "title", "", "", None);
        assert_eq!(
            read_command_text(&hit, "报警灯 bridge", None),
            "shlog read-range pi:0199-aaaa --query '报警灯 bridge'"
        );
        assert_eq!(
            read_command_text(&hit, "", Some("/db.sqlite")),
            "shlog read-page pi:0199-aaaa --offset 0 --limit 40 --db /db.sqlite"
        );
    }

    #[test]
    fn zero_results_print_hints_suggested_queries_and_next_steps() {
        let mut empty = summary(vec![]);
        empty.zero_results = Some(ZeroResultsDiagnosis {
            reason: ZeroResultsReason::CoverageNotConfirmed,
            over_constrained: true,
            suggested_queries: vec!["bridge".to_owned(), "报警灯".to_owned()],
            hints: vec!["Coverage freshness was not confirmed for this scope.".to_owned()],
        });
        empty.next_action = Some(crate::model::QueryNextAction {
            kind: crate::model::QueryNextActionKind::CheckCoverageThenRetry,
            reason: crate::model::QueryNextActionReason::ZeroResultsWithoutSelector,
            selector: None,
            steps: vec!["Run shlog status for the same selector.".to_owned()],
            commands: None,
        });
        let text = render(&empty, None);
        assert!(text.contains("没有找到结果\n"));
        assert!(text.contains("hint: Coverage freshness was not confirmed for this scope.\n"));
        assert!(text.contains("try: shlog find bridge · shlog find '报警灯'\n"));
        assert!(text.ends_with("next:\n  - Run shlog status for the same selector.\n"));
    }

    #[test]
    fn display_title_strips_runtime_wrappers_but_never_returns_nothing() {
        assert_eq!(
            display_title(
                "[$sherlog](/Users/me/.agents/skills/sherlog/SKILL.md) 之前我们讨论过报警灯"
            ),
            "之前我们讨论过报警灯"
        );
        assert_eq!(
            display_title(
                "[@chrome](plugin://chrome@openai-bundled) https://example.com 打开这个 tab"
            ),
            "https://example.com 打开这个 tab"
        );
        assert_eq!(
            display_title(
                "<command-message>effort</command-message>\n<command-name>/effort</command-name>\n<command-args>high</command-args>"
            ),
            "/effort high"
        );
        // Ordinary markdown links are content, not wrappers.
        assert_eq!(
            display_title("[AGENTS.md](AGENTS.md) 把这个精简一下"),
            "[AGENTS.md](AGENTS.md) 把这个精简一下"
        );
        // A command envelope truncated by the 120-char title cap keeps what was decoded.
        assert_eq!(
            display_title(
                "<command-name>/effort</command-name> <command-message>effort</command-message> <command-args>ult"
            ),
            "/effort"
        );
        // Pi skill preambles are shown as stored (the cap usually cuts them anyway).
        let preamble = "<skill name=\"sherlog\" location=\"/Users/me/.agents/skills/sherlog/SKILL.md\">\nReferences are relat";
        assert_eq!(display_title(preamble), collapse(preamble));
        assert_eq!(display_title("hi"), "hi");
    }

    #[test]
    fn display_summary_skips_the_title_echo_and_keeps_what_follows() {
        assert_eq!(
            display_summary(
                "user: 帮我看看 dns proxy 服务运行状态 | assistant: 先查进程",
                "帮我看看 dns proxy 服务运行状态"
            ),
            Some("assistant: 先查进程".to_owned())
        );
        // Short stored titles are a prefix of the first message: continue mid-sentence.
        assert_eq!(
            display_summary(
                "user: 你是 MES 前端统一实施团队成员。先读三份文档",
                "你是 MES 前端统一实施团队成"
            ),
            Some("…员。先读三份文档".to_owned())
        );
        assert_eq!(
            display_summary(
                "user: 帮我看看 dns proxy 服务运行状态",
                "帮我看看 dns proxy 服务运行状态"
            ),
            None
        );
        assert_eq!(display_summary("", "anything"), None);
        assert_eq!(
            display_summary("independent digest text", "unrelated title"),
            Some("independent digest text".to_owned())
        );
    }

    #[test]
    fn list_text_uses_the_same_compact_shape() {
        let listing = SessionListSummary {
            query: crate::model::SessionListQuery {
                source_id: Some(SourceId::Codex),
                cwd: None,
                since: None,
                selector: None,
                sort: crate::model::SessionListSort::Ended,
                limit: 5,
            },
            results: vec![crate::model::SessionListEntry {
                session_uuid: "0199-bbbb".to_owned(),
                title: "收尾".to_owned(),
                summary_text: "user: 收尾 | assistant: 先看 git status".to_owned(),
                cwd: "/repo".to_owned(),
                started_at: "2026-09-11T01:00:00Z".to_owned(),
                ended_at: "2026-09-11T02:00:00Z".to_owned(),
                path_date: "2026-09-11".to_owned(),
                message_count: 1,
            }],
            coverage: coverage(true, None),
            next_action: None,
        };
        let mut out = Vec::new();
        write_list_text(&mut out, &listing, Some("/db.sqlite")).unwrap();
        assert_eq!(
            String::from_utf8(out).unwrap(),
            "shlog list\n\n[1] 2026-09-11 · /repo · 1 msg\n  收尾\n  summary: assistant: 先看 git status\n  read: shlog read-page 0199-bbbb --offset 0 --limit 40 --db /db.sqlite\n"
        );
    }

    fn sync_report(source: SourceId) -> SyncReport {
        SyncReport {
            scanned: 1,
            added: 0,
            updated: 0,
            skipped: 1,
            filtered: 0,
            removed: 0,
            retained_cold: 0,
            errors: 0,
            error_details: vec![],
            selector: Selector::All {
                source,
                root: "/raw".to_owned(),
            },
            coverage: crate::model::CoverageWriteSummary {
                written: true,
                selector: Selector::All {
                    source,
                    root: "/raw".to_owned(),
                },
                source_fingerprint: "f".to_owned(),
                source_file_set_fingerprint: "s".to_owned(),
                source_file_count: 1,
                indexed_session_count: 1,
                reason: None,
                stale_reason: None,
                recommended_action: None,
            },
        }
    }

    /// A bare `shlog sync` refreshes one source. Say so, and name the others,
    /// instead of leaving the reader to discover it from a stale index.
    #[test]
    fn sync_text_discloses_the_default_source_when_none_was_requested() {
        let mut out = Vec::new();
        write_sync_text(&mut out, &sync_report(SourceId::Codex), true).unwrap();
        let text = String::from_utf8(out).unwrap();
        assert!(text.contains("shlog sync\n"), "{text}");
        assert!(
            text.contains(
                "scope:    --source was not given, so this refreshed only the default source codex"
            ),
            "{text}"
        );
        assert!(
            text.contains("next:     shlog sync --source <claude-code|pi|dsh>"),
            "{text}"
        );
    }

    #[test]
    fn sync_text_stays_quiet_when_a_source_was_explicit() {
        let mut out = Vec::new();
        write_sync_text(&mut out, &sync_report(SourceId::Pi), false).unwrap();
        let text = String::from_utf8(out).unwrap();
        assert!(!text.contains("scope:"), "{text}");
        assert!(!text.contains("next:     shlog sync"), "{text}");
    }
}
