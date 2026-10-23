"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Label, Select, toast } from "@open-social/ui";
import type { Post } from "@open-social/types";
import { api } from "@/lib/api";
import { useMyCommunities } from "@/lib/hooks/queries";
import { prependPost, updatePostEverywhere } from "@/lib/post-cache";
import { extractTags } from "@/lib/text";
import { MentionTextarea } from "@/components/common/mention-textarea";

/** Reshare a post into one of your communities, with an optional note. */
export function ShareDialog({ post, open, onOpenChange }: { post: Post; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const communities = (useMyCommunities().data ?? []).filter((c) => c.viewer.canPost);
  const [communityId, setCommunityId] = useState<string | undefined>(undefined);
  const [body, setBody] = useState("");
  const target = communityId ?? communities[0]?.id;
  const source = post.sharedPost ?? post;
  const share = useMutation({
    mutationFn: () => api().posts.create({ communityId: target!, body: body.trim(), sharedPostId: source.id, tags: extractTags(body) }),
    onSuccess: (p) => {
      prependPost(qc, p);
      updatePostEverywhere(qc, source.id, (x) => ({ ...x, shareCount: x.shareCount + 1 }));
      toast.success({ title: "Shared", description: `Posted in ${p.community.name}.` });
      onOpenChange(false);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="share-dialog">
        <DialogHeader>
          <DialogTitle>Share post</DialogTitle>
          <DialogDescription>Share {source.author.displayName}&apos;s post to one of your communities.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {communities.length ? (
            <div className="space-y-1.5">
              <Label htmlFor="share-community">Community</Label>
              <Select id="share-community" value={target} onValueChange={setCommunityId} options={communities.map((c) => ({ value: c.id, label: c.name }))} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Join a community where you can post to share this.</p>
          )}
          <div className="rounded-md border border-border p-3">
            <MentionTextarea value={body} onValueChange={setBody} placeholder="Say something about this (optional)" aria-label="Your note" className="min-h-[60px] text-[15px]" maxLength={5000} />
          </div>
          <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
            <p className="font-semibold">{source.author.displayName}</p>
            <p className="line-clamp-3 text-muted-foreground">{source.body || (source.media.length ? "Photo or video" : "")}</p>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!target} loading={share.isPending} onClick={() => share.mutate()} data-testid="share-submit">
            Share now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
