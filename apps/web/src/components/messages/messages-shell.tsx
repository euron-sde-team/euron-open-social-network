"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { Button, EmptyState, cn } from "@open-social/ui";
import { Conversation } from "./conversation";
import { NewMessageDialog } from "./new-message-dialog";
import { ThreadList } from "./thread-list";

/** Two panes under the header: conversations on the left, the open one on the right. One pane at a time on small screens. */
export function MessagesShell() {
  const params = useParams<{ id?: string }>();
  const activeId = typeof params?.id === "string" ? params.id : null;
  const router = useRouter();
  const [composing, setComposing] = useState(false);
  return (
    <div className="mx-auto grid h-[calc(100dvh-var(--header-height)-4rem)] max-w-[1600px] grid-cols-1 md:h-[calc(100dvh-var(--header-height))] lg:grid-cols-[360px_1fr]">
      <aside className={cn("min-h-0 border-border bg-card lg:border-r", activeId ? "hidden lg:block" : "block")} aria-label="Conversations">
        <ThreadList activeId={activeId} onNewMessage={() => setComposing(true)} />
      </aside>
      <section className={cn("min-h-0", activeId ? "block" : "hidden lg:block")} aria-label="Conversation">
        {activeId ? (
          <Conversation key={activeId} threadId={activeId} onBack={() => router.push("/messages")} onClosed={() => router.push("/messages")} />
        ) : (
          <div className="flex h-full items-center justify-center bg-background">
            <EmptyState
              icon={<MessageCircle />}
              title="Your messages"
              description="Pick a conversation, or start a new one with someone from your communities."
              action={<Button onClick={() => setComposing(true)}>New message</Button>}
            />
          </div>
        )}
      </section>
      <NewMessageDialog open={composing} onOpenChange={setComposing} onOpened={(t) => router.push(`/messages/${t.id}`)} />
    </div>
  );
}
