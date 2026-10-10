use std::collections::HashSet;

use crate::identity::SourceId;
use crate::model::{
    CoverageFreshness, QueryNextAction, QueryNextActionKind, QueryNextActionReason,
    ZeroResultsDiagnosis, ZeroResultsReason,
};
use crate::selector::Selector;
use crate::tokenizer::{is_cjk_token, query_terms};

use super::utf16;

const ENGLISH_STOPWORDS: &[&str] = &[
    "a", "an", "and", "any", "are", "as", "at", "be", "been", "by", "can", "did", "do", "does",
    "for", "from", "had", "has", "have", "how", "i", "in", "is", "it", "last", "latest", "of",
    "on", "or", "recent", "recently", "that", "the", "this", "to", "was", "we", "week", "were",
    "what", "when", "where", "whether", "which", "who", "why",
];

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ZeroResultRefinement {
    pub over_constrained: bool,
    pub suggested_queries: Vec<String>,
    pub hints: Vec<String>,
}

pub fn build_zero_result_refinement(query: &str) -> ZeroResultRefinement {
    let terms = query_terms(query);
    let mut ascii_terms = distinct(
        terms
            .iter()
            .filter(|term| has_ascii_term_character(term) && !is_stopword(term))
            .cloned(),
    );
    sort_longest_first(&mut ascii_terms);
    let cjk_runs = extract_cjk_runs(query);
    let mixed_script = !ascii_terms.is_empty() && !cjk_runs.is_empty();
    let over_constrained = terms.len() >= 4 || mixed_script;
    let normalized_query = query.trim().to_lowercase();
    let mut suggestions = Vec::new();
    for candidate in ascii_terms.iter().take(2).chain(cjk_runs.iter().take(2)) {
        if candidate.to_lowercase() == normalized_query || suggestions.contains(candidate) {
            continue;
        }
        suggestions.push(candidate.clone());
        if suggestions.len() >= 3 {
            break;
        }
    }

    let mut hints = Vec::new();
    if terms.len() >= 4 {
        hints.push(format!(
            "This query AND-combines {} tokens; retry one distinctive term at a time.",
            terms.len()
        ));
    }
    if mixed_script {
        hints.push(
            "Mixed Chinese/English query: retry the English identifier and the Chinese phrase as separate finds."
                .to_owned(),
        );
    }
    if !suggestions.is_empty() {
        hints.push(
            "Automatic morphological relaxation already ran and found nothing; broaden with the suggested queries instead of retrying the same phrase."
                .to_owned(),
        );
    }
    ZeroResultRefinement {
        over_constrained,
        suggested_queries: suggestions,
        hints,
    }
}

pub fn build_zero_result_diagnosis(
    query: &str,
    coverage_freshness: CoverageFreshness,
) -> ZeroResultsDiagnosis {
    let refinement = build_zero_result_refinement(query);
    let (reason, lead_hint) = match coverage_freshness {
        CoverageFreshness::Fresh => (
            ZeroResultsReason::FreshMiss,
            "Coverage for the searched scope is fresh: this miss is trustworthy for indexed history.",
        ),
        CoverageFreshness::Stale | CoverageFreshness::Missing => (
            ZeroResultsReason::StaleOrMissingCoverage,
            "Coverage is stale or missing: do not treat this miss as proof of absence; refresh the same scope (see nextAction) and retry.",
        ),
        CoverageFreshness::NotChecked => (
            ZeroResultsReason::CoverageNotConfirmed,
            "Coverage freshness was not confirmed for this scope; check status before trusting the miss.",
        ),
    };
    let mut hints = vec![lead_hint.to_owned()];
    hints.extend(refinement.hints);
    ZeroResultsDiagnosis {
        reason,
        over_constrained: refinement.over_constrained,
        suggested_queries: refinement.suggested_queries,
        hints,
    }
}

pub fn build_zero_results_next_action(
    source: SourceId,
    selector: Option<&Selector>,
    command_label: &str,
) -> QueryNextAction {
    let source = source.as_str();
    if let Some(selector) = selector {
        return QueryNextAction {
            kind: QueryNextActionKind::CheckCoverageThenRetry,
            reason: QueryNextActionReason::ZeroResultsWithUnconfirmedSelectorCoverage,
            selector: Some(selector.clone()),
            steps: vec![
                format!("Run shlog status --source {source} for the same selector."),
                format!(
                    "If status requestedCoverage.recommendedAction is sync, run shlog sync --source {source} for the same selector. Bare shlog sync refreshes only the default Codex source."
                ),
                format!(
                    "Retry {command_label} with the same selector before concluding nothing exists."
                ),
            ],
            commands: None,
        };
    }
    QueryNextAction {
        kind: QueryNextActionKind::ChooseSelectorThenCheckCoverage,
        reason: QueryNextActionReason::ZeroResultsWithoutSelector,
        selector: None,
        steps: vec![
            "Choose the narrowest relevant root, cwd, or date selector.".to_owned(),
            format!("Run shlog status --source {source} for that selector."),
            format!(
                "If status requestedCoverage.recommendedAction is sync, run shlog sync --source {source} for that selector. Bare shlog sync refreshes only the default Codex source. Then retry {command_label}."
            ),
        ],
        commands: None,
    }
}

pub fn build_relaxed_recall_queries(query: &str) -> Vec<String> {
    let terms = query_terms(query);
    if terms.len() < 2 {
        return vec![];
    }
    let has_cjk_term = terms.iter().any(|term| contains_cjk(term));
    let ascii_terms = terms
        .iter()
        .filter(|term| has_ascii_term_character(term) && !is_stopword(term))
        .cloned()
        .collect::<Vec<_>>();
    if ascii_terms.is_empty() || ascii_terms.len() == terms.len() {
        return vec![];
    }
    let base_terms = if has_cjk_term {
        ascii_terms
    } else {
        ascii_terms.into_iter().take(5).collect()
    };
    if base_terms.is_empty() || base_terms.len() > 5 {
        return vec![];
    }
    build_morphological_queries(&base_terms)
}

fn build_morphological_queries(terms: &[String]) -> Vec<String> {
    let mut combinations = vec![Vec::<String>::new()];
    for (index, term) in terms.iter().enumerate() {
        let variants = expand_english_term(term, index + 1 == terms.len());
        let mut next = Vec::new();
        'outer: for prefix in &combinations {
            for variant in &variants {
                let mut combination = prefix.clone();
                combination.push(variant.clone());
                next.push(combination);
                if next.len() >= 12 {
                    break 'outer;
                }
            }
        }
        combinations = next;
    }
    distinct(
        combinations
            .into_iter()
            .map(|combination| combination.join(" ")),
    )
}

fn expand_english_term(term: &str, include_plural_variant: bool) -> Vec<String> {
    if !is_expandable_english_term(term) {
        return vec![term.to_owned()];
    }
    let mut variants = vec![term.to_owned()];
    let split = term
        .split(['-', '_'])
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    if split.len() > 1 {
        variants.push(split.join(" "));
        if let Some(last) = split.last() {
            for last_variant in expand_english_term(last, include_plural_variant) {
                let prefix = split[..split.len() - 1].join(" ");
                variants.push(format!("{prefix} {last_variant}"));
            }
        }
    }
    if include_plural_variant {
        if term.ends_with("ies") && term.len() > 4 {
            variants.push(format!("{}y", &term[..term.len() - 3]));
        } else if term.ends_with('s') && !term.ends_with("ss") && term.len() > 3 {
            variants.push(term[..term.len() - 1].to_owned());
        } else {
            variants.push(format!("{term}s"));
        }
    }
    distinct(variants)
}

fn extract_cjk_runs(query: &str) -> Vec<String> {
    let mut runs = Vec::new();
    let mut current = String::new();
    let flush = |current: &mut String, runs: &mut Vec<String>| {
        if current.chars().count() >= 2 {
            runs.push(std::mem::take(current));
        } else {
            current.clear();
        }
    };
    for character in query.chars() {
        if is_cjk_token(&character.to_string()) {
            current.push(character);
        } else {
            flush(&mut current, &mut runs);
        }
    }
    flush(&mut current, &mut runs);
    let mut runs = distinct(runs);
    sort_longest_first(&mut runs);
    runs
}

fn is_expandable_english_term(term: &str) -> bool {
    let mut characters = term.chars();
    characters
        .next()
        .is_some_and(|character| character.is_ascii_alphabetic())
        && term.len() >= 3
        && characters
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
}

fn contains_cjk(term: &str) -> bool {
    term.chars()
        .any(|character| is_cjk_token(&character.to_string()))
}

fn has_ascii_term_character(term: &str) -> bool {
    term.chars()
        .any(|character| character.is_ascii_alphanumeric() || character == '_')
}

fn is_stopword(term: &str) -> bool {
    ENGLISH_STOPWORDS.contains(&term)
}

fn sort_longest_first(values: &mut [String]) {
    values.sort_by(|left, right| {
        utf16::len(right)
            .cmp(&utf16::len(left))
            .then_with(|| left.cmp(right))
    });
}

fn distinct(values: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut seen = HashSet::new();
    values
        .into_iter()
        .filter(|value| seen.insert(value.clone()))
        .collect()
}
