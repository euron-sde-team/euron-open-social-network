"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { Ban, MoreHorizontal, Search, ShieldCheck, Timer, UserCheck, Users } from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  IconButton,
  Input,
  Select,
  Skeleton,
  Textarea,
  toast,
} from "@open-social/ui";
import type { AdminUserRow } from "@open-social/api-client";
import type { Page, UserRole, UserStatus } from "@open-social/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { usePagedList } from "@/lib/hooks/queries";
import { humanize } from "@/lib/moderation";
import { qk } from "@/lib/query-keys";
import { relativeTime } from "@/lib/time";
import { ErrorState, LoadMore } from "@/components/common/states";

const ALL = "__all__";
type Row = AdminUserRow & { suspendedUntil?: string | null };

const STATUS_TONE: Record<UserStatus, "success" | "warning" | "danger" | "neutral"> = {
  ACTIVE: "success",
  PENDING_VERIFICATION: "neutral",
  SUSPENDED: "warning",
  BANNED: "danger",
  DEACTIVATED: "neutral",
};

export function AdminUsers() {
  const { isAdmin, user: me } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState(ALL);
  const [role, setRole] = useState(ALL);
  const debounced = useDebounced(q.trim(), 250);
  const filters = { q: debounced || undefined, status: status === ALL ? undefined : status, role: role === ALL ? undefined : role };
  const list = usePagedList<Row>({
    queryKey: qk.adminUsers(filters),
    fetchPage: (cursor) => api().admin.users({ cursor, q: filters.q, status: filters.status as UserStatus | undefined, role: filters.role as UserRole | undefined }),
  });
  const [dialog, setDialog] = useState<{ kind: "suspend" | "ban"; user: Row } | null>(null);

  const replaceRow = (row: Row) => {
    for (const [key, data] of qc.getQueriesData<InfiniteData<Page<Row>>>({ queryKey: ["admin-users"] })) {
      if (data) qc.setQueryData(key, { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map((u) => (u.id === row.id ? { ...u, ...row } : u)) })) });
    }
  };
  const act = useMutation({
    mutationFn: async (v: { kind: "role" | "unsuspend" | "unban"; user: Row; role?: UserRole }) =>
      v.kind === "role" ? api().admin.setRole(v.user.id, v.role!) : v.kind === "unsuspend" ? api().admin.unsuspend(v.user.id) : api().admin.unban(v.user.id),
    onSuccess: (row, v) => {
      replaceRow(row);
      toast.success({ title: v.kind === "role" ? `${row.displayName} is now ${humanize(row.role).toLowerCase()}` : v.kind === "unsuspend" ? "Suspension lifted" : "Ban lifted" });
    },
  });

  return (
    <div>
      <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_180px_180px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, username or exact email" aria-label="Search people" className="pl-9" data-testid="admin-users-search" />
        </div>
        <Select
          aria-label="Status"
          value={status}
          onValueChange={setStatus}
          options={[{ value: ALL, label: "Any status" }, ...(["ACTIVE", "PENDING_VERIFICATION", "SUSPENDED", "BANNED", "DEACTIVATED"] as const).map((s) => ({ value: s, label: humanize(s) }))]}
        />
        <Select aria-label="Role" value={role} onValueChange={setRole} options={[{ value: ALL, label: "Any role" }, { value: "USER", label: "Member" }, { value: "MODERATOR", label: "Moderator" }, { value: "ADMIN", label: "Admin" }]} />
      </div>
      <Card className="overflow-hidden">
        {list.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : !list.items.length ? (
          <EmptyState icon={<Users />} title="No one matches" description="Try a different search or filter." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm" data-testid="admin-users-table">
              <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-subtle-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Person</th>
                  <th className="px-3 py-2.5 font-semibold">Role</th>
                  <th className="px-3 py-2.5 font-semibold">Status</th>
                  <th className="px-3 py-2.5 font-semibold">Joined</th>
                  <th className="px-3 py-2.5 font-semibold">Last seen</th>
                  <th className="px-3 py-2.5" aria-label="Actions" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.items.map((u) => (
                  <tr key={u.id} data-testid="admin-user-row">
                    <td className="px-4 py-2.5">
                      <Link href={`/u/${u.username}`} className="flex items-center gap-2.5">
                        <Avatar name={u.displayName} seed={u.id} src={u.avatarUrl} size="sm" />
                        <span className="min-w-0">
                          <span className="block truncate font-medium hover:underline">{u.displayName}</span>
                          <span className="block truncate text-xs text-subtle-foreground">
                            @{u.username}, {u.email}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">{u.role === "USER" ? <span className="text-muted-foreground">Member</span> : <Badge tone="primary">{humanize(u.role)}</Badge>}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={STATUS_TONE[u.status]}>{humanize(u.status)}</Badge>
                      {u.status === "SUSPENDED" && u.suspendedUntil ? <span className="ml-1 text-xs text-subtle-foreground">until {new Date(u.suspendedUntil).toLocaleDateString()}</span> : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{relativeTime(u.createdAt)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{u.lastSeenAt ? relativeTime(u.lastSeenAt) : "Never"}</td>
                    <td className="px-3 py-2.5 text-right">
                      {u.id !== me?.id ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <IconButton label={`Actions for ${u.displayName}`} size="sm" data-testid="admin-user-actions">
                              <MoreHorizontal />
                            </IconButton>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            {isAdmin ? (
                              <>
                                <DropdownMenuLabel>Network role</DropdownMenuLabel>
                                <DropdownMenuRadioGroup value={u.role} onValueChange={(r) => act.mutate({ kind: "role", user: u, role: r as UserRole })}>
                                  <DropdownMenuRadioItem value="USER">Member</DropdownMenuRadioItem>
                                  <DropdownMenuRadioItem value="MODERATOR">Moderator</DropdownMenuRadioItem>
                                  <DropdownMenuRadioItem value="ADMIN">Admin</DropdownMenuRadioItem>
                                </DropdownMenuRadioGroup>
                                <DropdownMenuSeparator />
                              </>
                            ) : null}
                            {u.status === "SUSPENDED" ? (
                              <DropdownMenuItem onSelect={() => act.mutate({ kind: "unsuspend", user: u })}>
                                <UserCheck /> Lift suspension
                              </DropdownMenuItem>
                            ) : u.status !== "BANNED" ? (
                              <DropdownMenuItem onSelect={() => setDialog({ kind: "suspend", user: u })} data-testid="admin-suspend">
                                <Timer /> Suspend
                              </DropdownMenuItem>
                            ) : null}
                            {isAdmin ? (
                              u.status === "BANNED" ? (
                                <DropdownMenuItem onSelect={() => act.mutate({ kind: "unban", user: u })}>
                                  <ShieldCheck /> Lift ban
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem destructive onSelect={() => setDialog({ kind: "ban", user: u })} data-testid="admin-ban">
                                  <Ban /> Ban
                                </DropdownMenuItem>
                              )
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <span className="text-xs text-subtle-foreground">You</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} />
          </div>
        )}
      </Card>
      {dialog ? <AccountDialog {...dialog} onClose={() => setDialog(null)} onDone={replaceRow} /> : null}
    </div>
  );
}

function AccountDialog({ kind, user, onClose, onDone }: { kind: "suspend" | "ban"; user: Row; onClose: () => void; onDone: (r: Row) => void }) {
  const [days, setDays] = useState("7");
  const [reason, setReason] = useState("");
  const run = useMutation({
    mutationFn: () => (kind === "suspend" ? api().admin.suspend(user.id, Math.max(1, Number(days) || 1), reason.trim()) : api().admin.ban(user.id, reason.trim())),
    onSuccess: (r) => {
      onDone(r);
      toast.success({ title: kind === "suspend" ? `${user.displayName} is suspended` : `${user.displayName} is banned` });
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm" data-testid={`admin-${kind}-dialog`}>
        <DialogHeader>
          <DialogTitle>{kind === "suspend" ? `Suspend ${user.displayName}` : `Ban ${user.displayName}`}</DialogTitle>
          <DialogDescription>
            {kind === "suspend" ? "They can read but not post, comment or message until the suspension ends. Their open sessions disconnect." : "Every session is revoked and they can not sign in. You can lift a ban later."}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {kind === "suspend" ? (
            <Field label="Days" htmlFor="suspend-days">
              <Input id="suspend-days" type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} className="w-28" />
            </Field>
          ) : null}
          <Field label="Reason" htmlFor="account-reason" hint="Recorded in the audit log and shown to the person.">
            <Textarea id="account-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={reason.trim().length < 3} loading={run.isPending} onClick={() => run.mutate()} data-testid="admin-account-confirm">
            {kind === "suspend" ? "Suspend" : "Ban"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
