import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { WorkerClient } from "./worker/client";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let workerClient: WorkerClient | null = null;

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
  workerClient = new WorkerClient();
  createWindow();

  ipcMain.handle("app:ping", () => ({ ok: true }));
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
    if (workerState !== "ready") {
      return {
        state: "idle",
        lastJob: undefined,
        projectId: null,
        queueDepth: 0,
        workerState,
        lastError: workerClient.getLastError()
      };
    }
    const status = (await workerClient.request("project.getStatus")) as Record<string, unknown>;
    return {
      ...status,
      workerState,
      lastError: workerClient.getLastError()
    };
  });
  ipcMain.handle("project:getProcessingState", async () => {
    if (!workerClient) {
      throw new Error("Worker not initialized");
    }
    return workerClient.request("project.getProcessingState");
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
  ipcMain.handle("issues:dismiss", async (_event, payload) => {
    if (!workerClient) {
      throw new Error("Worker not initialized");
    }
    return workerClient.request("issues.dismiss", payload);
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
