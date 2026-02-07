import type Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getChunkById, type ChunkRecord } from "../storage/chunkRepo";
import { getDocumentById, type DocumentSummary } from "../storage/documentRepo";
import { buildExcerpt, createEvidenceMapper } from "./evidence";

vi.mock("../storage/chunkRepo", () => ({
  getChunkById: vi.fn()
}));

vi.mock("../storage/documentRepo", () => ({
  getDocumentById: vi.fn()
}));

const mockedGetChunkById = vi.mocked(getChunkById);
const mockedGetDocumentById = vi.mocked(getDocumentById);

const buildChunk = (overrides: Partial<ChunkRecord>): ChunkRecord => ({
  id: overrides.id ?? "chunk-1",
  document_id: overrides.document_id ?? "doc-1",
  ordinal: overrides.ordinal ?? 0,
  text: overrides.text ?? "",
  text_hash: overrides.text_hash ?? "hash",
  start_char: overrides.start_char ?? 0,
  end_char: overrides.end_char ?? 0,
  created_at: overrides.created_at ?? 0,
  updated_at: overrides.updated_at ?? 0
});

const buildDocument = (overrides: Partial<DocumentSummary>): DocumentSummary => ({
  id: overrides.id ?? "doc-1",
  project_id: overrides.project_id ?? "project-1",
  path: overrides.path ?? "/book/chapter-1.md",
  kind: overrides.kind ?? "md",
  created_at: overrides.created_at ?? 0,
  updated_at: overrides.updated_at ?? 0,
  is_missing: overrides.is_missing ?? 0,
  last_seen_at: overrides.last_seen_at ?? 0
});

const createMockDb = (snapshots: Record<string, string | null | undefined>) => {
  const getSnapshot = vi.fn((documentId: string) => {
    const text = snapshots[documentId];
    return typeof text === "string" ? { full_text: text } : undefined;
  });
  const prepare = vi.fn(() => ({
    get: getSnapshot
  }));
  const db = { prepare } as unknown as Database.Database;
  return { db, prepare, getSnapshot };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildExcerpt", () => {
  it("handles start-of-file boundaries", () => {
    const excerpt = buildExcerpt("abcdef", 0, 3, 2);
    expect(excerpt).toBe("[abc]de…");
  });

  it("handles end-of-file boundaries", () => {
    const excerpt = buildExcerpt("abcdef", 4, 6, 2);
    expect(excerpt).toBe("…cd[ef]");
  });

  it("handles empty text without garbling output", () => {
    const excerpt = buildExcerpt("", 0, 0, 5);
    expect(excerpt).toBe("[]");
  });

  it("keeps boundary arithmetic stable around highlighted spans", () => {
    const text = "0123456789";
    const excerpt = buildExcerpt(text, 3, 7, 2);
    expect(excerpt).toBe("…12[3456]78…");
    expect(excerpt).toContain("[3456]");
  });
});

describe("createEvidenceMapper", () => {
  it("gracefully handles evidence rows that reference missing chunks", () => {
    mockedGetChunkById.mockReturnValue(null);
    mockedGetDocumentById.mockReturnValue(null);

    const { db, prepare } = createMockDb({
      "doc-1": "unused"
    });
    const mapEvidence = createEvidenceMapper(db);

    const view = mapEvidence({
      chunk_id: "missing-chunk",
      quote_start: 2,
      quote_end: 4
    });

    expect(view).toEqual({
      chunkId: "missing-chunk",
      documentPath: null,
      chunkOrdinal: null,
      quoteStart: 2,
      quoteEnd: 4,
      excerpt: "",
      lineStart: null,
      lineEnd: null
    });
    expect(mockedGetChunkById).toHaveBeenCalledWith(db, "missing-chunk");
    expect(mockedGetDocumentById).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("maps line numbers for start, middle, and end offsets via evidence spans", () => {
    const fullText = "alpha\nbeta\ngamma";
    const chunk = buildChunk({
      id: "chunk-a",
      document_id: "doc-a",
      ordinal: 4,
      text: fullText,
      start_char: 0,
      end_char: fullText.length
    });
    const doc = buildDocument({
      id: "doc-a",
      path: "/book/chapter-a.md"
    });

    mockedGetChunkById.mockReturnValue(chunk);
    mockedGetDocumentById.mockReturnValue(doc);

    const { db, getSnapshot } = createMockDb({
      "doc-a": fullText
    });
    const mapEvidence = createEvidenceMapper(db);

    const atStart = mapEvidence({ chunkId: "chunk-a", quoteStart: 0, quoteEnd: 1 });
    const inMiddle = mapEvidence({ chunkId: "chunk-a", quoteStart: 7, quoteEnd: 9 });
    const atEnd = mapEvidence({ chunkId: "chunk-a", quoteStart: 15, quoteEnd: 16 });

    expect(atStart.lineStart).toBe(1);
    expect(atStart.lineEnd).toBe(1);
    expect(inMiddle.lineStart).toBe(2);
    expect(inMiddle.lineEnd).toBe(2);
    expect(atEnd.lineStart).toBe(3);
    expect(atEnd.lineEnd).toBe(3);
    expect(getSnapshot).toHaveBeenCalledTimes(1);
  });

  it("handles newline-boundary offsets without off-by-one errors", () => {
    const fullText = "alpha\nbeta\ngamma";
    const chunk = buildChunk({
      id: "chunk-b",
      document_id: "doc-b",
      text: fullText,
      start_char: 0,
      end_char: fullText.length
    });

    mockedGetChunkById.mockReturnValue(chunk);
    mockedGetDocumentById.mockReturnValue(buildDocument({ id: "doc-b" }));

    const { db } = createMockDb({
      "doc-b": fullText
    });
    const mapEvidence = createEvidenceMapper(db);

    const atFirstNewline = mapEvidence({ chunkId: "chunk-b", quoteStart: 5, quoteEnd: 6 });
    const afterFirstNewline = mapEvidence({ chunkId: "chunk-b", quoteStart: 6, quoteEnd: 7 });
    const atSecondNewline = mapEvidence({ chunkId: "chunk-b", quoteStart: 10, quoteEnd: 11 });
    const afterSecondNewline = mapEvidence({ chunkId: "chunk-b", quoteStart: 11, quoteEnd: 12 });

    expect(atFirstNewline.lineStart).toBe(1);
    expect(atFirstNewline.lineEnd).toBe(1);
    expect(afterFirstNewline.lineStart).toBe(2);
    expect(afterFirstNewline.lineEnd).toBe(2);
    expect(atSecondNewline.lineStart).toBe(2);
    expect(atSecondNewline.lineEnd).toBe(2);
    expect(afterSecondNewline.lineStart).toBe(3);
    expect(afterSecondNewline.lineEnd).toBe(3);
  });

  it("maps valid chunks to document context, excerpt, and absolute line positions", () => {
    const fullText = "header\nAAA\nBBB\ntail";
    const chunkText = "AAA\nBBB";
    const chunk = buildChunk({
      id: "chunk-c",
      document_id: "doc-c",
      ordinal: 8,
      text: chunkText,
      start_char: 7,
      end_char: 14
    });
    const doc = buildDocument({
      id: "doc-c",
      path: "/book/chapter-c.md"
    });

    mockedGetChunkById.mockReturnValue(chunk);
    mockedGetDocumentById.mockReturnValue(doc);

    const { db } = createMockDb({
      "doc-c": fullText
    });
    const mapEvidence = createEvidenceMapper(db);

    const view = mapEvidence({
      chunkId: "chunk-c",
      quoteStart: 4,
      quoteEnd: 7
    });

    expect(view).toEqual({
      chunkId: "chunk-c",
      documentPath: "/book/chapter-c.md",
      chunkOrdinal: 8,
      quoteStart: 4,
      quoteEnd: 7,
      excerpt: "AAA\n[BBB]",
      lineStart: 3,
      lineEnd: 3
    });
  });
});
