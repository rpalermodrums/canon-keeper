import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  cancelJob,
  claimNextJob,
  completeJob,
  createProject,
  enqueueJob,
  failJob,
  getJobById,
  getQueueDepth,
  listQueuedJobs,
  openDatabase,
  resetRunningJobs
} from "./index";

function setupDb() {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "canonkeeper-"));
  const handle = openDatabase({ rootPath });
  const project = createProject(handle.db, rootPath, "Test Project");
  return { rootPath, db: handle.db, projectId: project.id };
}

describe("jobQueueRepo", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const root of tempRoots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    tempRoots.length = 0;
  });

  it("enqueues, claims, and completes a job with expected state transitions", () => {
    const setup = setupDb();
    tempRoots.push(setup.rootPath);

    const enqueueTime = 1_700_000_000_000;
    const claimTime = enqueueTime + 10;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(enqueueTime);

    const queued = enqueueJob(setup.db, {
      projectId: setup.projectId,
      type: "RUN_SCENES",
      payload: { projectId: setup.projectId, documentId: "doc-1" },
      dedupeKey: `scene:${setup.projectId}:doc-1`
    });

    expect(queued.status).toBe("queued");
    expect(queued.attempts).toBe(0);
    expect(queued.next_run_at).toBe(enqueueTime);
    expect(getQueueDepth(setup.db)).toBe(1);

    nowSpy.mockReturnValue(claimTime);
    const claimed = claimNextJob(setup.db, claimTime);
    if (!claimed) {
      throw new Error("Expected queued job to be claimed");
    }

    expect(claimed.id).toBe(queued.id);
    expect(claimed.status).toBe("running");
    expect(claimed.attempts).toBe(1);
    expect(claimed.updated_at).toBe(claimTime);

    const persistedRunning = getJobById(setup.db, queued.id);
    if (!persistedRunning) {
      throw new Error("Expected claimed job to still exist");
    }
    expect(persistedRunning.status).toBe("running");
    expect(persistedRunning.attempts).toBe(1);
    expect(listQueuedJobs(setup.db, setup.projectId)).toHaveLength(0);

    completeJob(setup.db, queued.id);
    expect(getJobById(setup.db, queued.id)).toBeNull();
    expect(getQueueDepth(setup.db)).toBe(0);
  });

  it("deduplicates by key and requeues a running job with incremented attempts", () => {
    const setup = setupDb();
    tempRoots.push(setup.rootPath);

    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(10_000);

    const firstEnqueue = enqueueJob(setup.db, {
      projectId: setup.projectId,
      type: "INGEST_DOCUMENT",
      payload: { projectId: setup.projectId, filePath: "draft-v1.md" },
      dedupeKey: `ingest:${setup.projectId}:draft`
    });

    const running = claimNextJob(setup.db, 10_001);
    if (!running) {
      throw new Error("Expected first enqueue to be claimable");
    }
    expect(running.status).toBe("running");
    expect(running.attempts).toBe(1);

    nowSpy.mockReturnValue(10_002);
    const secondEnqueue = enqueueJob(setup.db, {
      projectId: setup.projectId,
      type: "INGEST_DOCUMENT",
      payload: { projectId: setup.projectId, filePath: "draft-v2.md" },
      dedupeKey: `ingest:${setup.projectId}:draft`
    });

    expect(secondEnqueue.id).toBe(firstEnqueue.id);
    expect(secondEnqueue.status).toBe("queued");
    expect(secondEnqueue.attempts).toBe(2);
    expect(JSON.parse(secondEnqueue.payload_json)).toEqual({
      projectId: setup.projectId,
      filePath: "draft-v2.md"
    });
    expect(getQueueDepth(setup.db)).toBe(1);

    const queuedList = listQueuedJobs(setup.db, setup.projectId);
    expect(queuedList).toHaveLength(1);
    const [queuedRow] = queuedList;
    if (!queuedRow) {
      throw new Error("Expected queued job to be listed");
    }
    expect(queuedRow.id).toBe(firstEnqueue.id);
    expect(queuedRow.attempts).toBe(2);

    const reclaimed = claimNextJob(setup.db, 10_003);
    if (!reclaimed) {
      throw new Error("Expected deduped queued job to be claimable");
    }
    expect(reclaimed.id).toBe(firstEnqueue.id);
    expect(reclaimed.status).toBe("running");
    expect(reclaimed.attempts).toBe(3);
  });

  it("fails and retries a job only when next_run_at is reached", () => {
    const setup = setupDb();
    tempRoots.push(setup.rootPath);

    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(20_000);

    const queued = enqueueJob(setup.db, {
      projectId: setup.projectId,
      type: "RUN_STYLE",
      payload: { projectId: setup.projectId, documentId: "doc-2" },
      dedupeKey: `style:${setup.projectId}:doc-2`
    });

    const firstClaim = claimNextJob(setup.db, 20_001);
    if (!firstClaim) {
      throw new Error("Expected queued job to be claimable");
    }
    expect(firstClaim.attempts).toBe(1);

    const retryAt = 25_000;
    nowSpy.mockReturnValue(20_100);
    failJob(setup.db, queued.id, retryAt);

    const failed = getJobById(setup.db, queued.id);
    if (!failed) {
      throw new Error("Expected failed job to remain in queue");
    }
    expect(failed.status).toBe("failed");
    expect(failed.attempts).toBe(1);
    expect(failed.next_run_at).toBe(retryAt);
    expect(getQueueDepth(setup.db)).toBe(1);

    expect(claimNextJob(setup.db, retryAt - 1)).toBeNull();

    const retryClaim = claimNextJob(setup.db, retryAt);
    if (!retryClaim) {
      throw new Error("Expected failed job to be claimable at retry time");
    }
    expect(retryClaim.id).toBe(queued.id);
    expect(retryClaim.status).toBe("running");
    expect(retryClaim.attempts).toBe(2);
  });

  it("returns null when claiming with an empty queue", () => {
    const setup = setupDb();
    tempRoots.push(setup.rootPath);

    expect(claimNextJob(setup.db, Date.now())).toBeNull();
    expect(getQueueDepth(setup.db)).toBe(0);
  });

  it("claims by earliest next_run_at across queued and failed jobs", () => {
    const setup = setupDb();
    tempRoots.push(setup.rootPath);

    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(30_000);
    const first = enqueueJob(setup.db, {
      projectId: setup.projectId,
      type: "RUN_EXTRACTION",
      payload: { projectId: setup.projectId, documentId: "doc-a" },
      dedupeKey: `extract:${setup.projectId}:doc-a`
    });

    nowSpy.mockReturnValue(31_000);
    const second = enqueueJob(setup.db, {
      projectId: setup.projectId,
      type: "RUN_EXTRACTION",
      payload: { projectId: setup.projectId, documentId: "doc-b" },
      dedupeKey: `extract:${setup.projectId}:doc-b`
    });

    nowSpy.mockReturnValue(31_100);
    failJob(setup.db, second.id, 29_500);

    const firstClaim = claimNextJob(setup.db, 40_000);
    if (!firstClaim) {
      throw new Error("Expected a job to be claimable");
    }
    expect(firstClaim.id).toBe(second.id);

    const secondClaim = claimNextJob(setup.db, 40_000);
    if (!secondClaim) {
      throw new Error("Expected another job to be claimable");
    }
    expect(secondClaim.id).toBe(first.id);
  });

  it("cancels only queued jobs and can reset running jobs back to queued", () => {
    const setup = setupDb();
    tempRoots.push(setup.rootPath);

    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(40_000);
    const cancellable = enqueueJob(setup.db, {
      projectId: setup.projectId,
      type: "RUN_CONTINUITY",
      payload: { projectId: setup.projectId, entityIds: ["e1"] },
      dedupeKey: `continuity:${setup.projectId}:a`
    });
    const runningCandidate = enqueueJob(setup.db, {
      projectId: setup.projectId,
      type: "RUN_CONTINUITY",
      payload: { projectId: setup.projectId, entityIds: ["e2"] },
      dedupeKey: `continuity:${setup.projectId}:b`
    });

    expect(cancelJob(setup.db, cancellable.id)).toBe(true);
    expect(getJobById(setup.db, cancellable.id)).toBeNull();

    const running = claimNextJob(setup.db, 40_001);
    if (!running) {
      throw new Error("Expected second job to be claimable");
    }
    expect(running.id).toBe(runningCandidate.id);
    expect(running.status).toBe("running");
    expect(cancelJob(setup.db, running.id)).toBe(false);

    resetRunningJobs(setup.db);

    const reset = getJobById(setup.db, running.id);
    if (!reset) {
      throw new Error("Expected running job to still exist after reset");
    }
    expect(reset.status).toBe("queued");
    expect(getQueueDepth(setup.db)).toBe(1);
    expect(listQueuedJobs(setup.db, setup.projectId).map((job) => job.id)).toEqual([running.id]);
  });
});
