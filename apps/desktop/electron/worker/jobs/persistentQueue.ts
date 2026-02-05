import type Database from "better-sqlite3";
import {
  claimNextJob,
  completeJob,
  enqueueJob,
  failJob,
  getJobById,
  resetRunningJobs,
  type JobQueueRow
} from "../storage";

export type JobHandler<TJob extends { type: string; payload: unknown }, TResult> = (
  job: TJob
) => Promise<TResult>;

type Waiter<TResult> = {
  resolve: (value: TResult) => void;
  reject: (error: Error) => void;
};

export class PersistentJobQueue<TJob extends { type: string; payload: unknown }, TResult> {
  private running = false;
  private stopped = false;
  private waiters = new Map<string, Waiter<TResult>[]>();

  constructor(private db: Database.Database, private handler: JobHandler<TJob, TResult>) {}

  start(): void {
    resetRunningJobs(this.db);
    this.stopped = false;
    void this.runLoop();
  }

  stop(): void {
    this.stopped = true;
  }

  enqueue(job: TJob, dedupeKey: string, awaitResult = false): Promise<TResult> | null {
    const row = enqueueJob(this.db, {
      projectId: (job.payload as { projectId?: string })?.projectId ?? "unknown",
      type: job.type,
      payload: job.payload,
      dedupeKey
    });

    void this.runLoop();

    if (!awaitResult) {
      return null;
    }

    return new Promise<TResult>((resolve, reject) => {
      const list = this.waiters.get(row.id) ?? [];
      list.push({ resolve, reject });
      this.waiters.set(row.id, list);
    });
  }

  private async runLoop(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;

    while (!this.stopped) {
      const now = Date.now();
      const jobRow = claimNextJob(this.db, now);
      if (!jobRow) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }

      try {
        const result = await this.execute(jobRow);
        const latest = getJobById(this.db, jobRow.id);
        if (!latest || latest.status === "running") {
          completeJob(this.db, jobRow.id);
        }
        const waiters = this.waiters.get(jobRow.id);
        if (waiters) {
          waiters.forEach((waiter) => waiter.resolve(result));
          this.waiters.delete(jobRow.id);
        }
      } catch (error) {
        const waiters = this.waiters.get(jobRow.id);
        if (waiters) {
          const err = error instanceof Error ? error : new Error("Job failed");
          waiters.forEach((waiter) => waiter.reject(err));
          this.waiters.delete(jobRow.id);
        }
        const backoffMs = Math.min(30_000, 1000 * Math.pow(2, jobRow.attempts));
        failJob(this.db, jobRow.id, Date.now() + backoffMs);
      }
    }

    this.running = false;
  }

  private async execute(jobRow: JobQueueRow): Promise<TResult> {
    const payload = JSON.parse(jobRow.payload_json) as TJob["payload"];
    const job = { type: jobRow.type, payload } as TJob;
    return this.handler(job);
  }
}
