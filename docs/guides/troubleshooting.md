# Troubleshooting

Problems people actually hit, grouped by where they show up. For the local stack, start with
`make ps` and `make logs SERVICE=<name>`.

## Local stack

### A port is already in use

`make up` fails with `bind: address already in use`. Every host port is configurable in
`deploy/compose/.env` (or your shell): `SOCIAL_WEB_PORT` (3510), `SOCIAL_API_PORT` (5006),
`SOCIAL_PG_PORT` (5452), `SOCIAL_REDIS_PORT` (6389), `SOCIAL_MAILPIT_PORT` (8026),
`SOCIAL_SMTP_PORT` (1026), `SOCIAL_FLOCI_PORT` (4577), `SOCIAL_STUB_PORT` (5099). If you change
`SOCIAL_WEB_PORT`, run `make down` first: the bucket CORS rule and the API's origins are derived
from it when the stack is provisioned. The test scripts read the same variables.

### `BucketAlreadyExists` from the `terraform` one-shot

Seen after a `make up` that was interrupted (Ctrl-C, a laptop sleeping) while the `terraform`
container was applying. The emulator keeps its data in the `flocidata` volume, and Terraform
keeps its state in the separate `tfdata` volume
([`compose.floci.yaml`](../../deploy/compose/compose.floci.yaml)). An interrupted apply can leave
the bucket created in Floci but missing from the state, so the next apply tries to create it
again. Reset both together:

```bash
make down    # removes flocidata and tfdata (and the database and media volumes)
make up
```

`make logs SERVICE=terraform` shows the apply output.

### `run make env first`

Compose refuses to start because `SOCIAL_JWT_SECRET` or `SOCIAL_REFRESH_SECRET` is unset. Run
`make env` (or `make up`, which runs it). It never overwrites an existing
`deploy/compose/.env`; delete the file to regenerate it.

### Stale `.terraform` directories

`make tf-validate`, `make tf-lint` or a local `terraform` fails with errors about missing or
mismatched providers, or broken symlinks under `.terraform/providers`. Each environment has a
git-ignored `infra/terraform/envs/<env>/.terraform` directory. When there is no local
`terraform`, the Makefile runs the pinned container, which installs Linux provider binaries
there; a later local (for example macOS) `terraform`, or a run with a plugin cache directory
that does not exist at the same path, then finds providers or symlinks it cannot use. Delete
the directory and initialise again:

```bash
rm -rf infra/terraform/envs/*/.terraform
make tf-validate
```

The local stack's own Terraform is not affected: the `terraform` one-shot uses
`TF_DATA_DIR=/tfdata`, not the directory in the source tree.

### Which database does it connect to without `DATABASE_URL`?

Running the API or `pnpm db:migrate` outside compose without `DATABASE_URL` (and without
`DATABASE_SECRET_ARN`) connects to the compose Postgres,
`postgres://social:social@localhost:5452/social`
([`connection-config.ts`](../../apps/api/src/db/connection-config.ts)). Set `DATABASE_URL` to
use anything else.

## Media

### Presigned upload fails with `BadDigest` (or a checksum error)

AWS SDK v3 adds a CRC32 checksum of the body to presigned PUT URLs by default. The browser then
uploads the real file and S3 rejects it with `BadDigest`. The API's S3 clients are created with
`requestChecksumCalculation: "WHEN_REQUIRED"`
([`integrations/storage.ts`](../../apps/api/src/integrations/storage.ts)), which turns this off.
If you write another S3 client that presigns uploads, set the same option.

### Upload blocked by CORS, or images do not display

- The bucket CORS rule must list the web origin. Locally the `terraform` one-shot sets
  `http://localhost:<SOCIAL_WEB_PORT>`; on AWS it is the app URL plus
  `media_cors_extra_origins`.
- The web Content-Security-Policy must allow the storage origin: `MEDIA_ORIGINS`
  (`http://localhost:4577` locally, the bucket's virtual-hosted origin on AWS). A CSP violation in
  the browser console names the missing origin.
- Presigned GET URLs expire after `SIGNED_URL_TTL_SECONDS` (15 minutes). A tab left open shows
  broken images until the page refetches.

### `MEDIA_TYPE_MISMATCH` or `MEDIA_SIZE_MISMATCH` on complete

The API checks what landed in storage: the size must equal the declared `sizeBytes`, and the
first bytes must match the declared type. A renamed file (a PNG uploaded as `.jpg`) fails the
sniff. See [media.md](../architecture/media.md).

## Realtime

### WebSocket does not connect behind a proxy

Socket.IO lives at `/socket.io` on the same origin as the web app. Through any proxy:

- route `/socket.io/*` to the API (not to Next) and pass the `Upgrade` and `Connection`
  headers; otherwise the client falls back to HTTP long-polling;
- keep the idle timeout above Socket.IO's 25 second ping interval (the ALB uses 120 s,
  CloudFront an origin read timeout of 60 s);
- with more than one API task, keep load balancer stickiness on: a long-polling session must
  stay on the task that opened it until it upgrades.

The client tries WebSocket first and polling second
([`packages/api-client/src/socket.ts`](../../packages/api-client/src/socket.ts)).

### Socket connects then drops with `INVALID` or `MISSING`

The handshake carries the in-memory access token (`auth.token`). After 15 minutes the token
expires; the client must refresh and reconnect (`reconnectWithFreshToken`). A
`session:revoked` event before a disconnect means a ban, a suspension or a sign-out everywhere.

## Sign-in and sessions

### `403 CORS_ORIGIN_DENIED`

Every non-GET request that carries an `Origin` header outside `CORS_ORIGINS` (or `APP_WEB_URL`
when `CORS_ORIGINS` is empty) is refused ([`app.ts`](../../apps/api/src/app.ts)). Check that the
browser's origin, including scheme and port, is listed exactly.

### Signed out on every page load, or a refresh loop

- The refresh cookie `os_refresh` is `Secure` when `COOKIE_SECURE=true` (or `auto` with an
  `https` `APP_WEB_URL`). Over plain HTTP the browser drops it, so every refresh returns 401.
  Locally the compose file sets `COOKIE_SECURE=false`.
- The cookie is scoped to `/api/auth` on the API's origin. If the browser calls the API on a
  different site than the page, `SameSite=Lax` keeps the cookie off cross-site requests; serve
  the API on the same origin (the default) as the web app does.
- Presenting a refresh token that was already rotated more than 10 seconds ago revokes the
  whole session family (reuse detection). Two clients sharing one session can trigger this.

### Sign-in answers `429 RATE_LIMITED`

Accounts are never locked. Failed sign-ins (wrong password, wrong TOTP or recovery code, unknown
account) are throttled in Redis: 5 failures per account and IP in 15 minutes, and 50 per account
per hour across all IPs. Once either budget is spent every attempt gets the same
`429 RATE_LIMITED`, even with the right password, whether or not the account exists. Wait for the
window to pass, or sign in from another network (the per-IP budget is separate). A successful
sign-in clears the per-IP count. The route also has its own `auth` limit of 10 requests per minute
per IP.

### No verification or reset email

See [Mail](#mail).

## Mail

- **Locally**, every message lands in Mailpit at <http://localhost:8026>, relayed by the
  emulator's SES. Empty? `make logs SERVICE=api` shows `mail` errors.
- **`MAIL_MODE=outbox`** sends nothing: messages are written to `DATA_DIR/outbox/*.eml` (in the
  container, `/tmp/data` or the mounted `/app/data`). This is the default when `MAIL_MODE` is
  unset. On AWS every task that sends mail (api, worker, and the `admin` bootstrap task) gets
  `MAIL_MODE=ses` from Terraform ([deploy-aws.md](deploy-aws.md)).
- **No set-password link after `make aws-admin`**: the admin task sends it through SES like any
  other mail, so the sandbox, suppression and identity points below apply. Its log group
  `/open-social/<name_prefix>/admin` shows the send error, if any.
- **SES sandbox**: a new account delivers only to verified addresses. Request production access.
- **Suppression list**: the configuration set suppresses addresses that bounced or complained.
  A user who once bounced gets nothing until removed from the account-level suppression list.
- **`MAIL_FROM`** must be an address on the verified identity (`mail_domain`). With
  `make up-aws` it comes from `.env.aws` (required there); an exported `MAIL_FROM` in your
  shell would win over the file ([local-with-aws.md](local-with-aws.md)).
- Mail failures never fail the request that caused them, so a sign-up succeeds even when the
  verification email did not go out. Use "resend verification".

## Boot and configuration

### `Refusing to start with an insecure configuration`

With `NODE_ENV=production` the API and worker stop when a check fails; the message lists every
problem. The checks are in [configuration.md](configuration.md). Outside production the same
problems are logged as `config:` warnings.

### `Invalid configuration`

A variable failed validation (for example `PORT=abc`, an `APP_WEB_URL` that is not a URL, or
`REQUIRE_EMAIL_VERIFICATION=1`, which only accepts `true` or `false`). The message names the
field.

## Moderation and jobs

### Content never gets a verdict (`UNCHECKED`)

- The provider fails: wrong `OPENAI_API_KEY`, provider unreachable, or the stub not running.
  Scans retry 5 times and then give up; the worker log shows the error. (A provider of `openai`
  with no key, or Terraform's `set-me` placeholder, does not fail: the scan uses the `rules`
  provider and the log says so once per process.)
- Moderation is switched off (`moderation.enabled = false` in platform settings).
- You changed `MODERATION_PROVIDER` but an admin had already saved settings: the stored
  `moderation.provider` wins ([configuration.md](configuration.md#platform-settings)).
- With `JOBS_MODE=queue`, no worker is running.

### A held post never shows up for review

Its PREMODERATION case is opened in the same transaction as the post, whatever the scan job does,
so it is in the queue even with moderation off or a failing provider. If it is missing, check the
viewer: community moderators see only cases from communities they moderate (ACTIVE OWNER, ADMIN
or MODERATOR); platform staff see all.

### `JOBS_MODE=inline` surprises

Inline mode runs handlers in the API process after commit and swallows their errors: a failed
scan or media process is not retried. Scheduled jobs (digests, event reminders, upload expiry,
counter reconciliation, suspension lifting) never run, because only the worker schedules them.
Use `queue` for anything but tests.

### Rate limits during a Redis outage

Rate limits are kept in Redis. When Redis is unreachable each limiter falls back to an in-memory
insurance limiter with the same budget, so requests keep working and limits are enforced per API
task (the effective budget multiplies by the number of tasks) until Redis returns. `/api/ready`
still returns 503 meanwhile.
