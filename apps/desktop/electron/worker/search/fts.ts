import type Database from "better-sqlite3";
import { logEvent } from "../storage";

export type SearchResult = {
  chunkId: string;
  documentId: string;
  documentPath: string;
  ordinal: number;
  text: string;
  snippet: string;
  score: number;
};

function sanitizeQuery(query: string): string {
  const tokens = query
    .split(/\s+/)
    .map((token) => token.replace(/["']/g, "").trim())
    .filter(Boolean);
  if (tokens.length === 0) return "";
  return tokens.map((token) => `"${token}"`).join(" AND ");
}

export function searchChunks(
  db: Database.Database,
  query: string,
  limit = 8,
  projectId?: string
): SearchResult[] {
  if (!query.trim()) {
    return [];
  }
  const stmt = db.prepare(
    `
    SELECT
      c.id as chunkId,
      c.document_id as documentId,
      d.path as documentPath,
      c.ordinal as ordinal,
      c.text as text,
      snippet(chunk_fts, 1, '[', ']', '...', 12) as snippet,
      bm25(chunk_fts) as score
    FROM chunk_fts
    JOIN chunk c ON c.id = chunk_fts.chunk_id
    JOIN document d ON d.id = c.document_id
    WHERE chunk_fts MATCH ?
    ORDER BY score
    LIMIT ?
  `
  );

  try {
    return stmt.all(query, limit) as SearchResult[];
  } catch (error) {
    if (projectId) {
      logEvent(db, {
        projectId,
        level: "warn",
        eventType: "fts_query_failed",
        payload: {
          query,
          message: error instanceof Error ? error.message : "Unknown error"
        }
      });
    }
    const fallback = sanitizeQuery(query);
    if (!fallback) {
      return [];
    }
    try {
      return stmt.all(fallback, limit) as SearchResult[];
    } catch (fallbackError) {
      if (projectId) {
        logEvent(db, {
          projectId,
          level: "warn",
          eventType: "fts_query_failed",
          payload: {
            query: fallback,
            message: fallbackError instanceof Error ? fallbackError.message : "Unknown error"
          }
        });
      }
      return [];
    }
  }
}
