import type { RpcRequest, RpcResponse, WorkerMethods } from "./rpc";
import {
  createProject,
  getProjectByRootPath,
  listEntities,
  listDocuments,
  listIssuesWithEvidence,
  listScenesForProject,
  openDatabase,
  dismissIssue,
  touchProject,
  logEvent,
  getQueueDepth,
  listProcessingStates,
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
import { addDocumentToConfig, loadProjectConfig, resolveDocumentPath } from "./config";
import { runSceneStage } from "./pipeline/stages/scenes";
import { runStyleStage } from "./pipeline/stages/style";
import { runExtractionStage } from "./pipeline/stages/extraction";
import { runContinuityStage } from "./pipeline/stages/continuity";

export type WorkerStatus = {
  state: "idle" | "busy";
  lastJob?: string;
  queueDepth?: number;
};

let status: WorkerStatus = { state: "idle" };
let dbHandle: DatabaseHandle | null = null;
let currentProjectId: string | null = null;
let currentProjectRoot: string | null = null;
let watcher: FSWatcher | null = null;
let jobQueue: PersistentJobQueue<WorkerJob, WorkerJobResult> | null = null;
const debounceTimers = new Map<string, NodeJS.Timeout>();

function setStatus(next: WorkerStatus): void {
  status = next;
}

function getStatus(): WorkerStatus {
  return status;
}

function ensureDb(rootPath: string): DatabaseHandle {
  if (dbHandle) {
    return dbHandle;
  }
  dbHandle = openDatabase({ rootPath });
  return dbHandle;
}

function ensureJobQueue(handle: DatabaseHandle): PersistentJobQueue<WorkerJob, WorkerJobResult> {
  if (jobQueue) {
    return jobQueue;
  }
  jobQueue = new PersistentJobQueue<WorkerJob, WorkerJobResult>(handle.db, handleJob);
  jobQueue.start();
  return jobQueue;
}

async function handleJob(job: WorkerJob): Promise<WorkerJobResult> {
  setStatus({ state: "busy", lastJob: job.type });
  const projectId = (job.payload as { projectId: string }).projectId;
  if (dbHandle) {
    logEvent(dbHandle.db, {
      projectId,
      level: "info",
      eventType: "job_started",
      payload: { type: job.type }
    });
  }

  try {
    let result: WorkerJobResult;
    switch (job.type) {
      case "INGEST_DOCUMENT": {
        if (!currentProjectRoot) {
          throw new Error("Project root not initialized");
        }
        result = await ingestDocument(dbHandle!.db, {
          projectId,
          rootPath: currentProjectRoot,
          filePath: job.payload.filePath
        });

        if (
          result.snapshotCreated &&
          result.changeStart !== null &&
          result.changeEnd !== null
        ) {
          ensureJobQueue(dbHandle!).enqueue(
            {
              type: "RUN_SCENES",
              payload: {
                projectId,
                documentId: result.documentId,
                snapshotId: result.snapshotId,
                rootPath: currentProjectRoot
              }
            },
            `scenes:${projectId}:${result.documentId}`
          );
          ensureJobQueue(dbHandle!).enqueue(
            {
              type: "RUN_STYLE",
              payload: {
                projectId,
                documentId: result.documentId,
                snapshotId: result.snapshotId,
                rootPath: currentProjectRoot
              }
            },
            `style:${projectId}:${result.documentId}`
          );
          ensureJobQueue(dbHandle!).enqueue(
            {
              type: "RUN_EXTRACTION",
              payload: {
                projectId,
                documentId: result.documentId,
                snapshotId: result.snapshotId,
                rootPath: currentProjectRoot,
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
          db: dbHandle!.db,
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
          db: dbHandle!.db,
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
          db: dbHandle!.db,
          projectId: payload.projectId,
          documentId: payload.documentId,
          snapshotId: payload.snapshotId,
          rootPath: payload.rootPath,
          changeStart: payload.changeStart,
          changeEnd: payload.changeEnd
        });

        if (extractionResult.touchedEntityIds.length > 0) {
          ensureJobQueue(dbHandle!).enqueue(
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
        }
        result = { ok: true };
        break;
      }
      case "RUN_CONTINUITY": {
        const payload = job.payload;
        runContinuityStage({
          db: dbHandle!.db,
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

    if (dbHandle) {
      logEvent(dbHandle.db, {
        projectId,
        level: "info",
        eventType: "job_finished",
        payload: { type: job.type }
      });
    }

    return result;
  } catch (error) {
    if (dbHandle) {
      logEvent(dbHandle.db, {
        projectId,
        level: "error",
        eventType: "job_failed",
        payload: {
          type: job.type,
          message: error instanceof Error ? error.message : "Unknown error"
        }
      });
    }
    throw error;
  } finally {
    setStatus({ state: "idle", lastJob: job.type });
  }
}

function handleCreateOrOpen(params: { rootPath: string; name?: string }): unknown {
  const { rootPath, name } = params;
  const handle = ensureDb(rootPath);
  ensureJobQueue(handle);
  const existing = getProjectByRootPath(handle.db, rootPath);
  if (existing) {
    touchProject(handle.db, existing.id);
    currentProjectId = existing.id;
    currentProjectRoot = rootPath;
    ensureWatcher(handle.db, existing.id);
    registerConfigDocuments(existing.id, rootPath);
    return existing;
  }

  const created = createProject(handle.db, rootPath, name);
  currentProjectId = created.id;
  currentProjectRoot = rootPath;
  ensureWatcher(handle.db, created.id);
  registerConfigDocuments(created.id, rootPath);
  return created;
}

function ensureWatcher(db: DatabaseHandle["db"], projectId: string): void {
  if (!watcher) {
    watcher = chokidar.watch([], { ignoreInitial: true });
    watcher.on("add", (filePath) => handleFileAdd(filePath, projectId));
    watcher.on("change", (filePath) => handleFileChange(filePath, projectId));
    watcher.on("unlink", (filePath) => handleFileUnlink(filePath, projectId));
  }

  const documents = listDocuments(db, projectId);
  for (const doc of documents) {
    watcher.add(doc.path);
  }
}

function registerConfigDocuments(projectId: string, rootPath: string): void {
  if (!dbHandle || !watcher) {
    return;
  }
  const config = loadProjectConfig(rootPath);
  for (const entry of config.documents) {
    const filePath = resolveDocumentPath(rootPath, entry);
    const existing = getDocumentByPath(dbHandle.db, projectId, filePath);
    if (!fs.existsSync(filePath)) {
      if (existing) {
        markDocumentMissing(dbHandle.db, existing.id);
      }
      continue;
    }
    watcher.add(filePath);
    if (existing) {
      markDocumentSeen(dbHandle.db, existing.id);
    }
    void enqueueIngest(filePath, projectId);
  }
}

function scheduleIngest(filePath: string, projectId: string): void {
  if (dbHandle) {
    const existing = getDocumentByPath(dbHandle.db, projectId, filePath);
    if (existing?.is_missing) {
      return;
    }
  }
  if (dbHandle) {
    logEvent(dbHandle.db, {
      projectId,
      level: "info",
      eventType: "file_changed",
      payload: { filePath }
    });
  }
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
  if (dbHandle) {
    const existing = getDocumentByPath(dbHandle.db, projectId, filePath);
    if (existing) {
      markDocumentSeen(dbHandle.db, existing.id);
    }
  }
  scheduleIngest(filePath, projectId);
}

function handleFileChange(filePath: string, projectId: string): void {
  scheduleIngest(filePath, projectId);
}

function handleFileUnlink(filePath: string, projectId: string): void {
  if (dbHandle) {
    const existing = getDocumentByPath(dbHandle.db, projectId, filePath);
    if (existing) {
      markDocumentMissing(dbHandle.db, existing.id);
    }
    logEvent(dbHandle.db, {
      projectId,
      level: "warn",
      eventType: "file_missing",
      payload: { filePath }
    });
  }
}

function enqueueIngest(filePath: string, projectId: string, awaitResult = false): Promise<WorkerJobResult> | null {
  const job: WorkerJob = { type: "INGEST_DOCUMENT", payload: { projectId, filePath } };
  return ensureJobQueue(dbHandle!).enqueue(job, `ingest:${projectId}:${filePath}`, awaitResult);
}

async function dispatch(method: WorkerMethods, params?: unknown): Promise<unknown> {
  switch (method) {
    case "project.createOrOpen":
      if (!params || typeof params !== "object") {
        throw new Error("Missing params for project.createOrOpen");
      }
      return handleCreateOrOpen(params as { rootPath: string; name?: string });
    case "project.getStatus":
      return {
        ...getStatus(),
        projectId: currentProjectId,
        queueDepth: dbHandle ? getQueueDepth(dbHandle.db) : 0
      };
    case "project.getProcessingState":
      if (!dbHandle || !currentProjectId) {
        throw new Error("Project not initialized");
      }
      return listProcessingStates(dbHandle.db, currentProjectId);
    case "project.addDocument":
      {
        if (!params || typeof params !== "object") {
          throw new Error("Missing params for project.addDocument");
        }
        if (!dbHandle || !currentProjectId || !currentProjectRoot) {
          throw new Error("Project not initialized");
        }
        if (!watcher) {
          ensureWatcher(dbHandle.db, currentProjectId);
        }
        const filePath = (params as { path: string }).path;
        if (!fs.existsSync(filePath)) {
          logEvent(dbHandle.db, {
            projectId: currentProjectId,
            level: "warn",
            eventType: "file_missing",
            payload: { filePath }
          });
          throw new Error(`File not found: ${filePath}`);
        }
        watcher?.add(filePath);
        try {
          addDocumentToConfig(currentProjectRoot, filePath);
        } catch (error) {
          logEvent(dbHandle.db, {
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
        if (!dbHandle || !currentProjectId) {
          throw new Error("Project not initialized");
        }
        const query = (params as { query: string }).query;
        return {
          query,
          results: searchChunks(dbHandle.db, query, 8, currentProjectId ?? undefined)
        };
      }
    case "search.ask":
      {
        if (!params || typeof params !== "object") {
          throw new Error("Missing params for search.ask");
        }
        if (!dbHandle || !currentProjectId || !currentProjectRoot) {
          throw new Error("Project not initialized");
        }
        return askQuestion(dbHandle.db, {
          projectId: currentProjectId,
          rootPath: currentProjectRoot,
          question: (params as { question: string }).question
        });
      }
    case "scenes.list":
      if (!dbHandle || !currentProjectId) {
        throw new Error("Project not initialized");
      }
      return listScenesForProject(dbHandle.db, currentProjectId);
    case "scenes.get":
      if (!params || typeof params !== "object") {
        throw new Error("Missing params for scenes.get");
      }
      if (!dbHandle) {
        throw new Error("Project not initialized");
      }
      return getSceneDetail(dbHandle.db, (params as { sceneId: string }).sceneId);
    case "issues.list":
      if (!dbHandle || !currentProjectId) {
        throw new Error("Project not initialized");
      }
      return listIssuesWithEvidence(dbHandle.db, currentProjectId);
    case "issues.dismiss":
      if (!params || typeof params !== "object") {
        throw new Error("Missing params for issues.dismiss");
      }
      if (!dbHandle || !currentProjectId) {
        throw new Error("Project not initialized");
      }
      dismissIssue(dbHandle.db, (params as { issueId: string }).issueId);
      return { ok: true };
    case "style.getReport":
      if (!dbHandle || !currentProjectId) {
        throw new Error("Project not initialized");
      }
      return getStyleReport(dbHandle.db, currentProjectId);
    case "bible.listEntities":
      if (!dbHandle || !currentProjectId) {
        throw new Error("Project not initialized");
      }
      return listEntities(dbHandle.db, currentProjectId);
    case "bible.getEntity":
      if (!params || typeof params !== "object") {
        throw new Error("Missing params for bible.getEntity");
      }
      if (!dbHandle) {
        throw new Error("Project not initialized");
      }
      return getEntityDetail(dbHandle.db, (params as { entityId: string }).entityId);
    case "canon.confirmClaim":
      if (!params || typeof params !== "object") {
        throw new Error("Missing params for canon.confirmClaim");
      }
      if (!dbHandle) {
        throw new Error("Project not initialized");
      }
      return confirmClaim(dbHandle.db, params as { entityId: string; field: string; valueJson: string });
    case "export.run":
      if (!params || typeof params !== "object") {
        throw new Error("Missing params for export.run");
      }
      if (!dbHandle || !currentProjectId) {
        throw new Error("Project not initialized");
      }
      {
        const { outDir, kind } = params as { outDir: string; kind?: "md" | "json" };
        exportProject(dbHandle.db, currentProjectId, outDir, kind ?? "all");
      }
      return { ok: true };
    default:
      throw new Error(`Unknown method: ${method}`);
  }
}

process.on("message", async (message: RpcRequest) => {
  if (!message || typeof message !== "object") {
    return;
  }

  const { id, method, params } = message;
  if (!id || !method) {
    return;
  }

  const response: RpcResponse = { id };

  try {
    setStatus({ state: "busy", lastJob: method });
    response.result = await dispatch(method as WorkerMethods, params);
    setStatus({ state: "idle", lastJob: method });
  } catch (error) {
    setStatus({ state: "idle", lastJob: method });
    response.error = { message: error instanceof Error ? error.message : "Unknown error" };
  }

  if (process.send) {
    process.send(response);
  }
});
