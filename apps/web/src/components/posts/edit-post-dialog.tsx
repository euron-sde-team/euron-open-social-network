"use client";

import { useState } from "react";
import { Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@open-social/ui";
import type { Post } from "@open-social/types";
import { extractTags } from "@/lib/text";
import { MentionTextarea } from "@/components/common/mention-textarea";

export function EditPostDialog({ post, open, onOpenChange, onSave }: { post: Post; open: boolean; onOpenChange: (o: boolean) => void; onSave: (b: { body: string; tags: string[] }) => Promise<unknown> }) {
  const [body, setBody] = useState(post.body);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit post</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <MentionTextarea value={body} onValueChange={setBody} className="min-h-[120px] text-[15px] leading-relaxed" aria-label="Post text" maxLength={10000} autoFocus />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={!body.trim() || body === post.body}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave({ body: body.trim(), tags: extractTags(body) });
                onOpenChange(false);
              } catch {
                /* toast from the mutation cache */
              } finally {
                setBusy(false);
              }
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
