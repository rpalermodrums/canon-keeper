import type Database from "better-sqlite3";
import { searchChunks, type SearchResult } from "./fts";

export type AskCitation = { chunkId: string; quoteStart: number; quoteEnd: number };
export type CitedSnippet = SearchResult;

export type AskResult =
  | {
      kind: "answer";
      answer: string;
      confidence: number;
      citations: AskCitation[];
    }
  | {
      kind: "snippets";
      snippets: CitedSnippet[];
    }
  | {
      kind: "not_found";
      reason: string;
    };

export async function askQuestion(
  db: Database.Database,
  args: { projectId: string; rootPath: string; question: string }
): Promise<AskResult> {
  void args.rootPath;
  const snippets = searchChunks(db, args.question, 8, args.projectId);
  if (snippets.length === 0) {
    return {
      kind: "not_found",
      reason: "Answer not found in the indexed manuscript text."
    };
  }

  return {
    kind: "snippets",
    snippets
  };
}
