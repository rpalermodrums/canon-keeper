import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { hashText } from "../../../../../../packages/shared/utils/hashing";
import { runExtractionStage } from "./extraction";
import {
  createDocument,
  createProject,
  getProcessingState,
  insertChunks,
  insertSnapshot,
  listClaimsByField,
  listEntities,
  listEvents,
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

type ChunkInput = {
  ordinal: number;
  text: string;
};

const tempRoots: string[] = [];
const openDbs: Database.Database[] = [];

function setupStage(fullText = "Default extraction text."): StageSetup {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "canonkeeper-stage-extraction-"));
  const handle = openDatabase({ rootPath });
  const project = createProject(handle.db, rootPath, "Extraction Stage Test");
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

function insertTestChunks(db: Database.Database, documentId: string, chunks: ChunkInput[]): void {
  const rows = chunks.map((chunk, index) => {
    const priorLength = chunks
      .slice(0, index)
      .reduce((sum, current) => sum + current.text.length + 1, 0);
    const startChar = priorLength;
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

describe("runExtractionStage", () => {
  it("persists extraction results and marks stage state ok on happy path", async () => {
    const setup = setupStage("Mira's eyes were green in the lantern light.");
    insertTestChunks(setup.db, setup.documentId, [
      { ordinal: 0, text: "Mira's eyes were green in the lantern light." }
    ]);

    const result = await runExtractionStage({
      db: setup.db,
      projectId: setup.projectId,
      documentId: setup.documentId,
      snapshotId: setup.snapshotId,
      rootPath: setup.rootPath,
      changeStart: 0,
      changeEnd: 0
    });

    const entities = listEntities(setup.db, setup.projectId);
    const mira = entities.find((entity) => entity.display_name === "Mira");
    const claims = mira ? listClaimsByField(setup.db, mira.id, "eye_color") : [];

    expect(result.ok).toBe(true);
    expect(result.touchedEntityIds.length).toBeGreaterThan(0);
    expect(mira).toBeTruthy();
    expect(claims).toHaveLength(1);
    expect(claims[0]?.value_json).toBe(JSON.stringify("green"));
    expect(getProcessingState(setup.db, setup.documentId, "extraction")?.status).toBe("ok");
  });

  it("early-exits when snapshot is stale and performs no writes", async () => {
    const setup = setupStage("Stale extraction snapshot.");

    const result = await runExtractionStage({
      db: setup.db,
      projectId: setup.projectId,
      documentId: setup.documentId,
      snapshotId: "stale-snapshot-id",
      rootPath: setup.rootPath,
      changeStart: 0,
      changeEnd: 0
    });

    expect(result).toEqual({ ok: true, skipped: true, touchedEntityIds: [] });
    expect(getProcessingState(setup.db, setup.documentId, "extraction")).toBeNull();
    expect(listEntities(setup.db, setup.projectId)).toHaveLength(0);
    expect(listEvents(setup.db, setup.projectId)).toHaveLength(0);
  });

  it("early-exits when snapshot is already processed successfully", async () => {
    const setup = setupStage("Already processed extraction snapshot.");
    upsertProcessingState(setup.db, {
      documentId: setup.documentId,
      snapshotId: setup.snapshotId,
      stage: "extraction",
      status: "ok"
    });
    const before = getProcessingState(setup.db, setup.documentId, "extraction");

    const result = await runExtractionStage({
      db: setup.db,
      projectId: setup.projectId,
      documentId: setup.documentId,
      snapshotId: setup.snapshotId,
      rootPath: setup.rootPath,
      changeStart: 0,
      changeEnd: 0
    });

    const after = getProcessingState(setup.db, setup.documentId, "extraction");
    expect(result).toEqual({ ok: true, skipped: true, touchedEntityIds: [] });
    expect(after).toEqual(before);
    expect(listEntities(setup.db, setup.projectId)).toHaveLength(0);
  });

  it("handles documents with no chunks as a graceful no-op", async () => {
    const setup = setupStage("No chunk extraction path.");

    const result = await runExtractionStage({
      db: setup.db,
      projectId: setup.projectId,
      documentId: setup.documentId,
      snapshotId: setup.snapshotId,
      rootPath: setup.rootPath,
      changeStart: 0,
      changeEnd: 0
    });

    expect(result).toEqual({ ok: true, touchedEntityIds: [] });
    expect(getProcessingState(setup.db, setup.documentId, "extraction")?.status).toBe("ok");
    expect(listEntities(setup.db, setup.projectId)).toHaveLength(0);
  });

  it("marks failed state, logs stage_failed, and rethrows when extraction errors", async () => {
    const setup = setupStage("Mira's eyes were green.");
    insertTestChunks(setup.db, setup.documentId, [
      { ordinal: 0, text: "Mira's eyes were green." }
    ]);
    setup.db.exec("DROP TABLE entity;");

    await expect(
      runExtractionStage({
        db: setup.db,
        projectId: setup.projectId,
        documentId: setup.documentId,
        snapshotId: setup.snapshotId,
        rootPath: setup.rootPath,
        changeStart: 0,
        changeEnd: 0
      })
    ).rejects.toThrow(/no such table: entity/i);

    const processingState = getProcessingState(setup.db, setup.documentId, "extraction");
    const stageFailedEvent = listEvents(setup.db, setup.projectId).find(
      (event) => event.event_type === "stage_failed"
    );
    const payload = JSON.parse(stageFailedEvent?.payload_json ?? "{}") as {
      stage?: string;
      documentId?: string;
      message?: string;
    };

    expect(processingState?.status).toBe("failed");
    expect(processingState?.error).toMatch(/no such table: entity/i);
    expect(stageFailedEvent).toBeTruthy();
    expect(payload.stage).toBe("extraction");
    expect(payload.documentId).toBe(setup.documentId);
  });

  it("processes available chunks when ordinal metadata has gaps", async () => {
    const setup = setupStage(
      "Mira's eyes were green. [missing chunk] Lina's eyes were blue."
    );
    insertTestChunks(setup.db, setup.documentId, [
      { ordinal: 0, text: "Mira's eyes were green." },
      { ordinal: 2, text: "Lina's eyes were blue." }
    ]);

    const result = await runExtractionStage({
      db: setup.db,
      projectId: setup.projectId,
      documentId: setup.documentId,
      snapshotId: setup.snapshotId,
      rootPath: setup.rootPath,
      changeStart: 1,
      changeEnd: 1
    });

    const entities = listEntities(setup.db, setup.projectId);
    const names = entities.map((entity) => entity.display_name).sort((a, b) => a.localeCompare(b));

    expect(result.ok).toBe(true);
    expect(names).toEqual(["Mira"]);
    expect(result.touchedEntityIds).toHaveLength(1);
  });
});
