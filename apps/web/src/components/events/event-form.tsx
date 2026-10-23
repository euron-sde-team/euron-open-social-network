"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Info, X } from "lucide-react";
import { isApiError, type EventInput } from "@open-social/api-client";
import { Button, Card, Field, IconButton, Input, NativeSelect, Switch, Textarea, toast } from "@open-social/ui";
import type { CommunityEvent } from "@open-social/types";
import { api } from "@/lib/api";
import { useMyCommunities } from "@/lib/hooks/queries";
import { useUploads } from "@/lib/hooks/use-uploads";
import { browserTimeZone, isoToZoned, timeZones, zonedToIso } from "@/lib/events";
import { qk } from "@/lib/query-keys";
import { safeHref } from "@/lib/text";

export const eventSchema = z
  .object({
    communityId: z.string(),
    title: z.string().trim().min(3, "Give the event a title of at least 3 characters").max(140),
    description: z.string().max(5000),
    start: z.string().min(1, "Choose a start time"),
    end: z.string().min(1, "Choose an end time"),
    timezone: z.string().min(1),
    isVirtual: z.boolean(),
    virtualLink: z.string().trim().max(500),
    location: z.string().trim().max(200),
    capacity: z.string().regex(/^\d*$/, "Use a whole number"),
  })
  .superRefine((v, ctx) => {
    const s = zonedToIso(v.start, v.timezone);
    const e = zonedToIso(v.end, v.timezone);
    if (s && e && new Date(e) <= new Date(s)) ctx.addIssue({ code: "custom", path: ["end"], message: "The event must end after it starts" });
    if (v.isVirtual && v.virtualLink && !safeHref(v.virtualLink)) ctx.addIssue({ code: "custom", path: ["virtualLink"], message: "Use a full link starting with https://" });
    if (v.capacity && Number(v.capacity) < 1) ctx.addIssue({ code: "custom", path: ["capacity"], message: "Capacity must be at least 1, or leave it empty" });
  });

export type EventFormValues = z.infer<typeof eventSchema>;

/** Form values to the API body. Returns null when a time does not parse. */
export function toEventInput(v: EventFormValues, coverUploadId?: string | null): EventInput | null {
  const startsAt = zonedToIso(v.start, v.timezone);
  const endsAt = zonedToIso(v.end, v.timezone);
  if (!startsAt || !endsAt) return null;
  return {
    communityId: v.communityId || null,
    title: v.title.trim(),
    description: v.description.trim(),
    startsAt,
    endsAt,
    timezone: v.timezone,
    isVirtual: v.isVirtual,
    virtualLink: v.isVirtual ? safeHref(v.virtualLink) : null,
    location: v.isVirtual ? null : v.location || null,
    capacity: v.capacity ? Number(v.capacity) : null,
    ...(coverUploadId !== undefined ? { coverUploadId } : {}),
  };
}

function defaults(event?: CommunityEvent, communityId?: string): EventFormValues {
  const tz = event?.timezone ?? browserTimeZone();
  if (event) {
    return {
      communityId: event.community?.id ?? "",
      title: event.title,
      description: event.description ?? "",
      start: isoToZoned(event.startsAt, tz),
      end: isoToZoned(event.endsAt, tz),
      timezone: tz,
      isVirtual: event.isVirtual,
      virtualLink: event.virtualLink ?? "",
      location: event.location ?? "",
      capacity: event.capacity ? String(event.capacity) : "",
    };
  }
  // Next full hour, one hour long.
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 24);
  const end = new Date(start.getTime() + 3_600_000);
  return {
    communityId: communityId ?? "",
    title: "",
    description: "",
    start: isoToZoned(start.toISOString(), tz),
    end: isoToZoned(end.toISOString(), tz),
    timezone: tz,
    isVirtual: false,
    virtualLink: "",
    location: "",
    capacity: "",
  };
}

export function EventForm({ event, communityId }: { event?: CommunityEvent; communityId?: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const communities = useMyCommunities();
  const zones = useMemo(() => timeZones(), []);
  const cover = useUploads("EVENT_COVER", { max: 1, accept: (m) => m.startsWith("image/") });
  const fileRef = useRef<HTMLInputElement>(null);
  const form = useForm<EventFormValues>({ resolver: zodResolver(eventSchema), defaultValues: defaults(event, communityId) });
  const { register, handleSubmit, watch, setValue, formState, setError } = form;
  const isVirtual = watch("isVirtual");
  const tz = watch("timezone");

  // Preselect from ?communityId= once communities load.
  useEffect(() => {
    if (!event && communityId) setValue("communityId", communityId);
  }, [event, communityId, setValue]);

  const save = useMutation({
    mutationFn: (body: EventInput) => (event ? api().events.update(event.id, body) : api().events.create(body)),
    meta: { silent: true },
    onSuccess: (e) => {
      qc.setQueryData(qk.event(e.id), e);
      void qc.invalidateQueries({ queryKey: qk.eventsAll });
      toast.success({ title: event ? "Event updated" : "Event created", description: event ? "Attendees have been notified." : undefined });
      router.push(`/events/${e.id}`);
    },
    onError: (e) => {
      if (isApiError(e) && e.code === "VALIDATION_FAILED") {
        for (const [path, message] of Object.entries(e.fieldErrors)) {
          const field = path === "startsAt" ? "start" : path === "endsAt" ? "end" : path;
          setError(field as keyof EventFormValues, { message });
        }
      }
      toast.error({ title: event ? "Could not update the event" : "Could not create the event", description: isApiError(e) ? (e.status === 403 ? "You do not have permission to create this event here." : e.message) : undefined });
    },
  });

  const onSubmit = handleSubmit((v) => {
    const coverId = cover.mediaIds[0];
    const body = toEventInput(v, coverId ?? (event ? undefined : null));
    if (!body) {
      setError("start", { message: "Check the dates" });
      return;
    }
    save.mutate(body);
  });

  const choices = (communities.data ?? []).filter((c) => c.viewer.isMember);
  const coverPreview = cover.items[0]?.previewUrl ?? (cover.items.length ? null : event?.coverUrl);
  const err = formState.errors;

  return (
    <form onSubmit={onSubmit} noValidate data-testid="event-form">
      <Card className="divide-y divide-border">
        <div className="p-4 sm:p-6">
          <div className="relative aspect-[3/1] overflow-hidden rounded-md border border-dashed border-input bg-muted">
            {coverPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={coverPreview} alt="" className="size-full object-cover" />
            ) : (
              <button type="button" onClick={() => fileRef.current?.click()} className="flex size-full flex-col items-center justify-center gap-2 text-sm font-medium text-muted-foreground hover:bg-muted/70">
                <ImagePlus className="size-6" /> Add a cover photo
              </button>
            )}
            {cover.items[0]?.status === "uploading" ? (
              <div className="absolute inset-x-0 bottom-0 h-1 bg-overlay/30">
                <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(cover.items[0].progress * 100)}%` }} />
              </div>
            ) : null}
            {coverPreview ? (
              <div className="absolute right-2 top-2 flex gap-1">
                <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
                  Change
                </Button>
                {cover.items[0] ? (
                  <IconButton label="Remove cover" variant="muted" size="sm" onClick={() => cover.remove(cover.items[0]!.localId)}>
                    <X />
                  </IconButton>
                ) : null}
              </div>
            ) : null}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                if (e.target.files?.length) {
                  if (cover.items[0]) cover.remove(cover.items[0].localId);
                  cover.add(e.target.files);
                }
                e.target.value = "";
              }}
            />
          </div>
        </div>

        <div className="grid gap-4 p-4 sm:p-6">
          <Field label="Where it is posted" htmlFor="ev-community" hint={!watch("communityId") ? "Network-wide events may be limited to staff on this network." : undefined}>
            <NativeSelect id="ev-community" {...register("communityId")} disabled={!!event} data-testid="event-community">
              <option value="">Network-wide</option>
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Title" htmlFor="ev-title" error={err.title?.message}>
            <Input id="ev-title" {...register("title")} aria-invalid={!!err.title} placeholder="What is happening?" data-testid="event-title" />
          </Field>
          <Field label="Description" htmlFor="ev-desc" optional error={err.description?.message}>
            <Textarea id="ev-desc" rows={5} {...register("description")} placeholder="Agenda, who it is for, what to bring" />
          </Field>
        </div>

        <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-6">
          <Field label="Starts" htmlFor="ev-start" error={err.start?.message}>
            <Input id="ev-start" type="datetime-local" {...register("start")} aria-invalid={!!err.start} data-testid="event-start" />
          </Field>
          <Field label="Ends" htmlFor="ev-end" error={err.end?.message}>
            <Input id="ev-end" type="datetime-local" {...register("end")} aria-invalid={!!err.end} data-testid="event-end" />
          </Field>
          <Field label="Timezone" htmlFor="ev-tz" className="sm:col-span-2" hint="Times are shown to each attendee in their own timezone too.">
            <NativeSelect id="ev-tz" {...register("timezone")}>
              {(zones.includes(tz) ? zones : [tz, ...zones]).map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, " ")}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>

        <div className="grid gap-4 p-4 sm:p-6">
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="block text-sm font-medium">Online event</span>
              <span className="block text-xs text-subtle-foreground">The link is only shown to people who are going.</span>
            </span>
            <Switch checked={isVirtual} onCheckedChange={(c) => setValue("isVirtual", c, { shouldDirty: true })} data-testid="event-virtual" />
          </label>
          {isVirtual ? (
            <Field label="Meeting link" htmlFor="ev-link" error={err.virtualLink?.message} optional>
              <Input id="ev-link" type="url" inputMode="url" {...register("virtualLink")} aria-invalid={!!err.virtualLink} placeholder="https://" />
            </Field>
          ) : (
            <Field label="Location" htmlFor="ev-location" optional>
              <Input id="ev-location" {...register("location")} placeholder="Venue and address" />
            </Field>
          )}
          <Field label="Capacity" htmlFor="ev-capacity" optional error={err.capacity?.message} hint="When it fills up, new RSVPs join a waitlist.">
            <Input id="ev-capacity" inputMode="numeric" {...register("capacity")} aria-invalid={!!err.capacity} placeholder="No limit" className="max-w-[160px]" />
          </Field>
        </div>

        <div className="flex items-center justify-between gap-2 p-4 sm:px-6">
          <p className="flex items-center gap-1.5 text-xs text-subtle-foreground">
            <Info className="size-3.5" /> {event ? "Attendees are notified about changes." : "Members of the community can RSVP."}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending} disabled={cover.busy} data-testid="event-submit">
              {event ? "Save changes" : "Create event"}
            </Button>
          </div>
        </div>
      </Card>
    </form>
  );
}
