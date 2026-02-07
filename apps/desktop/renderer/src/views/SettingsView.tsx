import type { JSX } from "react";
import { CheckCircle, RefreshCw, Settings } from "lucide-react";
import type { ProjectDiagnostics, WorkerStatus } from "../api/ipc";
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

export function SettingsView({
  status,
  healthCheck,
  onRunDiagnostics,
  theme,
  onThemeChange,
  sidebarCollapsed,
  onSidebarCollapsedChange
}: SettingsViewProps): JSX.Element {
  return (
    <section className="flex flex-col gap-4">
      <header>
        <h2 className="m-0 font-display text-2xl font-bold">Settings and Diagnostics</h2>
        <p className="mt-1 text-sm text-text-muted">Environment checks, appearance, and runtime health summary.</p>
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
        <h3 className="m-0 text-sm font-semibold">Runtime</h3>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge label={status?.state ?? "disconnected"} status={status?.state ?? "down"} />
          {status?.workerState ? (
            <StatusBadge label={status.workerState} status={status.workerState} />
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
                <span className="text-xs font-medium uppercase tracking-wide text-text-muted">{key}</span>
                <StatusBadge label={healthCheck[key]} status={healthCheck[key]} />
              </div>
            ))}
          </div>
          {(healthCheck.recommendations ?? healthCheck.details).length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {(healthCheck.recommendations ?? healthCheck.details).map((detail) => (
                <div key={detail} className="rounded-sm border border-border bg-surface-1/30 p-2 text-sm text-text-secondary dark:bg-surface-1/20">
                  {detail}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-text-muted">All checks passed.</p>
          )}
        </article>
      ) : null}

      {/* About */}
      <article className="rounded-md border border-border bg-white/75 p-4 shadow-sm dark:bg-surface-2/60">
        <h3 className="m-0 mb-2 text-sm font-semibold">About</h3>
        <p className="text-sm text-text-muted">CanonKeeper v0.1.0 — Local-first editorial diagnostics for fiction writers.</p>
      </article>
    </section>
  );
}
