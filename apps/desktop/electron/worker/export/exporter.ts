import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import {
  getChunkById,
  getDocumentById,
  getEntityById,
  getProjectById,
  listClaimsForEntity,
  listDocuments,
  listEntities,
  listEvidenceForClaim,
  listSceneEvidence,
  listScenesForProject,
  listStyleMetrics
} from "../storage";

type Citation = { chunkId: string; quoteStart: number; quoteEnd: number };

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function formatCitation(index: number): string {
  return `[^c${index}]`;
}

function buildCitationFootnotes(
  db: Database.Database,
  citations: Citation[]
): { footnotes: string; refs: string[] } {
  const refs: string[] = [];
  const lines: string[] = [];
  citations.forEach((citation, idx) => {
    const chunk = getChunkById(db, citation.chunkId);
    const doc = chunk ? getDocumentById(db, chunk.document_id) : null;
    const quote = chunk ? chunk.text.slice(citation.quoteStart, citation.quoteEnd) : "";
    const label = formatCitation(idx + 1);
    refs.push(label);
    lines.push(`${label}: ${doc?.path ?? "unknown"} (chunk ${chunk?.ordinal ?? "?"}) — "${quote}"`);
  });

  return { footnotes: lines.join("\n"), refs };
}

function listSceneEntities(db: Database.Database, sceneId: string): string[] {
  const rows = db
    .prepare("SELECT entity_id FROM scene_entity WHERE scene_id = ?")
    .all(sceneId) as Array<{ entity_id: string }>;
  return rows
    .map((row) => getEntityById(db, row.entity_id))
    .filter((entity): entity is NonNullable<typeof entity> => Boolean(entity))
    .map((entity) => entity.display_name);
}

function buildSceneEvidence(db: Database.Database, sceneId: string): Citation[] {
  const evidence = listSceneEvidence(db, sceneId).map((row) => ({
    chunkId: row.chunk_id,
    quoteStart: row.quote_start,
    quoteEnd: row.quote_end
  }));
  if (evidence.length > 0) return evidence;

  const chunkRow = db
    .prepare("SELECT start_chunk_id FROM scene WHERE id = ?")
    .get(sceneId) as { start_chunk_id: string } | undefined;
  if (!chunkRow) return [];
  const chunk = getChunkById(db, chunkRow.start_chunk_id);
  if (!chunk) return [];
  const end = Math.min(chunk.text.length, 120);
  if (end === 0) return [];
  return [{ chunkId: chunk.id, quoteStart: 0, quoteEnd: end }];
}

function listIssuesByType(db: Database.Database, projectId: string, type: string): Array<{
  id: string;
  title: string;
  description: string;
}> {
  return db
    .prepare("SELECT id, title, description FROM issue WHERE project_id = ? AND type = ?")
    .all(projectId, type) as Array<{ id: string; title: string; description: string }>;
}

function listIssueEvidence(db: Database.Database, issueId: string): Citation[] {
  return db
    .prepare("SELECT chunk_id as chunkId, quote_start as quoteStart, quote_end as quoteEnd FROM issue_evidence WHERE issue_id = ?")
    .all(issueId) as Citation[];
}

export function exportProject(
  db: Database.Database,
  projectId: string,
  outDir: string,
  kind: "md" | "json" | "all" = "all"
): void {
  ensureDir(outDir);

  const project = getProjectById(db, projectId);
  const entities = listEntities(db, projectId);
  const scenes = listScenesForProject(db, projectId);
  const styleMetrics = listStyleMetrics(db, { projectId });

  const bibleLines: string[] = ["# Bible", ""]; 
  for (const entity of entities) {
    bibleLines.push(`## ${entity.display_name} (${entity.type})`);
    const claims = listClaimsForEntity(db, entity.id)
      .map((claim) => ({
        claim,
        evidence: listEvidenceForClaim(db, claim.id).map((row) => ({
          chunkId: row.chunk_id,
          quoteStart: row.quote_start,
          quoteEnd: row.quote_end
        }))
      }))
      .filter((entry) => entry.evidence.length > 0);

    if (claims.length === 0) {
      bibleLines.push("- No evidence-backed claims yet.");
      bibleLines.push("");
      continue;
    }

    for (const entry of claims) {
      const { footnotes, refs } = buildCitationFootnotes(db, entry.evidence);
      const value = entry.claim.value_json;
      bibleLines.push(`- ${entry.claim.field}: ${value} ${refs.join(" ")}`.trim());
      if (footnotes) {
        bibleLines.push(footnotes);
      }
    }
    bibleLines.push("");
  }

  if (kind === "md" || kind === "all") {
    fs.writeFileSync(path.join(outDir, "bible.md"), bibleLines.join("\n"));
  }

  const sceneLines: string[] = ["# Scenes", ""]; 
  for (const scene of scenes) {
    const povEntity = scene.pov_entity_id ? getEntityById(db, scene.pov_entity_id) : null;
    const settingEntity = scene.setting_entity_id ? getEntityById(db, scene.setting_entity_id) : null;
    const povLabel = povEntity ? `${scene.pov_mode} (${povEntity.display_name})` : scene.pov_mode;
    const settingLabel = settingEntity ? settingEntity.display_name : scene.setting_text ?? "unknown";
    const characters = listSceneEntities(db, scene.id);
    const evidence = buildSceneEvidence(db, scene.id);
    const { footnotes, refs } = buildCitationFootnotes(db, evidence);

    sceneLines.push(
      `- Scene ${scene.ordinal}: ${scene.title ?? "Untitled"} (POV: ${povLabel}, Setting: ${settingLabel}) ${refs.join(" ")}`.trim()
    );
    sceneLines.push(`Characters: ${characters.length > 0 ? characters.join(", ") : "unknown"}`);
    if (footnotes) {
      sceneLines.push(footnotes);
    }
    sceneLines.push("");
  }
  if (kind === "md" || kind === "all") {
    fs.writeFileSync(path.join(outDir, "scenes.md"), sceneLines.join("\n"));
  }

  const styleLines: string[] = ["# Style Report", ""]; 
  const repetitionMetric = styleMetrics.find((metric) => metric.metric_name === "ngram_freq");
  if (repetitionMetric) {
    const parsed = JSON.parse(repetitionMetric.metric_json) as {
      top?: Array<{
        ngram: string;
        count: number;
        examples?: Array<{ chunkId: string; quoteStart: number; quoteEnd: number }>;
      }>;
    };
    styleLines.push("## Repetition");
    if (parsed.top && parsed.top.length > 0) {
      parsed.top.slice(0, 10).forEach((entry) => {
        const evidence = entry.examples?.[0]
          ? [{
              chunkId: entry.examples[0].chunkId,
              quoteStart: entry.examples[0].quoteStart,
              quoteEnd: entry.examples[0].quoteEnd
            }]
          : [];
        const { footnotes, refs } = buildCitationFootnotes(db, evidence);
        styleLines.push(`- "${entry.ngram}" (${entry.count}) ${refs.join(" ")}`.trim());
        if (footnotes) {
          styleLines.push(footnotes);
        }
      });
    } else {
      styleLines.push("- No repetition metrics available.");
    }
    styleLines.push("");
  }

  const toneIssues = listIssuesByType(db, projectId, "tone_drift");
  if (toneIssues.length > 0) {
    styleLines.push("## Tone Drift Issues");
    for (const issue of toneIssues) {
      const evidence = listIssueEvidence(db, issue.id);
      const { footnotes, refs } = buildCitationFootnotes(db, evidence);
      styleLines.push(`- ${issue.title} ${refs.join(" ")}`.trim());
      if (footnotes) {
        styleLines.push(footnotes);
      }
    }
    styleLines.push("");
  }

  const dialogueIssues = listIssuesByType(db, projectId, "dialogue_tic");
  if (dialogueIssues.length > 0) {
    styleLines.push("## Dialogue Tic Issues");
    for (const issue of dialogueIssues) {
      const evidence = listIssueEvidence(db, issue.id);
      const { footnotes, refs } = buildCitationFootnotes(db, evidence);
      styleLines.push(`- ${issue.title} ${refs.join(" ")}`.trim());
      if (footnotes) {
        styleLines.push(footnotes);
      }
    }
    styleLines.push("");
  }

  if (styleLines.length === 2) {
    styleLines.push("No style metrics available.");
  }

  if (kind === "md" || kind === "all") {
    fs.writeFileSync(path.join(outDir, "style_report.md"), styleLines.join("\n"));
  }

  const documents = listDocuments(db, projectId);
  const snapshots = db
    .prepare(
      "SELECT id, document_id, version, full_text, full_text_hash, created_at FROM document_snapshot WHERE document_id IN (SELECT id FROM document WHERE project_id = ?)"
    )
    .all(projectId);
  const chunks = db
    .prepare(
      "SELECT id, document_id, ordinal, text, text_hash, start_char, end_char, created_at, updated_at FROM chunk WHERE document_id IN (SELECT id FROM document WHERE project_id = ?)"
    )
    .all(projectId);
  const aliases = db
    .prepare(
      "SELECT id, entity_id, alias, alias_norm, created_at FROM entity_alias WHERE entity_id IN (SELECT id FROM entity WHERE project_id = ?)"
    )
    .all(projectId);
  const claims = db
    .prepare(
      "SELECT id, entity_id, field, value_json, status, confidence, created_at, updated_at, supersedes_claim_id FROM claim WHERE entity_id IN (SELECT id FROM entity WHERE project_id = ?)"
    )
    .all(projectId);
  const claimEvidence = db
    .prepare(
      "SELECT id, claim_id, chunk_id, quote_start, quote_end, created_at FROM claim_evidence WHERE claim_id IN (SELECT id FROM claim WHERE entity_id IN (SELECT id FROM entity WHERE project_id = ?))"
    )
    .all(projectId);
  const sceneMetadata = db
    .prepare(
      "SELECT scene_id, pov_mode, pov_entity_id, pov_confidence, setting_entity_id, setting_text, setting_confidence, time_context_text, created_at, updated_at FROM scene_metadata WHERE scene_id IN (SELECT id FROM scene WHERE project_id = ?)"
    )
    .all(projectId);
  const sceneEntities = db
    .prepare(
      "SELECT id, scene_id, entity_id, role, confidence, created_at FROM scene_entity WHERE scene_id IN (SELECT id FROM scene WHERE project_id = ?)"
    )
    .all(projectId);
  const sceneEvidence = db
    .prepare(
      "SELECT id, scene_id, chunk_id, quote_start, quote_end, created_at FROM scene_evidence WHERE scene_id IN (SELECT id FROM scene WHERE project_id = ?)"
    )
    .all(projectId);
  const issues = db
    .prepare(
      "SELECT id, project_id, type, severity, title, description, status, created_at, updated_at FROM issue WHERE project_id = ?"
    )
    .all(projectId);
  const issueEvidence = db
    .prepare(
      "SELECT id, issue_id, chunk_id, quote_start, quote_end, created_at FROM issue_evidence WHERE issue_id IN (SELECT id FROM issue WHERE project_id = ?)"
    )
    .all(projectId);
  const eventLog = db
    .prepare(
      "SELECT id, project_id, ts, level, event_type, payload_json FROM event_log WHERE project_id = ? ORDER BY ts"
    )
    .all(projectId);

  const projectDump = {
    project,
    documents,
    snapshots,
    chunks,
    entities,
    aliases,
    claims,
    claimEvidence,
    scenes,
    sceneMetadata,
    sceneEntities,
    sceneEvidence,
    issues,
    issueEvidence,
    styleMetrics,
    eventLog
  };
  if (kind === "json" || kind === "all") {
    fs.writeFileSync(path.join(outDir, "project.json"), JSON.stringify(projectDump, null, 2));
  }
}
