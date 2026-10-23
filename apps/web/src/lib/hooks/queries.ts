"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { flattenPages, nextCursor } from "@open-social/api-client";
import type { Page } from "@open-social/types";
import { api } from "../api";
import { useAuth } from "../auth";
import { qk } from "../query-keys";
import { useInfiniteScroll } from "./use-infinite-scroll";

/** Communities the viewer belongs to (first 50, enough for rails and pickers). */
export function useMyCommunities() {
  const { status } = useAuth();
  return useQuery({
    queryKey: qk.myCommunities,
    queryFn: async () => (await api().communities.list({ filter: "joined", limit: 50 })).items,
    enabled: status === "signed-in",
    staleTime: 60_000,
  });
}

export function useNotificationCount() {
  const { status } = useAuth();
  return useQuery({
    queryKey: qk.notificationCount,
    queryFn: () => api().notifications.unreadCount(),
    enabled: status === "signed-in",
    staleTime: 60_000,
    refetchInterval: 120_000,
    meta: { silent: true },
  });
}

export function useDmUnread() {
  const { status } = useAuth();
  return useQuery({
    queryKey: qk.dmUnread,
    queryFn: () => api().dms.unread(),
    enabled: status === "signed-in",
    staleTime: 30_000,
    refetchInterval: 120_000,
    meta: { silent: true },
  });
}

export function useChatUnread() {
  const { status } = useAuth();
  return useQuery({
    queryKey: qk.chatUnread,
    queryFn: () => api().chat.unread(),
    enabled: status === "signed-in",
    staleTime: 60_000,
    meta: { silent: true },
  });
}

export function useContacts() {
  const { status } = useAuth();
  return useQuery({
    queryKey: qk.contacts,
    queryFn: () => api().dms.contacts(),
    enabled: status === "signed-in",
    staleTime: 60_000,
    meta: { silent: true },
  });
}

/**
 * The standard infinite list over a Page<T> endpoint, with the sentinel ref
 * for IntersectionObserver-driven loading.
 */
export function usePagedList<T extends { id: string }>(opts: {
  queryKey: readonly unknown[];
  fetchPage: (cursor: string | undefined) => Promise<Page<T>>;
  enabled?: boolean;
  staleTime?: number;
}) {
  const query = useInfiniteQuery({
    queryKey: opts.queryKey,
    queryFn: ({ pageParam }) => opts.fetchPage(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
    enabled: opts.enabled ?? true,
    staleTime: opts.staleTime,
  });
  const items = flattenPages(query.data?.pages);
  const sentinelRef = useInfiniteScroll<HTMLDivElement>(
    () => {
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    },
    { enabled: !!query.hasNextPage },
  );
  return { ...query, items, sentinelRef };
}
