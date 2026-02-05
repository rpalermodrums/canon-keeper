import { describe, expect, it } from "vitest";
import { normalizeAlias } from "./normalize";

describe("normalizeAlias", () => {
  it("lowercases, trims, and collapses whitespace", () => {
    expect(normalizeAlias("  The   North  ")).toBe("the north");
  });

  it("normalizes quotes and strips edge punctuation", () => {
    expect(normalizeAlias("“Mira’s”")).toBe("mira's");
  });
});
