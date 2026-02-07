export type RpcRequest = {
  id: string;
  method: string;
  params?: unknown;
};

export type RpcResponse = {
  id: string;
  result?: unknown;
  error?: { message: string };
};

export type WorkerMethods =
  | "project.createOrOpen"
  | "project.getCurrent"
  | "project.getStatus"
  | "project.subscribeStatus"
  | "project.getDiagnostics"
  | "project.getProcessingState"
  | "project.getHistory"
  | "project.addDocument"
  | "project.stats"
  | "project.evidenceCoverage"
  | "system.healthCheck"
  | "search.query"
  | "search.ask"
  | "scenes.list"
  | "scenes.get"
  | "issues.list"
  | "issues.dismiss"
  | "issues.undoDismiss"
  | "issues.resolve"
  | "issues.undoResolve"
  | "style.getReport"
  | "bible.listEntities"
  | "bible.getEntity"
  | "canon.confirmClaim"
  | "export.run"
  | "jobs.list"
  | "jobs.cancel";
