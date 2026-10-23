"use client";

import { Avatar, cn } from "@open-social/ui";
import type { Thread } from "@open-social/types";
import { counterpart, others } from "./thread-utils";

/** A person's avatar for direct threads, two overlapping ones for groups. */
export function ThreadAvatar({ thread, viewerId, online, size = "md" }: { thread: Thread; viewerId: string | undefined; online?: boolean; size?: "sm" | "md" | "lg" }) {
  const other = counterpart(thread, viewerId);
  if (other) return <Avatar name={other.displayName} seed={other.id} src={other.avatarUrl} size={size} online={online} />;
  const people = others(thread, viewerId).slice(0, 2);
  const box = size === "lg" ? "size-12" : size === "md" ? "size-10" : "size-8";
  return (
    <span className={cn("relative inline-block shrink-0", box)} aria-hidden>
      {people[1] ? <Avatar name={people[1].displayName} seed={people[1].id} src={people[1].avatarUrl} size="xs" className="absolute right-0 top-0" /> : null}
      {people[0] ? (
        <span className="absolute bottom-0 left-0 rounded-full ring-2 ring-card">
          <Avatar name={people[0].displayName} seed={people[0].id} src={people[0].avatarUrl} size={size === "sm" ? "xs" : "sm"} />
        </span>
      ) : null}
    </span>
  );
}
