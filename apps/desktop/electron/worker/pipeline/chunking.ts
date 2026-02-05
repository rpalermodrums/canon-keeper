import { hashText } from "../../../../../packages/shared/utils/hashing";

export type BlockSpan = {
  start: number;
  end: number;
};

export type ChunkSpan = {
  ordinal: number;
  start: number;
  end: number;
  text: string;
  text_hash: string;
};

const MIN_CHUNK = 800;
const MAX_CHUNK = 1500;
const LONG_BLOCK = 4000;
const SPLIT_TARGET = 1500;

function splitIntoBlocks(fullText: string): BlockSpan[] {
  const lines = fullText.split("\n");
  const blocks: BlockSpan[] = [];

  let bufferStart: number | null = null;
  let bufferEnd: number | null = null;
  let offset = 0;

  const flush = () => {
    if (bufferStart !== null && bufferEnd !== null) {
      blocks.push({ start: bufferStart, end: bufferEnd });
    }
    bufferStart = null;
    bufferEnd = null;
  };

  for (const line of lines) {
    const lineStart = offset;
    const lineEnd = offset + line.length;
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      flush();
      offset = lineEnd + 1;
      continue;
    }

    if (/^#{1,6}\s+/.test(line)) {
      flush();
      blocks.push({ start: lineStart, end: lineEnd });
      offset = lineEnd + 1;
      continue;
    }

    if (bufferStart === null) {
      bufferStart = lineStart;
    }
    bufferEnd = lineEnd;
    offset = lineEnd + 1;
  }

  flush();
  return blocks;
}

function splitLongBlock(fullText: string, block: BlockSpan): BlockSpan[] {
  const length = block.end - block.start;
  if (length <= LONG_BLOCK) {
    return [block];
  }

  const spans: BlockSpan[] = [];
  let cursor = block.start;
  while (cursor < block.end) {
    const remaining = block.end - cursor;
    if (remaining <= SPLIT_TARGET) {
      spans.push({ start: cursor, end: block.end });
      break;
    }

    const targetEnd = cursor + SPLIT_TARGET;
    const windowStart = Math.max(cursor + 200, targetEnd - 200);
    const windowEnd = Math.min(block.end - 1, targetEnd + 200);
    let splitAt = targetEnd;

    const segment = fullText.slice(windowStart, windowEnd);
    const lastSpace = segment.lastIndexOf(" ");
    if (lastSpace >= 0) {
      splitAt = windowStart + lastSpace;
    }

    spans.push({ start: cursor, end: splitAt });
    cursor = splitAt;
  }

  return spans;
}

export function buildChunks(fullText: string): ChunkSpan[] {
  const blocks = splitIntoBlocks(fullText).flatMap((block) => splitLongBlock(fullText, block));
  const chunks: ChunkSpan[] = [];

  let currentStart: number | null = null;
  let currentEnd: number | null = null;

  const pushChunk = () => {
    if (currentStart === null || currentEnd === null) {
      return;
    }
    const text = fullText.slice(currentStart, currentEnd);
    const chunk: ChunkSpan = {
      ordinal: chunks.length,
      start: currentStart,
      end: currentEnd,
      text,
      text_hash: hashText(text)
    };
    chunks.push(chunk);
    currentStart = null;
    currentEnd = null;
  };

  for (const block of blocks) {
    if (currentStart === null || currentEnd === null) {
      currentStart = block.start;
      currentEnd = block.end;
      continue;
    }

    const proposedEnd = block.end;
    const proposedLength = proposedEnd - currentStart;
    const currentLength = currentEnd - currentStart;

    if (proposedLength <= MAX_CHUNK || currentLength < MIN_CHUNK) {
      currentEnd = proposedEnd;
    } else {
      pushChunk();
      currentStart = block.start;
      currentEnd = block.end;
    }
  }

  pushChunk();
  return chunks;
}
