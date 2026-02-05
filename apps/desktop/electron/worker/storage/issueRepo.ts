import type Database from "better-sqlite3";
import crypto from "node:crypto";
import type { IssueSeverity, IssueStatus, IssueType } from "../../../../../packages/shared/types/persisted";
import { getChunkById } from "./chunkRepo";
import { getDocumentById } from "./documentRepo";

export type IssueInsert = {
  projectId: string;
  type: IssueType;
  severity: IssueSeverity;
  title: string;
  description: string;
  status?: IssueStatus;
};

export type IssueSummary = {
  id: string;
  project_id: string;
  type: IssueType;
  severity: IssueSeverity;
  title: string;
  description: string;
  status: IssueStatus;
  created_at: number;
  updated_at: number;
};

export function clearIssuesByType(
  db: Database.Database,
  projectId: string,
  type: IssueType
): void {
  const issueIds = db
    .prepare("SELECT id FROM issue WHERE project_id = ? AND type = ?")
    .all(projectId, type) as Array<{ id: string }>;

  const deleteEvidence = db.prepare("DELETE FROM issue_evidence WHERE issue_id = ?");
  const deleteIssue = db.prepare("DELETE FROM issue WHERE id = ?");

  const tx = db.transaction(() => {
    for (const issue of issueIds) {
      deleteEvidence.run(issue.id);
      deleteIssue.run(issue.id);
    }
  });

  tx();
}

export function insertIssue(db: Database.Database, input: IssueInsert): IssueSummary {
  const now = Date.now();
  const issue: IssueSummary = {
    id: crypto.randomUUID(),
    project_id: input.projectId,
    type: input.type,
    severity: input.severity,
    title: input.title,
    description: input.description,
    status: input.status ?? "open",
    created_at: now,
    updated_at: now
  };

  db.prepare(
    "INSERT INTO issue (id, project_id, type, severity, title, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    issue.id,
    issue.project_id,
    issue.type,
    issue.severity,
    issue.title,
    issue.description,
    issue.status,
    issue.created_at,
    issue.updated_at
  );

  return issue;
}

export function insertIssueEvidence(
  db: Database.Database,
  args: { issueId: string; chunkId: string; quoteStart: number; quoteEnd: number }
): void {
  db.prepare(
    "INSERT INTO issue_evidence (id, issue_id, chunk_id, quote_start, quote_end, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(
    crypto.randomUUID(),
    args.issueId,
    args.chunkId,
    args.quoteStart,
    args.quoteEnd,
    Date.now()
  );
}

export function listIssues(db: Database.Database, projectId: string): IssueSummary[] {
  return db
    .prepare(
      "SELECT id, project_id, type, severity, title, description, status, created_at, updated_at FROM issue WHERE project_id = ? ORDER BY created_at DESC"
    )
    .all(projectId) as IssueSummary[];
}

function buildExcerpt(text: string, start: number, end: number): string {
  const context = 60;
  const prefixStart = Math.max(0, start - context);
  const suffixEnd = Math.min(text.length, end + context);
  const before = text.slice(prefixStart, start);
  const highlight = text.slice(start, end);
  const after = text.slice(end, suffixEnd);
  return `${prefixStart > 0 ? "…" : ""}${before}[${highlight}]${after}${suffixEnd < text.length ? "…" : ""}`;
}

export function listIssuesWithEvidence(
  db: Database.Database,
  projectId: string
): Array<
  IssueSummary & {
    evidence: Array<{
      chunkId: string;
      documentPath: string | null;
      chunkOrdinal: number | null;
      quoteStart: number;
      quoteEnd: number;
      excerpt: string;
    }>;
  }
> {
  const issues = listIssues(db, projectId);
  const evidenceRows = db
    .prepare(
      "SELECT issue_id, chunk_id, quote_start, quote_end FROM issue_evidence WHERE issue_id IN (SELECT id FROM issue WHERE project_id = ?)"
    )
    .all(projectId) as Array<{
    issue_id: string;
    chunk_id: string;
    quote_start: number;
    quote_end: number;
  }>;

  const evidenceMap = new Map<
    string,
    Array<{
      chunkId: string;
      documentPath: string | null;
      chunkOrdinal: number | null;
      quoteStart: number;
      quoteEnd: number;
      excerpt: string;
    }>
  >();
  for (const row of evidenceRows) {
    const list = evidenceMap.get(row.issue_id) ?? [];
    const chunk = getChunkById(db, row.chunk_id);
    const doc = chunk ? getDocumentById(db, chunk.document_id) : null;
    const excerpt = chunk ? buildExcerpt(chunk.text, row.quote_start, row.quote_end) : "";
    list.push({
      chunkId: row.chunk_id,
      documentPath: doc?.path ?? null,
      chunkOrdinal: chunk?.ordinal ?? null,
      quoteStart: row.quote_start,
      quoteEnd: row.quote_end,
      excerpt
    });
    evidenceMap.set(row.issue_id, list);
  }

  return issues.map((issue) => ({
    ...issue,
    evidence: evidenceMap.get(issue.id) ?? []
  }));
}

export function dismissIssue(db: Database.Database, issueId: string): void {
  db.prepare("UPDATE issue SET status = ?, updated_at = ? WHERE id = ?").run(
    "dismissed",
    Date.now(),
    issueId
  );
}

export function deleteIssuesByIds(db: Database.Database, issueIds: string[]): void {
  if (issueIds.length === 0) {
    return;
  }
  const deleteEvidence = db.prepare("DELETE FROM issue_evidence WHERE issue_id = ?");
  const deleteIssue = db.prepare("DELETE FROM issue WHERE id = ?");

  const tx = db.transaction((ids: string[]) => {
    for (const id of ids) {
      deleteEvidence.run(id);
      deleteIssue.run(id);
    }
  });
  tx(issueIds);
}

export function deleteIssuesByTypeAndDocument(
  db: Database.Database,
  projectId: string,
  type: string,
  documentId: string
): void {
  const issueRows = db
    .prepare(
      `SELECT DISTINCT i.id
       FROM issue i
       JOIN issue_evidence e ON e.issue_id = i.id
       JOIN chunk c ON c.id = e.chunk_id
       WHERE i.project_id = ? AND i.type = ? AND c.document_id = ?`
    )
    .all(projectId, type, documentId) as Array<{ id: string }>;

  deleteIssuesByIds(
    db,
    issueRows.map((row) => row.id)
  );
}

export function deleteIssuesByTypeAndChunkIds(
  db: Database.Database,
  projectId: string,
  type: string,
  chunkIds: string[]
): void {
  if (chunkIds.length === 0) {
    return;
  }
  const placeholders = chunkIds.map(() => "?").join(", ");
  const issueRows = db
    .prepare(
      `SELECT DISTINCT i.id
       FROM issue i
       JOIN issue_evidence e ON e.issue_id = i.id
       WHERE i.project_id = ? AND i.type = ? AND e.chunk_id IN (${placeholders})`
    )
    .all(projectId, type, ...chunkIds) as Array<{ id: string }>;

  deleteIssuesByIds(
    db,
    issueRows.map((row) => row.id)
  );
}
