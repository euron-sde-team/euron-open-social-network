/**
 * Discovery: search, typeahead, trending tags (last 14 days), tag pages and the
 * leaderboard. Every result set goes through the same visibility rules as the feeds:
 * nothing from a private community the viewer is not in, nothing across a block.
 */
import type { Community, LeaderboardEntry, Post, SearchResults, TrendingTag, UserSummary } from "@open-social/types";
import type { Actor } from "../core/context";
import { presentCommunities } from "../presenters/community.presenter";
import { presentPosts } from "../presenters/post.presenter";
import { presentQuestions } from "../presenters/question.presenter";
import { loadSummaries } from "../presenters/user.presenter";
import type { Paged } from "../repositories/keyset";
import { postRepo } from "../repositories/post.repository";
import { questionRepo } from "../repositories/question.repository";
import { searchRepo } from "../repositories/search.repository";
import { tagRepo } from "../repositories/tag.repository";
import * as feed from "./feed.service";
import * as points from "./points.service";

export type SearchType = "all" | "people" | "communities" | "posts" | "questions";

async function people(viewer: Actor | null, q: string, limit: number): Promise<UserSummary[]> {
  const ids = await searchRepo.people(viewer, q, limit);
  const users = await loadSummaries(ids);
  return ids.map((id) => users.get(id)).filter((u): u is UserSummary => !!u);
}

export async function search(viewer: Actor | null, q: string, type: SearchType): Promise<SearchResults> {
  const want = (t: SearchType) => type === "all" || type === t;
  const limit = type === "all" ? 5 : 20;
  const [p, c, posts, questions] = await Promise.all([
    want("people") ? people(viewer, q, limit) : Promise.resolve([]),
    want("communities") ? searchRepo.communities(viewer, q, limit).then((rows) => presentCommunities(viewer, rows)) : Promise.resolve([] as Community[]),
    want("posts") ? postRepo.search(viewer, q, limit).then((rows) => presentPosts(viewer, rows)) : Promise.resolve([] as Post[]),
    want("questions") ? questionRepo.search(viewer, q, limit).then((rows) => presentQuestions(viewer, rows)) : Promise.resolve([]),
  ]);
  return { people: p, communities: c, posts, questions };
}

export async function typeahead(viewer: Actor | null, q: string): Promise<{ people: UserSummary[]; communities: Community[] }> {
  const [p, c] = await Promise.all([people(viewer, q, 5), searchRepo.communities(viewer, q, 5).then((rows) => presentCommunities(viewer, rows))]);
  return { people: p, communities: c };
}

export const trendingTags = (viewer: Actor | null): Promise<TrendingTag[]> => tagRepo.trending(viewer, 20);

export const tagPosts = (viewer: Actor | null, tag: string, q: feed.PageQuery): Promise<Paged<Post>> => feed.tagPosts(viewer, tag, q);

export const leaderboard = (viewer: Actor | null, period: "week" | "month" | "all"): Promise<LeaderboardEntry[]> => points.leaderboard(viewer, period);
