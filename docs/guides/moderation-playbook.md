# Moderation playbook

For the people who review content: platform moderators and admins, and the owners, admins and
moderators of individual communities. It explains what reaches you, what each decision does,
and the rough edges to know about. How the pipeline works internally is in
[moderation.md](../architecture/moderation.md); the endpoints are in
[`docs/api/rest-contract.md`](../api/rest-contract.md).

## Who sees what

| You are | You see | You can do |
| --- | --- | --- |
| Community moderator (an ACTIVE OWNER, ADMIN or MODERATOR membership) | Cases whose content belongs to one of your communities | HIDE, REMOVE, RESTORE, APPROVE, DISMISS |
| Platform moderator (`MODERATOR` role) | Every case, including DM messages, accounts and communities | All content actions, plus WARN and SUSPEND on accounts, assigning cases, target history, deciding appeals |
| Platform admin (`ADMIN` role) | Everything | Also BAN and UNBAN, settings, roles ([`actions.service.ts`](../../apps/api/src/services/moderation/actions.service.ts)) |

Cases about a direct message, an account (`USER`) or a whole community have no community
attached, so only platform staff ever see them. Nobody can act on their own account, admin
accounts are out of reach (demote first), and platform moderators cannot act on other
moderators. Nobody but a platform admin can act on a case about their own content or account,
or decide an appeal about it (`403 SELF_MODERATION`), and acting needs an ACTIVE account: a
suspended moderator gets `403 ACCOUNT_RESTRICTED`.

Staff get a live open-case count on the desk (the `moderation:queue` socket event goes to the
`staff` room). Community moderators do not get that event: refresh the desk.

## The desk

Open `/moderation` in the web app. The queue lists OPEN cases highest priority first, then
oldest first. Filters: source, community, target type, and OPEN or RESOLVED.

A case has one of three sources:

| Source | Opened when | Typical priority |
| --- | --- | --- |
| `AI` | The classifier scored something at or above a category's `review` threshold, including a profile (`USER`) after an edit | The top score times 100 (0 to 100) |
| `REPORT` | A member reported the item | Each report adds 10, capped at 1000 |
| `PREMODERATION` | A held post was created; the case opens with it, whatever the classifier does | 0 |

There is at most one OPEN case per item: new reports and re-scans join it and raise its
priority; a re-scan also refreshes its snapshot and scores.

### Reading a case

- **Snapshot**: the content (body, title, attached media) as it was when the case opened or was
  last re-scanned. The item may have been edited or deleted since; the case shows its current
  status separately.
- **Scores**: per category, 0 to 1, from the provider named on the case (`openai`, `rules` or
  `stub`). Child categories such as `harassment/threatening` are folded into their parent with
  the maximum, so the parent threshold catches them. Compare against the thresholds in
  [moderation.md](../architecture/moderation.md#thresholds-and-defaults).
- **Reports**: reasons and counts. Reporters are never shown, to you or to the author.
- **History**: every action ever taken on the target (staff only).

### Triage

1. Start at the top: priority already combines classifier confidence and report volume.
2. Look at items that are already hidden (status `HIDDEN`): the author is waiting, and a wrong
   automatic hide is the most visible mistake.
3. Approve or reject held posts (`PREMODERATION`) promptly; until then only the author and the
   community's moderators can see them.
4. Assign long investigations to yourself (staff: assign) so two people do not work the same
   case.

## Content actions

| Action | Turns the item into | Allowed from | Notes |
| --- | --- | --- | --- |
| APPROVE | `PUBLISHED` | PENDING_REVIEW, HIDDEN, PUBLISHED | Marks it CLEAN. The way to publish a held post |
| HIDE | `HIDDEN` | PUBLISHED, PENDING_REVIEW, HIDDEN | Restorable; the author is notified and may appeal |
| REMOVE | `REMOVED` | PUBLISHED, PENDING_REVIEW, HIDDEN, REMOVED | Final unless an appeal wins |
| RESTORE | `PUBLISHED` | HIDDEN, REMOVED, PUBLISHED | Marks it CLEAN |
| DISMISS | unchanged | any | Closes the case with no change, for example a report that does not hold up |

Every action resolves the case, writes a `moderation_actions` row and an `audit_log` row, and
updates counters (only PUBLISHED items are counted). The author is notified for APPROVE, HIDE,
REMOVE and RESTORE, with your reason if you gave one. Live viewers drop a post, chat message or
DM that leaves PUBLISHED. Write a reason: it is the author's only explanation.

Deleting someone else's post, comment, question, answer or chat message through the ordinary
delete buttons (as a moderator) records a REMOVE action without a case, plus an `audit_log` row,
so it shows in the target's history.

Profiles are scanned whenever someone edits their display name, headline, bio, location, website
or avatar. A profile is never hidden automatically: whatever the score, the result is an `AI`
case on a `USER` target for staff to judge (warn, suspend or dismiss).

## Account actions (platform staff)

| Action | Who | Effect |
| --- | --- | --- |
| WARN | staff | A notification to the person with your reason. Nothing else changes |
| SUSPEND | staff | Status SUSPENDED for 1 to 3650 days: they can read but not post, react, message or moderate. Their sockets are disconnected (they reconnect read-only). Lifted automatically when the time is up |
| UNSUSPEND | staff | Back to ACTIVE (logged as RESTORE) |
| BAN | admin | Status BANNED: every session revoked, token version bumped, sockets disconnected; they cannot sign in |
| UNBAN | admin | Back to ACTIVE |

From a case, account actions apply to the case's author. The same actions exist in the admin
console (`/api/admin/users/:id/...`), with the same trail. Community-level suspensions and bans
(membership only) are made from the community's members list and only affect that community.

## Appeals

An author can appeal once per case, within 30 days of a resolution of HIDE, REMOVE, SUSPEND or
BAN, or at once while a case is still OPEN if the item was hidden automatically (by the
classifier or the report threshold) and is still hidden
([`appeals.service.ts`](../../apps/api/src/services/moderation/appeals.service.ts)). Suspended
users can appeal; banned users cannot sign in, so they appeal outside the product.

- Appeals are decided by platform staff with an ACTIVE account, and not by the moderator who
  resolved the case. An admin may decide their own case only with a written note (recorded).
- OVERTURNED restores content to PUBLISHED. For a SUSPEND or BAN it restores the account to
  ACTIVE only if the account is still in the state the case put it in (SUSPENDED or BANNED) and
  no later moderation action on it exists; otherwise the overturn is recorded (appeal and audit
  log) and the later decision stands, and the author is told so. UPHELD changes nothing.
  Either way the author is notified, with your note if any.
- Deciding an appeal on an OPEN case also resolves the case (RESTORE when overturned, HIDE when
  upheld).

## What authors see

Authors see their own cases at `/account/moderation`, with the decision, the reason and the
appeal state. Notifications never name the moderator ("by a moderator" or "automatic"), and
never name reporters.

## Rough edges to know about

These are current behaviours of the code, listed so you can work around them. See also
[security.md](../architecture/security.md#known-limitations).

- **No rank check on case actions.** Unlike member suspensions, case actions do not check that
  you outrank the author within the community. Use judgement with content by other moderators
  or the owner.
- **The report threshold counts the open case only.** Three reports hide an item only when they
  are attached to the item's current OPEN case (filed since the last resolution) and come from
  reporters who are ACTIVE now with accounts older than a day. After you restore an item, it
  takes three new reports to hide it again.
- **Approving a held post** publishes it and sends the mention notifications it skipped (to
  people who have not had one for that post), but not the live "new posts" signal that an
  immediately published post would.
- **WARN is not appealable.** The author's case page offers an appeal only for HIDE, REMOVE,
  SUSPEND and BAN decisions, and for an open case whose content is already auto-hidden; the
  API answers anything else with `NOT_APPEALABLE`.

## What is not automated

- Nothing is removed or banned automatically: the pipeline only hides (restorably) and queues.
- Staff content is never hidden automatically; it still gets a case.
- Accounts and communities are never hidden by reports.
- No re-scan on demand; editing an item triggers a new scan.
- Community notification preferences apply to notifications (posts `OFF` or `HIGHLIGHTS`,
  events off), never to moderation notices or appeal decisions.
