"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@open-social/ui";
import type { Post, ReactionType } from "@open-social/types";
import { api } from "../api";
import { removePostEverywhere, restoreSnapshot, updatePostEverywhere } from "../post-cache";
import { applyReaction } from "../reactions";

/** Every mutation a post card offers, each optimistic where the outcome is predictable. */
export function usePostActions(post: Post) {
  const qc = useQueryClient();
  const replace = (p: Post) => updatePostEverywhere(qc, p.id, () => p);

  const react = useMutation({
    mutationFn: (next: ReactionType | null) => (next ? api().posts.react(post.id, next) : api().posts.unreact(post.id)),
    onMutate: (next) => {
      void qc.cancelQueries({ queryKey: ["post", post.id] });
      const snapshot = updatePostEverywhere(qc, post.id, (p) => ({ ...p, ...applyReaction(p, p.viewer.reaction, next), viewer: { ...p.viewer, reaction: next } }));
      return { snapshot };
    },
    onError: (_e, _v, ctx) => ctx && restoreSnapshot(qc, ctx.snapshot),
    onSuccess: (r) =>
      updatePostEverywhere(qc, post.id, (p) => ({ ...p, reactionCount: r.reactionCount, reactionCounts: r.reactionCounts, viewer: { ...p.viewer, reaction: r.viewerReaction } })),
  });

  const bookmark = useMutation({
    mutationFn: (on: boolean) => (on ? api().posts.bookmark(post.id) : api().posts.unbookmark(post.id)),
    onMutate: (on) => ({ snapshot: updatePostEverywhere(qc, post.id, (p) => ({ ...p, viewer: { ...p.viewer, bookmarked: on } })) }),
    onError: (_e, _v, ctx) => ctx && restoreSnapshot(qc, ctx.snapshot),
    onSuccess: (_r, on) => {
      toast.success({ title: on ? "Saved" : "Removed from saved" });
      void qc.invalidateQueries({ queryKey: ["bookmarks"] });
    },
  });

  const hide = useMutation({
    mutationFn: () => api().posts.hide(post.id),
    onMutate: () => ({ snapshot: removePostEverywhere(qc, post.id) }),
    onError: (_e, _v, ctx) => ctx && restoreSnapshot(qc, ctx.snapshot),
    onSuccess: () => toast.info({ title: "Post hidden", description: "You will see fewer posts like this in your feed." }),
  });

  const remove = useMutation({
    mutationFn: () => api().posts.remove(post.id),
    onSuccess: () => {
      removePostEverywhere(qc, post.id);
      qc.removeQueries({ queryKey: ["post", post.id] });
      toast.success({ title: "Post deleted" });
    },
  });

  const pin = useMutation({
    mutationFn: (on: boolean) => (on ? api().posts.pin(post.id) : api().posts.unpin(post.id)),
    onSuccess: (p) => {
      replace(p);
      void qc.invalidateQueries({ queryKey: ["community-pinned", post.community.id] });
    },
  });

  const lock = useMutation({ mutationFn: (on: boolean) => (on ? api().posts.lock(post.id) : api().posts.unlock(post.id)), onSuccess: replace });

  const edit = useMutation({
    mutationFn: (body: { body: string; tags?: string[]; feeling?: string | null }) => api().posts.update(post.id, body),
    onSuccess: (p) => {
      replace(p);
      toast.success({ title: "Post updated" });
    },
  });

  return { react, bookmark, hide, remove, pin, lock, edit };
}
