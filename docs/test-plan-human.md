# CanonKeeper Human Test Plan (Detailed)

## 1. Purpose
This plan is for manual validation of CanonKeeper end-to-end behavior with emphasis on:
- local-first operation
- evidence-first outputs
- continuity + style diagnostics
- canon confirmation workflows
- export correctness
- UI usability and recovery paths

This plan uses realistic long-form input and should be executed before release candidates.

## 2. Test Scope
### In scope
- Electron app startup and setup flow
- Project creation/opening
- Adding manuscripts (`.md`, `.txt`, `.docx`)
- Incremental reprocessing on file changes
- Scene indexing and scene detail evidence
- Style report (repetition, tone drift, dialogue tics)
- Characters & World entities/details/evidence and confirm detail actions
- Issues lifecycle (open, dismiss with reason, undo dismiss, resolve)
- Ask behavior (answer/snippets/not_found)
- Export behavior (`md`, `json`)
- Runtime diagnostics and status reporting

### Out of scope
- Cloud sync/collaboration
- Non-local storage backends
- Authoring assistance / rewriting (must not exist)

## 3. Required Test Data
Use these fixtures:
- `data/fixtures/simple_md.md`
- `data/fixtures/contradiction.md`
- `data/fixtures/pov_switch.md`
- `data/fixtures/tone_shift.md`
- `data/fixtures/novel_length_fixture.md`

Optional: add one user-provided `.docx` sample for parser sanity.

## 4. Environment Prerequisites
- Node 25 installed
- Bun installed
- Dependencies installed (`bun install`)
- Electron app starts via `bun run dev:local`
- Writable filesystem for project roots

If SQLite native mismatch appears:
- run `bun install` (or `npm rebuild better-sqlite3`), then retry.

## 5. Test Run Artifacts
Create a run folder, e.g. `output/manual-test-YYYYMMDD-HHMM/`, and capture:
- screenshots of each major view
- copied error messages (if any)
- exported files (`bible.md`, `scenes.md`, `style_report.md`, `project.json`)
- concise notes for each failed assertion

## 6. Execution Steps

### 6.1 Startup + Diagnostics
1. Launch app with `bun run dev:local`.
2. Open **Setup** view.
3. Click **Run Diagnostics**.

Expected:
- Runtime shows worker ready
- Diagnostics section shows IPC/Worker/SQLite/Writable healthy
- No preload/IPC missing error shown in UI

### 6.2 Project Open/Create
1. Click **Browse** for project root.
2. Choose a clean temp directory (not repository root).
3. Click **Create/Open Project**.

Expected:
- Success toast appears
- Top bar shows active project path
- Home view shows Activity card

### 6.3 Ingest Single Fixture
1. In Setup, choose `data/fixtures/contradiction.md`.
2. Click **Add Document**.
3. Wait for status to return idle.

Expected:
- Last processing stats populated
- Processing stages reach `ok`
- Scenes/Style/Issues/Characters & World show data

### 6.4 Scene Verification
1. Go to **Scenes**.
2. Refresh scenes.
3. Select several scenes.

Expected:
- Stable scene ordering by ordinal
- POV/setting columns populated or `unknown`
- Scene detail evidence exists where metadata is classified
- Evidence drawer shows quote excerpt + passage/document location

### 6.5 Style Verification
1. Go to **Style**.
2. Refresh report.
3. Inspect repetition, tone drift, dialogue tic sections.

Expected:
- Repetition metrics present with evidence-backed items
- Tone drift issues visible for tone-shift content
- Dialogue tic issues surfaced with evidence spans
- No rewrite suggestions generated

### 6.6 Characters & World + Confirmation Flow
1. Go to **Characters & World**.
2. Select an entity with detected details.
3. Open evidence for a detail.
4. Confirm detail via modal.

Expected:
- Confirm action succeeds
- Detail status reflects confirmation
- Evidence remains attached (evidence-first guarantee)
- Continuity checks may generate/update issues on conflict

### 6.7 Issue Lifecycle
1. Go to **Issues**.
2. Dismiss one open issue with a reason.
3. Use toast **Undo**.
4. Resolve one issue.

Expected:
- Dismissed issue leaves open list and appears in dismissed filter
- Undo returns issue to open
- Resolved issue appears in resolved filter
- Evidence remains viewable for each issue state

### 6.8 Ask Workflow
1. Go to **Search**.
2. Ask a known-answer question from ingested text.
3. Ask an unknown question.

Expected:
- Known question returns `answer` or `snippets` with citations/snippets
- Unknown question returns `not_found` without hallucinated prose

### 6.9 Export Validation
1. Go to **Exports**.
2. Pick output directory.
3. Run `md` export, then `json` export.

Expected:
- Export success with file list and elapsed time
- Markdown files include citations/evidence references
- JSON dump includes consistent entities/scenes/issues/claims rows

### 6.10 Incremental Reprocessing
1. Edit ingested fixture text (small change in one scene).
2. Save file.
3. Wait for processing completion.

Expected:
- Debounced reprocessing triggers automatically
- Recent Activity shows processing then returns to idle
- Only impacted ranges/scenes appear updated
- No full reset of unrelated entities/issues

### 6.11 Long-Form Stress Pass
1. Add `data/fixtures/novel_length_fixture.md`.
2. Wait for pipeline idle.
3. Visit Home, Scenes, Style, Characters & World, Issues, Search.

Expected:
- App remains responsive
- Scene list remains navigable
- Style/continuity outputs remain evidence-backed
- Ask remains grounded and does not degrade into fabricated answers

## 7. Evidence-First Audit Checklist
For 10 random details/issues/scenes:
- Verify at least one quote span exists.
- Verify quote text is present in passage excerpt.
- Verify location metadata (document path + passage ordinal) is present.

Mark each item `Pass/Fail`.

## 8. Regression Checklist
- No `IPC not available` errors after startup
- No preload parse errors in console
- Status pill does not stick at `busy (project.subscribeStatus)` when idle
- Diagnostics do not show `require is not defined` for SQLite
- Project open does not fail with missing `job_queue`

## 9. Failure Triage Template
When filing a defect, include:
- Environment (OS, Node, Bun, commit SHA)
- Fixture path(s)
- Exact steps
- Expected vs actual
- Screenshot(s)
- Relevant console/log snippets
- Severity (`blocker/high/medium/low`)

## 10. Exit Criteria
Release candidate is acceptable when:
- All critical-path sections (6.1–6.11) pass
- Evidence-first audit has zero failures
- No blocker/high defects remain open
- Exports and Ask behavior are verified on long-form fixture
