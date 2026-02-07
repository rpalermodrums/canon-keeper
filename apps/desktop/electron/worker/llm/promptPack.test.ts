import { describe, expect, it } from "vitest";
import extractionSchema from "../../../../../packages/shared/schemas/extraction.schema.json";
import qaSchema from "../../../../../packages/shared/schemas/qa_answer.schema.json";
import sceneSchema from "../../../../../packages/shared/schemas/scene_extract.schema.json";
import {
  buildExtractionUserPrompt,
  buildQaUserPrompt,
  buildSceneMetaUserPrompt,
  EXTRACTION_SYSTEM_PROMPT,
  QA_SYSTEM_PROMPT,
  SCENE_META_SYSTEM_PROMPT
} from "./promptPack";

type SchemaObject = {
  properties?: Record<string, unknown>;
  required?: string[];
  $defs?: Record<string, SchemaObject>;
};

function schemaKeys(schema: SchemaObject, def?: string): Set<string> {
  if (def) {
    return new Set(Object.keys(schema.$defs?.[def]?.properties ?? {}));
  }
  return new Set(Object.keys(schema.properties ?? {}));
}

function schemaFieldUniverse(schema: SchemaObject, defs: string[]): Set<string> {
  const topLevel = schemaKeys(schema);
  const nested = defs.flatMap((def) => [...schemaKeys(schema, def)]);
  return new Set([...topLevel, ...nested]);
}

describe("promptPack snapshots", () => {
  it("matches extraction system prompt snapshot", () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toMatchSnapshot();
  });

  it("matches scene metadata system prompt snapshot", () => {
    expect(SCENE_META_SYSTEM_PROMPT).toMatchSnapshot();
  });

  it("matches qa system prompt snapshot", () => {
    expect(QA_SYSTEM_PROMPT).toMatchSnapshot();
  });

  it("matches extraction user prompt snapshot", () => {
    const prompt = buildExtractionUserPrompt({
      projectName: "Atlas Draft",
      knownEntities: [
        {
          id: "entity-001",
          type: "character",
          displayName: "Mara Quill",
          aliases: ["Mara", "Captain Quill"]
        },
        {
          id: "entity-002",
          type: "location",
          displayName: "Ironbridge Station",
          aliases: ["the station"]
        }
      ],
      chunks: [
        {
          ordinal: 14,
          text: "Mara pressed her palm to the brass map while thunder shook Ironbridge Station."
        },
        {
          ordinal: 15,
          text: "She whispered that she feared the tunnels beneath the station would collapse."
        }
      ],
      instructions: "Focus on canonical details updated in this revision."
    });

    expect(prompt).toMatchSnapshot();
  });

  it("matches scene metadata user prompt snapshot", () => {
    const prompt = buildSceneMetaUserPrompt({
      knownCharacters: [
        { displayName: "Mara Quill", aliases: ["Mara"] },
        { displayName: "Jonas Vale", aliases: ["Jonas", "Archivist Vale"] }
      ],
      knownLocations: [
        { displayName: "Ironbridge Station", aliases: ["the station"] },
        { displayName: "South Tunnel", aliases: ["the tunnel"] }
      ],
      sceneChunks: [
        {
          ordinal: 77,
          text: "I kept my lantern low as I crossed the platform at Ironbridge Station."
        },
        {
          ordinal: 78,
          text: "Jonas waited by the south tunnel gate, counting the echoes between trains."
        }
      ]
    });

    expect(prompt).toMatchSnapshot();
  });

  it("matches qa user prompt snapshot", () => {
    const prompt = buildQaUserPrompt({
      question: "Where does Mara meet Jonas?",
      retrievedChunks: [
        {
          ordinal: 9,
          text: "Mara met Jonas at Ironbridge Station before dawn and handed him the atlas key."
        },
        {
          ordinal: 10,
          text: "They argued over whether to enter the south tunnel."
        }
      ],
      relevantClaims: [
        {
          entityName: "Mara Quill",
          field: "relationships",
          value: { with: "Jonas Vale", type: "ally" },
          status: "confirmed"
        }
      ]
    });

    expect(prompt).toMatchSnapshot();
  });
});

describe("promptPack structural constraints", () => {
  it("includes non-ghostwriting, grounding, evidence, and strict-json constraints in every system prompt", () => {
    const prompts = [EXTRACTION_SYSTEM_PROMPT, SCENE_META_SYSTEM_PROMPT, QA_SYSTEM_PROMPT] as const;
    const requiredFragments = [
      "SCOPE LIMITS:",
      "GROUNDING REQUIREMENTS:",
      "EVIDENCE REQUIREMENTS:",
      "You MUST output ONLY valid JSON.",
      "Do NOT include any keys not defined by the schema."
    ] as const;

    for (const prompt of prompts) {
      for (const fragment of requiredFragments) {
        expect(prompt).toContain(fragment);
      }
    }
  });

  it("includes explicit schema output instructions for every user prompt", () => {
    const extractionPrompt = buildExtractionUserPrompt({
      projectName: "Schema Check",
      knownEntities: [],
      chunks: [{ ordinal: 0, text: "Mara looked north." }]
    });
    const scenePrompt = buildSceneMetaUserPrompt({
      knownCharacters: [],
      knownLocations: [],
      sceneChunks: [{ ordinal: 0, text: "I wrote this in my diary at dawn." }]
    });
    const qaPrompt = buildQaUserPrompt({
      question: "Who wrote the diary?",
      retrievedChunks: [{ ordinal: 0, text: "I wrote this in my diary at dawn." }]
    });

    expect(extractionPrompt).toContain('Output must match extraction.schema.json with schemaVersion "1.0".');
    expect(scenePrompt).toContain('Output must match scene_extract.schema.json with schemaVersion "1.0".');
    expect(qaPrompt).toContain('Output must match qa_answer.schema.json with schemaVersion "1.0".');
  });
});

describe("promptPack schema references", () => {
  it("references extraction schema field names that exist in the extraction schema", () => {
    const extractionPrompt = `${EXTRACTION_SYSTEM_PROMPT}\n${buildExtractionUserPrompt({
      projectName: "Schema Ref",
      knownEntities: [],
      chunks: [{ ordinal: 0, text: "Elena guarded the archive gate." }]
    })}`;

    const extractionFieldNames = schemaFieldUniverse(extractionSchema as SchemaObject, [
      "extractedEntity",
      "extractedClaim",
      "evidenceRef",
      "suggestedMerge"
    ]);
    const referencedFields = [
      "schemaVersion",
      "entities",
      "claims",
      "chunkOrdinal",
      "quote",
      "confidence",
      "tempId"
    ] as const;

    for (const fieldName of referencedFields) {
      expect(extractionPrompt).toContain(fieldName);
      expect(extractionFieldNames.has(fieldName)).toBe(true);
    }
  });

  it("references scene metadata schema field names that exist in the scene schema", () => {
    const scenePrompt = `${SCENE_META_SYSTEM_PROMPT}\n${buildSceneMetaUserPrompt({
      knownCharacters: [{ displayName: "Elena", aliases: ["Archivist Elena"] }],
      knownLocations: [{ displayName: "Archive Gate", aliases: ["the gate"] }],
      sceneChunks: [{ ordinal: 5, text: "I stood at the Archive Gate and wrote to Elena." }]
    })}`;

    const sceneFieldNames = schemaFieldUniverse(sceneSchema as SchemaObject, ["evidenceRef"]);
    const referencedFields = [
      "schemaVersion",
      "povMode",
      "povName",
      "settingName",
      "settingText",
      "settingConfidence",
      "chunkOrdinal",
      "quote"
    ] as const;

    for (const fieldName of referencedFields) {
      expect(scenePrompt).toContain(fieldName);
      expect(sceneFieldNames.has(fieldName)).toBe(true);
    }
  });

  it("references qa schema field names that exist in the qa schema", () => {
    const qaPrompt = `${QA_SYSTEM_PROMPT}\n${buildQaUserPrompt({
      question: "What does Elena guard?",
      retrievedChunks: [{ ordinal: 3, text: "Elena guards the archive gate through every storm." }]
    })}`;

    const qaFieldNames = schemaFieldUniverse(qaSchema as SchemaObject, ["citationRef"]);
    const referencedFields = [
      "schemaVersion",
      "answerType",
      "answer",
      "confidence",
      "citations",
      "chunkOrdinal",
      "quote"
    ] as const;

    for (const fieldName of referencedFields) {
      expect(qaPrompt).toContain(fieldName);
      expect(qaFieldNames.has(fieldName)).toBe(true);
    }
  });
});

describe("promptPack parameterization", () => {
  it("changes extraction prompt content based on project, chunks, and instructions", () => {
    const promptA = buildExtractionUserPrompt({
      projectName: "Northern Ledger",
      knownEntities: [{ id: "a-1", type: "character", displayName: "Rowan", aliases: ["Roe"] }],
      chunks: [{ ordinal: 1, text: "Rowan hated winter crossings." }],
      instructions: "Focus on chapter seven deltas."
    });
    const promptB = buildExtractionUserPrompt({
      projectName: "Southern Atlas",
      knownEntities: [{ id: "b-1", type: "location", displayName: "Sun Port", aliases: [] }],
      chunks: [{ ordinal: 1, text: "Sun Port flooded every equinox." }]
    });

    expect(promptA).toContain("Project: Northern Ledger");
    expect(promptB).toContain("Project: Southern Atlas");
    expect(promptA).toContain("Focus on chapter seven deltas.");
    expect(promptA).not.toBe(promptB);
    expect(promptB).not.toContain("undefined");
    expect({ promptA, promptB }).toMatchSnapshot();
  });

  it("limits extraction known entities to the first 2000 entries", () => {
    const knownEntities = Array.from({ length: 2002 }, (_, index) => ({
      id: `entity-${index}`,
      type: "term" as const,
      displayName: `Term ${index}`,
      aliases: [] as string[]
    }));
    const prompt = buildExtractionUserPrompt({
      projectName: "Cap Test",
      knownEntities,
      chunks: [{ ordinal: 0, text: "Term 0 appears." }]
    });

    expect(prompt).toContain('"id": "entity-1999"');
    expect(prompt).not.toContain('"id": "entity-2000"');
  });

  it("limits scene metadata known character and location lists to first 500 entries", () => {
    const knownCharacters = Array.from({ length: 502 }, (_, index) => ({
      displayName: `Character ${index}`,
      aliases: [] as string[]
    }));
    const knownLocations = Array.from({ length: 502 }, (_, index) => ({
      displayName: `Location ${index}`,
      aliases: [] as string[]
    }));
    const prompt = buildSceneMetaUserPrompt({
      knownCharacters,
      knownLocations,
      sceneChunks: [{ ordinal: 2, text: "I walked through Location 0." }]
    });

    expect(prompt).toContain('"displayName": "Character 499"');
    expect(prompt).not.toContain('"displayName": "Character 500"');
    expect(prompt).toContain('"displayName": "Location 499"');
    expect(prompt).not.toContain('"displayName": "Location 500"');
  });

  it("changes qa prompt content when relevant claims are present", () => {
    const promptWithClaims = buildQaUserPrompt({
      question: "What rule governs the bell tower?",
      retrievedChunks: [{ ordinal: 4, text: "The bell tower can only ring at sunset." }],
      relevantClaims: [
        {
          entityName: "Bell Tower Rule",
          field: "constraint",
          value: "can only ring at sunset",
          status: "inferred"
        }
      ]
    });
    const promptWithoutClaims = buildQaUserPrompt({
      question: "What rule governs the bell tower?",
      retrievedChunks: [{ ordinal: 4, text: "The bell tower can only ring at sunset." }]
    });

    expect(promptWithClaims).toContain('"entityName": "Bell Tower Rule"');
    expect(promptWithoutClaims).toContain("[]");
    expect(promptWithClaims).not.toBe(promptWithoutClaims);
    expect({ promptWithClaims, promptWithoutClaims }).toMatchSnapshot();
  });
});
