# Remaining UI/UX Implementation Specifications

**Date:** 2026-02-07
**Scope:** 14 open issues from the CanonKeeper UI audit
**Prerequisite:** The 2026-02-07 remediation pass (17 fixes) must be merged first.

> All 14 specs in this document were implemented on 2026-02-07. See docs/ui-issues.md for resolution status.

All file paths are relative to `apps/desktop/`.

---

## Priority Tiers

| Tier | Issues | Rationale |
|------|--------|-----------|
| **P0** | M-1, M-3, M-4 | Architectural fixes that affect every view. M-1 unblocks concurrent user workflows. M-3 and M-4 address the two biggest trust gaps for writers with large manuscripts. |
| **P1** | M-5, M-9, M-6 | Navigation and onboarding. M-5 prevents confusion for new/between-project users. M-9 prevents stuck states. M-6 completes the first-run experience. |
| **P2** | m-4, m-5, m-8, m-6, m-9 | Data surfacing and minor UX. Each is self-contained and low-risk. |
| **P3** | c-1, c-2, c-3 | Cosmetic polish. Can be done opportunistically. |

Within each tier, issues are listed in recommended implementation order.

---

## P0 — Architecture

### M-1: Per-Action Busy States

**Problem:** A single `busy` boolean derived from `pendingActions.length > 0` (`useCanonkeeperApp.ts:306`) gates all buttons across all views. Starting an export disables Search. Running diagnostics disables Refresh Scenes.

**Current mechanism:**

```
pendingActions: string[]          // e.g. ["export", "search"]
busy = pendingActions.length > 0  // true if ANY action is in flight
```

Nine action functions push labels: `diagnostics`, `createProject`, `addDocument`, `search`, `ask`, `dismissIssue`, `resolveIssue`, `confirmClaim`, `export`.

**Proposed solution:** Replace the single `busy` boolean with a namespace-aware busy tracker.

**Step 1 — Define namespaces.** Group actions into independent namespaces:

| Namespace | Actions | Views affected |
|-----------|---------|---------------|
| `project` | `createProject`, `addDocument` | SetupView |
| `search` | `search`, `ask` | SearchView |
| `issues` | `dismissIssue`, `resolveIssue` | IssuesView |
| `bible` | `confirmClaim` | BibleView |
| `export` | `export` | ExportView |
| `system` | `diagnostics` | SettingsView |

**Step 2 — Replace state.**

```typescript
// Before
const [pendingActions, setPendingActions] = useState<string[]>([]);
const busy = pendingActions.length > 0;

// After
const [pendingActions, setPendingActions] = useState<Map<string, Set<string>>>(new Map());

const busyNamespaces = useMemo(() => {
  const result = new Set<string>();
  for (const [ns, actions] of pendingActions) {
    if (actions.size > 0) result.add(ns);
  }
  return result;
}, [pendingActions]);

const busy = busyNamespaces.size > 0;  // keep global busy for StatusBadge
const isBusy = useCallback((ns: string) => busyNamespaces.has(ns), [busyNamespaces]);
```

**Step 3 — Update beginAction/endAction** to accept `(namespace, label)` instead of just `(label)`.

**Step 4 — Update each view** to use `isBusy("search")` instead of `busy` for their local buttons. Keep `busy` for the TopBar StatusBadge and sidebar indicators.

**Files to modify:**
- `renderer/src/state/useCanonkeeperApp.ts` — busy state, beginAction, endAction, all 9 action functions
- `renderer/src/App.tsx` — pass `isBusy` or per-view busy props
- All view files — change `disabled={busy}` to `disabled={isBusy("namespace")}`

**Acceptance criteria:**
- Starting an export does not disable the Search button
- Running a search does not disable Refresh Scenes
- The TopBar StatusBadge still reflects any-action-in-flight
- All existing disabled states still work within their own namespace
- All 77 tests still pass

**Risk:** Medium. Touches every view. Recommend a feature branch with thorough manual testing.

---

### M-3: Progress Indication for Long-Running Operations

**Problem:** Ingesting a novel-length manuscript can take 10+ minutes. The only feedback is a small StatusBadge in the TopBar. No stage names, no file names, no queue depth, no estimated time.

**Available data:** The `processingState` array in `useCanonkeeperApp.ts:187` contains per-document, per-stage rows with `stage`, `status`, `error`, `updated_at`, and `document_path`. The pipeline stages are: `ingest`, `scenes`, `style`, `extraction`, `continuity`.

**Proposed solution:** Add a progress banner component that appears at the top of the main content area whenever the worker is processing.

**Step 1 — Create `renderer/src/components/ProgressBanner.tsx`:**

```typescript
type ProgressBannerProps = {
  processingState: ProcessingStateRow[];
  statusPhase: string;
};
```

The banner should display:
- Current stage in plain language: "Reading your manuscript..." / "Finding scenes..." / "Analyzing style..." / "Extracting characters and locations..." / "Checking for continuity issues..."
- Active filename (extracted from `document_path`, filename only)
- Queue depth: "3 files remaining after this one."
- Collapse to a brief success state when processing completes: "All files analyzed."

Use the existing `STAGE_ORDER` constant from DashboardView and the `friendlyStageLabel()` helper (or move them to a shared location).

**Step 2 — Render the banner in `App.tsx`** above the view content, visible from any section (not just Dashboard). Show when `status.phase !== "idle"` or when any `processingState` row has `status === "running"`.

**Step 3 — Add a dismiss/minimize control** so the writer can collapse the banner to a single line if it's distracting.

**Files to modify:**
- `renderer/src/components/ProgressBanner.tsx` — new component
- `renderer/src/App.tsx` — render banner above view content
- `renderer/src/state/useCanonkeeperApp.ts` — expose `processingState` and `status` (already exposed)

**Acceptance criteria:**
- Banner appears during any pipeline processing, visible from all sections
- Shows current stage, active filename (not full path), and queue depth
- Collapses to success message when processing completes
- Can be dismissed/minimized by the writer
- Does not appear when the worker is idle

**Dependency:** None. Can be implemented independently.

---

### M-4: Skeleton Loading States

**Problem:** Views show `EmptyState` ("No Scenes Yet") immediately on navigation, even when data is in transit from the worker. Writers briefly see "no data" when data simply hasn't arrived yet.

**Available infrastructure:** `renderer/src/components/Skeleton.tsx` exists with `text`, `circle`, and `rect` variants, multi-line support, and a shimmer animation. It is currently unused.

**Proposed solution:** Introduce a `dataReady` flag per data domain and show skeletons until the first successful data fetch completes.

**Step 1 — Add per-domain "has loaded" flags** to `useCanonkeeperApp.ts`:

```typescript
const [scenesLoaded, setScenesLoaded] = useState(false);
const [issuesLoaded, setIssuesLoaded] = useState(false);
const [styleLoaded, setStyleLoaded] = useState(false);
const [entitiesLoaded, setEntitiesLoaded] = useState(false);
```

Set each flag to `true` after the first successful IPC response for that domain (inside `refreshScenes`, `refreshIssues`, `refreshStyle`, `refreshEntities`). Reset to `false` when a new project is opened.

**Step 2 — Pass `loaded` flags to views** alongside the data arrays.

**Step 3 — Add skeleton layouts to each view:**

| View | Skeleton layout |
|------|----------------|
| ScenesView | 5 table rows with gray bars for each column |
| IssuesView | 3 card-shaped blocks matching issue card height |
| BibleView | 6 list items with gray bars for name + type badge |
| StyleView | 4 card-sized blocks for summary stats |
| DashboardView | 4 summary card shapes |

**Step 4 — Conditional rendering** in each view:

```typescript
if (!loaded) return <ScenesSkeleton />;
if (scenes.length === 0) return <EmptyState ... />;
return <ScenesTable ... />;
```

**Files to modify:**
- `renderer/src/state/useCanonkeeperApp.ts` — add loaded flags
- `renderer/src/App.tsx` — pass loaded flags to views
- `renderer/src/views/ScenesView.tsx` — add skeleton
- `renderer/src/views/IssuesView.tsx` — add skeleton
- `renderer/src/views/BibleView.tsx` — add skeleton
- `renderer/src/views/StyleView.tsx` — add skeleton
- `renderer/src/views/DashboardView.tsx` — add skeleton
- `renderer/src/components/Skeleton.tsx` — may need view-specific skeleton compositions

**Acceptance criteria:**
- Navigating to a data view before data arrives shows a shimmer skeleton
- Skeleton matches the approximate layout of the populated view
- After data arrives, skeleton transitions to real content (no flash)
- If data arrives empty, the `EmptyState` component shows (not the skeleton)
- Switching projects resets loaded flags so skeletons appear again

**Dependency:** None. Can be implemented independently.

---

## P1 — Navigation & Onboarding

### M-5: Sidebar Project-Awareness Gating

**Problem:** All 9 sidebar sections are always visible and clickable regardless of whether a project is open. Clicking Scenes with no project shows an empty state with no guidance about why it's empty.

**Current state:** `Sidebar.tsx` has no `hasProject` prop. It renders `APP_SECTIONS.map()` unconditionally.

**Proposed solution:** Add project-awareness to the sidebar. Sections that require a project are visually dimmed and show a tooltip when no project is open.

**Step 1 — Add `hasProject` prop to Sidebar:**

```typescript
type SidebarProps = {
  // ... existing props
  hasProject: boolean;
};
```

**Step 2 — Define which sections require a project:**

```typescript
const PROJECT_REQUIRED_SECTIONS = new Set<AppSection>([
  "search", "scenes", "issues", "style", "bible", "exports"
]);
```

Home, Setup, and Settings are always available.

**Step 3 — Disable navigation for project-required sections** when `!hasProject`:

- Apply `opacity-40 pointer-events-none` styling
- Add `aria-disabled="true"` for accessibility
- Show a `title` tooltip: "Open a project first"
- Prevent `onSectionChange` from firing

**Step 4 — Pass `hasProject` from App.tsx** (already available as `app.project !== null`).

**Alternative approach:** Instead of disabling, keep sections clickable but show a contextual empty state with a "Go to Setup" action button. This is less restrictive but requires updating all 6 data-view EmptyState messages to detect the no-project condition.

**Files to modify:**
- `renderer/src/components/Sidebar.tsx` — add prop, conditional styling
- `renderer/src/App.tsx` — pass `hasProject` to Sidebar

**Acceptance criteria:**
- Without a project: Search, Scenes, Issues, Style, Characters & World, Exports are visually dimmed and not navigable
- Home, Setup, Settings remain fully interactive
- After opening a project, all sections become active
- Screen readers announce disabled state via `aria-disabled`

---

### M-9: Boot Spinner Timeout and Cancel

**Problem:** During boot (`bootState === "booting"`), the app shows an indefinite spinner with no timeout and no cancel button (`App.tsx:130-135`). If the saved project path is on an unmounted volume or the worker is unresponsive, the writer is stuck. The sidebar is also interactive during boot, creating a race condition.

**Proposed solution:** Add a timeout and a skip button to the boot spinner.

**Step 1 — Add a timeout** in the boot effect (`useCanonkeeperApp.ts:484-570`):

```typescript
const bootTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

// Inside the boot effect:
bootTimeoutRef.current = setTimeout(() => {
  if (bootState === "booting") {
    setBootState("restore-failed");
    setBootError("Restoring your last session timed out. You can start fresh or try again.");
  }
}, 15_000); // 15 seconds

// Clear on successful boot:
clearTimeout(bootTimeoutRef.current);
```

**Step 2 — Add a "Skip" button** to the boot spinner in `App.tsx`:

```tsx
{app.bootState === "booting" ? (
  <div className="flex flex-1 flex-col items-center justify-center gap-3 text-text-secondary">
    <Loader2 size={24} className="animate-spin text-accent" />
    <p className="text-sm">Restoring your last session...</p>
    <button
      type="button"
      className="mt-2 text-xs text-text-muted hover:text-text-primary underline cursor-pointer"
      onClick={app.skipBoot}
    >
      Skip and start fresh
    </button>
  </div>
) : null}
```

**Step 3 — Disable sidebar navigation during boot** by adding `bootState` awareness:

```tsx
<Sidebar
  // ... existing props
  disabled={app.bootState === "booting"}
/>
```

**Step 4 — Implement `skipBoot`** in the hook:

```typescript
const skipBoot = useCallback(() => {
  setBootState("ready");
  setActiveSection("setup");
}, []);
```

**Files to modify:**
- `renderer/src/state/useCanonkeeperApp.ts` — timeout logic, `skipBoot` callback
- `renderer/src/App.tsx` — skip button, sidebar disabled during boot
- `renderer/src/components/Sidebar.tsx` — accept and apply `disabled` prop

**Acceptance criteria:**
- Boot spinner shows "Skip and start fresh" link after brief display
- After 15 seconds, boot auto-fails to restore-failed state with a clear message
- Sidebar is non-interactive during boot
- Clicking "Skip" immediately routes to Setup
- Normal boot (< 15s) still works exactly as before

---

### M-6: First-Time User Onboarding

**Problem:** First-time users land on Setup with no context about what CanonKeeper does, what data it produces, or what to expect after setup. Post-setup, there is no guided tour.

**Proposed solution:** Two-phase onboarding: a welcome modal on first launch and a post-setup orientation.

**Phase 1 — Welcome modal:**

**Step 1 — Add `hasSeenWelcome` flag** to the session persistence envelope (`state/persistence.ts`):

```typescript
interface SessionEnvelope {
  // ... existing fields
  hasSeenWelcome?: boolean;
}
```

**Step 2 — Create `renderer/src/components/WelcomeModal.tsx`:**

Content:
- Heading: "Welcome to CanonKeeper"
- 3 bullet points explaining what the app does:
  - "Reads your manuscript and builds a scene-by-scene index"
  - "Tracks characters, locations, and facts across your story"
  - "Flags continuity issues and style patterns to review"
- Primary CTA: "Get Started" (routes to Setup, sets `hasSeenWelcome: true`)
- Secondary link: "Skip" (sets flag, closes modal)

**Step 3 — Show on first launch** in `App.tsx` when `!envelope.hasSeenWelcome && bootState === "ready"`.

**Phase 2 — Post-setup orientation:**

**Step 4 — After first successful ingest begins**, show a brief "What's Happening" overlay or inline banner on the Dashboard:
- "CanonKeeper is reading your manuscript, finding scenes, analyzing your writing style, and extracting characters and locations."
- "This usually takes a few minutes. Results will appear in each section as they're ready."

**Step 5 — Add `hasSeenPostSetup` flag** to the persistence envelope. Show the orientation once per project.

**Files to modify:**
- `renderer/src/state/persistence.ts` — add flags to envelope
- `renderer/src/components/WelcomeModal.tsx` — new component
- `renderer/src/App.tsx` — render modal conditionally
- `renderer/src/views/DashboardView.tsx` — post-setup orientation banner

**Acceptance criteria:**
- First launch shows welcome modal with clear explanation
- Modal never appears again after dismissal
- After first ingest begins, orientation message explains what's happening
- Orientation appears once per project, not on every visit
- Both can be skipped without friction

**Dependency:** Benefits from M-3 (progress banner) being implemented first, since the post-setup orientation can reference the progress banner.

---

## P2 — Data Surfacing & Minor UX

### m-4: Replace Synthetic Confidence with Real Values

**Problem:** The Scenes table confidence column (`ScenesView.tsx:125`) displays hardcoded `"low"` or `"medium"` based on `pov_mode`. The actual `pov_confidence` float (0-1) exists on `SceneMetadataRow` but is never sent to the renderer.

**Proposed solution:**

**Step 1 — Expose `pov_confidence`** in the RPC response for `scenes.list`. The `SceneMetadataRow` type already has `pov_confidence: number` (0-1). Ensure the `SceneSummary` type returned to the renderer includes this field.

**Step 2 — Update ScenesView** to display the real value:

```typescript
// Map 0-1 float to human-readable label
const confidenceLabel = (value: number): string => {
  if (value >= 0.8) return "high";
  if (value >= 0.5) return "medium";
  return "low";
};
```

Optionally show the percentage on hover: `title={`${Math.round(scene.pov_confidence * 100)}%`}`.

**Files to modify:**
- `electron/worker/rpc.ts` or relevant DAO — include `pov_confidence` in scene list response
- `packages/shared/types/persisted.ts` or IPC types — add `pov_confidence` to `SceneSummary`
- `renderer/src/views/ScenesView.tsx` — use real confidence value

**Acceptance criteria:**
- Confidence column shows "low" / "medium" / "high" based on real 0-1 values
- Tooltip shows exact percentage
- No hardcoded confidence values remain

---

### m-5: Display Issue Timestamps

**Problem:** `created_at` exists on `IssueRow` (as `UnixMillis`) and is used for sorting, but is never rendered in the UI.

**Proposed solution:** Add a relative timestamp to each issue card.

**Step 1 — Create a `relativeTime` utility** (or add to existing utils):

```typescript
function relativeTime(unixMs: number): string {
  const seconds = Math.floor((Date.now() - unixMs) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(unixMs).toLocaleDateString();
}
```

**Step 2 — Add timestamp to issue cards** in `IssuesView.tsx`, in the card metadata area:

```tsx
<span className="text-xs text-text-muted">Found {relativeTime(issue.created_at)}</span>
```

**Files to modify:**
- `renderer/src/views/IssuesView.tsx` — add timestamp display
- Optionally create `renderer/src/utils/relativeTime.ts` if reusable elsewhere

**Acceptance criteria:**
- Each issue card shows when it was detected
- Recent issues show relative time ("5m ago"), older issues show absolute date
- Timestamp updates on view refresh (not live-ticking)

---

### m-8: Repetition Table "Show More"

**Problem:** `StyleView.tsx` renders `entries.slice(0, 20)` with no indication that results are truncated. Writers see 20 rows and may believe that's all.

**Proposed solution:** Add a "Show more" toggle and a count indicator.

**Step 1 — Add expand state:**

```typescript
const [showAllRepetitions, setShowAllRepetitions] = useState(false);
const visibleEntries = showAllRepetitions ? entries : entries.slice(0, 20);
```

**Step 2 — Add count and toggle below the table:**

```tsx
{entries.length > 20 && !showAllRepetitions ? (
  <button onClick={() => setShowAllRepetitions(true)}>
    Showing 20 of {entries.length} phrases. Show all
  </button>
) : null}
{showAllRepetitions && entries.length > 20 ? (
  <button onClick={() => setShowAllRepetitions(false)}>
    Show fewer
  </button>
) : null}
```

**Files to modify:**
- `renderer/src/views/StyleView.tsx` — expand state, count text, toggle button

**Acceptance criteria:**
- When > 20 phrases exist, "Showing 20 of N phrases. Show all" appears below the table
- Clicking "Show all" reveals the full list
- "Show fewer" collapses back to 20
- When <= 20 phrases exist, no toggle appears

---

### m-6: Error Queue (Multiple Simultaneous Errors)

**Problem:** Only one `UserFacingError` can exist at a time (`useCanonkeeperApp.ts:268`). Each action calls `clearError()` before starting. If a second error occurs before the first is read, the first is silently replaced.

**Proposed solution:** Replace the singular error with an error queue.

**Step 1 — Change error state:**

```typescript
// Before
const [error, setError] = useState<UserFacingError | null>(null);

// After
const [errors, setErrors] = useState<UserFacingError[]>([]);
```

**Step 2 — Update `setAppError`** to append instead of replace:

```typescript
const setAppError = useCallback((code: string, err: unknown, actionLabel?: string, action?: string) => {
  setErrors((current) => [...current, toUserFacingError(code, err, actionLabel, action)]);
}, []);
```

**Step 3 — Update `clearError`** to dismiss a specific error by index or id:

```typescript
const dismissError = useCallback((id: string) => {
  setErrors((current) => current.filter((e) => e.id !== id));
}, []);
```

Add an `id` field to `UserFacingError` (generated in `toUserFacingError`).

**Step 4 — Update `InlineError` rendering in `App.tsx`** to render a stack of errors:

```tsx
{errors.map((err) => (
  <InlineError key={err.id} error={err} onDismiss={() => dismissError(err.id)} />
))}
```

**Step 5 — Remove `clearError()` calls** from the beginning of each action function. Errors should persist until explicitly dismissed.

**Files to modify:**
- `renderer/src/state/useCanonkeeperApp.ts` — error array, remove pre-action clearError calls
- `renderer/src/api/ipc.ts` — add `id` to `UserFacingError` type
- `renderer/src/components/InlineError.tsx` — ensure dismiss works per-error
- `renderer/src/App.tsx` — render error list

**Acceptance criteria:**
- Multiple errors can be displayed simultaneously
- Each error has its own dismiss button
- New errors don't replace existing ones
- Errors don't auto-dismiss (they persist until the writer dismisses them)
- No more than 5 errors visible at once (oldest auto-dismissed if exceeded)

---

### m-9: Issue Resolve Confirmation

**Problem:** "Dismiss" opens a confirmation modal requiring a reason. "Resolve" fires immediately with no confirmation — only an undo toast. The interaction model is inconsistent.

**Proposed solution:** This is a judgment call. Two valid approaches:

**Option A — Add a lightweight confirmation** (recommended):
Show a brief inline confirmation below the button: "Mark this issue as resolved?" with Confirm/Cancel. This is lighter than the full ConfirmModal used for Dismiss (which requires a reason input) but still prevents accidental clicks.

**Option B — Keep as-is with better undo visibility:**
The existing undo toast (10s window) is a valid safety net. If choosing this option, improve the undo toast visibility: make it persist longer (15s) and add a more prominent visual treatment.

**Files to modify (Option A):**
- `renderer/src/views/IssuesView.tsx` — add inline confirm state per issue
- Alternatively, use a simple `window.confirm()` for minimal code change

**Acceptance criteria (Option A):**
- Clicking Resolve shows a brief confirmation prompt
- Confirming resolves the issue and shows the undo toast
- Canceling returns to the default state
- The undo toast still works as a secondary safety net

---

## P3 — Cosmetic Polish

### c-1: Section Switch Animation

**Problem:** `App.tsx:140` wraps all view content in `<div className="animate-fade-in">`. The animation runs once on mount but never re-triggers on section switches because the `<div>` is never unmounted/remounted.

**Current behavior:** The `animate-fade-in` class is effectively a no-op after initial page load. Section switches are instant with no transition.

**Proposed solution:** Add a `key` prop tied to `activeSection` to force remount:

```tsx
<div key={app.activeSection} className="animate-fade-in">
```

This re-triggers the 200ms fade-in on every section switch. If this feels sluggish during rapid `[`/`]` navigation, consider:
- Reducing duration to 100ms
- Using `animate-fade-in` only on first mount and a faster `animate-quick-fade` (50ms) on subsequent switches
- Removing the animation entirely

**Files to modify:**
- `renderer/src/App.tsx` — add `key` prop

**Acceptance criteria:**
- Section switches have a subtle fade-in transition
- Rapid switching (keyboard shortcuts) doesn't feel sluggish
- Animation duration is 100-200ms

---

### c-2: Collapsed Sidebar Brand Tooltip

**Problem:** When the sidebar collapses to icon-only mode, the brand shows "CK" but the "Editorial Workstation" subtitle is lost. No tooltip compensates.

**Proposed solution:** Add a `title` attribute to the collapsed brand element.

```tsx
{collapsed ? (
  <span className="..." title="CanonKeeper — Editorial Workstation">CK</span>
) : (
  // existing full brand
)}
```

**Files to modify:**
- `renderer/src/components/Sidebar.tsx` — add title to collapsed brand

**Acceptance criteria:**
- Hovering over "CK" in collapsed mode shows "CanonKeeper — Editorial Workstation" tooltip

---

### c-3: Badge Counts on Sidebar

**Problem:** Sidebar shows no counts or badges. Writers can't see "3 open issues" or "12 scenes" at a glance.

**Available data:** `projectStats` exists in `useCanonkeeperApp.ts` with scene count, issue count, entity count. It is not passed to the sidebar.

**Proposed solution:**

**Step 1 — Add `badges` prop to Sidebar:**

```typescript
type SidebarProps = {
  // ... existing
  badges?: Partial<Record<AppSection, number | "loading">>;
};
```

**Step 2 — Pass badge data from App.tsx:**

```typescript
const sidebarBadges = useMemo(() => ({
  scenes: scenesLoaded ? scenes.length : "loading",
  issues: issuesLoaded ? issues.filter(i => i.status === "open").length : "loading",
  bible: entitiesLoaded ? entities.length : "loading",
}), [scenes, issues, entities, scenesLoaded, issuesLoaded, entitiesLoaded]);
```

**Step 3 — Render badges** next to section labels (or as small dots in collapsed mode):

```tsx
{badge !== undefined ? (
  badge === "loading"
    ? <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
    : <span className="rounded-full bg-accent-soft px-1.5 text-xs text-accent">{badge}</span>
) : null}
```

**Dependency:** Benefits from M-4 (skeleton loading) being implemented first, since the `loaded` flags determine whether to show a count or a loading dot.

**Files to modify:**
- `renderer/src/components/Sidebar.tsx` — accept and render badges
- `renderer/src/App.tsx` — compute and pass badge data

**Acceptance criteria:**
- Scenes, Issues, Characters & World show numeric badges when data is loaded
- Issues badge shows only open (unresolved) count
- During processing, badges show a pulsing dot instead of a count
- Collapsed mode shows badges as small dots or overlays
- Sections without data show no badge (not "0")
