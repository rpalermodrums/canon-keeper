import type { PipelineContext } from "../context";
import { buildScenesFromChunks } from "../scenes";
import { runSceneMetadata } from "../sceneMetadata";
import {
  getLatestSnapshot,
  listChunksForDocument,
  replaceScenesForDocument,
  getProcessingState,
  upsertProcessingState,
  logEvent
} from "../../storage";

const STAGE = "scenes";

export async function runSceneStage(
  ctx: PipelineContext
): Promise<{ ok: boolean; skipped?: boolean }> {
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
    const chunks = listChunksForDocument(ctx.db, ctx.documentId);
    const scenes = buildScenesFromChunks(ctx.projectId, ctx.documentId, chunks);
    replaceScenesForDocument(ctx.db, ctx.documentId, scenes);
    await runSceneMetadata(ctx.db, ctx.projectId, ctx.documentId, ctx.rootPath);
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
