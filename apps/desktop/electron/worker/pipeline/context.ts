import type Database from "better-sqlite3";

export type PipelineContext = {
  db: Database.Database;
  projectId: string;
  documentId: string;
  snapshotId: string;
  rootPath: string;
};
