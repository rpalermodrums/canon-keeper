import { describe, expect, it, vi } from "vitest";
import type { IngestResult, ProjectStats, WorkerStatus } from "../api/ipc";
import {
  STAGE_ORDER,
  buildDocumentTimelines,
  coverageColorClass,
  coverageConfidenceLabel,
  filterNoticeEvents,
  formatCoverageSummary,
  formatWorkerLabel,
  friendlyEventMessage,
  getManuscriptCardState,
  inferStatusTone,
  listTimelineErrors,
  type DashboardHistoryEvent,
  type ProcessingStateRow
} from "./dashboardViewUtils";

function createWorkerStatus(overrides: Partial<WorkerStatus> = {}): WorkerStatus {
  return {
    state: "idle",
    phase: "idle",
    activeJobLabel: null,
    lastSuccessfulRunAt: null,
    lastError: null,
    ...overrides
  };
}

function createProcessingRow(overrides: Partial<ProcessingStateRow>): ProcessingStateRow {
  return {
    document_id: "doc-1",
    snapshot_id: "snap-1",
    stage: "ingest",
    status: "completed",
    error: null,
    updated_at: 100,
    document_path: "/project/chapter-1.md",
    ...overrides
  };
}

function createEvent(overrides: Partial<DashboardHistoryEvent>): DashboardHistoryEvent {
  return {
    id: "event-1",
    project_id: "project-1",
    ts: 100,
    level: "info",
    event_type: "worker_started",
    payload_json: "{}",
    ...overrides
  };
}

describe("formatWorkerLabel", () => {
  it("returns disconnected when status is null", () => {
    expect(formatWorkerLabel(null)).toBe("Disconnected");
  });

  it("includes active job label when available", () => {
    const status = createWorkerStatus({ phase: "ingest", activeJobLabel: "Book 1" });
    expect(formatWorkerLabel(status)).toBe("ingest · Book 1");
  });
});

describe("inferStatusTone", () => {
  it("returns down when worker is unavailable or errored", () => {
    expect(inferStatusTone(null)).toBe("down");
    expect(inferStatusTone(createWorkerStatus({ workerState: "down" }))).toBe("down");
    expect(inferStatusTone(createWorkerStatus({ phase: "error" }))).toBe("down");
  });

  it("returns busy and ok for healthy worker states", () => {
    expect(inferStatusTone(createWorkerStatus({ state: "busy" }))).toBe("busy");
    expect(inferStatusTone(createWorkerStatus({ state: "idle" }))).toBe("ok");
  });
});

describe("coverage helpers", () => {
  it("maps confidence labels at threshold boundaries", () => {
    expect(coverageConfidenceLabel(0, 0)).toBe("unknown");
    expect(coverageConfidenceLabel(10, 9)).toBe("high");
    expect(coverageConfidenceLabel(10, 8)).toBe("medium");
    expect(coverageConfidenceLabel(10, 5)).toBe("low");
  });

  it("maps color classes from confidence labels", () => {
    expect(coverageColorClass(0, 0)).toBe("text-text-muted");
    expect(coverageColorClass(5, 5)).toBe("text-ok");
    expect(coverageColorClass(10, 6)).toBe("text-warn");
    expect(coverageColorClass(10, 1)).toBe("text-danger");
  });

  it("formats coverage summary text and empty labels", () => {
    expect(formatCoverageSummary(0, 0, "No scenes yet")).toBe("No scenes yet");
    expect(formatCoverageSummary(8, 3, "No scenes yet")).toBe("3 of 8 backed (38%)");
  });
});

describe("buildDocumentTimelines", () => {
  it("aggregates rows per document and sorts by most recent update", () => {
    const rows = [
      createProcessingRow({ document_id: "doc-1", document_path: "/p/ch1.md", stage: "ingest", updated_at: 100 }),
      createProcessingRow({ document_id: "doc-1", document_path: "/p/ch1.md", stage: "scenes", updated_at: 130 }),
      createProcessingRow({ document_id: "doc-2", document_path: "/p/ch2.md", stage: "ingest", updated_at: 120 })
    ];

    const timelines = buildDocumentTimelines(rows);

    expect(timelines.map((timeline) => timeline.documentId)).toEqual(["doc-1", "doc-2"]);
    expect(timelines[0]?.latestUpdatedAt).toBe(130);
    expect(timelines[0]?.stages.get("scenes")?.status).toBe("completed");
  });

  it("extracts timeline errors in stage order", () => {
    const [timeline] = buildDocumentTimelines([
      createProcessingRow({ stage: "style", status: "failed", error: "Style failed", updated_at: 100 }),
      createProcessingRow({ stage: "ingest", status: "failed", error: "Ingest failed", updated_at: 120 }),
      createProcessingRow({ stage: "continuity", status: "failed", error: "Continuity failed", updated_at: 130 })
    ]);

    const errors = listTimelineErrors(timeline!);

    expect(errors.map((error) => error.error)).toEqual(["Ingest failed", "Style failed", "Continuity failed"]);
    expect(STAGE_ORDER[0]).toBe("ingest");
  });
});

describe("notice helpers", () => {
  it("keeps warning and error events only", () => {
    const events = [
      createEvent({ id: "info", level: "info" }),
      createEvent({ id: "warn", level: "warn" }),
      createEvent({ id: "error", level: "error" })
    ];

    const notices = filterNoticeEvents(events);
    expect(notices.map((event) => event.id)).toEqual(["warn", "error"]);
  });

  it("formats file-missing events with parsed path and falls back on parse failure", () => {
    const message = friendlyEventMessage("file_missing", JSON.stringify({ path: "/project/chapter.md" }));
    expect(message).toBe("A manuscript file was moved or deleted: /project/chapter.md");

    const parseSpy = vi.spyOn(JSON, "parse").mockImplementation(() => {
      throw new Error("bad payload");
    });

    expect(friendlyEventMessage("file_missing", "{invalid json")).toBe(
      "A manuscript file was moved or deleted."
    );

    parseSpy.mockRestore();
  });

  it("formats generic event types into title case", () => {
    expect(friendlyEventMessage("worker_job_failed", "{}")).toBe("Worker Job Failed");
  });
});

describe("getManuscriptCardState", () => {
  it("returns stats copy when project metrics exist", () => {
    const stats: ProjectStats = {
      totalPassages: 1,
      totalDocuments: 2,
      totalScenes: 3,
      totalIssues: 4
    };

    expect(getManuscriptCardState(stats, null)).toEqual({
      kind: "stats",
      headline: "1 passage",
      detail: "2 documents · 3 scenes · 4 open issues"
    });
  });

  it("returns last-ingest copy when only ingest results exist", () => {
    const ingestResult: IngestResult = {
      documentId: "doc-1",
      snapshotId: "snap-1",
      snapshotCreated: true,
      chunksCreated: 2,
      chunksUpdated: 3,
      chunksDeleted: 1,
      changeStart: 0,
      changeEnd: 42
    };

    expect(getManuscriptCardState(null, ingestResult)).toEqual({
      kind: "last_ingest",
      headline: "Last processed",
      detail: "Processed 6 passages"
    });
  });

  it("returns empty copy when no manuscript data exists", () => {
    expect(getManuscriptCardState(null, null)).toEqual({
      kind: "empty",
      message: "No manuscripts analyzed yet."
    });
  });
});
