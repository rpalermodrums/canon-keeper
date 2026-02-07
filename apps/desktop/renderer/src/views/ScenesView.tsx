import type { JSX } from "react";
import { BookOpen, Quote, RefreshCw, Search } from "lucide-react";
import { Spinner } from "../components/Spinner";
import type { SceneDetail, SceneSummary } from "../api/ipc";
import { EmptyState } from "../components/EmptyState";
import { Skeleton } from "../components/Skeleton";

type ScenesViewProps = {
  busy: boolean;
  loaded: boolean;
  scenes: SceneSummary[];
  selectedSceneId: string;
  sceneDetail: SceneDetail | null;
  query: string;
  onQueryChange: (value: string) => void;
  onRefresh: () => void;
  onSelectScene: (sceneId: string) => void;
  onOpenEvidence: (title: string, sceneDetail: SceneDetail) => void;
};

function unknownReason(scene: SceneSummary): string {
  if (scene.pov_mode === "unknown") {
    return "Point of view could not be determined automatically.";
  }
  if (!scene.setting_text && !scene.setting_entity_id) {
    return "Setting could not be identified automatically.";
  }
  return "";
}

function confidenceLabel(value: number | null): string {
  if (value === null) return "unknown";
  if (value >= 0.8) return "high";
  if (value >= 0.5) return "medium";
  return "low";
}

function ScenesSkeleton(): JSX.Element {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <Skeleton variant="text" width="200px" height="28px" />
        <Skeleton variant="rect" width="100px" height="36px" />
      </div>
      <Skeleton variant="rect" width="100%" height="44px" />
      <div className="flex flex-col gap-1">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} variant="rect" width="100%" height="40px" />
        ))}
      </div>
    </section>
  );
}

export function ScenesView({
  busy,
  loaded,
  scenes,
  selectedSceneId,
  sceneDetail,
  query,
  onQueryChange,
  onRefresh,
  onSelectScene,
  onOpenEvidence
}: ScenesViewProps): JSX.Element {
  if (!loaded) {
    return <ScenesSkeleton />;
  }

  const filtered = scenes.filter((scene) => {
    const haystack = `${scene.ordinal} ${scene.title ?? ""} ${scene.pov_mode} ${scene.setting_text ?? ""}`.toLowerCase();
    return haystack.includes(query.toLowerCase().trim());
  });

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="m-0 font-display text-2xl font-bold">Scenes</h2>
          <p className="mt-1 text-sm text-text-muted">Browse your scenes, settings, and point of view.</p>
        </div>
        <button
          className="inline-flex items-center gap-1.5 rounded-sm border border-accent bg-accent px-4 py-2 text-sm font-medium text-text-inverse transition-colors hover:bg-accent-strong cursor-pointer disabled:opacity-50"
          type="button"
          onClick={onRefresh}
          disabled={busy}
        >
          {busy ? <Spinner size="sm" /> : <><RefreshCw size={16} /> Refresh Scenes</>}
        </button>
      </header>

      {/* Filter */}
      <div className="relative">
        <Search size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-text-muted" />
        <input
          className="w-full pl-9"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Filter by title, POV, setting"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No Scenes Yet"
          message="Add a manuscript to see your story's scene breakdown."
        />
      ) : (
        <div className="grid min-h-[420px] grid-cols-1 gap-4 lg:grid-cols-[minmax(320px,1fr)_minmax(340px,1fr)]">
          {/* Scene table */}
          <article className="overflow-x-auto rounded-md border border-border bg-white/75 p-3 shadow-sm dark:bg-surface-2/60">
            <table>
              <thead>
                <tr>
                  <th>Scene</th>
                  <th>POV</th>
                  <th>Setting</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((scene) => {
                  const selected = scene.id === selectedSceneId;
                  return (
                    <tr
                      key={scene.id}
                      className={`cursor-pointer transition-colors ${
                        selected
                          ? "border-l-3 border-l-accent bg-accent-soft/40"
                          : "even:bg-surface-1/30 hover:bg-surface-1/60"
                      }`}
                      tabIndex={0}
                      role="row"
                      aria-selected={selected}
                      onClick={() => onSelectScene(scene.id)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectScene(scene.id); } }}
                    >
                      <td>
                        <strong>#{scene.ordinal}</strong> {scene.title ?? "Untitled"}
                        {unknownReason(scene) ? <div className="mt-0.5 text-xs text-text-muted">{unknownReason(scene)}</div> : null}
                      </td>
                      <td>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          scene.pov_mode === "unknown" ? "bg-warn-soft text-warn" : "bg-accent-soft text-accent"
                        }`}>
                          {scene.pov_mode ?? "unknown"}
                        </span>
                      </td>
                      <td>
                        <span className={scene.setting_text ? "text-text-primary" : "text-text-muted italic"}>
                          {scene.setting_text ?? "unknown"}
                        </span>
                      </td>
                      <td
                        className="text-xs text-text-muted"
                        title={scene.pov_confidence !== null ? `${Math.round(scene.pov_confidence * 100)}%` : undefined}
                      >
                        {confidenceLabel(scene.pov_confidence)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </article>

          {/* Detail panel */}
          <article className="flex flex-col gap-3 rounded-md border border-border bg-white/75 p-4 shadow-sm dark:bg-surface-2/60">
            {!sceneDetail ? (
              <EmptyState
                icon={BookOpen}
                title="No Scene Selected"
                message="Select a scene to see its details."
              />
            ) : (
              <>
                <h3 className="m-0 font-display text-lg font-bold">
                  Scene {sceneDetail.scene.ordinal}: {sceneDetail.scene.title ?? "Untitled"}
                </h3>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent">
                    POV: {sceneDetail.scene.pov_mode}
                  </span>
                  <span className="rounded-full bg-surface-1 px-2.5 py-0.5 text-xs font-medium dark:bg-surface-2">
                    Setting {sceneDetail.scene.setting_text ?? "unknown"}
                  </span>
                </div>
                <button
                  className="inline-flex items-center gap-1.5 self-start rounded-sm border border-border bg-surface-2 px-3 py-1.5 text-sm transition-colors hover:enabled:bg-white cursor-pointer disabled:opacity-50 dark:bg-surface-1"
                  type="button"
                  onClick={() => onOpenEvidence(`Scene ${sceneDetail.scene.ordinal}`, sceneDetail)}
                  disabled={sceneDetail.evidence.length === 0}
                >
                  <Quote size={14} />
                  Open Evidence ({sceneDetail.evidence.length})
                </button>
                <div className="flex flex-col gap-2">
                  {sceneDetail.chunks.slice(0, 6).map((chunk) => (
                    <div key={chunk.id} className="rounded-sm border-l-3 border-l-accent bg-surface-1/50 p-3 dark:bg-surface-2/30">
                      <div className="font-mono text-xs text-text-muted">
                        Passage {chunk.ordinal}
                      </div>
                      <div className="mt-1 text-sm text-text-secondary">{chunk.text.slice(0, 180)}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </article>
        </div>
      )}
    </section>
  );
}
