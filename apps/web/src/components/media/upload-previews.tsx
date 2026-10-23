"use client";

import { AlertCircle, FileText, RotateCw, X } from "lucide-react";
import { IconButton, cn } from "@open-social/ui";
import type { PendingUpload } from "@/lib/hooks/use-uploads";
import { mosaicLayout } from "@/lib/media-layout";

function ProgressRing({ value }: { value: number }) {
  const r = 16;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 40 40" className="size-10 -rotate-90" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress">
      <circle cx="20" cy="20" r={r} fill="none" stroke="white" strokeOpacity="0.35" strokeWidth="4" />
      <circle cx="20" cy="20" r={r} fill="none" stroke="white" strokeWidth="4" strokeDasharray={c} strokeDashoffset={c * (1 - value)} strokeLinecap="round" />
    </svg>
  );
}

/** Composer attachments: visual ones in the same mosaic the post will use, files as rows. */
export function UploadPreviews({ uploads, onRemove, onRetry, className }: { uploads: PendingUpload[]; onRemove: (id: string) => void; onRetry: (id: string) => void; className?: string }) {
  const visual = uploads.filter((u) => u.kind === "IMAGE" || u.kind === "VIDEO");
  const files = uploads.filter((u) => !(u.kind === "IMAGE" || u.kind === "VIDEO"));
  const layout = mosaicLayout(visual.map(() => ({ width: null, height: null })));
  if (!uploads.length) return null;
  return (
    <div className={cn("space-y-2", className)} data-testid="upload-previews">
      {visual.length ? (
        <div className="grid grid-cols-2 grid-rows-2 gap-1 overflow-hidden rounded-md" style={{ aspectRatio: String(visual.length === 1 ? 16 / 10 : layout.aspect) }}>
          {layout.tiles.map((t) => {
            const u = visual[t.index]!;
            return (
              <div key={u.localId} className="relative min-h-0 overflow-hidden bg-muted" style={{ gridColumn: t.col, gridRow: t.row }}>
                {u.kind === "VIDEO" ? (
                  <video src={u.previewUrl ?? undefined} className="size-full object-cover" muted playsInline />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={u.previewUrl ?? undefined} alt="" className="size-full object-cover" />
                )}
                {u.status === "uploading" ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-overlay/40">
                    <ProgressRing value={u.progress} />
                  </div>
                ) : null}
                {u.status === "error" ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-overlay/60 p-2 text-center text-xs text-white">
                    <AlertCircle className="size-5" />
                    <button type="button" onClick={() => onRetry(u.localId)} className="inline-flex items-center gap-1 font-semibold underline">
                      <RotateCw className="size-3" /> Retry
                    </button>
                  </div>
                ) : null}
                {t.overflow > 0 ? <div className="absolute inset-0 flex items-center justify-center bg-overlay/55 text-2xl font-bold text-white">+{t.overflow}</div> : null}
                <IconButton label={`Remove ${u.file.name}`} size="sm" className="absolute right-1.5 top-1.5 bg-card/90 text-foreground hover:bg-card" onClick={() => onRemove(u.localId)}>
                  <X />
                </IconButton>
              </div>
            );
          })}
        </div>
      ) : null}
      {files.map((u) => (
        <div key={u.localId} className="flex items-center gap-3 rounded-md border border-border p-2">
          <FileText className="size-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{u.file.name}</p>
            {u.status === "uploading" ? (
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(u.progress * 100)}%` }} />
              </div>
            ) : u.status === "error" ? (
              <p className="text-xs text-danger">{u.error}</p>
            ) : (
              <p className="text-xs text-subtle-foreground">Ready</p>
            )}
          </div>
          {u.status === "error" ? (
            <IconButton label="Retry upload" size="sm" onClick={() => onRetry(u.localId)}>
              <RotateCw />
            </IconButton>
          ) : null}
          <IconButton label={`Remove ${u.file.name}`} size="sm" onClick={() => onRemove(u.localId)}>
            <X />
          </IconButton>
        </div>
      ))}
    </div>
  );
}
