# ADR 0009: Side effects only after commit

## Status

Accepted.

## Context

A write usually has side effects outside the database: a socket emit, a job enqueue, a
notification push. Doing them inside the transaction risks announcing something that is
then rolled back (a "new message" that does not exist, a scan of a deleted row). Doing them
by hand after every transaction is easy to forget, and a failing emit must not fail a write
that already happened.

## Decision

[`core/effects.ts`](../../../apps/api/src/core/effects.ts) provides an `Effects` buffer and two runners:

```ts
return withTransaction(async (trx, fx) => {
  const msg = await chatRepo.insertMessage({ ... }, trx);
  fx.emit([rooms.chat(communityId)], "chat:message", { communityId, message: dto });
  fx.job("moderation.scan", { targetType: "CHAT_MESSAGE", targetId: msg.id });
  return dto;
});
```

- `fx.emit`, `fx.disconnect`, `fx.job` and `fx.after(fn)` queue work; `flush()` runs it in
  order only after the transaction committed. `withEffects` gives the same contract
  without a transaction.
- Each queued effect is wrapped: an error is logged (`captureError`) and the next effect
  still runs. The request succeeds.
- Helpers that create side effects take the caller's `fx` (for example `notify(input, fx, trx)`),
  so they compose inside any transaction.

## Consequences

Positive:

- No event, job or notification for a rolled-back write.
- Effects see committed data (a job loading its row always finds it).

Trade-offs:

- Delivery is at most once: a crash between commit and flush loses the effects (no outbox
  table). Scheduled jobs (reconciliation, digests) bound the damage for counters and mail,
  but a lost `moderation.scan` leaves the item `UNCHECKED`.
- A few code paths emit directly after the transaction rather than through `fx` (DM send,
  read receipts); the guarantee is the same but the convention is not uniform.

## Alternatives considered

- **Transactional outbox.** At-least-once and crash-safe, at the cost of a table and a
  relay process for every emit, including typing-adjacent ones.
- **Emit inside the transaction.** Announces writes that may roll back.
