use serde_json::json;

use super::*;
use crate::identity::SourceId;
use crate::index::DocumentKind;
use crate::model::{
    CoverageFreshness, CoverageStatus, FindMatchRole, FindMatchedField, FindResult, FindSort,
    FindSummary, MatchSource, MessageRecord, MessageRole, QueryNextActionReason, ZeroResultsReason,
};
use crate::selector::Selector;

const RANK_NOW: i64 = 1_777_766_400_000; // 2026-05-03T00:00:00Z

fn candidate(session_uuid: &str) -> CandidateEvidence {
    CandidateEvidence {
        document_id: None,
        session_id: 1,
        source_id: SourceId::Codex,
        session_key: format!("codex:{session_uuid}"),
        session_uuid: session_uuid.to_owned(),
        title: "dummy title".to_owned(),
        summary_text: String::new(),
        compact_text: String::new(),
        reasoning_summary_text: String::new(),
        cwd: "/tmp".to_owned(),
        started_at: "2026-05-01T00:00:00.000Z".to_owned(),
        ended_at: "2026-05-01T00:00:00.000Z".to_owned(),
        session_message_count: 3,
        kind: DocumentKind::SessionProfile,
        seq: None,
        role: None,
        timestamp: None,
        body_text: "dummy content".to_owned(),
        raw_start: None,
        raw_end: None,
        fts_score: 0.0,
    }
}

fn find_result(source_id: SourceId, session_ref: &str, rank: u64) -> FindResult {
    FindResult {
        rank,
        source_id,
        session_uuid: session_ref.to_owned(),
        session_ref: session_ref.to_owned(),
        title: "title".to_owned(),
        summary_text: String::new(),
        cwd: "/tmp".to_owned(),
        started_at: "2026-05-01T00:00:00.000Z".to_owned(),
        ended_at: "2026-05-01T00:00:00.000Z".to_owned(),
        match_count: 1,
        match_source: MatchSource::Message,
        match_seq: Some(7),
        match_role: FindMatchRole::User,
        match_timestamp: None,
        score: 99.0,
        snippet: "hit".to_owned(),
        matched_fields: vec![FindMatchedField::Message],
        session_message_count: 3,
    }
}

#[test]
fn query_analysis_matches_ts_for_cjk_paths_and_fts_escaping() {
    let path = analyze_query(" read src/index.ts ");
    assert_eq!(path.normalized_query, "read src/index.ts");
    assert_eq!(path.terms, strings(&["read", "src", "index.ts"]));
    assert!(path.is_multi_term);
    assert!(path.is_path_like_command);
    assert_eq!(
        path.recall,
        RecallMode::Fts {
            expression: r#""read" AND "src" AND "index.ts""#.to_owned()
        }
    );

    let cjk = analyze_query("健康检查");
    assert_eq!(cjk.terms, strings(&["健康", "康检", "检查"]));
    assert_eq!(
        cjk.recall,
        RecallMode::Fts {
            expression: r#""健康" AND "康检" AND "检查""#.to_owned()
        }
    );
    assert_eq!(analyze_query("𠮷野家").terms, strings(&["𠮷野", "野家"]));
    assert_eq!(
        analyze_query("汉").recall,
        RecallMode::Like {
            needle: "汉".to_owned()
        }
    );
    assert_eq!(analyze_query("   ").recall, RecallMode::Empty);
    assert_eq!(quote_fts_term(r#"a"b* OR c"#), r#""a""b* OR c""#);
    assert_eq!(escape_like_pattern(r#"a\b%c_d"#), r#"a\\b\%c\_d"#);
}

#[test]
fn path_command_ranking_matches_ts_characterization() {
    let mut restatement = candidate("restatement");
    restatement.title = "cxs node dist/cli.js publish 搜下这个是哪个项目路径的".to_owned();
    restatement.body_text = restatement.title.clone();
    restatement.kind = DocumentKind::Message;
    restatement.seq = Some(0);
    restatement.role = Some(MessageRole::User);
    restatement.fts_score = -2.0;

    let mut executed = candidate("executed");
    executed.title = "怎么使用".to_owned();
    executed.body_text =
        "cd /tmp/what7 && node dist/cli.js publish fixtures/sample.jsonl --json".to_owned();
    executed.kind = DocumentKind::Message;
    executed.seq = Some(7);
    executed.role = Some(MessageRole::Assistant);
    executed.fts_score = -2.0;

    // 2026-05-03T00:00:00Z, the same Date.now override used to extract the TS golden.
    let results = rank_candidates_at(
        &[restatement, executed],
        "node dist/cli.js publish",
        5,
        RANK_NOW,
    );
    assert_eq!(results[0].session_uuid, "executed");
    assert!((results[0].score - 101.2).abs() < 1e-9);
    assert_eq!(results[1].session_uuid, "restatement");
    assert!((results[1].score - 63.2).abs() < 1e-9);
}

#[test]
fn message_evidence_is_always_the_display_row_without_losing_session_score() {
    let mut session = candidate("mixed");
    session.title = "payloadbeacon retry handoff".to_owned();
    session.fts_score = -50.0;
    let mut message = candidate("mixed");
    message.body_text = "noticed payloadbeacon stalled".to_owned();
    message.kind = DocumentKind::Message;
    message.seq = Some(4);
    message.role = Some(MessageRole::User);
    message.fts_score = -1.0;

    let result = rank_candidates_at(&[session, message], "payloadbeacon", 1, RANK_NOW)
        .pop()
        .unwrap();
    assert_eq!(result.match_source, MatchSource::Message);
    assert_eq!(result.match_seq, Some(4));
    assert_eq!(result.matched_fields, vec![FindMatchedField::Message]);
    assert_eq!(result.match_count, 2);
    assert!(
        result.score > 50.0,
        "session evidence must still drive score"
    );
}

#[test]
fn session_identity_grouping_is_source_qualified() {
    let mut codex = candidate("same-native");
    codex.source_id = SourceId::Codex;
    let mut claude = codex.clone();
    claude.source_id = SourceId::ClaudeCode;
    claude.session_key = "claude-code:same-native".to_owned();
    let results = rank_candidates_at(&[codex, claude], "dummy", 10, RANK_NOW);
    assert_eq!(results.len(), 2);
    assert!(
        results
            .iter()
            .any(|result| result.session_ref == "same-native")
    );
    assert!(
        results
            .iter()
            .any(|result| result.session_ref == "claude-code:same-native")
    );
}

#[test]
fn time_sort_uses_a_bounded_plan_and_keeps_newest_sessions() {
    assert_eq!(
        RetrievalPlan::for_sort(10, FindSort::Relevance),
        RetrievalPlan {
            candidate_limit: 120,
            full_rerank: true
        }
    );
    assert_eq!(
        RetrievalPlan::for_sort(10, FindSort::Ended),
        RetrievalPlan {
            candidate_limit: 50,
            full_rerank: false
        }
    );
    let candidates = (0..100)
        .map(|index| {
            let mut row = candidate(&format!("session-{index:03}"));
            row.ended_at = format!("2026-05-{day:02}T00:00:00Z", day = index % 28 + 1);
            row.fts_score = if index == 0 { -10_000.0 } else { 0.0 };
            row
        })
        .collect::<Vec<_>>();
    let results = rank_candidates_for_sort_at(&candidates, "dummy", FindSort::Ended, 2, RANK_NOW);
    assert_eq!(results.len(), 2);
    assert!(results[0].ended_at >= results[1].ended_at);
    assert_ne!(results[0].session_uuid, "session-000");
}

#[test]
fn snippets_match_ts_windows_and_utf16_offsets() {
    assert_eq!(
        make_raw_snippet(
            "prefix 健康检查 suffix",
            "健康检查",
            &strings(&["健康", "康检", "检查"]),
        ),
        "prefix <mark>健康检查</mark> suffix"
    );
    let content = format!("😀{}Needle{}", "a".repeat(45), "b".repeat(90));
    assert_eq!(
        make_like_snippet(&content, "needle"),
        format!("…{}<mark>Needle</mark>{}…", "a".repeat(40), "b".repeat(80))
    );
}

#[test]
fn message_elision_counts_javascript_utf16_code_units() {
    let message = MessageRecord {
        session_uuid: "s".to_owned(),
        seq: 0,
        role: MessageRole::User,
        content_text: format!("😀{}查询{}", "x".repeat(10), "y".repeat(10)),
        timestamp: "t".to_owned(),
        source_kind: "event_msg".to_owned(),
        elision: None,
    };
    let elided = elide_messages(
        &[message],
        ElisionOptions {
            max_message_chars: Some(12),
            anchor_seq: Some(0),
            query: Some("查询"),
        },
    );
    assert_eq!(
        elided[0].content_text,
        "[... shlog elided prefix ...]\nxxxxx查询yyyyy\n[... shlog elided suffix ...]"
    );
    let metadata = elided[0].elision.as_ref().unwrap();
    assert_eq!(metadata.original_char_count, 24);
    assert_eq!(metadata.displayed_char_count, 72);
    assert_eq!(metadata.omitted_char_count, 12);
    assert_eq!(metadata.query.as_deref(), Some("查询"));
}

#[test]
fn evidence_read_and_read_anchor_keep_progressive_read_contract() {
    let result = find_result(SourceId::Codex, "session-id", 1);
    let context = EvidenceReadContext {
        db_path: "/state/index.sqlite",
        json: true,
    };
    let action = build_evidence_read_action(&result, Some("ranking weights"), &context);
    assert_eq!(
        serde_json::to_value(action).unwrap(),
        json!({
            "kind": "read-range",
            "reason": "message_match",
            "sourceId": "codex",
            "sessionRef": "session-id",
            "seq": 7,
            "query": "ranking weights",
            "before": 2,
            "after": 2,
            "command": {
                "executable": "inherit",
                "args": [
                    "read-range", "session-id",
                    "--seq", "7",
                    "--before", "2",
                    "--after", "2",
                    "--query", "ranking weights",
                    "--source", "codex",
                    "--db", "/state/index.sqlite",
                    "--json"
                ],
                "sideEffect": "read_index"
            }
        })
    );
    assert_eq!(
        resolve_read_anchor(None, Some("ranking weights"), Some(&result)),
        Ok(7)
    );
    assert_eq!(
        resolve_read_anchor(None, Some("missing"), None),
        Err(ReadAnchorError::NoMessageHit)
    );
    assert!(resolve_read_anchor(None, None, None).is_err());
}

#[test]
fn session_level_evidence_actions_choose_query_then_page_fallback() {
    let mut result = find_result(SourceId::ClaudeCode, "claude-code:abc", 1);
    result.match_source = MatchSource::Session;
    result.match_seq = None;
    result.match_role = FindMatchRole::Session;
    let context = EvidenceReadContext {
        db_path: "/state/index.sqlite",
        json: true,
    };
    let query_action = build_evidence_read_action(&result, Some("durable output queue"), &context);
    let query_value = serde_json::to_value(query_action).unwrap();
    assert_eq!(
        query_value["command"]["args"],
        json!([
            "read-range",
            "claude-code:abc",
            "--query",
            "durable output queue",
            "--before",
            "2",
            "--after",
            "2",
            "--source",
            "claude-code",
            "--db",
            "/state/index.sqlite",
            "--json"
        ])
    );
    assert_eq!(query_value["command"]["executable"], json!("inherit"));
    let page_action = build_evidence_read_action(&result, None, &context);
    assert_eq!(
        serde_json::to_value(page_action).unwrap()["command"]["args"],
        json!([
            "read-page",
            "claude-code:abc",
            "--offset",
            "0",
            "--limit",
            "40",
            "--source",
            "claude-code",
            "--db",
            "/state/index.sqlite",
            "--json"
        ])
    );
}

#[test]
fn zero_result_helpers_match_ts_mixed_language_guidance() {
    assert_eq!(
        build_relaxed_recall_queries("最近一个星期有没有触发过 multi agent"),
        strings(&["multi agent", "multi agents"])
    );
    let refinement = build_zero_result_refinement("部署 healthcheck 失败");
    assert!(refinement.over_constrained);
    assert!(
        refinement
            .suggested_queries
            .contains(&"healthcheck".to_owned())
    );
    assert!(refinement.suggested_queries.contains(&"部署".to_owned()));
    let diagnosis =
        build_zero_result_diagnosis("部署 healthcheck 失败", CoverageFreshness::Missing);
    assert_eq!(diagnosis.reason, ZeroResultsReason::StaleOrMissingCoverage);
    assert!(diagnosis.hints[0].contains("do not treat this miss as proof"));
}

/// Regression for the reported miss: a zero-result `find` used to tell the
/// reader to run bare `shlog sync`, which only refreshes the default Codex
/// source, so following the advice never repaired a stale `pi` index.
#[test]
fn zero_result_next_action_names_the_searched_source() {
    let selector = Selector::All {
        source: SourceId::Pi,
        root: "/Users/me/.pi/agent/sessions".to_owned(),
    };
    let action = build_zero_results_next_action(SourceId::Pi, Some(&selector), "this find");
    let steps = action.steps.join("\n");
    assert!(steps.contains("shlog status --source pi"), "{steps}");
    assert!(steps.contains("shlog sync --source pi"), "{steps}");
    assert!(
        steps.contains("Bare shlog sync refreshes only the default Codex source"),
        "{steps}"
    );

    let unscoped = build_zero_results_next_action(SourceId::Dsh, None, "this command");
    let unscoped_steps = unscoped.steps.join("\n");
    assert!(
        unscoped_steps.contains("shlog sync --source dsh"),
        "{unscoped_steps}"
    );
}

#[test]
fn global_merge_uses_rrf_and_stable_cross_source_order() {
    assert_eq!(
        public_find_sources(None, None),
        vec![
            SourceId::Codex,
            SourceId::ClaudeCode,
            SourceId::Pi,
            SourceId::Dsh
        ]
    );
    assert_eq!(
        public_find_sources(Some(FindSourceSelection::All), Some(SourceId::Pi)),
        vec![SourceId::Pi]
    );
    let codex = find_result(SourceId::Codex, "codex-id", 1);
    let claude = find_result(SourceId::ClaudeCode, "claude-code:id", 1);
    let merged = merge_find_results([codex, claude], FindSort::Relevance, 10);
    assert_eq!(merged[0].source_id, SourceId::ClaudeCode);
    assert_eq!(merged[0].score, 1.0 / 61.0);
    assert_eq!(merged[0].rank, 1);
    assert_eq!(merged[1].rank, 2);
}

/// The cross-source zero-result guidance must name exactly the sources that
/// were searched, so the reader can sync each of them instead of guessing.
#[test]
fn cross_source_zero_result_next_action_lists_searched_sources() {
    let summary = merge_find_summaries(
        "missing thing",
        FindSort::Relevance,
        &[],
        &[
            empty_summary(SourceId::Pi),
            empty_summary(SourceId::ClaudeCode),
        ],
        10,
    )
    .unwrap();
    let action = summary.next_action.expect("zero results get guidance");
    assert_eq!(
        action.reason,
        QueryNextActionReason::ZeroResultsWithoutSelector
    );
    let steps = action.steps.join("\n");
    assert!(
        steps.contains("This find searched pi, claude-code"),
        "{steps}"
    );
    assert!(steps.contains("shlog sync --source <id>"), "{steps}");
    assert!(
        steps.contains("Bare shlog sync refreshes only the default Codex source"),
        "{steps}"
    );
}

fn empty_summary(source: SourceId) -> FindSummary {
    FindSummary {
        query: "missing thing".to_owned(),
        source_ids: vec![source],
        sort: FindSort::Relevance,
        excluded_sessions: vec![],
        results: vec![],
        scanned_message_count: 0,
        coverage: CoverageStatus {
            requested: None,
            complete: true,
            freshness: CoverageFreshness::Fresh,
            stale_reason: None,
            covering_selectors: vec![],
        },
        coverage_by_source: None,
        next_action: None,
        zero_results: None,
    }
}

#[test]
fn session_field_attribution_uses_the_same_query_terms_as_ranking() {
    let terms = analyze_query("payload beacon").terms;
    assert_eq!(
        matched_session_fields(
            SessionFieldTexts {
                title: "Payload handoff",
                summary: "neutral",
                compact: "beacon retry",
                reasoning_summary: "",
            },
            "payload beacon",
            &terms,
        ),
        vec![FindMatchedField::Title, FindMatchedField::Compact]
    );
}

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_owned()).collect()
}
