import type Database from "better-sqlite3";
import crypto from "node:crypto";
import { normalizeAlias } from "../../../../../packages/shared/utils/normalize";
import type { EntityRow, EntityType } from "../../../../../packages/shared/types/persisted";

export type EntitySummary = Pick<
  EntityRow,
  "id" | "project_id" | "type" | "display_name" | "canonical_name" | "created_at" | "updated_at"
>;

export function listEntities(
  db: Database.Database,
  projectId: string,
  type?: EntityType
): EntitySummary[] {
  if (type) {
    return db
      .prepare(
        "SELECT id, project_id, type, display_name, canonical_name, created_at, updated_at FROM entity WHERE project_id = ? AND type = ? ORDER BY display_name"
      )
      .all(projectId, type) as EntitySummary[];
  }
  return db
    .prepare(
      "SELECT id, project_id, type, display_name, canonical_name, created_at, updated_at FROM entity WHERE project_id = ? ORDER BY display_name"
    )
    .all(projectId) as EntitySummary[];
}

export function getEntityById(db: Database.Database, entityId: string): EntitySummary | null {
  const row = db
    .prepare(
      "SELECT id, project_id, type, display_name, canonical_name, created_at, updated_at FROM entity WHERE id = ?"
    )
    .get(entityId) as EntitySummary | undefined;
  return row ?? null;
}

export function getEntityByAlias(
  db: Database.Database,
  projectId: string,
  alias: string
): EntitySummary | null {
  const aliasNorm = normalizeAlias(alias);
  const row = db
    .prepare(
      "SELECT e.id, e.project_id, e.type, e.display_name, e.canonical_name, e.created_at, e.updated_at FROM entity_alias a JOIN entity e ON e.id = a.entity_id WHERE e.project_id = ? AND a.alias_norm = ?"
    )
    .get(projectId, aliasNorm) as EntitySummary | undefined;
  return row ?? null;
}

export function createEntity(
  db: Database.Database,
  args: { projectId: string; type: EntityType; displayName: string; canonicalName?: string | null }
): EntitySummary {
  const now = Date.now();
  const entity: EntitySummary = {
    id: crypto.randomUUID(),
    project_id: args.projectId,
    type: args.type,
    display_name: args.displayName,
    canonical_name: args.canonicalName ?? null,
    created_at: now,
    updated_at: now
  };

  db.prepare(
    "INSERT INTO entity (id, project_id, type, display_name, canonical_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(
    entity.id,
    entity.project_id,
    entity.type,
    entity.display_name,
    entity.canonical_name,
    entity.created_at,
    entity.updated_at
  );

  addAlias(db, entity.id, entity.display_name);
  return entity;
}

export function addAlias(db: Database.Database, entityId: string, alias: string): void {
  const normalized = normalizeAlias(alias);
  if (!normalized) {
    return;
  }
  const now = Date.now();
  db.prepare(
    "INSERT OR IGNORE INTO entity_alias (id, entity_id, alias, alias_norm, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(crypto.randomUUID(), entityId, alias, normalized, now);
}

export function listAliases(db: Database.Database, entityId: string): string[] {
  const rows = db
    .prepare("SELECT alias FROM entity_alias WHERE entity_id = ? ORDER BY alias")
    .all(entityId) as Array<{ alias: string }>;
  return rows.map((row) => row.alias);
}

export function getOrCreateEntityByName(
  db: Database.Database,
  args: { projectId: string; name: string; type?: EntityType }
): EntitySummary {
  const existing = getEntityByAlias(db, args.projectId, args.name);
  if (existing) {
    return existing;
  }
  return createEntity(db, {
    projectId: args.projectId,
    type: args.type ?? "character",
    displayName: args.name
  });
}

export function deleteEntityIfNoClaims(db: Database.Database, entityId: string): boolean {
  const claims = db
    .prepare("SELECT COUNT(*) as count FROM claim WHERE entity_id = ?")
    .get(entityId) as { count: number } | undefined;
  if ((claims?.count ?? 0) > 0) {
    return false;
  }
  db.prepare("DELETE FROM entity_alias WHERE entity_id = ?").run(entityId);
  const result = db.prepare("DELETE FROM entity WHERE id = ?").run(entityId);
  return result.changes > 0;
}
