# CanonKeeper AI Agent Test Plan (Detailed)

## 1. Objective
This plan defines a repeatable, machine-oriented validation workflow for AI agents running in CI or local automation.

Goals:
- deterministic pass/fail checks
- explicit command sequence
- reproducible artifacts
- strong coverage of ingestion, retrieval, continuity, style, and export paths

## 2. Inputs and Fixtures
Required fixtures:
- `data/fixtures/simple_md.md`
- `data/fixtures/contradiction.md`
- `data/fixtures/pov_switch.md`
- `data/fixtures/tone_shift.md`
- `data/fixtures/novel_length_fixture.md`

Per-run isolated project root:
- create temp dir under `/tmp` (or workspace temp directory)
- never reuse existing `.canonkeeper` state

## 3. Preconditions
- Node 25 runtime
- Bun dependencies installed
- Agent has filesystem read/write access to workspace + temp root
- If native module mismatch occurs, rerun install/rebuild before proceeding

## 4. Required Outputs
For each run, agent must produce:
- `output/agent-test/<timestamp>/summary.md`
- `output/agent-test/<timestamp>/assertions.json`
- `output/agent-test/<timestamp>/exports/*`
- `output/agent-test/<timestamp>/logs/*.txt`

`assertions.json` should include each check with fields:
- `id`, `status`, `expected`, `actual`, `evidence`

## 5. Command Sequence

### 5.1 Static Gates
1. `bun run lint:local`
2. `bun run typecheck:local`
3. `bun run test:local`

Hard fail on any non-zero exit.

### 5.2 Worker/API Integration Gate
Run integration tests focusing on RPC + persistence:
- `bun run --cwd apps/desktop test -- electron/worker/rpc.integration.test.ts`

Record test output in run logs.

### 5.3 App Flow Simulation
Use an automation harness (playwright bridge or equivalent) to execute:
1. Launch app
2. Create/open isolated project
3. Add `contradiction.md`
4. Poll status until idle and queue depth zero
5. Query scenes/issues/entities/style/search/ask/export

If UI automation is unavailable, call IPC/worker RPC directly in-process and preserve parity checks.

## 6. Deterministic Assertions

### A. Storage + Migrations
- DB file exists at `<projectRoot>/.canonkeeper/canonkeeper.db`
- `schema_migrations` table exists
- `job_queue` table exists
- `chunk_fts` virtual table exists

### B. Ingest + Search
- At least one document row created
- At least one snapshot row created
- Chunk count > 0
- FTS search for known token returns >= 1 result

### C. Scenes
- Scene count > 0
- Scene ordinals are strictly increasing per document
- At least one scene has evidence when metadata is non-unknown

### D. Style
- `style_report` response returns repetition/tone/dialogue payloads
- At least one style issue exists for `tone_shift.md` or `novel_length_fixture.md`

### E. Bible + Claims
- Entity list not empty after contradiction + long-form ingest
- For surfaced claims in entity detail: evidence count >= 1
- Confirm claim requires `sourceClaimId`
- Confirmed claim persists and remains evidence-backed

### F. Issues Lifecycle
- Contradiction fixture yields continuity issue(s)
- Dismiss transitions issue status to dismissed
- Undo returns status to open
- Resolve transitions status to resolved

### G. Ask
- Known question returns `answer` or `snippets`
- Unknown question returns `not_found`
- No response variant includes uncited fabricated narrative

### H. Export
- `export.run(kind=md)` returns success + files list
- `export.run(kind=json)` returns success + files list
- Exported files exist on disk

### I. Long-Form Stress
After ingesting `novel_length_fixture.md`:
- Worker reaches idle state within timeout budget (configurable)
- UI/API endpoints remain responsive
- No fatal runtime errors in logs

## 7. Timeout + Retry Policy
- Poll interval: 1-2 seconds
- Stage timeout: 120 seconds for standard fixtures
- Long fixture timeout: 600 seconds (configurable by machine capacity)
- Retry flaky transport operations up to 2 attempts with backoff
- Do not retry logical assertion failures

## 8. Failure Classification
Classify failures as:
- `infra` (env/runtime/tooling)
- `pipeline` (ingest/scenes/style/extraction/continuity)
- `api` (IPC/RPC contract)
- `ui` (render interaction/state wiring)
- `data` (missing/invalid evidence or export mismatch)

Include likely owner and first suspected subsystem.

## 9. Agent Safety Rules
- Never edit manuscript source fixtures during assertions
- Never mutate user project folders outside isolated temp roots
- Never auto-accept low-evidence claims as passing conditions
- On partial failure, continue remaining independent checks and emit full report

## 10. Pass Criteria
Run is `PASS` only when:
- static gates succeed
- all critical assertions (A, B, C, E, F, G, H) pass
- long-form stress (I) passes or is explicitly waived with reason
- no blocker-level errors in logs

## 11. Minimal Report Template (`summary.md`)
- Run metadata (timestamp, commit SHA, environment)
- Command results table
- Assertion totals (pass/fail/skipped)
- Top failures with reproduction pointers
- Export artifact paths
- Final verdict: `PASS` or `FAIL`
