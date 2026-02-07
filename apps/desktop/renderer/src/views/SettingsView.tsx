import { useCallback, useEffect, useState, type JSX } from "react";
import { CheckCircle, ListTodo, RefreshCw, Settings, X } from "lucide-react";
import {
  type ProjectDiagnostics,
  type QueuedJob,
  type WorkerStatus,
  listQueuedJobs,
  cancelJob
} from "../api/ipc";
import { StatusBadge } from "../components/StatusBadge";
import { ThemeToggle, type Theme } from "../components/ThemeToggle";

type SettingsViewProps = {
  status: WorkerStatus | null;
  healthCheck: ProjectDiagnostics | null;
  onRunDiagnostics: () => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  sidebarCollapsed: boolean;
  onSidebarCollapsedChange: (collapsed: boolean) => void;
};

const WORKER_STATE_LABELS: Record<string, string> = {
  idle: "System is ready",
  busy: "Processing your manuscript",
  restarting: "Restarting...",
  down: "Not responding",
  disconnected: "Not responding"
};

const HEALTH_KEY_LABELS: Record<string, string> = {
  ipc: "Messaging",
  worker: "Background Engine",
  sqlite: "Database",
  writable: "File Access"
};

const JOB_TYPE_LABELS: Record<string, string> = {
  INGEST_DOCUMENT: "Read manuscript",
  RUN_SCENES: "Build scene index",
  RUN_STYLE: "Analyze style",
  RUN_EXTRACTION: "Extract characters & world",
  RUN_CONTINUITY: "Check continuity"
};

function formatJobTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function SettingsView({
  status,
  healthCheck,
  onRunDiagnostics,
  theme,
  onThemeChange,
  sidebarCollapsed,
  onSidebarCollapsedChange
}: SettingsViewProps): JSX.Element {
  const [queuedJobs, setQueuedJobs] = useState<QueuedJob[]>([]);

  const refreshQueue = useCallback(async () => {
    try {
      const jobs = await listQueuedJobs();
      setQueuedJobs(jobs);
    } catch {
      // IPC may not be available yet
    }
  }, []);

  useEffect(() => {
    void refreshQueue();
  }, [refreshQueue]);

  const handleCancelJob = useCallback(
    async (jobId: string) => {
      await cancelJob(jobId);
      await refreshQueue();
    },
    [refreshQueue]
  );

  return (
    <section className="flex flex-col gap-4">
      <header>
        <h2 className="m-0 font-display text-2xl font-bold">Settings</h2>
        <p className="mt-1 text-sm text-text-muted">Appearance, export, and system information.</p>
      </header>

      {/* Appearance */}
      <article className="flex flex-col gap-4 rounded-md border border-border bg-white/75 p-4 shadow-sm dark:bg-surface-2/60">
        <div className="flex items-center gap-2">
          <Settings size={16} className="text-text-muted" />
          <h3 className="m-0 text-sm font-semibold">Appearance</h3>
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-text-muted">Theme</span>
            <ThemeToggle theme={theme} onChange={onThemeChange} />
          </div>
          <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
            <input
              type="checkbox"
              className="h-4 w-4 rounded accent-accent"
              checked={sidebarCollapsed}
              onChange={(e) => onSidebarCollapsedChange(e.target.checked)}
            />
            Collapse sidebar by default
          </label>
        </div>
      </article>

      {/* Runtime */}
      <article className="flex flex-col gap-3 rounded-md border border-border bg-white/75 p-4 shadow-sm dark:bg-surface-2/60">
        <h3 className="m-0 text-sm font-semibold">System Status</h3>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge label={WORKER_STATE_LABELS[status?.state ?? "disconnected"] ?? status?.state ?? "Not responding"} status={status?.state ?? "down"} />
          {status?.workerState ? (
            <StatusBadge label={WORKER_STATE_LABELS[status.workerState] ?? status.workerState} status={status.workerState} />
          ) : null}
        </div>
        <button
          className="inline-flex items-center gap-1.5 self-start rounded-sm border border-accent bg-accent px-4 py-2 text-sm font-medium text-text-inverse transition-colors hover:bg-accent-strong cursor-pointer"
          type="button"
          onClick={onRunDiagnostics}
        >
          <RefreshCw size={16} />
          Run Diagnostics
        </button>
      </article>

      {/* Health Check */}
      {healthCheck ? (
        <article className="flex flex-col gap-3 rounded-md border border-border bg-white/75 p-4 shadow-sm dark:bg-surface-2/60">
          <h3 className="m-0 text-sm font-semibold">Health Check</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(["ipc", "worker", "sqlite", "writable"] as const).map((key) => (
              <div key={key} className="flex flex-col items-center gap-2 rounded-sm border border-border bg-surface-1/30 p-3 dark:bg-surface-1/20">
                <CheckCircle size={20} className={healthCheck[key] === "ok" ? "text-ok" : "text-danger"} />
                <span className="text-xs font-medium uppercase tracking-wide text-text-muted">{HEALTH_KEY_LABELS[key] ?? key}</span>
                <StatusBadge label={({ ok: "Connected", down: "Unavailable", error: "Error", warn: "Pending" } as Record<string, string>)[healthCheck[key]] ?? healthCheck[key]} status={healthCheck[key]} />
              </div>
            ))}
          </div>
          {(healthCheck.recommendations ?? healthCheck.details).length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {(healthCheck.recommendations ?? healthCheck.details).map((detail) => (
                <div key={detail} className="rounded-sm border border-border bg-surface-1/30 p-2 text-sm text-text-secondary dark:bg-surface-1/20">
                  {detail
                    .replace("Launch CanonKeeper through Electron or attach the RPC bridge.", "Please launch CanonKeeper normally to connect all features.")
                    .replace(/\bIPC\b/gi, "app communication")
                    .replace(/\bRPC\b/gi, "connection")}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-text-muted">All checks passed.</p>
          )}
        </article>
      ) : null}

      {/* Processing Queue */}
      <article className="flex flex-col gap-3 rounded-md border border-border bg-white/75 p-4 shadow-sm dark:bg-surface-2/60">
        <div className="flex items-center gap-2">
          <ListTodo size={16} className="text-text-muted" />
          <h3 className="m-0 text-sm font-semibold">Processing Queue</h3>
        </div>
        {queuedJobs.length === 0 ? (
          <p className="text-sm text-text-muted">No pending jobs.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {queuedJobs.map((job) => (
              <div
                key={job.id}
                className="flex items-center justify-between gap-3 rounded-sm border border-border bg-surface-1/30 px-3 py-2 dark:bg-surface-1/20"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-text-primary">
                    {JOB_TYPE_LABELS[job.type] ?? job.type}
                  </span>
                  <span className="text-xs text-text-muted">
                    {job.status === "failed" ? `Retrying (attempt ${job.attempts})` : "Queued"}
                    {" \u00b7 "}
                    {formatJobTime(job.created_at)}
                  </span>
                </div>
                {job.status === "queued" ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-sm border border-danger/30 bg-danger-soft px-2.5 py-1 text-xs font-medium text-danger transition-colors hover:bg-danger/20 cursor-pointer"
                    onClick={() => void handleCancelJob(job.id)}
                  >
                    <X size={12} />
                    Cancel
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </article>

      {/* About */}
      <article className="rounded-md border border-border bg-white/75 p-4 shadow-sm dark:bg-surface-2/60">
        <h3 className="m-0 mb-2 text-sm font-semibold">About</h3>
        <p className="text-sm text-text-muted">CanonKeeper v0.1.0 — Local-first editorial diagnostics for fiction writers.</p>
      </article>
    </section>
  );
}
