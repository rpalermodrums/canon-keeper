import type Database from "better-sqlite3";
import crypto from "node:crypto";

export function insertSceneEvidence(
  db: Database.Database,
  args: { sceneId: string; chunkId: string; quoteStart: number; quoteEnd: number }
): void {
  db.prepare(
    "INSERT INTO scene_evidence (id, scene_id, chunk_id, quote_start, quote_end, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(
    crypto.randomUUID(),
    args.sceneId,
    args.chunkId,
    args.quoteStart,
    args.quoteEnd,
    Date.now()
  );
}

export function listSceneEvidence(db: Database.Database, sceneId: string): Array<{
  id: string;
  scene_id: string;
  chunk_id: string;
  quote_start: number;
  quote_end: number;
}> {
  return db
    .prepare(
      "SELECT id, scene_id, chunk_id, quote_start, quote_end FROM scene_evidence WHERE scene_id = ?"
    )
    .all(sceneId) as Array<{
    id: string;
    scene_id: string;
    chunk_id: string;
    quote_start: number;
    quote_end: number;
  }>;
}

export function countSceneEvidenceCoverage(
  db: Database.Database,
  projectId: string
): { total: number; withEvidence: number } {
  const total = (
    db
      .prepare("SELECT COUNT(*) AS cnt FROM scene WHERE project_id = ?")
      .get(projectId) as { cnt: number }
  ).cnt;

  const withEvidence = (
    db
      .prepare(
        "SELECT COUNT(DISTINCT s.id) AS cnt FROM scene s JOIN scene_evidence e ON e.scene_id = s.id WHERE s.project_id = ?"
      )
      .get(projectId) as { cnt: number }
  ).cnt;

  return { total, withEvidence };
}

export function deleteSceneEvidenceForDocument(db: Database.Database, documentId: string): void {
  db.prepare(
    "DELETE FROM scene_evidence WHERE scene_id IN (SELECT id FROM scene WHERE document_id = ?)"
  ).run(documentId);
}

export function deleteSceneEvidenceForScene(db: Database.Database, sceneId: string): void {
  db.prepare("DELETE FROM scene_evidence WHERE scene_id = ?").run(sceneId);
}
