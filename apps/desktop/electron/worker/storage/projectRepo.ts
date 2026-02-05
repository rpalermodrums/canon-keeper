import type Database from "better-sqlite3";
import crypto from "node:crypto";
import path from "node:path";
import type { ProjectRow } from "../../../../../packages/shared/types/persisted";

export type ProjectSummary = Pick<ProjectRow, "id" | "root_path" | "name" | "created_at" | "updated_at">;

export function getProjectByRootPath(db: Database.Database, rootPath: string): ProjectSummary | null {
  const row = db
    .prepare(
      "SELECT id, root_path, name, created_at, updated_at FROM project WHERE root_path = ?"
    )
    .get(rootPath) as ProjectSummary | undefined;

  return row ?? null;
}

export function createProject(
  db: Database.Database,
  rootPath: string,
  name?: string
): ProjectSummary {
  const now = Date.now();
  const project: ProjectSummary = {
    id: crypto.randomUUID(),
    root_path: rootPath,
    name: name ?? path.basename(rootPath),
    created_at: now,
    updated_at: now
  };

  db.prepare(
    "INSERT INTO project (id, root_path, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
  ).run(project.id, project.root_path, project.name, project.created_at, project.updated_at);

  return project;
}

export function touchProject(db: Database.Database, projectId: string): void {
  db.prepare("UPDATE project SET updated_at = ? WHERE id = ?").run(Date.now(), projectId);
}
