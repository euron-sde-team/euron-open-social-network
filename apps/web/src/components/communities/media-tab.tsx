"use client";

import { useState } from "react";
import { ImageOff, Play } from "lucide-react";
import { Card, EmptyState, Skeleton } from "@open-social/ui";
import type { Community, Media } from "@open-social/types";
import { api } from "@/lib/api";
import { usePagedList } from "@/lib/hooks/queries";
import { qk } from "@/lib/query-keys";
import { ErrorState, LoadMore } from "@/components/common/states";
import { FileChip } from "@/components/media/media-mosaic";
import { Lightbox } from "@/components/media/lightbox";

/** Reusable media grid for any Page<Media> endpoint. */
export function MediaGrid({ queryKey, fetchPage, emptyText }: { queryKey: readonly unknown[]; fetchPage: (cursor: string | undefined) => Promise<{ items: Media[]; nextCursor: string | null }>; emptyText: string }) {
  const list = usePagedList<Media>({ queryKey, fetchPage, staleTime: 60_000 });
  const [open, setOpen] = useState<number | null>(null);
  const images = list.items.filter((m) => m.kind === "IMAGE");
  const visual = list.items.filter((m) => m.kind === "IMAGE" || m.kind === "VIDEO");
  const files = list.items.filter((m) => m.kind !== "IMAGE" && m.kind !== "VIDEO");
  if (list.isPending)
    return (
      <div className="grid grid-cols-3 gap-1 sm:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="aspect-square rounded-none" />
        ))}
      </div>
    );
  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  if (!list.items.length)
    return (
      <Card>
        <EmptyState icon={<ImageOff />} title="No media yet" description={emptyText} />
      </Card>
    );
  return (
    <Card className="p-2" data-testid="media-grid">
      {visual.length ? (
        <div className="grid grid-cols-3 gap-1 sm:grid-cols-4">
          {visual.map((m) => (
            <div key={m.id} className="relative aspect-square overflow-hidden rounded-sm bg-muted">
              {m.kind === "VIDEO" ? (
                <video src={m.url} poster={m.thumbUrl ?? undefined} preload="metadata" controls className="size-full bg-black object-cover" aria-label={m.fileName} />
              ) : (
                <button type="button" onClick={() => setOpen(images.indexOf(m))} className="block size-full" aria-label={`Open ${m.fileName}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.thumbUrl ?? m.url} alt="" loading="lazy" className="size-full object-cover transition-opacity hover:opacity-90" />
                </button>
              )}
              {m.kind === "VIDEO" && !m.url ? <Play className="absolute left-1/2 top-1/2 size-8 -translate-x-1/2 -translate-y-1/2 text-white" /> : null}
            </div>
          ))}
        </div>
      ) : null}
      {files.length ? (
        <div className="mt-2 grid gap-2 p-2 sm:grid-cols-2">
          {files.map((f) => (
            <FileChip key={f.id} media={f} />
          ))}
        </div>
      ) : null}
      <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} />
      {open !== null && images.length ? <Lightbox images={images} index={open} onIndex={setOpen} onClose={() => setOpen(null)} /> : null}
    </Card>
  );
}

export function MediaTab({ community }: { community: Community }) {
  return (
    <div className="mx-auto max-w-4xl">
      <MediaGrid queryKey={qk.communityMedia(community.id)} fetchPage={(cursor) => api().communities.media(community.id, { cursor })} emptyText="Photos, videos and files shared in posts show up here." />
    </div>
  );
}
