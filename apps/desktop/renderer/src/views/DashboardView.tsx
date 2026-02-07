import { useMemo, useState, type JSX } from "react";
import { AlertOctagon, AlertTriangle, BookMarked, BookOpen, ChevronRight, Clock, Info, LayoutDashboard } from "lucide-react";
import type { IngestResult, ProjectSummary, WorkerStatus } from "../api/ipc";
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

const eventIcons = {
  info: Info,
  warn: AlertTriangle,
  error: AlertOctagon
} as const;

export function DashboardView({
  project,
  status,
  processingState,
  history,
  lastIngest,
  continueIssueId,
  continueEntityId,
  continueSceneId,
  onJumpToIssue,
  onJumpToEntity,
  onJumpToScene
}: DashboardViewProps): JSX.Element {
  const [showRawTimeline, setShowRawTimeline] = useState(false);

  const groupedTimeline = useMemo(() => {
    const groups = new Map<
      string,
      {
        stage: string;
        count: number;
        latestStatus: string;
        latestUpdatedAt: number;
        latestPath: string;
        latestError: string | null;
      }
    >();
    for (const row of processingState) {
      const existing = groups.get(row.stage);
      if (!existing) {
        groups.set(row.stage, {
          stage: row.stage,
          count: 1,
          latestStatus: row.status,
          latestUpdatedAt: row.updated_at,
          latestPath: row.document_path,
          latestError: row.error
        });
        continue;
      }
      existing.count += 1;
      if (row.updated_at > existing.latestUpdatedAt) {
        existing.latestStatus = row.status;
        existing.latestUpdatedAt = row.updated_at;
        existing.latestPath = row.document_path;
        existing.latestError = row.error;
      }
    }
    return Array.from(groups.values()).sort((a, b) => b.latestUpdatedAt - a.latestUpdatedAt);
  }, [processingState]);

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="m-0 font-display text-2xl font-bold">Dashboard</h2>
          <p className="mt-1 text-sm text-text-muted">
            Monitor ingestion, inspect recent activity, and continue from your last triage context.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
        <article className="rounded-md border border-border bg-white/75 p-4 shadow-sm dark:bg-surface-2/60">
          <div className="flex items-center gap-2 text-sm font-medium text-text-muted">
            <LayoutDashboard size={16} />
            Worker Status
          </div>
          <div className="mt-3">
            <StatusBadge label={formatWorkerLabel(status)} status={inferStatusTone(status)} />
          </div>
          <p className="mt-2 text-xs text-text-muted">Queue depth: {status?.queueDepth ?? 0}</p>
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
            <Clock size={16} />
            Last Ingest
          </div>
          {lastIngest ? (
            <>
              <p className="mt-3 font-display text-xl font-bold font-mono">{lastIngest.documentId.slice(0, 8)}</p>
              <p className="mt-0.5 text-xs text-text-muted">
                +{lastIngest.chunksCreated} created / {lastIngest.chunksUpdated} updated / {lastIngest.chunksDeleted} deleted
              </p>
            </>
          ) : (
            <p className="mt-3 text-sm text-text-muted">No ingestion has run yet.</p>
          )}
        </article>
      </div>

      <article className="rounded-md border border-border bg-white/75 p-4 shadow-sm dark:bg-surface-2/60">
        <h3 className="m-0 mb-3 text-sm font-semibold">Continue Where You Left Off</h3>
        <div className="flex flex-wrap gap-2">
          {[
            { label: "Resume Continuity Question", icon: AlertTriangle, enabled: !!continueIssueId, onClick: onJumpToIssue },
            { label: "Resume Entity", icon: BookMarked, enabled: !!continueEntityId, onClick: onJumpToEntity },
            { label: "Resume Scene", icon: BookOpen, enabled: !!continueSceneId, onClick: onJumpToScene }
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
          <h3 className="m-0 text-sm font-semibold">Pipeline Timeline</h3>
          <button
            type="button"
            className="rounded-sm border border-border bg-surface-2 px-2.5 py-1 text-xs text-text-secondary transition-colors hover:bg-white cursor-pointer dark:bg-surface-1"
            onClick={() => setShowRawTimeline((current) => !current)}
          >
            {showRawTimeline ? "Show grouped" : "Show raw events"}
          </button>
        </div>
        {processingState.length === 0 ? (
          <EmptyState
            icon={LayoutDashboard}
            title="No Pipeline Rows"
            message="Ingest at least one document to populate deterministic scene/style/extraction stages."
          />
        ) : showRawTimeline ? (
          <div className="flex flex-col gap-2">
            {processingState.map((row) => (
              <div key={`${row.document_id}-${row.stage}-${row.updated_at}`} className="rounded-sm border border-border bg-surface-2/50 p-2.5 dark:bg-surface-1/50">
                <div className="flex items-center justify-between gap-2">
                  <strong className="text-sm">{row.stage}</strong>
                  <StatusBadge label={row.status} status={row.status} />
                </div>
                <div className="mt-1 truncate font-mono text-xs text-text-muted">{row.document_path}</div>
                {row.error ? <div className="mt-1 text-xs text-danger">Error: {row.error}</div> : null}
                <div className="mt-1 text-xs text-text-muted">Updated {new Date(row.updated_at).toLocaleString()}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {groupedTimeline.map((group) => (
              <div key={group.stage} className="rounded-sm border border-border bg-surface-2/50 p-3 dark:bg-surface-1/50">
                <div className="flex items-center justify-between gap-2">
                  <strong className="text-sm">{group.stage}</strong>
                  <StatusBadge label={group.latestStatus} status={group.latestStatus} />
                </div>
                <div className="mt-1 text-xs text-text-muted">
                  {group.count} updates · last seen {new Date(group.latestUpdatedAt).toLocaleString()}
                </div>
                <div className="mt-1 truncate font-mono text-xs text-text-muted">{group.latestPath}</div>
                {group.latestError ? <div className="mt-1 text-xs text-danger">Error: {group.latestError}</div> : null}
              </div>
            ))}
          </div>
        )}
      </article>

      <article className="rounded-md border border-border bg-white/75 p-4 shadow-sm dark:bg-surface-2/60">
        <h3 className="m-0 mb-3 text-sm font-semibold">Recent Event Log</h3>
        {!history || history.events.length === 0 ? (
          <p className="text-sm text-text-muted">No recent events.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {history.events.slice(0, 12).map((event) => {
              const EventIcon = eventIcons[event.level] ?? Info;
              return (
                <div
                  key={event.id}
                  className={`flex items-center justify-between gap-3 rounded-sm p-2 text-sm ${
                    event.level === "error" ? "bg-danger-soft/50" : event.level === "warn" ? "bg-warn-soft/50" : "bg-surface-1/50"
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <EventIcon size={14} className="shrink-0" />
                    <span className="truncate font-mono text-xs">{event.event_type}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-text-muted">{new Date(event.ts).toLocaleString()}</span>
                    <StatusBadge label={event.level} status={event.level} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </article>
    </section>
  );
}
