import { describe, it, expect, vi } from "vitest";
import { JobQueue, type Job } from "./queue";

type TestJob = Job<
  "task",
  {
    id: string;
    value: number;
    shouldFail?: boolean;
    throwNonError?: boolean;
  }
>;

type QueueInternals = {
  queue: string[];
  entries: Map<string, unknown>;
  running: boolean;
};

function getInternals(queue: JobQueue<TestJob, string>): QueueInternals {
  return queue as unknown as QueueInternals;
}

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  const holder: { resolve: () => void } = { resolve: () => undefined };
  const promise = new Promise<void>((resolve) => {
    holder.resolve = resolve;
  });
  return { promise, resolve: holder.resolve };
}

describe("JobQueue", () => {
  it("enqueues a single job and resolves with the handler result", async () => {
    const handler = vi.fn(async (job: TestJob) => `result:${job.payload.value}`);
    const queue = new JobQueue<TestJob, string>(handler);

    const result = await queue.enqueue(
      {
        type: "task",
        payload: { id: "job-1", value: 41 }
      },
      "job:1"
    );

    expect(result).toBe("result:41");
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      type: "task",
      payload: { id: "job-1", value: 41 }
    });
  });

  it("replaces payload for duplicate pending keys and resolves both callers with latest result", async () => {
    const gate = createDeferred();
    const handledValues: number[] = [];
    const queue = new JobQueue<TestJob, string>(async (job) => {
      handledValues.push(job.payload.value);
      if (job.payload.id === "blocker") {
        await gate.promise;
      }
      return `value:${job.payload.value}`;
    });

    const blocker = queue.enqueue(
      {
        type: "task",
        payload: { id: "blocker", value: 0 }
      },
      "job:blocker"
    );

    const firstPromise = queue.enqueue(
      {
        type: "task",
        payload: { id: "pending", value: 1 }
      },
      "job:pending"
    );
    const secondPromise = queue.enqueue(
      {
        type: "task",
        payload: { id: "pending", value: 2 }
      },
      "job:pending"
    );

    expect(firstPromise).toBe(secondPromise);
    gate.resolve();

    await expect(blocker).resolves.toBe("value:0");
    await expect(firstPromise).resolves.toBe("value:2");
    expect(handledValues).toEqual([0, 2]);
  });

  it("rejects failed jobs and continues processing remaining jobs", async () => {
    const handled: string[] = [];
    const queue = new JobQueue<TestJob, string>(async (job) => {
      handled.push(job.payload.id);
      if (job.payload.shouldFail) {
        throw new Error(`boom:${job.payload.id}`);
      }
      return `ok:${job.payload.id}`;
    });

    const failed = queue.enqueue(
      {
        type: "task",
        payload: { id: "first", value: 1, shouldFail: true }
      },
      "job:first"
    );
    const succeeded = queue.enqueue(
      {
        type: "task",
        payload: { id: "second", value: 2 }
      },
      "job:second"
    );

    await expect(failed).rejects.toThrow("boom:first");
    await expect(succeeded).resolves.toBe("ok:second");
    expect(handled).toEqual(["first", "second"]);
  });

  it("drains concurrently enqueued jobs in FIFO order", async () => {
    const gate = createDeferred();
    const seen: string[] = [];
    const queue = new JobQueue<TestJob, string>(async (job) => {
      seen.push(job.payload.id);
      if (job.payload.id === "first") {
        await gate.promise;
      }
      return `done:${job.payload.id}`;
    });

    const first = queue.enqueue(
      { type: "task", payload: { id: "first", value: 1 } },
      "job:first"
    );
    const second = queue.enqueue(
      { type: "task", payload: { id: "second", value: 2 } },
      "job:second"
    );
    const third = queue.enqueue(
      { type: "task", payload: { id: "third", value: 3 } },
      "job:third"
    );
    const fourth = queue.enqueue(
      { type: "task", payload: { id: "fourth", value: 4 } },
      "job:fourth"
    );

    gate.resolve();
    await expect(first).resolves.toBe("done:first");
    await expect(second).resolves.toBe("done:second");
    await expect(third).resolves.toBe("done:third");
    await expect(fourth).resolves.toBe("done:fourth");
    expect(seen).toEqual(["first", "second", "third", "fourth"]);
  });

  it("cleans entry bookkeeping after successful completion", async () => {
    const queue = new JobQueue<TestJob, string>(async (job) => `done:${job.payload.id}`);

    await queue.enqueue(
      { type: "task", payload: { id: "single", value: 1 } },
      "job:single"
    );

    const internals = getInternals(queue);
    expect(internals.entries.size).toBe(0);
    expect(internals.queue).toEqual([]);
    expect(internals.running).toBe(false);
  });

  it("cleans entry bookkeeping after handler rejection", async () => {
    const queue = new JobQueue<TestJob, string>(async () => {
      throw new Error("expected failure");
    });

    await expect(
      queue.enqueue(
        { type: "task", payload: { id: "single-fail", value: 1, shouldFail: true } },
        "job:single-fail"
      )
    ).rejects.toThrow("expected failure");

    const internals = getInternals(queue);
    expect(internals.entries.size).toBe(0);
    expect(internals.queue).toEqual([]);
    expect(internals.running).toBe(false);
  });

  it("supports re-entrant enqueue calls while a handler is executing", async () => {
    const handled: string[] = [];
    const nestedPromises: Array<Promise<string>> = [];
    const queue = new JobQueue<TestJob, string>(async (job) => {
      handled.push(job.payload.id);
      if (job.payload.id === "outer") {
        nestedPromises.push(
          queue.enqueue(
            {
              type: "task",
              payload: { id: "inner", value: 2 }
            },
            "job:inner"
          )
        );
      }
      return `done:${job.payload.id}`;
    });

    const outerPromise = queue.enqueue(
      {
        type: "task",
        payload: { id: "outer", value: 1 }
      },
      "job:outer"
    );

    await expect(outerPromise).resolves.toBe("done:outer");
    expect(nestedPromises).toHaveLength(1);
    await expect(nestedPromises[0]).resolves.toBe("done:inner");
    expect(handled).toEqual(["outer", "inner"]);
  });

  it("returns one shared promise for multiple duplicate enqueues of the same pending key", async () => {
    const gate = createDeferred();
    const queue = new JobQueue<TestJob, string>(async (job) => {
      if (job.payload.id === "blocker") {
        await gate.promise;
      }
      return `value:${job.payload.value}`;
    });

    const blocker = queue.enqueue(
      { type: "task", payload: { id: "blocker", value: 0 } },
      "job:blocker"
    );
    const first = queue.enqueue(
      { type: "task", payload: { id: "dedupe", value: 1 } },
      "job:dedupe"
    );
    const second = queue.enqueue(
      { type: "task", payload: { id: "dedupe", value: 2 } },
      "job:dedupe"
    );
    const third = queue.enqueue(
      { type: "task", payload: { id: "dedupe", value: 3 } },
      "job:dedupe"
    );

    expect(first).toBe(second);
    expect(second).toBe(third);
    gate.resolve();

    await blocker;
    await expect(first).resolves.toBe("value:3");
  });

  it("has no leftover state after draining all jobs", async () => {
    const queue = new JobQueue<TestJob, string>(async (job) => `ok:${job.payload.id}`);
    const jobs = [
      queue.enqueue({ type: "task", payload: { id: "a", value: 1 } }, "job:a"),
      queue.enqueue({ type: "task", payload: { id: "b", value: 2 } }, "job:b"),
      queue.enqueue({ type: "task", payload: { id: "c", value: 3 } }, "job:c")
    ];

    await Promise.all(jobs);

    const internals = getInternals(queue);
    expect(internals.queue.length).toBe(0);
    expect(internals.entries.size).toBe(0);
    expect(internals.running).toBe(false);
  });

  it("wraps non-Error throws with a generic job failure error", async () => {
    const queue = new JobQueue<TestJob, string>(async (job) => {
      if (job.payload.throwNonError) {
        const nonError: unknown = "non-error throw";
        throw nonError;
      }
      return `ok:${job.payload.id}`;
    });

    await expect(
      queue.enqueue(
        {
          type: "task",
          payload: { id: "bad", value: 1, throwNonError: true }
        },
        "job:bad"
      )
    ).rejects.toThrow("Job failed");
  });
});
