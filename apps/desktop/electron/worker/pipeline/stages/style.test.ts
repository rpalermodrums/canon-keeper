import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { hashText } from "../../../../../../packages/shared/utils/hashing";
import { runStyleStage } from "./style";
import {
  createDocument,
  createProject,
  getProcessingState,
  insertChunks,
  insertSnapshot,
  listEvents,
  listIssues,
  listStyleMetrics,
  openDatabase,
  replaceScenesForDocument,
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

function setupStage(fullText = 'Mira said, "Well, look." The wind stayed cold.'): StageSetup {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "canonkeeper-stage-style-"));
  const handle = openDatabase({ rootPath });
  const project = createProject(handle.db, rootPath, "Style Stage Test");
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

function insertDocumentChunks(
  db: Database.Database,
  documentId: string,
  chunks: Array<{ ordinal: number; text: string }>
): Array<{ id: string; text: string }> {
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
  return insertChunks(db, documentId, rows).map((chunk) => ({ id: chunk.id, text: chunk.text }));
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

describe("runStyleStage", () => {
  it("persists style metrics and marks processing state ok on happy path", () => {
    const setup = setupStage();
    const inserted = insertDocumentChunks(setup.db, setup.documentId, [
      { ordinal: 0, text: 'Mira said, "Well, look." Mira said, "Well, look." Mira said, "Well, look."' }
    ]);
    replaceScenesForDocument(setup.db, setup.documentId, [
      {
        project_id: setup.projectId,
        document_id: setup.documentId,
        ordinal: 0,
        start_chunk_id: inserted[0]!.id,
        end_chunk_id: inserted[0]!.id,
        start_char: 0,
        end_char: inserted[0]!.text.length,
        title: "Opening"
      }
    ]);

    const result = runStyleStage({
      db: setup.db,
      projectId: setup.projectId,
      documentId: setup.documentId,
      snapshotId: setup.snapshotId,
      rootPath: setup.rootPath
    });

    const metrics = listStyleMetrics(setup.db, { projectId: setup.projectId });
    expect(result).toEqual({ ok: true });
    expect(metrics.some((metric) => metric.scope_type === "project" && metric.metric_name === "ngram_freq")).toBe(
      true
    );
    expect(metrics.some((metric) => metric.scope_type === "document" && metric.metric_name === "dialogue_tics")).toBe(
      true
    );
    expect(getProcessingState(setup.db, setup.documentId, "style")?.status).toBe("ok");
  });

  it("early-exits on stale snapshot and performs no writes", () => {
    const setup = setupStage("Stale style snapshot.");

    const result = runStyleStage({
      db: setup.db,
      projectId: setup.projectId,
      documentId: setup.documentId,
      snapshotId: "stale-snapshot-id",
      rootPath: setup.rootPath
    });

    expect(result).toEqual({ ok: true, skipped: true });
    expect(getProcessingState(setup.db, setup.documentId, "style")).toBeNull();
    expect(listStyleMetrics(setup.db, { projectId: setup.projectId })).toHaveLength(0);
  });

  it("early-exits when the snapshot was already processed", () => {
    const setup = setupStage("Already processed style snapshot.");
    upsertProcessingState(setup.db, {
      documentId: setup.documentId,
      snapshotId: setup.snapshotId,
      stage: "style",
      status: "ok"
    });
    const before = getProcessingState(setup.db, setup.documentId, "style");

    const result = runStyleStage({
      db: setup.db,
      projectId: setup.projectId,
      documentId: setup.documentId,
      snapshotId: setup.snapshotId,
      rootPath: setup.rootPath
    });

    const after = getProcessingState(setup.db, setup.documentId, "style");
    expect(result).toEqual({ ok: true, skipped: true });
    expect(after).toEqual(before);
    expect(listEvents(setup.db, setup.projectId)).toHaveLength(0);
  });

  it("marks failed state, logs stage_failed, and rethrows when style analysis errors", () => {
    const setup = setupStage("Style failure path.");
    setup.db.exec("DROP TABLE style_metric;");

    expect(() =>
      runStyleStage({
        db: setup.db,
        projectId: setup.projectId,
        documentId: setup.documentId,
        snapshotId: setup.snapshotId,
        rootPath: setup.rootPath
      })
    ).toThrow(/no such table: style_metric/i);

    const processingState = getProcessingState(setup.db, setup.documentId, "style");
    const stageFailedEvent = listEvents(setup.db, setup.projectId).find(
      (event) => event.event_type === "stage_failed"
    );
    const payload = JSON.parse(stageFailedEvent?.payload_json ?? "{}") as {
      stage?: string;
      documentId?: string;
      message?: string;
    };

    expect(processingState?.status).toBe("failed");
    expect(processingState?.error).toMatch(/no such table: style_metric/i);
    expect(stageFailedEvent).toBeTruthy();
    expect(payload.stage).toBe("style");
    expect(payload.documentId).toBe(setup.documentId);
  });

  it("handles an empty document without crashing", () => {
    const setup = setupStage("");

    const result = runStyleStage({
      db: setup.db,
      projectId: setup.projectId,
      documentId: setup.documentId,
      snapshotId: setup.snapshotId,
      rootPath: setup.rootPath
    });

    const metrics = listStyleMetrics(setup.db, { projectId: setup.projectId });
    const issues = listIssues(setup.db, setup.projectId, { status: "all" });
    expect(result).toEqual({ ok: true });
    expect(getProcessingState(setup.db, setup.documentId, "style")?.status).toBe("ok");
    expect(metrics.some((metric) => metric.scope_type === "project" && metric.metric_name === "ngram_freq")).toBe(
      true
    );
    expect(issues).toHaveLength(0);
  });
});
