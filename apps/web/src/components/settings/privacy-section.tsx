"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Lock, UserCheck, Users } from "lucide-react";
import { Button, cn, toast } from "@open-social/ui";
import type { DmPrivacy } from "@open-social/types";
import { api } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { SettingsCard } from "./section";

const OPTIONS: { value: DmPrivacy; title: string; body: string; icon: typeof Users }[] = [
  { value: "COMMUNITIES", title: "People in my communities", body: "Anyone who shares a community with you can message you. People you follow land in your inbox; others arrive as message requests.", icon: Users },
  { value: "FOLLOWING", title: "Only people I follow", body: "Only people you follow can start a conversation with you.", icon: UserCheck },
  { value: "NOBODY", title: "Nobody", body: "No one can start a new conversation with you. Existing conversations stay open.", icon: Lock },
];

export function PrivacySection() {
  const me = useMe();
  const { setUser } = useAuth();
  const [value, setValue] = useState<DmPrivacy>(me.dmPrivacy);
  const save = useMutation({
    mutationFn: () => api().users.updateMe({ dmPrivacy: value }),
    onSuccess: (m) => {
      setUser(m);
      toast.success({ title: "Privacy updated" });
    },
  });
  return (
    <SettingsCard
      title="Who can message you"
      description="Choose who can start a direct conversation with you. Blocked people can never message you."
      footer={
        <Button onClick={() => save.mutate()} loading={save.isPending} disabled={value === me.dmPrivacy} data-testid="settings-save">
          Save
        </Button>
      }
    >
      <div role="radiogroup" aria-label="Direct message privacy" className="space-y-2">
        {OPTIONS.map((o) => {
          const active = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setValue(o.value)}
              data-testid={`dm-privacy-${o.value.toLowerCase()}`}
              className={cn("flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors", active ? "border-primary bg-primary/10" : "border-border hover:bg-muted")}
            >
              <span className={cn("mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full", active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                <o.icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{o.title}</span>
                <span className="mt-0.5 block text-sm text-muted-foreground">{o.body}</span>
              </span>
              <span className={cn("mt-1 size-4 shrink-0 rounded-full border-2", active ? "border-primary bg-primary shadow-[inset_0_0_0_3px_hsl(var(--card))]" : "border-input")} aria-hidden />
            </button>
          );
        })}
      </div>
    </SettingsCard>
  );
}
