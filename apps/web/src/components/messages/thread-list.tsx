"use client";

import { useState } from "react";
import Link from "next/link";
import { BellOff, Inbox, Search, SquarePen } from "lucide-react";
import { CountBadge, EmptyState, IconButton, Segmented, Skeleton, cn } from "@open-social/ui";
import type { Thread } from "@open-social/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useContacts, useDmUnread, usePagedList } from "@/lib/hooks/queries";
import { useNow } from "@/lib/hooks/use-now";
import { qk } from "@/lib/query-keys";
import { relativeTime } from "@/lib/time";
import { ErrorState, LoadMore } from "@/components/common/states";
import { ThreadAvatar } from "./thread-avatar";
import { counterpart, isMuted, lastMessagePreview, onlineOf, threadTitle } from "./thread-utils";

export type Folder = "inbox" | "requests";

/** Conversations list with Inbox / Requests tabs and a local name filter. */
export function ThreadList({ activeId, onNewMessage, hrefFor = (t) => `/messages/${t.id}`, onSelect }: { activeId?: string | null; onNewMessage: () => void; hrefFor?: (t: Thread) => string; onSelect?: (t: Thread) => void }) {
  const { user } = useAuth();
  const [folder, setFolder] = useState<Folder>("inbox");
  const [filter, setFilter] = useState("");
  const unread = useDmUnread().data;
  const contacts = useContacts().data;
  const now = useNow();
  const list = usePagedList<Thread>({ queryKey: qk.threads(folder), fetchPage: (cursor) => api().dms.threads({ folder, cursor }) });
  const f = filter.trim().toLowerCase();
  const threads = f ? list.items.filter((t) => threadTitle(t, user?.id).toLowerCase().includes(f)) : list.items;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 px-4 pb-3 pt-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Messages</h1>
          <IconButton label="New message" variant="muted" onClick={onNewMessage} data-testid="new-message-button">
            <SquarePen />
          </IconButton>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" aria-hidden />
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search conversations"
            aria-label="Search conversations"
            className="h-9 w-full rounded-full bg-muted pl-9 pr-3 text-sm placeholder:text-subtle-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          />
        </div>
        <Segmented
          aria-label="Folders"
          value={folder}
          onChange={setFolder}
          options={[
            { value: "inbox", label: "Inbox", count: unread?.inbox },
            { value: "requests", label: "Requests", count: unread?.requests },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 scrollbar-thin" data-testid="thread-list">
        {list.isPending ? (
          Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 px-2 py-2.5">
              <Skeleton className="size-12 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-4/5" />
              </div>
            </div>
          ))
        ) : list.isError ? (
          <ErrorState compact error={list.error} onRetry={() => void list.refetch()} />
        ) : threads.length === 0 ? (
          <EmptyState
            compact
            icon={<Inbox />}
            title={f ? "No conversations match" : folder === "inbox" ? "No conversations yet" : "No message requests"}
            description={f ? undefined : folder === "inbox" ? "Start one with someone from your communities." : "Messages from people you do not know yet show up here."}
          />
        ) : (
          <ul>
            {threads.map((t) => {
              const other = counterpart(t, user?.id);
              const online = onlineOf(contacts, other?.id)?.online;
              const isUnread = t.unreadCount > 0;
              const active = t.id === activeId;
              return (
                <li key={t.id}>
                  <Link
                    href={hrefFor(t)}
                    onClick={onSelect ? (e) => { e.preventDefault(); onSelect(t); } : undefined}
                    aria-current={active ? "page" : undefined}
                    data-testid="thread-item"
                    data-thread-id={t.id}
                    className={cn("flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors", active ? "bg-primary/10" : "hover:bg-muted")}
                  >
                    <ThreadAvatar thread={t} viewerId={user?.id} online={online} size="lg" />
                    <span className="min-w-0 flex-1">
                      <span className={cn("flex items-center gap-1.5 truncate text-[15px]", isUnread ? "font-bold" : "font-medium")}>
                        <span className="truncate">{threadTitle(t, user?.id)}</span>
                        {isMuted(t, now) ? <BellOff className="size-3.5 shrink-0 text-subtle-foreground" aria-label="Muted" /> : null}
                      </span>
                      <span className={cn("flex items-center gap-1 text-[13px]", isUnread ? "font-semibold text-foreground" : "text-subtle-foreground")}>
                        <span className="truncate">{lastMessagePreview(t, user?.id)}</span>
                        {t.lastMessageAt ? (
                          <span className="shrink-0 font-normal text-subtle-foreground" suppressHydrationWarning>
                            {" "}
                            . {relativeTime(t.lastMessageAt, now)}
                          </span>
                        ) : null}
                      </span>
                    </span>
                    {isUnread ? <CountBadge count={t.unreadCount} className="ring-0" /> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} />
      </div>
    </div>
  );
}
