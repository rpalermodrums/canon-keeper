import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { hashText } from "../../../../../../packages/shared/utils/hashing";
import { runStyleMetrics } from "./styleRunner";
import {
  createDocument,
  createProject,
  insertChunks,
  listIssues,
  listIssuesWithEvidence,
  listStyleMetrics,
  openDatabase,
  replaceScenesForDocument,
  updateChunk
} from "../../storage";

type ProjectSetup = {
  rootPath: string;
  db: Database.Database;
  projectId: string;
};

type DocumentSetup = {
  documentId: string;
  chunks: Array<{ id: string; ordinal: number; text: string; startChar: number; endChar: number }>;
  scenes: Array<{ id: string; ordinal: number }>;
};

const tempRoots: string[] = [];
const openDbs: Database.Database[] = [];

function setupProject(): ProjectSetup {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "canonkeeper-style-runner-"));
  const handle = openDatabase({ rootPath });
  const project = createProject(handle.db, rootPath, "Style Runner Test");
  tempRoots.push(rootPath);
  openDbs.push(handle.db);
  return { rootPath, db: handle.db, projectId: project.id };
}

function createDocumentWithChunks(
  setup: ProjectSetup,
  args: {
    fileName: string;
    chunks: string[];
    scenes?: Array<{
      ordinal: number;
      startChunkIndex: number;
      endChunkIndex: number;
      title?: string | null;
      customStartChunkId?: string;
      customEndChunkId?: string;
    }>;
  }
): DocumentSetup {
  const document = createDocument(
    setup.db,
    setup.projectId,
    path.join(setup.rootPath, args.fileName),
    "md"
  );

  const inputRows = args.chunks.map((text, ordinal) => {
    const startChar = args.chunks
      .slice(0, ordinal)
      .reduce((sum, chunkText) => sum + chunkText.length + 1, 0);
    return {
      document_id: document.id,
      ordinal,
      text,
      text_hash: hashText(text),
      start_char: startChar,
      end_char: startChar + text.length
    };
  });

  const insertedChunks = insertChunks(setup.db, document.id, inputRows).map((chunk) => ({
    id: chunk.id,
    ordinal: chunk.ordinal,
    text: chunk.text,
    startChar: chunk.start_char,
    endChar: chunk.end_char
  }));

  const sceneInputs =
    args.scenes ??
    [
      {
        ordinal: 0,
        startChunkIndex: 0,
        endChunkIndex: Math.max(0, insertedChunks.length - 1),
        title: null
      }
    ];

  const insertedScenes = replaceScenesForDocument(
    setup.db,
    document.id,
    sceneInputs.map((scene) => {
      const fallbackStart = insertedChunks[scene.startChunkIndex];
      const fallbackEnd = insertedChunks[scene.endChunkIndex];
      if (!fallbackStart || !fallbackEnd) {
        throw new Error("Invalid scene chunk index");
      }
      return {
        project_id: setup.projectId,
        document_id: document.id,
        ordinal: scene.ordinal,
        start_chunk_id: scene.customStartChunkId ?? fallbackStart.id,
        end_chunk_id: scene.customEndChunkId ?? fallbackEnd.id,
        start_char: fallbackStart.startChar,
        end_char: fallbackEnd.endChar,
        title: scene.title ?? null
      };
    })
  ).map((scene) => ({ id: scene.id, ordinal: scene.ordinal }));

  return {
    documentId: document.id,
    chunks: insertedChunks,
    scenes: insertedScenes
  };
}

function getMetricRow(
  db: Database.Database,
  args: { projectId: string; scopeType: string; scopeId: string; metricName: string }
): { id: string; metric_json: string } | null {
  const row = db
    .prepare(
      `SELECT id, metric_json
       FROM style_metric
       WHERE project_id = ? AND scope_type = ? AND scope_id = ? AND metric_name = ?`
    )
    .get(args.projectId, args.scopeType, args.scopeId, args.metricName) as
    | { id: string; metric_json: string }
    | undefined;
  return row ?? null;
}

function insertRawMetric(
  db: Database.Database,
  args: {
    projectId: string;
    scopeType: string;
    scopeId: string;
    metricName: string;
    metricJson: string;
  }
): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO style_metric
      (id, project_id, scope_type, scope_id, metric_name, metric_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    crypto.randomUUID(),
    args.projectId,
    args.scopeType,
    args.scopeId,
    args.metricName,
    args.metricJson,
    now,
    now
  );
}

function getProjectNgramCount(
  db: Database.Database,
  projectId: string,
  ngram: string
): number {
  const row = getMetricRow(db, {
    projectId,
    scopeType: "project",
    scopeId: projectId,
    metricName: "ngram_freq"
  });
  if (!row) {
    return 0;
  }
  const parsed = JSON.parse(row.metric_json) as {
    top?: Array<{ ngram: string; count: number }>;
  };
  const entry = parsed.top?.find((item) => item.ngram === ngram);
  return entry?.count ?? 0;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const db of openDbs) {
    db.close();
  }
  openDbs.length = 0;
  for (const rootPath of tempRoots) {
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
  tempRoots.length = 0;
});

describe("runStyleMetrics", () => {
  it("runs fully on mixed content with dialogue, narration, and an empty scene", () => {
    const setup = setupProject();
    const document = createDocumentWithChunks(setup, {
      fileName: "mixed.md",
      chunks: [
        'Mira said, "Well, look." Mira said, "Well, look." Mira said, "Well, look."',
        "A cold wind crossed the harbor while lanterns shook in silence."
      ],
      scenes: [
        { ordinal: 0, startChunkIndex: 0, endChunkIndex: 0, title: "Dialogue" },
        { ordinal: 1, startChunkIndex: 1, endChunkIndex: 1, title: "Narration" },
        {
          ordinal: 2,
          startChunkIndex: 1,
          endChunkIndex: 1,
          title: "Empty",
          customStartChunkId: "missing-start",
          customEndChunkId: "missing-end"
        }
      ]
    });

    runStyleMetrics(setup.db, setup.projectId, { rootPath: setup.rootPath });

    const metrics = listStyleMetrics(setup.db, { projectId: setup.projectId });
    const toneSceneMetrics = metrics.filter(
      (metric) => metric.scope_type === "scene" && metric.metric_name === "tone_vector"
    );
    const dialogueIssues = listIssuesWithEvidence(setup.db, setup.projectId, {
      type: "dialogue_tic"
    });

    expect(
      metrics.some((metric) => metric.scope_type === "project" && metric.metric_name === "ngram_freq")
    ).toBe(true);
    expect(
      metrics.some(
        (metric) =>
          metric.scope_type === "document" &&
          metric.scope_id === document.documentId &&
          metric.metric_name === "dialogue_tics"
      )
    ).toBe(true);
    expect(toneSceneMetrics).toHaveLength(3);
    expect(
      toneSceneMetrics.some((metric) => metric.scope_id === document.scenes[2]?.id)
    ).toBe(true);
    expect(dialogueIssues.length).toBeGreaterThan(0);
  });

  it("continues other analyses when one cached analysis payload is invalid", () => {
    const setup = setupProject();
    const document = createDocumentWithChunks(setup, {
      fileName: "invalid-tone-cache.md",
      chunks: ['Mira said, "Look." The lantern light was warm.'],
      scenes: [{ ordinal: 0, startChunkIndex: 0, endChunkIndex: 0 }]
    });

    insertRawMetric(setup.db, {
      projectId: setup.projectId,
      scopeType: "scene",
      scopeId: document.scenes[0]!.id,
      metricName: "tone_vector",
      metricJson: "{not-json"
    });

    runStyleMetrics(setup.db, setup.projectId, { rootPath: setup.rootPath });

    const repetitionMetric = getMetricRow(setup.db, {
      projectId: setup.projectId,
      scopeType: "project",
      scopeId: setup.projectId,
      metricName: "ngram_freq"
    });
    const dialogueMetric = getMetricRow(setup.db, {
      projectId: setup.projectId,
      scopeType: "document",
      scopeId: document.documentId,
      metricName: "dialogue_tics"
    });
    const repairedToneMetric = getMetricRow(setup.db, {
      projectId: setup.projectId,
      scopeType: "scene",
      scopeId: document.scenes[0]!.id,
      metricName: "tone_vector"
    });

    expect(repetitionMetric).toBeTruthy();
    expect(dialogueMetric).toBeTruthy();
    expect(repairedToneMetric).toBeTruthy();
    expect(() => JSON.parse(repairedToneMetric?.metric_json ?? "{}")).not.toThrow();
  });

  it("aggregates repetition metrics from single-scene to multi-scene projects", () => {
    const setup = setupProject();
    createDocumentWithChunks(setup, {
      fileName: "single-scene.md",
      chunks: ["anchor anchor anchor anchor"],
      scenes: [{ ordinal: 0, startChunkIndex: 0, endChunkIndex: 0 }]
    });

    runStyleMetrics(setup.db, setup.projectId, { rootPath: setup.rootPath });
    const singleSceneAnchorCount = getProjectNgramCount(setup.db, setup.projectId, "anchor");

    createDocumentWithChunks(setup, {
      fileName: "multi-scene.md",
      chunks: ["anchor anchor anchor anchor"],
      scenes: [{ ordinal: 0, startChunkIndex: 0, endChunkIndex: 0 }]
    });

    runStyleMetrics(setup.db, setup.projectId, { rootPath: setup.rootPath });
    const multiSceneAnchorCount = getProjectNgramCount(setup.db, setup.projectId, "anchor");
    const toneSceneMetrics = listStyleMetrics(setup.db, { projectId: setup.projectId }).filter(
      (metric) => metric.scope_type === "scene" && metric.metric_name === "tone_vector"
    );

    expect(singleSceneAnchorCount).toBeGreaterThan(0);
    expect(multiSceneAnchorCount).toBeGreaterThan(singleSceneAnchorCount);
    expect(toneSceneMetrics.length).toBeGreaterThanOrEqual(2);
  });

  it("handles an empty project with a clean metric footprint and no issues", () => {
    const setup = setupProject();

    runStyleMetrics(setup.db, setup.projectId, { rootPath: setup.rootPath });

    const metrics = listStyleMetrics(setup.db, { projectId: setup.projectId });
    const issues = listIssues(setup.db, setup.projectId, { status: "all" });

    expect(metrics).toHaveLength(1);
    expect(metrics[0]?.scope_type).toBe("project");
    expect(metrics[0]?.metric_name).toBe("ngram_freq");
    expect(issues).toHaveLength(0);
  });

  it("reuses cached untouched document metrics for repetition and dialogue", () => {
    const setup = setupProject();
    const docA = createDocumentWithChunks(setup, {
      fileName: "doc-a.md",
      chunks: ["anchor anchor anchor anchor"],
      scenes: [{ ordinal: 0, startChunkIndex: 0, endChunkIndex: 0 }]
    });
    const docB = createDocumentWithChunks(setup, {
      fileName: "doc-b.md",
      chunks: ['Mira said, "Well, look." Mira said, "Well, look." Mira said, "Well, look."'],
      scenes: [{ ordinal: 0, startChunkIndex: 0, endChunkIndex: 0 }]
    });

    runStyleMetrics(setup.db, setup.projectId, { rootPath: setup.rootPath });

    const docBNgramBefore = getMetricRow(setup.db, {
      projectId: setup.projectId,
      scopeType: "document",
      scopeId: docB.documentId,
      metricName: "ngram_freq"
    });
    const docBDialogueBefore = getMetricRow(setup.db, {
      projectId: setup.projectId,
      scopeType: "document",
      scopeId: docB.documentId,
      metricName: "dialogue_tics"
    });

    const updatedText = "anchor anchor anchor anchor anchor anchor";
    updateChunk(setup.db, docA.chunks[0]!.id, {
      ordinal: docA.chunks[0]!.ordinal,
      text: updatedText,
      text_hash: hashText(updatedText),
      start_char: 0,
      end_char: updatedText.length
    });

    runStyleMetrics(setup.db, setup.projectId, {
      rootPath: setup.rootPath,
      documentId: docA.documentId
    });

    const docBNgramAfter = getMetricRow(setup.db, {
      projectId: setup.projectId,
      scopeType: "document",
      scopeId: docB.documentId,
      metricName: "ngram_freq"
    });
    const docBDialogueAfter = getMetricRow(setup.db, {
      projectId: setup.projectId,
      scopeType: "document",
      scopeId: docB.documentId,
      metricName: "dialogue_tics"
    });

    expect(docBNgramBefore?.id).toBe(docBNgramAfter?.id);
    expect(docBDialogueBefore?.id).toBe(docBDialogueAfter?.id);
  });

  it("handles stored metric JSON parse failures by recomputing valid JSON", () => {
    const setup = setupProject();
    const document = createDocumentWithChunks(setup, {
      fileName: "parse-failure.md",
      chunks: ['Mira said, "Well, look." anchor anchor anchor anchor'],
      scenes: [{ ordinal: 0, startChunkIndex: 0, endChunkIndex: 0 }]
    });

    insertRawMetric(setup.db, {
      projectId: setup.projectId,
      scopeType: "document",
      scopeId: document.documentId,
      metricName: "ngram_freq",
      metricJson: "{broken"
    });
    insertRawMetric(setup.db, {
      projectId: setup.projectId,
      scopeType: "document",
      scopeId: document.documentId,
      metricName: "dialogue_tics",
      metricJson: "{broken"
    });

    runStyleMetrics(setup.db, setup.projectId, { rootPath: setup.rootPath });

    const ngram = getMetricRow(setup.db, {
      projectId: setup.projectId,
      scopeType: "document",
      scopeId: document.documentId,
      metricName: "ngram_freq"
    });
    const dialogue = getMetricRow(setup.db, {
      projectId: setup.projectId,
      scopeType: "document",
      scopeId: document.documentId,
      metricName: "dialogue_tics"
    });

    expect(ngram).toBeTruthy();
    expect(dialogue).toBeTruthy();
    expect(() => JSON.parse(ngram?.metric_json ?? "{}")).not.toThrow();
    expect(() => JSON.parse(dialogue?.metric_json ?? "{}")).not.toThrow();
  });

  it("handles the no-docs/no-scenes edge case with a targeted document option", () => {
    const setup = setupProject();

    runStyleMetrics(setup.db, setup.projectId, {
      rootPath: setup.rootPath,
      documentId: "missing-document-id"
    });

    const metrics = listStyleMetrics(setup.db, { projectId: setup.projectId });
    const sceneToneMetrics = metrics.filter(
      (metric) => metric.scope_type === "scene" && metric.metric_name === "tone_vector"
    );

    expect(metrics).toHaveLength(1);
    expect(metrics[0]?.scope_type).toBe("project");
    expect(sceneToneMetrics).toHaveLength(0);
  });

  it("creates tone drift issues without evidence when scene start chunk is missing", () => {
    const setup = setupProject();
    const document = createDocumentWithChunks(setup, {
      fileName: "tone-missing-excerpt.md",
      chunks: [
        "This sentence carries a dramatic shift, with long clauses, many commas, and sharp punctuation.",
        "Quiet."
      ],
      scenes: [
        { ordinal: 0, startChunkIndex: 0, endChunkIndex: 0, title: "Baseline" },
        {
          ordinal: 1,
          startChunkIndex: 1,
          endChunkIndex: 1,
          title: "Missing excerpt",
          customStartChunkId: "missing-scene-start",
          customEndChunkId: "missing-scene-end"
        }
      ]
    });

    fs.writeFileSync(
      path.join(setup.rootPath, "canonkeeper.json"),
      `${JSON.stringify(
        {
          style: {
            toneBaselineScenes: 1
          }
        },
        null,
        2
      )}\n`
    );

    runStyleMetrics(setup.db, setup.projectId, { rootPath: setup.rootPath });

    const missingSceneId = document.scenes[1]!.id;
    const missingSceneTone = getMetricRow(setup.db, {
      projectId: setup.projectId,
      scopeType: "scene",
      scopeId: missingSceneId,
      metricName: "tone_vector"
    });
    const toneIssues = listIssuesWithEvidence(setup.db, setup.projectId, {
      type: "tone_drift"
    });
    const issueWithoutEvidence = toneIssues.find((issue) => issue.evidence.length === 0);
    const toneMetric = JSON.parse(missingSceneTone?.metric_json ?? "{}") as { driftScore?: number };

    expect(missingSceneTone).toBeTruthy();
    expect((toneMetric.driftScore ?? 0) >= 2.5).toBe(true);
    expect(toneIssues.length).toBeGreaterThan(0);
    expect(issueWithoutEvidence).toBeTruthy();
  });
});
