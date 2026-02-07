import { useMemo, useState, type JSX } from "react";
import {
  AlertTriangle,
  BookMarked,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  FileText,
  LayoutDashboard,
  Loader2,
  XCircle
} from "lucide-react";
import type { EvidenceCoverage, IngestResult, ProjectStats, ProjectSummary, WorkerStatus } from "../api/ipc";
import { ShieldCheck } from "lucide-react";
import { EmptyState } from "../components/EmptyState";
import { Skeleton } from "../components/Skeleton";
import { StatusBadge } from "../components/StatusBadge";
import {
  STAGE_ORDER,
  buildDocumentTimelines,
  coverageColorClass,
  filterNoticeEvents,
  formatCoverageSummary,
  formatWorkerLabel,
  friendlyEventMessage,
  friendlyStageLabel,
  getManuscriptCardState,
  inferStatusTone,
  listTimelineErrors,
  type DashboardHistoryEvent,
  type ProcessingStateRow
} from "./dashboardViewUtils";

type DashboardViewProps = {
  loaded: boolean;
  project: ProjectSummary | null;
  status: WorkerStatus | null;
  processingState: ProcessingStateRow[];
  history: {
    snapshots: Array<{
      id: string;
      document_id: string;
      document_path: string;
      version: number;
      created_at: number;
    }>;
    events: DashboardHistoryEvent[];
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

function StageIcon({ status }: { status: string }): JSX.Element {
  switch (status) {
    case "completed":
      return <CheckCircle2 size={12} className="text-ok" />;
    case "running":
      return <Loader2 size={12} className="animate-spin text-accent" />;
    case "failed":
      return <XCircle size={12} className="text-danger" />;
    default:
      return <Circle size={12} className="text-text-muted" />;
  }
}

function DashboardSkeleton(): JSX.Element {
  return (
    <section className="flex flex-col gap-4">
      <Skeleton variant="text" width="120px" height="28px" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} variant="rect" width="100%" height="80px" />
        ))}
      </div>
      <Skeleton variant="rect" width="100%" height="200px" />
    </section>
  );
}

export function DashboardView({
  loaded,
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

  const documentTimelines = useMemo(() => buildDocumentTimelines(processingState), [processingState]);

  const noticeEvents = useMemo(() => filterNoticeEvents(history?.events), [history]);
  const manuscriptCardState = useMemo(
    () => getManuscriptCardState(projectStats, lastIngest),
    [projectStats, lastIngest]
  );

  if (!loaded) {
    return <DashboardSkeleton />;
  }

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
          {manuscriptCardState.kind === "stats" || manuscriptCardState.kind === "last_ingest" ? (
            <>
              <p className="mt-3 font-display text-xl font-bold">{manuscriptCardState.headline}</p>
              <p className="mt-0.5 text-xs text-text-muted">{manuscriptCardState.detail}</p>
            </>
          ) : (
            <p className="mt-3 text-sm text-text-muted">{manuscriptCardState.message}</p>
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
                <span
                  className={`font-medium ${coverageColorClass(
                    evidenceCoverage.issues.total,
                    evidenceCoverage.issues.withEvidence
                  )}`}
                >
                  {formatCoverageSummary(
                    evidenceCoverage.issues.total,
                    evidenceCoverage.issues.withEvidence,
                    "No open issues"
                  )}
                </span>
              </div>
              <div className="flex items-baseline justify-between text-sm">
                <span>Scenes</span>
                <span
                  className={`font-medium ${coverageColorClass(
                    evidenceCoverage.scenes.total,
                    evidenceCoverage.scenes.withEvidence
                  )}`}
                >
                  {formatCoverageSummary(
                    evidenceCoverage.scenes.total,
                    evidenceCoverage.scenes.withEvidence,
                    "No scenes yet"
                  )}
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
              const errors = listTimelineErrors(doc);

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
                            <StageIcon status={stageStatus} />
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
            aria-expanded={noticesOpen}
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
