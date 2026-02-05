import type Database from "better-sqlite3";
import sceneSchema from "../../../../../packages/shared/schemas/scene_extract.schema.json";
import type { ChunkRecord } from "../storage/chunkRepo";
import type { SceneSummary } from "../storage/sceneRepo";
import { normalizeAlias } from "../../../../../packages/shared/utils/normalize";
import { findExactSpan, findFuzzySpan } from "../../../../../packages/shared/utils/spans";
import { buildSceneMetaUserPrompt, SCENE_META_SYSTEM_PROMPT } from "../llm/promptPack";
import { CloudProvider, NullProvider, type LLMProvider } from "../llm/provider";
import { completeJsonWithRetry } from "../llm/validator";
import { loadProjectConfig } from "../config";
import {
  deleteSceneEvidenceForScene,
  insertSceneEvidence,
  listAliases,
  listChunksForDocument,
  listEntities,
  listScenesForProject,
  logEvent,
  replaceSceneEntities,
  updateSceneMetadata
} from "../storage";

const FIRST_PERSON = /\b(I|me|my|mine|we|our|us)\b/;
const SETTING_PHRASE = /\b(in|at|inside|within|outside|on)\s+(the\s+)?([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,6})/i;

const SENTENCE_BREAK = /[.!?\n]/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findSentenceSpan(text: string, index: number): { start: number; end: number } | null {
  if (index < 0 || index >= text.length) return null;
  let start = -1;
  for (let i = index; i >= 0; i -= 1) {
    if (SENTENCE_BREAK.test(text[i]!)) {
      start = i;
      break;
    }
  }
  let end = text.length;
  for (let i = index; i < text.length; i += 1) {
    if (SENTENCE_BREAK.test(text[i]!)) {
      end = i + 1;
      break;
    }
  }
  const trimmedStart = text.slice(start + 1, end).search(/\S/);
  if (trimmedStart < 0) return null;
  const actualStart = start + 1 + trimmedStart;
  let actualEnd = end;
  while (actualEnd > actualStart && /\s/.test(text[actualEnd - 1]!)) {
    actualEnd -= 1;
  }
  if (actualEnd <= actualStart) return null;
  return { start: actualStart, end: actualEnd };
}

function findFirstPersonEvidence(chunks: ChunkRecord[]):
  | { chunkId: string; quoteStart: number; quoteEnd: number }
  | null {
  for (const chunk of chunks) {
    const match = FIRST_PERSON.exec(chunk.text);
    if (!match || match.index === undefined) {
      continue;
    }
    const span = findSentenceSpan(chunk.text, match.index);
    if (!span) {
      continue;
    }
    return { chunkId: chunk.id, quoteStart: span.start, quoteEnd: span.end };
  }
  return null;
}

function findAliasEvidence(
  chunks: ChunkRecord[],
  alias: string
): { chunkId: string; quoteStart: number; quoteEnd: number } | null {
  const pattern = new RegExp(`\\b${escapeRegExp(alias)}\\b`, "i");
  for (const chunk of chunks) {
    const match = pattern.exec(chunk.text);
    if (!match || match.index === undefined) continue;
    return {
      chunkId: chunk.id,
      quoteStart: match.index,
      quoteEnd: match.index + match[0].length
    };
  }
  return null;
}

function countAliasOccurrences(chunks: ChunkRecord[], alias: string): number {
  const pattern = new RegExp(`\\b${escapeRegExp(alias)}\\b`, "gi");
  let count = 0;
  for (const chunk of chunks) {
    const matches = chunk.text.match(pattern);
    if (matches) {
      count += matches.length;
    }
  }
  return count;
}

function findSettingPhraseEvidence(
  chunks: ChunkRecord[]
): { chunkId: string; quoteStart: number; quoteEnd: number; phrase: string } | null {
  for (const chunk of chunks) {
    const match = SETTING_PHRASE.exec(chunk.text);
    if (!match || match.index === undefined) continue;
    const raw = match[0].trim();
    const phrase = raw.replace(/[\s.,;:!?]+$/, "");
    const start = match.index;
    const end = start + phrase.length;
    if (end <= start) continue;
    return {
      chunkId: chunk.id,
      quoteStart: start,
      quoteEnd: end,
      phrase
    };
  }
  return null;
}

function sceneChunksFor(scene: SceneSummary, chunks: ChunkRecord[]): ChunkRecord[] {
  const ordinalById = new Map(chunks.map((chunk) => [chunk.id, chunk.ordinal]));
  const startOrdinal = ordinalById.get(scene.start_chunk_id);
  const endOrdinal = ordinalById.get(scene.end_chunk_id);
  if (startOrdinal === undefined || endOrdinal === undefined) return [];
  return chunks.filter((chunk) => chunk.ordinal >= startOrdinal && chunk.ordinal <= endOrdinal);
}

type SceneMetaOutput = {
  schemaVersion: string;
  povMode: "first" | "third_limited" | "omniscient" | "epistolary" | "unknown";
  povName: string | null;
  povConfidence: number;
  settingName: string | null;
  settingText: string | null;
  settingConfidence: number;
  timeContextText: string | null;
  evidence: Array<{ chunkOrdinal: number; quote: string }>;
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

function buildAliasMap(
  entities: Array<{ id: string; display_name: string }>,
  aliasLookup: (id: string) => string[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const entity of entities) {
    const aliases = [entity.display_name, ...aliasLookup(entity.id)];
    for (const alias of aliases) {
      map.set(normalizeAlias(alias), entity.id);
    }
  }
  return map;
}

export async function runSceneMetadata(
  db: Database.Database,
  projectId: string,
  documentId: string,
  rootPath: string
): Promise<void> {
  const scenes = listScenesForProject(db, projectId).filter((scene) => scene.document_id === documentId);
  const chunks = listChunksForDocument(db, documentId);

  const entities = listEntities(db, projectId);
  const characterEntities = entities.filter((entity) => entity.type === "character");
  const locationEntities = entities.filter((entity) => entity.type === "location");
  const characterMap = buildAliasMap(characterEntities, (id) => listAliases(db, id));
  const locationMap = buildAliasMap(locationEntities, (id) => listAliases(db, id));

  const provider = buildProvider(rootPath);
  const providerAvailable = await provider.isAvailable();

  for (const scene of scenes) {
    const scopedChunks = sceneChunksFor(scene, chunks);
    deleteSceneEvidenceForScene(db, scene.id);

    let povMode: "first" | "third_limited" | "omniscient" | "epistolary" | "unknown" = "unknown";
    const povEntityId: string | null = null;
    let povConfidence = 0;
    let settingEntityId: string | null = null;
    let settingText: string | null = null;
    let settingConfidence = 0;
    const timeContextText: string | null = null;

    const evidence: Array<{ chunkId: string; quoteStart: number; quoteEnd: number }> = [];

    const povEvidence = findFirstPersonEvidence(scopedChunks);
    if (povEvidence) {
      povMode = "first";
      povConfidence = 0.7;
      evidence.push(povEvidence);
    }

    let matchedLocation = false;
    for (const location of locationEntities) {
      const aliases = [location.display_name, ...listAliases(db, location.id)];
      for (const alias of aliases) {
        const locEvidence = findAliasEvidence(scopedChunks, alias);
        if (!locEvidence) continue;
        settingEntityId = location.id;
        settingText = alias;
        settingConfidence = 0.7;
        evidence.push(locEvidence);
        matchedLocation = true;
        break;
      }
      if (matchedLocation) break;
    }

    if (!matchedLocation) {
      const settingEvidence = findSettingPhraseEvidence(scopedChunks);
      if (settingEvidence) {
        settingEntityId = null;
        settingText = settingEvidence.phrase.slice(0, 160);
        settingConfidence = 0.5;
        evidence.push({
          chunkId: settingEvidence.chunkId,
          quoteStart: settingEvidence.quoteStart,
          quoteEnd: settingEvidence.quoteEnd
        });
      }
    }

    const sceneEntities: Array<{ entityId: string; role: "mentioned" | "setting" | "present"; confidence: number }> = [];
    const sceneEntityIds = new Set<string>();
    for (const character of characterEntities) {
      const aliases = [character.display_name, ...listAliases(db, character.id)];
      let maxCount = 0;
      for (const alias of aliases) {
        maxCount = Math.max(maxCount, countAliasOccurrences(scopedChunks, alias));
      }
      if (maxCount > 0) {
        sceneEntityIds.add(character.id);
        sceneEntities.push({
          entityId: character.id,
          role: maxCount >= 2 ? "present" : "mentioned",
          confidence: maxCount >= 2 ? 0.6 : 0.4
        });
      }
    }

    if (settingEntityId && !sceneEntityIds.has(settingEntityId)) {
      sceneEntities.push({ entityId: settingEntityId, role: "setting", confidence: 0.7 });
    }

    updateSceneMetadata(db, scene.id, {
      pov_mode: povMode,
      pov_entity_id: povEntityId,
      pov_confidence: povConfidence,
      setting_entity_id: settingEntityId,
      setting_text: settingText,
      setting_confidence: settingConfidence,
      time_context_text: timeContextText
    });

    for (const span of evidence) {
      insertSceneEvidence(db, {
        sceneId: scene.id,
        chunkId: span.chunkId,
        quoteStart: span.quoteStart,
        quoteEnd: span.quoteEnd
      });
    }

    replaceSceneEntities(db, scene.id, sceneEntities);

    if (!providerAvailable) {
      continue;
    }

    if (scopedChunks.length === 0) {
      continue;
    }

    logEvent(db, {
      projectId,
      level: "info",
      eventType: "llm_call",
      payload: { type: "scene_meta", sceneId: scene.id }
    });

    const sceneChunkPayload = scopedChunks.map((chunk, index) => ({
      index,
      chunk
    }));

    const prompt = buildSceneMetaUserPrompt({
      knownCharacters: characterEntities.map((entity) => ({
        displayName: entity.display_name,
        aliases: listAliases(db, entity.id)
      })),
      knownLocations: locationEntities.map((entity) => ({
        displayName: entity.display_name,
        aliases: listAliases(db, entity.id)
      })),
      sceneChunks: sceneChunkPayload.map((entry) => ({ ordinal: entry.index, text: entry.chunk.text }))
    });

    let completion: { json: SceneMetaOutput } | null = null;
    try {
      completion = await completeJsonWithRetry<SceneMetaOutput>(provider, {
        schemaName: "scene_meta",
        systemPrompt: SCENE_META_SYSTEM_PROMPT,
        userPrompt: prompt,
        jsonSchema: sceneSchema,
        temperature: 0.1,
        maxTokens: 800
      });
    } catch (error) {
      logEvent(db, {
        projectId,
        level: "warn",
        eventType: "scene_meta_failed",
        payload: {
          sceneId: scene.id,
          message: error instanceof Error ? error.message : "Unknown error"
        }
      });
      continue;
    }

    const mappedEvidence: Array<{ chunkId: string; quoteStart: number; quoteEnd: number }> = [];
    for (const ev of completion.json.evidence ?? []) {
      const chunkEntry = sceneChunkPayload[ev.chunkOrdinal];
      if (!chunkEntry) continue;
      const span = findExactSpan(chunkEntry.chunk.text, ev.quote) ?? findFuzzySpan(chunkEntry.chunk.text, ev.quote);
      if (!span) continue;
      mappedEvidence.push({
        chunkId: chunkEntry.chunk.id,
        quoteStart: span.start,
        quoteEnd: span.end
      });
    }

    if (mappedEvidence.length === 0) {
      continue;
    }

    const povName = completion.json.povName ? normalizeAlias(completion.json.povName) : null;
    const settingName = completion.json.settingName ? normalizeAlias(completion.json.settingName) : null;
    const mappedPovEntityId = povName ? characterMap.get(povName) ?? null : null;
    const mappedSettingEntityId = settingName ? locationMap.get(settingName) ?? null : null;

    const nextSettingText =
      mappedSettingEntityId ? completion.json.settingName : completion.json.settingText;

    updateSceneMetadata(db, scene.id, {
      pov_mode: completion.json.povMode,
      pov_entity_id: mappedPovEntityId,
      pov_confidence: completion.json.povConfidence,
      setting_entity_id: mappedSettingEntityId,
      setting_text: nextSettingText ?? null,
      setting_confidence: completion.json.settingConfidence,
      time_context_text: completion.json.timeContextText
    });

    deleteSceneEvidenceForScene(db, scene.id);
    for (const span of mappedEvidence) {
      insertSceneEvidence(db, {
        sceneId: scene.id,
        chunkId: span.chunkId,
        quoteStart: span.quoteStart,
        quoteEnd: span.quoteEnd
      });
    }

    const nextSceneEntities = sceneEntities.filter(
      (entry) =>
        entry.entityId !== mappedSettingEntityId && entry.entityId !== mappedPovEntityId
    );
    if (mappedSettingEntityId) {
      nextSceneEntities.push({
        entityId: mappedSettingEntityId,
        role: "setting",
        confidence: completion.json.settingConfidence
      });
    }
    if (mappedPovEntityId) {
      nextSceneEntities.push({
        entityId: mappedPovEntityId,
        role: "present",
        confidence: completion.json.povConfidence
      });
    }

    replaceSceneEntities(db, scene.id, nextSceneEntities);
  }
}
