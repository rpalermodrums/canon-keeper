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

1. ~~Fix issue resolve state model and UI filtering.~~ **RESOLVED (2026-02-07)**
- Problem: resolving a continuity issue removed it from visible state rather than showing it as resolved.
- Recommendation: keep resolved records queryable in DB and UI; ensure filters return open/dismissed/resolved deterministically.
- Success metric: lifecycle test passes with visible status transitions `open -> dismissed -> open -> resolved`.
- **Fix**: Added `undoResolveIssue` backend + RPC + preload + frontend. Resolve now shows undo toast (matching dismiss pattern). `clearIssuesByType` now preserves resolved/dismissed issues so user decisions survive reprocessing. 8 files changed, 6 tests added/updated.

2. ~~Fix Ask known-answer retrieval fallback path.~~ **RESOLVED (2026-02-07)**
- Problem: known questions returned `Not Found` while Search found relevant evidence.
- Recommendation: route Ask through deterministic retrieval-first flow, then compose answer from retrieved chunks, then optional LLM post-processing.
- Success metric: contradiction fixture questions return either cited answer or cited snippets.
- **Fix**: Added stopword filtering (~40 words) and punctuation stripping to FTS sanitization. Added OR-based fallback when AND query returns no results. `askQuestion` now extracts key terms before searching. 3 files changed, 4 tests added.

3. ~~Fix repetition issue generation pipeline for undefined values.~~ **RESOLVED (2026-02-07)**
- Problem: repetition cards displayed `"undefined"` phrase/count.
- Recommendation: hard-validate repetition payload before issue creation; skip invalid candidates and log structured warnings.
- Success metric: zero `undefined` repetition titles/descriptions over fixture suite.
- **Fix**: Fixed `buildRepetitionMetricFromCounts` to take `ngram`/`count` from parent entry (not the example object which lacked them). Added validation guard in styleRunner — skips invalid issues and logs structured warnings. 3 files changed, 2 tests added.

## P1: Workflow Clarity

1. ~~Add ingest/processing timeline per document.~~ **RESOLVED (2026-02-07)**
- Show stage-by-stage status: ingest, scenes, style, extraction, continuity.
- Include start/end times and last successful run.
- **Fix**: Replaced stage-grouped "Recent Activity" with per-document "Document Progress" cards. Each document shows a mini horizontal timeline of 5 pipeline stages with color-coded status dots and inline errors. Writer-friendly stage labels.

2. ~~Add explicit "Evidence coverage" health indicator.~~ **RESOLVED (2026-02-07)**
- Show percent of surfaced claims/issues/scenes backed by visible evidence.
- Warn when a view includes hidden low-confidence records.
- **Fix**: Added full-stack `project.evidenceCoverage` RPC endpoint. Dashboard "Evidence Backing" card shows coverage percentage for issues and scenes with color coding (green >80%, yellow >50%, red <50%). New storage functions, IPC bridge, and state management.

3. ~~Improve onboarding for first project creation.~~ **RESOLVED (2026-02-07)**
- Add guided flow: pick project folder, add docs, run diagnostics, open first review queue.
- Include recommended first actions for canon confirmation.
- **Fix**: Added auto-routing to Setup view when no project is open on initial load. The existing 3-step wizard (open folder, add docs, run diagnostics) now surfaces automatically for new users.

4. ~~Add issue triage defaults tuned for editorial workflows.~~ **RESOLVED (2026-02-07)**
- Default sort by severity + recency.
- Add quick filters: "Needs decision", "Has conflicting evidence", "Style only".
- **Fix**: Added sort dropdown with Newest/Severity/Type options. Added "Style only" quick filter for repetition + tone_drift + dialogue_tic. Client-side sorting by severity weight (high > medium > low) + recency.

## P2: Long-Form Safety + Performance Controls

1. Add LLM budget controls for large manuscripts.
- Surface max chunks per request, token budget, retries, and timeout.
- Show when extraction is deterministic-only vs LLM-assisted.

2. Add incremental extraction inspector.
- Show exactly which chunk ranges were reprocessed after each file change.
- Helps verify that whole-manuscript LLM calls are not happening.

3. ~~Add queue visibility and cancellation.~~ **RESOLVED (2026-02-07)**
- Show pending/running jobs with document scope.
- Allow cancelling stale or oversized jobs.
- **Fix**: Added full-stack queue visibility: `jobs.list` and `jobs.cancel` RPC endpoints, IPC bridge, and "Processing Queue" section in Settings view with writer-friendly job type labels, status display, and cancel button for queued jobs.

## P3: Quality-of-Life Improvements

1. ~~Cross-link issue cards to scene/entity context with one click.~~ **RESOLVED (2026-02-07)**
- **Fix**: Added `getSceneIdsForChunkIds` storage function to resolve chunks to their containing scenes. Enriched `listIssuesWithEvidence` to include `sceneId` on each evidence item. Added "View Scene" button on issue cards in both IssuesView and StyleView that navigates directly to the related scene. 7 files changed.
2. Add batch export presets (editorial review package vs full raw dump).
3. Add "pin canonical facts" panel for high-value claims confirmed by writer.

## Concrete Errors/Issues Encountered in This Run

1. ~~`api/ui`: issue resolve did not preserve visible resolved state.~~ **RESOLVED** — undoResolve + undo toast + clearIssuesByType preserves user decisions.
2. ~~`pipeline/api`: Ask returned `Not Found` for known facts.~~ **RESOLVED** — stopword filtering + punctuation stripping + OR fallback in FTS.
3. ~~`pipeline`: repetition pipeline produced `"undefined"` issue payloads.~~ **RESOLVED** — fixed ngram/count sourcing in buildRepetitionMetricFromCounts + validation guard.
4. ~~`ui`: Home passage-count status appeared inaccurate.~~ **RESOLVED** — added `project.stats` RPC endpoint with total passages/documents/scenes/issues; dashboard now shows cumulative stats.
5. ~~`infra`: stale local dev process held port `5173`; required cleanup and restart.~~ **RESOLVED** — added `strictPort: true` to Vite config + `predev:local` port check script with clear error message.
6. ~~`data`: one `event_log` warning for `file_missing` on a temp-path document.~~ **RESOLVED** — added collapsible "Notices" section in dashboard with friendly language for file_missing events ("A manuscript file was moved or deleted") and auto-recovery note.

## Suggested Next Validation Pass

1. Re-run full journey after P0 fixes only.
2. Gate release on passing lifecycle + Ask-known assertions.
3. Keep novel-length fixture in the default regression suite with strict evidence checks.
