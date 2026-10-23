# ADR 0002: Relational schema, timestamptz(3) and ULID keys

## Status

Accepted.

## Context

A social network is relational: memberships, follows, blocks, reactions, votes, RSVPs,
DM participants and reports are many-to-many links with uniqueness rules that must hold
under concurrency (one reaction per person per post, one open case per target, one 1:1
thread per pair). Lists are paginated by time, so the time column is part of every cursor.
JavaScript `Date` holds milliseconds, while PostgreSQL `timestamptz` defaults to
microseconds.

## Decision

- PostgreSQL 16 with a fully relational schema in plain SQL migrations
  ([`db/migrations/0001_init.sql`](../../../db/migrations/0001_init.sql)), applied by a forward-only, checksummed runner
  under an advisory lock ([`db/migrate.ts`](../../../db/migrate.ts)). JSONB only where the shape is
  free-form: community `rules`, `reaction_counts`, notification `data`, case `snapshot` and
  `ai_scores`, settings.
- Uniqueness rules are constraints, not application checks: composite primary keys on link
  tables, `dm_threads.direct_key` unique, the partial unique index of open moderation
  cases, `points_ledger` unique `(user_id, reason, entity_type, entity_id, actor_id)`.
- Every timestamp is `timestamptz(3)`. A cursor built from a JS `Date` then equals the
  stored value exactly, so keyset pages neither skip nor repeat rows. The API runs with
  `TZ=UTC` (set first thing in [`index.ts`](../../../apps/api/src/index.ts), [`worker.ts`](../../../apps/api/src/worker.ts), [`cli.ts`](../../../apps/api/src/cli.ts)).
- Primary keys are ULIDs stored as `text`, generated in the API with a monotonic factory
  ([`core/ids.ts`](../../../apps/api/src/core/ids.ts)). They sort by creation time and serve as the cursor tie-breaker.
- Enums are PostgreSQL enum types. Search uses generated `tsvector` columns and trigram
  indexes (`pg_trgm`), `citext` for emails, usernames, slugs and tags.
- Runtime queries use Kysely with generated types ([`db/types.ts`](../../../apps/api/src/db/types.ts)).

## Consequences

Positive:

- Races resolve in the database: concurrent find-or-create of a DM thread or a case
  becomes `INSERT ... ON CONFLICT DO NOTHING` and a re-read.
- Cursor comparisons are exact without casting or truncation.
- IDs leak no row counts and can be generated before insert.

Trade-offs:

- Millisecond precision: two rows in the same millisecond are ordered by id, which is
  monotonic only within one process.
- Text ULIDs are larger than integers in indexes.
- Some code still truncates to milliseconds (`msOf` in
  [`repositories/moderation.repository.ts`](../../../apps/api/src/repositories/moderation.repository.ts)), a no-op on this schema whose comment
  assumes microsecond columns.

## Alternatives considered

- **A document store.** Would push the uniqueness and counting rules into the application.
- **Microsecond timestamps with text cursors everywhere.** Exact as well (the
  [`repositories/keyset.ts`](../../../apps/api/src/repositories/keyset.ts) cursors read the column as text), but every cursor would need that care.
- **UUIDv4 or bigserial keys.** v4 does not sort by time; bigserial reveals volumes and
  needs a round trip for the id.
