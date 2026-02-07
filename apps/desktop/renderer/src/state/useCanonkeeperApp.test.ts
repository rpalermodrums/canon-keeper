// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectSummary, WorkerStatus } from "../api/ipc";
import { useCanonkeeperApp } from "./useCanonkeeperApp";
import { DEFAULT_PROJECT_STATE, type SessionEnvelope } from "./persistence";

const STORAGE_KEY = "canonkeeper.session.v1";

const DEFAULT_STATUS: WorkerStatus = {
  state: "idle",
  phase: "idle",
  activeJobLabel: null,
  projectId: null,
  queueDepth: 0,
  lastSuccessfulRunAt: null,
  workerState: "ready",
  lastError: null
};

type CanonkeeperIpcMocks = {
  getCurrent: ReturnType<typeof vi.fn<[], Promise<ProjectSummary | null>>>;
  createOrOpen: ReturnType<typeof vi.fn<[payload: { rootPath: string; name?: string; createIfMissing?: boolean }], Promise<ProjectSummary | null>>>;
  getStatus: ReturnType<typeof vi.fn<[], Promise<WorkerStatus>>>;
  subscribeStatus: ReturnType<typeof vi.fn<[], Promise<WorkerStatus>>>;
  getProcessingState: ReturnType<typeof vi.fn<[], Promise<Array<{
    document_id: string;
    snapshot_id: string;
    stage: string;
    status: string;
    error: string | null;
    updated_at: number;
    document_path: string;
  }>>>>;
  getHistory: ReturnType<typeof vi.fn<[], Promise<{ snapshots: []; events: [] }>>>;
  getStats: ReturnType<typeof vi.fn<[], Promise<{
    totalPassages: number;
    totalDocuments: number;
    totalScenes: number;
    totalIssues: number;
  }>>>;
  getEvidenceCoverage: ReturnType<typeof vi.fn<[], Promise<{
    issues: { total: number; withEvidence: number };
    scenes: { total: number; withEvidence: number };
  }>>>;
  listScenes: ReturnType<typeof vi.fn<[], Promise<[]>>>;
  listIssues: ReturnType<typeof vi.fn<[], Promise<[]>>>;
  getStyleReport: ReturnType<typeof vi.fn<[], Promise<{ repetition: null; tone: []; dialogueTics: [] }>>>;
  listEntities: ReturnType<typeof vi.fn<[], Promise<[]>>>;
};

function createProjectSummary(id: string, rootPath: string): ProjectSummary {
  return {
    id,
    root_path: rootPath,
    name: `Project ${id}`,
    created_at: 1,
    updated_at: 1
  };
}

function createSessionEnvelope(
  globalOverrides: Partial<SessionEnvelope["global"]> = {},
  projects: SessionEnvelope["projects"] = {}
): SessionEnvelope {
  return {
    version: 1,
    global: {
      lastProjectRoot: null,
      lastProjectId: null,
      lastProjectName: null,
      activeSection: "dashboard",
      sidebarCollapsed: false,
      hasSeenWelcome: true,
      ...globalOverrides
    },
    projects
  };
}

function writeSessionEnvelope(envelope: SessionEnvelope): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
}

function readSessionEnvelope(): SessionEnvelope {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    throw new Error("Expected session envelope to exist in localStorage.");
  }
  return JSON.parse(raw) as SessionEnvelope;
}

function installLocalStorageMock(): void {
  const store = new Map<string, string>();
  const mockStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    }
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: mockStorage
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: mockStorage
  });
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolveRef: ((value: T | PromiseLike<T>) => void) | null = null;
  let rejectRef: ((reason?: unknown) => void) | null = null;
  const promise = new Promise<T>((resolve, reject) => {
    resolveRef = resolve;
    rejectRef = reject;
  });
  return {
    promise,
    resolve: (value) => {
      if (!resolveRef) {
        throw new Error("Deferred resolve function was not initialized.");
      }
      resolveRef(value);
    },
    reject: (reason) => {
      if (!rejectRef) {
        throw new Error("Deferred reject function was not initialized.");
      }
      rejectRef(reason);
    }
  };
}

function installCanonkeeperMock(): CanonkeeperIpcMocks {
  const pendingStatus = new Promise<WorkerStatus>(() => {});

  const getCurrent = vi.fn<[], Promise<ProjectSummary | null>>().mockResolvedValue(null);
  const createOrOpen = vi
    .fn<[payload: { rootPath: string; name?: string; createIfMissing?: boolean }], Promise<ProjectSummary | null>>()
    .mockResolvedValue(null);
  const getStatus = vi.fn<[], Promise<WorkerStatus>>().mockResolvedValue(DEFAULT_STATUS);
  const subscribeStatus = vi.fn<[], Promise<WorkerStatus>>().mockReturnValue(pendingStatus);
  const getProcessingState = vi
    .fn<[], Promise<Array<{
      document_id: string;
      snapshot_id: string;
      stage: string;
      status: string;
      error: string | null;
      updated_at: number;
      document_path: string;
    }>>>()
    .mockResolvedValue([]);
  const getHistory = vi.fn<[], Promise<{ snapshots: []; events: [] }>>().mockResolvedValue({
    snapshots: [],
    events: []
  });
  const getStats = vi
    .fn<[], Promise<{
      totalPassages: number;
      totalDocuments: number;
      totalScenes: number;
      totalIssues: number;
    }>>()
    .mockResolvedValue({
      totalPassages: 0,
      totalDocuments: 0,
      totalScenes: 0,
      totalIssues: 0
    });
  const getEvidenceCoverage = vi
    .fn<[], Promise<{
      issues: { total: number; withEvidence: number };
      scenes: { total: number; withEvidence: number };
    }>>()
    .mockResolvedValue({
      issues: { total: 0, withEvidence: 0 },
      scenes: { total: 0, withEvidence: 0 }
    });
  const listScenes = vi.fn<[], Promise<[]>>().mockResolvedValue([]);
  const listIssues = vi.fn<[], Promise<[]>>().mockResolvedValue([]);
  const getStyleReport = vi
    .fn<[], Promise<{ repetition: null; tone: []; dialogueTics: [] }>>()
    .mockResolvedValue({ repetition: null, tone: [], dialogueTics: [] });
  const listEntities = vi.fn<[], Promise<[]>>().mockResolvedValue([]);

  window.canonkeeper = {
    ping: vi.fn().mockResolvedValue({ ok: true }),
    getFixturePath: vi.fn().mockResolvedValue(null),
    dialog: {
      pickProjectRoot: vi.fn().mockResolvedValue(null),
      pickDocument: vi.fn().mockResolvedValue(null),
      pickExportDir: vi.fn().mockResolvedValue(null)
    },
    project: {
      createOrOpen,
      getCurrent,
      getStatus,
      subscribeStatus,
      getDiagnostics: vi.fn().mockResolvedValue({
        ipc: "ok",
        worker: "ok",
        sqlite: "ok",
        writable: "ok",
        details: [],
        recommendations: []
      }),
      getProcessingState,
      getHistory,
      addDocument: vi.fn().mockResolvedValue({
        documentId: "doc-1",
        snapshotId: "snap-1",
        snapshotCreated: true,
        chunksCreated: 0,
        chunksUpdated: 0,
        chunksDeleted: 0,
        changeStart: null,
        changeEnd: null
      }),
      stats: getStats,
      evidenceCoverage: getEvidenceCoverage
    },
    system: {
      healthCheck: vi.fn().mockResolvedValue({
        ipc: "ok",
        worker: "ok",
        sqlite: "ok",
        writable: "ok",
        details: []
      })
    },
    search: {
      ask: vi.fn().mockResolvedValue({ kind: "not_found", reason: "No matching evidence found." }),
      query: vi.fn().mockResolvedValue({ query: "", results: [] })
    },
    scenes: {
      list: listScenes,
      get: vi.fn().mockResolvedValue({
        scene: {
          id: "scene-1",
          project_id: "proj-1",
          document_id: "doc-1",
          ordinal: 1,
          start_chunk_id: "chunk-1",
          end_chunk_id: "chunk-2",
          start_char: 0,
          end_char: 10,
          title: null,
          pov_mode: "unknown",
          pov_entity_id: null,
          pov_confidence: null,
          setting_entity_id: null,
          setting_text: null
        },
        chunks: [],
        evidence: []
      })
    },
    issues: {
      list: listIssues,
      dismiss: vi.fn().mockResolvedValue({ ok: true }),
      undoDismiss: vi.fn().mockResolvedValue({ ok: true }),
      resolve: vi.fn().mockResolvedValue({ ok: true }),
      undoResolve: vi.fn().mockResolvedValue({ ok: true })
    },
    style: {
      getReport: getStyleReport
    },
    bible: {
      listEntities,
      getEntity: vi.fn().mockResolvedValue({
        entity: {
          id: "entity-1",
          project_id: "proj-1",
          type: "character",
          display_name: "Character",
          canonical_name: "Character",
          created_at: 1,
          updated_at: 1
        },
        claims: []
      })
    },
    canon: {
      confirmClaim: vi.fn().mockResolvedValue("claim-1")
    },
    export: {
      run: vi.fn().mockResolvedValue({ ok: true, files: [], elapsedMs: 0 })
    },
    jobs: {
      list: vi.fn().mockResolvedValue([]),
      cancel: vi.fn().mockResolvedValue({ ok: true })
    }
  } as unknown as NonNullable<Window["canonkeeper"]>;

  return {
    getCurrent,
    createOrOpen,
    getStatus,
    subscribeStatus,
    getProcessingState,
    getHistory,
    getStats,
    getEvidenceCoverage,
    listScenes,
    listIssues,
    getStyleReport,
    listEntities
  };
}

beforeEach(() => {
  installLocalStorageMock();
  localStorage.clear();
  vi.useRealTimers();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.clear();
  delete window.canonkeeper;
});

describe("useCanonkeeperApp boot sequence", () => {
  it("loads session envelope and adopts the worker's current project", async () => {
    const mocks = installCanonkeeperMock();
    const currentProject = createProjectSummary("proj-current", "/books/current");
    const savedProjectState = {
      ...DEFAULT_PROJECT_STATE,
      selectedSceneId: "scene-42"
    };

    writeSessionEnvelope(
      createSessionEnvelope(
        {
          activeSection: "scenes",
          sidebarCollapsed: true,
          lastProjectRoot: "/books/stale",
          lastProjectId: "proj-stale",
          lastProjectName: "Stale"
        },
        {
          [currentProject.id]: savedProjectState
        }
      )
    );

    mocks.getCurrent.mockResolvedValue(currentProject);

    const { result } = renderHook(() => useCanonkeeperApp());

    expect(result.current.bootState).toBe("booting");

    await waitFor(() => {
      expect(result.current.bootState).toBe("ready");
    });

    expect(result.current.project).toEqual(currentProject);
    expect(result.current.activeSection).toBe("scenes");
    expect(result.current.sidebarCollapsed).toBe(true);
    expect(result.current.selectedSceneId).toBe("scene-42");
    expect(mocks.createOrOpen).not.toHaveBeenCalled();

    const persisted = readSessionEnvelope();
    expect(persisted.global.lastProjectRoot).toBe("/books/current");
    expect(persisted.global.lastProjectId).toBe("proj-current");
    expect(persisted.global.lastProjectName).toBe("Project proj-current");
  });

  it("restores lastProjectRoot when worker has no active project", async () => {
    const mocks = installCanonkeeperMock();
    const restoredProject = createProjectSummary("proj-restored", "/books/restored");

    writeSessionEnvelope(
      createSessionEnvelope({
        lastProjectRoot: "/books/restored",
        lastProjectId: "proj-old",
        lastProjectName: "Old name"
      })
    );

    mocks.getCurrent.mockResolvedValue(null);
    mocks.createOrOpen.mockResolvedValue(restoredProject);

    const { result } = renderHook(() => useCanonkeeperApp());

    expect(result.current.bootState).toBe("booting");

    await waitFor(() => {
      expect(result.current.bootState).toBe("ready");
    });

    expect(mocks.createOrOpen).toHaveBeenCalledWith({
      rootPath: "/books/restored",
      createIfMissing: false
    });
    expect(result.current.project?.id).toBe("proj-restored");

    const persisted = readSessionEnvelope();
    expect(persisted.global.lastProjectRoot).toBe("/books/restored");
    expect(persisted.global.lastProjectId).toBe("proj-restored");
    expect(persisted.global.lastProjectName).toBe("Project proj-restored");
  });

  it("falls back to fresh start when there is no current project and no persisted root", async () => {
    const mocks = installCanonkeeperMock();
    writeSessionEnvelope(createSessionEnvelope());
    mocks.getCurrent.mockResolvedValue(null);

    const { result } = renderHook(() => useCanonkeeperApp());

    expect(result.current.bootState).toBe("booting");

    await waitFor(() => {
      expect(result.current.bootState).toBe("ready");
    });

    await waitFor(() => {
      expect(result.current.activeSection).toBe("setup");
    });

    expect(result.current.project).toBeNull();
    expect(mocks.createOrOpen).not.toHaveBeenCalled();
  });

  it("times out after 15s and skipBoot transitions to a fresh ready state", async () => {
    vi.useFakeTimers();
    const mocks = installCanonkeeperMock();
    const pendingCurrent = createDeferred<ProjectSummary | null>();
    writeSessionEnvelope(createSessionEnvelope());
    mocks.getCurrent.mockReturnValue(pendingCurrent.promise);

    const { result } = renderHook(() => useCanonkeeperApp());

    expect(result.current.bootState).toBe("booting");

    await act(async () => {
      vi.advanceTimersByTime(15_000);
      await Promise.resolve();
    });

    expect(result.current.bootState).toBe("restore-failed");
    expect(result.current.activeSection).toBe("setup");
    expect(result.current.bootError).toBe(
      "Restoring your last session timed out. You can start fresh or try again."
    );

    act(() => {
      result.current.skipBoot();
    });

    expect(result.current.bootState).toBe("ready");
    expect(result.current.bootError).toBeNull();
    expect(result.current.activeSection).toBe("setup");
  });

  it("guards boot effect against StrictMode double invocation", async () => {
    const mocks = installCanonkeeperMock();
    writeSessionEnvelope(createSessionEnvelope());
    mocks.getCurrent.mockResolvedValue(null);

    renderHook(() => useCanonkeeperApp(), {
      wrapper: ({ children }) => createElement(StrictMode, null, children)
    });

    await waitFor(() => {
      expect(mocks.getCurrent).toHaveBeenCalledTimes(1);
    });
  });

  it("cancels boot work after unmount and avoids hydration side effects", async () => {
    const mocks = installCanonkeeperMock();
    const deferredCurrent = createDeferred<ProjectSummary | null>();
    writeSessionEnvelope(createSessionEnvelope());
    mocks.getCurrent.mockReturnValue(deferredCurrent.promise);

    const { unmount } = renderHook(() => useCanonkeeperApp());
    unmount();

    await act(async () => {
      deferredCurrent.resolve(createProjectSummary("proj-late", "/books/late"));
      await Promise.resolve();
    });

    expect(mocks.getProcessingState).not.toHaveBeenCalled();
    expect(mocks.getHistory).not.toHaveBeenCalled();
    expect(mocks.createOrOpen).not.toHaveBeenCalled();
    expect(readSessionEnvelope().global.lastProjectRoot).toBeNull();
  });

  it("handles restore failure by clearing stale root and exposing recovery actions", async () => {
    const mocks = installCanonkeeperMock();
    writeSessionEnvelope(
      createSessionEnvelope({
        lastProjectRoot: "/books/missing",
        lastProjectId: "proj-missing",
        lastProjectName: "Missing Project"
      })
    );

    mocks.getCurrent.mockResolvedValue(null);
    mocks.createOrOpen.mockResolvedValue(null);

    const { result } = renderHook(() => useCanonkeeperApp());

    await waitFor(() => {
      expect(result.current.bootState).toBe("restore-failed");
    });

    expect(result.current.activeSection).toBe("setup");
    expect(result.current.bootError).toBe(
      "Could not restore your last project. The folder may have moved or been deleted."
    );
    expect(mocks.createOrOpen).toHaveBeenCalledWith({
      rootPath: "/books/missing",
      createIfMissing: false
    });

    const persisted = readSessionEnvelope();
    expect(persisted.global.lastProjectRoot).toBeNull();
    expect(persisted.global.lastProjectId).toBeNull();
    expect(persisted.global.lastProjectName).toBeNull();

    act(() => {
      result.current.clearBootError();
    });

    expect(result.current.bootState).toBe("ready");
    expect(result.current.bootError).toBeNull();
  });
});
