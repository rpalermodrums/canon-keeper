import { describe, expect, it } from "vitest";
import {
  deriveWorkingSuccessTransition,
  normalizePhaseToStage,
  pickLatest,
  resolveSuccessTimerCompletion,
  SUCCESS_BANNER_HIDE_DELAY_MS,
  type ProcessingRow
} from "./progressBannerUtils";

describe("normalizePhaseToStage", () => {
  it("maps extract phase to extraction stage", () => {
    expect(normalizePhaseToStage("extract")).toBe("extraction");
  });

  it("keeps non-aliased phases unchanged", () => {
    expect(normalizePhaseToStage("ingest")).toBe("ingest");
    expect(normalizePhaseToStage("continuity")).toBe("continuity");
  });
});

describe("pickLatest", () => {
  it("returns null for empty arrays", () => {
    expect(pickLatest<ProcessingRow>([])).toBeNull();
  });

  it("returns the row with the highest updated_at value", () => {
    const rows: ProcessingRow[] = [
      {
        stage: "ingest",
        status: "ok",
        error: null,
        updated_at: 100,
        document_path: "/tmp/one.md"
      },
      {
        stage: "style",
        status: "running",
        error: null,
        updated_at: 300,
        document_path: "/tmp/two.md"
      },
      {
        stage: "continuity",
        status: "pending",
        error: null,
        updated_at: 200,
        document_path: "/tmp/three.md"
      }
    ];

    const before = [...rows];
    const latest = pickLatest(rows);

    expect(latest).toBe(rows[1]);
    expect(rows).toEqual(before);
  });
});

describe("deriveWorkingSuccessTransition", () => {
  it("tracks running work and hides success during processing", () => {
    expect(deriveWorkingSuccessTransition(true, false)).toEqual({
      nextWasWorking: true,
      nextShowSuccess: false,
      hideAfterMs: null
    });
    expect(deriveWorkingSuccessTransition(true, true)).toEqual({
      nextWasWorking: true,
      nextShowSuccess: false,
      hideAfterMs: null
    });
  });

  it("stays hidden when idle before any work has run", () => {
    expect(deriveWorkingSuccessTransition(false, false)).toEqual({
      nextWasWorking: false,
      nextShowSuccess: false,
      hideAfterMs: null
    });
  });

  it("shows success and schedules auto-hide when work just finished", () => {
    expect(deriveWorkingSuccessTransition(false, true)).toEqual({
      nextWasWorking: true,
      nextShowSuccess: true,
      hideAfterMs: SUCCESS_BANNER_HIDE_DELAY_MS
    });
  });
});

describe("resolveSuccessTimerCompletion", () => {
  it("resets banner state after the success timeout", () => {
    expect(resolveSuccessTimerCompletion()).toEqual({
      nextWasWorking: false,
      nextShowSuccess: false
    });
  });
});
