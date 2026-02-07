import type { IngestResult, ProjectStats, WorkerStatus } from "../api/ipc";

export type ProcessingStateRow = {
  document_id: string;
  snapshot_id: string;
  stage: string;
  status: string;
  error: string | null;
  updated_at: number;
  document_path: string;
};

export type DashboardHistoryEvent = {
  id: string;
  project_id: string;
  ts: number;
  level: "info" | "warn" | "error";
  event_type: string;
  payload_json: string;
};

export type TimelineStage = {
  status: string;
  error: string | null;
  updatedAt: number;
};

export type DocumentTimeline = {
  documentPath: string;
  documentId: string;
  stages: Map<string, TimelineStage>;
  latestUpdatedAt: number;
};

export type CoverageConfidence = "unknown" | "high" | "medium" | "low";

export const STAGE_LABELS: Record<string, string> = {
  ingest: "Ingesting",
  scenes: "Finding scenes",
  style: "Analyzing style",
  extraction: "Extracting details",
  continuity: "Checking continuity"
};

export const STAGE_ORDER = ["ingest", "scenes", "style", "extraction", "continuity"] as const;

export type ManuscriptCardState =
  | {
      kind: "stats";
      headline: string;
      detail: string;
    }
  | {
      kind: "last_ingest";
      headline: string;
      detail: string;
    }
  | {
      kind: "empty";
      message: string;
    };

export function formatWorkerLabel(status: WorkerStatus | null): string {
  if (!status) return "Disconnected";
  if (status.activeJobLabel) {
    return `${status.phase} · ${status.activeJobLabel}`;
  }
  return status.phase;
}

export function inferStatusTone(status: WorkerStatus | null): "down" | "busy" | "ok" {
  if (!status) return "down";
  if (status.workerState === "down" || status.phase === "error") return "down";
  return status.state === "busy" ? "busy" : "ok";
}

export function coverageConfidenceLabel(total: number, withEvidence: number): CoverageConfidence {
  if (total === 0) return "unknown";
  const pct = (withEvidence / total) * 100;
  if (pct > 80) return "high";
  if (pct > 50) return "medium";
  return "low";
}

export function coverageColorClass(total: number, withEvidence: number): string {
  const confidence = coverageConfidenceLabel(total, withEvidence);
  if (confidence === "high") return "text-ok";
  if (confidence === "medium") return "text-warn";
  if (confidence === "low") return "text-danger";
  return "text-text-muted";
}

export function formatCoverageSummary(total: number, withEvidence: number, emptyMessage: string): string {
  if (total === 0) return emptyMessage;
  const percent = Math.round((withEvidence / total) * 100);
  return `${withEvidence} of ${total} backed (${percent}%)`;
}

export function friendlyStageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage.charAt(0).toUpperCase() + stage.slice(1);
}

export function buildDocumentTimelines(rows: readonly ProcessingStateRow[]): DocumentTimeline[] {
  const timelinesByDocument = new Map<string, DocumentTimeline>();

  for (const row of rows) {
    const existingTimeline = timelinesByDocument.get(row.document_id);
    if (!existingTimeline) {
      const timeline: DocumentTimeline = {
        documentPath: row.document_path,
        documentId: row.document_id,
        stages: new Map([[row.stage, { status: row.status, error: row.error, updatedAt: row.updated_at }]]),
        latestUpdatedAt: row.updated_at
      };
      timelinesByDocument.set(row.document_id, timeline);
      continue;
    }

    existingTimeline.stages.set(row.stage, {
      status: row.status,
      error: row.error,
      updatedAt: row.updated_at
    });
    if (row.updated_at > existingTimeline.latestUpdatedAt) {
      existingTimeline.latestUpdatedAt = row.updated_at;
    }
  }

  return Array.from(timelinesByDocument.values()).sort((a, b) => b.latestUpdatedAt - a.latestUpdatedAt);
}

export function listTimelineErrors(
  timeline: DocumentTimeline,
  stageOrder: readonly string[] = STAGE_ORDER
): TimelineStage[] {
  return stageOrder
    .map((stage) => timeline.stages.get(stage))
    .filter((stage): stage is TimelineStage => stage != null && stage.error != null);
}

export function filterNoticeEvents(events: readonly DashboardHistoryEvent[] | null | undefined): DashboardHistoryEvent[] {
  if (!events) return [];
  return events.filter((event) => event.level === "warn" || event.level === "error");
}

export function friendlyEventMessage(eventType: string, payloadJson: string): string {
  if (eventType === "file_missing") {
    try {
      const payload = JSON.parse(payloadJson) as { path?: string };
      const filePath = payload.path ?? "unknown file";
      return `A manuscript file was moved or deleted: ${filePath}`;
    } catch {
      return "A manuscript file was moved or deleted.";
    }
  }
  return eventType
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function getManuscriptCardState(
  projectStats: ProjectStats | null,
  lastIngest: IngestResult | null
): ManuscriptCardState {
  if (projectStats) {
    const headline = `${projectStats.totalPassages} ${projectStats.totalPassages === 1 ? "passage" : "passages"}`;
    const detail =
      `${projectStats.totalDocuments} ${projectStats.totalDocuments === 1 ? "document" : "documents"} · ` +
      `${projectStats.totalScenes} ${projectStats.totalScenes === 1 ? "scene" : "scenes"} · ` +
      `${projectStats.totalIssues} open ${projectStats.totalIssues === 1 ? "issue" : "issues"}`;
    return { kind: "stats", headline, detail };
  }

  if (lastIngest) {
    const changedPassageCount = lastIngest.chunksCreated + lastIngest.chunksUpdated + lastIngest.chunksDeleted;
    return {
      kind: "last_ingest",
      headline: "Last processed",
      detail: `Processed ${changedPassageCount} passages`
    };
  }

  return {
    kind: "empty",
    message: "No manuscripts analyzed yet."
  };
}
