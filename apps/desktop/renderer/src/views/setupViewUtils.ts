import type { ProjectDiagnostics } from "../api/ipc";

export type StepState = "todo" | "active" | "done";

export function stepState(
  index: number,
  hasProject: boolean,
  hasDocuments: boolean,
  hasDiagnostics: boolean
): StepState {
  if (index === 0) {
    return hasProject ? "done" : "active";
  }
  if (index === 1) {
    if (!hasProject) return "todo";
    return hasDocuments ? "done" : "active";
  }
  if (!hasProject || !hasDocuments) return "todo";
  return hasDiagnostics ? "done" : "active";
}

export function isProjectPathValid(rootPath: string): boolean {
  return rootPath.trim().length > 0;
}

export function canAddDocument(hasProject: boolean): boolean {
  return hasProject;
}

export function isDocumentPathValid(hasProject: boolean, docPath: string): boolean {
  return canAddDocument(hasProject) && docPath.trim().length > 0;
}

export function canRunDiagnostics(hasProject: boolean, hasDocuments: boolean): boolean {
  return hasProject && hasDocuments;
}

export function areDiagnosticsReady(healthCheck: ProjectDiagnostics | null): boolean {
  return Boolean(healthCheck && healthCheck.details.length === 0);
}

export function getNextSetupStepIndex(
  hasProject: boolean,
  hasDocuments: boolean,
  hasDiagnostics: boolean
): number | null {
  if (!hasProject) return 0;
  if (!hasDocuments) return 1;
  if (!hasDiagnostics) return 2;
  return null;
}
