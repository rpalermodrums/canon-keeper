export { openDatabase, type DatabaseHandle } from "./db";
export { getProjectByRootPath, getProjectById, createProject, touchProject } from "./projectRepo";
export {
  getDocumentByPath,
  getDocumentById,
  createDocument,
  touchDocument,
  listDocuments,
  markDocumentMissing,
  markDocumentSeen
} from "./documentRepo";
export { insertSnapshot, getLatestSnapshot, listSnapshotSummaries } from "./snapshotRepo";
export {
  listChunksForDocument,
  deleteChunksByIds,
  insertChunks,
  updateChunk,
  getChunkById
} from "./chunkRepo";
export { logEvent, listEvents } from "./eventLogRepo";
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
  getOrCreateEntityByName,
  deleteEntityIfNoClaims
} from "./entityRepo";
export { listClaimsForEntity, insertClaim, supersedeClaims, listClaimsByField } from "./claimRepo";
export { insertClaimEvidence, listEvidenceForClaim } from "./claimEvidenceRepo";
export { replaceStyleMetric, listStyleMetrics, deleteStyleMetricsByName } from "./styleRepo";
export {
  clearIssuesByType,
  insertIssue,
  insertIssueEvidence,
  listIssues,
  type ListIssueFilters,
  listIssuesWithEvidence,
  dismissIssue,
  resolveIssue,
  deleteIssuesByIds,
  deleteIssuesByTypeAndDocument,
  deleteIssuesByTypeAndChunkIds
} from "./issueRepo";
export { type StoragePaths, getStoragePaths, ensureStorageDirs } from "./paths";
export { runMigrations } from "./migrations";
export {
  enqueueJob,
  claimNextJob,
  getJobById,
  completeJob,
  failJob,
  getQueueDepth,
  resetRunningJobs,
  type JobQueueRow
} from "./jobQueueRepo";
export {
  getProcessingState,
  upsertProcessingState,
  listProcessingStates,
  type ProcessingStateRow,
  type ProcessingStatus
} from "./processingStateRepo";
