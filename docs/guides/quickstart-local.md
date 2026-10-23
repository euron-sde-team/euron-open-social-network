# Quickstart: run Euron Open Social locally

This guide starts the complete stack on your machine: the web app, the API, the background
worker, PostgreSQL, Redis, a mail catcher, a fake moderation provider, and an AWS emulator
(Floci) provisioned by the same Terraform modules that build production. You do not need an
AWS account or an AI provider key.

The stack is defined in [`deploy/compose/compose.yaml`](../../deploy/compose/compose.yaml)
(the cloud-agnostic base) plus [`deploy/compose/compose.floci.yaml`](../../deploy/compose/compose.floci.yaml)
(the emulated AWS overlay). The [`Makefile`](../../Makefile) wraps both.

## Prerequisites

| Requirement | Notes |
| --- | --- |
| Docker with Compose v2 | `make up` runs `docker compose ... up -d --build --wait` |
| GNU Make and `openssl` | `make env` generates local secrets with `openssl rand` ([`scripts/gen-local-env.sh`](../../scripts/gen-local-env.sh)) |
| Free host ports | 3510, 5006, 5452, 6389, 8026, 1026, 4577, 5099, all bound to `127.0.0.1` (see [Ports](#ports)) |
| Node 22 and pnpm 9.15.0 | Only to run tests or the apps outside Docker. Node is pinned in `.nvmrc`, pnpm in `package.json` (`packageManager`) |

To install pnpm through Corepack:

```bash
corepack enable
corepack prepare pnpm@9.15.0 --activate
pnpm install
```

## Start the stack

From the repository root:

```bash
make up
```

This does four things, in order:

1. `make env` writes `deploy/compose/.env` with random, local-only values for
   `SOCIAL_JWT_SECRET`, `SOCIAL_REFRESH_SECRET` and `SOCIAL_DEMO_PASSWORD`. It runs once and
   never overwrites an existing file; delete the file to regenerate it.
2. Builds the images (the API image is used by `api`, `worker` and `migrate`; the web image;
   the moderation stub) and starts Postgres, Redis, Mailpit, the moderation stub and Floci.
3. A one-shot `terraform` container waits for Floci, then applies
   [`infra/terraform/envs/local-floci`](../../infra/terraform/envs/local-floci/main.tf): the
   media bucket `open-social-local-media` with SSE-KMS and a CORS rule for
   `http://localhost:3510`, the KMS key, Secrets Manager secrets, a Route53 zone and the SES
   identity `social.example.test` with DKIM. Its state lives in the `tfdata` volume.
4. The one-shot `migrate` container applies [`db/migrations`](../../db/migrations/0001_init.sql),
   then `api`, `worker` and `web` start. `--wait` returns when the services are healthy.

When it finishes, `make up` prints the URLs. Then seed demo data:

```bash
make demo
```

`make demo` runs `node dist/cli.js demo:seed` inside the API container
([`apps/api/src/demo/seed.ts`](../../apps/api/src/demo/seed.ts)): 24 fictional people, 8
communities (public and private, with OPEN, APPROVAL and INVITE_ONLY join policies, one of them
the default community every new account joins), about 120 posts with images, reactions,
comments, polls, Q&A and 6 events. It goes through the real services, so counters, points and
notifications are what real use would produce. The seed refuses to run with
`NODE_ENV=production`, and a second run only prints the logins.

Every demo account shares one password, `SOCIAL_DEMO_PASSWORD`:

```bash
grep SOCIAL_DEMO_PASSWORD deploy/compose/.env
```

## Sign in

Open <http://localhost:3510> and sign in with an email (or username) and the demo password.

| Who | Email | Platform role |
| --- | --- | --- |
| Admin | `admin@example.com` | ADMIN: the admin console at `/admin`, every moderation action |
| Moderator | `quinn.lantern@example.com` | MODERATOR: the moderation desk at `/moderation` |
| Member | `juniper.vale@example.com` | USER (21 more members are listed under `/admin`) |

To try sign-up instead, use any address: registration is open by default and email
verification is required (`REQUIRE_EMAIL_VERIFICATION=true` in the compose file), so the
verification link arrives in Mailpit.

## Where things are

| What | URL |
| --- | --- |
| Web app | <http://localhost:3510> |
| API readiness | <http://localhost:5006/api/ready> |
| Mailpit (every email the stack sends) | <http://localhost:8026> |
| Floci (S3, SES, KMS, Secrets Manager) | <http://localhost:4577> |
| Moderation stub | <http://localhost:5099> |
| PostgreSQL | `postgres://social:social@localhost:5452/social` |
| Redis | `redis://localhost:6389` |

The browser only talks to the web app. Next.js proxies `/api/*` and `/socket.io/*` to the API
([`apps/web/next.config.ts`](../../apps/web/next.config.ts)), so the refresh cookie is
first-party exactly as it is behind the load balancer on AWS. The API port is published for
`curl` and the test tools.

### Mail

With the Floci overlay the API runs with `MAIL_MODE=ses`. The emulator's SES relays every
message to Mailpit (`FLOCI_SERVICES_SES_SMTP_HOST: mailpit`), so verification emails, password
resets and notification digests all show up at <http://localhost:8026>.

### Media

With the Floci overlay `STORAGE=s3`. Presigned upload and download URLs point at
`http://localhost:4577` (`S3_PUBLIC_ENDPOINT`), while the API talks to the emulator on the
compose network. The web app's Content-Security-Policy allows that origin through
`MEDIA_ORIGINS`.

### Moderation

The compose file sets `MODERATION_PROVIDER=stub`. The stub
([`apps/moderation-stub`](../../apps/moderation-stub/README.md)) returns low scores unless the
text carries a marker such as `[[mod:harassment=0.97]]`, or an image URL contains
`flag-image`. Post something with a marker to see a case open on the moderation desk. See
[moderation.md](../architecture/moderation.md) for the pipeline.

## Create an administrator

To promote your own account (or create one) on the local stack:

```bash
make admin EMAIL=you@example.com
```

This runs `node dist/cli.js admin:create --email ...` in the API container
([`apps/api/src/cli.ts`](../../apps/api/src/cli.ts)). Because the local stack sends mail
(`MAIL_MODE=ses`), the CLI does not print a password: it emails a set-password link, which
lands in Mailpit, and prints that it did so. If the link cannot be sent, it creates nothing,
prints why and exits non-zero; rerun with `--print-password` on your own machine to get a
one-time password instead. For an existing email the command only promotes the account to
ADMIN and sets it ACTIVE and verified; its password is left as it is (use "Forgot password" if
you need a new one).

## Day-to-day commands

| Command | Does |
| --- | --- |
| `make ps` | Status of every container |
| `make logs SERVICE=api` | Tail one service (`api`, `worker`, `web`, `migrate`, `floci`, `terraform`, ...) |
| `make down` | Stop the stack and delete its volumes |
| `make help` | List every target |

## Ports

Every published port is bound to `127.0.0.1` and can be changed in `deploy/compose/.env` (or
your shell) if it clashes with something else:

| Service | Host port | Variable |
| --- | --- | --- |
| Web | 3510 | `SOCIAL_WEB_PORT` |
| API | 5006 | `SOCIAL_API_PORT` |
| PostgreSQL | 5452 | `SOCIAL_PG_PORT` |
| Redis | 6389 | `SOCIAL_REDIS_PORT` |
| Mailpit UI | 8026 | `SOCIAL_MAILPIT_PORT` |
| Mailpit SMTP | 1026 | `SOCIAL_SMTP_PORT` |
| Floci | 4577 | `SOCIAL_FLOCI_PORT` |
| Moderation stub | 5099 | `SOCIAL_STUB_PORT` |

Changing `SOCIAL_WEB_PORT` also changes `APP_WEB_URL`, `PUBLIC_API_URL`, `CORS_ORIGINS` and the
bucket CORS origin, because the compose files and the `terraform` one-shot derive them from it.
Run `make down` first so the bucket is recreated with the new origin.

## Reset

```bash
make down    # deletes the database, Redis, media, emulator and Terraform state volumes
make up
make demo
```

`make down` removes every volume (`pgdata`, `redisdata`, `mediadata`, `flocidata`, `tfdata`), so
the next `make up` starts from an empty database and a freshly provisioned emulator.
`deploy/compose/.env` survives, so the demo password stays the same.

## Next steps

- [Local stack against real AWS](local-with-aws.md)
- [Deploy to AWS](deploy-aws.md)
- [Configuration reference](configuration.md)
- [Testing](testing.md)
- [Walkthrough: follow one message through the code](walkthrough.md)
- [Troubleshooting](troubleshooting.md)
