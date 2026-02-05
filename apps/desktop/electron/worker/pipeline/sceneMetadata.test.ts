import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, createProject } from "../storage";
import { ingestDocument } from "./ingest";
import { runSceneStage } from "./stages/scenes";

function setupProject(text: string) {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "canonkeeper-"));
  const filePath = path.join(rootPath, "draft.md");
  fs.writeFileSync(filePath, text);

  const handle = openDatabase({ rootPath });
  const project = createProject(handle.db, rootPath, "Test");

  return { rootPath, filePath, db: handle.db, projectId: project.id };
}

describe("scene metadata", () => {
  it("captures first-person POV and setting evidence", async () => {
    const { rootPath, filePath, db, projectId } = setupProject(
      "I walked into the courtyard. In the courtyard, the air was cold."
    );

    const ingestResult = await ingestDocument(db, { projectId, rootPath, filePath });
    await runSceneStage({
      db,
      projectId,
      documentId: ingestResult.documentId,
      snapshotId: ingestResult.snapshotId,
      rootPath
    });

    const sceneMeta = db
      .prepare(
        "SELECT scene_id, pov_mode, setting_text FROM scene_metadata LIMIT 1"
      )
      .get() as { scene_id: string; pov_mode: string; setting_text: string | null } | undefined;

    expect(sceneMeta).toBeTruthy();
    expect(sceneMeta?.pov_mode).toBe("first");
    expect(sceneMeta?.setting_text ?? "").toContain("courtyard");

    const evidence = db
      .prepare("SELECT scene_id FROM scene_evidence WHERE scene_id = ?")
      .all(sceneMeta?.scene_id ?? "") as Array<{ scene_id: string }>;

    expect(evidence.length).toBeGreaterThan(0);
  });
});
