# Deploy to AWS

This guide deploys Euron Open Social to an AWS account with the Terraform in
[`infra/terraform`](../../infra/terraform). Two environments ship ready to use:

| Environment | Directory | Shape |
| --- | --- | --- |
| `aws-dev` | [`envs/aws-dev`](../../infra/terraform/envs/aws-dev/main.tf) | A full, cheaper copy of production: 2 AZs, one NAT, single-AZ database, one Redis node, one task per service, no deletion protection, no CDN by default |
| `aws-prod` | [`envs/aws-prod`](../../infra/terraform/envs/aws-prod/main.tf) | 3 AZs with a NAT per AZ, Multi-AZ database, two Redis nodes with failover, at least two tasks per service, deletion protection, CloudFront and WAF, a year of logs |

Both call one module, [`modules/deployment`](../../infra/terraform/modules/deployment/main.tf),
with different sizes and safety switches. What gets built is described in
[HLD.md](../architecture/HLD.md) and [ADR 0012](../architecture/adr/0012-fargate-behind-one-alb-with-path-routing.md):
one host name, one Application Load Balancer that sends `/api/*`, `/socket.io/*` and `/up` to
the API service (with load balancer stickiness) and everything else to the web service, plus a
worker service with no inbound traffic.

## Prerequisites

| Requirement | Notes |
| --- | --- |
| Terraform 1.10 or newer | `required_version = ">= 1.10.0"`; the repository pins 1.16.6 for its containers |
| Docker with `buildx` | `make aws-deploy` builds and pushes the images |
| AWS CLI v2 and `python3` | Used by [`scripts/aws-deploy.sh`](../../scripts/aws-deploy.sh) and [`scripts/aws-run-task.sh`](../../scripts/aws-run-task.sh) |
| Credentials for the target account | Enough to create VPC, ECS, RDS, ElastiCache, S3, KMS, Secrets Manager, SES, ACM, Route53, CloudFront, WAF, IAM and CloudWatch resources |
| A domain | One host serves everything, for example `app.example.com` |
| DNS | Either a Route53 hosted zone (`route53_zone_id`: certificates and records are created for you), or an existing ACM certificate (`certificate_arn`) and DNS you manage by hand. The CDN (`enable_cdn`) requires `route53_zone_id`: the cdn module creates its us-east-1 certificate validation records and the alias records in that zone |
| SES production access | New accounts are in the SES sandbox and can only send to verified addresses. Request production access in the target region before real users sign up, or verification emails will not arrive |

### Mail domain

The [email module](../../infra/terraform/modules/email/main.tf) creates an SES domain identity
for `mail_domain` (default: `domain`), a configuration set that requires TLS and suppresses
bounces and complaints, and a custom MAIL FROM subdomain so SPF aligns. With a Route53 zone it
also writes the three DKIM CNAMEs, the MAIL FROM MX and SPF records and a DMARC record
(`p=none` by default, `dmarc_policy`). Without a zone, publish those records yourself; the
identity stays pending until DKIM verifies.

## 1. Configure the environment

```bash
cd infra/terraform/envs/aws-dev
cp terraform.tfvars.example terraform.tfvars
```

Edit [`terraform.tfvars.example`](../../infra/terraform/envs/aws-dev/terraform.tfvars.example)'s copy:

| Variable | Notes |
| --- | --- |
| `region` | The deployment region. `aws-deploy.sh` reads it from this file |
| `name_prefix` | Prefix for every resource. The media bucket is `<name_prefix>-media`, so it must be globally unique |
| `domain` | The one public host |
| `route53_zone_id` or `certificate_arn` | See Prerequisites |
| `mail_domain` | Optional, defaults to `domain` |
| `alarm_email` | Optional. Alarms go to an SNS topic; this subscribes an address (confirm the email SNS sends) |
| `enable_cdn` | `false` in aws-dev, `true` in aws-prod by default. With it on, CloudFront sends a generated secret header (`X-Origin-Verify`) and the load balancer answers requests without it with 403, so the CDN and its WAF cannot be bypassed |
| `cpu_architecture` | Optional, `X86_64` (default) or `ARM64`; see [Graviton (ARM64)](#graviton-arm64) |
| `app_db_secret_arn`, `app_db_username` | Optional least-privilege database role for the api and worker, created by hand after the first deploy; see [operations.md](operations.md#least-privilege-database-role) |
| `openai_api_key` or `create_openai_secret` | Optional AI moderation; see below |
| `moderation_provider` | Optional override (`rules` or `openai`) |
| `media_cors_extra_origins` | Extra bucket CORS origins, for example `["http://localhost:3510"]` for [local-with-aws.md](local-with-aws.md) |
| `api_extra_environment` | Extra API and worker environment variables (merged over the module's) |
| `db_instance_class`, `cache_node_type` | Sizes, see [Sizing](#sizing) |

`*.tfvars` files are git-ignored; only the `.example` files are committed.

### AI moderation

Without a key the deployment uses the built-in `rules` provider. To use OpenAI moderation,
either set `openai_api_key` (the value then lands in Terraform state) or set
`create_openai_secret = true` and put the key in by hand:

```bash
aws secretsmanager put-secret-value --secret-id <name_prefix>/openai \
  --secret-string '{"OPENAI_API_KEY":"<key>"}'
```

When a key or the secret is configured, the module defaults `MODERATION_PROVIDER` to
`openai`. With `create_openai_secret = true` and no key, the secret holds the placeholder
`set-me`: the API boots (the production guard only checks that the variable is non-empty) and
every scan then fails, leaving content `UNCHECKED`. Put the real key in before you deploy, then
roll the api and worker services. After the first admin settings save, the provider is read
from platform settings rather than the environment ([configuration.md](configuration.md#platform-settings)).

### Remote state

State contains generated secrets (JWT and refresh signing keys, the TOTP encryption key, the
Redis AUTH token, the CloudFront origin header, any OpenAI key you passed). For anything shared, copy
[`backend.tf.example`](../../infra/terraform/envs/aws-dev/backend.tf.example) to `backend.tf`
and point it at a private, versioned, encrypted S3 bucket. It uses S3-native locking
(`use_lockfile = true`), so no DynamoDB table is needed.

## 2. Deploy

From the repository root:

```bash
make aws-deploy ENV=aws-dev
```

`TAG` defaults to the short commit hash (12 characters). The script
([`scripts/aws-deploy.sh`](../../scripts/aws-deploy.sh)) runs six steps:

1. `terraform apply -target=module.social.module.ecr`: the two image repositories (and the KMS
   key that encrypts them). Repositories are `IMMUTABLE`, scan on push, and keep a bounded
   number of images.
2. Builds the api and web images with `docker buildx` for `PLATFORM` (`linux/amd64` by
   default), tags them with `TAG` and pushes them. See [Graviton (ARM64)](#graviton-arm64).
3. `terraform apply -target=module.social.module.migrate`: what the migration task needs
   (network, database, the task definition).
4. Runs the `migrate` one-off task and waits for it to exit 0
   ([`scripts/aws-run-task.sh`](../../scripts/aws-run-task.sh)).
5. `terraform apply` for everything else: cache, edge, CDN, the api, worker and web services,
   observability.
6. `aws ecs wait services-stable` for the three services, then prints the app URL.

The script warns, but does not stop, when the working tree has uncommitted changes: the images
are built from the tree as it is.

### Without a Route53 zone

Pass `certificate_arn`. Then publish by hand: the certificate validation records (output
`certificate_validation_records`, when the module created the certificate), a CNAME (or
alias) from `domain` to `load_balancer_dns_name`, and the SES records described above.

## 3. Create the first administrator

```bash
make aws-admin ENV=aws-dev EMAIL=you@example.com
```

This runs the `admin` one-off task (`node dist/cli.js admin:create --email ...`) and prints its
log. For a new email the command creates the account and emails a set-password link to that
address through SES. For an existing account it only promotes it to ADMIN (and activates and
verifies it); its password is never changed, so use "Forgot password" if you do not know it.
It never prints a password, because the task's stdout is kept in CloudWatch Logs
(`/open-social/<name_prefix>/admin`); `--print-password` exists for local use only, do not pass
it here. If the link cannot be emailed (SES refuses, or mail is not configured) the command
creates nothing, prints the reason and exits non-zero: fix the mail settings and run it again.

The admin task definition carries the same mail settings as the api (`MAIL_MODE=ses`,
`MAIL_FROM`, `SES_REGION`, `SES_CONFIGURATION_SET`, `APP_WEB_URL`, `PRODUCT_NAME`), the
`TOTP_ENCRYPTION_KEY` secret, and a task role that may send mail through the deployment's SES
identity and configuration set only. So, before running it:

- The SES domain identity must show DKIM verified (see above).
- While the SES account is in the sandbox, the recipient address must be verified too
  (`aws sesv2 create-email-identity --email-identity you@example.com`).

Then open the link, set a password, sign in at `https://<domain>` and turn on two-factor
sign-in (TOTP). If no mail arrives, check the admin log group and the SES suppression list.

### Graviton (ARM64)

Every task runs on `cpu_architecture` (`X86_64` by default). `ARM64` runs on Graviton, which
costs less per vCPU, but needs images built for `linux/arm64`:

```hcl
# terraform.tfvars
cpu_architecture = "ARM64"
```

`scripts/aws-deploy.sh` derives `PLATFORM` from that line (`linux/arm64` for `ARM64`,
`linux/amd64` otherwise) and refuses a `PLATFORM` that disagrees, because a mismatched image
builds fine and then dies at start with `exec format error`. Building for the other
architecture than your machine's needs QEMU emulation for buildx
(`docker run --privileged --rm tonistiigi/binfmt --install all`) and is slower. Switching an
existing deployment: set the variable and run `make aws-deploy` once; the new task definitions
and the new images go out together.

## Sizing

From [`envs/aws-dev/main.tf`](../../infra/terraform/envs/aws-dev/main.tf),
[`envs/aws-prod/main.tf`](../../infra/terraform/envs/aws-prod/main.tf), their `variables.tf`, and
the defaults in [`modules/deployment/variables.tf`](../../infra/terraform/modules/deployment/variables.tf):

| Setting | aws-dev | aws-prod |
| --- | --- | --- |
| Availability zones | 2 | 3 |
| NAT gateways | 1 (shared) | 1 per AZ |
| KMS and Secrets Manager interface endpoints | no | yes |
| CloudFront + WAF | off (`enable_cdn = false`) | on (`enable_cdn = true`, WAF enabled) |
| Database | `db.t4g.small`, single-AZ, 3 days of backups | `db.t4g.medium`, Multi-AZ, 14 days of backups |
| Database storage | 20 GiB gp3, autoscaling to 100 GiB | same defaults (override `db_allocated_storage`, `db_max_allocated_storage`) |
| Redis | `cache.t4g.small`, 1 node, 1 day of snapshots | `cache.m7g.large`, 2 nodes with failover, 7 days of snapshots |
| api tasks | 1 to 2 | 2 to 10 |
| worker tasks | 1 | 2 to 6 |
| web tasks | 1 to 2 | 2 to 6 |
| Task size | api and worker 512 CPU units / 1024 MiB, web 256 / 512 (both envs) | same |
| CPU architecture | `X86_64` (`cpu_architecture`) | same; `ARM64` with linux/arm64 images |
| Deletion protection | off | on |
| KMS deletion window, secret recovery window | 7 days, 0 days | 30 days, 30 days |
| Log retention (services, flow logs) | 14 days | 365 days |

Autoscaling tracks 60% average CPU per service. Each API and worker process opens at most
`DB_POOL_MAX` (10) database connections; the database alarm fires at 80% of 200 connections.
See [operations.md](operations.md) for scaling and alarms.

## Cost notes

The largest fixed costs are the NAT gateways (one in aws-dev, three in aws-prod), the database
(Multi-AZ doubles it), the Redis nodes, the load balancer, and in aws-prod the interface
endpoints and CloudFront plus WAF. Fargate tasks scale with the minimum counts above. Media
storage and SES are usage-based. To trim aws-dev further, lower the instance classes; to trim
aws-prod, consider fewer AZs or turning off interface endpoints, at the cost of resilience.
Check current pricing for your region before choosing sizes.

## Updating

Deploy a new commit the same way:

```bash
make aws-deploy ENV=aws-prod
```

Migrations run (step 4) before the new task definitions roll out (step 5), so migrations must
be compatible with the code that is still running. Services deploy with
`minimum_healthy_percent = 100`, `maximum_percent = 200` and the deployment circuit breaker with
automatic rollback: a task set that fails its health checks is rolled back to the previous
task definition. Run only the migrations with `make aws-migrate ENV=...`, and only a plan with
`make aws-plan ENV=...`.

### Rolling back

Image tags are immutable, so every earlier image is still in the repository (within the
lifecycle limit). To return to a release, redeploy its tag:

```bash
make aws-deploy ENV=aws-prod TAG=<earlier-tag>
```

The build step rebuilds and pushes that tag again; because tags are immutable, ECR refuses a
push to a tag that already exists, so for a pure rollback skip the script and run the Terraform
step yourself:

```bash
terraform -chdir=infra/terraform/envs/aws-prod apply -var image_tag=<earlier-tag>
```

Migrations are forward-only ([operations.md](operations.md)): rolling back code does not roll
back the schema, so a rollback target must work with the current schema.

## Tearing down

```bash
terraform -chdir=infra/terraform/envs/aws-dev destroy
```

- aws-dev has `deletion_protection = false`: the database is destroyed without a final
  snapshot, the media bucket and image repositories are emptied (`force_destroy`,
  `force_delete`), and secrets are deleted immediately (recovery window 0).
- aws-prod has `deletion_protection = true`: the load balancer and database refuse deletion,
  a final snapshot `<name_prefix>-db-final` is taken, and the bucket and repositories are not
  force-emptied. Set `deletion_protection = false` in the env, apply, empty what must go, then
  destroy. Secrets and the KMS key enter their 30-day recovery and deletion windows.

## Next steps

- [Operations](operations.md): backups, migrations, secret rotation, alarms
- [Configuration reference](configuration.md)
- [Security](../architecture/security.md) and its [known limitations](../architecture/security.md#known-limitations)
