"use client";

import { useState } from "react";
import { Bookmark, BookmarkMinus, EyeOff, Flag, Link2, Lock, LockOpen, MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, IconButton, toast } from "@open-social/ui";
import type { Post } from "@open-social/types";
import { useAuth } from "@/lib/auth";
import { usePostActions } from "@/lib/hooks/use-post-actions";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ReportDialog } from "@/components/common/report-dialog";
import { EditPostDialog } from "./edit-post-dialog";

export function PostMenu({ post }: { post: Post }) {
  const { status, user } = useAuth();
  const actions = usePostActions(post);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [editing, setEditing] = useState(false);
  const signedIn = status === "signed-in";
  const own = user?.id === post.author.id;

  const copyLink = async () => {
    const url = `${window.location.origin}/posts/${post.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success({ title: "Link copied" });
    } catch {
      toast.error({ title: "Could not copy the link", description: url });
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label="Post options" data-testid="post-menu">
            <MoreHorizontal />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-64">
          {signedIn ? (
            <DropdownMenuItem onSelect={() => actions.bookmark.mutate(!post.viewer.bookmarked)} data-testid="post-bookmark">
              {post.viewer.bookmarked ? <BookmarkMinus /> : <Bookmark />}
              {post.viewer.bookmarked ? "Remove from saved" : "Save post"}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => void copyLink()}>
            <Link2 /> Copy link
          </DropdownMenuItem>
          {post.viewer.canEdit ? (
            <DropdownMenuItem onSelect={() => setEditing(true)} data-testid="post-edit">
              <Pencil /> Edit post
            </DropdownMenuItem>
          ) : null}
          {post.viewer.canModerate ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => actions.pin.mutate(!post.isPinned)} data-testid="post-pin">
                {post.isPinned ? <PinOff /> : <Pin />}
                {post.isPinned ? "Unpin from community" : "Pin to community"}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => actions.lock.mutate(!post.isLocked)} data-testid="post-lock">
                {post.isLocked ? <LockOpen /> : <Lock />}
                {post.isLocked ? "Turn comments on" : "Turn off comments"}
              </DropdownMenuItem>
            </>
          ) : null}
          {signedIn && !own ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => actions.hide.mutate()} data-testid="post-hide">
                <EyeOff /> Hide from feed
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setReporting(true)} data-testid="post-report">
                <Flag /> Report post
              </DropdownMenuItem>
            </>
          ) : null}
          {post.viewer.canDelete ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => setConfirmDelete(true)} data-testid="post-delete">
                <Trash2 /> Delete post
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this post?"
        description="It will be removed for everyone, along with its comments and reactions."
        confirmLabel="Delete"
        destructive
        onConfirm={() => actions.remove.mutateAsync()}
      />
      {reporting ? <ReportDialog open={reporting} onOpenChange={setReporting} targetType="POST" targetId={post.id} /> : null}
      {editing ? <EditPostDialog post={post} open={editing} onOpenChange={setEditing} onSave={(b) => actions.edit.mutateAsync(b)} /> : null}
    </>
  );
}
