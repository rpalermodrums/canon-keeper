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
    createOrOpen: async (payload: { rootPath: string; name?: string }) =>
      ipcRenderer.invoke("project:createOrOpen", payload),
    getStatus: async () => ipcRenderer.invoke("project:getStatus"),
    subscribeStatus: async () => ipcRenderer.invoke("project:subscribeStatus"),
    getProcessingState: async () => ipcRenderer.invoke("project:getProcessingState"),
    getHistory: async () => ipcRenderer.invoke("project:getHistory"),
    addDocument: async (payload: { path: string }) =>
      ipcRenderer.invoke("project:addDocument", payload)
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
    resolve: async (payload: { issueId: string }) => ipcRenderer.invoke("issues:resolve", payload)
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
  }
});
