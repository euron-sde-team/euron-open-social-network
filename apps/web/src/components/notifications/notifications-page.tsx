"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BellOff, CheckCheck } from "lucide-react";
import { Button, Card, EmptyState, Segmented, Skeleton } from "@open-social/ui";
import type { Notification } from "@open-social/types";
import { api } from "@/lib/api";
import { useNotificationCount, usePagedList } from "@/lib/hooks/queries";
import { qk } from "@/lib/query-keys";
import { markNotificationsRead, type NotificationPages } from "@/lib/realtime/reducers";
import { ErrorState, LoadMore } from "@/components/common/states";
import { NotificationItem } from "./notification-item";

export function NotificationsPage() {
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const unread = filter === "unread";
  const qc = useQueryClient();
  const count = useNotificationCount().data?.unread ?? 0;
  const list = usePagedList<Notification>({
    queryKey: qk.notifications(unread),
    fetchPage: (cursor) => api().notifications.list({ cursor, unread: unread || undefined }),
  });
  const readAll = useMutation({
    mutationFn: () => api().notifications.readAll(),
    onMutate: () => {
      const at = new Date().toISOString();
      qc.setQueryData<NotificationPages>(qk.notifications(false), (d) => markNotificationsRead(d, "all", at));
      qc.setQueryData<NotificationPages>(qk.notifications(true), (d) => (d ? { ...d, pages: d.pages.map((p) => ({ ...p, items: [] })) } : d));
      qc.setQueryData(qk.notificationCount, { unread: 0 });
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.notificationsAll }),
  });

  return (
    <Card data-testid="notifications-page">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
        <Button variant="ghost" size="sm" onClick={() => readAll.mutate()} disabled={!count} data-testid="mark-all-read">
          <CheckCheck /> Mark all as read
        </Button>
      </div>
      <div className="px-4 pt-3">
        <Segmented
          aria-label="Filter notifications"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "unread", label: "Unread", count },
          ]}
        />
      </div>
      <div className="p-2" data-testid="notification-list">
        {list.isPending ? (
          <div className="space-y-3 p-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="size-12 rounded-full" />
                <div className="flex-1 space-y-2 pt-1">
                  <Skeleton className="h-3 w-4/5" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
              </div>
            ))}
          </div>
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : !list.items.length ? (
          <EmptyState icon={<BellOff />} title={unread ? "No unread notifications" : "No notifications yet"} description={unread ? "You are all caught up." : "Reactions, comments, mentions and invites will show up here."} />
        ) : (
          list.items.map((n) => <NotificationItem key={n.id} n={n} />)
        )}
        <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} />
      </div>
    </Card>
  );
}
