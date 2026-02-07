export type PingResponse = { ok: boolean };
export type ProjectSummary = {
  id: string;
  root_path: string;
  name: string;
  created_at: number;
  updated_at: number;
};

export type WorkerPhase = "idle" | "ingest" | "extract" | "style" | "continuity" | "export" | "error";

export type WorkerStatus = {
  state: "idle" | "busy";
  phase: WorkerPhase;
  lastJob?: string;
  activeJobLabel: string | null;
  projectId?: string | null;
  queueDepth?: number;
  lastSuccessfulRunAt: string | null;
  workerState?: "ready" | "restarting" | "down";
  lastError: { subsystem: string; message: string } | null;
};

export type WorkerStatusEvent = {
  status: WorkerStatus;
  observedAt: number;
};

export type UserFacingError = {
  id: string;
  code: string;
  message: string;
  actionLabel?: string;
  action?: string;
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

export type IngestResult = {
  documentId: string;
  snapshotId: string;
  snapshotCreated: boolean;
  chunksCreated: number;
  chunksUpdated: number;
  chunksDeleted: number;
  changeStart: number | null;
  changeEnd: number | null;
};

export type SearchResult = {
  chunkId: string;
  documentId: string;
  documentPath: string;
  ordinal: number;
  text: string;
  snippet: string;
  score: number;
};

export type SearchQueryResponse = {
  query: string;
  results: SearchResult[];
};

export type Citation = { chunkId: string; quoteStart: number; quoteEnd: number };

export type AskResponse =
  | {
      kind: "answer";
      answer: string;
      confidence: number;
      citations: Citation[];
    }
  | {
      kind: "snippets";
      snippets: SearchResult[];
    }
  | {
      kind: "not_found";
      reason: string;
    };

export type SceneSummary = {
  id: string;
  project_id: string;
  document_id: string;
  ordinal: number;
  start_chunk_id: string;
  end_chunk_id: string;
  start_char: number;
  end_char: number;
  title: string | null;
  pov_mode: string;
  pov_entity_id: string | null;
  pov_confidence: number | null;
  setting_entity_id: string | null;
  setting_text: string | null;
};

export type EvidenceItem = {
  chunkId: string;
  documentPath: string | null;
  chunkOrdinal: number | null;
  quoteStart: number;
  quoteEnd: number;
  excerpt: string;
  lineStart: number | null;
  lineEnd: number | null;
  sceneId?: string | null;
};

export type SceneDetail = {
  scene: SceneSummary;
  chunks: Array<{
    id: string;
    ordinal: number;
    text: string;
    start_char: number;
    end_char: number;
  }>;
  evidence: EvidenceItem[];
};

export type IssueSummary = {
  id: string;
  project_id: string;
  type: string;
  severity: string;
  title: string;
  description: string;
  status: string;
  created_at: number;
  updated_at: number;
  evidence: EvidenceItem[];
};

export type StyleReport = {
  repetition: unknown | null;
  tone: Array<{ scopeId: string; value: unknown }>;
  dialogueTics: Array<{ scopeId: string; value: unknown }>;
};

export type EntitySummary = {
  id: string;
  project_id: string;
  type: string;
  display_name: string;
  canonical_name: string | null;
  created_at: number;
  updated_at: number;
};

export type EntityDetail = {
  entity: EntitySummary;
  claims: Array<{
    claim: {
      id: string;
      entity_id: string;
      field: string;
      value_json: string;
      status: string;
      confidence: number;
      created_at: number;
      updated_at: number;
      supersedes_claim_id: string | null;
    };
    value: unknown;
    evidence: EvidenceItem[];
  }>;
};

export type ProjectStats = {
  totalPassages: number;
  totalDocuments: number;
  totalScenes: number;
  totalIssues: number;
};

export type ExportResult =
  | {
      ok: true;
      files: string[];
      elapsedMs: number;
    }
  | {
      ok: false;
      error: string;
    };

export type EvidenceCoverage = {
  issues: { total: number; withEvidence: number };
  scenes: { total: number; withEvidence: number };
};

function requireIpc(): NonNullable<Window["canonkeeper"]> {
  if (!window.canonkeeper) {
    throw new Error("IPC not available");
  }
  return window.canonkeeper;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function ping(): Promise<PingResponse> {
  if (!window.canonkeeper) {
    return { ok: false };
  }
  return window.canonkeeper.ping();
}

export async function getBundledFixturePath(): Promise<string | null> {
  return requireIpc().getFixturePath();
}

export async function pickProjectRoot(): Promise<string | null> {
  return requireIpc().dialog.pickProjectRoot();
}

export async function pickDocumentPath(): Promise<string | null> {
  return requireIpc().dialog.pickDocument();
}

export async function pickExportDirPath(): Promise<string | null> {
  return requireIpc().dialog.pickExportDir();
}

export async function createOrOpenProject(payload: {
  rootPath: string;
  name?: string;
  createIfMissing?: boolean;
}): Promise<ProjectSummary | null> {
  return requireIpc().project.createOrOpen(payload);
}

export async function getCurrentProject(): Promise<ProjectSummary | null> {
  return requireIpc().project.getCurrent();
}

export async function getWorkerStatus(): Promise<WorkerStatus> {
  return requireIpc().project.getStatus();
}

export async function* subscribeProjectStatus(options?: {
  intervalMs?: number;
  signal?: AbortSignal;
}): AsyncIterable<WorkerStatusEvent> {
  const intervalMs = options?.intervalMs ?? 2000;
  const ipc = requireIpc();
  const readStatus =
    typeof ipc.project.subscribeStatus === "function"
      ? () => ipc.project.subscribeStatus()
      : () => ipc.project.getStatus();
  while (!options?.signal?.aborted) {
    const status = await readStatus();
    yield { status, observedAt: Date.now() };
    await wait(intervalMs);
  }
}

export async function getHealthCheck(): Promise<SystemHealthCheck> {
  if (!window.canonkeeper) {
    return {
      ipc: "down",
      worker: "down",
      sqlite: "error",
      writable: "error",
      details: [
        "IPC bridge is unavailable. Launch CanonKeeper through Electron (or attach the RPC bridge)."
      ]
    };
  }
  if (!window.canonkeeper.system || typeof window.canonkeeper.system.healthCheck !== "function") {
    return {
      ipc: "ok",
      worker: "ok",
      sqlite: "error",
      writable: "error",
      details: [
        "Health check endpoint is not available in this runtime. Update to the latest preload bridge."
      ]
    };
  }
  return window.canonkeeper.system.healthCheck();
}

export async function getProjectDiagnostics(): Promise<ProjectDiagnostics> {
  if (!window.canonkeeper) {
    return {
      ipc: "down",
      worker: "down",
      sqlite: "error",
      writable: "error",
      details: ["IPC bridge is unavailable."],
      recommendations: ["Launch CanonKeeper through Electron or attach the RPC bridge."]
    };
  }

  if (window.canonkeeper.project && typeof window.canonkeeper.project.getDiagnostics === "function") {
    return window.canonkeeper.project.getDiagnostics();
  }

  const health = await getHealthCheck();
  return {
    ...health,
    recommendations:
      health.details.length > 0
        ? [...health.details]
        : ["Environment checks passed. Add manuscript files to begin ingestion."]
  };
}

export async function getProcessingState(): Promise<
  Array<{
    document_id: string;
    snapshot_id: string;
    stage: string;
    status: string;
    error: string | null;
    updated_at: number;
    document_path: string;
  }>
> {
  return requireIpc().project.getProcessingState();
}

export async function getProjectHistory(): Promise<{
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
}> {
  return requireIpc().project.getHistory();
}

export async function getProjectStats(): Promise<ProjectStats> {
  return requireIpc().project.stats();
}

export async function getEvidenceCoverage(): Promise<EvidenceCoverage> {
  return requireIpc().project.evidenceCoverage();
}

export async function addDocument(payload: { path: string }): Promise<IngestResult> {
  return requireIpc().project.addDocument(payload);
}

export async function querySearch(query: string): Promise<SearchQueryResponse> {
  return requireIpc().search.query({ query });
}

export async function askQuestion(question: string): Promise<AskResponse> {
  return requireIpc().search.ask({ question });
}

export async function listScenes(): Promise<SceneSummary[]> {
  return requireIpc().scenes.list();
}

export async function getScene(sceneId: string): Promise<SceneDetail | null> {
  return requireIpc().scenes.get({ sceneId });
}

export async function listIssues(payload?: {
  status?: "open" | "dismissed" | "resolved" | "all";
  type?: string;
  severity?: "low" | "medium" | "high";
}): Promise<IssueSummary[]> {
  return requireIpc().issues.list(payload);
}

export async function dismissIssue(issueId: string, reason?: string): Promise<{ ok: boolean }> {
  return requireIpc().issues.dismiss({ issueId, reason });
}

export async function undoDismissIssue(issueId: string): Promise<{ ok: boolean }> {
  return requireIpc().issues.undoDismiss({ issueId });
}

export async function resolveIssue(issueId: string): Promise<{ ok: boolean }> {
  return requireIpc().issues.resolve({ issueId });
}

export async function undoResolveIssue(issueId: string): Promise<{ ok: boolean }> {
  return requireIpc().issues.undoResolve({ issueId });
}

export async function getStyleReport(): Promise<StyleReport> {
  return requireIpc().style.getReport();
}

export async function listEntities(): Promise<EntitySummary[]> {
  return requireIpc().bible.listEntities();
}

export async function getEntity(entityId: string): Promise<EntityDetail> {
  return requireIpc().bible.getEntity({ entityId });
}

export async function confirmClaim(payload: {
  entityId: string;
  field: string;
  valueJson: string;
  sourceClaimId: string;
}): Promise<string> {
  return requireIpc().canon.confirmClaim(payload);
}

export async function runExport(outDir: string, kind?: "md" | "json"): Promise<ExportResult> {
  return requireIpc().export.run({ outDir, kind });
}

export type QueuedJob = {
  id: string;
  type: string;
  status: string;
  attempts: number;
  created_at: number;
  updated_at: number;
};

export async function listQueuedJobs(): Promise<QueuedJob[]> {
  return requireIpc().jobs.list();
}

export async function cancelJob(jobId: string): Promise<{ ok: boolean }> {
  return requireIpc().jobs.cancel({ jobId });
}
