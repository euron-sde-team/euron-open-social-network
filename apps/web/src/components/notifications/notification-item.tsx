"use client";

import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AtSign, Bell, CalendarClock, CheckCircle2, Heart, MessageCircle, MessageSquare, Shield, UserPlus, Users } from "lucide-react";
import { Avatar, cn } from "@open-social/ui";
import type { Notification, NotificationType } from "@open-social/types";
import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { markNotificationsRead, type NotificationPages } from "@/lib/realtime/reducers";
import { TimeAgo } from "@/components/common/time-ago";

export const NOTIFICATION_COPY: Record<NotificationType, string> = {
  POST_COMMENT: "commented on your post",
  COMMENT_REPLY: "replied to your comment",
  POST_REACTION: "reacted to your post",
  COMMENT_REACTION: "reacted to your comment",
  MENTION: "mentioned you",
  FOLLOW: "started following you",
  JOIN_REQUEST: "asked to join a community you manage",
  MEMBERSHIP_APPROVED: "approved your request to join",
  COMMUNITY_INVITE: "invited you to a community",
  DM_REQUEST: "sent you a message request",
  EVENT_UPDATED: "updated an event you are attending",
  EVENT_CANCELLED: "cancelled an event you were attending",
  EVENT_PROMOTED: "You moved off the waitlist for an event",
  EVENT_REMINDER: "An event you are attending starts soon",
  ANSWER_POSTED: "answered your question",
  ANSWER_ACCEPTED: "accepted your answer",
  MODERATION_ACTION: "A moderator reviewed your content",
  APPEAL_DECIDED: "Your appeal has been decided",
};

/** Types whose copy is a full sentence without an actor. */
const ACTORLESS = new Set<NotificationType>(["EVENT_PROMOTED", "EVENT_REMINDER", "MODERATION_ACTION", "APPEAL_DECIDED"]);

const ICONS: Record<NotificationType, { icon: typeof Bell; tone: string }> = {
  POST_COMMENT: { icon: MessageCircle, tone: "bg-success text-success-foreground" },
  COMMENT_REPLY: { icon: MessageCircle, tone: "bg-success text-success-foreground" },
  POST_REACTION: { icon: Heart, tone: "bg-reaction-love text-white" },
  COMMENT_REACTION: { icon: Heart, tone: "bg-reaction-love text-white" },
  MENTION: { icon: AtSign, tone: "bg-primary text-primary-foreground" },
  FOLLOW: { icon: UserPlus, tone: "bg-primary text-primary-foreground" },
  JOIN_REQUEST: { icon: Users, tone: "bg-primary text-primary-foreground" },
  MEMBERSHIP_APPROVED: { icon: Users, tone: "bg-success text-success-foreground" },
  COMMUNITY_INVITE: { icon: Users, tone: "bg-primary text-primary-foreground" },
  DM_REQUEST: { icon: MessageSquare, tone: "bg-primary text-primary-foreground" },
  EVENT_UPDATED: { icon: CalendarClock, tone: "bg-warning text-warning-foreground" },
  EVENT_CANCELLED: { icon: CalendarClock, tone: "bg-danger text-danger-foreground" },
  EVENT_PROMOTED: { icon: CalendarClock, tone: "bg-success text-success-foreground" },
  EVENT_REMINDER: { icon: CalendarClock, tone: "bg-warning text-warning-foreground" },
  ANSWER_POSTED: { icon: MessageSquare, tone: "bg-success text-success-foreground" },
  ANSWER_ACCEPTED: { icon: CheckCircle2, tone: "bg-success text-success-foreground" },
  MODERATION_ACTION: { icon: Shield, tone: "bg-warning text-warning-foreground" },
  APPEAL_DECIDED: { icon: Shield, tone: "bg-primary text-primary-foreground" },
};

export function notificationText(n: Notification): { actor: string | null; text: string } {
  const copy = NOTIFICATION_COPY[n.type] ?? "sent you a notification";
  if (ACTORLESS.has(n.type) || !n.actor) return { actor: null, text: copy.charAt(0).toUpperCase() + copy.slice(1) };
  return { actor: n.actor.displayName, text: copy };
}

/** Only internal paths: the API sends a path, never a full URL, and we enforce that. */
export function safeInternalHref(href: string): string {
  return href.startsWith("/") && !href.startsWith("//") ? href : "/notifications";
}

export function NotificationItem({ n, compact, onNavigate }: { n: Notification; compact?: boolean; onNavigate?: () => void }) {
  const qc = useQueryClient();
  const { actor, text } = notificationText(n);
  const { icon: Icon, tone } = ICONS[n.type] ?? { icon: Bell, tone: "bg-primary text-primary-foreground" };
  const markRead = useMutation({
    mutationFn: () => api().notifications.read(n.id),
    meta: { silent: true },
    onMutate: () => {
      const at = new Date().toISOString();
      for (const unread of [false, true]) qc.setQueryData<NotificationPages>(qk.notifications(unread), (d) => markNotificationsRead(d, n.id, at));
      qc.setQueryData<{ unread: number }>(qk.notificationCount, (c) => (c ? { unread: Math.max(0, c.unread - 1) } : c));
    },
  });
  const unread = !n.readAt;
  return (
    <Link
      href={safeInternalHref(n.href)}
      data-testid="notification-item"
      onClick={() => {
        if (unread) markRead.mutate();
        onNavigate?.();
      }}
      className={cn("flex items-start gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-muted", compact ? "" : "py-3")}
    >
      <span className="relative shrink-0">
        {n.actor ? (
          <Avatar name={n.actor.displayName} seed={n.actor.id} src={n.actor.avatarUrl} size={compact ? "md" : "lg"} />
        ) : (
          <span className={cn("flex items-center justify-center rounded-full bg-muted text-muted-foreground", compact ? "size-10" : "size-12")}>
            <Bell className="size-5" />
          </span>
        )}
        <span className={cn("absolute -bottom-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full ring-2 ring-popover", tone)}>
          <Icon className="size-3" />
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block text-sm leading-snug", unread ? "text-foreground" : "text-muted-foreground")}>
          {actor ? <span className="font-semibold text-foreground">{actor} </span> : null}
          {text}
          {n.snippet ? <span className="text-muted-foreground">: {n.snippet}</span> : null}
        </span>
        <TimeAgo value={n.createdAt} className={cn("mt-0.5 block text-xs", unread ? "font-semibold text-primary-soft-foreground" : "text-subtle-foreground")} />
      </span>
      {unread ? <span className="mt-3 size-2.5 shrink-0 rounded-full bg-primary" aria-label="Unread" /> : null}
    </Link>
  );
}
