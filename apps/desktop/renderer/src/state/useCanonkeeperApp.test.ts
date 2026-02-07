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
  addDocument: ReturnType<
    typeof vi.fn<
      [payload: { path: string }],
      Promise<{
        documentId: string;
        snapshotId: string;
        snapshotCreated: boolean;
        chunksCreated: number;
        chunksUpdated: number;
        chunksDeleted: number;
        changeStart: number | null;
        changeEnd: number | null;
      }>
    >
  >;
  getStatus: ReturnType<typeof vi.fn<[], Promise<WorkerStatus>>>;
  subscribeStatus: ReturnType<typeof vi.fn<[], Promise<WorkerStatus>>>;
  getDiagnostics: ReturnType<
    typeof vi.fn<
      [],
      Promise<{
        ipc: "ok" | "down";
        worker: "ok" | "down";
        sqlite: "ok" | "missing_native" | "error";
        writable: "ok" | "error";
        details: string[];
        recommendations: string[];
      }>
    >
  >;
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
  querySearch: ReturnType<typeof vi.fn<[query: string], Promise<{ query: string; results: [] }>>>;
  askQuestion: ReturnType<typeof vi.fn<[question: string], Promise<{ kind: "not_found"; reason: string }>>>;
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

type MockUuid = `${string}-${string}-${string}-${string}-${string}`;

function buildMockUuid(index: number): MockUuid {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}` as MockUuid;
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
  const addDocument = vi
    .fn<
      [payload: { path: string }],
      Promise<{
        documentId: string;
        snapshotId: string;
        snapshotCreated: boolean;
        chunksCreated: number;
        chunksUpdated: number;
        chunksDeleted: number;
        changeStart: number | null;
        changeEnd: number | null;
      }>
    >()
    .mockResolvedValue({
      documentId: "doc-1",
      snapshotId: "snap-1",
      snapshotCreated: true,
      chunksCreated: 0,
      chunksUpdated: 0,
      chunksDeleted: 0,
      changeStart: null,
      changeEnd: null
    });
  const getStatus = vi.fn<[], Promise<WorkerStatus>>().mockResolvedValue(DEFAULT_STATUS);
  const subscribeStatus = vi.fn<[], Promise<WorkerStatus>>().mockReturnValue(pendingStatus);
  const getDiagnostics = vi
    .fn<
      [],
      Promise<{
        ipc: "ok" | "down";
        worker: "ok" | "down";
        sqlite: "ok" | "missing_native" | "error";
        writable: "ok" | "error";
        details: string[];
        recommendations: string[];
      }>
    >()
    .mockResolvedValue({
      ipc: "ok",
      worker: "ok",
      sqlite: "ok",
      writable: "ok",
      details: [],
      recommendations: []
    });
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
  const querySearch = vi.fn<[query: string], Promise<{ query: string; results: [] }>>().mockResolvedValue({
    query: "",
    results: []
  });
  const askQuestion = vi
    .fn<[question: string], Promise<{ kind: "not_found"; reason: string }>>()
    .mockResolvedValue({ kind: "not_found", reason: "No matching evidence found." });

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
      getDiagnostics,
      getProcessingState,
      getHistory,
      addDocument,
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
      ask: askQuestion,
      query: querySearch
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
    listEntities,
    addDocument,
    getDiagnostics,
    querySearch,
    askQuestion
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

describe("useCanonkeeperApp refreshProjectData safety net", () => {
  it("refreshes scenes, issues, style, and entities after document ingest", async () => {
    const mocks = installCanonkeeperMock();
    writeSessionEnvelope(createSessionEnvelope());
    mocks.getCurrent.mockResolvedValue(createProjectSummary("proj-refresh", "/books/refresh"));

    const { result } = renderHook(() => useCanonkeeperApp());
    await waitFor(() => {
      expect(result.current.bootState).toBe("ready");
    });

    const baselineScenes = mocks.listScenes.mock.calls.length;
    const baselineIssues = mocks.listIssues.mock.calls.length;
    const baselineStyle = mocks.getStyleReport.mock.calls.length;
    const baselineEntities = mocks.listEntities.mock.calls.length;

    act(() => {
      result.current.setDocPath("/books/refresh/chapter-1.md");
    });

    await act(async () => {
      await result.current.onAddDocument();
    });

    expect(mocks.addDocument).toHaveBeenCalledWith({ path: "/books/refresh/chapter-1.md" });
    expect(mocks.listScenes.mock.calls.length).toBe(baselineScenes + 1);
    expect(mocks.listIssues.mock.calls.length).toBe(baselineIssues + 2);
    expect(mocks.getStyleReport.mock.calls.length).toBe(baselineStyle + 1);
    expect(mocks.listEntities.mock.calls.length).toBe(baselineEntities + 1);
    expect(result.current.scenesLoaded).toBe(true);
    expect(result.current.issuesLoaded).toBe(true);
    expect(result.current.styleLoaded).toBe(true);
    expect(result.current.entitiesLoaded).toBe(true);
  });

  it("no-ops refresh when no project is open", async () => {
    const mocks = installCanonkeeperMock();
    writeSessionEnvelope(createSessionEnvelope());
    mocks.getCurrent.mockResolvedValue(null);

    const { result } = renderHook(() => useCanonkeeperApp());
    await waitFor(() => {
      expect(result.current.bootState).toBe("ready");
    });

    act(() => {
      result.current.setDocPath("/books/no-project/chapter-1.md");
    });

    await act(async () => {
      await result.current.onAddDocument();
    });

    expect(mocks.addDocument).toHaveBeenCalledWith({ path: "/books/no-project/chapter-1.md" });
    expect(mocks.listScenes).not.toHaveBeenCalled();
    expect(mocks.listIssues).not.toHaveBeenCalled();
    expect(mocks.getStyleReport).not.toHaveBeenCalled();
    expect(mocks.listEntities).not.toHaveBeenCalled();
  });

  it("continues invoking other refresh branches when one branch fails", async () => {
    const mocks = installCanonkeeperMock();
    writeSessionEnvelope(createSessionEnvelope());
    mocks.getCurrent.mockResolvedValue(createProjectSummary("proj-partial", "/books/partial"));

    const { result } = renderHook(() => useCanonkeeperApp());
    await waitFor(() => {
      expect(result.current.bootState).toBe("ready");
    });

    const baselineScenes = mocks.listScenes.mock.calls.length;
    const baselineIssues = mocks.listIssues.mock.calls.length;
    const baselineStyle = mocks.getStyleReport.mock.calls.length;
    const baselineEntities = mocks.listEntities.mock.calls.length;

    mocks.listScenes.mockRejectedValueOnce(new Error("Scene refresh failed"));

    act(() => {
      result.current.setDocPath("/books/partial/chapter-2.md");
    });

    await act(async () => {
      await result.current.onAddDocument();
    });

    expect(mocks.listScenes.mock.calls.length).toBe(baselineScenes + 1);
    expect(mocks.listIssues.mock.calls.length).toBe(baselineIssues + 2);
    expect(mocks.getStyleReport.mock.calls.length).toBe(baselineStyle + 1);
    expect(mocks.listEntities.mock.calls.length).toBe(baselineEntities + 1);
    await waitFor(() => {
      expect(result.current.errors).toHaveLength(1);
    });
    expect(result.current.errors[0]?.code).toBe("INGEST_FAILED");
  });
});

describe("useCanonkeeperApp error queue management", () => {
  it("enqueues an app error with a generated UUID", async () => {
    const mocks = installCanonkeeperMock();
    writeSessionEnvelope(createSessionEnvelope());
    mocks.getCurrent.mockResolvedValue(null);
    const uuidSpy = vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(buildMockUuid(1));
    mocks.querySearch.mockRejectedValueOnce(new Error("Search exploded"));

    const { result } = renderHook(() => useCanonkeeperApp());
    await waitFor(() => {
      expect(result.current.bootState).toBe("ready");
    });

    await act(async () => {
      await result.current.onSearch();
    });

    await waitFor(() => {
      expect(result.current.errors).toHaveLength(1);
    });
    expect(uuidSpy).toHaveBeenCalledTimes(1);
    expect(result.current.errors[0]?.id).toBe(buildMockUuid(1));
    expect(result.current.errors[0]?.code).toBe("SEARCH_FAILED");
  });

  it("evicts the oldest error when queue exceeds five items", async () => {
    const mocks = installCanonkeeperMock();
    writeSessionEnvelope(createSessionEnvelope());
    mocks.getCurrent.mockResolvedValue(null);
    const counter = { value: 0 };
    vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => {
      counter.value += 1;
      return buildMockUuid(counter.value);
    });

    const { result } = renderHook(() => useCanonkeeperApp());
    await waitFor(() => {
      expect(result.current.bootState).toBe("ready");
    });

    for (const index of [1, 2, 3, 4, 5, 6]) {
      mocks.querySearch.mockRejectedValueOnce(new Error(`Search failed ${index}`));
      await act(async () => {
        await result.current.onSearch();
      });
    }

    await waitFor(() => {
      expect(result.current.errors).toHaveLength(5);
    });
    expect(result.current.errors.map((error) => error.id)).toEqual([
      buildMockUuid(2),
      buildMockUuid(3),
      buildMockUuid(4),
      buildMockUuid(5),
      buildMockUuid(6)
    ]);
  });

  it("dismisses a specific error by id", async () => {
    const mocks = installCanonkeeperMock();
    writeSessionEnvelope(createSessionEnvelope());
    mocks.getCurrent.mockResolvedValue(null);
    const counter = { value: 0 };
    vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => {
      counter.value += 1;
      return buildMockUuid(counter.value);
    });

    const { result } = renderHook(() => useCanonkeeperApp());
    await waitFor(() => {
      expect(result.current.bootState).toBe("ready");
    });

    for (const index of [1, 2, 3]) {
      mocks.querySearch.mockRejectedValueOnce(new Error(`Search failed ${index}`));
      await act(async () => {
        await result.current.onSearch();
      });
    }

    act(() => {
      result.current.dismissError(buildMockUuid(2));
    });

    expect(result.current.errors.map((error) => error.id)).toEqual([
      buildMockUuid(1),
      buildMockUuid(3)
    ]);
  });

  it("does nothing when dismissing an unknown error id", async () => {
    const mocks = installCanonkeeperMock();
    writeSessionEnvelope(createSessionEnvelope());
    mocks.getCurrent.mockResolvedValue(null);
    const counter = { value: 0 };
    vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => {
      counter.value += 1;
      return buildMockUuid(counter.value);
    });

    const { result } = renderHook(() => useCanonkeeperApp());
    await waitFor(() => {
      expect(result.current.bootState).toBe("ready");
    });

    for (const index of [1, 2]) {
      mocks.querySearch.mockRejectedValueOnce(new Error(`Search failed ${index}`));
      await act(async () => {
        await result.current.onSearch();
      });
    }

    const before = result.current.errors.map((error) => error.id);
    act(() => {
      result.current.dismissError("missing-error-id");
    });
    expect(result.current.errors.map((error) => error.id)).toEqual(before);
  });

  it("tracks rapid error bursts up to the five-item cap", async () => {
    const mocks = installCanonkeeperMock();
    writeSessionEnvelope(createSessionEnvelope());
    mocks.getCurrent.mockResolvedValue(null);
    const counter = { value: 0 };
    vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => {
      counter.value += 1;
      return buildMockUuid(counter.value);
    });

    const { result } = renderHook(() => useCanonkeeperApp());
    await waitFor(() => {
      expect(result.current.bootState).toBe("ready");
    });

    for (const index of [1, 2, 3, 4, 5, 6, 7]) {
      mocks.querySearch.mockRejectedValueOnce(new Error(`Search failed ${index}`));
    }

    await act(async () => {
      await Promise.all([1, 2, 3, 4, 5, 6, 7].map(async () => result.current.onSearch()));
    });

    await waitFor(() => {
      expect(result.current.errors).toHaveLength(5);
    });
    expect(new Set(result.current.errors.map((error) => error.id)).size).toBe(5);
  });
});

describe("useCanonkeeperApp isBusy namespace tracking", () => {
  it("marks only the started namespace as busy", async () => {
    const mocks = installCanonkeeperMock();
    writeSessionEnvelope(createSessionEnvelope());
    mocks.getCurrent.mockResolvedValue(null);
    const searchDeferred = createDeferred<{ query: string; results: [] }>();
    mocks.querySearch.mockReturnValueOnce(searchDeferred.promise);

    const { result } = renderHook(() => useCanonkeeperApp());
    await waitFor(() => {
      expect(result.current.bootState).toBe("ready");
    });
    await waitFor(() => {
      expect(result.current.isBusy("system")).toBe(false);
    });

    act(() => {
      result.current.setSearchQuery("hero");
    });

    const searchRun = { promise: Promise.resolve() as Promise<void> };
    act(() => {
      searchRun.promise = result.current.onSearch();
    });

    await waitFor(() => {
      expect(result.current.isBusy("search")).toBe(true);
    });
    expect(result.current.isBusy("project")).toBe(false);

    searchDeferred.resolve({ query: "hero", results: [] });
    await act(async () => {
      await searchRun.promise;
    });

    expect(result.current.isBusy("search")).toBe(false);
    expect(result.current.isBusy("project")).toBe(false);
  });

  it("keeps namespace B busy after namespace A finishes", async () => {
    const mocks = installCanonkeeperMock();
    writeSessionEnvelope(createSessionEnvelope());
    mocks.getCurrent.mockResolvedValue(null);
    const searchDeferred = createDeferred<{ query: string; results: [] }>();
    const diagnosticsDeferred = createDeferred<{
      ipc: "ok" | "down";
      worker: "ok" | "down";
      sqlite: "ok" | "missing_native" | "error";
      writable: "ok" | "error";
      details: string[];
      recommendations: string[];
    }>();
    mocks.querySearch.mockReturnValueOnce(searchDeferred.promise);

    const { result } = renderHook(() => useCanonkeeperApp());
    await waitFor(() => {
      expect(result.current.bootState).toBe("ready");
    });
    await waitFor(() => {
      expect(result.current.isBusy("system")).toBe(false);
    });

    mocks.getDiagnostics.mockReturnValueOnce(diagnosticsDeferred.promise);

    const searchRun = { promise: Promise.resolve() as Promise<void> };
    act(() => {
      searchRun.promise = result.current.onSearch();
    });
    await waitFor(() => {
      expect(result.current.isBusy("search")).toBe(true);
    });

    const diagnosticsRun = { promise: Promise.resolve() as Promise<void> };
    act(() => {
      diagnosticsRun.promise = result.current.onRunDiagnostics();
    });
    await waitFor(() => {
      expect(result.current.isBusy("system")).toBe(true);
    });

    searchDeferred.resolve({ query: "", results: [] });
    await act(async () => {
      await searchRun.promise;
    });

    expect(result.current.isBusy("search")).toBe(false);
    expect(result.current.isBusy("system")).toBe(true);

    diagnosticsDeferred.resolve({
      ipc: "ok",
      worker: "ok",
      sqlite: "ok",
      writable: "ok",
      details: [],
      recommendations: []
    });
    await act(async () => {
      await diagnosticsRun.promise;
    });

    expect(result.current.isBusy("system")).toBe(false);
  });

  it("returns false after all actions in a namespace have ended", async () => {
    const mocks = installCanonkeeperMock();
    writeSessionEnvelope(createSessionEnvelope());
    mocks.getCurrent.mockResolvedValue(null);
    const createProjectDeferred = createDeferred<ProjectSummary | null>();
    mocks.createOrOpen.mockReturnValueOnce(createProjectDeferred.promise);

    const { result } = renderHook(() => useCanonkeeperApp());
    await waitFor(() => {
      expect(result.current.bootState).toBe("ready");
    });
    await waitFor(() => {
      expect(result.current.isBusy("system")).toBe(false);
    });

    act(() => {
      result.current.setRootPath("/books/new-project");
    });

    const createRun = { promise: Promise.resolve() as Promise<void> };
    act(() => {
      createRun.promise = result.current.onCreateProject();
    });

    await waitFor(() => {
      expect(result.current.isBusy("project")).toBe(true);
    });

    createProjectDeferred.resolve(createProjectSummary("proj-new", "/books/new-project"));
    await act(async () => {
      await createRun.promise;
    });

    expect(result.current.isBusy("project")).toBe(false);
  });

  it("stays busy for shared namespace until all labels complete", async () => {
    const mocks = installCanonkeeperMock();
    writeSessionEnvelope(createSessionEnvelope());
    mocks.getCurrent.mockResolvedValue(null);
    const searchDeferred = createDeferred<{ query: string; results: [] }>();
    const askDeferred = createDeferred<{ kind: "not_found"; reason: string }>();
    mocks.querySearch.mockReturnValueOnce(searchDeferred.promise);
    mocks.askQuestion.mockReturnValueOnce(askDeferred.promise);

    const { result } = renderHook(() => useCanonkeeperApp());
    await waitFor(() => {
      expect(result.current.bootState).toBe("ready");
    });
    await waitFor(() => {
      expect(result.current.isBusy("system")).toBe(false);
    });

    act(() => {
      result.current.setSearchQuery("artifact");
      result.current.setQuestionText("Where is the artifact?");
    });

    const searchRun = { promise: Promise.resolve() as Promise<void> };
    act(() => {
      searchRun.promise = result.current.onSearch();
    });
    const askRun = { promise: Promise.resolve() as Promise<void> };
    act(() => {
      askRun.promise = result.current.onAsk();
    });

    await waitFor(() => {
      expect(result.current.isBusy("search")).toBe(true);
    });

    searchDeferred.resolve({ query: "artifact", results: [] });
    await act(async () => {
      await searchRun.promise;
    });
    expect(result.current.isBusy("search")).toBe(true);

    askDeferred.resolve({ kind: "not_found", reason: "No matching evidence found." });
    await act(async () => {
      await askRun.promise;
    });
    expect(result.current.isBusy("search")).toBe(false);
  });
});

describe("useCanonkeeperApp evidence drawer state", () => {
  it("opens evidence drawer with provided content", async () => {
    const mocks = installCanonkeeperMock();
    writeSessionEnvelope(createSessionEnvelope());
    mocks.getCurrent.mockResolvedValue(null);

    const { result } = renderHook(() => useCanonkeeperApp());
    await waitFor(() => {
      expect(result.current.bootState).toBe("ready");
    });

    const evidence = [
      {
        chunkId: "chunk-10",
        documentPath: "/books/story.md",
        chunkOrdinal: 10,
        quoteStart: 5,
        quoteEnd: 18,
        excerpt: "Captain Ren drew the map.",
        lineStart: 12,
        lineEnd: 13
      }
    ];

    act(() => {
      result.current.openEvidence("Map mention", evidence, { source: "issue", sourceId: "issue-10" });
    });

    expect(result.current.evidenceDrawer.open).toBe(true);
    expect(result.current.evidenceDrawer.title).toBe("Map mention");
    expect(result.current.evidenceDrawer.evidence).toEqual(evidence);
    expect(result.current.activeEvidenceContext).toEqual({
      source: "issue",
      sourceId: "issue-10",
      evidenceId: "chunk-10:5:18"
    });
  });

  it("closes evidence drawer and clears active context", async () => {
    const mocks = installCanonkeeperMock();
    writeSessionEnvelope(createSessionEnvelope());
    mocks.getCurrent.mockResolvedValue(null);

    const { result } = renderHook(() => useCanonkeeperApp());
    await waitFor(() => {
      expect(result.current.bootState).toBe("ready");
    });

    const evidence = [
      {
        chunkId: "chunk-11",
        documentPath: "/books/story.md",
        chunkOrdinal: 11,
        quoteStart: 3,
        quoteEnd: 11,
        excerpt: "Night fell quickly.",
        lineStart: 22,
        lineEnd: 22
      }
    ];

    act(() => {
      result.current.openEvidence("Night note", evidence, { source: "style", sourceId: "metric-1" });
    });
    act(() => {
      result.current.closeEvidence();
    });

    expect(result.current.evidenceDrawer.open).toBe(false);
    expect(result.current.activeEvidenceContext).toBeNull();
  });

  it("toggles evidence pin state", async () => {
    const mocks = installCanonkeeperMock();
    writeSessionEnvelope(createSessionEnvelope());
    mocks.getCurrent.mockResolvedValue(null);

    const { result } = renderHook(() => useCanonkeeperApp());
    await waitFor(() => {
      expect(result.current.bootState).toBe("ready");
    });

    expect(result.current.evidencePinned).toBe(false);

    act(() => {
      result.current.setEvidencePinned(true);
    });
    expect(result.current.evidencePinned).toBe(true);

    act(() => {
      result.current.setEvidencePinned(false);
    });
    expect(result.current.evidencePinned).toBe(false);
  });

  it("replaces evidence content when opening another item while pinned", async () => {
    const mocks = installCanonkeeperMock();
    writeSessionEnvelope(createSessionEnvelope());
    mocks.getCurrent.mockResolvedValue(null);

    const { result } = renderHook(() => useCanonkeeperApp());
    await waitFor(() => {
      expect(result.current.bootState).toBe("ready");
    });

    const firstEvidence = [
      {
        chunkId: "chunk-20",
        documentPath: "/books/story.md",
        chunkOrdinal: 20,
        quoteStart: 0,
        quoteEnd: 9,
        excerpt: "First clue",
        lineStart: 1,
        lineEnd: 1
      }
    ];
    const secondEvidence = [
      {
        chunkId: "chunk-21",
        documentPath: "/books/story.md",
        chunkOrdinal: 21,
        quoteStart: 2,
        quoteEnd: 14,
        excerpt: "Second clue appears",
        lineStart: 2,
        lineEnd: 3
      }
    ];

    act(() => {
      result.current.setEvidencePinned(true);
      result.current.openEvidence("First", firstEvidence, { source: "scene", sourceId: "scene-1" });
    });
    act(() => {
      result.current.openEvidence("Second", secondEvidence, { source: "claim", sourceId: "claim-1" });
    });

    expect(result.current.evidencePinned).toBe(true);
    expect(result.current.evidenceDrawer.open).toBe(true);
    expect(result.current.evidenceDrawer.title).toBe("Second");
    expect(result.current.evidenceDrawer.evidence).toEqual(secondEvidence);
    expect(result.current.evidenceDrawer.source).toBe("claim");
    expect(result.current.evidenceDrawer.sourceId).toBe("claim-1");
  });
});
