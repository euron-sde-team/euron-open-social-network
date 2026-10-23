/**
 * DM thread rows to `Thread` DTOs for one viewer. Batched: participants, last messages,
 * unread counts and the facts behind `canSend` are a handful of queries for the whole
 * page, never per thread.
 *
 * `canSend` is computed with the same rules the send endpoint enforces
 * (domain/dm-send.ts), from fresh facts, so the composer and the API never disagree.
 */
import type { Thread, ThreadParticipant } from "@open-social/types";
import type { Selectable } from "kysely";
import type { Actor } from "../core/context";
import { db, type Executor } from "../db/kysely";
import type { DmThreads } from "../db/types";
import { canMessage } from "../domain/dm-eligibility";
import { directSendDecision, groupSendDecision, type ParticipantState } from "../domain/dm-send";
import { dmRepo } from "../repositories/dm.repository";
import { blockedSet } from "../repositories/visibility";
import { presentMessages } from "./message.presenter";
import { loadSummaries } from "./user.presenter";

type ThreadRow = Selectable<DmThreads>;

/** Users (among `others`) who share an ACTIVE membership of a published community with `userId`. */
export async function sharedCommunityWith(userId: string, others: readonly string[], exec: Executor = db): Promise<Set<string>> {
  if (!others.length) return new Set();
  const rows = await exec
    .selectFrom("community_members as ma")
    .innerJoin("community_members as mb", "mb.community_id", "ma.community_id")
    .innerJoin("communities as c", "c.id", "ma.community_id")
    .select("mb.user_id")
    .distinct()
    .where("ma.user_id", "=", userId)
    .where("mb.user_id", "in", [...others])
    .where("ma.status", "=", "ACTIVE")
    .where("mb.status", "=", "ACTIVE")
    .where("c.status", "=", "PUBLISHED")
    .execute();
  return new Set(rows.map((r) => r.user_id));
}

/** Among `others`, who follows `userId`. */
export async function followersAmong(userId: string, others: readonly string[], exec: Executor = db): Promise<Set<string>> {
  if (!others.length) return new Set();
  const rows = await exec.selectFrom("follows").select("follower_id").where("followee_id", "=", userId).where("follower_id", "in", [...others]).execute();
  return new Set(rows.map((r) => r.follower_id));
}

export async function presentThreads(viewer: Actor, threads: readonly ThreadRow[], exec: Executor = db): Promise<Thread[]> {
  if (!threads.length) return [];
  const ids = threads.map((t) => t.id);
  const parts = await dmRepo.participants(ids, exec);
  const byThread = new Map<string, typeof parts>();
  for (const p of parts) {
    const list = byThread.get(p.thread_id) ?? [];
    list.push(p);
    byThread.set(p.thread_id, list);
  }

  const counterparts = new Set<string>();
  for (const t of threads) if (t.kind === "DIRECT") for (const p of byThread.get(t.id) ?? []) if (p.user_id !== viewer.id) counterparts.add(p.user_id);
  const others = [...counterparts];

  const [summaries, lastRows, unread, blocked, shared, followers, sent] = await Promise.all([
    loadSummaries(parts.map((p) => p.user_id), exec),
    dmRepo.lastMessages(ids, viewer.id, exec),
    dmRepo.unreadCounts(viewer.id, ids, exec),
    blockedSet(viewer.id, exec),
    sharedCommunityWith(viewer.id, others, exec),
    followersAmong(viewer.id, others, exec),
    dmRepo.sentCounts(ids, viewer.id, exec),
  ]);
  const lastMessages = await presentMessages("dm", lastRows, viewer.id, exec);
  const lastByThread = new Map(lastMessages.map((m) => [m.roomId, m]));
  const unreadByThread = new Map(unread.map((u) => [u.thread_id, Number(u.unread)]));

  return threads.map((t): Thread => {
    const members = byThread.get(t.id) ?? [];
    const me = members.find((p) => p.user_id === viewer.id);
    const viewerState = (me?.state ?? "LEFT") as ParticipantState;
    let canSend = viewerState !== "LEFT" && viewerState !== "DECLINED";
    if (canSend && t.kind === "DIRECT") {
      const other = members.find((p) => p.user_id !== viewer.id);
      if (!other) canSend = false;
      else {
        const eligibility = canMessage({
          sender: { id: viewer.id, status: viewer.status, role: viewer.role },
          recipient: { id: other.user_id, status: other.user_status, dmPrivacy: other.dm_privacy },
          blocked: blocked.has(other.user_id),
          sharedCommunity: shared.has(other.user_id),
          recipientFollowsSender: followers.has(other.user_id),
        });
        canSend = directSendDecision({ eligibility, counterpartState: other.state, sentWhilePending: sent.get(t.id) ?? 0 }).allowed;
      }
    } else if (canSend) {
      const blockedWithAny = members.some((p) => p.user_id !== viewer.id && (p.state === "ACTIVE" || p.state === "REQUESTED") && blocked.has(p.user_id));
      canSend = groupSendDecision({ senderActive: viewer.status === "ACTIVE", blockedWithAnyMember: blockedWithAny }).allowed;
    }

    const participants: ThreadParticipant[] = members
      .filter((p) => summaries.has(p.user_id))
      .map((p) => ({ user: summaries.get(p.user_id)!, state: p.state, lastReadAt: p.last_read_at ? p.last_read_at.toISOString() : null }));

    return {
      id: t.id,
      kind: t.kind,
      title: t.title,
      participants,
      lastMessage: lastByThread.get(t.id) ?? null,
      lastMessageAt: t.last_message_at ? t.last_message_at.toISOString() : null,
      unreadCount: viewerState === "ACTIVE" || viewerState === "REQUESTED" ? (unreadByThread.get(t.id) ?? 0) : 0,
      viewerState,
      canSend,
      mutedUntil: me?.muted_until && me.muted_until > new Date() ? me.muted_until.toISOString() : null,
    };
  });
}

export async function presentThread(viewer: Actor, thread: ThreadRow, exec: Executor = db): Promise<Thread> {
  return (await presentThreads(viewer, [thread], exec))[0]!;
}
