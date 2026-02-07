/**
 * Versioned persistence envelope for per-project UI state.
 *
 * Replaces the flat `canonkeeper.*` localStorage keys with a single
 * structured key `canonkeeper.session.v1` that scopes filter/selection
 * state per project while keeping global UI prefs (section, sidebar) shared.
 */

// ---------------------------------------------------------------------------
// Storage abstraction (for testability)
// ---------------------------------------------------------------------------

export interface StorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectUIState {
  issueFilters: { status: string; severity: string; type: string; query: string; sort: string };
  entityFilters: { type: string; status: string; query: string };
  selectedSceneId: string;
  selectedIssueId: string;
  selectedEntityId: string;
  continueContext: { issueId: string | null; entityId: string | null; sceneId: string | null };
}

export interface SessionEnvelope {
  version: 1;
  global: {
    lastProjectRoot: string | null;
    lastProjectId: string | null;
    lastProjectName: string | null;
    activeSection: string;
    sidebarCollapsed: boolean;
    hasSeenWelcome?: boolean;
  };
  projects: Record<string, ProjectUIState>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = "canonkeeper.session.v1";

const LEGACY_KEYS = [
  "canonkeeper.activeSection",
  "canonkeeper.sidebarCollapsed",
  "canonkeeper.issueFilters",
  "canonkeeper.entityFilters",
  "canonkeeper.selectedSceneId",
  "canonkeeper.selectedIssueId",
  "canonkeeper.selectedEntityId",
  "canonkeeper.continueContext"
] as const;

const LEGACY_PROJECT_KEY = "_legacy";

export const DEFAULT_PROJECT_STATE: ProjectUIState = {
  issueFilters: { status: "open", severity: "all", type: "", query: "", sort: "recency" },
  entityFilters: { type: "", status: "all", query: "" },
  selectedSceneId: "",
  selectedIssueId: "",
  selectedEntityId: "",
  continueContext: { issueId: null, entityId: null, sceneId: null }
};

const DEFAULT_GLOBAL: SessionEnvelope["global"] = {
  activeSection: "dashboard",
  sidebarCollapsed: false,
  lastProjectRoot: null,
  lastProjectId: null,
  lastProjectName: null,
  hasSeenWelcome: false
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultEnvelope(): SessionEnvelope {
  return { version: 1, global: { ...DEFAULT_GLOBAL }, projects: {} };
}

function parseLegacyJson<T>(storage: StorageBackend, key: string, fallback: T): T {
  try {
    const raw = storage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

export function migrateFromLegacy(storage: StorageBackend = localStorage): SessionEnvelope | null {
  const hasLegacy = LEGACY_KEYS.some((key) => storage.getItem(key) !== null);
  if (!hasLegacy) return null;

  const envelope = defaultEnvelope();

  // Global keys
  const activeSection = parseLegacyJson<string>(storage, "canonkeeper.activeSection", "dashboard");
  const sidebarCollapsed = parseLegacyJson<boolean>(
    storage,
    "canonkeeper.sidebarCollapsed",
    false
  );
  envelope.global.activeSection = activeSection;
  envelope.global.sidebarCollapsed = sidebarCollapsed;

  // Per-project keys → stashed under "_legacy" until project ID is known
  const projectState: ProjectUIState = {
    issueFilters: parseLegacyJson(storage, "canonkeeper.issueFilters", {
      ...DEFAULT_PROJECT_STATE.issueFilters
    }),
    entityFilters: parseLegacyJson(storage, "canonkeeper.entityFilters", {
      ...DEFAULT_PROJECT_STATE.entityFilters
    }),
    selectedSceneId: parseLegacyJson(storage, "canonkeeper.selectedSceneId", ""),
    selectedIssueId: parseLegacyJson(storage, "canonkeeper.selectedIssueId", ""),
    selectedEntityId: parseLegacyJson(storage, "canonkeeper.selectedEntityId", ""),
    continueContext: parseLegacyJson(storage, "canonkeeper.continueContext", {
      ...DEFAULT_PROJECT_STATE.continueContext
    })
  };

  envelope.projects[LEGACY_PROJECT_KEY] = projectState;

  // Clean up legacy keys
  for (const key of LEGACY_KEYS) {
    storage.removeItem(key);
  }

  return envelope;
}

// ---------------------------------------------------------------------------
// Load / Save
// ---------------------------------------------------------------------------

export function loadSession(storage: StorageBackend = localStorage): SessionEnvelope {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as SessionEnvelope;
      if (parsed && parsed.version === 1 && parsed.global && parsed.projects) {
        return {
          ...parsed,
          global: {
            ...DEFAULT_GLOBAL,
            ...parsed.global
          }
        };
      }
    }
  } catch {
    // corrupt data — fall through to migration / default
  }

  // Attempt legacy migration
  const migrated = migrateFromLegacy(storage);
  if (migrated) {
    saveSession(migrated, storage);
    return migrated;
  }

  return defaultEnvelope();
}

export function saveSession(
  envelope: SessionEnvelope,
  storage: StorageBackend = localStorage
): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(envelope));
  } catch {
    // storage full or unavailable — silently ignore
  }
}

// ---------------------------------------------------------------------------
// Per-project accessors (pure, return new envelopes)
// ---------------------------------------------------------------------------

export function getProjectState(
  envelope: SessionEnvelope,
  projectId: string
): ProjectUIState {
  const existing = envelope.projects[projectId];
  if (existing) return existing;

  // If there is legacy data and no entry for this project yet, adopt it
  const legacy = envelope.projects[LEGACY_PROJECT_KEY];
  if (legacy) return legacy;

  return { ...DEFAULT_PROJECT_STATE };
}

export function setProjectState(
  envelope: SessionEnvelope,
  projectId: string,
  state: Partial<ProjectUIState>
): SessionEnvelope {
  const current = getProjectState(envelope, projectId);
  const nextProjects = {
    ...envelope.projects,
    [projectId]: { ...current, ...state }
  };
  if (projectId !== LEGACY_PROJECT_KEY && LEGACY_PROJECT_KEY in nextProjects) {
    delete nextProjects[LEGACY_PROJECT_KEY];
  }
  return {
    ...envelope,
    projects: nextProjects
  };
}

export function clearProjectState(
  envelope: SessionEnvelope,
  projectId: string
): SessionEnvelope {
  const projects = Object.fromEntries(
    Object.entries(envelope.projects).filter(([key]) => key !== projectId)
  );
  return { ...envelope, projects };
}

// ---------------------------------------------------------------------------
// Global state accessor (pure)
// ---------------------------------------------------------------------------

export function setGlobalState(
  envelope: SessionEnvelope,
  updates: Partial<SessionEnvelope["global"]>
): SessionEnvelope {
  return {
    ...envelope,
    global: { ...envelope.global, ...updates }
  };
}

// ---------------------------------------------------------------------------
// Clear everything
// ---------------------------------------------------------------------------

export function clearSession(storage: StorageBackend = localStorage): void {
  storage.removeItem(STORAGE_KEY);
}
