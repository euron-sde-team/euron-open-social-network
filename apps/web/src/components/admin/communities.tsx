"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { ExternalLink, Search, Star, Trash2, UsersRound } from "lucide-react";
import { Badge, Button, Card, EmptyState, Input, Select, Skeleton, Switch, Tooltip, toast } from "@open-social/ui";
import type { Community, Page } from "@open-social/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { usePagedList } from "@/lib/hooks/queries";
import { qk } from "@/lib/query-keys";
import { compactNumber, relativeTime } from "@/lib/time";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ErrorState, LoadMore } from "@/components/common/states";
import { CommunityAvatar } from "@/components/common/user-bits";

const ALL = "__all__";
type AdminState = NonNullable<Community["admin"]>;
type AdminStatus = "PUBLISHED" | "REMOVED";
/** The API fills `admin` for platform staff, which this page always is. */
const stateOf = (c: Community): AdminState => c.admin ?? { isDefault: false, status: "PUBLISHED" };

export function AdminCommunities() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState(ALL);
  const debounced = useDebounced(q.trim(), 250);
  const st = status === ALL ? "" : status;
  const list = usePagedList<Community>({
    queryKey: qk.adminCommunities(debounced, st),
    fetchPage: (cursor) => api().admin.communities({ cursor, q: debounced || undefined, status: st || undefined }),
  });
  const [removing, setRemoving] = useState<Community | null>(null);

  const replaceRow = (id: string, fn: (c: Community) => Community) => {
    for (const [key, data] of qc.getQueriesData<InfiniteData<Page<Community>>>({ queryKey: ["admin-communities"] })) {
      if (data) qc.setQueryData(key, { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map((c) => (c.id === id ? fn(c) : c)) })) });
    }
  };
  const update = useMutation({
    mutationFn: (v: { c: Community; isDefault?: boolean; status?: AdminStatus }) => api().admin.updateCommunity(v.c.id, { isDefault: v.isDefault, status: v.status }),
    onMutate: (v) =>
      replaceRow(v.c.id, (c) => ({ ...c, admin: { ...stateOf(c), ...(v.isDefault !== undefined ? { isDefault: v.isDefault } : {}), ...(v.status ? { status: v.status } : {}) } })),
    onError: (_e, v) => replaceRow(v.c.id, () => v.c),
    onSuccess: (updated, v) => {
      // The server's answer is the truth (removing a community also clears its default flag).
      replaceRow(v.c.id, () => updated);
      toast.success({ title: v.status === "REMOVED" ? `${v.c.name} was removed` : v.isDefault ? `${v.c.name} is now a default community` : `${v.c.name} is no longer a default` });
      void qc.invalidateQueries({ queryKey: qk.communitiesAll });
    },
  });

  return (
    <div>
      <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_200px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search communities" aria-label="Search communities" className="pl-9" />
        </div>
        <Select aria-label="Status" value={status} onValueChange={setStatus} options={[{ value: ALL, label: "Any status" }, { value: "PUBLISHED", label: "Published" }, { value: "HIDDEN", label: "Hidden" }, { value: "REMOVED", label: "Removed" }]} />
      </div>
      <p className="mb-3 text-xs text-subtle-foreground">Default communities are joined automatically by new accounts.</p>
      <Card className="overflow-hidden">
        {list.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : !list.items.length ? (
          <EmptyState icon={<UsersRound />} title="No communities match" />
        ) : (
          <ul className="divide-y divide-border" data-testid="admin-communities">
            {list.items.map((c) => {
              const state = stateOf(c);
              const removed = state.status === "REMOVED";
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <CommunityAvatar community={c} />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                      {c.name}
                      <Badge tone="outline">{c.visibility === "PRIVATE" ? "Private" : "Public"}</Badge>
                      {state.isDefault ? (
                        <Badge tone="primary">
                          <Star /> Default
                        </Badge>
                      ) : null}
                      {state.status !== "PUBLISHED" ? <Badge tone="danger">{state.status === "REMOVED" ? "Removed" : state.status === "HIDDEN" ? "Hidden" : state.status}</Badge> : null}
                    </p>
                    <p className="truncate text-xs text-subtle-foreground">
                      /c/{c.slug}, {compactNumber(c.memberCount)} members, {compactNumber(c.postCount)} posts, created {relativeTime(c.createdAt)}
                      {c.createdBy ? ` by ${c.createdBy.displayName}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {isAdmin && !removed ? (
                      <Tooltip content="Default for new accounts">
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Switch checked={state.isDefault} onCheckedChange={(v) => update.mutate({ c, isDefault: v })} aria-label={`Default community: ${c.name}`} data-testid="admin-community-default" />
                          Default
                        </label>
                      </Tooltip>
                    ) : null}
                    {!removed ? (
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/c/${c.slug}`}>
                          <ExternalLink /> View
                        </Link>
                      </Button>
                    ) : null}
                    {isAdmin ? (
                      removed ? (
                        <Button variant="outline" size="sm" onClick={() => update.mutate({ c, status: "PUBLISHED" })}>
                          Restore
                        </Button>
                      ) : (
                        <Button variant="danger-ghost" size="sm" onClick={() => setRemoving(c)} data-testid="admin-community-remove">
                          <Trash2 /> Remove
                        </Button>
                      )
                    ) : null}
                  </div>
                </li>
              );
            })}
            <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} />
          </ul>
        )}
      </Card>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.name ?? "community"}?`}
        description="It disappears for everyone, including its members. You can restore it from this list."
        confirmLabel="Remove community"
        destructive
        onConfirm={() => (removing ? update.mutateAsync({ c: removing, status: "REMOVED" }) : undefined)}
      />
    </div>
  );
}
