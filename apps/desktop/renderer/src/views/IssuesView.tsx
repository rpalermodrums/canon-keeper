import { useState, type JSX } from "react";
import { AlertTriangle, BookOpen, CheckCircle, Quote, RefreshCw, Search, XCircle } from "lucide-react";
import { Spinner } from "../components/Spinner";
import type { IssueSummary } from "../api/ipc";
import { EmptyState } from "../components/EmptyState";
import { FilterBar, FilterGroup } from "../components/FilterBar";
import { Skeleton } from "../components/Skeleton";
import { StatusBadge } from "../components/StatusBadge";
import { TogglePill } from "../components/TogglePill";

type IssueFilters = {
  status: "open" | "dismissed" | "resolved" | "all";
  severity: "all" | "low" | "medium" | "high";
  type: string;
  query: string;
  sort: "recency" | "severity" | "type";
};

type IssuesViewProps = {
  busy: boolean;
  loaded: boolean;
  issues: IssueSummary[];
  selectedIssueId: string;
  filters: IssueFilters;
  onFiltersChange: (next: IssueFilters) => void;
  onRefresh: () => void;
  onSelectIssue: (issueId: string) => void;
  onRequestDismiss: (issue: IssueSummary) => void;
  onResolve: (issueId: string) => void;
  onOpenEvidence: (title: string, issue: IssueSummary) => void;
  onNavigateToScene?: (sceneId: string) => void;
};

const ISSUE_TYPE_LABELS: Record<string, string> = {
  tone_drift: "Tone Shift",
  dialogue_tic: "Dialogue Habit",
  contradiction: "Contradiction",
  timeline_error: "Timeline Issue",
  character_inconsistency: "Character Inconsistency",
  setting_error: "Setting Inconsistency",
  repetition: "Repetition"
};

const severityBorderColor: Record<string, string> = {
  high: "border-l-danger",
  medium: "border-l-warn",
  low: "border-l-ok"
};

const statusOptions = [
  { value: "open" as const, label: "Open" },
  { value: "dismissed" as const, label: "Dismissed" },
  { value: "resolved" as const, label: "Resolved" },
  { value: "all" as const, label: "All" }
];

const severityOptions = [
  { value: "all" as const, label: "All" },
  { value: "low" as const, label: "Low" },
  { value: "medium" as const, label: "Medium" },
  { value: "high" as const, label: "High" }
];

const sortOptions = [
  { value: "recency" as const, label: "Newest" },
  { value: "severity" as const, label: "Severity" },
  { value: "type" as const, label: "Type" }
];

const SEVERITY_WEIGHT: Record<string, number> = { high: 0, medium: 1, low: 2 };

const STYLE_ISSUE_TYPES = new Set(["repetition", "tone_drift", "dialogue_tic"]);

const relativeTime = (unixMs: number): string => {
  const seconds = Math.floor((Date.now() - unixMs) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(unixMs).toLocaleDateString();
};

function IssuesSkeleton(): JSX.Element {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <Skeleton variant="text" width="160px" height="28px" />
        <Skeleton variant="rect" width="120px" height="36px" />
      </div>
      <Skeleton variant="rect" width="100%" height="44px" />
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} variant="rect" width="100%" height="100px" />
        ))}
      </div>
    </section>
  );
}

export function IssuesView({
  busy,
  loaded,
  issues,
  selectedIssueId,
  filters,
  onFiltersChange,
  onRefresh,
  onSelectIssue,
  onRequestDismiss,
  onResolve,
  onOpenEvidence,
  onNavigateToScene
}: IssuesViewProps): JSX.Element {
  const [confirmingResolveId, setConfirmingResolveId] = useState<string | null>(null);
  const isStyleOnly = filters.type === "__style__";

  if (!loaded) {
    return <IssuesSkeleton />;
  }

  const filtered = issues
    .filter((issue) => {
      const statusMatch = filters.status === "all" || issue.status === filters.status;
      const severityMatch = filters.severity === "all" || issue.severity === filters.severity;
      const typeMatch = isStyleOnly
        ? STYLE_ISSUE_TYPES.has(issue.type)
        : !filters.type || issue.type === filters.type;
      const q = filters.query.trim().toLowerCase();
      const queryMatch = q.length === 0 || `${issue.title} ${issue.description} ${issue.type}`.toLowerCase().includes(q);
      return statusMatch && severityMatch && typeMatch && queryMatch;
    })
    .sort((a, b) => {
      if (filters.sort === "severity") {
        const wa = SEVERITY_WEIGHT[a.severity] ?? 3;
        const wb = SEVERITY_WEIGHT[b.severity] ?? 3;
        return wa !== wb ? wa - wb : b.created_at - a.created_at;
      }
      if (filters.sort === "type") {
        const cmp = a.type.localeCompare(b.type);
        return cmp !== 0 ? cmp : b.created_at - a.created_at;
      }
      return b.created_at - a.created_at;
    });

  const knownTypes = Array.from(new Set(issues.map((issue) => issue.type))).sort();

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="m-0 font-display text-2xl font-bold">Issues</h2>
          <p className="mt-1 text-sm text-text-muted">
            Potential continuity issues found in your manuscript.
          </p>
        </div>
        <button
          className="inline-flex items-center gap-1.5 rounded-sm border border-accent bg-accent px-4 py-2 text-sm font-medium text-text-inverse transition-colors hover:bg-accent-strong cursor-pointer disabled:opacity-50"
          type="button"
          onClick={onRefresh}
          disabled={busy}
        >
          {busy ? <Spinner size="sm" /> : <><RefreshCw size={16} /> Refresh Issues</>}
        </button>
      </header>

      <FilterBar
        resultCount={filtered.length}
        actions={
          <button
            className="rounded-sm border border-transparent bg-transparent px-2 py-1 text-xs text-text-muted transition-colors hover:text-text-primary cursor-pointer"
            type="button"
            onClick={() => onFiltersChange({ status: "open", severity: "all", type: "", query: "", sort: "recency" })}
          >
            Reset
          </button>
        }
      >
        <TogglePill
          label="Status"
          options={statusOptions}
          value={filters.status}
          onChange={(v) => onFiltersChange({ ...filters, status: v })}
        />
        <TogglePill
          label="Severity"
          options={severityOptions}
          value={filters.severity}
          onChange={(v) => onFiltersChange({ ...filters, severity: v })}
        />
        <TogglePill
          label="Sort"
          options={sortOptions}
          value={filters.sort}
          onChange={(v) => onFiltersChange({ ...filters, sort: v })}
        />
        <FilterGroup label="Type">
          <div className="flex items-center gap-1.5">
            <select
              value={isStyleOnly ? "__style__" : filters.type}
              onChange={(e) => onFiltersChange({ ...filters, type: e.target.value })}
            >
              <option value="">All</option>
              <option value="__style__">Style only</option>
              {knownTypes.map((type) => (
                <option key={type} value={type}>{ISSUE_TYPE_LABELS[type] ?? type}</option>
              ))}
            </select>
          </div>
        </FilterGroup>
        <FilterGroup label="Query">
          <div className="relative">
            <Search size={14} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-text-muted" />
            <input
              className="w-full pl-8"
              value={filters.query}
              onChange={(e) => onFiltersChange({ ...filters, query: e.target.value })}
              placeholder="Search title or description"
            />
          </div>
        </FilterGroup>
      </FilterBar>

      {filtered.length === 0 ? (
        <EmptyState
          icon={AlertTriangle}
          title="No Matching Issues"
          message={filters.status !== "open" || filters.severity !== "all" || filters.query
            ? "Adjust filters to see more issues."
            : "No issues found. Add more manuscript files to check for continuity problems."
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((issue, i) => {
            const selected = selectedIssueId === issue.id;
            const borderColor = severityBorderColor[issue.severity] ?? "border-l-border";
            return (
              <div
                key={issue.id}
                className={`rounded-sm border border-border border-l-3 ${borderColor} bg-white/75 p-3 transition-all cursor-pointer animate-slide-in-up dark:bg-surface-2/60 ${
                  selected ? "ring-1 ring-accent/30 shadow-sm" : "hover:shadow-sm"
                }`}
                style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}
                tabIndex={0}
                role="button"
                onClick={() => onSelectIssue(issue.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectIssue(issue.id); } }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <strong className="text-sm">{issue.title}</strong>
                    <div className="mt-0.5 text-xs text-text-muted">{issue.description}</div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <div className="flex items-center gap-1.5">
                      <StatusBadge label={issue.severity} status={issue.severity} />
                      <StatusBadge label={issue.status} status={issue.status} />
                    </div>
                    <span className="text-xs text-text-muted">Found {relativeTime(issue.created_at)}</span>
                  </div>
                </div>

                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="text-xs text-text-muted">{ISSUE_TYPE_LABELS[issue.type] ?? issue.type}</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      className="inline-flex items-center gap-1 rounded-sm border border-border bg-transparent px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-1 cursor-pointer disabled:opacity-50"
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onOpenEvidence(issue.title, issue); }}
                    >
                      <Quote size={12} />
                      Evidence ({issue.evidence.length})
                    </button>
                    {(() => {
                      const sceneEvidence = issue.evidence.find((e) => e.sceneId);
                      if (!sceneEvidence?.sceneId || !onNavigateToScene) return null;
                      return (
                        <button
                          className="inline-flex items-center gap-1 rounded-sm border border-border bg-transparent px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-1 cursor-pointer"
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onNavigateToScene(sceneEvidence.sceneId!); }}
                        >
                          <BookOpen size={12} />
                          View Scene
                        </button>
                      );
                    })()}
                    <button
                      className="inline-flex items-center gap-1 rounded-sm border border-border bg-transparent px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-1 cursor-pointer disabled:opacity-50"
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onRequestDismiss(issue); }}
                      disabled={issue.status !== "open"}
                    >
                      <XCircle size={12} />
                      Dismiss
                    </button>
                    {confirmingResolveId === issue.id ? (
                      <span className="inline-flex items-center gap-2 text-xs">
                        <span className="text-text-muted">Mark resolved?</span>
                        <button
                          type="button"
                          className="text-accent underline cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            onResolve(issue.id);
                            setConfirmingResolveId(null);
                          }}
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          className="text-text-muted underline cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmingResolveId(null);
                          }}
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        className="inline-flex items-center gap-1 rounded-sm border border-border bg-transparent px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-1 cursor-pointer disabled:opacity-50"
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmingResolveId(issue.id);
                        }}
                        disabled={issue.status !== "open"}
                      >
                        <CheckCircle size={12} />
                        Resolve
                      </button>
                    )}
                  </div>
                </div>

                {issue.evidence.length > 0 ? (
                  <div className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2">
                    {issue.evidence.slice(0, 2).map((item, idx) => (
                      <div key={`${issue.id}-e-${idx}`} className="rounded-sm border border-border bg-surface-1/30 p-2 dark:bg-surface-1/20">
                        <div className="text-xs text-text-muted">
                          {(item.documentPath ?? "unknown").split("/").pop()} | Passage {item.chunkOrdinal ?? "?"}
                        </div>
                        <div className="mt-1 border-l-2 border-accent pl-2 text-xs italic text-text-secondary">
                          &quot;{item.excerpt}&quot;
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export type { IssueFilters };
