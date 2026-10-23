/**
 * API process: HTTP + the Socket.IO gateway on one port.
 *
 * Boot order: validate config, (optionally) migrate, register job handlers that the
 * inline mode needs, start listening. SIGTERM drains: stop accepting, close sockets,
 * finish in-flight requests, close pools.
 */
process.env.TZ = "UTC";

import http from "node:http";
import { createApp } from "./app";
import { assertProductionConfig, config } from "./core/config";
import { captureError, logger } from "./core/logger";
import { closeDb } from "./db/kysely";
import { closeRedis } from "./integrations/redis";
import { closeQueues } from "./jobs/registry";
import { registerAllJobs } from "./jobs";
import { startGateway } from "./realtime/gateway";

async function main(): Promise<void> {
  for (const problem of assertProductionConfig()) logger.warn(`config: ${problem}`);
  if (config.MIGRATE_ON_BOOT) {
    const { migrate } = await import("../../../db/migrate");
    await migrate({ log: (line: string) => logger.info(line.trim()) });
  }
  registerAllJobs();

  const app = createApp();
  const server = http.createServer(app);
  const gateway = await startGateway(server);

  server.listen(config.PORT, () => logger.info({ port: config.PORT }, "api listening"));

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "shutting down");
    const force = setTimeout(() => process.exit(1), 25_000);
    force.unref();
    await gateway.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeQueues();
    await closeRedis();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

process.on("unhandledRejection", (err) => captureError(err, { where: "unhandledRejection" }));

main().catch((err) => {
  captureError(err, { where: "boot" });
  process.exit(1);
});
