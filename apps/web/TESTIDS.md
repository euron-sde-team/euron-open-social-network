# Test ids

Stable `data-testid` hooks for end-to-end tests. Prefer accessible names (roles and labels) where they exist; these ids cover elements without a unique accessible name. `<id>` marks a dynamic suffix (for example `case-action-<action>` is `case-action-hide`). Generated from the source; keep it in sync when adding ids.

Key ids: `composer`, `composer-dialog`, `composer-submit`, `post-card` (with `data-post-id`), `reaction-button`, `reaction-picker`, `reaction-<type>`, `comment-input`, `comment-submit`, `report-dialog`, `report-submit`, `join-button` (with `data-state-join`), `dm-dock`, `message-input`, `message-send`, `thread-list`, `thread-item`, `request-accept`, `request-decline`, `rsvp-going`, `moderation-queue`, `moderation-case`, `case-drawer`, `case-action-hide`, `login-submit`, `signup-submit`, `totp-input`, `admin-settings-save`.

## Shell and navigation

| Test id | Source |
|---|---|
| `avatar-menu` | `components/shell/avatar-menu.tsx` |
| `confirm-action` | `components/common/confirm-dialog.tsx` |
| `contacts-list` | `components/shell/right-rail.tsx` |
| `nav-<id>` | `components/shell/header.tsx` |
| `nav-admin` | `components/shell/avatar-menu.tsx` |
| `nav-moderation` | `components/shell/avatar-menu.tsx` |
| `notifications-bell` | `components/shell/notifications-bell.tsx` |
| `notifications-dropdown` | `components/shell/notifications-bell.tsx` |
| `report-dialog` | `components/common/report-dialog.tsx` |
| `report-reason-<id>` | `components/common/report-dialog.tsx` |
| `report-submit` | `components/common/report-dialog.tsx` |
| `restriction-banner` | `components/shell/restriction-banner.tsx` |
| `search-input` | `components/shell/search-box.tsx` |
| `sign-out` | `components/shell/avatar-menu.tsx` |
| `theme-dark` | `components/shell/avatar-menu.tsx` |
| `theme-light` | `components/shell/avatar-menu.tsx` |
| `theme-system` | `components/shell/avatar-menu.tsx` |

## Feed, posts and comments

| Test id | Source |
|---|---|
| `comment` | `components/posts/comments.tsx` |
| `comment-button` | `components/posts/post-card.tsx` |
| `comment-input` | `components/posts/comments.tsx` |
| `comment-reaction-button` | `components/posts/comments.tsx` |
| `comment-submit` | `components/posts/comments.tsx` |
| `comments` | `components/posts/comments.tsx` |
| `comments-more` | `components/posts/comments.tsx` |
| `composer` | `components/posts/composer.tsx` |
| `composer-announcement` | `components/posts/composer.tsx` |
| `composer-card` | `components/posts/composer.tsx` |
| `composer-community` | `components/posts/composer.tsx` |
| `composer-dialog` | `components/posts/composer.tsx` |
| `composer-file-input` | `components/posts/composer.tsx` |
| `composer-input` | `components/posts/composer.tsx` |
| `composer-poll` | `components/posts/composer.tsx` |
| `composer-submit` | `components/posts/composer.tsx` |
| `file-chip` | `components/media/media-mosaic.tsx` |
| `lightbox` | `components/media/lightbox.tsx` |
| `media-mosaic` | `components/media/media-mosaic.tsx` |
| `new-posts-pill` | `components/feed/home-feed.tsx` |
| `poll` | `components/posts/poll-widget.tsx` |
| `poll-builder` | `components/posts/composer.tsx` |
| `poll-change` | `components/posts/poll-widget.tsx` |
| `poll-option` | `components/posts/poll-widget.tsx` |
| `poll-option-input-<id>` | `components/posts/composer.tsx` |
| `poll-question` | `components/posts/composer.tsx` |
| `poll-result` | `components/posts/poll-widget.tsx` |
| `poll-vote` | `components/posts/poll-widget.tsx` |
| `post-bookmark` | `components/posts/post-menu.tsx` |
| `post-card` | `components/posts/post-card.tsx` |
| `post-counts` | `components/posts/post-card.tsx` |
| `post-delete` | `components/posts/post-menu.tsx` |
| `post-edit` | `components/posts/post-menu.tsx` |
| `post-feed` | `components/posts/post-feed.tsx` |
| `post-hide` | `components/posts/post-menu.tsx` |
| `post-lock` | `components/posts/post-menu.tsx` |
| `post-menu` | `components/posts/post-menu.tsx` |
| `post-pin` | `components/posts/post-menu.tsx` |
| `post-report` | `components/posts/post-menu.tsx` |
| `post-skeleton` | `components/posts/post-card.tsx` |
| `post-status-banner` | `components/posts/post-card.tsx` |
| `reaction-<id>` | `components/posts/reactions.tsx` |
| `reaction-picker` | `components/posts/reactions.tsx` |
| `share-button` | `components/posts/post-card.tsx` |
| `share-dialog` | `components/posts/share-dialog.tsx` |
| `share-submit` | `components/posts/share-dialog.tsx` |
| `shared-post` | `components/posts/post-card.tsx` |
| `upload-previews` | `components/media/upload-previews.tsx` |
| `view-replies` | `components/posts/comments.tsx` |

## Communities

| Test id | Source |
|---|---|
| `<id>-confirm` | `components/communities/members-tab.tsx` |
| `<id>-dialog` | `components/communities/members-tab.tsx` |
| `add-rule` | `components/communities/community-form.tsx` |
| `communities-grid` | `components/communities/discover.tsx` |
| `communities-search` | `components/communities/discover.tsx` |
| `community-about` | `components/communities/about-tab.tsx` |
| `community-card` | `components/communities/community-card.tsx` |
| `community-cover-upload` | `components/communities/community-form.tsx` |
| `community-create-event` | `components/communities/community-page.tsx` |
| `community-creation-restricted` | `components/communities/create-community.tsx` |
| `community-delete` | `components/communities/settings.tsx` |
| `community-delete-name` | `components/communities/settings.tsx` |
| `community-form` | `components/communities/community-form.tsx` |
| `community-form-error` | `components/communities/community-form.tsx` |
| `community-header` | `components/communities/community-page.tsx` |
| `community-icon-upload` | `components/communities/community-form.tsx` |
| `community-name` | `components/communities/community-form.tsx`, `components/communities/community-page.tsx` |
| `community-rules` | `components/communities/about-tab.tsx` |
| `community-settings` | `components/communities/settings.tsx` |
| `community-settings-link` | `components/communities/community-page.tsx` |
| `community-slug` | `components/communities/community-form.tsx` |
| `community-submit` | `components/communities/community-form.tsx` |
| `community-tab-<id>` | `components/communities/community-page.tsx` |
| `create-community` | `components/communities/discover.tsx` |
| `invite-create` | `components/communities/settings.tsx` |
| `invite-landing` | `components/communities/invite-landing.tsx` |
| `invite-signed-out` | `components/communities/invite-gate.tsx` |
| `invite-signup` | `components/communities/invite-gate.tsx` |
| `invite-link` | `components/communities/invite-link.tsx` |
| `invite-revoke` | `components/communities/settings.tsx` |
| `invites-card` | `components/communities/settings.tsx` |
| `invites-list` | `components/communities/settings.tsx` |
| `join-button` | `components/communities/join-button.tsx` |
| `join-policy-<id>` | `components/communities/community-form.tsx` |
| `leave-community` | `components/communities/join-button.tsx` |
| `media-grid` | `components/communities/media-tab.tsx` |
| `member-approve` | `components/communities/members-tab.tsx` |
| `member-ban` | `components/communities/members-tab.tsx` |
| `member-menu` | `components/communities/members-tab.tsx` |
| `member-reject` | `components/communities/members-tab.tsx` |
| `member-remove` | `components/communities/members-tab.tsx` |
| `member-role-<id>` | `components/communities/members-tab.tsx` |
| `member-suspend` | `components/communities/members-tab.tsx` |
| `member-unsuspend` | `components/communities/members-tab.tsx` |
| `members-list` | `components/communities/members-tab.tsx` |
| `members-search` | `components/communities/members-tab.tsx` |
| `pinned-posts` | `components/communities/discussion-tab.tsx` |
| `premoderate-toggle` | `components/communities/community-form.tsx` |
| `private-gate` | `components/communities/community-page.tsx` |
| `rule-row` | `components/communities/community-form.tsx` |
| `transfer-confirm` | `components/communities/settings.tsx` |
| `transfer-search` | `components/communities/settings.tsx` |
| `visibility-<id>` | `components/communities/community-form.tsx` |

## Q&A

| Test id | Source |
|---|---|
| `<id>-down` | `components/questions/vote-control.tsx` |
| `<id>-score` | `components/questions/vote-control.tsx` |
| `<id>-up` | `components/questions/vote-control.tsx` |
| `answer-accept` | `components/questions/question-detail.tsx` |
| `answer-card` | `components/questions/question-detail.tsx` |
| `answer-composer` | `components/questions/question-detail.tsx` |
| `answer-input` | `components/questions/question-detail.tsx` |
| `answer-list` | `components/questions/question-detail.tsx` |
| `answer-submit` | `components/questions/question-detail.tsx` |
| `answer-vote` | `components/questions/question-detail.tsx` |
| `ask-dialog` | `components/questions/qa-tab.tsx` |
| `ask-question` | `components/questions/qa-tab.tsx` |
| `markdown-lite` | `components/questions/markdown-lite.tsx` |
| `question-body` | `components/questions/qa-tab.tsx` |
| `question-card` | `components/questions/qa-tab.tsx` |
| `question-detail` | `components/questions/question-detail.tsx` |
| `question-list` | `components/questions/qa-tab.tsx` |
| `question-menu` | `components/questions/question-detail.tsx` |
| `question-status-filter` | `components/questions/qa-tab.tsx` |
| `question-submit` | `components/questions/qa-tab.tsx` |
| `question-title` | `components/questions/qa-tab.tsx` |
| `question-toggle-status` | `components/questions/question-detail.tsx` |
| `question-vote` | `components/questions/question-detail.tsx` |

## Chat and messages

| Test id | Source |
|---|---|
| `attach-button` | `components/chat/composer.tsx` |
| `cannot-reply` | `components/messages/conversation.tsx` |
| `chat-mute` | `components/chat/community-chat.tsx` |
| `chat-room` | `components/chat/community-chat.tsx` |
| `conversation` | `components/messages/conversation.tsx` |
| `dm-as-request` | `components/messages/new-message-dialog.tsx` |
| `dm-denial` | `components/messages/new-message-dialog.tsx` |
| `dm-dock` | `components/messages/dock.tsx` |
| `dm-seen` | `components/chat/message-bubble.tsx` |
| `dock-close` | `components/messages/dock.tsx` |
| `dock-head` | `components/messages/dock.tsx` |
| `dock-minimize` | `components/messages/dock.tsx` |
| `dock-window` | `components/messages/dock.tsx` |
| `group-create` | `components/messages/new-message-dialog.tsx` |
| `group-info` | `components/messages/conversation.tsx` |
| `group-info-dialog` | `components/messages/group-info-dialog.tsx` |
| `message-actions` | `components/chat/message-bubble.tsx` |
| `message-bubble` | `components/chat/message-bubble.tsx` |
| `message-delete` | `components/chat/message-bubble.tsx` |
| `message-edit` | `components/chat/message-bubble.tsx` |
| `message-input` | `components/chat/composer.tsx` |
| `message-pin` | `components/chat/message-bubble.tsx` |
| `message-react` | `components/chat/message-bubble.tsx` |
| `message-reply` | `components/chat/message-bubble.tsx` |
| `message-report` | `components/chat/message-bubble.tsx` |
| `message-send` | `components/chat/composer.tsx` |
| `mute-toggle` | `components/messages/conversation.tsx` |
| `new-message-button` | `components/messages/dock.tsx`, `components/messages/thread-list.tsx` |
| `new-message-dialog` | `components/messages/new-message-dialog.tsx` |
| `new-message-search` | `components/messages/people-picker.tsx` |
| `new-message-start` | `components/messages/new-message-dialog.tsx` |
| `person-option` | `components/messages/people-picker.tsx` |
| `pinned-bar` | `components/chat/pinned-bar.tsx` |
| `reply-banner` | `components/chat/composer.tsx` |
| `request-accept` | `components/messages/conversation.tsx` |
| `request-banner` | `components/messages/conversation.tsx` |
| `request-decline` | `components/messages/conversation.tsx` |
| `thread-item` | `components/messages/thread-list.tsx` |
| `thread-list` | `components/messages/thread-list.tsx` |
| `typing-indicator` | `components/chat/typing-indicator.tsx` |

## Profiles and people

| Test id | Source |
|---|---|
| `<id>-list` | `components/profile/people-list.tsx` |
| `block-confirm` | `components/profile/profile-header.tsx` |
| `block-user` | `components/profile/profile-header.tsx` |
| `blocked-notice` | `components/profile/profile-page.tsx` |
| `edit-profile` | `components/profile/profile-header.tsx` |
| `list-follow-button` | `components/profile/people-list.tsx` |
| `message-button` | `components/profile/profile-header.tsx` |
| `profile-about` | `components/profile/profile-page.tsx` |
| `profile-actions` | `components/profile/profile-header.tsx` |
| `profile-communities` | `components/profile/profile-page.tsx` |
| `profile-header` | `components/profile/profile-header.tsx` |
| `profile-media` | `components/profile/profile-page.tsx` |
| `profile-menu` | `components/profile/profile-header.tsx` |
| `profile-stats` | `components/profile/profile-header.tsx` |
| `profile-tab-<id>` | `components/profile/profile-page.tsx` |
| `report-user` | `components/profile/profile-header.tsx` |
| `unblock-button` | `components/profile/profile-header.tsx` |

## Events

| Test id | Source |
|---|---|
| `add-to-calendar` | `components/events/event-detail.tsx` |
| `attendees` | `components/events/event-detail.tsx` |
| `capacity` | `components/events/event-detail.tsx` |
| `create-event` | `components/events/events-page.tsx` |
| `event-cancel` | `components/events/event-detail.tsx` |
| `event-cancelled` | `components/events/event-detail.tsx` |
| `event-card` | `components/events/event-card.tsx` |
| `event-community` | `components/events/event-form.tsx` |
| `event-detail` | `components/events/event-detail.tsx` |
| `event-edit` | `components/events/event-detail.tsx` |
| `event-end` | `components/events/event-form.tsx` |
| `event-form` | `components/events/event-form.tsx` |
| `event-list` | `components/events/event-list.tsx` |
| `event-start` | `components/events/event-form.tsx` |
| `event-submit` | `components/events/event-form.tsx` |
| `event-title` | `components/events/event-form.tsx` |
| `event-virtual` | `components/events/event-form.tsx` |
| `events-tab-<id>` | `components/events/events-page.tsx` |
| `rsvp-badge` | `components/events/event-card.tsx` |
| `rsvp-bar` | `components/events/event-detail.tsx` |
| `rsvp-cancel` | `components/events/event-detail.tsx` |
| `rsvp-going` | `components/events/event-detail.tsx` |
| `rsvp-interested` | `components/events/event-detail.tsx` |
| `rsvp-status` | `components/events/event-detail.tsx` |
| `virtual-link` | `components/events/event-detail.tsx` |

## Notifications, search and discovery

| Test id | Source |
|---|---|
| `leaderboard` | `components/discover/leaderboard-page.tsx` |
| `leaderboard-row` | `components/discover/leaderboard-page.tsx` |
| `mark-all-read` | `components/notifications/notifications-page.tsx` |
| `notification-item` | `components/notifications/notification-item.tsx` |
| `notification-list` | `components/notifications/notifications-page.tsx` |
| `notifications-page` | `components/notifications/notifications-page.tsx` |
| `search-community` | `components/discover/search-page.tsx` |
| `search-page` | `components/discover/search-page.tsx` |
| `search-question` | `components/discover/search-page.tsx` |
| `search-tab-<id>` | `components/discover/search-page.tsx` |

## Auth

| Test id | Source |
|---|---|
| `forgot-sent` | `components/auth/forgot-password.tsx` |
| `forgot-submit` | `components/auth/forgot-password.tsx` |
| `goodbye` | `components/auth/goodbye.tsx` |
| `login-submit` | `components/auth/login-form.tsx` |
| `recovery-code-input` | `components/auth/login-form.tsx` |
| `recovery-toggle` | `components/auth/login-form.tsx` |
| `reset-done` | `components/auth/reset-password.tsx` |
| `reset-submit` | `components/auth/reset-password.tsx` |
| `signup-check-email` | `components/auth/signup-form.tsx` |
| `signup-invite-code` | `components/auth/signup-form.tsx` |
| `signup-submit` | `components/auth/signup-form.tsx` |
| `totp-input` | `components/auth/login-form.tsx` |

## Settings

| Test id | Source |
|---|---|
| `avatar-upload` | `components/settings/profile-section.tsx` |
| `blocked-list` | `components/settings/blocked-section.tsx` |
| `cover-upload` | `components/settings/profile-section.tsx` |
| `delete-account` | `components/settings/account-section.tsx` |
| `delete-account-confirm` | `components/settings/account-section.tsx` |
| `delete-account-dialog` | `components/settings/account-section.tsx` |
| `delete-confirm-username` | `components/settings/account-section.tsx` |
| `delete-totp` | `components/settings/account-section.tsx` |
| `dm-privacy-<id>` | `components/settings/privacy-section.tsx` |
| `email-digest-toggle` | `components/settings/email-section.tsx` |
| `export-data` | `components/settings/account-section.tsx` |
| `recovery-codes` | `components/settings/recovery-codes.tsx` |
| `recovery-copy` | `components/settings/recovery-codes.tsx` |
| `recovery-done` | `components/settings/recovery-codes.tsx` |
| `recovery-download` | `components/settings/recovery-codes.tsx` |
| `recovery-saved` | `components/settings/recovery-codes.tsx` |
| `session-revoke` | `components/settings/sessions-section.tsx` |
| `sessions-list` | `components/settings/sessions-section.tsx` |
| `sessions-sign-out-all` | `components/settings/sessions-section.tsx` |
| `settings-nav-<id>` | `components/settings/settings-page.tsx` |
| `settings-save` | `components/settings/password-section.tsx`, `components/settings/privacy-section.tsx`, `components/settings/profile-section.tsx` |
| `totp-confirm-code` | `components/settings/two-factor-section.tsx` |
| `totp-disable` | `components/settings/two-factor-section.tsx` |
| `totp-enable` | `components/settings/two-factor-section.tsx` |
| `totp-qr` | `components/settings/two-factor-section.tsx` |
| `totp-regenerate` | `components/settings/two-factor-section.tsx` |
| `totp-start` | `components/settings/two-factor-section.tsx` |
| `unblock` | `components/settings/blocked-section.tsx` |

## Moderation

| Test id | Source |
|---|---|
| `appeal-card` | `components/moderation/moderation-desk.tsx` |
| `appeal-overturn` | `components/moderation/moderation-desk.tsx` |
| `appeal-panel` | `components/moderation/my-cases.tsx` |
| `appeal-submit` | `components/moderation/my-cases.tsx` |
| `appeal-uphold` | `components/moderation/moderation-desk.tsx` |
| `appeals-list` | `components/moderation/moderation-desk.tsx` |
| `case-action-<id>` | `components/moderation/case-drawer.tsx` |
| `case-action-suspend` | `components/moderation/case-drawer.tsx` |
| `case-appeal` | `components/moderation/case-drawer.tsx` |
| `case-author` | `components/moderation/case-drawer.tsx` |
| `case-drawer` | `components/moderation/case-drawer.tsx` |
| `filter-community` | `components/moderation/moderation-desk.tsx` |
| `filter-source` | `components/moderation/moderation-desk.tsx` |
| `filter-status` | `components/moderation/moderation-desk.tsx` |
| `filter-type` | `components/moderation/moderation-desk.tsx` |
| `moderation-case` | `components/moderation/moderation-desk.tsx` |
| `moderation-open-count` | `components/moderation/moderation-desk.tsx` |
| `moderation-queue` | `components/moderation/moderation-desk.tsx` |
| `my-cases` | `components/moderation/my-cases.tsx` |
| `suspend-days` | `components/moderation/case-drawer.tsx` |
| `tab-appeals` | `components/moderation/moderation-desk.tsx` |

## Admin

| Test id | Source |
|---|---|
| `admin-<id>-dialog` | `components/admin/users.tsx` |
| `admin-account-confirm` | `components/admin/users.tsx` |
| `admin-ban` | `components/admin/users.tsx` |
| `admin-communities` | `components/admin/communities.tsx` |
| `admin-community-default` | `components/admin/communities.tsx` |
| `admin-community-remove` | `components/admin/communities.tsx` |
| `admin-moderation-enabled` | `components/admin/settings-form.tsx` |
| `admin-settings-save` | `components/admin/settings-form.tsx` |
| `admin-suspend` | `components/admin/users.tsx` |
| `admin-tab-<id>` | `components/admin/admin-page.tsx` |
| `admin-thresholds` | `components/admin/settings-form.tsx` |
| `admin-totals` | `components/admin/overview.tsx` |
| `admin-user-actions` | `components/admin/users.tsx` |
| `admin-user-row` | `components/admin/users.tsx` |
| `admin-users-search` | `components/admin/users.tsx` |
| `admin-users-table` | `components/admin/users.tsx` |
| `audit-log` | `components/admin/audit.tsx` |
| `blocked-term-input` | `components/admin/settings-form.tsx` |
| `blocked-terms` | `components/admin/settings-form.tsx` |
