import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addDocument,
  askQuestion,
  confirmClaim,
  createOrOpenProject,
  dismissIssue,
  getBundledFixturePath,
  getProjectDiagnostics,
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
  subscribeProjectStatus,
  undoDismissIssue,
  type AskResponse,
  type EntityDetail,
  type EntitySummary,
  type EvidenceItem,
  type ExportResult,
  type IngestResult,
  type IssueSummary,
  type ProjectDiagnostics,
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

type IssueFilters = {
  status: "open" | "dismissed" | "resolved" | "all";
  severity: "all" | "low" | "medium" | "high";
  type: string;
  query: string;
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

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeStorage<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage errors
  }
}

function nextSection(current: AppSection, delta: number): AppSection {
  const index = APP_SECTIONS.findIndex((section) => section.id === current);
  if (index < 0) {
    return "dashboard";
  }
  const next = (index + delta + APP_SECTIONS.length) % APP_SECTIONS.length;
  return APP_SECTIONS[next]!.id;
}

function toUserFacingError(code: string, err: unknown, actionLabel?: string, action?: string): UserFacingError {
  return {
    code,
    message: err instanceof Error ? err.message : "Unknown error",
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
  const [activeSection, setActiveSection] = useState<AppSection>(() =>
    readStorage<AppSection>("canonkeeper.activeSection", "dashboard")
  );
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

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchQueryResponse | null>(null);
  const [questionText, setQuestionText] = useState("");
  const [askResult, setAskResult] = useState<AskResponse | null>(null);

  const [scenes, setScenes] = useState<SceneSummary[]>([]);
  const [selectedSceneId, setSelectedSceneId] = useState<string>(() =>
    readStorage<string>("canonkeeper.selectedSceneId", "")
  );
  const [sceneDetail, setSceneDetail] = useState<SceneDetail | null>(null);
  const [sceneQuery, setSceneQuery] = useState("");

  const [issues, setIssues] = useState<IssueSummary[]>([]);
  const [selectedIssueId, setSelectedIssueId] = useState<string>(() =>
    readStorage<string>("canonkeeper.selectedIssueId", "")
  );
  const [issueFilters, setIssueFilters] = useState<IssueFilters>(() =>
    readStorage<IssueFilters>("canonkeeper.issueFilters", {
      status: "open",
      severity: "all",
      type: "",
      query: ""
    })
  );

  const [styleReport, setStyleReport] = useState<StyleReport | null>(null);
  const [styleIssues, setStyleIssues] = useState<IssueSummary[]>([]);

  const [entities, setEntities] = useState<EntitySummary[]>([]);
  const [selectedEntityId, setSelectedEntityId] = useState<string>(() =>
    readStorage<string>("canonkeeper.selectedEntityId", "")
  );
  const [entityDetail, setEntityDetail] = useState<EntityDetail | null>(null);
  const [entityFilters, setEntityFilters] = useState<EntityFilters>(() =>
    readStorage<EntityFilters>("canonkeeper.entityFilters", {
      type: "",
      status: "all",
      query: ""
    })
  );

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
  const [error, setError] = useState<UserFacingError | null>(null);
  const [pendingActions, setPendingActions] = useState<string[]>([]);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() =>
    typeof window === "undefined" ? "desktop" : computeLayoutMode(window.innerWidth)
  );
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsedRaw] = useState(() =>
    readStorage<boolean>("canonkeeper.sidebarCollapsed", false)
  );

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

  const [continueContext, setContinueContext] = useState<ContinueContext>(() =>
    readStorage<ContinueContext>("canonkeeper.continueContext", {
      issueId: null,
      entityId: null,
      sceneId: null
    })
  );

  const lastWorkerState = useRef<"idle" | "busy" | "unknown">("unknown");

  const busy = pendingActions.length > 0;

  const pushToast = useCallback((toast: Omit<ToastItem, "id">) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((current) => [...current, { ...toast, id }]);
    setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 10_000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const beginAction = useCallback((label: string) => {
    setPendingActions((current) => [...current, label]);
  }, []);

  const endAction = useCallback((label: string) => {
    setPendingActions((current) => {
      const index = current.indexOf(label);
      if (index < 0) {
        return current;
      }
      return [...current.slice(0, index), ...current.slice(index + 1)];
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

  const refreshScenes = useCallback(async () => {
    const list = await listScenes();
    setScenes(list);
    if (selectedSceneId && !list.some((scene) => scene.id === selectedSceneId)) {
      setSelectedSceneId("");
      setSceneDetail(null);
    }
  }, [selectedSceneId]);

  const refreshIssues = useCallback(async () => {
    const list = await listIssues({
      status: issueFilters.status,
      type: issueFilters.type || undefined,
      severity: issueFilters.severity === "all" ? undefined : issueFilters.severity
    });
    setIssues(list);
    if (selectedIssueId && !list.some((issue) => issue.id === selectedIssueId)) {
      setSelectedIssueId("");
    }
  }, [issueFilters, selectedIssueId]);

  const refreshStyle = useCallback(async () => {
    const report = await getStyleReport();
    setStyleReport(report);
    const list = await listIssues({ status: "all" });
    setStyleIssues(list.filter((issue) => ["repetition", "tone_drift", "dialogue_tic"].includes(issue.type)));
  }, []);

  const refreshEntities = useCallback(async () => {
    const list = await listEntities();
    setEntities(list);
    if (selectedEntityId && !list.some((entity) => entity.id === selectedEntityId)) {
      setSelectedEntityId("");
      setEntityDetail(null);
    }
  }, [selectedEntityId]);

  const refreshAll = useCallback(async () => {
    if (!project) {
      return;
    }
    await Promise.all([
      refreshProcessingAndHistory(),
      refreshScenes(),
      refreshIssues(),
      refreshStyle(),
      refreshEntities()
    ]);
  }, [project, refreshEntities, refreshIssues, refreshProcessingAndHistory, refreshScenes, refreshStyle]);

  const setAppError = useCallback((code: string, err: unknown, actionLabel?: string, action?: string) => {
    setError(toUserFacingError(code, err, actionLabel, action));
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  useEffect(() => {
    writeStorage("canonkeeper.activeSection", activeSection);
    setMobileNavOpen(false);
    if (!evidencePinned) {
      setEvidenceDrawer((current) => ({ ...current, open: false }));
      setActiveEvidenceContext(null);
    }
  }, [activeSection, evidencePinned]);

  useEffect(() => {
    const onResize = () => {
      setLayoutMode(computeLayoutMode(window.innerWidth));
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    writeStorage("canonkeeper.issueFilters", issueFilters);
  }, [issueFilters]);

  useEffect(() => {
    writeStorage("canonkeeper.entityFilters", entityFilters);
  }, [entityFilters]);

  useEffect(() => {
    writeStorage("canonkeeper.selectedSceneId", selectedSceneId);
  }, [selectedSceneId]);

  useEffect(() => {
    writeStorage("canonkeeper.selectedIssueId", selectedIssueId);
  }, [selectedIssueId]);

  useEffect(() => {
    writeStorage("canonkeeper.selectedEntityId", selectedEntityId);
  }, [selectedEntityId]);

  useEffect(() => {
    writeStorage("canonkeeper.continueContext", continueContext);
  }, [continueContext]);

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
            void refreshAll();
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
  }, [project, refreshAll]);

  const runDiagnostics = useCallback(async () => {
    const action = "diagnostics";
    beginAction(action);
    clearError();
    try {
      const result = await getProjectDiagnostics();
      setHealthCheck(result);
      if (result.details.length === 0) {
        pushToast({ message: "Diagnostics passed.", tone: "success" });
      }
    } catch (err) {
      setAppError("DIAGNOSTICS_FAILED", err, "Retry", "runDiagnostics");
    } finally {
      endAction(action);
    }
  }, [beginAction, clearError, endAction, pushToast, setAppError]);

  useEffect(() => {
    void runDiagnostics();
  }, [runDiagnostics]);

  const onCreateProject = useCallback(async () => {
    const action = "createProject";
    beginAction(action);
    clearError();
    try {
      const created = await createOrOpenProject({ rootPath: rootPath.trim() });
      setProject(created);
      await refreshAll();
      pushToast({ message: `Project ready: ${created.name}`, tone: "success" });
    } catch (err) {
      setAppError("PROJECT_OPEN_FAILED", err, "Run Diagnostics", "runDiagnostics");
    } finally {
      endAction(action);
    }
  }, [beginAction, clearError, endAction, pushToast, refreshAll, rootPath, setAppError]);

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
        setError({ code: "FIXTURE_NOT_FOUND", message: "Bundled fixture not found." });
      }
    } catch (err) {
      setAppError("FIXTURE_LOAD_FAILED", err);
    }
  }, [setAppError]);

  const onAddDocument = useCallback(async () => {
    const action = "addDocument";
    beginAction(action);
    clearError();
    try {
      const result = await addDocument({ path: docPath.trim() });
      setLastIngest(result);
      await refreshAll();
      pushToast({ message: "Document ingested.", tone: "success" });
    } catch (err) {
      setAppError("INGEST_FAILED", err);
    } finally {
      endAction(action);
    }
  }, [beginAction, clearError, docPath, endAction, pushToast, refreshAll, setAppError]);

  const onSearch = useCallback(async () => {
    const action = "search";
    beginAction(action);
    clearError();
    try {
      const result = await querySearch(searchQuery.trim());
      setSearchResults(result);
    } catch (err) {
      setAppError("SEARCH_FAILED", err);
    } finally {
      endAction(action);
    }
  }, [beginAction, clearError, endAction, searchQuery, setAppError]);

  const onAsk = useCallback(async () => {
    const action = "ask";
    beginAction(action);
    clearError();
    try {
      const result = await askQuestion(questionText.trim());
      setAskResult(result);
    } catch (err) {
      setAppError("ASK_FAILED", err);
    } finally {
      endAction(action);
    }
  }, [beginAction, clearError, endAction, questionText, setAppError]);

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
    const action = "dismissIssue";
    beginAction(action);
    clearError();
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
      endAction(action);
    }
  }, [beginAction, clearError, dismissIssueDraft, endAction, pushToast, refreshIssues, setAppError]);

  const onResolveIssue = useCallback(
    async (issueId: string) => {
      const action = "resolveIssue";
      beginAction(action);
      clearError();
      try {
        await resolveIssue(issueId);
        await refreshIssues();
        pushToast({ message: "Issue resolved.", tone: "success" });
      } catch (err) {
        setAppError("ISSUE_RESOLVE_FAILED", err);
      } finally {
        endAction(action);
      }
    },
    [beginAction, clearError, endAction, pushToast, refreshIssues, setAppError]
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
    const action = "confirmClaim";
    beginAction(action);
    clearError();
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
      endAction(action);
    }
  }, [beginAction, clearError, confirmClaimDraft, endAction, entityDetail, pushToast, setAppError]);

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
    const action = "export";
    beginAction(action);
    clearError();
    try {
      const result = await runExport(exportDir.trim(), exportKind);
      setLastExportResult(result);
      if (result.ok) {
        pushToast({ message: `Export complete (${result.files.length} files).`, tone: "success" });
      } else {
        setError({ code: "EXPORT_FAILED", message: result.error });
      }
    } catch (err) {
      setAppError("EXPORT_FAILED", err);
    } finally {
      endAction(action);
    }
  }, [beginAction, clearError, endAction, exportDir, exportKind, pushToast, setAppError]);

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
      details.push(status.activeJobLabel);
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

  return {
    activeSection,
    setActiveSection,
    status,
    statusLabel,
    project,
    processingState,
    history,
    lastIngest,
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
    selectedSceneId,
    sceneDetail,
    sceneQuery,
    setSceneQuery,
    issues,
    selectedIssueId,
    issueFilters,
    setIssueFilters,
    styleReport,
    styleIssues,
    entities,
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
    error,
    clearError,
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
      writeStorage("canonkeeper.sidebarCollapsed", collapsed);
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
