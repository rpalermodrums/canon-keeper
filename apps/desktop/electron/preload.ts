import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("canonkeeper", {
  ping: async () => ipcRenderer.invoke("app:ping"),
  getFixturePath: async () => ipcRenderer.invoke("app:getFixturePath"),
  dialog: {
    pickProjectRoot: async () => ipcRenderer.invoke("dialog:pickProjectRoot"),
    pickDocument: async () => ipcRenderer.invoke("dialog:pickDocument"),
    pickExportDir: async () => ipcRenderer.invoke("dialog:pickExportDir")
  },
  project: {
    createOrOpen: async (payload: { rootPath: string; name?: string; createIfMissing?: boolean }) =>
      ipcRenderer.invoke("project:createOrOpen", payload),
    getCurrent: async () => ipcRenderer.invoke("project:getCurrent"),
    getStatus: async () => ipcRenderer.invoke("project:getStatus"),
    subscribeStatus: async () => ipcRenderer.invoke("project:subscribeStatus"),
    getDiagnostics: async () => ipcRenderer.invoke("project:getDiagnostics"),
    getProcessingState: async () => ipcRenderer.invoke("project:getProcessingState"),
    getHistory: async () => ipcRenderer.invoke("project:getHistory"),
    addDocument: async (payload: { path: string }) =>
      ipcRenderer.invoke("project:addDocument", payload),
    stats: async () => ipcRenderer.invoke("project:stats"),
    evidenceCoverage: async () => ipcRenderer.invoke("project:evidenceCoverage")
  },
  system: {
    healthCheck: async () => ipcRenderer.invoke("system:healthCheck")
  },
  search: {
    ask: async (payload: { question: string }) => ipcRenderer.invoke("search:ask", payload),
    query: async (payload: { query: string }) => ipcRenderer.invoke("search:query", payload)
  },
  scenes: {
    list: async () => ipcRenderer.invoke("scenes:list"),
    get: async (payload: { sceneId: string }) => ipcRenderer.invoke("scenes:get", payload)
  },
  issues: {
    list: async (payload?: {
      status?: "open" | "dismissed" | "resolved" | "all";
      type?: string;
      severity?: "low" | "medium" | "high";
    }) =>
      payload ? ipcRenderer.invoke("issues:listFiltered", payload) : ipcRenderer.invoke("issues:list"),
    dismiss: async (payload: { issueId: string; reason?: string }) =>
      ipcRenderer.invoke("issues:dismiss", payload),
    undoDismiss: async (payload: { issueId: string }) =>
      ipcRenderer.invoke("issues:undoDismiss", payload),
    resolve: async (payload: { issueId: string }) => ipcRenderer.invoke("issues:resolve", payload),
    undoResolve: async (payload: { issueId: string }) =>
      ipcRenderer.invoke("issues:undoResolve", payload)
  },
  style: {
    getReport: async () => ipcRenderer.invoke("style:getReport")
  },
  bible: {
    listEntities: async () => ipcRenderer.invoke("bible:listEntities"),
    getEntity: async (payload: { entityId: string }) => ipcRenderer.invoke("bible:getEntity", payload)
  },
  canon: {
    confirmClaim: async (payload: {
      entityId: string;
      field: string;
      valueJson: string;
      sourceClaimId: string;
    }) => ipcRenderer.invoke("canon:confirmClaim", payload)
  },
  export: {
    run: async (payload: { outDir: string; kind?: "md" | "json" }) =>
      ipcRenderer.invoke("export:run", payload)
  },
  jobs: {
    list: async () => ipcRenderer.invoke("jobs:list"),
    cancel: async (payload: { jobId: string }) => ipcRenderer.invoke("jobs:cancel", payload)
  }
});
