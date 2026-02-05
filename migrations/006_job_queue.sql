BEGIN;

CREATE TABLE job_queue (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  next_run_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_job_queue_status_next ON job_queue(status, next_run_at);
CREATE INDEX idx_job_queue_project ON job_queue(project_id);

COMMIT;
