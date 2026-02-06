import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createDocument,
  createProject,
  insertChunks,
  openDatabase,
  replaceScenesForDocument
} from "../../storage";
import { runStyleMetrics } from "./styleRunner";
import { hashText } from "../../../../../../packages/shared/utils/hashing";

function setupDb() {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "canonkeeper-"));
  const handle = openDatabase({ rootPath });
  const project = createProject(handle.db, rootPath, "Test Project");
  return { rootPath, db: handle.db, projectId: project.id };
}

describe("style config integration", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    tempRoots.length = 0;
  });

  it("applies repetition thresholds from canonkeeper.json", () => {
    const setup = setupDb();
    tempRoots.push(setup.rootPath);

    const doc = createDocument(setup.db, setup.projectId, path.join(setup.rootPath, "draft.md"), "md");
    const text = "cold cold cold cold cold";
    const chunk = insertChunks(setup.db, doc.id, [
      {
        document_id: doc.id,
        ordinal: 0,
        text,
        text_hash: hashText(text),
        start_char: 0,
        end_char: text.length
      }
    ])[0]!;
    replaceScenesForDocument(setup.db, doc.id, [
      {
        project_id: setup.projectId,
        document_id: doc.id,
        ordinal: 0,
        start_chunk_id: chunk.id,
        end_chunk_id: chunk.id,
        start_char: 0,
        end_char: text.length,
        title: null
      }
    ]);

    fs.writeFileSync(
      path.join(setup.rootPath, "canonkeeper.json"),
      JSON.stringify(
        {
          style: {
            repetitionThreshold: {
              projectCount: 10,
              sceneCount: 10
            }
          }
        },
        null,
        2
      )
    );
    runStyleMetrics(setup.db, setup.projectId, { rootPath: setup.rootPath, documentId: doc.id });
    let rows = setup.db
      .prepare("SELECT COUNT(*) as count FROM issue WHERE project_id = ? AND type = 'repetition'")
      .get(setup.projectId) as { count: number };
    expect(rows.count).toBe(0);

    fs.writeFileSync(
      path.join(setup.rootPath, "canonkeeper.json"),
      JSON.stringify(
        {
          style: {
            repetitionThreshold: {
              projectCount: 3,
              sceneCount: 3
            }
          }
        },
        null,
        2
      )
    );
    runStyleMetrics(setup.db, setup.projectId, { rootPath: setup.rootPath, documentId: doc.id });
    rows = setup.db
      .prepare("SELECT COUNT(*) as count FROM issue WHERE project_id = ? AND type = 'repetition'")
      .get(setup.projectId) as { count: number };
    expect(rows.count).toBeGreaterThan(0);
  });
});
