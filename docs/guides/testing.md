# Testing

Four layers, each runnable locally with one command:

| Layer | Command | Needs |
| --- | --- | --- |
| Unit tests (every package) | `make test` (`pnpm test`) | Node 22, pnpm |
| API integration tests | `make test-integration` | Docker (Postgres and Redis from compose) |
| Integration tests under every backend | `make test-matrix` | The full local stack (`make up`) and `redis-cli` on the host |
| Browser end-to-end tests | `make e2e` | The full local stack and Playwright browsers |

Plus static gates: `make lint`, `make typecheck`, the Terraform checks and the sanitization
scan.

## Unit tests

```bash
make test          # turbo run test: every package's vitest suite
pnpm --filter @open-social/api test
```

API unit tests live in [`apps/api/test/unit`](../../apps/api/test/unit) and cover the pure
domain rules: DM eligibility and send decisions, media allowlist and magic bytes, mentions and
tags, the moderation providers (OpenAI wire format, score folding, the rules provider), points
and levels, ranking, the report auto-hide threshold, RSVP and community access, unread math,
and the iCalendar export. The shared packages have their own suites
([`packages/api-client/test`](../../packages/api-client/test/http.test.ts): the HTTP client's
refresh dance, pagination, the socket controller, uploads), and the web app has component and
utility tests.

## Integration tests

```bash
make test-integration
```

This runs [`scripts/test-db.sh`](../../scripts/test-db.sh) (starts the compose Postgres and Redis
if nothing answers on ports 5452 and 6389), then the suite with:

```bash
TEST_DATABASE_URL=postgres://social:social@localhost:5452/social_test \
TEST_REDIS_URL=redis://localhost:6389/1 \
pnpm test:integration
```

How it works ([`vitest.integration.config.mts`](../../vitest.integration.config.mts)):

- The real Express app and Socket.IO gateway run in-process (supertest and `socket.io-client`)
  against a real Postgres and Redis.
- The global setup drops and recreates the database, then applies every migration once per
  run. [`guard.ts`](../../apps/api/test/integration/guard.ts) refuses any `TEST_DATABASE_URL`
  whose database name does not end in `_test`.
- [`env.ts`](../../apps/api/test/integration/env.ts) sets `NODE_ENV=test`, `JOBS_MODE=inline`
  (job handlers run right after commit, so assertions are deterministic), `BCRYPT_ROUNDS=4`, and
  defaults of `STORAGE=local`, `MAIL_MODE=outbox`, `MODERATION_PROVIDER=rules`, unless the
  environment overrides them.
- Rate limits are off unless a test turns them on (`RATE_LIMITS`, `RATE_LIMIT_STORE=redis`).
- Files share one database, so they run one at a time (`fileParallelism: false`); every test
  creates its own users and communities and never depends on another.

Run one file:

```bash
TEST_DATABASE_URL=postgres://social:social@localhost:5452/social_test \
  pnpm exec vitest run --config vitest.integration.config.mts dms
```

The suites ([`apps/api/test/integration`](../../apps/api/test/integration)) cover auth and
sessions, users and blocks, communities and membership, posts, comments, polls, Q&A, events,
chat, DMs, media, notifications, discovery, pagination, visibility, reports, moderation,
appeals, admin, and the realtime gateway.

## The backend matrix

```bash
make up            # Postgres, Redis, Floci, Mailpit and the moderation stub must be reachable
make test-matrix
```

[`scripts/test-matrix.sh`](../../scripts/test-matrix.sh) runs the whole integration suite 12
times, once per combination:

| Option | Values |
| --- | --- |
| `STORAGE` | `local`, `s3` (Floci) |
| `MAIL_MODE` | `outbox`, `smtp` (Mailpit), `ses` (Floci, relayed to Mailpit) |
| `MODERATION_PROVIDER` | `rules`, `stub` |

Each row gets its own database (`social_matrix_NN_test`) and its own Redis logical database
(1 to 12, flushed first with `redis-cli`, which must be installed on the host), so no state
carries over. It prints a table and exits non-zero if any row fails.

Narrow it down:

```bash
make test-matrix ONLY=s3           # only rows whose label contains "s3"
make test-matrix ONLY="mail=ses"   # one mail mode
make test-matrix FILTER=media      # pass a file filter to vitest
```

The script checks that every dependency answers first and tells you to `make up` otherwise.

## Browser end-to-end tests

```bash
make e2e           # = make up, make demo, then pnpm e2e
E2E_HEADED=1 pnpm e2e
```

Playwright is configured in [`e2e/playwright.config.ts`](../../e2e/playwright.config.ts): Chromium
at 1440x900, base URL `WEB_URL` (default `http://localhost:3510`), one worker and no retries
because the suites share the demo database, traces and screenshots kept on failure, HTML report
in `e2e/playwright-report`. Mail is read back from Mailpit. The suites themselves (`e2e/tests`)
are being added together with the web app; until they land, `pnpm e2e` finds no tests.

## Infrastructure checks

| Command | Does |
| --- | --- |
| `make tf-fmt` (`CHECK=1` to only check) | `terraform fmt -recursive` |
| `make tf-validate` | `fmt -check`, then `init -backend=false` and `validate` for `local-floci`, `aws-dev` and `aws-prod` |
| `make tf-lint` | tflint on every module and environment (plugins cached in a Docker volume) |
| `make tf-security` | checkov with [`infra/terraform/.checkov.yaml`](../../infra/terraform/.checkov.yaml); any unskipped finding fails. Each skip is justified inline next to the resource |
| `make sanitize` | [`scripts/check-sanitization.sh`](../../scripts/check-sanitization.sh): scans committable files for credentials, account ids, real email addresses and IPs |

Without a local `terraform`, the Makefile uses the pinned `hashicorp/terraform:1.16.6`
container (see [troubleshooting.md](troubleshooting.md) for stale `.terraform` directories).

## Continuous integration

[`.github/workflows/checks.yml`](../../.github/workflows/checks.yml) runs on pushes to `main` and
on pull requests: lint, typecheck, unit tests, `pnpm openapi --check` (the OpenAPI reference
must match the routes), the sanitization scan, and Terraform `fmt` and `validate` for every
environment.

The full pipeline is kept in [`.github/workflows-full`](../../.github/workflows-full/README.md) so it
does not run upstream: integration tests on Postgres and Redis service containers, gitleaks,
CodeQL and `pnpm audit`, tflint and checkov, multi-architecture image builds, and the e2e
workflow (the matrix plus the browser tests on the emulated stack). Move the files into
`.github/workflows/` in a fork to enable them.
