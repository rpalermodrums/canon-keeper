import { useEffect, useMemo, useState } from "react";
import {
  addDocument,
  askSearch,
  createOrOpenProject,
  getWorkerStatus,
  type IngestResult,
  type ProjectSummary,
  type SearchResponse,
  type WorkerStatus
} from "./api/ipc";

export function App(): JSX.Element {
  const [rootPath, setRootPath] = useState("");
  const [docPath, setDocPath] = useState("");
  const [status, setStatus] = useState<WorkerStatus | null>(null);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [lastIngest, setLastIngest] = useState<IngestResult | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResponse | null>(null);
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
      const result = await askSearch(searchQuery.trim());
      setSearchResults(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
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

      {error ? (
        <section>
          <h2>Error</h2>
          <p>{error}</p>
        </section>
      ) : null}
    </main>
  );
}
