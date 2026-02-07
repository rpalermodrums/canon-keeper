import type { RpcRequest, RpcResponse, WorkerMethods } from "./rpc";
import {
  createProject,
  getProjectByRootPath,
  listEntities,
  listDocuments,
  type ListIssueFilters,
  listIssues,
  listIssuesWithEvidence,
  listScenesForProject,
  openDatabase,
  dismissIssue,
  undoDismissIssue,
  resolveIssue,
  undoResolveIssue,
  touchProject,
  logEvent,
  getQueueDepth,
  listProcessingStates,
  listEvents,
  listSnapshotSummaries,
  markDocumentMissing,
  markDocumentSeen,
  getDocumentByPath,
  countChunksForProject,
  countDocumentsForProject,
  countIssueEvidenceCoverage,
  countSceneEvidenceCoverage,
  listQueuedJobs,
  cancelJob
} from "./storage";
import { ingestDocument } from "./pipeline/ingest";
import { PersistentJobQueue } from "./jobs/persistentQueue";
import type { WorkerJob, WorkerJobResult } from "./jobs/types";
import chokidar, { type FSWatcher } from "chokidar";
import fs from "node:fs";
import { searchChunks } from "./search/fts";
import { askQuestion } from "./search/ask";
import { getStyleReport } from "./style/report";
import { getEntityDetail } from "./bible";
import { confirmClaim } from "./canon";
import { exportProject } from "./export/exporter";
import type { DatabaseHandle } from "./storage";
import { getSceneDetail } from "./scenes";
import {
  addDocumentToConfig,
  ensureProjectConfig,
  loadProjectConfig,
  resolveDocumentPath
} from "./config";
import { runSceneStage } from "./pipeline/stages/scenes";
import { runStyleStage } from "./pipeline/stages/style";
import { runExtractionStage } from "./pipeline/stages/extraction";
import { runContinuityStage } from "./pipeline/stages/continuity";
import { runContinuityChecks } from "./pipeline/continuity";
import path from "node:path";
import { createRequire } from "node:module";

export type WorkerPhase =
  | "idle"
  | "ingest"
  | "extract"
  | "style"
  | "continuity"
  | "export"
  | "error";

export type WorkerStatus = {
  state: "idle" | "busy";
  phase: WorkerPhase;
  lastJob?: string;
  activeJobLabel: string | null;
  queueDepth?: number;
  projectId?: string | null;
  lastSuccessfulRunAt: string | null;
  lastError: { subsystem: string; message: string } | null;
};

export type SystemHealthCheck = {
  ipc: "ok" | "down";
  worker: "ok" | "down";
  sqlite: "ok" | "missing_native" | "error";
  writable: "ok" | "error";
  details: string[];
};

export type ProjectDiagnostics = SystemHealthCheck & {
  recommendations: string[];
};

function createInitialStatus(): WorkerStatus {
  return {
    state: "idle",
    phase: "idle",
    activeJobLabel: null,
    queueDepth: 0,
    projectId: null,
    lastSuccessfulRunAt: null,
    lastError: null
  };
}

let status: WorkerStatus = createInitialStatus();
let currentProjectId: string | null = null;
let currentProjectRoot: string | null = null;
let lastSuccessfulRunAt: string | null = null;
let statusError: { subsystem: string; message: string } | null = null;
export type WorkerSession = {
  handle: DatabaseHandle;
  watcher: FSWatcher;
  queue: PersistentJobQueue<WorkerJob, WorkerJobResult>;
  rootPath: string;
  projectId: string | null;
};
let session: WorkerSession | null = null;
const debounceTimers = new Map<string, NodeJS.Timeout>();
const requireFromEsm = createRequire(import.meta.url);

function mapPhase(lastJob: string | undefined, state: "idle" | "busy"): WorkerPhase {
  if (statusError && state === "idle") {
    return "error";
  }
  if (state === "idle") {
    return "idle";
  }

  switch (lastJob) {
    case "INGEST_DOCUMENT":
    case "project.addDocument":
      return "ingest";
    case "RUN_SCENES":
    case "RUN_EXTRACTION":
      return "extract";
    case "RUN_STYLE":
      return "style";
    case "RUN_CONTINUITY":
      return "continuity";
    case "export.run":
      return "export";
    default:
      return "extract";
  }
}

function toActiveJobLabel(lastJob?: string): string | null {
  switch (lastJob) {
    case "INGEST_DOCUMENT":
    case "project.addDocument":
      return "Ingest manuscript";
    case "RUN_SCENES":
      return "Rebuild scene index";
    case "RUN_EXTRACTION":
      return "Extract entities and claims";
    case "RUN_STYLE":
      return "Refresh style diagnostics";
    case "RUN_CONTINUITY":
      return "Run continuity checks";
    case "export.run":
      return "Export project";
    case "project.createOrOpen":
      return "Open project";
    case "project.getProcessingState":
      return "Load processing timeline";
    case "project.getHistory":
      return "Load event history";
    default:
      return null;
  }
}

function toStatusError(subsystem: string, error: unknown): { subsystem: string; message: string } {
  return {
    subsystem,
    message: error instanceof Error ? error.message : "Unknown error"
  };
}

function setStatus(next: { state: "idle" | "busy"; lastJob?: string; phase?: WorkerPhase }): void {
  status = {
    ...status,
    state: next.state,
    lastJob: next.lastJob,
    phase: next.phase ?? mapPhase(next.lastJob, next.state),
    activeJobLabel: toActiveJobLabel(next.lastJob),
    queueDepth: status.queueDepth ?? 0,
    projectId: currentProjectId,
    lastSuccessfulRunAt,
    lastError: statusError
  };
}

function markSuccess(): void {
  lastSuccessfulRunAt = new Date().toISOString();
  statusError = null;
}

function markFailure(subsystem: string, error: unknown): void {
  statusError = toStatusError(subsystem, error);
}

function getStatus(): WorkerStatus {
  return {
    ...status,
    queueDepth: session ? getQueueDepth(session.handle.db) : 0,
    projectId: currentProjectId,
    lastSuccessfulRunAt,
    lastError: statusError
  };
}

function runSystemHealthCheck(): SystemHealthCheck {
  const details: string[] = [];

  const ipc: "ok" | "down" = process.send ? "ok" : "down";
  if (ipc === "down") {
    details.push("Worker IPC channel is unavailable.");
  }

  let sqlite: "ok" | "missing_native" | "error" = "ok";
  try {
    const BetterSqlite = requireFromEsm("better-sqlite3") as {
      new (filename: string): { close: () => void };
    };
    const testDb = new BetterSqlite(":memory:");
    testDb.close();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown sqlite error";
    if (message.includes("NODE_MODULE_VERSION") || message.includes("better_sqlite3.node")) {
      sqlite = "missing_native";
      details.push(
        "SQLite native module mismatch. Reinstall dependencies for this runtime with `bun install` (or `npm rebuild better-sqlite3`)."
      );
    } else {
      sqlite = "error";
      details.push(`SQLite check failed: ${message}`);
    }
  }

  const writableTarget = currentProjectRoot ?? process.cwd();
  let writable: "ok" | "error" = "ok";
  try {
    fs.accessSync(writableTarget, fs.constants.R_OK | fs.constants.W_OK);
  } catch (error) {
    writable = "error";
    const message = error instanceof Error ? error.message : "Unknown filesystem error";
    details.push(`Cannot write to ${writableTarget}: ${message}`);
  }

  return {
    ipc,
    worker: "ok",
    sqlite,
    writable,
    details
  };
}

function getProjectDiagnostics(): ProjectDiagnostics {
  const health = runSystemHealthCheck();
  const recommendations = [...health.details];

  if (health.details.length === 0) {
    recommendations.push("Environment checks passed. Add manuscript files to begin ingestion.");
  }
  if (health.worker !== "ok") {
    recommendations.push("Restart CanonKeeper to recover the worker process.");
  }
  if (health.writable !== "ok") {
    recommendations.push("Choose a project folder with read/write permissions.");
  }

  return {
    ...health,
    recommendations
  };
}

async function teardownSession(): Promise<void> {
  for (const timer of debounceTimers.values()) {
    clearTimeout(timer);
  }
  debounceTimers.clear();

  if (!session) {
    return;
  }
  session.queue.stop();
  try {
    await session.watcher.close();
  } catch {
    // best effort shutdown
  }
  try {
    session.handle.db.close();
  } catch {
    // best effort shutdown
  }
  session = null;
  currentProjectId = null;
  currentProjectRoot = null;
}

function createWatcher(): FSWatcher {
  const next = chokidar.watch([], { ignoreInitial: true });
  next.on("add", (filePath) => {
    if (!session?.projectId) return;
    handleFileAdd(filePath, session.projectId);
  });
  next.on("change", (filePath) => {
    if (!session?.projectId) return;
    handleFileChange(filePath, session.projectId);
  });
  next.on("unlink", (filePath) => {
    if (!session?.projectId) return;
    handleFileUnlink(filePath, session.projectId);
  });
  return next;
}

async function ensureSession(rootPath: string): Promise<WorkerSession> {
  if (session && session.rootPath === rootPath) {
    return session;
  }
  if (session && session.rootPath !== rootPath) {
    await teardownSession();
  }
  const handle = openDatabase({ rootPath });
  const queue = new PersistentJobQueue<WorkerJob, WorkerJobResult>(handle.db, handleJob);
  queue.start();
  const watcher = createWatcher();
  session = {
    handle,
    watcher,
    queue,
    rootPath,
    projectId: null
  };
  return session;
}

function requireSession(): WorkerSession {
  if (!session) {
    throw new Error("Project not initialized");
  }
  return session;
}

async function handleJob(job: WorkerJob): Promise<WorkerJobResult> {
  const active = requireSession();
  const db = active.handle.db;
  setStatus({ state: "busy", lastJob: job.type });
  const projectId = (job.payload as { projectId: string }).projectId;
  logEvent(db, {
    projectId,
    level: "info",
    eventType: "job_started",
    payload: { type: job.type }
  });

  try {
    let result: WorkerJobResult;
    switch (job.type) {
      case "INGEST_DOCUMENT": {
        if (!active.rootPath) {
          throw new Error("Project root not initialized");
        }
        result = await ingestDocument(db, {
          projectId,
          rootPath: active.rootPath,
          filePath: job.payload.filePath
        });

        if (
          result.snapshotCreated &&
          result.changeStart !== null &&
          result.changeEnd !== null
        ) {
          active.queue.enqueue(
            {
              type: "RUN_SCENES",
              payload: {
                projectId,
                documentId: result.documentId,
                snapshotId: result.snapshotId,
                rootPath: active.rootPath
              }
            },
            `scenes:${projectId}:${result.documentId}`
          );
          active.queue.enqueue(
            {
              type: "RUN_STYLE",
              payload: {
                projectId,
                documentId: result.documentId,
                snapshotId: result.snapshotId,
                rootPath: active.rootPath
              }
            },
            `style:${projectId}:${result.documentId}`
          );
          active.queue.enqueue(
            {
              type: "RUN_EXTRACTION",
              payload: {
                projectId,
                documentId: result.documentId,
                snapshotId: result.snapshotId,
                rootPath: active.rootPath,
                changeStart: result.changeStart,
                changeEnd: result.changeEnd
              }
            },
            `extraction:${projectId}:${result.documentId}`
          );
        }
        break;
      }
      case "RUN_SCENES": {
        const payload = job.payload;
        await runSceneStage({
          db,
          projectId: payload.projectId,
          documentId: payload.documentId,
          snapshotId: payload.snapshotId,
          rootPath: payload.rootPath
        });
        result = { ok: true };
        break;
      }
      case "RUN_STYLE": {
        const payload = job.payload;
        runStyleStage({
          db,
          projectId: payload.projectId,
          documentId: payload.documentId,
          snapshotId: payload.snapshotId,
          rootPath: payload.rootPath
        });
        result = { ok: true };
        break;
      }
      case "RUN_EXTRACTION": {
        const payload = job.payload;
        const extractionResult = await runExtractionStage({
          db,
          projectId: payload.projectId,
          documentId: payload.documentId,
          snapshotId: payload.snapshotId,
          rootPath: payload.rootPath,
          changeStart: payload.changeStart,
          changeEnd: payload.changeEnd
        });

        active.queue.enqueue(
          {
            type: "RUN_CONTINUITY",
            payload: {
              projectId: payload.projectId,
              documentId: payload.documentId,
              snapshotId: payload.snapshotId,
              rootPath: payload.rootPath,
              entityIds: extractionResult.touchedEntityIds
            }
          },
          `continuity:${payload.projectId}:${payload.documentId}`
        );
        result = { ok: true };
        break;
      }
      case "RUN_CONTINUITY": {
        const payload = job.payload;
        runContinuityStage({
          db,
          projectId: payload.projectId,
          documentId: payload.documentId,
          snapshotId: payload.snapshotId,
          rootPath: payload.rootPath,
          entityIds: payload.entityIds
        });
        result = { ok: true };
        break;
      }
      default:
        throw new Error("Unknown job type");
    }

    logEvent(db, {
      projectId,
      level: "info",
      eventType: "job_finished",
      payload: { type: job.type }
    });

    markSuccess();
    return result;
  } catch (error) {
    markFailure(`pipeline.${job.type.toLowerCase()}`, error);
    logEvent(db, {
      projectId,
      level: "error",
      eventType: "job_failed",
      payload: {
        type: job.type,
        message: error instanceof Error ? error.message : "Unknown error"
      }
    });
    throw error;
  } finally {
    setStatus({ state: "idle", lastJob: job.type });
  }
}

async function handleCreateOrOpen(params: {
  rootPath: string;
  name?: string;
  createIfMissing?: boolean;
}): Promise<unknown> {
  const { name, createIfMissing } = params;
  const rootPath = path.resolve(params.rootPath);
  if (createIfMissing === false) {
    const dbPath = path.join(rootPath, ".canonkeeper", "canonkeeper.db");
    if (!fs.existsSync(dbPath)) {
      return null;
    }
  }
  const active = await ensureSession(rootPath);
  const existing = getProjectByRootPath(active.handle.db, rootPath);
  if (existing) {
    ensureProjectConfig(rootPath);
    touchProject(active.handle.db, existing.id);
    currentProjectId = existing.id;
    currentProjectRoot = rootPath;
    active.projectId = existing.id;
    ensureWatcher(active.handle.db, existing.id, active.watcher);
    registerConfigDocuments(existing.id, rootPath);
    return existing;
  }

  if (createIfMissing === false) {
    return null;
  }

  ensureProjectConfig(rootPath);
  const created = createProject(active.handle.db, rootPath, name);
  currentProjectId = created.id;
  currentProjectRoot = rootPath;
  active.projectId = created.id;
  ensureWatcher(active.handle.db, created.id, active.watcher);
  registerConfigDocuments(created.id, rootPath);
  return created;
}

function ensureWatcher(db: DatabaseHandle["db"], projectId: string, projectWatcher: FSWatcher): void {
  const documents = listDocuments(db, projectId);
  for (const doc of documents) {
    projectWatcher.add(doc.path);
  }
}

function registerConfigDocuments(projectId: string, rootPath: string): void {
  const active = session;
  if (!active) {
    return;
  }
  const config = loadProjectConfig(rootPath);
  for (const entry of config.documents) {
    const filePath = resolveDocumentPath(rootPath, entry);
    const existing = getDocumentByPath(active.handle.db, projectId, filePath);
    if (!fs.existsSync(filePath)) {
      if (existing) {
        markDocumentMissing(active.handle.db, existing.id);
      }
      continue;
    }
    active.watcher.add(filePath);
    if (existing) {
      markDocumentSeen(active.handle.db, existing.id);
    }
    void enqueueIngest(filePath, projectId);
  }
}

function scheduleIngest(filePath: string, projectId: string): void {
  const active = session;
  if (!active || active.projectId !== projectId) {
    return;
  }
  const existing = getDocumentByPath(active.handle.db, projectId, filePath);
  if (existing?.is_missing) {
    return;
  }
  logEvent(active.handle.db, {
    projectId,
    level: "info",
    eventType: "file_changed",
    payload: { filePath }
  });
  const existingTimer = debounceTimers.get(filePath);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  const timer = setTimeout(() => {
    debounceTimers.delete(filePath);
    enqueueIngest(filePath, projectId);
  }, 2000);
  debounceTimers.set(filePath, timer);
}

function handleFileAdd(filePath: string, projectId: string): void {
  const active = session;
  if (!active || active.projectId !== projectId) {
    return;
  }
  const existing = getDocumentByPath(active.handle.db, projectId, filePath);
  if (existing) {
    markDocumentSeen(active.handle.db, existing.id);
  }
  scheduleIngest(filePath, projectId);
}

function handleFileChange(filePath: string, projectId: string): void {
  scheduleIngest(filePath, projectId);
}

function handleFileUnlink(filePath: string, projectId: string): void {
  const active = session;
  if (!active || active.projectId !== projectId) {
    return;
  }
  const existing = getDocumentByPath(active.handle.db, projectId, filePath);
  if (existing) {
    markDocumentMissing(active.handle.db, existing.id);
  }
  logEvent(active.handle.db, {
    projectId,
    level: "warn",
    eventType: "file_missing",
    payload: { filePath }
  });
}

function enqueueIngest(filePath: string, projectId: string, awaitResult = false): Promise<WorkerJobResult> | null {
  const active = session;
  if (!active || active.projectId !== projectId) {
    return null;
  }
  const job: WorkerJob = { type: "INGEST_DOCUMENT", payload: { projectId, filePath } };
  return active.queue.enqueue(job, `ingest:${projectId}:${filePath}`, awaitResult);
}

const NON_BUSY_RPC_METHODS = new Set<WorkerMethods>([
  "project.getStatus",
  "project.subscribeStatus",
  "project.getCurrent",
  "project.getDiagnostics",
  "project.stats",
  "project.evidenceCoverage",
  "jobs.list"
]);

export function shouldTrackRpcAsBusy(method: WorkerMethods | string): boolean {
  return !NON_BUSY_RPC_METHODS.has(method as WorkerMethods);
}

async function dispatch(method: WorkerMethods, params?: unknown): Promise<unknown> {
  switch (method) {
    case "project.createOrOpen":
      if (!params || typeof params !== "object") {
        throw new Error("Missing params for project.createOrOpen");
      }
      return await handleCreateOrOpen(
        params as { rootPath: string; name?: string; createIfMissing?: boolean }
      );
    case "project.getCurrent":
      if (!session || !currentProjectId) {
        return null;
      }
      return getProjectByRootPath(session.handle.db, currentProjectRoot!);
    case "project.getStatus":
      return getStatus();
    case "project.subscribeStatus":
      return getStatus();
    case "project.getDiagnostics":
      return getProjectDiagnostics();
    case "system.healthCheck":
      return runSystemHealthCheck();
    case "project.getProcessingState":
      if (!session || !currentProjectId) {
        throw new Error("Project not initialized");
      }
      return listProcessingStates(session.handle.db, currentProjectId);
    case "project.getHistory":
      if (!session || !currentProjectId) {
        throw new Error("Project not initialized");
      }
      return {
        snapshots: listSnapshotSummaries(session.handle.db, currentProjectId, 50),
        events: listEvents(session.handle.db, currentProjectId, 100)
      };
    case "project.stats":
      if (!session || !currentProjectId) {
        throw new Error("Project not initialized");
      }
      return {
        totalPassages: countChunksForProject(session.handle.db, currentProjectId),
        totalDocuments: countDocumentsForProject(session.handle.db, currentProjectId),
        totalScenes: listScenesForProject(session.handle.db, currentProjectId).length,
        totalIssues: listIssues(session.handle.db, currentProjectId, { status: "open" }).length
      };
    case "project.evidenceCoverage":
      if (!session || !currentProjectId) {
        throw new Error("Project not initialized");
      }
      return {
        issues: countIssueEvidenceCoverage(session.handle.db, currentProjectId),
        scenes: countSceneEvidenceCoverage(session.handle.db, currentProjectId)
      };
    case "project.addDocument":
      {
        if (!params || typeof params !== "object") {
          throw new Error("Missing params for project.addDocument");
        }
        if (!session || !currentProjectId || !currentProjectRoot) {
          throw new Error("Project not initialized");
        }
        const rawPath = (params as { path: string }).path;
        const filePath = path.isAbsolute(rawPath)
          ? rawPath
          : path.resolve(currentProjectRoot, rawPath);
        if (!fs.existsSync(filePath)) {
          logEvent(session.handle.db, {
            projectId: currentProjectId,
            level: "warn",
            eventType: "file_missing",
            payload: { filePath }
          });
          throw new Error(`File not found: ${filePath}`);
        }
        session.watcher.add(filePath);
        try {
          addDocumentToConfig(currentProjectRoot, filePath);
        } catch (error) {
          logEvent(session.handle.db, {
            projectId: currentProjectId,
            level: "warn",
            eventType: "config_update_failed",
            payload: {
              filePath,
              message: error instanceof Error ? error.message : "Unknown error"
            }
          });
        }
        const result = enqueueIngest(filePath, currentProjectId, true);
        if (!result) {
          throw new Error("Failed to enqueue ingest");
        }
        return result;
      }
    case "search.query":
      {
        if (!params || typeof params !== "object") {
          throw new Error("Missing params for search.query");
        }
        if (!session || !currentProjectId) {
          throw new Error("Project not initialized");
        }
        const query = (params as { query: string }).query;
        return {
          query,
          results: searchChunks(session.handle.db, query, 8, currentProjectId ?? undefined)
        };
      }
    case "search.ask":
      {
        if (!params || typeof params !== "object") {
          throw new Error("Missing params for search.ask");
        }
        if (!session || !currentProjectId || !currentProjectRoot) {
          throw new Error("Project not initialized");
        }
        return askQuestion(session.handle.db, {
          projectId: currentProjectId,
          rootPath: currentProjectRoot,
          question: (params as { question: string }).question
        });
      }
    case "scenes.list":
      if (!session || !currentProjectId) {
        throw new Error("Project not initialized");
      }
      return listScenesForProject(session.handle.db, currentProjectId);
    case "scenes.get":
      if (!params || typeof params !== "object") {
        throw new Error("Missing params for scenes.get");
      }
      if (!session) {
        throw new Error("Project not initialized");
      }
      return getSceneDetail(session.handle.db, (params as { sceneId: string }).sceneId);
    case "issues.list":
      if (!session || !currentProjectId) {
        throw new Error("Project not initialized");
      }
      return listIssuesWithEvidence(
        session.handle.db,
        currentProjectId,
        (params as ListIssueFilters | undefined) ?? {}
      );
    case "issues.dismiss":
      if (!params || typeof params !== "object") {
        throw new Error("Missing params for issues.dismiss");
      }
      if (!session || !currentProjectId) {
        throw new Error("Project not initialized");
      }
      {
        const payload = params as { issueId: string; reason?: string };
        dismissIssue(session.handle.db, payload.issueId);
        if (payload.reason && payload.reason.trim().length > 0) {
          logEvent(session.handle.db, {
            projectId: currentProjectId,
            level: "info",
            eventType: "issue_dismissed",
            payload: { issueId: payload.issueId, reason: payload.reason.trim() }
          });
        }
      }
      return { ok: true };
    case "issues.undoDismiss":
      if (!params || typeof params !== "object") {
        throw new Error("Missing params for issues.undoDismiss");
      }
      if (!session || !currentProjectId) {
        throw new Error("Project not initialized");
      }
      undoDismissIssue(session.handle.db, (params as { issueId: string }).issueId);
      return { ok: true };
    case "issues.resolve":
      if (!params || typeof params !== "object") {
        throw new Error("Missing params for issues.resolve");
      }
      if (!session || !currentProjectId) {
        throw new Error("Project not initialized");
      }
      resolveIssue(session.handle.db, (params as { issueId: string }).issueId);
      return { ok: true };
    case "issues.undoResolve":
      if (!params || typeof params !== "object") {
        throw new Error("Missing params for issues.undoResolve");
      }
      if (!session || !currentProjectId) {
        throw new Error("Project not initialized");
      }
      undoResolveIssue(session.handle.db, (params as { issueId: string }).issueId);
      return { ok: true };
    case "style.getReport":
      if (!session || !currentProjectId) {
        throw new Error("Project not initialized");
      }
      return getStyleReport(session.handle.db, currentProjectId);
    case "bible.listEntities":
      if (!session || !currentProjectId) {
        throw new Error("Project not initialized");
      }
      return listEntities(session.handle.db, currentProjectId);
    case "bible.getEntity":
      if (!params || typeof params !== "object") {
        throw new Error("Missing params for bible.getEntity");
      }
      if (!session) {
        throw new Error("Project not initialized");
      }
      return getEntityDetail(session.handle.db, (params as { entityId: string }).entityId);
    case "canon.confirmClaim":
      if (!params || typeof params !== "object") {
        throw new Error("Missing params for canon.confirmClaim");
      }
      if (!session || !currentProjectId) {
        throw new Error("Project not initialized");
      }
      {
        const payload = params as {
          entityId: string;
          field: string;
          valueJson: string;
          sourceClaimId?: string;
        };
        if (!payload.sourceClaimId) {
          throw new Error("sourceClaimId is required to confirm claim");
        }
        const confirmedId = confirmClaim(session.handle.db, {
          entityId: payload.entityId,
          field: payload.field,
          valueJson: payload.valueJson,
          sourceClaimId: payload.sourceClaimId
        });
        runContinuityChecks(session.handle.db, currentProjectId, {
          entityIds: [payload.entityId]
        });
        return confirmedId;
      }
    case "export.run":
      if (!params || typeof params !== "object") {
        throw new Error("Missing params for export.run");
      }
      if (!session || !currentProjectId) {
        throw new Error("Project not initialized");
      }
      {
        const startedAt = Date.now();
        const { outDir, kind } = params as { outDir: string; kind?: "md" | "json" };
        const effectiveKind = kind ?? "all";
        try {
          exportProject(session.handle.db, currentProjectId, outDir, effectiveKind);
          const fileCandidates =
            effectiveKind === "md"
              ? ["bible.md", "scenes.md", "style_report.md"]
              : effectiveKind === "json"
                ? ["project.json"]
                : ["bible.md", "scenes.md", "style_report.md", "project.json"];
          const files = fileCandidates
            .map((name) => path.join(outDir, name))
            .filter((candidate) => fs.existsSync(candidate));
          return { ok: true, files, elapsedMs: Date.now() - startedAt };
        } catch (error) {
          const message = error instanceof Error ? error.message : "Export failed";
          return { ok: false, error: message };
        }
      }
    case "jobs.list":
      if (!session || !currentProjectId) {
        throw new Error("Project not initialized");
      }
      return listQueuedJobs(session.handle.db, currentProjectId);
    case "jobs.cancel":
      if (!params || typeof params !== "object") {
        throw new Error("Missing params for jobs.cancel");
      }
      if (!session) {
        throw new Error("Project not initialized");
      }
      return { ok: cancelJob(session.handle.db, (params as { jobId: string }).jobId) };
    default:
      throw new Error(`Unknown method: ${method}`);
  }
}

process.on("beforeExit", () => {
  void teardownSession();
});

export async function handleRpcMessage(message: RpcRequest): Promise<RpcResponse | null> {
  if (!message || typeof message !== "object") {
    return null;
  }

  const { id, method, params } = message;
  if (!id || !method) {
    return null;
  }

  const response: RpcResponse = { id };
  const trackAsBusy = shouldTrackRpcAsBusy(method);

  try {
    if (trackAsBusy) {
      setStatus({ state: "busy", lastJob: method });
    }
    response.result = await dispatch(method as WorkerMethods, params);
    if (trackAsBusy) {
      markSuccess();
      setStatus({ state: "idle", lastJob: method });
    }
  } catch (error) {
    if (trackAsBusy) {
      markFailure(`rpc.${method}`, error);
      setStatus({ state: "idle", lastJob: method });
    }
    response.error = { message: error instanceof Error ? error.message : "Unknown error" };
  }

  return response;
}

function resetWorkerStateForTests(): void {
  status = createInitialStatus();
  currentProjectId = null;
  currentProjectRoot = null;
  lastSuccessfulRunAt = null;
  statusError = null;
}

export const __testHooks = {
  dispatch,
  handleJob,
  ensureSession,
  teardownSession,
  getSession: (): WorkerSession | null => session,
  getDebounceTimerCount: (): number => debounceTimers.size,
  seedDebounceTimerForTests: (key: string): void => {
    debounceTimers.set(key, setTimeout(() => undefined, 60_000));
  },
  resetWorkerStateForTests
};

process.on("message", async (message: RpcRequest) => {
  const response = await handleRpcMessage(message);
  if (response && process.send) {
    process.send(response);
  }
});
