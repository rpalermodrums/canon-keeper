import { describe, expect, it } from "vitest";
import {
  filterAndOrderCommandItems,
  fuzzyMatch,
  nextCommandIndexOnArrowDown,
  nextCommandIndexOnArrowUp
} from "./commandPaletteUtils";

type TestCommand = {
  id: string;
  label: string;
  subtitle: string;
  disabledReason?: string;
};

describe("fuzzyMatch", () => {
  it("matches case-insensitive subsequences", () => {
    expect(fuzzyMatch("Run Diagnostics", "rndi")).toBe(true);
    expect(fuzzyMatch("Resume Last Scene", "rls")).toBe(true);
  });

  it("returns false when query order cannot be satisfied", () => {
    expect(fuzzyMatch("Run Diagnostics", "zd")).toBe(false);
    expect(fuzzyMatch("Run Diagnostics", "drun")).toBe(false);
  });

  it("treats empty query as a match", () => {
    expect(fuzzyMatch("Any Command", "")).toBe(true);
  });
});

describe("nextCommandIndexOnArrowDown", () => {
  it("increments until the last item", () => {
    expect(nextCommandIndexOnArrowDown(0, 3)).toBe(1);
    expect(nextCommandIndexOnArrowDown(1, 3)).toBe(2);
    expect(nextCommandIndexOnArrowDown(2, 3)).toBe(2);
  });

  it("matches component behavior for empty result lists", () => {
    expect(nextCommandIndexOnArrowDown(0, 0)).toBe(-1);
  });
});

describe("nextCommandIndexOnArrowUp", () => {
  it("decrements until zero", () => {
    expect(nextCommandIndexOnArrowUp(2)).toBe(1);
    expect(nextCommandIndexOnArrowUp(1)).toBe(0);
    expect(nextCommandIndexOnArrowUp(0)).toBe(0);
  });
});

describe("filterAndOrderCommandItems", () => {
  const commands: TestCommand[] = [
    {
      id: "dashboard",
      label: "Dashboard",
      subtitle: "Project overview"
    },
    {
      id: "resume.issue",
      label: "Resume Last Issue",
      subtitle: "Return to your issue",
      disabledReason: "No recent issue yet"
    },
    {
      id: "search",
      label: "Search",
      subtitle: "Ask questions across your manuscript"
    }
  ];

  it("returns original list when query is blank", () => {
    expect(filterAndOrderCommandItems(commands, "")).toBe(commands);
    expect(filterAndOrderCommandItems(commands, "   ")).toBe(commands);
  });

  it("filters by label, subtitle, and disabled reason", () => {
    const byLabel = filterAndOrderCommandItems(commands, "dash");
    expect(byLabel).toEqual([commands[0]]);

    const bySubtitle = filterAndOrderCommandItems(commands, "manu");
    expect(bySubtitle).toEqual([commands[2]]);

    const byDisabledReason = filterAndOrderCommandItems(commands, "recent");
    expect(byDisabledReason).toEqual([commands[1]]);
  });

  it("preserves original ordering when multiple items match", () => {
    const ordered = filterAndOrderCommandItems(commands, "ss");
    expect(ordered).toEqual([commands[1], commands[2]]);
  });
});
