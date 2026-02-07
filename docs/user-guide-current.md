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

1. Open **Setup** and create/open a project root.
2. Add source files with **Add document**.
3. Wait for worker status to return to **Idle**.
4. Run **Diagnostics** (Setup or Settings) and confirm all checks pass.
5. Review **Scenes** for structure + metadata + evidence.
6. Review **Issues** and triage with dismiss/undo/resolve.
7. Review **Style** for repetition, tone drift, dialogue habits.
8. Use **Characters & World** to inspect claims and confirm facts.
9. Use **Search** for direct snippet retrieval.
10. Use **Ask** for cited answers; verify citations.
11. Use **Exports** to generate Markdown/JSON.

## Feature-by-Feature Guide

## Setup

- Use a dedicated project folder (recommended: empty folder per manuscript/project).
- Add documents one by one if you want easier troubleshooting.
- For long-form text, keep clear headings/scene markers where possible for better scene segmentation.

## Home

- Shows project status, processing state, and health signals.
- Use it as a quick check after edits/ingest.

Note: in this build, “Last processed” can underreport work done (for example, showing `Processed 1 passages` after a large ingest).

## Scenes

- Scene list supports quick scanning of scene title, POV, and setting fields.
- Open a scene to view metadata plus evidence citations.
- Evidence modal shows quoted span and location context.

## Issues

- Issue types currently observed: continuity, repetition, tone drift, dialogue tics.
- Each issue should be evidence-backed via quote spans.
- Dismiss requires a reason; undo re-opens the issue.

Important current behavior: resolve flow appears inconsistent (resolved issues may disappear instead of appearing in the resolved filter; see Known Issues).

## Style

- Style view provides diagnostic outputs only (no rewrites).
- Repetition and tone drift entries link to evidence.
- Dialogue habits are tracked per character where attribution exists.

## Characters & World (Bible)

- Entity list shows extracted character/world entities.
- Entity detail shows claim groups by field with supporting evidence.
- **Confirm** promotes a claim to canon and should preserve evidence.

Observed working flow: confirming Lina’s `eye_color="green"` persisted as `confirmed` and retained evidence.

## Search

- Use for literal/snippet retrieval from ingested text.
- Works well for terms/tokens (`candlelight` returned matches in this run).

## Ask

- Intended behavior: return `answer`/snippets with citations or `not_found`.
- Current tested behavior: known factual questions sometimes return `Not Found` even when searchable evidence exists.

Treat Ask as conservative until retrieval wiring improves.

## Exports

- Select output directory.
- Run export as:
  - Markdown (`bible.md`, `scenes.md`, `style_report.md`)
  - JSON (`project.json`)
- Verify export files exist in the selected directory.

## Settings

- Run diagnostics to validate app/worker/storage/IPC health.
- Use this before and after long ingest runs.

## Effective Use Tips

- Keep canon-critical facts explicit in text near stable names to improve evidence mapping.
- Confirm key canon facts early (e.g., appearance, relationships, locations).
- Treat issues as a review queue; close only after explicit resolution.
- Prefer Search for exact evidence retrieval when Ask is uncertain.
- Export regularly to keep portable snapshots of current state.

## Known Issues from This Full-Journey Run

1. **Issue resolve lifecycle bug**: resolved issues were not visible under resolved state and continuity disappeared from filters after resolve.
2. **Ask known-question failure**: known questions returned `Not Found` despite searchable supporting snippets.
3. **Repetition bug**: repetition issues rendered `"undefined"` phrase and count.
4. **Home status metric mismatch**: passage count appears inaccurate after large ingest.
5. **One warning in event log**: `file_missing` for a stale temp path (`/tmp/.../simple_md.md`).
