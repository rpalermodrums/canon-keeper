import Database from "better-sqlite3";
import path from "node:path";
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

export function openDatabase(options: OpenDatabaseOptions): DatabaseHandle {
  const paths = getStoragePaths(options.rootPath);
  ensureStorageDirs(paths);

  let db: Database.Database;
  try {
    db = new Database(paths.dbFile);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown database error";
    if (message.includes("NODE_MODULE_VERSION") || message.includes("better_sqlite3.node")) {
      throw new Error(
        "Failed to load better-sqlite3 native module. Use Node 20 and run `pnpm install` (or `pnpm rebuild better-sqlite3`) before starting CanonKeeper."
      );
    }
    throw error;
  }
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const migrationsDir = options.migrationsDir ?? path.resolve(process.cwd(), "migrations");
  const migrations = runMigrations(db, migrationsDir);

  return { db, paths, migrations };
}
