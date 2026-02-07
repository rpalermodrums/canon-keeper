import type { JSX } from "react";
import { AlertTriangle, CheckCircle, FolderOpen, FolderSearch, RefreshCw, X } from "lucide-react";
import type { ProjectDiagnostics } from "../api/ipc";
import { EmptyState } from "../components/EmptyState";
import { Spinner } from "../components/Spinner";
import { StatusBadge } from "../components/StatusBadge";

type SetupViewProps = {
  busy: boolean;
  rootPath: string;
  docPath: string;
  healthCheck: ProjectDiagnostics | null;
  hasProject: boolean;
  hasDocuments: boolean;
  bootError: string | null;
  onClearBootError: () => void;
  onRootPathChange: (value: string) => void;
  onDocPathChange: (value: string) => void;
  onPickProjectRoot: () => void;
  onCreateProject: () => void;
  onPickDocument: () => void;
  onUseFixture: () => void;
  onAddDocument: () => void;
  onRunPreflight: () => void;
};

type StepState = "todo" | "active" | "done";

function stepState(index: number, hasProject: boolean, hasDocuments: boolean, hasDiagnostics: boolean): StepState {
  if (index === 0) {
    return hasProject ? "done" : "active";
  }
  if (index === 1) {
    if (!hasProject) return "todo";
    return hasDocuments ? "done" : "active";
  }
  if (!hasProject || !hasDocuments) return "todo";
  return hasDiagnostics ? "done" : "active";
}

const steps = [
  { num: 1, label: "Open Project Folder" },
  { num: 2, label: "Add Manuscript Files" },
  { num: 3, label: "Verify Setup" }
] as const;

export function SetupView({
  busy,
  rootPath,
  docPath,
  healthCheck,
  hasProject,
  hasDocuments,
  bootError,
  onClearBootError,
  onRootPathChange,
  onDocPathChange,
  onPickProjectRoot,
  onCreateProject,
  onPickDocument,
  onUseFixture,
  onAddDocument,
  onRunPreflight
}: SetupViewProps): JSX.Element {
  const diagnosticsReady = Boolean(healthCheck && healthCheck.details.length === 0);
  const allowAddDocument = hasProject;
  const allowDiagnostics = hasProject && hasDocuments;

  return (
    <section className="flex flex-col gap-4">
      <header>
        <h2 className="m-0 font-display text-2xl font-bold">Get Started</h2>
        <p className="mt-1 text-sm text-text-muted">
          Set up your project in a few quick steps.
        </p>
      </header>

      {bootError ? (
        <div className="flex items-start gap-3 rounded-md border border-warn/30 bg-warn-soft p-4">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warn" />
          <div className="flex flex-1 flex-col gap-2">
            <p className="m-0 text-sm font-medium text-text-primary">{bootError}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-sm border border-accent bg-accent px-3 py-1.5 text-sm font-medium text-text-inverse transition-colors hover:bg-accent-strong cursor-pointer"
                onClick={onPickProjectRoot}
              >
                <FolderSearch size={14} />
                Choose Project Folder
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-surface-2 px-3 py-1.5 text-sm transition-colors hover:bg-white cursor-pointer dark:bg-surface-1"
                onClick={onClearBootError}
              >
                Start Fresh
              </button>
            </div>
          </div>
          <button
            type="button"
            className="shrink-0 text-text-muted transition-colors hover:text-text-primary cursor-pointer"
            onClick={onClearBootError}
          >
            <X size={16} />
          </button>
        </div>
      ) : null}

      <div className="rounded-md border border-border bg-surface-2/70 p-3 dark:bg-surface-1/50">
        <div className="flex flex-wrap items-center justify-center gap-2 py-1">
          {steps.map((step, index) => {
            const state = stepState(index, hasProject, hasDocuments, diagnosticsReady);
            return (
              <div key={step.num} className="flex items-center gap-2">
                <div className="flex items-center gap-2 rounded-full border border-border bg-surface-1 px-3 py-1 dark:bg-surface-2">
                  <span
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                      state === "done"
                        ? "bg-ok-soft text-ok"
                        : state === "active"
                          ? "bg-accent-soft text-accent"
                          : "bg-surface-2 text-text-muted dark:bg-surface-1"
                    }`}
                  >
                    {step.num}
                  </span>
                  <span className="text-xs font-medium">{step.label}</span>
                </div>
                {index < steps.length - 1 ? <div className="h-px w-5 bg-border" /> : null}
              </div>
            );
          })}
        </div>
      </div>

      <article className="flex flex-col gap-3 rounded-md border border-border bg-white/75 p-4 shadow-sm dark:bg-surface-2/60">
        <h3 className="m-0 text-sm font-semibold">1. Project Folder</h3>
        <label className="flex flex-col gap-1 text-sm text-text-secondary">
          Folder path
          <div className="flex gap-2">
            <input
              className="flex-1"
              value={rootPath}
              onChange={(e) => onRootPathChange(e.target.value)}
              placeholder="/Users/.../my-novel"
            />
            <button
              className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-surface-2 px-3 py-2 text-sm transition-colors hover:enabled:bg-white cursor-pointer disabled:opacity-50 dark:bg-surface-1"
              type="button"
              onClick={onPickProjectRoot}
              disabled={busy}
            >
              <FolderSearch size={16} />
              Browse
            </button>
          </div>
        </label>
        <button
          className="self-start rounded-sm border border-accent bg-accent px-4 py-2 text-sm font-medium text-text-inverse transition-colors hover:bg-accent-strong cursor-pointer disabled:opacity-50"
          type="button"
          onClick={onCreateProject}
          disabled={busy || !rootPath.trim()}
        >
          {busy ? <Spinner size="sm" /> : "Create / Open Project"}
        </button>
      </article>

      <article className="flex flex-col gap-3 rounded-md border border-border bg-white/75 p-4 shadow-sm dark:bg-surface-2/60">
        <div className="flex items-center justify-between gap-3">
          <h3 className="m-0 text-sm font-semibold">2. Manuscript Files</h3>
          {allowAddDocument ? <StatusBadge label="ready" status="ok" /> : <StatusBadge label="pending" status="warn" />}
        </div>
        {!allowAddDocument ? (
          <p className="text-sm text-text-muted">Open a project folder first to add manuscripts.</p>
        ) : null}
        <label className="flex flex-col gap-1 text-sm text-text-secondary">
          Manuscript path (.md, .txt, .docx)
          <div className="flex gap-2">
            <input
              className="flex-1"
              value={docPath}
              onChange={(e) => onDocPathChange(e.target.value)}
              placeholder="/Users/.../chapter-01.md"
              disabled={!allowAddDocument}
            />
            <button
              className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-surface-2 px-3 py-2 text-sm transition-colors hover:enabled:bg-white cursor-pointer disabled:opacity-50 dark:bg-surface-1"
              type="button"
              onClick={onPickDocument}
              disabled={busy || !allowAddDocument}
            >
              <FolderSearch size={16} />
              Browse
            </button>
          </div>
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-sm border border-accent bg-accent px-4 py-2 text-sm font-medium text-text-inverse transition-colors hover:bg-accent-strong cursor-pointer disabled:opacity-50"
            type="button"
            onClick={onAddDocument}
            disabled={busy || !allowAddDocument || !docPath.trim()}
          >
            {busy ? <Spinner size="sm" /> : "Add Manuscript"}
          </button>
          {import.meta.env.DEV ? (
            <button
              className="rounded-sm border border-border bg-surface-2 px-3 py-2 text-sm transition-colors hover:enabled:bg-white cursor-pointer disabled:opacity-50 dark:bg-surface-1"
              type="button"
              onClick={onUseFixture}
              disabled={busy || !allowAddDocument}
            >
              Use Fixture
            </button>
          ) : null}
        </div>
      </article>

      <article className="flex flex-col gap-3 rounded-md border border-border bg-white/75 p-4 shadow-sm dark:bg-surface-2/60">
        <div className="flex items-center justify-between gap-3">
          <h3 className="m-0 text-sm font-semibold">3. Verify Setup</h3>
          {allowDiagnostics ? <StatusBadge label="ready" status="ok" /> : <StatusBadge label="pending" status="warn" />}
        </div>
        {!allowDiagnostics ? (
          <p className="text-sm text-text-muted">Add at least one manuscript file before running diagnostics.</p>
        ) : null}
        <button
          className="inline-flex items-center gap-1.5 self-start rounded-sm border border-accent bg-accent px-4 py-2 text-sm font-medium text-text-inverse transition-colors hover:bg-accent-strong cursor-pointer disabled:opacity-50"
          type="button"
          onClick={onRunPreflight}
          disabled={busy || !allowDiagnostics}
        >
          <RefreshCw size={16} />
          {busy ? "Running..." : "Run Diagnostics"}
        </button>

        {!healthCheck ? (
          <EmptyState
            icon={FolderOpen}
            title="No Diagnostics Yet"
            message="Checking that everything is working correctly..."
          />
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(["ipc", "worker", "sqlite", "writable"] as const).map((key) => {
              const friendlyLabels: Record<string, string> = {
                ipc: "App Communication",
                worker: "Background Engine",
                sqlite: "Database",
                writable: "File Access"
              };
              const statusLabels: Record<string, string> = {
                ok: "Connected",
                down: "Unavailable",
                error: "Error",
                warn: "Pending"
              };
              return (
                <div key={key} className="flex flex-col items-center gap-2 rounded-sm border border-border bg-surface-2/50 p-3 dark:bg-surface-1/50">
                  <CheckCircle size={20} className={healthCheck[key] === "ok" ? "text-ok" : "text-danger"} />
                  <span className="text-xs font-medium tracking-wide text-text-muted">{friendlyLabels[key]}</span>
                  <StatusBadge label={statusLabels[healthCheck[key]] ?? healthCheck[key]} status={healthCheck[key]} />
                </div>
              );
            })}
            {healthCheck.recommendations.length > 0 ? (
              <div className="col-span-full rounded-sm border border-border bg-surface-2/50 p-3 dark:bg-surface-1/50">
                <h4 className="m-0 mb-2 text-sm font-semibold">Recommended Actions</h4>
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                  {healthCheck.recommendations.map((detail) => (
                    <li key={detail} className="text-sm text-text-secondary">
                      {detail
                        .replace("Launch CanonKeeper through Electron or attach the RPC bridge.", "Please launch CanonKeeper normally to connect all features.")
                        .replace(/\bIPC\b/gi, "app communication")
                        .replace(/\bRPC\b/gi, "connection")}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </article>
    </section>
  );
}
