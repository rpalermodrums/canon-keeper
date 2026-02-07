import type Database from "better-sqlite3";
import crypto from "node:crypto";
import type { SceneRow } from "../../../../../packages/shared/types/persisted";

export type SceneInsert = Pick<
  SceneRow,
  | "project_id"
  | "document_id"
  | "ordinal"
  | "start_chunk_id"
  | "end_chunk_id"
  | "start_char"
  | "end_char"
  | "title"
>;

export type SceneSummary = SceneInsert & {
  id: string;
  pov_mode: string;
  pov_entity_id: string | null;
  pov_confidence: number | null;
  setting_entity_id: string | null;
  setting_text: string | null;
};

export type SceneMetadataUpdate = {
  pov_mode: string;
  pov_entity_id: string | null;
  pov_confidence: number;
  setting_entity_id: string | null;
  setting_text: string | null;
  setting_confidence: number;
  time_context_text: string | null;
};

export function getSceneById(db: Database.Database, sceneId: string): SceneSummary | null {
  const row = db
    .prepare(
      "SELECT s.id, s.project_id, s.document_id, s.ordinal, s.start_chunk_id, s.end_chunk_id, s.start_char, s.end_char, s.title, m.pov_mode, m.pov_entity_id, m.pov_confidence, m.setting_entity_id, m.setting_text FROM scene s LEFT JOIN scene_metadata m ON m.scene_id = s.id WHERE s.id = ?"
    )
    .get(sceneId) as SceneSummary | undefined;
  return row ?? null;
}

export function replaceScenesForDocument(
  db: Database.Database,
  documentId: string,
  scenes: SceneInsert[]
): SceneSummary[] {
  const now = Date.now();
  const deleteScenes = db.prepare("DELETE FROM scene WHERE document_id = ?");
  const deleteMeta = db.prepare(
    "DELETE FROM scene_metadata WHERE scene_id IN (SELECT id FROM scene WHERE document_id = ?)"
  );
  const deleteEntities = db.prepare(
    "DELETE FROM scene_entity WHERE scene_id IN (SELECT id FROM scene WHERE document_id = ?)"
  );
  const deleteEvidence = db.prepare(
    "DELETE FROM scene_evidence WHERE scene_id IN (SELECT id FROM scene WHERE document_id = ?)"
  );

  const insertScene = db.prepare(
    "INSERT INTO scene (id, project_id, document_id, ordinal, start_chunk_id, end_chunk_id, start_char, end_char, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const insertMeta = db.prepare(
    "INSERT INTO scene_metadata (scene_id, pov_mode, pov_entity_id, pov_confidence, setting_entity_id, setting_text, setting_confidence, time_context_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );

  const inserted: SceneSummary[] = [];

  const tx = db.transaction(() => {
    deleteEntities.run(documentId);
    deleteMeta.run(documentId);
    deleteEvidence.run(documentId);
    deleteScenes.run(documentId);

    for (const scene of scenes) {
      const id = crypto.randomUUID();
      insertScene.run(
        id,
        scene.project_id,
        scene.document_id,
        scene.ordinal,
        scene.start_chunk_id,
        scene.end_chunk_id,
        scene.start_char,
        scene.end_char,
        scene.title ?? null,
        now,
        now
      );
      insertMeta.run(
        id,
        "unknown",
        null,
        0,
        null,
        null,
        0,
        null,
        now,
        now
      );
      inserted.push({
        ...scene,
        id,
        pov_mode: "unknown",
        pov_entity_id: null,
        pov_confidence: 0,
        setting_entity_id: null,
        setting_text: null
      });
    }
  });

  tx();
  return inserted;
}

export function listScenesForProject(db: Database.Database, projectId: string): SceneSummary[] {
  return db
    .prepare(
      "SELECT s.id, s.project_id, s.document_id, s.ordinal, s.start_chunk_id, s.end_chunk_id, s.start_char, s.end_char, s.title, m.pov_mode, m.pov_entity_id, m.pov_confidence, m.setting_entity_id, m.setting_text FROM scene s LEFT JOIN scene_metadata m ON m.scene_id = s.id WHERE s.project_id = ? ORDER BY s.document_id, s.ordinal"
    )
    .all(projectId) as SceneSummary[];
}

export function updateSceneMetadata(
  db: Database.Database,
  sceneId: string,
  update: SceneMetadataUpdate
): void {
  db.prepare(
    "UPDATE scene_metadata SET pov_mode = ?, pov_entity_id = ?, pov_confidence = ?, setting_entity_id = ?, setting_text = ?, setting_confidence = ?, time_context_text = ?, updated_at = ? WHERE scene_id = ?"
  ).run(
    update.pov_mode,
    update.pov_entity_id,
    update.pov_confidence,
    update.setting_entity_id,
    update.setting_text,
    update.setting_confidence,
    update.time_context_text,
    Date.now(),
    sceneId
  );
}

export function getSceneIdsForChunkIds(
  db: Database.Database,
  chunkIds: string[]
): Map<string, string> {
  const result = new Map<string, string>();
  if (chunkIds.length === 0) return result;

  const placeholders = chunkIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT c.id AS chunk_id, s.id AS scene_id
       FROM chunk c
       JOIN scene s ON s.document_id = c.document_id
       JOIN chunk sc_start ON sc_start.id = s.start_chunk_id
       JOIN chunk sc_end ON sc_end.id = s.end_chunk_id
       WHERE c.id IN (${placeholders})
         AND c.ordinal >= sc_start.ordinal
         AND c.ordinal <= sc_end.ordinal`
    )
    .all(...chunkIds) as Array<{ chunk_id: string; scene_id: string }>;

  for (const row of rows) {
    if (!result.has(row.chunk_id)) {
      result.set(row.chunk_id, row.scene_id);
    }
  }

  return result;
}

export function replaceSceneEntities(
  db: Database.Database,
  sceneId: string,
  entities: Array<{ entityId: string; role: string; confidence: number }>
): void {
  const deleteStmt = db.prepare("DELETE FROM scene_entity WHERE scene_id = ?");
  const insertStmt = db.prepare(
    "INSERT INTO scene_entity (id, scene_id, entity_id, role, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const now = Date.now();

  const tx = db.transaction(() => {
    deleteStmt.run(sceneId);
    for (const entity of entities) {
      insertStmt.run(crypto.randomUUID(), sceneId, entity.entityId, entity.role, entity.confidence, now);
    }
  });
  tx();
}
