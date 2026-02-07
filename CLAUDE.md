# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All default scripts are **Dockerized** (Compose + Buildx Bake). Local variants exist as `*:local` suffixes.

```bash
# Development
bun run dev              # Container: Vite dev server on localhost:5173
bun run dev:local        # Local: full Electron stack (Vite + main via tsx + preload watch)

# Quality checks
bun run lint             # Dockerized ESLint (max-warnings=0)
bun run lint:local       # Host ESLint
bun run typecheck        # Dockerized tsc (desktop + shared)
bun run typecheck:local  # Host tsc
bun run test             # Dockerized Vitest
bun run test:local       # Host Vitest (node ./node_modules/vitest/vitest.mjs run)

# Build
bun run build            # Dockerized: renderer artifacts + Electron TS validation
bun run build:local      # Host: Vite build + tsc check
```

Run a single test file locally: `node ./node_modules/vitest/vitest.mjs run path/to/file.test.ts`

Tests use a global setup at `apps/desktop/electron/worker/testPreflight.ts`. Test patterns: `apps/**/*.test.ts`, `apps/**/*.test.tsx`, `packages/**/*.test.ts`.

Pre-commit hooks (lefthook): lint + typecheck. Pre-push: tests. All via Docker by default.

## Architecture

CanonKeeper is a local-first Electron desktop app for fiction writers. It ingests manuscripts **read-only** and produces evidence-backed editorial diagnostics (Characters & World, scene index, style analysis, continuity issues, Q&A).

### Process model (three processes)

1. **Renderer** (React) — UI only; all data flows through IPC
2. **Main** (Electron) — app lifecycle, window management, IPC routing between renderer and worker
3. **Worker** (child_process.fork) — all heavy work: SQLite, ingestion pipeline, LLM calls, search, export

### IPC flow

```
Renderer → ipcRenderer.invoke() → Main (ipcMain handler) → WorkerClient.invoke() → Worker child process
Worker → process.send(RpcResponse) → Main → ipcMain resolve → Renderer
```

`WorkerClient` (`electron/worker/client.ts`) manages the child process lifecycle with auto-restart, exponential backoff, and request buffering during restarts.

### Pipeline stages (sequential per document)

```
File change (chokidar) → Debounced job queue → Ingest → Chunking → Scene detection
→ Style analysis → Extraction (optional LLM) → Continuity checks → SQLite persist
```

The pipeline lives in `apps/desktop/electron/worker/pipeline/`. Jobs are persisted in `PersistentJobQueue` for crash recovery.

### Storage

- SQLite via `better-sqlite3`, WAL mode, foreign keys enforced
- DB path: `<projectRoot>/.canonkeeper/canonkeeper.db`
- Migrations in `/migrations/` (001–009), run on project open
- FTS5 virtual table for full-text search on chunks
- Repository pattern: separate DAOs per domain entity in `worker/storage/`

### Monorepo layout

```
apps/desktop/
  electron/          # main.ts, preload.ts, worker.ts
    worker/          # pipeline/, storage/, jobs/, search/, llm/, export/, style/
  renderer/          # React UI (Vite), views/, components/, state/, api/
packages/shared/     # Types (persisted.ts), utilities (hashing, normalize, spans)
migrations/          # SQL migration files
data/fixtures/       # Test manuscripts
```

### Key RPC namespace methods

`project.*`, `system.*`, `search.*`, `scenes.*`, `issues.*`, `style.*`, `bible.*`, `canon.*`, `export.*` — defined in `worker/rpc.ts`, dispatched in `worker/worker.ts`.

### Detailed architecture

For comprehensive module-by-module documentation, data flows, and navigation guides, see [docs/CODEBASE_MAP.md](docs/CODEBASE_MAP.md).

## Non-negotiable constraints

1. **Never edit user manuscripts** — read-only ingestion only
2. **No ghostwriting** — diagnostics only, no rewrites or suggestions
3. **Evidence-first** — every claim/issue/metadata must include exact quote spans; hide items without evidence
4. **Writer-confirmed canon wins** — confirmed claims are never overwritten; conflicts become issues
5. **Incremental processing** — reprocess only changed ranges on file change

## Code standards

- TypeScript strict mode, no `any` (except isolated serialization layers)
- Bun 1.2.23 package manager, Node 25 runtime, ES modules (`"type": "module"`)
- ESLint max-warnings=0, Prettier (print width 100, double quotes, trailing comma "none")
- Separate storage (SQL), pipeline logic (pure functions), and UI rendering
- LLM outputs are schema-validated with retries; evidence span mapping must succeed or results are discarded
- Log failures to `event_log`; never log manuscript text by default
- LLM is optional: app must work fully with `NullProvider` (no LLM configured)
