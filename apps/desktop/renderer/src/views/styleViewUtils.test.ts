import { describe, expect, it, vi } from "vitest";
import type { IssueSummary, StyleReport } from "../api/ipc";
import {
  examplesToEvidenceItems,
  findSceneEvidenceId,
  formatToneVector,
  getMaxRepetitionCount,
  getRepetitionToggleLabel,
  getVisibleRepetitionEntries,
  partitionStyleIssues,
  sortRepetitionEntries,
  toRepetitionEntries,
  type RepetitionEntry
} from "./styleViewUtils";

function createIssue(overrides: Partial<IssueSummary>): IssueSummary {
  return {
    id: "issue-1",
    project_id: "project-1",
    type: "tone_drift",
    severity: "medium",
    title: "Issue",
    description: "Issue description",
    status: "open",
    created_at: 1,
    updated_at: 1,
    evidence: [],
    ...overrides
  };
}

const REPETITION_ENTRIES: RepetitionEntry[] = [
  {
    ngram: "at the end of",
    count: 8,
    examples: [
      {
        chunkId: "chunk-1",
        quoteStart: 2,
        quoteEnd: 14,
        excerpt: "...at the end of the road...",
        documentPath: "/project/ch1.md",
        chunkOrdinal: 3,
        lineStart: 10,
        lineEnd: 11
      }
    ]
  },
  {
    ngram: "for a moment",
    count: 3,
    examples: [
      {
        chunkId: "chunk-2",
        quoteStart: 4,
        quoteEnd: 16
      }
    ]
  },
  {
    ngram: "before long",
    count: 5
  }
];

describe("toRepetitionEntries", () => {
  it("returns an empty list when repetition payload is unavailable", () => {
    const report: StyleReport = { repetition: null, tone: [], dialogueTics: [] };
    expect(toRepetitionEntries(report)).toEqual([]);
    expect(toRepetitionEntries(null)).toEqual([]);
  });

  it("reads top repetition entries when available", () => {
    const report: StyleReport = {
      repetition: { top: REPETITION_ENTRIES },
      tone: [],
      dialogueTics: []
    };

    expect(toRepetitionEntries(report)).toEqual(REPETITION_ENTRIES);
  });
});

describe("repetition sorting and visibility", () => {
  it("sorts by count descending without mutating the input", () => {
    const original = [...REPETITION_ENTRIES];
    const runSort = vi.fn(sortRepetitionEntries);

    const sorted = runSort(REPETITION_ENTRIES, "count");

    expect(runSort).toHaveBeenCalledTimes(1);
    expect(sorted.map((entry) => entry.ngram)).toEqual(["at the end of", "before long", "for a moment"]);
    expect(REPETITION_ENTRIES).toEqual(original);
  });

  it("sorts by phrase name alphabetically", () => {
    const sorted = sortRepetitionEntries(REPETITION_ENTRIES, "ngram");
    expect(sorted.map((entry) => entry.ngram)).toEqual(["at the end of", "before long", "for a moment"]);
  });

  it("limits visible entries and toggles full view label", () => {
    const entries = Array.from({ length: 25 }, (_, index) => ({ ngram: `p-${index}`, count: index + 1 }));

    expect(getVisibleRepetitionEntries(entries, false).length).toBe(20);
    expect(getVisibleRepetitionEntries(entries, true).length).toBe(25);
    expect(getRepetitionToggleLabel(entries.length, false)).toBe("Showing 20 of 25 phrases. Show all");
    expect(getRepetitionToggleLabel(entries.length, true)).toBe("Show fewer");
    expect(getRepetitionToggleLabel(20, false)).toBeNull();
  });

  it("computes max count with fallback", () => {
    expect(getMaxRepetitionCount(REPETITION_ENTRIES)).toBe(8);
    expect(getMaxRepetitionCount([])).toBe(1);
  });
});

describe("evidence and issue helpers", () => {
  it("maps repetition examples into evidence items with nullable defaults", () => {
    const evidence = examplesToEvidenceItems(REPETITION_ENTRIES[1]?.examples);

    expect(evidence).toEqual([
      {
        chunkId: "chunk-2",
        quoteStart: 4,
        quoteEnd: 16,
        excerpt: "",
        documentPath: null,
        chunkOrdinal: null,
        lineStart: null,
        lineEnd: null
      }
    ]);
  });

  it("partitions style issues into tone and dialogue buckets", () => {
    const issues = [
      createIssue({ id: "tone", type: "tone_drift" }),
      createIssue({ id: "dialogue", type: "dialogue_tic" }),
      createIssue({ id: "other", type: "repetition" })
    ];

    const partitioned = partitionStyleIssues(issues);
    expect(partitioned.toneIssues.map((issue) => issue.id)).toEqual(["tone"]);
    expect(partitioned.dialogueIssues.map((issue) => issue.id)).toEqual(["dialogue"]);
  });

  it("finds scene evidence ids when available", () => {
    const issue = createIssue({
      evidence: [
        {
          chunkId: "chunk-1",
          documentPath: "/project/ch1.md",
          chunkOrdinal: 2,
          quoteStart: 0,
          quoteEnd: 10,
          excerpt: "example",
          lineStart: 1,
          lineEnd: 1
        },
        {
          chunkId: "chunk-2",
          documentPath: "/project/ch1.md",
          chunkOrdinal: 3,
          quoteStart: 10,
          quoteEnd: 20,
          excerpt: "example",
          lineStart: 2,
          lineEnd: 2,
          sceneId: "scene-9"
        }
      ]
    });

    expect(findSceneEvidenceId(issue)).toBe("scene-9");
    expect(findSceneEvidenceId(createIssue({ evidence: [] }))).toBeNull();
  });
});

describe("formatToneVector", () => {
  it("formats scalar, array, and object tone values", () => {
    expect(formatToneVector("tense")).toBe("tense");
    expect(formatToneVector(["tense", "urgent"])).toBe("tense, urgent");
    expect(formatToneVector({ calm: 0.2, tense: 0.8 })).toBe("calm: 0.2, tense: 0.8");
  });
});
