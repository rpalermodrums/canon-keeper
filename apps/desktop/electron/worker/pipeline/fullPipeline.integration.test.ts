import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { ingestDocument, type IngestResult } from "./ingest";
import { runSceneStage } from "./stages/scenes";
import { runStyleStage } from "./stages/style";
import { runExtractionStage } from "./stages/extraction";
import { runContinuityStage } from "./stages/continuity";
import { searchChunks } from "../search/fts";
import {
  createProject,
  getChunkById,
  listAliases,
  listClaimsByField,
  listChunksForDocument,
  listEntities,
  listEvidenceForClaim,
  listIssuesWithEvidence,
  listScenesForProject,
  listStyleMetrics,
  openDatabase
} from "../storage";

type ProjectSetup = {
  rootPath: string;
  filePath: string;
  db: Database.Database;
  projectId: string;
};

type FullPipelineRun = {
  ingestResult: IngestResult;
  extractionResult: {
    ok: boolean;
    skipped?: boolean;
    touchedEntityIds: string[];
  };
};

const tempRoots: string[] = [];
const openDbs: Database.Database[] = [];
const originalApiKey = process.env.CANONKEEPER_LLM_API_KEY;
const originalBaseUrl = process.env.CANONKEEPER_LLM_BASE_URL;
const originalModel = process.env.CANONKEEPER_LLM_MODEL;

function buildNarrativeTail(sentence: string, count: number): string {
  return Array.from({ length: count }, (_, index) => `${sentence} Marker ${index + 1}.`).join(" ");
}

function buildConsistentManuscript(): string {
  const sceneOne = [
    "I kept watch in the harbor watchtower while gulls circled the pier.",
    "Mira tracked every crate before dawn.",
    "Mira's eyes were green in the lantern light.",
    "By sunrise, the harbor watchtower was all cold stone under my palm.",
    buildNarrativeTail(
      "Jonah checked the rigging while I balanced every number against the manifest ledger",
      18
    )
  ].join(" ");

  const sceneTwo = [
    "I returned in the archive vault after noon to verify the manifests.",
    "Mira's eyes were green when she checked the mirror.",
    buildNarrativeTail(
      "Dust swirled above the ledgers and I matched signatures against every cargo mark before dusk",
      18
    )
  ].join(" ");

  return `# Harbor Watch\n\n${sceneOne}\n\n# Archive Vault\n\n${sceneTwo}\n`;
}

function buildContradictoryManuscript(base: string): string {
  return base.replace(
    "Mira's eyes were green when she checked the mirror.",
    "Mira's eyes were amber when she checked the mirror."
  );
}

function setupProject(manuscript: string, fileName = "manuscript.md"): ProjectSetup {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "canonkeeper-full-pipeline-"));
  const filePath = path.join(rootPath, fileName);
  fs.writeFileSync(filePath, manuscript);

  const handle = openDatabase({ rootPath });
  const project = createProject(handle.db, rootPath, "Full Pipeline Integration");

  tempRoots.push(rootPath);
  openDbs.push(handle.db);

  return { rootPath, filePath, db: handle.db, projectId: project.id };
}

function configureCloudProvider(rootPath: string): void {
  const configPath = path.join(rootPath, "canonkeeper.json");
  fs.writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        projectName: "Full Pipeline Integration",
        documents: [],
        llm: {
          provider: "cloud",
          model: "gpt-5.2",
          enabled: true,
          baseUrl: "https://llm.example.test/v1/responses"
        }
      },
      null,
      2
    )}\n`
  );
  process.env.CANONKEEPER_LLM_API_KEY = "test-key";
  delete process.env.CANONKEEPER_LLM_BASE_URL;
  delete process.env.CANONKEEPER_LLM_MODEL;
}

async function runFullPipeline(setup: ProjectSetup): Promise<FullPipelineRun> {
  const ingestResult = await ingestDocument(setup.db, {
    projectId: setup.projectId,
    rootPath: setup.rootPath,
    filePath: setup.filePath
  });

  await runSceneStage({
    db: setup.db,
    projectId: setup.projectId,
    documentId: ingestResult.documentId,
    snapshotId: ingestResult.snapshotId,
    rootPath: setup.rootPath
  });

  runStyleStage({
    db: setup.db,
    projectId: setup.projectId,
    documentId: ingestResult.documentId,
    snapshotId: ingestResult.snapshotId,
    rootPath: setup.rootPath
  });

  const extractionResult = await runExtractionStage({
    db: setup.db,
    projectId: setup.projectId,
    documentId: ingestResult.documentId,
    snapshotId: ingestResult.snapshotId,
    rootPath: setup.rootPath,
    changeStart: ingestResult.changeStart,
    changeEnd: ingestResult.changeEnd
  });

  runContinuityStage({
    db: setup.db,
    projectId: setup.projectId,
    documentId: ingestResult.documentId,
    snapshotId: ingestResult.snapshotId,
    rootPath: setup.rootPath,
    entityIds: extractionResult.touchedEntityIds
  });

  return { ingestResult, extractionResult };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();

  if (originalApiKey === undefined) {
    delete process.env.CANONKEEPER_LLM_API_KEY;
  } else {
    process.env.CANONKEEPER_LLM_API_KEY = originalApiKey;
  }
  if (originalBaseUrl === undefined) {
    delete process.env.CANONKEEPER_LLM_BASE_URL;
  } else {
    process.env.CANONKEEPER_LLM_BASE_URL = originalBaseUrl;
  }
  if (originalModel === undefined) {
    delete process.env.CANONKEEPER_LLM_MODEL;
  } else {
    process.env.CANONKEEPER_LLM_MODEL = originalModel;
  }

  for (const db of openDbs) {
    db.close();
  }
  openDbs.length = 0;

  for (const rootPath of tempRoots) {
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
  tempRoots.length = 0;
});

describe("full pipeline integration", { timeout: 30_000 }, () => {
  it("runs the full deterministic pipeline with NullProvider and persists evidence-backed state", async () => {
    const setup = setupProject(buildConsistentManuscript());

    const run = await runFullPipeline(setup);

    expect(run.ingestResult.snapshotCreated).toBe(true);
    expect(run.ingestResult.chunksCreated).toBeGreaterThan(0);

    const chunks = listChunksForDocument(setup.db, run.ingestResult.documentId);
    expect(chunks.length).toBeGreaterThan(1);

    const ftsCount = (
      setup.db.prepare("SELECT COUNT(*) as count FROM chunk_fts").get() as { count: number }
    ).count;
    expect(ftsCount).toBe(chunks.length);
    expect(searchChunks(setup.db, "watchtower").length).toBeGreaterThan(0);

    const scenes = listScenesForProject(setup.db, setup.projectId);
    expect(scenes.length).toBeGreaterThanOrEqual(2);

    const sceneMetadata = setup.db
      .prepare(
        `SELECT pov_mode, setting_text
         FROM scene_metadata
         ORDER BY rowid`
      )
      .all() as Array<{ pov_mode: string; setting_text: string | null }>;
    expect(sceneMetadata.some((row) => row.pov_mode === "first")).toBe(true);
    expect(sceneMetadata.some((row) => row.setting_text !== null)).toBe(true);

    const styleMetrics = listStyleMetrics(setup.db, { projectId: setup.projectId });
    expect(
      styleMetrics.some(
        (metric) => metric.scope_type === "project" && metric.metric_name === "ngram_freq"
      )
    ).toBe(true);
    expect(
      styleMetrics.some(
        (metric) => metric.scope_type === "scene" && metric.metric_name === "tone_vector"
      )
    ).toBe(true);
    expect(
      styleMetrics.some(
        (metric) => metric.scope_type === "document" && metric.metric_name === "dialogue_tics"
      )
    ).toBe(true);

    const entities = listEntities(setup.db, setup.projectId);
    const mira = entities.find((entity) => entity.display_name === "Mira");
    expect(mira).toBeTruthy();
    if (!mira) {
      throw new Error("Expected deterministic extraction to create Mira");
    }

    const eyeColorClaims = listClaimsByField(setup.db, mira.id, "eye_color");
    expect(eyeColorClaims).toHaveLength(1);
    expect(eyeColorClaims[0]?.value_json).toBe(JSON.stringify("green"));

    const claimEvidence = listEvidenceForClaim(setup.db, eyeColorClaims[0]!.id);
    expect(claimEvidence.length).toBeGreaterThan(0);
    const evidenceChunk = getChunkById(setup.db, claimEvidence[0]!.chunk_id);
    const evidenceQuote = evidenceChunk?.text.slice(
      claimEvidence[0]!.quote_start,
      claimEvidence[0]!.quote_end
    );
    expect(evidenceQuote).toContain("Mira's eyes were green");

    const continuityIssues = listIssuesWithEvidence(setup.db, setup.projectId, {
      type: "continuity"
    });
    expect(continuityIssues).toHaveLength(0);

    const documentCount = (
      setup.db.prepare("SELECT COUNT(*) as count FROM document WHERE project_id = ?").get(setup.projectId) as {
        count: number;
      }
    ).count;
    const chunkCount = (
      setup.db
        .prepare(
          "SELECT COUNT(*) as count FROM chunk WHERE document_id = ?"
        )
        .get(run.ingestResult.documentId) as { count: number }
    ).count;
    const sceneCount = (
      setup.db
        .prepare(
          "SELECT COUNT(*) as count FROM scene WHERE document_id = ?"
        )
        .get(run.ingestResult.documentId) as { count: number }
    ).count;
    const entityCount = (
      setup.db.prepare("SELECT COUNT(*) as count FROM entity WHERE project_id = ?").get(setup.projectId) as {
        count: number;
      }
    ).count;
    const claimCount = (setup.db.prepare("SELECT COUNT(*) as count FROM claim").get() as { count: number }).count;
    const styleMetricCount = (
      setup.db.prepare("SELECT COUNT(*) as count FROM style_metric WHERE project_id = ?").get(setup.projectId) as {
        count: number;
      }
    ).count;

    expect(documentCount).toBe(1);
    expect(chunkCount).toBe(chunks.length);
    expect(sceneCount).toBe(scenes.length);
    expect(entityCount).toBeGreaterThan(0);
    expect(claimCount).toBeGreaterThan(0);
    expect(styleMetricCount).toBeGreaterThan(0);
  });

  it("reprocesses incrementally and creates a continuity issue with evidence after contradiction", async () => {
    const baseManuscript = buildConsistentManuscript();
    const setup = setupProject(baseManuscript);

    const initialRun = await runFullPipeline(setup);
    const chunksBefore = listChunksForDocument(setup.db, initialRun.ingestResult.documentId);
    const beforeByOrdinal = new Map(chunksBefore.map((chunk) => [chunk.ordinal, chunk.id]));

    fs.writeFileSync(setup.filePath, buildContradictoryManuscript(baseManuscript));

    const updatedRun = await runFullPipeline(setup);
    expect(updatedRun.ingestResult.snapshotCreated).toBe(true);

    const changeStart = updatedRun.ingestResult.changeStart;
    const changeEnd = updatedRun.ingestResult.changeEnd;
    expect(changeStart).not.toBeNull();
    expect(changeEnd).not.toBeNull();

    if (changeStart === null || changeEnd === null) {
      throw new Error("Expected a non-empty incremental change range");
    }

    const chunksAfter = listChunksForDocument(setup.db, updatedRun.ingestResult.documentId);
    const unchangedChunks = chunksAfter.filter(
      (chunk) => chunk.ordinal < changeStart || chunk.ordinal > changeEnd
    );
    const changedChunks = chunksAfter.filter(
      (chunk) => chunk.ordinal >= changeStart && chunk.ordinal <= changeEnd
    );

    expect(unchangedChunks.length).toBeGreaterThan(0);
    for (const chunk of unchangedChunks) {
      expect(chunk.id).toBe(beforeByOrdinal.get(chunk.ordinal));
    }

    expect(changedChunks.length).toBeGreaterThan(0);
    for (const chunk of changedChunks) {
      expect(chunk.id).not.toBe(beforeByOrdinal.get(chunk.ordinal));
    }

    const continuityIssues = listIssuesWithEvidence(setup.db, setup.projectId, {
      type: "continuity"
    });
    expect(continuityIssues.length).toBeGreaterThan(0);

    const miraIssue = continuityIssues.find(
      (issue) => issue.title.includes("Mira") && issue.title.includes("eye_color")
    );
    expect(miraIssue).toBeTruthy();
    if (!miraIssue) {
      throw new Error("Expected a continuity issue for Mira eye color contradiction");
    }

    expect(miraIssue.evidence.length).toBeGreaterThanOrEqual(2);

    const quotedEvidence = miraIssue.evidence
      .map((evidence) => {
        const chunk = getChunkById(setup.db, evidence.chunkId);
        return chunk ? chunk.text.slice(evidence.quoteStart, evidence.quoteEnd) : "";
      })
      .filter(Boolean)
      .join("\n");

    expect(quotedEvidence.toLowerCase()).toContain("mira's eyes were green");
    expect(quotedEvidence.toLowerCase()).toContain("mira's eyes were amber");
  });

  it("runs full pipeline with CloudProvider stub and merges LLM extraction with deterministic entities", async () => {
    const setup = setupProject(buildConsistentManuscript());
    configureCloudProvider(setup.rootPath);

    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      if (!init || typeof init.body !== "string") {
        return new Response(JSON.stringify({ error: "invalid request body" }), { status: 400 });
      }

      const body = JSON.parse(init.body) as {
        text?: { format?: { name?: string } };
        schemaName?: string;
      };
      const schemaName = body.text?.format?.name ?? body.schemaName;

      if (schemaName === "scene_meta") {
        return new Response(
          JSON.stringify({
            output_parsed: {
              schemaVersion: "1.0",
              povMode: "unknown",
              povName: null,
              povConfidence: 0,
              settingName: null,
              settingText: null,
              settingConfidence: 0,
              timeContextText: null,
              evidence: []
            }
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      if (schemaName === "extraction") {
        return new Response(
          JSON.stringify({
            output_parsed: {
              schemaVersion: "1.0",
              entities: [
                {
                  tempId: "e_mira",
                  type: "character",
                  displayName: "Mira",
                  aliases: ["Mira Vale"]
                },
                {
                  tempId: "e_watchtower",
                  type: "location",
                  displayName: "Harbor Watchtower",
                  aliases: ["watchtower"]
                }
              ],
              claims: [
                {
                  entityTempId: "e_mira",
                  field: "role",
                  value: "quartermaster",
                  confidence: 0.83,
                  evidence: [{ chunkOrdinal: 0, quote: "Mira tracked every crate before dawn" }]
                },
                {
                  entityTempId: "e_watchtower",
                  field: "descriptor",
                  value: "cold stone",
                  confidence: 0.78,
                  evidence: [{ chunkOrdinal: 0, quote: "the harbor watchtower was all cold stone" }]
                }
              ],
              suggestedMerges: []
            }
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      return new Response(JSON.stringify({ error: `unexpected schema: ${schemaName}` }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await runFullPipeline(setup);

    const schemaNames = fetchMock.mock.calls
      .map((call) => {
        const init = call[1] as RequestInit | undefined;
        if (!init || typeof init.body !== "string") {
          return "";
        }
        const body = JSON.parse(init.body) as {
          text?: { format?: { name?: string } };
          schemaName?: string;
        };
        return body.text?.format?.name ?? body.schemaName ?? "";
      })
      .filter(Boolean);

    expect(schemaNames).toContain("scene_meta");
    expect(schemaNames).toContain("extraction");

    const entities = listEntities(setup.db, setup.projectId);
    const miraEntities = entities.filter((entity) => entity.display_name === "Mira");
    expect(miraEntities).toHaveLength(1);
    const mira = miraEntities[0]!;

    const location = entities.find((entity) => entity.display_name === "Harbor Watchtower");
    expect(location).toBeTruthy();
    if (!location) {
      throw new Error("Expected LLM extraction to create Harbor Watchtower location");
    }

    const aliases = listAliases(setup.db, mira.id);
    expect(aliases).toContain("Mira Vale");

    const eyeColorClaims = listClaimsByField(setup.db, mira.id, "eye_color");
    expect(eyeColorClaims).toHaveLength(1);
    expect(eyeColorClaims[0]?.value_json).toBe(JSON.stringify("green"));

    const roleClaims = listClaimsByField(setup.db, mira.id, "role");
    expect(roleClaims).toHaveLength(1);
    const roleEvidence = listEvidenceForClaim(setup.db, roleClaims[0]!.id);
    expect(roleEvidence).toHaveLength(1);
    const roleChunk = getChunkById(setup.db, roleEvidence[0]!.chunk_id);
    const roleQuote = roleChunk?.text.slice(roleEvidence[0]!.quote_start, roleEvidence[0]!.quote_end);
    expect(roleQuote).toBe("Mira tracked every crate before dawn");

    const descriptorClaims = listClaimsByField(setup.db, location.id, "descriptor");
    expect(descriptorClaims).toHaveLength(1);
    const descriptorEvidence = listEvidenceForClaim(setup.db, descriptorClaims[0]!.id);
    expect(descriptorEvidence).toHaveLength(1);
    const descriptorChunk = getChunkById(setup.db, descriptorEvidence[0]!.chunk_id);
    const descriptorQuote = descriptorChunk?.text.slice(
      descriptorEvidence[0]!.quote_start,
      descriptorEvidence[0]!.quote_end
    );
    expect(descriptorQuote).toBe("the harbor watchtower was all cold stone");
  });
});
