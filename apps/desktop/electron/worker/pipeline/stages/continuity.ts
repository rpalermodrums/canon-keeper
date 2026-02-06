import type { PipelineContext } from "../context";
import { runContinuityChecks } from "../continuity";
import { getLatestSnapshot, getProcessingState, logEvent, upsertProcessingState } from "../../storage";

const STAGE = "continuity";

export function runContinuityStage(
  ctx: PipelineContext & { entityIds: string[] }
): { ok: boolean; skipped?: boolean } {
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
    if (ctx.entityIds.length > 0) {
      runContinuityChecks(ctx.db, ctx.projectId, { entityIds: ctx.entityIds });
    } else {
      runContinuityChecks(ctx.db, ctx.projectId);
    }
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
