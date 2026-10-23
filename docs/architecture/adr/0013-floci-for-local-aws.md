# ADR 0013: Floci as the local AWS

## Status

Accepted.

## Context

Production uses S3 (presigned PUTs, SSE-KMS, CORS), SES v2 and Secrets Manager. Mocks in
code drift from the real APIs; testing against a real account costs money and needs
credentials. The Terraform modules should be exercised before they reach an account.

## Decision

- `make up` starts Floci (an open-source AWS emulator, image `floci/floci:2.3.0`) on host
  port 4577, and a one-shot `terraform` container applies
  [`infra/terraform/envs/local-floci`](../../../infra/terraform/envs/local-floci/main.tf) against it with the same `kms`, `storage`,
  `secrets` and `email` modules production uses ([`deploy/compose/compose.floci.yaml`](../../../deploy/compose/compose.floci.yaml)).
- The API and worker run with `STORAGE=s3`, `MAIL_MODE=ses` and `AWS_ENDPOINT_URL` pointing at
  the emulator; presigned URLs use `S3_PUBLIC_ENDPOINT=http://localhost:4577` so the browser
  can reach them. Floci relays SES mail to Mailpit (UI on 8026).
- Redis stays a plain container: Floci serves ElastiCache data only with Docker socket
  access, which the stack does not grant.
- The integration matrix runs `STORAGE=s3` and `MAIL_MODE=ses` rows against the same
  emulator ([`scripts/test-matrix.sh`](../../../scripts/test-matrix.sh)).
- `make up-aws` is the escape hatch: local containers with real S3 and SES.

## Consequences

Positive:

- The SDK calls, presigning, CORS and SES identity verification run for real, offline.
- Terraform modules are applied on every local start.

Trade-offs:

- Emulator fidelity limits: TLS-only bucket policy and versioning are off locally
  (`enforce_tls = false`, `enable_versioning = false`), IAM is not enforced.
- Emulator state lives in volumes; an interrupted start can leave a bucket the next apply
  trips over (`make down` resets both, see [troubleshooting.md](../../guides/troubleshooting.md)).
- One more container and image to keep pinned.

## Alternatives considered

- **Code-level mocks.** Fast, but they do not test presigning or CORS.
- **A real development account.** Accurate, but costs money and needs credentials for every
  contributor; kept as `make up-aws`.
- **Other emulators.** The project follows the sibling HRMS choice so one tool covers both.
