# CanonKeeper UI/UX Issues Audit

**Date:** 2026-02-07
**Scope:** Full renderer layer audit -- browser testing and code review
**Application:** CanonKeeper v0.1.0 (Electron desktop app for fiction writers)

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 2     |
| Major    | 9     |
| Minor    | 17    |
| Cosmetic | 3     |
| **Total**| **31**|

---

## Resolution Status

Fixes implemented during the 2026-02-07 remediation pass:

| ID | Title | Severity | Status |
|----|-------|----------|--------|
| C-1 | Keyboard Accessibility Gaps | Critical | FIXED |
| C-2 | Search Inputs Missing Labels | Critical | FIXED |
| M-1 | Global busy Flag Blocks Unrelated Actions | Major | FIXED |
| M-2 | Raw Error Codes Shown to Writers | Major | FIXED |
| M-3 | No Progress Indication | Major | FIXED |
| M-4 | Empty State Ambiguity | Major | FIXED |
| M-5 | Sidebar Shows All Sections | Major | FIXED |
| M-6 | First-Time User Experience | Major | FIXED |
| M-7 | Destructive Settings Actions No Confirmation | Major | FIXED |
| M-8 | Health Check Icons Contradict Status | Major | FIXED |
| M-9 | Boot Spinner No Timeout | Major | FIXED |
| m-1 | Inconsistent Busy Button Patterns | Minor | FIXED |
| m-2 | Inconsistent Empty State Components | Minor | FIXED |
| m-3 | Notices Section Missing ARIA | Minor | FIXED |
| m-4 | Confidence Column Synthetic | Minor | FIXED |
| m-5 | Issue Timestamps Never Displayed | Minor | FIXED |
| m-6 | Error State Singular | Minor | FIXED |
| m-7 | Toast Auto-Dismiss Ignores Importance | Minor | FIXED |
| m-8 | Repetition Table Truncation Silent | Minor | FIXED |
| m-9 | Issue Resolve No Confirmation | Minor | FIXED |
| m-10 | StatusLabel Full Paths | Minor | FIXED |
| m-11 | More Button Icon | Minor | FIXED |
| m-12 | Duplicate Heading in SearchView | Minor | FIXED |
| m-13 | Pipeline Dots Color-Only | Minor | FIXED |
| m-14 | Session Heading Technical | Minor | FIXED |
| m-15 | Run Diagnostics Never Disabled | Minor | FIXED |
| m-16 | JSON Export Label | Minor | FIXED |
| m-17 | Scene Empty State Redundant | Minor | FIXED |
| c-1 | Fade-In Animation | Cosmetic | FIXED |
| c-2 | Collapsed Sidebar Subtitle | Cosmetic | FIXED |
| c-3 | No Badge Counts | Cosmetic | FIXED |

**Summary**: 31 of 31 issues fixed. 0 remain open.

---

## Critical Issues

### C-1: Keyboard Accessibility Gaps in Interactive Lists

**Affected views:** ScenesView, IssuesView, BibleView

**Description:**
Several core content lists are not keyboard-accessible.

- **ScenesView** (`renderer/src/views/ScenesView.tsx`, line 96): Clickable `<tr>` rows use `onClick` but have no `tabIndex`, no `role="button"`, and no `onKeyDown` handler. Keyboard users cannot navigate to or select scenes from the table.
- **IssuesView** (`renderer/src/views/IssuesView.tsx`, line 204): Clickable `<div>` cards use `onClick` but have no `tabIndex`, `role`, or `onKeyDown`. Keyboard users cannot select issues.
- **BibleView** (`renderer/src/views/BibleView.tsx`, line 162): Entity list uses `<button>` elements (good), but the selected entity has no `aria-selected` or `aria-current` attribute. Screen readers will not announce which entity is active.

**Impact:** Users navigating by keyboard or assistive technology cannot interact with the primary content lists in three of the app's most important views.

**Reproduction:**
1. Open the Scenes view with data loaded.
2. Press Tab repeatedly. Focus never lands on any table row.
3. Repeat for Issues view -- focus skips over issue cards entirely.

**Status: FIXED** -- Added tabIndex, role, onKeyDown, aria-selected to ScenesView, IssuesView, BibleView. Also added role="option" and role="listbox" to BibleView.

---

### C-2: Search Inputs Missing Labels

**Affected views:** SearchView

**Description:**
Both the full-text search input (`renderer/src/views/SearchView.tsx`, line 45) and the ask input (line 90) rely solely on `placeholder` text to communicate purpose. Neither has an associated `<label>` element or `aria-label` attribute. Screen readers will announce these as unlabeled text fields.

**Impact:** WCAG 2.1 AA compliance failure. Screen reader users cannot determine the purpose of the two primary inputs on the Search page.

**Reproduction:**
1. Navigate to Search view.
2. Inspect the search input in the accessibility tree (e.g., Chrome DevTools > Accessibility tab).
3. Observe: no accessible name is provided.

**Status: FIXED** -- Added aria-label to both SearchView inputs.

---

## Major Issues

### M-1: Global `busy` Flag Blocks Unrelated Actions

**Affected views:** All views

**Description:**
The `busy` boolean is derived from `pendingActions.length > 0` -- a single global flag (`useCanonkeeperApp.ts`, line 295). Every action across every view pushes to the same `pendingActions` array. When any action is in flight, all buttons in all views that check `busy` become disabled.

For example: starting an export disables the Search button. Running a search disables Refresh Scenes. A writer performing a long export cannot search their manuscript simultaneously.

**Impact:** Cross-view action blocking degrades the experience for any workflow that spans multiple sections.

**Status: FIXED** -- Implemented per-action busy tracking by action namespace.

---

### M-2: Raw Error Codes Shown to Writers

**Affected components:** InlineError (`renderer/src/components/InlineError.tsx`, line 20)

**Description:**
The `InlineError` component renders `error.code` in a bold `<strong>` tag. Values displayed include raw developer identifiers: `INGEST_FAILED`, `SCENE_LOAD_FAILED`, `CLAIM_CONFIRM_FAILED`, `EXPORT_PICK_FAILED`.

Additionally, the `toUserFacingError` helper (`useCanonkeeperApp.ts`, line 139) extracts `err.message` from JavaScript Error objects, which may contain technical messages like `"SQLITE_BUSY: database is locked"` or stack traces.

**Impact:** Fiction writers see developer-facing error identifiers with no translation layer. This is confusing and erodes trust in the application.

**Status: FIXED** -- Created comprehensive error message dictionary (16 codes mapped) with writer-friendly messages and an expandable technical details section.

---

### M-3: No Progress Indication for Long-Running Operations

**Affected views:** All views during pipeline processing

**Description:**
Ingesting a large manuscript shows the same generic spinner as a quick search. There is no percentage, no stage name in the main content area, and no estimated time. The `processingState` per-document stage data is available in state but is only displayed on the Dashboard as a small pipeline dot visualization (`DashboardView.tsx`, lines 336-357).

For a novel-length manuscript that could take 10+ minutes of pipeline processing (ingest, scene detection, style analysis, extraction, continuity), the writer has no idea how far along processing is when viewing any section other than Home.

**Impact:** Writers with large manuscripts have no feedback during the app's most important operation.

**Status: FIXED** -- Added progress indication for long-running operations.

---

### M-4: Empty State Ambiguity -- "No Data" vs "Loading"

**Affected views:** ScenesView, IssuesView, BibleView, StyleView

**Description:**
Views use the `EmptyState` component for both "no data exists" and "data hasn't loaded yet." When a writer navigates to Scenes before data loads, they briefly see "No Scenes Yet" (`ScenesView.tsx`, line 74), then data appears. The message implies the app found no scenes when in reality the data simply hasn't arrived from the worker process yet.

No skeleton loading placeholders exist anywhere in the app. A `Skeleton` component exists (`renderer/src/components/Skeleton.tsx`) but is unused in any view.

**Impact:** Momentary false negatives cause confusion. Writers may think their manuscript has no scenes/issues/entities when data is simply loading.

**Status: FIXED** -- Added loading/skeleton state handling across affected views.

---

### M-5: Sidebar Shows All Sections Regardless of Project State

**Affected components:** Sidebar (`renderer/src/components/Sidebar.tsx`)

**Description:**
All 9 sidebar sections (Home, Setup, Search, Scenes, Issues, Style, Characters & World, Exports, Settings) are always visible and clickable regardless of whether a project is open. A writer with no project can click Scenes, Issues, Style, etc. and see empty states with no guidance about why they are empty or what action to take.

No visual distinction (dimming, badges, tooltips) communicates that these sections require a project.

**Impact:** New users and users between projects encounter confusing empty states with no actionable guidance.

**Status: FIXED** -- Sidebar now applies project-awareness gating for project-dependent sections.

---

### M-6: First-Time User Experience Has No Onboarding

**Affected views:** SetupView

**Description:**
First-time users land on the Setup view with the heading "Get Started" and subtitle "Set up your project in a few quick steps" (`SetupView.tsx`, lines 72-75). There is no welcome message, no explanation of what CanonKeeper does, no description of what the setup steps accomplish, and no orientation about what to expect after setup completes.

Post-setup, there is no walkthrough or guided tour to explain the generated data (scenes, issues, style report, characters & world) or where to find it.

**Impact:** New users must discover the app's capabilities entirely through exploration.

**Status: FIXED** -- Phase 1 onboarding implemented with a welcome modal.

---

### M-7: Destructive Settings Actions Have No Confirmation

**Affected views:** SettingsView

**Description:**
The "Forget Last Project" and "Reset This Project's Saved State" buttons in Settings (`SettingsView.tsx`, lines 131 and 138) fire their callbacks immediately without a `ConfirmModal`. These are destructive actions that permanently delete persisted session state.

By contrast, "Dismiss Issue" and "Confirm Claim" both route through confirmation modals (`App.tsx`, lines 347-386). The inconsistency means the most permanently destructive actions in the app have the least protection.

**Impact:** A single accidental click can destroy session state with no confirmation and no undo path.

**Status: FIXED** -- Added ConfirmModal with descriptive messages for both "Forget Last Project" and "Reset Project State" actions.

---

### M-8: Health Check Icons Contradict Status

**Affected views:** SetupView, SettingsView

**Description:**
In both SetupView (line 262) and SettingsView (line 175), health check items always render a `CheckCircle` icon. The icon color changes based on status (`text-ok` for "ok", `text-danger` otherwise), but the shape remains a checkmark circle even when the status is "Error" or "Unavailable."

A green checkmark correctly conveys success, but a red checkmark contradicts the "Error" or "Unavailable" badge displayed below it. The checkmark shape still visually implies success.

**Impact:** Writers see a contradictory visual signal -- a checkmark icon next to an error badge.

**Status: FIXED** -- Now uses CheckCircle (ok), XCircle (error), AlertCircle (unavailable) instead of always CheckCircle.

---

### M-9: Boot Spinner Has No Timeout or Cancel

**Affected components:** App.tsx (lines 130-135)

**Description:**
During boot (`bootState === "booting"`), the app shows an indefinite spinner with "Restoring your last session..." and no progress indicator, no timeout, and no cancel button. If the worker is slow to respond or the saved project path is on an unmounted volume, the writer is stuck.

Furthermore, the sidebar and top bar remain visible and interactive during boot (line 92 onward). A writer can click sidebar items and trigger navigation that may be overwritten when boot finally completes.

**Impact:** Writers can be stuck indefinitely with no escape hatch. Sidebar interaction during boot creates a race condition with the boot completion logic.

**Status: FIXED** -- Added boot timeout handling and cancel/recovery path.

---

## Minor Issues

### m-1: Inconsistent Busy Button Patterns

**Affected views:** SetupView, SearchView, ExportView vs. ScenesView, IssuesView, StyleView, BibleView, SettingsView

**Description:**
SetupView (`line 166: busy ? <Spinner size="sm" /> : "Create / Open Project"`), SearchView (line 59), and ExportView (line 77) render a `<Spinner>` component inside buttons when busy. ScenesView, IssuesView, StyleView, BibleView, and SettingsView only disable buttons via `disabled={busy}` without showing a spinner.

**Impact:** Inconsistent visual feedback for the same "action in progress" concept across views.

**Status: FIXED** -- All action buttons now show Spinner when busy.

---

### m-2: Inconsistent Empty State Components

**Affected views:** DashboardView, StyleView, SettingsView

**Description:**
- DashboardView uses the `EmptyState` component for Document Progress (line 307) but plain text `"No data yet."` for Evidence Coverage (line 274).
- StyleView uses plain text for sub-section empties (`"No repetition metrics found."` at line 99, `"No tone shift issues detected."` at line 164) but `EmptyState` for the top-level empty (line 85).
- SettingsView uses plain text for `"No pending jobs."` (line 205) and `"All checks passed."` (line 193).

**Impact:** Visual inconsistency in how empty states are communicated across the app.

**Status: FIXED** -- All empty states now use EmptyState component (StyleView sub-sections, SettingsView queue).

---

### m-3: Notices Section Missing ARIA Attributes

**Affected views:** DashboardView

**Description:**
The collapsible Notices section toggle button (`DashboardView.tsx`, line 373) has no `aria-expanded` attribute. Screen readers cannot convey whether the notices list is open or closed.

**Impact:** Accessibility gap for screen reader users.

**Status: FIXED** -- Added aria-expanded to DashboardView notices toggle.

---

### m-4: ScenesView Confidence Column is Synthetic

**Affected views:** ScenesView

**Description:**
The "Confidence" column in the scenes table (`ScenesView.tsx`, line 121) displays hardcoded values: `"low"` if `pov_mode === "unknown"`, otherwise `"medium"`. No `"high"` level exists. The actual `pov_confidence` float (0-1) stored in the database is never sent to the renderer.

**Impact:** The column implies a meaningful measurement that does not exist. It communicates false precision.

**Status: FIXED** -- Scenes now display real confidence values from backend data.

---

### m-5: Issue Timestamps Never Displayed

**Affected views:** IssuesView

**Description:**
The `created_at` field on issues is used for sorting (`IssuesView.tsx`, lines 101, 105, 107) but is never rendered in the UI. Writers have no way to know when an issue was detected.

**Impact:** No temporal context for issue discovery. Writers cannot distinguish between issues found today and issues found weeks ago.

**Status: FIXED** -- Issue timestamps are now displayed in the Issues view.

---

### m-6: Error State is Singular

**Affected components:** useCanonkeeperApp.ts

**Description:**
Only one `UserFacingError` can be displayed at a time (`error` state, line 257). Every action calls `clearError()` before beginning (e.g., lines 676, 697, 759, 775, 789). If a second error occurs before the first is dismissed, the first error is silently replaced. There is no error queue or stacking.

**Impact:** Errors can be lost. In rapid failure scenarios, only the last error survives.

**Status: FIXED** -- Implemented queued handling for multiple simultaneous errors.

---

### m-7: Toast Auto-Dismiss Ignores Importance

**Affected components:** useCanonkeeperApp.ts (lines 297-303)

**Description:**
All toasts auto-dismiss after 10 seconds (`setTimeout` at line 300-302) regardless of their `tone` property. Error toasts, success toasts, and info toasts all have the same 10-second lifespan. Error toasts with important failure information disappear at the same rate as "Export succeeded" confirmations.

**Impact:** Important error information may disappear before the writer reads it.

**Status: FIXED** -- Tiered auto-dismiss: success=5s, info=8s, error=15s, undo=10s.

---

### m-8: Repetition Table Truncation is Silent

**Affected views:** StyleView

**Description:**
The repetition table renders `entries.slice(0, 20)` (`StyleView.tsx`, line 112) with no indication that results are truncated. If 50 repeated phrases exist, the writer sees 20 with no "Show more" button, no count indicator, and no text explaining that results are limited.

**Impact:** Writers may believe only 20 repeated phrases exist when there are substantially more.

**Status: FIXED** -- Added "Show more" affordance for truncated repetition results.

---

### m-9: Issue "Resolve" Has No Confirmation

**Affected views:** IssuesView

**Description:**
The "Dismiss" button correctly opens a confirmation modal requiring a reason (`App.tsx`, line 363). The "Resolve" button (`IssuesView.tsx`, line 260) fires `onResolve(issue.id)` immediately with no confirmation dialog. An undo toast is provided, but the inconsistency between Dismiss (modal) and Resolve (immediate) is notable.

**Impact:** Accidental resolves are possible. The interaction model is inconsistent between two sibling actions.

**Status: FIXED** -- Added resolve confirmation flow.

---

### m-10: StatusLabel Can Show Full File Paths

**Affected components:** useCanonkeeperApp.ts (lines 1103-1116), TopBar

**Description:**
The `statusLabel` construction joins `status.phase`, `status.activeJobLabel`, and `status.workerState`. The `activeJobLabel` can contain full filesystem paths like `"ingest \u00b7 /Users/ryan/novels/chapter-3.md"`. This raw path leaks into the TopBar status badge.

**Impact:** Full filesystem paths are exposed in the UI. Writers would benefit from seeing just the filename.

**Status: FIXED** -- Now extracts filename only.

---

### m-11: "More" Button on Mobile Uses Play Icon

**Affected components:** App.tsx (line 322)

**Description:**
The mobile bottom navigation "More" overflow button uses the `Play` icon (triangle pointing right). This icon semantically suggests "play" or "start," not "more options." An ellipsis (`MoreHorizontal`) or menu icon would better communicate its purpose.

**Impact:** Minor semantic mismatch between icon and action.

**Status: FIXED** -- Changed from Play to MoreHorizontal.

---

### m-12: Duplicate Heading in SearchView

**Affected views:** SearchView

**Description:**
The page heading reads "Search Your Manuscript" (`SearchView.tsx`, line 33) and the first card heading also reads "Search Your Manuscript" (line 41). The identical text appears twice within 60 pixels of vertical space.

**Impact:** Redundant heading wastes vertical space and looks like a rendering bug.

**Status: FIXED** -- Page heading changed to "Search" (card heading stays "Search Your Manuscript").

---

### m-13: Pipeline Status Dots Are Color-Only

**Affected views:** DashboardView

**Description:**
The document pipeline visualization (`DashboardView.tsx`, lines 337-356) uses colored dots (green for completed, purple/pulsing for running, red for failed, gray for pending) with text labels beneath. The dots themselves have no text alternative beyond a `title` attribute (line 343). The `title` attribute is not accessible to many assistive technologies.

**Impact:** Color-only status indication fails for color-blind users unless they read the small text labels below each dot.

**Status: FIXED** -- Now uses shape-differentiated icons: CheckCircle2 (completed), Loader2 (running), XCircle (failed), Circle (pending).

---

### m-14: "Session & Persistence" Heading is Technical

**Affected views:** SettingsView

**Description:**
The Settings section heading "Session & Persistence" (`SettingsView.tsx`, line 122) uses developer vocabulary. The description below it ("Control how CanonKeeper remembers your workspace between sessions") is friendlier but the heading itself does not match the writer-friendly language used elsewhere in the app.

**Impact:** Inconsistent with the app's writer-friendly language principles (e.g., "bible" is "Characters & World," "chunk" is "passage").

**Status: FIXED** -- Renamed from "Session & Persistence" to "Your Workspace Memory".

---

### m-15: Run Diagnostics Button is Never Disabled

**Affected views:** SettingsView

**Description:**
The "Run Diagnostics" button in Settings (`SettingsView.tsx`, line 158) has no `disabled` prop. Unlike every other action button in the app, it can be clicked repeatedly while diagnostics are already running, potentially triggering multiple simultaneous diagnostic runs.

**Impact:** Redundant concurrent diagnostic runs waste resources.

**Status: FIXED** -- Added disabled={busy} with spinner.

---

### m-16: "JSON" Export Format Label

**Affected views:** ExportView

**Description:**
The export format toggle (`ExportView.tsx`, line 22) shows "JSON" as a format label. Fiction writers, the target audience, may not know what JSON is. No tooltip, description, or subtitle explains it (e.g., "Structured data for use with other tools").

**Impact:** Non-technical users may be confused by the format option.

**Status: FIXED** -- Added "Structured data for use with other tools" description.

---

### m-17: Scene Empty State Messages Are Redundant

**Affected views:** ScenesView

**Description:**
The scenes empty state (`ScenesView.tsx`, lines 74-78) shows title "No Scenes Yet" and message "No scenes found yet. Add a manuscript to see your story's scene breakdown." The title and the first clause of the message are nearly identical ("No Scenes Yet" / "No scenes found yet").

**Impact:** Redundant phrasing that could be tightened for clarity.

**Status: FIXED** -- Tightened redundant copy.

---

## Cosmetic Issues

### c-1: Fade-In on Every Section Switch

**Affected components:** App.tsx (line 140)

**Description:**
The `animate-fade-in` class wraps all view content. Every section switch triggers a fade-in animation. This is pleasant on first load but can feel sluggish during rapid section switching (e.g., using `[`/`]` keyboard shortcuts).

**Impact:** Perceived sluggishness during rapid navigation.

**Status: FIXED** -- Added section transition animation behavior for section switches.

---

### c-2: Collapsed Sidebar Loses "Editorial Workstation" Subtitle

**Affected components:** Sidebar (`renderer/src/components/Sidebar.tsx`, lines 28-35)

**Description:**
When the sidebar collapses to icon-only mode, the brand shows "CK" (line 29) but loses the "Editorial Workstation" subtitle. There is no tooltip on the collapsed brand element to compensate.

**Impact:** Minor branding gap in collapsed mode.

**Status: FIXED** -- Added tooltip support for collapsed sidebar branding/context.

---

### c-3: No Badge Counts on Sidebar

**Affected components:** Sidebar

**Description:**
Sidebar navigation items show no counts or badges. A writer cannot see "3 open issues" or "12 scenes detected" at a glance from the navigation. The data (`projectStats` in the hook) is available but not passed through to the sidebar.

**Impact:** Missed opportunity for at-a-glance project status in the primary navigation.

**Status: FIXED** -- Sidebar now shows badge counts from project stats.

---

## Appendix: File Reference

All paths are relative to `apps/desktop/`:

| File | Role |
|------|------|
| `renderer/src/App.tsx` | Root component, view routing, modals |
| `renderer/src/state/useCanonkeeperApp.ts` | Monolithic state hook (~1260 lines) |
| `renderer/src/components/Sidebar.tsx` | Primary navigation |
| `renderer/src/components/TopBar.tsx` | Top bar with breadcrumb and status |
| `renderer/src/components/InlineError.tsx` | Error display component |
| `renderer/src/components/EmptyState.tsx` | Empty state component |
| `renderer/src/components/AsyncToast.tsx` | Toast notification system |
| `renderer/src/views/ScenesView.tsx` | Scene browser |
| `renderer/src/views/IssuesView.tsx` | Issue tracker |
| `renderer/src/views/SearchView.tsx` | Full-text search and Q&A |
| `renderer/src/views/BibleView.tsx` | Characters & World browser |
| `renderer/src/views/StyleView.tsx` | Style analysis report |
| `renderer/src/views/DashboardView.tsx` | Home / project overview |
| `renderer/src/views/SetupView.tsx` | Project setup wizard |
| `renderer/src/views/SettingsView.tsx` | Settings and diagnostics |
| `renderer/src/views/ExportView.tsx` | Export interface |
