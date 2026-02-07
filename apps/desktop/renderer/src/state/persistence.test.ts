import { describe, expect, it } from "vitest";
import {
  type SessionEnvelope,
  type StorageBackend,
  DEFAULT_PROJECT_STATE,
  clearProjectState,
  clearSession,
  getProjectState,
  loadSession,
  migrateFromLegacy,
  saveSession,
  setGlobalState,
  setProjectState
} from "./persistence";

function createMockStorage(initial: Record<string, string> = {}): StorageBackend {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    }
  };
}

function createValidEnvelope(overrides?: Partial<SessionEnvelope>): SessionEnvelope {
  return {
    version: 1,
    global: {
      lastProjectRoot: null,
      lastProjectId: null,
      lastProjectName: null,
      activeSection: "dashboard",
      sidebarCollapsed: false
    },
    projects: {},
    ...overrides
  };
}

describe("persistence", () => {
  describe("loadSession", () => {
    it("returns default envelope when storage is empty", () => {
      const storage = createMockStorage();
      const envelope = loadSession(storage);
      expect(envelope.version).toBe(1);
      expect(envelope.global.activeSection).toBe("dashboard");
      expect(envelope.global.sidebarCollapsed).toBe(false);
      expect(envelope.global.lastProjectRoot).toBe(null);
      expect(envelope.projects).toEqual({});
    });

    it("returns parsed envelope when valid data exists", () => {
      const stored = createValidEnvelope({
        global: {
          lastProjectRoot: "/some/path",
          lastProjectId: "abc",
          lastProjectName: "Test",
          activeSection: "scenes",
          sidebarCollapsed: true
        },
        projects: { abc: { ...DEFAULT_PROJECT_STATE, selectedSceneId: "s1" } }
      });
      const storage = createMockStorage({
        "canonkeeper.session.v1": JSON.stringify(stored)
      });
      const envelope = loadSession(storage);
      expect(envelope.global.lastProjectRoot).toBe("/some/path");
      expect(envelope.global.activeSection).toBe("scenes");
      expect(envelope.projects["abc"]?.selectedSceneId).toBe("s1");
    });

    it("returns default envelope on corrupt JSON", () => {
      const storage = createMockStorage({
        "canonkeeper.session.v1": "{broken json!!"
      });
      const envelope = loadSession(storage);
      expect(envelope.version).toBe(1);
      expect(envelope.global.activeSection).toBe("dashboard");
      expect(envelope.projects).toEqual({});
    });

    it("returns default envelope when version is wrong", () => {
      const storage = createMockStorage({
        "canonkeeper.session.v1": JSON.stringify({ version: 99, global: {}, projects: {} })
      });
      const envelope = loadSession(storage);
      expect(envelope.version).toBe(1);
      expect(envelope.global.activeSection).toBe("dashboard");
    });
  });

  describe("saveSession", () => {
    it("writes valid JSON to storage", () => {
      const storage = createMockStorage();
      const envelope = createValidEnvelope({
        global: {
          lastProjectRoot: "/test",
          lastProjectId: "id1",
          lastProjectName: "Test",
          activeSection: "issues",
          sidebarCollapsed: true
        }
      });
      saveSession(envelope, storage);
      const raw = storage.getItem("canonkeeper.session.v1");
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!) as SessionEnvelope;
      expect(parsed.version).toBe(1);
      expect(parsed.global.activeSection).toBe("issues");
      expect(parsed.global.lastProjectRoot).toBe("/test");
    });
  });

  describe("getProjectState", () => {
    it("returns defaults for unknown project ID", () => {
      const envelope = createValidEnvelope();
      const state = getProjectState(envelope, "unknown-id");
      expect(state).toEqual(DEFAULT_PROJECT_STATE);
    });

    it("returns stored state for known project", () => {
      const customState = {
        ...DEFAULT_PROJECT_STATE,
        selectedSceneId: "scene-42",
        issueFilters: { ...DEFAULT_PROJECT_STATE.issueFilters, status: "dismissed" }
      };
      const envelope = createValidEnvelope({
        projects: { "proj-1": customState }
      });
      const state = getProjectState(envelope, "proj-1");
      expect(state.selectedSceneId).toBe("scene-42");
      expect(state.issueFilters.status).toBe("dismissed");
    });

    it("adopts legacy state when no entry exists for project", () => {
      const legacyState = { ...DEFAULT_PROJECT_STATE, selectedIssueId: "legacy-issue" };
      const envelope = createValidEnvelope({
        projects: { _legacy: legacyState }
      });
      const state = getProjectState(envelope, "new-project-id");
      expect(state.selectedIssueId).toBe("legacy-issue");
    });
  });

  describe("setProjectState", () => {
    it("merges partial state immutably", () => {
      const envelope = createValidEnvelope({
        projects: {
          "proj-1": { ...DEFAULT_PROJECT_STATE, selectedSceneId: "s1" }
        }
      });
      const updated = setProjectState(envelope, "proj-1", { selectedSceneId: "s2" });
      // Original unchanged
      expect(envelope.projects["proj-1"]?.selectedSceneId).toBe("s1");
      // New envelope has merged value
      expect(updated.projects["proj-1"]?.selectedSceneId).toBe("s2");
      // Other fields preserved
      expect(updated.projects["proj-1"]?.issueFilters).toEqual(DEFAULT_PROJECT_STATE.issueFilters);
    });

    it("creates new project entry when project does not exist", () => {
      const envelope = createValidEnvelope();
      const updated = setProjectState(envelope, "new-proj", { selectedEntityId: "e1" });
      expect(updated.projects["new-proj"]?.selectedEntityId).toBe("e1");
      expect(updated.projects["new-proj"]?.selectedSceneId).toBe("");
    });

    it("consumes legacy state after first project adoption", () => {
      const legacyState = { ...DEFAULT_PROJECT_STATE, selectedIssueId: "legacy-issue" };
      const envelope = createValidEnvelope({
        projects: { _legacy: legacyState }
      });
      const adopted = setProjectState(envelope, "proj-1", legacyState);
      expect(adopted.projects["_legacy"]).toBeUndefined();
      expect(adopted.projects["proj-1"]?.selectedIssueId).toBe("legacy-issue");
      expect(getProjectState(adopted, "proj-2")).toEqual(DEFAULT_PROJECT_STATE);
    });
  });

  describe("setGlobalState", () => {
    it("merges global state immutably", () => {
      const envelope = createValidEnvelope();
      const updated = setGlobalState(envelope, { activeSection: "bible", sidebarCollapsed: true });
      // Original unchanged
      expect(envelope.global.activeSection).toBe("dashboard");
      expect(envelope.global.sidebarCollapsed).toBe(false);
      // New envelope has merged values
      expect(updated.global.activeSection).toBe("bible");
      expect(updated.global.sidebarCollapsed).toBe(true);
      // Unset fields preserved
      expect(updated.global.lastProjectRoot).toBe(null);
    });
  });

  describe("clearProjectState", () => {
    it("removes project entry", () => {
      const envelope = createValidEnvelope({
        projects: {
          "proj-1": { ...DEFAULT_PROJECT_STATE },
          "proj-2": { ...DEFAULT_PROJECT_STATE }
        }
      });
      const updated = clearProjectState(envelope, "proj-1");
      expect(updated.projects["proj-1"]).toBeUndefined();
      expect(updated.projects["proj-2"]).toBeDefined();
      // Original unchanged
      expect(envelope.projects["proj-1"]).toBeDefined();
    });
  });

  describe("clearSession", () => {
    it("removes envelope from storage", () => {
      const storage = createMockStorage({
        "canonkeeper.session.v1": JSON.stringify(createValidEnvelope())
      });
      expect(storage.getItem("canonkeeper.session.v1")).not.toBeNull();
      clearSession(storage);
      expect(storage.getItem("canonkeeper.session.v1")).toBeNull();
    });
  });

  describe("migrateFromLegacy", () => {
    it("reads all legacy keys and builds envelope", () => {
      const storage = createMockStorage({
        "canonkeeper.activeSection": JSON.stringify("issues"),
        "canonkeeper.sidebarCollapsed": JSON.stringify(true),
        "canonkeeper.issueFilters": JSON.stringify({ status: "dismissed", severity: "high", type: "", query: "", sort: "severity" }),
        "canonkeeper.entityFilters": JSON.stringify({ type: "character", status: "confirmed", query: "hero" }),
        "canonkeeper.selectedSceneId": JSON.stringify("scene-1"),
        "canonkeeper.selectedIssueId": JSON.stringify("issue-2"),
        "canonkeeper.selectedEntityId": JSON.stringify("entity-3"),
        "canonkeeper.continueContext": JSON.stringify({ issueId: "i1", entityId: "e1", sceneId: "s1" })
      });

      const envelope = migrateFromLegacy(storage);
      expect(envelope).not.toBeNull();
      expect(envelope!.global.activeSection).toBe("issues");
      expect(envelope!.global.sidebarCollapsed).toBe(true);
      const projectState = envelope!.projects["_legacy"];
      expect(projectState).toBeDefined();
      expect(projectState!.issueFilters.status).toBe("dismissed");
      expect(projectState!.entityFilters.type).toBe("character");
      expect(projectState!.selectedSceneId).toBe("scene-1");
      expect(projectState!.selectedIssueId).toBe("issue-2");
      expect(projectState!.selectedEntityId).toBe("entity-3");
      expect(projectState!.continueContext.issueId).toBe("i1");
    });

    it("returns null when no legacy keys exist", () => {
      const storage = createMockStorage();
      const result = migrateFromLegacy(storage);
      expect(result).toBeNull();
    });

    it("handles partial legacy keys gracefully", () => {
      const storage = createMockStorage({
        "canonkeeper.activeSection": JSON.stringify("search")
      });
      const envelope = migrateFromLegacy(storage);
      expect(envelope).not.toBeNull();
      expect(envelope!.global.activeSection).toBe("search");
      const projectState = envelope!.projects["_legacy"];
      expect(projectState).toBeDefined();
      // Defaults for missing keys
      expect(projectState!.selectedSceneId).toBe("");
      expect(projectState!.issueFilters.status).toBe("open");
    });

    it("cleans up legacy keys after migration", () => {
      const storage = createMockStorage({
        "canonkeeper.activeSection": JSON.stringify("dashboard"),
        "canonkeeper.sidebarCollapsed": JSON.stringify(false),
        "canonkeeper.selectedSceneId": JSON.stringify("s1")
      });
      migrateFromLegacy(storage);
      expect(storage.getItem("canonkeeper.activeSection")).toBeNull();
      expect(storage.getItem("canonkeeper.sidebarCollapsed")).toBeNull();
      expect(storage.getItem("canonkeeper.selectedSceneId")).toBeNull();
    });
  });
});
