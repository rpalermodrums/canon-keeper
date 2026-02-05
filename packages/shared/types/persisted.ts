/* eslint-disable @typescript-eslint/no-explicit-any */

export type ID = string;
export type UnixMillis = number;
export type Sha256 = string;
export type Json = JsonValue;

export type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { [k: string]: JsonValue };
export type JsonArray = JsonValue[];
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

/**
 * Table: project
 */
export interface ProjectRow {
  id: ID;
  root_path: string;
  name: string;
  created_at: UnixMillis;
  updated_at: UnixMillis;
}

/**
 * Table: document
 */
export type DocumentKind = "md" | "txt" | "docx";

export interface DocumentRow {
  id: ID;
  project_id: ID;
  path: string;
  kind: DocumentKind;
  created_at: UnixMillis;
  updated_at: UnixMillis;
  is_missing: number;
  last_seen_at: UnixMillis | null;
}

/**
 * Table: document_snapshot
 * - Full text snapshot for a document version. Optional but recommended.
 */
export interface DocumentSnapshotRow {
  id: ID;
  document_id: ID;
  version: number;
  full_text: string;
  full_text_hash: Sha256;
  created_at: UnixMillis;
}

/**
 * Table: chunk
 */
export interface ChunkRow {
  id: ID;
  document_id: ID;
  ordinal: number;
  text: string;
  text_hash: Sha256;
  start_char: number; // within document_snapshot.full_text for the current version
  end_char: number; // exclusive
  created_at: UnixMillis;
  updated_at: UnixMillis;
}

/**
 * Table: chunk_fts (FTS virtual)
 * - Not a "row" in the same sense; but for indexing.
 */
export interface ChunkFtsRow {
  chunk_id: ID;
  text: string;
}

/**
 * Table: entity
 */
export type EntityType = "character" | "location" | "org" | "artifact" | "term" | "rule";

export interface EntityRow {
  id: ID;
  project_id: ID;
  type: EntityType;
  display_name: string;
  canonical_name: string | null;
  created_at: UnixMillis;
  updated_at: UnixMillis;
}

/**
 * Table: entity_alias
 */
export interface EntityAliasRow {
  id: ID;
  entity_id: ID;
  alias: string;
  alias_norm: string;
  created_at: UnixMillis;
}

/**
 * Table: claim
 * - Claims are versionable, evidence-backed facts.
 */
export type ClaimStatus = "inferred" | "confirmed" | "rejected" | "superseded";

/**
 * Claim field is intentionally open-ended for fiction projects.
 * Examples: 'age', 'eye_color', 'hair_color', 'relationship', 'description', 'goal', 'rule', 'first_appearance'
 */
export type ClaimField = string;

export interface ClaimRow {
  id: ID;
  entity_id: ID;
  field: ClaimField;
  value_json: string; // JSON string of ClaimValue
  status: ClaimStatus;
  confidence: number; // 0..1
  created_at: UnixMillis;
  updated_at: UnixMillis;
  supersedes_claim_id: ID | null;
}

/**
 * Parsed claim value helper (not persisted directly; useful in app code)
 */
export type ClaimValue = JsonObject | JsonArray | JsonPrimitive;

/**
 * Table: claim_evidence
 */
export interface ClaimEvidenceRow {
  id: ID;
  claim_id: ID;
  chunk_id: ID;
  quote_start: number; // char offset within chunk.text
  quote_end: number; // exclusive
  created_at: UnixMillis;
}

/**
 * Table: scene
 */
export interface SceneRow {
  id: ID;
  project_id: ID;
  document_id: ID;
  ordinal: number;
  start_chunk_id: ID;
  end_chunk_id: ID;
  start_char: number; // within current document snapshot
  end_char: number; // exclusive
  title: string | null;
  created_at: UnixMillis;
  updated_at: UnixMillis;
}

/**
 * Table: scene_metadata
 */
export type PovMode = "first" | "third_limited" | "omniscient" | "epistolary" | "unknown";

export interface SceneMetadataRow {
  scene_id: ID;
  pov_mode: PovMode;
  pov_entity_id: ID | null;
  pov_confidence: number; // 0..1
  setting_entity_id: ID | null;
  setting_text: string | null;
  setting_confidence: number; // 0..1
  time_context_text: string | null;
  created_at: UnixMillis;
  updated_at: UnixMillis;
}

/**
 * Table: scene_entity
 */
export type SceneEntityRole = "present" | "mentioned" | "setting";

export interface SceneEntityRow {
  id: ID;
  scene_id: ID;
  entity_id: ID;
  role: SceneEntityRole;
  confidence: number; // 0..1
  created_at: UnixMillis;
}

/**
 * Table: scene_evidence
 */
export interface SceneEvidenceRow {
  id: ID;
  scene_id: ID;
  chunk_id: ID;
  quote_start: number;
  quote_end: number;
  created_at: UnixMillis;
}

/**
 * Table: issue
 */
export type IssueType =
  | "continuity"
  | "pov_ambiguous"
  | "tone_drift"
  | "repetition"
  | "dialogue_tic";

export type IssueSeverity = "low" | "medium" | "high";
export type IssueStatus = "open" | "dismissed" | "resolved";

export interface IssueRow {
  id: ID;
  project_id: ID;
  type: IssueType;
  severity: IssueSeverity;
  title: string;
  description: string;
  status: IssueStatus;
  created_at: UnixMillis;
  updated_at: UnixMillis;
}

/**
 * Table: issue_evidence
 */
export interface IssueEvidenceRow {
  id: ID;
  issue_id: ID;
  chunk_id: ID;
  quote_start: number;
  quote_end: number;
  created_at: UnixMillis;
}

/**
 * Table: style_metric
 */
export type StyleScopeType = "project" | "document" | "scene" | "entity";

export type StyleMetricName = "ngram_freq" | "tone_vector" | "dialogue_tics";

export interface StyleMetricRow {
  id: ID;
  project_id: ID;
  scope_type: StyleScopeType;
  scope_id: ID; // depends on scope_type
  metric_name: StyleMetricName;
  metric_json: string; // JSON string for metric payload
  created_at: UnixMillis;
  updated_at: UnixMillis;
}

/**
 * Table: job_queue
 */
export type JobQueueStatus = "queued" | "running" | "failed";

export interface JobQueueRow {
  id: ID;
  project_id: ID;
  type: string;
  payload_json: string;
  dedupe_key: string;
  status: JobQueueStatus;
  attempts: number;
  next_run_at: UnixMillis;
  created_at: UnixMillis;
  updated_at: UnixMillis;
}

/**
 * Table: document_processing_state
 */
export type ProcessingStatus = "pending" | "ok" | "failed";

export interface ProcessingStateRow {
  document_id: ID;
  snapshot_id: ID;
  stage: string;
  status: ProcessingStatus;
  error: string | null;
  updated_at: UnixMillis;
}

/**
 * Table: event_log
 */
export type LogLevel = "info" | "warn" | "error";

export interface EventLogRow {
  id: ID;
  project_id: ID;
  ts: UnixMillis;
  level: LogLevel;
  event_type: string;
  payload_json: string; // JSON string; do not include manuscript text by default
}

/**
 * Convenience "hydrated" types for UI/API
 */
export interface EvidenceSpan {
  chunkId: ID;
  quoteStart: number;
  quoteEnd: number;
}

export interface ClaimWithEvidence {
  claim: ClaimRow;
  value: ClaimValue; // parsed from value_json
  evidence: EvidenceSpan[];
}

export interface IssueWithEvidence {
  issue: IssueRow;
  evidence: EvidenceSpan[];
}
