import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("canonkeeper", {
  ping: async () => ipcRenderer.invoke("app:ping"),
  project: {
    createOrOpen: async (payload: { rootPath: string; name?: string }) =>
      ipcRenderer.invoke("project:createOrOpen", payload),
    getStatus: async () => ipcRenderer.invoke("project:getStatus"),
    getProcessingState: async () => ipcRenderer.invoke("project:getProcessingState"),
    addDocument: async (payload: { path: string }) =>
      ipcRenderer.invoke("project:addDocument", payload)
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
    list: async () => ipcRenderer.invoke("issues:list"),
    dismiss: async (payload: { issueId: string }) => ipcRenderer.invoke("issues:dismiss", payload)
  },
  style: {
    getReport: async () => ipcRenderer.invoke("style:getReport")
  },
  bible: {
    listEntities: async () => ipcRenderer.invoke("bible:listEntities"),
    getEntity: async (payload: { entityId: string }) => ipcRenderer.invoke("bible:getEntity", payload)
  },
  canon: {
    confirmClaim: async (payload: { entityId: string; field: string; valueJson: string }) =>
      ipcRenderer.invoke("canon:confirmClaim", payload)
  },
  export: {
    run: async (payload: { outDir: string; kind?: "md" | "json" }) =>
      ipcRenderer.invoke("export:run", payload)
  }
});
