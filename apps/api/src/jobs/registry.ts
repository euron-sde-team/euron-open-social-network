/**
 * Background jobs. A job is a named handler with a JSON payload. Services enqueue jobs
 * through `Effects.job(...)`, so nothing is enqueued for a transaction that rolled back.
 *
 * JOBS_MODE=queue  BullMQ on Redis; the worker process (worker.ts) runs the handlers.
 * JOBS_MODE=inline the handler runs in-process right after commit. Used by the
 *                  integration tests so assertions are deterministic.
 */
import { Queue, type JobsOptions } from "bullmq";
import { config } from "../core/config";
import { captureError, logger } from "../core/logger";
import { redisConnection } from "../integrations/redis";

export const QUEUES = ["moderation", "media", "notifications", "maintenance"] as const;
export type QueueName = (typeof QUEUES)[number];

export interface JobDefinitions {
  "moderation.scan": { targetType: import("@open-social/types").ModerationTarget; targetId: string };
  "media.process": { uploadId: string };
  "notifications.email": { notificationId?: string };
  "maintenance.reconcile-counters": Record<string, never>;
  "maintenance.expire-uploads": Record<string, never>;
  "maintenance.event-reminders": Record<string, never>;
  "maintenance.lift-suspensions": Record<string, never>;
}
export type JobName = keyof JobDefinitions;

type Handler<N extends JobName> = (data: JobDefinitions[N]) => Promise<void>;
const handlers = new Map<JobName, Handler<any>>();

export function registerJob<N extends JobName>(name: N, handler: Handler<N>): void {
  handlers.set(name, handler);
}

export function getHandler<N extends JobName>(name: N): Handler<N> | undefined {
  return handlers.get(name);
}

export function queueFor(name: JobName): QueueName {
  return name.split(".")[0] as QueueName;
}

const queues = new Map<QueueName, Queue>();
function queue(name: QueueName): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, {
      connection: redisConnection(),
      defaultJobOptions: { attempts: 5, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: 1000, removeOnFail: 5000 },
    });
    queues.set(name, q);
  }
  return q;
}

export async function enqueue<N extends JobName>(name: N, data: JobDefinitions[N], opts: JobsOptions = {}): Promise<void> {
  if (config.JOBS_MODE === "inline") {
    const handler = getHandler(name);
    if (!handler) {
      logger.warn({ job: name }, "inline job has no handler registered");
      return;
    }
    try {
      await handler(data);
    } catch (err) {
      captureError(err, { job: name });
    }
    return;
  }
  await queue(queueFor(name)).add(name, data, opts);
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
}
