import { afterEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ingestDocument, type IngestResult } from "./pipeline/ingest";
import { __testHooks, handleRpcMessage, shouldTrackRpcAsBusy, type WorkerStatus } from "./worker";
import type { WorkerMethods } from "./rpc";
import type { WorkerJob } from "./jobs/types";
import { createProject, getProjectByRootPath } from "./storage";

type ProcessingState = {
  stage: string;
  status: "pending" | "ok" | "failed";
};

type ProjectSummary = {
  id: string;
  root_path: string;
};

type SceneSummary = {
  id: string;
};

type ClaimWithEvidence = {
  claim: {
    id: string;
    field: string;
    value_json: string;
  };
  evidence: unknown[];
};

type EntityDetail = {
  entity: { id: string };
  claims: ClaimWithEvidence[];
};

type DispatchCaseContext = {
  rootPath: string;
  secondDocPath: string;
  sceneId: string;
  issueId: string;
  entityId: string;
  sourceClaimId: string;
  sourceClaimField: string;
  sourceClaimValueJson: string;
  exportDir: string;
};

type DispatchCase = {
  method: WorkerMethods;
  params?: unknown | ((ctx: DispatchCaseContext) => unknown);
  assertResult: (result: unknown, ctx: DispatchCaseContext) => void;
};

const fixtureDir = path.resolve(process.cwd(), "data", "fixtures");
const tempRoots: string[] = [];

function makeTempRoot(label: string): string {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), `canonkeeper-worker-${label}-`));
  tempRoots.push(rootPath);
  return rootPath;
}

function copyFixture(rootPath: string, fixtureName: string): string {
  const sourcePath = path.join(fixtureDir, fixtureName);
  const destinationPath = path.join(rootPath, fixtureName);
  fs.copyFileSync(sourcePath, destinationPath);
  return destinationPath;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForStages(requiredStages: string[], timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const rows = (await __testHooks.dispatch("project.getProcessingState")) as ProcessingState[];
    const byStage = new Map(rows.map((row) => [row.stage, row.status]));
    if (requiredStages.every((stage) => byStage.get(stage) === "ok")) {
      return;
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for stages: ${requiredStages.join(", ")}`);
}

afterEach(async () => {
  vi.restoreAllMocks();
  await __testHooks.teardownSession();
  __testHooks.resetWorkerStateForTests();

  for (const rootPath of tempRoots) {
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
  tempRoots.length = 0;
});

describe("worker dispatch routing", () => {
  it(
    "routes every WorkerMethods entry to a handler and returns expected shape",
    async () => {
      const rootPath = makeTempRoot("dispatch");
      const contradictionPath = copyFixture(rootPath, "contradiction.md");
      const secondDocPath = copyFixture(rootPath, "simple_md.md");
      const exportDir = path.join(rootPath, "exports");

      const project = (await __testHooks.dispatch("project.createOrOpen", {
        rootPath,
        name: "Dispatch Coverage"
      })) as ProjectSummary;
      expect(project.root_path).toBe(path.resolve(rootPath));

      const firstIngest = (await __testHooks.dispatch("project.addDocument", {
        path: contradictionPath
      })) as IngestResult;
      expect(firstIngest.snapshotCreated).toBe(true);
      await waitForStages(["scenes", "style", "extraction", "continuity"]);

      const scenes = (await __testHooks.dispatch("scenes.list")) as SceneSummary[];
      expect(scenes.length).toBeGreaterThan(0);
      const sceneId = scenes[0]!.id;

      const entities = (await __testHooks.dispatch("bible.listEntities")) as Array<{ id: string }>;
      expect(entities.length).toBeGreaterThan(0);
      const entityId = entities[0]!.id;

      const entityDetail = (await __testHooks.dispatch("bible.getEntity", {
        entityId
      })) as EntityDetail;
      const sourceClaim = entityDetail.claims.find((claim) => claim.evidence.length > 0);
      if (!sourceClaim) {
        throw new Error("Expected at least one evidence-backed claim for confirmClaim routing");
      }

      const issues = (await __testHooks.dispatch("issues.list")) as Array<{ id: string }>;
      const issueId = issues[0]?.id ?? crypto.randomUUID();

      const context: DispatchCaseContext = {
        rootPath,
        secondDocPath,
        sceneId,
        issueId,
        entityId,
        sourceClaimId: sourceClaim.claim.id,
        sourceClaimField: sourceClaim.claim.field,
        sourceClaimValueJson: sourceClaim.claim.value_json,
        exportDir
      };

      const cases: DispatchCase[] = [
        {
          method: "project.createOrOpen",
          params: (ctx: DispatchCaseContext) => ({
            rootPath: ctx.rootPath,
            createIfMissing: false
          }),
          assertResult: (result) => {
            expect(result).toEqual(expect.objectContaining({ id: expect.any(String) }));
          }
        },
        {
          method: "project.getCurrent",
          assertResult: (result, ctx) => {
            expect(result).toEqual(
              expect.objectContaining({ id: expect.any(String), root_path: path.resolve(ctx.rootPath) })
            );
          }
        },
        {
          method: "project.getStatus",
          assertResult: (result) => {
            const status = result as WorkerStatus;
            expect(["idle", "busy"]).toContain(status.state);
            expect(status.phase).toBeTruthy();
          }
        },
        {
          method: "project.subscribeStatus",
          assertResult: (result) => {
            expect(result).toEqual(expect.objectContaining({ state: expect.any(String) }));
          }
        },
        {
          method: "project.getDiagnostics",
          assertResult: (result) => {
            expect(result).toEqual(
              expect.objectContaining({
                worker: expect.any(String),
                sqlite: expect.any(String),
                writable: expect.any(String),
                recommendations: expect.any(Array)
              })
            );
          }
        },
        {
          method: "project.getProcessingState",
          assertResult: (result) => {
            expect(Array.isArray(result)).toBe(true);
          }
        },
        {
          method: "project.getHistory",
          assertResult: (result) => {
            expect(result).toEqual(
              expect.objectContaining({ snapshots: expect.any(Array), events: expect.any(Array) })
            );
          }
        },
        {
          method: "project.addDocument",
          params: (ctx: DispatchCaseContext) => ({ path: ctx.secondDocPath }),
          assertResult: (result) => {
            expect(result).toEqual(
              expect.objectContaining({
                documentId: expect.any(String),
                snapshotId: expect.any(String),
                snapshotCreated: true
              })
            );
          }
        },
        {
          method: "project.stats",
          assertResult: (result) => {
            expect(result).toEqual(
              expect.objectContaining({
                totalPassages: expect.any(Number),
                totalDocuments: expect.any(Number),
                totalScenes: expect.any(Number),
                totalIssues: expect.any(Number)
              })
            );
          }
        },
        {
          method: "project.evidenceCoverage",
          assertResult: (result) => {
            expect(result).toEqual(
              expect.objectContaining({
                issues: expect.objectContaining({ total: expect.any(Number), withEvidence: expect.any(Number) }),
                scenes: expect.objectContaining({ total: expect.any(Number), withEvidence: expect.any(Number) })
              })
            );
          }
        },
        {
          method: "system.healthCheck",
          assertResult: (result) => {
            expect(result).toEqual(
              expect.objectContaining({
                ipc: expect.any(String),
                worker: expect.any(String),
                sqlite: expect.any(String),
                writable: expect.any(String)
              })
            );
          }
        },
        {
          method: "search.query",
          params: { query: "Mira" },
          assertResult: (result) => {
            expect(result).toEqual(expect.objectContaining({ query: "Mira", results: expect.any(Array) }));
          }
        },
        {
          method: "search.ask",
          params: { question: "What color are Mira's eyes?" },
          assertResult: (result) => {
            expect(result).toEqual(expect.objectContaining({ kind: expect.any(String) }));
          }
        },
        {
          method: "scenes.list",
          assertResult: (result) => {
            expect(Array.isArray(result)).toBe(true);
          }
        },
        {
          method: "scenes.get",
          params: (ctx: DispatchCaseContext) => ({ sceneId: ctx.sceneId }),
          assertResult: (result) => {
            expect(result).toEqual(
              expect.objectContaining({ scene: expect.objectContaining({ id: expect.any(String) }) })
            );
          }
        },
        {
          method: "issues.list",
          assertResult: (result) => {
            expect(Array.isArray(result)).toBe(true);
          }
        },
        {
          method: "issues.dismiss",
          params: (ctx: DispatchCaseContext) => ({ issueId: ctx.issueId, reason: "covered in notes" }),
          assertResult: (result) => {
            expect(result).toEqual({ ok: true });
          }
        },
        {
          method: "issues.undoDismiss",
          params: (ctx: DispatchCaseContext) => ({ issueId: ctx.issueId }),
          assertResult: (result) => {
            expect(result).toEqual({ ok: true });
          }
        },
        {
          method: "issues.resolve",
          params: (ctx: DispatchCaseContext) => ({ issueId: ctx.issueId }),
          assertResult: (result) => {
            expect(result).toEqual({ ok: true });
          }
        },
        {
          method: "issues.undoResolve",
          params: (ctx: DispatchCaseContext) => ({ issueId: ctx.issueId }),
          assertResult: (result) => {
            expect(result).toEqual({ ok: true });
          }
        },
        {
          method: "style.getReport",
          assertResult: (result) => {
            const report = result as { repetition: unknown | null; tone: unknown[]; dialogueTics: unknown[] };
            expect(report).toEqual(
              expect.objectContaining({ tone: expect.any(Array), dialogueTics: expect.any(Array) })
            );
            expect(Object.prototype.hasOwnProperty.call(report, "repetition")).toBe(true);
          }
        },
        {
          method: "bible.listEntities",
          assertResult: (result) => {
            expect(Array.isArray(result)).toBe(true);
          }
        },
        {
          method: "bible.getEntity",
          params: (ctx: DispatchCaseContext) => ({ entityId: ctx.entityId }),
          assertResult: (result, ctx) => {
            expect(result).toEqual(expect.objectContaining({ entity: expect.objectContaining({ id: ctx.entityId }) }));
          }
        },
        {
          method: "canon.confirmClaim",
          params: (ctx: DispatchCaseContext) => ({
            entityId: ctx.entityId,
            field: ctx.sourceClaimField,
            valueJson: ctx.sourceClaimValueJson,
            sourceClaimId: ctx.sourceClaimId
          }),
          assertResult: (result) => {
            expect(typeof result).toBe("string");
            expect((result as string).length).toBeGreaterThan(0);
          }
        },
        {
          method: "export.run",
          params: (ctx: DispatchCaseContext) => ({ outDir: ctx.exportDir, kind: "json" }),
          assertResult: (result) => {
            expect(result).toEqual(expect.objectContaining({ ok: true, files: expect.any(Array) }));
          }
        },
        {
          method: "jobs.list",
          assertResult: (result) => {
            expect(Array.isArray(result)).toBe(true);
          }
        },
        {
          method: "jobs.cancel",
          params: { jobId: crypto.randomUUID() },
          assertResult: (result) => {
            expect(result).toEqual(expect.objectContaining({ ok: expect.any(Boolean) }));
          }
        }
      ];

      const coveredMethods = cases.map((entry) => entry.method).sort();
      const allMethods: WorkerMethods[] = [
        "project.createOrOpen",
        "project.getCurrent",
        "project.getStatus",
        "project.subscribeStatus",
        "project.getDiagnostics",
        "project.getProcessingState",
        "project.getHistory",
        "project.addDocument",
        "project.stats",
        "project.evidenceCoverage",
        "system.healthCheck",
        "search.query",
        "search.ask",
        "scenes.list",
        "scenes.get",
        "issues.list",
        "issues.dismiss",
        "issues.undoDismiss",
        "issues.resolve",
        "issues.undoResolve",
        "style.getReport",
        "bible.listEntities",
        "bible.getEntity",
        "canon.confirmClaim",
        "export.run",
        "jobs.list",
        "jobs.cancel"
      ];
      expect(coveredMethods).toEqual([...allMethods].sort());

      for (const testCase of cases) {
        const params =
          typeof testCase.params === "function" ? testCase.params(context) : testCase.params;
        const result = await __testHooks.dispatch(testCase.method, params);
        testCase.assertResult(result, context);
      }
    },
    120_000
  );
});

describe("worker pipeline chaining", () => {
  it("INGEST_DOCUMENT fans out to scenes/style/extraction jobs with expected payloads", async () => {
    const rootPath = makeTempRoot("chain-ingest");
    const filePath = copyFixture(rootPath, "simple_md.md");
    const project = (await __testHooks.dispatch("project.createOrOpen", {
      rootPath,
      name: "Chaining"
    })) as ProjectSummary;

    const activeSession = __testHooks.getSession();
    if (!activeSession) {
      throw new Error("Expected active session");
    }

    const enqueueSpy = vi.spyOn(activeSession.queue, "enqueue").mockReturnValue(null);

    const result = (await __testHooks.handleJob({
      type: "INGEST_DOCUMENT",
      payload: { projectId: project.id, filePath }
    })) as IngestResult;

    expect(result.snapshotCreated).toBe(true);
    expect(result.changeStart).not.toBeNull();
    expect(result.changeEnd).not.toBeNull();

    expect(enqueueSpy).toHaveBeenCalledTimes(3);

    const first = enqueueSpy.mock.calls[0];
    const second = enqueueSpy.mock.calls[1];
    const third = enqueueSpy.mock.calls[2];

    expect(first?.[0]).toEqual(
      expect.objectContaining({
        type: "RUN_SCENES",
        payload: expect.objectContaining({
          projectId: project.id,
          documentId: result.documentId,
          snapshotId: result.snapshotId,
          rootPath
        })
      })
    );
    expect(first?.[1]).toBe(`scenes:${project.id}:${result.documentId}`);

    expect(second?.[0]).toEqual(
      expect.objectContaining({
        type: "RUN_STYLE",
        payload: expect.objectContaining({
          projectId: project.id,
          documentId: result.documentId,
          snapshotId: result.snapshotId,
          rootPath
        })
      })
    );
    expect(second?.[1]).toBe(`style:${project.id}:${result.documentId}`);

    expect(third?.[0]).toEqual(
      expect.objectContaining({
        type: "RUN_EXTRACTION",
        payload: expect.objectContaining({
          projectId: project.id,
          documentId: result.documentId,
          snapshotId: result.snapshotId,
          rootPath,
          changeStart: result.changeStart,
          changeEnd: result.changeEnd
        })
      })
    );
    expect(third?.[1]).toBe(`extraction:${project.id}:${result.documentId}`);
  });

  it("RUN_EXTRACTION enqueues RUN_CONTINUITY with touched entity ids", async () => {
    const rootPath = makeTempRoot("chain-extract");
    const filePath = copyFixture(rootPath, "contradiction.md");
    const project = (await __testHooks.dispatch("project.createOrOpen", {
      rootPath,
      name: "Chaining Extraction"
    })) as ProjectSummary;

    const activeSession = __testHooks.getSession();
    if (!activeSession) {
      throw new Error("Expected active session");
    }

    const ingest = await ingestDocument(activeSession.handle.db, {
      projectId: project.id,
      rootPath,
      filePath
    });

    const enqueueSpy = vi.spyOn(activeSession.queue, "enqueue").mockReturnValue(null);

    const extractionPayload: Extract<WorkerJob, { type: "RUN_EXTRACTION" }>["payload"] = {
      projectId: project.id,
      documentId: ingest.documentId,
      snapshotId: ingest.snapshotId,
      rootPath,
      changeStart: ingest.changeStart,
      changeEnd: ingest.changeEnd
    };

    const extractionResult = await __testHooks.handleJob({
      type: "RUN_EXTRACTION",
      payload: extractionPayload
    });

    expect(extractionResult).toEqual({ ok: true });
    expect(enqueueSpy).toHaveBeenCalledTimes(1);

    const continuityCall = enqueueSpy.mock.calls[0];
    expect(continuityCall?.[0]).toEqual(
      expect.objectContaining({
        type: "RUN_CONTINUITY",
        payload: expect.objectContaining({
          projectId: project.id,
          documentId: ingest.documentId,
          snapshotId: ingest.snapshotId,
          rootPath,
          entityIds: expect.any(Array)
        })
      })
    );
    expect(continuityCall?.[1]).toBe(`continuity:${project.id}:${ingest.documentId}`);
  });
});

describe("worker session lifecycle", () => {
  it("ensureSession creates resources and teardownSession closes DB/watchers/queue/timers", async () => {
    const rootPath = makeTempRoot("session-life");
    const activeSession = await __testHooks.ensureSession(rootPath);

    expect(activeSession.rootPath).toBe(rootPath);
    expect(activeSession.handle.db.prepare("SELECT 1 AS ok").get()).toEqual({ ok: 1 });

    const stopSpy = vi.spyOn(activeSession.queue, "stop");
    const closeSpy = vi.spyOn(activeSession.watcher, "close");

    __testHooks.seedDebounceTimerForTests("/tmp/debounce-seed");
    expect(__testHooks.getDebounceTimerCount()).toBeGreaterThan(0);

    const dbRef = activeSession.handle.db;
    await __testHooks.teardownSession();

    expect(stopSpy).toHaveBeenCalledOnce();
    expect(closeSpy).toHaveBeenCalledOnce();
    expect(__testHooks.getSession()).toBeNull();
    expect(__testHooks.getDebounceTimerCount()).toBe(0);
    expect(() => dbRef.prepare("SELECT 1").get()).toThrow();
  });

  it("switching to a different project root creates a fresh session and isolates state", async () => {
    const rootA = makeTempRoot("session-a");
    const rootB = makeTempRoot("session-b");

    const sessionA = await __testHooks.ensureSession(rootA);
    const createdA = createProject(sessionA.handle.db, rootA, "Project A");
    expect(createdA.root_path).toBe(path.resolve(rootA));

    const stopSpyA = vi.spyOn(sessionA.queue, "stop");
    const closeSpyA = vi.spyOn(sessionA.watcher, "close");

    const sessionB = await __testHooks.ensureSession(rootB);
    const createdB = createProject(sessionB.handle.db, rootB, "Project B");

    expect(stopSpyA).toHaveBeenCalledOnce();
    expect(closeSpyA).toHaveBeenCalledOnce();
    expect(sessionB.rootPath).toBe(rootB);
    expect(sessionB).not.toBe(sessionA);
    expect(createdB.root_path).toBe(path.resolve(rootB));
    expect(() => sessionA.handle.db.prepare("SELECT 1").get()).toThrow();
    expect(getProjectByRootPath(sessionB.handle.db, path.resolve(rootA))).toBeNull();
  });
});

describe("worker busy tracking", () => {
  it("tracks the correct RPC whitelist for busy status", () => {
    const allMethods: WorkerMethods[] = [
      "project.createOrOpen",
      "project.getCurrent",
      "project.getStatus",
      "project.subscribeStatus",
      "project.getDiagnostics",
      "project.getProcessingState",
      "project.getHistory",
      "project.addDocument",
      "project.stats",
      "project.evidenceCoverage",
      "system.healthCheck",
      "search.query",
      "search.ask",
      "scenes.list",
      "scenes.get",
      "issues.list",
      "issues.dismiss",
      "issues.undoDismiss",
      "issues.resolve",
      "issues.undoResolve",
      "style.getReport",
      "bible.listEntities",
      "bible.getEntity",
      "canon.confirmClaim",
      "export.run",
      "jobs.list",
      "jobs.cancel"
    ];

    const nonBusyMethods = new Set<WorkerMethods>([
      "project.getStatus",
      "project.subscribeStatus",
      "project.getCurrent",
      "project.getDiagnostics",
      "project.stats",
      "project.evidenceCoverage",
      "jobs.list"
    ]);

    expect(allMethods).toHaveLength(27);

    for (const method of allMethods) {
      expect(shouldTrackRpcAsBusy(method)).toBe(!nonBusyMethods.has(method));
    }
    expect(shouldTrackRpcAsBusy("unknown.method")).toBe(true);
  });

  it("reports busy while a long RPC operation is in-flight", async () => {
    const rootPath = makeTempRoot("busy");
    const filePath = path.join(rootPath, "busy.md");
    fs.writeFileSync(filePath, "# Busy\n\nshort text", "utf8");

    const project = (await __testHooks.dispatch("project.createOrOpen", {
      rootPath,
      name: "Busy Tracking"
    })) as ProjectSummary;

    const activeSession = __testHooks.getSession();
    if (!activeSession) {
      throw new Error("Expected active session");
    }

    vi.spyOn(activeSession.queue, "enqueue").mockImplementation((job, dedupeKey, awaitResult) => {
      if (awaitResult !== true) {
        return null;
      }
      const delayedResult: IngestResult = {
        documentId: `${project.id}-doc`,
        snapshotId: `${project.id}-snapshot`,
        snapshotCreated: true,
        chunksCreated: 1,
        chunksUpdated: 0,
        chunksDeleted: 0,
        changeStart: 0,
        changeEnd: 0
      };
      void job;
      void dedupeKey;
      return new Promise((resolve) => {
        setTimeout(() => resolve(delayedResult), 120);
      });
    });

    const requestPromise = handleRpcMessage({
      id: "busy-request",
      method: "project.addDocument",
      params: { path: filePath }
    });

    await sleep(20);

    const duringStatus = (await __testHooks.dispatch("project.getStatus")) as WorkerStatus;
    expect(duringStatus.state).toBe("busy");
    expect(duringStatus.lastJob).toBe("project.addDocument");

    const response = await requestPromise;
    expect(response).toEqual(
      expect.objectContaining({ id: "busy-request", result: expect.objectContaining({ snapshotCreated: true }) })
    );

    const finalStatus = (await __testHooks.dispatch("project.getStatus")) as WorkerStatus;
    expect(finalStatus.state).toBe("idle");
    expect(finalStatus.lastJob).toBe("project.addDocument");
  });
});
