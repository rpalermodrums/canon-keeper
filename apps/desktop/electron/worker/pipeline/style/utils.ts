export const DEFAULT_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "you",
  "your",
  "was",
  "were",
  "are",
  "but",
  "not",
  "she",
  "he",
  "they",
  "them",
  "his",
  "her",
  "their",
  "into",
  "out",
  "over",
  "under",
  "then",
  "there",
  "here",
  "what",
  "when",
  "where",
  "who",
  "why",
  "how",
  "about",
  "again",
  "just",
  "like",
  "had",
  "has",
  "have",
  "did",
  "does",
  "doing",
  "its",
  "it's",
  "i",
  "we",
  "our",
  "us",
  "me",
  "my",
  "mine",
  "a",
  "an",
  "of",
  "to",
  "in",
  "on",
  "at",
  "as",
  "is",
  "be",
  "been",
  "if",
  "or",
  "so",
  "because",
  "than",
  "too",
  "very"
]);

export function tokenize(text: string, stopwords: Set<string> = DEFAULT_STOPWORDS): string[] {
  const cleaned = text
    .replace(/[^A-Za-z0-9'\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!cleaned) return [];
  return cleaned.split(" ").filter((token) => token.length >= 3 && !stopwords.has(token));
}

export function sentenceSplit(text: string): string[] {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  return sentences.length > 0 ? sentences : [text.trim()];
}
