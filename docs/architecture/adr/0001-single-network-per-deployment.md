# ADR 0001: One social network per deployment

## Status

Accepted.

## Context

The product is a self-hostable social network: an organisation, a club or a company runs
it for its own people. The sibling projects this repository follows are multi-tenant
(several workspaces in one database), which costs a tenant key on every row, a scoped
repository, tenant-aware caches, rooms and queues, and an operator plane. A social network
also has cross-cutting surfaces (search, people suggestions, the home feed, DMs, presence,
the leaderboard) that would each need a tenant boundary.

## Decision

- One deployment serves exactly one network. There is no tenant table and no `org_id` or
  `tenant_id` column ([`db/migrations/0001_init.sql`](../../../db/migrations/0001_init.sql)).
- Communities are the unit of grouping inside the network: public or private, created by
  members (subject to `settings.communityCreation` and `maxCommunitiesPerUser`), each with
  its own roles and moderators.
- Network-wide configuration is one `settings` row (`key = "platform"`) edited by platform
  admins ([`services/settings.service.ts`](../../../apps/api/src/services/settings.service.ts)).
- Platform roles (`USER`, `MODERATOR`, `ADMIN`) live on `users.role`; the admin console is
  part of the same API (`/api/admin`) and web app.
- Running several networks means running several deployments (separate database, Redis,
  bucket, domain).

## Consequences

Positive:

- Queries, indexes and caches carry no tenant predicate, so there is no tenant leak to
  get wrong. Visibility is about blocks and private communities only
  ([`repositories/visibility.ts`](../../../apps/api/src/repositories/visibility.ts)).
- Global unique keys are natural: usernames, emails and community slugs are unique per
  network.
- Search, presence, DMs and the feed need no partitioning.

Trade-offs:

- Hosting many small networks costs one stack each (database, cache, NAT, load balancer).
- No shared identity across networks: a person has one account per deployment.
- Network-wide policy (moderation thresholds, blocked terms) cannot differ per community.

## Alternatives considered

- **Multi-tenant with a tenant column.** Lower cost per network for a hosted service, but
  every query, room name, rate-limit key and job payload would need the tenant, for an
  audience that mostly self-hosts one network.
- **Communities as tenants.** Would break the cross-community features (home feed, DMs
  based on a shared community, people search) that define the product.
