# ADR 0004: Keyset pagination everywhere

## Status

Accepted.

## Context

Feeds, comments, messages and notifications are append-heavy lists read from the newest
end. `OFFSET` pages get slower with depth and shift when rows are inserted, and a total
count on every list is expensive and rarely needed. Ranked lists (top, hot) change while
someone pages through them.

## Decision

- Every list returns `Page<T>` (`{ items, nextCursor }`), never a total. The repository
  asks for `limit + 1` rows; the extra row only says whether there is a next page. Limit is
  1 to 50, default 20 ([`core/validate.ts`](../../../apps/api/src/core/validate.ts), [`core/cursor.ts`](../../../apps/api/src/core/cursor.ts)).
- Cursors are opaque base64url strings, validated on decode (`400 INVALID_CURSOR`).
- Two cursor encodings exist:
  - [`core/cursor.ts`](../../../apps/api/src/core/cursor.ts): `iso|id` from a JS `Date`, exact because columns are
    `timestamptz(3)`. Used by DMs, chat, the admin lists and the moderation lists.
  - [`repositories/keyset.ts`](../../../apps/api/src/repositories/keyset.ts): JSON arrays. `time` `[at, id]` reads the
    column as exact UTC text (`atKey`); `score` `[score, id]` for top lists; `hot` `[score, ref, id]`
    also pins the reference time, so hot scores do not decay between pages. Used by the
    social lists (feeds, members, comments, Q&A, events, notifications).
- Comparisons are row-value predicates, `(created_at, id) < (cursor.at, cursor.id)`, backed
  by composite indexes such as `posts_feed_idx`, `posts_community_feed_idx`,
  `dm_messages_thread_idx`, `notifications_inbox_idx`.

## Consequences

Positive:

- Constant-time pages at any depth, no skipped or repeated rows for time-ordered lists.
- No `COUNT(*)` on hot paths.

Trade-offs:

- No "page 7 of 12" and no jumping to a page.
- Score cursors on live data are approximate: a post whose score changes between pages can
  appear twice or be skipped. Hot lists pin "now", top lists do not.
- Two cursor modules to keep consistent.

## Alternatives considered

- **OFFSET/LIMIT.** Simple, but slow at depth and unstable under inserts.
- **Server-side cursors or snapshots.** Hold database resources between requests.
