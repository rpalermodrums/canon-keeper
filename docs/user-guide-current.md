# CanonKeeper User Guide (Current Behavior)

Tested build: local dev app on `2026-02-07` with `CANONKEEPER_LLM_API_KEY` configured and fixtures including `data/fixtures/novel_length_fixture.md`.

## What CanonKeeper Does

CanonKeeper is a local-first continuity workstation for manuscript analysis. It:

- ingests `.md`, `.txt`, and `.docx` files into deterministic chunks
- builds an evidence-backed scene index
- tracks style diagnostics (repetition, tone drift, dialogue tics)
- tracks continuity/issues as evidence-backed questions
- lets you confirm canon claims without rewriting manuscript prose
- exports bible/scenes/style/project data

It does **not** rewrite your manuscript.

## Recommended Workflow

1. Open the app — if no project is open, you'll be directed to **Setup** automatically.
2. Create/open a project root in **Setup**.
3. Add source files with **Add document**.
4. Wait for worker status to return to **Idle**.
5. Run **Diagnostics** (Setup or Settings) and confirm all checks pass.
6. Review **Home** for project stats, document progress, and evidence health.
7. Review **Scenes** for structure + metadata + evidence.
8. Review **Issues** and triage with dismiss/undo/resolve. Use sort and filter controls to prioritize.
9. Review **Style** for repetition, tone drift, dialogue habits.
10. Use **Characters & World** to inspect claims and confirm facts.
11. Use **Search** for direct snippet retrieval.
12. Use **Ask** for cited answers; verify citations.
13. Use **Exports** to generate Markdown/JSON.

## Feature-by-Feature Guide

## Setup

- Use a dedicated project folder (recommended: empty folder per manuscript/project).
- Add documents one by one if you want easier troubleshooting.
- For long-form text, keep clear headings/scene markers where possible for better scene segmentation.
- The app automatically routes new users to Setup when no project is open.
- Setup has a 3-step guided flow: open project folder, add manuscripts, run diagnostics.

## Home

- Shows project stats: total passages, documents, scenes, and open issues.
- **Document Progress** section shows per-document pipeline status with a mini timeline of 5 stages (Ingesting, Finding scenes, Analyzing style, Extracting details, Checking continuity) with color-coded status indicators.
- **Evidence Backing** card shows what percentage of issues and scenes are backed by evidence (green >80%, yellow >50%, red <50%).
- **Continue Where You Left Off** shortcuts resume your last issue, entity, or scene review.
- **Notices** section (collapsible) shows warnings like moved/deleted manuscript files with friendly language and recovery notes.

## Scenes

- Scene list supports quick scanning of scene title, POV, and setting fields.
- Open a scene to view metadata plus evidence citations.
- Evidence modal shows quoted span and location context.

## Issues

- Issue types: continuity, repetition, tone drift, dialogue tics, contradiction, timeline issue, character inconsistency, setting inconsistency.
- Each issue is evidence-backed via quote spans.
- **Dismiss** requires a reason; undo re-opens the issue via toast action.
- **Resolve** marks an issue as resolved with an undo toast to reverse it.
- Resolved and dismissed issues are preserved when the pipeline re-runs — user decisions are never lost.
- **Sort controls**: Newest (default), Severity (high > medium > low), or Type grouping.
- **Filters**: status (open/dismissed/resolved/all), severity, type (including "Style only" quick filter), and text search.
- **View Scene** button on issue cards navigates directly to the related scene for context.

## Style

- Style view provides diagnostic outputs only (no rewrites).
- Repetition entries show detected phrases with occurrence counts and evidence.
- Tone drift entries show drift scores with evidence.
- Dialogue habits are tracked per character where attribution exists.
- **View Scene** button on style issues navigates to the related scene.

## Characters & World (Bible)

- Entity list shows extracted character/world entities.
- Entity detail shows claim groups by field with supporting evidence.
- **Confirm** promotes a claim to canon and preserves evidence.

## Search

- Use for literal/snippet retrieval from ingested text.
- Handles natural language queries by filtering stopwords and punctuation for better FTS matches.
- Falls back to broader OR-based search when strict AND matching returns no results.

## Ask

- Returns cited snippets with evidence from the manuscript.
- Extracts key terms from questions (strips stopwords, question prefixes) for more targeted search.
- Falls back to broader search strategies when initial query returns no results.

## Exports

- Select output directory.
- Run export as:
  - Markdown (`bible.md`, `scenes.md`, `style_report.md`)
  - JSON (`project.json`)
- Verify export files exist in the selected directory.

## Settings

- Run diagnostics to validate app/worker/storage/IPC health.
- **Processing Queue** section shows pending and retrying jobs with cancel support for queued items.
- Use diagnostics before and after long ingest runs.

## Effective Use Tips

- Keep canon-critical facts explicit in text near stable names to improve evidence mapping.
- Confirm key canon facts early (e.g., appearance, relationships, locations).
- Use the sort-by-severity option to focus on high-impact issues first.
- Click "View Scene" on issue cards to see the full scene context around a problem.
- Check the Evidence Backing card on Home to gauge how well your manuscript is indexed.
- Treat issues as a review queue; close only after explicit resolution.
- Use Search for exact evidence retrieval; Ask works well for natural language questions.
- Export regularly to keep portable snapshots of current state.

## Previously Known Issues — All Resolved

1. ~~Issue resolve lifecycle bug~~: **Fixed** — resolve now has undo toast, resolved issues remain visible under the "Resolved" filter, and user decisions survive pipeline re-runs.
2. ~~Ask known-question failure~~: **Fixed** — stopword filtering, punctuation stripping, and OR fallback ensure natural language questions find relevant evidence.
3. ~~Repetition bug~~: **Fixed** — repetition issues now correctly display phrase text and occurrence counts with validation guards.
4. ~~Home status metric mismatch~~: **Fixed** — dashboard now shows accurate cumulative project stats via dedicated `project.stats` endpoint.
5. ~~Event log file_missing warning~~: **Fixed** — friendly "Notices" section in dashboard explains moved/deleted files with recovery guidance.
