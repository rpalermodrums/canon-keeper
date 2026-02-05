import { describe, expect, it } from "vitest";
import { computeDialogueTics, extractDialogueLines, pickDialogueIssues } from "./dialogue";
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
});
