"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BarChart3, ImagePlus, Megaphone, Paperclip, Plus, Smile, Trash2, X } from "lucide-react";
import {
  Avatar,
  Button,
  Card,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  IconButton,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  Switch,
  Tooltip,
  cn,
  toast,
} from "@open-social/ui";
import type { Community, Post } from "@open-social/types";
import type { PollInput } from "@open-social/api-client";
import { api } from "@/lib/api";
import { useMe, useRestricted } from "@/lib/auth";
import { useMyCommunities } from "@/lib/hooks/queries";
import { useUploads } from "@/lib/hooks/use-uploads";
import { prependPost } from "@/lib/post-cache";
import { extractTags } from "@/lib/text";
import { MentionTextarea } from "@/components/common/mention-textarea";
import { UploadPreviews } from "@/components/media/upload-previews";

export const FEELINGS = [
  { label: "happy", emoji: "\u{1F60A}" },
  { label: "excited", emoji: "\u{1F929}" },
  { label: "grateful", emoji: "\u{1F64F}" },
  { label: "proud", emoji: "\u{1F60C}" },
  { label: "curious", emoji: "\u{1F914}" },
  { label: "motivated", emoji: "\u{1F4AA}" },
  { label: "relaxed", emoji: "\u{1F60E}" },
  { label: "thankful", emoji: "\u{1F49B}" },
  { label: "tired", emoji: "\u{1F634}" },
  { label: "sad", emoji: "\u{1F614}" },
] as const;

type PollDraft = { question: string; options: string[]; allowMultiple: boolean; isAnonymous: boolean; days: string };
const emptyPoll = (): PollDraft => ({ question: "", options: ["", ""], allowMultiple: false, isAnonymous: false, days: "" });

export function pollFromDraft(d: PollDraft): PollInput | null {
  const options = d.options.map((o) => o.trim()).filter(Boolean);
  if (!d.question.trim() || options.length < 2) return null;
  const days = Number(d.days);
  return {
    question: d.question.trim(),
    options: options.slice(0, 8),
    allowMultiple: d.allowMultiple,
    isAnonymous: d.isAnonymous,
    closesAt: days > 0 ? new Date(Date.now() + days * 86_400_000).toISOString() : null,
  };
}

/** The "What's on your mind?" card that opens the composer. */
export function ComposerCard({ community, onPosted }: { community?: Community; onPosted?: (p: Post) => void }) {
  const me = useMe();
  const restricted = useRestricted();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<"text" | "media" | "poll" | "feeling">("text");
  const openWith = (s: typeof start) => {
    setStart(s);
    setOpen(true);
  };
  return (
    <Card className="p-3 pb-2" data-testid="composer-card">
      <div className="flex items-center gap-2">
        <Avatar name={me.displayName} seed={me.id} src={me.avatarUrl} size="md" />
        <button
          type="button"
          onClick={() => openWith("text")}
          disabled={restricted}
          data-testid="composer"
          className="h-10 flex-1 rounded-full bg-muted px-4 text-left text-[15px] text-subtle-foreground transition-colors hover:bg-muted/70 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {restricted
            ? "Your account is restricted, so you can not post right now"
            : community
              ? `Write something in ${community.name}...`
              : `What's on your mind, ${me.displayName.split(" ")[0]}?`}
        </button>
      </div>
      <div className="mt-2 flex items-center gap-1 border-t border-border pt-2">
        <ComposerShortcut icon={<ImagePlus className="size-5 text-success" />} label="Photo or video" onClick={() => openWith("media")} disabled={restricted} />
        <ComposerShortcut icon={<BarChart3 className="size-5 text-primary" />} label="Poll" onClick={() => openWith("poll")} disabled={restricted} />
        <ComposerShortcut icon={<Smile className="size-5 text-reaction-warm" />} label="Feeling" onClick={() => openWith("feeling")} disabled={restricted} />
      </div>
      {open && !restricted ? <ComposerDialog open={open} onOpenChange={setOpen} start={start} community={community} onPosted={onPosted} /> : null}
    </Card>
  );
}

function ComposerShortcut({ icon, label, onClick, disabled }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-10 flex-1 items-center justify-center gap-2 rounded-md text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

export function ComposerDialog({
  open,
  onOpenChange,
  start = "text",
  community,
  onPosted,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  start?: "text" | "media" | "poll" | "feeling";
  community?: Community;
  onPosted?: (p: Post) => void;
}) {
  const me = useMe();
  const restricted = useRestricted();
  const qc = useQueryClient();
  const mine = useMyCommunities();
  const choices = community ? [community] : (mine.data ?? []).filter((c) => c.viewer.canPost);
  const [communityId, setCommunityId] = useState<string | undefined>(community?.id);
  const target = choices.find((c) => c.id === (communityId ?? choices[0]?.id));
  const [body, setBody] = useState("");
  const [feeling, setFeeling] = useState<string | null>(null);
  const [poll, setPoll] = useState<PollDraft | null>(start === "poll" ? emptyPoll() : null);
  const [announcement, setAnnouncement] = useState(false);
  const [feelingOpen, setFeelingOpen] = useState(start === "feeling");
  const uploads = useUploads("POST", { max: 20 });
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (start === "media") setTimeout(() => fileRef.current?.click(), 50);
  }, [start]);

  const pollInput = poll ? pollFromDraft(poll) : null;
  const pollInvalid = poll !== null && pollInput === null;
  const empty = !body.trim() && !uploads.mediaIds.length && !pollInput;
  const dirty = !!body.trim() || uploads.items.length > 0 || poll !== null;

  const create = useMutation({
    mutationFn: () =>
      api().posts.create({
        communityId: target!.id,
        body: body.trim(),
        kind: announcement && target?.viewer.canModerate ? "ANNOUNCEMENT" : "POST",
        feeling,
        tags: extractTags(body),
        mediaIds: uploads.mediaIds.length ? uploads.mediaIds : undefined,
        poll: pollInput ?? undefined,
      }),
    onSuccess: (post) => {
      prependPost(qc, post);
      uploads.reset();
      onPosted?.(post);
      toast.success(post.status === "PENDING_REVIEW" ? { title: "Submitted for review", description: "Moderators will approve it before others can see it." } : { title: "Posted" });
      onOpenChange(false);
    },
  });

  const close = (o: boolean) => {
    if (!o && dirty && !create.isSuccess && !window.confirm("Discard this post?")) return;
    onOpenChange(o);
  };

  const feelingMeta = FEELINGS.find((f) => f.label === feeling);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent size="md" data-testid="composer-dialog" onOpenAutoFocus={(e) => { e.preventDefault(); textRef.current?.focus(); }}>
        <DialogHeader className="text-center">
          <DialogTitle className="text-center">Create post</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <div className="flex items-center gap-3">
            <Avatar name={me.displayName} seed={me.id} src={me.avatarUrl} size="md" />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold">
                {me.displayName}
                {feelingMeta ? (
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    is feeling {feelingMeta.emoji} {feelingMeta.label}
                  </span>
                ) : null}
              </p>
              {community ? (
                <p className="text-xs text-subtle-foreground">Posting in {community.name}</p>
              ) : choices.length ? (
                <Select
                  value={target?.id}
                  onValueChange={setCommunityId}
                  options={choices.map((c) => ({ value: c.id, label: c.name }))}
                  aria-label="Community"
                  data-testid="composer-community"
                  className="mt-1 h-8 w-auto max-w-full gap-1 rounded-md bg-muted px-2 text-xs font-semibold"
                />
              ) : (
                <p className="text-xs text-danger">Join a community to post.</p>
              )}
            </div>
          </div>

          <MentionTextarea
            ref={textRef}
            value={body}
            onValueChange={setBody}
            placeholder={`What's on your mind, ${me.displayName.split(" ")[0]}?`}
            aria-label="Post text"
            data-testid="composer-input"
            maxLength={10000}
            className={cn("min-h-[120px] leading-relaxed", body.length < 85 && !uploads.items.length && !poll ? "text-2xl" : "text-[15px]")}
          />

          <UploadPreviews uploads={uploads.items} onRemove={uploads.remove} onRetry={uploads.retry} />

          {poll ? <PollBuilder value={poll} onChange={setPoll} onRemove={() => setPoll(null)} /> : null}

          {target?.viewer.canModerate ? (
            <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
              <span className="flex items-center gap-2 text-sm">
                <Megaphone className="size-4 text-warning" />
                <span>
                  <span className="font-semibold">Post as announcement</span>
                  <span className="block text-xs text-subtle-foreground">Highlighted for every member</span>
                </span>
              </span>
              <Switch checked={announcement} onCheckedChange={setAnnouncement} data-testid="composer-announcement" />
            </label>
          ) : null}

          <div className="flex items-center justify-between rounded-md border border-border px-3 py-1.5">
            <span className="text-sm font-semibold">Add to your post</span>
            <div className="flex items-center">
              <input
                ref={fileRef}
                type="file"
                multiple
                hidden
                accept="image/*,video/mp4,video/webm,video/quicktime,audio/*,application/pdf,.docx,.xlsx,.pptx,.csv,.txt"
                data-testid="composer-file-input"
                onChange={(e) => {
                  if (e.target.files) uploads.add(e.target.files);
                  e.target.value = "";
                }}
              />
              <Tooltip content="Photo or video">
                <IconButton label="Add photos or videos" onClick={() => fileRef.current?.click()} className="text-success">
                  <ImagePlus />
                </IconButton>
              </Tooltip>
              <Tooltip content="Attach a file">
                <IconButton label="Attach a file" onClick={() => fileRef.current?.click()} className="text-primary">
                  <Paperclip />
                </IconButton>
              </Tooltip>
              <Tooltip content="Poll">
                <IconButton label="Add a poll" onClick={() => setPoll((p) => p ?? emptyPoll())} disabled={!!poll} className="text-primary" data-testid="composer-poll">
                  <BarChart3 />
                </IconButton>
              </Tooltip>
              <Popover open={feelingOpen} onOpenChange={setFeelingOpen}>
                <PopoverTrigger asChild>
                  <span>
                    <IconButton label="Feeling" className="text-reaction-warm">
                      <Smile />
                    </IconButton>
                  </span>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-64 p-1">
                  <p className="px-2 py-1.5 text-xs font-semibold text-subtle-foreground">How are you feeling?</p>
                  <div className="grid grid-cols-2 gap-0.5">
                    {FEELINGS.map((f) => (
                      <button
                        key={f.label}
                        type="button"
                        onClick={() => {
                          setFeeling(feeling === f.label ? null : f.label);
                          setFeelingOpen(false);
                        }}
                        className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-sm capitalize hover:bg-muted", feeling === f.label && "bg-primary/10")}
                      >
                        <span aria-hidden>{f.emoji}</span> {f.label}
                      </button>
                    ))}
                  </div>
                  {feeling ? (
                    <button type="button" onClick={() => setFeeling(null)} className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted">
                      Clear feeling
                    </button>
                  ) : null}
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          {pollInvalid ? <p className="mr-auto text-xs text-danger">A poll needs a question and at least two options.</p> : null}
          <Button block disabled={restricted || !target || empty || uploads.busy || uploads.failed || pollInvalid} loading={create.isPending} onClick={() => create.mutate()} data-testid="composer-submit">
            {uploads.busy ? "Uploading..." : "Post"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PollBuilder({ value, onChange, onRemove }: { value: PollDraft; onChange: (p: PollDraft) => void; onRemove: () => void }) {
  const set = (patch: Partial<PollDraft>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-2 rounded-md border border-border p-3" data-testid="poll-builder">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Poll</p>
        <IconButton label="Remove poll" size="sm" onClick={onRemove}>
          <X />
        </IconButton>
      </div>
      <Input value={value.question} onChange={(e) => set({ question: e.target.value })} placeholder="Ask a question" aria-label="Poll question" maxLength={300} data-testid="poll-question" />
      {value.options.map((o, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            value={o}
            onChange={(e) => set({ options: value.options.map((x, j) => (j === i ? e.target.value : x)) })}
            placeholder={`Option ${i + 1}`}
            aria-label={`Option ${i + 1}`}
            maxLength={120}
            data-testid={`poll-option-input-${i}`}
          />
          {value.options.length > 2 ? (
            <IconButton label={`Remove option ${i + 1}`} size="sm" onClick={() => set({ options: value.options.filter((_, j) => j !== i) })}>
              <Trash2 />
            </IconButton>
          ) : null}
        </div>
      ))}
      {value.options.length < 8 ? (
        <Button variant="ghost" size="sm" onClick={() => set({ options: [...value.options, ""] })}>
          <Plus /> Add option
        </Button>
      ) : null}
      <div className="grid gap-2 pt-1 sm:grid-cols-3">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={value.allowMultiple} onCheckedChange={(c) => set({ allowMultiple: c })} /> Multiple answers
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={value.isAnonymous} onCheckedChange={(c) => set({ isAnonymous: c })} /> Anonymous
        </label>
        <label className="flex items-center gap-2 text-sm">
          Closes in
          <Input type="number" min={0} max={90} value={value.days} onChange={(e) => set({ days: e.target.value })} className="h-8 w-16" aria-label="Days until the poll closes" placeholder="-" />
          days
        </label>
      </div>
    </div>
  );
}
