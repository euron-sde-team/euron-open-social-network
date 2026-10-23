/**
 * The API contract shared by apps/api and apps/web: response shapes (DTOs) and the
 * Socket.IO event map. Timestamps are ISO-8601 strings. Ids are ULIDs.
 *
 * Changing a shape here is a breaking change for one side or the other; both apps
 * typecheck against this file, so the compiler finds every caller.
 */

// ─── Enums (mirrors db/migrations) ──────────────────────────────────────────

export const REACTIONS = ["LIKE", "LOVE", "CARE", "HAHA", "WOW", "SAD", "ANGRY"] as const;
export type ReactionType = (typeof REACTIONS)[number];

export type UserRole = "USER" | "MODERATOR" | "ADMIN";
export type UserStatus = "PENDING_VERIFICATION" | "ACTIVE" | "SUSPENDED" | "BANNED" | "DEACTIVATED";
export type DmPrivacy = "COMMUNITIES" | "FOLLOWING" | "NOBODY";
export type CommunityVisibility = "PUBLIC" | "PRIVATE";
export type JoinPolicy = "OPEN" | "APPROVAL" | "INVITE_ONLY";
export type CommunityRole = "OWNER" | "ADMIN" | "MODERATOR" | "MEMBER";
export type MembershipStatus = "ACTIVE" | "PENDING" | "SUSPENDED" | "BANNED" | "LEFT";
export type ContentStatus = "PUBLISHED" | "PENDING_REVIEW" | "HIDDEN" | "REMOVED" | "DELETED";
export type ModerationState = "UNCHECKED" | "CLEAN" | "REVIEW" | "FLAGGED";
export type UploadPurpose = "POST" | "COMMENT" | "CHAT" | "DM" | "AVATAR" | "COVER" | "COMMUNITY_ICON" | "COMMUNITY_COVER" | "EVENT_COVER";
export type UploadKind = "IMAGE" | "VIDEO" | "AUDIO" | "PDF" | "DOCUMENT" | "OTHER";
export type UploadStatus = "PENDING" | "COMPLETE" | "READY" | "REJECTED" | "DELETED";
export type RsvpStatus = "GOING" | "WAITLISTED" | "INTERESTED" | "CANCELLED";
export type QuestionStatus = "OPEN" | "RESOLVED" | "CLOSED";
export type ModerationTarget = "POST" | "COMMENT" | "CHAT_MESSAGE" | "DM_MESSAGE" | "QUESTION" | "ANSWER" | "EVENT" | "USER" | "COMMUNITY";
export type ReportReason = "SPAM" | "HARASSMENT" | "HATE" | "VIOLENCE" | "SEXUAL" | "SELF_HARM" | "MISINFORMATION" | "IMPERSONATION" | "OTHER";
export type ModerationActionType = "APPROVE" | "HIDE" | "REMOVE" | "RESTORE" | "WARN" | "SUSPEND" | "BAN" | "UNBAN" | "DISMISS";
export type CaseSource = "AI" | "REPORT" | "PREMODERATION";
export type AppealStatus = "PENDING" | "UPHELD" | "OVERTURNED";
export type NotificationType =
  | "POST_COMMENT" | "COMMENT_REPLY" | "POST_REACTION" | "COMMENT_REACTION" | "MENTION" | "FOLLOW"
  | "JOIN_REQUEST" | "MEMBERSHIP_APPROVED" | "COMMUNITY_INVITE" | "DM_REQUEST"
  | "EVENT_UPDATED" | "EVENT_CANCELLED" | "EVENT_PROMOTED" | "EVENT_REMINDER"
  | "ANSWER_POSTED" | "ANSWER_ACCEPTED" | "MODERATION_ACTION" | "APPEAL_DECIDED";

// ─── Envelopes ──────────────────────────────────────────────────────────────

/** Keyset page: pass `nextCursor` back as `?cursor=` until it is null. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Every non-2xx response. `code` is stable; switch on it, not on `error`. */
export interface ApiError {
  error: string;
  code: string;
  details?: unknown;
  requestId?: string;
}

// ─── People ─────────────────────────────────────────────────────────────────

export interface Media {
  id: string;
  kind: UploadKind;
  mimeType: string;
  fileName: string;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  /** Short-lived signed URL; refetch the parent resource after it expires. */
  url: string;
  thumbUrl: string | null;
  status: UploadStatus;
}

export interface UserSummary {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  headline: string | null;
  role: UserRole;
}

export interface Profile extends UserSummary {
  bio: string | null;
  location: string | null;
  website: string | null;
  coverUrl: string | null;
  reputation: number;
  level: number;
  postCount: number;
  followerCount: number;
  followingCount: number;
  joinedAt: string;
  /** Relationship from the viewer's side; all false when signed out or viewing yourself. */
  viewer: {
    isSelf: boolean;
    following: boolean;
    followedBy: boolean;
    blocked: boolean;
    /** Whether the viewer may open a DM right now, and why not if they cannot. */
    canMessage: boolean;
    messageBlockedReason: DmDenialReason | null;
  };
}

export interface Me extends UserSummary {
  email: string;
  status: UserStatus;
  /** When a SUSPENDED account's suspension ends (ISO); null otherwise. */
  suspendedUntil: string | null;
  emailVerified: boolean;
  totpEnabled: boolean;
  dmPrivacy: DmPrivacy;
  /** Whether "while you were away" digest emails are sent (PATCH /api/users/me { emailDigest }). */
  emailDigest: boolean;
  reputation: number;
  level: number;
}

/** GET /api/meta: public facts about this network, for page titles and the sign-up form. */
export interface NetworkMeta {
  networkName: string;
  registration: "OPEN" | "INVITE_ONLY" | "CLOSED";
}

export interface AuthResult {
  accessToken: string;
  /** Seconds until the access token expires; refresh through POST /api/auth/refresh. */
  expiresIn: number;
  user: Me;
}

// ─── Communities ────────────────────────────────────────────────────────────

export interface CommunityRule {
  title: string;
  body: string;
}

export interface Community {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  rules: CommunityRule[];
  visibility: CommunityVisibility;
  joinPolicy: JoinPolicy;
  allowMemberPosts: boolean;
  premoderatePosts: boolean;
  color: string | null;
  iconUrl: string | null;
  coverUrl: string | null;
  memberCount: number;
  postCount: number;
  createdAt: string;
  createdBy: UserSummary | null;
  viewer: {
    role: CommunityRole | null;
    status: MembershipStatus | null;
    /** ACTIVE member: may read private content, chat and post (if allowed). */
    isMember: boolean;
    canPost: boolean;
    canModerate: boolean;
  };
  /** Oversight state, present only when the viewer is platform staff (MODERATOR or ADMIN). */
  admin?: {
    /** New accounts join default communities automatically. */
    isDefault: boolean;
    status: ContentStatus;
  };
}

export interface Member {
  id: string;
  user: UserSummary;
  role: CommunityRole;
  status: MembershipStatus;
  joinedAt: string | null;
  requestedAt: string | null;
}

export interface Invite {
  id: string;
  code: string;
  url: string;
  maxUses: number | null;
  uses: number;
  expiresAt: string | null;
}

// ─── Posts ──────────────────────────────────────────────────────────────────

export type ReactionCounts = Partial<Record<ReactionType, number>>;

export interface PollOption {
  id: string;
  label: string;
  voteCount: number;
  votedByViewer: boolean;
}

export interface Poll {
  id: string;
  question: string;
  allowMultiple: boolean;
  isAnonymous: boolean;
  closesAt: string | null;
  isClosed: boolean;
  totalVotes: number;
  voterCount: number;
  options: PollOption[];
}

export interface Post {
  id: string;
  kind: "POST" | "ANNOUNCEMENT";
  community: Pick<Community, "id" | "slug" | "name" | "iconUrl" | "visibility">;
  author: UserSummary;
  body: string;
  feeling: string | null;
  tags: string[];
  mentions: UserSummary[];
  media: Media[];
  poll: Poll | null;
  sharedPost: Post | null;
  status: ContentStatus;
  isPinned: boolean;
  isLocked: boolean;
  reactionCount: number;
  reactionCounts: ReactionCounts;
  commentCount: number;
  shareCount: number;
  createdAt: string;
  editedAt: string | null;
  viewer: {
    reaction: ReactionType | null;
    bookmarked: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canModerate: boolean;
  };
}

export interface Comment {
  id: string;
  postId: string;
  parentId: string | null;
  author: UserSummary;
  body: string;
  media: Media | null;
  mentions: UserSummary[];
  status: ContentStatus;
  replyCount: number;
  reactionCount: number;
  reactionCounts: ReactionCounts;
  createdAt: string;
  editedAt: string | null;
  viewer: { reaction: ReactionType | null; canEdit: boolean; canDelete: boolean };
}

// ─── Q&A ────────────────────────────────────────────────────────────────────

export interface Question {
  id: string;
  communityId: string;
  community: Pick<Community, "id" | "slug" | "name">;
  author: UserSummary;
  title: string;
  body: string;
  tags: string[];
  status: QuestionStatus;
  score: number;
  answerCount: number;
  viewCount: number;
  acceptedAnswerId: string | null;
  createdAt: string;
  updatedAt: string;
  viewer: {
    vote: -1 | 0 | 1;
    canEdit: boolean;
    canAccept: boolean;
    /** The author, an ACTIVE community mod or platform staff: exactly who DELETE /questions/:id allows. */
    canDelete: boolean;
    /** Community mod or platform staff: may delete it and open or close it (POST /:id/status). */
    canModerate: boolean;
  };
}

export interface Answer {
  id: string;
  questionId: string;
  author: UserSummary;
  body: string;
  score: number;
  isAccepted: boolean;
  createdAt: string;
  updatedAt: string;
  viewer: {
    vote: -1 | 0 | 1;
    canEdit: boolean;
    /** The author, an ACTIVE community mod or platform staff: exactly who DELETE /questions/answers/:id allows. */
    canDelete: boolean;
  };
}

// ─── Events ─────────────────────────────────────────────────────────────────

export interface CommunityEvent {
  id: string;
  community: Pick<Community, "id" | "slug" | "name"> | null;
  organizer: UserSummary;
  title: string;
  description: string;
  coverUrl: string | null;
  location: string | null;
  isVirtual: boolean;
  /** Only present for people who are GOING (or organisers); null otherwise. */
  virtualLink: string | null;
  startsAt: string;
  endsAt: string;
  timezone: string;
  capacity: number | null;
  goingCount: number;
  waitlistCount: number;
  interestedCount: number;
  status: "SCHEDULED" | "CANCELLED";
  viewer: {
    rsvp: RsvpStatus | null;
    /** 1-based place among WAITLISTED people (promotion order); null unless the viewer is WAITLISTED. */
    waitlistPosition: number | null;
    canEdit: boolean;
  };
}

// ─── Messaging ──────────────────────────────────────────────────────────────

export type DmDenialReason =
  | "SELF"
  | "BLOCKED"
  | "NO_SHARED_COMMUNITY"
  | "RECIPIENT_NOT_FOLLOWING"
  | "RECIPIENT_DISABLED_DMS"
  | "RECIPIENT_UNAVAILABLE"
  | "SENDER_RESTRICTED";

export interface MessageReactionSummary {
  emoji: string;
  count: number;
  reactedByViewer: boolean;
}

export interface Message {
  id: string;
  /** DM thread id, or the community id for community chat. */
  roomId: string;
  sender: UserSummary;
  body: string;
  media: Media[];
  replyTo: { id: string; body: string; senderName: string } | null;
  reactions: MessageReactionSummary[];
  status: ContentStatus;
  isPinned: boolean;
  createdAt: string;
  editedAt: string | null;
}

export interface ThreadParticipant {
  user: UserSummary;
  state: "ACTIVE" | "REQUESTED" | "DECLINED" | "LEFT";
  lastReadAt: string | null;
}

export interface Thread {
  id: string;
  kind: "DIRECT" | "GROUP";
  title: string | null;
  participants: ThreadParticipant[];
  lastMessage: Message | null;
  lastMessageAt: string | null;
  unreadCount: number;
  /** The viewer's own state: REQUESTED means this thread is in their "Message requests". */
  viewerState: "ACTIVE" | "REQUESTED" | "DECLINED" | "LEFT";
  /** False when a block exists or the counterpart can no longer be messaged. */
  canSend: boolean;
  mutedUntil: string | null;
}

// ─── Notifications ──────────────────────────────────────────────────────────

export interface Notification {
  id: string;
  type: NotificationType;
  actor: UserSummary | null;
  entityType: string;
  entityId: string;
  communityId: string | null;
  snippet: string | null;
  /** Where the web app should navigate on click (a path, not a full URL). */
  href: string;
  readAt: string | null;
  createdAt: string;
}

// ─── Search and discovery ───────────────────────────────────────────────────

export interface SearchResults {
  people: UserSummary[];
  communities: Community[];
  posts: Post[];
  questions: Question[];
}

export interface TrendingTag {
  tag: string;
  postCount: number;
}

export interface LeaderboardEntry {
  user: UserSummary;
  reputation: number;
  level: number;
  rank: number;
}

// ─── Moderation ─────────────────────────────────────────────────────────────

export interface ModerationCase {
  id: string;
  targetType: ModerationTarget;
  targetId: string;
  community: Pick<Community, "id" | "slug" | "name"> | null;
  author: UserSummary | null;
  source: CaseSource;
  status: "OPEN" | "RESOLVED";
  priority: number;
  aiProvider: string | null;
  aiScores: Record<string, number> | null;
  aiCategories: string[];
  reportCount: number;
  reasons: { reason: ReportReason; count: number }[];
  /** The content as it was when the case opened (text, media ids, author). */
  snapshot: { body?: string; title?: string; media?: Media[]; [key: string]: unknown };
  /** Current status of the target (it may have changed since the snapshot). */
  targetStatus: ContentStatus | UserStatus | null;
  resolution: ModerationActionType | null;
  resolvedBy: UserSummary | null;
  openedAt: string;
  resolvedAt: string | null;
  appeal: Appeal | null;
}

export interface Appeal {
  id: string;
  caseId: string;
  appellant: UserSummary;
  statement: string;
  status: AppealStatus;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface ModerationActionRecord {
  id: string;
  caseId: string | null;
  actor: UserSummary | null;
  action: ModerationActionType;
  targetType: ModerationTarget;
  targetId: string;
  reason: string | null;
  createdAt: string;
}

/** Per-category thresholds, 0..1. A score at or above `hide` hides; at or above `review` queues. */
export interface ModerationSettings {
  enabled: boolean;
  provider: "rules" | "openai" | "stub";
  thresholds: Record<string, { review: number; hide: number }>;
  /** Hold the first N posts of new accounts for review before they are visible. */
  premoderateNewAccounts: { enabled: boolean; firstPosts: number; accountAgeDays: number };
  blockedTerms: string[];
}

export interface PlatformSettings {
  networkName: string;
  /** Who may create communities: everyone, or only moderators and admins. */
  communityCreation: "EVERYONE" | "STAFF";
  maxCommunitiesPerUser: number;
  networkWideEvents: "EVERYONE" | "STAFF";
  registration: "OPEN" | "INVITE_ONLY" | "CLOSED";
  moderation: ModerationSettings;
}

export interface AuditEntry {
  id: string;
  actor: UserSummary | null;
  action: string;
  entityType: string;
  entityId: string | null;
  data: Record<string, unknown>;
  createdAt: string;
}

// ─── Realtime (Socket.IO) ───────────────────────────────────────────────────
//
// Rooms (server-side only; clients never join rooms directly):
//   user:<id>        every socket of a user: notifications, presence of contacts and every
//                    DM event (messages, edits, reads and typing), so all tabs get them
//   thread:<id>      marks an open DM thread (participation checked on subscribe). Nothing
//                    is broadcast to it today; the server drops sockets from it when the
//                    user leaves a group or a block ends the conversation
//   chat:<id>        a community chat room (membership checked on subscribe)
//   community:<id>   feed signals for an open community page
//   post:<id>        live counts for an open post
//
// Leaving, removal, a ban or a suspension in a community takes the user's sockets out of
// its chat: and community: rooms at once. Handshake errors: MISSING, INVALID, BANNED,
// DEACTIVATED, TOO_MANY_CONNECTIONS (over 20 live sockets per user). Subscribe and
// presence:query acks answer RATE_LIMITED past 30 requests per socket per 10 seconds.

export interface ServerToClientEvents {
  "notification:new": (n: Notification) => void;
  "notification:count": (p: { unread: number }) => void;

  "dm:message": (p: { threadId: string; message: Message }) => void;
  "dm:message:updated": (p: { threadId: string; message: Message }) => void;
  "dm:message:deleted": (p: { threadId: string; messageId: string }) => void;
  "dm:read": (p: { threadId: string; userId: string; lastReadAt: string }) => void;
  "dm:typing": (p: { threadId: string; userId: string; typing: boolean }) => void;
  "dm:request": (p: { thread: Thread }) => void;
  "dm:thread:updated": (p: { thread: Thread }) => void;

  "chat:message": (p: { communityId: string; message: Message }) => void;
  "chat:message:updated": (p: { communityId: string; message: Message }) => void;
  "chat:message:deleted": (p: { communityId: string; messageId: string }) => void;
  "chat:typing": (p: { communityId: string; userId: string; displayName: string; typing: boolean }) => void;

  "feed:new-posts": (p: { communityId: string | null; count: number; latestId: string }) => void;
  "post:updated": (p: { postId: string; reactionCount: number; reactionCounts: ReactionCounts; commentCount: number }) => void;
  "post:removed": (p: { postId: string }) => void;
  "post:comment": (p: { postId: string; comment: Comment }) => void;

  "presence:update": (p: { userId: string; online: boolean; lastSeenAt: string | null }) => void;
  "moderation:queue": (p: { openCases: number }) => void;
  "session:revoked": (p: { reason: "SUSPENDED" | "BANNED" | "SIGNED_OUT" }) => void;
}

/** Acknowledgement callback shape for client requests. */
export type Ack<T = undefined> = (res: { ok: true; data?: T } | { ok: false; code: string; error: string }) => void;

export interface ClientToServerEvents {
  "dm:typing": (p: { threadId: string; typing: boolean }) => void;
  "chat:typing": (p: { communityId: string; typing: boolean }) => void;
  "chat:subscribe": (p: { communityId: string }, ack: Ack) => void;
  "chat:unsubscribe": (p: { communityId: string }) => void;
  "community:subscribe": (p: { communityId: string }, ack: Ack) => void;
  "community:unsubscribe": (p: { communityId: string }) => void;
  "post:subscribe": (p: { postId: string }, ack: Ack) => void;
  "post:unsubscribe": (p: { postId: string }) => void;
  "thread:subscribe": (p: { threadId: string }, ack: Ack) => void;
  "thread:unsubscribe": (p: { threadId: string }) => void;
  /** Online status of people the viewer could know about (shared community, follow, DM); others are omitted. */
  "presence:query": (p: { userIds: string[] }, ack: Ack<Record<string, boolean>>) => void;
}

export * from "./social";
export * from "./messaging";
export * from "./admin";
