import { fork, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import fs from "node:fs";
import type { RpcRequest, RpcResponse, WorkerMethods } from "./rpc";

type PendingRequest = {
  resolve: (response: RpcResponse) => void;
  reject: (error: Error) => void;
};

type BufferedRequest = {
  method: WorkerMethods;
  params?: unknown;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

export class WorkerClient {
  private child: ChildProcess | null = null;
  private pending = new Map<string, PendingRequest>();
  private buffered: BufferedRequest[] = [];
  private state: "ready" | "restarting" | "down" = "down";
  private restartAttempts = 0;
  private lastError: string | null = null;
  private lastProjectRoot: string | null = null;
  private restarting = false;

  constructor() {
    this.spawn();
  }

  getState(): "ready" | "restarting" | "down" {
    return this.state;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  private spawn(): void {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const workerJsPath = path.join(__dirname, "worker.js");
    const workerTsPath = path.join(__dirname, "worker.ts");

    const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
    let child: ChildProcess;
    if (isDev && fs.existsSync(workerTsPath)) {
      const tsxPath = path.join(process.cwd(), "node_modules", ".bin", "tsx");
      if (!fs.existsSync(tsxPath)) {
        throw new Error("tsx runtime not found for dev worker");
      }
      child = fork(workerTsPath, [], {
        stdio: ["pipe", "pipe", "pipe", "ipc"],
        execPath: tsxPath
      });
    } else {
      if (!fs.existsSync(workerJsPath)) {
        throw new Error(`Worker build not found at ${workerJsPath}`);
      }
      child = fork(workerJsPath, { stdio: ["pipe", "pipe", "pipe", "ipc"] });
    }

    this.child = child;
    this.state = "ready";
    this.restarting = false;
    this.restartAttempts = 0;

    child.on("message", (message: RpcResponse) => {
      if (!message || typeof message !== "object") {
        return;
      }
      const handler = this.pending.get(message.id);
      if (handler) {
        handler.resolve(message);
        this.pending.delete(message.id);
      }
    });

    child.on("exit", (code, signal) => {
      this.state = "restarting";
      this.lastError = `Worker exited (${code ?? "unknown"}${signal ? `, ${signal}` : ""})`;
      this.failPending(new Error("Worker crashed"));
      this.scheduleRestart();
    });

    child.on("error", (error) => {
      this.state = "restarting";
      this.lastError = error.message;
      this.failPending(error);
      this.scheduleRestart();
    });

    if (this.lastProjectRoot) {
      void this.request("project.createOrOpen", { rootPath: this.lastProjectRoot });
    }

    this.flushBuffered();
  }

  private scheduleRestart(): void {
    if (this.restarting) {
      return;
    }
    this.restarting = true;
    this.state = "restarting";
    const delay = Math.min(30_000, 1000 * Math.pow(2, this.restartAttempts));
    this.restartAttempts += 1;
    setTimeout(() => this.spawn(), delay);
  }

  private failPending(error: Error): void {
    for (const [, pending] of this.pending) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  private flushBuffered(): void {
    const buffered = [...this.buffered];
    this.buffered = [];
    for (const item of buffered) {
      this.sendRequest(item.method, item.params)
        .then(item.resolve)
        .catch(item.reject);
      clearTimeout(item.timeout);
    }
  }

  private async sendRequest<T>(method: WorkerMethods, params?: unknown): Promise<T> {
    if (!this.child || !this.child.send) {
      throw new Error("Worker IPC not available");
    }
    const id = crypto.randomUUID();
    const payload: RpcRequest = { id, method, params };
    const response = await new Promise<RpcResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Worker request timed out: ${method}`));
      }, 30_000);

      this.pending.set(id, {
        resolve: (resp) => {
          clearTimeout(timeout);
          resolve(resp);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        }
      });

      this.child?.send(payload);
    });

    if (response.error) {
      throw new Error(response.error.message);
    }

    return response.result as T;
  }

  async request<T>(method: WorkerMethods, params?: unknown): Promise<T> {
    if (method === "project.createOrOpen") {
      const rootPath = (params as { rootPath?: string })?.rootPath;
      if (rootPath) {
        this.lastProjectRoot = rootPath;
      }
    }

    if (this.state !== "ready") {
      return new Promise<T>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Worker is restarting"));
        }, 10_000);
        this.buffered.push({
          method,
          params,
          resolve: resolve as (value: unknown) => void,
          reject,
          timeout
        });
      });
    }

    return this.sendRequest<T>(method, params);
  }
}
