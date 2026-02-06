import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fork, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RpcRequest, RpcResponse, WorkerMethods } from "../rpc";

type PendingRequest = {
  resolve: (response: RpcResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

class WorkerHarness {
  private readonly child: ChildProcess;
  private readonly pending = new Map<string, PendingRequest>();

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
      const pending = this.pending.get(response.id);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timeout);
      this.pending.delete(response.id);
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
          new Promise((_, reject) => setTimeout(() => reject(new Error("Worker exit timeout")), 5_000))
        ]);
      } catch {
        this.child.kill("SIGKILL");
        await once(this.child, "exit");
      }
    }
  }
}

function json(
  res: ServerResponse,
  statusCode: number,
  payload: Record<string, unknown> | Array<unknown>
): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.end(JSON.stringify(payload));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function main(): Promise<void> {
  const harness = new WorkerHarness();
  const port = Number(process.env.CANONKEEPER_RPC_BRIDGE_PORT ?? "48765");

  const server = createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        json(res, 204, {});
        return;
      }

      if (!req.url) {
        json(res, 400, { error: "Missing URL" });
        return;
      }

      if (req.url === "/health" && req.method === "GET") {
        json(res, 200, { ok: true });
        return;
      }

      if (req.url !== "/rpc" || req.method !== "POST") {
        json(res, 404, { error: "Not found" });
        return;
      }

      const body = await readBody(req);
      const parsed = JSON.parse(body) as { method?: string; params?: unknown };
      if (!parsed.method || typeof parsed.method !== "string") {
        json(res, 400, { error: "Missing method" });
        return;
      }
      const result = await harness.request(parsed.method as WorkerMethods, parsed.params);
      json(res, 200, { ok: true, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      json(res, 500, { ok: false, error: message });
    }
  });

  server.listen(port, "127.0.0.1", () => {
    process.stdout.write(`RPC bridge listening on http://127.0.0.1:${port}\n`);
  });

  const shutdown = async () => {
    server.close();
    await harness.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
