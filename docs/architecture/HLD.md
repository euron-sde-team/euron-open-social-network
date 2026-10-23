# High-level design

Euron Open Social is a self-hosted, community-backed social network. One deployment runs
one network: a home feed, user-created communities (public or private), posts with
reactions, comments, polls and shares, Q&A, events, community chat, direct messages,
reputation points, notifications and AI-assisted moderation. Everything a browser sees
arrives over one origin, with Socket.IO for live updates.

This page describes the system as it is built: what runs, where data lives, how a request
travels and what happens when a piece fails. Deeper topics have their own pages:

| Topic | Page |
| --- | --- |
| Modules, layers and conventions inside the API | [LLD.md](LLD.md) |
| Tables, enums and indexes | [data-model.md](data-model.md) |
| Socket events, rooms and presence | [realtime.md](realtime.md) |
| The moderation pipeline and desk | [moderation.md](moderation.md) |
| Uploads and media processing | [media.md](media.md) |
| Security controls and known limitations | [security.md](security.md) |
| STRIDE analysis | [threat-model.md](threat-model.md) |
| Decisions and their trade-offs | [adr/](adr/README.md) |

All code paths are relative to the repository root.

## 1. System context

Three kinds of people use a network. All of them use the same web app; what they can do
depends on their platform role (`users.role`: `USER`, `MODERATOR`, `ADMIN`) and, inside a
community, their membership role (`OWNER`, `ADMIN`, `MODERATOR`, `MEMBER`).

```mermaid
flowchart LR
  visitor["Visitor<br/>(signed out: public<br/>communities and posts)"]
  member["Member<br/>(feed, communities,<br/>chat, DMs, events)"]
  cmod["Community moderator<br/>(OWNER / ADMIN / MODERATOR<br/>of a community)"]
  staff["Platform staff<br/>(MODERATOR / ADMIN:<br/>moderation desk, admin console)"]
  operator["Operator<br/>(runs the deployment:<br/>Terraform, make, CLI)"]

  social["Euron Open Social<br/>(web app + API + worker)"]

  ses["Mail transport<br/>(Amazon SES, or SMTP)"]
  mod["Moderation provider<br/>(OpenAI omni-moderation,<br/>built-in rules, or the test stub)"]
  s3["Object storage<br/>(private S3 bucket)"]

  visitor --> social
  member --> social
  cmod --> social
  staff --> social
  operator -->|admin:create, migrations, deploys| social
  social --> ses
  social -->|text and signed image URLs| mod
  member -->|presigned PUT / GET| s3
  social --> s3
```

Two flows bypass the API on purpose:

- **Media bytes** go straight between the browser and the bucket with presigned URLs. The
  API only hands out a URL for a declared, allowlisted file, then verifies what landed
  (size and magic bytes) before anything can use it. See [media.md](media.md).
- **Mail links** (email verification, password reset, notification digests) point at the
  web app (`APP_WEB_URL`), which calls the API.

## 2. Containers

The repository builds three images. The API image carries four entry points (esbuild
bundles listed in [`apps/api/package.json`](../../apps/api/package.json)).

| Container | Source | Image | Listens | Role |
| --- | --- | --- | --- | --- |
| Web app | `apps/web` (Next.js, standalone) | [`infra/docker/web.Dockerfile`](../../infra/docker/web.Dockerfile) | 3000 | Pages, the `/env.js` runtime config, the CSP. In local compose it also proxies `/api/*` and `/socket.io/*` to the API. |
| API | [`apps/api/src/index.ts`](../../apps/api/src/index.ts) | [`infra/docker/api.Dockerfile`](../../infra/docker/api.Dockerfile) | 5006 | REST under `/api`, the Socket.IO gateway on `/socket.io`, `/up` and `/api/ready`. |
| Worker | [`apps/api/src/worker.ts`](../../apps/api/src/worker.ts) | API image, `node dist/worker.js` | none | BullMQ workers for the `moderation`, `media`, `notifications` and `maintenance` queues, and the repeatable maintenance schedules. |
| Migrate (one-off) | [`db/migrate.ts`](../../db/migrate.ts) | API image, `node dist/migrate.js` | none | Applies pending SQL migrations under an advisory lock. |
| CLI (one-off) | [`apps/api/src/cli.ts`](../../apps/api/src/cli.ts) | API image, `node dist/cli.js` | none | `admin:create` and `demo:seed`. |
| Moderation stub (dev and tests) | [`apps/moderation-stub`](../../apps/moderation-stub/README.md) | [`infra/docker/moderation-stub.Dockerfile`](../../infra/docker/moderation-stub.Dockerfile) | 5099 | A fake of the OpenAI moderation endpoint with deterministic scores. Never deployed to AWS. |

Shared packages:

| Package | Holds |
| --- | --- |
| [`packages/types`](../../packages/types/src/index.ts) | DTOs, enums and the Socket.IO event maps shared by the API and the web app |
| [`packages/api-client`](../../packages/api-client/src/index.ts) | The HTTP client (single-flight refresh, cross-tab lock), the typed socket client, uploads, pagination helpers, the `/env.js` serialiser |
| [`packages/ui`](../../packages/ui/src/index.ts) | The component library the web app renders with |

### Deployed shape (AWS)

```mermaid
flowchart TB
  subgraph browser["Browser"]
    spa["Web app in the browser<br/>access token in memory,<br/>refresh token in an httpOnly cookie"]
  end

  subgraph edge["Edge"]
    cf["CloudFront + WAF<br/>(enable_cdn; on by default in aws-prod)"]
    alb["Application Load Balancer<br/>one host: /api/*, /socket.io/*, /up -> api<br/>everything else -> web"]
  end

  subgraph ecs["ECS Fargate, private subnets"]
    web["web service<br/>Next.js standalone"]
    api["api service<br/>Express + Socket.IO<br/>(sticky target group)"]
    worker["worker service<br/>BullMQ workers"]
    oneoff["migrate / admin<br/>one-off tasks"]
  end

  subgraph data["Data plane"]
    pg[("RDS PostgreSQL 16<br/>Multi-AZ in prod")]
    redis[("ElastiCache Redis 7<br/>TLS + AUTH")]
    s3[("S3 media bucket<br/>private, SSE-KMS, versioned")]
    sm["Secrets Manager<br/>app secrets, Redis URL,<br/>RDS-managed DB password"]
    kms["KMS customer-managed key"]
    ses["SES v2<br/>DKIM, custom MAIL FROM"]
  end

  ai["OpenAI moderation API<br/>(optional)"]

  spa --> cf --> alb
  alb --> web
  alb --> api
  api --> pg
  api --> redis
  worker --> pg
  worker --> redis
  oneoff --> pg
  api --> s3
  worker --> s3
  api -->|DB password per new connection| sm
  worker --> ses
  api --> ses
  worker -.-> ai
  spa -->|presigned PUT / GET| s3
  s3 -.-> kms
  pg -.-> kms
  redis -.-> kms
```

Without `enable_cdn` (the aws-dev default) the browser reaches the load balancer directly.
The composition lives in one Terraform module,
[`infra/terraform/modules/deployment/main.tf`](../../infra/terraform/modules/deployment/main.tf);
`envs/aws-dev` and `envs/aws-prod` only pick sizes and safety switches. See
[ADR 0012](adr/0012-fargate-behind-one-alb-with-path-routing.md).

**One origin.** The ALB routes `/api/*`, `/socket.io/*` and `/up` to the API (listener
priority 100, sticky) and every other path on the host to the web app (priority 200).
The browser therefore only ever talks to `https://<domain>`, the refresh cookie (scoped to
`/api/auth`) is first-party, and the app itself needs no CORS. `CORS_ORIGINS` is still set
to the app URL and enforced (see [security.md](security.md)).

**Runtime configuration of the web app.** `NEXT_PUBLIC_*` values are inlined at build
time, so the web server renders `/env.js` per request from its own environment
([`apps/web/src/app/env.js/route.ts`](../../apps/web/src/app/env.js/route.ts),
[`apps/web/src/lib/runtime-env.ts`](../../apps/web/src/lib/runtime-env.ts)). One web image
runs in every environment. The CSP's media origins come from `MEDIA_ORIGINS` at run time
([`apps/web/src/middleware.ts`](../../apps/web/src/middleware.ts)).

### Local shape

`make up` starts the same containers with Docker Compose
([`deploy/compose/compose.yaml`](../../deploy/compose/compose.yaml) plus
[`compose.floci.yaml`](../../deploy/compose/compose.floci.yaml)): Postgres, Redis, Mailpit,
the moderation stub, the Floci AWS emulator (S3, KMS, Secrets Manager, SES, Route53)
provisioned by the production Terraform modules, a one-shot `migrate`, then `api`, `worker`
and `web`. In local compose the Next server proxies `/api/*` and `/socket.io/*` to the API
([`apps/web/next.config.ts`](../../apps/web/next.config.ts)), standing in for the ALB's path
rules. See [quickstart-local.md](../guides/quickstart-local.md) and
[ADR 0013](adr/0013-floci-for-local-aws.md).

### Web app pages

The web app is a client of the REST contract ([`docs/api/rest-contract.md`](../api/rest-contract.md))
and of the socket event map. The route tree under `apps/web/src/app` is:

| Area | Routes |
| --- | --- |
| Auth | `/login`, `/signup`, `/verify-email`, `/forgot-password`, `/reset-password` |
| Feed and discovery | `/` (home feed), `/search`, `/tags/[tag]`, `/leaderboard`, `/saved` |
| Communities | `/communities`, `/communities/new`, `/c/[slug]`, `/c/[slug]/settings`, `/invite/[code]` |
| Content | `/posts/[id]`, `/questions/[id]`, `/events`, `/events/new`, `/events/[id]`, `/events/[id]/edit` |
| People | `/u/[username]`, `/u/[username]/followers`, `/u/[username]/following`, `/settings` |
| Messaging | `/messages`, `/messages/[id]` |
| Notifications | `/notifications` |
| Moderation | `/moderation` (the desk), `/account/moderation`, `/account/moderation/[caseId]` (your own cases and appeals) |
| Administration | `/admin` |

Notification links built by the API (`hrefFor` in
[`apps/api/src/services/notification.service.ts`](../../apps/api/src/services/notification.service.ts))
target these routes. The web app is still being finished; this page does not describe its
internals.

## 3. The API process

One Node process serves HTTP and Socket.IO on the same port
([`apps/api/src/index.ts`](../../apps/api/src/index.ts)). Boot order:

1. Pin `TZ=UTC` before any import.
2. Load and validate configuration ([`apps/api/src/core/config.ts`](../../apps/api/src/core/config.ts)).
   Run `assertProductionConfig()`: it returns a list of problems; with `NODE_ENV=production`
   it throws, so a misconfigured deployment fails at boot. Elsewhere the problems are logged
   as warnings.
3. When `MIGRATE_ON_BOOT=true`, run the migration runner. The deployed stacks leave it off
   and run migrations as a separate step.
4. Register every job handler (needed for `JOBS_MODE=inline`).
5. Build the Express app (`createApp()` in [`apps/api/src/app.ts`](../../apps/api/src/app.ts),
   side-effect free so tests mount it in-process), attach the Socket.IO gateway
   ([`apps/api/src/realtime/gateway.ts`](../../apps/api/src/realtime/gateway.ts)) with the
   Redis adapter, and listen.
6. On `SIGTERM`/`SIGINT`: close the gateway (waiting for presence work in flight), stop
   accepting HTTP, close queues, Redis and the pool. A 25 second timer forces exit.

The worker ([`apps/api/src/worker.ts`](../../apps/api/src/worker.ts)) boots the same way,
installs a [`@socket.io/redis-emitter`](../../apps/api/src/realtime/emitter.ts) as the
realtime transport, starts one BullMQ `Worker` per queue and registers the repeatable
schedules:

| Job | Every | What it does |
| --- | --- | --- |
| `maintenance.expire-uploads` | 30 min | Deletes abandoned (PENDING over 24 h), rejected and never-attached (over 48 h) uploads |
| `maintenance.event-reminders` | 5 min | One reminder to GOING attendees of events starting within the hour |
| `maintenance.lift-suspensions` | 5 min | Ends timed account suspensions that ran out |
| `maintenance.reconcile-counters` | 6 h | Recomputes every denormalised counter from the rows, lifts expired community suspensions |
| `notifications.email` | 15 min | Emails digests of notifications unread for over an hour (at most one per user per 6 h) |

Repeatable jobs are keyed by name and interval (`jobId: name`), so every worker task
registering them on boot leaves exactly one schedule.

## 4. Request lifecycle

### HTTP

```mermaid
sequenceDiagram
  participant B as Browser
  participant E as ALB / CloudFront
  participant M as Middleware (app.ts)
  participant R as Route + controller
  participant S as Service
  participant D as Postgres
  participant X as Effects (after commit)

  B->>E: POST /api/posts (Bearer access token)
  E->>M: forwarded (sticky cookie on /api)
  M->>M: request id, pino-http log, helmet, CORS, cross-site Origin check, cookies, JSON (1 MB)
  M->>R: router (routes/index.ts MOUNTS)
  R->>R: authenticate: verify JWT, reload user, compare token_version
  R->>R: rateLimit (Redis, per user or IP)
  R->>R: controller: zod parse(body/query/params)
  R->>S: service(actor, input)
  S->>D: BEGIN; loadContext; checks; writes; counters; notify()
  D-->>S: COMMIT
  S->>X: flush: socket emits, job enqueues, after() callbacks
  S-->>R: DTO via presenter
  R-->>B: 201 JSON (X-Request-Id)
```

The pieces, in order (all in [`apps/api/src/app.ts`](../../apps/api/src/app.ts) unless named):

1. **Request id.** A client `X-Request-Id` matching `^[\w-]{8,64}$` is kept, otherwise a new
   ULID. It is echoed in the response and in every error body.
2. **Access log.** `pino-http`, skipping `/up` and `/api/ready`; local signed media tokens in
   the URL are masked. Secret-bearing fields are redacted by the logger
   ([`apps/api/src/core/logger.ts`](../../apps/api/src/core/logger.ts)).
3. **Headers.** Helmet with `default-src 'none'` and `frame-ancestors 'none'` (the API
   serves JSON only), cross-origin resource policy relaxed so signed local media can load.
4. **CORS** for `CORS_ORIGINS` (default: `APP_WEB_URL`) with credentials, plus a second check
   that rejects any non-GET request carrying a foreign `Origin` (`403 CORS_ORIGIN_DENIED`).
5. **Authentication** per route: `authenticate` or `optionalAuth`
   ([`apps/api/src/middleware/auth.ts`](../../apps/api/src/middleware/auth.ts)). The JWT is
   verified and then the user row is reloaded, so a ban, a deactivation or a
   `token_version` bump takes effect on the very next request.
6. **Rate limits** per route ([`apps/api/src/middleware/rate-limit.ts`](../../apps/api/src/middleware/rate-limit.ts)),
   stored in Redis so the budget is shared by every task.
7. **Controller**: parse input with zod (`parse()` in
   [`apps/api/src/core/validate.ts`](../../apps/api/src/core/validate.ts)), call one service
   function with the `Actor`, send the DTO.
8. **Service**: business rules, usually inside `withTransaction`, then presenters build DTOs.
9. **Errors**: an `HttpError` becomes its status and stable `code`; body-parser errors become
   `400 BAD_REQUEST` or `413 PAYLOAD_TOO_LARGE`; anything else is logged and returned as
   `500 INTERNAL` with the request id and no detail. Express 5 forwards rejected promises
   from async handlers, so controllers need no wrapper.

### Socket

```mermaid
sequenceDiagram
  participant B as Browser (socket.io-client)
  participant G as Gateway (API task)
  participant Rd as Redis
  participant D as Postgres

  B->>G: handshake /socket.io, auth: { token }
  G->>D: actorFromToken (same check as HTTP)
  alt rejected
    G-->>B: connect_error MISSING / INVALID / BANNED / DEACTIVATED
  else accepted
    G->>G: join user:<id> (and "staff" for staff)
    G->>Rd: presence ZADD; announce online to followers and DM contacts
    B->>G: chat:subscribe { communityId } (ack)
    G->>D: same membership rule as GET /api/chat/...
    G-->>B: ack { ok: true } and join chat:<communityId>
  end
  Note over G,Rd: emits from any API task or the worker reach this socket through the Redis adapter
```

Clients never name a room. They ask to subscribe and the gateway applies the same rule the
REST read applies. Delivery is at most once and only after commit; a client that
reconnects refetches what it shows. Details, including presence and revalidation, are in
[realtime.md](realtime.md).

## 5. After-commit effects

Writes that must also notify sockets, enqueue jobs or send notifications use the `Effects`
buffer in [`apps/api/src/core/effects.ts`](../../apps/api/src/core/effects.ts):

```ts
return withTransaction(async (trx, fx) => {
  const msg = await dmRepo.insertMessage(..., trx);
  fx.emit([rooms.user(recipientId)], "dm:message", { threadId, message });
  fx.job("moderation.scan", { targetType: "DM_MESSAGE", targetId: msg.id });
  return msg;
});
```

- `fx.emit`, `fx.disconnect`, `fx.job` and `fx.after` only queue a closure.
- `withTransaction` runs the transaction and calls `fx.flush()` only after a successful
  commit. A rolled-back transaction emits nothing and enqueues nothing.
- `flush()` runs the closures in order; a failing effect is logged and never fails the
  request, because the write already happened.
- `withEffects` gives the same contract for single-statement writes without a transaction.

The consequence is a clear delivery contract: realtime events and jobs are at most once,
never for data that does not exist. A crash between commit and flush loses the effects
(the socket event, the job). The maintenance jobs and client refetches cover the
important cases; there is no outbox table. See [ADR 0009](adr/0009-after-commit-effects.md).

`notify()` ([`apps/api/src/services/notification.service.ts`](../../apps/api/src/services/notification.service.ts))
writes the notification row inside the caller's transaction and registers an `fx.after`
that pushes `notification:new` and the new unread count.

## 6. Background jobs: `JOBS_MODE`

Jobs are named handlers with a JSON payload
([`apps/api/src/jobs/registry.ts`](../../apps/api/src/jobs/registry.ts)). The queue is the
first segment of the name (`moderation.scan` goes to the `moderation` queue).

| | `JOBS_MODE=queue` (default, every deployment) | `JOBS_MODE=inline` (tests, tiny installs) |
| --- | --- | --- |
| Where handlers run | The worker process | The API process, right after commit, inside `fx.flush()` |
| Retries | 5 attempts, exponential backoff from 5 s | None: an error is logged and swallowed |
| Scheduled jobs | Registered by the worker | None (no digests, reminders, upload expiry, counter reconcile) |
| Request latency | Unaffected | The request waits for the handler (a moderation call, image re-encode) |
| Production guard | OK | Flagged by `assertProductionConfig` |

The integration suite runs inline so assertions are deterministic
([`apps/api/test/integration/env.ts`](../../apps/api/test/integration/env.ts)).

Jobs in use:

| Job | Enqueued by | Handler |
| --- | --- | --- |
| `moderation.scan` | Every content create and edit (posts, comments, chat and DM messages, questions, answers, events) | [`services/moderation/scan.service.ts`](../../apps/api/src/services/moderation/scan.service.ts) |
| `media.process` | `completeUpload` | `processUpload` in [`services/media.service.ts`](../../apps/api/src/services/media.service.ts) |
| `notifications.email` | Schedule | [`jobs/messaging.jobs.ts`](../../apps/api/src/jobs/messaging.jobs.ts) |
| `maintenance.*` | Schedule | [`jobs/messaging.jobs.ts`](../../apps/api/src/jobs/messaging.jobs.ts), [`jobs/social.jobs.ts`](../../apps/api/src/jobs/social.jobs.ts), [`jobs/moderation.jobs.ts`](../../apps/api/src/jobs/moderation.jobs.ts) |

See [ADR 0008](adr/0008-bullmq-on-redis.md).

## 7. Scaling model

| Component | How it scales | What makes that safe |
| --- | --- | --- |
| API tasks | Horizontally, CPU target tracking at 60% (aws-dev 1 to 2, aws-prod 2 to 10) | No in-process state that matters: sessions are in Postgres, rate limits and presence in Redis, socket fan-out through the Redis adapter. Each task has its own pool (`DB_POOL_MAX`, default 10). |
| Socket fan-out | Every emit is published through `@socket.io/redis-adapter`, so any task (or the worker's emitter) reaches sockets on every task | Rooms are names, not task-local objects |
| Long-polling fallback | ALB `lb_cookie` stickiness (86400 s) on the API target group | Socket.IO's polling transport needs every request of a session on the same task until it upgrades; the client tries WebSocket first |
| Worker tasks | Horizontally (aws-prod 2 to 6). Per task: concurrency 8 on `moderation`, 4 on each other queue | BullMQ locks jobs; handlers are idempotent or guarded (`transition()` on uploads, `claimReminder`, digest claim before send) |
| Repeatable schedules | Registered by every worker on boot | Keyed by name and interval, so one schedule exists |
| Web tasks | Horizontally (aws-prod 2 to 6) | Stateless; `/env.js` is rendered per request |
| Postgres | Vertically (instance class), storage autoscaling to 500 GiB | Keyset pagination everywhere, partial indexes for hot lists, no `COUNT(*)` on lists ([data-model.md](data-model.md)) |
| Redis | Vertically; aws-prod runs two nodes with automatic failover | `noeviction` so queued jobs are never evicted |

Hot paths avoid per-row queries: presenters batch (one query per kind of related row), the
DM inbox reads the last message per thread with one `DISTINCT ON`, unread counts are one
grouped join.

## 8. Failure modes

| Failure | Effect | Recovery |
| --- | --- | --- |
| Postgres unavailable | `/api/ready` returns 503; the ALB takes tasks out of rotation; requests fail with 500 | RDS Multi-AZ failover in aws-prod; new connections resolve the password from Secrets Manager |
| RDS rotates the master password | New connections fetch the new password (cached 60 s) | Automatic, no restart ([`db/connection-config.ts`](../../apps/api/src/db/connection-config.ts)) |
| Redis unavailable | `/api/ready` fails; rate limits fall back to in-memory insurance limiters (enforced per task, not 500); jobs cannot be enqueued (logged, the write still commits); socket fan-out across tasks stops; presence is unknown | ElastiCache failover in aws-prod. Jobs lost while Redis was down are not replayed; the maintenance jobs reconcile counters and expire uploads later, but a missed `moderation.scan` leaves that item `UNCHECKED` |
| Worker down | Jobs queue in Redis; uploads stay `COMPLETE` (images are not shown to anyone but the uploader until re-encoded and `READY`; other kinds are served); content stays `UNCHECKED`; held posts still get their case; no digests or reminders | Jobs run when a worker returns (5 attempts each) |
| Moderation provider down or slow | The provider retries twice inside one attempt (10 s timeout each); the job fails and BullMQ retries it; the item stays visible and `UNCHECKED` | Automatic retry; after 5 attempts the job is kept in the failed set (`removeOnFail: 5000`) |
| Mail transport fails | `sendMail` logs and returns `delivered: false`; the request succeeds | The user can resend verification or request another reset; a failed digest is not retried (the rows are claimed before sending) |
| An API task dies | Its sockets drop and reconnect to another task; its presence entries stop counting after 90 s | Clients reconnect and refetch |
| Crash between commit and effect flush | The write is durable, its socket event or job is lost | Clients refetch on navigation and reconnect; counters reconcile every 6 h |
| A deploy rolls out a bad image | ECS deployment circuit breaker rolls back automatically | Redeploy a previous image tag |

## 9. What is deliberately not here

- **Multi-tenancy.** One deployment is one network; there is no tenant column anywhere
  ([ADR 0001](adr/0001-single-network-per-deployment.md)).
- **An outbox or exactly-once delivery** for socket events and jobs (section 5).
- **Federation, mobile push, or a public API for third parties.** The API serves the web
  app; there are no API keys or OAuth clients.
- **Hard deletion of accounts.** `DELETE /api/users/me` deactivates and anonymises the account
  but keeps its row and content (shown as "Deleted user"); `GET /api/users/me/export` is the data
  export (see [security.md](security.md#known-limitations)).
