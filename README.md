# CanonKeeper

CanonKeeper is a local-first, evidence-first desktop companion for fiction projects. It ingests manuscripts **read-only**, builds a Book Bible (entities + claims + evidence), scene index, style/voice diagnostics, continuity issues, and an ask-the-bible Q&A. Everything it surfaces is backed by exact quote spans.

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
- **Ask-the-bible**: FTS retrieval, optional LLM answer with citations.
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
- Node >= 20
- pnpm

### Install
```bash
pnpm install
```

### Development
```bash
pnpm dev
```

This runs:
- Vite dev server for the renderer
- Electron main process (via `tsx`)
- Electron preload watch build

### Build
```bash
pnpm build
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
pnpm lint
pnpm typecheck
pnpm test
```

Pre-commit hooks (lefthook) run lint + typecheck, and pre-push runs tests.
GitHub Actions CI runs lint, typecheck, and tests on pushes and pull requests.

## Evidence-first behavior
- Claims are only surfaced when evidence is present.
- Scene metadata evidence is stored in `scene_evidence`.
- Confirming a claim copies evidence from the source inferred claim.

## Status
This repo contains the CanonKeeper MVP implementation and test suite. See `AGENTS.md` for the detailed roadmap and acceptance checklist.
