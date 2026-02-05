BEGIN;
PRAGMA foreign_keys=OFF;

CREATE TABLE claim_evidence_new (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  quote_start INTEGER NOT NULL,
  quote_end INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(claim_id) REFERENCES claim(id) ON DELETE CASCADE,
  FOREIGN KEY(chunk_id) REFERENCES chunk(id) ON DELETE CASCADE
);
INSERT INTO claim_evidence_new (id, claim_id, chunk_id, quote_start, quote_end, created_at)
  SELECT id, claim_id, chunk_id, quote_start, quote_end, created_at FROM claim_evidence;
DROP TABLE claim_evidence;
ALTER TABLE claim_evidence_new RENAME TO claim_evidence;
CREATE INDEX idx_evidence_claim ON claim_evidence(claim_id);
CREATE INDEX idx_claim_evidence_chunk ON claim_evidence(chunk_id);

CREATE TABLE issue_evidence_new (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  quote_start INTEGER NOT NULL,
  quote_end INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(issue_id) REFERENCES issue(id) ON DELETE CASCADE,
  FOREIGN KEY(chunk_id) REFERENCES chunk(id) ON DELETE CASCADE
);
INSERT INTO issue_evidence_new (id, issue_id, chunk_id, quote_start, quote_end, created_at)
  SELECT id, issue_id, chunk_id, quote_start, quote_end, created_at FROM issue_evidence;
DROP TABLE issue_evidence;
ALTER TABLE issue_evidence_new RENAME TO issue_evidence;
CREATE INDEX idx_issue_evidence_chunk ON issue_evidence(chunk_id);

CREATE TABLE scene_evidence_new (
  id TEXT PRIMARY KEY,
  scene_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  quote_start INTEGER NOT NULL,
  quote_end INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(scene_id) REFERENCES scene(id) ON DELETE CASCADE,
  FOREIGN KEY(chunk_id) REFERENCES chunk(id) ON DELETE CASCADE
);
INSERT INTO scene_evidence_new (id, scene_id, chunk_id, quote_start, quote_end, created_at)
  SELECT id, scene_id, chunk_id, quote_start, quote_end, created_at FROM scene_evidence;
DROP TABLE scene_evidence;
ALTER TABLE scene_evidence_new RENAME TO scene_evidence;
CREATE INDEX idx_scene_evidence_scene ON scene_evidence(scene_id);
CREATE INDEX idx_scene_evidence_chunk ON scene_evidence(chunk_id);

CREATE TABLE scene_metadata_new (
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
  FOREIGN KEY(scene_id) REFERENCES scene(id) ON DELETE CASCADE
);
INSERT INTO scene_metadata_new (scene_id, pov_mode, pov_entity_id, pov_confidence, setting_entity_id, setting_text, setting_confidence, time_context_text, created_at, updated_at)
  SELECT scene_id, pov_mode, pov_entity_id, pov_confidence, setting_entity_id, setting_text, setting_confidence, time_context_text, created_at, updated_at FROM scene_metadata;
DROP TABLE scene_metadata;
ALTER TABLE scene_metadata_new RENAME TO scene_metadata;

CREATE TABLE scene_entity_new (
  id TEXT PRIMARY KEY,
  scene_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  role TEXT NOT NULL,
  confidence REAL NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(scene_id) REFERENCES scene(id) ON DELETE CASCADE,
  FOREIGN KEY(entity_id) REFERENCES entity(id)
);
INSERT INTO scene_entity_new (id, scene_id, entity_id, role, confidence, created_at)
  SELECT id, scene_id, entity_id, role, confidence, created_at FROM scene_entity;
DROP TABLE scene_entity;
ALTER TABLE scene_entity_new RENAME TO scene_entity;
CREATE INDEX idx_scene_entity_scene ON scene_entity(scene_id);

PRAGMA foreign_keys=ON;
COMMIT;
