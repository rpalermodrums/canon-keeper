import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import {
  openDatabase,
  createProject,
  createDocument,
  insertChunks,
  deleteChunksByIds,
  createEntity,
  insertClaim,
  insertClaimEvidence,
  insertIssue,
  insertIssueEvidence,
  replaceScenesForDocument,
  insertSceneEvidence
} from "../storage";

function setupDb() {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "canonkeeper-"));
  const handle = openDatabase({ rootPath });
  const project = createProject(handle.db, rootPath, "Test Project");
  return { rootPath, db: handle.db, projectId: project.id };
}

type SeededGraph = {
  documentId: string;
  chunkId: string;
  claimId: string;
  issueId: string;
  sceneId: string;
};

function seedDocumentGraph(
  db: Database.Database,
  args: { projectId: string; rootPath: string; fileName: string; text: string; entityName: string }
): SeededGraph {
  const doc = createDocument(db, args.projectId, path.join(args.rootPath, args.fileName), "md");
  const [chunk] = insertChunks(db, doc.id, [
    {
      document_id: doc.id,
      ordinal: 0,
      text: args.text,
      text_hash: `hash-${args.fileName}`,
      start_char: 0,
      end_char: args.text.length
    }
  ]);
  if (!chunk) {
    throw new Error("Expected chunk to be inserted");
  }

  const entity = createEntity(db, {
    projectId: args.projectId,
    type: "character",
    displayName: args.entityName
  });
  const claim = insertClaim(db, {
    entityId: entity.id,
    field: "description",
    valueJson: JSON.stringify("evidence-backed"),
    status: "inferred",
    confidence: 0.5
  });
  insertClaimEvidence(db, {
    claimId: claim.id,
    chunkId: chunk.id,
    quoteStart: 0,
    quoteEnd: Math.min(8, args.text.length)
  });

  const issue = insertIssue(db, {
    projectId: args.projectId,
    type: "repetition",
    severity: "low",
    title: `Issue ${args.fileName}`,
    description: "Test issue"
  });
  insertIssueEvidence(db, {
    issueId: issue.id,
    chunkId: chunk.id,
    quoteStart: 0,
    quoteEnd: Math.min(8, args.text.length)
  });

  replaceScenesForDocument(db, doc.id, [
    {
      project_id: args.projectId,
      document_id: doc.id,
      ordinal: 0,
      start_chunk_id: chunk.id,
      end_chunk_id: chunk.id,
      start_char: 0,
      end_char: args.text.length,
      title: null
    }
  ]);

  const sceneRow = db
    .prepare("SELECT id FROM scene WHERE document_id = ? LIMIT 1")
    .get(doc.id) as { id: string } | undefined;
  if (!sceneRow) {
    throw new Error("Expected scene to be inserted");
  }

  insertSceneEvidence(db, {
    sceneId: sceneRow.id,
    chunkId: chunk.id,
    quoteStart: 0,
    quoteEnd: Math.min(8, args.text.length)
  });

  return {
    documentId: doc.id,
    chunkId: chunk.id,
    claimId: claim.id,
    issueId: issue.id,
    sceneId: sceneRow.id
  };
}

function deleteDocumentGraph(db: Database.Database, documentId: string): void {
  const claimIds = (
    db
      .prepare(
        `SELECT DISTINCT ce.claim_id AS id
         FROM claim_evidence ce
         JOIN chunk c ON c.id = ce.chunk_id
         WHERE c.document_id = ?`
      )
      .all(documentId) as Array<{ id: string }>
  ).map((row) => row.id);

  const issueIds = (
    db
      .prepare(
        `SELECT DISTINCT ie.issue_id AS id
         FROM issue_evidence ie
         JOIN chunk c ON c.id = ie.chunk_id
         WHERE c.document_id = ?`
      )
      .all(documentId) as Array<{ id: string }>
  ).map((row) => row.id);

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM scene WHERE document_id = ?").run(documentId);
    for (const claimId of claimIds) {
      db.prepare("DELETE FROM claim WHERE id = ?").run(claimId);
    }
    for (const issueId of issueIds) {
      db.prepare("DELETE FROM issue WHERE id = ?").run(issueId);
    }
    db.prepare("DELETE FROM chunk WHERE document_id = ?").run(documentId);
    db.prepare("DELETE FROM document_snapshot WHERE document_id = ?").run(documentId);
    db.prepare("DELETE FROM document_processing_state WHERE document_id = ?").run(documentId);
    db.prepare("DELETE FROM document WHERE id = ?").run(documentId);
  });
  tx();
}

describe("cascade cleanup", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    tempRoots.length = 0;
  });

  it("removes evidence rows when chunks are deleted", () => {
    const setup = setupDb();
    tempRoots.push(setup.rootPath);

    const doc = createDocument(setup.db, setup.projectId, path.join(setup.rootPath, "draft.md"), "md");
    const [chunk] = insertChunks(setup.db, doc.id, [
      {
        document_id: doc.id,
        ordinal: 0,
        text: "A quick brown fox.",
        text_hash: "hash",
        start_char: 0,
        end_char: 20
      }
    ]);
    if (!chunk) {
      throw new Error("Expected chunk to be inserted");
    }

    const entity = createEntity(setup.db, { projectId: setup.projectId, type: "character", displayName: "Mira" });
    const claim = insertClaim(setup.db, {
      entityId: entity.id,
      field: "description",
      valueJson: JSON.stringify("quick"),
      status: "inferred",
      confidence: 0.5
    });
    insertClaimEvidence(setup.db, {
      claimId: claim.id,
      chunkId: chunk.id,
      quoteStart: 0,
      quoteEnd: 5
    });

    const issue = insertIssue(setup.db, {
      projectId: setup.projectId,
      type: "repetition",
      severity: "low",
      title: "Test",
      description: "Test"
    });
    insertIssueEvidence(setup.db, {
      issueId: issue.id,
      chunkId: chunk.id,
      quoteStart: 0,
      quoteEnd: 5
    });

    replaceScenesForDocument(setup.db, doc.id, [
      {
        project_id: setup.projectId,
        document_id: doc.id,
        ordinal: 0,
        start_chunk_id: chunk.id,
        end_chunk_id: chunk.id,
        start_char: 0,
        end_char: 20,
        title: null
      }
    ]);
    const sceneId = setup.db
      .prepare("SELECT id FROM scene WHERE document_id = ? LIMIT 1")
      .get(doc.id) as { id: string };
    insertSceneEvidence(setup.db, {
      sceneId: sceneId.id,
      chunkId: chunk.id,
      quoteStart: 0,
      quoteEnd: 5
    });

    deleteChunksByIds(setup.db, [chunk.id]);

    const claimEvidenceCount = setup.db
      .prepare("SELECT COUNT(*) as count FROM claim_evidence WHERE chunk_id = ?")
      .get(chunk.id) as { count: number };
    const issueEvidenceCount = setup.db
      .prepare("SELECT COUNT(*) as count FROM issue_evidence WHERE chunk_id = ?")
      .get(chunk.id) as { count: number };
    const sceneEvidenceCount = setup.db
      .prepare("SELECT COUNT(*) as count FROM scene_evidence WHERE chunk_id = ?")
      .get(chunk.id) as { count: number };

    expect(claimEvidenceCount.count).toBe(0);
    expect(issueEvidenceCount.count).toBe(0);
    expect(sceneEvidenceCount.count).toBe(0);
  });

  it("cascades cleanup across scene and evidence tables when deleting a document graph", () => {
    const setup = setupDb();
    tempRoots.push(setup.rootPath);

    const graph = seedDocumentGraph(setup.db, {
      projectId: setup.projectId,
      rootPath: setup.rootPath,
      fileName: "doc-a.md",
      text: "A quick brown fox jumps.",
      entityName: "Mira"
    });

    deleteDocumentGraph(setup.db, graph.documentId);

    const counts = {
      document: setup.db
        .prepare("SELECT COUNT(*) as count FROM document WHERE id = ?")
        .get(graph.documentId) as { count: number },
      chunk: setup.db
        .prepare("SELECT COUNT(*) as count FROM chunk WHERE id = ?")
        .get(graph.chunkId) as { count: number },
      scene: setup.db
        .prepare("SELECT COUNT(*) as count FROM scene WHERE id = ?")
        .get(graph.sceneId) as { count: number },
      sceneMeta: setup.db
        .prepare("SELECT COUNT(*) as count FROM scene_metadata WHERE scene_id = ?")
        .get(graph.sceneId) as { count: number },
      sceneEvidence: setup.db
        .prepare("SELECT COUNT(*) as count FROM scene_evidence WHERE scene_id = ?")
        .get(graph.sceneId) as { count: number },
      claim: setup.db
        .prepare("SELECT COUNT(*) as count FROM claim WHERE id = ?")
        .get(graph.claimId) as { count: number },
      claimEvidence: setup.db
        .prepare("SELECT COUNT(*) as count FROM claim_evidence WHERE claim_id = ?")
        .get(graph.claimId) as { count: number },
      issue: setup.db
        .prepare("SELECT COUNT(*) as count FROM issue WHERE id = ?")
        .get(graph.issueId) as { count: number },
      issueEvidence: setup.db
        .prepare("SELECT COUNT(*) as count FROM issue_evidence WHERE issue_id = ?")
        .get(graph.issueId) as { count: number }
    };

    expect(counts.document.count).toBe(0);
    expect(counts.chunk.count).toBe(0);
    expect(counts.scene.count).toBe(0);
    expect(counts.sceneMeta.count).toBe(0);
    expect(counts.sceneEvidence.count).toBe(0);
    expect(counts.claim.count).toBe(0);
    expect(counts.claimEvidence.count).toBe(0);
    expect(counts.issue.count).toBe(0);
    expect(counts.issueEvidence.count).toBe(0);
  });

  it("only cascades chunk-dependent tables when chunks are deleted", () => {
    const setup = setupDb();
    tempRoots.push(setup.rootPath);

    const graph = seedDocumentGraph(setup.db, {
      projectId: setup.projectId,
      rootPath: setup.rootPath,
      fileName: "doc-b.md",
      text: "Lantern light in the hall.",
      entityName: "Rowan"
    });

    deleteChunksByIds(setup.db, [graph.chunkId]);

    const claimEvidence = setup.db
      .prepare("SELECT COUNT(*) as count FROM claim_evidence WHERE claim_id = ?")
      .get(graph.claimId) as { count: number };
    const issueEvidence = setup.db
      .prepare("SELECT COUNT(*) as count FROM issue_evidence WHERE issue_id = ?")
      .get(graph.issueId) as { count: number };
    const sceneEvidence = setup.db
      .prepare("SELECT COUNT(*) as count FROM scene_evidence WHERE scene_id = ?")
      .get(graph.sceneId) as { count: number };
    const claim = setup.db
      .prepare("SELECT COUNT(*) as count FROM claim WHERE id = ?")
      .get(graph.claimId) as { count: number };
    const issue = setup.db
      .prepare("SELECT COUNT(*) as count FROM issue WHERE id = ?")
      .get(graph.issueId) as { count: number };
    const scene = setup.db
      .prepare("SELECT COUNT(*) as count FROM scene WHERE id = ?")
      .get(graph.sceneId) as { count: number };

    expect(claimEvidence.count).toBe(0);
    expect(issueEvidence.count).toBe(0);
    expect(sceneEvidence.count).toBe(0);
    expect(claim.count).toBe(1);
    expect(issue.count).toBe(1);
    expect(scene.count).toBe(1);
  });

  it("preserves unrelated document data when deleting one document graph", () => {
    const setup = setupDb();
    tempRoots.push(setup.rootPath);

    const graphA = seedDocumentGraph(setup.db, {
      projectId: setup.projectId,
      rootPath: setup.rootPath,
      fileName: "doc-c-a.md",
      text: "First doc text",
      entityName: "Ari"
    });
    const graphB = seedDocumentGraph(setup.db, {
      projectId: setup.projectId,
      rootPath: setup.rootPath,
      fileName: "doc-c-b.md",
      text: "Second doc text",
      entityName: "Bea"
    });

    deleteDocumentGraph(setup.db, graphA.documentId);

    const docCount = setup.db
      .prepare("SELECT COUNT(*) as count FROM document")
      .get() as { count: number };
    const remainingChunk = setup.db
      .prepare("SELECT COUNT(*) as count FROM chunk WHERE id = ?")
      .get(graphB.chunkId) as { count: number };
    const remainingClaim = setup.db
      .prepare("SELECT COUNT(*) as count FROM claim WHERE id = ?")
      .get(graphB.claimId) as { count: number };
    const remainingSceneEvidence = setup.db
      .prepare("SELECT COUNT(*) as count FROM scene_evidence WHERE scene_id = ?")
      .get(graphB.sceneId) as { count: number };

    expect(docCount.count).toBe(1);
    expect(remainingChunk.count).toBe(1);
    expect(remainingClaim.count).toBe(1);
    expect(remainingSceneEvidence.count).toBe(1);
  });

  it("enforces foreign key constraints for evidence and direct document deletion", () => {
    const setup = setupDb();
    tempRoots.push(setup.rootPath);

    const graph = seedDocumentGraph(setup.db, {
      projectId: setup.projectId,
      rootPath: setup.rootPath,
      fileName: "doc-d.md",
      text: "Constraint test text",
      entityName: "Caro"
    });

    expect(() =>
      insertClaimEvidence(setup.db, {
        claimId: graph.claimId,
        chunkId: "missing-chunk",
        quoteStart: 0,
        quoteEnd: 4
      })
    ).toThrowError(/FOREIGN KEY constraint failed/);

    expect(() =>
      setup.db.prepare("DELETE FROM document WHERE id = ?").run(graph.documentId)
    ).toThrowError(/FOREIGN KEY constraint failed/);
  });
});
