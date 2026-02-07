import type Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "./db";

function createTempRoot(tempRoots: string[]): string {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "canonkeeper-"));
  tempRoots.push(rootPath);
  return rootPath;
}

function writeMigration(dir: string, filename: string, tableName: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), `CREATE TABLE ${tableName} (id INTEGER PRIMARY KEY);`);
}

function tableExists(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { name: string } | undefined;
  return row?.name === tableName;
}

describe("openDatabase", () => {
  const tempRoots: string[] = [];
  const openDbs: Database.Database[] = [];
  const chmodRestores: Array<{ path: string; mode: number }> = [];

  afterEach(() => {
    vi.restoreAllMocks();

    for (const db of openDbs) {
      if (db.open) {
        db.close();
      }
    }
    openDbs.length = 0;

    for (const restore of chmodRestores) {
      try {
        fs.chmodSync(restore.path, restore.mode);
      } catch {
        // Ignore restore failures; cleanup below uses force.
      }
    }
    chmodRestores.length = 0;

    for (const root of tempRoots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    tempRoots.length = 0;
  });

  it("prefers process.cwd()/migrations when SQL files exist there", () => {
    const workspace = createTempRoot(tempRoots);
    const fakeCwd = path.join(workspace, "level-1", "level-2");
    fs.mkdirSync(fakeCwd, { recursive: true });

    const candidate1 = path.resolve(fakeCwd, "migrations");
    const candidate2 = path.resolve(fakeCwd, "..", "migrations");
    const candidate3 = path.resolve(fakeCwd, "..", "..", "migrations");
    writeMigration(candidate1, "001_candidate_1.sql", "marker_candidate_1");
    writeMigration(candidate2, "001_candidate_2.sql", "marker_candidate_2");
    writeMigration(candidate3, "001_candidate_3.sql", "marker_candidate_3");

    vi.spyOn(process, "cwd").mockReturnValue(fakeCwd);

    const projectRoot = createTempRoot(tempRoots);
    const handle = openDatabase({ rootPath: projectRoot });
    openDbs.push(handle.db);

    expect(tableExists(handle.db, "marker_candidate_1")).toBe(true);
    expect(tableExists(handle.db, "marker_candidate_2")).toBe(false);
    expect(tableExists(handle.db, "marker_candidate_3")).toBe(false);
  });

  it("falls back to process.cwd()/../migrations when the first candidate is missing", () => {
    const workspace = createTempRoot(tempRoots);
    const fakeCwd = path.join(workspace, "level-1", "level-2");
    fs.mkdirSync(fakeCwd, { recursive: true });

    const candidate2 = path.resolve(fakeCwd, "..", "migrations");
    const candidate3 = path.resolve(fakeCwd, "..", "..", "migrations");
    writeMigration(candidate2, "001_candidate_2.sql", "marker_candidate_2");
    writeMigration(candidate3, "001_candidate_3.sql", "marker_candidate_3");

    vi.spyOn(process, "cwd").mockReturnValue(fakeCwd);

    const projectRoot = createTempRoot(tempRoots);
    const handle = openDatabase({ rootPath: projectRoot });
    openDbs.push(handle.db);

    expect(tableExists(handle.db, "marker_candidate_2")).toBe(true);
    expect(tableExists(handle.db, "marker_candidate_3")).toBe(false);
  });

  it("falls back to process.cwd()/../../migrations when only the third candidate has SQL", () => {
    const workspace = createTempRoot(tempRoots);
    const fakeCwd = path.join(workspace, "level-1", "level-2", "level-3");
    fs.mkdirSync(fakeCwd, { recursive: true });

    const candidate3 = path.resolve(fakeCwd, "..", "..", "migrations");
    writeMigration(candidate3, "001_candidate_3.sql", "marker_candidate_3");

    vi.spyOn(process, "cwd").mockReturnValue(fakeCwd);

    const projectRoot = createTempRoot(tempRoots);
    const handle = openDatabase({ rootPath: projectRoot });
    openDbs.push(handle.db);

    expect(tableExists(handle.db, "marker_candidate_3")).toBe(true);
  });

  it("uses the module-relative migrations directory when cwd candidates have no SQL files", () => {
    const workspace = createTempRoot(tempRoots);
    const fakeCwd = path.join(workspace, "empty", "deep", "cwd");
    fs.mkdirSync(fakeCwd, { recursive: true });
    vi.spyOn(process, "cwd").mockReturnValue(fakeCwd);

    const projectRoot = createTempRoot(tempRoots);
    const handle = openDatabase({ rootPath: projectRoot });
    openDbs.push(handle.db);

    const migrationRows = handle.db
      .prepare("SELECT filename FROM schema_migrations ORDER BY filename")
      .all() as Array<{ filename: string }>;

    expect(tableExists(handle.db, "project")).toBe(true);
    expect(migrationRows.some((row) => row.filename === "001_init.sql")).toBe(true);
  });

  it("creates the database, runs migrations, and returns a working handle", () => {
    const rootPath = createTempRoot(tempRoots);
    const handle = openDatabase({ rootPath, migrationsDir: path.resolve("migrations") });
    openDbs.push(handle.db);

    expect(fs.existsSync(handle.paths.dbFile)).toBe(true);
    expect(handle.migrations.applied.length).toBeGreaterThan(0);
    expect(tableExists(handle.db, "project")).toBe(true);

    const now = Date.now();
    handle.db
      .prepare("INSERT INTO project (id, root_path, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run("project-1", rootPath, "Project One", now, now);

    const count = handle.db.prepare("SELECT COUNT(*) as count FROM project").get() as {
      count: number;
    };
    expect(count.count).toBe(1);
  });

  it("opens the database in WAL mode", () => {
    const rootPath = createTempRoot(tempRoots);
    const handle = openDatabase({ rootPath, migrationsDir: path.resolve("migrations") });
    openDbs.push(handle.db);

    const journalMode = handle.db.pragma("journal_mode", { simple: true }) as string;
    expect(journalMode.toLowerCase()).toBe("wal");
  });

  it("enforces foreign key constraints", () => {
    const rootPath = createTempRoot(tempRoots);
    const handle = openDatabase({ rootPath, migrationsDir: path.resolve("migrations") });
    openDbs.push(handle.db);

    const now = Date.now();
    expect(() =>
      handle.db
        .prepare(
          "INSERT INTO document (id, project_id, path, kind, created_at, updated_at, is_missing, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .run("doc-1", "missing-project", "manuscript.md", "md", now, now, 0, now)
    ).toThrow(/foreign key|constraint/i);
  });

  it("throws for invalid root paths", () => {
    const rootParent = createTempRoot(tempRoots);
    const invalidRootPath = path.join(rootParent, "not-a-directory");
    fs.writeFileSync(invalidRootPath, "x");

    expect(() => openDatabase({ rootPath: invalidRootPath, migrationsDir: path.resolve("migrations") })).toThrow(
      /ENOTDIR|not a directory|EEXIST/i
    );
  });

  it("surfaces permission denied errors from storage directory creation", () => {
    const rootPath = createTempRoot(tempRoots);
    vi.spyOn(fs, "mkdirSync").mockImplementation(() => {
      const error = new Error("EACCES: permission denied");
      (error as NodeJS.ErrnoException).code = "EACCES";
      throw error;
    });

    expect(() => openDatabase({ rootPath, migrationsDir: path.resolve("migrations") })).toThrow(
      /EACCES|permission denied/i
    );
  });

  it("throws when attempting to open a corrupt sqlite database file", () => {
    const rootPath = createTempRoot(tempRoots);
    const dataDir = path.join(rootPath, ".canonkeeper");
    const dbFile = path.join(dataDir, "canonkeeper.db");
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(dbFile, Buffer.from("not a sqlite database"));

    expect(() => openDatabase({ rootPath, migrationsDir: path.resolve("migrations") })).toThrow(
      /not a database|malformed|disk image/i
    );
  });
});
