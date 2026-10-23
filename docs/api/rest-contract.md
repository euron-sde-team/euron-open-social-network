# REST contract

The route table the API implements and the web app consumes. Response shapes are the
DTOs in [`packages/types/src/index.ts`](../../packages/types/src/index.ts); this page
names them. The generated reference, with every guard, is [`openapi.yaml`](openapi.yaml).

**Conventions**

- Everything is under `/api` and speaks JSON. Authenticated calls send `Authorization: Bearer <accessToken>`.
- Lists return `Page<T>` (`{ items, nextCursor }`). Pass `?cursor=<nextCursor>` until it is `null`. `?limit=` is 1 to 50, default 20. No list ever returns a total count.
- Errors return `ApiError` (`{ error, code, details?, requestId }`). Clients switch on `code`. Validation failures are `400 VALIDATION_FAILED` with `details.fields`.
- Media is never referenced by URL. Upload first (`/media/uploads`), then pass the upload ids (`mediaIds`, `avatarUploadId`, and so on).
- Visibility rules apply everywhere:
  - A block in either direction makes the other person's content and profile invisible, and returns 404 (never 403, which would confirm the content exists).
  - Content of a private community is visible only to ACTIVE members and platform staff. Non-members get 404 for content, and a limited `Community` card for the community itself.
- Writes need an ACTIVE account. A suspended user can read but not write: `403 ACCOUNT_RESTRICTED`.
- "Counts" (`memberCount`, `commentCount`, ...) only ever include PUBLISHED items.

**Access levels in the tables**

| Level | Meaning |
|---|---|
| public | signed out works (`optionalAuth`); the response depends on the viewer when signed in |
| user | any signed-in account |
| member | an ACTIVE member of the community |
| mod | community OWNER, ADMIN or MODERATOR (or platform staff) |
| staff | platform MODERATOR or ADMIN |
| admin | platform ADMIN |

## Auth: `/api/auth`

| Method | Path | Access | Body | Response |
|---|---|---|---|---|
| POST | `/signup` | public | `{ email, username, displayName, password, inviteCode? }` | 201 `AuthResult`, or 202 `{ verificationRequired, email }`. Registration `INVITE_ONLY` needs `inviteCode` (`403 INVITE_REQUIRED`); a bad, expired or used-up code is `400 INVITE_INVALID`; `CLOSED` is `403 REGISTRATION_CLOSED`. The account joins the invite's community once verified |
| POST | `/verify-email` | public | `{ token }` | `AuthResult` |
| POST | `/resend-verification` | public | `{ email }` | 202 |
| POST | `/login` | public | `{ login, password, totp? \| recoveryCode? }` | `AuthResult` or `{ totpRequired: true }`. `401 INVALID_CREDENTIALS`, `INVALID_TOTP`, `INVALID_RECOVERY_CODE`. After 5 failures per account and IP in 15 minutes, or 50 per account in an hour: `429 RATE_LIMITED` for every attempt, identical whether or not the account exists (there is no lockout and no `ACCOUNT_LOCKED`) |
| POST | `/refresh` | refresh cookie | | `AuthResult` (rotates the cookie) |
| POST | `/logout` | refresh cookie | | 204 |
| POST | `/logout-all` | user | | 204. Also disconnects every socket (`session:revoked` `SIGNED_OUT`) |
| POST | `/forgot-password` | public | `{ email }` | 202 |
| POST | `/reset-password` | public | `{ token, password }` | 204 |
| POST | `/change-password` | user | `{ currentPassword, newPassword }` | 204. Signs out every session and socket (as does `/reset-password`) |
| GET | `/me` | user | | `Me` |
| POST | `/totp/setup` | user | | `{ secret, otpauthUrl }` |
| POST | `/totp/enable` | user | `{ code }` | 200 `{ recoveryCodes: string[] }` (ten single-use codes, shown only this once) |
| POST | `/totp/disable` | user | `{ password, code }` (a current TOTP code) or `{ password, recoveryCode }` | 204. `400 INVALID_CREDENTIALS`, `INVALID_TOTP` |
| POST | `/totp/recovery-codes` | user | `{ password, code }` | 200 `{ recoveryCodes: string[] }` (replaces every earlier code) |

## People: `/api/users`

| Method | Path | Access | Body / query | Response |
|---|---|---|---|---|
| PATCH | `/me` | user | `{ displayName?, headline?, bio?, location?, website?, avatarUploadId?, coverUploadId?, dmPrivacy?, emailDigest? }` | `Me` (includes `emailDigest` and `suspendedUntil`). Public profile fields are scanned by moderation |
| DELETE | `/me` | user | `{ password, totp? \| recoveryCode? }` (a code is required when two-factor is on) | 204. Deactivates and anonymises the account; content stays as "Deleted user". `409 OWNER_MUST_TRANSFER` with `details.communities: { name, slug }[]` while you own a community, `409 LAST_ADMIN`, `400 INVALID_CREDENTIALS`, `TOTP_REQUIRED`, `INVALID_TOTP`. 5 per hour |
| GET | `/me/export` | user | | JSON download (`Content-Disposition: attachment`): `{ exportedAt, profile, posts, comments, chatMessages, directMessages, memberships, following, followers, blocks, reports, notifications }`. 3 per day (`429 RATE_LIMITED`) |
| GET | `/me/bookmarks` | user | cursor | `Page<Post>` |
| GET | `/me/blocks` | user | | `UserSummary[]` |
| GET | `/me/sessions` | user | | `{ id, userAgent, ip, createdAt, lastUsedAt, current }[]` |
| DELETE | `/me/sessions/:id` | user | | 204 |
| GET | `/suggestions` | user | | `UserSummary[]` (people in your communities you do not follow) |
| GET | `/:username` | public | | `Profile` |
| GET | `/:username/posts` | public | cursor | `Page<Post>` |
| GET | `/:username/media` | public | cursor | `Page<Media>` |
| GET | `/:username/communities` | public | | `Community[]` (public ones, plus private ones you share) |
| GET | `/:username/followers` | public | cursor | `Page<FollowEntry>` (`UserSummary` plus `viewerFollows`, false when signed out) |
| GET | `/:username/following` | public | cursor | `Page<FollowEntry>` |
| POST | `/:id/follow` | user | | 204 |
| DELETE | `/:id/follow` | user | | 204 |
| POST | `/:id/block` | user | | 204. Also removes follows both ways |
| DELETE | `/:id/block` | user | | 204 |

## Communities: `/api/communities`

| Method | Path | Access | Body / query | Response |
|---|---|---|---|---|
| GET | `/` | public | `q`, `filter=all\|joined\|managed`, cursor | `Page<Community>` |
| GET | `/suggested` | user | | `Community[]` |
| POST | `/` | user (subject to settings) | `{ name, slug?, description?, visibility, joinPolicy, allowMemberPosts?, rules?, color?, iconUploadId?, coverUploadId? }` | 201 `Community` |
| GET | `/invites/:code` | user | | `{ community: Community, invite: Invite }` |
| GET | `/:slug` | public | | `Community` (`admin: { isDefault, status }` only when you are platform staff; absent otherwise) |
| PATCH | `/:id` | mod (settings: OWNER/ADMIN) | same fields as create, plus `premoderatePosts` | `Community` |
| DELETE | `/:id` | OWNER or admin | | 204 |
| POST | `/:id/join` | user | `{ inviteCode? }` | `{ status: "ACTIVE" \| "PENDING" }` |
| DELETE | `/:id/join` | user | | 204 (cancel a pending request) |
| POST | `/:id/leave` | member | | 204 (an OWNER must transfer first) |
| POST | `/:id/transfer` | OWNER | `{ userId }` | 204 |
| GET | `/:id/members` | public (private: member) | `status=ACTIVE\|PENDING\|SUSPENDED\|BANNED` (non-ACTIVE: mod), `role`, `q`, cursor | `Page<Member>` |
| POST | `/:id/members/:userId/approve` | mod | | `Member` |
| POST | `/:id/members/:userId/reject` | mod | | 204 |
| PATCH | `/:id/members/:userId` | OWNER/ADMIN | `{ role }` | `Member` |
| POST | `/:id/members/:userId/suspend` | mod | `{ days, reason? }` | `Member` |
| POST | `/:id/members/:userId/unsuspend` | mod | | `Member` |
| POST | `/:id/members/:userId/ban` | mod | `{ reason? }` | `Member` |
| POST | `/:id/members/:userId/unban` | mod | | `Member` (BANNED becomes LEFT, so they may rejoin; 409 `NOT_BANNED` for any other member, 404 for LEFT or unknown; audited) |
| DELETE | `/:id/members/:userId` | mod | | 204 (remove; they may rejoin). Any membership not already LEFT (ACTIVE, PENDING, SUSPENDED or BANNED) becomes LEFT, so on a banned member it also lifts the ban; 404 for LEFT or unknown |
| GET | `/:id/invites` | mod | | `Invite[]` |
| POST | `/:id/invites` | mod | `{ maxUses?, expiresInDays? }` | 201 `Invite` |
| DELETE | `/:id/invites/:inviteId` | mod | | 204 |
| GET | `/:id/posts` | public (private: member) | `sort=new\|top\|hot`, `tag`, cursor | `Page<Post>` |
| GET | `/:id/posts/pinned` | public (private: member) | | `Post[]` |
| GET | `/:id/media` | public (private: member) | cursor | `Page<Media>` |
| GET | `/:id/notification-settings` | member | | `{ posts: "ALL" \| "HIGHLIGHTS" \| "OFF", events: boolean, chat: boolean }` |
| PATCH | `/:id/notification-settings` | member | same | same |

## Posts and comments: `/api/posts`, `/api/comments`

| Method | Path | Access | Body / query | Response |
|---|---|---|---|---|
| GET | `/posts/feed` | user | `sort=latest\|top`, cursor | `Page<Post>`: your communities, plus public posts by people you follow |
| POST | `/posts` | member | `{ communityId, body, kind?, feeling?, tags?, mediaIds?, poll?, sharedPostId? }` | 201 `Post` |
| GET | `/posts/:id` | public | | `Post` |
| PATCH | `/posts/:id` | author | `{ body?, tags?, feeling? }` | `Post` |
| DELETE | `/posts/:id` | author or mod | | 204 |
| PUT | `/posts/:id/reaction` | member | `{ type: ReactionType }` | `{ reactionCount, reactionCounts, viewerReaction }` |
| DELETE | `/posts/:id/reaction` | member | | same |
| GET | `/posts/:id/reactions` | public | `type`, cursor | `Page<{ user: UserSummary, type: ReactionType }>` |
| POST | `/posts/:id/bookmark` | user | | 204 |
| DELETE | `/posts/:id/bookmark` | user | | 204 |
| POST | `/posts/:id/hide` | user | | 204 (hide from your own feed) |
| POST | `/posts/:id/pin` | mod | | `Post` |
| DELETE | `/posts/:id/pin` | mod | | `Post` |
| POST | `/posts/:id/lock` | mod | | `Post` |
| DELETE | `/posts/:id/lock` | mod | | `Post` |
| GET | `/posts/:id/comments` | public | cursor (oldest first, top-level) | `Page<Comment>` |
| POST | `/posts/:id/comments` | member | `{ body, parentId?, mediaId? }` | 201 `Comment` |
| GET | `/comments/:id/replies` | public | cursor | `Page<Comment>` |
| PATCH | `/comments/:id` | author | `{ body }` | `Comment` |
| DELETE | `/comments/:id` | author or mod | | 204 |
| PUT | `/comments/:id/reaction` | member | `{ type }` | `{ reactionCount, reactionCounts, viewerReaction }` |
| DELETE | `/comments/:id/reaction` | member | | same |

`poll` in a new post is `{ question, options: string[] (2 to 8), allowMultiple?, isAnonymous?, closesAt? }`.

## Polls: `/api/polls`

| Method | Path | Access | Body | Response |
|---|---|---|---|---|
| GET | `/:id` | public (private: member) | | `Poll` |
| POST | `/:id/vote` | member | `{ optionIds: string[] }` | `Poll` (replaces your previous vote) |
| DELETE | `/:id/vote` | member | | `Poll` |
| POST | `/:id/close` | post author or mod | | `Poll` |
| GET | `/:id/voters` | member | `optionId`, cursor | `Page<UserSummary>` (403 `POLL_ANONYMOUS` for anonymous polls) |

## Q&A: `/api/questions`

| Method | Path | Access | Body / query | Response |
|---|---|---|---|---|
| GET | `/` | public (private: member) | `communityId` (required), `status`, `sort=new\|top\|unanswered`, `tag`, cursor | `Page<Question>` |
| POST | `/` | member | `{ communityId, title, body, tags? }` | 201 `Question` |
| GET | `/:id` | public (private: member) | | `Question` (counts a view once per viewer per hour). Carries `community: { id, slug, name }` and `viewer.canDelete` / `viewer.canModerate` |
| PATCH | `/:id` | author | `{ title?, body?, tags? }` | `Question` |
| DELETE | `/:id` | author or mod | | 204 |
| POST | `/:id/vote` | member | `{ value: -1 \| 0 \| 1 }` | `{ score, vote }` |
| POST | `/:id/status` | author or mod | `{ status: "OPEN" \| "CLOSED" }` | `Question` |
| POST | `/:id/accept` | question author | `{ answerId \| null }` | `Question` |
| GET | `/:id/answers` | public (private: member) | `sort=top\|new`, cursor | `Page<Answer>` (accepted first; `viewer.canDelete` per answer) |
| POST | `/:id/answers` | member | `{ body }` | 201 `Answer` |
| PATCH | `/answers/:answerId` | author | `{ body }` | `Answer` |
| DELETE | `/answers/:answerId` | author or mod | | 204 |
| POST | `/answers/:answerId/vote` | member | `{ value }` | `{ score, vote }` |

## Events: `/api/events`

| Method | Path | Access | Body / query | Response |
|---|---|---|---|---|
| GET | `/` | public | `scope=upcoming\|past\|going\|organising`, `communityId`, cursor | `Page<CommunityEvent>` |
| POST | `/` | member (network-wide: per settings) | `{ communityId \| null, title, description?, location?, isVirtual?, virtualLink?, startsAt, endsAt, timezone?, capacity?, coverUploadId? }` | 201 `CommunityEvent` |
| GET | `/:id` | public (private: member) | | `CommunityEvent` (`viewer.waitlistPosition`: your 1-based place on the waitlist, else null) |
| PATCH | `/:id` | organiser or mod | same fields | `CommunityEvent` (notifies attendees) |
| DELETE | `/:id` | organiser or mod | | 204 (cancels; notifies attendees) |
| PUT | `/:id/rsvp` | member | `{ status: "GOING" \| "INTERESTED" }` | `CommunityEvent` (GOING past capacity becomes WAITLISTED) |
| DELETE | `/:id/rsvp` | user | | `CommunityEvent` (promotes the first person on the waitlist) |
| GET | `/:id/attendees` | public (private: member) | `status`, cursor | `Page<{ user: UserSummary, status: RsvpStatus }>` |
| GET | `/:id/ics` | public (private: member) | | `text/calendar` |

## Community chat: `/api/chat`

| Method | Path | Access | Body / query | Response |
|---|---|---|---|---|
| GET | `/unread` | user | | `Record<communityId, number>` |
| GET | `/:communityId/messages` | member | cursor (newest first) | `Page<Message>` |
| POST | `/:communityId/messages` | member | `{ body, replyToId?, mediaIds? }` | 201 `Message` |
| GET | `/:communityId/pinned` | member | | `Message[]` |
| POST | `/:communityId/read` | member | | 204 |
| PATCH | `/:communityId/mute` | member | `{ until: string \| null }` | 204 |
| PATCH | `/messages/:id` | sender | `{ body }` | `Message` |
| DELETE | `/messages/:id` | sender or mod | | 204 |
| POST | `/messages/:id/pin` | mod | | `Message` |
| DELETE | `/messages/:id/pin` | mod | | `Message` |
| PUT | `/messages/:id/reactions/:emoji` | member | | `Message` |
| DELETE | `/messages/:id/reactions/:emoji` | member | | `Message` |

## Direct messages: `/api/dms`

| Method | Path | Access | Body / query | Response |
|---|---|---|---|---|
| GET | `/threads` | user | `folder=inbox\|requests`, cursor | `Page<Thread>` |
| POST | `/threads` | user | `{ userId }` | `Thread` (find or create). 403 `DM_NOT_ALLOWED` with `details.reason: DmDenialReason` |
| POST | `/threads/group` | user | `{ userIds (2 to 49), title? }` | 201 `Thread` |
| GET | `/threads/:id` | participant | | `Thread` |
| PATCH | `/threads/:id` | participant | `{ title?, mutedUntil? }` | `Thread` |
| GET | `/threads/:id/messages` | participant | cursor (newest first) | `Page<Message>` |
| POST | `/threads/:id/messages` | participant | `{ body, replyToId?, mediaIds? }` | 201 `Message` |
| GET | `/threads/:id/pinned` | participant | | `Message[]` (newest pin first; 404 for non-participants) |
| POST | `/threads/:id/read` | participant | | 204 |
| POST | `/threads/:id/accept` | requested participant | | `Thread` |
| POST | `/threads/:id/decline` | requested participant | | 204 |
| POST | `/threads/:id/leave` | group participant | | 204 |
| POST | `/threads/:id/participants` | group participant | `{ userIds }` | `Thread` |
| GET | `/threads/:id/media` | participant | cursor | `Page<Media>` |
| GET | `/threads/:id/search` | participant | `q` | `Message[]` |
| PATCH | `/messages/:id` | sender | `{ body }` | `Message` |
| DELETE | `/messages/:id` | sender | | 204 |
| POST | `/messages/:id/pin` | participant | | `Message` |
| DELETE | `/messages/:id/pin` | participant | | `Message` |
| PUT | `/messages/:id/reactions/:emoji` | participant | | `Message` |
| DELETE | `/messages/:id/reactions/:emoji` | participant | | `Message` |
| GET | `/unread` | user | | `{ inbox: number, requests: number }` |
| GET | `/eligibility/:userId` | user | | `{ allowed: boolean, reason: DmDenialReason \| null, asRequest: boolean }` |
| GET | `/contacts` | user | | `{ user: UserSummary, online: boolean, lastSeenAt: string \| null }[]` (people you can message, online first) |

## Media: `/api/media`

| Method | Path | Access | Body | Response |
|---|---|---|---|---|
| POST | `/uploads` | user | `{ purpose: UploadPurpose, fileName, mimeType, sizeBytes }` | 201 `{ uploadId, put: { url, method, headers, expiresAt } }` |
| POST | `/uploads/:id/complete` | owner | | `Media` |
| DELETE | `/uploads/:id` | owner | | 204 (only while not attached) |
| GET | `/:id` | anyone who can see the parent | | `Media` |
| PUT | `/local/:token` | signed token | raw bytes | 204 (STORAGE=local only) |
| GET | `/local/:token` | signed token | | the file (STORAGE=local only) |

Limits (per kind): images 15 MB, video 200 MB, audio 50 MB, PDF and documents 25 MB.
Allowed types: JPEG, PNG, WebP, GIF, HEIC (images); MP4, WebM, QuickTime (video); MP3,
M4A, OGG, WAV (audio); PDF; DOCX, XLSX, PPTX, CSV, TXT (documents). SVG and HTML are refused.

## Notifications: `/api/notifications`

| Method | Path | Access | Query | Response |
|---|---|---|---|---|
| GET | `/` | user | `unread=true`, cursor | `Page<Notification>` |
| GET | `/unread-count` | user | | `{ unread }` |
| POST | `/:id/read` | user | | 204 |
| POST | `/read-all` | user | | 204 |

## Discovery: `/api/discover`

| Method | Path | Access | Query | Response |
|---|---|---|---|---|
| GET | `/search` | public | `q` (2+ chars), `type=all\|people\|communities\|posts\|questions` | `SearchResults` |
| GET | `/typeahead` | public | `q` | `{ people: UserSummary[], communities: Community[] }` |
| GET | `/trending-tags` | public | | `TrendingTag[]` (14 days) |
| GET | `/tags/:tag/posts` | public | cursor | `Page<Post>` |
| GET | `/leaderboard` | public | `period=week\|month\|all` | `LeaderboardEntry[]` |

## Reports and moderation: `/api/reports`, `/api/moderation`

| Method | Path | Access | Body / query | Response |
|---|---|---|---|---|
| POST | `/reports` | user | `{ targetType, targetId, reason, details? }` | 201 `{ id }` (reporting the same target twice is 409 `ALREADY_REPORTED`) |
| GET | `/moderation/cases` | staff, or mod (own communities) | `status=OPEN\|RESOLVED`, `source`, `communityId`, `targetType`, cursor | `Page<ModerationCase>` (priority, then oldest) |
| GET | `/moderation/cases/:id` | staff, that community's mod, or the case's author (the subject, for USER cases) | | `ModerationCase`. The author gets the author view: `aiScores` and `resolvedBy` are null (`aiCategories` and report reasons stay); 404 for anyone else |
| POST | `/moderation/cases/:id/actions` | ACTIVE staff or mod (content actions only) | `{ action: ModerationActionType, reason?, suspendDays? }` | `ModerationCase`. `403 SELF_MODERATION` on a case about your own content or account (platform admins excepted), `403 ACCOUNT_RESTRICTED` for a suspended moderator |
| POST | `/moderation/cases/:id/assign` | staff | `{ userId \| null }` | `ModerationCase` |
| GET | `/moderation/history` | staff | `targetType`, `targetId` | `ModerationActionRecord[]` |
| GET | `/moderation/me` | user | cursor | `Page<ModerationCase>` (cases about your content or account, in the author view) |
| POST | `/moderation/cases/:id/appeal` | the content author | `{ statement }` | 201 `Appeal`. Appealable: a RESOLVED case (HIDE, REMOVE, SUSPEND, BAN) within 30 days, or an OPEN case whose target was hidden automatically and is still HIDDEN; otherwise `400 NOT_APPEALABLE` |
| GET | `/moderation/appeals` | staff | `status`, cursor | `Page<Appeal>` |
| POST | `/moderation/appeals/:id/decide` | ACTIVE staff (not the original moderator, not about their own case) | `{ status: "UPHELD" \| "OVERTURNED", note? }` | `Appeal`. Overturning a suspension or ban restores the account only if it is still in that state with no later action; an OPEN case is resolved with the decision |
| GET | `/moderation/stats` | staff, or mod (own communities) | | `ModerationStats` `{ openCases, openAppeals, actionsToday, autoHiddenToday }`: network-wide for staff, counted over the communities you moderate for a community mod (403 for everyone else) |

Community moderators can HIDE, REMOVE, RESTORE, APPROVE and DISMISS content in their own
communities. WARN, SUSPEND, BAN and UNBAN of accounts are platform staff only.

## Administration: `/api/admin`

| Method | Path | Access | Body / query | Response |
|---|---|---|---|---|
| GET | `/settings` | admin | | `PlatformSettings` |
| PATCH | `/settings` | admin | partial `PlatformSettings` | `PlatformSettings` |
| GET | `/stats` | staff | `days=30` | `{ totals: { users, activeUsers7d, communities, posts, messages }, daily: { date, signups, posts, messages }[] }` |
| GET | `/users` | staff | `q`, `status`, `role`, cursor | `Page<UserSummary & { email, status, createdAt, lastSeenAt }>` |
| PATCH | `/users/:id` | admin | `{ role }` | same row |
| POST | `/users/:id/suspend` | staff | `{ days, reason }` | same row (disconnects their sockets) |
| POST | `/users/:id/unsuspend` | staff | | same row |
| POST | `/users/:id/ban` | admin | `{ reason }` | same row (revokes every session) |
| POST | `/users/:id/unban` | admin | | same row |
| GET | `/communities` | staff | `q`, `status`, cursor | `Page<Community>` (with `admin: { isDefault, status }`) |
| PATCH | `/communities/:id` | admin | `{ isDefault?, status? }` | `Community` (with `admin`) |
| GET | `/audit` | admin | `action`, `actorId`, cursor | `Page<AuditEntry>` |

## Network: `/api/meta`

| Method | Path | Access | Body / query | Response |
|---|---|---|---|---|
| GET | `/` | public | | `NetworkMeta` `{ networkName, registration }` (cached 30 seconds): the name to show in titles, and whether sign-up is `OPEN`, `INVITE_ONLY` or `CLOSED` |

## Realtime

Socket.IO on the same origin as the API (`/socket.io`), authenticated with the access token
(`auth: { token }`). The event map is `ServerToClientEvents` / `ClientToServerEvents` in
`packages/types`. When the access token is refreshed, the client reconnects with the new token.
A user may hold 20 live sockets (the next handshake fails with `TOO_MANY_CONNECTIONS`); a
socket may send 30 subscribe or `presence:query` requests per 10 seconds (ack
`RATE_LIMITED`); `presence:query` answers only for people you share a community, a follow
or a DM thread with.
