import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  openDatabase,
  createProject,
  createDocument,
  getProcessingState,
  upsertProcessingState,
  listProcessingStates
} from "../storage";

function setupDb() {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "canonkeeper-"));
  const handle = openDatabase({ rootPath });
  const project = createProject(handle.db, rootPath, "Test Project");
  return { rootPath, db: handle.db, projectId: project.id };
}

describe("processing state", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    tempRoots.length = 0;
  });

  it("upserts per-document stage state", () => {
    const setup = setupDb();
    tempRoots.push(setup.rootPath);

    const doc = createDocument(setup.db, setup.projectId, path.join(setup.rootPath, "draft.md"), "md");

    upsertProcessingState(setup.db, {
      documentId: doc.id,
      snapshotId: "snap-1",
      stage: "ingest",
      status: "pending"
    });

    upsertProcessingState(setup.db, {
      documentId: doc.id,
      snapshotId: "snap-2",
      stage: "ingest",
      status: "ok"
    });

    const states = listProcessingStates(setup.db, setup.projectId);
    expect(states.length).toBe(1);
    expect(states[0]?.snapshot_id).toBe("snap-2");
    expect(states[0]?.status).toBe("ok");
  });

  it("tracks lifecycle transitions and getProcessingState after each write", () => {
    const setup = setupDb();
    tempRoots.push(setup.rootPath);

    const doc = createDocument(setup.db, setup.projectId, path.join(setup.rootPath, "chapter-1.md"), "md");

    upsertProcessingState(setup.db, {
      documentId: doc.id,
      snapshotId: "snap-pending",
      stage: "scenes",
      status: "pending"
    });
    const pending = getProcessingState(setup.db, doc.id, "scenes");
    expect(pending?.status).toBe("pending");
    expect(pending?.snapshot_id).toBe("snap-pending");
    expect(pending?.error).toBeNull();

    upsertProcessingState(setup.db, {
      documentId: doc.id,
      snapshotId: "snap-complete",
      stage: "scenes",
      status: "ok"
    });
    const complete = getProcessingState(setup.db, doc.id, "scenes");
    expect(complete?.status).toBe("ok");
    expect(complete?.snapshot_id).toBe("snap-complete");
    expect(complete?.error).toBeNull();

    upsertProcessingState(setup.db, {
      documentId: doc.id,
      snapshotId: "snap-error",
      stage: "scenes",
      status: "failed",
      error: "Scene parse failed"
    });
    const failed = getProcessingState(setup.db, doc.id, "scenes");
    expect(failed?.status).toBe("failed");
    expect(failed?.snapshot_id).toBe("snap-error");
    expect(failed?.error).toBe("Scene parse failed");
  });

  it("is idempotent for repeated updates of the same state", () => {
    const setup = setupDb();
    tempRoots.push(setup.rootPath);

    const doc = createDocument(setup.db, setup.projectId, path.join(setup.rootPath, "chapter-2.md"), "md");

    upsertProcessingState(setup.db, {
      documentId: doc.id,
      snapshotId: "snap-same",
      stage: "style",
      status: "pending"
    });
    upsertProcessingState(setup.db, {
      documentId: doc.id,
      snapshotId: "snap-same",
      stage: "style",
      status: "pending"
    });

    const state = getProcessingState(setup.db, doc.id, "style");
    const count = setup.db
      .prepare("SELECT COUNT(*) as count FROM document_processing_state WHERE document_id = ? AND stage = ?")
      .get(doc.id, "style") as { count: number };

    expect(state?.status).toBe("pending");
    expect(state?.snapshot_id).toBe("snap-same");
    expect(count.count).toBe(1);
  });

  it("tracks multiple documents independently", () => {
    const setup = setupDb();
    tempRoots.push(setup.rootPath);

    const docA = createDocument(setup.db, setup.projectId, path.join(setup.rootPath, "a.md"), "md");
    const docB = createDocument(setup.db, setup.projectId, path.join(setup.rootPath, "b.md"), "md");

    upsertProcessingState(setup.db, {
      documentId: docA.id,
      snapshotId: "snap-a",
      stage: "ingest",
      status: "ok"
    });
    upsertProcessingState(setup.db, {
      documentId: docB.id,
      snapshotId: "snap-b",
      stage: "ingest",
      status: "failed",
      error: "Failed to parse markdown"
    });
    upsertProcessingState(setup.db, {
      documentId: docB.id,
      snapshotId: "snap-b",
      stage: "scenes",
      status: "pending"
    });

    const aIngest = getProcessingState(setup.db, docA.id, "ingest");
    const bIngest = getProcessingState(setup.db, docB.id, "ingest");
    const bScenes = getProcessingState(setup.db, docB.id, "scenes");
    const states = listProcessingStates(setup.db, setup.projectId);

    expect(aIngest?.status).toBe("ok");
    expect(bIngest?.status).toBe("failed");
    expect(bIngest?.error).toBe("Failed to parse markdown");
    expect(bScenes?.status).toBe("pending");
    expect(states).toHaveLength(3);
    expect(states.map((state) => state.document_id).sort()).toEqual(
      [docA.id, docB.id, docB.id].sort()
    );
  });
});
