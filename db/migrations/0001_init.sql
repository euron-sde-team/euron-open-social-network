-- Euron Open Social: initial schema.
--
-- Conventions
--   * Primary keys are ULIDs stored as text (sortable by creation time).
--   * Timestamps are timestamptz(3), the API runs with TZ=UTC. Millisecond precision is
--     exactly what a JS Date holds, so a keyset cursor built from a Date round-trips
--     without skipping or repeating rows (microsecond columns would break that).
--   * Denormalised counters (member_count, reaction_count, ...) are maintained in the same
--     transaction as the row they count, and a reconciliation job corrects any drift.
--   * Lists page with keyset cursors on (created_at, id), never OFFSET.

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─── Enums ──────────────────────────────────────────────────────────────────

CREATE TYPE user_role AS ENUM ('USER', 'MODERATOR', 'ADMIN');
CREATE TYPE user_status AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'BANNED', 'DEACTIVATED');
CREATE TYPE dm_privacy AS ENUM ('COMMUNITIES', 'FOLLOWING', 'NOBODY');
CREATE TYPE auth_token_type AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD');

CREATE TYPE community_visibility AS ENUM ('PUBLIC', 'PRIVATE');
CREATE TYPE community_join_policy AS ENUM ('OPEN', 'APPROVAL', 'INVITE_ONLY');
CREATE TYPE community_role AS ENUM ('OWNER', 'ADMIN', 'MODERATOR', 'MEMBER');
CREATE TYPE membership_status AS ENUM ('ACTIVE', 'PENDING', 'SUSPENDED', 'BANNED', 'LEFT');

CREATE TYPE upload_purpose AS ENUM ('POST', 'COMMENT', 'CHAT', 'DM', 'AVATAR', 'COVER', 'COMMUNITY_ICON', 'COMMUNITY_COVER', 'EVENT_COVER');
CREATE TYPE upload_kind AS ENUM ('IMAGE', 'VIDEO', 'AUDIO', 'PDF', 'DOCUMENT', 'OTHER');
CREATE TYPE upload_status AS ENUM ('PENDING', 'COMPLETE', 'READY', 'REJECTED', 'DELETED');

-- Lifecycle of any user-generated item. HIDDEN = taken down pending review or by a
-- moderator (restorable); REMOVED = moderator removal (final unless an appeal wins);
-- DELETED = the author deleted it.
CREATE TYPE content_status AS ENUM ('PUBLISHED', 'PENDING_REVIEW', 'HIDDEN', 'REMOVED', 'DELETED');
CREATE TYPE moderation_state AS ENUM ('UNCHECKED', 'CLEAN', 'REVIEW', 'FLAGGED');

CREATE TYPE post_kind AS ENUM ('POST', 'ANNOUNCEMENT');
CREATE TYPE reaction_type AS ENUM ('LIKE', 'LOVE', 'CARE', 'HAHA', 'WOW', 'SAD', 'ANGRY');
CREATE TYPE question_status AS ENUM ('OPEN', 'RESOLVED', 'CLOSED');
CREATE TYPE event_status AS ENUM ('SCHEDULED', 'CANCELLED');
CREATE TYPE rsvp_status AS ENUM ('GOING', 'WAITLISTED', 'INTERESTED', 'CANCELLED');

CREATE TYPE dm_thread_kind AS ENUM ('DIRECT', 'GROUP');
CREATE TYPE dm_participant_state AS ENUM ('ACTIVE', 'REQUESTED', 'DECLINED', 'LEFT');

CREATE TYPE notification_type AS ENUM (
  'POST_COMMENT', 'COMMENT_REPLY', 'POST_REACTION', 'COMMENT_REACTION', 'MENTION', 'FOLLOW',
  'JOIN_REQUEST', 'MEMBERSHIP_APPROVED', 'COMMUNITY_INVITE', 'DM_REQUEST',
  'EVENT_UPDATED', 'EVENT_CANCELLED', 'EVENT_PROMOTED', 'EVENT_REMINDER',
  'ANSWER_POSTED', 'ANSWER_ACCEPTED', 'MODERATION_ACTION', 'APPEAL_DECIDED'
);

CREATE TYPE moderation_target AS ENUM ('POST', 'COMMENT', 'CHAT_MESSAGE', 'DM_MESSAGE', 'QUESTION', 'ANSWER', 'EVENT', 'USER', 'COMMUNITY');
CREATE TYPE report_reason AS ENUM ('SPAM', 'HARASSMENT', 'HATE', 'VIOLENCE', 'SEXUAL', 'SELF_HARM', 'MISINFORMATION', 'IMPERSONATION', 'OTHER');
CREATE TYPE case_source AS ENUM ('AI', 'REPORT', 'PREMODERATION');
CREATE TYPE case_status AS ENUM ('OPEN', 'RESOLVED');
CREATE TYPE moderation_action_type AS ENUM ('APPROVE', 'HIDE', 'REMOVE', 'RESTORE', 'WARN', 'SUSPEND', 'BAN', 'UNBAN', 'DISMISS');
CREATE TYPE appeal_status AS ENUM ('PENDING', 'UPHELD', 'OVERTURNED');

-- ─── Identity ───────────────────────────────────────────────────────────────

CREATE TABLE media_uploads (
  id               text PRIMARY KEY,
  owner_id         text NOT NULL,            -- FK added after users exists
  purpose          upload_purpose NOT NULL,
  kind             upload_kind NOT NULL,
  mime_type        text NOT NULL,
  file_name        text NOT NULL,
  declared_size    bigint NOT NULL,
  size_bytes       bigint,
  storage_key      text NOT NULL UNIQUE,
  thumb_key        text,
  width            integer,
  height           integer,
  duration_seconds integer,
  status           upload_status NOT NULL DEFAULT 'PENDING',
  moderation_state moderation_state NOT NULL DEFAULT 'UNCHECKED',
  rejected_reason  text,
  created_at       timestamptz(3) NOT NULL DEFAULT now(),
  completed_at     timestamptz(3)
);
CREATE INDEX media_uploads_owner_idx ON media_uploads (owner_id, created_at DESC);
CREATE INDEX media_uploads_pending_idx ON media_uploads (created_at) WHERE status = 'PENDING';

CREATE TABLE users (
  id                text PRIMARY KEY,
  email             citext NOT NULL UNIQUE,
  username          citext NOT NULL UNIQUE CHECK (username ~ '^[a-zA-Z0-9_]{3,30}$'),
  display_name      text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  password_hash     text NOT NULL,
  role              user_role NOT NULL DEFAULT 'USER',
  status            user_status NOT NULL DEFAULT 'PENDING_VERIFICATION',
  email_verified_at timestamptz(3),
  totp_secret       text,                    -- AES-256-GCM ciphertext (security/totp.ts), never the raw secret
  totp_enabled      boolean NOT NULL DEFAULT false,
  totp_last_step    bigint,                  -- last accepted TOTP time step: a code works once
  suspended_until   timestamptz(3),
  token_version     integer NOT NULL DEFAULT 0,
  headline          text CHECK (length(headline) <= 120),
  bio               text CHECK (length(bio) <= 1000),
  location          text CHECK (length(location) <= 100),
  website           text CHECK (length(website) <= 200),
  avatar_upload_id  text REFERENCES media_uploads (id) ON DELETE SET NULL,
  cover_upload_id   text REFERENCES media_uploads (id) ON DELETE SET NULL,
  dm_privacy        dm_privacy NOT NULL DEFAULT 'COMMUNITIES',
  email_digest      boolean NOT NULL DEFAULT true,   -- "while you were away" emails; the user can opt out
  -- The invite an INVITE_ONLY sign-up used; the account joins its community once verified.
  signup_invite_id  text,                    -- FK added after community_invites exists
  reputation        integer NOT NULL DEFAULT 0,
  level             integer NOT NULL DEFAULT 1,
  post_count        integer NOT NULL DEFAULT 0,
  follower_count    integer NOT NULL DEFAULT 0,
  following_count   integer NOT NULL DEFAULT 0,
  last_seen_at      timestamptz(3),
  created_at        timestamptz(3) NOT NULL DEFAULT now(),
  updated_at        timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX users_name_trgm_idx ON users USING gin ((display_name || ' ' || username::text) gin_trgm_ops);
CREATE INDEX users_reputation_idx ON users (reputation DESC) WHERE status = 'ACTIVE';

ALTER TABLE media_uploads ADD CONSTRAINT media_uploads_owner_fk FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE;

CREATE TABLE sessions (
  id           text PRIMARY KEY,
  user_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  family_id    text NOT NULL,                  -- every rotation of one login shares a family
  token_hash   text NOT NULL UNIQUE,           -- sha256 of the refresh token
  user_agent   text,
  ip           inet,
  created_at   timestamptz(3) NOT NULL DEFAULT now(),
  last_used_at timestamptz(3) NOT NULL DEFAULT now(),
  expires_at   timestamptz(3) NOT NULL,
  revoked_at   timestamptz(3),
  replaced_by  text
);
CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_family_idx ON sessions (family_id);

CREATE TABLE auth_tokens (
  id         text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type       auth_token_type NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz(3) NOT NULL,
  used_at    timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX auth_tokens_user_idx ON auth_tokens (user_id, type);

-- Single-use two-factor recovery codes, issued ten at a time when TOTP is turned on.
-- Only an HMAC of each code is stored (keyed from TOTP_ENCRYPTION_KEY).
CREATE TABLE totp_recovery_codes (
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_hash  text NOT NULL,
  used_at    timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, code_hash)
);

CREATE TABLE follows (
  follower_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  followee_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
CREATE INDEX follows_followee_idx ON follows (followee_id, created_at DESC);

-- A block is one-directional in storage and symmetric in effect: every visibility
-- query checks both directions (see repositories/visibility.ts).
CREATE TABLE blocks (
  blocker_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  blocked_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX blocks_blocked_idx ON blocks (blocked_id);

-- ─── Communities ────────────────────────────────────────────────────────────

CREATE TABLE communities (
  id                 text PRIMARY KEY,
  slug               citext NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$'),
  name               text NOT NULL CHECK (length(name) BETWEEN 3 AND 100),
  description        text CHECK (length(description) <= 2000),
  rules              jsonb NOT NULL DEFAULT '[]',    -- [{ title, body }]
  visibility         community_visibility NOT NULL DEFAULT 'PUBLIC',
  join_policy        community_join_policy NOT NULL DEFAULT 'OPEN',
  allow_member_posts boolean NOT NULL DEFAULT true,
  premoderate_posts  boolean NOT NULL DEFAULT false,
  is_default         boolean NOT NULL DEFAULT false,  -- every new account joins default communities
  color              text CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  icon_upload_id     text REFERENCES media_uploads (id) ON DELETE SET NULL,
  cover_upload_id    text REFERENCES media_uploads (id) ON DELETE SET NULL,
  member_count       integer NOT NULL DEFAULT 0,
  post_count         integer NOT NULL DEFAULT 0,
  created_by         text REFERENCES users (id) ON DELETE SET NULL,
  status             content_status NOT NULL DEFAULT 'PUBLISHED',
  created_at         timestamptz(3) NOT NULL DEFAULT now(),
  updated_at         timestamptz(3) NOT NULL DEFAULT now(),
  search             tsvector GENERATED ALWAYS AS (to_tsvector('simple', name || ' ' || coalesce(description, ''))) STORED
);
CREATE INDEX communities_search_idx ON communities USING gin (search);
CREATE INDEX communities_name_trgm_idx ON communities USING gin (name gin_trgm_ops);
CREATE INDEX communities_members_idx ON communities (member_count DESC) WHERE status = 'PUBLISHED';

CREATE TABLE community_members (
  id                    text PRIMARY KEY,
  community_id          text NOT NULL REFERENCES communities (id) ON DELETE CASCADE,
  user_id               text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role                  community_role NOT NULL DEFAULT 'MEMBER',
  status                membership_status NOT NULL DEFAULT 'ACTIVE',
  notification_settings jsonb NOT NULL DEFAULT '{}',
  suspended_until       timestamptz(3),
  requested_at          timestamptz(3),
  joined_at             timestamptz(3),
  created_at            timestamptz(3) NOT NULL DEFAULT now(),
  updated_at            timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (community_id, user_id)
);
CREATE INDEX community_members_user_idx ON community_members (user_id) WHERE status = 'ACTIVE';
CREATE INDEX community_members_pending_idx ON community_members (community_id, requested_at) WHERE status = 'PENDING';

CREATE TABLE community_invites (
  id           text PRIMARY KEY,
  community_id text NOT NULL REFERENCES communities (id) ON DELETE CASCADE,
  code         text NOT NULL UNIQUE,
  created_by   text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  max_uses     integer CHECK (max_uses > 0),
  uses         integer NOT NULL DEFAULT 0,
  expires_at   timestamptz(3),
  revoked_at   timestamptz(3),
  created_at   timestamptz(3) NOT NULL DEFAULT now()
);

ALTER TABLE users ADD CONSTRAINT users_signup_invite_fk FOREIGN KEY (signup_invite_id) REFERENCES community_invites (id) ON DELETE SET NULL;

-- ─── Posts, comments, reactions ─────────────────────────────────────────────

CREATE TABLE posts (
  id               text PRIMARY KEY,
  community_id     text NOT NULL REFERENCES communities (id) ON DELETE CASCADE,
  author_id        text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind             post_kind NOT NULL DEFAULT 'POST',
  body             text NOT NULL DEFAULT '' CHECK (length(body) <= 20000),
  feeling          text CHECK (length(feeling) <= 40),
  shared_post_id   text REFERENCES posts (id) ON DELETE SET NULL,
  status           content_status NOT NULL DEFAULT 'PUBLISHED',
  moderation_state moderation_state NOT NULL DEFAULT 'UNCHECKED',
  is_pinned        boolean NOT NULL DEFAULT false,
  pinned_at        timestamptz(3),
  is_locked        boolean NOT NULL DEFAULT false,
  reaction_count   integer NOT NULL DEFAULT 0,
  reaction_counts  jsonb NOT NULL DEFAULT '{}',   -- { "LIKE": 3, "LOVE": 1 }
  comment_count    integer NOT NULL DEFAULT 0,
  share_count      integer NOT NULL DEFAULT 0,
  edited_at        timestamptz(3),
  created_at       timestamptz(3) NOT NULL DEFAULT now(),
  updated_at       timestamptz(3) NOT NULL DEFAULT now(),
  search           tsvector GENERATED ALWAYS AS (to_tsvector('simple', body)) STORED
);
CREATE INDEX posts_community_feed_idx ON posts (community_id, created_at DESC, id DESC) WHERE status = 'PUBLISHED';
CREATE INDEX posts_author_idx ON posts (author_id, created_at DESC, id DESC);
CREATE INDEX posts_feed_idx ON posts (created_at DESC, id DESC) WHERE status = 'PUBLISHED';
CREATE INDEX posts_pinned_idx ON posts (community_id, pinned_at DESC) WHERE is_pinned;
CREATE INDEX posts_search_idx ON posts USING gin (search);

CREATE TABLE post_media (
  post_id   text NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  upload_id text NOT NULL REFERENCES media_uploads (id) ON DELETE CASCADE,
  position  smallint NOT NULL,
  PRIMARY KEY (post_id, upload_id)
);
CREATE INDEX post_media_upload_idx ON post_media (upload_id);

CREATE TABLE post_tags (
  post_id    text NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  tag        citext NOT NULL CHECK (tag ~ '^[a-zA-Z0-9_]{1,40}$'),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, tag)
);
CREATE INDEX post_tags_tag_idx ON post_tags (tag, created_at DESC);

CREATE TABLE post_mentions (
  post_id text NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE post_reactions (
  post_id    text NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type       reaction_type NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX post_reactions_user_idx ON post_reactions (user_id, created_at DESC);

CREATE TABLE post_bookmarks (
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  post_id    text NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX post_bookmarks_feed_idx ON post_bookmarks (user_id, created_at DESC);

-- "Hide post" from your own feed (not moderation).
CREATE TABLE post_hides (
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  post_id    text NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);

CREATE TABLE comments (
  id               text PRIMARY KEY,
  post_id          text NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  author_id        text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  parent_id        text REFERENCES comments (id) ON DELETE CASCADE,
  body             text NOT NULL CHECK (length(body) <= 10000),
  upload_id        text REFERENCES media_uploads (id) ON DELETE SET NULL,
  status           content_status NOT NULL DEFAULT 'PUBLISHED',
  moderation_state moderation_state NOT NULL DEFAULT 'UNCHECKED',
  reply_count      integer NOT NULL DEFAULT 0,
  reaction_count   integer NOT NULL DEFAULT 0,
  reaction_counts  jsonb NOT NULL DEFAULT '{}',
  edited_at        timestamptz(3),
  created_at       timestamptz(3) NOT NULL DEFAULT now(),
  updated_at       timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX comments_post_idx ON comments (post_id, created_at, id) WHERE parent_id IS NULL;
CREATE INDEX comments_parent_idx ON comments (parent_id, created_at, id) WHERE parent_id IS NOT NULL;
CREATE INDEX comments_author_idx ON comments (author_id, created_at DESC);

CREATE TABLE comment_mentions (
  comment_id text NOT NULL REFERENCES comments (id) ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  PRIMARY KEY (comment_id, user_id)
);

CREATE TABLE comment_reactions (
  comment_id text NOT NULL REFERENCES comments (id) ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type       reaction_type NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id)
);

-- ─── Polls ──────────────────────────────────────────────────────────────────

CREATE TABLE polls (
  id             text PRIMARY KEY,
  post_id        text NOT NULL UNIQUE REFERENCES posts (id) ON DELETE CASCADE,
  question       text NOT NULL CHECK (length(question) BETWEEN 1 AND 300),
  allow_multiple boolean NOT NULL DEFAULT false,
  is_anonymous   boolean NOT NULL DEFAULT false,
  closes_at      timestamptz(3),
  closed_at      timestamptz(3),
  total_votes    integer NOT NULL DEFAULT 0,
  voter_count    integer NOT NULL DEFAULT 0,
  created_at     timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE poll_options (
  id         text PRIMARY KEY,
  poll_id    text NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
  label      text NOT NULL CHECK (length(label) BETWEEN 1 AND 120),
  position   smallint NOT NULL,
  vote_count integer NOT NULL DEFAULT 0,
  UNIQUE (poll_id, position)
);

CREATE TABLE poll_votes (
  poll_id    text NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
  option_id  text NOT NULL REFERENCES poll_options (id) ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (option_id, user_id)
);
CREATE INDEX poll_votes_user_idx ON poll_votes (poll_id, user_id);

-- ─── Q&A ────────────────────────────────────────────────────────────────────

CREATE TABLE questions (
  id                 text PRIMARY KEY,
  community_id       text NOT NULL REFERENCES communities (id) ON DELETE CASCADE,
  author_id          text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title              text NOT NULL CHECK (length(title) BETWEEN 10 AND 300),
  body               text NOT NULL DEFAULT '' CHECK (length(body) <= 20000),
  status             question_status NOT NULL DEFAULT 'OPEN',
  content_status     content_status NOT NULL DEFAULT 'PUBLISHED',
  moderation_state   moderation_state NOT NULL DEFAULT 'UNCHECKED',
  score              integer NOT NULL DEFAULT 0,
  answer_count       integer NOT NULL DEFAULT 0,
  view_count         integer NOT NULL DEFAULT 0,
  accepted_answer_id text,
  created_at         timestamptz(3) NOT NULL DEFAULT now(),
  updated_at         timestamptz(3) NOT NULL DEFAULT now(),
  search             tsvector GENERATED ALWAYS AS (to_tsvector('simple', title || ' ' || body)) STORED
);
CREATE INDEX questions_community_idx ON questions (community_id, created_at DESC, id DESC) WHERE content_status = 'PUBLISHED';
CREATE INDEX questions_search_idx ON questions USING gin (search);

CREATE TABLE answers (
  id               text PRIMARY KEY,
  question_id      text NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  author_id        text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body             text NOT NULL CHECK (length(body) BETWEEN 1 AND 20000),
  status           content_status NOT NULL DEFAULT 'PUBLISHED',
  moderation_state moderation_state NOT NULL DEFAULT 'UNCHECKED',
  score            integer NOT NULL DEFAULT 0,
  created_at       timestamptz(3) NOT NULL DEFAULT now(),
  updated_at       timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX answers_question_idx ON answers (question_id, score DESC, created_at);
ALTER TABLE questions ADD CONSTRAINT questions_accepted_fk FOREIGN KEY (accepted_answer_id) REFERENCES answers (id) ON DELETE SET NULL;

CREATE TABLE question_tags (
  question_id text NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  tag         citext NOT NULL CHECK (tag ~ '^[a-zA-Z0-9_]{1,40}$'),
  PRIMARY KEY (question_id, tag)
);

CREATE TABLE question_votes (
  question_id text NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  user_id     text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  value       smallint NOT NULL CHECK (value IN (-1, 1)),
  PRIMARY KEY (question_id, user_id)
);

CREATE TABLE answer_votes (
  answer_id text NOT NULL REFERENCES answers (id) ON DELETE CASCADE,
  user_id   text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  value     smallint NOT NULL CHECK (value IN (-1, 1)),
  PRIMARY KEY (answer_id, user_id)
);

-- ─── Events ─────────────────────────────────────────────────────────────────

CREATE TABLE events (
  id               text PRIMARY KEY,
  community_id     text REFERENCES communities (id) ON DELETE CASCADE,  -- NULL = network-wide
  organizer_id     text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title            text NOT NULL CHECK (length(title) BETWEEN 3 AND 200),
  description      text NOT NULL DEFAULT '' CHECK (length(description) <= 10000),
  cover_upload_id  text REFERENCES media_uploads (id) ON DELETE SET NULL,
  location         text CHECK (length(location) <= 300),
  is_virtual       boolean NOT NULL DEFAULT false,
  virtual_link     text CHECK (length(virtual_link) <= 500),
  starts_at        timestamptz(3) NOT NULL,
  ends_at          timestamptz(3) NOT NULL,
  timezone         text NOT NULL DEFAULT 'UTC',
  capacity         integer CHECK (capacity > 0),
  going_count      integer NOT NULL DEFAULT 0,
  waitlist_count   integer NOT NULL DEFAULT 0,
  interested_count integer NOT NULL DEFAULT 0,
  status           event_status NOT NULL DEFAULT 'SCHEDULED',
  content_status   content_status NOT NULL DEFAULT 'PUBLISHED',
  moderation_state moderation_state NOT NULL DEFAULT 'UNCHECKED',
  reminded_at      timestamptz(3),
  created_at       timestamptz(3) NOT NULL DEFAULT now(),
  updated_at       timestamptz(3) NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX events_upcoming_idx ON events (starts_at) WHERE status = 'SCHEDULED' AND content_status = 'PUBLISHED';
CREATE INDEX events_community_idx ON events (community_id, starts_at);

CREATE TABLE event_rsvps (
  event_id   text NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status     rsvp_status NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);
-- The waitlist is served first-come, first-served by updated_at.
CREATE INDEX event_rsvps_waitlist_idx ON event_rsvps (event_id, updated_at) WHERE status = 'WAITLISTED';
CREATE INDEX event_rsvps_user_idx ON event_rsvps (user_id, status);

-- ─── Community chat ─────────────────────────────────────────────────────────

CREATE TABLE chat_messages (
  id               text PRIMARY KEY,
  community_id     text NOT NULL REFERENCES communities (id) ON DELETE CASCADE,
  sender_id        text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body             text NOT NULL DEFAULT '' CHECK (length(body) <= 8000),
  reply_to_id      text REFERENCES chat_messages (id) ON DELETE SET NULL,
  status           content_status NOT NULL DEFAULT 'PUBLISHED',
  moderation_state moderation_state NOT NULL DEFAULT 'UNCHECKED',
  pinned_at        timestamptz(3),
  pinned_by        text REFERENCES users (id) ON DELETE SET NULL,
  edited_at        timestamptz(3),
  created_at       timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX chat_messages_room_idx ON chat_messages (community_id, created_at DESC, id DESC);
CREATE INDEX chat_messages_search_idx ON chat_messages USING gin (to_tsvector('simple', body));

CREATE TABLE chat_message_media (
  message_id text NOT NULL REFERENCES chat_messages (id) ON DELETE CASCADE,
  upload_id  text NOT NULL REFERENCES media_uploads (id) ON DELETE CASCADE,
  position   smallint NOT NULL,
  PRIMARY KEY (message_id, upload_id)
);

CREATE TABLE chat_reactions (
  message_id text NOT NULL REFERENCES chat_messages (id) ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  emoji      text NOT NULL CHECK (length(emoji) BETWEEN 1 AND 16),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE chat_reads (
  community_id text NOT NULL REFERENCES communities (id) ON DELETE CASCADE,
  user_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  last_read_at timestamptz(3) NOT NULL DEFAULT now(),
  muted_until  timestamptz(3),
  PRIMARY KEY (community_id, user_id)
);

-- ─── Direct messages ────────────────────────────────────────────────────────

CREATE TABLE dm_threads (
  id              text PRIMARY KEY,
  kind            dm_thread_kind NOT NULL,
  title           text CHECK (length(title) <= 100),
  -- For DIRECT threads: "<lowerId>:<higherId>". The UNIQUE constraint makes
  -- find-or-create race-free without advisory locks.
  direct_key      text UNIQUE,
  created_by      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  last_message_at timestamptz(3),
  created_at      timestamptz(3) NOT NULL DEFAULT now(),
  CHECK ((kind = 'DIRECT') = (direct_key IS NOT NULL))
);

CREATE TABLE dm_participants (
  thread_id    text NOT NULL REFERENCES dm_threads (id) ON DELETE CASCADE,
  user_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- REQUESTED: a message request the recipient has not accepted yet. The sender
  -- can write; the recipient sees it under "Message requests" and gets no push.
  state        dm_participant_state NOT NULL DEFAULT 'ACTIVE',
  is_admin     boolean NOT NULL DEFAULT false,
  last_read_at timestamptz(3),
  muted_until  timestamptz(3),
  joined_at    timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, user_id)
);
CREATE INDEX dm_participants_user_idx ON dm_participants (user_id, state);

CREATE TABLE dm_messages (
  id               text PRIMARY KEY,
  thread_id        text NOT NULL REFERENCES dm_threads (id) ON DELETE CASCADE,
  sender_id        text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body             text NOT NULL DEFAULT '' CHECK (length(body) <= 8000),
  reply_to_id      text REFERENCES dm_messages (id) ON DELETE SET NULL,
  status           content_status NOT NULL DEFAULT 'PUBLISHED',
  moderation_state moderation_state NOT NULL DEFAULT 'UNCHECKED',
  pinned_at        timestamptz(3),
  edited_at        timestamptz(3),
  created_at       timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX dm_messages_thread_idx ON dm_messages (thread_id, created_at DESC, id DESC);

CREATE TABLE dm_message_media (
  message_id text NOT NULL REFERENCES dm_messages (id) ON DELETE CASCADE,
  upload_id  text NOT NULL REFERENCES media_uploads (id) ON DELETE CASCADE,
  position   smallint NOT NULL,
  PRIMARY KEY (message_id, upload_id)
);

CREATE TABLE dm_reactions (
  message_id text NOT NULL REFERENCES dm_messages (id) ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  emoji      text NOT NULL CHECK (length(emoji) BETWEEN 1 AND 16),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);

-- ─── Notifications and points ───────────────────────────────────────────────

CREATE TABLE notifications (
  id           text PRIMARY KEY,
  recipient_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  actor_id     text REFERENCES users (id) ON DELETE CASCADE,
  type         notification_type NOT NULL,
  entity_type  text NOT NULL,
  entity_id    text NOT NULL,
  community_id text REFERENCES communities (id) ON DELETE CASCADE,
  snippet      text CHECK (length(snippet) <= 200),
  data         jsonb NOT NULL DEFAULT '{}',
  read_at      timestamptz(3),
  emailed_at   timestamptz(3),
  created_at   timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX notifications_inbox_idx ON notifications (recipient_id, created_at DESC, id DESC);
CREATE INDEX notifications_unread_idx ON notifications (recipient_id) WHERE read_at IS NULL;

-- Idempotent reputation ledger: the unique key makes "award once" a plain insert.
CREATE TABLE points_ledger (
  id          text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  amount      integer NOT NULL,
  reason      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text NOT NULL,
  actor_id    text,
  created_at  timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (user_id, reason, entity_type, entity_id, actor_id)
);
CREATE INDEX points_ledger_recent_idx ON points_ledger (created_at DESC, user_id);

-- ─── Moderation ─────────────────────────────────────────────────────────────

CREATE TABLE moderation_cases (
  id             text PRIMARY KEY,
  target_type    moderation_target NOT NULL,
  target_id      text NOT NULL,
  community_id   text REFERENCES communities (id) ON DELETE SET NULL,
  author_id      text REFERENCES users (id) ON DELETE SET NULL,
  source         case_source NOT NULL,
  status         case_status NOT NULL DEFAULT 'OPEN',
  priority       smallint NOT NULL DEFAULT 0,
  ai_provider    text,
  ai_scores      jsonb,
  ai_categories  text[],
  report_count   integer NOT NULL DEFAULT 0,
  snapshot       jsonb NOT NULL DEFAULT '{}',   -- the content as it was when the case opened
  assigned_to    text REFERENCES users (id) ON DELETE SET NULL,
  resolution     moderation_action_type,
  resolved_by    text REFERENCES users (id) ON DELETE SET NULL,
  opened_at      timestamptz(3) NOT NULL DEFAULT now(),
  resolved_at    timestamptz(3)
);
-- One open case per target: new reports and re-scans attach to it.
CREATE UNIQUE INDEX moderation_cases_open_target_idx ON moderation_cases (target_type, target_id) WHERE status = 'OPEN';
CREATE INDEX moderation_cases_queue_idx ON moderation_cases (priority DESC, opened_at) WHERE status = 'OPEN';
CREATE INDEX moderation_cases_community_idx ON moderation_cases (community_id, status);

CREATE TABLE reports (
  id          text PRIMARY KEY,
  reporter_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  target_type moderation_target NOT NULL,
  target_id   text NOT NULL,
  reason      report_reason NOT NULL,
  details     text CHECK (length(details) <= 1000),
  case_id     text REFERENCES moderation_cases (id) ON DELETE SET NULL,
  created_at  timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (reporter_id, target_type, target_id)
);
CREATE INDEX reports_case_idx ON reports (case_id);

CREATE TABLE moderation_actions (
  id          text PRIMARY KEY,
  case_id     text REFERENCES moderation_cases (id) ON DELETE SET NULL,
  actor_id    text REFERENCES users (id) ON DELETE SET NULL,   -- NULL = the automated pipeline
  action      moderation_action_type NOT NULL,
  target_type moderation_target NOT NULL,
  target_id   text NOT NULL,
  reason      text CHECK (length(reason) <= 1000),
  data        jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX moderation_actions_target_idx ON moderation_actions (target_type, target_id, created_at DESC);
CREATE INDEX moderation_actions_case_idx ON moderation_actions (case_id);

CREATE TABLE appeals (
  id            text PRIMARY KEY,
  case_id       text NOT NULL REFERENCES moderation_cases (id) ON DELETE CASCADE,
  appellant_id  text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  statement     text NOT NULL CHECK (length(statement) BETWEEN 10 AND 2000),
  status        appeal_status NOT NULL DEFAULT 'PENDING',
  decided_by    text REFERENCES users (id) ON DELETE SET NULL,
  decision_note text CHECK (length(decision_note) <= 1000),
  decided_at    timestamptz(3),
  created_at    timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (case_id, appellant_id)
);
CREATE INDEX appeals_pending_idx ON appeals (created_at) WHERE status = 'PENDING';

-- ─── Platform ───────────────────────────────────────────────────────────────

CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_by text REFERENCES users (id) ON DELETE SET NULL,
  updated_at timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id          text PRIMARY KEY,
  actor_id    text REFERENCES users (id) ON DELETE SET NULL,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text,
  ip          inet,
  data        jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_recent_idx ON audit_log (created_at DESC, id DESC);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id);
