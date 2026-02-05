import type Database from "better-sqlite3";
import crypto from "node:crypto";
import type { StyleMetricName, StyleScopeType } from "../../../../../packages/shared/types/persisted";

export type StyleMetricInput = {
  projectId: string;
  scopeType: StyleScopeType;
  scopeId: string;
  metricName: StyleMetricName;
  metricJson: string;
};

export function replaceStyleMetric(db: Database.Database, input: StyleMetricInput): void {
  const now = Date.now();
  db.prepare(
    "DELETE FROM style_metric WHERE project_id = ? AND scope_type = ? AND scope_id = ? AND metric_name = ?"
  ).run(input.projectId, input.scopeType, input.scopeId, input.metricName);

  db.prepare(
    "INSERT INTO style_metric (id, project_id, scope_type, scope_id, metric_name, metric_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    crypto.randomUUID(),
    input.projectId,
    input.scopeType,
    input.scopeId,
    input.metricName,
    input.metricJson,
    now,
    now
  );
}

export function deleteStyleMetricsByName(
  db: Database.Database,
  args: { projectId: string; scopeType?: StyleScopeType; metricName: StyleMetricName }
): void {
  if (args.scopeType) {
    db.prepare("DELETE FROM style_metric WHERE project_id = ? AND scope_type = ? AND metric_name = ?").run(
      args.projectId,
      args.scopeType,
      args.metricName
    );
    return;
  }
  db.prepare("DELETE FROM style_metric WHERE project_id = ? AND metric_name = ?").run(
    args.projectId,
    args.metricName
  );
}

export function listStyleMetrics(
  db: Database.Database,
  args: { projectId: string; scopeType?: StyleScopeType; scopeId?: string }
): Array<{
  id: string;
  project_id: string;
  scope_type: StyleScopeType;
  scope_id: string;
  metric_name: StyleMetricName;
  metric_json: string;
}> {
  const { projectId, scopeType, scopeId } = args;
  if (scopeType && scopeId) {
    return db
      .prepare(
        "SELECT id, project_id, scope_type, scope_id, metric_name, metric_json FROM style_metric WHERE project_id = ? AND scope_type = ? AND scope_id = ?"
      )
      .all(projectId, scopeType, scopeId) as Array<{
      id: string;
      project_id: string;
      scope_type: StyleScopeType;
      scope_id: string;
      metric_name: StyleMetricName;
      metric_json: string;
    }>;
  }

  return db
    .prepare(
      "SELECT id, project_id, scope_type, scope_id, metric_name, metric_json FROM style_metric WHERE project_id = ?"
    )
    .all(projectId) as Array<{
    id: string;
    project_id: string;
    scope_type: StyleScopeType;
    scope_id: string;
    metric_name: StyleMetricName;
    metric_json: string;
  }>;
}
