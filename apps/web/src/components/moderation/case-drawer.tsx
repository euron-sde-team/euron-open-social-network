"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { ExternalLink, History, Scale } from "lucide-react";
import { Avatar, Badge, Button, DialogTitle, Field, Input, Sheet, SheetContent, Skeleton, Textarea, cn, toast } from "@open-social/ui";
import type { Appeal, ModerationActionType, ModerationCase, Page } from "@open-social/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { daysSince } from "@/lib/admin";
import { ACTION_LABEL, DESTRUCTIVE, availableActions, humanize } from "@/lib/moderation";
import { qk } from "@/lib/query-keys";
import { fullTimestamp, relativeTime } from "@/lib/time";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ErrorState } from "@/components/common/states";
import { MediaMosaic } from "@/components/media/media-mosaic";
import { RichText } from "@/components/posts/rich-text";
import { Reasons, SourceBadge, StatusBadge } from "./case-bits";
import { ScoreBars } from "./score-bars";

type CasePages = InfiniteData<Page<ModerationCase>, string | undefined>;

/** Where a case's content lives in the app, when it has a page of its own. */
export function targetHref(c: ModerationCase): string | null {
  switch (c.targetType) {
    case "POST":
      return `/posts/${c.targetId}`;
    case "QUESTION":
      return `/questions/${c.targetId}`;
    case "EVENT":
      return `/events/${c.targetId}`;
    case "COMMUNITY":
      return c.community ? `/c/${c.community.slug}` : null;
    case "USER":
      return c.author ? `/u/${c.author.username}` : null;
    default:
      return null;
  }
}

/** Apply a resolved case to every cached queue: drop it from OPEN lists, replace it elsewhere. */
export function applyResolvedCase(qc: ReturnType<typeof useQueryClient>, updated: ModerationCase) {
  qc.setQueryData(qk.modCase(updated.id), updated);
  for (const [key, data] of qc.getQueriesData<CasePages>({ queryKey: qk.modCasesAll })) {
    if (!data) continue;
    const filters = (key[1] ?? {}) as Record<string, string | undefined>;
    const dropFromOpen = updated.status === "RESOLVED" && (filters.status ?? "OPEN") === "OPEN";
    qc.setQueryData<CasePages>(key, {
      ...data,
      pages: data.pages.map((p) => ({
        ...p,
        items: dropFromOpen ? p.items.filter((c) => c.id !== updated.id) : p.items.map((c) => (c.id === updated.id ? updated : c)),
      })),
    });
  }
}

export function CaseDrawer({ caseId, onOpenChange }: { caseId: string | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={!!caseId} onOpenChange={onOpenChange}>
      <SheetContent width="max-w-xl" data-testid="case-drawer" aria-describedby={undefined}>
        {caseId ? <CaseDetail id={caseId} onClose={() => onOpenChange(false)} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function CaseDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { isStaff } = useAuth();
  const q = useQuery({ queryKey: qk.modCase(id), queryFn: () => api().moderation.case(id) });
  const c = q.data;
  const history = useQuery({
    queryKey: qk.modHistory(c?.targetType ?? "", c?.targetId ?? ""),
    queryFn: () => api().moderation.history(c!.targetType, c!.targetId),
    enabled: !!c && isStaff,
    meta: { silent: true },
  });
  const author = useQuery({
    queryKey: qk.profile(c?.author?.username ?? ""),
    queryFn: () => api().users.profile(c!.author!.username),
    enabled: !!c?.author,
    meta: { silent: true },
    retry: false,
  });

  return (
    <>
      <div className="shrink-0 border-b border-border px-5 py-4 pr-12">
        <DialogTitle>Case review</DialogTitle>
        {c ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge tone="neutral">{humanize(c.targetType)}</Badge>
            <SourceBadge source={c.source} />
            <StatusBadge status={c.targetStatus} />
            {c.status === "RESOLVED" ? <Badge tone="success">Resolved{c.resolution ? `: ${humanize(c.resolution)}` : ""}</Badge> : null}
          </div>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {q.isPending ? (
          <div className="space-y-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-16" />
            <Skeleton className="h-32" />
          </div>
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} compact />
        ) : c ? (
          <>
            <section aria-labelledby="snap-h">
              <div className="mb-2 flex items-center justify-between">
                <h3 id="snap-h" className="text-sm font-semibold">
                  Content when the case opened
                </h3>
                {targetHref(c) ? (
                  <Link href={targetHref(c)!} target="_blank" className="inline-flex items-center gap-1 text-xs font-medium text-link hover:underline">
                    Open <ExternalLink className="size-3" />
                  </Link>
                ) : null}
              </div>
              <div className="rounded-lg border border-border bg-muted/30">
                {typeof c.snapshot.title === "string" && c.snapshot.title ? <p className="px-4 pt-3 font-semibold">{c.snapshot.title}</p> : null}
                {typeof c.snapshot.body === "string" && c.snapshot.body ? (
                  <p className="px-4 py-3 text-sm leading-relaxed">
                    <RichText text={c.snapshot.body} />
                  </p>
                ) : (
                  <p className="px-4 py-3 text-sm text-subtle-foreground">No text</p>
                )}
                {Array.isArray(c.snapshot.media) && c.snapshot.media.length ? <MediaMosaic media={c.snapshot.media} className="pb-3" /> : null}
              </div>
              {c.community ? (
                <p className="mt-2 text-xs text-subtle-foreground">
                  In{" "}
                  <Link href={`/c/${c.community.slug}`} className="font-medium text-link hover:underline">
                    {c.community.name}
                  </Link>
                  , opened {relativeTime(c.openedAt)}
                </p>
              ) : (
                <p className="mt-2 text-xs text-subtle-foreground">Opened {relativeTime(c.openedAt)}</p>
              )}
            </section>

            <section className="grid gap-4 sm:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-semibold">Signals</h3>
                <ScoreBars scores={c.aiScores} max={8} />
                {c.aiProvider ? <p className="mt-1 text-xs text-subtle-foreground">Scored by {c.aiProvider}</p> : null}
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold">Reports</h3>
                {c.reportCount ? (
                  <>
                    <p className="mb-1.5 text-xs text-subtle-foreground">
                      {c.reportCount} {c.reportCount === 1 ? "report" : "reports"}
                    </p>
                    <Reasons reasons={c.reasons} />
                  </>
                ) : (
                  <p className="text-xs text-subtle-foreground">No reports</p>
                )}
              </div>
            </section>

            {c.author ? (
              <section className="flex items-center gap-3 rounded-lg border border-border p-3" data-testid="case-author">
                <Avatar name={c.author.displayName} seed={c.author.id} src={c.author.avatarUrl} />
                <div className="min-w-0 flex-1">
                  <Link href={`/u/${c.author.username}`} className="text-sm font-semibold hover:underline">
                    {c.author.displayName}
                  </Link>
                  <p className="text-xs text-subtle-foreground">
                    @{c.author.username}
                    {author.data ? `, joined ${daysSince(author.data.joinedAt)} days ago, ${author.data.postCount} posts` : ""}
                  </p>
                </div>
                {c.author.role !== "USER" ? <Badge tone="primary">{humanize(c.author.role)}</Badge> : null}
              </section>
            ) : null}

            {c.appeal ? <AppealPanel appeal={c.appeal} /> : null}

            {isStaff ? (
              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                  <History className="size-4" /> History
                </h3>
                {history.isPending ? (
                  <Skeleton className="h-12" />
                ) : !history.data?.length ? (
                  <p className="text-xs text-subtle-foreground">No earlier actions on this content.</p>
                ) : (
                  <ol className="space-y-2 border-l border-border pl-4">
                    {history.data.map((h) => (
                      <li key={h.id} className="relative text-sm">
                        <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-primary" aria-hidden />
                        <span className="font-semibold">{humanize(h.action)}</span> by {h.actor?.displayName ?? "the system"}
                        <span className="block text-xs text-subtle-foreground" title={fullTimestamp(h.createdAt)}>
                          {relativeTime(h.createdAt)}
                          {h.reason ? `: ${h.reason}` : ""}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            ) : null}
          </>
        ) : null}
      </div>
      {c ? <ActionBar c={c} onDone={onClose} /> : null}
    </>
  );
}

function AppealPanel({ appeal }: { appeal: Appeal }) {
  return (
    <section className="rounded-lg border border-primary/30 bg-primary-soft/50 p-3" data-testid="case-appeal">
      <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
        <Scale className="size-4" /> Appeal from {appeal.appellant.displayName}
        <Badge tone={appeal.status === "PENDING" ? "warning" : appeal.status === "OVERTURNED" ? "success" : "neutral"} className="ml-auto">
          {humanize(appeal.status)}
        </Badge>
      </h3>
      <p className="whitespace-pre-wrap text-sm">{appeal.statement}</p>
      {appeal.decisionNote ? <p className="mt-2 text-xs text-muted-foreground">Decision note: {appeal.decisionNote}</p> : null}
    </section>
  );
}

function ActionBar({ c, onDone }: { c: ModerationCase; onDone: () => void }) {
  const { isStaff } = useAuth();
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [days, setDays] = useState("7");
  const [confirm, setConfirm] = useState<ModerationActionType | null>(null);
  const actions = availableActions(c, isStaff);
  const act = useMutation({
    mutationFn: (action: ModerationActionType) =>
      api().moderation.act(c.id, { action, reason: reason.trim() || undefined, suspendDays: action === "SUSPEND" ? Math.max(1, Number(days) || 1) : undefined }),
    meta: { silent: true },
    onSuccess: (updated, action) => {
      applyResolvedCase(qc, updated);
      void qc.invalidateQueries({ queryKey: qk.modStats });
      void qc.invalidateQueries({ queryKey: qk.modHistory(c.targetType, c.targetId) });
      toast.success({ title: `${ACTION_LABEL[action]}: done` });
      setReason("");
      if (updated.status === "RESOLVED") onDone();
    },
    onError: (e) => toast.error({ title: "That action did not go through", description: errorMessage(e) }),
  });
  if (!actions.length) return null;
  const run = (a: ModerationActionType) => (DESTRUCTIVE.has(a) ? setConfirm(a) : act.mutate(a));
  const contentActions = actions.filter((a) => !["WARN", "SUSPEND", "BAN", "UNBAN"].includes(a));
  const accountActions = actions.filter((a) => ["WARN", "SUSPEND", "BAN", "UNBAN"].includes(a));
  return (
    <div className="shrink-0 space-y-3 border-t border-border bg-card px-5 py-4">
      <Field label="Reason" htmlFor="mod-reason" optional hint="Shown to the author with the decision.">
        <Textarea id="mod-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: breaks rule 2, personal attacks" />
      </Field>
      <div className="flex flex-wrap gap-2">
        {contentActions.map((a) => (
          <Button
            key={a}
            size="sm"
            variant={a === "APPROVE" || a === "RESTORE" ? "primary" : a === "REMOVE" ? "danger" : a === "DISMISS" ? "ghost" : "outline"}
            onClick={() => run(a)}
            loading={act.isPending && act.variables === a}
            disabled={act.isPending}
            data-testid={`case-action-${a.toLowerCase()}`}
          >
            {ACTION_LABEL[a]}
          </Button>
        ))}
      </div>
      {accountActions.length ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-subtle-foreground">Account</span>
          {accountActions.map((a) =>
            a === "SUSPEND" ? (
              <span key={a} className="flex items-center gap-1.5">
                <Input type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} className="h-8 w-16" aria-label="Suspension days" data-testid="suspend-days" />
                <span className="text-xs text-muted-foreground">days</span>
                <Button size="sm" variant="outline" onClick={() => run(a)} disabled={act.isPending} data-testid="case-action-suspend">
                  Suspend
                </Button>
              </span>
            ) : (
              <Button key={a} size="sm" variant={a === "BAN" ? "danger" : "outline"} onClick={() => run(a)} disabled={act.isPending} data-testid={`case-action-${a.toLowerCase()}`}>
                {ACTION_LABEL[a]}
              </Button>
            ),
          )}
        </div>
      ) : null}
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm ? `${ACTION_LABEL[confirm]}?` : ""}
        description={
          confirm === "BAN"
            ? "The account will be banned and every session revoked."
            : confirm === "SUSPEND"
              ? `The author will be able to read but not post or message for ${Math.max(1, Number(days) || 1)} days.`
              : "The content will be removed for everyone. The author can appeal."
        }
        confirmLabel={confirm ? ACTION_LABEL[confirm] : "Confirm"}
        destructive
        onConfirm={() => (confirm ? act.mutateAsync(confirm) : undefined)}
      />
      <p className={cn("text-xs text-subtle-foreground", isStaff && "hidden")}>Account actions (warn, suspend, ban) are for network staff.</p>
    </div>
  );
}
