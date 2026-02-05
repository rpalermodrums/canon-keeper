```md
# AGENTS.md — CanonKeeper (Codex build guide)

This file is instructions for an agentic code generation tool to create the CanonKeeper MVP.

CanonKeeper is a **local-first, evidence-first** companion app that runs in the background and maintains:
- **Book Bible** (entities + claims + evidence)
- **Scene Index** (scene boundaries + POV + setting, evidence-backed)
- **Style/Voice Guide** (repetition, tone drift, dialogue tics; diagnostic only)
- **Continuity Issues** (contradictions framed as questions with evidence)
- **Ask-the-bible** Q&A (grounded, cited; fallback without LLM)

## Non-negotiable constraints

1. **Never edit user manuscripts.** Read-only ingestion only.
2. **No ghostwriting.** Do not generate scenes, rewrite prose, or suggest replacement text. Style features are diagnostic.
3. **Evidence-first.** Any claim/issue/POV/setting/tone-drift output must include at least one exact quote span in the manuscript text.
4. **Writer-confirmed canon wins.** Confirmed claims must never be overwritten by inferred claims. Conflicts become issues.
5. **Incremental processing.** On file change, reprocess only the impacted ranges/scenes whenever possible.

If a feature cannot satisfy evidence-first (exact quote mapping), it must be:
- stored as low-confidence/inferred-without-quote, and
- hidden by default in the UI.

---

## Product shape (MVP implementation choice)

Build a **standalone desktop app**:
- Electron + TypeScript
- React renderer UI
- Background worker process for ingestion/pipeline
- SQLite persistence (+ FTS5)
- Optional pluggable LLM provider; must work with `NullProvider` (no LLM)

**Do not** implement an OS-level “capture what I type” agent. Only watch configured files.

---

## Repository layout (required)

Create a monorepo with this structure:

```

canonkeeper/
package.json
pnpm-workspace.yaml
apps/
desktop/
electron/
main.ts
preload.ts
worker/
worker.ts
jobs/
storage/
pipeline/
llm/
search/
export/
utils/
renderer/
index.html
src/
App.tsx
api/
views/
components/
state/
packages/
shared/
types/
persisted.ts
schemas/
extraction.schema.json
scene_extract.schema.json
qa_answer.schema.json
utils/
normalize.ts
hashing.ts
migrations/
001_init.sql
002_fts.sql
003_event_log.sql
data/
fixtures/
simple_md.md
contradiction.md
pov_switch.md
tone_shift.md
README.md
AGENTS.md

```

---

## Tooling and dependencies (pick these explicitly)

Use:
- Package manager: **pnpm**
- Node: **>= 20**
- TypeScript: latest stable
- Lint/format: ESLint + Prettier
- Tests: Vitest
- SQLite driver: **better-sqlite3**
- JSON schema validation: **Ajv** (draft 2020-12)
- File watching: chokidar
- Markdown parsing: remark (or minimal parser + headings)
- DOCX extraction: mammoth
- UI: React + minimal component styling (no heavy UI framework required)

---

## Core domain primitives (must implement)

### 1) Chunk
A chunk is the unit of:
- evidence citations
- incremental reprocessing
- search indexing

Chunks must be deterministic given the same document text.

### 2) Scene
A scene is a range of chunks (start/end). Scenes hold:
- POV mode + POV character (optional)
- setting location entity (optional) or setting text (fallback)
- evidence quotes for any non-unknown classification

### 3) Entity + Claim + Evidence
- Entities: character, location, org, artifact, term, rule
- Claims: `(entity_id, field, value_json, status, confidence)`
- Evidence: `(claim_id, chunk_id, quote_start, quote_end)` exact substring span

### 4) Issue
Issues are evidence-backed flags:
- continuity conflict
- POV ambiguous (optional)
- tone drift
- repetition
- dialogue tic

---

## Data model and migrations (required)

Implement the SQLite schema from the technical spec:
- project, document, document_snapshot, chunk, entity, entity_alias, claim, claim_evidence
- scene, scene_metadata, scene_entity
- issue, issue_evidence
- style_metric
- event_log
- FTS5 virtual table chunk_fts and triggers or app-level sync

**Requirement**: Include a migration runner:
- On startup (worker), apply migrations in order.
- Store applied migrations in a `schema_migrations` table.

---

## Execution model (process separation)

- Renderer UI must remain responsive.
- All ingestion/pipeline/SQLite work happens in the worker process.
- Electron main process provides IPC endpoints and forwards to worker.

### IPC contract (minimum)
Expose these methods to the renderer:
- `project.createOrOpen(rootPath: string): ProjectSummary`
- `project.addDocument(path: string): void`
- `project.getStatus(): WorkerStatus`
- `bible.listEntities(filters?): EntitySummary[]`
- `bible.getEntity(entityId): EntityDetail` (includes claims + evidence)
- `canon.confirmClaim(entityId, field, valueJson): void`
- `scenes.list(filters?): SceneSummary[]`
- `scenes.get(sceneId): SceneDetail` (includes evidence)
- `issues.list(filters?): IssueSummary[]`
- `issues.dismiss(issueId): void`
- `style.getReport(scope?): StyleReport`
- `search.ask(question: string): AskResult`
- `export.run(kind: 'md'|'json', outDir: string): ExportResult`

---

## LLM integration (must be optional)

Implement `LLMProvider` interface with:
- `NullProvider` (always unavailable; used when no LLM is configured)
- A generic `CloudProvider` stub that reads a base URL + API key from settings (do not hardcode vendor assumptions)

### Mandatory safeguards
- All LLM outputs must be:
  - validated with Ajv against the JSON schema
  - rejected and retried (max 2 retries) if invalid
- Evidence quotes returned by LLM must be mapped back into exact chunk spans:
  - if quote string not found verbatim, attempt basic fuzzy match
  - if still not found, do not surface the claim/issue by default

---

## Deterministic-first build order (IMPORTANT)

Prioritize deterministic pipeline pieces first. The MVP must still function without LLM.

### Phase 1: Project + storage + ingestion
- Create project, register documents, watch files
- Parse doc (md/txt/docx) into full_text snapshot
- Deterministic chunking, persist chunks
- Populate chunk_fts

**Definition of done**
- Running `pnpm dev` opens app
- Adding a document ingests it into chunks and indexes search
- No UI crashes; worker logs show ingest events

### Phase 2: Scene boundaries (deterministic)
- Implement boundary detection via explicit markers + headings
- Build scenes and persist scene ranges
- Scene list view in UI

**Definition of done**
- Scenes exist for fixtures; ordinal ordering is stable across restarts

### Phase 3: Style/voice (deterministic)
- repetition: ngram frequencies + issue creation + evidence spans
- tone drift: compute per-scene tone vectors and drift scores, create issues
- dialogue extraction: detect dialogue blocks; heuristic speaker attribution; per-character tic metrics

**Definition of done**
- Style report renders in UI and links to evidence spans
- No rewrites are generated

### Phase 4: Extraction pipeline (LLM optional)
- Implement LLM provider plumbing + schema validation
- Implement extraction pipeline: entities/claims with evidence quotes
- Merge rules and alias normalization

**Definition of done**
- With NullProvider: app still works; bible may be sparse
- With LLM enabled: new entities + claims appear with evidence

### Phase 5: Continuity + Ask-the-bible
- Deterministic continuity checks on conflicting evidence-backed claims
- Ask flow:
  - Retrieval: FTS + optional embedding boosting
  - If LLM available: cited answer; else fallback to snippets

**Definition of done**
- Contradiction fixture produces continuity issue with two evidence quotes
- Ask returns cited answer when possible or not_found

### Phase 6: Canon overrides + exports
- Confirm claim flow: create confirmed claim, supersede inferred claims
- Export Markdown and JSON with citations

**Definition of done**
- Confirmed claims do not get overwritten; conflicts become issues
- Export files are generated and deterministic

---

## Code standards (enforced)

- TypeScript strict mode on.
- No `any` unless isolated in serialization layers.
- Always separate:
  - storage (SQL) layer
  - pipeline logic (pure-ish functions where possible)
  - UI rendering
- Log failures to `event_log` with non-sensitive payloads.
- Never log manuscript text by default.

---

## Evidence span mapping (core implementation detail)

You must implement utility functions:

- `findExactSpan(haystack: string, needle: string): {start,end} | null`
- `findFuzzySpan(haystack: string, needle: string): {start,end} | null`
  - basic fallback: normalize whitespace, retry; then simple windowed similarity

Rules:
- Evidence quote must map to a span in chunk.text.
- If mapping fails, store but mark hidden and do not surface.

---

## Testing requirements (must ship with MVP)

Add fixtures under `data/fixtures/` and write tests:

### Unit tests
- normalization
- chunking determinism
- evidence quote mapping
- repetition metrics correctness

### Integration tests
- ingest fixture → chunks persisted + FTS populated
- deterministic scenes created
- contradiction fixture produces continuity issue (deterministic check or LLM-assisted if configured)

**Command targets**
- `pnpm test` must pass
- `pnpm lint` must pass

---

## UI requirements (minimal, functional)

The UI can be barebones, but must include:

1. Dashboard: ingestion status, last run, errors
2. Bible: entity list, entity detail, claims grouped by field, evidence viewer, confirm button
3. Scenes: table list with POV/setting columns and filters
4. Issues: list + evidence viewer; dismiss/resolve
5. Style: repetition + tone drift + dialogue tics (per character)
6. Ask: question box + cited answer or snippet fallback

Evidence viewer must show:
- chunk text excerpt with highlighted span
- chunk/document location (document path + chunk ordinal)

---

## “Don’ts” (common failure modes)

- Don’t implement auto-writing or rewrite suggestions.
- Don’t surface claims without evidence.
- Don’t treat LLM output as truth without validation and span mapping.
- Don’t block the renderer with DB work.
- Don’t implement complex collaboration/cloud sync in MVP.

---

## Suggested initial scaffolding steps (for Codex)

1. Create monorepo skeleton + pnpm workspaces.
2. Add Electron app wiring (main/preload/renderer) and worker spawn.
3. Add SQLite layer + migration runner.
4. Implement document ingestion pipeline (parse → snapshot → chunk → FTS).
5. Add minimal UI to view chunk list/search results.
6. Add scenes + style + issues incrementally.

Keep every step runnable.

---

## Acceptance checklist (final MVP)

The project is acceptable when:

- ✅ Can create/open a project and add md/txt/docx documents
- ✅ File changes trigger debounced incremental ingest
- ✅ Chunks and FTS search work
- ✅ Scene index exists and displays per-scene metadata (unknown allowed)
- ✅ Style report displays repetition/tone/dialogue tics with evidence
- ✅ Bible displays entities/claims with evidence; confirmations work
- ✅ Continuity issues appear for contradictions (fixture)
- ✅ Ask returns cited answer or not_found without hallucination
- ✅ Exports produce Markdown + JSON with citations
- ✅ `pnpm test` and `pnpm lint` pass

---

## Notes on scope

The point of this project is to **empower** the writer by reducing continuity bookkeeping, not to replace authorship. If an implementation choice increases output generation at the cost of agency or trust, choose the trust-preserving option.

---

## Implementation notes (living)
- Dev workflow: Vite for renderer; Electron main runs via `tsx` in dev. Preload is compiled via `tsc --watch` to `apps/desktop/dist-electron/preload.js` so IPC works in dev.
- Tooling: ESLint + Prettier + Vitest at repo root; Lefthook runs lint/typecheck on `pre-commit` and tests on `pre-push`.
- Storage: SQLite database is created under `<projectRoot>/.canonkeeper/canonkeeper.db` (directory is created if missing).
- LLM JSON validation: outputs are schema-validated with up to 2 retries; invalid outputs are rejected and logged.
- Evidence-first UI: Bible hides claims without evidence (confirmed claims are created via evidence-backed confirm actions).
- Export: `bible.md`, `scenes.md`, `style_report.md` now include citations; `project.json` includes a full table dump.
- Tests: added integration coverage for ingest + FTS + continuity contradictions.
- Schema: added `scene_evidence` table (migration `004_scene_evidence.sql`) for evidence-backed scene metadata.
- Scene metadata: deterministic POV (first-person) + setting detection now populate `scene_metadata`, `scene_entity`, and `scene_evidence`.
- Config sync: `canonkeeper.json` document list is loaded on project open and updated on add-document.
- Confirmed claims now copy evidence from the source inferred claim to preserve evidence-first guarantees.
- LLM scene metadata: optional LLM classifier (schema-validated, evidence-mapped) can override deterministic scene metadata when evidence is found.
- Scene entities: characters are tagged as `present` when their name appears 2+ times in a scene, otherwise `mentioned`.
- Incremental extraction: LLM/extraction runs only on changed chunk ranges with a 1-chunk context window.
```
