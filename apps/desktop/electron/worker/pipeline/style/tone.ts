import type { ChunkRecord } from "../../storage/chunkRepo";
import type { SceneSummary } from "../../storage/sceneRepo";
import { sentenceSplit } from "./utils";

export type ToneVector = {
  sentenceLengthMean: number;
  sentenceLengthVar: number;
  dialogueRatio: number;
  punctuationDensity: number;
  sentimentScore: number;
  contractionRatio: number;
};

export type ToneMetric = {
  sceneId: string;
  vector: ToneVector;
  driftScore: number;
  zscores: Record<keyof ToneVector, number>;
};

const POSITIVE = new Set(["bright", "warm", "soft", "gentle", "smile", "hope", "calm"]);
const NEGATIVE = new Set(["dark", "cold", "blood", "fear", "anger", "grim", "storm"]);
const CONTRACTIONS = [/\b\w+'t\b/g, /\b\w+'re\b/g, /\b\w+'ve\b/g, /\b\w+'ll\b/g, /\b\w+'d\b/g];

function countMatches(text: string, regexes: RegExp[]): number {
  return regexes.reduce((sum, regex) => sum + (text.match(regex)?.length ?? 0), 0);
}

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

export function computeToneVector(text: string): ToneVector {
  const sentences = sentenceSplit(text);
  const lengths = sentences.map((sentence) => sentence.split(" ").length);
  const mean = lengths.reduce((sum, len) => sum + len, 0) / Math.max(1, lengths.length);
  const variance =
    lengths.reduce((sum, len) => sum + Math.pow(len - mean, 2), 0) /
    Math.max(1, lengths.length);

  const dialogueChars = (text.match(/["“”]/g)?.length ?? 0) * 1;
  const totalChars = Math.max(1, text.length);
  const dialogueRatio = Math.min(1, dialogueChars / totalChars);

  const punctuationDensity =
    (text.match(/[,:;—-]/g)?.length ?? 0) / Math.max(1, text.split(" ").length);

  const tokens = text.toLowerCase().split(/\s+/);
  const sentimentScore =
    tokens.reduce((score, token) => {
      if (POSITIVE.has(token)) return score + 1;
      if (NEGATIVE.has(token)) return score - 1;
      return score;
    }, 0) / Math.max(1, tokens.length);

  const contractionCount = countMatches(text.toLowerCase(), CONTRACTIONS);
  const contractionRatio = contractionCount / Math.max(1, tokens.length);

  return {
    sentenceLengthMean: mean,
    sentenceLengthVar: variance,
    dialogueRatio,
    punctuationDensity,
    sentimentScore,
    contractionRatio
  };
}

function stats(values: number[]): { mean: number; std: number } {
  const mean = values.reduce((sum, val) => sum + val, 0) / Math.max(1, values.length);
  const variance =
    values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
    Math.max(1, values.length);
  return { mean, std: Math.sqrt(variance) || 1 };
}

export type ToneBaseline = Record<keyof ToneVector, { mean: number; std: number }>;

export function computeToneBaseline(vectors: ToneVector[]): ToneBaseline {
  const features: Array<keyof ToneVector> = [
    "sentenceLengthMean",
    "sentenceLengthVar",
    "dialogueRatio",
    "punctuationDensity",
    "sentimentScore",
    "contractionRatio"
  ];

  const baseline: ToneBaseline = {
    sentenceLengthMean: { mean: 0, std: 1 },
    sentenceLengthVar: { mean: 0, std: 1 },
    dialogueRatio: { mean: 0, std: 1 },
    punctuationDensity: { mean: 0, std: 1 },
    sentimentScore: { mean: 0, std: 1 },
    contractionRatio: { mean: 0, std: 1 }
  };

  for (const feature of features) {
    const values = vectors.map((vector) => vector[feature]);
    baseline[feature] = stats(values);
  }

  return baseline;
}

export function computeToneMetric(sceneId: string, vector: ToneVector, baseline: ToneBaseline): ToneMetric {
  const features: Array<keyof ToneVector> = [
    "sentenceLengthMean",
    "sentenceLengthVar",
    "dialogueRatio",
    "punctuationDensity",
    "sentimentScore",
    "contractionRatio"
  ];

  let sumSquares = 0;
  const zscores: Record<keyof ToneVector, number> = {
    sentenceLengthMean: 0,
    sentenceLengthVar: 0,
    dialogueRatio: 0,
    punctuationDensity: 0,
    sentimentScore: 0,
    contractionRatio: 0
  };

  for (const feature of features) {
    const statsEntry = baseline[feature] ?? { mean: 0, std: 1 };
    const z = (vector[feature] - statsEntry.mean) / statsEntry.std;
    zscores[feature] = z;
    sumSquares += z * z;
  }

  return {
    sceneId,
    vector,
    driftScore: Math.sqrt(sumSquares),
    zscores
  };
}

export function computeToneMetrics(
  scenes: SceneSummary[],
  chunks: ChunkRecord[],
  baselineCount = 10
): ToneMetric[] {
  const vectors = scenes.map((scene) => ({
    sceneId: scene.id,
    vector: computeToneVector(buildSceneText(scene, chunks))
  }));

  const baselineVectors = vectors.slice(0, baselineCount).map((entry) => entry.vector);
  const baseline = computeToneBaseline(baselineVectors);

  return vectors.map((entry) => computeToneMetric(entry.sceneId, entry.vector, baseline));
}
