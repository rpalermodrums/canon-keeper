import { afterEach, describe, expect, it } from "vitest";
import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RpcRequest, RpcResponse, WorkerMethods } from "./rpc";

type WorkerStatus = {
  state: "idle" | "busy";
  projectId?: string | null;
  queueDepth?: number;
};

type ProcessingState = {
  document_id: string;
  snapshot_id: string;
  stage: string;
  status: "pending" | "ok" | "failed";
  error: string | null;
  updated_at: number;
  document_path: string;
};

type EntitySummary = {
  id: string;
  display_name: string;
};

type EntityDetail = {
  entity: {
    id: string;
    display_name: string;
  };
  claims: Array<{
    claim: {
      id: string;
      field: string;
      value_json: string;
      status: string;
    };
    evidence: Array<{
      chunkId: string;
      quoteStart: number;
      quoteEnd: number;
      excerpt: string;
    }>;
  }>;
};

type IssueSummary = {
  id: string;
  status: string;
  type: string;
  evidence: Array<{
    chunkId: string;
    quoteStart: number;
    quoteEnd: number;
    excerpt: string;
  }>;
};

type AskResult = {
  kind: "answer" | "snippets" | "not_found";
  answer?: string;
  reason?: string;
  snippets?: Array<{ chunkId: string; snippet: string }>;
};

type ProjectHistory = {
  snapshots: Array<{ id: string }>;
  events: Array<{ id: string; event_type: string }>;
};

type ProjectSummary = {
  id: string;
  root_path: string;
};

type IngestResult = {
  documentId: string;
  snapshotId: string;
  snapshotCreated: boolean;
};

class RpcWorkerHarness {
  private readonly child: ChildProcess;
  private readonly pending = new Map<
    string,
    {
      resolve: (response: RpcResponse) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();
  private stderrLog = "";

  constructor() {
    const workerPath = fileURLToPath(new URL("./worker.ts", import.meta.url));
    const tsxPath = path.resolve(process.cwd(), "node_modules", ".bin", "tsx");
    if (!fs.existsSync(tsxPath)) {
      throw new Error(`tsx runtime not found at ${tsxPath}`);
    }

    this.child = fork(workerPath, [], {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      execArgv: ["--import=tsx"]
    });

    this.child.on("message", (message: unknown) => {
      if (!message || typeof message !== "object") {
        return;
      }
      const response = message as RpcResponse;
      const id = response.id;
      if (!id) {
        return;
      }
      const pending = this.pending.get(id);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timeout);
      this.pending.delete(id);
      pending.resolve(response);
    });

    this.child.stderr?.on("data", (chunk: Buffer | string) => {
      this.stderrLog += chunk.toString();
    });
  }

  async request<T>(method: WorkerMethods, params?: unknown): Promise<T> {
    if (!this.child.send) {
      throw new Error("Worker IPC is unavailable");
    }

    const id = crypto.randomUUID();
    const payload: RpcRequest = { id, method, params };
    const response = await new Promise<RpcResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for RPC response: ${method}`));
      }, 45_000);
      this.pending.set(id, { resolve, reject, timeout });
      this.child.send?.(payload);
    });

    if (response.error) {
      throw new Error(response.error.message);
    }
    return response.result as T;
  }

  async close(): Promise<void> {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Worker closed"));
    }
    this.pending.clear();

    if (this.child.killed) {
      return;
    }

    this.child.kill("SIGTERM");
    try {
      await Promise.race([
        once(this.child, "exit"),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Worker exit timeout")), 5_000)
        )
      ]);
    } catch {
      this.child.kill("SIGKILL");
      await once(this.child, "exit");
    }
  }

  getStderrLog(): string {
    return this.stderrLog;
  }
}

const fixtureDir = path.resolve(process.cwd(), "data", "fixtures");

function copyFixture(rootPath: string, fixtureName: string): string {
  const sourcePath = path.join(fixtureDir, fixtureName);
  const destinationPath = path.join(rootPath, fixtureName);
  fs.copyFileSync(sourcePath, destinationPath);
  return destinationPath;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForStages(
  worker: RpcWorkerHarness,
  requiredStages: string[],
  timeoutMs = 45_000
): Promise<ProcessingState[]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const states = await worker.request<ProcessingState[]>("project.getProcessingState");
    const byStage = new Map(states.map((row) => [row.stage, row.status]));
    if (requiredStages.every((stage) => byStage.get(stage) === "ok")) {
      return states;
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for processing stages: ${requiredStages.join(", ")}`);
}

describe("worker RPC integration", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const rootPath of tempRoots) {
      fs.rmSync(rootPath, { recursive: true, force: true });
    }
    tempRoots.length = 0;
  });

  it(
    "covers required RPC methods and enforces evidence-first boundaries",
    async () => {
    const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "canonkeeper-rpc-"));
    tempRoots.push(rootPath);

    const worker = new RpcWorkerHarness();
    try {
      const docPath = copyFixture(rootPath, "contradiction.md");
      const outDir = path.join(rootPath, "exports");

      const project = await worker.request<ProjectSummary>("project.createOrOpen", {
        rootPath,
        name: "RPC Integration"
      });
      expect(project.root_path).toBe(path.resolve(rootPath));

      const status = await worker.request<WorkerStatus>("project.getStatus");
      expect(status.projectId).toBe(project.id);

      const ingest = await worker.request<IngestResult>("project.addDocument", { path: docPath });
      expect(ingest.documentId).toBeTruthy();
      expect(ingest.snapshotId).toBeTruthy();
      expect(ingest.snapshotCreated).toBe(true);

      const processingState = await waitForStages(worker, [
        "scenes",
        "style",
        "extraction",
        "continuity"
      ]);
      expect(processingState.length).toBeGreaterThan(0);

      const entities = await worker.request<EntitySummary[]>("bible.listEntities");
      expect(entities.length).toBeGreaterThan(0);

      const entityDetail = await worker.request<EntityDetail>("bible.getEntity", {
        entityId: entities[0]!.id
      });
      expect(entityDetail.claims.length).toBeGreaterThan(0);

      // No surfaced claim should be returned without evidence.
      for (const claim of entityDetail.claims) {
        expect(claim.evidence.length).toBeGreaterThan(0);
      }

      const sourceClaim = entityDetail.claims[0]!;

      await expect(
        worker.request<string>("canon.confirmClaim", {
          entityId: entityDetail.entity.id,
          field: sourceClaim.claim.field,
          valueJson: sourceClaim.claim.value_json
        })
      ).rejects.toThrow("sourceClaimId is required");

      await expect(
        worker.request<string>("canon.confirmClaim", {
          entityId: entityDetail.entity.id,
          field: sourceClaim.claim.field,
          valueJson: sourceClaim.claim.value_json,
          sourceClaimId: "missing-source-claim"
        })
      ).rejects.toThrow("without evidence-backed source claim");

      const confirmedClaimId = await worker.request<string>("canon.confirmClaim", {
        entityId: entityDetail.entity.id,
        field: sourceClaim.claim.field,
        valueJson: sourceClaim.claim.value_json,
        sourceClaimId: sourceClaim.claim.id
      });
      expect(confirmedClaimId).toBeTruthy();

      const issues = await worker.request<IssueSummary[]>("issues.list");
      if (issues[0]) {
        await worker.request<{ ok: boolean }>("issues.resolve", { issueId: issues[0].id });
        const resolved = await worker.request<IssueSummary[]>("issues.list", { status: "resolved" });
        expect(resolved.some((issue) => issue.id === issues[0]!.id)).toBe(true);
      } else {
        const missingIssueId = crypto.randomUUID();
        const resolveResult = await worker.request<{ ok: boolean }>("issues.resolve", {
          issueId: missingIssueId
        });
        expect(resolveResult.ok).toBe(true);
      }

      const askResult = await worker.request<AskResult>("search.ask", {
        question: "What color are Mira's eyes?"
      });
      expect(["answer", "snippets", "not_found"]).toContain(askResult.kind);
      if (askResult.kind === "snippets") {
        expect((askResult.snippets ?? []).length).toBeGreaterThan(0);
      }

      const exportResult = await worker.request<
        { ok: true; files: string[]; elapsedMs: number } | { ok: false; error: string }
      >("export.run", {
        outDir,
        kind: "md"
      });
      expect(exportResult.ok).toBe(true);
      if (exportResult.ok) {
        expect(exportResult.files.length).toBeGreaterThan(0);
      }

      const scenesMarkdown = fs.readFileSync(path.join(outDir, "scenes.md"), "utf8");
      const sourceText = fs.readFileSync(docPath, "utf8");
      const quoteMatches = [...scenesMarkdown.matchAll(/— "([^"]*)"/g)];
      for (const match of quoteMatches) {
        const quote = match[1]?.trim() ?? "";
        if (quote.length > 0) {
          expect(sourceText).toContain(quote);
        }
      }

      const history = await worker.request<ProjectHistory>("project.getHistory");
      expect(history.snapshots.length).toBeGreaterThan(0);
      expect(history.events.length).toBeGreaterThan(0);
      expect(history.events.some((event) => event.event_type === "fts_query_failed")).toBe(false);
    } catch (error) {
      const detail = worker.getStderrLog();
      if (detail) {
        throw new Error(`${error instanceof Error ? error.message : String(error)}\n${detail}`);
      }
      throw error;
    } finally {
      await worker.close();
    }
    },
    90_000
  );

  it(
    "gracefully falls back when cloud provider is enabled without credentials",
    async () => {
    const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "canonkeeper-rpc-cloud-"));
    tempRoots.push(rootPath);
    const previousApiKey = process.env.CANONKEEPER_LLM_API_KEY;
    const previousBaseUrl = process.env.CANONKEEPER_LLM_BASE_URL;
    process.env.CANONKEEPER_LLM_API_KEY = "";
    process.env.CANONKEEPER_LLM_BASE_URL = "";

    fs.writeFileSync(
      path.join(rootPath, "canonkeeper.json"),
      `${JSON.stringify(
        {
          projectName: "Cloud Disabled",
          documents: [],
          llm: {
            provider: "cloud",
            model: "gpt-5.2",
            enabled: true
          }
        },
        null,
        2
      )}\n`
    );

    const worker = new RpcWorkerHarness();
    try {
      const mixedQuotesPath = copyFixture(rootPath, "mixed_quotes.md");
      const largeRevisionPath = copyFixture(rootPath, "large_revision.md");

      await worker.request<ProjectSummary>("project.createOrOpen", {
        rootPath,
        name: "Cloud Disabled"
      });

      await worker.request<IngestResult>("project.addDocument", { path: mixedQuotesPath });
      await worker.request<IngestResult>("project.addDocument", { path: largeRevisionPath });
      await waitForStages(worker, ["scenes", "style", "extraction", "continuity"]);

      const entities = await worker.request<EntitySummary[]>("bible.listEntities");
      expect(entities.length).toBeGreaterThan(0);

      const askResult = await worker.request<AskResult>("search.ask", {
        question: "Who is speaking in the market scene?"
      });
      expect(["answer", "snippets", "not_found"]).toContain(askResult.kind);
    } finally {
      await worker.close();
      if (previousApiKey === undefined) {
        delete process.env.CANONKEEPER_LLM_API_KEY;
      } else {
        process.env.CANONKEEPER_LLM_API_KEY = previousApiKey;
      }
      if (previousBaseUrl === undefined) {
        delete process.env.CANONKEEPER_LLM_BASE_URL;
      } else {
        process.env.CANONKEEPER_LLM_BASE_URL = previousBaseUrl;
      }
    }
    },
    90_000
  );
});
