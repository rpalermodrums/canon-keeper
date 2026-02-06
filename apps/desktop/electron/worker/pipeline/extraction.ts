import type Database from "better-sqlite3";
import extractionSchema from "../../../../../packages/shared/schemas/extraction.schema.json";
import type { EntityType } from "../../../../../packages/shared/types/persisted";
import { findExactSpan, findFuzzySpan } from "../../../../../packages/shared/utils/spans";
import {
  addAlias,
  createEntity,
  deleteEntityIfNoClaims,
  getEntityByAlias,
  getOrCreateEntityByName,
  insertClaim,
  insertClaimEvidence,
  listAliases,
  listEntities,
  listClaimsByField,
  logEvent
} from "../storage";
import { buildExtractionUserPrompt, EXTRACTION_SYSTEM_PROMPT } from "../llm/promptPack";
import { completeJsonWithRetry } from "../llm/validator";
import { CloudProvider, NullProvider, type LLMProvider } from "../llm/provider";
import { loadProjectConfig } from "../config";

export type ExtractionEntity = {
  tempId: string;
  type: EntityType;
  displayName: string;
  aliases: string[];
};

export type ExtractionClaim = {
  entityTempId: string;
  field: string;
  value: unknown;
  confidence: number;
  evidence: Array<{ chunkOrdinal: number; quote: string }>;
};

export type ExtractionResult = {
  schemaVersion: string;
  entities: ExtractionEntity[];
  claims: ExtractionClaim[];
  suggestedMerges: Array<{ a: string; b: string; reason: string; confidence: number }>;
  warnings?: string[];
};

function buildProvider(rootPath: string): LLMProvider {
  const config = loadProjectConfig(rootPath);
  if (!config.llm.enabled || config.llm.provider === "null") {
    return new NullProvider();
  }
  const apiKey = process.env.CANONKEEPER_LLM_API_KEY ?? "";
  const baseUrl = config.llm.baseUrl ?? process.env.CANONKEEPER_LLM_BASE_URL ?? "";
  return new CloudProvider(baseUrl, apiKey);
}

const EYE_COLORS = ["green", "gray", "grey", "blue", "brown", "hazel", "amber", "black"];

function extractEyeColorPhrase(text: string): string | null {
  const lowered = text.toLowerCase();
  for (const color of EYE_COLORS) {
    if (lowered.includes(color)) {
      return color === "grey" ? "gray" : color;
    }
  }
  return text.trim();
}

async function runDeterministicExtraction(
  db: Database.Database,
  args: { projectId: string; chunks: Array<{ id: string; ordinal: number; text: string }> }
): Promise<Set<string>> {
  const touched = new Set<string>();
  let lastName: string | null = null;
  const possessiveRegex = /([A-Z][a-z]+)'s eyes were ([^.\n]+)/g;
  const pronounRegex = /(his|her) eyes were ([^.\n]+)/gi;

  for (const chunk of args.chunks) {
    let match: RegExpExecArray | null = null;
    while ((match = possessiveRegex.exec(chunk.text))) {
      const name = match[1];
      const phrase = match[2] ?? "";
      if (!name || !phrase) continue;
      lastName = name;
      const value = extractEyeColorPhrase(phrase);
      if (!value) continue;
      const quote = match[0];
      const exact = findExactSpan(chunk.text, quote) ?? findFuzzySpan(chunk.text, quote);
      if (!exact) continue;
      const entity = getOrCreateEntityByName(db, { projectId: args.projectId, name });
      const claimValue = JSON.stringify(value);
      const existing = listClaimsByField(db, entity.id, "eye_color");
      if (existing.some((row) => row.value_json === claimValue)) {
        continue;
      }
      const claim = insertClaim(db, {
        entityId: entity.id,
        field: "eye_color",
        valueJson: claimValue,
        status: "inferred",
        confidence: 0.6
      });
      touched.add(entity.id);
      insertClaimEvidence(db, {
        claimId: claim.id,
        chunkId: chunk.id,
        quoteStart: exact.start,
        quoteEnd: exact.end
      });
    }

    possessiveRegex.lastIndex = 0;

    while ((match = pronounRegex.exec(chunk.text))) {
      const phrase = match[2] ?? "";
      if (!phrase || !lastName) continue;
      const value = extractEyeColorPhrase(phrase);
      if (!value) continue;
      const quote = match[0];
      const exact = findExactSpan(chunk.text, quote) ?? findFuzzySpan(chunk.text, quote);
      if (!exact) continue;
      const entity = getOrCreateEntityByName(db, { projectId: args.projectId, name: lastName });
      const claimValue = JSON.stringify(value);
      const existing = listClaimsByField(db, entity.id, "eye_color");
      if (existing.some((row) => row.value_json === claimValue)) {
        continue;
      }
      const claim = insertClaim(db, {
        entityId: entity.id,
        field: "eye_color",
        valueJson: claimValue,
        status: "inferred",
        confidence: 0.5
      });
      touched.add(entity.id);
      insertClaimEvidence(db, {
        claimId: claim.id,
        chunkId: chunk.id,
        quoteStart: exact.start,
        quoteEnd: exact.end
      });
    }
    pronounRegex.lastIndex = 0;
  }
  return touched;
}

export async function runExtraction(
  db: Database.Database,
  args: { projectId: string; rootPath: string; chunks: Array<{ id: string; ordinal: number; text: string }> }
): Promise<{ touchedEntityIds: string[] }> {
  const touched = await runDeterministicExtraction(db, { projectId: args.projectId, chunks: args.chunks });

  const provider = buildProvider(args.rootPath);
  if (!(await provider.isAvailable())) {
    return { touchedEntityIds: Array.from(touched) };
  }

  logEvent(db, {
    projectId: args.projectId,
    level: "info",
    eventType: "llm_call",
    payload: { type: "extraction", chunkCount: args.chunks.length }
  });

  const entities = listEntities(db, args.projectId).map((entity) => ({
    id: entity.id,
    type: entity.type,
    displayName: entity.display_name,
    aliases: listAliases(db, entity.id)
  }));

  const prompt = buildExtractionUserPrompt({
    projectName: loadProjectConfig(args.rootPath).projectName,
    knownEntities: entities,
    chunks: args.chunks.map((chunk) => ({ ordinal: chunk.ordinal, text: chunk.text }))
  });

  const completion = await completeJsonWithRetry<ExtractionResult>(provider, {
    schemaName: "extraction",
    systemPrompt: EXTRACTION_SYSTEM_PROMPT,
    userPrompt: prompt,
    jsonSchema: extractionSchema,
    temperature: 0.1,
    maxTokens: 1200
  });

  const chunkMap = new Map(args.chunks.map((chunk) => [chunk.ordinal, chunk]));
  const entityMap = new Map<string, string>();
  const knownEntityIds = new Set(entities.map((entity) => entity.id));
  const createdEntityIds = new Set<string>();

  for (const extracted of completion.json.entities ?? []) {
    const existing = getEntityByAlias(db, args.projectId, extracted.displayName);
    const entity =
      existing ??
      createEntity(db, {
        projectId: args.projectId,
          type: extracted.type,
          displayName: extracted.displayName
        });
    if (!existing) {
      createdEntityIds.add(entity.id);
    }

    for (const alias of extracted.aliases ?? []) {
      addAlias(db, entity.id, alias);
    }

    entityMap.set(extracted.tempId, entity.id);
    touched.add(entity.id);
  }

  const resolveEntityRef = (ref: string): string | null => {
    const mappedTemp = entityMap.get(ref);
    if (mappedTemp) {
      return mappedTemp;
    }
    if (knownEntityIds.has(ref) || createdEntityIds.has(ref)) {
      return ref;
    }
    return null;
  };

  const merges = [...(completion.json.suggestedMerges ?? [])].sort((a, b) => {
    if (b.confidence !== a.confidence) {
      return b.confidence - a.confidence;
    }
    return `${a.a}:${a.b}`.localeCompare(`${b.a}:${b.b}`);
  });

  for (const merge of merges) {
    if (merge.confidence < 0.75) {
      continue;
    }
    const entityA = resolveEntityRef(merge.a);
    const entityB = resolveEntityRef(merge.b);
    if (!entityA || !entityB || entityA === entityB) {
      continue;
    }

    const aKnown = knownEntityIds.has(entityA);
    const bKnown = knownEntityIds.has(entityB);
    let target = entityA;
    let source = entityB;
    if (!aKnown && bKnown) {
      target = entityB;
      source = entityA;
    } else if (aKnown === bKnown && entityB < entityA) {
      target = entityB;
      source = entityA;
    }

    for (const alias of listAliases(db, source)) {
      addAlias(db, target, alias);
    }

    for (const [tempId, mappedEntityId] of entityMap.entries()) {
      if (mappedEntityId === source) {
        entityMap.set(tempId, target);
      }
    }

    if (createdEntityIds.has(source)) {
      deleteEntityIfNoClaims(db, source);
      createdEntityIds.delete(source);
    }

    touched.delete(source);
    touched.add(target);
  }

  for (const claim of completion.json.claims ?? []) {
    const entityId = entityMap.get(claim.entityTempId);
    if (!entityId) {
      continue;
    }

    const valueJson = JSON.stringify(claim.value);
    const existing = listClaimsByField(db, entityId, claim.field);
    if (existing.some((row) => row.value_json === valueJson)) {
      continue;
    }
    const existingConfirmed = existing.filter((row) => row.status === "confirmed");
    const conflictsConfirmed = existingConfirmed.some((row) => row.value_json !== valueJson);
    const mappedEvidence: Array<{ chunkId: string; quoteStart: number; quoteEnd: number }> = [];
    for (const evidence of claim.evidence ?? []) {
      const chunk = chunkMap.get(evidence.chunkOrdinal);
      if (!chunk) {
        continue;
      }
      const exact = findExactSpan(chunk.text, evidence.quote);
      const span = exact ?? findFuzzySpan(chunk.text, evidence.quote);
      if (!span) {
        continue;
      }
      mappedEvidence.push({ chunkId: chunk.id, quoteStart: span.start, quoteEnd: span.end });
    }

    if (mappedEvidence.length === 0) {
      continue;
    }

    const created = insertClaim(db, {
      entityId,
      field: claim.field,
      valueJson,
      status: "inferred",
      confidence: claim.confidence
    });
    touched.add(entityId);

    for (const evidence of mappedEvidence) {
      insertClaimEvidence(db, {
        claimId: created.id,
        chunkId: evidence.chunkId,
        quoteStart: evidence.quoteStart,
        quoteEnd: evidence.quoteEnd
      });
    }

    if (conflictsConfirmed) {
      continue;
    }
  }
  return { touchedEntityIds: Array.from(touched) };
}
