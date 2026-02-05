import type Database from "better-sqlite3";
import crypto from "node:crypto";
import type { DocumentSnapshotRow } from "../../../../../packages/shared/types/persisted";

export type SnapshotSummary = Pick<
  DocumentSnapshotRow,
  "id" | "document_id" | "version" | "full_text" | "full_text_hash" | "created_at"
>;

export type SnapshotInsertResult = {
  snapshot: SnapshotSummary;
  created: boolean;
};

export function getLatestSnapshot(
  db: Database.Database,
  documentId: string
): SnapshotSummary | null {
  const row = db
    .prepare(
      "SELECT id, document_id, version, full_text, full_text_hash, created_at FROM document_snapshot WHERE document_id = ? ORDER BY version DESC LIMIT 1"
    )
    .get(documentId) as SnapshotSummary | undefined;
  return row ?? null;
}

export function insertSnapshot(
  db: Database.Database,
  documentId: string,
  fullText: string,
  fullTextHash: string
): SnapshotInsertResult {
  const latest = getLatestSnapshot(db, documentId);
  if (latest && latest.full_text_hash === fullTextHash) {
    return { snapshot: latest, created: false };
  }

  const version = (latest?.version ?? 0) + 1;
  const now = Date.now();
  const snapshot: SnapshotSummary = {
    id: crypto.randomUUID(),
    document_id: documentId,
    version,
    full_text: fullText,
    full_text_hash: fullTextHash,
    created_at: now
  };

  db.prepare(
    "INSERT INTO document_snapshot (id, document_id, version, full_text, full_text_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(
    snapshot.id,
    snapshot.document_id,
    snapshot.version,
    snapshot.full_text,
    snapshot.full_text_hash,
    snapshot.created_at
  );

  return { snapshot, created: true };
}
