import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { ensureStorageDirs, getStoragePaths } from "./paths";
import { runMigrations, type MigrationResult } from "./migrations";

export type DatabaseHandle = {
  db: Database.Database;
  paths: ReturnType<typeof getStoragePaths>;
  migrations: MigrationResult;
};

export type OpenDatabaseOptions = {
  rootPath: string;
  migrationsDir?: string;
};

function hasSqlMigrations(dir: string): boolean {
  if (!fs.existsSync(dir)) {
    return false;
  }
  return fs.readdirSync(dir).some((name) => name.endsWith(".sql"));
}

function resolveMigrationsDir(explicitDir?: string): string {
  if (explicitDir) {
    return explicitDir;
  }

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), "migrations"),
    path.resolve(process.cwd(), "..", "migrations"),
    path.resolve(process.cwd(), "..", "..", "migrations"),
    path.resolve(moduleDir, "../../../../../migrations")
  ];

  for (const candidate of candidates) {
    if (hasSqlMigrations(candidate)) {
      return candidate;
    }
  }

  return candidates[0]!;
}

export function openDatabase(options: OpenDatabaseOptions): DatabaseHandle {
  const paths = getStoragePaths(options.rootPath);
  ensureStorageDirs(paths);

  let db: Database.Database;
  try {
    db = new Database(paths.dbFile);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown database error";
    if (message.includes("NODE_MODULE_VERSION") || message.includes("better_sqlite3.node")) {
      const runtimeLabel = process.versions.bun
        ? `Bun ${process.versions.bun} (Node compat ${process.versions.node})`
        : `Node ${process.versions.node}`;
      throw new Error(
        `Failed to load better-sqlite3 native module for ${runtimeLabel}. Reinstall dependencies with \`bun install\` (or \`npm rebuild better-sqlite3\`) before starting CanonKeeper.`
      );
    }
    throw error;
  }
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const migrationsDir = resolveMigrationsDir(options.migrationsDir);
  const migrations = runMigrations(db, migrationsDir);
  if (migrations.applied.length === 0 && migrations.skipped.length === 0) {
    db.close();
    throw new Error(`No SQL migrations found in ${migrationsDir}`);
  }

  return { db, paths, migrations };
}
