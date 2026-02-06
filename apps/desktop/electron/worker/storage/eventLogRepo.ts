import type Database from "better-sqlite3";
import crypto from "node:crypto";

export type LogLevel = "info" | "warn" | "error";

export function logEvent(
  db: Database.Database,
  args: {
    projectId: string;
    level: LogLevel;
    eventType: string;
    payload: Record<string, unknown>;
  }
): void {
  const now = Date.now();
  db.prepare(
    "INSERT INTO event_log (id, project_id, ts, level, event_type, payload_json) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(
    crypto.randomUUID(),
    args.projectId,
    now,
    args.level,
    args.eventType,
    JSON.stringify(args.payload)
  );
}

export function listEvents(
  db: Database.Database,
  projectId: string,
  limit = 100
): Array<{
  id: string;
  project_id: string;
  ts: number;
  level: LogLevel;
  event_type: string;
  payload_json: string;
}> {
  return db
    .prepare(
      "SELECT id, project_id, ts, level, event_type, payload_json FROM event_log WHERE project_id = ? ORDER BY ts DESC LIMIT ?"
    )
    .all(projectId, limit) as Array<{
    id: string;
    project_id: string;
    ts: number;
    level: LogLevel;
    event_type: string;
    payload_json: string;
  }>;
}
