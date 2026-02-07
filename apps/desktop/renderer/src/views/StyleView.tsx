import { useMemo, useState, type JSX } from "react";
import { Activity, BookOpen, MessageSquare, Palette, Quote, RefreshCw, Repeat } from "lucide-react";
import type { EvidenceItem, IssueSummary, StyleReport } from "../api/ipc";
import { EmptyState } from "../components/EmptyState";
import { TogglePill } from "../components/TogglePill";

type RepetitionEntry = {
  ngram: string;
  count: number;
  examples?: Array<{
    chunkId: string;
    quoteStart: number;
    quoteEnd: number;
    documentPath?: string | null;
    chunkOrdinal?: number | null;
    excerpt?: string;
    lineStart?: number | null;
    lineEnd?: number | null;
  }>;
};

type StyleViewProps = {
  busy: boolean;
  report: StyleReport | null;
  styleIssues: IssueSummary[];
  onRefresh: () => void;
  onOpenIssueEvidence: (title: string, issue: IssueSummary) => void;
  onOpenMetricEvidence: (title: string, evidence: EvidenceItem[]) => void;
  onNavigateToScene?: (sceneId: string) => void;
};

function toRepetitionEntries(report: StyleReport | null): RepetitionEntry[] {
  if (!report?.repetition || typeof report.repetition !== "object") return [];
  const top = (report.repetition as { top?: RepetitionEntry[] }).top;
  return Array.isArray(top) ? top : [];
}

const sortOptions = [
  { value: "count" as const, label: "Count" },
  { value: "ngram" as const, label: "Phrase" }
];

export function StyleView({
  busy,
  report,
  styleIssues,
  onRefresh,
  onOpenIssueEvidence,
  onOpenMetricEvidence,
  onNavigateToScene
}: StyleViewProps): JSX.Element {
  const [sortBy, setSortBy] = useState<"count" | "ngram">("count");
  const entries = useMemo(() => {
    const base = toRepetitionEntries(report);
    return [...base].sort((a, b) =>
      sortBy === "count" ? b.count - a.count : a.ngram.localeCompare(b.ngram)
    );
  }, [report, sortBy]);

  const maxCount = entries.length > 0 ? Math.max(...entries.map((e) => e.count)) : 1;
  const toneIssues = styleIssues.filter((issue) => issue.type === "tone_drift");
  const dialogueIssues = styleIssues.filter((issue) => issue.type === "dialogue_tic");

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
          <RefreshCw size={16} />
          Refresh Style
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
              <p className="text-sm text-text-muted">No repetition metrics found.</p>
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
                    {entries.slice(0, 20).map((entry) => {
                      const evidence: EvidenceItem[] = (entry.examples ?? [])
                        .filter((ex): ex is NonNullable<typeof ex> => Boolean(ex))
                        .map((ex) => ({
                          chunkId: ex.chunkId,
                          quoteStart: ex.quoteStart,
                          quoteEnd: ex.quoteEnd,
                          excerpt: ex.excerpt ?? "",
                          documentPath: ex.documentPath ?? null,
                          chunkOrdinal: ex.chunkOrdinal ?? null,
                          lineStart: ex.lineStart ?? null,
                          lineEnd: ex.lineEnd ?? null
                        }));
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
              <p className="text-sm text-text-muted">No tone shift issues detected.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {toneIssues.map((issue) => {
                  const sceneEvidence = issue.evidence.find((e) => e.sceneId);
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
                        {sceneEvidence?.sceneId && onNavigateToScene ? (
                          <button
                            className="inline-flex items-center gap-1 rounded-sm border border-border bg-transparent px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-1 cursor-pointer"
                            type="button"
                            onClick={() => onNavigateToScene(sceneEvidence.sceneId!)}
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
              <p className="text-sm text-text-muted">No dialogue habit issues detected.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {dialogueIssues.map((issue) => {
                  const sceneEvidence = issue.evidence.find((e) => e.sceneId);
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
                        {sceneEvidence?.sceneId && onNavigateToScene ? (
                          <button
                            className="inline-flex items-center gap-1 rounded-sm border border-border bg-transparent px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-1 cursor-pointer"
                            type="button"
                            onClick={() => onNavigateToScene(sceneEvidence.sceneId!)}
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
