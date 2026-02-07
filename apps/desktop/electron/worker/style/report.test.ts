import type Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createDocument,
  createProject,
  insertChunks,
  insertSnapshot,
  openDatabase,
  replaceStyleMetric
} from "../storage";
import { getStyleReport } from "./report";

type StyleReportSetup = {
  rootPath: string;
  db: Database.Database;
  projectId: string;
  documentPath: string;
  chunkId: string;
  fullText: string;
};

type RepetitionPayload = {
  top?: Array<{
    ngram: string;
    n: number;
    count: number;
    byScene?: Array<{ sceneId: string; count: number }>;
    examples?: Array<{
      chunkId: string;
      quoteStart: number;
      quoteEnd: number;
      documentPath?: string | null;
      chunkOrdinal?: number | null;
      excerpt?: string;
      lineStart?: number | null;
      lineEnd?: number | null;
    }>;
  }>;
};

const openDbs: Database.Database[] = [];
const tempRoots: string[] = [];

function setupStyleReport(fullText: string): StyleReportSetup {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "canonkeeper-style-report-"));
  const handle = openDatabase({ rootPath });
  const project = createProject(handle.db, rootPath, "Style Report Tests");
  const documentPath = path.join(rootPath, "chapter-01.md");
  const document = createDocument(handle.db, project.id, documentPath, "md");
  insertSnapshot(handle.db, document.id, fullText, `hash:${fullText.length}`);
  const chunks = insertChunks(handle.db, document.id, [
    {
      document_id: document.id,
      ordinal: 0,
      text: fullText,
      text_hash: `chunk:${fullText.length}`,
      start_char: 0,
      end_char: fullText.length
    }
  ]);
  const chunk = chunks[0];
  if (!chunk) {
    throw new Error("Expected one chunk to be inserted");
  }
  openDbs.push(handle.db);
  tempRoots.push(rootPath);
  return {
    rootPath,
    db: handle.db,
    projectId: project.id,
    documentPath,
    chunkId: chunk.id,
    fullText
  };
}

afterEach(() => {
  for (const db of openDbs) {
    db.close();
  }
  openDbs.length = 0;
  for (const rootPath of tempRoots) {
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
  tempRoots.length = 0;
});

describe("getStyleReport", () => {
  it("maps repetition evidence examples to document locations and excerpts", () => {
    const setup = setupStyleReport("Line one.\nSilver bell rings in the hall.\nLine three.");
    const quote = "Silver bell";
    const quoteStart = setup.fullText.indexOf(quote);
    const quoteEnd = quoteStart + quote.length;

    replaceStyleMetric(setup.db, {
      projectId: setup.projectId,
      scopeType: "project",
      scopeId: setup.projectId,
      metricName: "ngram_freq",
      metricJson: JSON.stringify({
        top: [
          {
            ngram: quote.toLowerCase(),
            n: 2,
            count: 2,
            examples: [{ chunkId: setup.chunkId, quoteStart, quoteEnd }]
          }
        ]
      } satisfies RepetitionPayload)
    });

    const report = getStyleReport(setup.db, setup.projectId);
    expect(report.repetition).not.toBeNull();
    const repetition = report.repetition as RepetitionPayload;
    const example = repetition.top?.[0]?.examples?.[0];

    expect(example).toBeDefined();
    expect(example?.documentPath).toBe(setup.documentPath);
    expect(example?.chunkOrdinal).toBe(0);
    expect(example?.excerpt).toContain("[Silver bell]");
    expect(example?.lineStart).toBe(2);
    expect(example?.lineEnd).toBe(2);
  });

  it("handles missing chunk evidence gracefully without crashing", () => {
    const setup = setupStyleReport("Line one.\nLine two.");

    replaceStyleMetric(setup.db, {
      projectId: setup.projectId,
      scopeType: "project",
      scopeId: setup.projectId,
      metricName: "ngram_freq",
      metricJson: JSON.stringify({
        top: [
          {
            ngram: "ghost phrase",
            n: 2,
            count: 1,
            examples: [{ chunkId: "missing-chunk-id", quoteStart: 0, quoteEnd: 5 }]
          }
        ]
      } satisfies RepetitionPayload)
    });

    const report = getStyleReport(setup.db, setup.projectId);
    const repetition = report.repetition as RepetitionPayload;
    const example = repetition.top?.[0]?.examples?.[0];

    expect(example?.documentPath ?? null).toBeNull();
    expect(example?.chunkOrdinal ?? null).toBeNull();
    expect(example?.excerpt).toBe("");
    expect(example?.lineStart ?? null).toBeNull();
    expect(example?.lineEnd ?? null).toBeNull();
  });

  it("returns null repetition data when no repetition metric exists", () => {
    const setup = setupStyleReport("No ngram metric in this report.");

    replaceStyleMetric(setup.db, {
      projectId: setup.projectId,
      scopeType: "scene",
      scopeId: "scene-1",
      metricName: "tone_vector",
      metricJson: JSON.stringify({ mood: "steady", score: 0.2 })
    });

    const report = getStyleReport(setup.db, setup.projectId);

    expect(report.repetition).toBeNull();
    expect(report.tone).toEqual([{ scopeId: "scene-1", value: { mood: "steady", score: 0.2 } }]);
  });

  it("throws on invalid JSON in repetition metrics and scoped metrics", () => {
    const repetitionSetup = setupStyleReport("Bad repetition JSON.");
    replaceStyleMetric(repetitionSetup.db, {
      projectId: repetitionSetup.projectId,
      scopeType: "project",
      scopeId: repetitionSetup.projectId,
      metricName: "ngram_freq",
      metricJson: "{not-valid-json"
    });

    expect(() => getStyleReport(repetitionSetup.db, repetitionSetup.projectId)).toThrow(SyntaxError);

    const scopedSetup = setupStyleReport("Bad tone JSON.");
    replaceStyleMetric(scopedSetup.db, {
      projectId: scopedSetup.projectId,
      scopeType: "scene",
      scopeId: "scene-x",
      metricName: "tone_vector",
      metricJson: "{also-not-valid-json"
    });

    expect(() => getStyleReport(scopedSetup.db, scopedSetup.projectId)).toThrow(SyntaxError);
  });

  it("assembles a full report containing repetition, tone, and dialogue metrics", () => {
    const setup = setupStyleReport("Mira whispers.\nMira pauses.\nMira whispers again.");
    const quote = "Mira whispers";
    const quoteStart = setup.fullText.indexOf(quote);
    const quoteEnd = quoteStart + quote.length;

    replaceStyleMetric(setup.db, {
      projectId: setup.projectId,
      scopeType: "project",
      scopeId: setup.projectId,
      metricName: "ngram_freq",
      metricJson: JSON.stringify({
        top: [
          {
            ngram: "mira whispers",
            n: 2,
            count: 2,
            byScene: [{ sceneId: "scene-1", count: 2 }],
            examples: [{ chunkId: setup.chunkId, quoteStart, quoteEnd }]
          }
        ]
      } satisfies RepetitionPayload)
    });
    replaceStyleMetric(setup.db, {
      projectId: setup.projectId,
      scopeType: "scene",
      scopeId: "scene-1",
      metricName: "tone_vector",
      metricJson: JSON.stringify({ calm: 0.7, tense: 0.3 })
    });
    replaceStyleMetric(setup.db, {
      projectId: setup.projectId,
      scopeType: "entity",
      scopeId: "entity-mira",
      metricName: "dialogue_tics",
      metricJson: JSON.stringify({ tics: [{ text: "whispers", count: 2 }] })
    });

    const report = getStyleReport(setup.db, setup.projectId);
    const repetition = report.repetition as RepetitionPayload;

    expect(repetition.top?.[0]?.ngram).toBe("mira whispers");
    expect(repetition.top?.[0]?.examples?.[0]?.documentPath).toBe(setup.documentPath);
    expect(report.tone).toEqual([{ scopeId: "scene-1", value: { calm: 0.7, tense: 0.3 } }]);
    expect(report.dialogueTics).toEqual([
      { scopeId: "entity-mira", value: { tics: [{ text: "whispers", count: 2 }] } }
    ]);
  });
});
