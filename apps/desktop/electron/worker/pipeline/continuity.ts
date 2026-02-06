import type Database from "better-sqlite3";
import {
  clearIssuesByType,
  deleteIssuesByTypeAndChunkIds,
  insertIssue,
  insertIssueEvidence,
  listEntities,
  listClaimsForEntity,
  listEvidenceForClaim
} from "../storage";

function normalizeValue(valueJson: string): string {
  try {
    const value = JSON.parse(valueJson);
    if (typeof value === "string") return value.toLowerCase();
    if (typeof value === "number") return value.toString();
    return JSON.stringify(value);
  } catch {
    return valueJson;
  }
}

function listEvidenceChunkIds(db: Database.Database, entityIds: string[]): string[] {
  if (entityIds.length === 0) {
    return [];
  }
  const placeholders = entityIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT DISTINCT ce.chunk_id as chunk_id
       FROM claim_evidence ce
       JOIN claim c ON c.id = ce.claim_id
       WHERE c.entity_id IN (${placeholders})`
    )
    .all(...entityIds) as Array<{ chunk_id: string }>;
  return rows.map((row) => row.chunk_id);
}

export function runContinuityChecks(
  db: Database.Database,
  projectId: string,
  options?: { entityIds?: string[] }
): void {
  const entityIds = options?.entityIds ?? [];
  if (entityIds.length > 0) {
    const chunkIds = listEvidenceChunkIds(db, entityIds);
    deleteIssuesByTypeAndChunkIds(db, projectId, "continuity", chunkIds);
  } else {
    clearIssuesByType(db, projectId, "continuity");
  }

  const entities = entityIds.length > 0 ? listEntities(db, projectId).filter((entity) => entityIds.includes(entity.id)) : listEntities(db, projectId);
  for (const entity of entities) {
    const claims = listClaimsForEntity(db, entity.id).filter((claim) =>
      ["inferred", "confirmed"].includes(claim.status)
    );

    const byField = new Map<string, typeof claims>();
    for (const claim of claims) {
      const list = byField.get(claim.field) ?? [];
      list.push(claim);
      byField.set(claim.field, list);
    }

    for (const [field, fieldClaims] of byField.entries()) {
      const evidenceClaims = fieldClaims.filter(
        (claim) => listEvidenceForClaim(db, claim.id).length > 0
      );
      if (evidenceClaims.length < 2) {
        continue;
      }
      const distinctValues = new Map<string, typeof evidenceClaims[number]>();
      for (const claim of evidenceClaims) {
        distinctValues.set(normalizeValue(claim.value_json), claim);
      }
      if (distinctValues.size < 2) {
        continue;
      }

      const claimsArray = Array.from(distinctValues.values());
      const confirmed = claimsArray.find((claim) => claim.status === "confirmed");
      const inferred = claimsArray.find((claim) => claim.status !== "confirmed");
      const claimValues = claimsArray
        .slice(0, 2)
        .map((claim) => {
          try {
            const parsed = JSON.parse(claim.value_json);
            if (typeof parsed === "string" || typeof parsed === "number") {
              return String(parsed);
            }
            return JSON.stringify(parsed);
          } catch {
            return claim.value_json;
          }
        })
        .filter(Boolean);
      const fromValue = claimValues[0] ?? "one value";
      const toValue = claimValues[1] ?? "another value";

      const issue = insertIssue(db, {
        projectId,
        type: "continuity",
        severity: confirmed && inferred ? "high" : "medium",
        title:
          confirmed && inferred
            ? `Did ${entity.display_name}'s ${field} change from ${fromValue} to ${toValue}?`
            : `Did ${entity.display_name}'s ${field} change from ${fromValue} to ${toValue}?`,
        description:
          confirmed && inferred
            ? `Confirmed canon and draft evidence disagree for ${entity.display_name} (${field}). Please choose which value is canonical.`
            : `Conflicting evidence-backed values were found for ${entity.display_name} (${field}). Please resolve which one is canonical.`
      });

      for (const claim of claimsArray.slice(0, 2)) {
        const evidence = listEvidenceForClaim(db, claim.id)[0];
        if (!evidence) continue;
        insertIssueEvidence(db, {
          issueId: issue.id,
          chunkId: evidence.chunk_id,
          quoteStart: evidence.quote_start,
          quoteEnd: evidence.quote_end
        });
      }
    }
  }
}
