import { useMemo, useState, type JSX } from "react";
import { Activity, BookOpen, MessageSquare, Palette, Quote, RefreshCw, Repeat } from "lucide-react";
import type { EvidenceItem, IssueSummary, StyleReport } from "../api/ipc";
import { EmptyState } from "../components/EmptyState";
import { Skeleton } from "../components/Skeleton";
import { Spinner } from "../components/Spinner";
import { TogglePill } from "../components/TogglePill";
import {
  examplesToEvidenceItems,
  findSceneEvidenceId,
  getMaxRepetitionCount,
  getRepetitionToggleLabel,
  getVisibleRepetitionEntries,
  partitionStyleIssues,
  sortRepetitionEntries,
  toRepetitionEntries,
  type RepetitionSort
} from "./styleViewUtils";

type StyleViewProps = {
  busy: boolean;
  loaded: boolean;
  report: StyleReport | null;
  styleIssues: IssueSummary[];
  onRefresh: () => void;
  onOpenIssueEvidence: (title: string, issue: IssueSummary) => void;
  onOpenMetricEvidence: (title: string, evidence: EvidenceItem[]) => void;
  onNavigateToScene?: (sceneId: string) => void;
};

const sortOptions = [
  { value: "count" as const, label: "Count" },
  { value: "ngram" as const, label: "Phrase" }
];

function StyleSkeleton(): JSX.Element {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <Skeleton variant="text" width="140px" height="28px" />
        <Skeleton variant="rect" width="120px" height="36px" />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} variant="rect" width="100%" height="160px" />
        ))}
      </div>
    </section>
  );
}

export function StyleView({
  busy,
  loaded,
  report,
  styleIssues,
  onRefresh,
  onOpenIssueEvidence,
  onOpenMetricEvidence,
  onNavigateToScene
}: StyleViewProps): JSX.Element {
  const [sortBy, setSortBy] = useState<RepetitionSort>("count");
  const [showAllRepetitions, setShowAllRepetitions] = useState(false);
  const entries = useMemo(() => {
    return sortRepetitionEntries(toRepetitionEntries(report), sortBy);
  }, [report, sortBy]);
  const visibleEntries = useMemo(
    () => getVisibleRepetitionEntries(entries, showAllRepetitions),
    [entries, showAllRepetitions]
  );
  const { toneIssues, dialogueIssues } = useMemo(
    () => partitionStyleIssues(styleIssues),
    [styleIssues]
  );

  if (!loaded) {
    return <StyleSkeleton />;
  }

  const maxCount = getMaxRepetitionCount(entries);
  const repetitionToggleLabel = getRepetitionToggleLabel(entries.length, showAllRepetitions);

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="m-0 font-display text-2xl font-bold">Style Report</h2>
          <p className="mt-1 text-sm text-text-muted">
            Patterns in your writing style — repeated phrases, tone shifts, and dialogue habits.
          </p>
        </div>
        <button
          className="inline-flex items-center gap-1.5 rounded-sm border border-accent bg-accent px-4 py-2 text-sm font-medium text-text-inverse transition-colors hover:bg-accent-strong cursor-pointer disabled:opacity-50"
          type="button"
          onClick={onRefresh}
          disabled={busy}
        >
          {busy ? <Spinner size="sm" /> : <><RefreshCw size={16} /> Refresh Style</>}
        </button>
      </header>

      {!report ? (
        <EmptyState icon={Palette} title="No Style Data" message="Add a manuscript to see your writing style patterns." />
      ) : (
        <>
          {/* Repetition */}
          <article className="flex flex-col gap-3 rounded-md border border-border bg-white/75 p-4 shadow-sm dark:bg-surface-2/60">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Repeat size={16} className="text-text-muted" />
                <h3 className="m-0 text-sm font-semibold">Repetition</h3>
              </div>
              <TogglePill options={sortOptions} value={sortBy} onChange={setSortBy} />
            </div>

            {entries.length === 0 ? (
              <EmptyState icon={Repeat} title="No Repeated Phrases" message="No notable repetition patterns found in your manuscript." />
            ) : (
              <div className="overflow-x-auto">
                <table>
                  <thead>
                    <tr>
                      <th>Repeated Phrase</th>
                      <th>Count</th>
                      <th className="w-36">Frequency</th>
                      <th>Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleEntries.map((entry) => {
                      const evidence: EvidenceItem[] = examplesToEvidenceItems(entry.examples);
                      return (
                        <tr key={entry.ngram}>
                          <td className="font-medium">{entry.ngram}</td>
                          <td className="font-mono text-sm">{entry.count}</td>
                          <td>
                            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3">
                              <div
                                className="h-full rounded-full bg-accent transition-all"
                                style={{ width: `${(entry.count / maxCount) * 100}%` }}
                              />
                            </div>
                          </td>
                          <td>
                            <button
                              className="inline-flex items-center gap-1 rounded-sm border border-border bg-transparent px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-1 cursor-pointer disabled:opacity-50"
                              type="button"
                              onClick={() => onOpenMetricEvidence(`Repetition: ${entry.ngram}`, evidence)}
                              disabled={evidence.length === 0}
                            >
                              <Quote size={12} />
                              Open ({evidence.length})
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {repetitionToggleLabel ? (
                  <button
                    type="button"
                    className="mt-3 self-start text-sm text-accent underline transition-colors hover:text-accent-strong cursor-pointer"
                    onClick={() => setShowAllRepetitions((prev) => !prev)}
                  >
                    {repetitionToggleLabel}
                  </button>
                ) : null}
              </div>
            )}
          </article>

          {/* Tone Drift */}
          <article className="flex flex-col gap-3 rounded-md border border-border bg-white/75 p-4 shadow-sm dark:bg-surface-2/60">
            <div className="flex items-center gap-2">
              <Activity size={16} className="text-text-muted" />
              <h3 className="m-0 text-sm font-semibold">Tone Shifts</h3>
            </div>
            {toneIssues.length === 0 ? (
              <EmptyState icon={Activity} title="No Tone Shifts" message="No unexpected tone changes detected across your scenes." />
            ) : (
              <div className="flex flex-col gap-2">
                {toneIssues.map((issue) => {
                  const sceneEvidenceId = findSceneEvidenceId(issue);
                  return (
                    <div key={issue.id} className="flex items-start justify-between gap-3 rounded-sm border border-border bg-surface-1/30 p-3 dark:bg-surface-1/20">
                      <div>
                        <strong className="text-sm">{issue.title}</strong>
                        <div className="mt-0.5 text-xs text-text-muted">{issue.description}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          className="inline-flex items-center gap-1 rounded-sm border border-border bg-transparent px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-1 cursor-pointer"
                          type="button"
                          onClick={() => onOpenIssueEvidence(issue.title, issue)}
                        >
                          <Quote size={12} />
                          Evidence ({issue.evidence.length})
                        </button>
                        {sceneEvidenceId && onNavigateToScene ? (
                          <button
                            className="inline-flex items-center gap-1 rounded-sm border border-border bg-transparent px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-1 cursor-pointer"
                            type="button"
                            onClick={() => onNavigateToScene(sceneEvidenceId)}
                          >
                            <BookOpen size={12} />
                            View Scene
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </article>

          {/* Dialogue Tics */}
          <article className="flex flex-col gap-3 rounded-md border border-border bg-white/75 p-4 shadow-sm dark:bg-surface-2/60">
            <div className="flex items-center gap-2">
              <MessageSquare size={16} className="text-text-muted" />
              <h3 className="m-0 text-sm font-semibold">Dialogue Habits</h3>
            </div>
            {dialogueIssues.length === 0 ? (
              <EmptyState icon={MessageSquare} title="No Dialogue Habits" message="No recurring dialogue patterns found in your characters' speech." />
            ) : (
              <div className="flex flex-col gap-2">
                {dialogueIssues.map((issue) => {
                  const sceneEvidenceId = findSceneEvidenceId(issue);
                  return (
                    <div key={issue.id} className="flex items-start justify-between gap-3 rounded-sm border border-border bg-surface-1/30 p-3 dark:bg-surface-1/20">
                      <div>
                        <strong className="text-sm">{issue.title}</strong>
                        <div className="mt-0.5 text-xs text-text-muted">{issue.description}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          className="inline-flex items-center gap-1 rounded-sm border border-border bg-transparent px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-1 cursor-pointer"
                          type="button"
                          onClick={() => onOpenIssueEvidence(issue.title, issue)}
                        >
                          <Quote size={12} />
                          Evidence ({issue.evidence.length})
                        </button>
                        {sceneEvidenceId && onNavigateToScene ? (
                          <button
                            className="inline-flex items-center gap-1 rounded-sm border border-border bg-transparent px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-1 cursor-pointer"
                            type="button"
                            onClick={() => onNavigateToScene(sceneEvidenceId)}
                          >
                            <BookOpen size={12} />
                            View Scene
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </article>
        </>
      )}
    </section>
  );
}
