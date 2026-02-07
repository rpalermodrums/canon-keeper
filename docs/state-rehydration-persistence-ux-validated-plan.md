# Validated Plan: State Rehydration & Persistence UX (Refresh + Relaunch)

Validated against current codebase on 2026-02-07.

## Validation Verdict
Approved with required amendments. The original plan is directionally correct and non-overlapping with `docs/ux-product-suggestions.md`, but two gaps must be fixed to meet all success criteria:

1. stale/moved-root recovery needs a non-creating restore path
2. renderer test strategy must account for Vitest's default `node` environment

## Findings (Codebase Validation)

1. There is currently no active-project read API. `project.getCurrent` is missing from worker RPC, Electron IPC, preload bridge, and renderer API.
2. Renderer persistence is currently global-key localStorage in `apps/desktop/renderer/src/state/useCanonkeeperApp.ts` (`canonkeeper.issueFilters`, `canonkeeper.entityFilters`, `canonkeeper.selectedSceneId`, `canonkeeper.selectedIssueId`, `canonkeeper.selectedEntityId`, `canonkeeper.continueContext`). This leaks state across projects.
3. Bootstrapping currently has no refresh/relaunch rehydration path; the app can route to Setup on mount when no in-memory project is present.
4. `refreshAll` is project-closure dependent; `onCreateProject` calls `setProject(created)` then `await refreshAll()`, which can execute with stale `project = null` and skip initial hydration.
5. Current `project.createOrOpen` behavior can create a new project DB at a missing path. Without an "open existing" mode, stale last-project recovery is ambiguous and can silently create a new empty project.
6. Renderer has no existing tests and root Vitest config uses `environment: "node"`. Persistence/bootstrap tests should be pure-function tests or explicitly opt into jsdom.

## Non-Overlap Check
This plan remains scoped to persistence/session restore UX and does not include the active UX roadmap items listed in `docs/ux-product-suggestions.md`.

## Validated Scope and Success Criteria

1. Refresh (same Electron app process): restore active project/session and project-scoped UI state automatically.
2. Relaunch (new app process): auto-restore last project root when available.
3. Persist review state per project, not globally.
4. Show persistence behavior in UX with clear recovery/reset controls.
5. Avoid redundant `project.createOrOpen` ingest bootstraps when worker already has an active project.

## Required API Changes (Validated)

1. Add worker method `project.getCurrent: ProjectSummary | null`.
2. Add Electron IPC channel `project:getCurrent` and preload bridge method `window.canonkeeper.project.getCurrent()`.
3. Add renderer API wrapper in `apps/desktop/renderer/src/api/ipc.ts`.
4. Update method unions/types in:
   - `apps/desktop/electron/worker/rpc.ts`
   - `apps/desktop/renderer/src/types.d.ts`
5. Required amendment for stale-root handling:
   - extend `project.createOrOpen` payload with `createIfMissing?: boolean` (default `true`)
   - auto-restore path must call with `createIfMissing: false`
   - manual Setup flow continues default behavior (`true`)

## Implementation Plan (Validated)

### Workstream 1: Active Project Read API

1. Implement `project.getCurrent` in `apps/desktop/electron/worker/worker.ts`:
   - return `null` when `session` or `currentProjectId` is unset
   - else return `getProjectById(session.handle.db, currentProjectId)`
2. Add routing in main/preload/renderer API/type layers.
3. Keep method side-effect free (no watcher registration, no queue activity).

### Workstream 2: Versioned Persistence Envelope

1. Add `apps/desktop/renderer/src/state/persistence.ts`.
2. Define `canonkeeper.session.v1` envelope with:
   - global: `lastProjectRoot`, `lastProjectId`, optional `lastProjectName`
   - global UI (unchanged scope): `activeSection`, `sidebarCollapsed`
   - per-project UI map keyed by project ID for:
     - `issueFilters`
     - `entityFilters`
     - `selectedSceneId`
     - `selectedIssueId`
     - `selectedEntityId`
     - `continueContext`
3. Add migration from legacy localStorage keys currently read in `useCanonkeeperApp.ts`.
4. Do not persist manuscript text, evidence payloads, or destructive drafts (`confirmClaimDraft`, `dismissIssueDraft`).

### Workstream 3: Deterministic Boot Rehydration

1. Add guarded boot effect in `useCanonkeeperApp.ts` (`bootAttemptedRef`) for StrictMode.
2. Rehydration order:
   - load persisted envelope
   - call `getWorkerStatus`
   - call `project.getCurrent`
   - if current project exists: adopt it
   - else if persisted `lastProjectRoot` exists: call `project.createOrOpen({ rootPath, createIfMissing: false })`
   - else remain no-project state
3. On resolved project:
   - set `project` and `rootPath`
   - apply per-project persisted UI state
   - persist `lastProject*` metadata
   - call shared hydrate loader
4. On restore failure (missing/moved root, permission, DB error):
   - clear stale `lastProject*`
   - show recoverable UI message
   - keep Setup usable

### Workstream 4: Hydration/Data Loading Semantics

1. Replace project-closure `refreshAll` entrypoint with parameterized loader:
   - `hydrateProjectData(projectSummary, overrides?)`
2. Make both manual project open and auto-restore call the same hydrate function.
3. Keep status polling subscription, but avoid duplicate concurrent hydrate runs (in-flight guard).
4. Preserve evidence-first and no-manuscript-logging constraints.

### Workstream 5: Persistence UX Controls

1. Add transient boot indicator: `Restoring last project...`.
2. Add restore failure banner with actions:
   - `Choose Project Folder`
   - `Clear saved session`
3. Add Settings section "Session & Persistence" in `apps/desktop/renderer/src/views/SettingsView.tsx`:
   - `Forget Last Project`
   - `Reset This Project's Saved UI State`
4. Keep destructive action drafts non-persistent.

### Workstream 6: Tests and Regression Coverage

1. Extend `apps/desktop/electron/worker/rpc.integration.test.ts`:
   - `project.getCurrent` returns `null` before open
   - returns active summary after open
   - updates when switching roots
2. Add renderer persistence tests for `persistence.ts`:
   - read/write envelope
   - legacy migration
   - per-project isolation
   - clear session/project behavior
3. Add bootstrap decision tests via extracted pure helper(s):
   - active worker project wins over persisted root
   - fallback to persisted root when no active project
   - stale root failure clears pointer and returns recoverable state
4. Test implementation note:
   - prefer pure helper tests with injected storage facade to avoid depending on jsdom in default `node` test environment

## Rollout and Release Notes

1. Ship without feature flag (local-only state + read-only current-project API + guarded restore open path).
2. Release note: "CanonKeeper now restores your last project and per-project review context after refresh/relaunch."
3. Post-ship check: monitor startup path for `Project not initialized` errors and restore-failure banners.

## Acceptance Checklist (Validated)

1. Refresh restores current project card and scoped selections/filters.
2. Relaunch auto-opens last project when path exists.
3. Refresh path does not enqueue redundant ingest when worker already has current project.
4. Missing/moved root yields recoverable message and clears stale saved pointer.
5. Project switching preserves isolation of scoped review state.

