/** /api/communities: the directory, community settings, membership and join requests, member moderation, invites and community feeds. */
import { Router } from "express";
import * as ctrl from "../controllers/community.controller";
import { authenticate, optionalAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();

const writes = rateLimit("community-writes", 30, 60);

/** The directory (`Page<Community>`): `q`, `filter=all|joined|managed`. Public communities plus private ones you belong to. */
router.get("/", optionalAuth, ctrl.list);
/** Popular public communities you have not joined (`Community[]`). */
router.get("/suggested", authenticate, ctrl.suggested);
/** Create a community (201 `Community`). Subject to settings.communityCreation and maxCommunitiesPerUser. */
router.post("/", authenticate, rateLimit("community-create", 5, 3600), ctrl.create);
/** An invite link's card: `{ community, invite }`. 404 when revoked, expired or used up. */
router.get("/invites/:code", authenticate, ctrl.invite);
/** A community by slug (`Community`); a private one you are not in is a limited card. */
router.get("/:slug", optionalAuth, ctrl.get);
/** Edit (`Community`). Moderators edit the description, rules, colour and images; name, slug, visibility, join policy and posting rules need OWNER or ADMIN. */
router.patch("/:id", authenticate, writes, ctrl.update);
/** Delete the community (OWNER or platform admin). 204. */
router.delete("/:id", authenticate, ctrl.remove);
/** Join: `{ inviteCode? }` -> `{ status: ACTIVE | PENDING }`. A ban or an unexpired suspension is never lifted by rejoining. */
router.post("/:id/join", authenticate, writes, ctrl.join);
/** Cancel a pending join request. 204. */
router.delete("/:id/join", authenticate, ctrl.cancelJoin);
/** Leave. 204. The OWNER must transfer ownership first. */
router.post("/:id/leave", authenticate, ctrl.leave);
/** Transfer ownership to an ACTIVE member (OWNER only): `{ userId }`. 204. */
router.post("/:id/transfer", authenticate, ctrl.transfer);
/** Members (`Page<Member>`): `status` (non-ACTIVE lists are for moderators), `role`, `q`. */
router.get("/:id/members", optionalAuth, ctrl.members);
/** Approve a join request (mod). `Member`; notifies them (MEMBERSHIP_APPROVED). */
router.post("/:id/members/:userId/approve", authenticate, ctrl.approve);
/** Reject a join request (mod). 204. */
router.post("/:id/members/:userId/reject", authenticate, ctrl.reject);
/** Change a member's role (OWNER/ADMIN): `{ role: ADMIN | MODERATOR | MEMBER }`. */
router.patch("/:id/members/:userId", authenticate, ctrl.setRole);
/** Suspend a member (mod, must outrank them): `{ days, reason? }`. */
router.post("/:id/members/:userId/suspend", authenticate, ctrl.suspend);
/** Lift a suspension (mod). */
router.post("/:id/members/:userId/unsuspend", authenticate, ctrl.unsuspend);
/** Ban a member (mod, must outrank them): `{ reason? }`. */
router.post("/:id/members/:userId/ban", authenticate, ctrl.ban);
/** Lift a ban (mod): BANNED becomes LEFT, so they may rejoin. `Member`; 409 NOT_BANNED for any other member, 404 for LEFT or unknown. Audited. */
router.post("/:id/members/:userId/unban", authenticate, ctrl.unban);
/** Remove a member (mod). 204; they may rejoin. Works on any non-LEFT membership (ACTIVE, PENDING, SUSPENDED, BANNED), so on a banned member it also lifts the ban. */
router.delete("/:id/members/:userId", authenticate, ctrl.removeMember);
/** Active invite links (mod). */
router.get("/:id/invites", authenticate, ctrl.invites);
/** Create an invite link (mod): `{ maxUses?, expiresInDays? }`. 201 `Invite`. */
router.post("/:id/invites", authenticate, writes, ctrl.createInvite);
/** Revoke an invite link (mod). 204. */
router.delete("/:id/invites/:inviteId", authenticate, ctrl.revokeInvite);
/** The community feed (`Page<Post>`): `sort=new|top|hot`, `tag`. Private communities: members only (404 otherwise). */
router.get("/:id/posts", optionalAuth, ctrl.posts);
/** Pinned posts (`Post[]`). */
router.get("/:id/posts/pinned", optionalAuth, ctrl.pinned);
/** Media from the community's posts (`Page<Media>`). */
router.get("/:id/media", optionalAuth, ctrl.media);
/** Your notification settings for this community (member). */
router.get("/:id/notification-settings", authenticate, ctrl.notificationSettings);
/** Update your notification settings for this community (member). */
router.patch("/:id/notification-settings", authenticate, ctrl.updateNotificationSettings);
