export { openDatabase, type DatabaseHandle } from "./db";
export { getProjectByRootPath, getProjectById, createProject, touchProject } from "./projectRepo";
export {
  getDocumentByPath,
  getDocumentById,
  createDocument,
  touchDocument,
  listDocuments
} from "./documentRepo";
export { insertSnapshot, getLatestSnapshotVersion } from "./snapshotRepo";
export {
  listChunksForDocument,
  deleteChunksByIds,
  insertChunks,
  updateChunk,
  getChunkById
} from "./chunkRepo";
export { logEvent } from "./eventLogRepo";
export {
  replaceScenesForDocument,
  listScenesForProject,
  getSceneById,
  updateSceneMetadata,
  replaceSceneEntities
} from "./sceneRepo";
export {
  insertSceneEvidence,
  listSceneEvidence,
  deleteSceneEvidenceForDocument,
  deleteSceneEvidenceForScene
} from "./sceneEvidenceRepo";
export {
  listEntities,
  getEntityById,
  getEntityByAlias,
  createEntity,
  addAlias,
  listAliases,
  getOrCreateEntityByName
} from "./entityRepo";
export { listClaimsForEntity, insertClaim, supersedeClaims, listClaimsByField } from "./claimRepo";
export { insertClaimEvidence, listEvidenceForClaim } from "./claimEvidenceRepo";
export { replaceStyleMetric, listStyleMetrics } from "./styleRepo";
export {
  clearIssuesByType,
  insertIssue,
  insertIssueEvidence,
  listIssues,
  listIssuesWithEvidence,
  dismissIssue
} from "./issueRepo";
export { type StoragePaths, getStoragePaths, ensureStorageDirs } from "./paths";
export { runMigrations } from "./migrations";
