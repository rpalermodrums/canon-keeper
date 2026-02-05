import { useEffect, useMemo, useState } from "react";
import {
  addDocument,
  askQuestion,
  confirmClaim,
  createOrOpenProject,
  getWorkerStatus,
  getEntity,
  getScene,
  getStyleReport,
  listEntities,
  listIssues,
  listScenes,
  dismissIssue,
  querySearch,
  runExport,
  type AskResponse,
  type IngestResult,
  type EntityDetail,
  type EntitySummary,
  type IssueSummary,
  type ProjectSummary,
  type SceneDetail,
  type SceneSummary,
  type SearchQueryResponse,
  type StyleReport,
  type WorkerStatus
} from "./api/ipc";

export function App(): JSX.Element {
  const [rootPath, setRootPath] = useState("");
  const [docPath, setDocPath] = useState("");
  const [status, setStatus] = useState<WorkerStatus | null>(null);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [lastIngest, setLastIngest] = useState<IngestResult | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchQueryResponse | null>(null);
  const [questionText, setQuestionText] = useState("");
  const [askResult, setAskResult] = useState<AskResponse | null>(null);
  const [scenes, setScenes] = useState<SceneSummary[]>([]);
  const [selectedSceneId, setSelectedSceneId] = useState("");
  const [sceneDetail, setSceneDetail] = useState<SceneDetail | null>(null);
  const [issues, setIssues] = useState<IssueSummary[]>([]);
  const [styleReport, setStyleReport] = useState<StyleReport | null>(null);
  const [styleIssues, setStyleIssues] = useState<IssueSummary[]>([]);
  const [entities, setEntities] = useState<EntitySummary[]>([]);
  const [selectedEntityId, setSelectedEntityId] = useState("");
  const [entityDetail, setEntityDetail] = useState<EntityDetail | null>(null);
  const [exportDir, setExportDir] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const fetchStatus = async () => {
      try {
        const next = await getWorkerStatus();
        if (active) {
          setStatus(next);
        }
      } catch (err) {
        if (active) {
          setStatus(null);
        }
      }
    };

    void fetchStatus();
    const interval = setInterval(fetchStatus, 2000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const statusLabel = useMemo(() => {
    if (!status) return "disconnected";
    return `${status.state}${status.lastJob ? ` (${status.lastJob})` : ""}`;
  }, [status]);

  const onCreateProject = async () => {
    setError(null);
    setBusy(true);
    try {
      const created = await createOrOpenProject({ rootPath: rootPath.trim() });
      setProject(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setBusy(false);
    }
  };

  const onAddDocument = async () => {
    setError(null);
    setBusy(true);
    try {
      const result = await addDocument({ path: docPath.trim() });
      setLastIngest(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to ingest document");
    } finally {
      setBusy(false);
    }
  };

  const onSearch = async () => {
    setError(null);
    setBusy(true);
    try {
      const result = await querySearch(searchQuery.trim());
      setSearchResults(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setBusy(false);
    }
  };

  const onAsk = async () => {
    setError(null);
    setBusy(true);
    try {
      const result = await askQuestion(questionText.trim());
      setAskResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ask failed");
    } finally {
      setBusy(false);
    }
  };

  const refreshScenes = async () => {
    setError(null);
    try {
      const result = await listScenes();
      setScenes(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load scenes");
    }
  };

  const handleSelectScene = async (sceneId: string) => {
    setSelectedSceneId(sceneId);
    if (!sceneId) {
      setSceneDetail(null);
      return;
    }
    setError(null);
    try {
      const detail = await getScene(sceneId);
      setSceneDetail(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load scene detail");
    }
  };

  const refreshIssues = async () => {
    setError(null);
    try {
      const result = await listIssues();
      setIssues(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load issues");
    }
  };

  const handleDismissIssue = async (issueId: string) => {
    setError(null);
    try {
      await dismissIssue(issueId);
      await refreshIssues();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to dismiss issue");
    }
  };

  const refreshStyle = async () => {
    setError(null);
    try {
      const report = await getStyleReport();
      setStyleReport(report);
      const issueList = await listIssues();
      setStyleIssues(
        issueList.filter((issue) =>
          ["repetition", "tone_drift", "dialogue_tic"].includes(issue.type)
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load style report");
    }
  };

  const refreshEntities = async () => {
    setError(null);
    try {
      const result = await listEntities();
      setEntities(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load entities");
    }
  };

  const handleSelectEntity = async (entityId: string) => {
    setSelectedEntityId(entityId);
    if (!entityId) {
      setEntityDetail(null);
      return;
    }
    setError(null);
    try {
      const detail = await getEntity(entityId);
      setEntityDetail(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load entity");
    }
  };

  const handleConfirmClaim = async (field: string, valueJson: string) => {
    if (!entityDetail) return;
    setError(null);
    try {
      await confirmClaim({
        entityId: entityDetail.entity.id,
        field,
        valueJson
      });
      await handleSelectEntity(entityDetail.entity.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm claim");
    }
  };

  const handleExport = async () => {
    setError(null);
    setBusy(true);
    try {
      await runExport(exportDir.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif", maxWidth: 960 }}>
      <h1>CanonKeeper Dashboard</h1>

      <section style={{ marginBottom: 24 }}>
        <h2>Status</h2>
        <p>
          <strong>Worker:</strong> {statusLabel}
        </p>
        {project ? (
          <p>
            <strong>Project:</strong> {project.name} ({project.root_path})
          </p>
        ) : (
          <p>No project opened.</p>
        )}
        {lastIngest ? (
          <div>
            <p>
              <strong>Last ingest:</strong> {lastIngest.documentId}
            </p>
            <ul>
              <li>Chunks created: {lastIngest.chunksCreated}</li>
              <li>Chunks updated: {lastIngest.chunksUpdated}</li>
              <li>Chunks deleted: {lastIngest.chunksDeleted}</li>
            </ul>
          </div>
        ) : (
          <p>No ingestion results yet.</p>
        )}
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2>Project Setup</h2>
        <label style={{ display: "block", marginBottom: 8 }}>
          Project root path
          <input
            type="text"
            value={rootPath}
            onChange={(event) => setRootPath(event.target.value)}
            style={{ display: "block", width: "100%", marginTop: 4 }}
          />
        </label>
        <button onClick={onCreateProject} disabled={busy || rootPath.trim().length === 0}>
          Create / Open Project
        </button>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2>Ingest Document</h2>
        <label style={{ display: "block", marginBottom: 8 }}>
          Document path
          <input
            type="text"
            value={docPath}
            onChange={(event) => setDocPath(event.target.value)}
            style={{ display: "block", width: "100%", marginTop: 4 }}
          />
        </label>
        <button onClick={onAddDocument} disabled={busy || docPath.trim().length === 0}>
          Add Document
        </button>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2>Search</h2>
        <label style={{ display: "block", marginBottom: 8 }}>
          Query
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            style={{ display: "block", width: "100%", marginTop: 4 }}
          />
        </label>
        <button onClick={onSearch} disabled={busy || searchQuery.trim().length === 0}>
          Search
        </button>
        {searchResults ? (
          <div style={{ marginTop: 12 }}>
            <p>
              <strong>Results:</strong> {searchResults.results.length}
            </p>
            <ul>
              {searchResults.results.map((result) => (
                <li key={result.chunkId}>
                  <div>
                    {result.documentPath} · chunk {result.ordinal}
                  </div>
                  <div style={{ fontStyle: "italic" }}>{result.snippet}</div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2>Ask the Bible</h2>
        <label style={{ display: "block", marginBottom: 8 }}>
          Question
          <input
            type="text"
            value={questionText}
            onChange={(event) => setQuestionText(event.target.value)}
            style={{ display: "block", width: "100%", marginTop: 4 }}
          />
        </label>
        <button onClick={onAsk} disabled={busy || questionText.trim().length === 0}>
          Ask
        </button>
        {askResult ? (
          <div style={{ marginTop: 12 }}>
            <p>
              <strong>Answer:</strong> {askResult.answer}
            </p>
            <p>
              <strong>Type:</strong> {askResult.answerType} · Confidence {askResult.confidence}
            </p>
            <p>Citations: {askResult.citations.length}</p>
            {askResult.snippets ? (
              <div>
                <p>Snippets returned: {askResult.snippets.length}</p>
                <ul>
                  {askResult.snippets.map((snippet) => (
                    <li key={snippet.chunkId}>
                      {snippet.documentPath} · chunk {snippet.ordinal}
                      <div style={{ fontStyle: "italic" }}>{snippet.snippet}</div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2>Scenes</h2>
        <button onClick={refreshScenes} disabled={busy}>
          Refresh Scenes
        </button>
        <div style={{ marginTop: 12 }}>
          <label style={{ display: "block", marginBottom: 8 }}>
            Select scene
            <select
              value={selectedSceneId}
              onChange={(event) => void handleSelectScene(event.target.value)}
              style={{ display: "block", width: "100%", marginTop: 4 }}
            >
              <option value="">--</option>
              {scenes.map((scene) => (
                <option key={scene.id} value={scene.id}>
                  Scene {scene.ordinal}: {scene.title ?? "Untitled"}
                </option>
              ))}
            </select>
          </label>
        </div>
        {scenes.length === 0 ? (
          <p>No scenes available.</p>
        ) : (
          <table style={{ width: "100%", marginTop: 12, borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Ordinal</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Title</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>POV</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Setting</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Range</th>
              </tr>
            </thead>
            <tbody>
              {scenes.map((scene) => (
                <tr key={scene.id}>
                  <td style={{ padding: "4px 0" }}>{scene.ordinal}</td>
                  <td style={{ padding: "4px 0" }}>{scene.title ?? "Untitled"}</td>
                  <td style={{ padding: "4px 0" }}>{scene.pov_mode ?? "unknown"}</td>
                  <td style={{ padding: "4px 0" }}>{scene.setting_text ?? "unknown"}</td>
                  <td style={{ padding: "4px 0" }}>
                    {scene.start_char}–{scene.end_char}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {sceneDetail ? (
          <div style={{ marginTop: 12 }}>
            <h3>Scene Detail</h3>
            <p>
              Scene {sceneDetail.scene.ordinal}: {sceneDetail.scene.title ?? "Untitled"}
            </p>
            <p>Evidence: {sceneDetail.evidence.length}</p>
            {sceneDetail.evidence.length > 0 ? (
              <ul>
                {sceneDetail.evidence.map((evidence, index) => (
                  <li key={`${sceneDetail.scene.id}-e-${index}`}>
                    {evidence.documentPath ?? "unknown"} · chunk {evidence.chunkOrdinal ?? "?"}
                    <div style={{ fontStyle: "italic" }}>{evidence.excerpt}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No scene evidence yet.</p>
            )}
          </div>
        ) : null}
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2>Issues</h2>
        <button onClick={refreshIssues} disabled={busy}>
          Refresh Issues
        </button>
        {issues.length === 0 ? (
          <p>No issues available.</p>
        ) : (
          <ul>
            {issues.map((issue) => (
              <li key={issue.id} style={{ marginBottom: 8 }}>
                <strong>{issue.title}</strong> ({issue.type}, {issue.severity})
                <div>{issue.description}</div>
                <div>Evidence: {issue.evidence.length}</div>
                {issue.evidence.length > 0 ? (
                  <ul>
                    {issue.evidence.map((evidence, index) => (
                      <li key={`${issue.id}-${index}`}>
                        {evidence.documentPath ?? "unknown"} · chunk{" "}
                        {evidence.chunkOrdinal ?? "?"}
                        <div style={{ fontStyle: "italic" }}>{evidence.excerpt}</div>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <button onClick={() => handleDismissIssue(issue.id)} disabled={busy}>
                  Dismiss
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2>Style</h2>
        <button onClick={refreshStyle} disabled={busy}>
          Refresh Style Report
        </button>
        {styleReport ? (
          <div style={{ marginTop: 12 }}>
            <h3>Repetition</h3>
            {styleReport.repetition ? (
              <ul>
                {(
                  styleReport.repetition as {
                    top?: Array<{
                      ngram: string;
                      count: number;
                      examples?: Array<{
                        excerpt?: string;
                        documentPath?: string | null;
                        chunkOrdinal?: number | null;
                      }>;
                    }>;
                  }
                ).top?.slice(0, 5).map((entry) => {
                  const example = entry.examples?.[0];
                  return (
                    <li key={entry.ngram}>
                      {entry.ngram} ({entry.count})
                      {example?.excerpt ? (
                        <div style={{ fontStyle: "italic" }}>
                          {example.documentPath ?? "unknown"} · chunk {example.chunkOrdinal ?? "?"}
                          <div>{example.excerpt}</div>
                        </div>
                      ) : null}
                    </li>
                  );
                }) ?? <li>No repetition metrics.</li>}
              </ul>
            ) : (
              <p>No repetition metrics.</p>
            )}

            <h3>Tone Drift</h3>
            <p>Scenes analyzed: {styleReport.tone.length}</p>
            {styleIssues.filter((issue) => issue.type === "tone_drift").length > 0 ? (
              <ul>
                {styleIssues
                  .filter((issue) => issue.type === "tone_drift")
                  .map((issue) => (
                    <li key={issue.id}>
                      {issue.title}
                      {issue.evidence[0]?.excerpt ? (
                        <div style={{ fontStyle: "italic" }}>{issue.evidence[0].excerpt}</div>
                      ) : null}
                    </li>
                  ))}
              </ul>
            ) : (
              <p>No tone drift issues.</p>
            )}

            <h3>Dialogue Tics</h3>
            <p>Profiles: {styleReport.dialogueTics.length}</p>
            {styleIssues.filter((issue) => issue.type === "dialogue_tic").length > 0 ? (
              <ul>
                {styleIssues
                  .filter((issue) => issue.type === "dialogue_tic")
                  .map((issue) => (
                    <li key={issue.id}>
                      {issue.title}
                      {issue.evidence[0]?.excerpt ? (
                        <div style={{ fontStyle: "italic" }}>{issue.evidence[0].excerpt}</div>
                      ) : null}
                    </li>
                  ))}
              </ul>
            ) : (
              <p>No dialogue tic issues.</p>
            )}
          </div>
        ) : (
          <p>No style report loaded.</p>
        )}
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2>Bible</h2>
        <button onClick={refreshEntities} disabled={busy}>
          Refresh Entities
        </button>
        <div style={{ marginTop: 12 }}>
          <label style={{ display: "block", marginBottom: 8 }}>
            Select entity
            <select
              value={selectedEntityId}
              onChange={(event) => void handleSelectEntity(event.target.value)}
              style={{ display: "block", width: "100%", marginTop: 4 }}
            >
              <option value="">--</option>
              {entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.display_name} ({entity.type})
                </option>
              ))}
            </select>
          </label>
        </div>
        {entityDetail ? (
          <div style={{ marginTop: 12 }}>
            <h3>{entityDetail.entity.display_name}</h3>
            {entityDetail.claims.length === 0 ? (
              <p>No claims yet.</p>
            ) : (
              <ul>
                {entityDetail.claims.map((claim) => (
                  <li key={claim.claim.id}>
                    <strong>{claim.claim.field}</strong>: {JSON.stringify(claim.value)} (
                    {claim.claim.status}, evidence {claim.evidence.length})
                    {claim.claim.status !== "confirmed" ? (
                      <div>
                        <button
                          onClick={() =>
                            void handleConfirmClaim(claim.claim.field, claim.claim.value_json)
                          }
                          disabled={busy}
                        >
                          Confirm
                        </button>
                      </div>
                    ) : null}
                    {claim.evidence.length > 0 ? (
                      <ul>
                        {claim.evidence.map((evidence, index) => (
                          <li key={`${claim.claim.id}-${index}`}>
                            {evidence.documentPath ?? "unknown"} · chunk{" "}
                            {evidence.chunkOrdinal ?? "?"}
                            <div style={{ fontStyle: "italic" }}>{evidence.excerpt}</div>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p>No entity selected.</p>
        )}
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2>Export</h2>
        <label style={{ display: "block", marginBottom: 8 }}>
          Output directory
          <input
            type="text"
            value={exportDir}
            onChange={(event) => setExportDir(event.target.value)}
            style={{ display: "block", width: "100%", marginTop: 4 }}
          />
        </label>
        <button onClick={handleExport} disabled={busy || exportDir.trim().length === 0}>
          Run Export
        </button>
      </section>

      {error ? (
        <section>
          <h2>Error</h2>
          <p>{error}</p>
        </section>
      ) : null}
    </main>
  );
}
