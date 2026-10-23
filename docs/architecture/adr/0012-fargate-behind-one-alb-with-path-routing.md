# ADR 0012: Fargate services behind one ALB with path routing

## Status

Accepted.

## Context

A deployment runs two public applications (the Next.js web app and the API with its
Socket.IO gateway), a worker with no inbound traffic, and two one-off commands (migrations
and admin bootstrap). The refresh cookie should be first-party, and the browser should not
need CORS for its own API. The audience wants a production AWS deployment without
operating a container platform.

## Decision

- ECS on Fargate for `api`, `worker` and `web`, and one-off task definitions `migrate` and
  `admin` on the API image ([`infra/terraform/modules/deployment/main.tf`](../../../infra/terraform/modules/deployment/main.tf)).
- One public ALB, one host name (`var.domain`): `/api/*`, `/socket.io/*` and `/up` go to the
  API (listener rule priority 100, sticky), everything else to the web app (priority 200).
  Unknown hosts get a fixed 404; port 80 redirects to 443; TLS policy
  `ELBSecurityPolicy-TLS13-1-2-2021-06` ([`modules/edge/main.tf`](../../../infra/terraform/modules/edge/main.tf)).
- Optional CloudFront with WAF (`enable_cdn`, on by default in `aws-prod`): the ALB then
  accepts only CloudFront's origin-facing ranges, `TRUST_PROXY` becomes 2
  ([`modules/cdn/main.tf`](../../../infra/terraform/modules/cdn/main.tf)).
- Every service from one `service` module: own security group (ingress only from the ALB),
  execution and task roles, read-only root filesystem with a writable `/tmp`, no public IP,
  ECS Exec disabled, circuit breaker with rollback, CPU target tracking at 60%
  ([`modules/service/main.tf`](../../../infra/terraform/modules/service/main.tf)).
- X86_64 by default (`make aws-deploy` builds `linux/amd64`); ARM64 is an input.

## Consequences

Positive:

- One origin: first-party cookie, no CORS for the app, one certificate.
- No nodes to patch; rollouts and rollbacks are ECS features.
- A hardening property fixed in the module applies to every service.

Trade-offs:

- Web and API share one ALB and its limits.
- API stickiness pins long-polling clients to a task, which skews load until they upgrade
  to WebSocket.
- Without the CDN the WAF is not attached; with it, the origin restriction is by CloudFront
  address ranges, not by a secret only this distribution knows.
- No host access for debugging; logs only.

## Alternatives considered

- **Separate hosts for app and API.** Needs CORS and a third-party cookie, or a cookie on
  the parent domain.
- **EKS.** A cluster to run for three services.
- **App Runner or Lambda.** Less network control; Lambda does not fit long-lived sockets
  and a worker.
