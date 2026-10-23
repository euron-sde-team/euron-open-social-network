"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, ShieldCheck } from "lucide-react";
import { isApiError } from "@open-social/api-client";
import { Badge, Button, Card, EmptyState, Field, Skeleton, Textarea, toast } from "@open-social/ui";
import type { ModerationCase } from "@open-social/types";
import { api } from "@/lib/api";
import { usePagedList } from "@/lib/hooks/queries";
import { canAppeal as appealable, caseSnippet, humanize } from "@/lib/moderation";
import { qk } from "@/lib/query-keys";
import { fullTimestamp } from "@/lib/time";
import { ErrorState, LoadMore, NotFoundState, PageTitle } from "@/components/common/states";
import { TimeAgo } from "@/components/common/time-ago";
import { MediaMosaic } from "@/components/media/media-mosaic";
import { RichText } from "@/components/posts/rich-text";
import { Reasons, StatusBadge } from "./case-bits";

function outcome(c: ModerationCase): { label: string; tone: "warning" | "success" | "danger" | "neutral" } {
  if (c.status === "OPEN") return { label: "Under review", tone: "warning" };
  switch (c.resolution) {
    case "APPROVE":
    case "RESTORE":
    case "DISMISS":
      return { label: "No action needed", tone: "success" };
    case "HIDE":
      return { label: "Hidden", tone: "warning" };
    case "REMOVE":
      return { label: "Removed", tone: "danger" };
    default:
      return { label: c.resolution ? humanize(c.resolution) : "Resolved", tone: "neutral" };
  }
}

export function MyCases() {
  const list = usePagedList<ModerationCase>({ queryKey: qk.myCases, fetchPage: (cursor) => api().moderation.mine({ cursor }) });
  return (
    <div>
      <PageTitle title="Your content reviews" description="Decisions moderators made about things you posted. You can appeal a decision once." />
      {list.isPending ? (
        <Skeleton className="h-40" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : !list.items.length ? (
        <Card>
          <EmptyState icon={<ShieldCheck />} title="Nothing to review" description="None of your content has been reviewed by moderators." />
        </Card>
      ) : (
        <Card className="divide-y divide-border overflow-hidden" data-testid="my-cases">
          {list.items.map((c) => {
            const o = outcome(c);
            return (
              <Link key={c.id} href={`/account/moderation/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-xs text-subtle-foreground">
                    <Badge tone="neutral">{humanize(c.targetType)}</Badge>
                    {c.community ? <span>{c.community.name}</span> : null}
                    <TimeAgo value={c.openedAt} />
                  </p>
                  <p className="mt-1 truncate text-sm font-medium">{caseSnippet(c)}</p>
                </div>
                <Badge tone={o.tone}>{o.label}</Badge>
                {c.appeal ? <Badge tone="primary">Appeal {humanize(c.appeal.status).toLowerCase()}</Badge> : null}
                <ChevronRight className="size-4 shrink-0 text-subtle-foreground" />
              </Link>
            );
          })}
          <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} />
        </Card>
      )}
    </div>
  );
}

export function MyCaseDetail({ caseId }: { caseId: string }) {
  const qc = useQueryClient();
  // The author view of the case: reporters, raw AI scores and the moderator are left out by the API.
  const q = useQuery({
    queryKey: [...qk.myCases, "case", caseId],
    queryFn: async () => {
      try {
        return await api().moderation.case(caseId);
      } catch (e) {
        if (isApiError(e) && e.status === 404) return null;
        throw e;
      }
    },
  });
  const [statement, setStatement] = useState("");
  const appeal = useMutation({
    mutationFn: () => api().moderation.appeal(caseId, statement.trim()),
    onSuccess: (a) => {
      qc.setQueryData<ModerationCase | null>([...qk.myCases, "case", caseId], (c) => (c ? { ...c, appeal: a } : c));
      void qc.invalidateQueries({ queryKey: qk.myCases, exact: true });
      toast.success({ title: "Appeal sent", description: "A different moderator will review it." });
    },
  });

  const back = (
    <Button asChild variant="ghost" size="sm" className="mb-3">
      <Link href="/account/moderation">
        <ArrowLeft /> All reviews
      </Link>
    </Button>
  );
  if (q.isPending) return <Skeleton className="h-64" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const c = q.data;
  if (!c) return <NotFoundState title="We could not find that review" />;
  const o = outcome(c);
  const canAppeal = appealable(c);
  return (
    <div>
      {back}
      <PageTitle title="Why this was reviewed" description={`Opened ${fullTimestamp(c.openedAt)}`} actions={<Badge tone={o.tone} size="md">{o.label}</Badge>} />
      <div className="space-y-4">
        <Card className="p-5">
          <h2 className="mb-2 text-sm font-semibold">What happened</h2>
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            <li>
              Content: {humanize(c.targetType).toLowerCase()}
              {c.community ? ` in ${c.community.name}` : ""}
            </li>
            <li>
              {c.source === "AI" ? "Flagged automatically by the safety filter." : c.source === "REPORT" ? `Reported by ${c.reportCount} ${c.reportCount === 1 ? "person" : "people"}.` : "Held for review before publishing."}
            </li>
            {c.status === "RESOLVED" ? (
              <li>
                Decision: <span className="font-medium text-foreground">{c.resolution ? humanize(c.resolution) : "Resolved"}</span>
                {c.resolvedAt ? `, ${fullTimestamp(c.resolvedAt)}` : ""}
              </li>
            ) : (
              <li>A moderator has not decided yet.</li>
            )}
            <li className="flex items-center gap-2">
              Current status: <StatusBadge status={c.targetStatus} />
            </li>
          </ul>
          {c.reasons.length ? (
            <div className="mt-3">
              <Reasons reasons={c.reasons} />
            </div>
          ) : null}
          {c.aiCategories.length ? <p className="mt-3 text-xs text-subtle-foreground">Categories: {c.aiCategories.map(humanize).join(", ")}</p> : null}
        </Card>
        <Card className="overflow-hidden">
          <h2 className="px-5 pt-4 text-sm font-semibold">Your content</h2>
          {typeof c.snapshot.body === "string" && c.snapshot.body ? (
            <p className="px-5 py-3 text-sm leading-relaxed">
              <RichText text={c.snapshot.body} />
            </p>
          ) : (
            <p className="px-5 py-3 text-sm text-subtle-foreground">No text</p>
          )}
          {Array.isArray(c.snapshot.media) && c.snapshot.media.length ? <MediaMosaic media={c.snapshot.media} className="pb-4" /> : null}
        </Card>
        <Card className="p-5" data-testid="appeal-panel">
          <h2 className="text-sm font-semibold">Appeal</h2>
          {c.appeal ? (
            <div className="mt-2 space-y-2 text-sm">
              <p className="flex items-center gap-2">
                Status:{" "}
                <Badge tone={c.appeal.status === "PENDING" ? "warning" : c.appeal.status === "OVERTURNED" ? "success" : "neutral"}>
                  {c.appeal.status === "PENDING" ? "Waiting for a decision" : c.appeal.status === "OVERTURNED" ? "Overturned, your content is restored" : "Decision upheld"}
                </Badge>
              </p>
              <p className="whitespace-pre-wrap text-muted-foreground">{c.appeal.statement}</p>
              {c.appeal.decisionNote ? <p className="text-muted-foreground">Moderator note: {c.appeal.decisionNote}</p> : null}
            </div>
          ) : canAppeal ? (
            <div className="mt-2 space-y-3">
              <p className="text-sm text-muted-foreground">If you think this was a mistake, explain why. You can appeal once, and a different moderator reviews it.</p>
              <Field label="Your statement" htmlFor="appeal-statement" hint={`${statement.trim().length} of 2000 characters`}>
                <Textarea id="appeal-statement" rows={5} maxLength={2000} value={statement} onChange={(e) => setStatement(e.target.value)} />
              </Field>
              <div className="flex justify-end">
                <Button onClick={() => appeal.mutate()} disabled={statement.trim().length < 10} loading={appeal.isPending} data-testid="appeal-submit">
                  Send appeal
                </Button>
              </div>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">{c.status === "OPEN"
                ? "You can appeal once a decision is made."
                : c.resolution === "WARN"
                  ? "A warning can not be appealed. Nothing was hidden or removed."
                  : "There is nothing to appeal: no action was taken against your content."}</p>
          )}
        </Card>
      </div>
    </div>
  );
}
