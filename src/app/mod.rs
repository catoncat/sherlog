//! Native application service for the fixed `shlog` command contract.
//!
//! Read commands open SQLite query-only and never inspect raw source files.
//! `status` is the sole read-only command allowed to perform a live metadata
//! scan; `sync` remains the only future content writer.

mod output;
mod selectors;
mod status;

use std::collections::{BTreeSet, HashSet};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Instant;

use serde::Serialize;

use crate::cli::{
    ColdArgs, ColdCommand, FindArgs, FindSort as CliFindSort, ListArgs, ListSort, ReadPageArgs,
    ReadRangeArgs, StatsArgs, StatusArgs, SyncArgs,
};
use crate::cold::{self, cold_roots_path_for_db};
use crate::config::{
    EnvSnapshot, ResolvedPaths, default_db_path, migrate_legacy_data_dir_if_needed,
    resolve_lexical, resolve_paths,
};
use crate::coverage::indexed_coverage;
use crate::error::AppError;
use crate::identity::{SessionRef, SourceId};
use crate::index::{
    CandidateEvidence, DocumentKind, IndexError, IndexLayout, IndexReader, RecallOrder, RecallSpec,
};
use crate::migration::{ColdConfigFence, MigrationRequest, migrate_v7_to_v8};
use crate::model::{
    FindMatchedField, FindSort, FindSummary, SessionListQuery, SessionListSort, SessionListSummary,
    SessionRecord, SourceCoverageStatus,
};
use crate::retrieval::{
    ElisionOptions, ReadAnchorError, RecallMode, RetrievalPlan, SessionFieldTexts, analyze_query,
    build_relaxed_recall_queries, build_zero_result_diagnosis, build_zero_results_next_action,
    elide_messages, matched_session_fields, merge_find_summaries, rank_candidates_for_sort,
    resolve_read_anchor,
};
use crate::runner::{AppServices, parse_public_source};
use crate::selector::Selector;
use crate::sync::{
    PendingColdRoot, RegisteredColdRoot, SyncReport, SyncRequest, SyncStateError,
    add_cold_root_with_cutover, list_cold_roots as list_index_cold_roots,
    remove_cold_root_with_cutover, run_with_cutover,
};

use self::output::{
    write_elapsed_json, write_find_json, write_find_text, write_json, write_list_text,
    write_page_text, write_range_text, write_stats_text, write_status_text, write_sync_text,
};
use self::selectors::{
    all_selector, find_bootstrap_selectors, find_selector, find_sources, list_selector,
    list_source, read_session_ref, sync_selector,
};
use self::status::collect_status;

/// Concrete filesystem/SQLite implementation used by the standalone binary.
pub struct NativeAppServices {
    paths: ResolvedPaths,
    cwd: PathBuf,
    clock: fn() -> String,
    process_started: Instant,
}

impl NativeAppServices {
    pub fn from_current_process() -> Self {
        let env = EnvSnapshot::from_current_process();
        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let home = env
            .get_non_empty("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| cwd.clone());
        let paths = resolve_paths(&env, &cwd, &home);
        Self::new(paths, cwd)
    }

    pub fn new(paths: ResolvedPaths, cwd: PathBuf) -> Self {
        Self {
            paths,
            cwd,
            clock: cold::current_timestamp_millis,
            process_started: Instant::now(),
        }
    }

    pub fn with_clock(mut self, clock: fn() -> String) -> Self {
        self.clock = clock;
        self
    }

    pub fn paths(&self) -> &ResolvedPaths {
        &self.paths
    }

    fn elapsed_ms(&self) -> u64 {
        u64::try_from(self.process_started.elapsed().as_millis()).unwrap_or(u64::MAX)
    }

    fn reader(
        &self,
        path: &Path,
        bootstrap_selectors: Option<Vec<Selector>>,
    ) -> Result<IndexReader, AppError> {
        let path = resolve_lexical(path, &self.cwd);
        IndexReader::open(&path).map_err(|error| {
            let error = map_index_error(error, &path, &self.cwd, &self.paths);
            match bootstrap_selectors {
                Some(selectors) if !selectors.is_empty() => {
                    error.with_index_bootstrap_selectors(selectors)
                }
                _ => error,
            }
        })
    }

    fn find_summary(&self, reader: &IndexReader, args: &FindArgs) -> Result<FindSummary, AppError> {
        let sort = find_sort(args.sort);
        let sources = find_sources(args)?;
        let analysis = analyze_query(&args.query);
        let plan = RetrievalPlan::for_sort(args.limit, sort);
        let excluded_sessions = unique_nonempty(&args.exclude_session);
        let mut summaries = Vec::with_capacity(sources.len());

        for source in sources {
            // A find without an explicit root/cwd/selector resolves to the
            // source's canonical default `all(root)`. Recall scope, coverage
            // scope, and scanned-message scope must be the exact same selector,
            // otherwise uncovered roots would leak into results that the
            // coverage proof does not describe.
            let selector = match find_selector(args, source, &self.paths, &self.cwd)? {
                Some(selector) => selector,
                None => all_selector(source, None, &self.paths, &self.cwd)?,
            };
            let excluded_session_uuids =
                self.resolve_excluded_session_uuids(reader, source, &excluded_sessions)?;
            let candidates = self.recall_with_fallback(
                reader,
                &args.query,
                RecallSpec {
                    terms: analysis.terms.clone(),
                    like_needle: recall_like_needle(&analysis.recall),
                    sources: vec![source],
                    selector: Some(selector.clone()),
                    session: None,
                    excluded_session_uuids,
                    order: recall_order(sort),
                    limit: plan.candidate_limit,
                },
            )?;
            let results = rank_candidates_for_sort(&candidates, &args.query, sort, args.limit);
            let coverage_records = reader
                .coverage_records(source)
                .map_err(|error| map_index_error(error, reader.path(), &self.cwd, &self.paths))?;
            let coverage = indexed_coverage(&coverage_records, Some(&selector));
            let scanned_message_count = reader
                .selector_message_count(&selector)
                .map_err(|error| map_index_error(error, reader.path(), &self.cwd, &self.paths))?;
            let next_action = results
                .is_empty()
                .then(|| build_zero_results_next_action(source, Some(&selector), "this find"));
            summaries.push(FindSummary {
                query: args.query.clone(),
                source_ids: vec![source],
                sort,
                excluded_sessions: excluded_sessions.clone(),
                results,
                scanned_message_count,
                coverage: coverage.clone(),
                coverage_by_source: Some(vec![SourceCoverageStatus {
                    source_id: source,
                    coverage,
                }]),
                next_action,
                zero_results: None,
            });
        }

        let mut summary = merge_find_summaries(
            &args.query,
            sort,
            &excluded_sessions,
            &summaries,
            args.limit,
        )
        .expect("the public source set is non-empty");
        if summary.results.is_empty() {
            summary.zero_results = Some(build_zero_result_diagnosis(
                &args.query,
                summary.coverage.freshness,
            ));
        }
        Ok(summary)
    }

    fn resolve_excluded_session_uuids(
        &self,
        reader: &IndexReader,
        source: SourceId,
        values: &[String],
    ) -> Result<Vec<String>, AppError> {
        let mut resolved = BTreeSet::new();
        for value in values {
            if let Some((prefix, native_session_id)) = value.split_once(':')
                && let Ok(qualified_source) = prefix.parse::<SourceId>()
            {
                if qualified_source != source || native_session_id.is_empty() {
                    continue;
                }
                if let Some(session) = reader
                    .load_session(&SessionRef {
                        source_id: source,
                        native_session_id: native_session_id.to_owned(),
                    })
                    .map_err(|error| {
                        map_index_error(error, reader.path(), &self.cwd, &self.paths)
                    })?
                {
                    resolved.insert(session.session_uuid);
                }
                continue;
            }

            // Bare values remain UUID-compatible for every selected source.
            // They also resolve as a native ID within this source. If UUIDs
            // collide across sources, an unqualified exclusion intentionally
            // excludes each collision; a qualified sessionRef is source-safe.
            resolved.insert(value.clone());
            if let Some(session) = reader
                .load_session(&SessionRef {
                    source_id: source,
                    native_session_id: value.clone(),
                })
                .map_err(|error| map_index_error(error, reader.path(), &self.cwd, &self.paths))?
            {
                resolved.insert(session.session_uuid);
            }
        }
        Ok(resolved.into_iter().collect())
    }

    fn read_anchor(
        &self,
        reader: &IndexReader,
        session: &SessionRecord,
        args: &ReadRangeArgs,
    ) -> Result<i64, AppError> {
        let explicit_seq = args.seq.and_then(|value| value.value());
        let query = args.query.as_deref();
        let top_hit = if explicit_seq.is_none() && query.is_some_and(|value| !value.is_empty()) {
            let analysis = analyze_query(query.expect("query checked above"));
            let like_needle = recall_like_needle(&analysis.recall);
            let mut candidates = self.recall_with_fallback(
                reader,
                query.expect("query checked above"),
                RecallSpec {
                    terms: analysis.terms,
                    like_needle,
                    sources: vec![session.source_id],
                    selector: None,
                    session: Some(SessionRef {
                        source_id: session.source_id,
                        native_session_id: session.native_session_id.clone(),
                    }),
                    excluded_session_uuids: vec![],
                    order: RecallOrder::Relevance,
                    limit: 50,
                },
            )?;
            candidates.retain(|candidate| candidate.kind == DocumentKind::Message);
            rank_candidates_for_sort(
                &candidates,
                query.expect("query checked above"),
                FindSort::Relevance,
                1,
            )
            .into_iter()
            .next()
        } else {
            None
        };
        match resolve_read_anchor(explicit_seq, query, top_hit.as_ref()) {
            Ok(seq) => Ok(seq),
            Err(ReadAnchorError::MissingAnchorSpec) => Err(AppError::invalid_arguments(
                "read-range requires an explicit sessionRef plus either --seq or --query",
            )),
            Err(ReadAnchorError::NoMessageHit) => {
                let query = query.unwrap_or_default();
                let analysis = analyze_query(query);
                let matched_profile_fields = matched_session_fields(
                    SessionFieldTexts {
                        title: &session.title,
                        summary: &session.summary_text,
                        compact: &session.compact_text,
                        reasoning_summary: &session.reasoning_summary_text,
                    },
                    query,
                    &analysis.terms,
                )
                .iter()
                .map(|field| match field {
                    FindMatchedField::Title => "title",
                    FindMatchedField::Summary => "summary",
                    FindMatchedField::Compact => "compact",
                    FindMatchedField::ReasoningSummary => "reasoningSummary",
                    FindMatchedField::Message => "message",
                })
                .map(str::to_owned)
                .collect::<Vec<_>>();
                let session_ref = SessionRef {
                    source_id: session.source_id,
                    native_session_id: session.native_session_id.clone(),
                };
                let read_page_argv = vec![
                    "shlog".to_owned(),
                    "read-page".to_owned(),
                    session_ref.qualified(),
                    "--db".to_owned(),
                    reader.path().to_string_lossy().into_owned(),
                    "--json".to_owned(),
                ];
                Err(AppError::anchor_not_found(
                    session_ref.qualified(),
                    session.source_id.as_str(),
                    &session.native_session_id,
                    reader.path().to_string_lossy(),
                    query,
                    matched_profile_fields,
                    read_page_argv,
                ))
            }
        }
    }

    fn migrate_default_data_dir_for_writer(&self, db_path: &Path) -> Result<(), AppError> {
        if resolve_lexical(db_path, &self.cwd) == self.paths.db_path {
            migrate_legacy_data_dir_if_needed(&self.paths)
                .map_err(|error| AppError::index_failure(error.to_string()))?;
        }
        Ok(())
    }

    fn existing_index_layout(&self, db_path: &Path) -> Result<Option<IndexLayout>, AppError> {
        if !db_path.exists() {
            return Ok(None);
        }
        let reader = IndexReader::open(db_path)
            .map_err(|error| map_index_error(error, db_path, &self.cwd, &self.paths))?;
        Ok(Some(reader.layout()))
    }

    fn migrate_v7_for_writer(
        &self,
        db_path: &Path,
        cold_config: &Path,
        layout: Option<IndexLayout>,
    ) -> Result<(), AppError> {
        if layout != Some(IndexLayout::V7) {
            return Ok(());
        }
        migrate_v7_to_v8(
            &MigrationRequest::for_database(db_path, &self.cwd).with_cold_roots_config(cold_config),
        )
        .map(|_| ())
        .map_err(|error| AppError::index_failure(error.to_string()))
    }

    fn cold_fence(&self, config_path: &Path) -> Result<ColdConfigFence, AppError> {
        ColdConfigFence::inspect(config_path).map_err(|error| {
            AppError::index_failure(format!(
                "inspect legacy cold-roots state {}: {error}",
                config_path.display()
            ))
        })
    }

    fn pending_cold_roots(
        &self,
        fence: &ColdConfigFence,
    ) -> Result<Vec<PendingColdRoot>, AppError> {
        fence
            .cold_roots(&self.cwd)
            .map_err(|error| AppError::index_failure(error.to_string()))?
            .into_iter()
            .map(|entry| {
                let source = entry.source_id.parse::<SourceId>().map_err(|_| {
                    AppError::index_failure(format!(
                        "strict cold-roots parser returned unsupported source {:?}",
                        entry.source_id
                    ))
                })?;
                Ok(PendingColdRoot::new(
                    source,
                    PathBuf::from(entry.root),
                    entry.added_at,
                ))
            })
            .collect()
    }

    fn emit_sync_report(
        &self,
        report: &SyncReport,
        json: bool,
        default_source_selected: bool,
        writer: &mut dyn Write,
    ) -> Result<(), AppError> {
        if json {
            write_json(writer, report)
        } else {
            write_sync_text(writer, report, default_source_selected)
        }
    }

    fn dispatch_cold(
        &self,
        args: &ColdArgs,
        db_path: &Path,
        layout: Option<IndexLayout>,
        stdout: &mut dyn Write,
    ) -> Result<(), AppError> {
        let config_path = cold_roots_path_for_db(db_path, &self.cwd);
        match &args.command {
            ColdCommand::Add(args) => {
                let source = parse_public_source(&args.source)?;
                let mut fence = self.cold_fence(&config_path)?;
                let pending = layout
                    .is_none()
                    .then(|| self.pending_cold_roots(&fence))
                    .transpose()?;
                let mutation = add_cold_root_with_cutover(
                    db_path,
                    source,
                    &args.root,
                    &(self.clock)(),
                    &self.cwd,
                    pending.as_deref(),
                    &mut fence,
                )
                .map_err(|error| map_sync_state_error(error, &self.cwd, &self.paths))?;
                let entry = mutation.entry.ok_or_else(|| {
                    AppError::index_failure("cold add succeeded without a registered entry")
                })?;
                if args.json {
                    write_json(
                        stdout,
                        &ColdAddPayload {
                            ok: true,
                            config_path: path_text(&config_path)?,
                            entry,
                        },
                    )
                } else {
                    writeln!(
                        stdout,
                        "cold root registered ({}): {}",
                        entry.source_id.as_str(),
                        entry.root
                    )
                    .map_err(AppError::output)?;
                    writeln!(stdout, "config: {}", config_path.display()).map_err(AppError::output)
                }
            }
            ColdCommand::List(args) => {
                let source = args
                    .source
                    .as_deref()
                    .map(parse_public_source)
                    .transpose()?;
                let roots = if layout == Some(IndexLayout::V8) {
                    list_index_cold_roots(db_path, source)
                        .map_err(|error| map_sync_state_error(error, &self.cwd, &self.paths))?
                } else {
                    let fence = self.cold_fence(&config_path)?;
                    self.pending_cold_roots(&fence)?
                        .into_iter()
                        .filter(|entry| source.is_none_or(|source| entry.source_id == source))
                        .map(|entry| {
                            Ok(RegisteredColdRoot {
                                source_id: entry.source_id,
                                root: path_text(&entry.root)?,
                                added_at: entry.added_at,
                            })
                        })
                        .collect::<Result<Vec<_>, AppError>>()?
                };
                if args.json {
                    write_json(
                        stdout,
                        &ColdListPayload {
                            config_path: path_text(&config_path)?,
                            roots,
                        },
                    )
                } else {
                    if roots.is_empty() {
                        writeln!(stdout, "no cold roots registered").map_err(AppError::output)?;
                    } else {
                        for entry in roots {
                            writeln!(
                                stdout,
                                "{}\t{}\t{}",
                                entry.source_id.as_str(),
                                entry.root,
                                entry.added_at
                            )
                            .map_err(AppError::output)?;
                        }
                    }
                    writeln!(stdout, "config: {}", config_path.display()).map_err(AppError::output)
                }
            }
            ColdCommand::Remove(args) => {
                let source = parse_public_source(&args.source)?;
                let mut fence = self.cold_fence(&config_path)?;
                let has_legacy_state = fence.snapshot_bytes().is_some() || fence.is_published();
                let pending = (layout.is_none() && has_legacy_state)
                    .then(|| self.pending_cold_roots(&fence))
                    .transpose()?;
                let mutation = remove_cold_root_with_cutover(
                    db_path,
                    source,
                    &args.root,
                    &self.cwd,
                    pending.as_deref(),
                    &mut fence,
                )
                .map_err(|error| map_sync_state_error(error, &self.cwd, &self.paths))?;
                let original_root = path_text(&args.root)?;
                if args.json {
                    write_json(
                        stdout,
                        &ColdRemovePayload {
                            ok: true,
                            removed: mutation.changed,
                            config_path: path_text(&config_path)?,
                            root: original_root,
                            source_id: source.as_str(),
                        },
                    )
                } else {
                    let state = if mutation.changed {
                        "removed"
                    } else {
                        "not registered"
                    };
                    writeln!(
                        stdout,
                        "cold root {state} ({}): {original_root}",
                        source.as_str()
                    )
                    .map_err(AppError::output)?;
                    writeln!(stdout, "config: {}", config_path.display()).map_err(AppError::output)
                }
            }
        }
    }
    fn recall_with_fallback(
        &self,
        reader: &IndexReader,
        query: &str,
        spec: RecallSpec,
    ) -> Result<Vec<CandidateEvidence>, AppError> {
        let recall = |terms: Vec<String>, like_needle: Option<String>| {
            let mut request = spec.clone();
            request.terms = terms;
            request.like_needle = like_needle;
            reader.recall(&request)
        };
        let map = |error: IndexError| map_index_error(error, reader.path(), &self.cwd, &self.paths);
        let mut candidates = recall(spec.terms.clone(), spec.like_needle.clone()).map_err(map)?;
        if !candidates.is_empty() {
            return Ok(candidates);
        }
        let mut seen = HashSet::new();
        for relaxed in build_relaxed_recall_queries(query) {
            let analysis = analyze_query(&relaxed);
            for candidate in recall(analysis.terms, recall_like_needle(&analysis.recall))
                .map_err(|error| AppError::output(format!("query index: {error}")))?
            {
                let key = candidate_key(&candidate);
                if seen.insert(key) {
                    candidates.push(candidate);
                }
            }
        }
        Ok(candidates)
    }
}

impl AppServices for NativeAppServices {
    fn prepare(&mut self) -> Result<(), AppError> {
        Ok(())
    }

    fn status(
        &mut self,
        args: &StatusArgs,
        stdout: &mut dyn Write,
        _stderr: &mut dyn Write,
    ) -> Result<(), AppError> {
        let summary = collect_status(args, &self.paths, &self.cwd)?;
        if args.json {
            write_json(stdout, &summary)
        } else {
            write_status_text(stdout, &summary)
        }
    }

    fn sync(
        &mut self,
        args: &SyncArgs,
        stdout: &mut dyn Write,
        stderr: &mut dyn Write,
    ) -> Result<(), AppError> {
        let selector = sync_selector(args, &self.paths, &self.cwd)?;
        let db_path = resolve_lexical(&args.database.db, &self.cwd);
        self.migrate_default_data_dir_for_writer(&db_path)?;
        let cold_config_path = cold_roots_path_for_db(&db_path, &self.cwd);
        let initial_layout = self.existing_index_layout(&db_path)?;
        self.migrate_v7_for_writer(&db_path, &cold_config_path, initial_layout)?;
        let mut cold_fence = self.cold_fence(&cold_config_path)?;
        let pending_cold_roots = initial_layout
            .is_none()
            .then(|| self.pending_cold_roots(&cold_fence))
            .transpose()?
            .unwrap_or_default();

        let mut retention_roots = args
            .cold_root
            .iter()
            .map(|root| resolve_lexical(root, &self.cwd))
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        retention_roots.shrink_to_fit();
        let mut request = SyncRequest::new(&db_path, selector);
        request.best_effort = args.best_effort;
        request.prune = args.prune;
        request.cold_roots = retention_roots;
        request.pending_cold_roots = pending_cold_roots;

        match run_with_cutover(request, &mut cold_fence) {
            Ok(report) => self.emit_sync_report(&report, args.json, args.source.is_none(), stdout),
            Err(failure) => {
                let report = failure.report;
                let writer: &mut dyn Write = if args.json && !args.best_effort {
                    stderr
                } else {
                    stdout
                };
                self.emit_sync_report(&report, args.json, args.source.is_none(), writer)?;
                Err(AppError::command_failed_silent())
            }
        }
    }

    fn cold(
        &mut self,
        args: &ColdArgs,
        stdout: &mut dyn Write,
        _stderr: &mut dyn Write,
    ) -> Result<(), AppError> {
        let db_path = match &args.command {
            ColdCommand::Add(args) => &args.database.db,
            ColdCommand::List(args) => &args.database.db,
            ColdCommand::Remove(args) => &args.database.db,
        };
        let db_path = resolve_lexical(db_path, &self.cwd);
        let writer = !matches!(&args.command, ColdCommand::List(_));
        if writer {
            self.migrate_default_data_dir_for_writer(&db_path)?;
        }
        let mut layout = self.existing_index_layout(&db_path)?;
        if writer && layout == Some(IndexLayout::V7) {
            let config_path = cold_roots_path_for_db(&db_path, &self.cwd);
            self.migrate_v7_for_writer(&db_path, &config_path, layout)?;
            layout = Some(IndexLayout::V8);
        }
        self.dispatch_cold(args, &db_path, layout, stdout)
    }

    fn find(
        &mut self,
        args: &FindArgs,
        stdout: &mut dyn Write,
        _stderr: &mut dyn Write,
    ) -> Result<(), AppError> {
        let bootstrap_selectors = find_bootstrap_selectors(args, &self.paths, &self.cwd)?;
        let reader = self.reader(&args.database.db, bootstrap_selectors)?;
        let summary = self.find_summary(&reader, args)?;
        let elapsed_ms = self.elapsed_ms();
        if args.json {
            write_find_json(
                stdout,
                &summary,
                elapsed_ms,
                &reader.path().to_string_lossy(),
                args.json,
            )
        } else {
            write_find_text(
                stdout,
                &summary,
                non_default_db_text(reader.path()).as_deref(),
            )
        }
    }

    fn read_range(
        &mut self,
        args: &ReadRangeArgs,
        stdout: &mut dyn Write,
        _stderr: &mut dyn Write,
    ) -> Result<(), AppError> {
        let session_ref = read_session_ref(&args.session_ref, args.source.as_deref())?;
        let bootstrap_selector = all_selector(session_ref.source_id, None, &self.paths, &self.cwd)?;
        let reader = self.reader(&args.database.db, Some(vec![bootstrap_selector]))?;
        let session = reader
            .load_session(&session_ref)
            .map_err(|error| map_index_error(error, reader.path(), &self.cwd, &self.paths))?;
        if session.is_none() {
            return Err(session_not_found_error(
                &session_ref,
                reader.path(),
                read_range_retry_argv(&session_ref, args, reader.path()),
            ));
        }
        let anchor = self.read_anchor(&reader, &session.expect("checked above"), args)?;
        let mut summary = reader
            .read_range(&session_ref, anchor, args.before as u64, args.after as u64)
            .map_err(|error| map_index_error(error, reader.path(), &self.cwd, &self.paths))?;
        summary.messages = elide_messages(
            &summary.messages,
            ElisionOptions {
                max_message_chars: Some(args.max_message_chars),
                anchor_seq: Some(anchor),
                query: args.query.as_deref(),
            },
        );
        if args.json {
            write_elapsed_json(stdout, &summary, self.elapsed_ms())
        } else {
            write_range_text(stdout, &summary)
        }
    }

    fn read_page(
        &mut self,
        args: &ReadPageArgs,
        stdout: &mut dyn Write,
        _stderr: &mut dyn Write,
    ) -> Result<(), AppError> {
        let session_ref = read_session_ref(&args.session_ref, args.source.as_deref())?;
        let bootstrap_selector = all_selector(session_ref.source_id, None, &self.paths, &self.cwd)?;
        let reader = self.reader(&args.database.db, Some(vec![bootstrap_selector]))?;
        let mut summary = reader
            .read_page(&session_ref, args.offset as u64, args.limit as u64)
            .map_err(|error| match error {
                IndexError::SessionNotFound(_) => session_not_found_error(
                    &session_ref,
                    reader.path(),
                    read_page_retry_argv(&session_ref, args, reader.path()),
                ),
                other => map_index_error(other, reader.path(), &self.cwd, &self.paths),
            })?;
        summary.messages = elide_messages(
            &summary.messages,
            ElisionOptions {
                max_message_chars: Some(args.max_message_chars),
                anchor_seq: None,
                query: None,
            },
        );
        if args.json {
            write_elapsed_json(stdout, &summary, self.elapsed_ms())
        } else {
            write_page_text(stdout, &summary)
        }
    }

    fn list(
        &mut self,
        args: &ListArgs,
        stdout: &mut dyn Write,
        _stderr: &mut dyn Write,
    ) -> Result<(), AppError> {
        let source = list_source(args)?;
        let selector = list_selector(args, source, &self.paths, &self.cwd)?;
        let bootstrap_selector =
            selector
                .clone()
                .unwrap_or(all_selector(source, None, &self.paths, &self.cwd)?);
        let reader = self.reader(&args.database.db, Some(vec![bootstrap_selector]))?;
        let query = SessionListQuery {
            source_id: Some(source),
            cwd: args.cwd.clone(),
            since: args.since.clone(),
            selector: selector.clone(),
            sort: list_sort(args.sort),
            limit: args.limit as u64,
        };
        let results = reader
            .list(&query)
            .map_err(|error| map_index_error(error, reader.path(), &self.cwd, &self.paths))?;
        let records = reader
            .coverage_records(source)
            .map_err(|error| map_index_error(error, reader.path(), &self.cwd, &self.paths))?;
        let summary = SessionListSummary {
            query,
            coverage: indexed_coverage(&records, selector.as_ref()),
            next_action: results
                .is_empty()
                .then(|| build_zero_results_next_action(source, selector.as_ref(), "this command")),
            results,
        };
        if args.json {
            write_json(stdout, &summary)
        } else {
            write_list_text(
                stdout,
                &summary,
                non_default_db_text(reader.path()).as_deref(),
            )
        }
    }

    fn stats(
        &mut self,
        args: &StatsArgs,
        stdout: &mut dyn Write,
        _stderr: &mut dyn Write,
    ) -> Result<(), AppError> {
        let source = args
            .source
            .as_deref()
            .unwrap_or("codex")
            .trim()
            .parse::<SourceId>()
            .map_err(|_| AppError::unsupported_source(args.source.as_deref().unwrap_or("codex")))?;
        let bootstrap_selector = all_selector(source, None, &self.paths, &self.cwd)?;
        let reader = self.reader(&args.database.db, Some(vec![bootstrap_selector]))?;
        let summary = reader
            .stats(source)
            .map_err(|error| map_index_error(error, reader.path(), &self.cwd, &self.paths))?;
        if args.json {
            write_json(stdout, &summary)
        } else {
            write_stats_text(stdout, &summary)
        }
    }
}

/// Text mode prints `--db` only when the opened index is not what a fresh
/// `shlog` process would open by default, so pasted `read:` commands stay
/// closed over the same index without repeating the default path every line.
fn non_default_db_text(db_path: &Path) -> Option<String> {
    (db_path != default_db_path()).then(|| db_path.to_string_lossy().into_owned())
}

fn recall_like_needle(mode: &RecallMode) -> Option<String> {
    match mode {
        RecallMode::Like { needle } => Some(needle.clone()),
        RecallMode::Empty | RecallMode::Fts { .. } => None,
    }
}

fn candidate_key(candidate: &CandidateEvidence) -> String {
    let kind = match candidate.kind {
        DocumentKind::Message => "message",
        DocumentKind::SessionProfile => "session",
    };
    format!(
        "{}\0{}\0{}\0{}",
        candidate.source_id,
        candidate.session_key,
        kind,
        candidate
            .seq
            .map(|value| value.to_string())
            .unwrap_or_default()
    )
}

fn unique_nonempty(values: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    values
        .iter()
        .filter_map(|value| {
            let value = value.trim();
            (!value.is_empty() && seen.insert(value.to_owned())).then(|| value.to_owned())
        })
        .collect()
}

fn find_sort(sort: CliFindSort) -> FindSort {
    match sort {
        CliFindSort::Relevance => FindSort::Relevance,
        CliFindSort::Ended => FindSort::Ended,
        CliFindSort::Started => FindSort::Started,
    }
}

fn recall_order(sort: FindSort) -> RecallOrder {
    match sort {
        FindSort::Relevance => RecallOrder::Relevance,
        FindSort::Ended => RecallOrder::Ended,
        FindSort::Started => RecallOrder::Started,
    }
}

fn list_sort(sort: ListSort) -> SessionListSort {
    match sort {
        ListSort::Ended => SessionListSort::Ended,
        ListSort::Started => SessionListSort::Started,
        ListSort::Messages => SessionListSort::Messages,
    }
}

pub(crate) fn map_index_error(
    error: IndexError,
    db_path: &Path,
    cwd: &Path,
    paths: &ResolvedPaths,
) -> AppError {
    match error {
        IndexError::NotFound(_) => AppError::index_unavailable(
            db_path.to_string_lossy(),
            cwd.to_string_lossy(),
            paths.default_codex_dir.to_string_lossy(),
        ),
        schema_error @ IndexError::UnsupportedSchema { .. } => AppError::schema_upgrade_required(
            schema_error.to_string(),
            db_path.to_string_lossy(),
            vec![],
        ),
        IndexError::SessionNotFound(session_ref) => {
            let parsed = crate::identity::parse_session_ref(&session_ref);
            let retry = vec![
                "shlog".to_owned(),
                "read-page".to_owned(),
                parsed.qualified(),
                "--db".to_owned(),
                db_path.to_string_lossy().into_owned(),
            ];
            session_not_found_error(&parsed, db_path, retry)
        }
        other => AppError::index_failure(other.to_string()),
    }
}

fn map_sync_state_error(error: SyncStateError, cwd: &Path, paths: &ResolvedPaths) -> AppError {
    match error {
        SyncStateError::IndexUnavailable { db_path } => AppError::index_unavailable(
            db_path.to_string_lossy(),
            cwd.to_string_lossy(),
            paths.default_codex_dir.to_string_lossy(),
        ),
        SyncStateError::IndexSchemaUpgradeRequired { db_path } => {
            AppError::schema_upgrade_required(
                format!(
                    "sync state requires an explicit v8 migration: {}",
                    db_path.display()
                ),
                db_path.to_string_lossy(),
                vec![],
            )
        }
        SyncStateError::InvalidColdRoot { root, message } => {
            let root = root.display();
            let message = match message.strip_prefix("cannot inspect cold root: ") {
                Some(detail) => format!("cannot inspect cold root {root}: {detail}"),
                None => format!("{message}: {root}"),
            };
            AppError::cold_root(message)
        }
        SyncStateError::WriterLock { db_path, message } => AppError::index_failure(format!(
            "acquire writer lock for {}: {message}",
            db_path.display()
        )),
        SyncStateError::IndexFailure { db_path, message } => AppError::index_failure(format!(
            "update sync state in {}: {message}",
            db_path.display()
        )),
        SyncStateError::LegacyCutover { db_path, message } => AppError::index_failure(format!(
            "publish legacy state fence for {}: {message}",
            db_path.display()
        )),
    }
}

fn path_text(path: &Path) -> Result<String, AppError> {
    path.to_str()
        .map(str::to_owned)
        .ok_or_else(|| AppError::cold_root("cold root path must be valid UTF-8"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ColdAddPayload {
    ok: bool,
    config_path: String,
    entry: RegisteredColdRoot,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ColdListPayload {
    config_path: String,
    roots: Vec<RegisteredColdRoot>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ColdRemovePayload<'a> {
    ok: bool,
    removed: bool,
    config_path: String,
    root: String,
    source_id: &'a str,
}

fn session_not_found_error(
    session_ref: &SessionRef,
    db_path: &Path,
    retry_argv: Vec<String>,
) -> AppError {
    AppError::session_not_found(
        session_ref.qualified(),
        session_ref.source_id.as_str(),
        &session_ref.native_session_id,
        db_path.to_string_lossy(),
        retry_argv,
    )
}

fn read_page_retry_argv(
    session_ref: &SessionRef,
    args: &ReadPageArgs,
    db_path: &Path,
) -> Vec<String> {
    let mut argv = vec![
        "shlog".to_owned(),
        "read-page".to_owned(),
        session_ref.qualified(),
        "--offset".to_owned(),
        args.offset.to_string(),
        "--limit".to_owned(),
        args.limit.to_string(),
    ];
    if args.max_message_chars != crate::retrieval::DEFAULT_MAX_MESSAGE_CHARS {
        argv.push("--max-message-chars".to_owned());
        argv.push(args.max_message_chars.to_string());
    }
    argv.push("--db".to_owned());
    argv.push(db_path.to_string_lossy().into_owned());
    argv
}

fn read_range_retry_argv(
    session_ref: &SessionRef,
    args: &ReadRangeArgs,
    db_path: &Path,
) -> Vec<String> {
    let mut argv = vec![
        "shlog".to_owned(),
        "read-range".to_owned(),
        session_ref.qualified(),
    ];
    if let Some(seq) = args.seq.and_then(|value| value.value()) {
        argv.push("--seq".to_owned());
        argv.push(seq.to_string());
    }
    if let Some(query) = &args.query {
        argv.push("--query".to_owned());
        argv.push(query.clone());
    }
    argv.push("--before".to_owned());
    argv.push(args.before.to_string());
    argv.push("--after".to_owned());
    argv.push(args.after.to_string());
    if args.max_message_chars != crate::retrieval::DEFAULT_MAX_MESSAGE_CHARS {
        argv.push("--max-message-chars".to_owned());
        argv.push(args.max_message_chars.to_string());
    }
    argv.push("--db".to_owned());
    argv.push(db_path.to_string_lossy().into_owned());
    argv
}

#[cfg(test)]
mod tests;
