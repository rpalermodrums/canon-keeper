import type Database from "better-sqlite3";
import { getEntityById, listClaimsForEntity, listEvidenceForClaim } from "./storage";
import { createEvidenceMapper } from "./utils/evidence";

export type EntityDetail = {
  entity: ReturnType<typeof getEntityById>;
  claims: Array<{
    claim: ReturnType<typeof listClaimsForEntity>[number];
    value: unknown;
    evidence: Array<{
      chunkId: string;
      documentPath: string | null;
      chunkOrdinal: number | null;
      quoteStart: number;
      quoteEnd: number;
      excerpt: string;
      lineStart: number | null;
      lineEnd: number | null;
    }>;
  }>;
};

export function getEntityDetail(db: Database.Database, entityId: string): EntityDetail | null {
  const entity = getEntityById(db, entityId);
  if (!entity) return null;
  const mapEvidence = createEvidenceMapper(db);

  const claims = listClaimsForEntity(db, entityId)
    .map((claim) => {
      const evidenceRows = listEvidenceForClaim(db, claim.id);
      const evidence = evidenceRows.map((row) => mapEvidence(row));

      if (evidence.length === 0 && claim.status !== "confirmed") {
        return null;
      }

      return {
        claim,
        value: JSON.parse(claim.value_json),
        evidence
      };
    })
    .filter((claim): claim is NonNullable<typeof claim> => Boolean(claim));

  return { entity, claims };
}
