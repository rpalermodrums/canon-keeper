import { describe, expect, it } from "vitest";
import {
  buildRepetitionMetricFromCounts,
  computeRepetitionMetrics,
  mergeRepetitionCounts,
  type RepetitionCounts
} from "./repetition";
import type { ChunkRecord } from "../../storage/chunkRepo";
import type { SceneSummary } from "../../storage/sceneRepo";

const chunk = (overrides: Partial<ChunkRecord>): ChunkRecord => ({
  id: overrides.id ?? "c1",
  document_id: overrides.document_id ?? "doc",
  ordinal: overrides.ordinal ?? 0,
  text: overrides.text ?? "",
  text_hash: overrides.text_hash ?? "hash",
  start_char: overrides.start_char ?? 0,
  end_char: overrides.end_char ?? 0,
  created_at: overrides.created_at ?? 0,
  updated_at: overrides.updated_at ?? 0
});

const scene = (overrides: Partial<SceneSummary>): SceneSummary => ({
  id: overrides.id ?? "s1",
  project_id: overrides.project_id ?? "proj",
  document_id: overrides.document_id ?? "doc",
  ordinal: overrides.ordinal ?? 0,
  start_chunk_id: overrides.start_chunk_id ?? "c1",
  end_chunk_id: overrides.end_chunk_id ?? "c1",
  start_char: overrides.start_char ?? 0,
  end_char: overrides.end_char ?? 0,
  title: overrides.title ?? null,
  pov_mode: overrides.pov_mode ?? "unknown",
  pov_entity_id: overrides.pov_entity_id ?? null,
  pov_confidence: overrides.pov_confidence ?? null,
  setting_entity_id: overrides.setting_entity_id ?? null,
  setting_text: overrides.setting_text ?? null
});

describe("computeRepetitionMetrics", () => {
  it("detects repeated ngrams", () => {
    const repeated = Array.from({ length: 12 }, () => "cold").join(" ");
    const chunks = [
      chunk({ id: "c1", ordinal: 0, text: `The ${repeated} night was cold and still.` }),
      chunk({ id: "c2", ordinal: 1, text: `Cold winds kept the ${repeated} fire low.` })
    ];
    const scenes = [
      scene({ id: "s1", start_chunk_id: "c1", end_chunk_id: "c1" }),
      scene({ id: "s2", ordinal: 1, start_chunk_id: "c2", end_chunk_id: "c2" })
    ];

    const result = computeRepetitionMetrics(chunks, scenes);
    const top = result.metric.top.map((entry) => entry.ngram);
    expect(top).toContain("cold");
  });

  it("merges repetition counts across documents", () => {
    const a: RepetitionCounts = {
      cold: {
        n: 1,
        count: 2,
        byScene: { s1: 2 },
        example: { chunkId: "c1", quoteStart: 0, quoteEnd: 4 }
      }
    };
    const b: RepetitionCounts = {
      cold: {
        n: 1,
        count: 1,
        byScene: { s2: 1 },
        example: { chunkId: "c2", quoteStart: 10, quoteEnd: 14 }
      }
    };

    const merged = mergeRepetitionCounts([a, b]);
    expect(merged.cold?.count).toBe(3);
    expect(merged.cold?.byScene.s1).toBe(2);
    expect(merged.cold?.byScene.s2).toBe(1);
  });

  it("maps repetition evidence even when manuscript casing differs", () => {
    const chunks = [
      chunk({ id: "c1", ordinal: 0, text: "Cold cold COLD cold cold cold cold cold cold cold cold cold." })
    ];
    const scenes = [scene({ id: "s1", start_chunk_id: "c1", end_chunk_id: "c1" })];
    const result = computeRepetitionMetrics(chunks, scenes);
    const cold = result.metric.top.find((entry) => entry.ngram === "cold");
    expect(cold).toBeTruthy();
    expect((cold?.examples ?? []).length).toBeGreaterThan(0);
  });

  it("issues always have defined ngram and positive count", () => {
    const repeated = Array.from({ length: 12 }, () => "cold").join(" ");
    const chunks = [
      chunk({ id: "c1", ordinal: 0, text: `The ${repeated} night was cold and still.` }),
      chunk({ id: "c2", ordinal: 1, text: `Cold winds kept the ${repeated} fire low.` })
    ];
    const scenes = [
      scene({ id: "s1", start_chunk_id: "c1", end_chunk_id: "c1" }),
      scene({ id: "s2", ordinal: 1, start_chunk_id: "c2", end_chunk_id: "c2" })
    ];

    const result = computeRepetitionMetrics(chunks, scenes);
    expect(result.issues.length).toBeGreaterThan(0);
    for (const issue of result.issues) {
      expect(typeof issue.ngram).toBe("string");
      expect(issue.ngram.length).toBeGreaterThan(0);
      expect(typeof issue.count).toBe("number");
      expect(issue.count).toBeGreaterThan(0);
    }
  });
});

describe("buildRepetitionMetricFromCounts", () => {
  it("never produces undefined or null fields in issues", () => {
    const counts: RepetitionCounts = {
      shadow: {
        n: 1,
        count: 15,
        byScene: { s1: 10, s2: 5 },
        example: { chunkId: "c1", quoteStart: 4, quoteEnd: 10 }
      },
      "dark night": {
        n: 2,
        count: 14,
        byScene: { s1: 8, s2: 6 },
        example: { chunkId: "c2", quoteStart: 0, quoteEnd: 10 }
      },
      whisper: {
        n: 1,
        count: 13,
        byScene: { s1: 7 }
        // no example — should be excluded from issues
      }
    };

    const result = buildRepetitionMetricFromCounts(counts);
    for (const issue of result.issues) {
      expect(issue.ngram).toBeDefined();
      expect(issue.ngram).not.toBe("");
      expect(issue.count).toBeDefined();
      expect(Number.isFinite(issue.count)).toBe(true);
      expect(issue.count).toBeGreaterThan(0);
      expect(issue.chunkId).toBeDefined();
      expect(typeof issue.quoteStart).toBe("number");
      expect(typeof issue.quoteEnd).toBe("number");
    }

    // "whisper" has no example, so should not appear in issues
    const ngrams = result.issues.map((i) => i.ngram);
    expect(ngrams).toContain("shadow");
    expect(ngrams).toContain("dark night");
    expect(ngrams).not.toContain("whisper");
  });
});
