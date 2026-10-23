# Security architecture

The controls Euron Open Social has today, by area, with the file that implements each, and
an honest list of what it does not do yet. The STRIDE analysis built on these controls is in
[threat-model.md](threat-model.md). Paths are relative to the repository root.

Report vulnerabilities as described in [`SECURITY.md`](../../SECURITY.md).

## 1. Authentication

| Control | Detail | Where |
| --- | --- | --- |
| Password storage | bcrypt, cost `BCRYPT_ROUNDS` (12; the production guard refuses less) | [`apps/api/src/security/passwords.ts`](../../apps/api/src/security/passwords.ts) |
| Password policy | 10 to 128 characters, not a single repeated character, must not contain the email local part or the username | same |
| Enumeration resistance | Unknown accounts run a bcrypt compare against a dummy hash, so "no such account" and "wrong password" take the same time and return the same `INVALID_CREDENTIALS`. `forgot-password` and `resend-verification` always answer `202` | [`apps/api/src/services/auth.service.ts`](../../apps/api/src/services/auth.service.ts) |
| Failure throttling (no lockout) | Failed sign-ins (wrong password, wrong code, unknown account) are counted in Redis: 5 per account and IP per 15 minutes (`login-fail-pair`), 50 per account per hour across IPs (`login-fail-account`). Once either is spent every attempt gets the same `429 RATE_LIMITED`, right password or not, existing account or not (an unknown login is counted under its own name). A success clears the account and IP count. Nothing is written to the account, so nobody can lock someone else out | `login` in `auth.service.ts`, `failureBudget` in [`apps/api/src/middleware/rate-limit.ts`](../../apps/api/src/middleware/rate-limit.ts) |
| Two-factor | TOTP (RFC 6238, SHA-1, 6 digits, 30 s, one step of drift). The accepted time step is stored and any step at or below it is refused, so a code works once. The secret is stored AES-256-GCM encrypted (key derived with HKDF from `TOTP_ENCRYPTION_KEY`, the user id bound in as associated data). Enabling returns 10 single-use recovery codes, shown once and stored as HMACs; one can replace the code at sign-in (`recoveryCode`). Disabling needs the password and a current code (or a recovery code); `POST /totp/recovery-codes` replaces the codes with the password and a current code | [`apps/api/src/security/totp.ts`](../../apps/api/src/security/totp.ts), [`apps/api/src/repositories/recovery-code.repository.ts`](../../apps/api/src/repositories/recovery-code.repository.ts) |
| Account deletion and export | `DELETE /api/users/me` (password, plus a code when two-factor is on) deactivates and anonymises the account, revokes every session, token and socket, leaves every community and removes follows and unaccepted message requests; content stays as "Deleted user". `GET /api/users/me/export` streams the user's own data as JSON, 3 per day | [`apps/api/src/services/account.service.ts`](../../apps/api/src/services/account.service.ts) |
| Registration | `settings.registration`: `OPEN`, `INVITE_ONLY` (sign-up needs a valid, unexpired, not exhausted community invite code, which counts one use and puts the account in that community once verified) or `CLOSED` | `signup` in `auth.service.ts` |
| Email verification | Required by default (`REQUIRE_EMAIL_VERIFICATION`); 24 hour single-use token, stored hashed | `auth.service.ts`, [`apps/api/src/repositories/auth-token.repository.ts`](../../apps/api/src/repositories/auth-token.repository.ts) |
| Password reset | 1 hour single-use token, stored hashed; issuing a new one voids the old; a reset (and a password change) revokes every session, bumps `token_version` and disconnects every socket | same |
| Rate limits on credentials | `auth` 10 per minute per IP on sign-up, sign-in, verify, reset, change password and TOTP; `auth-mail` 5 per hour per IP on forgot-password and resend; `auth-refresh` 60 per minute per IP | [`apps/api/src/routes/auth.routes.ts`](../../apps/api/src/routes/auth.routes.ts) |

## 2. Sessions, cookies and CSRF

| Control | Detail |
| --- | --- |
| Access token | JWT HS256 signed with `JWT_SECRET`, 15 minutes, audience and issuer pinned, algorithm pinned on verify. Kept in browser memory only ([`apps/api/src/security/tokens.ts`](../../apps/api/src/security/tokens.ts)) |
| Per-request revocation | Every authenticated request reloads the user and compares `token_version`, so ban, deactivation, password change, reset and "sign out everywhere" cut off access tokens at once ([`apps/api/src/middleware/auth.ts`](../../apps/api/src/middleware/auth.ts)) |
| Refresh token | 32 random bytes in the `os_refresh` cookie: `httpOnly`, `SameSite=Lax`, `Path=/api/auth`, `Secure` whenever `APP_WEB_URL` is https (`COOKIE_SECURE=auto`). Only its SHA-256 is stored ([`apps/api/src/controllers/auth.controller.ts`](../../apps/api/src/controllers/auth.controller.ts)) |
| Rotation and reuse detection | Each refresh issues a new token in the same family and marks the old one rotated; presenting a rotated token more than 10 seconds later revokes the whole family and writes `session.reuse_detected` to the audit log |
| Session management | `GET /api/users/me/sessions` lists active sessions (user agent, IP, times); one can be revoked, or all with `logout-all`, which also disconnects every socket at once (`session:revoked` `SIGNED_OUT`) |
| CSRF | The access token is a bearer header a cross-site page cannot read or send. The cookie only reaches `/api/auth/*`, is `SameSite=Lax`, and any non-GET request with an `Origin` outside `CORS_ORIGINS` gets `403 CORS_ORIGIN_DENIED` before routing ([`apps/api/src/app.ts`](../../apps/api/src/app.ts)) |
| CORS | `cors()` allows credentials only for `CORS_ORIGINS` (default `APP_WEB_URL`); the production guard requires it to be set. In the deployed shape the app is same-origin, so CORS is a second line |
| Cross-tab refresh | The client serialises refreshes with the Web Locks API so two tabs do not trip reuse detection ([`packages/api-client/src/http.ts`](../../packages/api-client/src/http.ts)) |

See [ADR 0005](adr/0005-refresh-rotation-cookie-and-memory-token.md).

## 3. Rate limits

Limits are stored in Redis (`rate-limiter-flexible`, key prefix `rl:<name>`), so the budget is
shared by every API task. Signed-in callers are keyed by user, others by IP
([`apps/api/src/middleware/rate-limit.ts`](../../apps/api/src/middleware/rate-limit.ts)). A
spent budget is `429 RATE_LIMITED` with `Retry-After`. Each Redis limiter has an in-memory
insurance limiter with the same budget, used while Redis is not ready or a command fails, so
an outage degrades to per-task limits instead of 500s.

| Name | Budget | Applies to |
| --- | --- | --- |
| `auth` | 10 / min / IP | sign-up, sign-in, verify, reset, change password, TOTP enable and disable |
| `auth-mail` | 5 / h / IP | forgot password, resend verification |
| `auth-refresh` | 60 / min / IP | refresh |
| `posts` | 10 / min | create post |
| `comments` | 30 / min | create and edit comments |
| `reactions` | 120 / min | post and comment reactions |
| `community-create` | 5 / h | create a community |
| `community-writes` | 30 / min | community writes |
| `follows` | 60 / min | follow, unfollow |
| `qa-writes`, `qa-votes` | 20 / min, 120 / min | Q&A |
| `poll-votes`, `rsvps` | 60 / min each | polls, RSVPs |
| `event-create` | 10 / h | events |
| `chat-send`, `dm-send` | 30 / min each | messages |
| `dm-thread` | 20 / h | new direct threads and groups (in the service) |
| `media-create` | 60 per 10 min | upload creation (route) |
| `media-upload` | 120 / h | upload creation (service) |
| `reports` | 20 / h | reports |
| `appeals` | 10 / h | appeals |
| `search` | 60 / min / IP | search and typeahead |
| `login-fail-pair`, `login-fail-account` | 5 failures / 15 min per account and IP, 50 failures / h per account | sign-in failures (see Authentication) |
| `account-delete`, `account-export` | 5 / h, 3 / day | `DELETE /users/me`, `GET /users/me/export` |
| Socket requests | 30 per 10 s per socket; 20 live sockets per user | subscribe events and `presence:query` (ack `RATE_LIMITED`); the 21st connection is refused with `TOO_MANY_CONNECTIONS` ([`apps/api/src/realtime/gateway.ts`](../../apps/api/src/realtime/gateway.ts)) |

With CloudFront in front, Terraform sets `TRUST_PROXY=2` (one hop otherwise), so `req.ip` is
the viewer address as CloudFront saw it, not a client-supplied `X-Forwarded-For` entry. The
WAF adds a per-IP limit of 2000 requests per 5 minutes at the edge.

## 4. Input validation

- Every controller parses its input with a zod schema (`parse()` in
  [`apps/api/src/core/validate.ts`](../../apps/api/src/core/validate.ts)); failures are
  `400 VALIDATION_FAILED` with field paths, never a 500. Ids must match the ULID pattern.
- JSON bodies are capped at 1 MB; the database adds length CHECKs on every free-text column
  ([`db/migrations/0001_init.sql`](../../db/migrations/0001_init.sql)).
- URLs a user supplies (profile website, event virtual link) must be `http` or `https`.
- Search text becomes a prefix tsquery built only from letters, digits and underscores, so
  no query syntax reaches `to_tsquery`; `ILIKE` input has `%`, `_` and `\` escaped
  ([`apps/api/src/domain/tags.ts`](../../apps/api/src/domain/tags.ts)).
- All SQL goes through Kysely with bound parameters. The few raw `sql` fragments interpolate
  values as parameters, and identifiers only from fixed tables in code.
- Admin settings are validated strictly (`.strict()`, thresholds in 0..1 with `review <= hide`,
  bounded lists) so a bad value cannot reach the scanner
  ([`apps/api/src/controllers/admin.controller.ts`](../../apps/api/src/controllers/admin.controller.ts)).
- Emails rendered to HTML escape every interpolated value
  ([`apps/api/src/integrations/mail/templates.ts`](../../apps/api/src/integrations/mail/templates.ts)).

## 5. Authorisation

### Platform roles

| Role | Can |
| --- | --- |
| `USER` | Everything a member does, subject to community roles |
| `MODERATOR` (staff) | Read every community, moderate any of them, see every moderation case, warn and suspend accounts (not staff), decide appeals, read admin stats and directories |
| `ADMIN` | All of the above, plus ban and unban, change roles (never their own, never the last admin), change platform settings, make communities default or remove them, read the audit log |

Helpers: `requireActor`, `requireActive`, `requireStaff`, `requireAdmin` in
[`apps/api/src/core/context.ts`](../../apps/api/src/core/context.ts).

### Communities

All community decisions go through one pure function, `computeAccess()` in
[`apps/api/src/domain/community-access.ts`](../../apps/api/src/domain/community-access.ts)
(table in [LLD.md](LLD.md)). Only an `ACTIVE` membership confers rights; a suspended
moderator has no powers; nobody acts on someone of equal or higher rank or on the OWNER
(`outranks()`); rejoining never lifts a ban.

### Visibility rules in SQL

[`apps/api/src/repositories/visibility.ts`](../../apps/api/src/repositories/visibility.ts)
expresses the two rules every read applies as reusable Kysely expressions:

- `notBlocked(viewerId, column)`: no block in either direction between the viewer and the
  user in `column`. Feeds, comments, reactions lists, search, profiles, members, mentions,
  presence, DM history and notifications all apply it.
- `canReadCommunity(viewer, column)`: the community is `PUBLIC` and published, or the viewer
  is an `ACTIVE` member, or platform staff.

Every post list starts from `postRepo.visible()`, which applies both, so a new feed cannot
forget one ([`apps/api/src/repositories/post.repository.ts`](../../apps/api/src/repositories/post.repository.ts)).
Single reads (`loadReadablePost`, `loadQuestion`, `loadEvent`, profiles) answer **404**, not
403, for anything hidden by a block, a private community or a review hold.

### Blocks

A block is stored one way and enforced both ways. Blocking also removes follows in both
directions. A block stops DMs (staff included), notifications in either direction, mentions,
presence announcements and queries, typing relays, and group membership with the other
person. In a shared community chat, history omits the blocked person's messages, but live
events reach the whole room and the web app filters them by its block list.

### Private communities

Content (posts, comments, polls, Q&A, events, chat, media attached to them) is readable only
by `ACTIVE` members and staff; non-members get a limited community card (no rules). Mention
notifications go only to people who can read the community; a post from a private community
cannot be shared outside it; search lists private communities only to their members.

### Direct messages

Who may message whom is the pure `canMessage()` rule in
[`apps/api/src/domain/dm-eligibility.ts`](../../apps/api/src/domain/dm-eligibility.ts):
self, account status, blocks (never waived), staff, the recipient's privacy setting, a shared
community, and message requests for people the recipient does not follow
([ADR 0006](adr/0006-dm-eligibility-rule.md)). Every send re-evaluates it with fresh facts.
Thread ids are 404 to non-participants.

### Realtime

The gateway authenticates the handshake with the same function as HTTP, puts each socket in
its own `user:<id>` room, and lets clients join other rooms only through subscribe events
checked with the REST read rule ([realtime.md](realtime.md)). Losing access takes the
sockets out at once (`leaveRooms`): leaving, removal, a ban or a suspension in a community
leaves its `chat:` and `community:` rooms, leaving a group leaves its `thread:` room, and a
block closes the pair's 1:1 `thread:` room. `presence:query` answers only for people the
viewer could know about (a shared active community, a follow either way, a shared DM
thread), minus blocks.

## 6. Media

| Control | Detail |
| --- | --- |
| Allowlist | Declared MIME type must be on the list; SVG, HTML, XML, JavaScript, shell and executable types and extensions are refused by name ([`apps/api/src/domain/media-rules.ts`](../../apps/api/src/domain/media-rules.ts)) |
| Extension and purpose | The extension must belong to the type; avatars, covers and icons accept images only |
| Size | Per-kind limits (images 15 MB, video 200 MB, audio 50 MB, PDF and documents 25 MB) checked on the declaration and again on the stored object |
| Bytes, not claims | On complete, the stored object's size must equal the declared size and its first 4096 bytes must match the type's magic number and must not look like markup; otherwise the object is deleted |
| Presigned PUT | Signs `Content-Type` and `Content-Length`, valid 10 minutes, key chosen by the server |
| No URLs from clients | Content references media by upload id only; `claimUploads` checks owner, purpose, status and that the upload is not attached elsewhere ([`apps/api/src/services/media-attach.service.ts`](../../apps/api/src/services/media-attach.service.ts)) |
| Private bucket | Block Public Access, bucket-owner-enforced ownership, SSE-KMS, TLS-only bucket policy, CORS for the app origin only ([`infra/terraform/modules/storage/main.tf`](../../infra/terraform/modules/storage/main.tf)) |
| Signed reads | Every response signs fresh GET URLs that expire after `SIGNED_URL_TTL_SECONDS` (900); documents are served as attachments; `GET /media/:id` requires seeing what the upload is attached to |
| Metadata | Images are re-encoded by sharp without metadata (EXIF and GPS dropped), and no image is shown to anyone but its uploader until that has happened (`READY`); a HEIC the server cannot decode is rejected, never served with its metadata. `audio/mp4` must carry an audio brand (`M4A `, `M4B `, `M4P `) |

Details and gaps: [media.md](media.md).

## 7. Headers and CSP

- **API**: Helmet with `default-src 'none'` and `frame-ancestors 'none'`, `X-Powered-By`
  off, `Cross-Origin-Resource-Policy: cross-origin` (signed local media).
- **Web app**: a per-request CSP with a nonce and `strict-dynamic`, `object-src 'none'`,
  `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`; images, media and
  `connect-src` allowed only for `'self'`, the socket origin and the `MEDIA_ORIGINS` list
  ([`apps/web/src/middleware.ts`](../../apps/web/src/middleware.ts)). `'unsafe-eval'` only in
  development; `style-src 'unsafe-inline'` because the component library positions popovers
  with inline styles. Static headers: `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `X-Frame-Options: DENY`, a restrictive `Permissions-Policy`, `Cross-Origin-Opener-Policy: same-origin`
  ([`apps/web/next.config.ts`](../../apps/web/next.config.ts)).
- **Edge**: with the CDN, the managed security-headers response policy on every behavior;
  the ALB drops invalid header fields and uses the `ELBSecurityPolicy-TLS13-1-2-2021-06`
  policy; port 80 only redirects.

## 8. Secrets and the production guard

`assertProductionConfig()` in [`apps/api/src/core/config.ts`](../../apps/api/src/core/config.ts)
runs at API and worker boot and throws when `NODE_ENV=production` and any of these holds:

| Problem | Why it matters |
| --- | --- |
| `JWT_SECRET` or `REFRESH_SECRET` is the committed development default, or shorter than 32 characters | Anyone could mint access tokens |
| `JWT_SECRET` equals `REFRESH_SECRET` | Rotating one must not rotate the other |
| `CORS_ORIGINS` is not set | Credentialed CORS would fall back to `APP_WEB_URL` silently |
| `APP_WEB_URL` points at localhost | Emailed links would be wrong; cookies would not be `Secure` |
| `STORAGE=local` | Media on a container disk |
| `STORAGE=s3` without `S3_BUCKET` | |
| `MAIL_MODE=outbox`, or a real mode without `MAIL_FROM` | Mail written to disk instead of sent |
| `TOTP_ENCRYPTION_KEY` unset (the development default is derived from a public constant); a value that is not 32 bytes of base64 does not even parse | TOTP secrets would be decryptable by anyone with the source |
| `MODERATION_PROVIDER=openai` without `OPENAI_API_KEY` or with the placeholder `set-me`, or `MODERATION_PROVIDER=stub` | Every scan would fail. At run time a settings row saying `openai` without a usable key scans with the rules provider and logs a warning once |
| `JOBS_MODE=inline` | Background work on the request path, no retries |
| `BCRYPT_ROUNDS` below 12 | Weaker password hashes |

On AWS the secrets never appear in a task definition or a log: `JWT_SECRET` and
`REFRESH_SECRET` (64 random characters each, generated by Terraform), `TOTP_ENCRYPTION_KEY`
(32 random bytes, base64, its own secret `<name_prefix>/totp`; injected into the api, worker
and admin tasks, not migrate), `REDIS_URL` (with the AUTH token) and `OPENAI_API_KEY` are
Secrets Manager values injected by the ECS execution role ([`infra/terraform/modules/secrets/main.tf`](../../infra/terraform/modules/secrets/main.tf),
[`infra/terraform/modules/cache/main.tf`](../../infra/terraform/modules/cache/main.tf)). The
database password is the RDS-managed master secret, read by the task role for each new
connection and cached 60 seconds, so RDS can rotate it without a redeploy
([`apps/api/src/db/connection-config.ts`](../../apps/api/src/db/connection-config.ts)). The
generated values are in Terraform state; protect the state backend.

### Database role

Out of the box the api and worker connect as the RDS master user, which can run DDL. The
recommended post-deploy step is a non-master application role with data rights only
(`SELECT, INSERT, UPDATE, DELETE` on the tables, `USAGE, SELECT, UPDATE` on the sequences and
`EXECUTE` on the functions of the `public` schema, the same as default privileges for objects
later migrations create, and no `CREATE`), stored as a second Secrets Manager secret and wired
in with `app_db_secret_arn` and `app_db_username`. Migrations (and the admin bootstrap) keep
the master user. The exact SQL and steps are a runbook in
[operations.md](../guides/operations.md#least-privilege-database-role); Terraform does not
create the role, because it would need a network path and credentials into the private
database.

Locally, `make env` writes random secrets to `deploy/compose/.env` (git-ignored, mode 600)
([`scripts/gen-local-env.sh`](../../scripts/gen-local-env.sh)). `make sanitize` scans
committable files for credentials, account ids, real emails and IPs.

## 9. Logging

- Structured JSON (pino) with a request id on every line and in every error response
  ([`apps/api/src/core/logger.ts`](../../apps/api/src/core/logger.ts)).
- Redacted before writing: `authorization` and `cookie` request headers, `set-cookie`, and
  any `password`, `newPassword`, `currentPassword`, `passwordHash`, `password_hash`, `token`,
  `refreshToken`, `accessToken`, `totp`, `totpSecret`, `totp_secret`, `secret`, `code`,
  `recoveryCode(s)`, `code_hash`, `apiKey`, `authorization` or `cookie` field at the top
  level or up to three levels deep (so request bodies are covered); the paths are
  `SECRET_KEYS` in `logger.ts`, checked by `test/unit/logger-redaction.test.ts`.
- Local signed media tokens in URLs are masked in the access log.
- 500 responses carry only the request id; the stack trace stays in the log.
- On AWS, logs go to CloudWatch log groups encrypted with the deployment's KMS key, with
  `log_retention_days` (14 in aws-dev, 365 in aws-prod).

## 10. Infrastructure controls

| Control | Where |
| --- | --- |
| One customer-managed KMS key with annual rotation encrypts RDS, Redis at rest, S3, Secrets Manager, ECR and CloudWatch Logs; usage is granted per role and scoped with `kms:ViaService` | [`modules/kms`](../../infra/terraform/modules/kms/README.md), the IAM documents in [`modules/deployment/main.tf`](../../infra/terraform/modules/deployment/main.tf) |
| Media bucket: private, TLS-only policy (`aws:SecureTransport`), SSE-KMS, versioning with noncurrent expiry, app-origin CORS | [`modules/storage/main.tf`](../../infra/terraform/modules/storage/main.tf) |
| RDS: private subnets, not publicly accessible, `rds.force_ssl=1` (the API connects with `DB_SSL=require`), encrypted storage and Performance Insights, deletion protection and Multi-AZ in prod | [`modules/database/main.tf`](../../infra/terraform/modules/database/main.tf) |
| Redis: private subnets, TLS in transit required, AUTH token (64 characters), encrypted at rest, `noeviction` | [`modules/cache/main.tf`](../../infra/terraform/modules/cache/main.tf) |
| Network: tasks, RDS and Redis in private subnets with no public IP; per-service security groups granting access by group, never by CIDR; egress only HTTPS plus the database and cache; locked default security group; VPC flow logs; S3 gateway endpoint, and KMS and Secrets Manager interface endpoints in prod | [`modules/network`](../../infra/terraform/modules/network/README.md), [`modules/service/main.tf`](../../infra/terraform/modules/service/main.tf) |
| Least-privilege roles: the execution role can pull, log and read only the listed secrets; the api and worker task role can only get, put and delete media objects, use the key through S3, send mail through the one identity and configuration set, and read the DB secret; the migrate task role can only read the DB secret, the admin task role that plus sending mail through the same identity and configuration set | [`modules/deployment/main.tf`](../../infra/terraform/modules/deployment/main.tf) |
| Containers: read-only root filesystem with a writable `/tmp`, non-root `node` user, init process, ECS Exec disabled | [`modules/service/main.tf`](../../infra/terraform/modules/service/main.tf), [`infra/docker/api.Dockerfile`](../../infra/docker/api.Dockerfile) |
| Edge: TLS 1.2+ at the ALB, HTTP redirected; optional CloudFront (TLS 1.2_2021 minimum, HTTPS-only to the origin) with a WAF (AWS common rule set, known bad inputs, per-IP rate limit), and then the ALB accepts only CloudFront's origin-facing ranges and its listener rules require a generated secret header (`X-Origin-Verify`, kept only in Terraform state) that the distribution adds; requests without it get a fixed 403 | [`modules/edge/main.tf`](../../infra/terraform/modules/edge/main.tf), [`modules/cdn/main.tf`](../../infra/terraform/modules/cdn/main.tf) |
| Images: ECR with immutable tags and scan on push, KMS-encrypted | [`modules/ecr/main.tf`](../../infra/terraform/modules/ecr/main.tf) |
| Mail: SES identity with DKIM, a custom MAIL FROM domain for SPF alignment, a configuration set that requires TLS and suppresses bounces and complaints | [`modules/email/main.tf`](../../infra/terraform/modules/email/main.tf) |
| Policy gates: checkov (`make tf-security`), tflint, `terraform validate`, gitleaks and CodeQL in the opt-in pipeline | [`.github/workflows-full/`](../../.github/workflows-full/README.md) |

## Known limitations

Found by reading the code; each is a gap, not a design goal. They are repeated with risk
ratings in [threat-model.md](threat-model.md).

**Accounts and sessions**

1. **Signing out does not end the access token.** `logout` and revoking one session revoke
   the refresh family, but an access token already issued stays valid for up to 15 minutes
   (only `logout-all`, password change, reset, account deletion and ban bump `token_version`).
2. **Admin bootstrap trusts the mailbox.** `admin:create` emails a set-password link for a
   new admin (on AWS the admin task has the api's mail settings and an SES send permission
   scoped like the api's) and prints no password unless `--print-password` is passed, which
   the AWS scripts never do. Whoever controls that mailbox can claim the account until the
   link expires. For an existing account it only promotes it (role, active, verified) and
   never touches the password; if the link cannot be sent it creates nothing and exits
   non-zero.
3. **The account-wide sign-in budget can be spent by others.** 50 failures in an hour from
   any number of IPs throttle that account everywhere until the hour passes (nothing is
   locked, and a success elsewhere does not clear it). The per-IP budget alone cannot be
   used against the owner.
4. **`TOTP_ENCRYPTION_KEY` has no rotation path.** Changing it makes every stored TOTP
   secret and recovery code unusable (an operator has to clear `totp_enabled` for those
   accounts in the database); there is no re-encryption tool.
5. **Deleted accounts keep their content.** Posts, comments and messages stay, shown as
   "Deleted user"; nothing erases the content itself, and moderation records keep the ids.

**Realtime**

6. **`post:` rooms are left lazily.** Losing access to a community takes the sockets out of
   its `chat:` and `community:` rooms, not out of `post:` rooms already joined; those carry
   counts and new comments until the socket unsubscribes or reconnects.
7. **The connection cap counts presence entries,** so it is approximate across tasks: a task
   that died leaves its sockets counted for up to 90 seconds, and simultaneous handshakes can
   briefly exceed 20. Per-socket request budgets are in memory, per socket.

**Messaging**

8. **Declining a request is permanent for the pair**, for both people (no undo).

**Moderation**

9. **No rank check on case actions.** A community moderator can act on a case about content
   by a higher-ranked member of their community (an admin or the owner), although they could
   not suspend or ban that person from the member list. Acting on your own case is refused
   (`SELF_MODERATION`, platform admins excepted).
10. **Profiles are scanned on edit only,** and a flagged profile is never hidden automatically:
    it waits in the queue as a REVIEW case.

**Media**

11. **Video, audio and documents keep their metadata.** Only images are re-encoded.
12. **Signed media URLs outlive permission changes.** A URL handed out stays valid until
    `SIGNED_URL_TTL_SECONDS` (15 minutes) runs out, even if a block, a removal or a
    membership change happens in between.

**Privacy and notifications**

13. **Blocks do not apply to signed-out viewers**: a blocked person can read public
    communities while signed out (inherent to public content).
14. **The `chat` notification setting is stored but has nothing to silence:** community chat
    sends no notifications (it has unread counts and per-room mutes instead).

**Operations and configuration**

15. **`JOBS_MODE=inline` swallows job errors** (no retry) and runs no scheduled jobs; the
    production guard flags it.
16. **During a Redis outage rate limits are per task**: the in-memory insurance limiter keeps
    each budget on every task separately, so the effective budget is multiplied by the task
    count until Redis returns.
17. **The API connects to Postgres as the RDS master user by default**, so a compromised task
    has full DDL rights until the operator creates the application role
    ([Database role](#database-role)).
18. **The CloudFront origin header is a static secret**: it sits in Terraform state and the
    distribution's configuration, and rotation is a manual `terraform apply -replace`.
19. **No queue-depth or job-age alarm**: failed jobs alarm (`worker-failed-jobs`), but a worker
    that is down rather than failing shows only as missing side effects (with images, that
    means uploads that never appear, since unprocessed images are not shown).

### Fixed in the hardening pass

For readers of older copies of this list: account deletion and export; throttling instead of
a lockout anyone could trigger, with no account-existence signal; encrypted TOTP secrets,
recovery codes and a code to disable two-factor; immediate socket disconnect on sign-out
everywhere and password changes; admin bootstrap that never changes an existing password and
never prints one by default; room revocation; scoped presence queries; socket limits; the
message-request cap counting deleted messages; group history starting at `joined_at`; active,
non-self moderators only; appeals of auto-hidden content while the case is open; the report
threshold counting only the open case's active reporters; appeal overturns that do not undo
later decisions; premoderation cases opened with the post and mentions sent on approval; the
provider fallback and the `set-me` guard; scanning event locations, links and profiles;
moderation history for removals through the delete endpoints; images hidden until processed,
undecodable HEIC rejected, audio brands checked; digest opt-out, generic lines for message
requests and private communities, per-community notification settings applied; a limiter
that survives Redis outages; nested log redaction; and invite-only registration.
