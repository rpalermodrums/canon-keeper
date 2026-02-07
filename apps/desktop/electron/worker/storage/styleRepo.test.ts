import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import { createProject } from "./projectRepo";
import { runMigrations } from "./migrations";
import {
  deleteStyleMetricsByName,
  listStyleMetrics,
  replaceStyleMetric,
  type StyleMetricInput
} from "./styleRepo";

type Setup = {
  db: Database.Database;
  projectId: string;
  otherProjectId: string;
};

const openDbs: Database.Database[] = [];

function setupMemoryDb(): Setup {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db, path.resolve("migrations"));
  const project = createProject(db, "/tmp/style-repo-project-a", "Style Repo A");
  const otherProject = createProject(db, "/tmp/style-repo-project-b", "Style Repo B");
  openDbs.push(db);
  return {
    db,
    projectId: project.id,
    otherProjectId: otherProject.id
  };
}

function insertMetric(db: Database.Database, input: StyleMetricInput): void {
  replaceStyleMetric(db, input);
}

afterEach(() => {
  for (const db of openDbs) {
    db.close();
  }
  openDbs.length = 0;
});

describe("styleRepo", () => {
  it("deleteStyleMetricsByName without scopeType deletes all matching metrics for the project", () => {
    const setup = setupMemoryDb();
    insertMetric(setup.db, {
      projectId: setup.projectId,
      scopeType: "project",
      scopeId: setup.projectId,
      metricName: "tone_vector",
      metricJson: JSON.stringify({ score: 0.2 })
    });
    insertMetric(setup.db, {
      projectId: setup.projectId,
      scopeType: "scene",
      scopeId: "scene-1",
      metricName: "tone_vector",
      metricJson: JSON.stringify({ score: 0.8 })
    });
    insertMetric(setup.db, {
      projectId: setup.projectId,
      scopeType: "project",
      scopeId: setup.projectId,
      metricName: "ngram_freq",
      metricJson: JSON.stringify({ top: [] })
    });
    insertMetric(setup.db, {
      projectId: setup.otherProjectId,
      scopeType: "project",
      scopeId: setup.otherProjectId,
      metricName: "tone_vector",
      metricJson: JSON.stringify({ score: 0.4 })
    });

    deleteStyleMetricsByName(setup.db, {
      projectId: setup.projectId,
      metricName: "tone_vector"
    });

    const currentProject = listStyleMetrics(setup.db, { projectId: setup.projectId });
    const otherProject = listStyleMetrics(setup.db, { projectId: setup.otherProjectId });

    expect(currentProject.map((row) => row.metric_name)).toEqual(["ngram_freq"]);
    expect(otherProject.map((row) => row.metric_name)).toEqual(["tone_vector"]);
  });

  it("deleteStyleMetricsByName with scopeType deletes only matching scoped metrics", () => {
    const setup = setupMemoryDb();
    insertMetric(setup.db, {
      projectId: setup.projectId,
      scopeType: "project",
      scopeId: setup.projectId,
      metricName: "tone_vector",
      metricJson: JSON.stringify({ score: 0.3 })
    });
    insertMetric(setup.db, {
      projectId: setup.projectId,
      scopeType: "scene",
      scopeId: "scene-1",
      metricName: "tone_vector",
      metricJson: JSON.stringify({ score: 0.5 })
    });
    insertMetric(setup.db, {
      projectId: setup.projectId,
      scopeType: "entity",
      scopeId: "entity-1",
      metricName: "tone_vector",
      metricJson: JSON.stringify({ score: 0.9 })
    });

    deleteStyleMetricsByName(setup.db, {
      projectId: setup.projectId,
      scopeType: "scene",
      metricName: "tone_vector"
    });

    const remaining = listStyleMetrics(setup.db, { projectId: setup.projectId }).sort((left, right) =>
      left.scope_type.localeCompare(right.scope_type)
    );

    expect(remaining).toHaveLength(2);
    expect(remaining.map((row) => row.scope_type)).toEqual(["entity", "project"]);
    expect(remaining.every((row) => row.metric_name === "tone_vector")).toBe(true);
  });

  it("listStyleMetrics with scopeType and scopeId returns only that scoped subset", () => {
    const setup = setupMemoryDb();
    insertMetric(setup.db, {
      projectId: setup.projectId,
      scopeType: "scene",
      scopeId: "scene-1",
      metricName: "tone_vector",
      metricJson: JSON.stringify({ score: 0.4 })
    });
    insertMetric(setup.db, {
      projectId: setup.projectId,
      scopeType: "scene",
      scopeId: "scene-1",
      metricName: "dialogue_tics",
      metricJson: JSON.stringify({ tics: [] })
    });
    insertMetric(setup.db, {
      projectId: setup.projectId,
      scopeType: "scene",
      scopeId: "scene-2",
      metricName: "tone_vector",
      metricJson: JSON.stringify({ score: 0.7 })
    });
    insertMetric(setup.db, {
      projectId: setup.projectId,
      scopeType: "project",
      scopeId: setup.projectId,
      metricName: "ngram_freq",
      metricJson: JSON.stringify({ top: [] })
    });

    const scoped = listStyleMetrics(setup.db, {
      projectId: setup.projectId,
      scopeType: "scene",
      scopeId: "scene-1"
    }).sort((left, right) => left.metric_name.localeCompare(right.metric_name));

    expect(scoped).toHaveLength(2);
    expect(scoped.map((row) => `${row.scope_type}:${row.scope_id}:${row.metric_name}`)).toEqual([
      "scene:scene-1:dialogue_tics",
      "scene:scene-1:tone_vector"
    ]);
  });

  it("listStyleMetrics without scope filters returns all rows for the project", () => {
    const setup = setupMemoryDb();
    insertMetric(setup.db, {
      projectId: setup.projectId,
      scopeType: "project",
      scopeId: setup.projectId,
      metricName: "ngram_freq",
      metricJson: JSON.stringify({ top: [] })
    });
    insertMetric(setup.db, {
      projectId: setup.projectId,
      scopeType: "scene",
      scopeId: "scene-x",
      metricName: "tone_vector",
      metricJson: JSON.stringify({ calm: 0.2 })
    });
    insertMetric(setup.db, {
      projectId: setup.otherProjectId,
      scopeType: "project",
      scopeId: setup.otherProjectId,
      metricName: "dialogue_tics",
      metricJson: JSON.stringify({ tics: [] })
    });

    const currentProject = listStyleMetrics(setup.db, { projectId: setup.projectId });

    expect(currentProject).toHaveLength(2);
    expect(currentProject.every((row) => row.project_id === setup.projectId)).toBe(true);
    expect(currentProject.map((row) => row.metric_name).sort()).toEqual(["ngram_freq", "tone_vector"]);
  });

  it("replaceStyleMetric applies delete-then-insert semantics for the same key", () => {
    const setup = setupMemoryDb();

    insertMetric(setup.db, {
      projectId: setup.projectId,
      scopeType: "scene",
      scopeId: "scene-4",
      metricName: "tone_vector",
      metricJson: JSON.stringify({ score: 0.1 })
    });
    const first = listStyleMetrics(setup.db, {
      projectId: setup.projectId,
      scopeType: "scene",
      scopeId: "scene-4"
    });
    const firstRow = first[0];
    if (!firstRow) {
      throw new Error("Expected first style metric row");
    }

    insertMetric(setup.db, {
      projectId: setup.projectId,
      scopeType: "scene",
      scopeId: "scene-4",
      metricName: "tone_vector",
      metricJson: JSON.stringify({ score: 0.9 })
    });
    const second = listStyleMetrics(setup.db, {
      projectId: setup.projectId,
      scopeType: "scene",
      scopeId: "scene-4"
    });
    const secondRow = second[0];
    if (!secondRow) {
      throw new Error("Expected second style metric row");
    }

    expect(second).toHaveLength(1);
    expect(secondRow.metric_json).toBe(JSON.stringify({ score: 0.9 }));
    expect(secondRow.id).not.toBe(firstRow.id);
  });
});
