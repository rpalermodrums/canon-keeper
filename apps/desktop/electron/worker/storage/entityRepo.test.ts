import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { hashText } from "../../../../../packages/shared/utils/hashing";
import { runExtraction, type ExtractionResult } from "../pipeline/extraction";
import {
  addAlias,
  createDocument,
  createEntity,
  createProject,
  deleteEntityIfNoClaims,
  getEntityByAlias,
  getEntityById,
  insertChunks,
  insertClaim,
  insertClaimEvidence,
  listAliases,
  listClaimsByField,
  listEntities,
  listEvidenceForClaim,
  openDatabase,
  supersedeClaims
} from "./index";

function setupDb() {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "canonkeeper-"));
  const handle = openDatabase({ rootPath });
  const project = createProject(handle.db, rootPath, "Test Project");
  return { rootPath, db: handle.db, projectId: project.id };
}

describe("entity aliases", () => {
  const tempRoots: string[] = [];
  const openDbs: Database.Database[] = [];
  const originalApiKey = process.env.CANONKEEPER_LLM_API_KEY;
  const originalBaseUrl = process.env.CANONKEEPER_LLM_BASE_URL;
  const originalModel = process.env.CANONKEEPER_LLM_MODEL;

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
    for (const root of tempRoots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    tempRoots.length = 0;
  });

  it("does not duplicate aliases with the same normalized value", () => {
    const setup = setupDb();
    tempRoots.push(setup.rootPath);
    openDbs.push(setup.db);
    const entity = createEntity(setup.db, {
      projectId: setup.projectId,
      type: "character",
      displayName: "Mira"
    });

    addAlias(setup.db, entity.id, "Mira");
    addAlias(setup.db, entity.id, "mira");
    addAlias(setup.db, entity.id, "  Mira  ");

    const aliases = listAliases(setup.db, entity.id);
    expect(aliases.filter((alias) => alias.toLowerCase() === "mira").length).toBe(1);
  });

  it("lists entities with project and type filters", () => {
    const primary = setupDb();
    const secondary = setupDb();
    tempRoots.push(primary.rootPath, secondary.rootPath);
    openDbs.push(primary.db, secondary.db);

    const character = createEntity(primary.db, {
      projectId: primary.projectId,
      type: "character",
      displayName: "Mira",
      canonicalName: "Mira Hale"
    });
    createEntity(primary.db, {
      projectId: primary.projectId,
      type: "location",
      displayName: "Courtyard"
    });
    createEntity(secondary.db, {
      projectId: secondary.projectId,
      type: "character",
      displayName: "Mira"
    });

    const allPrimary = listEntities(primary.db, primary.projectId);
    expect(allPrimary.map((entity) => entity.display_name)).toEqual(["Courtyard", "Mira"]);

    const onlyCharacters = listEntities(primary.db, primary.projectId, "character");
    expect(onlyCharacters).toHaveLength(1);
    expect(onlyCharacters[0]?.id).toBe(character.id);
    expect(getEntityById(primary.db, character.id)?.canonical_name).toBe("Mira Hale");
    expect(listEntities(secondary.db, secondary.projectId)).toHaveLength(1);
  });

  it("supports confirmation updates and alias lookups", () => {
    const setup = setupDb();
    tempRoots.push(setup.rootPath);
    openDbs.push(setup.db);

    const entity = createEntity(setup.db, {
      projectId: setup.projectId,
      type: "character",
      displayName: "Captain North"
    });

    addAlias(setup.db, entity.id, "Cap");
    addAlias(setup.db, entity.id, " captain north ");

    const inferred = insertClaim(setup.db, {
      entityId: entity.id,
      field: "rank",
      valueJson: JSON.stringify("captain"),
      status: "inferred",
      confidence: 0.41
    });
    const confirmed = insertClaim(setup.db, {
      entityId: entity.id,
      field: "rank",
      valueJson: JSON.stringify("captain"),
      status: "confirmed",
      confidence: 1,
      supersedesClaimId: inferred.id
    });

    supersedeClaims(setup.db, entity.id, "rank", confirmed.id);

    const claims = listClaimsByField(setup.db, entity.id, "rank");
    const superseded = claims.find((claim) => claim.id === inferred.id);

    expect(superseded?.status).toBe("superseded");
    expect(superseded?.supersedes_claim_id).toBe(confirmed.id);
    expect(getEntityByAlias(setup.db, setup.projectId, "CAPTAIN NORTH")?.id).toBe(entity.id);
    expect(listAliases(setup.db, entity.id)).toEqual(expect.arrayContaining(["Captain North", "Cap"]));
  });

  it("supports claim create/update and keeps evidence chain integrity", () => {
    const setup = setupDb();
    tempRoots.push(setup.rootPath);
    openDbs.push(setup.db);

    const document = createDocument(setup.db, setup.projectId, path.join(setup.rootPath, "draft.md"), "md");
    const [chunk] = insertChunks(setup.db, document.id, [
      {
        document_id: document.id,
        ordinal: 0,
        text: "Mira's eyes were green under the lantern.",
        text_hash: hashText("Mira's eyes were green under the lantern."),
        start_char: 0,
        end_char: "Mira's eyes were green under the lantern.".length
      }
    ]);
    if (!chunk) {
      throw new Error("Expected chunk to be inserted");
    }

    const entity = createEntity(setup.db, {
      projectId: setup.projectId,
      type: "character",
      displayName: "Mira"
    });
    const claim = insertClaim(setup.db, {
      entityId: entity.id,
      field: "eye_color",
      valueJson: JSON.stringify("green"),
      status: "inferred",
      confidence: 0.62
    });

    const quote = "Mira's eyes were green";
    const quoteStart = chunk.text.indexOf(quote);
    if (quoteStart < 0) {
      throw new Error("Expected quote to exist in chunk text");
    }
    insertClaimEvidence(setup.db, {
      claimId: claim.id,
      chunkId: chunk.id,
      quoteStart,
      quoteEnd: quoteStart + quote.length
    });

    setup.db
      .prepare("UPDATE claim SET confidence = ?, updated_at = ? WHERE id = ?")
      .run(0.91, Date.now(), claim.id);

    const claims = listClaimsByField(setup.db, entity.id, "eye_color");
    expect(claims).toHaveLength(1);
    expect(claims[0]?.confidence).toBeCloseTo(0.91, 6);

    const evidence = listEvidenceForClaim(setup.db, claim.id);
    expect(evidence).toHaveLength(1);

    const linkedQuote = chunk.text.slice(evidence[0]!.quote_start, evidence[0]!.quote_end);
    expect(linkedQuote).toBe(quote);

    const chain = setup.db
      .prepare(
        `SELECT c.id AS claim_id, e.id AS entity_id, ch.id AS chunk_id, d.id AS document_id
         FROM claim_evidence ce
         JOIN claim c ON c.id = ce.claim_id
         JOIN entity e ON e.id = c.entity_id
         JOIN chunk ch ON ch.id = ce.chunk_id
         JOIN document d ON d.id = ch.document_id
         WHERE ce.id = ?`
      )
      .get(evidence[0]!.id) as
      | {
          claim_id: string;
          entity_id: string;
          chunk_id: string;
          document_id: string;
        }
      | undefined;

    expect(chain).toBeTruthy();
    expect(chain?.claim_id).toBe(claim.id);
    expect(chain?.entity_id).toBe(entity.id);
    expect(chain?.chunk_id).toBe(chunk.id);
    expect(chain?.document_id).toBe(document.id);
  });

  it("deletes entities only when they have no claims", () => {
    const setup = setupDb();
    tempRoots.push(setup.rootPath);
    openDbs.push(setup.db);

    const removable = createEntity(setup.db, {
      projectId: setup.projectId,
      type: "character",
      displayName: "Juno"
    });
    addAlias(setup.db, removable.id, "Jun");

    const keep = createEntity(setup.db, {
      projectId: setup.projectId,
      type: "character",
      displayName: "Kellan"
    });
    insertClaim(setup.db, {
      entityId: keep.id,
      field: "role",
      valueJson: JSON.stringify("navigator"),
      status: "inferred",
      confidence: 0.5
    });

    expect(deleteEntityIfNoClaims(setup.db, removable.id)).toBe(true);
    expect(getEntityById(setup.db, removable.id)).toBeNull();
    expect(listAliases(setup.db, removable.id)).toHaveLength(0);

    expect(deleteEntityIfNoClaims(setup.db, keep.id)).toBe(false);
    expect(getEntityById(setup.db, keep.id)?.id).toBe(keep.id);
  });

  it("merges overlapping entities by confidence and transfers aliases", async () => {
    const setup = setupDb();
    tempRoots.push(setup.rootPath);
    openDbs.push(setup.db);

    const existing = createEntity(setup.db, {
      projectId: setup.projectId,
      type: "character",
      displayName: "Elizabeth Bennet"
    });
    addAlias(setup.db, existing.id, "Liz");

    const document = createDocument(setup.db, setup.projectId, path.join(setup.rootPath, "draft.md"), "md");
    const [chunk] = insertChunks(setup.db, document.id, [
      {
        document_id: document.id,
        ordinal: 0,
        text: "The carriage rattled through town.",
        text_hash: hashText("The carriage rattled through town."),
        start_char: 0,
        end_char: "The carriage rattled through town.".length
      }
    ]);
    if (!chunk) {
      throw new Error("Expected chunk to be inserted");
    }

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
          tempId: "e_eliza",
          type: "character",
          displayName: "Eliza Bennet",
          aliases: ["Liza"]
        }
      ],
      claims: [],
      suggestedMerges: [
        { a: "e_eliza", b: "e_liz", reason: "Overlapping surname", confidence: 0.77 },
        { a: "e_liz", b: existing.id, reason: "Nickname match", confidence: 0.93 },
        { a: existing.id, b: "e_eliza", reason: "Low confidence noise", confidence: 0.55 }
      ]
    });

    const result = await runExtraction(setup.db, {
      projectId: setup.projectId,
      rootPath: setup.rootPath,
      chunks: [{ id: chunk.id, ordinal: chunk.ordinal, text: chunk.text }]
    });

    const entities = listEntities(setup.db, setup.projectId);
    expect(entities).toHaveLength(1);
    expect(entities[0]?.id).toBe(existing.id);
    expect(result.touchedEntityIds).toEqual([existing.id]);
    expect(listAliases(setup.db, existing.id)).toEqual(
      expect.arrayContaining([
        "Elizabeth Bennet",
        "Liz",
        "Liz Bennet",
        "Lizzie",
        "Eliza Bennet",
        "Liza"
      ])
    );
  });
});

function configureCloudProvider(rootPath: string): void {
  const configPath = path.join(rootPath, "canonkeeper.json");
  fs.writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        projectName: "Entity Repo Test",
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
