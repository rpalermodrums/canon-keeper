import { describe, expect, it } from "vitest";
import type { IssueSummary } from "../api/ipc";
import {
  DEFAULT_ISSUE_FILTERS,
  computeIssueStatistics,
  filterAndSortIssues,
  filterIssues,
  listKnownIssueTypes,
  sortIssues,
  type IssueFilters
} from "./issuesViewUtils";

function createIssue(overrides: Partial<IssueSummary>): IssueSummary {
  return {
    id: "issue-default",
    project_id: "project-1",
    type: "contradiction",
    severity: "medium",
    title: "Default title",
    description: "Default description",
    status: "open",
    created_at: 1,
    updated_at: 1,
    evidence: [],
    ...overrides
  };
}

function createFilters(overrides: Partial<IssueFilters> = {}): IssueFilters {
  return {
    ...DEFAULT_ISSUE_FILTERS,
    status: "all",
    ...overrides
  };
}

const ISSUE_FIXTURES: IssueSummary[] = [
  createIssue({
    id: "a",
    type: "contradiction",
    severity: "high",
    status: "open",
    created_at: 10,
    title: "Timeline mismatch",
    description: "The date is inconsistent."
  }),
  createIssue({
    id: "b",
    type: "repetition",
    severity: "low",
    status: "open",
    created_at: 20,
    title: "Repeated phrase",
    description: "The phrase appears too often."
  }),
  createIssue({
    id: "c",
    type: "tone_drift",
    severity: "medium",
    status: "resolved",
    created_at: 30
  }),
  createIssue({
    id: "d",
    type: "dialogue_tic",
    severity: "high",
    status: "dismissed",
    created_at: 40
  }),
  createIssue({
    id: "e",
    type: "setting_error",
    severity: "medium",
    status: "open",
    created_at: 50
  }),
  createIssue({
    id: "f",
    type: "mystery",
    severity: "critical",
    status: "open",
    created_at: 60,
    title: "Unknown severity",
    description: "Used to verify fallback sorting weight."
  }),
  createIssue({
    id: "g",
    type: "contradiction",
    severity: "low",
    status: "open",
    created_at: 70
  })
];

describe("filterIssues", () => {
  it("filters by explicit type", () => {
    const filters = createFilters({ type: "setting_error" });
    const result = filterIssues(ISSUE_FIXTURES, filters);
    expect(result.map((issue) => issue.id)).toEqual(["e"]);
  });

  it("supports style-only pseudo type filter", () => {
    const filters = createFilters({ type: "__style__" });
    const result = filterIssues(ISSUE_FIXTURES, filters);
    expect(result.map((issue) => issue.id).sort()).toEqual(["b", "c", "d"]);
  });

  it("filters by severity", () => {
    const filters = createFilters({ severity: "high" });
    const result = filterIssues(ISSUE_FIXTURES, filters);
    expect(result.map((issue) => issue.id)).toEqual(["a", "d"]);
  });

  it("filters by status", () => {
    const filters = createFilters({ status: "resolved" });
    const result = filterIssues(ISSUE_FIXTURES, filters);
    expect(result.map((issue) => issue.id)).toEqual(["c"]);
  });

  it("filters by case-insensitive trimmed query across title, description, and type", () => {
    const byTitle = filterIssues(ISSUE_FIXTURES, createFilters({ query: "  timeline  " }));
    expect(byTitle.map((issue) => issue.id)).toEqual(["a"]);

    const byDescription = filterIssues(ISSUE_FIXTURES, createFilters({ query: "phrase appears" }));
    expect(byDescription.map((issue) => issue.id)).toEqual(["b"]);

    const byType = filterIssues(ISSUE_FIXTURES, createFilters({ query: "setting_error" }));
    expect(byType.map((issue) => issue.id)).toEqual(["e"]);
  });
});

describe("sortIssues", () => {
  it("sorts by recency descending", () => {
    const result = sortIssues(ISSUE_FIXTURES, "recency");
    expect(result.map((issue) => issue.id)).toEqual(["g", "f", "e", "d", "c", "b", "a"]);
  });

  it("sorts by severity weight then recency, with unknown severities last", () => {
    const result = sortIssues(ISSUE_FIXTURES, "severity");
    expect(result.map((issue) => issue.id)).toEqual(["d", "a", "e", "c", "g", "b", "f"]);
  });

  it("sorts by type alphabetically and resolves ties by recency", () => {
    const result = sortIssues(ISSUE_FIXTURES, "type");
    expect(result.map((issue) => issue.id)).toEqual(["g", "a", "d", "f", "b", "e", "c"]);
  });
});

describe("filterAndSortIssues", () => {
  it("applies filtering before sort and does not mutate the input array", () => {
    const originalOrder = ISSUE_FIXTURES.map((issue) => issue.id);
    const filters = createFilters({ severity: "low", sort: "recency" });
    const result = filterAndSortIssues(ISSUE_FIXTURES, filters);

    expect(result.map((issue) => issue.id)).toEqual(["g", "b"]);
    expect(ISSUE_FIXTURES.map((issue) => issue.id)).toEqual(originalOrder);
  });
});

describe("listKnownIssueTypes", () => {
  it("returns unique issue types sorted alphabetically", () => {
    expect(listKnownIssueTypes(ISSUE_FIXTURES)).toEqual([
      "contradiction",
      "dialogue_tic",
      "mystery",
      "repetition",
      "setting_error",
      "tone_drift"
    ]);
  });
});

describe("computeIssueStatistics", () => {
  it("computes counts by type, severity, and status", () => {
    const stats = computeIssueStatistics(ISSUE_FIXTURES);

    expect(stats.total).toBe(7);
    expect(stats.byType).toEqual({
      contradiction: 2,
      repetition: 1,
      tone_drift: 1,
      dialogue_tic: 1,
      setting_error: 1,
      mystery: 1
    });
    expect(stats.bySeverity).toEqual({
      high: 2,
      low: 2,
      medium: 2,
      critical: 1
    });
    expect(stats.byStatus).toEqual({
      open: 5,
      resolved: 1,
      dismissed: 1
    });
  });
});
