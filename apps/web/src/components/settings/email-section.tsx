"use client";

import { useMutation } from "@tanstack/react-query";
import { Switch, toast } from "@open-social/ui";
import { api } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { SettingsCard } from "./section";

export function EmailSection() {
  const me = useMe();
  const { setUser } = useAuth();
  const enabled = me.emailDigest;
  const save = useMutation({
    mutationFn: (emailDigest: boolean) => api().users.updateMe({ emailDigest }),
    onMutate: (emailDigest) => setUser({ ...me, emailDigest }),
    onSuccess: (m, emailDigest) => {
      setUser(m);
      toast.success({ title: emailDigest ? "Digest turned on" : "Digest turned off" });
    },
    onError: () => setUser(me),
  });
  return (
    <SettingsCard title="Email" description="Choose what we send to your inbox. Account and security emails always arrive.">
      <label className="flex items-start justify-between gap-4" htmlFor="email-digest">
        <span className="min-w-0">
          <span className="block text-sm font-semibold">Email me a digest of unread notifications</span>
          <span className="mt-0.5 block text-sm text-muted-foreground">A short summary of what you missed, sent only when you have unread notifications.</span>
        </span>
        <Switch id="email-digest" checked={enabled} disabled={save.isPending} onCheckedChange={(v) => save.mutate(v)} data-testid="email-digest-toggle" />
      </label>
    </SettingsCard>
  );
}
