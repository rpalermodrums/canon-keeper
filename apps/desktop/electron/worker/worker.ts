import type { RpcRequest, RpcResponse, WorkerMethods } from "./rpc";
import {
  createProject,
  getProjectByRootPath,
  listEntities,
  listDocuments,
  type ListIssueFilters,
  listIssuesWithEvidence,
  listScenesForProject,
  openDatabase,
  dismissIssue,
  undoDismissIssue,
  resolveIssue,
  touchProject,
  logEvent,
  getQueueDepth,
  listProcessingStates,
  listEvents,
  listSnapshotSummaries,
  markDocumentMissing,
  markDocumentSeen,
  getDocumentByPath
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

export type WorkerStatus = {
  state: "idle" | "busy";
  lastJob?: string;
  queueDepth?: number;
};

export type SystemHealthCheck = {
  ipc: "ok" | "down";
  worker: "ok" | "down";
  sqlite: "ok" | "missing_native" | "error";
  writable: "ok" | "error";
  details: string[];
};

let status: WorkerStatus = { state: "idle" };
let currentProjectId: string | null = null;
let currentProjectRoot: string | null = null;
type WorkerSession = {
  handle: DatabaseHandle;
  watcher: FSWatcher;
  queue: PersistentJobQueue<WorkerJob, WorkerJobResult>;
  rootPath: string;
  projectId: string | null;
};
let session: WorkerSession | null = null;
const debounceTimers = new Map<string, NodeJS.Timeout>();
const requireFromEsm = createRequire(import.meta.url);

function setStatus(next: WorkerStatus): void {
  status = next;
}

function getStatus(): WorkerStatus {
  return status;
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

    return result;
  } catch (error) {
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

async function handleCreateOrOpen(params: { rootPath: string; name?: string }): Promise<unknown> {
  const { name } = params;
  const rootPath = path.resolve(params.rootPath);
  const active = await ensureSession(rootPath);
  ensureProjectConfig(rootPath);
  const existing = getProjectByRootPath(active.handle.db, rootPath);
  if (existing) {
    touchProject(active.handle.db, existing.id);
    currentProjectId = existing.id;
    currentProjectRoot = rootPath;
    active.projectId = existing.id;
    ensureWatcher(active.handle.db, existing.id, active.watcher);
    registerConfigDocuments(existing.id, rootPath);
    return existing;
  }

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

async function dispatch(method: WorkerMethods, params?: unknown): Promise<unknown> {
  switch (method) {
    case "project.createOrOpen":
      if (!params || typeof params !== "object") {
        throw new Error("Missing params for project.createOrOpen");
      }
      return await handleCreateOrOpen(params as { rootPath: string; name?: string });
    case "project.getStatus":
      return {
        ...getStatus(),
        projectId: currentProjectId,
        queueDepth: session ? getQueueDepth(session.handle.db) : 0
      };
    case "project.subscribeStatus":
      return {
        ...getStatus(),
        projectId: currentProjectId,
        queueDepth: session ? getQueueDepth(session.handle.db) : 0
      };
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
    default:
      throw new Error(`Unknown method: ${method}`);
  }
}

process.on("beforeExit", () => {
  void teardownSession();
});

process.on("message", async (message: RpcRequest) => {
  if (!message || typeof message !== "object") {
    return;
  }

  const { id, method, params } = message;
  if (!id || !method) {
    return;
  }

  const response: RpcResponse = { id };
  const shouldTrackRpcAsBusy =
    method !== "project.getStatus" && method !== "project.subscribeStatus";

  try {
    if (shouldTrackRpcAsBusy) {
      setStatus({ state: "busy", lastJob: method });
    }
    response.result = await dispatch(method as WorkerMethods, params);
    if (shouldTrackRpcAsBusy) {
      setStatus({ state: "idle", lastJob: method });
    }
  } catch (error) {
    if (shouldTrackRpcAsBusy) {
      setStatus({ state: "idle", lastJob: method });
    }
    response.error = { message: error instanceof Error ? error.message : "Unknown error" };
  }

  if (process.send) {
    process.send(response);
  }
});
