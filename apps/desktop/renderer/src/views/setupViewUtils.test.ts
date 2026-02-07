import { describe, expect, it } from "vitest";
import type { ProjectDiagnostics } from "../api/ipc";
import {
  areDiagnosticsReady,
  canAddDocument,
  canRunDiagnostics,
  getNextSetupStepIndex,
  isDocumentPathValid,
  isProjectPathValid,
  stepState
} from "./setupViewUtils";

const HEALTHY_DIAGNOSTICS: ProjectDiagnostics = {
  ipc: "ok",
  worker: "ok",
  sqlite: "ok",
  writable: "ok",
  details: [],
  recommendations: []
};

const UNHEALTHY_DIAGNOSTICS: ProjectDiagnostics = {
  ipc: "ok",
  worker: "ok",
  sqlite: "error",
  writable: "ok",
  details: ["SQLite unavailable"],
  recommendations: ["Install native SQLite bindings"]
};

describe("stepState", () => {
  it("returns active for step 1 until a project is opened", () => {
    expect(stepState(0, false, false, false)).toBe("active");
    expect(stepState(0, true, false, false)).toBe("done");
  });

  it("returns todo/active/done transitions for step 2", () => {
    expect(stepState(1, false, false, false)).toBe("todo");
    expect(stepState(1, true, false, false)).toBe("active");
    expect(stepState(1, true, true, false)).toBe("done");
  });

  it("returns todo/active/done transitions for step 3", () => {
    expect(stepState(2, false, false, false)).toBe("todo");
    expect(stepState(2, true, false, false)).toBe("todo");
    expect(stepState(2, true, true, false)).toBe("active");
    expect(stepState(2, true, true, true)).toBe("done");
  });
});

describe("validation helpers", () => {
  it("validates project path input", () => {
    expect(isProjectPathValid("")).toBe(false);
    expect(isProjectPathValid("   ")).toBe(false);
    expect(isProjectPathValid("/Users/writer/novel")).toBe(true);
  });

  it("gates document controls by project state", () => {
    expect(canAddDocument(false)).toBe(false);
    expect(canAddDocument(true)).toBe(true);
  });

  it("validates document path with project prerequisites", () => {
    expect(isDocumentPathValid(false, "/tmp/ch1.md")).toBe(false);
    expect(isDocumentPathValid(true, "")).toBe(false);
    expect(isDocumentPathValid(true, "   ")).toBe(false);
    expect(isDocumentPathValid(true, "/tmp/ch1.md")).toBe(true);
  });

  it("requires both project and documents to run diagnostics", () => {
    expect(canRunDiagnostics(false, false)).toBe(false);
    expect(canRunDiagnostics(true, false)).toBe(false);
    expect(canRunDiagnostics(false, true)).toBe(false);
    expect(canRunDiagnostics(true, true)).toBe(true);
  });

  it("treats diagnostics as ready only when health check has no details", () => {
    expect(areDiagnosticsReady(null)).toBe(false);
    expect(areDiagnosticsReady(UNHEALTHY_DIAGNOSTICS)).toBe(false);
    expect(areDiagnosticsReady(HEALTHY_DIAGNOSTICS)).toBe(true);
  });
});

describe("getNextSetupStepIndex", () => {
  it("advances through wizard steps in order", () => {
    expect(getNextSetupStepIndex(false, false, false)).toBe(0);
    expect(getNextSetupStepIndex(true, false, false)).toBe(1);
    expect(getNextSetupStepIndex(true, true, false)).toBe(2);
  });

  it("returns null when all steps are complete", () => {
    expect(getNextSetupStepIndex(true, true, true)).toBeNull();
  });
});
