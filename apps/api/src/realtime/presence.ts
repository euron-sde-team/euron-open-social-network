/**
 * Presence in Redis, safe across many API tasks and many tabs.
 *
 * Each user has a sorted set `presence:<userId>` of their live socket ids, scored by the
 * last heartbeat (ms). A user is online while any member is younger than ONLINE_WINDOW_MS,
 * so a task that dies without cleaning up stops counting after 90 seconds. Every
 * heartbeat refreshes the key TTL, so abandoned keys expire on their own.
 */
import { redis } from "../integrations/redis";

export const HEARTBEAT_MS = 30_000;
export const ONLINE_WINDOW_MS = 90_000;
const KEY_TTL_SECONDS = 120;

const key = (userId: string) => `presence:${userId}`;

async function aliveCount(userId: string, now: number): Promise<number> {
  return redis().zcount(key(userId), now - ONLINE_WINDOW_MS, "+inf");
}

/** Live sockets of a user across every task (the per-user connection cap). */
export async function liveSocketCount(userId: string, now = Date.now()): Promise<number> {
  return aliveCount(userId, now);
}

/** Register a socket. Returns true when this made the user go from offline to online. */
export async function markOnline(userId: string, socketId: string, now = Date.now()): Promise<boolean> {
  const before = await aliveCount(userId, now);
  await redis().multi().zadd(key(userId), now, socketId).zremrangebyscore(key(userId), "-inf", now - ONLINE_WINDOW_MS).expire(key(userId), KEY_TTL_SECONDS).exec();
  return before === 0;
}

/** Refresh the heartbeat of every socket this task holds. */
export async function heartbeat(entries: { userId: string; socketId: string }[], now = Date.now()): Promise<void> {
  if (!entries.length) return;
  const m = redis().multi();
  for (const e of entries) m.zadd(key(e.userId), now, e.socketId).expire(key(e.userId), KEY_TTL_SECONDS);
  await m.exec();
}

/** Remove a socket. Returns true when the user has no live socket left (went offline). */
export async function markOffline(userId: string, socketId: string, now = Date.now()): Promise<boolean> {
  await redis().zrem(key(userId), socketId);
  return (await aliveCount(userId, now)) === 0;
}

export async function onlineMap(userIds: readonly string[], now = Date.now()): Promise<Map<string, boolean>> {
  const ids = [...new Set(userIds)];
  if (!ids.length) return new Map();
  const m = redis().multi();
  for (const id of ids) m.zcount(key(id), now - ONLINE_WINDOW_MS, "+inf");
  const res = (await m.exec()) ?? [];
  return new Map(ids.map((id, i) => [id, Number(res[i]?.[1] ?? 0) > 0]));
}
