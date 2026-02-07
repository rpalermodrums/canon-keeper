import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { WorkerClient } from "./worker/client";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let workerClient: WorkerClient | null = null;

type WorkerStatusPayload = {
  state: "idle" | "busy";
  phase: "idle" | "ingest" | "extract" | "style" | "continuity" | "export" | "error";
  lastJob?: string;
  activeJobLabel: string | null;
  projectId: string | null;
  queueDepth: number;
  workerState: "ready" | "restarting" | "down";
  lastSuccessfulRunAt: string | null;
  lastError: { subsystem: string; message: string } | null;
};

type DiagnosticsPayload = {
  ipc: "ok" | "down";
  worker: "ok" | "down";
  sqlite: "ok" | "missing_native" | "error";
  writable: "ok" | "error";
  details: string[];
  recommendations: string[];
};

function coerceWorkerStatus(
  workerState: "ready" | "restarting" | "down",
  rawStatus: Record<string, unknown> | null,
  runtimeError: string | null
): WorkerStatusPayload {
  const source = rawStatus ?? {};
  const structuredError =
    source.lastError && typeof source.lastError === "object"
      ? (source.lastError as { subsystem: string; message: string })
      : runtimeError
        ? { subsystem: "worker", message: runtimeError }
        : null;

  const state =
    workerState === "restarting"
      ? "busy"
      : source.state === "busy"
        ? "busy"
        : "idle";

  return {
    state,
    phase:
      workerState === "down"
        ? "error"
        : source.phase === "ingest" ||
            source.phase === "extract" ||
            source.phase === "style" ||
            source.phase === "continuity" ||
            source.phase === "export" ||
            source.phase === "error"
          ? source.phase
          : "idle",
    lastJob: typeof source.lastJob === "string" ? source.lastJob : undefined,
    activeJobLabel: typeof source.activeJobLabel === "string" ? source.activeJobLabel : null,
    projectId: typeof source.projectId === "string" ? source.projectId : null,
    queueDepth: typeof source.queueDepth === "number" ? source.queueDepth : 0,
    workerState,
    lastSuccessfulRunAt:
      typeof source.lastSuccessfulRunAt === "string" ? source.lastSuccessfulRunAt : null,
    lastError: structuredError
  };
}

function installDevtoolsConsoleNoiseFilter(): void {
  // Chromium devtools may emit unsupported protocol warnings in Electron dev mode.
  app.on("web-contents-created", (_event, contents) => {
    contents.on("console-message", (event, _level, message, _line, sourceId) => {
      const isDevtoolsSource = typeof sourceId === "string" && sourceId.startsWith("devtools://");
      const isAutofillWarning =
        typeof message === "string" &&
        message.includes("Request Autofill.enable failed") &&
        message.includes("'Autofill.enable' wasn't found");
      if (isDevtoolsSource && isAutofillWarning) {
        event.preventDefault();
      }
    });
  });
}

function getPreloadPath(): string | undefined {
  const devCandidate = path.join(process.cwd(), "dist-electron", "preload.js");
  if (process.env.VITE_DEV_SERVER_URL && fs.existsSync(devCandidate)) {
    return devCandidate;
  }
  const candidate = path.join(__dirname, "preload.js");
  return fs.existsSync(candidate) ? candidate : undefined;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: getPreloadPath()
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    const indexPath = path.join(__dirname, "../dist-renderer/index.html");
    void mainWindow.loadFile(indexPath);
  }
}

app.whenReady().then(() => {
  installDevtoolsConsoleNoiseFilter();
  workerClient = new WorkerClient();
  createWindow();

  ipcMain.handle("app:ping", () => ({ ok: true }));
  ipcMain.handle("app:getFixturePath", () => {
    const fixturePath = path.join(process.cwd(), "data", "fixtures", "simple_md.md");
    return fs.existsSync(fixturePath) ? fixturePath : null;
  });
  ipcMain.handle("dialog:pickProjectRoot", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0] ?? null;
  });
  ipcMain.handle("dialog:pickDocument", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "Manuscripts", extensions: ["md", "txt", "docx"] }]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0] ?? null;
  });
  ipcMain.handle("dialog:pickExportDir", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0] ?? null;
  });
  ipcMain.handle("project:createOrOpen", async (_event, payload) => {
    if (!workerClient) {
      throw new Error("Worker not initialized");
    }
    return workerClient.request("project.createOrOpen", payload);
  });
  ipcMain.handle("project:getStatus", async () => {
    if (!workerClient) {
      throw new Error("Worker not initialized");
    }
    const workerState = workerClient.getState();
    const runtimeError = workerClient.getLastError();
    const status =
      workerState === "ready"
        ? ((await workerClient.request("project.getStatus")) as Record<string, unknown>)
        : null;
    return coerceWorkerStatus(workerState, status, runtimeError);
  });
  ipcMain.handle("project:subscribeStatus", async () => {
    if (!workerClient) {
      throw new Error("Worker not initialized");
    }
    const workerState = workerClient.getState();
    const runtimeError = workerClient.getLastError();
    const status =
      workerState === "ready"
        ? ((await workerClient.request("project.subscribeStatus")) as Record<string, unknown>)
        : null;
    return coerceWorkerStatus(workerState, status, runtimeError);
  });
  ipcMain.handle("project:getDiagnostics", async () => {
    if (!workerClient) {
      throw new Error("Worker not initialized");
    }
    const workerState = workerClient.getState();
    if (workerState !== "ready") {
      const runtimeError = workerClient.getLastError();
      const details = runtimeError ? [runtimeError] : ["Worker process is unavailable."];
      return {
        ipc: "ok",
        worker: "down",
        sqlite: "error",
        writable: "error",
        details,
        recommendations: [
          "Restart CanonKeeper to recover the worker process.",
          "Run diagnostics again after the worker reconnects."
        ]
      } as DiagnosticsPayload;
    }
    const diagnostics = (await workerClient.request("project.getDiagnostics")) as Record<
      string,
      unknown
    >;
    return {
      ipc: diagnostics.ipc === "down" ? "down" : "ok",
      worker: diagnostics.worker === "down" ? "down" : "ok",
      sqlite:
        diagnostics.sqlite === "missing_native" || diagnostics.sqlite === "error"
          ? diagnostics.sqlite
          : "ok",
      writable: diagnostics.writable === "error" ? "error" : "ok",
      details: Array.isArray(diagnostics.details)
        ? diagnostics.details.filter((detail): detail is string => typeof detail === "string")
        : [],
      recommendations: Array.isArray(diagnostics.recommendations)
        ? diagnostics.recommendations.filter((detail): detail is string => typeof detail === "string")
        : []
    } as DiagnosticsPayload;
  });
  ipcMain.handle("system:healthCheck", async () => {
    if (!workerClient) {
      throw new Error("Worker not initialized");
    }
    return workerClient.request("system.healthCheck");
  });
  ipcMain.handle("project:getProcessingState", async () => {
    if (!workerClient) {
      throw new Error("Worker not initialized");
    }
    return workerClient.request("project.getProcessingState");
  });
  ipcMain.handle("project:getHistory", async () => {
    if (!workerClient) {
      throw new Error("Worker not initialized");
    }
    return workerClient.request("project.getHistory");
  });
  ipcMain.handle("project:stats", async () => {
    if (!workerClient) {
      throw new Error("Worker not initialized");
    }
    return workerClient.request("project.stats");
  });
  ipcMain.handle("project:evidenceCoverage", async () => {
    if (!workerClient) {
      throw new Error("Worker not initialized");
    }
    return workerClient.request("project.evidenceCoverage");
  });
  ipcMain.handle("project:addDocument", async (_event, payload) => {
    if (!workerClient) {
      throw new Error("Worker not initialized");
    }
    return workerClient.request("project.addDocument", payload);
  });
  ipcMain.handle("search:ask", async (_event, payload) => {
    if (!workerClient) {
      throw new Error("Worker not initialized");
    }
    return workerClient.request("search.ask", payload);
  });
  ipcMain.handle("search:query", async (_event, payload) => {
    if (!workerClient) {
      throw new Error("Worker not initialized");
    }
    return workerClient.request("search.query", payload);
  });
  ipcMain.handle("scenes:list", async () => {
    if (!workerClient) {
      throw new Error("Worker not initialized");
    }
    return workerClient.request("scenes.list");
  });
  ipcMain.handle("scenes:get", async (_event, payload) => {
    if (!workerClient) {
      throw new Error("Worker not initialized");
    }
    return workerClient.request("scenes.get", payload);
  });
  ipcMain.handle("issues:list", async () => {
    if (!workerClient) {
      throw new Error("Worker not initialized");
    }
    return workerClient.request("issues.list");
  });
  ipcMain.handle("issues:listFiltered", async (_event, payload) => {
    if (!workerClient) {
      throw new Error("Worker not initialized");
    }
    return workerClient.request("issues.list", payload);
  });
  ipcMain.handle("issues:dismiss", async (_event, payload) => {
    if (!workerClient) {
      throw new Error("Worker not initialized");
    }
    return workerClient.request("issues.dismiss", payload);
  });
  ipcMain.handle("issues:undoDismiss", async (_event, payload) => {
    if (!workerClient) {
      throw new Error("Worker not initialized");
    }
    return workerClient.request("issues.undoDismiss", payload);
  });
  ipcMain.handle("issues:resolve", async (_event, payload) => {
    if (!workerClient) {
      throw new Error("Worker not initialized");
    }
    return workerClient.request("issues.resolve", payload);
  });
  ipcMain.handle("issues:undoResolve", async (_event, payload) => {
    if (!workerClient) {
      throw new Error("Worker not initialized");
    }
    return workerClient.request("issues.undoResolve", payload);
  });
  ipcMain.handle("style:getReport", async () => {
    if (!workerClient) {
      throw new Error("Worker not initialized");
    }
    return workerClient.request("style.getReport");
  });
  ipcMain.handle("bible:listEntities", async () => {
    if (!workerClient) {
      throw new Error("Worker not initialized");
    }
    return workerClient.request("bible.listEntities");
  });
  ipcMain.handle("bible:getEntity", async (_event, payload) => {
    if (!workerClient) {
      throw new Error("Worker not initialized");
    }
    return workerClient.request("bible.getEntity", payload);
  });
  ipcMain.handle("canon:confirmClaim", async (_event, payload) => {
    if (!workerClient) {
      throw new Error("Worker not initialized");
    }
    return workerClient.request("canon.confirmClaim", payload);
  });
  ipcMain.handle("export:run", async (_event, payload) => {
    if (!workerClient) {
      throw new Error("Worker not initialized");
    }
    return workerClient.request("export.run", payload);
  });
  ipcMain.handle("jobs:list", async () => {
    if (!workerClient) {
      throw new Error("Worker not initialized");
    }
    return workerClient.request("jobs.list");
  });
  ipcMain.handle("jobs:cancel", async (_event, payload) => {
    if (!workerClient) {
      throw new Error("Worker not initialized");
    }
    return workerClient.request("jobs.cancel", payload);
  });

  app.on("activate", () => {
    if (mainWindow === null || BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
