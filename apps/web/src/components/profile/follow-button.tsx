"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UserCheck, UserPlus } from "lucide-react";
import { Button, type ButtonProps } from "@open-social/ui";
import type { Profile } from "@open-social/types";
import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";

/**
 * Follow toggle. With `username`, the cached Profile is updated optimistically
 * (following flag and follower count); otherwise local state carries it.
 */
export function FollowButton({
  userId,
  username,
  following,
  size = "md",
  variantWhenOff = "primary",
  testId = "follow-button",
}: {
  userId: string;
  username?: string;
  following: boolean;
  size?: ButtonProps["size"];
  variantWhenOff?: ButtonProps["variant"];
  testId?: string;
}) {
  const qc = useQueryClient();
  const [local, setLocal] = useState(following);
  const on = username ? following : local;

  const m = useMutation({
    mutationFn: (next: boolean) => (next ? api().users.follow(userId) : api().users.unfollow(userId)),
    onMutate: (next) => {
      setLocal(next);
      if (!username) return {};
      const key = qk.profile(username);
      const prev = qc.getQueryData<Profile>(key);
      qc.setQueryData<Profile>(key, (p) =>
        p ? { ...p, followerCount: Math.max(0, p.followerCount + (next ? 1 : -1)), viewer: { ...p.viewer, following: next } } : p,
      );
      return { prev, key };
    },
    onError: (_e, next, ctx) => {
      setLocal(!next);
      if (ctx?.key) qc.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: () => {
      if (username) {
        void qc.invalidateQueries({ queryKey: qk.followers(username) });
      }
      void qc.invalidateQueries({ queryKey: qk.suggestions });
    },
  });

  return (
    <Button
      size={size}
      variant={on ? "secondary" : variantWhenOff}
      aria-pressed={on}
      data-testid={testId}
      onClick={() => m.mutate(!on)}
      disabled={m.isPending}
    >
      {on ? <UserCheck /> : <UserPlus />}
      {on ? "Following" : "Follow"}
    </Button>
  );
}
