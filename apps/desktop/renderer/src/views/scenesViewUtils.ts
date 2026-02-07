import type { SceneSummary } from "../api/ipc";

export function unknownReason(scene: SceneSummary): string {
  if (scene.pov_mode === "unknown") {
    return "Point of view could not be determined automatically.";
  }
  if (!scene.setting_text && !scene.setting_entity_id) {
    return "Setting could not be identified automatically.";
  }
  return "";
}

export function confidenceLabel(value: number | null): "unknown" | "high" | "medium" | "low" {
  if (value === null) return "unknown";
  if (value >= 0.8) return "high";
  if (value >= 0.5) return "medium";
  return "low";
}

export function formatPovDisplay(povMode: string | null | undefined): string {
  const normalized = povMode?.trim() ?? "";
  return normalized.length > 0 ? normalized : "unknown";
}

export function sortScenesByOrdinal(scenes: readonly SceneSummary[]): SceneSummary[] {
  return [...scenes].sort((a, b) => {
    if (a.ordinal !== b.ordinal) {
      return a.ordinal - b.ordinal;
    }
    const titleA = a.title ?? "";
    const titleB = b.title ?? "";
    return titleA.localeCompare(titleB);
  });
}

export function filterScenes(scenes: readonly SceneSummary[], query: string): SceneSummary[] {
  const normalizedQuery = query.toLowerCase().trim();
  return sortScenesByOrdinal(scenes).filter((scene) => {
    const haystack = `${scene.ordinal} ${scene.title ?? ""} ${formatPovDisplay(scene.pov_mode)} ${scene.setting_text ?? ""}`
      .toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}
