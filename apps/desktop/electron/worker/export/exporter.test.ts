import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, createProject, createDocument, insertChunks, createEntity, insertClaim, insertClaimEvidence } from "../storage";
import { exportProject } from "./exporter";
import { hashText } from "../../../../../packages/shared/utils/hashing";

function setupDb() {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "canonkeeper-"));
  const dbHandle = openDatabase({ rootPath });
  const project = createProject(dbHandle.db, rootPath, "Test");
  return { rootPath, db: dbHandle.db, projectId: project.id };
}

describe("exportProject", () => {
  it("writes markdown and json with citations", () => {
    const { rootPath, db, projectId } = setupDb();
    const doc = createDocument(db, projectId, path.join(rootPath, "draft.md"), "md");
    const text = "Mira stepped into the workshop.";
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

    const entity = createEntity(db, { projectId, type: "character", displayName: "Mira" });
    const claim = insertClaim(db, {
      entityId: entity.id,
      field: "first_appearance",
      valueJson: JSON.stringify("workshop"),
      status: "inferred",
      confidence: 0.7
    });
    insertClaimEvidence(db, {
      claimId: claim.id,
      chunkId: chunk.id,
      quoteStart: 0,
      quoteEnd: text.length
    });

    const outDir = path.join(rootPath, "out");
    exportProject(db, projectId, outDir, "all");

    const biblePath = path.join(outDir, "bible.md");
    const scenesPath = path.join(outDir, "scenes.md");
    const stylePath = path.join(outDir, "style_report.md");
    const jsonPath = path.join(outDir, "project.json");

    expect(fs.existsSync(biblePath)).toBe(true);
    expect(fs.existsSync(scenesPath)).toBe(true);
    expect(fs.existsSync(stylePath)).toBe(true);
    expect(fs.existsSync(jsonPath)).toBe(true);

    const bible = fs.readFileSync(biblePath, "utf8");
    expect(bible).toContain("[^c1]");

    const projectDump = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as Record<string, unknown>;
    expect(projectDump).toHaveProperty("sceneEvidence");
  });
});
