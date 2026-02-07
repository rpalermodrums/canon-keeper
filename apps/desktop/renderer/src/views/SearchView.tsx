import type { JSX } from "react";
import { Search } from "lucide-react";
import type { AskResponse, SearchQueryResponse } from "../api/ipc";
import { EmptyState } from "../components/EmptyState";
import { Spinner } from "../components/Spinner";

type SearchViewProps = {
  busy: boolean;
  searchQuery: string;
  searchResults: SearchQueryResponse | null;
  questionText: string;
  askResult: AskResponse | null;
  onSearchQueryChange: (value: string) => void;
  onQuestionTextChange: (value: string) => void;
  onSearch: () => void;
  onAsk: () => void;
};

export function SearchView({
  busy,
  searchQuery,
  searchResults,
  questionText,
  askResult,
  onSearchQueryChange,
  onQuestionTextChange,
  onSearch,
  onAsk
}: SearchViewProps): JSX.Element {
  return (
    <section className="flex flex-col gap-4">
      <header>
        <h2 className="m-0 font-display text-2xl font-bold">Search Your Manuscript</h2>
        <p className="mt-1 text-sm text-text-muted">
          Find passages and ask questions about your story.
        </p>
      </header>

      {/* Search */}
      <article className="flex flex-col gap-3 rounded-md border border-border bg-white/75 p-4 shadow-sm dark:bg-surface-2/60">
        <h3 className="m-0 text-sm font-semibold">Search Your Manuscript</h3>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-text-muted" />
            <input
              className="w-full pl-9"
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && searchQuery.trim()) onSearch(); }}
              placeholder="Mira workshop"
            />
          </div>
          <button
            className="rounded-sm border border-accent bg-accent px-4 py-2 text-sm font-medium text-text-inverse transition-colors hover:bg-accent-strong cursor-pointer disabled:opacity-50"
            type="button"
            onClick={onSearch}
            disabled={busy || !searchQuery.trim()}
          >
            {busy ? <Spinner size="sm" /> : "Search"}
          </button>
        </div>

        {searchResults ? (
          searchResults.results.length > 0 ? (
            <div className="flex flex-col gap-2">
              {searchResults.results.map((result) => (
                <div key={result.chunkId} className="rounded-sm border border-border bg-surface-2/50 p-3 dark:bg-surface-1/50">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-mono text-xs text-text-muted">{result.documentPath.split("/").pop()}</span>
                    <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
                      Passage {result.ordinal}
                    </span>
                  </div>
                  <div className="mt-2 border-l-3 border-accent pl-3 text-sm italic text-text-secondary">
                    &quot;{result.snippet}&quot;
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={Search} title="No Search Hits" message="Try broader terms or a neighboring scene name." />
          )
        ) : null}
      </article>

      {/* Ask */}
      <article className="flex flex-col gap-3 rounded-md border border-border bg-white/75 p-4 shadow-sm dark:bg-surface-2/60">
        <h3 className="m-0 text-sm font-semibold">Ask About Your Story</h3>
        <div className="flex gap-2">
          <input
            className="flex-1"
            value={questionText}
            onChange={(e) => onQuestionTextChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && questionText.trim()) onAsk(); }}
            placeholder="Where is Mira in chapter one?"
          />
          <button
            className="rounded-sm border border-accent bg-accent px-4 py-2 text-sm font-medium text-text-inverse transition-colors hover:bg-accent-strong cursor-pointer disabled:opacity-50"
            type="button"
            onClick={onAsk}
            disabled={busy || !questionText.trim()}
          >
            {busy ? <Spinner size="sm" /> : "Ask"}
          </button>
        </div>

        {!askResult ? null : askResult.kind === "answer" ? (
          <div className="rounded-md border border-ok/30 bg-ok-soft/50 p-4">
            <h4 className="m-0 mb-2 text-sm font-semibold text-ok-strong">Answer</h4>
            <p className="m-0 text-sm text-text-primary">{askResult.answer}</p>
            <div className="mt-3 flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted">Confidence</span>
                <div className="h-2 w-24 overflow-hidden rounded-full bg-surface-3">
                  <div
                    className="h-full rounded-full bg-ok transition-all"
                    style={{ width: `${Math.round(askResult.confidence * 100)}%` }}
                  />
                </div>
                <span className="text-xs font-medium">{(askResult.confidence * 100).toFixed(0)}%</span>
              </div>
              <span className="text-xs text-text-muted">{askResult.citations.length} citations</span>
            </div>
          </div>
        ) : askResult.kind === "snippets" ? (
          <div className="rounded-md border border-warn/30 bg-warn-soft/50 p-4">
            <h4 className="m-0 mb-2 text-sm font-semibold text-warn-strong">Related Passages</h4>
            <p className="mb-3 text-xs text-text-muted">Here are the most relevant passages from your manuscript.</p>
            <div className="flex flex-col gap-2">
              {askResult.snippets.map((snippet) => (
                <div key={snippet.chunkId} className="rounded-sm border border-border bg-surface-2/50 p-3 dark:bg-surface-1/50">
                  <div className="font-mono text-xs text-text-muted">
                    {snippet.documentPath.split("/").pop()}, Passage {snippet.ordinal}
                  </div>
                  <div className="mt-1 border-l-3 border-accent pl-3 text-sm italic text-text-secondary">
                    &quot;{snippet.snippet}&quot;
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-border bg-surface-1/50 p-4">
            <h4 className="m-0 mb-2 text-sm font-semibold">Not Found</h4>
            <p className="m-0 text-sm text-text-secondary">{askResult.reason}</p>
            <p className="mt-1 text-xs text-text-muted">Try asking with specific entities, locations, or chapter names.</p>
          </div>
        )}
      </article>
    </section>
  );
}
