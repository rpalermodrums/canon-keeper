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
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return [];
  }

  const sanitizedQuery = sanitizeQuery(trimmedQuery);
  const preferSanitized = /["']/.test(trimmedQuery);

  const attempts: string[] = [];
  const pushAttempt = (value: string): void => {
    if (!value || attempts.includes(value)) {
      return;
    }
    attempts.push(value);
  };

  if (preferSanitized) {
    pushAttempt(sanitizedQuery);
    pushAttempt(trimmedQuery);
  } else {
    pushAttempt(trimmedQuery);
    pushAttempt(sanitizedQuery);
  }

  if (attempts.length === 0) {
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

  const failures: Array<{ query: string; message: string }> = [];

  for (const candidate of attempts) {
    try {
      return stmt.all(candidate, limit) as SearchResult[];
    } catch (error) {
      failures.push({
        query: candidate,
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }

  if (projectId) {
    logEvent(db, {
      projectId,
      level: "warn",
      eventType: "fts_query_failed",
      payload: {
        attempts: failures
      }
    });
  }

  return [];
}
