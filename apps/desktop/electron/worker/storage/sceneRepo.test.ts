import { afterEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createDocument,
  createEntity,
  createProject,
  getSceneById,
  getSceneIdsForChunkIds,
  insertChunks,
  insertSceneEvidence,
  listSceneEvidence,
  listScenesForProject,
  openDatabase,
  replaceSceneEntities,
  replaceScenesForDocument,
  updateSceneMetadata
} from "./index";

type Setup = {
  rootPath: string;
  db: Database.Database;
  projectId: string;
};

type DocumentWithChunks = {
  documentId: string;
  chunkIds: string[];
};

const openDbs: Database.Database[] = [];
const tempRoots: string[] = [];

function setupDb(): Setup {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "canonkeeper-scenes-"));
  const handle = openDatabase({ rootPath });
  const project = createProject(handle.db, rootPath, "Scene Repo Tests");
  openDbs.push(handle.db);
  tempRoots.push(rootPath);
  return { rootPath, db: handle.db, projectId: project.id };
}

function createDocumentWithChunks(
  setup: Setup,
  fileName: string,
  texts: string[]
): DocumentWithChunks {
  const document = createDocument(setup.db, setup.projectId, path.join(setup.rootPath, fileName), "md");
  const payload = texts.map((text, index) => ({
    document_id: document.id,
    ordinal: index,
    text,
    text_hash: `${fileName}-${index}`,
    start_char: index * 100,
    end_char: index * 100 + text.length
  }));
  const chunks = insertChunks(setup.db, document.id, payload);
  return { documentId: document.id, chunkIds: chunks.map((chunk) => chunk.id) };
}

function countRowsBySceneId(
  db: Database.Database,
  table: "scene_metadata" | "scene_entity" | "scene_evidence",
  sceneId: string
): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE scene_id = ?`).get(sceneId) as {
    count: number;
  };
  return row.count;
}

function countScenesForDocument(db: Database.Database, documentId: string): number {
  const row = db.prepare("SELECT COUNT(*) AS count FROM scene WHERE document_id = ?").get(documentId) as {
    count: number;
  };
  return row.count;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const db of openDbs) {
    db.close();
  }
  openDbs.length = 0;
  for (const root of tempRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  tempRoots.length = 0;
});

describe("sceneRepo integration", () => {
  it("creates scenes with default metadata and stores explicit metadata fields", () => {
    const setup = setupDb();
    const document = createDocumentWithChunks(setup, "chapter-01.md", [
      "First chunk text",
      "Second chunk text",
      "Third chunk text"
    ]);

    const scenes = replaceScenesForDocument(setup.db, document.documentId, [
      {
        project_id: setup.projectId,
        document_id: document.documentId,
        ordinal: 0,
        start_chunk_id: document.chunkIds[0]!,
        end_chunk_id: document.chunkIds[1]!,
        start_char: 0,
        end_char: 199,
        title: "Opening"
      },
      {
        project_id: setup.projectId,
        document_id: document.documentId,
        ordinal: 1,
        start_chunk_id: document.chunkIds[2]!,
        end_chunk_id: document.chunkIds[2]!,
        start_char: 200,
        end_char: 299,
        title: "Closing"
      }
    ]);

    expect(scenes).toHaveLength(2);
    expect(scenes[0]).toMatchObject({
      project_id: setup.projectId,
      document_id: document.documentId,
      ordinal: 0,
      title: "Opening",
      pov_mode: "unknown",
      pov_entity_id: null,
      pov_confidence: 0,
      setting_entity_id: null,
      setting_text: null
    });

    const povEntity = createEntity(setup.db, {
      projectId: setup.projectId,
      type: "character",
      displayName: "Mira"
    });
    const settingEntity = createEntity(setup.db, {
      projectId: setup.projectId,
      type: "location",
      displayName: "Iron Keep"
    });

    updateSceneMetadata(setup.db, scenes[0]!.id, {
      pov_mode: "first",
      pov_entity_id: povEntity.id,
      pov_confidence: 0.77,
      setting_entity_id: settingEntity.id,
      setting_text: "Iron Keep",
      setting_confidence: 0.68,
      time_context_text: "Before dawn"
    });

    const updated = getSceneById(setup.db, scenes[0]!.id);
    expect(updated).not.toBeNull();
    expect(updated).toMatchObject({
      id: scenes[0]!.id,
      pov_mode: "first",
      pov_entity_id: povEntity.id,
      pov_confidence: 0.77,
      setting_entity_id: settingEntity.id,
      setting_text: "Iron Keep"
    });

    const metadataRow = setup.db
      .prepare(
        "SELECT setting_confidence, time_context_text FROM scene_metadata WHERE scene_id = ?"
      )
      .get(scenes[0]!.id) as { setting_confidence: number; time_context_text: string | null };
    expect(metadataRow.setting_confidence).toBe(0.68);
    expect(metadataRow.time_context_text).toBe("Before dawn");
  });

  it("lists scenes ordered by document and ordinal and supports document-scoped filtering", () => {
    const setup = setupDb();
    const documentA = createDocumentWithChunks(setup, "a.md", ["A0", "A1", "A2"]);
    const documentB = createDocumentWithChunks(setup, "b.md", ["B0", "B1", "B2"]);

    replaceScenesForDocument(setup.db, documentA.documentId, [
      {
        project_id: setup.projectId,
        document_id: documentA.documentId,
        ordinal: 2,
        start_chunk_id: documentA.chunkIds[1]!,
        end_chunk_id: documentA.chunkIds[2]!,
        start_char: 100,
        end_char: 202,
        title: "A late"
      },
      {
        project_id: setup.projectId,
        document_id: documentA.documentId,
        ordinal: 0,
        start_chunk_id: documentA.chunkIds[0]!,
        end_chunk_id: documentA.chunkIds[0]!,
        start_char: 0,
        end_char: 2,
        title: "A early"
      }
    ]);
    replaceScenesForDocument(setup.db, documentB.documentId, [
      {
        project_id: setup.projectId,
        document_id: documentB.documentId,
        ordinal: 1,
        start_chunk_id: documentB.chunkIds[1]!,
        end_chunk_id: documentB.chunkIds[2]!,
        start_char: 100,
        end_char: 202,
        title: "B mid"
      },
      {
        project_id: setup.projectId,
        document_id: documentB.documentId,
        ordinal: 0,
        start_chunk_id: documentB.chunkIds[0]!,
        end_chunk_id: documentB.chunkIds[0]!,
        start_char: 0,
        end_char: 2,
        title: "B start"
      }
    ]);

    const listed = listScenesForProject(setup.db, setup.projectId);
    expect(listed).toHaveLength(4);

    const sortedIds = [...listed]
      .sort((left, right) => {
        const byDocument = left.document_id.localeCompare(right.document_id);
        if (byDocument !== 0) {
          return byDocument;
        }
        return left.ordinal - right.ordinal;
      })
      .map((scene) => scene.id);
    expect(listed.map((scene) => scene.id)).toEqual(sortedIds);

    const forDocumentA = listed.filter((scene) => scene.document_id === documentA.documentId);
    const forDocumentB = listed.filter((scene) => scene.document_id === documentB.documentId);
    expect(forDocumentA.map((scene) => scene.ordinal)).toEqual([0, 2]);
    expect(forDocumentB.map((scene) => scene.ordinal)).toEqual([0, 1]);
  });

  it("replaces scenes transactionally and rolls back if any scene insert fails", () => {
    const setup = setupDb();
    const document = createDocumentWithChunks(setup, "transaction.md", ["T0", "T1", "T2"]);

    const original = replaceScenesForDocument(setup.db, document.documentId, [
      {
        project_id: setup.projectId,
        document_id: document.documentId,
        ordinal: 0,
        start_chunk_id: document.chunkIds[0]!,
        end_chunk_id: document.chunkIds[2]!,
        start_char: 0,
        end_char: 202,
        title: "Original"
      }
    ]);
    const originalSceneId = original[0]!.id;

    const character = createEntity(setup.db, {
      projectId: setup.projectId,
      type: "character",
      displayName: "Lark"
    });
    replaceSceneEntities(setup.db, originalSceneId, [
      { entityId: character.id, role: "present", confidence: 0.8 }
    ]);
    insertSceneEvidence(setup.db, {
      sceneId: originalSceneId,
      chunkId: document.chunkIds[0]!,
      quoteStart: 0,
      quoteEnd: 2
    });

    expect(countRowsBySceneId(setup.db, "scene_metadata", originalSceneId)).toBe(1);
    expect(countRowsBySceneId(setup.db, "scene_entity", originalSceneId)).toBe(1);
    expect(countRowsBySceneId(setup.db, "scene_evidence", originalSceneId)).toBe(1);

    expect(() =>
      replaceScenesForDocument(setup.db, document.documentId, [
        {
          project_id: setup.projectId,
          document_id: document.documentId,
          ordinal: 0,
          start_chunk_id: document.chunkIds[0]!,
          end_chunk_id: document.chunkIds[1]!,
          start_char: 0,
          end_char: 101,
          title: "Valid"
        },
        {
          project_id: "missing-project",
          document_id: document.documentId,
          ordinal: 1,
          start_chunk_id: document.chunkIds[2]!,
          end_chunk_id: document.chunkIds[2]!,
          start_char: 200,
          end_char: 202,
          title: "Invalid"
        }
      ])
    ).toThrow(/FOREIGN KEY/i);

    expect(getSceneById(setup.db, originalSceneId)).not.toBeNull();
    expect(countScenesForDocument(setup.db, document.documentId)).toBe(1);
    expect(countRowsBySceneId(setup.db, "scene_metadata", originalSceneId)).toBe(1);
    expect(countRowsBySceneId(setup.db, "scene_entity", originalSceneId)).toBe(1);
    expect(countRowsBySceneId(setup.db, "scene_evidence", originalSceneId)).toBe(1);

    const replacement = replaceScenesForDocument(setup.db, document.documentId, [
      {
        project_id: setup.projectId,
        document_id: document.documentId,
        ordinal: 0,
        start_chunk_id: document.chunkIds[1]!,
        end_chunk_id: document.chunkIds[2]!,
        start_char: 100,
        end_char: 202,
        title: "Replacement"
      }
    ]);
    expect(replacement).toHaveLength(1);
    expect(getSceneById(setup.db, originalSceneId)).toBeNull();
    expect(countRowsBySceneId(setup.db, "scene_metadata", originalSceneId)).toBe(0);
    expect(countRowsBySceneId(setup.db, "scene_entity", originalSceneId)).toBe(0);
    expect(countRowsBySceneId(setup.db, "scene_evidence", originalSceneId)).toBe(0);
  });

  it("cascades child rows when a scene is deleted directly", () => {
    const setup = setupDb();
    const document = createDocumentWithChunks(setup, "cascade.md", ["C0", "C1", "C2"]);
    const scenes = replaceScenesForDocument(setup.db, document.documentId, [
      {
        project_id: setup.projectId,
        document_id: document.documentId,
        ordinal: 0,
        start_chunk_id: document.chunkIds[0]!,
        end_chunk_id: document.chunkIds[0]!,
        start_char: 0,
        end_char: 2,
        title: "First"
      },
      {
        project_id: setup.projectId,
        document_id: document.documentId,
        ordinal: 1,
        start_chunk_id: document.chunkIds[1]!,
        end_chunk_id: document.chunkIds[2]!,
        start_char: 100,
        end_char: 202,
        title: "Second"
      }
    ]);

    const firstSceneId = scenes[0]!.id;
    const secondSceneId = scenes[1]!.id;
    const character = createEntity(setup.db, {
      projectId: setup.projectId,
      type: "character",
      displayName: "Nyra"
    });
    replaceSceneEntities(setup.db, firstSceneId, [
      { entityId: character.id, role: "present", confidence: 0.65 }
    ]);
    insertSceneEvidence(setup.db, {
      sceneId: firstSceneId,
      chunkId: document.chunkIds[0]!,
      quoteStart: 0,
      quoteEnd: 2
    });

    setup.db.prepare("DELETE FROM scene WHERE id = ?").run(firstSceneId);

    expect(getSceneById(setup.db, firstSceneId)).toBeNull();
    expect(countRowsBySceneId(setup.db, "scene_metadata", firstSceneId)).toBe(0);
    expect(countRowsBySceneId(setup.db, "scene_entity", firstSceneId)).toBe(0);
    expect(countRowsBySceneId(setup.db, "scene_evidence", firstSceneId)).toBe(0);
    expect(countRowsBySceneId(setup.db, "scene_metadata", secondSceneId)).toBe(1);
  });

  it("links evidence rows to a scene and returns only that scene's evidence", () => {
    const setup = setupDb();
    const document = createDocumentWithChunks(setup, "evidence.md", ["E0", "E1", "E2"]);
    const scenes = replaceScenesForDocument(setup.db, document.documentId, [
      {
        project_id: setup.projectId,
        document_id: document.documentId,
        ordinal: 0,
        start_chunk_id: document.chunkIds[0]!,
        end_chunk_id: document.chunkIds[1]!,
        start_char: 0,
        end_char: 101,
        title: "With evidence"
      },
      {
        project_id: setup.projectId,
        document_id: document.documentId,
        ordinal: 1,
        start_chunk_id: document.chunkIds[2]!,
        end_chunk_id: document.chunkIds[2]!,
        start_char: 200,
        end_char: 202,
        title: "Other"
      }
    ]);

    insertSceneEvidence(setup.db, {
      sceneId: scenes[0]!.id,
      chunkId: document.chunkIds[0]!,
      quoteStart: 0,
      quoteEnd: 1
    });
    insertSceneEvidence(setup.db, {
      sceneId: scenes[0]!.id,
      chunkId: document.chunkIds[1]!,
      quoteStart: 0,
      quoteEnd: 1
    });
    insertSceneEvidence(setup.db, {
      sceneId: scenes[1]!.id,
      chunkId: document.chunkIds[2]!,
      quoteStart: 0,
      quoteEnd: 1
    });

    const evidence = listSceneEvidence(setup.db, scenes[0]!.id).sort(
      (left, right) => left.quote_start - right.quote_start || left.chunk_id.localeCompare(right.chunk_id)
    );
    expect(evidence).toHaveLength(2);
    expect(evidence.every((row) => row.scene_id === scenes[0]!.id)).toBe(true);
    expect(evidence.map((row) => row.chunk_id).sort()).toEqual(
      [document.chunkIds[0], document.chunkIds[1]].sort()
    );
  });

  it("stores and returns pov_confidence in both get and list paths", () => {
    const setup = setupDb();
    const document = createDocumentWithChunks(setup, "pov.md", ["P0"]);
    const scenes = replaceScenesForDocument(setup.db, document.documentId, [
      {
        project_id: setup.projectId,
        document_id: document.documentId,
        ordinal: 0,
        start_chunk_id: document.chunkIds[0]!,
        end_chunk_id: document.chunkIds[0]!,
        start_char: 0,
        end_char: 2,
        title: "POV scene"
      }
    ]);

    updateSceneMetadata(setup.db, scenes[0]!.id, {
      pov_mode: "third_limited",
      pov_entity_id: null,
      pov_confidence: 0.875,
      setting_entity_id: null,
      setting_text: "Alley",
      setting_confidence: 0.5,
      time_context_text: null
    });

    const fromGet = getSceneById(setup.db, scenes[0]!.id);
    expect(fromGet).not.toBeNull();
    expect(fromGet?.pov_confidence).toBeCloseTo(0.875, 10);

    const fromList = listScenesForProject(setup.db, setup.projectId).find(
      (scene) => scene.id === scenes[0]!.id
    );
    expect(fromList?.pov_confidence).toBeCloseTo(0.875, 10);
  });

  it("throws for invalid document IDs and duplicate generated scene IDs", () => {
    const setup = setupDb();
    const document = createDocumentWithChunks(setup, "errors.md", ["X0", "X1"]);

    expect(() =>
      replaceScenesForDocument(setup.db, "missing-document", [
        {
          project_id: setup.projectId,
          document_id: "missing-document",
          ordinal: 0,
          start_chunk_id: document.chunkIds[0]!,
          end_chunk_id: document.chunkIds[1]!,
          start_char: 0,
          end_char: 101,
          title: "Invalid document"
        }
      ])
    ).toThrow(/FOREIGN KEY/i);
    expect(countScenesForDocument(setup.db, document.documentId)).toBe(0);

    vi.spyOn(crypto, "randomUUID").mockReturnValue("scene000-0000-0000-0000-000000fixed");
    expect(() =>
      replaceScenesForDocument(setup.db, document.documentId, [
        {
          project_id: setup.projectId,
          document_id: document.documentId,
          ordinal: 0,
          start_chunk_id: document.chunkIds[0]!,
          end_chunk_id: document.chunkIds[0]!,
          start_char: 0,
          end_char: 2,
          title: "First"
        },
        {
          project_id: setup.projectId,
          document_id: document.documentId,
          ordinal: 1,
          start_chunk_id: document.chunkIds[1]!,
          end_chunk_id: document.chunkIds[1]!,
          start_char: 100,
          end_char: 102,
          title: "Second"
        }
      ])
    ).toThrow(/UNIQUE|constraint/i);
    expect(countScenesForDocument(setup.db, document.documentId)).toBe(0);
  });

  it("replaces scene entities atomically and maps chunk IDs to scene IDs", () => {
    const setup = setupDb();
    const document = createDocumentWithChunks(setup, "map.md", ["M0", "M1", "M2", "M3"]);
    const scenes = replaceScenesForDocument(setup.db, document.documentId, [
      {
        project_id: setup.projectId,
        document_id: document.documentId,
        ordinal: 0,
        start_chunk_id: document.chunkIds[0]!,
        end_chunk_id: document.chunkIds[1]!,
        start_char: 0,
        end_char: 101,
        title: "Map first"
      },
      {
        project_id: setup.projectId,
        document_id: document.documentId,
        ordinal: 1,
        start_chunk_id: document.chunkIds[2]!,
        end_chunk_id: document.chunkIds[3]!,
        start_char: 200,
        end_char: 302,
        title: "Map second"
      }
    ]);

    const alpha = createEntity(setup.db, {
      projectId: setup.projectId,
      type: "character",
      displayName: "Alpha"
    });
    const beta = createEntity(setup.db, {
      projectId: setup.projectId,
      type: "character",
      displayName: "Beta"
    });

    replaceSceneEntities(setup.db, scenes[0]!.id, [
      { entityId: alpha.id, role: "present", confidence: 0.9 },
      { entityId: beta.id, role: "mentioned", confidence: 0.4 }
    ]);
    replaceSceneEntities(setup.db, scenes[0]!.id, [
      { entityId: beta.id, role: "present", confidence: 0.95 }
    ]);

    const entities = setup.db
      .prepare("SELECT entity_id, role, confidence FROM scene_entity WHERE scene_id = ? ORDER BY entity_id")
      .all(scenes[0]!.id) as Array<{ entity_id: string; role: string; confidence: number }>;
    expect(entities).toEqual([{ entity_id: beta.id, role: "present", confidence: 0.95 }]);

    const chunkToScene = getSceneIdsForChunkIds(setup.db, [
      document.chunkIds[0]!,
      document.chunkIds[2]!,
      "missing"
    ]);
    expect(chunkToScene.get(document.chunkIds[0]!)).toBe(scenes[0]!.id);
    expect(chunkToScene.get(document.chunkIds[2]!)).toBe(scenes[1]!.id);
    expect(chunkToScene.has("missing")).toBe(false);
    expect(getSceneIdsForChunkIds(setup.db, [])).toEqual(new Map<string, string>());
  });
});
