import type Database from "better-sqlite3";
import {
  clearIssuesByType,
  deleteIssuesByTypeAndDocument,
  deleteStyleMetricsByName,
  getOrCreateEntityByName,
  insertIssue,
  insertIssueEvidence,
  listAliases,
  listChunksForDocument,
  listDocuments,
  listEntities,
  listScenesForProject,
  listStyleMetrics,
  replaceStyleMetric
} from "../../storage";
import type { ChunkRecord } from "../../storage/chunkRepo";
import type { SceneSummary } from "../../storage/sceneRepo";
import {
  buildRepetitionMetricFromCounts,
  computeRepetitionCounts,
  mergeRepetitionCounts,
  type RepetitionThresholds,
  type RepetitionCounts
} from "./repetition";
import { computeToneBaseline, computeToneMetric, computeToneVector, type ToneVector } from "./tone";
import {
  computeDialogueTics,
  extractDialogueLines,
  mergeDialogueTics,
  pickDialogueIssues,
  type DialogueTic
} from "./dialogue";
import { DEFAULT_STOPWORDS } from "./utils";
import { loadProjectConfig } from "../../config";

const DRIFT_THRESHOLD = 2.5;

export type StyleRunOptions = {
  documentId?: string;
  rootPath?: string;
};

function buildSceneText(scene: SceneSummary, chunks: ChunkRecord[]): string {
  const chunkOrdinalById = new Map(chunks.map((chunk) => [chunk.id, chunk.ordinal]));
  const startOrdinal = chunkOrdinalById.get(scene.start_chunk_id);
  const endOrdinal = chunkOrdinalById.get(scene.end_chunk_id);
  if (startOrdinal === undefined || endOrdinal === undefined) {
    return "";
  }
  return chunks
    .filter((chunk) => chunk.ordinal >= startOrdinal && chunk.ordinal <= endOrdinal)
    .map((chunk) => chunk.text)
    .join("\n");
}

function parseRepetitionCounts(raw: unknown): RepetitionCounts | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const asRecord = raw as Record<string, unknown>;
  if ("counts" in asRecord && asRecord.counts && typeof asRecord.counts === "object") {
    return asRecord.counts as RepetitionCounts;
  }
  if ("top" in asRecord) {
    return null;
  }
  return raw as RepetitionCounts;
}

function parseDialogueMetric(raw: unknown): DialogueTic[] | null {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    return raw as DialogueTic[];
  }
  if (typeof raw === "object" && raw !== null && "tics" in raw) {
    const tics = (raw as { tics?: DialogueTic[] }).tics;
    return Array.isArray(tics) ? tics : null;
  }
  return null;
}

function resolveStopwords(configValue: "default" | string[] | undefined): Set<string> {
  if (configValue === "default" || !configValue) {
    return DEFAULT_STOPWORDS;
  }
  const normalized = configValue.map((word) => word.trim().toLowerCase()).filter(Boolean);
  if (normalized.length === 0) {
    return DEFAULT_STOPWORDS;
  }
  return new Set(normalized);
}

export function runStyleMetrics(
  db: Database.Database,
  projectId: string,
  options: StyleRunOptions = {}
): void {
  const config = options.rootPath ? loadProjectConfig(options.rootPath) : undefined;
  const repetitionThresholds: RepetitionThresholds = {
    projectCount: config?.style.repetitionThreshold.projectCount ?? 12,
    sceneCount: config?.style.repetitionThreshold.sceneCount ?? 3
  };
  const toneBaselineSceneCount = Math.max(1, config?.style.toneBaselineScenes ?? 10);
  const stopwords = resolveStopwords(config?.style.stopwords);

  const documents = listDocuments(db, projectId);
  const scenes = listScenesForProject(db, projectId);
  const targetDocIds = options.documentId ? new Set([options.documentId]) : null;

  const chunksByDoc = new Map<string, ChunkRecord[]>();
  const scenesByDoc = new Map<string, SceneSummary[]>();
  for (const scene of scenes) {
    const list = scenesByDoc.get(scene.document_id) ?? [];
    list.push(scene);
    scenesByDoc.set(scene.document_id, list);
  }

  const getChunks = (docId: string): ChunkRecord[] => {
    const existing = chunksByDoc.get(docId);
    if (existing) return existing;
    const loaded = listChunksForDocument(db, docId);
    chunksByDoc.set(docId, loaded);
    return loaded;
  };

  const allMetrics = listStyleMetrics(db, { projectId });

  // Repetition (per document counts -> merged project metric)
  const docCounts = new Map<string, RepetitionCounts>();
  for (const metric of allMetrics) {
    if (metric.scope_type !== "document" || metric.metric_name !== "ngram_freq") {
      continue;
    }
    try {
      const parsed = JSON.parse(metric.metric_json);
      const counts = parseRepetitionCounts(parsed);
      if (counts) {
        docCounts.set(metric.scope_id, counts);
      }
    } catch {
      // ignore parse failure
    }
  }

  for (const doc of documents) {
    const shouldRecompute = targetDocIds ? targetDocIds.has(doc.id) : true;
    if (!shouldRecompute && docCounts.has(doc.id)) {
      continue;
    }
    const docChunks = getChunks(doc.id);
    const docScenes = scenesByDoc.get(doc.id) ?? [];
    const counts = computeRepetitionCounts(docChunks, docScenes, { stopwords });
    docCounts.set(doc.id, counts);
    replaceStyleMetric(db, {
      projectId,
      scopeType: "document",
      scopeId: doc.id,
      metricName: "ngram_freq",
      metricJson: JSON.stringify({ counts })
    });
  }

  const mergedCounts = mergeRepetitionCounts(
    documents.map((doc) => docCounts.get(doc.id) ?? {})
  );
  const repetition = buildRepetitionMetricFromCounts(mergedCounts, repetitionThresholds);
  replaceStyleMetric(db, {
    projectId,
    scopeType: "project",
    scopeId: projectId,
    metricName: "ngram_freq",
    metricJson: JSON.stringify(repetition.metric)
  });

  clearIssuesByType(db, projectId, "repetition");
  for (const issue of repetition.issues) {
    const created = insertIssue(db, {
      projectId,
      type: "repetition",
      severity: "low",
      title: `Repetition detected: "${issue.ngram}"`,
      description: `Phrase appears ${issue.count} times across the project.`
    });
    insertIssueEvidence(db, {
      issueId: created.id,
      chunkId: issue.chunkId,
      quoteStart: issue.quoteStart,
      quoteEnd: issue.quoteEnd
    });
  }

  // Tone (reuse stored vectors, recompute drift)
  const toneVectors = new Map<string, ToneVector>();
  for (const metric of allMetrics) {
    if (metric.scope_type !== "scene" || metric.metric_name !== "tone_vector") {
      continue;
    }
    try {
      const parsed = JSON.parse(metric.metric_json) as { vector?: ToneVector };
      if (parsed?.vector) {
        toneVectors.set(metric.scope_id, parsed.vector);
      }
    } catch {
      // ignore parse failure
    }
  }

  const baselineScenes = scenes.slice(0, toneBaselineSceneCount);
  const baselineDocIds = new Set(baselineScenes.map((scene) => scene.document_id));
  const updateAll =
    !targetDocIds ||
    Array.from(targetDocIds).some((docId) => baselineDocIds.has(docId));

  const updatedSceneIds = new Set<string>();

  for (const scene of scenes) {
    const shouldRecompute =
      updateAll ||
      (targetDocIds ? targetDocIds.has(scene.document_id) : false) ||
      !toneVectors.has(scene.id);
    if (shouldRecompute) {
      const docChunks = getChunks(scene.document_id);
      toneVectors.set(scene.id, computeToneVector(buildSceneText(scene, docChunks)));
      updatedSceneIds.add(scene.id);
    }
  }

  const baselineVectors = baselineScenes.map((scene) => {
    const existing = toneVectors.get(scene.id);
    if (existing) {
      return existing;
    }
    const docChunks = getChunks(scene.document_id);
    const vector = computeToneVector(buildSceneText(scene, docChunks));
    toneVectors.set(scene.id, vector);
    updatedSceneIds.add(scene.id);
    return vector;
  });
  const baseline = computeToneBaseline(baselineVectors);

  if (updateAll) {
    deleteStyleMetricsByName(db, { projectId, scopeType: "scene", metricName: "tone_vector" });
    clearIssuesByType(db, projectId, "tone_drift");
  } else if (updatedSceneIds.size > 0) {
    const docsToClear = new Set<string>();
    for (const scene of scenes) {
      if (updatedSceneIds.has(scene.id)) {
        docsToClear.add(scene.document_id);
      }
    }
    for (const docId of docsToClear) {
      deleteIssuesByTypeAndDocument(db, projectId, "tone_drift", docId);
    }
  }

  const scenesToScore = updateAll
    ? scenes
    : scenes.filter((scene) => updatedSceneIds.has(scene.id));

  for (const scene of scenesToScore) {
    const vector = toneVectors.get(scene.id) ?? computeToneVector("");
    const metric = computeToneMetric(scene.id, vector, baseline);
    replaceStyleMetric(db, {
      projectId,
      scopeType: "scene",
      scopeId: scene.id,
      metricName: "tone_vector",
      metricJson: JSON.stringify(metric)
    });

    if (metric.driftScore >= DRIFT_THRESHOLD) {
      const docChunks = getChunks(scene.document_id);
      const excerptChunk = docChunks.find((chunk) => chunk.id === scene.start_chunk_id);
      const created = insertIssue(db, {
        projectId,
        type: "tone_drift",
        severity: "medium",
        title: "Tone drift detected",
        description: `Drift score ${metric.driftScore.toFixed(2)} exceeds threshold.`
      });
      if (excerptChunk) {
        const end = Math.min(excerptChunk.text.length, 160);
        insertIssueEvidence(db, {
          issueId: created.id,
          chunkId: excerptChunk.id,
          quoteStart: 0,
          quoteEnd: end
        });
      }
    }
  }

  // Dialogue tics (per document -> merged by speaker)
  const characterEntities = listEntities(db, projectId, "character");
  const knownSpeakers: string[] = [];
  for (const entity of characterEntities) {
    knownSpeakers.push(entity.display_name, ...listAliases(db, entity.id));
  }

  const docTics = new Map<string, DialogueTic[]>();
  for (const metric of allMetrics) {
    if (metric.scope_type !== "document" || metric.metric_name !== "dialogue_tics") {
      continue;
    }
    try {
      const parsed = JSON.parse(metric.metric_json);
      const tics = parseDialogueMetric(parsed);
      if (tics) {
        docTics.set(metric.scope_id, tics);
      }
    } catch {
      // ignore parse failure
    }
  }

  for (const doc of documents) {
    const shouldRecompute = targetDocIds ? targetDocIds.has(doc.id) : true;
    if (!shouldRecompute && docTics.has(doc.id)) {
      continue;
    }
    const docChunks = getChunks(doc.id);
    const dialogueLines = extractDialogueLines(docChunks, { knownSpeakers });
    const tics = computeDialogueTics(dialogueLines);
    docTics.set(doc.id, tics);
    replaceStyleMetric(db, {
      projectId,
      scopeType: "document",
      scopeId: doc.id,
      metricName: "dialogue_tics",
      metricJson: JSON.stringify({ tics })
    });
  }

  const mergedTics = mergeDialogueTics(documents.map((doc) => docTics.get(doc.id) ?? []));
  deleteStyleMetricsByName(db, { projectId, scopeType: "entity", metricName: "dialogue_tics" });
  for (const tic of mergedTics) {
    const entity = getOrCreateEntityByName(db, { projectId, name: tic.speaker, type: "character" });
    replaceStyleMetric(db, {
      projectId,
      scopeType: "entity",
      scopeId: entity.id,
      metricName: "dialogue_tics",
      metricJson: JSON.stringify(tic)
    });
  }

  clearIssuesByType(db, projectId, "dialogue_tic");
  const ticIssues = pickDialogueIssues(mergedTics);
  for (const tic of ticIssues) {
    const created = insertIssue(db, {
      projectId,
      type: "dialogue_tic",
      severity: "low",
      title: tic.title,
      description: tic.description
    });
    for (const evidence of tic.evidence) {
      insertIssueEvidence(db, {
        issueId: created.id,
        chunkId: evidence.chunkId,
        quoteStart: evidence.quoteStart,
        quoteEnd: evidence.quoteEnd
      });
    }
  }
}
