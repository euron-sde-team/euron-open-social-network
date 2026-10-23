"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban } from "lucide-react";
import { Button, EmptyState, Skeleton, toast } from "@open-social/ui";
import type { UserSummary } from "@open-social/types";
import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { ErrorState } from "@/components/common/states";
import { PersonRow } from "@/components/common/user-bits";
import { SettingsCard } from "./section";

export function BlockedSection() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qk.blocks, queryFn: () => api().users.blocks() });
  const unblock = useMutation({
    mutationFn: (u: UserSummary) => api().users.unblock(u.id),
    onMutate: (u) => {
      const prev = qc.getQueryData<UserSummary[]>(qk.blocks);
      qc.setQueryData<UserSummary[]>(qk.blocks, (l) => l?.filter((x) => x.id !== u.id));
      return { prev };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(qk.blocks, ctx?.prev),
    onSuccess: (_r, u) => {
      toast.success({ title: `Unblocked ${u.displayName}` });
      void qc.invalidateQueries({ queryKey: qk.profile(u.username) });
    },
  });
  return (
    <SettingsCard title="Blocked people" description="Blocked people can not see your profile or content, follow you or message you. They are not told.">
      {q.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} compact />
      ) : !q.data.length ? (
        <EmptyState compact icon={<Ban />} title="You have not blocked anyone" description="You can block someone from the menu on their profile." />
      ) : (
        <ul className="divide-y divide-border" data-testid="blocked-list">
          {q.data.map((u) => (
            <li key={u.id}>
              <PersonRow
                user={u}
                action={
                  <Button variant="outline" size="sm" onClick={() => unblock.mutate(u)} data-testid="unblock">
                    Unblock
                  </Button>
                }
              />
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}
