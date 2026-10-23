"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, Monitor, Smartphone } from "lucide-react";
import { Badge, Button, Skeleton, toast } from "@open-social/ui";
import type { SessionInfo } from "@open-social/api-client";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { qk } from "@/lib/query-keys";
import { relativeTime } from "@/lib/time";
import { summarizeUserAgent } from "@/lib/admin";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ErrorState } from "@/components/common/states";
import { SettingsCard } from "./section";

export function SessionsSection() {
  const qc = useQueryClient();
  const { logout } = useAuth();
  const [confirmAll, setConfirmAll] = useState(false);
  const q = useQuery({ queryKey: qk.sessions, queryFn: () => api().users.sessions() });
  const revoke = useMutation({
    mutationFn: (id: string) => api().users.revokeSession(id),
    onMutate: (id) => {
      const prev = qc.getQueryData<SessionInfo[]>(qk.sessions);
      qc.setQueryData<SessionInfo[]>(qk.sessions, (s) => s?.filter((x) => x.id !== id));
      return { prev };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(qk.sessions, ctx?.prev),
    onSuccess: () => toast.success({ title: "Session signed out" }),
  });

  const sessions = q.data ?? [];
  const others = sessions.filter((s) => !s.current);

  return (
    <SettingsCard
      title="Where you are signed in"
      description="Sign out any session you do not recognise, then change your password."
      footer={
        <Button variant="outline" onClick={() => setConfirmAll(true)} disabled={!sessions.length} data-testid="sessions-sign-out-all">
          <LogOut /> Sign out everywhere
        </Button>
      }
    >
      {q.isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} compact />
      ) : (
        <ul className="divide-y divide-border" data-testid="sessions-list">
          {[...sessions].sort((a, b) => Number(b.current) - Number(a.current)).map((s) => {
            const label = summarizeUserAgent(s.userAgent);
            const mobile = /iOS|Android/.test(label);
            return (
              <li key={s.id} className="flex items-center gap-3 py-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  {mobile ? <Smartphone className="size-5" /> : <Monitor className="size-5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    {label}
                    {s.current ? <Badge tone="success">This device</Badge> : null}
                  </p>
                  <p className="truncate text-xs text-subtle-foreground">
                    {s.ip ?? "Unknown location"}, {s.lastUsedAt ? `active ${relativeTime(s.lastUsedAt)}` : `signed in ${relativeTime(s.createdAt)}`}
                  </p>
                </div>
                {!s.current ? (
                  <Button variant="ghost" size="sm" onClick={() => revoke.mutate(s.id)} data-testid="session-revoke">
                    Sign out
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {others.length === 0 && !q.isPending && !q.isError ? <p className="mt-2 text-sm text-muted-foreground">No other sessions.</p> : null}
      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title="Sign out everywhere?"
        description="Every session, including this one, will be signed out. You will need to sign in again."
        confirmLabel="Sign out everywhere"
        destructive
        onConfirm={async () => {
          await logout({ everywhere: true });
          toast.info({ title: "Signed out of all sessions", description: "Sign in again to continue." });
        }}
      />
    </SettingsCard>
  );
}
