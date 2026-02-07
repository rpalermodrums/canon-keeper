export {};

type WorkerStatus = {
  state: "idle" | "busy";
  phase: "idle" | "ingest" | "extract" | "style" | "continuity" | "export" | "error";
  lastJob?: string;
  activeJobLabel: string | null;
  projectId?: string | null;
  queueDepth?: number;
  lastSuccessfulRunAt: string | null;
  workerState?: "ready" | "restarting" | "down";
  lastError: { subsystem: string; message: string } | null;
};

type SearchResult = {
  chunkId: string;
  documentId: string;
  documentPath: string;
  ordinal: number;
  text: string;
  snippet: string;
  score: number;
};

type AskResponse =
  | {
      kind: "answer";
      answer: string;
      confidence: number;
      citations: Array<{ chunkId: string; quoteStart: number; quoteEnd: number }>;
    }
  | {
      kind: "snippets";
      snippets: SearchResult[];
    }
  | {
      kind: "not_found";
      reason: string;
    };

type SystemHealthCheck = {
  ipc: "ok" | "down";
  worker: "ok" | "down";
  sqlite: "ok" | "missing_native" | "error";
  writable: "ok" | "error";
  details: string[];
};

type ProjectDiagnostics = SystemHealthCheck & {
  recommendations: string[];
};

type ExportRunResult =
  | {
      ok: true;
      files: string[];
      elapsedMs: number;
    }
  | {
      ok: false;
      error: string;
    };

declare global {
  interface Window {
    canonkeeper?: {
      ping: () => Promise<{ ok: boolean }>;
      getFixturePath: () => Promise<string | null>;
      dialog: {
        pickProjectRoot: () => Promise<string | null>;
        pickDocument: () => Promise<string | null>;
        pickExportDir: () => Promise<string | null>;
      };
      project: {
        createOrOpen: (payload: { rootPath: string; name?: string }) => Promise<{
          id: string;
          root_path: string;
          name: string;
          created_at: number;
          updated_at: number;
        }>;
        getStatus: () => Promise<WorkerStatus>;
        subscribeStatus: () => Promise<WorkerStatus>;
        getDiagnostics: () => Promise<ProjectDiagnostics>;
        getProcessingState: () => Promise<
          Array<{
            document_id: string;
            snapshot_id: string;
            stage: string;
            status: string;
            error: string | null;
            updated_at: number;
            document_path: string;
          }>
        >;
        getHistory: () => Promise<{
          snapshots: Array<{
            id: string;
            document_id: string;
            document_path: string;
            version: number;
            created_at: number;
          }>;
          events: Array<{
            id: string;
            project_id: string;
            ts: number;
            level: "info" | "warn" | "error";
            event_type: string;
            payload_json: string;
          }>;
        }>;
        addDocument: (payload: { path: string }) => Promise<{
          documentId: string;
          snapshotId: string;
          snapshotCreated: boolean;
          chunksCreated: number;
          chunksUpdated: number;
          chunksDeleted: number;
          changeStart: number | null;
          changeEnd: number | null;
        }>;
        stats: () => Promise<{
          totalPassages: number;
          totalDocuments: number;
          totalScenes: number;
          totalIssues: number;
        }>;
        evidenceCoverage: () => Promise<{
          issues: { total: number; withEvidence: number };
          scenes: { total: number; withEvidence: number };
        }>;
      };
      system: {
        healthCheck: () => Promise<SystemHealthCheck>;
      };
      search: {
        ask: (payload: { question: string }) => Promise<AskResponse>;
        query: (payload: { query: string }) => Promise<{
          query: string;
          results: SearchResult[];
        }>;
      };
      scenes: {
        list: () => Promise<
          Array<{
            id: string;
            project_id: string;
            document_id: string;
            ordinal: number;
            start_chunk_id: string;
            end_chunk_id: string;
            start_char: number;
            end_char: number;
            title: string | null;
            pov_mode: string;
            pov_entity_id: string | null;
            setting_entity_id: string | null;
            setting_text: string | null;
          }>
        >;
        get: (payload: { sceneId: string }) => Promise<{
          scene: {
            id: string;
            project_id: string;
            document_id: string;
            ordinal: number;
            start_chunk_id: string;
            end_chunk_id: string;
            start_char: number;
            end_char: number;
            title: string | null;
            pov_mode: string;
            pov_entity_id: string | null;
            setting_entity_id: string | null;
            setting_text: string | null;
          };
          chunks: Array<{
            id: string;
            ordinal: number;
            text: string;
            start_char: number;
            end_char: number;
          }>;
          evidence: Array<{
            chunkId: string;
            documentPath: string | null;
            chunkOrdinal: number | null;
            quoteStart: number;
            quoteEnd: number;
            excerpt: string;
            lineStart: number | null;
            lineEnd: number | null;
          }>;
        }>;
      };
      issues: {
        list: (payload?: {
          status?: "open" | "dismissed" | "resolved" | "all";
          type?: string;
          severity?: "low" | "medium" | "high";
        }) => Promise<
          Array<{
            id: string;
            project_id: string;
            type: string;
            severity: string;
            title: string;
            description: string;
            status: string;
            created_at: number;
            updated_at: number;
            evidence: Array<{
              chunkId: string;
              documentPath: string | null;
              chunkOrdinal: number | null;
              quoteStart: number;
              quoteEnd: number;
              excerpt: string;
              lineStart: number | null;
              lineEnd: number | null;
            }>;
          }>
        >;
        dismiss: (payload: { issueId: string; reason?: string }) => Promise<{ ok: boolean }>;
        undoDismiss: (payload: { issueId: string }) => Promise<{ ok: boolean }>;
        resolve: (payload: { issueId: string }) => Promise<{ ok: boolean }>;
        undoResolve: (payload: { issueId: string }) => Promise<{ ok: boolean }>;
      };
      style: {
        getReport: () => Promise<{
          repetition: unknown | null;
          tone: Array<{ scopeId: string; value: unknown }>;
          dialogueTics: Array<{ scopeId: string; value: unknown }>;
        }>;
      };
      bible: {
        listEntities: () => Promise<
          Array<{
            id: string;
            project_id: string;
            type: string;
            display_name: string;
            canonical_name: string | null;
            created_at: number;
            updated_at: number;
          }>
        >;
        getEntity: (payload: { entityId: string }) => Promise<{
          entity: {
            id: string;
            project_id: string;
            type: string;
            display_name: string;
            canonical_name: string | null;
            created_at: number;
            updated_at: number;
          };
          claims: Array<{
            claim: {
              id: string;
              entity_id: string;
              field: string;
              value_json: string;
              status: string;
              confidence: number;
              created_at: number;
              updated_at: number;
              supersedes_claim_id: string | null;
            };
            value: unknown;
            evidence: Array<{
              chunkId: string;
              documentPath: string | null;
              chunkOrdinal: number | null;
              quoteStart: number;
              quoteEnd: number;
              excerpt: string;
              lineStart: number | null;
              lineEnd: number | null;
            }>;
          }>;
        }>;
      };
      canon: {
        confirmClaim: (payload: {
          entityId: string;
          field: string;
          valueJson: string;
          sourceClaimId: string;
        }) => Promise<string>;
      };
      export: {
        run: (payload: { outDir: string; kind?: "md" | "json" }) => Promise<ExportRunResult>;
      };
      jobs: {
        list: () => Promise<
          Array<{
            id: string;
            type: string;
            status: string;
            attempts: number;
            created_at: number;
            updated_at: number;
          }>
        >;
        cancel: (payload: { jobId: string }) => Promise<{ ok: boolean }>;
      };
    };
  }
}
