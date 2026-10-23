"use client";

import { useRef, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowDown, ArrowUp, Check, Globe2, ImagePlus, Lock, Plus, Trash2 } from "lucide-react";
import { isApiError, type CommunityInput } from "@open-social/api-client";
import { Avatar, Button, Card, CardContent, CardHeader, CardTitle, Field, IconButton, Input, Spinner, Switch, Textarea, cn } from "@open-social/ui";
import type { Community, CommunityVisibility, JoinPolicy } from "@open-social/types";
import { COMMUNITY_COLORS, JOIN_POLICY_COPY, SLUG_PATTERN, slugify } from "@/lib/communities";
import { errorMessage } from "@/lib/errors";
import { useUploads } from "@/lib/hooks/use-uploads";

const schema = z.object({
  name: z.string().trim().min(3, "Use at least 3 characters").max(80, "Keep it under 80 characters"),
  slug: z.string().trim().regex(SLUG_PATTERN, "3 to 48 lower-case letters, digits or hyphens"),
  description: z.string().trim().max(2000, "Keep it under 2000 characters"),
  visibility: z.enum(["PUBLIC", "PRIVATE"]),
  joinPolicy: z.enum(["OPEN", "APPROVAL", "INVITE_ONLY"]),
  allowMemberPosts: z.boolean(),
  premoderatePosts: z.boolean(),
  color: z.string().nullable(),
  rules: z.array(z.object({ title: z.string().trim().min(1, "Give the rule a title").max(100), body: z.string().trim().max(500) })).max(15),
});

export type CommunityFormValues = z.infer<typeof schema>;

export type CommunitySubmit = CommunityInput & { premoderatePosts?: boolean };

const RESTRICTED = new Set(["COMMUNITY_CREATION_RESTRICTED", "COMMUNITY_LIMIT_REACHED"]);

export function CommunityForm({
  mode,
  community,
  onSubmit,
  onRestricted,
}: {
  mode: "create" | "edit";
  community?: Community;
  onSubmit: (values: CommunitySubmit) => Promise<unknown>;
  onRestricted?: (code: string) => void;
}) {
  const [slugTouched, setSlugTouched] = useState(mode === "edit");
  const [formError, setFormError] = useState<string | null>(null);
  const icon = useUploads("COMMUNITY_ICON", { max: 1, accept: (m) => m.startsWith("image/") });
  const cover = useUploads("COMMUNITY_COVER", { max: 1, accept: (m) => m.startsWith("image/") });
  const iconRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);

  const form = useForm<CommunityFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: community?.name ?? "",
      slug: community?.slug ?? "",
      description: community?.description ?? "",
      visibility: community?.visibility ?? "PUBLIC",
      joinPolicy: community?.joinPolicy ?? "OPEN",
      allowMemberPosts: community?.allowMemberPosts ?? true,
      premoderatePosts: community?.premoderatePosts ?? false,
      color: community?.color ?? COMMUNITY_COLORS[0],
      rules: community?.rules ?? [],
    },
  });
  const { register, handleSubmit, watch, setValue, setError, formState } = form;
  const rules = useFieldArray({ control: form.control, name: "rules" });
  const name = watch("name");
  const slug = watch("slug");
  const color = watch("color");
  const visibility = watch("visibility");
  const joinPolicy = watch("joinPolicy");

  const submit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      await onSubmit({
        name: v.name,
        slug: v.slug,
        description: v.description || null,
        visibility: v.visibility,
        joinPolicy: v.joinPolicy,
        allowMemberPosts: v.allowMemberPosts,
        rules: v.rules.map((r) => ({ title: r.title, body: r.body })),
        color: v.color,
        ...(icon.mediaIds[0] ? { iconUploadId: icon.mediaIds[0] } : {}),
        ...(cover.mediaIds[0] ? { coverUploadId: cover.mediaIds[0] } : {}),
        ...(mode === "edit" ? { premoderatePosts: v.premoderatePosts } : {}),
      });
    } catch (e) {
      if (isApiError(e)) {
        if (RESTRICTED.has(e.code)) {
          onRestricted?.(e.code);
          setFormError(errorMessage(e));
          return;
        }
        if (e.code === "SLUG_TAKEN" || e.code === "CONFLICT") {
          setError("slug", { message: "That address is taken. Try another." });
          return;
        }
        const fields = e.fieldErrors;
        let mapped = false;
        for (const [path, message] of Object.entries(fields)) {
          if (path in v || path.startsWith("rules.")) {
            setError(path as keyof CommunityFormValues, { message });
            mapped = true;
          }
        }
        if (mapped) return;
      }
      setFormError(errorMessage(e));
    }
  });

  const iconPreview = icon.items[0]?.previewUrl ?? community?.iconUrl ?? null;
  const coverPreview = cover.items[0]?.previewUrl ?? community?.coverUrl ?? null;
  const uploading = icon.busy || cover.busy;

  return (
    <form onSubmit={submit} className="space-y-4" noValidate data-testid="community-form">
      {/* Live preview of the header the community will get. */}
      <Card className="overflow-hidden">
        <div className="relative h-36 w-full" style={{ backgroundColor: color ?? "hsl(var(--primary))" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {coverPreview ? <img src={coverPreview} alt="" className="size-full object-cover" /> : null}
          {cover.busy ? (
            <div className="absolute inset-0 flex items-center justify-center bg-overlay/40">
              <Spinner className="text-white" />
            </div>
          ) : null}
          <input ref={coverRef} type="file" accept="image/*" hidden onChange={(e) => { if (e.target.files?.length) { if (cover.items[0]) cover.remove(cover.items[0].localId); cover.add(e.target.files); } e.target.value = ""; }} />
          <Button type="button" size="sm" variant="secondary" className="absolute bottom-3 right-3 bg-card/90" onClick={() => coverRef.current?.click()} data-testid="community-cover-upload">
            <ImagePlus /> {coverPreview ? "Change cover" : "Add cover"}
          </Button>
        </div>
        <div className="flex items-end gap-3 px-4 pb-4">
          <button type="button" onClick={() => iconRef.current?.click()} className="relative -mt-8 rounded-[22%] ring-4 ring-card focus-visible:ring-ring" aria-label="Upload community icon" data-testid="community-icon-upload">
            <Avatar name={name || "New community"} seed={community?.id ?? slug ?? "new"} src={iconPreview} size="xl" shape="square" />
            <span className="absolute bottom-1 right-1 flex size-7 items-center justify-center rounded-full bg-card shadow-card">
              {icon.busy ? <Spinner size="sm" /> : <ImagePlus className="size-4" />}
            </span>
          </button>
          <input ref={iconRef} type="file" accept="image/*" hidden onChange={(e) => { if (e.target.files?.length) { if (icon.items[0]) icon.remove(icon.items[0].localId); icon.add(e.target.files); } e.target.value = ""; }} />
          <div className="min-w-0 pb-1">
            <p className="truncate text-lg font-bold">{name || "Community name"}</p>
            <p className="truncate text-xs text-subtle-foreground">/c/{slug || "address"}</p>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Basics</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Name" htmlFor="c-name" error={formState.errors.name?.message}>
            <Input
              id="c-name"
              autoFocus={mode === "create"}
              aria-invalid={!!formState.errors.name}
              data-testid="community-name"
              {...register("name", {
                onChange: (e) => {
                  if (!slugTouched) setValue("slug", slugify(e.target.value), { shouldValidate: formState.isSubmitted });
                },
              })}
            />
          </Field>
          <Field label="Address" htmlFor="c-slug" error={formState.errors.slug?.message} hint={mode === "edit" ? "Changing the address breaks old links." : "Lower-case letters, digits and hyphens."}>
            <div className="flex items-center overflow-hidden rounded-md border border-input bg-card shadow-sm focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
              <span className="pl-3 text-sm text-subtle-foreground">/c/</span>
              <input
                id="c-slug"
                aria-invalid={!!formState.errors.slug}
                data-testid="community-slug"
                className="h-10 min-w-0 flex-1 bg-transparent pr-3 text-sm focus:outline-none"
                {...register("slug", { onChange: () => setSlugTouched(true), setValueAs: (v: string) => v.toLowerCase() })}
              />
            </div>
          </Field>
          <Field label="Description" htmlFor="c-desc" optional error={formState.errors.description?.message}>
            <Textarea id="c-desc" rows={3} placeholder="What is this community about?" {...register("description")} />
          </Field>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Accent colour</p>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Accent colour">
              {COMMUNITY_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={color === c}
                  aria-label={`Colour ${c}`}
                  onClick={() => setValue("color", c, { shouldDirty: true })}
                  className="flex size-8 items-center justify-center rounded-full ring-offset-2 ring-offset-card transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  style={{ backgroundColor: c, boxShadow: color === c ? `0 0 0 2px hsl(var(--card)), 0 0 0 4px ${c}` : undefined }}
                >
                  {color === c ? <Check className="size-4 text-white" /> : null}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Privacy and membership</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Visibility">
            {(
              [
                ["PUBLIC", Globe2, "Public", "Anyone can see posts and members"],
                ["PRIVATE", Lock, "Private", "Only members can see posts and members"],
              ] as [CommunityVisibility, typeof Globe2, string, string][]
            ).map(([v, Icon, label, hint]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={visibility === v}
                data-testid={`visibility-${v.toLowerCase()}`}
                onClick={() => setValue("visibility", v, { shouldDirty: true })}
                className={cn("flex items-start gap-3 rounded-md border px-3 py-3 text-left transition-colors", visibility === v ? "border-primary bg-primary/10" : "border-border hover:bg-muted")}
              >
                <Icon className="mt-0.5 size-5 shrink-0 text-primary" />
                <span>
                  <span className="block text-sm font-semibold">{label}</span>
                  <span className="block text-xs text-subtle-foreground">{hint}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Who can join</p>
            <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Join policy">
              {(Object.keys(JOIN_POLICY_COPY) as JoinPolicy[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={joinPolicy === p}
                  data-testid={`join-policy-${p.toLowerCase()}`}
                  onClick={() => setValue("joinPolicy", p, { shouldDirty: true })}
                  className={cn("rounded-md border px-3 py-2.5 text-left transition-colors", joinPolicy === p ? "border-primary bg-primary/10" : "border-border hover:bg-muted")}
                >
                  <span className="block text-sm font-semibold">{JOIN_POLICY_COPY[p].label}</span>
                  <span className="block text-xs text-subtle-foreground">{JOIN_POLICY_COPY[p].hint}</span>
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="block text-sm font-semibold">Members can post</span>
              <span className="block text-xs text-subtle-foreground">When off, only moderators post. Members can still comment.</span>
            </span>
            <Switch checked={watch("allowMemberPosts")} onCheckedChange={(c) => setValue("allowMemberPosts", c, { shouldDirty: true })} />
          </label>
          {mode === "edit" ? (
            <label className="flex items-center justify-between gap-3">
              <span>
                <span className="block text-sm font-semibold">Review posts before they appear</span>
                <span className="block text-xs text-subtle-foreground">New posts wait in the moderation queue until a moderator approves them.</span>
              </span>
              <Switch checked={watch("premoderatePosts")} onCheckedChange={(c) => setValue("premoderatePosts", c, { shouldDirty: true })} data-testid="premoderate-toggle" />
            </label>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rules</CardTitle>
          <Button type="button" variant="soft" size="sm" onClick={() => rules.append({ title: "", body: "" })} disabled={rules.fields.length >= 15} data-testid="add-rule">
            <Plus /> Add rule
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {rules.fields.length === 0 ? <p className="text-sm text-subtle-foreground">Clear rules help members know what belongs here. Add a few.</p> : null}
          {rules.fields.map((f, i) => (
            <div key={f.id} className="flex gap-2 rounded-md border border-border p-3" data-testid="rule-row">
              <span className="mt-2 w-5 shrink-0 text-sm font-bold text-subtle-foreground">{i + 1}</span>
              <div className="min-w-0 flex-1 space-y-2">
                <Input placeholder="Rule title" aria-label={`Rule ${i + 1} title`} aria-invalid={!!formState.errors.rules?.[i]?.title} {...register(`rules.${i}.title`)} />
                {formState.errors.rules?.[i]?.title ? <p className="text-xs text-danger">{formState.errors.rules[i]?.title?.message}</p> : null}
                <Textarea rows={2} placeholder="Explain the rule (optional)" aria-label={`Rule ${i + 1} details`} {...register(`rules.${i}.body`)} />
              </div>
              <div className="flex flex-col gap-1">
                <IconButton label="Move rule up" size="sm" disabled={i === 0} onClick={() => rules.move(i, i - 1)}>
                  <ArrowUp />
                </IconButton>
                <IconButton label="Move rule down" size="sm" disabled={i === rules.fields.length - 1} onClick={() => rules.move(i, i + 1)}>
                  <ArrowDown />
                </IconButton>
                <IconButton label="Remove rule" size="sm" onClick={() => rules.remove(i)}>
                  <Trash2 />
                </IconButton>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {formError ? (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm font-medium text-danger-soft-foreground" data-testid="community-form-error">
          {formError}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="submit" size="lg" loading={formState.isSubmitting} disabled={uploading || icon.failed || cover.failed} data-testid="community-submit">
          {uploading ? "Uploading..." : mode === "create" ? "Create community" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
