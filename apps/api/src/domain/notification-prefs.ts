/**
 * Per-community notification settings (community_members.notification_settings) and
 * which notifications each one silences. Pure, so the table below is unit-tested.
 *
 *   posts  ALL         everything about your posts, comments and answers there
 *          HIGHLIGHTS  replies, comments, mentions and answers; no reaction notifications
 *          OFF         nothing about posts, comments, mentions or Q&A in that community
 *   events false       no EVENT_UPDATED, EVENT_CANCELLED, EVENT_PROMOTED, EVENT_REMINDER
 *                      for that community's events
 *   chat   false       reserved: community chat sends no notifications today (it has an
 *                      unread count and a per-room mute instead)
 *
 * Never silenced: moderation notices, appeal decisions, join requests and approvals,
 * follows and DMs (they are not about one community's activity, or they are owed).
 */
import type { NotificationType } from "@open-social/types";

export interface CommunityNotificationSettings {
  posts: "ALL" | "HIGHLIGHTS" | "OFF";
  events: boolean;
  chat: boolean;
}

export const DEFAULT_COMMUNITY_NOTIFICATION_SETTINGS: CommunityNotificationSettings = { posts: "ALL", events: true, chat: true };

/** Stored JSON to settings, defaulting anything missing or malformed. */
export function readCommunityNotificationSettings(raw: unknown): CommunityNotificationSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<CommunityNotificationSettings>;
  const d = DEFAULT_COMMUNITY_NOTIFICATION_SETTINGS;
  return {
    posts: r.posts === "HIGHLIGHTS" || r.posts === "OFF" ? r.posts : "ALL",
    events: typeof r.events === "boolean" ? r.events : d.events,
    chat: typeof r.chat === "boolean" ? r.chat : d.chat,
  };
}

const EVENT_TYPES = new Set<NotificationType>(["EVENT_UPDATED", "EVENT_CANCELLED", "EVENT_PROMOTED", "EVENT_REMINDER"]);
const REACTION_TYPES = new Set<NotificationType>(["POST_REACTION", "COMMENT_REACTION"]);
const POST_TYPES = new Set<NotificationType>(["POST_COMMENT", "COMMENT_REPLY", "POST_REACTION", "COMMENT_REACTION", "MENTION", "ANSWER_POSTED", "ANSWER_ACCEPTED"]);

/** Whether a community's settings could silence this type at all (saves a lookup otherwise). */
export function isCommunityControlled(type: NotificationType): boolean {
  return EVENT_TYPES.has(type) || POST_TYPES.has(type);
}

export function silencedBy(type: NotificationType, s: CommunityNotificationSettings): boolean {
  if (EVENT_TYPES.has(type)) return !s.events;
  if (s.posts === "OFF") return POST_TYPES.has(type);
  if (s.posts === "HIGHLIGHTS") return REACTION_TYPES.has(type);
  return false;
}
