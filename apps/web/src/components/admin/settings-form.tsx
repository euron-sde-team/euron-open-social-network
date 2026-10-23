"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { isApiError } from "@open-social/api-client";
import { Button, Card, Field, Input, Select, Skeleton, Slider, Switch, toast } from "@open-social/ui";
import type { PlatformSettings } from "@open-social/types";
import { api } from "@/lib/api";
import { thresholdErrors } from "@/lib/admin";
import { humanize } from "@/lib/moderation";
import { qk } from "@/lib/query-keys";
import { ErrorState } from "@/components/common/states";

const threshold = z.object({ review: z.number().min(0).max(1), hide: z.number().min(0).max(1) });

export const settingsSchema = z
  .object({
    networkName: z.string().trim().min(1, "Give the network a name").max(80),
    communityCreation: z.enum(["EVERYONE", "STAFF"]),
    maxCommunitiesPerUser: z.coerce.number().int().min(0, "Zero or more").max(1000),
    networkWideEvents: z.enum(["EVERYONE", "STAFF"]),
    registration: z.enum(["OPEN", "INVITE_ONLY", "CLOSED"]),
    moderation: z.object({
      enabled: z.boolean(),
      provider: z.enum(["rules", "openai", "stub"]),
      thresholds: z.record(threshold),
      premoderateNewAccounts: z.object({
        enabled: z.boolean(),
        firstPosts: z.coerce.number().int().min(0).max(100),
        accountAgeDays: z.coerce.number().int().min(0).max(365),
      }),
      blockedTerms: z.array(z.string().trim().min(1).max(100)).max(1000),
    }),
  })
  .superRefine((v, ctx) => {
    for (const [cat, msg] of Object.entries(thresholdErrors(v.moderation.thresholds))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["moderation", "thresholds", cat], message: msg });
    }
  });
type Values = z.infer<typeof settingsSchema>;

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <div className="space-y-5 px-5 py-5">{children}</div>
    </Card>
  );
}

export function AdminSettings() {
  const q = useQuery({ queryKey: qk.adminSettings, queryFn: () => api().admin.settings() });
  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return <SettingsForm initial={q.data} />;
}

function SettingsForm({ initial }: { initial: PlatformSettings }) {
  const qc = useQueryClient();
  const form = useForm<Values>({ resolver: zodResolver(settingsSchema) as never, defaultValues: initial as Values });
  const [term, setTerm] = useState("");
  const save = useMutation({
    mutationFn: (v: Values) => api().admin.updateSettings(v as PlatformSettings),
    meta: { silent: true },
    onSuccess: (s) => {
      qc.setQueryData(qk.adminSettings, s);
      form.reset(s as Values);
      toast.success({ title: "Settings saved" });
    },
    onError: (e) => {
      if (isApiError(e) && e.code === "VALIDATION_FAILED") {
        for (const [path, message] of Object.entries(e.fieldErrors)) form.setError(path as never, { message });
      }
      toast.error({ title: "Settings were not saved", description: isApiError(e) ? e.message : undefined });
    },
  });
  const { register, control, watch, setValue, formState } = form;
  const errs = formState.errors;
  const thresholds = watch("moderation.thresholds") ?? {};
  const terms = watch("moderation.blockedTerms") ?? [];
  const premod = watch("moderation.premoderateNewAccounts.enabled");

  const addTerms = () => {
    const next = term
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t && !terms.includes(t));
    if (next.length) setValue("moderation.blockedTerms", [...terms, ...next], { shouldDirty: true });
    setTerm("");
  };

  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate className="space-y-4">
      <Section title="Network">
        <Field label="Network name" htmlFor="networkName" error={errs.networkName?.message} hint="Shown in emails and the admin console. The app wordmark comes from the deployment's product name.">
          <Input id="networkName" {...register("networkName")} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Registration" htmlFor="registration">
            <Controller
              control={control}
              name="registration"
              render={({ field }) => (
                <Select id="registration" value={field.value} onValueChange={field.onChange} options={[{ value: "OPEN", label: "Open to anyone" }, { value: "INVITE_ONLY", label: "Invite only" }, { value: "CLOSED", label: "Closed" }]} />
              )}
            />
          </Field>
          <Field label="Who can create communities" htmlFor="communityCreation">
            <Controller
              control={control}
              name="communityCreation"
              render={({ field }) => <Select id="communityCreation" value={field.value} onValueChange={field.onChange} options={[{ value: "EVERYONE", label: "Everyone" }, { value: "STAFF", label: "Moderators and admins" }]} />}
            />
          </Field>
          <Field label="Communities per person" htmlFor="maxCommunitiesPerUser" error={errs.maxCommunitiesPerUser?.message} hint="The most communities one account can create.">
            <Input id="maxCommunitiesPerUser" type="number" min={0} {...register("maxCommunitiesPerUser")} />
          </Field>
          <Field label="Network-wide events" htmlFor="networkWideEvents" hint="Events not tied to a community.">
            <Controller
              control={control}
              name="networkWideEvents"
              render={({ field }) => <Select id="networkWideEvents" value={field.value} onValueChange={field.onChange} options={[{ value: "EVERYONE", label: "Anyone can create" }, { value: "STAFF", label: "Moderators and admins" }]} />}
            />
          </Field>
        </div>
      </Section>

      <Section title="Automatic moderation" description="New content is scored per category from 0 to 1. At or above review it is queued for a moderator; at or above hide it is hidden until reviewed.">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
            <span className="text-sm font-medium">Score new content</span>
            <Controller control={control} name="moderation.enabled" render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="admin-moderation-enabled" />} />
          </label>
          <Field label="Provider" htmlFor="provider">
            <Controller
              control={control}
              name="moderation.provider"
              render={({ field }) => <Select id="provider" value={field.value} onValueChange={field.onChange} options={[{ value: "rules", label: "Built-in rules" }, { value: "openai", label: "OpenAI moderation" }, { value: "stub", label: "Stub (testing)" }]} />}
            />
          </Field>
        </div>
        <div className="space-y-4" data-testid="admin-thresholds">
          {Object.keys(thresholds).length === 0 ? <p className="text-sm text-subtle-foreground">No categories configured.</p> : null}
          {Object.entries(thresholds).map(([cat, t]) => {
            const err = (errs.moderation?.thresholds as Record<string, { message?: string }> | undefined)?.[cat]?.message;
            return (
              <div key={cat}>
                <div className="mb-1.5 flex items-center justify-between text-sm">
                  <span className="font-medium">{humanize(cat)}</span>
                  <span className="tabular-nums text-muted-foreground">
                    review {t.review.toFixed(2)}, hide {t.hide.toFixed(2)}
                  </span>
                </div>
                <Slider
                  min={0}
                  max={1}
                  step={0.01}
                  minStepsBetweenThumbs={0}
                  value={[t.review, t.hide]}
                  thumbLabels={[`${humanize(cat)} review threshold`, `${humanize(cat)} hide threshold`]}
                  onValueChange={([review, hide]) =>
                    setValue(`moderation.thresholds.${cat}` as "moderation.thresholds", { review: review ?? 0, hide: hide ?? 1 } as never, { shouldDirty: true, shouldValidate: true })
                  }
                />
                {err ? <p className="mt-1 text-xs font-medium text-danger">{err}</p> : null}
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="New accounts" description="Hold the first posts of new accounts for review before anyone else sees them.">
        <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
          <span className="text-sm font-medium">Pre-moderate new accounts</span>
          <Controller control={control} name="moderation.premoderateNewAccounts.enabled" render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} />} />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First posts to hold" htmlFor="firstPosts">
            <Input id="firstPosts" type="number" min={0} disabled={!premod} {...register("moderation.premoderateNewAccounts.firstPosts")} />
          </Field>
          <Field label="For accounts younger than (days)" htmlFor="accountAgeDays">
            <Input id="accountAgeDays" type="number" min={0} disabled={!premod} {...register("moderation.premoderateNewAccounts.accountAgeDays")} />
          </Field>
        </div>
      </Section>

      <Section title="Blocked terms" description="Content containing any of these words or phrases is held for review. Matching ignores case.">
        <div className="flex gap-2">
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTerms();
              }
            }}
            placeholder="Add a word or phrase, or several separated by commas"
            aria-label="New blocked term"
            data-testid="blocked-term-input"
          />
          <Button variant="outline" onClick={addTerms} disabled={!term.trim()}>
            Add
          </Button>
        </div>
        {terms.length ? (
          <ul className="flex flex-wrap gap-1.5" data-testid="blocked-terms">
            {terms.map((t) => (
              <li key={t} className="inline-flex items-center gap-1 rounded-full bg-muted py-1 pl-3 pr-1 text-sm">
                {t}
                <button
                  type="button"
                  aria-label={`Remove ${t}`}
                  onClick={() => setValue("moderation.blockedTerms", terms.filter((x) => x !== t), { shouldDirty: true })}
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-card hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-subtle-foreground">No blocked terms.</p>
        )}
      </Section>

      <div className="sticky bottom-16 z-10 flex justify-end gap-2 rounded-lg border border-border bg-card/95 p-3 shadow-popover backdrop-blur md:bottom-4">
        <Button variant="ghost" onClick={() => form.reset(initial as Values)} disabled={!formState.isDirty}>
          Discard changes
        </Button>
        <Button type="submit" loading={save.isPending} disabled={!formState.isDirty} data-testid="admin-settings-save">
          Save settings
        </Button>
      </div>
    </form>
  );
}
