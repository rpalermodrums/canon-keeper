import type Database from "better-sqlite3";
import crypto from "node:crypto";
import type { DocumentKind, DocumentRow } from "../../../../../packages/shared/types/persisted";

export type DocumentSummary = Pick<
  DocumentRow,
  "id" | "project_id" | "path" | "kind" | "created_at" | "updated_at"
>;

export function getDocumentByPath(
  db: Database.Database,
  projectId: string,
  pathValue: string
): DocumentSummary | null {
  const row = db
    .prepare(
      "SELECT id, project_id, path, kind, created_at, updated_at FROM document WHERE project_id = ? AND path = ?"
    )
    .get(projectId, pathValue) as DocumentSummary | undefined;
  return row ?? null;
}

export function createDocument(
  db: Database.Database,
  projectId: string,
  pathValue: string,
  kind: DocumentKind
): DocumentSummary {
  const now = Date.now();
  const doc: DocumentSummary = {
    id: crypto.randomUUID(),
    project_id: projectId,
    path: pathValue,
    kind,
    created_at: now,
    updated_at: now
  };

  db.prepare(
    "INSERT INTO document (id, project_id, path, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(doc.id, doc.project_id, doc.path, doc.kind, doc.created_at, doc.updated_at);

  return doc;
}

export function touchDocument(db: Database.Database, documentId: string): void {
  db.prepare("UPDATE document SET updated_at = ? WHERE id = ?").run(Date.now(), documentId);
}

export function listDocuments(db: Database.Database, projectId: string): DocumentSummary[] {
  return db
    .prepare(
      "SELECT id, project_id, path, kind, created_at, updated_at FROM document WHERE project_id = ? ORDER BY created_at"
    )
    .all(projectId) as DocumentSummary[];
}
