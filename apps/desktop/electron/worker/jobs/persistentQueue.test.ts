import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { getQueueDepth, openDatabase, createProject } from "../storage";
import { PersistentJobQueue } from "./persistentQueue";
import type { WorkerJob, WorkerJobResult } from "./types";

function setupDb() {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "canonkeeper-"));
  const handle = openDatabase({ rootPath });
  const project = createProject(handle.db, rootPath, "Test Project");
  return { rootPath, db: handle.db, projectId: project.id, dbFile: handle.paths.dbFile };
}

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Condition not met in time");
}

describe("PersistentJobQueue", () => {
  const tempRoots: string[] = [];
  const openDbs: Database.Database[] = [];
  const activeQueues: Array<PersistentJobQueue<WorkerJob, WorkerJobResult>> = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const queue of activeQueues) {
      queue.stop();
    }
    activeQueues.length = 0;
    await new Promise((resolve) => setTimeout(resolve, 300));
    for (const db of openDbs) {
      try {
        db.close();
      } catch {
        // no-op for already closed handles in restart tests
      }
    }
    openDbs.length = 0;
    for (const root of tempRoots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    tempRoots.length = 0;
  });

  it("requeues updates while running", async () => {
    const setup = setupDb();
    tempRoots.push(setup.rootPath);
    openDbs.push(setup.db);

    let release: () => void = () => undefined;
    let runCount = 0;

    const queue = new PersistentJobQueue<WorkerJob, WorkerJobResult>(setup.db, async (_job) => {
      runCount += 1;
      if (runCount === 1) {
        await new Promise<void>((resolve) => {
          release = () => resolve();
        });
      }
      return { ok: true };
    });
    activeQueues.push(queue);

    queue.start();

    const job: WorkerJob = {
      type: "INGEST_DOCUMENT",
      payload: { projectId: setup.projectId, filePath: path.join(setup.rootPath, "draft.md") }
    };

    queue.enqueue(job, `ingest:${setup.projectId}:draft`, true);
    await waitFor(() => runCount === 1);

    queue.enqueue(
      { type: "INGEST_DOCUMENT", payload: { projectId: setup.projectId, filePath: "draft2.md" } },
      `ingest:${setup.projectId}:draft`
    );

    release();

    await waitFor(() => runCount === 2);
  });

  it("persists queued jobs across restart and dequeues after reopening", async () => {
    const setup = setupDb();
    tempRoots.push(setup.rootPath);
    openDbs.push(setup.db);

    const firstQueue = new PersistentJobQueue<WorkerJob, WorkerJobResult>(setup.db, async () => ({
      ok: true
    }));
    activeQueues.push(firstQueue);
    firstQueue.stop();

    const queuedJob: WorkerJob = {
      type: "INGEST_DOCUMENT",
      payload: { projectId: setup.projectId, filePath: path.join(setup.rootPath, "draft.md") }
    };
    firstQueue.enqueue(queuedJob, `ingest:${setup.projectId}:persisted`);
    expect(getQueueDepth(setup.db)).toBe(1);

    setup.db.close();
    openDbs.pop();

    const reopened = openDatabase({ rootPath: setup.rootPath }).db;
    openDbs.push(reopened);
    const seen: WorkerJob[] = [];
    const secondQueue = new PersistentJobQueue<WorkerJob, WorkerJobResult>(reopened, async (job) => {
      seen.push(job);
      return { ok: true };
    });
    activeQueues.push(secondQueue);

    secondQueue.start();
    await waitFor(() => seen.length === 1);

    expect(seen[0]?.type).toBe("INGEST_DOCUMENT");
    expect((seen[0]?.payload as { filePath: string }).filePath).toContain("draft.md");
    expect(getQueueDepth(reopened)).toBe(0);
  });

  it("processes multiple job types in queue order", async () => {
    const setup = setupDb();
    tempRoots.push(setup.rootPath);
    openDbs.push(setup.db);

    const clock = { now: 10_000 };
    vi.spyOn(Date, "now").mockImplementation(() => {
      const value = clock.now;
      clock.now += 1;
      return value;
    });

    const processedTypes: string[] = [];
    const queue = new PersistentJobQueue<WorkerJob, WorkerJobResult>(setup.db, async (job) => {
      processedTypes.push(job.type);
      return { ok: true };
    });
    activeQueues.push(queue);
    queue.start();

    queue.enqueue(
      {
        type: "INGEST_DOCUMENT",
        payload: { projectId: setup.projectId, filePath: "draft-a.md" }
      },
      `ingest:${setup.projectId}:a`
    );
    queue.enqueue(
      {
        type: "RUN_SCENES",
        payload: {
          projectId: setup.projectId,
          documentId: "doc-a",
          snapshotId: "snap-a",
          rootPath: setup.rootPath
        }
      },
      `scenes:${setup.projectId}:a`
    );
    queue.enqueue(
      {
        type: "RUN_STYLE",
        payload: {
          projectId: setup.projectId,
          documentId: "doc-a",
          snapshotId: "snap-a",
          rootPath: setup.rootPath
        }
      },
      `style:${setup.projectId}:a`
    );

    await waitFor(() => processedTypes.length === 3);
    expect(processedTypes).toEqual(["INGEST_DOCUMENT", "RUN_SCENES", "RUN_STYLE"]);
    expect(getQueueDepth(setup.db)).toBe(0);
  });

  it("removes completed jobs after awaitResult resolution", async () => {
    const setup = setupDb();
    tempRoots.push(setup.rootPath);
    openDbs.push(setup.db);

    const queue = new PersistentJobQueue<WorkerJob, WorkerJobResult>(setup.db, async () => ({
      ok: true
    }));
    activeQueues.push(queue);
    queue.start();

    const dedupeKey = `style:${setup.projectId}:await`;
    const resultPromise = queue.enqueue(
      {
        type: "RUN_STYLE",
        payload: {
          projectId: setup.projectId,
          documentId: "doc-await",
          snapshotId: "snap-await",
          rootPath: setup.rootPath
        }
      },
      dedupeKey,
      true
    );

    if (!resultPromise) {
      throw new Error("Expected awaitResult enqueue to return a promise");
    }

    const result = await resultPromise;
    expect(result).toEqual({ ok: true });
    await waitFor(() => getQueueDepth(setup.db) === 0);

    const remaining = setup.db
      .prepare("SELECT COUNT(*) as count FROM job_queue WHERE dedupe_key = ?")
      .get(dedupeKey) as { count: number };
    expect(remaining.count).toBe(0);
  });

  it("marks corrupt payload rows as failed and continues with valid jobs", async () => {
    const setup = setupDb();
    tempRoots.push(setup.rootPath);
    openDbs.push(setup.db);

    const now = Date.now();
    setup.db
      .prepare(
        "INSERT INTO job_queue (id, project_id, type, payload_json, dedupe_key, status, attempts, next_run_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        "job-corrupt",
        setup.projectId,
        "RUN_SCENES",
        "{this is not valid json}",
        `corrupt:${setup.projectId}`,
        "queued",
        0,
        now,
        now,
        now
      );

    const processedTypes: string[] = [];
    const queue = new PersistentJobQueue<WorkerJob, WorkerJobResult>(setup.db, async (job) => {
      processedTypes.push(job.type);
      return { ok: true };
    });
    activeQueues.push(queue);
    queue.start();

    await waitFor(() => {
      const row = setup.db
        .prepare("SELECT status FROM job_queue WHERE id = ?")
        .get("job-corrupt") as { status: string } | undefined;
      return row?.status === "failed";
    });

    const corruptRow = setup.db
      .prepare("SELECT status, attempts FROM job_queue WHERE id = ?")
      .get("job-corrupt") as { status: string; attempts: number } | undefined;
    expect(corruptRow?.status).toBe("failed");
    expect(corruptRow?.attempts).toBe(1);

    queue.enqueue(
      {
        type: "RUN_CONTINUITY",
        payload: {
          projectId: setup.projectId,
          documentId: "doc-corrupt",
          snapshotId: "snap-corrupt",
          rootPath: setup.rootPath,
          entityIds: []
        }
      },
      `continuity:${setup.projectId}:recovery`
    );

    await waitFor(() => processedTypes.includes("RUN_CONTINUITY"));
    expect(processedTypes).toEqual(["RUN_CONTINUITY"]);
  });
});
