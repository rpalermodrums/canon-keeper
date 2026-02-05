import type { ChunkRecord } from "../../storage/chunkRepo";
import type { SceneSummary } from "../../storage/sceneRepo";
import { findExactSpan } from "../../../../../../packages/shared/utils/spans";
import { tokenize } from "./utils";

export type RepetitionMetric = {
  top: Array<{
    ngram: string;
    n: number;
    count: number;
    byScene: Array<{ sceneId: string; count: number }>;
    examples: Array<{ chunkId: string; quoteStart: number; quoteEnd: number }>;
  }>;
};

export type RepetitionIssue = {
  ngram: string;
  count: number;
  chunkId: string;
  quoteStart: number;
  quoteEnd: number;
};

export type RepetitionCounts = Record<
  string,
  {
    n: number;
    count: number;
    byScene: Record<string, number>;
    example?: { chunkId: string; quoteStart: number; quoteEnd: number };
  }
>;

const DEFAULT_PROJECT_THRESHOLD = 12;
const DEFAULT_SCENE_THRESHOLD = 3;
const MAX_RESULTS = 50;

function buildSceneIndex(scenes: SceneSummary[], chunks: ChunkRecord[]): Map<string, string> {
  const chunkOrdinalById = new Map(chunks.map((chunk) => [chunk.id, chunk.ordinal]));
  const sceneForChunk = new Map<string, string>();

  for (const scene of scenes) {
    const startOrdinal = chunkOrdinalById.get(scene.start_chunk_id);
    const endOrdinal = chunkOrdinalById.get(scene.end_chunk_id);
    if (startOrdinal === undefined || endOrdinal === undefined) {
      continue;
    }
    for (const chunk of chunks) {
      if (chunk.ordinal >= startOrdinal && chunk.ordinal <= endOrdinal) {
        sceneForChunk.set(chunk.id, scene.id);
      }
    }
  }

  return sceneForChunk;
}

export function computeRepetitionCounts(
  chunks: ChunkRecord[],
  scenes: SceneSummary[]
): RepetitionCounts {
  const sceneIndex = buildSceneIndex(scenes, chunks);
  const counts = new Map<
    string,
    { n: number; count: number; byScene: Map<string, number>; example?: RepetitionIssue }
  >();

  for (const chunk of chunks) {
    const tokens = tokenize(chunk.text);
    for (const n of [1, 2, 3]) {
      for (let i = 0; i <= tokens.length - n; i += 1) {
        const ngram = tokens.slice(i, i + n).join(" ");
        const entry = counts.get(ngram) ?? {
          n,
          count: 0,
          byScene: new Map<string, number>()
        };
        entry.count += 1;
        const sceneId = sceneIndex.get(chunk.id);
        if (sceneId !== undefined) {
          entry.byScene.set(sceneId, (entry.byScene.get(sceneId) ?? 0) + 1);
        }

        if (!entry.example) {
          const span = findExactSpan(chunk.text, ngram);
          if (span) {
            entry.example = {
              ngram,
              count: 0,
              chunkId: chunk.id,
              quoteStart: span.start,
              quoteEnd: span.end
            };
          }
        }

        counts.set(ngram, entry);
      }
    }
  }

  const result: RepetitionCounts = {};
  for (const [ngram, entry] of counts.entries()) {
    result[ngram] = {
      n: entry.n,
      count: entry.count,
      byScene: Object.fromEntries(entry.byScene.entries()),
      example: entry.example
        ? {
            chunkId: entry.example.chunkId,
            quoteStart: entry.example.quoteStart,
            quoteEnd: entry.example.quoteEnd
          }
        : undefined
    };
  }

  return result;
}

export function mergeRepetitionCounts(countsList: RepetitionCounts[]): RepetitionCounts {
  const merged: RepetitionCounts = {};

  for (const counts of countsList) {
    for (const [ngram, entry] of Object.entries(counts)) {
      const existing = merged[ngram] ?? {
        n: entry.n,
        count: 0,
        byScene: {} as Record<string, number>
      };

      existing.count += entry.count;
      for (const [sceneId, sceneCount] of Object.entries(entry.byScene ?? {})) {
        existing.byScene[sceneId] = (existing.byScene[sceneId] ?? 0) + sceneCount;
      }

      if (!existing.example && entry.example) {
        existing.example = entry.example;
      }

      merged[ngram] = existing;
    }
  }

  return merged;
}

export function buildRepetitionMetricFromCounts(
  counts: RepetitionCounts
): { metric: RepetitionMetric; issues: RepetitionIssue[] } {
  const filtered = Object.entries(counts)
    .map(([ngram, entry]) => ({ ngram, ...entry }))
    .filter((entry) => {
      const sceneMax = Math.max(0, ...Object.values(entry.byScene));
      return entry.count >= DEFAULT_PROJECT_THRESHOLD || sceneMax >= DEFAULT_SCENE_THRESHOLD;
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_RESULTS);

  const metric: RepetitionMetric = {
    top: filtered.map((entry) => ({
      ngram: entry.ngram,
      n: entry.n,
      count: entry.count,
      byScene: Object.entries(entry.byScene).map(([sceneId, count]) => ({
        sceneId,
        count
      })),
      examples: entry.example
        ? [
            {
              chunkId: entry.example.chunkId,
              quoteStart: entry.example.quoteStart,
              quoteEnd: entry.example.quoteEnd
            }
          ]
        : []
    }))
  };

  const issues: RepetitionIssue[] = filtered
    .map((entry) => entry.example)
    .filter((example): example is RepetitionIssue => Boolean(example))
    .slice(0, 10);

  for (const issue of issues) {
    const count = counts[issue.ngram]?.count ?? issue.count;
    issue.count = count;
  }

  return { metric, issues };
}

export function computeRepetitionMetrics(
  chunks: ChunkRecord[],
  scenes: SceneSummary[]
): { metric: RepetitionMetric; issues: RepetitionIssue[] } {
  const counts = computeRepetitionCounts(chunks, scenes);
  return buildRepetitionMetricFromCounts(counts);
}
