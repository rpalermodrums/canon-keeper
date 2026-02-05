import fs from "node:fs";
import path from "node:path";
import mammoth from "mammoth";
import type Database from "better-sqlite3";
import { buildChunks, type ChunkSpan } from "../chunking";
import { hashText } from "../../../../../../packages/shared/utils/hashing";
import type { DocumentKind } from "../../../../../../packages/shared/types/persisted";
import {
  createDocument,
  deleteChunksByIds,
  getDocumentByPath,
  insertChunks,
  insertSnapshot,
  listChunksForDocument,
  markDocumentSeen,
  logEvent,
  touchDocument,
  upsertProcessingState,
  updateChunk
} from "../../storage";

export type IngestResult = {
  documentId: string;
  snapshotId: string;
  snapshotCreated: boolean;
  chunksCreated: number;
  chunksUpdated: number;
  chunksDeleted: number;
  changeStart: number | null;
  changeEnd: number | null;
};

export function detectDocumentKind(filePath: string): DocumentKind {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".md") return "md";
  if (ext === ".txt") return "txt";
  if (ext === ".docx") return "docx";
  throw new Error(`Unsupported document type: ${ext}`);
}

async function extractText(filePath: string, kind: DocumentKind): Promise<string> {
  if (kind === "docx") {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value ?? "";
  }
  return fs.readFileSync(filePath, "utf8");
}

function diffByHash(existing: { id: string; text_hash: string }[], next: ChunkSpan[]) {
  const minLen = Math.min(existing.length, next.length);
  let prefix = 0;
  while (prefix < minLen && existing[prefix]?.text_hash === next[prefix]?.text_hash) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    existing[existing.length - 1 - suffix]?.text_hash ===
      next[next.length - 1 - suffix]?.text_hash
  ) {
    suffix += 1;
  }

  return { prefix, suffix };
}

export async function ingestDocument(
  db: Database.Database,
  args: { projectId: string; rootPath: string; filePath: string }
): Promise<IngestResult> {
  if (!fs.existsSync(args.filePath)) {
    throw new Error(`Document not found: ${args.filePath}`);
  }

  const kind = detectDocumentKind(args.filePath);
  const existingDoc = getDocumentByPath(db, args.projectId, args.filePath);
  const document = existingDoc ?? createDocument(db, args.projectId, args.filePath, kind);

  const fullText = await extractText(args.filePath, kind);
  const normalizedText = fullText.replace(/\r\n/g, "\n");
  const fullTextHash = hashText(normalizedText);
  const snapshotResult = insertSnapshot(db, document.id, normalizedText, fullTextHash);
  markDocumentSeen(db, document.id);

  if (!snapshotResult.created) {
    return {
      documentId: document.id,
      snapshotId: snapshotResult.snapshot.id,
      snapshotCreated: false,
      chunksCreated: 0,
      chunksUpdated: 0,
      chunksDeleted: 0,
      changeStart: null,
      changeEnd: null
    };
  }

  upsertProcessingState(db, {
    documentId: document.id,
    snapshotId: snapshotResult.snapshot.id,
    stage: "ingest",
    status: "pending"
  });

  try {
    const newChunks = buildChunks(normalizedText);
    const existingChunks = listChunksForDocument(db, document.id);

    const { prefix, suffix } = diffByHash(existingChunks, newChunks);

    const deleteFrom = prefix;
    const deleteTo = existingChunks.length - suffix;
    const toDelete = existingChunks.slice(deleteFrom, deleteTo).map((c) => c.id);

    const updates: Array<{ id: string; chunk: ChunkSpan }> = [];
    for (let i = 0; i < prefix; i += 1) {
      const existingChunk = existingChunks[i];
      const newChunk = newChunks[i];
      if (!existingChunk || !newChunk) {
        continue;
      }
      updates.push({ id: existingChunk.id, chunk: newChunk });
    }
    for (let i = 0; i < suffix; i += 1) {
      const oldIndex = existingChunks.length - 1 - i;
      const newIndex = newChunks.length - 1 - i;
      const existingChunk = existingChunks[oldIndex];
      const newChunk = newChunks[newIndex];
      if (!existingChunk || !newChunk) {
        continue;
      }
      updates.push({ id: existingChunk.id, chunk: newChunk });
    }

    db.transaction(() => {
      deleteChunksByIds(db, toDelete);
      for (const update of updates) {
        updateChunk(db, update.id, {
          ordinal: update.chunk.ordinal,
          text: update.chunk.text,
          text_hash: update.chunk.text_hash,
          start_char: update.chunk.start,
          end_char: update.chunk.end
        });
      }

      const insertStart = prefix;
      const insertEnd = newChunks.length - suffix;
      const toInsert = newChunks.slice(insertStart, insertEnd).map((chunk) => ({
        document_id: document.id,
        ordinal: chunk.ordinal,
        text: chunk.text,
        text_hash: chunk.text_hash,
        start_char: chunk.start,
        end_char: chunk.end
      }));

      insertChunks(db, document.id, toInsert);
      touchDocument(db, document.id);
    })();

    const changeStart = prefix;
    const changeEnd = newChunks.length - suffix - 1;

    upsertProcessingState(db, {
      documentId: document.id,
      snapshotId: snapshotResult.snapshot.id,
      stage: "ingest",
      status: "ok"
    });

    return {
      documentId: document.id,
      snapshotId: snapshotResult.snapshot.id,
      snapshotCreated: true,
      chunksCreated: newChunks.length - prefix - suffix,
      chunksUpdated: updates.length,
      chunksDeleted: toDelete.length,
      changeStart: changeStart <= changeEnd ? changeStart : null,
      changeEnd: changeStart <= changeEnd ? changeEnd : null
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    upsertProcessingState(db, {
      documentId: document.id,
      snapshotId: snapshotResult.snapshot.id,
      stage: "ingest",
      status: "failed",
      error: message
    });
    logEvent(db, {
      projectId: args.projectId,
      level: "error",
      eventType: "stage_failed",
      payload: { stage: "ingest", documentId: document.id, message }
    });
    throw error;
  }
}
