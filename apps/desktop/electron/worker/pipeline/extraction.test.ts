import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { hashText } from "../../../../../packages/shared/utils/hashing";
import { runExtraction, type ExtractionResult } from "./extraction";
import {
  addAlias,
  createDocument,
  createEntity,
  createProject,
  getChunkById,
  listAliases,
  listClaimsByField,
  listEntities,
  listEvents,
  listEvidenceForClaim,
  openDatabase,
  insertChunks
} from "../storage";

type TestProject = {
  rootPath: string;
  db: Database.Database;
  projectId: string;
};

const tempRoots: string[] = [];
const openDatabases: Database.Database[] = [];
const originalApiKey = process.env.CANONKEEPER_LLM_API_KEY;
const originalModel = process.env.CANONKEEPER_LLM_MODEL;
const originalBaseUrl = process.env.CANONKEEPER_LLM_BASE_URL;

function setupProject(): TestProject {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "canonkeeper-"));
  const handle = openDatabase({ rootPath });
  const project = createProject(handle.db, rootPath, "Extraction Test");
  tempRoots.push(rootPath);
  openDatabases.push(handle.db);
  return { rootPath, db: handle.db, projectId: project.id };
}

function addChunks(
  db: Database.Database,
  args: { projectId: string; rootPath: string; texts: string[]; fileName?: string }
) {
  const documentPath = path.join(args.rootPath, args.fileName ?? "draft.md");
  const document = createDocument(db, args.projectId, documentPath, "md");
  const chunkInput = args.texts.reduce<{
    rows: Array<{
      document_id: string;
      ordinal: number;
      text: string;
      text_hash: string;
      start_char: number;
      end_char: number;
    }>;
    cursor: number;
  }>(
    (acc, text, ordinal) => {
      const startChar = acc.cursor;
      const endChar = startChar + text.length;
      return {
        rows: [
          ...acc.rows,
          {
            document_id: document.id,
            ordinal,
            text,
            text_hash: hashText(text),
            start_char: startChar,
            end_char: endChar
          }
        ],
        cursor: endChar + 1
      };
    },
    { rows: [], cursor: 0 }
  );

  const chunks = insertChunks(db, document.id, chunkInput.rows);
  return {
    documentId: document.id,
    chunks: chunks.map((chunk) => ({ id: chunk.id, ordinal: chunk.ordinal, text: chunk.text }))
  };
}

function configureCloudProvider(rootPath: string): void {
  const configPath = path.join(rootPath, "canonkeeper.json");
  fs.writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        projectName: "Extraction Test",
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

function stubExtractionResponse(json: ExtractionResult) {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ output_parsed: json }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalApiKey === undefined) {
    delete process.env.CANONKEEPER_LLM_API_KEY;
  } else {
    process.env.CANONKEEPER_LLM_API_KEY = originalApiKey;
  }
  if (originalModel === undefined) {
    delete process.env.CANONKEEPER_LLM_MODEL;
  } else {
    process.env.CANONKEEPER_LLM_MODEL = originalModel;
  }
  if (originalBaseUrl === undefined) {
    delete process.env.CANONKEEPER_LLM_BASE_URL;
  } else {
    process.env.CANONKEEPER_LLM_BASE_URL = originalBaseUrl;
  }
  for (const db of openDatabases) {
    db.close();
  }
  openDatabases.length = 0;
  for (const root of tempRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  tempRoots.length = 0;
});

describe("runExtraction deterministic path", () => {
  it("runs fully with NullProvider and creates evidence-backed claims", async () => {
    const setup = setupProject();
    const sourceText = "Mira's eyes were green in the lantern light.";
    const chunkSet = addChunks(setup.db, {
      projectId: setup.projectId,
      rootPath: setup.rootPath,
      texts: [sourceText]
    });

    const result = await runExtraction(setup.db, {
      projectId: setup.projectId,
      rootPath: setup.rootPath,
      chunks: chunkSet.chunks
    });

    const entities = listEntities(setup.db, setup.projectId);
    expect(entities).toHaveLength(1);
    const mira = entities[0]!;
    expect(mira.display_name).toBe("Mira");
    expect(result.touchedEntityIds).toEqual([mira.id]);

    const claims = listClaimsByField(setup.db, mira.id, "eye_color");
    expect(claims).toHaveLength(1);
    expect(claims[0]?.status).toBe("inferred");
    expect(claims[0]?.confidence).toBe(0.6);
    expect(claims[0]?.value_json).toBe(JSON.stringify("green"));

    const evidence = listEvidenceForClaim(setup.db, claims[0]!.id);
    expect(evidence).toHaveLength(1);
    const chunk = getChunkById(setup.db, evidence[0]!.chunk_id);
    const quote = chunk?.text.slice(evidence[0]!.quote_start, evidence[0]!.quote_end);
    expect(quote).toBe("Mira's eyes were green in the lantern light");

    const llmEvents = listEvents(setup.db, setup.projectId).filter(
      (event) => event.event_type === "llm_call"
    );
    expect(llmEvents).toHaveLength(0);
  });

  it("resolves pronoun eye-color claims across chunk boundaries", async () => {
    const setup = setupProject();
    const chunkSet = addChunks(setup.db, {
      projectId: setup.projectId,
      rootPath: setup.rootPath,
      texts: ["Lina's eyes were hazel.", "Her eyes were gray after the storm."]
    });

    await runExtraction(setup.db, {
      projectId: setup.projectId,
      rootPath: setup.rootPath,
      chunks: chunkSet.chunks
    });

    const entities = listEntities(setup.db, setup.projectId);
    expect(entities).toHaveLength(1);
    const lina = entities[0]!;
    const eyeColorClaims = listClaimsByField(setup.db, lina.id, "eye_color");
    const values = eyeColorClaims
      .map((claim) => JSON.parse(claim.value_json) as string)
      .sort((a, b) => a.localeCompare(b));
    expect(values).toEqual(["gray", "hazel"]);

    const grayClaim = eyeColorClaims.find((claim) => claim.value_json === JSON.stringify("gray"));
    expect(grayClaim?.confidence).toBe(0.5);
  });

  it("ignores common temporal words such as Monday as character names", async () => {
    const setup = setupProject();
    const chunkSet = addChunks(setup.db, {
      projectId: setup.projectId,
      rootPath: setup.rootPath,
      texts: ["Monday's eyes were blue. Mara's eyes were green."]
    });

    await runExtraction(setup.db, {
      projectId: setup.projectId,
      rootPath: setup.rootPath,
      chunks: chunkSet.chunks
    });

    const entities = listEntities(setup.db, setup.projectId);
    expect(entities).toHaveLength(1);
    expect(entities[0]?.display_name).toBe("Mara");
  });
});

describe("runExtraction LLM path", () => {
  it("merges overlapping entities by confidence and transfers aliases", async () => {
    const setup = setupProject();
    const existing = createEntity(setup.db, {
      projectId: setup.projectId,
      type: "character",
      displayName: "Elizabeth Bennet"
    });
    addAlias(setup.db, existing.id, "Liz");
    const chunkSet = addChunks(setup.db, {
      projectId: setup.projectId,
      rootPath: setup.rootPath,
      texts: ["The carriage rattled through town."]
    });
    configureCloudProvider(setup.rootPath);
    stubExtractionResponse({
      schemaVersion: "1.0",
      entities: [
        {
          tempId: "e_liz",
          type: "character",
          displayName: "Liz Bennet",
          aliases: ["Lizzie"]
        },
        {
          tempId: "e_beth",
          type: "character",
          displayName: "Beth Bennet",
          aliases: ["Beth"]
        }
      ],
      claims: [],
      suggestedMerges: [
        { a: "e_beth", b: "e_liz", reason: "Name overlap", confidence: 0.8 },
        { a: "e_liz", b: existing.id, reason: "Nickname", confidence: 0.91 }
      ]
    });

    const result = await runExtraction(setup.db, {
      projectId: setup.projectId,
      rootPath: setup.rootPath,
      chunks: chunkSet.chunks
    });

    const entities = listEntities(setup.db, setup.projectId);
    expect(entities).toHaveLength(1);
    expect(entities[0]?.id).toBe(existing.id);
    expect(result.touchedEntityIds).toEqual([existing.id]);

    const aliases = listAliases(setup.db, existing.id);
    expect(aliases).toEqual(
      expect.arrayContaining(["Elizabeth Bennet", "Liz", "Liz Bennet", "Lizzie", "Beth Bennet", "Beth"])
    );
  });

  it("maps exact and fuzzy evidence spans and discards unmappable evidence", async () => {
    const setup = setupProject();
    const chunkText = "Rowan found the brass compass. Rowan gripped the rail.";
    const chunkSet = addChunks(setup.db, {
      projectId: setup.projectId,
      rootPath: setup.rootPath,
      texts: [chunkText]
    });
    configureCloudProvider(setup.rootPath);
    stubExtractionResponse({
      schemaVersion: "1.0",
      entities: [
        { tempId: "e_rowan", type: "character", displayName: "Rowan", aliases: [] }
      ],
      claims: [
        {
          entityTempId: "e_rowan",
          field: "artifact",
          value: "brass_compass",
          confidence: 0.9,
          evidence: [{ chunkOrdinal: 0, quote: "Rowan found the brass compass" }]
        },
        {
          entityTempId: "e_rowan",
          field: "action",
          value: "gripped_rail",
          confidence: 0.82,
          evidence: [{ chunkOrdinal: 0, quote: "Rowan   gripped\n  the rail" }]
        },
        {
          entityTempId: "e_rowan",
          field: "mood",
          value: "tense",
          confidence: 0.4,
          evidence: [{ chunkOrdinal: 0, quote: "This quote does not exist" }]
        }
      ],
      suggestedMerges: []
    });

    await runExtraction(setup.db, {
      projectId: setup.projectId,
      rootPath: setup.rootPath,
      chunks: chunkSet.chunks
    });

    const entities = listEntities(setup.db, setup.projectId);
    expect(entities).toHaveLength(1);
    const rowan = entities[0]!;

    const artifactClaims = listClaimsByField(setup.db, rowan.id, "artifact");
    expect(artifactClaims).toHaveLength(1);
    const actionClaims = listClaimsByField(setup.db, rowan.id, "action");
    expect(actionClaims).toHaveLength(1);
    const moodClaims = listClaimsByField(setup.db, rowan.id, "mood");
    expect(moodClaims).toHaveLength(0);

    const actionEvidence = listEvidenceForClaim(setup.db, actionClaims[0]!.id);
    expect(actionEvidence).toHaveLength(1);
    const actionChunk = getChunkById(setup.db, actionEvidence[0]!.chunk_id);
    const fuzzyMappedQuote = actionChunk?.text.slice(
      actionEvidence[0]!.quote_start,
      actionEvidence[0]!.quote_end
    );
    expect(fuzzyMappedQuote).toBe("Rowan gripped the rail");
  });
});
