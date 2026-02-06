import type Database from "better-sqlite3";
import { searchChunks, type SearchResult } from "./fts";

export type AskResult = {
  answerType: "not_found" | "snippets";
  answer: string;
  confidence: number;
  citations: Array<{ chunkId: string; quoteStart: number; quoteEnd: number }>;
  snippets?: SearchResult[];
};

export async function askQuestion(
  db: Database.Database,
  args: { projectId: string; rootPath: string; question: string }
): Promise<AskResult> {
  void args.rootPath;
  const snippets = searchChunks(db, args.question, 8, args.projectId);
  if (snippets.length === 0) {
    return {
      answerType: "not_found",
      answer: "Answer not found in the indexed manuscript text.",
      confidence: 0,
      citations: []
    };
  }

  return {
    answerType: "snippets",
    answer: "Showing evidence-backed excerpts from your manuscript.",
    confidence: 1,
    citations: [],
    snippets
  };
}
