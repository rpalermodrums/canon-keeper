import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { openDatabase, createEntity, createProject } from "../storage";
import { ingestDocument } from "./ingest";
import { runSceneStage } from "./stages/scenes";

function setupProject(text: string, fileName = "draft.md") {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "canonkeeper-"));
  const filePath = path.join(rootPath, fileName);
  fs.writeFileSync(filePath, text);

  const handle = openDatabase({ rootPath });
  const project = createProject(handle.db, rootPath, "Test");

  return { rootPath, filePath, db: handle.db, projectId: project.id };
}

async function ingestAndRun(
  args: Readonly<{ rootPath: string; filePath: string; db: Database.Database; projectId: string }>
) {
  const ingestResult = await ingestDocument(args.db, {
    projectId: args.projectId,
    rootPath: args.rootPath,
    filePath: args.filePath
  });
  await runSceneStage({
    db: args.db,
    projectId: args.projectId,
    documentId: ingestResult.documentId,
    snapshotId: ingestResult.snapshotId,
    rootPath: args.rootPath
  });
  return ingestResult;
}

function configureCloudProvider(rootPath: string): void {
  const configPath = path.join(rootPath, "canonkeeper.json");
  fs.writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        projectName: "Scene Metadata Test",
        documents: [],
        llm: {
          provider: "cloud",
          model: "gpt-5.2",
          enabled: true,
          baseUrl: "https://llm.example.test/v1/responses"
        }
      },
      null,
      2
    )}\n`
  );
  process.env.CANONKEEPER_LLM_API_KEY = "test-key";
  delete process.env.CANONKEEPER_LLM_BASE_URL;
  delete process.env.CANONKEEPER_LLM_MODEL;
}

function stubSceneMetadataResponse() {
  const fetchMock = vi.fn(async () =>
    new Response(
      JSON.stringify({
        output_parsed: {
          schemaVersion: "1.0",
          povMode: "first",
          povName: null,
          povConfidence: 0.94,
          settingName: "Courtyard",
          settingText: null,
          settingConfidence: 0.9,
          timeContextText: "the next morning",
          evidence: [{ chunkOrdinal: 0, quote: "in the courtyard" }]
        }
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    )
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("scene metadata", () => {
  const tempRoots: string[] = [];
  const openDbs: Database.Database[] = [];
  const originalApiKey = process.env.CANONKEEPER_LLM_API_KEY;
  const originalBaseUrl = process.env.CANONKEEPER_LLM_BASE_URL;
  const originalModel = process.env.CANONKEEPER_LLM_MODEL;

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (originalApiKey === undefined) {
      delete process.env.CANONKEEPER_LLM_API_KEY;
    } else {
      process.env.CANONKEEPER_LLM_API_KEY = originalApiKey;
    }
    if (originalBaseUrl === undefined) {
      delete process.env.CANONKEEPER_LLM_BASE_URL;
    } else {
      process.env.CANONKEEPER_LLM_BASE_URL = originalBaseUrl;
    }
    if (originalModel === undefined) {
      delete process.env.CANONKEEPER_LLM_MODEL;
    } else {
      process.env.CANONKEEPER_LLM_MODEL = originalModel;
    }
    for (const db of openDbs) {
      db.close();
    }
    openDbs.length = 0;
    for (const root of tempRoots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    tempRoots.length = 0;
  });

  it("captures first-person POV and setting evidence", async () => {
    const setup = setupProject("I walked into the courtyard. In the courtyard, the air was cold.");
    tempRoots.push(setup.rootPath);
    openDbs.push(setup.db);

    const ingestResult = await ingestAndRun(setup);

    const sceneMeta = setup.db
      .prepare(
        `SELECT m.scene_id, m.pov_mode, m.setting_text
         FROM scene_metadata m
         JOIN scene s ON s.id = m.scene_id
         WHERE s.document_id = ?
         LIMIT 1`
      )
      .get(ingestResult.documentId) as
      | { scene_id: string; pov_mode: string; setting_text: string | null }
      | undefined;

    expect(sceneMeta).toBeTruthy();
    expect(sceneMeta?.pov_mode).toBe("first");
    expect(sceneMeta?.setting_text ?? "").toContain("courtyard");

    const evidence = setup.db
      .prepare("SELECT scene_id FROM scene_evidence WHERE scene_id = ?")
      .all(sceneMeta?.scene_id ?? "") as Array<{ scene_id: string }>;

    expect(evidence.length).toBeGreaterThan(0);
  });

  it("handles empty text without creating scene metadata", async () => {
    const setup = setupProject("", "empty.md");
    tempRoots.push(setup.rootPath);
    openDbs.push(setup.db);

    const ingestResult = await ingestAndRun(setup);

    const sceneCount = setup.db
      .prepare("SELECT COUNT(*) as count FROM scene WHERE document_id = ?")
      .get(ingestResult.documentId) as { count: number };
    const sceneMetaCount = setup.db
      .prepare(
        `SELECT COUNT(*) as count
         FROM scene_metadata m
         JOIN scene s ON s.id = m.scene_id
         WHERE s.document_id = ?`
      )
      .get(ingestResult.documentId) as { count: number };

    expect(sceneCount.count).toBe(0);
    expect(sceneMetaCount.count).toBe(0);
  });

  it("extracts metadata from a single-paragraph scene", async () => {
    const setup = setupProject("I waited in the courtyard until dawn.", "single-paragraph.md");
    tempRoots.push(setup.rootPath);
    openDbs.push(setup.db);

    const ingestResult = await ingestAndRun(setup);

    const sceneMeta = setup.db
      .prepare(
        `SELECT m.scene_id, m.pov_mode, m.setting_text
         FROM scene_metadata m
         JOIN scene s ON s.id = m.scene_id
         WHERE s.document_id = ?`
      )
      .get(ingestResult.documentId) as
      | { scene_id: string; pov_mode: string; setting_text: string | null }
      | undefined;
    const evidence = setup.db
      .prepare(
        `SELECT e.quote_start, e.quote_end, c.text
         FROM scene_evidence e
         JOIN chunk c ON c.id = e.chunk_id
         WHERE e.scene_id = ?
         LIMIT 1`
      )
      .get(sceneMeta?.scene_id ?? "") as
      | { quote_start: number; quote_end: number; text: string }
      | undefined;

    expect(sceneMeta?.pov_mode).toBe("first");
    expect(sceneMeta?.setting_text?.toLowerCase()).toContain("courtyard");
    expect(evidence).toBeTruthy();
    expect(evidence?.text.slice(evidence.quote_start, evidence.quote_end).toLowerCase()).toContain(
      "courtyard"
    );
  });

  it("processes very long text and still assigns stable metadata", async () => {
    const longText = Array.from({ length: 350 }, () => "I crossed in the courtyard and listened.")
      .join(" ")
      .trim();
    const setup = setupProject(longText, "long.md");
    tempRoots.push(setup.rootPath);
    openDbs.push(setup.db);

    const ingestResult = await ingestAndRun(setup);

    const chunkCount = setup.db
      .prepare("SELECT COUNT(*) as count FROM chunk WHERE document_id = ?")
      .get(ingestResult.documentId) as { count: number };
    const sceneMeta = setup.db
      .prepare(
        `SELECT m.pov_mode, m.setting_text
         FROM scene_metadata m
         JOIN scene s ON s.id = m.scene_id
         WHERE s.document_id = ?
         LIMIT 1`
      )
      .get(ingestResult.documentId) as { pov_mode: string; setting_text: string | null } | undefined;

    expect(chunkCount.count).toBeGreaterThan(1);
    expect(sceneMeta?.pov_mode).toBe("first");
    expect(sceneMeta?.setting_text?.toLowerCase()).toContain("courtyard");
  });

  it("does not classify third-person narration as first-person POV", async () => {
    const setup = setupProject("She walked in the courtyard and watched the gate.", "third-person.md");
    tempRoots.push(setup.rootPath);
    openDbs.push(setup.db);

    const ingestResult = await ingestAndRun(setup);

    const sceneMeta = setup.db
      .prepare(
        `SELECT m.pov_mode, m.setting_text
         FROM scene_metadata m
         JOIN scene s ON s.id = m.scene_id
         WHERE s.document_id = ?`
      )
      .get(ingestResult.documentId) as { pov_mode: string; setting_text: string | null } | undefined;

    expect(sceneMeta?.pov_mode).toBe("unknown");
    expect(sceneMeta?.setting_text?.toLowerCase()).toContain("courtyard");
  });

  it("applies LLM location and time metadata when evidence maps exactly", async () => {
    const setup = setupProject("I stood in the courtyard while rain fell.", "llm-scene.md");
    tempRoots.push(setup.rootPath);
    openDbs.push(setup.db);

    const location = createEntity(setup.db, {
      projectId: setup.projectId,
      type: "location",
      displayName: "Courtyard"
    });

    configureCloudProvider(setup.rootPath);
    stubSceneMetadataResponse();

    const ingestResult = await ingestAndRun(setup);

    const sceneMeta = setup.db
      .prepare(
        `SELECT m.scene_id, m.pov_mode, m.setting_entity_id, m.setting_text, m.time_context_text
         FROM scene_metadata m
         JOIN scene s ON s.id = m.scene_id
         WHERE s.document_id = ?
         LIMIT 1`
      )
      .get(ingestResult.documentId) as
      | {
          scene_id: string;
          pov_mode: string;
          setting_entity_id: string | null;
          setting_text: string | null;
          time_context_text: string | null;
        }
      | undefined;
    const evidence = setup.db
      .prepare(
        `SELECT e.quote_start, e.quote_end, c.text
         FROM scene_evidence e
         JOIN chunk c ON c.id = e.chunk_id
         WHERE e.scene_id = ?
         LIMIT 1`
      )
      .get(sceneMeta?.scene_id ?? "") as
      | { quote_start: number; quote_end: number; text: string }
      | undefined;

    expect(sceneMeta).toBeTruthy();
    expect(sceneMeta?.pov_mode).toBe("first");
    expect(sceneMeta?.setting_entity_id).toBe(location.id);
    expect(sceneMeta?.setting_text).toBe("Courtyard");
    expect(sceneMeta?.time_context_text).toBe("the next morning");
    expect(evidence).toBeTruthy();
    expect(evidence?.text.slice(evidence.quote_start, evidence.quote_end)).toBe("in the courtyard");
  });
});
