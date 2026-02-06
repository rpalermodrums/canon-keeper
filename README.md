# CanonKeeper

CanonKeeper is a local-first, evidence-first desktop companion for fiction writing. It ingests manuscripts **read-only**, builds a "Book Bible" (entities + claims + evidence), scene index, style/voice diagnostics, continuity issues, and an ask-the-bible Q&A. Everything it surfaces is backed by exact quote spans.

## Why CanonKeeper
- **Evidence-first**: every surfaced fact/flag includes a verbatim quote span.
- **Writer-first**: no manuscript edits, no ghostwriting, no rewrites.
- **Local-first**: SQLite storage; no cloud dependency.
- **Optional LLM**: runs with `NullProvider` when LLM is disabled.

## Features (MVP)
- **Book Bible**: entities + claims with evidence; confirmed canon overrides inferred claims.
- **Scene Index**: deterministic boundaries; POV/setting metadata with evidence.
- **Style/Voice**: repetition, tone drift, dialogue tics (diagnostic only).
- **Continuity Issues**: evidence-backed contradictions (e.g. eye color conflicts).
- **Ask-the-bible**: extractive retrieval with grounded snippets and citations.
- **Exports**: Markdown + JSON with citations.

## Non-negotiable constraints
1. **Never edit user manuscripts.**
2. **No ghostwriting.** Diagnostics only.
3. **Evidence-first.** If we can’t map a quote span, it is hidden by default.
4. **Writer-confirmed canon wins.** Confirmed claims don’t get overwritten.
5. **Incremental processing.** Reprocess only changed ranges when possible.

## Architecture overview
- **Electron main process**: app lifecycle + IPC.
- **Renderer (React)**: UI only.
- **Worker**: ingestion, SQLite, pipelines, indexing.

Data lives in `<projectRoot>/.canonkeeper/canonkeeper.db`.

## Repository layout
See `AGENTS.md` for the full MVP spec and constraints. High-level layout:

```
canonkeeper/
  apps/desktop/
    electron/   # main, preload, worker
    renderer/   # React UI
  packages/shared/
  migrations/
  data/fixtures/
```

## Getting started

### Requirements
- Docker Engine + Docker Compose plugin + Buildx
- Bun (for local non-container fallback)
- Node 25 (for local non-container fallback)

### Install
```bash
bun install
```

### Development (container-first)
```bash
bun run dev
```

This starts the renderer dev server in Docker on `http://localhost:5173`.

### Development (local Electron fallback)
```bash
bun run dev:local
```

This runs the full Electron stack on your machine:
- Vite dev server for the renderer
- Electron main process (via `tsx`)
- Electron preload watch build

### Build
```bash
bun run build
```

`build` produces renderer artifacts and validates Electron code via TypeScript.

### Compose + Bake commands
```bash
# Build all CI targets from compose services
bun run docker:bake:ci

# Run individual containerized checks against prebuilt images
bun run docker:lint
bun run docker:typecheck
bun run docker:test
bun run docker:build
```

## Configuration
Each project can include `canonkeeper.json` in the project root:

```json
{
  "projectName": "My Novel",
  "documents": ["draft.md"],
  "llm": { "provider": "cloud", "model": "default", "enabled": false, "baseUrl": "" },
  "style": {
    "stopwords": "default",
    "repetitionThreshold": { "projectCount": 12, "sceneCount": 3 },
    "toneBaselineScenes": 10
  }
}
```

When you add a document in the UI, CanonKeeper updates `canonkeeper.json` and begins watching the file.

## LLM configuration (optional)
Set these environment variables for LLM use:

- `CANONKEEPER_LLM_API_KEY`
- `CANONKEEPER_LLM_BASE_URL` (if you don’t set `llm.baseUrl` in config)

LLM outputs are schema-validated with retries and evidence span mapping. If evidence cannot be mapped, results are discarded.

## Testing
```bash
bun run lint
bun run typecheck
bun run test
```

The default scripts are Dockerized and use Compose + Buildx Bake.

If you need to run directly on the host:
```bash
bun run lint:local
bun run typecheck:local
bun run test:local
```

Pre-commit hooks (lefthook) run Dockerized lint + typecheck, and pre-push runs Dockerized tests.
GitHub Actions CI bakes compose targets, then runs lint/typecheck/test/build via `docker compose run`.

High-fidelity end-to-end validation guidance lives in `docs/testing-plan.md`.

## Evidence-first behavior
- Claims are only surfaced when evidence is present.
- Scene metadata evidence is stored in `scene_evidence`.
- Confirming a claim copies evidence from the source inferred claim.

## Status
This repo contains the CanonKeeper MVP implementation and test suite. See `AGENTS.md` for the detailed roadmap and acceptance checklist.
