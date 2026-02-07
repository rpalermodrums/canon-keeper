import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { buildChunks, type ChunkSpan } from "../chunking";
import { diffByHash, ingestDocument } from "./ingest";
import {
  createProject,
  getDocumentByPath,
  getProcessingState,
  listChunksForDocument,
  openDatabase
} from "../../storage";

type TestProjectSetup = {
  rootPath: string;
  filePath: string;
  db: Database.Database;
  projectId: string;
};

const tempRoots: string[] = [];
const tempDbs: Database.Database[] = [];

afterEach(() => {
  for (const db of tempDbs) {
    try {
      db.close();
    } catch {
      // Ignore close errors in cleanup.
    }
  }
  tempDbs.length = 0;

  for (const root of tempRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  tempRoots.length = 0;
});

function setupProject(fileName: string, initialText?: string): TestProjectSetup {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "canonkeeper-ingest-stage-"));
  const filePath = path.join(rootPath, fileName);
  if (typeof initialText === "string") {
    fs.writeFileSync(filePath, initialText, "utf8");
  }

  const dbHandle = openDatabase({ rootPath });
  const project = createProject(dbHandle.db, rootPath, "Ingest Stage Test");

  tempRoots.push(rootPath);
  tempDbs.push(dbHandle.db);

  return { rootPath, filePath, db: dbHandle.db, projectId: project.id };
}

function countSnapshotsForDocument(db: Database.Database, documentId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM document_snapshot WHERE document_id = ?")
    .get(documentId) as { count: number };
  return row.count;
}

function toStoredChunkShape(chunks: ReturnType<typeof listChunksForDocument>) {
  return chunks.map((chunk) => ({
    ordinal: chunk.ordinal,
    text: chunk.text,
    text_hash: chunk.text_hash,
    start_char: chunk.start_char,
    end_char: chunk.end_char
  }));
}

function toChunkSpanShape(chunks: ChunkSpan[]) {
  return chunks.map((chunk) => ({
    ordinal: chunk.ordinal,
    text: chunk.text,
    text_hash: chunk.text_hash,
    start_char: chunk.start,
    end_char: chunk.end
  }));
}

function makeBlock(label: string, length = 900): string {
  const token = `${label} `;
  return token.repeat(Math.ceil(length / token.length)).slice(0, length);
}

function makeChunk(hash: string, ordinal: number): ChunkSpan {
  const start = ordinal * 10;
  return {
    ordinal,
    start,
    end: start + 10,
    text: `chunk-${hash}`,
    text_hash: hash
  };
}

describe("diffByHash", () => {
  it("returns full prefix and zero suffix for identical arrays", () => {
    const existing = [
      { id: "a", text_hash: "h1" },
      { id: "b", text_hash: "h2" },
      { id: "c", text_hash: "h3" }
    ];
    const next = [makeChunk("h1", 0), makeChunk("h2", 1), makeChunk("h3", 2)];

    expect(diffByHash(existing, next)).toEqual({ prefix: 3, suffix: 0 });
  });

  it("finds matching prefix and suffix around a middle change", () => {
    const existing = [
      { id: "a", text_hash: "h1" },
      { id: "b", text_hash: "h2" },
      { id: "c", text_hash: "h3" },
      { id: "d", text_hash: "h4" }
    ];
    const next = [makeChunk("h1", 0), makeChunk("hx", 1), makeChunk("h3", 2), makeChunk("h4", 3)];

    expect(diffByHash(existing, next)).toEqual({ prefix: 1, suffix: 2 });
  });

  it("handles insertion while preserving common prefix and suffix", () => {
    const existing = [
      { id: "a", text_hash: "h1" },
      { id: "b", text_hash: "h2" },
      { id: "d", text_hash: "h4" }
    ];
    const next = [makeChunk("h1", 0), makeChunk("h2", 1), makeChunk("h3", 2), makeChunk("h4", 3)];

    expect(diffByHash(existing, next)).toEqual({ prefix: 2, suffix: 1 });
  });
});

describe("ingestDocument stage", () => {
  it("creates full chunk data for a new file", async () => {
    const text = [makeBlock("north"), makeBlock("south"), makeBlock("east")].join("\n\n");
    const setup = setupProject("draft.md", text);
    const expectedChunks = buildChunks(text);

    const result = await ingestDocument(setup.db, {
      projectId: setup.projectId,
      rootPath: setup.rootPath,
      filePath: setup.filePath
    });

    const storedChunks = listChunksForDocument(setup.db, result.documentId);
    const processingState = getProcessingState(setup.db, result.documentId, "ingest");

    expect(result.snapshotCreated).toBe(true);
    expect(result.chunksCreated).toBe(expectedChunks.length);
    expect(result.chunksUpdated).toBe(0);
    expect(result.chunksDeleted).toBe(0);
    expect(result.changeStart).toBe(0);
    expect(result.changeEnd).toBe(expectedChunks.length - 1);
    expect(toStoredChunkShape(storedChunks)).toEqual(toChunkSpanShape(expectedChunks));
    expect(processingState?.status).toBe("ok");
    expect(processingState?.snapshot_id).toBe(result.snapshotId);
  });

  it("deduplicates unchanged content and keeps chunk rows untouched", async () => {
    const text = [makeBlock("alpha"), makeBlock("bravo"), makeBlock("charlie")].join("\n\n");
    const setup = setupProject("unchanged.md", text);

    const firstIngest = await ingestDocument(setup.db, {
      projectId: setup.projectId,
      rootPath: setup.rootPath,
      filePath: setup.filePath
    });
    const chunksAfterFirst = listChunksForDocument(setup.db, firstIngest.documentId);
    const snapshotsAfterFirst = countSnapshotsForDocument(setup.db, firstIngest.documentId);

    const secondIngest = await ingestDocument(setup.db, {
      projectId: setup.projectId,
      rootPath: setup.rootPath,
      filePath: setup.filePath
    });
    const chunksAfterSecond = listChunksForDocument(setup.db, firstIngest.documentId);
    const snapshotsAfterSecond = countSnapshotsForDocument(setup.db, firstIngest.documentId);

    expect(secondIngest.snapshotCreated).toBe(false);
    expect(secondIngest.snapshotId).toBe(firstIngest.snapshotId);
    expect(secondIngest.chunksCreated).toBe(0);
    expect(secondIngest.chunksUpdated).toBe(0);
    expect(secondIngest.chunksDeleted).toBe(0);
    expect(secondIngest.changeStart).toBeNull();
    expect(secondIngest.changeEnd).toBeNull();
    expect(chunksAfterSecond).toEqual(chunksAfterFirst);
    expect(snapshotsAfterSecond).toBe(snapshotsAfterFirst);
  });

  it("replaces only changed chunks while preserving unchanged chunk ids", async () => {
    const baseBlocks = [
      makeBlock("alpha", 900),
      makeBlock("bravo", 900),
      makeBlock("charlie", 900),
      makeBlock("delta", 900)
    ];
    const initialText = baseBlocks.join("\n\n");
    const updatedText = [
      baseBlocks[0] ?? "",
      makeBlock("bravo-updated", 1200),
      baseBlocks[2] ?? "",
      baseBlocks[3] ?? ""
    ].join("\n\n");
    const setup = setupProject("modified.md", initialText);

    const firstIngest = await ingestDocument(setup.db, {
      projectId: setup.projectId,
      rootPath: setup.rootPath,
      filePath: setup.filePath
    });
    const chunksBefore = listChunksForDocument(setup.db, firstIngest.documentId);

    fs.writeFileSync(setup.filePath, updatedText, "utf8");

    const secondIngest = await ingestDocument(setup.db, {
      projectId: setup.projectId,
      rootPath: setup.rootPath,
      filePath: setup.filePath
    });
    const chunksAfter = listChunksForDocument(setup.db, firstIngest.documentId);
    const expectedUpdatedChunks = buildChunks(updatedText);

    expect(chunksBefore.length).toBe(4);
    expect(chunksAfter.length).toBe(4);
    expect(secondIngest.snapshotCreated).toBe(true);
    expect(secondIngest.chunksCreated).toBe(1);
    expect(secondIngest.chunksDeleted).toBe(1);
    expect(secondIngest.chunksUpdated).toBe(3);
    expect(secondIngest.changeStart).toBe(1);
    expect(secondIngest.changeEnd).toBe(1);

    expect(chunksAfter[0]?.id).toBe(chunksBefore[0]?.id);
    expect(chunksAfter[1]?.id).not.toBe(chunksBefore[1]?.id);
    expect(chunksAfter[2]?.id).toBe(chunksBefore[2]?.id);
    expect(chunksAfter[3]?.id).toBe(chunksBefore[3]?.id);
    expect(chunksAfter.some((chunk) => chunk.id === chunksBefore[1]?.id)).toBe(false);

    expect((chunksAfter[2]?.start_char ?? 0) > (chunksBefore[2]?.start_char ?? 0)).toBe(true);
    expect((chunksAfter[3]?.start_char ?? 0) > (chunksBefore[3]?.start_char ?? 0)).toBe(true);
    expect(chunksAfter[2]?.text_hash).toBe(chunksBefore[2]?.text_hash);
    expect(chunksAfter[3]?.text_hash).toBe(chunksBefore[3]?.text_hash);
    expect(toStoredChunkShape(chunksAfter)).toEqual(toChunkSpanShape(expectedUpdatedChunks));
  });

  it("throws for missing files before document creation", async () => {
    const setup = setupProject("missing.md");

    await expect(
      ingestDocument(setup.db, {
        projectId: setup.projectId,
        rootPath: setup.rootPath,
        filePath: setup.filePath
      })
    ).rejects.toThrow(`Document not found: ${setup.filePath}`);

    expect(getDocumentByPath(setup.db, setup.projectId, setup.filePath)).toBeNull();
  });

  it("throws for corrupt docx input without creating snapshots or chunks", async () => {
    const setup = setupProject("corrupt.docx", "this is not a valid docx binary");

    await expect(
      ingestDocument(setup.db, {
        projectId: setup.projectId,
        rootPath: setup.rootPath,
        filePath: setup.filePath
      })
    ).rejects.toThrow(/zip/i);

    const document = getDocumentByPath(setup.db, setup.projectId, setup.filePath);
    expect(document).toBeTruthy();

    if (!document) {
      return;
    }

    expect(document.kind).toBe("docx");
    expect(countSnapshotsForDocument(setup.db, document.id)).toBe(0);
    expect(listChunksForDocument(setup.db, document.id)).toHaveLength(0);
    expect(getProcessingState(setup.db, document.id, "ingest")).toBeNull();
  });
});
