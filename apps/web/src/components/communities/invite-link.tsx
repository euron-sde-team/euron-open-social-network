"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link2 } from "lucide-react";
import { Button, toast } from "@open-social/ui";
import type { Community, Invite } from "@open-social/types";
import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";

export function inviteUrl(invite: Invite): string {
  if (/^https?:\/\//i.test(invite.url)) return invite.url;
  if (typeof window === "undefined") return invite.url;
  return `${window.location.origin}${invite.url.startsWith("/") ? invite.url : `/invite/${invite.code}`}`;
}

export async function copyText(text: string, label = "Invite link copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success({ title: label });
  } catch {
    toast.error({ title: "Could not copy", description: text });
  }
}

/** Copy a usable invite link: reuse a live one, or create one. */
export function InviteLinkButton({ community, size = "md" }: { community: Community; size?: "sm" | "md" }) {
  const qc = useQueryClient();
  const copy = useMutation({
    mutationFn: async () => {
      const existing = await qc.fetchQuery({ queryKey: qk.invites(community.id), queryFn: () => api().communities.invites(community.id), staleTime: 30_000 });
      const now = Date.now();
      const live = existing.find((i) => (!i.expiresAt || new Date(i.expiresAt).getTime() > now) && (i.maxUses === null || i.uses < i.maxUses));
      if (live) return live;
      const created = await api().communities.createInvite(community.id, { expiresInDays: 7 });
      qc.setQueryData<Invite[]>(qk.invites(community.id), (l) => [created, ...(l ?? [])]);
      return created;
    },
    onSuccess: (invite) => void copyText(inviteUrl(invite)),
  });
  return (
    <Button variant="secondary" size={size} loading={copy.isPending} onClick={() => copy.mutate()} data-testid="invite-link">
      <Link2 /> Invite
    </Button>
  );
}
