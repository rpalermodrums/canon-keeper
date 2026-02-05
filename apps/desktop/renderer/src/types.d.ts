export {};

declare global {
  interface Window {
    canonkeeper?: {
      ping: () => Promise<{ ok: boolean }>;
      project: {
        createOrOpen: (payload: { rootPath: string; name?: string }) => Promise<{
          id: string;
          root_path: string;
          name: string;
          created_at: number;
          updated_at: number;
        }>;
        getStatus: () => Promise<{
          state: "idle" | "busy";
          lastJob?: string;
          projectId?: string | null;
          queueDepth?: number;
          workerState?: "ready" | "restarting" | "down";
          lastError?: string | null;
        }>;
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
      };
      search: {
        ask: (payload: { question: string }) => Promise<{
          answerType: "cited" | "not_found" | "snippets";
          answer: string;
          confidence: number;
          citations: Array<{ chunkId: string; quoteStart: number; quoteEnd: number }>;
          snippets?: Array<{
            chunkId: string;
            documentId: string;
            documentPath: string;
            ordinal: number;
            text: string;
            snippet: string;
            score: number;
          }>;
        }>;
        query: (payload: { query: string }) => Promise<{
          query: string;
          results: Array<{
            chunkId: string;
            documentId: string;
            documentPath: string;
            ordinal: number;
            text: string;
            snippet: string;
            score: number;
          }>;
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
          }>;
        }>;
      };
      issues: {
        list: () => Promise<
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
            }>;
          }>
        >;
        dismiss: (payload: { issueId: string }) => Promise<{ ok: boolean }>;
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
            }>;
          }>;
        }>;
      };
      canon: {
        confirmClaim: (payload: {
          entityId: string;
          field: string;
          valueJson: string;
          sourceClaimId?: string;
        }) => Promise<string>;
      };
      export: {
        run: (payload: { outDir: string; kind?: "md" | "json" }) => Promise<{ ok: boolean }>;
      };
    };
  }
}
