use std::collections::{HashMap, HashSet};

use crate::identity::SourceId;
use crate::model::{
    CoverageFreshness, CoverageStatus, FindResult, FindSort, FindSummary, QueryNextAction,
    QueryNextActionKind, QueryNextActionReason, SourceCoverageStatus,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FindSourceSelection {
    All,
    Source(SourceId),
}

pub fn public_find_sources(
    selection: Option<FindSourceSelection>,
    selector_source: Option<SourceId>,
) -> Vec<SourceId> {
    if let Some(FindSourceSelection::Source(source)) = selection {
        return vec![source];
    }
    if let Some(source) = selector_source {
        return vec![source];
    }
    SourceId::ALL.to_vec()
}

pub fn merge_find_results(
    results: impl IntoIterator<Item = FindResult>,
    sort: FindSort,
    limit: usize,
) -> Vec<FindResult> {
    let mut deduped: HashMap<String, FindResult> = HashMap::new();
    for result in results {
        let key = format!("{}\0{}", result.source_id, result.session_ref);
        let should_replace = deduped.get(&key).is_none_or(|existing| {
            result.rank < existing.rank
                || (result.rank == existing.rank && result.score > existing.score)
        });
        if should_replace {
            deduped.insert(key, result);
        }
    }

    let mut rows = deduped.into_values().collect::<Vec<_>>();
    match sort {
        FindSort::Relevance => {
            for result in &mut rows {
                result.score = reciprocal_rank_score(result.rank);
            }
            rows.sort_by(compare_merged_relevance);
        }
        FindSort::Ended | FindSort::Started => {
            rows.sort_by(|left, right| compare_merged_time(left, right, sort));
        }
    }
    rows.truncate(limit);
    for (index, result) in rows.iter_mut().enumerate() {
        result.rank = (index + 1) as u64;
    }
    rows
}

pub fn merge_find_summaries(
    query: &str,
    sort: FindSort,
    excluded_sessions: &[String],
    summaries: &[FindSummary],
    limit: usize,
) -> Option<FindSummary> {
    if summaries.is_empty() {
        return None;
    }
    if summaries.len() == 1 {
        return Some(summaries[0].clone());
    }

    let results = merge_find_results(
        summaries
            .iter()
            .flat_map(|summary| summary.results.iter().cloned()),
        sort,
        limit,
    );
    let coverage_by_source = summaries
        .iter()
        .flat_map(|summary| {
            summary.coverage_by_source.clone().unwrap_or_else(|| {
                summary
                    .source_ids
                    .iter()
                    .copied()
                    .map(|source_id| SourceCoverageStatus {
                        source_id,
                        coverage: summary.coverage.clone(),
                    })
                    .collect()
            })
        })
        .collect::<Vec<_>>();
    let coverage = CoverageStatus {
        requested: None,
        complete: coverage_by_source
            .iter()
            .all(|entry| entry.coverage.complete),
        freshness: merged_coverage_freshness(
            coverage_by_source
                .iter()
                .map(|entry| entry.coverage.freshness),
        ),
        stale_reason: None,
        covering_selectors: coverage_by_source
            .iter()
            .flat_map(|entry| entry.coverage.covering_selectors.iter().cloned())
            .collect(),
    };
    let coverage_actions = summaries
        .iter()
        .filter_map(|summary| summary.next_action.as_ref())
        .filter(|action| action.reason == QueryNextActionReason::StaleOrMissingCoverage)
        .cloned()
        .collect::<Vec<_>>();
    let next_action = if !coverage_actions.is_empty() {
        Some(build_cross_source_coverage_next_action(&coverage_actions))
    } else if results.is_empty() {
        let sources = summaries
            .iter()
            .flat_map(|summary| summary.source_ids.iter().copied())
            .collect::<Vec<_>>();
        Some(build_cross_source_zero_results_next_action(&sources))
    } else {
        None
    };

    Some(FindSummary {
        query: query.to_owned(),
        source_ids: summaries
            .iter()
            .flat_map(|summary| summary.source_ids.iter().copied())
            .collect(),
        sort,
        excluded_sessions: unique_non_empty(excluded_sessions),
        results,
        scanned_message_count: summaries
            .iter()
            .map(|summary| summary.scanned_message_count)
            .sum(),
        coverage,
        coverage_by_source: Some(coverage_by_source),
        next_action,
        zero_results: None,
    })
}

fn reciprocal_rank_score(rank: u64) -> f64 {
    1.0 / (60.0 + rank as f64)
}

fn compare_merged_relevance(left: &FindResult, right: &FindResult) -> std::cmp::Ordering {
    right
        .score
        .total_cmp(&left.score)
        .then_with(|| right.ended_at.cmp(&left.ended_at))
        .then_with(|| compare_stable_find_result(left, right))
}

fn compare_merged_time(
    left: &FindResult,
    right: &FindResult,
    sort: FindSort,
) -> std::cmp::Ordering {
    let (left_time, right_time) = match sort {
        FindSort::Started => (&left.started_at, &right.started_at),
        FindSort::Ended => (&left.ended_at, &right.ended_at),
        FindSort::Relevance => unreachable!(),
    };
    right_time
        .cmp(left_time)
        .then_with(|| right.score.total_cmp(&left.score))
        .then_with(|| compare_stable_find_result(left, right))
}

fn compare_stable_find_result(left: &FindResult, right: &FindResult) -> std::cmp::Ordering {
    left.source_id
        .as_str()
        .cmp(right.source_id.as_str())
        .then_with(|| left.session_ref.cmp(&right.session_ref))
}

fn merged_coverage_freshness(
    freshness: impl IntoIterator<Item = CoverageFreshness>,
) -> CoverageFreshness {
    let values = freshness.into_iter().collect::<Vec<_>>();
    if values
        .iter()
        .all(|value| *value == CoverageFreshness::Fresh)
    {
        CoverageFreshness::Fresh
    } else if values.contains(&CoverageFreshness::Missing) {
        CoverageFreshness::Missing
    } else if values.contains(&CoverageFreshness::Stale) {
        CoverageFreshness::Stale
    } else {
        CoverageFreshness::NotChecked
    }
}

fn build_cross_source_zero_results_next_action(sources: &[SourceId]) -> QueryNextAction {
    let source_list = sources
        .iter()
        .map(|source| source.as_str())
        .collect::<Vec<_>>()
        .join(", ");
    QueryNextAction {
        kind: QueryNextActionKind::ChooseSelectorThenCheckCoverage,
        reason: QueryNextActionReason::ZeroResultsWithoutSelector,
        selector: None,
        steps: vec![
            format!("This find searched {source_list}."),
            "For each of those sources, run shlog status --source <id> for the same selector."
                .to_owned(),
            "If a source reports requestedCoverage.recommendedAction as sync, run shlog sync --source <id> for that source and selector. Bare shlog sync refreshes only the default Codex source."
                .to_owned(),
            "Retry this find before concluding nothing exists.".to_owned(),
        ],
        commands: None,
    }
}

fn build_cross_source_coverage_next_action(actions: &[QueryNextAction]) -> QueryNextAction {
    let commands = actions
        .iter()
        .flat_map(|action| action.commands.iter().flatten().cloned())
        .collect::<Vec<_>>();
    let mut steps = vec![
        "One or more searched sources have stale or missing coverage; merged results may be incomplete or misleading."
            .to_owned(),
    ];
    steps.extend(
        commands
            .iter()
            .filter(|command| command.recommended)
            .map(|command| format!("Run {}.", command.argv.join(" "))),
    );
    steps.push("Retry this find before treating current results as complete.".to_owned());
    QueryNextAction {
        kind: QueryNextActionKind::CheckCoverageThenRetry,
        reason: QueryNextActionReason::StaleOrMissingCoverage,
        selector: None,
        steps,
        commands: Some(commands),
    }
}

fn unique_non_empty(values: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    values
        .iter()
        .filter_map(|value| {
            let trimmed = value.trim();
            (!trimmed.is_empty() && seen.insert(trimmed.to_owned())).then(|| trimmed.to_owned())
        })
        .collect()
}
