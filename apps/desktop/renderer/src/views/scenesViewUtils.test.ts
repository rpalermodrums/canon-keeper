import { describe, expect, it, vi } from "vitest";
import type { SceneSummary } from "../api/ipc";
import {
  confidenceLabel,
  filterScenes,
  formatPovDisplay,
  sortScenesByOrdinal,
  unknownReason
} from "./scenesViewUtils";

function createScene(overrides: Partial<SceneSummary>): SceneSummary {
  return {
    id: "scene-1",
    project_id: "project-1",
    document_id: "doc-1",
    ordinal: 1,
    start_chunk_id: "chunk-1",
    end_chunk_id: "chunk-2",
    start_char: 0,
    end_char: 100,
    title: "Arrival",
    pov_mode: "first_person",
    pov_entity_id: null,
    pov_confidence: 0.85,
    setting_entity_id: null,
    setting_text: "Harbor",
    ...overrides
  };
}

describe("confidenceLabel", () => {
  it("returns labels for null and numeric thresholds", () => {
    expect(confidenceLabel(null)).toBe("unknown");
    expect(confidenceLabel(0.8)).toBe("high");
    expect(confidenceLabel(0.5)).toBe("medium");
    expect(confidenceLabel(0.49)).toBe("low");
  });
});

describe("unknownReason", () => {
  it("explains unknown POV and missing settings", () => {
    expect(unknownReason(createScene({ pov_mode: "unknown", setting_text: "Dock" }))).toBe(
      "Point of view could not be determined automatically."
    );
    expect(unknownReason(createScene({ pov_mode: "third_person", setting_text: null, setting_entity_id: null }))).toBe(
      "Setting could not be identified automatically."
    );
    expect(unknownReason(createScene({ pov_mode: "third_person", setting_text: "City" }))).toBe("");
  });
});

describe("sortScenesByOrdinal", () => {
  it("sorts scenes by ordinal and title for stable ordering", () => {
    const scenes = [
      createScene({ id: "b", ordinal: 2, title: "Beta" }),
      createScene({ id: "a", ordinal: 1, title: "Zulu" }),
      createScene({ id: "c", ordinal: 1, title: "Alpha" })
    ];

    const runSort = vi.fn(sortScenesByOrdinal);
    const sorted = runSort(scenes);

    expect(runSort).toHaveBeenCalledTimes(1);
    expect(sorted.map((scene) => scene.id)).toEqual(["c", "a", "b"]);
  });
});

describe("filterScenes", () => {
  it("filters by normalized query across ordinal/title/pov/setting", () => {
    const scenes = [
      createScene({ id: "s1", ordinal: 3, title: "Skyline", pov_mode: "first_person", setting_text: "Harbor" }),
      createScene({ id: "s2", ordinal: 1, title: "Vault", pov_mode: "third_person", setting_text: "Citadel" }),
      createScene({ id: "s3", ordinal: 2, title: "Night Watch", pov_mode: "unknown", setting_text: null })
    ];

    expect(filterScenes(scenes, "  citadel ").map((scene) => scene.id)).toEqual(["s2"]);
    expect(filterScenes(scenes, "unknown").map((scene) => scene.id)).toEqual(["s3"]);
    expect(filterScenes(scenes, "").map((scene) => scene.id)).toEqual(["s2", "s3", "s1"]);
  });
});

describe("formatPovDisplay", () => {
  it("normalizes missing POV values to unknown", () => {
    expect(formatPovDisplay("first_person")).toBe("first_person");
    expect(formatPovDisplay("   ")).toBe("unknown");
    expect(formatPovDisplay(null)).toBe("unknown");
  });
});
