"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Eye, Flag, Lock, LockOpen, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  Segmented,
  Skeleton,
  SkeletonText,
  Textarea,
  cn,
  toast,
} from "@open-social/ui";
import type { Answer, Page, Question } from "@open-social/types";
import { api } from "@/lib/api";
import { useAuth, useRestricted } from "@/lib/auth";
import { nextVote } from "@/lib/communities";
import { usePagedList } from "@/lib/hooks/queries";
import { qk } from "@/lib/query-keys";
import { compactNumber } from "@/lib/time";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ReportDialog } from "@/components/common/report-dialog";
import { ErrorState, LoadMore } from "@/components/common/states";
import { TimeAgo } from "@/components/common/time-ago";
import { UserAvatar, UserName } from "@/components/common/user-bits";
import { MarkdownLite } from "./markdown-lite";
import { AskDialog, QuestionStatusBadge } from "./qa-tab";
import { VoteControl } from "./vote-control";

type AnswerPages = InfiniteData<Page<Answer>, string | undefined>;

function mapAnswers(d: AnswerPages | undefined, fn: (a: Answer) => Answer): AnswerPages | undefined {
  return d ? { ...d, pages: d.pages.map((p) => ({ ...p, items: p.items.map(fn) })) } : d;
}

export function QuestionDetail({ id }: { id: string }) {
  const router = useRouter();
  const { status: auth, user } = useAuth();
  const qc = useQueryClient();
  const [sort, setSort] = useState<"top" | "new">("top");
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [report, setReport] = useState(false);
  const q = useQuery({ queryKey: qk.question(id), queryFn: () => api().questions.get(id) });
  const answers = usePagedList<Answer>({ queryKey: qk.answers(id, sort), fetchPage: (cursor) => api().questions.answers(id, { sort, cursor }), enabled: q.isSuccess });

  const setQ = (fn: (x: Question) => Question) => qc.setQueryData<Question>(qk.question(id), (o) => (o ? fn(o) : o));

  const vote = useMutation({
    mutationFn: (v: -1 | 0 | 1) => api().questions.vote(id, v),
    onMutate: (v) => {
      const prev = qc.getQueryData<Question>(qk.question(id));
      setQ((x) => ({ ...x, score: x.score - x.viewer.vote + v, viewer: { ...x.viewer, vote: v } }));
      return { prev };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(qk.question(id), ctx?.prev),
    onSuccess: (r) => setQ((x) => ({ ...x, score: r.score, viewer: { ...x.viewer, vote: r.vote } })),
  });
  const setStatus = useMutation({ mutationFn: (s: "OPEN" | "CLOSED") => api().questions.setStatus(id, s), onSuccess: (x) => qc.setQueryData(qk.question(id), x) });
  const remove = useMutation({
    mutationFn: () => api().questions.remove(id),
    onSuccess: () => {
      toast.success({ title: "Question deleted" });
      void qc.invalidateQueries({ queryKey: ["questions"] });
      router.back();
    },
  });
  const accept = useMutation({
    mutationFn: (answerId: string | null) => api().questions.accept(id, answerId),
    onSuccess: (x) => {
      qc.setQueryData(qk.question(id), x);
      for (const s of ["top", "new"]) qc.setQueryData<AnswerPages>(qk.answers(id, s), (d) => mapAnswers(d, (a) => ({ ...a, isAccepted: a.id === x.acceptedAnswerId })));
      void qc.invalidateQueries({ queryKey: ["answers", id] });
    },
  });

  if (q.isPending)
    return (
      <Card className="space-y-4 p-6">
        <Skeleton className="h-7 w-3/4" />
        <SkeletonText lines={5} />
      </Card>
    );
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const question = q.data;
  const signedIn = auth === "signed-in";
  const sorted = [...answers.items].sort((a, b) => Number(b.isAccepted) - Number(a.isAccepted));

  return (
    <div className="space-y-4" data-testid="question-detail">
      <Button variant="ghost" size="sm" className="-ml-2" onClick={() => router.back()}>
        <ArrowLeft /> Back
      </Button>
      <Card className="p-4 sm:p-6">
        <div className="flex gap-4">
          <VoteControl score={question.score} vote={question.viewer.vote} disabled={!signedIn} onVote={(d) => vote.mutate(nextVote(question.viewer.vote, d, question.score).vote)} testId="question-vote" />
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <h1 className="min-w-0 flex-1 text-xl font-bold leading-snug tracking-tight sm:text-2xl">{question.title}</h1>
              {signedIn ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton label="Question options" data-testid="question-menu">
                      <MoreHorizontal />
                    </IconButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {question.viewer.canEdit ? (
                      <DropdownMenuItem onSelect={() => setEditing(true)}>
                        <Pencil /> Edit
                      </DropdownMenuItem>
                    ) : null}
                    {question.viewer.canEdit || question.viewer.canModerate ? (
                      <DropdownMenuItem onSelect={() => setStatus.mutate(question.status === "CLOSED" ? "OPEN" : "CLOSED")} data-testid="question-toggle-status">
                        {question.status === "CLOSED" ? <LockOpen /> : <Lock />} {question.status === "CLOSED" ? "Reopen" : "Close question"}
                      </DropdownMenuItem>
                    ) : null}
                    {question.viewer.canDelete ? (
                      <DropdownMenuItem destructive onSelect={() => setConfirm(true)} data-testid="question-delete">
                        <Trash2 /> Delete
                      </DropdownMenuItem>
                    ) : null}
                    {user?.id !== question.author.id ? (
                      <DropdownMenuItem onSelect={() => setReport(true)}>
                        <Flag /> Report question
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-subtle-foreground">
              <QuestionStatusBadge status={question.status} />
              <span>
                Asked in{" "}
                <Link href={`/c/${encodeURIComponent(question.community.slug)}?tab=qa`} className="font-semibold text-foreground hover:underline" data-testid="question-community">
                  {question.community.name}
                </Link>{" "}
                <TimeAgo value={question.createdAt} />
              </span>
              <span className="inline-flex items-center gap-1">
                <Eye className="size-3.5" /> {compactNumber(question.viewCount)} views
              </span>
            </div>
            <MarkdownLite text={question.body} className="mt-4" />
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {question.tags.map((t) => (
                <Badge key={t} tone="outline">
                  #{t}
                </Badge>
              ))}
              <span className="flex-1" />
              <span className="flex items-center gap-2 rounded-md bg-muted px-2.5 py-1.5 text-xs">
                <UserAvatar user={question.author} size="xs" />
                <UserName user={question.author} />
              </span>
            </div>
          </div>
        </div>
      </Card>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">
          {question.answerCount} {question.answerCount === 1 ? "answer" : "answers"}
        </h2>
        <Segmented aria-label="Sort answers" value={sort} onChange={setSort} options={[{ value: "top", label: "Top" }, { value: "new", label: "Newest" }]} />
      </div>

      {answers.isPending ? (
        <Card className="p-6">
          <SkeletonText lines={4} />
        </Card>
      ) : answers.isError ? (
        <ErrorState error={answers.error} onRetry={() => void answers.refetch()} />
      ) : !sorted.length ? (
        <Card>
          <EmptyState compact title="No answers yet" description="Know the answer? Help out below." />
        </Card>
      ) : (
        <div className="space-y-3" data-testid="answer-list">
          {sorted.map((a) => (
            <AnswerCard key={a.id} answer={a} question={question} onAccept={(v) => accept.mutate(v)} accepting={accept.isPending} />
          ))}
          <LoadMore sentinelRef={answers.sentinelRef} loading={answers.isFetchingNextPage} hasMore={!!answers.hasNextPage} />
        </div>
      )}

      {signedIn && question.status !== "CLOSED" ? <AnswerComposer question={question} /> : null}
      {question.status === "CLOSED" ? <p className="text-sm text-subtle-foreground">This question is closed to new answers.</p> : null}

      {editing ? <AskDialog question={question} onClose={() => setEditing(false)} /> : null}
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Delete this question?" description={question.viewer.canEdit ? "Its answers are deleted too." : "You are removing this as a moderator. The action is recorded in the audit log."} confirmLabel="Delete" destructive onConfirm={() => remove.mutateAsync()} />
      {report ? <ReportDialog open={report} onOpenChange={setReport} targetType="QUESTION" targetId={question.id} /> : null}
    </div>
  );
}

function AnswerCard({ answer: a, question, onAccept, accepting }: { answer: Answer; question: Question; onAccept: (id: string | null) => void; accepting: boolean }) {
  const qc = useQueryClient();
  const { status: auth, user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(a.body);
  const [confirm, setConfirm] = useState(false);
  const [report, setReport] = useState(false);
  const patch = (fn: (x: Answer) => Answer) => {
    for (const s of ["top", "new"]) qc.setQueryData<AnswerPages>(qk.answers(question.id, s), (d) => mapAnswers(d, (x) => (x.id === a.id ? fn(x) : x)));
  };
  const vote = useMutation({
    mutationFn: (v: -1 | 0 | 1) => api().questions.voteAnswer(a.id, v),
    onMutate: (v) => patch((x) => ({ ...x, score: x.score - x.viewer.vote + v, viewer: { ...x.viewer, vote: v } })),
    onError: () => void qc.invalidateQueries({ queryKey: ["answers", question.id] }),
    onSuccess: (r) => patch((x) => ({ ...x, score: r.score, viewer: { ...x.viewer, vote: r.vote } })),
  });
  const edit = useMutation({
    mutationFn: () => api().questions.updateAnswer(a.id, draft.trim()),
    onSuccess: (x) => {
      patch(() => x);
      setEditing(false);
    },
  });
  const remove = useMutation({
    mutationFn: () => api().questions.removeAnswer(a.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["answers", question.id] });
      qc.setQueryData<Question>(qk.question(question.id), (o) => (o ? { ...o, answerCount: Math.max(0, o.answerCount - 1) } : o));
    },
  });
  const accepted = a.isAccepted || question.acceptedAnswerId === a.id;
  return (
    <Card className={cn("p-4 sm:p-5", accepted && "border-success/60 ring-1 ring-success/30")} data-testid="answer-card">
      <div className="flex gap-4">
        <div className="flex flex-col items-center gap-2">
          <VoteControl score={a.score} vote={a.viewer.vote} disabled={auth !== "signed-in"} onVote={(d) => vote.mutate(nextVote(a.viewer.vote, d, a.score).vote)} testId="answer-vote" />
          {accepted ? <CheckCircle2 className="size-6 text-success" aria-label="Accepted answer" /> : null}
        </div>
        <div className="min-w-0 flex-1">
          {accepted ? (
            <Badge tone="success" className="mb-2">
              <CheckCircle2 /> Accepted answer
            </Badge>
          ) : null}
          {editing ? (
            <div className="space-y-2">
              <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={6} className="font-mono text-[13px]" aria-label="Edit answer" />
              <div className="flex gap-2">
                <Button size="sm" disabled={!draft.trim()} loading={edit.isPending} onClick={() => edit.mutate()}>
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <MarkdownLite text={a.body} />
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {question.viewer.canAccept ? (
              <Button size="sm" variant={accepted ? "secondary" : "soft"} disabled={accepting} onClick={() => onAccept(accepted ? null : a.id)} data-testid="answer-accept">
                <CheckCircle2 /> {accepted ? "Unaccept" : "Accept answer"}
              </Button>
            ) : null}
            {a.viewer.canEdit && !editing ? (
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </Button>
            ) : null}
            {a.viewer.canDelete && !editing ? (
              <Button size="sm" variant="danger-ghost" onClick={() => setConfirm(true)} data-testid="answer-delete">
                <Trash2 /> Delete
              </Button>
            ) : null}
            {auth === "signed-in" && user?.id !== a.author.id ? (
              <Button size="sm" variant="ghost" onClick={() => setReport(true)}>
                <Flag /> Report
              </Button>
            ) : null}
            <span className="flex-1" />
            <span className="flex items-center gap-2 text-xs text-subtle-foreground">
              <UserAvatar user={a.author} size="xs" />
              <UserName user={a.author} />
              <TimeAgo value={a.createdAt} />
            </span>
          </div>
        </div>
      </div>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Delete this answer?" confirmLabel="Delete" destructive onConfirm={() => remove.mutateAsync()} />
      {report ? <ReportDialog open={report} onOpenChange={setReport} targetType="ANSWER" targetId={a.id} /> : null}
    </Card>
  );
}

function AnswerComposer({ question }: { question: Question }) {
  const restricted = useRestricted();
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const post = useMutation({
    mutationFn: () => api().questions.answer(question.id, body.trim()),
    onSuccess: (a) => {
      setBody("");
      for (const s of ["top", "new"]) {
        qc.setQueryData<AnswerPages>(qk.answers(question.id, s), (d) => {
          if (!d) return d;
          const pages = [...d.pages];
          const last = pages.length - 1;
          pages[last] = { ...pages[last]!, items: [...pages[last]!.items, a] };
          return { ...d, pages };
        });
      }
      qc.setQueryData<Question>(qk.question(question.id), (o) => (o ? { ...o, answerCount: o.answerCount + 1 } : o));
      toast.success({ title: "Answer posted" });
    },
  });
  return (
    <Card className="space-y-3 p-4" data-testid="answer-composer">
      <h3 className="font-semibold">Your answer</h3>
      <Textarea disabled={restricted} value={body} onChange={(e) => setBody(e.target.value)} rows={6} maxLength={20000} placeholder={restricted ? "Your account is restricted, so you can not answer right now." : "Share what you know. Code blocks with ``` are supported."} className="font-mono text-[13px]" aria-label="Your answer" data-testid="answer-input" />
      {body.trim() ? (
        <div className="rounded-md border border-dashed border-border p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle-foreground">Preview</p>
          <MarkdownLite text={body} />
        </div>
      ) : null}
      <div className="flex justify-end">
        <Button disabled={restricted || !body.trim()} loading={post.isPending} onClick={() => post.mutate()} data-testid="answer-submit">
          Post answer
        </Button>
      </div>
    </Card>
  );
}
