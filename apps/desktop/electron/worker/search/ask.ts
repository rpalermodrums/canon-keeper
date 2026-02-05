import type Database from "better-sqlite3";
import qaSchema from "../../../../../packages/shared/schemas/qa_answer.schema.json";
import { QA_SYSTEM_PROMPT, buildQaUserPrompt } from "../llm/promptPack";
import { CloudProvider, NullProvider, type LLMProvider } from "../llm/provider";
import { completeJsonWithRetry } from "../llm/validator";
import { findExactSpan, findFuzzySpan } from "../../../../../packages/shared/utils/spans";
import { loadProjectConfig } from "../config";
import { searchChunks, type SearchResult } from "./fts";
import { listAliases, listClaimsForEntity, listEntities, logEvent } from "../storage";
import { normalizeAlias } from "../../../../../packages/shared/utils/normalize";

export type AskResult = {
  answerType: "cited" | "not_found" | "snippets";
  answer: string;
  confidence: number;
  citations: Array<{ chunkId: string; quoteStart: number; quoteEnd: number }>;
  snippets?: SearchResult[];
};

type QaOutput = {
  schemaVersion: string;
  answerType: "cited" | "not_found";
  answer: string;
  confidence: number;
  citations: Array<{ chunkOrdinal: number; quote: string }>;
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

export async function askQuestion(
  db: Database.Database,
  args: { projectId: string; rootPath: string; question: string }
): Promise<AskResult> {
  const snippets = searchChunks(db, args.question, 8, args.projectId);
  const provider = buildProvider(args.rootPath);
  if (!(await provider.isAvailable())) {
    return {
      answerType: "snippets",
      answer: "LLM unavailable. Showing best-effort search results.",
      confidence: 0,
      citations: [],
      snippets
    };
  }

  logEvent(db, {
    projectId: args.projectId,
    level: "info",
    eventType: "llm_call",
    payload: { type: "qa", chunkCount: snippets.length }
  });

  const chunkPayload = snippets.map((result, index) => ({
    ordinal: index,
    text: result.text,
    chunkId: result.chunkId
  }));

  const normalizedQuestion = normalizeAlias(args.question);
  const relevantClaims = listEntities(db, args.projectId)
    .filter((entity) => {
      const names = [entity.display_name, ...listAliases(db, entity.id)];
      return names.some((name) => normalizedQuestion.includes(normalizeAlias(name)));
    })
    .flatMap((entity) =>
      listClaimsForEntity(db, entity.id).map((claim) => ({
        entityName: entity.display_name,
        field: claim.field,
        value: JSON.parse(claim.value_json),
        status: claim.status
      }))
    );

  const prompt = buildQaUserPrompt({
    question: args.question,
    retrievedChunks: chunkPayload.map((chunk) => ({ ordinal: chunk.ordinal, text: chunk.text })),
    relevantClaims
  });

  const completion = await completeJsonWithRetry<QaOutput>(provider, {
    schemaName: "qa",
    systemPrompt: QA_SYSTEM_PROMPT,
    userPrompt: prompt,
    jsonSchema: qaSchema,
    temperature: 0.2,
    maxTokens: 800
  });

  const citations: Array<{ chunkId: string; quoteStart: number; quoteEnd: number }> = [];
  for (const citation of completion.json.citations ?? []) {
    const chunk = chunkPayload[citation.chunkOrdinal];
    if (!chunk) continue;
    const span = findExactSpan(chunk.text, citation.quote) ?? findFuzzySpan(chunk.text, citation.quote);
    if (!span) continue;
    citations.push({ chunkId: chunk.chunkId, quoteStart: span.start, quoteEnd: span.end });
  }

  let answerType: AskResult["answerType"] = completion.json.answerType;
  let answer = completion.json.answer;
  let confidence = completion.json.confidence;

  if (answerType === "cited" && citations.length === 0) {
    answerType = "not_found";
    answer = "Answer not found in the provided text.";
    confidence = Math.min(0.4, confidence);
  }

  if (answerType === "not_found") {
    return {
      answerType,
      answer,
      confidence,
      citations: [],
      snippets
    };
  }

  return {
    answerType,
    answer,
    confidence,
    citations
  };
}
