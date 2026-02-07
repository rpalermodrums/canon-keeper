import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RpcRequest, RpcResponse, WorkerMethods } from "../rpc";

type IngestResult = {
  documentId: string;
  snapshotId: string;
};

type EntityDetail = {
  entity: { id: string };
  claims: Array<{
    claim: {
      id: string;
      field: string;
      value_json: string;
      status: string;
    };
    evidence: Array<{ chunkId: string }>;
  }>;
};

type IssueSummary = {
  id: string;
  status: string;
};

type SceneSummary = {
  id: string;
};

type ProjectHistory = {
  snapshots: Array<{ id: string }>;
  events: Array<{ id: string; event_type: string }>;
};

type AssertionResult = {
  id: string;
  status: "pass" | "fail" | "skipped";
  expected: string;
  actual: string;
  evidence: string;
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

  constructor() {
    const workerPath = fileURLToPath(new URL("../worker.ts", import.meta.url));
    const tsxPath = path.resolve(process.cwd(), "node_modules", ".bin", "tsx");
    if (!fs.existsSync(tsxPath)) {
      throw new Error(`tsx runtime not found at ${tsxPath}`);
    }
    this.child = fork(workerPath, [], {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      execPath: tsxPath
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
    if (!this.child.killed) {
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
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForStages(
  worker: RpcWorkerHarness,
  requiredStages: string[],
  timeoutMs = 45_000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const states = await worker.request<Array<{ stage: string; status: string }>>(
      "project.getProcessingState"
    );
    const byStage = new Map(states.map((row) => [row.stage, row.status]));
    if (requiredStages.every((stage) => byStage.get(stage) === "ok")) {
      return;
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for stages: ${requiredStages.join(", ")}`);
}

function copyFixture(rootPath: string, fixtureName: string): string {
  const sourcePath = path.resolve(process.cwd(), "data", "fixtures", fixtureName);
  const destinationPath = path.join(rootPath, fixtureName);
  fs.copyFileSync(sourcePath, destinationPath);
  return destinationPath;
}

async function run(): Promise<void> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "canonkeeper-journey-"));
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const artifactRoot = path.resolve(process.cwd(), "output", "agent-test", runId);
  const exportArtifactDir = path.join(artifactRoot, "exports");
  const logsDir = path.join(artifactRoot, "logs");
  fs.mkdirSync(exportArtifactDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });
  fs.writeFileSync(path.join(artifactRoot, "assertions.json"), "[]\n");
  fs.writeFileSync(path.join(artifactRoot, "summary.md"), "# CanonKeeper Agent Test Summary\n\nRun started.\n");
  fs.writeFileSync(path.join(logsDir, "run.log.txt"), "");
  const assertions: AssertionResult[] = [];
  const logLines: string[] = [];

  const addAssertion = (assertion: AssertionResult) => {
    assertions.push(assertion);
    logLines.push(
      `[${assertion.status.toUpperCase()}] ${assertion.id} expected="${assertion.expected}" actual="${assertion.actual}"`
    );
  };

  const worker = new RpcWorkerHarness();
  try {
    const simplePath = copyFixture(tempRoot, "simple_md.md");
    const contradictionPath = copyFixture(tempRoot, "contradiction.md");
    const exportOut = path.join(tempRoot, "export");

    await worker.request("project.createOrOpen", { rootPath: tempRoot, name: "Journey Fixture" });
    addAssertion({
      id: "project-open",
      status: "pass",
      expected: "project.createOrOpen succeeds",
      actual: "project opened",
      evidence: tempRoot
    });

    await worker.request<IngestResult>("project.addDocument", { path: simplePath });
    await worker.request<IngestResult>("project.addDocument", { path: contradictionPath });
    addAssertion({
      id: "ingest-documents",
      status: "pass",
      expected: "two fixture documents are ingested",
      actual: "ingest completed for simple_md.md and contradiction.md",
      evidence: `${simplePath}, ${contradictionPath}`
    });

    await waitForStages(worker, ["scenes", "style", "extraction", "continuity"]);
    addAssertion({
      id: "stages-complete",
      status: "pass",
      expected: "scenes/style/extraction/continuity reach ok",
      actual: "all required stages reached ok",
      evidence: "project.getProcessingState"
    });

    const scenes = await worker.request<SceneSummary[]>("scenes.list");
    if (scenes[0]) {
      await worker.request("scenes.get", { sceneId: scenes[0].id });
    }
    addAssertion({
      id: "scenes-available",
      status: scenes.length > 0 ? "pass" : "fail",
      expected: "at least one scene exists",
      actual: `${scenes.length} scenes returned`,
      evidence: "scenes.list"
    });

    const issues = await worker.request<IssueSummary[]>("issues.list");
    if (issues[0]) {
      await worker.request("issues.resolve", { issueId: issues[0].id });
    }
    addAssertion({
      id: "issues-available",
      status: issues.length > 0 ? "pass" : "fail",
      expected: "at least one issue exists for contradiction fixture",
      actual: `${issues.length} issues returned`,
      evidence: "issues.list"
    });

    const entities = await worker.request<Array<{ id: string }>>("bible.listEntities");
    if (entities[0]) {
      const detail = await worker.request<EntityDetail>("bible.getEntity", { entityId: entities[0].id });
      const claim = detail.claims.find((row) => row.claim.status !== "confirmed" && row.evidence.length > 0);
      if (claim) {
        await worker.request("canon.confirmClaim", {
          entityId: detail.entity.id,
          field: claim.claim.field,
          valueJson: claim.claim.value_json,
          sourceClaimId: claim.claim.id
        });
        addAssertion({
          id: "confirm-claim",
          status: "pass",
          expected: "confirm claim succeeds with evidence-backed source",
          actual: `confirmed claim ${claim.claim.id}`,
          evidence: detail.entity.id
        });
      } else {
        addAssertion({
          id: "confirm-claim",
          status: "skipped",
          expected: "confirm claim succeeds with evidence-backed source",
          actual: "no inferred claim with evidence available",
          evidence: "bible.getEntity"
        });
      }
    }
    addAssertion({
      id: "entities-available",
      status: entities.length > 0 ? "pass" : "fail",
      expected: "at least one entity exists",
      actual: `${entities.length} entities returned`,
      evidence: "bible.listEntities"
    });

    await worker.request("style.getReport");
    addAssertion({
      id: "style-report",
      status: "pass",
      expected: "style.getReport succeeds",
      actual: "style report loaded",
      evidence: "style.getReport"
    });

    const askResult = await worker.request<{ kind: string }>("search.ask", {
      question: "What color are Mira's eyes?"
    });
    addAssertion({
      id: "ask-result",
      status: ["answer", "snippets", "not_found"].includes(askResult.kind) ? "pass" : "fail",
      expected: "ask returns answer/snippets/not_found",
      actual: askResult.kind,
      evidence: "search.ask"
    });

    const exportResult = await worker.request<{ ok: boolean; files?: string[] }>("export.run", {
      outDir: exportOut,
      kind: "all"
    });
    addAssertion({
      id: "export-run",
      status: exportResult.ok ? "pass" : "fail",
      expected: "export.run succeeds",
      actual: exportResult.ok ? "ok" : "failed",
      evidence: exportOut
    });

    const history = await worker.request<ProjectHistory>("project.getHistory");
    fs.writeFileSync(path.join(logsDir, "project-history.json"), JSON.stringify(history, null, 2));
    fs.writeFileSync(path.join(logsDir, "run.log.txt"), `${logLines.join("\n")}\n`);

    for (const fileName of ["bible.md", "scenes.md", "style_report.md", "project.json"]) {
      const sourcePath = path.join(exportOut, fileName);
      if (fs.existsSync(sourcePath)) {
        fs.copyFileSync(sourcePath, path.join(exportArtifactDir, fileName));
      }
    }

    fs.writeFileSync(path.join(artifactRoot, "assertions.json"), `${JSON.stringify(assertions, null, 2)}\n`);

    const passed = assertions.filter((row) => row.status === "pass").length;
    const failed = assertions.filter((row) => row.status === "fail").length;
    const skipped = assertions.filter((row) => row.status === "skipped").length;
    const summary = {
      artifactRoot,
      tempRoot,
      scenes: scenes.length,
      issues: issues.length,
      assertions: { passed, failed, skipped },
      exportedFiles: fs.readdirSync(exportArtifactDir).sort()
    };
    fs.writeFileSync(path.join(artifactRoot, "journey-summary.json"), JSON.stringify(summary, null, 2));
    const topFailures = assertions.filter((row) => row.status === "fail").map((row) => `- ${row.id}: ${row.actual}`);

    fs.writeFileSync(
      path.join(artifactRoot, "summary.md"),
      [
        "# CanonKeeper Agent Test Summary",
        "",
        `- Run ID: \`${runId}\``,
        `- Temp Project Root: \`${tempRoot}\``,
        `- Assertions: pass=${passed}, fail=${failed}, skipped=${skipped}`,
        `- Exports: ${summary.exportedFiles.join(", ") || "none"}`,
        "",
        "## Top Failures",
        ...(topFailures.length > 0 ? topFailures : ["- none"])
      ].join("\n")
    );
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await worker.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

try {
  await run();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
