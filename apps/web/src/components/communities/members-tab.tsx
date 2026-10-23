"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, Check, Clock, MoreHorizontal, Search, ShieldCheck, UserMinus, Users, X } from "lucide-react";
import {
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  IconButton,
  Input,
  Segmented,
  Skeleton,
  Textarea,
  toast,
} from "@open-social/ui";
import type { Community, CommunityRole, Member, MembershipStatus } from "@open-social/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ROLE_LABEL, assignableRoles } from "@/lib/communities";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { usePagedList } from "@/lib/hooks/queries";
import { qk } from "@/lib/query-keys";
import { relativeTime } from "@/lib/time";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ErrorState, LoadMore } from "@/components/common/states";
import { PersonRow } from "@/components/common/user-bits";

type StatusTab = "ACTIVE" | "PENDING" | "SUSPENDED" | "BANNED";

const ROLE_TONE: Record<CommunityRole, "primary" | "success" | "warning" | "neutral"> = { OWNER: "primary", ADMIN: "primary", MODERATOR: "success", MEMBER: "neutral" };

export function RoleBadge({ role }: { role: CommunityRole }) {
  if (role === "MEMBER") return null;
  return (
    <Badge tone={ROLE_TONE[role]}>
      <ShieldCheck /> {ROLE_LABEL[role]}
    </Badge>
  );
}

export function MembersTab({ community: c }: { community: Community }) {
  const [status, setStatus] = useState<StatusTab>("ACTIVE");
  const [q, setQ] = useState("");
  const search = useDebounced(q.trim(), 250);
  const mod = c.viewer.canModerate;
  const effective: MembershipStatus = mod ? status : "ACTIVE";
  const list = usePagedList<Member>({
    queryKey: qk.members(c.id, effective, search),
    fetchPage: (cursor) => api().communities.members(c.id, { status: effective, q: search || undefined, cursor }),
  });

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {mod ? (
          <Segmented
            aria-label="Member status"
            value={status}
            onChange={setStatus}
            options={[
              { value: "ACTIVE", label: "Members" },
              { value: "PENDING", label: "Requests" },
              { value: "SUSPENDED", label: "Suspended" },
              { value: "BANNED", label: "Banned" },
            ]}
          />
        ) : (
          <h2 className="text-lg font-bold">Members</h2>
        )}
        <div className="relative sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a member" aria-label="Find a member" className="pl-9" data-testid="members-search" />
        </div>
      </div>
      <Card className="px-4 py-2" data-testid="members-list">
        {list.isPending ? (
          Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 py-2">
              <Skeleton className="size-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-3 w-1/5" />
              </div>
            </div>
          ))
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} compact />
        ) : !list.items.length ? (
          <EmptyState
            compact
            icon={effective === "PENDING" ? <Clock /> : effective === "BANNED" ? <Ban /> : <Users />}
            title={search ? "No one matches" : effective === "PENDING" ? "No pending requests" : effective === "SUSPENDED" ? "No one is suspended" : effective === "BANNED" ? "No one is banned" : "No members yet"}
          />
        ) : (
          <ul className="divide-y divide-border">
            {list.items.map((m) => (
              <li key={m.id}>
                <MemberRow community={c} member={m} />
              </li>
            ))}
          </ul>
        )}
        <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} />
      </Card>
    </div>
  );
}

function MemberRow({ community: c, member: m }: { community: Community; member: Member }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<null | "suspend" | "ban" | "remove">(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.membersAll(c.id) });
    void qc.invalidateQueries({ queryKey: qk.community(c.slug) });
  };
  const approve = useMutation({ mutationFn: () => api().communities.approve(c.id, m.user.id), onSuccess: () => { toast.success({ title: `${m.user.displayName} is now a member` }); refresh(); } });
  const reject = useMutation({ mutationFn: () => api().communities.reject(c.id, m.user.id), onSuccess: refresh });
  const setRole = useMutation({ mutationFn: (role: CommunityRole) => api().communities.setRole(c.id, m.user.id, role), onSuccess: (r) => { toast.success({ title: `${m.user.displayName} is now ${ROLE_LABEL[r.role].toLowerCase()}` }); refresh(); } });
  const unsuspend = useMutation({ mutationFn: () => api().communities.unsuspend(c.id, m.user.id), onSuccess: refresh });
  const remove = useMutation({ mutationFn: () => api().communities.removeMember(c.id, m.user.id), onSuccess: () => { toast.info({ title: `${m.user.displayName} was removed` }); refresh(); } });
  const unban = useMutation({ mutationFn: () => api().communities.unban(c.id, m.user.id), onSuccess: () => { toast.success({ title: `${m.user.displayName} was unbanned`, description: "They can join again." }); refresh(); } });

  const isSelf = user?.id === m.user.id;
  const canAct = c.viewer.canModerate && !isSelf && m.role !== "OWNER";
  const roles = assignableRoles(c.viewer.role).filter((r) => r !== m.role);
  const meta =
    m.status === "PENDING" ? `Requested ${m.requestedAt ? relativeTime(m.requestedAt) : ""}` : m.joinedAt ? `Joined ${relativeTime(m.joinedAt)}` : `@${m.user.username}`;

  return (
    <>
      <PersonRow
        user={m.user}
        meta={
          <span className="flex items-center gap-2">
            {meta}
            <RoleBadge role={m.role} />
          </span>
        }
        action={
          m.status === "PENDING" && c.viewer.canModerate ? (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => approve.mutate()} loading={approve.isPending} data-testid="member-approve">
                <Check /> Approve
              </Button>
              <Button size="sm" variant="secondary" onClick={() => reject.mutate()} loading={reject.isPending} data-testid="member-reject">
                <X /> Decline
              </Button>
            </div>
          ) : m.status === "BANNED" && canAct ? (
            <Button size="sm" variant="secondary" onClick={() => unban.mutate()} loading={unban.isPending} data-testid="member-unban">
              <Check /> Unban
            </Button>
          ) : canAct ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label={`Manage ${m.user.displayName}`} data-testid="member-menu">
                  <MoreHorizontal />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-60">
                {roles.length && m.status === "ACTIVE" ? (
                  <>
                    <DropdownMenuLabel>Change role</DropdownMenuLabel>
                    {roles.map((r) => (
                      <DropdownMenuItem key={r} onSelect={() => setRole.mutate(r)} data-testid={`member-role-${r.toLowerCase()}`}>
                        <ShieldCheck /> Make {ROLE_LABEL[r].toLowerCase()}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                  </>
                ) : null}
                {m.status === "SUSPENDED" ? (
                  <DropdownMenuItem onSelect={() => unsuspend.mutate()} data-testid="member-unsuspend">
                    <Check /> Lift suspension
                  </DropdownMenuItem>
                ) : m.status === "ACTIVE" ? (
                  <DropdownMenuItem onSelect={() => setDialog("suspend")} data-testid="member-suspend">
                    <Clock /> Suspend
                  </DropdownMenuItem>
                ) : null}
                {m.status !== "BANNED" ? (
                  <DropdownMenuItem destructive onSelect={() => setDialog("ban")} data-testid="member-ban">
                    <Ban /> Ban from community
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem destructive onSelect={() => setDialog("remove")} data-testid="member-remove">
                  <UserMinus /> Remove
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null
        }
      />
      {dialog === "suspend" || dialog === "ban" ? <SanctionDialog kind={dialog} community={c} member={m} onClose={() => setDialog(null)} onDone={refresh} /> : null}
      <ConfirmDialog
        open={dialog === "remove"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Remove ${m.user.displayName}?`}
        description="They will lose access to members-only content. They can ask to join again."
        confirmLabel="Remove"
        destructive
        onConfirm={() => remove.mutateAsync()}
      />
    </>
  );
}

function SanctionDialog({ kind, community: c, member: m, onClose, onDone }: { kind: "suspend" | "ban"; community: Community; member: Member; onClose: () => void; onDone: () => void }) {
  const [days, setDays] = useState("7");
  const [reason, setReason] = useState("");
  const n = Number(days);
  const valid = kind === "ban" || (Number.isInteger(n) && n >= 1 && n <= 365);
  const act = useMutation({
    mutationFn: () => (kind === "suspend" ? api().communities.suspend(c.id, m.user.id, n, reason.trim() || undefined) : api().communities.ban(c.id, m.user.id, reason.trim() || undefined)),
    onSuccess: () => {
      toast.success({ title: kind === "suspend" ? `${m.user.displayName} is suspended for ${n} days` : `${m.user.displayName} is banned` });
      onDone();
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm" data-testid={`${kind}-dialog`}>
        <DialogHeader>
          <DialogTitle>{kind === "suspend" ? `Suspend ${m.user.displayName}` : `Ban ${m.user.displayName}`}</DialogTitle>
          <DialogDescription>
            {kind === "suspend" ? "They can read but not post, comment or chat in this community until the suspension ends." : "They are removed and can not rejoin this community."}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {kind === "suspend" ? (
            <Field label="Days" htmlFor="sanction-days" error={valid ? undefined : "Between 1 and 365 days"}>
              <Input id="sanction-days" type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} aria-invalid={!valid} />
            </Field>
          ) : null}
          <Field label="Reason" htmlFor="sanction-reason" optional hint="Shared with the member.">
            <Textarea id="sanction-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={!valid} loading={act.isPending} onClick={() => act.mutate()} data-testid={`${kind}-confirm`}>
            {kind === "suspend" ? "Suspend" : "Ban"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
