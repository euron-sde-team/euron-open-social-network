/**
 * Mention notifications a post skipped while it was not visible. A pre-moderated post
 * (PENDING_REVIEW) notifies nobody when it is written; when a moderator approves it, or
 * a hidden post becomes PUBLISHED again, the people it mentions are told then.
 *
 * Idempotent: anyone who already has a MENTION notification for the post is skipped, so
 * restoring a post that was published before re-notifies nobody. The same reader rule as
 * at creation applies (a private community's text only reaches its members), and
 * notify() drops blocked pairs.
 *
 * Kept apart from post.service.ts so the moderation targets adapter can call it without
 * an import cycle.
 */
import type { Effects } from "../core/effects";
import type { Executor } from "../db/kysely";
import { notify } from "./notification.service";

export async function notifySkippedMentions(postId: string, exec: Executor, fx: Effects): Promise<void> {
  const post = await exec
    .selectFrom("posts as p")
    .innerJoin("communities as c", "c.id", "p.community_id")
    .select(["p.id", "p.author_id", "p.community_id", "p.body", "c.visibility"])
    .where("p.id", "=", postId)
    .executeTakeFirst();
  if (!post) return;
  let q = exec
    .selectFrom("post_mentions as pm")
    .innerJoin("users as u", "u.id", "pm.user_id")
    .select("pm.user_id")
    .where("pm.post_id", "=", post.id)
    .where("u.status", "=", "ACTIVE")
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("notifications as n")
            .select("n.id")
            .whereRef("n.recipient_id", "=", "pm.user_id")
            .where("n.type", "=", "MENTION")
            .where("n.entity_type", "=", "post")
            .where("n.entity_id", "=", post.id),
        ),
      ),
    );
  if (post.visibility === "PRIVATE") {
    q = q.where((eb) =>
      eb.exists(
        eb
          .selectFrom("community_members as cm")
          .select("cm.id")
          .whereRef("cm.user_id", "=", "pm.user_id")
          .where("cm.community_id", "=", post.community_id)
          .where("cm.status", "=", "ACTIVE"),
      ),
    );
  }
  for (const { user_id } of await q.execute()) {
    await notify(
      { recipientId: user_id, actorId: post.author_id, type: "MENTION", entityType: "post", entityId: post.id, communityId: post.community_id, snippet: post.body, data: { postId: post.id } },
      fx,
      exec,
    );
  }
}
