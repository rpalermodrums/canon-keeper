import type { JSX } from "react";
import { AlertOctagon, CheckCircle, Download, FileText, FolderSearch, Play } from "lucide-react";
import type { ExportResult } from "../api/ipc";
import { CopyButton } from "../components/CopyButton";
import { EmptyState } from "../components/EmptyState";
import { Spinner } from "../components/Spinner";
import { TogglePill } from "../components/TogglePill";

type ExportViewProps = {
  busy: boolean;
  exportDir: string;
  exportKind: "md" | "json";
  lastResult: ExportResult | null;
  onExportDirChange: (value: string) => void;
  onExportKindChange: (kind: "md" | "json") => void;
  onPickExportDir: () => void;
  onRunExport: () => void;
};

const kindOptions = [
  { value: "md" as const, label: "Markdown" },
  { value: "json" as const, label: "JSON" }
];

export function ExportView({
  busy,
  exportDir,
  exportKind,
  lastResult,
  onExportDirChange,
  onExportKindChange,
  onPickExportDir,
  onRunExport
}: ExportViewProps): JSX.Element {
  return (
    <section className="flex flex-col gap-4">
      <header>
        <h2 className="m-0 font-display text-2xl font-bold">Exports</h2>
        <p className="mt-1 text-sm text-text-muted">Export your project data as Markdown or JSON files.</p>
      </header>

      <article className="flex flex-col gap-4 rounded-md border border-border bg-white/75 p-4 shadow-sm dark:bg-surface-2/60">
        <label className="flex flex-col gap-1 text-sm text-text-secondary">
          Output directory
          <div className="flex gap-2">
            <input
              className="flex-1"
              value={exportDir}
              onChange={(e) => onExportDirChange(e.target.value)}
              placeholder="/Users/.../exports"
            />
            <button
              className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-surface-2 px-3 py-2 text-sm transition-colors hover:enabled:bg-white cursor-pointer disabled:opacity-50 dark:bg-surface-1"
              type="button"
              onClick={onPickExportDir}
              disabled={busy}
            >
              <FolderSearch size={16} />
              Browse
            </button>
          </div>
        </label>

        <TogglePill
          label="Export format"
          options={kindOptions}
          value={exportKind}
          onChange={onExportKindChange}
        />

        <button
          className="inline-flex items-center gap-2 self-start rounded-sm border border-accent bg-accent px-5 py-2.5 text-sm font-medium text-text-inverse transition-colors hover:bg-accent-strong cursor-pointer disabled:opacity-50"
          type="button"
          onClick={onRunExport}
          disabled={busy || !exportDir.trim()}
        >
          {busy ? <Spinner size="sm" /> : <Play size={18} />}
          Run Export
        </button>
      </article>

      {!lastResult ? (
        <EmptyState icon={Download} title="No Exports Yet" message="Choose a format and folder, then export your project data." />
      ) : lastResult.ok ? (
        <article className="flex flex-col gap-3 rounded-md border border-ok/30 bg-ok-soft/50 p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <CheckCircle size={18} className="text-ok" />
            <h3 className="m-0 text-sm font-semibold text-ok-strong">Last Export Succeeded</h3>
          </div>
          <p className="text-xs text-text-muted">Completed in {(lastResult.elapsedMs / 1000).toFixed(1)} seconds</p>
          <div className="flex flex-col gap-1.5">
            {lastResult.files.map((file) => (
              <div key={file} className="flex items-center justify-between gap-2 rounded-sm border border-border bg-surface-2/50 p-2 dark:bg-surface-1/30">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText size={14} className="shrink-0 text-text-muted" />
                  <span className="truncate font-mono text-xs">{file}</span>
                </div>
                <CopyButton text={file} label="Copy" />
              </div>
            ))}
          </div>
        </article>
      ) : (
        <article className="flex flex-col gap-2 rounded-md border border-danger/30 bg-danger-soft/50 p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <AlertOctagon size={18} className="text-danger" />
            <h3 className="m-0 text-sm font-semibold text-danger">Last Export Failed</h3>
          </div>
          <p className="text-sm text-text-secondary">{lastResult.error}</p>
        </article>
      )}
    </section>
  );
}
