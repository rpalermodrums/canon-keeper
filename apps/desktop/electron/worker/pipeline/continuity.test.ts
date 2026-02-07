import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { hashText } from "../../../../../packages/shared/utils/hashing";
import {
  createDocument,
  createEntity,
  createProject,
  insertChunks,
  insertClaim,
  insertClaimEvidence,
  insertIssue,
  insertIssueEvidence,
  listIssuesWithEvidence,
  openDatabase
} from "../storage";
import { runContinuityChecks } from "./continuity";

function setupDb() {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "canonkeeper-"));
  const handle = openDatabase({ rootPath });
  const project = createProject(handle.db, rootPath, "Test Project");
  const document = createDocument(handle.db, project.id, path.join(rootPath, "manuscript.md"), "md");
  return { rootPath, db: handle.db, projectId: project.id, documentId: document.id };
}

function createChunk(
  db: Database.Database,
  documentId: string,
  ordinal: number,
  text: string
) {
  const [chunk] = insertChunks(db, documentId, [
    {
      document_id: documentId,
      ordinal,
      text,
      text_hash: hashText(text),
      start_char: ordinal * 1000,
      end_char: ordinal * 1000 + text.length
    }
  ]);
  if (!chunk) {
    throw new Error("Failed to insert test chunk");
  }
  return chunk;
}

function insertEvidenceBackedClaim(args: {
  db: Database.Database;
  entityId: string;
  field: string;
  valueJson: string;
  status: "inferred" | "confirmed";
  chunkId: string;
  chunkText: string;
  quote: string;
}) {
  const claim = insertClaim(args.db, {
    entityId: args.entityId,
    field: args.field,
    valueJson: args.valueJson,
    status: args.status,
    confidence: 0.9
  });
  const quoteStart = args.chunkText.indexOf(args.quote);
  if (quoteStart < 0) {
    throw new Error(`Quote "${args.quote}" not found in chunk text`);
  }
  insertClaimEvidence(args.db, {
    claimId: claim.id,
    chunkId: args.chunkId,
    quoteStart,
    quoteEnd: quoteStart + args.quote.length
  });
  return claim;
}

describe("runContinuityChecks", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    tempRoots.length = 0;
  });

  it("creates a high-severity issue when confirmed and inferred values conflict", () => {
    const setup = setupDb();
    tempRoots.push(setup.rootPath);
    const entity = createEntity(setup.db, {
      projectId: setup.projectId,
      type: "character",
      displayName: "Rhea"
    });
    const blueChunk = createChunk(setup.db, setup.documentId, 0, "Rhea's eyes were blue in the morning.");
    const greenChunk = createChunk(
      setup.db,
      setup.documentId,
      1,
      "By dusk, the records described her eyes as green."
    );

    insertEvidenceBackedClaim({
      db: setup.db,
      entityId: entity.id,
      field: "eye_color",
      valueJson: JSON.stringify("blue"),
      status: "inferred",
      chunkId: blueChunk.id,
      chunkText: blueChunk.text,
      quote: "blue"
    });
    insertEvidenceBackedClaim({
      db: setup.db,
      entityId: entity.id,
      field: "eye_color",
      valueJson: JSON.stringify("green"),
      status: "confirmed",
      chunkId: greenChunk.id,
      chunkText: greenChunk.text,
      quote: "green"
    });

    runContinuityChecks(setup.db, setup.projectId);

    const continuityIssues = listIssuesWithEvidence(setup.db, setup.projectId).filter(
      (issue) => issue.type === "continuity"
    );
    expect(continuityIssues).toHaveLength(1);
    const issue = continuityIssues[0]!;
    expect(issue.severity).toBe("high");
    expect(issue.title).toContain("Rhea");
    expect(issue.title).toContain("eye_color");
    expect(issue.description).toContain("Confirmed canon and draft evidence disagree");
    expect(issue.evidence).toHaveLength(2);
    expect(issue.evidence.map((evidence) => evidence.chunkId)).toEqual(
      expect.arrayContaining([blueChunk.id, greenChunk.id])
    );
  });

  it("normalizes case and numeric strings but still detects whitespace and hyphen conflicts", () => {
    const setup = setupDb();
    tempRoots.push(setup.rootPath);
    const entity = createEntity(setup.db, {
      projectId: setup.projectId,
      type: "character",
      displayName: "Kade"
    });
    const chunks = [
      createChunk(setup.db, setup.documentId, 0, "Kade answered to the codename Stormblade."),
      createChunk(setup.db, setup.documentId, 1, "By chapter two, the reports called him stormblade."),
      createChunk(setup.db, setup.documentId, 2, "The ledger listed his age as 42."),
      createChunk(setup.db, setup.documentId, 3, "A second witness confirmed he was 42 years old."),
      createChunk(setup.db, setup.documentId, 4, "His call sign was North Star."),
      createChunk(setup.db, setup.documentId, 5, "Static repeated the tag north star ."),
      createChunk(setup.db, setup.documentId, 6, "Scouts marked the route as north-west."),
      createChunk(setup.db, setup.documentId, 7, "Maps elsewhere wrote the same route as north west.")
    ];

    insertEvidenceBackedClaim({
      db: setup.db,
      entityId: entity.id,
      field: "codename",
      valueJson: JSON.stringify("Stormblade"),
      status: "inferred",
      chunkId: chunks[0]!.id,
      chunkText: chunks[0]!.text,
      quote: "Stormblade"
    });
    insertEvidenceBackedClaim({
      db: setup.db,
      entityId: entity.id,
      field: "codename",
      valueJson: JSON.stringify("stormblade"),
      status: "inferred",
      chunkId: chunks[1]!.id,
      chunkText: chunks[1]!.text,
      quote: "stormblade"
    });
    insertEvidenceBackedClaim({
      db: setup.db,
      entityId: entity.id,
      field: "age",
      valueJson: JSON.stringify("42"),
      status: "inferred",
      chunkId: chunks[2]!.id,
      chunkText: chunks[2]!.text,
      quote: "42"
    });
    insertEvidenceBackedClaim({
      db: setup.db,
      entityId: entity.id,
      field: "age",
      valueJson: "42",
      status: "inferred",
      chunkId: chunks[3]!.id,
      chunkText: chunks[3]!.text,
      quote: "42"
    });
    insertEvidenceBackedClaim({
      db: setup.db,
      entityId: entity.id,
      field: "call_sign",
      valueJson: JSON.stringify("North Star"),
      status: "inferred",
      chunkId: chunks[4]!.id,
      chunkText: chunks[4]!.text,
      quote: "North Star"
    });
    insertEvidenceBackedClaim({
      db: setup.db,
      entityId: entity.id,
      field: "call_sign",
      valueJson: JSON.stringify("north star "),
      status: "inferred",
      chunkId: chunks[5]!.id,
      chunkText: chunks[5]!.text,
      quote: "north star "
    });
    insertEvidenceBackedClaim({
      db: setup.db,
      entityId: entity.id,
      field: "route_name",
      valueJson: JSON.stringify("north-west"),
      status: "inferred",
      chunkId: chunks[6]!.id,
      chunkText: chunks[6]!.text,
      quote: "north-west"
    });
    insertEvidenceBackedClaim({
      db: setup.db,
      entityId: entity.id,
      field: "route_name",
      valueJson: JSON.stringify("north west"),
      status: "inferred",
      chunkId: chunks[7]!.id,
      chunkText: chunks[7]!.text,
      quote: "north west"
    });

    runContinuityChecks(setup.db, setup.projectId);

    const continuityIssues = listIssuesWithEvidence(setup.db, setup.projectId).filter(
      (issue) => issue.type === "continuity"
    );
    const titles = continuityIssues.map((issue) => issue.title);
    expect(continuityIssues).toHaveLength(2);
    expect(continuityIssues.every((issue) => issue.severity === "medium")).toBe(true);
    expect(titles.some((title) => title.includes("call_sign"))).toBe(true);
    expect(titles.some((title) => title.includes("route_name"))).toBe(true);
    expect(titles.some((title) => title.includes("codename"))).toBe(false);
    expect(titles.some((title) => title.includes("age"))).toBe(false);
  });

  it("does not create false positives when claims are on different fields", () => {
    const setup = setupDb();
    tempRoots.push(setup.rootPath);
    const entity = createEntity(setup.db, {
      projectId: setup.projectId,
      type: "character",
      displayName: "Ivo"
    });
    const speciesChunk = createChunk(setup.db, setup.documentId, 0, "Ivo is human.");
    const weaponChunk = createChunk(setup.db, setup.documentId, 1, "Ivo carries a spear.");

    insertEvidenceBackedClaim({
      db: setup.db,
      entityId: entity.id,
      field: "species",
      valueJson: JSON.stringify("human"),
      status: "inferred",
      chunkId: speciesChunk.id,
      chunkText: speciesChunk.text,
      quote: "human"
    });
    insertEvidenceBackedClaim({
      db: setup.db,
      entityId: entity.id,
      field: "weapon",
      valueJson: JSON.stringify("spear"),
      status: "inferred",
      chunkId: weaponChunk.id,
      chunkText: weaponChunk.text,
      quote: "spear"
    });

    runContinuityChecks(setup.db, setup.projectId);

    const continuityIssues = listIssuesWithEvidence(setup.db, setup.projectId).filter(
      (issue) => issue.type === "continuity"
    );
    expect(continuityIssues).toHaveLength(0);
  });

  it("incrementally clears targeted continuity issues and preserves unrelated ones", () => {
    const setup = setupDb();
    tempRoots.push(setup.rootPath);
    const mira = createEntity(setup.db, {
      projectId: setup.projectId,
      type: "character",
      displayName: "Mira"
    });
    const dax = createEntity(setup.db, {
      projectId: setup.projectId,
      type: "character",
      displayName: "Dax"
    });
    const miraBlue = createChunk(setup.db, setup.documentId, 0, "Mira's mantle looked blue.");
    const miraRed = createChunk(setup.db, setup.documentId, 1, "The archive insisted Mira's mantle was red.");
    const daxCaptain = createChunk(setup.db, setup.documentId, 2, "Dax was listed as captain.");
    const daxLieutenant = createChunk(setup.db, setup.documentId, 3, "Another record named Dax a lieutenant.");
    const miraSilver = createChunk(setup.db, setup.documentId, 4, "After the storm, Mira's mantle appeared silver.");
    const miraGold = createChunk(setup.db, setup.documentId, 5, "A new witness swore Mira's mantle was gold.");

    const miraInferred = insertEvidenceBackedClaim({
      db: setup.db,
      entityId: mira.id,
      field: "mantle_color",
      valueJson: JSON.stringify("blue"),
      status: "inferred",
      chunkId: miraBlue.id,
      chunkText: miraBlue.text,
      quote: "blue"
    });
    const miraConfirmed = insertEvidenceBackedClaim({
      db: setup.db,
      entityId: mira.id,
      field: "mantle_color",
      valueJson: JSON.stringify("red"),
      status: "confirmed",
      chunkId: miraRed.id,
      chunkText: miraRed.text,
      quote: "red"
    });
    insertEvidenceBackedClaim({
      db: setup.db,
      entityId: dax.id,
      field: "rank",
      valueJson: JSON.stringify("captain"),
      status: "inferred",
      chunkId: daxCaptain.id,
      chunkText: daxCaptain.text,
      quote: "captain"
    });
    insertEvidenceBackedClaim({
      db: setup.db,
      entityId: dax.id,
      field: "rank",
      valueJson: JSON.stringify("lieutenant"),
      status: "inferred",
      chunkId: daxLieutenant.id,
      chunkText: daxLieutenant.text,
      quote: "lieutenant"
    });

    runContinuityChecks(setup.db, setup.projectId);

    const initialContinuityIssues = listIssuesWithEvidence(setup.db, setup.projectId).filter(
      (issue) => issue.type === "continuity"
    );
    expect(initialContinuityIssues).toHaveLength(2);
    const oldMiraIssue = initialContinuityIssues.find(
      (issue) => issue.title.includes("Mira") && issue.title.includes("mantle_color")
    );
    const daxIssue = initialContinuityIssues.find(
      (issue) => issue.title.includes("Dax") && issue.title.includes("rank")
    );
    expect(oldMiraIssue).toBeTruthy();
    expect(daxIssue).toBeTruthy();
    if (!oldMiraIssue || !daxIssue) {
      throw new Error("Expected continuity issues for both Mira and Dax");
    }

    const repetitionIssue = insertIssue(setup.db, {
      projectId: setup.projectId,
      type: "repetition",
      severity: "low",
      title: "Repeated phrase",
      description: "Phrase repeats in nearby passages."
    });
    insertIssueEvidence(setup.db, {
      issueId: repetitionIssue.id,
      chunkId: miraBlue.id,
      quoteStart: 0,
      quoteEnd: 4
    });

    setup.db
      .prepare("UPDATE claim SET status = 'superseded' WHERE id IN (?, ?)")
      .run(miraInferred.id, miraConfirmed.id);

    insertEvidenceBackedClaim({
      db: setup.db,
      entityId: mira.id,
      field: "mantle_color",
      valueJson: JSON.stringify("silver"),
      status: "inferred",
      chunkId: miraSilver.id,
      chunkText: miraSilver.text,
      quote: "silver"
    });
    insertEvidenceBackedClaim({
      db: setup.db,
      entityId: mira.id,
      field: "mantle_color",
      valueJson: JSON.stringify("gold"),
      status: "inferred",
      chunkId: miraGold.id,
      chunkText: miraGold.text,
      quote: "gold"
    });

    runContinuityChecks(setup.db, setup.projectId, { entityIds: [mira.id] });

    const allIssues = listIssuesWithEvidence(setup.db, setup.projectId, { status: "all" });
    const continuityIssues = allIssues.filter((issue) => issue.type === "continuity");
    expect(continuityIssues).toHaveLength(2);
    expect(continuityIssues.map((issue) => issue.id)).not.toContain(oldMiraIssue.id);
    expect(continuityIssues.map((issue) => issue.id)).toContain(daxIssue.id);

    const newMiraIssue = continuityIssues.find(
      (issue) =>
        issue.id !== daxIssue.id &&
        issue.title.includes("Mira") &&
        issue.title.includes("mantle_color")
    );
    expect(newMiraIssue).toBeTruthy();
    if (!newMiraIssue) {
      throw new Error("Expected new targeted continuity issue for Mira");
    }
    expect(newMiraIssue.severity).toBe("medium");
    expect(newMiraIssue.evidence.map((evidence) => evidence.chunkId)).toEqual(
      expect.arrayContaining([miraSilver.id, miraGold.id])
    );

    const preservedRepetition = allIssues.find((issue) => issue.id === repetitionIssue.id);
    expect(preservedRepetition?.type).toBe("repetition");
  });
});
