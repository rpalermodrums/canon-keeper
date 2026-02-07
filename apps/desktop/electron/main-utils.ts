export type WorkerLifecycleState = "ready" | "restarting" | "down";

export type WorkerStatusPayload = {
  state: "idle" | "busy";
  phase: "idle" | "ingest" | "extract" | "style" | "continuity" | "export" | "error";
  lastJob?: string;
  activeJobLabel: string | null;
  projectId: string | null;
  queueDepth: number;
  workerState: WorkerLifecycleState;
  lastSuccessfulRunAt: string | null;
  lastError: { subsystem: string; message: string } | null;
};

export function coerceWorkerStatus(
  workerState: WorkerLifecycleState,
  rawStatus: Record<string, unknown> | null,
  runtimeError: string | null
): WorkerStatusPayload {
  const source = rawStatus ?? {};
  const structuredError =
    source.lastError && typeof source.lastError === "object"
      ? (source.lastError as { subsystem: string; message: string })
      : runtimeError
        ? { subsystem: "worker", message: runtimeError }
        : null;

  const state =
    workerState === "restarting"
      ? "busy"
      : source.state === "busy"
        ? "busy"
        : "idle";

  return {
    state,
    phase:
      workerState === "down"
        ? "error"
        : source.phase === "ingest" ||
            source.phase === "extract" ||
            source.phase === "style" ||
            source.phase === "continuity" ||
            source.phase === "export" ||
            source.phase === "error"
          ? source.phase
          : "idle",
    lastJob: typeof source.lastJob === "string" ? source.lastJob : undefined,
    activeJobLabel: typeof source.activeJobLabel === "string" ? source.activeJobLabel : null,
    projectId: typeof source.projectId === "string" ? source.projectId : null,
    queueDepth: typeof source.queueDepth === "number" ? source.queueDepth : 0,
    workerState,
    lastSuccessfulRunAt:
      typeof source.lastSuccessfulRunAt === "string" ? source.lastSuccessfulRunAt : null,
    lastError: structuredError
  };
}
