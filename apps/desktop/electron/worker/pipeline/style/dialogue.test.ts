import { describe, expect, it } from "vitest";
import { computeDialogueTics, extractDialogueLines, mergeDialogueTics, pickDialogueIssues } from "./dialogue";
import type { ChunkRecord } from "../../storage/chunkRepo";

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

describe("dialogue extraction", () => {
  it("extracts dialogue lines with speakers", () => {
    const text =
      'Mira said, "Well, look." Mira said, "Well, look again."';
    const lines = extractDialogueLines([chunk({ text })]);

    expect(lines.length).toBe(2);
    expect(lines[0]?.speaker).toBe("Mira");
    expect(lines[1]?.speaker).toBe("Mira");
  });

  it("computes tics and flags frequent starters", () => {
    const text =
      'Mira said, "Well, look." Mira said, "Well, look." Mira said, "Well, look."';
    const lines = extractDialogueLines([chunk({ text })]);
    const tics = computeDialogueTics(lines);

    expect(tics.length).toBe(1);
    expect(tics[0]?.speaker).toBe("Mira");
    expect(tics[0]?.totalLines).toBe(3);

    const issues = pickDialogueIssues(tics);
    expect(issues.length).toBe(1);
    expect(issues[0]?.speaker).toBe("Mira");
  });

  it("merges dialogue tics across documents", () => {
    const ticsA = [
      {
        speaker: "Mira",
        totalLines: 2,
        starters: [{ phrase: "well look", count: 2 }],
        fillers: [],
        ellipsesCount: 1,
        dashCount: 0,
        examples: [{ chunkId: "c1", quoteStart: 0, quoteEnd: 5 }]
      }
    ];
    const ticsB = [
      {
        speaker: "Mira",
        totalLines: 1,
        starters: [{ phrase: "well look", count: 1 }],
        fillers: [{ filler: "well", count: 1 }],
        ellipsesCount: 0,
        dashCount: 1,
        examples: [{ chunkId: "c2", quoteStart: 10, quoteEnd: 15 }]
      }
    ];

    const merged = mergeDialogueTics([ticsA, ticsB]);
    expect(merged.length).toBe(1);
    expect(merged[0]?.totalLines).toBe(3);
    expect(merged[0]?.starters[0]?.count).toBe(3);
    expect(merged[0]?.fillers[0]?.count).toBe(1);
    expect(merged[0]?.ellipsesCount).toBe(1);
    expect(merged[0]?.dashCount).toBe(1);
  });
});
