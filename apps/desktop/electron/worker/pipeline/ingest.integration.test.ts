import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, createProject, listChunksForDocument, listScenesForProject, listIssuesWithEvidence } from "../storage";
import { ingestDocument } from "./ingest";
import { searchChunks } from "../search/fts";
import { runSceneStage } from "./stages/scenes";
import { runExtractionStage } from "./stages/extraction";
import { runContinuityStage } from "./stages/continuity";

const fixturesDir = path.resolve(process.cwd(), "data", "fixtures");

function setupProject(fixtureName: string) {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "canonkeeper-"));
  const fixturePath = path.join(fixturesDir, fixtureName);
  const docPath = path.join(rootPath, fixtureName);
  fs.copyFileSync(fixturePath, docPath);

  const handle = openDatabase({ rootPath });
  const project = createProject(handle.db, rootPath, "Test Project");

  return { rootPath, docPath, db: handle.db, projectId: project.id };
}

describe("ingestDocument integration", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    tempRoots.length = 0;
  });

  it("ingests a markdown fixture, creates chunks, scenes, and FTS results", async () => {
    const setup = setupProject("simple_md.md");
    tempRoots.push(setup.rootPath);

    const ingestResult = await ingestDocument(setup.db, {
      projectId: setup.projectId,
      rootPath: setup.rootPath,
      filePath: setup.docPath
    });

    await runSceneStage({
      db: setup.db,
      projectId: setup.projectId,
      documentId: ingestResult.documentId,
      snapshotId: ingestResult.snapshotId,
      rootPath: setup.rootPath
    });

    const documents = setup.db
      .prepare("SELECT id FROM document WHERE project_id = ?")
      .all(setup.projectId) as Array<{ id: string }>;

    expect(documents.length).toBe(1);

    const [document] = documents;
    expect(document).toBeTruthy();

    const chunks = listChunksForDocument(setup.db, document!.id);
    expect(chunks.length).toBeGreaterThan(0);

    const scenes = listScenesForProject(setup.db, setup.projectId);
    expect(scenes.length).toBeGreaterThan(0);

    const searchResults = searchChunks(setup.db, "compass");
    expect(searchResults.length).toBeGreaterThan(0);
  });

  it("creates continuity issues for conflicting evidence", async () => {
    const setup = setupProject("contradiction.md");
    tempRoots.push(setup.rootPath);

    const ingestResult = await ingestDocument(setup.db, {
      projectId: setup.projectId,
      rootPath: setup.rootPath,
      filePath: setup.docPath
    });

    const extractionResult = await runExtractionStage({
      db: setup.db,
      projectId: setup.projectId,
      documentId: ingestResult.documentId,
      snapshotId: ingestResult.snapshotId,
      rootPath: setup.rootPath,
      changeStart: ingestResult.changeStart,
      changeEnd: ingestResult.changeEnd
    });

    runContinuityStage({
      db: setup.db,
      projectId: setup.projectId,
      documentId: ingestResult.documentId,
      snapshotId: ingestResult.snapshotId,
      rootPath: setup.rootPath,
      entityIds: extractionResult.touchedEntityIds
    });

    const issues = listIssuesWithEvidence(setup.db, setup.projectId);
    const continuity = issues.filter((issue) => issue.type === "continuity");

    expect(continuity.length).toBeGreaterThan(0);
    expect(continuity[0]!.evidence.length).toBeGreaterThan(0);
  });
});
