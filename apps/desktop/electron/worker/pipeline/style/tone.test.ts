import { describe, expect, it } from "vitest";
import { computeToneMetrics } from "./tone";
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

describe("tone metrics", () => {
  it("computes drift scores relative to baseline", () => {
    const chunks = [
      chunk({ id: "c1", ordinal: 0, text: "I go. I go. I go." }),
      chunk({
        id: "c2",
        ordinal: 1,
        text:
          "This is a long sentence with many clauses, commas, and a dash—plus another sentence that keeps going without stopping."
      })
    ];

    const scenes = [
      scene({ id: "s1", start_chunk_id: "c1", end_chunk_id: "c1" }),
      scene({ id: "s2", ordinal: 1, start_chunk_id: "c2", end_chunk_id: "c2" })
    ];

    const metrics = computeToneMetrics(scenes, chunks, 1);
    expect(metrics.length).toBe(2);
    expect(metrics[1]?.driftScore).toBeGreaterThan(0);
  });
});
