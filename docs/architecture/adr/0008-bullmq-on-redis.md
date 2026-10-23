# ADR 0008: BullMQ on Redis for background jobs

## Status

Accepted.

## Context

Several pieces of work must not run on the request path: classifier calls (seconds,
sometimes failing), image re-encoding, notification digests, event reminders, upload
expiry, counter reconciliation and lifting suspensions. They need retries, concurrency
limits and schedules that run once even with several worker tasks.

## Decision

- BullMQ queues on the same Redis: `moderation`, `media`, `notifications`, `maintenance`
  ([`jobs/registry.ts`](../../../apps/api/src/jobs/registry.ts)). A job's queue is the prefix of its name
  (`moderation.scan` goes to `moderation`).
- Defaults: 5 attempts, exponential backoff from 5 s, keep the last 1000 completed and 5000
  failed jobs.
- A separate worker process, same image, `node dist/worker.js`
  ([`worker.ts`](../../../apps/api/src/worker.ts)): concurrency 8 for `moderation`, 4 for the others, per task.
- Repeatable jobs keyed by name and interval, registered by every worker on boot, so one
  schedule exists however many workers run: upload expiry 30 min, event reminders 5 min,
  lift suspensions 5 min, counter reconciliation 6 h, email digests 15 min.
- Jobs are enqueued only after commit, through `Effects.job(...)`.
- `JOBS_MODE=inline` runs the handler in-process right after commit, for the integration
  tests and tiny installs. The production guard warns about it, and refuses to boot with it
  in production.
- On AWS, ElastiCache uses `maxmemory-policy noeviction`, because an evicted job key is a
  lost job ([`infra/terraform/modules/cache/main.tf`](../../../infra/terraform/modules/cache/main.tf)).

## Consequences

Positive:

- One dependency (Redis) for jobs, socket fan-out, rate limits and presence.
- Retries and backoff for flaky providers; the worker scales separately from the API.

Trade-offs:

- Redis becomes stateful and must not evict; its memory is a capacity limit.
- No queue-depth alarm exists in the observability module.
- Inline mode has no retries and no schedules: handler errors are logged and swallowed.

## Alternatives considered

- **PostgreSQL as the queue** (the sibling HRMS choice). Avoids Redis, but this product
  needs Redis anyway for the Socket.IO adapter.
- **SQS plus a scheduler.** AWS-only, and a second local emulation path.
- **In-process timers.** Would run once per API task and lose work on restart.
