import type { PipelineContext } from "../context";
import { runStyleMetrics } from "../style/styleRunner";
import {
  getLatestSnapshot,
  getProcessingState,
  upsertProcessingState,
  logEvent
} from "../../storage";

const STAGE = "style";

export function runStyleStage(ctx: PipelineContext): { ok: boolean; skipped?: boolean } {
  const latest = getLatestSnapshot(ctx.db, ctx.documentId);
  if (!latest || latest.id !== ctx.snapshotId) {
    return { ok: true, skipped: true };
  }

  const existing = getProcessingState(ctx.db, ctx.documentId, STAGE);
  if (existing && existing.snapshot_id === ctx.snapshotId && existing.status === "ok") {
    return { ok: true, skipped: true };
  }

  upsertProcessingState(ctx.db, {
    documentId: ctx.documentId,
    snapshotId: ctx.snapshotId,
    stage: STAGE,
    status: "pending"
  });

  try {
    runStyleMetrics(ctx.db, ctx.projectId, { documentId: ctx.documentId });
    upsertProcessingState(ctx.db, {
      documentId: ctx.documentId,
      snapshotId: ctx.snapshotId,
      stage: STAGE,
      status: "ok"
    });
    return { ok: true };
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
