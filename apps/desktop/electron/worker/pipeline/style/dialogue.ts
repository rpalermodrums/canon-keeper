import type { ChunkRecord } from "../../storage/chunkRepo";
import { normalizeAlias } from "../../../../../../packages/shared/utils/normalize";
export type DialogueLine = {
  chunkId: string;
  text: string;
  quoteStart: number;
  quoteEnd: number;
  speaker: string | null;
};

export type DialogueTic = {
  speaker: string;
  totalLines: number;
  starters: Array<{ phrase: string; count: number }>;
  fillers: Array<{ filler: string; count: number }>;
  ellipsesCount: number;
  dashCount: number;
  examples: Array<{ chunkId: string; quoteStart: number; quoteEnd: number }>;
};

export type DialogueExtractOptions = {
  knownSpeakers?: string[];
};

const SPEAKER_VERBS = [
  "said",
  "asked",
  "whispered",
  "replied",
  "muttered",
  "shouted",
  "called",
  "yelled",
  "cried",
  "answered",
  "murmured",
  "sighed",
  "snapped",
  "added",
  "remarked",
  "laughed",
  "grumbled"
];

const FILLERS = ["well", "look", "listen", "like", "you know", "okay"];

type SpeakerCandidate = { name: string; distance: number };

function collectCandidates(
  text: string,
  regex: RegExp,
  distanceFromEnd: boolean
): SpeakerCandidate[] {
  const matches = Array.from(text.matchAll(regex));
  return matches
    .map((match) => {
      if (!match[1] || match.index === undefined) return null;
      const end = match.index + match[0].length;
      return {
        name: match[1],
        distance: distanceFromEnd ? text.length - end : match.index
      };
    })
    .filter((value): value is SpeakerCandidate => Boolean(value));
}

function pickClosestCandidate(
  candidates: SpeakerCandidate[],
  knownSet?: Set<string>
): string | null {
  if (candidates.length === 0) return null;

  const normalized = (name: string) => normalizeAlias(name);
  let preferred = candidates;
  if (knownSet && knownSet.size > 0) {
    const knownCandidates = candidates.filter((candidate) => knownSet.has(normalized(candidate.name)));
    if (knownCandidates.length > 0) {
      preferred = knownCandidates;
    }
  }

  const sorted = preferred.sort((a, b) => a.distance - b.distance);
  return sorted[0]?.name ?? null;
}

function findSpeaker(
  text: string,
  quoteStart: number,
  quoteEnd: number,
  knownSet?: Set<string>
): string | null {
  const windowSize = 160;
  const windowStart = Math.max(0, quoteStart - windowSize);
  const windowEnd = Math.min(text.length, quoteEnd + windowSize);
  const before = text.slice(windowStart, quoteStart);
  const after = text.slice(quoteEnd, windowEnd);

  const namePattern = "[A-Z][A-Za-z'\\-]+(?:\\s+[A-Z][A-Za-z'\\-]+)*";
  const verbs = SPEAKER_VERBS.join("|");

  const beforeNameVerb = new RegExp(`(${namePattern})\\s+(?:${verbs})\\b`, "g");
  const beforeVerbName = new RegExp(`(?:${verbs})\\s+(${namePattern})\\b`, "g");
  const afterVerbName = new RegExp(`(?:${verbs})\\s+(${namePattern})\\b`, "g");
  const afterNameVerb = new RegExp(`(${namePattern})\\s+(?:${verbs})\\b`, "g");

  const candidates = [
    ...collectCandidates(before, beforeNameVerb, true),
    ...collectCandidates(before, beforeVerbName, true),
    ...collectCandidates(after, afterVerbName, false),
    ...collectCandidates(after, afterNameVerb, false)
  ];

  return pickClosestCandidate(candidates, knownSet);
}

export function extractDialogueLines(
  chunks: ChunkRecord[],
  options: DialogueExtractOptions = {}
): DialogueLine[] {
  const lines: DialogueLine[] = [];
  const quoteRegex = /(["“”])([^"“”]+)\1/g;
  const knownSet =
    options.knownSpeakers && options.knownSpeakers.length > 0
      ? new Set(options.knownSpeakers.map((name) => normalizeAlias(name)))
      : undefined;

  for (const chunk of chunks) {
    let match: RegExpExecArray | null = null;
    let lastSpeaker: string | null = null;
    let lastQuoteEnd = 0;
    while ((match = quoteRegex.exec(chunk.text))) {
      const full = match[0];
      const inner = match[2]?.trim() ?? "";
      if (!inner) continue;
      const quoteStart = match.index;
      const quoteEnd = match.index + full.length;
      let speaker = findSpeaker(chunk.text, quoteStart, quoteEnd, knownSet);
      const interstitial = chunk.text.slice(lastQuoteEnd, quoteStart).trim();
      if (!speaker && lastSpeaker && interstitial.length < 60) {
        speaker = lastSpeaker;
      }
      if (speaker) {
        lastSpeaker = speaker;
      }
      lastQuoteEnd = quoteEnd;
      lines.push({
        chunkId: chunk.id,
        text: inner,
        quoteStart,
        quoteEnd,
        speaker
      });
    }
  }

  return lines;
}

export function computeDialogueTics(lines: DialogueLine[]): DialogueTic[] {
  const bySpeaker = new Map<string, { displayName: string; lines: DialogueLine[] }>();
  for (const line of lines) {
    if (!line.speaker) {
      continue;
    }
    const key = normalizeAlias(line.speaker);
    const entry = bySpeaker.get(key) ?? { displayName: line.speaker, lines: [] };
    entry.lines.push(line);
    bySpeaker.set(key, entry);
  }

  const tics: DialogueTic[] = [];
  for (const entry of bySpeaker.values()) {
    const speaker = entry.displayName;
    const speakerLines = entry.lines;
    const starterCounts = new Map<string, number>();
    const fillerCounts = new Map<string, number>();
    let ellipses = 0;
    let dashes = 0;
    const examples: Array<{ chunkId: string; quoteStart: number; quoteEnd: number }> = [];

    for (const line of speakerLines) {
      const words = line.text.split(/\s+/).filter(Boolean);
      const starter = words.slice(0, 3).join(" ").toLowerCase();
      if (starter) {
        starterCounts.set(starter, (starterCounts.get(starter) ?? 0) + 1);
      }

      for (const filler of FILLERS) {
        if (line.text.toLowerCase().includes(filler)) {
          fillerCounts.set(filler, (fillerCounts.get(filler) ?? 0) + 1);
        }
      }

      if (line.text.includes("...") || line.text.includes("…")) {
        ellipses += 1;
      }
      if (line.text.includes("—") || line.text.includes("--")) {
        dashes += 1;
      }

      if (examples.length < 3) {
        examples.push({ chunkId: line.chunkId, quoteStart: line.quoteStart, quoteEnd: line.quoteEnd });
      }
    }

    tics.push({
      speaker,
      totalLines: speakerLines.length,
      starters: Array.from(starterCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([phrase, count]) => ({ phrase, count })),
      fillers: Array.from(fillerCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([filler, count]) => ({ filler, count })),
      ellipsesCount: ellipses,
      dashCount: dashes,
      examples
    });
  }

  return tics;
}

export function mergeDialogueTics(ticsList: DialogueTic[][]): DialogueTic[] {
  const merged = new Map<
    string,
    {
      displayName: string;
      totalLines: number;
      starters: Map<string, number>;
      fillers: Map<string, number>;
      ellipsesCount: number;
      dashCount: number;
      examples: Array<{ chunkId: string; quoteStart: number; quoteEnd: number }>;
    }
  >();

  for (const tics of ticsList) {
    for (const tic of tics) {
      const key = normalizeAlias(tic.speaker);
      const entry = merged.get(key) ?? {
        displayName: tic.speaker,
        totalLines: 0,
        starters: new Map<string, number>(),
        fillers: new Map<string, number>(),
        ellipsesCount: 0,
        dashCount: 0,
        examples: []
      };

      entry.totalLines += tic.totalLines;
      entry.ellipsesCount += tic.ellipsesCount;
      entry.dashCount += tic.dashCount;

      for (const starter of tic.starters) {
        entry.starters.set(starter.phrase, (entry.starters.get(starter.phrase) ?? 0) + starter.count);
      }
      for (const filler of tic.fillers) {
        entry.fillers.set(filler.filler, (entry.fillers.get(filler.filler) ?? 0) + filler.count);
      }
      for (const example of tic.examples) {
        if (entry.examples.length >= 3) break;
        const exists = entry.examples.some(
          (current) =>
            current.chunkId === example.chunkId &&
            current.quoteStart === example.quoteStart &&
            current.quoteEnd === example.quoteEnd
        );
        if (!exists) {
          entry.examples.push(example);
        }
      }

      merged.set(key, entry);
    }
  }

  const result: DialogueTic[] = [];
  for (const entry of merged.values()) {
    result.push({
      speaker: entry.displayName,
      totalLines: entry.totalLines,
      starters: Array.from(entry.starters.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([phrase, count]) => ({ phrase, count })),
      fillers: Array.from(entry.fillers.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([filler, count]) => ({ filler, count })),
      ellipsesCount: entry.ellipsesCount,
      dashCount: entry.dashCount,
      examples: entry.examples
    });
  }

  return result;
}

export function pickDialogueIssues(tics: DialogueTic[]): Array<{
  speaker: string;
  title: string;
  description: string;
  evidence: Array<{ chunkId: string; quoteStart: number; quoteEnd: number }>;
}> {
  const issues: Array<{
    speaker: string;
    title: string;
    description: string;
    evidence: Array<{ chunkId: string; quoteStart: number; quoteEnd: number }>;
  }> = [];

  for (const tic of tics) {
    const frequentStarter = tic.starters.find((starter) => starter.count >= 3);
    if (frequentStarter) {
      issues.push({
        speaker: tic.speaker,
        title: `Dialogue tic: ${tic.speaker}`,
        description: `Starter phrase "${frequentStarter.phrase}" repeats ${frequentStarter.count} times.`,
        evidence: tic.examples
      });
      continue;
    }

    const frequentFiller = tic.fillers.find((filler) => filler.count >= 3);
    if (frequentFiller) {
      issues.push({
        speaker: tic.speaker,
        title: `Dialogue tic: ${tic.speaker}`,
        description: `Filler "${frequentFiller.filler}" repeats ${frequentFiller.count} times.`,
        evidence: tic.examples
      });
    }
  }

  return issues;
}
