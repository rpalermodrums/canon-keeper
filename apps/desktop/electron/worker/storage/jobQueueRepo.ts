import type Database from "better-sqlite3";
import crypto from "node:crypto";

export type JobQueueStatus = "queued" | "running" | "failed";

export type JobQueueRow = {
  id: string;
  project_id: string;
  type: string;
  payload_json: string;
  dedupe_key: string;
  status: JobQueueStatus;
  attempts: number;
  next_run_at: number;
  created_at: number;
  updated_at: number;
};

export type JobQueueInsert = {
  projectId: string;
  type: string;
  payload: unknown;
  dedupeKey: string;
};

export function resetRunningJobs(db: Database.Database): void {
  db.prepare("UPDATE job_queue SET status = 'queued' WHERE status = 'running'").run();
}

export function enqueueJob(db: Database.Database, input: JobQueueInsert): JobQueueRow {
  const existing = db
    .prepare(
      "SELECT id, project_id, type, payload_json, dedupe_key, status, attempts, next_run_at, created_at, updated_at FROM job_queue WHERE dedupe_key = ?"
    )
    .get(input.dedupeKey) as JobQueueRow | undefined;

  const now = Date.now();
  const payloadJson = JSON.stringify(input.payload);

  if (existing) {
    const shouldIncrement = existing.status === "running";
    const nextAttempts = existing.attempts + (shouldIncrement ? 1 : 0);
    db.prepare(
      "UPDATE job_queue SET payload_json = ?, status = 'queued', attempts = ?, next_run_at = ?, updated_at = ? WHERE id = ?"
    ).run(payloadJson, nextAttempts, now, now, existing.id);

    return {
      ...existing,
      payload_json: payloadJson,
      status: "queued",
      attempts: nextAttempts,
      next_run_at: now,
      updated_at: now
    };
  }

  const row: JobQueueRow = {
    id: crypto.randomUUID(),
    project_id: input.projectId,
    type: input.type,
    payload_json: payloadJson,
    dedupe_key: input.dedupeKey,
    status: "queued",
    attempts: 0,
    next_run_at: now,
    created_at: now,
    updated_at: now
  };

  db.prepare(
    "INSERT INTO job_queue (id, project_id, type, payload_json, dedupe_key, status, attempts, next_run_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    row.id,
    row.project_id,
    row.type,
    row.payload_json,
    row.dedupe_key,
    row.status,
    row.attempts,
    row.next_run_at,
    row.created_at,
    row.updated_at
  );

  return row;
}

export function claimNextJob(db: Database.Database, now: number): JobQueueRow | null {
  const row = db
    .prepare(
      "SELECT id, project_id, type, payload_json, dedupe_key, status, attempts, next_run_at, created_at, updated_at FROM job_queue WHERE status IN ('queued','failed') AND next_run_at <= ? ORDER BY next_run_at ASC, created_at ASC LIMIT 1"
    )
    .get(now) as JobQueueRow | undefined;

  if (!row) {
    return null;
  }

  const updatedAttempts = row.attempts + 1;
  db.prepare(
    "UPDATE job_queue SET status = 'running', attempts = ?, updated_at = ? WHERE id = ?"
  ).run(updatedAttempts, now, row.id);

  return {
    ...row,
    status: "running",
    attempts: updatedAttempts,
    updated_at: now
  };
}

export function getJobById(db: Database.Database, jobId: string): JobQueueRow | null {
  const row = db
    .prepare(
      "SELECT id, project_id, type, payload_json, dedupe_key, status, attempts, next_run_at, created_at, updated_at FROM job_queue WHERE id = ?"
    )
    .get(jobId) as JobQueueRow | undefined;
  return row ?? null;
}

export function completeJob(db: Database.Database, jobId: string): void {
  db.prepare("DELETE FROM job_queue WHERE id = ?").run(jobId);
}

export function failJob(db: Database.Database, jobId: string, nextRunAt: number): void {
  db.prepare("UPDATE job_queue SET status = 'failed', next_run_at = ?, updated_at = ? WHERE id = ?").run(
    nextRunAt,
    Date.now(),
    jobId
  );
}

export function getQueueDepth(db: Database.Database): number {
  const row = db
    .prepare("SELECT COUNT(*) as count FROM job_queue WHERE status IN ('queued','failed')")
    .get() as { count: number } | undefined;
  return row?.count ?? 0;
}

export function listQueuedJobs(
  db: Database.Database,
  projectId: string
): Array<{ id: string; type: string; status: string; attempts: number; created_at: number; updated_at: number }> {
  return db
    .prepare(
      "SELECT id, type, status, attempts, created_at, updated_at FROM job_queue WHERE project_id = ? AND status IN ('queued', 'failed') ORDER BY created_at"
    )
    .all(projectId) as Array<{ id: string; type: string; status: string; attempts: number; created_at: number; updated_at: number }>;
}

export function cancelJob(db: Database.Database, jobId: string): boolean {
  return db.prepare("DELETE FROM job_queue WHERE id = ? AND status = 'queued'").run(jobId).changes > 0;
}
