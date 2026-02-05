BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL UNIQUE,
  applied_at INTEGER NOT NULL
);

CREATE TABLE project (
  id TEXT PRIMARY KEY,
  root_path TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE document (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  path TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(project_id) REFERENCES project(id)
);

CREATE TABLE document_snapshot (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  full_text TEXT NOT NULL,
  full_text_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(document_id) REFERENCES document(id)
);

CREATE TABLE chunk (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  text TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  start_char INTEGER NOT NULL,
  end_char INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(document_id) REFERENCES document(id)
);

CREATE INDEX idx_chunk_doc_ordinal ON chunk(document_id, ordinal);
CREATE INDEX idx_chunk_hash ON chunk(text_hash);

CREATE TABLE entity (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  type TEXT NOT NULL,
  display_name TEXT NOT NULL,
  canonical_name TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(project_id) REFERENCES project(id)
);

CREATE TABLE entity_alias (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  alias_norm TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(entity_id) REFERENCES entity(id)
);

CREATE INDEX idx_alias_norm ON entity_alias(alias_norm);

CREATE TABLE claim (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  field TEXT NOT NULL,
  value_json TEXT NOT NULL,
  status TEXT NOT NULL,
  confidence REAL NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  supersedes_claim_id TEXT,
  FOREIGN KEY(entity_id) REFERENCES entity(id)
);

CREATE TABLE claim_evidence (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  quote_start INTEGER NOT NULL,
  quote_end INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(claim_id) REFERENCES claim(id),
  FOREIGN KEY(chunk_id) REFERENCES chunk(id)
);

CREATE INDEX idx_claim_entity_field ON claim(entity_id, field);
CREATE INDEX idx_evidence_claim ON claim_evidence(claim_id);

CREATE TABLE scene (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  start_chunk_id TEXT NOT NULL,
  end_chunk_id TEXT NOT NULL,
  start_char INTEGER NOT NULL,
  end_char INTEGER NOT NULL,
  title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(project_id) REFERENCES project(id),
  FOREIGN KEY(document_id) REFERENCES document(id)
);

CREATE TABLE scene_metadata (
  scene_id TEXT PRIMARY KEY,
  pov_mode TEXT NOT NULL,
  pov_entity_id TEXT,
  pov_confidence REAL NOT NULL,
  setting_entity_id TEXT,
  setting_text TEXT,
  setting_confidence REAL NOT NULL,
  time_context_text TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(scene_id) REFERENCES scene(id)
);

CREATE TABLE scene_entity (
  id TEXT PRIMARY KEY,
  scene_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  role TEXT NOT NULL,
  confidence REAL NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(scene_id) REFERENCES scene(id),
  FOREIGN KEY(entity_id) REFERENCES entity(id)
);

CREATE INDEX idx_scene_doc_ordinal ON scene(document_id, ordinal);

CREATE TABLE issue (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(project_id) REFERENCES project(id)
);

CREATE TABLE issue_evidence (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  quote_start INTEGER NOT NULL,
  quote_end INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(issue_id) REFERENCES issue(id),
  FOREIGN KEY(chunk_id) REFERENCES chunk(id)
);

CREATE TABLE style_metric (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  metric_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(project_id) REFERENCES project(id)
);

CREATE INDEX idx_style_scope ON style_metric(scope_type, scope_id);

COMMIT;
