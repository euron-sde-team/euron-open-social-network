"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox, Scale, Shield, ShieldCheck } from "lucide-react";
import { Avatar, Badge, Button, Card, EmptyState, Field, Select, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, toast } from "@open-social/ui";
import type { Appeal, CaseSource, ModerationCase, ModerationTarget } from "@open-social/types";
import { isApiError } from "@open-social/api-client";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { useMyCommunities, usePagedList } from "@/lib/hooks/queries";
import { caseSnippet, humanize } from "@/lib/moderation";
import { qk } from "@/lib/query-keys";
import { useSignals } from "@/lib/stores/signals";
import { compactNumber } from "@/lib/time";
import { ErrorState, LoadMore, PageTitle } from "@/components/common/states";
import { TimeAgo } from "@/components/common/time-ago";
import { CaseDrawer } from "./case-drawer";
import { Reasons, SourceBadge, StatusBadge } from "./case-bits";
import { PriorityBar, ScoreBars } from "./score-bars";

const ALL = "__all__";
const TARGETS: ModerationTarget[] = ["POST", "COMMENT", "CHAT_MESSAGE", "DM_MESSAGE", "QUESTION", "ANSWER", "EVENT", "USER", "COMMUNITY"];

function StatTile({ label, value, icon }: { label: string; value: number | undefined; icon: React.ReactNode }) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className="flex size-10 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">{icon}</span>
      <div>
        <p className="text-2xl font-bold tabular-nums">{value === undefined ? <Skeleton className="h-7 w-10" /> : compactNumber(value)}</p>
        <p className="text-xs text-subtle-foreground">{label}</p>
      </div>
    </Card>
  );
}

export function ModerationDesk() {
  const { isStaff } = useAuth();
  const communities = useMyCommunities();
  const modCommunities = useMemo(() => (communities.data ?? []).filter((c) => c.viewer.canModerate), [communities.data]);
  const liveOpen = useSignals((s) => s.modOpenCases);
  const canModerate = isStaff || modCommunities.length > 0;
  // Staff get network-wide counters; community moderators get them for their own communities.
  const stats = useQuery({ queryKey: qk.modStats, queryFn: () => api().moderation.stats(), enabled: canModerate, refetchInterval: 60_000, meta: { silent: true } });
  const [openCase, setOpenCase] = useState<string | null>(null);

  if (!isStaff && communities.isPending) return <Skeleton className="h-64" />;
  if (!isStaff && !modCommunities.length) {
    return (
      <Card>
        <EmptyState icon={<Shield />} title="No moderation access" description="The moderation desk is for network staff and community moderators. When you moderate a community, its queue shows up here." />
      </Card>
    );
  }

  // The live badge counts the whole network, so it only applies to staff.
  const openCount = (isStaff ? liveOpen : undefined) ?? stats.data?.openCases;
  return (
    <div>
      <PageTitle
        title="Moderation desk"
        description={isStaff ? "Review flagged and reported content across the network." : `Review content in ${modCommunities.length === 1 ? modCommunities[0]!.name : `your ${modCommunities.length} communities`}.`}
        actions={openCount !== undefined ? <Badge tone="warning" size="md" data-testid="moderation-open-count">{openCount} open</Badge> : null}
      />
      <div className={isStaff ? "mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4" : "mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3"} data-testid="moderation-stats">
        <StatTile label="Open cases" value={openCount} icon={<Inbox className="size-5" />} />
        {/* Appeals are decided by staff, so the tile is theirs. */}
        {isStaff ? <StatTile label="Open appeals" value={stats.data?.openAppeals} icon={<Scale className="size-5" />} /> : null}
        <StatTile label="Actions today" value={stats.data?.actionsToday} icon={<ShieldCheck className="size-5" />} />
        <StatTile label="Auto-hidden today" value={stats.data?.autoHiddenToday} icon={<Shield className="size-5" />} />
      </div>
      <Tabs defaultValue="queue">
        <TabsList className="mb-4">
          <TabsTrigger value="queue">Queue</TabsTrigger>
          {isStaff ? <TabsTrigger value="appeals" data-testid="tab-appeals">Appeals</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="queue">
          <Queue communities={modCommunities.map((c) => ({ value: c.id, label: c.name }))} onOpen={setOpenCase} isStaff={isStaff} />
        </TabsContent>
        {isStaff ? (
          <TabsContent value="appeals">
            <Appeals onOpenCase={setOpenCase} />
          </TabsContent>
        ) : null}
      </Tabs>
      <CaseDrawer caseId={openCase} onOpenChange={(o) => !o && setOpenCase(null)} />
    </div>
  );
}

function Queue({ communities, onOpen, isStaff }: { communities: { value: string; label: string }[]; onOpen: (id: string) => void; isStaff: boolean }) {
  const [status, setStatus] = useState<"OPEN" | "RESOLVED">("OPEN");
  const [source, setSource] = useState<string>(ALL);
  const [community, setCommunity] = useState<string>(ALL);
  const [target, setTarget] = useState<string>(ALL);
  const filters = {
    status,
    source: source === ALL ? undefined : source,
    communityId: community === ALL ? undefined : community,
    targetType: target === ALL ? undefined : target,
  };
  const list = usePagedList<ModerationCase>({
    queryKey: qk.modCases(filters),
    fetchPage: (cursor) =>
      api().moderation.cases({ cursor, status, source: filters.source as CaseSource | undefined, communityId: filters.communityId, targetType: filters.targetType as ModerationTarget | undefined }),
  });
  const liveOpen = useSignals((s) => s.modOpenCases);
  const qc = useQueryClient();
  // A new case arrived somewhere: refresh the open queue in the background.
  useEffect(() => {
    if (liveOpen !== null && status === "OPEN") void qc.invalidateQueries({ queryKey: qk.modCasesAll, refetchType: "active" });
  }, [liveOpen, status, qc]);

  return (
    <div>
      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Select aria-label="Status" value={status} onValueChange={(v) => setStatus(v as "OPEN" | "RESOLVED")} options={[{ value: "OPEN", label: "Open" }, { value: "RESOLVED", label: "Resolved" }]} data-testid="filter-status" />
        <Select
          aria-label="Source"
          value={source}
          onValueChange={setSource}
          options={[{ value: ALL, label: "All sources" }, { value: "AI", label: "AI flags" }, { value: "REPORT", label: "Reports" }, { value: "PREMODERATION", label: "Pre-moderation" }]}
          data-testid="filter-source"
        />
        <Select aria-label="Community" value={community} onValueChange={setCommunity} options={[{ value: ALL, label: isStaff ? "All communities" : "All my communities" }, ...communities]} data-testid="filter-community" />
        <Select aria-label="Content type" value={target} onValueChange={setTarget} options={[{ value: ALL, label: "All content" }, ...TARGETS.map((t) => ({ value: t, label: humanize(t) }))]} data-testid="filter-type" />
      </div>
      <Card className="overflow-hidden" data-testid="moderation-queue">
        {list.isPending ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : !list.items.length ? (
          <EmptyState icon={<ShieldCheck />} title={status === "OPEN" ? "The queue is clear" : "No resolved cases"} description={status === "OPEN" ? "Nothing needs a decision right now. New flags and reports show up here live." : "Decisions you make will be listed here."} />
        ) : (
          <>
            <table className="hidden w-full text-left text-sm lg:table">
              <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-subtle-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Content</th>
                  <th className="px-3 py-2.5 font-semibold">Source</th>
                  <th className="px-3 py-2.5 font-semibold">Signals</th>
                  <th className="px-3 py-2.5 font-semibold">Priority</th>
                  <th className="px-3 py-2.5 font-semibold">Opened</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.items.map((c) => (
                  <tr key={c.id} onClick={() => onOpen(c.id)} className="cursor-pointer transition-colors hover:bg-muted/60" data-testid="moderation-case">
                    <td className="max-w-0 px-4 py-3">
                      <button type="button" className="block w-full text-left focus-visible:outline-none" onClick={(e) => { e.stopPropagation(); onOpen(c.id); }}>
                        <span className="flex items-center gap-1.5 text-xs text-subtle-foreground">
                          <Badge tone="neutral">{humanize(c.targetType)}</Badge>
                          {c.community ? <span className="truncate">{c.community.name}</span> : null}
                          <StatusBadge status={c.targetStatus} />
                        </span>
                        <span className="mt-1 block truncate font-medium">{caseSnippet(c)}</span>
                        {c.author ? (
                          <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Avatar name={c.author.displayName} seed={c.author.id} src={c.author.avatarUrl} size="xs" /> {c.author.displayName}
                          </span>
                        ) : null}
                      </button>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="space-y-1.5">
                        <SourceBadge source={c.source} />
                        <Reasons reasons={c.reasons} />
                      </div>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <ScoreBars scores={c.aiScores} compact />
                    </td>
                    <td className="px-3 py-3 align-top">
                      <PriorityBar value={c.priority} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 align-top text-xs text-muted-foreground">
                      <TimeAgo value={c.openedAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y divide-border lg:hidden">
              {list.items.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => onOpen(c.id)} className="block w-full space-y-2 px-4 py-3 text-left hover:bg-muted/60" data-testid="moderation-case">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge tone="neutral">{humanize(c.targetType)}</Badge>
                      <SourceBadge source={c.source} />
                      <StatusBadge status={c.targetStatus} />
                      <span className="ml-auto text-xs text-subtle-foreground">
                        <TimeAgo value={c.openedAt} />
                      </span>
                    </span>
                    <span className="block text-sm font-medium">{caseSnippet(c)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {c.author ? c.author.displayName : "Unknown author"}
                      {c.community ? ` in ${c.community.name}` : ""}
                    </span>
                    <ScoreBars scores={c.aiScores} />
                    <Reasons reasons={c.reasons} />
                  </button>
                </li>
              ))}
            </ul>
            <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} />
          </>
        )}
      </Card>
    </div>
  );
}

function Appeals({ onOpenCase }: { onOpenCase: (id: string) => void }) {
  const [status, setStatus] = useState("PENDING");
  const list = usePagedList<Appeal>({ queryKey: qk.modAppeals(status), fetchPage: (cursor) => api().moderation.appeals({ cursor, status }) });
  return (
    <div>
      <div className="mb-3 w-48">
        <Select aria-label="Appeal status" value={status} onValueChange={setStatus} options={[{ value: "PENDING", label: "Pending" }, { value: "UPHELD", label: "Upheld" }, { value: "OVERTURNED", label: "Overturned" }]} />
      </div>
      {list.isPending ? (
        <Skeleton className="h-32" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : !list.items.length ? (
        <Card>
          <EmptyState icon={<Scale />} title="No appeals here" description="Appeals from authors who disagree with a decision appear here." />
        </Card>
      ) : (
        <div className="space-y-3" data-testid="appeals-list">
          {list.items.map((a) => (
            <AppealCard key={a.id} appeal={a} onOpenCase={onOpenCase} />
          ))}
          <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} />
        </div>
      )}
    </div>
  );
}

function AppealCard({ appeal, onOpenCase }: { appeal: Appeal; onOpenCase: (id: string) => void }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const decide = useMutation({
    mutationFn: (s: "UPHELD" | "OVERTURNED") => api().moderation.decideAppeal(appeal.id, s, note.trim() || undefined),
    meta: { silent: true },
    onSuccess: (_a, s) => {
      toast.success({ title: s === "OVERTURNED" ? "Decision overturned, content restored" : "Decision upheld" });
      void qc.invalidateQueries({ queryKey: ["mod-appeals"] });
      void qc.invalidateQueries({ queryKey: qk.modStats });
      void qc.invalidateQueries({ queryKey: qk.modCase(appeal.caseId) });
    },
    onError: (e) =>
      toast.error({
        title: isApiError(e) && e.status === 403 ? "Another staff member needs to decide this appeal" : "Could not record the decision",
        description: isApiError(e) && e.status === 403 ? "You took the original action, so a different moderator reviews the appeal." : errorMessage(e),
      }),
  });
  return (
    <Card className="p-4" data-testid="appeal-card">
      <div className="flex items-start gap-3">
        <Avatar name={appeal.appellant.displayName} seed={appeal.appellant.id} src={appeal.appellant.avatarUrl} />
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            <span className="font-semibold">{appeal.appellant.displayName}</span> appealed <TimeAgo value={appeal.createdAt} className="text-subtle-foreground" />
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{appeal.statement}</p>
          <Button variant="link" size="sm" className="mt-1" onClick={() => onOpenCase(appeal.caseId)}>
            Review the case
          </Button>
        </div>
        <Badge tone={appeal.status === "PENDING" ? "warning" : appeal.status === "OVERTURNED" ? "success" : "neutral"}>{humanize(appeal.status)}</Badge>
      </div>
      {appeal.status === "PENDING" ? (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          <Field label="Note to the author" htmlFor={`note-${appeal.id}`} optional>
            <Textarea id={`note-${appeal.id}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => decide.mutate("UPHELD")} disabled={decide.isPending} data-testid="appeal-uphold">
              Uphold decision
            </Button>
            <Button size="sm" onClick={() => decide.mutate("OVERTURNED")} disabled={decide.isPending} data-testid="appeal-overturn">
              Overturn and restore
            </Button>
          </div>
        </div>
      ) : appeal.decisionNote ? (
        <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">Note: {appeal.decisionNote}</p>
      ) : null}
    </Card>
  );
}
