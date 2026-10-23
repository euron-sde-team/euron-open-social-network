# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.x (latest minor) | Yes |
| Older minors | No |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository ("Security" tab, "Report a vulnerability"):
https://github.com/euron-sde-team/euron-open-social-network/security/advisories/new

Please include:

- the affected component (`apps/api`, `apps/web`, `infra/terraform/...`) and version or commit,
- a description of the issue and its impact,
- steps to reproduce, or a proof of concept,
- any suggested mitigation.

What to expect:

| Stage | Target |
| ----- | ------ |
| Acknowledgement | within 3 business days |
| Initial assessment and severity | within 7 business days |
| Fix or mitigation for critical / high issues | within 30 days |
| Coordinated public disclosure | after a fix is released, credited to you unless you prefer otherwise |

## Scope

In scope: the code in this repository and the infrastructure it provisions with its
default settings. We are most interested in:

- **Authentication and sessions.** Account takeover, token or refresh-cookie theft or
  reuse, bypassing email verification or two-factor, session fixation, password reset
  flaws, sign-in rate limits that can be sidestepped.
- **Direct messages.** Reading, sending into or listing conversations you are not part
  of; bypassing message requests or blocks.
- **Media uploads.** Uploading content types or sizes the API should refuse, reading
  another user's private media, presigned URLs that grant more than one object or
  outlive their purpose, stored XSS through file names or metadata.
- **Moderation bypass.** Publishing content that the configured moderation should hold,
  evading a suspension or ban, acting as a moderator without the role, tampering with
  reports, appeals or the audit log.
- **Private community leaks.** Posts, members, events or chat of a private community
  reaching non-members through any endpoint, search, notification, feed or embed.
- **Realtime authorization.** Joining Socket.IO rooms, receiving events (typing,
  presence, messages, notifications) or emitting events for conversations,
  communities or users you are not allowed to access.

Out of scope:

- **What an administrator can already see.** Platform administrators and community
  moderators can read content in the spaces they moderate, including reported private
  content. Reports that rely on that access are out of scope; reports that let someone
  gain it are very much in scope.
- **The demo seed.** `make demo` creates well-known demo accounts on purpose and
  refuses to run with `NODE_ENV=production`.
- **The moderation stub** (`apps/moderation-stub`), a test double that never runs in
  production.
- Findings that require a compromised host, compromised AWS account, or leaked
  deployment secrets.
- Denial of service through resource exhaustion of a deployment you operate yourself.
- Content moderation quality (a false negative of the rules or the AI provider) unless
  it comes from a bug that skips moderation altogether.

## Hardening checklist for operators

- Deploy with the Terraform in `infra/terraform` (or match it): private subnets, TLS
  everywhere, encryption at rest with a customer-managed key, Redis with TLS and an AUTH
  token, secrets only in Secrets Manager.
- Keep `NODE_ENV=production`: the API refuses to boot with development secrets, local
  storage, the mail outbox or the moderation stub.
- Serve the web app and the API on one HTTPS host so the refresh cookie stays
  first-party and `Secure`.
- Enable CloudFront and WAF (`enable_cdn`, on in `aws-prod`) for public deployments.
- Subscribe someone to the alarm topic (`alarm_email`).
