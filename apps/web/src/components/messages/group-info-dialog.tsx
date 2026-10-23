"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LogOut, UserPlus } from "lucide-react";
import { Badge, Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Label, toast } from "@open-social/ui";
import type { Thread, UserSummary } from "@open-social/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { qk } from "@/lib/query-keys";
import { removeThread, type ThreadPages } from "@/lib/realtime/reducers";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { PersonRow } from "@/components/common/user-bits";
import { PeoplePicker } from "./people-picker";

/** Group conversation details: rename, participants, add people, leave. */
export function GroupInfoDialog({ thread, open, onOpenChange, onLeft }: { thread: Thread; open: boolean; onOpenChange: (o: boolean) => void; onLeft?: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [title, setTitle] = useState(thread.title ?? "");
  const [adding, setAdding] = useState(false);
  const [toAdd, setToAdd] = useState<UserSummary[]>([]);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const active = thread.participants.filter((p) => p.state !== "LEFT" && p.state !== "DECLINED");

  const save = (x: Thread) => {
    qc.setQueryData(qk.thread(x.id), x);
    void qc.invalidateQueries({ queryKey: qk.threadsAll });
  };
  const rename = useMutation({ mutationFn: () => api().dms.updateThread(thread.id, { title: title.trim() || null }), onSuccess: (x) => {
      save(x);
      toast.success({ title: "Name updated" });
    },
  });
  const add = useMutation({
    mutationFn: () => api().dms.addParticipants(thread.id, toAdd.map((u) => u.id)),
    onSuccess: (x) => {
      save(x);
      setAdding(false);
      setToAdd([]);
      toast.success({ title: "People added" });
    },
  });
  const leave = useMutation({
    mutationFn: () => api().dms.leave(thread.id),
    onSuccess: () => {
      qc.setQueryData<ThreadPages>(qk.threads("inbox"), (d) => removeThread(d, thread.id));
      onOpenChange(false);
      onLeft?.();
      toast.info({ title: "You left the conversation" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="group-info-dialog">
        <DialogHeader>
          <DialogTitle>Conversation details</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="group-title">Name</Label>
            <div className="flex gap-2">
              <Input id="group-title" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="Name this conversation" />
              <Button variant="outline" onClick={() => rename.mutate()} loading={rename.isPending} disabled={(thread.title ?? "") === title.trim()}>
                Save
              </Button>
            </div>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <p className="text-sm font-semibold">{active.length} people</p>
              <Button variant="ghost" size="sm" onClick={() => setAdding((v) => !v)}>
                <UserPlus /> Add people
              </Button>
            </div>
            {adding ? (
              <div className="mb-3 space-y-2 rounded-md border border-border p-3">
                <PeoplePicker multi selected={toAdd} excludeIds={new Set(active.map((p) => p.user.id))} onToggle={(u) => setToAdd((s) => (s.some((x) => x.id === u.id) ? s.filter((x) => x.id !== u.id) : [...s, u]))} />
                <Button size="sm" disabled={!toAdd.length} loading={add.isPending} onClick={() => add.mutate()}>
                  Add {toAdd.length || ""}
                </Button>
              </div>
            ) : null}
            <div className="divide-y divide-border">
              {active.map((p) => (
                <PersonRow
                  key={p.user.id}
                  user={p.user}
                  action={p.user.id === user?.id ? <Badge>You</Badge> : p.state === "REQUESTED" ? <Badge tone="warning">Invited</Badge> : undefined}
                />
              ))}
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="danger-ghost" onClick={() => setConfirmLeave(true)}>
            <LogOut /> Leave conversation
          </Button>
        </DialogFooter>
      </DialogContent>
      <ConfirmDialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title="Leave this conversation?"
        description="You will stop getting its messages. Someone in it can add you back."
        confirmLabel="Leave"
        destructive
        onConfirm={() => leave.mutateAsync()}
      />
    </Dialog>
  );
}
