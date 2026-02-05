import type Database from "better-sqlite3";

export type ProcessingStatus = "pending" | "ok" | "failed";

export type ProcessingStateRow = {
  document_id: string;
  snapshot_id: string;
  stage: string;
  status: ProcessingStatus;
  error: string | null;
  updated_at: number;
};

export function getProcessingState(
  db: Database.Database,
  documentId: string,
  stage: string
): ProcessingStateRow | null {
  const row = db
    .prepare(
      "SELECT document_id, snapshot_id, stage, status, error, updated_at FROM document_processing_state WHERE document_id = ? AND stage = ?"
    )
    .get(documentId, stage) as ProcessingStateRow | undefined;
  return row ?? null;
}

export function upsertProcessingState(
  db: Database.Database,
  args: {
    documentId: string;
    snapshotId: string;
    stage: string;
    status: ProcessingStatus;
    error?: string | null;
  }
): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO document_processing_state (document_id, snapshot_id, stage, status, error, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(document_id, stage) DO UPDATE SET
       snapshot_id = excluded.snapshot_id,
       status = excluded.status,
       error = excluded.error,
       updated_at = excluded.updated_at`
  ).run(
    args.documentId,
    args.snapshotId,
    args.stage,
    args.status,
    args.error ?? null,
    now
  );
}

export function listProcessingStates(
  db: Database.Database,
  projectId: string
): Array<ProcessingStateRow & { document_path: string }> {
  return db
    .prepare(
      `SELECT dps.document_id, dps.snapshot_id, dps.stage, dps.status, dps.error, dps.updated_at, d.path as document_path
       FROM document_processing_state dps
       JOIN document d ON d.id = dps.document_id
       WHERE d.project_id = ?
       ORDER BY d.path, dps.stage`
    )
    .all(projectId) as Array<ProcessingStateRow & { document_path: string }>;
}
