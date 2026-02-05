import type Database from "better-sqlite3";
import type { ChunkRecord } from "../storage/chunkRepo";
import type { SceneSummary } from "../storage/sceneRepo";
import {
  insertSceneEvidence,
  listAliases,
  listChunksForDocument,
  listEntities,
  listScenesForProject,
  replaceSceneEntities,
  updateSceneMetadata,
  deleteSceneEvidenceForScene
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

export function runSceneMetadata(db: Database.Database, projectId: string, documentId: string): void {
  const scenes = listScenesForProject(db, projectId).filter((scene) => scene.document_id === documentId);
  const chunks = listChunksForDocument(db, documentId);

  const entities = listEntities(db, projectId);
  const characterEntities = entities.filter((entity) => entity.type === "character");
  const locationEntities = entities.filter((entity) => entity.type === "location");

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

    const sceneEntities: Array<{ entityId: string; role: "mentioned" | "setting"; confidence: number }> = [];
    const sceneEntityIds = new Set<string>();
    for (const character of characterEntities) {
      const aliases = [character.display_name, ...listAliases(db, character.id)];
      for (const alias of aliases) {
        if (findAliasEvidence(scopedChunks, alias)) {
          sceneEntityIds.add(character.id);
          sceneEntities.push({ entityId: character.id, role: "mentioned", confidence: 0.5 });
          break;
        }
      }
    }

    if (settingEntityId && !sceneEntityIds.has(settingEntityId)) {
      sceneEntities.push({ entityId: settingEntityId, role: "setting", confidence: 0.7 });
    }

    replaceSceneEntities(db, scene.id, sceneEntities);
  }
}
