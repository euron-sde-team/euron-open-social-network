/**
 * Questions and answers to DTOs, batched per page. `viewer.canDelete` and
 * `viewer.canModerate` mirror the service checks exactly: the author (while ACTIVE)
 * may delete their own; an ACTIVE community mod or platform staff (Access.canModerate)
 * may delete anything and open or close any question.
 */
import type { Answer, Question } from "@open-social/types";
import type { Actor } from "../core/context";
import { db, type Executor } from "../db/kysely";
import { communityRepo } from "../repositories/community.repository";
import { questionRepo, type AnswerRow, type QuestionRow } from "../repositories/question.repository";
import { accessMap } from "./community.presenter";
import { loadSummaries } from "./user.presenter";

/** The community cards of a page and the viewer's access to each, in two queries. */
async function communitiesOf(viewer: Actor | null, communityIds: readonly string[], exec: Executor) {
  const communities = await communityRepo.findMany([...new Set(communityIds)], exec);
  const access = await accessMap(viewer, communities, exec);
  return { byId: new Map(communities.map((c) => [c.id, c])), access };
}

export async function presentQuestions(viewer: Actor | null, rows: readonly QuestionRow[], exec: Executor = db): Promise<Question[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [authors, tags, votes, communities] = await Promise.all([
    loadSummaries(rows.map((r) => r.author_id), exec),
    questionRepo.tagsFor(ids, exec),
    questionRepo.viewerVotes("question", viewer?.id, ids, exec),
    communitiesOf(viewer, rows.map((r) => r.community_id), exec),
  ]);
  const active = viewer?.status === "ACTIVE";
  return rows
    .filter((r) => authors.has(r.author_id) && communities.byId.has(r.community_id))
    .map((r) => {
      const c = communities.byId.get(r.community_id)!;
      const canModerate = !!communities.access.get(c.id)?.canModerate;
      const isAuthor = active && viewer?.id === r.author_id;
      return {
        id: r.id,
        communityId: r.community_id,
        community: { id: c.id, slug: c.slug, name: c.name },
        author: authors.get(r.author_id)!,
        title: r.title,
        body: r.body,
        tags: tags.filter((t) => t.question_id === r.id).map((t) => String(t.tag).toLowerCase()),
        status: r.status,
        score: r.score,
        answerCount: r.answer_count,
        viewCount: r.view_count,
        acceptedAnswerId: r.accepted_answer_id,
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
        viewer: { vote: votes.get(r.id) ?? 0, canEdit: isAuthor, canAccept: isAuthor, canDelete: isAuthor || canModerate, canModerate },
      };
    });
}

export async function presentQuestion(viewer: Actor | null, row: QuestionRow, exec: Executor = db): Promise<Question> {
  const [q] = await presentQuestions(viewer, [row], exec);
  if (!q) throw new Error(`question ${row.id} could not be presented`);
  return q;
}

/** Answers of one question: `question` gives the accepted id and the community delete rights come from. */
export async function presentAnswers(viewer: Actor | null, rows: readonly AnswerRow[], question: Pick<QuestionRow, "accepted_answer_id" | "community_id">, exec: Executor = db): Promise<Answer[]> {
  if (!rows.length) return [];
  const [authors, votes, communities] = await Promise.all([
    loadSummaries(rows.map((r) => r.author_id), exec),
    questionRepo.viewerVotes("answer", viewer?.id, rows.map((r) => r.id), exec),
    communitiesOf(viewer, [question.community_id], exec),
  ]);
  const active = viewer?.status === "ACTIVE";
  const canModerate = !!communities.access.get(question.community_id)?.canModerate;
  return rows
    .filter((r) => authors.has(r.author_id))
    .map((r) => {
      const isAuthor = active && viewer?.id === r.author_id;
      return {
        id: r.id,
        questionId: r.question_id,
        author: authors.get(r.author_id)!,
        body: r.body,
        score: r.score,
        isAccepted: r.id === question.accepted_answer_id,
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
        viewer: { vote: votes.get(r.id) ?? 0, canEdit: isAuthor, canDelete: isAuthor || canModerate },
      };
    });
}
