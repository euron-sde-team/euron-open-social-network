"use client";

import { cn } from "@open-social/ui";
import { useNow } from "@/lib/hooks/use-now";
import { activeTypers, typingLabel } from "@/lib/realtime/reducers";
import { useSignals } from "@/lib/stores/signals";

/** "Ada is typing" with animated dots; hidden when nobody is. */
export function TypingIndicator({ roomId, viewerId, className }: { roomId: string; viewerId?: string; className?: string }) {
  const typing = useSignals((s) => s.typing[roomId]);
  const now = useNow(1000);
  const label = typingLabel(activeTypers({ [roomId]: typing ?? [] }, roomId, now, viewerId));
  return (
    <div aria-live="polite" className={cn("h-5 px-4 text-xs text-subtle-foreground", className)}>
      {label ? (
        <span className="inline-flex items-center gap-1.5" data-testid="typing-indicator">
          <span className="inline-flex gap-0.5" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span key={i} className="size-1.5 animate-bounce rounded-full bg-subtle-foreground motion-reduce:animate-none" style={{ animationDelay: `${i * 120}ms` }} />
            ))}
          </span>
          {label}
        </span>
      ) : null}
    </div>
  );
}
