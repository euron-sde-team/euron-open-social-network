"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Info, Users } from "lucide-react";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label, Segmented, Spinner } from "@open-social/ui";
import type { Thread, UserSummary } from "@open-social/types";
import { api } from "@/lib/api";
import { dmDenialCopy } from "@/lib/errors";
import { qk } from "@/lib/query-keys";
import { PeoplePicker } from "./people-picker";

export const GROUP_MIN = 2;
export const GROUP_MAX = 49;

/** Start a direct conversation (checking eligibility first) or create a group. */
export function NewMessageDialog({ open, onOpenChange, onOpened }: { open: boolean; onOpenChange: (o: boolean) => void; onOpened: (t: Thread) => void }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"direct" | "group">("direct");
  const [person, setPerson] = useState<UserSummary | null>(null);
  const [members, setMembers] = useState<UserSummary[]>([]);
  const [title, setTitle] = useState("");

  const eligibility = useQuery({
    queryKey: qk.eligibility(person?.id ?? ""),
    queryFn: () => api().dms.eligibility(person!.id),
    enabled: !!person && mode === "direct",
    staleTime: 30_000,
    meta: { silent: true },
  });

  const done = (t: Thread) => {
    qc.setQueryData(qk.thread(t.id), t);
    void qc.invalidateQueries({ queryKey: qk.threadsAll });
    onOpened(t);
    onOpenChange(false);
    setPerson(null);
    setMembers([]);
    setTitle("");
  };
  const openDirect = useMutation({ mutationFn: () => api().dms.open(person!.id), onSuccess: done });
  const createGroup = useMutation({ mutationFn: () => api().dms.createGroup(members.map((m) => m.id), title.trim() || undefined), onSuccess: done });

  const toggleMember = (u: UserSummary) =>
    setMembers((s) => (s.some((x) => x.id === u.id) ? s.filter((x) => x.id !== u.id) : s.length >= GROUP_MAX ? s : [...s, u]));

  const e = eligibility.data;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="new-message-dialog">
        <DialogHeader>
          <DialogTitle>New message</DialogTitle>
          <DialogDescription>Message one person, or start a group of up to {GROUP_MAX + 1}.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <Segmented
            aria-label="Conversation type"
            value={mode}
            onChange={setMode}
            options={[
              { value: "direct", label: "One person" },
              { value: "group", label: "Group" },
            ]}
          />
          {mode === "direct" ? (
            <>
              <PeoplePicker autoFocus selected={person ? [person] : []} onToggle={(u) => setPerson((p) => (p?.id === u.id ? null : u))} />
              {person ? (
                <div className="rounded-md border border-border p-3 text-sm" aria-live="polite">
                  {eligibility.isPending ? (
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <Spinner size="sm" /> Checking whether you can message {person.displayName}...
                    </span>
                  ) : e && !e.allowed ? (
                    <p className="text-danger" data-testid="dm-denial">
                      {dmDenialCopy(e.reason, person.displayName)}
                    </p>
                  ) : e?.asRequest ? (
                    <p className="flex items-start gap-2 text-muted-foreground" data-testid="dm-as-request">
                      <Info className="mt-0.5 size-4 shrink-0" /> Your message will arrive as a request. {person.displayName} can accept or decline it.
                    </p>
                  ) : (
                    <p className="text-muted-foreground">You can message {person.displayName}.</p>
                  )}
                </div>
              ) : null}
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="new-group-title">Group name (optional)</Label>
                <Input id="new-group-title" value={title} maxLength={80} onChange={(ev) => setTitle(ev.target.value)} placeholder="Weekend plans" />
              </div>
              <PeoplePicker multi selected={members} onToggle={toggleMember} />
              <p className="text-xs text-subtle-foreground">
                {members.length < GROUP_MIN ? `Pick at least ${GROUP_MIN} people.` : `${members.length} selected, up to ${GROUP_MAX}.`}
              </p>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {mode === "direct" ? (
            <Button disabled={!person || !e?.allowed} loading={openDirect.isPending} onClick={() => openDirect.mutate()} data-testid="new-message-start">
              Message
            </Button>
          ) : (
            <Button disabled={members.length < GROUP_MIN} loading={createGroup.isPending} onClick={() => createGroup.mutate()} data-testid="group-create">
              <Users /> Create group
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
