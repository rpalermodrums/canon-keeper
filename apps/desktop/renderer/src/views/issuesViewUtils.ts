import type { IssueSummary } from "../api/ipc";

export type IssueFilters = {
  status: "open" | "dismissed" | "resolved" | "all";
  severity: "all" | "low" | "medium" | "high";
  type: string;
  query: string;
  sort: "recency" | "severity" | "type";
};

export type IssueStatistics = {
  total: number;
  byType: Record<string, number>;
  bySeverity: Record<string, number>;
  byStatus: Record<string, number>;
};

export const DEFAULT_ISSUE_FILTERS: IssueFilters = {
  status: "open",
  severity: "all",
  type: "",
  query: "",
  sort: "recency"
};

const SEVERITY_WEIGHT: Record<string, number> = { high: 0, medium: 1, low: 2 };
const STYLE_ISSUE_TYPES = new Set(["repetition", "tone_drift", "dialogue_tic"]);

function matchesTypeFilter(issueType: string, typeFilter: string): boolean {
  if (typeFilter === "__style__") {
    return STYLE_ISSUE_TYPES.has(issueType);
  }
  return !typeFilter || issueType === typeFilter;
}

export function filterIssues(issues: readonly IssueSummary[], filters: IssueFilters): IssueSummary[] {
  const normalizedQuery = filters.query.trim().toLowerCase();

  return issues.filter((issue) => {
    const statusMatch = filters.status === "all" || issue.status === filters.status;
    const severityMatch = filters.severity === "all" || issue.severity === filters.severity;
    const typeMatch = matchesTypeFilter(issue.type, filters.type);
    const queryMatch =
      normalizedQuery.length === 0 ||
      `${issue.title} ${issue.description} ${issue.type}`.toLowerCase().includes(normalizedQuery);

    return statusMatch && severityMatch && typeMatch && queryMatch;
  });
}

export function sortIssues(
  issues: readonly IssueSummary[],
  sortMode: IssueFilters["sort"]
): IssueSummary[] {
  return [...issues].sort((a, b) => {
    if (sortMode === "severity") {
      const wa = SEVERITY_WEIGHT[a.severity] ?? 3;
      const wb = SEVERITY_WEIGHT[b.severity] ?? 3;
      return wa !== wb ? wa - wb : b.created_at - a.created_at;
    }
    if (sortMode === "type") {
      const cmp = a.type.localeCompare(b.type);
      return cmp !== 0 ? cmp : b.created_at - a.created_at;
    }
    return b.created_at - a.created_at;
  });
}

export function filterAndSortIssues(issues: readonly IssueSummary[], filters: IssueFilters): IssueSummary[] {
  const filtered = filterIssues(issues, filters);
  return sortIssues(filtered, filters.sort);
}

export function listKnownIssueTypes(issues: readonly IssueSummary[]): string[] {
  return Array.from(new Set(issues.map((issue) => issue.type))).sort((a, b) => a.localeCompare(b));
}

export function computeIssueStatistics(issues: readonly IssueSummary[]): IssueStatistics {
  const byType: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  const byStatus: Record<string, number> = {};

  for (const issue of issues) {
    byType[issue.type] = (byType[issue.type] ?? 0) + 1;
    bySeverity[issue.severity] = (bySeverity[issue.severity] ?? 0) + 1;
    byStatus[issue.status] = (byStatus[issue.status] ?? 0) + 1;
  }

  return {
    total: issues.length,
    byType,
    bySeverity,
    byStatus
  };
}
