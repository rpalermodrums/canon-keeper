import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addDocument,
  askQuestion,
  confirmClaim,
  createOrOpenProject,
  dismissIssue,
  getBundledFixturePath,
  getProjectDiagnostics,
  getProjectStats,
  getEvidenceCoverage,
  getEntity,
  getProcessingState,
  getProjectHistory,
  getScene,
  getStyleReport,
  getWorkerStatus,
  listEntities,
  listIssues,
  listScenes,
  pickDocumentPath,
  pickExportDirPath,
  pickProjectRoot,
  querySearch,
  resolveIssue,
  runExport,
  getCurrentProject,
  subscribeProjectStatus,
  undoDismissIssue,
  undoResolveIssue,
  type AskResponse,
  type EntityDetail,
  type EntitySummary,
  type EvidenceCoverage,
  type EvidenceItem,
  type ExportResult,
  type IngestResult,
  type IssueSummary,
  type ProjectDiagnostics,
  type ProjectStats,
  type ProjectSummary,
  type SceneDetail,
  type SceneSummary,
  type SearchQueryResponse,
  type StyleReport,
  type UserFacingError,
  type WorkerStatus
} from "../api/ipc";
import type { ToastItem } from "../components/AsyncToast";
import type { ComponentType } from "react";
import {
  AlertTriangle,
  BookMarked,
  BookOpen,
  Download,
  FolderOpen,
  LayoutDashboard,
  Palette,
  Search,
  Settings
} from "lucide-react";
import {
  type ProjectUIState,
  type SessionEnvelope,
  DEFAULT_PROJECT_STATE,
  clearProjectState,
  getProjectState,
  loadSession,
  saveSession,
  setGlobalState,
  setProjectState
} from "./persistence";

export type AppSection =
  | "dashboard"
  | "setup"
  | "search"
  | "scenes"
  | "issues"
  | "style"
  | "bible"
  | "export"
  | "settings";

export type ActiveEvidenceContext = {
  source: "issue" | "scene" | "claim" | "style";
  sourceId: string;
  evidenceId: string;
} | null;

export type LayoutMode = "mobile" | "tablet" | "desktop";

export const APP_SECTIONS: Array<{
  id: AppSection;
  label: string;
  subtitle: string;
  icon: ComponentType<{ size?: number | string; className?: string }>;
}> = [
  { id: "dashboard", label: "Home", subtitle: "Your project at a glance", icon: LayoutDashboard },
  { id: "setup", label: "Setup", subtitle: "Get started", icon: FolderOpen },
  { id: "search", label: "Search", subtitle: "Search your manuscript", icon: Search },
  { id: "scenes", label: "Scenes", subtitle: "Browse scenes", icon: BookOpen },
  { id: "issues", label: "Issues", subtitle: "Review editorial issues", icon: AlertTriangle },
  { id: "style", label: "Style", subtitle: "Writing style patterns", icon: Palette },
  { id: "bible", label: "Characters & World", subtitle: "Characters and world", icon: BookMarked },
  { id: "export", label: "Exports", subtitle: "Export your data", icon: Download },
  { id: "settings", label: "Settings", subtitle: "Preferences", icon: Settings }
];

const ACTION_NAMESPACES = {
  createProject: "project",
  addDocument: "project",
  search: "search",
  ask: "search",
  dismissIssue: "issues",
  resolveIssue: "issues",
  confirmClaim: "bible",
  export: "export",
  diagnostics: "system"
} as const;

type ActionLabel = keyof typeof ACTION_NAMESPACES;
type ActionNamespace = (typeof ACTION_NAMESPACES)[ActionLabel];

type IssueFilters = {
  status: "open" | "dismissed" | "resolved" | "all";
  severity: "all" | "low" | "medium" | "high";
  type: string;
  query: string;
  sort: "recency" | "severity" | "type";
};

type EntityFilters = {
  type: string;
  status: "all" | "confirmed" | "inferred";
  query: string;
};

type ContinueContext = {
  issueId: string | null;
  entityId: string | null;
  sceneId: string | null;
};

function nextSection(current: AppSection, delta: number): AppSection {
  const index = APP_SECTIONS.findIndex((section) => section.id === current);
  if (index < 0) {
    return "dashboard";
  }
  const next = (index + delta + APP_SECTIONS.length) % APP_SECTIONS.length;
  return APP_SECTIONS[next]!.id;
}

function sanitizeErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return "Unknown error";
  const raw = err.message;
  if (/SQLITE_BUSY/i.test(raw)) return "The database is temporarily busy. Please try again in a moment.";
  if (/SQLITE_LOCKED/i.test(raw)) return "The database is temporarily locked. Please try again in a moment.";
  if (/SQLITE_CORRUPT/i.test(raw)) return "The database file appears to be damaged. Try running diagnostics from Settings.";
  if (/SQLITE_READONLY/i.test(raw)) return "The database cannot be written to. Check your file permissions.";
  const stripped = raw.replace(/\n\s*at\s+.+/g, "").trim();
  return stripped || "Unknown error";
}

function toUserFacingError(
  code: string,
  err: unknown,
  actionLabel?: string,
  action?: string
): Omit<UserFacingError, "id"> {
  return {
    code,
    message: sanitizeErrorMessage(err),
    actionLabel,
    action
  };
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select" || target.isContentEditable;
}

function computeLayoutMode(width: number): LayoutMode {
  if (width < 768) {
    return "mobile";
  }
  if (width < 1200) {
    return "tablet";
  }
  return "desktop";
}

export function useCanonkeeperApp() {
  const [activeSection, setActiveSection] = useState<AppSection>("dashboard");
  const [rootPath, setRootPath] = useState("");
  const [docPath, setDocPath] = useState("");
  const [exportDir, setExportDir] = useState("");
  const [exportKind, setExportKind] = useState<"md" | "json">("md");

  const [status, setStatus] = useState<WorkerStatus | null>(null);
  const [healthCheck, setHealthCheck] = useState<ProjectDiagnostics | null>(null);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [processingState, setProcessingState] = useState<
    Array<{
      document_id: string;
      snapshot_id: string;
      stage: string;
      status: string;
      error: string | null;
      updated_at: number;
      document_path: string;
    }>
  >([]);
  const [history, setHistory] = useState<{
    snapshots: Array<{
      id: string;
      document_id: string;
      document_path: string;
      version: number;
      created_at: number;
    }>;
    events: Array<{
      id: string;
      project_id: string;
      ts: number;
      level: "info" | "warn" | "error";
      event_type: string;
      payload_json: string;
    }>;
  } | null>(null);
  const [lastIngest, setLastIngest] = useState<IngestResult | null>(null);
  const [projectStats, setProjectStats] = useState<ProjectStats | null>(null);
  const [evidenceCoverage, setEvidenceCoverage] = useState<EvidenceCoverage | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchQueryResponse | null>(null);
  const [questionText, setQuestionText] = useState("");
  const [askResult, setAskResult] = useState<AskResponse | null>(null);

  const [scenes, setScenes] = useState<SceneSummary[]>([]);
  const [scenesLoaded, setScenesLoaded] = useState(false);
  const [selectedSceneId, setSelectedSceneId] = useState("");
  const [sceneDetail, setSceneDetail] = useState<SceneDetail | null>(null);
  const [sceneQuery, setSceneQuery] = useState("");

  const [issues, setIssues] = useState<IssueSummary[]>([]);
  const [issuesLoaded, setIssuesLoaded] = useState(false);
  const [selectedIssueId, setSelectedIssueId] = useState("");
  const [issueFilters, setIssueFilters] = useState<IssueFilters>({
    status: "open",
    severity: "all",
    type: "",
    query: "",
    sort: "recency"
  });

  const [styleReport, setStyleReport] = useState<StyleReport | null>(null);
  const [styleIssues, setStyleIssues] = useState<IssueSummary[]>([]);
  const [styleLoaded, setStyleLoaded] = useState(false);

  const [entities, setEntities] = useState<EntitySummary[]>([]);
  const [entitiesLoaded, setEntitiesLoaded] = useState(false);
  const [selectedEntityId, setSelectedEntityId] = useState("");
  const [entityDetail, setEntityDetail] = useState<EntityDetail | null>(null);
  const [entityFilters, setEntityFilters] = useState<EntityFilters>({
    type: "",
    status: "all",
    query: ""
  });

  const [activeEvidenceContext, setActiveEvidenceContext] = useState<ActiveEvidenceContext>(null);
  const [evidencePinned, setEvidencePinned] = useState(false);
  const [evidenceDrawer, setEvidenceDrawer] = useState<{
    open: boolean;
    title: string;
    evidence: EvidenceItem[];
    source: "issue" | "scene" | "claim" | "style";
    sourceId: string;
  }>({
    open: false,
    title: "",
    evidence: [],
    source: "style",
    sourceId: ""
  });

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [errors, setErrors] = useState<UserFacingError[]>([]);
  const [pendingActions, setPendingActions] = useState<Map<ActionNamespace, Set<ActionLabel>>>(new Map());
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() =>
    typeof window === "undefined" ? "desktop" : computeLayoutMode(window.innerWidth)
  );
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsedRaw] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);

  const [confirmClaimDraft, setConfirmClaimDraft] = useState<{
    field: string;
    valueJson: string;
    sourceClaimId: string;
    evidenceCount: number;
  } | null>(null);

  const [dismissIssueDraft, setDismissIssueDraft] = useState<{
    issueId: string;
    title: string;
    reason: string;
  } | null>(null);

  const [lastExportResult, setLastExportResult] = useState<ExportResult | null>(null);

  const [continueContext, setContinueContext] = useState<ContinueContext>({
    issueId: null,
    entityId: null,
    sceneId: null
  });

  const lastWorkerState = useRef<"idle" | "busy" | "unknown">("unknown");
  const hydratingRef = useRef(false);
  const bootAttemptedRef = useRef(false);
  const bootCancelledRef = useRef(false);
  const sessionRef = useRef<SessionEnvelope | null>(null);

  const [bootState, setBootState] = useState<"booting" | "ready" | "restore-failed">("booting");
  const [bootError, setBootError] = useState<string | null>(null);

  const busyNamespaces = useMemo(() => {
    const result = new Set<ActionNamespace>();
    for (const [namespace, actions] of pendingActions) {
      if (actions.size > 0) {
        result.add(namespace);
      }
    }
    return result;
  }, [pendingActions]);

  const busy = busyNamespaces.size > 0;
  const isBusy = useCallback((namespace: ActionNamespace) => busyNamespaces.has(namespace), [busyNamespaces]);

  const pushToast = useCallback((toast: Omit<ToastItem, "id">) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((current) => [...current, { ...toast, id }]);
    const timeout = toast.onAction
      ? 10_000
      : toast.tone === "error"
        ? 15_000
        : toast.tone === "success"
          ? 5_000
          : 8_000;
    setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, timeout);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const beginAction = useCallback((namespace: ActionNamespace, label: ActionLabel) => {
    setPendingActions((current) => {
      const next = new Map(current);
      const actions = new Set(next.get(namespace) ?? []);
      actions.add(label);
      next.set(namespace, actions);
      return next;
    });
  }, []);

  const endAction = useCallback((namespace: ActionNamespace, label: ActionLabel) => {
    setPendingActions((current) => {
      const next = new Map(current);
      const actions = next.get(namespace);
      if (!actions) {
        return current;
      }
      const nextActions = new Set(actions);
      nextActions.delete(label);
      if (nextActions.size === 0) {
        next.delete(namespace);
      } else {
        next.set(namespace, nextActions);
      }
      return next;
    });
  }, []);

  const refreshProcessingAndHistory = useCallback(async () => {
    if (!project) {
      return;
    }
    const [nextState, nextHistory] = await Promise.all([getProcessingState(), getProjectHistory()]);
    setProcessingState(nextState);
    setHistory(nextHistory);
  }, [project]);

  const refreshProjectStats = useCallback(async () => {
    if (!project) {
      return;
    }
    try {
      const stats = await getProjectStats();
      setProjectStats(stats);
    } catch {
      // stats are non-critical; silently ignore failures
    }
  }, [project]);

  const refreshEvidenceCoverage = useCallback(async () => {
    if (!project) {
      return;
    }
    try {
      const coverage = await getEvidenceCoverage();
      setEvidenceCoverage(coverage);
    } catch {
      // evidence coverage is non-critical; silently ignore failures
    }
  }, [project]);

  const refreshScenes = useCallback(async () => {
    try {
      const list = await listScenes();
      setScenes(list);
      if (selectedSceneId && !list.some((scene) => scene.id === selectedSceneId)) {
        setSelectedSceneId("");
        setSceneDetail(null);
      }
    } finally {
      setScenesLoaded(true);
    }
  }, [selectedSceneId]);

  const refreshIssues = useCallback(async () => {
    try {
      const list = await listIssues({
        status: issueFilters.status,
        type: issueFilters.type || undefined,
        severity: issueFilters.severity === "all" ? undefined : issueFilters.severity
      });
      setIssues(list);
      if (selectedIssueId && !list.some((issue) => issue.id === selectedIssueId)) {
        setSelectedIssueId("");
      }
    } finally {
      setIssuesLoaded(true);
    }
  }, [issueFilters, selectedIssueId]);

  const refreshStyle = useCallback(async () => {
    try {
      const report = await getStyleReport();
      setStyleReport(report);
      const list = await listIssues({ status: "all" });
      setStyleIssues(list.filter((issue) => ["repetition", "tone_drift", "dialogue_tic"].includes(issue.type)));
    } finally {
      setStyleLoaded(true);
    }
  }, []);

  const refreshEntities = useCallback(async () => {
    try {
      const list = await listEntities();
      setEntities(list);
      if (selectedEntityId && !list.some((entity) => entity.id === selectedEntityId)) {
        setSelectedEntityId("");
        setEntityDetail(null);
      }
    } finally {
      setEntitiesLoaded(true);
    }
  }, [selectedEntityId]);

  const refreshProjectData = useCallback(async () => {
    if (!project) {
      return;
    }
    await Promise.all([
      refreshProcessingAndHistory(),
      refreshProjectStats(),
      refreshEvidenceCoverage(),
      refreshScenes(),
      refreshIssues(),
      refreshStyle(),
      refreshEntities()
    ]);
  }, [project, refreshEntities, refreshEvidenceCoverage, refreshIssues, refreshProcessingAndHistory, refreshProjectStats, refreshScenes, refreshStyle]);

  const hydrateProjectData = useCallback(async (projectSummary: ProjectSummary, projectState?: ProjectUIState) => {
    if (hydratingRef.current) return;
    hydratingRef.current = true;
    try {
      setScenesLoaded(false);
      setIssuesLoaded(false);
      setStyleLoaded(false);
      setEntitiesLoaded(false);
      setProject(projectSummary);
      setRootPath(projectSummary.root_path);
      if (projectState) {
        setIssueFilters(projectState.issueFilters as IssueFilters);
        setEntityFilters(projectState.entityFilters as EntityFilters);
        setSelectedSceneId(projectState.selectedSceneId);
        setSelectedIssueId(projectState.selectedIssueId);
        setSelectedEntityId(projectState.selectedEntityId);
        setContinueContext(projectState.continueContext);
      }
      await Promise.all([
        // Call guarded APIs directly to avoid stale project closure
        Promise.all([getProcessingState(), getProjectHistory()]).then(([nextState, nextHistory]) => {
          setProcessingState(nextState);
          setHistory(nextHistory);
        }),
        getProjectStats().then((stats) => setProjectStats(stats)).catch(() => {}),
        getEvidenceCoverage().then((coverage) => setEvidenceCoverage(coverage)).catch(() => {}),
        // Unguarded refreshes can be called directly
        refreshScenes(),
        refreshIssues(),
        refreshStyle(),
        refreshEntities()
      ]);
    } finally {
      hydratingRef.current = false;
    }
  }, [refreshEntities, refreshIssues, refreshScenes, refreshStyle]);

  const setAppError = useCallback((code: string, err: unknown, actionLabel?: string, action?: string) => {
    const userError = toUserFacingError(code, err, actionLabel, action);
    const errorWithId: UserFacingError = { ...userError, id: crypto.randomUUID() };
    setErrors((current) => {
      const next = [...current, errorWithId];
      return next.length > 5 ? next.slice(next.length - 5) : next;
    });
  }, []);

  const dismissError = useCallback((id: string) => {
    setErrors((current) => current.filter((error) => error.id !== id));
  }, []);

  const clearAllErrors = useCallback(() => {
    setErrors([]);
  }, []);

  const clearBootError = useCallback(() => {
    setBootError(null);
    setBootState("ready");
  }, []);

  const skipBoot = useCallback(() => {
    bootCancelledRef.current = true;
    setBootError(null);
    setBootState("ready");
    setActiveSection("setup");
  }, []);

  const dismissWelcome = useCallback(() => {
    setShowWelcome(false);
    const envelope = sessionRef.current ?? loadSession();
    const next = setGlobalState(envelope, { hasSeenWelcome: true });
    sessionRef.current = next;
    saveSession(next);
  }, []);

  const onWelcomeGetStarted = useCallback(() => {
    dismissWelcome();
    setActiveSection("setup");
  }, [dismissWelcome]);

  const applyProjectUIState = useCallback((state: ProjectUIState) => {
    setIssueFilters(state.issueFilters as IssueFilters);
    setEntityFilters(state.entityFilters as EntityFilters);
    setSelectedSceneId(state.selectedSceneId);
    setSelectedIssueId(state.selectedIssueId);
    setSelectedEntityId(state.selectedEntityId);
    setContinueContext(state.continueContext);
  }, []);

  // ---------------------------------------------------------------------------
  // Boot effect — restores active project and per-project UI state on launch
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (bootAttemptedRef.current) return;
    bootAttemptedRef.current = true;
    bootCancelledRef.current = false;

    const bootTimeout = setTimeout(() => {
      if (bootCancelledRef.current) {
        return;
      }
      setBootState("restore-failed");
      setBootError("Restoring your last session timed out. You can start fresh or try again.");
      setActiveSection("setup");
    }, 15_000);

    const boot = async () => {
      // 1. Load persisted session envelope
      const envelope = loadSession();
      sessionRef.current = envelope;

      // 2. Apply global UI state
      if (envelope.global.activeSection) {
        const section = envelope.global.activeSection as AppSection;
        if (APP_SECTIONS.some((s) => s.id === section)) {
          setActiveSection(section);
        }
      }
      if (envelope.global.sidebarCollapsed) {
        setSidebarCollapsedRaw(true);
      }

      // 3. Check if worker already has an active project (refresh / HMR case)
      try {
        const current = await getCurrentProject();
        if (bootCancelledRef.current) {
          clearTimeout(bootTimeout);
          return;
        }

        if (current) {
          const projectState = getProjectState(envelope, current.id);
          const withProjectState = setProjectState(envelope, current.id, projectState);
          await hydrateProjectData(current, projectState);
          if (bootCancelledRef.current) {
            clearTimeout(bootTimeout);
            return;
          }
          sessionRef.current = setGlobalState(withProjectState, {
            lastProjectRoot: current.root_path,
            lastProjectId: current.id,
            lastProjectName: current.name
          });
          saveSession(sessionRef.current);
          setBootState("ready");
          clearTimeout(bootTimeout);
          return;
        }
      } catch {
        // Worker not ready yet — fall through to restore attempt
      }

      // 4. Try to restore last project (relaunch case)
      if (envelope.global.lastProjectRoot) {
        try {
          const restored = await createOrOpenProject({
            rootPath: envelope.global.lastProjectRoot,
            createIfMissing: false
          });
          if (bootCancelledRef.current) {
            clearTimeout(bootTimeout);
            return;
          }
          if (!restored) {
            throw new Error("Project not found");
          }
          const projectState = getProjectState(envelope, restored.id);
          const withProjectState = setProjectState(envelope, restored.id, projectState);
          await hydrateProjectData(restored, projectState);
          if (bootCancelledRef.current) {
            clearTimeout(bootTimeout);
            return;
          }
          sessionRef.current = setGlobalState(withProjectState, {
            lastProjectRoot: restored.root_path,
            lastProjectId: restored.id,
            lastProjectName: restored.name
          });
          saveSession(sessionRef.current);
          setBootState("ready");
          clearTimeout(bootTimeout);
          return;
        } catch {
          if (bootCancelledRef.current) {
            clearTimeout(bootTimeout);
            return;
          }
          // Stale/moved/permission error — clear and show recovery UI
          const cleared = setGlobalState(envelope, {
            lastProjectRoot: null,
            lastProjectId: null,
            lastProjectName: null
          });
          sessionRef.current = cleared;
          saveSession(cleared);
          setBootError(
            "Could not restore your last project. The folder may have moved or been deleted."
          );
          setActiveSection("setup");
          setBootState("restore-failed");
          clearTimeout(bootTimeout);
          return;
        }
      }

      // 5. No active project, no persisted root — fresh start
      if (!bootCancelledRef.current) {
        setBootState("ready");
      }
      clearTimeout(bootTimeout);
    };

    void boot();

    return () => {
      bootCancelledRef.current = true;
      clearTimeout(bootTimeout);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Section change side-effects
  // ---------------------------------------------------------------------------
  useEffect(() => {
    setMobileNavOpen(false);
    if (!evidencePinned) {
      setEvidenceDrawer((current) => ({ ...current, open: false }));
      setActiveEvidenceContext(null);
    }
  }, [activeSection, evidencePinned]);

  // Auto-route to Setup when no project is open after boot completes
  useEffect(() => {
    if (bootState === "ready" && !project && activeSection === "dashboard") {
      setActiveSection("setup");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootState]);

  useEffect(() => {
    if (bootState !== "ready" || !sessionRef.current) {
      return;
    }
    if (!sessionRef.current.global.hasSeenWelcome) {
      setShowWelcome(true);
    }
  }, [bootState]);

  useEffect(() => {
    const onResize = () => {
      setLayoutMode(computeLayoutMode(window.innerWidth));
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Envelope-aware persistence — scoped per project
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (bootState === "booting" || !sessionRef.current) return;
    const next = setGlobalState(sessionRef.current, { activeSection });
    sessionRef.current = next;
    saveSession(next);
  }, [activeSection, bootState]);

  useEffect(() => {
    if (bootState === "booting" || !sessionRef.current) return;
    const next = setGlobalState(sessionRef.current, { sidebarCollapsed });
    sessionRef.current = next;
    saveSession(next);
  }, [sidebarCollapsed, bootState]);

  useEffect(() => {
    if (bootState === "booting" || hydratingRef.current || !sessionRef.current || !project) return;
    const next = setProjectState(sessionRef.current, project.id, {
      issueFilters,
      entityFilters,
      selectedSceneId,
      selectedIssueId,
      selectedEntityId,
      continueContext
    });
    sessionRef.current = next;
    saveSession(next);
  }, [bootState, project, issueFilters, entityFilters, selectedSceneId, selectedIssueId, selectedEntityId, continueContext]);

  // Persist project pointer when project changes
  useEffect(() => {
    if (bootState === "booting" || !sessionRef.current || !project) return;
    const next = setGlobalState(sessionRef.current, {
      lastProjectRoot: project.root_path,
      lastProjectId: project.id,
      lastProjectName: project.name
    });
    sessionRef.current = next;
    saveSession(next);
  }, [bootState, project]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    const run = async () => {
      try {
        const initial = await getWorkerStatus();
        if (active) {
          setStatus(initial);
          lastWorkerState.current = initial.state;
        }
      } catch {
        if (active) {
          setStatus(null);
          lastWorkerState.current = "unknown";
        }
      }

      try {
        for await (const event of subscribeProjectStatus({ intervalMs: 2000, signal: controller.signal })) {
          if (!active) {
            break;
          }
          const next = event.status;
          setStatus(next);
          const becameIdle = lastWorkerState.current === "busy" && next.state === "idle";
          lastWorkerState.current = next.state;
          if (project && becameIdle) {
            void refreshProjectData();
          }
        }
      } catch {
        if (active) {
          setStatus(null);
          lastWorkerState.current = "unknown";
        }
      }
    };

    void run();

    return () => {
      active = false;
      controller.abort();
    };
  }, [project, refreshProjectData]);

  const runDiagnostics = useCallback(async () => {
    const action: ActionLabel = "diagnostics";
    beginAction(ACTION_NAMESPACES[action], action);
    try {
      const result = await getProjectDiagnostics();
      setHealthCheck(result);
      if (result.details.length === 0) {
        pushToast({ message: "Diagnostics passed.", tone: "success" });
      }
    } catch (err) {
      setAppError("DIAGNOSTICS_FAILED", err, "Retry", "runDiagnostics");
    } finally {
      endAction(ACTION_NAMESPACES[action], action);
    }
  }, [beginAction, endAction, pushToast, setAppError]);

  useEffect(() => {
    void runDiagnostics();
  }, [runDiagnostics]);

  const onCreateProject = useCallback(async () => {
    const action: ActionLabel = "createProject";
    beginAction(ACTION_NAMESPACES[action], action);
    try {
      const created = await createOrOpenProject({ rootPath: rootPath.trim() });
      if (!created) {
        throw new Error("Project could not be opened");
      }
      const envelope = sessionRef.current ?? loadSession();
      const projectState = getProjectState(envelope, created.id);
      const withProjectState = setProjectState(envelope, created.id, projectState);
      sessionRef.current = setGlobalState(withProjectState, {
        lastProjectRoot: created.root_path,
        lastProjectId: created.id,
        lastProjectName: created.name
      });
      saveSession(sessionRef.current);
      await hydrateProjectData(created, projectState);
      pushToast({ message: `Project ready: ${created.name}`, tone: "success" });
    } catch (err) {
      setAppError("PROJECT_OPEN_FAILED", err, "Run Diagnostics", "runDiagnostics");
    } finally {
      endAction(ACTION_NAMESPACES[action], action);
    }
  }, [beginAction, endAction, hydrateProjectData, pushToast, rootPath, setAppError]);

  const onPickProjectRoot = useCallback(async () => {
    try {
      const selected = await pickProjectRoot();
      if (selected) {
        setRootPath(selected);
      }
    } catch (err) {
      setAppError("PROJECT_PICK_FAILED", err);
    }
  }, [setAppError]);

  const onPickDocument = useCallback(async () => {
    try {
      const selected = await pickDocumentPath();
      if (selected) {
        setDocPath(selected);
      }
    } catch (err) {
      setAppError("DOCUMENT_PICK_FAILED", err);
    }
  }, [setAppError]);

  const onUseFixture = useCallback(async () => {
    try {
      const fixture = await getBundledFixturePath();
      if (fixture) {
        setDocPath(fixture);
      } else {
        setAppError("FIXTURE_NOT_FOUND", new Error("Bundled fixture not found."));
      }
    } catch (err) {
      setAppError("FIXTURE_LOAD_FAILED", err);
    }
  }, [setAppError]);

  const onAddDocument = useCallback(async () => {
    const action: ActionLabel = "addDocument";
    beginAction(ACTION_NAMESPACES[action], action);
    try {
      const result = await addDocument({ path: docPath.trim() });
      setLastIngest(result);
      await refreshProjectData();
      pushToast({ message: "Document ingested.", tone: "success" });
    } catch (err) {
      setAppError("INGEST_FAILED", err);
    } finally {
      endAction(ACTION_NAMESPACES[action], action);
    }
  }, [beginAction, docPath, endAction, pushToast, refreshProjectData, setAppError]);

  const onSearch = useCallback(async () => {
    const action: ActionLabel = "search";
    beginAction(ACTION_NAMESPACES[action], action);
    try {
      const result = await querySearch(searchQuery.trim());
      setSearchResults(result);
    } catch (err) {
      setAppError("SEARCH_FAILED", err);
    } finally {
      endAction(ACTION_NAMESPACES[action], action);
    }
  }, [beginAction, endAction, searchQuery, setAppError]);

  const onAsk = useCallback(async () => {
    const action: ActionLabel = "ask";
    beginAction(ACTION_NAMESPACES[action], action);
    try {
      const result = await askQuestion(questionText.trim());
      setAskResult(result);
    } catch (err) {
      setAppError("ASK_FAILED", err);
    } finally {
      endAction(ACTION_NAMESPACES[action], action);
    }
  }, [beginAction, endAction, questionText, setAppError]);

  const onSelectScene = useCallback(
    async (sceneId: string) => {
      setSelectedSceneId(sceneId);
      setContinueContext((ctx) => ({ ...ctx, sceneId }));
      if (!sceneId) {
        setSceneDetail(null);
        return;
      }
      try {
        const detail = await getScene(sceneId);
        setSceneDetail(detail);
      } catch (err) {
        setAppError("SCENE_LOAD_FAILED", err);
      }
    },
    [setAppError]
  );

  const onSelectIssue = useCallback((issueId: string) => {
    setSelectedIssueId(issueId);
    setContinueContext((ctx) => ({ ...ctx, issueId }));
  }, []);

  const onRequestDismissIssue = useCallback((issue: IssueSummary) => {
    setDismissIssueDraft({ issueId: issue.id, title: issue.title, reason: "" });
  }, []);

  const onConfirmDismissIssue = useCallback(async () => {
    if (!dismissIssueDraft) {
      return;
    }
    const action: ActionLabel = "dismissIssue";
    beginAction(ACTION_NAMESPACES[action], action);
    try {
      await dismissIssue(dismissIssueDraft.issueId, dismissIssueDraft.reason.trim());
      const issueId = dismissIssueDraft.issueId;
      await refreshIssues();
      pushToast({
        message: "Issue dismissed.",
        tone: "success",
        actionLabel: "Undo",
        onAction: async () => {
          await undoDismissIssue(issueId);
          await refreshIssues();
          pushToast({ message: "Dismissal undone.", tone: "success" });
        }
      });
      setDismissIssueDraft(null);
    } catch (err) {
      setAppError("ISSUE_DISMISS_FAILED", err);
    } finally {
      endAction(ACTION_NAMESPACES[action], action);
    }
  }, [beginAction, dismissIssueDraft, endAction, pushToast, refreshIssues, setAppError]);

  const onResolveIssue = useCallback(
    async (issueId: string) => {
      const action: ActionLabel = "resolveIssue";
      beginAction(ACTION_NAMESPACES[action], action);
      try {
        await resolveIssue(issueId);
        await refreshIssues();
        pushToast({
          message: "Issue resolved.",
          tone: "success",
          actionLabel: "Undo",
          onAction: async () => {
            await undoResolveIssue(issueId);
            await refreshIssues();
            pushToast({ message: "Resolution undone.", tone: "success" });
          }
        });
      } catch (err) {
        setAppError("ISSUE_RESOLVE_FAILED", err);
      } finally {
        endAction(ACTION_NAMESPACES[action], action);
      }
    },
    [beginAction, endAction, pushToast, refreshIssues, setAppError]
  );

  const onSelectEntity = useCallback(
    async (entityId: string) => {
      setSelectedEntityId(entityId);
      setContinueContext((ctx) => ({ ...ctx, entityId }));
      if (!entityId) {
        setEntityDetail(null);
        return;
      }
      try {
        const detail = await getEntity(entityId);
        setEntityDetail(detail);
      } catch (err) {
        setAppError("ENTITY_LOAD_FAILED", err);
      }
    },
    [setAppError]
  );

  const onConfirmClaim = useCallback(async () => {
    if (!entityDetail || !confirmClaimDraft) {
      return;
    }
    const action: ActionLabel = "confirmClaim";
    beginAction(ACTION_NAMESPACES[action], action);
    try {
      await confirmClaim({
        entityId: entityDetail.entity.id,
        field: confirmClaimDraft.field,
        valueJson: confirmClaimDraft.valueJson,
        sourceClaimId: confirmClaimDraft.sourceClaimId
      });
      const detail = await getEntity(entityDetail.entity.id);
      setEntityDetail(detail);
      pushToast({ message: "Claim confirmed.", tone: "success" });
      setConfirmClaimDraft(null);
    } catch (err) {
      setAppError("CLAIM_CONFIRM_FAILED", err);
    } finally {
      endAction(ACTION_NAMESPACES[action], action);
    }
  }, [beginAction, confirmClaimDraft, endAction, entityDetail, pushToast, setAppError]);

  const onPickExportDir = useCallback(async () => {
    try {
      const selected = await pickExportDirPath();
      if (selected) {
        setExportDir(selected);
      }
    } catch (err) {
      setAppError("EXPORT_PICK_FAILED", err);
    }
  }, [setAppError]);

  const onRunExport = useCallback(async () => {
    const action: ActionLabel = "export";
    beginAction(ACTION_NAMESPACES[action], action);
    try {
      const result = await runExport(exportDir.trim(), exportKind);
      setLastExportResult(result);
      if (result.ok) {
        pushToast({ message: `Export complete (${result.files.length} files).`, tone: "success" });
      } else {
        setAppError("EXPORT_FAILED", new Error(result.error));
      }
    } catch (err) {
      setAppError("EXPORT_FAILED", err);
    } finally {
      endAction(ACTION_NAMESPACES[action], action);
    }
  }, [beginAction, endAction, exportDir, exportKind, pushToast, setAppError]);

  const closeEvidence = useCallback(() => {
    setEvidenceDrawer((drawer) => ({ ...drawer, open: false }));
    setActiveEvidenceContext(null);
  }, []);

  const openEvidence = useCallback(
    (
      title: string,
      evidence: EvidenceItem[],
      context: { source: "issue" | "scene" | "claim" | "style"; sourceId: string }
    ) => {
      setEvidenceDrawer({ open: true, title, evidence, source: context.source, sourceId: context.sourceId });
      const first = evidence[0];
      setActiveEvidenceContext(
        first
          ? {
              source: context.source,
              sourceId: context.sourceId,
              evidenceId: `${first.chunkId}:${first.quoteStart}:${first.quoteEnd}`
            }
          : {
              source: context.source,
              sourceId: context.sourceId,
              evidenceId: `${context.sourceId}:0`
            }
      );
    },
    []
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }

      if (event.key === "Escape") {
        setCommandPaletteOpen(false);
        closeEvidence();
        setDismissIssueDraft(null);
        setConfirmClaimDraft(null);
        return;
      }

      if (isEditableElement(event.target)) {
        return;
      }

      if (event.key === "[") {
        event.preventDefault();
        setActiveSection((current) => nextSection(current, -1));
        return;
      }

      if (event.key === "]") {
        event.preventDefault();
        setActiveSection((current) => nextSection(current, 1));
        return;
      }

      const listJump = event.key.toLowerCase();
      if (listJump !== "j" && listJump !== "k" && event.key !== "Enter") {
        return;
      }

      if (activeSection === "scenes" && scenes.length > 0) {
        const currentIndex = scenes.findIndex((scene) => scene.id === selectedSceneId);
        const safeIndex = currentIndex < 0 ? 0 : currentIndex;
        const nextIndex =
          listJump === "j"
            ? Math.min(safeIndex + 1, scenes.length - 1)
            : listJump === "k"
              ? Math.max(safeIndex - 1, 0)
              : safeIndex;
        const target = scenes[nextIndex];
        if (!target) {
          return;
        }
        if (event.key === "Enter") {
          void onSelectScene(target.id);
        } else {
          setSelectedSceneId(target.id);
        }
      }

      if (activeSection === "issues" && issues.length > 0) {
        const currentIndex = issues.findIndex((issue) => issue.id === selectedIssueId);
        const safeIndex = currentIndex < 0 ? 0 : currentIndex;
        const nextIndex =
          listJump === "j"
            ? Math.min(safeIndex + 1, issues.length - 1)
            : listJump === "k"
              ? Math.max(safeIndex - 1, 0)
              : safeIndex;
        const target = issues[nextIndex];
        if (!target) {
          return;
        }
        if (event.key === "Enter") {
          openEvidence(target.title, target.evidence, { source: "issue", sourceId: target.id });
        } else {
          onSelectIssue(target.id);
        }
      }

      if (activeSection === "bible" && entities.length > 0) {
        const currentIndex = entities.findIndex((entity) => entity.id === selectedEntityId);
        const safeIndex = currentIndex < 0 ? 0 : currentIndex;
        const nextIndex =
          listJump === "j"
            ? Math.min(safeIndex + 1, entities.length - 1)
            : listJump === "k"
              ? Math.max(safeIndex - 1, 0)
              : safeIndex;
        const target = entities[nextIndex];
        if (!target) {
          return;
        }
        if (event.key === "Enter") {
          void onSelectEntity(target.id);
        } else {
          setSelectedEntityId(target.id);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    activeSection,
    closeEvidence,
    entities,
    issues,
    onSelectEntity,
    onSelectIssue,
    onSelectScene,
    openEvidence,
    scenes,
    selectedEntityId,
    selectedIssueId,
    selectedSceneId
  ]);

  const statusLabel = useMemo(() => {
    if (!status) {
      return "Disconnected";
    }
    const phaseLabel = status.phase === "idle" ? "Idle" : status.phase;
    const details = [phaseLabel];
    if (status.activeJobLabel) {
      const stripped = status.activeJobLabel.replace(
        /^(.+?\s·\s).*[/\\]([^/\\]+)$/,
        "$1$2"
      );
      details.push(stripped);
    }
    if (status.workerState && status.workerState !== "ready") {
      details.push(status.workerState);
    }
    return details.join(" · ");
  }, [status]);

  const onOpenEvidenceFromScene = useCallback((title: string, detail: SceneDetail) => {
    openEvidence(title, detail.evidence, { source: "scene", sourceId: detail.scene.id });
  }, [openEvidence]);

  const onOpenEvidenceFromIssue = useCallback((title: string, issue: IssueSummary) => {
    openEvidence(title, issue.evidence, { source: "issue", sourceId: issue.id });
  }, [openEvidence]);

  const onOpenEvidenceFromClaim = useCallback(
    (
      title: string,
      detail: { evidence: EntityDetail["claims"][number]["evidence"] },
      context: { sourceId: string }
    ) => {
      openEvidence(title, detail.evidence, { source: "claim", sourceId: context.sourceId });
    },
    [openEvidence]
  );

  const onCommandSelect = useCallback(
    (id: string) => {
      if (id === "jump.issue") {
        if (!continueContext.issueId) {
          pushToast({ message: "No recent issue to resume.", tone: "info" });
          return;
        }
        setActiveSection("issues");
        setSelectedIssueId(continueContext.issueId);
        return;
      }
      if (id === "jump.entity") {
        if (!continueContext.entityId) {
          pushToast({ message: "No recent entity to resume.", tone: "info" });
          return;
        }
        setActiveSection("bible");
        void onSelectEntity(continueContext.entityId);
        return;
      }
      if (id === "jump.scene") {
        if (!continueContext.sceneId) {
          pushToast({ message: "No recent scene to resume.", tone: "info" });
          return;
        }
        setActiveSection("scenes");
        void onSelectScene(continueContext.sceneId);
        return;
      }
      if (id === "run.diagnostics") {
        void runDiagnostics();
        return;
      }
      if (APP_SECTIONS.some((section) => section.id === id)) {
        setActiveSection(id as AppSection);
      }
    },
    [
      continueContext.entityId,
      continueContext.issueId,
      continueContext.sceneId,
      onSelectEntity,
      onSelectScene,
      pushToast,
      runDiagnostics
    ]
  );

  const onForgetLastProject = useCallback(() => {
    if (!sessionRef.current) return;
    const next = setGlobalState(sessionRef.current, {
      lastProjectRoot: null,
      lastProjectId: null,
      lastProjectName: null
    });
    sessionRef.current = next;
    saveSession(next);
    pushToast({ message: "Last project forgotten. Next launch will start fresh.", tone: "success" });
  }, [pushToast]);

  const onResetProjectState = useCallback(() => {
    if (!sessionRef.current || !project) return;
    const next = clearProjectState(sessionRef.current, project.id);
    sessionRef.current = next;
    saveSession(next);
    applyProjectUIState(DEFAULT_PROJECT_STATE);
    pushToast({ message: "Saved state for this project has been reset.", tone: "success" });
  }, [applyProjectUIState, project, pushToast]);

  return {
    bootState,
    bootError,
    clearBootError,
    skipBoot,
    showWelcome,
    dismissWelcome,
    onWelcomeGetStarted,
    activeSection,
    setActiveSection,
    status,
    statusLabel,
    project,
    processingState,
    history,
    lastIngest,
    projectStats,
    evidenceCoverage,
    rootPath,
    setRootPath,
    docPath,
    setDocPath,
    searchQuery,
    setSearchQuery,
    searchResults,
    questionText,
    setQuestionText,
    askResult,
    scenes,
    scenesLoaded,
    selectedSceneId,
    sceneDetail,
    sceneQuery,
    setSceneQuery,
    issues,
    issuesLoaded,
    selectedIssueId,
    issueFilters,
    setIssueFilters,
    styleReport,
    styleIssues,
    styleLoaded,
    entities,
    entitiesLoaded,
    selectedEntityId,
    entityDetail,
    entityFilters,
    setEntityFilters,
    exportDir,
    setExportDir,
    exportKind,
    setExportKind,
    healthCheck,
    busy,
    isBusy,
    errors,
    dismissError,
    clearAllErrors,
    toasts,
    dismissToast,
    evidenceDrawer,
    setEvidenceDrawer,
    activeEvidenceContext,
    evidencePinned,
    setEvidencePinned,
    closeEvidence,
    commandPaletteOpen,
    setCommandPaletteOpen,
    layoutMode,
    mobileNavOpen,
    setMobileNavOpen,
    sidebarCollapsed,
    setSidebarCollapsed: (collapsed: boolean) => {
      setSidebarCollapsedRaw(collapsed);
    },
    confirmClaimDraft,
    setConfirmClaimDraft,
    dismissIssueDraft,
    setDismissIssueDraft,
    lastExportResult,
    continueContext,
    onJumpToIssue: () => setActiveSection("issues"),
    onJumpToEntity: () => setActiveSection("bible"),
    onJumpToScene: () => setActiveSection("scenes"),
    hydrateProjectData,
    onCreateProject,
    onPickProjectRoot,
    onPickDocument,
    onUseFixture,
    onAddDocument,
    onSearch,
    onAsk,
    onSelectScene,
    onSelectIssue,
    onRequestDismissIssue,
    onConfirmDismissIssue,
    onResolveIssue,
    onSelectEntity,
    onConfirmClaim,
    onPickExportDir,
    onRunExport,
    onRunDiagnostics: runDiagnostics,
    onForgetLastProject,
    onResetProjectState,
    refreshScenes,
    refreshIssues,
    refreshStyle,
    refreshEntities,
    onOpenEvidenceFromScene,
    onOpenEvidenceFromIssue,
    onOpenEvidenceFromClaim,
    openEvidence,
    onCommandSelect
  };
}

export type { EntityFilters, IssueFilters };
