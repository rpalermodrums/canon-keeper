import type Database from "better-sqlite3";
import crypto from "node:crypto";
import type { ChunkRow } from "../../../../../packages/shared/types/persisted";

export type ChunkRecord = Pick<
  ChunkRow,
  | "id"
  | "document_id"
  | "ordinal"
  | "text"
  | "text_hash"
  | "start_char"
  | "end_char"
  | "created_at"
  | "updated_at"
>;

export type NewChunk = Omit<ChunkRecord, "id" | "created_at" | "updated_at">;

export function listChunksForDocument(
  db: Database.Database,
  documentId: string
): ChunkRecord[] {
  return db
    .prepare(
      "SELECT id, document_id, ordinal, text, text_hash, start_char, end_char, created_at, updated_at FROM chunk WHERE document_id = ? ORDER BY ordinal"
    )
    .all(documentId) as ChunkRecord[];
}

export function deleteChunksByIds(db: Database.Database, ids: string[]): void {
  if (ids.length === 0) {
    return;
  }
  const stmt = db.prepare("DELETE FROM chunk WHERE id = ?");
  const transaction = db.transaction((chunkIds: string[]) => {
    for (const id of chunkIds) {
      stmt.run(id);
    }
  });
  transaction(ids);
}

export function insertChunks(
  db: Database.Database,
  documentId: string,
  chunks: NewChunk[]
): ChunkRecord[] {
  const now = Date.now();
  const stmt = db.prepare(
    "INSERT INTO chunk (id, document_id, ordinal, text, text_hash, start_char, end_char, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );

  const inserted: ChunkRecord[] = [];
  const tx = db.transaction((items: NewChunk[]) => {
    for (const chunk of items) {
      const row: ChunkRecord = {
        id: crypto.randomUUID(),
        document_id: documentId,
        ordinal: chunk.ordinal,
        text: chunk.text,
        text_hash: chunk.text_hash,
        start_char: chunk.start_char,
        end_char: chunk.end_char,
        created_at: now,
        updated_at: now
      };
      stmt.run(
        row.id,
        row.document_id,
        row.ordinal,
        row.text,
        row.text_hash,
        row.start_char,
        row.end_char,
        row.created_at,
        row.updated_at
      );
      inserted.push(row);
    }
  });

  tx(chunks);
  return inserted;
}

export function updateChunk(
  db: Database.Database,
  id: string,
  updates: Pick<ChunkRecord, "ordinal" | "text" | "text_hash" | "start_char" | "end_char">
): void {
  db.prepare(
    "UPDATE chunk SET ordinal = ?, text = ?, text_hash = ?, start_char = ?, end_char = ?, updated_at = ? WHERE id = ?"
  ).run(
    updates.ordinal,
    updates.text,
    updates.text_hash,
    updates.start_char,
    updates.end_char,
    Date.now(),
    id
  );
}
