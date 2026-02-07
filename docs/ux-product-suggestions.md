# CanonKeeper UX + Product Suggestions (Based on Full Journey Test)

Run context: local full-journey test on `2026-02-07` using all required fixtures, including `data/fixtures/novel_length_fixture.md`, with LLM key configured.

## Observed Friction Points

1. Issue lifecycle state is confusing/inconsistent after resolve.
2. Ask can fail for known answers that are retrievable via Search.
3. Repetition issues can render invalid values (`"undefined"`).
4. Home dashboard processing summary is not trustworthy for large runs.
5. Long-form processing is powerful, but progress transparency is limited.

## Priority Recommendations

## P0: Correctness + Trust

1. Fix issue resolve state model and UI filtering.
- Problem: resolving a continuity issue removed it from visible state rather than showing it as resolved.
- Recommendation: keep resolved records queryable in DB and UI; ensure filters return open/dismissed/resolved deterministically.
- Success metric: lifecycle test passes with visible status transitions `open -> dismissed -> open -> resolved`.

2. Fix Ask known-answer retrieval fallback path.
- Problem: known questions returned `Not Found` while Search found relevant evidence.
- Recommendation: route Ask through deterministic retrieval-first flow, then compose answer from retrieved chunks, then optional LLM post-processing.
- Success metric: contradiction fixture questions return either cited answer or cited snippets.

3. Fix repetition issue generation pipeline for undefined values.
- Problem: repetition cards displayed `"undefined"` phrase/count.
- Recommendation: hard-validate repetition payload before issue creation; skip invalid candidates and log structured warnings.
- Success metric: zero `undefined` repetition titles/descriptions over fixture suite.

## P1: Workflow Clarity

1. Add ingest/processing timeline per document.
- Show stage-by-stage status: ingest, scenes, style, extraction, continuity.
- Include start/end times and last successful run.

2. Add explicit “Evidence coverage” health indicator.
- Show percent of surfaced claims/issues/scenes backed by visible evidence.
- Warn when a view includes hidden low-confidence records.

3. Improve onboarding for first project creation.
- Add guided flow: pick project folder, add docs, run diagnostics, open first review queue.
- Include recommended first actions for canon confirmation.

4. Add issue triage defaults tuned for editorial workflows.
- Default sort by severity + recency.
- Add quick filters: “Needs decision”, “Has conflicting evidence”, “Style only”.

## P2: Long-Form Safety + Performance Controls

1. Add LLM budget controls for large manuscripts.
- Surface max chunks per request, token budget, retries, and timeout.
- Show when extraction is deterministic-only vs LLM-assisted.

2. Add incremental extraction inspector.
- Show exactly which chunk ranges were reprocessed after each file change.
- Helps verify that whole-manuscript LLM calls are not happening.

3. Add queue visibility and cancellation.
- Show pending/running jobs with document scope.
- Allow cancelling stale or oversized jobs.

## P3: Quality-of-Life Improvements

1. Cross-link issue cards to scene/entity context with one click.
2. Add batch export presets (editorial review package vs full raw dump).
3. Add “pin canonical facts” panel for high-value claims confirmed by writer.

## Concrete Errors/Issues Encountered in This Run

1. `api/ui`: issue resolve did not preserve visible resolved state.
2. `pipeline/api`: Ask returned `Not Found` for known facts.
3. `pipeline`: repetition pipeline produced `"undefined"` issue payloads.
4. `ui`: Home passage-count status appeared inaccurate.
5. `infra`: stale local dev process held port `5173`; required cleanup and restart.
6. `data`: one `event_log` warning for `file_missing` on a temp-path document.

## Suggested Next Validation Pass

1. Re-run full journey after P0 fixes only.
2. Gate release on passing lifecycle + Ask-known assertions.
3. Keep novel-length fixture in the default regression suite with strict evidence checks.
