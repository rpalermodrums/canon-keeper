import { afterEach, describe, expect, it } from "vitest";
import { beginAction, computeLayoutMode, endAction, isEditableElement, sanitizeErrorMessage, toUserFacingError } from "./utils";

type TestNamespace = "project" | "search";
type TestLabel = "createProject" | "ask" | "search";

const originalHTMLElement = globalThis.HTMLElement;

class MockHTMLElement {
  readonly tagName: string;
  readonly isContentEditable: boolean;

  constructor(tagName: string, isContentEditable = false) {
    this.tagName = tagName;
    this.isContentEditable = isContentEditable;
  }
}

afterEach(() => {
  globalThis.HTMLElement = originalHTMLElement;
});

describe("sanitizeErrorMessage", () => {
  it("returns user-friendly messages for known sqlite errors", () => {
    expect(sanitizeErrorMessage(new Error("SQLITE_BUSY: database is locked"))).toBe(
      "The database is temporarily busy. Please try again in a moment."
    );
    expect(sanitizeErrorMessage(new Error("sqlite_locked"))).toBe(
      "The database is temporarily locked. Please try again in a moment."
    );
    expect(sanitizeErrorMessage(new Error("SQLITE_CORRUPT: malformed"))).toBe(
      "The database file appears to be damaged. Try running diagnostics from Settings."
    );
    expect(sanitizeErrorMessage(new Error("sqlite_readonly"))).toBe(
      "The database cannot be written to. Check your file permissions."
    );
  });

  it("strips stack traces from generic errors", () => {
    const err = new Error("Something failed\n    at fn (file.ts:1:1)\n    at run (file.ts:2:1)");
    expect(sanitizeErrorMessage(err)).toBe("Something failed");
  });

  it("returns unknown for non-errors and empty stripped messages", () => {
    expect(sanitizeErrorMessage("plain string")).toBe("Unknown error");
    expect(sanitizeErrorMessage(new Error("   \n    at fn (file.ts:1:1)"))).toBe("Unknown error");
  });
});

describe("toUserFacingError", () => {
  it("coerces errors with metadata", () => {
    const result = toUserFacingError("PROJECT_OPEN_FAILED", new Error("Oops"), "Try again", "Retry");
    expect(result).toEqual({
      code: "PROJECT_OPEN_FAILED",
      message: "Oops",
      actionLabel: "Try again",
      action: "Retry"
    });
  });

  it("handles unknown error values", () => {
    const result = toUserFacingError("UNKNOWN", { reason: "bad" });
    expect(result).toEqual({
      code: "UNKNOWN",
      message: "Unknown error",
      actionLabel: undefined,
      action: undefined
    });
  });
});

describe("computeLayoutMode", () => {
  it("resolves breakpoint boundaries", () => {
    expect(computeLayoutMode(0)).toBe("mobile");
    expect(computeLayoutMode(767)).toBe("mobile");
    expect(computeLayoutMode(768)).toBe("tablet");
    expect(computeLayoutMode(1199)).toBe("tablet");
    expect(computeLayoutMode(1200)).toBe("desktop");
  });
});

describe("isEditableElement", () => {
  it("returns false when HTMLElement is unavailable", () => {
    globalThis.HTMLElement = undefined as unknown as typeof HTMLElement;
    expect(isEditableElement(new EventTarget())).toBe(false);
  });

  it("detects editable html elements", () => {
    globalThis.HTMLElement = MockHTMLElement as unknown as typeof HTMLElement;
    expect(isEditableElement(new MockHTMLElement("INPUT") as unknown as EventTarget)).toBe(true);
    expect(isEditableElement(new MockHTMLElement("textarea") as unknown as EventTarget)).toBe(true);
    expect(isEditableElement(new MockHTMLElement("select") as unknown as EventTarget)).toBe(true);
    expect(isEditableElement(new MockHTMLElement("div", true) as unknown as EventTarget)).toBe(true);
    expect(isEditableElement(new MockHTMLElement("div") as unknown as EventTarget)).toBe(false);
  });

  it("returns false for non-elements", () => {
    globalThis.HTMLElement = MockHTMLElement as unknown as typeof HTMLElement;
    expect(isEditableElement(null)).toBe(false);
    expect(isEditableElement({} as EventTarget)).toBe(false);
  });
});

describe("beginAction", () => {
  it("adds an action without mutating existing state", () => {
    const current = new Map<TestNamespace, Set<TestLabel>>();
    const next = beginAction(current, "project", "createProject");

    expect(current.size).toBe(0);
    expect(next).not.toBe(current);
    expect(next.get("project")).toEqual(new Set<TestLabel>(["createProject"]));
  });

  it("adds to an existing namespace with a copied set", () => {
    const existing = new Set<TestLabel>(["search"]);
    const current = new Map<TestNamespace, Set<TestLabel>>([["search", existing]]);
    const next = beginAction(current, "search", "ask");

    expect(existing.has("ask")).toBe(false);
    expect(next.get("search")).toEqual(new Set<TestLabel>(["search", "ask"]));
    expect(next.get("search")).not.toBe(existing);
  });
});

describe("endAction", () => {
  it("removes a label and keeps namespace when labels remain", () => {
    const current = new Map<TestNamespace, Set<TestLabel>>([
      ["search", new Set<TestLabel>(["search", "ask"])]
    ]);
    const next = endAction(current, "search", "ask");

    expect(next).not.toBe(current);
    expect(next.get("search")).toEqual(new Set<TestLabel>(["search"]));
  });

  it("removes namespace when the last label is removed", () => {
    const current = new Map<TestNamespace, Set<TestLabel>>([["project", new Set<TestLabel>(["createProject"])]]);
    const next = endAction(current, "project", "createProject");

    expect(next.has("project")).toBe(false);
  });

  it("returns original reference when namespace does not exist", () => {
    const current = new Map<TestNamespace, Set<TestLabel>>();
    const next = endAction(current, "search", "ask");
    expect(next).toBe(current);
  });

  it("returns a new map when namespace exists but label does not", () => {
    const current = new Map<TestNamespace, Set<TestLabel>>([["search", new Set<TestLabel>(["search"])]]);
    const next = endAction(current, "search", "ask");

    expect(next).not.toBe(current);
    expect(next.get("search")).toEqual(new Set<TestLabel>(["search"]));
  });
});
