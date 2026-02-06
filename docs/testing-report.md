# CanonKeeper Testing Report

## 1. Environment
- Timestamp (UTC): `2026-02-06T04:23:59Z`
- Repository: `/Users/ryanpalermo/projects/cannon-keeper`
- Bun: `1.2.23`
- Node (host): `v25.3.0`
- Docker: `28.5.2`
- Docker Compose: `v2.40.3`
- Execution model: Dockerized CI-equivalent commands + local fallback commands

## 2. Commands Executed

### Phase A (required exact sequence)
| Command | Result | Notes |
|---|---|---|
| `bun run docker:bake:ci` | PASS | Rebuilt CI images successfully. |
| `bun run docker:lint` | PASS | `eslint . --max-warnings=0` passed in container. |
| `bun run docker:typecheck` | PASS | Desktop + shared typecheck passed in container. |
| `bun run docker:test` | PASS | `21` files / `38` tests passed, includes new RPC integration coverage. |
| `bun run docker:build` | PASS | Renderer + Electron validation build passed. |
| `bun run lint:local` | PASS | Host lint passed. |
| `bun run typecheck:local` | PASS | Host typecheck passed. |
| `bun run build:local` | PASS | Host build passed. |
| `CANONKEEPER_ALLOW_UNSUPPORTED_NODE=1 bun run test:local` | FAIL | Host native module ABI mismatch for `better-sqlite3` (`NODE_MODULE_VERSION 127` vs required `141`). |

### Additional execution
- Playwright skill precheck and install attempt:
  - `/Users/ryanpalermo/.codex/skills/playwright/scripts/playwright_cli.sh --help`
  - Blocked by `ENOTFOUND registry.npmjs.org` (captured in artifact).
- Simulated user journey harness:
  - `docker compose run --name phasec_artifacts test bun apps/desktop/electron/worker/scripts/simulatedJourney.ts`
  - Copied generated artifacts back to repo via `docker cp`.

## 3. Results by Test Layer

### Layer 1: Deterministic Gate
- Status: PASS (dockerized CI-equivalent).
- Lint, typecheck, tests, and build all passed in Docker.
- Local fallback mismatch only on `test:local` due host ABI/runtime mismatch.

### Layer 2: Desktop IPC Contract Gate
- Status: PASS (implemented and executed).
- Added integration suite: `/Users/ryanpalermo/projects/cannon-keeper/apps/desktop/electron/worker/rpc.integration.test.ts`
- Required method coverage implemented and validated:
  - `project.createOrOpen`
  - `project.addDocument`
  - `project.getStatus`
  - `project.getProcessingState`
  - `bible.getEntity`
  - `issues.list`
  - `issues.resolve`
  - `search.ask`
  - `export.run`
- Required assertions implemented:
  - No surfaced claims without evidence.
  - `canon.confirmClaim` rejects missing/invalid `sourceClaimId`.
  - Ask response constrained to `snippets`/`not_found`.
  - Scene export citation quotes validated against source text.

### Layer 3: Simulated User Journey
- Status: PARTIAL (automation fallback used).
- Full Playwright automation was blocked by environment network resolution failure for `@playwright/mcp`.
- Fallback executed:
  - RPC-driven end-to-end journey script:
    `/Users/ryanpalermo/projects/cannon-keeper/apps/desktop/electron/worker/scripts/simulatedJourney.ts`
  - Covered project open, fixture ingest, scenes/issues/style/bible/ask/export flows, claim confirm, issue resolve.
  - Captured export files + `project.getHistory`.
- Manual UI checklist for remaining browser/Electron validation (pending):
  1. Open desktop app and create/open project root.
  2. Add `simple_md.md` and `contradiction.md`.
  3. Confirm ingest completion on Dashboard history/state.
  4. Navigate Dashboard/Bible/Scenes/Issues/Style/Ask tabs.
  5. Confirm one evidence-backed claim and resolve one issue.
  6. Ask question with citation/snippet validation.
  7. Export and verify markdown/json output shapes.

### Layer 4: Full Desktop Smoke
- Status: Not executed in this run (Electron manual smoke pending).

### Phase D: Fixture/Data Matrix + Provider Matrix
- Added missing fixtures:
  - `/Users/ryanpalermo/projects/cannon-keeper/data/fixtures/mixed_quotes.md`
  - `/Users/ryanpalermo/projects/cannon-keeper/data/fixtures/large_revision.md`
- Provider fallback validation added/passed in RPC integration:
  - Cloud enabled without credentials gracefully falls back (no crash).

## 4. Defects Found

### P2 - FTS query warning on apostrophes in Ask flow
- Severity: `P2`
- Reproduction:
  1. Run journey harness with question `What color are Mira's eyes?`.
  2. Inspect history artifact event log.
  3. Observe `fts_query_failed` with `fts5: syntax error near "'"`.
- Impacted modules/files:
  - `/Users/ryanpalermo/projects/cannon-keeper/apps/desktop/electron/worker/search/fts.ts`
- Expected:
  - User question with apostrophes should be sanitized/escaped before primary FTS execution, without warning noise.
- Actual:
  - Initial unsanitized query throws; fallback sanitization runs after warning event is logged.

No `P0` or `P1` product correctness violations were observed in this pass.

## 5. Coverage Gaps / Blockers
- Playwright automation blocker:
  - Environment cannot resolve `registry.npmjs.org`; `@playwright/mcp` install/start fails.
  - Missing artifacts because of this blocker: Playwright trace, screenshots, video.
- Local host test blocker:
  - Native `better-sqlite3` ABI mismatch prevents `test:local` in current host Node runtime.

## 6. Artifacts Produced
- Report:
  - `/Users/ryanpalermo/projects/cannon-keeper/docs/testing-report.md`
- Playwright blocker evidence:
  - `/Users/ryanpalermo/projects/cannon-keeper/docs/artifacts/phase-c/playwright-blocker.md`
- Simulated journey artifacts:
  - `/Users/ryanpalermo/projects/cannon-keeper/docs/artifacts/phase-c/2026-02-06T04-21-32-341Z/journey-summary.json`
  - `/Users/ryanpalermo/projects/cannon-keeper/docs/artifacts/phase-c/2026-02-06T04-21-32-341Z/project-history.json`
  - `/Users/ryanpalermo/projects/cannon-keeper/docs/artifacts/phase-c/2026-02-06T04-21-32-341Z/export/bible.md`
  - `/Users/ryanpalermo/projects/cannon-keeper/docs/artifacts/phase-c/2026-02-06T04-21-32-341Z/export/scenes.md`
  - `/Users/ryanpalermo/projects/cannon-keeper/docs/artifacts/phase-c/2026-02-06T04-21-32-341Z/export/style_report.md`
  - `/Users/ryanpalermo/projects/cannon-keeper/docs/artifacts/phase-c/2026-02-06T04-21-32-341Z/export/project.json`

## 7. Recommended Next Actions
1. Escape/sanitize Ask/FTS queries before the primary SQL `MATCH` execution path to remove apostrophe-triggered warning events.
2. Run the Playwright journey once network access to `registry.npmjs.org` is available (or vendor a local Playwright CLI dependency).
3. Align local Node runtime to `20.x` (or rebuild native deps appropriately) so `test:local` can match dockerized CI behavior.
4. Execute Layer 4 manual Electron smoke and append outcomes to this report.
