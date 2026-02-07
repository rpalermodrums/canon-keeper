import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RpcRequest, RpcResponse } from "./rpc";

const { forkMock, existsSyncMock } = vi.hoisted(() => ({
  forkMock: vi.fn(),
  existsSyncMock: vi.fn(() => true)
}));

vi.mock("node:child_process", () => ({
  fork: forkMock
}));

vi.mock("node:fs", () => ({
  default: {
    existsSync: existsSyncMock
  },
  existsSync: existsSyncMock
}));

import { WorkerClient } from "./client";

class MockChildProcess extends EventEmitter {
  readonly sent: RpcRequest[] = [];
  readonly send = vi.fn((payload: RpcRequest) => {
    this.sent.push(payload);
    return true;
  });

  emitResponse(response: RpcResponse): void {
    this.emit("message", response);
  }

  emitExit(code: number | null = 1, signal: NodeJS.Signals | null = null): void {
    this.emit("exit", code, signal);
  }

  emitWorkerError(error: Error): void {
    this.emit("error", error);
  }

  requireRequest(index = 0): RpcRequest {
    const request = this.sent[index];
    if (!request) {
      throw new Error(`Expected request at index ${index}`);
    }
    return request;
  }
}

const children: MockChildProcess[] = [];

function childAt(index: number): MockChildProcess {
  const child = children[index];
  if (!child) {
    throw new Error(`Expected child process at index ${index}`);
  }
  return child;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.clearAllTimers();
  children.length = 0;
  existsSyncMock.mockReturnValue(true);
  forkMock.mockImplementation(() => {
    const child = new MockChildProcess();
    children.push(child);
    return child as unknown as ChildProcess;
  });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("WorkerClient", () => {
  it("transitions ready -> restarting -> ready after a crash", async () => {
    const client = new WorkerClient();
    const firstChild = childAt(0);

    expect(client.getState()).toBe("ready");

    firstChild.emitExit(1, null);

    expect(client.getState()).toBe("restarting");
    expect(client.getLastError()).toContain("Worker exited (1)");

    await vi.advanceTimersByTimeAsync(999);
    expect(forkMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(forkMock).toHaveBeenCalledTimes(2);
    expect(client.getState()).toBe("ready");
  });

  it("supports down-state buffering and enforces the 10s buffer timeout", async () => {
    const client = new WorkerClient();
    const mutableClient = client as unknown as {
      state: "ready" | "restarting" | "down";
    };

    expect(client.getState()).toBe("ready");
    mutableClient.state = "down";
    expect(client.getState()).toBe("down");

    const settle = { value: false };
    const requestPromise = client.request("project.getStatus").finally(() => {
      settle.value = true;
    });
    const rejection = expect(requestPromise).rejects.toThrow("Worker is restarting");

    await vi.advanceTimersByTimeAsync(9_999);
    expect(settle.value).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await rejection;
  });

  it("applies exponential backoff and resets attempts after a stable 15s window", async () => {
    new WorkerClient();

    childAt(0).emitExit(1, null);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(forkMock).toHaveBeenCalledTimes(2);

    childAt(1).emitExit(1, null);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(forkMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1);
    expect(forkMock).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(15_000);

    childAt(2).emitExit(1, null);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(forkMock).toHaveBeenCalledTimes(4);
  });

  it("replays buffered requests after restart and flushes them in order", async () => {
    const client = new WorkerClient();
    const firstChild = childAt(0);

    firstChild.emitExit(1, null);
    expect(client.getState()).toBe("restarting");

    const bufferedPromise = client.request<{ state: string }>("project.getStatus");

    await vi.advanceTimersByTimeAsync(1_000);
    const restartedChild = childAt(1);
    expect(restartedChild.send).toHaveBeenCalledTimes(1);

    const replayedRequest = restartedChild.requireRequest(0);
    expect(replayedRequest.method).toBe("project.getStatus");

    restartedChild.emitResponse({
      id: replayedRequest.id,
      result: { state: "idle" }
    });

    await expect(bufferedPromise).resolves.toEqual({ state: "idle" });
  });

  it("enforces the 30s per-request timeout for in-flight requests", async () => {
    const client = new WorkerClient();
    const firstChild = childAt(0);

    const settle = { value: false };
    const requestPromise = client.request("project.getStatus").finally(() => {
      settle.value = true;
    });
    const rejection = expect(requestPromise).rejects.toThrow(
      "Worker request timed out: project.getStatus"
    );

    expect(firstChild.send).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(29_999);
    expect(settle.value).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await rejection;
  });

  it("rejects all pending requests when the worker crashes", async () => {
    const client = new WorkerClient();
    const firstChild = childAt(0);

    const requestA = client.request("project.getStatus");
    const requestB = client.request("project.subscribeStatus");

    expect(firstChild.send).toHaveBeenCalledTimes(2);

    firstChild.emitExit(137, "SIGTERM");

    await expect(requestA).rejects.toThrow("Worker crashed");
    await expect(requestB).rejects.toThrow("Worker crashed");
  });

  it("prevents request black holes when the worker exits after send but before reply", async () => {
    const client = new WorkerClient();
    const firstChild = childAt(0);

    const pendingRequest = client.request("project.getStatus");
    const sentRequest = firstChild.requireRequest(0);

    firstChild.emitExit(1, null);

    await expect(pendingRequest).rejects.toThrow("Worker crashed");

    firstChild.emitResponse({ id: sentRequest.id, result: { state: "idle" } });
  });

  it("avoids double restart scheduling when exit and error fire back-to-back", async () => {
    const client = new WorkerClient();
    const firstChild = childAt(0);

    firstChild.emitExit(1, null);
    firstChild.emitWorkerError(new Error("late worker error"));

    expect(client.getState()).toBe("restarting");

    await vi.advanceTimersByTimeAsync(5_000);
    expect(forkMock).toHaveBeenCalledTimes(2);
  });

  it("re-opens the last project root automatically after respawn", async () => {
    const client = new WorkerClient();
    const firstChild = childAt(0);
    const rootPath = "/tmp/canonkeeper-project";

    const openPromise = client.request<{ id: string; root_path: string }>("project.createOrOpen", {
      rootPath
    });
    const initialOpenRequest = firstChild.requireRequest(0);

    expect(initialOpenRequest.method).toBe("project.createOrOpen");
    expect(initialOpenRequest.params).toEqual({ rootPath });

    firstChild.emitResponse({
      id: initialOpenRequest.id,
      result: { id: "project-1", root_path: rootPath }
    });
    await expect(openPromise).resolves.toEqual({ id: "project-1", root_path: rootPath });

    firstChild.emitExit(1, null);
    await vi.advanceTimersByTimeAsync(1_000);

    const restartedChild = childAt(1);
    const reopenRequest = restartedChild.requireRequest(0);

    expect(reopenRequest.method).toBe("project.createOrOpen");
    expect(reopenRequest.params).toEqual({ rootPath });

    restartedChild.emitResponse({
      id: reopenRequest.id,
      result: { id: "project-1", root_path: rootPath }
    });
    await vi.advanceTimersByTimeAsync(0);
  });
});
