// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import * as ipc from "./ipc";
import type {
  AskResponse,
  EntityDetail,
  EvidenceCoverage,
  ExportResult,
  IngestResult,
  IssueSummary,
  ProjectDiagnostics,
  ProjectStats,
  ProjectSummary,
  SceneDetail,
  SceneSummary,
  SearchQueryResponse,
  StyleReport,
  WorkerStatus
} from "./ipc";

type CanonkeeperBridge = NonNullable<Window["canonkeeper"]>;

const PROJECT_SUMMARY: ProjectSummary = {
  id: "project-1",
  root_path: "/tmp/canonkeeper-project",
  name: "Canon Keeper Project",
  created_at: 1700000000000,
  updated_at: 1700000000500
};

const WORKER_STATUS: WorkerStatus = {
  state: "idle",
  phase: "idle",
  activeJobLabel: null,
  projectId: "project-1",
  queueDepth: 0,
  lastSuccessfulRunAt: "2026-02-07T12:00:00.000Z",
  workerState: "ready",
  lastError: null
};

const HEALTH_CHECK: ipc.SystemHealthCheck = {
  ipc: "ok",
  worker: "ok",
  sqlite: "ok",
  writable: "ok",
  details: []
};

const PROJECT_DIAGNOSTICS: ProjectDiagnostics = {
  ...HEALTH_CHECK,
  recommendations: ["Everything looks healthy."]
};

const INGEST_RESULT: IngestResult = {
  documentId: "doc-1",
  snapshotId: "snap-1",
  snapshotCreated: true,
  chunksCreated: 4,
  chunksUpdated: 1,
  chunksDeleted: 0,
  changeStart: 10,
  changeEnd: 30
};

const SEARCH_RESPONSE: SearchQueryResponse = {
  query: "lantern",
  results: [
    {
      chunkId: "chunk-1",
      documentId: "doc-1",
      documentPath: "/tmp/canonkeeper-project/chapter1.md",
      ordinal: 1,
      text: "The lantern flickered.",
      snippet: "The lantern flickered.",
      score: 0.98
    }
  ]
};

const ASK_RESPONSE: AskResponse = {
  kind: "answer",
  answer: "The lantern is in the attic scene.",
  confidence: 0.87,
  citations: [{ chunkId: "chunk-1", quoteStart: 4, quoteEnd: 11 }]
};

const SCENE_SUMMARY: SceneSummary = {
  id: "scene-1",
  project_id: "project-1",
  document_id: "doc-1",
  ordinal: 1,
  start_chunk_id: "chunk-1",
  end_chunk_id: "chunk-3",
  start_char: 0,
  end_char: 240,
  title: "Attic",
  pov_mode: "first_person",
  pov_entity_id: "entity-1",
  pov_confidence: 0.92,
  setting_entity_id: "entity-2",
  setting_text: "Attic"
};

const SCENE_DETAIL: SceneDetail = {
  scene: SCENE_SUMMARY,
  chunks: [
    {
      id: "chunk-1",
      ordinal: 1,
      text: "I climbed into the attic with the lantern.",
      start_char: 0,
      end_char: 41
    }
  ],
  evidence: [
    {
      chunkId: "chunk-1",
      documentPath: "/tmp/canonkeeper-project/chapter1.md",
      chunkOrdinal: 1,
      quoteStart: 0,
      quoteEnd: 1,
      excerpt: "I",
      lineStart: 1,
      lineEnd: 1
    }
  ]
};

const ISSUE_LIST: IssueSummary[] = [
  {
    id: "issue-1",
    project_id: "project-1",
    type: "continuity_conflict",
    severity: "high",
    title: "Lantern location mismatch",
    description: "Lantern is described in two different rooms.",
    status: "open",
    created_at: 1700000001000,
    updated_at: 1700000001000,
    evidence: [
      {
        chunkId: "chunk-1",
        documentPath: "/tmp/canonkeeper-project/chapter1.md",
        chunkOrdinal: 1,
        quoteStart: 4,
        quoteEnd: 11,
        excerpt: "lantern",
        lineStart: 1,
        lineEnd: 1
      }
    ]
  }
];

const STYLE_REPORT: StyleReport = {
  repetition: { phrases: [{ phrase: "the lantern", count: 3 }] },
  tone: [{ scopeId: "scene-1", value: { score: 0.3 } }],
  dialogueTics: [{ scopeId: "entity-1", value: { phrase: "you know", count: 2 } }]
};

const ENTITY_DETAIL: EntityDetail = {
  entity: {
    id: "entity-1",
    project_id: "project-1",
    type: "character",
    display_name: "Mara",
    canonical_name: "Mara",
    created_at: 1700000000000,
    updated_at: 1700000000000
  },
  claims: [
    {
      claim: {
        id: "claim-1",
        entity_id: "entity-1",
        field: "eye_color",
        value_json: JSON.stringify("green"),
        status: "inferred",
        confidence: 0.8,
        created_at: 1700000001000,
        updated_at: 1700000001000,
        supersedes_claim_id: null
      },
      value: "green",
      evidence: [
        {
          chunkId: "chunk-1",
          documentPath: "/tmp/canonkeeper-project/chapter1.md",
          chunkOrdinal: 1,
          quoteStart: 14,
          quoteEnd: 19,
          excerpt: "green",
          lineStart: 1,
          lineEnd: 1
        }
      ]
    }
  ]
};

const PROJECT_STATS: ProjectStats = {
  totalPassages: 10,
  totalDocuments: 2,
  totalScenes: 4,
  totalIssues: 1
};

const EVIDENCE_COVERAGE: EvidenceCoverage = {
  issues: { total: 2, withEvidence: 2 },
  scenes: { total: 4, withEvidence: 3 }
};

const EXPORT_RESULT: ExportResult = {
  ok: true,
  files: ["/tmp/exports/bible.md"],
  elapsedMs: 92
};

type BridgeMocks = ReturnType<typeof createBridgeMocks>;

function createBridgeMocks() {
  const ping = vi.fn(async () => ({ ok: true }));
  const getFixturePath = vi.fn(async () => "/tmp/fixture/simple_md.md");
  const pickProjectRoot = vi.fn(async () => "/tmp/project-root");
  const pickDocument = vi.fn(async () => "/tmp/chapter1.md");
  const pickExportDir = vi.fn(async () => "/tmp/export-dir");
  const projectCreateOrOpen = vi.fn(
    async (_payload: { rootPath: string; name?: string; createIfMissing?: boolean }) => PROJECT_SUMMARY
  );
  const projectGetCurrent = vi.fn(async () => PROJECT_SUMMARY);
  const projectGetStatus = vi.fn(async () => WORKER_STATUS);
  const projectSubscribeStatus = vi.fn(async () => WORKER_STATUS);
  const projectGetDiagnostics = vi.fn(async () => PROJECT_DIAGNOSTICS);
  const projectGetProcessingState = vi.fn(async () => [
    {
      document_id: "doc-1",
      snapshot_id: "snap-1",
      stage: "ingest",
      status: "success",
      error: null,
      updated_at: 1700000001000,
      document_path: "/tmp/chapter1.md"
    }
  ]);
  const projectGetHistory = vi.fn(async () => ({
    snapshots: [
      {
        id: "snap-1",
        document_id: "doc-1",
        document_path: "/tmp/chapter1.md",
        version: 1,
        created_at: 1700000000000
      }
    ],
    events: [
      {
        id: "evt-1",
        project_id: "project-1",
        ts: 1700000001000,
        level: "info" as const,
        event_type: "ingest.completed",
        payload_json: "{}"
      }
    ]
  }));
  const projectAddDocument = vi.fn(async (_payload: { path: string }) => INGEST_RESULT);
  const projectStats = vi.fn(async () => PROJECT_STATS);
  const projectEvidenceCoverage = vi.fn(async () => EVIDENCE_COVERAGE);
  const systemHealthCheck = vi.fn(async () => HEALTH_CHECK);
  const searchAsk = vi.fn(async (_payload: { question: string }) => ASK_RESPONSE);
  const searchQuery = vi.fn(async (_payload: { query: string }) => SEARCH_RESPONSE);
  const scenesList = vi.fn(async () => [SCENE_SUMMARY]);
  const scenesGet = vi.fn(async (_payload: { sceneId: string }) => SCENE_DETAIL);
  const issuesList = vi.fn(
    async (_payload?: {
      status?: "open" | "dismissed" | "resolved" | "all";
      type?: string;
      severity?: "low" | "medium" | "high";
    }) => ISSUE_LIST
  );
  const issuesDismiss = vi.fn(async (_payload: { issueId: string; reason?: string }) => ({ ok: true }));
  const issuesUndoDismiss = vi.fn(async (_payload: { issueId: string }) => ({ ok: true }));
  const issuesResolve = vi.fn(async (_payload: { issueId: string }) => ({ ok: true }));
  const issuesUndoResolve = vi.fn(async (_payload: { issueId: string }) => ({ ok: true }));
  const styleGetReport = vi.fn(async () => STYLE_REPORT);
  const bibleListEntities = vi.fn(async () => [ENTITY_DETAIL.entity]);
  const bibleGetEntity = vi.fn(async (_payload: { entityId: string }) => ENTITY_DETAIL);
  const canonConfirmClaim = vi.fn(
    async (_payload: { entityId: string; field: string; valueJson: string; sourceClaimId: string }) => "claim-2"
  );
  const exportRun = vi.fn(async (_payload: { outDir: string; kind?: "md" | "json" }) => EXPORT_RESULT);
  const jobsList = vi.fn(async () => [
    {
      id: "job-1",
      type: "RUN_EXTRACTION",
      status: "queued",
      attempts: 0,
      created_at: 1700000001000,
      updated_at: 1700000001000
    }
  ]);
  const jobsCancel = vi.fn(async (_payload: { jobId: string }) => ({ ok: true }));

  const bridge: CanonkeeperBridge = {
    ping,
    getFixturePath,
    dialog: {
      pickProjectRoot,
      pickDocument,
      pickExportDir
    },
    project: {
      createOrOpen: projectCreateOrOpen,
      getCurrent: projectGetCurrent,
      getStatus: projectGetStatus,
      subscribeStatus: projectSubscribeStatus,
      getDiagnostics: projectGetDiagnostics,
      getProcessingState: projectGetProcessingState,
      getHistory: projectGetHistory,
      addDocument: projectAddDocument,
      stats: projectStats,
      evidenceCoverage: projectEvidenceCoverage
    },
    system: {
      healthCheck: systemHealthCheck
    },
    search: {
      ask: searchAsk,
      query: searchQuery
    },
    scenes: {
      list: scenesList,
      get: scenesGet
    },
    issues: {
      list: issuesList,
      dismiss: issuesDismiss,
      undoDismiss: issuesUndoDismiss,
      resolve: issuesResolve,
      undoResolve: issuesUndoResolve
    },
    style: {
      getReport: styleGetReport
    },
    bible: {
      listEntities: bibleListEntities,
      getEntity: bibleGetEntity
    },
    canon: {
      confirmClaim: canonConfirmClaim
    },
    export: {
      run: exportRun
    },
    jobs: {
      list: jobsList,
      cancel: jobsCancel
    }
  };

  return {
    bridge,
    ping,
    getFixturePath,
    pickProjectRoot,
    pickDocument,
    pickExportDir,
    projectCreateOrOpen,
    projectGetCurrent,
    projectGetStatus,
    projectSubscribeStatus,
    projectGetDiagnostics,
    projectGetProcessingState,
    projectGetHistory,
    projectAddDocument,
    projectStats,
    projectEvidenceCoverage,
    systemHealthCheck,
    searchAsk,
    searchQuery,
    scenesList,
    scenesGet,
    issuesList,
    issuesDismiss,
    issuesUndoDismiss,
    issuesResolve,
    issuesUndoResolve,
    styleGetReport,
    bibleListEntities,
    bibleGetEntity,
    canonConfirmClaim,
    exportRun,
    jobsList,
    jobsCancel
  };
}

function setBridge(bridge?: CanonkeeperBridge): void {
  Object.defineProperty(window, "canonkeeper", {
    configurable: true,
    writable: true,
    value: bridge
  });
}

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  setBridge(undefined);
});

describe("getHealthCheck", () => {
  it("returns bridge health check on the happy path", async () => {
    const mocks = createBridgeMocks();
    setBridge(mocks.bridge);

    await expect(ipc.getHealthCheck()).resolves.toEqual(HEALTH_CHECK);
    expect(mocks.systemHealthCheck).toHaveBeenCalledTimes(1);
  });

  it("returns a down fallback when the bridge is unavailable", async () => {
    setBridge(undefined);

    await expect(ipc.getHealthCheck()).resolves.toEqual({
      ipc: "down",
      worker: "down",
      sqlite: "error",
      writable: "error",
      details: [
        "IPC bridge is unavailable. Launch CanonKeeper through Electron (or attach the RPC bridge)."
      ]
    });
  });

  it("returns fallback diagnostics when health endpoint is missing", async () => {
    const mocks = createBridgeMocks();
    const bridgeWithoutHealth = {
      ...mocks.bridge,
      system: {} as CanonkeeperBridge["system"]
    } as CanonkeeperBridge;
    setBridge(bridgeWithoutHealth);

    await expect(ipc.getHealthCheck()).resolves.toEqual({
      ipc: "ok",
      worker: "ok",
      sqlite: "error",
      writable: "error",
      details: [
        "Health check endpoint is not available in this runtime. Update to the latest preload bridge."
      ]
    });
  });

  it("returns an error fallback when health check throws", async () => {
    const mocks = createBridgeMocks();
    mocks.systemHealthCheck.mockRejectedValueOnce(new Error("Worker unreachable"));
    setBridge(mocks.bridge);

    await expect(ipc.getHealthCheck()).resolves.toEqual({
      ipc: "ok",
      worker: "down",
      sqlite: "error",
      writable: "error",
      details: ["Health check failed: Worker unreachable"]
    });
  });
});

describe("getProjectDiagnostics", () => {
  it("returns bridge diagnostics on the happy path", async () => {
    const mocks = createBridgeMocks();
    setBridge(mocks.bridge);

    await expect(ipc.getProjectDiagnostics()).resolves.toEqual(PROJECT_DIAGNOSTICS);
    expect(mocks.projectGetDiagnostics).toHaveBeenCalledTimes(1);
  });

  it("returns fallback diagnostics when bridge is unavailable", async () => {
    setBridge(undefined);

    await expect(ipc.getProjectDiagnostics()).resolves.toEqual({
      ipc: "down",
      worker: "down",
      sqlite: "error",
      writable: "error",
      details: ["IPC bridge is unavailable."],
      recommendations: ["Launch CanonKeeper through Electron or attach the RPC bridge."]
    });
  });

  it("falls back to health checks when project diagnostics endpoint is missing", async () => {
    const mocks = createBridgeMocks();
    const bridgeWithoutDiagnostics = {
      ...mocks.bridge,
      project: {
        ...mocks.bridge.project,
        getDiagnostics: undefined
      }
    } as unknown as CanonkeeperBridge;
    setBridge(bridgeWithoutDiagnostics);

    await expect(ipc.getProjectDiagnostics()).resolves.toEqual({
      ...HEALTH_CHECK,
      recommendations: ["Environment checks passed. Add manuscript files to begin ingestion."]
    });
    expect(mocks.systemHealthCheck).toHaveBeenCalledTimes(1);
  });

  it("uses health details as recommendations when diagnostics endpoint is missing", async () => {
    const mocks = createBridgeMocks();
    mocks.systemHealthCheck.mockResolvedValueOnce({
      ipc: "ok",
      worker: "down",
      sqlite: "error",
      writable: "error",
      details: ["SQLite native module missing"]
    });
    const bridgeWithoutDiagnostics = {
      ...mocks.bridge,
      project: {
        ...mocks.bridge.project,
        getDiagnostics: undefined
      }
    } as unknown as CanonkeeperBridge;
    setBridge(bridgeWithoutDiagnostics);

    await expect(ipc.getProjectDiagnostics()).resolves.toEqual({
      ipc: "ok",
      worker: "down",
      sqlite: "error",
      writable: "error",
      details: ["SQLite native module missing"],
      recommendations: ["SQLite native module missing"]
    });
  });

  it("returns an error fallback when diagnostics endpoint throws", async () => {
    const mocks = createBridgeMocks();
    mocks.projectGetDiagnostics.mockRejectedValueOnce(new Error("RPC timeout"));
    setBridge(mocks.bridge);

    await expect(ipc.getProjectDiagnostics()).resolves.toEqual({
      ipc: "ok",
      worker: "down",
      sqlite: "error",
      writable: "error",
      details: ["Project diagnostics failed: RPC timeout"],
      recommendations: [
        "Try reopening the project.",
        "If this keeps happening, run Health Check in Settings and review recent worker events."
      ]
    });
  });
});

describe("subscribeProjectStatus", () => {
  it("yields status events from subscribeStatus and then stops on abort", async () => {
    vi.useFakeTimers();
    const mocks = createBridgeMocks();
    const firstStatus: WorkerStatus = {
      ...WORKER_STATUS,
      state: "busy",
      phase: "ingest",
      activeJobLabel: "Ingesting"
    };
    const secondStatus: WorkerStatus = {
      ...WORKER_STATUS,
      state: "busy",
      phase: "style",
      activeJobLabel: "Analyzing style"
    };
    mocks.projectSubscribeStatus.mockResolvedValueOnce(firstStatus).mockResolvedValueOnce(secondStatus);
    setBridge(mocks.bridge);

    const controller = new AbortController();
    const stream = ipc.subscribeProjectStatus({ intervalMs: 25, signal: controller.signal })[
      Symbol.asyncIterator
    ]();

    const first = await stream.next();
    expect(first.done).toBe(false);
    if (!first.done) {
      expect(first.value.status).toEqual(firstStatus);
      expect(typeof first.value.observedAt).toBe("number");
    }

    const secondPromise = stream.next();
    await vi.advanceTimersByTimeAsync(25);
    const second = await secondPromise;
    expect(second.done).toBe(false);
    if (!second.done) {
      expect(second.value.status).toEqual(secondStatus);
    }

    controller.abort();
    const completion = stream.next();
    await vi.advanceTimersByTimeAsync(25);
    await expect(completion).resolves.toEqual({ done: true, value: undefined });
    expect(vi.getTimerCount()).toBe(0);
    expect(mocks.projectSubscribeStatus).toHaveBeenCalledTimes(2);
  });

  it("falls back to project.getStatus when subscribeStatus is unavailable", async () => {
    vi.useFakeTimers();
    const mocks = createBridgeMocks();
    const bridgeWithoutSubscribe = {
      ...mocks.bridge,
      project: {
        ...mocks.bridge.project,
        subscribeStatus: undefined
      }
    } as unknown as CanonkeeperBridge;
    setBridge(bridgeWithoutSubscribe);

    const controller = new AbortController();
    const stream = ipc.subscribeProjectStatus({ intervalMs: 10, signal: controller.signal })[
      Symbol.asyncIterator
    ]();
    const first = await stream.next();
    expect(first.done).toBe(false);
    expect(mocks.projectGetStatus).toHaveBeenCalledTimes(1);

    controller.abort();
    const completion = stream.next();
    await vi.advanceTimersByTimeAsync(10);
    await expect(completion).resolves.toEqual({ done: true, value: undefined });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("proxy methods", () => {
  it("proxies renderer IPC calls to the preload bridge with expected payloads", async () => {
    const mocks: BridgeMocks = createBridgeMocks();
    setBridge(mocks.bridge);

    await expect(ipc.ping()).resolves.toEqual({ ok: true });
    expect(mocks.ping).toHaveBeenCalledTimes(1);

    await expect(ipc.getBundledFixturePath()).resolves.toBe("/tmp/fixture/simple_md.md");
    expect(mocks.getFixturePath).toHaveBeenCalledTimes(1);

    await expect(ipc.pickProjectRoot()).resolves.toBe("/tmp/project-root");
    expect(mocks.pickProjectRoot).toHaveBeenCalledTimes(1);

    await expect(ipc.pickDocumentPath()).resolves.toBe("/tmp/chapter1.md");
    expect(mocks.pickDocument).toHaveBeenCalledTimes(1);

    await expect(ipc.pickExportDirPath()).resolves.toBe("/tmp/export-dir");
    expect(mocks.pickExportDir).toHaveBeenCalledTimes(1);

    const projectPayload = { rootPath: "/tmp/project-root", name: "Novel", createIfMissing: false };
    await expect(ipc.createOrOpenProject(projectPayload)).resolves.toEqual(PROJECT_SUMMARY);
    expect(mocks.projectCreateOrOpen).toHaveBeenCalledWith(projectPayload);

    await expect(ipc.getCurrentProject()).resolves.toEqual(PROJECT_SUMMARY);
    expect(mocks.projectGetCurrent).toHaveBeenCalledTimes(1);

    await expect(ipc.getWorkerStatus()).resolves.toEqual(WORKER_STATUS);
    expect(mocks.projectGetStatus).toHaveBeenCalledTimes(1);

    await expect(ipc.getProcessingState()).resolves.toHaveLength(1);
    expect(mocks.projectGetProcessingState).toHaveBeenCalledTimes(1);

    await expect(ipc.getProjectHistory()).resolves.toMatchObject({ snapshots: expect.any(Array) });
    expect(mocks.projectGetHistory).toHaveBeenCalledTimes(1);

    await expect(ipc.getProjectStats()).resolves.toEqual(PROJECT_STATS);
    expect(mocks.projectStats).toHaveBeenCalledTimes(1);

    await expect(ipc.getEvidenceCoverage()).resolves.toEqual(EVIDENCE_COVERAGE);
    expect(mocks.projectEvidenceCoverage).toHaveBeenCalledTimes(1);

    await expect(ipc.addDocument({ path: "/tmp/chapter1.md" })).resolves.toEqual(INGEST_RESULT);
    expect(mocks.projectAddDocument).toHaveBeenCalledWith({ path: "/tmp/chapter1.md" });

    await expect(ipc.querySearch("lantern")).resolves.toEqual(SEARCH_RESPONSE);
    expect(mocks.searchQuery).toHaveBeenCalledWith({ query: "lantern" });

    await expect(ipc.askQuestion("Where is the lantern?")).resolves.toEqual(ASK_RESPONSE);
    expect(mocks.searchAsk).toHaveBeenCalledWith({ question: "Where is the lantern?" });

    await expect(ipc.listScenes()).resolves.toEqual([SCENE_SUMMARY]);
    expect(mocks.scenesList).toHaveBeenCalledTimes(1);

    await expect(ipc.getScene("scene-1")).resolves.toEqual(SCENE_DETAIL);
    expect(mocks.scenesGet).toHaveBeenCalledWith({ sceneId: "scene-1" });

    await expect(ipc.listIssues()).resolves.toEqual(ISSUE_LIST);
    expect(mocks.issuesList).toHaveBeenCalledWith(undefined);

    const issueFilter = { status: "open" as const, severity: "high" as const, type: "continuity_conflict" };
    await expect(ipc.listIssues(issueFilter)).resolves.toEqual(ISSUE_LIST);
    expect(mocks.issuesList).toHaveBeenCalledWith(issueFilter);

    await expect(ipc.dismissIssue("issue-1", "duplicate")).resolves.toEqual({ ok: true });
    expect(mocks.issuesDismiss).toHaveBeenCalledWith({ issueId: "issue-1", reason: "duplicate" });

    await expect(ipc.undoDismissIssue("issue-1")).resolves.toEqual({ ok: true });
    expect(mocks.issuesUndoDismiss).toHaveBeenCalledWith({ issueId: "issue-1" });

    await expect(ipc.resolveIssue("issue-1")).resolves.toEqual({ ok: true });
    expect(mocks.issuesResolve).toHaveBeenCalledWith({ issueId: "issue-1" });

    await expect(ipc.undoResolveIssue("issue-1")).resolves.toEqual({ ok: true });
    expect(mocks.issuesUndoResolve).toHaveBeenCalledWith({ issueId: "issue-1" });

    await expect(ipc.getStyleReport()).resolves.toEqual(STYLE_REPORT);
    expect(mocks.styleGetReport).toHaveBeenCalledTimes(1);

    await expect(ipc.listEntities()).resolves.toEqual([ENTITY_DETAIL.entity]);
    expect(mocks.bibleListEntities).toHaveBeenCalledTimes(1);

    await expect(ipc.getEntity("entity-1")).resolves.toEqual(ENTITY_DETAIL);
    expect(mocks.bibleGetEntity).toHaveBeenCalledWith({ entityId: "entity-1" });

    const confirmPayload = {
      entityId: "entity-1",
      field: "eye_color",
      valueJson: JSON.stringify("green"),
      sourceClaimId: "claim-1"
    };
    await expect(ipc.confirmClaim(confirmPayload)).resolves.toBe("claim-2");
    expect(mocks.canonConfirmClaim).toHaveBeenCalledWith(confirmPayload);

    await expect(ipc.runExport("/tmp/export", "md")).resolves.toEqual(EXPORT_RESULT);
    expect(mocks.exportRun).toHaveBeenCalledWith({ outDir: "/tmp/export", kind: "md" });

    await expect(ipc.listQueuedJobs()).resolves.toHaveLength(1);
    expect(mocks.jobsList).toHaveBeenCalledTimes(1);

    await expect(ipc.cancelJob("job-1")).resolves.toEqual({ ok: true });
    expect(mocks.jobsCancel).toHaveBeenCalledWith({ jobId: "job-1" });
  });
});

describe("error handling", () => {
  it("returns ping fallback when the bridge is unavailable", async () => {
    setBridge(undefined);
    await expect(ipc.ping()).resolves.toEqual({ ok: false });
  });

  it("throws a clear IPC unavailable error for bridge-required methods", async () => {
    setBridge(undefined);
    await expect(ipc.getProjectStats()).rejects.toThrow("IPC not available");
  });
});
