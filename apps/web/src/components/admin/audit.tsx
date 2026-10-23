"use client";

import { useState } from "react";
import { ScrollText, Search } from "lucide-react";
import { Avatar, Card, EmptyState, Input, Skeleton } from "@open-social/ui";
import type { AuditEntry } from "@open-social/types";
import { api } from "@/lib/api";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { usePagedList } from "@/lib/hooks/queries";
import { qk } from "@/lib/query-keys";
import { fullTimestamp, relativeTime } from "@/lib/time";
import { ErrorState, LoadMore } from "@/components/common/states";

export function AdminAudit() {
  const [action, setAction] = useState("");
  const a = useDebounced(action.trim(), 300);
  const list = usePagedList<AuditEntry>({ queryKey: qk.audit(a), fetchPage: (cursor) => api().admin.audit({ cursor, action: a || undefined }) });
  return (
    <div>
      <div className="relative mb-3 max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" />
        <Input value={action} onChange={(e) => setAction(e.target.value)} placeholder="Filter by action, for example user.suspend" aria-label="Filter by action" className="pl-9" />
      </div>
      <Card className="overflow-hidden">
        {list.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : !list.items.length ? (
          <EmptyState icon={<ScrollText />} title="No audit entries" description="Security and administrative actions are recorded here." />
        ) : (
          <ul className="divide-y divide-border" data-testid="audit-log">
            {list.items.map((e) => (
              <li key={e.id} className="px-4 py-3">
                <div className="flex items-start gap-3">
                  {e.actor ? <Avatar name={e.actor.displayName} seed={e.actor.id} src={e.actor.avatarUrl} size="sm" /> : <span className="size-8 shrink-0 rounded-full bg-muted" aria-hidden />}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className="font-semibold">{e.actor?.displayName ?? "System"}</span> <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{e.action}</code>{" "}
                      <span className="text-muted-foreground">
                        on {e.entityType}
                        {e.entityId ? ` ${e.entityId}` : ""}
                      </span>
                    </p>
                    <p className="text-xs text-subtle-foreground" title={fullTimestamp(e.createdAt)}>
                      {relativeTime(e.createdAt)}
                    </p>
                    {e.data && Object.keys(e.data).length ? (
                      <details className="mt-1.5">
                        <summary className="cursor-pointer text-xs font-medium text-link">Details</summary>
                        <pre className="mt-1 max-h-60 overflow-auto rounded-md bg-muted p-2 font-mono text-xs leading-relaxed">{JSON.stringify(e.data, null, 2)}</pre>
                      </details>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
            <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} />
          </ul>
        )}
      </Card>
    </div>
  );
}
