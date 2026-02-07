import { describe, expect, it } from "vitest";
import { coerceWorkerStatus } from "./main-utils";

describe("coerceWorkerStatus", () => {
  it("returns the expected shape for fully valid input", () => {
    const result = coerceWorkerStatus(
      "ready",
      {
        state: "busy",
        phase: "style",
        lastJob: "RUN_STYLE",
        activeJobLabel: "Style pass",
        projectId: "project-123",
        queueDepth: 3,
        lastSuccessfulRunAt: "2026-02-07T12:00:00.000Z",
        lastError: { subsystem: "pipeline", message: "style warning" }
      },
      "runtime error"
    );

    expect(result).toEqual({
      state: "busy",
      phase: "style",
      lastJob: "RUN_STYLE",
      activeJobLabel: "Style pass",
      projectId: "project-123",
      queueDepth: 3,
      workerState: "ready",
      lastSuccessfulRunAt: "2026-02-07T12:00:00.000Z",
      lastError: { subsystem: "pipeline", message: "style warning" }
    });
  });

  it("uses safe defaults when fields are missing", () => {
    expect(() => coerceWorkerStatus("ready", null, null)).not.toThrow();

    const result = coerceWorkerStatus("ready", null, null);
    expect(result).toEqual({
      state: "idle",
      phase: "idle",
      lastJob: undefined,
      activeJobLabel: null,
      projectId: null,
      queueDepth: 0,
      workerState: "ready",
      lastSuccessfulRunAt: null,
      lastError: null
    });
  });

  it("gracefully normalizes unknown phases to idle", () => {
    const result = coerceWorkerStatus(
      "ready",
      {
        phase: "mystery-phase"
      },
      null
    );

    expect(result.phase).toBe("idle");
    expect(result.state).toBe("idle");
  });

  it("classifies worker-down status with error phase", () => {
    const result = coerceWorkerStatus(
      "down",
      {
        state: "busy",
        phase: "ingest"
      },
      "worker process unavailable"
    );

    expect(result).toEqual({
      state: "busy",
      phase: "error",
      lastJob: undefined,
      activeJobLabel: null,
      projectId: null,
      queueDepth: 0,
      workerState: "down",
      lastSuccessfulRunAt: null,
      lastError: { subsystem: "worker", message: "worker process unavailable" }
    });
  });

  it("coerces each field independently without cascading failures", () => {
    const result = coerceWorkerStatus(
      "ready",
      {
        state: "busy",
        phase: "extract",
        lastJob: 42,
        activeJobLabel: "Extract job",
        projectId: false,
        queueDepth: "5",
        lastSuccessfulRunAt: 99,
        lastError: "not-an-object"
      },
      "runtime fallback"
    );

    expect(result.state).toBe("busy");
    expect(result.phase).toBe("extract");
    expect(result.lastJob).toBeUndefined();
    expect(result.activeJobLabel).toBe("Extract job");
    expect(result.projectId).toBeNull();
    expect(result.queueDepth).toBe(0);
    expect(result.lastSuccessfulRunAt).toBeNull();
    expect(result.lastError).toEqual({ subsystem: "worker", message: "runtime fallback" });
  });

  it("forces busy state while worker is restarting", () => {
    const result = coerceWorkerStatus(
      "restarting",
      {
        state: "idle",
        phase: "ingest",
        queueDepth: 7
      },
      null
    );

    expect(result.state).toBe("busy");
    expect(result.phase).toBe("ingest");
    expect(result.queueDepth).toBe(7);
  });
});
