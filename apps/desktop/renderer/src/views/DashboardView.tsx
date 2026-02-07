import { useMemo, useState, type JSX } from "react";
import {
  AlertTriangle,
  BookMarked,
  BookOpen,
  ChevronDown,
  ChevronRight,
  FileText,
  LayoutDashboard
} from "lucide-react";
import type { EvidenceCoverage, IngestResult, ProjectStats, ProjectSummary, WorkerStatus } from "../api/ipc";
import { ShieldCheck } from "lucide-react";
import { EmptyState } from "../components/EmptyState";
import { StatusBadge } from "../components/StatusBadge";

type DashboardViewProps = {
  project: ProjectSummary | null;
  status: WorkerStatus | null;
  processingState: Array<{
    document_id: string;
    snapshot_id: string;
    stage: string;
    status: string;
    error: string | null;
    updated_at: number;
    document_path: string;
  }>;
  history: {
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
  } | null;
  lastIngest: IngestResult | null;
  projectStats: ProjectStats | null;
  evidenceCoverage: EvidenceCoverage | null;
  continueIssueId: string | null;
  continueEntityId: string | null;
  continueSceneId: string | null;
  onJumpToIssue: () => void;
  onJumpToEntity: () => void;
  onJumpToScene: () => void;
};

function formatWorkerLabel(status: WorkerStatus | null): string {
  if (!status) return "Disconnected";
  if (status.activeJobLabel) {
    return `${status.phase} · ${status.activeJobLabel}`;
  }
  return status.phase;
}

function inferStatusTone(status: WorkerStatus | null): string {
  if (!status) return "down";
  if (status.workerState === "down" || status.phase === "error") return "down";
  return status.state === "busy" ? "busy" : "ok";
}

const STAGE_LABELS: Record<string, string> = {
  ingest: "Ingesting",
  scenes: "Finding scenes",
  style: "Analyzing style",
  extraction: "Extracting details",
  continuity: "Checking continuity"
};

function coverageColor(total: number, withEvidence: number): string {
  if (total === 0) return "text-text-muted";
  const pct = (withEvidence / total) * 100;
  if (pct > 80) return "text-ok";
  if (pct > 50) return "text-warn";
  return "text-danger";
}

function friendlyStageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage.charAt(0).toUpperCase() + stage.slice(1);
}

const STAGE_ORDER = ["ingest", "scenes", "style", "extraction", "continuity"];

function stageStatusColor(status: string): string {
  switch (status) {
    case "completed":
      return "bg-ok text-white";
    case "running":
      return "bg-accent text-white animate-pulse-dot";
    case "failed":
      return "bg-danger text-white";
    default:
      return "bg-surface-1 text-text-muted dark:bg-surface-3";
  }
}

function stageStatusRingColor(status: string): string {
  switch (status) {
    case "completed":
      return "ring-ok/30";
    case "running":
      return "ring-accent/30";
    case "failed":
      return "ring-danger/30";
    default:
      return "ring-border";
  }
}

type DocumentTimeline = {
  documentPath: string;
  documentId: string;
  stages: Map<string, { status: string; error: string | null; updatedAt: number }>;
  latestUpdatedAt: number;
};

function friendlyEventMessage(eventType: string, payloadJson: string): string {
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
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function DashboardView({
  project,
  status,
  processingState,
  history,
  lastIngest,
  projectStats,
  evidenceCoverage,
  continueIssueId,
  continueEntityId,
  continueSceneId,
  onJumpToIssue,
  onJumpToEntity,
  onJumpToScene
}: DashboardViewProps): JSX.Element {
  const [noticesOpen, setNoticesOpen] = useState(false);

  const documentTimelines = useMemo(() => {
    const docs = new Map<string, DocumentTimeline>();
    for (const row of processingState) {
      const existing = docs.get(row.document_id);
      if (!existing) {
        const timeline: DocumentTimeline = {
          documentPath: row.document_path,
          documentId: row.document_id,
          stages: new Map([[row.stage, { status: row.status, error: row.error, updatedAt: row.updated_at }]]),
          latestUpdatedAt: row.updated_at
        };
        docs.set(row.document_id, timeline);
      } else {
        existing.stages.set(row.stage, { status: row.status, error: row.error, updatedAt: row.updated_at });
        if (row.updated_at > existing.latestUpdatedAt) {
          existing.latestUpdatedAt = row.updated_at;
        }
      }
    }
    return Array.from(docs.values()).sort((a, b) => b.latestUpdatedAt - a.latestUpdatedAt);
  }, [processingState]);

  const noticeEvents = useMemo(() => {
    if (!history?.events) return [];
    return history.events.filter((e) => e.level === "warn" || e.level === "error");
  }, [history]);

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="m-0 font-display text-2xl font-bold">Home</h2>
          <p className="mt-1 text-sm text-text-muted">
            Your project at a glance. Pick up where you left off.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
        <article className="rounded-md border border-border bg-white/75 p-4 shadow-sm dark:bg-surface-2/60">
          <div className="flex items-center gap-2 text-sm font-medium text-text-muted">
            <LayoutDashboard size={16} />
            Activity
          </div>
          <div className="mt-3">
            <StatusBadge label={formatWorkerLabel(status)} status={inferStatusTone(status)} />
          </div>
        </article>

        <article className="rounded-md border border-border bg-white/75 p-4 shadow-sm dark:bg-surface-2/60">
          <div className="flex items-center gap-2 text-sm font-medium text-text-muted">
            <BookOpen size={16} />
            Project
          </div>
          {project ? (
            <>
              <p className="mt-3 font-display text-xl font-bold">{project.name}</p>
              <p className="mt-0.5 truncate font-mono text-xs text-text-muted">{project.root_path}</p>
            </>
          ) : (
            <p className="mt-3 text-sm text-text-muted">No project opened yet.</p>
          )}
        </article>

        <article className="rounded-md border border-border bg-white/75 p-4 shadow-sm dark:bg-surface-2/60">
          <div className="flex items-center gap-2 text-sm font-medium text-text-muted">
            <FileText size={16} />
            Manuscript
          </div>
          {projectStats ? (
            <>
              <p className="mt-3 font-display text-xl font-bold">
                {projectStats.totalPassages} {projectStats.totalPassages === 1 ? "passage" : "passages"}
              </p>
              <p className="mt-0.5 text-xs text-text-muted">
                {projectStats.totalDocuments} {projectStats.totalDocuments === 1 ? "document" : "documents"} ·{" "}
                {projectStats.totalScenes} {projectStats.totalScenes === 1 ? "scene" : "scenes"} ·{" "}
                {projectStats.totalIssues} open {projectStats.totalIssues === 1 ? "issue" : "issues"}
              </p>
            </>
          ) : lastIngest ? (
            <>
              <p className="mt-3 font-display text-xl font-bold">Last processed</p>
              <p className="mt-0.5 text-xs text-text-muted">
                Processed {lastIngest.chunksCreated + lastIngest.chunksUpdated + lastIngest.chunksDeleted} passages
              </p>
            </>
          ) : (
            <p className="mt-3 text-sm text-text-muted">No manuscripts analyzed yet.</p>
          )}
        </article>

        <article className="rounded-md border border-border bg-white/75 p-4 shadow-sm dark:bg-surface-2/60">
          <div className="flex items-center gap-2 text-sm font-medium text-text-muted">
            <ShieldCheck size={16} />
            Evidence Backing
          </div>
          {evidenceCoverage ? (
            <div className="mt-3 flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between text-sm">
                <span>Issues</span>
                <span className={`font-medium ${coverageColor(evidenceCoverage.issues.total, evidenceCoverage.issues.withEvidence)}`}>
                  {evidenceCoverage.issues.total === 0
                    ? "No open issues"
                    : `${evidenceCoverage.issues.withEvidence} of ${evidenceCoverage.issues.total} backed (${Math.round((evidenceCoverage.issues.withEvidence / evidenceCoverage.issues.total) * 100)}%)`}
                </span>
              </div>
              <div className="flex items-baseline justify-between text-sm">
                <span>Scenes</span>
                <span className={`font-medium ${coverageColor(evidenceCoverage.scenes.total, evidenceCoverage.scenes.withEvidence)}`}>
                  {evidenceCoverage.scenes.total === 0
                    ? "No scenes yet"
                    : `${evidenceCoverage.scenes.withEvidence} of ${evidenceCoverage.scenes.total} backed (${Math.round((evidenceCoverage.scenes.withEvidence / evidenceCoverage.scenes.total) * 100)}%)`}
                </span>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-text-muted">No data yet.</p>
          )}
        </article>
      </div>

      <article className="rounded-md border border-border bg-white/75 p-4 shadow-sm dark:bg-surface-2/60">
        <h3 className="m-0 mb-3 text-sm font-semibold">Continue Where You Left Off</h3>
        <div className="flex flex-wrap gap-2">
          {[
            { label: "Continue Reviewing Issues", icon: AlertTriangle, enabled: !!continueIssueId, onClick: onJumpToIssue },
            { label: "Continue with Characters", icon: BookMarked, enabled: !!continueEntityId, onClick: onJumpToEntity },
            { label: "Continue Reading Scenes", icon: BookOpen, enabled: !!continueSceneId, onClick: onJumpToScene }
          ].map((item) => (
            <button
              key={item.label}
              type="button"
              className="group flex items-center gap-2 rounded-sm border border-border bg-surface-2 px-3 py-2 text-sm transition-all hover:enabled:-translate-y-0.5 hover:enabled:shadow-md disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer dark:bg-surface-1"
              disabled={!item.enabled}
              onClick={item.onClick}
            >
              <item.icon size={16} className="text-text-muted" />
              <span>{item.label}</span>
              <ChevronRight size={14} className="text-text-muted transition-transform group-hover:enabled:translate-x-0.5" />
            </button>
          ))}
        </div>
      </article>

      <article className="rounded-md border border-border bg-white/75 p-4 shadow-sm dark:bg-surface-2/60">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="m-0 text-sm font-semibold">Document Progress</h3>
        </div>
        {documentTimelines.length === 0 ? (
          <EmptyState
            icon={LayoutDashboard}
            title="No Activity Yet"
            message="Add a manuscript to get started."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {documentTimelines.map((doc) => {
              const fileName = doc.documentPath.split("/").pop() ?? doc.documentPath;
              const errors = STAGE_ORDER
                .map((s) => doc.stages.get(s))
                .filter((st): st is { status: string; error: string | null; updatedAt: number } =>
                  st != null && st.error != null
                );

              return (
                <div
                  key={doc.documentId}
                  className="rounded-sm border border-border bg-surface-2/50 p-3 dark:bg-surface-1/50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <strong className="truncate text-sm" title={doc.documentPath}>
                      {fileName}
                    </strong>
                    <span className="shrink-0 text-xs text-text-muted">
                      {new Date(doc.latestUpdatedAt).toLocaleString()}
                    </span>
                  </div>

                  <div className="mt-3 flex items-center gap-1">
                    {STAGE_ORDER.map((stage, idx) => {
                      const stageData = doc.stages.get(stage);
                      const stageStatus = stageData?.status ?? "pending";

                      return (
                        <div key={stage} className="flex items-center gap-1">
                          <div className="flex flex-col items-center gap-1" title={`${friendlyStageLabel(stage)}: ${stageStatus}`}>
                            <div
                              className={`h-2.5 w-2.5 rounded-full ring-2 ${stageStatusColor(stageStatus)} ${stageStatusRingColor(stageStatus)}`}
                            />
                            <span className="text-[10px] leading-tight text-text-muted">
                              {friendlyStageLabel(stage)}
                            </span>
                          </div>
                          {idx < STAGE_ORDER.length - 1 && (
                            <div className="mb-3 h-px w-3 bg-border" />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {errors.map((err) => (
                    <div key={err.error} className="mt-2 text-xs text-danger">
                      {err.error}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </article>

      {noticeEvents.length > 0 && (
        <article className="rounded-md border border-warn/40 bg-warn-soft/30 p-4 shadow-sm dark:bg-warn-soft/10">
          <button
            type="button"
            className="flex w-full cursor-pointer items-center gap-2 bg-transparent p-0 text-left"
            onClick={() => setNoticesOpen((prev) => !prev)}
          >
            {noticesOpen ? (
              <ChevronDown size={16} className="shrink-0 text-warn" />
            ) : (
              <ChevronRight size={16} className="shrink-0 text-warn" />
            )}
            <AlertTriangle size={14} className="shrink-0 text-warn" />
            <h3 className="m-0 text-sm font-semibold text-warn">
              Notices ({noticeEvents.length})
            </h3>
          </button>

          {noticesOpen && (
            <div className="mt-3 flex flex-col gap-2">
              {noticeEvents.map((evt) => (
                <div
                  key={evt.id}
                  className={`rounded-sm border p-2 text-xs ${
                    evt.level === "error"
                      ? "border-danger/30 bg-danger-soft/30 text-danger"
                      : "border-warn/30 bg-warn-soft/30 text-warn"
                  }`}
                >
                  {friendlyEventMessage(evt.event_type, evt.payload_json)}
                </div>
              ))}
              <p className="m-0 mt-1 text-xs text-text-muted">
                Files will be re-indexed automatically if they reappear.
              </p>
            </div>
          )}
        </article>
      )}

    </section>
  );
}
