"use client";

import { useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Camera, ImagePlus, X } from "lucide-react";
import { isApiError } from "@open-social/api-client";
import { Avatar, Button, Field, Input, Spinner, Textarea, toast } from "@open-social/ui";
import { api } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { useUploads } from "@/lib/hooks/use-uploads";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/query-keys";
import { SettingsCard } from "./section";

const url = z
  .string()
  .trim()
  .max(200)
  .refine((v) => !v || /^https?:\/\/[^\s]+\.[^\s]+$/i.test(v), "Use a full address starting with https://");

const schema = z.object({
  displayName: z.string().trim().min(1, "Enter your name").max(80),
  headline: z.string().trim().max(120),
  bio: z.string().trim().max(1000),
  location: z.string().trim().max(80),
  website: url,
});
type Values = z.infer<typeof schema>;

export function ProfileSection() {
  const me = useMe();
  const { setUser } = useAuth();
  const qc = useQueryClient();
  // Profile has the cover and bio fields that Me does not carry.
  const profile = useQuery({ queryKey: qk.profile(me.username), queryFn: () => api().users.profile(me.username) });
  const avatar = useUploads("AVATAR", { max: 1, accept: (m) => m.startsWith("image/") });
  const cover = useUploads("COVER", { max: 1, accept: (m) => m.startsWith("image/") });
  const avatarRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const p = profile.data;

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    values: { displayName: me.displayName, headline: me.headline ?? "", bio: p?.bio ?? "", location: p?.location ?? "", website: p?.website ?? "" },
    resetOptions: { keepDirtyValues: true },
  });

  const onSubmit = async (v: Values) => {
    try {
      const updated = await api().users.updateMe({
        displayName: v.displayName,
        headline: v.headline || null,
        bio: v.bio || null,
        location: v.location || null,
        website: v.website || null,
        ...(avatar.mediaIds[0] ? { avatarUploadId: avatar.mediaIds[0] } : {}),
        ...(cover.mediaIds[0] ? { coverUploadId: cover.mediaIds[0] } : {}),
      });
      setUser(updated);
      avatar.reset();
      cover.reset();
      form.reset(v);
      void qc.invalidateQueries({ queryKey: qk.profile(me.username) });
      toast.success({ title: "Profile saved" });
    } catch (e) {
      if (isApiError(e) && e.code === "VALIDATION_FAILED") {
        for (const [path, msg] of Object.entries(e.fieldErrors)) if (path in v) form.setError(path as keyof Values, { message: msg });
      }
      toast.error({ title: "Could not save your profile", description: isApiError(e) ? e.message : undefined });
    }
  };

  const avatarPreview = avatar.items[0]?.previewUrl ?? me.avatarUrl;
  const coverPreview = cover.items[0]?.previewUrl ?? p?.coverUrl ?? null;
  const uploadsBusy = avatar.busy || cover.busy;
  const dirty = form.formState.isDirty || avatar.mediaIds.length > 0 || cover.mediaIds.length > 0;
  const errs = form.formState.errors;

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <SettingsCard
        title="Profile"
        description="This is what people see on your profile and next to your posts."
        footer={
          <Button type="submit" loading={form.formState.isSubmitting} disabled={!dirty || uploadsBusy || avatar.failed || cover.failed} data-testid="settings-save">
            {uploadsBusy ? "Uploading..." : "Save changes"}
          </Button>
        }
      >
        <div className="relative mb-14">
          <div className="relative h-36 overflow-hidden rounded-lg bg-muted sm:h-44">
            {coverPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={coverPreview} alt="" className="size-full object-cover" />
            ) : (
              <div className="flex size-full items-center justify-center text-sm text-subtle-foreground">No cover photo</div>
            )}
            {cover.busy ? (
              <div className="absolute inset-0 flex items-center justify-center bg-overlay/40">
                <Spinner className="text-white" />
              </div>
            ) : null}
            <div className="absolute bottom-2 right-2 flex gap-2">
              {cover.items.length ? (
                <Button size="sm" variant="secondary" onClick={() => cover.remove(cover.items[0]!.localId)}>
                  <X /> Undo
                </Button>
              ) : null}
              <Button size="sm" variant="secondary" onClick={() => coverRef.current?.click()} data-testid="cover-upload">
                <ImagePlus /> Change cover
              </Button>
            </div>
          </div>
          <div className="absolute -bottom-10 left-4">
            <div className="relative rounded-full ring-4 ring-card">
              <Avatar name={me.displayName} seed={me.id} src={avatarPreview} size="xl" />
              {avatar.busy ? (
                <div className="absolute inset-0 flex items-center justify-center rounded-full bg-overlay/40">
                  <Spinner className="text-white" />
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => avatarRef.current?.click()}
                aria-label="Change profile photo"
                data-testid="avatar-upload"
                className="absolute -bottom-1 -right-1 flex size-8 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-card hover:bg-muted"
              >
                <Camera className="size-4" />
              </button>
            </div>
          </div>
          <input
            ref={avatarRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              if (e.target.files?.length) {
                avatar.items.forEach((i) => avatar.remove(i.localId));
                avatar.add(e.target.files);
              }
              e.target.value = "";
            }}
          />
          <input
            ref={coverRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              if (e.target.files?.length) {
                cover.items.forEach((i) => cover.remove(i.localId));
                cover.add(e.target.files);
              }
              e.target.value = "";
            }}
          />
        </div>
        {avatar.failed || cover.failed ? <p className="mb-3 text-sm text-danger">An upload failed. Remove it or pick another image.</p> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="displayName" error={errs.displayName?.message}>
            <Input id="displayName" {...form.register("displayName")} aria-invalid={!!errs.displayName || undefined} />
          </Field>
          <Field label="Username" htmlFor="username" hint="Usernames can not be changed.">
            <Input id="username" value={`@${me.username}`} disabled readOnly />
          </Field>
          <Field label="Headline" htmlFor="headline" optional className="sm:col-span-2" error={errs.headline?.message} hint="A short line under your name">
            <Input id="headline" maxLength={120} {...form.register("headline")} />
          </Field>
          <Field label="Bio" htmlFor="bio" optional className="sm:col-span-2" error={errs.bio?.message}>
            <Textarea id="bio" rows={4} maxLength={1000} {...form.register("bio")} />
          </Field>
          <Field label="Location" htmlFor="location" optional error={errs.location?.message}>
            <Input id="location" maxLength={80} {...form.register("location")} />
          </Field>
          <Field label="Website" htmlFor="website" optional error={errs.website?.message}>
            <Input id="website" type="url" placeholder="https://" {...form.register("website")} aria-invalid={!!errs.website || undefined} />
          </Field>
        </div>
      </SettingsCard>
    </form>
  );
}
