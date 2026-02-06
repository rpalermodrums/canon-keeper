import type Database from "better-sqlite3";
import { getChunkById } from "../storage/chunkRepo";
import { getDocumentById } from "../storage/documentRepo";

export type EvidenceView = {
  chunkId: string;
  documentPath: string | null;
  chunkOrdinal: number | null;
  quoteStart: number;
  quoteEnd: number;
  excerpt: string;
  lineStart: number | null;
  lineEnd: number | null;
};

export function buildExcerpt(text: string, start: number, end: number, context = 60): string {
  const prefixStart = Math.max(0, start - context);
  const suffixEnd = Math.min(text.length, end + context);
  const before = text.slice(prefixStart, start);
  const highlight = text.slice(start, end);
  const after = text.slice(end, suffixEnd);
  return `${prefixStart > 0 ? "…" : ""}${before}[${highlight}]${after}${suffixEnd < text.length ? "…" : ""}`;
}

function lineAtOffset(text: string, offset: number): number {
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  for (let i = 0; i < safeOffset; i += 1) {
    if (text[i] === "\n") {
      line += 1;
    }
  }
  return line;
}

type SnapshotRow = { full_text: string };

export function createEvidenceMapper(db: Database.Database): (
  row: {
    chunk_id: string;
    quote_start: number;
    quote_end: number;
  } | {
    chunkId: string;
    quoteStart: number;
    quoteEnd: number;
  }
) => EvidenceView {
  const snapshotCache = new Map<string, string>();

  const loadSnapshotText = (documentId: string): string | null => {
    const cached = snapshotCache.get(documentId);
    if (cached !== undefined) {
      return cached;
    }
    const snapshot = db
      .prepare(
        "SELECT full_text FROM document_snapshot WHERE document_id = ? ORDER BY version DESC LIMIT 1"
      )
      .get(documentId) as SnapshotRow | undefined;
    const fullText = snapshot?.full_text ?? null;
    snapshotCache.set(documentId, fullText ?? "");
    return fullText;
  };

  return (row) => {
    const chunkId = "chunk_id" in row ? row.chunk_id : row.chunkId;
    const quoteStart = "quote_start" in row ? row.quote_start : row.quoteStart;
    const quoteEnd = "quote_end" in row ? row.quote_end : row.quoteEnd;

    const chunk = getChunkById(db, chunkId);
    const doc = chunk ? getDocumentById(db, chunk.document_id) : null;
    const excerpt = chunk ? buildExcerpt(chunk.text, quoteStart, quoteEnd) : "";

    let lineStart: number | null = null;
    let lineEnd: number | null = null;
    if (chunk) {
      const fullText = loadSnapshotText(chunk.document_id);
      if (fullText) {
        const absStart = chunk.start_char + quoteStart;
        const absEnd = Math.max(absStart, chunk.start_char + quoteEnd - 1);
        lineStart = lineAtOffset(fullText, absStart);
        lineEnd = lineAtOffset(fullText, absEnd);
      }
    }

    return {
      chunkId,
      documentPath: doc?.path ?? null,
      chunkOrdinal: chunk?.ordinal ?? null,
      quoteStart,
      quoteEnd,
      excerpt,
      lineStart,
      lineEnd
    };
  };
}
