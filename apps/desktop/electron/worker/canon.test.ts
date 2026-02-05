import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, createProject, createDocument, insertChunks, createEntity, insertClaim, insertClaimEvidence, listEvidenceForClaim, listClaimsByField } from "./storage";
import { confirmClaim } from "./canon";
import { hashText } from "../../../../packages/shared/utils/hashing";

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
});
