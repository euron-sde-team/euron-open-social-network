/**
 * Pre-moderation: which new posts wait for a moderator before anyone else sees them.
 *
 *   - the community has premoderate_posts on, or
 *   - settings.moderation.premoderateNewAccounts is enabled and the author's account is
 *     younger than accountAgeDays AND has fewer than firstPosts published posts.
 *
 * Platform staff and the community's own moderators are never held. A held post is
 * created PENDING_REVIEW and its PREMODERATION case is opened in the same transaction
 * (post.service.ts), so it never depends on the scan job running.
 */
import type { Actor } from "../core/context";
import { isStaff } from "../core/context";
import { db, type Executor } from "../db/kysely";
import type { CommunityRow } from "../repositories/community.repository";
import { getSettings } from "./settings.service";

export async function requiresPremoderation(actor: Actor, community: Pick<CommunityRow, "premoderate_posts">, opts: { isCommunityModerator?: boolean } = {}, exec: Executor = db): Promise<boolean> {
  if (isStaff(actor) || opts.isCommunityModerator) return false;
  if (community.premoderate_posts) return true;
  const rule = (await getSettings(exec)).moderation.premoderateNewAccounts;
  if (!rule.enabled) return false;
  const user = await exec.selectFrom("users").select("created_at").where("id", "=", actor.id).executeTakeFirst();
  if (!user) return true;
  const ageDays = (Date.now() - user.created_at.getTime()) / 86400_000;
  if (ageDays >= rule.accountAgeDays) return false;
  const published = await exec
    .selectFrom("posts")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("author_id", "=", actor.id)
    .where("status", "=", "PUBLISHED")
    .executeTakeFirstOrThrow();
  return Number(published.n) < rule.firstPosts;
}
