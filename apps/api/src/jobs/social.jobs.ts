/**
 * Social maintenance jobs (scheduled by worker.ts):
 *
 *   maintenance.reconcile-counters  recompute every denormalised counter from the rows
 *                                   (PUBLISHED only), reputation and level from the
 *                                   points ledger, and lift expired community suspensions
 *   maintenance.event-reminders     one hour before an event, remind GOING attendees once
 */
import { logger } from "../core/logger";
import { reconcileCounters } from "../services/counters.service";
import { sendDueReminders } from "../services/event.service";
import { registerJob } from "./registry";

export function registerSocialJobs(): void {
  registerJob("maintenance.reconcile-counters", async () => {
    const fixed = await reconcileCounters();
    const total = Object.values(fixed).reduce((a, b) => a + b, 0);
    if (total) logger.info({ fixed }, "counters reconciled");
  });

  registerJob("maintenance.event-reminders", async () => {
    const sent = await sendDueReminders();
    if (sent) logger.info({ sent }, "event reminders sent");
  });
}
