/**
 * Worker process: runs BullMQ job handlers and the scheduled maintenance jobs. Same
 * image as the API, different command (`node dist/worker.js`). Emits to sockets through
 * the Redis emitter, so a job can reach a user connected to any API task.
 */
process.env.TZ = "UTC";

import { Worker } from "bullmq";
import { assertProductionConfig } from "./core/config";
import { captureError, logger } from "./core/logger";
import { closeDb } from "./db/kysely";
import { closeRedis, redisConnection } from "./integrations/redis";
import { registerAllJobs } from "./jobs";
import { getHandler, QUEUES, closeQueues, enqueue, type JobName } from "./jobs/registry";
import { startEmitter } from "./realtime/emitter";

const SCHEDULES: { name: JobName; everyMs: number }[] = [
  { name: "maintenance.expire-uploads", everyMs: 30 * 60_000 },
  { name: "maintenance.event-reminders", everyMs: 5 * 60_000 },
  { name: "maintenance.lift-suspensions", everyMs: 5 * 60_000 },
  { name: "maintenance.reconcile-counters", everyMs: 6 * 3600_000 },
  { name: "notifications.email", everyMs: 15 * 60_000 },
];

async function main(): Promise<void> {
  for (const problem of assertProductionConfig()) logger.warn(`config: ${problem}`);
  registerAllJobs();
  const emitter = startEmitter();

  const workers = QUEUES.map(
    (queue) =>
      new Worker(
        queue,
        async (job) => {
          const handler = getHandler(job.name as JobName);
          if (!handler) throw new Error(`no handler for job ${job.name}`);
          await handler(job.data);
        },
        { connection: redisConnection(), concurrency: queue === "moderation" ? 8 : 4 },
      ),
  );
  for (const w of workers) {
    w.on("failed", (job, err) => captureError(err, { job: job?.name, attempts: job?.attemptsMade }));
  }

  // Repeatable jobs are keyed by name + interval, so every worker task registering
  // them on boot leaves exactly one schedule.
  for (const s of SCHEDULES) await enqueue(s.name, {} as never, { repeat: { every: s.everyMs }, jobId: s.name });

  logger.info({ queues: QUEUES }, "worker started");

  const shutdown = async () => {
    logger.info("worker shutting down");
    await Promise.all(workers.map((w) => w.close()));
    await closeQueues();
    emitter.close();
    await closeRedis();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

main().catch((err) => {
  captureError(err, { where: "worker boot" });
  process.exit(1);
});
