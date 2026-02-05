import type Database from "better-sqlite3";
import crypto from "node:crypto";
import type { DocumentSnapshotRow } from "../../../../../packages/shared/types/persisted";

export type SnapshotSummary = Pick<
  DocumentSnapshotRow,
  "id" | "document_id" | "version" | "full_text" | "full_text_hash" | "created_at"
>;

export function getLatestSnapshotVersion(db: Database.Database, documentId: string): number {
  const row = db
    .prepare("SELECT MAX(version) as max_version FROM document_snapshot WHERE document_id = ?")
    .get(documentId) as { max_version: number | null } | undefined;

  return row?.max_version ?? 0;
}

export function insertSnapshot(
  db: Database.Database,
  documentId: string,
  fullText: string,
  fullTextHash: string
): SnapshotSummary {
  const version = getLatestSnapshotVersion(db, documentId) + 1;
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

  return snapshot;
}
