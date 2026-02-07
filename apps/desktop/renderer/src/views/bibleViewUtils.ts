import type { EntityDetail, EntitySummary } from "../api/ipc";

export type EntityFilters = {
  type: string;
  status: "all" | "confirmed" | "inferred";
  query: string;
};

export type ClaimGroup = {
  field: string;
  claims: EntityDetail["claims"];
};

export type ClaimRenderData = {
  claimId: string;
  field: string;
  valueLabel: string;
  status: string;
  evidenceCount: number;
  canConfirm: boolean;
};

export function listEntityTypes(entities: readonly EntitySummary[]): string[] {
  return Array.from(new Set(entities.map((entity) => entity.type))).sort((a, b) => a.localeCompare(b));
}

export function formatClaimValue(valueJson: string): string {
  try {
    const parsed = JSON.parse(valueJson);
    if (typeof parsed === "string") return parsed;
    if (typeof parsed === "number" || typeof parsed === "boolean") return String(parsed);
    if (Array.isArray(parsed)) return parsed.join(", ");
    if (typeof parsed === "object" && parsed !== null) {
      return Object.entries(parsed)
        .map(([key, value]) => `${key}: ${value}`)
        .join(", ");
    }
    return valueJson;
  } catch {
    return valueJson;
  }
}

export function groupClaimsByField(detail: EntityDetail | null): ClaimGroup[] {
  if (!detail) return [];

  const claimsByField = new Map<string, EntityDetail["claims"]>();
  for (const claim of detail.claims) {
    const fieldClaims = claimsByField.get(claim.claim.field) ?? [];
    fieldClaims.push(claim);
    claimsByField.set(claim.claim.field, fieldClaims);
  }

  return Array.from(claimsByField.entries()).map(([field, claims]) => ({ field, claims }));
}

function matchesStatusFilter(
  entity: EntitySummary,
  statusFilter: EntityFilters["status"],
  entityDetail: EntityDetail | null
): boolean {
  if (statusFilter === "all") return true;
  if (!entityDetail || entity.id !== entityDetail.entity.id) return true;

  const hasConfirmedClaim = entityDetail.claims.some((claim) => claim.claim.status === "confirmed");
  return statusFilter === "confirmed" ? hasConfirmedClaim : !hasConfirmedClaim;
}

export function matchesEntityFilters(
  entity: EntitySummary,
  filters: EntityFilters,
  entityDetail: EntityDetail | null
): boolean {
  const typeMatch = !filters.type || entity.type === filters.type;
  const normalizedQuery = filters.query.trim().toLowerCase();
  const queryMatch =
    normalizedQuery.length === 0 || entity.display_name.toLowerCase().includes(normalizedQuery);

  if (!typeMatch || !queryMatch) return false;
  return matchesStatusFilter(entity, filters.status, entityDetail);
}

export function filterEntities(
  entities: readonly EntitySummary[],
  filters: EntityFilters,
  entityDetail: EntityDetail | null
): EntitySummary[] {
  return entities.filter((entity) => matchesEntityFilters(entity, filters, entityDetail));
}

export function toClaimRenderData(claim: EntityDetail["claims"][number]): ClaimRenderData {
  const evidenceCount = claim.evidence.length;
  const status = claim.claim.status;

  return {
    claimId: claim.claim.id,
    field: claim.claim.field,
    valueLabel: formatClaimValue(claim.claim.value_json),
    status,
    evidenceCount,
    canConfirm: status !== "confirmed" && evidenceCount > 0
  };
}
