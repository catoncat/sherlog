# R1 Handoff: Final Review

Thread: `019e9754-bece-70f0-9945-c344683a11c3`
Status: completed with findings
Mode: `review-session`

## Findings

### P1: Old-schema indexes fail read/list/find/stats paths with raw SQLite errors

E1 reproduced `list --source codex` failing against the default local DB with
`SqliteError: no such column: source_id`, while `status` succeeds only because
it has a read-only old-schema fallback.

Relevant evidence and code:

- `src/db/connection.ts`: read-only DB opens do not run migration.
- `src/status.ts`: status explicitly handles missing `sessions.source_id`.
- `src/db/list-store.ts`: list assumes `source_id` exists.
- `docs/workflows/2026-06-05-session-sources/handoffs/E1-verification.md`: records default-index failure and fresh-db success.

Recommendation: before release, read-only commands should either provide a
clear actionable old-index error or documented upgrade path instead of exposing
raw SQLite schema errors.

### P1: Public install docs and skill source describe unreleased `--source` behavior as installed behavior

README and release skill source describe `--source` as if users installing
`@act0r/sherlog` or global `Sherlog` already have it. E1 proves npm/PATH/global skill
are not updated:

- npm registry version: `0.3.4`.
- installed PATH `Sherlog` rejects `--source`.
- global `Sherlog` skill is a symlink to the main repo skill source, not this
  reconciled checkout.

Recommendation: docs and skill source should distinguish checkout/unreleased
behavior from registry/global-installed behavior until a release/install
workflow actually updates those layers.

### P2: `docs/INDEX_COVERAGE_DESIGN.md` is stale

The coverage design doc omits the source selector dimension and same-source
implication rule, while current code rejects cross-source implication.

Recommendation: update the doc to include source-aware selector/coverage
rules.

## Open Questions

- Should release prep require graceful old-index errors for all read-only
  commands, or is `status -> sync` an acceptable upgrade path?
- Should README keep forward-looking checkout behavior if it is marked
  unreleased, or should it remain strictly registry-current?

## Residual Risks

- Result JSON still includes bare `sessionUuid`; this is acceptable for the
  public Codex-only phase but must be revisited before any public second source.
- `find --exclude-session` remains bare UUID based. It is not current public
  blocker while only Codex is public, but it is a future second-source risk.

## Recommendation

Do not publish/release the slice before remediation. Fix or explicitly document
old-schema read-command behavior, align README/skill install wording with the
actual release sequence, and update coverage design docs.

