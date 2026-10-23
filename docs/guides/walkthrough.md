# Walkthrough: follow one message

One story, start to finish, with the code that runs at each step. A new member, Avery, joins a
community, posts a photo, gets a reaction in real time, receives a message request, accepts it,
and later reports a reply that a moderator then removes. Every path below is under
[`apps/api/src`](../../apps/api/src/app.ts) unless stated otherwise. The layering
(route, controller, service, repository) is described in [LLD.md](../architecture/LLD.md).

Run it yourself on the local stack ([quickstart-local.md](quickstart-local.md)): sign up at
<http://localhost:3510>, and sign in as a demo member in a second browser profile.

## 1. Sign up and verify

`POST /api/auth/signup`

- [`routes/auth.routes.ts`](../../apps/api/src/routes/auth.routes.ts): the `auth` limiter
  (10 per minute per IP, in Redis via [`middleware/rate-limit.ts`](../../apps/api/src/middleware/rate-limit.ts)).
- [`controllers/auth.controller.ts`](../../apps/api/src/controllers/auth.controller.ts) `signup`:
  zod validation of email, username (3 to 30 letters, digits, underscores), display name and
  password.
- [`services/auth.service.ts`](../../apps/api/src/services/auth.service.ts) `signup`: checks
  `registration === "OPEN"` in platform settings, the password policy
  ([`security/passwords.ts`](../../apps/api/src/security/passwords.ts)), unique email and
  username, then inserts the user as `PENDING_VERIFICATION` inside `withTransaction` with an
  audit row. Outside the transaction it stores the SHA-256 of a random token in `auth_tokens`
  and emails the link ([`integrations/mail/mailer.ts`](../../apps/api/src/integrations/mail/mailer.ts)).
  The response is 202 `{ verificationRequired: true }`.

Avery clicks the link in Mailpit. `POST /api/auth/verify-email` consumes the token atomically
([`repositories/auth-token.repository.ts`](../../apps/api/src/repositories/auth-token.repository.ts)),
sets the account ACTIVE, joins every default community, and issues a session: an access token
(JWT, 15 minutes, carrying `token_version`) in the body, which the web app keeps in memory, and
a refresh token in the httpOnly `os_refresh` cookie scoped to `/api/auth`, stored only as a hash
in `sessions` ([`security/tokens.ts`](../../apps/api/src/security/tokens.ts)).

The web app then opens a socket with that token. The gateway
([`realtime/gateway.ts`](../../apps/api/src/realtime/gateway.ts)) authenticates it with the same
`actorFromToken` as HTTP ([`middleware/auth.ts`](../../apps/api/src/middleware/auth.ts)), joins
it to the room `user:<id>`, and records presence in Redis
([`realtime/presence.ts`](../../apps/api/src/realtime/presence.ts)).

## 2. Join a community

`POST /api/communities/:id/join`

[`routes/communities.routes.ts`](../../apps/api/src/routes/communities.routes.ts) ->
[`controllers/community.controller.ts`](../../apps/api/src/controllers/community.controller.ts) ->
[`services/membership.service.ts`](../../apps/api/src/services/membership.service.ts) `join`. In
one transaction it locks Avery's membership row (if any), refuses a ban or an unexpired
suspension, and applies the join policy: OPEN becomes ACTIVE at once, APPROVAL becomes PENDING
and notifies the community's moderators (`JOIN_REQUEST`), INVITE_ONLY needs a valid invite code.
An ACTIVE join bumps `communities.member_count` in the same transaction.

Opening the community page, the web app subscribes its socket: `community:subscribe`. The
gateway checks the same visibility rule the REST read uses (`canReadCommunity` in
[`repositories/visibility.ts`](../../apps/api/src/repositories/visibility.ts)) before joining
`community:<id>`.

## 3. Upload a photo

Three requests, so the file never passes through the API
([media.md](../architecture/media.md)):

1. `POST /api/media/uploads` `{ purpose: "POST", fileName, mimeType, sizeBytes }`.
   [`services/media.service.ts`](../../apps/api/src/services/media.service.ts) `createUpload`
   runs `checkDeclared` from [`domain/media-rules.ts`](../../apps/api/src/domain/media-rules.ts)
   (allowlisted type, matching extension, purpose, size limit), inserts a `PENDING` row in
   `media_uploads` with a server-chosen key `media/post/<yyyy>/<mm>/<id>.jpg`, and returns a
   presigned PUT ([`integrations/storage.ts`](../../apps/api/src/integrations/storage.ts)) that
   signs the content type and length.
2. The browser PUTs the bytes straight to S3 (Floci locally).
3. `POST /api/media/uploads/:id/complete`: the API HEADs the object (size must equal the
   declared size), reads the first 4 KB and checks the magic bytes, marks the row `COMPLETE`
   and, through `withEffects`, enqueues `media.process`. The worker
   ([`worker.ts`](../../apps/api/src/worker.ts), [`jobs/messaging.jobs.ts`](../../apps/api/src/jobs/messaging.jobs.ts))
   re-encodes the image with sharp (rotation applied, EXIF and GPS dropped), writes a 640 px
   WebP thumbnail and marks it `READY`.

## 4. Post

`POST /api/posts` `{ communityId, body: "Hello @juniper_vale #intro", mediaIds: [uploadId] }`

[`routes/posts.routes.ts`](../../apps/api/src/routes/posts.routes.ts) (limiter: 10 posts a
minute) -> [`controllers/post.controller.ts`](../../apps/api/src/controllers/post.controller.ts) ->
[`services/post.service.ts`](../../apps/api/src/services/post.service.ts) `create`, all inside
`withTransaction(async (trx, fx) => ...)` ([`core/effects.ts`](../../apps/api/src/core/effects.ts)):

1. `loadContext` reads the community and Avery's membership;
   [`domain/community-access.ts`](../../apps/api/src/domain/community-access.ts) `computeAccess`
   decides `canPost`.
2. `claimUploads` ([`services/media-attach.service.ts`](../../apps/api/src/services/media-attach.service.ts))
   locks the upload row and checks owner, purpose, status and that it is not attached elsewhere.
   Media is only ever referenced by upload id.
3. `requiresPremoderation` ([`services/premoderation.service.ts`](../../apps/api/src/services/premoderation.service.ts))
   decides whether the post is held. Here it is not, so it is inserted `PUBLISHED`
   ([`repositories/post.repository.ts`](../../apps/api/src/repositories/post.repository.ts)), with
   its tag (`intro`, [`domain/tags.ts`](../../apps/api/src/domain/tags.ts)), mention
   ([`domain/mentions.ts`](../../apps/api/src/domain/mentions.ts)) and media rows.
4. `counters.postPublished` ([`services/counters.service.ts`](../../apps/api/src/services/counters.service.ts))
   bumps the community and user post counts and awards 5 points through the idempotent ledger
   ([`repositories/points.repository.ts`](../../apps/api/src/repositories/points.repository.ts)).
5. `notifyMentions` calls `notify` for Juniper (a reader of the community).
6. Effects are queued, not run: `fx.emit(["community:<id>"], "feed:new-posts", ...)` and
   `fx.job("moderation.scan", { targetType: "POST", targetId })`.

After the commit `fx.flush()` runs the effects: the socket emit goes out through the Redis
adapter to every API task, the scan job goes onto the `moderation` queue, and Juniper's
`notification:new` and `notification:count` are pushed. Had the transaction rolled back, none
of them would have happened ([ADR 0009](../architecture/adr/0009-after-commit-effects.md)).

The worker runs the scan ([`services/moderation/scan.service.ts`](../../apps/api/src/services/moderation/scan.service.ts)):
it loads the post, sends the text and a signed URL of each image (the thumbnail, or the
original if processing has not finished) to the provider
([`services/moderation/providers.ts`](../../apps/api/src/services/moderation/providers.ts)), and
turns the scores into a verdict with `decideModeration`
([`domain/moderation-decision.ts`](../../apps/api/src/domain/moderation-decision.ts)). Clean:
`moderation_state` becomes `CLEAN` and nothing else happens.

## 5. A reaction, live

Juniper reacts: `PUT /api/posts/:id/reaction` `{ type: "LOVE" }`.

[`services/reaction.service.ts`](../../apps/api/src/services/reaction.service.ts)
`setPostReaction` loads the post with a row lock (`SELECT ... FOR UPDATE`), so two toggles cannot
double count, writes the reaction, applies the delta to `reaction_count` and the per-type
`reaction_counts` ([`repositories/reaction.repository.ts`](../../apps/api/src/repositories/reaction.repository.ts)),
awards Avery 2 points, and calls `notify`.

[`services/notification.service.ts`](../../apps/api/src/services/notification.service.ts) `notify`
applies its rules: never to yourself, never across a block, and the same actor, type and entity
within an hour updates the existing row instead of adding one. It writes the row in the
transaction and registers `fx.after(...)`, which after the commit builds the DTO (with its
`href`, `/posts/<id>`) and emits `notification:new` and the new unread count to `user:<Avery>`.
Avery's open tab shows the notification without a reload. Anyone viewing the post (subscribed to
`post:<id>`) receives `post:updated` with the new counts.

If Avery leaves it unread for an hour, the worker's `notifications.email` job (every 15 minutes)
emails a digest, at most once per six hours.

## 6. A message request

Someone Avery does not follow, Orrin, shares the community and opens a conversation:
`POST /api/dms/threads` `{ userId: Avery }`.

[`services/dm.service.ts`](../../apps/api/src/services/dm.service.ts) `openDirect` gathers fresh
facts (account statuses, blocks both ways, a shared ACTIVE community, whether Avery follows Orrin)
and asks `canMessage` in [`domain/dm-eligibility.ts`](../../apps/api/src/domain/dm-eligibility.ts).
Avery's DM privacy is `COMMUNITIES` and they share one, so it is allowed, as a request because
Avery does not follow Orrin. The thread is found or created by its `direct_key` (the two ids
sorted, unique in the schema), with Avery's participant state `REQUESTED`.

Orrin sends a message, `POST /api/dms/threads/:id/messages`. Inside the transaction the thread
row is locked and `directSendDecision` ([`domain/dm-send.ts`](../../apps/api/src/domain/dm-send.ts))
allows up to 3 messages while the request is pending. The first message creates one
`DM_REQUEST` notification; after the commit `dm:message` goes to both users' rooms and
`dm:request` (Avery's own view of the thread) to Avery. The thread sits in Avery's
`folder=requests` and does not count toward the inbox badge
([`domain/unread.ts`](../../apps/api/src/domain/unread.ts)). The message is also queued for a
moderation scan.

## 7. Acceptance

Avery replies (or calls `POST /api/dms/threads/:id/accept`). Sending a message while
`REQUESTED` flips Avery to `ACTIVE`, which is the consent that waives the privacy rules from now
on: either can write even if they later stop sharing a community. Blocks and account status are
never waived. Had Avery declined (`/decline`), Orrin's next send would get the generic
"not accepting messages" reason, without being told about the decline.

## 8. A report

Later Orrin posts a hostile comment under Avery's post. Avery reports it:
`POST /api/reports` `{ targetType: "COMMENT", targetId, reason: "HARASSMENT" }`.

[`routes/reports.routes.ts`](../../apps/api/src/routes/reports.routes.ts) (20 per hour) ->
[`controllers/report.controller.ts`](../../apps/api/src/controllers/report.controller.ts) ->
[`services/moderation/reports.service.ts`](../../apps/api/src/services/moderation/reports.service.ts)
`createReport`: the comment must be visible to Avery (else 404), Avery is not its author, and
Avery has not reported it before. In one transaction `openCaseFor`
([`services/moderation/cases.service.ts`](../../apps/api/src/services/moderation/cases.service.ts))
opens a `REPORT` case, or joins the comment's single open case (a partial unique index allows one
OPEN case per target), the report is linked to it, and the priority rises by 10. If three
reporters with accounts older than a day had reported it
([`domain/report-threshold.ts`](../../apps/api/src/domain/report-threshold.ts)), the comment
would be hidden at once. When a new case opens, staff connected to the desk get a fresh
`moderation:queue` count.

## 9. The moderator decides

A community moderator opens the case on `/moderation` and removes the comment:
`POST /api/moderation/cases/:id/actions` `{ action: "REMOVE", reason: "Personal attack" }`.

[`services/moderation/actions.service.ts`](../../apps/api/src/services/moderation/actions.service.ts)
`actOnCase` locks the case, checks the moderator may see it (staff, or a moderator of the
comment's community), checks the transition is allowed, and calls `setContentStatus`
([`services/moderation/targets.ts`](../../apps/api/src/services/moderation/targets.ts)): the
comment becomes `REMOVED`, the post's `comment_count` drops (counts include PUBLISHED only), a
`moderation_actions` row and an `audit_log` row are written, Orrin is notified without naming the
moderator, and the case is resolved. Orrin can now appeal within 30 days; a different staff
member decides ([moderation-playbook.md](moderation-playbook.md)).

## Where the tests are

Each step has integration coverage in [`apps/api/test/integration`](../../apps/api/test/integration):
`auth`, `communities`, `media`, `posts`, `notifications`, `realtime`, `dms`, `reports`,
`moderation` and `appeals`. See [testing.md](testing.md).
