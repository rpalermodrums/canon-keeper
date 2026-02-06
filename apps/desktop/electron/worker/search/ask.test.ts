import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, createProject, createDocument, insertChunks } from "../storage";
import { askQuestion } from "./ask";
import { hashText } from "../../../../../packages/shared/utils/hashing";

function setupDb() {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "canonkeeper-"));
  const dbHandle = openDatabase({ rootPath });
  const project = createProject(dbHandle.db, rootPath, "Test");
  return { rootPath, db: dbHandle.db, projectId: project.id };
}

describe("askQuestion", () => {
  it("returns snippets when LLM is unavailable", async () => {
    const { rootPath, db, projectId } = setupDb();
    const doc = createDocument(db, projectId, path.join(rootPath, "draft.md"), "md");
    const text = "Mira lifted the brass compass.";
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

    const result = await askQuestion(db, {
      projectId,
      rootPath,
      question: "compass"
    });

    expect(result.kind).toBe("snippets");
    if (result.kind !== "snippets") {
      throw new Error("Expected snippets result");
    }
    expect(result.snippets.length).toBeGreaterThan(0);
  });

  it("returns not_found when no snippets match", async () => {
    const { rootPath, db, projectId } = setupDb();
    const doc = createDocument(db, projectId, path.join(rootPath, "draft.md"), "md");
    const text = "Mira lifted the brass compass.";
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

    const result = await askQuestion(db, {
      projectId,
      rootPath,
      question: "submarine"
    });

    expect(result.kind).toBe("not_found");
    if (result.kind !== "not_found") {
      throw new Error("Expected not_found result");
    }
    expect(result.reason).toContain("not found");
  });
});
