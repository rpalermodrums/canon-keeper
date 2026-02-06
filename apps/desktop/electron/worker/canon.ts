import type Database from "better-sqlite3";
import { insertClaim, insertClaimEvidence, listEvidenceForClaim, supersedeClaims } from "./storage";

export function confirmClaim(
  db: Database.Database,
  args: { entityId: string; field: string; valueJson: string; sourceClaimId: string }
): string {
  const sourceEvidence = listEvidenceForClaim(db, args.sourceClaimId);
  if (sourceEvidence.length === 0) {
    throw new Error("Cannot confirm claim without evidence-backed source claim");
  }

  const claim = insertClaim(db, {
    entityId: args.entityId,
    field: args.field,
    valueJson: args.valueJson,
    status: "confirmed",
    confidence: 1
  });

  for (const row of sourceEvidence) {
    insertClaimEvidence(db, {
      claimId: claim.id,
      chunkId: row.chunk_id,
      quoteStart: row.quote_start,
      quoteEnd: row.quote_end
    });
  }
  supersedeClaims(db, args.entityId, args.field, claim.id);
  return claim.id;
}
