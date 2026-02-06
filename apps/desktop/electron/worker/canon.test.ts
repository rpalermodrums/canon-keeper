import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  openDatabase,
  createProject,
  createDocument,
  insertChunks,
  createEntity,
  insertClaim,
  insertClaimEvidence,
  listEvidenceForClaim,
  listClaimsByField,
  listIssuesWithEvidence
} from "./storage";
import { confirmClaim } from "./canon";
import { hashText } from "../../../../packages/shared/utils/hashing";
import { runContinuityChecks } from "./pipeline/continuity";

function setupDb() {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "canonkeeper-"));
  const dbHandle = openDatabase({ rootPath });
  const project = createProject(dbHandle.db, rootPath, "Test");
  return { rootPath, db: dbHandle.db, projectId: project.id };
}

describe("confirmClaim", () => {
  it("copies evidence from the source claim", () => {
    const { rootPath, db, projectId } = setupDb();
    const doc = createDocument(db, projectId, path.join(rootPath, "draft.md"), "md");
    const text = "Lina's eyes were green.";
    const chunk = insertChunks(db, doc.id, [
      {
        document_id: doc.id,
        ordinal: 0,
        text,
        text_hash: hashText(text),
        start_char: 0,
        end_char: text.length
      }
    ])[0]!;

    const entity = createEntity(db, { projectId, type: "character", displayName: "Lina" });
    const claim = insertClaim(db, {
      entityId: entity.id,
      field: "eye_color",
      valueJson: JSON.stringify("green"),
      status: "inferred",
      confidence: 0.8
    });

    insertClaimEvidence(db, {
      claimId: claim.id,
      chunkId: chunk.id,
      quoteStart: 0,
      quoteEnd: text.length
    });

    const confirmedId = confirmClaim(db, {
      entityId: entity.id,
      field: "eye_color",
      valueJson: JSON.stringify("green"),
      sourceClaimId: claim.id
    });

    const confirmedEvidence = listEvidenceForClaim(db, confirmedId);
    expect(confirmedEvidence.length).toBe(1);
    expect(confirmedEvidence[0]?.chunk_id).toBe(chunk.id);

    const claims = listClaimsByField(db, entity.id, "eye_color");
    const inferred = claims.find((row) => row.id === claim.id);
    expect(inferred?.status).toBe("superseded");
  });

  it("rejects confirmations when source claim has no evidence", () => {
    const { rootPath, db, projectId } = setupDb();
    const doc = createDocument(db, projectId, path.join(rootPath, "draft.md"), "md");
    const text = "Lina was there.";
    insertChunks(db, doc.id, [
      {
        document_id: doc.id,
        ordinal: 0,
        text,
        text_hash: hashText(text),
        start_char: 0,
        end_char: text.length
      }
    ]);

    const entity = createEntity(db, { projectId, type: "character", displayName: "Lina" });
    const claim = insertClaim(db, {
      entityId: entity.id,
      field: "status",
      valueJson: JSON.stringify("present"),
      status: "inferred",
      confidence: 0.8
    });

    expect(() =>
      confirmClaim(db, {
        entityId: entity.id,
        field: "status",
        valueJson: JSON.stringify("present"),
        sourceClaimId: claim.id
      })
    ).toThrow("Cannot confirm claim without evidence-backed source claim");
  });

  it("produces question-style continuity issue after confirmation conflicts", () => {
    const { rootPath, db, projectId } = setupDb();
    const doc = createDocument(db, projectId, path.join(rootPath, "draft.md"), "md");
    const textA = "Lina's eyes were green.";
    const textB = "Later, Lina's eyes were gray.";
    const chunkA = insertChunks(db, doc.id, [
      {
        document_id: doc.id,
        ordinal: 0,
        text: textA,
        text_hash: hashText(textA),
        start_char: 0,
        end_char: textA.length
      }
    ])[0]!;
    const chunkB = insertChunks(db, doc.id, [
      {
        document_id: doc.id,
        ordinal: 1,
        text: textB,
        text_hash: hashText(textB),
        start_char: textA.length + 1,
        end_char: textA.length + 1 + textB.length
      }
    ])[0]!;

    const entity = createEntity(db, { projectId, type: "character", displayName: "Lina" });
    const green = insertClaim(db, {
      entityId: entity.id,
      field: "eye_color",
      valueJson: JSON.stringify("green"),
      status: "inferred",
      confidence: 0.8
    });
    insertClaimEvidence(db, {
      claimId: green.id,
      chunkId: chunkA.id,
      quoteStart: 0,
      quoteEnd: textA.length
    });

    confirmClaim(db, {
      entityId: entity.id,
      field: "eye_color",
      valueJson: JSON.stringify("green"),
      sourceClaimId: green.id
    });

    // New conflicting inference after confirmation should surface as a question.
    const gray = insertClaim(db, {
      entityId: entity.id,
      field: "eye_color",
      valueJson: JSON.stringify("gray"),
      status: "inferred",
      confidence: 0.8
    });
    insertClaimEvidence(db, {
      claimId: gray.id,
      chunkId: chunkB.id,
      quoteStart: 0,
      quoteEnd: textB.length
    });

    runContinuityChecks(db, projectId, { entityIds: [entity.id] });
    const issues = listIssuesWithEvidence(db, projectId, { status: "all" }).filter(
      (issue) => issue.type === "continuity"
    );
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]?.title.startsWith("Did ")).toBe(true);
  });
});
