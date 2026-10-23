"use client";

import { useState } from "react";
import { FileText, Music, Play } from "lucide-react";
import { cn } from "@open-social/ui";
import type { Media } from "@open-social/types";
import { mosaicLayout } from "@/lib/media-layout";
import { Lightbox } from "./lightbox";

const isVisual = (m: Media) => m.kind === "IMAGE" || m.kind === "VIDEO";

export function formatBytes(n: number | null): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Documents and audio: a chip that downloads or plays. */
export function FileChip({ media, className }: { media: Media; className?: string }) {
  if (media.kind === "AUDIO") {
    return (
      <div className={cn("flex items-center gap-3 rounded-md border border-border bg-muted/50 p-2.5", className)}>
        <Music className="size-5 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{media.fileName}</p>
          <audio controls preload="none" src={media.url} className="mt-1 h-8 w-full" />
        </div>
      </div>
    );
  }
  return (
    <a
      href={media.url}
      target="_blank"
      rel="noopener noreferrer"
      download={media.fileName}
      className={cn("flex items-center gap-3 rounded-md border border-border bg-muted/50 p-2.5 transition-colors hover:bg-muted", className)}
      data-testid="file-chip"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary-soft-foreground">
        <FileText className="size-5" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{media.fileName}</span>
        <span className="block text-xs text-subtle-foreground">
          {media.kind === "PDF" ? "PDF" : (media.fileName.split(".").pop() ?? "File").toUpperCase()}
          {media.sizeBytes ? `, ${formatBytes(media.sizeBytes)}` : ""}
        </span>
      </span>
    </a>
  );
}

/** Images and videos in a 1/2/3/4+ mosaic; images open a lightbox, videos play inline. */
export function MediaMosaic({ media, className, rounded = false }: { media: Media[]; className?: string; rounded?: boolean }) {
  const [lightbox, setLightbox] = useState<number | null>(null);
  const visual = media.filter(isVisual);
  const files = media.filter((m) => !isVisual(m));
  const layout = mosaicLayout(visual);
  const images = visual.filter((m) => m.kind === "IMAGE");

  return (
    <div className={className}>
      {visual.length ? (
        <div
          className={cn("grid grid-cols-2 grid-rows-2 gap-0.5 overflow-hidden bg-muted", rounded && "rounded-md")}
          style={{ aspectRatio: String(layout.aspect) }}
          data-testid="media-mosaic"
          data-count={visual.length}
        >
          {layout.tiles.map((t) => {
            const m = visual[t.index]!;
            const single = visual.length === 1;
            return (
              <div key={m.id} className="relative min-h-0 min-w-0 overflow-hidden bg-black/5" style={{ gridColumn: t.col, gridRow: t.row }}>
                {m.kind === "VIDEO" ? (
                  t.overflow ? (
                    <VideoThumb media={m} />
                  ) : (
                    <video controls preload="metadata" playsInline poster={m.thumbUrl ?? undefined} src={m.url} className="size-full bg-black object-contain" aria-label={m.fileName} />
                  )
                ) : (
                  <button
                    type="button"
                    onClick={() => setLightbox(images.indexOf(m))}
                    className="block size-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    aria-label={`Open image ${t.index + 1} of ${visual.length}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={single ? m.url : (m.thumbUrl ?? m.url)}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className={cn("size-full transition-opacity hover:opacity-95", single ? "object-contain bg-muted" : "object-cover")}
                    />
                  </button>
                )}
                {t.overflow > 0 ? (
                  <button
                    type="button"
                    onClick={() => setLightbox(Math.max(0, images.indexOf(m)))}
                    className="absolute inset-0 flex items-center justify-center bg-overlay/55 text-3xl font-bold text-white"
                    aria-label={`See ${t.overflow} more`}
                  >
                    +{t.overflow}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {files.length ? (
        <div className={cn("space-y-2", visual.length ? "mt-2 px-4" : "px-4")}>
          {files.map((f) => (
            <FileChip key={f.id} media={f} />
          ))}
        </div>
      ) : null}
      {lightbox !== null && images.length ? <Lightbox images={images} index={lightbox} onIndex={setLightbox} onClose={() => setLightbox(null)} /> : null}
    </div>
  );
}

function VideoThumb({ media }: { media: Media }) {
  return (
    <div className="relative size-full bg-black">
      {media.thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={media.thumbUrl} alt="" className="size-full object-cover opacity-80" />
      ) : null}
      <Play className="absolute left-1/2 top-1/2 size-10 -translate-x-1/2 -translate-y-1/2 text-white" />
    </div>
  );
}
