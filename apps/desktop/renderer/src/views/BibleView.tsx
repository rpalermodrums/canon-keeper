import { useMemo, type JSX } from "react";
import { BookMarked, CheckCircle, Quote, RefreshCw, Search } from "lucide-react";
import type { EntityDetail, EntitySummary } from "../api/ipc";
import { EmptyState } from "../components/EmptyState";
import { FilterBar, FilterGroup } from "../components/FilterBar";
import { StatusBadge } from "../components/StatusBadge";
import { TogglePill } from "../components/TogglePill";

type EntityFilters = {
  type: string;
  status: "all" | "confirmed" | "inferred";
  query: string;
};

type BibleViewProps = {
  busy: boolean;
  entities: EntitySummary[];
  selectedEntityId: string;
  entityDetail: EntityDetail | null;
  filters: EntityFilters;
  onFiltersChange: (next: EntityFilters) => void;
  onRefresh: () => void;
  onSelectEntity: (entityId: string) => void;
  onOpenEvidence: (
    title: string,
    detail: { evidence: EntityDetail["claims"][number]["evidence"] },
    context: { sourceId: string }
  ) => void;
  onRequestConfirmClaim: (claim: {
    field: string;
    valueJson: string;
    sourceClaimId: string;
    evidenceCount: number;
  }) => void;
};

const entityTypeColors: Record<string, string> = {
  character: "bg-accent-soft text-accent",
  location: "bg-warn-soft text-warn",
  object: "bg-ok-soft text-ok",
  faction: "bg-danger-soft text-danger"
};

const claimStatusOptions = [
  { value: "all" as const, label: "All" },
  { value: "confirmed" as const, label: "Confirmed" },
  { value: "inferred" as const, label: "Detected" }
];

const formatClaimValue = (valueJson: string): string => {
  try {
    const parsed = JSON.parse(valueJson);
    if (typeof parsed === "string") return parsed;
    if (typeof parsed === "number" || typeof parsed === "boolean") return String(parsed);
    if (Array.isArray(parsed)) return parsed.join(", ");
    if (typeof parsed === "object" && parsed !== null) {
      return Object.entries(parsed).map(([k, v]) => `${k}: ${v}`).join(", ");
    }
    return valueJson;
  } catch {
    return valueJson;
  }
};

function groupByField(detail: EntityDetail | null): Array<{
  field: string;
  claims: EntityDetail["claims"];
}> {
  if (!detail) return [];
  const map = new Map<string, EntityDetail["claims"]>();
  for (const claim of detail.claims) {
    const group = map.get(claim.claim.field) ?? [];
    group.push(claim);
    map.set(claim.claim.field, group);
  }
  return Array.from(map.entries()).map(([field, claims]) => ({ field, claims }));
}

export function BibleView({
  busy,
  entities,
  selectedEntityId,
  entityDetail,
  filters,
  onFiltersChange,
  onRefresh,
  onSelectEntity,
  onOpenEvidence,
  onRequestConfirmClaim
}: BibleViewProps): JSX.Element {
  const types = Array.from(new Set(entities.map((e) => e.type))).sort();
  const filtered = entities.filter((entity) => {
    const typeMatch = !filters.type || entity.type === filters.type;
    const q = filters.query.trim().toLowerCase();
    const queryMatch = q.length === 0 || entity.display_name.toLowerCase().includes(q);
    if (!typeMatch || !queryMatch) return false;
    if (filters.status === "all" || !entityDetail || entity.id !== entityDetail.entity.id) return true;
    const hasConfirmed = entityDetail.claims.some((c) => c.claim.status === "confirmed");
    return filters.status === "confirmed" ? hasConfirmed : !hasConfirmed;
  });

  const groupedClaims = useMemo(() => groupByField(entityDetail), [entityDetail]);

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="m-0 font-display text-2xl font-bold">Characters &amp; World</h2>
          <p className="mt-1 text-sm text-text-muted">
            Everything CanonKeeper knows about the people, places, and things in your story.
          </p>
        </div>
        <button
          className="inline-flex items-center gap-1.5 rounded-sm border border-accent bg-accent px-4 py-2 text-sm font-medium text-text-inverse transition-colors hover:bg-accent-strong cursor-pointer disabled:opacity-50"
          type="button"
          onClick={onRefresh}
          disabled={busy}
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </header>

      <FilterBar resultCount={filtered.length}>
        <FilterGroup label="Type">
          <select value={filters.type} onChange={(e) => onFiltersChange({ ...filters, type: e.target.value })}>
            <option value="">All</option>
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </FilterGroup>
        <TogglePill
          label="Status"
          options={claimStatusOptions}
          value={filters.status}
          onChange={(v) => onFiltersChange({ ...filters, status: v })}
        />
        <FilterGroup label="Query">
          <div className="relative">
            <Search size={14} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-text-muted" />
            <input
              className="w-full pl-8"
              value={filters.query}
              onChange={(e) => onFiltersChange({ ...filters, query: e.target.value })}
              placeholder="Search characters & places"
            />
          </div>
        </FilterGroup>
      </FilterBar>

      {filtered.length === 0 ? (
        <EmptyState icon={BookMarked} title="Nothing Found" message="No characters or locations found yet. Add a manuscript and CanonKeeper will discover them." />
      ) : (
        <div className="grid min-h-[420px] grid-cols-1 gap-4 lg:grid-cols-[minmax(320px,1fr)_minmax(340px,1fr)]">
          {/* Entity list */}
          <article className="flex flex-col gap-2 rounded-md border border-border bg-white/75 p-3 shadow-sm dark:bg-surface-2/60">
            <h3 className="m-0 mb-1 text-sm font-semibold">Characters &amp; Places</h3>
            <div className="flex flex-col gap-1 overflow-y-auto">
              {filtered.map((entity) => {
                const selected = selectedEntityId === entity.id;
                const typeColor = entityTypeColors[entity.type] ?? "bg-surface-1 text-text-muted";
                return (
                  <button
                    key={entity.id}
                    type="button"
                    className={`flex items-center justify-between gap-2 rounded-sm border px-3 py-2 text-left transition-all cursor-pointer ${
                      selected
                        ? "border-accent bg-accent-soft/40 border-l-3 border-l-accent"
                        : "border-border bg-transparent hover:bg-surface-1/50"
                    }`}
                    onClick={() => onSelectEntity(entity.id)}
                  >
                    <strong className="text-sm">{entity.display_name}</strong>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${typeColor}`}>
                      {entity.type}
                    </span>
                  </button>
                );
              })}
            </div>
          </article>

          {/* Claims detail */}
          <article className="flex flex-col gap-3 rounded-md border border-border bg-white/75 p-4 shadow-sm dark:bg-surface-2/60">
            {!entityDetail ? (
              <EmptyState icon={BookMarked} title="No Entry Selected" message="Select a character or location to see what CanonKeeper knows about them." />
            ) : groupedClaims.length === 0 ? (
              <EmptyState icon={BookMarked} title="No Details" message="No details found for this entry yet." />
            ) : (
              <>
                <h3 className="m-0 font-display text-lg font-bold">{entityDetail.entity.display_name}</h3>
                {groupedClaims.map((group) => (
                  <details key={group.field} className="rounded-sm border border-border" open>
                    <summary className="cursor-pointer bg-surface-1/30 px-3 py-2 text-sm font-semibold dark:bg-surface-1/20">
                      {group.field}
                    </summary>
                    <div className="flex flex-col gap-2 p-3">
                      {group.claims.map((claim) => (
                        <div key={claim.claim.id} className="rounded-sm border border-border bg-surface-2/50 p-3 dark:bg-surface-1/30">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm">{formatClaimValue(claim.claim.value_json)}</span>
                            <StatusBadge
                              label={claim.claim.status}
                              status={claim.claim.status}
                              icon={claim.claim.status === "confirmed" ? CheckCircle : undefined}
                            />
                          </div>
                          <div className="mt-2 flex items-center gap-2">
                            <button
                              className="inline-flex items-center gap-1 rounded-sm border border-border bg-transparent px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-1 cursor-pointer disabled:opacity-50"
                              type="button"
                              onClick={() =>
                                onOpenEvidence(`${group.field}`, claim, { sourceId: claim.claim.id })
                              }
                              disabled={claim.evidence.length === 0}
                            >
                              <Quote size={12} />
                              Evidence ({claim.evidence.length})
                            </button>
                            {claim.claim.status !== "confirmed" ? (
                              <button
                                className="inline-flex items-center gap-1 rounded-sm border border-accent/40 bg-transparent px-2 py-1 text-xs text-accent transition-colors hover:bg-accent-soft cursor-pointer disabled:opacity-50"
                                type="button"
                                onClick={() =>
                                  onRequestConfirmClaim({
                                    field: claim.claim.field,
                                    valueJson: claim.claim.value_json,
                                    sourceClaimId: claim.claim.id,
                                    evidenceCount: claim.evidence.length
                                  })
                                }
                                disabled={claim.evidence.length === 0}
                              >
                                <CheckCircle size={12} />
                                Confirm
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                ))}
              </>
            )}
          </article>
        </div>
      )}
    </section>
  );
}

export type { EntityFilters };
