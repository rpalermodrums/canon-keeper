import type { EvidenceItem, IssueSummary, StyleReport } from "../api/ipc";

export type RepetitionExample = {
  chunkId: string;
  quoteStart: number;
  quoteEnd: number;
  documentPath?: string | null;
  chunkOrdinal?: number | null;
  excerpt?: string;
  lineStart?: number | null;
  lineEnd?: number | null;
};

export type RepetitionEntry = {
  ngram: string;
  count: number;
  examples?: RepetitionExample[];
};

export type RepetitionSort = "count" | "ngram";

export function toRepetitionEntries(report: StyleReport | null): RepetitionEntry[] {
  if (!report?.repetition || typeof report.repetition !== "object") return [];
  const top = (report.repetition as { top?: RepetitionEntry[] }).top;
  return Array.isArray(top) ? top : [];
}

export function sortRepetitionEntries(
  entries: readonly RepetitionEntry[],
  sortBy: RepetitionSort
): RepetitionEntry[] {
  return [...entries].sort((a, b) =>
    sortBy === "count" ? b.count - a.count : a.ngram.localeCompare(b.ngram)
  );
}

export function getVisibleRepetitionEntries(
  entries: readonly RepetitionEntry[],
  showAllRepetitions: boolean,
  maxVisible = 20
): RepetitionEntry[] {
  if (showAllRepetitions) {
    return [...entries];
  }
  return entries.slice(0, maxVisible);
}

export function getRepetitionToggleLabel(
  totalEntries: number,
  showAllRepetitions: boolean,
  maxVisible = 20
): string | null {
  if (totalEntries <= maxVisible) return null;
  return showAllRepetitions ? "Show fewer" : `Showing ${maxVisible} of ${totalEntries} phrases. Show all`;
}

export function getMaxRepetitionCount(entries: readonly RepetitionEntry[]): number {
  if (entries.length === 0) return 1;
  return Math.max(...entries.map((entry) => entry.count));
}

export function examplesToEvidenceItems(examples: readonly RepetitionExample[] | undefined): EvidenceItem[] {
  return (examples ?? [])
    .filter((example): example is RepetitionExample => Boolean(example))
    .map((example) => ({
      chunkId: example.chunkId,
      quoteStart: example.quoteStart,
      quoteEnd: example.quoteEnd,
      excerpt: example.excerpt ?? "",
      documentPath: example.documentPath ?? null,
      chunkOrdinal: example.chunkOrdinal ?? null,
      lineStart: example.lineStart ?? null,
      lineEnd: example.lineEnd ?? null
    }));
}

export function partitionStyleIssues(styleIssues: readonly IssueSummary[]): {
  toneIssues: IssueSummary[];
  dialogueIssues: IssueSummary[];
} {
  const toneIssues = styleIssues.filter((issue) => issue.type === "tone_drift");
  const dialogueIssues = styleIssues.filter((issue) => issue.type === "dialogue_tic");
  return { toneIssues, dialogueIssues };
}

export function findSceneEvidenceId(issue: Pick<IssueSummary, "evidence">): string | null {
  const sceneEvidence = issue.evidence.find((evidence) => evidence.sceneId);
  return sceneEvidence?.sceneId ?? null;
}

function stringifyToneValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return value.map((item) => stringifyToneValue(item)).join(", ");
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.map(([key, entryValue]) => `${key}: ${stringifyToneValue(entryValue)}`).join(", ");
  }
  return "unknown";
}

export function formatToneVector(value: unknown): string {
  return stringifyToneValue(value);
}
