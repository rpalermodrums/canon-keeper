import type { PipelineContext } from "../context";
import { runExtraction } from "../extraction";
import {
  getLatestSnapshot,
  getProcessingState,
  listChunksForDocument,
  logEvent,
  upsertProcessingState
} from "../../storage";

const STAGE = "extraction";

export async function runExtractionStage(
  ctx: PipelineContext & { changeStart: number | null; changeEnd: number | null }
): Promise<{ ok: boolean; skipped?: boolean; touchedEntityIds: string[] }> {
  const latest = getLatestSnapshot(ctx.db, ctx.documentId);
  if (!latest || latest.id !== ctx.snapshotId) {
    return { ok: true, skipped: true, touchedEntityIds: [] };
  }

  const existing = getProcessingState(ctx.db, ctx.documentId, STAGE);
  if (existing && existing.snapshot_id === ctx.snapshotId && existing.status === "ok") {
    return { ok: true, skipped: true, touchedEntityIds: [] };
  }

  upsertProcessingState(ctx.db, {
    documentId: ctx.documentId,
    snapshotId: ctx.snapshotId,
    stage: STAGE,
    status: "pending"
  });

  try {
    if (ctx.changeStart === null || ctx.changeEnd === null) {
      upsertProcessingState(ctx.db, {
        documentId: ctx.documentId,
        snapshotId: ctx.snapshotId,
        stage: STAGE,
        status: "ok"
      });
      return { ok: true, touchedEntityIds: [] };
    }

    const chunks = listChunksForDocument(ctx.db, ctx.documentId);
    const extractionRangeStart = Math.max(0, ctx.changeStart - 1);
    const extractionRangeEnd = Math.min(chunks.length - 1, ctx.changeEnd + 1);
    const extractionChunks = chunks.filter(
      (chunk) => chunk.ordinal >= extractionRangeStart && chunk.ordinal <= extractionRangeEnd
    );

    let touchedEntityIds: string[] = [];
    if (extractionChunks.length > 0) {
      const extractionResult = await runExtraction(ctx.db, {
        projectId: ctx.projectId,
        rootPath: ctx.rootPath,
        chunks: extractionChunks.map((chunk) => ({
          id: chunk.id,
          ordinal: chunk.ordinal,
          text: chunk.text
        }))
      });
      touchedEntityIds = extractionResult.touchedEntityIds;
    }

    upsertProcessingState(ctx.db, {
      documentId: ctx.documentId,
      snapshotId: ctx.snapshotId,
      stage: STAGE,
      status: "ok"
    });

    return { ok: true, touchedEntityIds };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    upsertProcessingState(ctx.db, {
      documentId: ctx.documentId,
      snapshotId: ctx.snapshotId,
      stage: STAGE,
      status: "failed",
      error: message
    });
    logEvent(ctx.db, {
      projectId: ctx.projectId,
      level: "error",
      eventType: "stage_failed",
      payload: { stage: STAGE, documentId: ctx.documentId, message }
    });
    throw error;
  }
}
