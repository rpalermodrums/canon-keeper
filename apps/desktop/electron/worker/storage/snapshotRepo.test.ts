import type Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createDocument,
  createProject,
  getLatestSnapshot,
  insertSnapshot,
  listSnapshotSummaries,
  openDatabase
} from "./index";
import type { SnapshotSummary } from "./snapshotRepo";

type SetupResult = {
  rootPath: string;
  db: Database.Database;
  projectId: string;
  documentId: string;
  documentPath: string;
};

function setupDb(): SetupResult {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "canonkeeper-"));
  const handle = openDatabase({ rootPath });
  const project = createProject(handle.db, rootPath, "Test Project");
  const documentPath = path.join(rootPath, "chapter-01.md");
  const document = createDocument(handle.db, project.id, documentPath, "md");

  return {
    rootPath,
    db: handle.db,
    projectId: project.id,
    documentId: document.id,
    documentPath
  };
}

describe("snapshotRepo", () => {
  const tempRoots: string[] = [];
  const openDbs: Database.Database[] = [];

  afterEach(() => {
    vi.restoreAllMocks();

    for (const db of openDbs) {
      if (db.open) {
        db.close();
      }
    }
    openDbs.length = 0;

    for (const root of tempRoots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    tempRoots.length = 0;
  });

  it("deduplicates snapshots by hash and returns the existing row", () => {
    const setup = setupDb();
    tempRoots.push(setup.rootPath);
    openDbs.push(setup.db);

    const now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);

    const first = insertSnapshot(setup.db, setup.documentId, "Opening line.", "hash-a");
    const second = insertSnapshot(setup.db, setup.documentId, "Opening line.", "hash-a");

    const count = setup.db
      .prepare("SELECT COUNT(*) as count FROM document_snapshot WHERE document_id = ?")
      .get(setup.documentId) as { count: number };

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.snapshot).toEqual(first.snapshot);
    expect(count.count).toBe(1);
  });

  it("creates a new snapshot when the hash changes", () => {
    const setup = setupDb();
    tempRoots.push(setup.rootPath);
    openDbs.push(setup.db);

    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(1_700_000_000_010).mockReturnValueOnce(1_700_000_000_020);

    const first = insertSnapshot(setup.db, setup.documentId, "Opening line.", "hash-a");
    const second = insertSnapshot(setup.db, setup.documentId, "Updated opening line.", "hash-b");

    const count = setup.db
      .prepare("SELECT COUNT(*) as count FROM document_snapshot WHERE document_id = ?")
      .get(setup.documentId) as { count: number };

    expect(first.created).toBe(true);
    expect(second.created).toBe(true);
    expect(second.snapshot.id).not.toBe(first.snapshot.id);
    expect(second.snapshot.version).toBe(2);
    expect(second.snapshot.full_text_hash).toBe("hash-b");
    expect(count.count).toBe(2);
  });

  it("returns the expected latest snapshot and persists retrievable row data by id", () => {
    const setup = setupDb();
    tempRoots.push(setup.rootPath);
    openDbs.push(setup.db);

    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(1_700_000_000_100).mockReturnValueOnce(1_700_000_000_200);

    insertSnapshot(setup.db, setup.documentId, "Version one.", "hash-v1");
    const latestInsert = insertSnapshot(setup.db, setup.documentId, "Version two.", "hash-v2");

    const latest = getLatestSnapshot(setup.db, setup.documentId);
    const byId = setup.db
      .prepare(
        "SELECT id, document_id, version, full_text, full_text_hash, created_at FROM document_snapshot WHERE id = ?"
      )
      .get(latestInsert.snapshot.id) as SnapshotSummary | undefined;

    expect(latest).not.toBeNull();
    expect(latest?.id).toBe(latestInsert.snapshot.id);
    expect(latest?.version).toBe(2);
    expect(byId).toEqual(latestInsert.snapshot);
  });

  it("lists snapshot summaries in descending created_at order", () => {
    const setup = setupDb();
    tempRoots.push(setup.rootPath);
    openDbs.push(setup.db);

    const secondPath = path.join(setup.rootPath, "chapter-02.md");
    const secondDocument = createDocument(setup.db, setup.projectId, secondPath, "md");

    const nowSpy = vi.spyOn(Date, "now");
    nowSpy
      .mockReturnValueOnce(1_700_000_001_000)
      .mockReturnValueOnce(1_700_000_001_100)
      .mockReturnValueOnce(1_700_000_001_200);

    const first = insertSnapshot(setup.db, setup.documentId, "Doc one v1", "doc1-v1");
    const second = insertSnapshot(setup.db, setup.documentId, "Doc one v2", "doc1-v2");
    const third = insertSnapshot(setup.db, secondDocument.id, "Doc two v1", "doc2-v1");

    const summaries = listSnapshotSummaries(setup.db, setup.projectId, 10);

    expect(summaries).toHaveLength(3);
    expect(summaries.map((entry) => entry.id)).toEqual([
      third.snapshot.id,
      second.snapshot.id,
      first.snapshot.id
    ]);
    expect(summaries[0]?.document_path).toBe(secondPath);
    expect(summaries[1]?.document_path).toBe(setup.documentPath);
    expect(summaries[2]?.version).toBe(1);
  });
});
