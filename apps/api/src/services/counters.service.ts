/**
 * Denormalised counters. Writes adjust them in the same transaction as the row they
 * count; `reconcileCounters` (the maintenance.reconcile-counters job) recomputes them
 * from the rows themselves, counting PUBLISHED items only, and touches only rows that
 * drifted.
 *
 * Definitions (shared with the moderation module's status changes):
 *   communities.member_count  ACTIVE memberships
 *   communities.post_count    PUBLISHED posts
 *   users.post_count          PUBLISHED posts by the user
 *   posts.comment_count       PUBLISHED comments on the post, replies included
 *   comments.reply_count      PUBLISHED replies
 *   reaction_count/_counts    reaction rows
 *   users.reputation          sum of the user's points_ledger rows (never below 0)
 *   users.level               levelFor(reputation), domain/points.ts
 */
import { sql } from "kysely";
import { db, type Executor } from "../db/kysely";
import { communityRepo } from "../repositories/community.repository";
import { levelSql } from "../repositories/points.repository";
import type { PostRow } from "../repositories/post.repository";
import * as points from "./points.service";

/** A post became visible (created PUBLISHED). */
export async function postPublished(post: Pick<PostRow, "id" | "community_id" | "author_id">, exec: Executor): Promise<void> {
  await communityRepo.adjust(post.community_id, { posts: 1 }, exec);
  await exec.updateTable("users").set({ post_count: sql`post_count + 1` }).where("id", "=", post.author_id).execute();
  await points.award({ userId: post.author_id, reason: "post_created", entityType: "post", entityId: post.id, actorId: post.author_id }, exec);
}

/** A visible post went away (deleted or removed). Its points, reaction points included, are revoked. */
export async function postUnpublished(post: Pick<PostRow, "id" | "community_id" | "author_id">, exec: Executor): Promise<void> {
  await communityRepo.adjust(post.community_id, { posts: -1 }, exec);
  await exec.updateTable("users").set({ post_count: sql`greatest(0, post_count - 1)` }).where("id", "=", post.author_id).execute();
  await points.revokeEntity("post", post.id, exec);
}

/** Run every reconciliation statement; returns how many rows each one corrected. */
export async function reconcileCounters(exec: Executor = db): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const run = async (name: string, query: ReturnType<typeof sql>) => {
    const r = await query.execute(exec);
    out[name] = Number(r.numAffectedRows ?? 0);
  };

  await run(
    "communities",
    sql`WITH m AS (SELECT community_id, count(*)::int AS n FROM community_members WHERE status = 'ACTIVE' GROUP BY 1),
             p AS (SELECT community_id, count(*)::int AS n FROM posts WHERE status = 'PUBLISHED' GROUP BY 1)
        UPDATE communities c SET member_count = coalesce(m.n, 0), post_count = coalesce(p.n, 0)
        FROM communities c2 LEFT JOIN m ON m.community_id = c2.id LEFT JOIN p ON p.community_id = c2.id
        WHERE c2.id = c.id AND (c.member_count <> coalesce(m.n, 0) OR c.post_count <> coalesce(p.n, 0))`,
  );

  await run(
    "users",
    sql`WITH p AS (SELECT author_id AS id, count(*)::int AS n FROM posts WHERE status = 'PUBLISHED' GROUP BY 1),
             fr AS (SELECT followee_id AS id, count(*)::int AS n FROM follows GROUP BY 1),
             fg AS (SELECT follower_id AS id, count(*)::int AS n FROM follows GROUP BY 1)
        UPDATE users u SET post_count = coalesce(p.n, 0), follower_count = coalesce(fr.n, 0), following_count = coalesce(fg.n, 0)
        FROM users u2 LEFT JOIN p ON p.id = u2.id LEFT JOIN fr ON fr.id = u2.id LEFT JOIN fg ON fg.id = u2.id
        WHERE u2.id = u.id AND (u.post_count <> coalesce(p.n, 0) OR u.follower_count <> coalesce(fr.n, 0) OR u.following_count <> coalesce(fg.n, 0))`,
  );

  // Reputation is the ledger's sum; the ledger is the source of truth (awards are idempotent rows).
  await run(
    "reputation",
    sql`WITH l AS (SELECT user_id, greatest(0, sum(amount))::int AS n FROM points_ledger GROUP BY 1)
        UPDATE users u SET reputation = coalesce(l.n, 0), level = ${levelSql(sql`coalesce(l.n, 0)`)}
        FROM users u2 LEFT JOIN l ON l.user_id = u2.id
        WHERE u2.id = u.id AND (u.reputation <> coalesce(l.n, 0) OR u.level <> ${levelSql(sql`coalesce(l.n, 0)`)})`,
  );

  await run(
    "posts",
    sql`WITH cm AS (SELECT post_id, count(*)::int AS n FROM comments WHERE status = 'PUBLISHED' GROUP BY 1),
             rt AS (SELECT post_id, type::text AS type, count(*)::int AS n FROM post_reactions GROUP BY 1, 2),
             r AS (SELECT post_id, sum(n)::int AS n, jsonb_object_agg(type, n) AS counts FROM rt GROUP BY 1)
        UPDATE posts p SET comment_count = coalesce(cm.n, 0), reaction_count = coalesce(r.n, 0), reaction_counts = coalesce(r.counts, '{}'::jsonb)
        FROM posts p2 LEFT JOIN cm ON cm.post_id = p2.id LEFT JOIN r ON r.post_id = p2.id
        WHERE p2.id = p.id AND (p.comment_count <> coalesce(cm.n, 0) OR p.reaction_count <> coalesce(r.n, 0) OR p.reaction_counts <> coalesce(r.counts, '{}'::jsonb))`,
  );

  await run(
    "comments",
    sql`WITH rp AS (SELECT parent_id AS id, count(*)::int AS n FROM comments WHERE status = 'PUBLISHED' AND parent_id IS NOT NULL GROUP BY 1),
             rt AS (SELECT comment_id, type::text AS type, count(*)::int AS n FROM comment_reactions GROUP BY 1, 2),
             r AS (SELECT comment_id, sum(n)::int AS n, jsonb_object_agg(type, n) AS counts FROM rt GROUP BY 1)
        UPDATE comments c SET reply_count = coalesce(rp.n, 0), reaction_count = coalesce(r.n, 0), reaction_counts = coalesce(r.counts, '{}'::jsonb)
        FROM comments c2 LEFT JOIN rp ON rp.id = c2.id LEFT JOIN r ON r.comment_id = c2.id
        WHERE c2.id = c.id AND (c.reply_count <> coalesce(rp.n, 0) OR c.reaction_count <> coalesce(r.n, 0) OR c.reaction_counts <> coalesce(r.counts, '{}'::jsonb))`,
  );

  await run(
    "poll_options",
    sql`WITH v AS (SELECT option_id, count(*)::int AS n FROM poll_votes GROUP BY 1)
        UPDATE poll_options o SET vote_count = coalesce(v.n, 0)
        FROM poll_options o2 LEFT JOIN v ON v.option_id = o2.id
        WHERE o2.id = o.id AND o.vote_count <> coalesce(v.n, 0)`,
  );

  await run(
    "polls",
    sql`WITH v AS (SELECT poll_id, count(*)::int AS total, count(DISTINCT user_id)::int AS voters FROM poll_votes GROUP BY 1)
        UPDATE polls p SET total_votes = coalesce(v.total, 0), voter_count = coalesce(v.voters, 0)
        FROM polls p2 LEFT JOIN v ON v.poll_id = p2.id
        WHERE p2.id = p.id AND (p.total_votes <> coalesce(v.total, 0) OR p.voter_count <> coalesce(v.voters, 0))`,
  );

  await run(
    "questions",
    sql`WITH a AS (SELECT question_id, count(*)::int AS n FROM answers WHERE status = 'PUBLISHED' GROUP BY 1),
             v AS (SELECT question_id, sum(value)::int AS s FROM question_votes GROUP BY 1)
        UPDATE questions q SET answer_count = coalesce(a.n, 0), score = coalesce(v.s, 0)
        FROM questions q2 LEFT JOIN a ON a.question_id = q2.id LEFT JOIN v ON v.question_id = q2.id
        WHERE q2.id = q.id AND (q.answer_count <> coalesce(a.n, 0) OR q.score <> coalesce(v.s, 0))`,
  );

  await run(
    "answers",
    sql`WITH v AS (SELECT answer_id, sum(value)::int AS s FROM answer_votes GROUP BY 1)
        UPDATE answers a SET score = coalesce(v.s, 0)
        FROM answers a2 LEFT JOIN v ON v.answer_id = a2.id
        WHERE a2.id = a.id AND a.score <> coalesce(v.s, 0)`,
  );

  await run(
    "events",
    sql`WITH r AS (SELECT event_id,
                          count(*) FILTER (WHERE status = 'GOING')::int AS going,
                          count(*) FILTER (WHERE status = 'WAITLISTED')::int AS waitlisted,
                          count(*) FILTER (WHERE status = 'INTERESTED')::int AS interested
                   FROM event_rsvps GROUP BY 1)
        UPDATE events e SET going_count = coalesce(r.going, 0), waitlist_count = coalesce(r.waitlisted, 0), interested_count = coalesce(r.interested, 0)
        FROM events e2 LEFT JOIN r ON r.event_id = e2.id
        WHERE e2.id = e.id AND (e.going_count <> coalesce(r.going, 0) OR e.waitlist_count <> coalesce(r.waitlisted, 0) OR e.interested_count <> coalesce(r.interested, 0))`,
  );

  // Timed community suspensions that ran out (the request path also lifts them lazily).
  await run(
    "expired_community_suspensions",
    sql`UPDATE community_members SET status = 'ACTIVE', suspended_until = NULL, updated_at = now()
        WHERE status = 'SUSPENDED' AND suspended_until IS NOT NULL AND suspended_until <= now()`,
  );
  if (out.expired_community_suspensions) {
    await run(
      "communities_after_lift",
      sql`WITH m AS (SELECT community_id, count(*)::int AS n FROM community_members WHERE status = 'ACTIVE' GROUP BY 1)
          UPDATE communities c SET member_count = coalesce(m.n, 0)
          FROM communities c2 LEFT JOIN m ON m.community_id = c2.id
          WHERE c2.id = c.id AND c.member_count <> coalesce(m.n, 0)`,
    );
  }
  return out;
}
