import { describe, expect, it } from "vitest";
import { hashText } from "./hashing";

describe("hashText", () => {
  it("returns a stable sha256 hex digest", () => {
    const hash = hashText("canonkeeper");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]+$/);
  });

  it("changes when input changes", () => {
    const a = hashText("a");
    const b = hashText("b");
    expect(a).not.toBe(b);
  });
});
