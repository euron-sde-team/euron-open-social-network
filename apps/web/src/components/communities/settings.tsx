"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Copy, Crown, Link2, Plus, Search, ShieldAlert, Trash2 } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
  IconButton,
  Input,
  NativeSelect,
  Skeleton,
  toast,
} from "@open-social/ui";
import type { Community, Invite, Member } from "@open-social/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { canManageSettings } from "@/lib/communities";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { qk } from "@/lib/query-keys";
import { relativeTime } from "@/lib/time";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ErrorState, PageTitle } from "@/components/common/states";
import { PersonRow } from "@/components/common/user-bits";
import { CommunityForm } from "./community-form";
import { copyText, inviteUrl } from "./invite-link";
import { usePatchCommunity } from "./join-button";

export function CommunitySettings({ slug }: { slug: string }) {
  const { isAdmin } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const patch = usePatchCommunity();
  const q = useQuery({ queryKey: qk.community(slug), queryFn: () => api().communities.get(slug) });

  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const c = q.data;
  if (!canManageSettings(c) && !isAdmin) {
    return (
      <Card>
        <EmptyState icon={<ShieldAlert />} title="Only owners and admins can change settings" description="Ask an owner of this community if something needs to change." />
      </Card>
    );
  }

  return (
    <div className="space-y-6" data-testid="community-settings">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
          <Link href={`/c/${encodeURIComponent(c.slug)}`}>
            <ArrowLeft /> Back to {c.name}
          </Link>
        </Button>
        <PageTitle title="Community settings" description={c.name} className="mb-0" />
      </div>
      <CommunityForm
        key={c.id + c.slug}
        mode="edit"
        community={c}
        onSubmit={async (values) => {
          const updated = await api().communities.update(c.id, values);
          qc.setQueryData(qk.community(updated.slug), updated);
          patch(updated, () => updated);
          toast.success({ title: "Settings saved" });
          if (updated.slug !== c.slug) router.replace(`/c/${encodeURIComponent(updated.slug)}/settings`);
        }}
      />
      <InvitesCard community={c} />
      {c.viewer.role === "OWNER" ? <TransferCard community={c} /> : null}
      {c.viewer.role === "OWNER" || isAdmin ? <DangerCard community={c} /> : null}
    </div>
  );
}

function InvitesCard({ community: c }: { community: Community }) {
  const qc = useQueryClient();
  const [maxUses, setMaxUses] = useState("");
  const [expires, setExpires] = useState("7");
  const q = useQuery({ queryKey: qk.invites(c.id), queryFn: () => api().communities.invites(c.id) });
  const create = useMutation({
    mutationFn: () => api().communities.createInvite(c.id, { maxUses: maxUses ? Number(maxUses) : null, expiresInDays: expires ? Number(expires) : null }),
    onSuccess: (inv) => {
      qc.setQueryData<Invite[]>(qk.invites(c.id), (l) => [inv, ...(l ?? [])]);
      void copyText(inviteUrl(inv), "Invite created and copied");
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api().communities.revokeInvite(c.id, id),
    onSuccess: (_r, id) => qc.setQueryData<Invite[]>(qk.invites(c.id), (l) => l?.filter((i) => i.id !== id)),
  });
  return (
    <Card data-testid="invites-card">
      <CardHeader>
        <CardTitle>Invite links</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Uses" htmlFor="inv-uses" className="w-36">
            <NativeSelect id="inv-uses" value={maxUses} onChange={(e) => setMaxUses(e.target.value)}>
              <option value="">No limit</option>
              {[1, 5, 10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? "use" : "uses"}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Expires after" htmlFor="inv-exp" className="w-40">
            <NativeSelect id="inv-exp" value={expires} onChange={(e) => setExpires(e.target.value)}>
              <option value="1">1 day</option>
              <option value="7">7 days</option>
              <option value="30">30 days</option>
              <option value="">Never</option>
            </NativeSelect>
          </Field>
          <Button onClick={() => create.mutate()} loading={create.isPending} data-testid="invite-create">
            <Plus /> Create link
          </Button>
        </div>
        {q.isPending ? (
          <Skeleton className="h-16" />
        ) : !q.data?.length ? (
          <p className="text-sm text-subtle-foreground">No active invite links.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border" data-testid="invites-list">
            {q.data.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-3 py-2.5">
                <Link2 className="size-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-sm">{i.code}</p>
                  <p className="text-xs text-subtle-foreground">
                    {i.uses} {i.uses === 1 ? "use" : "uses"}
                    {i.maxUses !== null ? ` of ${i.maxUses}` : ""}
                    {i.expiresAt ? `, expires ${relativeTime(i.expiresAt)}` : ", never expires"}
                  </p>
                </div>
                <IconButton label="Copy invite link" onClick={() => void copyText(inviteUrl(i))}>
                  <Copy />
                </IconButton>
                <IconButton label="Revoke invite" onClick={() => revoke.mutate(i.id)} data-testid="invite-revoke">
                  <Trash2 />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function TransferCard({ community: c }: { community: Community }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [target, setTarget] = useState<Member | null>(null);
  const search = useDebounced(q.trim(), 250);
  const members = useQuery({
    queryKey: [...qk.members(c.id, "ACTIVE", search), "transfer"],
    queryFn: async () => (await api().communities.members(c.id, { status: "ACTIVE", q: search || undefined, limit: 8 })).items,
    enabled: search.length >= 1,
  });
  const transfer = useMutation({
    mutationFn: (userId: string) => api().communities.transfer(c.id, userId),
    onSuccess: () => {
      toast.success({ title: `${target?.user.displayName} now owns ${c.name}` });
      void qc.invalidateQueries({ queryKey: qk.community(c.slug) });
      router.push(`/c/${encodeURIComponent(c.slug)}`);
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Transfer ownership</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">Hand the community to another member. You will become an admin.</p>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search members" aria-label="Search members to transfer to" className="pl-9" data-testid="transfer-search" />
        </div>
        {(members.data ?? [])
          .filter((m) => m.role !== "OWNER")
          .map((m) => (
            <PersonRow
              key={m.id}
              user={m.user}
              action={
                <Button size="sm" variant="secondary" onClick={() => setTarget(m)}>
                  <Crown /> Make owner
                </Button>
              }
            />
          ))}
      </CardContent>
      <ConfirmDialog
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        title={`Make ${target?.user.displayName ?? ""} the owner?`}
        description="Only the new owner can transfer ownership again or delete the community."
        confirmLabel="Transfer"
        onConfirm={() => transfer.mutateAsync(target!.user.id)}
        testId="transfer-confirm"
      />
    </Card>
  );
}

function DangerCard({ community: c }: { community: Community }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const del = useMutation({
    mutationFn: () => api().communities.remove(c.id),
    onSuccess: () => {
      toast.success({ title: `${c.name} was deleted` });
      qc.removeQueries({ queryKey: qk.community(c.slug) });
      void qc.invalidateQueries({ queryKey: qk.communitiesAll });
      router.push("/communities");
    },
  });
  return (
    <Card className="border-danger/40">
      <CardHeader>
        <CardTitle className="text-danger">Delete community</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-md text-sm text-muted-foreground">Deletes the community with its posts, chat, events and questions for everyone. This can not be undone.</p>
        <Button variant="danger" onClick={() => setOpen(true)} data-testid="community-delete">
          <Trash2 /> Delete
        </Button>
      </CardContent>
      <ConfirmDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setTyped("");
        }}
        title={`Delete ${c.name}?`}
        description="Type the community name to confirm."
        confirmLabel="Delete forever"
        destructive
        onConfirm={async () => {
          if (typed.trim() !== c.name) {
            toast.error({ title: "The name does not match" });
            throw new Error("mismatch");
          }
          await del.mutateAsync();
        }}
      >
        <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={c.name} aria-label="Community name" data-testid="community-delete-name" />
      </ConfirmDialog>
    </Card>
  );
}
