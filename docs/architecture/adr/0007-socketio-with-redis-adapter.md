# ADR 0007: Socket.IO with the Redis adapter for realtime

## Status

Accepted.

## Context

DMs, community chat, notifications, typing indicators, presence and live reaction counts
need server push with low latency, in both directions (typing, subscriptions). The API runs
as several stateless tasks behind a load balancer, and background jobs in a separate worker
must reach users too. Self-hosters should not need a third-party realtime service.

## Decision

- Socket.IO on the API's HTTP server, path `/socket.io`, same origin as the app
  ([`realtime/gateway.ts`](../../../apps/api/src/realtime/gateway.ts)). Authentication with the access token at handshake, the
  same `actorFromToken` as HTTP.
- `@socket.io/redis-adapter` for fan-out across API tasks; `@socket.io/redis-emitter` in the
  worker ([`realtime/emitter.ts`](../../../apps/api/src/realtime/emitter.ts)). Redis is already required for jobs and rate limits.
- Services emit through a port ([`realtime/port.ts`](../../../apps/api/src/realtime/port.ts)) and only after commit
  ([ADR 0009](0009-after-commit-effects.md)). Server-chosen rooms; clients subscribe and the server checks the
  same rule as the REST read.
- WebSocket first with HTTP long-polling fallback; ALB stickiness for the fallback, a
  120 s idle timeout, CloudFront passing `/socket.io/*` uncached.
- Delivery is at most once. REST is the source of truth; clients refetch after reconnect.

The full contract is in [realtime.md](../realtime.md).

## Consequences

Positive:

- One process type serves HTTP and sockets; scaling is "add API tasks".
- Rooms, acknowledgements and reconnection come with the library and its typed client.
- No external realtime dependency or per-message cost.

Trade-offs:

- Sticky sessions are needed for the polling fallback.
- Redis pub/sub is in the hot path of every emit; a slow subscriber is cut by the
  ElastiCache output-buffer limits.
- No replay: missed events are recovered only by refetching.
- Room membership is checked at subscribe time; revocation is explicit (services call
  `realtime.leaveRooms` when access ends, which the adapter applies on every task), so a
  new kind of access change has to remember to call it.

## Alternatives considered

- **Server-Sent Events.** One direction only; typing and subscriptions would need extra
  HTTP calls, and fan-out would still need a broker.
- **Polling.** Simple but slow and expensive at scale.
- **A managed realtime service.** Another vendor and account for self-hosters, and a second
  auth model.
- **Raw WebSockets.** Would rebuild rooms, reconnection, acks and the fallback.
