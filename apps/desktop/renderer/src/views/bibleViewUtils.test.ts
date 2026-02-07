import { describe, expect, it, vi } from "vitest";
import type { EntityDetail, EntitySummary } from "../api/ipc";
import {
  filterEntities,
  formatClaimValue,
  groupClaimsByField,
  listEntityTypes,
  matchesEntityFilters,
  toClaimRenderData,
  type EntityFilters
} from "./bibleViewUtils";

function createEntity(overrides: Partial<EntitySummary>): EntitySummary {
  return {
    id: "entity-1",
    project_id: "project-1",
    type: "character",
    display_name: "Mara",
    canonical_name: "Mara",
    created_at: 1,
    updated_at: 1,
    ...overrides
  };
}

function createEntityDetail(
  entity: EntitySummary,
  claimOverrides: Array<Partial<EntityDetail["claims"][number]["claim"]>>
): EntityDetail {
  return {
    entity,
    claims: claimOverrides.map((claimOverride, index) => ({
      claim: {
        id: `claim-${index + 1}`,
        entity_id: entity.id,
        field: "role",
        value_json: JSON.stringify("pilot"),
        status: "inferred",
        confidence: 0.8,
        created_at: index,
        updated_at: index,
        supersedes_claim_id: null,
        ...claimOverride
      },
      value: "pilot",
      evidence: [
        {
          chunkId: `chunk-${index + 1}`,
          documentPath: "/project/ch1.md",
          chunkOrdinal: index + 1,
          quoteStart: 0,
          quoteEnd: 5,
          excerpt: "pilot",
          lineStart: 1,
          lineEnd: 1
        }
      ]
    }))
  };
}

const BASE_FILTERS: EntityFilters = {
  type: "",
  status: "all",
  query: ""
};

describe("listEntityTypes", () => {
  it("returns unique sorted types", () => {
    const entities = [
      createEntity({ type: "location" }),
      createEntity({ id: "2", type: "character" }),
      createEntity({ id: "3", type: "location" }),
      createEntity({ id: "4", type: "artifact" })
    ];

    expect(listEntityTypes(entities)).toEqual(["artifact", "character", "location"]);
  });
});

describe("formatClaimValue", () => {
  it("formats scalar and composite JSON values", () => {
    expect(formatClaimValue(JSON.stringify("Captain"))).toBe("Captain");
    expect(formatClaimValue(JSON.stringify(7))).toBe("7");
    expect(formatClaimValue(JSON.stringify(true))).toBe("true");
    expect(formatClaimValue(JSON.stringify(["red", "blue"]))).toBe("red, blue");
    expect(formatClaimValue(JSON.stringify({ age: 30, title: "Captain" }))).toBe("age: 30, title: Captain");
  });

  it("returns raw value when input is not valid JSON", () => {
    expect(formatClaimValue("{bad json")).toBe("{bad json");
  });
});

describe("groupClaimsByField", () => {
  it("groups claims by field while preserving original order per field", () => {
    const entity = createEntity({ id: "entity-2" });
    const detail = createEntityDetail(entity, [
      { id: "claim-a", field: "role", value_json: JSON.stringify("captain") },
      { id: "claim-b", field: "home", value_json: JSON.stringify("Mars") },
      { id: "claim-c", field: "role", value_json: JSON.stringify("pilot") }
    ]);

    const grouped = groupClaimsByField(detail);

    expect(grouped.map((group) => group.field)).toEqual(["role", "home"]);
    expect(grouped[0]?.claims.map((claim) => claim.claim.id)).toEqual(["claim-a", "claim-c"]);
    expect(groupClaimsByField(null)).toEqual([]);
  });
});

describe("entity filtering", () => {
  it("filters by type and query", () => {
    const entities = [
      createEntity({ id: "a", type: "character", display_name: "Mara" }),
      createEntity({ id: "b", type: "location", display_name: "Aria Station" }),
      createEntity({ id: "c", type: "character", display_name: "Oren" })
    ];

    const runFilter = vi.fn(filterEntities);
    const filteredByType = runFilter(entities, { ...BASE_FILTERS, type: "character" }, null);
    const filteredByQuery = filterEntities(entities, { ...BASE_FILTERS, query: "  aria " }, null);

    expect(runFilter).toHaveBeenCalledTimes(1);
    expect(filteredByType.map((entity) => entity.id)).toEqual(["a", "c"]);
    expect(filteredByQuery.map((entity) => entity.id)).toEqual(["b"]);
  });

  it("applies confirmed status filter only to the selected entity detail", () => {
    const selectedEntity = createEntity({ id: "selected", display_name: "Mara" });
    const otherEntity = createEntity({ id: "other", display_name: "Aria Station", type: "location" });
    const entities = [selectedEntity, otherEntity];

    const detail = createEntityDetail(selectedEntity, [{ status: "confirmed" }]);
    const filters: EntityFilters = { ...BASE_FILTERS, status: "confirmed" };

    expect(matchesEntityFilters(selectedEntity, filters, detail)).toBe(true);
    expect(filterEntities(entities, filters, detail).map((entity) => entity.id)).toEqual([
      "selected",
      "other"
    ]);
  });

  it("excludes selected entity under inferred-only filter when it has confirmed claims", () => {
    const selectedEntity = createEntity({ id: "selected" });
    const otherEntity = createEntity({ id: "other", display_name: "Oren" });
    const entities = [selectedEntity, otherEntity];

    const detail = createEntityDetail(selectedEntity, [{ status: "confirmed" }]);
    const filters: EntityFilters = { ...BASE_FILTERS, status: "inferred" };

    expect(filterEntities(entities, filters, detail).map((entity) => entity.id)).toEqual(["other"]);
  });
});

describe("toClaimRenderData", () => {
  it("returns claim rendering metadata and confirmability", () => {
    const entity = createEntity({ id: "entity-claim" });
    const detail = createEntityDetail(entity, [
      { id: "inferred-claim", status: "inferred", field: "alias", value_json: JSON.stringify("Ghost") },
      { id: "confirmed-claim", status: "confirmed", field: "role", value_json: JSON.stringify("Captain") }
    ]);

    const inferred = toClaimRenderData(detail.claims[0]!);
    const confirmed = toClaimRenderData(detail.claims[1]!);

    expect(inferred).toMatchObject({
      claimId: "inferred-claim",
      field: "alias",
      valueLabel: "Ghost",
      evidenceCount: 1,
      canConfirm: true
    });
    expect(confirmed.canConfirm).toBe(false);
  });
});
