import { describe, expect, it } from "vitest";
import { decideBootAction, type ProjectSummaryLike } from "./bootDecision";
import type { SessionEnvelope } from "./persistence";

function createEnvelope(overrides?: Partial<SessionEnvelope["global"]>): SessionEnvelope {
  return {
    version: 1,
    global: {
      lastProjectRoot: null,
      lastProjectId: null,
      lastProjectName: null,
      activeSection: "dashboard",
      sidebarCollapsed: false,
      ...overrides
    },
    projects: {}
  };
}

const mockProject: ProjectSummaryLike = {
  id: "proj-123",
  root_path: "/Users/writer/my-novel",
  name: "My Novel"
};

describe("decideBootAction", () => {
  it("adopts current project when worker has an active project", () => {
    const envelope = createEnvelope({ lastProjectRoot: "/some/old/path" });
    const result = decideBootAction(mockProject, envelope);
    expect(result).toEqual({ action: "adopt-current", project: mockProject });
  });

  it("active worker project wins over persisted root", () => {
    const envelope = createEnvelope({
      lastProjectRoot: "/different/project",
      lastProjectId: "old-id",
      lastProjectName: "Old Project"
    });
    const result = decideBootAction(mockProject, envelope);
    expect(result.action).toBe("adopt-current");
    if (result.action === "adopt-current") {
      expect(result.project.id).toBe("proj-123");
    }
  });

  it("falls back to persisted root when no active project", () => {
    const envelope = createEnvelope({
      lastProjectRoot: "/Users/writer/old-novel",
      lastProjectId: "old-id",
      lastProjectName: "Old Novel"
    });
    const result = decideBootAction(null, envelope);
    expect(result).toEqual({ action: "restore-last", rootPath: "/Users/writer/old-novel" });
  });

  it("fresh start when no active project and no persisted root", () => {
    const envelope = createEnvelope();
    const result = decideBootAction(null, envelope);
    expect(result).toEqual({ action: "fresh-start" });
  });

  it("fresh start when persisted root is null", () => {
    const envelope = createEnvelope({ lastProjectRoot: null });
    const result = decideBootAction(null, envelope);
    expect(result).toEqual({ action: "fresh-start" });
  });

  it("fresh start when persisted root is empty string", () => {
    // Empty string is falsy, treated same as null
    const envelope = createEnvelope({ lastProjectRoot: "" as unknown as null });
    const result = decideBootAction(null, envelope);
    expect(result).toEqual({ action: "fresh-start" });
  });
});
