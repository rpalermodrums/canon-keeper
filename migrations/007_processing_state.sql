BEGIN;

CREATE TABLE document_processing_state (
  document_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(document_id) REFERENCES document(id)
);

CREATE UNIQUE INDEX idx_processing_state_doc_stage ON document_processing_state(document_id, stage);
CREATE INDEX idx_processing_state_snapshot ON document_processing_state(snapshot_id);

COMMIT;
