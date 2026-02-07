import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { hashText } from "../../../../../../packages/shared/utils/hashing";
import { runSceneStage } from "./scenes";
import {
  createDocument,
  createProject,
  getProcessingState,
  insertChunks,
  insertSnapshot,
  listEvents,
  listScenesForProject,
  openDatabase,
  upsertProcessingState
} from "../../storage";

type StageSetup = {
  rootPath: string;
  db: Database.Database;
  projectId: string;
  documentId: string;
  snapshotId: string;
};

const tempRoots: string[] = [];
const openDbs: Database.Database[] = [];

function setupStage(fullText = "# Chapter One\nThe harbor slept.\n***\nI kept watch."): StageSetup {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "canonkeeper-stage-scenes-"));
  const handle = openDatabase({ rootPath });
  const project = createProject(handle.db, rootPath, "Scenes Stage Test");
  const document = createDocument(handle.db, project.id, path.join(rootPath, "draft.md"), "md");
  const snapshot = insertSnapshot(handle.db, document.id, fullText, hashText(fullText)).snapshot;

  tempRoots.push(rootPath);
  openDbs.push(handle.db);

  return {
    rootPath,
    db: handle.db,
    projectId: project.id,
    documentId: document.id,
    snapshotId: snapshot.id
  };
}

function insertTestChunks(
  db: Database.Database,
  documentId: string,
  chunks: Array<{ ordinal: number; text: string }>
): void {
  const rows = chunks.map((chunk, index) => {
    const startChar = chunks
      .slice(0, index)
      .reduce((sum, current) => sum + current.text.length + 1, 0);
    return {
      document_id: documentId,
      ordinal: chunk.ordinal,
      text: chunk.text,
      text_hash: hashText(chunk.text),
      start_char: startChar,
      end_char: startChar + chunk.text.length
    };
  });
  insertChunks(db, documentId, rows);
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const db of openDbs) {
    db.close();
  }
  openDbs.length = 0;

  for (const rootPath of tempRoots) {
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
  tempRoots.length = 0;
});

describe("runSceneStage", () => {
  it("persists scene rows from chunk boundaries on happy path", async () => {
    const setup = setupStage();
    insertTestChunks(setup.db, setup.documentId, [
      { ordinal: 0, text: "# Chapter One\nThe harbor slept." },
      { ordinal: 1, text: "***\nI kept watch from the tower." }
    ]);

    const result = await runSceneStage({
      db: setup.db,
      projectId: setup.projectId,
      documentId: setup.documentId,
      snapshotId: setup.snapshotId,
      rootPath: setup.rootPath
    });

    const scenes = listScenesForProject(setup.db, setup.projectId);
    expect(result).toEqual({ ok: true });
    expect(scenes).toHaveLength(2);
    expect(scenes[0]?.ordinal).toBe(0);
    expect(scenes[0]?.title).toBe("Chapter One");
    expect(scenes[1]?.ordinal).toBe(1);
    expect(getProcessingState(setup.db, setup.documentId, "scenes")?.status).toBe("ok");
  });

  it("early-exits when snapshot is stale", async () => {
    const setup = setupStage();
    insertTestChunks(setup.db, setup.documentId, [{ ordinal: 0, text: "No-op scene chunk." }]);

    const result = await runSceneStage({
      db: setup.db,
      projectId: setup.projectId,
      documentId: setup.documentId,
      snapshotId: "stale-snapshot-id",
      rootPath: setup.rootPath
    });

    expect(result).toEqual({ ok: true, skipped: true });
    expect(getProcessingState(setup.db, setup.documentId, "scenes")).toBeNull();
    expect(listScenesForProject(setup.db, setup.projectId)).toHaveLength(0);
  });

  it("early-exits when current snapshot was already processed", async () => {
    const setup = setupStage();
    upsertProcessingState(setup.db, {
      documentId: setup.documentId,
      snapshotId: setup.snapshotId,
      stage: "scenes",
      status: "ok"
    });
    const before = getProcessingState(setup.db, setup.documentId, "scenes");

    const result = await runSceneStage({
      db: setup.db,
      projectId: setup.projectId,
      documentId: setup.documentId,
      snapshotId: setup.snapshotId,
      rootPath: setup.rootPath
    });

    const after = getProcessingState(setup.db, setup.documentId, "scenes");
    expect(result).toEqual({ ok: true, skipped: true });
    expect(after).toEqual(before);
    expect(listEvents(setup.db, setup.projectId)).toHaveLength(0);
  });

  it("marks failed state, logs stage_failed, and rethrows when scene persistence fails", async () => {
    const setup = setupStage();
    insertTestChunks(setup.db, setup.documentId, [{ ordinal: 0, text: "I kept watch." }]);
    setup.db.exec("DROP TABLE scene;");

    await expect(
      runSceneStage({
        db: setup.db,
        projectId: setup.projectId,
        documentId: setup.documentId,
        snapshotId: setup.snapshotId,
        rootPath: setup.rootPath
      })
    ).rejects.toThrow(/no such table: scene/i);

    const processingState = getProcessingState(setup.db, setup.documentId, "scenes");
    const stageFailedEvent = listEvents(setup.db, setup.projectId).find(
      (event) => event.event_type === "stage_failed"
    );
    const payload = JSON.parse(stageFailedEvent?.payload_json ?? "{}") as {
      stage?: string;
      documentId?: string;
      message?: string;
    };

    expect(processingState?.status).toBe("failed");
    expect(processingState?.error).toMatch(/no such table: scene/i);
    expect(stageFailedEvent).toBeTruthy();
    expect(payload.stage).toBe("scenes");
    expect(payload.documentId).toBe(setup.documentId);
  });

  it("is idempotent across repeated runs for the same snapshot", async () => {
    const setup = setupStage();
    insertTestChunks(setup.db, setup.documentId, [
      { ordinal: 0, text: "# Prologue\nThe hall was silent." },
      { ordinal: 1, text: "***\nFootsteps echoed behind me." }
    ]);

    const firstRun = await runSceneStage({
      db: setup.db,
      projectId: setup.projectId,
      documentId: setup.documentId,
      snapshotId: setup.snapshotId,
      rootPath: setup.rootPath
    });
    const firstScenes = listScenesForProject(setup.db, setup.projectId);

    const secondRun = await runSceneStage({
      db: setup.db,
      projectId: setup.projectId,
      documentId: setup.documentId,
      snapshotId: setup.snapshotId,
      rootPath: setup.rootPath
    });
    const secondScenes = listScenesForProject(setup.db, setup.projectId);

    expect(firstRun).toEqual({ ok: true });
    expect(secondRun).toEqual({ ok: true, skipped: true });
    expect(secondScenes).toEqual(firstScenes);
    expect(getProcessingState(setup.db, setup.documentId, "scenes")?.status).toBe("ok");
  });
});
