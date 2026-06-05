---
name: cxs-dogfood
description: "Dev-only interactive workflow for cxs maintainers to capture, verify, promote, and hand off private dogfood golden examples from real Codex history. Use only when the user explicitly says $cxs-dogfood, 记录这个 case, 添加 dogfood case, 记录这个 cxs golden, 把这次加入 dogfood, promote dogfood golden, or similar. When triggered, infer the case from the current conversation and ask only for missing essentials; do not make the user fill a template. After capture/eval, offer to start a repair handoff for another agent or continue fixing in the same chat. Do not use for normal cxs searches, normal coding tasks, or published cxs skill package edits."
---

# cxs-dogfood

Dev-only interactive workflow for maintaining private cxs dogfood golden examples while developing `/Users/envvar/work/repos/cxs`.

This skill is **not** a user-facing cxs feature and must not be copied into `skill-packages/cxs` or repo-local `.agents/skills`. Dogfooding always runs the **in-development** CLI via `npm run cxs --` (= `tsx ./src/cli.ts`) from the repo checkout, so it tracks the current working tree regardless of which global `cxs` is installed or however `cxs` is switched.

## Interaction contract

When the user says only something like:

```text
$cxs-dogfood 记录这个 case
```

handle the rest interactively. Do **not** ask the user to fill a JSON template.

Default behavior:

1. Infer from the current conversation:
   - the original user ask / query wording
   - whether the observed command was the published `cxs` or the in-development CLI (`npm run cxs --`)
   - the bad behavior: recall miss, wrong ranking, wrong context, selector/coverage issue, or skill-guidance issue
   - any expected target session, cwd, title, snippet, or phrase already mentioned
2. Reproduce with the in-development CLI (`npm run cxs --`) from the current checkout.
3. If the expected target or evidence phrase is still ambiguous, ask **one concise question** for the missing essential. Ask at most three short questions only if the case cannot be made evidence-backed otherwise.
4. Append a `candidate` golden only after observed CLI/read output supports it.
5. Report the created id, query/workflow attempts, target session(s), status, and current eval result.
6. Ask whether to start a repair handoff now, continue fixing in this chat, or stop after capture.

Good user prompt:

```text
$cxs-dogfood 记录这个 case
```

Good agent response pattern:

- "我会从刚才这次 cxs 不符合预期的对话里提取 query 和期望。"
- run commands
- only ask if target/expectation is missing
- append JSONL candidate
- run dogfood eval
- summarize evidence
- offer repair handoff / same-chat fix / stop

## Entry from cxs self-review

The `cxs` skill is the companion discovery layer for this skill. It may finish a lookup by saying this looks like a dogfood candidate and suggesting:

```text
$cxs-dogfood 记录这个 case
```

If the user confirms with that phrase, or with a short equivalent such as `记录`, `加进去`, or `对，记录这个 case`, treat it as an explicit trigger for this skill.

Use the cxs self-review handoff as your starting evidence:

- original query / user ask
- observed command and flags
- actual top result or competing wrong result
- expected session/cwd/title/snippet if mentioned
- symptom class: `recall-miss`, `ranking-wrong`, `context-wrong`, `selector-coverage`, or `skill-guidance`

Do not ask the user to restate fields that are already present in the handoff. Ask only for the first missing essential that blocks an evidence-backed candidate.

## Repair handoff workflow

At the end of every successful capture or promotion attempt, explicitly offer one of these next steps:

```text
已记录为 <case_id>。要不要现在启动修复？
- 说「直接修」：我在当前对话按 dogfood failure 修。
- 说「给 handoff」：我输出一段可复制给新 agent 的修复 handoff。
- 不处理：保留 candidate，之后再说 case id 即可。
```

Do not start code changes just because a candidate failed. Start fixing only when the user explicitly says to fix now.

When the user asks for a handoff, output a compact block that another agent can use without re-asking basics:

```text
## cxs dogfood repair handoff

Repo: /Users/envvar/work/repos/cxs
Case: <id> (<status>)
Symptom: <recall-miss|ranking-wrong|context-wrong|selector-coverage|skill-guidance>
Original ask/query: <verbatim or derived query>
Eval command: npm run eval:dogfood -- data/cxs-dogfood/goldens.local.jsonl
Focused repro (in-dev CLI from repo checkout):
- npm run cxs -- find "<query>" --limit 10 --json
- npm run cxs -- read-range/read-page ...
Expected: <session uuid/cwd/mustContain>
Actual: <top result / competing result / failure message>
Likely layer to check first: <coverage|skill guidance|CLI recall|ranking|context>
Rules:
- do not edit private golden to hide failure
- do not hardcode this id/query/session
- do not add new entities unless multiple cases require it
- run npm run check and dogfood eval before claiming fixed
```

If the user says to fix in the same chat, switch to the repo workflow:

1. Work in `/Users/envvar/work/repos/cxs`.
2. Use Mainline if available/required by the repo.
3. Run the dogfood eval first.
4. Reproduce the specific case with the in-development CLI (`npm run cxs --`).
5. Classify the layer before editing.
6. Apply the smallest general fix.
7. Verify with `npm run check` and dogfood eval.

## Hard boundaries

- Only run this workflow after an explicit user trigger such as `$cxs-dogfood`, `把这次加入 dogfood`, `记录这个 cxs golden`, `记录这个 case`, or `promote dogfood golden`.
- Normal coding agents may run existing dogfood gates, but must not add new golden cases unless this skill was explicitly triggered.
- New cases default to `status: "candidate"`.
- Promote to `status: "hard"` only when the user explicitly asks to promote that case.
- Store private examples in ignored local data, normally `/Users/envvar/work/repos/cxs/data/cxs-dogfood/goldens.local.jsonl`.
- Never commit private dogfood examples. Never place them in `skill-packages/cxs` or repo-local `.agents/skills`.
- Do not add a dogfood case for an agent mistake if the underlying cxs CLI behaved correctly; record it as a skill-guidance note or ask whether the user wants a skill/doc fix instead.

## Add candidate workflow

1. Work from the cxs repo:

   ```bash
   cd /Users/envvar/work/repos/cxs
   ```

2. Capture the real issue from the conversation first.
   - Prefer the user's exact wording from the current request.
   - If rewriting for searchability, keep it evidence-backed and note the original wording in `origin.note`.
   - Capture the symptom class in `origin.note`: `recall-miss`, `ranking-wrong`, `context-wrong`, `selector-coverage`, or `skill-guidance`.
   - Do not invent synthetic user intent and call it dogfood.
   - Do not require the user to provide `query`, `expected session`, or `mustContain` up front if they are already inferable from the thread.

3. Reproduce with the current development CLI:

   ```bash
   npm run cxs -- status --json
   npm run cxs -- find "<query>" --limit 10 --json
   npm run cxs -- read-range <session_uuid> --seq <seq> --before 2 --after 2 --json
   # or, for session-only hits:
   npm run cxs -- read-page <session_uuid> --offset 0 --limit 20 --json
   ```

   If the real observed workflow involved a selector, sort mode, alternate query attempt, or self-hit exclusion, capture those fields in the golden instead of flattening the case into one oversimplified query.

4. Build the golden from observed evidence only.
   - `acceptableSessionUuids` must come from actual `find` / `list` / `read-*` output.
   - `mustContain` phrases must be copied from actual `read-range` or `read-page` output, not from an agent summary.
   - Include the top competing wrong result in `origin.note` when the symptom is ranking-related.
   - `matchSource` should be set when the case is meant to cover `message` vs `session` behavior.
   - `origin.kind` should be `observed-user-ask` when the user really asked that query, `evidence-backed-derived` when derived from a real ask, or `manual` for a maintainer-curated case.

5. Append one JSON object per line to:

   ```text
   data/cxs-dogfood/goldens.local.jsonl
   ```

   Candidate template:

   ```json
   {"id":"short-stable-id","query":"user query","intent":"what this must recover","status":"candidate","origin":{"kind":"observed-user-ask","note":"verbatim user wording, symptom class, command/version, and source pointer"},"expected":{"topK":5,"acceptableSessionUuids":["019d..."],"cwdContains":"/Users/envvar/work/repos/...","matchSource":"message","context":{"mode":"auto","mustContain":["exact phrase from read output"]}}}
   ```

6. Verify immediately:

   ```bash
   npm run eval:dogfood -- data/cxs-dogfood/goldens.local.jsonl
   ```

   Candidate failures are reported but should not block normal development. Hard failures are blocking.

## Promote hard workflow

Only run when the user explicitly asks to promote a specific case.

1. Re-run dogfood eval for the local golden file.
2. Re-read the target context and confirm `mustContain` phrases still come from real output.
3. Change only that case from `"candidate"` to `"hard"`.
4. Re-run:

   ```bash
   npm run eval:dogfood -- data/cxs-dogfood/goldens.local.jsonl
   ```

5. Report the case id, selected session, context mode, and final pass/fail.

## Failure handling

- `hard` fail: retrieval change is not complete until explained, fixed, or the case is explicitly marked `stale` by the user.
- `candidate` fail: report and leave as candidate unless the user asks to remove or edit it.
- `stale`: keep for provenance but do not treat as blocking.
