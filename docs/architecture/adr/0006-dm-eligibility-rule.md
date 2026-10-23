# ADR 0006: Who may message whom

## Status

Accepted.

## Context

Open DMs are the main harassment and spam channel of a social network. The product is
community-backed: people meet in communities. Recipients need control, blocks must be
absolute, and moderators must be able to reach anyone.

## Decision

[`domain/dm-eligibility.ts`](../../../apps/api/src/domain/dm-eligibility.ts) decides who may start a conversation; the first rule that
applies wins:

1. Nobody messages themselves (`SELF`).
2. A sender whose account is not ACTIVE cannot start conversations (`SENDER_RESTRICTED`).
3. A recipient who is not ACTIVE cannot be messaged (`RECIPIENT_UNAVAILABLE`).
4. A block in either direction stops everything, staff included (`BLOCKED`).
5. Platform staff may message anyone, never as a request.
6. The recipient's `dm_privacy`: `NOBODY` refuses (`RECIPIENT_DISABLED_DMS`); otherwise both
   must be ACTIVE members of at least one published community (`NO_SHARED_COMMUNITY`);
   `FOLLOWING` also requires that the recipient follows the sender
   (`RECIPIENT_NOT_FOLLOWING`).

An allowed first contact from someone the recipient does not follow arrives as a **message
request** (participant state `REQUESTED`). [`domain/dm-send.ts`](../../../apps/api/src/domain/dm-send.ts) decides each send
into an existing thread, from facts reloaded inside the send transaction:

- blocks and account status are never waived;
- once the counterpart is ACTIVE in the thread (they started it or accepted), the privacy
  reasons are waived: consent replaces the shared-community rule;
- while the request is pending, the sender may send at most 3 messages
  (`REQUEST_MESSAGE_CAP`, `403 DM_REQUEST_PENDING` after that);
- a declined request reads to the sender as `RECIPIENT_DISABLED_DMS`, so they are not told
  they were declined.

Replying to a request accepts it. Groups (up to 50 people) require that the creator may
message every invitee and that no two members have a block between them, without saying
which pair. The same functions feed `GET /api/dms/eligibility/:userId`, the profile's
`canMessage` and `Thread.canSend` ([`services/dm.service.ts`](../../../apps/api/src/services/dm.service.ts),
[`presenters/thread.presenter.ts`](../../../apps/api/src/presenters/thread.presenter.ts)).

## Consequences

Positive:

- Strangers cannot cold-message people they share no community with.
- One pure, unit-tested rule ([`test/unit/dm-eligibility.test.ts`](../../../apps/api/test/unit/dm-eligibility.test.ts)) behind the composer,
  the profile and the server.
- Leaving every shared community does not cut off an accepted conversation.

Trade-offs:

- The 3-message cap counts messages that are not deleted, so a sender who deletes their
  pending messages can send more.
- Declining is final for the pair: the 1:1 thread is unique per pair (`direct_key`) and
  there is no path back from `DECLINED`.
- A person added to a group sees its earlier history.

## Alternatives considered

- **Open DMs with reporting only.** Puts the burden on recipients.
- **Followers-only DMs.** Too strict for community discussion, where people rarely follow
  each other first.
