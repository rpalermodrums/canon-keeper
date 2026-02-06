import type Database from "better-sqlite3";
import { listStyleMetrics } from "../storage";
import { createEvidenceMapper } from "../utils/evidence";

export type StyleReport = {
  repetition: unknown | null;
  tone: unknown[];
  dialogueTics: unknown[];
};

export function getStyleReport(db: Database.Database, projectId: string): StyleReport {
  const metrics = listStyleMetrics(db, { projectId });
  const mapEvidence = createEvidenceMapper(db);
  const repetitionMetric = metrics.find(
    (metric) => metric.metric_name === "ngram_freq" && metric.scope_type === "project"
  );
  const tone = metrics.filter(
    (metric) => metric.metric_name === "tone_vector" && metric.scope_type === "scene"
  );
  const dialogue = metrics.filter(
    (metric) => metric.metric_name === "dialogue_tics" && metric.scope_type === "entity"
  );

  let repetition: unknown | null = null;
  if (repetitionMetric) {
    const parsed = JSON.parse(repetitionMetric.metric_json) as {
      top?: Array<{
        ngram: string;
        n: number;
        count: number;
        byScene?: Array<{ sceneId: string; count: number }>;
        examples?: Array<{ chunkId: string; quoteStart: number; quoteEnd: number }>;
      }>;
    };
    if (parsed.top) {
      parsed.top = parsed.top.map((entry) => ({
        ...entry,
        examples: (entry.examples ?? []).map((example) => {
          const mapped = mapEvidence({
            chunkId: example.chunkId,
            quoteStart: example.quoteStart,
            quoteEnd: example.quoteEnd
          });
          return {
            ...example,
            documentPath: mapped.documentPath,
            chunkOrdinal: mapped.chunkOrdinal,
            excerpt: mapped.excerpt,
            lineStart: mapped.lineStart,
            lineEnd: mapped.lineEnd
          };
        })
      }));
    }
    repetition = parsed;
  }

  return {
    repetition,
    tone: tone.map((entry) => ({ scopeId: entry.scope_id, value: JSON.parse(entry.metric_json) })),
    dialogueTics: dialogue.map((entry) => ({ scopeId: entry.scope_id, value: JSON.parse(entry.metric_json) }))
  };
}
