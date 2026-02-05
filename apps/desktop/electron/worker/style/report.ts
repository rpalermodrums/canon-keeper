import type Database from "better-sqlite3";
import { getChunkById, getDocumentById, listStyleMetrics } from "../storage";

export type StyleReport = {
  repetition: unknown | null;
  tone: unknown[];
  dialogueTics: unknown[];
};

function buildExcerpt(text: string, start: number, end: number): string {
  const context = 60;
  const prefixStart = Math.max(0, start - context);
  const suffixEnd = Math.min(text.length, end + context);
  const before = text.slice(prefixStart, start);
  const highlight = text.slice(start, end);
  const after = text.slice(end, suffixEnd);
  return `${prefixStart > 0 ? "…" : ""}${before}[${highlight}]${after}${suffixEnd < text.length ? "…" : ""}`;
}

export function getStyleReport(db: Database.Database, projectId: string): StyleReport {
  const metrics = listStyleMetrics(db, { projectId });
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
          const chunk = getChunkById(db, example.chunkId);
          const doc = chunk ? getDocumentById(db, chunk.document_id) : null;
          const excerpt = chunk ? buildExcerpt(chunk.text, example.quoteStart, example.quoteEnd) : "";
          return {
            ...example,
            documentPath: doc?.path ?? null,
            chunkOrdinal: chunk?.ordinal ?? null,
            excerpt
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
