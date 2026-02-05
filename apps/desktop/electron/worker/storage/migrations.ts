import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";

export type MigrationResult = {
  applied: string[];
  skipped: string[];
};

function ensureSchemaTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL UNIQUE,
      applied_at INTEGER NOT NULL
    );
  `);
}

function listMigrationFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));
}

export function runMigrations(db: Database.Database, migrationsDir: string): MigrationResult {
  ensureSchemaTable(db);

  const appliedRows = db.prepare("SELECT filename FROM schema_migrations").all() as Array<{
    filename: string;
  }>;
  const applied = new Set(appliedRows.map((row) => row.filename));

  const files = listMigrationFiles(migrationsDir);
  const appliedNow: string[] = [];
  const skipped: string[] = [];

  for (const filename of files) {
    if (applied.has(filename)) {
      skipped.push(filename);
      continue;
    }

    const fullPath = path.join(migrationsDir, filename);
    const sql = fs.readFileSync(fullPath, "utf8");

    const now = Date.now();
    const run = db.transaction(() => {
      db.exec(sql);
      db.prepare(
        "INSERT INTO schema_migrations (filename, applied_at) VALUES (?, ?)"
      ).run(filename, now);
    });

    run();
    appliedNow.push(filename);
  }

  return { applied: appliedNow, skipped };
}
