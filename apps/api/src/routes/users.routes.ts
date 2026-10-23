/** /api/users: profiles, the follow graph, blocks, your own profile, bookmarks and sessions. */
import { Router } from "express";
import * as ctrl from "../controllers/user.controller";
import { authenticate, optionalAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();

const follows = rateLimit("follows", 60, 60);

/** Edit your profile: display name, headline, bio, location, website, avatar and cover (upload ids), DM privacy, digest emails (`emailDigest`). Returns `Me`. */
router.patch("/me", authenticate, ctrl.updateMe);
/**
 * Delete your account: `{ password, totp? }` (or `recoveryCode`). Deactivates and anonymises it; content stays as
 * "Deleted user". 204. 409 OWNER_MUST_TRANSFER (with `details.communities`) while you own a community, 409 LAST_ADMIN.
 */
router.delete("/me", authenticate, rateLimit("account-delete", 5, 3600), ctrl.deleteMe);
/** Download your data (profile, posts, comments, messages you sent, memberships, follows, blocks, reports, notifications) as JSON. 3 per day. */
router.get("/me/export", authenticate, rateLimit("account-export", 3, 86400), ctrl.exportMe);
/** Your bookmarked posts, newest bookmark first (`Page<Post>`). Posts you can no longer see drop out. */
router.get("/me/bookmarks", authenticate, ctrl.myBookmarks);
/** People you have blocked (`UserSummary[]`). */
router.get("/me/blocks", authenticate, ctrl.myBlocks);
/** Your signed-in sessions. */
router.get("/me/sessions", authenticate, ctrl.mySessions);
/** Sign out one session (and every rotation of it). 204. */
router.delete("/me/sessions/:id", authenticate, ctrl.revokeSession);
/** People in your communities you do not follow yet (`UserSummary[]`). */
router.get("/suggestions", authenticate, ctrl.suggestions);
/** A profile (`Profile`). 404 when either side has blocked the other. */
router.get("/:username", optionalAuth, ctrl.profile);
/** A profile's posts (`Page<Post>`); you also see your own pending and hidden posts, with their status. */
router.get("/:username/posts", optionalAuth, ctrl.posts);
/** Media from a profile's visible posts (`Page<Media>`). */
router.get("/:username/media", optionalAuth, ctrl.media);
/** Public communities the person is in, plus private ones you share (`Community[]`). */
router.get("/:username/communities", optionalAuth, ctrl.communities);
/** Followers (`Page<FollowEntry>`): each row carries `viewerFollows` (false when signed out). */
router.get("/:username/followers", optionalAuth, ctrl.followers);
/** Accounts the person follows (`Page<FollowEntry>`): each row carries `viewerFollows`. */
router.get("/:username/following", optionalAuth, ctrl.following);
/** Follow someone. 204; notifies them (FOLLOW). */
router.post("/:id/follow", authenticate, follows, ctrl.follow);
/** Unfollow. 204. */
router.delete("/:id/follow", authenticate, follows, ctrl.unfollow);
/** Block someone. 204. Also removes follows in both directions. */
router.post("/:id/block", authenticate, ctrl.block);
/** Unblock. 204. */
router.delete("/:id/block", authenticate, ctrl.unblock);
