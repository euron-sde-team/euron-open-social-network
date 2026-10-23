"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Eye, HelpCircle, MessageSquare, Plus } from "lucide-react";
import { isApiError } from "@open-social/api-client";
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  Input,
  NativeSelect,
  Segmented,
  Skeleton,
  Textarea,
  cn,
  toast,
} from "@open-social/ui";
import type { Community, Question, QuestionStatus } from "@open-social/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { parseTags } from "@/lib/communities";
import { usePagedList } from "@/lib/hooks/queries";
import { qk } from "@/lib/query-keys";
import { compactNumber } from "@/lib/time";
import { ErrorState, LoadMore } from "@/components/common/states";
import { TimeAgo } from "@/components/common/time-ago";
import { UserAvatar } from "@/components/common/user-bits";

type Sort = "new" | "top" | "unanswered";

export function QuestionStatusBadge({ status }: { status: QuestionStatus }) {
  if (status === "RESOLVED")
    return (
      <Badge tone="success">
        <CheckCircle2 /> Resolved
      </Badge>
    );
  if (status === "CLOSED") return <Badge tone="neutral">Closed</Badge>;
  return <Badge tone="primary">Open</Badge>;
}

export function QuestionCard({ question: q }: { question: Question }) {
  return (
    <li className="flex gap-4 px-4 py-4" data-testid="question-card">
      <div className="hidden w-20 shrink-0 flex-col items-end gap-1 text-xs text-subtle-foreground sm:flex">
        <span className="font-semibold text-foreground">{compactNumber(q.score)} votes</span>
        <span className={cn("rounded px-1.5 py-0.5", q.acceptedAnswerId ? "bg-success text-success-foreground" : q.answerCount ? "border border-success text-success" : "")}>
          {compactNumber(q.answerCount)} {q.answerCount === 1 ? "answer" : "answers"}
        </span>
        <span>{compactNumber(q.viewCount)} views</span>
      </div>
      <div className="min-w-0 flex-1">
        <Link href={`/questions/${q.id}`} className="line-clamp-2 text-[15px] font-semibold text-link hover:underline">
          {q.title}
        </Link>
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{q.body}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <QuestionStatusBadge status={q.status} />
          {q.tags.map((t) => (
            <Badge key={t} tone="outline">
              #{t}
            </Badge>
          ))}
          <span className="flex-1" />
          <span className="flex items-center gap-1.5 text-xs text-subtle-foreground sm:hidden">
            <MessageSquare className="size-3.5" /> {q.answerCount}
            <Eye className="ml-1 size-3.5" /> {q.viewCount}
          </span>
          <span className="flex items-center gap-1.5 text-xs text-subtle-foreground">
            <UserAvatar user={q.author} size="xs" />
            {q.author.displayName}
            <TimeAgo value={q.createdAt} />
          </span>
        </div>
      </div>
    </li>
  );
}

export function QaTab({ community: c }: { community: Community }) {
  const { status: auth } = useAuth();
  const [sort, setSort] = useState<Sort>("new");
  const [status, setStatus] = useState<QuestionStatus | "">("");
  const [asking, setAsking] = useState(false);
  const list = usePagedList<Question>({
    queryKey: qk.questions(c.id, sort, status),
    fetchPage: (cursor) => api().questions.list({ communityId: c.id, sort, status: status || undefined, cursor }),
  });
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Questions</h2>
        {auth === "signed-in" && c.viewer.isMember ? (
          <Button onClick={() => setAsking(true)} data-testid="ask-question">
            <Plus /> Ask a question
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          aria-label="Sort questions"
          value={sort}
          onChange={setSort}
          options={[
            { value: "new", label: "Newest" },
            { value: "top", label: "Top" },
            { value: "unanswered", label: "Unanswered" },
          ]}
        />
        <NativeSelect value={status} onChange={(e) => setStatus(e.target.value as QuestionStatus | "")} aria-label="Filter by status" className="h-9 w-40" data-testid="question-status-filter">
          <option value="">Any status</option>
          <option value="OPEN">Open</option>
          <option value="RESOLVED">Resolved</option>
          <option value="CLOSED">Closed</option>
        </NativeSelect>
      </div>
      <Card>
        {list.isPending ? (
          <div className="space-y-4 p-4">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            ))}
          </div>
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : !list.items.length ? (
          <EmptyState
            icon={<HelpCircle />}
            title={sort === "unanswered" ? "Every question has an answer" : "No questions yet"}
            description={c.viewer.isMember ? "Ask the community: the best answers rise to the top." : "Join the community to ask a question."}
          />
        ) : (
          <ul className="divide-y divide-border" data-testid="question-list">
            {list.items.map((q) => (
              <QuestionCard key={q.id} question={q} />
            ))}
          </ul>
        )}
        <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} />
      </Card>
      {asking ? <AskDialog community={c} onClose={() => setAsking(false)} /> : null}
    </div>
  );
}

/** Ask or edit a question. */
export function AskDialog({ community, question, onClose, onSaved }: { community?: Community; question?: Question; onClose: () => void; onSaved?: (q: Question) => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [title, setTitle] = useState(question?.title ?? "");
  const [body, setBody] = useState(question?.body ?? "");
  const [tags, setTags] = useState(question?.tags.join(", ") ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => {
      const payload = { title: title.trim(), body: body.trim(), tags: parseTags(tags) };
      return question ? api().questions.update(question.id, payload) : api().questions.create({ communityId: community!.id, ...payload });
    },
    meta: { silent: true },
    onSuccess: (q) => {
      void qc.invalidateQueries({ queryKey: ["questions", q.communityId] });
      qc.setQueryData(qk.question(q.id), q);
      onSaved?.(q);
      onClose();
      if (!question) {
        toast.success({ title: "Question posted" });
        router.push(`/questions/${q.id}`);
      }
    },
    onError: (e) => {
      if (isApiError(e) && e.code === "VALIDATION_FAILED") setErrors(e.fieldErrors);
      else toast.error({ title: isApiError(e) ? e.message : "Could not save the question" });
    },
  });
  const valid = title.trim().length >= 10 && body.trim().length >= 1;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg" data-testid="ask-dialog">
        <DialogHeader>
          <DialogTitle>{question ? "Edit question" : "Ask a question"}</DialogTitle>
          {!question ? <DialogDescription>Be specific. Include what you tried and what you expected.</DialogDescription> : null}
        </DialogHeader>
        <DialogBody className="space-y-4">
          <Field label="Title" htmlFor="q-title" error={errors.title} hint="At least 10 characters">
            <Input id="q-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus data-testid="question-title" />
          </Field>
          <Field label="Details" htmlFor="q-body" error={errors.body} hint="Use ``` on its own line for code blocks, `backticks` for inline code, and [text](https://link) for links.">
            <Textarea id="q-body" value={body} onChange={(e) => setBody(e.target.value)} rows={8} maxLength={20000} className="font-mono text-[13px]" data-testid="question-body" />
          </Field>
          <Field label="Tags" htmlFor="q-tags" optional hint="Up to 5, separated by commas">
            <Input id="q-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="setup, billing" />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid} loading={save.isPending} onClick={() => save.mutate()} data-testid="question-submit">
            {question ? "Save" : "Post question"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
