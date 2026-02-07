# CanonKeeper Testing Plan (Docker + Bun, Handoff Runbook)

This document is the execution guide for validating CanonKeeper as close as possible to real writer usage, while staying deterministic in CI.

## Objectives
- Preserve non-negotiables: read-only ingestion, no ghostwriting, evidence-first assertions.
- Catch regressions in worker/session lifecycle, extraction, continuity, style, export, and Ask behavior.
- Validate the desktop UX path from project setup to export with realistic interactions.
- Keep CI deterministic and reproducible with Docker Compose + Buildx Bake.

## Current Tooling Contract
- Package manager: `bun`
- Default root scripts are containerized (`docker buildx bake` + `docker compose`).
- Local fallback scripts exist with `*:local`.
- CI runs dockerized `lint`, `typecheck`, `test`, `build`.

## Environment Requirements
- Required for primary flow:
  - Docker Engine with Compose v2 plugin
  - Docker Buildx
  - Bun (`bun@1.2.23`)
- Required only for local non-container fallback:
  - Node `25.x`
- Note:
  - `better-sqlite3` is a native module and must be compiled for the runtime executing tests.
  - If local tests fail with ABI mismatch, rerun `bun install` (or `npm rebuild better-sqlite3`).

## Fast Runbook (Use This First)

### CI-equivalent run (recommended)
```bash
bun run docker:bake:ci
bun run docker:lint
bun run docker:typecheck
bun run docker:test
bun run docker:build
```

### Shortcut wrappers (also dockerized)
```bash
bun run lint
bun run typecheck
bun run test
bun run build
```

### Local fallback (no Docker)
```bash
bun run lint:local
bun run typecheck:local
bun run build:local
bun run test:local
```

If native-module ABI mismatch occurs:
```bash
bun install
# or
npm rebuild better-sqlite3
```

## Pass/Fail Gates
- `lint` passes with zero warnings.
- `typecheck` passes for desktop and shared packages.
- `test` passes all suites.
- `build` completes renderer build and Electron TS validation.
- No surfaced output violates evidence-first constraints.

## Test Layers

## 1. Deterministic Gate (PR + CI)
Status: implemented.

Purpose:
- Syntax/type safety, storage/pipeline behavior, extraction validation, and regression detection.

Commands:
- Use the CI-equivalent runbook above.

Acceptance:
- All 4 commands pass.

## 2. Desktop IPC Contract Gate (PR + CI)
Status: partially covered; expand in next session.

Goal:
- Validate real RPC contract behavior through worker messaging, not only direct function tests.

Required method coverage:
- `project.createOrOpen`
- `project.addDocument`
- `project.getStatus`
- `project.getProcessingState`
- `bible.getEntity`
- `issues.list`
- `issues.resolve`
- `search.ask`
- `export.run`

Assertions:
- Evidence-first:
  - no surfaced claim without evidence
  - confirm requires evidence-backed `sourceClaimId`
  - scene export does not fabricate citations
- Ask:
  - returns only `snippets` or `not_found`
  - no generated prose answers

Implementation guidance for next agent:
- Add dedicated RPC integration tests under `apps/desktop/electron/worker/` (e.g. `rpc.integration.test.ts`).
- Spawn worker as child process, send `RpcRequest`, assert `RpcResponse`.
- Use temp project roots and existing fixtures in `data/fixtures`.
- Ensure teardown closes child process/watchers cleanly.

## 3. Simulated User Journey (Nightly + RC)
Status: planned; implement in next session.

Primary approach:
- Use Playwright against a browser-hosted renderer harness (`dev:container` or Vite preview).
- Trigger same user actions the UI exposes (project open, add doc, navigate tabs, ask, export).

Scenario:
1. Open/select project directory.
2. Add manuscript fixture (`simple_md.md` and `contradiction.md`).
3. Wait for processing completion in status/history.
4. Navigate Home → Characters & World → Scenes → Issues → Style → Search.
5. Confirm one evidence-backed detail.
6. Resolve one issue.
7. Ask a question and verify snippets/citations.
8. Export markdown/json and verify file outputs + citation presence rules.

Artifacts to capture:
- Playwright trace
- screenshots/video
- exported files
- `project.getHistory` payload snapshot

Implementation notes:
- Prefer using the `playwright` skill in Codex sessions for setup/execution.
- Add a dedicated script (recommended): `bun run test:e2e`.
- Keep e2e deterministic by using fixed fixtures and stable waits (status-based, not sleep-only).

## 4. Full Desktop Smoke (Pre-release, Manual)
Status: planned.

Goal:
- Validate true Electron shell behavior and native dialogs.

Command:
```bash
bun run dev:local
```

Checklist:
- First-run flow is understandable (project/doc selection, sample fixture path).
- Ingest starts and completes, and views refresh correctly.
- Evidence excerpts + line metadata are visible and accurate.
- Ask never returns model-authored prose.
- Export files generated and readable.

## Data Matrix
- Current fixtures:
  - `data/fixtures/simple_md.md`
  - `data/fixtures/contradiction.md`
  - `data/fixtures/pov_switch.md`
  - `data/fixtures/tone_shift.md`
- Add in next session:
  - `data/fixtures/mixed_quotes.md` (straight + curly dialogue)
  - `data/fixtures/large_revision.md` (incremental reprocessing coverage)

Provider matrix:
- NullProvider mode (required baseline)
- Cloud provider disabled/no-key path (graceful fallback)

## Severity and Triage
- `P0`: evidence-first violation, manuscript mutation, RPC contract break, Ask prose generation.
- `P1`: incorrect continuity/style detection with evidence.
- `P2`: UI refresh/interaction issues that do not compromise correctness.

## Rollout Cadence
- PR: Layers 1 + 2.
- Nightly: Layers 1 + 2 + 3.
- Pre-release: Layers 1 + 2 + 3 + 4.

## Handoff Checklist For Next Agent
- Confirm Dockerized gate is green using the CI-equivalent runbook.
- Implement missing Layer 2 RPC integration tests.
- Implement Layer 3 Playwright journey and artifact collection.
- Add missing fixtures from Data Matrix.
- Wire e2e job into CI schedule (nightly) without blocking PR deterministic gate.
