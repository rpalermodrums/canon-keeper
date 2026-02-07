# CanonKeeper UI/UX Improvement Plan

## Methodology

This document is the product of a combined evaluation approach:

1. **Code review** of the renderer layer (React components, state management, IPC surface) and the worker/storage layer (to identify stored-but-unsurfaced data).
2. **Browser testing** of the running application across first-run, active-project, and returning-user scenarios.
3. **Heuristic evaluation** against Nielsen Norman Group's 10 Usability Heuristics and WCAG 2.1 AA accessibility guidelines.

References to "NN/g" throughout cite published research from the Nielsen Norman Group (nngroup.com).

## Target User Persona

The target user is a **non-technical fiction writer** who:

- Sets up CanonKeeper once per project (or infrequently)
- Lets it run in the background against a manuscript folder
- Checks it when reviewing their work, looking something up, or hunting for continuity issues
- Is not comfortable with developer tooling, API keys, or technical jargon
- Expects the app to behave like a trustworthy research assistant, not a code editor

The real value proposition is that CanonKeeper runs silently and becomes a **trusted source of truth** for a long manuscript. Every UI decision should reinforce that trust.

---

## Theme 1: First-Run Onboarding and Progressive Disclosure

First impressions define whether a tool gets adopted or abandoned. NN/g research on progressive disclosure shows that new users need orientation before action, and that exposing every feature at once increases cognitive load without adding value.

### S-1: Welcome Screen for First-Time Users

**Priority**: High Impact
**Rationale**: NN/g's "Progressive Disclosure" principle holds that first-time users need orientation before action. Currently, a first-time user lands on the Setup view with no context about what CanonKeeper does, what data it produces, or what to expect. This is a cold start that risks immediate abandonment.

**Suggestion**: Add a one-time welcome overlay or modal triggered on first launch:

- A brief (3-bullet) explanation of what CanonKeeper does: reads your manuscript, builds a scene index, tracks characters and facts, and flags continuity issues.
- A visual preview of what the writer will get: small screenshots or illustrations of the Scenes, Characters & World, and Issues views populated with data.
- A single primary call-to-action: "Let's Get Started" that routes to Setup.
- A secondary "Skip" link for returning users or those who already understand the tool.
- Persist a `hasSeenWelcome` flag in the session persistence envelope so the modal never appears again.

### S-2: Post-Setup Guided Tour

**Priority**: High Impact
**Rationale**: After setup completes and the first manuscript starts processing, the writer has nothing to do and no idea what to expect. They cannot tell what data will appear, where to find it, or how long to wait. This dead zone is the highest-risk moment for user drop-off.

**Suggestion**: After the first successful ingest begins:

- Show a brief "What's Happening Now" overlay explaining the pipeline stages in plain language: "CanonKeeper is reading your manuscript, finding scenes, analyzing your writing style, and extracting characters and locations."
- Include a "while you wait" message: "This usually takes a few minutes. You'll see results appear in each section as they're ready."
- Add contextual tooltip callouts on sidebar items as data lands: "Scenes will appear here once analysis is complete."
- Optionally, surface a progress dashboard (see S-6) that shows each pipeline stage completing in real time, giving the writer a sense of forward motion.

### S-3: Hide or Collapse Empty Sections

**Priority**: High Impact
**Rationale**: NN/g's "Minimize Cognitive Load" heuristic says interfaces should not show UI elements that are not actionable. Currently, all 9 sidebar sections (Home, Setup, Search, Scenes, Issues, Style, Characters & World, Exports, Settings) are always visible and clickable, even before a project is opened. Clicking into an empty section with no guidance is a dead end that erodes trust.

**Suggestion**: Adopt a phased visibility model:

- **Before a project is opened**: Show only Home, Setup, and Settings in the sidebar. Gray out or hide Scenes, Issues, Style, Characters & World, Search, and Exports. Alternatively, keep them visible but apply a disabled/muted style with a tooltip: "No project open -- start with Setup."
- **During initial processing**: Reveal sections progressively as data becomes available. Show a "(processing...)" badge on sections that are pending.
- **After processing completes**: All sections visible with badge counts (e.g., "Issues (3)", "Scenes (24)").

This phased approach turns the sidebar into a progress indicator itself.

### S-4: Contextual Empty States with Next Actions

**Priority**: Medium Impact
**Rationale**: Empty states should guide the writer toward the next step, not present a dead end. NN/g calls this the "constructive void" -- an empty view is an opportunity to teach and direct.

**Suggestion**: Upgrade all empty-state screens to include:

- A clear explanation of what would populate this view: "Scenes will appear here after CanonKeeper finishes reading your manuscript."
- A primary action button that takes the writer somewhere useful: e.g., "Go to Setup" from an empty Scenes view, or "Open a Project" from an empty Dashboard.
- An estimated timeline: "Scenes typically appear within 2-3 minutes of adding a manuscript."
- Distinct visual treatment for "loading" vs. "truly empty": show skeleton placeholders during an active data fetch, and show the `EmptyState` component only when the fetch completes with no results.

---

## Theme 2: Dashboard Improvements

The Dashboard is the writer's home base. It should answer three questions at a glance: "Is my project current?", "Is anything happening right now?", and "Where should I go next?"

### S-5: Richer Project Card with Timestamps

**Priority**: Medium Impact
**Rationale**: Timestamps build trust by proving the system is current. NN/g's "Visibility of System Status" heuristic requires that the system always keep users informed about what is going on, through appropriate feedback within reasonable time. A project card that only shows name and path leaves the writer guessing about recency.

**Suggestion**: The project card on the Dashboard should show:

- Project name and folder path (already shown).
- "Created: Jan 20, 2026" and "Last updated: 5 minutes ago" using relative time for recent events and absolute dates for older ones.
- Total manuscript file count and aggregate word count.
- A "last analyzed" timestamp per document, summarized as "All files current as of 5 minutes ago" or "2 files pending re-analysis."

### S-6: Processing Progress Banner

**Priority**: High Impact
**Rationale**: During long ingestion runs (novel-length manuscripts can take 10+ minutes), writers need confidence the system is working and a rough estimate of when results will be ready. The small StatusBadge in the top bar is easy to miss and provides no detail about what is happening.

**Suggestion**: When the worker is busy, display a prominent full-width progress banner at the top of the Dashboard:

- Show the current pipeline stage in plain language: "Reading your manuscript..." then "Finding scenes..." then "Analyzing style..." then "Extracting characters and locations..." then "Checking for continuity issues..."
- Show the active file name (just the filename, not the full path).
- Show queue depth: "3 files remaining after this one."
- Optionally, show estimated time remaining based on past processing performance for similarly sized files.
- The banner should collapse gracefully when processing completes, transitioning to a brief success state: "All files analyzed. Last run: just now."

### S-7: Document Inventory Panel

**Priority**: Medium Impact
**Rationale**: Writers need to see what files CanonKeeper is tracking and whether those files are still present on disk. The database already stores document metadata (type, file path, content hash, missing status, last-seen timestamp) but none of this is surfaced in the UI.

**Suggestion**: Add a "Your Manuscripts" section to the Dashboard (or as a sub-view accessible from Setup) showing:

- Each manuscript file with a type icon (.md, .txt, .docx).
- A status indicator: green for present and current, yellow for present but changed since last analysis, red with "File not found" warning for missing files.
- Last analyzed timestamp per file.
- Number of passages and scenes derived from each file.
- A "Remove" action per file (with confirmation, per S-19).

### S-8: Badge Counts on Sidebar Navigation

**Priority**: Medium Impact
**Rationale**: At-a-glance status indicators reduce the need to navigate into each section just to check whether anything is there. This is a common pattern in productivity applications (email unread counts, issue tracker badges, notification dots).

**Suggestion**: Show numeric badges on sidebar items:

- **Issues**: Count of open (unresolved) issues, e.g., "3".
- **Scenes**: Total scene count.
- **Characters & World**: Total entity count.
- **Style**: Optionally, count of flagged style items.
- **During processing**: Show a small animated indicator (pulsing dot or spinner) instead of a count, signaling that the number is still changing.

---

## Theme 3: Setup Experience Refinement

Setup is the writer's first real interaction with CanonKeeper. It should feel guided, completable, and rewarding.

### S-9: Setup as a Wizard with Clear Completion State

**Priority**: Medium Impact
**Rationale**: The current 3-step progress indicator is a good foundation, but the steps are not interactive (clicking a completed step does not navigate back to it) and there is no celebration or clear signal when all steps are done.

**Suggestion**:

- Make step indicators clickable to allow navigation between completed steps.
- Add a completion celebration: when all 3 steps are done, show a success state with "You're all set! CanonKeeper is analyzing your manuscript." and a "Go to Dashboard" button.
- Show the expected experience after setup: "In a few minutes you'll be able to browse scenes, check for issues, explore characters, and search your entire manuscript."
- Consider adding a "step 0" for first-time users that briefly explains what CanonKeeper is (linking to S-1's welcome content).

### S-10: Smarter LLM Configuration Guidance

**Priority**: Low Impact
**Rationale**: LLM setup is the most technically demanding part of the onboarding flow. Many fiction writers will not know what an API key is. The current interface uses technical language that can intimidate non-technical users.

**Suggestion**:

- Frame the LLM step as "Enhanced Analysis (Optional)" and make it visually clear that the app works fully without it.
- Show a brief comparison of what features are available with vs. without LLM: "Without: scene detection, style analysis, full-text search. With: richer character extraction, deeper continuity checks."
- Provide a jargon-free explanation of what an API key is and where to get one, with a direct link to the provider's key management page.
- Consider a "Test Connection" button that validates the key and shows a green checkmark before proceeding.

---

## Theme 4: Surfacing Hidden Data and Metadata

Code review reveals significant stored data that the UI never exposes. Every unsurfaced data point is a missed opportunity to build trust and deliver value.

### S-11: Timestamps Throughout the UI

**Priority**: High Impact
**Rationale**: Timestamps are the simplest and most effective trust signal in a background-processing tool. NN/g's "Visibility of System Status" heuristic applies directly: writers need to know that the data they are looking at is current. Without timestamps, every view silently asks the writer to take the data on faith.

**Suggestion**: Add relative timestamps to:

- **Issues**: "Found 2 days ago" or "Detected today at 2:15 PM."
- **Entities/Characters**: "First detected 3 hours ago" / "Last updated today."
- **Claims**: "Inferred on Feb 5" or "Confirmed by you on Feb 6."
- **Scenes**: "Last analyzed: 2 hours ago."
- Use relative time for recent items ("5 minutes ago") and absolute dates for older items ("Jan 20, 2026").

### S-12: Claim Confidence Visualization

**Priority**: Medium Impact
**Rationale**: Each claim in the database carries a `confidence` score between 0 and 1, but this is never displayed. Writers currently see only a binary status: "Confirmed" or "Detected." Exposing confidence helps writers decide which claims to review first and builds trust by showing that the system is transparent about its uncertainty.

**Suggestion**:

- Show a subtle confidence indicator next to each claim: a small horizontal bar, a colored dot (green/yellow/red), or a plain percentage.
- Sort or group claims by confidence, with low-confidence claims surfaced first for review.
- Frame confidence in plain language: "How certain CanonKeeper is" rather than "confidence score."
- Add claim history where applicable: "Previously: blue eyes (inferred) -> brown eyes (confirmed by you)."

### S-13: Scene Enrichment -- Time Context and Character Presence

**Priority**: High Impact
**Rationale**: The database stores rich scene metadata that the UI never displays: `time_context_text`, `pov_entity_id`, `setting_entity_id`, `pov_confidence`, `setting_confidence`, and scene-entity relationships (which characters appear in each scene with their roles). This is some of the highest-value data for fiction writers -- knowing who is in a scene, whose perspective it follows, and when it takes place -- and none of it reaches the screen.

**Suggestion**:

- **Scene detail view**: Show the resolved POV character name alongside the POV type. Instead of just "third_limited", show "Third-person limited, Mira's perspective."
- **Time context**: Display `time_context_text` as a metadata tag on each scene: "dawn", "three days later", "winter."
- **Confidence**: Show actual confidence percentages (e.g., "87%") rather than synthetic qualitative labels like "low" or "medium."
- **Characters in this scene**: Add a section listing characters present with their roles (present, mentioned, referenced).
- **Reciprocal linking in Characters & World**: Show "Scenes where [character] appears" with clickable links back to the Scenes view.
- **Entity aliases**: Display "Also known as: The Engineer, Dr. Chen" on entity detail views.

### S-14: Evidence Line Numbers

**Priority**: Low Impact
**Rationale**: Evidence items store `lineStart` and `lineEnd` values but never display them. Line numbers help writers locate the referenced passage in their own text editor, bridging the gap between CanonKeeper's analysis and the writer's editing workflow.

**Suggestion**: Show "Lines 142-145" alongside evidence excerpts in all views that display evidence (Issues, Characters & World claims, Scene detail).

### S-15: Search Result Relevance Indicators

**Priority**: Low Impact
**Rationale**: Search returns a BM25 relevance `score` per result but never displays it. Without any relevance signal, writers cannot quickly distinguish a perfect match from a marginal one.

**Suggestion**:

- Map raw BM25 scores to human-readable labels: "Best match", "Good match", "Partial match."
- Add a "Show full passage" expand toggle per search result for quick context review.
- Show the total result count prominently at the top of results: "24 results for 'silver dagger'."

### S-16: Queue and Activity Panel

**Priority**: Medium Impact
**Rationale**: The IPC layer exposes full job queue management (list, cancel, retry) but there is no UI for it. During initial ingestion of large manuscripts, writers benefit from seeing what is happening and having the ability to cancel pending work.

**Suggestion**: Add a collapsible activity panel (slide-out drawer or bottom panel) showing:

- Pending and running jobs with plain-language descriptions: "Reading chapter-3.md", "Building scene index", "Checking continuity."
- Cancel buttons for pending jobs.
- Retry attempt count for failed jobs with a manual "Retry" option.
- This panel could live as a section of the Dashboard, or as a slide-out triggered by clicking the StatusBadge in the top bar.

---

## Theme 5: Error Handling and Feedback

Error handling is where trust is won or lost. A single cryptic error message can undo hours of positive experience.

### S-17: Human-Readable Error Messages

**Priority**: High Impact (P0)
**Rationale**: NN/g's "Error Prevention" and "Help Users Recognize, Diagnose, and Recover from Errors" heuristics require that error messages be expressed in plain language, indicate the problem precisely, and constructively suggest a solution. Currently, raw error codes like `INGEST_FAILED` and unprocessed JavaScript error strings are shown directly to the writer.

**Suggestion**: Create an error message dictionary mapping internal codes to writer-friendly messages:

| Internal Code | Writer-Friendly Message |
|---------------|------------------------|
| `INGEST_FAILED` | "We couldn't read this manuscript file. Please check that the file exists and isn't open in another program." |
| `SCENE_LOAD_FAILED` | "Scene data couldn't be loaded. Try refreshing, or go to Settings and run diagnostics." |
| `EXPORT_PICK_FAILED` | "The export folder couldn't be accessed. Please choose a different folder." |
| `CLAIM_CONFIRM_FAILED` | "This fact couldn't be confirmed right now. Please try again in a moment." |

Additionally:

- Sanitize JavaScript error messages before displaying them: strip stack traces, translate SQLite errors into plain language.
- Keep the original error code available in a "Technical Details" expandable section for debugging purposes.

### S-18: Per-Action Busy States Instead of Global

**Priority**: High Impact (P0)
**Rationale**: The application currently uses a global `busy` boolean that blocks all user actions when any single operation is running. This violates NN/g's "User Control and Freedom" heuristic: a writer should be able to search while an export is running, or browse scenes while ingestion is in progress.

**Suggestion**:

- Replace the global `busy` boolean with per-namespace busy tracking: `searchBusy`, `exportBusy`, `ingestBusy`, `refreshBusy`, etc.
- Only disable buttons and inputs that are directly relevant to the active operation.
- The global StatusBadge in the top bar can still reflect overall system activity, but it should not gate unrelated user actions.

### S-19: Confirmation Dialogs for All Destructive Actions

**Priority**: Medium Impact
**Rationale**: NN/g's "Error Prevention" heuristic recommends confirmation steps before irreversible actions. Currently, "Forget Last Project" and "Reset This Project's Saved State" fire immediately on click with no confirmation. "Resolve Issue" also has no pre-action confirmation.

**Suggestion**:

- Add a `ConfirmModal` component to all destructive actions: Forget Last Project, Reset Project State, Resolve Issue, and any future delete/remove actions.
- The modal text should explain what will be lost or changed in plain, specific language: "This will clear all saved filters, selections, and view state for this project. Your manuscript files and analysis data will not be affected."
- Keep the existing undo-toast pattern for Resolve Issue as a secondary safety net (defense in depth).

### S-20: Tiered Toast Persistence

**Priority**: Low Impact
**Rationale**: All toasts currently dismiss after a uniform 10-second timeout. Error toasts carry more important information and deserve more time on screen.

**Suggestion**:

- **Success toasts**: 5-7 seconds (brief acknowledgment).
- **Info toasts**: 8-10 seconds.
- **Error toasts**: 15-20 seconds, or persist until manually dismissed.
- **Toasts with undo actions**: Persist until the undo timeout expires (the existing 10-second window is appropriate).

---

## Theme 6: Style and Visual Polish

Consistency in visual patterns reduces cognitive load and makes the application feel more reliable.

### S-21: Consistent Busy Button Patterns

**Priority**: Low Impact
**Rationale**: Visual consistency reduces cognitive load. Currently, some buttons show inline spinners when an action is in progress, while others simply disable without visual feedback. This inconsistency makes it harder for writers to understand whether their click registered.

**Suggestion**: Standardize the pattern: all buttons that trigger asynchronous actions display an inline `<Spinner>` component when busy. Apply this consistently across ScenesView, IssuesView, StyleView, BibleView (Characters & World), and SettingsView refresh buttons.

### S-22: Consistent Empty State Components

**Priority**: Low Impact
**Rationale**: Visual consistency. Some views use the shared `EmptyState` component for empty data, while others fall back to plain text paragraphs. This creates an uneven visual experience.

**Suggestion**: Replace all plain-text empty fallbacks with the `EmptyState` component. This ensures consistent styling, icon treatment, descriptive messaging, and action button support across every view in the application.

### S-23: Skeleton Loading Placeholders

**Priority**: Medium Impact
**Rationale**: NN/g research shows that skeleton screens (gray placeholder shapes that mimic the layout of incoming content) reduce perceived wait time by 15-20% compared to spinners alone. They also signal to the user what kind of content is coming.

**Suggestion**: Add skeleton placeholders for:

- **Dashboard**: Summary card shapes (4 card-sized gray blocks).
- **Scenes**: Table rows with gray bars for each column.
- **Issues**: Card-shaped gray blocks matching the issue card layout.
- **Characters & World**: List items with gray bars for name and description.

Critically, distinguish "loading" from "empty": show skeletons while a data fetch is in progress, and show the `EmptyState` component only after the fetch completes with zero results.

### S-24: Expandable Evidence in Context

**Priority**: Medium Impact
**Rationale**: Currently, viewing full evidence requires opening a side drawer, which is a navigation step that interrupts the writer's flow. For quick review, inline expandable evidence would reduce friction.

**Suggestion**:

- **Issues**: The existing 2-item inline evidence preview is good. Add a "Show all N evidence items" expand toggle to reveal the rest inline, without requiring the drawer.
- **Scenes**: Add an inline passage preview (first 2 passages) directly in the scene list or detail panel without requiring a separate expansion step.
- **Characters & World**: Claims already appear under collapsible `<details>` elements. Add evidence excerpts inline under each claim so writers can see the source text without additional clicks.

---

## Theme 7: Power User Features

Writers who use CanonKeeper regularly will develop workflows and expectations for efficiency. These suggestions reward continued use.

### S-25: Expanded Command Palette

**Priority**: Medium Impact
**Rationale**: The command palette currently contains only 13 commands (9 navigation shortcuts, 1 project action, 3 resume actions). Power users who rely on keyboard-driven workflows expect a richer command set that covers common actions.

**Suggestion**: Add commands for:

- "Add Manuscript" -- jumps to Setup, step 2.
- "Export Project" -- jumps to Exports with focus on the run button.
- "Toggle Theme" -- instant action, no navigation.
- "Focus Search" -- jumps to Search with the input field focused.
- "Run Diagnostics" -- instant action.

Additional improvements:

- Show keyboard shortcut hints next to command items (e.g., `[` / `]` for section navigation).
- Order commands by recency or frequency: sections the writer uses most appear first.

### S-26: Persist Search Queries and Export Directory

**Priority**: Low Impact
**Rationale**: Writers who repeatedly search for the same terms or export to the same folder should not have to re-enter that information every session.

**Suggestion**:

- Add `lastSearchQuery` and `lastExportDirectory` fields to the per-project persistence envelope.
- Show a "Recent searches" dropdown in SearchView, populated from a small history ring.
- Pre-fill the export directory picker with the last-used value.

### S-27: Cross-View Linking

**Priority**: Medium Impact
**Rationale**: Writers move fluidly between Scenes, Issues, Characters, and Style. Cross-references between views reduce navigation friction and help writers follow threads of inquiry. Some cross-linking already exists (e.g., "View Scene" buttons on issues), but coverage is incomplete.

**Suggestion**: Ensure bidirectional links across all relevant views:

- **Scene detail** links to characters present in the scene (navigates to Characters & World).
- **Character detail** links to scenes where the character appears (navigates to Scenes).
- **Issue detail** links to the specific scene where the issue was found (navigates to Scenes; this already exists in some form).
- **Style repetition detail** links to scenes where the repeated phrase appears most frequently (navigates to Scenes).
- **Search results** link to the scene containing the matched passage (navigates to Scenes).

---

## Theme 8: Accessibility Fundamentals

Accessibility is not optional. These items address WCAG 2.1 AA compliance gaps that affect keyboard-only users, screen reader users, and users with color vision deficiencies.

### S-28: Keyboard-Navigable Lists

**Priority**: Critical (P0)
**Rationale**: WCAG 2.1 AA Success Criterion 2.1.1 ("Keyboard") requires that all functionality be operable through a keyboard interface. Lists are the primary interaction model in CanonKeeper (scene lists, issue cards, entity lists, search results), and most are currently inaccessible via keyboard alone.

**Suggestion**:

- **ScenesView table**: Add `tabIndex={0}`, `role="row"`, `aria-selected`, and `onKeyDown` handlers (Enter/Space to select) to `<tr>` elements. Alternatively, switch to `<button>` elements as BibleView does.
- **IssuesView cards**: Add `tabIndex={0}`, `role="button"`, and keyboard handlers to clickable card `<div>` elements. Or wrap the card content in a `<button>`.
- **All master-detail views**: Add `aria-selected="true"` on the currently selected item.
- **Collapsible sections**: Add `aria-expanded` attributes to Notices toggles, Details groups, and any other collapsible regions.

### S-29: Label All Form Inputs

**Priority**: Critical (P0)
**Rationale**: WCAG 2.1 AA Success Criterion 1.3.1 ("Info and Relationships") and 4.1.2 ("Name, Role, Value") require that all form inputs have programmatically associated labels. Placeholder text is not a substitute for a label -- it disappears on input and is not reliably announced by screen readers.

**Suggestion**:

- **SearchView**: Add visually-hidden `<label>` elements for both search inputs, or add `aria-label` attributes with descriptive text.
- **All filter inputs**: Verify that each input has an associated label. The `FilterGroup` component does wrap inputs in `<label>` elements, which is correct. Audit any inputs outside of `FilterGroup` for compliance.

### S-30: Color-Independent Status Indicators

**Priority**: Medium
**Rationale**: WCAG 1.4.1 ("Use of Color") requires that color not be the only visual means of conveying information. Users with color vision deficiencies (affecting roughly 8% of males and 0.5% of females) may not distinguish between red/green/yellow status indicators.

**Suggestion**:

- **Pipeline stage dots on Dashboard**: Add shape differentiation in addition to color: a checkmark icon for complete, a spinner for running, an X for failed, and an open circle for pending.
- **Frequency bars in StyleView**: Add a text percentage alongside the colored bar.
- **StatusBadge instances**: These already include text labels alongside the colored dot, which is correct. Verify that no view relies on the dot color alone without accompanying text.

---

## Implementation Priority Matrix

| Priority | Suggestions | Rationale |
|----------|------------|-----------|
| **P0 -- Do First** | S-28, S-29, S-17, S-18 | Accessibility compliance and fundamentally broken interaction patterns. These affect usability for all users (error messages, action blocking) and exclude entire user groups (keyboard and screen reader users). |
| **P1 -- High Impact** | S-1, S-2, S-3, S-6, S-11, S-13 | First-run experience and trust signals. These determine whether a new user succeeds on first launch (onboarding) and whether a returning user trusts the data they see (timestamps, surfaced metadata). |
| **P2 -- Medium Impact** | S-4, S-5, S-7, S-8, S-9, S-12, S-16, S-19, S-23, S-24, S-25, S-27 | Polish and depth. These improve the experience for active users who have already adopted the tool and want more efficient, more informative interactions. |
| **P3 -- Low Impact** | S-10, S-14, S-15, S-20, S-21, S-22, S-26, S-30 | Refinements. These address minor inconsistencies, surface low-value hidden data, and add convenience features that benefit power users. |

Within each priority tier, suggestions are listed in recommended implementation order. P0 items should be addressed before any P1 work begins.

---

## Implementation Status

Status of suggestions after completion of the 2026-02-07 UI remediation work:

### Addressed (fully or partially)

| ID | Title | Status |
|----|-------|--------|
| S-17 | Human-Readable Error Messages | Implemented -- 16-code dictionary with writer-friendly messages + sanitization of raw error strings + expandable technical details section |
| S-19 | Confirmation Dialogs | Implemented -- ConfirmModal added for "Forget Last Project" and "Reset Project State" settings actions |
| S-20 | Tiered Toast Persistence | Implemented -- success=5s, info=8s, error=15s, undo=10s |
| S-21 | Consistent Busy Button Patterns | Implemented -- All action buttons across all views now show inline Spinner when busy |
| S-22 | Consistent Empty State Components | Implemented -- All plain-text empty fallbacks replaced with EmptyState component |
| S-28 | Keyboard-Navigable Lists | Implemented -- tabIndex, role, onKeyDown, aria-selected added to ScenesView, IssuesView, BibleView |
| S-29 | Label All Form Inputs | Implemented -- aria-label added to both SearchView inputs |
| S-30 | Color-Independent Status Indicators | Implemented -- Pipeline dots use shape-differentiated icons (CheckCircle2, Loader2, XCircle, Circle); health check icons vary by status (CheckCircle, XCircle, AlertCircle) |

### Addressed in follow-up pass

S-1 through S-16, S-18, S-23 through S-27 were addressed in the final remaining-spec implementation pass.
