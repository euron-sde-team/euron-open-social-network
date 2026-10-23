/**
 * One helper per route in docs/api/rest-contract.md, grouped by area.
 * Paths here are relative to the API base (which includes /api).
 */
import type {
  AdminStats,
  AdminUserRow,
  ModerationStats,
  Answer,
  Appeal,
  AuditEntry,
  AuthResult,
  CaseSource,
  Comment,
  Community,
  CommunityEvent,
  CommunityRole,
  CommunityRule,
  CommunityVisibility,
  DmDenialReason,
  DmPrivacy,
  Invite,
  JoinPolicy,
  LeaderboardEntry,
  Me,
  Media,
  NetworkMeta,
  Member,
  MembershipStatus,
  Message,
  ModerationActionRecord,
  ModerationActionType,
  ModerationCase,
  ModerationTarget,
  Notification,
  Page,
  PlatformSettings,
  Poll,
  Post,
  FollowEntry,
  Profile,
  Question,
  QuestionStatus,
  ReactionCounts,
  ReactionType,
  ReportReason,
  RsvpStatus,
  SearchResults,
  Thread,
  TrendingTag,
  UserRole,
  UserStatus,
  UserSummary,
} from "@open-social/types";
import type { HttpClient, Query } from "./http";
import { uploadMedia, type UploadOptions } from "./upload";

export interface PageQuery {
  cursor?: string;
  limit?: number;
}

const enc = encodeURIComponent;

export interface SessionInfo {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  current: boolean;
}

export interface ReactionSummary {
  reactionCount: number;
  reactionCounts: ReactionCounts;
  viewerReaction: ReactionType | null;
}

export interface CommunityInput {
  name: string;
  slug?: string;
  description?: string | null;
  visibility: CommunityVisibility;
  joinPolicy: JoinPolicy;
  allowMemberPosts?: boolean;
  rules?: CommunityRule[];
  color?: string | null;
  iconUploadId?: string | null;
  coverUploadId?: string | null;
}

export interface CommunityNotificationSettings {
  posts: "ALL" | "HIGHLIGHTS" | "OFF";
  events: boolean;
  chat: boolean;
}

export interface PollInput {
  question: string;
  options: string[];
  allowMultiple?: boolean;
  isAnonymous?: boolean;
  closesAt?: string | null;
}

export interface NewPostInput {
  communityId: string;
  body: string;
  kind?: "POST" | "ANNOUNCEMENT";
  feeling?: string | null;
  tags?: string[];
  mediaIds?: string[];
  poll?: PollInput;
  sharedPostId?: string;
}

export interface EventInput {
  communityId: string | null;
  title: string;
  description?: string;
  location?: string | null;
  isVirtual?: boolean;
  virtualLink?: string | null;
  startsAt: string;
  endsAt: string;
  timezone?: string;
  capacity?: number | null;
  coverUploadId?: string | null;
}

export interface Contact {
  user: UserSummary;
  online: boolean;
  lastSeenAt: string | null;
}

export interface DmEligibility {
  allowed: boolean;
  reason: DmDenialReason | null;
  asRequest: boolean;
}

// Admin and moderation DTOs come from the contract package.
export type { AdminUserRow, AdminStats, ModerationStats };

/**
 * `Me` plus the suspension end the API may report while an account is
 * SUSPENDED. Optional so the client works whether or not the API sends it;
 * it collapses into `Me` once @open-social/types carries the field.
 */

export type { NetworkMeta };

export interface SignupInput {
  email: string;
  username: string;
  displayName: string;
  password: string;
  inviteCode?: string;
}

export interface LoginInput {
  login: string;
  password: string;
  totp?: string;
  /** A one-time recovery code, sent instead of `totp`. */
  recoveryCode?: string;
}

export type SignupResult = AuthResult | { verificationRequired: true; email: string };
export type LoginResult = AuthResult | { totpRequired: true };

export function createEndpoints(http: HttpClient) {
  const get = <T>(path: string, query?: Query, signal?: AbortSignal) => http.request<T>("GET", path, { query, signal });
  const post = <T = void>(path: string, body?: unknown) => http.request<T>("POST", path, { body });
  const put = <T = void>(path: string, body?: unknown) => http.request<T>("PUT", path, { body });
  const patch = <T = void>(path: string, body?: unknown) => http.request<T>("PATCH", path, { body });
  const del = <T = void>(path: string, query?: Query) => http.request<T>("DELETE", path, { query });
  const pq = (q?: object) => q as Query | undefined;

  const auth = {
    signup: (body: SignupInput) =>
      http.request<SignupResult>("POST", "/auth/signup", { body, withCredentials: true, noRefresh: true }),
    verifyEmail: (token: string) => http.request<AuthResult>("POST", "/auth/verify-email", { body: { token }, withCredentials: true, noRefresh: true }),
    resendVerification: (email: string) => http.request<void>("POST", "/auth/resend-verification", { body: { email }, noRefresh: true }),
    login: (body: LoginInput) =>
      http.request<LoginResult>("POST", "/auth/login", { body, withCredentials: true, noRefresh: true }),
    refresh: () => http.refreshSession(),
    logout: () => http.request<void>("POST", "/auth/logout", { withCredentials: true, noRefresh: true }),
    logoutAll: () => http.request<void>("POST", "/auth/logout-all", { withCredentials: true }),
    forgotPassword: (email: string) => http.request<void>("POST", "/auth/forgot-password", { body: { email }, noRefresh: true }),
    resetPassword: (token: string, password: string) => http.request<void>("POST", "/auth/reset-password", { body: { token, password }, noRefresh: true }),
    changePassword: (currentPassword: string, newPassword: string) =>
      http.request<void>("POST", "/auth/change-password", { body: { currentPassword, newPassword }, withCredentials: true }),
    me: (signal?: AbortSignal) => get<Me>("/auth/me", undefined, signal),
    totpSetup: () => post<{ secret: string; otpauthUrl: string }>("/auth/totp/setup"),
    /** Turns two-factor on and returns the one-time recovery codes (shown once). */
    totpEnable: (code: string) => post<{ recoveryCodes: string[] }>("/auth/totp/enable", { code }),
    totpDisable: (password: string, code: string) => post("/auth/totp/disable", { password, code }),
    /** Replaces every recovery code with a fresh set. */
    totpRecoveryCodes: (password: string, code: string) => post<{ recoveryCodes: string[] }>("/auth/totp/recovery-codes", { password, code }),
  };

  const meta = {
    get: (signal?: AbortSignal) => http.request<NetworkMeta>("GET", "/meta", { signal, noRefresh: true }),
  };

  const users = {
    updateMe: (body: {
      displayName?: string;
      headline?: string | null;
      bio?: string | null;
      location?: string | null;
      website?: string | null;
      avatarUploadId?: string | null;
      coverUploadId?: string | null;
      dmPrivacy?: DmPrivacy;
      emailDigest?: boolean;
    }) => patch<Me>("/users/me", body),
    /** Permanently deletes the account (204). 409 OWNER_MUST_TRANSFER while it owns communities. */
    deleteMe: (body: { password: string; totp?: string }) => http.request<void>("DELETE", "/users/me", { body }),
    /** Everything the account holds, as a JSON file (rate limited: 429 after 3 a day). */
    exportData: async (): Promise<Blob> => (await http.request<Response>("GET", "/users/me/export", { raw: true })).blob(),
    bookmarks: (q?: PageQuery) => get<Page<Post>>("/users/me/bookmarks", pq(q)),
    blocks: () => get<UserSummary[]>("/users/me/blocks"),
    sessions: () => get<SessionInfo[]>("/users/me/sessions"),
    revokeSession: (id: string) => del(`/users/me/sessions/${enc(id)}`),
    suggestions: () => get<UserSummary[]>("/users/suggestions"),
    profile: (username: string) => get<Profile>(`/users/${enc(username)}`),
    posts: (username: string, q?: PageQuery) => get<Page<Post>>(`/users/${enc(username)}/posts`, pq(q)),
    media: (username: string, q?: PageQuery) => get<Page<Media>>(`/users/${enc(username)}/media`, pq(q)),
    communities: (username: string) => get<Community[]>(`/users/${enc(username)}/communities`),
    followers: (username: string, q?: PageQuery) => get<Page<FollowEntry>>(`/users/${enc(username)}/followers`, pq(q)),
    following: (username: string, q?: PageQuery) => get<Page<FollowEntry>>(`/users/${enc(username)}/following`, pq(q)),
    follow: (id: string) => post(`/users/${enc(id)}/follow`),
    unfollow: (id: string) => del(`/users/${enc(id)}/follow`),
    block: (id: string) => post(`/users/${enc(id)}/block`),
    unblock: (id: string) => del(`/users/${enc(id)}/block`),
  };

  const communities = {
    list: (q?: PageQuery & { q?: string; filter?: "all" | "joined" | "managed" }) => get<Page<Community>>("/communities", pq(q)),
    suggested: () => get<Community[]>("/communities/suggested"),
    create: (body: CommunityInput) => post<Community>("/communities", body),
    invite: (code: string) => get<{ community: Community; invite: Invite }>(`/communities/invites/${enc(code)}`),
    get: (slug: string) => get<Community>(`/communities/${enc(slug)}`),
    update: (id: string, body: Partial<CommunityInput> & { premoderatePosts?: boolean }) => patch<Community>(`/communities/${enc(id)}`, body),
    remove: (id: string) => del(`/communities/${enc(id)}`),
    join: (id: string, inviteCode?: string) => post<{ status: "ACTIVE" | "PENDING" }>(`/communities/${enc(id)}/join`, inviteCode ? { inviteCode } : {}),
    cancelRequest: (id: string) => del(`/communities/${enc(id)}/join`),
    leave: (id: string) => post(`/communities/${enc(id)}/leave`),
    transfer: (id: string, userId: string) => post(`/communities/${enc(id)}/transfer`, { userId }),
    members: (id: string, q?: PageQuery & { status?: MembershipStatus; role?: CommunityRole; q?: string }) =>
      get<Page<Member>>(`/communities/${enc(id)}/members`, pq(q)),
    approve: (id: string, userId: string) => post<Member>(`/communities/${enc(id)}/members/${enc(userId)}/approve`),
    reject: (id: string, userId: string) => post(`/communities/${enc(id)}/members/${enc(userId)}/reject`),
    setRole: (id: string, userId: string, role: CommunityRole) => patch<Member>(`/communities/${enc(id)}/members/${enc(userId)}`, { role }),
    suspend: (id: string, userId: string, days: number, reason?: string) =>
      post<Member>(`/communities/${enc(id)}/members/${enc(userId)}/suspend`, { days, reason }),
    unsuspend: (id: string, userId: string) => post<Member>(`/communities/${enc(id)}/members/${enc(userId)}/unsuspend`),
    ban: (id: string, userId: string, reason?: string) => post<Member>(`/communities/${enc(id)}/members/${enc(userId)}/ban`, { reason }),
    unban: (id: string, userId: string) => post<Member>(`/communities/${enc(id)}/members/${enc(userId)}/unban`),
    removeMember: (id: string, userId: string) => del(`/communities/${enc(id)}/members/${enc(userId)}`),
    invites: (id: string) => get<Invite[]>(`/communities/${enc(id)}/invites`),
    createInvite: (id: string, body: { maxUses?: number | null; expiresInDays?: number | null }) => post<Invite>(`/communities/${enc(id)}/invites`, body),
    revokeInvite: (id: string, inviteId: string) => del(`/communities/${enc(id)}/invites/${enc(inviteId)}`),
    posts: (id: string, q?: PageQuery & { sort?: "new" | "top" | "hot"; tag?: string }) => get<Page<Post>>(`/communities/${enc(id)}/posts`, pq(q)),
    pinned: (id: string) => get<Post[]>(`/communities/${enc(id)}/posts/pinned`),
    media: (id: string, q?: PageQuery) => get<Page<Media>>(`/communities/${enc(id)}/media`, pq(q)),
    notificationSettings: (id: string) => get<CommunityNotificationSettings>(`/communities/${enc(id)}/notification-settings`),
    updateNotificationSettings: (id: string, body: Partial<CommunityNotificationSettings>) =>
      patch<CommunityNotificationSettings>(`/communities/${enc(id)}/notification-settings`, body),
  };

  const posts = {
    feed: (q?: PageQuery & { sort?: "latest" | "top" }) => get<Page<Post>>("/posts/feed", pq(q)),
    create: (body: NewPostInput) => post<Post>("/posts", body),
    get: (id: string) => get<Post>(`/posts/${enc(id)}`),
    update: (id: string, body: { body?: string; tags?: string[]; feeling?: string | null }) => patch<Post>(`/posts/${enc(id)}`, body),
    remove: (id: string) => del(`/posts/${enc(id)}`),
    react: (id: string, type: ReactionType) => put<ReactionSummary>(`/posts/${enc(id)}/reaction`, { type }),
    unreact: (id: string) => del<ReactionSummary>(`/posts/${enc(id)}/reaction`),
    reactions: (id: string, q?: PageQuery & { type?: ReactionType }) =>
      get<Page<{ user: UserSummary; type: ReactionType }>>(`/posts/${enc(id)}/reactions`, pq(q)),
    bookmark: (id: string) => post(`/posts/${enc(id)}/bookmark`),
    unbookmark: (id: string) => del(`/posts/${enc(id)}/bookmark`),
    hide: (id: string) => post(`/posts/${enc(id)}/hide`),
    pin: (id: string) => post<Post>(`/posts/${enc(id)}/pin`),
    unpin: (id: string) => del<Post>(`/posts/${enc(id)}/pin`),
    lock: (id: string) => post<Post>(`/posts/${enc(id)}/lock`),
    unlock: (id: string) => del<Post>(`/posts/${enc(id)}/lock`),
    comments: (id: string, q?: PageQuery) => get<Page<Comment>>(`/posts/${enc(id)}/comments`, pq(q)),
    addComment: (id: string, body: { body: string; parentId?: string; mediaId?: string }) => post<Comment>(`/posts/${enc(id)}/comments`, body),
  };

  const comments = {
    replies: (id: string, q?: PageQuery) => get<Page<Comment>>(`/comments/${enc(id)}/replies`, pq(q)),
    update: (id: string, body: string) => patch<Comment>(`/comments/${enc(id)}`, { body }),
    remove: (id: string) => del(`/comments/${enc(id)}`),
    react: (id: string, type: ReactionType) => put<ReactionSummary>(`/comments/${enc(id)}/reaction`, { type }),
    unreact: (id: string) => del<ReactionSummary>(`/comments/${enc(id)}/reaction`),
  };

  const polls = {
    get: (id: string) => get<Poll>(`/polls/${enc(id)}`),
    vote: (id: string, optionIds: string[]) => post<Poll>(`/polls/${enc(id)}/vote`, { optionIds }),
    unvote: (id: string) => del<Poll>(`/polls/${enc(id)}/vote`),
    close: (id: string) => post<Poll>(`/polls/${enc(id)}/close`),
    voters: (id: string, q?: PageQuery & { optionId?: string }) => get<Page<UserSummary>>(`/polls/${enc(id)}/voters`, pq(q)),
  };

  const questions = {
    list: (q: PageQuery & { communityId: string; status?: QuestionStatus; sort?: "new" | "top" | "unanswered"; tag?: string }) =>
      get<Page<Question>>("/questions", pq(q)),
    create: (body: { communityId: string; title: string; body: string; tags?: string[] }) => post<Question>("/questions", body),
    get: (id: string) => get<Question>(`/questions/${enc(id)}`),
    update: (id: string, body: { title?: string; body?: string; tags?: string[] }) => patch<Question>(`/questions/${enc(id)}`, body),
    remove: (id: string) => del(`/questions/${enc(id)}`),
    vote: (id: string, value: -1 | 0 | 1) => post<{ score: number; vote: -1 | 0 | 1 }>(`/questions/${enc(id)}/vote`, { value }),
    setStatus: (id: string, status: "OPEN" | "CLOSED") => post<Question>(`/questions/${enc(id)}/status`, { status }),
    accept: (id: string, answerId: string | null) => post<Question>(`/questions/${enc(id)}/accept`, { answerId }),
    answers: (id: string, q?: PageQuery & { sort?: "top" | "new" }) => get<Page<Answer>>(`/questions/${enc(id)}/answers`, pq(q)),
    answer: (id: string, body: string) => post<Answer>(`/questions/${enc(id)}/answers`, { body }),
    updateAnswer: (answerId: string, body: string) => patch<Answer>(`/questions/answers/${enc(answerId)}`, { body }),
    removeAnswer: (answerId: string) => del(`/questions/answers/${enc(answerId)}`),
    voteAnswer: (answerId: string, value: -1 | 0 | 1) => post<{ score: number; vote: -1 | 0 | 1 }>(`/questions/answers/${enc(answerId)}/vote`, { value }),
  };

  const events = {
    list: (q?: PageQuery & { scope?: "upcoming" | "past" | "going" | "organising"; communityId?: string }) => get<Page<CommunityEvent>>("/events", pq(q)),
    create: (body: EventInput) => post<CommunityEvent>("/events", body),
    get: (id: string) => get<CommunityEvent>(`/events/${enc(id)}`),
    update: (id: string, body: Partial<EventInput>) => patch<CommunityEvent>(`/events/${enc(id)}`, body),
    cancel: (id: string) => del(`/events/${enc(id)}`),
    rsvp: (id: string, status: "GOING" | "INTERESTED") => put<CommunityEvent>(`/events/${enc(id)}/rsvp`, { status }),
    cancelRsvp: (id: string) => del<CommunityEvent>(`/events/${enc(id)}/rsvp`),
    attendees: (id: string, q?: PageQuery & { status?: RsvpStatus }) => get<Page<{ user: UserSummary; status: RsvpStatus }>>(`/events/${enc(id)}/attendees`, pq(q)),
    /** The URL of the .ics file; works as a plain link only for events the public can read. */
    icsUrl: (id: string) => http.url(`/events/${enc(id)}/ics`),
    /** The .ics file fetched with the bearer token (private-community events need it). */
    ics: (id: string) => http.request<Response>("GET", `/events/${enc(id)}/ics`, { raw: true, headers: { Accept: "text/calendar" } }).then((res) => res.blob()),
  };

  const chat = {
    unread: () => get<Record<string, number>>("/chat/unread"),
    messages: (communityId: string, q?: PageQuery) => get<Page<Message>>(`/chat/${enc(communityId)}/messages`, pq(q)),
    send: (communityId: string, body: { body: string; replyToId?: string; mediaIds?: string[] }) => post<Message>(`/chat/${enc(communityId)}/messages`, body),
    pinned: (communityId: string) => get<Message[]>(`/chat/${enc(communityId)}/pinned`),
    read: (communityId: string) => post(`/chat/${enc(communityId)}/read`),
    mute: (communityId: string, until: string | null) => patch(`/chat/${enc(communityId)}/mute`, { until }),
    edit: (id: string, body: string) => patch<Message>(`/chat/messages/${enc(id)}`, { body }),
    remove: (id: string) => del(`/chat/messages/${enc(id)}`),
    pin: (id: string) => post<Message>(`/chat/messages/${enc(id)}/pin`),
    unpin: (id: string) => del<Message>(`/chat/messages/${enc(id)}/pin`),
    react: (id: string, emoji: string) => put<Message>(`/chat/messages/${enc(id)}/reactions/${enc(emoji)}`),
    unreact: (id: string, emoji: string) => del<Message>(`/chat/messages/${enc(id)}/reactions/${enc(emoji)}`),
  };

  const dms = {
    threads: (q?: PageQuery & { folder?: "inbox" | "requests" }) => get<Page<Thread>>("/dms/threads", pq(q)),
    open: (userId: string) => post<Thread>("/dms/threads", { userId }),
    createGroup: (userIds: string[], title?: string) => post<Thread>("/dms/threads/group", { userIds, title }),
    thread: (id: string) => get<Thread>(`/dms/threads/${enc(id)}`),
    updateThread: (id: string, body: { title?: string | null; mutedUntil?: string | null }) => patch<Thread>(`/dms/threads/${enc(id)}`, body),
    messages: (id: string, q?: PageQuery) => get<Page<Message>>(`/dms/threads/${enc(id)}/messages`, pq(q)),
    send: (id: string, body: { body: string; replyToId?: string; mediaIds?: string[] }) => post<Message>(`/dms/threads/${enc(id)}/messages`, body),
    pinned: (id: string) => get<Message[]>(`/dms/threads/${enc(id)}/pinned`),
    read: (id: string) => post(`/dms/threads/${enc(id)}/read`),
    accept: (id: string) => post<Thread>(`/dms/threads/${enc(id)}/accept`),
    decline: (id: string) => post(`/dms/threads/${enc(id)}/decline`),
    leave: (id: string) => post(`/dms/threads/${enc(id)}/leave`),
    addParticipants: (id: string, userIds: string[]) => post<Thread>(`/dms/threads/${enc(id)}/participants`, { userIds }),
    media: (id: string, q?: PageQuery) => get<Page<Media>>(`/dms/threads/${enc(id)}/media`, pq(q)),
    search: (id: string, q: string) => get<Message[]>(`/dms/threads/${enc(id)}/search`, { q }),
    edit: (id: string, body: string) => patch<Message>(`/dms/messages/${enc(id)}`, { body }),
    remove: (id: string) => del(`/dms/messages/${enc(id)}`),
    pin: (id: string) => post<Message>(`/dms/messages/${enc(id)}/pin`),
    unpin: (id: string) => del<Message>(`/dms/messages/${enc(id)}/pin`),
    react: (id: string, emoji: string) => put<Message>(`/dms/messages/${enc(id)}/reactions/${enc(emoji)}`),
    unreact: (id: string, emoji: string) => del<Message>(`/dms/messages/${enc(id)}/reactions/${enc(emoji)}`),
    unread: () => get<{ inbox: number; requests: number }>("/dms/unread"),
    eligibility: (userId: string) => get<DmEligibility>(`/dms/eligibility/${enc(userId)}`),
    contacts: () => get<Contact[]>("/dms/contacts"),
  };

  const media = {
    upload: (opts: UploadOptions) => uploadMedia(http, opts),
    get: (id: string) => get<Media>(`/media/${enc(id)}`),
    discard: (uploadId: string) => del(`/media/uploads/${enc(uploadId)}`),
  };

  const notifications = {
    list: (q?: PageQuery & { unread?: boolean }) => get<Page<Notification>>("/notifications", pq(q)),
    unreadCount: () => get<{ unread: number }>("/notifications/unread-count"),
    read: (id: string) => post(`/notifications/${enc(id)}/read`),
    readAll: () => post("/notifications/read-all"),
  };

  const discover = {
    search: (q: string, type: "all" | "people" | "communities" | "posts" | "questions" = "all", signal?: AbortSignal) =>
      get<SearchResults>("/discover/search", { q, type }, signal),
    typeahead: (q: string, signal?: AbortSignal) => get<{ people: UserSummary[]; communities: Community[] }>("/discover/typeahead", { q }, signal),
    trendingTags: () => get<TrendingTag[]>("/discover/trending-tags"),
    tagPosts: (tag: string, q?: PageQuery) => get<Page<Post>>(`/discover/tags/${enc(tag)}/posts`, pq(q)),
    leaderboard: (period: "week" | "month" | "all" = "week") => get<LeaderboardEntry[]>("/discover/leaderboard", { period }),
  };

  const reports = {
    create: (body: { targetType: ModerationTarget; targetId: string; reason: ReportReason; details?: string }) => post<{ id: string }>("/reports", body),
  };

  const moderation = {
    cases: (q?: PageQuery & { status?: "OPEN" | "RESOLVED"; source?: CaseSource; communityId?: string; targetType?: ModerationTarget }) =>
      get<Page<ModerationCase>>("/moderation/cases", pq(q)),
    case: (id: string) => get<ModerationCase>(`/moderation/cases/${enc(id)}`),
    act: (id: string, body: { action: ModerationActionType; reason?: string; suspendDays?: number }) =>
      post<ModerationCase>(`/moderation/cases/${enc(id)}/actions`, body),
    assign: (id: string, userId: string | null) => post<ModerationCase>(`/moderation/cases/${enc(id)}/assign`, { userId }),
    history: (targetType: ModerationTarget, targetId: string) => get<ModerationActionRecord[]>("/moderation/history", { targetType, targetId }),
    mine: (q?: PageQuery) => get<Page<ModerationCase>>("/moderation/me", pq(q)),
    appeal: (caseId: string, statement: string) => post<Appeal>(`/moderation/cases/${enc(caseId)}/appeal`, { statement }),
    appeals: (q?: PageQuery & { status?: string }) => get<Page<Appeal>>("/moderation/appeals", pq(q)),
    decideAppeal: (id: string, status: "UPHELD" | "OVERTURNED", note?: string) => post<Appeal>(`/moderation/appeals/${enc(id)}/decide`, { status, note }),
    stats: () => get<ModerationStats>("/moderation/stats"),
  };

  const admin = {
    settings: () => get<PlatformSettings>("/admin/settings"),
    updateSettings: (body: Partial<PlatformSettings>) => patch<PlatformSettings>("/admin/settings", body),
    stats: (days = 30) => get<AdminStats>("/admin/stats", { days }),
    users: (q?: PageQuery & { q?: string; status?: UserStatus; role?: UserRole }) => get<Page<AdminUserRow>>("/admin/users", pq(q)),
    setRole: (id: string, role: UserRole) => patch<AdminUserRow>(`/admin/users/${enc(id)}`, { role }),
    suspend: (id: string, days: number, reason: string) => post<AdminUserRow>(`/admin/users/${enc(id)}/suspend`, { days, reason }),
    unsuspend: (id: string) => post<AdminUserRow>(`/admin/users/${enc(id)}/unsuspend`),
    ban: (id: string, reason: string) => post<AdminUserRow>(`/admin/users/${enc(id)}/ban`, { reason }),
    unban: (id: string) => post<AdminUserRow>(`/admin/users/${enc(id)}/unban`),
    communities: (q?: PageQuery & { q?: string; status?: string }) => get<Page<Community>>("/admin/communities", pq(q)),
    updateCommunity: (id: string, body: { isDefault?: boolean; status?: "PUBLISHED" | "REMOVED" }) => patch<Community>(`/admin/communities/${enc(id)}`, body),
    audit: (q?: PageQuery & { action?: string; actorId?: string }) => get<Page<AuditEntry>>("/admin/audit", pq(q)),
  };

  return { auth, meta, users, communities, posts, comments, polls, questions, events, chat, dms, media, notifications, discover, reports, moderation, admin };
}

export type Endpoints = ReturnType<typeof createEndpoints>;
