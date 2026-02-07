import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { hashText } from "../../../../../../packages/shared/utils/hashing";
import { runContinuityStage } from "./continuity";
import {
  createDocument,
  createEntity,
  createProject,
  getProcessingState,
  insertClaim,
  insertClaimEvidence,
  insertChunks,
  insertSnapshot,
  listEvents,
  listIssuesWithEvidence,
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

function setupStage(fullText = "Rhea looked over the harbor."): StageSetup {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "canonkeeper-stage-continuity-"));
  const handle = openDatabase({ rootPath });
  const project = createProject(handle.db, rootPath, "Continuity Stage Test");
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

function insertChunk(
  db: Database.Database,
  documentId: string,
  args: { ordinal: number; text: string; startChar: number }
): { id: string; text: string } {
  const inserted = insertChunks(db, documentId, [
    {
      document_id: documentId,
      ordinal: args.ordinal,
      text: args.text,
      text_hash: hashText(args.text),
      start_char: args.startChar,
      end_char: args.startChar + args.text.length
    }
  ])[0];

  if (!inserted) {
    throw new Error("Failed to create test chunk");
  }
  return { id: inserted.id, text: inserted.text };
}

function insertEvidenceBackedClaim(args: {
  db: Database.Database;
  entityId: string;
  field: string;
  valueJson: string;
  status: "inferred" | "confirmed";
  chunkId: string;
  chunkText: string;
  quote: string;
}): void {
  const claim = insertClaim(args.db, {
    entityId: args.entityId,
    field: args.field,
    valueJson: args.valueJson,
    status: args.status,
    confidence: 0.9
  });
  const quoteStart = args.chunkText.indexOf(args.quote);
  if (quoteStart < 0) {
    throw new Error(`Quote "${args.quote}" not found in chunk text`);
  }
  insertClaimEvidence(args.db, {
    claimId: claim.id,
    chunkId: args.chunkId,
    quoteStart,
    quoteEnd: quoteStart + args.quote.length
  });
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

describe("runContinuityStage", () => {
  it("persists continuity issues and marks processing state ok on happy path", () => {
    const setup = setupStage(
      "Rhea's eyes were blue in the morning. By dusk, records said her eyes were green."
    );
    const firstChunk = insertChunk(setup.db, setup.documentId, {
      ordinal: 0,
      text: "Rhea's eyes were blue in the morning.",
      startChar: 0
    });
    const secondChunk = insertChunk(setup.db, setup.documentId, {
      ordinal: 1,
      text: "By dusk, records said her eyes were green.",
      startChar: firstChunk.text.length + 1
    });
    const entity = createEntity(setup.db, {
      projectId: setup.projectId,
      type: "character",
      displayName: "Rhea"
    });

    insertEvidenceBackedClaim({
      db: setup.db,
      entityId: entity.id,
      field: "eye_color",
      valueJson: JSON.stringify("blue"),
      status: "inferred",
      chunkId: firstChunk.id,
      chunkText: firstChunk.text,
      quote: "blue"
    });
    insertEvidenceBackedClaim({
      db: setup.db,
      entityId: entity.id,
      field: "eye_color",
      valueJson: JSON.stringify("green"),
      status: "confirmed",
      chunkId: secondChunk.id,
      chunkText: secondChunk.text,
      quote: "green"
    });

    const result = runContinuityStage({
      db: setup.db,
      projectId: setup.projectId,
      documentId: setup.documentId,
      snapshotId: setup.snapshotId,
      rootPath: setup.rootPath,
      entityIds: [entity.id]
    });

    const processingState = getProcessingState(setup.db, setup.documentId, "continuity");
    const continuityIssues = listIssuesWithEvidence(setup.db, setup.projectId, {
      type: "continuity"
    });

    expect(result).toEqual({ ok: true });
    expect(processingState?.status).toBe("ok");
    expect(processingState?.snapshot_id).toBe(setup.snapshotId);
    expect(continuityIssues).toHaveLength(1);
    expect(continuityIssues[0]?.evidence).toHaveLength(2);
  });

  it("skips when snapshot is stale and does not write processing state", () => {
    const setup = setupStage("Stale snapshot test.");

    const result = runContinuityStage({
      db: setup.db,
      projectId: setup.projectId,
      documentId: setup.documentId,
      snapshotId: "stale-snapshot-id",
      rootPath: setup.rootPath,
      entityIds: []
    });

    expect(result).toEqual({ ok: true, skipped: true });
    expect(getProcessingState(setup.db, setup.documentId, "continuity")).toBeNull();
    expect(listEvents(setup.db, setup.projectId)).toHaveLength(0);
  });

  it("skips when the same snapshot was already processed successfully", () => {
    const setup = setupStage("Already processed test.");
    upsertProcessingState(setup.db, {
      documentId: setup.documentId,
      snapshotId: setup.snapshotId,
      stage: "continuity",
      status: "ok"
    });
    const before = getProcessingState(setup.db, setup.documentId, "continuity");

    const result = runContinuityStage({
      db: setup.db,
      projectId: setup.projectId,
      documentId: setup.documentId,
      snapshotId: setup.snapshotId,
      rootPath: setup.rootPath,
      entityIds: []
    });

    const after = getProcessingState(setup.db, setup.documentId, "continuity");
    expect(result).toEqual({ ok: true, skipped: true });
    expect(after).toEqual(before);
    expect(listEvents(setup.db, setup.projectId)).toHaveLength(0);
  });

  it("handles empty project evidence as a successful no-op", () => {
    const setup = setupStage("");

    const result = runContinuityStage({
      db: setup.db,
      projectId: setup.projectId,
      documentId: setup.documentId,
      snapshotId: setup.snapshotId,
      rootPath: setup.rootPath,
      entityIds: []
    });

    expect(result).toEqual({ ok: true });
    expect(getProcessingState(setup.db, setup.documentId, "continuity")?.status).toBe("ok");
    expect(listIssuesWithEvidence(setup.db, setup.projectId, { type: "continuity" })).toHaveLength(0);
  });

  it("marks processing state failed, logs stage_failed, and rethrows when handler errors", () => {
    const setup = setupStage("Failure test.");
    setup.db.exec("DROP TABLE issue;");

    expect(() =>
      runContinuityStage({
        db: setup.db,
        projectId: setup.projectId,
        documentId: setup.documentId,
        snapshotId: setup.snapshotId,
        rootPath: setup.rootPath,
        entityIds: []
      })
    ).toThrow(/no such table: issue/i);

    const processingState = getProcessingState(setup.db, setup.documentId, "continuity");
    const stageFailedEvent = listEvents(setup.db, setup.projectId).find(
      (event) => event.event_type === "stage_failed"
    );
    const payload = JSON.parse(stageFailedEvent?.payload_json ?? "{}") as {
      stage?: string;
      documentId?: string;
      message?: string;
    };

    expect(processingState?.status).toBe("failed");
    expect(processingState?.error).toMatch(/no such table: issue/i);
    expect(stageFailedEvent).toBeTruthy();
    expect(payload.stage).toBe("continuity");
    expect(payload.documentId).toBe(setup.documentId);
  });

  it("is idempotent across repeated runs for the same snapshot", () => {
    const setup = setupStage(
      "Ari's rank was captain. A later note said Ari's rank was admiral."
    );
    const firstChunk = insertChunk(setup.db, setup.documentId, {
      ordinal: 0,
      text: "Ari's rank was captain.",
      startChar: 0
    });
    const secondChunk = insertChunk(setup.db, setup.documentId, {
      ordinal: 1,
      text: "A later note said Ari's rank was admiral.",
      startChar: firstChunk.text.length + 1
    });
    const entity = createEntity(setup.db, {
      projectId: setup.projectId,
      type: "character",
      displayName: "Ari"
    });

    insertEvidenceBackedClaim({
      db: setup.db,
      entityId: entity.id,
      field: "rank",
      valueJson: JSON.stringify("captain"),
      status: "inferred",
      chunkId: firstChunk.id,
      chunkText: firstChunk.text,
      quote: "captain"
    });
    insertEvidenceBackedClaim({
      db: setup.db,
      entityId: entity.id,
      field: "rank",
      valueJson: JSON.stringify("admiral"),
      status: "inferred",
      chunkId: secondChunk.id,
      chunkText: secondChunk.text,
      quote: "admiral"
    });

    const firstRun = runContinuityStage({
      db: setup.db,
      projectId: setup.projectId,
      documentId: setup.documentId,
      snapshotId: setup.snapshotId,
      rootPath: setup.rootPath,
      entityIds: [entity.id]
    });
    const firstIssueCount = listIssuesWithEvidence(setup.db, setup.projectId, {
      type: "continuity"
    }).length;

    const secondRun = runContinuityStage({
      db: setup.db,
      projectId: setup.projectId,
      documentId: setup.documentId,
      snapshotId: setup.snapshotId,
      rootPath: setup.rootPath,
      entityIds: [entity.id]
    });
    const secondIssueCount = listIssuesWithEvidence(setup.db, setup.projectId, {
      type: "continuity"
    }).length;

    expect(firstRun).toEqual({ ok: true });
    expect(secondRun).toEqual({ ok: true, skipped: true });
    expect(firstIssueCount).toBe(secondIssueCount);
    expect(getProcessingState(setup.db, setup.documentId, "continuity")?.status).toBe("ok");
  });
});
