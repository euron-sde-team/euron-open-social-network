"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { Camera, CornerDownRight, Flag, MoreHorizontal, Pencil, SendHorizontal, Trash2 } from "lucide-react";
import { flattenPages, nextCursor } from "@open-social/api-client";
import { Avatar, Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, IconButton, Skeleton, Spinner, cn } from "@open-social/ui";
import type { Comment, Page, Post, ReactionType } from "@open-social/types";
import { api } from "@/lib/api";
import { useAuth, useRestricted } from "@/lib/auth";
import { useUploads } from "@/lib/hooks/use-uploads";
import { updatePostEverywhere } from "@/lib/post-cache";
import { qk } from "@/lib/query-keys";
import { REACTION_META, applyReaction, topReactions } from "@/lib/reactions";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { MentionTextarea } from "@/components/common/mention-textarea";
import { ReportDialog } from "@/components/common/report-dialog";
import { TimeAgo } from "@/components/common/time-ago";
import { RoleMark } from "@/components/common/user-bits";
import { MediaMosaic } from "@/components/media/media-mosaic";
import { UploadPreviews } from "@/components/media/upload-previews";
import { RichText } from "./rich-text";
import { ReactionButton } from "./reactions";

type CommentPages = InfiniteData<Page<Comment>, string | undefined>;

function mapComment(data: CommentPages | undefined, id: string, fn: (c: Comment) => Comment): CommentPages | undefined {
  if (!data) return data;
  return { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map((c) => (c.id === id ? fn(c) : c)) })) };
}

function appendComment(data: CommentPages | undefined, c: Comment): CommentPages {
  if (!data) return { pages: [{ items: [c], nextCursor: null }], pageParams: [undefined] };
  const pages = [...data.pages];
  const last = pages[pages.length - 1] ?? { items: [], nextCursor: null };
  pages[pages.length - 1] = { ...last, items: [...last.items, c] };
  return { ...data, pages };
}

/** Comments are oldest first. The card shows two, then "View more comments" pages through the rest. */
export function CommentSection({ post, firstPage = 2, enabled = true, autoFocus }: { post: Post; firstPage?: number; enabled?: boolean; autoFocus?: boolean }) {
  const { status } = useAuth();
  const query = useInfiniteQuery({
    queryKey: qk.comments(post.id),
    queryFn: ({ pageParam }) => api().posts.comments(post.id, { cursor: pageParam, limit: pageParam ? 10 : firstPage }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
    enabled: enabled && post.commentCount > 0,
  });
  const comments = flattenPages(query.data?.pages);
  const shown = comments.length;
  const remaining = Math.max(0, post.commentCount - shown);

  return (
    <div className="space-y-2 px-4 pb-3 pt-1" data-testid="comments">
      {query.isPending && post.commentCount > 0 && enabled ? (
        <div className="space-y-3 py-1">
          {Array.from({ length: Math.min(2, post.commentCount) }, (_, i) => (
            <div key={i} className="flex gap-2">
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-12 w-2/3 rounded-2xl" />
            </div>
          ))}
        </div>
      ) : null}
      {comments.map((c) => (
        <CommentItem key={c.id} comment={c} post={post} />
      ))}
      {query.hasNextPage ? (
        <button
          type="button"
          onClick={() => void query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
          className="flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:underline"
          data-testid="comments-more"
        >
          {query.isFetchingNextPage ? <Spinner size="sm" /> : null}
          View more comments{remaining > 0 ? ` (${remaining})` : ""}
        </button>
      ) : null}
      {post.isLocked ? (
        <p className="py-1 text-sm text-subtle-foreground">Comments are turned off for this post.</p>
      ) : status === "signed-in" ? (
        <CommentComposer post={post} autoFocus={autoFocus} />
      ) : (
        <p className="py-1 text-sm text-subtle-foreground">
          <Link href="/login" className="font-semibold text-link hover:underline">
            Sign in
          </Link>{" "}
          to comment.
        </p>
      )}
    </div>
  );
}

function useCommentMutations(post: Post, comment: Comment) {
  const qc = useQueryClient();
  const key = comment.parentId ? qk.replies(comment.parentId) : qk.comments(post.id);
  const react = useMutation({
    mutationFn: (next: ReactionType | null) => (next ? api().comments.react(comment.id, next) : api().comments.unreact(comment.id)),
    onMutate: (next) => {
      const prev = qc.getQueryData<CommentPages>(key);
      qc.setQueryData<CommentPages>(key, (d) =>
        mapComment(d, comment.id, (c) => ({ ...c, ...applyReaction(c, c.viewer.reaction, next), viewer: { ...c.viewer, reaction: next } })),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(key, ctx?.prev),
    onSuccess: (r) =>
      qc.setQueryData<CommentPages>(key, (d) =>
        mapComment(d, comment.id, (c) => ({ ...c, reactionCount: r.reactionCount, reactionCounts: r.reactionCounts, viewer: { ...c.viewer, reaction: r.viewerReaction } })),
      ),
  });
  const edit = useMutation({
    mutationFn: (body: string) => api().comments.update(comment.id, body),
    onSuccess: (c) => qc.setQueryData<CommentPages>(key, (d) => mapComment(d, c.id, () => c)),
  });
  const remove = useMutation({
    mutationFn: () => api().comments.remove(comment.id),
    onSuccess: () => {
      qc.setQueryData<CommentPages>(key, (d) => (d ? { ...d, pages: d.pages.map((p) => ({ ...p, items: p.items.filter((c) => c.id !== comment.id) })) } : d));
      if (!comment.parentId) updatePostEverywhere(qc, post.id, (p) => ({ ...p, commentCount: Math.max(0, p.commentCount - 1) }));
      else qc.setQueryData<CommentPages>(qk.comments(post.id), (d) => mapComment(d, comment.parentId!, (c) => ({ ...c, replyCount: Math.max(0, c.replyCount - 1) })));
    },
  });
  return { react, edit, remove };
}

function CommentItem({ comment, post, isReply }: { comment: Comment; post: Post; isReply?: boolean }) {
  const { status, user } = useAuth();
  const m = useCommentMutations(post, comment);
  const [replying, setReplying] = useState(false);
  const [showReplies, setShowReplies] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [confirm, setConfirm] = useState(false);
  const [report, setReport] = useState(false);
  const pending = comment.id.startsWith("tmp_");
  const top = topReactions(comment.reactionCounts, 2);
  const hidden = comment.status !== "PUBLISHED";

  return (
    <div className={cn("flex gap-2", pending && "opacity-60")} data-testid="comment">
      <Link href={`/u/${encodeURIComponent(comment.author.username)}`} className="shrink-0" aria-hidden tabIndex={-1}>
        <Avatar name={comment.author.displayName} seed={comment.author.id} src={comment.author.avatarUrl} size={isReply ? "xs" : "sm"} />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="group flex items-start gap-1">
          {editing ? (
            <div className="w-full rounded-2xl bg-muted px-3 py-2">
              <MentionTextarea value={draft} onValueChange={setDraft} className="text-sm" autoFocus aria-label="Edit comment" onSubmit={() => draft.trim() && m.edit.mutate(draft.trim(), { onSuccess: () => setEditing(false) })} />
              <div className="mt-1 flex gap-2 text-xs">
                <button type="button" className="font-semibold text-link" onClick={() => draft.trim() && m.edit.mutate(draft.trim(), { onSuccess: () => setEditing(false) })}>
                  Save
                </button>
                <button type="button" className="text-muted-foreground" onClick={() => setEditing(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="relative min-w-0 max-w-full rounded-2xl bg-muted px-3 py-2">
              <span className="flex items-center gap-1 text-[13px]">
                <Link href={`/u/${encodeURIComponent(comment.author.username)}`} className="font-semibold hover:underline">
                  {comment.author.displayName}
                </Link>
                <RoleMark role={comment.author.role} />
                {comment.author.id === post.author.id ? <span className="text-xs font-medium text-subtle-foreground">Author</span> : null}
              </span>
              {hidden ? (
                <p className="text-sm italic text-subtle-foreground">{comment.status === "PENDING_REVIEW" ? "Waiting for review. Only you can see this." : "This comment was hidden by a moderator."}</p>
              ) : (
                <p className="text-[15px] leading-snug">
                  <RichText text={comment.body} />
                </p>
              )}
              {comment.reactionCount > 0 ? (
                <span className="absolute -bottom-2.5 right-1 flex items-center gap-0.5 rounded-full bg-card px-1 py-0.5 text-xs text-muted-foreground shadow-card">
                  {top.map((t) => (
                    <span key={t} aria-hidden className="text-[12px] leading-none">
                      {REACTION_META[t].emoji}
                    </span>
                  ))}
                  <span>{comment.reactionCount}</span>
                </span>
              ) : null}
            </div>
          )}
          {status === "signed-in" && !pending && !editing ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label="Comment options" size="sm" className="opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 md:data-[state=open]:opacity-100">
                  <MoreHorizontal />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {comment.viewer.canEdit ? (
                  <DropdownMenuItem onSelect={() => setEditing(true)}>
                    <Pencil /> Edit
                  </DropdownMenuItem>
                ) : null}
                {comment.viewer.canDelete ? (
                  <DropdownMenuItem destructive onSelect={() => setConfirm(true)}>
                    <Trash2 /> Delete
                  </DropdownMenuItem>
                ) : null}
                {user?.id !== comment.author.id ? (
                  <DropdownMenuItem onSelect={() => setReport(true)}>
                    <Flag /> Report comment
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
        {comment.media && !hidden ? <MediaMosaic media={[comment.media]} rounded className="mt-1 max-w-xs" /> : null}
        <div className="mt-1 flex items-center gap-3 px-3 text-xs font-semibold text-muted-foreground">
          {pending ? (
            <span>Posting...</span>
          ) : (
            <>
              <TimeAgo value={comment.createdAt} className="font-normal" />
              {status === "signed-in" ? (
                <div className="w-auto">
                  <ReactionButton value={comment.viewer.reaction} onChange={(r) => m.react.mutate(r)} size="sm" testId="comment-reaction-button" />
                </div>
              ) : null}
              {status === "signed-in" && !post.isLocked ? (
                <button type="button" className="hover:underline" onClick={() => setReplying(true)}>
                  Reply
                </button>
              ) : null}
              {comment.editedAt ? <span className="font-normal">Edited</span> : null}
            </>
          )}
        </div>
        {!isReply && comment.replyCount > 0 && !showReplies ? (
          <button type="button" onClick={() => setShowReplies(true)} className="mt-1 flex items-center gap-1.5 px-3 text-sm font-semibold text-muted-foreground hover:underline" data-testid="view-replies">
            <CornerDownRight className="size-4" /> View {comment.replyCount} {comment.replyCount === 1 ? "reply" : "replies"}
          </button>
        ) : null}
        {!isReply && showReplies ? <Replies comment={comment} post={post} /> : null}
        {replying ? (
          <div className="mt-2">
            <CommentComposer post={post} parentId={comment.parentId ?? comment.id} replyTo={comment.author.username} autoFocus onDone={() => { setReplying(false); setShowReplies(true); }} />
          </div>
        ) : null}
      </div>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Delete comment?" description="This can not be undone." confirmLabel="Delete" destructive onConfirm={() => m.remove.mutateAsync()} />
      {report ? <ReportDialog open={report} onOpenChange={setReport} targetType="COMMENT" targetId={comment.id} /> : null}
    </div>
  );
}

function Replies({ comment, post }: { comment: Comment; post: Post }) {
  const q = useInfiniteQuery({
    queryKey: qk.replies(comment.id),
    queryFn: ({ pageParam }) => api().comments.replies(comment.id, { cursor: pageParam, limit: 10 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
  });
  const replies = flattenPages(q.data?.pages);
  return (
    <div className="mt-2 space-y-2">
      {q.isPending ? <Skeleton className="ml-2 h-10 w-1/2 rounded-2xl" /> : null}
      {replies.map((r) => (
        <CommentItem key={r.id} comment={r} post={post} isReply />
      ))}
      {q.hasNextPage ? (
        <button type="button" onClick={() => void q.fetchNextPage()} className="px-3 text-sm font-semibold text-muted-foreground hover:underline">
          View more replies
        </button>
      ) : null}
    </div>
  );
}

export function CommentComposer({ post, parentId, replyTo, autoFocus, onDone }: { post: Post; parentId?: string; replyTo?: string; autoFocus?: boolean; onDone?: () => void }) {
  const { user } = useAuth();
  const restricted = useRestricted();
  const qc = useQueryClient();
  const [text, setText] = useState(replyTo ? `@${replyTo} ` : "");
  const uploads = useUploads("COMMENT", { max: 1, accept: (m) => m.startsWith("image/") });
  const fileRef = useRef<HTMLInputElement>(null);
  const key = parentId ? qk.replies(parentId) : qk.comments(post.id);

  const send = useMutation({
    mutationFn: (vars: { body: string; mediaId?: string; tempId: string }) => api().posts.addComment(post.id, { body: vars.body, parentId, mediaId: vars.mediaId }),
    onMutate: (vars) => {
      if (!user) return;
      const temp: Comment = {
        id: vars.tempId,
        postId: post.id,
        parentId: parentId ?? null,
        author: user,
        body: vars.body,
        media: uploads.items[0]?.media ?? null,
        mentions: [],
        status: "PUBLISHED",
        replyCount: 0,
        reactionCount: 0,
        reactionCounts: {},
        createdAt: new Date().toISOString(),
        editedAt: null,
        viewer: { reaction: null, canEdit: false, canDelete: false },
      };
      qc.setQueryData<CommentPages>(key, (d) => appendComment(d, temp));
      if (!parentId) updatePostEverywhere(qc, post.id, (p) => ({ ...p, commentCount: p.commentCount + 1 }));
      else qc.setQueryData<CommentPages>(qk.comments(post.id), (d) => mapComment(d, parentId, (c) => ({ ...c, replyCount: c.replyCount + 1 })));
      setText("");
      uploads.reset();
      onDone?.();
    },
    onError: (_e, vars) => {
      qc.setQueryData<CommentPages>(key, (d) => (d ? { ...d, pages: d.pages.map((p) => ({ ...p, items: p.items.filter((c) => c.id !== vars.tempId) })) } : d));
      if (!parentId) updatePostEverywhere(qc, post.id, (p) => ({ ...p, commentCount: Math.max(0, p.commentCount - 1) }));
      setText(vars.body);
    },
    onSuccess: (c, vars) => qc.setQueryData<CommentPages>(key, (d) => mapComment(d, vars.tempId, () => c)),
  });

  const submit = () => {
    const body = text.trim();
    if (restricted || (!body && !uploads.mediaIds.length) || uploads.busy) return;
    send.mutate({ body, mediaId: uploads.mediaIds[0], tempId: `tmp_${Date.now()}` });
  };

  if (!user) return null;
  return (
    <div className="flex gap-2">
      <Avatar name={user.displayName} seed={user.id} src={user.avatarUrl} size={parentId ? "xs" : "sm"} />
      <div className="min-w-0 flex-1">
        <div className="flex items-end gap-1 rounded-2xl bg-muted px-3 py-1.5 focus-within:ring-2 focus-within:ring-ring/30">
          <MentionTextarea
            value={text}
            onValueChange={setText}
            onSubmit={submit}
            autoFocus={autoFocus}
            placeholder={restricted ? "Your account is restricted" : parentId ? "Write a reply..." : "Write a comment..."}
            aria-label={parentId ? "Write a reply" : "Write a comment"}
            data-testid="comment-input"
            disabled={restricted}
            maxLength={5000}
            className="py-1 text-[15px]"
            maxHeight={160}
          />
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files && uploads.add(e.target.files)} />
          <IconButton label="Attach a photo" size="sm" onClick={() => fileRef.current?.click()} disabled={restricted || uploads.items.length >= 1}>
            <Camera />
          </IconButton>
          <IconButton label="Post comment" size="sm" onClick={submit} disabled={restricted || (!text.trim() && !uploads.mediaIds.length) || uploads.busy} className="text-primary disabled:text-subtle-foreground" data-testid="comment-submit">
            <SendHorizontal />
          </IconButton>
        </div>
        <UploadPreviews uploads={uploads.items} onRemove={uploads.remove} onRetry={uploads.retry} className="mt-2 max-w-[200px]" />
        {replyTo !== undefined ? (
          <Button variant="link" size="sm" className="mt-1 px-3 text-xs" onClick={onDone}>
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}
