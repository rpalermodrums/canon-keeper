import type { IngestResult } from "../pipeline/ingest";

export type IngestJob = {
  type: "INGEST_DOCUMENT";
  payload: {
    projectId: string;
    filePath: string;
  };
};

export type IngestJobResult = IngestResult;

export type StageJob =
  | {
      type: "RUN_SCENES";
      payload: { projectId: string; documentId: string; snapshotId: string; rootPath: string };
    }
  | {
      type: "RUN_STYLE";
      payload: { projectId: string; documentId: string; snapshotId: string; rootPath: string };
    }
  | {
      type: "RUN_EXTRACTION";
      payload: {
        projectId: string;
        documentId: string;
        snapshotId: string;
        rootPath: string;
        changeStart: number | null;
        changeEnd: number | null;
      };
    }
  | {
      type: "RUN_CONTINUITY";
      payload: {
        projectId: string;
        documentId: string;
        snapshotId: string;
        rootPath: string;
        entityIds: string[];
      };
    };

export type WorkerJob = IngestJob | StageJob;

export type WorkerJobResult = IngestJobResult | { ok: true };
